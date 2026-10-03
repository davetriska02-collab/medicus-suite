// Medicus Suite — Lab Filing on the Lab Result Catalogue (Phase E, stage E0: pure adapter). UNWIRED — nothing in
// the live extension calls this yet. See engine/lab-filing-catalogue.js for the contract.
// Run with: node test-lab-filing-catalogue.js

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');
const OV = require('./shared/lab-catalogue-overlay.js');
const FC = require('./engine/lab-filing-catalogue.js');
const LF = require('./shared/lab-filing-utils.js');

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
// groupHeading defaults to whatever `specimen` ends up being — true for every NAMED group in the real normaliser —
// unless a test passes groupHeading explicitly, which is how a test simulates an UNGROUPED result (specimen: null,
// groupHeading: the result's own name) — see engine/lab-filing-catalogue.js, which reads groupHeading, not specimen.
const result = (over) => {
  const merged = {
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
  };
  if (!over || !('groupHeading' in over)) merged.groupHeading = merged.specimen;
  return merged;
};
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
    Object.keys(res).sort().join(',') === 'blockers,meta,ok,reasonKinds,unapprovedGroups,unresolvedComments',
    'success shape is exactly { ok, blockers, reasonKinds, meta, unresolvedComments, unapprovedGroups }'
  );
  check(
    Array.isArray(res.unresolvedComments) && res.unresolvedComments.length === 0,
    'no unresolved comments on the golden path'
  );
  check(
    Object.keys(res.meta).sort().join(',') === 'groupsUsed,labAwaitingApproval,labId,recognisedCount,testAwaitingApproval,unrecognisedCount',
    'meta shape is exactly { labId, recognisedCount, unrecognisedCount, groupsUsed, labAwaitingApproval, testAwaitingApproval }'
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

console.log(
  '\n--- ungrouped result (specimen: null) is still recognised via its OWN groupHeading (2026-09-26, Nick, live-caught) ---'
);
{
  // A result that arrives from Medicus as a lone ungroupedResults entry gets specimen: null from normalisers.js
  // (untouched — every OTHER consumer, e.g. result-combo's specimen-scope gate, treats null as "unknown, fail
  // open") but groupHeading: its own description. This engine must group by groupHeading, not specimen, or an
  // ungrouped result (AST, live-caught) can never be matched to an approved assisted-filing group no matter what a
  // person registers for it — even though Medicus's own UI renders it under exactly that heading text. Using the
  // already-registered 'LFTs' heading here (an ungrouped result can't name a heading the lab hasn't registered) —
  // the point under test is the grouping mechanism, not this particular heading.
  const ungrouped = result({ specimen: null, groupHeading: 'LFTs' });
  const res = FC.evaluateFilingCatalogue(report([ungrouped]), acting(baseOverlay()));
  check(
    res.ok && res.meta.recognisedCount === 1 && res.meta.unrecognisedCount === 0,
    'an ungrouped result (specimen: null) with its own groupHeading is recognised through an approved group for that heading'
  );
  const notApproved = FC.evaluateFilingCatalogue(
    report([result({ specimen: null, groupHeading: 'LFTs' })]),
    acting(OV.emptyOverlay()) // nothing approved at all
  );
  check(
    notApproved.ok && notApproved.blockers.some((b) => /LFTs.*no approved assisted-filing setup/.test(b)),
    'without an approved group it blocks BY NAME, not the generic no-heading-at-all message — the heading was found via groupHeading, just not approved yet'
  );
}

console.log(
  '\n--- unapprovedGroups: which test to offer opening, for a heading with no approved filing setup (2026-09-26, Nick) ---'
);
{
  const TSH = { name: 'TSH', value: 2.5, rawValue: '2.5', comparator: null, unit: 'mIU/L', code: '1022791000000101' };
  const tshResult = (over) => {
    const merged = { ...result(over), ...TSH, specimen: 'TSH', low: null, high: null, ...over };
    if (!over || !('groupHeading' in over)) merged.groupHeading = merged.specimen;
    return merged;
  };
  const noSetup = FC.evaluateFilingCatalogue(report([tshResult()]), acting(OV.emptyOverlay()));
  check(
    noSetup.ok &&
      noSetup.unapprovedGroups.length === 1 &&
      noSetup.unapprovedGroups[0].heading === 'TSH' &&
      noSetup.unapprovedGroups[0].labId === LAB &&
      noSetup.unapprovedGroups[0].investigationId === 'tft',
    'a heading whose only result resolves BY CODE to exactly one investigation offers that test to open, even though nothing is approved for it yet'
  );
  const noResult = FC.evaluateFilingCatalogue(report([result({ specimen: 'TSH', code: null })]), acting(OV.emptyOverlay()));
  check(
    noResult.ok && noResult.unapprovedGroups.length === 0,
    'a result that does not resolve by code at all offers nothing to open — never a guess'
  );
  const twoTests = FC.evaluateFilingCatalogue(
    report([tshResult(), result({ specimen: 'TSH' })]), // TSH + ALP under the same (wrong) heading
    acting(OV.emptyOverlay())
  );
  check(
    twoTests.ok && twoTests.unapprovedGroups.length === 0,
    'a group whose results resolve to MORE THAN ONE investigation offers nothing to open — ambiguous, not a decision for the suite to make'
  );
  const noHeadingAtAll = FC.evaluateFilingCatalogue(report([tshResult({ specimen: null })]), acting(OV.emptyOverlay()));
  check(
    noHeadingAtAll.ok && noHeadingAtAll.unapprovedGroups.length === 0,
    'a result with no heading at all has nothing to open either'
  );
  const mixed = FC.evaluateFilingCatalogue(
    report([tshResult(), result({ specimen: 'TSH', code: null, name: 'Free text row' })]),
    acting(OV.emptyOverlay())
  );
  check(
    mixed.ok && mixed.unapprovedGroups.length === 0,
    'a coded row plus an uncoded row under the same heading offers no deep link — the uncoded row is not skipped'
  );
  const unknownCode = FC.evaluateFilingCatalogue(
    report([tshResult({ code: 'not-a-real-code' })]),
    acting(OV.emptyOverlay())
  );
  check(
    unknownCode.ok && unknownCode.unapprovedGroups.length === 0,
    'an unknown code offers no deep link'
  );
  const sharedAnalyte = FC.evaluateFilingCatalogue(
    report([result({ specimen: 'Shared panel', groupHeading: 'Shared panel' })]),
    acting(OV.emptyOverlay())
  );
  check(
    sharedAnalyte.ok && sharedAnalyte.unapprovedGroups.length === 0,
    'a code that belongs to more than one test offers no deep link'
  );
  let tshApproved = OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'TSH', enabled: true }, TODAY);
  tshApproved = OV.approveFiling(tshApproved, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'TSH' }), 'Dr Test', TODAY);
  const configured = FC.evaluateFilingCatalogue(report([tshResult()]), acting(tshApproved));
  check(
    configured.ok && configured.unapprovedGroups.length === 0,
    'a heading that already has an approved group is not offered — nothing left to set up'
  );
}

// Clinician A, 2026-10-02, live-caught: Folate and Ferritin showed "no approved assisted-filing setup" on the card while the
// Investigations page showed both set up and APPROVED. The practice had added a "Ferritin" heading to RJ700, which
// resets the lab entry to unreviewed — and an unreviewed lab is dropped from the acting catalogue, heading, filing
// group and all. The card now says WHICH of three things is true.
console.log('\n--- unapprovedGroups: why a heading is not approved — lab awaiting approval, group awaiting approval, or none ---');
{
  const TSHCODE = '1022791000000101';
  const ferr = builtin.investigations.find((i) => i.id === 'tft');
  const ferritinRow = () =>
    result({ name: 'TSH', value: 2.5, rawValue: '2.5', unit: 'mIU/L', code: TSHCODE, low: null, high: null, specimen: null, groupHeading: 'Thyroid stimulating hormone' });
  const pendingView = (o) => OV.mergeCatalogue(builtin, o, { includeUnreviewed: true, includeDisabled: true }).catalogue;
  const withHeading = () =>
    OV.saveInvestigation(builtin, OV.emptyOverlay(), {
      id: 'tft',
      label: ferr.label,
      kind: ferr.kind,
      requestAliases: ferr.requestAliases,
      synonyms: ferr.synonyms,
      headingAliases: ferr.headingAliases,
      exclude: [],
      members: ferr.members,
      note: '',
      labHeadings: [
        { lab: LAB, text: 'TSH' },
        { lab: LAB, text: 'Thyroid stimulating hormone' },
      ],
    }).overlay;

  let o = withHeading();
  o = OV.setFilingGroup(builtin, o, { lab: LAB, heading: 'Thyroid stimulating hormone', enabled: true }, TODAY);
  o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'Thyroid stimulating hormone' }), 'Dr Test', TODAY);
  o.labs.forEach((l) => (l.provenance = { ...l.provenance, reviewed: false })); // the live state: lab never approved
  const labWait = FC.evaluateFilingCatalogue(report([ferritinRow()]), acting(o), { pendingCatalogue: pendingView(o) });
  check(
    labWait.ok && labWait.unapprovedGroups.length === 1 && labWait.unapprovedGroups[0].state === 'lab-awaiting-approval',
    'a heading that exists only on an UNAPPROVED lab entry is reported as lab-awaiting-approval, not as "no setup"'
  );
  check(
    labWait.blockers.some((b) => /awaiting approval/.test(b) && /General Pathology \(RJ700\)/.test(b)) &&
      !labWait.blockers.some((b) => /has no approved assisted-filing setup/.test(b)),
    'the blocker names the lab that is awaiting approval instead of claiming there is no setup'
  );
  check(labWait.reasonKinds.includes('group-not-approved'), 'the reason kind is unchanged (the shadow log keys on it)');
  check(
    labWait.meta.labAwaitingApproval &&
      labWait.meta.labAwaitingApproval.labId === LAB &&
      labWait.meta.labAwaitingApproval.headings.length === 1 &&
      labWait.meta.labAwaitingApproval.headings[0] === 'Thyroid stimulating hormone' &&
      labWait.meta.labAwaitingApproval.texts.every((t) => labWait.blockers.includes(t)),
    'meta.labAwaitingApproval names the lab and the headings sitting on it, with the exact blocker texts they produced'
  );

  let g = withHeading();
  g = OV.setFilingGroup(builtin, g, { lab: LAB, heading: 'Thyroid stimulating hormone', enabled: true }, TODAY);
  g.labs.forEach((l) => (l.provenance = { ...l.provenance, reviewed: true })); // lab approved, group still pending
  const groupWait = FC.evaluateFilingCatalogue(report([ferritinRow()]), acting(g), { pendingCatalogue: pendingView(g) });
  check(
    groupWait.ok && groupWait.unapprovedGroups[0] && groupWait.unapprovedGroups[0].state === 'group-awaiting-approval',
    'an approved lab whose filing group is unapproved is reported as group-awaiting-approval'
  );

  // Clinician A, 2026-10-03, live-caught: HFE gene testing said the LAB needed approving while every lab was approved. The
  // acting catalogue also drops a lab heading whose TEST it does not contain, so the cause was the unapproved test.
  {
    let t = OV.saveInvestigation(builtin, OV.emptyOverlay(), {
      label: 'HFE Gene Testing',
      kind: 'blood',
      requestAliases: [],
      synonyms: [],
      headingAliases: [],
      exclude: [],
      members: [],
      note: '',
      labHeadings: [{ lab: LAB, text: 'HFE gene testing' }],
    }).overlay;
    t.labs.forEach((l) => (l.provenance = { ...l.provenance, reviewed: true })); // every LAB approved; the TEST is not
    const hfe = result({ name: 'HFE gene testing', code: '401085002', specimen: null, groupHeading: 'HFE gene testing', value: NaN, rawValue: 'text' });
    const testWait = FC.evaluateFilingCatalogue(report([hfe]), acting(t), { pendingCatalogue: pendingView(t) });
    const tw = testWait.meta.testAwaitingApproval;
    check(
      testWait.ok && tw && tw.kind === 'test' && tw.headings[0] === 'HFE gene testing' && tw.testLabels[0] === 'HFE Gene Testing',
      'a heading dropped because its TEST is unapproved is reported as the test awaiting approval, not the lab'
    );
    check(testWait.meta.labAwaitingApproval === null, 'and the lab is not blamed when every lab is approved');
    check(
      testWait.blockers.some((b) => /its test \(HFE Gene Testing\) is awaiting approval/.test(b)) &&
        !testWait.blockers.some((b) => /Blood|RJ700\) is awaiting approval/.test(b)),
      'the blocker names the test, so the card can send the person to the test\'s own Review screen'
    );
  }

  const none = FC.evaluateFilingCatalogue(report([ferritinRow()]), acting(OV.emptyOverlay()), {
    pendingCatalogue: pendingView(OV.emptyOverlay()),
  });
  check(
    none.ok && none.unapprovedGroups[0] && none.unapprovedGroups[0].state === 'no-setup' && none.meta.labAwaitingApproval === null,
    'genuinely nothing set up stays no-setup'
  );
  const noPending = FC.evaluateFilingCatalogue(report([ferritinRow()]), acting(o));
  check(
    noPending.ok && noPending.unapprovedGroups[0] && noPending.unapprovedGroups[0].state === 'no-setup',
    'without the pending view the state falls back to no-setup (unchanged behaviour for any caller that does not pass it)'
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
  // r.urgent is stripped as a filing signal. The practice range and a lab flag still block.
  const urgentAbove = FC.evaluateFilingCatalogue(
    report([result({ value: 200, rawValue: '200', urgent: true, isAbove: true })]),
    acting(baseOverlay())
  );
  check(
    urgentAbove.ok && urgentAbove.reasonKinds.includes('above-practice-range'),
    'a value above the practice maximum still blocks when Medicus also set urgent'
  );
  const urgentFlaggedInRange = FC.evaluateFilingCatalogue(
    report([result({ value: 77, urgent: true, isBelow: true })]),
    acting(baseOverlay())
  );
  check(
    urgentFlaggedInRange.ok && urgentFlaggedInRange.reasonKinds.includes('lab-flagged-abnormal'),
    'a lab-flagged in-range result still blocks without the lab-flag override, even if urgent is set'
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
  const explicitOn = FC.evaluateFilingCatalogue(report([result({ isAbove: true })]), acting(overlayWithOverride(true)));
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

console.log(
  '\n--- commentsForWhitelist: offers a checkbox even when the group has no approved filing setup at all (2026-09-26, Nick) ---'
);
{
  const RESIDUE = 'Please repeat in 3 months, new finding';
  const commented = report([result({ text: RESIDUE })]); // LFTs is a KNOWN heading at this lab, but nothing is set up for it
  const none = FC.commentsForWhitelist(commented, acting(OV.emptyOverlay()));
  check(
    none.length === 1 &&
      none[0].name === 'ALP' &&
      none[0].residue === RESIDUE &&
      none[0].labId === LAB &&
      none[0].heading === 'LFTs',
    'a commented result under a KNOWN heading is offered for whitelisting even though the group is not approved (or does not exist) yet — evaluateFilingCatalogue\'s own per-heading loop never even reaches the comment check for an unapproved group'
  );
  const approvedButUnresolved = FC.commentsForWhitelist(commented, acting(baseOverlay()));
  check(
    approvedButUnresolved.length === 1 && approvedButUnresolved[0].residue === RESIDUE,
    'the same holds once the group IS approved but the comment still is not whitelisted (the case evaluateFilingCatalogue itself already covered)'
  );
  const unknownHeading = FC.commentsForWhitelist(
    report([result({ text: RESIDUE, specimen: 'Nonsense heading nobody sends' })]),
    acting(OV.emptyOverlay())
  );
  check(
    unknownHeading.length === 0,
    'a heading the lab has never been recorded as sending at all offers nothing — there is no group entry to attach the whitelist to yet (that case gets the "open this test" button instead, not a checkbox)'
  );
  const benign = FC.commentsForWhitelist(
    report([result({ text: 'Normal, no action required' })]),
    acting(OV.emptyOverlay())
  );
  check(benign.length === 0, 'a benign comment is not offered — nothing to whitelist');
  const noComment = FC.commentsForWhitelist(report([result()]), acting(OV.emptyOverlay()));
  check(noComment.length === 0, 'a result with no comment at all is not offered');
  check(FC.commentsForWhitelist(null, acting(OV.emptyOverlay())).length === 0, 'no report at all -> empty, never a throw');
  check(FC.commentsForWhitelist(commented, null).length === 0, 'no catalogue at all -> empty, never a throw');

  // THE BUG (Nick, 2026-09-26, live-caught the same day as the feature shipped): this used to check "unresolved"
  // with profile:null unconditionally, which ALWAYS returns not-allowed regardless of what is actually saved —
  // so an ALREADY-whitelisted-and-approved comment still offered its checkbox every single time, forever. "I've
  // just clicked again to whitelist that eGFR comment again, reapproved, and the same thing appears."
  let whitelisted = OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'LFTs', allowComments: [RESIDUE] }, TODAY);
  whitelisted = OV.approveFiling(whitelisted, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
  const resolved = FC.commentsForWhitelist(commented, acting(whitelisted));
  check(
    resolved.length === 0,
    'once a comment is genuinely whitelisted (and approved), it is no longer offered — the checkbox must actually reflect group.allowComments, not just "is there any comment at all"'
  );
  // A SECOND commented result under the same heading, still genuinely unresolved, is unaffected by the first one
  // being whitelisted — resolution is per residue, not "the whole heading is done once anything is whitelisted".
  const OTHER_RESIDUE = 'A second, different, genuinely unresolved comment about this LFT result entirely';
  const stillOne = FC.commentsForWhitelist(
    report([result({ text: RESIDUE }), result({ text: OTHER_RESIDUE })]),
    acting(whitelisted)
  );
  check(
    stillOne.length === 1 && stillOne[0].residue !== RESIDUE,
    'a genuinely different, still-unresolved comment under the same heading is still offered — whitelisting one comment does not silently clear every other'
  );
}

console.log(
  '\n--- commentsForWhitelist: "already saved, awaiting approval" is not the same as "never submitted" (2026-09-27, Nick) ---'
);
{
  const pending = (overlay) => OV.mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;
  const RESIDUE = 'Please repeat in 3 months, new finding';
  const commented = report([result({ text: RESIDUE })]);
  // Saved onto the group's allowComments, but never approved — exactly what whitelisting a comment produces: the
  // whole group is sent back to review the moment a new comment is added to it.
  const justSaved = OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'LFTs', allowComments: [RESIDUE] }, TODAY);
  check(
    FC.commentsForWhitelist(commented, acting(justSaved)).every((r) => !r.pending),
    'without a pendingCatalogue argument, nothing is ever marked pending (old callers keep the old behaviour exactly)'
  );
  const withPending = FC.commentsForWhitelist(commented, acting(justSaved), pending(justSaved));
  check(
    withPending.length === 1 && withPending[0].pending === true && withPending[0].investigationId === 'lft',
    'WITH pendingCatalogue supplied, an unapproved comment already saved onto the group is flagged pending, carrying the investigation id to link to — this is the B12/folate case: whitelisting one comment must not make an unrelated pending one look like it was never submitted'
  );
  // Once approved, it is fully resolved — pending must not linger true for something no longer pending.
  const approved = OV.approveFiling(justSaved, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
  check(
    FC.commentsForWhitelist(commented, acting(approved), pending(approved)).length === 0,
    'once approved, the comment is resolved outright (not offered at all, pending or otherwise)'
  );
  // A DIFFERENT, genuinely never-submitted comment under the same heading must not be swept up as "pending" just
  // because something else on that group happens to be.
  const OTHER_RESIDUE = 'A second, different, genuinely never-submitted comment about this LFT result entirely';
  const mixed = FC.commentsForWhitelist(
    report([result({ text: RESIDUE }), result({ text: OTHER_RESIDUE })]),
    acting(justSaved),
    pending(justSaved)
  );
  const other = mixed.find((r) => r.residue === OTHER_RESIDUE);
  check(
    mixed.length === 2 && other && other.pending === false,
    'a genuinely new, never-submitted comment under the same heading is never mistaken for the pending one — pending is per residue text, not per heading'
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
  "\n--- pending (edited-but-not-yet-approved) range/guard must BLOCK, not silently fall back to the lab's own range (Nick, 2026-09-25) ---"
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
  check(
    withOverride.results[0]._labFlagOverridden === true,
    'the override is marked, same traceability as the legacy applyParamOverrides'
  );
  check(
    withOverride !== rep && withOverride.results[0] !== flaggedResult,
    'the input report/result are never mutated — a new copy is returned'
  );

  // r.urgent is not a clinical discriminator here (removed 2026-09-30, Nick: Medicus sets it on virtually every
  // abnormal result indiscriminately, and never on microbiology, so it carried no real signal). It no longer blocks
  // the override, and is itself stripped so downstream severity scoring never sees it either.
  const urgent = FC.applyCatalogueOverrides(report([result({ isBelow: true, value: 77, urgent: true })]), acting(o));
  check(
    urgent.results[0].isBelow === false && urgent.results[0].urgent === false,
    'an urgent flag no longer blocks the override, and is itself cleared, when the group override and a matching range apply'
  );

  const outOfRange = FC.applyCatalogueOverrides(
    report([result({ isBelow: true, value: 10, rawValue: '10' })]),
    acting(o)
  );
  check(
    outOfRange.results[0].isBelow === true,
    'a value genuinely outside the practice range is never cleared just because the group override is on — it only applies when the value is within bounds'
  );

  const censored = FC.applyCatalogueOverrides(
    report([result({ isBelow: true, value: 77, rawValue: '77', comparator: '<' })]),
    acting(o)
  );
  check(
    censored.results[0].isBelow === true,
    'a comparator-censored value never has its lab flag cleared — the true value is only bounded, not equal, to the parse'
  );

  const wrongUnit = FC.applyCatalogueOverrides(
    report([result({ isBelow: true, value: 77, rawValue: '77', unit: 'mg/dL' })]),
    acting(o)
  );
  check(
    wrongUnit.results[0].isBelow === true,
    "a unit that does not positively match the practice range's own unit never clears a flag"
  );

  check(
    FC.applyCatalogueOverrides(report([result()]), acting(o)).results[0].isAbove === false,
    'a result the lab never flagged at all is untouched (nothing to clear) — same shape either way'
  );
}

console.log(
  '\n--- catalogue-only confirm names the practice range that cleared the file, and the lab-flag override when that path applied ---'
);
{
  const cat = acting(baseOverlay());
  const rep = report([result()]);
  const limits = FC.practiceConfirmLimits(rep, cat);
  check(
    limits.parameters.length === 1 &&
      limits.parameters[0].analyte === 'ALP' &&
      limits.parameters[0].low === 30 &&
      limits.parameters[0].high === 130 &&
      limits.paramsOverrideLabFlags === false,
    'the confirm limits are the approved practice range (30–130), not the lab range (20–140), and the override warning is off when the lab did not flag the result'
  );
  const msg = LF.buildFilingConfirmMessage(
    rep,
    {
      name: 'Lab Result Catalogue',
      parameters: limits.parameters,
      paramsOverrideLabFlags: limits.paramsOverrideLabFlags,
      filing: { normalOptionText: 'Normal result, no action required' },
    },
    'confirm'
  );
  check(/≥30 ≤130/.test(msg), 'the confirm dialog prints the practice bounds');
  check(
    !/20–140/.test(msg),
    'the confirm dialog does not fall back to printing the lab range once a practice range cleared the value'
  );

  let o = baseOverlay();
  o = OV.setFilingGroup(builtin, o, { lab: LAB, heading: 'LFTs', enabled: true, overrideLabFlag: true }, TODAY);
  o = OV.approveFiling(o, 'groups', OV.filingGroupKey({ lab: LAB, heading: 'LFTs' }), 'Dr Test', TODAY);
  const flagged = report([result({ isBelow: true })]);
  const over = FC.practiceConfirmLimits(flagged, acting(o));
  check(
    over.paramsOverrideLabFlags === true && over.parameters[0].low === 30 && over.parameters[0].high === 130,
    'when the report-group lab-flag override cleared a flagged value that sits inside the practice range, the confirm profile says so'
  );
  const overMsg = LF.buildFilingConfirmMessage(
    flagged,
    {
      name: 'Lab Result Catalogue',
      parameters: over.parameters,
      paramsOverrideLabFlags: over.paramsOverrideLabFlags,
      filing: { normalOptionText: 'Normal' },
    },
    'confirm'
  );
  check(/≥30 ≤130/.test(overMsg), 'the override confirm still names the practice range');
  check(
    /lab flagged low — accepted by your set range/.test(overMsg),
    'the override confirm shows the lab-flag warning on the analyte the practice range accepted'
  );

  const noOver = FC.practiceConfirmLimits(flagged, cat);
  check(
    noOver.paramsOverrideLabFlags === false,
    'without the report-group switch, a lab flag is not described as accepted'
  );
  const noOverMsg = LF.buildFilingConfirmMessage(
    flagged,
    {
      name: 'Lab Result Catalogue',
      parameters: noOver.parameters,
      paramsOverrideLabFlags: noOver.paramsOverrideLabFlags,
      filing: { normalOptionText: 'Normal' },
    },
    'confirm'
  );
  check(
    !/accepted by your set range/.test(noOverMsg) && /≥30 ≤130/.test(noOverMsg),
    'the warning is absent when the override path did not apply, and the practice range is still the limit shown'
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
