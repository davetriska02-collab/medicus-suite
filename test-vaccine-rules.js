// Medicus Suite — Vaccine rules expansion tests
// Run with: node test-vaccine-rules.js
//
// Tests: schedule:"once" engine support; declined-before-given bug fix;
// bornOnOrAfter eligibility gate; new PPV23, shingles, RSV rules.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const vaxRules = require(path.join(__dirname, 'rules', 'vaccine-rules.json'));
const qofRules = require(path.join(__dirname, 'rules', 'qof-rules.json'));

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

const NOW = '2026-06-10'; // June — mid-summer, outside any seasonal campaign

// Helpers
function patient(age, dob) {
  return { patientContext: { ageYears: age, dob: dob || null } };
}
function withProblems(base, problems) {
  return { ...base, problems, observations: [], medications: [], observationHistory: [], _registerLookup: {} };
}
function withObservations(base, observations) {
  return { ...base, observations, problems: [], medications: [], observationHistory: [], _registerLookup: {} };
}
function baseData(age, dob) {
  return {
    patientContext: { ageYears: age, dob: dob || null },
    problems: [],
    observations: [],
    medications: [],
    observationHistory: [],
    _registerLookup: {},
  };
}

// Fetch rules from file.
const fluRule = vaxRules.rules.find((r) => r.id === 'vax-flu');
const ppv23Rule = vaxRules.rules.find((r) => r.id === 'vax-pneumo-ppv23');
const shinglesRule = vaxRules.rules.find((r) => r.id === 'vax-shingles');
const rsvRule = vaxRules.rules.find((r) => r.id === 'vax-rsv');
const pneumoRiskRule = vaxRules.rules.find((r) => r.id === 'vax-pneumo-risk-u65');
const shinglesImmunoRule = vaxRules.rules.find((r) => r.id === 'vax-shingles-immuno');

// ── Rule presence checks ───────────────────────────────────────────────────────
console.log('\n--- rule presence ---');
assert(!!ppv23Rule, 'vax-pneumo-ppv23 rule found');
assert(!!shinglesRule, 'vax-shingles rule found');
assert(!!rsvRule, 'vax-rsv rule found');
assert(!!pneumoRiskRule, 'vax-pneumo-risk-u65 rule found');
assert(!!shinglesImmunoRule, 'vax-shingles-immuno rule found');
assert(ppv23Rule?.enabled === true, 'vax-pneumo-ppv23 enabled');
assert(shinglesRule?.enabled === true, 'vax-shingles enabled');
assert(rsvRule?.enabled === true, 'vax-rsv enabled');
assert(pneumoRiskRule?.enabled === true, 'vax-pneumo-risk-u65 enabled');
assert(shinglesImmunoRule?.enabled === true, 'vax-shingles-immuno enabled');

// ── schedule:"once" engine behaviour ─────────────────────────────────────────
console.log('\n--- schedule:once engine behaviour ---');

// Given event 3 years ago → vax_given (not re-flagged DUE)
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Pneumococcal vaccination given', codedDate: '2023-01-15', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23: chip produced when given 3 years ago');
  assert(chips[0].status === 'vax_given', 'PPV23: given 3 years ago → vax_given (not re-flagged)');
}

// No event ever → vax_due
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(70), NOW);
  assert(chips.length === 1, 'PPV23: chip when no event ever (age 70)');
  assert(chips[0].status === 'vax_due', 'PPV23: no event ever → vax_due');
}

// Declined ever → vax_declined
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Pneumococcal vaccination declined', codedDate: '2024-03-01', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23: chip when declined');
  assert(chips[0].status === 'vax_declined', 'PPV23: declined → vax_declined');
}

// seasonLabel should be 'one-off' for schedule:once
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(70), NOW);
  assert(chips[0]?.seasonLabel === 'one-off', `PPV23: seasonLabel === 'one-off' (got: ${chips[0]?.seasonLabel})`);
}

// Fires in June (no out-of-campaign suppression for one-off rules)
{
  const juneNow = '2026-06-15';
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(70), juneNow);
  assert(chips.length === 1, 'PPV23: fires in June (no campaign suppression for once)');
}

// ── Declined-before-given regression (clinical safety fix) ───────────────────
console.log('\n--- declined-before-given regression ---');
{
  // "Influenza vaccination declined" contains "flu vaccin" — must be declined, not given.
  const data = {
    ...baseData(70),
    problems: [{ label: 'Influenza vaccination declined', codedDate: '2025-10-01', status: 'active' }],
  };
  // Use a custom rule that exactly replicates flu's stem term risk.
  const testFluRule = {
    id: 'test-flu-declined',
    type: 'vaccine',
    enabled: true,
    vaccine: 'flu',
    displayName: 'Flu vaccine',
    season: { startMonth: 9, startDay: 1, endMonth: 3, endDay: 31 },
    source: 'test',
    eligibility: { anyOf: [{ kind: 'age', ageMin: 65, label: 'Age 65+' }] },
    statusTerms: {
      given: ['influenza vaccination given', 'influenza vaccine given', 'flu vaccin', 'seasonal influenza vaccin'],
      declined: ['influenza vaccination declined', 'flu vaccine declined', 'influenza immunisation declined'],
    },
  };
  // Oct (in campaign)
  const chips = engine.evaluateVaccineRule(testFluRule, data, '2025-10-15');
  assert(chips.length === 1, 'flu declined: chip produced in campaign');
  assert(
    chips[0].status === 'vax_declined',
    `flu declined: "Influenza vaccination declined" → vax_declined, not vax_given (got: ${chips[0]?.status})`
  );
}

// Real flu rule with "Flu vaccine declined" coded label.
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Flu vaccine declined', codedDate: '2025-10-01', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(fluRule, data, '2025-10-15');
  assert(chips.length === 1, 'real flu rule: chip in Oct');
  assert(
    chips[0].status === 'vax_declined',
    `real flu rule: "Flu vaccine declined" → vax_declined (got: ${chips[0]?.status})`
  );
}

// ── PPV23 eligibility ─────────────────────────────────────────────────────────
console.log('\n--- PPV23 eligibility ---');

// Age 64 → no chip
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(64), NOW);
  assert(chips.length === 0, 'PPV23: age 64 → no chip');
}

// Age 65 → chip
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(65), NOW);
  assert(chips.length === 1, 'PPV23: age 65 → chip');
}

// "Pneumovax 23" coded → given
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Pneumovax 23 given', codedDate: '2021-05-01', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23: chip with Pneumovax 23 coded');
  assert(chips[0].status === 'vax_given', 'PPV23: "Pneumovax 23 given" → vax_given');
}

// ── Shingles eligibility ──────────────────────────────────────────────────────
console.log('\n--- Shingles eligibility ---');

// Age 72 → eligible (70-79 cohort)
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(72, '1953-06-01'), NOW);
  assert(chips.length === 1, 'Shingles: age 72 → eligible via 70-79 cohort');
}

// Age 69, dob 1957-01-01 (born before 1958-09-01 cutoff) → no chip
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(69, '1957-01-01'), NOW);
  assert(chips.length === 0, 'Shingles: age 69 dob 1957-01-01 → no chip (before phased cohort cutoff)');
}

// Age 66, dob 1959-06-01 (born after 1958-09-01) → eligible via phased cohort
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(66, '1959-06-01'), NOW);
  assert(chips.length === 1, 'Shingles: age 66 dob 1959-06-01 → eligible via phased cohort');
  assert(
    chips[0].eligibilityReason && chips[0].eligibilityReason.includes('phased'),
    `Shingles: eligibility label mentions 'phased' (got: ${chips[0]?.eligibilityReason})`
  );
}

// Age 66, dob missing → no chip (fail-closed bornOnOrAfter clause), but 70-79 clause doesn't apply either
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(66, null), NOW);
  assert(chips.length === 0, 'Shingles: age 66 dob missing → no chip (fail-closed)');
}

// Age 72, dob missing → still eligible via 70-79 clause (no bornOnOrAfter gate on that clause)
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(72, null), NOW);
  assert(chips.length === 1, 'Shingles: age 72 dob missing → still eligible via 70-79 clause');
}

// Age 80 → no chip (outside 70-79 range and not in 65-69 range)
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(80, '1946-01-01'), NOW);
  assert(chips.length === 0, 'Shingles: age 80 → no chip');
}

// ── RSV eligibility ───────────────────────────────────────────────────────────
console.log('\n--- RSV eligibility ---');

// Age 74 → no chip
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(74), NOW);
  assert(chips.length === 0, 'RSV: age 74 → no chip');
}

// Age 75 → chip
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(75), NOW);
  assert(chips.length === 1, 'RSV: age 75 → chip');
  assert(chips[0].status === 'vax_due', 'RSV: age 75 no event → vax_due');
}

// Age 79 → chip (75+)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(79), NOW);
  assert(chips.length === 1, 'RSV: age 79 → chip');
}

// Age 80 → chip (eligibility expanded to 75+ from 1 April 2026 — upper bound removed)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(80), NOW);
  assert(chips.length === 1, 'RSV: age 80 → chip (75+ expansion, 2026)');
}

// Age 90 → chip (no upper bound)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(90), NOW);
  assert(chips.length === 1, 'RSV: age 90 → chip (no upper bound)');
}

// Care-home resident under 75 → chip (care-home cohort added 2026)
{
  const data = { ...baseData(68), problems: [{ label: 'Care home resident', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 1, 'RSV: care-home resident (age 68) → chip');
}

// ── 2026-08-18 Keeper: RSV 65–74 clinical-risk (effective 1 Sept 2026) ────────
console.log('\n--- RSV 65-74 clinical-risk (vax-001, 2026-08-18) ---');

// Age 70 + COPD → eligible
{
  const data = { ...baseData(70), problems: [{ label: 'COPD', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 1, 'RSV: age 70 + COPD → chip');
  assert(
    chips[0].eligibilityReason && /chronic respiratory|65/i.test(chips[0].eligibilityReason),
    `RSV: age 70 + COPD eligibility mentions 65–74 respiratory (got: ${chips[0]?.eligibilityReason})`
  );
}

// Age 70, no clinical-risk problem → still no chip (age-only 75+ holds)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(70), NOW);
  assert(chips.length === 0, 'RSV: age 70 without clinical-risk → no chip');
}

// Age 70 + well-controlled asthma → must NOT fire (bare asthma omitted on purpose)
{
  const data = { ...baseData(70), problems: [{ label: 'Asthma', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 0, 'RSV: age 70 + asthma only → no chip (poorly-controlled asthma not encoded)');
}

// Age 64 + COPD → too young for the 65–74 band
{
  const data = { ...baseData(64), problems: [{ label: 'COPD', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 0, 'RSV: age 64 + COPD → no chip');
}

// Age 70 + lymphoma → immunosuppression problem
{
  const data = { ...baseData(70), problems: [{ label: 'Non-Hodgkin lymphoma', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 1, 'RSV: age 70 + lymphoma → chip');
}

// Age 70 + mycophenolate (no coded problem) → immunosuppression medication
{
  const data = { ...baseData(70), medications: [{ name: 'Mycophenolate mofetil 500mg tablets' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 1, 'RSV: age 70 + mycophenolate → chip');
}

// Age 80 + COPD still eligible via the age-75+ clause (not only the 65–74 band)
{
  const data = { ...baseData(80), problems: [{ label: 'COPD', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 1, 'RSV: age 80 + COPD → still chip via 75+');
}

// ── 2026-08-22 Keeper gap run: PCV20 clinical risk groups 2–64 (gap 5) ────────
console.log('\n--- pneumococcal clinical-risk under-65 (vax-pneumo-risk-u65, 2026-08-22) ---');

// Real DM register rule from qof-rules.json — the register clause resolves
// register codes via data._registerLookup.
const dmRegRule = qofRules.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'DM');
assert(!!dmRegRule, 'DM register rule found in qof-rules.json (register clause dependency)');

// Age 40 + splenectomy → fires (asplenia problem clause)
{
  const data = { ...baseData(40), problems: [{ label: 'Splenectomy', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 1, 'pneumo-risk: age 40 + splenectomy → chip');
  assert(chips[0]?.status === 'vax_due', 'pneumo-risk: age 40 + splenectomy, no event → vax_due');
}

// Age 40, no risk factors → no chip
{
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, baseData(40), NOW);
  assert(chips.length === 0, 'pneumo-risk: age 40 no risk factors → no chip');
}

// Age 50 + DM-register problem → fires via the register clause
{
  const data = {
    ...baseData(50),
    problems: [{ label: 'Type 2 diabetes mellitus', status: 'active' }],
    _registerLookup: { DM: dmRegRule },
  };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 1, 'pneumo-risk: age 50 + DM register → chip (register clause)');
}

// Age 70 + DM-register problem → must NOT fire (ageMax 64 on the register
// clause — pins the engine register-branch age-gate patch; the 65+ cohort is
// vax-pneumo-ppv23's, never a double fire).
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Type 2 diabetes mellitus', status: 'active' }],
    _registerLookup: { DM: dmRegRule },
  };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 0, 'pneumo-risk: age 70 + DM register → no chip (register-clause age gate)');
}

// Age 40 + methotrexate → fires (immunosuppressive medication clause)
{
  const data = { ...baseData(40), medications: [{ name: 'Methotrexate 2.5mg tablets' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 1, 'pneumo-risk: age 40 + methotrexate → chip (medication clause)');
}

// Age 40 + topical tacrolimus (Protopic ointment) → does NOT fire. CKS: topical
// tacrolimus "has not been observed to produce systemic concentrations similar
// to those observed with systemic use" — the immunosuppression eligibility
// clause must not treat it the same as the oral/IV form.
{
  const data = { ...baseData(40), medications: [{ name: 'Tacrolimus 0.1% ointment' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 0, 'pneumo-risk: age 40 + topical tacrolimus ointment → NO chip');
}
{
  const data = { ...baseData(40), medications: [{ name: 'Protopic 0.03% ointment' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 0, 'pneumo-risk: age 40 + Protopic (topical-only brand) → NO chip');
}
{
  const data = { ...baseData(40), medications: [{ name: 'Tacrolimus 0.1% cream' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 0, 'pneumo-risk: age 40 + tacrolimus cream special → NO chip');
}
// Oral/IV tacrolimus for the same age must still fire — only the topical form is excluded.
{
  const data = { ...baseData(40), medications: [{ name: 'Tacrolimus 1mg capsules' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 1, 'pneumo-risk: age 40 + oral tacrolimus capsules → chip (still systemic immunosuppression)');
}
{
  const data = { ...baseData(40), medications: [{ name: 'Tacrolimus 5mg/1ml concentrate for solution for infusion' }] };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 1, 'pneumo-risk: age 40 + IV tacrolimus infusion → chip (still systemic immunosuppression)');
}

// Infant PCV13 record must NOT suppress a 40-year-old asplenic's due status
// ('pneumococcal conjugate vaccin' deliberately absent from this rule's given list).
{
  const data = {
    ...baseData(40),
    problems: [
      { label: 'Splenectomy', status: 'active' },
      { label: 'Pneumococcal conjugate vaccination', codedDate: '1987-03-01', status: 'active' },
    ],
  };
  const chips = engine.evaluateVaccineRule(pneumoRiskRule, data, NOW);
  assert(chips.length === 1, 'pneumo-risk: infant PCV13 record → chip still produced');
  assert(
    chips[0]?.status === 'vax_due',
    `pneumo-risk: infant PCV13 record does not satisfy the rule → vax_due (got: ${chips[0]?.status})`
  );
}

// ── 2026-08-22 Keeper gap run: Shingrix severely immunosuppressed 18+ (gap 9) ─
console.log('\n--- shingles severely immunosuppressed 18+ (vax-shingles-immuno, 2026-08-22) ---');

// Age 45 + lymphoma → fires (disease clause)
{
  const data = { ...baseData(45), problems: [{ label: 'Non-Hodgkin lymphoma', status: 'active' }] };
  const chips = engine.evaluateVaccineRule(shinglesImmunoRule, data, NOW);
  assert(chips.length === 1, 'shingles-immuno: age 45 + lymphoma → chip');
  assert(chips[0]?.status === 'vax_due', 'shingles-immuno: age 45 + lymphoma, no event → vax_due');
}

// Age 45 + methotrexate only → must NOT fire (conservative severe-immunosuppression
// term list pinned as deliberate — no methotrexate/low-dose steroids).
{
  const data = { ...baseData(45), medications: [{ name: 'Methotrexate 2.5mg tablets' }] };
  const chips = engine.evaluateVaccineRule(shinglesImmunoRule, data, NOW);
  assert(chips.length === 0, 'shingles-immuno: age 45 + methotrexate only → no chip (conservative terms)');
}

// Age 82 + rituximab → fires (no upper age limit)
{
  const data = { ...baseData(82), medications: [{ name: 'Rituximab 500mg/50ml concentrate for solution for infusion' }] };
  const chips = engine.evaluateVaccineRule(shinglesImmunoRule, data, NOW);
  assert(chips.length === 1, 'shingles-immuno: age 82 + rituximab → chip (no upper limit)');
}

// Age 45 + lymphoma + Shingrix given → vax_given
{
  const data = {
    ...baseData(45),
    problems: [
      { label: 'Non-Hodgkin lymphoma', status: 'active' },
      { label: 'Shingrix vaccination given', codedDate: '2025-11-01', status: 'active' },
    ],
  };
  const chips = engine.evaluateVaccineRule(shinglesImmunoRule, data, NOW);
  assert(chips.length === 1, 'shingles-immuno: lymphoma + shingrix record → chip produced');
  assert(chips[0]?.status === 'vax_given', 'shingles-immuno: shingrix given → vax_given');
}

// Historic Zostavax must NOT satisfy this rule ('zostavax' deliberately absent
// from its given list — a Zostavax-given-then-immunosuppressed patient still
// needs Shingrix, so due is the fail-safe direction).
{
  const data = {
    ...baseData(45),
    problems: [
      { label: 'Non-Hodgkin lymphoma', status: 'active' },
      { label: 'Zostavax', codedDate: '2018-06-01', status: 'active' },
    ],
  };
  const chips = engine.evaluateVaccineRule(shinglesImmunoRule, data, NOW);
  assert(chips.length === 1, 'shingles-immuno: lymphoma + historic Zostavax → chip still produced');
  assert(
    chips[0]?.status === 'vax_due',
    `shingles-immuno: historic Zostavax does not satisfy the rule → vax_due (got: ${chips[0]?.status})`
  );
}

// ── Schema: source and notes required on new rules ───────────────────────────
console.log('\n--- new vaccine rules have non-empty source and notes ---');
[ppv23Rule, shinglesRule, rsvRule, pneumoRiskRule, shinglesImmunoRule].forEach((r) => {
  if (!r) return;
  assert(typeof r.source === 'string' && r.source.trim().length > 0, `${r.id}: has non-empty source`);
  assert(typeof r.notes === 'string' && r.notes.trim().length > 0, `${r.id}: has non-empty notes`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
