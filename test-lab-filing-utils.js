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
check({}.polluted === undefined, 'no prototype pollution from __proto__ key');
check(typeof clean.updatedAt === 'string' && clean.updatedAt.includes('T'), 'updatedAt stamped');

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

// ── buildFilingConfirmMessage ──────────────────────────────────────────────────
console.log('\n--- buildFilingConfirmMessage ---');
const cmsg = LF.buildFilingConfirmMessage(fbcReport, profiles[1]);
check(/cannot be undone/i.test(cmsg), 'confirm message warns action cannot be undone');
check(/Haemoglobin/.test(cmsg) && /Sodium/.test(cmsg), 'confirm message enumerates each analyte');
check(/NORMAL/.test(cmsg), 'confirm message states results are being filed as normal');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
