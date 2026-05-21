// Medicus Suite — Options page controller

'use strict';

// ── Helpers (hoisted to top so any subsequent code can use them) ──────────────

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g,'&quot;'); }

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.section;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.opt-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`sect-${target}`)?.classList.add('active');
  });
});

// ── Suite settings (practice code) ────────────────────────────────────────────

const practiceCodeInput = document.getElementById('practiceCode');
const saveSuiteBtn = document.getElementById('saveSuite');
const suiteSaved = document.getElementById('suiteSaved');
const codeDetectedRow = document.getElementById('codeDetectedRow');
const codeDetectedValue = document.getElementById('codeDetectedValue');
const codeNotDetectedRow = document.getElementById('codeNotDetectedRow');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const testConnectionResult = document.getElementById('testConnectionResult');

// Load saved code and show auto-detected code.
// Wrapped in a self-invoking IIFE so any throw here can't halt the rest of
// the script — every section below needs to keep working independently.
(async function initSuiteSection() {
  try {
    // Load saved fallback
    if (practiceCodeInput) {
      chrome.storage.local.get(['suite.practiceCode'], res => {
        practiceCodeInput.value = res['suite.practiceCode'] || '';
      });
    }
    // Try to auto-detect from open Medicus tab
    let detected = null;
    try {
      const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
      for (const tab of tabs) {
        const m = tab.url && tab.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
        if (m?.[1]) { detected = m[1].toLowerCase(); break; }
      }
    } catch (_) {}
    if (detected) {
      if (codeDetectedRow)   codeDetectedRow.style.display = 'flex';
      if (codeDetectedValue) codeDetectedValue.textContent = detected;
      if (codeNotDetectedRow) codeNotDetectedRow.style.display = 'none';
    } else {
      if (codeDetectedRow)    codeDetectedRow.style.display = 'none';
      if (codeNotDetectedRow) codeNotDetectedRow.style.display = 'block';
    }
  } catch (e) {
    console.warn('[Suite section init]', e.message);
  }
})();

saveSuiteBtn?.addEventListener('click', async () => {
  if (!practiceCodeInput) return;
  const code = practiceCodeInput.value.trim().toLowerCase();
  await chrome.storage.local.set({
    'suite.practiceCode': code,
    'submissions.config': { practiceCode: code },
  });
  if (suiteSaved) {
    suiteSaved.classList.add('show');
    setTimeout(() => suiteSaved.classList.remove('show'), 2000);
  }
});

testConnectionBtn?.addEventListener('click', async () => {
  if (testConnectionResult) {
    testConnectionResult.textContent = 'Testing...';
    testConnectionResult.style.color = '#93a8c5';
  }

  let code = null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    for (const tab of tabs) {
      const m = tab.url && tab.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (m?.[1]) { code = m[1].toLowerCase(); break; }
    }
  } catch (_) {}
  if (!code) {
    const stored = await chrome.storage.local.get('suite.practiceCode');
    code = stored['suite.practiceCode'] || null;
  }

  if (!code) {
    if (testConnectionResult) {
      testConnectionResult.textContent = 'No practice code — open a Medicus tab or enter code below.';
      testConnectionResult.style.color = '#f59e0b';
    }
    return;
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://${code}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false`;
    const r = await fetch(url, { credentials: 'include' });
    if (testConnectionResult) {
      if (r.ok) {
        testConnectionResult.textContent = `Connected (${code}) ✓`;
        testConnectionResult.style.color = '#4ade80';
      } else {
        testConnectionResult.textContent = `Error ${r.status} for code "${code}" — check code or Medicus sign-in.`;
        testConnectionResult.style.color = '#f87171';
      }
    }
  } catch (e) {
    if (testConnectionResult) {
      testConnectionResult.textContent = `Network error: ${e.message}`;
      testConnectionResult.style.color = '#f87171';
    }
  }
});

// ── Capacity Forecast preset editor ──────────────────────────────────────────

const presetEditor = document.getElementById('capPresetEditor');
let editingPresetId = null;
let availableTypes = []; // {id, name} from API

async function loadAvailableTypes() {
  // Prefer tab-detected code, fall back to storage
  let siteId = null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    for (const t of tabs) {
      const m = t.url && t.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (m?.[1]) { siteId = m[1].toLowerCase(); break; }
    }
  } catch (e) {}
  if (!siteId) {
    const stored = await chrome.storage.local.get('suite.practiceCode');
    siteId = stored['suite.practiceCode'] || null;
  }
  if (!siteId) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://${siteId}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false`;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.appointmentTypeOptions || [])
      .map(t => ({ id: t.label, name: t.label }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function renderPresetEditor() {
  if (!presetEditor) return;
  const { 'capacity.presets': presets = [] } = await chrome.storage.local.get('capacity.presets');

  if (availableTypes.length === 0) availableTypes = await loadAvailableTypes();

  presetEditor.innerHTML = `
    <div class="preset-list">
      ${presets.length === 0 ? '<div style="color:var(--text-4);font-size:12px;padding:8px 0">No presets yet — create one below.</div>' : presets.map(p => `
        <div class="preset-card">
          <div class="preset-card-header">
            <div class="preset-card-name">${escHtml(p.name)}</div>
            <div class="preset-card-actions">
              <button class="pc-btn" data-edit="${escAttr(p.id)}">Edit</button>
              <button class="pc-btn danger" data-delete="${escAttr(p.id)}">Delete</button>
            </div>
          </div>
          <div class="preset-card-meta">
            <span>Min ${p.minimumPerDay}/day</span>
            <span>Tight at ${p.thresholds?.tight ?? 75}%</span>
            <span>Low at ${p.thresholds?.low ?? 50}%</span>
            <span>${p.slotTypes.length} slot type${p.slotTypes.length!==1?'s':''}</span>
          </div>
          <div class="preset-card-types">${escHtml(p.slotTypes.slice(0, 3).join(', '))}${p.slotTypes.length > 3 ? ` and ${p.slotTypes.length - 3} more` : ''}</div>
        </div>
      `).join('')}
    </div>
    <button class="add-preset-btn" id="addPresetBtn">+ New preset</button>
  `;

  presetEditor.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.edit)));
  presetEditor.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deletePreset(b.dataset.delete)));
  presetEditor.querySelector('#addPresetBtn')?.addEventListener('click', () => openForm(null));
}

async function openForm(presetId) {
  editingPresetId = presetId;
  const { 'capacity.presets': presets = [] } = await chrome.storage.local.get('capacity.presets');
  const editing = presetId ? presets.find(p => p.id === presetId) : null;
  const p = editing || { name: '', slotTypes: [], minimumPerDay: 20, thresholds: { tight: 75, low: 50 } };

  if (availableTypes.length === 0) {
    availableTypes = await loadAvailableTypes();
  }

  // Merge available types with any saved types not currently visible (so unknown saved types still show)
  const allTypeNames = new Set([...availableTypes.map(t => t.name), ...p.slotTypes]);
  const sortedTypes = Array.from(allTypeNames).sort();

  presetEditor.innerHTML = `
    <div class="preset-form">
      <h3>${editing ? 'Edit preset' : 'New preset'}</h3>
      <div class="form-row full">
        <label>Name</label>
        <input type="text" id="fName" value="${escAttr(p.name)}" placeholder="e.g. GP Routine" />
      </div>
      <div class="form-row">
        <div>
          <label>Daily minimum</label>
          <input type="number" id="fMin" value="${p.minimumPerDay}" min="0" max="500" />
        </div>
        <div>
          <label>Thresholds (% of minimum)</label>
          <div class="threshold-row">
            <span>Tight at</span>
            <input type="number" id="fTight" value="${p.thresholds?.tight ?? 75}" min="1" max="99" />
            <span>%, Low at</span>
            <input type="number" id="fLow" value="${p.thresholds?.low ?? 50}" min="1" max="99" />
            <span>%</span>
          </div>
        </div>
      </div>
      <div class="form-row full">
        <label>Slot types (${p.slotTypes.length} selected)</label>
        <div class="types-multiselect" id="fTypes">
          ${sortedTypes.length === 0 ? '<div style="color:var(--text-4);padding:8px;font-size:11px;font-family:var(--sans)">No slot types loaded. Set the practice code in Suite tab first.</div>' : sortedTypes.map(t => `
            <label class="type-check-row">
              <input type="checkbox" value="${escAttr(t)}" ${p.slotTypes.includes(t) ? 'checked' : ''} />
              <label>${escHtml(t)}</label>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="form-actions">
        <button class="add-preset-btn" id="fSave">${editing ? 'Save changes' : 'Create preset'}</button>
        <button class="ghost-btn-opt" id="fCancel">Cancel</button>
      </div>
    </div>
  `;

  presetEditor.querySelector('#fSave').addEventListener('click', () => savePreset(editing));
  presetEditor.querySelector('#fCancel').addEventListener('click', renderPresetEditor);
}

async function savePreset(editing) {
  const name = document.getElementById('fName').value.trim();
  const minimumPerDay = parseInt(document.getElementById('fMin').value, 10) || 0;
  const tight = parseInt(document.getElementById('fTight').value, 10) || 75;
  const low = parseInt(document.getElementById('fLow').value, 10) || 50;
  const slotTypes = Array.from(document.querySelectorAll('#fTypes input[type=checkbox]:checked')).map(i => i.value);

  if (!name) { alert('Preset needs a name.'); return; }
  if (slotTypes.length === 0) { alert('Select at least one slot type.'); return; }
  if (low >= tight) { alert('Low threshold must be below Tight threshold.'); return; }

  const { 'capacity.presets': presets = [] } = await chrome.storage.local.get('capacity.presets');

  const preset = editing
    ? { ...editing, name, slotTypes, minimumPerDay, thresholds: { tight, low } }
    : { id: 'p_' + Math.random().toString(36).slice(2, 10), name, slotTypes, minimumPerDay, thresholds: { tight, low }, createdAt: new Date().toISOString() };

  const updated = editing
    ? presets.map(p => p.id === editing.id ? preset : p)
    : [...presets, preset];

  await chrome.storage.local.set({ 'capacity.presets': updated });

  // Set as active if it's the first one
  if (!editing && updated.length === 1) {
    await chrome.storage.local.set({ 'capacity.activePresetId': preset.id });
  }

  renderPresetEditor();
}

async function deletePreset(presetId) {
  if (!confirm('Delete this preset?')) return;
  const { 'capacity.presets': presets = [], 'capacity.activePresetId': activeId } = await chrome.storage.local.get(['capacity.presets', 'capacity.activePresetId']);
  const updated = presets.filter(p => p.id !== presetId);
  const newActive = activeId === presetId ? (updated[0]?.id || null) : activeId;
  await chrome.storage.local.set({ 'capacity.presets': updated, 'capacity.activePresetId': newActive });
  renderPresetEditor();
}

// Render editor when Capacity tab is opened
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.section === 'capacity') renderPresetEditor();
  });
});

// ── Phase 2: Backup & Restore ─────────────────────────────────────────────────
// Uses SuiteEnvelope from shared/io/suite-envelope.js (loaded as a script tag).
// IO functions are inlined here to avoid ES module issues in options pages.

// --- Low-level storage helpers (mirrors shared/io/*.js without chrome.storage calls
//     needing to be module-level async; these are called from event handlers) ---

async function doFullExport() {
  const r = await chrome.storage.local.get([
    'sentinel.config', 'sentinel.rules', 'sentinel.orgRules', 'sentinel.customRules',
    'capacity.presets', 'capacity.activePresetId', 'capacity.viewMode', 'capacity.showWeekends',
    'triagelens.config', 'config',
    'slots.hiddenTypes',
    'submissions.config',
    'suite.practiceCode',
  ]);
  const modules = {
    sentinel: {
      config:      r['sentinel.config']      || {},
      rules:       r['sentinel.rules']       || {},
      orgRules:    r['sentinel.orgRules']    || null,
      customRules: r['sentinel.customRules'] || [],
    },
    capacity: {
      presets:        r['capacity.presets']        || [],
      activePresetId: r['capacity.activePresetId'] || null,
      viewMode:       r['capacity.viewMode']       || 'week',
      showWeekends:   r['capacity.showWeekends']   || false,
    },
    triage:  { config: r['triagelens.config'] || r['config'] || {} },
    slots:   { hiddenTypes: r['slots.hiddenTypes'] || [] },
    submissions: { config: r['submissions.config'] || {}, practiceCode: r['suite.practiceCode'] || null },
    suite:   { practiceCode: r['suite.practiceCode'] || null },
  };
  return window.SuiteEnvelope.wrap('suite', modules);
}

async function doModuleExport(scope) {
  const r = await chrome.storage.local.get([
    'sentinel.config', 'sentinel.rules', 'sentinel.orgRules', 'sentinel.customRules',
    'capacity.presets', 'capacity.activePresetId', 'capacity.viewMode', 'capacity.showWeekends',
    'triagelens.config', 'config',
    'slots.hiddenTypes',
    'submissions.config',
    'suite.practiceCode',
  ]);
  let modules = {};
  if (scope === 'sentinel') modules.sentinel = { config: r['sentinel.config']||{}, rules: r['sentinel.rules']||{}, orgRules: r['sentinel.orgRules']||null, customRules: r['sentinel.customRules']||[] };
  if (scope === 'capacity') modules.capacity = { presets: r['capacity.presets']||[], activePresetId: r['capacity.activePresetId']||null, viewMode: r['capacity.viewMode']||'week', showWeekends: r['capacity.showWeekends']||false };
  if (scope === 'triage')   modules.triage = { config: r['triagelens.config'] || r['config'] || {} };
  if (scope === 'slots')    modules.slots = { hiddenTypes: r['slots.hiddenTypes']||[] };
  if (scope === 'submissions') modules.submissions = { config: r['submissions.config']||{}, practiceCode: r['suite.practiceCode']||null };
  return window.SuiteEnvelope.wrap(scope, modules);
}

async function applyEnvelope(envelope) {
  const toSet = {};
  const mods = envelope.modules || {};
  if (mods.sentinel) {
    if (mods.sentinel.config)      toSet['sentinel.config']      = mods.sentinel.config;
    if (mods.sentinel.rules)       toSet['sentinel.rules']       = mods.sentinel.rules;
    if (mods.sentinel.orgRules !== undefined) toSet['sentinel.orgRules'] = mods.sentinel.orgRules;
    if (mods.sentinel.customRules) toSet['sentinel.customRules'] = mods.sentinel.customRules;
  }
  if (mods.capacity) {
    if (mods.capacity.presets !== undefined)        toSet['capacity.presets']        = mods.capacity.presets;
    if (mods.capacity.activePresetId !== undefined) toSet['capacity.activePresetId'] = mods.capacity.activePresetId;
    if (mods.capacity.viewMode)                     toSet['capacity.viewMode']       = mods.capacity.viewMode;
    if (mods.capacity.showWeekends !== undefined)   toSet['capacity.showWeekends']   = mods.capacity.showWeekends;
  }
  if (mods.triage?.config)       toSet['triagelens.config']  = mods.triage.config;
  if (mods.slots?.hiddenTypes)   toSet['slots.hiddenTypes']  = mods.slots.hiddenTypes;
  if (mods.submissions?.config)  toSet['submissions.config'] = mods.submissions.config;
  if (mods.suite?.practiceCode || mods.submissions?.practiceCode) {
    toSet['suite.practiceCode'] = mods.suite?.practiceCode || mods.submissions?.practiceCode;
  }
  if (Object.keys(toSet).length > 0) await chrome.storage.local.set(toSet);
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setBackupStatus(msg, isError) {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ef4444' : '#4ade80';
  setTimeout(() => { el.textContent = ''; }, 4000);
}

// --- Pending import state ---
let pendingEnvelope = null;

// --- Suite-wide export ---
document.getElementById('exportSuite')?.addEventListener('click', async () => {
  try {
    const env = await doFullExport();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(env, `medicus-suite-backup-${stamp}.json`);
    setBackupStatus('Suite backup downloaded.');
  } catch (e) {
    setBackupStatus('Export failed: ' + e.message, true);
  }
});

// --- Suite-wide import: open file picker ---
document.getElementById('importSuiteBtn')?.addEventListener('click', () => {
  document.getElementById('importSuiteFile')?.click();
});

document.getElementById('importSuiteFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const { valid, errors, warnings, envelope } = window.SuiteEnvelope.unwrap(raw);
    if (!valid) { setBackupStatus('Invalid backup: ' + errors.join('; '), true); return; }
    pendingEnvelope = envelope;
    const lines = window.SuiteEnvelope.previewEnvelope(envelope);
    const previewBox = document.getElementById('importPreviewBox');
    if (previewBox) previewBox.textContent = lines.join('\n');
    const warnEl = document.getElementById('importWarnings');
    if (warnEl) warnEl.textContent = warnings.length ? 'Warnings: ' + warnings.join('; ') : '';
    const previewWrap = document.getElementById('importPreviewWrap');
    if (previewWrap) previewWrap.style.display = 'block';
  } catch (err) {
    setBackupStatus('Could not read backup: ' + err.message, true);
  }
});

document.getElementById('confirmImportBtn')?.addEventListener('click', async () => {
  if (!pendingEnvelope) return;
  try {
    await applyEnvelope(pendingEnvelope);
    pendingEnvelope = null;
    const previewWrap = document.getElementById('importPreviewWrap');
    if (previewWrap) previewWrap.style.display = 'none';
    setBackupStatus('Restore complete. Reload any open Medicus tabs to pick up changes.');
    // Re-render capacity presets if on that tab
    renderPresetEditor();
  } catch (err) {
    setBackupStatus('Restore failed: ' + err.message, true);
  }
});

document.getElementById('cancelImportBtn')?.addEventListener('click', () => {
  pendingEnvelope = null;
  const previewWrap = document.getElementById('importPreviewWrap');
  if (previewWrap) previewWrap.style.display = 'none';
});

// --- Reset all ---
document.getElementById('resetAllBtn')?.addEventListener('click', async () => {
  if (!confirm('This will delete all Medicus Suite settings and cannot be undone. Continue?')) return;
  if (!confirm('Are you sure? All presets, rules, and config will be cleared.')) return;
  await chrome.storage.local.clear();
  setBackupStatus('All settings cleared. Reload the page to see defaults.');
});

// --- Per-module export/import ---
document.querySelectorAll('[data-mod-export]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const scope = btn.dataset.modExport;
    try {
      const env = await doModuleExport(scope);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(env, `medicus-${scope}-backup-${stamp}.json`);
      setBackupStatus(`${scope} backup downloaded.`);
    } catch (e) {
      setBackupStatus(`Export failed: ${e.message}`, true);
    }
  });
});

document.querySelectorAll('[data-mod-import]').forEach(btn => {
  btn.addEventListener('click', () => {
    const scope = btn.dataset.modImport;
    const fileInput = btn.closest('.module-export-card')?.querySelector('.mod-file-input[data-mod="' + scope + '"]');
    fileInput?.click();
  });
});

document.querySelectorAll('.mod-file-input').forEach(input => {
  input.addEventListener('change', async (e) => {
    const scope = input.dataset.mod;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { valid, errors, warnings, envelope } = window.SuiteEnvelope.unwrap(raw, scope);
      if (!valid) { setBackupStatus('Invalid file: ' + errors.join('; '), true); return; }
      const lines = window.SuiteEnvelope.previewEnvelope(envelope);
      const msg = `Import ${scope}?\n\n${lines.join('\n')}${warnings.length ? '\n\nWarnings:\n' + warnings.join('\n') : ''}`;
      if (!confirm(msg)) return;
      await applyEnvelope(envelope);
      setBackupStatus(`${scope} restored. Reload Medicus tabs to apply.`);
      if (scope === 'capacity') renderPresetEditor();
    } catch (err) {
      setBackupStatus('Import failed: ' + err.message, true);
    }
  });
});

// ── Debug section (v1.2.2) ────────────────────────────────────────────────────

async function buildDebugState() {
  const lines = [];
  const now = new Date().toISOString();
  lines.push(`Generated: ${now}`);

  // Manifest info
  try {
    const m = chrome.runtime.getManifest();
    lines.push(`Extension: ${m.name} v${m.version}`);
  } catch (_) {}

  // Resolve practice code, show both sources
  let tabCode = null, storageCode = null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    for (const t of tabs) {
      const m = t.url && t.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (m?.[1]) { tabCode = m[1].toLowerCase(); break; }
    }
    lines.push(`Open Medicus tabs: ${tabs.length}`);
    tabs.forEach(t => lines.push(`  - ${t.url}`));
  } catch (e) {
    lines.push(`chrome.tabs.query failed: ${e.message}`);
  }
  try {
    const r = await chrome.storage.local.get('suite.practiceCode');
    storageCode = r['suite.practiceCode'] || null;
  } catch (_) {}
  lines.push(`Detected from tab: ${tabCode || '(none)'}`);
  lines.push(`Saved in storage:  ${storageCode || '(none)'}`);
  lines.push(`Effective code:    ${tabCode || storageCode || '(none — API calls will fail)'}`);
  lines.push(`Code source:       ${tabCode ? 'tab' : storageCode ? 'storage' : 'none'}`);

  // Submissions config (separate storage key — legacy)
  try {
    const r = await chrome.storage.local.get('submissions.config');
    const subCode = r['submissions.config']?.practiceCode;
    if (subCode) lines.push(`Submissions config code: ${subCode}${subCode !== (tabCode || storageCode) ? ' ⚠ MISMATCH' : ''}`);
  } catch (_) {}

  lines.push('');
  lines.push('--- Recent API calls (newest first) ---');
  const entries = window.ApiDiag?.getEntries() || [];
  if (entries.length === 0) {
    lines.push('(no API calls recorded — open the side panel or popup to trigger one)');
  } else {
    entries.slice(0, 20).forEach(e => {
      const t = e.ts.slice(11, 19);
      const tag = e.ok ? 'OK ' : 'ERR';
      lines.push(`${t} ${tag} [${e.module}] status=${e.status ?? '-'} code=${e.code || '-'} src=${e.codeSource || '-'}`);
      if (e.error) lines.push(`         ${e.error}`);
    });
  }
  return lines.join('\n');
}

async function refreshDebugState() {
  const el = document.getElementById('debugState');
  if (el) el.textContent = await buildDebugState();
}

document.getElementById('debugRefreshBtn')?.addEventListener('click', refreshDebugState);

document.getElementById('debugCopyBtn')?.addEventListener('click', async () => {
  const text = await buildDebugState();
  try {
    await navigator.clipboard.writeText(text);
    const s = document.getElementById('debugCopyStatus');
    if (s) { s.textContent = 'Copied ✓'; setTimeout(() => s.textContent = '', 2000); }
  } catch (e) {
    // Fallback: select the text
    const el = document.getElementById('debugState');
    if (el) {
      const range = document.createRange();
      range.selectNode(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  }
});

document.getElementById('debugClearLogBtn')?.addEventListener('click', () => {
  window.ApiDiag?.clear();
  refreshDebugState();
});

// Endpoint probe — try every endpoint the extension uses
document.getElementById('debugProbeBtn')?.addEventListener('click', async () => {
  const results = document.getElementById('debugProbeResults');
  if (!results) return;
  results.innerHTML = 'Probing…';

  const { code, source } = await window.PracticeCode.resolve();
  const lines = [];
  lines.push(`Resolved code: ${code || '(none)'} (${source || 'no source'})`);
  if (!code) {
    lines.push('Cannot probe without a practice code. Open a Medicus tab or set one in Suite.');
    results.innerHTML = lines.map(l => `<div>${l.replace(/</g,'&lt;')}</div>`).join('');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const probes = [
    { name: 'Waiting room',     url: `https://${code}.api.england.medicus.health/scheduling/data/homepage/my-appointments` },
    { name: 'Appointment book', url: `https://${code}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false` },
    { name: 'Task list (admin)',url: `https://${code}.api.england.medicus.health/tasks/data/admin/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}` },
  ];

  results.innerHTML = lines.map(l => `<div>${l.replace(/</g,'&lt;')}</div>`).join('');
  for (const p of probes) {
    const t0 = Date.now();
    let line;
    try {
      const r = await fetch(p.url, { credentials: 'include' });
      const dur = Date.now() - t0;
      const colour = r.ok ? '#4ade80' : '#f87171';
      line = `<div style="color:${colour}"><strong>${p.name}:</strong> ${r.status} (${dur}ms) <span style="color:var(--text-4); font-size:10px">${p.url}</span></div>`;
    } catch (e) {
      line = `<div style="color:#f87171"><strong>${p.name}:</strong> network error: ${e.message}</div>`;
    }
    results.innerHTML += line;
  }
});

// Refresh debug state when the Debug tab is opened
document.querySelectorAll('.nav-item[data-section="debug"]').forEach(btn => {
  btn.addEventListener('click', refreshDebugState);
});

// ── Request Monitor (v1.3) ────────────────────────────────────────────────────

const rmEnabled       = document.getElementById('rmEnabled');
const rmAssigneeId    = document.getElementById('rmAssigneeId');
const rmPollSeconds   = document.getElementById('rmPollSeconds');
const rmNotifyEnabled = document.getElementById('rmNotifyEnabled');
const rmNotifySound   = document.getElementById('rmNotifySound');
const rmConditional   = document.getElementById('rmConditionalFields');
const rmSaveBtn       = document.getElementById('saveRm');
const rmSavedTag      = document.getElementById('rmSaved');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toggleRmConditional() {
  if (!rmConditional || !rmEnabled) return;
  rmConditional.style.display = rmEnabled.checked ? 'block' : 'none';
}

(async function initRmSection() {
  try {
    if (!window.RequestMonitor) return;
    const cfg = await window.RequestMonitor.getConfig();
    if (rmEnabled)       rmEnabled.checked       = !!cfg.enabled;
    if (rmAssigneeId)    rmAssigneeId.value      = cfg.assigneeId || '';
    if (rmPollSeconds)   rmPollSeconds.value     = cfg.pollSeconds || 60;
    if (rmNotifyEnabled) rmNotifyEnabled.checked = !!cfg.notifyEnabled;
    if (rmNotifySound)   rmNotifySound.checked   = !!cfg.notifySound;
    toggleRmConditional();
  } catch (e) {
    console.warn('[RM init]', e.message);
  }
})();

rmEnabled?.addEventListener('change', toggleRmConditional);

rmSaveBtn?.addEventListener('click', async () => {
  const assigneeId = (rmAssigneeId?.value || '').trim();
  const enabled = !!rmEnabled?.checked;
  let pollSeconds = parseInt(rmPollSeconds?.value, 10);
  if (isNaN(pollSeconds) || pollSeconds < 30) pollSeconds = 60;
  if (pollSeconds > 600) pollSeconds = 600;

  // Validate UUID if enabling
  if (enabled && assigneeId && !UUID_RE.test(assigneeId)) {
    if (rmSavedTag) {
      rmSavedTag.textContent = 'Invalid UUID — check format';
      rmSavedTag.style.color = '#f87171';
      rmSavedTag.classList.add('show');
      setTimeout(() => { rmSavedTag.classList.remove('show'); rmSavedTag.textContent = 'Saved ✓'; rmSavedTag.style.color = ''; }, 3000);
    }
    return;
  }

  // Request browser notification permission if user is enabling notifications
  if (enabled && rmNotifyEnabled?.checked) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (_) {}
  }

  await window.RequestMonitor.setConfig({
    enabled,
    assigneeId,
    pollSeconds,
    notifyEnabled: !!rmNotifyEnabled?.checked,
    notifySound:   !!rmNotifySound?.checked,
  });

  // Normalised values back to form
  if (rmPollSeconds) rmPollSeconds.value = pollSeconds;

  if (rmSavedTag) {
    rmSavedTag.classList.add('show');
    setTimeout(() => rmSavedTag.classList.remove('show'), 2000);
  }
});

// ── Triage capacity alerts ────────────────────────────────────────────────────

(async function initTriageAlerts() {
  try {
    if (!window.TriageAlertIO) return;
    const container = document.getElementById('triageAlertRules');
    if (!container) return;

    let rules = await window.TriageAlertIO.getRules();

    function renderRules() {
      container.innerHTML = rules.map((rule, i) => `
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; min-width:120px;">
            <input type="checkbox" class="ta-enabled" data-i="${i}" ${rule.enabled ? 'checked' : ''} />
            <span style="font-size:12px; color:var(--text-2);">${escHtml(rule.label)}</span>
          </label>
          <span style="font-size:11px; color:var(--text-4);">Alert when ≥</span>
          <input type="number" class="ta-threshold" data-i="${i}" value="${rule.threshold}" min="1" max="500"
            style="width:64px; background:var(--bg-elev); border:1px solid var(--border-hi); color:var(--text-2);
                   font-family:var(--mono); font-size:11px; border-radius:5px; padding:3px 6px;" />
          <span style="font-size:11px; color:var(--text-4);">tasks</span>
        </div>
      `).join('');

      container.querySelectorAll('.ta-enabled').forEach(cb => {
        cb.addEventListener('change', () => {
          rules[+cb.dataset.i].enabled = cb.checked;
        });
      });
      container.querySelectorAll('.ta-threshold').forEach(inp => {
        inp.addEventListener('change', () => {
          const v = parseInt(inp.value, 10);
          if (!isNaN(v) && v >= 1) rules[+inp.dataset.i].threshold = v;
        });
      });
    }

    renderRules();

    document.getElementById('saveTriageAlerts')?.addEventListener('click', async () => {
      await window.TriageAlertIO.setRules(rules);
      const tag = document.getElementById('triageAlertSaved');
      if (tag) { tag.classList.add('show'); setTimeout(() => tag.classList.remove('show'), 2000); }
    });
  } catch (e) {
    console.warn('[Triage alerts init]', e.message);
  }
})();

// ── Slot alert rules ──────────────────────────────────────────────────────────

(async function initSlotAlerts() {
  try {
    const container  = document.getElementById('slotAlertRules');
    const addBtn     = document.getElementById('addSlotAlertRule');
    const savedTag   = document.getElementById('slotAlertSaved');
    if (!container || !addBtn) return;

    const r = await chrome.storage.local.get('slots.alertRules');
    let rules = r['slots.alertRules'] ?? [];

    function save() {
      chrome.storage.local.set({ 'slots.alertRules': rules });
      if (savedTag) { savedTag.classList.add('show'); setTimeout(() => savedTag.classList.remove('show'), 2000); }
    }

    function renderRules() {
      container.innerHTML = '';
      rules.forEach((rule, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';
        row.innerHTML = `
          <input type="checkbox" class="sar-enabled" ${rule.enabled ? 'checked' : ''} title="Enable this rule" />
          <input type="text" class="sar-type" value="${escAttr(rule.typeName)}" placeholder="Slot type name (exact)"
            style="flex:1; min-width:140px; background:var(--bg-elev); border:1px solid var(--border-hi);
                   color:var(--text-2); font-family:var(--mono); font-size:11px; border-radius:5px; padding:4px 8px;" />
          <span style="font-size:11px; color:var(--text-4);">≤</span>
          <input type="number" class="sar-threshold" value="${rule.threshold}" min="0" max="100"
            style="width:60px; background:var(--bg-elev); border:1px solid var(--border-hi); color:var(--text-2);
                   font-family:var(--mono); font-size:11px; border-radius:5px; padding:4px 6px;" />
          <span style="font-size:11px; color:var(--text-4);">slots</span>
          <button class="sar-delete ghost" style="padding:2px 8px; font-size:11px;" title="Remove rule">✕</button>
        `;
        row.querySelector('.sar-enabled').addEventListener('change', e => { rules[i].enabled = e.target.checked; save(); });
        row.querySelector('.sar-type').addEventListener('change', e => { rules[i].typeName = e.target.value.trim(); save(); });
        row.querySelector('.sar-threshold').addEventListener('change', e => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= 0) { rules[i].threshold = v; save(); }
        });
        row.querySelector('.sar-delete').addEventListener('click', () => {
          rules.splice(i, 1);
          save();
          renderRules();
        });
        container.appendChild(row);
      });
    }

    renderRules();

    addBtn.addEventListener('click', () => {
      rules.push({ id: Date.now().toString(36), typeName: '', threshold: 0, enabled: true });
      renderRules();
    });
  } catch (e) {
    console.warn('[Slot alerts init]', e.message);
  }
})();

// ── Submission thresholds ─────────────────────────────────────────────────────

(async function initSubmissionThresholds() {
  try {
    const DEFAULT_THRESHOLDS = {
      medical: { amber: 30, red: 60, enabled: false },
      admin:   { amber: 20, red: 40, enabled: false },
    };
    const LABELS = { medical: 'Medical requests', admin: 'Admin requests' };

    const grid    = document.getElementById('submissionThresholds');
    const saveBtn = document.getElementById('saveSubmissionThresholds');
    const status  = document.getElementById('submissionThresholdSaved');
    if (!grid || !saveBtn) return;

    const stored = await chrome.storage.local.get('submissions.thresholds');
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };

    grid.innerHTML = Object.entries(LABELS).map(([key, label]) => {
      const t = { ...DEFAULT_THRESHOLDS[key], ...(thresholds[key] || {}) };
      return `
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span style="font-family:var(--mono);font-size:10px;color:var(--text-2);min-width:110px">${label}</span>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-3)">
            <input type="checkbox" data-key="${key}" data-field="enabled" ${t.enabled ? 'checked' : ''}> Enabled
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-3)">
            Amber ≥ <input type="number" min="1" max="999" data-key="${key}" data-field="amber" value="${t.amber}"
              style="width:54px;background:var(--bg-elev);border:1px solid var(--border-hi);color:var(--text-2);font-family:var(--mono);font-size:10px;border-radius:5px;padding:2px 5px">
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-3)">
            Red ≥ <input type="number" min="1" max="999" data-key="${key}" data-field="red" value="${t.red}"
              style="width:54px;background:var(--bg-elev);border:1px solid var(--border-hi);color:var(--text-2);font-family:var(--mono);font-size:10px;border-radius:5px;padding:2px 5px">
          </label>
        </div>`;
    }).join('');

    saveBtn.addEventListener('click', async () => {
      const out = {};
      for (const key of Object.keys(LABELS)) {
        out[key] = {
          enabled: grid.querySelector(`[data-key="${key}"][data-field="enabled"]`)?.checked ?? false,
          amber:   parseInt(grid.querySelector(`[data-key="${key}"][data-field="amber"]`)?.value) || DEFAULT_THRESHOLDS[key].amber,
          red:     parseInt(grid.querySelector(`[data-key="${key}"][data-field="red"]`)?.value)   || DEFAULT_THRESHOLDS[key].red,
        };
      }
      await chrome.storage.local.set({ 'submissions.thresholds': out });
      if (status) { status.style.display = ''; setTimeout(() => { status.style.display = 'none'; }, 2000); }
    });
  } catch (e) {
    console.warn('[Submission thresholds init]', e.message);
  }
})();

// ── Update banner (v1.3.1) ────────────────────────────────────────────────────

(async function initUpdateBanner() {
  try {
    if (!window.UpdateChecker) return;
    const banner = document.getElementById('updateBanner');
    if (!banner) return;

    // Trigger a check (respects internal 23h cooldown — won't hammer GitHub)
    window.UpdateChecker.checkForUpdate().catch(() => {});

    async function render() {
      const state = await window.UpdateChecker.getState();
      const installed = window.UpdateChecker.getInstalledVersion();
      const available = state.latestVersion && installed && window.UpdateChecker.isNewer(state.latestVersion, installed);

      if (!available) {
        banner.style.display = 'none';
        return;
      }
      banner.style.display = 'block';
      const vEl = document.getElementById('updateBannerVersion');
      const iEl = document.getElementById('updateBannerInstalled');
      if (vEl) vEl.textContent = `v${state.latestVersion}`;
      if (iEl) iEl.textContent = `v${installed}`;
    }

    await render();

    // Re-render whenever the stored update state changes
    chrome.storage.onChanged.addListener(changes => {
      if (Object.keys(changes).some(k => k.startsWith('suite.update.'))) render();
    });

    // Buttons
    document.getElementById('updateBannerOpenBtn')?.addEventListener('click', async () => {
      const state = await window.UpdateChecker.getState();
      if (state.releaseUrl) chrome.tabs.create({ url: state.releaseUrl });
    });

    document.getElementById('updateBannerNotesBtn')?.addEventListener('click', async () => {
      const notesEl = document.getElementById('updateBannerNotes');
      if (!notesEl) return;
      if (notesEl.style.display === 'none') {
        const state = await window.UpdateChecker.getState();
        notesEl.textContent = state.releaseNotes || '(no release notes)';
        notesEl.style.display = 'block';
      } else {
        notesEl.style.display = 'none';
      }
    });
  } catch (e) {
    console.warn('[Update banner init]', e.message);
  }
})();
