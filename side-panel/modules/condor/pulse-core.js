// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Pulse: pure trend builders over Condor's daily snapshots.
//
// Condor writes one row per calendar day to chrome.storage.local['practice.reportSnapshots']
// (see report-data.js buildSnapshotRow/saveSnapshot) whenever the panel is open. That store
// has gaps by construction — a day the extension was never opened records nothing — so this
// module NEVER interpolates: a missing day is missing, and every trend row discloses exactly
// how many of the possible days it is actually based on ("N of 30 possible snapshots").
//
// Batch C (v3.144.0) extracted the PPI/band math into condor-index-core.js, with a
// user-tunable `condor.indexConfig` and an unconditional capacity safety floor. A historical
// snapshot's `ppi`/`band` were computed under whatever config was active THAT DAY — this
// module reads those recorded values as-is and never recomputes them under today's config
// (doing so would silently rewrite history and could disagree with what a partner actually
// saw on the day). Trend rows for the pressure index therefore carry a note that the figures
// are as-recorded, not restated.
//
// House pattern: pure core (this file) + thin render wiring (condor.js Pulse section,
// report-render.js prior-period block) + self-contained test-pulse-core.js.

'use strict';

// Metric definitions — key into a snapshot row, plus display metadata. Only metrics that
// snapshots actually record are ever surfaced (buildPulseRows filters to rows with at least
// one non-null value across the whole series before including a metric).
//
// `worseDirection` says which delta direction should read as a warning colour in the UI:
// 'up' = rising is worse (pressure, demand, urgent, task age); 'down' = falling is worse
// (slots/capacity remaining). Neither implies the other direction is "good" — see
// classifyDelta: only the worsening direction is ever coloured amber/red, matching the
// suite's calm, alert-salience-preserving house style.
export const PULSE_METRICS = [
  { key: 'ppi', label: 'Pressure index', unit: '/100', worseDirection: 'up' },
  { key: 'demand', label: 'Daily demand', unit: '', worseDirection: 'up' },
  { key: 'slotsRemaining', label: 'Slots free', unit: '', worseDirection: 'down' },
  { key: 'waitingArrived', label: 'Waiting room', unit: '', worseDirection: 'up' },
  { key: 'urgent', label: 'Urgent tasks', unit: '', worseDirection: 'up' },
  { key: 'tasksGt8h', label: 'Tasks >8h old', unit: '', worseDirection: 'up' },
];

const PERIODS = { 7: 7, 30: 30 };

function localISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localISO(dt);
}

// Inclusive [start, end] window of `days` calendar dates ending at `endISO`.
function windowDates(endISO, days) {
  const start = addDays(endISO, -(days - 1));
  const out = [];
  for (let i = 0; i < days; i++) out.push(addDays(start, i));
  return out;
}

// Mean of the non-null values for `key` across a set of snapshot rows. Returns null (not 0)
// when there are no recorded values — a genuinely empty prior period must never look like a
// recorded zero.
function meanOf(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

// Direction + a plain-English classification of a delta, given which raw direction counts
// as "worse" for this metric. Never colours/labels a delta when either side is unavailable.
function classifyDelta(current, priorMean, worseDirection) {
  if (current == null || priorMean == null) return { delta: null, pct: null, direction: 'unknown' };
  const delta = Math.round((current - priorMean) * 10) / 10;
  const pct = priorMean !== 0 ? Math.round((delta / priorMean) * 100) : null;
  let direction = 'flat';
  if (delta > 0) direction = 'up';
  else if (delta < 0) direction = 'down';
  // 'worsening' | 'improving' | 'flat' — the UI colours only 'worsening'.
  let sense = 'flat';
  if (direction !== 'flat') {
    sense = direction === worseDirection ? 'worsening' : 'improving';
  }
  return { delta, pct, direction, sense };
}

// Build the per-metric trend rows for a period (7 or 30 days) from the FULL stored snapshot
// series (unfiltered — this function does its own windowing). `opts.today` pins "now" for
// tests. `opts.asOf` (ISO date) lets the caller anchor the window to something other than
// today (e.g. rendering inside a Practice Report generated for a past range) — defaults to
// today.
//
// Returns { period, asOf, window: {start,end,days}, priorWindow: {start,end,days}, metrics: [
//   { key, label, unit, series: [{date, value}], current, currentDate, priorMean, delta, pct,
//     direction, sense, coverage: { recorded, possible, text } }
// ] }
//
// Never throws on empty/malformed input. A metric is included only if at least one snapshot
// in the FULL series (not just this window) ever recorded it — so a practice that has never
// enabled Request Monitor simply doesn't get a "Task age" row, rather than a permanently-empty
// one.
export function buildPulseRows(snapshots, period, opts = {}) {
  const days = PERIODS[period] || 7;
  const today = opts.today || localISO();
  const asOf = opts.asOf || today;
  const all = Array.isArray(snapshots) ? snapshots.filter((s) => s && s.date) : [];

  const window = { start: addDays(asOf, -(days - 1)), end: asOf, days };
  const priorWindow = { start: addDays(window.start, -days), end: addDays(window.start, -1), days };

  const byDate = new Map(all.map((s) => [s.date, s]));
  const windowRows = windowDates(window.end, days)
    .map((d) => byDate.get(d))
    .filter(Boolean);
  const priorRows = windowDates(priorWindow.end, days)
    .map((d) => byDate.get(d))
    .filter(Boolean);

  const metrics = PULSE_METRICS.filter((m) => all.some((s) => s[m.key] != null)).map((m) => {
    const series = windowDates(window.end, days).map((date) => {
      const row = byDate.get(date);
      const value = row && row[m.key] != null ? row[m.key] : null;
      return { date, value };
    });
    const recordedInWindow = series.filter((p) => p.value != null);
    const latest = recordedInWindow.length ? recordedInWindow[recordedInWindow.length - 1] : null;
    const priorMean = meanOf(priorRows, m.key);
    const cmp = classifyDelta(latest ? latest.value : null, priorMean, m.worseDirection);

    const recorded = recordedInWindow.length;
    const possible = days;
    const coverageText =
      recorded === possible
        ? `based on ${recorded} of ${possible} possible snapshots`
        : `based on ${recorded} of ${possible} possible snapshots — some days had no reading`;

    return {
      key: m.key,
      label: m.label,
      unit: m.unit,
      series,
      current: latest ? latest.value : null,
      currentDate: latest ? latest.date : null,
      priorMean,
      priorRecorded: priorRows.filter((r) => r[m.key] != null).length,
      priorPossible: days,
      delta: cmp.delta,
      pct: cmp.pct,
      direction: cmp.direction,
      sense: cmp.sense,
      coverage: { recorded, possible, text: coverageText },
    };
  });

  return { period: days, asOf, window, priorWindow, metrics };
}

// Whole-series coverage line for the UI header ("Pulse is based on snapshots captured while
// the panel is open — N of the last 30 days have a reading."). Pure convenience wrapper
// around buildPulseRows's per-metric coverage, using the richest available metric (most
// snapshots have `ppi`, since it's computed whenever Condor can fetch at all) so a single
// honest summary line can be shown even when different metrics have different coverage.
export function coverageSummary(snapshots, period, opts = {}) {
  const built = buildPulseRows(snapshots, period, opts);
  if (!built.metrics.length) {
    return { recorded: 0, possible: built.window.days, text: `No snapshots recorded in this period yet.` };
  }
  // Use the metric with the most coverage — under-states nothing, and avoids picking a
  // sparsely-recorded metric (e.g. Request Monitor not configured) to describe the whole set.
  const best = built.metrics.reduce((a, b) => (b.coverage.recorded > a.coverage.recorded ? b : a));
  return best.coverage;
}
