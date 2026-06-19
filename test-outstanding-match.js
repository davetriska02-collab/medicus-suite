// Medicus Suite — outstanding investigation request matcher tests
// Run with: node test-outstanding-match.js
//
// Guards engine/outstanding-match.js — the per-request "resulted vs still
// outstanding" decision that drives the advisory annotation and the auto-tick
// on the Outstanding Investigation Requests card.
//
// The card data below is a REAL capture (2026-06-19). The cardinal safety
// property under test: a report only auto-ticks (autoTick === true) requests
// for the SAME test whose request PREDATES the sample — never a buried,
// unrelated, or post-dating request.

'use strict';

const path = require('path');
const M = require(path.join(__dirname, 'engine', 'outstanding-match.js'));

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

// ── Real card capture: 11 outstanding requests ────────────────────────────────
const CARD_LABELS = [
  'Full Lipid Profile (Dr David Triska • 09 Jun 2026, 13:31)',
  'XR Knee Lt (Dr David Triska • 13 Apr 2026, 09:40)',
  'Creatinine + Electrolyte Profile, Blood (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Full Blood Count (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Liver Function Test (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Prostate Specific Antigen (PSA) (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Thyroid Testing (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Faecal Immunochemical Test (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Ferritin (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Bone Profile (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  'Prostate Specific Antigen (PSA) (Dr Emma Nicholls • 23 Jul 2025, 12:04)',
];

// ── 1. Label parsing ──────────────────────────────────────────────────────────
console.log('parseRequestLabel:');
const p0 = M.parseRequestLabel(CARD_LABELS[0]);
check(p0.name === 'Full Lipid Profile', `name parsed (${p0.name})`);
check(p0.requester === 'Dr David Triska', `requester parsed (${p0.requester})`);
check(p0.requestedDate === '2026-06-09', `date parsed (${p0.requestedDate})`);

const pPsa = M.parseRequestLabel(CARD_LABELS[5]);
check(pPsa.name === 'Prostate Specific Antigen (PSA)', `inner-paren panel name kept (${pPsa.name})`);
check(pPsa.requestedDate === '2026-02-04', `PSA date parsed (${pPsa.requestedDate})`);

const pXr = M.parseRequestLabel(CARD_LABELS[1]);
check(pXr.name === 'XR Knee Lt' && pXr.requestedDate === '2026-04-13', 'radiology row parsed');

// ── 2. Lipid report: only the lipid request resolves + auto-ticks ─────────────
console.log('lipid report:');
const lipidReport = {
  title: 'Full Lipid Profile',
  results: [
    { name: 'Serum cholesterol', specimen: 'Lipid Profile', date: '2026-06-10' },
    { name: 'HDL cholesterol', specimen: 'Lipid Profile', date: '2026-06-10' },
    { name: 'Triglycerides', specimen: 'Lipid Profile', date: '2026-06-10' },
  ],
};
const lipidOut = M.matchOutstanding(CARD_LABELS, lipidReport);
const lipidRow = lipidOut[0];
check(
  lipidRow.status === 'resulted' && lipidRow.autoTick === true,
  `lipid request resulted + auto-tick (${lipidRow.status}/${lipidRow.autoTick})`
);
check(lipidRow.confidence === 'confident', 'lipid match is confident (panel title)');
const lipidOthers = lipidOut.slice(1);
check(
  lipidOthers.every((r) => r.status === 'outstanding' && r.autoTick === false),
  'every NON-lipid request stays outstanding + un-ticked'
);

// ── 3. PSA report: BOTH PSA requests tick (both predate); nothing else ────────
console.log('PSA report (duplicate requests):');
const psaReport = {
  title: 'Prostate Specific Antigen (PSA)',
  results: [{ name: 'PSA', specimen: 'Prostate Specific Antigen (PSA)', date: '2026-08-01' }],
};
const psaOut = M.matchOutstanding(CARD_LABELS, psaReport);
const psaRows = psaOut.filter((r) => r.key === 'psa');
check(psaRows.length === 2, 'both PSA requests resolved to key=psa');
check(
  psaRows.every((r) => r.status === 'resulted' && r.autoTick === true),
  'both PSA requests auto-tick (both predate the sample)'
);
check(
  psaOut.filter((r) => r.key !== 'psa').every((r) => r.status === 'outstanding'),
  'non-PSA requests untouched by a PSA report'
);

// ── 4. Date guard: a request that POST-dates the sample stays outstanding ──────
console.log('date guard:');
const lateReq = [{ name: 'Ferritin', requestedDate: '2026-09-01' }];
const ferritinReport = {
  title: 'Ferritin',
  results: [{ name: 'Ferritin', specimen: 'Ferritin', date: '2026-08-01' }],
};
const lateOut = M.matchOutstanding(lateReq, ferritinReport);
check(
  lateOut[0].status === 'outstanding' && lateOut[0].autoTick === false,
  'request made AFTER the sample is not cleared'
);
const earlyOut = M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-07-01' }], ferritinReport);
check(earlyOut[0].status === 'resulted' && earlyOut[0].autoTick === true, 'request made BEFORE the sample is cleared');

// ── 5. Buried-test safety: unrecognised request never auto-clears ─────────────
console.log('buried-test safety:');
const buried = M.matchOutstanding([{ name: 'Coeliac Screen', requestedDate: '2026-01-01' }], lipidReport);
check(
  buried[0].key === null && buried[0].status === 'outstanding' && buried[0].autoTick === false,
  'a request the report does not cover is left outstanding, never ticked'
);

// ── 6. Analyte-signature: multi-analyte report with NO specimen title ─────────
// Real Medicus reports may carry no specimen-group title (confirmed by capture),
// so a multi-analyte signature must reach `confident` on its own.
console.log('analyte-signature (no specimen title):');
const ueAnalyteReport = {
  // No specimen group / title — only raw analyte names.
  results: [
    { name: 'Sodium', specimen: null, date: '2026-03-01' },
    { name: 'Potassium', specimen: null, date: '2026-03-01' },
    { name: 'Urea', specimen: null, date: '2026-03-01' },
  ],
};
const ueOut = M.matchOutstanding(
  [{ name: 'Creatinine + Electrolyte Profile, Blood', requestedDate: '2026-02-04' }],
  ueAnalyteReport
);
check(ueOut[0].status === 'resulted', 'U&E request resolved via distinctive analytes');
check(
  ueOut[0].confidence === 'confident' && ueOut[0].autoTick === true,
  '3-analyte U&E signature is confident + auto-ticks even without a panel title'
);

// ── 6b. Real captured lipid report (analytes only, no specimen, sample 18 Jun) ─
console.log('real captured lipid report:');
const realLipidReport = {
  results: [
    { name: 'Total cholesterol', specimen: null, date: '2026-06-18' },
    { name: 'HDL cholesterol', specimen: null, date: '2026-06-18' },
    { name: 'Triglycerides', specimen: null, date: '2026-06-18' },
    { name: 'Serum cholesterol/HDL ratio', specimen: null, date: '2026-06-18' },
    { name: 'LDL cholesterol', specimen: null, date: '2026-06-18' },
    { name: 'Se non HDL cholesterol level', specimen: null, date: '2026-06-18' },
  ],
};
const realLipidOut = M.matchOutstanding(CARD_LABELS, realLipidReport);
const realLipidRow = realLipidOut[0]; // "Full Lipid Profile (… 09 Jun 2026)"
check(
  realLipidRow.status === 'resulted' && realLipidRow.confidence === 'confident' && realLipidRow.autoTick === true,
  'captured lipid panel auto-ticks the 09 Jun lipid request (sample 18 Jun)'
);
check(
  realLipidOut.slice(1).every((r) => r.status === 'outstanding'),
  'no other request is touched by the lipid report'
);

// ── 6c. Genuine tentative: a single distinctive analyte of a multi-analyte panel
console.log('single-analyte tentative:');
const loneCreatinine = {
  results: [{ name: 'Creatinine', specimen: null, date: '2026-03-01' }],
};
const loneOut = M.matchOutstanding(
  [{ name: 'Creatinine + Electrolyte Profile, Blood', requestedDate: '2026-02-04' }],
  loneCreatinine
);
check(
  loneOut[0].status === 'resulted' && loneOut[0].confidence === 'tentative' && loneOut[0].autoTick === false,
  'a lone creatinine is tentative for U&E — surfaced, never auto-ticked'
);

// ── 7. Fail-safe: missing sample date never clears ────────────────────────────
console.log('fail-safe (no sample date):');
const noDate = M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-01-01' }], {
  title: 'Ferritin',
  results: [{ name: 'Ferritin', specimen: 'Ferritin', date: null }],
});
check(noDate[0].autoTick === false, 'no sample date → not auto-ticked');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
