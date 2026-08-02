// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Practice Report — page controller.
// Opened as a full browser tab (like the visualiser). Reads the practice code,
// fetches the period's data + a live snapshot, applies the chosen audience profile,
// renders the report, and wires Print/PDF + CSV.

import { resolveRange, buildReport, localISO } from './side-panel/modules/condor/report/report-data.js';
import { getProfile, applyProfile } from './side-panel/modules/condor/report/report-profiles.js';
import { buildReportHtml, buildReportCsv, SECTION_LABELS } from './side-panel/modules/condor/report/report-render.js';
import { fetchAllStreams } from './side-panel/modules/condor/condor-data.js';
import { computeIndex } from './side-panel/modules/condor/condor-index-core.js';
import { downloadCsv, toCsv } from './side-panel/modules/shared/export-util.js';

const INDEX_CONFIG_KEY = 'condor.indexConfig';

const $ = (id) => document.getElementById(id);
let _preset = '7d';
let _lastApplied = null;
// Power-user view state (display only — never affects what data was fetched/stripped):
//   sort: { by, dir } for the per-clinician table; sections: { <key>: bool } overrides.
let _view = { sort: null, sections: {} };

// Re-render the current report with the current view state (sort + section toggles).
function renderInto() {
  if (!_lastApplied) return;
  $('prOutput').innerHTML = buildReportHtml(_lastApplied, _view);
}

// Build the section-toggle checkboxes from the active profile's section visibility.
function buildSectionToggles() {
  const host = $('prSections');
  if (!host || !_lastApplied) return;
  const enabled = _lastApplied.sectionsEnabled || {};
  host.innerHTML =
    '<span class="pr-sections-label">Sections</span>' +
    Object.entries(SECTION_LABELS)
      .map(([key, label]) => {
        const on = _view.sections[key] !== undefined ? _view.sections[key] : enabled[key] !== false;
        return `<label class="pr-sec-toggle"><input type="checkbox" data-section="${key}"${on ? ' checked' : ''}/> ${label}</label>`;
      })
      .join('');
  host.hidden = false;
}

// Designed empty/placeholder state (C3) — a framed panel, optionally with an
// "Open options" action, rather than bare grey text on a blank page.
function emptyState(title, message, withOptions = false) {
  return (
    `<div class="pr-empty"><h2>${title}</h2><p>${message}</p>` +
    (withOptions ? `<button class="pr-btn pr-btn-primary" id="prOpenOptions">Open options</button>` : '') +
    `</div>`
  );
}
function wireOptionsButton() {
  const b = document.getElementById('prOpenOptions');
  if (b) b.addEventListener('click', () => chrome.runtime.openOptionsPage && chrome.runtime.openOptionsPage());
}

async function applyTheme() {
  try {
    const r = await chrome.storage.local.get('suite.display');
    const theme = r['suite.display']?.theme;
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch {
    /* default light */
  }
}

function setActivePreset(preset) {
  _preset = preset;
  $('prPeriod')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.preset === preset));
  $('prCustom').hidden = preset !== 'custom';
}

async function generate() {
  const out = $('prOutput');
  out.innerHTML = '<div class="pr-placeholder">Building report…</div>';
  $('prPrint').disabled = true;
  $('prCsv').disabled = true;

  let siteId = null;
  try {
    const r = await chrome.storage.local.get('suite.practiceCode');
    siteId = r['suite.practiceCode'] || null;
  } catch {
    /* ignore */
  }
  if (!siteId) {
    out.innerHTML = emptyState(
      'No practice code yet',
      'This report needs your practice code. Open a Medicus tab so it can be detected automatically, or set it in the extension options, then press Generate.',
      true
    );
    wireOptionsButton();
    return;
  }

  const range = resolveRange(_preset, { today: localISO(), start: $('prStart').value, end: $('prEnd').value });

  // Live snapshot (today's PPI / waiting room / urgent) for the current-snapshot block.
  // Reads the same custom weightings/thresholds override (item 8) as the live
  // Condor gauge so the report's PPI can never quietly disagree with the panel.
  let live = null;
  let ppi = null;
  try {
    live = await fetchAllStreams();
    if (live && live.siteId) {
      const stored = await chrome.storage.local.get(INDEX_CONFIG_KEY);
      ppi = computeIndex(live, stored[INDEX_CONFIG_KEY] ?? null);
    }
  } catch {
    /* report still works from historical data without the live block */
  }

  let report;
  try {
    report = await buildReport({ siteId, range, live, ppi });
  } catch (e) {
    out.innerHTML = emptyState('Could not build the report', String(e.message || e), false);
    return;
  }

  const profile = getProfile($('prProfile').value);
  _lastApplied = applyProfile(report, profile);
  _view = { sort: null, sections: {} }; // fresh profile starts from its own section defaults
  renderInto();
  buildSectionToggles();
  $('prPrint').disabled = false;
  $('prCsv').disabled = false;
}

function init() {
  applyTheme();
  $('prPeriod').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-preset]');
    if (btn) setActivePreset(btn.dataset.preset);
  });
  $('prGenerate').addEventListener('click', generate);

  // Sortable per-clinician columns — delegated so it survives re-renders.
  const onSort = (th) => {
    const by = th.dataset.sort;
    if (!by) return;
    const cur = _view.sort;
    // Same column toggles direction; a new column starts desc (asc for the name column).
    const dir = cur && cur.by === by ? (cur.dir === 'asc' ? 'desc' : 'asc') : by === 'name' ? 'asc' : 'desc';
    _view.sort = { by, dir };
    renderInto();
  };
  $('prOutput').addEventListener('click', (e) => {
    const th = e.target.closest('.pr-sortable');
    if (th) onSort(th);
  });
  $('prOutput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('.pr-sortable');
    if (th) {
      e.preventDefault();
      onSort(th);
    }
  });

  // Section toggles — power-user show/hide overriding the profile defaults.
  $('prSections').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-section]');
    if (!cb) return;
    _view.sections[cb.dataset.section] = cb.checked;
    renderInto();
  });

  $('prPrint').addEventListener('click', () => window.print());
  $('prCsv').addEventListener('click', () => {
    if (!_lastApplied) return;
    const { suffix, sections } = buildReportCsv(_lastApplied);
    if (!sections || sections.length === 0) return;
    const r = _lastApplied.range || {};
    const fileSuffix = suffix || `${r.start}_${r.end}`;
    const combined = sections.map((s) => `${s.title}\n${toCsv(s.header, s.rows)}`).join('\n');
    const blob = new Blob([combined], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `practice-report-${fileSuffix}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Honour ?preset= and ?profile= from the launcher.
  const params = new URLSearchParams(location.search);
  const preset = params.get('preset');
  if (preset) setActivePreset(preset);
  const profile = params.get('profile');
  if (profile && [...$('prProfile').options].some((o) => o.value === profile)) $('prProfile').value = profile;

  // Auto-generate if a preset was supplied (deep-linked from Condor/palette).
  if (preset) generate();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
