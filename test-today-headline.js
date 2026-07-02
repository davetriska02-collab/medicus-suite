// Medicus Suite — today-headline.js unit tests
// Run with: node test-today-headline.js
//
// Pins:
//   • red leads amber leads quiet
//   • waiting room: amber ≥10 min, red ≥20 min, matches today.js card logic
//   • demand: only fires when thresholds.enabled, red beats amber
//   • triage: oldest-unanswered clause is neutral (never outranks a real red/amber)
//   • sweep: "not run today" clause is neutral, omitted once sweep has run
//   • quiet state uses shared/provenance.js wording ("last checked HH:MM")
//   • still-loading cards (null data) contribute nothing — no false "all quiet"
//   • max 3 clauses joined with " · "

'use strict';

let passed = 0;
let failed = 0;

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

async function runTests() {
  const modPath = new URL('side-panel/modules/today/today-headline.js', `file://${process.cwd().replace(/\\/g, '/')}/`)
    .href;

  let buildHeadline;
  try {
    const mod = await import(modPath);
    buildHeadline = mod.buildHeadline;
    check(typeof buildHeadline === 'function', 'buildHeadline imported');
  } catch (e) {
    console.error('FATAL: could not import today-headline.js:', e.message);
    process.exitCode = 1;
    return;
  }

  const NOW = new Date('2026-07-01T09:14:00').getTime();

  // ── 1. All-quiet: no data at all → quiet, uses provenance wording ─────────
  console.log('\n--- quiet state ---');
  {
    const r = buildHeadline({ now: NOW });
    check(r.severity === null, `no data → severity null (got ${r.severity})`);
    check(r.text.startsWith('Nothing needs you right now'), `quiet text starts correctly (got: "${r.text}")`);
    check(r.text.includes('last checked'), `quiet text includes "last checked" (got: "${r.text}")`);
  }

  // ── 2. Quiet with all cards loaded and clear ───────────────────────────────
  console.log('\n--- quiet with clear cards ---');
  {
    const r = buildHeadline({
      wrData: { patients: [], error: null },
      rmData: { configured: true, buckets: {}, error: null },
      demandData: { medical: 2, admin: 1, thresholds: { medical: { enabled: false }, admin: { enabled: false } } },
      sweepData: { lastRun: { runAt: new Date(NOW).toISOString(), results: [] } },
      now: NOW,
    });
    check(r.severity === null, `all clear → severity null (got ${r.severity})`);
    check(r.text.includes('Nothing needs you right now'), `all clear → quiet text (got: "${r.text}")`);
  }

  // ── 3. Quiet uses formatProvenance when supplied ───────────────────────────
  console.log('\n--- quiet uses shared provenance formatter ---');
  {
    let calledWith = null;
    const fakeFormatProvenance = (opts) => {
      calledWith = opts;
      return 'as at 09:14';
    };
    const r = buildHeadline({ now: NOW, formatProvenance: fakeFormatProvenance });
    check(calledWith !== null && calledWith.asOf === NOW, 'formatProvenance called with asOf=now');
    check(r.text === 'Nothing needs you right now — last checked 09:14', `uses formatter output (got: "${r.text}")`);
  }

  // ── 4. Waiting room amber (≥10 min, <20 min) ───────────────────────────────
  console.log('\n--- waiting room amber ---');
  {
    const r = buildHeadline({
      wrData: {
        patients: [
          { name: 'A', mins: 12 },
          { name: 'B', mins: 4 },
        ],
        error: null,
      },
      now: NOW,
    });
    check(r.severity === 'amber', `12 min max wait → amber (got ${r.severity})`);
    check(r.text.includes('2 patients waiting'), `count in text (got: "${r.text}")`);
    check(r.text.includes('longest 12 min'), `longest wait in text (got: "${r.text}")`);
  }

  // ── 5. Waiting room red (≥20 min) ──────────────────────────────────────────
  console.log('\n--- waiting room red ---');
  {
    const r = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 22 }], error: null },
      now: NOW,
    });
    check(r.severity === 'red', `22 min max wait → red (got ${r.severity})`);
    check(r.text.includes('1 patient waiting'), `singular patient (got: "${r.text}")`);
    check(r.text.includes('longest 22 min'), `longest wait shown (got: "${r.text}")`);
  }

  // ── 6. Waiting room under amber threshold → no clause ──────────────────────
  console.log('\n--- waiting room under threshold ---');
  {
    const r = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 4 }], error: null },
      now: NOW,
    });
    check(r.severity === null, `4 min wait → below amber, no clause (got ${r.severity})`);
  }

  // ── 7. Waiting room error/noCode → no clause (not a false red) ────────────
  console.log('\n--- waiting room error/noCode ---');
  {
    const rErr = buildHeadline({ wrData: { patients: [], error: 'boom' }, now: NOW });
    check(rErr.severity === null, 'wrData.error → no waiting clause');
    const rNoCode = buildHeadline({ wrData: { patients: [], error: null, noCode: true }, now: NOW });
    check(rNoCode.severity === null, 'wrData.noCode → no waiting clause');
  }

  // ── 8. Demand: only fires when enabled + over threshold ────────────────────
  console.log('\n--- demand thresholds ---');
  {
    const rDisabled = buildHeadline({
      demandData: { medical: 999, admin: 999, thresholds: { medical: { enabled: false }, admin: { enabled: false } } },
      now: NOW,
    });
    check(rDisabled.severity === null, 'thresholds disabled → no demand clause regardless of count');

    const rAmber = buildHeadline({
      demandData: {
        medical: 35,
        admin: 5,
        thresholds: { medical: { amber: 30, red: 60, enabled: true }, admin: { amber: 20, red: 40, enabled: true } },
      },
      now: NOW,
    });
    check(rAmber.severity === 'amber', `medical 35 ≥ amber 30, < red 60 → amber (got ${rAmber.severity})`);
    check(rAmber.text.includes('35 medical'), `demand text includes count (got: "${rAmber.text}")`);
    check(rAmber.text.includes('unread'), `demand text includes "unread" (got: "${rAmber.text}")`);

    const rRed = buildHeadline({
      demandData: {
        medical: 65,
        admin: 5,
        thresholds: { medical: { amber: 30, red: 60, enabled: true }, admin: { amber: 20, red: 40, enabled: true } },
      },
      now: NOW,
    });
    check(rRed.severity === 'red', `medical 65 ≥ red 60 → red (got ${rRed.severity})`);
  }

  // ── 8b. Slots breach clause (item 9) ────────────────────────────────────────
  console.log('\n--- slots breach clause ---');
  {
    const rNone = buildHeadline({ slotsData: { count: 20, error: null, breaches: [] }, now: NOW });
    check(rNone.severity === null, 'no breaches → no slots clause');

    const rAmber = buildHeadline({
      slotsData: {
        count: 20,
        error: null,
        breaches: [{ typeName: 'GP Routine', threshold: 3, count: 2, level: 'amber' }],
      },
      now: NOW,
    });
    check(rAmber.severity === 'amber', `amber breach → amber severity (got ${rAmber.severity})`);
    check(rAmber.text.includes('GP Routine down to 2 slots'), `amber breach text (got: "${rAmber.text}")`);

    const rRed = buildHeadline({
      slotsData: { count: 20, error: null, breaches: [{ typeName: 'Nurse', threshold: 0, count: 0, level: 'red' }] },
      now: NOW,
    });
    check(rRed.severity === 'red', `red breach (zero left) → red severity (got ${rRed.severity})`);
    // Lead clause is capitalised (see "capitalisation" section below), so
    // this is "No Nurse..." when it's the sentence's first clause.
    check(/no Nurse slots left/i.test(rRed.text), `red breach text (got: "${rRed.text}")`);

    const rMultiple = buildHeadline({
      slotsData: {
        count: 20,
        error: null,
        breaches: [
          { typeName: 'Nurse', threshold: 0, count: 0, level: 'red' },
          { typeName: 'GP Routine', threshold: 3, count: 1, level: 'amber' },
        ],
      },
      now: NOW,
    });
    check(rMultiple.text.includes('+1 more'), `multiple breaches note the extra count (got: "${rMultiple.text}")`);

    const rNoCode = buildHeadline({ slotsData: { count: null, error: null, noCode: true, breaches: [] }, now: NOW });
    check(rNoCode.severity === null, 'slotsData.noCode → no slots clause');

    const rErr = buildHeadline({ slotsData: { count: null, error: 'boom', breaches: [] }, now: NOW });
    check(rErr.severity === null, 'slotsData.error → no slots clause (not a false alert)');

    const rNull = buildHeadline({ slotsData: null, now: NOW });
    check(rNull.severity === null, 'null slotsData (still loading) → no slots clause');
  }

  // ── 8c. Slots breach ordering vs waiting room / demand ─────────────────────
  console.log('\n--- slots breach ordering ---');
  {
    // Waiting room red should still lead a slots amber breach.
    const r = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 25 }], error: null },
      slotsData: {
        count: 20,
        error: null,
        breaches: [{ typeName: 'GP Routine', threshold: 3, count: 2, level: 'amber' }],
      },
      now: NOW,
    });
    check(r.severity === 'red', `waiting red still leads with a slots amber breach present (got ${r.severity})`);
    check(
      r.text.indexOf('waiting') < r.text.indexOf('GP Routine'),
      `red clause ordered before amber slots clause (got: "${r.text}")`
    );

    // A red slots breach with no other red clause should drive overall severity red.
    const r2 = buildHeadline({
      demandData: {
        medical: 35,
        admin: 0,
        thresholds: { medical: { amber: 30, red: 60, enabled: true }, admin: { enabled: false } },
      },
      slotsData: { count: 20, error: null, breaches: [{ typeName: 'Nurse', threshold: 0, count: 0, level: 'red' }] },
      now: NOW,
    });
    check(r2.severity === 'red', `red slots breach outranks a demand-amber clause (got ${r2.severity})`);
    check(
      r2.text.indexOf('Nurse') < r2.text.indexOf('medical'),
      `red slots clause ordered before amber demand clause (got: "${r2.text}")`
    );
  }

  // ── 9. Red leads amber: waiting red + demand amber → red wins, both shown ──
  console.log('\n--- ordering: red leads amber ---');
  {
    const r = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 25 }], error: null },
      demandData: {
        medical: 35,
        admin: 0,
        thresholds: { medical: { amber: 30, red: 60, enabled: true }, admin: { enabled: false } },
      },
      now: NOW,
    });
    check(r.severity === 'red', `waiting red + demand amber → overall red (got ${r.severity})`);
    check(r.text.includes('waiting'), `waiting clause present (got: "${r.text}")`);
    check(r.text.includes('medical'), `demand clause present too (got: "${r.text}")`);
    check(r.text.indexOf('waiting') < r.text.indexOf('medical'), `red clause ordered before amber (got: "${r.text}")`);
  }

  // ── 10. Triage clause is neutral — never overrides a red/amber lead ────────
  console.log('\n--- triage clause is neutral ---');
  {
    // Use an explicit ms timestamp (not NOW - offset with a Date-string NOW,
    // which is already an epoch number here — kept explicit for clarity).
    const tenMinAgoMs = NOW - 10 * 60 * 1000;
    const r = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 25 }], error: null },
      rmData: { configured: true, buckets: {}, error: null },
      oldestUnansweredMs: tenMinAgoMs,
      now: NOW,
    });
    check(r.severity === 'red', `red waiting clause still leads despite triage clause (got ${r.severity})`);
    check(r.text.includes('oldest unanswered request waiting 10m'), `triage clause text present (got: "${r.text}")`);

    // Triage clause alone (no red/amber elsewhere) → overall severity is null
    const rAlone = buildHeadline({
      rmData: { configured: true, buckets: {}, error: null },
      oldestUnansweredMs: tenMinAgoMs,
      now: NOW,
    });
    check(rAlone.severity === null, `triage clause alone → severity null (got ${rAlone.severity})`);
    check(/oldest unanswered/i.test(rAlone.text), `triage-only text present (got: "${rAlone.text}")`);
  }

  // ── 11. Triage clause omitted when RM not configured/errored/no data ───────
  console.log('\n--- triage clause omission ---');
  {
    const rNotConfigured = buildHeadline({
      rmData: { configured: false, error: null },
      oldestUnansweredMs: NOW - 60000,
      now: NOW,
    });
    check(!rNotConfigured.text.includes('unanswered'), 'RM not configured → no triage clause');

    const rError = buildHeadline({
      rmData: { configured: true, buckets: {}, error: 'boom' },
      oldestUnansweredMs: NOW - 60000,
      now: NOW,
    });
    check(!rError.text.includes('unanswered'), 'RM errored → no triage clause');

    const rNoOldest = buildHeadline({
      rmData: { configured: true, buckets: {}, error: null },
      oldestUnansweredMs: null,
      now: NOW,
    });
    check(!rNoOldest.text.includes('unanswered'), 'no oldestUnansweredMs → no triage clause');
  }

  // ── 12. Sweep clause: "not run today" only when lastRun is absent ──────────
  console.log('\n--- sweep clause ---');
  {
    const rNotRun = buildHeadline({ sweepData: { lastRun: null }, now: NOW });
    check(/sweep not run today/i.test(rNotRun.text), `sweep-not-run clause present (got: "${rNotRun.text}")`);
    check(rNotRun.severity === null, 'sweep-not-run clause is neutral severity');

    const rRan = buildHeadline({
      sweepData: { lastRun: { runAt: new Date(NOW).toISOString(), results: [] } },
      now: NOW,
    });
    check(!rRan.text.includes('sweep not run'), 'sweep ran today → no sweep clause');
  }

  // ── 13. Still-loading cards (null) contribute nothing, not false "all clear" ─
  console.log('\n--- still-loading cards ---');
  {
    const r = buildHeadline({ wrData: null, rmData: null, demandData: null, sweepData: null, now: NOW });
    check(r.severity === null, 'all-null data → quiet, not a crash');
    check(r.text.includes('Nothing needs you right now'), 'all-null data → quiet wording (same as genuinely clear)');
  }

  // ── 14. Max 3 clauses joined with " · " ─────────────────────────────────────
  console.log('\n--- max 3 clauses ---');
  {
    const r = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 25 }], error: null },
      demandData: {
        medical: 65,
        admin: 45,
        thresholds: { medical: { amber: 30, red: 60, enabled: true }, admin: { amber: 20, red: 40, enabled: true } },
      },
      rmData: { configured: true, buckets: {}, error: null },
      oldestUnansweredMs: NOW - 5 * 60 * 1000,
      sweepData: { lastRun: null },
      now: NOW,
    });
    const clauseCount = r.text.split(' · ').length;
    check(clauseCount <= 3, `at most 3 clauses joined (got ${clauseCount}: "${r.text}")`);
    check(r.severity === 'red', `severity still red with many clauses (got ${r.severity})`);
  }

  // ── 15. A letter-leading clause is capitalised (digit-leading is left as-is,
  //       matching the plan's own worked example "3 patients waiting…") ──────
  console.log('\n--- capitalisation ---');
  {
    // Waiting/demand clauses lead with a digit — never touched by capitalise().
    const rDigitLead = buildHeadline({
      wrData: { patients: [{ name: 'A', mins: 25 }], error: null },
      now: NOW,
    });
    check(/^\d/.test(rDigitLead.text), `digit-led clause left as-is (got: "${rDigitLead.text}")`);

    // Sweep-only clause leads with a letter ("sweep not run today") and must
    // be capitalised for a standalone sentence.
    const rLetterLead = buildHeadline({ sweepData: { lastRun: null }, now: NOW });
    check(/^[A-Z]/.test(rLetterLead.text), `letter-led clause is capitalised (got: "${rLetterLead.text}")`);
  }

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
