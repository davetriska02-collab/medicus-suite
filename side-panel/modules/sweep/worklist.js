// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep clinic-prep worklist renderer.
//
// Reads the model written by sweep.js (buildWorklist output, sweep-core.js)
// from the transient 'sweep.worklist' key and renders the printable prep
// list, grouped by WHAT kind of prep is needed (bloods / checks / vaccines /
// reviews) rather than by patient. Structurally copied from handout.js: the
// key is removed from storage immediately after render (consume-on-read), so
// patient-identifiable data does not linger on disk on shared GP workstations.
// Acceptable trade-off: a manual page refresh (F5) after this point will show
// the empty state because the one-shot payload has been consumed. This is
// intentional — it is better than leaving patient data on disk. The Print
// button works on the already-rendered DOM.
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

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// "Who is this worklist for?" label — identical convention to handout.js.
function clinicianWhoFor(model) {
  const list = Array.isArray(model.clinicians)
    ? model.clinicians.filter(Boolean)
    : model.clinician
      ? [model.clinician]
      : [];
  if (list.length === 0) return 'All clinicians';
  if (list.length === 1) return `${list[0]}'s patients`;
  return `${list.join(', ')} (${list.length} clinicians)`;
}

function patientHtml(p, showClinician) {
  const time = p.time ? `<span class="patient-time">${esc(fmtTime(p.time))}</span>` : '';
  const clin = showClinician && p.clinician ? `<span class="patient-clin">${esc(p.clinician)}</span>` : '';
  const items = (p.items || [])
    .map(
      (item) => `
    <div class="action">
      <span class="box">&#9744;</span>
      <span class="what">${esc(item)}</span>
    </div>`
    )
    .join('');
  return `
    <div class="patient">
      <div class="patient-head">${time}<span class="patient-name">${esc(p.name)}</span>${clin}</div>
      ${items}
    </div>`;
}

function sectionHtml(title, rows, showClinician) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return `<h2 class="section-title">${esc(title)} (${rows.length})</h2>${rows.map((p) => patientHtml(p, showClinician)).join('')}`;
}

function bucketItemCount(rows) {
  return (rows || []).reduce((n, p) => n + (p.items ? p.items.length : 0), 0);
}

async function render() {
  const content = document.getElementById('content');
  const r = await chrome.storage.local.get('sweep.worklist');
  const model = r['sweep.worklist'];

  const total = model
    ? (model.bloods || []).length +
      (model.checks || []).length +
      (model.vaccines || []).length +
      (model.reviews || []).length
    : 0;

  if (!model || total === 0) {
    content.innerHTML = `<div class="empty">No worklist found. Run a sweep in the side panel, then click "Print prep list".</div>`;
    return;
  }

  const whoFor = clinicianWhoFor(model);

  // A patient can appear in more than one bucket (e.g. methotrexate contributes
  // both a blood and a check line) — count unique patients, not row entries.
  const uuids = new Set();
  ['bloods', 'checks', 'vaccines', 'reviews'].forEach((k) => (model[k] || []).forEach((p) => uuids.add(p.uuid)));
  const itemCount =
    bucketItemCount(model.bloods) +
    bucketItemCount(model.checks) +
    bucketItemCount(model.vaccines) +
    bucketItemCount(model.reviews);

  // The clinic day the sweep was for (may be today or a future clinic) — kept
  // distinct from when the worklist was generated, mirrors handout.js.
  const clinicDay = model.clinicDate
    ? fmtDate(/^\d{4}-\d{2}-\d{2}$/.test(model.clinicDate) ? model.clinicDate + 'T12:00:00' : model.clinicDate)
    : fmtDate(model.generatedAt);

  const showClinician = !model.clinician;

  content.innerHTML = `
    <h1>Clinic prep worklist for ${esc(clinicDay)}</h1>
    <div class="meta">${esc(whoFor)} &middot; ${uuids.size} patient${uuids.size === 1 ? '' : 's'}, ${itemCount} item${itemCount === 1 ? '' : 's'} &middot; generated ${esc(new Date(model.generatedAt).toLocaleString('en-GB'))} &middot; Medicus Suite v${esc(model.suiteVersion || '')}</div>
    <div class="confidential">Confidential &mdash; patient identifiable. Do not leave unattended. Destroy after use.</div>
    <div class="caveat">Prep aid only, not a checklist to rely on alone. Verify against the source record before prepping the tray. No alert &ne; nothing due &mdash; a patient not listed below may still have something due.</div>
    ${sectionHtml('Bloods', model.bloods, showClinician)}
    ${sectionHtml('Checks', model.checks, showClinician)}
    ${sectionHtml('Vaccines', model.vaccines, showClinician)}
    ${sectionHtml('Reviews', model.reviews, showClinician)}
    <div class="footer">
      Tick each box as you prep it. If you are unsure about any item, flag it to the duty clinician rather than skipping it.<br>
      Generated by Medicus Suite from a point-in-time snapshot &mdash; a clinician must verify against the source record. This list groups WHAT to prep, not booking instructions (see the reception handout for those).
    </div>`;

  // Consume-on-read: remove the transient key now that the DOM is rendered.
  // The Print button works on the already-rendered DOM; a page refresh will
  // show the empty state — that is intentional (privacy over convenience).
  chrome.storage.local.remove('sweep.worklist');
}

document.getElementById('printBtn').addEventListener('click', () => window.print());
render();
