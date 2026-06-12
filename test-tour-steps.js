// Medicus Suite — Guided-tour staleness guard
// Run with: node test-tour-steps.js
//
// Purpose: the first-run walkthrough (side-panel/tour/tour-steps.js) is pure
// data and rots silently when the UI moves — a step whose anchor selector no
// longer renders simply never shows, and a new module tab ships untaught.
// This guard converts both failure modes into a CI failure, mirroring the
// philosophy of test-drug-brand-coverage.js (EXPECTED map) and
// test-backup-coverage.js (allowlist with reasons):
//
//   1. STRUCTURE — every step has id (unique), addedIn (1..TOUR_VERSION),
//      title, ≤2-sentence-scale body, and either a target or center:true.
//      The new/returning-user split depends on addedIn tags being sane.
//   2. SELECTORS — every #id / .class token in every step's target selectors
//      must still be emitted by a rendering source (HTML or JS template) —
//      side-panel/, pop-out/, shared/ — EXCLUDING side-panel/tour/ itself
//      (self-matches would make the check vacuous) and excluding CSS (a hit
//      only in CSS can be a dead rule).
//   3. NAV COVERAGE — every data-module tab in side-panel/panel.html must be
//      either taught by a step (its `module` field) or consciously listed in
//      NAV_COVERED_BY_OVERVIEW below. Adding a new tab therefore fails CI
//      until someone either adds a tour step or records the decision here —
//      that is the "proactively include new features" tripwire. Run the
//      update-tour skill (.claude/skills/update-tour/SKILL.md) to decide.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;

// Modules deliberately taught only by the 'nav-tabs' overview step (no
// dedicated walkthrough step). Move one out of this list and give it a step
// when it gains a flagship feature worth 15 seconds of a new user's time.
const NAV_COVERED_BY_OVERVIEW = new Set([
  'trends',
  'capacity',
  'submissions',
  'activity',
  'referrals',
  'condor',
  'reception',
  'sweep',
  'knowledge',
  'visualiser', // opens a full tab, not a panel module — overview mention only
  'about',
]);

let pass = 0;
let failures = 0;
function ok(msg) {
  pass++;
  console.log(`  OK    ${msg}`);
}
function fail(msg) {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

// Recursively collect rendering sources (.js/.html) under the given roots,
// excluding the tour's own directory and any CSS.
function collectSources() {
  const out = [];
  const skipDir = new Set(['node_modules', '.git']);
  const tourDir = path.join(ROOT, 'side-panel', 'tour');
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDir.has(entry.name) || full === tourDir) continue;
        walk(full);
      } else if (/\.(js|html)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  for (const root of ['side-panel', 'pop-out', 'shared']) walk(path.join(ROOT, root));
  return out;
}

(async () => {
  const stepsUrl = pathToFileURL(path.join(ROOT, 'side-panel', 'tour', 'tour-steps.js')).href;
  const { TOUR_VERSION, TOUR_STEPS } = await import(stepsUrl);

  // ── 1. Structure ──────────────────────────────────────────────────────────
  if (Number.isInteger(TOUR_VERSION) && TOUR_VERSION >= 1) ok(`TOUR_VERSION is a positive integer (${TOUR_VERSION})`);
  else fail(`TOUR_VERSION must be a positive integer, got ${JSON.stringify(TOUR_VERSION)}`);

  if (Array.isArray(TOUR_STEPS) && TOUR_STEPS.length >= 3 && TOUR_STEPS.length <= 20)
    ok(`step count sane (${TOUR_STEPS.length})`);
  else fail(`TOUR_STEPS must be an array of 3–20 steps, got ${TOUR_STEPS?.length}`);

  const ids = new Set();
  let structureOk = true;
  for (const s of TOUR_STEPS) {
    const where = `step '${s?.id ?? '<no id>'}'`;
    if (!s.id || ids.has(s.id)) {
      fail(`${where}: missing or duplicate id`);
      structureOk = false;
    }
    ids.add(s.id);
    if (!Number.isInteger(s.addedIn) || s.addedIn < 1 || s.addedIn > TOUR_VERSION) {
      fail(`${where}: addedIn must be an integer in 1..TOUR_VERSION, got ${JSON.stringify(s.addedIn)}`);
      structureOk = false;
    }
    if (typeof s.title !== 'string' || !s.title.trim() || /[A-Z]{4,}/.test(s.title)) {
      fail(`${where}: title missing or shouty`);
      structureOk = false;
    }
    if (typeof s.body !== 'string' || !s.body.trim() || s.body.length > 260) {
      fail(`${where}: body missing or too long (${s.body?.length} chars; keep ≤260 — ~2 sentences)`);
      structureOk = false;
    }
    if (!s.center && !s.target) {
      fail(`${where}: needs either a target selector or center:true`);
      structureOk = false;
    }
  }
  if (structureOk) ok('every step has unique id, sane addedIn, title, body, and target/center');

  if (TOUR_STEPS.some((s) => s.addedIn === TOUR_VERSION))
    ok(`at least one step is tagged addedIn ${TOUR_VERSION} (the "What's new" pass has content)`);
  else fail(`no step has addedIn === TOUR_VERSION (${TOUR_VERSION}) — version bumped without tagging?`);

  // ── 2. Selector tokens still rendered somewhere ──────────────────────────
  const sources = collectSources().map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));
  let selectorsOk = true;
  for (const s of TOUR_STEPS) {
    if (!s.target) continue;
    for (const sel of [].concat(s.target)) {
      const tokens = [...sel.matchAll(/[#.]([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      if (tokens.length === 0) {
        fail(`step '${s.id}': selector '${sel}' has no #id/.class token to verify`);
        selectorsOk = false;
        continue;
      }
      for (const tok of tokens) {
        if (!sources.some(({ text }) => text.includes(tok))) {
          fail(`step '${s.id}': selector token '${tok}' (from '${sel}') is not rendered by any JS/HTML source`);
          selectorsOk = false;
        }
      }
    }
  }
  if (selectorsOk) ok('every step target token is emitted by a rendering source (JS/HTML, tour dir excluded)');

  // ── 3. Nav coverage tripwire ──────────────────────────────────────────────
  const panelHtml = fs.readFileSync(path.join(ROOT, 'side-panel', 'panel.html'), 'utf8');
  const navModules = [...panelHtml.matchAll(/data-module="([a-z-]+)"/g)].map((m) => m[1]);
  const taught = new Set(TOUR_STEPS.map((s) => s.module).filter(Boolean));

  let coverageOk = true;
  for (const mod of navModules) {
    if (!taught.has(mod) && !NAV_COVERED_BY_OVERVIEW.has(mod)) {
      fail(
        `nav tab '${mod}' is neither taught by a tour step nor listed in NAV_COVERED_BY_OVERVIEW — ` +
          `run the update-tour skill: add a step (addedIn ${TOUR_VERSION + 1}) or record the decision here`
      );
      coverageOk = false;
    }
  }
  for (const mod of NAV_COVERED_BY_OVERVIEW) {
    if (!navModules.includes(mod)) {
      fail(`NAV_COVERED_BY_OVERVIEW lists '${mod}' but no such tab exists in panel.html — remove the stale entry`);
      coverageOk = false;
    }
  }
  for (const mod of taught) {
    if (!navModules.includes(mod)) {
      fail(`a tour step names module '${mod}' but no such tab exists in panel.html`);
      coverageOk = false;
    }
  }
  if (coverageOk) ok(`all ${navModules.length} nav tabs are taught or consciously overview-only`);

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load tour-steps.js: ${e.message}`);
  process.exit(1);
});
