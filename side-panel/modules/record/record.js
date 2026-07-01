// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Record (live) — the live-first Patient Record summary tab.
//
// buildRecordSummaryText — exported pure function that converts the same data
// object render() uses into a provenance-stamped plain-text block for clipboard
// copy. DISPLAY-COPY ONLY: transcribes what is already on screen; no inference,
// no "impression", no clinical interpretation. The caveat is baked into the
// copied text so it can never be mistaken for the record itself.
//
// WHAT IT IS
// ----------
// A snapshot view of the patient currently open in Medicus, sourced LIVE from
// the same API the suite already calls (engine/api-client.js → fetchAll),
// rather than from an exported PDF. It surfaces demographics, coded problems,
// current medications (with doses), recent results, and a small set of
// deterministic prescribing-safety scores (ACB, STOPP/START) plus the live
// drug-monitoring + QOF chips Sentinel already computes.
//
// The DEEP, longitudinal lenses (multi-year consultation timeline, continuity
// indices, letters, eFI/Charlson) are NOT reachable live — they remain in the
// full PDF visualiser, reachable from the footer button "Open full visualiser".
//
// CLINICAL-SAFETY FRAMING (non-negotiable — see docs/appraisal + INTENDED-PURPOSE)
// -------------------------------------------------------------------------------
// This view is INCOMPLETE by construction and must never read as a record of
// truth. It cannot show allergies or immunisations (no live endpoint), and some
// consultation-coded entries are limited to ~400 days. Therefore:
//   - a persistent provenance banner states it is a live snapshot, verify in
//     the record;
//   - allergies / immunisations / consultation history render as explicit
//     GAP-MARKERS where the data would be, not as silent absences;
//   - each safety score carries an inline caveat that it excludes allergies and
//     uses coded problems only.
// These are load-bearing patient-safety controls, not decoration.
//
// DATA PATH (no content-script changes; panel-side fetch like sweep.js)
//   active Medicus tab URL → SentinelApiClient.detectMedicusContext → apiBase + uuid
//   (uuid fallback: getSentinelSnapshot patientContext on non-patient pages)
//   → SentinelApiClient.fetchAll → SentinelNormalisers.normaliseAll
//   → ACBScores.computeACB / StoppStart.computeStoppStart
//   live monitoring/QOF chips → getSentinelSnapshot.chips

import { copyText } from '../shared/export-util.js';

let container = null;
let _runToken = 0; // cancels stale async renders on rapid patient/tab change
let _onRuntimeMsg = null;
let _onTabChange = null;

const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// ── lifecycle ────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  container.innerHTML = shell();
  wireStaticControls();

  // Re-render when Sentinel publishes a fresh snapshot (patient changed in page)
  _onRuntimeMsg = (msg) => {
    if (msg?.type === 'sentinel:snapshot-updated') load();
  };
  chrome.runtime.onMessage.addListener(_onRuntimeMsg);

  // Re-render when the user switches the active tab (e.g. flips to a patient).
  // For onUpdated, only react to a completed navigation — not every omnibox
  // keystroke / partial load — to avoid needless refetches.
  _onTabChange = (_tabId, changeInfo) => {
    if (changeInfo && changeInfo.status && changeInfo.status !== 'complete') return;
    load();
  };
  if (chrome.tabs?.onActivated) chrome.tabs.onActivated.addListener(_onTabChange);
  if (chrome.tabs?.onUpdated) chrome.tabs.onUpdated.addListener(_onTabChange);

  await load();
}

export function cleanup() {
  _runToken++;
  if (_onRuntimeMsg) chrome.runtime.onMessage.removeListener(_onRuntimeMsg);
  if (_onTabChange) {
    if (chrome.tabs?.onActivated) chrome.tabs.onActivated.removeListener(_onTabChange);
    if (chrome.tabs?.onUpdated) chrome.tabs.onUpdated.removeListener(_onTabChange);
  }
  if (_onDelegatedClick && container) container.removeEventListener('click', _onDelegatedClick);
  _onRuntimeMsg = _onTabChange = _onDelegatedClick = null;
  _lastModel = _lastChips = _lastStamp = _lastUuid = null;
  _preflightOpen = false;
  _preflightInput = '';
  _preflightResult = null;
  _preflightRulesPromise = null;
  container = null;
}

// ── shell + static controls ──────────────────────────────────────────────────

function shell() {
  return `
    <div class="rec-root">
      <div class="rec-head">
        <div class="rec-title-row">
          <h2 class="rec-title">Patient record</h2>
          <div class="rec-title-btns">
            <button type="button" class="rec-copy-btn" id="recCopySummary" disabled title="Copy plain-text summary of what is shown on screen" aria-label="Copy summary">Copy summary</button>
            <button type="button" class="rec-refresh" id="recRefresh" title="Refresh from Medicus" aria-label="Refresh">⟳</button>
          </div>
        </div>
        <div class="rec-source" id="recSource" aria-live="polite"></div>
      </div>
      <div class="rec-body" id="recBody" aria-live="polite"></div>
      <div class="rec-foot">
        <button type="button" class="rec-deep-btn" id="recOpenDeep" title="Opens the full Patient Record Visualiser in a browser tab">
          Open full visualiser <span class="rec-deep-sub">deep history · timeline · continuity · PDF</span>
        </button>
        <p class="rec-foot-note">The multi-year timeline, continuity indices and frailty/comorbidity
          scores live in the full visualiser, built from an exported record PDF.</p>
      </div>
    </div>`;
}

// Stored so cleanup() can detach it (the body it serves is re-rendered, but the
// delegated listener lives on the persistent root).
let _onDelegatedClick = null;

// Last successfully rendered model — populated by render(), consumed by the
// Copy summary button.  Intentionally module-local; never written to storage.
let _lastModel = null;
let _lastChips = null;
let _lastStamp = null;
// Patient UUID resolved by load() (URL context or content-script fallback) for
// the rendered model — the ONLY patient identifier the event ledger may
// receive (never a name). Module-local; never written to storage by this module.
let _lastUuid = null;

// ── Pre-flight (what-if safety preview) — module-local state ────────────────
// Never written to storage; reset on cleanup(). _preflightOpen persists the
// <details> open/closed state across a re-render (a re-render happens on
// every patient-change poll, so without this the panel would keep slamming
// shut while a clinician is mid-check).
let _preflightOpen = false;
let _preflightInput = '';
let _preflightResult = null; // last runPreflightCheck() output, or 'error'
let _preflightRulesPromise = null; // cached fetch of drug-rules.json + alert-library.json

function wireStaticControls() {
  container.querySelector('#recRefresh')?.addEventListener('click', () => load(true));
  container.querySelector('#recOpenDeep')?.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('visualiser-core.html') });
    } catch (_) {
      /* no-op */
    }
  });

  // Copy summary — button lives in the shell (not re-rendered), so a direct
  // listener is fine.  Button is disabled until render() populates _lastModel.
  const copyBtn = container.querySelector('#recCopySummary');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!_lastModel) return;
      const text = buildRecordSummaryText(_lastModel, _lastChips, _lastStamp);
      const ok = await copyText(text);
      if (ok) {
        // F2 Clinical Event Ledger — record the copy (fire-and-forget; the
        // ledger swallows its own failures and can never break this button).
        window.EventLedger?.record({
          source: 'record',
          patientRef: _lastUuid,
          severity: null,
          ruleId: null,
          label: 'Copy patient summary',
          action: 'summary-copied',
        });
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        copyBtn.classList.add('rec-copy-btn--ok');
        setTimeout(() => {
          copyBtn.textContent = prev;
          copyBtn.classList.remove('rec-copy-btn--ok');
        }, 2000);
      }
    });
  }

  // Retry button lives inside the re-rendered body, so delegate from the root
  // (listener survives setBody innerHTML replacement).
  _onDelegatedClick = (e) => {
    if (e.target && e.target.id === 'recRetry') load(true);
  };
  container.addEventListener('click', _onDelegatedClick);
}

function setBody(html) {
  const b = container?.querySelector('#recBody');
  if (b) b.innerHTML = html;
}
function setSource(html, cls) {
  const s = container?.querySelector('#recSource');
  if (s) {
    s.className = 'rec-source' + (cls ? ' ' + cls : '');
    s.innerHTML = html;
  }
}

// ── load / resolve patient ───────────────────────────────────────────────────

async function findMedicusTab() {
  // Prefer the active tab; fall back to any open Medicus tab in the window.
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active[0]?.url && /medicus\.health/.test(active[0].url)) return active[0];
  const any = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
  return any[0] || null;
}

async function patientUuidFromContentScript(tabId) {
  try {
    const snap = await chrome.tabs.sendMessage(tabId, { action: 'getSentinelSnapshot' });
    return snap?.patientContext?.patientUuid || null;
  } catch (_) {
    return null;
  }
}

async function liveChips(tabId) {
  try {
    const snap = await chrome.tabs.sendMessage(tabId, { action: 'getSentinelSnapshot' });
    if (!snap || snap.unavailable) return null;
    return Array.isArray(snap.chips) ? snap.chips : null;
  } catch (_) {
    return null;
  }
}

async function load(force) {
  const token = ++_runToken;
  const apiClient = window.SentinelApiClient;
  const normalisers = window.SentinelNormalisers;

  if (!apiClient || !normalisers) {
    setSource('Engine not loaded', 'rec-source-err');
    setBody(stateCard('Unavailable', 'The record engine failed to load. Reload the panel.'));
    return;
  }

  setSource('Locating patient…');
  const tab = await findMedicusTab();
  if (token !== _runToken) return;
  if (!tab) {
    setSource('No Medicus tab open', 'rec-source-warn');
    setBody(
      stateCard(
        'Open Medicus to begin',
        'This tab shows a live summary of the patient you have open in Medicus. Open a patient record, then return here.'
      )
    );
    return;
  }

  const ctx = apiClient.detectMedicusContext(tab.url) || {};
  let uuid = ctx.patientUuid;
  if (!uuid) uuid = await patientUuidFromContentScript(tab.id);
  if (token !== _runToken) return;

  if (!ctx.apiBase || !uuid) {
    setSource('No patient open', 'rec-source-warn');
    setBody(
      stateCard(
        'No patient selected',
        'Open a patient’s record in Medicus and this summary will load automatically. ' +
          'You can still open the full visualiser below to import a record PDF.'
      )
    );
    return;
  }

  setSource('Loading live data from Medicus…', 'rec-source-loading');
  setBody(skeleton());

  let raw;
  try {
    raw = await apiClient.fetchAll(ctx.apiBase, uuid, { useCache: !force });
  } catch (e) {
    if (token !== _runToken) return;
    setSource('Couldn’t reach Medicus', 'rec-source-err');
    setBody(
      stateCard('Couldn’t load the record', 'Medicus did not respond. Check you are signed in, then retry.', true)
    );
    return;
  }
  if (token !== _runToken) return;

  const data = normalisers.normaliseAll(raw, ctx);
  const errs = data.apiErrors || {};
  const authFail = Object.values(errs).some((e) => /401|403|sign|auth/i.test(String(e)));
  if (authFail && !data.patientContext) {
    setSource('Not signed in', 'rec-source-err');
    setBody(stateCard('Sign in to Medicus', 'Your Medicus session looks signed out. Sign in, then retry.', true));
    return;
  }

  const chips = await liveChips(tab.id);
  if (token !== _runToken) return;

  _lastUuid = uuid;
  render(data, chips, errs);
}

// ── render (loaded state) ────────────────────────────────────────────────────

function render(data, chips, errs) {
  const pc = data.patientContext || {};
  const meds = data.medications || [];
  const problems = data.problems || [];
  const past = data.pastProblems || [];
  const obs = data.observations || [];

  // Source line: live + freshness
  const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  setSource(
    `<span class="rec-live-dot" aria-hidden="true"></span>LIVE from Medicus · ${esc(stamp)} · <span class="rec-snapshot-word">snapshot, not the full record</span>`,
    'rec-source-live'
  );

  // Store model so the Copy summary button can build the text on demand.
  _lastModel = data;
  _lastChips = chips;
  _lastStamp = stamp;
  const copyBtn = container?.querySelector('#recCopySummary');
  if (copyBtn) copyBtn.disabled = false;

  const partial = Object.keys(errs).length
    ? `<div class="rec-partial">⚠ Some sections didn’t load (${esc(Object.keys(errs).join(', '))}). Showing what was returned.</div>`
    : '';

  // Order follows how a clinician orients: identity → what's missing (safety
  // gaps) → what's wrong (problems) → what they're on (meds) → safety scores
  // that interrogate those → results. Scores sit AFTER problems/meds because
  // the panel critique found clinicians read the clinical picture first and
  // use the scores to confirm or challenge it.
  setBody(
    `${demographicsCard(pc)}
     ${safetyBanner()}
     ${partial}
     ${gapMarkers()}
     ${problemsCard(problems, past)}
     ${medsCard(meds)}
     ${safetyCard(meds, problems, obs, pc, chips)}
     ${preflightCard()}
     ${resultsCard(obs)}`
  );
  wirePreflightControls();
}

// ── Copy summary — plain-text builder ────────────────────────────────────────
//
// DISPLAY-COPY ONLY.  Transcribes exactly what render() puts on screen.
// No inference, no summarising, no "impression" section.  Provenance header
// and the caveat are baked in so the pasted block can never be mistaken for
// the record.
//
// Exported so test-record-summary.js can call it directly without a browser.
//
// Parameters match what render() already has:
//   model  — normaliseAll output (data)
//   chips  — live chip array (may be null)
//   stamp  — "HH:MM" string already computed by render() (so the test can
//             inject a fixed value and the copied text matches what was shown)
export function buildRecordSummaryText(model, chips, stamp) {
  const pc = (model && model.patientContext) || {};
  const meds = (model && model.medications) || [];
  const problems = (model && model.problems) || [];
  const past = (model && model.pastProblems) || [];
  const obs = (model && model.observations) || [];

  const lines = [];

  // ── Provenance header ──────────────────────────────────────────────────────
  const atStamp = stamp || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  lines.push(`Patient record summary — as at ${atStamp}`);
  lines.push('');

  // ── Demographics ───────────────────────────────────────────────────────────
  lines.push('PATIENT');
  const name = pc.patientName || 'Unknown patient';
  const demoBits = [name];
  if (pc.ageYears != null) demoBits.push(`${pc.ageYears}y`);
  if (pc.sex) demoBits.push(pc.sex);
  if (pc.dob) demoBits.push(`DOB ${pc.dob}`);
  lines.push(demoBits.join(' · '));
  if (pc.nhsNumber) {
    const nhs = String(pc.nhsNumber).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
    lines.push(`NHS ${nhs}`);
  }
  if (pc.namedGP) lines.push(`Named GP: ${pc.namedGP}`);
  if (pc.isDeceased) lines.push('[DECEASED]');
  if (pc.testPatient) lines.push('[TEST PATIENT]');
  lines.push('');

  // ── Gap markers — absence must be explicit in the copy ────────────────────
  lines.push('NOT SHOWN IN THIS SUMMARY (verify in Medicus):');
  lines.push('  Allergies & adverse reactions — not shown — verify in Medicus before prescribing');
  lines.push('  Immunisations — not shown — verify in Medicus');
  lines.push('  Consultation history — not shown — use full visualiser for the timeline');
  lines.push('');

  // ── Active problems ────────────────────────────────────────────────────────
  lines.push(`ACTIVE PROBLEMS (${problems.length})`);
  if (problems.length) {
    problems.forEach((p) => {
      const date = p.codedDate ? `  [${_fmtDatePlain(p.codedDate)}]` : '';
      const major = p.significance && /major/i.test(p.significance) ? ' *' : '';
      lines.push(`  ${p.label || ''}${major}${date}`);
    });
  } else {
    lines.push('  No active problems returned.');
  }
  if (past.length) lines.push(`  (${past.length} past/inactive problem${past.length === 1 ? '' : 's'} not shown)`);
  lines.push('');

  // ── Current medications ────────────────────────────────────────────────────
  lines.push(`CURRENT MEDICATIONS (${meds.length})`);
  if (meds.length) {
    meds.forEach((m) => {
      const flags = [];
      if (m.isOverDue) flags.push('[OVERDUE]');
      if (m.isReviewOverDue) flags.push('[REVIEW DUE]');
      let line = `  ${m.name || ''}`;
      if (flags.length) line += ` ${flags.join(' ')}`;
      lines.push(line);
      if (m.dosage) lines.push(`    ${m.dosage}`);
    });
  } else {
    lines.push('  No current medications returned.');
  }
  lines.push('');

  // ── Prescribing safety ─────────────────────────────────────────────────────
  // Transcribe score values only — the same values shown by safetyCard().
  // No additional interpretation beyond what is on screen.
  const drugObjs = meds.map((m) => ({ label: m.name }));
  const probObjs = problems.map((p) => ({ name: p.label }));
  const egfr = _latestEgfrPlain(obs);

  lines.push('PRESCRIBING SAFETY (coded data only; excludes allergies — see caveat)');

  // ACB
  let acb = null;
  try {
    acb = typeof window !== 'undefined' && window.ACBScores ? window.ACBScores.computeACB(drugObjs) : null;
  } catch (_) {
    acb = null;
  }
  if (acb) {
    const tag = acb.alert ? 'High (>=3)' : acb.total > 0 ? 'Some burden' : 'None';
    lines.push(`  Anticholinergic burden (ACB): ${acb.total} — ${tag}`);
    if (acb.perDrug && acb.perDrug.length) {
      lines.push(`    Contributing: ${acb.perDrug.map((d) => `${d.name} (${d.score})`).join(', ')}`);
    }
  }

  // STOPP/START
  let ss = null;
  try {
    ss =
      typeof window !== 'undefined' && window.StoppStart
        ? window.StoppStart.computeStoppStart({
            drugs: drugObjs,
            problems: probObjs,
            ageYears: pc.ageYears != null ? Number(pc.ageYears) : null,
            egfr,
          })
        : null;
  } catch (_) {
    ss = null;
  }
  if (Array.isArray(ss)) {
    lines.push(`  STOPP/START prompts: ${ss.length}`);
    ss.forEach((f) => {
      lines.push(`    ${f.kind ? f.kind.toUpperCase() : 'FLAG'}: ${f.criterion || ''}`);
    });
    if (!ss.length) lines.push('    No deterministic prescribing prompts on the coded data available');
  }

  // Live monitoring chips
  const monitorChips = (chips || []).filter(
    (c) => c.type === 'drug-monitoring' || c.type === 'qof-indicator' || c.type === 'qof-register'
  );
  if (monitorChips.length) {
    const overdue = monitorChips.filter((c) => /overdue|due|missing|not_/i.test(JSON.stringify(c)));
    lines.push(
      `  Live monitoring & QOF: ${overdue.length ? `${overdue.length} need attention` : 'all up to date'} (${monitorChips.length} checked)`
    );
  }

  lines.push('');

  // ── Recent results ─────────────────────────────────────────────────────────
  const named = obs.filter((o) => o.name && o.rawValue != null && o.rawValue !== '');
  const top = named.slice(0, 14);
  lines.push(`RECENT RESULTS (${named.length})`);
  if (top.length) {
    top.forEach((o) => {
      const flag = o.isAbove ? ' [HIGH]' : o.isBelow ? ' [LOW]' : '';
      const date = o.date ? `  [${_fmtDatePlain(o.date)}]` : '';
      lines.push(`  ${o.name}: ${o.value}${flag}${date}`);
    });
  } else {
    lines.push('  No recent results returned.');
  }
  lines.push('');

  // ── Caveat — verbatim, load-bearing ───────────────────────────────────────
  lines.push('Live snapshot, not a complete record. Verify against the patient record before acting.');

  return lines.join('\n');
}

// Plain-text date formatter (no HTML, used by buildRecordSummaryText).
function _fmtDatePlain(d) {
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return String(d);
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

// eGFR extraction for the plain-text path (mirrors latestEgfr without closure).
function _latestEgfrPlain(obs) {
  const e = (obs || []).find((o) => /e?gfr/i.test(o.name || ''));
  if (!e) return null;
  const n = parseFloat(String(e.rawValue));
  return Number.isFinite(n) ? n : null;
}

function demographicsCard(pc) {
  const name = pc.patientName || 'Unknown patient';
  const bits = [];
  if (pc.ageYears != null) bits.push(`${esc(pc.ageYears)}y`);
  if (pc.sex) bits.push(esc(pc.sex));
  if (pc.dob) bits.push(`DOB ${esc(pc.dob)}`);
  const nhs = pc.nhsNumber ? esc(pc.nhsNumber).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : null;
  const deceased = pc.isDeceased ? `<span class="rec-badge rec-badge-deceased">Deceased</span>` : '';
  const test = pc.testPatient ? `<span class="rec-badge rec-badge-test">Test patient</span>` : '';
  return `
    <div class="rec-demo">
      <div class="rec-demo-name">${esc(name)} ${deceased}${test}</div>
      <div class="rec-demo-meta">${bits.join(' · ')}</div>
      ${nhs ? `<div class="rec-demo-nhs">NHS ${nhs}</div>` : ''}
      ${pc.namedGP ? `<div class="rec-demo-gp">Named GP: ${esc(pc.namedGP)}</div>` : ''}
    </div>`;
}

function safetyBanner() {
  return `
    <div class="rec-warn-banner" role="note">
      <strong>Live snapshot — not a complete record.</strong>
      Always verify against the patient record before acting.
    </div>`;
}

// Persistent gap-markers: surface what is NOT in the live view, where a reader
// would otherwise assume absence means "none recorded".
function gapMarkers() {
  return `
    <div class="rec-gaps" role="group" aria-label="Data not available in the live view">
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Allergies &amp; adverse reactions</span>
        <span class="rec-gap-val">Not shown in the live view — check the record before prescribing</span>
      </div>
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Immunisations</span>
        <span class="rec-gap-val">Not shown in the live view — check the record</span>
      </div>
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Consultation history</span>
        <span class="rec-gap-val">Not shown here — use “Open full visualiser” below for the timeline</span>
      </div>
    </div>`;
}

// ── safety scores ────────────────────────────────────────────────────────────

function latestEgfr(obs) {
  const e = obs.find((o) => /e?gfr/i.test(o.name || ''));
  if (!e) return null;
  const n = parseFloat(String(e.rawValue));
  return Number.isFinite(n) ? n : null;
}

function safetyCard(meds, problems, obs, pc, chips) {
  const drugObjs = meds.map((m) => ({ label: m.name })); // ACB + STOPP read .label
  const probObjs = problems.map((p) => ({ name: p.label })); // STOPP problemName reads .name

  let acb = null,
    ss = null;
  try {
    acb = window.ACBScores ? window.ACBScores.computeACB(drugObjs) : null;
  } catch (_) {
    acb = null;
  }
  try {
    ss = window.StoppStart
      ? window.StoppStart.computeStoppStart({
          drugs: drugObjs,
          problems: probObjs,
          ageYears: pc.ageYears != null ? Number(pc.ageYears) : null,
          egfr: latestEgfr(obs),
        })
      : null;
  } catch (_) {
    ss = null;
  }

  const monitorChips = (chips || []).filter(
    (c) => c.type === 'drug-monitoring' || c.type === 'qof-indicator' || c.type === 'qof-register'
  );

  const rows = [];

  // ACB — anticholinergic cognitive burden (sum of per-drug ACB scores)
  if (acb) {
    const cls = acb.alert ? 'rec-score-alert' : acb.total > 0 ? 'rec-score-mid' : 'rec-score-ok';
    rows.push(
      scoreRow(
        'Anticholinergic burden (ACB)',
        String(acb.total),
        cls,
        acb.alert ? 'High (≥3)' : acb.total > 0 ? 'Some burden' : 'None',
        acb.perDrug && acb.perDrug.length
          ? acb.perDrug.map((d) => `${esc(d.name)} (${esc(String(d.score))})`).join(', ')
          : 'No contributing drugs detected',
        'Anticholinergic Cognitive Burden — cumulative anticholinergic load; ≥3 raises falls/cognitive risk in older adults'
      )
    );
  }

  // STOPP/START — computeStoppStart returns a flat array of
  // { id, kind:'stopp'|'start', criterion, detail, severity }.
  if (Array.isArray(ss)) {
    const n = ss.length;
    const cls = n > 0 ? 'rec-score-mid' : 'rec-score-ok';
    const detail = n
      ? ss
          .map((f) => {
            const kind = f.kind === 'start' ? 'start' : 'stopp'; // whitelist for class name
            return `<span class="rec-ss-flag rec-ss-${kind}">${kind.toUpperCase()}</span> ${esc(f.criterion || '')}`;
          })
          .join('<br>')
      : 'No deterministic prescribing prompts on the coded data available';
    rows.push(
      scoreRow(
        'STOPP/START prompts',
        String(n),
        cls,
        n > 0 ? `${n} to review` : 'None flagged',
        detail,
        'Deterministic potentially-inappropriate-prescribing prompts (STOPP) and omission prompts (START), v3'
      )
    );
  }

  // Live monitoring / QOF chips (already computed by the Monitoring engine).
  // Headline the number NEEDING ATTENTION (not the bare total), so a green
  // "all clear" can never sit beside an outstanding item.
  const overdue = monitorChips.filter((c) => /overdue|due|missing|not_/i.test(JSON.stringify(c)));
  if (monitorChips.length) {
    const n = overdue.length;
    rows.push(
      scoreRow(
        'Live monitoring &amp; QOF',
        String(n),
        n ? 'rec-score-mid' : 'rec-score-ok',
        n ? `need attention · ${monitorChips.length} checked` : `all up to date · ${monitorChips.length} checked`,
        'From the Monitoring engine on this patient’s live record. Open the Monitoring tab for detail.',
        'Drug-monitoring and QOF reminders for this patient, from the Monitoring engine'
      )
    );
  }

  const body = rows.length
    ? rows.join('')
    : `<div class="rec-empty">No safety scores available for this patient yet.</div>`;

  return `
    <section class="rec-card">
      <h3 class="rec-card-h">Prescribing safety</h3>
      <p class="rec-caveat">These scores exclude allergies and use coded data only. A clear score is
        <strong>not</strong> a complete safety check — read the record. Supplementary to Medicus’s own systems.</p>
      ${body}
    </section>`;
}

function scoreRow(label, value, cls, tag, detail, tip) {
  const tipAttr = tip ? ` title="${esc(tip)}"` : '';
  return `
    <div class="rec-score ${cls}">
      <div class="rec-score-top">
        <span class="rec-score-label"${tipAttr}>${label}</span>
        <span class="rec-score-val">${esc(value)}</span>
        <span class="rec-score-tag">${esc(tag)}</span>
      </div>
      <div class="rec-score-detail">${detail}</div>
    </div>`;
}

// ── Pre-flight (what-if safety preview) ──────────────────────────────────────
//
// Runs engine/preflight.js's runPreflightCheck over "current meds + one
// proposed drug", reusing the SAME normalised data this module already holds
// (no new fetch). See engine/preflight.js header for the composition detail
// (ACB, STOPP/START, drug-monitoring, drug-combo interaction rules — all
// existing engines, nothing duplicated here).
//
// Rule files (drug-rules.json + alert-library.json) are fetched once per
// panel session and cached — they ship with the extension and never change
// at runtime, same assumption sentinel.js's rule-currency footer makes.
function loadPreflightRuleFiles() {
  if (_preflightRulesPromise) return _preflightRulesPromise;
  _preflightRulesPromise = (async () => {
    const base = chrome.runtime.getURL('rules/');
    const [drugRules, alertLibrary] = await Promise.all([
      fetch(base + 'drug-rules.json').then((r) => r.json()),
      fetch(base + 'alert-library.json').then((r) => r.json()),
    ]);
    return { drugRules, alertLibrary };
  })();
  return _preflightRulesPromise;
}

function preflightCard() {
  const openAttr = _preflightOpen ? ' open' : '';
  return `
    <details class="rec-preflight" id="recPreflight"${openAttr}>
      <summary class="rec-preflight-summary">Pre-flight — check a drug before prescribing</summary>
      <div class="rec-preflight-body">
        <p class="rec-preflight-intro">Checks a proposed drug against this patient's current medications and
          problems using the same engines as the rest of the suite — before it is prescribed.</p>
        <div class="rec-preflight-row">
          <input type="text" class="rec-preflight-input" id="recPreflightInput" placeholder="Drug name, e.g. Trimethoprim"
            value="${esc(_preflightInput)}" autocomplete="off" spellcheck="false" />
          <button type="button" class="rec-preflight-btn" id="recPreflightCheck">Check</button>
        </div>
        <div id="recPreflightResult">${preflightResultHtml()}</div>
      </div>
    </details>`;
}

function preflightResultHtml() {
  if (_preflightResult === null) return '';
  if (_preflightResult === 'error') {
    return `<div class="rec-preflight-empty">Couldn’t load the rule files to run this check. Try again.</div>`;
  }
  const r = _preflightResult;

  const sections = [];

  // ACB delta
  if (r.acb) {
    const cls = r.acb.escalates ? 'rec-pf-alert' : r.acb.delta > 0 ? 'rec-pf-mid' : 'rec-pf-ok';
    const bandNote = r.acb.escalates ? ` — moves burden band ${esc(r.acb.currentBand)} → ${esc(r.acb.band)}` : '';
    sections.push(`
      <div class="rec-pf-section ${cls}">
        <div class="rec-pf-section-h">Anticholinergic burden (ACB)</div>
        <div class="rec-pf-section-body">${r.acb.current} → ${r.acb.projected}${bandNote ? esc(bandNote) : ''} (${r.acb.delta >= 0 ? '+' : ''}${r.acb.delta})</div>
      </div>`);
  }

  // STOPP/START — only NEW flags introduced by the addition
  if (Array.isArray(r.stoppStart)) {
    if (r.stoppStart.length) {
      const items = r.stoppStart
        .map((f) => {
          const kind = f.kind === 'start' ? 'start' : 'stopp';
          return `<li><span class="rec-ss-flag rec-ss-${kind}">${kind.toUpperCase()}</span> ${esc(f.criterion || '')}</li>`;
        })
        .join('');
      sections.push(`
        <div class="rec-pf-section rec-pf-alert">
          <div class="rec-pf-section-h">STOPP/START prompts this would introduce (${r.stoppStart.length})</div>
          <ul class="rec-pf-list">${items}</ul>
        </div>`);
    } else {
      sections.push(`
        <div class="rec-pf-section rec-pf-ok">
          <div class="rec-pf-section-h">STOPP/START</div>
          <div class="rec-pf-section-body">No new prompts introduced by this addition.</div>
        </div>`);
    }
  }

  // Interactions with current medications
  if (r.interactions.length) {
    const items = r.interactions
      .map((i) => {
        const cls = i.status === 'alert' ? 'rec-pf-alert' : i.status === 'caution' ? 'rec-pf-mid' : 'rec-pf-ok';
        return `
          <div class="rec-pf-section ${cls}">
            <div class="rec-pf-section-h">${esc(i.label || i.ruleId)}</div>
            <div class="rec-pf-section-body">${esc(i.notes || '')}</div>
            ${i.source ? `<div class="rec-pf-source">${esc(i.source)}</div>` : ''}
          </div>`;
      })
      .join('');
    sections.push(
      `<div class="rec-pf-group"><div class="rec-pf-group-h">Interactions with current medications (${r.interactions.length})</div>${items}</div>`
    );
  } else {
    sections.push(`
      <div class="rec-pf-section rec-pf-ok">
        <div class="rec-pf-section-h">Interactions with current medications</div>
        <div class="rec-pf-section-body">No interaction alert against this patient's current medications in local rules.</div>
      </div>`);
  }

  // Monitoring this addition would introduce, distinguishing satisfied vs missing
  if (r.monitoring.length) {
    const items = r.monitoring
      .map((m) => {
        const testItems = m.tests
          .map((t) => {
            const cls = t.satisfied ? 'rec-pf-test-ok' : 'rec-pf-test-missing';
            const detail = t.satisfied
              ? t.latestResult
                ? `baseline satisfied — ${esc(t.latestResult.value != null ? String(t.latestResult.value) : '')} on ${esc(fmtDate(t.latestResult.date))}`
                : 'baseline satisfied'
              : 'baseline missing — no recent result on file';
            return `<li class="${cls}"><span class="rec-pf-test-name">${esc(t.name)}</span> — ${detail}</li>`;
          })
          .join('');
        return `
          <div class="rec-pf-section rec-pf-mid">
            <div class="rec-pf-section-h">${esc(m.drugClass ? `${m.drugClass} monitoring` : 'Monitoring')}</div>
            <ul class="rec-pf-list">${testItems}</ul>
            ${m.sharedCare ? `<div class="rec-pf-source">Shared-care monitoring</div>` : ''}
            ${m.source ? `<div class="rec-pf-source">${esc(m.source)}</div>` : ''}
          </div>`;
      })
      .join('');
    sections.push(
      `<div class="rec-pf-group"><div class="rec-pf-group-h">Monitoring this drug would require (${r.monitoring.length})</div>${items}</div>`
    );
  }

  const unknownNote = !r.known
    ? `<div class="rec-pf-unknown">No local rules mention this drug — this is not evidence of safety.</div>`
    : '';

  return `
    ${unknownNote}
    ${sections.join('')}
    <p class="rec-pf-caveat">${esc(r.caveat)}</p>`;
}

function wirePreflightControls() {
  const details = container?.querySelector('#recPreflight');
  if (details) {
    details.addEventListener('toggle', () => {
      _preflightOpen = details.open;
    });
  }
  const input = container?.querySelector('#recPreflightInput');
  const btn = container?.querySelector('#recPreflightCheck');
  const runCheck = () => runPreflight();
  if (input) {
    input.addEventListener('input', () => {
      _preflightInput = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runCheck();
      }
    });
  }
  if (btn) btn.addEventListener('click', runCheck);
}

async function runPreflight() {
  const name = (_preflightInput || '').trim();
  if (!name || !_lastModel) return;
  _preflightOpen = true;

  const resultEl = container?.querySelector('#recPreflightResult');
  if (resultEl) resultEl.innerHTML = `<div class="rec-preflight-loading">Checking…</div>`;

  const Preflight = typeof window !== 'undefined' ? window.Preflight : null;
  if (!Preflight) {
    _preflightResult = 'error';
    if (resultEl) resultEl.innerHTML = preflightResultHtml();
    return;
  }

  let ruleFiles;
  try {
    ruleFiles = await loadPreflightRuleFiles();
  } catch (_) {
    _preflightResult = 'error';
    if (resultEl) resultEl.innerHTML = preflightResultHtml();
    return;
  }

  const pc = _lastModel.patientContext || {};
  const patientContext = {
    medications: _lastModel.medications || [],
    problems: _lastModel.problems || [],
    observations: _lastModel.observations || [],
    ageYears: pc.ageYears != null ? Number(pc.ageYears) : null,
    sex: pc.sex || null,
  };

  try {
    _preflightResult = Preflight.runPreflightCheck(patientContext, name, ruleFiles);
  } catch (_) {
    _preflightResult = 'error';
  }

  // F2 Clinical Event Ledger — record that a pre-flight check ran. The label
  // is the MATCHED rule/drug state (matchedTerm / drugClass / ruleId from the
  // engines), or 'unknown' when no local rule mentions the drug — NEVER the
  // free-typed input, so arbitrary typed text is never logged. Fire-and-forget.
  if (window.EventLedger && _preflightResult && _preflightResult !== 'error') {
    const r = _preflightResult;
    const mon = r.monitoring[0];
    const inter = r.interactions[0];
    const matched =
      (mon && (mon.matchedTerm || mon.drugClass || mon.ruleId)) ||
      (inter && (inter.ruleId || inter.label)) ||
      (r.stoppStart[0] && r.stoppStart[0].id) ||
      null;
    const severity =
      r.interactions.some((i) => i.status === 'alert') || r.stoppStart.length
        ? 'red'
        : r.interactions.length || r.monitoring.length || (r.acb && r.acb.escalates)
          ? 'amber'
          : null;
    window.EventLedger.record({
      source: 'preflight',
      patientRef: _lastUuid,
      severity,
      ruleId: (mon && mon.ruleId) || (inter && inter.ruleId) || null,
      label: r.known ? matched || 'known drug (ACB-scored)' : 'unknown',
      action: 'preflight-run',
    });
  }
  // Re-render just the result region — the input/button stay untouched so
  // focus and the typed value are not disturbed by this update.
  const resultElAfter = container?.querySelector('#recPreflightResult');
  if (resultElAfter) resultElAfter.innerHTML = preflightResultHtml();
}

// ── problems ─────────────────────────────────────────────────────────────────

function problemsCard(active, past) {
  const items = active.length
    ? active
        .map(
          (p) =>
            `<li class="rec-prob ${p.significance && /major/i.test(p.significance) ? 'rec-prob-major' : ''}">
               <span class="rec-prob-name">${esc(p.label)}</span>
               ${p.codedDate ? `<span class="rec-prob-date">${esc(fmtDate(p.codedDate))}</span>` : ''}
             </li>`
        )
        .join('')
    : `<li class="rec-empty">No active problems returned.</li>`;
  return `
    <section class="rec-card">
      <h3 class="rec-card-h">Active problems <span class="rec-count">${active.length}</span></h3>
      <ul class="rec-list">${items}</ul>
      ${past.length ? `<div class="rec-window">${past.length} past/inactive problem${past.length === 1 ? '' : 's'} not shown</div>` : ''}
      <div class="rec-window">Active, coded problems · full history</div>
    </section>`;
}

// ── medications ──────────────────────────────────────────────────────────────

function medsCard(meds) {
  const items = meds.length
    ? meds
        .map((m) => {
          const flags = [];
          if (m.isOverDue) flags.push('<span class="rec-med-flag rec-med-overdue">overdue</span>');
          if (m.isReviewOverDue) flags.push('<span class="rec-med-flag rec-med-review">review due</span>');
          return `
            <li class="rec-med">
              <div class="rec-med-name">${esc(m.name)} ${flags.join('')}</div>
              ${m.dosage ? `<div class="rec-med-dose">${esc(m.dosage)}</div>` : ''}
              <div class="rec-med-meta">${[m.source, m.quantity].filter(Boolean).map(esc).join(' · ')}</div>
            </li>`;
        })
        .join('')
    : `<li class="rec-empty">No current medications returned.</li>`;
  return `
    <section class="rec-card">
      <h3 class="rec-card-h">Current medications <span class="rec-count">${meds.length}</span></h3>
      <ul class="rec-list">${items}</ul>
      <div class="rec-window">Current repeats + acute (last 12m) · with doses · excludes discontinued</div>
    </section>`;
}

// ── results ──────────────────────────────────────────────────────────────────

function resultsCard(obs) {
  // De-duplicate to per-analyte latest (normaliseObservations already does this,
  // but also emits group aggregates — keep named analytes, drop pure aggregates
  // that duplicate a group with no unit).
  const named = obs.filter((o) => o.name && o.rawValue != null && o.rawValue !== '');
  const top = named.slice(0, 14);
  const items = top.length
    ? top
        .map((o) => {
          const flag = o.isAbove ? 'rec-res-high' : o.isBelow ? 'rec-res-low' : '';
          const arrow = o.isAbove
            ? '<span class="rec-res-arrow" aria-label="above range">↑</span>'
            : o.isBelow
              ? '<span class="rec-res-arrow" aria-label="below range">↓</span>'
              : '';
          return `
            <li class="rec-res ${flag}">
              <span class="rec-res-name">${esc(o.name)}</span>
              <span class="rec-res-val">${esc(o.value)} ${arrow}</span>
              ${o.date ? `<span class="rec-res-date">${esc(fmtDate(o.date))}</span>` : ''}
            </li>`;
        })
        .join('')
    : `<li class="rec-empty">No recent results returned.</li>`;
  return `
    <section class="rec-card">
      <h3 class="rec-card-h">Recent results <span class="rec-count">${named.length}</span></h3>
      <ul class="rec-list rec-res-list">${items}</ul>
      <div class="rec-window">Latest value per test · full lab history available · journal-coded entries limited to ~400 days</div>
    </section>`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  // Accept ISO "YYYY-MM-DD" or display strings; render compact GB date.
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return String(d);
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function skeleton() {
  const row = `<div class="rec-skel-row"><div class="rec-skel-bar"></div><div class="rec-skel-bar short"></div></div>`;
  return `
    <div class="rec-skel" aria-busy="true" aria-label="Loading">
      <div class="rec-skel-head"></div>
      ${row}${row}${row}${row}
    </div>`;
}

// Monochrome reticle glyph — the brand mark's geometry (ring + cardinal ticks +
// centre dot) echoed into the chrome. Faint/currentColor, no brand cyan (the
// doctrine keeps the brand colours out of the clinical UI).
const RETICLE_GLYPH = `<svg class="rec-state-glyph" width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="16" cy="16" r="9"/><line x1="16" y1="2.5" x2="16" y2="7"/><line x1="16" y1="25" x2="16" y2="29.5"/><line x1="2.5" y1="16" x2="7" y2="16"/><line x1="25" y1="16" x2="29.5" y2="16"/><circle cx="16" cy="16" r="2.4" fill="currentColor" stroke="none"/></svg>`;

function stateCard(title, msg, retry) {
  return `
    <div class="rec-state">
      ${RETICLE_GLYPH}
      <div class="rec-state-title">${esc(title)}</div>
      <div class="rec-state-msg">${esc(msg)}</div>
      ${retry ? `<button class="rec-retry" id="recRetry">Retry</button>` : ''}
    </div>`;
}
