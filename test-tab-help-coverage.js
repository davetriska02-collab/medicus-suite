// Medicus Suite — per-tab help coverage guard
// Run with: node test-tab-help-coverage.js
//
// The "?" help button (panel AND pop-out headers) shows a two-line summary of
// the active tab from shared/tab-help.js — ONE map consumed by both shells
// (previously duplicated per shell; converged in the top-10 plan batch A).
// This guard mirrors test-tab-catalog.js / test-tour-steps.js: it parses the
// real data-module set out of BOTH panel.html and pop-out.html and fails CI
// if any tab — including the panel-only tabs (visualiser, about; see
// CLAUDE.md "Panel-only tabs (intentional exceptions)") — has no TAB_HELP
// entry, or if an entry's copy is too thin to be useful.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0;
let failures = 0;
function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  OK    ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL  ${msg}`);
  }
}

(async () => {
  const url = pathToFileURL(path.join(__dirname, 'shared', 'tab-help.js')).href;
  const { TAB_HELP } = await import(url);

  const panelHtml = fs.readFileSync(path.join(__dirname, 'side-panel', 'panel.html'), 'utf8');
  const popoutHtml = fs.readFileSync(path.join(__dirname, 'pop-out', 'pop-out.html'), 'utf8');

  const panelIds = new Set([...panelHtml.matchAll(/data-module="([a-z-]+)"/g)].map((m) => m[1]));
  const popoutIds = new Set([...popoutHtml.matchAll(/data-module="([a-z-]+)"/g)].map((m) => m[1]));
  const allTabIds = new Set([...panelIds, ...popoutIds]);

  check(panelIds.size > 0, `parsed data-module tabs from panel.html (${panelIds.size} found)`);
  check(popoutIds.size > 0, `parsed data-module tabs from pop-out.html (${popoutIds.size} found)`);

  // ── Coverage: every tab in either shell has a TAB_HELP entry ───────────────
  const missing = [...allTabIds].filter((id) => !TAB_HELP[id]);
  check(
    missing.length === 0,
    missing.length === 0
      ? `every tab in either shell (${allTabIds.size} total) has a shared/tab-help.js entry`
      : `tab(s) missing a help entry: ${missing.join(', ')}`
  );

  // Panel-only tabs are a deliberate exception to "every real module in both
  // shells" (CLAUDE.md), but help coverage must still include them.
  check('visualiser' in TAB_HELP, 'panel-only tab "visualiser" has a help entry');
  check('about' in TAB_HELP, 'panel-only tab "about" has a help entry');

  // ── No stale entries for tabs that don't exist in either shell ─────────────
  const stale = Object.keys(TAB_HELP).filter((id) => !allTabIds.has(id));
  check(stale.length === 0, stale.length === 0 ? 'no stale TAB_HELP entries' : `stale entries: ${stale.join(', ')}`);

  // ── Entry quality: title/what/firstStep present and non-trivial ────────────
  const badEntries = Object.entries(TAB_HELP).filter(([, h]) => {
    if (!h || typeof h !== 'object') return true;
    if (typeof h.title !== 'string' || !h.title.trim()) return true;
    if (typeof h.what !== 'string' || h.what.trim().length < 15) return true;
    if (typeof h.firstStep !== 'string' || h.firstStep.trim().length < 10) return true;
    return false;
  });
  check(
    badEntries.length === 0,
    badEntries.length === 0
      ? 'every entry has a title, a substantive "what" line and a "firstStep" line'
      : `thin/malformed entries: ${badEntries.map(([id]) => id).join(', ')}`
  );

  // ── Both shells' data-module sets: real (non-visualiser/about) tabs must
  //    appear in both, per CLAUDE.md — same guarantee test-tab-catalog.js
  //    doesn't check across shells, so pin it here too since we're already
  //    parsing both files.
  const PANEL_ONLY_ALLOWED = new Set(['visualiser', 'about']);
  const missingFromPopout = [...panelIds].filter((id) => !popoutIds.has(id) && !PANEL_ONLY_ALLOWED.has(id));
  check(
    missingFromPopout.length === 0,
    missingFromPopout.length === 0
      ? 'every non-panel-only panel.html tab also appears in pop-out.html'
      : `real tab(s) missing from pop-out.html: ${missingFromPopout.join(', ')}`
  );
  const extraInPopout = [...popoutIds].filter((id) => !panelIds.has(id));
  check(
    extraInPopout.length === 0,
    extraInPopout.length === 0
      ? 'pop-out.html has no tabs absent from panel.html'
      : `pop-out-only tab(s) not in panel.html: ${extraInPopout.join(', ')}`
  );

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load shared/tab-help.js: ${e.message}`);
  process.exit(1);
});
