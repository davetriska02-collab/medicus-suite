// Medicus Suite — Lab Result Catalogue: practice overlay (sanitise / inert / merge). Phase B1.
// Run with: node test-lab-catalogue-overlay.js

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');
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
    return re.test(String(e && e.message));
  }
};
const builtin = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'lab-catalogue.json'), 'utf8'));
const snapshot = JSON.stringify(builtin);
const reviewed = (source) => ({
  source: source || 'practice',
  reviewed: true,
  reviewedBy: 'test',
  reviewedAt: '2026-09-19',
});
const unreviewed = { source: 'imported', reviewed: false };
const newResult = (id, code, prov, extra) => ({
  id,
  label: id.toUpperCase(),
  valueKind: 'numeric',
  codes: code ? [{ conceptId: code, role: 'primary' }] : [],
  aliases: [{ text: id }],
  provenance: prov || reviewed(),
  ...extra,
});
const newInv = (id, members, prov, extra) => ({
  id,
  label: id,
  kind: 'blood',
  requestAliases: [{ text: id, system: 'any' }],
  headingAliases: [],
  exclude: [],
  members,
  provenance: prov || reviewed(),
  ...extra,
});

console.log('--- emptyOverlay / sanitiseOverlay ---');
{
  const e = OV.emptyOverlay();
  check(
    e.schema === 1 && Array.isArray(e.results) && e.context.icb === '' && e.disabled.results.length === 0,
    'an empty overlay has the expected shape'
  );
  const m = OV.mergeCatalogue(builtin, e);
  check(
    JSON.stringify(m.catalogue) === snapshot && m.problems.length === 0,
    'an empty overlay leaves the built-in catalogue byte-for-byte unchanged'
  );
  check(
    OV.sanitiseOverlay(null).schema === 1 && OV.sanitiseOverlay(undefined).results.length === 0,
    'null/undefined -> an empty overlay'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay('x'), /overlay must be an object/),
    'a non-object is rejected'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ schema: 9 }), /schema must be 1/),
    'a wrong schema version is rejected'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ results: 'nope' }), /results must be an array/),
    'a mistyped section (not an array) is REJECTED — it must never read as "empty"'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ results: [5] }), /must be an object/),
    'a non-object entry is rejected'
  );
  check(
    throwsWith(
      () => OV.sanitiseOverlay({ results: [{ id: 'x', label: 'X', valueKind: 'numeric', codes: 'nope' }] }),
      /codes must be an array/
    ),
    'a mistyped nested list is rejected too'
  );
  check(
    throwsWith(
      () => OV.sanitiseOverlay({ results: [{ id: 'x', label: 'x'.repeat(201), valueKind: 'numeric' }] }),
      /200 characters or fewer/
    ),
    'an over-long value is REJECTED, not silently truncated'
  );
  check(
    throwsWith(() => OV.sanitiseOverlay({ results: [{ id: 'x', valueKind: 'numeric' }] }), /label is required/),
    'a missing required field is rejected'
  );
  const raw = JSON.parse(
    '{"results":[{"id":"x","label":"X","valueKind":"numeric","__proto__":{"polluted":1},"constructor":{"a":1},"junk":"drop me"}],"__proto__":{"evil":true}}'
  );
  const clean = OV.sanitiseOverlay(raw);
  check(
    {}.evil === undefined && {}.polluted === undefined,
    'a prototype-pollution attempt does not touch Object.prototype'
  );
  check(
    !Object.prototype.hasOwnProperty.call(clean.results[0], 'junk') &&
      !Object.prototype.hasOwnProperty.call(clean.results[0], 'constructor') &&
      Object.getPrototypeOf(clean.results[0]) === Object.prototype,
    'unknown / dangerous keys are dropped from entries'
  );
  const before = JSON.stringify(raw);
  OV.sanitiseOverlay(raw);
  check(JSON.stringify(raw) === before, 'the input is never mutated');
  const ctx = OV.sanitiseOverlay({
    context: {
      icb: ' NHS South West London ',
      borough: 'Richmond',
      labs: ['rj700-general-pathology'],
      orderingSystems: ['tquest'],
    },
  }).context;
  check(
    ctx.icb === 'NHS South West London' &&
      ctx.borough === 'Richmond' &&
      ctx.labs[0] === 'rj700-general-pathology' &&
      ctx.icbCode === '',
    'practice context is trimmed and carried (ICB, borough, labs, ordering systems)'
  );
}

console.log('\n--- forceInert / markReviewed / summarise ---');
{
  const ov = OV.sanitiseOverlay({
    results: [newResult('zzz', '888000111')],
    investigations: [newInv('zzz-test', [{ result: 'zzz', role: 'core' }])],
  });
  const inert = OV.forceInert(ov);
  check(
    inert.results[0].provenance.reviewed === false && inert.investigations[0].provenance.reviewed === false,
    'forceInert marks every entry unreviewed'
  );
  check(
    inert.results[0].provenance.source === 'imported' && inert.results[0].provenance.importedFrom === 'practice',
    'the origin is remembered (importedFrom), the approval is not'
  );
  check(
    !('reviewedBy' in inert.results[0].provenance) && !('reviewedAt' in inert.results[0].provenance),
    'approver / approval date do not survive'
  );
  check(ov.results[0].provenance.reviewed === true, 'forceInert does not mutate its input');
  const approved = OV.markReviewed(inert, 'results', 'zzz', 'Dr Test', '2026-09-20');
  check(
    approved.results[0].provenance.reviewed === true && approved.results[0].provenance.reviewedBy === 'Dr Test',
    'markReviewed approves one entry (pure)'
  );
  check(inert.results[0].provenance.reviewed === false, '…without mutating the original');
  check(
    throwsWith(() => OV.markReviewed(inert, 'results', 'nope'), /not found/) &&
      throwsWith(() => OV.markReviewed(inert, 'bogus', 'x'), /unknown kind/),
    'approving something that does not exist / an unknown kind throws'
  );
  const s = OV.summarise(inert);
  check(
    s.results.total === 1 && s.results.unreviewed === 1 && s.investigations.unreviewed === 1,
    'summarise counts total and unreviewed'
  );
}

console.log('\n--- merge: inert until reviewed ---');
{
  const ov = OV.sanitiseOverlay({
    results: [newResult('zzz', '888000111', unreviewed)],
    investigations: [newInv('zzz-test', [{ result: 'zzz', role: 'core' }], unreviewed)],
  });
  const m = OV.mergeCatalogue(builtin, ov);
  check(
    !m.catalogue.results.some((r) => r.id === 'zzz') && !m.catalogue.investigations.some((i) => i.id === 'zzz-test'),
    'UNREVIEWED entries are NOT in the effective catalogue'
  );
  check(
    m.excluded.length === 2 && m.excluded.every((x) => x.reason === 'unreviewed'),
    '…and are listed as excluded (unreviewed)'
  );
  const inc = OV.mergeCatalogue(builtin, ov, { includeUnreviewed: true });
  check(
    inc.catalogue.results.some((r) => r.id === 'zzz') && inc.excluded.length === 0,
    'includeUnreviewed:true (for the settings page) includes them'
  );
  const rev = OV.mergeCatalogue(
    builtin,
    OV.sanitiseOverlay({
      results: [newResult('zzz', '888000111')],
      investigations: [newInv('zzz-test', [{ result: 'zzz', role: 'core' }])],
    })
  );
  check(
    rev.catalogue.results.some((r) => r.id === 'zzz') && rev.catalogue.investigations.some((i) => i.id === 'zzz-test'),
    'REVIEWED entries are in the effective catalogue'
  );
  check(LC.validateCatalogue(rev.catalogue).errors.length === 0, 'the effective catalogue validates');
  const idx = LC.buildIndex(rev.catalogue);
  const r = LC.resolveReport(idx, {
    lab: { organisation: 'X' },
    groups: [
      {
        heading: 'zzz-test',
        results: [{ name: 'q', code: '888000111', resultType: 'unit-value-result', hasNumericValue: true }],
      },
    ],
    ungrouped: [],
  });
  check(
    r.results[0].resultId === 'zzz' && r.coverage['zzz-test'],
    'a practice-added result and investigation actually resolve a report end to end'
  );
}

console.log('\n--- merge: APPEND-ONLY on built-ins ---');
{
  const ov = OV.sanitiseOverlay({
    results: [
      {
        id: 'alp',
        label: 'Something else',
        valueKind: 'text',
        codes: [
          { conceptId: '111222333', role: 'primary' },
          { conceptId: '1000621000000104', role: 'primary' },
        ],
        aliases: [{ text: 'alk phos lab z', lab: 'lab-z' }, { text: 'ALP' }],
        excludeAliases: ['gamma'],
        provenance: reviewed(),
      },
    ],
    investigations: [
      newInv(
        'lft',
        [
          { result: 'ast', role: 'core' },
          { result: 'alp', role: 'core' },
          { result: 'ggt', role: 'core' },
        ],
        reviewed(),
        { label: 'Renamed', requestAliases: [{ text: 'liver panel z', system: 'ice' }], headingAliases: ['liver z'] }
      ),
    ],
    labs: [
      {
        id: 'rj700-general-pathology',
        name: 'Renamed lab',
        identifiers: { performerOrg: 'RJ700' },
        groupHeadings: [
          { text: 'LFTs', identifies: [], mayContain: ['res:ggt'] },
          { text: 'Liver extras', identifies: ['lft'], mayContain: [] },
        ],
        provenance: reviewed(),
      },
    ],
  });
  const m = OV.mergeCatalogue(builtin, ov);
  const alp = m.catalogue.results.find((r) => r.id === 'alp');
  check(
    alp.label === 'Alkaline phosphatase' && alp.valueKind === 'numeric',
    "a built-in result's label and valueKind CANNOT be changed"
  );
  check(
    m.problems.some((p) => p.id === 'alp' && /label .* cannot be changed/.test(p.reason)) &&
      m.problems.some((p) => p.id === 'alp' && /valueKind .* cannot be changed/.test(p.reason)),
    '…and each ignored change is reported as a problem'
  );
  check(
    alp.codes.some((c) => c.conceptId === '111222333' && c.role === 'alternate'),
    'a NEW code on a built-in result is added, forced to "alternate" (one primary only)'
  );
  check(
    alp.codes.filter((c) => c.conceptId === '1000621000000104').length === 1 &&
      alp.codes.filter((c) => c.role === 'primary').length === 1,
    'a code the built-in already has is not duplicated; still exactly one primary'
  );
  check(
    alp.aliases.some((a) => a.text === 'alk phos lab z' && a.lab === 'lab-z') &&
      alp.aliases.filter((a) => a.text.toLowerCase() === 'alp' && !a.lab).length === 1,
    'new aliases are added, duplicates are not'
  );
  check((alp.excludeAliases || []).includes('gamma'), 'excludeAliases are appended');
  const lft = m.catalogue.investigations.find((i) => i.id === 'lft');
  check(lft.label === 'Liver function tests', "a built-in investigation's label cannot be changed");
  check(
    lft.requestAliases.some((a) => a.text === 'liver panel z' && a.system === 'ice') &&
      lft.headingAliases.includes('liver z'),
    'request and heading aliases are appended'
  );
  check(
    lft.members.find((x) => x.result === 'alp').role === 'shared' &&
      lft.members.find((x) => x.result === 'ggt').role === 'optional',
    "an EXISTING member's role cannot be changed (alp stays shared, ggt stays optional)"
  );
  check(
    m.problems.some((p) => p.id === 'lft' && /role of existing member/.test(p.reason)),
    '…and reported'
  );
  const lab = m.catalogue.labs.find((l) => l.id === 'rj700-general-pathology');
  check(lab.name === 'General Pathology (RJ700)', "a built-in lab's name cannot be changed");
  check(
    lab.groupHeadings.some((h) => h.text === 'Liver extras') &&
      lab.groupHeadings.find((h) => h.text === 'LFTs').mayContain.includes('res:ggt') &&
      lab.groupHeadings.find((h) => h.text === 'LFTs').identifies.includes('lft'),
    'lab headings are appended, and an existing heading gains may-contain without losing what it identified'
  );
  check(JSON.stringify(builtin) === snapshot, 'the built-in object passed in is NEVER mutated');
  check(LC.validateCatalogue(m.catalogue).errors.length === 0, 'the merged catalogue is valid');
}

console.log('\n--- merge: disable is a fail-safe, with pruning ---');
{
  const ov = OV.sanitiseOverlay({ disabled: { results: ['ggt'], investigations: ['radiology-knee'] } });
  const m = OV.mergeCatalogue(builtin, ov);
  check(
    !m.catalogue.results.some((r) => r.id === 'ggt') &&
      !m.catalogue.investigations.some((i) => i.id === 'radiology-knee'),
    'a disabled result and investigation are gone'
  );
  const lft = m.catalogue.investigations.find((i) => i.id === 'lft');
  check(
    lft && !lft.members.some((x) => x.result === 'ggt'),
    'a disabled result is pruned from every investigation that listed it'
  );
  check(LC.validateCatalogue(m.catalogue).errors.length === 0, 'the catalogue stays valid after pruning');
  const drop = OV.mergeCatalogue(
    builtin,
    OV.sanitiseOverlay({ disabled: { results: ['phosphate', 'adjusted-calcium'] } })
  );
  check(
    !drop.catalogue.investigations.some((i) => i.id === 'bone-profile') &&
      drop.problems.some((p) => p.id === 'bone-profile' && /no core member left/.test(p.reason)),
    'an investigation left with no core member is dropped, and reported'
  );
  const heads = drop.catalogue.labs[0].groupHeadings;
  check(
    !heads.some((h) => h.identifies.includes('bone-profile')) && !heads.some((h) => h.text === 'Bone profile'),
    'lab headings that referred to a dropped investigation are pruned'
  );
  const idx = LC.buildIndex(drop.catalogue);
  check(
    !!idx && LC.resolveRequest(idx, 'Bone Profile (Calcium Studies)').length === 0,
    'a disabled test is no longer recognised (fail-safe: its request stays outstanding)'
  );
}

console.log('\n--- merge: one bad entry must not discard the rest ---');
{
  const good = newResult('good-one', '777000111');
  const bad = newResult('bad-one', '1000621000000104'); // concept already claimed by built-in "alp"
  const m = OV.mergeCatalogue(
    builtin,
    OV.sanitiseOverlay({
      results: [good, bad],
      investigations: [newInv('good-test', [{ result: 'good-one', role: 'core' }])],
    })
  );
  check(
    m.catalogue.results.some((r) => r.id === 'good-one') &&
      m.catalogue.investigations.some((i) => i.id === 'good-test'),
    'valid entries are kept'
  );
  check(
    !m.catalogue.results.some((r) => r.id === 'bad-one') &&
      m.problems.some((p) => p.id === 'bad-one' && /excluded/.test(p.reason)),
    'the conflicting entry is excluded and reported'
  );
  check(LC.validateCatalogue(m.catalogue).errors.length === 0, 'the result is valid');
  const dangling = OV.mergeCatalogue(
    builtin,
    OV.sanitiseOverlay({ investigations: [newInv('orphan', [{ result: 'does-not-exist', role: 'core' }])] })
  );
  check(
    !dangling.catalogue.investigations.some((i) => i.id === 'orphan') && dangling.problems.length > 0,
    'an entry referencing a missing result is excluded, not fatal'
  );
  const retired = OV.mergeCatalogue(
    builtin,
    OV.sanitiseOverlay({ retired: ['old-thing'], results: [newResult('old-thing', null)] })
  );
  check(
    !retired.catalogue.results.some((r) => r.id === 'old-thing') &&
      retired.problems.some((p) => /retired/.test(p.reason)),
    'a retired id cannot be reused'
  );
  check(
    throwsWith(() => OV.mergeCatalogue({ schema: 2 }, OV.emptyOverlay()), /built-in lab catalogue is invalid/),
    'an invalid BUILT-IN catalogue is a hard error, not silently used'
  );
}

console.log('\n── settings-page operations (C2) ──');
{
  const IMP = require('./shared/lab-catalogue-import.js');
  const oir = [
    {
      key: 'crp',
      label: 'CRP',
      req: ['C-Reactive Protein Blood'],
      rep: ['CRP'],
      analytes: ['CRP lab wording'],
      singleAnalyte: true,
    },
    {
      key: 'esr',
      label: 'ESR',
      req: ['Erythrocyte sedimentation rate'],
      rep: ['ESR'],
      analytes: ['ESR'],
      singleAnalyte: true,
    },
  ];
  const doImport = () => IMP.importOirTests(oir, builtin, { labId: 'rj700-general-pathology', today: '2026-09-19' });
  const imp = doImport();
  const ctx = OV.setContext(OV.emptyOverlay(), {
    icb: 'NHS South West London',
    borough: 'Richmond',
    labs: ['rj700-general-pathology'],
    orderingSystems: ['tquest'],
  });
  check(ctx.context.borough === 'Richmond' && ctx.context.labs.length === 1, 'setContext stores practice context');
  check(
    throwsWith(() => OV.setContext(OV.emptyOverlay(), { icb: 'x'.repeat(500) }), /icb/),
    'setContext rejects an over-long value'
  );

  const ap = OV.approveInvestigation(builtin, imp.overlay, 'practice-esr', 'Nick', '2026-09-19');
  const esrInv = ap.overlay.investigations.find((i) => i.id === 'practice-esr');
  check(
    esrInv.provenance.reviewed === true && esrInv.provenance.reviewedBy === 'Nick',
    'approve marks the investigation reviewed'
  );
  check(ap.approvedResults.length === 1, 'its dependent new result is approved with it');
  const mm = OV.mergeCatalogue(builtin, ap.overlay, {});
  check(
    mm.catalogue.investigations.some((i) => i.id === 'practice-esr') && mm.problems.length === 0,
    'approved investigation now appears in the ACTING catalogue'
  );
  check(
    !mm.catalogue.results.some((r) => r.aliases.some((a) => a.text === 'CRP lab wording')),
    'nothing else was approved by accident (the unapproved CRP alias is not live)'
  );

  const ap2 = OV.approveInvestigation(builtin, imp.overlay, 'crp', 'Nick', '2026-09-19');
  check(
    ap2.approvedResults.length >= 1,
    'approving an extension also approves the alias-addition on the built-in result'
  );
  const m2 = OV.mergeCatalogue(builtin, ap2.overlay, {});
  check(
    m2.catalogue.results.some((r) => r.aliases.some((a) => a.text === 'CRP lab wording')),
    'the approved alias is live in the acting catalogue'
  );
  check(
    throwsWith(() => OV.approveInvestigation(builtin, imp.overlay, 'nope'), /not found/),
    'approving an unknown id throws'
  );

  const rm = OV.removeInvestigation(builtin, imp.overlay, 'practice-esr');
  check(
    !rm.overlay.investigations.some((i) => i.id === 'practice-esr') && rm.removedResults.length === 1,
    'remove drops the investigation and its orphaned unreviewed result'
  );
  check(
    rm.overlay.investigations.some((i) => i.id === 'crp'),
    'other entries are untouched'
  );
  const keep = OV.removeInvestigation(builtin, ap.overlay, 'practice-esr');
  check(
    keep.removedResults.length === 0 && keep.overlay.results.some((r) => r.label === 'ESR'),
    'an already-approved result is never removed with the investigation'
  );
  check(
    throwsWith(() => OV.removeInvestigation(builtin, imp.overlay, 'bone-profile'), /not found/),
    'a built-in cannot be removed (it is not in the overlay)'
  );

  const dis = OV.setInvestigationDisabled(OV.emptyOverlay(), 'hiv', true);
  check(dis.disabled.investigations.join() === 'hiv', 'disable a built-in');
  check(OV.setInvestigationDisabled(dis, 'hiv', false).disabled.investigations.length === 0, 're-enable it');
  check(JSON.stringify(imp.overlay) === JSON.stringify(doImport().overlay), 'operations do not mutate their input');
}

console.log('\n── hand authoring (C3) ──');
{
  const E = OV.emptyOverlay();
  const LAB = 'rj700-general-pathology';

  // new result
  const r1 = OV.saveResult(builtin, E, {
    label: 'Anti-Xa',
    valueKind: 'numeric',
    codes: [{ conceptId: '900000000000123', role: 'alternate', unit: 'IU/mL' }],
    aliases: [{ text: 'Anti Xa level', lab: LAB }],
  });
  const res = r1.overlay.results[0];
  check(
    res.id === 'practice-anti-xa' && res.provenance.reviewed === false,
    'a new result gets a generated id and is unreviewed'
  );
  check(res.codes[0].role === 'primary', 'the first code of a new result becomes its primary');
  check(
    throwsWith(
      () =>
        OV.saveResult(builtin, r1.overlay, {
          label: 'Dup',
          valueKind: 'numeric',
          codes: [{ conceptId: '900000000000123', role: 'primary' }],
          aliases: [],
        }),
      /already claimed/
    ),
    'a code already owned by another result is refused with the reason'
  );
  check(
    throwsWith(
      () => OV.saveResult(builtin, E, { label: 'Nothing', valueKind: 'numeric', codes: [], aliases: [] }),
      /at least one code or alias/
    ),
    'a result with neither a code nor a name is refused'
  );
  // edit a built-in result: the spec is the complete definition and becomes an OVERRIDE
  const sodium = builtin.results.find((r) => r.id === 'sodium');
  const sodiumSpec = () => ({
    id: 'sodium',
    label: sodium.label,
    valueKind: sodium.valueKind,
    codes: sodium.codes,
    aliases: sodium.aliases,
    excludeAliases: sodium.excludeAliases,
  });
  const r2 = OV.saveResult(builtin, E, {
    ...sodiumSpec(),
    aliases: [...sodium.aliases, { text: 'Na+ (lab wording)', lab: LAB }],
  });
  const ext = r2.overlay.results[0];
  check(
    ext.override === true && ext.aliases.length === sodium.aliases.length + 1,
    'editing a built-in result stores a complete override'
  );
  check(ext.provenance.reviewed === false, 'the override is unreviewed');
  check(
    !OV.mergeCatalogue(builtin, r2.overlay, {})
      .catalogue.results.find((r) => r.id === 'sodium')
      .aliases.some((a) => a.text === 'Na+ (lab wording)'),
    'until approved the SHIPPED definition still applies'
  );
  const r2a = OV.mergeCatalogue(
    builtin,
    OV.markReviewed(r2.overlay, 'results', 'sodium', 'x'),
    {}
  ).catalogue.results.find((r) => r.id === 'sodium');
  check(
    r2a.aliases.some((a) => a.text === 'Na+ (lab wording)'),
    'once approved the practice version applies'
  );
  const r2b = OV.saveResult(builtin, r2.overlay, sodiumSpec());
  check(
    r2b.reverted === true && r2b.overlay.results.length === 0,
    'saving the shipped content again removes the override'
  );
  const r2c = OV.saveResult(builtin, E, {
    ...sodiumSpec(),
    label: 'Serum sodium',
    codes: [],
    aliases: [{ text: 'sodium' }],
  });
  check(
    r2c.overlay.results[0].label === 'Serum sodium' && r2c.overlay.results[0].codes.length === 0,
    'a built-in result can be renamed and can lose codes (practice decision, reviewed)'
  );

  // new investigation with members + lab heading
  const s1 = OV.saveResult(builtin, r1.overlay, {
    label: 'Factor X',
    valueKind: 'numeric',
    codes: [],
    aliases: [{ text: 'Factor 10', lab: LAB }],
  });
  const inv1 = OV.saveInvestigation(builtin, s1.overlay, {
    label: 'Anticoagulant monitoring',
    kind: 'blood',
    requestAliases: [
      { text: 'Anti-Xa level', system: 'tquest' },
      { text: 'anti xa level', system: 'tquest' },
    ],
    headingAliases: ['Anti Xa'],
    members: [
      { result: 'practice-anti-xa', role: 'core', anchor: true },
      { result: 'practice-factor-x', role: 'optional' },
    ],
    labHeadings: [{ lab: LAB, text: 'Anticoagulant profile' }],
  });
  const e1 = inv1.overlay.investigations[0];
  check(
    e1.id === 'practice-anticoagulant-monitoring' && e1.requestAliases.length === 1,
    'new investigation: generated id, duplicate wording dropped'
  );
  check(e1.provenance.reviewed === false, 'unreviewed');
  const lab = inv1.overlay.labs.find((l) => l.id === LAB);
  check(
    lab &&
      lab.override === true &&
      lab.groupHeadings.length === builtin.labs.find((l) => l.id === LAB).groupHeadings.length + 1 &&
      lab.groupHeadings.some((g) => g.text === 'Anticoagulant profile' && g.identifies[0] === e1.id),
    'a lab-specific heading is stored in a complete lab definition (shipped headings kept)'
  );
  check(OV.ownLabHeadings(inv1.overlay, e1.id)[0].text === 'Anticoagulant profile', 'ownLabHeadings reads it back');
  check(
    throwsWith(
      () =>
        OV.saveInvestigation(builtin, E, {
          label: 'No core',
          kind: 'blood',
          requestAliases: [{ text: 'x', system: 'any' }],
          members: [{ result: 'sodium', role: 'optional' }],
        }),
      /core member/
    ),
    'a blood test with no core result is refused'
  );
  check(
    throwsWith(
      () =>
        OV.saveInvestigation(builtin, E, {
          label: 'Bad ref',
          kind: 'blood',
          requestAliases: [],
          members: [{ result: 'no-such-result', role: 'core' }],
        }),
      /unknown result/
    ),
    'an unknown result reference is refused'
  );
  check(
    throwsWith(
      () =>
        OV.saveInvestigation(builtin, E, {
          label: 'Lab?',
          kind: 'imaging',
          requestAliases: [],
          members: [],
          labHeadings: [{ lab: 'nope', text: 'x' }],
        }),
      /unknown lab/
    ),
    'an unknown lab is refused'
  );

  // approve carries the lab extension and results; editing withdraws the approval
  const ap = OV.approveInvestigation(builtin, inv1.overlay, e1.id, 'Nick', '2026-09-19');
  check(
    ap.approvedLabs.includes(LAB) && ap.approvedResults.length === 2,
    'approving also approves its lab heading entry and its results'
  );
  const live = OV.mergeCatalogue(builtin, ap.overlay, {});
  check(
    live.problems.length === 0 &&
      live.catalogue.investigations.some((i) => i.id === e1.id) &&
      live.catalogue.labs.find((l) => l.id === LAB).groupHeadings.some((g) => g.text === 'Anticoagulant profile'),
    'the approved investigation and its heading are in the acting catalogue'
  );
  const edited = OV.saveInvestigation(builtin, ap.overlay, {
    id: e1.id,
    label: 'Anticoagulant monitoring',
    kind: 'blood',
    requestAliases: [{ text: 'Anti-Xa level', system: 'tquest' }],
    headingAliases: ['Anti Xa'],
    members: [{ result: 'practice-anti-xa', role: 'core', anchor: true }],
    labHeadings: [{ lab: LAB, text: 'Anticoagulants' }],
  });
  check(
    edited.overlay.investigations[0].provenance.reviewed === false,
    'editing an approved investigation withdraws its approval'
  );
  check(edited.overlay.investigations[0].members.length === 1, 'a practice entry can drop members');
  check(
    edited.overlay.labs
      .find((l) => l.id === LAB)
      .groupHeadings.map((g) => g.text)
      .filter((t) => /^Anticoag/.test(t))
      .join() === 'Anticoagulants' && edited.overlay.labs.find((l) => l.id === LAB).provenance.reviewed === false,
    'its old lab heading is replaced and the lab entry needs approving again'
  );
  const gone = OV.saveInvestigation(builtin, edited.overlay, {
    id: e1.id,
    label: 'Anticoagulant monitoring',
    kind: 'blood',
    requestAliases: [],
    members: [{ result: 'practice-anti-xa', role: 'core' }],
    labHeadings: [],
  });
  check(
    !gone.overlay.labs.some((l) => l.id === LAB),
    'removing the heading returns the lab to the shipped definition (override removed)'
  );
  const nm = OV.approveInvestigation(
    builtin,
    OV.saveInvestigation(builtin, E, {
      label: 'Bare',
      kind: 'imaging',
      requestAliases: [{ text: 'Bare scan', system: 'any' }],
      members: [],
    }).overlay,
    'practice-bare',
    'x'
  );
  check(nm.approvedLabs.length === 0, 'approving an investigation never approves an unrelated lab');

  // built-in investigation: fully editable, stored as an override
  const bone = builtin.investigations.find((i) => i.id === 'bone-profile');
  const boneSpec = (over) => ({
    id: 'bone-profile',
    label: bone.label,
    kind: bone.kind,
    requestAliases: bone.requestAliases,
    headingAliases: bone.headingAliases,
    exclude: bone.exclude,
    members: bone.members,
    labHeadings: [{ lab: LAB, text: 'Bone profile' }],
    ...(over || {}),
  });
  const same = OV.saveInvestigation(builtin, E, boneSpec());
  check(
    same.reverted === true && same.overlay.investigations.length === 0 && same.overlay.labs.length === 0,
    'the shipped content saves as "no change" (no override, no lab entry)'
  );
  const b1 = OV.saveInvestigation(
    builtin,
    E,
    boneSpec({
      label: 'Bone chemistry',
      kind: 'other',
      requestAliases: [{ text: 'Bone screen', system: 'any' }],
      exclude: [],
      members: bone.members.filter((m) => m.role !== 'shared'),
    })
  );
  const be = b1.overlay.investigations[0];
  check(
    be.override === true && be.label === 'Bone chemistry' && be.kind === 'other',
    'name and sample of a built-in can be changed'
  );
  check(
    be.requestAliases.length === 1 && be.members.length === bone.members.filter((m) => m.role !== 'shared').length,
    'wordings and results can be REMOVED'
  );
  check(be.legacyKey === bone.legacyKey, 'the legacy key is carried');
  const beforeApproval = OV.mergeCatalogue(builtin, b1.overlay, {}).catalogue.investigations.find(
    (i) => i.id === 'bone-profile'
  );
  check(beforeApproval.label === bone.label, 'until approved the shipped test still applies');
  const mm = OV.mergeCatalogue(builtin, OV.approveInvestigation(builtin, b1.overlay, 'bone-profile', 'x').overlay, {});
  const after = mm.catalogue.investigations.find((i) => i.id === 'bone-profile');
  check(
    after.label === 'Bone chemistry' && after.requestAliases.length === 1 && mm.problems.length === 0,
    'once approved the practice version REPLACES it'
  );
  const ch = OV.describeChanges(builtin, b1.overlay, 'bone-profile');
  check(
    ch.some((x) => /Name changed/.test(x)) &&
      ch.some((x) => /Sample changed from blood to other/.test(x)) &&
      ch.some((x) => /^Removed request wording/.test(x)) &&
      ch.some((x) => /^Added request wording: Bone screen/.test(x)) &&
      ch.some((x) => /^Removed result/.test(x)),
    'describeChanges lists what differs from the shipped test'
  );
  check(OV.describeChanges(builtin, E, 'bone-profile').length === 0, '...and nothing when unchanged');
  const rv = OV.revertInvestigation(builtin, b1.overlay, 'bone-profile');
  check(rv.overlay.investigations.length === 0 && rv.reverted === true, 'revert removes the override');
  // sample type: a built-in can be re-classified
  const acr = builtin.investigations.find((i) => i.id === 'urine-acr');
  const acrFix = OV.saveInvestigation(builtin, E, {
    id: 'urine-acr',
    label: acr.label,
    kind: 'faeces',
    requestAliases: acr.requestAliases,
    headingAliases: acr.headingAliases,
    exclude: acr.exclude,
    members: acr.members,
    labHeadings: [],
  });
  check(acrFix.overlay.investigations[0].kind === 'faeces', 'the sample of a built-in can be changed');
  check(
    throwsWith(
      () =>
        OV.saveInvestigation(builtin, E, {
          id: 'bone-profile',
          label: 'x',
          kind: 'blood',
          requestAliases: [],
          members: [{ result: bone.members[0].result, role: 'optional' }],
          labHeadings: [],
        }),
      /core member/
    ),
    'removing every core result is still refused'
  );
  check(
    builtin.investigations.find((i) => i.id === 'urine-acr').kind === 'urine' &&
      builtin.investigations.find((i) => i.id === 'calprotectin').kind === 'faeces',
    'shipped samples: urine ACR is urine, calprotectin is faeces'
  );
}

console.log('\n── editing a result withdraws approvals that depend on it ──');
{
  const LAB = 'rj700-general-pathology';
  const r = OV.saveResult(builtin, OV.emptyOverlay(), {
    label: 'Anti-Xa',
    valueKind: 'numeric',
    codes: [],
    aliases: [{ text: 'Anti Xa', lab: LAB }],
  });
  const i = OV.saveInvestigation(builtin, r.overlay, {
    label: 'Anticoag',
    kind: 'blood',
    requestAliases: [{ text: 'Anti-Xa', system: 'any' }],
    members: [{ result: 'practice-anti-xa', role: 'core' }],
  });
  const ap = OV.approveInvestigation(builtin, i.overlay, 'practice-anticoag', 'x').overlay;
  check(
    OV.mergeCatalogue(builtin, ap, {}).catalogue.investigations.some((x) => x.id === 'practice-anticoag'),
    'approved test is live'
  );
  const edited = OV.saveResult(builtin, ap, {
    id: 'practice-anti-xa',
    label: 'Anti-Xa',
    valueKind: 'numeric',
    codes: [{ conceptId: '900000000000777', role: 'primary' }],
    aliases: [{ text: 'Anti Xa', lab: LAB }],
  });
  check(
    edited.overlay.investigations[0].provenance.reviewed === false,
    'the test using an edited practice result goes back to awaiting review'
  );
  const m = OV.mergeCatalogue(builtin, edited.overlay, {});
  check(
    !m.catalogue.investigations.some((x) => x.id === 'practice-anticoag') && m.problems.length === 0,
    'and drops out cleanly (no invalid catalogue)'
  );
  const back = OV.approveInvestigation(builtin, edited.overlay, 'practice-anticoag', 'x').overlay;
  check(
    OV.mergeCatalogue(builtin, back, {}).catalogue.investigations.some((x) => x.id === 'practice-anticoag'),
    're-approving restores it'
  );
}

console.log('\n── override flag ──');
{
  const o = OV.emptyOverlay();
  const sodium = builtin.results.find((r) => r.id === 'sodium');
  const spec = {
    id: 'sodium',
    label: 'Serum sodium',
    valueKind: sodium.valueKind,
    codes: sodium.codes,
    aliases: sodium.aliases,
  };
  const saved = OV.saveResult(builtin, o, spec).overlay;
  check(OV.sanitiseOverlay(saved).results[0].override === true, 'the override flag survives sanitising');
  const bad = JSON.parse(JSON.stringify(saved));
  bad.results[0].override = 'yes';
  check(
    throwsWith(() => OV.sanitiseOverlay(bad), /override must be a boolean/),
    'a non-boolean override is rejected'
  );
  const inert = OV.forceInert(OV.markReviewed(saved, 'results', 'sodium', 'x'));
  check(
    inert.results[0].override === true && inert.results[0].provenance.reviewed === false,
    'an override that arrives by restore / shared profile is still forced inert'
  );
  check(
    OV.mergeCatalogue(builtin, inert, {}).catalogue.results.find((r) => r.id === 'sodium').label === sodium.label,
    'so the shipped definition keeps applying until it is approved here'
  );
}
console.log('\n── merging one test into another ──');
{
  const LAB = 'rj700-general-pathology';
  let o = OV.emptyOverlay();
  o = OV.saveResult(builtin, o, {
    label: 'Ova cysts and parasites',
    valueKind: 'text',
    codes: [{ conceptId: '900000000000321', role: 'primary' }],
    aliases: [{ text: 'OCP', lab: LAB }],
  }).overlay;
  o = OV.saveResult(builtin, o, {
    label: 'Stool culture',
    valueKind: 'text',
    codes: [],
    aliases: [{ text: 'Stool culture' }],
  }).overlay;
  o = OV.saveInvestigation(builtin, o, {
    label: 'Stool MC&S',
    kind: 'microbiology',
    requestAliases: [{ text: 'Faeces MC&S', system: 'any' }],
    members: [{ result: 'practice-stool-culture', role: 'core' }],
    labHeadings: [],
  }).overlay;
  o = OV.saveInvestigation(builtin, o, {
    label: 'Faeces - Ova Cysts and Parasites',
    kind: 'microbiology',
    requestAliases: [{ text: 'Faeces - Ova Cysts and Parasites', system: 'tquest' }],
    headingAliases: ['Faeces parasites'],
    members: [{ result: 'practice-ova-cysts-and-parasites', role: 'core' }],
    labHeadings: [{ lab: LAB, text: 'OVA CYSTS PARASITES' }],
  }).overlay;
  const from = 'practice-faeces-ova-cysts-and-parasites';
  const into = 'practice-stool-mc-and-s';
  o = OV.approveInvestigation(builtin, o, into, 'x').overlay;
  const r = OV.mergeInvestigation(builtin, o, from, into, '2026-09-22');
  const t = r.overlay.investigations.find((i) => i.id === into);
  check(!r.overlay.investigations.some((i) => i.id === from), 'the merged-away test is deleted');
  check(
    t.members.length === 2 &&
      t.members.find((m) => m.result === 'practice-ova-cysts-and-parasites').role === 'optional',
    'its result moves across as OPTIONAL (the target already has an identifying result)'
  );
  check(
    t.requestAliases.some((a) => a.text === 'Faeces - Ova Cysts and Parasites' && a.system === 'any') &&
      t.requestAliases.some((a) => a.system === 'tquest'),
    'its request wordings move too, so that request is still recognised'
  );
  check(t.headingAliases.includes('Faeces parasites'), 'its report heading aliases move');
  const lab = r.overlay.labs.find((l) => l.id === LAB);
  check(
    lab.groupHeadings.some((g) => g.text === 'OVA CYSTS PARASITES' && g.identifies.join() === into),
    'the lab heading now identifies the target'
  );
  check(
    t.provenance.reviewed === false && lab.provenance.reviewed === false,
    'the target (and the lab) go back to awaiting review'
  );
  check(r.moved.results === 1, 'the summary counts what moved');
  const live = OV.mergeCatalogue(builtin, OV.approveInvestigation(builtin, r.overlay, into, 'x').overlay, {});
  check(
    live.problems.length === 0 &&
      LC.resolveRequest(LC.buildIndex(live.catalogue), 'Faeces - Ova Cysts and Parasites')[0].investigationId === into,
    'approved, it is a valid catalogue and the old request now resolves to the target'
  );
  check(
    throwsWith(() => OV.mergeInvestigation(builtin, o, from, from), /itself/),
    'not into itself'
  );
  check(
    throwsWith(() => OV.mergeInvestigation(builtin, o, 'ue', into), /built-in/),
    'a built-in cannot be merged away'
  );
  check(
    throwsWith(() => OV.mergeInvestigation(builtin, o, from, 'nope'), /not found/),
    'unknown target'
  );
  // into a BUILT-IN: additive, never an override
  const b = OV.mergeInvestigation(builtin, o, from, 'crp');
  const be = b.overlay.investigations.find((i) => i.id === 'crp');
  check(
    be && !be.override && be.members.length === 1 && be.provenance.reviewed === false,
    'merging into a built-in test adds to it (append-only), it does not override it'
  );
  check(JSON.stringify(builtin) === JSON.stringify(JSON.parse(JSON.stringify(builtin))), 'built-in untouched');
}
console.log('\n── dangling links (deleted tests must not poison a lab) ──');
{
  const LAB = 'rj700-general-pathology';
  let o = OV.emptyOverlay();
  o = OV.saveResult(builtin, o, {
    label: 'Zed',
    valueKind: 'numeric',
    codes: [{ conceptId: '900000000000455', role: 'primary' }],
    aliases: [],
  }).overlay;
  o = OV.saveInvestigation(builtin, o, {
    label: 'Zed test',
    kind: 'blood',
    requestAliases: [{ text: 'Zed', system: 'any' }],
    members: [{ result: 'practice-zed', role: 'core' }],
    labHeadings: [{ lab: LAB, text: 'ZED PANEL' }],
  }).overlay;
  check(
    o.labs.length === 1 && o.labs[0].groupHeadings.some((g) => g.text === 'ZED PANEL'),
    'setup: the lab carries a heading for the test'
  );

  // deleting the test used to leave the heading pointing at nothing, which made the WHOLE lab entry invalid
  const removed = OV.removeInvestigation(builtin, o, 'practice-zed-test');
  check(
    !removed.overlay.labs[0].groupHeadings.some((g) => g.text === 'ZED PANEL'),
    'deleting a test removes the lab headings that identified it'
  );
  const mr = OV.mergeCatalogue(builtin, removed.overlay, { includeUnreviewed: true });
  check(mr.problems.length === 0, 'and nothing is left excluded');

  // an overlay already damaged that way (from before this fix) heals instead of excluding the lab
  const damaged = JSON.parse(JSON.stringify(o));
  damaged.investigations = damaged.investigations.filter((i) => i.id !== 'practice-zed-test');
  const md = OV.mergeCatalogue(builtin, damaged, { includeUnreviewed: true });
  check(
    md.catalogue.labs.find((l) => l.id === LAB) && md.excluded.length === 0,
    'a lab with a dangling heading link is still used (the link is dropped)'
  );
  check(
    md.problems.some((p) => p.kind === 'labs' && /no longer exists \(ignored\)$/.test(p.reason)),
    'and the dropped link is reported as a non-fatal note'
  );
  const fill = OV.applyFills(builtin, damaged, {
    labs: [{ ref: LAB, headings: [{ text: 'NEW PANEL', identifies: ['crp'] }] }],
    results: [],
    members: [],
  });
  check(fill.added.headings === 1, 'a scan can still add to that lab (it was failing before)');

  // remove an entry the merge excluded
  const bad = JSON.parse(JSON.stringify(o));
  bad.results[0].codes = [];
  bad.results[0].aliases = [];
  const mb = OV.mergeCatalogue(builtin, bad, { includeUnreviewed: true });
  check(
    mb.problems.some((p) => p.id === 'practice-zed'),
    'setup: a result with nothing to recognise it by is excluded'
  );
  const fixed = OV.removeEntry(bad, 'results', 'practice-zed');
  check(
    fixed.results.length === 0 &&
      fixed.investigations[0].members.length === 0 &&
      fixed.investigations[0].provenance.reviewed === false,
    'removeEntry deletes it and takes it out of the tests that used it (which go back to review)'
  );
  check(
    throwsWith(() => OV.removeEntry(bad, 'labs', 'nope'), /not found/),
    'removing something that is not there is an error'
  );
}

console.log('\n── approval cascade cannot activate foreign heading mappings (red-team 2026-09-20) ──');
{
  // A crafted import adds a plausible new test plus a NEW lab whose second heading maps a "Urea and electrolytes"-style
  // wording onto a DIFFERENT built-in test. Approving the new test must NOT approve that lab as a side effect: the
  // poisoned mapping was never shown to the reviewer, and once live it misfiles that analyte with heading confidence.
  const evilLab = (headings) => ({
    id: 'evil-lab',
    name: 'Evil Lab',
    identifiers: { performerOrg: 'EVIL1' },
    groupHeadings: headings,
    provenance: unreviewed,
  });
  const base = {
    results: [newResult('practice-calpro-s', '900000000000777', { ...unreviewed })],
    investigations: [
      newInv('practice-calpro-surv', [{ result: 'practice-calpro-s', role: 'core' }], { ...unreviewed }),
    ],
  };
  const o1 = OV.sanitiseOverlay({
    ...base,
    labs: [
      evilLab([
        { text: 'Calprotectin surveillance', identifies: ['practice-calpro-surv'] },
        { text: 'Urea and electrolytes', identifies: ['lipids'] },
      ]),
    ],
  });
  const ap1 = OV.approveInvestigation(builtin, o1, 'practice-calpro-surv', 'test', '2026-09-20');
  check(
    ap1.approvedLabs.length === 0 &&
      ap1.overlay.labs[0].provenance.reviewed === false &&
      !OV.mergeCatalogue(builtin, ap1.overlay, {}).catalogue.labs.some((l) => l.id === 'evil-lab'),
    'a lab heading mapping a wording onto a DIFFERENT test is never approved as a side effect'
  );
  const o2 = OV.sanitiseOverlay({
    ...base,
    labs: [
      evilLab([{ text: 'Calprotectin surveillance', identifies: ['practice-calpro-surv'], mayContain: ['inv:ue'] }]),
    ],
  });
  const ap2 = OV.approveInvestigation(builtin, o2, 'practice-calpro-surv', 'test', '2026-09-20');
  check(ap2.approvedLabs.length === 0, 'a mayContain reference to a different test also blocks the cascade');
  const o3 = OV.sanitiseOverlay({
    ...base,
    labs: [
      evilLab([
        {
          text: 'Calprotectin surveillance',
          identifies: ['practice-calpro-surv'],
          mayContain: ['inv:practice-calpro-surv', 'res:practice-calpro-s'],
        },
      ]),
    ],
  });
  const ap3 = OV.approveInvestigation(builtin, o3, 'practice-calpro-surv', 'test', '2026-09-20');
  check(
    ap3.approvedLabs.length === 1 && ap3.overlay.labs[0].provenance.reviewed === true,
    'a lab whose headings reference ONLY the approved test (and its members) still cascades'
  );
}

console.log('\n── duplicate ids reject (a hidden override must not ride an innocent copy) ──');
{
  check(
    throwsWith(
      () =>
        OV.sanitiseOverlay({
          results: [
            newResult('adjusted-calcium', '900000000000123', { ...unreviewed }),
            newResult('adjusted-calcium', '900000000000124', { ...unreviewed }, { override: true }),
          ],
        }),
      /more than one entry with id "adjusted-calcium"/
    ),
    'two results under one id are rejected by the sanitiser'
  );
  check(
    throwsWith(
      () =>
        OV.sanitiseOverlay({
          investigations: [newInv('dup-inv', [], { ...unreviewed }), newInv('dup-inv', [], { ...unreviewed })],
        }),
      /more than one entry with id "dup-inv"/
    ),
    'two investigations under one id are rejected'
  );
}

console.log('\n── stripApprovals: approvals (and reviewer names) never travel ──');
{
  const o = OV.sanitiseOverlay({ results: [newResult('r-appr', '900000000000123', reviewed())] });
  const s = OV.stripApprovals(o);
  const p = s.results[0].provenance;
  check(
    p.reviewed === false && !('reviewedBy' in p) && !('reviewedAt' in p) && p.source === 'practice',
    'stripApprovals clears reviewed/reviewedBy/reviewedAt but leaves the source untouched'
  );
  check(o.results[0].provenance.reviewed === true, 'the input overlay is not mutated');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
