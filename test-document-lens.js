// Medicus Suite — Document Lens (Phase 1, display-only) tests
// Run with: node test-document-lens.js
//
// Covers the pure core of content-scripts/document-lens/document-lens.js:
//   · lane classification against the live-confirmed preview payload shapes
//     (docs/learnings-medicus-snomed-search-live.md Parts 2–5, incl. every
//     lane that appeared in the 40-task real-inbox tally)
//   · buildCardModel fail-closed: ANY input yields exactly one of the four
//     honesty states — a blank card is impossible (plan §12)
//   · renderCard: one state element per card, XSS escaping, the
//     wrong-patient banner (H-B), zero buttons (display-only guard)
//   · end-to-end with the REAL engines (letter-extract + letter-delta)
//   · source-grep guards: banned completion language, display-only (no
//     fetch-with-method/POST), prepend-not-append

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) {
    passed++;
    console.log(`  OK  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

const DL = require('./content-scripts/document-lens/document-lens.js');
const Extract = require('./engine/letter-extract.js');
const Delta = require('./engine/letter-delta.js');

const STATES = ['not-run', 'could-not-read', 'nothing-anchored', 'assessed'];

// ── config sanitisation ───────────────────────────────────────────────────────
console.log('--- sanitiseConfig ---');
{
  const d = DL.sanitiseConfig(null);
  check(d.enabled === false, 'ships disabled: default enabled=false');
  check(d.sensitiveGate === true, 'sensitive gate defaults ON (H-F)');
  check(DL.sanitiseConfig({ enabled: 'yes' }).enabled === false, 'non-boolean enabled ignored');
  check(DL.sanitiseConfig({ enabled: true, sensitiveGate: false }).enabled === true, 'explicit enable honoured');
  check(DL.sanitiseConfig({ sensitiveGate: false }).sensitiveGate === false, 'explicit gate-off honoured');
  check(DL.sanitiseConfig(42).enabled === false, 'junk config → defaults');
}

// ── lane classification: the whole live tally matrix ─────────────────────────
console.log('--- classifyKetteringLane / classifyFileLane ---');
{
  const k = DL.classifyKetteringLane;
  check(k({ isHTML: true, clinicalReport: '<p>x</p>' }).read === 'html', 'kettering isHTML → html read');
  check(k({ isHTML: true, clinicalReport: '<p>x</p>' }).lane === 'kettering-html', 'kettering html lane label');
  check(k({ isPDF: true }).read === 'pdf', 'kettering isPDF → pdf read');
  check(k({ isTIF: true }).read === 'unreadable', 'kettering isTIF → unreadable (could-not-read)');
  check(k({ isTIF: true }).reason === 'image-only', 'TIF reason is image-only');
  check(k({ hasContent: false }).read === 'unreadable', 'kettering no-content → unreadable');
  check(k({ isHTML: true }).read === 'not-run', 'isHTML but clinicalReport missing → not-run (never guess)');
  check(k(null).read === 'not-run', 'null kettering payload → not-run');
  check(k({}).read === 'not-run', 'flagless kettering payload → not-run (unrecognised)');

  const f = DL.classifyFileLane;
  check(f({ rendersAsPdf: true }).read === 'pdf', 'file rendersAsPdf → pdf read');
  check(f({ rendersAsPdf: true }).lane === 'file-pdf', 'file pdf lane label');
  check(f({ conversionFailed: true, rendersAsPdf: true }).read === 'unreadable', 'conversionFailed beats rendersAsPdf');
  check(f({ conversionInProgress: true }).read === 'not-run', 'conversionInProgress → not-run (retry later)');
  check(f({}).read === 'unreadable', 'file with no pdf rendering → unreadable');
  check(f(undefined).read === 'not-run', 'missing file payload → not-run');
}

// ── htmlToText (Node regex fallback path) ─────────────────────────────────────
console.log('--- htmlToText ---');
{
  const t = DL.htmlToText('<h3>Diagnoses</h3><ul><li>1. CAP</li><li>2. AKI</li></ul><p>Plan follows.</p>');
  const lines = t
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  check(lines[0] === 'Diagnoses', 'block boundaries become line breaks (heading isolated)');
  check(lines.includes('1. CAP') && lines.includes('2. AKI'), 'list items land on their own lines');
  check(DL.htmlToText('<script>evil()</script>ok') === 'ok', 'script content stripped');
  check(DL.htmlToText('A &amp; E').indexOf('A & E') === 0, 'entities decoded');
  check(DL.htmlToText(null) === '', 'null html → empty string');
}

// ── deepFindFlag ──────────────────────────────────────────────────────────────
console.log('--- deepFindFlag ---');
{
  check(DL.deepFindFlag({ a: { b: { isHiddenFromPFS: true } } }, 'isHiddenFromPFS') === true, 'finds nested flag');
  check(DL.deepFindFlag({ isHiddenFromPFS: false }, 'isHiddenFromPFS') === false, 'false is found (not undefined)');
  check(DL.deepFindFlag({ isHiddenFromPFS: 'yes' }, 'isHiddenFromPFS') === undefined, 'non-boolean value ignored');
  check(DL.deepFindFlag(null, 'x') === undefined, 'null object → undefined');
  const deep = { a: { b: { c: { d: { e: { f: { g: { isHiddenFromPFS: true } } } } } } } };
  check(DL.deepFindFlag(deep, 'isHiddenFromPFS') === undefined, 'depth-limited (no unbounded recursion)');
}

// ── buildCardModel: fail-closed, exactly one state, always ────────────────────
console.log('--- buildCardModel (blank card impossible) ---');
{
  const junkInputs = [
    null,
    undefined,
    42,
    'garbage',
    {},
    { assessment: {} },
    { assessment: { state: 'bogus-state' } },
    { assessment: { state: 'not-run' } }, // engine never emits it; must not pass through
    { demographics: 'not-an-object' },
    { delta: 'not-an-array', assessment: { state: 'assessed', candidates: [] } },
    { unreadableReason: '' }, // empty string is not a reason
    { failReason: 17 },
  ];
  let allValid = true;
  for (const input of junkInputs) {
    const m = DL.buildCardModel(input);
    if (!m || !STATES.includes(m.state)) allValid = false;
  }
  check(allValid, 'every junk input yields exactly one of the four states');
  check(DL.buildCardModel(null).state === 'not-run', 'null input fails closed to not-run');
  check(DL.buildCardModel(null).reason === 'internal-error', 'fail-closed reason is internal-error');

  check(DL.buildCardModel({ sensitiveGated: true }).reason === 'sensitive', 'sensitive gate → not-run/sensitive');
  check(
    DL.buildCardModel({ sensitiveGated: true, assessment: { state: 'assessed', candidates: [] } }).state === 'not-run',
    'sensitive gate outranks a completed assessment (content must not leak)'
  );
  check(DL.buildCardModel({ failReason: 'overview-fetch-failed' }).state === 'not-run', 'fetch failure → not-run');
  check(
    DL.buildCardModel({ unreadableReason: 'image-only' }).state === 'could-not-read',
    'unreadable lane → could-not-read'
  );

  const assessed = DL.buildCardModel({
    assessment: {
      state: 'assessed',
      candidates: [],
      coverage: { totalContentLines: 1, assessedLines: 1, unanchoredLines: 0 },
    },
    delta: [],
  });
  check(assessed.state === 'assessed', 'engine assessed state passes through');
  check(assessed.delta !== null, 'delta array attaches');

  const noDelta = DL.buildCardModel({ assessment: { state: 'assessed', candidates: [] } });
  check(noDelta.deltaUnavailable === 'comparison-not-run', 'missing delta is NAMED, never silent');

  check(
    DL.buildCardModel({ assessment: { state: 'nothing-anchored', candidates: [], actions: [] } }).state ===
      'nothing-anchored',
    'nothing-anchored passes through'
  );
  check(
    DL.buildCardModel({ assessment: { state: 'could-not-read', reason: 'garbled-extraction' } }).state ===
      'could-not-read',
    'engine could-not-read passes through'
  );

  const demo = DL.buildCardModel({
    demographics: { patientName: 'X', nhsNumber: '999 000 0000', isMatched: false },
    unreadableReason: 'image-only',
  });
  check(demo.demographics && demo.demographics.isMatched === false, 'demographics survive on non-assessed states');
}

// ── renderCard ────────────────────────────────────────────────────────────────
console.log('--- renderCard ---');
{
  const stateEl = (html) => (html.match(/dl-state-[a-z-]+/g) || []).filter((v, i, a) => a.indexOf(v) === i);

  for (const input of [null, { sensitiveGated: true }, { unreadableReason: 'image-only' }]) {
    const html = DL.renderCard(DL.buildCardModel(input));
    check(html.includes('data-dl-state='), `card carries its state attr (${JSON.stringify(input)})`);
    check(stateEl(html).length === 1, `exactly one state element (${JSON.stringify(input)})`);
  }

  check(DL.renderCard(undefined).includes('dl-state-not-run'), 'junk model → renders the not-run card, never blank');
  check(
    DL.renderCard({ state: 'assessed' /* no assessment */ }).length > 0,
    'assessed without assessment still renders'
  );

  // XSS: everything document-borne is escaped
  const xss = DL.renderCard(
    DL.buildCardModel({
      demographics: { patientName: '<img src=x onerror=alert(1)>', nhsNumber: '<b>1</b>', isMatched: false },
      unreadableReason: 'image-only',
    })
  );
  check(!xss.includes('<img'), 'document-borne patient name is escaped');
  check(xss.includes('&lt;img'), 'escaped form present');

  // Wrong-patient banner (H-B)
  check(xss.includes('CHECK PATIENT'), 'isMatched=false renders the wrong-patient banner');
  const matchedHtml = DL.renderCard(
    DL.buildCardModel({
      demographics: { patientName: 'Test Patient', nhsNumber: '999 000 0000', isMatched: true },
      unreadableReason: 'image-only',
    })
  );
  check(!matchedHtml.includes('CHECK PATIENT'), 'isMatched=true renders no mismatch banner');
  check(matchedHtml.includes('Document names:'), 'matched demographics still shown for the human check');

  // Display-only: the card must contain no interactive controls at all
  const bigAssessment = Extract.assessLetterText(
    [
      'Dear Doctor, thank you for referring this patient who was seen in clinic today.',
      'Diagnosis:',
      '1. Atrial fibrillation',
      '2. No evidence of DVT',
      'Medications on discharge:',
      '- Apixaban 5 mg bd',
      'Plan:',
      'GP to arrange repeat U&E in 2 weeks',
    ].join('\n')
  );
  const fullHtml = DL.renderCard(
    DL.buildCardModel({
      assessment: bigAssessment,
      delta: Delta.computeDelta(
        bigAssessment.candidates.filter((c) => c.offered),
        [{ description: 'Hypertension', status: 'active' }]
      ),
      demographics: { patientName: 'Test Patient', nhsNumber: '999 000 0000', isMatched: true },
    })
  );
  check(!/<button/i.test(fullHtml), 'no buttons anywhere in the card (display-only)');
  check(!/<input/i.test(fullHtml), 'no inputs anywhere in the card');
  check(!/<a\s/i.test(fullHtml), 'no links anywhere in the card');

  // The assessed card carries its honesty furniture
  check(fullHtml.includes('dl-state-assessed'), 'assessed state renders');
  check(fullHtml.includes('Atrial fibrillation'), 'offered candidate rendered');
  check(/possibly new/i.test(fullHtml), 'delta verdict chip rendered');
  check(/Mentioned, not offered/.test(fullHtml), 'mentioned-not-offered group rendered (negated DVT)');
  check(/content lines/.test(fullHtml), 'coverage line rendered');
  check(/Action language found/.test(fullHtml), 'action flags rendered');
  check(/Apixaban/.test(fullHtml), 'med line rendered');
  check(/writes nothing/.test(fullHtml), 'footer disclaimer present');

  // truncated-pages honesty
  const trunc = DL.renderCard(
    DL.buildCardModel({
      assessment: bigAssessment,
      delta: [],
      truncatedPages: { assessed: 60, total: 75 },
    })
  );
  check(/first 60 of 75 pages/.test(trunc), 'PDF page-cap truncation is surfaced, never silent');

  // delta unavailable honesty
  const noDeltaHtml = DL.renderCard(DL.buildCardModel({ assessment: bigAssessment }));
  check(/did not run/.test(noDeltaHtml), 'missing problem-list comparison is stated on the card');
}

// ── end-to-end sanity with a qualifier-conflict record ────────────────────────
console.log('--- end-to-end: CKD stage conflict surfaces ---');
{
  const a = Extract.assessLetterText(
    [
      'Dear Doctor, this patient attended the renal clinic for annual review today.',
      'Diagnoses:',
      '1. CKD stage 3b',
    ].join('\n')
  );
  const offered = a.candidates.filter((c) => c.offered);
  check(offered.length === 1, 'CKD candidate offered');
  const d = Delta.computeDelta(offered, [{ description: 'Chronic kidney disease stage 3a', status: 'active' }]);
  const html = DL.renderCard(DL.buildCardModel({ assessment: a, delta: d }));
  check(/qualifier differs/i.test(html), 'stage conflict renders as qualifier-differs chip');
  check(/3b/.test(html) && /3a/.test(html), 'both stages visible (letter vs record)');
}

// ── source-grep guards ────────────────────────────────────────────────────────
console.log('--- source-grep guards ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts/document-lens/document-lens.js'), 'utf8');
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const banned = /fully coded|all clear|letter reviewed|nothing to code|complete[d]? coding|all done/i;
  check(!banned.test(code), 'no completion/all-clear language in lens code or its string outputs');

  // Display-only: no write verbs anywhere near fetch. Every fetch in this
  // file must be a plain GET (no method/body option objects with POST/PUT).
  check(!/method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i.test(code), 'no write-method fetches (display-only)');
  check(!/\.click\(\)/.test(code), 'no synthetic clicks on host controls');

  // Injection rule: prepend, never append (the v3.67.0 lesson)
  check(/insertBefore\([^)]*firstChild\)/.test(code), 'injection uses insertBefore(…, firstChild)');
  check(!/host\.appendChild|anchor\.appendChild/.test(code), 'no appendChild onto the host');

  // The manifest must actually ship the lens + its engine deps in order
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const group = (manifest.content_scripts || []).find((g) =>
    (g.js || []).includes('content-scripts/document-lens/document-lens.js')
  );
  check(!!group, 'manifest ships the document-lens content script');
  if (group) {
    const idxExtract = group.js.indexOf('engine/letter-extract.js');
    const idxDelta = group.js.indexOf('engine/letter-delta.js');
    const idxLens = group.js.indexOf('content-scripts/document-lens/document-lens.js');
    check(idxExtract >= 0 && idxExtract < idxLens, 'letter-extract loads before the lens');
    check(idxDelta >= 0 && idxDelta < idxLens, 'letter-delta loads before the lens');
    check((group.css || []).includes('content-scripts/document-lens/document-lens.css'), 'lens CSS ships');
  }
  const war = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || []);
  check(
    war.includes('vendor/pdf.min.js') && war.includes('vendor/pdf.worker.min.js'),
    'pdf.js web-accessible for the content-script import'
  );

  // Backup convention (CLAUDE.md): IO file + scope + options wiring
  const envelope = fs.readFileSync(path.join(__dirname, 'shared/io/suite-envelope.js'), 'utf8');
  check(/'documentLens',/.test(envelope), 'documentLens scope registered in VALID_SCOPES');
  const optionsJs = fs.readFileSync(path.join(__dirname, 'options/options.js'), 'utf8');
  check(/documentLensExport\(\)/.test(optionsJs), 'doFullExport includes documentLensExport');
  check(/documentLensImport\(mods\.documentLens\)/.test(optionsJs), 'applyEnvelope includes documentLensImport');
  const optionsHtml = fs.readFileSync(path.join(__dirname, 'options/options.html'), 'utf8');
  check(/document-lens-io\.js/.test(optionsHtml), 'options.html loads document-lens-io.js');
  check(/data-mod-export="documentLens"/.test(optionsHtml), 'per-module export card present');
}

// ── IO helpers (Node-mocked chrome.storage) ───────────────────────────────────
console.log('--- document-lens-io ---');
{
  const store = {};
  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (k in store) out[k] = store[k];
          });
          return out;
        },
        set: async (obj) => Object.assign(store, obj),
      },
    },
  };
  const io = require('./shared/io/document-lens-io.js');
  (async () => {
    let exp = await io.documentLensExport();
    check(exp.config.enabled === false && exp.config.sensitiveGate === true, 'empty store exports safe defaults');
    await io.documentLensImport({ config: { enabled: true, sensitiveGate: false } });
    exp = await io.documentLensExport();
    check(exp.config.enabled === true && exp.config.sensitiveGate === false, 'import round-trips both fields');
    await io.documentLensImport({ config: { enabled: 'junk' } });
    exp = await io.documentLensExport();
    check(exp.config.enabled === false, 'junk enabled imports as disabled (fail closed)');
    check(exp.config.sensitiveGate === true, 'missing sensitiveGate restores to GATED (H-F fail-closed)');
    let threw = false;
    try {
      await io.documentLensImport({ config: 'not-an-object' });
    } catch (e) {
      threw = true;
    }
    check(threw, 'malformed config rejects loudly');
    delete global.chrome;

    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exitCode = 1;
  })();
}
