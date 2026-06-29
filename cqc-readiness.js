// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// CQC Inspection Readiness — page controller.
//
// Opened as a full browser tab (like the practice report / visualiser). Two modes:
//   - Readiness check (default) — the internal self-audit; no confirm gate.
//   - Evidence export — the inspector-facing document. Gated behind an explicit
//     "I have reviewed these figures" confirm (R-A): we never auto-produce the
//     inspector document. Print/PDF and the export rendering stay disabled until
//     the #cqcConfirm checkbox is ticked.
//
// The readiness object is assembled by engine/cqc-evidence.js (which delegates the
// rule-currency assessment to window.RuleCurrency, loaded as a classic <script>
// before this module). cqc-render.js turns it into HTML / CSV. This controller is
// pure plumbing: theme, generate, print, CSV download, save-as-baseline, the gate.

// The engine is a classic dual-export script (engine/cqc-evidence.js lints as a
// script under engine/**); the HTML loads it before this module, so it is read off
// window.CqcEvidence rather than ESM-imported. The renderer is a true ES module.
import { buildReadinessHtml, buildReadinessCsv } from './cqc-render.js';

const assembleReadiness = (opts) => window.CqcEvidence.assembleReadiness(opts);

const $ = (id) => document.getElementById(id);

// chrome.storage.local key the current readiness is saved under for the next
// run's "what changed since last run" delta (A7 — an explicitly-anchored run).
const ANCHOR_KEY = 'cqc.readiness.anchor';

let _mode = 'readiness';
let _lastReadiness = null;

// ── Theme ───────────────────────────────────────────────────────────────────
async function applyTheme() {
  try {
    const r = await chrome.storage.local.get('suite.display');
    const theme = r['suite.display']?.theme;
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch {
    /* default light */
  }
}

// ── Local date (YYYY-MM-DD) without UTC drift ─────────────────────────────────
function localISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Designed empty / error state — a framed panel, not bare grey text.
function emptyState(title, message) {
  return `<div class="cqc-empty"><h2>${title}</h2><p>${message}</p></div>`;
}

// Gated placeholder shown in export mode before the confirm box is ticked.
function gatePlaceholder() {
  return emptyState(
    'Confirm before exporting',
    'The evidence export is the inspector-facing document. Tick ' +
      '<strong>“I have reviewed these figures and confirm they are accurate”</strong> ' +
      'above to render and print it. This step is required — the document is never produced automatically.'
  );
}

// ── Mode toggle ───────────────────────────────────────────────────────────────
function setMode(mode) {
  _mode = mode === 'export' ? 'export' : 'readiness';
  $('cqcMode')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.mode === _mode));
  // The confirm gate only exists in export mode.
  $('cqcGate').hidden = _mode !== 'export';
  if (_mode !== 'export') $('cqcConfirm').checked = false;
  // Re-render whatever we have under the new mode + gate state.
  renderCurrent();
}

// Is rendering/printing the inspector document currently permitted?
// Readiness mode: always. Export mode: only once the confirm box is ticked.
function exportAllowed() {
  return _mode !== 'export' || $('cqcConfirm').checked;
}

// Render the last-assembled readiness under the current mode + gate, and sync buttons.
function renderCurrent() {
  const out = $('cqcOutput');
  if (!_lastReadiness) {
    // No data yet — leave the initial empty state untouched; just sync buttons.
    syncButtons(false);
    return;
  }
  if (_mode === 'export' && !exportAllowed()) {
    out.innerHTML = gatePlaceholder();
    syncButtons(false);
    return;
  }
  out.innerHTML = buildReadinessHtml(_lastReadiness, { mode: _mode });
  syncButtons(true);
}

// Print/PDF + CSV are enabled only when a document is actually rendered and (for
// export mode) the gate is satisfied. Save-as-baseline only needs assembled data.
function syncButtons(rendered) {
  $('cqcPrint').disabled = !rendered;
  $('cqcCsv').disabled = !rendered;
  $('cqcBaseline').disabled = !_lastReadiness;
}

// ── Generate ──────────────────────────────────────────────────────────────────
async function generate() {
  const out = $('cqcOutput');
  out.innerHTML = '<div class="cqc-placeholder">Assembling readiness…</div>';
  syncButtons(false);

  // The anchor is the user's deliberately-saved previous run (A7), used for the delta.
  let anchor = null;
  try {
    const r = await chrome.storage.local.get(ANCHOR_KEY);
    anchor = r[ANCHOR_KEY] || null;
  } catch {
    /* delta is optional — assemble without it */
  }

  try {
    _lastReadiness = await assembleReadiness({ todayISO: localISO(), anchor });
  } catch (e) {
    _lastReadiness = null;
    out.innerHTML = emptyState('Could not assemble readiness', String((e && e.message) || e));
    syncButtons(false);
    return;
  }

  renderCurrent();
}

// ── Save as baseline (A7) ─────────────────────────────────────────────────────
async function saveBaseline() {
  if (!_lastReadiness) return;
  const btn = $('cqcBaseline');
  const original = btn.textContent;
  try {
    await chrome.storage.local.set({ [ANCHOR_KEY]: _lastReadiness });
    btn.textContent = 'Baseline saved';
  } catch {
    btn.textContent = 'Save failed';
  }
  setTimeout(() => {
    btn.textContent = original;
  }, 2000);
}

// ── CSV download (Blob, like practice-report.js) ──────────────────────────────

// RFC-4180 cell quoting: wrap in quotes and double any embedded quote when the
// value contains a comma, quote or newline.
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Serialise buildReadinessCsv's { suffix, sections:[{title,header,rows}] } shape
// into CSV text. (Previously downloadCsvFile read a non-existent `csv.text`, so the
// button silently produced nothing — the export was dead.)
function serialiseReadinessCsv(built) {
  if (!built || !Array.isArray(built.sections)) return '';
  return built.sections
    .map((sec) => {
      const lines = [];
      if (sec.title) lines.push(csvCell(sec.title));
      if (Array.isArray(sec.header)) lines.push(sec.header.map(csvCell).join(','));
      for (const row of sec.rows || []) lines.push((Array.isArray(row) ? row : [row]).map(csvCell).join(','));
      return lines.join('\n');
    })
    .join('\n\n');
}

function downloadCsvFile() {
  if (!_lastReadiness || !exportAllowed()) return;
  const built = buildReadinessCsv(_lastReadiness);
  const text = typeof built === 'string' ? built : serialiseReadinessCsv(built);
  if (!text) return;
  // Engine emits `generatedAt` (not `asAt`); buildReadinessCsv already derives a
  // dated `suffix` from it — prefer that, then fall back to today.
  const stamp =
    (built && built.suffix && /^\d{4}-\d{2}-\d{2}$/.test(built.suffix) ? built.suffix : null) ||
    (_lastReadiness.generatedAt && String(_lastReadiness.generatedAt).slice(0, 10)) ||
    localISO();
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cqc-readiness-${_mode}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  applyTheme();

  $('cqcMode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) setMode(btn.dataset.mode);
  });

  $('cqcGenerate').addEventListener('click', generate);
  $('cqcPrint').addEventListener('click', () => {
    if (exportAllowed()) window.print();
  });
  $('cqcCsv').addEventListener('click', downloadCsvFile);
  $('cqcBaseline').addEventListener('click', saveBaseline);

  // The export gate — re-render + re-enable as soon as it's ticked/un-ticked.
  $('cqcConfirm').addEventListener('change', renderCurrent);

  // One-click "Print inspector copy" (R4 — the admin's most-confusing journey was
  // switch-mode → tick → print). This jumps to export mode and surfaces the gate so
  // the next step is obvious; it never bypasses the confirm tick (governance).
  const printCopyBtn = $('cqcPrintCopy');
  if (printCopyBtn) {
    printCopyBtn.addEventListener('click', () => {
      if (_mode !== 'export') setMode('export');
      if (!_lastReadiness) {
        generate();
      }
      if (!$('cqcConfirm').checked) {
        $('cqcGate').classList.add('cqc-gate-flash');
        $('cqcConfirm').focus();
        setTimeout(() => $('cqcGate').classList.remove('cqc-gate-flash'), 1600);
      } else if (exportAllowed()) {
        window.print();
      }
    });
  }

  // Collapsed <details> (matched terms, reconciliation worksheet) are force-opened
  // for printing so the inspector PDF carries the full evidence, then restored.
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll('#cqcOutput details:not([open])').forEach((d) => {
      d.dataset.printForced = '1';
      d.open = true;
    });
  });
  window.addEventListener('afterprint', () => {
    document.querySelectorAll('#cqcOutput details[data-print-forced]').forEach((d) => {
      d.open = false;
      delete d.dataset.printForced;
    });
  });

  // Honour ?mode= from the launcher.
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  if (mode === 'export' || mode === 'readiness') setMode(mode);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
