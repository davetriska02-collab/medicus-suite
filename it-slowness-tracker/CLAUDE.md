# IT Slowness Tracker

Static GitHub Pages web app for NHS GP practices (Cranleigh Surgery + Guildowns Group Practice) to record time lost to clinical IT slowness/freezes during working sessions.

## What this is

Staff open the app in a browser tab, set their session type / role / site, then press **Space** (or Ctrl+Shift+S) to start/stop a timer each time EMIS or Accurx freezes. At end of day they submit the session — it's stored as a closed GitHub Issue in this repo for later analysis.

## File structure

```
index.html       Single-page app, three screens: setup → active → submit
app.css          Dark theme, pulsing start/stop button, incident cards
app.js           ES module: state machine, keyboard shortcuts, timer, draft recovery
storage.js       ES module: submit to Worker or direct-PAT, offline queue
config.json      Sites, roles, session types — edit here to add surgeries
admin/
  index.html     Config preview + fallback PAT management (self-contained)
worker/
  worker.js      Cloudflare Worker: holds GitHub PAT, validates + stores sessions
  wrangler.toml  Worker config (deploy with `wrangler deploy`)
  README.md      Worker deployment instructions
analytics/
  fetch_sessions.py   Pulls all sessions from Issues → sessions.csv + incidents.csv
  requirements.txt
  README.md      Pandas/Excel analysis instructions
```

## Key design decisions

- **No build step** — plain HTML/CSS/JS, no bundler, no framework
- **Data stored as GitHub Issues** — one closed issue per session, labelled `session`, `site:X`, `role:X`, `sessiontype:X`
- **Cloudflare Worker proxy** — the GitHub PAT lives in Worker secrets, never in the browser
- **Offline queue** — failed submits are saved to localStorage and retried on next session

## Data schema (session JSON stored in issue body)

```json
{
  "schemaVersion": 1,
  "sessionId": "2026-05-20T08:14:03.221Z-7f3a",
  "site": "cranleigh",
  "siteLabel": "Cranleigh Surgery",
  "role": "gp",
  "sessionType": "duty",
  "startedAt": "...",
  "endedAt": "...",
  "incidentCount": 4,
  "totalLostSeconds": 187,
  "narrative": "EMIS slow all morning",
  "incidents": [
    { "id": 1, "startedAt": "...", "endedAt": "...", "durationSeconds": 45, "note": "loading patient" }
  ]
}
```

## config.json — how to customise

To add a surgery, append to `sites`:
```json
{ "id": "newsite", "label": "New Surgery Name" }
```

To switch from Worker mode to fallback PAT mode (if Worker not deployed yet):
```json
"storageMode": "direct-pat"
```

## Cloudflare Worker

The Worker lives in `worker/worker.js` and is deployed separately via Wrangler.
- Issues are written to: `davetriska02-collab/circle-of-death-tracker`
- CORS origin: `https://davetriska02-collab.github.io`
- PAT required scope: Issues read+write on this repo only (fine-grained)
- To rotate the PAT: `wrangler secret put GITHUB_TOKEN` (no redeploy needed)

## GitHub Pages

Enable in repo Settings → Pages → Source: main branch, / (root).
Public URL: `https://davetriska02-collab.github.io/circle-of-death-tracker/`

## Running analytics

```bash
cd analytics
pip install -r requirements.txt
python fetch_sessions.py --token <PAT> --since 2026-05-01 --out ./out/
```
Produces `out/sessions.csv` and `out/incidents.csv` ready for Excel pivot tables.

## No PII

The app and Worker actively reject narratives containing NHS numbers or the phrase "NHS number". Do not add patient identifier fields.
