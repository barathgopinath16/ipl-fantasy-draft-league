"""
fetcher.py — Data Ingestion from IPL Fantasy API
=================================================
Fetches player performance data and fixture list.
Handles retries and logs raw API responses for audit.
"""

import json
import os
import ssl
import urllib.request
from datetime import datetime

from config import API_BASE, API_HEADERS, API_LOG_DIR


# SSL context for macOS
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


class APIFetchError(Exception):
    """Raised when the API call fails after retries."""
    pass


def _fetch_json(url: str, retries: int = 3) -> dict:
    """Fetch JSON from a URL with retries."""
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=API_HEADERS)
            with urllib.request.urlopen(req, context=_SSL_CTX, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                if data.get("Meta", {}).get("Success") is False:
                    retval = data.get("Meta", {}).get("RetVal")
                    raise APIFetchError(f"API returned error (RetVal={retval}): {data['Meta'].get('Message')}")
                return data
        except APIFetchError:
            raise
        except Exception as e:
            last_error = e
            if attempt < retries:
                print(f"  ⚠️  Attempt {attempt}/{retries} failed: {e}. Retrying...")
    raise APIFetchError(f"API call failed after {retries} attempts: {last_error}")


def _log_response(label: str, data: dict):
    """Save API response to the audit log directory."""
    os.makedirs(API_LOG_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(API_LOG_DIR, f"{ts}_{label}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def fetch_live_config() -> dict:
    """
    GET /live/mixapi — returns current gameday info.
    Returns dict with keys: LastGamedayId, VersionMaster, etc.
    """
    url = f"{API_BASE}/live/mixapi?lang=en"
    data = _fetch_json(url)
    _log_response("mixapi", data)
    return data["Data"]["Value"]


def fetch_fixtures() -> list:
    """
    GET /feed/tour-fixtures — returns all 70 match fixtures.
    Each fixture has: Gameday, HomeTeamName, AwayTeamName, Matchdate,
    MatchStatus (2=completed, 0=upcoming), MatchResult, etc.
    """
    url = f"{API_BASE}/feed/tour-fixtures?lang=en"
    data = _fetch_json(url)
    _log_response("fixtures", data)
    return data["Data"]["Value"]


def fetch_all_players(gameday_id: int = None) -> list:
    """
    GET /feed/gamedayplayers — returns all ~256 players.
    Each player has: Id, Name, TeamShortName, SkillName, Value,
    OverallPoints, GamedayPoints, etc.

    IMPORTANT: Must always pin to a specific gameday ID.
    Without it, the API returns multi-season cumulative points.

    Args:
        gameday_id: The gameday ID to fetch for.
                    If None, auto-resolves to the latest completed gameday.
    """
    config = fetch_live_config()

    if gameday_id is None:
        # Resolve the latest completed gameday from fixtures
        gameday_id = _resolve_latest_gameday()

    url = (
        f"{API_BASE}/feed/gamedayplayers?lang=en"
        f"&tourgamedayId={gameday_id}"
        f"&teamgamedayId={gameday_id}"
    )
    version = config.get("VersionMaster")
    if version:
        url += f"&announcedVersion={version}"

    data = _fetch_json(url)
    _log_response(f"players_gd{gameday_id}", data)
    print(f"   (pinned to GD{gameday_id})")
    return data["Data"]["Value"]["Players"]


def _resolve_latest_gameday() -> int:
    """Find the latest completed gameday from the fixtures API."""
    fixtures = fetch_fixtures()
    completed = [f.get("Gameday") for f in fixtures if f.get("MatchStatus") == 2]
    if completed:
        return max(completed)
    return 1  # fallback


if __name__ == "__main__":
    print("🏏 IPL Fantasy API — Quick Test")
    print("=" * 50)

    config = fetch_live_config()
    print(f"  LastGamedayId : {config.get('LastGamedayId')}")
    print(f"  VersionMaster : {config.get('VersionMaster')}")

    fixtures = fetch_fixtures()
    completed = [f for f in fixtures if f.get("MatchStatus") == 2]
    print(f"  Fixtures      : {len(fixtures)} total, {len(completed)} completed")

    players = fetch_all_players()
    print(f"  Players       : {len(players)}")

    top3 = sorted(players, key=lambda p: p.get("OverallPoints", 0), reverse=True)[:3]
    for p in top3:
        print(f"    {p['Name']:<25} {p['OverallPoints']} pts")

    print("\n✅ All endpoints working!")
