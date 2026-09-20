// Medicus Suite — Lab Result Catalogue: Lab Filing setup data (practice normal ranges per result x lab x SNOMED code,
// each with its own FILING approval). Phase E, first data step. Nothing reads these yet.
// Run with: node test-lab-catalogue-filing.js

'use strict';
const fs = require('fs');
const path = require('path');
const OV = require('./shared/lab-catalogue-overlay.js');

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
const throwsWith = (fn, re) => {
  try {
    fn();
    return false;
  } catch (e) {
    return re.test(String((e && e.message) || e));
  }
};
const builtin = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'lab-catalogue.json'), 'utf8'));
const snapshot = JSON.stringify(builtin);
const LAB = 'rj700-general-pathology';
const ALP = { result: 'alp', lab: LAB, code: '1000621000000104' }; // u/L
const KEY = OV.filingKey(ALP);
const acting = (ov) => OV.mergeCatalogue(builtin, ov, {});
const inc = (ov) => OV.mergeCatalogue(builtin, ov, { includeUnreviewed: true });
const set = (ov, extra) =>
  OV.setFilingRange(builtin, ov, { ...ALP, low: 30, high: 130, enabled: true, ...(extra || {}) }, '2026-09-22');

console.log('--- shape / sanitise ---');
{
  const e = OV.emptyOverlay();
  check(Array.isArray(e.filing.ranges) && e.filing.ranges.length === 0, 'an empty overlay has an empty filing section');
  check(
    OV.sanitiseOverlay({ schema: 1 }).filing.ranges.length === 0,
    'an overlay saved before this existed reads as having none'
  );
  const m = acting(e);
  check(
    JSON.stringify(m.catalogue) === snapshot,
    'with no filing setup the effective catalogue is byte-for-byte the built-in one'
  );
  const ok = {
    result: 'alp',
    lab: LAB,
    code: '1000621000000104',
    unit: 'u/L',
    low: 30,
    high: 130,
    enabled: true,
    provenance: { source: 'practice', reviewed: false },
  };
  const s = OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: '30', high: '130', junk: 'x' }] } }).filing.ranges[0];
  check(
    s.low === 30 && s.high === 130 && !('junk' in s),
    'numbers typed as text are read as numbers; unknown keys are dropped'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: 'abc' }] } }), /low must be a number/),
    'a non-number is rejected'
  );
  check(
    throwsWith(
      () => OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: 200, high: 100 }] } }),
      /low must not exceed high/
    ),
    'low above high is rejected'
  );
  check(
    throwsWith(
      () => OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: null, high: null, enabled: false }] } }),
      /needs a low and\/or a high value, or autofiling enabled/
    ),
    'an entry with no range AND autofiling off says nothing, so it is rejected'
  );
  check(
    OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: null, high: null, enabled: true }] } }).filing.ranges[0]
      .enabled === true,
    "autofiling can be enabled with NO practice range (the lab's own reference range does the work)"
  );
  check(
    OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: null, high: 5 }] } }).filing.ranges[0].low === null,
    'a one-sided range is fine'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ filing: { ranges: [ok, { ...ok }] } }), /more than one range/),
    'two ranges for the same result / lab / code are rejected'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: 1e12 }] } }), /must be a number/),
    'an absurd number is rejected'
  );
  const evil = JSON.parse(
    '{"filing":{"ranges":[{"result":"alp","lab":"' +
      LAB +
      '","code":"1000621000000104","low":1,"__proto__":{"pwn":1}}]}}'
  );
  OV.sanitiseOverlay(evil);
  check({}.pwn === undefined, 'a prototype-pollution attempt does nothing');
}

console.log('\n--- setting a range ---');
{
  const one = set(OV.emptyOverlay());
  const r = one.filing.ranges[0];
  check(
    r.unit === 'u/L' && r.low === 30 && r.high === 130 && r.enabled === true,
    "a range is stored with the code's unit (snapshot)"
  );
  check(r.provenance.reviewed === false && r.provenance.source === 'practice', 'a new range starts UNAPPROVED');
  check(
    throwsWith(() => set(OV.emptyOverlay(), { result: 'nope' }), /unknown result/),
    'an unknown result is refused'
  );
  check(
    throwsWith(() => set(OV.emptyOverlay(), { lab: 'nope' }), /unknown lab/),
    'an unknown lab is refused'
  );
  check(
    throwsWith(() => set(OV.emptyOverlay(), { code: '999' }), /not one of/),
    "a code that is not one of the result's own codes is refused"
  );
  check(
    throwsWith(() => set(OV.emptyOverlay(), { low: 200, high: 100 }), /must not exceed/),
    'low above high is refused'
  );
  const hb = OV.setFilingRange(builtin, OV.emptyOverlay(), {
    result: 'hba1c',
    lab: LAB,
    code: '999791000000106',
    low: null,
    high: 47,
    enabled: false,
  });
  const hb2 = OV.setFilingRange(builtin, hb, {
    result: 'hba1c',
    lab: LAB,
    code: '1049301000000100',
    low: null,
    high: 47,
  });
  check(hb2.filing.ranges.length === 2, 'each code of a result has its own range (HbA1c has several)');
  check(OV.sanitiseOverlay(one) && JSON.stringify(builtin) === snapshot, 'the built-in catalogue is never touched');
}

console.log('\n--- enable-only entries and clearing ---');
{
  const on = OV.setFilingRange(builtin, OV.emptyOverlay(), { ...ALP, low: null, high: null, enabled: true });
  check(on.filing.ranges.length === 1 && on.filing.ranges[0].low === null, 'an enable-only entry is stored');
  const cleared = OV.setFilingRange(builtin, on, { ...ALP, low: '', high: '', enabled: false });
  check(cleared.filing.ranges.length === 0, 'a blank range with autofiling off removes the entry');
  check(
    OV.setFilingRange(builtin, OV.emptyOverlay(), { ...ALP, low: '', high: '', enabled: false }).filing.ranges
      .length === 0,
    'clearing something that was never set does nothing'
  );
}

console.log('\n--- approval: separate, and withdrawn by any change ---');
{
  const one = set(OV.emptyOverlay());
  check(acting(one).catalogue.filing === undefined, 'an unapproved range does NOT act');
  check(
    acting(one).excluded.some((x) => x.kind === 'filing' && x.reason === 'unreviewed'),
    '…and is listed as excluded (unreviewed)'
  );
  check(inc(one).catalogue.filing.ranges.length === 1, 'the settings page (includeUnreviewed) can see it');
  const ap = OV.approveFilingRange(one, KEY, 'Dr Test', '2026-09-22');
  check(
    ap.filing.ranges[0].provenance.reviewed === true && ap.filing.ranges[0].provenance.reviewedBy === 'Dr Test',
    'approving records who and when'
  );
  const a = acting(ap).catalogue.filing;
  check(
    a && a.ranges.length === 1 && a.ranges[0].low === 30 && a.ranges[0].unit === 'u/L',
    'an approved AND enabled range acts, carrying its unit'
  );
  const off = OV.setFilingRange(builtin, OV.approveFilingRange(set(OV.emptyOverlay(), { enabled: false }), KEY, 'x'), {
    ...ALP,
    low: 30,
    high: 130,
    enabled: false,
  });
  check(
    acting(off).catalogue.filing === undefined && acting(off).excluded.some((x) => x.reason === 'not enabled'),
    'approved but NOT enabled does not act'
  );
  const same = OV.setFilingRange(builtin, ap, { ...ALP, low: 30, high: 130, enabled: true });
  check(same.filing.ranges[0].provenance.reviewed === true, 'saving with nothing changed leaves the approval standing');
  for (const [what, ch] of [
    ['the low', { low: 31 }],
    ['the high', { high: 131 }],
    ['the enabled flag', { enabled: false }],
  ]) {
    const edited = OV.setFilingRange(builtin, ap, { ...ALP, low: 30, high: 130, enabled: true, ...ch });
    check(
      edited.filing.ranges[0].provenance.reviewed === false && !('reviewedBy' in edited.filing.ranges[0].provenance),
      'changing ' + what + ' withdraws the approval'
    );
  }
  check(
    throwsWith(() => OV.approveFilingRange(OV.emptyOverlay(), KEY, 'x'), /not found/),
    'approving something that is not there is an error'
  );
  // separate tokens, both ways
  const withResult = OV.sanitiseOverlay({
    ...ap,
    results: [
      {
        id: 'alp',
        label: 'Alkaline phosphatase',
        valueKind: 'numeric',
        codes: [],
        aliases: [{ text: 'alp' }],
        provenance: { source: 'practice', reviewed: false },
      },
    ],
  });
  check(
    withResult.filing.ranges[0].provenance.reviewed === true,
    'the approval of a range does not depend on the result / test approval state'
  );
  const approvedResult = OV.markReviewed(withResult, 'results', 'alp', 'Dr Test');
  check(
    OV.setFilingRange(builtin, OV.emptyOverlay(), { ...ALP, low: 30, high: 130, enabled: true }).filing.ranges[0]
      .provenance.reviewed === false && approvedResult.filing.ranges[0].provenance.reviewed === true,
    'approving a result or test never approves a range, and approving a range never approves them'
  );
}

console.log('\n--- unit safety ---');
{
  const ap = OV.approveFilingRange(set(OV.emptyOverlay()), KEY, 'x');
  // the same code later carries a different unit (an override of the result)
  const changed = OV.sanitiseOverlay({
    ...ap,
    results: [
      {
        id: 'alp',
        label: 'Alkaline phosphatase',
        valueKind: 'numeric',
        codes: [{ conceptId: '1000621000000104', role: 'primary', unit: 'umol/L' }],
        aliases: [{ text: 'alp' }],
        override: true,
        provenance: { source: 'practice', reviewed: true, reviewedBy: 'x', reviewedAt: '2026-09-22' },
      },
    ],
  });
  const m = acting(changed);
  check(
    m.catalogue.filing === undefined,
    "if the code's unit changes after the range was set, the range no longer acts"
  );
  check(
    m.problems.some((p) => p.kind === 'filing' && /unit changed/.test(p.reason)),
    '…and the settings page is told why'
  );
  const gone = OV.sanitiseOverlay({
    ...ap,
    results: [
      {
        id: 'alp',
        label: 'ALP',
        valueKind: 'numeric',
        codes: [{ conceptId: '999888777', role: 'primary', unit: 'u/L' }],
        aliases: [{ text: 'alp' }],
        override: true,
        provenance: { source: 'practice', reviewed: true },
      },
    ],
  });
  check(
    acting(gone).problems.some((p) => p.kind === 'filing' && /no longer one of/.test(p.reason)),
    'a range for a code that is no longer on the result is excluded, with the reason'
  );
  const lab = OV.sanitiseOverlay({ ...ap, filing: { ranges: [{ ...ap.filing.ranges[0], lab: 'gone-lab' }] } });
  check(
    acting(lab).problems.some((p) => /its lab is gone/.test(p.reason)),
    'a range for a lab that no longer exists is excluded, with the reason'
  );
}

console.log('\n--- inert on the way in, approvals stripped on the way out ---');
{
  const ap = OV.approveFilingRange(set(OV.emptyOverlay()), KEY, 'Dr Test');
  const inert = OV.forceInert(ap);
  check(
    inert.filing.ranges[0].provenance.reviewed === false && inert.filing.ranges[0].enabled === true,
    'a restored / synced range arrives unapproved (its enabled intent travels)'
  );
  check(!('reviewedBy' in inert.filing.ranges[0].provenance), '…with no approver name');
  const out = OV.stripApprovals(ap);
  check(
    out.filing.ranges[0].provenance.reviewed === false && !('reviewedBy' in out.filing.ranges[0].provenance),
    'an export carries no approval and no reviewer name'
  );
  check(ap.filing.ranges[0].provenance.reviewed === true, 'neither mutates its input');
  check(
    OV.summarise(ap).filing.total === 1 &&
      OV.summarise(ap).filing.unreviewed === 0 &&
      OV.summarise(inert).filing.unreviewed === 1,
    'summarise counts them'
  );
}

console.log('\n--- tidy-up ---');
{
  const ap = set(OV.emptyOverlay());
  check(OV.removeFilingRange(ap, KEY).filing.ranges.length === 0, 'a range can be removed');
  check(
    throwsWith(() => OV.removeFilingRange(ap, 'x|y|z'), /not found/),
    'removing one that is not there is an error'
  );
  const own = OV.sanitiseOverlay({
    results: [
      {
        id: 'mine',
        label: 'Mine',
        valueKind: 'numeric',
        codes: [{ conceptId: '123456789', role: 'primary', unit: 'g/L' }],
        aliases: [{ text: 'mine' }],
        provenance: { source: 'practice', reviewed: false },
      },
    ],
    labs: [
      {
        id: 'mylab',
        name: 'My lab',
        identifiers: { performerOrg: 'ZZ9' },
        groupHeadings: [],
        provenance: { source: 'practice', reviewed: false },
      },
    ],
  });
  const withRanges = OV.setFilingRange(
    builtin,
    OV.setFilingRange(builtin, own, { result: 'mine', lab: 'mylab', code: '123456789', low: 1, high: 2 }),
    { result: 'mine', lab: LAB, code: '123456789', low: 1, high: 2 }
  );
  check(withRanges.filing.ranges.length === 2, 'ranges can be set on a practice result and lab');
  check(
    OV.removeEntry(withRanges, 'results', 'mine').filing.ranges.length === 0,
    'deleting a result deletes its ranges'
  );
  const noLab = OV.removeEntry(withRanges, 'labs', 'mylab').filing.ranges;
  check(noLab.length === 1 && noLab[0].lab === LAB, "deleting a lab deletes that lab's ranges only");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
