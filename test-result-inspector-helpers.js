// test-result-inspector-helpers.js — unit tests for extractResultFields
// Run with: node test-result-inspector-helpers.js
'use strict';

// extractResultFields is defined inside the options.js IIFE so we cannot
// require it directly. The real normaliseInvestigationReport IS importable,
// so we test the helper by re-implementing its contract here and exercising
// the normalisers integration it relies on.
//
// The helper contract is:
//   extractResultFields(parsedReport) → Array<{ name, specimen, text }>
//   - name:     string | null    (result.name)
//   - specimen: string | null    (result.specimen)
//   - text:     string           (result.text, may be empty string)
//   - null for absent/empty strings
//   - empty array if parsedReport.results is absent or empty

const { normaliseInvestigationReport } = require('./engine/normalisers.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

// ── Mirror of the helper (same logic, testable standalone) ───────────────────
function extractResultFields(parsedReport) {
  if (!parsedReport || !Array.isArray(parsedReport.results)) return [];
  return parsedReport.results.map((r) => ({
    name: typeof r.name === 'string' && r.name ? r.name : null,
    specimen: typeof r.specimen === 'string' && r.specimen ? r.specimen : null,
    text: typeof r.text === 'string' ? r.text : '',
  }));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const potassiumResult = {
  description: 'Potassium',
  resultValue: '5.8',
  resultUnit: 'mmol/L',
  resultComparator: null,
  referenceRanges: [{ lowerReferenceLimit: '3.5', upperReferenceLimit: '5.0' }],
  isAboveReferenceRange: true,
  isBelowReferenceRange: false,
  requiresUrgentReview: false,
  interpretation: 'Above reference range',
  formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
  specimenCollectionDate: '2026-06-10 09:00:00',
  issuedDateTime: null,
  previousResults: [],
};

const cultureResult = {
  description: 'Culture',
  resultValue: null,
  resultText: 'No growth after 48 hours',
  resultUnit: null,
  resultComparator: null,
  referenceRanges: [],
  isAboveReferenceRange: false,
  isBelowReferenceRange: false,
  requiresUrgentReview: false,
  interpretation: null,
  formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
  specimenCollectionDate: '2026-06-10 09:00:00',
  issuedDateTime: null,
  previousResults: [],
};

const sensitivityResult = {
  description: 'Sensitivity',
  resultValue: null,
  resultText: 'Amoxicillin — Sensitive',
  resultUnit: null,
  resultComparator: null,
  referenceRanges: [],
  isAboveReferenceRange: false,
  isBelowReferenceRange: false,
  requiresUrgentReview: false,
  interpretation: null,
  formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
  specimenCollectionDate: '2026-06-10 09:00:00',
  issuedDateTime: null,
  previousResults: [],
};

// Ungrouped results (no specimen header)
const payloadUngrouped = {
  data: {
    investigationReport: {
      isMatchedToPatient: true,
      investigationGroups: [],
      ungroupedResults: [potassiumResult],
    },
  },
};

// Grouped results with named specimen header
const payloadGrouped = {
  data: {
    investigationReport: {
      isMatchedToPatient: true,
      investigationGroups: [
        {
          groupName: 'THROAT SWAB',
          results: [cultureResult, sensitivityResult],
        },
      ],
      ungroupedResults: [],
    },
  },
};

// Mixed: named group + ungrouped
const payloadMixed = {
  data: {
    investigationReport: {
      isMatchedToPatient: true,
      investigationGroups: [
        {
          groupName: 'URINE CULTURE',
          results: [cultureResult],
        },
      ],
      ungroupedResults: [potassiumResult],
    },
  },
};

// Group with untitled header (should yield specimen: null, fail-open)
const payloadUntitledGroup = {
  data: {
    investigationReport: {
      isMatchedToPatient: true,
      investigationGroups: [
        {
          groupName: '',
          name: null,
          results: [cultureResult],
        },
      ],
      ungroupedResults: [],
    },
  },
};

// Empty report
const payloadEmpty = {
  data: {
    investigationReport: {
      isMatchedToPatient: true,
      investigationGroups: [],
      ungroupedResults: [],
    },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\nextractResultFields — contract tests\n');

// 1. Null / missing input
assert(extractResultFields(null).length === 0, 'null input → empty array');
assert(extractResultFields({}).length === 0, 'missing results property → empty array');
assert(extractResultFields({ results: [] }).length === 0, 'empty results → empty array');

// 2. name field extraction
{
  const parsed = normaliseInvestigationReport(payloadUngrouped);
  const fields = extractResultFields(parsed);
  assert(fields.length === 1, 'ungrouped: one result line');
  assert(fields[0].name === 'Potassium', 'ungrouped: name = Potassium');
  assert(fields[0].specimen === null, 'ungrouped: specimen = null');
  assert(typeof fields[0].text === 'string', 'ungrouped: text is a string');
}

// 3. specimen field from named group
{
  const parsed = normaliseInvestigationReport(payloadGrouped);
  const fields = extractResultFields(parsed);
  assert(fields.length === 2, 'grouped: two result lines');
  assert(fields[0].specimen === 'THROAT SWAB', 'grouped: specimen = THROAT SWAB (Culture)');
  assert(fields[1].specimen === 'THROAT SWAB', 'grouped: specimen = THROAT SWAB (Sensitivity)');
  assert(fields[0].name === 'Culture', 'grouped: name = Culture');
  assert(fields[1].name === 'Sensitivity', 'grouped: name = Sensitivity');
}

// 4. text field includes resultText for culture results
{
  const parsed = normaliseInvestigationReport(payloadGrouped);
  const fields = extractResultFields(parsed);
  assert(fields[0].text.toLowerCase().includes('no growth'), 'culture: text includes "no growth"');
}

// 5. Mixed: named group specimen + ungrouped null specimen
{
  const parsed = normaliseInvestigationReport(payloadMixed);
  const fields = extractResultFields(parsed);
  assert(fields.length === 2, 'mixed: two result lines');
  const culture = fields.find((f) => f.name === 'Culture');
  const potassium = fields.find((f) => f.name === 'Potassium');
  assert(culture && culture.specimen === 'URINE CULTURE', 'mixed: culture specimen = URINE CULTURE');
  assert(potassium && potassium.specimen === null, 'mixed: potassium (ungrouped) specimen = null');
}

// 6. Untitled group → specimen: null (fail-open)
{
  const parsed = normaliseInvestigationReport(payloadUntitledGroup);
  const fields = extractResultFields(parsed);
  assert(fields.length === 1, 'untitled group: one result line');
  assert(fields[0].specimen === null, 'untitled group: specimen = null (fail-open)');
}

// 7. Empty report → empty fields
{
  const parsed = normaliseInvestigationReport(payloadEmpty);
  const fields = extractResultFields(parsed);
  assert(fields.length === 0, 'empty report → empty fields array');
}

// 8. name: null when description absent
{
  const resultNoName = { ...cultureResult, description: undefined };
  const payload = {
    data: {
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [],
        ungroupedResults: [resultNoName],
      },
    },
  };
  const parsed = normaliseInvestigationReport(payload);
  const fields = extractResultFields(parsed);
  assert(fields.length === 1, 'no-name: one result line');
  assert(fields[0].name === null, 'no-name: name = null when description absent');
}

// 9. text is always a string (never null / undefined)
{
  const resultNoText = {
    description: 'TSH',
    resultValue: '2.1',
    resultUnit: 'mIU/L',
    referenceRanges: [],
    isAboveReferenceRange: false,
    isBelowReferenceRange: false,
    requiresUrgentReview: false,
    formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
    previousResults: [],
  };
  const payload = {
    data: {
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [],
        ungroupedResults: [resultNoText],
      },
    },
  };
  const parsed = normaliseInvestigationReport(payload);
  const fields = extractResultFields(parsed);
  assert(typeof fields[0].text === 'string', 'text always a string, not null/undefined');
}

// 10. Multiple groups with different specimen headers
{
  const payloadMulti = {
    data: {
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [
          { groupName: 'BLOOD CULTURE', results: [cultureResult] },
          { groupName: 'MSU', results: [sensitivityResult] },
        ],
        ungroupedResults: [],
      },
    },
  };
  const parsed = normaliseInvestigationReport(payloadMulti);
  const fields = extractResultFields(parsed);
  assert(fields.length === 2, 'multi-group: two result lines');
  assert(fields[0].specimen === 'BLOOD CULTURE', 'multi-group: first specimen = BLOOD CULTURE');
  assert(fields[1].specimen === 'MSU', 'multi-group: second specimen = MSU');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
