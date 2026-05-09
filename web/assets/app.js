// ipl-fantasy-app.js
const DATA = {
  leaderboard: null,
  owner_rosters: null,
  all_players: null,
  match_history: null,
  fixtures: null,
  replacement_config: null,
  meta: null
};

let currentPage = 'leaderboard';
let currentOwner = '';
let playerFilter = 'all';
let playerSearch = '';

// ── Initialization ──
(async function init() {
  try {
    // 1. Try to load initial data
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

async function loadAll() {
  const files = [
    { key: 'leaderboard', path: 'data/leaderboard.json' },
    { key: 'owner_rosters', path: 'data/owner_rosters.json' },
    { key: 'all_players', path: 'data/all_players.json' },
    { key: 'match_history', path: 'data/match_history.json' },
    { key: 'fixtures', path: 'data/fixtures.json' },
    { key: 'replacement_config', path: 'data/replacement_config.json' },
    { key: 'meta', path: 'data/meta.json' }
  ];

  const results = await Promise.allSettled(files.map(f => fetch(f.path).then(r => r.json())));
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') DATA[files[i].key] = res.value;
  });
}

async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  const icon = document.getElementById('refresh-icon');
  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = 'spin 1s linear infinite';

  try {
    const res = await Bridge.fetchLive();
    if (res.ok) {
      await loadAll();
      localStorage.setItem('ipl_cache', JSON.stringify(DATA));
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
    if (btn) btn.disabled = false;
    if (icon) icon.style.animation = '';
  }
}

function updateMeta() {
  const m = DATA.meta || {};
  const ts = m.snapshot_timestamp || m.generated_at || '—';
  document.getElementById('meta-timestamp').textContent = ts;
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
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Status</th><th class="ta-r">Owner Pts</th></tr></thead>
          <tbody>${active.map((p,i) => `
            <tr>
              <td style="color:var(--text-dim)">${i+1}</td>
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
              <td><span class="status-badge badge-${p.status}">${p.status}</span></td>
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
          <thead><tr><th>Player</th><th>Team</th><th class="ta-r">Frozen Pts</th></tr></thead>
          <tbody>${dropped.map(p => `
            <tr style="opacity:.65">
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
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

  let players = data.players;
  if (playerSearch) {
    const q = playerSearch.toLowerCase();
    players = players.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
  }
  if (playerFilter !== 'all') {
    players = players.filter(p => p.ownership_status === playerFilter);
  }

  el.innerHTML = `
    <div class="page-header"><div class="page-title">🎯 All Players</div><div class="page-subtitle">${data.total} players in the pool</div></div>
    <div class="filter-row">
      <input type="text" class="search-box" placeholder="Search player name or team..." value="${playerSearch}" oninput="updateSearch(this.value)">
      <select class="filter-select" onchange="updateFilter(this.value)">
        <option value="all" ${playerFilter==='all'?'selected':''}>All Players</option>
        <option value="original" ${playerFilter==='original'?'selected':''}>Original Drafts</option>
        <option value="replacement" ${playerFilter==='replacement'?'selected':''}>Replacements</option>
        <option value="unowned" ${playerFilter==='unowned'?'selected':''}>Unowned</option>
      </select>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Player</th><th>Team</th><th>Role</th><th>Status</th><th>Owner</th><th class="ta-r">Points</th></tr></thead>
          <tbody>${players.map(p => `
            <tr>
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
              <td><span style="color:var(--text-muted)">${p.role}</span></td>
              <td><span class="status-badge badge-${p.ownership_status}">${p.ownership_status}</span></td>
              <td style="font-weight:600;color:var(--accent2)">${p.owner || '—'}</td>
              <td class="ta-r"><b>${p.total_points.toLocaleString()}</b></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function updateSearch(v) { playerSearch = v; renderPlayers(); }
function updateFilter(v) { playerFilter = v; renderPlayers(); }

// ── Fixtures ──
function renderFixtures() {
  const el = document.getElementById('page-fixtures');
  const data = DATA.fixtures;
  if (!data) { el.innerHTML = loading(); return; }

  const fix = data.fixtures;
  const completed = fix.filter(f => f.status === 'Completed').length;

  el.innerHTML = `
    <div class="page-header"><div class="page-title">📅 Fixtures</div><div class="page-subtitle">${completed} of ${fix.length} matches completed</div></div>
    <div class="fixture-grid">${fix.map(f => `
      <div class="fixture-card">
        <div class="fixture-num">MATCH ${f.match}</div>
        <div class="fixture-main">
          <div class="fixture-team">
            <div class="team-icon-large">${f.home.substring(0,3)}</div>
            <div class="team-name">${f.home}</div>
          </div>
          <div class="fixture-vs">VS</div>
          <div class="fixture-team">
            <div class="team-icon-large">${f.away.substring(0,3)}</div>
            <div class="team-name">${f.away}</div>
          </div>
        </div>
        <div class="fixture-footer">
          <div class="fixture-res">${f.result || '—'}</div>
          <div class="fixture-status ${f.status==='Completed'?'status-completed':''}">${f.status}</div>
        </div>
      </div>`).join('')}
    </div>`;
}

// ── Config ──
function renderConfig() {
  const el = document.getElementById('page-config');
  const cfg = DATA.replacement_config;
  if (!cfg) { el.innerHTML = loading(); return; }

  const { draft, owner_map } = cfg;
  const milestones = draft?.milestones || [];

  el.innerHTML = `
    <div class="page-header"><div class="page-title">⚙️ Replacement Config</div><div class="page-subtitle">Milestone draft logic and replacement logs</div></div>

    <div class="card" style="margin-bottom:24px;border-color:var(--accent)">
      <div class="card-header" style="background:rgba(0,212,170,0.05)">
        <span class="card-title" style="color:var(--accent)">⚡ Actions</span>
      </div>
      <div style="padding:16px;display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="actionFetchLive()">🔄 Fetch Live Data</button>
        <button class="btn btn-secondary" onclick="downloadConfig()">⬇️ Download JSON</button>
      </div>
    </div>

    <div class="milestone-section">
      ${milestones.map(m => `
        <div class="m-card">
          <div class="m-header">
            <span class="m-title">After Match ${m.after_match}</span>
            <span class="m-status">${m.snapshot_saved ? '✅ Snapshot Loaded' : '⚠️ No Snapshot'}</span>
          </div>
          <div class="replacement-grid">
            ${Object.entries(m.replacements || {}).map(([owner, changes]) => {
              const dropped = changes.dropped || [];
              const picked = changes.picked || [];
              const pairs = dropped.map((d, i) => ({ d, p: picked[i] || '—' }));
              const hasChange = pairs.length > 0;
              return `<div class="owner-changes">
                <div class="oc-name">${owner} ${!hasChange ? '<span style="color:var(--text-dim);font-weight:400;font-size:11px">· No changes</span>' : ''}</div>
                ${pairs.map(({d,p}) => `
                  <div class="change-row">
                    <div class="player-tag tag-drop"><span class="tag-label">Drop</span> ${d}</div>
                    <span style="color:var(--text-dim)">➜</span>
                    <div class="player-tag tag-pick"><span class="tag-label">Pick</span> ${p}</div>
                  </div>`).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Config JSON</span></div>
      <div class="config-editor" style="padding:16px">
        <textarea id="config-json-editor" spellcheck="false" style="width:100%;height:300px;background:#000;color:#fff;font-family:monospace;padding:10px;border-radius:8px">${JSON.stringify(draft, null, 2)}</textarea>
      </div>
    </div>`;
}

function downloadConfig() {
  try {
    const txt = document.getElementById('config-json-editor').value;
    JSON.parse(txt);
    const blob = new Blob([txt], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'replacement_draft.json';
    a.click(); URL.revokeObjectURL(url);
    toast('Config downloaded!', 'success');
  } catch(e) {
    toast('Invalid JSON: ' + e.message, 'error');
  }
}

// ── Bridge Handlers ──
async function actionFetchLive() {
  const btn = event.currentTarget;
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ Fetching...';
  toast('Fetching live data...', '');
  const res = await Bridge.fetchLive();
  btn.disabled = false; btn.innerHTML = orig;
  if (res.ok) {
    await loadAll();
    renderCurrentPage(); updateMeta();
    toast(res.message, 'success');
  } else { toast('Error: ' + res.message, 'error'); }
}

// ── Global Bridge ──
window.Bridge = {
  isDesktop: () => typeof window.pywebview !== 'undefined',
  fetchLive: async () => {
    if (window.Bridge.isDesktop()) return await window.pywebview.api.fetch_live();
    const r = await fetch('/api/proxy?endpoint=mixapi');
    return r.ok ? { ok: true, message: 'Live data loaded' } : { ok: false, message: 'API Unavailable' };
  }
};

// ── Toast & Loading ──
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
