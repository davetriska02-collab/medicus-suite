// Medicus Suite — shared/txn-parity-report.js unit tests
// Run with: node --test test-txn-parity-report.js
//
// Pins the one-click assurance evidence pack built on top of the Clinical
// Event Ledger's three crossover-related event kinds (source 'sentinel',
// ruleId 'txn-shadow-divergence' | 'txn-shadow-unavailable' | 'txn-fallback'
// — see content-scripts/sentinel.js computeApiShadowStatus). Both exported
// functions are pure: buildParityReport takes events + opts.nowIso (never
// touches the clock itself); renderParityReportMarkdown takes only its
// arguments. Covers: filtering, counts, severity split, reason grouping +
// ordering, date-range filtering, the empty-ledger case, and the "honest
// preamble" wording (parity itself is never counted, only divergences/
// failures) surviving into the rendered Markdown with no undefined/null
// artefacts and no patient-shaped text.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildParityReport, renderParityReportMarkdown } = require('./shared/txn-parity-report.js');

const NOW = '2026-07-09T12:00:00.000Z';

/** Build a ledger event following event-ledger.js's makeEvent shape/field names. */
function makeEvent(overrides) {
  return {
    ts: '2026-06-01T09:00:00.000Z',
    source: 'sentinel',
    patientRef: null,
    severity: null,
    ruleId: 'txn-shadow-divergence',
    label: 'missing 1 added 0 changed 0',
    action: 'shown',
    ...overrides,
  };
}

test('buildParityReport: filters to the three relevant kinds, ignores everything else', () => {
  const events = [
    makeEvent({ ts: '2026-06-01T09:00:00.000Z' }),
    // Wrong source — same ruleId, must be ignored.
    makeEvent({ ts: '2026-06-01T09:01:00.000Z', source: 'health', ruleId: 'txn-shadow-divergence' }),
    // Unrelated sentinel ruleId — must be ignored.
    makeEvent({ ts: '2026-06-01T09:02:00.000Z', ruleId: 'some-clinical-rule', label: 'BP overdue', action: 'shown' }),
    // Unrelated leaflets/routinerx events — must be ignored.
    {
      ts: '2026-06-01T09:03:00.000Z',
      source: 'leaflets',
      patientRef: null,
      severity: null,
      ruleId: 'aci-leaflet',
      label: null,
      action: 'opened',
    },
    makeEvent({
      ts: '2026-06-01T09:04:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy timeout',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-01T09:05:00.000Z',
      ruleId: 'txn-fallback',
      label: 'proxy 503',
      action: 'aborted',
      severity: null,
    }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.equal(report.counts.total, 3, 'only the 3 relevant events counted');
  assert.equal(report.counts.divergence, 1);
  assert.equal(report.counts.unavailable, 1);
  assert.equal(report.counts.fallback, 1);
});

test('buildParityReport: counts and severity split for divergences', () => {
  const events = [
    makeEvent({ ts: '2026-06-01T09:00:00.000Z', severity: 'regression', label: 'missing 1 added 0 changed 0' }),
    makeEvent({ ts: '2026-06-02T09:00:00.000Z', severity: 'regression', label: 'missing 2 added 0 changed 0' }),
    makeEvent({ ts: '2026-06-03T09:00:00.000Z', severity: 'escalation-only', label: 'missing 0 added 1 changed 0' }),
    makeEvent({ ts: '2026-06-04T09:00:00.000Z', severity: null, label: 'missing 0 added 0 changed 1' }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.equal(report.counts.divergence, 4);
  assert.deepEqual(report.divergenceBySeverity, { regression: 2, 'escalation-only': 1, unknown: 1 });
});

test('buildParityReport: divergenceSummaries are chronological (oldest first)', () => {
  const events = [
    makeEvent({ ts: '2026-06-03T09:00:00.000Z', label: 'third', severity: 'regression' }),
    makeEvent({ ts: '2026-06-01T09:00:00.000Z', label: 'first', severity: 'regression' }),
    makeEvent({ ts: '2026-06-02T09:00:00.000Z', label: 'second', severity: 'escalation-only' }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.deepEqual(
    report.divergenceSummaries.map((d) => d.label),
    ['first', 'second', 'third']
  );
  assert.equal(report.divergenceSummaries[0].date, '2026-06-01T09:00:00.000Z');
  assert.equal(report.divergenceSummaries[0].severity, 'regression');
});

test('buildParityReport: unavailable/fallback reasons grouped, most-frequent-first, ties by first-seen', () => {
  const events = [
    makeEvent({
      ts: '2026-06-01T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy timeout',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-02T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy 503',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-03T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy timeout',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-04T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy timeout',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-05T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy 503',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-06T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: 'auth token expired',
      action: 'aborted',
      severity: null,
    }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.deepEqual(report.unavailableReasons, [
    { reason: 'proxy timeout', count: 3 },
    { reason: 'proxy 503', count: 2 },
  ]);
  assert.deepEqual(report.fallbackReasons, [{ reason: 'auth token expired', count: 1 }]);
});

test('buildParityReport: reasons with equal counts keep first-seen order', () => {
  const events = [
    makeEvent({
      ts: '2026-06-01T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: 'zeta reason',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-02T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: 'alpha reason',
      action: 'aborted',
      severity: null,
    }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.deepEqual(
    report.fallbackReasons.map((r) => r.reason),
    ['zeta reason', 'alpha reason']
  );
});

test('buildParityReport: missing/null label groups under "(no reason given)"', () => {
  const events = [
    makeEvent({
      ts: '2026-06-01T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: null,
      action: 'aborted',
      severity: null,
    }),
    makeEvent({ ts: '2026-06-02T09:00:00.000Z', ruleId: 'txn-fallback', label: '', action: 'aborted', severity: null }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.deepEqual(report.fallbackReasons, [{ reason: '(no reason given)', count: 2 }]);
});

test('buildParityReport: sinceIso/untilIso date-range filtering is inclusive', () => {
  const events = [
    makeEvent({ ts: '2026-05-31T23:59:59.000Z', label: 'too early' }),
    makeEvent({ ts: '2026-06-01T00:00:00.000Z', label: 'lower bound' }),
    makeEvent({ ts: '2026-06-15T12:00:00.000Z', label: 'in range' }),
    makeEvent({ ts: '2026-06-30T23:59:59.999Z', label: 'upper bound' }),
    makeEvent({ ts: '2026-07-01T00:00:00.000Z', label: 'too late' }),
  ];
  const report = buildParityReport(events, {
    nowIso: NOW,
    sinceIso: '2026-06-01T00:00:00.000Z',
    untilIso: '2026-06-30T23:59:59.999Z',
  });
  assert.equal(report.counts.divergence, 3);
  assert.deepEqual(
    report.divergenceSummaries.map((d) => d.label),
    ['lower bound', 'in range', 'upper bound']
  );
  assert.deepEqual(report.range, { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' });
});

test('buildParityReport: no range bounds given -> range is unbounded (nulls), nothing filtered by date', () => {
  const events = [makeEvent({ ts: '2020-01-01T00:00:00.000Z' }), makeEvent({ ts: '2030-01-01T00:00:00.000Z' })];
  const report = buildParityReport(events, { nowIso: NOW });
  assert.equal(report.counts.divergence, 2);
  assert.deepEqual(report.range, { from: null, to: null });
});

test('buildParityReport: generatedAt is stamped verbatim from opts.nowIso, never computed internally', () => {
  const report = buildParityReport([], { nowIso: NOW });
  assert.equal(report.generatedAt, NOW);
});

test('buildParityReport: empty ledger -> all counts zero, empty lists', () => {
  const report = buildParityReport([], { nowIso: NOW });
  assert.deepEqual(report.counts, { divergence: 0, unavailable: 0, fallback: 0, total: 0 });
  assert.deepEqual(report.divergenceBySeverity, { regression: 0, 'escalation-only': 0, unknown: 0 });
  assert.deepEqual(report.divergenceSummaries, []);
  assert.deepEqual(report.unavailableReasons, []);
  assert.deepEqual(report.fallbackReasons, []);
});

test('buildParityReport: tolerates non-array/garbage input without throwing', () => {
  assert.doesNotThrow(() => buildParityReport(null, { nowIso: NOW }));
  assert.doesNotThrow(() => buildParityReport(undefined, { nowIso: NOW }));
  assert.doesNotThrow(() => buildParityReport([null, undefined, 42, 'x', {}], { nowIso: NOW }));
  const report = buildParityReport([null, undefined, 42, 'x', {}], { nowIso: NOW });
  assert.equal(report.counts.total, 0);
});

// ── renderParityReportMarkdown ──────────────────────────────────────────────

test('renderParityReportMarkdown: empty-ledger report still renders with the honest preamble', () => {
  const report = buildParityReport([], { nowIso: NOW });
  const md = renderParityReportMarkdown(report, {
    practiceLabel: 'Test Practice',
    modeNote: 'Hybrid since 2026-06-01',
  });
  assert.match(md, /# Medicus Transactional API — parity report/);
  assert.match(md, /records nothing at all/);
  assert.match(md, /cannot state how many patient views were checked/);
  assert.match(md, /No divergences observed in this range\./);
  assert.match(md, /No shadow feed failures observed in this range\./);
  assert.match(md, /No fallbacks observed in this range\./);
  assert.match(md, /raw evidence/i);
});

test('renderParityReportMarkdown: counts table, divergence list, and reason tables reflect the report', () => {
  const events = [
    makeEvent({ ts: '2026-06-01T09:00:00.000Z', severity: 'regression', label: 'missing 1 added 0 changed 0' }),
    makeEvent({
      ts: '2026-06-02T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy timeout',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-03T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: 'auth token expired',
      action: 'aborted',
      severity: null,
    }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  const md = renderParityReportMarkdown(report, {});
  assert.match(md, /\| Divergences \(shadow comparison found a difference\) \| 1 \|/);
  assert.match(md, /\| Shadow feed unavailable \| 1 \|/);
  assert.match(md, /\| Fallback to session data \| 1 \|/);
  assert.match(md, /missing 1 added 0 changed 0/);
  assert.match(md, /proxy timeout/);
  assert.match(md, /auth token expired/);
});

test('renderParityReportMarkdown: no undefined/null string artefacts, even with sparse report/meta', () => {
  const report = buildParityReport([], { nowIso: NOW });
  const md = renderParityReportMarkdown(report, {});
  assert.doesNotMatch(md, /\bundefined\b/);
  assert.doesNotMatch(md, /\bnull\b/);
});

test('renderParityReportMarkdown: no undefined/null artefacts on a populated report with missing optional fields', () => {
  const events = [
    makeEvent({ ts: '2026-06-01T09:00:00.000Z', severity: null, label: null }),
    makeEvent({
      ts: '2026-06-02T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: null,
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-03T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: undefined,
      action: 'aborted',
      severity: null,
    }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  const md = renderParityReportMarkdown(report); // meta omitted entirely
  assert.doesNotMatch(md, /\bundefined\b/);
  assert.doesNotMatch(md, /\bnull\b/);
});

test('renderParityReportMarkdown: no patient-shaped identifiers appear (patientRef never read/interpolated)', () => {
  const events = [
    makeEvent({
      ts: '2026-06-01T09:00:00.000Z',
      patientRef: 'aaaaaaaa-0000-4000-8000-000000000001',
      severity: 'regression',
    }),
  ];
  const report = buildParityReport(events, { nowIso: NOW });
  const md = renderParityReportMarkdown(report, { practiceLabel: 'Test Practice' });
  assert.ok(!JSON.stringify(report).includes('patientRef'), 'report object never carries a patientRef field');
  assert.ok(
    !md.includes('aaaaaaaa-0000-4000-8000-000000000001'),
    'the UUID from the input event never reaches the markdown'
  );
});

test('clock-free determinism: same events + same nowIso -> identical report and identical markdown, repeatedly', () => {
  const events = [
    makeEvent({ ts: '2026-06-01T09:00:00.000Z', severity: 'regression', label: 'missing 1 added 0 changed 0' }),
    makeEvent({
      ts: '2026-06-02T09:00:00.000Z',
      ruleId: 'txn-shadow-unavailable',
      label: 'proxy timeout',
      action: 'aborted',
      severity: null,
    }),
    makeEvent({
      ts: '2026-06-03T09:00:00.000Z',
      ruleId: 'txn-fallback',
      label: 'auth token expired',
      action: 'aborted',
      severity: null,
    }),
  ];
  const opts = { nowIso: NOW };
  const r1 = buildParityReport(events, opts);
  const r2 = buildParityReport(events, opts);
  assert.deepEqual(r1, r2);
  const md1 = renderParityReportMarkdown(r1, { practiceLabel: 'Test Practice', modeNote: 'Hybrid' });
  const md2 = renderParityReportMarkdown(r2, { practiceLabel: 'Test Practice', modeNote: 'Hybrid' });
  assert.equal(md1, md2);
});

test('buildParityReport never calls the system clock: absent opts.nowIso yields generatedAt null, not "now"', () => {
  const report = buildParityReport([], {});
  assert.equal(report.generatedAt, null);
  const report2 = buildParityReport([]);
  assert.equal(report2.generatedAt, null);
});
