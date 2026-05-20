"""
fetch_sessions.py — Download IT Slowness Tracker sessions from GitHub Issues and
write two CSV files: sessions.csv and incidents.csv.

Usage:
    python fetch_sessions.py --token <PAT> [--since YYYY-MM-DD] [--out ./out/]
"""

import argparse
import csv
import json
import os
import re
import sys
import urllib.request
import urllib.parse
import urllib.error

REPO = "davetriska02-collab/medicus-suite"
API_BASE = "https://api.github.com"
JSON_BLOCK_RE = re.compile(r'```json\s*(.*?)\s*```', re.DOTALL)

SESSION_FIELDS = [
    "session_id",
    "site",
    "site_label",
    "role",
    "role_label",
    "session_type",
    "session_type_label",
    "started_at",
    "ended_at",
    "wall_clock_seconds",
    "incident_count",
    "total_lost_seconds",
    "narrative",
    "app_version",
    "tz",
    "user_agent_short",
]

INCIDENT_FIELDS = [
    "session_id",
    "incident_id",
    "started_at",
    "ended_at",
    "duration_seconds",
    "note",
]


def build_headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "Accept": "application/vnd.github+json",
        "User-Agent": "it-slowness-tracker-analytics/1.0",
    }


def parse_link_header(link_header):
    """Return the URL for rel="next" from a GitHub Link header, or None."""
    if not link_header:
        return None
    for part in link_header.split(","):
        url_part, *params = [p.strip() for p in part.split(";")]
        for param in params:
            if param.strip() == 'rel="next"':
                # url_part looks like <https://...>
                return url_part.strip("<>")
    return None


def fetch_all_issues(token, since=None):
    """Paginate through all closed issues with label 'session'. Returns a list of issue dicts."""
    params = {
        "state": "closed",
        "labels": "session",
        "per_page": "100",
    }
    if since:
        params["since"] = f"{since}T00:00:00Z"

    url = f"{API_BASE}/repos/{REPO}/issues?{urllib.parse.urlencode(params)}"
    headers = build_headers(token)
    all_issues = []

    while url:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                body = resp.read().decode("utf-8")
                issues = json.loads(body)
                all_issues.extend(issues)
                link_header = resp.headers.get("Link", "")
                url = parse_link_header(link_header)
        except urllib.error.HTTPError as exc:
            print(f"ERROR: GitHub API returned HTTP {exc.code}: {exc.reason}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            print(f"ERROR: Network error: {exc.reason}", file=sys.stderr)
            sys.exit(1)

    return all_issues


def extract_session_json(issue):
    """
    Find the first ```json ... ``` block in the issue body and parse it.
    Returns the parsed dict, or raises ValueError if not found / invalid JSON.
    """
    body = issue.get("body") or ""
    match = JSON_BLOCK_RE.search(body)
    if not match:
        raise ValueError("No ```json``` block found in issue body")
    return json.loads(match.group(1))


def build_session_row(data):
    client = data.get("client") or {}
    user_agent = client.get("userAgent", "")
    return {
        "session_id":            data.get("sessionId", ""),
        "site":                  data.get("site", ""),
        "site_label":            data.get("siteLabel", ""),
        "role":                  data.get("role", ""),
        "role_label":            data.get("roleLabel", ""),
        "session_type":          data.get("sessionType", ""),
        "session_type_label":    data.get("sessionTypeLabel", ""),
        "started_at":            data.get("startedAt", ""),
        "ended_at":              data.get("endedAt", ""),
        "wall_clock_seconds":    data.get("wallClockSeconds", ""),
        "incident_count":        data.get("incidentCount", ""),
        "total_lost_seconds":    data.get("totalLostSeconds", ""),
        "narrative":             data.get("narrative", ""),
        "app_version":           client.get("appVersion", ""),
        "tz":                    client.get("tz", ""),
        "user_agent_short":      user_agent[:80],
    }


def build_incident_rows(session_id, data):
    rows = []
    for incident in data.get("incidents") or []:
        rows.append({
            "session_id":        session_id,
            "incident_id":       incident.get("id", ""),
            "started_at":        incident.get("startedAt", ""),
            "ended_at":          incident.get("endedAt", ""),
            "duration_seconds":  incident.get("durationSeconds", ""),
            "note":              incident.get("note", ""),
        })
    return rows


def write_csv(path, fieldnames, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description="Download IT Slowness Tracker sessions from GitHub Issues into CSV files."
    )
    parser.add_argument(
        "--token",
        required=True,
        metavar="PAT",
        help="GitHub Personal Access Token with Issues: Read scope on davetriska02-collab/medicus-suite",
    )
    parser.add_argument(
        "--since",
        metavar="YYYY-MM-DD",
        default=None,
        help="Only fetch issues updated on or after this ISO date (optional)",
    )
    parser.add_argument(
        "--out",
        metavar="DIR",
        default="./out/",
        help="Output directory for CSV files (default: ./out/)",
    )
    args = parser.parse_args()

    # Validate --since if provided
    if args.since:
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', args.since):
            parser.error("--since must be in YYYY-MM-DD format")

    # Create output directory if needed
    os.makedirs(args.out, exist_ok=True)

    print(f"Fetching closed issues labelled 'session' from {REPO} ...")
    if args.since:
        print(f"  Filtering: updated since {args.since}")

    issues = fetch_all_issues(args.token, since=args.since)
    total_fetched = len(issues)
    print(f"  Fetched {total_fetched} issue(s).")

    session_rows = []
    incident_rows = []
    parse_errors = 0

    for issue in issues:
        issue_number = issue.get("number", "?")
        try:
            data = extract_session_json(issue)
        except (ValueError, json.JSONDecodeError) as exc:
            print(f"  WARNING: Skipping issue #{issue_number} — could not parse JSON block: {exc}")
            parse_errors += 1
            continue

        session_row = build_session_row(data)
        session_rows.append(session_row)
        incident_rows.extend(build_incident_rows(session_row["session_id"], data))

    sessions_path = os.path.join(args.out, "sessions.csv")
    incidents_path = os.path.join(args.out, "incidents.csv")

    write_csv(sessions_path, SESSION_FIELDS, session_rows)
    write_csv(incidents_path, INCIDENT_FIELDS, incident_rows)

    total_parsed = total_fetched - parse_errors
    print()
    print(f"Done.")
    print(f"  Issues fetched : {total_fetched}")
    print(f"  Sessions parsed: {total_parsed}  ({parse_errors} skipped due to errors)")
    print(f"  Incidents total: {len(incident_rows)}")
    print(f"  Sessions CSV   : {os.path.abspath(sessions_path)}")
    print(f"  Incidents CSV  : {os.path.abspath(incidents_path)}")


if __name__ == "__main__":
    main()
