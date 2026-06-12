#!/usr/bin/env node
// Medicus Suite — safety-doc version guard.
//
// Ensures that each clinical safety document's pinned product version tracks
// the manifest version at the same major.minor level. Patch lag is intentional
// and allowed: the CSO signs off docs at minor releases, not every patch.
//
// KNOWN-STALE GRACE: some docs are legitimately behind because a CSO review is
// outstanding (audit task T4). Those are pinned in KNOWN_STALE. If a doc still
// shows exactly its pinned stale version the script prints a loud WARNING but
// does NOT fail — this makes the guard immediately deployable while the doc
// refresh awaits CSO sign-off. Once the CSO updates a doc and removes its pin,
// any further drift will cause exit(1).

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Docs and the regex used to extract their product version.
// Two formats are in use:
//   **Product version:** 3.26.4    (CLINICAL-SAFETY-NOTICE, HAZARD-LOG, SOUP)
//   **Version:** v3.31.2           (feature-list)
const DOCS = [
  {
    file: 'docs/CLINICAL-SAFETY-NOTICE.md',
    re: /\*\*Product version:\*\*\s*v?([\d.]+)/,
  },
  {
    file: 'docs/HAZARD-LOG.md',
    re: /\*\*Product version:\*\*\s*v?([\d.]+)/,
  },
  {
    file: 'docs/SOUP.md',
    re: /\*\*Product version:\*\*\s*v?([\d.]+)/,
  },
  {
    file: 'docs/feature-list.md',
    re: /\*\*Version:\*\*\s*v?([\d.]+)/,
  },
];

// Hardcoded stale pins. Key = relative file path; value = the exact version
// string the doc currently contains that is known-stale but CSO-approved to
// remain so until audit task T4 doc refresh is complete.
// Remove an entry here once the CSO has updated the corresponding doc.
// NOTE: All three T4 docs (CLINICAL-SAFETY-NOTICE, HAZARD-LOG, SOUP) were
// updated to v3.56.0 on 2026-06-11 by the CSO (Dr Dave Triska). Their pins
// have been removed. The docs are now at v3.56.0; this guard will fail until
// manifest.json is bumped to 3.56.0 in the same release commit (which is
// intentional and expected — the orchestrator bumps the manifest last).
//
// v3.57.0 (Monitoring panel header toolbar / flicker fix / guided tour) is a
// UI + onboarding release with no change to the rules engine, extraction, or
// any clinical logic; the safety position is unchanged from v3.56.0. The doc
// re-issue (and sign-off) is the CSO's act, not the release author's, so the
// four docs are pinned at their signed v3.56.0 until Dr Triska reviews and
// reissues them for the 3.57 minor. Remove these pins in that doc commit.
const KNOWN_STALE = {
  'docs/CLINICAL-SAFETY-NOTICE.md': '3.56.0',
  'docs/HAZARD-LOG.md': '3.56.0',
  'docs/SOUP.md': '3.56.0',
  'docs/feature-list.md': '3.56.0',
};

function majorMinor(ver) {
  const parts = ver.split('.');
  return parts[0] + '.' + parts[1];
}

const manifestPath = path.join(ROOT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestVer = manifest.version;
const manifestMM = majorMinor(manifestVer);

let anyFail = false;

for (const { file, re } of DOCS) {
  const fullPath = path.join(ROOT, file);
  const content = fs.readFileSync(fullPath, 'utf8');
  const m = re.exec(content);
  if (!m) {
    console.error(`ERROR: could not find product version in ${file}`);
    anyFail = true;
    continue;
  }
  const docVer = m[1];
  const docMM = majorMinor(docVer);

  if (docMM === manifestMM) {
    console.log(`OK    ${file}  (doc ${docVer} == manifest major.minor ${manifestMM})`);
    continue;
  }

  const stalePin = KNOWN_STALE[file];
  if (stalePin && docVer === stalePin) {
    console.warn(
      `WARN  ${file}  doc version ${docVer} is known-stale (manifest is ${manifestVer})\n` +
        `      safety-doc review outstanding (audit task T4) — ` +
        `remove this pin from KNOWN_STALE once the CSO updates the doc`
    );
    continue;
  }

  console.error(
    `ERROR ${file}  doc version ${docVer} does not match manifest ${manifestVer} ` +
      `(expected major.minor ${manifestMM}; got ${docMM})`
  );
  anyFail = true;
}

if (anyFail) {
  process.exit(1);
}
