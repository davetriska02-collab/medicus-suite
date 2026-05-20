# IT Slowness Tracker — Analytics

Scripts to pull session data from the GitHub Issues store and produce flat CSV files for analysis.

---

## 1. Setup

```bash
pip install -r requirements.txt
```

Python 3.8 or newer is required. The script itself uses only the standard library (`argparse`, `csv`, `json`, `os`, `re`, `urllib`); `requests` is listed in `requirements.txt` for any future extensions but is not used by `fetch_sessions.py` directly.

---

## 2. Create a Personal Access Token (PAT)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Set **Resource owner** to `davetriska02-collab`.
3. Under **Repository access**, select only `davetriska02-collab/medicus-suite`.
4. Under **Permissions → Repository permissions → Issues**, choose **Read-only**.
5. Generate and copy the token. Store it in a password manager; rotate quarterly.

---

## 3. Run

Fetch all sessions ever recorded:

```bash
python fetch_sessions.py --token ghp_YOURTOKEN
```

Fetch only sessions updated since a specific date (useful for incremental runs):

```bash
python fetch_sessions.py --token ghp_YOURTOKEN --since 2026-04-01
```

Write output to a custom directory:

```bash
python fetch_sessions.py --token ghp_YOURTOKEN --since 2026-01-01 --out ./data/
```

The script prints a summary when done:

```
Fetching closed issues labelled 'session' from davetriska02-collab/medicus-suite ...
  Fetched 143 issue(s).

Done.
  Issues fetched : 143
  Sessions parsed: 142  (1 skipped due to errors)
  Incidents total: 1 047
  Sessions CSV   : /path/to/out/sessions.csv
  Incidents CSV  : /path/to/out/incidents.csv
```

---

## 4. Output files

### `sessions.csv`

One row per submitted session.

| Column | Description |
|---|---|
| `session_id` | Unique session ID (ISO timestamp + random suffix) |
| `site` / `site_label` | Site code and display name |
| `role` / `role_label` | Role code and display name |
| `session_type` / `session_type_label` | Session type code and display name |
| `started_at` / `ended_at` | ISO 8601 UTC timestamps |
| `wall_clock_seconds` | Total elapsed clock time for the session |
| `incident_count` | Number of IT slowness incidents logged |
| `total_lost_seconds` | Sum of all incident durations |
| `narrative` | Free-text notes added by the user at submission |
| `app_version` | Version of the tracker app used |
| `tz` | User's reported timezone (e.g. `Europe/London`) |
| `user_agent_short` | First 80 characters of the browser user-agent string |

### `incidents.csv`

One row per individual IT incident inside a session.

| Column | Description |
|---|---|
| `session_id` | Foreign key back to `sessions.csv` |
| `incident_id` | Sequential integer within the session |
| `started_at` / `ended_at` | ISO 8601 UTC timestamps for this incident |
| `duration_seconds` | Length of the incident |
| `note` | Optional note describing what was slow |

---

## 5. Pandas analysis snippets

Install pandas and openpyxl if needed:

```bash
pip install pandas openpyxl
```

### Lost time by site and hour of day (pivot table)

```python
import pandas as pd

sessions = pd.read_csv('out/sessions.csv', parse_dates=['started_at'])
sessions['hour'] = sessions['started_at'].dt.hour

pivot = sessions.pivot_table(
    values='total_lost_seconds',
    index='site_label',
    columns='hour',
    aggfunc='sum',
    fill_value=0
)
print(pivot)
```

### Daily incident count per role

```python
import pandas as pd

sessions = pd.read_csv('out/sessions.csv', parse_dates=['started_at'])
sessions['date'] = sessions['started_at'].dt.date

daily = (
    sessions
    .groupby(['date', 'role_label'])['incident_count']
    .sum()
    .reset_index()
    .sort_values(['date', 'role_label'])
)
print(daily.to_string(index=False))
```

### Top 10 longest individual incidents

```python
import pandas as pd

incidents = pd.read_csv('out/incidents.csv')

top10 = (
    incidents
    .nlargest(10, 'duration_seconds')
    [['session_id', 'incident_id', 'duration_seconds', 'note']]
    .reset_index(drop=True)
)
print(top10.to_string())
```

---

## 6. Open in Excel

1. Open Excel, choose **File → Open**, and select `sessions.csv` or `incidents.csv`.
2. Excel will import it as a plain table.
3. Click anywhere in the data, then choose **Insert → PivotTable**.
4. For a lost-time-by-site summary: drag `site_label` to **Rows**, `total_lost_seconds` to **Values** (set to *Sum*).
5. For a date-range filter: drag `started_at` to **Filters** and use the date slicer.
