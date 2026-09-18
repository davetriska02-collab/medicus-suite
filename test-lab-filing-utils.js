// Medicus Suite — Lab Filing utilities tests
// Run with: node test-lab-filing-utils.js
//
// Covers validation/sanitisation (whitelist rebuild, prototype-pollution guard),
// the safety locks (lockForReview forces inert + message off; no 'auto' commit
// mode), analyte seeding, PHI heuristics, and that the LLM prompt's embedded
// example JSON actually validates against the schema it describes.

'use strict';

const LF = require('./shared/lab-filing-utils.js');

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

const validFiling = { normalOptionText: 'No action required', fileButtonText: 'File' };

// ── validateProfile ─────────────────────────────────────────────────────────────
console.log('--- validateProfile ---');
check(LF.validateProfile({ name: 'Local FBC', filing: validFiling }).length === 0, 'minimal valid profile passes');
check(LF.validateProfile(null).length > 0, 'null profile rejected');
check(LF.validateProfile({ filing: validFiling }).length > 0, 'missing name rejected');
check(LF.validateProfile({ name: 'x' }).length > 0, 'missing filing block rejected');
check(
  LF.validateProfile({ name: 'x', filing: { fileButtonText: 'File' } }).length > 0,
  'missing normalOptionText rejected'
);
check(
  LF.validateProfile({ name: 'x', filing: { normalOptionText: 'No action' } }).length > 0,
  'missing fileButtonText rejected'
);
check(
  LF.validateProfile({ name: 'x', filing: validFiling, id: '__proto__' }).length === 0 ? false : true,
  'prototype-pollution id shape rejected'
);
check(
  LF.validateProfile({ name: 'x', filing: validFiling, commitMode: 'auto' }).length > 0,
  "commitMode 'auto' rejected (no full-auto mode)"
);
check(
  LF.validateProfile({ name: 'x', filing: validFiling, commitMode: 'confirm' }).length === 0,
  "commitMode 'confirm' accepted"
);
check(
  LF.validateProfile({ name: 'x', filing: validFiling, match: ['fbc', 7] }).length > 0,
  'non-string match entry rejected'
);
check(LF.validateProfile({ name: 'x', filing: validFiling, source: 'chatgpt' }).length > 0, 'unknown source rejected');
check(
  LF.validateProfile({ name: 'x', filing: validFiling, patientMessage: { template: 'y'.repeat(600) } }).length > 0,
  'over-long message template rejected'
);

// ── sanitiseProfile ─────────────────────────────────────────────────────────────
console.log('\n--- sanitiseProfile ---');
const dirty = {
  name: '  City Hospital bloods  ',
  match: [' FBC ', '', 'x'.repeat(99)],
  filing: { normalOptionText: '  No action  ', fileButtonText: 'File', rowSelector: '.row', filingComment: 'ok' },
  patientMessage: { enabled: true, template: 'Dear {firstName}, normal.' },
  commitMode: 'auto',
  source: 'evil',
  enabled: 'yes',
  reviewed: 'yes',
  extraField: 'smuggled',
  __proto__: { polluted: true },
};
const clean = LF.sanitiseProfile(dirty);
check(clean.name === 'City Hospital bloods', 'trims name');
check(
  clean.match[0] === 'FBC' && clean.match[1].length === LF.LF_LIMITS.matchItem,
  'match trimmed and clamped, blanks dropped'
);
check(!('extraField' in clean), 'unknown fields not copied (whitelist rebuild)');
check(clean.commitMode === 'manual', "unknown/'auto' commitMode clamps to 'manual'");
check(clean.source === 'manual', 'unknown source → manual');
check(clean.enabled === false && clean.reviewed === false, 'non-boolean enabled/reviewed → false');
check(clean.filing.normalOptionText === 'No action', 'filing.normalOptionText trimmed');
check(typeof clean.updatedAt === 'string' && clean.updatedAt.includes('T'), 'updatedAt stamped');

// Prototype pollution via the REAL attack shape: JSON.parse creates an OWN
// enumerable "__proto__" key (an object-literal __proto__ would just set the
// prototype and prove nothing). Assert the whitelist rebuild leaves the global
// prototype clean and copies no dangerous key.
const jsonEvil = JSON.parse(
  '{"name":"x","filing":{"normalOptionText":"a","fileButtonText":"b","__proto__":{"pwn":1}},"__proto__":{"enabled":true,"reviewed":true,"pwn":1},"constructor":{"prototype":{"pwn":1}}}'
);
const jsonClean = LF.sanitiseProfile(jsonEvil);
check({}.pwn === undefined, 'JSON-parsed __proto__ does not pollute Object.prototype via sanitiseProfile');
check(
  jsonClean.enabled === false && jsonClean.reviewed === false,
  'inherited enabled/reviewed from __proto__ not adopted'
);
check(!Object.prototype.hasOwnProperty.call(jsonClean, '__proto__'), 'clean has no own __proto__ key');

// Over-length fields are REJECTED at validation, not silently truncated.
check(
  LF.validateProfile({ name: 'x', filing: { normalOptionText: 'a'.repeat(200), fileButtonText: 'File' } }).length > 0,
  'over-long normalOptionText rejected'
);
check(
  LF.validateProfile({ name: 'x', filing: { normalOptionText: 'a', fileButtonText: 'b'.repeat(200) } }).length > 0,
  'over-long fileButtonText rejected'
);
check(
  LF.validateProfile({ name: 'x', filing: validFiling, analytes: Array(400).fill('a') }).length > 0,
  'over-long analytes array rejected'
);

// ── lockForReview ─────────────────────────────────────────────────────────────
console.log('\n--- lockForReview ---');
const locked = LF.lockForReview(
  { name: 'X', filing: validFiling, enabled: true, reviewed: true, patientMessage: { enabled: true, template: 't' } },
  'llm'
);
check(locked.enabled === false, 'lockForReview forces enabled:false');
check(locked.reviewed === false, 'lockForReview forces reviewed:false');
check(locked.patientMessage.enabled === false, 'lockForReview forces patientMessage off');
check(locked.source === 'llm', 'lockForReview records source provenance');

// ── generateProfileId ───────────────────────────────────────────────────────────
console.log('\n--- generateProfileId ---');
const taken = new Set(['city-hospital-bloods']);
check(LF.generateProfileId('City Hospital bloods!', taken) === 'city-hospital-bloods-2', 'slug + collision suffix');
check(/^profile/.test(LF.generateProfileId('???', new Set())), 'unsluggable name falls back to "profile"');

// ── seedAnalytesFromResultRules ───────────────────────────────────────────────
console.log('\n--- seedAnalytesFromResultRules ---');
const rules = [
  { analyte: { match: ['Haemoglobin', 'hemoglobin'] } },
  { analyte: { match: ['Potassium'] } },
  { conditions: [{ analyte: { match: ['Sodium'] } }] },
  { kind: 'text', match: ['no growth'] }, // no analyte block → ignored
];
const seeded = LF.seedAnalytesFromResultRules(rules);
check(
  seeded.includes('haemoglobin') && seeded.includes('potassium') && seeded.includes('sodium'),
  'collects analyte match names from threshold + combo rules'
);
check(seeded.length === new Set(seeded).size, 'deduplicated');

// ── phiWarnings ───────────────────────────────────────────────────────────────
console.log('\n--- phiWarnings ---');
check(
  // phiWarnings flags by SHAPE (10 digits in 3-3-4), not Modulus-11, so this uses a
  // shape-valid but Modulus-11-INVALID number — still triggers the warning, but the
  // patient-data CI guard (which checks Modulus-11) correctly ignores it as non-data.
  LF.phiWarnings([{ name: 'p', filing: validFiling, patientMessage: { template: 'NHS 123 456 7890' } }]).length === 1,
  'NHS-number-shaped digits flagged'
);
check(
  LF.phiWarnings([{ name: 'p', filing: validFiling, notes: 'include the DOB' }]).length === 1,
  'DOB mention flagged'
);
check(
  LF.phiWarnings([{ name: 'p', filing: validFiling, patientMessage: { template: 'Dear {firstName}, all normal.' } }])
    .length === 0,
  'clean profile produces no warnings'
);

// ── filingProfilePrompt example round-trip ────────────────────────────────────
console.log('\n--- filingProfilePrompt ---');
const prompt = LF.filingProfilePrompt();
const m = prompt.match(/--- EXAMPLE JSON ---\n([\s\S]*?)\n--- END EXAMPLE ---/);
check(!!m, 'prompt contains delimited example JSON');
if (m) {
  let example = null;
  try {
    example = JSON.parse(m[1]);
  } catch (_) {}
  check(!!example && !Array.isArray(example) && typeof example === 'object', 'example is one object, not an array');
  check(
    !!example && LF.validateProfile(example).length === 0,
    'example validates against the schema the prompt describes'
  );
  check(
    !!example && (!example.patientMessage || example.patientMessage.enabled !== true),
    'example never ships the patient message pre-enabled'
  );
}
check(/Output ONLY a single valid JSON object/i.test(prompt), 'prompt demands one JSON object');
check(/NEVER include any patient details/i.test(prompt), 'prompt forbids patient details');
check(/VISIBLE TEXT/i.test(prompt), 'prompt insists on matching by visible text');
check(/SCREENSHOTS/i.test(prompt), 'prompt is screenshot-driven');
check(/arrives DISABLED/i.test(prompt), 'prompt states profiles arrive disabled pending review');
check(!/\bauto\b/i.test(prompt) || !/commitMode/i.test(prompt), 'prompt does not offer a full-auto mode');

// ── matchProfile ───────────────────────────────────────────────────────────────
console.log('\n--- matchProfile ---');
const fbcReport = {
  results: [
    { name: 'Haemoglobin', specimen: 'Full blood count' },
    { name: 'Sodium', specimen: 'U&E' },
  ],
};
const profiles = [
  { name: 'A', enabled: true, match: ['full blood count'], filing: validFiling },
  { name: 'B', enabled: true, match: ['full blood count', 'u&e'], filing: validFiling }, // more specific
  { name: 'C', enabled: true, match: ['lipids'], filing: validFiling },
  { name: 'D', enabled: false, match: ['full blood count', 'u&e', 'liver'], filing: validFiling }, // disabled
  { name: 'E', enabled: true, match: [], filing: validFiling }, // empty match never auto-fits
];
check(LF.matchProfile(profiles, fbcReport)?.name === 'B', 'picks the most specific ENABLED matching profile');
check(
  LF.matchProfile([{ name: 'E', enabled: true, match: [], filing: validFiling }], fbcReport) === null,
  'empty match[] never auto-fits'
);
check(
  LF.matchProfile(profiles, { results: [{ name: 'Cholesterol', specimen: 'Lipids' }] })?.name === 'C',
  'matches by specimen'
);
check(
  LF.matchProfile([{ name: 'D', enabled: false, match: ['full blood count'], filing: validFiling }], fbcReport) ===
    null,
  'disabled profile never fits'
);
check(LF.matchProfile(profiles, null) === null, 'no report → no match');

// ── matchProfiles / mergeProfilesForReport (multi-panel combined report) ──────
console.log('\n--- matchProfiles / mergeProfilesForReport ---');
// One task carrying three panels (Bone + U&E + LFT) under a single report.
const comboReport = {
  results: [
    { name: 'Calcium', value: 2.35 },
    { name: 'Phosphate', value: 1.2 },
    { name: 'Sodium', value: 140 },
    { name: 'Potassium', value: 4.1 },
    { name: 'Creatinine', value: 76 },
    { name: 'ALT', value: 20 },
  ],
};
const bone = {
  name: 'Bone',
  enabled: true,
  match: ['calcium', 'phosphate'],
  filing: validFiling,
  parameters: [{ analyte: 'calcium', low: 2.2, high: 2.6 }],
  requireRangeForAll: true,
  commitMode: 'confirm',
  trend: { maxDeltaPct: 30 },
  excludeIfMeds: ['lithium'],
};
const ue = {
  name: 'U&E',
  enabled: true,
  match: ['sodium', 'potassium', 'creatinine'],
  analytes: ['sodium', 'potassium', 'creatinine'],
  filing: validFiling,
  parameters: [{ analyte: 'creatinine', low: 49, high: 90 }],
  trend: { maxDeltaPct: 15 },
  excludeIfMeds: ['ramipril'],
  allowComments: ['insufficient historical creatinine data'],
};
const lft = { name: 'LFT', enabled: true, match: ['alt', 'bilirubin'], filing: validFiling, commitMode: 'manual' };
const all3 = [bone, ue, lft];
check(LF.matchProfiles(all3, comboReport).length === 3, 'matchProfiles returns every fitting profile');
check(LF.matchProfiles(all3, comboReport)[0].name === 'U&E', 'matchProfiles is most-specific-first (U&E: 3 hits)');
const merged = LF.mergeProfilesForReport(all3, comboReport);
check(merged && merged.effective._matchedCount === 3, 'merge records the matched count');
check(merged.effective.parameters.length === 2, 'merge unions every panel’s parameters');
check(merged.effective.requireRangeForAll === true, 'merge requireRangeForAll true if ANY matched profile sets it');
check(merged.effective.commitMode === 'confirm', 'merge commitMode is confirm if ANY matched profile is confirm');
check(merged.effective.trend.maxDeltaPct === 15, 'merge trend takes the STRICTEST (smallest positive) threshold');
check(
  merged.effective.excludeIfMeds.includes('lithium') && merged.effective.excludeIfMeds.includes('ramipril'),
  'merge unions excludeIfMeds across panels'
);
check(/3 profiles matched/.test(merged.effective.name), 'merged name reflects multi-panel');
check(
  merged.effective._matchedNames.join(',') === 'U&E,Bone,LFT',
  'merged carries the matched profile names (most-specific first) for the card'
);
check(
  merged.effective.allowComments.includes('insufficient historical creatinine data'),
  'merge unions allowComments across panels (bug fix 2026-09-16 — this used to be dropped entirely, so the live gate, which always scores through the merge, could never see it)'
);
// A single matched profile keeps its own name (not the "N profiles" label).
const single = LF.mergeProfilesForReport([ue], comboReport);
check(single.effective.name === 'U&E' && single.effective._matchedCount === 1, 'single match keeps its own name');
check(
  single.effective.allowComments.includes('insufficient historical creatinine data'),
  'a single-profile merge still carries allowComments through'
);
check(
  merged.effective.analytes.includes('sodium') &&
    merged.effective.analytes.includes('creatinine') &&
    merged.effective.analytes.includes('potassium'),
  "merge unions analytes across panels (bug fix 2026-09-17 — analytes was hardcoded to an empty array here, so unrecognisedAnalyteBlockers could never recognise anything from any profile through the live merge, which every real report scores through, even for a single matched profile)"
);
check(LF.mergeProfilesForReport([], comboReport) === null, 'no profiles → null merge');
check(
  LF.mergeProfilesForReport([{ name: 'x', enabled: false, match: ['sodium'] }], comboReport) === null,
  'disabled-only → null merge'
);

// ── extractFirstName / fillTemplate ───────────────────────────────────────────
console.log('\n--- extractFirstName / fillTemplate ---');
check(LF.extractFirstName('Smith, John') === 'John', 'handles "Surname, Firstname"');
check(LF.extractFirstName('Jane Doe') === 'Jane', 'handles "Firstname Surname"');
check(LF.extractFirstName('') === 'there', 'empty name falls back to "there"');
check(
  LF.fillTemplate('Dear {firstName}, all normal.', 'Smith, John') === 'Dear John, all normal.',
  'fills {firstName}'
);
check(LF.fillTemplate('Dear {firstName} {firstName}.', 'Jane Doe') === 'Dear Jane Jane.', 'fills repeated placeholder');

// ── parameters: validate + sanitise ──────────────────────────────────────────
console.log('\n--- parameters validate/sanitise ---');
const withParams = (params, extra) =>
  Object.assign({ name: 'x', filing: validFiling, parameters: params }, extra || {});
check(
  LF.validateProfile(withParams([{ analyte: 'hba1c', high: 47, unit: 'mmol/mol' }])).length === 0,
  'valid parameter row passes'
);
check(LF.validateProfile(withParams([{ analyte: 'hba1c' }])).length > 0, 'parameter with no low/high rejected');
check(LF.validateProfile(withParams([{ analyte: 'k', low: 5, high: 3 }])).length > 0, 'low > high rejected');
check(LF.validateProfile(withParams([{ analyte: 'k', high: 'NaN-ish' }])).length > 0, 'non-numeric bound rejected');
check(LF.validateProfile(withParams('nope')).length > 0, 'non-array parameters rejected');
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { requireRangeForAll: 'yes' })).length > 0,
  'non-boolean requireRangeForAll rejected'
);
const sp = LF.sanitiseProfile(
  withParams(
    [
      { analyte: ' HbA1c ', low: '', high: '47', unit: 'mmol/mol', junk: 1 },
      { analyte: '', high: 5 }, // dropped — no analyte
      { analyte: 'x' }, // dropped — no bound
    ],
    { requireRangeForAll: true }
  )
);
check(sp.parameters.length === 1, 'sanitise drops rows with no analyte or no bound');
check(
  sp.parameters[0].analyte === 'HbA1c' && sp.parameters[0].low === null && sp.parameters[0].high === 47,
  'sanitise trims analyte, coerces numeric strings, blanks → null'
);
check(!('junk' in sp.parameters[0]), 'sanitise whitelists parameter fields');
check(sp.requireRangeForAll === true, 'requireRangeForAll preserved');

// ── profileParamBlockers (clinician-set ranges, incl. un-ranged analytes) ─────
console.log('\n--- profileParamBlockers ---');
const hba1cProfile = { parameters: [{ analyte: 'hba1c', high: 47, unit: 'mmol/mol' }] };
const rep = (name, value, low, high, unit) => ({
  results: [{ name, value, low: low ?? null, high: high ?? null, unit: unit ?? null }],
});
// 2026-08-23 review fix: these fixtures used to omit the result unit while the
// parameter declares mmol/mol. A parameter that states a unit is no longer
// applied to a value whose unit cannot be confirmed, so the fixtures now carry
// the unit a real Medicus result reports.
check(
  LF.profileParamBlockers(rep('HbA1c (IFCC)', 42, null, null, 'mmol/mol'), hba1cProfile).length === 0,
  'HbA1c within set max → fileable'
);
check(
  LF.profileParamBlockers(rep('HbA1c (IFCC)', 53, null, null, 'mmol/mol'), hba1cProfile).some((r) =>
    /above your set maximum/.test(r)
  ),
  'HbA1c above set max → blocked (lab gave no range)'
);
// …and the same parameter against a value of UNKNOWN unit must refuse, not
// silently compare (the ug/L-range-vs-unitless-digoxin class).
check(
  LF.profileParamBlockers(rep('HbA1c (IFCC)', 42), hba1cProfile).some((r) => /units cannot be confirmed/.test(r)),
  'parameter declaring a unit + result with no unit → blocked, never silently compared'
);
check(
  LF.profileParamBlockers(rep('eGFR', 55), { parameters: [{ analyte: 'egfr', low: 60 }] }).some((r) =>
    /below your set minimum/.test(r)
  ),
  'eGFR below set min → blocked'
);
// 2026-08-22 audit R1c: requireRangeForAll now defaults ON (missing key = true),
// so the "no parameter → no param block" invariant is pinned with a lab range
// present; the same analyte with NO range now blocks by default.
check(
  LF.profileParamBlockers(rep('Sodium', 140, 133, 146), hba1cProfile).length === 0,
  'analyte with no parameter but a lab range is not blocked by params'
);
check(
  LF.profileParamBlockers(rep('Sodium', 140), hba1cProfile).some((r) => /no reference range/.test(r)),
  'analyte with no parameter and NO range blocks by default (fail closed)'
);
check(
  LF.profileParamBlockers(rep('Sodium', 140), { ...hba1cProfile, requireRangeForAll: false }).length === 0,
  'explicit requireRangeForAll:false restores the opt-out'
);
check(
  LF.profileParamBlockers(rep('HbA1c', 60, 20, 42), {}).length === 0,
  'no parameters and no requireRangeForAll → no param blockers'
);
// requireRangeForAll: a numeric result with no lab range and no parameter blocks
check(
  LF.profileParamBlockers(rep('HbA1c', 60), { requireRangeForAll: true }).some((r) => /no reference range/.test(r)),
  'requireRangeForAll blocks an un-ranged, un-parameterised result'
);
check(
  LF.profileParamBlockers(rep('Sodium', 140, 133, 146), { requireRangeForAll: true }).length === 0,
  'requireRangeForAll allows a result that has a lab reference range'
);

// ── applyParamOverrides ("my range wins" lab-flag override) ───────────────────
console.log('\n--- applyParamOverrides ---');
const egfrFlagged = () => ({
  results: [{ name: 'eGFRcreat (CKD-EPI)/1.73 m*2', value: 89, low: 90, high: 120, isBelow: true, isAbove: false }],
});
const egfrProfileOn = { paramsOverrideLabFlags: true, parameters: [{ analyte: 'egfr', low: 60 }] };
const egfrProfileOff = { paramsOverrideLabFlags: false, parameters: [{ analyte: 'egfr', low: 60 }] };
check(
  LF.applyParamOverrides(egfrFlagged(), egfrProfileOff).results[0].isBelow === true,
  'override OFF leaves the lab flag'
);
const adj = LF.applyParamOverrides(egfrFlagged(), egfrProfileOn);
check(adj.results[0].isBelow === false, 'override ON clears the lab below-flag for an in-your-range analyte');
check(adj.results[0]._labFlagOverridden === true, 'overridden result is marked for the confirm dialog');
check(egfrFlagged().results[0].isBelow === true, 'original report is not mutated by applyParamOverrides');
// urgent is sacrosanct
const urgentRep = { results: [{ name: 'egfr', value: 89, low: 90, isBelow: true, urgent: true }] };
check(
  LF.applyParamOverrides(urgentRep, egfrProfileOn).results[0].isBelow === true,
  'override NEVER clears an urgent result'
);
// value outside the clinician range keeps the flag
const egfrLow = { results: [{ name: 'egfr', value: 40, low: 90, isBelow: true }] };
check(
  LF.applyParamOverrides(egfrLow, egfrProfileOn).results[0].isBelow === true,
  'value outside your range keeps the lab flag'
);
// analyte with no parameter is untouched
const naFlagged = { results: [{ name: 'Sodium', value: 150, high: 146, isAbove: true }] };
check(
  LF.applyParamOverrides(naFlagged, egfrProfileOn).results[0].isAbove === true,
  'analyte with no parameter is left as the lab reported'
);

// Integration: the override + the real severity scorer → an eGFR-89 U&E becomes all-normal.
const SEV = require('./engine/result-severity.js');
const ueReport = {
  results: [
    { name: 'Sodium', value: 143, low: 133, high: 146, isAbove: false, isBelow: false },
    { name: 'Potassium', value: 3.8, low: 3.5, high: 5.3, isAbove: false, isBelow: false },
    { name: 'Creatinine', value: 62, low: 49, high: 90, isAbove: false, isBelow: false },
    { name: 'eGFRcreat (CKD-EPI)/1.73 m*2', value: 89, low: 90, high: 120, isBelow: true, isAbove: false },
  ],
};
const someRule = [{ analyte: { match: ['xyz'] }, comparator: 'above', amber: 999 }];
check(
  SEV.evaluateReportSeverity(ueReport, { resultRules: someRule }).level === 'amber',
  'raw U&E with eGFR 89 scores amber (lab flag) — would NOT be offered'
);
check(
  SEV.evaluateReportSeverity(LF.applyParamOverrides(ueReport, egfrProfileOn), { resultRules: someRule }).level ===
    'none',
  'with override, the same U&E scores none — now offerable'
);
// Confirm dialog is loud about the override.
const ovrMsg = LF.buildFilingConfirmMessage(ueReport, {
  name: 'U&E',
  paramsOverrideLabFlags: true,
  parameters: [{ analyte: 'egfr', low: 60 }],
  filing: { normalOptionText: 'Normal' },
});
check(
  /lab flagged low — accepted by your set range/.test(ovrMsg),
  'confirm dialog flags the lab-overridden analyte loudly'
);

// ── unrecognisedAnalyteBlockers (real-world regression, 2026-09-17) ───────────
// Nick: a CRP result — no profile of his names it at all — was OFFERED for
// filing alongside a genuinely-configured U&E panel sharing the same task
// (never actually filed; caught before the File click, but the offer itself
// was the gap). Root cause: a CRP result with its OWN lab-supplied reference
// range sails straight through profileParamBlockers's requireRangeForAll
// check (which only fires when there is NEITHER a parameter NOR a lab
// range) — nothing anywhere asked "did any profile actually declare this
// analyte?" This closes that gap.
console.log('\n--- unrecognisedAnalyteBlockers ---');
const ueWithCrpReport = {
  unmatched: false,
  results: [
    { name: 'Sodium', value: 140, low: 133, high: 146 },
    { name: 'Potassium', value: 4.1, low: 3.5, high: 5.3 },
    { name: 'CRP', value: 3, low: 0, high: 5 }, // in range, lab-ranged — no profile names it
  ],
};
const ueOnlyProfile = { name: 'U&E', analytes: ['sodium', 'potassium', 'creatinine'] };
check(
  LF.unrecognisedAnalyteBlockers(ueWithCrpReport, ueOnlyProfile).some((r) => /^CRP is not a recognised analyte/.test(r)),
  "an in-range, lab-ranged analyte no profile ever declared blocks filing, named by its own result label"
);
check(
  !LF.unrecognisedAnalyteBlockers(ueWithCrpReport, ueOnlyProfile).some((r) => /^Sodium/.test(r) || /^Potassium/.test(r)),
  'a genuinely-covered analyte is not flagged'
);
check(
  LF.unrecognisedAnalyteBlockers(
    ueWithCrpReport,
    Object.assign({}, ueOnlyProfile, { analytes: [...ueOnlyProfile.analytes, 'crp', 'c-reactive protein'] })
  ).length === 0,
  'adding the analyte to the profile (either short or long form) clears the block — token-anchored, not exact-string'
);
check(
  LF.unrecognisedAnalyteBlockers(ueWithCrpReport, { analytes: [] }).length === 3,
  "a profile with no declared analytes at all recognises NOTHING — fails closed, doesn't silently wave everything through"
);
check(
  LF.unrecognisedAnalyteBlockers(null, ueOnlyProfile).length === 0 &&
    LF.unrecognisedAnalyteBlockers(ueWithCrpReport, null).length === 0,
  'fails closed to an empty list on missing report/profile, never throws'
);

// ── fileabilityBlockers (fail-closed gate) ────────────────────────────────────
console.log('\n--- fileabilityBlockers ---');
const okReport = {
  unmatched: false,
  results: [{ name: 'Haemoglobin', value: 130, rawValue: '130', text: 'Haemoglobin 130' }],
};
const someRules = [{ id: 'r', enabled: true }];
check(
  LF.fileabilityBlockers(okReport, { level: 'none' }, someRules).length === 0,
  'all-numeric-normal matched report is fileable'
);
check(
  LF.fileabilityBlockers(okReport, { level: 'amber' }, someRules).some((r) => /within normal/.test(r)),
  'amber severity blocks'
);
check(
  LF.fileabilityBlockers({ unmatched: true, results: okReport.results }, { level: 'none' }, someRules).some((r) =>
    /matched to a patient/.test(r)
  ),
  'unmatched report blocks'
);
check(
  LF.fileabilityBlockers(okReport, { level: 'none' }, []).some((r) => /result rules/.test(r)),
  'empty resultRules blocks (cultures/thresholds uncheckable)'
);
const freeTextReport = {
  unmatched: false,
  results: [
    { name: 'Haemoglobin', value: 130, text: 'Hb 130' },
    { name: 'Blood film', value: NaN, text: 'Abnormal film - blast cells noted' },
  ],
};
check(
  LF.fileabilityBlockers(freeTextReport, { level: 'none' }, someRules).some(
    (r) => /free-text/.test(r) && /Blood film/.test(r)
  ),
  'free-text/non-numeric result blocks and is named'
);
check(LF.fileabilityBlockers({ results: [] }, { level: 'none' }, someRules).length > 0, 'empty results blocks');

// ── allowComments (per-profile comment allow-list) ────────────────────────────
console.log('\n--- allowComments ---');
const commentedReport = {
  unmatched: false,
  results: [
    {
      name: 'Creatinine',
      value: 61,
      unit: 'umol/L',
      rawValue: '61',
      text: 'Creatinine 61 umol/L See NICE NG203 ethnicity-based interpretation guidance',
    },
  ],
};
check(
  LF.fileabilityBlockers(commentedReport, { level: 'none' }, someRules).some((r) => /carries a comment/.test(r)),
  'un-benign comment blocks with no profile passed'
);
check(
  LF.fileabilityBlockers(commentedReport, { level: 'none' }, someRules, { allowComments: [] }).some((r) =>
    /carries a comment/.test(r)
  ),
  'un-benign comment blocks with a profile that has no allow-list entries'
);
check(
  LF.fileabilityBlockers(commentedReport, { level: 'none' }, someRules, {
    allowComments: ['NICE NG203 ethnicity'],
  }).length === 0,
  'the same comment is excused once the matched profile allow-lists it'
);
check(
  LF.fileabilityBlockers(commentedReport, { level: 'none' }, someRules, {
    allowComments: ['some unrelated phrase'],
  }).some((r) => /carries a comment/.test(r)),
  'a different profile without that allow-list entry still blocks — allow-listing is scoped to one profile'
);

// Real-world regression (Nick's own report, 2026-09-16): the comment reuses
// the analyte's own name mid-sentence AND word-wraps across a line break —
// numericCommentResidue used to strip EVERY occurrence of r.name (not just
// the leading "Name - " label), so residue lost the word "creatinine" the
// clinician's own allow-list phrase needed to match against. Fixed by
// stripping only the first occurrence of each token.
const realCreatinineReport = {
  unmatched: false,
  results: [
    {
      name: 'Creatinine',
      value: 61,
      unit: 'umol/L',
      rawValue: '61',
      text: 'Creatinine - Insufficient historical creatinine data to assess\nAKI risk',
    },
  ],
};
check(
  LF.fileabilityBlockers(realCreatinineReport, { level: 'none' }, someRules).some((r) => /carries a comment/.test(r)),
  'real-world Creatinine comment (repeats the analyte name, word-wrapped) blocks with no profile'
);
check(
  LF.fileabilityBlockers(realCreatinineReport, { level: 'none' }, someRules, {
    allowComments: ['Insufficient historical creatinine data to assess AKI risk'],
  }).length === 0,
  'the same real-world comment is excused once allow-listed verbatim — repeated analyte name and the line-wrap both no longer break the match'
);

// Real-world regression (Nick's own eGFR report, 2026-09-17): Medicus's own
// report data carries the performer comment TWICE inside one result's text
// field, back to back with a single space between the two copies. Left
// uncollapsed, the residue — and anything saved from it via "whitelist this
// comment" — would carry the doubled text verbatim.
const doubledCommentText =
  'Please note: eGFR should no longer be corrected for ethnicity, as per NICE guidelines (NG203) 2021. ' +
  'The eGFR calculation assumes a stable creatinine level.';
const doubledEgfrReport = {
  unmatched: false,
  results: [
    {
      name: 'eGFR (MDRD)',
      value: 62,
      unit: 'mL/min/1.73m2',
      rawValue: '62',
      text: 'eGFR (MDRD) 62 mL/min/1.73m2 ' + doubledCommentText + ' ' + doubledCommentText,
    },
  ],
};
const egfrResidue = LF.numericCommentResidue(doubledEgfrReport.results[0]);
check(
  egfrResidue === doubledCommentText,
  'a comment Medicus repeats twice in one result is collapsed to a single copy in the residue, not shown/saved doubled'
);
check(
  LF.fileabilityBlockers(doubledEgfrReport, { level: 'none' }, someRules, {
    allowComments: [doubledCommentText],
  }).length === 0,
  'allow-listing the (now de-duplicated) single-copy text excuses the doubled real-world comment'
);
check(
  LF.fileabilityBlockers(doubledEgfrReport, { level: 'none' }, someRules, {
    allowComments: [doubledCommentText + ' ' + doubledCommentText],
  }).length === 0,
  'an entry saved BEFORE this fix (still carrying the doubled text) still excuses it — bidirectional match, no need to re-save anything already whitelisted'
);

// ── unresolvedCommentedResults (drives the blocked-card "whitelist this
// comment" checkbox — must expose the EXACT residue text so a saved
// allowComments entry is guaranteed to match on the next report) ─────────────
console.log('\n--- unresolvedCommentedResults ---');
const twoCommentReport = {
  unmatched: false,
  results: [
    realCreatinineReport.results[0],
    {
      name: 'eGFR (MDRD)',
      value: 90,
      unit: 'mL/min/1.73m2',
      rawValue: '90',
      text: 'eGFR (MDRD) - This eGFR is consistent with category G1 - Normal eGFR',
    },
  ],
};
const unresolved = LF.unresolvedCommentedResults(twoCommentReport, null);
check(unresolved.length === 2, 'lists both un-benign comments when no profile is passed');
check(unresolved[0].name === 'Creatinine' && unresolved[1].name === 'eGFR (MDRD)', 'names each result in order');
check(
  unresolved[0].residue === LF.numericCommentResidue(twoCommentReport.results[0]),
  'the residue returned is the exact text fileabilityBlockers itself compares against — never a re-derived copy'
);
check(
  LF.unresolvedCommentedResults(twoCommentReport, {
    allowComments: ['Insufficient historical creatinine data to assess AKI risk'],
  }).length === 1,
  'a comment excused by the profile drops out of the list, leaving only the still-blocking one'
);
check(
  LF.unresolvedCommentedResults(null, null).length === 0 && LF.unresolvedCommentedResults({}, null).length === 0,
  'fails closed to an empty list on missing report / no results, never throws'
);
check(
  LF.unresolvedCommentedResults(twoCommentReport, null)[0].result === twoCommentReport.results[0],
  'each entry carries the raw result row, not just its derived name/residue'
);

// ── profilesOwningResult (attributes a comment to ONE profile when several
// matched a combined report — e.g. a lipids panel: cholesterol,
// triglycerides and LDL each under their own profile) ────────────────────────
console.log('\n--- profilesOwningResult ---');
const cholProfile = { name: 'Cholesterol', match: ['cholesterol', 'ldl', 'hdl'] };
const trigProfile = { name: 'Triglycerides', match: ['triglyceride'] };
const ueProfileForOwning = { name: 'U&E', match: ['sodium', 'creatinine'] };
const trigResult = { name: 'Triglycerides', specimen: null };
const ldlResult = { name: 'Calculated LDL cholesterol level', specimen: null };
const naResult = { name: 'Sodium', specimen: null };
check(
  LF.profilesOwningResult([cholProfile, trigProfile, ueProfileForOwning], trigResult).length === 1 &&
    LF.profilesOwningResult([cholProfile, trigProfile, ueProfileForOwning], trigResult)[0].name === 'Triglycerides',
  'a triglycerides result is owned by the triglycerides profile alone, even with cholesterol/U&E also matched'
);
check(
  LF.profilesOwningResult([cholProfile, trigProfile, ueProfileForOwning], ldlResult)[0].name === 'Cholesterol',
  'an LDL result is owned by the cholesterol profile (matches "ldl")'
);
check(
  LF.profilesOwningResult([cholProfile, trigProfile], naResult).length === 0,
  'a result no candidate profile actually names is owned by nobody — 0, not a guess'
);
check(
  LF.profilesOwningResult(
    [
      { name: 'A', match: ['cholesterol'] },
      { name: 'B', match: ['cholesterol'] },
    ],
    ldlResult
  ).length === 2,
  'two profiles both naming the same analyte both come back — genuinely ambiguous; the CALLER checks length!==1, this function never picks one arbitrarily'
);
check(
  LF.profilesOwningResult(null, ldlResult).length === 0 && LF.profilesOwningResult([cholProfile], null).length === 0,
  'fails closed to an empty list on missing inputs, never throws'
);

// ── profilesOwningResult: heading-first (real-world regression, 2026-09-17) ───
// Nick: a combined investigation-report task carried Renal function tests,
// LFTs and Lipids headings. The practice had U&E and LFT profiles but NO
// Lipids profile. A Triglycerides comment (heading "Lipids") was being saved
// onto the U&E and LFT profiles — the caller's old "fall back to every
// matched profile" behaviour when ownership came back empty. Fixed by (a)
// removing that fallback entirely at the call site, and (b) matching by
// HEADING (result.specimen) first, since a Medicus performer comment belongs
// to the heading, not the individual analyte, in most cases.
console.log('\n--- profilesOwningResult: heading-first ---');
const ueProfileReal = { name: 'U&E', match: ['sodium', 'potassium', 'creatinine', 'egfr'] };
const lftProfileReal = { name: 'LFTs', match: ['alt', 'alp', 'bilirubin', 'albumin'] };
const trigResultWithHeading = { name: 'Triglycerides', specimen: 'Lipids' };
check(
  LF.profilesOwningResult([ueProfileReal, lftProfileReal], trigResultWithHeading).length === 0,
  "a Lipids-heading comment is owned by NOBODY when no profile covers Lipids — never falls back to U&E/LFT just because they matched the wider report"
);
const lipidsProfile = { name: 'Lipids', match: ['lipid'] };
check(
  LF.profilesOwningResult([ueProfileReal, lftProfileReal, lipidsProfile], trigResultWithHeading)[0].name === 'Lipids',
  'once a Lipids profile exists (matches the HEADING "Lipids", not the analyte "triglyceride"), the comment is correctly attributed to it'
);
const ldlResultWithHeading = { name: 'Calculated LDL cholesterol level', specimen: 'Lipids' };
check(
  LF.profilesOwningResult([lipidsProfile, cholProfile], ldlResultWithHeading).length === 1 &&
    LF.profilesOwningResult([lipidsProfile, cholProfile], ldlResultWithHeading)[0].name === 'Lipids',
  'heading match wins outright over a competing analyte-name match — every analyte under one heading stays attributed together, not split per differing match[] term'
);
check(
  LF.profilesOwningResult([cholProfile], ldlResultWithHeading)[0].name === 'Cholesterol',
  'falls back to the analyte name when nothing names the heading itself (no Lipids profile here, but Cholesterol still names "ldl")'
);

// ── allowComments honesty on a combined report (merge-review fix, 2026-09-18) ─
// The live gate used to score allowComments against the merged-union profile,
// so a U&E phrase could excuse a Lipids-heading comment on the same task.
// Same class as the live Lipids-onto-U&E write bug: a comment must only be
// excused by a profile that owns that heading.
console.log('\n--- allowComments owning-profile honesty ---');
{
  const comboCommented = {
    unmatched: false,
    results: [
      {
        name: 'Creatinine',
        specimen: 'Renal function tests',
        value: 80,
        unit: 'umol/L',
        rawValue: '80',
        text: 'Creatinine - Insufficient historical creatinine data to assess AKI risk',
      },
      {
        name: 'Triglycerides',
        specimen: 'Lipids',
        value: 1.2,
        unit: 'mmol/L',
        rawValue: '1.2',
        text: 'Triglycerides - Insufficient historical creatinine data to assess AKI risk',
      },
    ],
  };
  const ueOnly = {
    name: 'U&E',
    match: ['creatinine', 'renal'],
    allowComments: ['Insufficient historical creatinine data to assess AKI risk'],
  };
  const lipidsEmpty = { name: 'Lipids', match: ['lipid'], allowComments: [] };
  const mergedUnion = {
    allowComments: ['Insufficient historical creatinine data to assess AKI risk'],
  };
  check(
    LF.fileabilityBlockers(comboCommented, { level: 'none' }, someRules, mergedUnion).length === 0,
    'legacy single-profile call still excuses via the passed profile (unit-test / single-panel path unchanged)'
  );
  check(
    LF.fileabilityBlockers(comboCommented, { level: 'none' }, someRules, mergedUnion, [ueOnly, lipidsEmpty]).some(
      (r) => /carries a comment/.test(r)
    ),
    'combined report: a U&E allow-list phrase does not excuse a Lipids-heading comment'
  );
  const unresolvedCombo = LF.unresolvedCommentedResults(comboCommented, mergedUnion, [ueOnly, lipidsEmpty]);
  check(
    unresolvedCombo.length === 1 && unresolvedCombo[0].name === 'Triglycerides',
    'only the Lipids-heading comment stays unresolved — Creatinine is owned by U&E and excused'
  );
  check(
    LF.fileabilityBlockers(comboCommented, { level: 'none' }, someRules, mergedUnion, [ueOnly]).some((r) =>
      /carries a comment/.test(r)
    ),
    'a Lipids comment with no owning profile is not excused by any other matched profile'
  );
}

// ── profilesOwningResult: truncated analyte name (real-world regression,
// Nick's live Lipids profile, 2026-09-17) ─────────────────────────────────────
// Medicus truncates a result's own name to a fixed length in the report —
// "Calculated LDL cholesterol level" arrives as "Calculated LDL cholesterol
// lev". A profile authored with the full, untruncated name as its match
// term (typed by hand, or seeded from a source that isn't truncated) could
// never be found as a substring of the shorter, truncated haystack.
console.log('\n--- profilesOwningResult: truncated analyte name ---');
const lipidsProfileReal = {
  name: 'Lipids - normal, no action',
  match: [
    'total cholesterol',
    'hdl cholesterol',
    'se non hdl cholesterol level',
    'serum cholesterol/hdl ratio',
    'triglycerides',
    'calculated ldl cholesterol level',
  ],
};
const truncatedLdlResult = { name: 'Calculated LDL cholesterol lev', specimen: 'Lipids' };
// The profile's own "hdl cholesterol"/"total cholesterol" terms don't
// contain the bare word "lipids", so heading-only matching alone doesn't
// catch this — the fix that matters here is the term.startsWith(hay) prefix
// check on the analyte-name fallback.
check(
  LF.profilesOwningResult([lipidsProfileReal], truncatedLdlResult)[0].name === 'Lipids - normal, no action',
  "a truncated result name (Medicus's own report data) that is a PREFIX of the profile's full match term is correctly attributed — term.startsWith(hay)"
);
check(
  LF.profilesOwningResult(
    [{ name: 'Unrelated', match: ['see calculated ldl cholesterol level notes'] }],
    truncatedLdlResult
  ).length === 0,
  'the check is a strict PREFIX match, not general containment — a term with the truncated text buried mid-string (not starting with it) does not match'
);

// ── buildFilingConfirmMessage ──────────────────────────────────────────────────
console.log('\n--- buildFilingConfirmMessage ---');
const cmsg = LF.buildFilingConfirmMessage(fbcReport, profiles[1], 'confirm');
check(/cannot be undone/i.test(cmsg), 'confirm message warns action cannot be undone');
check(/Haemoglobin/.test(cmsg) && /Sodium/.test(cmsg), 'confirm message enumerates each analyte');
check(/NORMAL/.test(cmsg), 'confirm message states results are being filed as normal');
check(!/confirmed every parameter/i.test(cmsg), 'does NOT over-claim "confirmed every parameter normal"');
check(
  /numeric value/i.test(cmsg) && /free text|trends|right patient/i.test(cmsg),
  'states the gate is numeric-only and names its blind spots'
);
check(/ask, then file/i.test(cmsg), "names the commit mode when in 'confirm' mode");
check(
  !/ask, then file/i.test(LF.buildFilingConfirmMessage(fbcReport, profiles[1], 'manual')),
  'no confirm-mode line for manual'
);

// ── trend guard (P1) ────────────────────────────────────────────────────────────
console.log('\n--- analyteTrend / trendBlockers ---');
const trendResult = { name: 'Creatinine', value: 96, history: [{ value: 60, date: '2025-01-01' }] };
const t = LF.analyteTrend(trendResult);
check(t && t.prev === 60 && t.delta === 36 && t.dir === 'up', 'analyteTrend computes prev/delta/dir');
check(t && Math.round(t.deltaPct) === 60, 'analyteTrend computes deltaPct vs previous');
check(LF.analyteTrend({ value: 96, history: [] }) === null, 'analyteTrend null with no history');
const trendRep = { results: [trendResult] };
check(
  LF.trendBlockers(trendRep, { trend: { maxDeltaPct: 20 } }).some((r) => /changed \+60%/.test(r)),
  'trendBlockers blocks a >maxDeltaPct rise'
);
check(LF.trendBlockers(trendRep, { trend: { maxDeltaPct: 80 } }).length === 0, 'trendBlockers passes within threshold');
check(LF.trendBlockers(trendRep, {}).length === 0, 'trendBlockers off when no trend configured');
check(LF.trendBlockers(trendRep, { trend: { maxDeltaPct: 0 } }).length === 0, 'trendBlockers off when maxDeltaPct 0');

// ── med-exclusion (P3) ────────────────────────────────────────────────────────────
console.log('\n--- medExclusionBlockers ---');
const meds = [{ name: 'Methotrexate 2.5mg tablets' }, { name: 'Folic acid 5mg tablets' }];
check(
  LF.medExclusionBlockers(meds, { excludeIfMeds: ['methotrexate'] }).some((r) => /monitored drug/.test(r)),
  'medExclusionBlockers fires on a monitored drug (substring, case-insensitive)'
);
check(
  LF.medExclusionBlockers(meds, { excludeIfMeds: ['lithium'] }).length === 0,
  'medExclusionBlockers clear when not on the drug'
);
check(
  LF.medExclusionBlockers(['Amiodarone 100mg'], { excludeIfMeds: ['amiodarone'] }).length === 1,
  'medExclusionBlockers accepts plain strings'
);
check(LF.medExclusionBlockers(meds, {}).length === 0, 'medExclusionBlockers off when no exclusions set');

// ── per-patient suppress (P5) ─────────────────────────────────────────────────────
console.log('\n--- suppressedBlockers ---');
const suppRep = { patientUuid: 'abc-123', results: [] };
check(LF.suppressedBlockers(suppRep, ['abc-123']).length === 1, 'suppressedBlockers fires on a plain-uuid match');
check(
  LF.suppressedBlockers(suppRep, [{ uuid: 'abc-123' }]).length === 1,
  'suppressedBlockers fires on an object-uuid match'
);
check(LF.suppressedBlockers(suppRep, ['other']).length === 0, 'suppressedBlockers clear for a different patient');
// 2026-08-22 audit R11: a non-empty suppress list with NO patient uuid now
// fails CLOSED — a payload variant without the patient id must not silently
// bypass a clinician's explicit per-patient opt-out.
check(
  LF.suppressedBlockers({ results: [] }, ['abc-123']).some((r) => /could not confirm/.test(r)),
  'suppressedBlockers fail closed when the list is in use but the report has no uuid'
);
check(
  LF.suppressedBlockers({ results: [] }, []).length === 0,
  'suppressedBlockers stay quiet with no uuid when the list is empty'
);

// ── text-suppress (P9) ────────────────────────────────────────────────────────────
console.log('\n--- textSuppressBlockers ---');
const txtRep = { results: [{ name: 'Note', value: NaN, text: 'Telephone result to patient' }] };
check(
  LF.textSuppressBlockers(txtRep, { suppressIfText: ['telephone result'] }).some((r) => /telephone result/.test(r)),
  'textSuppressBlockers fires on a phrase in the report text'
);
check(
  LF.textSuppressBlockers({ results: [] }, { suppressIfText: ['call patient'] }, 'please call patient back').length ===
    1,
  'textSuppressBlockers checks the extra page text too'
);
check(LF.textSuppressBlockers(txtRep, {}).length === 0, 'textSuppressBlockers off when no phrases set');

// ── audit CSV (P6) ────────────────────────────────────────────────────────────────
console.log('\n--- auditCsv ---');
const csv = LF.auditCsv([{ ts: '2026-06-29T10:00:00Z', profile: 'FBC', filed: true, marked: 3 }]);
check(/^ts,profile,taskUuid/.test(csv), 'auditCsv emits a header row');
check(/"FBC"/.test(csv) && /"3"/.test(csv), 'auditCsv quotes values');
check(LF.auditCsv([{ profile: 'has "quote"' }]).includes('"has ""quote"""'), 'auditCsv escapes embedded quotes');
check(LF.auditCsv([]).split('\n').length === 1, 'auditCsv of empty list is header-only');

// ── schema: trend / excludeIfMeds / suppressIfText (P1/P3/P9) ──────────────────────
console.log('\n--- schema: guards ---');
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { trend: { maxDeltaPct: 20 } })).length === 0,
  'valid trend accepted'
);
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { trend: { maxDeltaPct: -5 } })).some((e) =>
    /non-negative/.test(e)
  ),
  'negative trend.maxDeltaPct rejected'
);
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { excludeIfMeds: 'methotrexate' })).some((e) =>
    /excludeIfMeds/.test(e)
  ),
  'non-array excludeIfMeds rejected'
);
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { suppressIfText: [42] })).some((e) =>
    /suppressIfText/.test(e)
  ),
  'non-string suppressIfText entry rejected'
);
const guardSp = LF.sanitiseProfile(
  withParams([{ analyte: 'k', high: 5 }], {
    trend: { maxDeltaPct: '20' },
    excludeIfMeds: ['  Methotrexate  ', ''],
    suppressIfText: ['telephone result'],
  })
);
check(guardSp.trend.maxDeltaPct === 20, 'sanitise coerces trend.maxDeltaPct to a number');
check(
  guardSp.excludeIfMeds.length === 1 && guardSp.excludeIfMeds[0] === 'Methotrexate',
  'sanitise trims and drops empty excludeIfMeds'
);
check(guardSp.suppressIfText[0] === 'telephone result', 'sanitise preserves suppressIfText');
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { allowComments: [42] })).some((e) =>
    /allowComments/.test(e)
  ),
  'non-string allowComments entry rejected'
);
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { updatedBy: 42 })).some((e) => /updatedBy/.test(e)),
  'non-string updatedBy rejected'
);
const provSp = LF.sanitiseProfile(
  withParams([{ analyte: 'k', high: 5 }], {
    allowComments: ['  Insufficient historical data  ', ''],
    updatedBy: 'dr.nair@example.nhs.uk',
  })
);
check(
  provSp.allowComments.length === 1 && provSp.allowComments[0] === 'Insufficient historical data',
  'sanitise trims and drops empty allowComments'
);
check(provSp.updatedBy === 'dr.nair@example.nhs.uk', 'sanitise preserves updatedBy');
check(LF.sanitiseProfile(withParams([{ analyte: 'k', high: 5 }], {})).updatedBy === '', 'updatedBy defaults to empty');
check(
  LF.validateProfile(withParams([{ analyte: 'k', high: 5 }], { paramsOverrideLabFlags: 'yes' })).some((e) =>
    /paramsOverrideLabFlags/.test(e)
  ),
  'non-boolean paramsOverrideLabFlags rejected'
);
check(
  LF.sanitiseProfile(withParams([{ analyte: 'k', high: 5 }], { paramsOverrideLabFlags: true }))
    .paramsOverrideLabFlags === true,
  'sanitise preserves paramsOverrideLabFlags'
);
check(
  LF.sanitiseProfile(withParams([{ analyte: 'k', high: 5 }], {})).paramsOverrideLabFlags === false,
  'paramsOverrideLabFlags defaults false'
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
