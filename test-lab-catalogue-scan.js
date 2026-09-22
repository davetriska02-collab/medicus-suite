// Medicus Suite — Lab Result Catalogue: learning gaps from real reports (scan + applyFills). Phase C4.
// Run with: node test-lab-catalogue-scan.js

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');
const OV = require('./shared/lab-catalogue-overlay.js');
const SC = require('./shared/lab-catalogue-scan.js');

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
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'lab-catalogue.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const LAB = 'rj700-general-pathology';
const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lab-catalogue', name), 'utf8'));
const fixtureFiles = fs
  .readdirSync(path.join(__dirname, 'fixtures', 'lab-catalogue'))
  .filter((f) => f.startsWith('report-'));
const byPrefix = (p) => fixtureFiles.find((f) => f.startsWith(p));

// the payload shape of /tasks/data/review-investigation-report/overview/{id}
const payloadOf = (report, requests) => ({
  data: {
    investigationReport: report,
    outstandingInvestigationRequestOptions: (requests || report.requests || []).map((r, i) => ({
      label: `${r} (Dr Test Person • 22 Jul 2026, 10:00)`,
      value: 'id-' + i,
    })),
  },
});
const obsOf = (name, requests) => SC.observationFromOverview(payloadOf(fx(name), requests));

// A copy of the catalogue in which the given investigations know only their REQUEST form: no lab headings, no heading
// aliases, and their results have no codes (name only).
function withoutReportForms(cat, ids) {
  const c = clone(cat);
  for (const lab of c.labs)
    lab.groupHeadings = lab.groupHeadings
      .map((g) => ({ ...g, identifies: g.identifies.filter((x) => !ids.includes(x)) }))
      .filter((g) => g.identifies.length || (g.mayContain || []).length);
  const resIds = new Set();
  for (const inv of c.investigations) {
    if (!ids.includes(inv.id)) continue;
    inv.headingAliases = [];
    inv.members.forEach((m) => resIds.add(m.result));
  }
  for (const r of c.results) if (resIds.has(r.id)) r.codes = [];
  return c;
}
const effective = (builtin, overlay) => OV.mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;

console.log('\n── observation keeps structure only ──');
{
  const o = obsOf(byPrefix('report-138'));
  const flat = JSON.stringify(o);
  check(
    o.lab.organisation === 'RJ700' && o.groups.length === 1 && o.groups[0].heading === 'Urine ACR',
    'lab, group and heading are read'
  );
  check(
    o.groups[0].results.length === 3 && o.groups[0].results.every((r) => r.code && r.unit),
    'results carry name, SNOMED code and unit'
  );
  check(
    !/resultValue|resultText|patient|nhsNumber|dateOfBirth|createdBy|Dr Test|22 Jul/.test(flat),
    'no values, comments, dates, patient or staff fields are kept'
  );
  check(
    o.requests.length === 5 &&
      o.requests.includes('Urine Albumin:Creatinine Ratio') &&
      !o.requests.some((r) => /Dr Test/.test(r)),
    'the card requests are read without the requester suffix'
  );
}

console.log('\n── reference-range candidates (Lab Filing setup pre-fill — a suggestion, never a saved range) ──');
{
  const ALP = { conceptId: '1000621000000104', unit: 'u/L' };
  const obsAt = (org, dept, refLow, refHigh) => ({
    lab: { organisation: org, department: dept },
    groups: [
      {
        heading: 'Bone profile',
        specimenType: 'Blood',
        results: [{ name: 'ALP', code: ALP.conceptId, codeText: null, unit: ALP.unit, numeric: true, refLow, refHigh }],
      },
    ],
    ungrouped: [],
    requests: [],
  });
  const cands = SC.referenceRangeCandidates(seed, [obsAt('RJ700', 'General Pathology', 30, 130)]);
  check(
    cands.length === 1 && cands[0].lab === LAB && cands[0].code === ALP.conceptId && cands[0].low === 30 && cands[0].high === 130,
    'a result with a code, at a lab the catalogue knows, yields one candidate'
  );
  check(
    SC.referenceRangeCandidates(seed, [obsAt('Unknown Org', 'Unknown Dept', 1, 2)]).length === 0,
    'a lab the catalogue does not recognise yields no candidate (nothing to key it to)'
  );
  check(
    SC.referenceRangeCandidates(seed, [obsAt('RJ700', 'General Pathology', null, null)]).length === 0,
    'a result with no reference range yields no candidate'
  );
  const two = SC.referenceRangeCandidates(seed, [
    obsAt('RJ700', 'General Pathology', 30, 130),
    obsAt('RJ700', 'General Pathology', 32, 128),
  ]);
  check(
    two.length === 1 && two[0].low === 32 && two[0].high === 128,
    'the same lab x code seen twice keeps one candidate — the later report wins'
  );
  const o = obsOf(byPrefix('report-138'));
  check(
    o.groups[0].results.every((r) => 'refLow' in r && 'refHigh' in r),
    'the observation itself carries refLow/refHigh through from the report (may be null)'
  );
}

console.log('\n── gaps ──');
{
  const stripped = withoutReportForms(seed, ['urine-acr', 'crp']);
  const gaps = SC.findGaps(stripped, { labs: [LAB] });
  const g = gaps.find((x) => x.id === 'urine-acr');
  check(
    g && g.noHeading && g.resultsWithoutCode.length === 3,
    'a test with no lab heading and code-less results is listed'
  );
  check(
    !gaps.some((x) => x.id === 'lipids' && x.noHeading) ||
      seed.labs[0].groupHeadings.some((h) => h.identifies.includes('lipids')),
    'a test that has a lab heading is not flagged for it'
  );
  const otherLab = SC.findGaps(seed, { labs: ['some-other-lab'] });
  check(
    otherLab.length > 0 && otherLab.every((x) => x.noHeading || x.noResults || x.resultsWithoutCode.length),
    'judged against the labs the practice uses (an unused lab has no headings at all)'
  );
}

console.log('\n── learn a heading + results + codes from a report (sole test on the card) ──');
{
  const base = withoutReportForms(seed, ['urine-acr']);
  const obs = [obsOf(byPrefix('report-138'))];
  const an = SC.analyse(base, obs, { targets: ['urine-acr'] });
  check(an.stats.reports === 1 && an.proposals.length === 1, 'one proposal from the one report');
  const p = an.proposals[0];
  check(
    p.target === 'urine-acr' && p.basis === 'recognised' && !p.headingKnown,
    'the group is recognised by its result names as urine ACR, but the lab heading is not yet known'
  );
  check(
    p.heading === 'Urine ACR' && p.lab.id === LAB && p.results.length === 3,
    'heading, lab and three results proposed'
  );
  const { fills } = SC.fillsFromProposals(base, an.proposals);
  check(
    fills.labs[0].headings[0].text === 'Urine ACR' && fills.labs[0].headings[0].identifies[0] === 'urine-acr',
    'the fill adds the heading under the lab'
  );
  const applied = OV.applyFills(base, OV.emptyOverlay(), fills, '2026-09-20');
  check(applied.added.headings === 1 && applied.added.codes === 3, 'applying adds the heading and the three codes');
  check(
    applied.overlay.investigations.every((i) => i.provenance.reviewed === false) &&
      applied.overlay.results.every((r) => r.provenance.reviewed === false) &&
      applied.overlay.labs.every((l) => l.provenance.reviewed === false),
    'everything written is awaiting review'
  );
  check(
    applied.overlay.investigations.concat(applied.overlay.results, applied.overlay.labs).every((e) => !e.override),
    'additive entries — a built-in is never overridden by a scan'
  );
  // approve, then the SAME report is now recognised by heading and by code
  const ap = OV.approveInvestigation(base, applied.overlay, 'urine-acr', 'test').overlay;
  const live = OV.mergeCatalogue(base, ap, {}).catalogue;
  const res = LC.resolveReport(
    LC.buildIndex(live),
    LC.fromInvestigationReportPayload(payloadOf(fx(byPrefix('report-138'))))
  );
  check(
    res.coverage['urine-acr'] && res.coverage['urine-acr'].confidence === 'confident',
    'after approval the report is recognised confidently'
  );
  check(
    res.results.filter((r) => r.confidence === 'coded').length === 3,
    'and all three results resolve by SNOMED code'
  );
  const again = SC.analyse(live, obs, { targets: ['urine-acr'] });
  check(
    again.proposals.length === 0 && again.stats.alreadyComplete >= 0,
    'a second scan finds nothing more to add for it'
  );
}

console.log('\n── reviewing what a scan added (the editor save path must not lose the review carrier) ──');
{
  const base = withoutReportForms(seed, ['urine-acr']);
  const an = SC.analyse(base, [obsOf(byPrefix('report-138'))], { targets: ['urine-acr'] });
  const applied = OV.applyFills(base, OV.emptyOverlay(), SC.fillsFromProposals(base, an.proposals).fills, '2026-09-20');
  check(
    applied.overlay.investigations.length === 1 && applied.overlay.investigations[0].members.length === 0,
    'the scan leaves an empty carrier entry for the test'
  );
  const eff = effective(base, applied.overlay);
  const inv = eff.investigations.find((i) => i.id === 'urine-acr');
  const heads = [];
  for (const lab of eff.labs)
    for (const g of lab.groupHeadings || [])
      if ((g.identifies || []).includes('urine-acr')) heads.push({ lab: lab.id, text: g.text });
  const spec = {
    id: 'urine-acr',
    label: inv.label,
    kind: inv.kind,
    requestAliases: inv.requestAliases,
    headingAliases: inv.headingAliases,
    exclude: inv.exclude,
    members: inv.members,
    labHeadings: heads,
  };
  const saved = OV.saveInvestigation(base, applied.overlay, spec);
  check(
    saved.overlay.investigations.length === 1 && !saved.overlay.investigations[0].override,
    'saving the unchanged form from the review screen keeps the carrier (no override, not dropped)'
  );
  const ap = OV.approveInvestigation(base, saved.overlay, 'urine-acr', 'test');
  check(
    ap.approvedLabs.length === 1 && ap.approvedResults.length === 3,
    'approving it approves the learned heading and the three coded results'
  );
  const live = OV.mergeCatalogue(base, ap.overlay, {});
  check(
    live.problems.length === 0 &&
      live.catalogue.labs.find((l) => l.id === LAB).groupHeadings.some((g) => g.text === 'Urine ACR'),
    'and they are live'
  );
  const rv = OV.revertInvestigation(base, applied.overlay, 'urine-acr');
  check(
    rv.overlay.investigations.length === 0 &&
      !rv.overlay.labs.some((l) => l.groupHeadings.some((g) => g.text === 'Urine ACR')),
    'reverting discards the carrier and the heading it learned'
  );
}

console.log('\n── other tests on the card are never touched ──');
{
  const base = withoutReportForms(seed, ['urine-acr']);
  const an = SC.analyse(base, [obsOf(byPrefix('report-138'))], { targets: ['urine-acr'] });
  const { fills } = SC.fillsFromProposals(base, an.proposals);
  const touched = JSON.stringify(fills);
  check(
    !/bone|lft|liver|immunoglobulin/i.test(touched),
    'the card also lists bone / liver / U&E / immunoglobulins — none of them is proposed'
  );
  check(!an.proposals.some((p) => p.target && p.target !== 'urine-acr'), 'only the selected test is a target');
}

console.log('\n── ambiguity is never guessed; several cards narrow it ──');
{
  // two selected tests, both requested on the card, an unrecognised heading
  const base = clone(seed);
  const mk = (requests) => ({
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [
      {
        heading: 'Mystery panel',
        specimenType: 'Blood',
        results: [
          {
            name: 'Mystery analyte',
            code: '900000000000901',
            codeText: 'Mystery analyte',
            unit: 'U/L',
            numeric: true,
            degraded: false,
          },
        ],
      },
    ],
    ungrouped: [],
    requests,
  });
  const one = SC.analyse(base, [mk(['Ferritin', 'Prolactin Blood'])], { targets: ['ferritin', 'prolactin'] });
  check(
    one.proposals.length === 1 &&
      one.proposals[0].basis === 'ambiguous' &&
      one.proposals[0].target === null &&
      one.proposals[0].candidates.length === 2,
    'one card with two selected tests -> ambiguous, no target'
  );
  const f0 = SC.fillsFromProposals(base, one.proposals);
  check(f0.fills.members.length === 0 && f0.skipped.length === 1, 'an unchosen ambiguous proposal writes nothing');
  const chosen = SC.fillsFromProposals(base, one.proposals, { [one.proposals[0].key]: 'prolactin' });
  check(
    chosen.fills.members.length === 1 && chosen.fills.members[0].investigation === 'prolactin',
    "the person's choice is honoured"
  );
  const two = SC.analyse(base, [mk(['Ferritin', 'Prolactin Blood']), mk(['Ferritin', 'Vitamin D'])], {
    targets: ['ferritin', 'prolactin'],
  });
  check(
    two.proposals[0].target === 'ferritin' && two.proposals[0].basis === 'consistent' && two.proposals[0].reports === 2,
    'the same heading on two cards narrows to the test common to both'
  );
  const sole = SC.analyse(base, [mk(['Ferritin', 'Vitamin D'])], { targets: ['ferritin', 'prolactin'] });
  check(
    sole.proposals.length === 1 && sole.proposals[0].basis === 'sole' && sole.proposals[0].target === 'ferritin',
    'an unrecognised group with exactly one selected test on the card is a "sole" link (vitamin D on the card is not selected)'
  );
  const conflict = SC.analyse(base, [mk(['Ferritin']), mk(['Prolactin Blood'])], {
    targets: ['ferritin', 'prolactin'],
  });
  check(
    conflict.proposals.length === 0 && conflict.unmatched.length === 1 && conflict.unmatched[0].conflict,
    'cards that disagree yield no proposal (listed as unmatched)'
  );
  const none = SC.analyse(base, [mk(['Vitamin D'])], { targets: ['ferritin'] });
  check(
    none.proposals.length === 0 && none.unmatched.length === 1,
    'a heading with no selected test on any card is only listed as unmatched'
  );
}

console.log('\n── a known heading with results lacking codes ──');
{
  const base = withoutReportForms(seed, []);
  // give CRP a code-less alias-only result under a known heading
  const c = clone(seed);
  const crp = c.investigations.find((i) => i.id === 'crp');
  const crpRes = c.results.find((r) => r.id === crp.members[0].result);
  const oldCode = crpRes.codes[0].conceptId;
  crpRes.codes = [];
  const report = {
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [
      {
        heading: 'CRP',
        specimenType: 'Blood',
        results: [
          {
            name: crpRes.aliases[0].text || crpRes.label,
            code: oldCode,
            codeText: crpRes.label,
            unit: 'mg/L',
            numeric: true,
            degraded: false,
          },
        ],
      },
    ],
    ungrouped: [],
    requests: ['C-Reactive Protein Blood'],
  };
  // Recognised only by a lab-NEUTRAL alias ("crp"): the lab's own heading is still a gap, so it is proposed
  const generic = SC.analyse(c, [report], { targets: ['crp'] });
  check(
    generic.proposals.length === 1 &&
      generic.proposals[0].headingKnown === false &&
      generic.proposals[0].target === 'crp',
    'a group recognised only by a lab-neutral heading alias still yields the lab-specific heading to add (the CRP case)'
  );
  c.labs[0].groupHeadings.push({ text: 'CRP', identifies: ['crp'], mayContain: [] });
  const an = SC.analyse(c, [report], { targets: ['crp'] });
  check(
    an.proposals.length === 1 && an.proposals[0].headingKnown === true && an.proposals[0].basis === 'recognised',
    'a heading the catalogue already knows is "recognised" (no heading to add)'
  );
  const { fills } = SC.fillsFromProposals(c, an.proposals);
  check(
    fills.labs.every((l) => l.headings.length === 0) &&
      fills.results.some((r) => r.id === crpRes.id && r.codes[0].conceptId === oldCode),
    'only the missing code is proposed'
  );
  const applied = OV.applyFills(c, OV.emptyOverlay(), fills);
  check(
    applied.overlay.results[0].id === crpRes.id &&
      applied.overlay.results[0].codes[0].role === 'primary' &&
      !applied.overlay.results[0].override,
    'it lands as an additive entry on the result (primary, no override)'
  );
  // nothing to add on a complete catalogue
  const completeCat = clone(seed);
  completeCat.labs[0].groupHeadings.push({ text: 'CRP', identifies: ['crp'], mayContain: [] });
  const complete = SC.analyse(completeCat, [report], { targets: ['crp'] });
  check(
    complete.proposals.length === 0 && complete.stats.alreadyComplete === 1,
    'a complete test is reported as already complete'
  );
}

console.log('\n── roles: a second core result is never added to a test that has one ──');
{
  const c = withoutReportForms(seed, ['prolactin']);
  const test = clone(c);
  // prolactin has one core result already (keeps its code): report carries it plus an extra analyte
  const prl = test.investigations.find((i) => i.id === 'prolactin');
  const core = prl.members.find((m) => m.role === 'core');
  const coreRes = test.results.find((r) => r.id === core.result);
  coreRes.codes = [{ conceptId: '900000000000555', role: 'primary' }];
  const rep = (extra) => ({
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [
      {
        heading: 'Prolactin panel',
        specimenType: 'Blood',
        results: [
          {
            name: 'Prolactin',
            code: '900000000000555',
            codeText: 'Prolactin',
            unit: 'mIU/L',
            numeric: true,
            degraded: false,
          },
          ...extra,
        ],
      },
    ],
    ungrouped: [],
    requests: ['Prolactin Blood'],
  });
  const an = SC.analyse(
    test,
    [
      rep([
        {
          name: 'Macroprolactin',
          code: '900000000000556',
          codeText: 'Macroprolactin',
          unit: 'mIU/L',
          numeric: true,
          degraded: false,
        },
      ]),
    ],
    { targets: ['prolactin'] }
  );
  const { fills } = SC.fillsFromProposals(test, an.proposals);
  check(fills.members.length === 1 && fills.members[0].role === 'optional', 'the extra analyte is added as OPTIONAL');
  // a test with NO members: always-present results become core
  const empty = clone(seed);
  const e1 = empty.investigations.find((i) => i.id === 'ferritin');
  e1.members = [];
  e1.kind = 'other';
  const rep2 = {
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [
      {
        heading: 'Iron stores',
        specimenType: 'Blood',
        results: [
          {
            name: 'Ferritin X',
            code: '900000000000777',
            codeText: 'Ferritin',
            unit: 'ug/L',
            numeric: true,
            degraded: false,
          },
        ],
      },
    ],
    ungrouped: [],
    requests: ['Ferritin'],
  };
  const an2 = SC.analyse(empty, [rep2, rep2], { targets: ['ferritin'] });
  const f2 = SC.fillsFromProposals(empty, an2.proposals).fills;
  check(
    f2.members.length === 1 && f2.members[0].role === 'core',
    'a test with no results gets the always-present result as core'
  );
  const applied = OV.applyFills(empty, OV.emptyOverlay(), f2);
  const live = OV.mergeCatalogue(empty, OV.approveInvestigation(empty, applied.overlay, 'ferritin', 't').overlay, {});
  check(
    live.problems.length === 0 && live.catalogue.investigations.find((i) => i.id === 'ferritin').members.length === 1,
    'and it applies to a valid catalogue'
  );
}

console.log('\n── the sample must fit, and an unrecognised request may be the real owner ──');
{
  const base = clone(seed);
  const res = (name, code, numeric) => ({
    name,
    code,
    codeText: name,
    unit: numeric ? 'U/L' : null,
    numeric: !!numeric,
    degraded: false,
  });
  const mkXray = (requests) => ({
    lab: { organisation: 'RXX1', department: 'Xray' },
    groups: [
      {
        heading: 'Radiography of hand',
        specimenType: null,
        results: [res('Radiography of hand', '900000000000701', false)],
      },
    ],
    ungrouped: [],
    requests,
  });
  const noFit = SC.analyse(base, [mkXray(['Testosterone', 'Hand X-ray'])], { targets: ['testosterone'] });
  check(
    noFit.proposals.length === 0,
    'a radiology group is never offered a blood test as its owner (the hand X-ray screenshot bug)'
  );
  check(
    noFit.unmatched.length === 1 && noFit.unmatched[0].maybe && /Hand X-ray/.test(noFit.unmatched[0].maybe[0]),
    'it is listed as unlinked, naming the unrecognised request it may belong to'
  );
  const knee = SC.analyse(base, [mkXray(['Testosterone', 'Knee X-ray'])], {
    targets: ['testosterone', 'radiology-knee'],
  });
  check(
    knee.proposals.length === 1 && knee.proposals[0].candidates.join() === 'radiology-knee',
    'only the imaging test qualifies when both are selected'
  );

  const mkBlood = (requests) => ({
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [{ heading: 'Odd panel', specimenType: 'Blood', results: [res('Odd analyte', '900000000000702', true)] }],
    ungrouped: [],
    requests,
  });
  const withUnknown = SC.analyse(base, [mkBlood(['Ferritin', 'Zed level'])], { targets: ['ferritin'] });
  const p = withUnknown.proposals[0];
  check(
    p &&
      p.target === null &&
      p.basis === 'ambiguous' &&
      p.candidates.join() === 'ferritin' &&
      p.unknownOnCard.length === 1,
    'an unrecognised request on the card means one selected test is NOT enough to link it — the person confirms'
  );
  const fs2 = SC.fillsFromProposals(base, withUnknown.proposals);
  check(fs2.fills.members.length === 0, 'and nothing is written until they do');
  const differ = SC.analyse(base, [mkBlood(['Ferritin', 'Zed level']), mkBlood(['Ferritin', 'Other thing'])], {
    targets: ['ferritin'],
  });
  check(
    differ.proposals[0].target === 'ferritin' && differ.proposals[0].unknownOnCard.length === 0,
    'unrecognised requests that differ between cards are ruled out, leaving the selected test'
  );
  const wrongKind = SC.analyse(base, [mkBlood(['Ferritin', 'Hand X-ray'])], { targets: ['ferritin'] });
  check(
    wrongKind.proposals[0].target === 'ferritin' && wrongKind.proposals[0].basis === 'sole',
    'an unrecognised request of a different sample (an X-ray) does not cast doubt on a blood group'
  );
}

console.log('\n── unlinked groups and unrecognised requests can become new tests ──');
{
  const base = clone(seed);
  const res = (name, code, numeric) => ({
    name,
    code,
    codeText: name,
    unit: numeric ? 'U/L' : null,
    numeric: !!numeric,
    degraded: false,
  });
  const xray = {
    lab: { organisation: 'RXX1', department: 'Xray' },
    groups: [
      {
        heading: 'Radiography of hand',
        specimenType: null,
        results: [res('Radiography of hand', '900000000000701', false)],
      },
    ],
    ungrouped: [],
    requests: ['Testosterone', 'HAND LT X-ray'],
  };
  const an = SC.analyse(base, [xray], { targets: ['testosterone'] });
  const u = an.unmatched[0];
  check(
    u &&
      u.heading === 'Radiography of hand' &&
      u.kind === 'imaging' &&
      u.results.length === 1 &&
      u.maybe[0] === 'HAND LT X-ray' &&
      u.lab.isNew,
    'an unlinked group carries what is needed to create a test from it (heading, lab, kind, results, suggested request)'
  );
  check(
    an.unknownRequests[0].label === 'HAND LT X-ray' && an.unknownRequests[0].kind === 'imaging',
    'unrecognised requests carry a guessed kind'
  );

  // (1) approve the suggestion: a new test from the request wording + this group
  const approveSuggestion = {
    ...u,
    newTest: { key: 'req:hand lt x ray', label: 'HAND LT X-ray', kind: u.kind, requests: ['HAND LT X-ray'] },
  };
  const { fills } = SC.fillsFromProposals(base, [approveSuggestion]);
  check(
    fills.newInvestigations.length === 1 &&
      fills.members.length === 1 &&
      fills.members[0].role === 'core' &&
      fills.labs[0].newLab.org === 'RXX1',
    'the fill creates the test, its core result and the new lab heading'
  );
  const applied = OV.applyFills(base, OV.emptyOverlay(), fills, '2026-09-21');
  const t = applied.overlay.investigations[0];
  check(
    applied.added.tests === 1 &&
      t.label === 'HAND LT X-ray' &&
      t.kind === 'imaging' &&
      t.requestAliases[0].text === 'HAND LT X-ray' &&
      t.members.length === 1 &&
      t.provenance.reviewed === false,
    'applied: a new imaging test, request wording, one core result, unreviewed'
  );
  check(
    applied.overlay.labs[0].groupHeadings[0].text === 'Radiography of hand' &&
      applied.overlay.labs[0].groupHeadings[0].identifies[0] === t.id,
    'the heading points at the new test id'
  );
  const live = OV.mergeCatalogue(base, OV.approveInvestigation(base, applied.overlay, t.id, 'x').overlay, {});
  check(live.problems.length === 0, 'approving it gives a valid catalogue');
  check(
    LC.resolveRequest(LC.buildIndex(live.catalogue), 'HAND LT X-ray (Dr A • 1 Jan 2026, 10:00)')[0].investigationId ===
      t.id,
    'the request is now recognised'
  );
  const cov = LC.resolveReport(LC.buildIndex(live.catalogue), {
    lab: xray.lab,
    groups: [
      {
        heading: 'Radiography of hand',
        specimenType: null,
        results: [
          {
            name: 'Radiography of hand',
            code: '900000000000701',
            codeText: 'x',
            unit: null,
            resultType: 'text-result',
            hasNumericValue: false,
          },
        ],
      },
    ],
    ungrouped: [],
  });
  check(cov.coverage[t.id] && cov.coverage[t.id].confidence === 'confident', 'and the report is recognised as it');

  // (3) group + results only, no request yet
  const groupOnly = { ...u, newTest: { key: 'grp:' + u.key, label: u.heading, kind: u.kind, requests: [] } };
  const g = OV.applyFills(base, OV.emptyOverlay(), SC.fillsFromProposals(base, [groupOnly]).fills);
  check(
    g.overlay.investigations[0].requestAliases.length === 0 &&
      g.overlay.investigations[0].label === 'Radiography of hand',
    'a group-and-results test can be stored with no request wording yet'
  );

  // request-only tests
  const rq = SC.fillsForRequests(['US Neck', 'Wound Swab MC&S', 'us neck', 'HAND LT X-ray']);
  check(
    rq.newInvestigations.length === 3 &&
      rq.newInvestigations.find((x) => x.label === 'US Neck').kind === 'imaging' &&
      rq.newInvestigations.find((x) => x.label === 'Wound Swab MC&S').kind === 'other',
    'request-only tests: duplicates merged; imaging is imaging, anything needing results starts as "other"'
  );
  const ra = OV.applyFills(base, OV.emptyOverlay(), rq);
  const mr = OV.mergeCatalogue(base, ra.overlay, { includeUnreviewed: true });
  check(
    ra.added.tests === 3 &&
      mr.problems.length === 0 &&
      ra.overlay.investigations.every((i) => i.members.length === 0 && i.provenance.reviewed === false),
    'they apply cleanly as unreviewed request-only tests'
  );
  // ... and a later scan can complete one
  const eff = mr.catalogue;
  const wound = ra.overlay.investigations.find((i) => i.label === 'Wound Swab MC&S');
  const swab = {
    lab: { organisation: 'MB1', department: 'Microbiology' },
    groups: [
      { heading: 'WOUND SWAB CULTURE', specimenType: 'Swab', results: [res('Culture', '900000000000801', false)] },
    ],
    ungrouped: [],
    requests: ['Wound Swab MC&S'],
  };
  const an2 = SC.analyse(eff, [swab], { targets: [wound.id] });
  check(
    an2.proposals.length === 1 && an2.proposals[0].target === wound.id && an2.proposals[0].kind === 'microbiology',
    'a request-only test is then a gap the next scan can fill'
  );
  const f2 = SC.fillsFromProposals(eff, an2.proposals);
  check(
    f2.fills.kinds.length === 1 && f2.fills.kinds[0].kind === 'microbiology',
    'and it takes its sample from what was learned'
  );
  const a2 = OV.applyFills(base, ra.overlay, f2.fills);
  check(
    a2.overlay.investigations.find((i) => i.id === wound.id).kind === 'microbiology' &&
      a2.overlay.investigations.find((i) => i.id === wound.id).members.length === 1,
    'the test becomes microbiology with its result'
  );
  // merge helper
  const merged = SC.mergeFills(rq, fills);
  check(
    merged.newInvestigations.length === 3 && merged.labs.length === 1,
    'fills from several sources merge; the same request is one test'
  );
  const both = OV.applyFills(base, OV.emptyOverlay(), SC.mergeFills(SC.fillsForRequests(['HAND LT X-ray']), fills));
  check(
    both.overlay.investigations.length === 1 && both.overlay.investigations[0].members.length === 1,
    'a request-only test and a group made for the same request become ONE test with its result'
  );
}

console.log('\n── orphanToProposal ──');
{
  const base = clone(seed);
  const res = (name, code, numeric) => ({
    name,
    code,
    codeText: name,
    unit: numeric ? 'U/L' : null,
    numeric: !!numeric,
    degraded: false,
  });
  const xray = {
    lab: { organisation: 'RXX1', department: 'Xray' },
    groups: [
      {
        heading: 'Pelvic echography',
        specimenType: null,
        results: [res('Pelvic echography', '900000000000711', false)],
      },
    ],
    ungrouped: [],
    requests: ['US Pelvis (Transabdominal)', 'Ferritin'],
  };
  const u = SC.analyse(base, [xray], { targets: ['ferritin'] }).unmatched[0];
  check(
    u.kind === 'imaging' && u.maybe.join() === 'US Pelvis (Transabdominal)',
    'imaging group with the unrecognised request on its card'
  );
  check(
    SC.orphanToProposal(u, null) === null && SC.orphanToProposal(u, { type: 'request', label: '  ' }) === null,
    'no decision, no proposal'
  );
  const asRequest = SC.orphanToProposal(u, { type: 'request', label: 'US Pelvis (Transabdominal)' });
  check(
    asRequest.newTest.requests[0] === 'US Pelvis (Transabdominal)' && asRequest.newTest.kind === 'imaging',
    '(1) approve the suggestion -> a new test from that request'
  );
  const other = SC.orphanToProposal(u, { type: 'request', label: 'T.V. Pelvis' });
  check(
    other.newTest.label === 'T.V. Pelvis' && other.newTest.key === 'req:t v pelvis',
    '(2) or match it to a different unrecognised request'
  );
  const existing = SC.orphanToProposal(u, { type: 'test', id: 'radiology-knee' });
  check(existing.target === 'radiology-knee' && !existing.newTest, '(2) or to an existing test');
  const groupOnly = SC.orphanToProposal(u, { type: 'group' });
  check(
    groupOnly.newTest.requests.length === 0 && groupOnly.newTest.label === 'Pelvic echography',
    '(3) or keep it as a group-and-results test with no request yet'
  );
  const all = SC.fillsFromProposals(base, [
    asRequest,
    SC.orphanToProposal({ ...u, key: 'other|key', heading: 'Other group' }, { type: 'group' }),
  ]);
  const applied = OV.applyFills(base, OV.emptyOverlay(), all.fills);
  check(
    applied.overlay.investigations.length === 2 &&
      applied.overlay.investigations.filter((i) => !i.requestAliases.length).length === 1,
    'two new tests: one with its request, one still needing a request'
  );
  const shared = OV.applyFills(
    base,
    OV.emptyOverlay(),
    SC.fillsFromProposals(base, [
      asRequest,
      SC.orphanToProposal({ ...u, key: 'x|y' }, { type: 'request', label: 'US Pelvis (Transabdominal)' }),
    ]).fills
  );
  check(shared.overlay.investigations.length === 1, 'two groups approved for the same request land on ONE test');
}

console.log('\n── results shared by two selected tests (the B12 case) ──');
{
  const c = clone(seed);
  const crp = c.investigations.find((i) => i.id === 'crp');
  const resId = crp.members[0].result;
  const code = c.results.find((r) => r.id === resId).codes[0].conceptId;
  c.investigations.push({
    id: 'crp-twin',
    label: 'CRP (practice copy)',
    kind: 'blood',
    requestAliases: [{ text: 'CRP practice', system: 'any' }],
    headingAliases: [],
    exclude: [],
    members: [{ result: resId, role: 'core' }],
  });
  const report = {
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [
      {
        heading: 'Zz odd heading',
        specimenType: 'Blood',
        results: [{ name: 'CRP', code, codeText: 'CRP', unit: 'mg/L', numeric: true, degraded: false }],
      },
    ],
    ungrouped: [],
    requests: ['C-Reactive Protein Blood', 'CRP practice'],
  };
  const an = SC.analyse(c, [report], { targets: ['crp', 'crp-twin'] });
  check(
    an.proposals.length === 1 && an.proposals[0].target === null && an.proposals[0].candidates.length === 2,
    'a group whose results belong to two selected tests is offered to the person to decide, not silently skipped'
  );
  const one = SC.analyse(c, [report], { targets: ['crp-twin'] });
  check(
    one.proposals.length === 1 && one.proposals[0].target === 'crp-twin',
    'with only one of them selected it goes to that one'
  );
}

console.log('\n── a wrong earlier link (ultrasound result attached to a blood test) ──');
{
  const c = clone(seed);
  const LABID = 'rj700-general-pathology';
  const res = {
    id: 'practice-us-abdomen-res',
    label: 'Ultrasonography of abdomen',
    valueKind: 'mixed',
    codes: [{ conceptId: '45036003', role: 'primary' }],
    aliases: [{ text: 'Ultrasonography of abdomen' }],
  };
  c.results.push(res);
  const testo = c.investigations.find((i) => i.id === 'testosterone');
  testo.members.push({ result: res.id, role: 'optional' }); // the wrong link
  c.investigations.push({
    id: 'practice-us-abdomen',
    label: 'US Abdomen',
    kind: 'imaging',
    requestAliases: [{ text: 'US Abdomen', system: 'any' }],
    headingAliases: [],
    exclude: [],
    members: [],
  });
  c.labs
    .find((l) => l.id === LABID)
    .groupHeadings.push({ text: 'Ultrasonography of abdomen', identifies: ['testosterone'], mayContain: [] });
  const report = {
    lab: { organisation: 'RJ700', department: 'General Pathology' },
    groups: [
      {
        heading: 'Ultrasonography of abdomen',
        specimenType: null,
        results: [
          {
            name: 'Ultrasonography of abdomen',
            code: '45036003',
            codeText: 'Ultrasonography of abdomen',
            unit: null,
            numeric: false,
            degraded: false,
          },
        ],
      },
    ],
    ungrouped: [],
    requests: ['US Abdomen', 'Testosterone'],
  };
  const an = SC.analyse(c, [report], { targets: ['testosterone', 'practice-us-abdomen'] });
  check(
    an.proposals.length === 1 && an.proposals[0].target === 'practice-us-abdomen',
    'the blood test is NOT accepted as owner of an ultrasound group: the imaging test is offered'
  );
  check(!an.proposals[0].candidates.includes('testosterone'), 'and the blood test is not offered as a candidate');
  check(
    an.proposals[0].headingKnown === false,
    'the lab heading exists but identifies a different test, so it is not "already known" for this one'
  );
  const { fills } = SC.fillsFromProposals(c, an.proposals);
  check(
    fills.labs[0].headings[0].identifies[0] === 'practice-us-abdomen' &&
      fills.members.some((m) => m.investigation === 'practice-us-abdomen' && m.result === res.id),
    'the fill adds the heading link and the result to the ultrasound test'
  );
  const applied = OV.applyFills(c, OV.emptyOverlay(), fills);
  const lab = applied.overlay.labs.find((l) => l.id === LABID);
  const h = lab.groupHeadings.find((g) => g.text === 'Ultrasonography of abdomen');
  check(
    h && h.identifies.includes('practice-us-abdomen'),
    'the heading now also identifies the ultrasound test (added, nothing removed — the earlier wrong link is for the person to delete)'
  );
  const again = SC.analyse(effective(c, applied.overlay), [report], {
    targets: ['testosterone', 'practice-us-abdomen'],
  });
  check(again.proposals.length === 0, 'once recorded, the group no longer appears in the list');
}

console.log('\n── code descriptions ──');
{
  const base = withoutReportForms(seed, ['urine-acr']);
  const an = SC.analyse(base, [obsOf(byPrefix('report-138'))], { targets: ['urine-acr'] });
  const { fills } = SC.fillsFromProposals(base, an.proposals);
  check(
    fills.results.every((r) => r.codes.every((c) => typeof c.description === 'string' && c.description.length > 0)),
    'codes learned from a report carry the description the lab sent for them'
  );
  const applied = OV.applyFills(base, OV.emptyOverlay(), fills);
  check(
    applied.overlay.results.some((r) => r.codes.some((c) => c.description === 'Urine albumin:creatinine ratio')),
    'and the description is stored on the code'
  );
  const round = OV.sanitiseOverlay(JSON.parse(JSON.stringify(applied.overlay)));
  check(
    round.results.some((r) => r.codes.some((c) => c.description)),
    'it survives sanitising (backup / restore)'
  );
  // a description can be filled in on a code the built-in already lists, without touching anything that recognises results
  const sodium = base.results.find((r) => r.id === 'sodium');
  const withDesc = OV.mergeCatalogue(
    base,
    {
      ...OV.emptyOverlay(),
      results: [
        {
          id: 'sodium',
          label: sodium.label,
          valueKind: sodium.valueKind,
          codes: [{ conceptId: sodium.codes[0].conceptId, role: 'primary', description: 'Serum sodium level' }],
          aliases: [],
          provenance: { source: 'imported', reviewed: true },
        },
      ],
    },
    {}
  );
  check(
    withDesc.catalogue.results.find((r) => r.id === 'sodium').codes[0].description === 'Serum sodium level' &&
      withDesc.catalogue.results.find((r) => r.id === 'sodium').codes.length === sodium.codes.length,
    'an additive entry can add a description to an existing built-in code (and nothing else)'
  );
}

console.log('\n── an unknown lab is proposed as a new (unreviewed) lab ──');
{
  const base = clone(seed);
  const report = {
    lab: { organisation: 'ZZ999', department: 'Cytology' },
    groups: [
      {
        heading: 'Iron studies here',
        specimenType: 'Blood',
        results: [
          {
            name: 'Ferritin level',
            code: '900000000000888',
            codeText: 'Ferritin',
            unit: 'ug/L',
            numeric: true,
            degraded: false,
          },
        ],
      },
    ],
    ungrouped: [],
    requests: ['Ferritin'],
  };
  const an = SC.analyse(base, [report], { targets: ['ferritin'] });
  check(
    an.proposals.length === 1 && an.proposals[0].lab.isNew && an.proposals[0].lab.org === 'ZZ999',
    'the performer is not in the catalogue -> a new lab is proposed'
  );
  const { fills } = SC.fillsFromProposals(base, an.proposals);
  const applied = OV.applyFills(base, OV.emptyOverlay(), fills);
  const lab = applied.overlay.labs[0];
  check(
    lab.identifiers.performerOrg === 'ZZ999' &&
      lab.identifiers.department === 'Cytology' &&
      lab.provenance.reviewed === false &&
      lab.groupHeadings[0].text === 'Iron studies here',
    'the lab and its heading are created, unreviewed'
  );
  const known = applied.overlay.results.find((r) => r.id === 'ferritin');
  check(
    known &&
      known.aliases[0].lab === lab.id &&
      known.aliases[0].text === 'Ferritin level' &&
      known.codes[0].conceptId === '900000000000888',
    "the new lab's wording and code are added to the existing ferritin result, tagged with the new lab id"
  );
}

console.log('\n── applyFills safety ──');
{
  const base = clone(seed);
  const sodium = base.results.find((r) => r.id === 'sodium');
  const res = OV.applyFills(base, OV.emptyOverlay(), {
    results: [
      {
        id: 'sodium',
        codes: [{ conceptId: base.results.find((r) => r.id === 'potassium').codes[0].conceptId }],
        aliases: [],
      },
    ],
  });
  check(
    res.overlay.results.length === 1 && res.overlay.results[0].codes.length === 0,
    'a code already owned by another result is silently NOT reassigned'
  );
  check(sodium.codes.length >= 1, 'the built-in result is untouched');
  let threw = false;
  try {
    OV.applyFills(base, OV.emptyOverlay(), { members: [{ investigation: 'nope', result: 'sodium', role: 'core' }] });
  } catch (e) {
    threw = /unknown investigation/.test(e.message);
  }
  check(threw, 'an unknown investigation is refused');
  const before = JSON.stringify(seed);
  OV.applyFills(seed, OV.emptyOverlay(), {
    results: [{ key: 'new:x', label: 'X', codes: [], aliases: [{ text: 'X' }] }],
  });
  check(JSON.stringify(seed) === before, 'the shipped catalogue is not mutated');
  // approved practice result edited by a fill withdraws the approval of tests using it
  const r1 = OV.saveResult(base, OV.emptyOverlay(), {
    label: 'Zed',
    valueKind: 'numeric',
    codes: [],
    aliases: [{ text: 'Zed level' }],
  });
  const i1 = OV.saveInvestigation(base, r1.overlay, {
    label: 'Zed test',
    kind: 'blood',
    requestAliases: [{ text: 'Zed', system: 'any' }],
    members: [{ result: 'practice-zed', role: 'core' }],
  });
  const approved = OV.approveInvestigation(base, i1.overlay, 'practice-zed-test', 'x').overlay;
  const filled = OV.applyFills(base, approved, {
    results: [{ id: 'practice-zed', codes: [{ conceptId: '900000000000999' }], aliases: [] }],
  });
  check(
    filled.overlay.investigations[0].provenance.reviewed === false,
    'a fill that changes a practice result sends the tests using it back to review'
  );
}

console.log('\n── reading the queue (injected client) ──');
(async () => {
  const good = payloadOf(fx(byPrefix('report-138')));
  const calls = [];
  const client = {
    fetchTaskList: async (slug, search) => {
      calls.push(['list', slug, search]);
      return {
        rows: [1, 2, 3, 4, 5]
          .map((n) => ({
            id: 'u' + n,
            patientName: 'SHOULD NOT SURVIVE',
            overviewURL: '/tasks/data/review-investigation-report/overview/' + n,
          }))
          .concat([{ id: 'dup', overviewURL: '/tasks/data/review-investigation-report/overview/1' }, { id: 'none' }]),
      };
    },
    fetchOverview: async (u) => {
      calls.push(['ov', u]);
      if (u.endsWith('/3')) throw new Error('HTTP 500');
      return good;
    },
  };
  const prog = [];
  const r = await SC.collectObservations(client, { limit: 4, concurrency: 2, onProgress: (d, t) => prog.push([d, t]) });
  check(
    calls[0][1] === 'review_investigation_results_task' && /statuses\[\]=pending/.test(calls[0][2]),
    'reads the pending investigation-results queue'
  );
  check(
    r.queueSize === 5 && r.total === 4 && r.observations.length === 3 && r.failed === 1,
    'duplicates and rows without an overview are ignored; the limit applies; a failed report is skipped'
  );
  check(prog.length === 4 && prog[prog.length - 1][0] === 4 && prog[0][1] === 4, 'progress is reported');
  check(!/SHOULD NOT SURVIVE/.test(JSON.stringify(r)), 'nothing from the task-list rows (patient names) is kept');
  let stop = false;
  const r2 = await SC.collectObservations(client, {
    limit: 5,
    concurrency: 1,
    shouldStop: () => stop,
    onProgress: (d) => (stop = d >= 2),
  });
  check(r2.observations.length <= 2, 'stop is honoured');
  let bad = false;
  try {
    await SC.collectObservations(
      {
        fetchTaskList: async () => {
          throw new Error('HTTP 401');
        },
        fetchOverview: async () => ({}),
      },
      {}
    );
  } catch (e) {
    bad = /401/.test(e.message);
  }
  check(bad, 'a queue that cannot be read is an error, not an empty result');

  // A microbiology test (Urine MC&S, Stool MC&S) is run on a urine / faeces specimen. A group it already owns must not
  // come back as "unlinked" just because the group's specimen is Urine or Faeces (reported 2026-09-22).
  console.log('\n── a microbiology test owns urine / faeces groups it has recorded ──');
  {
    const base = clone(seed);
    const res = (name, code, numeric) => ({
      name,
      code,
      codeText: name,
      unit: null,
      resultType: numeric ? 'unit-value-result' : 'text-result',
      hasNumericValue: !!numeric,
      numeric: !!numeric,
    });
    for (const [request, heading, specimen, results, kind] of [
      [
        'Urine MC&S',
        'Urine culture',
        'Urine',
        [res('Urine culture', '1023711000000100', false), res('WBC', '1022541000000102', true)],
        'urine',
      ],
      [
        'Stool MC&S',
        'FAECES - MOLECULAR SCREENING',
        'Faeces',
        [res('Comment', '726737008', false), res('Enteric pathogen DNA', '391236001', false)],
        'faeces',
      ],
    ]) {
      const report = {
        lab: { organisation: 'RJ700', department: 'General Pathology' },
        groups: [{ heading, specimenType: specimen, results }],
        ungrouped: [],
        requests: [request],
      };
      const unlinked = SC.analyse(base, [report], { targets: [] });
      check(
        unlinked.unmatched.length === 1 && unlinked.unmatched[0].kind === kind,
        `${heading}: an unlinked ${specimen} group still proposes a "${kind}" test (not blood)`
      );
      let ov = OV.emptyOverlay();
      ov = OV.applyFills(base, ov, SC.fillsForRequests([request])).overlay;
      const id = ov.investigations[0].id;
      const eff1 = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
      const first = SC.analyse(eff1, [report], { targets: [id] });
      ov = OV.applyFills(base, ov, SC.fillsFromProposals(eff1, first.proposals).fills).overlay;
      ov.investigations.find((i) => i.id === id).kind = 'microbiology'; // as an imported MC&S test is
      const eff2 = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
      const again = SC.analyse(eff2, [report], { targets: [id] });
      check(
        again.proposals.length === 0 && again.unmatched.length === 0 && again.stats.explained === 1,
        `${heading}: once recorded against ${request} (microbiology) the group is explained, not offered again`
      );
    }
    // The same test can hold either sample type (an MC&S test is 'urine' if its first report was a Urine group), and the lab
    // may label the specimen 'Culture' / 'Microbiology' on another report — neither combination may hide a recorded link.
    for (const [testKind, specimen] of [
      ['urine', 'Culture'],
      ['urine', 'Microbiology'],
      ['faeces', 'Swab'],
      ['microbiology', 'Urine'],
      ['microbiology', 'Faeces'],
    ]) {
      const report = {
        lab: { organisation: 'RJ700', department: 'General Pathology' },
        groups: [
          {
            heading: 'URINE MICROSCOPY AND CULTURE',
            specimenType: specimen,
            results: [res('Urine culture', '1023711000000100', false)],
          },
        ],
        ungrouped: [],
        requests: ['Urine MC&S'],
      };
      let ov = OV.applyFills(base, OV.emptyOverlay(), SC.fillsForRequests(['Urine MC&S'])).overlay;
      const id = ov.investigations[0].id;
      const eff1 = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
      ov = OV.applyFills(
        base,
        ov,
        SC.fillsFromProposals(eff1, SC.analyse(eff1, [report], { targets: [id] }).proposals).fills
      ).overlay;
      ov.investigations.find((i) => i.id === id).kind = testKind;
      const eff2 = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
      const again = SC.analyse(eff2, [report], { targets: [id] });
      check(
        again.proposals.length === 0 && again.unmatched.length === 0 && again.stats.explained === 1,
        `a ${testKind}-kind test still owns its recorded group on a ${specimen} specimen`
      );
    }
    // ...but the sample-type filter still keeps imaging and lab tests apart
    {
      const rad = {
        lab: { organisation: 'RJ700', department: 'General Pathology' },
        groups: [
          { heading: 'Ultrasonography', specimenType: 'Xray', results: [res('Ultrasonography', '16310003', false)] },
        ],
        ungrouped: [],
        requests: [],
      };
      const t = SC.analyse(base, [rad], { targets: ['testosterone'] });
      check(
        t.unmatched.length === 1 && t.unmatched[0].kind === 'imaging',
        'an imaging group is still never a laboratory sample type'
      );
    }
  }

  console.log('\n── a generic imaging group seen in several reports links to every test it answers ──');
  {
    const base = clone(seed);
    // One generic imaging group ("Ultrasonography"), seen in three reports that each answer a DIFFERENT ultrasound request.
    const usRes = (name, code) => ({
      name,
      code,
      codeText: name,
      unit: null,
      resultType: 'text-result',
      hasNumericValue: false,
      numeric: false,
    });
    const usReport = (requests) => ({
      lab: { organisation: 'RJ700', department: 'Xray' },
      groups: [{ heading: 'Ultrasonography', specimenType: null, results: [usRes('Ultrasonography', '16310003')] }],
      ungrouped: [],
      requests,
    });
    let ov = OV.applyFills(
      base,
      OV.emptyOverlay(),
      SC.fillsForRequests(['US Abdomen', 'US Neck', 'US Groin/Inguinal Region'])
    ).overlay;
    const ids = ov.investigations.map((i) => i.id);
    let eff = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const reports = [usReport(['US Abdomen']), usReport(['US Neck']), usReport(['US Groin/Inguinal Region'])];
    const an = SC.analyse(eff, reports, { targets: ids });
    const p = an.proposals[0];
    check(
      an.proposals.length === 1 && p.multi === true && p.candidates.length === 3 && p.target === null,
      'each report names a different test, so all three are offered (not just what the cards share)'
    );
    const fills = SC.fillsFromProposals(eff, [SC.orphanToProposal(p, { type: 'tests', ids: p.candidates })]).fills;
    ov = OV.applyFills(base, ov, fills).overlay;
    eff = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const lab = eff.labs.find((l) => l.identifiers.department === 'Xray');
    check(
      lab && lab.groupHeadings.some((g) => g.text === 'Ultrasonography' && ids.every((i) => g.identifies.includes(i))),
      'the one heading now identifies all three tests'
    );
    const again = SC.analyse(eff, reports, { targets: ids });
    check(again.proposals.length === 0 && again.unmatched.length === 0, 'and a rescan no longer offers it');
    const solo = SC.analyse(base, [usReport(['US Abdomen'])], { targets: [] });
    check(solo.unmatched.length === 1 && solo.unmatched[0].multi !== true, 'one candidate is never multi');
  }

  console.log('\n── a group recognised for several selected tests is finished when nothing is left to add ──');
  {
    const base = clone(seed);
    const r = (name, code) => ({
      name,
      code,
      codeText: name,
      unit: null,
      resultType: 'text-result',
      hasNumericValue: false,
      numeric: false,
    });
    const rep = (results) => ({
      lab: { organisation: 'RJ700', department: 'Medical Microbiology' },
      groups: [{ heading: 'URINE MICROSCOPY AND CULTURE', specimenType: 'Urine', results }],
      ungrouped: [],
      requests: ['Urine MC&S', 'Urine culture'],
    });
    const first = rep([r('Culture', '61594008'), r('Pus cells', '1041881000000101')]);
    let ov = OV.applyFills(base, OV.emptyOverlay(), SC.fillsForRequests(['Urine MC&S', 'Urine culture'])).overlay;
    const ids = ov.investigations.map((i) => i.id);
    let eff = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const p = SC.analyse(eff, [first], { targets: ids });
    const pr = p.proposals[0] || p.unmatched[0];
    const prop = pr.target ? pr : SC.orphanToProposal(pr, { type: 'tests', ids });
    ov = OV.applyFills(base, ov, SC.fillsFromProposals(eff, [{ ...prop, target: null, targets: ids }]).fills).overlay;
    eff = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const again = SC.analyse(eff, [first], { targets: ids });
    check(
      again.proposals.length === 0 && again.unmatched.length === 0,
      'recognised for two selected tests with nothing missing: not offered again'
    );
    const richer = SC.analyse(
      eff,
      [rep([r('Culture', '61594008'), r('Pus cells', '1041881000000101'), r('Comment', '726737008')])],
      {
        targets: ids,
      }
    );
    check(
      richer.proposals.length === 1 &&
        richer.proposals[0].recognisedFor &&
        richer.proposals[0].recognisedFor.length === 2 &&
        richer.proposals[0].recognisedFor.every((x) => x.results + x.members > 0),
      'a new result on that group IS offered, and says what is missing for each test'
    );
  }

  console.log('\n── results of different tests are never merged by a word inside their name ──');
  {
    const base = clone(seed);
    const r = (name, code) => ({
      name,
      code,
      codeText: name,
      unit: null,
      resultType: 'text-result',
      hasNumericValue: false,
      numeric: false,
    });
    const gp = { organisation: 'RJ700', department: 'General Pathology' };
    const rep = (heading, specimen, results) => ({
      lab: gp,
      groups: [{ heading, specimenType: specimen, results }],
      ungrouped: [],
      requests: [],
    });
    let ov = OV.applyFills(base, OV.emptyOverlay(), SC.fillsForRequests(['Urine MC&S', 'Genital Swab MC&S'])).overlay;
    const [urine, swab] = ov.investigations.map((i) => i.id);
    const eff = () => OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const link = (report, id) => {
      const e = eff();
      const an = SC.analyse(e, [report], { targets: [urine, swab] });
      const p = an.proposals[0] || an.unmatched[0];
      ov = OV.applyFills(
        base,
        ov,
        SC.fillsFromProposals(e, [SC.orphanToProposal(p, { type: 'test', id })]).fills
      ).overlay;
    };
    link(rep('GENITAL SWAB CULTURE', 'Swab', [r('Culture', '61594008')]), swab);
    link(rep('Urine culture', 'Urine', [r('Urine culture', '1023711000000100')]), urine);
    const e = eff();
    const generic = e.results.find((x) => x.codes.some((c) => c.conceptId === '61594008'));
    check(
      generic &&
        generic.codes.length === 1 &&
        !generic.aliases.some((a) => /urine/i.test(a.text)) &&
        e.investigations.find((i) => i.id === swab).members.every((m) => m.result === generic.id),
      'a urine culture code and wording are NOT added to the generic "Culture" result (or to a swab test)'
    );
    check(
      e.investigations.find((i) => i.id === urine).members.every((m) => m.result !== generic.id),
      'the urine test gets its own result'
    );
    // and a genuine variant wording of the SAME analyte is still reused
    check(
      SC.fillsFromProposals(eff(), [
        {
          key: 'k',
          lab: { id: 'rj700-general-pathology', isNew: false },
          heading: 'Ferritin',
          headingIds: [],
          target: 'ferritin',
          results: [{ ...r('Ferritin level', '900000000000777'), resultId: 'ferritin', freq: 1 }],
        },
      ]).fills.results.some((f) => f.id === 'ferritin'),
      '"Ferritin level" is still the ferritin result'
    );
    // a generic result shared by several tests is never enough, on its own, to be confident about any of them
    const both = OV.applyFills(base, ov, {
      results: [],
      members: [
        { investigation: urine, result: generic.id, role: 'core' },
        { investigation: swab, result: generic.id, role: 'core' },
      ],
      labs: [],
      newInvestigations: [],
      kinds: [],
    }).overlay;
    const idx = LC.buildIndex(OV.mergeCatalogue(base, both, { includeUnreviewed: true }).catalogue);
    const cov = LC.resolveReport(
      idx,
      LC.fromInvestigationReportPayload({
        investigationReport: {
          performer: { organisationName: 'RJ700', departmentName: 'General Pathology' },
          investigationGroups: [
            {
              description: 'Some unmapped panel',
              specimen: { type: 'Swab' },
              results: [{ description: 'Culture', resultType: 'text-result', resultCode: { conceptId: '61594008' } }],
            },
          ],
        },
      })
    ).coverage;
    check(
      Object.keys(cov).length >= 1 && Object.values(cov).every((c) => c.confidence === 'tentative'),
      'evidence made only of a result shared by several tests is tentative, never confident'
    );
  }

  console.log('\n── starting from imported tests that share one "Culture" result ──');
  {
    const IMP = require('./shared/lab-catalogue-import.js');
    const base = clone(seed);
    const T = (key, label, req, rep) => ({
      key,
      label,
      req,
      rep,
      analytes: ['culture'],
      singleAnalyte: true,
      disabled: false,
    });
    let ov = IMP.mergeIntoOverlay(
      OV.emptyOverlay(),
      IMP.importOirTests(
        [
          T('genital', 'Genital swab', ['Genital Swab MC&S'], ['genital swab']),
          T('throat', 'Throat swab', ['Throat Swab MC&S'], ['throat swab']),
          T('urine', 'Urine MC&S', ['Urine MC&S'], ['urine culture']),
        ],
        base,
        { labId: 'rj700-general-pathology' }
      ).overlay
    ).overlay;
    const ids = ov.investigations.map((i) => i.id);
    const r = (name, code) => ({
      name,
      code,
      codeText: name,
      unit: null,
      resultType: 'text-result',
      hasNumericValue: false,
      numeric: false,
    });
    const reports = [
      {
        lab: { organisation: 'RJ700', department: 'Medical Microbiology' },
        groups: [
          {
            heading: 'GENITAL SWAB CULTURE',
            specimenType: 'Swab',
            results: [r('Candida Culture', '995241000000109'), r('Culture', '61594008')],
          },
        ],
        ungrouped: [],
        requests: ['Genital Swab MC&S'],
      },
      {
        lab: { organisation: 'RJ700', department: 'General Pathology' },
        groups: [
          { heading: 'Urine culture', specimenType: 'Urine', results: [r('Urine culture', '1023711000000100')] },
        ],
        ungrouped: [],
        requests: ['Urine MC&S'],
      },
    ];
    const e0 = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const props = SC.analyse(e0, reports, { targets: ids }).proposals.filter((p) => p.target);
    ov = OV.applyFills(base, ov, SC.fillsFromProposals(e0, props).fills).overlay;
    const e1 = OV.mergeCatalogue(base, ov, { includeUnreviewed: true }).catalogue;
    const culture = e1.results.find((x) => x.id === 'practice-culture');
    check(
      props.length === 2 &&
        culture &&
        culture.codes.length === 1 &&
        culture.codes[0].conceptId === '61594008' &&
        culture.aliases.every((a) => !/urine|candida/i.test(a.text)),
      'the shared "Culture" result only ever gets the generic Culture code and wording'
    );
    check(
      e1.results.some((x) => x.codes.some((c) => c.conceptId === '1023711000000100') && x.id !== 'practice-culture') &&
        e1.results.some((x) => x.codes.some((c) => c.conceptId === '995241000000109') && x.id !== 'practice-culture'),
      'urine culture and Candida culture each become their own result'
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
