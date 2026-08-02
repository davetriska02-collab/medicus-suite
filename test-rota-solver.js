// Medicus Suite — Rota solver tests (ported from medicus-rota-manager)
// Run with: node test-rota-solver.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { solveRota, DEFAULT_WEIGHTS } = await R('engine/solver.js');
  const { newStaff, DEFAULT_SETTINGS } = await R('shared/model.js');
  const { weekDates, addDays } = await R('shared/time.js');

  /* ---- original test body, unchanged ---- */
  // --- Helpers ---

  let nextId = 1;
  const uid = () => String(nextId++);

  // Build a minimal entry
  const mkEntry = (id, staffId, date, period, typeId, opts = {}) => ({
    id,
    staffId,
    date,
    period,
    typeId,
    status: opts.status || 'planned',
    source: opts.source || 'template',
    ...opts,
  });

  // A week of Mon–Fri entries for a GP at the given type
  function weekEntries(staffId, dates, typeId, status = 'planned') {
    const out = [];
    for (const date of dates) {
      for (const period of ['am', 'pm']) {
        out.push(mkEntry(uid(), staffId, date, period, typeId, { status }));
      }
    }
    return out;
  }

  // Settings: only Monday open (keeps test fixtures small)
  const MON_ONLY = { ...DEFAULT_SETTINGS, openDays: ['mon'], bankHolidays: [] };

  // A week starting 2026-06-08 (Monday)
  const WEEK = weekDates('2026-06-08');
  const MON = WEEK[0]; // '2026-06-08'

  // ────────────────────────────────────────────────────────────────────────────
  // Test 1: Coverage — gaps filled; nurses/registrars never assigned duty
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp = newStaff({ id: uid(), name: 'Dr GP', dutyEligible: true, contractedSessions: 8 });
    const nurse = newStaff({ id: uid(), name: 'Nurse N', role: 'nurse', dutyEligible: false });
    const reg = newStaff({
      id: uid(),
      name: 'Dr Reg',
      employmentType: 'registrar',
      dutyEligible: false,
      contractedSessions: 8,
    });

    const entries = [
      mkEntry(uid(), gp.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gp.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), nurse.id, MON, 'am', 'surgery'),
      mkEntry(uid(), reg.id, MON, 'am', 'surgery'),
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp, nurse, reg],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 4000 },
    });

    // Duty gap should be filled
    assert.equal(res.breakdown.dutyGap, 0, 'Test 1: duty gap not filled');

    // The GP must have duty assigned somewhere
    const gpDuty = res.changes.filter((c) => c.staffId === gp.id && c.to === 'duty');
    assert.ok(gpDuty.length > 0, 'Test 1: GP not assigned duty');

    // Nurse and registrar must never be assigned duty
    const badDuty = res.changes.filter((c) => (c.staffId === nurse.id || c.staffId === reg.id) && c.to === 'duty');
    assert.equal(badDuty.length, 0, 'Test 1: nurse or registrar assigned duty');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 2: Locked entries — manual/covered/vacancy/confirmed never changed
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp1 = newStaff({ id: uid(), name: 'Dr A', dutyEligible: true, contractedSessions: 8 });
    const gp2 = newStaff({ id: uid(), name: 'Dr B', dutyEligible: true, contractedSessions: 8 });

    const lockedManual = mkEntry(uid(), gp1.id, MON, 'am', 'surgery', { source: 'manual' });
    const lockedConfirmed = mkEntry(uid(), gp1.id, MON, 'pm', 'surgery', { status: 'confirmed' });
    const lockedVacancy = mkEntry(uid(), gp2.id, MON, 'am', 'surgery', { status: 'vacancy' });
    const lockedCovered = mkEntry(uid(), gp2.id, MON, 'pm', 'surgery', { status: 'covered' });

    const res = solveRota({
      dates: WEEK,
      entries: [lockedManual, lockedConfirmed, lockedVacancy, lockedCovered],
      staff: [gp1, gp2],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 4000 },
    });

    const changedIds = new Set(res.changes.map((c) => c.entryId));
    assert.ok(!changedIds.has(lockedManual.id), 'Test 2: manual entry changed');
    assert.ok(!changedIds.has(lockedConfirmed.id), 'Test 2: confirmed entry changed');
    assert.ok(!changedIds.has(lockedVacancy.id), 'Test 2: vacancy entry changed');
    assert.ok(!changedIds.has(lockedCovered.id), 'Test 2: covered entry changed');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3a: Fairness — two equal GPs over 4 duty slots ⇒ 2/2 split
  // ────────────────────────────────────────────────────────────────────────────
  {
    const settings4 = { ...DEFAULT_SETTINGS, openDays: ['mon', 'tue'], bankHolidays: [] };
    // Two weeks: Mon + Tue for 2 AM slots + 2 PM slots (4 duty slots total)
    const dates2 = [MON, addDays(MON, 1)]; // Mon + Tue of same week

    const gpA = newStaff({ id: uid(), name: 'Dr Alpha', dutyEligible: true, contractedSessions: 8 });
    const gpB = newStaff({ id: uid(), name: 'Dr Beta', dutyEligible: true, contractedSessions: 8 });

    const entries = [
      mkEntry(uid(), gpA.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpA.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpA.id, addDays(MON, 1), 'am', 'surgery'),
      mkEntry(uid(), gpA.id, addDays(MON, 1), 'pm', 'surgery'),
      mkEntry(uid(), gpB.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpB.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpB.id, addDays(MON, 1), 'am', 'surgery'),
      mkEntry(uid(), gpB.id, addDays(MON, 1), 'pm', 'surgery'),
    ];

    const res = solveRota({
      dates: dates2,
      entries,
      staff: [gpA, gpB],
      leaveList: [],
      settings: settings4,
      options: { seed: 42, iterations: 6000 },
    });

    // Count duty per GP in final state
    const dutyOf = (id) => {
      const origDuty = entries.filter((e) => e.staffId === id && e.typeId === 'duty').length;
      const gained = res.changes.filter((c) => c.staffId === id && c.to === 'duty').length;
      const lost = res.changes.filter((c) => c.staffId === id && c.from === 'duty').length;
      return origDuty + gained - lost;
    };

    assert.equal(dutyOf(gpA.id), 2, 'Test 3a: Dr Alpha should have 2 duty sessions');
    assert.equal(dutyOf(gpB.id), 2, 'Test 3a: Dr Beta should have 2 duty sessions');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3b: Fairness — pro-rata: 8-session vs 4-session GP over 6 duty slots
  // ────────────────────────────────────────────────────────────────────────────
  {
    // 3 Mon-Fri open days = 3 AM + 3 PM = 6 duty slots
    const settings3d = { ...DEFAULT_SETTINGS, openDays: ['mon', 'tue', 'wed'], bankHolidays: [] };
    const dates3d = [MON, addDays(MON, 1), addDays(MON, 2)];

    const gpBig = newStaff({ id: uid(), name: 'Dr Big', dutyEligible: true, contractedSessions: 8 });
    const gpSmall = newStaff({ id: uid(), name: 'Dr Small', dutyEligible: true, contractedSessions: 4 });

    const entries = [];
    for (const date of dates3d) {
      for (const period of ['am', 'pm']) {
        entries.push(mkEntry(uid(), gpBig.id, date, period, 'surgery'));
        entries.push(mkEntry(uid(), gpSmall.id, date, period, 'surgery'));
      }
    }

    const res = solveRota({
      dates: dates3d,
      entries,
      staff: [gpBig, gpSmall],
      leaveList: [],
      settings: settings3d,
      options: { seed: 7, iterations: 6000 },
    });

    const dutyOf = (id) => {
      const origDuty = entries.filter((e) => e.staffId === id && e.typeId === 'duty').length;
      const gained = res.changes.filter((c) => c.staffId === id && c.to === 'duty').length;
      const lost = res.changes.filter((c) => c.staffId === id && c.from === 'duty').length;
      return origDuty + gained - lost;
    };

    const bigDuty = dutyOf(gpBig.id);
    const smallDuty = dutyOf(gpSmall.id);

    // 8-session GP should have more duty sessions than the 4-session GP
    assert.ok(
      bigDuty > smallDuty,
      `Test 3b: 8-session GP (${bigDuty}) should have more duty than 4-session GP (${smallDuty})`
    );
    assert.equal(bigDuty + smallDuty, 6, 'Test 3b: total duty should be 6');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 4: Excess duty — slot with 3 duty entries, required 1 ⇒ extras reverted
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gpX = newStaff({ id: uid(), name: 'Dr X', dutyEligible: true, contractedSessions: 8 });
    const gpY = newStaff({ id: uid(), name: 'Dr Y', dutyEligible: true, contractedSessions: 8 });
    const gpZ = newStaff({ id: uid(), name: 'Dr Z', dutyEligible: true, contractedSessions: 8 });

    const entries = [
      // AM: 3 duty entries, only 1 required
      mkEntry(uid(), gpX.id, MON, 'am', 'duty'),
      mkEntry(uid(), gpY.id, MON, 'am', 'duty'),
      mkEntry(uid(), gpZ.id, MON, 'am', 'duty'),
      // PM: need coverage, all surgery
      mkEntry(uid(), gpX.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpY.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpZ.id, MON, 'pm', 'surgery'),
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gpX, gpY, gpZ],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 6000 },
    });

    // Count final duty on MON AM
    const finalDutyAm = entries
      .filter((e) => e.date === MON && e.period === 'am')
      .filter((e) => {
        const change = res.changes.find((c) => c.entryId === e.id);
        return change ? change.to === 'duty' : e.typeId === 'duty';
      }).length;

    // Should be reduced from 3 toward 1 (annealing may not get to exactly 1 but should reduce)
    assert.ok(finalDutyAm <= 2, `Test 4: expected excess duty reverted, got ${finalDutyAm} duty on MON AM`);
    // No gap in PM
    assert.equal(res.breakdown.dutyGap, 0, 'Test 4: should have no duty gap');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 5: VTS — registrar clinical on vtsDay becomes tutorial; in changes[]
  // ────────────────────────────────────────────────────────────────────────────
  {
    const partner = newStaff({
      id: uid(),
      name: 'Dr Partner',
      employmentType: 'partner',
      supervisor: true,
      dutyEligible: true,
      contractedSessions: 8,
    });
    const reg = newStaff({
      id: uid(),
      name: 'Dr Reg',
      employmentType: 'registrar',
      dutyEligible: false,
      contractedSessions: 8,
      vtsDay: 'mon-am',
    });

    const regAmEntry = mkEntry(uid(), reg.id, MON, 'am', 'surgery');
    const entries = [
      mkEntry(uid(), partner.id, MON, 'am', 'surgery'),
      mkEntry(uid(), partner.id, MON, 'pm', 'surgery'),
      regAmEntry,
      mkEntry(uid(), reg.id, MON, 'pm', 'surgery'),
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [partner, reg],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 4000 },
    });

    // Registrar's MON AM entry should be changed to tutorial
    const vtsChange = res.changes.find((c) => c.entryId === regAmEntry.id);
    assert.ok(vtsChange, 'Test 5: VTS entry not in changes');
    assert.equal(vtsChange.to, 'tutorial', 'Test 5: VTS entry not changed to tutorial');
    assert.equal(vtsChange.from, 'surgery', 'Test 5: VTS change from wrong');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 6: maxDutyPerWeek and sameDay constraints
  // ────────────────────────────────────────────────────────────────────────────
  {
    // sameDay: 2 GPs, Mon only (AM + PM).  Optimal: one takes AM, other takes PM.
    // The solver should reach 0 sameDay penalty at sufficient iterations.
    const gpA = newStaff({ id: uid(), name: 'Dr SA', dutyEligible: true, contractedSessions: 8 });
    const gpB = newStaff({ id: uid(), name: 'Dr SB', dutyEligible: true, contractedSessions: 8 });

    const entriesSameDay = [
      mkEntry(uid(), gpA.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpA.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpB.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpB.id, MON, 'pm', 'surgery'),
    ];

    const resSameDay = solveRota({
      dates: WEEK,
      entries: entriesSameDay,
      staff: [gpA, gpB],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 5, iterations: 6000 },
    });

    // With 2 GPs and 2 slots, optimal is one takes AM one takes PM: no sameDay penalty
    assert.equal(resSameDay.breakdown.sameDay, 0, 'Test 6a: expected no sameDay penalty with 2 GPs on 1 day');

    // maxDutyPerWeek: 1 GP, Mon only (AM + PM), maxDutyPerWeek=1.
    // Required: 1 duty per slot (2 total), but GP can only do 1/week without penalty.
    // There's no alternative, so the solver takes the best feasible assignment.
    // The spec says weeklyCap warns but doesn't block — score trades off.
    // We just verify the solver runs without error and returns a valid result.
    const gpCap = newStaff({ id: uid(), name: 'Dr Cap', dutyEligible: true, contractedSessions: 8 });
    const entriesCap = [mkEntry(uid(), gpCap.id, MON, 'am', 'surgery'), mkEntry(uid(), gpCap.id, MON, 'pm', 'surgery')];

    const resCap = solveRota({
      dates: WEEK,
      entries: entriesCap,
      staff: [gpCap],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 4000, maxDutyPerWeek: 1 },
    });

    // The solver fills both slots (required by dutyGap penalty outweighing weeklyCap penalty)
    // but reports a weeklyCap cost — or with only 1 GP it may accept 1 duty and 1 gap
    // Either way, score is finite and result is well-formed
    assert.ok(resCap.score.after >= 0, 'Test 6b: maxDutyPerWeek — score must be non-negative');
    assert.ok(Array.isArray(resCap.changes), 'Test 6b: changes must be an array');
    assert.ok(Array.isArray(resCap.unresolved), 'Test 6b: unresolved must be an array');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 7: avoidDuty preference respected when equally fair alternative exists
  // ────────────────────────────────────────────────────────────────────────────
  {
    // gpAvoider avoids 'mon-am' and 'mon-pm', gpOther does not.  Both equal contracts.
    // With 2 duty slots and 2 GPs of equal contracts, the optimal assignment puts
    // gpOther on duty to avoid all preference penalties.
    // To make this clear-cut: start gpAvoider with 1 history duty (so gpOther has lower
    // share and gets chosen by greedy), but the preference still validates the penalty.
    const gpAvoider = newStaff({
      id: uid(),
      name: 'Dr Prev',
      dutyEligible: true,
      contractedSessions: 8,
      avoidDuty: ['mon-am', 'mon-pm'],
    });
    const gpOther = newStaff({ id: uid(), name: 'Dr Zero', dutyEligible: true, contractedSessions: 8, avoidDuty: [] });

    const entries = [
      mkEntry(uid(), gpAvoider.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpOther.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpAvoider.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpOther.id, MON, 'pm', 'surgery'),
    ];

    // gpAvoider already has 2 history duties => gpOther (share=0) gets both by greedy
    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gpAvoider, gpOther],
      leaveList: [],
      settings: MON_ONLY,
      historyEntries: [
        { staffId: gpAvoider.id, typeId: 'duty', status: 'planned' },
        { staffId: gpAvoider.id, typeId: 'duty', status: 'planned' },
      ],
      options: { seed: 42, iterations: 6000 },
    });

    // gpOther should be assigned both duties (lower share, no avoidDuty penalty)
    // => preference penalty must be 0
    assert.equal(res.breakdown.preference, 0, 'Test 7: expected 0 preference penalty when non-avoider takes duty');

    // gpAvoider must not have been assigned Mon AM or Mon PM duty
    const avoiderDuty = res.changes.filter((c) => c.staffId === gpAvoider.id && c.to === 'duty');
    assert.equal(avoiderDuty.length, 0, 'Test 7: avoider should not be assigned duty when non-avoider takes it');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 8: Bank holidays / closed days — no duty assigned, no gap counted
  // ────────────────────────────────────────────────────────────────────────────
  {
    // Monday is open but is a bank holiday — no duty required, no gap
    const bhSettings = { ...DEFAULT_SETTINGS, openDays: ['mon'], bankHolidays: [MON] };
    const gp = newStaff({ id: uid(), name: 'Dr GP', dutyEligible: true, contractedSessions: 8 });

    // Entries on the bank holiday Monday — solver must not assign duty and must not report gap
    const entries = [mkEntry(uid(), gp.id, MON, 'am', 'surgery'), mkEntry(uid(), gp.id, MON, 'pm', 'surgery')];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp],
      leaveList: [],
      settings: bhSettings,
      options: { seed: 1, iterations: 2000 },
    });

    // No duty assigned on the bank holiday
    const dutyChanges = res.changes.filter((c) => c.date === MON && c.to === 'duty');
    assert.equal(dutyChanges.length, 0, 'Test 8: duty assigned on bank holiday');

    // No duty gap counted — bank holiday is not an open slot
    assert.equal(res.breakdown.dutyGap, 0, 'Test 8: duty gap counted on bank holiday');

    // Unresolved should not mention the bank holiday date
    const bhUnresolved = res.unresolved.filter((u) => u.message.includes(MON));
    assert.equal(bhUnresolved.length, 0, 'Test 8: bank holiday in unresolved');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 9: Determinism — same seed ⇒ identical changes
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp1 = newStaff({ id: uid(), name: 'Dr One', dutyEligible: true, contractedSessions: 8 });
    const gp2 = newStaff({ id: uid(), name: 'Dr Two', dutyEligible: true, contractedSessions: 8 });
    const entries = [
      mkEntry(uid(), gp1.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gp1.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gp2.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gp2.id, MON, 'pm', 'surgery'),
    ];

    const run = (seed) =>
      solveRota({
        dates: WEEK,
        entries,
        staff: [gp1, gp2],
        leaveList: [],
        settings: MON_ONLY,
        options: { seed, iterations: 4000 },
      });

    const r1a = run(99);
    const r1b = run(99);
    const r2 = run(100);

    // Same seed -> identical results
    assert.deepEqual(r1a.changes, r1b.changes, 'Test 9: same seed should produce identical changes');
    assert.equal(r1a.score.after, r1b.score.after, 'Test 9: same seed should produce same score');

    // Different seed: score should still be valid (0 or positive)
    assert.ok(r2.score.after >= 0, 'Test 9: different seed score must be non-negative');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 10: Unresolved — slot with no eligible GP reports duty gap
  // ────────────────────────────────────────────────────────────────────────────
  {
    // Only a nurse present — no GP can cover duty
    const nurse = newStaff({ id: uid(), name: 'Nurse Z', role: 'nurse', dutyEligible: false });
    const entries = [mkEntry(uid(), nurse.id, MON, 'am', 'surgery'), mkEntry(uid(), nurse.id, MON, 'pm', 'surgery')];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [nurse],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 2000 },
    });

    // Should have unresolved duty gaps
    const dutyUnresolved = res.unresolved.filter((u) => u.kind === 'duty');
    assert.ok(dutyUnresolved.length >= 2, `Test 10: expected ≥2 unresolved duty gaps, got ${dutyUnresolved.length}`);

    // Changes should be empty (no eligible GP)
    const dutyChanges = res.changes.filter((c) => c.to === 'duty');
    assert.equal(dutyChanges.length, 0, 'Test 10: duty assigned when no eligible GP exists');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Bonus: score.before reflects original entries (before greedy / VTS fixes)
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp = newStaff({ id: uid(), name: 'Dr Solo', dutyEligible: true, contractedSessions: 8 });
    // One surgery entry only — before solve, there's a duty gap => before > 0
    const entries = [mkEntry(uid(), gp.id, MON, 'am', 'surgery')];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 4000 },
    });

    assert.ok(res.score.before > 0, 'Bonus: score.before should be positive when gap exists before solve');
    assert.ok(res.score.after <= res.score.before, 'Bonus: score.after should be ≤ score.before');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Bonus: Locked duty entries count toward coverage
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp = newStaff({ id: uid(), name: 'Dr Locked', dutyEligible: true, contractedSessions: 8 });
    // Locked confirmed duty entry — should count toward coverage, no gap
    const lockedDuty = mkEntry(uid(), gp.id, MON, 'am', 'duty', { status: 'confirmed' });
    const entries = [lockedDuty, mkEntry(uid(), gp.id, MON, 'pm', 'surgery')];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 2000 },
    });

    // AM covered by locked entry; PM duty gap filled by flexible entry
    assert.equal(res.breakdown.dutyGap, 0, 'Bonus locked: locked duty should count toward coverage');
    // Locked entry must not appear in changes
    const lockedInChanges = res.changes.find((c) => c.entryId === lockedDuty.id);
    assert.ok(!lockedInChanges, 'Bonus locked: locked duty entry must not be in changes');
  }

  console.log('test-solver: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
