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

// ── 6a. URINE electrolytes must NOT match a BLOOD U&E request ──────────────────
// A urine electrolytes panel shares every U&E analyte name (urine sodium/potassium/
// urea/creatinine) and the word "electrolyte". Without the U&E def's `exclude`, it
// matched — and with auto-tick on could wrongly clear an outstanding blood U&E.
// (Reported false positive: a urine electrolytes report matching the U&E request.)
console.log('urine electrolytes vs blood U&E (exclude):');
const urineReport = {
  title: 'Urine electrolytes',
  results: [
    { name: 'Urine sodium', specimen: 'Urine electrolytes', date: '2026-06-10' },
    { name: 'Urine potassium', specimen: 'Urine electrolytes', date: '2026-06-10' },
    { name: 'Urine urea', specimen: 'Urine electrolytes', date: '2026-06-10' },
    { name: 'Urine creatinine', specimen: 'Urine electrolytes', date: '2026-06-10' },
  ],
};
const urineVsUe = M.matchOutstanding(
  [{ name: 'Urea and Electrolytes WITH Potassium', requestedDate: '2026-02-04' }],
  urineReport
);
check(
  urineVsUe[0].status === 'outstanding' && urineVsUe[0].autoTick === false,
  'a urine electrolytes report does NOT clear an outstanding blood U&E request'
);
const urineCov = M.reportCoverage(urineReport);
check(
  !urineCov.confident.has('ue') && !urineCov.tentative.has('ue'),
  'a urine-only report covers neither confident nor tentative U&E'
);

// 6a-ii. A genuine BLOOD U&E (with its specimen title) still auto-ticks — the
// exclude must not over-reach and break the legitimate match.
console.log('blood U&E still matches (exclude regression):');
const bloodUeReport = {
  title: 'Urea and electrolytes',
  results: [
    { name: 'Sodium', specimen: 'Urea and electrolytes', date: '2026-06-10' },
    { name: 'Potassium', specimen: 'Urea and electrolytes', date: '2026-06-10' },
    { name: 'Creatinine', specimen: 'Urea and electrolytes', date: '2026-06-10' },
  ],
};
const bloodUe = M.matchOutstanding(
  [{ name: 'Urea and Electrolytes WITH Potassium', requestedDate: '2026-02-04' }],
  bloodUeReport
);
check(
  bloodUe[0].status === 'resulted' && bloodUe[0].autoTick === true,
  'a genuine blood U&E report still auto-ticks the U&E request'
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

// ── 8. enrichWithHistory: detect requests resulted elsewhere ──────────────────
console.log('enrichWithHistory:');

const obsHistoryFbc = [
  {
    name: 'Haemoglobin',
    group: 'Haematology',
    unit: 'g/L',
    history: [{ date: '2026-05-01', value: 120, rawValue: '120', isAbove: false, isBelow: true }],
  },
  {
    name: 'Platelet count',
    group: 'Haematology',
    unit: 'x10^9/L',
    history: [{ date: '2026-05-01', value: 250, rawValue: '250', isAbove: false, isBelow: false }],
  },
];
const obsHistoryFerritin = [
  {
    name: 'Ferritin',
    group: 'Haematinics',
    unit: 'ug/L',
    history: [{ date: '2026-03-15', value: 45, rawValue: '45', isAbove: false, isBelow: false }],
  },
];

// 8a. FBC request not covered by lipid report — but found in observation history
const fbcVerdicts = M.matchOutstanding([{ name: 'Full Blood Count', requestedDate: '2026-02-04' }], lipidReport);
const fbcEnriched = M.enrichWithHistory(fbcVerdicts, obsHistoryFbc);
check(fbcEnriched[0].status === 'resulted_elsewhere', 'FBC found in history → resulted_elsewhere');
check(fbcEnriched[0].confidence === 'confident', 'FBC history match confident (2 analytes: haemoglobin + platelet)');
check(fbcEnriched[0].autoTick === false, 'resulted_elsewhere is NEVER auto-ticked');
check(fbcEnriched[0].elsewhereDate === '2026-05-01', 'FBC elsewhere date is most recent history date');

// 8b. Ferritin is singleAnalyte → 1 analyte hit = confident
const ferritinVerdicts = M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-02-04' }], lipidReport);
const ferritinEnriched = M.enrichWithHistory(ferritinVerdicts, obsHistoryFerritin);
check(ferritinEnriched[0].status === 'resulted_elsewhere', 'ferritin in history → resulted_elsewhere');
check(ferritinEnriched[0].confidence === 'confident', 'singleAnalyte ferritin: 1 hit is confident');

// 8c. Date guard: history entry predates the request → NOT resulted_elsewhere
const lateRequest = M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-04-01' }], lipidReport);
const lateEnriched = M.enrichWithHistory(lateRequest, obsHistoryFerritin); // history 2026-03-15 < 2026-04-01
check(lateEnriched[0].status === 'outstanding', 'history result predating the request leaves it outstanding');

// 8d. Already resulted from current report → enrichWithHistory leaves it unchanged
const alreadyResulted = M.matchOutstanding(CARD_LABELS, lipidReport);
const alreadyEnriched = M.enrichWithHistory(alreadyResulted, obsHistoryFbc);
check(alreadyEnriched[0].status === 'resulted', 'already-resulted row not reclassified by enrichWithHistory');
check(
  alreadyEnriched.slice(1).filter((r) => r.status === 'resulted_elsewhere' && r.key !== 'fbc').length === 0,
  'FBC history only enriches FBC row — no other panel accidentally matched'
);

// 8e. Single analyte for multi-analyte panel without group match → tentative
const obsHistoryTshOnly = [
  {
    name: 'TSH',
    group: null, // no group — cannot use group-name shortcut
    unit: 'mIU/L',
    history: [{ date: '2026-04-01', value: 1.5, rawValue: '1.5', isAbove: false, isBelow: false }],
  },
];
const tftVerdicts = M.matchOutstanding([{ name: 'Thyroid Testing', requestedDate: '2026-02-04' }], lipidReport);
const tftEnriched = M.enrichWithHistory(tftVerdicts, obsHistoryTshOnly);
check(tftEnriched[0].status === 'resulted_elsewhere', 'lone TSH in history → resulted_elsewhere (tentative)');
check(tftEnriched[0].confidence === 'tentative', 'single TSH for multi-analyte TFT panel is tentative');

// 8f. Group-name match → confident even with a single analyte
const obsHistoryLftGroup = [
  {
    name: 'ALT',
    group: 'Liver function',
    unit: 'U/L',
    history: [{ date: '2026-05-20', value: 30, rawValue: '30', isAbove: false, isBelow: false }],
  },
];
const lftVerdicts = M.matchOutstanding([{ name: 'Liver Function Test', requestedDate: '2026-02-04' }], lipidReport);
const lftEnriched = M.enrichWithHistory(lftVerdicts, obsHistoryLftGroup);
check(lftEnriched[0].status === 'resulted_elsewhere', 'LFT found via group name → resulted_elsewhere');
check(lftEnriched[0].confidence === 'confident', 'group-name "Liver function" match is always confident');

// ── 8g. New enriched fields — matchedAnalytes / matchedValue / matchedUnit / matchedObsName / matchedAbnormal ──
console.log('enrichWithHistory — enriched fields:');

// 8g-i. FBC confident case: matchedAnalytes populated, matchedValue/matchedUnit/matchedObsName truthy.
// Haemoglobin has isBelow: true in the fixture → matchedAbnormal should be 'low'.
// Platelet count has isAbove: false, isBelow: false → matchedAbnormal would be null.
// Both have the same date (2026-05-01) so bestPoint is whichever is encountered last with an equal-or-later date;
// strictly-greater date wins, so first one to arrive stays until superseded.
// We assert the observable contract: matchedValue/matchedUnit are truthy, matchedAnalytes is non-empty.
const fbcEnriched8g = M.enrichWithHistory(
  M.matchOutstanding([{ name: 'Full Blood Count', requestedDate: '2026-02-04' }], lipidReport),
  obsHistoryFbc
);
check(
  Array.isArray(fbcEnriched8g[0].matchedAnalytes) && fbcEnriched8g[0].matchedAnalytes.length > 0,
  '8g-i matchedAnalytes is a non-empty array for FBC confident case'
);
check(fbcEnriched8g[0].matchedAnalytes.includes('Haemoglobin'), '8g-i matchedAnalytes includes Haemoglobin');
check(fbcEnriched8g[0].matchedAnalytes.includes('Platelet count'), '8g-i matchedAnalytes includes Platelet count');
check(!!fbcEnriched8g[0].matchedValue, '8g-i matchedValue is truthy');
check(!!fbcEnriched8g[0].matchedUnit, '8g-i matchedUnit is truthy');
check(!!fbcEnriched8g[0].matchedObsName, '8g-i matchedObsName is truthy');
// Haemoglobin isBelow:true → if Haemoglobin is the bestPoint, matchedAbnormal === 'low'.
// Platelet count isAbove:false,isBelow:false → matchedAbnormal === null.
// Both same date; first encountered (Haemoglobin) is set as bestPoint but Platelet (same date, NOT strictly greater) leaves it unchanged.
// So Haemoglobin remains bestPoint → matchedAbnormal === 'low'.
check(fbcEnriched8g[0].matchedAbnormal === 'low', '8g-i matchedAbnormal is low (Haemoglobin isBelow:true)');

// 8g-ii. Tentative TSH case: reason now names the analyte and includes 'check'.
check(/tsh/i.test(tftEnriched[0].reason), '8g-ii tentative TSH reason contains analyte name TSH');
check(/check/i.test(tftEnriched[0].reason), '8g-ii tentative TSH reason contains the word check');
check(
  tftEnriched[0].reason !== 'possibly resulted elsewhere — confirm before clearing',
  '8g-ii tentative TSH reason is specific, not the old generic string'
);

// 8g-iii. matchedValue reflects the MOST RECENT point when an obs has multiple history entries.
const obsHistoryMultiDate = [
  {
    name: 'TSH',
    group: null,
    unit: 'mIU/L',
    history: [
      { date: '2026-03-01', value: 1.2, rawValue: '1.2', isAbove: false, isBelow: false },
      { date: '2026-05-15', value: 0.8, rawValue: '0.8', isAbove: false, isBelow: false },
      { date: '2026-04-10', value: 2.1, rawValue: '2.1', isAbove: false, isBelow: false },
    ],
  },
];
const tftVerdictsMulti = M.matchOutstanding([{ name: 'Thyroid Testing', requestedDate: '2026-02-04' }], lipidReport);
const tftEnrichedMulti = M.enrichWithHistory(tftVerdictsMulti, obsHistoryMultiDate);
check(tftEnrichedMulti[0].status === 'resulted_elsewhere', '8g-iii multi-date TSH obs → resulted_elsewhere');
check(
  tftEnrichedMulti[0].matchedValue === '0.8',
  `8g-iii matchedValue is from the most recent point (2026-05-15 → 0.8, got ${tftEnrichedMulti[0].matchedValue})`
);

// 8g-iv. matchedAbnormal for isAbove:true → 'high'.
const obsHistoryHighAlt = [
  {
    name: 'ALT',
    group: null,
    unit: 'U/L',
    history: [{ date: '2026-05-01', value: 95, rawValue: '95', isAbove: true, isBelow: false }],
  },
];
const lftVerdictsHigh = M.matchOutstanding([{ name: 'Liver Function Test', requestedDate: '2026-02-04' }], lipidReport);
const lftEnrichedHigh = M.enrichWithHistory(lftVerdictsHigh, obsHistoryHighAlt);
check(lftEnrichedHigh[0].matchedAbnormal === 'high', '8g-iv matchedAbnormal is high when isAbove:true');

// 8g-v. matchedAbnormal null when isAbove:false and isBelow:false.
const obsHistoryNormalFerritin = [
  {
    name: 'Ferritin',
    group: 'Haematinics',
    unit: 'ug/L',
    history: [{ date: '2026-03-15', value: 45, rawValue: '45', isAbove: false, isBelow: false }],
  },
];
const ferritinVerdictsNorm = M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-02-04' }], lipidReport);
const ferritinEnrichedNorm = M.enrichWithHistory(ferritinVerdictsNorm, obsHistoryNormalFerritin);
check(ferritinEnrichedNorm[0].matchedAbnormal === null, '8g-v matchedAbnormal is null when result is normal');

// 8g-vi. Unmatched obs → matchedAnalytes is empty array.
// Use a request with no observation history match.
const emptyEnriched = M.enrichWithHistory(
  M.matchOutstanding([{ name: 'Full Blood Count', requestedDate: '2026-02-04' }], lipidReport),
  [] // empty history
);
check(emptyEnriched[0].status === 'outstanding', '8g-vi empty history leaves status outstanding');

// ── 9. Reproductive / sex-hormone profile (FSH/LH gap Nick flagged) ───────────
console.log('sex-hormone tests:');
const HORMONE_LABELS = [
  'Follicle Stimulating Hormone (Dr Nicholas Grundy • 17 Apr 2026, 12:06)',
  'Luteinising Hormone (Dr Nicholas Grundy • 17 Apr 2026, 12:06)',
  'Oestradiol (Dr Nicholas Grundy • 17 Apr 2026, 12:06)',
  'Prolactin (Dr Nicholas Grundy • 17 Apr 2026, 12:06)',
  'Testosterone (Dr Nicholas Grundy • 17 Apr 2026, 12:06)',
];
// 9a. Every request now resolves to a key (the bug was key === null → unrecognised).
const hormoneKeys = HORMONE_LABELS.map((l) => M.resolveDef(M.parseRequestLabel(l).name, ['req']));
check(
  hormoneKeys.every((d) => d && d.key),
  `all sex-hormone requests resolve to a key (${hormoneKeys.map((d) => (d ? d.key : 'null')).join(',')})`
);
check(hormoneKeys[0].key === 'fsh', 'Follicle Stimulating Hormone → fsh');
check(hormoneKeys[1].key === 'lh', 'Luteinising Hormone → lh');

// 9b. US spelling resolves too (luteinizing / estradiol).
check(
  M.resolveDef('Luteinizing Hormone', ['req']) && M.resolveDef('Luteinizing Hormone', ['req']).key === 'lh',
  'US spelling Luteinizing → lh'
);
check(
  M.resolveDef('Estradiol', ['req']) && M.resolveDef('Estradiol', ['req']).key === 'oestradiol',
  'US spelling Estradiol → oestradiol'
);

// 9c. Single-analyte report ticks its own request and nothing else.
const fshReport = {
  title: 'Follicle Stimulating Hormone',
  results: [{ name: 'FSH', specimen: 'Follicle Stimulating Hormone', date: '2026-04-20' }],
};
const fshOut = M.matchOutstanding(HORMONE_LABELS, fshReport);
check(
  fshOut[0].status === 'resulted' && fshOut[0].autoTick === true && fshOut[0].confidence === 'confident',
  `FSH report auto-ticks the FSH request only (${fshOut[0].status}/${fshOut[0].autoTick})`
);
check(
  fshOut.slice(1).every((r) => r.status === 'outstanding'),
  'an FSH report does NOT clear LH / oestradiol / prolactin / testosterone'
);

// 9d. LH analyte (the abbreviation as it appears on a report) is recognised confidently.
const lhReport = { results: [{ name: 'LH', specimen: '', date: '2026-04-20' }] };
const lhOut = M.matchOutstanding([HORMONE_LABELS[1]], lhReport);
check(
  lhOut[0].status === 'resulted' && lhOut[0].autoTick === true,
  'lone "LH" analyte resolves the LH request confidently'
);

// 9e. Resulted-elsewhere now works for FSH (the originally-flagged failure):
// an LH report leaves FSH outstanding, but history enrichment finds it in record.
const lhOnlyOut = M.matchOutstanding(HORMONE_LABELS, lhReport);
check(lhOnlyOut[0].status === 'outstanding', 'FSH request stays outstanding under an LH-only report');
const fshHistory = [
  {
    name: 'Follicle stimulating hormone',
    group: 'Endocrinology',
    unit: 'U/L',
    history: [{ date: '2026-06-16', value: 6.2, rawValue: '6.2', isAbove: false, isBelow: false }],
  },
];
const fshEnriched = M.enrichWithHistory(lhOnlyOut, fshHistory);
check(
  fshEnriched[0].status === 'resulted_elsewhere' && fshEnriched[0].autoTick === false,
  'FSH found in observation history → resulted_elsewhere (never auto-ticked)'
);
check(fshEnriched[0].elsewhereDate === '2026-06-16', 'FSH elsewhere date surfaced (2026-06-16)');

// ── 10. User test dictionary (mergeTestDefs + opts.testDefs) ──────────────────
console.log('user test dictionary:');

// 10a. A brand-new custom test is recognised once merged in.
const customDefs = M.mergeTestDefs(M.TEST_DEFS, [
  {
    key: 'vitd',
    label: 'Vitamin D',
    req: ['vitamin d', '25-oh vit d'],
    rep: ['vitamin d'],
    analytes: ['vitamin d', '25 hydroxyvitamin d'],
    singleAnalyte: true,
  },
]);
check(M.resolveDef('Vitamin D Level', ['req']) === null, '10a built-in defs do NOT know Vitamin D (baseline)');
check(
  M.resolveDef('Vitamin D Level', ['req'], customDefs) &&
    M.resolveDef('Vitamin D Level', ['req'], customDefs).key === 'vitd',
  '10a merged defs DO resolve a custom Vitamin D test'
);
const vitdReport = {
  title: 'Vitamin D',
  results: [{ name: '25 hydroxyvitamin D', specimen: 'Vitamin D', date: '2026-05-01' }],
};
const vitdOut = M.matchOutstanding(['Vitamin D (Dr X • 01 Apr 2026, 09:00)'], vitdReport, { testDefs: customDefs });
check(vitdOut[0].status === 'resulted' && vitdOut[0].autoTick === true, '10a custom test auto-ticks via opts.testDefs');

// 10b. Extending a built-in with a local lab synonym (append-only).
const extDefs = M.mergeTestDefs(M.TEST_DEFS, [{ key: 'ue', req: ['euc', 'renal screen'] }]);
const ueDef = extDefs.find((d) => d.key === 'ue');
check(
  ueDef.req.includes('euc') && ueDef.req.includes('electrolyte'),
  '10b extension APPENDS the synonym, keeps built-in terms'
);
check(
  M.resolveDef('EUC Profile', ['req'], extDefs) && M.resolveDef('EUC Profile', ['req'], extDefs).key === 'ue',
  '10b local synonym "EUC" now resolves to U&E'
);

// 10c. Disabling a built-in makes it unrecognised (fail-safe → stays outstanding).
const noPsa = M.mergeTestDefs(M.TEST_DEFS, [{ key: 'psa', disabled: true }]);
check(!noPsa.some((d) => d.key === 'psa'), '10c disabled built-in is removed from the def set');
check(M.resolveDef('Prostate Specific Antigen (PSA)', ['req'], noPsa) === null, '10c disabled PSA no longer resolves');

// 10d. Safety: a user entry can NOT flip a built-in to singleAnalyte (would lower
// the auto-tick threshold). lft stays a 2-analyte panel.
const tamper = M.mergeTestDefs(M.TEST_DEFS, [{ key: 'lft', singleAnalyte: true }]);
check(
  tamper.find((d) => d.key === 'lft').singleAnalyte !== true,
  '10d user cannot flip a built-in panel to singleAnalyte'
);

// 10e. Invalid entries (no key) are ignored.
const safeMerge = M.mergeTestDefs(M.TEST_DEFS, [{ label: 'no key here' }, null, 'garbage']);
check(safeMerge.length === M.TEST_DEFS.length, '10e invalid dictionary entries are dropped');

// ── 11. Confidence floor (strict) + look-back ceiling ─────────────────────────
console.log('confidence floor + look-back:');

// 11a. In default mode an analyte signature auto-ticks; in strict it must not.
const tftReport = {
  results: [
    { name: 'TSH', specimen: '', date: '2026-05-01' },
    { name: 'Free T4', specimen: '', date: '2026-05-01' },
  ],
};
const tftDefault = M.matchOutstanding(['Thyroid Testing (Dr X • 01 Apr 2026, 09:00)'], tftReport);
check(
  tftDefault[0].status === 'resulted' && tftDefault[0].autoTick === true,
  '11a default: 2-analyte TFT signature auto-ticks'
);
const tftStrict = M.matchOutstanding(['Thyroid Testing (Dr X • 01 Apr 2026, 09:00)'], tftReport, {
  confidenceFloor: 'strict',
});
check(
  tftStrict[0].autoTick === false && tftStrict[0].confidence === 'tentative',
  '11a strict: analyte signature is demoted, no auto-tick'
);

// 11b. strict still trusts a specimen-group title.
const tftTitled = { results: [{ name: 'TSH', specimen: 'Thyroid Function', date: '2026-05-01' }] };
const tftStrictTitled = M.matchOutstanding(['Thyroid Testing (Dr X • 01 Apr 2026, 09:00)'], tftTitled, {
  confidenceFloor: 'strict',
});
check(tftStrictTitled[0].autoTick === true, '11b strict: a specimen-group title is still confident');

// 11c. addMonths clamps correctly.
check(M.addMonths('2026-01-31', 1) === '2026-02-28', '11c addMonths clamps 31 Jan + 1mo → 28 Feb');
check(M.addMonths('2026-06-09', 12) === '2027-06-09', '11c addMonths adds a year');

// 11d. look-back ceiling drops a too-late "elsewhere" result.
const ferritinReq = M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-01-01' }], lipidReport);
const lateFerritin = [
  {
    name: 'Ferritin',
    group: 'Haematinics',
    unit: 'ug/L',
    history: [{ date: '2026-11-01', value: 30, rawValue: '30', isAbove: false, isBelow: false }],
  },
];
const noCeiling = M.enrichWithHistory(ferritinReq, lateFerritin);
check(noCeiling[0].status === 'resulted_elsewhere', '11d no ceiling: late ferritin still matches');
const withCeiling = M.enrichWithHistory(
  M.matchOutstanding([{ name: 'Ferritin', requestedDate: '2026-01-01' }], lipidReport),
  lateFerritin,
  { lookbackMonths: 3 }
);
check(withCeiling[0].status === 'outstanding', '11d 3-month ceiling: a result 10 months later is excluded');

// ── 12. HbA1c (the unrecognised-request gap reported on a DM-diagnosis report) ──
// The outstanding request "Haemoglobin A1C (HbA1C)" resolved to key=null, so an
// incoming HbA1c result could never be matched to it — it stayed outstanding.
console.log('HbA1c outstanding match:');
const HBA1C_LABEL = 'Haemoglobin A1C (HbA1C) (Samantha Thomason • 28 May 2026, 08:56)';
const hba1cParsed = M.parseRequestLabel(HBA1C_LABEL);
check(hba1cParsed.name === 'Haemoglobin A1C (HbA1C)', `12 request name keeps the (HbA1C) suffix (${hba1cParsed.name})`);
const hba1cDef = M.resolveDef(hba1cParsed.name, ['req']);
check(hba1cDef && hba1cDef.key === 'hba1c', `12 "Haemoglobin A1C (HbA1C)" resolves to key=hba1c (was null)`);

// 12a. An HbA1c report (analyte "HbA1c", as on the DM-diagnosis report) auto-ticks
// its own request — single-analyte, so one result is a confident match.
const hba1cReport = {
  title: 'HBA1C FOR DM DIAGNOSIS',
  results: [{ name: 'HbA1c', specimen: null, date: '2026-06-25' }],
};
const hba1cOut = M.matchOutstanding([HBA1C_LABEL], hba1cReport);
check(
  hba1cOut[0].status === 'resulted' && hba1cOut[0].autoTick === true && hba1cOut[0].confidence === 'confident',
  `12a HbA1c report auto-ticks the HbA1c request (${hba1cOut[0].status}/${hba1cOut[0].autoTick})`
);

// 12b. An HbA1c report does NOT clear an unrelated outstanding FBC / U&E request,
// even though the report name shares the "haemoglobin" token with FBC.
const hba1cMixed = M.matchOutstanding(
  [
    HBA1C_LABEL,
    'Full Blood Count (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
    'Creatinine + Electrolyte Profile, Blood (Dr Natalie Azadian • 04 Feb 2026, 15:03)',
  ],
  hba1cReport
);
check(hba1cMixed[0].status === 'resulted', '12b the HbA1c request is resulted');
check(
  hba1cMixed[1].status === 'outstanding' && hba1cMixed[2].status === 'outstanding',
  '12b an HbA1c report leaves FBC and U&E requests outstanding'
);

// 12c. Lab spelling "Haemoglobin A1c" must NOT feed the FBC analyte signature
// (it shares the 'haemoglobin' token) — the FBC exclude keeps it out.
const hba1cNamedReport = { results: [{ name: 'Haemoglobin A1c', specimen: null, date: '2026-06-25' }] };
const hba1cCov = M.reportCoverage(hba1cNamedReport);
check(hba1cCov.confident.has('hba1c'), '12c "Haemoglobin A1c" report covers hba1c confidently');
check(
  !hba1cCov.confident.has('fbc') && !hba1cCov.tentative.has('fbc'),
  '12c "Haemoglobin A1c" does NOT feed the FBC signature (exclude holds)'
);

// 12d. Regression: a genuine FBC report (with a real Haemoglobin result) still matches.
const fbcRealReport = {
  results: [
    { name: 'Haemoglobin', specimen: null, date: '2026-06-25' },
    { name: 'White cell count', specimen: null, date: '2026-06-25' },
    { name: 'Platelet count', specimen: null, date: '2026-06-25' },
  ],
};
const fbcRealCov = M.reportCoverage(fbcRealReport);
check(fbcRealCov.confident.has('fbc'), '12d a real FBC report still covers fbc (exclude did not over-reach)');

// ── 13. TSH anchor: a TSH-only report confidently clears a thyroid request ─────
// UK labs reflex-test thyroid (TSH first; FT4/FT3 only if TSH abnormal), so a
// TSH-only report is the complete thyroid result and auto-ticks the request.
// A lone FT4/FT3 (no TSH) is unusual and stays tentative.
console.log('TSH anchor (reflex thyroid):');
const tshOnlyReport = {
  // No specimen title — only the TSH analyte, exactly as the reflex report arrives.
  results: [{ name: 'TSH', specimen: null, date: '2026-06-25' }],
};
const tshCov = M.reportCoverage(tshOnlyReport);
check(tshCov.confident.has('tft'), '13 TSH-only report covers tft CONFIDENTLY (anchor)');
check(!tshCov.tentative.has('tft'), '13 TSH-only is not merely tentative');

const tshOut = M.matchOutstanding(
  [{ name: 'Thyroid Testing', requestedDate: '2026-06-01' }],
  tshOnlyReport
);
check(
  tshOut[0].status === 'resulted' && tshOut[0].autoTick === true && tshOut[0].confidence === 'confident',
  `13a TSH-only report auto-ticks the Thyroid Testing request (${tshOut[0].status}/${tshOut[0].autoTick})`
);

// 13b. A lone FT4 (no TSH) is NOT an anchor → stays tentative, never auto-ticks.
const ft4OnlyReport = { results: [{ name: 'Free T4', specimen: null, date: '2026-06-25' }] };
const ft4Cov = M.reportCoverage(ft4OnlyReport);
check(ft4Cov.tentative.has('tft') && !ft4Cov.confident.has('tft'), '13b lone Free T4 is tentative, not confident');
const ft4Out = M.matchOutstanding([{ name: 'Thyroid Testing', requestedDate: '2026-06-01' }], ft4OnlyReport);
check(ft4Out[0].autoTick === false, '13b lone Free T4 does NOT auto-tick the thyroid request');

// 13c. The anchor must not over-reach: TSH does not make any OTHER panel confident.
check(
  !tshCov.confident.has('fbc') && !tshCov.confident.has('lipids') && !tshCov.confident.has('ue'),
  '13c TSH anchor only affects the thyroid panel'
);

// 13d. Strict floor still demotes a TSH-only report (anchor is an inferred-analyte
// signal, not a lab-assigned title) — strict trusts only the specimen-group title.
const tshStrict = M.matchOutstanding([{ name: 'Thyroid Testing', requestedDate: '2026-06-01' }], tshOnlyReport, {
  confidenceFloor: 'strict',
});
check(tshStrict[0].autoTick === false, '13d strict floor: a TSH-only report is not auto-ticked');

// 13e. Resulted-elsewhere (history) is unchanged: a lone TSH in history stays
// tentative (test 8e) — the anchor is THIS-report only. Re-assert here for clarity.
check(tftEnriched[0].confidence === 'tentative', '13e lone TSH in HISTORY remains tentative (anchor is report-only)');

// ── 14. B12 / folate combined haematinics request ─────────────────────────────
// "B12 / Folate" resolved to key=null and never matched. It is a combined request:
// confident (auto-tick) only when BOTH analytes are present; one alone is tentative.
console.log('B12 / folate combined request:');
const B12FOL_LABEL = 'B12 / Folate (Jessica Foreman • 17 Jun 2026, 11:15)';
const b12folDef = M.resolveDef(M.parseRequestLabel(B12FOL_LABEL).name, ['req']);
check(b12folDef && b12folDef.key === 'b12folate', `14 "B12 / Folate" resolves to key=b12folate (was null)`);

// 14a. A report with BOTH B12 and Folate → confident + auto-ticks.
const b12folReport = {
  results: [
    { name: 'B12', specimen: null, date: '2026-06-25' },
    { name: 'Folate', specimen: null, date: '2026-06-25' },
  ],
};
const b12folOut = M.matchOutstanding([{ name: 'B12 / Folate', requestedDate: '2026-06-17' }], b12folReport);
check(
  b12folOut[0].status === 'resulted' && b12folOut[0].autoTick === true && b12folOut[0].confidence === 'confident',
  `14a B12 + Folate report auto-ticks the combined request (${b12folOut[0].status}/${b12folOut[0].autoTick})`
);

// 14b. A B12-ONLY report → tentative, never auto-ticked (folate may still be pending).
const b12OnlyReport = { results: [{ name: 'Serum vitamin B12', specimen: null, date: '2026-06-25' }] };
const b12OnlyOut = M.matchOutstanding([{ name: 'B12 / Folate', requestedDate: '2026-06-17' }], b12OnlyReport);
check(
  b12OnlyOut[0].status === 'resulted' && b12OnlyOut[0].confidence === 'tentative' && b12OnlyOut[0].autoTick === false,
  '14b a B12-only report is tentative for the combined request, never auto-ticked'
);

// 14c. The def must not over-reach onto other haematinics: a ferritin report does
// NOT match the B12/folate request, and a B12/folate report does NOT match ferritin.
const b12folCov = M.reportCoverage(b12folReport);
check(!b12folCov.confident.has('ferritin') && !b12folCov.tentative.has('ferritin'), '14c B12/folate report does not feed ferritin');
const ferritinOnly = M.reportCoverage({ results: [{ name: 'Ferritin', specimen: null, date: '2026-06-25' }] });
check(
  !ferritinOnly.confident.has('b12folate') && !ferritinOnly.tentative.has('b12folate'),
  '14c a ferritin report does not feed b12folate'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
