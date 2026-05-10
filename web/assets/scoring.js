/**
 * scoring.js — Client-Side IPL Fantasy Scoring Engine
 * =====================================================
 * Complete JS port of the Python scoring logic.
 * Runs entirely in the browser — no server needed.
 *
 * Handles:
 *   - IPL API fetching (via CORS proxy)
 *   - Milestone-based point splitting
 *   - Owner roster management with replacements
 *   - Leaderboard computation
 */

const ScoringEngine = (() => {

  // ── API Layer ──
  // Detect if running on Vercel (has /api/proxy) or local dev
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
    const params = {};
    if (gameDayId) {
      params.tourgamedayId = gameDayId;
      params.teamgamedayId = gameDayId;
    }
    if (version) params.announcedVersion = version;

    const res = await fetch(proxyUrl('players', params));
    const data = await res.json();
    if (data?.Data?.Value?.Players) return data.Data.Value.Players;
    throw new Error('Failed to fetch players');
  }

  async function resolveLatestGameday() {
    const fixtures = await fetchFixtures();
    const completed = fixtures
      .filter(f => f.MatchStatus === 2)
      .map(f => f.Gameday);
    return completed.length ? Math.max(...completed) : 1;
  }

  /**
   * Full live data fetch — mirrors Python's fetch_all_players() flow:
   * 1. Get live config for version info
   * 2. Resolve latest completed gameday
   * 3. Fetch all players pinned to that gameday
   */
  async function fetchLiveData() {
    const config = await fetchLiveConfig();
    const gdId = await resolveLatestGameday();
    const version = config.VersionMaster;
    const players = await fetchAllPlayers(gdId, version);
    const fixtures = await fetchFixtures();
    return { players, fixtures, gameDayId: gdId, version };
  }

  // ── Static Data Loading ──
  async function loadJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  async function loadOwnerMap() {
    return loadJSON('data/owner_player_map.json');
  }

  async function loadReplacementDraft() {
    try { return await loadJSON('data/replacement_draft.json'); }
    catch { return { milestones: [] }; }
  }

  async function loadMilestoneSnapshot(afterMatch) {
    try {
      const data = await loadJSON(`data/milestone_snapshots/milestone_m${afterMatch}.json`);
      return data.players || {};
    } catch {
      return null;
    }
  }

  // ── Core Scoring Logic ──

  function buildPlayerToOwner(ownerMap) {
    const p2o = {};
    for (const [owner, players] of Object.entries(ownerMap)) {
      for (const p of players) p2o[p] = owner;
    }
    return p2o;
  }

  function applyReplacements(ownerMap, draft, upToMilestone = null) {
    const effective = {};
    for (const [owner, players] of Object.entries(ownerMap)) {
      effective[owner] = [...players];
    }
    const milestones = (draft.milestones || [])
      .slice()
      .sort((a, b) => a.after_match - b.after_match);

    for (const m of milestones) {
      if (upToMilestone != null && m.after_match > upToMilestone) break;
      const replacements = m.replacements || {};
      for (const [owner, changes] of Object.entries(replacements)) {
        for (const d of (changes.dropped || [])) {
          const idx = (effective[owner] || []).indexOf(d);
          if (idx >= 0) effective[owner].splice(idx, 1);
        }
        for (const p of (changes.picked || [])) {
          if (!(effective[owner] || []).includes(p)) {
            (effective[owner] = effective[owner] || []).push(p);
          }
        }
      }
    }
    return effective;
  }

  /**
   * Core point-splitting logic — mirrors Python's compute_milestone_adjusted_points.
   * Needs pre-loaded milestone snapshots passed in as a map: { afterMatch: {playerName: pts} }
   */
  function computeMilestoneAdjustedPoints(playerName, currentPts, ownerMap, draft, snapshots) {
    const milestones = (draft.milestones || [])
      .slice()
      .sort((a, b) => a.after_match - b.after_match);

    if (!milestones.length) {
      for (const [owner, players] of Object.entries(ownerMap)) {
        if (players.includes(playerName)) {
          return [{ owner, phase: 'all', points: currentPts }];
        }
      }
      return [];
    }

    const result = [];
    let prevPts = 0;
    const currentMap = {};
    for (const [owner, players] of Object.entries(ownerMap)) {
      currentMap[owner] = [...players];
    }

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const afterMatch = m.after_match;
      const snapshot = snapshots[afterMatch];

      // Find owner in this phase
      let phaseOwner = null;
      for (const [owner, players] of Object.entries(currentMap)) {
        if (players.includes(playerName)) { phaseOwner = owner; break; }
      }

      const ptsAtMilestone = snapshot ? (snapshot[playerName] ?? 0) : currentPts;
      const phasePts = ptsAtMilestone - prevPts;
      const phaseLabel = i === 0
        ? `M1-M${afterMatch}`
        : `M${milestones[i - 1].after_match + 1}-M${afterMatch}`;

      if (phaseOwner) {
        result.push({ owner: phaseOwner, phase: phaseLabel, points: phasePts });
      }

      prevPts = ptsAtMilestone;

      // Apply replacements for this milestone
      const replacements = m.replacements || {};
      for (const [owner, changes] of Object.entries(replacements)) {
        for (const d of (changes.dropped || [])) {
          const idx = (currentMap[owner] || []).indexOf(d);
          if (idx >= 0) currentMap[owner].splice(idx, 1);
        }
        for (const p of (changes.picked || [])) {
          if (!(currentMap[owner] || []).includes(p)) {
            (currentMap[owner] = currentMap[owner] || []).push(p);
          }
        }
      }
    }

    // Post-last-milestone phase
    const lastMatch = milestones[milestones.length - 1].after_match;
    const postPts = currentPts - prevPts;
    const postLabel = `M${lastMatch + 1}+`;

    let postOwner = null;
    for (const [owner, players] of Object.entries(currentMap)) {
      if (players.includes(playerName)) { postOwner = owner; break; }
    }
    if (postOwner) {
      result.push({ owner: postOwner, phase: postLabel, points: postPts });
    }

    return result;
  }

  /**
   * Compute full leaderboard + per-owner rosters + all-player data.
   * This is the main function the FE calls after fetching live data.
   */
  function computeAll(apiPlayers, ownerMap, draft, snapshots) {
    const apiLookup = {};
    const normalize = (n) => n ? n.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    
    for (const p of apiPlayers) {
      const name = p.Name || p.name || p.PlayerName || p.pname;
      if (name) {
        apiLookup[normalize(name)] = p;
        // Also map common variations
        const parts = name.split(' ');
        if (parts.length > 1) {
          apiLookup[normalize(parts[parts.length-1])] = p; // Last name match
        }
      }
    }

    const effectiveMap = applyReplacements(ownerMap, draft);
    const effectiveP2O = buildPlayerToOwner(effectiveMap);
    const originalP2O = buildPlayerToOwner(ownerMap);

    const findApiP = (name) => {
      const norm = normalize(name);
      if (apiLookup[norm]) return apiLookup[norm];
      // Try partial match if direct fail
      for (const k in apiLookup) {
        if (k.includes(norm) || norm.includes(k)) return apiLookup[k];
      }
      return null;
    };

    // Collect ALL players involved (original + picked)
    const allOwned = new Set();
    for (const players of Object.values(ownerMap)) players.forEach(p => allOwned.add(p));
    for (const m of (draft.milestones || [])) {
      for (const changes of Object.values(m.replacements || {})) {
        (changes.picked || []).forEach(p => allOwned.add(p));
      }
    }

    // ── Owner totals ──
    const ownerTotals = {};
    for (const owner of Object.keys(ownerMap)) ownerTotals[owner] = 0;

    for (const playerName of allOwned) {
      const apiP = findApiP(playerName);
      if (!apiP) continue;
      // Find points key dynamically
      const currentPts = apiP.OverallPoints ?? apiP.points ?? apiP.total_points ?? apiP.Score ?? 0;
      const splits = computeMilestoneAdjustedPoints(playerName, currentPts, ownerMap, draft, snapshots);
      for (const s of splits) {
        if (s.owner in ownerTotals) ownerTotals[s.owner] += s.points;
      }
    }

    // ── Leaderboard ──
    const leaderboard = Object.entries(ownerTotals)
      .map(([owner, total]) => ({
        owner,
        total_points: Math.round(total * 10) / 10,
        player_count: (effectiveMap[owner] || []).length,
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .map((row, i) => ({ ...row, rank: i + 1 }));

    // ── Owner rosters ──
    const ownerRosters = {};
    for (const owner of Object.keys(ownerMap)) {
      const activePlayers = effectiveMap[owner] || [];
      // Find dropped players
      const droppedPlayers = [];
      for (const m of (draft.milestones || [])) {
        const changes = (m.replacements || {})[owner] || {};
        for (const d of (changes.dropped || [])) {
          if (!activePlayers.includes(d) && !(changes.picked || []).includes(d)) {
            if (!droppedPlayers.includes(d)) droppedPlayers.push(d);
          }
        }
      }

      const allRoster = [...activePlayers, ...droppedPlayers];
      const players = allRoster.map(pName => {
        const apiP = findApiP(pName) || {};
        const currentPts = apiP.OverallPoints ?? apiP.points ?? apiP.total_points ?? apiP.Score ?? 0;
        const splits = computeMilestoneAdjustedPoints(pName, currentPts, ownerMap, draft, snapshots);
        const ownerSplits = splits.filter(s => s.owner === owner);
        const ownerPts = ownerSplits.reduce((a, s) => a + s.points, 0);
        const phaseLabel = ownerSplits.length ? ownerSplits[0].phase : '—';

        const isDrop = droppedPlayers.includes(pName);
        const isNew = !ownerMap[owner]?.includes(pName);
        const status = isDrop ? 'dropped' : isNew ? 'replacement' : 'original';

        return {
          name: pName,
          team: apiP.TeamShortName || '—',
          role: apiP.SkillName || '—',
          credits: apiP.Value || 0,
          total_api_points: Math.round(currentPts * 10) / 10,
          owner_points: Math.round(ownerPts * 10) / 10,
          status,
          phase: phaseLabel,
        };
      }).sort((a, b) => b.owner_points - a.owner_points);

      ownerRosters[owner] = {
        active_count: activePlayers.length,
        total_points: Math.round(players.reduce((a, p) => a + p.owner_points, 0) * 10) / 10,
        players,
      };
    }

    // ── All players ──
    const allPlayersList = apiPlayers.map(p => {
      const name = p.Name || p.name || p.PlayerName || p.pname;
      const currentPts = p.OverallPoints ?? p.points ?? p.total_points ?? p.Score ?? 0;
      const currentOwner = effectiveP2O[name] || null;
      const origOwner = originalP2O[name] || null;

      let ownerPts = null;
      if (currentOwner) {
        const splits = computeMilestoneAdjustedPoints(name, currentPts, ownerMap, draft, snapshots);
        ownerPts = Math.round(splits.filter(s => s.owner === currentOwner).reduce((a, s) => a + s.points, 0) * 10) / 10;
      }

      let ownershipStatus = 'unowned';
      if (currentOwner && origOwner === currentOwner) ownershipStatus = 'original';
      else if (currentOwner && origOwner !== currentOwner) ownershipStatus = 'replacement';
      else if (!currentOwner && origOwner) ownershipStatus = 'dropped';

      return {
        name, team: p.TeamShortName || '—', role: p.SkillName || '—',
        credits: p.Value || 0, total_points: Math.round(currentPts * 10) / 10,
        owner: currentOwner, original_owner: origOwner,
        owner_points: ownerPts, ownership_status: ownershipStatus,
      };
    }).sort((a, b) => b.total_points - a.total_points);

    // ── Fixtures from API ──
    // (loaded separately)

    return { leaderboard, ownerRosters, allPlayers: { total: allPlayersList.length, players: allPlayersList } };
  }

  // ── Public API ──
  return {
    fetchLiveData,
    fetchFixtures,
    loadOwnerMap,
    loadReplacementDraft,
    loadMilestoneSnapshot,
    applyReplacements,
    computeMilestoneAdjustedPoints,
    computeAll,
    buildPlayerToOwner,
  };

})();
