// Medicus Suite — write-path inventory (CSN §6.1 completeness guard)
// Run with: node test-write-path-inventory.js
//
// docs/CLINICAL-SAFETY-NOTICE.md §6.1 claims: "If a capability is not in this
// table, the software cannot do it." This test is what makes that claim
// machine-enforced rather than aspirational. Hardened by the 2026-08-22
// clinical-safety audit (R7) after the original scanner — a single
// `method: 'POST'` grep over three trees — was shown blind to the write class
// that had already escaped it (the OIR auto-tick DOM macro, now W22):
//
//   1. ALL product trees are walked (root .js, content-scripts, shared,
//      side-panel, options, pop-out, engine, rota) — not a curated subset.
//   2. ALL mutating verbs are matched (POST/PUT/PATCH/DELETE), not just POST.
//   3. Non-literal `method:` values (computed/variable) are flagged unless the
//      line is the known `opts.method || 'GET'` passthrough-helper idiom
//      (whose call sites' literal verbs are caught by 2) or a named allowlist
//      entry.
//   4. sendBeacon / XMLHttpRequest / form.submit() anywhere is flagged.
//   5. Synthetic clicks / synthesised mouse-keyboard events in content-scripts
//      (code injected into the live Medicus page) must be claimed by a W-id or
//      a named own-UI reason — a DOM macro that drives Medicus's own controls
//      IS a write surface even with zero fetch calls.
//
// Every hit must map to a CSN W-id or a named allowlist reason, and every
// W1–W23 row must still be present in the notice. A new allowlist entry is a
// deliberate exception, not a default.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const ROOT = __dirname;

// Any mutating verb as a literal request-init property.
const WRITE_VERB_RE = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/;
// A `method:` whose value is NOT a quoted HTTP verb — computed, variable,
// template. These hide the verb from the scanner and need a named reason.
const COMPUTED_METHOD_RE = /method:\s*(?!['"](?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)['"])\S/;
// The one blessed passthrough idiom: a request helper defaulting to GET. Its
// call sites pass literal verbs, which rule (2) catches at the call site.
const PASSTHROUGH_HELPER_RE = /method:\s*(?:opts|options|init|req)\.method\s*(?:\|\|\s*['"]GET['"])?/;
// Alternative network write channels.
const BEACON_RE = /navigator\.sendBeacon|new XMLHttpRequest|\.submit\(/;
// Synthetic interaction with the page — only meaningful inside content-scripts,
// which run in the live Medicus DOM.
const CLICK_RE = /\.click\(\)|dispatchEvent\(new (?:Mouse|Keyboard|Pointer)Event/;

const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  'scripts', // capture tooling, never shipped in the extension
  '_skill',
  '.git',
  '.claude',
  '.cursor',
  '.githooks',
  '.github',
  'docs',
  'icons',
]);

function relPosix(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function isTestFile(name) {
  return /^test-.*\.js$/.test(name);
}

function listJsFiles(absDir, recurse) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (recurse) out.push(...listJsFiles(full, true));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !isTestFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── Scan trees: the WHOLE product ────────────────────────────────────────────

const SCAN_FILES = [];
SCAN_FILES.push(...listJsFiles(ROOT, false)); // root .js (service-worker, duplicate-checker, visualiser-core …)
for (const rel of ['content-scripts', 'shared', 'side-panel', 'options', 'pop-out', 'engine', 'rota']) {
  SCAN_FILES.push(...listJsFiles(path.join(ROOT, rel), true));
}
SCAN_FILES.sort();

// ── Allowlist: a network-write hit that is not a CSN W-row ──────────────────
// Must be named here with a reason. These are not Medicus session write
// surfaces (proxy / non-clinical store) and must not silently grow a new
// clinical write without a W-id.

const ALLOWLIST = {
  'shared/txn-transport.js':
    'optional Transactional API proxy POST; read-only for patient data — the transport THROWS on isWrite before any network call (enforced, regression-guarded by test-txn-modules.js). Not a Medicus session write surface.',
  'content-scripts/task-presence.js':
    'Supabase task_presence upsert/heartbeat/cleanup (POST/DELETE), not a Medicus clinical write; payload carries no patient identifiers (verified 2026-08-22 audit).',
};

// Computed-method false positives / blessed exceptions, named per file.
const COMPUTED_METHOD_ALLOWLIST = {
  'shared/record-provider.js':
    "error-message template string ('Unknown write method: …'), not a request init; the generic write() passthrough is refused by txn-transport (audit R5).",
};

// Files in content-scripts that synthesise clicks/keyboard events, each claimed
// by a W-id (a Medicus-control macro) or a named own-UI reason. A new file
// synthesising clicks in the live Medicus page fails CI until it is claimed.
const CLICK_MACRO_MAP = {
  'content-scripts/triage-lens/lab-file-button.js': { wids: ['W7'] },
  'content-scripts/triage-lens/routine-rx-button.js': { wids: ['W8'] },
  'content-scripts/triage-lens/content.js': {
    wids: ['W22'],
    note: 'tickRows (W22 OIR tick-off); the only other Medicus-control click is the keyboard-nav Enter-to-open-row, a user-initiated navigation click that writes nothing',
  },
  'content-scripts/task-actions-panel.js': {
    reason:
      "keyboard-accessibility self-click on its OWN widget toggles only (outer collapse, what's due, patient record, booking section, task section); the W2/W5 Medicus writes are POSTs, caught by the verb scanner",
  },
  'content-scripts/reception-quick-actions.js': {
    reason:
      'keyboard-accessibility self-click on its OWN composer toggle only; H-049 doctrine — highlights, never clicks, the Medicus Submit control',
  },
  'content-scripts/contacts-link-button.js': {
    reason:
      'keyboard-accessibility self-click on its OWN canvas-entry toggle only; the W18 Medicus writes are POSTs in contacts-api.js',
  },
  'content-scripts/document-codes-to-problems.js': {
    reason:
      'keyboard-accessibility self-click on its OWN widget toggle only; the W20 Medicus write is a POST, caught by the verb scanner',
  },
  'content-scripts/triage-lens/options.js': {
    reason:
      "extension options page script (not injected into Medicus pages): download-anchor click and file-input opener for the suite's own import/export UI",
  },
};

// ── Expected file → W-id map (a file may map to several W-ids) ───────────────

const FILE_TO_WIDS = {
  'side-panel/modules/slots/booking-api.js': ['W1'],
  'shared/booking-core.js': ['W1', 'W2', 'W12', 'W15'],
  'shared/task-api.js': ['W4'],
  'content-scripts/task-actions-panel.js': ['W2', 'W5'],
  'content-scripts/document-file-inline.js': ['W6'],
  'content-scripts/triage-lens/lab-file-button.js': ['W7'],
  'content-scripts/triage-lens/routine-rx-button.js': ['W8'],
  'content-scripts/problem-description-cleanup.js': ['W9', 'W19'],
  'content-scripts/problem-bulk-end.js': ['W10'],
  'duplicate-checker.js': ['W11'],
  'engine/record-duplicate-parser.js': ['W11'],
  'side-panel/modules/shared/booking-panel.js': ['W12'],
  'side-panel/modules/shared/booking-panel-core.js': ['W12'],
  'content-scripts/allergy-cleanup.js': ['W13'],
  'shared/appointment-organise-core.js': ['W14', 'W15', 'W16'],
  'content-scripts/problem-nesting.js': ['W17'],
  'content-scripts/contacts-api.js': ['W18'],
  'content-scripts/document-codes-to-problems.js': ['W20'],
  'content-scripts/task-bulk-action.js': ['W21'],
  'content-scripts/privacy-officer-bulk-acknowledge.js': ['W21'],
  'content-scripts/eps-cancellation-bulk-discard.js': ['W21'],
  'content-scripts/triage-lens/content.js': ['W22'],
  'shared/lab-allocate-core.js': ['W23'],
};

const LAST_WID = 23;

// W7/W8/W22 are DOM macros (may have no method:POST). W12 panel files and the
// W1 slots shim may only re-export booking-core. W21 companions instantiate
// the shared bulk-action engine. All must still exist on disk.
const EXISTENCE_EVEN_WITHOUT_POST = [
  'side-panel/modules/slots/booking-api.js',
  'content-scripts/triage-lens/lab-file-button.js',
  'content-scripts/triage-lens/routine-rx-button.js',
  'side-panel/modules/shared/booking-panel.js',
  'side-panel/modules/shared/booking-panel-core.js',
  'content-scripts/privacy-officer-bulk-acknowledge.js',
  'content-scripts/eps-cancellation-bulk-discard.js',
  'content-scripts/triage-lens/content.js',
];

function findHits(absFile, re) {
  const lines = fs.readFileSync(absFile, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((text, i) => {
    if (re.test(text)) hits.push({ line: i + 1, text });
  });
  return hits;
}

const unmatched = [];

// ── 1. Every mutating-verb hit is allowlisted or mapped ──────────────────────

console.log('\n--- mutating-verb request hits (POST/PUT/PATCH/DELETE) ---');
let verbHitCount = 0;
for (const abs of SCAN_FILES) {
  const rel = relPosix(abs);
  const hits = findHits(abs, WRITE_VERB_RE);
  if (!hits.length) continue;
  verbHitCount += hits.length;
  const allowReason = ALLOWLIST[rel];
  const wids = FILE_TO_WIDS[rel];
  for (const h of hits) {
    const loc = `${rel}:${h.line}`;
    if (allowReason) {
      check(true, `${loc} allowlisted — ${allowReason}`);
    } else if (wids && wids.length) {
      check(true, `${loc} → ${wids.join(', ')}`);
    } else {
      unmatched.push(loc);
      check(false, `unmapped Medicus-record write at ${loc} — assign a CSN W-id`);
    }
  }
}
check(verbHitCount > 0, `scanner found ${verbHitCount} mutating-verb hit(s) across the product trees`);

// ── 2. No computed/variable method smuggles a verb past the scanner ─────────

console.log('\n--- computed/non-literal method values ---');
let computedOk = 0;
for (const abs of SCAN_FILES) {
  const rel = relPosix(abs);
  for (const h of findHits(abs, COMPUTED_METHOD_RE)) {
    const loc = `${rel}:${h.line}`;
    if (PASSTHROUGH_HELPER_RE.test(h.text)) {
      computedOk++;
      continue; // blessed passthrough idiom — literal verbs caught at call sites
    }
    if (COMPUTED_METHOD_ALLOWLIST[rel]) {
      check(true, `${loc} computed-method allowlisted — ${COMPUTED_METHOD_ALLOWLIST[rel]}`);
      continue;
    }
    unmatched.push(loc);
    check(
      false,
      `non-literal method value at ${loc} — name it in COMPUTED_METHOD_ALLOWLIST with a reason or refactor to a literal`
    );
  }
}
check(true, `${computedOk} passthrough-helper (opts.method || 'GET') idiom line(s) verified`);

// ── 3. No alternative network write channels ─────────────────────────────────

console.log('\n--- sendBeacon / XMLHttpRequest / form.submit() ---');
let beaconHits = 0;
for (const abs of SCAN_FILES) {
  const rel = relPosix(abs);
  for (const h of findHits(abs, BEACON_RE)) {
    beaconHits++;
    const loc = `${rel}:${h.line}`;
    unmatched.push(loc);
    check(false, `alternative network write channel at ${loc} — needs a W-id row and explicit handling in this test`);
  }
}
check(beaconHits === 0, 'no sendBeacon / XMLHttpRequest / form.submit() anywhere in product source');

// ── 4. Every content-script that synthesises clicks is claimed ───────────────

console.log('\n--- synthetic clicks / synthesised events in content-scripts ---');
for (const abs of SCAN_FILES) {
  const rel = relPosix(abs);
  if (!rel.startsWith('content-scripts/')) continue;
  const hits = findHits(abs, CLICK_RE);
  if (!hits.length) continue;
  const claim = CLICK_MACRO_MAP[rel];
  if (claim && claim.wids) {
    check(
      true,
      `${rel} (${hits.length} click site(s)) → DOM-macro ${claim.wids.join(', ')}${claim.note ? ' — ' + claim.note : ''}`
    );
  } else if (claim && claim.reason) {
    check(true, `${rel} (${hits.length} click site(s)) own-UI — ${claim.reason}`);
  } else {
    unmatched.push(`${rel}:${hits[0].line}`);
    check(
      false,
      `${rel} synthesises clicks in the live Medicus page (first at line ${hits[0].line}) and is not claimed in CLICK_MACRO_MAP — a DOM macro is a write surface; assign a W-id or a named own-UI reason`
    );
  }
}
// Stale-map guard: every claimed file must still exist and still click.
for (const rel of Object.keys(CLICK_MACRO_MAP).sort()) {
  const abs = path.join(ROOT, ...rel.split('/'));
  check(fs.existsSync(abs), `CLICK_MACRO_MAP entry ${rel} still exists`);
}

// ── 5. CSN §6.1 table rows W1–W23 ────────────────────────────────────────────

console.log('\n--- CSN §6.1 W-id table rows ---');
const csnPath = path.join(ROOT, 'docs', 'CLINICAL-SAFETY-NOTICE.md');
check(fs.existsSync(csnPath), 'docs/CLINICAL-SAFETY-NOTICE.md exists');
const csn = fs.existsSync(csnPath) ? fs.readFileSync(csnPath, 'utf8') : '';

function csnHasRow(id) {
  return csn.includes(`| ${id} |`);
}

for (let n = 1; n <= LAST_WID; n++) {
  const id = 'W' + n;
  check(csnHasRow(id), `CSN §6.1 has table row | ${id} |`);
}

const w11Row = (csn.match(/\| W11 \|[^\n]+/) || [''])[0];
check(
  /clinical\/investigation\/mark-incorrect-and-hidden/.test(w11Row),
  'CSN W11 names the investigation-report hide endpoint (clinical/investigation/mark-incorrect-and-hidden)'
);

// ── 6. Every mapped product file still exists ────────────────────────────────

console.log('\n--- mapped product files exist ---');
for (const rel of Object.keys(FILE_TO_WIDS).sort()) {
  const abs = path.join(ROOT, ...rel.split('/'));
  check(fs.existsSync(abs), `${rel} exists (mapped → ${FILE_TO_WIDS[rel].join(', ')})`);
}

console.log('\n--- DOM-macro / shim files exist even without a write POST ---');
for (const rel of EXISTENCE_EVEN_WITHOUT_POST) {
  const abs = path.join(ROOT, ...rel.split('/'));
  check(fs.existsSync(abs), `${rel} exists`);
}

// Self-check: every W-id except W3 has ≥1 mapped file in this inventory.
console.log('\n--- inventory map covers W1–W23 ---');
const widsWithFiles = new Set();
for (const wids of Object.values(FILE_TO_WIDS)) {
  wids.forEach((w) => widsWithFiles.add(w));
}
for (const claim of Object.values(CLICK_MACRO_MAP)) {
  (claim.wids || []).forEach((w) => widsWithFiles.add(w));
}
check(true, 'W3 is a consequence of W1/W2 — no separate POST file required');
for (let n = 1; n <= LAST_WID; n++) {
  if (n === 3) continue;
  const id = 'W' + n;
  check(widsWithFiles.has(id), `${id} has ≥1 mapped product file in this inventory`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  if (unmatched.length) {
    console.error('\nUnmapped write-capable hit (file:line) — assign a CSN W-id or a named allowlist reason:');
    unmatched.forEach((loc) => console.error(`  ${loc}`));
  }
  console.error(
    '\nCSN §6.1 completeness claim failed. A new Medicus-record write (network verb, ' +
      'beacon/XHR/submit channel, or content-script DOM macro) needs a W-id in this test ' +
      'AND a `| Wnn |` row in docs/CLINICAL-SAFETY-NOTICE.md; a missing row means the ' +
      'notice no longer lists every write the software can do.'
  );
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
