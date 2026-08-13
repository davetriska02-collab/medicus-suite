// Medicus Suite — Rota live-drift badge-state tests.
// Run with: node test-rota-drift-state.js
// side-panel/modules/rota/drift-state.js is ESM, this root file is CJS (the
// suite package.json has no "type"), so the module is loaded dynamically.
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const M = (p) => import(new URL(p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { driftBadgeState, driftDetail, DRIFT_KINDS, RED_KINDS, AMBER_KINDS } = await M(
    'side-panel/modules/rota/drift-state.js'
  );

  const counts = (o = {}) => ({
    'missing-clinic': 0,
    'ghost-clinic': 0,
    'unplanned-clinic': 0,
    'unknown-clinician': 0,
    ok: 0,
    ...o,
  });

  /* ---- the ONLY green: a completed check with zero findings ---- */
  {
    const b = driftBadgeState({ state: 'checked', counts: counts({ ok: 6 }), checkedAt: '08:15' });
    assert.equal(b.level, 'ok');
    assert.equal(b.count, 0);
    assert.equal(b.label, 'In step with the book (checked 08:15)');
    assert.equal(b.detail, '');
  }

  // Same, without a timestamp — still green, just no "(checked …)".
  {
    const b = driftBadgeState({ state: 'checked', counts: counts() });
    assert.equal(b.level, 'ok');
    assert.equal(b.label, 'In step with the book');
  }

  // A completed check with no counts object at all is still zero findings.
  {
    const b = driftBadgeState({ state: 'checked', checkedAt: '09:00' });
    assert.equal(b.level, 'ok');
  }

  /* ---- medium/info kinds only → amber ---- */
  {
    const b = driftBadgeState({ state: 'checked', counts: counts({ 'unplanned-clinic': 2 }), checkedAt: '08:15' });
    assert.equal(b.level, 'amber');
    assert.equal(b.count, 2);
    assert.equal(b.detail, '2 unplanned');
    assert.equal(b.checkedAt, '08:15');
    assert.notEqual(b.label, '');
  }
  {
    const b = driftBadgeState({ state: 'checked', counts: counts({ 'unknown-clinician': 1 }) });
    assert.equal(b.level, 'amber');
    assert.equal(b.detail, '1 not in registry');
  }

  /* ---- any high-severity kind → red ---- */
  {
    const b = driftBadgeState({ state: 'checked', counts: counts({ 'missing-clinic': 1 }) });
    assert.equal(b.level, 'red');
    assert.equal(b.count, 1);
    assert.equal(b.detail, '1 missing clinic');
  }
  {
    // Ghost clinics strand booked patients — high severity in reconcile.js,
    // so red here too.
    const b = driftBadgeState({ state: 'checked', counts: counts({ 'ghost-clinic': 2 }) });
    assert.equal(b.level, 'red');
    assert.equal(b.detail, '2 ghost clinics');
  }
  {
    // Red wins over amber, and the detail lists every kind, in kind order.
    const b = driftBadgeState({
      state: 'checked',
      counts: counts({ 'missing-clinic': 1, 'unplanned-clinic': 2, 'unknown-clinician': 1, ok: 4 }),
    });
    assert.equal(b.level, 'red');
    assert.equal(b.count, 4, 'ok findings must not be counted as drift');
    assert.equal(b.detail, '1 missing clinic · 2 unplanned · 1 not in registry');
  }

  /* ---- a check that ran and failed → amber "unavailable", with the reason ---- */
  {
    const b = driftBadgeState({ state: 'error', reason: 'not signed in to Medicus in this browser profile' });
    assert.equal(b.level, 'unavailable');
    assert.equal(b.label, 'Drift check unavailable');
    assert.equal(b.detail, 'not signed in to Medicus in this browser profile');
    assert.equal(b.count, 0);
  }
  {
    // A failure with no reason must still not be silent.
    const b = driftBadgeState({ state: 'error' });
    assert.equal(b.level, 'unavailable');
    assert.equal(b.detail, 'reason unknown');
  }

  /* ---- preconditions absent → neutral, never green ---- */
  {
    const b = driftBadgeState({ state: 'skipped', reason: 'no practice code set in the rota settings' });
    assert.equal(b.level, 'neutral');
    assert.equal(b.label, 'Not checked');
    assert.equal(b.detail, 'no practice code set in the rota settings');
  }
  {
    const b = driftBadgeState({ state: 'skipped', reason: 'nothing rostered for today' });
    assert.equal(b.level, 'neutral');
  }

  /* ---- nothing has happened yet: still neutral, NOT ok ---- */
  for (const input of [null, undefined, {}, { state: 'nonsense' }]) {
    const b = driftBadgeState(input);
    assert.equal(b.level, 'neutral', `absent/unknown state must be neutral, got ${b.level}`);
    assert.equal(b.count, 0);
    assert.ok(b.detail.length > 0, 'neutral state must still explain itself');
  }

  /* ---- an unavailable/neutral badge must never look green ---- */
  for (const input of [{ state: 'error', reason: 'x' }, { state: 'skipped', reason: 'y' }, null]) {
    assert.notEqual(driftBadgeState(input).level, 'ok');
  }

  /* ---- driftDetail ---- */
  assert.equal(driftDetail(counts()), '');
  assert.equal(driftDetail(null), '');
  assert.equal(driftDetail(counts({ 'missing-clinic': 1, 'ghost-clinic': 1 })), '1 missing clinic · 1 ghost clinic');
  // Junk counts must not leak into the label.
  assert.equal(driftDetail({ 'missing-clinic': -3, 'unplanned-clinic': 'x', 'ghost-clinic': 1 }), '1 ghost clinic');

  /* ---- kind tables stay in step with reconcile.js ---- */
  assert.deepEqual(DRIFT_KINDS, ['missing-clinic', 'ghost-clinic', 'unplanned-clinic', 'unknown-clinician']);
  assert.deepEqual([...RED_KINDS, ...AMBER_KINDS].sort(), [...DRIFT_KINDS].sort());

  // The engine's own severities must map the way this module assumes: every
  // 'high' finding lands in RED_KINDS, everything else in AMBER_KINDS.
  const { diffDay } = await M('rota/engine/reconcile.js');
  const staff = [{ id: 's1', name: 'Dr A', medicusName: 'Dr A', role: 'gp' }];
  const rows = [{ name: 'Dr A', am: { hasSession: false, slots: 0, booked: 0, f2f: 0 }, pm: { hasSession: false } }];
  const missing = diffDay({
    date: '2026-08-13',
    medicusRows: rows,
    rotaEntries: [{ date: '2026-08-13', period: 'am', typeId: 'surgery', staffId: 's1', status: 'planned' }],
    staff,
    leaveList: [],
  });
  const high = missing.filter((f) => f.severity === 'high');
  assert.ok(high.length > 0, 'fixture should produce a high-severity finding');
  for (const f of high) assert.ok(RED_KINDS.includes(f.kind), `${f.kind} is high severity but not red`);

  console.log('rota drift-state tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
