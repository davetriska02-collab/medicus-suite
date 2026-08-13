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

  /* ---- v2: enhanced access, avoid-duty, rooms, score transparency ---- */

  const { eaSummary } = await R('engine/rules.js');

  // Apply a solver result's type changes to a copy of the entries.
  const applyChanges = (entries, res) =>
    entries.map((e) => {
      const change = res.changes.find((c) => c.entryId === e.id);
      const room = (res.roomChanges || []).find((c) => c.entryId === e.id);
      return { ...e, ...(change ? { typeId: change.to } : {}), ...(room ? { roomId: room.to } : {}) };
    });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 11: Enhanced access — happy path: an evening session is allocated to
  // meet the EA DES target, and the target counts the same way rules.js does
  // ────────────────────────────────────────────────────────────────────────────
  {
    // list 1,500 ⇒ target 90 min/week; one EVE session (90 min) meets it exactly
    const eaSettings = {
      ...DEFAULT_SETTINGS,
      openDays: ['mon'],
      bankHolidays: [],
      extraPeriods: { early: false, eve: true },
      listSize: 1500,
    };
    const gp = newStaff({ id: uid(), name: 'Dr Eve', dutyEligible: true, contractedSessions: 8 });

    const eveEntry = mkEntry(uid(), gp.id, MON, 'eve', 'admin');
    const entries = [
      mkEntry(uid(), gp.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gp.id, MON, 'pm', 'surgery'),
      eveEntry,
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp],
      leaveList: [],
      settings: eaSettings,
      options: { seed: 1, iterations: 4000 },
    });

    const eaChange = res.changes.find((c) => c.entryId === eveEntry.id);
    assert.ok(eaChange, 'Test 11: EA entry not allocated');
    assert.equal(eaChange.to, 'enhanced', 'Test 11: EVE session should become enhanced access');
    assert.equal(res.breakdown.ea, 0, 'Test 11: EA target should be met (no ea penalty)');
    assert.equal(
      res.unresolved.filter((u) => u.kind === 'ea').length,
      0,
      'Test 11: no EA shortfall should be reported when the target is met'
    );

    // The solver's EA measure must agree with rules.js eaSummary on the applied rota
    const applied = applyChanges(entries, res);
    const summary = eaSummary({ dates: WEEK, entries: applied, staff: [gp], leaveList: [], settings: eaSettings });
    assert.equal(summary.target, 90, 'Test 11: eaSummary target');
    assert.ok(summary.minutes >= summary.target, `Test 11: eaSummary minutes ${summary.minutes} < target`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 12: Enhanced access — shortfall is scored and reported, never blocked;
  // nonclinical staff are never given an EA clinical session
  // ────────────────────────────────────────────────────────────────────────────
  {
    // list 10,000 ⇒ target 600 min/week; only one EVE session (90 min) exists
    const eaSettings = {
      ...DEFAULT_SETTINGS,
      openDays: ['mon'],
      bankHolidays: [],
      extraPeriods: { early: false, eve: true },
      listSize: 10000,
    };
    const gp = newStaff({ id: uid(), name: 'Dr Short', dutyEligible: true, contractedSessions: 8 });
    const receptionist = newStaff({
      id: uid(),
      name: 'Rita Reception',
      role: 'reception',
      employmentType: 'employed',
      dutyEligible: false,
      contractedSessions: 8,
    });

    const eveGp = mkEntry(uid(), gp.id, MON, 'eve', 'admin');
    const eveRec = mkEntry(uid(), receptionist.id, MON, 'eve', 'admin');
    const entries = [
      mkEntry(uid(), gp.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gp.id, MON, 'pm', 'surgery'),
      eveGp,
      eveRec,
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp, receptionist],
      leaveList: [],
      settings: eaSettings,
      options: { seed: 1, iterations: 4000 },
    });

    // 600 target − 90 rostered = 510 min short
    const eaLine = res.explain.find((x) => x.key === 'ea');
    assert.ok(eaLine, 'Test 12: explain should carry an ea dimension');
    assert.equal(eaLine.measure, 510, `Test 12: expected 510 min short, got ${eaLine.measure}`);
    assert.equal(
      res.breakdown.ea,
      DEFAULT_WEIGHTS.eaGap * (510 / 60),
      'Test 12: ea score should be weight × hours short'
    );

    const eaUnresolved = res.unresolved.filter((u) => u.kind === 'ea');
    assert.equal(eaUnresolved.length, 1, 'Test 12: expected one EA shortfall note');
    assert.ok(eaUnresolved[0].message.includes('510 min short'), 'Test 12: EA note should state the shortfall');

    // The shortfall is a warning, not a block: the solver still returns a result
    assert.ok(Array.isArray(res.changes), 'Test 12: changes must still be returned');
    // The receptionist is never given a clinical EA session
    const recChange = res.changes.find((c) => c.entryId === eveRec.id);
    assert.ok(!recChange, 'Test 12: nonclinical staff must not be given an enhanced-access session');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 13a: avoid-duty — the greedy initial fill breaks ties away from
  // someone who asked to avoid that slot (iterations: 0 ⇒ greedy only)
  // ────────────────────────────────────────────────────────────────────────────
  {
    const avoider = newStaff({
      id: uid(),
      name: 'Dr Ada', // sorts FIRST by name — only the avoid-duty tie-break saves them
      dutyEligible: true,
      contractedSessions: 8,
      avoidDuty: ['mon-am'],
    });
    const other = newStaff({ id: uid(), name: 'Dr Zoe', dutyEligible: true, contractedSessions: 8 });

    const avoiderAm = mkEntry(uid(), avoider.id, MON, 'am', 'surgery');
    const entries = [
      avoiderAm,
      mkEntry(uid(), other.id, MON, 'am', 'surgery'),
      mkEntry(uid(), avoider.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), other.id, MON, 'pm', 'surgery'),
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [avoider, other],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 0 },
    });

    assert.equal(res.breakdown.preference, 0, 'Test 13a: greedy should avoid the avoid-duty slot when a peer is free');
    const avoiderAmDuty = res.changes.find((c) => c.entryId === avoiderAm.id && c.to === 'duty');
    assert.ok(!avoiderAmDuty, 'Test 13a: avoider given duty on their avoided slot despite an alternative');
    assert.equal(res.breakdown.dutyGap, 0, 'Test 13a: cover must still be complete');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 13b: avoid-duty — last resort: with nobody else, duty is still
  // assigned (cover wins) but the score and unresolved say so out loud
  // ────────────────────────────────────────────────────────────────────────────
  {
    const solo = newStaff({
      id: uid(),
      name: 'Dr Only',
      dutyEligible: true,
      contractedSessions: 8,
      avoidDuty: ['mon-am', 'mon-pm'],
    });
    const entries = [mkEntry(uid(), solo.id, MON, 'am', 'surgery'), mkEntry(uid(), solo.id, MON, 'pm', 'surgery')];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [solo],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 4000 },
    });

    // Cover still wins — avoid-duty never hard-blocks
    assert.equal(res.breakdown.dutyGap, 0, 'Test 13b: duty cover must win over the avoid-duty preference');
    assert.equal(res.breakdown.preference, DEFAULT_WEIGHTS.preference * 2, 'Test 13b: both duties should be penalised');

    const prefNotes = res.unresolved.filter((u) => u.kind === 'preference');
    assert.equal(prefNotes.length, 2, `Test 13b: expected 2 avoid-duty notes, got ${prefNotes.length}`);
    assert.ok(
      prefNotes.every((n) => n.message.includes('no other eligible GP was available')),
      'Test 13b: avoid-duty note should explain it was a last resort'
    );
    const prefLine = res.explain.find((x) => x.key === 'preference');
    assert.equal(prefLine.measure, 2, 'Test 13b: explain should count 2 avoided-slot duties');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 14a: rooms — a clash the solver cannot resolve is scored and reported
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp1 = newStaff({ id: uid(), name: 'Dr R1', dutyEligible: true, contractedSessions: 8 });
    const gp2 = newStaff({ id: uid(), name: 'Dr R2', dutyEligible: true, contractedSessions: 8 });
    const rooms = [{ id: 'r1', name: 'Room 1' }];

    const entries = [
      mkEntry(uid(), gp1.id, MON, 'am', 'surgery', { roomId: 'r1' }),
      mkEntry(uid(), gp2.id, MON, 'am', 'surgery', { roomId: 'r1' }),
      mkEntry(uid(), gp1.id, MON, 'pm', 'surgery', { roomId: 'r1' }),
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp1, gp2],
      leaveList: [],
      settings: MON_ONLY,
      rooms,
      options: { seed: 1, iterations: 4000 },
    });

    assert.equal(res.breakdown.rooms, DEFAULT_WEIGHTS.roomClash, 'Test 14a: one surplus session sharing a room');
    assert.equal(res.explain.find((x) => x.key === 'rooms').measure, 1, 'Test 14a: explain should count 1 clash');
    const roomNotes = res.unresolved.filter((u) => u.kind === 'room');
    assert.equal(roomNotes.length, 1, 'Test 14a: expected one unresolved room clash');
    assert.ok(roomNotes[0].message.includes('Room 1'), 'Test 14a: room note should name the room');
    assert.ok(roomNotes[0].message.includes('no free room'), 'Test 14a: room note should say why it is unresolved');
    assert.equal(res.roomChanges.length, 0, 'Test 14a: nothing to move when no room is free');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 14b: rooms — where a room is free the proposal moves the movable
  // session into it; locked sessions stay put
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp1 = newStaff({ id: uid(), name: 'Dr Fixed', dutyEligible: true, contractedSessions: 8 });
    const gp2 = newStaff({ id: uid(), name: 'Dr Movable', dutyEligible: true, contractedSessions: 8 });
    const rooms = [
      { id: 'r1', name: 'Room 1' },
      { id: 'r2', name: 'Room 2' },
    ];

    const lockedEntry = mkEntry(uid(), gp1.id, MON, 'am', 'surgery', { roomId: 'r1', status: 'confirmed' });
    const movableEntry = mkEntry(uid(), gp2.id, MON, 'am', 'surgery', { roomId: 'r1' });
    const entries = [lockedEntry, movableEntry, mkEntry(uid(), gp1.id, MON, 'pm', 'surgery', { roomId: 'r1' })];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp1, gp2],
      leaveList: [],
      settings: MON_ONLY,
      rooms,
      options: { seed: 1, iterations: 4000 },
    });

    assert.equal(res.roomChanges.length, 1, 'Test 14b: expected one proposed room move');
    assert.equal(res.roomChanges[0].entryId, movableEntry.id, 'Test 14b: the locked session must not be moved');
    assert.equal(res.roomChanges[0].from, 'r1', 'Test 14b: room move from');
    assert.equal(res.roomChanges[0].to, 'r2', 'Test 14b: room move to the free room');
    assert.equal(res.breakdown.rooms, 0, 'Test 14b: clash resolved by the proposal');
    assert.equal(res.unresolved.filter((u) => u.kind === 'room').length, 0, 'Test 14b: no unresolved room clash');

    // Applying the proposal really does clear the clash
    const applied = applyChanges(entries, res);
    const amRooms = applied.filter((e) => e.date === MON && e.period === 'am').map((e) => e.roomId);
    assert.equal(new Set(amRooms).size, amRooms.length, 'Test 14b: applied rota still has a room clash');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 14c: rooms — EA allocation prefers sessions that do not share a room
  // ────────────────────────────────────────────────────────────────────────────
  {
    // list 3,000 ⇒ target 180 min = two EVE sessions; three candidates, two of
    // which share Room 1. The room-aware score should pick a non-clashing pair.
    const eaSettings = {
      ...DEFAULT_SETTINGS,
      openDays: ['mon'],
      bankHolidays: [],
      extraPeriods: { early: false, eve: true },
      listSize: 3000,
    };
    const rooms = [
      { id: 'r1', name: 'Room 1' },
      { id: 'r2', name: 'Room 2' },
    ];
    const gpA = newStaff({ id: uid(), name: 'Dr EA1', dutyEligible: true, contractedSessions: 8 });
    const gpB = newStaff({ id: uid(), name: 'Dr EA2', dutyEligible: true, contractedSessions: 8 });
    const gpC = newStaff({ id: uid(), name: 'Dr EA3', dutyEligible: true, contractedSessions: 8 });

    const entries = [
      mkEntry(uid(), gpA.id, MON, 'am', 'surgery'),
      mkEntry(uid(), gpB.id, MON, 'pm', 'surgery'),
      mkEntry(uid(), gpA.id, MON, 'eve', 'admin', { roomId: 'r1' }),
      mkEntry(uid(), gpB.id, MON, 'eve', 'admin', { roomId: 'r1' }),
      mkEntry(uid(), gpC.id, MON, 'eve', 'admin', { roomId: 'r2' }),
    ];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gpA, gpB, gpC],
      leaveList: [],
      settings: eaSettings,
      rooms,
      options: { seed: 4, iterations: 6000 },
    });

    assert.equal(res.breakdown.ea, 0, 'Test 14c: EA target should be met');
    assert.equal(res.breakdown.rooms, 0, 'Test 14c: EA allocation should not leave a room clash');

    // The allocation itself must dodge the clash — not lean on a room shuffle
    assert.equal(res.roomChanges.length, 0, 'Test 14c: EA allocation should not need a room reassignment');
    const eveRooms = res.changes
      .filter((c) => c.to === 'enhanced')
      .map((c) => entries.find((e) => e.id === c.entryId).roomId);
    assert.equal(eveRooms.length, 2, 'Test 14c: expected two enhanced-access sessions');
    assert.equal(new Set(eveRooms).size, 2, 'Test 14c: the two EA sessions must be in different rooms');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 15: Determinism across the new dimensions (EA + rooms + avoid-duty)
  // ────────────────────────────────────────────────────────────────────────────
  {
    const eaSettings = {
      ...DEFAULT_SETTINGS,
      openDays: ['mon', 'tue'],
      bankHolidays: [],
      extraPeriods: { early: true, eve: true },
      listSize: 6000,
    };
    const rooms = [
      { id: 'r1', name: 'Room 1' },
      { id: 'r2', name: 'Room 2' },
    ];
    const gp1 = newStaff({
      id: uid(),
      name: 'Dr Det1',
      dutyEligible: true,
      contractedSessions: 8,
      avoidDuty: ['mon-am'],
      usualRoomId: 'r1',
    });
    const gp2 = newStaff({ id: uid(), name: 'Dr Det2', dutyEligible: true, contractedSessions: 6, usualRoomId: 'r2' });
    const nurse = newStaff({ id: uid(), name: 'Nurse Det', role: 'nurse', dutyEligible: false, contractedSessions: 8 });

    const dates2 = [MON, addDays(MON, 1)];
    const entries = [];
    for (const date of dates2) {
      for (const period of ['early', 'am', 'pm', 'eve']) {
        entries.push(mkEntry(uid(), gp1.id, date, period, period === 'am' || period === 'pm' ? 'surgery' : 'admin'));
        entries.push(mkEntry(uid(), gp2.id, date, period, period === 'am' || period === 'pm' ? 'surgery' : 'admin'));
        entries.push(mkEntry(uid(), nurse.id, date, period, 'admin', { roomId: 'r1' }));
      }
    }

    const run = (seed) =>
      solveRota({
        dates: dates2,
        entries,
        staff: [gp1, gp2, nurse],
        leaveList: [],
        settings: eaSettings,
        rooms,
        options: { seed, iterations: 5000 },
      });

    const a = run(11);
    const b = run(11);
    const c = run(12);

    assert.deepEqual(a.changes, b.changes, 'Test 15: same seed should produce identical changes');
    assert.deepEqual(a.roomChanges, b.roomChanges, 'Test 15: same seed should produce identical room changes');
    assert.deepEqual(a.breakdown, b.breakdown, 'Test 15: same seed should produce an identical breakdown');
    assert.deepEqual(a.explain, b.explain, 'Test 15: same seed should produce an identical explain');
    assert.deepEqual(a.unresolved, b.unresolved, 'Test 15: same seed should produce identical unresolved notes');
    assert.ok(c.score.after >= 0, 'Test 15: different seed score must be non-negative');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 16: Result shape — v1 contract intact, v2 additions are additive
  // ────────────────────────────────────────────────────────────────────────────
  {
    const gp = newStaff({ id: uid(), name: 'Dr Shape', dutyEligible: true, contractedSessions: 8 });
    const entries = [mkEntry(uid(), gp.id, MON, 'am', 'surgery'), mkEntry(uid(), gp.id, MON, 'pm', 'surgery')];

    const res = solveRota({
      dates: WEEK,
      entries,
      staff: [gp],
      leaveList: [],
      settings: MON_ONLY,
      options: { seed: 1, iterations: 2000 },
    });

    // v1 contract
    assert.ok(Array.isArray(res.changes), 'Test 16: changes[]');
    assert.equal(typeof res.score.before, 'number', 'Test 16: score.before');
    assert.equal(typeof res.score.after, 'number', 'Test 16: score.after');
    assert.ok(Array.isArray(res.unresolved), 'Test 16: unresolved[]');
    assert.equal(typeof res.iterations, 'number', 'Test 16: iterations');
    for (const key of ['dutyGap', 'vts', 'fairness', 'sameDay', 'weeklyCap', 'locumDuty', 'preference', 'churn']) {
      assert.equal(typeof res.breakdown[key], 'number', `Test 16: breakdown.${key} missing`);
    }
    for (const c of res.changes) {
      for (const key of ['entryId', 'staffId', 'date', 'period', 'from', 'to']) {
        assert.ok(key in c, `Test 16: change.${key} missing`);
      }
    }

    // v2 additions
    assert.equal(typeof res.breakdown.ea, 'number', 'Test 16: breakdown.ea');
    assert.equal(typeof res.breakdown.rooms, 'number', 'Test 16: breakdown.rooms');
    assert.ok(Array.isArray(res.roomChanges), 'Test 16: roomChanges[]');
    assert.ok(Array.isArray(res.explain), 'Test 16: explain[]');
    assert.equal(res.explain.length, 10, 'Test 16: explain should cover all 10 dimensions');
    for (const dim of ['dutyGap', 'ea', 'fairness', 'vts', 'preference', 'rooms']) {
      const line = res.explain.find((x) => x.key === dim);
      assert.ok(line, `Test 16: explain missing ${dim}`);
      assert.equal(typeof line.label, 'string', `Test 16: explain.${dim}.label`);
      assert.equal(typeof line.weight, 'number', `Test 16: explain.${dim}.weight`);
      assert.equal(typeof line.measure, 'number', `Test 16: explain.${dim}.measure`);
      assert.equal(line.score, res.breakdown[dim], `Test 16: explain.${dim}.score should match the breakdown`);
    }

    // score.after is exactly the sum of the breakdown
    const sum = Object.values(res.breakdown).reduce((a, b) => a + b, 0);
    assert.equal(res.score.after, sum, 'Test 16: score.after must equal the sum of the breakdown');

    // EA and room dimensions are inert for a practice with neither
    assert.equal(res.breakdown.ea, 0, 'Test 16: no EA periods ⇒ no EA penalty');
    assert.equal(res.breakdown.rooms, 0, 'Test 16: no rooms ⇒ no room penalty');
  }

  console.log('test-solver: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
