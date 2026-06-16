// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Practice Report — page controller.
// Opened as a full browser tab (like the visualiser). Reads the practice code,
// fetches the period's data + a live snapshot, applies the chosen audience profile,
// renders the report, and wires Print/PDF + CSV.

import { resolveRange, buildReport, localISO } from './side-panel/modules/condor/report/report-data.js';
import { getProfile, applyProfile } from './side-panel/modules/condor/report/report-profiles.js';
import { buildReportHtml, buildReportCsv } from './side-panel/modules/condor/report/report-render.js';
import { fetchAllStreams } from './side-panel/modules/condor/condor-data.js';
import { computeIndex } from './side-panel/modules/condor/condor.js';
import { downloadCsv } from './side-panel/modules/shared/export-util.js';

const $ = (id) => document.getElementById(id);
let _preset = '7d';
let _lastApplied = null;

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
  let live = null;
  let ppi = null;
  try {
    live = await fetchAllStreams();
    if (live && live.siteId) ppi = computeIndex(live);
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
  out.innerHTML = buildReportHtml(_lastApplied);
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
  $('prPrint').addEventListener('click', () => window.print());
  $('prCsv').addEventListener('click', () => {
    if (!_lastApplied) return;
    const { header, rows } = buildReportCsv(_lastApplied);
    const r = _lastApplied.range || {};
    downloadCsv(`practice-report-${r.start}_${r.end}.csv`, header, rows);
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
