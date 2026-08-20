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
git commit -m "Release v3.236.2"
git tag v3.236.2
git push && git push --tags
```

The workflow at `.github/workflows/release.yml` packs the repo into
`medicus-suite-v3.236.2.zip` (excluding tests and dev files), creates a
GitHub release with that tag, and attaches the zip. Within 24 hours every
installed extension's update banner will surface the new version.

## What it does and does not do

The extension sits alongside Medicus and uses the user's existing login
(session cookies on `*.api.england.medicus.health`). A small, enumerated
set of **user-initiated** write actions can create or change records in
Medicus — appointment booking, general-task creation, inbound-document
filing, normal-lab-result filing, routine-prescription re-assignment, and
problem-list / duplicate / allergy tidy-up. Every write is triggered by the
user on the record in front of them, confirmed at the point of commit, and
executed under that user's own Medicus session. Medicus remains the system
of record. Nothing is written automatically or in the background.

By default the extension does not transmit patient information to any
external server. The only external endpoint contacted by default is
`api.github.com` for update checks (no patient data). Two optional,
off-by-default exceptions:

- **Leaflets** — with no API key configured in Options → Leaflets, the tab
  works entirely from a bundled local index and `chrome.tabs.create` (a
  normal browser navigation the user initiates). If a user registers for
  the free NHS Website Content API and pastes a key into Options →
  Leaflets, selecting a search result additionally sends a plain GET to
  `api.nhs.uk` containing only the condition or medicine name — never
  patient data. The API key is stored locally on that device only and is
  deliberately excluded from suite backups.
- **Transactional API** — a practice may enable a read-only Medicus
  Transactional API path via a Graysbrook-operated UK proxy
  (`txn.integrationMode`). Off by default; do not enable it until the
  practice has reviewed `docs/INTENDED-PURPOSE.md` and
  `docs/TRANSACTIONAL-API-INTEGRATION.md`.

The binding safety notice is [`docs/CLINICAL-SAFETY-NOTICE.md`](docs/CLINICAL-SAFETY-NOTICE.md).

## Licence

**Proprietary — all rights reserved.** Copyright © 2026 Dr Dave Triska /
Graysbrook Ltd. See [`LICENSE`](LICENSE) for the full terms.

No licence to use, copy, modify, redistribute, fork, or make any commercial use
of this Software is granted. Public visibility of this repository is for
transparency only and does not place the code in the public domain or waive any
right. Deployed instances are made available to named clinical users under
`docs/sentinel-DISCLAIMER.txt` and `docs/INTENDED-PURPOSE.md`. Contact Dave
Triska (davetriska02@gmail.com) for any usage or licensing query.
