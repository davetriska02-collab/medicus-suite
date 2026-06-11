// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Options page controller

'use strict';

// ── Apply display preferences (theme/size/colorblind) ─────────────────────────
(function applyDisplayPrefs() {
  function apply(prefs) {
    prefs = prefs || {};
    document.documentElement.setAttribute('data-theme', prefs.theme || 'light');
    document.documentElement.setAttribute('data-size', prefs.size || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!prefs.colorblind));
  }
  chrome.storage.local.get('suite.display', (r) => apply(r['suite.display'] || {}));
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['suite.display']) apply(changes['suite.display'].newValue || {});
  });
})();

// ── Inject current extension version into header badges ───────────────────────
// Both badges used to be hard-coded; they drifted out of sync with manifest.json
// and showed the install-time version of the page chrome forever.
(function injectVersionBadges() {
  try {
    const v = 'v' + chrome.runtime.getManifest().version;
    document.addEventListener('DOMContentLoaded', () => {
      const a = document.getElementById('suiteVersionBadge');
      const b = document.getElementById('debugVersionBadge');
      if (a) a.textContent = v;
      if (b) b.textContent = v;
    });
  } catch (_) {}
})();

// ── Helpers (hoisted to top so any subsequent code can use them) ──────────────

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

const CAP_WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function capDefaultMinimumByDay(legacyMin) {
  const m = legacyMin || 0;
  return { mon: m, tue: m, wed: m, thu: m, fri: m, sat: 0, sun: 0 };
}

function capPresetMinimumSummary(p) {
  const mins = p.minimumByDay;
  if (!mins) return `Min ${p.minimumPerDay || 0}/day`;
  const values = CAP_WEEKDAYS.map((d) => mins[d.key] || 0);
  const allSame = values.slice(0, 5).every((v) => v === values[0]);
  if (allSame && values[5] === 0 && values[6] === 0) return `Min ${values[0]}/weekday`;
  const wkTotal = values.reduce((a, b) => a + b, 0);
  return `Min ${wkTotal}/week`;
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.section;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.opt-section').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`sect-${target}`)?.classList.add('active');
  });
});

// ── Suite settings (practice code) ────────────────────────────────────────────

const practiceCodeInput = document.getElementById('practiceCode');
const feedbackEmailInput = document.getElementById('feedbackEmail');
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
      chrome.storage.local.get(['suite.practiceCode'], (res) => {
        practiceCodeInput.value = res['suite.practiceCode'] || '';
      });
    }
    // Load saved feedback recipient email
    if (feedbackEmailInput) {
      chrome.storage.local.get(['suite.feedbackEmail'], (res) => {
        feedbackEmailInput.value = res['suite.feedbackEmail'] || '';
      });
    }
    // Try to auto-detect from open Medicus tab
    let detected = null;
    try {
      const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
      for (const tab of tabs) {
        const m = tab.url && tab.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
        if (m?.[1]) {
          detected = m[1].toLowerCase();
          break;
        }
      }
    } catch (_) {}
    if (detected) {
      if (codeDetectedRow) codeDetectedRow.style.display = 'flex';
      if (codeDetectedValue) codeDetectedValue.textContent = detected;
      if (codeNotDetectedRow) codeNotDetectedRow.style.display = 'none';
    } else {
      if (codeDetectedRow) codeDetectedRow.style.display = 'none';
      if (codeNotDetectedRow) codeNotDetectedRow.style.display = 'block';
    }
  } catch (e) {
    console.warn('[Suite section init]', e.message);
  }
})();

saveSuiteBtn?.addEventListener('click', async () => {
  if (!practiceCodeInput) return;
  const code = practiceCodeInput.value.trim().toLowerCase();
  const { 'submissions.config': existingSubConfig = {} } = await chrome.storage.local.get('submissions.config');
  await chrome.storage.local.set({
    'suite.practiceCode': code,
    'submissions.config': { ...existingSubConfig, practiceCode: code },
    'suite.feedbackEmail': (feedbackEmailInput?.value || '').trim(),
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
      if (m?.[1]) {
        code = m[1].toLowerCase();
        break;
      }
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
      if (m?.[1]) {
        siteId = m[1].toLowerCase();
        break;
      }
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
      .map((t) => ({ id: t.label, name: t.label }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function renderPresetEditor() {
  if (!presetEditor) return;
  const { 'capacity.presets': presets = [] } = await chrome.storage.local.get('capacity.presets');

  if (availableTypes.length === 0) availableTypes = await loadAvailableTypes();

  presetEditor.innerHTML = `
    <div class="preset-list">
      ${
        presets.length === 0
          ? '<div style="color:var(--text-4);font-size:12px;padding:8px 0">No presets yet — create one below.</div>'
          : presets
              .map(
                (p) => `
        <div class="preset-card">
          <div class="preset-card-header">
            <div class="preset-card-name">${escHtml(p.name)}</div>
            <div class="preset-card-actions">
              <button class="pc-btn" data-edit="${escAttr(p.id)}">Edit</button>
              <button class="pc-btn danger" data-delete="${escAttr(p.id)}">Delete</button>
            </div>
          </div>
          <div class="preset-card-meta">
            <span>${capPresetMinimumSummary(p)}</span>
            <span>Tight at ${p.thresholds?.tight ?? 75}%</span>
            <span>Low at ${p.thresholds?.low ?? 50}%</span>
            <span>${p.slotTypes.length} slot type${p.slotTypes.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="preset-card-types">${escHtml(p.slotTypes.slice(0, 3).join(', '))}${p.slotTypes.length > 3 ? ` and ${p.slotTypes.length - 3} more` : ''}</div>
        </div>
      `
              )
              .join('')
      }
    </div>
    <button class="add-preset-btn" id="addPresetBtn">+ New preset</button>
  `;

  presetEditor
    .querySelectorAll('[data-edit]')
    .forEach((b) => b.addEventListener('click', () => openForm(b.dataset.edit)));
  presetEditor
    .querySelectorAll('[data-delete]')
    .forEach((b) => b.addEventListener('click', () => deletePreset(b.dataset.delete)));
  presetEditor.querySelector('#addPresetBtn')?.addEventListener('click', () => openForm(null));
}

async function openForm(presetId) {
  editingPresetId = presetId;
  const { 'capacity.presets': presets = [] } = await chrome.storage.local.get('capacity.presets');
  const editingRaw = presetId ? presets.find((p) => p.id === presetId) : null;
  const editing = editingRaw
    ? { ...editingRaw, minimumByDay: editingRaw.minimumByDay || capDefaultMinimumByDay(editingRaw.minimumPerDay) }
    : null;
  const p = editing || {
    name: '',
    slotTypes: [],
    minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 20, sat: 0, sun: 0 },
    thresholds: { tight: 75, low: 50 },
  };

  if (availableTypes.length === 0) {
    availableTypes = await loadAvailableTypes();
  }

  // Merge available types with any saved types not currently visible (so unknown saved types still show)
  const allTypeNames = new Set([...availableTypes.map((t) => t.name), ...p.slotTypes]);
  const sortedTypes = Array.from(allTypeNames).sort();

  const weekdayInputs = CAP_WEEKDAYS.map(
    (d) => `
    <div class="cap-day-min">
      <label class="cap-day-min-label">${d.label}</label>
      <input type="number" class="cap-day-min-input" data-day="${d.key}" value="${p.minimumByDay[d.key] ?? 0}" min="0" max="999" />
    </div>
  `
  ).join('');

  presetEditor.innerHTML = `
    <div class="preset-form">
      <h3>${editing ? 'Edit preset' : 'New preset'}</h3>
      <div class="form-row full">
        <label>Name</label>
        <input type="text" id="fName" value="${escAttr(p.name)}" placeholder="e.g. GP Routine" />
      </div>
      <div class="form-row full">
        <div class="cap-min-label-row">
          <label>Minimum free slots per weekday</label>
          <button type="button" class="cap-copy-mon" id="fCopyMon">Copy Mon to all weekdays</button>
        </div>
        <div class="cap-day-mins-row">${weekdayInputs}</div>
        <div class="cap-min-hint">Set 0 for days when no minimum applies (e.g. weekends, half-day clinics).</div>
      </div>
      <div class="form-row full">
        <label>Thresholds (% of minimum)</label>
        <div class="threshold-row">
          <span>Tight at</span>
          <input type="number" id="fTight" value="${p.thresholds?.tight ?? 75}" min="1" max="99" />
          <span>%, Low at</span>
          <input type="number" id="fLow" value="${p.thresholds?.low ?? 50}" min="1" max="99" />
          <span>%</span>
        </div>
      </div>
      <div class="form-row full">
        <label>Slot types (${p.slotTypes.length} selected)</label>
        <div class="types-multiselect" id="fTypes">
          ${
            sortedTypes.length === 0
              ? '<div style="color:var(--text-4);padding:8px;font-size:11px;font-family:var(--sans)">No slot types loaded. Set the practice code in Suite tab first.</div>'
              : sortedTypes
                  .map(
                    (t) => `
            <label class="type-check-row">
              <input type="checkbox" value="${escAttr(t)}" ${p.slotTypes.includes(t) ? 'checked' : ''} />
              <label>${escHtml(t)}</label>
            </label>
          `
                  )
                  .join('')
          }
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
  presetEditor.querySelector('#fCopyMon')?.addEventListener('click', () => {
    const monVal = presetEditor.querySelector('input[data-day="mon"]').value;
    ['tue', 'wed', 'thu', 'fri'].forEach((d) => {
      const el = presetEditor.querySelector(`input[data-day="${d}"]`);
      if (el) el.value = monVal;
    });
  });
}

async function savePreset(editing) {
  const name = presetEditor.querySelector('#fName').value.trim();
  const minimumByDay = {};
  CAP_WEEKDAYS.forEach((d) => {
    const el = presetEditor.querySelector(`input[data-day="${d.key}"]`);
    minimumByDay[d.key] = parseInt(el?.value, 10) || 0;
  });
  const tightRaw = parseInt(presetEditor.querySelector('#fTight').value, 10);
  const lowRaw = parseInt(presetEditor.querySelector('#fLow').value, 10);
  const tight = Number.isFinite(tightRaw) ? tightRaw : 75;
  const low = Number.isFinite(lowRaw) ? lowRaw : 50;
  const slotTypes = Array.from(presetEditor.querySelectorAll('#fTypes input[type=checkbox]:checked')).map(
    (i) => i.value
  );

  if (!name) {
    alert('Preset needs a name.');
    return;
  }
  if (slotTypes.length === 0) {
    alert('Select at least one slot type.');
    return;
  }
  if (tight < 0 || low < 0) {
    alert('Thresholds must be non-negative.');
    return;
  }
  if (low >= tight) {
    alert('Low threshold must be below Tight threshold.');
    return;
  }
  if (tight >= 100 || low >= 100) {
    alert('Thresholds must be below 100%.');
    return;
  }

  const { 'capacity.presets': presets = [] } = await chrome.storage.local.get('capacity.presets');

  const preset = editing
    ? { ...editing, name, slotTypes, minimumByDay, thresholds: { tight, low } }
    : {
        id: 'p_' + Math.random().toString(36).slice(2, 10),
        name,
        slotTypes,
        minimumByDay,
        thresholds: { tight, low },
        createdAt: new Date().toISOString(),
      };
  delete preset.minimumPerDay;

  const updated = editing ? presets.map((p) => (p.id === editing.id ? preset : p)) : [...presets, preset];

  await chrome.storage.local.set({ 'capacity.presets': updated });

  // Set as active if it's the first one
  if (!editing && updated.length === 1) {
    await chrome.storage.local.set({ 'capacity.activePresetId': preset.id });
  }

  renderPresetEditor();
}

async function deletePreset(presetId) {
  if (!confirm('Delete this preset?')) return;
  const { 'capacity.presets': presets = [], 'capacity.activePresetId': activeId } = await chrome.storage.local.get([
    'capacity.presets',
    'capacity.activePresetId',
  ]);
  const updated = presets.filter((p) => p.id !== presetId);
  const newActive = activeId === presetId ? updated[0]?.id || null : activeId;
  await chrome.storage.local.set({ 'capacity.presets': updated, 'capacity.activePresetId': newActive });
  renderPresetEditor();
}

// Render editor when Capacity tab is opened
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.section === 'capacity') renderPresetEditor();
  });
});

// ── Phase 2: Backup & Restore ─────────────────────────────────────────────────
// Uses SuiteEnvelope from shared/io/suite-envelope.js (loaded as a script tag).
// IO functions are inlined here to avoid ES module issues in options pages.

// --- Backup helpers — delegate to per-module IO files (loaded in options.html).
//     See shared/io/suite-envelope.js for the convention: when you add a new
//     storage key, update the relevant shared/io/<module>-io.js only. ---

async function doFullExport() {
  const [
    sentinel,
    capacity,
    triage,
    triageAlerts,
    slots,
    submissions,
    popout,
    referrals,
    requestMonitor,
    condor,
    reception,
    knowledge,
    rxmargin,
  ] = await Promise.all([
    sentinelExport(),
    capacityExport(),
    triageExport(),
    TriageAlertIO.exportData(),
    slotCounterExport(),
    submissionsExport(),
    popoutExport(),
    referralsExport(),
    requestMonitorExport(),
    condorExport(),
    receptionExport(),
    knowledgeExport(),
    rxmarginExport(),
  ]);
  const suite = await suiteExport();
  return window.SuiteEnvelope.wrap('suite', {
    sentinel,
    capacity,
    triage,
    triageAlerts,
    slots,
    submissions,
    popout,
    referrals,
    requestMonitor,
    condor,
    reception,
    knowledge,
    rxmargin,
    suite,
  });
}

async function doModuleExport(scope) {
  const exporters = {
    sentinel: () => sentinelExport(),
    capacity: () => capacityExport(),
    triage: () => triageExport(),
    triageAlerts: () => TriageAlertIO.exportData(),
    slots: () => slotCounterExport(),
    submissions: () => submissionsExport(),
    popout: () => popoutExport(),
    referrals: () => referralsExport(),
    requestMonitor: () => requestMonitorExport(),
    condor: () => condorExport(),
    reception: () => receptionExport(),
    knowledge: () => knowledgeExport(),
    rxmargin: () => rxmarginExport(),
  };
  if (!exporters[scope]) throw new Error('Unknown scope: ' + scope);
  const data = await exporters[scope]();
  return window.SuiteEnvelope.wrap(scope, { [scope]: data });
}

async function applyEnvelope(envelope) {
  const mods = envelope.modules || {};
  // Build task list in the same order as doFullExport to make auditing straightforward.
  // Only include modules that are present in this backup (same mods.X && gating).
  // applyWithRollback runs them sequentially; if any throws, all writes are rolled back.
  const tasks = [
    mods.sentinel && (() => sentinelImport(mods.sentinel)),
    mods.capacity && (() => capacityImport(mods.capacity)),
    mods.triage && (() => triageImport(mods.triage)),
    mods.triageAlerts && (() => TriageAlertIO.importData(mods.triageAlerts)),
    mods.slots && (() => slotCounterImport(mods.slots)),
    mods.submissions && (() => submissionsImport(mods.submissions)),
    mods.popout && (() => popoutImport(mods.popout)),
    mods.referrals && (() => referralsImport(mods.referrals)),
    mods.requestMonitor && (() => requestMonitorImport(mods.requestMonitor)),
    mods.condor && (() => condorImport(mods.condor)),
    mods.reception && (() => receptionImport(mods.reception)),
    mods.knowledge && (() => knowledgeImport(mods.knowledge)),
    mods.rxmargin && (() => rxmarginImport(mods.rxmargin)),
    mods.suite && (() => suiteImport(mods.suite)),
  ].filter(Boolean);
  await window.SuiteEnvelope.applyWithRollback(tasks);
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setBackupStatus(msg, isError) {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ef4444' : '#4ade80';
  setTimeout(() => {
    el.textContent = '';
  }, 4000);
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
  const MAX_BACKUP_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_BACKUP_BYTES) {
    setBackupStatus('Backup file is too large (max 10 MB). Import cancelled.', true);
    return;
  }
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const { valid, errors, warnings, envelope } = window.SuiteEnvelope.unwrap(raw);
    if (!valid) {
      setBackupStatus('Invalid backup: ' + errors.join('; '), true);
      return;
    }
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
    setBackupStatus('Restore complete — reloading settings page…');
    setTimeout(() => window.location.reload(), 1500);
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
document.querySelectorAll('[data-mod-export]').forEach((btn) => {
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

document.querySelectorAll('[data-mod-import]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const scope = btn.dataset.modImport;
    const fileInput = btn.closest('.module-export-card')?.querySelector('.mod-file-input[data-mod="' + scope + '"]');
    fileInput?.click();
  });
});

document.querySelectorAll('.mod-file-input').forEach((input) => {
  input.addEventListener('change', async (e) => {
    const scope = input.dataset.mod;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { valid, errors, warnings, envelope } = window.SuiteEnvelope.unwrap(raw, scope);
      if (!valid) {
        setBackupStatus('Invalid file: ' + errors.join('; '), true);
        return;
      }
      const lines = window.SuiteEnvelope.previewEnvelope(envelope);
      const msg = `Import ${scope}?\n\n${lines.join('\n')}${warnings.length ? '\n\nWarnings:\n' + warnings.join('\n') : ''}`;
      if (!confirm(msg)) return;
      await applyEnvelope(envelope);
      setBackupStatus(`${scope} restored — reloading settings page…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setBackupStatus('Import failed: ' + err.message, true);
    }
  });
});

// ── Practice Profile (v3.0) ──────────────────────────────────────────────────

(async function initPracticeProfileSection() {
  try {
    if (!window.PracticeProfile) return;

    const statusBlock = document.getElementById('ppStatusBlock');
    const badge = document.getElementById('ppBadge');
    const checkBtn = document.getElementById('ppCheckBtn');
    const applyBtn = document.getElementById('ppApplyBtn');
    const actionStatus = document.getElementById('ppActionStatus');
    const publishBtn = document.getElementById('ppPublishBtn');
    const publishStatus = document.getElementById('ppPublishStatus');
    const labelInput = document.getElementById('ppLabelInput');
    const publishedByInput = document.getElementById('ppPublishedByInput');
    const modulePicker = document.getElementById('ppModulePicker');

    if (!statusBlock) return;

    let _profile = null;

    // ── Module picker definition ──────────────────────────────────────────────
    const PUBLISHER_KEY = 'suite.practiceProfile.publisher';

    const MODULE_DEFS = [
      {
        id: 'knowledge',
        label: 'Knowledge',
        defaultChecked: true,
        defaultMode: 'replace',
        desc: 'The Knowledge tab — referral criteria, contacts, local pathways',
      },
      {
        id: 'sentinel',
        label: 'Sentinel',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Monitoring rules and custom rules',
      },
      {
        id: 'reception',
        label: 'Reception',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Reception capture pathways and which ones are enabled',
      },
      {
        id: 'triage',
        label: 'Triage Lens',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Triage Lens settings, custom rules and thresholds',
      },
      {
        id: 'triageAlerts',
        label: 'Triage Capacity Alerts',
        defaultChecked: false,
        defaultMode: 'merge',
        desc: 'Capacity-based triage alert rules',
      },
      {
        id: 'slots',
        label: 'Slot Counter',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Slot counter hidden types and alert rules',
      },
      {
        id: 'submissions',
        label: 'Submissions Tracker',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Submissions config and thresholds',
      },
      {
        id: 'capacity',
        label: 'Capacity Forecast',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Capacity forecast presets',
      },
      {
        id: 'referrals',
        label: 'Referrals',
        defaultChecked: false,
        defaultMode: 'merge',
        desc: 'Referrals tracker config (not locally discovered data)',
      },
      {
        id: 'requestMonitor',
        label: 'Request Monitor',
        defaultChecked: false,
        defaultMode: 'merge',
        desc: 'Request monitor config and assignee',
      },
      {
        id: 'suite',
        label: 'Practice code &amp; feedback email',
        defaultChecked: true,
        defaultMode: 'merge',
        desc: 'Practice code and feedback email only — never personal display prefs',
      },
    ];

    // ── IndexedDB helpers for FileSystemFileHandle persistence ───────────────

    function openHandleDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('medicus-suite-pp', 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });
    }

    async function loadFileHandle() {
      try {
        const db = await openHandleDB();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('handles', 'readonly');
          const req = tx.objectStore('handles').get('profileFile');
          req.onsuccess = (e) => resolve(e.target.result || null);
          req.onerror = (e) => reject(e.target.error);
        });
      } catch (_) {
        return null;
      }
    }

    async function saveFileHandle(handle) {
      try {
        const db = await openHandleDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('handles', 'readwrite');
          const req = tx.objectStore('handles').put(handle, 'profileFile');
          req.onsuccess = () => resolve();
          req.onerror = (e) => reject(e.target.error);
        });
      } catch (_) {}
    }

    // ── Status helpers ────────────────────────────────────────────────────────

    function setPPStatus(msg, isError = false) {
      if (!actionStatus) return;
      actionStatus.textContent = msg;
      actionStatus.style.color = isError ? '#ef4444' : 'var(--text-3)';
      if (msg)
        setTimeout(() => {
          if (actionStatus.textContent === msg) actionStatus.textContent = '';
        }, 4000);
    }

    function setPublishStatus(msg, isError = false) {
      if (!publishStatus) return;
      publishStatus.textContent = msg;
      publishStatus.style.color = isError ? '#ef4444' : 'var(--text-3)';
      if (msg)
        setTimeout(() => {
          if (publishStatus.textContent === msg) publishStatus.textContent = '';
        }, 6000);
    }

    // ── Render status block ───────────────────────────────────────────────────

    async function render() {
      _profile = await window.PracticeProfile.fetchProfile();
      const stored = await window.PracticeProfile.getStatus();

      if (!_profile) {
        statusBlock.innerHTML =
          `<span style="color:var(--text-3);">No <code>practice-profile.json</code> found in the extension folder.</span><br>` +
          `<span style="font-size:11px; color:var(--text-3);">Use <em>Publish to shared folder</em> below to create one. ` +
          `See the setup guide for first-time instructions.</span>`;
        if (badge) badge.style.display = 'none';
        if (applyBtn) applyBtn.style.display = 'none';
        return;
      }

      const incomingVersion = _profile.profileVersion;
      const currentVersion = stored?.lastAppliedVersion;
      const hasUpdate = currentVersion !== incomingVersion;
      const appliedAt = stored?.lastAppliedAt ? new Date(stored.lastAppliedAt).toLocaleString() : null;
      const autoApply = _profile.apply?.autoApplyOnStartup !== false;

      let html =
        `<div><strong>Profile found:</strong> ${escHtml(_profile.profileLabel || '(no label)')}</div>` +
        `<div><strong>Version in folder:</strong> <code style="font-family:var(--mono);font-size:11px">${escHtml(incomingVersion)}</code></div>` +
        `<div><strong>Auto-apply on startup:</strong> ${autoApply ? 'yes' : 'no'}</div>`;

      if (stored?.lastAppliedVersion) {
        html +=
          `<div style="margin-top:4px;"><strong>Last applied:</strong> ` +
          `<code style="font-family:var(--mono);font-size:11px">${escHtml(stored.lastAppliedVersion)}</code>` +
          ` on ${escHtml(appliedAt || '—')}` +
          `</div>`;
      } else {
        html += `<div style="margin-top:4px; color:var(--text-3);">Not yet applied on this install.</div>`;
      }

      if (stored?.lastCheckedAt) {
        html += `<div style="margin-top:4px; font-size:11px; color:var(--text-3);">This PC last looked for profile updates at ${escHtml(new Date(stored.lastCheckedAt).toLocaleString())}.</div>`;
      }

      if (hasUpdate) {
        html += `<div style="margin-top:6px; color:var(--accent); font-weight:500;">&#8593; A newer version is ready to apply.</div>`;
      }

      statusBlock.innerHTML = html;
      if (badge) badge.style.display = hasUpdate ? '' : 'none';
      if (applyBtn) applyBtn.style.display = hasUpdate || !stored?.lastAppliedVersion ? '' : 'none';
    }

    // ── Build module picker rows ──────────────────────────────────────────────

    async function buildModulePicker() {
      if (!modulePicker) return;

      // Load persisted publisher state
      let saved = {};
      try {
        const r = await chrome.storage.local.get(PUBLISHER_KEY);
        saved = r[PUBLISHER_KEY] || {};
      } catch (_) {}

      // Pre-fill label and publishedBy
      if (labelInput) {
        const existingLabel = _profile?.profileLabel || saved.label || '';
        labelInput.value = existingLabel;
      }
      if (publishedByInput) {
        let byVal = saved.publishedBy || _profile?.publishedBy || '';
        if (!byVal) {
          try {
            const r = await chrome.storage.local.get('suite.feedbackEmail');
            byVal = r['suite.feedbackEmail'] || '';
          } catch (_) {}
        }
        publishedByInput.value = byVal;
      }

      modulePicker.innerHTML = '';

      for (const mod of MODULE_DEFS) {
        const savedMod = (saved.modules || {})[mod.id] || {};
        const isChecked = savedMod.checked !== undefined ? savedMod.checked : mod.defaultChecked;
        const modeVal = savedMod.mode !== undefined ? savedMod.mode : mod.defaultMode;

        const row = document.createElement('div');
        row.style.cssText =
          'display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:4px; background:var(--bg-mid);';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = `ppMod_${mod.id}`;
        chk.checked = isChecked;
        chk.style.cssText = 'width:14px; height:14px; flex-shrink:0; cursor:pointer;';

        const lbl = document.createElement('label');
        lbl.htmlFor = `ppMod_${mod.id}`;
        lbl.innerHTML = `<span style="font-weight:500; color:var(--text-1);">${mod.label}</span> <span style="color:var(--text-3);">— ${escHtml(mod.desc)}</span>`;
        lbl.style.cssText = 'flex:1; cursor:pointer; line-height:1.4;';

        const sel = document.createElement('select');
        sel.id = `ppModMode_${mod.id}`;
        sel.style.cssText =
          'font-size:10px; padding:2px 4px; border:1px solid var(--border); border-radius:4px; background:var(--bg-elev); color:var(--text-1); cursor:pointer;';
        const optMerge = document.createElement('option');
        optMerge.value = 'merge';
        optMerge.textContent = 'Fill gaps only (merge)';
        const optReplace = document.createElement('option');
        optReplace.value = 'replace';
        optReplace.textContent = 'Enforce for everyone (replace)';
        sel.appendChild(optMerge);
        sel.appendChild(optReplace);
        sel.value = modeVal;

        row.appendChild(chk);
        row.appendChild(lbl);
        row.appendChild(sel);
        modulePicker.appendChild(row);
      }
    }

    // ── Persist picker state ──────────────────────────────────────────────────

    async function savePickerState() {
      const modules = {};
      for (const mod of MODULE_DEFS) {
        const chk = document.getElementById(`ppMod_${mod.id}`);
        const sel = document.getElementById(`ppModMode_${mod.id}`);
        modules[mod.id] = {
          checked: chk ? chk.checked : mod.defaultChecked,
          mode: sel ? sel.value : mod.defaultMode,
        };
      }
      const state = {
        label: labelInput?.value || '',
        publishedBy: publishedByInput?.value || '',
        modules,
      };
      try {
        await chrome.storage.local.set({ [PUBLISHER_KEY]: state });
      } catch (_) {}
    }

    // ── Version auto-bump ─────────────────────────────────────────────────────

    async function nextProfileVersion() {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      try {
        const existing = await window.PracticeProfile.fetchProfile();
        if (existing && existing.profileVersion) {
          const m = existing.profileVersion.match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/);
          if (m && m[1] === today) {
            return `${today}.${parseInt(m[2], 10) + 1}`;
          }
        }
      } catch (_) {}
      return `${today}.1`;
    }

    // ── Write to file helper ──────────────────────────────────────────────────

    async function writeProfileToHandle(handle, json) {
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    }

    // ── Publish handler ───────────────────────────────────────────────────────

    async function doPublish() {
      if (!publishBtn) return;
      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing…';

      try {
        await savePickerState();

        const label = labelInput?.value?.trim() || 'Practice defaults';
        const publishedBy = publishedByInput?.value?.trim() || '';
        const version = await nextProfileVersion();

        // Build apply.modules map
        const applyModules = {};
        for (const mod of MODULE_DEFS) {
          const chk = document.getElementById(`ppMod_${mod.id}`);
          const sel = document.getElementById(`ppModMode_${mod.id}`);
          if (chk && chk.checked) {
            applyModules[mod.id] = sel && sel.value === 'replace' ? 'replace' : 'merge';
          }
        }

        const envelope = await doFullExport();

        const profileJson = {
          format: 'medicus-suite-practice-profile',
          formatVersion: 2,
          profileVersion: version,
          profileLabel: label,
          publishedAt: new Date().toISOString(),
          publishedBy: publishedBy,
          apply: {
            modules: applyModules,
            autoApplyOnStartup: true,
            checkEveryMinutes: 15,
            autoReloadOnNewVersion: true,
            notifyUserOnApply: false,
          },
          envelope,
        };

        const jsonStr = JSON.stringify(profileJson, null, 2);

        // Try remembered handle first
        let usedHandle = null;
        if (typeof showSaveFilePicker === 'function') {
          const remembered = await loadFileHandle();
          if (remembered) {
            try {
              let perm = await remembered.queryPermission({ mode: 'readwrite' });
              if (perm !== 'granted') {
                perm = await remembered.requestPermission({ mode: 'readwrite' });
              }
              if (perm === 'granted') {
                await writeProfileToHandle(remembered, jsonStr);
                usedHandle = remembered;
                setPublishStatus(
                  `Published v${version} to ${remembered.name}. Other PCs will pick it up within about 15 minutes, or on their next browser start.`
                );
              }
            } catch (_) {
              // Permission denied or stale handle — fall through to picker
            }
          }

          if (!usedHandle) {
            // Show save picker
            let handle;
            try {
              handle = await showSaveFilePicker({
                suggestedName: 'practice-profile.json',
                types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
              });
            } catch (err) {
              if (err && err.name === 'AbortError') {
                setPublishStatus('Publish cancelled.');
                return;
              }
              throw err;
            }
            await writeProfileToHandle(handle, jsonStr);
            await saveFileHandle(handle);
            usedHandle = handle;
            setPublishStatus(
              `Published v${version}. Other PCs will pick it up within about 15 minutes, or on their next browser start.`
            );
          }
        } else {
          // Fallback: download via blob
          downloadJson(profileJson, 'practice-profile.json');
          setPublishStatus(
            `Profile downloaded as practice-profile.json (v${version}). Move it into the shared extension folder, replacing the old file, and the update will reach everyone within 15 minutes.`
          );
        }

        await render();
      } catch (e) {
        setPublishStatus('Publish failed: ' + e.message, true);
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = 'Publish to shared folder';
      }
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    await render();
    await buildModulePicker();

    checkBtn?.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
      await render();
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for update';
      if (!_profile) {
        setPPStatus('No practice-profile.json found in the extension folder.');
      } else {
        const stored = await window.PracticeProfile.getStatus();
        setPPStatus(
          stored?.lastAppliedVersion === _profile.profileVersion
            ? 'Up to date.'
            : 'New version available — click Apply now.'
        );
      }
    });

    applyBtn?.addEventListener('click', async () => {
      if (!_profile) return;
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';
      try {
        const result = await window.PracticeProfile.applyProfile(_profile, { force: true });
        if (result.skipped) {
          setPPStatus('Nothing to apply.');
        } else {
          const mods = (result.modulesApplied || []).join(', ') || 'no modules changed';
          setPPStatus(`Applied successfully — ${mods}.`);
        }
        await render();
      } catch (e) {
        setPPStatus('Apply failed: ' + e.message, true);
      }
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply now';
    });

    publishBtn?.addEventListener('click', doPublish);
  } catch (e) {
    console.warn('[Practice Profile section]', e.message);
  }
})();

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
  let tabCode = null,
    storageCode = null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    for (const t of tabs) {
      const m = t.url && t.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (m?.[1]) {
        tabCode = m[1].toLowerCase();
        break;
      }
    }
    lines.push(`Open Medicus tabs: ${tabs.length}`);
    tabs.forEach((t) => lines.push(`  - ${t.url}`));
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
    if (subCode)
      lines.push(`Submissions config code: ${subCode}${subCode !== (tabCode || storageCode) ? ' ⚠ MISMATCH' : ''}`);
  } catch (_) {}

  lines.push('');
  lines.push('--- Recent API calls (newest first) ---');
  const entries = window.ApiDiag?.getEntries() || [];
  if (entries.length === 0) {
    lines.push('(no API calls recorded — open the side panel or popup to trigger one)');
  } else {
    entries.slice(0, 20).forEach((e) => {
      const t = e.ts.slice(11, 19);
      const tag = e.ok ? 'OK ' : 'ERR';
      lines.push(
        `${t} ${tag} [${e.module}] status=${e.status ?? '-'} code=${e.code || '-'} src=${e.codeSource || '-'}`
      );
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
    if (s) {
      s.textContent = 'Copied ✓';
      setTimeout(() => (s.textContent = ''), 2000);
    }
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
    results.innerHTML = lines.map((l) => `<div>${l.replace(/</g, '&lt;')}</div>`).join('');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const probes = [
    {
      name: 'Waiting room',
      url: `https://${code}.api.england.medicus.health/scheduling/data/homepage/my-appointments`,
    },
    {
      name: 'Appointment book',
      url: `https://${code}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false`,
    },
    {
      name: 'Task list (admin)',
      url: `https://${code}.api.england.medicus.health/tasks/data/admin/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`,
    },
  ];

  results.innerHTML = lines.map((l) => `<div>${l.replace(/</g, '&lt;')}</div>`).join('');
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
document.querySelectorAll('.nav-item[data-section="debug"]').forEach((btn) => {
  btn.addEventListener('click', refreshDebugState);
});

// ── Rules currency status card (Monitoring section) ───────────────────────────
// Fetches the four bundled rule files and renders a per-file age/status table.
// Triggered on load (sentinel section may be active) and when the tab is opened.

(async function initRulesCurrencyCard() {
  const bodyEl = document.getElementById('rulesCurrencyBody');
  const overallEl = document.getElementById('rulesCurrencyOverall');
  if (!bodyEl) return;

  async function loadRulesCurrency() {
    if (!window.RuleCurrency) {
      bodyEl.textContent = 'Rule currency helper not available.';
      return;
    }
    try {
      const base = chrome.runtime.getURL('rules/');
      const [drug, qof, vax, alert, reception] = await Promise.all([
        fetch(base + 'drug-rules.json').then((r) => r.json()),
        fetch(base + 'qof-rules.json').then((r) => r.json()),
        fetch(base + 'vaccine-rules.json').then((r) => r.json()),
        fetch(base + 'alert-library.json').then((r) => r.json()),
        fetch(base + 'reception-pathways.json').then((r) => r.json()),
      ]);

      const files = [
        {
          id: 'drug',
          lastUpdated: drug.lastUpdated,
          specVersion: drug.specVersion,
          displayName: 'Drug monitoring rules',
        },
        { id: 'qof', lastUpdated: qof.lastUpdated, specVersion: qof.specVersion, displayName: 'QOF rules' },
        { id: 'vaccine', lastUpdated: vax.lastUpdated, specVersion: vax.specVersion, displayName: 'Vaccine rules' },
        { id: 'alert', lastUpdated: alert.lastUpdated, specVersion: alert.specVersion, displayName: 'Alert library' },
        {
          id: 'reception',
          lastUpdated: reception.lastUpdated,
          specVersion: reception.specVersion,
          displayName: 'Reception capture pathways',
        },
      ];

      const today = new Date().toISOString().slice(0, 10);
      const result = window.RuleCurrency.assessRuleCurrency(files, today);

      // Overall badge
      if (overallEl) {
        overallEl.style.display = '';
        if (result.overall === 'red') {
          overallEl.textContent = 'Needs urgent review';
          overallEl.style.background = 'rgba(212,53,28,0.12)';
          overallEl.style.color = 'var(--red, #d4351c)';
        } else if (result.overall === 'amber') {
          overallEl.textContent = 'Needs review';
          overallEl.style.background = 'rgba(180,83,9,0.15)';
          overallEl.style.color = 'var(--amber, #b45309)';
        } else {
          overallEl.textContent = 'Current';
          overallEl.style.background = 'rgba(22,163,74,0.12)';
          overallEl.style.color = 'var(--green, #16a34a)';
        }
      }

      // File rows
      const FILE_NAMES = {
        drug: 'Drug monitoring rules',
        qof: 'QOF rules',
        vaccine: 'Vaccine rules',
        alert: 'Alert library',
      };
      const rows = result.files
        .map((f, i) => {
          const displayName = files[i].displayName || FILE_NAMES[f.id] || f.id;
          const levelColour =
            f.level === 'red'
              ? 'var(--red, #d4351c)'
              : f.level === 'amber'
                ? 'var(--amber, #b45309)'
                : 'var(--green, #16a34a)';
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${levelColour};margin-right:6px;vertical-align:middle;flex-shrink:0;"></span>`;
          const ageStr = f.ageDays != null ? `${f.ageDays}d ago` : 'age unknown';
          const specStr = f.specVersion ? escHtml(f.specVersion) : '<em style="color:var(--text-5)">none</em>';
          const msgColour = f.level === 'red' ? 'var(--red,#d4351c)' : 'var(--amber,#b45309)';
          const msgHtml = f.message
            ? `<div style="font-size:11px;color:${msgColour};margin-top:2px;">${escHtml(f.message)}</div>`
            : '';
          return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-top:1px solid var(--border);">
          <div style="flex-shrink:0;padding-top:2px;">${dot}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:500;color:var(--text-2);">${escHtml(displayName)}</div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--text-4);margin-top:1px;">${specStr} &middot; ${escHtml(f.lastUpdated || 'unknown')} (${ageStr})</div>
            ${msgHtml}
          </div>
        </div>`;
        })
        .join('');

      // Warnings summary
      const hasRedFile = result.files.some((f) => f.level === 'red');
      const warnBg = hasRedFile ? 'rgba(212,53,28,0.08)' : 'rgba(180,83,9,0.08)';
      const warnBdr = hasRedFile ? 'rgba(212,53,28,0.3)' : 'rgba(180,83,9,0.3)';
      const warnClr = hasRedFile ? 'var(--red,#d4351c)' : 'var(--amber,#b45309)';
      const warnHtml = result.warnings.length
        ? `<div style="margin-top:10px;padding:8px 10px;background:${warnBg};border:1px solid ${warnBdr};border-radius:6px;font-size:11px;color:${warnClr};">${result.warnings.map((w) => escHtml(w)).join('<br>')}</div>`
        : '';

      bodyEl.innerHTML = `<div style="margin:-4px 0;">${rows}</div>${warnHtml}`;
    } catch (err) {
      bodyEl.textContent = 'Could not load rule file metadata: ' + err.message;
    }
  }

  // Load on DOMContentLoaded (or immediately if already done)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRulesCurrency);
  } else {
    loadRulesCurrency();
  }

  // Also refresh when the sentinel section is navigated to
  document.querySelectorAll('.nav-item[data-section="sentinel"]').forEach((btn) => {
    btn.addEventListener('click', loadRulesCurrency);
  });
})();

// ── Request Monitor (v1.3) ────────────────────────────────────────────────────

const rmEnabled = document.getElementById('rmEnabled');
const rmAssigneeId = document.getElementById('rmAssigneeId');
const rmPollSeconds = document.getElementById('rmPollSeconds');
const rmNotifyEnabled = document.getElementById('rmNotifyEnabled');
const rmNotifySound = document.getElementById('rmNotifySound');
const rmConditional = document.getElementById('rmConditionalFields');
const rmSaveBtn = document.getElementById('saveRm');
const rmSavedTag = document.getElementById('rmSaved');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toggleRmConditional() {
  if (!rmConditional || !rmEnabled) return;
  rmConditional.style.display = rmEnabled.checked ? 'block' : 'none';
}

(async function initRmSection() {
  try {
    if (!window.RequestMonitor) return;
    const cfg = await window.RequestMonitor.getConfig();
    if (rmEnabled) rmEnabled.checked = !!cfg.enabled;
    if (rmAssigneeId) rmAssigneeId.value = cfg.assigneeId || '';
    if (rmPollSeconds) rmPollSeconds.value = cfg.pollSeconds || 60;
    if (rmNotifyEnabled) rmNotifyEnabled.checked = !!cfg.notifyEnabled;
    if (rmNotifySound) rmNotifySound.checked = !!cfg.notifySound;
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
      setTimeout(() => {
        rmSavedTag.classList.remove('show');
        rmSavedTag.textContent = 'Saved ✓';
        rmSavedTag.style.color = '';
      }, 3000);
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
    notifySound: !!rmNotifySound?.checked,
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
      container.innerHTML = rules
        .map(
          (rule, i) => `
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
      `
        )
        .join('');

      container.querySelectorAll('.ta-enabled').forEach((cb) => {
        cb.addEventListener('change', () => {
          rules[+cb.dataset.i].enabled = cb.checked;
        });
      });
      container.querySelectorAll('.ta-threshold').forEach((inp) => {
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
      if (tag) {
        tag.classList.add('show');
        setTimeout(() => tag.classList.remove('show'), 2000);
      }
    });
  } catch (e) {
    console.warn('[Triage alerts init]', e.message);
  }
})();

// ── Slot alert rules ──────────────────────────────────────────────────────────

(async function initSlotAlerts() {
  try {
    const container = document.getElementById('slotAlertRules');
    const addBtn = document.getElementById('addSlotAlertRule');
    const savedTag = document.getElementById('slotAlertSaved');
    if (!container || !addBtn) return;

    const r = await chrome.storage.local.get('slots.alertRules');
    let rules = r['slots.alertRules'] ?? [];

    function save() {
      chrome.storage.local.set({ 'slots.alertRules': rules });
      if (savedTag) {
        savedTag.classList.add('show');
        setTimeout(() => savedTag.classList.remove('show'), 2000);
      }
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
        row.querySelector('.sar-enabled').addEventListener('change', (e) => {
          rules[i].enabled = e.target.checked;
          save();
        });
        row.querySelector('.sar-type').addEventListener('change', (e) => {
          rules[i].typeName = e.target.value.trim();
          save();
        });
        row.querySelector('.sar-threshold').addEventListener('change', (e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= 0) {
            rules[i].threshold = v;
            save();
          }
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
      admin: { amber: 20, red: 40, enabled: false },
    };
    const LABELS = { medical: 'Medical requests', admin: 'Admin requests' };

    const grid = document.getElementById('submissionThresholds');
    const saveBtn = document.getElementById('saveSubmissionThresholds');
    const status = document.getElementById('submissionThresholdSaved');
    if (!grid || !saveBtn) return;

    const stored = await chrome.storage.local.get('submissions.thresholds');
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };

    grid.innerHTML = Object.entries(LABELS)
      .map(([key, label]) => {
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
      })
      .join('');

    saveBtn.addEventListener('click', async () => {
      const out = {};
      for (const key of Object.keys(LABELS)) {
        out[key] = {
          enabled: grid.querySelector(`[data-key="${key}"][data-field="enabled"]`)?.checked ?? false,
          amber:
            parseInt(grid.querySelector(`[data-key="${key}"][data-field="amber"]`)?.value) ||
            DEFAULT_THRESHOLDS[key].amber,
          red:
            parseInt(grid.querySelector(`[data-key="${key}"][data-field="red"]`)?.value) || DEFAULT_THRESHOLDS[key].red,
        };
      }
      await chrome.storage.local.set({ 'submissions.thresholds': out });
      if (status) {
        status.style.display = '';
        setTimeout(() => {
          status.style.display = 'none';
        }, 2000);
      }
    });
  } catch (e) {
    console.warn('[Submission thresholds init]', e.message);
  }
})();

// ── Manual update check button (v3.0) ─────────────────────────────────────────

(function initManualUpdateCheck() {
  const btn = document.getElementById('checkUpdateBtn');
  const result = document.getElementById('checkUpdateResult');
  if (!btn || !window.UpdateChecker) return;

  function formatTimeAgo(ts) {
    if (!ts) return 'never';
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  async function setIdleStatus() {
    const state = await window.UpdateChecker.getState();
    const installed = window.UpdateChecker.getInstalledVersion();
    if (!result) return;
    if (state.error) {
      result.textContent = `Last check failed: ${state.error}`;
      result.style.color = '#f59e0b';
      return;
    }
    if (!state.latestVersion) {
      result.textContent = 'Not checked yet';
      result.style.color = '';
      return;
    }
    const newer = window.UpdateChecker.isNewer(state.latestVersion, installed);
    if (newer) {
      result.textContent = `Update available: v${state.latestVersion} (you have v${installed}) · checked ${formatTimeAgo(state.checkedAt)}`;
      result.style.color = '#4ade80';
    } else {
      result.textContent = `Up to date (v${installed}) · checked ${formatTimeAgo(state.checkedAt)}`;
      result.style.color = 'var(--text-3)';
    }
  }

  setIdleStatus();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Checking…';
    if (result) {
      result.textContent = 'Contacting GitHub…';
      result.style.color = 'var(--text-3)';
    }
    try {
      const res = await window.UpdateChecker.checkForUpdate({ force: true });
      if (!res.ok) {
        if (result) {
          result.textContent = `Check failed: ${res.error}`;
          result.style.color = '#ef4444';
        }
      } else {
        await setIdleStatus();
      }
    } catch (e) {
      if (result) {
        result.textContent = `Check failed: ${e.message}`;
        result.style.color = '#ef4444';
      }
    }
    btn.disabled = false;
    btn.textContent = originalText;
  });
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
      const available =
        state.latestVersion && installed && window.UpdateChecker.isNewer(state.latestVersion, installed);

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
    chrome.storage.onChanged.addListener((changes) => {
      if (Object.keys(changes).some((k) => k.startsWith('suite.update.'))) render();
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

// ── Reception section ─────────────────────────────────────────────────────────
// Pathway enable/disable (disclaimer-gated, all OFF by default), pathway
// editor (bundled edits → reception.pathwayOverrides; practice-authored →
// reception.customPathways), and the quick-wins chip filter
// (reception.config.hiddenChipRules). Validation/sanitisation delegates to
// shared/reception-pathway-utils.js — the same code path the backup import
// uses, so nothing invalid can reach storage from either direction.

(function initReceptionSection() {
  const PU = window.ReceptionPathwayUtils;
  const $ = (id) => document.getElementById(id);
  if (!$('rcpoPathwayList') || !PU) return;

  const DISCLAIMER_HTML = `
    <div style="border:1px solid rgba(180,83,9,0.45); background:rgba(180,83,9,0.07); border-radius:8px; padding:12px 14px; font-size:12px; line-height:1.7; color:var(--text-2);">
      <div style="font-weight:700; margin-bottom:6px;">Before enabling the reception capture pathways, the practice confirms:</div>
      <ol style="margin:0 0 8px 18px; padding:0;">
        <li>The capture tool records what callers report. It does <strong>not</strong> triage, diagnose, or replace clinical judgement — a clinician reviews every capture.</li>
        <li>The red-flag questions are short, lay-phrased prompts derived from NICE CKS / NICE guideline red-flag lists. They are <strong>not exhaustive</strong>: a full set of "no" answers does not make a contact safe to handle routinely.</li>
        <li>Reception staff must follow the practice's own escalation policy whenever a red flag is positive <em>or the caller sounds unwell</em>, even if every scripted question is answered "no".</li>
        <li>The bundled pathway content, and any practice edits or custom pathways, must be clinically reviewed (CSO or nominated GP) before use and re-reviewed after every edit.</li>
        <li>Staff using the tool have been briefed on the points above.</li>
      </ol>
      <label style="display:flex; gap:8px; align-items:flex-start; font-weight:600; cursor:pointer;">
        <input type="checkbox" id="rcpoDisclaimerTick" style="margin-top:2px;">
        <span>A clinician (CSO or nominated GP) has reviewed the pathway content and the practice accepts responsibility for it.</span>
      </label>
      <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
        <button class="primary" id="rcpoDisclaimerAccept" disabled style="font-size:11px; padding:5px 12px;">Accept &amp; enable all pathways</button>
        <button class="ghost" id="rcpoDisclaimerCancel" style="font-size:11px; padding:5px 12px;">Cancel</button>
      </div>
    </div>`;

  let _bundled = null; // pathways json doc
  let _editing = null; // { pathway, origin } while editor open

  async function getState() {
    const r = await chrome.storage.local.get([
      'reception.config',
      'reception.customPathways',
      'reception.pathwayOverrides',
    ]);
    return {
      config: r['reception.config'] || {},
      custom: r['reception.customPathways'] || [],
      overrides: r['reception.pathwayOverrides'] || {},
    };
  }

  async function setConfig(patch) {
    const { config } = await getState();
    await chrome.storage.local.set({ 'reception.config': Object.assign({}, config, patch) });
  }

  async function loadBundled() {
    if (_bundled) return _bundled;
    const r = await fetch(chrome.runtime.getURL('rules/reception-pathways.json'));
    _bundled = await r.json();
    return _bundled;
  }

  // ── Disclaimer ──────────────────────────────────────────────────────────────

  function renderDisclaimerArea(config, resolved) {
    const host = $('rcpoDisclaimerBody');
    if (!host) return;
    if (config.disclaimerAcceptedAt) {
      const enabledCount = resolved.all.filter((e) => e.enabled).length;
      host.innerHTML = `
        <div style="font-size:12px; color:var(--text-2); display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <span>Disclaimer accepted ${escHtml(String(config.disclaimerAcceptedAt).slice(0, 10))} · ${enabledCount}/${resolved.all.length} pathway(s) enabled.</span>
          <button class="ghost" id="rcpoEnableAll" style="font-size:11px; padding:4px 10px;">Enable all</button>
          <button class="ghost" id="rcpoDisableAll" style="font-size:11px; padding:4px 10px;">Disable all</button>
        </div>`;
      $('rcpoEnableAll')?.addEventListener('click', () => setAllEnabled(true));
      $('rcpoDisableAll')?.addEventListener('click', () => setAllEnabled(false));
      return;
    }
    host.innerHTML = `
      <div style="border:1px solid rgba(185,28,28,0.4); background:rgba(185,28,28,0.06); border-radius:8px; padding:10px 14px; font-size:12px; color:var(--text-2); display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <span style="font-weight:700;">All capture pathways are disabled.</span>
        <span>Review and accept the disclaimer to enable them.</span>
        <button class="primary" id="rcpoShowDisclaimer" style="font-size:11px; padding:5px 12px;">Review disclaimer…</button>
      </div>
      <div id="rcpoDisclaimerExpand" style="display:none; margin-top:10px;"></div>`;
    $('rcpoShowDisclaimer')?.addEventListener('click', () => {
      const exp = $('rcpoDisclaimerExpand');
      exp.style.display = '';
      exp.innerHTML = DISCLAIMER_HTML;
      const tick = $('rcpoDisclaimerTick');
      const accept = $('rcpoDisclaimerAccept');
      tick?.addEventListener('change', () => {
        accept.disabled = !tick.checked;
      });
      accept?.addEventListener('click', async () => {
        await setConfig({ disclaimerAcceptedAt: new Date().toISOString() });
        await setAllEnabled(true);
      });
      $('rcpoDisclaimerCancel')?.addEventListener('click', () => {
        exp.style.display = 'none';
      });
    });
  }

  async function setAllEnabled(on) {
    const [{ config, custom, overrides }, bundled] = await Promise.all([getState(), loadBundled()]);
    const resolved = PU.resolveEffectivePathways({
      bundled: bundled.pathways || [],
      overrides,
      customPathways: custom,
      enabledPathways: config.enabledPathways || {},
      disclaimerAccepted: !!config.disclaimerAcceptedAt,
    });
    const map = {};
    if (on)
      for (const e of resolved.all) {
        if (!e.invalid) map[e.pathway.id] = true;
      }
    await setConfig({ enabledPathways: map });
    refresh();
  }

  // ── Pathway list ────────────────────────────────────────────────────────────

  const ORIGIN_BADGE = {
    bundled: ['Bundled', 'rgba(74,127,184,0.15)', 'var(--accent)'],
    edited: ['Edited', 'rgba(180,83,9,0.15)', 'var(--amber, #b45309)'],
    custom: ['Custom', 'rgba(22,163,74,0.15)', 'var(--green, #16a34a)'],
  };

  function renderPathwayList(resolved, config) {
    const host = $('rcpoPathwayList');
    if (!host) return;
    host.innerHTML =
      resolved.all
        .map((e) => {
          const p = e.pathway;
          const [label, bg, fg] = ORIGIN_BADGE[e.origin] || ORIGIN_BADGE.bundled;
          const invalid = e.invalid
            ? `<span style="font-size:10px; font-weight:700; color:var(--red, #b91c1c);">INVALID — not shown to reception</span>`
            : e.overrideInvalid
              ? `<span style="font-size:10px; font-weight:700; color:var(--amber, #b45309);">EDIT INVALID — bundled version active</span>`
              : '';
          const actions = [
            `<button class="ghost" data-rcpo-edit="${escAttr(p.id)}" style="font-size:10px; padding:3px 9px;">Edit</button>`,
            e.origin === 'edited'
              ? `<button class="ghost" data-rcpo-reset="${escAttr(p.id)}" style="font-size:10px; padding:3px 9px;">Reset to bundled</button>`
              : '',
            e.origin === 'custom'
              ? `<button class="ghost" data-rcpo-delete="${escAttr(p.id)}" style="font-size:10px; padding:3px 9px;">Delete</button>`
              : '',
          ].join('');
          return `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; min-width:0; flex:1;">
            <input type="checkbox" data-rcpo-toggle="${escAttr(p.id)}" ${e.enabled ? 'checked' : ''} ${e.invalid ? 'disabled' : ''}>
            <span style="font-weight:600; font-size:12px;">${escHtml(p.title)}</span>
            <span style="font-size:10px; font-weight:700; padding:2px 7px; border-radius:3px; background:${bg}; color:${fg};">${label}</span>
            ${invalid}
          </label>
          <div style="display:flex; gap:6px;">${actions}</div>
        </div>`;
        })
        .join('') || '<div style="font-size:12px; color:var(--text-3);">No pathways found.</div>';

    host.querySelectorAll('[data-rcpo-toggle]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.rcpoToggle;
        const { config } = await getState();
        if (cb.checked && !config.disclaimerAcceptedAt) {
          cb.checked = false;
          alert('Review and accept the disclaimer above before enabling any pathway.');
          return;
        }
        const map = Object.assign({}, config.enabledPathways || {});
        if (cb.checked) map[id] = true;
        else delete map[id];
        await setConfig({ enabledPathways: map });
        refresh();
      });
    });
    host.querySelectorAll('[data-rcpo-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openEditor(btn.dataset.rcpoEdit, resolved));
    });
    host.querySelectorAll('[data-rcpo-reset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Discard the practice edit and restore the bundled version of this pathway?')) return;
        const { overrides } = await getState();
        delete overrides[btn.dataset.rcpoReset];
        await chrome.storage.local.set({ 'reception.pathwayOverrides': overrides });
        refresh();
      });
    });
    host.querySelectorAll('[data-rcpo-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this custom pathway? This cannot be undone.')) return;
        const { custom, config } = await getState();
        const id = btn.dataset.rcpoDelete;
        const map = Object.assign({}, config.enabledPathways || {});
        delete map[id];
        await chrome.storage.local.set({ 'reception.customPathways': custom.filter((p) => p.id !== id) });
        await setConfig({ enabledPathways: map });
        refresh();
      });
    });
  }

  // ── Editor ──────────────────────────────────────────────────────────────────

  let _rowSeq = 0;
  function rfRowHtml(rf) {
    const id = rf?.id || `rf-new-${++_rowSeq}`;
    return `
      <div class="rcpo-rf-row" data-rfid="${escAttr(id)}" style="display:flex; gap:6px; margin-bottom:5px; align-items:center;">
        <input type="text" class="rcpo-rf-ask" value="${escAttr(rf?.ask || '')}" placeholder="Red-flag question (lay wording, as asked on the phone)" style="flex:1; font-size:12px; padding:4px 7px;">
        <select class="rcpo-rf-esc" style="font-size:12px; padding:4px;">
          <option value="999" ${rf?.escalate === '999' ? 'selected' : ''}>999-level</option>
          <option value="duty" ${rf?.escalate !== '999' ? 'selected' : ''}>Duty clinician</option>
        </select>
        <button type="button" class="ghost rcpo-row-del" style="font-size:10px; padding:3px 8px;">✕</button>
      </div>`;
  }
  function qRowHtml(q) {
    const id = q?.id || `q-new-${++_rowSeq}`;
    const type = q?.type || 'text';
    const opts = (q?.options || []).join(', ');
    return `
      <div class="rcpo-q-row" data-qid="${escAttr(id)}" style="border:1px solid var(--border); border-radius:6px; padding:7px 9px; margin-bottom:6px;">
        <div style="display:flex; gap:6px; margin-bottom:5px;">
          <input type="text" class="rcpo-q-label" value="${escAttr(q?.label || '')}" placeholder="Short label (used in the pasted summary)" style="flex:0 0 220px; font-size:12px; padding:4px 7px;">
          <select class="rcpo-q-type" style="font-size:12px; padding:4px;">
            ${['text', 'yesno', 'choice', 'multi'].map((t) => `<option value="${t}" ${type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <button type="button" class="ghost rcpo-row-del" style="font-size:10px; padding:3px 8px; margin-left:auto;">✕</button>
        </div>
        <input type="text" class="rcpo-q-ask" value="${escAttr(q?.ask || '')}" placeholder="Question as asked on the phone" style="width:100%; box-sizing:border-box; font-size:12px; padding:4px 7px; margin-bottom:5px;">
        <input type="text" class="rcpo-q-opts" value="${escAttr(opts)}" placeholder="Options, comma-separated (choice/multi only)" style="width:100%; box-sizing:border-box; font-size:12px; padding:4px 7px; ${type === 'choice' || type === 'multi' ? '' : 'display:none;'}">
      </div>`;
  }

  function openEditor(idOrNull, resolved) {
    const host = $('rcpoEditorHost');
    if (!host) return;
    let pathway = null,
      origin = 'custom';
    if (idOrNull) {
      const entry = resolved.all.find((e) => e.pathway.id === idOrNull);
      if (!entry) return;
      pathway = entry.pathway;
      origin = entry.origin === 'custom' ? 'custom' : 'bundled-edit';
    }
    _editing = { id: idOrNull, origin };

    const rfRows = (pathway?.redFlags || [{}]).map(rfRowHtml).join('');
    const qRows = (pathway?.questions || [{}]).map(qRowHtml).join('');

    host.innerHTML = `
      <div style="border:1px solid var(--border-hi); border-radius:10px; padding:14px 16px; margin-top:12px;">
        <div style="font-weight:700; font-size:13px; margin-bottom:10px;">
          ${pathway ? `Edit pathway: ${escHtml(pathway.title)}` : 'New custom pathway'}
          ${origin === 'bundled-edit' ? '<span style="font-size:10px; color:var(--text-3);"> (saved as a practice edit — the bundled original can be restored at any time)</span>' : ''}
        </div>
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <input type="text" id="rcpoEdTitle" value="${escAttr(pathway?.title || '')}" placeholder="Pathway title" style="flex:1; font-size:12px; padding:5px 8px;">
          <input type="text" id="rcpoEdApplies" value="${escAttr(pathway?.appliesTo || '')}" placeholder="Applies to (e.g. Adults)" style="flex:1; font-size:12px; padding:5px 8px;">
        </div>
        <div style="font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-3); margin:10px 0 5px;">Red flags — asked first, every one must be answered</div>
        <div id="rcpoEdRf">${rfRows}</div>
        <button type="button" class="ghost" id="rcpoEdAddRf" style="font-size:10px; padding:3px 9px;">+ Add red flag</button>
        <div style="font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-3); margin:14px 0 5px;">History questions</div>
        <div id="rcpoEdQ">${qRows}</div>
        <button type="button" class="ghost" id="rcpoEdAddQ" style="font-size:10px; padding:3px 9px;">+ Add question</button>
        <div id="rcpoEdErrors" style="color:var(--red, #b91c1c); font-size:11px; margin-top:8px; white-space:pre-line;"></div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="primary" id="rcpoEdSave" style="font-size:11px; padding:5px 14px;">Save pathway</button>
          <button class="ghost" id="rcpoEdCancel" style="font-size:11px; padding:5px 12px;">Cancel</button>
          <span style="font-size:11px; color:var(--text-3); align-self:center;">Saving does not enable the pathway — review it clinically, then toggle it on.</span>
        </div>
      </div>`;

    const wireRowDeletes = () =>
      host.querySelectorAll('.rcpo-row-del').forEach((b) => {
        b.onclick = () => b.closest('.rcpo-rf-row, .rcpo-q-row')?.remove();
      });
    const wireTypeToggles = () =>
      host.querySelectorAll('.rcpo-q-type').forEach((sel) => {
        sel.onchange = () => {
          const opts = sel.closest('.rcpo-q-row').querySelector('.rcpo-q-opts');
          opts.style.display = sel.value === 'choice' || sel.value === 'multi' ? '' : 'none';
        };
      });
    wireRowDeletes();
    wireTypeToggles();
    $('rcpoEdAddRf')?.addEventListener('click', () => {
      $('rcpoEdRf').insertAdjacentHTML('beforeend', rfRowHtml(null));
      wireRowDeletes();
    });
    $('rcpoEdAddQ')?.addEventListener('click', () => {
      $('rcpoEdQ').insertAdjacentHTML('beforeend', qRowHtml(null));
      wireRowDeletes();
      wireTypeToggles();
    });
    $('rcpoEdCancel')?.addEventListener('click', () => {
      host.innerHTML = '';
      _editing = null;
    });
    $('rcpoEdSave')?.addEventListener('click', () => saveEditor(pathway, origin));
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function slugify(title) {
    return (
      String(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'pathway'
    );
  }

  async function saveEditor(original, origin) {
    const host = $('rcpoEditorHost');
    const errsEl = $('rcpoEdErrors');
    const title = $('rcpoEdTitle')?.value.trim() || '';
    const appliesTo = $('rcpoEdApplies')?.value.trim() || '';

    const redFlags = Array.from(host.querySelectorAll('.rcpo-rf-row')).map((row) => ({
      id: row.dataset.rfid,
      ask: row.querySelector('.rcpo-rf-ask')?.value.trim() || '',
      escalate: row.querySelector('.rcpo-rf-esc')?.value || 'duty',
    }));
    const questions = Array.from(host.querySelectorAll('.rcpo-q-row')).map((row) => {
      const type = row.querySelector('.rcpo-q-type')?.value || 'text';
      const q = {
        id: row.dataset.qid,
        ask: row.querySelector('.rcpo-q-ask')?.value.trim() || '',
        type,
        label: row.querySelector('.rcpo-q-label')?.value.trim() || undefined,
      };
      if (type === 'choice' || type === 'multi') {
        q.options = (row.querySelector('.rcpo-q-opts')?.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (!q.label) delete q.label;
      return q;
    });

    const { custom, overrides } = await getState();
    const bundled = await loadBundled();
    let id;
    if (original) {
      id = original.id;
    } else {
      id = slugify(title);
      const taken = new Set([...(bundled.pathways || []).map((p) => p.id), ...custom.map((p) => p.id)]);
      let n = 2;
      while (taken.has(id)) id = `${slugify(title)}-${n++}`;
    }

    const candidate = {
      id,
      title,
      appliesTo: appliesTo || undefined,
      sources: original?.sources || ['Practice-authored — clinically review before use'],
      redFlags,
      questions,
      pharmacyFirst: original?.pharmacyFirst, // not editable in v1; preserved on bundled edits
    };
    if (!candidate.pharmacyFirst) delete candidate.pharmacyFirst;
    if (!candidate.appliesTo) delete candidate.appliesTo;

    const errs = PU.validatePathway(candidate);
    if (errs.length > 0) {
      if (errsEl) errsEl.textContent = errs.join('\n');
      return;
    }
    const clean = PU.sanitisePathway(candidate);

    if (origin === 'bundled-edit') {
      overrides[id] = clean;
      await chrome.storage.local.set({ 'reception.pathwayOverrides': overrides });
    } else {
      const idx = custom.findIndex((p) => p.id === id);
      if (idx >= 0) custom[idx] = clean;
      else custom.push(clean);
      await chrome.storage.local.set({ 'reception.customPathways': custom });
    }
    if (host) host.innerHTML = '';
    _editing = null;
    refresh();
  }

  // ── Quick-wins chip filter ──────────────────────────────────────────────────

  async function renderChipList(config) {
    const host = $('rcpoChipList');
    if (!host) return;
    try {
      const base = chrome.runtime.getURL('rules/');
      const [drug, qof, vax, customRes] = await Promise.all([
        fetch(base + 'drug-rules.json').then((r) => r.json()),
        fetch(base + 'qof-rules.json').then((r) => r.json()),
        fetch(base + 'vaccine-rules.json').then((r) => r.json()),
        chrome.storage.local.get('sentinel.customRules'),
      ]);
      const customRules = (customRes['sentinel.customRules'] || []).filter((r) => r.enabled !== false);
      const rules = [
        ...(drug.rules || [])
          .filter((r) => r.enabled !== false)
          .map((r) => ({ id: r.id, name: r.displayName || r.id, kind: 'Drug monitoring' })),
        ...(qof.rules || [])
          .filter((r) => r.enabled !== false)
          .map((r) => ({
            id: r.id,
            name: r.displayName || r.name || r.id,
            kind: r.type === 'qof-register' ? 'QOF register' : 'QOF / alert',
          })),
        ...(vax.rules || [])
          .filter((r) => r.enabled !== false)
          .map((r) => ({ id: r.id, name: r.displayName || r.id, kind: 'Vaccine' })),
        ...customRules.map((r) => ({ id: r.id, name: r.displayName || r.name || r.id, kind: 'Custom (Sentinel)' })),
      ];
      const hidden = config.hiddenChipRules || {};
      host.innerHTML =
        rules
          .map(
            (r) => `
        <label style="display:flex; align-items:center; gap:8px; padding:4px 2px; font-size:12px; cursor:pointer;">
          <input type="checkbox" data-rcpo-chip="${escAttr(r.id)}" ${hidden[r.id] === true ? '' : 'checked'}>
          <span>${escHtml(r.name)}</span>
          <span style="font-size:10px; color:var(--text-3);">${escHtml(r.kind)}</span>
        </label>`
          )
          .join('') || '<div style="font-size:12px; color:var(--text-3);">No rules found.</div>';
      host.querySelectorAll('[data-rcpo-chip]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const { config } = await getState();
          const map = Object.assign({}, config.hiddenChipRules || {});
          if (cb.checked) delete map[cb.dataset.rcpoChip];
          else map[cb.dataset.rcpoChip] = true;
          await setConfig({ hiddenChipRules: map });
        });
      });
    } catch (e) {
      host.innerHTML = `<div style="font-size:12px; color:var(--red, #b91c1c);">Could not load rules: ${escHtml(e.message)}</div>`;
    }
  }

  // ── Orchestration ───────────────────────────────────────────────────────────

  async function refresh() {
    try {
      const [{ config, custom, overrides }, bundled] = await Promise.all([getState(), loadBundled()]);
      const resolved = PU.resolveEffectivePathways({
        bundled: bundled.pathways || [],
        overrides,
        customPathways: custom,
        enabledPathways: config.enabledPathways || {},
        disclaimerAccepted: !!config.disclaimerAcceptedAt,
      });
      renderDisclaimerArea(config, resolved);
      renderPathwayList(resolved, config);
      renderChipList(config);
    } catch (e) {
      const host = $('rcpoPathwayList');
      if (host)
        host.innerHTML = `<div style="font-size:12px; color:var(--red, #b91c1c);">Could not load reception settings: ${escHtml(e.message)}</div>`;
    }
  }

  // Single persistent listener: resolve the current pathway set at click time.
  $('rcpoNewPathway')?.addEventListener('click', async () => {
    const [{ config, custom, overrides }, bundled] = await Promise.all([getState(), loadBundled()]);
    const resolved = PU.resolveEffectivePathways({
      bundled: bundled.pathways || [],
      overrides,
      customPathways: custom,
      enabledPathways: config.enabledPathways || {},
      disclaimerAccepted: !!config.disclaimerAcceptedAt,
    });
    openEditor(null, resolved);
  });

  // ── LLM pathway authoring tool ──────────────────────────────────────────────

  $('rcpoLlmCopyPrompt')?.addEventListener('click', async () => {
    const prompt = PU.pathwaySchemaPrompt();
    const copiedEl = $('rcpoLlmCopied');
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (_) {
      // Fallback: write to a temp textarea
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (copiedEl) {
      copiedEl.style.opacity = '1';
      setTimeout(() => {
        copiedEl.style.opacity = '0';
      }, 2000);
    }
  });

  $('rcpoLlmImport')?.addEventListener('click', async () => {
    const statusEl = $('rcpoLlmStatus');
    const jsonEl = $('rcpoLlmJson');
    if (!statusEl || !jsonEl) return;

    const raw = (jsonEl.value || '').trim();
    if (!raw) {
      statusEl.style.color = 'var(--red, #b91c1c)';
      statusEl.textContent = 'Paste the LLM JSON into the box first.';
      return;
    }

    // Parse and normalise: accept single object, array, or wrapped { pathway, pathways }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      statusEl.style.color = 'var(--red, #b91c1c)';
      statusEl.textContent = 'Could not parse JSON: ' + escHtml(e.message);
      return;
    }

    let candidates = [];
    if (Array.isArray(parsed)) {
      candidates = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (parsed.pathways && Array.isArray(parsed.pathways)) {
        candidates = parsed.pathways;
      } else if (parsed.pathway && typeof parsed.pathway === 'object') {
        candidates = [parsed.pathway];
      } else {
        candidates = [parsed];
      }
    } else {
      statusEl.style.color = 'var(--red, #b91c1c)';
      statusEl.textContent = 'Expected a JSON object or array of pathway objects.';
      return;
    }

    if (candidates.length === 0) {
      statusEl.style.color = 'var(--red, #b91c1c)';
      statusEl.textContent = 'No pathway objects found in the pasted JSON.';
      return;
    }

    // Validate each candidate; abort on first error
    for (let i = 0; i < candidates.length; i++) {
      const errs = PU.validatePathway(candidates[i]);
      if (errs.length > 0) {
        const label = candidates.length > 1 ? `Pathway ${i + 1}: ` : '';
        statusEl.style.color = 'var(--red, #b91c1c)';
        statusEl.innerHTML = escHtml(label + errs[0]);
        return;
      }
    }

    // Sanitise, resolve id collisions, append to customPathways
    const [{ custom }, bundledDoc] = await Promise.all([getState(), loadBundled()]);
    const taken = new Set([...(bundledDoc.pathways || []).map((p) => p.id), ...custom.map((p) => p.id)]);
    const toAdd = [];
    for (const c of candidates) {
      const clean = PU.sanitisePathway(c);
      let id = clean.id;
      let n = 2;
      while (taken.has(id)) id = clean.id + '-' + n++;
      clean.id = id;
      taken.add(id);
      toAdd.push(clean);
    }

    // Write — do NOT touch enabledPathways (imported pathways stay off until reviewed)
    await chrome.storage.local.set({ 'reception.customPathways': [...custom, ...toAdd] });
    jsonEl.value = '';
    statusEl.style.color = 'var(--green, #16a34a)';
    statusEl.textContent = `Imported ${toAdd.length} pathway${toAdd.length !== 1 ? 's' : ''} — review and enable them below.`;
    refresh();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
  document
    .querySelectorAll('.nav-item[data-section="reception"]')
    .forEach((btn) => btn.addEventListener('click', refresh));
})();

// ── Knowledge options section ─────────────────────────────────────────────────
// Starter-pack generation via external LLM (copy prompt → paste JSON →
// validate → import). Mirrors the Reception LLM pathway flow above. Imported
// entries are forced to source:'llm', reviewed:false regardless of what the
// pasted JSON claims, and near-duplicate titles (KnowledgeUtils.findSimilar)
// are skipped so repeated imports don't bloat the base.
(() => {
  const KU = window.KnowledgeUtils;
  const $k = (id) => document.getElementById(id);

  async function refreshStats() {
    const el = $k('kboStats');
    if (!el) return;
    const r = await chrome.storage.local.get(['knowledge.items']);
    const items = r['knowledge.items'] || [];
    const unreviewed = items.filter((e) => e && e.source === 'llm' && e.reviewed !== true).length;
    el.textContent =
      `${items.length} entr${items.length === 1 ? 'y' : 'ies'} in the knowledge base` +
      (unreviewed ? ` — ${unreviewed} AI-generated and awaiting review (badge shown on the tab).` : '.');
  }

  $k('kboLlmCopyPrompt')?.addEventListener('click', async () => {
    const prompt = KU.kbSchemaPrompt();
    const copiedEl = $k('kboLlmCopied');
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (copiedEl) {
      copiedEl.style.opacity = '1';
      setTimeout(() => {
        copiedEl.style.opacity = '0';
      }, 2000);
    }
  });

  $k('kboLlmImport')?.addEventListener('click', async () => {
    const statusEl = $k('kboLlmStatus');
    const warnEl = $k('kboLlmWarnings');
    const jsonEl = $k('kboLlmJson');
    if (!statusEl || !jsonEl) return;
    const fail = (msg) => {
      statusEl.style.color = 'var(--red, #b91c1c)';
      statusEl.textContent = msg;
    };
    warnEl.textContent = '';

    const raw = (jsonEl.value || '').trim();
    if (!raw) return fail('Paste the LLM JSON into the box first.');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return fail('Could not parse JSON: ' + e.message);
    }

    let candidates;
    if (Array.isArray(parsed)) candidates = parsed;
    else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) candidates = parsed.entries;
    else return fail('Expected { "entries": [ ... ] } or a JSON array of entries.');
    if (candidates.length === 0) return fail('No entries found in the pasted JSON.');

    for (let i = 0; i < candidates.length; i++) {
      const errs = KU.validateEntry(candidates[i]);
      if (errs.length > 0) return fail(`Entry ${i + 1}: ${errs[0]}`);
    }

    const r = await chrome.storage.local.get(['knowledge.items', 'knowledge.categories']);
    const items = r['knowledge.items'] || [];
    const categories = KU.sanitiseCategories(r['knowledge.categories']);
    const catIds = new Set(categories.map((c) => c.id));
    const taken = new Set(items.map((e) => e.id));

    const toAdd = [];
    let skipped = 0;
    for (const c of candidates) {
      // Anti-bloat: skip entries whose titles near-duplicate an existing or
      // already-imported entry (token-normalised match, see knowledge-utils.js).
      if (KU.findSimilar(c.title, [...items, ...toAdd]).length > 0) {
        skipped++;
        continue;
      }
      const clean = KU.sanitiseEntry(c);
      clean.source = 'llm';
      clean.reviewed = false;
      clean.id = KU.generateEntryId(clean.title, taken);
      taken.add(clean.id);
      if (!catIds.has(clean.category)) {
        // Preserve the LLM's grouping rather than silently re-filing it.
        const name = clean.category.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
        categories.push({ id: clean.category, name });
        catIds.add(clean.category);
      }
      toAdd.push(clean);
    }

    if (toAdd.length === 0) {
      return fail(`Nothing imported — all ${skipped} entr${skipped === 1 ? 'y' : 'ies'} matched existing titles.`);
    }

    const phi = KU.phiWarnings(toAdd);
    if (phi.length > 0) {
      warnEl.innerHTML =
        '<strong>Check before relying on these entries:</strong><br>' +
        phi.map((w) => '&bull; ' + w.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
    }

    await chrome.storage.local.set({
      'knowledge.items': [...items, ...toAdd],
      'knowledge.categories': categories,
    });
    jsonEl.value = '';
    statusEl.style.color = 'var(--green, #16a34a)';
    statusEl.textContent =
      `Imported ${toAdd.length} entr${toAdd.length === 1 ? 'y' : 'ies'}` +
      (skipped ? ` (${skipped} skipped as near-duplicates)` : '') +
      ' — review them on the Knowledge tab.';
    refreshStats();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshStats);
  } else {
    refreshStats();
  }
  document
    .querySelectorAll('.nav-item[data-section="knowledge"]')
    .forEach((btn) => btn.addEventListener('click', refreshStats));
})();
