// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Results Auto-Filing module
//
// Authors and manages the per-lab "filing profiles" that the injected
// "File all normal" macro (content-scripts/triage-lens/lab-file-button.js) uses
// to file a normal blood result in one click. Because lab layouts differ
// area-to-area, the clinician describes the screen here — by hand, or by building
// a profile from a screenshot via the external-LLM round-trip.
//
// Storage: labfiling.profiles, labfiling.config, labfiling.auditLog
// Pure logic (schema, validation, sanitisation, the LLM prompt) lives in
// shared/lab-filing-utils.js (window.LabFilingUtils, loaded by panel.html /
// pop-out.html). Profiles arrive DISABLED and must be reviewed + the safety
// notice acknowledged before they can file.

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';

let container = null;
let _storageListener = null;
let _ignoreNextChange = false;

let _profiles = [];
let _config = {};
let _audit = [];
let _resultRules = [];

let _editingId = null; // null | 'new' | profile id
let _formSource = null; // 'llm' when the open form was filled from LLM JSON
let _uiTimer = null;

const LF = typeof window !== 'undefined' ? window.LabFilingUtils : null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _editingId = null;
  _formSource = null;

  const savedUi = await loadUiState('labfiling');
  if (savedUi && (savedUi._editingId === 'new' || typeof savedUi._editingId === 'string')) {
    // Don't auto-reopen an edit form across sessions; only remember "new" intent off.
  }

  container.innerHTML = `
    <div class="lf-module">
      <div class="lf-head">
        <h2 class="lf-title">Lab filing</h2>
        <span class="lf-subtitle">One-click filing for results the suite has confirmed are all-normal. You stay in control — review every profile before it can file.</span>
      </div>
      <div id="lfBody"></div>
    </div>`;

  await loadState();
  render();

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);

  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (
      !changes['labfiling.profiles'] &&
      !changes['labfiling.config'] &&
      !changes['labfiling.auditLog'] &&
      !changes['triagelens.config']
    )
      return;
    if (_ignoreNextChange) {
      _ignoreNextChange = false;
      return;
    }
    loadState().then(() => {
      if (container) render();
    });
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return cleanup;
}

function cleanup() {
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  if (_uiTimer) {
    clearTimeout(_uiTimer);
    _uiTimer = null;
  }
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('input', onInput);
  }
  container = null;
}

export { cleanup };

async function loadState() {
  const r = await chrome.storage.local.get([
    'labfiling.profiles',
    'labfiling.config',
    'labfiling.auditLog',
    'triagelens.config',
  ]);
  _profiles = Array.isArray(r['labfiling.profiles']) ? r['labfiling.profiles'] : [];
  _config = r['labfiling.config'] && typeof r['labfiling.config'] === 'object' ? r['labfiling.config'] : {};
  _audit = Array.isArray(r['labfiling.auditLog']) ? r['labfiling.auditLog'] : [];
  const tc = r['triagelens.config'];
  _resultRules = tc && Array.isArray(tc.resultRules) ? tc.resultRules : [];
}

async function persistProfiles() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ 'labfiling.profiles': _profiles });
}
async function persistConfig() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ 'labfiling.config': _config });
}

function noticeAcknowledged() {
  return !!(_config && _config.noticeAcknowledgedAt);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const body = container && container.querySelector('#lfBody');
  if (!body) return;
  if (!LF) {
    body.innerHTML = `<div class="lf-empty">Lab-filing utilities failed to load. Reload the panel.</div>`;
    return;
  }
  body.innerHTML = [renderNotice(), renderToolbar(), _editingId ? renderForm() : '', renderList(), renderAudit()].join(
    ''
  );
}

function renderNotice() {
  if (noticeAcknowledged()) return '';
  return `
    <div class="lf-notice">
      <div class="lf-notice-title">Before you use auto-filing</div>
      <p>This tool files results into Medicus by driving the same controls you would click. <strong>Filing is irreversible from here.</strong> A profile can only file a result when the suite has confirmed <em>every</em> parameter is within normal limits, and you still confirm each one (unless you choose pre-fill-only mode).</p>
      <p>You are responsible for checking each result is genuinely normal and safe to file. Verify each profile against your real filing screen before enabling it.</p>
      <button class="lf-btn lf-btn-primary" data-act="ack-notice">I understand — enable profile controls</button>
    </div>`;
}

function renderToolbar() {
  const n = _profiles.length;
  const enabled = _profiles.filter((p) => p && p.enabled).length;
  return `
    <div class="lf-toolbar">
      <div class="lf-count">${n} profile${n === 1 ? '' : 's'}${n ? ` · ${enabled} enabled` : ''}</div>
      <button class="lf-btn" data-act="add-new">+ Add filing profile</button>
    </div>`;
}

function renderList() {
  if (_editingId) return '';
  if (!_profiles.length) {
    return `<div class="lf-empty">
      <p>No filing profiles yet — so nothing can be auto-filed. A profile is usually set up once by your practice's regular GP, not a locum, and describes how your lab's results screen looks.</p>
      <p>Add one with <strong>+ Add filing profile</strong> (you can build it from a screenshot — no technical knowledge needed). New profiles stay off until reviewed and switched on.</p>
      <p class="lf-help">Profiles can be backed up or shared with a colleague from Options → Suite backup (Lab filing).</p>
    </div>`;
  }
  return `<div class="lf-list">${_profiles.map(renderCard).join('')}</div>`;
}

function renderCard(p) {
  const canEnable = p.reviewed === true && noticeAcknowledged();
  const srcBadge =
    p.source === 'llm'
      ? `<span class="lf-badge lf-badge-llm" title="Built from a screenshot with an outside assistant — check every field against your real screen before enabling.">Auto-suggested</span>`
      : p.source === 'import'
        ? `<span class="lf-badge">Imported</span>`
        : '';
  const reviewedBadge = p.reviewed
    ? `<span class="lf-badge lf-badge-ok">Reviewed</span>`
    : `<span class="lf-badge lf-badge-warn">Not reviewed</span>`;
  const msgBadge =
    p.patientMessage && p.patientMessage.enabled ? `<span class="lf-badge">+ patient message</span>` : '';
  const mode = LF.LF_COMMIT_MODES.includes(p.commitMode) ? p.commitMode : 'manual';
  const matchStr =
    (p.match || []).map(esc).join(', ') || '<span class="lf-muted">no match terms — won’t auto-offer</span>';
  return `
    <div class="lf-card${p.enabled ? ' lf-card-on' : ''}">
      <div class="lf-card-top">
        <div class="lf-card-name">${esc(p.name)}</div>
        <label class="lf-toggle${canEnable ? '' : ' lf-toggle-locked'}" title="${canEnable ? 'Enable / disable this profile' : 'Review the profile and acknowledge the notice before enabling'}">
          <input type="checkbox" data-act="toggle-enabled" data-id="${esc(p.id)}" ${p.enabled ? 'checked' : ''} ${canEnable ? '' : 'disabled'}>
          <span>${p.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>
      <div class="lf-badges">${reviewedBadge}${srcBadge}${msgBadge}<span class="lf-badge">${mode === 'confirm' ? 'Confirm, then file' : 'Pre-fill, I file'}</span></div>
      <div class="lf-card-row"><span class="lf-k">Applies to</span><span class="lf-v">${matchStr}</span></div>
      <div class="lf-card-row"><span class="lf-k">Marks normal as</span><span class="lf-v">${esc(p.filing && p.filing.normalOptionText)} → ${esc(p.filing && p.filing.fileButtonText)}${p.filing && p.filing.completeButtonText ? ' → ' + esc(p.filing.completeButtonText) : ''}</span></div>
      <div class="lf-card-actions">
        ${p.reviewed ? '' : `<button class="lf-btn lf-btn-sm" data-act="mark-reviewed" data-id="${esc(p.id)}">Mark reviewed</button>`}
        <button class="lf-btn lf-btn-sm" data-act="edit" data-id="${esc(p.id)}">Edit</button>
        <button class="lf-btn lf-btn-sm lf-btn-danger" data-act="delete" data-id="${esc(p.id)}">Delete</button>
      </div>
    </div>`;
}

function editingProfile() {
  if (_editingId === 'new' || !_editingId) return null;
  return _profiles.find((p) => p && p.id === _editingId) || null;
}

function renderForm() {
  const p = editingProfile() || {};
  const f = p.filing || {};
  const m = p.patientMessage || {};
  const v = (x) => esc(x || '');
  const mode = LF.LF_COMMIT_MODES.includes(p.commitMode) ? p.commitMode : 'manual';
  return `
    <div class="lf-form">
      <div class="lf-form-head">${_editingId === 'new' ? 'New filing profile' : 'Edit filing profile'}</div>

      <details class="lf-llm">
        <summary>Build it automatically from a screenshot (optional)…</summary>
        <div class="lf-llm-inner">
          <p class="lf-help">Don't want to fill this in by hand? Press <strong>Copy prompt</strong>, then open a chat assistant (such as ChatGPT or Claude), paste the prompt, and add <strong>screenshots of your lab's results-filing screen</strong>. It replies with a block of text (JSON) describing the on-screen buttons. Paste that reply below and press “Fill form from JSON”. Nothing is saved until you review it and click Save, and the profile stays switched off until you enable it.</p>
          <button class="lf-btn lf-btn-sm" data-act="copy-llm-prompt">Copy prompt</button>
          <textarea id="lfLlmJson" class="lf-input" rows="4" placeholder="Paste the JSON reply from the LLM here…"></textarea>
          <div class="lf-llm-row">
            <button class="lf-btn lf-btn-sm" data-act="fill-from-llm">Fill form from JSON</button>
            <span id="lfLlmStatus" class="lf-llm-status"></span>
          </div>
        </div>
      </details>

      <label class="lf-field"><span>Profile name</span>
        <input id="lfName" class="lf-input" value="${v(p.name)}" placeholder="e.g. City Hospital — routine bloods"></label>

      <label class="lf-field"><span>Applies to (match terms, comma-separated)</span>
        <input id="lfMatch" class="lf-input" value="${v((p.match || []).join(', '))}" placeholder="full blood count, u&e, liver function">
        <small class="lf-help">Substrings matched against the report/specimen titles. The button only auto-offers on reports that match.</small></label>

      <label class="lf-field"><span>Analyte names on this lab’s reports (comma-separated)</span>
        <input id="lfAnalytes" class="lf-input" value="${v((p.analytes || []).join(', '))}" placeholder="haemoglobin, sodium, potassium, creatinine">
        <small class="lf-help"><button class="lf-link" data-act="seed-analytes" type="button">Seed from known analytes</button> — pulls names from your result rules.</small></label>

      <div class="lf-fieldset">
        <div class="lf-fieldset-title">Filing controls (use the exact on-screen text)</div>
        <label class="lf-field"><span>“Normal / no action” option text *</span>
          <input id="lfNormalOpt" class="lf-input" value="${v(f.normalOptionText)}" placeholder="No action required"></label>
        <label class="lf-field"><span>Per-subheading menu opener (optional)</span>
          <input id="lfOpenCtl" class="lf-input" value="${v(f.openControlText)}" placeholder="Select action"></label>
        <label class="lf-field"><span>File button text *</span>
          <input id="lfFileBtn" class="lf-input" value="${v(f.fileButtonText)}" placeholder="File"></label>
        <label class="lf-field"><span>Complete button text (optional)</span>
          <input id="lfCompleteBtn" class="lf-input" value="${v(f.completeButtonText)}" placeholder="Complete"></label>
        <label class="lf-field"><span>Filing comment (optional)</span>
          <input id="lfComment" class="lf-input" value="${v(f.filingComment)}" placeholder="All results within normal limits, no action needed."></label>
        <label class="lf-field"><span>Row CSS selector (advanced, optional)</span>
          <input id="lfRowSel" class="lf-input" value="${v(f.rowSelector)}" placeholder="leave blank unless you know it"></label>
      </div>

      <div class="lf-fieldset">
        <div class="lf-fieldset-title">Patient message (prepared only — you send it)</div>
        <label class="lf-check"><input type="checkbox" id="lfMsgEnabled" ${m.enabled ? 'checked' : ''}> Prepare a “results normal” message on filing</label>
        <label class="lf-field"><span>Message template ({firstName} allowed)</span>
          <textarea id="lfMsgTemplate" class="lf-input" rows="3" placeholder="Dear {firstName}, your recent blood test results are all normal and no action is needed.">${v(m.template)}</textarea></label>
        <label class="lf-field"><span>Message field label (optional)</span>
          <input id="lfMsgField" class="lf-input" value="${v(m.fieldText)}" placeholder="Message"></label>
        <small class="lf-help">The macro copies this to your clipboard and (if the field is named) pre-fills it. It never sends.</small>
      </div>

      <div class="lf-fieldset">
        <div class="lf-fieldset-title">On commit</div>
        <label class="lf-radio"><input type="radio" name="lfMode" value="manual" ${mode === 'manual' ? 'checked' : ''}> Pre-fill the normal options, I’ll review and click File</label>
        <label class="lf-radio"><input type="radio" name="lfMode" value="confirm" ${mode === 'confirm' ? 'checked' : ''}> Ask me to confirm, then file automatically</label>
      </div>

      <div id="lfFormError" class="lf-form-error"></div>
      <div class="lf-form-actions">
        <button class="lf-btn lf-btn-primary" data-act="save">Save profile (disabled until reviewed)</button>
        <button class="lf-btn" data-act="cancel-form">Cancel</button>
      </div>
    </div>`;
}

function renderAudit() {
  if (_editingId || !_audit.length) return '';
  const rows = _audit
    .slice(0, 12)
    .map((a) => {
      const when = a && a.ts ? new Date(a.ts).toLocaleString() : '';
      const what = a && a.filed ? `filed${a.completed ? ' + completed' : ''}` : 'prepared (not filed)';
      return `<div class="lf-audit-row"><span class="lf-audit-when">${esc(when)}</span><span class="lf-audit-what">${esc(a && a.profile)} — ${esc(what)}, ${a && a.marked ? esc(String(a.marked)) : '0'} marked${a && a.messagePrepared ? ', message prepared' : ''}</span></div>`;
    })
    .join('');
  return `
    <div class="lf-audit">
      <div class="lf-audit-head">Recent filings (this device)</div>
      ${rows}
    </div>`;
}

// ── Events ────────────────────────────────────────────────────────────────────

function onInput(ev) {
  // Live-update the patient-message enable hint, etc. (kept minimal — no churn.)
  if (ev.target && ev.target.id === 'lfMsgEnabled') {
    // no-op; saved on Save
  }
}

async function onClick(ev) {
  const actEl = ev.target.closest('[data-act]');
  if (!actEl) return;
  const act = actEl.dataset.act;
  switch (act) {
    case 'ack-notice':
      _config.noticeAcknowledgedAt = new Date().toISOString();
      await persistConfig();
      render();
      break;
    case 'add-new':
      _editingId = 'new';
      _formSource = null;
      render();
      break;
    case 'cancel-form':
      _editingId = null;
      _formSource = null;
      render();
      break;
    case 'copy-llm-prompt':
      copyText(LF.filingProfilePrompt(), actEl);
      break;
    case 'fill-from-llm':
      fillFromLlm();
      break;
    case 'seed-analytes':
      seedAnalytes();
      break;
    case 'save':
      await saveForm();
      break;
    case 'edit':
      _editingId = actEl.dataset.id;
      _formSource = null;
      render();
      break;
    case 'delete':
      await deleteProfile(actEl.dataset.id);
      break;
    case 'mark-reviewed':
      await markReviewed(actEl.dataset.id);
      break;
    case 'toggle-enabled':
      await toggleEnabled(actEl.dataset.id, actEl.checked);
      break;
  }
}

function seedAnalytes() {
  const input = container.querySelector('#lfAnalytes');
  if (!input) return;
  const seeded = LF.seedAnalytesFromResultRules(_resultRules);
  const existing = input.value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const merged = Array.from(new Set(existing.concat(seeded)));
  input.value = merged.join(', ');
}

function readForm() {
  const get = (id) => (container.querySelector('#' + id)?.value ?? '').trim();
  const checked = (id) => !!container.querySelector('#' + id)?.checked;
  const splitList = (s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const modeEl = container.querySelector('input[name="lfMode"]:checked');
  return {
    name: get('lfName'),
    match: splitList(get('lfMatch')),
    analytes: splitList(get('lfAnalytes')),
    filing: {
      normalOptionText: get('lfNormalOpt'),
      openControlText: get('lfOpenCtl'),
      fileButtonText: get('lfFileBtn'),
      completeButtonText: get('lfCompleteBtn'),
      filingComment: get('lfComment'),
      rowSelector: get('lfRowSel'),
    },
    patientMessage: {
      enabled: checked('lfMsgEnabled'),
      template: get('lfMsgTemplate'),
      fieldText: get('lfMsgField'),
    },
    commitMode: modeEl ? modeEl.value : 'manual',
  };
}

function fillFromLlm() {
  const statusEl = container.querySelector('#lfLlmStatus');
  const jsonEl = container.querySelector('#lfLlmJson');
  if (!statusEl || !jsonEl) return;
  const fail = (msg) => {
    statusEl.className = 'lf-llm-status lf-llm-status-err';
    statusEl.textContent = msg;
  };
  const raw = (jsonEl.value || '').trim();
  if (!raw) return fail('Paste the LLM JSON reply first.');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return fail('Could not parse JSON: ' + e.message);
  }
  let profile = parsed;
  if (Array.isArray(parsed)) profile = parsed[0];
  else if (parsed && Array.isArray(parsed.profiles)) profile = parsed.profiles[0];
  if (!profile) return fail('No profile found in the pasted JSON.');

  const errs = LF.validateProfile(profile);
  if (errs.length > 0) return fail(errs[0]);
  const clean = LF.lockForReview(profile, 'llm');

  const set = (id, val) => {
    const elx = container.querySelector('#' + id);
    if (elx) elx.value = val;
  };
  set('lfName', clean.name);
  set('lfMatch', (clean.match || []).join(', '));
  set('lfAnalytes', (clean.analytes || []).join(', '));
  set('lfNormalOpt', clean.filing.normalOptionText);
  set('lfOpenCtl', clean.filing.openControlText);
  set('lfFileBtn', clean.filing.fileButtonText);
  set('lfCompleteBtn', clean.filing.completeButtonText);
  set('lfComment', clean.filing.filingComment);
  set('lfRowSel', clean.filing.rowSelector);
  set('lfMsgTemplate', clean.patientMessage.template);
  set('lfMsgField', clean.patientMessage.fieldText);
  // Message stays OFF (lockForReview) — the clinician opts in deliberately.
  const msgChk = container.querySelector('#lfMsgEnabled');
  if (msgChk) msgChk.checked = false;
  const modeRadio = container.querySelector(`input[name="lfMode"][value="${clean.commitMode}"]`);
  if (modeRadio) modeRadio.checked = true;

  _formSource = 'llm';

  const phi = LF.phiWarnings([clean]);
  if (phi.length > 0) {
    statusEl.className = 'lf-llm-status lf-llm-status-warn';
    statusEl.textContent = 'Form filled — but check it: ' + phi[0];
    return;
  }
  statusEl.className = 'lf-llm-status lf-llm-status-ok';
  statusEl.textContent = 'Form filled — check every label against your real screen, then Save.';
}

async function saveForm() {
  const errEl = container.querySelector('#lfFormError');
  const showErr = (m) => {
    if (errEl) errEl.textContent = m;
  };
  const draft = readForm();
  const errs = LF.validateProfile(draft);
  if (errs.length > 0) return showErr(errs[0]);

  const existing = editingProfile();
  const clean = LF.sanitiseProfile(draft);

  // Provenance + review state: editing preserves reviewed unless content is from
  // an LLM this session; a new/LLM-sourced profile arrives unreviewed & disabled.
  if (existing) {
    clean.id = existing.id;
    clean.source = _formSource === 'llm' ? 'llm' : existing.source || 'manual';
    // Any edit re-opens review: a changed filing label must be re-checked.
    clean.reviewed = false;
    clean.enabled = false;
  } else {
    clean.source = _formSource === 'llm' ? 'llm' : 'manual';
    clean.reviewed = false;
    clean.enabled = false;
    clean.id = LF.generateProfileId(clean.name, new Set(_profiles.map((p) => p.id)));
  }

  const idx = _profiles.findIndex((p) => p && p.id === clean.id);
  if (idx >= 0) _profiles[idx] = clean;
  else _profiles.push(clean);

  await persistProfiles();
  _editingId = null;
  _formSource = null;
  render();
}

async function deleteProfile(id) {
  const p = _profiles.find((x) => x && x.id === id);
  if (!p) return;
  if (!confirm(`Delete filing profile “${p.name}”? This cannot be undone.`)) return;
  _profiles = _profiles.filter((x) => x && x.id !== id);
  await persistProfiles();
  render();
}

async function markReviewed(id) {
  const p = _profiles.find((x) => x && x.id === id);
  if (!p) return;
  p.reviewed = true;
  p.updatedAt = new Date().toISOString();
  await persistProfiles();
  render();
}

async function toggleEnabled(id, on) {
  const p = _profiles.find((x) => x && x.id === id);
  if (!p) return;
  if (on && (p.reviewed !== true || !noticeAcknowledged())) {
    // Guard — shouldn't happen (checkbox disabled), but never enable unreviewed.
    render();
    return;
  }
  p.enabled = !!on;
  p.updatedAt = new Date().toISOString();
  await persistProfiles();
  render();
}

// Clipboard helper (side-panel context may lack navigator.clipboard).
function copyText(text, btnEl) {
  const done = () => {
    if (btnEl) {
      const prev = btnEl.textContent;
      btnEl.textContent = 'Copied ✓';
      setTimeout(() => {
        btnEl.textContent = prev;
      }, 1400);
    }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      return;
    }
  } catch (e) {
    /* fall through */
  }
  fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done && done();
  } catch (e) {
    /* ignore */
  }
}
