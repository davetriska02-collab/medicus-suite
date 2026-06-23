// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — AI Assist module (Phase 1) — client for the on-prem GP Forge server.
//
// PHASE 1 = ADMINISTRATIVE DRAFTING ONLY (recall/invitation wording, internal admin text).
// NOT a medical device; NOT clinical advice/decision support. See docs/INTENDED-PURPOSE-LLM-SERVER.md
// and docs/HAZARD-LOG.md (H-036).
//
// SAFETY POSTURE (matches the suite's staged-disabled features, e.g. Reception/result-triage):
//   • Ships DISABLED. The practice must set the GP Forge URL/key and explicitly enable it.
//   • Default install permissions are NOT broadened: the GP Forge origin is requested at enable
//     time via chrome.permissions.request (optional_host_permissions), not granted up front.
//   • Phase-1 sends ONLY the clinician's typed administrative prompt to the practice's LOCAL
//     GP Forge appliance — no patient record is attached, no internet egress.
//   • Every draft is returned for HUMAN review/edit before use; nothing is written to Medicus.
//   • Degrades gracefully: if GP Forge is unreachable, this tab shows a notice and the rest of the
//     suite is entirely unaffected.
//
// Storage: aiAssist.config { baseUrl, apiKey, enabled }. INTENTIONALLY NOT in suite backup — it is
// per-appliance environment config, not user content (a restored backup must not carry one
// practice's server URL/key to another install).

'use strict';

const STORAGE_KEY = 'aiAssist.config';

let container = null;
let _cfg = { baseUrl: '', apiKey: '', enabled: false };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normBase(u) {
  return String(u || '').trim().replace(/\/$/, '');
}

function originPattern(baseUrl) {
  try {
    return new URL(baseUrl).origin + '/*';
  } catch {
    return null;
  }
}

// ── chrome.* promisified ────────────────────────────────────────────────────────
function loadConfig() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (o) => {
        const c = (o && o[STORAGE_KEY]) || {};
        resolve({ baseUrl: c.baseUrl || '', apiKey: c.apiKey || '', enabled: !!c.enabled });
      });
    } catch {
      resolve({ baseUrl: '', apiKey: '', enabled: false });
    }
  });
}

function saveConfig(cfg) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: cfg }, () => resolve());
    } catch {
      resolve();
    }
  });
}

function hasPermission(baseUrl) {
  const origin = originPattern(baseUrl);
  if (!origin) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: [origin] }, (granted) => resolve(!!granted));
    } catch {
      resolve(false);
    }
  });
}

function requestPermission(baseUrl) {
  const origin = originPattern(baseUrl);
  if (!origin) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins: [origin] }, (granted) => resolve(!!granted));
    } catch {
      resolve(false);
    }
  });
}

// ── GP Forge calls ───────────────────────────────────────────────────────────────
async function probe() {
  if (!_cfg.enabled || !_cfg.baseUrl) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${normBase(_cfg.baseUrl)}/healthz`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false; // offline → caller renders the graceful-degradation notice
  }
}

async function requestDraft({ kind, freeText }) {
  const r = await fetch(`${normBase(_cfg.baseUrl)}/v1/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${_cfg.apiKey}` },
    body: JSON.stringify({ kind, context: { freeText } }), // no patient record attached in Phase 1
  });
  let body = {};
  try {
    body = await r.json();
  } catch {
    /* non-JSON error body */
  }
  return { status: r.status, body };
}

// ── views ──────────────────────────────────────────────────────────────────────
function renderSetup(note) {
  container.innerHTML = `
    <div class="ai-assist">
      <div class="ai-banner ai-warn">
        <strong>AI Assist is off by default.</strong> Administrative drafting only — not a medical
        device, not clinical advice. Only enable after your practice has completed the GP Forge
        governance (DPIA / DCB0160). When enabled, your typed text is sent to your practice's local
        GP Forge server (no patient record is attached).
      </div>
      ${note ? `<div class="ai-error" id="ai-setup-note"></div>` : ''}
      <label class="ai-field">GP Forge server URL
        <input id="ai-url" type="text" placeholder="https://ai.surgery.local" value="${esc(_cfg.baseUrl)}" />
      </label>
      <label class="ai-field">Your GP Forge key
        <input id="ai-key" type="password" placeholder="per-clinician key" value="${esc(_cfg.apiKey)}" />
      </label>
      <label class="ai-check"><input id="ai-enable" type="checkbox" ${_cfg.enabled ? 'checked' : ''} /> Enable AI Assist for this device</label>
      <button id="ai-save" class="ai-btn">Save &amp; connect</button>
    </div>`;
  if (note) container.querySelector('#ai-setup-note').textContent = note;
  container.querySelector('#ai-save').addEventListener('click', onSave);
}

function renderOffline() {
  container.innerHTML = `
    <div class="ai-assist">
      <div class="ai-banner">GP Forge is not reachable. Administrative drafting is unavailable right
        now — the rest of Medicus Suite is unaffected.</div>
      <div class="ai-row">
        <button id="ai-retry" class="ai-btn">Retry</button>
        <button id="ai-settings" class="ai-btn ai-btn-ghost">Settings</button>
      </div>
    </div>`;
  container.querySelector('#ai-retry').addEventListener('click', () => init(container));
  container.querySelector('#ai-settings').addEventListener('click', () => {
    renderSetup();
  });
}

function renderWorkbench() {
  container.innerHTML = `
    <div class="ai-assist">
      <div class="ai-banner">Administrative drafts only — <strong>not clinical advice</strong>.
        Review and edit before use. Do not enter patient-identifiable detail; use [PLACEHOLDERS].</div>
      <label class="ai-field">Kind of administrative text
        <input id="ai-kind" type="text" list="ai-kinds" value="recall invitation" />
        <datalist id="ai-kinds">
          <option value="recall invitation"></option>
          <option value="appointment reminder"></option>
          <option value="internal admin note"></option>
          <option value="routine correspondence"></option>
        </datalist>
      </label>
      <label class="ai-field">What should it say? (administrative instructions only)
        <textarea id="ai-prompt" rows="4" placeholder="e.g. invite eligible patients to the seasonal flu clinic; friendly tone; ask them to call to book"></textarea>
      </label>
      <div class="ai-row">
        <button id="ai-draft" class="ai-btn">Draft</button>
        <button id="ai-settings" class="ai-btn ai-btn-ghost">Settings</button>
        <span id="ai-status" class="ai-status"></span>
      </div>
      <div id="ai-result" class="ai-result" hidden>
        <div class="ai-review">Draft — review &amp; edit before use:</div>
        <input id="ai-out-title" type="text" class="ai-out-title" />
        <textarea id="ai-out-body" rows="8" class="ai-out-body"></textarea>
        <div id="ai-placeholders" class="ai-placeholders"></div>
        <div class="ai-row">
          <button id="ai-copy" class="ai-btn">Copy</button>
          <span class="ai-foot">Nothing is filed to Medicus — you paste/use this yourself.</span>
        </div>
      </div>
    </div>`;
  container.querySelector('#ai-draft').addEventListener('click', onDraft);
  container.querySelector('#ai-settings').addEventListener('click', () => renderSetup());
  container.querySelector('#ai-copy').addEventListener('click', onCopy);
}

// ── handlers ─────────────────────────────────────────────────────────────────────
async function onSave() {
  const baseUrl = normBase(container.querySelector('#ai-url').value);
  const apiKey = container.querySelector('#ai-key').value.trim();
  const enabled = container.querySelector('#ai-enable').checked;

  if (enabled) {
    if (!originPattern(baseUrl)) return renderSetup('Enter a valid server URL (e.g. https://ai.surgery.local).');
    const granted = (await hasPermission(baseUrl)) || (await requestPermission(baseUrl));
    if (!granted) {
      return renderSetup('Permission to reach that server was not granted. Use the documented host, or add its origin to optional_host_permissions in the manifest.');
    }
  }
  _cfg = { baseUrl, apiKey, enabled };
  await saveConfig(_cfg);
  init(container);
}

function setStatus(msg) {
  const el = container.querySelector('#ai-status');
  if (el) el.textContent = msg || '';
}

async function onDraft() {
  const kind = container.querySelector('#ai-kind').value.trim() || 'administrative text';
  const freeText = container.querySelector('#ai-prompt').value.trim();
  if (!freeText) return setStatus('Enter what the text should say.');
  const btn = container.querySelector('#ai-draft');
  btn.disabled = true;
  setStatus('Drafting…');
  try {
    const { status, body } = await requestDraft({ kind, freeText });
    if (status === 200 && body.draft) {
      showDraft(body.draft);
      setStatus('');
    } else if (status === 422) {
      setStatus(body.message || 'Refused: administrative drafting only (this looked clinical).');
    } else if (status === 401) {
      setStatus('Authentication failed — check your key in Settings.');
    } else if (status === 503) {
      renderOffline();
    } else if (status === 502) {
      setStatus('The server rejected the draft (non-administrative content). Try rephrasing.');
    } else {
      setStatus(`Could not draft (${status}).`);
    }
  } catch {
    renderOffline();
  } finally {
    btn.disabled = false;
  }
}

function showDraft(draft) {
  const wrap = container.querySelector('#ai-result');
  container.querySelector('#ai-out-title').value = draft.title || '';
  container.querySelector('#ai-out-body').value = draft.body || '';
  const ph = container.querySelector('#ai-placeholders');
  ph.textContent = '';
  if (Array.isArray(draft.placeholders) && draft.placeholders.length) {
    const label = document.createElement('div');
    label.className = 'ai-ph-label';
    label.textContent = 'Fill in before sending:';
    ph.appendChild(label);
    for (const p of draft.placeholders) {
      const chip = document.createElement('span');
      chip.className = 'ai-ph';
      chip.textContent = p;
      ph.appendChild(chip);
    }
  }
  wrap.hidden = false;
}

async function onCopy() {
  const title = container.querySelector('#ai-out-title').value;
  const bodyText = container.querySelector('#ai-out-body').value;
  const text = (title ? title + '\n\n' : '') + bodyText;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied.');
  } catch {
    setStatus('Copy failed — select and copy manually.');
  }
}

// ── lifecycle ──────────────────────────────────────────────────────────────────
export async function init(el) {
  container = el;
  _cfg = await loadConfig();
  const ready = _cfg.enabled && _cfg.baseUrl && (await hasPermission(_cfg.baseUrl));
  if (!ready) {
    renderSetup();
    return;
  }
  const up = await probe();
  if (!up) {
    renderOffline();
    return;
  }
  renderWorkbench();
}

export function cleanup() {
  container = null;
}
