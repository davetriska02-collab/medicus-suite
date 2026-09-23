// Medicus Suite — Lab Filing on the Lab Result Catalogue (Phase E, stage E0: pure adapter). UNWIRED — nothing in
// the live extension calls this yet. See engine/lab-filing-catalogue.js for the contract.
// Run with: node test-lab-filing-catalogue.js

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');
const OV = require('./shared/lab-catalogue-overlay.js');
const FC = require('./engine/lab-filing-catalogue.js');

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

const builtin = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'lab-catalogue.json'), 'utf8'));
const LAB = 'rj700-general-pathology';
const ORG = { organisation: 'RJ700', department: 'General Pathology' };
const ALP = { result: 'alp', lab: LAB, code: '1000621000000104' }; // unit u/L
const TODAY = '2026-09-22';

// A practice with LFTs enabled+approved at this lab, ALP ranged 30-130 (approved), no guards yet.
function baseOverlay() {
  let o = OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'LFTs', enabled: true }, TODAY);
  o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
  o = OV.setFilingRange(builtin, o, { ...ALP, low: 30, high: 130 }, TODAY);
  o = OV.approveFilingRange(o, OV.filingKey(ALP), 'Dr Test', TODAY);
  return o;
}
const acting = (overlay) => OV.mergeCatalogue(builtin, overlay, {}).catalogue;

// A result row in the shape engine/normalisers.js normaliseInvestigationReport() produces.
const result = (over) => ({
  name: 'ALP',
  value: 77,
  rawValue: '77',
  comparator: null,
  unit: 'u/L',
  code: ALP.code,
  low: 20,
  high: 140, // the LAB's own range — deliberately different from the practice's 30-130, so tests can tell which won
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-09-20',
  history: [],
  text: '',
  specimen: 'LFTs',
  ...over,
});
const report = (results, over) => ({ lab: { ...ORG }, results, ...over });

console.log('--- golden: recognised, in range, approved group -> clean ---');
{
  const res = FC.evaluateFilingCatalogue(report([result()]), acting(baseOverlay()));
  check(res.ok === true, 'ok:true');
  check(Array.isArray(res.blockers) && res.blockers.length === 0, 'no blockers when everything checks out');
  check(
    res.meta && res.meta.labId === LAB && res.meta.recognisedCount === 1 && res.meta.unrecognisedCount === 0,
    'meta reports the identified lab and one recognised result'
  );
  check(res.meta.groupsUsed.length === 1 && res.meta.groupsUsed[0] === 'LFTs', 'meta lists the group heading used');
}

console.log('\n--- golden shape ---');
{
  const res = FC.evaluateFilingCatalogue(report([result()]), acting(baseOverlay()));
  check(
    Object.keys(res).sort().join(',') === 'blockers,meta,ok,reasonKinds,unresolvedComments',
    'success shape is exactly { ok, blockers, reasonKinds, meta, unresolvedComments }'
  );
  check(Array.isArray(res.unresolvedComments) && res.unresolvedComments.length === 0, 'no unresolved comments on the golden path');
  check(
    Object.keys(res.meta).sort().join(',') === 'groupsUsed,labId,recognisedCount,unrecognisedCount',
    'meta shape is exactly { labId, recognisedCount, unrecognisedCount, groupsUsed }'
  );
}

console.log('\n--- recognition: by SNOMED code only ---');
{
  const noCode = FC.evaluateFilingCatalogue(report([result({ code: null })]), acting(baseOverlay()));
  check(
    noCode.ok && noCode.blockers.some((b) => /not recognised by SNOMED code/.test(b)),
    'a result with no code is unrecognised — name alone is never enough'
  );
  const badCode = FC.evaluateFilingCatalogue(report([result({ code: '999999' })]), acting(baseOverlay()));
  check(
    badCode.ok && badCode.blockers.some((b) => /not one of the catalogue's known results/.test(b)),
    "a code the catalogue doesn't know blocks, rather than falling back to the name"
  );
}

console.log('\n--- report-group heading gate (H-074 generalised) ---');
{
  const noSetup = FC.evaluateFilingCatalogue(report([result()]), acting(OV.emptyOverlay()));
  check(
    noSetup.ok && noSetup.blockers.some((b) => /LFTs.*no approved assisted-filing setup/.test(b)),
    'no filing setup at all -> every heading blocks, by name, fail-closed'
  );
  let disabled = OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'LFTs', enabled: false }, TODAY);
  const off = FC.evaluateFilingCatalogue(report([result()]), acting(disabled));
  check(
    off.ok && off.blockers.length === 1 && /no approved assisted-filing setup/.test(off.blockers[0]),
    'a group that exists but is switched off still blocks'
  );
  const noHeading = FC.evaluateFilingCatalogue(report([result({ specimen: null })]), acting(baseOverlay()));
  check(
    noHeading.ok && noHeading.blockers.some((b) => /no report-group heading/.test(b)),
    'a result with no heading at all cannot be matched to any group'
  );
}

console.log('\n--- lab identification ---');
{
  const noOrg = FC.evaluateFilingCatalogue(
    report([result()], { lab: { organisation: null, department: null } }),
    acting(baseOverlay())
  );
  check(
    noOrg.ok && noOrg.blockers.length === 1 && /could not identify which lab/.test(noOrg.blockers[0]),
    'no performer organisation on the report at all -> one clear blocker'
  );
  const unknownLab = FC.evaluateFilingCatalogue(
    report([result()], { lab: { organisation: 'Some Unknown Lab', department: null } }),
    acting(baseOverlay())
  );
  check(
    unknownLab.ok && unknownLab.blockers.length === 1 && /not yet set up in the catalogue/.test(unknownLab.blockers[0]),
    'a real-looking lab the catalogue has never heard of -> one clear blocker, not a crash'
  );
}

console.log('\n--- practice range vs the lab’s own range ---');
{
  const above = FC.evaluateFilingCatalogue(report([result({ value: 200, rawValue: '200' })]), acting(baseOverlay()));
  check(
    above.ok && above.blockers.some((b) => /above your practice maximum of 130/.test(b)),
    'above the PRACTICE max (130) blocks even though it is inside the lab’s own range (20-140)'
  );
  const below = FC.evaluateFilingCatalogue(report([result({ value: 25, rawValue: '25' })]), acting(baseOverlay()));
  check(
    below.ok && below.blockers.some((b) => /below your practice minimum of 30/.test(b)),
    'below the practice min blocks'
  );
  const clean = FC.evaluateFilingCatalogue(report([result({ value: 77 })]), acting(baseOverlay()));
  check(
    clean.ok && clean.blockers.length === 0,
    'within the practice range -> clean, regardless of the wider lab range'
  );
}

console.log('\n--- reasonKinds: the value-free twin of blockers, for a log (never a value) ---');
{
  const above = FC.evaluateFilingCatalogue(report([result({ value: 200, rawValue: '200' })]), acting(baseOverlay()));
  check(
    above.ok && above.reasonKinds.length === 1 && above.reasonKinds[0] === 'above-practice-range',
    'a reasonKind is a short tag, not the sentence — and carries none of the blocker text'
  );
  const clean = FC.evaluateFilingCatalogue(report([result({ value: 77 })]), acting(baseOverlay()));
  check(clean.ok && clean.reasonKinds.length === 0, 'clean means no reasonKinds either');
  const noCode = FC.evaluateFilingCatalogue(report([result({ code: null })]), acting(baseOverlay()));
  check(noCode.ok && noCode.reasonKinds[0] === 'unrecognised-code', 'unrecognised-by-code has its own kind');
  // The value-leak guard: every reasonKinds entry, for every scenario this file exercises, must be one of a small
  // known vocabulary — never a number, never anything derived from r.value/r.rawValue.
  const KNOWN_KINDS = new Set([
    'unreadable-row',
    'unrecognised-code',
    'unrecognised-lab',
    'lab-not-set-up',
    'group-not-approved',
    'no-heading',
    'below-practice-range',
    'above-practice-range',
    'lab-flagged-abnormal',
    'no-range-to-judge',
    'trend-exceeded',
    'medicine-exclusion',
    'comment-not-whitelisted',
    'suppressed-text',
  ]);
  const scenarios = [
    FC.evaluateFilingCatalogue(report([result({ value: 25 })]), acting(baseOverlay())),
    FC.evaluateFilingCatalogue(report([result({ specimen: null })]), acting(baseOverlay())),
    FC.evaluateFilingCatalogue(report([result()]), acting(OV.emptyOverlay())),
  ];
  check(
    scenarios.every((s) => s.ok && s.reasonKinds.every((k) => KNOWN_KINDS.has(k) && !/\d/.test(k))),
    'every reasonKind seen across these scenarios is from the known, value-free vocabulary (no digits)'
  );
}

console.log('\n--- unit safety (H-081 control b) ---');
{
  const mismatched = FC.evaluateFilingCatalogue(report([result({ unit: 'mmol/mol' })]), acting(baseOverlay()));
  check(
    mismatched.ok && mismatched.blockers.length === 0,
    'a unit that disagrees with the practice range never applies it, and the lab’s own flags (both false here) pass it clean'
  );
  const mismatchedFlagged = FC.evaluateFilingCatalogue(
    report([result({ unit: 'mmol/mol', isAbove: true })]),
    acting(baseOverlay())
  );
  check(
    mismatchedFlagged.ok && mismatchedFlagged.blockers.some((b) => /flagged by the lab/.test(b)),
    'unit mismatch falls back to the lab’s own flag, which still blocks when the lab says abnormal'
  );
}

console.log('\n--- no practice range at all (numeric requires SOME basis to judge) ---');
{
  // group enabled+APPROVED, but no filing.ranges entry for ALP at all
  function groupOnlyOverlay() {
    let o = OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'LFTs', enabled: true }, TODAY);
    o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
    return o;
  }
  const noRangeAnywhere = FC.evaluateFilingCatalogue(
    report([result({ low: null, high: null })]),
    acting(groupOnlyOverlay())
  );
  check(
    noRangeAnywhere.ok && noRangeAnywhere.blockers.some((b) => /no practice range and no lab reference range/.test(b)),
    'neither a practice range nor a lab reference range -> unknown, blocks (same doctrine as requireRangeForAll)'
  );
  // The lab DOES carry its own reference range on the report (low/high, as it normally would alongside a flag) —
  // just no PRACTICE range has been set. That lab-supplied range is the basis to judge by; the flag says abnormal.
  const labFlagOnly = FC.evaluateFilingCatalogue(
    report([result({ low: 20, high: 140, isAbove: true })]),
    acting(groupOnlyOverlay())
  );
  check(
    labFlagOnly.ok && labFlagOnly.blockers.some((b) => /flagged by the lab/.test(b)),
    'no practice range, but the lab supplies its own range and flags this result abnormal -> blocks'
  );
  const labSaysNormal = FC.evaluateFilingCatalogue(
    report([result({ low: 20, high: 140, isAbove: false, isBelow: false })], {}),
    acting(groupOnlyOverlay())
  );
  check(labSaysNormal.ok && labSaysNormal.blockers.length === 0, 'no practice range, lab says normal -> clean');
}

console.log('\n--- lab-flag override, off by default (H-081 control d) ---');
{
  // overrideLabFlag lives on the test's report-group entry, not per result (moved there 2026-09-25) — one decision
  // per test at a lab.
  const overlayWithOverride = (overrideLabFlag) => {
    let o = baseOverlay();
    o = OV.setFilingGroup(builtin, o, { lab: LAB, heading: 'LFTs', enabled: true, overrideLabFlag }, TODAY);
    o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
    return o;
  };
  const defaultOff = FC.evaluateFilingCatalogue(
    report([result({ isAbove: true })]), // in practice range (77 within 30-130) but lab flagged it
    acting(baseOverlay())
  );
  check(
    defaultOff.ok && defaultOff.blockers.some((b) => /flagged by the lab/.test(b)),
    'in range by our own calc, but the lab flagged it, and override is not set -> still blocks'
  );
  const explicitOn = FC.evaluateFilingCatalogue(
    report([result({ isAbove: true })]),
    acting(overlayWithOverride(true))
  );
  check(
    explicitOn.ok && explicitOn.blockers.length === 0,
    'the same case with overrideLabFlag explicitly approved on the report group -> the practice range wins, clean'
  );
}

console.log('\n--- comparator-censored values fail closed (H-081 controls b/c) ---');
{
  const censored = FC.evaluateFilingCatalogue(
    report([result({ value: 130, rawValue: '>130', comparator: '>' })]),
    acting(baseOverlay())
  );
  check(
    censored.ok && censored.blockers.some((b) => /above your practice maximum/.test(b)),
    '">130" against a practice max of 130 blocks — the true value may exceed the bound'
  );
}

console.log('\n--- trend guard, direction-aware (H-081 control e) ---');
{
  const withTrendGuard = (dir) => {
    let o = baseOverlay();
    o = OV.setFilingGuards(
      builtin,
      o,
      { result: ALP.result, lab: LAB, trendMaxDeltaPct: 20, trendDirection: dir },
      TODAY
    );
    o = OV.approveFiling(o, 'guards', OV.filingGuardKey({ result: ALP.result, lab: LAB }), 'Dr Test', TODAY);
    return o;
  };
  const rose = result({
    value: 100,
    rawValue: '100',
    history: [{ date: '2026-09-01', value: 77, flag: 'normal', unit: 'u/L' }],
  });
  const anyDir = FC.evaluateFilingCatalogue(report([rose]), acting(withTrendGuard('any')));
  check(
    anyDir.ok && anyDir.blockers.some((b) => /has changed/.test(b)),
    "direction 'any' blocks a rise past the threshold"
  );
  const wrongDir = FC.evaluateFilingCatalogue(report([rose]), acting(withTrendGuard('down')));
  check(wrongDir.ok && !wrongDir.blockers.some((b) => /has changed/.test(b)), "direction 'down' does not block a RISE");
  const rightDir = FC.evaluateFilingCatalogue(report([rose]), acting(withTrendGuard('up')));
  check(rightDir.ok && rightDir.blockers.some((b) => /has changed/.test(b)), "direction 'up' blocks a rise");
  const smallMove = result({
    value: 80,
    rawValue: '80',
    history: [{ date: '2026-09-01', value: 77, flag: 'normal', unit: 'u/L' }],
  });
  const underThreshold = FC.evaluateFilingCatalogue(report([smallMove]), acting(withTrendGuard('any')));
  check(
    underThreshold.ok && !underThreshold.blockers.some((b) => /has changed/.test(b)),
    'a move under the threshold never blocks'
  );
}

console.log('\n--- medicine exclusion, reused from the legacy matcher ---');
{
  let o = baseOverlay();
  o = OV.setFilingGuards(builtin, o, { result: ALP.result, lab: LAB, excludeIfMeds: ['methotrexate'] }, TODAY);
  o = OV.approveFiling(o, 'guards', OV.filingGuardKey({ result: ALP.result, lab: LAB }), 'Dr Test', TODAY);
  const onDrug = FC.evaluateFilingCatalogue(report([result()]), acting(o), { meds: ['Methotrexate 10mg tablets'] });
  check(
    onDrug.ok && onDrug.blockers.some((b) => /monitored drug/.test(b)),
    'a medicine on the exclusion list blocks, via the shared legacy matcher'
  );
  const offDrug = FC.evaluateFilingCatalogue(report([result()]), acting(o), { meds: ['Paracetamol 500mg tablets'] });
  check(offDrug.ok && offDrug.blockers.length === 0, 'an unrelated medicine does not block');
}

console.log('\n--- comments, reused from the legacy whole-comment matcher ---');
{
  const NOTE = 'Insufficient historical creatinine data to assess AKI risk';
  let o = baseOverlay();
  o = OV.setFilingGroup(builtin, o, { lab: LAB, heading: 'LFTs', enabled: true, allowComments: [NOTE] }, TODAY);
  o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
  const allowed = FC.evaluateFilingCatalogue(report([result({ text: NOTE })]), acting(o));
  check(allowed.ok && allowed.blockers.length === 0, 'a comment that exactly matches an allowed phrase does not block');
  const notAllowed = FC.evaluateFilingCatalogue(
    report([result({ text: 'Please repeat in 3 months, new finding' })]),
    acting(o)
  );
  check(
    notAllowed.ok && notAllowed.blockers.some((b) => /carries a comment that isn't on the allowed list/.test(b)),
    'a comment not on the list blocks, and the reason quotes the residue'
  );
  check(
    notAllowed.ok &&
      notAllowed.unresolvedComments.length === 1 &&
      notAllowed.unresolvedComments[0].residue === 'Please repeat in 3 months, new finding' &&
      notAllowed.unresolvedComments[0].labId === LAB &&
      notAllowed.unresolvedComments[0].heading === 'LFTs',
    'the unresolved comment is ALSO returned structured — name/residue/lab/heading — for a "whitelist this" UI to act on directly, not just embedded in a human sentence'
  );
  check(allowed.unresolvedComments.length === 0, 'an already-allowed comment produces no unresolved-comment entry');
  // "never offer to file" phrases are now ONE practice-wide list (2026-09-23), not per lab x group.
  let withBlockPhrase = OV.setFilingSuppress(o, { items: ['telephone result'] }, TODAY);
  withBlockPhrase = OV.approveFiling(withBlockPhrase, 'suppress', OV.filingSuppressKey(), 'Dr Test', TODAY);
  const suppressed = FC.evaluateFilingCatalogue(report([result({ text: NOTE })], {}), acting(withBlockPhrase), {
    extraText: 'Discussed as a telephone result with the patient',
  });
  check(
    suppressed.ok && suppressed.blockers.some((b) => /telephone result/.test(b)),
    'a "never offer to file" phrase found in extra page text blocks, even with an otherwise-allowed comment'
  );
  const suppressedOnAnotherHeading = FC.evaluateFilingCatalogue(
    report([result({ text: NOTE, specimen: 'Some other heading with no filing setup at all' })]),
    acting(withBlockPhrase),
    { extraText: 'Discussed as a telephone result with the patient' }
  );
  check(
    suppressedOnAnotherHeading.ok && suppressedOnAnotherHeading.blockers.some((b) => /telephone result/.test(b)),
    'the practice-wide phrase blocks regardless of which heading is on the report, even one with no filing setup'
  );
}

console.log('\n--- fail-closed / never throws ---');
{
  check(
    FC.evaluateFilingCatalogue(null, acting(baseOverlay())).ok === true,
    'no report at all -> ok:true, nothing to block'
  );
  check(
    FC.evaluateFilingCatalogue(report([]), acting(baseOverlay())).ok === true,
    'a report with zero results -> ok:true, no blockers'
  );
  check(FC.evaluateFilingCatalogue(report([result()]), null).ok === false, 'no catalogue at all -> ok:false');
  check(
    FC.evaluateFilingCatalogue(report([result()]), 'not an object').ok === false,
    'a garbage catalogue -> ok:false, not a throw'
  );
  check(
    FC.evaluateFilingCatalogue(report([result()]), {}).ok === false,
    'an empty object fails validation -> ok:false'
  );
  const throwingIndex = {
    byCode: {
      get() {
        throw new Error('boom');
      },
    },
  };
  const spy = require('./shared/lab-catalogue-core.js');
  const realBuild = spy.buildIndex;
  spy.buildIndex = () => throwingIndex;
  try {
    const res = FC.evaluateFilingCatalogue(report([result()]), acting(baseOverlay()));
    check(
      res.ok === false && typeof res.error === 'string',
      'a throwing index is caught -> ok:false with a string error, never an exception'
    );
  } finally {
    spy.buildIndex = realBuild;
  }
  const malformedRow = FC.evaluateFilingCatalogue(report([null, result()]), acting(baseOverlay()));
  check(
    malformedRow.ok &&
      malformedRow.blockers.some((b) => /could not be read at all/.test(b)) &&
      malformedRow.blockers.length === 1,
    'an unreadable result row is its own blocker, not silently dropped, and the readable row alongside it still passes clean'
  );
  check(
    FC.evaluateFilingCatalogue(report([result()]), acting(baseOverlay())).ok === true,
    'the happy path still works after all the fail-closed cases above'
  );
}

console.log(
  '\n--- pending (edited-but-not-yet-approved) range/guard must BLOCK, not silently fall back to the lab\'s own range (Nick, 2026-09-25) ---'
);
{
  const pending = (overlay) => OV.mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;

  // The group is still approved; only the RANGE is edited afterwards, so it alone goes back to awaiting approval.
  let o = baseOverlay();
  o = OV.setFilingRange(builtin, o, { ...ALP, low: 25, high: 125 }, TODAY); // withdraws the range's own approval
  const cat = acting(o);
  const pend = pending(o);
  check(
    !(cat.filing && cat.filing.ranges && cat.filing.ranges.some((r) => r.result === 'alp')),
    'setup check: the acting (approved-only) catalogue no longer carries this range at all'
  );
  check(
    pend.filing.ranges.some((r) => r.result === 'alp' && r.reviewed === false),
    'setup check: the pending catalogue carries it, tagged reviewed:false'
  );

  const withoutPending = FC.evaluateFilingCatalogue(report([result()]), cat);
  check(
    withoutPending.ok && withoutPending.blockers.length === 0,
    "without pendingCatalogue supplied, the old (unsafe) behaviour reproduces: the result's value (77) sits inside " +
      "the LAB's own range (20-140) and isAbove/isBelow are both false, so nothing blocks — this is exactly the gap"
  );

  const withPending = FC.evaluateFilingCatalogue(report([result()]), cat, { pendingCatalogue: pend });
  check(
    withPending.ok && withPending.blockers.some((b) => /awaiting approval/.test(b)),
    'WITH pendingCatalogue, the same report is blocked — a practice range edited after its group was approved is never silently treated as "nothing set"'
  );
  check(
    withPending.reasonKinds.includes('pending-range'),
    'the value-free reason kind (for the shadow log) says exactly why: pending-range'
  );

  // A guard, not a range, edited after approval — same treatment.
  let o2 = baseOverlay();
  o2 = OV.setFilingGuards(builtin, o2, { ...ALP, trendMaxDeltaPct: 20 }, TODAY);
  const cat2 = acting(o2);
  const pend2 = pending(o2);
  const guardBlocked = FC.evaluateFilingCatalogue(report([result()]), cat2, { pendingCatalogue: pend2 });
  check(
    guardBlocked.ok && guardBlocked.reasonKinds.includes('pending-guard'),
    'the same protection applies to a pending (unapproved) safety guard'
  );

  // A result with NO range/guard configured at all still falls back to the lab's own range cleanly — the fix only
  // changes "configured but pending", never "never configured".
  const neverConfigured = FC.evaluateFilingCatalogue(report([result()]), acting(baseOverlay()), {
    pendingCatalogue: pending(baseOverlay()),
  });
  check(
    neverConfigured.ok && neverConfigured.blockers.length === 0,
    'a result with an approved range (the golden path) is completely unaffected — pendingCatalogue only ever adds a check for something that is genuinely pending, never for something already approved'
  );
}

console.log(
  '\n--- applyCatalogueOverrides: the report-group override must reach the baseline severity gate too (Nick, 2026-09-25; moved off the per-result guard onto the group, same day) ---'
);
{
  // ALP flagged below by the lab, but the value (77) sits inside the approved practice range (30-130).
  const flaggedResult = result({ isBelow: true, value: 77, rawValue: '77' });
  const rep = report([flaggedResult]);

  const noOverride = FC.applyCatalogueOverrides(rep, acting(baseOverlay()));
  check(
    noOverride.results[0].isBelow === true && !noOverride.results[0]._labFlagOverridden,
    'with the override NOT set on the report group, the lab flag is left exactly alone — a practice range on its own is never enough (H-081 control d: override is opt-in)'
  );

  let o = baseOverlay();
  o = OV.setFilingGroup(builtin, o, { lab: LAB, heading: 'LFTs', enabled: true, overrideLabFlag: true }, TODAY);
  o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
  const withOverride = FC.applyCatalogueOverrides(rep, acting(o));
  check(
    withOverride.results[0].isBelow === false && withOverride.results[0].isAbove === false,
    'with the group override set AND the value inside the practice range, the lab flag IS cleared — this is what lets the baseline severity re-score to level:none and the result actually auto-file'
  );
  check(withOverride.results[0]._labFlagOverridden === true, 'the override is marked, same traceability as the legacy applyParamOverrides');
  check(withOverride !== rep && withOverride.results[0] !== flaggedResult, 'the input report/result are never mutated — a new copy is returned');

  const urgent = FC.applyCatalogueOverrides(report([result({ isBelow: true, value: 77, urgent: true })]), acting(o));
  check(urgent.results[0].isBelow === true, 'an urgent flag is NEVER cleared, even with the group override and a matching range — same bound as legacy');

  const outOfRange = FC.applyCatalogueOverrides(report([result({ isBelow: true, value: 10, rawValue: '10' })]), acting(o));
  check(
    outOfRange.results[0].isBelow === true,
    'a value genuinely outside the practice range is never cleared just because the group override is on — it only applies when the value is within bounds'
  );

  const censored = FC.applyCatalogueOverrides(
    report([result({ isBelow: true, value: 77, rawValue: '77', comparator: '<' })]),
    acting(o)
  );
  check(censored.results[0].isBelow === true, 'a comparator-censored value never has its lab flag cleared — the true value is only bounded, not equal, to the parse');

  const wrongUnit = FC.applyCatalogueOverrides(
    report([result({ isBelow: true, value: 77, rawValue: '77', unit: 'mg/dL' })]),
    acting(o)
  );
  check(wrongUnit.results[0].isBelow === true, "a unit that does not positively match the practice range's own unit never clears a flag");

  check(
    FC.applyCatalogueOverrides(report([result()]), acting(o)).results[0].isAbove === false,
    'a result the lab never flagged at all is untouched (nothing to clear) — same shape either way'
  );
}

console.log('\n--- purity: no DOM / chrome.* / fetch / storage in this engine’s own source ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'lab-filing-catalogue.js'), 'utf8');
  const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/\bchrome\./.test(stripped), 'no chrome.* reference');
  check(!/\bdocument\b/.test(stripped), 'no document reference');
  check(!/\bfetch\(/.test(stripped), 'no fetch(...)');
  check(!/\bstorage\b/i.test(stripped), 'no storage reference');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
