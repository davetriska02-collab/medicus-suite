// Medicus Suite — Lab Filing: union-only combination + shadow log (Phase E, stage E1). UNWIRED elsewhere until this
// file's assertions are joined by wiring tests. See engine/lab-filing-gate.js for the contract.
// Run with: node test-lab-filing-gate.js

'use strict';
const fs = require('fs');
const path = require('path');
const LFG = require('./engine/lab-filing-gate.js');

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

const okResult = (blockers, meta) => ({ ok: true, blockers: blockers || [], reasonKinds: [], meta: meta || {} });
const failResult = (error) => ({ ok: false, error: error || 'boom' });

console.log('--- combineFilingBlockers: union-only ---');
{
  const c1 = LFG.combineFilingBlockers([], okResult([]));
  check(c1.blockers.length === 0 && c1.usedCatalogue === true, 'both clean -> clean, and the catalogue was used');

  const c2 = LFG.combineFilingBlockers(['legacy says no'], okResult([]));
  check(
    c2.blockers.length === 1 && c2.blockers[0] === 'legacy says no' && c2.usedCatalogue === true,
    'the catalogue engine can NEVER remove a legacy blocker — legacy alone blocked, still blocked'
  );

  const c3 = LFG.combineFilingBlockers([], okResult(['catalogue says no']));
  check(
    c3.blockers.length === 1 && c3.blockers[0] === 'catalogue says no',
    'the catalogue engine CAN add a blocker legacy never had'
  );

  const c4 = LFG.combineFilingBlockers(['a'], okResult(['b']));
  check(c4.blockers.length === 2 && c4.blockers.includes('a') && c4.blockers.includes('b'), 'both sets combine');

  const c5 = LFG.combineFilingBlockers(['same'], okResult(['same']));
  check(c5.blockers.length === 1, 'an identical reason from both engines is not duplicated');

  const c6 = LFG.combineFilingBlockers([], failResult('catalogue threw'));
  check(
    c6.blockers.length === 0 && c6.usedCatalogue === false,
    'catalogue ok:false -> legacy alone, NEVER read as "nothing to add" by silently blocking everything'
  );
  const c7 = LFG.combineFilingBlockers(['legacy blocker'], failResult('catalogue threw'));
  check(
    c7.blockers.length === 1 && c7.blockers[0] === 'legacy blocker' && c7.usedCatalogue === false,
    'catalogue ok:false with a legacy blocker present -> the legacy blocker survives untouched'
  );
  const c8 = LFG.combineFilingBlockers(['x'], null);
  check(c8.blockers.length === 1 && c8.usedCatalogue === false, 'no catalogue result at all behaves like ok:false');
}

console.log('\n--- buildShadowLogEntry: shape and the two directions ---');
{
  const clean = LFG.buildShadowLogEntry({
    taskUuid: 't1',
    legacyBlockers: [],
    catalogueResult: okResult([], {
      labId: 'rj700-general-pathology',
      recognisedCount: 3,
      unrecognisedCount: 0,
      groupsUsed: ['LFTs'],
    }),
  });
  check(
    clean.wouldHaveUnblocked === false && clean.wouldHaveAddedBlock === false,
    'both clean -> neither direction fires'
  );
  check(clean.taskUuid === 't1' && clean.labId === 'rj700-general-pathology', 'taskUuid and labId (from meta) carried');
  check(clean.recognisedCount === 3 && clean.unrecognisedCount === 0, 'recognition counts carried from meta');
  check(JSON.stringify(clean.groupsUsed) === '["LFTs"]', 'groupsUsed carried, sorted');
  check(typeof clean.ts === 'string' && !Number.isNaN(Date.parse(clean.ts)), 'ts is a real ISO timestamp');

  const dangerous = LFG.buildShadowLogEntry({
    taskUuid: 't2',
    legacyBlockers: ['ALP is above range'],
    catalogueResult: okResult([], { labId: 'rj700-general-pathology' }),
  });
  check(
    dangerous.wouldHaveUnblocked === true && dangerous.wouldHaveAddedBlock === false,
    'legacy blocks, catalogue would not -> the DANGEROUS direction is flagged (H-080’s whole reason to exist)'
  );

  const safe = LFG.buildShadowLogEntry({
    taskUuid: 't3',
    legacyBlockers: [],
    catalogueResult: okResult(['not set up at this lab'], { labId: 'rj700-general-pathology' }),
  });
  check(
    safe.wouldHaveAddedBlock === true && safe.wouldHaveUnblocked === false,
    'catalogue blocks, legacy would not -> the SAFE direction (stricter, expected, not itself a concern)'
  );

  const bothBlock = LFG.buildShadowLogEntry({
    taskUuid: 't4',
    legacyBlockers: ['x'],
    catalogueResult: okResult(['y'], {}),
  });
  check(
    bothBlock.wouldHaveUnblocked === false && bothBlock.wouldHaveAddedBlock === false,
    'both block (for different reasons or the same one) -> neither direction fires; agreement is not a divergence'
  );

  const problem = LFG.buildShadowLogEntry({ taskUuid: 't5', legacyBlockers: [], catalogueResult: failResult('threw') });
  check(
    problem.catalogueOk === false &&
      problem.catalogueError === 'threw' &&
      problem.wouldHaveUnblocked === false &&
      problem.wouldHaveAddedBlock === false,
    'the catalogue engine failing to evaluate is recorded as its own thing, not silently read as either direction'
  );
}

console.log('\n--- shadow log entries never carry a patient value ---');
{
  const withReasonKinds = LFG.buildShadowLogEntry({
    taskUuid: 't6',
    legacyBlockers: [],
    catalogueResult: {
      ok: true,
      blockers: ['ALP (200 u/L) is above your practice maximum of 130'], // the human sentence — has a value
      reasonKinds: ['above-practice-range'], // the value-free twin — this is what the log must use
      meta: { labId: 'rj700-general-pathology', recognisedCount: 1, unrecognisedCount: 0, groupsUsed: ['LFTs'] },
    },
  });
  const flat = JSON.stringify(withReasonKinds);
  check(!/200/.test(flat), 'the shadow log entry does not repeat the raw result value from the blocker sentence');
  check(!/ALP \(/.test(flat), 'the shadow log entry does not repeat the human blocker sentence at all');
  check(
    JSON.stringify(withReasonKinds.catalogueReasonKinds) === '["above-practice-range"]',
    'catalogueReasonKinds carries only the short, value-free tag'
  );
  const missing = LFG.buildShadowLogEntry({
    taskUuid: 't7',
    legacyBlockers: [],
    catalogueResult: { ok: true, blockers: ['some sentence'], meta: {} }, // reasonKinds accidentally omitted
  });
  check(
    Array.isArray(missing.catalogueReasonKinds) && missing.catalogueReasonKinds.length === 0,
    'a caller that forgets reasonKinds gets an empty array, never a crash and never the blockers text as a fallback'
  );
}

console.log('\n--- never throws on malformed input ---');
{
  check(LFG.combineFilingBlockers(undefined, undefined).blockers.length === 0, 'combine with nothing at all');
  check(
    LFG.combineFilingBlockers('not an array', 'not a result').usedCatalogue === false,
    'combine with garbage types'
  );
  const entry = LFG.buildShadowLogEntry(undefined);
  check(
    entry && entry.taskUuid === null && entry.catalogueOk === false && Array.isArray(entry.groupsUsed),
    'buildShadowLogEntry with no opts at all still returns a well-shaped, value-free entry'
  );
  const garbage = LFG.buildShadowLogEntry({ taskUuid: 123, legacyBlockers: 'nope', catalogueResult: 'nope' });
  check(
    garbage.taskUuid === null && garbage.legacyBlockerCount === 0,
    'wrong-typed fields are read as absent, not thrown on'
  );
}

console.log('\n--- purity: no DOM / chrome.* / fetch / storage in this engine’s own source ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'lab-filing-gate.js'), 'utf8');
  const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/\bchrome\./.test(stripped), 'no chrome.* reference');
  check(!/\bdocument\b/.test(stripped), 'no document reference');
  check(!/\bfetch\(/.test(stripped), 'no fetch(...)');
  check(!/\bstorage\b/i.test(stripped), 'no storage reference');
}

console.log('\n--- wiring: manifest loads the two new engine files before the button script ---');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const group = manifest.content_scripts.find(
    (g) => Array.isArray(g.js) && g.js.includes('content-scripts/triage-lens/lab-file-button.js')
  );
  check(!!group, "lab-file-button.js's content_scripts group was found");
  const idx = (name) => (group ? group.js.indexOf(name) : -1);
  check(
    idx('shared/lab-filing-utils.js') >= 0 &&
      idx('engine/lab-filing-catalogue.js') > idx('shared/lab-filing-utils.js') &&
      idx('engine/lab-filing-gate.js') > idx('engine/lab-filing-catalogue.js') &&
      idx('content-scripts/triage-lens/lab-file-button.js') > idx('engine/lab-filing-gate.js'),
    'load order: lab-filing-utils.js, then the catalogue adapter, then the gate, then the button script'
  );
}

console.log('\n--- wiring: lab-file-button.js runs the shadow log but does not (yet) act on it ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(/const LFC = window\.LabFilingCatalogue/.test(src), 'reads the catalogue adapter global');
  check(/const LFG = window\.LabFilingGate/.test(src), 'reads the gate/shadow-log global');
  check(
    /CATALOGUE_SHADOW_KEY = 'labfiling\.catalogueShadowLog'/.test(src),
    'the shadow log has its OWN storage key, separate from labfiling.auditLog (the real filing audit)'
  );
  check(
    (src.match(/runFilingShadow\(rs, blockers\)/g) || []).length === 2,
    'the shadow evaluation runs from both the poll-time gate (evaluateGate) and the click-time re-verification (onAction)'
  );
  check(
    /LFC\.evaluateFilingCatalogue\(rs\.report, catalogue,/.test(src),
    'the catalogue engine is actually invoked, not just referenced'
  );
  check(
    /LFG\.buildShadowLogEntry\(\{/.test(src) && /chrome\.storage\.local\.set\(\{ \[CATALOGUE_SHADOW_KEY\]/.test(src),
    'a shadow entry is built and written to its own ring buffer, capped like the existing audit log'
  );
  check(
    !/LFG\.combineFilingBlockers/.test(src),
    'combineFilingBlockers is NOT called here yet — this stage is shadow-only, nothing changes what is offered'
  );
  check(
    !/const blockers = \(eff\.fileBlockers \|\| \[\]\)\.concat\(await computeProfileBlockers\(rs, profile\)\)\.concat\(catResult/.test(
      src
    ),
    'the real blockers list is never extended with the catalogue result at this stage'
  );
  check(
    /changes\['labcatalogue\.practice'\]\) resetFilingCatalogue\(\)/.test(src),
    'the cached acting catalogue is invalidated on the same storage change Phase D already listens for'
  );
  check(
    /meds are deliberately NOT fetched here/.test(src),
    'the deliberate scope limit (no meds fetch in shadow mode) is documented in the source, not just in memory'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
