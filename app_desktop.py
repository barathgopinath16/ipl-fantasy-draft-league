"""
app_desktop.py — IPL Fantasy Pro Desktop App
=============================================
Run this to launch the app as a native desktop window.
The FE can trigger Python actions directly via pywebview's JS bridge.

Usage:
    source venv/bin/activate
    python app_desktop.py
"""

import os
import sys
import json
import threading
import webview

# Ensure imports resolve from this directory
sys.path.insert(0, os.path.dirname(__file__))

from export_web_data import run_export


class Api:
    """
    All methods here are callable from JavaScript via window.pywebview.api.*
    Each method runs synchronously (pywebview handles threading).
    """

    def run_update(self):
        """Fetch live data, update ledger, export web data."""
        try:
            from fetcher import fetch_all_players, fetch_fixtures
            from scoring_engine import (
                load_owner_map, init_ledger, populate_fixtures,
                ingest_bulk, ingest_update,
            )
            from datetime import datetime
            import json as _json

            SNAPSHOT_FILE = os.path.join(os.path.dirname(__file__), "api_logs", "latest_snapshot.json")

            owner_map = load_owner_map()
            fixtures = fetch_fixtures()
            api_players = fetch_all_players()

            # Load previous snapshot
            prev = None
            if os.path.exists(SNAPSHOT_FILE):
                with open(SNAPSHOT_FILE) as f:
                    data = _json.load(f)
                prev = data if isinstance(data, dict) else {"players": data}

            wb = init_ledger()
            populate_fixtures(wb, fixtures)

            if prev is None:
                ingest_bulk(wb, api_players, owner_map)
                label = "baseline"
            else:
                prev_players = prev["players"]
                curr_lookup = {p["Name"]: p.get("OverallPoints", 0) for p in api_players}
                prev_lookup = {p["Name"]: p.get("OverallPoints", 0) for p in prev_players}
                total_delta = sum(curr_lookup.get(n, 0) - prev_lookup.get(n, 0) for n in curr_lookup)

                label = datetime.now().strftime("%d-%b")
                if total_delta != 0:
                    ingest_update(wb, label, api_players, prev_players, owner_map, fixtures)
                else:
                    from config import LEDGER_FILE
                    wb.save(LEDGER_FILE)

            # Save snapshot
            os.makedirs(os.path.join(os.path.dirname(__file__), "api_logs"), exist_ok=True)
            with open(SNAPSHOT_FILE, "w") as f:
                _json.dump({
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
                    "players": api_players,
                }, f)

            run_export()
            return {"ok": True, "message": f"Updated ({len(api_players)} players fetched)"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def save_milestone(self, match_num):
        """Freeze player points at the given milestone match."""
        try:
            from replacement_manager import save_milestone_snapshot, has_milestone_snapshot
            import json as _json

            SNAPSHOT_FILE = os.path.join(os.path.dirname(__file__), "api_logs", "latest_snapshot.json")
            if not os.path.exists(SNAPSHOT_FILE):
                return {"ok": False, "message": "No snapshot found. Fetch live data first."}

            with open(SNAPSHOT_FILE) as f:
                data = _json.load(f)
            api_players = data.get("players", data) if isinstance(data, dict) else data
            save_milestone_snapshot(int(match_num), api_players)
            run_export()
            return {"ok": True, "message": f"Milestone snapshot saved for M{match_num}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def save_replacement_config(self, json_text):
        """Write updated replacement_draft.json from the FE editor."""
        try:
            from config import REPLACEMENT_DRAFT_JSON
            parsed = json.loads(json_text)
            with open(REPLACEMENT_DRAFT_JSON, "w") as f:
                json.dump(parsed, f, indent=2)
            run_export()
            return {"ok": True, "message": "replacement_draft.json saved and data refreshed"}
        except json.JSONDecodeError as e:
            return {"ok": False, "message": f"Invalid JSON: {e}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def export_web(self):
        """Re-export web data from existing ledger without API call."""
        try:
            run_export()
            return {"ok": True, "message": "Web data exported"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def run_tests(self):
        """Run the full milestone test suite."""
        try:
            import io
            from contextlib import redirect_stdout
            from test_milestone_scoring import run_all_tests

            buf = io.StringIO()
            with redirect_stdout(buf):
                run_all_tests()
            return {"ok": True, "output": buf.getvalue()}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def get_snapshot_info(self):
        """Return current snapshot timestamp and gameday."""
        try:
            SNAPSHOT_FILE = os.path.join(os.path.dirname(__file__), "api_logs", "latest_snapshot.json")
            if not os.path.exists(SNAPSHOT_FILE):
                return {"exists": False}
            with open(SNAPSHOT_FILE) as f:
                data = json.load(f)
            players = data.get("players", [])
            return {
                "exists": True,
                "timestamp": data.get("timestamp", "unknown"),
                "player_count": len(players),
            }
        except Exception as e:
            return {"exists": False, "error": str(e)}


def main():
    web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

    # Pre-export data if ledger exists
    try:
        run_export()
    except Exception:
        pass  # OK if ledger doesn't exist yet

    api = Api()
    window = webview.create_window(
        "IPL Fantasy Pro",
        url=os.path.join(web_dir, "index.html"),
        js_api=api,
        width=1280,
        height=820,
        min_size=(900, 600),
        background_color="#0d0f14",
    )
    webview.start(debug=False)


if __name__ == "__main__":
    main()
