// ── State ──
const DATA = {};
let currentPage = 'leaderboard';
let currentOwner = null;
let playerSort = { col: 'total_points', dir: -1 };
let playerPage = 1;
const PAGE_SIZE = 50;

// ── Data Loading ──
// Loads from pre-exported JSON files (works in all modes).
async function fetchJSON(file) {
  const res = await fetch(`data/${file}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load ${file}`);
  return res.json();
}

async function loadAll() {
  // Load static config files
  const ownerMap = await ScoringEngine.loadOwnerMap();
  const draft = await ScoringEngine.loadReplacementDraft();
  const milestones = (draft.milestones || []).map(m => m.after_match).sort((a, b) => a - b);
  const snapshots = {};
  for (const m of milestones) {
    const snap = await ScoringEngine.loadMilestoneSnapshot(m);
    if (snap) snapshots[m] = snap;
  }
  DATA._ownerMap = ownerMap;
  DATA._draft = draft;
  DATA._snapshots = snapshots;

  // Try to load pre-exported JSON data (fallback / initial state)
  try {
    const files = ['meta', 'leaderboard', 'owner_rosters', 'all_players', 'fixtures', 'replacement_config', 'match_history'];
    const results = await Promise.all(files.map(f => fetchJSON(`${f}.json`).catch(() => null)));
    files.forEach((f, i) => { if (results[i]) DATA[f] = results[i]; });
  } catch (e) {
    // Pre-exported files may not exist — that's OK if we fetch live
  }
}

/**
 * Fetch live data from the IPL Fantasy API via the CORS proxy,
 * compute all scores client-side, and update DATA.
 */
async function fetchLiveAndCompute() {
  const { players, fixtures, gameDayId } = await ScoringEngine.fetchLiveData();

  // Compute scores using the JS engine
  const computed = ScoringEngine.computeAll(
    players, DATA._ownerMap, DATA._draft, DATA._snapshots
  );

  // Build fixture data
  const fixtureList = fixtures.map(f => ({
    match: f.Gameday || f.MatchNo,
    gameday_id: f.Gameday,
    date: f.Matchdate || '',
    home: f.HomeTeamShortName || f.HomeTeamName || '',
    away: f.AwayTeamShortName || f.AwayTeamName || '',
    venue: f.VenueName || '',
    result: f.MatchResult || '',
    status: f.MatchStatus === 2 ? 'Completed' : 'Pending',
  }));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Update DATA with live-computed results
  DATA.leaderboard = { updated_at: now, owners: computed.leaderboard };
  DATA.owner_rosters = computed.ownerRosters;
  DATA.all_players = computed.allPlayers;
  DATA.fixtures = { fixtures: fixtureList };
  DATA.meta = {
    generated_at: now,
    snapshot_timestamp: now,
    has_snapshot: true,
    snapshot_player_count: players.length,
    live_gameday: gameDayId,
  };
  DATA.replacement_config = { draft: DATA._draft, owner_map: DATA._ownerMap };

  // Cache in localStorage for offline / instant load
  try {
    localStorage.setItem('ipl_cache', JSON.stringify({
      ts: Date.now(),
      leaderboard: DATA.leaderboard,
      owner_rosters: DATA.owner_rosters,
      all_players: DATA.all_players,
      fixtures: DATA.fixtures,
      meta: DATA.meta,
    }));
  } catch (e) { /* storage full — ignore */ }

  return { playerCount: players.length, gameDayId };
}

// ── Bridge Abstraction ──
// Detects if running as desktop app (pywebview) or plain browser.
const Bridge = {
  isDesktop: () => typeof window.pywebview !== 'undefined',

  async fetchLive() {
    if (this.isDesktop()) {
      return window.pywebview.api.run_update();
    } else {
      // Web mode: use JS engine via proxy
      try {
        const result = await fetchLiveAndCompute();
        return { ok: true, message: `Live data loaded — ${result.playerCount} players (GD${result.gameDayId})` };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    }
  },

  async saveConfig(txt) {
    if (this.isDesktop()) return window.pywebview.api.save_replacement_config(txt);
    // In web mode, just download the file
    downloadConfig();
    return { ok: true, message: 'Config downloaded' };
  },

  async saveMilestone(n) {
    if (this.isDesktop()) return window.pywebview.api.save_milestone(n);
    return { ok: false, message: 'Milestone snapshots require Desktop mode' };
  },

  async runTests() {
    if (this.isDesktop()) return window.pywebview.api.run_tests();
    return { ok: false, message: 'Tests require Desktop mode' };
  },

  async exportWeb() {
    if (this.isDesktop()) return window.pywebview.api.export_web();
    return { ok: true, message: 'Web data re-exported' };
  }
};

async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  const icon = document.getElementById('refresh-icon');
  btn.disabled = true;
  if (icon) icon.style.animation = 'spin 0.8s linear infinite';

  try {
    toast('⏳ Fetching live data...', '');
    const res = await Bridge.fetchLive();
    if (res.ok) {
      if (Bridge.isDesktop()) await loadAll(); // Reload JSONs after Python update
      renderCurrentPage();
      updateMeta();
      toast(res.message, 'success');
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    console.error('Refresh failed:', e);
    try {
      await loadAll();
      renderCurrentPage();
      updateMeta();
      toast('⚠️ Live API unavailable — showing cached data', 'error');
    } catch (e2) {
      toast('❌ No data available. Check network.', 'error');
    }
  } finally {
    btn.disabled = false;
    if (icon) icon.style.animation = '';
  }
}


function updateMeta() {
  const m = DATA.meta || {};
  const ts = m.snapshot_timestamp || m.generated_at || '—';
  document.getElementById('meta-timestamp').textContent = ts;
  // Always show the live fetch button
  document.getElementById('refresh-btn').innerHTML = '<span id="refresh-icon">⚡</span> Fetch Live Data';
}

// ── Navigation ──
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    currentPage = el.dataset.page;
    document.getElementById(`page-${currentPage}`).classList.add('active');
    renderCurrentPage();
  });
});

function renderCurrentPage() {
  const fns = { leaderboard: renderLeaderboard, rosters: renderRosters, players: renderPlayers, fixtures: renderFixtures, config: renderConfig };
  fns[currentPage]?.();
}

// ── Leaderboard ──
function renderLeaderboard() {
  const el = document.getElementById('page-leaderboard');
  const lb = DATA.leaderboard;
  const fixtures = DATA.fixtures?.fixtures || [];
  if (!lb) { el.innerHTML = loading(); return; }

  const owners = lb.owners;
  const maxPts = Math.max(...owners.map(o => o.total_points));
  const totalPts = owners.reduce((a, o) => a + o.total_points, 0);
  const matchesCompleted = fixtures.filter(f => f.status === 'Completed').length;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-title">🏆 Leaderboard</div>
      <div class="page-subtitle">Updated ${lb.updated_at}</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total Owners</div><div class="stat-value">${owners.length}</div></div>
      <div class="stat-card"><div class="stat-label">Total Points</div><div class="stat-value">${Math.round(totalPts).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Leader</div><div class="stat-value" style="font-size:18px">${owners[0]?.owner || '—'}</div><div class="stat-sub">${owners[0]?.total_points.toLocaleString()} pts</div></div>
      <div class="stat-card"><div class="stat-label">Matches Tracked</div><div class="stat-value">${matchesCompleted}</div><div class="stat-sub">of ${fixtures.length} matches</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Rankings</span><span style="font-size:12px;color:var(--text-muted)">Milestone-adjusted points</span></div>
      <div class="table-wrap">
        <table class="lb-table">
          <thead><tr>
            <th>Rank</th><th>Owner</th><th class="ta-r">Total Pts</th><th class="ta-r">Last Update</th><th>Progress</th><th class="ta-c">Players</th>
          </tr></thead>
          <tbody>${owners.map(o => `
            <tr>
              <td><span class="rank-badge rank-${o.rank <= 3 ? o.rank : 'n'}">${o.rank <= 3 ? ['🥇','🥈','🥉'][o.rank-1] : o.rank}</span></td>
              <td><span class="owner-name">${o.owner}</span></td>
              <td class="ta-r"><span class="pts-value">${o.total_points.toLocaleString()}</span></td>
              <td class="ta-r"><span class="pts-delta ${o.last_update_points > 0 ? 'positive' : ''}">${o.last_update_points > 0 ? '+' : ''}${o.last_update_points}</span></td>
              <td><div class="lb-bar-wrap"><div class="lb-bar" style="width:${(o.total_points/maxPts*100).toFixed(1)}%"></div></div></td>
              <td class="ta-c">${o.player_count}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Owner Rosters ──
function renderRosters() {
  const el = document.getElementById('page-rosters');
  const rosters = DATA.owner_rosters;
  if (!rosters) { el.innerHTML = loading(); return; }
  const owners = Object.keys(rosters);
  if (!currentOwner || !rosters[currentOwner]) currentOwner = owners[0];

  const r = rosters[currentOwner];
  const active = r.players.filter(p => p.status !== 'dropped');
  const dropped = r.players.filter(p => p.status === 'dropped');

  const roleIcon = { 'BATSMAN':'🏏', 'BOWLER':'🎳', 'ALL ROUNDER':'⚡', 'WICKET KEEPER':'🧤' };

  el.innerHTML = `
    <div class="page-header"><div class="page-title">👤 Owner Rosters</div><div class="page-subtitle">Full squad breakdown by owner</div></div>
    <div class="owner-tabs">${owners.map(o => `<button class="owner-tab ${o===currentOwner?'active':''}" onclick="selectOwner('${o}')">${o}</button>`).join('')}</div>
    <div class="owner-stats-row">
      <div class="owner-stat"><div class="s-label">Total Points</div><div class="s-val" style="color:var(--accent2)">${r.total_points.toLocaleString()}</div></div>
      <div class="owner-stat"><div class="s-label">Active Players</div><div class="s-val">${r.active_count}</div></div>
      <div class="owner-stat"><div class="s-label">Replacements Made</div><div class="s-val">${r.players.filter(p=>p.status==='replacement').length}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Active Squad</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Role</th><th>Status</th><th>Phase</th><th class="ta-r">Owner Pts</th></tr></thead>
          <tbody>${active.map((p,i) => `
            <tr>
              <td style="color:var(--text-dim)">${i+1}</td>
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
              <td>${roleIcon[p.role]||'—'} <span style="color:var(--text-muted)">${p.role}</span></td>
              <td><span class="status-badge badge-${p.status}">${p.status}</span></td>
              <td style="color:var(--text-muted);font-size:12px">${p.phase}</td>
              <td class="ta-r"><b>${p.owner_points.toLocaleString()}</b></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${dropped.length ? `
    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Dropped Players</span><span style="font-size:12px;color:var(--text-muted)">Points frozen at milestone</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Player</th><th>Team</th><th>Role</th><th>Phase</th><th class="ta-r">Frozen Pts</th></tr></thead>
          <tbody>${dropped.map(p => `
            <tr style="opacity:.65">
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
              <td>${roleIcon[p.role]||'—'} <span style="color:var(--text-muted)">${p.role}</span></td>
              <td style="color:var(--text-muted);font-size:12px">${p.phase}</td>
              <td class="ta-r">${p.owner_points.toLocaleString()}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}`;
}

function selectOwner(name) {
  const tabsEl = document.querySelector('.owner-tabs');
  const scrollLeft = tabsEl ? tabsEl.scrollLeft : 0;
  currentOwner = name;
  renderRosters();
  setTimeout(() => {
    const newTabsEl = document.querySelector('.owner-tabs');
    if (newTabsEl) newTabsEl.scrollLeft = scrollLeft;
  }, 0);
}

// ── All Players ──
function renderPlayers() {
  const el = document.getElementById('page-players');
  const data = DATA.all_players;
  if (!data) { el.innerHTML = loading(); return; }

  const ownerSet = [...new Set(data.players.map(p => p.owner).filter(Boolean))].sort();
  const roleSet = [...new Set(data.players.map(p => p.role).filter(Boolean))].sort();

  el.innerHTML = `
    <div class="page-header"><div class="page-title">🎯 All Players</div><div class="page-subtitle">${data.total} players in the league</div></div>
    <div class="filter-row">
      <input class="search-input" id="player-search" placeholder="🔍 Search player..." oninput="applyPlayerFilters()">
      <select class="filter-select" id="owner-filter" onchange="applyPlayerFilters()">
        <option value="">All Owners</option>
        <option value="__unowned__">Unowned</option>
        ${ownerSet.map(o=>`<option value="${o}">${o}</option>`).join('')}
      </select>
      <select class="filter-select" id="role-filter" onchange="applyPlayerFilters()">
        <option value="">All Roles</option>
        ${roleSet.map(r=>`<option value="${r}">${r}</option>`).join('')}
      </select>
      <select class="filter-select" id="status-filter" onchange="applyPlayerFilters()">
        <option value="">All Status</option>
        <option value="original">Original</option>
        <option value="replacement">Replacement</option>
        <option value="dropped">Dropped</option>
        <option value="unowned">Unowned</option>
      </select>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Player Rankings</span><span id="player-count-label" style="font-size:12px;color:var(--text-muted)"></span></div>
      <div class="table-wrap">
        <table class="data-table" id="players-table">
          <thead><tr>
            <th onclick="sortPlayers('rank')" class="${playerSort.col==='rank'?'sorted':''}"># ${sortArrow('rank')}</th>
            <th>Player</th>
            <th>Team</th>
            <th>Role</th>
            <th onclick="sortPlayers('total_points')" class="${playerSort.col==='total_points'?'sorted':''}">Total Pts ${sortArrow('total_points')}</th>
            <th onclick="sortPlayers('owner_points')" class="${playerSort.col==='owner_points'?'sorted':''}">Owner Pts ${sortArrow('owner_points')}</th>
            <th>Owner</th>
            <th>Status</th>
          </tr></thead>
          <tbody id="players-tbody"></tbody>
        </table>
      </div>
      <div class="pagination" id="player-pagination"></div>
    </div>`;

  applyPlayerFilters();
}

function sortArrow(col) {
  if (playerSort.col !== col) return '<span style="opacity:.3">↕</span>';
  return playerSort.dir === -1 ? '↓' : '↑';
}

function sortPlayers(col) {
  if (playerSort.col === col) playerSort.dir *= -1;
  else { playerSort.col = col; playerSort.dir = -1; }
  playerPage = 1;
  applyPlayerFilters();
}

function applyPlayerFilters() {
  const search = (document.getElementById('player-search')?.value || '').toLowerCase();
  const ownerF = document.getElementById('owner-filter')?.value || '';
  const roleF = document.getElementById('role-filter')?.value || '';
  const statusF = document.getElementById('status-filter')?.value || '';

  let players = [...(DATA.all_players?.players || [])].map((p, i) => ({...p, rank: i+1}));

  if (search) players = players.filter(p => p.name.toLowerCase().includes(search));
  if (ownerF === '__unowned__') players = players.filter(p => !p.owner);
  else if (ownerF) players = players.filter(p => p.owner === ownerF);
  if (roleF) players = players.filter(p => p.role === roleF);
  if (statusF) players = players.filter(p => p.ownership_status === statusF);

  players.sort((a, b) => {
    const av = a[playerSort.col] ?? -Infinity;
    const bv = b[playerSort.col] ?? -Infinity;
    return (av < bv ? -1 : av > bv ? 1 : 0) * playerSort.dir;
  });

  document.getElementById('player-count-label').textContent = `${players.length} players`;

  const totalPages = Math.ceil(players.length / PAGE_SIZE);
  if (playerPage > totalPages) playerPage = 1;
  const slice = players.slice((playerPage - 1) * PAGE_SIZE, playerPage * PAGE_SIZE);

  const roleIcon = { 'BATSMAN':'🏏', 'BOWLER':'🎳', 'ALL ROUNDER':'⚡', 'WICKET KEEPER':'🧤' };
  document.getElementById('players-tbody').innerHTML = slice.map((p, i) => `
    <tr>
      <td style="color:var(--text-dim)">${(playerPage-1)*PAGE_SIZE + i + 1}</td>
      <td style="font-weight:600">${p.name}</td>
      <td><span class="team-badge">${p.team}</span></td>
      <td>${roleIcon[p.role]||''} <span style="color:var(--text-muted)">${p.role}</span></td>
      <td class="ta-r">${p.total_points.toLocaleString()}</td>
      <td class="ta-r">${p.owner_points != null ? p.owner_points.toLocaleString() : '<span style="color:var(--text-dim)">—</span>'}</td>
      <td>${p.owner ? `<b>${p.owner}</b>` : '<span style="color:var(--text-dim)">—</span>'}</td>
      <td><span class="status-badge badge-${p.ownership_status}">${p.ownership_status}</span></td>
    </tr>`).join('');

  // Pagination
  const pg = document.getElementById('player-pagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - playerPage) <= 2)
      html += `<button class="pg-btn ${i===playerPage?'active':''}" onclick="gotoPage(${i})">${i}</button>`;
    else if (Math.abs(i - playerPage) === 3)
      html += `<span style="color:var(--text-dim);padding:0 4px">…</span>`;
  }
  pg.innerHTML = html;
}

function gotoPage(n) { playerPage = n; applyPlayerFilters(); }

// ── Fixtures ──
function renderFixtures() {
  const el = document.getElementById('page-fixtures');
  const data = DATA.fixtures;
  if (!data) { el.innerHTML = loading(); return; }

  const fixtures = data.fixtures;
  const done = fixtures.filter(f => f.status === 'Completed');

  el.innerHTML = `
    <div class="page-header"><div class="page-title">📅 Fixtures</div><div class="page-subtitle">${done.length} of ${fixtures.length} matches completed</div></div>
    <div class="filter-row">
      <select class="filter-select" id="fix-filter" onchange="applyFixFilter()">
        <option value="">All Matches</option>
        <option value="Completed">Completed</option>
        <option value="Pending">Pending</option>
      </select>
    </div>
    <div class="card"><div id="fixture-list"></div></div>`;

  applyFixFilter();
}

function applyFixFilter() {
  const f = document.getElementById('fix-filter')?.value || '';
  const fixtures = (DATA.fixtures?.fixtures || []).filter(fx => !f || fx.status === f);
  document.getElementById('fixture-list').innerHTML = fixtures.map(fx => `
    <div class="fixture-row">
      <div class="fix-num">M${fx.match}</div>
      <div style="flex:1">
        <div class="fix-teams">${fx.home} vs ${fx.away}</div>
        <div class="fix-sub">${fx.date} · ${fx.venue || '—'}</div>
        ${fx.result ? `<div class="fix-result" style="margin-top:3px;color:var(--text-muted)">${fx.result}</div>` : ''}
      </div>
      <span class="fix-status ${fx.status==='Completed'?'status-done':'status-pending'}">${fx.status}</span>
    </div>`).join('') || '<div class="loading">No fixtures</div>';
}

// ── Config ──
function renderConfig() {
  const el = document.getElementById('page-config');
  const cfg = DATA.replacement_config;
  if (!cfg) { el.innerHTML = loading(); return; }

  const { draft, owner_map } = cfg;
  const milestones = draft?.milestones || [];

  // Check which snapshots are loaded
  const snapshotStatus = {};
  for (const m of milestones) {
    snapshotStatus[m.after_match] = !!(DATA._snapshots && DATA._snapshots[m.after_match]);
  }

  el.innerHTML = `
    <div class="page-header"><div class="page-title">⚙️ Replacement Config</div><div class="page-subtitle">View milestone replacement windows and configurations</div></div>

    <div class="card" style="margin-bottom:20px;border-color:rgba(0,212,170,.25)">
      <div class="card-header" style="background:rgba(0,212,170,.06)">
        <span class="card-title" style="color:var(--accent2)">⚡ Actions</span>
      </div>
      <div style="padding:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="actionFetchLive()">🔄 Fetch Live Data</button>
        <button class="btn btn-secondary" onclick="downloadConfig()">⬇️ Download Config JSON</button>
      </div>
    </div>

    <div class="config-section">
      <div class="config-title">📌 Configured Milestones</div>
      ${milestones.length ? milestones.map(m => `
        <div class="milestone-card">
          <div class="milestone-header">
            <span class="milestone-label">After Match ${m.after_match}</span>
            <span class="milestone-snap ${snapshotStatus[m.after_match] ? 'snap-ok' : 'snap-missing'}">
              ${snapshotStatus[m.after_match]
                ? '✅ Snapshot loaded'
                : '❌ Snapshot missing — add milestone_m' + m.after_match + '.json'}
            </span>
          </div>
          <div class="replacement-grid">
            ${Object.entries(m.replacements || {}).map(([owner, changes]) => {
              const dropped = changes.dropped || [];
              const picked = changes.picked || [];
              const pairs = dropped.map((d, i) => ({ d, p: picked[i] || '—' }));
              const hasChange = pairs.some(({d, p}) => d !== p);
              return `<div class="replacement-row">
                <div class="replacement-owner">${owner} ${!hasChange ? '<span style="color:var(--text-dim);font-weight:400;font-size:11px">· No changes</span>' : ''}</div>
                ${pairs.filter(({d,p})=>d!==p).map(({d,p}) => `
                  <div class="replacement-pair">
                    <span class="drop-tag">DROP</span>
                    <span style="color:var(--red)">${d}</span>
                    <span class="arrow-icon">→</span>
                    <span class="pick-tag">PICK</span>
                    <span style="color:var(--green)">${p}</span>
                  </div>`).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>`).join('') : '<div style="color:var(--text-muted);padding:20px">No milestones configured.</div>'}
    </div>

    <div class="config-section">
      <div class="config-title">✏️ Replacement Draft Config</div>
      <div class="config-editor">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          This is the replacement_draft.json used for milestone scoring. To update, edit the file in the git repo and redeploy.
        </p>
        <textarea id="config-json-editor" spellcheck="false">${JSON.stringify(draft, null, 2)}</textarea>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="downloadConfig()">⬇️ Download JSON</button>
          <button class="btn btn-secondary" onclick="validateConfig()">✅ Validate JSON</button>
          <button class="btn btn-secondary" onclick="resetConfigEditor()">↺ Reset</button>
        </div>
        <div id="config-validation-msg" style="margin-top:10px;font-size:12px"></div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-title">📋 Current Owner Rosters (Original Draft)</div>
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Owner</th><th>Players</th></tr></thead>
            <tbody>${Object.entries(owner_map).map(([owner, players]) => `
              <tr>
                <td style="font-weight:600;width:120px">${owner}</td>
                <td style="font-size:12px;color:var(--text-muted)">${players.join(', ')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function downloadConfig() {
  try {
    const txt = document.getElementById('config-json-editor').value;
    JSON.parse(txt); // validate
    const blob = new Blob([txt], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'replacement_draft.json';
    a.click(); URL.revokeObjectURL(url);
    toast('Downloaded! Replace the file in your IPL/ folder, then run: python main.py --run', 'success');
  } catch(e) {
    toast('Invalid JSON: ' + e.message, 'error');
  }
}

// ── Desktop Action Handlers ──
async function actionFetchLive() {
  const btn = event.currentTarget;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Fetching...';
  toast('Fetching live data...', '');
  const res = await Bridge.fetchLive();
  btn.disabled = false; btn.textContent = orig;
  if (res.ok) {
    if (Bridge.isDesktop()) await loadAll();
    renderCurrentPage(); updateMeta();
    toast(res.message, 'success');
  } else { toast('Error: ' + res.message, 'error'); }
}

async function actionExportWeb() {
  toast('Re-exporting web data...', '');
  const res = await Bridge.exportWeb();
  if (res.ok) { await loadAll(); renderCurrentPage(); toast('Web data refreshed', 'success'); }
  else { toast('Error: ' + res.message, 'error'); }
}

async function actionSaveMilestone(n) {
  if (!confirm(`Save milestone snapshot for After Match ${n}?\nThis freezes all player points at the current snapshot.`)) return;
  toast(`Saving milestone snapshot for M${n}...`, '');
  const res = await Bridge.saveMilestone(n);
  if (res.ok) { await loadAll(); renderConfig(); toast(res.message, 'success'); }
  else { toast('Error: ' + res.message, 'error'); }
}

async function actionSaveConfig() {
  const txt = document.getElementById('config-json-editor').value;
  try { JSON.parse(txt); } catch(e) { toast('Invalid JSON: ' + e.message, 'error'); return; }
  toast('Saving replacement config...', '');
  const res = await Bridge.saveConfig(txt);
  if (res.ok) {
    if (Bridge.isDesktop()) await loadAll();
    renderConfig();
    toast(res.message, 'success');
  }
  else { toast('Error: ' + res.message, 'error'); }
}

async function actionRunTests() {
  const outEl = document.getElementById('test-output');
  outEl.style.display = 'block';
  outEl.textContent = '⏳ Running tests...';
  const res = await Bridge.runTests();
  if (res.ok) {
    outEl.textContent = res.output;
    const passed = res.output.includes('ALL') && res.output.includes('PASSED');
    toast(passed ? '✅ All tests passed' : '⚠️ Some tests failed — check output', passed ? 'success' : 'error');
  } else {
    outEl.textContent = 'Error: ' + res.message;
    toast('Test run failed', 'error');
  }
}

function validateConfig() {
  const msg = document.getElementById('config-validation-msg');
  try {
    const parsed = JSON.parse(document.getElementById('config-json-editor').value);
    const issues = [];
    (parsed.milestones || []).forEach(m => {
      Object.entries(m.replacements || {}).forEach(([owner, ch]) => {
        if ((ch.dropped||[]).length !== (ch.picked||[]).length)
          issues.push(`${owner}: dropped (${ch.dropped?.length}) ≠ picked (${ch.picked?.length})`);
      });
    });
    if (issues.length) {
      msg.innerHTML = `<span style="color:var(--yellow)">⚠️ Warnings:<br>${issues.join('<br>')}</span>`;
    } else {
      msg.innerHTML = `<span style="color:var(--green)">✅ JSON is valid</span>`;
    }
  } catch(e) {
    msg.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
  }
}

function resetConfigEditor() {
  document.getElementById('config-json-editor').value = JSON.stringify(DATA.replacement_config?.draft, null, 2);
  document.getElementById('config-validation-msg').innerHTML = '';
}

// ── Toast ──
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast') || (() => {
    const d = document.createElement('div'); d.id = 'toast'; document.body.appendChild(d); return d;
  })();
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function loading() {
  return `<div class="loading"><div class="loading-spinner"></div><br>Loading...</div>`;
}

// ── Init ──
(async () => {
  try {
    // 1. Load basic config and static data first
    await loadAll();
    
    // 2. Try to load cached data from localStorage for instant display
    const cache = localStorage.getItem('ipl_cache');
    if (cache) {
      const parsed = JSON.parse(cache);
      Object.assign(DATA, parsed);
    }
    
    // 3. Initial render
    updateMeta();
    renderCurrentPage();

    // 4. Trigger live refresh automatically on load
    refreshData();
  } catch(e) {
    console.error('Init failed:', e);
    document.getElementById('page-leaderboard').innerHTML = `
      <div class="loading">
        <div style="font-size:40px;margin-bottom:16px">⚠️</div>
        <div style="color:var(--red);font-weight:600">Failed to initialize</div>
        <div style="margin-top:8px;color:var(--text-muted)">Please check your connection and try again.</div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="location.reload()">↺ Retry</button>
      </div>`;
    document.getElementById('page-leaderboard').classList.add('active');
  }
})();

