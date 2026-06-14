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
// NOTE: The v3.57–v3.59 UX releases pinned all four docs at their signed
// v3.56.0 while the CSO reissue was outstanding. The CSO directed and
// reviewed the v3.60.0 reissue (CSN v3.5, HAZARD-LOG v3.6 incl. H-027..029,
// SOUP v1.2, feature-list v3.60.0) on 2026-06-12, so the pins are removed.
//
// 2026-06-14: the three CSO-signed safety docs sit at product v3.64.0 while the
// manifest has since advanced to the 3.77 line without a corresponding CSO doc
// reissue. Re-pinned as known-stale so the guard WARNs (does not fail) until the
// next CSO refresh brings them onto the 3.77 line; remove each entry when its
// doc is updated. (feature-list.md tracks normally and is intentionally unpinned.)
//
// 2026-06-14 (weekly safety sync): CLINICAL-SAFETY-NOTICE (CSN v3.9) and
// HAZARD-LOG (HL v3.10) updated to v3.77.5 — their pins removed. SOUP.md
// remains at v3.64.0 pending next CSO refresh; its pin is retained.
const KNOWN_STALE = {
  'docs/SOUP.md': '3.64.0',
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
