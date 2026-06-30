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
  LF.phiWarnings([{ name: 'p', filing: validFiling, patientMessage: { template: 'NHS 943 476 5919' } }]).length === 1,
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
  filing: validFiling,
  parameters: [{ analyte: 'creatinine', low: 49, high: 90 }],
  trend: { maxDeltaPct: 15 },
  excludeIfMeds: ['ramipril'],
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
// A single matched profile keeps its own name (not the "N profiles" label).
const single = LF.mergeProfilesForReport([ue], comboReport);
check(single.effective.name === 'U&E' && single.effective._matchedCount === 1, 'single match keeps its own name');
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
const rep = (name, value, low, high) => ({ results: [{ name, value, low: low ?? null, high: high ?? null }] });
check(LF.profileParamBlockers(rep('HbA1c (IFCC)', 42), hba1cProfile).length === 0, 'HbA1c within set max → fileable');
check(
  LF.profileParamBlockers(rep('HbA1c (IFCC)', 53), hba1cProfile).some((r) => /above your set maximum/.test(r)),
  'HbA1c above set max → blocked (lab gave no range)'
);
check(
  LF.profileParamBlockers(rep('eGFR', 55), { parameters: [{ analyte: 'egfr', low: 60 }] }).some((r) =>
    /below your set minimum/.test(r)
  ),
  'eGFR below set min → blocked'
);
check(
  LF.profileParamBlockers(rep('Sodium', 140), hba1cProfile).length === 0,
  'analyte with no parameter is not blocked by params'
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

// ── fileabilityBlockers (fail-closed gate) ────────────────────────────────────
console.log('\n--- fileabilityBlockers ---');
const okReport = { unmatched: false, results: [{ name: 'Haemoglobin', value: 130, text: 'Haemoglobin 130' }] };
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
check(
  LF.suppressedBlockers({ results: [] }, ['abc-123']).length === 0,
  'suppressedBlockers clear when report has no uuid'
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
