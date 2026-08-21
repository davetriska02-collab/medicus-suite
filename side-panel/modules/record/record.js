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
// truth. Consultation history is never in the live view. Allergies and
// immunisations arrive only when the transactional feed offers them — when it
// does not, they render as explicit GAP-MARKERS (never silent absence, never
// "none"). When the feed DID retrieve them, the gap marker is omitted so the
// screen cannot contradict itself (H-032). Therefore:
//   - a persistent provenance banner states it is a live snapshot, verify in
//     the record;
//   - unretrieved allergies / immunisations / consultation history render as
//     GAP-MARKERS where the data would be;
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
//
// Transactional feed (shared/panel-txn-feed.js): offered ALONGSIDE the session
// fetch above, not instead of it — see buildRecordModel() below. A practice
// stays on the session path unless integrationMode is explicitly
// 'transactional' (getTxnBundleIfEnabled() returns null in every other case,
// never throws). shared/fhir-normaliser.js's per-item field coverage is
// re-audited section by section in buildRecordModel()'s comment as it grows —
// as of v3.165.0's enrichment (dosage, observation range flags, problem
// significance), medications and observations still each lack one field
// their renderer needs (overdue/review-due/quantity; rawValue, respectively)
// and patientContext still lacks isDeceased/testPatient/namedGP, so those
// three keep preferring the session result; problems/pastProblems now carry
// everything problemsCard reads and are bundle-preferred in transactional
// mode. allergies/immunisations are used outright (the session feed has
// never had either) and also power the drug-allergy safety prompt in
// safetyCard() (see buildAllergyPrompts()). Session remains the fallback
// wherever the bundle doesn't supply a field/section. A one-line "Data: API
// feed"/"Data: session" provenance note (feedSourceLabel()) reflects which
// bundle was primary for the record AS A WHOLE (not per-field). See the
// detailed per-section comment at buildRecordModel().
//
// "Since last visit" (shared/record-delta.js, global SentinelRecordDelta,
// lazy-loaded — see loadRecordDelta()): a per-patient fingerprint of
// allergies/problems/medications/immunisations is diffed against the last
// time this patient's snapshot was rendered (chrome.storage.local key
// `brief.fp.<uuid>`) and surfaced as a short "what's new" section at the top
// of the tab. Works against either feed above, since both produce the same
// normalised bundle shape. Wrapped end-to-end in try/catch: a delta failure
// only ever omits the section, never the rest of the tab.

import { copyText } from '../shared/export-util.js';
import { isChipActionNeeded } from '../sentinel/sentinel-core.js';
import { getTxnBundleIfEnabled, feedSourceLabel } from '../../../shared/panel-txn-feed.js';
import { buildSmrPack } from './smr-pack-core.js';
import { chooseMedicusTab, isPopOutPath } from '../../../shared/medicus-tab-choice.js';
export { chooseMedicusTab };

let container = null;
let _runToken = 0; // cancels stale async renders on rapid patient/tab change
let _onRuntimeMsg = null;
let _onTabChange = null;
let _onLetterheadChange = null;

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

  await loadLetterhead();
  _onLetterheadChange = (changes, area) => {
    if (area === 'local' && changes['suite.letterhead']) {
      _letterhead = changes['suite.letterhead'].newValue || {};
    }
  };
  if (chrome.storage?.onChanged) chrome.storage.onChanged.addListener(_onLetterheadChange);

  await load();
  // The loader only honours the RETURNED cleanup (module-loader.js setCleanup)
  // — without this line cleanup() was dead code and every Record visit leaked
  // its four listeners permanently (audit C3, 2026-07-18). Guarded by
  // test-module-lifecycle.js.
  return cleanup;
}

export function cleanup() {
  _runToken++;
  if (_onRuntimeMsg) chrome.runtime.onMessage.removeListener(_onRuntimeMsg);
  if (_onTabChange) {
    if (chrome.tabs?.onActivated) chrome.tabs.onActivated.removeListener(_onTabChange);
    if (chrome.tabs?.onUpdated) chrome.tabs.onUpdated.removeListener(_onTabChange);
  }
  if (_onLetterheadChange && chrome.storage?.onChanged) {
    chrome.storage.onChanged.removeListener(_onLetterheadChange);
  }
  if (_onDelegatedClick && container) container.removeEventListener('click', _onDelegatedClick);
  _onRuntimeMsg = _onTabChange = _onDelegatedClick = _onLetterheadChange = null;
  _lastModel = _lastChips = _lastStamp = _lastUuid = null;
  _lastTabId = null;
  _letterhead = {};
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
            <button type="button" class="rec-copy-btn" id="recSmrPack" disabled title="Open a printable SMR (structured medication review) prep pack for this patient" aria-label="SMR prep pack">SMR prep pack</button>
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
// Tab we last successfully resolved a patient from — used instead of
// chrome.tabs.query()[0] when the focused tab is not Medicus (wrong-patient
// guard: any[0] is window order, not "the patient you were just looking at").
let _lastTabId = null;

// Practice letterhead ({ practiceName, clinicianName }) used to auto-fill the
// SMR prep pack sign-off, read from 'suite.letterhead'. Same convention as
// sentinel.js's _letterhead — loaded once on init, kept fresh via
// chrome.storage.onChanged. Module-local; never written to storage here.
let _letterhead = {};

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

  // SMR prep pack — button lives in the shell (not re-rendered), same pattern
  // as Copy summary. Button is disabled until render() populates _lastModel.
  const smrBtn = container.querySelector('#recSmrPack');
  if (smrBtn) {
    smrBtn.addEventListener('click', () => onPrintSmrPack());
  }

  // Retry button lives inside the re-rendered body, so delegate from the root
  // (listener survives setBody innerHTML replacement).
  _onDelegatedClick = (e) => {
    if (e.target && e.target.id === 'recRetry') load(true);
  };
  container.addEventListener('click', _onDelegatedClick);
}

// ── SMR (structured medication review) prep pack ────────────────────────────
// Builds the SMR pack model, writes it to the transient 'record.smrPack' key,
// then opens smr-pack.html in a new tab. Mirror of sentinel.js's
// onPrintPassport — see that function for the pattern (this is a FORK of the
// passport feature for a clinician audience, not an extension of it).
async function onPrintSmrPack() {
  if (!_lastModel) return;
  const model = buildSmrPack(_lastModel, _lastChips, _letterhead, new Date().toISOString());
  // Nonce ties this write to the tab we are about to open. A second click
  // before the first tab reads storage overwrites the key — the first tab
  // then fails closed (empty state) instead of rendering the wrong patient.
  const packId =
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}-${Math.random()}`;
  await chrome.storage.local.set({ 'record.smrPack': { ...model, packId } });
  // best-effort PHI-at-rest backstop (mirrors passport's 60s backstop) — primary
  // clear is consume-on-read in the print tab; this covers the case where the
  // tab never renders (e.g. the user closes it before it loads). Only remove
  // OUR nonce — a later pack must not be deleted by an earlier timer.
  setTimeout(async () => {
    try {
      const r = await chrome.storage.local.get('record.smrPack');
      if (r['record.smrPack'] && r['record.smrPack'].packId === packId) {
        chrome.storage.local.remove('record.smrPack');
      }
    } catch (_) {
      /* no-op */
    }
  }, 60000);
  // F2 Clinical Event Ledger — record that a pack was generated (fire-and-forget;
  // the ledger swallows its own failures and can never break this button).
  window.EventLedger?.record({
    source: 'record',
    patientRef: _lastUuid,
    severity: null,
    ruleId: null,
    label: 'SMR prep pack generated',
    action: 'smr-pack-generated',
  });
  chrome.tabs.create({
    url: chrome.runtime.getURL('side-panel/modules/record/smr-pack.html') + '?pack=' + encodeURIComponent(packId),
  });
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

// Practice letterhead — mirrors sentinel.js's loadLetterhead() (same storage
// key, same shape). Loaded once on init; kept fresh via the onChanged listener
// wired in init()/cleanup().
async function loadLetterhead() {
  const r = await chrome.storage.local.get('suite.letterhead');
  _letterhead = r['suite.letterhead'] || {};
}

// Docked panel vs pop-out. Fail closed towards "not pop-out" so a thrown
// location read never enables the any-Medicus-tab fallback (that fallback
// is what attached Record to the wrong patient when Gmail was focused).
function isPopOutContext() {
  try {
    return isPopOutPath(location.pathname);
  } catch (_) {
    return false;
  }
}

async function findMedicusTab() {
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  let lastTab = null;
  if (_lastTabId != null) {
    try {
      lastTab = await chrome.tabs.get(_lastTabId);
    } catch (_) {
      lastTab = null;
    }
  }
  const isPopOut = isPopOutContext();
  const any = isPopOut ? await chrome.tabs.query({ url: 'https://*.medicus.health/*' }) : [];
  const { tab } = chooseMedicusTab({
    activeTab: active[0],
    lastTab,
    anyMedicusTabs: any,
    isPopOut,
  });
  return tab || null;
}

function setRecordActionsEnabled(on) {
  const copyBtn = container?.querySelector('#recCopySummary');
  const smrBtn = container?.querySelector('#recSmrPack');
  if (copyBtn) copyBtn.disabled = !on;
  if (smrBtn) smrBtn.disabled = !on;
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

  // Disable Copy / SMR immediately so a click during reload cannot emit the
  // previous patient's summary (buttons used to stay enabled until render()).
  setRecordActionsEnabled(false);
  setSource('Locating patient…');
  const tab = await findMedicusTab();
  if (token !== _runToken) return;
  if (!tab) {
    if (_lastModel) {
      // Safer than picking a random Medicus tab: keep the last snapshot and
      // re-enable actions for THAT patient only.
      setSource('Medicus tab not in focus — still showing last snapshot', 'rec-source-warn');
      setRecordActionsEnabled(true);
      return;
    }
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
  if (uuid && _lastUuid && uuid !== _lastUuid) {
    _lastModel = null;
    _lastChips = null;
    _lastStamp = null;
  }

  if (!ctx.apiBase || !uuid) {
    if (_lastModel) {
      // Same as the no-tab path: do not replace a valid snapshot with an
      // empty card while Copy/SMR still hold the previous patient.
      setSource('No patient in this tab — still showing last snapshot', 'rec-source-warn');
      setRecordActionsEnabled(true);
      return;
    }
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

  // Try the transactional feed first (best-effort; never throws — see header
  // DATA PATH note). Still followed by the ordinary session fetch below: for
  // this tab the session result remains the preferred source for most fields
  // (see buildRecordModel), so both are gathered here rather than short-
  // circuiting on a bundle alone.
  let feedBundle = null;
  try {
    feedBundle = await getTxnBundleIfEnabled(uuid);
  } catch (_) {
    feedBundle = null;
  }
  if (token !== _runToken) return;

  let sessionData = null;
  try {
    const raw = await apiClient.fetchAll(ctx.apiBase, uuid, { useCache: !force });
    sessionData = normalisers.normaliseAll(raw, ctx);
  } catch (e) {
    sessionData = null; // fall through — the txn bundle (if any) may still carry this render
  }
  if (token !== _runToken) return;

  if (!sessionData && !feedBundle) {
    setSource('Couldn’t reach Medicus', 'rec-source-err');
    setBody(
      stateCard('Couldn’t load the record', 'Medicus did not respond. Check you are signed in, then retry.', true)
    );
    return;
  }

  const errs = (sessionData && sessionData.apiErrors) || {};
  const authFail = Object.values(errs).some((e) => /401|403|sign|auth/i.test(String(e)));
  if (sessionData && authFail && !sessionData.patientContext && !feedBundle) {
    setSource('Not signed in', 'rec-source-err');
    setBody(stateCard('Sign in to Medicus', 'Your Medicus session looks signed out. Sign in, then retry.', true));
    return;
  }

  const data = buildRecordModel(sessionData, feedBundle);

  const chips = await liveChips(tab.id);
  if (token !== _runToken) return;

  _lastUuid = uuid;
  _lastTabId = tab.id;
  await render(data, chips, errs, { feedBundle, token, uuid });
}

// Combine the session-normalised model with the (optional) transactional
// bundle into the single shape render() consumes.
//
// RE-AUDITED for v3.165.0's shared/fhir-normaliser.js enrichment (dosage,
// observation range flags, problem significance) — the original v3.164.0
// justification ("the bundle is thinner") has PARTIALLY expired. Checked
// field-by-field against what each section's renderer actually reads:
//
//   patientContext — STILL session-fed. The bundle's patientContext (see
//     shared/fhir-normaliser.js normaliseCareRecord) has no isDeceased,
//     testPatient or namedGP — demographicsCard renders all three, and the
//     deceased badge is a load-bearing safety control per this module's
//     header. v3.165.0 didn't touch patientContext at all. Falls back to the
//     bundle only if the session fetch failed outright.
//
//   medications — STILL session-fed. The bundle now carries `dosage`
//     (v3.165.0), which covers medsCard's `m.dosage` line, but still has no
//     `isOverDue` / `isReviewOverDue` (medsCard's "overdue" / "review due"
//     flags) and no `quantity` (medsCard's meta line reads `m.quantity`).
//     Falls back to the bundle only if the session fetch failed outright.
//
//   observations — STILL session-fed. The bundle now carries `isAbove` /
//     `isBelow` (v3.165.0), but still has no `rawValue`: fhir-normaliser.js's
//     `observations` array deliberately strips rawValue back out after using
//     it internally to derive isAbove/isBelow (only observationHistory's
//     per-point history entries keep it). resultsCard's own filter requires
//     `o.rawValue != null && o.rawValue !== ''`, so a bundle-sourced
//     observations array would still silently render as "no results" —
//     exactly the failure mode the original comment warned about, just for a
//     narrower field now. Falls back to the bundle only if the session fetch
//     failed outright.
//
//   problems / pastProblems — FLIPPED: now bundle-preferred in transactional
//     mode, session as the fallback. v3.165.0 added `significance`
//     (ProblemSignificance extension), and the bundle already carried label/
//     code/codedDate/status — that is every field problemsCard (`p.label`,
//     `p.codedDate`, `p.significance`) and buildRecordSummaryText read. No
//     remaining gap, so there is no reason left to prefer the thinner path.
//
// observationHistory is merged through unchanged (session-first, same as
// observations above) — this module never renders it directly (it exists in
// the model for parity with the other modules — trends/sweep/signing — that
// share this normalised shape), so it wasn't part of this re-audit.
//
// allergies/immunisations have no session equivalent at all — they always
// come from the bundle when one is offered, and are what feeds the "Since
// last visit" section below, plus (allergies) the drug-allergy safety prompt
// in safetyCard() — see buildAllergyPrompts().
function buildRecordModel(sessionData, feedBundle) {
  const s = sessionData || {};
  const b = feedBundle || {};
  return {
    patientContext: s.patientContext || b.patientContext || null,
    medications: s.medications || b.medications || [],
    observations: s.observations || b.observations || [],
    observationHistory: s.observationHistory || b.observationHistory || [],
    problems: b.problems || s.problems || [],
    pastProblems: b.pastProblems || s.pastProblems || [],
    allergies: Array.isArray(b.allergies) ? b.allergies : [],
    immunisations: Array.isArray(b.immunisations) ? b.immunisations : [],
    // H-032: [] is also the no-bundle default, so "retrieved" is a separate
    // flag. Gap markers must say "not shown" only when the feed never offered
    // the section — never when we actually have (even empty) txn data.
    allergiesRetrieved: Array.isArray(b.allergies),
    immunisationsRetrieved: Array.isArray(b.immunisations),
  };
}

// ── render (loaded state) ────────────────────────────────────────────────────

async function render(data, chips, errs, opts) {
  const { feedBundle, token, uuid } = opts || {};

  // "Since last visit" — computed (and its own storage read/write performed)
  // BEFORE anything is painted, so a stale/superseded render never writes a
  // fingerprint for the wrong patient. Failures here only ever omit the
  // section (see renderSinceLastVisitSection); they must never surface as a
  // broken Record tab.
  let deltaSectionHtml = '';
  try {
    deltaSectionHtml = await renderSinceLastVisitSection(data, uuid);
  } catch (_) {
    deltaSectionHtml = '';
  }
  if (token !== undefined && token !== _runToken) return; // a newer load() has already superseded this one

  // Drug-allergy safety prompt (rendered inside safetyCard() below) — only
  // meaningful when the feed bundle supplied allergies (buildRecordModel:
  // the session path has never carried them), so this is skipped entirely
  // for a session-only render — no fetch, no evaluation, no empty state.
  // Reuses the SAME drug-rules.json fetch pre-flight already caches
  // (loadPreflightRuleFiles, below), so it costs nothing extra once either
  // has run once this panel session. Two layers of fail-soft: the rule-file
  // fetch here, and buildAllergyPrompts()'s own try/catch around the engine
  // call itself — either failure just omits the allergy prompt, never the
  // rest of the tab.
  let allergyHtml = '';
  if (Array.isArray(data.allergies) && data.allergies.length) {
    try {
      const ruleFiles = await loadPreflightRuleFiles();
      allergyHtml = buildAllergyPrompts(data, (ruleFiles && ruleFiles.drugRules && ruleFiles.drugRules.rules) || []);
    } catch (_) {
      allergyHtml = '';
    }
  }
  if (token !== undefined && token !== _runToken) return; // a newer load() has already superseded this one

  const pc = data.patientContext || {};
  const meds = data.medications || [];
  const problems = data.problems || [];
  const past = data.pastProblems || [];
  const obs = data.observations || [];

  // Source line: live + freshness + feed provenance. "API feed" only when the
  // transactional feed actually supplied the primary bundle for this render
  // (shared/panel-txn-feed.js feedSourceLabel) — otherwise "session", exactly
  // as before this feature existed.
  const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  let feedLabel = 'session';
  try {
    feedLabel = feedSourceLabel(feedBundle) === 'API' ? 'API feed' : 'session';
  } catch (_) {
    feedLabel = 'session';
  }
  setSource(
    `<span class="rec-live-dot" aria-hidden="true"></span>LIVE from Medicus · ${esc(stamp)} · <span class="rec-snapshot-word">snapshot, not the full record</span> · <span class="rec-feed-label">Data: ${esc(feedLabel)}</span>`,
    'rec-source-live'
  );

  // Store model so the Copy summary button can build the text on demand.
  _lastModel = data;
  _lastChips = chips;
  _lastStamp = stamp;
  const copyBtn = container?.querySelector('#recCopySummary');
  if (copyBtn) copyBtn.disabled = false;
  const smrBtn = container?.querySelector('#recSmrPack');
  if (smrBtn) smrBtn.disabled = false;

  const partial = Object.keys(errs).length
    ? `<div class="rec-partial">⚠ Some sections didn’t load (${esc(Object.keys(errs).join(', '))}). Showing what was returned.</div>`
    : '';

  // Order follows how a clinician orients: what changed since last time →
  // identity → what's missing (safety gaps) → what's wrong (problems) →
  // what they're on (meds) → safety scores that interrogate those → results.
  // Scores sit AFTER problems/meds because the panel critique found
  // clinicians read the clinical picture first and use the scores to confirm
  // or challenge it.
  setBody(
    `${deltaSectionHtml}
     ${demographicsCard(pc)}
     ${safetyBanner()}
     ${partial}
     ${gapMarkers(data)}
     ${problemsCard(problems, past)}
     ${medsCard(meds)}
     ${safetyCard(meds, problems, obs, pc, chips, allergyHtml)}
     ${preflightCard()}
     ${resultsCard(obs)}`
  );
  wirePreflightControls();
}

// ── "Since last visit" (shared/record-delta.js) ─────────────────────────────
//
// A per-patient fingerprint (hashed identity keys only — see shared/
// record-delta.js header) is stored per patient and diffed on every render
// against the CURRENT bundle to produce a short, human "what changed" list.
// Works identically against either feed (session or transactional) — both
// produce the same normalised bundle shape this module already renders from.
//
// STORAGE DISCIPLINE: chrome.storage.local key `brief.fp.<patientUuid>` holds
// ONLY { keys: [...hashed fingerprint keys], at: <ISO timestamp> } — exactly
// what shared/record-delta.js's fingerprintKeys() produces, plus the
// timestamp this section needs to say "since DATE". The hashed keys carry no
// PHI (see that module's header); the human-readable added-item LABELS shown
// below are read fresh off the CURRENT bundle at render time and are never
// written to storage.
const BRIEF_FP_PREFIX = 'brief.fp.';
const BRIEF_FP_MAX_PATIENTS = 200; // simple count-based cap, checked on every write

// shared/record-delta.js is a classic global-style script (window.
// SentinelRecordDelta), like the other engine globals this module already
// reads (window.ACBScores, window.StoppStart, ...) — but unlike those, it is
// not preloaded by a <script> tag, so it is lazy-loaded here via a dynamic
// import of its own URL purely for the side effect of setting that global
// (the file has no ES export statements; the import's returned namespace is
// unused). Cached after the first successful load.
let _recordDeltaPromise = null;
function loadRecordDelta() {
  if (typeof window !== 'undefined' && window.SentinelRecordDelta) {
    return Promise.resolve(window.SentinelRecordDelta);
  }
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return Promise.resolve(null);
  if (!_recordDeltaPromise) {
    _recordDeltaPromise = import(chrome.runtime.getURL('shared/record-delta.js'))
      .then(() => (typeof window !== 'undefined' && window.SentinelRecordDelta) || null)
      .catch(() => null);
  }
  return _recordDeltaPromise;
}

// renderSinceLastVisitSection(data, patientUuid) -> HTML string (possibly '')
//
// Never throws (every failure path resolves to ''); render() additionally
// wraps the call in try/catch as a second layer of defence — a delta failure
// must never break the rest of the tab.
async function renderSinceLastVisitSection(data, patientUuid) {
  if (!patientUuid) return '';
  const RecordDelta = await loadRecordDelta();
  if (!RecordDelta) return '';

  const key = BRIEF_FP_PREFIX + patientUuid;
  let prevRec = null;
  try {
    const stored = await chrome.storage.local.get(key);
    prevRec = (stored && stored[key]) || null;
  } catch (_) {
    prevRec = null;
  }

  const isFirstView = !prevRec || !Array.isArray(prevRec.keys);
  let delta;
  try {
    delta = RecordDelta.recordDelta(isFirstView ? [] : prevRec.keys, data);
  } catch (_) {
    return '';
  }

  // Fire-and-forget: persist the fingerprint for the NEXT visit. Never
  // awaited — a storage write failure must not hold up (or break) this
  // render; saveFingerprint swallows its own errors.
  saveFingerprint(patientUuid, delta.nextKeys);

  return sinceLastVisitCard(delta, isFirstView, prevRec && prevRec.at);
}

async function saveFingerprint(patientUuid, nextKeys) {
  try {
    const key = BRIEF_FP_PREFIX + patientUuid;
    await chrome.storage.local.set({ [key]: { keys: nextKeys, at: new Date().toISOString() } });
    await pruneFingerprintStore();
  } catch (_) {
    /* best-effort only — never break the tab over a storage write failure */
  }
}

// Simple count-based cap: if more than BRIEF_FP_MAX_PATIENTS fingerprints are
// stored, drop the oldest (by their `at` timestamp) until back at the cap.
async function pruneFingerprintStore() {
  try {
    const all = await chrome.storage.local.get(null);
    const entries = Object.keys(all)
      .filter((k) => k.startsWith(BRIEF_FP_PREFIX))
      .map((k) => ({ key: k, at: (all[k] && all[k].at) || '' }));
    if (entries.length <= BRIEF_FP_MAX_PATIENTS) return;
    entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // oldest (smallest ISO) first
    const toRemove = entries.slice(0, entries.length - BRIEF_FP_MAX_PATIENTS).map((e) => e.key);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  } catch (_) {
    /* best-effort prune only */
  }
}

function sinceLastVisitCard(delta, isFirstView, prevAtIso) {
  let body;
  if (isFirstView) {
    body = `<div class="rec-delta-baseline">Baseline stored — changes will show from your next visit.</div>`;
  } else if (delta.added.length === 0 && delta.removedCount === 0) {
    const dateStr = prevAtIso ? fmtDate(prevAtIso) : 'last visit';
    body = `<div class="rec-delta-none">No changes since ${esc(dateStr)}.</div>`;
  } else {
    const items = delta.added
      .map((a) => `<li class="rec-delta-item rec-delta-${esc(a.kind)}">+ ${esc(a.kind)}: ${esc(a.label)}</li>`)
      .join('');
    const removedNote = delta.removedCount
      ? `<li class="rec-delta-item rec-delta-removed">${delta.removedCount} item${delta.removedCount === 1 ? '' : 's'} no longer present — review</li>`
      : '';
    body = `<ul class="rec-delta-list">${items}${removedNote}</ul>`;
  }
  return `
    <section class="rec-card rec-delta-card">
      <h3 class="rec-card-h">Since last visit</h3>
      ${body}
    </section>`;
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
  // Only claim "not shown" for sections the live view structurally lacks.
  // When the transactional feed retrieved allergies/imms, saying "not shown"
  // while allergy chips sit on screen is an H-032 contradiction.
  lines.push('NOT SHOWN IN THIS SUMMARY (verify in Medicus):');
  if (!(model && model.allergiesRetrieved)) {
    lines.push('  Allergies & adverse reactions — not shown — verify in Medicus before prescribing');
  } else if (Array.isArray(model.allergies) && model.allergies.length) {
    lines.push(`ALLERGIES (${model.allergies.length}) — shown on screen; verify in Medicus before prescribing`);
    model.allergies.forEach((a) => {
      const label = (a && (a.label || a.name || a.substance)) || '';
      if (label) lines.push(`  ${label}`);
    });
  } else {
    lines.push(
      '  Allergies & adverse reactions — live feed returned none recorded here — still verify in Medicus before prescribing'
    );
  }
  if (!(model && model.immunisationsRetrieved)) {
    lines.push('  Immunisations — not shown — verify in Medicus');
  } else if (!(Array.isArray(model.immunisations) && model.immunisations.length)) {
    lines.push('  Immunisations — live feed returned none recorded here — still verify in Medicus');
  }
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
    const overdue = monitorChips.filter((c) => isChipActionNeeded(c.status));
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

// ── Drug-allergy safety prompt ───────────────────────────────────────────────
//
// buildAllergyPrompts(model, rules) -> HTML string (possibly '')
//
// `allergies` is ONLY populated on the transactional feed (buildRecordModel:
// `allergies: b.allergies || []` — the session path has never carried it),
// so this is the first place the Record tab can run a drug-allergy safety
// check. It reuses the SAME engine content-scripts/sentinel.js already
// threads allergies through (window.SentinelRules.evaluatePatient with an
// `allergies` option — see engine/rules-engine.js's evaluateDrugAllergyRule)
// and the SAME chip renderer (shared/chip-renderer.js's
// renderDrugAllergyChip) sentinel.js uses to draw the resulting
// { type:'drug-allergy', ... } chip. No matching logic (active-only allergy
// filter, allergy-term / drug-set matching) is reimplemented here — the
// engine owns all of it, exactly as it does everywhere else this rule type
// is evaluated.
//
// `rules` is the raw rules array as read from rules/drug-rules.json (mixed
// rule types) — filtered down to `type === 'drug-allergy'` here, the same
// way test-drug-allergy.js's "real starter pack" test does.
//
// Two callers rely on the exact contract below:
//   - render() (browser): only calls this when data.allergies.length, i.e.
//     the feed bundle supplied allergies — so the "no allergies data exists
//     (session-only)" case never even reaches this function in practice.
//   - test-record-allergy-prompts.js (Node, no browser): calls it directly
//     with model.allergies == [] / undefined to pin that "no evaluation is
//     attempted" — see the early return below.
//
// FAIL-SOFT end-to-end: any failure (missing engine/renderer globals, a
// malformed rule, the engine itself throwing) collapses to '' — a broken
// allergy check must never take down the rest of the Record tab, and must
// never be mistaken for "no allergy found" (it simply omits the prompt).
//
// Exported (like buildRecordSummaryText above) so test-record-allergy-
// prompts.js can exercise it directly, with the REAL engine and REAL
// rules/drug-rules.json, without a browser.
export function buildAllergyPrompts(model, rules) {
  try {
    const m = model || {};
    const allergies = Array.isArray(m.allergies) ? m.allergies : [];
    // No allergy data (session-only render, or an empty feed bundle) — return
    // without ever calling the engine. Matches the engine's own fail-closed
    // semantics (evaluateDrugAllergyRule returns [] on empty allergies) but
    // avoids paying for a rule-set filter + evaluatePatient call for nothing.
    if (!allergies.length) return '';

    const SentinelRules = typeof window !== 'undefined' ? window.SentinelRules : null;
    const ChipRenderer = typeof window !== 'undefined' ? window.ChipRenderer : null;
    if (!SentinelRules || !ChipRenderer) return '';

    const allergyRules = (Array.isArray(rules) ? rules : []).filter((r) => r && r.type === 'drug-allergy');
    if (!allergyRules.length) return '';

    const out = SentinelRules.evaluatePatient(m.medications || [], m.observations || [], allergyRules, {
      problems: m.problems || [],
      patientContext: m.patientContext || null,
      allergies,
    });
    const chips = (out && (out.chips || out)) || [];
    const fired = (Array.isArray(chips) ? chips : []).filter((c) => c && c.type === 'drug-allergy');
    if (!fired.length) return '';

    return fired.map((c) => ChipRenderer.renderDrugAllergyChip(c)).join('');
  } catch (_) {
    return ''; // fail-soft — an allergy-check failure must only omit the prompt
  }
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
function gapMarkers(data) {
  const allergyRetrieved = !!(data && data.allergiesRetrieved);
  const immsRetrieved = !!(data && data.immunisationsRetrieved);
  const allergyEmpty = allergyRetrieved && !(data.allergies && data.allergies.length);
  const immsEmpty = immsRetrieved && !(data.immunisations && data.immunisations.length);
  // Unretrieved → "not shown". Retrieved-with-items → omit (chips/labels show
  // them). Retrieved-empty → still an explicit line (H-032: silence ≠ none).
  let allergyGap = '';
  if (!allergyRetrieved) {
    allergyGap = `
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Allergies &amp; adverse reactions</span>
        <span class="rec-gap-val">Not shown in the live view — check the record before prescribing</span>
      </div>`;
  } else if (allergyEmpty) {
    allergyGap = `
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Allergies &amp; adverse reactions</span>
        <span class="rec-gap-val">Live feed returned none recorded here — still verify in Medicus before prescribing</span>
      </div>`;
  }
  let immsGap = '';
  if (!immsRetrieved) {
    immsGap = `
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Immunisations</span>
        <span class="rec-gap-val">Not shown in the live view — check the record</span>
      </div>`;
  } else if (immsEmpty) {
    immsGap = `
      <div class="rec-gap" role="note">
        <span class="rec-gap-label">Immunisations</span>
        <span class="rec-gap-val">Live feed returned none recorded here — still verify in the record</span>
      </div>`;
  }
  return `
    <div class="rec-gaps" role="group" aria-label="Data not available in the live view">
      ${allergyGap}
      ${immsGap}
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

function safetyCard(meds, problems, obs, pc, chips, allergyHtml) {
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
  const overdue = monitorChips.filter((c) => isChipActionNeeded(c.status));
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

  // Drug-allergy alert(s) — pre-built HTML from buildAllergyPrompts() (real
  // engine chips, rendered via the SAME ChipRenderer.renderDrugAllergyChip
  // content-scripts/sentinel.js uses for this exact chip type). Only present
  // when the feed bundle supplied allergies AND at least one rule fired —
  // '' otherwise, so a session-only render (or an allergy-free/no-match
  // outcome) adds nothing here at all. Shown first (most acute finding),
  // ahead of the caveat below — which still accurately describes the SCORES
  // that follow it, not this alert.
  const allergySection = allergyHtml
    ? `<div class="rec-allergy-alerts" role="group" aria-label="Drug-allergy alerts">${allergyHtml}</div>`
    : '';

  return `
    <section class="rec-card">
      <h3 class="rec-card-h">Prescribing safety</h3>
      ${allergySection}
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
