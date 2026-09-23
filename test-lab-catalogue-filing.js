// Medicus Suite — Lab Result Catalogue: Lab Filing setup data (Phase E). Nothing reads these yet.
//   ranges  — a practice normal range per RESULT x LAB x SNOMED CODE (the unit is carried by the code)
//   guards  — trend limit (with direction), medicines, lab-flag override, per RESULT x LAB
//   groups  — lab comments (whitelist + never-file phrases) AND the assisted filing on/off switch, per LAB x report GROUP heading
//   screen  — the wording of Medicus's own filing screen (one setting for the practice)
// Assisted filing is switched on and approved for a TEST at a LAB: Medicus files a whole report group, never a single result.
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
const GKEY = OV.filingGuardKey({ result: 'alp', lab: LAB });
const acting = (ov) => OV.mergeCatalogue(builtin, ov, {});
const inc = (ov) => OV.mergeCatalogue(builtin, ov, { includeUnreviewed: true });
const range = (ov, extra) =>
  OV.setFilingRange(builtin, ov, { ...ALP, low: 30, high: 130, ...(extra || {}) }, '2026-09-22');
const NOTE = 'Insufficient historical creatinine data to assess AKI risk';
const all = (ov) => ['ranges', 'guards', 'groups', 'screen'].flatMap((k) => ov.filing[k]);

console.log('--- shape / sanitise ---');
{
  const e = OV.emptyOverlay();
  check(
    ['ranges', 'guards', 'groups', 'screen'].every((k) => Array.isArray(e.filing[k]) && e.filing[k].length === 0),
    'an empty overlay has an empty filing section'
  );
  check(
    OV.sanitiseOverlay({ schema: 1 }).filing.groups.length === 0,
    'an overlay saved before this existed reads as having none'
  );
  check(
    JSON.stringify(acting(e).catalogue) === snapshot,
    'with no filing setup the effective catalogue is byte-for-byte the built-in one'
  );
  const ok = { ...ALP, unit: 'u/L', low: 30, high: 130, provenance: { source: 'practice', reviewed: false } };
  const s = OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: '30', high: '130', junk: 'x', enabled: true }] } })
    .filing.ranges[0];
  check(
    s.low === 30 && s.high === 130 && !('junk' in s) && !('enabled' in s),
    'numbers typed as text are read as numbers; unknown keys (and the old per-range "enabled") are dropped'
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
    OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: null, high: 5 }] } }).filing.ranges[0].low === null,
    'a one-sided range is fine'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ filing: { ranges: [ok, { ...ok }] } }), /more than one (range|entry)/),
    'two ranges for the same result / lab / code are rejected'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: 1e12 }] } }), /must be a number/),
    'an absurd number is rejected'
  );
  check(
    OV.sanitiseOverlay({ filing: { ranges: [{ ...ok, low: null, high: null, enabled: true }] } }).filing.ranges
      .length === 0,
    'a v3.266.0 range that only said "enabled" (no bounds) is dropped on read, never fatal — the switch is on the group now'
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
  const one = range(OV.emptyOverlay());
  const r = one.filing.ranges[0];
  check(r.unit === 'u/L' && r.low === 30 && r.high === 130, "a range is stored with the code's unit (snapshot)");
  check(r.provenance.reviewed === false && r.provenance.source === 'practice', 'a new range starts UNAPPROVED');
  check(
    throwsWith(() => range(OV.emptyOverlay(), { result: 'nope' }), /unknown result/),
    'an unknown result is refused'
  );
  check(
    throwsWith(() => range(OV.emptyOverlay(), { lab: 'nope' }), /unknown lab/),
    'an unknown lab is refused'
  );
  check(
    throwsWith(() => range(OV.emptyOverlay(), { code: '999' }), /not one of/),
    "a code that is not one of the result's own codes is refused"
  );
  check(
    throwsWith(() => range(OV.emptyOverlay(), { low: 200, high: 100 }), /must not exceed/),
    'low above high is refused'
  );
  const hb = OV.setFilingRange(builtin, OV.emptyOverlay(), {
    result: 'hba1c',
    lab: LAB,
    code: '999791000000106',
    low: null,
    high: 47,
  });
  const hb2 = OV.setFilingRange(builtin, hb, {
    result: 'hba1c',
    lab: LAB,
    code: '1049301000000100',
    low: null,
    high: 47,
  });
  check(hb2.filing.ranges.length === 2, 'each code of a result has its own range (HbA1c has several)');
  check(range(one, { low: '', high: '' }).filing.ranges.length === 0, 'blank boxes clear the range');
  check(
    range(OV.emptyOverlay(), { low: '', high: '' }).filing.ranges.length === 0,
    'clearing something never set does nothing'
  );
  check(JSON.stringify(builtin) === snapshot, 'the built-in catalogue is never touched');
}

console.log('\n--- range approval: separate, withdrawn by any change ---');
{
  const one = range(OV.emptyOverlay());
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
    'an approved range acts, carrying its unit'
  );
  check(
    range(ap).filing.ranges[0].provenance.reviewed === true,
    'saving with nothing changed leaves the approval standing'
  );
  for (const [what, ch] of [
    ['the low', { low: 31 }],
    ['the high', { high: 131 }],
  ]) {
    const edited = range(ap, ch);
    check(
      edited.filing.ranges[0].provenance.reviewed === false && !('reviewedBy' in edited.filing.ranges[0].provenance),
      'changing ' + what + ' withdraws the approval'
    );
  }
  check(
    throwsWith(() => OV.approveFilingRange(OV.emptyOverlay(), KEY, 'x'), /not found/),
    'approving something that is not there is an error'
  );
}

console.log('\n--- unit safety ---');
{
  const ap = OV.approveFilingRange(range(OV.emptyOverlay()), KEY, 'x');
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
    acting(gone).problems.some((p) => /no longer one of/.test(p.reason)),
    'a range for a code that is no longer on the result is excluded, with the reason'
  );
  const lab = OV.sanitiseOverlay({
    ...ap,
    filing: { ...ap.filing, ranges: [{ ...ap.filing.ranges[0], lab: 'gone-lab' }] },
  });
  check(
    acting(lab).problems.some((p) => /its lab is gone/.test(p.reason)),
    'a range for a lab that no longer exists is excluded, with the reason'
  );
}

console.log('\n--- safety guards: per result x lab, with the DIRECTION of a trend ---');
{
  const G = { result: 'alp', lab: LAB };
  const g1 = OV.setFilingGuards(builtin, OV.emptyOverlay(), {
    ...G,
    trendMaxDeltaPct: '20',
    trendDirection: 'down',
    excludeIfMeds: [' lithium ', 'methotrexate'],
  });
  const g = g1.filing.guards[0];
  check(
    g.trendMaxDeltaPct === 20 && g.trendDirection === 'down' && g.excludeIfMeds.join() === 'lithium,methotrexate',
    'a trend limit with its direction and medicine exclusions are stored, tidied'
  );
  check(
    OV.setFilingGuards(builtin, OV.emptyOverlay(), { ...G, trendMaxDeltaPct: 20 }).filing.guards[0].trendDirection ===
      'any',
    'a trend limit with no direction means a change either way'
  );
  check(
    OV.setFilingGuards(builtin, OV.emptyOverlay(), { ...G, excludeIfMeds: ['lithium'] }).filing.guards[0]
      .trendDirection === 'any',
    'a direction without a limit is meaningless and is stored as "any"'
  );
  check(
    throwsWith(
      () => OV.setFilingGuards(builtin, OV.emptyOverlay(), { ...G, trendMaxDeltaPct: 20, trendDirection: 'sideways' }),
      /trendDirection must be one of/
    ),
    'an unknown direction is refused'
  );
  check(
    g.provenance.reviewed === false && acting(g1).catalogue.filing === undefined,
    'new guards start unapproved and do not act'
  );
  const ap = OV.approveFiling(g1, 'guards', GKEY, 'Dr Test');
  check(acting(ap).catalogue.filing.guards[0].trendDirection === 'down', 'approved guards act, direction included');
  check(
    OV.setFilingGuards(builtin, ap, {
      ...G,
      trendMaxDeltaPct: 20,
      trendDirection: 'up',
      excludeIfMeds: ['lithium', 'methotrexate'],
    }).filing.guards[0].provenance.reviewed === false,
    'changing only the direction withdraws the approval'
  );
  check(
    OV.setFilingGuards(builtin, ap, {
      ...G,
      trendMaxDeltaPct: 20,
      trendDirection: 'down',
      excludeIfMeds: ['lithium', 'methotrexate'],
    }).filing.guards[0].provenance.reviewed === true,
    'saving with nothing changed keeps the approval'
  );
  check(
    OV.setFilingGuards(builtin, ap, { ...G, trendMaxDeltaPct: '', excludeIfMeds: [] }).filing.guards.length === 0,
    'no guard set clears the entry'
  );
  check(
    throwsWith(() => OV.setFilingGuards(builtin, OV.emptyOverlay(), { ...G, trendMaxDeltaPct: 0 }), /more than 0/),
    'a zero trend limit is refused'
  );
  check(
    throwsWith(
      () => OV.setFilingGuards(builtin, OV.emptyOverlay(), { ...G, result: 'nope', trendMaxDeltaPct: 5 }),
      /unknown result/
    ),
    'an unknown result is refused'
  );
  const mine = OV.sanitiseOverlay({
    results: [
      {
        id: 'mine',
        label: 'Mine',
        valueKind: 'numeric',
        codes: [],
        aliases: [{ text: 'mine' }],
        provenance: { source: 'practice', reviewed: false },
      },
    ],
  });
  const withGuard = OV.setFilingGuards(builtin, mine, { result: 'mine', lab: LAB, trendMaxDeltaPct: 10 });
  check(
    withGuard.filing.guards.length === 1 && OV.removeEntry(withGuard, 'results', 'mine').filing.guards.length === 0,
    'deleting a result deletes its guards'
  );
}

console.log('\n--- lab groups: comments and the assisted filing switch, per lab x report group heading ---');
{
  const spec = { lab: LAB, heading: 'LFTs', allowComments: [NOTE] };
  const g1 = OV.setFilingGroup(builtin, OV.emptyOverlay(), spec);
  const g = g1.filing.groups[0];
  check(
    g.allowComments[0] === NOTE && g.enabled === false && !('suppressIfText' in g),
    'whitelisted comments are stored per lab and group; assisted filing starts OFF; no suppressIfText here (2026-09-23: that moved to ONE practice-wide list, below)'
  );
  check(g.provenance.reviewed === false && acting(g1).catalogue.filing === undefined, 'unapproved: does not act');
  const key = OV.filingGroupKey({ lab: LAB, heading: 'lfts' });
  check(
    key === OV.filingGroupKey({ lab: LAB, heading: ' LFTs ' }),
    'the group key ignores case and spacing of the heading'
  );
  const ap = OV.approveFiling(g1, 'groups', key, 'Dr Test');
  check(acting(ap).catalogue.filing.groups[0].allowComments.length === 1, 'approved: acts');
  check(
    OV.setFilingGroup(builtin, ap, { ...spec, allowComments: [NOTE, 'a second whitelisted lab comment here'] }).filing
      .groups[0].provenance.reviewed === false,
    'any change withdraws the approval'
  );
  check(
    OV.setFilingGroup(builtin, ap, { ...spec, enabled: true }).filing.groups[0].provenance.reviewed === false,
    'switching assisted filing on withdraws the approval too'
  );
  check(
    OV.setFilingGroup(builtin, OV.emptyOverlay(), { lab: LAB, heading: 'LFTs', enabled: true }).filing.groups[0]
      .enabled === true,
    'a group can be switched on with no comment settings at all'
  );
  check(
    throwsWith(
      () => OV.setFilingGroup(builtin, OV.emptyOverlay(), { ...spec, allowComments: ['normal'] }),
      /too short/
    ),
    'a whitelisted comment that is too short / generic is refused (the same rule as Lab Filing)'
  );
  check(
    throwsWith(
      () => OV.setFilingGroup(builtin, OV.emptyOverlay(), { ...spec, allowComments: ['x '.repeat(1001)] }),
      /2000|characters/
    ),
    'an over-long whitelisted comment is refused, not truncated'
  );
  check(
    throwsWith(
      () => OV.setFilingGroup(builtin, OV.emptyOverlay(), { ...spec, heading: 'Not a real group' }),
      /not a report group heading/
    ),
    'the heading must be one the lab really sends'
  );
  check(
    OV.setFilingGroup(builtin, ap, { lab: LAB, heading: 'LFTs', allowComments: [], enabled: false }).filing.groups
      .length === 0,
    'nothing set (and off) clears the group'
  );
  const myLab = OV.sanitiseOverlay({
    labs: [
      {
        id: 'mylab',
        name: 'My lab',
        identifiers: { performerOrg: 'ZZ9' },
        groupHeadings: [{ text: 'My panel', identifies: ['lft'], mayContain: [] }],
        provenance: { source: 'practice', reviewed: false },
      },
    ],
  });
  const both = OV.setFilingGroup(
    builtin,
    OV.setFilingGroup(builtin, myLab, {
      lab: 'mylab',
      heading: 'My panel',
      allowComments: ['a whitelisted note about this lab panel'],
    }),
    spec
  );
  const gone = OV.removeEntry(both, 'labs', 'mylab');
  check(
    both.filing.groups.length === 2 && gone.filing.groups.length === 1 && gone.filing.groups[0].lab === LAB,
    "deleting a lab deletes that lab's group settings only"
  );
}

console.log('\n--- "never offer to file" phrases: ONE practice-wide list, not per lab x group (Nick, 2026-09-23) ---');
{
  const s1 = OV.setFilingSuppress(OV.emptyOverlay(), { items: ['telephone result', 'call patient'] });
  const s = s1.filing.suppress[0];
  check(
    s.items.length === 2 && s.provenance.reviewed === false,
    'the suppress-phrase list is stored once, practice-wide, and starts unapproved'
  );
  check(OV.filingSuppressKey() === 'suppress', 'the key is fixed — there is only ever one row');
  check(acting(s1).catalogue.filing === undefined, 'unapproved: does not act');
  const key = OV.filingSuppressKey();
  const ap = OV.approveFiling(s1, 'suppress', key, 'Dr Test');
  check(acting(ap).catalogue.filing.suppress[0].items.length === 2, 'approved: acts');
  check(
    OV.setFilingSuppress(ap, { items: ['telephone result'] }).filing.suppress[0].provenance.reviewed === false,
    'any change withdraws the approval'
  );
  check(
    OV.setFilingSuppress(ap, { items: ['telephone result'] }).filing.suppress[0].items.length === 1,
    'the list can be trimmed down'
  );
  check(OV.setFilingSuppress(ap, { items: [] }).filing.suppress.length === 0, 'an empty list clears the entry');
  check(
    throwsWith(() => OV.setFilingSuppress(OV.emptyOverlay(), { items: ['ok'] }), /too short/),
    'a phrase of one or two letters is refused (same floor as before)'
  );
  check(
    OV.setFilingSuppress(OV.emptyOverlay(), { items: [] }).filing.suppress.length === 0,
    'setting an empty list on a fresh overlay is a no-op, not an error'
  );
}

console.log('\n--- Medicus filing-screen wording: one setting, defaults not stored ---');
{
  check(
    OV.FILING_DEFAULT_NORMAL_OPTION === 'Normal result, no action required' &&
      OV.FILING_DEFAULT_FILE_BUTTON === 'File results',
    'the defaults are the standard Medicus wording'
  );
  const same = OV.setFilingScreen(OV.emptyOverlay(), {
    normalOptionText: 'Normal result, no action required',
    fileButtonText: 'File results',
  });
  check(same.filing.screen.length === 0, 'text equal to the standard wording is not stored — nothing to approve');
  const c1 = OV.setFilingScreen(OV.emptyOverlay(), {
    normalOptionText: ' Normal - no action ',
    fileButtonText: 'File results',
  });
  check(
    c1.filing.screen.length === 1 &&
      c1.filing.screen[0].normalOptionText === 'Normal - no action' &&
      c1.filing.screen[0].fileButtonText === '',
    'a changed wording is stored trimmed; the untouched one stays the default'
  );
  check(!('lab' in c1.filing.screen[0]), 'it belongs to no lab');
  check(acting(c1).catalogue.filing === undefined, 'unapproved: does not act');
  const ap = OV.approveFiling(c1, 'screen', OV.filingScreenKey(), 'Dr Test');
  check(acting(ap).catalogue.filing.screen[0].normalOptionText === 'Normal - no action', 'approved: acts');
  check(
    OV.setFilingScreen(ap, { normalOptionText: 'Something else', fileButtonText: '' }).filing.screen[0].provenance
      .reviewed === false,
    'a change withdraws the approval'
  );
  check(
    OV.setFilingScreen(ap, { normalOptionText: '', fileButtonText: '' }).filing.screen.length === 0,
    'back to the defaults removes it'
  );
}

console.log('\n--- assisted filing for a TEST at a LAB: one switch, one approval ---');
{
  const LFT = 'lft';
  const merged = (ov) => inc(ov).catalogue;
  const state = (ov) => OV.filingStateForTest(merged(ov), ov, LFT, LAB);
  const e0 = OV.emptyOverlay();
  const s0 = state(e0);
  check(
    s0.headings.length > 0 &&
      s0.headings.includes('LFTs') &&
      s0.enabled === false &&
      s0.approved === false &&
      s0.pending.length === 0,
    'the report group(s) that identify the test are found; nothing is on or pending yet'
  );
  check(
    OV.filingStateForTest(merged(e0), e0, 'no-such-test', LAB).headings.length === 0,
    'an unknown test has no groups'
  );
  check(
    throwsWith(
      () => OV.setFilingForTest(builtin, e0, 'ferritin', 'not-a-lab', true),
      /no report group heading|unknown/
    ),
    'a test with no group at that lab cannot be switched on'
  );
  const on = OV.setFilingForTest(builtin, e0, LFT, LAB, true);
  const s1 = state(on);
  check(
    s1.enabled === true && s1.approved === false && s1.pending.length === s1.headings.length,
    'switching it on creates the group entries, unapproved, and lists them as pending'
  );
  check(acting(on).catalogue.filing === undefined, '…and nothing acts');
  // ranges / guards of the test's results at the lab join the pending set
  let o = range(on); // alp is a member of lft
  o = OV.setFilingGuards(builtin, o, { result: 'alp', lab: LAB, trendMaxDeltaPct: 20, trendDirection: 'up' });
  const s2 = state(o);
  check(
    s2.pending.some((p) => p.kind === 'ranges') &&
      s2.pending.some((p) => p.kind === 'guards') &&
      s2.pending.some((p) => p.kind === 'groups'),
    'the group, the range and the guards of its results are all awaiting approval'
  );
  // ranges of a result NOT in the test do not belong
  const other = OV.setFilingRange(builtin, on, {
    result: 'hba1c',
    lab: LAB,
    code: '999791000000106',
    low: null,
    high: 47,
  });
  check(
    !state(other).pending.some((p) => p.kind === 'ranges'),
    'a range for a result that is not in the test is not part of its approval'
  );
  const ap = OV.approveFilingForTest(builtin, o, LFT, LAB, 'Dr Test', '2026-09-22');
  const s3 = state(ap);
  check(
    s3.pending.length === 0 && s3.enabled === true && s3.approved === true,
    'one approval covers the groups, ranges and guards of the test at that lab'
  );
  const a = acting(ap).catalogue.filing;
  check(
    a.groups.length >= 1 && a.ranges.length === 1 && a.guards.length === 1 && a.groups.every((g) => g.enabled === true),
    'and they all act'
  );
  check(
    all(ap).every((e) => e.provenance.reviewed === true && e.provenance.reviewedBy === 'Dr Test'),
    'each records who approved'
  );
  // any later change reopens it
  const edited = range(ap, { high: 140 });
  check(
    state(edited).approved === false &&
      state(edited).pending.length === 1 &&
      state(edited).pending[0].kind === 'ranges',
    'changing one range reopens ONLY that item'
  );
  const edGroup = OV.setFilingGroup(builtin, ap, {
    lab: LAB,
    heading: 'LFTs',
    enabled: true,
    allowComments: [NOTE],
  });
  check(
    state(edGroup).approved === false && state(edGroup).pending.some((p) => p.kind === 'groups'),
    'changing a lab comment reopens the group'
  );
  const off = OV.setFilingForTest(builtin, ap, LFT, LAB, false);
  check(
    state(off).enabled === false && !(acting(off).catalogue.filing && acting(off).catalogue.filing.groups),
    'switching it off turns the groups off: nothing about them acts any more'
  );
  // the Medicus wording joins the set once changed
  const withScreen = OV.setFilingScreen(ap, { normalOptionText: 'Normal', fileButtonText: '' });
  check(
    state(withScreen).pending.some((p) => p.kind === 'screen') &&
      OV.approveFilingForTest(builtin, withScreen, LFT, LAB, 'x').filing.screen[0].provenance.reviewed === true,
    'a changed Medicus wording is part of the approval'
  );
  // the practice-wide "never offer to file" list joins the set once changed too (same shape as screen)
  const withSuppress = OV.setFilingSuppress(ap, { items: ['telephone result'] });
  check(
    state(withSuppress).pending.some((p) => p.kind === 'suppress') &&
      OV.approveFilingForTest(builtin, withSuppress, LFT, LAB, 'x').filing.suppress[0].provenance.reviewed === true,
    'a changed suppress-phrase list is part of every test’s approval, the same way the Medicus wording is'
  );
  // shared results: approving via another test also approves the shared range (it is one range)
  const bone = OV.filingStateForTest(merged(ap), ap, 'bone-profile', LAB);
  check(
    bone.pending.every((p) => p.kind !== 'ranges'),
    'ALP is shared with the Bone profile: its (already approved) range is not pending there'
  );
}

console.log(
  '\n--- lab-flag override, per test at a lab: ONE decision on the report group, not per result (moved off the guard, Nick, 2026-09-25) ---'
);
{
  const LFT = 'lft';
  const merged = (ov) => inc(ov).catalogue;
  const state = (ov) => OV.filingStateForTest(merged(ov), ov, LFT, LAB);
  const e0 = OV.emptyOverlay();
  check(state(e0).overrideLabFlag === false, 'off by default, before anything is set up');
  check(
    throwsWith(
      () => OV.setFilingOverrideForTest(builtin, e0, 'ferritin', 'not-a-lab', true),
      /no report group heading|unknown/
    ),
    'a test with no group at that lab cannot have the override set'
  );
  // setting the override before assisted filing is even switched on: creates the group entries (unapproved),
  // override on, enabled left off — the two switches are independent
  const withOverride = OV.setFilingOverrideForTest(builtin, e0, LFT, LAB, true);
  const s1 = state(withOverride);
  check(
    s1.overrideLabFlag === true && s1.enabled === false,
    'the override can be turned on with assisted filing still off — the two switches are independent'
  );
  check(
    acting(withOverride).catalogue.filing === undefined,
    'unapproved: the override does not act until the group is approved'
  );
  // switching assisted filing ON afterwards must not silently wipe the override that was already set
  const on = OV.setFilingForTest(builtin, withOverride, LFT, LAB, true);
  check(
    state(on).overrideLabFlag === true && state(on).enabled === true,
    'switching assisted filing on preserves an override already set on the group (the regression this test guards)'
  );
  const ap = OV.approveFilingForTest(builtin, on, LFT, LAB, 'Dr Test', '2026-09-22');
  check(
    acting(ap).catalogue.filing.groups.every((g) => g.overrideLabFlag === true),
    'once approved, every report group this test arrives in at this lab carries the override'
  );
  // turning the override off afterwards must not silently wipe assisted filing being on
  const overrideOff = OV.setFilingOverrideForTest(builtin, ap, LFT, LAB, false);
  check(
    state(overrideOff).overrideLabFlag === false && state(overrideOff).enabled === true,
    'turning the override off preserves assisted filing staying on'
  );
  check(
    state(overrideOff).approved === false && state(overrideOff).pending.every((p) => p.kind === 'groups'),
    'changing the override reopens approval for the group(s), same as any other change to them'
  );
}

console.log('\n--- inert on the way in, no approvals on the way out ---');
{
  let o = range(OV.emptyOverlay());
  o = OV.setFilingGuards(builtin, o, { result: 'alp', lab: LAB, trendMaxDeltaPct: 20 });
  o = OV.setFilingGroup(builtin, o, { lab: LAB, heading: 'LFTs', enabled: true, allowComments: [NOTE] });
  o = OV.setFilingScreen(o, { fileButtonText: 'File it' });
  o = OV.approveFilingForTest(builtin, o, 'lft', LAB, 'Dr Test');
  check(all(o).length === 4 && all(o).every((e) => e.provenance.reviewed === true), 'all four kinds can be approved');
  check(
    all(OV.forceInert(o)).every((e) => e.provenance.reviewed === false && !('reviewedBy' in e.provenance)),
    'a restore / sync arrives with every filing approval removed'
  );
  check(OV.forceInert(o).filing.groups[0].enabled === true, '…but the switch itself (the intent) travels');
  check(
    all(OV.stripApprovals(o)).every((e) => e.provenance.reviewed === false && !('reviewedBy' in e.provenance)),
    'a backup carries no approval of any kind'
  );
  check(OV.summarise(o).filing.total === 4 && OV.summarise(o).filing.unreviewed === 0, 'summarise counts all four');
  check(all(OV.sanitiseOverlay(JSON.parse(JSON.stringify(o)))).length === 4, 'it survives a save / load round trip');
  const noHeading = OV.sanitiseOverlay({
    ...o,
    filing: { ...o.filing, groups: [{ ...o.filing.groups[0], heading: 'Gone panel' }] },
  });
  check(
    acting(noHeading).problems.some((p) => /no longer has that report group heading/.test(p.reason)),
    'a group whose heading is no longer recorded is excluded, with the reason'
  );
  const legacyLabs = OV.sanitiseOverlay({
    filing: { ranges: [], labs: [{ lab: LAB, fileButtonText: 'x', provenance: {} }] },
  });
  check(
    legacyLabs.filing.screen.length === 0 && !('labs' in legacyLabs.filing),
    'the short-lived per-lab wording is ignored, not fatal'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
