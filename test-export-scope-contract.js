// Export-scope contract (repo-audit T0.1). Guards the backup-disclosure gap
// found in the 2026-08 audit: options.html described SIX export scopes while
// doFullExport() exported TWENTY — including patient-identifiable data
// (Patient Alerts: names, NHS numbers, alert text) and staff special-category
// data (Rota: sickness, absence). The import path warned; the export path —
// the one that actually creates the file — did not.
//
// This test fails closed on every way that gap can reopen:
//   1. A scope exported by doFullExport() that isn't in VALID_SCOPES.
//   2. A VALID_SCOPES entry that doFullExport() silently doesn't export.
//   3. A scope with no preview line in previewEnvelope() (mods.<scope> absent).
//   4. A scope with no entry in SCOPE_DISPLAY below (add the display name AND
//      the options.html description when you add a scope — that's the point).
//   5. A SCOPE_DISPLAY phrase missing from the suite-backup description block
//      in options.html.
//   6. The PID warning text missing from the description block, or the
//      export click handler losing its confirm() gate.

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

const { VALID_SCOPES } = require('./shared/io/suite-envelope.js');
const optionsJs = fs.readFileSync(path.join(__dirname, 'options', 'options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(__dirname, 'options', 'options.html'), 'utf8');
const envelopeSrc = fs.readFileSync(path.join(__dirname, 'shared', 'io', 'suite-envelope.js'), 'utf8');

// The phrase for each scope that MUST appear in the suite-backup description
// in options.html. Adding a scope to doFullExport without adding it here (and
// to the description) fails check 4/5 — by design.
const SCOPE_DISPLAY = {
  sentinel: 'Sentinel',
  capacity: 'Capacity',
  triage: 'Triage Lens',
  triageAlerts: 'Triage alerts',
  slots: 'Slot Counter',
  submissions: 'Submissions',
  popout: 'Pop-out',
  referrals: 'Referrals',
  requestMonitor: 'Request Monitor',
  condor: 'Condor',
  reception: 'Reception',
  knowledge: 'Knowledge',
  labfiling: 'Lab filing',
  notifications: 'Notifications',
  leaflets: 'Leaflets',
  patientAlerts: 'Patient Alerts',
  problemDescriptionCleanup: 'code-cleanup preferences',
  phrases: 'Phrases',
  rota: 'Rota',
  suite: 'practice code',
};

// ── 1. Parse the module keys doFullExport() actually wraps ─────────────────
const fnMatch = optionsJs.match(/async function doFullExport\(\) \{[\s\S]*?\n\}/);
check(!!fnMatch, 'doFullExport() found in options/options.js');
let exportedKeys = [];
if (fnMatch) {
  const wrapMatch = fnMatch[0].match(/\.wrap\(\s*'suite',\s*\{([\s\S]*?)\}\s*,/);
  check(!!wrapMatch, "doFullExport() wraps a 'suite' modules object");
  if (wrapMatch) {
    exportedKeys = [...wrapMatch[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/gm)].map((m) => m[1]);
  }
}
check(exportedKeys.length >= 20, `doFullExport() exports ${exportedKeys.length} scopes (expected >= 20)`);

// ── 2. Two-way lock-step with VALID_SCOPES ──────────────────────────────────
for (const key of exportedKeys) {
  check(VALID_SCOPES.includes(key), `exported scope "${key}" is in VALID_SCOPES`);
}
for (const scope of VALID_SCOPES) {
  check(exportedKeys.includes(scope), `VALID_SCOPES entry "${scope}" is exported by doFullExport()`);
}

// ── 3. Every exported scope has a preview line in previewEnvelope() ────────
for (const key of exportedKeys) {
  check(envelopeSrc.includes(`mods.${key}`), `previewEnvelope() handles mods.${key}`);
}

// ── 4/5. Every exported scope is NAMED in the suite-backup description ─────
const helpMatch = optionsHtml.match(/<label class="field-label">Suite-wide backup<\/label>([\s\S]*?)id="exportSuite"/);
check(!!helpMatch, 'suite-backup description block found in options/options.html');
// Collapse whitespace so a phrase split by Prettier's line-wrapping still matches.
const helpBlock = helpMatch ? helpMatch[1].replace(/\s+/g, ' ') : '';
for (const key of exportedKeys) {
  const phrase = SCOPE_DISPLAY[key];
  check(!!phrase, `scope "${key}" has a SCOPE_DISPLAY entry (add it AND the options.html description)`);
  if (phrase) {
    check(helpBlock.includes(phrase), `description names "${phrase}" (scope "${key}")`);
  }
}

// ── 6. PID disclosure + export-time confirm gate ────────────────────────────
check(/patient-identifiable/i.test(helpBlock), 'description states the backup is patient-identifiable');
check(helpBlock.includes('NHS'), 'description mentions NHS numbers');
check(/[Rr]ota/.test(helpBlock) && /sickness/i.test(helpBlock), 'description flags Rota staff absence data');

const handlerMatch = optionsJs.match(/getElementById\('exportSuite'\)[\s\S]*?\n\}\);/);
check(!!handlerMatch, 'exportSuite click handler found');
if (handlerMatch) {
  const handler = handlerMatch[0];
  const confirmIdx = handler.indexOf('confirm(');
  const exportIdx = handler.indexOf('doFullExport()');
  check(confirmIdx !== -1, 'export handler has a confirm() gate');
  check(exportIdx !== -1 && confirmIdx !== -1 && confirmIdx < exportIdx, 'confirm() gate runs BEFORE doFullExport()');
  check(/PATIENT-IDENTIFIABLE/.test(handler), 'confirm text says PATIENT-IDENTIFIABLE');
}

console.log(`test-export-scope-contract: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
