// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Capacity at-risk pack renderer.
//
// Reads the model written by capacity.js from the transient 'capacity.riskPack'
// key and renders the printable look-ahead summary. The key is removed from
// storage immediately after render (consume-on-read). A page refresh after
// that shows the empty state — intentional.

'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateLong(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const STATUS_LABEL = {
  sufficient: 'Sufficient',
  tight: 'Tight',
  low: 'Low',
  critical: 'Critical',
  closed: 'Closed',
};

const STATUS_TAG = {
  critical: 'CRITICAL',
  low: 'LOW',
  tight: 'TIGHT',
};

function riskDefinition(lookahead) {
  const includeTight = lookahead?.includeTight;
  const base = includeTight
    ? 'Critical, Low, or Tight compared with the preset target'
    : 'Critical or Low compared with the preset target';
  return `Days are listed when free appointment slots fall below the target set by your preset (${base}). Today is excluded because only part of the day remains.`;
}

function dateRangeText(scan, horizonDays) {
  const from = scan?.fromISO;
  const to = scan?.toISO;
  if (from && to) return `${fmtDateLong(from)} to ${fmtDateLong(to)}`;
  const days = horizonDays || scan?.horizonDays || 28;
  return `the next ${days} days ahead`;
}

function incompleteBanner(summary) {
  const unchecked = summary?.uncheckedDays ?? 0;
  const working = summary?.workingDays ?? 0;
  const loaded = summary?.loadedDays ?? 0;
  return `
    <div class="incomplete-banner" role="alert">
      Incomplete scan &mdash; ${esc(unchecked)} of ${esc(working)} days could not be read from Medicus
      <div class="detail">Only ${esc(loaded)} of ${esc(working)} working days were checked. Do not treat this pack as a full picture until Medicus data is available for every day.</div>
    </div>`;
}

function summaryParagraph(summary, presetName) {
  if (!summary) return 'Capacity look-ahead unavailable.';
  const name = presetName ? ` (${presetName})` : '';
  const days = summary.horizonDays;

  if (!summary.workingDays || !summary.loadedDays) {
    return `Could not check the next ${days} days ahead${name} — no capacity data was available from Medicus.`;
  }

  if (summary.atRiskCount === 0) {
    if (summary.complete) {
      return `All ${summary.workingDays} working days were checked${name}. None fall below the preset target.`;
    }
    return `Checked ${summary.loadedDays} of ${summary.workingDays} working days${name} — none below target so far, but ${summary.uncheckedDays} day${summary.uncheckedDays === 1 ? '' : 's'} could not be read.`;
  }

  const bits = [];
  if (summary.critical) bits.push(`${summary.critical} critical`);
  if (summary.low) bits.push(`${summary.low} low`);
  if (summary.tight) bits.push(`${summary.tight} tight`);
  const worst =
    summary.worstDate && summary.worstStatus
      ? ` Worst day: ${fmtDateShort(summary.worstDate)} (${STATUS_LABEL[summary.worstStatus] || summary.worstStatus}).`
      : '';
  const gap =
    summary.uncheckedDays > 0
      ? ` ${summary.uncheckedDays} day${summary.uncheckedDays === 1 ? '' : 's'} could not be checked.`
      : '';
  return `${summary.atRiskCount} day${summary.atRiskCount === 1 ? '' : 's'} below target in the next ${days} days ahead${name}: ${bits.join(', ')}.${worst}${gap}`;
}

function postHolidayHeaderNote(summary) {
  if (!summary?.postHolidayRisk) return '';
  const n = summary.postHolidayRisk;
  return `
    <p class="post-holiday-note">${esc(n)} at-risk day${n === 1 ? '' : 's'} include extra demand after a bank holiday (adjusted target shown in the table).</p>`;
}

function whyCell(d) {
  const parts = [];
  if (d.reason) parts.push(esc(d.reason));
  if (d.minInfo?.upliftApplied) {
    parts.push('<span class="why-note">After bank holiday</span>');
  }
  return parts.join('') || '&mdash;';
}

function rowHtml(d) {
  const status = d.status || '';
  const statusClass = `status-cell status-${esc(status)}`;
  const tag = STATUS_TAG[status] || esc((STATUS_LABEL[status] || status).toUpperCase());
  const min = d.minInfo?.effective ?? '';
  return `
    <tr>
      <td>${esc(fmtDateShort(d.dateISO))}</td>
      <td>${esc(d.weekday || '')}</td>
      <td class="num">${esc(d.total ?? '')}</td>
      <td class="num">${esc(min)}</td>
      <td class="${statusClass}"><span class="status-tag">${tag}</span></td>
      <td>${whyCell(d)}</td>
    </tr>`;
}

function atRiskTable(atRisk) {
  return `
    <h2>Days below target</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Day</th>
          <th class="num">Free slots</th>
          <th class="num">Target</th>
          <th>Status</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        ${atRisk.map(rowHtml).join('')}
      </tbody>
    </table>`;
}

function emptyCompleteBody(summary, presetName) {
  const name = presetName ? ` (${esc(presetName)})` : '';
  return `
    <div class="empty-ok">
      <strong>All clear for this period</strong>
      Every working day in this range was checked${name}. None fall below the preset target.
      <div style="margin-top:10px;font-size:12px;">${esc(summary.workingDays)} working day${summary.workingDays === 1 ? '' : 's'} reviewed.</div>
    </div>`;
}

function upliftNote(lookahead) {
  if (lookahead?.upliftEnabled) {
    return 'Extra demand after a bank holiday uses adjustable estimates in the target column — not published face-to-face figures.';
  }
  return 'Extra demand after a bank holiday is not applied in this pack.';
}

function footerHtml() {
  return `
    <div class="footer">
      <p>Estimates only &mdash; check the Medicus appointment book before changing sessions.</p>
      <p>Operational planning &mdash; contains no patient-identifiable data.</p>
    </div>`;
}

async function render() {
  const content = document.getElementById('content');
  const r = await chrome.storage.local.get('capacity.riskPack');
  const model = r['capacity.riskPack'];

  if (!model || !model.scan) {
    content.innerHTML =
      '<div class="empty">No capacity pack found. Open Capacity Forecast in the side panel, then click &ldquo;Print pack&rdquo;.</div>';
    return;
  }

  const scan = model.scan;
  const horizon = model.lookahead?.horizonDays || scan.horizonDays || 28;
  const presetName = model.preset?.name || 'Preset';
  const summary = scan.summary || {};
  const atRisk = scan.atRisk || [];
  const complete = summary.complete === true;
  const range = dateRangeText(scan, horizon);

  let body = '';
  if (atRisk.length > 0) {
    body = atRiskTable(atRisk);
  } else if (complete) {
    body = emptyCompleteBody(summary, presetName);
  }

  const incompleteBlock = complete ? '' : incompleteBanner(summary);

  content.innerHTML = `
    <header class="doc-header">
      <h1>Capacity at risk</h1>
      <p class="meta"><strong>${esc(model.practiceLabel || 'Practice')}</strong> &middot; Preset: ${esc(presetName)}</p>
      <p class="meta">Period covered: ${esc(range)} (${esc(horizon)} days ahead)</p>
      <p class="meta">Generated ${esc(fmtDateTime(model.generatedAt))}</p>
      <p class="risk-def">${esc(riskDefinition(model.lookahead))}</p>
      <p class="risk-def">${esc(upliftNote(model.lookahead))}</p>
    </header>
    ${incompleteBlock}
    <section class="summary-block">
      <h2>Summary</h2>
      <p>${esc(summaryParagraph(summary, presetName))}</p>
      ${postHolidayHeaderNote(summary)}
    </section>
    ${body}
    ${footerHtml()}`;

  chrome.storage.local.remove('capacity.riskPack');
}

document.getElementById('printBtn').addEventListener('click', () => window.print());
render();
