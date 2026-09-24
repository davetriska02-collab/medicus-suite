// Medicus Suite — OIR matcher on the Lab Result Catalogue (Phase D0): engine + parity/differential tests.
// Run with: node test-outstanding-match-catalogue.js
//
// The catalogue engine must clear requests by exactly the same rules as the legacy engine (H-036); only recognition
// differs. So besides unit cases this asserts, over every real-structure fixture x its request wordings:
//   - it never AUTO-TICKS something the legacy engine leaves alone, except a reviewed allow-list of intended
//     improvements (requests the legacy free-text rules could not recognise);
//   - nothing autoticks unless the request predates the sample, or when tentative;
//   - it fails closed (ok:false -> caller uses the legacy engine) on any bad catalogue/report.

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');
const E = require('./engine/outstanding-match-catalogue.js');
const OM = require('./engine/outstanding-match.js');
const N = require('./engine/normalisers.js');

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
const index = E.buildActingIndex(seed);
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'lab-catalogue');
const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: f, fx: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')) }));
const SAMPLE = '2026-09-10';
const REQ_DATE = '2026-09-09';
const reqs = (names, date) =>
  names.map((n, i) => ({ id: i, name: n, requestedDate: date === undefined ? REQ_DATE : date }));
const toReport = (fx) => LC.fromInvestigationReportPayload({ investigationReport: fx });
const run = (fx, names, opts, date) =>
  E.matchOutstandingCatalogue(reqs(names, date), toReport(fx), { index, sampleDate: SAMPLE, ...(opts || {}) });
const fixture = (n) => JSON.parse(JSON.stringify(fixtures.find((f) => f.file.startsWith(`report-${n}`)).fx));

console.log('--- the shipped seed builds an acting index ---');
check(!!index && index.investigations.size >= 26, 'buildActingIndex accepts the shipped seed');

console.log('\n--- parity / differential over every fixture ---');
// Requests the legacy free-text rules do NOT recognise (or cover) and the catalogue does — intended improvements.
// Each entry is `<fixture number>:<request>`; a new entry needs a reason and CSO review of this list.
const ALLOW_AUTOTICK_ONLY_IN_CATALOGUE = new Map([
  ['135:Magnesium Blood', 'magnesium was not in TEST_DEFS'],
  ['136:Vitamin D (25-hydroxy)', 'legacy vitamin_d def did not cover 25-OH wording'],
  ['138:Urine Albumin:Creatinine Ratio', 'urine ACR was not in TEST_DEFS'],
  ['139:Faecal Immunochemical Test (Faeces)', 'FIT wording not matched by legacy fit def'],
]);
// Requests the legacy engine recognised and cleared that the catalogue does not (yet): safe direction, listed so a
// new one is noticed. (The catalogue has no B12/folate test in the seed; a practice can add it.)
const KNOWN_CATALOGUE_GAPS = new Set();
let diffAutoTickOnlyCatalogue = 0;
for (const { file, fx } of fixtures) {
  const num = file.match(/report-(\d+)/)[1];
  const names = [...new Set(fx.requests)];
  const cat = run(fx, names);
  let leg;
  try {
    leg = OM.matchOutstanding(reqs(names), N.normaliseInvestigationReport({ data: { investigationReport: fx } }), {
      sampleDate: SAMPLE,
    });
  } catch (e) {
    leg = null;
  }
  check(
    cat.ok === true && cat.verdicts.length === names.length,
    `${file}: catalogue engine returns a verdict per request`
  );
  cat.verdicts.forEach((v, i) => {
    const tag = `${num}:${names[i]}`;
    const l = leg && leg[i];
    if (v.autoTick && !(l && l.autoTick)) {
      const allowed = ALLOW_AUTOTICK_ONLY_IN_CATALOGUE.has(tag);
      if (allowed) diffAutoTickOnlyCatalogue++;
      check(
        allowed,
        `${tag}: catalogue auto-ticks where legacy does not — ${allowed ? ALLOW_AUTOTICK_ONLY_IN_CATALOGUE.get(tag) : 'NOT ALLOW-LISTED'}`
      );
    }
    if (l && l.autoTick && !v.autoTick) {
      KNOWN_CATALOGUE_GAPS.add(tag);
    }
    check(v.status !== 'resulted' || predates(v), `${tag}: only ever resulted when the request predates the sample`);
    check(!(v.autoTick && v.confidence !== 'confident'), `${tag}: never auto-ticks unless confident`);
    check(v.engine === 'catalogue', `${tag}: verdict is labelled engine:catalogue`);
  });
}
function predates(v) {
  return E.predatesOrSame(v.requestedDate, SAMPLE);
}
check(
  diffAutoTickOnlyCatalogue === ALLOW_AUTOTICK_ONLY_IN_CATALOGUE.size,
  'every allow-listed improvement is exercised (list has no stale entries)'
);
{
  const gaps = [...KNOWN_CATALOGUE_GAPS].sort();
  check(
    gaps.every((g) => /^140:(Folate Blood|Vitamin B12)$/.test(g)),
    `the only requests the legacy engine cleared that the catalogue does not: ${gaps.join(', ') || 'none'} (B12/folate is not in the seed)`
  );
}

console.log('\n--- verdict shape and keys (downstream depends on these) ---');
{
  const r = run(fixture('140'), ['Full Blood Count']);
  const v = r.verdicts[0];
  check(
    ['id', 'name', 'requestedDate', 'key', 'status', 'confidence', 'autoTick', 'reason'].every((k) => k in v),
    'carries every legacy verdict field'
  );
  check(v.key === 'fbc' && v.investigationId, 'key is the legacyKey (audit-log and oir-key-rotation keys stay stable)');
  check(
    v.status === 'resulted' && v.confidence === 'confident' && v.autoTick === true,
    'FBC group clears the FBC request, confident'
  );
  check(/predates the sample/.test(v.reason), 'reason names the route and the gate');
  const un = run(fixture('135'), ['HFE Gene Testing']).verdicts[0];
  check(
    un.status === 'outstanding' && un.key === null && /not in the catalogue/.test(un.reason),
    'an unrecognised request stays outstanding, key null'
  );
}

console.log('\n--- the H-036 clearing gate is unchanged ---');
{
  const post = run(fixture('140'), ['Full Blood Count'], null, '2026-09-11').verdicts[0];
  check(
    post.status === 'outstanding' && !post.autoTick && /post-dates/.test(post.reason),
    'a request dated after the sample stays outstanding'
  );
  const undated = run(fixture('140'), ['Full Blood Count'], null, null).verdicts[0];
  check(
    undated.status === 'outstanding' && !undated.autoTick && /unknown/.test(undated.reason),
    'an undated request is never cleared'
  );
  const same = run(fixture('140'), ['Full Blood Count'], null, SAMPLE).verdicts[0];
  check(same.status === 'resulted', 'a request on the sample day clears (predatesOrSame)');
  const noSample = E.matchOutstandingCatalogue(reqs(['Full Blood Count']), toReport(fixture('140')), { index });
  check(
    noSample.ok && noSample.verdicts[0].status === 'outstanding' && !noSample.verdicts[0].autoTick,
    'with no sample date nothing clears'
  );
}

console.log('\n--- signature-only evidence and the strict floor ---');
{
  const fx = fixture('140');
  fx.investigationGroups.forEach((g) => (g.description = 'Zzz Unmapped Panel'));
  const dflt = run(fx, ['Full Blood Count']).verdicts[0];
  check(
    dflt.status === 'resulted' && dflt.via === 'signature' && dflt.confidence === 'confident' && dflt.autoTick,
    'default floor: enough core results under an unknown heading is confident by signature'
  );
  const strict = run(fx, ['Full Blood Count'], { confidenceFloor: 'strict' }).verdicts[0];
  check(
    strict.status === 'resulted' && strict.confidence === 'tentative' && strict.autoTick === false,
    'strict floor demotes signature-only to tentative — no auto-tick'
  );
  const heading = run(fixture('140'), ['Full Blood Count'], { confidenceFloor: 'strict' }).verdicts[0];
  check(
    heading.confidence === 'confident' && heading.via === 'heading' && heading.autoTick,
    'strict floor keeps a lab-heading match confident'
  );
}

console.log('\n--- sample-problem lab messages clear (and auto-tick) but are flagged ---');
{
  const fx = fixture('135');
  let touched = 0;
  for (const g of fx.investigationGroups)
    for (const r of g.results)
      if (/thyroid stimulating|tsh/i.test(r.description)) {
        r.resultType = 'text-result';
        r.resultText = 'Sample dropped in laboratory - please repeat';
        delete r.resultValue;
        touched++;
      }
  check(touched >= 1, 'fixture has a TSH result to turn into a lab message');
  const v = run(fx, ['Thyroid Stimulating Hormone']).verdicts[0];
  check(
    v.status === 'resulted' && v.autoTick === true,
    'a sample-problem message still completes the OLD request (a repeat needs a new request anyway)'
  );
  check(v.labMessageOnly === true && v.labMessageKind === 'sample-problem', 'flagged labMessageKind:sample-problem');
  check(/may need repeating/.test(v.reason), 'the reason says it may need repeating');
}

console.log('\n--- ambiguity fails closed ---');
{
  const cat = JSON.parse(JSON.stringify(seed));
  const lft = cat.investigations.find((i) => i.id === 'lft');
  const bone = cat.investigations.find((i) => i.id === 'bone-profile');
  const alias = 'liver function';
  bone.requestAliases = (bone.requestAliases || []).concat([{ text: alias, system: 'any' }]);
  const ix = E.buildActingIndex(cat);
  check(!!ix && !!lft, 'a catalogue where two tests share a request wording still builds');
  const r = E.matchOutstandingCatalogue(reqs(['Liver Function']), toReport(fixture('135')), {
    index: ix,
    sampleDate: SAMPLE,
  });
  const v = r.verdicts[0];
  check(
    v.status === 'outstanding' && !v.autoTick && v.key === null && /more than one/.test(v.reason),
    'two tests tying on a request wording -> unrecognised, never a pick'
  );
}

console.log('\n--- fail-safes: never throw, never guess, tell the caller to fall back ---');
{
  const rep = toReport(fixture('140'));
  check(E.matchOutstandingCatalogue(reqs(['FBC']), rep, {}).ok === false, 'no index -> ok:false');
  check(E.matchOutstandingCatalogue(reqs(['FBC']), rep, { index: null }).ok === false, 'null index -> ok:false');
  check(
    E.matchOutstandingCatalogue(reqs(['FBC']), null, { index, sampleDate: SAMPLE }).ok === false,
    'no report -> ok:false'
  );
  check(
    E.buildActingIndex(null) === null && E.buildActingIndex({}) === null && E.buildActingIndex('x') === null,
    'garbage catalogue -> null index'
  );
  check(
    E.buildActingIndex({ ...seed, investigations: [] }) === null,
    'a catalogue with no investigations -> null index (fall back)'
  );
  const bad = JSON.parse(JSON.stringify(seed));
  bad.investigations[0].members = [{ result: 'does-not-exist', role: 'core' }];
  check(E.buildActingIndex(bad) === null, 'a catalogue that fails validation -> null index (fall back)');
  const throwing = {
    investigations: new Map([['x', {}]]),
    results: null,
    labs: null,
    requestTable: null,
    membership: null,
    headingTable: null,
  };
  const t = E.matchOutstandingCatalogue(reqs(['FBC']), rep, { index: throwing, sampleDate: SAMPLE });
  check(
    t.ok === false && typeof t.error === 'string',
    'an index that makes the resolver throw -> ok:false, not an exception'
  );
  const emptyList = run(fixture('140'), []);
  check(emptyList.ok && emptyList.verdicts.length === 0, 'no requests -> empty verdict list');
  check(
    E.matchOutstandingCatalogue(['Full Blood Count'], rep, { index, sampleDate: SAMPLE }).verdicts[0].status ===
      'outstanding',
    'a bare string request is undated and so never cleared'
  );
}

console.log('\n--- downstream compatibility ---');
{
  const fx = fixture('141');
  const verdicts = run(fx, ['Faecal Calprotectin', 'CA 12-5']).verdicts;
  const enriched = OM.enrichWithHistory(verdicts, [], {});
  check(Array.isArray(enriched) && enriched.length === 2, 'enrichWithHistory accepts catalogue verdicts unchanged');
  const withHistory = OM.enrichWithHistory(
    verdicts,
    [{ name: 'Alkaline phosphatase', group: 'Bone', date: '2026-09-01' }],
    {
      testDefs: OM.TEST_DEFS,
    }
  );
  check(
    withHistory.every((v) => v.engine === 'catalogue'),
    'enrichWithHistory preserves the engine label'
  );
}

console.log('\n--- a generic heading shared by several result-less tests is never confident when >1 is requested ---');
{
  const OV = require('./shared/lab-catalogue-overlay.js');
  const SC = require('./shared/lab-catalogue-scan.js');
  const usRes = {
    name: 'Ultrasonography',
    code: '16310003',
    codeText: 'Ultrasonography',
    unit: null,
    resultType: 'text-result',
    hasNumericValue: false,
    numeric: false,
  };
  const obs = (requests) => ({
    lab: { organisation: 'RJ700', department: 'Xray' },
    groups: [{ heading: 'Ultrasonography', specimenType: null, results: [usRes] }],
    ungrouped: [],
    requests,
  });
  let ov = OV.applyFills(seed, OV.emptyOverlay(), SC.fillsForRequests(['US Abdomen', 'US Neck'])).overlay;
  const ids = ov.investigations.map((i) => i.id);
  let eff = OV.mergeCatalogue(seed, ov, { includeUnreviewed: true }).catalogue;
  const an = SC.analyse(eff, [obs(['US Abdomen']), obs(['US Neck'])], { targets: ids });
  const p = an.proposals[0];
  ov = OV.applyFills(
    seed,
    ov,
    SC.fillsFromProposals(eff, [SC.orphanToProposal(p, { type: 'tests', ids: p.candidates })]).fills
  ).overlay;
  eff = OV.mergeCatalogue(seed, ov, { includeUnreviewed: true }).catalogue;
  const ix = E.buildActingIndex(eff);
  const report = LC.fromInvestigationReportPayload({
    investigationReport: {
      performer: { organisationName: 'RJ700', departmentName: 'Xray' },
      investigationGroups: [
        {
          description: 'Ultrasonography',
          results: [
            { description: 'Ultrasonography', resultType: 'text-result', resultCode: { conceptId: '16310003' } },
          ],
        },
      ],
    },
  });
  const go = (names) => E.matchOutstandingCatalogue(reqs(names), report, { index: ix, sampleDate: SAMPLE }).verdicts;
  const one = go(['US Abdomen'])[0];
  check(
    one.status === 'resulted' && one.confidence === 'confident' && one.autoTick,
    'one ultrasound request on the card: the report clears it, confident (as today)'
  );
  const two = go(['US Abdomen', 'US Neck']);
  check(
    two.every(
      (v) => v.status === 'resulted' && v.confidence === 'tentative' && v.autoTick === false && v.sharedHeading === true
    ),
    'two ultrasound requests on the card: each is flagged "possibly resulted — confirm", never auto-ticked'
  );
  check(/does not say which/.test(two[0].reason), 'and the reason says why');
  const mixed = go(['US Abdomen', 'Full Blood Count']);
  check(
    mixed[0].confidence === 'confident' && mixed[0].autoTick,
    'an unrelated request on the card does not make it ambiguous'
  );
}

console.log('\n--- wiring: manifest, defaults, options, content script ---');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const group = manifest.content_scripts.find((g) => g.js.includes('engine/outstanding-match.js'));
  const pos = (f) => group.js.indexOf(f);
  check(
    [
      'shared/lab-catalogue-core.js',
      'shared/lab-catalogue-overlay.js',
      'shared/io/labcatalogue-io.js',
      'engine/outstanding-match-catalogue.js',
    ].every((f) => pos(f) > 0) &&
      pos('shared/lab-catalogue-core.js') < pos('shared/lab-catalogue-overlay.js') &&
      pos('shared/lab-catalogue-overlay.js') < pos('shared/io/labcatalogue-io.js') &&
      pos('engine/outstanding-match-catalogue.js') > pos('shared/lab-catalogue-core.js'),
    'the content-script group loads core, overlay, io and the engine, in dependency order'
  );
  check(
    manifest.content_scripts.some((g) => g.js.includes('shared/lab-filing-utils.js')),
    'the lab filing helpers are loaded in the same pages (the overlay validates whitelisted lab comments with them)'
  );
  const tl = manifest.content_scripts.find((g) => g.js.includes('content-scripts/triage-lens/content.js'));
  const groupIdx = manifest.content_scripts.indexOf(group);
  check(
    groupIdx < manifest.content_scripts.indexOf(tl) || group === tl,
    'the catalogue modules load before the Triage Lens content script'
  );
  const war = manifest.web_accessible_resources.flatMap((w) => w.resources);
  check(war.includes('rules/lab-catalogue.json'), 'the built-in catalogue is web-accessible (content-script fetch)');
  const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8'));
  check(defaults.prefs.oirEngine === 'legacy', 'shipped default is the legacy engine');
  const html = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'options.html'), 'utf8');
  check(
    /data-pref="oirEngine"/.test(html) && /value="catalogue"/.test(html),
    'the options page has the engine selector'
  );
  const cs = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
  check(
    /PREF\('oirEngine', 'legacy'\) === 'catalogue'/.test(cs),
    'content script only uses the catalogue engine when the pref says so (default legacy)'
  );
  check(
    /matchWithCatalogue\(requests, report, opts\) \|\| OutstandingMatch\.matchOutstanding\(requests, report, opts\)/.test(
      cs
    ),
    'a null catalogue result falls back to the legacy engine for that card'
  );
  check(
    /if \(oirCatalogueWanted\(\) && !_oirCatalogueSettled\)/.test(cs),
    'the acting catalogue is loaded before the first (auto-tick-capable) pass'
  );
  check(
    /changes\['labcatalogue\.practice'\]\) resetOirCatalogue\(\)/.test(cs),
    'the cached index is dropped when the catalogue changes'
  );
  check(
    /engine: verdicts\.some\(\(v\) => v\.engine === 'catalogue'\)/.test(cs),
    'audit entries record which engine produced them'
  );
  check(
    /labcatalogueLoadEffective\(\)/.test(cs) &&
      !/includeUnreviewed/.test(cs.split('ensureOirCatalogue')[1].slice(0, 1500)),
    'only the ACTING (approved-only) catalogue is loaded'
  );
  check(
    /shouldPerformAutoTick\(PREF\('oirAutoTick', false\)/.test(cs) &&
      /prefValue === true/.test(fs.readFileSync(path.join(__dirname, 'shared', 'oir-write-core.js'), 'utf8')),
    'auto-tick is still its own default-OFF opt-in, decided by the shared write core (needs an explicit true)'
  );
  const wc = require('./shared/oir-write-core.js');
  const sampleProblem = [{ id: 0, autoTick: true, labMessageKind: 'sample-problem' }];
  check(
    wc.shouldPerformAutoTick(true, sampleProblem, { 0: { box: {} } }).run === true &&
      wc.shouldPerformAutoTick(false, sampleProblem, { 0: { box: {} } }).run === false,
    'the write core accepts catalogue verdicts unchanged, and still refuses when the pref is off'
  );
  check(/sample problem/i.test(cs), 'the auto-tick toast warns about a sample problem');
}

console.log('\n--- source guards ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'outstanding-match-catalogue.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  check(
    !/\bchrome\./.test(code) && !/\bdocument\b/.test(code) && !/\bfetch\(/.test(code),
    'engine is pure: no chrome.*, DOM or fetch'
  );
  check(!/localStorage|storage/.test(code), 'engine touches no storage');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
