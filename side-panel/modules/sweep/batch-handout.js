// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep batch handout renderer.
//
// Reads the model written by sweep.js (buildBatchPack + meta) from the
// transient 'sweep.batchPack' key and renders the printable / copy-ready
// batch output. The key is removed immediately after render (consume-on-read)
// so PHI does not linger on shared workstations.
//
// PHI discipline: all values go through esc(); the page carries a
// confidentiality banner that also prints; nothing is re-persisted.

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
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Render a "Copy" button that copies `text` to the clipboard when clicked.
// Returns an HTML string; the onclick is wired after innerHTML insertion.
let _copyButtonSeq = 0;
function copyBtnHtml(btnId) {
  return `<button class="copy-btn no-print" id="${esc(btnId)}" type="button">Copy</button>`;
}

function patientCardHtml(p) {
  const time = p.time ? `<span class="patient-time">${esc(fmtTime(p.time))}</span>` : '';
  const badges = [
    p.redCount > 0 ? `<span class="badge-red">${p.redCount} red</span>` : '',
    p.amberCount > 0 ? `<span class="badge-amber">${p.amberCount} amber</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  const bloodFormHtml = p.bloodForm
    ? `<div class="section-label">Blood form request</div>
       <div class="sms-wrap">
         ${copyBtnHtml(`copy-bf-${++_copyButtonSeq}`)}
         <div class="blood-form">${esc(p.bloodForm)}</div>
       </div>`
    : '';

  const smsHtml = p.sms
    ? `<div class="section-label">Recall SMS (first attempt)</div>
       <div class="sms-wrap">
         ${copyBtnHtml(`copy-sms-${++_copyButtonSeq}`)}
         <div class="sms-text">${esc(p.sms)}</div>
       </div>`
    : '';

  const taskHtml = p.task
    ? `<div class="section-label">Admin / pharmacist task</div>
       <div class="sms-wrap">
         ${copyBtnHtml(`copy-task-${++_copyButtonSeq}`)}
         <div class="sms-text">${esc(p.task)}</div>
       </div>`
    : '';

  const noContent =
    !bloodFormHtml && !smsHtml && !taskHtml
      ? '<div style="color:#888;font-size:12px;">No action-needed content for this patient.</div>'
      : '';

  return `
    <div class="patient">
      <div class="patient-head">
        ${time}
        <span class="patient-name">${esc(p.name)}</span>
        <span class="patient-badges">${badges}</span>
      </div>
      ${bloodFormHtml}
      ${smsHtml}
      ${taskHtml}
      ${noContent}
    </div>`;
}

async function render() {
  const content = document.getElementById('content');
  const r = await chrome.storage.local.get('sweep.batchPack');
  const model = r['sweep.batchPack'];

  if (!model || !Array.isArray(model.patients) || model.patients.length === 0) {
    content.innerHTML = `<div class="empty">No batch data found. Select patients in the Sweep panel and click "Generate batch".</div>`;
    return;
  }

  // Consume-on-read: remove the transient key immediately.
  chrome.storage.local.remove('sweep.batchPack');

  const whoFor = model.clinician ? `${model.clinician}'s patients` : 'All clinicians';
  const runAt = model.runAt || model.generatedAt;
  // The clinic day this batch was swept for — distinct from when it was
  // generated, so a batch prepared for a future clinic states which day.
  const clinicDay = model.clinicDate
    ? fmtDate(/^\d{4}-\d{2}-\d{2}$/.test(model.clinicDate) ? model.clinicDate + 'T12:00:00' : model.clinicDate)
    : fmtDate(runAt);

  // Build consolidated SMS block (all patients with an SMS, one entry each,
  // identified by name + time — no NHS numbers here since the appointment book
  // doesn't carry them, keeping the identifier to the minimum needed).
  const smsList = (model.patients || [])
    .filter((p) => p.sms)
    .map((p) => {
      const timeTag = p.time ? `[${fmtTime(p.time)}] ` : '';
      return `--- ${timeTag}${p.name} ---\n${p.sms}`;
    });

  const patientCardsHtml = (model.patients || []).map(patientCardHtml).join('');

  const smsAllHtml =
    smsList.length > 0
      ? `<div class="sms-all-section">
         <h2>Consolidated SMS list</h2>
         <p class="hint">Copy the block below and paste into Medicus batch messaging. Each section is labelled with the patient name and appointment time. Verify each message before sending — the human stays in the loop.</p>
         <div class="sms-all-wrap">
           ${copyBtnHtml(`copy-sms-all`)}
           <div class="sms-all-block" id="smsAllBlock">${esc(smsList.join('\n\n'))}</div>
         </div>
       </div>`
      : '';

  content.innerHTML = `
    <h1>Pre-clinic sweep for ${esc(clinicDay)} &mdash; batch output</h1>
    <div class="meta">${esc(whoFor)} &middot; ${model.patients.length} patient${model.patients.length === 1 ? '' : 's'} &middot; generated ${esc(new Date(runAt).toLocaleString('en-GB'))} &middot; Medicus Suite v${esc(model.suiteVersion || '')}</div>
    <div class="confidential">Confidential &mdash; patient identifiable. Do not leave unattended. Destroy after use.</div>
    ${patientCardsHtml}
    ${smsAllHtml}
    <div class="footer">
      This batch output was generated by Medicus Suite from a point-in-time snapshot &mdash; always verify alerts against the source record before sending any communication.<br>
      No item on this page is a clinical instruction. The human clinician / administrator stays in the loop for every send, print, or action.
    </div>`;

  // Wire up copy buttons after innerHTML is set
  content.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Find the sibling text element (blood-form or sms-text or sms-all-block)
      const wrap = btn.closest('.sms-wrap, .sms-all-wrap');
      const textEl = wrap && wrap.querySelector('.blood-form, .sms-text, .sms-all-block');
      const text = textEl ? textEl.textContent : '';
      if (!text) return;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 1800);
        })
        .catch(() => {
          // Fallback: select the text so the user can Ctrl+C
          const range = document.createRange();
          range.selectNodeContents(textEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
    });
  });
}

document.getElementById('printBtn').addEventListener('click', () => window.print());
render();
