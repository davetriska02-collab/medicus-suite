// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Patient Alerts side panel module
//
// Per-patient customisable alerts (interpreter required, safeguarding concern,
// medication-seeking behaviour, …) that surface whenever that patient's record
// is open in Medicus. This module is the management surface: add/edit/remove
// alerts for the patient currently open, browse every flagged patient, and
// customise the quick-add alert-type palette.
//
// Identity comes from the Sentinel snapshot bridge (getSentinelSnapshot), the
// same source the Monitoring tab uses — the panel auto-follows whichever
// patient is open. WRONG-PATIENT SAFETY: alerts are looked up from the live
// snapshot's patient identity at every render (see patient-alerts-core.js);
// when no patient is identified, nothing is shown and nothing can be added.
//
// Display surfaces elsewhere: the global #paStrip in panel.js and the alert
// chips in the Monitoring tab's patient banner — both read-only views over the
// same 'patientAlerts.byPatient' store this module owns.

'use strict';

import {
  DEFAULT_ALERT_TYPES,
  SEVERITIES,
  findEntryForPatient,
  generateTypeId,
  makeAlert,
  patientKey,
  removeAlert,
  removePatient,
  sanitiseTypes,
  searchStore,
  sortAlerts,
  upsertAlert,
} from './patient-alerts-core.js';

const STORE_KEY = 'patientAlerts.byPatient';
const TYPES_KEY = 'patientAlerts.types';
const POLL_MS = 10 * 1000;

let container = null;
let _store = {};
let _types = [];
let _typesCustomised = false; // true when storage held a palette (vs shipped defaults)
let _pc = null; // patientContext from the last good snapshot, or null
let _query = '';
let _formOpen = false;
let _editingAlertId = null; // alert id being edited in the form, or null
let _storageListener = null;
let _messageListener = null;
let _tabsActivatedListener = null;
let _pollTimer = null;
let _snapshotDebounce = null;
let _ignoreNextChange = false;

const SEVERITY_LABEL = { red: 'RED', amber: 'AMBER', info: 'INFO' };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNhs(n) {
  const d = String(n || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(n || '');
}

// ── Init / cleanup ──────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _query = '';
  _formOpen = false;
  _editingAlertId = null;

  container.innerHTML = `
    <div class="pa-module">
      <div class="pa-head">
        <h2 class="pa-title">Patient Alerts</h2>
        <span class="pa-subtitle">Your practice's own per-patient flags — shown here and on the Monitoring banner whenever that patient is open in Medicus.</span>
      </div>
      <div id="paCurrent"></div>
      <div id="paBrowse"></div>
      <div id="paPalette"></div>
      <div class="pa-foot">Stored in this browser profile (share via Options &rarr; Backup). Not written to the clinical record — code anything clinically significant in Medicus as usual. Patients can request to see these flags; keep wording professional and factual.</div>
    </div>`;

  await loadState();
  render();
  refreshSnapshot();

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);
  container.addEventListener('change', onChange);

  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORE_KEY] && !changes[TYPES_KEY] && !changes['suite.letterhead']) return;
    if (_ignoreNextChange) {
      _ignoreNextChange = false;
      return;
    }
    loadState().then(() => {
      if (container) render();
    });
  };
  chrome.storage.onChanged.addListener(_storageListener);

  // Re-resolve the current patient the moment the content script publishes a
  // new snapshot (debounced — the ping fires repeatedly on SPA churn).
  _messageListener = (msg, sender) => {
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (msg?.type === 'sentinel:snapshot-updated') scheduleSnapshotRefresh();
  };
  chrome.runtime.onMessage.addListener(_messageListener);

  _tabsActivatedListener = () => scheduleSnapshotRefresh();
  chrome.tabs.onActivated.addListener(_tabsActivatedListener);

  _pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshSnapshot();
  }, POLL_MS);

  return cleanup;
}

function cleanup() {
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  if (_messageListener) {
    chrome.runtime.onMessage.removeListener(_messageListener);
    _messageListener = null;
  }
  if (_tabsActivatedListener) {
    chrome.tabs.onActivated.removeListener(_tabsActivatedListener);
    _tabsActivatedListener = null;
  }
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_snapshotDebounce) {
    clearTimeout(_snapshotDebounce);
    _snapshotDebounce = null;
  }
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('input', onInput);
    container.removeEventListener('change', onChange);
  }
  container = null;
}

export { cleanup };

// ── State ───────────────────────────────────────────────────────────────────

async function loadState() {
  const r = await chrome.storage.local.get([STORE_KEY, TYPES_KEY, 'suite.letterhead']);
  _store = r[STORE_KEY] && typeof r[STORE_KEY] === 'object' ? r[STORE_KEY] : {};
  _typesCustomised = Array.isArray(r[TYPES_KEY]);
  _types = sanitiseTypes(r[TYPES_KEY]);
  // Author attribution (H-042 audit trail): the acting user's name from the
  // practice letterhead config — the same identity source the action-pack
  // letters sign with. Null when unset; flags then record no author rather
  // than a guessed one.
  const lh = r['suite.letterhead'];
  _author = lh && typeof lh.clinicianName === 'string' && lh.clinicianName.trim() ? lh.clinicianName.trim() : null;
}

let _author = null;

// Record a flag mutation in the machine-local Event Ledger (H-042 audit
// trail). Fire-and-forget: the ledger swallows its own failures and this
// helper must never block or break the save path. `label` carries the PRESET
// type id (or 'custom') + severity — NEVER the free-typed alert text (the
// ledger's no-free-text rule); the author rides on the stored alert itself.
function recordFlagEvent(action, patientUuid, alert) {
  try {
    const EL = typeof window !== 'undefined' ? window.EventLedger : null;
    if (!EL) return;
    EL.record({
      source: 'patient-alerts',
      patientRef: patientUuid || null,
      severity: (alert && alert.severity) || null,
      ruleId: (alert && alert.id) || null,
      label: `${(alert && alert.typeId) || 'custom'} (${(alert && alert.severity) || '?'})`,
      action,
    });
  } catch (_) {
    /* never let audit logging break the mutation itself */
  }
}

async function persistStore() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ [STORE_KEY]: _store });
}

async function persistTypes() {
  _ignoreNextChange = true;
  _typesCustomised = true;
  await chrome.storage.local.set({ [TYPES_KEY]: _types });
}

// ── Current-patient identity (Sentinel snapshot bridge) ─────────────────────

function scheduleSnapshotRefresh() {
  if (_snapshotDebounce) return;
  _snapshotDebounce = setTimeout(() => {
    _snapshotDebounce = null;
    refreshSnapshot();
  }, 400);
}

async function findMedicusTab() {
  // Prefer the active tab; fall back to any open Medicus tab (covers pop-out).
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active[0]?.url && /medicus\.health/.test(active[0].url)) return active[0];
  const any = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
  return any[0] || null;
}

async function refreshSnapshot() {
  let pc = null;
  try {
    const tab = await findMedicusTab();
    if (tab?.id) {
      const snap = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
      if (snap && !snap.unavailable && snap.patientContext) pc = snap.patientContext;
    }
  } catch (_) {
    // No Medicus tab / content script not mounted — pc stays null and the
    // current-patient card renders its idle state (never a stale patient).
  }
  const prevKey = patientKey(_pc) || (_pc && _pc.nhsNumber) || null;
  const nextKey = patientKey(pc) || (pc && pc.nhsNumber) || null;
  const changed = prevKey !== nextKey || !!_pc !== !!pc;
  _pc = pc;
  if (changed && container) {
    // A patient change invalidates any half-typed form for the previous patient.
    _formOpen = false;
    _editingAlertId = null;
    renderCurrent();
  } else if (container) {
    renderCurrent();
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render() {
  renderCurrent();
  renderBrowse();
  renderPalette();
}

function severityChip(alert) {
  // Attribution in the tooltip (H-042): who recorded the flag and when, plus
  // the last editor when it has been changed since.
  const added = alert.createdAt
    ? `Added ${String(alert.createdAt).slice(0, 10)}${alert.createdBy ? ` by ${alert.createdBy}` : ''}`
    : '';
  const edited =
    alert.updatedAt && alert.updatedAt !== alert.createdAt
      ? `Updated ${String(alert.updatedAt).slice(0, 10)}${alert.updatedBy ? ` by ${alert.updatedBy}` : ''}`
      : '';
  const title = [alert.note, added, edited].filter(Boolean).join(' — ');
  return `<span class="pa-chip pa-chip--${esc(alert.severity)}" title="${esc(title)}">${esc(alert.label)}</span>`;
}

function renderCurrent() {
  const host = container?.querySelector('#paCurrent');
  if (!host) return;

  if (!_pc) {
    host.innerHTML = `
      <div class="pa-card pa-card-idle">
        <div class="pa-card-label">Current patient</div>
        <p class="pa-idle-text">No patient identified — open a patient record in Medicus and their alerts appear here automatically.</p>
      </div>`;
    return;
  }

  const key = patientKey(_pc);
  const found = findEntryForPatient(_store, _pc);
  const alerts = found ? sortAlerts(found.entry.alerts) : [];
  const name = _pc.displayName || _pc.patientName || _pc.name || 'Unnamed patient';
  const meta = [
    _pc.nhsNumber ? `NHS ${fmtNhs(_pc.nhsNumber)}` : '',
    _pc.dateOfBirth || _pc.dobRaw ? `DOB ${esc(_pc.dateOfBirth || _pc.dobRaw)}` : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  const alertsHtml = alerts.length
    ? `<div class="pa-chip-row">${alerts
        .map(
          (a) => `
        <span class="pa-chip-group">
          ${severityChip(a)}
          <button class="pa-chip-act" data-act="alert-edit" data-id="${esc(a.id)}" title="Edit this alert">&#x270E;</button>
          <button class="pa-chip-act" data-act="alert-del" data-key="${esc(found.key)}" data-id="${esc(a.id)}" title="Remove this alert">&#x2715;</button>
        </span>`
        )
        .join('')}</div>
      ${
        alerts.some((a) => a.note)
          ? `<ul class="pa-note-list">${alerts
              .filter((a) => a.note)
              .map((a) => `<li><strong>${esc(a.label)}:</strong> ${esc(a.note)}</li>`)
              .join('')}</ul>`
          : ''
      }`
    : `<p class="pa-none">No alerts recorded for this patient.</p>`;

  // Adding needs a resolvable UUID — the stable storage key. NHS-only views can
  // still DISPLAY alerts (matched by NHS number) but not create them.
  const addHtml = _formOpen
    ? formHtml(alerts)
    : key
      ? `<button class="pa-btn pa-btn-primary" data-act="add-open">+ Add alert</button>`
      : `<p class="pa-hint">This view doesn't expose a stable patient ID — open the patient's full record to add an alert.</p>`;

  host.innerHTML = `
    <div class="pa-card pa-card-current">
      <div class="pa-card-label">Current patient</div>
      <div class="pa-patient-name">${esc(name)}</div>
      ${meta ? `<div class="pa-patient-meta">${meta}</div>` : ''}
      ${alertsHtml}
      ${addHtml}
    </div>`;
}

function formHtml(existingAlerts) {
  const editing = _editingAlertId ? existingAlerts.find((a) => a.id === _editingAlertId) : null;
  const presetOptions = _types
    .map((t) => `<option value="${esc(t.id)}" title="${esc(t.description || '')}">${esc(t.label)}</option>`)
    .join('');
  const sevOptions = SEVERITIES.map(
    (s) =>
      `<option value="${s}" ${(editing ? editing.severity : 'amber') === s ? 'selected' : ''}>${SEVERITY_LABEL[s]}</option>`
  ).join('');
  return `
    <div class="pa-form">
      ${
        editing
          ? `<div class="pa-form-title">Edit alert</div>`
          : `<label class="pa-field"><span>Quick add</span>
        <select id="paPreset"><option value="">Choose a preset&hellip;</option>${presetOptions}</select>
      </label>`
      }
      <label class="pa-field"><span>Alert text</span>
        <input type="text" id="paLabel" maxlength="120" placeholder="e.g. Interpreter required — Polish" value="${esc(editing ? editing.label : '')}" />
      </label>
      <label class="pa-field"><span>Severity</span>
        <select id="paSeverity">${sevOptions}</select>
      </label>
      <label class="pa-field"><span>Note (optional)</span>
        <input type="text" id="paNote" maxlength="500" placeholder="Context another practice user should know" value="${esc(editing ? editing.note : '')}" />
      </label>
      <div class="pa-form-actions">
        <button class="pa-btn pa-btn-primary" data-act="form-save">${editing ? 'Save changes' : 'Add alert'}</button>
        <button class="pa-btn" data-act="form-cancel">Cancel</button>
        <span class="pa-form-err" id="paFormErr"></span>
      </div>
    </div>`;
}

function renderBrowse() {
  const host = container?.querySelector('#paBrowse');
  if (!host) return;
  const results = searchStore(_store, _query);
  const rows = results
    .map(({ key, entry }) => {
      const p = entry.patient || {};
      return `
      <div class="pa-row">
        <div class="pa-row-head">
          <span class="pa-row-name">${esc(p.name || 'Unnamed patient')}</span>
          <span class="pa-row-meta">${p.nhsNumber ? `NHS ${esc(fmtNhs(p.nhsNumber))}` : ''}${p.dob ? ` &middot; DOB ${esc(p.dob)}` : ''}</span>
          <button class="pa-row-del" data-act="pat-del" data-key="${esc(key)}" title="Remove this patient and all their alerts">Remove</button>
        </div>
        <div class="pa-chip-row">${entry.alerts.map((a) => severityChip(a)).join('')}</div>
      </div>`;
    })
    .join('');
  host.innerHTML = `
    <div class="pa-card">
      <div class="pa-card-label">All flagged patients (${results.length})</div>
      <input type="search" id="paSearch" class="pa-search" placeholder="Search by name, NHS number or alert&hellip;" value="${esc(_query)}" />
      ${rows || `<p class="pa-none">${_query ? 'No matches.' : 'No patients flagged yet. Open a patient and add the first alert above.'}</p>`}
    </div>`;
}

function renderPalette() {
  const host = container?.querySelector('#paPalette');
  if (!host) return;
  const rows = _types
    .map(
      (t, i) => `
    <div class="pa-type-row" data-idx="${i}">
      <input type="text" class="pa-type-label" data-act="type-label" data-idx="${i}" maxlength="120" value="${esc(t.label)}" />
      <select class="pa-type-sev" data-act="type-sev" data-idx="${i}">
        ${SEVERITIES.map((s) => `<option value="${s}" ${t.severity === s ? 'selected' : ''}>${SEVERITY_LABEL[s]}</option>`).join('')}
      </select>
      <button class="pa-row-del" data-act="type-del" data-idx="${i}" title="Delete this preset">&#x2715;</button>
    </div>`
    )
    .join('');
  host.innerHTML = `
    <details class="pa-card pa-palette">
      <summary class="pa-card-label pa-palette-summary">Alert presets (${_types.length})${_typesCustomised ? '' : ' — defaults'}</summary>
      <p class="pa-hint">Quick-add presets offered on the alert form. Fully customisable — edit, delete, or add anything your practice needs. Presets only seed new alerts; editing one never changes alerts already recorded.</p>
      ${rows}
      <button class="pa-btn" data-act="type-add">+ Add preset</button>
    </details>`;
}

// ── Event handling ──────────────────────────────────────────────────────────

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'add-open') {
    _formOpen = true;
    _editingAlertId = null;
    renderCurrent();
    container.querySelector('#paLabel')?.focus();
  } else if (act === 'form-cancel') {
    _formOpen = false;
    _editingAlertId = null;
    renderCurrent();
  } else if (act === 'form-save') {
    saveForm();
  } else if (act === 'alert-edit') {
    _formOpen = true;
    _editingAlertId = btn.dataset.id;
    renderCurrent();
    container.querySelector('#paLabel')?.focus();
  } else if (act === 'alert-del') {
    if (!confirm('Remove this alert?')) return;
    const key = btn.dataset.key;
    const removed = (_store[key]?.alerts || []).find((a) => a.id === btn.dataset.id) || null;
    _store = removeAlert(_store, key, btn.dataset.id, new Date().toISOString());
    recordFlagEvent('flag-removed', key, removed);
    persistStore().then(() => render());
  } else if (act === 'pat-del') {
    const key = btn.dataset.key;
    const entry = _store[key];
    const n = entry?.patient?.name || 'this patient';
    if (!confirm(`Remove ${n} and all their alerts?`)) return;
    // One ledger event per removed flag — a whole-patient wipe must not be
    // less audited than removing the same flags one by one.
    (entry?.alerts || []).forEach((a) => recordFlagEvent('flag-removed', key, a));
    _store = removePatient(_store, key);
    persistStore().then(() => render());
  } else if (act === 'type-add') {
    _types = [..._types, { id: generateTypeId('new'), label: 'New alert type', severity: 'amber', description: '' }];
    persistTypes().then(() => renderPalette());
  } else if (act === 'type-del') {
    const idx = Number(btn.dataset.idx);
    if (!confirm(`Delete the "${_types[idx]?.label || ''}" preset? Alerts already recorded with it are unaffected.`))
      return;
    _types = _types.filter((_, i) => i !== idx);
    persistTypes().then(() => renderPalette());
  }
}

function onInput(e) {
  if (e.target.id === 'paSearch') {
    _query = e.target.value;
    renderBrowse();
    // Re-focus survives because renderBrowse rebuilds the input with the value;
    // restore caret position at end.
    const s = container.querySelector('#paSearch');
    if (s) {
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }
  }
}

function onChange(e) {
  const t = e.target;
  if (t.id === 'paPreset') {
    const preset = _types.find((x) => x.id === t.value);
    if (preset) {
      const label = container.querySelector('#paLabel');
      const sev = container.querySelector('#paSeverity');
      const note = container.querySelector('#paNote');
      if (label && !label.value.trim()) label.value = preset.label;
      else if (label) label.value = preset.label;
      if (sev) sev.value = preset.severity;
      if (note && !note.value.trim() && preset.description) note.placeholder = preset.description;
    }
  } else if (t.dataset.act === 'type-label') {
    const idx = Number(t.dataset.idx);
    if (_types[idx] && t.value.trim()) {
      _types = _types.map((x, i) => (i === idx ? { ...x, label: t.value.trim().slice(0, 120) } : x));
      persistTypes();
    }
  } else if (t.dataset.act === 'type-sev') {
    const idx = Number(t.dataset.idx);
    if (_types[idx] && SEVERITIES.includes(t.value)) {
      _types = _types.map((x, i) => (i === idx ? { ...x, severity: t.value } : x));
      persistTypes();
    }
  }
}

function saveForm() {
  const err = container.querySelector('#paFormErr');
  const label = container.querySelector('#paLabel')?.value || '';
  const severity = container.querySelector('#paSeverity')?.value || 'amber';
  const note = container.querySelector('#paNote')?.value || '';
  const presetId = container.querySelector('#paPreset')?.value || null;

  // Re-check identity at save time — the patient may have changed underneath
  // the open form (wrong-patient safety: never save to a stale identity).
  if (!patientKey(_pc)) {
    if (err) err.textContent = 'Patient changed — reopen the form.';
    return;
  }
  try {
    const nowIso = new Date().toISOString();
    const editing = !!_editingAlertId;
    const alert = makeAlert(
      { label, severity, note, typeId: presetId, author: _author },
      nowIso,
      _editingAlertId || undefined
    );
    _store = upsertAlert(_store, _pc, alert, nowIso);
    recordFlagEvent(editing ? 'flag-edited' : 'flag-added', patientKey(_pc), alert);
    _formOpen = false;
    _editingAlertId = null;
    persistStore().then(() => render());
  } catch (ex) {
    if (err) err.textContent = ex.message;
  }
}
