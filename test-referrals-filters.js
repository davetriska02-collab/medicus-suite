// Medicus Suite — Referrals patient-name search + clinician filter tests
// Run with: node test-referrals-filters.js
//
// Exercises the pure filter core in
// side-panel/modules/referrals/referrals-filter-core.js — dynamic-imported
// (ES module), same technique as test-capacity-core.js / test-reception-core.js.

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;
  function check(cond, msg) {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  }

  const corePath = new URL(
    'side-panel/modules/referrals/referrals-filter-core.js',
    `file://${path.resolve(__dirname)}/`
  ).href;

  const {
    patientNameFilter,
    clinicianFilter,
    applyReferralFilters,
    collectClinicians,
    filtersActive,
    describeFilters,
  } = await import(corePath);

  function ref(given, family, clinician) {
    return {
      referralId: `${given}-${family}`,
      patientGivenName: given,
      patientFamilyName: family,
      referringClinician: clinician,
    };
  }

  const rows = [
    ref('Jane', 'Smith', 'Dr Alpha'),
    ref('John', 'Smithson', 'Dr Beta'),
    ref('Janet', 'Jones', 'Dr Alpha'),
    ref('Bob', 'Brown', ''),
    ref('Alice', 'Green', null),
  ];

  // ── patientNameFilter ─────────────────────────────────────────────────────
  console.log('\n--- patientNameFilter ---');
  check(patientNameFilter(rows, '').length === 5, 'empty query → all rows');
  check(patientNameFilter(rows, '  ').length === 5, 'whitespace-only query → all rows');
  check(patientNameFilter(rows, null).length === 5, 'null query → all rows');
  check(patientNameFilter(rows, 'jane').length === 2, '"jane" matches Jane Smith + Janet Jones (case-insensitive)');
  check(patientNameFilter(rows, 'smith').length === 2, '"smith" matches Smith + Smithson (substring)');
  check(Array.isArray(patientNameFilter(rows, 'smith')), 'filter returns a real array');
  check(
    patientNameFilter(rows, 'Smith Jane').some((r) => r.patientGivenName === 'Jane'),
    'reverse order "Family Given" also matches (secretary may type either)'
  );
  check(patientNameFilter(rows, 'zzz').length === 0, 'no match → empty array');
  check(patientNameFilter(null, 'jane').length === 0, 'null rows → empty array, no throw');
  check(patientNameFilter(undefined, 'jane').length === 0, 'undefined rows → empty array, no throw');

  // ── clinicianFilter ───────────────────────────────────────────────────────
  console.log('\n--- clinicianFilter ---');
  check(clinicianFilter(rows, '').length === 5, 'empty clinician → all rows');
  check(clinicianFilter(rows, null).length === 5, 'null clinician → all rows');
  check(clinicianFilter(rows, 'Dr Alpha').length === 2, '"Dr Alpha" → exact matches only');
  check(
    clinicianFilter(rows, 'dr alpha').length === 0,
    'exact match is case-sensitive (dropdown supplies the exact stored value, not free text)'
  );
  check(clinicianFilter(rows, 'Dr Gamma').length === 0, 'clinician not present → empty array');

  // ── applyReferralFilters (AND combination) ───────────────────────────────
  console.log('\n--- applyReferralFilters (AND) ---');
  check(applyReferralFilters(rows, {}).length === 5, 'no filters → all rows');
  check(applyReferralFilters(rows, { patientName: 'jan' }).length === 2, 'name-only filter narrows to Jane + Janet');
  check(
    applyReferralFilters(rows, { patientName: 'jan', clinician: 'Dr Alpha' }).length === 2,
    'name + clinician both matching Dr Alpha narrows to 2 (both Jane/Janet are Dr Alpha)'
  );
  check(
    applyReferralFilters(rows, { patientName: 'jan', clinician: 'Dr Beta' }).length === 0,
    'name matches but clinician does not → AND excludes (0 rows, not a union)'
  );
  check(
    applyReferralFilters(rows, { clinician: 'Dr Alpha' }).length === 2,
    'clinician-only filter still works standalone'
  );

  // ── collectClinicians ─────────────────────────────────────────────────────
  console.log('\n--- collectClinicians ---');
  const clinicians = collectClinicians(rows);
  check(clinicians.length === 2, `2 distinct clinicians found (got ${clinicians.length})`);
  check(clinicians[0] === 'Dr Alpha' && clinicians[1] === 'Dr Beta', 'sorted alphabetically');
  check(!clinicians.includes(''), 'blank clinician excluded from dropdown list');
  check(collectClinicians([]).length === 0, 'empty input → empty list');
  check(collectClinicians(null).length === 0, 'null input → empty list, no throw');

  // ── filtersActive / describeFilters ──────────────────────────────────────
  console.log('\n--- filtersActive / describeFilters ---');
  check(filtersActive({}) === false, 'no filters → inactive');
  check(filtersActive({ patientName: '  ' }) === false, 'whitespace-only name → inactive');
  check(filtersActive({ patientName: 'jane' }) === true, 'name filter → active');
  check(filtersActive({ clinician: 'Dr Alpha' }) === true, 'clinician filter → active');
  check(describeFilters({}) === '', 'no filters → empty description');
  check(describeFilters({ patientName: 'jane' }) === 'patient contains "jane"', 'name-only description');
  check(describeFilters({ clinician: 'Dr Alpha' }) === 'clinician = "Dr Alpha"', 'clinician-only description');
  check(
    describeFilters({ patientName: 'jane', clinician: 'Dr Alpha' }) ===
      'patient contains "jane", clinician = "Dr Alpha"',
    'both filters joined'
  );

  // CSV row-injection guard: describeFilters() feeds a header COMMENT line in
  // the CSV export (not a csvCell-escaped data row) — a search string
  // containing CR/LF must never be able to inject a forged extra "row".
  console.log('\n--- describeFilters CSV-injection guard ---');
  check(
    !describeFilters({ patientName: 'jane\r\nFakeHeader,Injected,Row' }).includes('\n'),
    'newline in patient-name search is stripped from the description'
  );
  check(
    !describeFilters({ patientName: 'jane\r\nFakeHeader,Injected,Row' }).includes('\r'),
    'carriage return in patient-name search is stripped from the description'
  );
  check(
    describeFilters({ patientName: 'jane\nbob' }) === 'patient contains "jane bob"',
    'embedded newline is collapsed to a single space, not just deleted (stays readable)'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
