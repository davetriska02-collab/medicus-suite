// Medicus Suite — PINCER parity / regression test
// Run with: node test-pincer-parity.js
//
// PURPOSE
// -------
// The suite has two independent live implementations of PINCER-style
// prescribing-safety logic:
//
//   (A) computePINCER()     in visualiser-core.js   (procedural, drug-object based)
//   (B) evaluatePrescribingFlags()  in content-scripts/triage-lens/content.js
//                                   (regex-based, string-list based)
//
// Divergence between them is a clinical hazard: a clinician may see different
// flags for the same patient in the visualiser vs the triage HUD.
//
// This test:
//   1. Extracts both implementations via vm sandbox (no production changes).
//   2. Builds fixture patients covering every scenario that overlaps.
//   3. Runs per-drug coverage probes: for each drug term in each
//      implementation's list, checks whether the OTHER side also detects it.
//   4. Documents KNOWN_DIVERGENCES (pinned today). The test FAILS only on
//      NEW divergence — i.e. current behaviour deviating from what is pinned.
//
// KNOWN_DIVERGENCES — flagged for CSO review — see repo audit T6
// ---------------------------------------------------------------
//
// RESOLVED 2026-06-11 (The Keeper, visualiser drug-table completion):
//   KD-01..15 (NSAID drug-set) — visualiser nsaid_long now carries the complete
//     UK systemic NSAID set incl. both indometacin/indomethacin spellings and the
//     dex- derivatives (the visualiser matches with \b word boundaries, so
//     derivatives must be listed explicitly, unlike content.js's bare substring).
//   KD-16..17 (acenocoumarol, phenindione) — visualiser 'warfarin' entry is now
//     'Warfarin / VKA' covering all UK oral vitamin-K antagonists (INR-monitored).
//   KD-22..29 (ACEi/ARB set) — visualiser acei entry completed to parity with
//     content.js ACEI_ARB.
//   KD-35..37 (torasemide, hydrochlorothiazide, metolazone) — visualiser diuretic
//     entry completed; 'frusemide' added to content.js DIURETIC in the same pass.
//   These now appear as positive both-sides coverage assertions below.
//
// REMAINING known divergences (deliberate, pinned):
//
// Anticoagulant drug-set — LMWH/heparin (content.js includes them, visualiser
// deliberately does NOT):
//   KD-18  enoxaparin      content.js fires "NSAID+anticoag"   visualiser silent
//   KD-19  dalteparin      content.js fires "NSAID+anticoag"   visualiser silent
//   KD-20  tinzaparin      content.js fires "NSAID+anticoag"   visualiser silent
//   KD-21  heparin         content.js fires "NSAID+anticoag"   visualiser silent
//          Rationale (2026-06-11 Keeper): the visualiser's flag is worded
//          "NSAID with oral anticoagulant" and is driven by the warfarin/doac
//          monitoring entries; folding parenteral heparins in would need a new
//          table entry referenced by computePINCER (a logic change, out of the
//          Keeper's data-only remit) and the prior verifier advised against
//          LMWH in oral-anticoagulant PINCER lists. CSO may revisit.
//
// Rule-shape divergence (one side has a rule the other lacks entirely):
//   KD-30  NSAID + antiplatelet (no anticoag)
//          content.js fires "NSAID + antiplatelet"
//          visualiser has NO equivalent rule (only NSAID+anticoag, not NSAID-only+antiplatelet)
//
//   KD-31  Triple whammy (NSAID + ACEi/ARB + diuretic)
//          content.js fires "Triple whammy (NSAID + ACEi/ARB + diuretic)"
//          visualiser has NO triple-whammy rule (NSAID+CKD/HF checks exist but not this combo)
//          NOTE: the alert-library.json PINCER #4 covers this; the triage-lens does; the
//          visualiser's computePINCER does NOT.
//
//   KD-32  NSAID in age ≥65 without gastroprotection (PINCER #1)
//          visualiser fires "NSAID in age ≥65 without gastroprotection (PINCER #1)"
//          content.js has NO age-gated NSAID+age flag (only NSAID combos regardless of age)
//
//   KD-33  Benzodiazepine/Z-drug in age ≥80
//          content.js fires "Benzodiazepine/Z-drug in age ≥80"
//          visualiser has NO benzo/Z-drug flag at all
//
//   KD-34  NSAID + anticoagulant: content.js does NOT have gastroprotection suppression;
//          visualiser also does NOT suppress on gastroprotection for this combo — PARITY OK
//          (documented for completeness — not a divergence)

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── Extract computePINCER from visualiser-core.js ─────────────────────────

const CORE_SRC = fs.readFileSync(path.join(__dirname, 'visualiser-core.js'), 'utf8');
const START_NEEDLE = 'const HIGH_RISK_DRUGS = [';
const END_NEEDLE = '\n// ══ STATE';
const coreStart = CORE_SRC.indexOf(START_NEEDLE);
const coreEnd = CORE_SRC.indexOf(END_NEEDLE, coreStart);
if (coreStart < 0) throw new Error('HIGH_RISK_DRUGS anchor not found in visualiser-core.js');
if (coreEnd < 0) throw new Error('STATE anchor not found in visualiser-core.js');

const coreSandbox = {};
vm.createContext(coreSandbox);
vm.runInContext(CORE_SRC.slice(coreStart, coreEnd), coreSandbox);
vm.runInContext(
  'this.computePINCER = computePINCER; this.HIGH_RISK_DRUGS = HIGH_RISK_DRUGS;',
  coreSandbox,
);

const computePINCER = coreSandbox.computePINCER;
const HIGH_RISK_DRUGS = coreSandbox.HIGH_RISK_DRUGS;
assert(typeof computePINCER === 'function', 'computePINCER extracted from visualiser-core.js');
assert(Array.isArray(HIGH_RISK_DRUGS), 'HIGH_RISK_DRUGS extracted from visualiser-core.js');

// ── Extract evaluatePrescribingFlags from content.js ──────────────────────

const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'),
  'utf8',
);
const fnMatch = CONTENT_SRC.match(/function evaluatePrescribingFlags\(meds, age\) \{[\s\S]*?\n  \}/);
assert(!!fnMatch, 'evaluatePrescribingFlags extracted from content.js');

let evaluate = null;
if (fnMatch) {
  const csSandbox = {};
  vm.runInNewContext(
    fnMatch[0] + '\nthis.evaluatePrescribingFlags = evaluatePrescribingFlags;',
    csSandbox,
  );
  evaluate = csSandbox.evaluatePrescribingFlags;
  assert(typeof evaluate === 'function', 'evaluatePrescribingFlags is callable');
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Build a visualiser detected-drug object from a HIGH_RISK_DRUGS entry by id.
function makeVDrug(id, opts = {}) {
  const tpl = HIGH_RISK_DRUGS.find((d) => d.id === id);
  if (!tpl) throw new Error(`No HIGH_RISK_DRUGS entry for id: ${id}`);
  return {
    ...tpl,
    active: opts.active !== false,
    overdue: opts.overdue || false,
    lastSeen: opts.lastSeen !== undefined ? opts.lastSeen : new Date('2026-01-01'),
    lastMonitoring: opts.lastMonitoring || null,
  };
}

// Build a minimal visualiser detected-drug object from raw terms (for drug terms
// not in HIGH_RISK_DRUGS — used only in drug-set probes where we're testing
// what computePINCER would do if the drug were detected).
function makeVDrugFromTerms(id, label, terms, overrides = {}) {
  return {
    id,
    label,
    terms,
    requires: [],
    interval: 0,
    active: true,
    overdue: false,
    lastSeen: new Date('2026-01-01'),
    lastMonitoring: null,
    ...overrides,
  };
}

// content.js helper: turn a string med name into a meds list
function csNSAIDWithAnticoag(nsaidName, anticoagName = 'Apixaban 5mg tablets') {
  return evaluate([nsaidName, anticoagName], 60);
}
function csTexts(items) {
  return items.map((i) => i.text);
}

// Check whether a content.js drug string fires "NSAID + anticoagulant"
function csFiresNSAIDAnticoag(drugName) {
  return csTexts(csNSAIDWithAnticoag(drugName)).includes('NSAID + anticoagulant');
}

// Check whether a content.js drug string fires as anticoag in NSAID+anticoag combo
function csFiresAsAnticoag(anticoagName) {
  return csTexts(evaluate(['Ibuprofen 400mg', anticoagName], 60)).includes('NSAID + anticoagulant');
}

// Check whether a content.js drug string fires triple whammy
function csFiresTripleWhammy(nsaid, acei, diuretic) {
  return csTexts(evaluate([nsaid, acei, diuretic], 60)).some((t) =>
    t.startsWith('Triple whammy'),
  );
}

// ── KNOWN_DIVERGENCES table ───────────────────────────────────────────────
// Each entry: { id, description, visualiserFires, contentJsFires, scenario }
// This table is pinned against today's observed behaviour.
// The test asserts that each side does what is documented here.
// It is ALSO printed in the summary for CSO review.

const KNOWN_DIVERGENCES = [
  // LMWH/heparin in content.js only — deliberate, see header rationale
  { id: 'KD-18', drug: 'Enoxaparin 40mg', side: 'anticoag_detection', vis: false, cs: true },
  { id: 'KD-19', drug: 'Dalteparin 5000 units', side: 'anticoag_detection', vis: false, cs: true },
  { id: 'KD-20', drug: 'Tinzaparin 3500 units', side: 'anticoag_detection', vis: false, cs: true },
  { id: 'KD-21', drug: 'Heparin 5000 units', side: 'anticoag_detection', vis: false, cs: true },
  // Rule-shape divergences (one side lacks the rule entirely)
  {
    id: 'KD-30',
    drug: 'Diclofenac 50mg + Clopidogrel 75mg (no anticoag)',
    side: 'nsaid_antiplatelet_rule',
    vis: false,
    cs: true,
  },
  {
    id: 'KD-31',
    drug: 'Ibuprofen + Ramipril + Furosemide (triple whammy rule)',
    side: 'triple_whammy_rule',
    vis: false,
    cs: true,
  },
  {
    id: 'KD-32',
    drug: 'NSAID + age ≥65 without gastroprotection (PINCER #1 age-gate)',
    side: 'nsaid_age65_rule',
    vis: true,
    cs: false,
  },
  {
    id: 'KD-33',
    drug: 'Zopiclone 7.5mg + age ≥80 (benzo/Z-drug rule)',
    side: 'benzo_zdrug_rule',
    vis: false,
    cs: true,
  },
];

// ── SECTION 1: Extraction health-check (already asserted above) ───────────

// ── SECTION 2: Overlapping scenario parity tests ─────────────────────────
//
// For each scenario, we test BOTH sides and document whether they agree.
// If they disagree but the divergence is already in KNOWN_DIVERGENCES,
// the test passes (we assert pinned behaviour).
// A NEW divergence (not in KNOWN_DIVERGENCES) causes test failure.

console.log('\n═══ SECTION 2: Overlapping scenario parity ═══\n');

// Helper: test that a scenario is in parity (both fire or both don't).
// If divergent, check against KNOWN_DIVERGENCES table.
// kdId: optional — if provided, we assert the pinned vis/cs values.
function parityCheck(label, visFires, csFires, kdId) {
  const inParity = visFires === csFires;
  if (inParity) {
    assert(true, `PARITY  [${label}] — both ${visFires ? 'FIRE' : 'silent'}`);
  } else {
    const kd = kdId ? KNOWN_DIVERGENCES.find((k) => k.id === kdId) : null;
    if (kd) {
      // Known divergence — assert pinned behaviour for each side
      assert(
        visFires === kd.vis,
        `KD pinned — visualiser ${kd.vis ? 'fires' : 'silent'} for [${label}]`,
      );
      assert(
        csFires === kd.cs,
        `KD pinned — content.js ${kd.cs ? 'fires' : 'silent'} for [${label}]`,
      );
    } else {
      // NEW divergence — hard fail
      assert(
        false,
        `NEW DIVERGENCE (not in KNOWN_DIVERGENCES): [${label}] visualiser=${visFires} content.js=${csFires}`,
      );
    }
  }
}

// ── 2a: NSAID + oral anticoagulant — core drugs known to BOTH sides ───────
console.log('--- 2a: NSAID + anticoagulant (drugs known to both sides) ---');
{
  // Ibuprofen + apixaban
  const visFlags = computePINCER([], [makeVDrug('nsaid_long'), makeVDrug('doac')], [], null);
  const visFires = visFlags.some((f) => f.rule.toLowerCase().includes('anticoagulant'));
  const csFires = csFiresNSAIDAnticoag('Ibuprofen 400mg');
  parityCheck('ibuprofen + apixaban → NSAID+anticoag', visFires, csFires);
}
{
  // Naproxen + warfarin
  const visFlags = computePINCER(
    [],
    [makeVDrug('nsaid_long'), makeVDrug('warfarin')],
    [],
    null,
  );
  const visFires = visFlags.some((f) => f.rule.toLowerCase().includes('anticoagulant'));
  const csFires = csTexts(evaluate(['Naproxen 500mg', 'Warfarin 3mg'], 60)).includes(
    'NSAID + anticoagulant',
  );
  parityCheck('naproxen + warfarin → NSAID+anticoag', visFires, csFires);
}
{
  // Diclofenac + rivaroxaban
  const visFlags = computePINCER([], [makeVDrug('nsaid_long'), makeVDrug('doac')], [], null);
  const visFires = visFlags.some((f) => f.rule.toLowerCase().includes('anticoagulant'));
  const csFires = csTexts(evaluate(['Diclofenac 50mg', 'Rivaroxaban 20mg'], 60)).includes(
    'NSAID + anticoagulant',
  );
  parityCheck('diclofenac + rivaroxaban → NSAID+anticoag', visFires, csFires);
}

// ── 2b: NSAID + anticoagulant — extended NSAIDs (resolved KD-01..15) ───────
// 2026-06-11 Keeper: the visualiser nsaid_long entry was completed to the full
// UK systemic NSAID set. Both sides must now detect every one of these.
console.log('\n--- 2b: NSAID+anticoag — extended NSAIDs, both sides (resolved KD-01..15) ---');
const EXTENDED_NSAIDS = [
  'Piroxicam 20mg',
  'Tenoxicam 20mg',
  'Indometacin 25mg',
  'Indomethacin 25mg',
  'Sulindac 200mg',
  'Ketoprofen 100mg',
  'Dexketoprofen 25mg',
  'Tiaprofenic acid 300mg',
  'Mefenamic acid 500mg',
  'Tolfenamic acid 200mg',
  'Fenoprofen 300mg',
  'Aceclofenac 100mg',
  'Nabumetone 500mg',
  'Etodolac 600mg SR',
  'Flurbiprofen 100mg',
  'Dexibuprofen 400mg',
];
{
  const nsaidEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'nsaid_long');
  // Same \b-bounded regex construction as visualiser-core's scan loop.
  const visNsaidRe = new RegExp(
    '\\b(' + nsaidEntry.terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
    'i',
  );
  for (const name of EXTENDED_NSAIDS) {
    assert(csFiresNSAIDAnticoag(name), `content.js fires NSAID+anticoag for ${name}`);
    assert(visNsaidRe.test(name), `visualiser nsaid_long terms match ${name}`);
  }
}

// ── 2c: Anticoagulant drug-set ─────────────────────────────────────────────
// VKAs (resolved KD-16..17): the visualiser 'warfarin' entry is now 'Warfarin /
// VKA' and carries acenocoumarol + phenindione — both sides must detect them.
console.log('\n--- 2c: Anticoagulant drug-set — VKAs both sides (resolved KD-16..17) ---');
for (const name of ['Acenocoumarol 1mg', 'Phenindione 25mg']) {
  assert(csFiresAsAnticoag(name), `content.js fires for ${name} as anticoag`);
  const vkaEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'warfarin');
  const term = name.split(' ')[0].toLowerCase();
  assert(
    vkaEntry && vkaEntry.terms.some((t) => t.toLowerCase() === term),
    `visualiser warfarin/VKA entry contains ${name.split(' ')[0]}`,
  );
}
// LMWH/heparin (pinned KD-18..21): content.js includes them; the visualiser
// deliberately does not (see header rationale).
console.log('\n--- 2c2: LMWH/heparin — pinned divergence (KD-18..21) ---');
const LMWH_KD = [
  { name: 'Enoxaparin 40mg', kdId: 'KD-18' },
  { name: 'Dalteparin 5000 units', kdId: 'KD-19' },
  { name: 'Tinzaparin 3500 units', kdId: 'KD-20' },
  { name: 'Heparin 5000 units', kdId: 'KD-21' },
];
for (const { name, kdId } of LMWH_KD) {
  const csFires = csFiresAsAnticoag(name);
  const kd = KNOWN_DIVERGENCES.find((k) => k.id === kdId);
  assert(csFires === kd.cs, `${kdId} pinned: content.js ${kd.cs ? 'fires' : 'silent'} for ${name} as anticoag`);
  const visHasIt = ['warfarin', 'doac'].some((id) => {
    const entry = HIGH_RISK_DRUGS.find((d) => d.id === id);
    const term = name.split(' ')[0].toLowerCase();
    return entry && entry.terms.some((t) => t.toLowerCase().includes(term));
  });
  assert(!visHasIt, `${kdId} pinned: visualiser HIGH_RISK_DRUGS does NOT contain ${name.split(' ')[0]}`);
}

// ── 2d: NSAID + antiplatelet (no anticoag) — rule-shape divergence ────────
console.log('\n--- 2d: NSAID + antiplatelet (no anticoag) — rule-shape divergence ---');
{
  // content.js fires "NSAID + antiplatelet"; visualiser has no such rule
  const csFires = csTexts(evaluate(['Diclofenac 50mg', 'Clopidogrel 75mg'], 55)).includes(
    'NSAID + antiplatelet',
  );
  // For visualiser: diclofenac detected as nsaid_long, clopidogrel as antiplatelet
  // computePINCER has no NSAID+antiplatelet rule → should NOT fire
  const visFlags = computePINCER(
    [],
    [makeVDrug('nsaid_long'), makeVDrug('antiplatelet')],
    [],
    null,
  );
  const visFires = visFlags.some(
    (f) => f.rule.toLowerCase().includes('antiplatelet') && !f.rule.toLowerCase().includes('anticoagulant'),
  );
  parityCheck('diclofenac + clopidogrel → NSAID+antiplatelet only', visFires, csFires, 'KD-30');
}

// ── 2e: Triple whammy (NSAID + ACEi/ARB + diuretic) — rule-shape divergence ──
console.log('\n--- 2e: Triple whammy — rule-shape divergence ---');
{
  // content.js fires "Triple whammy"; visualiser has no triple-whammy rule
  const csFires = csTexts(
    evaluate(['Naproxen 250mg', 'Ramipril 5mg', 'Furosemide 40mg'], 68),
  ).some((t) => t.startsWith('Triple whammy'));
  // visualiser: naproxen (nsaid_long) + ramipril (acei) + furosemide (diuretic) in drug list
  // computePINCER checks NSAID+CKD, NSAID+HF, NSAID+anticoag — but NOT NSAID+ACEi+diuretic combo
  const visFlags = computePINCER(
    [],
    [makeVDrug('nsaid_long'), makeVDrug('acei'), makeVDrug('diuretic')],
    [],
    null,
  );
  const visFires = visFlags.some((f) => /triple|whammy/i.test(f.rule));
  parityCheck(
    'naproxen + ramipril + furosemide → triple whammy',
    visFires,
    csFires,
    'KD-31',
  );
}

// ── 2f: Triple whammy — extended ACEi/ARB terms (resolved KD-22..29) ──────
// 2026-06-11 Keeper: visualiser acei entry completed. content.js must fire the
// triple whammy AND the visualiser acei entry must carry the term.
console.log('\n--- 2f: Triple whammy — extended ACEi/ARB terms, both sides ---');
const EXTENDED_ACEI = [
  'Trandolapril 2mg',
  'Fosinopril 10mg',
  'Quinapril 5mg',
  'Imidapril 5mg',
  'Cilazapril 1mg',
  'Telmisartan 40mg',
  'Azilsartan 40mg',
  'Eprosartan 600mg',
];
for (const name of EXTENDED_ACEI) {
  assert(
    csFiresTripleWhammy('Ibuprofen 400mg', name, 'Furosemide 40mg'),
    `content.js fires triple whammy for ${name}`,
  );
  const aceiEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'acei');
  const term = name.split(' ')[0].toLowerCase();
  assert(
    aceiEntry && aceiEntry.terms.some((t) => t.toLowerCase() === term),
    `visualiser acei entry contains ${name.split(' ')[0]}`,
  );
}

// ── 2g: Triple whammy — extended diuretic terms (resolved KD-35..37) ──────
console.log('\n--- 2g: Triple whammy — extended diuretic terms, both sides ---');
for (const name of ['Torasemide 5mg', 'Hydrochlorothiazide 12.5mg', 'Metolazone 2.5mg']) {
  assert(
    csFiresTripleWhammy('Ibuprofen 400mg', 'Ramipril 5mg', name),
    `content.js fires triple whammy for ${name}`,
  );
  const diureticEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'diuretic');
  const term = name.split(' ')[0].toLowerCase();
  assert(
    diureticEntry && diureticEntry.terms.some((t) => t.toLowerCase() === term),
    `visualiser diuretic entry contains ${name.split(' ')[0]}`,
  );
}

// ── 2h: NSAID in age ≥65 without gastroprotection (PINCER #1) ────────────
console.log('\n--- 2h: NSAID + age ≥65 — rule-shape divergence (visualiser only) ---');
{
  // visualiser fires this; content.js has no age-gated NSAID rule
  const visFlags = computePINCER([], [makeVDrug('nsaid_long')], [], '70');
  const visFires = visFlags.some(
    (f) => f.rule.includes('PINCER #1') || (f.rule.includes('NSAID') && f.rule.includes('65')),
  );
  // content.js: ibuprofen at age 70, no anticoag/antiplatelet/ACEi+diuretic → no flags
  const csItems = evaluate(['Ibuprofen 400mg'], 70);
  const csFires = csItems.some((i) =>
    /age.*65|65.*age|pincer.*1|nsaid.*65/i.test(i.text + (i.detail || '')),
  );
  parityCheck('NSAID + age 70 → age-gated flag', visFires, csFires, 'KD-32');
}

// ── 2i: Benzo/Z-drug in age ≥80 — rule-shape divergence (content.js only) ──
console.log('\n--- 2i: Benzo/Z-drug age ≥80 — rule-shape divergence (content.js only) ---');
{
  const csFires = csTexts(evaluate(['Zopiclone 7.5mg'], 84)).includes(
    'Benzodiazepine/Z-drug in age ≥80',
  );
  // visualiser: no benzo/Z-drug rule in computePINCER
  // We can't even feed zopiclone to computePINCER since it's not a HIGH_RISK_DRUGS entry
  // Assert content.js fires (pinned)
  const kd = KNOWN_DIVERGENCES.find((k) => k.id === 'KD-33');
  assert(csFires === kd.cs, `KD-33 pinned: content.js ${kd.cs ? 'fires' : 'silent'} benzo/Z-drug for zopiclone+84`);
  // Assert visualiser has no benzo/Z-drug rule (none of the HIGH_RISK_DRUGS ids cover it)
  const visHasBenzo = HIGH_RISK_DRUGS.some((d) =>
    d.terms && d.terms.some((t) => /zopiclone|zolpidem|zaleplon|diazepam|lorazepam/i.test(t)),
  );
  assert(!visHasBenzo && kd.vis === false, `KD-33 pinned: visualiser HIGH_RISK_DRUGS has no benzo/Z-drug terms`);
}

// ── SECTION 3: Per-drug coverage probes across shared drug classes ─────────
//
// For each drug term in each implementation's list, probe whether the OTHER
// side would also detect it.  Pure drift detector.

console.log('\n═══ SECTION 3: Per-drug coverage probes ═══\n');

// 3a: Every NSAID term in content.js — does it fire "NSAID+anticoag"?
console.log('--- 3a: content.js NSAID terms → fires NSAID+anticoag ---');
const CS_NSAID_TERMS = [
  'Ibuprofen 400mg',
  'Naproxen 500mg',
  'Diclofenac 50mg',
  'Celecoxib 100mg',
  'Etoricoxib 60mg',
  'Meloxicam 7.5mg',
  'Piroxicam 20mg',
  'Tenoxicam 20mg',
  'Indometacin 25mg',
  'Sulindac 200mg',
  'Ketoprofen 100mg',
  'Dexketoprofen 25mg',
  'Tiaprofenic acid 300mg',
  'Mefenamic acid 500mg',
  'Tolfenamic acid 200mg',
  'Fenoprofen 300mg',
  'Aceclofenac 100mg',
  'Nabumetone 500mg',
  'Etodolac 600mg SR',
  'Flurbiprofen 100mg',
  'Dexibuprofen 400mg',
];
for (const nsaid of CS_NSAID_TERMS) {
  const csFires = csFiresNSAIDAnticoag(nsaid);
  assert(csFires, `content.js detects ${nsaid.split(' ')[0]} as systemic NSAID`);
}

// 3b: Every visualiser NSAID term — is it in content.js NSAID regex?
console.log('\n--- 3b: visualiser nsaid_long terms → content.js NSAID+anticoag ---');
const visNSAIDEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'nsaid_long');
for (const term of visNSAIDEntry.terms) {
  const medName = term.charAt(0).toUpperCase() + term.slice(1) + ' 400mg';
  const csFires = csFiresNSAIDAnticoag(medName);
  assert(csFires, `content.js detects visualiser nsaid_long term: ${term}`);
}

// 3c: Every visualiser NSAID term — does computePINCER fire NSAID+anticoag?
console.log('\n--- 3c: visualiser nsaid_long terms → computePINCER NSAID+anticoag ---');
for (const term of visNSAIDEntry.terms) {
  const visFlags = computePINCER([], [makeVDrug('nsaid_long'), makeVDrug('doac')], [], null);
  const visFires = visFlags.some((f) => f.rule.toLowerCase().includes('anticoagulant'));
  // The test is that with nsaid_long in the drug list, the flag fires regardless of which
  // specific term matched — the entry covers the whole group
  assert(visFires, `computePINCER fires NSAID+anticoag with nsaid_long entry (covers ${term})`);
}

// 3d: Anticoagulant terms shared by both sides — warfarin / DOACs
console.log('\n--- 3d: anticoagulant terms shared by both sides ---');
const SHARED_ANTICOAG_PAIRS = [
  { cs: 'Warfarin 3mg', visId: 'warfarin' },
  { cs: 'Apixaban 5mg', visId: 'doac' },
  { cs: 'Rivaroxaban 20mg', visId: 'doac' },
  { cs: 'Dabigatran 150mg', visId: 'doac' },
  { cs: 'Edoxaban 60mg', visId: 'doac' },
];
for (const { cs: anticoag, visId } of SHARED_ANTICOAG_PAIRS) {
  const csFires = csFiresAsAnticoag(anticoag);
  const visFlags = computePINCER(
    [],
    [makeVDrug('nsaid_long'), makeVDrug(visId)],
    [],
    null,
  );
  const visFires = visFlags.some((f) => f.rule.toLowerCase().includes('anticoagulant'));
  parityCheck(`${anticoag} as anticoag → NSAID+anticoag`, visFires, csFires);
}

// 3e: ACEi/ARB terms shared by both sides
console.log('\n--- 3e: ACEi/ARB terms shared by both sides → triple whammy ---');
const visACEIEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'acei');
const SHARED_ACEI = ['ramipril', 'lisinopril', 'perindopril', 'enalapril', 'captopril',
                     'candesartan', 'losartan', 'irbesartan', 'valsartan', 'olmesartan'];
for (const term of SHARED_ACEI) {
  const inVisualiser = visACEIEntry.terms.includes(term);
  assert(inVisualiser, `visualiser acei entry contains shared term: ${term}`);
  const aceiName = term.charAt(0).toUpperCase() + term.slice(1) + ' 5mg';
  const csFires = csFiresTripleWhammy('Ibuprofen 400mg', aceiName, 'Furosemide 40mg');
  assert(csFires, `content.js fires triple whammy for ${term}`);
}

// 3f: Diuretic terms shared by both sides → triple whammy
console.log('\n--- 3f: diuretic terms shared by both sides → triple whammy ---');
const visDigureticEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'diuretic');
const SHARED_DIURETICS = ['furosemide', 'bumetanide', 'indapamide', 'bendroflumethiazide', 'chlortalidone'];
for (const term of SHARED_DIURETICS) {
  const inVisualiser = visDigureticEntry.terms.some((t) => t.includes(term));
  assert(inVisualiser, `visualiser diuretic entry contains shared term: ${term}`);
  const diurName = term.charAt(0).toUpperCase() + term.slice(1) + ' 40mg';
  const csFires = csFiresTripleWhammy('Ibuprofen 400mg', 'Ramipril 5mg', diurName);
  assert(csFires, `content.js fires triple whammy for ${term}`);
}

// 'frusemide' (old UK spelling): present in the visualiser diuretic entry and —
// since the 2026-06-11 Keeper pass — in content.js DIURETIC too. Both sides.
{
  assert(
    csFiresTripleWhammy('Ibuprofen 400mg', 'Ramipril 5mg', 'Frusemide 40mg'),
    'content.js fires triple whammy for frusemide (old UK spelling)',
  );
  assert(
    visDigureticEntry.terms.includes('frusemide'),
    'visualiser diuretic entry contains frusemide',
  );
}

// ── SECTION 4: Negative controls (both sides agree: no flag) ──────────────

console.log('\n═══ SECTION 4: Negative controls ═══\n');

{
  // Topical NSAID + anticoag → neither fires NSAID+anticoag
  const csFires = csTexts(
    evaluate(['Ibuprofen gel 5%', 'Apixaban 5mg tablets'], 60),
  ).includes('NSAID + anticoagulant');
  assert(!csFires, 'PARITY content.js: topical ibuprofen gel + anticoag does NOT fire');
  // visualiser: 'ibuprofen gel' won't match any drug term (terms are bare generic names,
  // detection uses the extracted drug list which excludes topicals at source)
  // We simply note that computePINCER only fires if nsaid_long is in the detected drugs list —
  // topical detection is upstream, so no nsaid_long entry → no flag.
  const visFlags = computePINCER([], [makeVDrug('doac')], [], null);
  const visFires = visFlags.some((f) => f.rule.toLowerCase().includes('anticoagulant') && f.rule.toLowerCase().includes('nsaid'));
  assert(!visFires, 'PARITY visualiser: anticoag alone (no nsaid_long) does NOT fire NSAID+anticoag');
}
{
  // ARB + diuretic WITHOUT NSAID → no triple whammy from either
  const csFires = csTexts(
    evaluate(['Losartan 50mg', 'Indapamide 2.5mg'], 68),
  ).some((t) => t.startsWith('Triple whammy'));
  assert(!csFires, 'PARITY content.js: ARB + diuretic (no NSAID) does NOT fire triple whammy');
  // visualiser: no triple whammy rule at all, but also NSAID not present
  const visFlags = computePINCER([], [makeVDrug('acei'), makeVDrug('diuretic')], [], null);
  const visTriple = visFlags.some((f) => /triple|whammy/i.test(f.rule));
  assert(!visTriple, 'PARITY visualiser: ACEi + diuretic (no NSAID) has no triple-whammy rule firing');
}
{
  // Clean list → no prescribing flags from either
  const csFires = evaluate(['Amlodipine 5mg', 'Atorvastatin 20mg'], 55).length > 0;
  assert(!csFires, 'PARITY content.js: clean list → no flags');
  const visFlags = computePINCER([], [], [], '55');
  const visFires = visFlags.filter((f) => !f.rule.includes('monitoring overdue')).length > 0;
  assert(!visFires, 'PARITY visualiser: clean list → no PINCER flags');
}

// ── SECTION 5: Print known-divergence summary ────────────────────────────

console.log('\n═══ SECTION 5: Known divergence summary ═══\n');
console.log(
  `  ${KNOWN_DIVERGENCES.length} documented divergences — flagged for CSO review (see repo audit T6)\n`,
);
const grouped = {};
for (const kd of KNOWN_DIVERGENCES) {
  const g = kd.side;
  (grouped[g] = grouped[g] || []).push(kd);
}
const groupLabels = {
  nsaid_anticoag: 'NSAID drug-set: absent from visualiser HIGH_RISK_DRUGS nsaid_long',
  anticoag_detection: 'Anticoagulant drug-set: absent from visualiser warfarin/doac entries',
  triple_whammy_acei: 'ACEi/ARB drug-set: absent from visualiser acei entry (triple-whammy)',
  triple_whammy_diuretic: 'Diuretic drug-set: absent from visualiser diuretic entry (triple-whammy)',
  nsaid_antiplatelet_rule: 'Rule-shape: NSAID+antiplatelet — present in content.js, absent from visualiser',
  triple_whammy_rule: 'Rule-shape: Triple whammy — present in content.js, absent from visualiser',
  nsaid_age65_rule: 'Rule-shape: NSAID+age≥65 (PINCER #1) — present in visualiser, absent from content.js',
  benzo_zdrug_rule: 'Rule-shape: Benzo/Z-drug+age≥80 — present in content.js, absent from visualiser',
};
for (const [side, kds] of Object.entries(grouped)) {
  console.log(`  [${groupLabels[side] || side}]`);
  for (const kd of kds) {
    const visTag = kd.vis ? 'VIS=fires' : 'VIS=silent';
    const csTag = kd.cs ? 'CS=fires' : 'CS=silent';
    console.log(`    ${kd.id}  ${visTag}  ${csTag}  — ${kd.drug}`);
  }
  console.log('');
}

// ── Final summary ─────────────────────────────────────────────────────────

const inParityCount = passed; // approximate — most passing tests are parity
console.log('─'.repeat(60));
console.log(
  `Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`,
);
console.log(
  `Known divergences: ${KNOWN_DIVERGENCES.length} (listed above) — THESE ARE CLINICAL GAPS`,
);
if (failed > 0) {
  console.error('\nFAIL — new divergence detected or pinned behaviour broken. Fix before shipping.');
  process.exit(1);
} else {
  console.log(
    '\nAll tests passed. No new divergences. Known divergences are pinned for CSO review.',
  );
}
