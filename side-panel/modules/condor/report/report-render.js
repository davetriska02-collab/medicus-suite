// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Practice Report — renderer (pure HTML + CSV builders).
//
// Takes the dataset from report-data.buildReport() AFTER report-profiles.applyProfile()
// and produces the report HTML and a CSV export. Pure string-building, no I/O, so the
// section gating and the "no per-clinician in staff/icb" invariant are unit-testable.
//
// Visual classes (.pr-card / .pr-grid / .pr-stat / .pr-table / .pr-badge-*) are defined
// in practice-report.css, which mirrors the visualiser's NHS-token print aesthetic.

'use strict';

import { comparePct, DEMAND_KEYS } from './report-data.js';

const DEMAND_LABELS = {
  medical: 'Medical requests',
  admin: 'Admin requests',
  investigation: 'Results to file',
  rxRoutine: 'Routine prescriptions',
  rxNonRoutine: 'Non-routine prescriptions',
};

const ACTIVITY_LABELS = {
  consultations: 'Consultations',
  routinePrescriptionRequestTasks: 'Routine Rx',
  nonRoutinePrescriptionRequestTasks: 'Non-routine Rx',
  medicationReviews: 'Medication reviews',
  documentTasks: 'Documents',
  investigationReportTasks: 'Results',
};

// Referrals use NHS-correct terminology: 2WW is the Urgent Suspected Cancer pathway
// (the 28-day Faster Diagnosis Standard superseded the 2-week target).
const PRIORITY_LABELS = {
  Routine: 'Routine',
  Urgent: 'Urgent',
  TwoWeekWait: 'Urgent suspected cancer (2WW / FDS)',
};

export function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

function fmtTime(isoTs) {
  try {
    return new Date(isoTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// Minimal inline-SVG sparkline from a numeric series.
export function sparkline(values, { w = 160, h = 28 } = {}) {
  const nums = (values || []).map((v) => Number(v) || 0);
  if (nums.length < 2) return '';
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const step = w / (nums.length - 1);
  const pts = nums
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    `<svg class="pr-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">` +
    `<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`
  );
}

function bandBadge(band) {
  if (!band) return '';
  const cls = band === 'GREEN' ? 'green' : band === 'AMBER' ? 'amber' : 'red';
  return `<span class="pr-badge pr-badge-${cls}">${esc(band)}</span>`;
}

function statTile(label, value, sub = '') {
  return (
    `<div class="pr-stat"><div class="pr-stat-value">${esc(value)}</div>` +
    `<div class="pr-stat-label">${esc(label)}</div>${sub ? `<div class="pr-stat-sub">${esc(sub)}</div>` : ''}</div>`
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function renderCover(report) {
  const r = report.range || {};
  return (
    `<header class="pr-cover">` +
    `<div class="pr-cover-row"><h1>Practice Report</h1>${report.profile ? `<span class="pr-profile-tag">${esc(report.profile.name)}</span>` : ''}</div>` +
    `<div class="pr-cover-meta">` +
    `<span><strong>Period:</strong> ${esc(r.label || '')} (${fmtDate(r.start)}&ndash;${fmtDate(r.end)})</span>` +
    `<span><strong>Practice:</strong> ${esc(report.siteId || '')}</span>` +
    `<span><strong>Generated:</strong> ${fmtDate(report.generatedAt?.slice(0, 10))} ${fmtTime(report.generatedAt)}</span>` +
    `</div>` +
    (report.profile?.blurb ? `<p class="pr-cover-blurb">${esc(report.profile.blurb)}</p>` : '') +
    `</header>`
  );
}

function renderCurrentSnapshot(report) {
  const s = report.currentSnapshot;
  if (!s) return '';
  const tiles = [];
  if (typeof s.ppi === 'number') tiles.push(statTile('Pressure index', `${s.ppi}/100`, s.band || ''));
  if (s.demand != null) tiles.push(statTile('Requests today', s.demand));
  if (s.slotsRemaining != null) tiles.push(statTile('Slots free now', s.slotsRemaining));
  if (s.waitingArrived != null) tiles.push(statTile('In waiting room', s.waitingArrived));
  if (s.urgent != null) tiles.push(statTile('Urgent tasks', s.urgent));
  if (!tiles.length) return '';
  const stamp = report.generatedAt ? `as at ${fmtTime(report.generatedAt)}` : '';
  // C1: explain the index scale, and why a low index can read AMBER (capacity floor).
  let key = '';
  if (typeof s.ppi === 'number') {
    key = `<p class="pr-note">Pressure index scale: GREEN under 40 · AMBER 40&ndash;70 · RED 70 or over.`;
    if (s.bandFloored)
      key += ` Shown as AMBER because the practice is over capacity, even though the weighted index is ${s.ppi}.`;
    key += `</p>`;
  }
  return (
    `<section class="pr-card pr-card-live"><h2>Current snapshot ${s.band ? bandBadge(s.band) : ''}` +
    `<span class="pr-live-tag">LIVE</span><span class="pr-live-stamp">${esc(stamp)}</span></h2>` +
    `<p class="pr-note">A point-in-time reading taken when this report was generated &mdash; not part of the ${esc(report.range?.label || 'period')} figures below (these signals have no per-day history).</p>` +
    `<div class="pr-grid pr-grid-4">${tiles.join('')}</div>${key}</section>`
  );
}

function renderDemand(report) {
  const d = report.demand;
  if (!d || !d.summary) return '';
  const t = d.summary.totals;
  const tiles = [statTile('Total requests', t.all), statTile('Daily average', d.summary.dailyMean)];
  if (d.summary.peak) tiles.push(statTile('Busiest day', d.summary.peak.value, fmtDate(d.summary.peak.date)));
  const spark = sparkline((d.byDay || []).map((row) => row.all));
  const breakdown = DEMAND_KEYS.filter((k) => t[k])
    .map((k) => `<tr><td>${esc(DEMAND_LABELS[k] || k)}</td><td class="pr-num">${t[k]}</td></tr>`)
    .join('');
  return (
    `<section class="pr-card"><h2>Demand <span class="pr-spark-wrap">${spark}</span></h2>` +
    `<p class="pr-note">Inbound requests created in the period (medical, admin, results, prescriptions).</p>` +
    `<div class="pr-grid pr-grid-3">${tiles.join('')}</div>` +
    (breakdown
      ? `<table class="pr-table"><thead><tr><th>By type</th><th class="pr-num">Count</th></tr></thead><tbody>${breakdown}</tbody></table>`
      : '') +
    `</section>`
  );
}

function renderCapacity(report) {
  const c = report.capacity;
  if (!c || !Array.isArray(c.byDay)) return '';
  const days = c.byDay.filter((x) => x.slots != null);
  if (!days.length) return '';
  const totalSlots = days.reduce((s, x) => s + (x.slots || 0), 0);
  const totalSessions = days.reduce((s, x) => s + (x.sessions || 0), 0);
  const meanPerDay = Math.round((totalSlots / days.length) * 10) / 10;
  const spark = sparkline(c.byDay.map((x) => x.slots || 0));
  return (
    `<section class="pr-card"><h2>Capacity <span class="pr-spark-wrap">${spark}</span></h2>` +
    `<p class="pr-note">Appointment slots scheduled across the period (clinic capacity, not live availability).</p>` +
    `<div class="pr-grid pr-grid-3">` +
    statTile('Scheduled slots', totalSlots) +
    statTile('Sessions', totalSessions) +
    statTile('Slots / day', meanPerDay) +
    `</div></section>`
  );
}

function renderActivity(report) {
  const a = report.activity;
  if (!a || !a.totals) return '';
  const t = a.totals;
  // Metric columns present in the data (drives both the tiles and the table columns).
  const cols = Object.keys(ACTIVITY_LABELS).filter((k) => t[k]);
  const totalTiles = cols.map((k) => statTile(ACTIVITY_LABELS[k], t[k])).join('');

  // P3: demand (inbound) and activity (work done) are different measures.
  const demandNote = report.demand
    ? `<p class="pr-note">Demand (inbound requests) and activity (work done) are different measures and need not match.</p>`
    : '';

  let perClinician = '';
  if (!a.aggregateOnly && Array.isArray(a.users) && a.users.length) {
    // P1 + drill-down: per-clinician split by activity type, with a reconciling
    // "All clinicians" total row that ties to the tiles above.
    const head =
      `<tr><th>Clinician</th>` +
      cols.map((k) => `<th class="pr-num">${esc(ACTIVITY_LABELS[k])}</th>`).join('') +
      `<th class="pr-num">Total</th></tr>`;
    const rows = a.users
      .map(
        (u) =>
          `<tr><td>${esc(u.name)}</td>` +
          cols.map((k) => `<td class="pr-num">${(u.metrics && u.metrics[k]) || 0}</td>`).join('') +
          `<td class="pr-num"><strong>${u.total}</strong></td></tr>`
      )
      .join('');
    const totalRow =
      `<tr class="pr-row-total"><td>All clinicians</td>` +
      cols.map((k) => `<td class="pr-num">${t[k]}</td>`).join('') +
      `<td class="pr-num"><strong>${t.all}</strong></td></tr>`;
    perClinician =
      `<table class="pr-table"><thead>${head}</thead><tbody>${rows}${totalRow}</tbody></table>` +
      `<p class="pr-note">Each clinician's row sums to their total; the foot row reconciles to the totals above.</p>`;
  } else if (a.aggregateOnly) {
    perClinician = `<p class="pr-note">Shown for the whole practice. Per-clinician figures are deliberately omitted from this report.</p>`;
  }
  return (
    `<section class="pr-card"><h2>Activity (work done)</h2>${demandNote}` +
    `<div class="pr-grid pr-grid-3">${totalTiles || statTile('Total', t.all || 0)}</div>${perClinician}</section>`
  );
}

function renderReferrals(report) {
  const r = report.referrals;
  if (!r || !r.byPriority) return '';
  const prio = Object.entries(r.byPriority)
    .filter(([, n]) => n)
    .map(([k, n]) => `<tr><td>${esc(PRIORITY_LABELS[k] || k)}</td><td class="pr-num">${n}</td></tr>`)
    .join('');
  const status = r.byStatus
    ? Object.entries(r.byStatus)
        .filter(([, n]) => n)
        .map(([k, n]) => `<tr><td>${esc(k)}</td><td class="pr-num">${n}</td></tr>`)
        .join('')
    : '';
  return (
    `<section class="pr-card"><h2>Referrals</h2>` +
    `<div class="pr-grid pr-grid-3">${statTile('Total referrals', r.total ?? 0)}</div>` +
    (prio
      ? `<table class="pr-table"><thead><tr><th>By priority</th><th class="pr-num">Count</th></tr></thead><tbody>${prio}</tbody></table>`
      : '') +
    (status
      ? `<table class="pr-table"><thead><tr><th>By status</th><th class="pr-num">Count</th></tr></thead><tbody>${status}</tbody></table>`
      : '') +
    `</section>`
  );
}

function renderTrends(report) {
  const hist = report.snapshotHistory;
  if (!Array.isArray(hist) || hist.length < 2) return '';
  const ppiSeries = hist.map((s) => s.ppi).filter((v) => v != null);
  const demandSeries = hist.map((s) => s.demand).filter((v) => v != null);
  const parts = [];
  if (ppiSeries.length >= 2) {
    const cmp = comparePct(ppiSeries[ppiSeries.length - 1], ppiSeries[0]);
    parts.push(
      `<div class="pr-trend"><span class="pr-trend-label">Pressure index</span>${sparkline(ppiSeries)}<span class="pr-trend-delta">${cmp.pct == null ? '' : `${cmp.pct > 0 ? '+' : ''}${cmp.pct}%`}</span></div>`
    );
  }
  if (demandSeries.length >= 2) {
    parts.push(
      `<div class="pr-trend"><span class="pr-trend-label">Daily demand</span>${sparkline(demandSeries)}</div>`
    );
  }
  if (!parts.length) return '';
  return (
    `<section class="pr-card"><h2>Trends</h2>` +
    `<p class="pr-note">From daily snapshots captured since this feature was enabled (${hist.length} days).</p>${parts.join('')}</section>`
  );
}

// Map an internal error string to a plain-English, reader-facing note. Known
// expected conditions (e.g. referrals needs its report opened once) read as a
// neutral "not available" line; anything else is surfaced verbatim but calmly.
function humaniseError(err) {
  const e = String(err || '');
  if (/referrals/i.test(e) && /discovered URL|navigate to Referrals/i.test(e)) {
    return 'Referrals: not available yet. Open the Referrals tab (Clinical Audit Report) once to enable it; the figures above are unaffected.';
  }
  return e.replace(/\.+$/, '');
}

function renderLimitations(report) {
  const notes = (report.errors || []).map(humaniseError).filter(Boolean);
  const dataNotes = notes.length
    ? `<div class="pr-datanotes"><h3>Data notes</h3><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : '';
  return (
    `<footer class="pr-foot">${dataNotes}` +
    `<p class="pr-note">This report covers only data available from Medicus for the selected period. Metrics that cannot be derived from the source (e.g. call-waiting times, registered list size) are not shown rather than estimated. Verify against the source record before relying on any figure.</p>` +
    `</footer>`
  );
}

const SECTION_BUILDERS = {
  currentSnapshot: renderCurrentSnapshot,
  demand: renderDemand,
  capacity: renderCapacity,
  activity: renderActivity,
  referrals: renderReferrals,
  trends: renderTrends,
};

// Build the full report HTML body for a profile-applied report.
export function buildReportHtml(report) {
  const enabled = report.sectionsEnabled || {};
  const order = ['currentSnapshot', 'demand', 'capacity', 'activity', 'referrals', 'trends'];
  const sections = order
    .filter((k) => enabled[k] !== false)
    .map((k) => SECTION_BUILDERS[k](report))
    .filter(Boolean)
    .join('');
  return `<div class="pr-report">${renderCover(report)}${sections}${renderLimitations(report)}</div>`;
}

// Flat CSV export of the period's headline figures + per-day demand series.
export function buildReportCsv(report) {
  const header = ['date', ...DEMAND_KEYS, 'demand_total'];
  const rows = (report.demand?.byDay || []).map((d) => [d.date, ...DEMAND_KEYS.map((k) => d[k] || 0), d.all]);
  return { header, rows };
}
