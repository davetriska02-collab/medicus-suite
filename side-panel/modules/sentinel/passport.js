// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Patient Passport renderer.
//
// Reads the model written by sentinel.js (buildPassport output) from the transient
// 'sentinel.passport' key and renders the printable patient health summary. The key
// is removed from storage immediately after render (consume-on-read), so patient-
// identifiable data (name, DOB, NHS number, observations) does not linger on disk
// on shared GP workstations. Acceptable trade-off: a manual page refresh (F5) after
// this point will show the empty state because the one-shot payload has been consumed.
// This is intentional — it is better than leaving NHS numbers on disk.
// The Print button uses window.print() on the already-rendered DOM and continues to
// work after the key has been removed.
//
// Transient key convention: 'sentinel.passport' is intentionally excluded from
// suite backup (it is a point-in-time print payload, not user configuration).
// This mirrors the treatment of 'sweep.handout' in test-backup-coverage.js —
// see the ALLOWLIST comment in that file.
//
// Everything rendered here is patient-identifiable — all values go through
// esc() and the page carries a confidentiality banner that also prints.

'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function statusChipHtml(status, statusLabel) {
  if (!statusLabel) return '';
  const cls =
    status === 'good'
      ? 'pass-status-good'
      : status === 'soon'
        ? 'pass-status-soon'
        : status === 'action'
          ? 'pass-status-action'
          : 'pass-status-none';
  return `<span class="pass-status-chip ${cls}" aria-label="Status: ${esc(statusLabel)}">${esc(statusLabel)}</span>`;
}

async function render() {
  const content = document.getElementById('content');
  const r = await chrome.storage.local.get('sentinel.passport');
  const model = r['sentinel.passport'];

  if (!model || !model.patient) {
    content.innerHTML = `<div class="empty">No health summary found. Open a patient record in Medicus, then click "Print patient summary" in the Sentinel panel.</div>`;
    return;
  }

  const { patient, generatedAt, due, numbers, nothingDue } = model;
  const dateStr = fmtDate(generatedAt);

  // ── Header ──────────────────────────────────────────────────────────────────
  const headerHtml = `
    <h1>Your health summary &mdash; ${esc(patient.name)}</h1>
    <div class="pass-meta">
      ${patient.dob ? `Date of birth: ${esc(patient.dob)}` : ''}
      ${patient.dob && patient.nhsNumber ? ' &middot; ' : ''}
      ${patient.nhsNumber ? `NHS number: ${esc(patient.nhsNumber)}` : ''}
    </div>
    <div class="pass-date">Printed: ${esc(dateStr)}</div>
    <div class="confidential">Confidential &mdash; this sheet belongs to ${esc(patient.name)}. Do not leave unattended. Keep it safe.</div>`;

  // ── Due section ─────────────────────────────────────────────────────────────
  let dueHtml;
  if (nothingDue || !Array.isArray(due) || due.length === 0) {
    dueHtml = `<p class="pass-nothing-due">Nothing is due right now &mdash; well done.</p>`;
  } else {
    const items = due
      .map(
        (d) => `
      <li class="pass-due-item">
        <span class="pass-due-title">${esc(d.title)}</span>
        <span class="pass-due-why">${esc(d.why)}</span>
      </li>`
      )
      .join('');
    dueHtml = `<ul class="pass-due-list">${items}</ul>`;
  }

  // ── Numbers section ─────────────────────────────────────────────────────────
  let numbersHtml = '';
  if (Array.isArray(numbers) && numbers.length > 0) {
    const rows = numbers
      .map(
        (n) => `
      <tr>
        <td class="pass-num-label">${esc(n.label)}</td>
        <td class="pass-num-value">${esc(n.value)}</td>
        <td>${statusChipHtml(n.status, n.statusLabel)}</td>
        <td class="pass-num-meaning">${esc(n.meaning)}</td>
      </tr>`
      )
      .join('');
    numbersHtml = `
      <h2>Your numbers</h2>
      <table class="pass-numbers" role="table" aria-label="Your health numbers">
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Result</th>
            <th scope="col">Status</th>
            <th scope="col">What this means</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footerHtml = `
    <div class="pass-footer">
      <p class="pass-footer-bring">Bring this sheet to your next appointment.</p>
      <p>This sheet was printed from your GP record on ${esc(dateStr)}. If anything looks wrong, please tell your practice.</p>
      <p style="margin-top:6px">Generated by Medicus Suite. This is a summary only &mdash; always talk to your doctor or nurse for advice.</p>
    </div>`;

  content.innerHTML = headerHtml + `<h2>What&rsquo;s due for you</h2>` + dueHtml + numbersHtml + footerHtml;

  // Consume-on-read: remove the transient key now that the DOM is rendered.
  // The Print button works on the already-rendered DOM; a page refresh will
  // show the empty state — that is intentional (privacy over convenience).
  chrome.storage.local.remove('sentinel.passport');
}

document.getElementById('printBtn').addEventListener('click', () => window.print());
render();
