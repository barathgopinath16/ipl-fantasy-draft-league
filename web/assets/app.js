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
    await loadAll();
    
    const cache = localStorage.getItem('ipl_cache');
    if (cache) {
      try {
        const parsed = JSON.parse(cache);
        Object.assign(DATA, parsed);
      } catch(e) {}
    }
    
    updateMeta();
    renderCurrentPage();
    refreshData();
  } catch(e) {
    console.error('Init failed:', e);
    const lb = document.getElementById('page-leaderboard');
    if (lb) lb.innerHTML = `<div class="loading">⚠️ Failed to load data. Please refresh.</div>`;
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
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Fetching...'; }

  try {
    const res = await Bridge.fetchLive();
    if (res.ok && res.data) {
      // Re-calculate scores locally if we have the config
      if (DATA.replacement_config && typeof ScoringEngine !== 'undefined') {
        const engine = new ScoringEngine(DATA.replacement_config.owner_map, DATA.replacement_config.draft);
        const playerMap = {};
        res.data.players.forEach(p => { playerMap[p.name] = p.points; });
        DATA.leaderboard = engine.computeLeaderboard(playerMap, DATA.match_history);
      }
      
      if (res.data.fixtures) DATA.fixtures = { fixtures: res.data.fixtures };
      localStorage.setItem('ipl_cache', JSON.stringify(DATA));
      renderCurrentPage();
      updateMeta();
      toast(res.message, 'success');
    } else {
      throw new Error(res.message || 'API Error');
    }
  } catch (e) {
    console.error('Refresh failed:', e);
    toast(`⚠️ ${e.message || 'Connection failed'} - using cache`, 'error');
  } finally {
    if (btn) { 
      btn.disabled = false; 
      btn.innerHTML = '<span id="refresh-icon">⚡</span> Fetch Live Data';
    }
  }
}

function updateMeta() {
  const m = DATA.meta || {};
  const ts = m.snapshot_timestamp || m.generated_at || '—';
  const el = document.getElementById('meta-timestamp');
  if (el) el.textContent = ts;
}

// ── Navigation ──
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    currentPage = el.dataset.page;
    const pageEl = document.getElementById(`page-${currentPage}`);
    if (pageEl) pageEl.classList.add('active');
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
      <div class="stat-card"><div class="stat-label">Matches Completed</div><div class="stat-value">${matchesCompleted}</div><div class="stat-sub">of ${fixtures.length} matches</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Rankings</span></div>
      <div class="table-wrap">
        <table class="lb-table">
          <thead><tr><th>Rank</th><th>Owner</th><th class="ta-r">Total Pts</th><th>Progress</th></tr></thead>
          <tbody>${owners.map(o => `
            <tr>
              <td><span class="rank-badge rank-${o.rank <= 3 ? o.rank : 'n'}">${o.rank <= 3 ? ['🥇','🥈','🥉'][o.rank-1] : o.rank}</span></td>
              <td><span class="owner-name">${o.owner}</span></td>
              <td class="ta-r"><span class="pts-value">${o.total_points.toLocaleString()}</span></td>
              <td><div class="lb-bar-wrap"><div class="lb-bar" style="width:${(o.total_points/maxPts*100).toFixed(1)}%"></div></div></td>
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

  el.innerHTML = `
    <div class="page-header"><div class="page-title">👤 Owner Rosters</div></div>
    <div class="owner-tabs">${owners.map(o => `<button class="owner-tab ${o===currentOwner?'active':''}" onclick="selectOwner('${o}')">${o}</button>`).join('')}</div>
    <div class="owner-stats-row">
      <div class="owner-stat"><div class="s-label">Total Points</div><div class="s-val" style="color:var(--accent2)">${r.total_points.toLocaleString()}</div></div>
      <div class="owner-stat"><div class="s-label">Active Players</div><div class="s-val">${r.active_count}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Squad Breakdown</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Status</th><th class="ta-r">Owner Pts</th></tr></thead>
          <tbody>${active.map((p,i) => `
            <tr>
              <td>${i+1}</td>
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
              <td><span class="status-badge badge-${p.status}">${p.status}</span></td>
              <td class="ta-r"><b>${p.owner_points.toLocaleString()}</b></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
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
    <div class="page-header"><div class="page-title">🎯 All Players</div></div>
    <div class="filter-row">
      <input type="text" class="search-box" placeholder="Search..." value="${playerSearch}" oninput="updateSearch(this.value)">
      <select class="filter-select" onchange="updateFilter(this.value)">
        <option value="all" ${playerFilter==='all'?'selected':''}>All</option>
        <option value="original" ${playerFilter==='original'?'selected':''}>Original</option>
        <option value="replacement" ${playerFilter==='replacement'?'selected':''}>Replacement</option>
      </select>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Player</th><th>Team</th><th>Status</th><th class="ta-r">Points</th></tr></thead>
          <tbody>${players.map(p => `
            <tr>
              <td style="font-weight:600">${p.name}</td>
              <td><span class="team-badge">${p.team}</span></td>
              <td><span class="status-badge badge-${p.ownership_status}">${p.ownership_status}</span></td>
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
            <div class="team-circle">${f.home.substring(0,3)}</div>
            <div class="team-name-small">${f.home}</div>
          </div>
          <div class="fixture-vs">VS</div>
          <div class="fixture-team">
            <div class="team-circle">${f.away.substring(0,3)}</div>
            <div class="team-name-small">${f.away}</div>
          </div>
        </div>
        <div class="fixture-result">${f.result || 'Upcoming'}</div>
      </div>`).join('')}
    </div>`;
}

// ── Config ──
function renderConfig() {
  const el = document.getElementById('page-config');
  const cfg = DATA.replacement_config;
  if (!cfg) { el.innerHTML = loading(); return; }

  const draft = cfg.draft;
  const milestones = draft?.milestones || [];

  el.innerHTML = `
    <div class="page-header"><div class="page-title">⚙️ Replacement Config</div></div>
    <div class="milestone-section">
      ${milestones.map(m => `
        <div class="m-card">
          <div class="m-header">
            <span class="m-title">After Match ${m.after_match}</span>
            <span class="m-status">${m.snapshot_saved ? '✅ Loaded' : '⚠️ Missing'}</span>
          </div>
          ${Object.entries(m.replacements || {}).map(([owner, changes]) => `
            <div class="owner-changes">
              <div class="oc-name">${owner}</div>
              ${(changes.dropped || []).map((d, i) => `
                <div class="change-row">
                  <div class="player-tag tag-drop"><span class="tag-label">Drop</span> ${d}</div>
                  <span style="color:var(--text-dim)">➜</span>
                  <div class="player-tag tag-pick"><span class="tag-label">Pick</span> ${changes.picked[i]}</div>
                </div>`).join('')}
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
}

// ── Bridge Handlers ──
window.Bridge = {
  isDesktop: () => typeof window.pywebview !== 'undefined',
  fetchLive: async () => {
    if (window.Bridge.isDesktop()) return await window.pywebview.api.fetch_live();
    
    try {
      const r = await fetch('/api/proxy?endpoint=mixapi');
      if (!r.ok) throw new Error(`Status ${r.status}`);
      const data = await r.json();
      
      const fr = await fetch('/api/proxy?endpoint=fixtures');
      if (!fr.ok) throw new Error(`Fixtures Status ${fr.status}`);
      const fData = await fr.json();
      
      return { 
        ok: true, 
        message: 'Live data loaded successfully', 
        data: { players: data.players || [], fixtures: fData.fixtures || [] } 
      };
    } catch (e) {
      return { ok: false, message: e.message || 'Live API unavailable' };
    }
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
