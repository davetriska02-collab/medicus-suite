// test-stopp-start.js — STOPP/START v3 engine unit tests
// Run with: node test-stopp-start.js
'use strict';

const { computeStoppStart } = require('./engine/stopp-start.js');

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

// Helper — find a flag by id
function find(flags, id) {
  return flags.find((f) => f.id === id);
}

// ── STOPP 1: NSAID + eGFR <50 ──────────────────────────────────────────────
console.log('\n--- STOPP 1: NSAID + eGFR <50 ---');
{
  const flags = computeStoppStart({ drugs: ['ibuprofen 400mg'], problems: [], ageYears: 70, egfr: 45 });
  const f = find(flags, 'stopp_nsaid_ckd');
  assert(!!f, 'STOPP 1 fires: ibuprofen + eGFR 45');
  assert(f.severity === 'red', 'STOPP 1 severity = red');
  assert(f.kind === 'stopp', 'STOPP 1 kind = stopp');
}
{
  // eGFR 55 → no STOPP 1
  const flags = computeStoppStart({ drugs: ['ibuprofen 400mg'], problems: [], ageYears: 70, egfr: 55 });
  assert(!find(flags, 'stopp_nsaid_ckd'), 'STOPP 1 does NOT fire: eGFR 55 (above threshold)');
}
{
  // eGFR unknown → no flag (fail-closed)
  const flags = computeStoppStart({ drugs: ['ibuprofen 400mg'], problems: [], ageYears: 70, egfr: null });
  assert(!find(flags, 'stopp_nsaid_ckd'), 'STOPP 1 does NOT fire when eGFR unknown (fail-closed)');
}
{
  // No NSAID → no flag
  const flags = computeStoppStart({ drugs: ['omeprazole'], problems: [], ageYears: 70, egfr: 40 });
  assert(!find(flags, 'stopp_nsaid_ckd'), 'STOPP 1 does NOT fire without NSAID');
}

// ── STOPP 2: NSAID + loop diuretic ────────────────────────────────────────
console.log('\n--- STOPP 2: NSAID + loop diuretic ---');
{
  const flags = computeStoppStart({
    drugs: ['naproxen 500mg', 'furosemide 40mg'],
    problems: [],
    ageYears: 65,
    egfr: 60,
  });
  const f = find(flags, 'stopp_nsaid_loop');
  assert(!!f, 'STOPP 2 fires: naproxen + furosemide');
  assert(f.severity === 'amber', 'STOPP 2 severity = amber');
}
{
  // No loop diuretic → no STOPP 2
  const flags = computeStoppStart({ drugs: ['naproxen 500mg', 'indapamide'], problems: [], ageYears: 65, egfr: 60 });
  assert(!find(flags, 'stopp_nsaid_loop'), 'STOPP 2 does NOT fire: naproxen + indapamide (thiazide, not loop)');
}
{
  // No NSAID → no STOPP 2
  const flags = computeStoppStart({ drugs: ['furosemide 40mg'], problems: [], ageYears: 65, egfr: 60 });
  assert(!find(flags, 'stopp_nsaid_loop'), 'STOPP 2 does NOT fire without NSAID');
}

// ── STOPP 3: First-gen antihistamine in age ≥65 ───────────────────────────
console.log('\n--- STOPP 3: First-gen antihistamine in age >=65 ---');
{
  const flags = computeStoppStart({ drugs: ['chlorphenamine 4mg'], problems: [], ageYears: 70, egfr: null });
  const f = find(flags, 'stopp_firstgen_ah_elderly');
  assert(!!f, 'STOPP 3 fires: chlorphenamine + age 70');
  assert(f.severity === 'amber', 'STOPP 3 severity = amber');
}
{
  // Age 64 → no flag
  const flags = computeStoppStart({ drugs: ['chlorphenamine 4mg'], problems: [], ageYears: 64, egfr: null });
  assert(!find(flags, 'stopp_firstgen_ah_elderly'), 'STOPP 3 does NOT fire at age 64');
}
{
  // Age unknown → no flag (fail-closed)
  const flags = computeStoppStart({ drugs: ['chlorphenamine 4mg'], problems: [], ageYears: null, egfr: null });
  assert(!find(flags, 'stopp_firstgen_ah_elderly'), 'STOPP 3 does NOT fire when age unknown (fail-closed)');
}
{
  // Non-sedating antihistamine (cetirizine) → no flag
  const flags = computeStoppStart({ drugs: ['cetirizine 10mg'], problems: [], ageYears: 75, egfr: null });
  assert(!find(flags, 'stopp_firstgen_ah_elderly'), 'STOPP 3 does NOT fire for cetirizine (non-sedating)');
}

// ── STOPP 4: Benzodiazepine in age ≥65 ────────────────────────────────────
console.log('\n--- STOPP 4: Benzodiazepine in age >=65 ---');
{
  const flags = computeStoppStart({ drugs: ['diazepam 5mg'], problems: [], ageYears: 68, egfr: null });
  const f = find(flags, 'stopp_benzo_elderly');
  assert(!!f, 'STOPP 4 fires: diazepam + age 68');
  assert(f.severity === 'amber', 'STOPP 4 severity = amber');
  assert(f.detail.includes('snapshot'), 'STOPP 4 detail includes snapshot duration caveat');
}
{
  // Age 60 → no flag
  const flags = computeStoppStart({ drugs: ['diazepam 5mg'], problems: [], ageYears: 60, egfr: null });
  assert(!find(flags, 'stopp_benzo_elderly'), 'STOPP 4 does NOT fire at age 60');
}
{
  // Age unknown → fail-closed
  const flags = computeStoppStart({ drugs: ['diazepam 5mg'], problems: [], ageYears: null, egfr: null });
  assert(!find(flags, 'stopp_benzo_elderly'), 'STOPP 4 does NOT fire when age unknown');
}

// ── STOPP 5: Z-drug in age ≥65 ────────────────────────────────────────────
console.log('\n--- STOPP 5: Z-drug in age >=65 ---');
{
  const flags = computeStoppStart({ drugs: ['zopiclone 7.5mg'], problems: [], ageYears: 72, egfr: null });
  const f = find(flags, 'stopp_zdrug_elderly');
  assert(!!f, 'STOPP 5 fires: zopiclone + age 72');
  assert(f.severity === 'amber', 'STOPP 5 severity = amber');
  assert(f.detail.includes('snapshot'), 'STOPP 5 detail includes snapshot duration caveat');
}
{
  // Brand: Zimovane
  const flags = computeStoppStart({ drugs: ['Zimovane 7.5mg tablets'], problems: [], ageYears: 80, egfr: null });
  assert(!!find(flags, 'stopp_zdrug_elderly'), 'STOPP 5 fires for Zimovane brand name');
}
{
  // Age 64 → no flag
  const flags = computeStoppStart({ drugs: ['zopiclone 7.5mg'], problems: [], ageYears: 64, egfr: null });
  assert(!find(flags, 'stopp_zdrug_elderly'), 'STOPP 5 does NOT fire at age 64');
}

// ── STOPP 6: Digoxin + eGFR <30 ───────────────────────────────────────────
console.log('\n--- STOPP 6: Digoxin + eGFR <30 ---');
{
  const flags = computeStoppStart({ drugs: ['digoxin 125 micrograms'], problems: [], ageYears: 80, egfr: 22 });
  const f = find(flags, 'stopp_digoxin_gfr30');
  assert(!!f, 'STOPP 6 fires: digoxin + eGFR 22');
  assert(f.severity === 'red', 'STOPP 6 severity = red');
}
{
  // eGFR 32 → no flag
  const flags = computeStoppStart({ drugs: ['digoxin 125 micrograms'], problems: [], ageYears: 80, egfr: 32 });
  assert(!find(flags, 'stopp_digoxin_gfr30'), 'STOPP 6 does NOT fire: eGFR 32');
}
{
  // eGFR unknown → fail-closed
  const flags = computeStoppStart({ drugs: ['digoxin 125 micrograms'], problems: [], ageYears: 80, egfr: null });
  assert(!find(flags, 'stopp_digoxin_gfr30'), 'STOPP 6 does NOT fire when eGFR unknown');
}

// ── STOPP 7: Metformin + eGFR <30 ─────────────────────────────────────────
console.log('\n--- STOPP 7: Metformin + eGFR <30 ---');
{
  const flags = computeStoppStart({ drugs: ['metformin 500mg'], problems: [], ageYears: 70, egfr: 25 });
  const f = find(flags, 'stopp_metformin_gfr30');
  assert(!!f, 'STOPP 7 fires: metformin + eGFR 25');
  assert(f.severity === 'red', 'STOPP 7 severity = red');
}
{
  // eGFR 35 → no flag
  const flags = computeStoppStart({ drugs: ['metformin 500mg'], problems: [], ageYears: 70, egfr: 35 });
  assert(!find(flags, 'stopp_metformin_gfr30'), 'STOPP 7 does NOT fire: eGFR 35');
}

// ── STOPP 8: PPI present ──────────────────────────────────────────────────
console.log('\n--- STOPP 8: PPI review ---');
{
  const flags = computeStoppStart({ drugs: ['omeprazole 20mg'], problems: [], ageYears: 65, egfr: null });
  const f = find(flags, 'stopp_ppi_review');
  assert(!!f, 'STOPP 8 fires: omeprazole present');
  assert(f.severity === 'amber', 'STOPP 8 severity = amber');
  assert(f.detail.includes('snapshot'), 'STOPP 8 detail includes snapshot caveat');
}
{
  // No PPI → no flag
  const flags = computeStoppStart({ drugs: ['atorvastatin 40mg'], problems: [], ageYears: 65, egfr: null });
  assert(!find(flags, 'stopp_ppi_review'), 'STOPP 8 does NOT fire without PPI');
}

// ── STOPP 9: Aspirin + no CV disease (primary prevention) ─────────────────
console.log('\n--- STOPP 9: Aspirin primary prevention ---');
{
  // Aspirin + no CV disease → flags
  const flags = computeStoppStart({
    drugs: ['aspirin 75mg tablets'],
    problems: [{ name: 'hypertension' }],
    ageYears: 55,
    egfr: null,
  });
  const f = find(flags, 'stopp_aspirin_primary_prev');
  assert(!!f, 'STOPP 9 fires: aspirin + no CV disease problem');
  assert(f.severity === 'amber', 'STOPP 9 severity = amber');
}
{
  // Aspirin + angina → NO primary-prevention flag
  const flags = computeStoppStart({
    drugs: ['aspirin 75mg tablets'],
    problems: [{ name: 'stable angina' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'stopp_aspirin_primary_prev'), 'STOPP 9 does NOT fire: aspirin + angina coded');
}
{
  // Aspirin + IHD → NO primary-prevention flag
  const flags = computeStoppStart({
    drugs: ['aspirin 75mg tablets'],
    problems: [{ name: 'ischaemic heart disease' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'stopp_aspirin_primary_prev'), 'STOPP 9 does NOT fire: aspirin + IHD coded');
}
{
  // Aspirin + stroke → NO flag
  const flags = computeStoppStart({
    drugs: ['aspirin 75mg tablet'],
    problems: [{ name: 'stroke' }],
    ageYears: 70,
    egfr: null,
  });
  assert(!find(flags, 'stopp_aspirin_primary_prev'), 'STOPP 9 does NOT fire: aspirin + stroke coded');
}
{
  // No aspirin → no flag
  const flags = computeStoppStart({ drugs: ['clopidogrel'], problems: [], ageYears: 60, egfr: null });
  assert(!find(flags, 'stopp_aspirin_primary_prev'), 'STOPP 9 does NOT fire without aspirin');
}

// ── STOPP 10: Long-acting sulfonylurea in age ≥65 ─────────────────────────
console.log('\n--- STOPP 10: Long-acting sulfonylurea in age >=65 ---');
{
  const flags = computeStoppStart({ drugs: ['glibenclamide 5mg'], problems: [], ageYears: 70, egfr: null });
  const f = find(flags, 'stopp_long_su_elderly');
  assert(!!f, 'STOPP 10 fires: glibenclamide + age 70');
  assert(f.severity === 'amber', 'STOPP 10 severity = amber');
}
{
  const flags = computeStoppStart({ drugs: ['glimepiride 2mg'], problems: [], ageYears: 68, egfr: null });
  assert(!!find(flags, 'stopp_long_su_elderly'), 'STOPP 10 fires: glimepiride + age 68');
}
{
  // Age 64 → no flag
  const flags = computeStoppStart({ drugs: ['glibenclamide 5mg'], problems: [], ageYears: 64, egfr: null });
  assert(!find(flags, 'stopp_long_su_elderly'), 'STOPP 10 does NOT fire at age 64');
}
{
  // Short-acting sulfonylurea (gliclazide) → no flag
  const flags = computeStoppStart({ drugs: ['gliclazide 80mg'], problems: [], ageYears: 72, egfr: null });
  assert(!find(flags, 'stopp_long_su_elderly'), 'STOPP 10 does NOT fire for gliclazide');
}

// ── START 11: IHD + no statin ─────────────────────────────────────────────
console.log('\n--- START 11: IHD + no statin ---');
{
  const flags = computeStoppStart({
    drugs: ['aspirin 75mg', 'ramipril 5mg'],
    problems: [{ name: 'ischaemic heart disease' }],
    ageYears: 65,
    egfr: null,
  });
  const f = find(flags, 'start_statin_ihd');
  assert(!!f, 'START 11 fires: IHD coded, no statin');
  assert(f.kind === 'start', 'START 11 kind = start');
  assert(f.severity === 'amber', 'START 11 severity = amber');
}
{
  // Statin present → no START 11
  const flags = computeStoppStart({
    drugs: ['atorvastatin 40mg'],
    problems: [{ name: 'ischaemic heart disease' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_statin_ihd'), 'START 11 does NOT fire: statin present');
}
{
  // No IHD problem → no START 11
  const flags = computeStoppStart({
    drugs: ['ramipril 5mg'],
    problems: [{ name: 'hypertension' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_statin_ihd'), 'START 11 does NOT fire: no IHD problem');
}

// ── START 12: Diabetes + CKD + no ACEi/ARB ───────────────────────────────
console.log('\n--- START 12: Diabetes + CKD + no ACEi/ARB ---');
{
  // Diabetes + CKD problem + no ACEi/ARB → flag
  const flags = computeStoppStart({
    drugs: ['metformin 500mg', 'atorvastatin 40mg'],
    problems: [{ name: 'type 2 diabetes' }, { name: 'chronic kidney disease stage 3' }],
    ageYears: 65,
    egfr: 55,
  });
  const f = find(flags, 'start_acei_arb_dm_ckd');
  assert(!!f, 'START 12 fires: diabetes + CKD problem + no ACEi/ARB');
  assert(f.kind === 'start', 'START 12 kind = start');
}
{
  // Diabetes + eGFR <60 (no CKD problem coded) + no ACEi/ARB → flag
  const flags = computeStoppStart({
    drugs: ['metformin 500mg'],
    problems: [{ name: 'type 2 diabetes mellitus' }],
    ageYears: 65,
    egfr: 52,
  });
  assert(!!find(flags, 'start_acei_arb_dm_ckd'), 'START 12 fires: diabetes + eGFR 52 + no ACEi/ARB');
}
{
  // ACEi present → no flag
  const flags = computeStoppStart({
    drugs: ['ramipril 5mg'],
    problems: [{ name: 'type 2 diabetes' }, { name: 'chronic kidney disease' }],
    ageYears: 65,
    egfr: 50,
  });
  assert(!find(flags, 'start_acei_arb_dm_ckd'), 'START 12 does NOT fire: ACEi present');
}
{
  // ARB present → no flag
  const flags = computeStoppStart({
    drugs: ['losartan 50mg'],
    problems: [{ name: 'type 2 diabetes' }, { name: 'chronic kidney disease' }],
    ageYears: 65,
    egfr: 50,
  });
  assert(!find(flags, 'start_acei_arb_dm_ckd'), 'START 12 does NOT fire: ARB present');
}
{
  // No diabetes → no flag
  const flags = computeStoppStart({
    drugs: ['metformin 500mg'],
    problems: [{ name: 'chronic kidney disease stage 3' }],
    ageYears: 65,
    egfr: 50,
  });
  assert(!find(flags, 'start_acei_arb_dm_ckd'), 'START 12 does NOT fire: no diabetes problem');
}
{
  // eGFR >=60 + no CKD problem + no ACEi/ARB → no flag (CKD gate not met)
  const flags = computeStoppStart({
    drugs: ['metformin 500mg'],
    problems: [{ name: 'type 2 diabetes' }],
    ageYears: 65,
    egfr: 65,
  });
  assert(!find(flags, 'start_acei_arb_dm_ckd'), 'START 12 does NOT fire: eGFR 65 + no CKD problem');
}

// ── medrev-001: ACEi/ARB term-list parity ─────────────────────────────────
// trandolapril (ACEi) and telmisartan (ARB) were missing from stopp-start.js;
// brought to parity with visualiser-core.js. A diabetic-CKD patient on either
// must therefore NOT trigger the START "consider ACEi/ARB" flag (they are on one).
console.log('\n--- medrev-001: ACEi/ARB parity (trandolapril, telmisartan) ---');
{
  // trandolapril now recognised as ACEi → START 12 suppressed
  const flags = computeStoppStart({
    drugs: ['trandolapril 2mg'],
    problems: [{ name: 'type 2 diabetes' }, { name: 'chronic kidney disease' }],
    ageYears: 65,
    egfr: 50,
  });
  assert(!find(flags, 'start_acei_arb_dm_ckd'), 'trandolapril recognised as ACEi (START 12 suppressed)');
}
{
  // telmisartan now recognised as ARB → START 12 suppressed
  const flags = computeStoppStart({
    drugs: ['telmisartan 40mg'],
    problems: [{ name: 'type 2 diabetes' }, { name: 'chronic kidney disease' }],
    ageYears: 65,
    egfr: 50,
  });
  assert(!find(flags, 'start_acei_arb_dm_ckd'), 'telmisartan recognised as ARB (START 12 suppressed)');
}

// ── medrev-004: Anticholinergic burden in age ≥65 ─────────────────────────
console.log('\n--- medrev-004: Anticholinergic burden in age >=65 ---');
{
  // Age 70 on amitriptyline (ACB 3) → fires
  const flags = computeStoppStart({ drugs: ['amitriptyline 10mg'], problems: [], ageYears: 70, egfr: null });
  const f = find(flags, 'stopp-anticholinergic-elderly');
  assert(!!f, 'anticholinergic-elderly fires: amitriptyline + age 70');
  assert(f.severity === 'amber', 'anticholinergic-elderly severity = amber');
  assert(f.kind === 'stopp', 'anticholinergic-elderly kind = stopp');
  assert(/STOPP\/START v3/.test(f.source) && /2023/.test(f.source), 'anticholinergic-elderly source cites STOPP/START v3 (2023)');
}
{
  // Age 70 on no anticholinergic → does NOT fire
  const flags = computeStoppStart({ drugs: ['amlodipine 5mg'], problems: [], ageYears: 70, egfr: null });
  assert(!find(flags, 'stopp-anticholinergic-elderly'), 'anticholinergic-elderly does NOT fire: age 70 + no anticholinergic');
}
{
  // Age 50 on amitriptyline → does NOT fire (age gate)
  const flags = computeStoppStart({ drugs: ['amitriptyline 10mg'], problems: [], ageYears: 50, egfr: null });
  assert(!find(flags, 'stopp-anticholinergic-elderly'), 'anticholinergic-elderly does NOT fire at age 50');
}
{
  // Age unknown → fail-closed
  const flags = computeStoppStart({ drugs: ['amitriptyline 10mg'], problems: [], ageYears: null, egfr: null });
  assert(!find(flags, 'stopp-anticholinergic-elderly'), 'anticholinergic-elderly does NOT fire when age unknown (fail-closed)');
}
{
  // Score-1 drug only (digoxin, ACB 1) at age 70 → does NOT fire (below burden threshold)
  const flags = computeStoppStart({ drugs: ['digoxin 125 micrograms'], problems: [], ageYears: 70, egfr: null });
  assert(!find(flags, 'stopp-anticholinergic-elderly'), 'anticholinergic-elderly does NOT fire for ACB score-1 drug only');
}

// ── START 13: MI + no beta-blocker ────────────────────────────────────────
console.log('\n--- START 13: MI + no beta-blocker ---');
{
  const flags = computeStoppStart({
    drugs: ['aspirin 75mg', 'atorvastatin 40mg', 'ramipril 5mg'],
    problems: [{ name: 'myocardial infarction' }],
    ageYears: 65,
    egfr: null,
  });
  const f = find(flags, 'start_bb_post_mi');
  assert(!!f, 'START 13 fires: MI coded + no beta-blocker');
  assert(f.kind === 'start', 'START 13 kind = start');
  assert(f.severity === 'amber', 'START 13 severity = amber');
}
{
  // Beta-blocker present → no flag
  const flags = computeStoppStart({
    drugs: ['bisoprolol 5mg', 'atorvastatin 40mg'],
    problems: [{ name: 'myocardial infarction' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_bb_post_mi'), 'START 13 does NOT fire: beta-blocker present');
}
{
  // No MI problem → no flag
  const flags = computeStoppStart({
    drugs: ['atorvastatin 40mg'],
    problems: [{ name: 'hypertension' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_bb_post_mi'), 'START 13 does NOT fire: no MI problem');
}

// ── Negative control: clean drug list → no flags ──────────────────────────
console.log('\n--- Negative control: clean patient ---');
{
  const flags = computeStoppStart({
    drugs: ['atorvastatin 40mg', 'ramipril 5mg', 'aspirin 75mg'],
    problems: [{ name: 'ischaemic heart disease' }, { name: 'hypertension' }],
    ageYears: 60,
    egfr: 75,
  });
  // aspirin+IHD → no primary-prevention flag; statin present → no START 11
  assert(!find(flags, 'stopp_aspirin_primary_prev'), 'Clean: aspirin+IHD → no primary-prevention flag');
  assert(!find(flags, 'start_statin_ihd'), 'Clean: statin present → no START 11');
  assert(!find(flags, 'stopp_nsaid_ckd'), 'Clean: no NSAID → no STOPP 1');
}

// ── Flag structure ────────────────────────────────────────────────────────
console.log('\n--- Flag structure ---');
{
  const flags = computeStoppStart({ drugs: ['ibuprofen'], problems: [], ageYears: 70, egfr: 40 });
  const f = flags[0];
  assert(typeof f.id === 'string', 'flag has id');
  assert(f.kind === 'stopp' || f.kind === 'start', 'flag has kind');
  assert(typeof f.criterion === 'string', 'flag has criterion');
  assert(typeof f.detail === 'string', 'flag has detail');
  assert(f.severity === 'red' || f.severity === 'amber', 'flag has valid severity');
  assert(typeof f.source === 'string' && f.source.length > 0, 'flag has source');
  assert(f.source.includes('STOPP/START v3'), 'source cites STOPP/START v3');
}

// ── 2026-07-11 Keeper: BENZO_TERMS additions (loprazolam, lormetazepam) ──────
console.log('\n--- 2026-07-11 Keeper: BENZO_TERMS additions ---');
{
  const flags = computeStoppStart({ drugs: ['loprazolam 1mg tablets'], problems: [], ageYears: 70, egfr: null });
  assert(!!find(flags, 'stopp_benzo_elderly'), 'STOPP 4 fires: loprazolam (UK benzo) + age 70');
}
{
  const flags = computeStoppStart({ drugs: ['lormetazepam 1mg tablets'], problems: [], ageYears: 72, egfr: null });
  assert(!!find(flags, 'stopp_benzo_elderly'), 'STOPP 4 fires: lormetazepam (UK benzo) + age 72');
}

// ── 2026-07-11 Keeper: STATIN_TERMS addition (pitavastatin) ───────────────
console.log('\n--- 2026-07-11 Keeper: STATIN_TERMS addition (pitavastatin) ---');
{
  // Pitavastatin present → no START 11 (IHD + statin is satisfied)
  const flags = computeStoppStart({
    drugs: ['pitavastatin 2mg tablets'],
    problems: [{ name: 'ischaemic heart disease' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_statin_ihd'), 'pitavastatin recognised as statin: START 11 suppressed');
}

// ── 2026-07-11 Keeper: BETA_BLOCKER_TERMS additions ──────────────────────
console.log('\n--- 2026-07-11 Keeper: BETA_BLOCKER_TERMS additions ---');
{
  const flags = computeStoppStart({
    drugs: ['acebutolol 200mg capsules'],
    problems: [{ name: 'myocardial infarction' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_bb_post_mi'), 'acebutolol recognised as beta-blocker: START 13 suppressed');
}
{
  const flags = computeStoppStart({
    drugs: ['celiprolol 200mg tablets'],
    problems: [{ name: 'myocardial infarction' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_bb_post_mi'), 'celiprolol recognised as beta-blocker: START 13 suppressed');
}
{
  const flags = computeStoppStart({
    drugs: ['nadolol 40mg tablets'],
    problems: [{ name: 'myocardial infarction' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_bb_post_mi'), 'nadolol recognised as beta-blocker: START 13 suppressed');
}
{
  const flags = computeStoppStart({
    drugs: ['oxprenolol 40mg tablets'],
    problems: [{ name: 'myocardial infarction' }],
    ageYears: 65,
    egfr: null,
  });
  assert(!find(flags, 'start_bb_post_mi'), 'oxprenolol recognised as beta-blocker: START 13 suppressed');
}

// ── 2026-07-11 Keeper: FIRSTGEN_AH_TERMS additions (alimemazine, trimeprazine) ─
console.log('\n--- 2026-07-11 Keeper: FIRSTGEN_AH_TERMS additions ---');
{
  const flags = computeStoppStart({ drugs: ['alimemazine 7.5mg syrup'], problems: [], ageYears: 70, egfr: null });
  assert(!!find(flags, 'stopp_firstgen_ah_elderly'), 'STOPP 3 fires: alimemazine + age 70');
}
{
  const flags = computeStoppStart({ drugs: ['trimeprazine 30mg'], problems: [], ageYears: 66, egfr: null });
  assert(!!find(flags, 'stopp_firstgen_ah_elderly'), 'STOPP 3 fires: trimeprazine + age 66');
}

// ── 2026-07-25 Keeper: NSAID_TERMS celebrex, LOOP_DIURETIC_TERMS torasemide, FIRSTGEN_AH brompheniramine ─
console.log('\n--- 2026-07-25 Keeper: NSAID celebrex, loop diuretic torasemide, firstgen-AH brompheniramine ---');
{
  // celebrex is the Pfizer brand of celecoxib; not a substring of 'celecoxib', must be listed explicitly
  const flags = computeStoppStart({ drugs: ['Celebrex 200mg capsules'], problems: ['chronic kidney disease stage 3'], ageYears: 72, egfr: 45 });
  assert(!!find(flags, 'stopp_nsaid_ckd'), 'STOPP 1 fires: Celebrex (celecoxib brand) + CKD — celebrex recognised as NSAID');
}
{
  // torasemide is a BNF 2.2.2 loop diuretic, brand Torem; LOOP_DIURETIC_TERMS feeds stopp_nsaid_loop (NSAID+loop diuretic combo)
  const flags = computeStoppStart({ drugs: ['ibuprofen 400mg', 'torasemide 5mg tablets'], problems: [], ageYears: 78, egfr: null });
  assert(!!find(flags, 'stopp_nsaid_loop'), 'STOPP nsaid_loop fires: ibuprofen + torasemide — torasemide recognised as loop diuretic');
}
{
  // brompheniramine: first-gen sedating AH, must fire STOPP_3 in older patients
  const flags = computeStoppStart({ drugs: ['brompheniramine 4mg tablets'], problems: [], ageYears: 68, egfr: null });
  assert(!!find(flags, 'stopp_firstgen_ah_elderly'), 'STOPP 3 fires: brompheniramine + age 68 — brompheniramine recognised as first-gen AH');
}

// ── 2026-08-22 Keeper: START H4 — bone protection in osteoporosis ─────────
console.log('\n--- 2026-08-22 Keeper: START H4 bone protection (osteoporosis / fragility fracture) ---');
{
  const flags = computeStoppStart({
    drugs: ['amlodipine 5mg'],
    problems: [{ name: 'osteoporosis' }],
    ageYears: 78,
    egfr: null,
  });
  const f = find(flags, 'start_bone_protection_osteoporosis');
  assert(!!f, 'START H4 fires: coded osteoporosis + no bone therapy');
  assert(f.kind === 'start', 'START H4 kind = start');
  assert(f.severity === 'amber', 'START H4 severity = amber');
  assert(f.detail.includes('clinic-administered'), 'START H4 detail notes clinic-administered denosumab/IV zoledronate');
  assert(f.detail.includes('life expectancy'), 'START H4 detail notes poor-life-expectancy exemption');
}
{
  // Alendronic acid present → no flag ('alendron' stem covers acid + alendronate)
  const flags = computeStoppStart({
    drugs: ['alendronic acid 70mg tablets'],
    problems: [{ name: 'osteoporosis' }],
    ageYears: 78,
    egfr: null,
  });
  assert(!find(flags, 'start_bone_protection_osteoporosis'), 'START H4 does NOT fire: alendronic acid present');
}
{
  // Fragility-fracture coding fires too
  const flags = computeStoppStart({
    drugs: [],
    problems: [{ name: 'fragility fracture of neck of femur' }],
    ageYears: 82,
    egfr: null,
  });
  assert(!!find(flags, 'start_bone_protection_osteoporosis'), 'START H4 fires: fragility fracture coded');
}
{
  // Negation-aware matcher: FH is not the disease → no flag
  const flags = computeStoppStart({
    drugs: [],
    problems: [{ name: 'family history of osteoporosis' }],
    ageYears: 60,
    egfr: null,
  });
  assert(!find(flags, 'start_bone_protection_osteoporosis'), 'START H4 does NOT fire: family history of osteoporosis (negated)');
}
{
  // 'history of fragility fracture' is NOT treated as negation — H4 targets
  // exactly that history (pure-history cues deliberately omitted from the matcher)
  const flags = computeStoppStart({
    drugs: [],
    problems: [{ name: 'history of fragility fracture' }],
    ageYears: 82,
    egfr: null,
  });
  assert(!!find(flags, 'start_bone_protection_osteoporosis'), 'START H4 fires: history of fragility fracture (history IS the indication)');
}
{
  // Bare traumatic 'fracture' and 'osteopenia' deliberately do NOT gate
  const flags = computeStoppStart({
    drugs: [],
    problems: [{ name: 'fracture of radius' }, { name: 'osteopenia' }],
    ageYears: 70,
    egfr: null,
  });
  assert(
    !find(flags, 'start_bone_protection_osteoporosis'),
    'START H4 does NOT fire: traumatic fracture / osteopenia only (deliberate term exclusions)'
  );
}

// ── 2026-08-22 Keeper: START H2 — bone protection with corticosteroid ─────
console.log('\n--- 2026-08-22 Keeper: START H2 bone protection (corticosteroid, degraded) ---');
{
  const flags = computeStoppStart({ drugs: ['prednisolone 5mg tablets'], problems: [], ageYears: 70, egfr: null });
  const f = find(flags, 'start_bone_protection_steroid');
  assert(!!f, 'START H2 fires: prednisolone + no bone therapy + no calcium/vit D');
  assert(f.kind === 'start', 'START H2 kind = start');
  assert(f.severity === 'amber', 'START H2 severity = amber');
  assert(f.detail.includes('snapshot'), 'START H2 detail carries snapshot duration caveat');
  assert(f.detail.includes('≥3 months'), 'START H2 detail states the ≥3-month course qualifier');
}
{
  // Calcium/vit D present → no flag ('adcal' covers Adcal-D3)
  const flags = computeStoppStart({
    drugs: ['prednisolone 5mg tablets', 'Adcal-D3 caplets'],
    problems: [],
    ageYears: 70,
    egfr: null,
  });
  assert(!find(flags, 'start_bone_protection_steroid'), 'START H2 does NOT fire: Adcal-D3 co-prescribed');
}
{
  // Bone therapy present → no flag
  const flags = computeStoppStart({
    drugs: ['prednisolone 5mg tablets', 'alendronic acid 70mg tablets'],
    problems: [],
    ageYears: 70,
    egfr: null,
  });
  assert(!find(flags, 'start_bone_protection_steroid'), 'START H2 does NOT fire: alendronic acid co-prescribed');
}
{
  // Hydrocortisone cream deliberately not a trigger (topical substring;
  // documented limitation: oral Addisonian replacement is also missed)
  const flags = computeStoppStart({ drugs: ['hydrocortisone 1% cream'], problems: [], ageYears: 70, egfr: null });
  assert(!find(flags, 'start_bone_protection_steroid'), 'START H2 does NOT fire: hydrocortisone cream (deliberate exclusion)');
}

// ── 2026-08-22 Keeper: STOPP L2/START K2 — opioid without laxative ────────
console.log('\n--- 2026-08-22 Keeper: STOPP L2/START K2 opioid without laxative ---');
{
  const flags = computeStoppStart({ drugs: ['Zomorph 30mg capsules'], problems: [], ageYears: 75, egfr: null });
  const f = find(flags, 'stopp_opioid_no_laxative');
  assert(!!f, 'STOPP L2 fires: Zomorph + no laxative');
  assert(f.kind === 'stopp', 'STOPP L2 kind = stopp');
  assert(f.severity === 'amber', 'STOPP L2 severity = amber');
  assert(f.detail.includes('PRN'), 'STOPP L2 detail carries the regular-vs-PRN caveat');
}
{
  const flags = computeStoppStart({
    drugs: ['Zomorph 30mg capsules', 'senna 7.5mg tablets'],
    problems: [],
    ageYears: 75,
    egfr: null,
  });
  assert(!find(flags, 'stopp_opioid_no_laxative'), 'STOPP L2 does NOT fire: Zomorph + senna');
}
{
  // Targinact (oxycodone/naloxone): 'naloxone' in LAXATIVE_TERMS self-covers
  const flags = computeStoppStart({
    drugs: ['Targinact 10mg/5mg (oxycodone/naloxone) prolonged-release tablets'],
    problems: [],
    ageYears: 75,
    egfr: null,
  });
  assert(!find(flags, 'stopp_opioid_no_laxative'), 'STOPP L2 does NOT fire: Targinact (naloxone self-cover)');
}
{
  // Weak opioid co-codamol: DELIBERATELY excluded in v1 (false-positive control)
  const flags = computeStoppStart({ drugs: ['co-codamol 8/500 tablets'], problems: [], ageYears: 75, egfr: null });
  assert(!find(flags, 'stopp_opioid_no_laxative'), 'STOPP L2 does NOT fire: co-codamol (weak-opioid exclusion pinned as deliberate)');
}
{
  // Tramadol IS in STRONG_OPIOID_TERMS (deliberate — regular use constipates)
  const flags = computeStoppStart({ drugs: ['tramadol 50mg capsules'], problems: [], ageYears: 60, egfr: null });
  assert(!!find(flags, 'stopp_opioid_no_laxative'), 'STOPP L2 fires: tramadol (included, pinned as deliberate)');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
