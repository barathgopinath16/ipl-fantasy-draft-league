/**
 * scoring.js — Client-Side IPL Fantasy Scoring Engine
 * ====================================================
 * Mirrors the Python scoring_engine + fetcher for browser-side computation.
 * Handles milestone-adjusted point splitting across replacement windows.
 */

const ScoringEngine = (() => {

  // ── API Fetch Layer (mirrors fetcher.py) ──

  function proxyUrl(endpoint, params = {}) {
    const qs = new URLSearchParams({ endpoint, ...params }).toString();
    return `/api/proxy?${qs}`;
  }

  async function fetchLiveConfig() {
    const res = await fetch(proxyUrl('mixapi'));
    if (!res.ok) throw new Error(`mixapi HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.Data?.Value) throw new Error('mixapi: no data');
    return data.Data.Value;
  }

  async function fetchFixtures() {
    const res = await fetch(proxyUrl('fixtures'));
    if (!res.ok) throw new Error(`fixtures HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.Data?.Value) throw new Error('fixtures: no data');
    return data.Data.Value;
  }

  async function fetchAllPlayers(gameDayId) {
    const params = {
      tourgamedayId: gameDayId,
      teamgamedayId: gameDayId,
    };
    const res = await fetch(proxyUrl('players', params));
    if (!res.ok) throw new Error(`players HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.Data?.Value?.Players) {
      throw new Error(`players: no data for GD${gameDayId} (RetVal=${data?.Meta?.RetVal})`);
    }
    return data.Data.Value.Players;
  }

  /**
   * Main entry: Fetch live data from IPL API (via Vercel proxy).
   * Returns { players, fixtures, gameDayId }
   */
  async function fetchLiveData() {
    console.log('📡 Fetching live config...');
    await fetchLiveConfig(); // validates API is up

    console.log('📡 Fetching fixtures...');
    const fixtures = await fetchFixtures();
    const completed = fixtures.filter(f => f.MatchStatus === 2);
    const gameDayId = completed.length > 0
      ? Math.max(...completed.map(f => f.Gameday))
      : 1;
    console.log(`   ${completed.length}/${fixtures.length} completed, latest GD=${gameDayId}`);

    console.log(`📡 Fetching players for GD${gameDayId}...`);
    const players = await fetchAllPlayers(gameDayId);
    console.log(`   ${players.length} players loaded`);

    return { players, fixtures, gameDayId };
  }


  // ── Scoring Logic ──

  function normalize(n) {
    return n ? n.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  }

  function getPlayerPts(p) {
    return p.OverallPoints ?? p.points ?? p.total_points ?? 0;
  }

  function buildApiLookup(apiPlayers) {
    const lookup = {};
    for (const p of apiPlayers) {
      const name = p.Name || p.name;
      if (name) lookup[normalize(name)] = p;
    }
    return lookup;
  }

  function findApiP(name, apiLookup) {
    const norm = normalize(name);
    if (apiLookup[norm]) return apiLookup[norm];
    // Partial match fallback
    for (const k in apiLookup) {
      if (k.includes(norm) || norm.includes(k)) return apiLookup[k];
    }
    return null;
  }

  /**
   * Build the effective owner map at any point in time by applying
   * all milestone replacements up to the given milestone.
   */
  function getEffectiveOwnerMap(originalMap, draft, upToMilestone) {
    const result = {};
    for (const [owner, players] of Object.entries(originalMap)) {
      result[owner] = [...players];
    }

    const milestones = (draft.milestones || [])
      .filter(m => upToMilestone === undefined || m.after_match <= upToMilestone)
      .sort((a, b) => a.after_match - b.after_match);

    for (const m of milestones) {
      for (const [owner, changes] of Object.entries(m.replacements || {})) {
        if (!result[owner]) continue;
        const dropped = changes.dropped || [];
        const picked = changes.picked || [];
        for (const d of dropped) {
          const idx = result[owner].indexOf(d);
          if (idx !== -1) result[owner].splice(idx, 1);
        }
        for (const p of picked) {
          if (!result[owner].includes(p)) result[owner].push(p);
        }
      }
    }
    return result;
  }

  /**
   * Compute milestone-adjusted points for a single player.
   * Returns an array of { owner, phase, points } splits.
   */
  function computePlayerSplits(playerName, currentPts, originalMap, draft, milestoneSnapshots) {
    const milestones = (draft.milestones || []).sort((a, b) => a.after_match - b.after_match);
    const splits = [];

    if (milestones.length === 0) {
      // No milestones — all points go to the original owner
      for (const [owner, players] of Object.entries(originalMap)) {
        if (players.includes(playerName)) {
          splits.push({ owner, phase: 'all', points: currentPts });
          return splits;
        }
      }
      return splits;
    }

    let prevBoundaryPts = 0;

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const snapshot = milestoneSnapshots[m.after_match] || {};
      const boundaryPts = snapshot[playerName] ?? currentPts;

      // Who owned this player during this phase?
      const prevMilestone = i === 0 ? undefined : milestones[i - 1].after_match;
      const effectiveMap = getEffectiveOwnerMap(originalMap, draft, prevMilestone);

      let phaseOwner = null;
      for (const [owner, players] of Object.entries(effectiveMap)) {
        if (players.includes(playerName)) { phaseOwner = owner; break; }
      }

      const phasePts = boundaryPts - prevBoundaryPts;
      if (phaseOwner && phasePts !== 0) {
        const phase = i === 0 ? `M1-M${m.after_match}` : `M${milestones[i-1].after_match + 1}-M${m.after_match}`;
        splits.push({ owner: phaseOwner, phase, points: phasePts });
      }

      prevBoundaryPts = boundaryPts;
    }

    // Post-final-milestone phase
    const lastMilestone = milestones[milestones.length - 1];
    const finalMap = getEffectiveOwnerMap(originalMap, draft, lastMilestone.after_match);
    let finalOwner = null;
    for (const [owner, players] of Object.entries(finalMap)) {
      if (players.includes(playerName)) { finalOwner = owner; break; }
    }
    const remainingPts = currentPts - prevBoundaryPts;
    if (finalOwner && remainingPts !== 0) {
      splits.push({ owner: finalOwner, phase: `M${lastMilestone.after_match + 1}+`, points: remainingPts });
    }

    return splits;
  }

  /**
   * Main computation: produce leaderboard, rosters, and all-players list.
   */
  function computeAll(apiPlayers, ownerMap, draft, milestoneSnapshots) {
    const apiLookup = buildApiLookup(apiPlayers);

    // Collect ALL players involved across all milestones
    const allOwned = new Set();
    for (const players of Object.values(ownerMap)) {
      players.forEach(p => allOwned.add(p));
    }
    for (const m of (draft.milestones || [])) {
      for (const changes of Object.values(m.replacements || {})) {
        (changes.picked || []).forEach(p => allOwned.add(p));
      }
    }

    // Compute totals per owner
    const ownerTotals = {};
    for (const owner of Object.keys(ownerMap)) ownerTotals[owner] = 0;

    const playerCredits = {}; // playerName -> [{owner, phase, points}]

    for (const playerName of allOwned) {
      const apiP = findApiP(playerName, apiLookup);
      if (!apiP) continue;
      const currentPts = getPlayerPts(apiP);
      const splits = computePlayerSplits(playerName, currentPts, ownerMap, draft, milestoneSnapshots);
      playerCredits[playerName] = splits;
      for (const s of splits) {
        if (s.owner in ownerTotals) ownerTotals[s.owner] += s.points;
      }
    }

    // Build leaderboard
    const leaderboard = Object.entries(ownerTotals)
      .map(([owner, total]) => ({
        owner,
        total_points: Math.round(total * 10) / 10,
        player_count: (ownerMap[owner] || []).length,
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .map((row, i) => ({ ...row, rank: i + 1 }));

    // Build rosters (with effective map after all milestones)
    const finalMap = getEffectiveOwnerMap(ownerMap, draft);
    const ownerRosters = {};

    for (const owner of Object.keys(ownerMap)) {
      const activePlayers = finalMap[owner] || [];
      // Find dropped players (original + M1 picks that were later dropped)
      const allPreviousPlayers = new Set();
      // Original
      (ownerMap[owner] || []).forEach(p => allPreviousPlayers.add(p));
      // Picked at milestones
      for (const m of (draft.milestones || [])) {
        const changes = m.replacements?.[owner];
        if (changes) (changes.picked || []).forEach(p => allPreviousPlayers.add(p));
      }
      const droppedPlayers = [...allPreviousPlayers].filter(p => !activePlayers.includes(p));

      const allRoster = [...activePlayers, ...droppedPlayers];
      const players = allRoster.map(pName => {
        const apiP = findApiP(pName, apiLookup) || {};
        const credits = playerCredits[pName] || [];
        const ownerCredits = credits.filter(c => c.owner === owner);
        const ownerPts = ownerCredits.reduce((sum, c) => sum + c.points, 0);

        const isActive = activePlayers.includes(pName);
        const isOriginal = (ownerMap[owner] || []).includes(pName);
        let status;
        if (!isActive) status = 'dropped';
        else if (isOriginal) status = 'original';
        else status = 'replacement';

        return {
          name: pName,
          team: apiP.TeamShortName || '—',
          owner_points: Math.round(ownerPts * 10) / 10,
          total_points: getPlayerPts(apiP),
          status
        };
      }).sort((a, b) => b.owner_points - a.owner_points);

      ownerRosters[owner] = {
        active_count: activePlayers.length,
        total_points: Math.round(players.reduce((a, p) => a + p.owner_points, 0) * 10) / 10,
        players
      };
    }

    // All players list
    const allPlayersList = apiPlayers.map(p => {
      const name = p.Name || p.name;
      const credits = playerCredits[name] || [];
      const ownerName = credits.length > 0 ? credits[credits.length - 1].owner : null;
      return {
        name,
        team: p.TeamShortName || '—',
        total_points: getPlayerPts(p),
        ownership_status: ownerName ? 'owned' : 'unowned',
        owner: ownerName || '—'
      };
    }).sort((a, b) => b.total_points - a.total_points);

    return { leaderboard, ownerRosters, allPlayers: { players: allPlayersList } };
  }

  return { fetchLiveData, computeAll, computePlayerSplits, getEffectiveOwnerMap };
})();
