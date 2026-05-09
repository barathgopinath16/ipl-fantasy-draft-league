"""
replacement_manager.py — Milestone-Based Replacement Draft System
=================================================================
Manages player transfers between owners at milestone boundaries.
Handles:
  - Loading replacement draft config
  - Saving/loading milestone snapshots (frozen points at cutoff)
  - Computing effective owner map for any given match
  - Splitting player points across milestones
"""

import json
import os
from config import REPLACEMENT_DRAFT_JSON, MILESTONE_SNAPSHOTS_DIR, OWNER_MAP_JSON


def load_replacement_draft() -> dict:
    """Load the replacement draft config. Returns empty structure if file missing."""
    if not os.path.exists(REPLACEMENT_DRAFT_JSON):
        return {"milestones": []}
    with open(REPLACEMENT_DRAFT_JSON, "r") as f:
        return json.load(f)


def get_milestones() -> list:
    """Get sorted list of milestone after_match values."""
    draft = load_replacement_draft()
    return sorted(m["after_match"] for m in draft.get("milestones", []))


def get_milestone_config(after_match: int) -> dict | None:
    """Get the milestone config for a specific after_match value."""
    draft = load_replacement_draft()
    for m in draft.get("milestones", []):
        if m["after_match"] == after_match:
            return m
    return None


def save_milestone_snapshot(after_match: int, api_players: list):
    """
    Freeze the player points at a milestone boundary.
    This snapshot records OverallPoints at the cutoff match so we can
    separate pre/post milestone points.
    """
    os.makedirs(MILESTONE_SNAPSHOTS_DIR, exist_ok=True)
    path = os.path.join(MILESTONE_SNAPSHOTS_DIR, f"milestone_m{after_match}.json")
    with open(path, "w") as f:
        json.dump({
            "after_match": after_match,
            "players": {p["Name"]: p.get("OverallPoints", 0) for p in api_players}
        }, f, indent=2)
    print(f"   📌 Milestone snapshot saved for M{after_match}")


def load_milestone_snapshot(after_match: int) -> dict | None:
    """
    Load frozen points at a milestone boundary.
    Returns {player_name: points_at_milestone} or None if not saved yet.
    """
    path = os.path.join(MILESTONE_SNAPSHOTS_DIR, f"milestone_m{after_match}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        data = json.load(f)
    return data.get("players", {})


def has_milestone_snapshot(after_match: int) -> bool:
    """Check if a milestone snapshot exists."""
    path = os.path.join(MILESTONE_SNAPSHOTS_DIR, f"milestone_m{after_match}.json")
    return os.path.exists(path)


def apply_replacements_to_owner_map(owner_map: dict, up_to_milestone: int = None) -> dict:
    """
    Apply all replacement drafts up to (and including) a given milestone
    to produce the current effective owner map.
    
    If up_to_milestone is None, applies ALL milestones.
    """
    draft = load_replacement_draft()
    milestones = sorted(draft.get("milestones", []), key=lambda m: m["after_match"])

    # Deep copy
    effective = {owner: list(players) for owner, players in owner_map.items()}

    for m in milestones:
        if up_to_milestone is not None and m["after_match"] > up_to_milestone:
            break
        replacements = m.get("replacements", {})
        for owner, changes in replacements.items():
            dropped = changes.get("dropped", [])
            picked = changes.get("picked", [])
            for p in dropped:
                if p in effective.get(owner, []):
                    effective[owner].remove(p)
            for p in picked:
                if p not in effective.get(owner, []):
                    effective[owner].append(p)

    return effective


def get_owner_for_player_at_match(player_name: str, match_num: int,
                                   original_owner_map: dict) -> str | None:
    """
    Determine which owner owns a player at a specific match number.
    Uses milestone boundaries to figure out transfers.
    """
    draft = load_replacement_draft()
    milestones = sorted(draft.get("milestones", []), key=lambda m: m["after_match"])

    # Start with original ownership
    current_map = {owner: list(players) for owner, players in original_owner_map.items()}

    for m in milestones:
        if match_num <= m["after_match"]:
            # Haven't reached this milestone yet
            break
        # Apply this milestone's replacements
        replacements = m.get("replacements", {})
        for owner, changes in replacements.items():
            for p in changes.get("dropped", []):
                if p in current_map.get(owner, []):
                    current_map[owner].remove(p)
            for p in changes.get("picked", []):
                if p not in current_map.get(owner, []):
                    current_map[owner].append(p)

    # Find the player's owner in the current state
    for owner, players in current_map.items():
        if player_name in players:
            return owner
    return None


def compute_milestone_adjusted_points(player_name: str, current_overall_pts: float,
                                       original_owner_map: dict) -> list:
    """
    Split a player's total points across milestone windows.
    
    Returns a list of dicts:
    [
      {"owner": "Barath", "phase": "M1-M25", "points": 70.0},
      {"owner": "Aravinth", "phase": "M26+", "points": 30.0},
    ]
    
    For players never owned before a milestone, pre-milestone points = 0 for new owner.
    """
    draft = load_replacement_draft()
    milestones = sorted(draft.get("milestones", []), key=lambda m: m["after_match"])
    
    if not milestones:
        # No milestones — all points go to original owner
        for owner, players in original_owner_map.items():
            if player_name in players:
                return [{"owner": owner, "phase": "all", "points": current_overall_pts}]
        return []

    result = []
    prev_pts = 0  # Points accounted for in previous phases

    # Track ownership through each phase
    current_map = {owner: list(players) for owner, players in original_owner_map.items()}

    for i, m in enumerate(milestones):
        after_match = m["after_match"]
        milestone_pts_snapshot = load_milestone_snapshot(after_match)

        # Find owner in this phase (before this milestone's replacements)
        phase_owner = None
        for owner, players in current_map.items():
            if player_name in players:
                phase_owner = owner
                break

        if milestone_pts_snapshot is not None:
            pts_at_milestone = milestone_pts_snapshot.get(player_name, 0)
        else:
            pts_at_milestone = current_overall_pts  # Fallback

        phase_pts = pts_at_milestone - prev_pts
        phase_label = f"M1-M{after_match}" if i == 0 else f"M{milestones[i-1]['after_match']+1}-M{after_match}"

        if phase_owner:
            result.append({
                "owner": phase_owner,
                "phase": phase_label,
                "points": phase_pts,
            })

        prev_pts = pts_at_milestone

        # Apply replacements for this milestone
        replacements = m.get("replacements", {})
        for owner, changes in replacements.items():
            for p in changes.get("dropped", []):
                if p in current_map.get(owner, []):
                    current_map[owner].remove(p)
            for p in changes.get("picked", []):
                if p not in current_map.get(owner, []):
                    current_map[owner].append(p)

    # Post-last-milestone phase
    last_milestone = milestones[-1]["after_match"]
    post_pts = current_overall_pts - prev_pts
    phase_label = f"M{last_milestone + 1}+"

    post_owner = None
    for owner, players in current_map.items():
        if player_name in players:
            post_owner = owner
            break

    if post_owner:
        result.append({
            "owner": post_owner,
            "phase": phase_label,
            "points": post_pts,
        })

    return result


def compute_owner_totals_with_milestones(api_players: list, original_owner_map: dict) -> dict:
    """
    Compute total points per owner accounting for milestone transfers.
    
    Returns: {owner_name: total_points}
    """
    api_lookup = {p["Name"]: p for p in api_players}
    owner_totals = {owner: 0.0 for owner in original_owner_map}

    # Collect ALL players across all phases (original + any picked)
    all_players = set()
    for players in original_owner_map.values():
        all_players.update(players)
    
    draft = load_replacement_draft()
    for m in draft.get("milestones", []):
        for owner, changes in m.get("replacements", {}).items():
            all_players.update(changes.get("picked", []))

    for player_name in all_players:
        api_p = api_lookup.get(player_name)
        if not api_p:
            continue
        current_pts = api_p.get("OverallPoints", 0)
        
        splits = compute_milestone_adjusted_points(
            player_name, current_pts, original_owner_map
        )
        for split in splits:
            owner = split["owner"]
            if owner in owner_totals:
                owner_totals[owner] += split["points"]

    return owner_totals
