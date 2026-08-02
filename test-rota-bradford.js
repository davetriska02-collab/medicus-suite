// Medicus Suite — Rota bradford tests (ported from medicus-rota-manager)
// Run with: node test-rota-bradford.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { sicknessEpisodes, bradfordScore, bradfordRows } = await R('engine/bradford.js');
  const { newStaff, DEFAULT_SETTINGS } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const settings = { ...DEFAULT_SETTINGS };
  const person = newStaff({ id: 'p1', name: 'Dr A' });
  const sick = (start, end) => ({ staffId: 'p1', type: 'sick', status: 'approved', startDate: start, endDate: end });

  // Contiguous/overlapping records merge into one episode; gaps split.
  let eps = sicknessEpisodes(
    [
      sick('2026-05-04', '2026-05-05'),
      sick('2026-05-06', '2026-05-07'), // adjacent -> same episode
      sick('2026-05-20', '2026-05-20'), // gap -> new episode
    ],
    'p1'
  );
  assert.equal(eps.length, 2);
  assert.equal(eps[0].endDate, '2026-05-07');

  // Non-approved and non-sick records are ignored.
  eps = sicknessEpisodes(
    [
      { staffId: 'p1', type: 'sick', status: 'requested', startDate: '2026-05-04', endDate: '2026-05-05' },
      { staffId: 'p1', type: 'annual', status: 'approved', startDate: '2026-05-04', endDate: '2026-05-05' },
    ],
    'p1'
  );
  assert.equal(eps.length, 0);

  // Score: 2 episodes × (2 + 1 working days) -> B = 4 × 3 = 12; band ok.
  let r = bradfordScore({
    person,
    settings,
    asOf: '2026-06-10',
    leaveList: [sick('2026-05-04', '2026-05-05'), sick('2026-05-20', '2026-05-20')],
  });
  assert.equal(r.episodes, 2);
  assert.equal(r.days, 3);
  assert.equal(r.score, 12);
  assert.equal(r.band, 'ok');

  // Weekend days don't count as working days (Sat 2026-06-06 / Sun 07).
  r = bradfordScore({ person, settings, asOf: '2026-06-10', leaveList: [sick('2026-06-05', '2026-06-08')] });
  assert.equal(r.days, 2); // Fri + Mon

  // Episodes outside the 52-week window are excluded entirely.
  r = bradfordScore({ person, settings, asOf: '2026-06-10', leaveList: [sick('2024-06-01', '2024-06-05')] });
  assert.equal(r.episodes, 0);
  assert.equal(r.score, 0);

  // Bands honour configured thresholds: 4 episodes × 13 working days = 208 -> high.
  const fourEpisodes = [
    sick('2026-01-05', '2026-01-09'), // 5 working days
    sick('2026-02-02', '2026-02-04'), // 3
    sick('2026-03-02', '2026-03-04'), // 3
    sick('2026-04-06', '2026-04-07'), // 2
  ];
  r = bradfordScore({ person, settings, asOf: '2026-06-10', leaveList: fourEpisodes });
  assert.equal(r.score, 16 * 13);
  assert.equal(r.band, 'high');
  r = bradfordScore({
    person,
    asOf: '2026-06-10',
    leaveList: fourEpisodes,
    settings: { ...settings, bradfordThresholds: { monitor: 10, high: 50, severe: 100 } },
  });
  assert.equal(r.band, 'severe');

  // bradfordRows: staff with no sickness are omitted, sorted by score desc.
  const healthy = newStaff({ id: 'p2', name: 'Dr B' });
  const rows = bradfordRows({ staff: [healthy, person], settings, asOf: '2026-06-10', leaveList: fourEpisodes });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].staffId, 'p1');

  console.log('test-bradford: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
