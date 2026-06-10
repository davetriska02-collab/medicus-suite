// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception module
//
// A reception-facing panel with two cards:
//   1. Patient — a single green/amber/red status pill for the patient open in
//      the Medicus tab; clicking it expands the action-needed monitoring/QOF
//      detail ("book the overdue bloods while they're on the phone"). Which
//      chips surface here is practice-configurable (Options → Reception);
//      filtering is shown, never silent.
//   2. Guided capture — fixed question sets per presenting problem. ALL
//      pathways ship disabled; a practice administrator must accept the
//      disclaimer in Options → Reception to enable them. Practices can edit
//      bundled pathways and author custom ones there. Red flags come first
//      with escalation prompts; output is a structured plain-text block to
//      copy-paste into the Medicus triage entry. Capture only — the tool
//      never triages, diagnoses, or advises beyond red-flag escalation.
//
// Storage (managed in Options, read-only here):
//   reception.config           { enabledPathways, hiddenChipRules, disclaimerAcceptedAt }
//   reception.customPathways   [pathway]
//   reception.pathwayOverrides { id: pathway }

'use strict';

import {
  summariseActionChips,
  evaluateRedFlags,
  buildCaptureText,
  pharmacyFirstHint,
} from './reception-core.js';

let container = null;
let _bundledDoc = null;       // reception-pathways.json document
let _config = {};             // reception.config
let _effective = { all: [], enabled: [] };
let _snapshot = null;         // last Sentinel snapshot (or null)
let _takerInitials = '';      // in-memory only, per panel session
let _pillExpanded = false;
let _onActivated = null;
let _storageListener = null;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;

  container.innerHTML = `
    <div class="rcp-module">
      <div class="rcp-head">
        <h2 class="rcp-title">Reception</h2>
        <span class="rcp-subtitle">Capture a structured history — a clinician always reviews and decides.</span>
      </div>
      <div class="rcp-card" id="rcpPatientCard"><div class="rcp-card-title">Patient</div><div class="rcp-card-body rcp-muted">Looking for an open patient record…</div></div>
      <div class="rcp-card" id="rcpCaptureCard"><div class="rcp-card-title">Guided capture</div><div class="rcp-card-body" id="rcpCaptureBody"></div></div>
    </div>`;

  try {
    const r = await fetch(chrome.runtime.getURL('rules/reception-pathways.json'));
    _bundledDoc = await r.json();
  } catch (e) {
    const body = container?.querySelector('#rcpCaptureBody');
    if (body) body.innerHTML = `<div class="rcp-error">Could not load capture pathways: ${esc(e.message)}</div>`;
    _bundledDoc = null;
  }

  await loadConfigAndResolve();
  renderPathwayPicker();
  refreshPatientCard();

  _onActivated = () => refreshPatientCard();
  chrome.tabs.onActivated.addListener(_onActivated);

  // Live-update when the admin changes reception config/pathways in Options.
  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (changes['reception.config'] || changes['reception.customPathways'] || changes['reception.pathwayOverrides']) {
      loadConfigAndResolve().then(() => {
        if (!container) return;
        renderPathwayPicker();
        refreshPatientCard();
      });
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return cleanup;
}

function cleanup() {
  if (_onActivated) { chrome.tabs.onActivated.removeListener(_onActivated); _onActivated = null; }
  if (_storageListener) { chrome.storage.onChanged.removeListener(_storageListener); _storageListener = null; }
  _snapshot = null;
  container = null;
}

export { cleanup };

async function loadConfigAndResolve() {
  const r = await chrome.storage.local.get(['reception.config', 'reception.customPathways', 'reception.pathwayOverrides']);
  _config = r['reception.config'] || {};
  const PU = (typeof window !== 'undefined') ? window.ReceptionPathwayUtils : null;
  if (PU && _bundledDoc) {
    _effective = PU.resolveEffectivePathways({
      bundled: _bundledDoc.pathways || [],
      overrides: r['reception.pathwayOverrides'] || {},
      customPathways: r['reception.customPathways'] || [],
      enabledPathways: _config.enabledPathways || {},
      disclaimerAccepted: _config.disclaimerAcceptedAt != null,
    });
  } else {
    _effective = { all: [], enabled: [] };
  }
}

// ── Card 1: patient status pill ───────────────────────────────────────────────

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
  renderPatientCard();
}

function renderPatientCard() {
  const card = container?.querySelector('#rcpPatientCard .rcp-card-body');
  if (!card) return;

  if (!_snapshot) {
    card.innerHTML = `<span class="rcp-muted">No patient record open in the active Medicus tab.</span>
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>`;
    card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
    return;
  }

  const pc = _snapshot.patientContext || {};
  const sum = summariseActionChips(_snapshot.chips, _config.hiddenChipRules || {});
  const who = [pc.patientName, pc.ageYears != null ? `${pc.ageYears}y` : null].filter(Boolean).join(', ');

  // Single status pill: red wins over amber, green = nothing to action.
  const level = sum.red > 0 ? 'red' : sum.amber > 0 ? 'amber' : 'green';
  const pillText = level === 'green'
    ? 'Nothing flagged'
    : `${sum.red + sum.amber} to action${sum.red ? ` · ${sum.red} overdue` : ''}`;

  const degradedNote = _snapshot.degraded
    ? `<div class="rcp-error">Record extraction incomplete — this status may be missing data.</div>` : '';
  const filteredNote = sum.hiddenCount > 0
    ? `<div class="rcp-fineprint">${sum.hiddenCount} alert(s) not shown here by practice settings (visible in Monitoring).</div>` : '';

  let detailHtml = '';
  if (_pillExpanded) {
    const rows = sum.items.map(i =>
      `<div class="rcp-detail-row rcp-detail-${i.colour}"><span class="rcp-detail-name">${esc(i.name)}</span><span class="rcp-detail-status">${esc(i.statusLabel)}</span></div>`).join('');
    detailHtml = `
      <div class="rcp-pill-detail">
        ${rows || '<div class="rcp-muted">No action-needed alerts in the current data.</div>'}
        ${filteredNote}
        <div class="rcp-fineprint">No alert ≠ everything is up to date — the Monitoring tab has the full picture.</div>
        <button class="rcp-link-btn" id="rcpGotoSentinel">Open Monitoring →</button>
      </div>`;
  }

  card.innerHTML = `
    <div class="rcp-patient-line"><strong>${esc(who || 'Patient')}</strong>${pc.nhsNumber ? ` <span class="rcp-fineprint">NHS ${esc(pc.nhsNumber)}</span>` : ''}
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>
    </div>
    ${degradedNote}
    <button class="rcp-pill rcp-pill-${level}" id="rcpPill" aria-expanded="${_pillExpanded}">
      <span class="rcp-pill-dot"></span>${esc(pillText)}
      <span class="rcp-pill-caret">${_pillExpanded ? '▴' : '▾'}</span>
    </button>
    ${detailHtml}`;

  card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
  card.querySelector('#rcpPill')?.addEventListener('click', () => {
    _pillExpanded = !_pillExpanded;
    renderPatientCard();
  });
  card.querySelector('#rcpGotoSentinel')?.addEventListener('click', () => {
    document.querySelector('.nav-tab[data-module="sentinel"]')?.click();
  });
}

// ── Card 2: guided capture ────────────────────────────────────────────────────

function renderPathwayPicker() {
  if (!container) return;
  const body = container.querySelector('#rcpCaptureBody');
  if (!body || !_bundledDoc) return;

  const enabled = _effective.enabled;
  if (enabled.length === 0) {
    body.innerHTML = `
      <div class="rcp-disabled-note">
        <strong>Capture pathways are switched off.</strong>
        All pathways ship disabled. A practice administrator can review the
        disclaimer and enable them in Options → Reception.
      </div>
      <button class="rcp-btn" id="rcpOpenOptions">Open options</button>`;
    body.querySelector('#rcpOpenOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  const btns = enabled.map(p =>
    `<button class="rcp-pathway-btn" data-pathway="${esc(p.id)}">
       <span class="rcp-pathway-title">${esc(p.title)}</span>
       <span class="rcp-pathway-applies">${esc(p.appliesTo || '')}</span>
     </button>`).join('');

  body.innerHTML = `
    <div class="rcp-picker-note">Pick the problem that best matches what the caller describes. Red-flag questions come first — any YES means escalate straight away.</div>
    <div class="rcp-pathway-grid">${btns}</div>`;

  body.querySelectorAll('.rcp-pathway-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = enabled.find(x => x.id === btn.dataset.pathway);
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
  if (!body || !_bundledDoc) return;

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
  const cRows = (_bundledDoc.closingQuestions || []).map(q => `
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
  // Fallback includes the level so the receptionist always knows 999-vs-duty even if
  // the escalations map entry is missing (near-unreachable; validation forces level ∈ {999,duty}).
  banner.textContent = `RED FLAG — ${(_bundledDoc.escalations && _bundledDoc.escalations[level]) || `ACTION (level ${level}): Escalate immediately.`}`;
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
    closingQuestions: _bundledDoc.closingQuestions || [],
    escalations: _bundledDoc.escalations || {},
    ownWords: (form.querySelector('[name="ownWords"]')?.value || '').trim(),
    redFlagAnswers: rfAnswers,
    questionAnswers: readQuestionAnswers(form, 'q', pathway.questions),
    closingAnswers: readQuestionAnswers(form, 'c', _bundledDoc.closingQuestions),
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
