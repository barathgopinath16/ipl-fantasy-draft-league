# Project Requirements: IPL Fantasy Pro (Automated Scoring & Analytics)

## 1. Project Overview
A modular Python-based CLI application designed to automate the scoring and management of a private IPL fantasy league. The system integrates data from an external API, manages a strict draft-to-owner mapping, and maintains a comprehensive Excel ledger for tracking and visualization.

## 2. Technical Stack
- **Language:** Python 3.x
- **Storage:** Microsoft Excel (`.xlsx`) via `pandas` and `openpyxl`.
- **API Integration:** `requests` for fetching player performance.
- **Visuals:** `matplotlib` or `plotly` for progression graphing.
- **AI Integration:** Antigravity Agent-based call for data insights.

## 3. Data Architecture & Integrity Rules
### A. Draft Mapping (`owner_player_map.xlsx`)
- **Strict Ownership:** The system must validate that each player is assigned to exactly one owner.
- **Conflict Prevention:** If a player appears under multiple owners, the script must throw a `DraftIntegrityError` and stop execution.

### B. Ledger Structure (`ipl_fantasy_ledger.xlsx`)
The system must dynamically maintain the following sheets:
1. **Summary_Leaderboard:** (Owner, Total Points, Rank, Last Match Points).
2. **Global_Match_Ledger:** Every point entry for every player per match.
3. **Owner_Sheets:** Individual sheets for each owner (e.g., `Owner_Barath`) detailing their players' match-by-match performances.
4. **Fixture_Tracker:** A list of matches marked as `Completed` or `Pending`.

## 4. Functional Modules

### Module 1: `scoring_engine.py` (Hybrid Logic)
- **Pre-Match 16 Logic:** Points are ingested as bulk cumulative totals for the players.
- **Post-Match 16 Logic:** The system switches to granular tracking, recording individual points per player for *every* specific match.
- **Owner Aggregation:** Automatically sums player points to update the owner's total in the Summary sheet.

### Module 2: `fetcher.py` (Data Ingestion)
- Accesses the API endpoint to retrieve `overall_points` and `last_match_points`.
- Handles connection retries and logs API responses for audit trails.

### Module 3: `reconciliation.py` (The Tester)
- **Validation Script:** A standalone test suite that can be run via CLI.
- **Logic:** Cross-verifies:
    - `Individual Match Sum == Player Total`.
    - `Sum of Owner's Players == Owner Total`.
    - Detects if any manual edits to the Excel file have caused data drift.

### Module 4: `visualizer.py` (Analytics)
- **Progression Graph:** Generates a line chart showing the point trajectory of all owners.
- **Constraint:** Data points for the graph are plotted starting from Match 16 onwards.

## 5. Interface & Commands
The application must be executable via the following CLI patterns:

| Command | Description |
| :--- | :--- |
| `python main.py --compute <match_id>` | Fetches data, calculates points, and updates Excel. |
| `python main.py --leaderboard` | Displays the current standings in the terminal. |
| `python main.py --player <name>` | Displays a specific player's performance history. |
| `python main.py --test` | Runs the `reconciliation.py` script to verify data accuracy. |
| `python main.py --ai-insights` | Sends current ledger data to the Antigravity Agent for strategy analysis. |

## 6. AI Insights (Antigravity Integration)
Instead of a standard API call, this feature utilizes an **Antigravity-based Agent**.
- **Input:** Current leaderboard standings, player consistency data, and fixture history.
- **Output:** A natural language report detailing:
    - Best performing "Value Picks".
    - Luck vs. Strategy analysis for owners.
    - Performance trends for the upcoming matches.

## 7. Documentation & Delivery
Upon development completion, the following must be provided:
- **`README.md`**: Setup instructions
- **User Guide**: A walkthrough on how to mark a match as completed and generate the weekly leaderboard.