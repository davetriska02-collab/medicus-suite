# Medicus Suite

Chrome extension toolkit for GP practices using the Medicus clinical system.
Bundles waiting room, slot counter, capacity forecast, submissions tracker,
clinical monitoring (Sentinel), triage lens, and triage request monitor into
one extension that reads the user's logged-in Medicus session.

Built by Dr Dave Triska (Witley & Milford Surgery). Not affiliated with
Medicus the company.

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
not transmit patient information to any external server. The only external
endpoint the extension contacts is `api.github.com` for update checks; no
patient data is included in those requests.

## Licence

Internal practice tool. Not for redistribution outside collaborating GP
practices. Contact Dave Triska for usage queries.
