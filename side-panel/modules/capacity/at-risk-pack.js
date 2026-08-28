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

const STATUS_LABEL = {
  sufficient: 'Sufficient',
  tight: 'Tight',
  low: 'Low',
  critical: 'Critical',
  closed: 'Closed',
};

function riskDefinition(lookahead) {
  const includeTight = lookahead?.includeTight;
  const base = includeTight ? 'Critical, Low, or Tight' : 'Critical or Low';
  return `At-risk = ${base} vs effective minimum (preset thresholds).`;
}

function lookAheadSentence(summary, presetName) {
  if (!summary) return 'Capacity look-ahead unavailable.';
  const name = presetName ? ` (${presetName})` : '';
  if (summary.atRiskCount === 0) {
    return `No at-risk days in the next ${summary.horizonDays} days${name}.`;
  }
  const bits = [];
  if (summary.critical) bits.push(`${summary.critical} critical`);
  if (summary.low) bits.push(`${summary.low} low`);
  if (summary.tight) bits.push(`${summary.tight} tight`);
  const worst =
    summary.worstDate && summary.worstStatus
      ? ` Worst: ${fmtDateShort(summary.worstDate)} (${summary.worstStatus}).`
      : '';
  const post = summary.postHolidayRisk > 0 ? ` ${summary.postHolidayRisk} post–bank-holiday.` : '';
  return `${summary.atRiskCount} day${summary.atRiskCount === 1 ? '' : 's'} at risk in the next ${summary.horizonDays} days${name}: ${bits.join(', ')}.${worst}${post}`;
}

function rowHtml(d) {
  const statusClass = `status-${d.status}`;
  const min = d.minInfo?.effective ?? '';
  return `
    <tr>
      <td>${esc(fmtDateShort(d.dateISO))}</td>
      <td>${esc(d.weekday || '')}</td>
      <td class="num">${esc(d.total ?? '')}</td>
      <td class="num">${esc(min)}</td>
      <td class="${statusClass}">${esc(STATUS_LABEL[d.status] || d.status)}</td>
      <td>${esc(d.reason || '')}</td>
    </tr>`;
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

  const horizon = model.lookahead?.horizonDays || model.scan.horizonDays || 28;
  const presetName = model.preset?.name || 'Preset';
  const summary = model.scan.summary;
  const atRisk = model.scan.atRisk || [];
  const upliftNote = model.lookahead?.upliftEnabled
    ? 'Post–bank-holiday uplifts are editable estimates, not published F2F figures.'
    : 'Post–bank-holiday uplifts disabled for this pack.';

  let body;
  if (atRisk.length === 0) {
    body = '<div class="empty">No days at risk in this horizon.</div>';
  } else {
    body = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Free</th>
            <th>Minimum</th>
            <th>Status</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          ${atRisk.map(rowHtml).join('')}
        </tbody>
      </table>`;
  }

  content.innerHTML = `
    <h1>Capacity at risk &mdash; next ${horizon} days</h1>
    <div class="meta">
      ${esc(model.practiceLabel || 'Practice')} &middot; Preset: ${esc(presetName)}<br>
      Generated ${esc(fmtDateTime(model.generatedAt))}<br>
      ${esc(riskDefinition(model.lookahead))}
    </div>
    <div class="note">${upliftNote}</div>
    <div class="summary">${esc(lookAheadSentence(summary, presetName))}</div>
    ${body}
    <div class="footer">
      Estimates only &mdash; check the Medicus appointment book before changing sessions.
    </div>`;

  chrome.storage.local.remove('capacity.riskPack');
}

document.getElementById('printBtn').addEventListener('click', () => window.print());
render();
