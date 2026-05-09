# IPL Fantasy Pro — Automated Scoring & Analytics

A modular, milestone-aware fantasy scoring system for private IPL leagues. Features a Python-based scoring engine and a modern, serverless web frontend that any owner can use to track live points.

## 🚀 Web Frontend

The application now features a "serverless" frontend that runs entirely in the browser. It fetches live data from the IPL API via a CORS proxy and computes the milestone-adjusted leaderboard on the fly.

### Local Development
To run the web app locally:
```bash
# Start a local dev server
cd web
python3 -m http.server 8765
```
Open `http://localhost:8765` in your browser.

### Hosting (Vercel)
The app is designed to be hosted on Vercel for free:
1. Push the repository to GitHub.
2. Import the project into Vercel.
3. Vercel will automatically use `web/vercel.json` and host the CORS proxy in `web/api/proxy.js`.

## 🛠 Python CLI Quick Start

The Python engine remains the source of truth for generating snapshots and auditing.

```bash
# Activate the virtual environment
source venv/bin/activate

# 1. Update scores and export web data
python main.py --run

# 2. Check standings in terminal
python main.py --leaderboard

# 3. Verify data integrity
python main.py --test
```

## 🏗 How It Works

### Hybrid Architecture
- **Python Backend:** Handles heavy lifting, Excel ledger generation, and milestone snapshots.
- **JavaScript Engine (`web/assets/scoring.js`):** A full port of the scoring logic that runs in the browser. This allows users to "Refresh" for live points without needing a running server.
- **CORS Proxy (`web/api/proxy.js`):** A serverless function that bypasses browser restrictions to fetch live data from the IPL Fantasy API.

### Milestone-Based Replacements
At defined milestones (e.g., after Match 25), owners can drop and pick players.
- **Dropped players:** Points are frozen at the milestone cutoff.
- **Picked players:** Only post-milestone points count.
- **Transfers:** Points are automatically split between the old and new owners.

## 📊 Commands & Files

| Command | Description |
|---------|-------------|
| `python main.py --run` | Update scores and auto-export JSON for the web app |
| `python main.py --leaderboard` | Display current terminal standings |
| `python main.py --save-milestone <N>` | Save a frozen point snapshot at match N |
| `python main.py --export-web` | Manually update the JSON files in `web/data/` |
| `python test_milestone_scoring.py` | Run the 99-check replacement test suite |
| `python app_desktop.py` | Launch as a native desktop window (requires `pywebview`) |

### Key Files
- `web/index.html`: Main dashboard UI
- `web/assets/scoring.js`: The browser-based scoring engine
- `web/api/proxy.js`: Vercel serverless CORS proxy
- `owner_player_map.json`: Original draft mapping
- `replacement_draft.json`: Milestone replacement configuration
- `api_logs/milestone_snapshots/`: Frozen point data for replacements
