// Medicus Suite — PINCER expansion tests
// Run with: node test-visualiser-pincer.js
//
// Uses the vm-extraction pattern from test-viewer-phase1.js.
// Slices HIGH_RISK_DRUGS + computePINCER from visualiser-core.js,
// runs them in an isolated vm sandbox.

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

const SRC = fs.readFileSync(path.join(__dirname, 'visualiser-core.js'), 'utf8');

// ── Extract source slices ──────────────────────────────────────────────────
// Slice from 'const HIGH_RISK_DRUGS = [' through computePINCER's closing brace,
// up to the '// ══ STATE' anchor.
const START_NEEDLE = 'const HIGH_RISK_DRUGS = [';
const END_NEEDLE = '\n// ══ STATE';

const startIdx = SRC.indexOf(START_NEEDLE);
const endIdx = SRC.indexOf(END_NEEDLE, startIdx);

if (startIdx < 0) throw new Error('HIGH_RISK_DRUGS anchor not found in visualiser-core.js');
if (endIdx < 0) throw new Error('STATE anchor not found after HIGH_RISK_DRUGS in visualiser-core.js');

const snippet = SRC.slice(startIdx, endIdx);

// Run in a sandbox — expose computePINCER.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(snippet, sandbox);
vm.runInContext('this.computePINCER = computePINCER; this.HIGH_RISK_DRUGS = HIGH_RISK_DRUGS;', sandbox);

const computePINCER = sandbox.computePINCER;
const HIGH_RISK_DRUGS = sandbox.HIGH_RISK_DRUGS;

assert(typeof computePINCER === 'function', 'computePINCER extracted from vm sandbox');
assert(Array.isArray(HIGH_RISK_DRUGS), 'HIGH_RISK_DRUGS extracted from vm sandbox');

// ── Build synthetic drug/problem fixtures ─────────────────────────────────

// Build a simulated "drugs" array from HIGH_RISK_DRUGS entries.
// computePINCER uses: d.id, d.active, d.overdue, d.lastSeen, d.lastMonitoring,
//   d.requires, d.label, d.interval, d.terms.
function makeDetectedDrug(id, opts = {}) {
  const template = HIGH_RISK_DRUGS.find((d) => d.id === id);
  if (!template) throw new Error(`No HIGH_RISK_DRUGS entry for id: ${id}`);
  return {
    ...template,
    active: opts.active !== false,
    overdue: opts.overdue || false,
    lastSeen: opts.lastSeen !== undefined ? opts.lastSeen : new Date('2026-01-01'),
    lastMonitoring: opts.lastMonitoring || null,
  };
}

function problems(...labels) {
  return labels.map((name) => ({ name }));
}

// ── P-A: NSAID + GI bleed history, no gastroprotection ────────────────────
console.log('\n--- P-A: NSAID + GI bleed history (no PPI) ---');
{
  const drugs = [makeDetectedDrug('nsaid_long')];
  const probs = problems('peptic ulcer disease');
  const flags = computePINCER(probs, drugs, [], null);
  assert(
    flags.some((f) => f.rule.includes('GI bleed') || f.rule.includes('peptic ulcer')),
    'P-A fires: NSAID + peptic ulcer history without gastroprotection'
  );
}
// Does NOT fire when PPI present
{
  const drugs = [makeDetectedDrug('nsaid_long'), makeDetectedDrug('ppi')];
  const probs = problems('peptic ulcer disease');
  const flags = computePINCER(probs, drugs, [], null);
  assert(
    !flags.some((f) => f.rule.includes('GI bleed') || f.rule.includes('peptic ulcer')),
    'P-A does not fire when PPI present'
  );
}
// Does NOT fire without GI history
{
  const drugs = [makeDetectedDrug('nsaid_long')];
  const probs = problems('hypertension');
  const flags = computePINCER(probs, drugs, [], null);
  assert(
    !flags.some((f) => f.rule.includes('GI bleed') || f.rule.includes('peptic ulcer')),
    'P-A does not fire without GI history'
  );
}

// ── P-B: Antiplatelet + GI bleed history, no gastroprotection ─────────────
console.log('\n--- P-B: Antiplatelet + GI bleed history ---');
{
  const drugs = [makeDetectedDrug('antiplatelet')];
  const probs = problems('melaena');
  const flags = computePINCER(probs, drugs, [], null);
  assert(
    flags.some((f) => f.rule.toLowerCase().includes('antiplatelet') && f.rule.toLowerCase().includes('peptic ulcer')),
    'P-B fires: antiplatelet + melaena history without gastroprotection'
  );
}
// Does NOT fire when H2-blocker present
{
  const drugs = [makeDetectedDrug('antiplatelet'), makeDetectedDrug('h2blocker')];
  const probs = problems('melaena');
  const flags = computePINCER(probs, drugs, [], null);
  assert(
    !flags.some(
      (f) => f.rule.toLowerCase().includes('antiplatelet') && f.rule.toLowerCase().includes('gastroprotection')
    ),
    'P-B does not fire when H2-blocker present'
  );
}

// ── P-C: NSAID without gastroprotection in age ≥65 ─────────────────────────
console.log('\n--- P-C: NSAID without gastroprotection in age ≥65 ---');
{
  const drugs = [makeDetectedDrug('nsaid_long')];
  const flags = computePINCER([], drugs, [], '70');
  assert(
    flags.some((f) => f.rule.includes('PINCER #1') || (f.rule.includes('NSAID') && f.rule.includes('65'))),
    'P-C fires: NSAID + age 70, no gastroprotection'
  );
}
// Age < 65 → does NOT fire
{
  const drugs = [makeDetectedDrug('nsaid_long')];
  const flags = computePINCER([], drugs, [], '60');
  assert(
    !flags.some((f) => f.rule.includes('PINCER #1') || (f.rule.includes('NSAID') && f.rule.includes('65'))),
    'P-C does not fire for age 60'
  );
}
// Age unknown → does NOT fire (fail-closed)
{
  const drugs = [makeDetectedDrug('nsaid_long')];
  const flags = computePINCER([], drugs, [], null);
  assert(
    !flags.some((f) => f.rule.includes('PINCER #1') || (f.rule.includes('NSAID') && f.rule.includes('65'))),
    'P-C does not fire when age unknown (fail-closed)'
  );
}
// PPI present → does NOT fire
{
  const drugs = [makeDetectedDrug('nsaid_long'), makeDetectedDrug('ppi')];
  const flags = computePINCER([], drugs, [], '70');
  assert(
    !flags.some((f) => f.rule.includes('PINCER #1') || (f.rule.includes('NSAID') && f.rule.includes('65'))),
    'P-C does not fire when PPI present'
  );
}

// ── P-D: Anticoagulant + antiplatelet, no gastroprotection ─────────────────
console.log('\n--- P-D: Anticoagulant + antiplatelet, no gastroprotection ---');
{
  const drugs = [makeDetectedDrug('doac'), makeDetectedDrug('antiplatelet')];
  const flags = computePINCER([], drugs, [], null);
  assert(
    flags.some((f) => f.rule.toLowerCase().includes('anticoagulant') && f.rule.toLowerCase().includes('antiplatelet')),
    'P-D fires: DOAC + antiplatelet without gastroprotection'
  );
}
// PPI present → does NOT fire
{
  const drugs = [makeDetectedDrug('doac'), makeDetectedDrug('antiplatelet'), makeDetectedDrug('ppi')];
  const flags = computePINCER([], drugs, [], null);
  assert(
    !flags.some(
      (f) =>
        f.rule.toLowerCase().includes('anticoagulant') &&
        f.rule.toLowerCase().includes('antiplatelet') &&
        f.rule.toLowerCase().includes('gastroprotection')
    ),
    'P-D does not fire when PPI present'
  );
}

// ── P-E: Dual antiplatelet without PPI ────────────────────────────────────
console.log('\n--- P-E: Dual antiplatelet (aspirin + P2Y12) without PPI ---');
{
  const drugs = [makeDetectedDrug('aspirin_ap'), makeDetectedDrug('antiplatelet')];
  const flags = computePINCER([], drugs, [], null);
  assert(
    flags.some((f) => f.rule.includes('PINCER #8') || f.rule.toLowerCase().includes('dual antiplatelet')),
    'P-E fires: aspirin + clopidogrel without PPI'
  );
}
// PPI present → does NOT fire
{
  const drugs = [makeDetectedDrug('aspirin_ap'), makeDetectedDrug('antiplatelet'), makeDetectedDrug('ppi')];
  const flags = computePINCER([], drugs, [], null);
  assert(
    !flags.some((f) => f.rule.includes('PINCER #8') || f.rule.toLowerCase().includes('dual antiplatelet')),
    'P-E does not fire when PPI present'
  );
}
// Aspirin alone (no P2Y12) → does NOT fire P-E
{
  const drugs = [makeDetectedDrug('aspirin_ap')];
  const flags = computePINCER([], drugs, [], null);
  assert(
    !flags.some((f) => f.rule.includes('PINCER #8') || f.rule.toLowerCase().includes('dual antiplatelet')),
    'P-E does not fire for aspirin alone'
  );
}

// ── Aspirin not double-counted as NSAID ────────────────────────────────────
console.log('\n--- aspirin not double-counted as NSAID ---');
{
  // aspirin_ap is a separate detector from nsaid_long
  // nsaid_long terms do NOT include aspirin 75/300 — verify this
  const nsaidEntry = HIGH_RISK_DRUGS.find((d) => d.id === 'nsaid_long');
  const aspTerms = (nsaidEntry?.terms || []).filter((t) => t.includes('aspirin'));
  assert(aspTerms.length === 0, 'nsaid_long terms do not include aspirin terms');
}

// ── Negative control: clean drug list → no PINCER flags ──────────────────
console.log('\n--- negative control: clean drug list ---');
{
  const flags = computePINCER(problems('hypertension'), [], [], '50');
  const pincerNewFlags = flags.filter((f) => !f.rule.includes('monitoring overdue'));
  assert(pincerNewFlags.length === 0, 'clean drug list → no PINCER interaction flags');
}

// ── Existing flags: source field present ──────────────────────────────────
console.log('\n--- existing flags carry source field ---');
{
  const drugs = [makeDetectedDrug('nsaid_long')];
  const probs = problems('chronic kidney disease');
  const flags = computePINCER(probs, drugs, [], null);
  const ckdFlag = flags.find((f) => f.rule.includes('CKD'));
  assert(!!ckdFlag, 'CKD+NSAID flag still fires');
  assert(typeof ckdFlag.source === 'string' && ckdFlag.source.length > 0, 'CKD+NSAID flag has source field');
}

// ── P-F: ACEi/ARB in age ≥75 without recent U&E ──────────────────────────
console.log('\n--- P-F: ACEi/ARB in age ≥75 without U&E ---');
{
  // Make ACEi with no lastMonitoring (U&E never done)
  const acei = makeDetectedDrug('acei', { active: true, overdue: true, lastMonitoring: null });
  const flags = computePINCER([], [acei], [], '80');
  assert(
    flags.some((f) => f.rule.includes('ACEi') || f.rule.includes('≥75')),
    'P-F fires: ACEi + age 80 + no U&E'
  );
}
// Age < 75 → P-F specific flag does NOT fire
{
  const acei = makeDetectedDrug('acei', { active: true, overdue: true, lastMonitoring: null });
  const flags = computePINCER([], [acei], [], '70');
  assert(!flags.some((f) => f.rule.includes('≥75')), 'P-F does not fire for age 70');
}
// Age unknown → P-F does NOT fire (fail-closed)
{
  const acei = makeDetectedDrug('acei', { active: true, overdue: true, lastMonitoring: null });
  const flags = computePINCER([], [acei], [], null);
  assert(!flags.some((f) => f.rule.includes('≥75')), 'P-F does not fire when age unknown (fail-closed)');
}

// ── KD-31: Triple whammy (NSAID + ACEi/ARB + diuretic) ────────────────────
console.log('\n--- KD-31: Triple whammy (resolved 2026-06-11) ---');
{
  // All three present → fires
  const flags = computePINCER(
    [],
    [makeDetectedDrug('nsaid_long'), makeDetectedDrug('acei'), makeDetectedDrug('diuretic')],
    [],
    null
  );
  assert(
    flags.some((f) => /triple|whammy/i.test(f.rule)),
    'KD-31: NSAID + ACEi + diuretic fires Triple whammy'
  );
  const flag = flags.find((f) => /triple|whammy/i.test(f.rule));
  assert(flag && flag.severity === 'high', 'KD-31: Triple whammy severity is high');
  assert(
    flag && /PINCER #4.*STOPP|STOPP.*PINCER #4/i.test(flag.source),
    'KD-31: Triple whammy source cites PINCER #4 / STOPP'
  );
}
{
  // NSAID + ACEi only (no diuretic) → does NOT fire
  const flags = computePINCER([], [makeDetectedDrug('nsaid_long'), makeDetectedDrug('acei')], [], null);
  assert(!flags.some((f) => /triple|whammy/i.test(f.rule)), 'KD-31: NSAID + ACEi alone does NOT fire triple whammy');
}
{
  // NSAID + diuretic only (no ACEi) → does NOT fire
  const flags = computePINCER([], [makeDetectedDrug('nsaid_long'), makeDetectedDrug('diuretic')], [], null);
  assert(
    !flags.some((f) => /triple|whammy/i.test(f.rule)),
    'KD-31: NSAID + diuretic alone does NOT fire triple whammy'
  );
}

// ── KD-30: NSAID + antiplatelet (anticoag-precedence) ─────────────────────
console.log('\n--- KD-30: NSAID + antiplatelet (resolved 2026-06-11) ---');
{
  // NSAID + antiplatelet, no anticoag → fires
  const flags = computePINCER([], [makeDetectedDrug('nsaid_long'), makeDetectedDrug('antiplatelet')], [], null);
  assert(
    flags.some((f) => f.rule.toLowerCase().includes('antiplatelet') && !f.rule.toLowerCase().includes('anticoag')),
    'KD-30: NSAID + antiplatelet (no anticoag) fires'
  );
  const flag = flags.find(
    (f) => f.rule.toLowerCase().includes('antiplatelet') && !f.rule.toLowerCase().includes('anticoag')
  );
  assert(flag && flag.severity === 'high', 'KD-30: NSAID+antiplatelet severity is high');
  assert(
    flag && /PINCER #3.*STOPP|STOPP.*PINCER #3/i.test(flag.source),
    'KD-30: NSAID+antiplatelet source cites PINCER #3 / STOPP'
  );
}
{
  // NSAID + aspirin_ap (no oral anticoag) → fires
  const flags = computePINCER([], [makeDetectedDrug('nsaid_long'), makeDetectedDrug('aspirin_ap')], [], null);
  assert(
    flags.some((f) => f.rule.toLowerCase().includes('antiplatelet') && !f.rule.toLowerCase().includes('anticoag')),
    'KD-30: NSAID + aspirin_ap (no anticoag) fires'
  );
}
{
  // Anticoag-precedence: NSAID + anticoag + antiplatelet → antiplatelet flag must NOT fire
  const flags = computePINCER(
    [],
    [makeDetectedDrug('nsaid_long'), makeDetectedDrug('doac'), makeDetectedDrug('antiplatelet')],
    [],
    null
  );
  assert(
    !flags.some((f) => f.rule.toLowerCase().includes('antiplatelet') && !f.rule.toLowerCase().includes('anticoag')),
    'KD-30: anticoag present → NSAID+antiplatelet flag suppressed (anticoag-precedence)'
  );
  // The NSAID+anticoagulant flag must still fire
  assert(
    flags.some((f) => f.rule.toLowerCase().includes('anticoagulant')),
    'KD-30: NSAID+anticoag flag still fires when anticoag present'
  );
}

// ── KD-33: Benzo/Z-drug in age ≥80 ───────────────────────────────────────
console.log('\n--- KD-33: Benzo/Z-drug in age ≥80 (resolved 2026-06-11) ---');
{
  // Fires at age 80
  const flags = computePINCER([], [makeDetectedDrug('benzo_z')], [], '80');
  assert(
    flags.some((f) => /benzo|z.drug/i.test(f.rule)),
    'KD-33: benzo_z + age 80 fires'
  );
  const flag = flags.find((f) => /benzo|z.drug/i.test(f.rule));
  assert(flag && flag.severity === 'high', 'KD-33: benzo/Z-drug severity is high');
  assert(flag && /STOPP/i.test(flag.source), 'KD-33: benzo/Z-drug source cites STOPP');
}
{
  // Fires at age 90
  const flags = computePINCER([], [makeDetectedDrug('benzo_z')], [], '90');
  assert(
    flags.some((f) => /benzo|z.drug/i.test(f.rule)),
    'KD-33: benzo_z + age 90 fires'
  );
}
{
  // Age 79 (just below threshold) → does NOT fire
  const flags = computePINCER([], [makeDetectedDrug('benzo_z')], [], '79');
  assert(!flags.some((f) => /benzo|z.drug/i.test(f.rule)), 'KD-33: benzo_z + age 79 does NOT fire');
}
{
  // Age unknown → does NOT fire (fail-closed)
  const flags = computePINCER([], [makeDetectedDrug('benzo_z')], [], null);
  assert(!flags.some((f) => /benzo|z.drug/i.test(f.rule)), 'KD-33: benzo_z + age unknown does NOT fire (fail-closed)');
}
{
  // Age unknown via undefined → does NOT fire (fail-closed)
  const flags = computePINCER([], [makeDetectedDrug('benzo_z')], [], undefined);
  assert(
    !flags.some((f) => /benzo|z.drug/i.test(f.rule)),
    'KD-33: benzo_z + age undefined does NOT fire (fail-closed)'
  );
}

// ── Drug-table completeness locks (2026-06-11 Keeper) ─────────────────────
// The HIGH_RISK_DRUGS tables were completed to parity with the triage-lens
// prescribing flags. Matching in the visualiser is \b-bounded, so derivatives
// and spelling variants must be listed explicitly — these locks prevent a
// future edit silently dropping one.
console.log('\n── Drug-table completeness locks ──');
{
  const termsOf = (id) => (HIGH_RISK_DRUGS.find((d) => d.id === id)?.terms || []).map((t) => t.toLowerCase());

  const nsaids = termsOf('nsaid_long');
  for (const t of [
    'ibuprofen',
    'dexibuprofen',
    'naproxen',
    'diclofenac',
    'aceclofenac',
    'celecoxib',
    'etoricoxib',
    'meloxicam',
    'piroxicam',
    'tenoxicam',
    'indometacin',
    'indomethacin',
    'sulindac',
    'ketoprofen',
    'dexketoprofen',
    'tiaprofenic acid',
    'mefenamic acid',
    'tolfenamic acid',
    'fenoprofen',
    'nabumetone',
    'etodolac',
    'flurbiprofen',
  ]) {
    assert(nsaids.includes(t), `nsaid_long terms include "${t}"`);
  }

  const vka = termsOf('warfarin');
  for (const t of ['warfarin', 'acenocoumarol', 'phenindione']) {
    assert(vka.includes(t), `warfarin/VKA terms include "${t}"`);
  }

  const acei = termsOf('acei');
  for (const t of [
    'ramipril',
    'lisinopril',
    'perindopril',
    'enalapril',
    'captopril',
    'trandolapril',
    'fosinopril',
    'quinapril',
    'imidapril',
    'cilazapril',
    'candesartan',
    'losartan',
    'irbesartan',
    'valsartan',
    'olmesartan',
    'telmisartan',
    'azilsartan',
    'eprosartan',
  ]) {
    assert(acei.includes(t), `acei terms include "${t}"`);
  }

  const diuretics = termsOf('diuretic');
  for (const t of [
    'furosemide',
    'frusemide',
    'bumetanide',
    'torasemide',
    'indapamide',
    'bendroflumethiazide',
    'hydrochlorothiazide',
    'chlortalidone',
    'chlorthalidone',
    'metolazone',
  ]) {
    assert(diuretics.includes(t), `diuretic terms include "${t}"`);
  }

  // benzo_z entry (2026-06-11 KD-33 resolution) — parity with content.js BENZO_Z.
  const benzo = termsOf('benzo_z');
  for (const t of [
    'diazepam',
    'lorazepam',
    'temazepam',
    'nitrazepam',
    'oxazepam',
    'chlordiazepoxide',
    'clonazepam',
    'alprazolam',
    'zopiclone',
    'zolpidem',
    'zaleplon',
  ]) {
    assert(benzo.includes(t), `benzo_z terms include "${t}"`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
