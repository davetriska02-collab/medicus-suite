// Medicus Suite — Backup key-coverage regression test
// Run with: node test-backup-coverage.js
//
// Purpose: every chrome.storage.local key used by app code must be captured
// by a shared/io/*-io.js file or be on an explicit allowlist.
//
// USED keys: scanned from app source (side-panel/, pop-out/, shared/, options/,
//   engine/, content-scripts/, sentinel-options/, service-worker.js).
//   Extraction: string literals matching /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/
//   present in files that reference chrome.storage.local.
//
// COVERED keys: same literal extraction from shared/io/*.js.
//
// ALLOWLIST: transient or admin-managed keys not appropriate for user backup.

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

// ── File collectors ──────────────────────────────────────────────────────────

function listFilesRecursive(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip vendor/ subtrees and docs/
      if (['vendor', 'docs', 'icons'].includes(entry.name)) continue;
      out.push(...listFilesRecursive(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// App source directories (per the task spec).
const APP_DIRS = [
  'side-panel',
  'pop-out',
  'shared',
  'options',
  'engine',
  'content-scripts',
  'sentinel-options',
  'rota',
];
const APP_FILES = [
  // Top-level JS
  path.join(ROOT, 'service-worker.js'),
];
for (const d of APP_DIRS) {
  APP_FILES.push(...listFilesRecursive(path.join(ROOT, d), ['.js']));
}

// IO files (shared/io/*.js) — source of truth for COVERED keys.
const IO_DIR = path.join(ROOT, 'shared', 'io');
const IO_FILES = listFilesRecursive(IO_DIR, ['.js']);

// ── Key-string extraction ────────────────────────────────────────────────────
// A storage key looks like "suite.display" or "capacity.presets" — one or more
// dot-separated segments starting with a lowercase letter.  We match literals
// inside single or double quotes in JS source.
//
// We scan whole files that reference chrome.storage.local; the KEY_PREFIXES
// filter below is what keeps out unrelated dot-path literals in those files
// (e.g. chip IDs in triage-lens/content.js like 'record.age', 'queue.child').
// A new storage key under a NEW top-level prefix therefore requires adding the
// prefix here — the USED-size sanity check at the bottom guards against the
// scan going silently empty, not against a missing prefix.
//
// Non-key filters (strings that shape-match but are not storage keys):
const NON_KEY_SUFFIXES = ['.js', '.json', '.css', '.html', '.png', '.svg'];
const NON_KEY_SUBSTRINGS = ['/'];
// Known top-level storage key prefixes — only strings whose first segment
// matches one of these are candidates.
const KEY_PREFIXES = [
  'sentinel',
  'capacity',
  'triage',
  'triagelens',
  'slots',
  'submissions',
  'popout',
  'panel',
  'referrals',
  'suite',
  'condor',
  'config',
  'day',
  'knowledge',
  'sweep',
  'reception',
  'ledger',
  'health',
  'leaflets',
  // Audit M18 (2026-07-18): these four were missing, so the drift guard was
  // blind to their modules' keys (labfiling.suppress had already escaped it).
  'labfiling',
  'patientAlerts',
  'followups',
  'practice',
  'pdc',
  'phrases',
  // Contacts Management family-cycling session (content-scripts/contacts-canvas.js) — found
  // MISSING here entirely (not even in the USED set, since hasKeyPrefix silently filtered it out)
  // while addressing a live-testing review finding that this key needed a documented backup
  // exclusion; without this prefix the scanner was blind to it, same class of gap Audit M18 found
  // for labfiling/patientAlerts/followups/practice above.
  'contactsCanvas',
  'rota',
  // Architecture plan Phase 0.4: txn.* was invisible to this scanner (same
  // class of gap Audit M18 found for labfiling). The keys are practice
  // connection settings + a secret; they are deliberately not in an IO file
  // (see ALLOWLIST entries below) — exclusion is now a recorded decision.
  'txn',
];

function hasKeyPrefix(k) {
  const first = k.split('.')[0];
  return KEY_PREFIXES.includes(first);
}

function extractKeyLiterals(src) {
  const keys = new Set();
  const rx = /['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"]/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    const k = m[1];
    if (NON_KEY_SUFFIXES.some((s) => k.endsWith(s))) continue;
    if (NON_KEY_SUBSTRINGS.some((s) => k.includes(s))) continue;
    if (!hasKeyPrefix(k)) continue;
    keys.add(k);
  }
  return keys;
}

// ── Collect USED keys (files that reference chrome.storage.local) ────────────
// Skip io files and test files to avoid polluting the used set with coverage
// keys (io files define what IS covered, so listing them as "used" is circular).

const USED = new Set();
const usedSourceFiles = [];

for (const f of APP_FILES) {
  if (path.basename(f).startsWith('test-')) continue; // test scripts
  if (f.startsWith(IO_DIR)) continue; // io files
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes('chrome.storage.local')) continue; // no storage access
  const keys = extractKeyLiterals(src);
  if (keys.size) {
    usedSourceFiles.push(path.relative(ROOT, f));
    keys.forEach((k) => USED.add(k));
  }
}

// ── Collect COVERED keys (from io files) ─────────────────────────────────────

const COVERED = new Set();
for (const f of IO_FILES) {
  const src = fs.readFileSync(f, 'utf8');
  extractKeyLiterals(src).forEach((k) => COVERED.add(k));
}

// ── Allowlist — transient / admin-managed keys not appropriate for user backup ─
// Each entry must have a comment stating why it is excluded from backup.

const ALLOWLIST = new Set([
  // labfiling.suppress: per-patient "never auto-file" list — DELIBERATELY
  // machine-local (see shared/io/labfiling-io.js header); surfaced by the
  // 2026-07-18 audit when the labfiling prefix was added to KEY_PREFIXES.
  'labfiling.suppress',
  // Transient runtime state (documented in shared/io/request-monitor-io.js):
  'suite.requestMonitor.state', // live poll state object — not user config
  'suite.requestMonitor.notifMap', // service-worker notification tracking map — transient
  'suite.requestMonitor.authError', // transient auth error flag — not user config

  // OS window handle — session-transient (documented in shared/io/popout-io.js):
  'popout.windowId',

  // Transient cross-module handoff — written by the Reception pathway tiles'
  // "Leaflet" link, read once and removed by leaflets.js init. Not user config
  // (see side-panel/modules/reception/reception.js goToLeaflet):
  'leaflets.pendingQuery',

  // Transient cross-module handoff — written by the first-available component's
  // "Book" button when the Slots module isn't mounted to claim the event, read
  // once and removed by slots.js init (2-minute freshness window). Not user
  // config (see side-panel/modules/shared/first-available.js bookHandoff):
  'slots.pendingBooking',

  // Transient print payload — written on "Print reception handout", read by
  // handout.html, overwritten on every print. Not user config (documented in
  // side-panel/modules/sweep/sweep.js):
  'sweep.handout',

  // Transient batch-output payload — written on "Generate batch", read once by
  // batch-handout.html, overwritten on every generate. Not user config (mirrors
  // sweep.handout; see side-panel/modules/sweep/sweep.js):
  'sweep.batchPack',

  // Transient print payload — written on "Print patient summary", read by
  // passport.html, overwritten on every print. Not user config (mirrors the
  // sweep.handout convention — see side-panel/modules/sentinel/sentinel.js):
  'sentinel.passport',

  // Transient print payload — written on "SMR prep pack", read by
  // smr-pack.html, overwritten on every print. Not user config (mirrors the
  // sweep.handout convention — see side-panel/modules/record/record.js).
  // NOTE: the 'record' top-level prefix is deliberately NOT in KEY_PREFIXES
  // (triage-lens chip ids like 'record.age' squat on it), so this key is not
  // reached by the scan today — the entry is kept as documentation and as the
  // guard if the prefix situation ever changes:
  'record.smrPack',

  // Guided-tour seen marker — localStorage, NOT chrome.storage (per-machine
  // onboarding state, deliberately excluded from backups so a restore onto a
  // new machine still offers the tour). See side-panel/tour/tour.js:
  'suite.tour.seenVersion',

  // Command-palette recents — localStorage, NOT chrome.storage (per-machine
  // convenience ordering of command ids, never patient data; not worth
  // backing up). See side-panel/palette/palette.js:
  'suite.palette.recents',

  // Admin-managed via practice-profile.json, not user-writable backup:
  'suite.practiceProfile', // applied-profile metadata (version etc.)
  'suite.practiceProfile.notifiedVersions', // which profile versions have been notified
  'suite.practiceProfile.publisher', // Publisher-PC UI state for the practice-profile publish flow — not user config
  'suite.pdcContribute', // this machine's Cleanup Code Preferences contributor state (enabled flag + timing bookkeeping) — see shared/io/pdc-contribute.js, not user config

  // Transient release metadata (update-checker — expires after 24h, not user config):
  'suite.update.latestVersion',
  'suite.update.releaseUrl',
  'suite.update.releaseNotes',
  'suite.update.downloadUrl',
  'suite.update.checkedAt',
  'suite.update.error',
  'suite.update.etag',

  // Diagnostic update-check outcome written by service-worker.js — timestamps and
  // error strings only, no patient data. Transient; not user config:
  'suite.updateCheck.status',

  // Legacy migration key — the bare 'config' key was the old triagelens.config
  // location. The triage IO migrates it on import; only read during migration.
  'config',

  // Ephemeral extraction-health telemetry — rolling per-view extraction counts
  // used for live drift detection. Machine/session-local by design; restoring it
  // would import a stale baseline and mask real drift (documented in
  // shared/extraction-health.js and shared/io/sentinel-io.js):
  'sentinel.extractionBaseline',

  // Locally-discovered referral endpoint URL only (no PHI after audit M1).
  // Rediscovered on visiting the referrals page; never exported to backup.
  // referrals.config IS covered via referrals-io.
  'referrals.discovery',

  // Locally-discovered patient-listing/journal API endpoint URLs (and their
  // UUID-templated forms) captured by content-scripts/api-discovery.js —
  // endpoint shapes only, no PHI. Rediscovered on visiting the relevant
  // Medicus page; feeds duplicate-checker.js's practice-wide GP2GP-duplicate
  // scan and per-patient click-through. Never exported to backup:
  'suite.discoveredPatientListUrl',
  'suite.discoveredAllPatientUrls',
  'suite.discoveredJournalUrl',
  'suite.discoveredAllJournalUrls',
  'suite.discoveredJournalUrlTemplate',
  'suite.discoveredAllJournalUrlTemplates',
  'suite.apiDiscoveryLastRun',

  // Practice-wide flagged-patient scan results from duplicate-checker.js —
  // NAMES, NHS NUMBERS AND DATES OF BIRTH for every patient the GP2GP
  // duplicate scan flags, persisted so re-scans can skip already-checked
  // patients. This is the largest identifiable-PHI surface in the suite
  // (practice-wide, not per-patient) and is DELIBERATELY excluded from suite
  // backups — a portable JSON export must never carry a practice-wide PHI
  // list. If you're tempted to wire this into an io file per the usual
  // convention, don't — that would ship real patient data in every backup
  // file. (duplicate-checker.js lives at the repo root, outside the APP_DIRS
  // this audit scans, so this entry is defence-in-depth documentation, not
  // something the scanner currently detects on its own.)
  'suite.dupChecker.state',

  // Local audit trail of every EXACT-tier duplicate entry duplicate-checker.js
  // has removed from a patient's record (patient uuid/name, entry kind/id,
  // reason, timestamp) — the only record of these writes, since there is no
  // confirmed "undo" endpoint yet. Same PHI reasoning as suite.dupChecker.state
  // directly above: deliberately excluded from suite backups, never wire this
  // into an io file.
  'suite.dupChecker.removalLog',

  // Per-machine view state — not user config, not PHI, deliberately excluded from
  // backups so a restore onto a new machine starts fresh (see shared/modules/shared/ui-state.js):
  'suite.uiState',

  // Per-machine last-active panel tab — session convenience, not user config.
  // Excluded from backups; a freshly-restored machine always starts on 'slots':
  'panel.activeModule',

  // Transient guided-capture draft — written on every form input (debounced
  // 400 ms), cleared on "Generate summary" or explicit Discard. PHI-bearing
  // (may contain patient history answers); TTL 4 h; purpose is to survive
  // accidental module switches, not to back up. Mirrors sweep.handout pattern:
  'reception.captureDraft',

  // Transient sweep session state — written after each batch completes,
  // cleared on a fresh Run. PHI-bearing (patient names + chip data); TTL 2 h;
  // purpose is to allow resuming after a module switch, not to back up.
  // Mirrors sweep.handout pattern:
  'sweep.lastRun',

  // Transient print payload — written on "Print prep list", read by
  // worklist.html, overwritten on every print. Not user config (mirrors
  // sweep.handout exactly — see side-panel/modules/sweep/sweep.js):
  'sweep.worklist',

  // Practice's own £-per-QOF-point figure (manager £ projection — explicitly
  // non-clinical arithmetic; no national default exists in this repo on
  // purpose, see sweep-core.js qofPoundsValue). Unlike the transient keys
  // above, this genuinely IS user config, not PHI or session state — in
  // principle it should ride a real shared/io/sweep-io.js the way
  // condor.indexConfig rides condor-io.js (see shared/io/condor-io.js), so a
  // practice's figure survives a suite backup/restore. Sweep has no io file
  // today (its other keys are all transient/PHI and were never meant to be
  // backed up), and this change's scope was restricted to the sweep module +
  // test files, not options.js/options.html/suite-envelope.js. Allowlisted
  // for now; a follow-up should add shared/io/sweep-io.js (covering just this
  // key) and wire it into doFullExport()/applyEnvelope()/previewEnvelope(),
  // then remove this entry:
  'sweep.qofConfig',

  // Per-machine first-run onboarding state — dismissed/skipped flags.
  // Not user config; deliberately excluded from backups so a restore onto a
  // new machine still offers the setup checklist. Mirrors suite.tour.seenVersion
  // rationale (see side-panel/setup/setup.js):
  'suite.setup',

  // Transient mute timer — ephemeral, resets naturally (suite.quietUntil is removed
  // when clear() is called; restoring it would silently re-mute a new install):
  'suite.quietUntil',

  // Rolling runtime alert log — session-local, not user config. Restoring a stale
  // log onto a new machine would show misleading historical alerts:
  'suite.alertLog',

  // OIR bulk tick-off audit trail — machine-local governance record (ring buffer,
  // last 200) of which outstanding requests were ticked off as resulted-elsewhere,
  // when, and by which matched result. PHI-bearing (patient values + uuid) and
  // session/machine-local by design; restoring it onto another machine would
  // import a misleading historical trail, so it is deliberately not backed up.
  // Mirrors the suite.alertLog rationale. The OIR *config* (oirTests + oir prefs)
  // IS backed up — it rides triagelens.config via triage-io:
  'triagelens.oir.auditLog',

  // Routine-prescription button audit trail (Phase 1.4, H-035 gap fix) —
  // machine-local ring buffer (cap 200) of what the "send to routine
  // prescriptions" macro did on THIS device: task URL/UUID, team, commit
  // mode, timestamp, outcome (committed/highlighted/aborted+reason). Same
  // doctrine as labfiling.auditLog / triagelens.oir.auditLog: it is a
  // per-device governance record, not user config, and restoring it onto
  // another machine would fabricate a misleading "what this macro did here"
  // trail. The routine-rx *config* (teams/lastTeam/commitMode) IS backed up —
  // it rides triagelens.routineRx via triage-io; only the audit log is
  // excluded:
  'triagelens.routinerx.auditLog',

  // F2 Clinical Event Ledger — machine-local ring buffer (cap 5000 events /
  // 90 days) of what the suite displayed or did on THIS machine
  // (shared/event-ledger.js; read/export/clear UI in the Options "Event
  // ledger" card). Deliberately EXCLUDED from suite backup — same doctrine as
  // labfiling.auditLog and triagelens.oir.auditLog: it contains patient UUIDs,
  // and restoring an event ledger onto another machine would fabricate a
  // misleading "what was shown here" record. The exclusion is stated in the
  // user-facing disclosure block in options.html:
  'ledger.events',
  // Day-sharded ledger layout (audit H12, v3.176.4): the shard directory key.
  // The per-day shard keys themselves ('ledger.events.<YYYY-MM-DD>') are built
  // dynamically and never appear as literals, so this scanner cannot see them;
  // they follow the exact same never-backed-up doctrine as ledger.events:
  'ledger.shardIndex',

  // B3/B5 contact & task-age ledgers (shared/contact-ledger.js) — a device-local
  // rolling history of what THIS extension saw in the queues on THIS machine:
  //   ledger.contactLog — patientUuid → distinct task first-seen days (28d window)
  //   ledger.taskAge    — taskUuid → first/last-seen day + task-type slug (14d)
  // Same doctrine as ledger.events / followups.entries: it carries patient/task
  // UUIDs (no names, no free text) and is an observational trail. Restoring it
  // onto another machine would fabricate a false "this patient has contacted us N
  // times"/"we've carried this task N days" history that machine never observed —
  // a wrong-signal hazard, not just useless. Pruned + capped, machine-local BY
  // DESIGN, never backed up:
  'ledger.contactLog',
  'ledger.taskAge',

  // Contacts Management cycling session (content-scripts/contacts-canvas.js "Family cycling"
  // section) — a short-lived, single-key snapshot written right before the browser navigates to
  // the next linked family member's own record, and consumed/cleared on the other side. Carries
  // real patient UUIDs and a family-relationship graph for whichever family the GP is mid-review
  // on — a device-local working record, not user configuration, and restoring it onto another
  // machine days later would resurrect a stale, possibly-wrong mid-review state pointing at
  // patients that machine's user may have no business seeing. Self-pruning (4h TTL, enforced
  // eagerly on every Medicus page load — see checkResumableFamilySession), never backed up:
  'contactsCanvas.familySession',

  // Horizon-1 H2 — DOM-contract runtime canary state (shared/contract-canary.js):
  // per-contract { lastProbe, status, sinceTs, probeCount, failStreak, lastFailTs }
  // written by the content-script probe injected into the live Medicus page.
  // Machine-local diagnostic telemetry — same doctrine as
  // sentinel.extractionBaseline/ledger.events: restoring it onto another
  // machine would import a stale/foreign "is Medicus broken here" verdict
  // that has nothing to do with that machine's actual, current DOM. Surfaced
  // read-only in Options → Suite health (options.html #sect-health):
  'health.contracts',

  // Health-strip acknowledgement (v3.154.1): 7-day snooze of the CURRENT
  // degraded-contract set. Transient by design — restoring it onto another
  // machine (or a fresh install) must NOT silently suppress that machine's
  // own health warning, so it is never backed up:
  'health.stripSnooze',

  // Follow-ups ledger (v3.160.0): personal safety-net reminders carrying
  // patient-identifiable free text + patient UUIDs. Machine-local BY DESIGN
  // (same doctrine as ledger.events): backups are configuration only, never
  // patient-identifiable data, and restoring stale patient reminders onto
  // another machine would surface them out of context. Never backed up:
  'followups.entries',

  // Transactional API connection settings (shared/txn-config.js). Practice-
  // configured, not user-owned suite backup: the caller key is a SECRET the
  // service worker owns; the rest are proxy/environment wiring that a portable
  // backup must never transplant onto another machine (wrong proxy + a leaked
  // key). There is no txn-io.js on purpose — INTENDED-PURPOSE names this path
  // as the one optional egress, dormant by default. See
  // docs/TRANSACTIONAL-API-INTEGRATION.md.
  'txn.integrationMode',
  'txn.environment',
  'txn.proxyUrl',
  'txn.callerKey',
  'txn.userEmail',
]);

// ── Audit ─────────────────────────────────────────────────────────────────────

console.log('\n--- Backup key-coverage audit ---');
console.log(`  App source files with chrome.storage.local: ${usedSourceFiles.length}`);
console.log(`  USED keys found: ${USED.size}`);
console.log(`  COVERED keys in io files: ${COVERED.size}`);
console.log(`  Allowlist size: ${ALLOWLIST.size}`);

const UNCOVERED_REAL = [];
for (const k of USED) {
  if (!COVERED.has(k) && !ALLOWLIST.has(k)) {
    UNCOVERED_REAL.push(k);
  }
}

if (UNCOVERED_REAL.length > 0) {
  console.error('\n  UNCOVERED storage keys (data-loss risk — add to io file or allowlist):');
  UNCOVERED_REAL.forEach((k) => console.error(`    ${k}`));
}

check(
  UNCOVERED_REAL.length === 0,
  `all used storage keys are covered by an io file or the allowlist (${USED.size} used, ${COVERED.size} covered, ${ALLOWLIST.size} allowlisted)`
);

// Sanity: USED and COVERED sets must be non-empty (guards against scan silently failing).
check(USED.size >= 10, `USED set is non-trivially large (got ${USED.size})`);
check(COVERED.size >= 10, `COVERED set is non-trivially large (got ${COVERED.size})`);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
