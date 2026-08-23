// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Options backup orchestration (architecture plan Phase 4.6 / 5.2).
// Classic script: loaded after the per-module IO files and before options.js.

'use strict';

// ── Phase 2: Backup & Restore ─────────────────────────────────────────────────
// Uses SuiteEnvelope from shared/io/suite-envelope.js (loaded as a script tag).
// IO functions are inlined here to avoid ES module issues in options pages.

// --- Backup helpers — one MODULE_IO table, looped from MODULE_SCOPES.
//     See shared/io/suite-envelope.js: add a storage key in the IO file;
//     add a new module as one MODULE_SCOPES + MODULE_IO entry. ---

const MODULE_IO = {
  sentinel: { exportFn: () => sentinelExport(), importFn: (d, opts) => sentinelImport(d, opts) },
  capacity: { exportFn: () => capacityExport(), importFn: (d) => capacityImport(d) },
  triage: { exportFn: () => triageExport(), importFn: (d) => triageImport(d) },
  triageAlerts: { exportFn: () => TriageAlertIO.exportData(), importFn: (d) => TriageAlertIO.importData(d) },
  slots: { exportFn: () => slotCounterExport(), importFn: (d) => slotCounterImport(d) },
  submissions: { exportFn: () => submissionsExport(), importFn: (d) => submissionsImport(d) },
  popout: { exportFn: () => popoutExport(), importFn: (d) => popoutImport(d) },
  referrals: { exportFn: () => referralsExport(), importFn: (d) => referralsImport(d) },
  requestMonitor: { exportFn: () => requestMonitorExport(), importFn: (d) => requestMonitorImport(d) },
  condor: { exportFn: () => condorExport(), importFn: (d) => condorImport(d) },
  reception: { exportFn: () => receptionExport(), importFn: (d) => receptionImport(d) },
  knowledge: { exportFn: () => knowledgeExport(), importFn: (d) => knowledgeImport(d) },
  labfiling: { exportFn: () => labfilingExport(), importFn: (d) => labfilingImport(d) },
  notifications: { exportFn: () => notificationsExport(), importFn: (d) => notificationsImport(d) },
  leaflets: { exportFn: () => leafletsExport(), importFn: (d) => leafletsImport(d) },
  patientAlerts: { exportFn: () => patientAlertsExport(), importFn: (d) => patientAlertsImport(d) },
  problemDescriptionCleanup: {
    exportFn: () => problemDescriptionCleanupExport(),
    importFn: (d) => problemDescriptionCleanupImport(d),
  },
  phrases: { exportFn: () => phrasesExport(), importFn: (d) => phrasesImport(d) },
  rota: { exportFn: () => rotaExport(), importFn: (d) => rotaImport(d) },
  suite: { exportFn: () => suiteExport(), importFn: (d) => suiteImport(d) },
};

async function doFullExport() {
  const scopes = window.SuiteEnvelope.MODULE_SCOPES;
  const entries = await Promise.all(scopes.map((s) => MODULE_IO[s].exportFn().then((data) => [s, data])));
  return window.SuiteEnvelope.wrap('suite', Object.fromEntries(entries), chrome.runtime.getManifest().version);
}

async function doModuleExport(scope) {
  const io = MODULE_IO[scope];
  if (!io || scope === 'suite') throw new Error('Unknown scope: ' + scope);
  const data = await io.exportFn();
  // Real manifest version (audit M18: the envelope's fallback stamped every
  // backup "2.5.0", defeating the preview's provenance line).
  return window.SuiteEnvelope.wrap(scope, { [scope]: data }, chrome.runtime.getManifest().version);
}

async function applyEnvelope(envelope) {
  const mods = envelope.modules || {};
  const notes = [];
  // Same order as doFullExport (MODULE_SCOPES). Only modules present in this
  // backup. applyWithRollback runs them sequentially; if any throws, all
  // writes are rolled back.
  const tasks = window.SuiteEnvelope.MODULE_SCOPES.filter((s) => mods[s]).map((s) => {
    if (s === 'sentinel') {
      return async () => {
        const res = await MODULE_IO.sentinel.importFn(mods.sentinel, { skipInvalidCustomRules: true });
        if (res && res.rejectedCustomRules && res.rejectedCustomRules.length) {
          const ids = res.rejectedCustomRules.map((r) => r.id || r.label || '(unnamed)').join(', ');
          notes.push(`${res.rejectedCustomRules.length} custom rule(s) skipped as invalid: ${ids}`);
        }
      };
    }
    return () => MODULE_IO[s].importFn(mods[s]);
  });
  await window.SuiteEnvelope.applyWithRollback(tasks);
  return { notes };
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
    const result = await applyEnvelope(pendingEnvelope);
    pendingEnvelope = null;
    const previewWrap = document.getElementById('importPreviewWrap');
    if (previewWrap) previewWrap.style.display = 'none';
    const noteSuffix = result && result.notes && result.notes.length ? ` (${result.notes.join('; ')})` : '';
    setBackupStatus(`Restore complete${noteSuffix} — reloading settings page…`);
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
    if (file.size > 10 * 1024 * 1024) {
      setBackupStatus('File is too large (max 10 MB). Import cancelled.', true);
      return;
    }
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
      const result = await applyEnvelope(envelope);
      const noteSuffix = result && result.notes && result.notes.length ? ` (${result.notes.join('; ')})` : '';
      setBackupStatus(`${scope} restored${noteSuffix} — reloading settings page…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setBackupStatus('Import failed: ' + err.message, true);
    }
  });
});

window.BackupOrchestrator = {
  MODULE_IO,
  doFullExport,
  doModuleExport,
  applyEnvelope,
  downloadJson,
  setBackupStatus,
};
