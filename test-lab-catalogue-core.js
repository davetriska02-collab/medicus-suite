// Medicus Suite — Lab Result Catalogue core: validator, matching and resolver (hand-built catalogues).
// Run with: node test-lab-catalogue-core.js
//
// Phase A of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md. The real-data (golden corpus) checks live in
// test-lab-catalogue-corpus.js; this file pins the LOGIC on small synthetic catalogues, including the adversarial
// text-collision cases that motivated the rework (alp/calprotectin, alt/salt, ast/elastase, albumin/microalbumin).

'use strict';
const LC = require('./shared/lab-catalogue-core.js');

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

// ── a small, valid catalogue used by most tests ─────────────────────────────────
const res = (id, label, code, extra) => ({
  id,
  label,
  valueKind: 'numeric',
  codes: code ? [{ conceptId: code, role: 'primary' }] : [],
  aliases: [{ text: label }],
  ...extra,
});
function baseCatalogue() {
  return {
    schema: 1,
    retired: [],
    results: [
      res('alt', 'ALT', '1018251000000107'),
      res('bilirubin', 'Bilirubin', '999691000000104'),
      res('alp', 'ALP', '1000621000000104', { aliases: [{ text: 'alp' }, { text: 'alkaline phosphatase' }] }),
      res('albumin', 'Albumin', '1000821000000103', { excludeAliases: ['urine'] }),
      res('ggt', 'GGT', null),
      res('calcium', 'Calcium', '1000691000000101', { excludeAliases: ['adjusted'] }),
      res('adjusted-calcium', 'Adjusted calcium', '935051000000108'),
      res('phosphate', 'Phosphate', '1000701000000101'),
      res('calprotectin', 'Faecal calprotectin', '1002571000000102', {
        aliases: [{ text: 'faecal calprotectin' }, { text: 'calprotectin' }],
      }),
      res('tsh', 'TSH', '1022791000000101'),
      res('culture', 'Culture', null, { valueKind: 'text', aliases: [{ text: 'culture' }] }),
    ],
    investigations: [
      {
        id: 'lft',
        label: 'Liver function tests',
        kind: 'blood',
        requestAliases: [{ text: 'liver function', system: 'any' }],
        headingAliases: ['lft'],
        members: [
          { result: 'alt', role: 'core' },
          { result: 'bilirubin', role: 'core' },
          { result: 'alp', role: 'shared' },
          { result: 'albumin', role: 'shared' },
          { result: 'ggt', role: 'optional' },
        ],
      },
      {
        id: 'ggt',
        label: 'GGT',
        kind: 'blood',
        requestAliases: [
          { text: 'gamma glutamyl transferase', system: 'any' },
          { text: 'ggt', system: 'any' },
        ],
        members: [{ result: 'ggt', role: 'core' }],
      },
      {
        id: 'bone-profile',
        label: 'Bone profile',
        kind: 'blood',
        requestAliases: [{ text: 'bone profile', system: 'any' }],
        members: [
          { result: 'phosphate', role: 'core' },
          { result: 'adjusted-calcium', role: 'core' },
          { result: 'calcium', role: 'shared' },
          { result: 'alp', role: 'shared' },
          { result: 'albumin', role: 'shared' },
        ],
      },
      {
        id: 'calprotectin',
        label: 'Faecal calprotectin',
        kind: 'blood',
        requestAliases: [{ text: 'calprotectin', system: 'any' }],
        members: [{ result: 'calprotectin', role: 'core' }],
      },
      {
        id: 'tft',
        label: 'Thyroid function',
        kind: 'blood',
        requestAliases: [{ text: 'thyroid', system: 'any' }],
        members: [{ result: 'tsh', role: 'core', anchor: true }],
      },
      {
        id: 'throat-swab',
        label: 'Throat swab',
        kind: 'microbiology',
        requestAliases: [{ text: 'throat swab', system: 'any' }],
        members: [{ result: 'culture', role: 'core' }],
      },
      {
        id: 'nose-swab',
        label: 'Nose swab',
        kind: 'microbiology',
        requestAliases: [{ text: 'nose swab', system: 'any' }],
        members: [{ result: 'culture', role: 'core' }],
      },
    ],
    labs: [
      {
        id: 'labx',
        name: 'Lab X',
        identifiers: { performerOrg: 'LABX', department: 'Path' },
        groupHeadings: [
          { text: 'LFTs', identifies: ['lft'], mayContain: ['inv:ggt'] },
          { text: 'Bone profile', identifies: ['bone-profile'] },
          { text: 'THROAT SWAB', identifies: ['throat-swab'] },
          { text: 'NOSE SWAB', identifies: ['nose-swab'] },
          { text: 'TSH', identifies: ['tft'] },
        ],
      },
    ],
  };
}
const idxOf = () => LC.buildIndex(baseCatalogue());
const rr = (o) => ({
  name: o.name,
  code: o.code || null,
  resultType: o.type || 'unit-value-result',
  hasNumericValue: o.text ? false : true,
  text: o.text || null,
});
const report = (org, groups, ungrouped) => ({
  lab: { organisation: org, department: null },
  groups: (groups || []).map(([heading, rs]) => ({ heading, results: rs.map(rr) })),
  ungrouped: (ungrouped || []).map(rr),
});

// ── 1. text matching: whole tokens only ─────────────────────────────────────────
console.log('--- whole-token matching (the alp/calprotectin class of bug) ---');
{
  const n = LC.norm;
  check(LC.hasTerm(n('Faecal Calprotectin'), n('alp')) === false, '"alp" does NOT match "Faecal Calprotectin"');
  check(LC.hasTerm(n('Salt intake'), n('alt')) === false, '"alt" does NOT match "salt"');
  check(LC.hasTerm(n('Faecal elastase 1'), n('ast')) === false, '"ast" does NOT match "elastase"');
  check(LC.hasTerm(n('Fasting glucose'), n('ast')) === false, '"ast" does NOT match "fasting"');
  check(LC.hasTerm(n('Urine microalbumin'), n('albumin')) === false, '"albumin" does NOT match "microalbumin"');
  check(LC.hasTerm(n('ALP'), n('alp')) === true, '"alp" matches the token "ALP"');
  check(
    LC.hasTerm(n('Serum bilirubin level'), n('bilirubin')) === true,
    'a term inside a longer name matches on token boundaries'
  );
  check(LC.hasTerm(n('LFTs'), n('lft')) === true, 'a plural "s" on the text token is tolerated ("lfts" ~ "lft")');
  check(LC.hasTerm(n('U&Es'), n('u&e')) === true, '"u&es" ~ "u&e" (ampersand kept as part of the token)');
  check(LC.hasTerm('', 'x') === false && LC.hasTerm('x', '') === false, 'empty input never matches');
}

// ── 2. validator ────────────────────────────────────────────────────────────────
console.log('\n--- validateCatalogue ---');
{
  const ok = LC.validateCatalogue(baseCatalogue());
  check(ok.errors.length === 0, 'the base test catalogue is valid (' + ok.errors.join('; ') + ')');
  const mut = (fn) => {
    const c = baseCatalogue();
    fn(c);
    return LC.validateCatalogue(c).errors.join(' | ');
  };
  check(/schema must be 1/.test(mut((c) => (c.schema = 2))), 'wrong schema version is rejected');
  check(
    /duplicate result id/.test(mut((c) => c.results.push(res('alt', 'ALT again', null)))),
    'duplicate result id is rejected'
  );
  check(
    /already claimed by result "alt"/.test(mut((c) => c.results.push(res('alt2', 'ALT two', '1018251000000107')))),
    'a concept claimed by two results is rejected'
  );
  check(
    /conceptId must be digits/.test(mut((c) => (c.results[0].codes[0].conceptId = 'abc'))),
    'a non-numeric conceptId is rejected'
  );
  check(
    /at most one primary/.test(mut((c) => c.results[0].codes.push({ conceptId: '999999999', role: 'primary' }))),
    'two primary codes on one result are rejected'
  );
  check(
    /unknown result "nope"/.test(mut((c) => c.investigations[0].members.push({ result: 'nope', role: 'core' }))),
    'a member referencing an unknown result is rejected'
  );
  check(
    /role must be one of/.test(mut((c) => (c.investigations[0].members[0].role = 'required'))),
    'an unknown member role is rejected'
  );
  check(
    /only a core member can be an anchor/.test(mut((c) => (c.investigations[0].members[2].anchor = true))),
    'anchor on a non-core member is rejected'
  );
  check(
    /needs at least one member/.test(mut((c) => (c.investigations[3].members = []))),
    'a blood investigation with no members is rejected'
  );
  check(
    /needs at least one core member/.test(
      mut((c) => (c.investigations[0].members = [{ result: 'alp', role: 'shared' }]))
    ),
    'an investigation with no core member is rejected'
  );
  check(
    /mayContain entries must be/.test(mut((c) => (c.labs[0].groupHeadings[0].mayContain = ['lft']))),
    'un-prefixed mayContain is rejected (inv:/res: required)'
  );
  check(
    /mayContain unknown investigation/.test(mut((c) => (c.labs[0].groupHeadings[0].mayContain = ['inv:zzz']))),
    'mayContain of an unknown investigation is rejected'
  );
  check(
    /identifies unknown investigation/.test(mut((c) => (c.labs[0].groupHeadings[0].identifies = ['zzz']))),
    'a heading identifying an unknown investigation is rejected'
  );
  check(/retired and must not be reused/.test(mut((c) => (c.retired = ['alt']))), 'a retired id cannot be reused');
  const polluted = JSON.parse('{"schema":1,"results":[],"investigations":[],"constructor":{}}');
  check(/forbidden key/.test(LC.validateCatalogue(polluted).errors.join('|')), 'a "constructor" key is rejected');
  check(LC.validateCatalogue(null).errors.length === 1, 'null is rejected without throwing');
  check(
    throwsWith(() => LC.buildIndex({ schema: 9 }), /Invalid lab catalogue/),
    'buildIndex refuses an invalid catalogue'
  );
  const w = LC.validateCatalogue(
    Object.assign(baseCatalogue(), {
      results: [res('ast', 'AST', null, { aliases: [{ text: 'ast' }] })],
      investigations: [],
      labs: [],
    })
  );
  check(
    w.errors.length === 0 && w.warnings.some((x) => /short lab-neutral alias "ast"/.test(x)),
    'a short lab-neutral alias is a WARNING, not an error'
  );
}

// ── 3. result resolution: code first, then scoped alias ─────────────────────────
console.log('\n--- resolveReport: results ---');
{
  const idx = idxOf();
  const r = LC.resolveReport(
    idx,
    report('LABX', [['LFTs', [{ name: 'Whatever the lab calls it', code: '1018251000000107' }, { name: 'Bilirubin' }]]])
  );
  check(
    r.results[0].resultId === 'alt' && r.results[0].confidence === 'coded',
    'a coded result resolves by CODE regardless of its text'
  );
  check(
    r.results[1].resultId === 'bilirubin' && r.results[1].confidence === 'alias-in-scope',
    'an uncoded result resolves by alias INSIDE its heading scope'
  );
  const unk = LC.resolveReport(idx, report('LABX', [['LFTs', [{ name: 'ALT', code: '999000111' }]]]));
  check(
    unk.results[0].resultId === 'alt' && unk.results[0].codeUnknown === '999000111',
    'an unknown code falls back to the alias and is reported (codeUnknown)'
  );
  const unscoped = LC.resolveReport(idx, report('LABX', [], [{ name: 'ALP' }]));
  check(
    unscoped.results[0].resultId === 'alp' && unscoped.results[0].confidence === 'alias-unscoped',
    'an ungrouped alias hit is only "alias-unscoped" (never sufficient to file)'
  );
  const none = LC.resolveReport(idx, report('LABX', [['Odd heading', [{ name: 'Mystery analyte' }]]]));
  check(
    none.results[0].confidence === 'unresolved' && none.unresolved.length === 1,
    'an unrecognised result is "unresolved" and listed'
  );
}

// ── 4. the reported bug, on synthetic data ──────────────────────────────────────
console.log('\n--- the reported bug: calprotectin must never look like ALP / a bone profile ---');
{
  const idx = idxOf();
  const r = LC.resolveReport(idx, report('LABX', [['CALPROTECTIN (FAECAL)', [{ name: 'Faecal Calprotectin' }]]]));
  check(r.results[0].resultId === 'calprotectin', 'an uncoded "Faecal Calprotectin" resolves to calprotectin');
  check(!('bone-profile' in r.coverage), 'the bone profile is NOT covered by a calprotectin report');
  check('calprotectin' in r.coverage, 'calprotectin IS covered (generic heading alias from the investigation label)');
  const coded = LC.resolveReport(
    idx,
    report('LABX', [['CALPROTECTIN (FAECAL)', [{ name: 'x', code: '1002571000000102' }]]])
  );
  check(coded.results[0].confidence === 'coded' && !('bone-profile' in coded.coverage), 'same when coded');
}

// ── 5. group <-> request is many-to-many ────────────────────────────────────────
console.log('\n--- group <-> request many-to-many, partial groups, shared results ---');
{
  const idx = idxOf();
  // LFTs group with GGT inside: GGT attributed to BOTH lft and ggt; ggt covered by its own result, not by the heading.
  const withGgt = LC.resolveReport(
    idx,
    report('LABX', [['LFTs', [{ name: 'ALT' }, { name: 'Bilirubin' }, { name: 'GGT' }]]])
  );
  const g = withGgt.results.find((x) => x.resultId === 'ggt');
  check(
    g && g.attributedTo.includes('lft') && g.attributedTo.includes('ggt'),
    'GGT inside an LFTs group is attributed to both lft and ggt'
  );
  check(
    withGgt.coverage.ggt && withGgt.coverage.ggt.via === 'signature' && withGgt.coverage.ggt.confidence === 'confident',
    'the GGT request is covered by the GGT RESULT (single-result test), wherever it sits'
  );
  const withoutGgt = LC.resolveReport(idx, report('LABX', [['LFTs', [{ name: 'ALT' }, { name: 'Bilirubin' }]]]));
  check(
    !('ggt' in withoutGgt.coverage),
    'mayContain does NOT clear a request: no GGT result -> the GGT request stays uncovered'
  );
  check(
    withoutGgt.coverage.lft && withoutGgt.coverage.lft.confidence === 'confident',
    'an LFTs group with no ALP still clears LFT (a partial group clears its request)'
  );
  // ALP alone under LFTs: today's matcher clears LFT and that is intended.
  const alpOnly = LC.resolveReport(idx, report('LABX', [['LFTs', [{ name: 'ALP' }]]]));
  check(
    alpOnly.coverage.lft && alpOnly.coverage.lft.confidence === 'confident' && alpOnly.coverage.lft.via === 'heading',
    'ALP alone under an LFTs heading clears LFT (intended, as today)'
  );
  // shared ALP is attributed only to the investigation(s) its group can be
  const boneWithAlp = LC.resolveReport(
    idx,
    report('LABX', [
      ['Bone profile', [{ name: 'Phosphate' }, { name: 'Adjusted calcium' }, { name: 'ALP' }, { name: 'Albumin' }]],
    ])
  );
  const alp = boneWithAlp.results.find((x) => x.resultId === 'alp');
  check(
    alp.attributedTo.length === 1 && alp.attributedTo[0] === 'bone-profile',
    'ALP under "Bone profile" is attributed to the bone profile only'
  );
  check(!('lft' in boneWithAlp.coverage), 'ALP/albumin (shared) under a bone group do NOT cover LFT');
  // report split across two reports: each clears its own request
  const r1 = LC.resolveReport(idx, report('LABX', [['LFTs', [{ name: 'ALT' }, { name: 'Bilirubin' }]]]));
  const r2 = LC.resolveReport(
    idx,
    report('LABX', [['Bone profile', [{ name: 'Phosphate' }, { name: 'Adjusted calcium' }]]])
  );
  check(
    r1.coverage.lft && !('bone-profile' in r1.coverage) && r2.coverage['bone-profile'] && !('lft' in r2.coverage),
    "Bob's two separate reports: each clears exactly its own request"
  );
  // a result the heading does not allow is flagged out-of-scope
  const oos = LC.resolveReport(idx, report('LABX', [['TSH', [{ name: 'ALT' }]]]));
  check(
    oos.results[0].outOfScope === true && oos.results[0].attributedTo.length === 0,
    "a result outside its heading's candidate set is flagged outOfScope (filing would block)"
  );
}

// ── 6. microbiology: the heading is the only discriminator ──────────────────────
console.log('\n--- generic result name reused across specimens ("Culture") ---');
{
  const idx = idxOf();
  const r = LC.resolveReport(
    idx,
    report('LABX', [['THROAT SWAB', [{ name: 'Culture', type: 'text-result', text: 'No growth' }]]])
  );
  check(
    r.coverage['throat-swab'] && r.coverage['throat-swab'].confidence === 'confident',
    'Culture under THROAT SWAB covers the throat swab'
  );
  check(!('nose-swab' in r.coverage), '…and does NOT cover the nose swab');
  check(
    r.results[0].attributedTo.length === 1 && r.results[0].attributedTo[0] === 'throat-swab',
    'Culture is attributed to the throat swab only'
  );
  check(
    r.results[0].hasValue === true && r.results[0].labMessage === false,
    'a text result for a TEXT-kind result is a real value, not a lab message'
  );
  const both = LC.resolveReport(
    idx,
    report('LABX', [
      ['THROAT SWAB', [{ name: 'Culture', type: 'text-result', text: 'x' }]],
      ['NOSE SWAB', [{ name: 'Culture', type: 'text-result', text: 'y' }]],
    ])
  );
  check(
    both.coverage['throat-swab'] && both.coverage['nose-swab'],
    'both swabs in one report cover both investigations'
  );
}

// ── 7. values, lab messages ─────────────────────────────────────────────────────
console.log('\n--- lab messages are not values ---');
{
  const idx = idxOf();
  const r = LC.resolveReport(
    idx,
    report('LABX', [
      [
        'TSH',
        [
          {
            name: 'TSH',
            code: '1022791000000101',
            type: 'text-result',
            text: 'This test has already been performed recently (within 14 days).',
          },
        ],
      ],
    ])
  );
  const t = r.results[0];
  check(
    t.hasValue === false && t.labMessage === true && t.labMessageKind === 'already-done',
    'a text "TSH" is a lab message (already-done), not a value'
  );
  check(
    r.coverage.tft && r.coverage.tft.confidence === 'confident' && r.coverage.tft.labMessageOnly === true,
    'the TSH request still CLEARS (decided) but carries labMessageOnly so it can be flagged'
  );
  check(!r.resolvedResultIds.includes('tsh'), 'a lab message is not counted in resolvedResultIds (values only)');
  check(
    LC.classifyLabMessage('Sample dropped in transit') === 'sample-problem',
    '"sample dropped" -> sample-problem (may need repeating)'
  );
  check(
    LC.classifyLabMessage('Wrong bottle sent - please repeat') === 'sample-problem',
    '"wrong bottle" -> sample-problem'
  );
  check(LC.classifyLabMessage('Sample haemolysed') === 'sample-problem', '"haemolysed" -> sample-problem');
  check(
    LC.classifyLabMessage('EGFR not applicable in children') === 'not-applicable',
    '"not applicable" -> not-applicable'
  );
  check(LC.classifyLabMessage('Please contact the duty biochemist') === 'other', 'anything else -> other');
  const numeric = LC.resolveReport(idx, report('LABX', [['TSH', [{ name: 'TSH' }]]]));
  check(numeric.results[0].hasValue === true && numeric.resolvedResultIds.includes('tsh'), 'a numeric value counts');
}

// ── 8. lab identification, lab-tagged aliases ───────────────────────────────────
console.log('\n--- labs and lab-tagged aliases ---');
{
  const c = baseCatalogue();
  c.results.find((r) => r.id === 'alp').aliases.push({ text: 'Alk Phos LabX', lab: 'labx' });
  const idx = LC.buildIndex(c);
  const inLab = LC.resolveReport(idx, report('LABX', [['Bone profile', [{ name: 'Alk Phos LabX' }]]]));
  check(inLab.lab === 'labx' && inLab.results[0].resultId === 'alp', 'a lab-tagged alias applies for that lab');
  const other = LC.resolveReport(idx, report('SOMEONE-ELSE', [['Bone profile', [{ name: 'Alk Phos LabX' }]]]));
  check(other.lab === null && other.results[0].resultId === null, 'a lab-tagged alias does NOT apply at another lab');
  check(LC.identifyLab(idx, { organisation: 'labx', department: 'PATH' }).def.id === 'labx', 'lab match ignores case');
  check(
    LC.identifyLab(idx, { organisation: 'LABX', department: 'Other dept' }) === null,
    'a different department does not match a lab that specifies one'
  );
  check(LC.identifyLab(idx, null) === null, 'no performer -> no lab');
}

// ── 9. ambiguity and heading fallbacks ──────────────────────────────────────────
console.log('\n--- ambiguity, generic headings, inference ---');
{
  const c = baseCatalogue();
  c.results.push(
    res('x1', 'Shared word', null, { aliases: [{ text: 'foo bar' }] }),
    res('x2', 'Other word', null, { aliases: [{ text: 'foo bar' }] })
  );
  const idx = LC.buildIndex(c);
  const amb = LC.resolveReport(idx, report('LABX', [], [{ name: 'foo bar' }]));
  check(
    amb.results[0].confidence === 'unresolved' && amb.results[0].ambiguous && amb.results[0].ambiguous.length === 2,
    'two results tying on the longest alias -> unresolved + ambiguous (never guess)'
  );
  const i2 = idxOf();
  const generic = LC.resolveReport(
    i2,
    report('UNKNOWN LAB', [['Liver function tests', [{ name: 'ALT', code: '1018251000000107' }]]])
  );
  check(
    generic.lab === null && generic.coverage.lft && generic.coverage.lft.via === 'heading',
    'an unknown lab still resolves via the lab-neutral heading aliases'
  );
  check(generic.groups[0].headingConfidence === 'heading', 'headingConfidence is "heading" for a generic heading hit');
  const inferred = LC.resolveReport(
    i2,
    report('UNKNOWN LAB', [
      [
        'Some odd heading',
        [
          { name: 'a', code: '1018251000000107' },
          { name: 'b', code: '999691000000104' },
        ],
      ],
    ])
  );
  check(
    inferred.groups[0].headingConfidence === 'inferred' &&
      inferred.coverage.lft &&
      inferred.coverage.lft.via === 'signature',
    'an unmapped heading is INFERRED from two core results (never "heading" — so never fileable)'
  );
  const lone = LC.resolveReport(
    i2,
    report('UNKNOWN LAB', [['Some odd heading', [{ name: 'a', code: '1018251000000107' }]]])
  );
  check(
    lone.coverage.lft && lone.coverage.lft.confidence === 'tentative',
    'a lone core result in an unmapped group is only TENTATIVE (as today: "confirm before clearing")'
  );
  const anchor = LC.resolveReport(i2, report('UNKNOWN LAB', [], [{ name: 'TSH', code: '1022791000000101' }]));
  check(
    anchor.coverage.tft && anchor.coverage.tft.confidence === 'confident',
    'an anchor / single-result test is confident on ONE result'
  );
}

// ── 10. request card lines ──────────────────────────────────────────────────────
console.log('\n--- resolveRequest / parseRequestName ---');
{
  const idx = idxOf();
  check(
    LC.parseRequestName('Liver Function (Dr Jane Smith • 09 Sep 2026, 14:06)') === 'Liver Function',
    'the requester/date suffix is removed'
  );
  check(
    LC.parseRequestName('Bone Profile (Calcium Studies) (Dr X • 09 Sep 2026, 14:06)') ===
      'Bone Profile (Calcium Studies)',
    'a bracket that is part of the test name is kept'
  );
  check(
    LC.parseRequestName('Bone Profile (Calcium Studies)') === 'Bone Profile (Calcium Studies)',
    'a bare name (no bullet) is untouched'
  );
  const m = LC.resolveRequest(idx, 'Bone Profile (Calcium Studies) (Dr X • 09 Sep 2026, 14:06)');
  check(m.length === 1 && m[0].investigationId === 'bone-profile', 'a request line resolves to its investigation');
  check(
    LC.resolveRequest(idx, 'HFE Gene Testing').length === 0,
    'an unrecognised request resolves to nothing (left outstanding)'
  );
  check(
    LC.resolveRequest(idx, 'Thyroid Stimulating Hormone')[0].investigationId === 'tft',
    '"Thyroid Stimulating Hormone" -> thyroid function'
  );
  check(
    LC.resolveRequest(idx, 'Gamma glutamyl transferase')[0].investigationId === 'ggt',
    'GGT requested on its own resolves to the ggt investigation'
  );
  const c = baseCatalogue();
  c.investigations
    .find((i) => i.id === 'lft')
    .requestAliases.push({ text: 'LFT panel ice', system: 'ice' }, { text: 'LFT panel tquest', system: 'tquest' });
  const idx2 = LC.buildIndex(c);
  check(
    LC.resolveRequest(idx2, 'LFT panel ice', { system: 'ice' }).length === 1,
    'an ice-tagged alias resolves for the ice ordering system'
  );
  check(LC.resolveRequest(idx2, 'LFT panel ice', { system: 'tquest' }).length === 0, '…and not for tQuest');
  check(
    LC.resolveRequest(idx2, 'Liver Function', { system: 'tquest' }).length === 1,
    "an 'any'-tagged alias applies to every ordering system"
  );
  const ue = baseCatalogue();
  ue.results.push(res('sodium', 'Sodium', null));
  ue.investigations.push({
    id: 'ue',
    label: 'U&E',
    kind: 'blood',
    requestAliases: [{ text: 'electrolyte', system: 'any' }],
    exclude: ['urine'],
    members: [{ result: 'sodium', role: 'core' }],
  });
  const i3 = LC.buildIndex(ue);
  check(
    LC.resolveRequest(i3, 'Urea and Electrolytes WITH Potassium')[0].investigationId === 'ue',
    'blood U&E resolves'
  );
  check(
    LC.resolveRequest(i3, 'Urine electrolytes').length === 0,
    'the exclude term stops a urine request resolving to blood U&E'
  );
}

// ── 11. adapter ─────────────────────────────────────────────────────────────────
console.log('\n--- fromInvestigationReportPayload ---');
{
  const payload = {
    data: {
      investigationReport: {
        performer: { organisationName: 'RJ700', departmentName: 'General Pathology' },
        patient: { fullName: 'MUST NOT COPY', nhsNumber: '9990000001' },
        investigationGroups: [
          {
            description: 'Bone profile',
            specimen: { type: 'Blood', collectedDate: '2026-09-10' },
            results: [
              {
                description: 'ALP',
                resultType: 'unit-value-result',
                resultValue: '77',
                resultUnit: 'u/L',
                resultCode: { conceptId: '1000621000000104', description: 'Serum alkaline phosphatase' },
                performerComments: 'private',
                referenceRanges: [{ lowerReferenceLimit: '30', upperReferenceLimit: '130' }],
              },
              {
                description: 'TSH',
                resultType: 'text-result',
                resultText: 'already performed recently',
                resultCode: { conceptId: '1022791000000101' },
              },
            ],
          },
        ],
        ungroupedResults: [
          {
            description: 'Magnesium',
            resultType: 'unit-value-result',
            resultValue: '',
            resultCode: { conceptId: '1001091000000103' },
          },
        ],
      },
    },
  };
  const a = LC.fromInvestigationReportPayload(payload);
  check(a.lab.organisation === 'RJ700' && a.lab.department === 'General Pathology', 'performer org/department carried');
  check(
    a.groups.length === 1 && a.groups[0].heading === 'Bone profile' && a.groups[0].specimenType === 'Blood',
    'group heading and specimen TYPE carried'
  );
  check(
    a.groups[0].results[0].code === '1000621000000104' && a.groups[0].results[0].hasNumericValue === true,
    'code carried; numeric value flagged'
  );
  check(
    a.groups[0].results[1].hasNumericValue === false && a.groups[0].results[1].resultType === 'text-result',
    'a text result is not a numeric value'
  );
  check(a.ungrouped[0].hasNumericValue === false, 'an empty resultValue is not a value');
  check(
    a.groups[0].results[0].refLow === 30 && a.groups[0].results[0].refHigh === 130,
    "the lab's own reference range is read as numbers (a constant of the analyte, not this patient's value)"
  );
  check(
    a.groups[0].results[1].refLow === null && a.groups[0].results[1].refHigh === null,
    'a result with no reference range gets null, not a throw'
  );
  const flat = JSON.stringify(a);
  check(
    !/MUST NOT COPY|9990000001|private|"77"|2026-09-10|resultValue|performerComments/.test(flat),
    'the adapter output carries NO patient fields, values, comments or dates'
  );
  check(LC.fromInvestigationReportPayload(null).groups.length === 0, 'null payload -> empty report, no throw');
  check(
    LC.fromInvestigationReportPayload({ investigationReport: payload.data.investigationReport }).groups.length === 1,
    'accepts { investigationReport } as well as { data: { … } }'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
