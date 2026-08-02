// Medicus Suite — extraction-health (silent-failure detection) tests
// Run with: node test-extraction-health.js
//
// vm-extracts the pure assessExtractionHealth(data) helper from
// content-scripts/sentinel.js and asserts it distinguishes a genuine "no matched
// rules" result from a likely Medicus DOM/API extraction failure that must NOT
// read as an "all clear" (H-005). Same Layer-2 pattern as test-monitoring-chip.js.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');
const m = src.match(/function assessExtractionHealth\(data\) \{[\s\S]*?\n  \}/);
check(!!m, 'assessExtractionHealth extracted from sentinel.js');

let assess = null;
if (m) {
  const sandbox = {};
  vm.runInNewContext(m[0] + '\nthis.assessExtractionHealth = assessExtractionHealth;', sandbox);
  assess = sandbox.assessExtractionHealth;
  check(typeof assess === 'function', 'helper is callable');
}

const pc = (over) => ({ patientName: 'Smith, John', dob: '1980-01-01', dobRaw: '01/01/1980', ageYears: 46, sex: 'male', nhsNumber: '1234567890', ...over });

console.log('\n--- degraded (likely DOM/API drift) ---');
check(assess({ mode: 'live', patientContext: { patientName: 'Smith, John' }, medications: [], observations: [], problems: [] }).degraded === true,
  'patient identified but NOTHING extracted (no clinical, no demographics) → degraded');
check(typeof assess({ mode: 'live', patientContext: { patientId: 'abc' }, medications: [], observations: [], problems: [] }).reason === 'string',
  'degraded result carries a reason for the banner');

console.log('\n--- NOT degraded (genuine / not-applicable) ---');
check(assess({ mode: 'live', patientContext: pc(), medications: [], observations: [], problems: [] }).degraded === false,
  'identified patient with demographics but no matched rules → genuine "no alerts" (a sparse record still has demographics)');
check(assess({ mode: 'live', patientContext: pc({ patientName: null }), medications: [{ name: 'x' }], observations: [], problems: [] }).degraded === false,
  'some clinical data extracted → not degraded');
check(assess({ mode: 'live', patientContext: { ageYears: 50 }, medications: [], observations: [], problems: [] }).degraded === false,
  'no patient identified (not a patient view) → not degraded');
check(assess({ mode: 'mock', patientContext: { patientName: 'X' }, medications: [], observations: [], problems: [] }).degraded === false,
  'mock mode is never flagged degraded');
check(assess(null).degraded === false, 'null data → not degraded (no crash)');
check(assess({ mode: 'live', patientContext: { patientName: 'X', sex: 'female' }, medications: [], observations: [], problems: [] }).degraded === false,
  'identity + at least one demographic field present → genuine empty, not degraded');

console.log('\n--- per-module breakdown (informational; never an alarm on its own) ---');
const mods = assess({ mode: 'live', patientContext: pc(), medications: [{ name: 'a' }, { name: 'b' }], observations: [{ name: 'o' }], problems: [] }).modules;
check(mods && mods.medications === 2 && mods.observations === 1 && mods.problems === 0,
  'modules carries exact per-extractor counts');
check(mods && mods.demographics === true, 'modules.demographics reflects whether any demographic field was extracted');
check(assess({ mode: 'live', patientContext: pc(), medications: [{ name: 'a' }], observations: [], problems: [] }).degraded === false,
  'a zero count in one module (obs/problems empty) is NOT degraded while other data extracted — per-module zeros never alarm on their own');
check(assess({ mode: 'live', patientContext: pc(), medications: [], observations: [], problems: [] }).modules?.medications === 0,
  'modules present even on a sparse-but-genuine record (demographics carry it)');
check(assess({ mode: 'live', patientContext: { patientName: 'X' }, medications: [], observations: [], problems: [] }).modules?.medications === 0,
  'degraded result still carries a modules breakdown (all zeros) for the panel');
check(assess({ mode: 'mock', patientContext: { patientName: 'X' }, medications: [], observations: [], problems: [] }).modules === null,
  'non-live / not-a-patient-view returns modules:null (nothing to show)');

// ── BP synthesis ±1-day pairing (normalisers.js) ──────────────────────────────
// Regression guard for the ±1-day BP pairing change (Task 2).
// normaliseObservations() is driven by a minimal fake dashboard payload.

const normalisers = require('./engine/normalisers.js');

function makeDashboard(sysEntries, diaEntries) {
  // sysEntries/diaEntries: [{dateKey: 'data20260115', result: '120'}]
  const rows = [];
  if (sysEntries.length) {
    const sysRow = { investigationType: 'Systolic blood pressure', unit: 'mmHg' };
    sysEntries.forEach(e => { sysRow[e.dateKey] = { result: e.result }; });
    rows.push(sysRow);
  }
  if (diaEntries.length) {
    const diaRow = { investigationType: 'Diastolic blood pressure', unit: 'mmHg' };
    diaEntries.forEach(e => { diaRow[e.dateKey] = { result: e.result }; });
    rows.push(diaRow);
  }
  return { rowData: rows };
}

// dateKey for a YYYY-MM-DD date: 'dataYYYYMMDD'
function dk(iso) { return 'data' + iso.replace(/-/g, ''); }

console.log('\n--- BP synthesis: same-date pair ---');
{
  const dash = makeDashboard([{ dateKey: dk('2026-01-15'), result: '122' }],
                             [{ dateKey: dk('2026-01-15'), result: '78' }]);
  const obs = normalisers.normaliseObservations(dash);
  const bp = obs.filter(o => o.name === 'Blood pressure');
  check(bp.length === 1, 'same-date: exactly one BP obs synthesised');
  check(bp[0]?.date === '2026-01-15', 'same-date: BP obs has systolic date');
  check(bp[0]?.rawValue === '122/78', 'same-date: BP value is sys/dia');
}

console.log('\n--- BP synthesis: ±1-day pair (systolic before diastolic) ---');
{
  const dash = makeDashboard([{ dateKey: dk('2026-01-15'), result: '130' }],
                             [{ dateKey: dk('2026-01-16'), result: '82' }]);
  const obs = normalisers.normaliseObservations(dash);
  const bp = obs.filter(o => o.name === 'Blood pressure');
  check(bp.length === 1, '±1-day: exactly one BP obs synthesised');
  check(bp[0]?.date === '2026-01-15', '±1-day: synthesised date is systolic date');
  check(bp[0]?.rawValue === '130/82', '±1-day: correct sys/dia values');
}

console.log('\n--- BP synthesis: 3-day gap does NOT pair ---');
{
  const dash = makeDashboard([{ dateKey: dk('2026-01-15'), result: '130' }],
                             [{ dateKey: dk('2026-01-18'), result: '82' }]);
  const obs = normalisers.normaliseObservations(dash);
  const bp = obs.filter(o => o.name === 'Blood pressure');
  check(bp.length === 0, '3-day gap: no BP obs synthesised');
}

// ── findCardByTitle tiered matching (item 1.1 leg A, TRIAGE-LENS-2026-07-02.md) ──
// vm-extracts the REAL findCardByTitle (+ its _cardMissWarned Set guard) from
// content-scripts/triage-lens/content.js. A plain exact `===` match silently
// drops the whole card the moment Medicus tweaks a label or appends a live
// count ("Active Problems (5)") — a patient-safety risk (everything computed
// from that card goes empty with no error). This is tiered: exact-normalised,
// then count-suffix-stripped exact, then an UNAMBIGUOUS startsWith, and warns
// once per missing title per page load via a Set (not per findCardByTitle
// call — run() fires constantly).
console.log('\n--- findCardByTitle: tiered card-title matching (item 1.1 leg A) ---');

const triageLensSrc = fs.readFileSync(
  path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'),
  'utf8'
);
const fcbtMatch = triageLensSrc.match(
  /const _cardMissWarned = new Set\(\);[\s\S]*?const findCardByTitle = \(title\) => \{[\s\S]*?\n {2}\};/
);
check(!!fcbtMatch, 'findCardByTitle (+ _cardMissWarned) extracted from content.js');

// Minimal fake header + document — just enough for findCardByTitle's own
// contract: document.querySelectorAll('h2, h3, h4') returns header-like
// objects with .textContent / .closest() / .parentElement. Each header's
// closest() returns null (no .m-card-v2 ancestor in this fixture) so
// findCardByTitle falls through to its final `h2.parentElement?.parentElement`
// fallback — a distinct marker object per header lets assertions confirm
// WHICH header (if any) was actually selected.
function makeHeader(text) {
  const marker = { __card: text };
  return { textContent: text, closest: () => null, parentElement: { parentElement: marker }, __marker: marker };
}
function makeCardDoc(headers) {
  return { querySelectorAll: () => headers };
}

function makeFindCardByTitleSandbox(headers) {
  const warnings = [];
  const sandbox = {
    console: { warn: (...a) => warnings.push(a.join(' ')), log: () => {} },
    document: makeCardDoc(headers),
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fcbtMatch[0] + '\nthis.findCardByTitle = findCardByTitle;',
    sandbox,
    { filename: 'find-card-by-title-extract.js' }
  );
  sandbox.__warnings = warnings;
  return sandbox;
}

if (fcbtMatch) {
  // Tier 1 — exact match after trim/whitespace-collapse/case-insensitive.
  {
    const h = makeHeader('  Active   Problems ');
    const sandbox = makeFindCardByTitleSandbox([h]);
    check(
      sandbox.findCardByTitle('Active Problems') === h.__marker,
      'tier 1: matches despite extra/collapsed whitespace and leading/trailing trim'
    );
  }
  {
    const h = makeHeader('active problems');
    const sandbox = makeFindCardByTitleSandbox([h]);
    check(
      sandbox.findCardByTitle('Active Problems') === h.__marker,
      'tier 1: matches case-insensitively'
    );
  }

  // Tier 2 — a trailing " (N)" count suffix Medicus appended must not drop the card.
  {
    const h = makeHeader('Active Problems (5)');
    const sandbox = makeFindCardByTitleSandbox([h]);
    check(
      sandbox.findCardByTitle('Active Problems') === h.__marker,
      'tier 2: matches with a trailing count suffix stripped ("Active Problems (5)")'
    );
    check(sandbox.__warnings.length === 0, 'tier 2: a successful count-suffix match does NOT warn');
  }

  // Tier 3 — unambiguous startsWith when exactly one header qualifies.
  {
    const h = makeHeader('Tasks & Actions Overview');
    const sandbox = makeFindCardByTitleSandbox([h]);
    check(
      sandbox.findCardByTitle('Tasks & Actions') === h.__marker,
      'tier 3: unambiguous startsWith match (only one qualifying header)'
    );
  }

  // Ambiguity — startsWith must resolve to NO match when more than one header
  // qualifies. Neither "Tasks & Actions" nor "Tasks & Referrals" exactly equals
  // "Tasks" (so tier 1/2 don't resolve it), and BOTH start with it — an
  // ambiguous prefix must never silently grab either one.
  {
    const hActions = makeHeader('Tasks & Actions');
    const hReferrals = makeHeader('Tasks & Referrals');
    const sandbox = makeFindCardByTitleSandbox([hActions, hReferrals]);
    check(
      sandbox.findCardByTitle('Tasks') === null,
      'ambiguity: a startsWith prefix matching MULTIPLE headers resolves to null, never picks either one'
    );
  }
  // An exact match on the full, specific title is unaffected by the presence
  // of a sibling card sharing the same prefix — tier 1 wins outright for it,
  // no ambiguity to resolve. (CLAUDE.md: order lookups so longer/specific
  // titles are looked up as their own exact string, which extractTasks()
  // already does by querying 'Tasks & Actions', not the ambiguous 'Tasks'.)
  {
    const hActions = makeHeader('Tasks & Actions');
    const hReferrals = makeHeader('Tasks & Referrals');
    const sandbox = makeFindCardByTitleSandbox([hActions, hReferrals]);
    check(
      sandbox.findCardByTitle('Tasks & Actions') === hActions.__marker,
      'the longer/specific title still resolves via its own exact match regardless of a sibling sharing the prefix'
    );
  }

  // No match at all -> null, plus the one-time warn.
  {
    const sandbox = makeFindCardByTitleSandbox([makeHeader('Something Else Entirely')]);
    check(sandbox.findCardByTitle('Active Problems') === null, 'no qualifying header at all -> null');
    check(sandbox.__warnings.length === 1, `missing card warns once (got ${sandbox.__warnings.length})`);
    check(/Active Problems/.test(sandbox.__warnings[0] || ''), 'the warning names the missing title');
  }

  // One-time-per-title guard: calling findCardByTitle repeatedly for the SAME
  // missing title within one sandbox (== one page load, since _cardMissWarned
  // is module-level) must warn only ONCE — run() fires constantly, so this is
  // the difference between a single diagnostic line and console spam.
  {
    const sandbox = makeFindCardByTitleSandbox([makeHeader('Unrelated Card')]);
    sandbox.findCardByTitle('Active Problems');
    sandbox.findCardByTitle('Active Problems');
    sandbox.findCardByTitle('Active Problems');
    check(sandbox.__warnings.length === 1, `repeated calls for the same missing title warn only ONCE (got ${sandbox.__warnings.length})`);
    // A DIFFERENT missing title still gets its own warning — the guard is
    // per-title, not a single global "already warned once" latch.
    sandbox.findCardByTitle('Current Medication');
    check(sandbox.__warnings.length === 2, `a different missing title gets its own warning (got ${sandbox.__warnings.length})`);
  }
}

// ── HUD extraction-health state (item 1.1 leg B) ──────────────────────────────
// vm-extracts the REAL pure helpers content.js's renderHUD() uses: which cards
// are missing per page type (computeMissingCards, built on findCardByTitle),
// whether a tile's clear/zero state is actually "never read" vs "genuinely
// clear" (tileNotAssessed), and the two render-string choosers (headline chip
// + footer line). Kept pure specifically so this level of test can drive them
// without a full renderHUD()/DOM.
console.log('\n--- HUD extraction-health: missing-card computation + tile/headline choosers (item 1.1 leg B) ---');

const ecpMatch = triageLensSrc.match(/const EXPECTED_CARDS_BY_PAGE = \{[\s\S]*?\n {2}\};/);
const cmcCardsMatch = triageLensSrc.match(/const computeMissingCards = \(pageTypeVal, isDocTask\) => \{[\s\S]*?\n {2}\};/);
check(!!ecpMatch, 'EXPECTED_CARDS_BY_PAGE extracted from content.js');
check(!!cmcCardsMatch, 'computeMissingCards extracted from content.js');

function makeMissingCardsSandbox(headers) {
  const sandbox = {
    console: { warn: () => {}, log: () => {} },
    document: makeCardDoc(headers),
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fcbtMatch[0] + '\n' + ecpMatch[0] + '\n' + cmcCardsMatch[0] +
      '\nthis.computeMissingCards = computeMissingCards;',
    sandbox,
    { filename: 'missing-cards-extract.js' }
  );
  return sandbox;
}

if (ecpMatch && cmcCardsMatch && fcbtMatch) {
  const recordTitles = ['Registers', 'Active Problems', 'Current Medication', 'Tasks & Actions', 'Observations & Results'];

  // All expected record cards present -> nothing missing.
  {
    const sandbox = makeMissingCardsSandbox(recordTitles.map(makeHeader));
    check(
      JSON.stringify(sandbox.computeMissingCards('record', false)) === '[]',
      'record page, all 5 cards present -> computeMissingCards returns []'
    );
  }
  // One card genuinely absent -> named, and ONLY that one (present-but-findable
  // cards must not spuriously appear in the list).
  {
    const present = recordTitles.filter((t) => t !== 'Registers');
    const sandbox = makeMissingCardsSandbox(present.map(makeHeader));
    check(
      JSON.stringify(sandbox.computeMissingCards('record', false)) === JSON.stringify(['Registers']),
      'record page, Registers card absent -> missing list is exactly ["Registers"]'
    );
  }
  // Non-document detail page expects the request-triage cards, NOT the
  // record-summary ones — a document/communication task page that never
  // renders Registers/Active Problems must not be flagged over it.
  {
    const sandbox = makeMissingCardsSandbox(
      ['Task Details', 'Requester Details', 'Initial Request'].map(makeHeader)
    );
    check(
      JSON.stringify(sandbox.computeMissingCards('detail', false)) === '[]',
      'non-document detail page, its 3 expected cards present -> []'
    );
    check(
      JSON.stringify(sandbox.computeMissingCards('detail', true)) !==
        JSON.stringify(sandbox.computeMissingCards('detail', false)),
      'isDocTask flips to the detail-document expected set (a materially different list)'
    );
  }
  // Document-task detail page expects its own card set, independent of
  // whether the non-document detail cards happen to exist.
  {
    const sandbox = makeMissingCardsSandbox(
      ['Task Overview', 'Document Details', 'Internal Comments', 'Codes & Actions'].map(makeHeader)
    );
    check(
      JSON.stringify(sandbox.computeMissingCards('detail', true)) === '[]',
      'document-task detail page, its 4 expected cards present -> []'
    );
  }
}

// ---- tileNotAssessed / TILE_CARD_SOURCES ----
const tcsMatch = triageLensSrc.match(/const TILE_CARD_SOURCES = \{[\s\S]*?\n {2}\};/);
const tnaMatch = triageLensSrc.match(/const tileNotAssessed = \(key, signal, missingCards\) => \{[\s\S]*?\n {2}\};/);
check(!!tcsMatch, 'TILE_CARD_SOURCES extracted from content.js');
check(!!tnaMatch, 'tileNotAssessed extracted from content.js');

let tileNotAssessed = null;
if (tcsMatch && tnaMatch) {
  const sandbox = {};
  vm.runInNewContext(tcsMatch[0] + '\n' + tnaMatch[0] + '\nthis.tileNotAssessed = tileNotAssessed;', sandbox);
  tileNotAssessed = sandbox.tileNotAssessed;
  check(typeof tileNotAssessed === 'function', 'tileNotAssessed extracted and callable');
}
if (tileNotAssessed) {
  check(
    tileNotAssessed('meds', { items: [] }, ['Current Medication']) === true,
    'meds tile, zero findings, its one source card missing -> not-assessed'
  );
  check(
    tileNotAssessed('meds', { items: [{ text: 'Polypharmacy' }] }, ['Current Medication']) === false,
    'meds tile with a REAL finding present is never masked to not-assessed, even if its card is missing'
  );
  check(
    tileNotAssessed('risk', { items: [] }, ['Active Problems']) === false,
    'risk tile: only ONE of its two source cards missing -> stays a normal (real) clear, not not-assessed'
  );
  check(
    tileNotAssessed('risk', { items: [] }, ['Active Problems', 'Registers']) === true,
    'risk tile: BOTH source cards missing, zero findings -> not-assessed'
  );
  check(
    tileNotAssessed('unknownTile', { items: [] }, ['Registers']) === false,
    'an unmapped tile key never claims not-assessed (no TILE_CARD_SOURCES entry)'
  );
}

// ---- headlineNoFlagsChipHtml / missingCardsFooterHtml ----
const escMatch = triageLensSrc.match(/const _HTML_ESC = \{[\s\S]*?\};/);
const escFnMatch = triageLensSrc.match(/const escapeHtml = \(s\)[\s\S]*?;/);
const headlineMatch = triageLensSrc.match(/const headlineNoFlagsChipHtml = \(missingCards\) => \{[\s\S]*?\n {2}\};/);
const footerMatch = triageLensSrc.match(/const missingCardsFooterHtml = \(missingCards\) => \{[\s\S]*?\n {2}\};/);
check(!!headlineMatch, 'headlineNoFlagsChipHtml extracted from content.js');
check(!!footerMatch, 'missingCardsFooterHtml extracted from content.js');

let headlineNoFlagsChipHtml = null, missingCardsFooterHtml = null;
if (escMatch && escFnMatch && headlineMatch && footerMatch) {
  const sandbox = {};
  vm.runInNewContext(
    escMatch[0] + '\n' + escFnMatch[0] + '\n' + headlineMatch[0] + '\n' + footerMatch[0] +
      '\nthis.headlineNoFlagsChipHtml = headlineNoFlagsChipHtml;\nthis.missingCardsFooterHtml = missingCardsFooterHtml;',
    sandbox
  );
  headlineNoFlagsChipHtml = sandbox.headlineNoFlagsChipHtml;
  missingCardsFooterHtml = sandbox.missingCardsFooterHtml;
}
if (headlineNoFlagsChipHtml) {
  const clear = headlineNoFlagsChipHtml([]);
  check(/No flags/.test(clear) && /ch-chip-info/.test(clear), 'no missing cards -> the genuine green/info "No flags" chip');
  check(!/Not fully assessed/.test(clear), 'no missing cards -> never the "Not fully assessed" wording');

  const notAssessed = headlineNoFlagsChipHtml(['Registers']);
  check(/Not fully assessed/.test(notAssessed), 'a missing card -> "Not fully assessed" headline, never "No flags"');
  check(/ch-chip-not-assessed/.test(notAssessed), 'a missing card -> the grey ch-chip-not-assessed class, not ch-chip-info');
  check(!/No flags/.test(notAssessed), 'a missing card -> the string "No flags" must not appear at all (H-005)');
  check(/Registers/.test(notAssessed), 'the missing card title is named in the chip (tooltip)');
}
if (missingCardsFooterHtml) {
  check(missingCardsFooterHtml([]) === '', 'no missing cards -> empty footer (renders nothing)');
  const footer = missingCardsFooterHtml(['Registers', 'Active Problems']);
  check(/Could not read: Registers, Active Problems/.test(footer), 'footer lists every missing card, joined');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
