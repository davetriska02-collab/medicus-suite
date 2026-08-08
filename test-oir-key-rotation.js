// Medicus Suite — OIR test-dictionary publish-time key rotation tests
// Run with: node test-oir-key-rotation.js
//
// shared/io/oir-key-rotation.js is the publish half of the Outstanding
// Investigation Requests test-dictionary sync: an edited test republishes under
// a NEW key (because the apply side never overwrites an existing key's content
// — that key might be a clinician's own local edit) and the superseded PUBLISHED
// content travels with it so the apply side can retire the old copy without
// destroying a local edit.
//
// The three things this file exists to pin, each a verified defect:
//   1. an entry keyed by a BUILT-IN test key (a disable/extend override, where
//      the key IS the semantics) must NEVER be rotated — rotating
//      {key:'fbc', disabled:true} to 'fbc-2' silently re-enables the built-in
//      on every machine and lands a bogus standalone test;
//   2. the retired ledger is CUMULATIVE — shipping only this publish's
//      rotations strands any machine that was offline for one cycle;
//   3. rotation of clinical config NEVER happens unattended — the helper
//      refuses without an explicit attended:true, so a future call site can't
//      reintroduce it by omission.
//
// Exit-code driven, like every other test-*.js in this repo.

'use strict';

const path = require('path');
const fs = require('fs');

const ROT = require(path.join(__dirname, 'shared', 'io', 'oir-key-rotation.js'));
const { TEST_DEFS } = require(path.join(__dirname, 'engine', 'outstanding-match.js'));

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

const BUILTIN_KEYS = TEST_DEFS.map((d) => d.key);
const attended = (over) => Object.assign({ attended: true, builtinKeys: BUILTIN_KEYS }, over || {});

// ── 1. Unattended rotation is refused outright (F5) ──────────────────────────
console.log('\n--- rotation never runs unattended ---');
{
  const local = [{ key: 'crp_custom', label: 'CRP', req: ['crp'], edited: true }];
  const published = [{ key: 'crp_custom', label: 'CRP', req: ['crp'] }];
  check(
    ROT.rotateEditedOirTestKeys(local, published, { builtinKeys: BUILTIN_KEYS }) === null,
    'no attended flag -> null (rotation of clinical config requires a human present)'
  );
  check(
    ROT.rotateEditedOirTestKeys(local, published, { attended: false, builtinKeys: BUILTIN_KEYS }) === null,
    'attended:false -> null'
  );
  check(
    ROT.rotateEditedOirTestKeys(local, published, { attended: 'yes', builtinKeys: BUILTIN_KEYS }) === null,
    'a truthy-but-not-true attended value is refused (=== true only)'
  );
  check(ROT.rotateEditedOirTestKeys(local, published, attended()) !== null, 'attended:true runs');
}

// ── 2. Fail-safe when the built-in key set cannot be resolved ────────────────
console.log('\n--- built-in key set is mandatory (rotating without it is the hazard) ---');
{
  const local = [{ key: 'fbc', disabled: true }];
  const published = [{ key: 'fbc', disabled: false, req: ['full blood count'] }];
  check(
    ROT.rotateEditedOirTestKeys(local, published, { attended: true, builtinKeys: [] }) === null,
    'an empty built-in key list is treated as a resolution FAILURE, not as "no built-ins" -> null'
  );
  check(
    ROT.rotateEditedOirTestKeys(local, published, { attended: true, builtinKeys: 'fbc' }) === null,
    'a non-array built-in key list -> null'
  );
  const resolved = ROT.rotateEditedOirTestKeys(local, published, { attended: true });
  check(
    resolved !== null && resolved.oirTests[0].key === 'fbc',
    'with no builtinKeys passed, the helper resolves them itself (engine/outstanding-match.js TEST_DEFS)'
  );
}

// ── 3. Missing/absent shared file -> nothing to rotate against ───────────────
console.log('\n--- nothing published yet -> no rotation ---');
{
  check(
    ROT.rotateEditedOirTestKeys([{ key: 'a' }], undefined, attended()) === null,
    'no published test list (first ever publish) -> null, publish local content as-is'
  );
  check(ROT.rotateEditedOirTestKeys(undefined, [{ key: 'a' }], attended()) === null, 'no local test list -> null');
}

// ── 4. A genuinely edited custom test rotates, carrying the superseded content
console.log('\n--- an edited custom test rotates to a new key ---');
{
  const published = [
    { key: 'crp_custom', label: 'CRP', req: ['crp'], rep: ['crp'], analytes: [] },
    { key: 'stable', label: 'Stable', req: ['stable'] },
  ];
  const local = [
    { key: 'crp_custom', label: 'CRP', req: ['crp', 'c reactive protein'], rep: ['crp'], analytes: [] },
    { key: 'stable', label: 'Stable', req: ['stable'] },
  ];
  const r = ROT.rotateEditedOirTestKeys(local, published, attended());
  check(r.rotated === true, 'rotation reported');
  check(
    r.oirTests.find((t) => t.key === 'crp_custom-2') !== undefined,
    'the edited entry is republished under a rotated key (crp_custom-2)'
  );
  check(
    r.oirTests.find((t) => t.key === 'crp_custom-2').req.includes('c reactive protein'),
    'the rotated entry carries the EDITED content'
  );
  check(
    r.oirTests.find((t) => t.key === 'stable') !== undefined && r.oirTests.length === 2,
    'an unedited entry keeps its key and is not duplicated'
  );
  check(r.retiredOirKeys.includes('crp_custom'), 'the superseded key is listed in retiredOirKeys (read-compat)');
  const rec = r.retiredOirTests.find((x) => x.key === 'crp_custom');
  check(!!rec, 'retiredOirTests carries a record for the superseded key');
  check(
    rec && rec.test && rec.test.req.length === 1 && rec.test.req[0] === 'crp',
    'retiredOirTests carries the SUPERSEDED PUBLISHED content (what a stale local copy would equal), not the new content'
  );
  check(r.supersededOirTests.length === 0, 'no built-in override involved -> the in-place ledger stays empty');
}

// ── 5. Rotation never collides with a key already in use ────────────────────
console.log('\n--- rotated keys never collide ---');
{
  const published = [
    { key: 'crp_custom', label: 'A', req: ['one'] },
    { key: 'crp_custom-2', label: 'B', req: ['two'] },
  ];
  const local = [
    { key: 'crp_custom', label: 'A', req: ['one', 'edited'] },
    { key: 'crp_custom-2', label: 'B', req: ['two'] },
  ];
  const r = ROT.rotateEditedOirTestKeys(local, published, attended());
  check(
    r.oirTests.find((t) => t.key === 'crp_custom-3') !== undefined,
    'crp_custom-2 already taken -> rotates to crp_custom-3'
  );
}

// ── 6. BUILT-IN keys are never rotated (F3 — silent clinical regression) ─────
console.log('\n--- a built-in-key override is NEVER rotated ---');
{
  const builtin = BUILTIN_KEYS[0]; // a real built-in key, e.g. 'lipids'
  const published = [{ key: builtin, disabled: false, label: '', req: ['lab name'], rep: [], analytes: [] }];
  const local = [{ key: builtin, disabled: true, label: '', req: [], rep: [], analytes: [] }];
  const r = ROT.rotateEditedOirTestKeys(local, published, attended());
  check(
    r.oirTests.length === 1 && r.oirTests[0].key === builtin,
    `${builtin} keeps its key — the key IS the semantics`
  );
  check(r.oirTests[0].disabled === true, 'the disable override is published as-is (update in place)');
  check(!r.retiredOirKeys.includes(builtin), 'a built-in key is never added to the retired ledger');
  check(r.rotated === false, 'a built-in-only change is not reported as a rotation');
  const sup = r.supersededOirTests.find((x) => x.key === builtin);
  check(!!sup, 'the built-in override records the PREVIOUSLY PUBLISHED copy in supersededOirTests');
  check(
    sup && sup.test && sup.test.disabled === false,
    'supersededOirTests carries the previously published content, so the apply side can tell a stale copy from a local edit'
  );
}

// ── 7. The retired ledger is CUMULATIVE across publishes (F4) ────────────────
console.log('\n--- retired ledger is cumulative, not replaced ---');
{
  const published = [{ key: 'newly_edited', label: 'X', req: ['a'] }];
  const local = [{ key: 'newly_edited', label: 'X', req: ['a', 'b'] }];
  const r = ROT.rotateEditedOirTestKeys(
    local,
    published,
    attended({
      previousRetiredOirTests: [{ key: 'older_one', test: { label: 'Older', req: ['old'] } }],
      previousRetiredOirKeys: ['older_one', 'legacy_bare_key'],
      previousSupersededOirTests: [{ key: 'fbc', test: { disabled: false } }],
    })
  );
  check(
    r.retiredOirTests.some((x) => x.key === 'older_one') && r.retiredOirTests.some((x) => x.key === 'newly_edited'),
    'a previously published retirement survives alongside this publish’s new one'
  );
  check(
    r.retiredOirKeys.includes('legacy_bare_key'),
    'a legacy bare retiredOirKeys entry is carried forward (old installs still honour it)'
  );
  check(
    r.supersededOirTests.some((x) => x.key === 'fbc'),
    'the built-in in-place ledger is cumulative too'
  );

  // Re-publishing with nothing newly rotated must still carry the ledger.
  const r2 = ROT.rotateEditedOirTestKeys(
    [{ key: 'stable', label: 'S', req: ['s'] }],
    [{ key: 'stable', label: 'S', req: ['s'] }],
    attended({ previousRetiredOirTests: r.retiredOirTests, previousRetiredOirKeys: r.retiredOirKeys })
  );
  check(r2.rotated === false, 'a publish with no edits reports no rotation');
  check(
    r2.retiredOirTests.length === r.retiredOirTests.length && r2.retiredOirKeys.length === r.retiredOirKeys.length,
    'a publish with no edits still republishes the whole cumulative ledger (a machine offline for one cycle still retires)'
  );
}

// ── 8. Ledger de-duplication and FIFO cap ───────────────────────────────────
console.log('\n--- ledger de-dupes and is capped FIFO ---');
{
  const dupe = [{ key: 'k', test: { label: 'L' } }];
  const r = ROT.rotateEditedOirTestKeys(
    [{ key: 'k', label: 'L' }],
    [{ key: 'k', label: 'L' }],
    attended({ previousRetiredOirTests: dupe.concat(dupe), previousRetiredOirKeys: ['k', 'k'] })
  );
  check(r.retiredOirTests.length === 1, 'identical ledger records de-dupe');
  check(r.retiredOirKeys.length === 1, 'retiredOirKeys de-dupes');

  const many = [];
  for (let i = 0; i < ROT.LEDGER_CAP + 25; i++) many.push({ key: `k${i}`, test: { label: `L${i}` } });
  const rCap = ROT.rotateEditedOirTestKeys(
    [{ key: 'z', label: 'Z' }],
    [{ key: 'z', label: 'Z' }],
    attended({ previousRetiredOirTests: many })
  );
  check(rCap.retiredOirTests.length === ROT.LEDGER_CAP, `ledger capped at ${ROT.LEDGER_CAP} entries`);
  check(
    rCap.retiredOirTests[0].key === 'k25' && rCap.retiredOirTests[ROT.LEDGER_CAP - 1].key === `k${ROT.LEDGER_CAP + 24}`,
    'the cap drops the OLDEST entries first (FIFO), keeping the most recent retirements'
  );
}

// ── 9. Content comparison ignores the key itself ────────────────────────────
console.log('\n--- content equality ignores the key field ---');
{
  check(
    ROT.testContentEqual({ key: 'a', label: 'X', req: ['1'] }, { key: 'b', label: 'X', req: ['1'] }),
    'same content under different keys compares equal'
  );
  check(
    !ROT.testContentEqual({ key: 'a', label: 'X', req: ['1'] }, { key: 'a', label: 'X', req: ['2'] }),
    'different content compares unequal'
  );
  check(
    ROT.testContentEqual({ key: 'a', label: 'X', req: ['1'] }, { req: ['1'], label: 'X', key: 'a' }),
    'property order does not matter (stable stringify)'
  );
  check(ROT.testContentEqual(null, null), 'null/null compares equal, never throws');
}

// ── 10. Dual-mode: loadable as a classic script (no import/export syntax) ────
console.log('\n--- dual-mode classic script ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'shared', 'io', 'oir-key-rotation.js'), 'utf8');
  check(!/^\s*(import|export)\s/m.test(src), 'no ES module syntax — loadable via <script> in the options page');
  check(/self\.OirKeyRotation/.test(src), 'publishes itself as self.OirKeyRotation for the browser');
  check(/module\.exports/.test(src), 'and as module.exports for Node tests');
}

// ── 11. options.js publish integration (source guards) ──────────────────────
// options/options.js's publisher lives inside a page IIFE bound to the DOM, so
// it isn't requireable. These are the same style of source guard as
// test-reception-quick-actions-ui.js: they pin the invariants that a future
// edit could quietly undo, each one a verified defect.
console.log('\n--- options.js publish path ---');
{
  const optionsSrc = fs.readFileSync(path.join(__dirname, 'options', 'options.js'), 'utf8');
  const optionsHtml = fs.readFileSync(path.join(__dirname, 'options', 'options.html'), 'utf8');

  check(
    /<script src="\.\.\/shared\/io\/oir-key-rotation\.js"><\/script>/.test(optionsHtml),
    'options.html loads shared/io/oir-key-rotation.js'
  );
  check(
    /<script src="\.\.\/engine\/outstanding-match\.js"><\/script>/.test(optionsHtml),
    'options.html loads engine/outstanding-match.js (the built-in key set rotation refuses to run without)'
  );
  check(
    !/function _rotateEditedOirTestKeys\(/.test(optionsSrc),
    'the rotation helper no longer lives unreachable inside the options.js IIFE'
  );
  check(
    /OirKeyRotation\.rotateEditedOirTestKeys\(/.test(optionsSrc),
    'options.js calls the extracted, tested rotation helper'
  );
  check(/attended: true/.test(optionsSrc), 'the rotation call passes attended: true explicitly');

  // v3.226.0: doPublish's unattended "auto" branch was retired — that
  // once-daily unattended refresh (F1/F5/F9 below) is now
  // shared/io/pdc-contribute.js's job, and doPublish is attended-only, always
  // a real click. See CHANGELOG v3.226.0 and pdc-contribute.js's own header.
  const doPublish = optionsSrc.match(/async function doPublish\(\) \{[\s\S]*?\r?\n {4}\}\r?\n/);
  check(!!doPublish, 'doPublish() body located for inspection');
  const body = doPublish ? doPublish[0] : '';

  check(!/opts\.auto|const auto =/.test(body), 'doPublish no longer takes an auto/opts parameter — attended-only now');

  const pdcContributeSrc = fs.readFileSync(path.join(__dirname, 'shared', 'io', 'pdc-contribute.js'), 'utf8');

  // F1 — the (now relocated) unattended refresh publishes ONLY the merge-safe
  // pdc payload, carrying every other module forward verbatim from the
  // fetched shared profile.
  check(
    /carriedModules|carried forward VERBATIM|carry-forward/i.test(pdcContributeSrc),
    'pdc-contribute.js carries the other modules forward verbatim rather than republishing this machine’s snapshot'
  );
  // F1 — and skips writing rather than falling back to a raw local snapshot.
  check(
    /no-shared-profile/.test(pdcContributeSrc),
    'pdc-contribute.js skips writing when the shared profile cannot be read (no raw-local-snapshot fallback)'
  );
  // F5 — rotation is structurally impossible from the contribute path: it has
  // no reference to OIR/triage rotation at all, unlike doPublish which is now
  // unconditionally attended (no auto-mode fencing needed any more there).
  check(
    /applyOirRotation\(envelope, sharedProfile\?\.envelope\?\.modules\?\.triage\?\.config\)/.test(body) &&
      /if \(applyModules\.triage\)/.test(body),
    'doPublish still calls OIR rotation for triage (now unconditional — the whole function is attended)'
  );
  check(
    !/OirKeyRotation|applyOirRotation|triagelens\.config/.test(pdcContributeSrc),
    'pdc-contribute.js has no path to OIR key rotation at all — a contribution can never trigger it'
  );
  // F9 — the relocated refresh must not rewrite the shared file when nothing
  // new was learned (the equivalent of the old wroteToSharedFile gate).
  check(
    /no-change/.test(pdcContributeSrc) && /_stableStringify/.test(pdcContributeSrc),
    'pdc-contribute.js skips writing (and re-stamping profileVersion) when the merge produces no change'
  );
  // F10 — the accepted concurrency limitation is recorded next to the write.
  check(
    /last[- ]writer[- ]wins/i.test(body),
    'the accepted last-writer-wins limitation of concurrent publishes is recorded in a comment near the write'
  );
  // F4 — the publisher updates its own local config after a rotating publish,
  // or a second edit before the alarm's self-apply diffs against stale keys and
  // publishes with no rotation at all, resurrecting the duplicate.
  const applyRotation = optionsSrc.match(/async function applyOirRotation\([\s\S]*?\r?\n {4}\}\r?\n/);
  check(!!applyRotation, 'applyOirRotation() body located for inspection');
  check(
    !!applyRotation && /result\.rotated/.test(applyRotation[0]) && /'triagelens\.config'/.test(applyRotation[0]),
    'a rotating publish writes the rotated keys back to the publisher’s own triagelens.config'
  );
  // F7 — Clear-override writes a tombstone rather than just dropping the field.
  check(/overrideCleared/.test(optionsSrc), 'the Clear-override UI path writes an overrideCleared tombstone');
  check(/overrideSetAt/.test(optionsSrc), 'the Set-as-practice-default path timestamps the pin');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed === 0 ? 0 : 1);
