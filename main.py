#!/usr/bin/env python3
"""
main.py — IPL Fantasy Pro CLI
==============================
Usage:
  python main.py --run                  Fetch latest stats, compute deltas, update ledger
  python main.py --leaderboard          Display current standings
  python main.py --player <name>        Show a player's performance history
  python main.py --test                 Run reconciliation checks
  python main.py --plot                 Generate owner progression chart
  python main.py --reset                Wipe all data and re-run from scratch
  python main.py --save-milestone <N>   Save milestone snapshot after match N
  python main.py --show-replacements    Display current replacement draft config
  python main.py --help                 Show this message
"""

import sys
import json
import os
from datetime import datetime

from config import LEDGER_FILE, API_LOG_DIR

SNAPSHOT_FILE = os.path.join(API_LOG_DIR, "latest_snapshot.json")


def cmd_run():
    """
    Fetch the latest player data from the API and update the ledger.
      - First run (no snapshot): saves current data as the baseline.
      - Subsequent runs: computes delta from last snapshot and records it.
    """
    from fetcher import fetch_all_players, fetch_fixtures
    from scoring_engine import (
        load_owner_map, init_ledger, populate_fixtures,
        ingest_bulk, ingest_update,
    )
    from export_web_data import run_export

    owner_map = load_owner_map()

    # Fetch latest data
    print("📡 Fetching fixtures...")
    fixtures = fetch_fixtures()
    completed = [f for f in fixtures if f.get("MatchStatus") == 2]
    print(f"   {len(completed)}/{len(fixtures)} matches completed")

    print("📡 Fetching latest player data...")
    api_players = fetch_all_players()
    print(f"   {len(api_players)} players fetched")

    # Check if we have a previous snapshot
    prev = _load_snapshot()

    if prev is None:
        # ── First run: bulk ingest ──
        print(f"\n📥 First run — ingesting current cumulative points as baseline...")
        wb = init_ledger()
        populate_fixtures(wb, fixtures)
        ingest_bulk(wb, api_players, owner_map)
        _save_snapshot(api_players)
        print(f"   📸 Snapshot saved at {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        _show_leaderboard(wb)

    else:
        # ── Subsequent run: compute delta ──
        prev_players = prev["players"]
        prev_time = prev.get("timestamp", "unknown")
        label = datetime.now().strftime("%d-%b")  # e.g. "14-Apr"

        wb = init_ledger()  # loads existing
        populate_fixtures(wb, fixtures)

        # Check if there's any change
        curr_lookup = {p["Name"]: p.get("OverallPoints", 0) for p in api_players}
        prev_lookup = {p["Name"]: p.get("OverallPoints", 0) for p in prev_players}

        total_delta = sum(
            curr_lookup.get(n, 0) - prev_lookup.get(n, 0)
            for n in curr_lookup
        )

        if total_delta == 0:
            wb.save(LEDGER_FILE)
            print(f"\n✅ No point changes since last run ({prev_time}). Fixtures updated.")
            _show_leaderboard(wb)
            run_export()
            return

        print(f"\n📥 Changes detected since {prev_time} (total delta: {total_delta:.0f} pts)")
        print(f"   Recording as '{label}'...")

        ingest_update(wb, label, api_players, prev_players, owner_map, fixtures)
        _save_snapshot(api_players)
        print(f"   📸 Snapshot updated at {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        _show_leaderboard(wb)

    run_export()


def cmd_leaderboard():
    """Display the current leaderboard."""
    import openpyxl

    try:
        wb = openpyxl.load_workbook(LEDGER_FILE, data_only=True)
    except FileNotFoundError:
        print("❌ Ledger not found. Run '--run' first.")
        return

    _show_leaderboard(wb)


def cmd_player(player_name: str):
    """Show a specific player's match history."""
    import openpyxl
    from scoring_engine import load_owner_map, get_player_history

    try:
        wb = openpyxl.load_workbook(LEDGER_FILE, data_only=True)
    except FileNotFoundError:
        print("❌ Ledger not found. Run '--run' first.")
        return

    owner_map = load_owner_map()
    history = get_player_history(wb, player_name, owner_map)

    if "error" in history:
        print(f"❌ {history['error']}")
        return

    print(f"\n{'=' * 50}")
    print(f"🏏 {history['name']} ({history['team']} — {history['role']})")
    print(f"   Owner: {history['owner']}")
    print(f"{'=' * 50}")

    total = 0
    for match, pts in history["matches"].items():
        if isinstance(pts, (int, float)):
            total += pts
            print(f"   {match:<20} {pts:>8.1f}")
        else:
            print(f"   {match:<20} {pts}")

    print(f"   {'─' * 30}")
    print(f"   {'TOTAL':<20} {total:>8.1f}")
    print(f"{'=' * 50}")


def cmd_test():
    """Run reconciliation tests."""
    from reconciliation import run_tests
    run_tests()


def cmd_plot():
    """Generate progression chart."""
    from visualizer import generate_progression
    generate_progression()


def cmd_export_web():
    """Export data JSONs for the web app without fetching new data."""
    from export_web_data import run_export
    run_export()

def cmd_save_milestone(match_num: int):
    """
    Save a milestone snapshot — freeze player points at the given match boundary.
    Uses the existing latest_snapshot.json (does NOT make a new API call).
    """
    from replacement_manager import (
        save_milestone_snapshot, has_milestone_snapshot, get_milestone_config
    )

    # Validate milestone exists in config
    config = get_milestone_config(match_num)
    if config is None:
        print(f"⚠️  No milestone configured for after_match={match_num} in replacement_draft.json")
        print(f"   Proceeding anyway to save snapshot...")

    if has_milestone_snapshot(match_num):
        print(f"⚠️  Milestone snapshot for M{match_num} already exists!")
        resp = input("   Overwrite? (y/N): ").strip().lower()
        if resp != 'y':
            print("   Cancelled.")
            return

    # Load from existing snapshot (no API call)
    snapshot = _load_snapshot()
    if snapshot is None:
        print("❌ No latest_snapshot.json found. Run '--run' first to fetch data.")
        return

    api_players = snapshot["players"]
    snapshot_time = snapshot.get("timestamp", "unknown")

    # Verify the snapshot gameday matches
    gameday_ids = set(p.get("PlyrGamedayId") for p in api_players)
    print(f"   Snapshot timestamp: {snapshot_time}")
    print(f"   Snapshot gameday(s): {gameday_ids}")

    save_milestone_snapshot(match_num, api_players)
    print(f"\n✅ Milestone snapshot saved for M{match_num}")
    print(f"   Points frozen from this snapshot will separate pre/post M{match_num} scoring.")


def cmd_show_replacements():
    """Display the current replacement draft configuration."""
    from replacement_manager import (
        load_replacement_draft, has_milestone_snapshot
    )

    draft = load_replacement_draft()
    milestones = draft.get("milestones", [])

    if not milestones:
        print("📋 No milestones configured in replacement_draft.json")
        return

    print(f"\n{'=' * 65}")
    print(f"🔄 REPLACEMENT DRAFT CONFIG")
    print(f"{'=' * 65}")

    for m in sorted(milestones, key=lambda x: x["after_match"]):
        after = m["after_match"]
        has_snap = has_milestone_snapshot(after)
        snap_icon = "✅" if has_snap else "❌"
        print(f"\n📌 Milestone: After Match {after}  [Snapshot: {snap_icon}]")
        print(f"{'─' * 55}")

        for owner, changes in m.get("replacements", {}).items():
            dropped = changes.get("dropped", [])
            picked = changes.get("picked", [])

            # Check if it's a no-op (same players)
            if dropped == picked:
                print(f"   {owner:12s} → No changes (same players retained)")
            else:
                for d, p in zip(dropped, picked):
                    if d == p:
                        print(f"   {owner:12s} → Retained: {d}")
                    else:
                        print(f"   {owner:12s} → DROP: {d:25s} → PICK: {p}")

    print(f"\n{'=' * 65}")


def cmd_reset():
    """Wipe all generated data and re-run from scratch."""
    import shutil

    print("🔄 RESETTING IPL Fantasy Pro...")

    if os.path.exists(LEDGER_FILE):
        os.remove(LEDGER_FILE)
        print(f"  🗑️  Deleted {os.path.basename(LEDGER_FILE)}")

    if os.path.exists(API_LOG_DIR):
        shutil.rmtree(API_LOG_DIR)
        print(f"  🗑️  Deleted {os.path.basename(API_LOG_DIR)}/")

    chart = os.path.join(os.path.dirname(LEDGER_FILE), "owner_progression.png")
    if os.path.exists(chart):
        os.remove(chart)
        print(f"  🗑️  Deleted owner_progression.png")

    print("\n✅ Reset complete. Now re-running...\n")
    cmd_run()


# ── Helpers ──

def _show_leaderboard(wb):
    from scoring_engine import get_leaderboard

    rows = get_leaderboard(wb)
    if not rows:
        print("❌ Leaderboard is empty.")
        return

    print(f"\n{'=' * 58}")
    print(f"🏆 IPL FANTASY — OWNER LEADERBOARD")
    print(f"{'=' * 58}")
    print(f"{'#':<4} {'Owner':<12} {'Total':>10} {'Last Update':>12} {'Players':>8}")
    print(f"{'─' * 58}")
    for r in rows:
        rank_icon = "🥇" if r["Rank"] == 1 else "🥈" if r["Rank"] == 2 else "🥉" if r["Rank"] == 3 else f" {r['Rank']}"
        total = r["Total Points"] or 0
        last = r["Last Match Points"] or 0
        print(f"{rank_icon:<4} {r['Owner']:<12} {total:>10.1f} {last:>12.1f} {r['# Players']:>8}")
    print(f"{'=' * 58}")


def _save_snapshot(players: list):
    os.makedirs(API_LOG_DIR, exist_ok=True)
    with open(SNAPSHOT_FILE, "w") as f:
        json.dump({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "players": players,
        }, f)


def _load_snapshot() -> dict | None:
    if not os.path.exists(SNAPSHOT_FILE):
        return None
    with open(SNAPSHOT_FILE, "r") as f:
        data = json.load(f)
    # Handle old format (raw list)
    if isinstance(data, list):
        return {"timestamp": "unknown", "players": data}
    return data


def print_help():
    print(__doc__)


def main():
    args = sys.argv[1:]

    if not args or "--help" in args:
        print_help()
        return

    cmd_map = {
        "--run": cmd_run,
        "--leaderboard": cmd_leaderboard,
        "--test": cmd_test,
        "--plot": cmd_plot,
        "--reset": cmd_reset,
        "--show-replacements": cmd_show_replacements,
        "--export-web": cmd_export_web,
    }

    if args[0] == "--player":
        if len(args) < 2:
            print("❌ Usage: python main.py --player <player_name>")
            return
        cmd_player(" ".join(args[1:]))
    elif args[0] == "--save-milestone":
        if len(args) < 2:
            print("❌ Usage: python main.py --save-milestone <match_number>")
            return
        try:
            match_num = int(args[1])
        except ValueError:
            print(f"❌ Invalid match number: {args[1]}")
            return
        cmd_save_milestone(match_num)
    elif args[0] in cmd_map:
        cmd_map[args[0]]()
    else:
        print(f"❌ Unknown command: {args[0]}")
        print_help()


if __name__ == "__main__":
    main()
