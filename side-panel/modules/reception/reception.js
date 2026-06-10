// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception module
//
// A reception-facing panel with three cards:
//   1. Patient — compact action-needed monitoring/QOF summary for the patient
//      open in the Medicus tab ("book the overdue bloods while they're on the
//      phone"), reusing the Sentinel snapshot.
//   2. Recent appointments — who the patient saw recently, found by scanning
//      the practice appointment book backwards (manual trigger, UUID-matched
//      only — never name-matched, wrong-patient hazard H-001).
//   3. Guided capture — fixed question sets per presenting problem
//      (rules/reception-pathways.json): red flags first with escalation
//      prompts, then history questions, producing a structured plain-text
//      block to copy-paste into the Medicus triage entry. Capture only — the
//      tool never triages, diagnoses, or advises beyond red-flag escalation.
//
// No chrome.storage keys: taker initials and results are in-memory only.

'use strict';

import {
  summariseActionChips,
  evaluateRedFlags,
  buildCaptureText,
  extractPatientAppointments,
  pharmacyFirstHint,
} from './reception-core.js';
import { fetchSchedulingOverview, todayISO, addDays } from '../../../shared/medicus-api.js';

const CONTACT_SCAN_DAYS  = 42;  // how far back the appointment scan looks
const CONTACT_SCAN_BATCH = 7;   // days fetched per batch (early-stops at 3 hits)
const CONTACT_SHOW_MAX   = 5;

let container = null;
let _doc = null;              // reception-pathways.json document
let _snapshot = null;         // last Sentinel snapshot (or null)
let _takerInitials = '';      // in-memory only, per panel session
let _activePathway = null;    // pathway object while capturing
let _contactsCache = new Map(); // patientUuid → rows
let _scanAbort = false;
let _onActivated = null;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _scanAbort = false;

  container.innerHTML = `
    <div class="rcp-module">
      <div class="rcp-head">
        <h2 class="rcp-title">Reception</h2>
        <span class="rcp-subtitle">Capture a structured history — a clinician always reviews and decides.</span>
      </div>
      <div class="rcp-card" id="rcpPatientCard"><div class="rcp-card-title">Patient</div><div class="rcp-card-body rcp-muted">Looking for an open patient record…</div></div>
      <div class="rcp-card" id="rcpContactsCard"><div class="rcp-card-title">Recent appointments</div><div class="rcp-card-body rcp-muted">Open a patient record to search.</div></div>
      <div class="rcp-card" id="rcpCaptureCard"><div class="rcp-card-title">Guided capture</div><div class="rcp-card-body" id="rcpCaptureBody"></div></div>
    </div>`;

  try {
    const r = await fetch(chrome.runtime.getURL('rules/reception-pathways.json'));
    _doc = await r.json();
  } catch (e) {
    const body = container.querySelector('#rcpCaptureBody');
    if (body) body.innerHTML = `<div class="rcp-error">Could not load capture pathways: ${esc(e.message)}</div>`;
    _doc = null;
  }

  renderPathwayPicker();
  refreshPatientCard();

  _onActivated = () => refreshPatientCard();
  chrome.tabs.onActivated.addListener(_onActivated);

  return cleanup;
}

function cleanup() {
  _scanAbort = true;
  if (_onActivated) { chrome.tabs.onActivated.removeListener(_onActivated); _onActivated = null; }
  _activePathway = null;
  _snapshot = null;
  container = null;
}

export { cleanup };

// ── Card 1: patient + monitoring/QOF opportunities ────────────────────────────

async function fetchSnapshot() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab?.url || !/medicus\.health/.test(tab.url)) return null;
  const mountCheck = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!window.__sentinelMounted });
  if (!mountCheck?.[0]?.result) return null;
  const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
  if (!snapshot || snapshot.unavailable || !snapshot.chips) return null;
  return snapshot;
}

async function refreshPatientCard() {
  if (!container) return;
  const card = container.querySelector('#rcpPatientCard .rcp-card-body');
  if (!card) return;
  try {
    _snapshot = await fetchSnapshot();
  } catch (_) {
    _snapshot = null;
  }
  if (!container) return; // cleaned up mid-fetch

  if (!_snapshot) {
    card.innerHTML = `<span class="rcp-muted">No patient record open in the active Medicus tab.</span>
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>`;
    card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
    renderContactsCard();
    return;
  }

  const pc = _snapshot.patientContext || {};
  const sum = summariseActionChips(_snapshot.chips);
  // Fail-visible: a degraded extraction means the counts may be missing data.
  const degradedNote = _snapshot.degraded
    ? `<div class="rcp-error">Record extraction incomplete — these counts may be missing data.</div>` : '';
  const who = [pc.patientName, pc.ageYears != null ? `${pc.ageYears}y` : null].filter(Boolean).join(', ');

  let oppHtml;
  if (sum.red + sum.amber === 0) {
    oppHtml = `<div class="rcp-opp rcp-opp-clear">No action-needed monitoring or QOF alerts in the current data. <span class="rcp-fineprint">No alert ≠ everything is up to date.</span></div>`;
  } else {
    const counts = [
      sum.red ? `<span class="rcp-count rcp-count-red">${sum.red} overdue/alert</span>` : '',
      sum.amber ? `<span class="rcp-count rcp-count-amber">${sum.amber} due soon</span>` : ''
    ].filter(Boolean).join(' ');
    const items = sum.items.slice(0, 6).map(i =>
      `<span class="rcp-chip rcp-chip-${i.colour}">${esc(i.name)} <em>${esc(i.statusLabel)}</em></span>`).join('');
    const more = sum.items.length > 6 ? `<span class="rcp-fineprint">+${sum.items.length - 6} more in Monitoring</span>` : '';
    oppHtml = `
      <div class="rcp-opp">
        <div class="rcp-opp-line">While they're on the phone: ${counts}</div>
        <div class="rcp-opp-chips">${items}${more}</div>
      </div>`;
  }

  card.innerHTML = `
    <div class="rcp-patient-line"><strong>${esc(who || 'Patient')}</strong>${pc.nhsNumber ? ` <span class="rcp-fineprint">NHS ${esc(pc.nhsNumber)}</span>` : ''}
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>
    </div>
    ${degradedNote}${oppHtml}
    <button class="rcp-link-btn" id="rcpGotoSentinel">Open Monitoring →</button>`;
  card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
  card.querySelector('#rcpGotoSentinel')?.addEventListener('click', () => {
    document.querySelector('.nav-tab[data-module="sentinel"]')?.click();
  });
  renderContactsCard();
}

// ── Card 2: recent appointments ───────────────────────────────────────────────

function renderContactsCard() {
  if (!container) return;
  const body = container.querySelector('#rcpContactsCard .rcp-card-body');
  if (!body) return;
  const uuid = _snapshot?.patientContext?.patientUuid || null;
  if (!uuid) {
    body.innerHTML = `<span class="rcp-muted">Open a patient record to search their recent appointments.</span>`;
    return;
  }
  if (_contactsCache.has(uuid)) {
    body.innerHTML = contactsHtml(_contactsCache.get(uuid));
    wireContactsRescan(body, uuid);
    return;
  }
  body.innerHTML = `<button class="rcp-btn" id="rcpFindContacts">Find recent appointments (last ${CONTACT_SCAN_DAYS / 7} weeks)</button>
    <div class="rcp-fineprint">Scans the practice appointment book day by day — takes a few seconds.</div>`;
  body.querySelector('#rcpFindContacts')?.addEventListener('click', () => scanContacts(uuid));
}

async function scanContacts(uuid) {
  const body = container?.querySelector('#rcpContactsCard .rcp-card-body');
  if (!body) return;
  let code = null;
  try {
    const res = await window.PracticeCode.resolve();
    code = res.code;
  } catch (_) {}
  if (!code) {
    body.innerHTML = `<div class="rcp-error">No practice code — open a Medicus tab or set it in Options.</div>`;
    return;
  }

  const rows = [];
  let failedDays = 0;
  const today = todayISO();
  const dates = [];
  for (let i = 0; i <= CONTACT_SCAN_DAYS; i++) dates.push(addDays(today, -i));

  for (let b = 0; b < dates.length && !_scanAbort; b += CONTACT_SCAN_BATCH) {
    const batch = dates.slice(b, b + CONTACT_SCAN_BATCH);
    body.innerHTML = `<div class="rcp-muted">Searching… ${Math.min(b + CONTACT_SCAN_BATCH, dates.length)}/${dates.length} days checked, ${rows.length} found.</div>`;
    const results = await Promise.all(batch.map(d =>
      fetchSchedulingOverview(code, d).then(raw => ({ d, raw })).catch(() => ({ d, raw: null }))
    ));
    for (const { d, raw } of results) {
      if (!raw) { failedDays++; continue; }
      for (const appt of extractPatientAppointments(raw, uuid)) {
        if (String(appt.status).toLowerCase() === 'cancelled') continue;
        rows.push({ ...appt, dateISO: d });
      }
    }
    if (rows.length >= 3) break;
  }
  if (!container) return;

  rows.sort((a, b) => {
    const ka = a.startDateTime || a.dateISO || '';
    const kb = b.startDateTime || b.dateISO || '';
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  const result = { rows: rows.slice(0, CONTACT_SHOW_MAX), failedDays };
  _contactsCache.set(uuid, result);
  const bodyNow = container.querySelector('#rcpContactsCard .rcp-card-body');
  if (bodyNow) {
    bodyNow.innerHTML = contactsHtml(result);
    wireContactsRescan(bodyNow, uuid);
  }
}

function contactsHtml({ rows, failedDays }) {
  const failNote = failedDays > 0
    ? `<div class="rcp-error">${failedDays} day(s) could not be read — this list may be incomplete.</div>` : '';
  if (rows.length === 0) {
    return `${failNote}<span class="rcp-muted">No booked appointments found in the last ${CONTACT_SCAN_DAYS / 7} weeks.</span>
      <div class="rcp-fineprint">Booked appointments only — telephone or ad-hoc contacts may not appear.</div>
      <button class="rcp-link-btn rcp-rescan">Search again</button>`;
  }
  const items = rows.map(r => {
    const when = r.startDateTime ? r.startDateTime.slice(0, 10) : r.dateISO;
    return `<div class="rcp-contact-row">
      <span class="rcp-contact-date">${esc(when)}</span>
      <span class="rcp-contact-clin">${esc(r.clinician)}</span>
      <span class="rcp-contact-type">${esc(r.type)}${r.status ? ` · ${esc(r.status)}` : ''}</span>
    </div>`;
  }).join('');
  return `${failNote}${items}
    <div class="rcp-fineprint">Booked appointments at this practice only (last ${CONTACT_SCAN_DAYS / 7} weeks) — telephone or ad-hoc contacts may not appear.</div>
    <button class="rcp-link-btn rcp-rescan">Search again</button>`;
}

function wireContactsRescan(body, uuid) {
  body.querySelector('.rcp-rescan')?.addEventListener('click', () => {
    _contactsCache.delete(uuid);
    scanContacts(uuid);
  });
}

// ── Card 3: guided capture ────────────────────────────────────────────────────

function renderPathwayPicker() {
  if (!container || !_doc) return;
  const body = container.querySelector('#rcpCaptureBody');
  if (!body) return;
  _activePathway = null;

  const btns = (_doc.pathways || []).map(p =>
    `<button class="rcp-pathway-btn" data-pathway="${esc(p.id)}">
       <span class="rcp-pathway-title">${esc(p.title)}</span>
       <span class="rcp-pathway-applies">${esc(p.appliesTo || '')}</span>
     </button>`).join('');

  body.innerHTML = `
    <div class="rcp-picker-note">Pick the problem that best matches what the caller describes. Red-flag questions come first — any YES means escalate straight away.</div>
    <div class="rcp-pathway-grid">${btns}</div>`;

  body.querySelectorAll('.rcp-pathway-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = (_doc.pathways || []).find(x => x.id === btn.dataset.pathway);
      if (p) renderCaptureForm(p);
    });
  });
}

function inputHtml(scope, q) {
  const nm = `${scope}-${q.id}`;
  if (q.type === 'yesno') {
    return `<span class="rcp-yn">
      <label><input type="radio" name="${esc(nm)}" value="Yes"> Yes</label>
      <label><input type="radio" name="${esc(nm)}" value="No"> No</label>
    </span>`;
  }
  if (q.type === 'choice') {
    const opts = (q.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<select name="${esc(nm)}"><option value="">—</option>${opts}</select>`;
  }
  if (q.type === 'multi') {
    return `<span class="rcp-multi">` + (q.options || []).map(o =>
      `<label><input type="checkbox" name="${esc(nm)}" value="${esc(o)}"> ${esc(o)}</label>`).join('') + `</span>`;
  }
  return `<input type="text" name="${esc(nm)}" autocomplete="off">`;
}

function renderCaptureForm(pathway) {
  const body = container?.querySelector('#rcpCaptureBody');
  if (!body || !_doc) return;
  _activePathway = pathway;

  const rfRows = (pathway.redFlags || []).map(rf => `
    <div class="rcp-rf-row" data-rf="${esc(rf.id)}">
      <span class="rcp-rf-ask">${esc(rf.ask)}</span>
      <span class="rcp-yn">
        <label><input type="radio" name="rf-${esc(rf.id)}" value="yes"> Yes</label>
        <label><input type="radio" name="rf-${esc(rf.id)}" value="no"> No</label>
      </span>
    </div>`).join('');

  const qRows = (pathway.questions || []).map(q => `
    <div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml('q', q)}</div>`).join('');
  const cRows = (_doc.closingQuestions || []).map(q => `
    <div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml('c', q)}</div>`).join('');

  body.innerHTML = `
    <form class="rcp-form" id="rcpForm">
      <div class="rcp-form-head">
        <button type="button" class="rcp-link-btn" id="rcpBack">← All pathways</button>
        <span class="rcp-form-title">${esc(pathway.title)}</span>
        <label class="rcp-initials">Your initials <input type="text" id="rcpInitials" maxlength="5" value="${esc(_takerInitials)}"></label>
      </div>

      <div class="rcp-banner rcp-banner-hidden" id="rcpEscBanner"></div>

      <div class="rcp-section rcp-section-rf">
        <div class="rcp-section-title">1 · Red flags — ask every one</div>
        ${rfRows}
      </div>

      <div class="rcp-section">
        <div class="rcp-section-title">2 · About the problem</div>
        <div class="rcp-q-row"><label class="rcp-q-ask">In the patient's own words, what's the problem?</label>
          <textarea name="ownWords" rows="2"></textarea></div>
        ${qRows}
      </div>

      <div class="rcp-section">
        <div class="rcp-section-title">3 · Wrapping up</div>
        ${cRows}
      </div>

      <div class="rcp-form-actions">
        <button type="submit" class="rcp-btn rcp-btn-primary">Generate summary</button>
        <span class="rcp-form-msg" id="rcpFormMsg"></span>
      </div>
    </form>`;

  body.querySelector('#rcpBack')?.addEventListener('click', renderPathwayPicker);
  body.querySelector('#rcpInitials')?.addEventListener('input', e => { _takerInitials = e.target.value.trim(); });

  // Escalation banner reacts the moment any red flag is answered YES.
  const form = body.querySelector('#rcpForm');
  form.addEventListener('change', () => updateEscalationBanner(form, pathway));
  form.addEventListener('submit', e => {
    e.preventDefault();
    generateSummary(form, pathway);
  });
}

function readRedFlagAnswers(form, pathway) {
  const answers = {};
  for (const rf of (pathway.redFlags || [])) {
    const v = form.querySelector(`input[name="rf-${CSS.escape(rf.id)}"]:checked`)?.value;
    if (v === 'yes' || v === 'no') answers[rf.id] = v;
  }
  return answers;
}

function updateEscalationBanner(form, pathway) {
  const banner = form.querySelector('#rcpEscBanner');
  if (!banner) return;
  const { positives } = evaluateRedFlags(pathway.redFlags, readRedFlagAnswers(form, pathway));
  if (positives.length === 0) {
    banner.className = 'rcp-banner rcp-banner-hidden';
    banner.textContent = '';
    return;
  }
  // 999-level escalation wins over duty-level when both are present.
  const level = positives.some(p => p.escalate === '999') ? '999' : 'duty';
  banner.className = `rcp-banner rcp-banner-${level === '999' ? 'red' : 'amber'}`;
  banner.textContent = `RED FLAG — ${(_doc.escalations && _doc.escalations[level]) || 'Escalate to the duty clinician now.'}`;
}

function readQuestionAnswers(form, scope, questions) {
  const out = {};
  for (const q of (questions || [])) {
    const nm = `${scope}-${q.id}`;
    if (q.type === 'multi') {
      const vals = Array.from(form.querySelectorAll(`input[name="${CSS.escape(nm)}"]:checked`)).map(i => i.value);
      out[q.id] = vals;
    } else {
      const el = form.querySelector(`[name="${CSS.escape(nm)}"]${q.type === 'yesno' ? ':checked' : ''}`);
      out[q.id] = el ? el.value : '';
    }
  }
  return out;
}

function generateSummary(form, pathway) {
  const msg = form.querySelector('#rcpFormMsg');
  const rfAnswers = readRedFlagAnswers(form, pathway);
  const { unanswered } = evaluateRedFlags(pathway.redFlags, rfAnswers);

  form.querySelectorAll('.rcp-rf-row').forEach(row => {
    row.classList.toggle('rcp-rf-missing', unanswered.includes(row.dataset.rf));
  });
  if (unanswered.length > 0) {
    if (msg) msg.textContent = `Answer every red-flag question first (${unanswered.length} unanswered).`;
    form.querySelector('.rcp-rf-missing')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (msg) msg.textContent = '';

  const pc = _snapshot?.patientContext || null;
  const patientLine = pc?.patientName
    ? [pc.patientName, pc.dateOfBirth ? `DOB ${pc.dateOfBirth}` : null, pc.nhsNumber ? `NHS ${pc.nhsNumber}` : null].filter(Boolean).join(', ')
    : null;

  const text = buildCaptureText({
    pathway,
    closingQuestions: _doc.closingQuestions || [],
    escalations: _doc.escalations || {},
    ownWords: (form.querySelector('[name="ownWords"]')?.value || '').trim(),
    redFlagAnswers: rfAnswers,
    questionAnswers: readQuestionAnswers(form, 'q', pathway.questions),
    closingAnswers: readQuestionAnswers(form, 'c', _doc.closingQuestions),
    meta: {
      takerInitials: _takerInitials,
      nowIso: new Date().toISOString(),
      suiteVersion: chrome.runtime.getManifest?.().version || '',
      patientLine,
      pharmacyFirstHint: pharmacyFirstHint(pathway, pc?.ageYears ?? null),
    },
  });

  renderOutput(text, pathway);
}

function renderOutput(text, pathway) {
  const body = container?.querySelector('#rcpCaptureBody');
  if (!body) return;
  body.innerHTML = `
    <div class="rcp-output">
      <div class="rcp-output-head">
        <span class="rcp-form-title">${esc(pathway.title)} — summary</span>
      </div>
      <textarea class="rcp-output-text" id="rcpOutputText" readonly rows="16"></textarea>
      <div class="rcp-form-actions">
        <button class="rcp-btn rcp-btn-primary" id="rcpCopy">Copy to clipboard</button>
        <button class="rcp-btn" id="rcpNewCapture">New capture</button>
        <span class="rcp-form-msg" id="rcpCopyMsg"></span>
      </div>
      <div class="rcp-fineprint">Paste into the Medicus triage entry / task for this patient. Double-check you're on the right patient before pasting.</div>
    </div>`;
  const ta = body.querySelector('#rcpOutputText');
  ta.value = text;
  body.querySelector('#rcpCopy')?.addEventListener('click', async () => {
    const m = body.querySelector('#rcpCopyMsg');
    try {
      await navigator.clipboard.writeText(ta.value);
      if (m) m.textContent = 'Copied.';
    } catch (_) {
      ta.focus(); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      if (m) m.textContent = ok ? 'Copied.' : 'Copy failed — select the text and copy manually.';
    }
  });
  body.querySelector('#rcpNewCapture')?.addEventListener('click', renderPathwayPicker);
}
