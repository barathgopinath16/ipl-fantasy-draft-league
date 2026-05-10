/**
 * scoring.js — Client-Side IPL Fantasy Scoring Engine
 */

const ScoringEngine = (() => {

  function proxyUrl(endpoint, params = {}) {
    const base = '/api/proxy';
    const qs = new URLSearchParams({ endpoint, ...params }).toString();
    return `${base}?${qs}`;
  }

  async function fetchLiveConfig() {
    const res = await fetch(proxyUrl('mixapi'));
    const data = await res.json();
    if (data?.Data?.Value) return data.Data.Value;
    throw new Error('Failed to fetch live config');
  }

  async function fetchFixtures() {
    const res = await fetch(proxyUrl('fixtures'));
    const data = await res.json();
    if (data?.Data?.Value) return data.Data.Value;
    throw new Error('Failed to fetch fixtures');
  }

  async function fetchAllPlayers(gameDayId, version) {
    const params = { tourgamedayId: gameDayId, teamgamedayId: gameDayId };
    if (version) params.announcedVersion = version;

    const res = await fetch(proxyUrl('players', params));
    const data = await res.json();
    if (data?.Data?.Value?.Players) return data.Data.Value.Players;
    throw new Error('Failed to fetch players for Gameday ' + gameDayId);
  }

  async function resolveLatestGameday() {
    const fixtures = await fetchFixtures();
    // MatchStatus 2 = Completed
    const completed = fixtures
      .filter(f => f.MatchStatus === 2)
      .map(f => f.Gameday);
    return completed.length ? Math.max(...completed) : 1;
  }

  async function fetchLiveData() {
    try {
      const config = await fetchLiveConfig();
      const gdId = await resolveLatestGameday();
      const version = config.VersionMaster;
      
      console.log(`FETCH: Gameday ${gdId}, Version ${version}`);
      
      const players = await fetchAllPlayers(gdId, version);
      const fixtures = await fetchFixtures();
      return { players, fixtures, gameDayId: gdId, version };
    } catch (e) {
      console.error('fetchLiveData failed:', e);
      throw e;
    }
  }

  // ── Core Scoring Logic ──
  function normalize(n) {
    return n ? n.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  }

  function getPlayerPts(p) {
    return p.OverallPoints ?? p.points ?? p.total_points ?? p.Score ?? 0;
  }

  function findApiP(name, apiLookup) {
    const norm = normalize(name);
    if (apiLookup[norm]) return apiLookup[norm];
    for (const k in apiLookup) {
      if (k.includes(norm) || norm.includes(k)) return apiLookup[k];
    }
    return null;
  }

  function computeAll(apiPlayers, ownerMap, draft, snapshots) {
    const apiLookup = {};
    for (const p of apiPlayers) {
      const name = p.Name || p.name || p.PlayerName || p.pname;
      if (name) apiLookup[normalize(name)] = p;
    }

    const milestones = (draft.milestones || []).slice().sort((a, b) => a.after_match - b.after_match);
    const ownerTotals = {};
    for (const owner of Object.keys(ownerMap)) ownerTotals[owner] = 0;

    // Collect all involved players
    const allOwned = new Set();
    for (const players of Object.values(ownerMap)) players.forEach(p => allOwned.add(p));
    milestones.forEach(m => {
      Object.values(m.replacements || {}).forEach(c => (c.picked || []).forEach(p => allOwned.add(p)));
    });

    for (const playerName of allOwned) {
      const apiP = findApiP(playerName, apiLookup);
      if (!apiP) continue;
      
      const currentPts = getPlayerPts(apiP);
      const splits = computeMilestoneAdjustedPoints(playerName, currentPts, ownerMap, draft, snapshots);
      for (const s of splits) {
        if (s.owner in ownerTotals) ownerTotals[s.owner] += s.points;
      }
    }

    const leaderboard = Object.entries(ownerTotals)
      .map(([owner, total]) => ({
        owner,
        total_points: Math.round(total * 10) / 10,
        player_count: (ownerMap[owner] || []).length, // simple active count
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .map((row, i) => ({ ...row, rank: i + 1 }));

    // ── Roster Mapping ──
    const ownerRosters = {};
    for (const owner of Object.keys(ownerMap)) {
      const players = (ownerMap[owner] || []).map(pName => {
        const apiP = findApiP(pName, apiLookup) || {};
        const currentPts = getPlayerPts(apiP);
        const status = 'active'; // Simplified for live view
        return {
          name: pName,
          team: apiP.TeamShortName || '—',
          owner_points: Math.round(currentPts * 10) / 10, // simplified split
          status
        };
      }).sort((a,b) => b.owner_points - a.owner_points);

      ownerRosters[owner] = {
        active_count: players.length,
        total_points: Math.round(players.reduce((a,p) => a + p.owner_points, 0) * 10) / 10,
        players
      };
    }

    const allPlayersList = apiPlayers.map(p => ({
      name: p.Name || p.name,
      team: p.TeamShortName || '—',
      total_points: getPlayerPts(p),
      ownership_status: 'unknown'
    })).sort((a,b) => b.total_points - a.total_points);

    return { leaderboard, ownerRosters, allPlayers: { players: allPlayersList } };
  }

  function computeMilestoneAdjustedPoints(playerName, currentPts, ownerMap, draft, snapshots) {
    // Basic implementation for browser refresh
    // If snapshots are missing, we assign points to current owner
    let currentOwner = null;
    for(const [owner, players] of Object.entries(ownerMap)) {
      if (players.includes(playerName)) { currentOwner = owner; break; }
    }
    return currentOwner ? [{ owner: currentOwner, phase: 'live', points: currentPts }] : [];
  }

  return { fetchLiveData, computeAll };
})();
