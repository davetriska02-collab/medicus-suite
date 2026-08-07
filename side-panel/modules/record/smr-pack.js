// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — SMR prep pack renderer.
//
// FORK of side-panel/modules/sentinel/passport.js, not an extension of it —
// see smr-pack-core.js header for why (clinician-facing dense prep sheet vs
// patient-facing hand-out).
//
// Reads the model written by record.js (buildSmrPack output) from the transient
// 'record.smrPack' key and renders the printable SMR prep pack. The key is
// removed from storage immediately after render (consume-on-read), so patient-
// identifiable data (name, DOB, NHS number, problems, medications, observations)
// does not linger on disk on shared GP workstations. Acceptable trade-off: a
// manual page refresh (F5) after this point will show the empty state because
// the one-shot payload has been consumed. This is intentional — it is better
// than leaving PHI on disk. The Print button uses window.print() on the
// already-rendered DOM and continues to work after the key has been removed.
//
// Transient key convention: 'record.smrPack' is intentionally excluded from
// suite backup (it is a point-in-time print payload, not user configuration) —
// mirrors the treatment of 'sentinel.passport' / 'sweep.handout'. See the
// ALLOWLIST comment in test-backup-coverage.js (integrator-added).
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

function fmtDate(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Status severity → chip colour class. Local copy (not imported — this page is
// a classic script, same as passport.js) covering every status this pack can
// receive from smr-pack-core.js's statusLabel() vocabulary.
const STATUS_CLASS = {
  overdue: 'smr-status-red',
  not_met: 'smr-status-red',
  alert: 'smr-status-red',
  stale: 'smr-status-red',
  vax_due: 'smr-status-red',
  due_soon: 'smr-status-amber',
  caution: 'smr-status-amber',
  recently_initiated: 'smr-status-amber',
  no_data: 'smr-status-grey',
  noted: 'smr-status-grey',
  vax_declined: 'smr-status-grey',
  achieved: 'smr-status-green',
  in_date: 'smr-status-green',
  vax_given: 'smr-status-green',
};

function statusChipHtml(status, label) {
  const cls = STATUS_CLASS[status] || 'smr-status-grey';
  return `<span class="smr-status-chip ${cls}">${esc(label || status || 'Unknown')}</span>`;
}

function gapBlockHtml(gaps) {
  const rows = (gaps || [])
    .map(
      (g) => `
    <div class="smr-gap-row">
      <span class="smr-gap-label">${esc(g.label)}:</span>
      <span class="smr-gap-note">${esc(g.note)}</span>
    </div>`
    )
    .join('');
  return `
    <div class="smr-gaps" role="note">
      <div class="smr-gaps-h">Not shown in this pack (verify in Medicus)</div>
      ${rows}
    </div>`;
}

function problemsHtml(section) {
  if (!section || !section.count) {
    return `<div class="smr-empty">${esc((section && section.emptyNote) || 'No active problems recorded in live view.')}</div>`;
  }
  const items = section.active
    .map(
      (p) => `
    <li>
      <span class="smr-item-name">${esc(p.label)}${p.major ? '<span class="smr-flag smr-flag-major">Major</span>' : ''}</span>
      ${p.codedDate ? `<div class="smr-item-sub">Coded ${esc(fmtDate(p.codedDate))}</div>` : ''}
    </li>`
    )
    .join('');
  const pastNote = section.pastCount
    ? `<div class="smr-item-sub">${esc(section.pastCount)} past/inactive problem${section.pastCount === 1 ? '' : 's'} not shown</div>`
    : '';
  return `<ul class="smr-list">${items}</ul>${pastNote}`;
}

function medicationsHtml(section) {
  if (!section || !section.count) {
    return `<div class="smr-empty">${esc((section && section.emptyNote) || 'No current medications recorded in live view.')}</div>`;
  }
  const items = section.items
    .map((m) => {
      const flags = [];
      if (m.overdue) flags.push('<span class="smr-flag smr-flag-overdue">Overdue</span>');
      if (m.reviewOverdue) flags.push('<span class="smr-flag smr-flag-review">Review due</span>');
      return `
    <li>
      <span class="smr-item-name">${esc(m.name)}${flags.join('')}</span>
      ${m.dosage ? `<div class="smr-item-sub">${esc(m.dosage)}</div>` : ''}
    </li>`;
    })
    .join('');
  return `<ul class="smr-list">${items}</ul>`;
}

function monitoringHtml(section) {
  if (!section || !section.count) {
    return `<div class="smr-empty">${esc((section && section.emptyNote) || 'No drug-monitoring chips recorded for this patient in live view.')}</div>`;
  }
  const rows = section.items
    .map((c) => {
      const tests =
        Array.isArray(c.tests) && c.tests.length
          ? `<ul class="smr-subtests">${c.tests
              .map((t) => `<li>${esc(t.name)} — ${esc(t.statusLabel)}${t.dueText ? ` (${esc(t.dueText)})` : ''}</li>`)
              .join('')}</ul>`
          : '<span class="smr-empty">No per-test detail recorded.</span>';
      return `
    <tr>
      <td>${esc(c.drugName)}${c.sharedCare ? ' <span class="smr-flag smr-flag-review">Shared care</span>' : ''}</td>
      <td>${statusChipHtml(c.status, c.statusLabel)}</td>
      <td>${tests}</td>
    </tr>`;
    })
    .join('');
  return `
    <table class="smr-table" role="table" aria-label="Drug monitoring status">
      <thead><tr><th scope="col">Drug / rule</th><th scope="col">Status</th><th scope="col">Tests</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function safetyHtml(safety) {
  const acb = safety && safety.acb;
  const ss = safety && safety.stoppStart;
  const blocks = [];

  if (acb) {
    const perDrug =
      acb.perDrug && acb.perDrug.length
        ? `Contributing: ${acb.perDrug.map((d) => `${esc(d.name)} (${esc(String(d.score))})`).join(', ')}`
        : '';
    blocks.push(`
      <div class="smr-safety-block">
        <div class="smr-safety-h">Anticholinergic burden (ACB)${acb.available ? `: ${esc(String(acb.total))}${acb.alert ? ' — High (≥ 3)' : ''}` : ''}</div>
        <div class="smr-safety-body">${acb.available ? esc(perDrug || acb.note || '') : esc(acb.note || '')}</div>
      </div>`);
  }

  if (ss) {
    const flagsHtml =
      ss.available && ss.flags.length
        ? `<ul class="smr-subtests">${ss.flags
            .map((f) => `<li>[${esc(f.kind.toUpperCase())}] ${esc(f.criterion)}</li>`)
            .join('')}</ul>`
        : `<div class="smr-safety-body">${esc(ss.note || '')}</div>`;
    blocks.push(`
      <div class="smr-safety-block">
        <div class="smr-safety-h">STOPP/START prompts${ss.available ? `: ${esc(String(ss.count))}` : ''}</div>
        ${flagsHtml}
      </div>`);
  }

  return `${blocks.join('')}<p class="smr-prompt-caveat">These are deterministic prompts to review, not prescribing decisions, and exclude allergies.</p>`;
}

function qofHtml(section) {
  if (!section || !section.checkedCount) {
    return `<div class="smr-empty">${esc((section && section.emptyNote) || 'No QOF indicator or register chips recorded for this patient in live view.')}</div>`;
  }
  const rows = section.items
    .map(
      (q) => `
    <tr>
      <td>${esc(q.code || '')}</td>
      <td>${esc(q.name || '')}</td>
      <td>${statusChipHtml(q.status, q.statusLabel)}</td>
    </tr>`
    )
    .join('');
  return `
    <table class="smr-table" role="table" aria-label="QOF gaps">
      <thead><tr><th scope="col">Code</th><th scope="col">Indicator / register</th><th scope="col">Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function observationsHtml(section) {
  if (!section || !section.count) {
    return `<div class="smr-empty">${esc((section && section.emptyNote) || 'No recent results recorded in live view.')}</div>`;
  }
  const rows = section.items
    .map((o) => {
      const arrow = o.flag === 'high' ? ' ↑' : o.flag === 'low' ? ' ↓' : '';
      return `
    <tr>
      <td>${esc(o.name)}</td>
      <td>${esc(o.value)}${arrow}</td>
      <td>${o.date ? esc(fmtDate(o.date)) : ''}</td>
    </tr>`;
    })
    .join('');
  return `
    <table class="smr-table" role="table" aria-label="Latest observations">
      <thead><tr><th scope="col">Test</th><th scope="col">Result</th><th scope="col">Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function render() {
  const content = document.getElementById('content');
  const r = await chrome.storage.local.get('record.smrPack');
  const model = r['record.smrPack'];

  if (!model || !model.patient) {
    content.innerHTML = `<div class="empty-page">No SMR prep pack found. Open a patient record in Medicus, then click "SMR prep pack" in the Record tab.</div>`;
    return;
  }

  const { patient, practice, generatedAt, gaps, problems, medications, monitoring, safety, qof, observations, caveat } =
    model;
  const dateStr = fmtDateTime(generatedAt);
  const nameBits = [];
  if (patient.ageYears != null) nameBits.push(`${esc(patient.ageYears)}y`);
  if (patient.sex) nameBits.push(esc(patient.sex));
  if (patient.dob) nameBits.push(`DOB ${esc(fmtDate(patient.dob))}`);
  const nhs = patient.nhsNumber ? esc(patient.nhsNumber).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : '';

  const headerHtml = `
    <h1>SMR prep pack &mdash; ${esc(patient.name)}</h1>
    <div class="smr-meta">
      ${nameBits.join(' &middot; ')}
      ${nhs ? ` &middot; NHS ${nhs}` : ''}
      ${patient.namedGP ? ` &middot; Named GP: ${esc(patient.namedGP)}` : ''}
      ${patient.isDeceased ? ' &middot; <strong>DECEASED</strong>' : ''}
      ${patient.testPatient ? ' &middot; <strong>TEST PATIENT</strong>' : ''}
    </div>
    <div class="smr-sub-meta">
      Generated ${esc(dateStr)}${practice ? ` &middot; ${esc(practice.practiceName)} &middot; ${esc(practice.clinicianName)}` : ''}
    </div>
    <div class="confidential">Confidential clinical document &mdash; belongs to ${esc(patient.name)}. Do not leave unattended.</div>
    <div class="smr-caveat">${esc(caveat)}</div>`;

  const bodyHtml = `
    ${gapBlockHtml(gaps)}
    <div class="smr-cols">
      <div class="smr-col">
        <section class="smr-card">
          <h2>Active problems</h2>
          ${problemsHtml(problems)}
        </section>
        <section class="smr-card">
          <h2>Current medications</h2>
          ${medicationsHtml(medications)}
        </section>
      </div>
      <div class="smr-col">
        <section class="smr-card">
          <h2>Prescribing safety prompts</h2>
          ${safetyHtml(safety)}
        </section>
        <section class="smr-card">
          <h2>QOF gaps</h2>
          ${qofHtml(qof)}
        </section>
      </div>
    </div>
    <section class="smr-card">
      <h2>Monitoring status</h2>
      ${monitoringHtml(monitoring)}
    </section>
    <section class="smr-card">
      <h2>Latest observations</h2>
      ${observationsHtml(observations)}
    </section>`;

  const footerHtml = `
    <div class="smr-footer">
      <div class="smr-caveat">${esc(caveat)}</div>
      <p>Printed from Medicus Suite on ${esc(dateStr)}. Prepared for SMR — not a substitute for reviewing the full patient record.</p>
    </div>`;

  content.innerHTML = headerHtml + bodyHtml + footerHtml;

  // Consume-on-read: remove the transient key now that the DOM is rendered.
  // The Print button works on the already-rendered DOM; a page refresh will
  // show the empty state — that is intentional (privacy over convenience).
  chrome.storage.local.remove('record.smrPack');
}

document.getElementById('printBtn').addEventListener('click', () => window.print());
render();
