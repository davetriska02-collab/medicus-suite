// Medicus Suite — shared/snomed-retirement.js (SNOMED CT concept-retirement
// parsing, entity-agnostic) tests
// Run with: node test-snomed-retirement.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: parsing a termbrowser concept response into
// {active, inactivationReason, replacement}, and building the concept-lookup
// URL from rules/snomed-terminology-server.json's config shape. Test
// fixtures are trimmed-down real captures of 184063008 (retired, no
// replacement) and 398307005 (retired, with a REPLACED BY replacement),
// both confirmed live 2026-07-25 — see shared/snomed-retirement.js's own
// header comment for the full capture story.

'use strict';

const {
  INACTIVATION_REASON_REFSET_ID,
  REPLACEMENT_REFSET_IDS,
  parseConceptRetirement,
  buildConceptUrl,
} = require('./shared/snomed-retirement.js');
const snomedTerminologyServerConfig = require('./rules/snomed-terminology-server.json');

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

// Trimmed real capture, 184063008 "Patient signed registration form" —
// retired, no replacement association, only the NHS Care Record Element
// association (which must be ignored, not mistaken for a replacement).
const RETIRED_NO_REPLACEMENT = {
  conceptId: '184063008',
  active: false,
  fsn: 'Patient signed registration form (finding)',
  memberships: [
    {
      type: 'SIMPLEMAP',
      refset: { conceptId: '900000000000497000', defaultTerm: 'CTV3 to SNOMED CT simple map reference set' },
      otherValue: '9122.',
    },
    {
      type: 'ASSOCIATION',
      refset: {
        conceptId: '1322291000000109',
        defaultTerm: 'National Health Service Care Record Element association reference set',
      },
      cidValue: { conceptId: '163091000000105', defaultTerm: 'Administrative procedures - care record element' },
    },
    {
      type: 'ATTRIBUTE_VALUE',
      refset: {
        conceptId: '900000000000489007',
        defaultTerm: 'Concept inactivation indicator attribute value reference set',
      },
      cidValue: { conceptId: '723277005', defaultTerm: 'Nonconformance to editorial policy component' },
    },
  ],
};

// Trimmed real capture, 398307005 "Low cervical caesarean section" (LSCS) —
// retired WITH a confirmed REPLACED BY replacement (788180009), plus the
// same confusable NHS Care Record Element association as above.
const RETIRED_WITH_REPLACEMENT = {
  conceptId: '398307005',
  active: false,
  fsn: 'Low cervical cesarean section (procedure)',
  memberships: [
    {
      type: 'ASSOCIATION',
      refset: { conceptId: '900000000000526001', defaultTerm: 'REPLACED BY association reference set' },
      cidValue: { conceptId: '788180009', defaultTerm: 'Lower uterine segment cesarean section (procedure)' },
    },
    {
      type: 'ASSOCIATION',
      refset: {
        conceptId: '1322291000000109',
        defaultTerm: 'National Health Service Care Record Element association reference set',
      },
      cidValue: { conceptId: '163071000000106', defaultTerm: 'Treatments - care record element' },
    },
    {
      type: 'ATTRIBUTE_VALUE',
      refset: {
        conceptId: '900000000000489007',
        defaultTerm: 'Concept inactivation indicator attribute value reference set',
      },
      cidValue: { conceptId: '900000000000483008', defaultTerm: 'Outdated component' },
    },
  ],
};

const ACTIVE_CONCEPT = {
  conceptId: '38341003',
  active: true,
  fsn: 'Essential hypertension (disorder)',
  memberships: [],
};

console.log('--- rules/snomed-terminology-server.json: the imported config itself ---');
{
  check(typeof snomedTerminologyServerConfig.baseUrl === 'string', 'baseUrl is a string');
  check(typeof snomedTerminologyServerConfig.edition === 'string', 'edition is a string');
  check(typeof snomedTerminologyServerConfig.release === 'string', 'release is a string');
}

console.log('--- parseConceptRetirement: active concept ---');
{
  const result = parseConceptRetirement(ACTIVE_CONCEPT);
  check(result.active === true, 'active:true concept -> active true');
  check(result.inactivationReason === null, 'active concept -> no inactivation reason');
  check(result.replacement === null, 'active concept -> no replacement');
}

console.log('--- parseConceptRetirement: retired, no replacement (184063008) ---');
{
  const result = parseConceptRetirement(RETIRED_NO_REPLACEMENT);
  check(result.active === false, 'active:false concept -> active false');
  check(
    !!result.inactivationReason && result.inactivationReason.conceptId === '723277005',
    'inactivation reason resolved from the ATTRIBUTE_VALUE membership (got ' +
      JSON.stringify(result.inactivationReason) +
      ')'
  );
  check(
    result.inactivationReason.description === 'Nonconformance to editorial policy component',
    'inactivation reason description resolved from cidValue.defaultTerm'
  );
  check(result.replacement === null, 'no REPLACED BY membership present -> replacement is null, not guessed');
}

console.log('--- parseConceptRetirement: retired WITH replacement (398307005, LSCS) ---');
{
  const result = parseConceptRetirement(RETIRED_WITH_REPLACEMENT);
  check(result.active === false, 'active:false concept -> active false');
  check(
    !!result.inactivationReason && result.inactivationReason.conceptId === '900000000000483008',
    'inactivation reason resolved (got ' + JSON.stringify(result.inactivationReason) + ')'
  );
  check(
    !!result.replacement && result.replacement.conceptId === '788180009',
    'REPLACED BY membership resolved to the real successor concept (got ' + JSON.stringify(result.replacement) + ')'
  );
  check(
    result.replacement.description === 'Lower uterine segment cesarean section (procedure)',
    'replacement description resolved from cidValue.defaultTerm'
  );
}

console.log(
  '--- parseConceptRetirement: the confusable NHS Care Record Element association is never mistaken for a replacement ---'
);
{
  const onlyConfusableAssociation = {
    conceptId: '999999999',
    active: false,
    memberships: [
      {
        type: 'ASSOCIATION',
        refset: {
          conceptId: '1322291000000109',
          defaultTerm: 'National Health Service Care Record Element association reference set',
        },
        cidValue: { conceptId: '111', defaultTerm: 'Some NHS classification, not a replacement' },
      },
    ],
  };
  check(
    parseConceptRetirement(onlyConfusableAssociation).replacement === null,
    'an ASSOCIATION-type membership on a DIFFERENT refset (not 900000000000526001) is never treated as a replacement'
  );
}

console.log('--- parseConceptRetirement: fails closed on anything unusable, never guesses ---');
{
  check(parseConceptRetirement(false).active === null, '`false` (the real wrong-release response) -> active null');
  check(parseConceptRetirement(null).active === null, 'null -> active null, never throws');
  check(parseConceptRetirement(undefined).active === null, 'undefined -> active null, never throws');
  check(parseConceptRetirement('some string').active === null, 'a string -> active null, never throws');
  check(parseConceptRetirement({}).active === null, 'an object with no active field -> active null');
  check(
    parseConceptRetirement({ active: 'false' }).active === null,
    'active as a STRING not boolean -> active null (never coerced)'
  );
  check(
    parseConceptRetirement({ active: false, memberships: 'not an array' }).active === false,
    'active:false with a malformed memberships field -> still resolves active:false'
  );
  check(
    parseConceptRetirement({ active: false, memberships: 'not an array' }).inactivationReason === null,
    'malformed memberships -> no crash, reason stays null'
  );
}

console.log('--- buildConceptUrl ---');
{
  const config = {
    baseUrl: 'https://termbrowser.nhs.uk/sct-browser-api/snomed',
    edition: 'uk-edition',
    release: 'v20260603',
  };
  check(
    buildConceptUrl(config, '184063008') ===
      'https://termbrowser.nhs.uk/sct-browser-api/snomed/uk-edition/v20260603/concepts/184063008',
    'builds the full confirmed-working URL shape'
  );
  check(buildConceptUrl(null, '184063008') === null, 'null config -> null, never throws');
  check(buildConceptUrl({}, '184063008') === null, 'empty config -> null, never throws');
  check(buildConceptUrl(config, null) === null, 'null conceptId -> null, never throws');
  check(
    buildConceptUrl(snomedTerminologyServerConfig, '184063008') ===
      snomedTerminologyServerConfig.baseUrl +
        '/' +
        snomedTerminologyServerConfig.edition +
        '/' +
        snomedTerminologyServerConfig.release +
        '/concepts/184063008',
    'works against the real rules file config, not just a synthetic one'
  );
}

console.log('--- exported constants match the confirmed-live refset IDs ---');
{
  check(INACTIVATION_REASON_REFSET_ID === '900000000000489007', 'inactivation-indicator refset ID');
  check(
    Array.isArray(REPLACEMENT_REFSET_IDS) && REPLACEMENT_REFSET_IDS.indexOf('900000000000526001') !== -1,
    'REPLACED BY refset ID is in the (deliberately short) replacement refset list'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
