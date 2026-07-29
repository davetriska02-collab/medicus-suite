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
  POSSIBLY_EQUIVALENT_REFSET_IDS,
  PARTIALLY_EQUIVALENT_REFSET_IDS,
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

// Real capture, 2026-07-29, 176187002 "Flexible check cystoscopy
// (procedure)" — retired ("Duplicate component"), with a SAME AS association
// (NOT REPLACED BY) to 301301002 "Flexible cystoscopy" — the first live
// confirmation of the SAME AS refset ID (900000000000527005), previously
// undiscovered per this file's own header comment. Motivating real case:
// this problem got NO "Clean up code" suggestion at all before this fix,
// since looksOutdated() doesn't flag it (no bracket/NOS/NEC/H-O marker) and
// the retirement check found isRetired:true but replacement:null.
const RETIRED_SAME_AS = {
  conceptId: '176187002',
  active: false,
  fsn: 'Flexible check cystoscopy (procedure)',
  memberships: [
    {
      type: 'SIMPLEMAP',
      refset: { conceptId: '900000000000497000', defaultTerm: 'CTV3 to SNOMED CT simple map reference set' },
      otherValue: '7B2A8',
    },
    {
      type: 'ASSOCIATION',
      refset: { conceptId: '900000000000527005', defaultTerm: 'SAME AS association reference set' },
      cidValue: { conceptId: '301301002', defaultTerm: 'Flexible cystoscopy (procedure)' },
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
      cidValue: { conceptId: '900000000000482003', defaultTerm: 'Duplicate component' },
    },
  ],
};

const ACTIVE_CONCEPT = {
  conceptId: '38341003',
  active: true,
  fsn: 'Essential hypertension (disorder)',
  memberships: [],
};

// Real capture, 2026-07-27, 69878008 "Polycystic ovaries (disorder)" —
// retired ("Ambiguous component"), with TWO POSSIBLY EQUIVALENT TO
// candidates instead of a single REPLACED BY: 237055002 "Polycystic ovary
// syndrome" (the disease) and 781067001 "Polycystic ovary" (a structural/
// anatomical finding) — a genuinely different clinical meaning, which is
// exactly why both must be kept rather than collapsed to one.
const RETIRED_AMBIGUOUS_POSSIBLY_EQUIVALENT = {
  conceptId: '69878008',
  active: false,
  fsn: 'Polycystic ovaries (disorder)',
  memberships: [
    {
      type: 'SIMPLEMAP',
      refset: { conceptId: '900000000000497000', defaultTerm: 'CTV3 to SNOMED CT simple map reference set' },
    },
    {
      type: 'ASSOCIATION',
      refset: { conceptId: '900000000000523009', defaultTerm: 'POSSIBLY EQUIVALENT TO association reference set' },
      cidValue: { conceptId: '237055002', defaultTerm: 'Polycystic ovary syndrome (disorder)' },
    },
    {
      type: 'ASSOCIATION',
      refset: { conceptId: '900000000000523009', defaultTerm: 'POSSIBLY EQUIVALENT TO association reference set' },
      cidValue: { conceptId: '781067001', defaultTerm: 'Polycystic ovary (disorder)' },
    },
    {
      type: 'ASSOCIATION',
      refset: {
        conceptId: '1322291000000109',
        defaultTerm: 'National Health Service Care Record Element association reference set',
      },
      cidValue: { conceptId: '163001000000103', defaultTerm: 'Diagnoses - care record element' },
    },
    {
      type: 'ATTRIBUTE_VALUE',
      refset: {
        conceptId: '900000000000489007',
        defaultTerm: 'Concept inactivation indicator attribute value reference set',
      },
      cidValue: { conceptId: '900000000000484002', defaultTerm: 'Ambiguous component' },
    },
  ],
};

// Real capture, 2026-07-28, 199317008 "Twin pregnancy - delivered (finding)"
// — retired ("Classification derived component"), with TWO PARTIALLY
// EQUIVALENT TO candidates instead of REPLACED BY or POSSIBLY EQUIVALENT TO:
// 65147003 "Twin pregnancy" and 289256000 "Mother delivered" — the retired
// concept's meaning is SPLIT across both, not a hedge between alternatives.
const RETIRED_SPLIT_PARTIALLY_EQUIVALENT = {
  conceptId: '199317008',
  active: false,
  fsn: 'Twin pregnancy - delivered (finding)',
  memberships: [
    {
      type: 'SIMPLEMAP',
      refset: { conceptId: '900000000000497000', defaultTerm: 'CTV3 to SNOMED CT simple map reference set' },
      otherValue: 'L2101',
    },
    {
      type: 'ASSOCIATION',
      refset: { conceptId: '1186924009', defaultTerm: 'PARTIALLY EQUIVALENT TO association reference set' },
      cidValue: { conceptId: '289256000', defaultTerm: 'Mother delivered (finding)' },
    },
    {
      type: 'ASSOCIATION',
      refset: { conceptId: '1186924009', defaultTerm: 'PARTIALLY EQUIVALENT TO association reference set' },
      cidValue: { conceptId: '65147003', defaultTerm: 'Twin pregnancy (finding)' },
    },
    {
      type: 'ASSOCIATION',
      refset: {
        conceptId: '1322291000000109',
        defaultTerm: 'National Health Service Care Record Element association reference set',
      },
      cidValue: { conceptId: '163131000000108', defaultTerm: 'Clinical observations and findings' },
    },
    {
      type: 'ATTRIBUTE_VALUE',
      refset: {
        conceptId: '900000000000489007',
        defaultTerm: 'Concept inactivation indicator attribute value reference set',
      },
      cidValue: { conceptId: '1186917008', defaultTerm: 'Classification derived component' },
    },
  ],
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
  check(
    Array.isArray(result.possiblyEquivalentTo) && result.possiblyEquivalentTo.length === 0,
    'active concept -> empty possiblyEquivalentTo array, not null'
  );
  check(
    Array.isArray(result.partiallyEquivalentTo) && result.partiallyEquivalentTo.length === 0,
    'active concept -> empty partiallyEquivalentTo array, not null'
  );
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
  check(result.possiblyEquivalentTo.length === 0, 'no POSSIBLY EQUIVALENT TO membership present -> empty array');
  check(result.partiallyEquivalentTo.length === 0, 'no PARTIALLY EQUIVALENT TO membership present -> empty array');
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
  check(result.possiblyEquivalentTo.length === 0, 'a REPLACED BY-only concept has an empty possiblyEquivalentTo array');
  check(
    result.partiallyEquivalentTo.length === 0,
    'a REPLACED BY-only concept has an empty partiallyEquivalentTo array'
  );
}

console.log(
  '--- parseConceptRetirement: retired WITH a SAME AS (not REPLACED BY) replacement (176187002, Flexible check cystoscopy) ---'
);
{
  const result = parseConceptRetirement(RETIRED_SAME_AS);
  check(result.active === false, 'active:false concept -> active false');
  check(
    !!result.inactivationReason && result.inactivationReason.conceptId === '900000000000482003',
    'inactivation reason ("Duplicate component") resolved (got ' + JSON.stringify(result.inactivationReason) + ')'
  );
  check(
    !!result.replacement && result.replacement.conceptId === '301301002',
    'SAME AS membership resolves into the SAME `replacement` field as REPLACED BY (got ' +
      JSON.stringify(result.replacement) +
      ')'
  );
  check(
    result.replacement.description === 'Flexible cystoscopy (procedure)',
    'replacement description resolved from cidValue.defaultTerm'
  );
  check(result.possiblyEquivalentTo.length === 0, 'a SAME AS-only concept has an empty possiblyEquivalentTo array');
  check(result.partiallyEquivalentTo.length === 0, 'a SAME AS-only concept has an empty partiallyEquivalentTo array');
}

console.log(
  '--- parseConceptRetirement: retired, AMBIGUOUS with two POSSIBLY EQUIVALENT TO candidates (69878008, Polycystic ovaries) ---'
);
{
  const result = parseConceptRetirement(RETIRED_AMBIGUOUS_POSSIBLY_EQUIVALENT);
  check(result.active === false, 'active:false concept -> active false');
  check(
    !!result.inactivationReason && result.inactivationReason.conceptId === '900000000000484002',
    'inactivation reason ("Ambiguous component") still resolved alongside possiblyEquivalentTo'
  );
  check(
    result.replacement === null,
    'no REPLACED BY membership -> replacement stays null, NOT populated from a possibly-equivalent candidate'
  );
  check(
    Array.isArray(result.possiblyEquivalentTo) && result.possiblyEquivalentTo.length === 2,
    'BOTH possibly-equivalent candidates are kept, not collapsed to one (got ' +
      result.possiblyEquivalentTo.length +
      ')'
  );
  check(
    result.possiblyEquivalentTo.some(
      (c) => c.conceptId === '237055002' && c.description === 'Polycystic ovary syndrome (disorder)'
    ),
    'the disease candidate (237055002, Polycystic ovary syndrome) is present with its description'
  );
  check(
    result.possiblyEquivalentTo.some(
      (c) => c.conceptId === '781067001' && c.description === 'Polycystic ovary (disorder)'
    ),
    'the structural-finding candidate (781067001, Polycystic ovary) is present with its description'
  );
  check(
    !result.possiblyEquivalentTo.some((c) => c.conceptId === '163001000000103'),
    'the confusable NHS Care Record Element association (different refset) is excluded, same as for `replacement`'
  );

  const dedupedCandidate = {
    active: false,
    memberships: [
      RETIRED_AMBIGUOUS_POSSIBLY_EQUIVALENT.memberships[1],
      RETIRED_AMBIGUOUS_POSSIBLY_EQUIVALENT.memberships[1],
    ],
  };
  check(
    parseConceptRetirement(dedupedCandidate).possiblyEquivalentTo.length === 1,
    'the same candidate conceptId referenced by two memberships is deduped, not listed twice'
  );
}

console.log(
  '--- parseConceptRetirement: retired, meaning SPLIT across two PARTIALLY EQUIVALENT TO candidates (199317008, Twin pregnancy - delivered) ---'
);
{
  const result = parseConceptRetirement(RETIRED_SPLIT_PARTIALLY_EQUIVALENT);
  check(result.active === false, 'active:false concept -> active false');
  check(
    !!result.inactivationReason && result.inactivationReason.conceptId === '1186917008',
    'inactivation reason ("Classification derived component") still resolved alongside partiallyEquivalentTo'
  );
  check(
    result.replacement === null,
    'no REPLACED BY membership -> replacement stays null, NOT populated from a partially-equivalent candidate'
  );
  check(
    result.possiblyEquivalentTo.length === 0,
    'a PARTIALLY EQUIVALENT TO-only concept has an empty possiblyEquivalentTo array — the two association types are never conflated'
  );
  check(
    Array.isArray(result.partiallyEquivalentTo) && result.partiallyEquivalentTo.length === 2,
    'BOTH partially-equivalent candidates are kept (got ' + result.partiallyEquivalentTo.length + ')'
  );
  check(
    result.partiallyEquivalentTo.some(
      (c) => c.conceptId === '65147003' && c.description === 'Twin pregnancy (finding)'
    ),
    'the "Twin pregnancy" candidate (65147003) is present with its description'
  );
  check(
    result.partiallyEquivalentTo.some(
      (c) => c.conceptId === '289256000' && c.description === 'Mother delivered (finding)'
    ),
    'the "Mother delivered" candidate (289256000) is present with its description'
  );
  check(
    !result.partiallyEquivalentTo.some((c) => c.conceptId === '163131000000108'),
    'the confusable NHS Care Record Element association (different refset) is excluded, same as for `replacement`'
  );

  const dedupedCandidate = {
    active: false,
    memberships: [RETIRED_SPLIT_PARTIALLY_EQUIVALENT.memberships[1], RETIRED_SPLIT_PARTIALLY_EQUIVALENT.memberships[1]],
  };
  check(
    parseConceptRetirement(dedupedCandidate).partiallyEquivalentTo.length === 1,
    'the same candidate conceptId referenced by two memberships is deduped, not listed twice'
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
  check(
    parseConceptRetirement(false).possiblyEquivalentTo.length === 0,
    '`false` -> empty possiblyEquivalentTo array, never null'
  );
  check(
    parseConceptRetirement(false).partiallyEquivalentTo.length === 0,
    '`false` -> empty partiallyEquivalentTo array, never null'
  );
  check(parseConceptRetirement(null).active === null, 'null -> active null, never throws');
  check(
    parseConceptRetirement(null).possiblyEquivalentTo.length === 0,
    'null -> empty possiblyEquivalentTo array, never throws'
  );
  check(
    parseConceptRetirement(null).partiallyEquivalentTo.length === 0,
    'null -> empty partiallyEquivalentTo array, never throws'
  );
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
  check(
    REPLACEMENT_REFSET_IDS.indexOf('900000000000527005') !== -1,
    'SAME AS refset ID is ALSO in the replacement refset list (added 2026-07-29, 176187002)'
  );
  check(
    Array.isArray(POSSIBLY_EQUIVALENT_REFSET_IDS) &&
      POSSIBLY_EQUIVALENT_REFSET_IDS.indexOf('900000000000523009') !== -1,
    'POSSIBLY EQUIVALENT TO refset ID is in the (deliberately short) possibly-equivalent refset list'
  );
  check(
    Array.isArray(PARTIALLY_EQUIVALENT_REFSET_IDS) && PARTIALLY_EQUIVALENT_REFSET_IDS.indexOf('1186924009') !== -1,
    'PARTIALLY EQUIVALENT TO refset ID is in the (deliberately short) partially-equivalent refset list'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
