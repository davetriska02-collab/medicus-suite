<p align="center">
  <img src="brand/app-icon.png" alt="Medicus Suite" width="112" />
</p>

# Medicus Suite

Chrome extension toolkit for GP practices using the Medicus clinical system.
Bundles slot counter, capacity forecast, submissions tracker, clinical
monitoring (Sentinel), activity report, referrals tracker, trend charts,
Condor operational dashboard, reception pathways, pre-clinic sweep, practice
knowledge base, patient record visualiser, triage lens, and triage request
monitor into one extension that reads the user's logged-in Medicus session.

Built by Dr Dave Triska (Witley & Milford Surgery). Not affiliated with
Medicus the company.

For *why* the suite is built this way — the read-only on-top-of-Medicus
augmentation model and a grounded "first-of-type" positioning, including its
honest limits — see [`docs/VISION.md`](docs/VISION.md).

## Installation

1. Download the latest `medicus-suite-vX.Y.Z.zip` from the
   [releases page](https://github.com/davetriska02-collab/medicus-suite/releases/latest).
2. Unzip somewhere permanent on your computer.
3. Open `chrome://extensions` in Chrome.
4. Switch on **Developer mode** (top right).
5. Click **Load unpacked** and pick the unzipped folder.
6. Pin the extension to the toolbar so the icon is visible.
7. Open the extension Options page once: the practice code is auto-detected
   from any open Medicus tab. If you want to use the Triage Request Monitor,
   enable it there and paste in the assignee UUID.

## Auto-update

From v1.3.1 the extension checks this repository once a day for new releases.
When a newer version is published, a banner appears in the Options page with
a link to the release page. Download the new zip and replace the unzipped
folder on disk, then click the refresh icon on the extension card in
`chrome://extensions`.

## Cutting a release

This repo has a GitHub Actions workflow that builds and publishes a release
automatically when you push a version tag. To cut a new release:

```bash
# Bump the version in manifest.json
# Then commit and tag
git add manifest.json
git commit -m "Release v1.3.2"
git tag v1.3.2
git push && git push --tags
```

The workflow at `.github/workflows/release.yml` packs the repo into
`medicus-suite-v1.3.2.zip` (excluding tests and dev files), creates a
GitHub release with that tag, and attaches the zip. Within 24 hours every
installed extension's update banner will surface the new version.

## What it does and does not do

The extension only reads from Medicus. It does not create, modify, assign,
or delete clinical or administrative records. It uses the user's existing
Medicus login (session cookies on `*.api.england.medicus.health`) and does
not transmit patient information to any external server.

Beyond Medicus itself, the extension can contact exactly four external
endpoints — each tied to one feature, and none carrying patient data:

- **`api.github.com`** — always on: a version check against this repository's
  releases, powering the update banner. No patient data is included.
- **`api.nhs.uk`** — the **Leaflets** tab, opt-in and off by default. With no
  API key configured in Options → Leaflets, the tab works entirely from a
  bundled local index and `chrome.tabs.create` (a normal browser navigation
  the user initiates by clicking "Open") — no endpoint is contacted. If a
  user registers for the free NHS Website Content API and pastes a key into
  Options → Leaflets, selecting a search result sends a plain GET containing
  only the condition or medicine name the user selected — never patient
  data — to fetch the leaflet text. The API key is stored locally on that
  device only and is deliberately excluded from suite backups.
- **`termbrowser.nhs.uk`** — the "Clean up code" widget's SNOMED CT currency
  check (retired / REPLACED BY / SAME AS), relayed through the service worker.
  Requests carry only SNOMED concept identifiers, never patient identity.
- **`*.supabase.co`** — the optional **task presence** feature ("who else has
  this task open"), active only where a practice administrator has deployed a
  `presence-config.json` alongside the extension. Heartbeats carry the staff
  member's display label, a pseudonymous task UUID, and timestamps — staff
  workflow data, not patient data. Practices using it should cover it in
  their own staff privacy notice; see `docs/task-presence-setup.md`.

## Licence

**Proprietary — all rights reserved.** Copyright © 2026 Dr Dave Triska /
Graysbrook Ltd. See [`LICENSE`](LICENSE) for the full terms.

No licence to use, copy, modify, redistribute, fork, or make any commercial use
of this Software is granted. Public visibility of this repository is for
transparency only and does not place the code in the public domain or waive any
right. Deployed instances are made available to named clinical users under
`docs/sentinel-DISCLAIMER.txt` and `docs/INTENDED-PURPOSE.md`. Contact Dave
Triska (davetriska02@gmail.com) for any usage or licensing query.
