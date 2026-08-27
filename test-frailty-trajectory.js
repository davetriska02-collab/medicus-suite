// Medicus Suite — Frailty trajectory (problem-severity-progression) tests
// Run with: node test-frailty-trajectory.js
//
// Covers the v3.247.0 live frailty indicator (trend-frailty-worsening):
//   • the shipped rule's shape (safety-monitoring, 65+, mild<moderate<severe ladder)
//   • worsening detection fires ONLY on a recorded new-worst grade inside the window
//   • false-positive protection: improvement, same-grade re-codes, same-date coding
//     tidy-ups, re-reaching an old worst, negated labels, and proxy signals
//     (falls / weight loss / polypharmacy) can never fire it
//   • honest insufficient/stale states: no codes → no_data; ungraded code, single
//     grade, undated grades, or stale grades → neutral 'noted' (never a green claim)
//   • provenance: every coded grade + context-only eFI/Rockwood score in evidence
//   • renderer: safety-monitoring chips carry NO QOF-year tag and NO
//     before-QOF-year warning (they are clinical safety flags, not claim items)

'use strict';

const fs = require('fs');
const path = require('path');
const engine = require('./engine/rules-engine.js');
const CR = require('./shared/chip-renderer.js');
const qof = require('./rules/qof-rules.json');

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

const NOW = '2026-08-01T00:00:00Z';
const RULE = qof.rules.find((r) => r.id === 'trend-frailty-worsening');

// Evaluate the REAL shipped rule against synthetic data. Age defaults to 78
// (inside the 65+ gate) unless the test overrides patientContext.
function frailtyChip(data) {
  const chips = engine.evaluateQofIndicatorRule(
    RULE,
    {
      medications: [],
      observations: [],
      problems: [],
      pastProblems: [],
      patientContext: { ageYears: 78 },
      _registerLookup: {},
      ...data,
    },
    NOW
  );
  return chips.length ? chips[0] : null;
}

// ── Shipped rule integrity ────────────────────────────────────────────────────
console.log('\n--- shipped rule: trend-frailty-worsening ---');
check(!!RULE, 'trend-frailty-worsening exists in qof-rules.json');
check(RULE.enabled === true, 'rule is enabled');
check(RULE.category === 'safety-monitoring', 'tagged category: safety-monitoring (not a QOF claim item)');
check(RULE.check.kind === 'problem-severity-progression', 'uses the problem-severity-progression check kind');
check(RULE.ageRange && RULE.ageRange.min === 65, 'age-gated to 65+ (GMS frailty identification / eFI validation)');
check(RULE.useQofYearFloor === false, 'QOF year floor disabled (trajectory spans years)');
const ladderLevels = (RULE.check.ladder || []).map((l) => l.level);
check(
  ladderLevels.length === 3 &&
    ladderLevels[0] === 'mild' &&
    ladderLevels[1] === 'moderate' &&
    ladderLevels[2] === 'severe',
  'ladder is mild < moderate < severe'
);

// ── Worsening detection (the live trajectory) ────────────────────────────────
console.log('\n--- worsening: recorded new-worst grade inside the window fires ---');
{
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2025-01-10' },
      { label: 'Moderate frailty', codedDate: '2026-06-01' },
    ],
  });
  check(c && c.status === 'not_met', 'mild (2025) → moderate (2026) fires not_met');
  check(
    c && /Worsened: mild → moderate frailty/.test(c.valueText),
    `valueText names the transition (got "${c && c.valueText}")`
  );
  check(
    c && c.valueText.includes('2025-01-10') && c.valueText.includes('2026-06-01'),
    'valueText carries BOTH grade dates (provenance)'
  );
  check(c && c.dateText === '2026-06-01', 'dateText is the latest grade date');
}
{
  const c = frailtyChip({
    problems: [
      { label: 'Moderate frailty', codedDate: '2024-11-01' },
      { label: 'Severe frailty', codedDate: '2026-03-15' },
    ],
  });
  check(c && c.status === 'not_met', 'moderate → severe fires');
}
{
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2024-10-01' },
      { label: 'Severe frailty', codedDate: '2026-02-01' },
    ],
  });
  check(c && c.status === 'not_met', 'mild → severe (skipping moderate) fires');
}
{
  // The common coding pattern: the superseded grade is ENDED (past problems),
  // only the current grade stays active. The trajectory must still be seen.
  const c = frailtyChip({
    problems: [{ label: 'Moderate frailty', codedDate: '2026-05-01' }],
    pastProblems: [{ label: 'Mild frailty', codedDate: '2024-09-01', status: 'past' }],
  });
  check(c && c.status === 'not_met', 'superseded grade in PAST problems still forms the trajectory');
}
{
  // Rockwood CFS phrasing ("moderately frail" / "severely frail") grades correctly.
  const c = frailtyChip({
    problems: [
      { label: 'Clinical frailty scale level 5 - mildly frail', codedDate: '2025-02-01' },
      { label: 'Clinical frailty scale level 6 - moderately frail', codedDate: '2026-04-01' },
    ],
  });
  check(c && c.status === 'not_met', 'Rockwood "mildly frail" → "moderately frail" phrasing fires');
}
{
  // "Very severely frail" (CFS 8) must land on severe via the highest-first scan.
  const c = frailtyChip({
    problems: [
      { label: 'Severely frail', codedDate: '2025-01-01' },
      { label: 'Very severely frail', codedDate: '2026-05-01' },
    ],
  });
  check(c && c.status === 'achieved', '"very severely frail" grades as severe (no false severe→severe "worsening")');
}

// ── False-positive protection ────────────────────────────────────────────────
console.log('\n--- false positives: improvement / stability / tidy-ups never fire ---');
{
  const c = frailtyChip({
    problems: [
      { label: 'Severe frailty', codedDate: '2024-10-01' },
      { label: 'Moderate frailty', codedDate: '2026-05-01' },
    ],
  });
  check(c && c.status === 'achieved', 'improvement (severe → moderate) does NOT fire');
  check(c && /no recorded worsening/.test(c.valueText), 'improvement valueText says "no recorded worsening"');
}
{
  const c = frailtyChip({
    problems: [
      { label: 'Moderate frailty', codedDate: '2024-10-01' },
      { label: 'Moderate frailty', codedDate: '2026-05-01' },
    ],
  });
  check(c && c.status === 'achieved', 'same-grade re-code (moderate → moderate) does NOT fire');
}
{
  // Same-day mild+moderate is one grading episode (coding tidy-up), not a trajectory.
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2026-05-01' },
      { label: 'Moderate frailty', codedDate: '2026-05-01' },
    ],
  });
  check(c && c.status === 'noted', 'same-date mild+moderate collapses to one episode → noted, not worsening');
  check(
    c && /first recorded grade/.test(c.valueText),
    'tidy-up valueText explains there is no earlier grade to compare'
  );
}
{
  // Re-reaching an OLD worst is not a NEW worst: severe(2023) → moderate(2024) → severe(2026).
  const c = frailtyChip({
    problems: [
      { label: 'Severe frailty', codedDate: '2023-03-01' },
      { label: 'Moderate frailty', codedDate: '2024-06-01' },
      { label: 'Severe frailty', codedDate: '2026-05-01' },
    ],
  });
  check(c && c.status === 'achieved', 're-reaching a previous worst grade does NOT fire (not a new worst)');
}
{
  const c = frailtyChip({ problems: [{ label: 'At risk of severe frailty', codedDate: '2026-01-01' }] });
  check(c && c.status === 'no_data', '"At risk of severe frailty" is NOT a grade (negation-aware)');
}
{
  const c = frailtyChip({ problems: [{ label: 'No frailty', codedDate: '2026-01-01' }] });
  check(c && c.status === 'no_data', '"No frailty" is NOT a diagnosis (negation-aware)');
}
{
  // Proxy signals must NEVER label frailty or drive the trajectory.
  const c = frailtyChip({
    problems: [
      { label: 'Recurrent falls', codedDate: '2026-02-01' },
      { label: 'Unintentional weight loss', codedDate: '2026-03-01' },
      { label: 'Polypharmacy', codedDate: '2026-04-01' },
    ],
  });
  check(c && c.status === 'no_data', 'falls + weight loss + polypharmacy alone → no_data (proxies never fire it)');
  check(
    c && c.valueText === 'No recorded frailty diagnosis or grade',
    'proxy-only valueText is the honest no-data message'
  );
}

// ── Honest insufficient / stale states ───────────────────────────────────────
console.log('\n--- insufficient/stale evidence: neutral noted, never a green claim ---');
{
  const c = frailtyChip({ problems: [] });
  check(c && c.status === 'no_data', 'no frailty codes at all → no_data');
}
{
  const c = frailtyChip({ problems: [{ label: 'Moderate frailty', codedDate: '2026-04-01' }] });
  check(c && c.status === 'noted', 'a single grade → noted (trajectory not assessable), NOT achieved');
  check(c && /first recorded grade/.test(c.valueText), 'single-grade valueText explains why');
}
{
  // Worsening exists but the newest grade is older than the 24-month window:
  // an old worsening is not a LIVE trajectory — and stale grades cannot support
  // a green "no worsening" claim either.
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2020-01-01' },
      { label: 'Severe frailty', codedDate: '2022-06-01' },
    ],
  });
  check(c && c.status === 'noted', 'stale worsening (latest grade 2022, now 2026) → noted, not red');
  check(c && /older than 24-month window/.test(c.valueText), 'stale valueText names the window');
  check(c && /trajectory not current/.test(c.valueText), 'stale valueText says the trajectory is not current');
}
{
  const c = frailtyChip({ problems: [{ label: 'Severe frailty', codedDate: null }] });
  check(c && c.status === 'noted', 'undated grade → noted (cannot order)');
  check(c && /date unknown/.test(c.valueText), 'undated valueText says date unknown');
}
{
  // A dated grade + an undated higher grade: the undated one cannot join the
  // trajectory (would fabricate an ordering) — single-comparable-grade → noted.
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2026-05-01' },
      { label: 'Severe frailty', codedDate: null },
    ],
  });
  check(c && c.status === 'noted', 'undated grade never fabricates a trajectory against a dated one');
}
{
  const c = frailtyChip({ problems: [{ label: 'Frailty', codedDate: '2026-03-01' }] });
  check(c && c.status === 'noted', 'bare ungraded "Frailty" code → noted');
  check(c && /without a grade/.test(c.valueText), 'ungraded valueText says no grade recorded');
}
{
  // FUTURE-dated newest grade: nowMs - latestMs is negative, which trivially
  // passes a naive <= withinMs recency test — the guard must stop a
  // future-dated "worsening" from firing red, and must not reuse the stale
  // "older than window" copy (factually wrong for a date AHEAD of the window).
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2025-01-10' },
      { label: 'Moderate frailty', codedDate: '2027-02-01' },
    ],
  });
  check(c && c.status !== 'not_met', 'future-dated worsening NEVER fires red');
  check(c && c.status === 'noted', 'future-dated worsening → neutral noted');
  check(c && /future-dated \(2027-02-01\)/.test(c.valueText), 'future valueText names the future date');
  check(
    c && /verify the coding date/.test(c.valueText),
    'future valueText tells the clinician to verify the coding date'
  );
  check(c && !/older than/.test(c.valueText), 'future valueText does NOT claim the grade is older than the window');
  check(c && c.days == null, 'no nonsense negative "days ago" for a future date');
  const traj = ((c.evidence && c.evidence.facts) || []).find((f) => f.label === 'Trajectory');
  check(traj && /future-dated/.test(traj.value), 'evidence Trajectory fact says future-dated');
  check(
    traj && /verify the coding date/.test(traj.detail || ''),
    'evidence Trajectory fact prompts coding-date verification'
  );
}
{
  // A single future-dated grade must hit the future copy, not "first recorded grade".
  const c = frailtyChip({ problems: [{ label: 'Severe frailty', codedDate: '2027-06-01' }] });
  check(
    c && c.status === 'noted' && /future-dated/.test(c.valueText),
    'single future-dated grade → noted with future copy'
  );
}
{
  // A future-dated IMPROVEMENT must not claim green "no worsening" either —
  // no trajectory of any colour may be asserted from an untrustworthy date.
  const c = frailtyChip({
    problems: [
      { label: 'Severe frailty', codedDate: '2024-10-01' },
      { label: 'Moderate frailty', codedDate: '2027-02-01' },
    ],
  });
  check(
    c && c.status === 'noted' && /future-dated/.test(c.valueText),
    'future-dated improvement → noted, never a green claim'
  );
}
{
  // Process codes are not diagnoses: genericExclude keeps them out entirely.
  const c = frailtyChip({
    problems: [
      { label: 'Frailty screening declined', codedDate: '2026-03-01' },
      { label: 'Frailty assessment', codedDate: '2026-02-01' },
    ],
  });
  check(c && c.status === 'no_data', 'frailty screening/assessment process codes are NOT a recorded diagnosis');
}

// ── Age gating (65+, fail-open) ───────────────────────────────────────────────
console.log('\n--- age gate: 65+ with fail-open unknown age ---');
{
  const worsening = [
    { label: 'Mild frailty', codedDate: '2025-01-10' },
    { label: 'Moderate frailty', codedDate: '2026-06-01' },
  ];
  check(frailtyChip({ problems: worsening, patientContext: { ageYears: 50 } }) === null, 'suppressed at age 50');
  check(frailtyChip({ problems: worsening, patientContext: { ageYears: 65 } }) !== null, 'fires at age 65');
  check(
    frailtyChip({ problems: worsening, patientContext: { ageYears: null } }) !== null,
    'fires when age unknown (fail-open)'
  );
}

// ── Provenance: evidence panel content ───────────────────────────────────────
console.log('\n--- evidence: every grade listed, score is context-only, source disclosed ---');
{
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2025-01-10' },
      { label: 'Moderate frailty', codedDate: '2026-06-01' },
    ],
    observations: [{ name: 'Electronic frailty index', value: '0.24', date: '2026-06-01' }],
  });
  const facts = (c.evidence && c.evidence.facts) || [];
  const traj = facts.find((f) => f.label === 'Trajectory');
  check(traj && /worsened — mild → moderate/.test(traj.value), 'Trajectory fact names the transition');
  const grades = facts.filter((f) => f.label === 'Coded grade');
  check(grades.length === 2, 'BOTH coded grades listed as evidence facts');
  check(
    grades.some((f) => f.value.includes('Mild frailty')) && grades.some((f) => f.value.includes('Moderate frailty')),
    'grade facts quote the verbatim problem labels'
  );
  const score = facts.find((f) => f.label === 'Recorded score');
  check(!!score && score.value.includes('0.24'), 'eFI score observation shown in evidence');
  check(score && /context only/.test(score.detail), 'score fact is explicitly context-only');
  const src = facts.find((f) => f.label === 'Source');
  check(src && /no score computed or inferred/.test(src.value), 'Source fact discloses nothing is computed/inferred');
}
{
  // The eFI score alone (no coded grade) must NOT create a status beyond what
  // grades support — score is display-only.
  const c = frailtyChip({
    problems: [{ label: 'Moderate frailty', codedDate: '2026-04-01' }],
    observations: [{ name: 'Electronic frailty index', value: '0.41', date: '2026-06-01' }],
  });
  check(c && c.status === 'noted', 'a high eFI score never upgrades the status (recorded grades only)');
}
{
  // An undated grade is excluded from the trajectory but still LISTED (nothing
  // silently dropped).
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2026-05-01' },
      { label: 'Severe frailty', codedDate: null },
    ],
  });
  const facts = (c.evidence && c.evidence.facts) || [];
  const undatedFact = facts.find((f) => f.label === 'Coded grade' && /Severe/.test(f.value));
  check(!!undatedFact, 'undated grade still listed in evidence');
  check(
    undatedFact && /excluded from trajectory/.test(undatedFact.detail || ''),
    'undated grade marked as excluded from trajectory'
  );
}

// ── End-to-end through evaluatePatient (the production entry point) ──────────
console.log('\n--- end-to-end: evaluatePatient with the full shipped ruleset ---');
{
  const chips = engine.evaluatePatient([], [], [RULE], {
    now: NOW,
    problems: [{ label: 'Moderate frailty', codedDate: '2026-06-01' }],
    pastProblems: [{ label: 'Mild frailty', codedDate: '2024-09-01', status: 'past' }],
    patientContext: { ageYears: 82 },
  });
  const c = chips.find((x) => x.ruleId === 'trend-frailty-worsening');
  check(!!c && c.status === 'not_met', 'evaluatePatient carries pastProblems through to the progression check');
  check(c && c.category === 'safety-monitoring', 'chip carries the safety-monitoring category');
}

// ── Renderer: safety-monitoring chips are not dressed as QOF ─────────────────
console.log('\n--- renderer: no QOF year tag / before-QOF-year warning on safety-monitoring ---');
{
  const c = frailtyChip({
    problems: [
      { label: 'Mild frailty', codedDate: '2025-01-10' },
      { label: 'Moderate frailty', codedDate: '2026-06-01' },
    ],
  });
  const html = CR.renderQofIndicatorChip(c);
  check(!html.includes('sent-qof-year'), 'no QOF year tag on a safety-monitoring chip');
  check(!html.includes('⚠ before'), 'no before-QOF-year warning on a safety-monitoring chip');
  check(html.includes('Worsened: mild → moderate frailty'), 'valueText rendered');
  check(html.includes('sent-chip-clickable'), 'chip is evidence-clickable');
}
{
  // Guard: the suppression must NOT leak onto ordinary QOF chips.
  const plain = {
    type: 'qof-indicator',
    ruleId: 'qof-test',
    indicatorCode: 'TEST01',
    indicatorName: 'Test indicator',
    status: 'not_met',
    category: null,
    qofYear: '2026/27',
    qofYearStart: '2026-04-01',
    valueText: '160/100',
    dateText: '2026-01-01',
    days: 120,
  };
  const html = CR.renderQofIndicatorChip(plain);
  check(html.includes('sent-qof-year'), 'ordinary QOF chip still shows the year tag');
  check(html.includes('⚠ before'), 'ordinary QOF chip still warns when evidence predates the QOF year');
}
{
  // The sentinel panel's fallback renderer must mirror the same suppression.
  const src = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'sentinel', 'sentinel.js'), 'utf8');
  check(
    /isSafetyMonitoring = chip\.category === 'safety-monitoring'/.test(src),
    'sentinel.js fallback renderer carries the safety-monitoring guard'
  );
}

// ── Never-claim-completion guard (mirror of the UI-copy rule) ─────────────────
console.log('\n--- copy: the chip never claims certainty it does not have ---');
{
  // 'achieved' here means "no recorded worsening", NOT "patient is stable".
  const c = frailtyChip({
    problems: [
      { label: 'Severe frailty', codedDate: '2024-10-01' },
      { label: 'Moderate frailty', codedDate: '2026-05-01' },
    ],
  });
  check(c && !/stable|improv/i.test(c.valueText), 'no "stable"/"improved" claims — only "no recorded worsening"');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
