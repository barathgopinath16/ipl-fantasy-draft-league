# IPL Fantasy Pro — Configuration
# ================================

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Files ──
OWNER_MAP_JSON = os.path.join(BASE_DIR, "owner_player_map.json")
OWNER_MAP_XLSX = os.path.join(BASE_DIR, "owner_player_map.xlsx")
REPLACEMENT_DRAFT_JSON = os.path.join(BASE_DIR, "replacement_draft.json")
LEDGER_FILE = os.path.join(BASE_DIR, "ipl_fantasy_ledger.xlsx")
API_LOG_DIR = os.path.join(BASE_DIR, "api_logs")
MILESTONE_SNAPSHOTS_DIR = os.path.join(API_LOG_DIR, "milestone_snapshots")

# ── API ──
API_BASE = "https://fantasy.iplt20.com/classic/api"
API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "entity": "d3tR0!t5m@sh",
    "Referer": "https://fantasy.iplt20.com/classic/stats",
}

# ── Sheet Names ──
SHEET_LEADERBOARD = "Summary_Leaderboard"
SHEET_GLOBAL_LEDGER = "Global_Match_Ledger"
SHEET_FIXTURES = "Fixture_Tracker"
OWNER_SHEET_PREFIX = "Owner_"

# ── Scoring Constants ──
BULK_CUTOFF_MATCH = 19  # Matches ≤ this are bulk-ingested, > this are granular
