// Medicus Suite — Lab Result Catalogue: import from the existing OIR tests (oirTests). Phase C1.
// Run with: node test-lab-catalogue-import.js
// Optional: MEDICUS_TRIAGE_EXPORT=<path to a triage backup json> also runs the importer over that real config.

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');
const OV = require('./shared/lab-catalogue-overlay.js');
const IMP = require('./shared/lab-catalogue-import.js');

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
const snapshot = JSON.stringify(builtin);
const LAB = 'rj700-general-pathology';
const T = (key, label, req, rep, analytes, singleAnalyte, extra) => ({
  key,
  label,
  req,
  rep,
  analytes,
  singleAnalyte: !!singleAnalyte,
  disabled: false,
  ...(extra || {}),
});
const run = (tests, opts) => IMP.importOirTests(tests, builtin, { labId: LAB, today: '2026-09-19', ...(opts || {}) });
const inv = (r, id) => r.overlay.investigations.find((i) => i.id === id);
const byType = (r, t) => r.review.filter((x) => x.type === t);

console.log('\n── fragment repair ──');
{
  const f = IMP.repairFragments(['RAST mixed foods (egg', 'milk', 'cod', 'wheat', 'soya', 'peanut)']);
  check(
    f.repaired && f.list.length === 1 && f.list[0] === 'RAST mixed foods (egg, milk, cod, wheat, soya, peanut)',
    'the comma-split RAST request is re-joined'
  );
  const g = IMP.repairFragments(['Ankle LEFT X-ray', 'Ankle RIGHT X-ray']);
  check(!g.repaired && g.list.length === 2, 'ordinary separate wordings are left alone');
  const h = IMP.repairFragments(['unbalanced (tail', 'x']);
  check(h.list.length === 1 && /unbalanced/.test(h.list[0]), 'an unbalanced tail is kept, never dropped');
  check(IMP.repairFragments(undefined).list.length === 0, 'missing list is empty');
}

console.log('\n── new practice tests ──');
{
  const r = run([
    T(
      'ebv',
      'EBV',
      ['Glandular Fever Screen'],
      ['Epstein-Barr virus serology'],
      ['EBV capsid IgG level', 'EBV nuclear IgG level'],
      false
    ),
    // Deliberately fictional (was 'esr' until ESR became a real shipped built-in on 2026-09-26, from the practice's
    // own unreconciled-requests listing — at that point this started exercising the EXTENDS-a-built-in path instead
    // of the fresh-practice-only path it exists to test, silently losing this coverage). No real test name here so
    // this can never be shadowed by a future shipped addition again.
    T('zzz-fictional-test', 'Zzz Fictional Test', ['Zzz Fictional Test Request'], ['Zzz Fictional Test'], ['Zzz Fictional Test'], true),
    T(
      'rast_mix_foods',
      'RAST mix foods',
      ['RAST mixed foods (egg', 'milk)'],
      ['Food mix RAST test'],
      ['Food mix RAST test'],
      true
    ),
  ]);
  const ebv = inv(r, 'practice-ebv');
  check(!!ebv && ebv.kind === 'blood', 'EBV becomes a new practice blood investigation');
  check(
    ebv.members.length === 2 && ebv.members.every((m) => m.role === 'core' && !m.anchor),
    'singleAnalyte:false -> plain core members (two distinct results needed)'
  );
  const fictional = inv(r, 'practice-zzz-fictional-test');
  check(
    fictional.members.length === 1 && fictional.members[0].role === 'core' && fictional.members[0].anchor === true,
    'singleAnalyte:true -> core + anchor'
  );
  check(
    inv(r, 'practice-rast-mix-foods').requestAliases[0].text === 'RAST mixed foods (egg, milk)',
    'repaired request stored as one wording'
  );
  check(
    r.overlay.investigations
      .concat(r.overlay.results)
      .every((e) => e.provenance.reviewed === false && e.provenance.source === 'imported'),
    'every imported entry is unreviewed / source imported (inert)'
  );
  const newRes = r.overlay.results.find((x) => x.label === 'Zzz Fictional Test');
  check(
    newRes && newRes.aliases[0].lab === LAB && newRes.codes.length === 0,
    'new result is alias-only, tagged with the chosen lab'
  );
  check(newRes.valueKind === 'mixed', 'unknown value kind is "mixed", not guessed numeric');
  check(byType(r, 'repaired').length === 1, 'the repair is listed for review');
  const m = OV.mergeCatalogue(builtin, r.overlay, { includeUnreviewed: true });
  check(
    m.problems.length === 0 && LC.validateCatalogue(m.catalogue).errors.length === 0,
    'baseline + import is a valid catalogue'
  );
  const m2 = OV.mergeCatalogue(builtin, r.overlay, {});
  check(
    !m2.catalogue.investigations.some((i) => i.id === 'practice-ebv'),
    'unreviewed imports are NOT in the acting catalogue'
  );
}

console.log('\n── extending a built-in ──');
{
  const r = run([
    // "C-Reactive Protein Blood" became a known CRP synonym on 2026-09-26 (from the practice's own unreconciled-
    // requests listing) — using it here would now genuinely add nothing, so the extension entry gets dropped
    // instead of kept for review (correct behaviour, but not what THIS test is checking). A wording still unknown
    // to CRP keeps this test exercising "extends and gains something new".
    T('crp', 'CRP', ['C Reactive Protein Test'], ['CRP'], ['CRP'], true),
    T('bone', 'Bone', ['Bone profile blood'], ['Bone profile'], ['Calcium', 'Phosphate', 'Osteocalcin'], false),
  ]);
  const crp = inv(r, 'crp');
  check(
    !!crp && crp.label === builtin.investigations.find((i) => i.id === 'crp').label,
    'legacyKey match extends the built-in under its own id and label'
  );
  check(crp.kind === 'blood' && crp.legacyKey === 'crp', 'kind/legacyKey carried from the built-in');
  const bone = inv(r, 'bone-profile');
  const optional = bone && bone.members.filter((m) => m.role === 'optional');
  check(optional && optional.length === 1, 'unknown analyte on a MULTI-result built-in becomes ONE optional member');
  check(!bone.members.some((m) => m.role === 'core'), 'no new core member is ever added to a built-in');
  check(
    byType(r, 'review').some((x) => /OPTIONAL/.test(x.message)),
    'the optional additions are flagged for review'
  );
  const m = OV.mergeCatalogue(builtin, r.overlay, { includeUnreviewed: true });
  check(m.problems.length === 0, 'extension merges without problems');
  const before = builtin.investigations.find((i) => i.id === 'bone-profile').members.length;
  const after = m.catalogue.investigations.find((i) => i.id === 'bone-profile').members.length;
  check(after === before + 1, 'coverage only grows (one more member)');
}

console.log('\n── single-result built-in: unknown name becomes an ALIAS, not a second core result ──');
{
  const r = run([T('crp', 'CRP', ['C-Reactive Protein Blood'], ['CRP'], ['C reactive protein (lab wording)'], true)]);
  const m = OV.mergeCatalogue(builtin, r.overlay, { includeUnreviewed: true });
  const core = m.catalogue.investigations.find((i) => i.id === 'crp').members.filter((x) => x.role === 'core');
  check(core.length === 1, 'CRP still has exactly one core result (threshold stays 1)');
  const sole = m.catalogue.results.find((x) => x.id === core[0].result);
  check(
    sole.aliases.some((a) => a.text === 'C reactive protein (lab wording)' && a.lab === LAB),
    'the lab wording was added as a lab-tagged alias of that result'
  );
}

console.log('\n── exact-wording extension (specimen words ignored) — and nothing looser ──');
{
  const r = run([
    T('mg', 'Magnesium', ['Magnesium blood'], ['Serum magnesium level'], ['Serum magnesium level'], true),
    T(
      'hepbab',
      'hep B antibody',
      ['Hepatitis B antibody'],
      ['Hep B surface antibody level'],
      ['Hep B surface antibody level'],
      true
    ),
  ]);
  check(
    !!inv(r, 'magnesium') || r.review.some((x) => x.type === 'unchanged' || x.type === 'extends'),
    '"Magnesium blood" is recognised as the built-in Magnesium'
  );
  check(!inv(r, 'hepatitis-b'), '"Hepatitis B antibody" is NOT folded into the surface-antigen test');
  check(!!inv(r, 'practice-hep-b-antibody'), '…it stays its own practice investigation');
}

console.log('\n── merging duplicates ──');
{
  const r = run([
    // "Iron Binding Studies" became a shipped built-in's own request wording on 2026-09-26 (from the practice's
    // own unreconciled-requests listing) — using it here would pull this fixture into extending THAT built-in
    // instead of exercising the merge-two-legacy-keys-into-one-practice-investigation path this test is about.
    // A wording the shipped entry does not use keeps that path exercised.
    T('iron', 'Iron', ['Iron Studies Panel'], [], ['Iron Studies', 'TIBC'], false),
    T(
      'iron_binding',
      'Iron binding',
      ['Iron studies panel'],
      ['Iron studies panel'],
      ['TIBC', 'Transferrin saturation'],
      false
    ),
    T(
      'a-1',
      'Cervical screening',
      ['Cervical screening'],
      ['Cervical cytology test'],
      ['Cervical cytology test'],
      true
    ),
    T(
      'a-2',
      'Cervical screening',
      ['Cervical screening'],
      ['Cervical cytology test'],
      ['Cervical cytology test'],
      true
    ),
    T('swab1', 'Throat swab', ['Throat Swab MC&S'], ['Throat swab'], ['Culture'], false),
    T('swab2', 'Nose swab', ['Nose Swab MC&S'], ['NOSE SWAB'], ['Culture'], true),
  ]);
  const iron = r.overlay.investigations.filter((i) => /iron/.test(i.id));
  check(iron.length === 1, 'iron + iron binding (same request wording) merge into one investigation');
  check(iron[0].members.length === 3, 'members are the union (Iron Studies, TIBC, Transferrin saturation)');
  check(
    r.overlay.investigations.filter((i) => /cervical/.test(i.id)).length === 1,
    'duplicate cervical screening entries merge'
  );
  check(byType(r, 'merged').length === 2, 'each merge is listed for review');
  check(
    r.overlay.investigations.some((i) => i.id === 'practice-throat-swab') &&
      r.overlay.investigations.some((i) => i.id === 'practice-nose-swab'),
    'swabs sharing only the one-word result "Culture" are NOT merged'
  );
  const culture = r.overlay.results.filter((x) => x.label === 'Culture');
  check(culture.length === 1, 'the shared result "Culture" is ONE result used by both swab investigations');
  check(
    byType(r, 'review').some((x) => /Microbiology/.test(x.message)),
    'microbiology entries are flagged in a single note'
  );
}

console.log('\n── never join two different built-ins ──');
{
  const r = run([
    T('tft', 'TSH', ['Thyroid Stimulating Hormone'], ['TSH'], ['TSH'], false),
    T('crp', 'CRP', ['Thyroid Stimulating Hormone'], ['CRP'], ['CRP'], true),
  ]);
  check(!!inv(r, 'tft') && !!inv(r, 'crp'), 'both built-ins are extended separately');
  check(byType(r, 'not-merged').length === 1, 'the near-miss is reported');
}

console.log('\n── skips / disabled / empties ──');
{
  const r = run([
    { key: 'hiv', disabled: true, label: 'HIV' },
    { key: 'made-up-disabled', disabled: true, label: 'x' },
    T('empty', 'Empty', [], [], [], false),
    T('imaging-only', 'US liver', ['US Liver'], ['US Liver'], [], true),
    null,
  ]);
  check(r.overlay.disabled.investigations.includes('hiv'), 'a disabled built-in is imported as disabled');
  check(byType(r, 'skipped').length === 3, 'disabled-unknown, empty and malformed entries are skipped with a note');
  const us = inv(r, 'practice-us-liver');
  check(
    us && us.kind === 'imaging' && us.members.length === 0,
    'imaging entry with no result names is kept as request/heading only'
  );
}

console.log('\n── merging into an existing overlay (local wins, idempotent) ──');
{
  const first = run([T('zzz-fictional-test', 'Zzz Fictional Test', ['Zzz Fictional Test Request'], ['Zzz Fictional Test'], ['Zzz Fictional Test'], true)]);
  const local = OV.markReviewed(first.overlay, 'investigations', 'practice-zzz-fictional-test', 'Nick', '2026-09-19');
  const again = IMP.mergeIntoOverlay(local, first.overlay);
  check(again.added === 0 && again.skipped >= 1, 're-running the import adds nothing');
  const kept = again.overlay.investigations.find((i) => i.id === 'practice-zzz-fictional-test');
  check(kept.provenance.reviewed === true, 'a locally approved entry is not reset by a re-import');
  const second = run([T('lead', 'Lead', ['Lead blood'], ['Lead'], ['Lead'], true)]);
  const both = IMP.mergeIntoOverlay(local, second.overlay);
  check(
    both.added >= 2 && both.overlay.investigations.length === 2,
    'new entries are appended alongside existing ones'
  );
}

console.log('\n── mergeIntoOverlay forces the imported side inert (no smuggled approvals) ──');
{
  const first = run([T('zzz-fictional-test', 'Zzz Fictional Test', ['Zzz Fictional Test Request'], ['Zzz Fictional Test'], ['Zzz Fictional Test'], true)]);
  const crafted = JSON.parse(JSON.stringify(first.overlay));
  for (const e of crafted.investigations.concat(crafted.results)) {
    e.provenance = { ...e.provenance, reviewed: true, reviewedBy: 'Attacker', reviewedAt: '2026-09-20' };
  }
  const m = IMP.mergeIntoOverlay(OV.emptyOverlay(), crafted);
  check(
    m.overlay.investigations.every((i) => i.provenance.reviewed === false) &&
      m.overlay.results.every((r) => r.provenance.reviewed === false),
    'a pre-approved imported entry arrives unreviewed'
  );
  check(
    m.overlay.investigations.every((i) => !('reviewedBy' in i.provenance)),
    'and the foreign reviewer name is dropped'
  );
}

console.log('\n── extension that only adds a lab wording still carries an approvable entry ──');
{
  const bi = builtin.investigations.find((i) => i.id === 'crp');
  const r = run([T('crp', 'CRP', [bi.synonyms[0]], [], ['C reactive prot (lab wording only)'], true)]);
  const e = inv(r, 'crp');
  check(
    !!e && e.requestAliases.length === 0 && e.members.length === 0,
    'an entry is kept even though the investigation itself gains nothing'
  );
  const ap = OV.approveInvestigation(builtin, r.overlay, 'crp', 'test');
  check(
    OV.mergeCatalogue(builtin, ap.overlay, {}).catalogue.results.some((x) =>
      x.aliases.some((a) => a.text === 'C reactive prot (lab wording only)')
    ),
    'approving it makes the lab wording live (no orphaned unreviewable alias)'
  );
}

console.log('\n── determinism, no mutation ──');
{
  const tests = [T('zzz-fictional-test', 'Zzz Fictional Test', ['Zzz Fictional Test Request'], ['Zzz Fictional Test'], ['Zzz Fictional Test'], true)];
  const copy = JSON.stringify(tests);
  const a = JSON.stringify(run(tests));
  const b = JSON.stringify(run(tests));
  check(a === b, 'same input, same output');
  check(JSON.stringify(tests) === copy, 'input is not mutated');
  check(JSON.stringify(builtin) === snapshot, 'built-in catalogue is not mutated');
}

if (process.env.MEDICUS_TRIAGE_EXPORT) {
  console.log('\n── real export (opt-in) ──');
  const e = JSON.parse(fs.readFileSync(process.env.MEDICUS_TRIAGE_EXPORT, 'utf8'));
  const cfg = e.modules && e.modules.triage && e.modules.triage.config;
  const r = run((cfg && cfg.oirTests) || []);
  const m = OV.mergeCatalogue(builtin, r.overlay, { includeUnreviewed: true });
  check(
    m.problems.length === 0,
    `real import merges cleanly (${r.counts.entries} entries -> ${r.counts.investigations} investigations)`
  );
  check(LC.validateCatalogue(m.catalogue).errors.length === 0, 'real import yields a valid catalogue');
  check(
    r.overlay.investigations.every((i) => i.provenance.reviewed === false),
    'all unreviewed'
  );
}

console.log('\n── deleted imported tests are not brought back by reading again ──');
{
  const tests = [
    T('nose-swab', 'Nose swab', ['nose swab mc&s'], ['nose swab'], ['culture'], true),
    T('sputum', 'Sputum', ['sputum mc&s'], ['sputum'], ['culture'], true),
    T('mouth', 'Swab - mouth', ['mouth swab'], ['mouth swab'], ['culture'], true),
  ];
  const first = run(tests);
  let ov = IMP.mergeIntoOverlay(OV.emptyOverlay(), first.overlay).overlay;
  const ids = ov.investigations.map((i) => i.id);
  check(ids.length === 3, 'the three tests are imported the first time');
  const shared = ov.results.filter((r) => /culture/i.test(r.label));
  check(shared.length === 1, 'they share one "Culture" result (as your own catalogue does)');
  // delete two of them
  ov = OV.removeInvestigation(builtin, ov, ids[0]).overlay;
  ov = OV.removeInvestigation(builtin, ov, ids[1]).overlay;
  check(
    ov.context.dismissed.length === 2 && ov.context.dismissed.includes(ids[0]),
    'deleting an imported test remembers it'
  );
  const again = IMP.mergeIntoOverlay(ov, run(tests).overlay);
  check(
    again.overlay.investigations.length === 1 && again.dismissedSkipped === 2,
    'reading the tests again does not recreate the two deleted ones'
  );
  check(
    again.overlay.results.filter((r) => /culture/i.test(r.label)).length === 1,
    'and does not duplicate the shared result'
  );
  // delete the last one too: its now-unused imported result is not brought back either
  let ov2 = OV.removeInvestigation(builtin, again.overlay, ids[2]).overlay;
  ov2 = IMP.mergeIntoOverlay(ov2, run(tests).overlay).overlay;
  check(ov2.investigations.length === 0 && ov2.results.length === 0, 'with every test deleted, nothing is re-added');
  // and the person can bring them back
  const back = IMP.mergeIntoOverlay(OV.restoreDismissed(ov2), run(tests).overlay);
  check(back.overlay.investigations.length === 3, 'restoring the deleted tests brings them back on the next read');
  // a test the person wrote themselves is not remembered
  const own = OV.saveInvestigation(
    builtin,
    OV.emptyOverlay(),
    {
      label: 'X scan',
      kind: 'imaging',
      requestAliases: [{ text: 'x scan', system: 'any' }],
      headingAliases: [],
      exclude: [],
      members: [],
    },
    '2026-09-22'
  ).overlay;
  const removed = OV.removeInvestigation(builtin, own, own.investigations[0].id).overlay;
  check(removed.context.dismissed.length === 0, 'only imported tests are remembered as deleted');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
