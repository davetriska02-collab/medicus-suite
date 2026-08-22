// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception module
//
// A reception-facing panel with three cards:
//   1. Patient — a single green/amber/red status pill for the patient open in
//      the Medicus tab; clicking it expands the action-needed monitoring/QOF
//      detail ("book the overdue bloods while they're on the phone"). Which
//      chips surface here is practice-configurable (Options → Reception);
//      filtering is shown, never silent.
//   2. Guided capture — fixed question sets per presenting problem. ALL
//      pathways ship disabled; a practice administrator must accept the
//      disclaimer in Options → Reception to enable them. Practices can edit
//      bundled pathways and author custom ones there. On a call the form is
//      the signed-off script in reception-call-script.js: two amalgam safety
//      lists, a short history set, wants + contact. Red flags still escalate
//      999/duty. Output is a structured plain-text block to copy-paste into
//      the Medicus triage entry. Capture only — the tool never triages,
//      diagnoses, or advises beyond red-flag escalation.
//   3. Book an appointment (plan D3, hazard H-051) — the shared booking panel,
//      created and destroyed WITH the capture form. It is the suite's first
//      clinical write surface aimed at non-clinical staff, so it is gated hard:
//      docked panel only, an open record required, and suppressed entirely on
//      any positive or unanswered red flag and on every sensitive pathway.
//
// Storage (managed in Options, read-only here):
//   reception.config              { enabledPathways, hiddenChipRules, disclaimerAcceptedAt,
//                                   safeguardingContact, crisisLineText, seenBundledIds }
//   reception.customPathways      [pathway]
//   reception.pathwayOverrides    { id: pathway }
//   reception.routingAttestation  { attestedBy, role, attestedAt, scope } — the CSO/partner
//                                 sign-off that lets CUSTOM/EDITED pathways suggest a
//                                 non-clinician destination. Read-only here.

'use strict';

import {
  summariseActionChips,
  evaluateRedFlags,
  buildCaptureText,
  pharmacyFirstHint,
  isSensitivePathway,
  safeguardingActionLine,
  crisisLineText,
  evaluateDisposition,
  destinationLabel,
  overrideDestinations,
} from './reception-core.js';

import {
  splitRedFlags,
  mainQuestions,
  moreQuestions,
  mainClosingIds,
  closingInOrder,
  moreClosingQuestions,
  showDurationRow,
  ownWordsLabel,
  generateAllowed,
  applyAmalgamAnswers,
  CALL_DURATION_ID,
  CALL_COURSE_ID,
} from './reception-call-script.js';

import { createBookingPanel } from '../shared/booking-panel.js';
import { bookingGateState } from '../shared/booking-panel-core.js';
import { createFirstAvailablePanel } from '../shared/first-available.js';

// Canonical "no alert ≠ monitoring complete" caveat (shared/provenance.js,
// loaded as a classic script in panel.html / pop-out.html). Fall back to the
// canonical literal if the global is somehow absent — a clinical-safety caveat
// must never silently drop.
const NO_ALERT_CAVEAT =
  (typeof window !== 'undefined' && window.Provenance && window.Provenance.CAVEATS.NO_ALERT_NOT_ALL_CLEAR) ||
  'No alert ≠ monitoring complete.';

let container = null;
let _bundledDoc = null; // reception-pathways.json document
let _config = {}; // reception.config
let _routingAttestation = null; // reception.routingAttestation (custom-routing sign-off)
let _effective = { all: [], enabled: [] };
let _snapshot = null; // last Sentinel snapshot (or null)
let _takerInitials = ''; // in-memory only, per panel session
let _pillExpanded = false;
let _onActivated = null;
let _storageListener = null;
let _patientCardGen = 0; // request-token guard against stale fetchSnapshot() resolution races
let _snapshotListener = null; // sentinel:snapshot-updated runtime listener (SPA patient change)
let _snapshotDebounce = null; // coalesces the ping bursts a patient switch produces
let _pollTimer = null; // visibility-gated backstop poll (net for a lost ping)
let _snapshotRefreshing = false; // true while Sentinel has invalidated mid-navigation
let _patientCardHtml = null; // last-rendered card body — skip no-op re-renders (focus/layout)
let _cardPatientUuid = null; // uuid behind the last render — collapses the pill on patient change
let _capturePatient = null; // patient identity PINNED when the capture form opened (see generateSummary)
let _firstAvail = null; // createFirstAvailablePanel() instance (shared with Slots), or null

const SNAPSHOT_POLL_MS = 10 * 1000;

// ── Draft autosave ────────────────────────────────────────────────────────────
// reception.captureDraft — transient working state, PHI-bearing, TTL 4 h.
// Never backed up (allowlisted in test-backup-coverage.js).
//
// SENSITIVE PATHWAYS ARE EXCLUDED ENTIRELY (pathway `sensitive: true`, e.g.
// mental-health). Suicidal-ideation free text must not sit in
// chrome.storage.local for four hours on a shared front-desk profile, so for a
// sensitive pathway there is no save, no restore banner, and any pre-existing
// stored draft is deleted the moment the form opens or the draft is read back.

const DRAFT_KEY = 'reception.captureDraft';
const DRAFT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
let _draftDebounceTimer = null;

// pathwayIsSensitive(id) — looks the id up in the resolved set (bundled, edited,
// or custom) so the guard also covers a practice fork that turns `sensitive` on.
function pathwayIsSensitive(pathwayId) {
  if (!pathwayId) return false;
  const entry = (_effective.all || []).find((e) => e.pathway && e.pathway.id === pathwayId);
  return isSensitivePathway(entry && entry.pathway);
}

async function loadDraft() {
  try {
    const r = await chrome.storage.local.get(DRAFT_KEY);
    const d = r[DRAFT_KEY];
    if (!d || typeof d !== 'object') return null;
    if (typeof d.savedAt !== 'number' || Date.now() - d.savedAt > DRAFT_TTL_MS) {
      chrome.storage.local.remove(DRAFT_KEY);
      return null;
    }
    // A draft belonging to a sensitive pathway must never be offered or restored.
    // (Reachable when a practice edit switches `sensitive` on after a draft was
    // stored, or after an upgrade — delete it rather than leave it lying around.)
    if (pathwayIsSensitive(d.pathwayId)) {
      chrome.storage.local.remove(DRAFT_KEY);
      return null;
    }
    return d;
  } catch (_) {
    return null;
  }
}

function saveDraft(pathwayId, form) {
  const fields = {};
  if (!form) return;
  // Radios: each named group — read checked value
  const radioGroups = new Set();
  form.querySelectorAll('input[type="radio"]').forEach((el) => {
    if (el.name) radioGroups.add(el.name);
  });
  radioGroups.forEach((name) => {
    const checked = form.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
    fields[name] = checked ? checked.value : '';
  });
  // Checkboxes (multi questions)
  const cbGroups = new Set();
  form.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (el.name) cbGroups.add(el.name);
  });
  cbGroups.forEach((name) => {
    fields[name] = Array.from(form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]:checked`)).map(
      (el) => el.value
    );
  });
  // Text inputs, selects, textareas — identified by name attribute
  form.querySelectorAll('input[type="text"], select, textarea').forEach((el) => {
    if (el.name) fields[el.name] = el.value;
  });
  // Initials stored separately (id=rcpInitials, no name)
  const initialsEl = form.querySelector('#rcpInitials');
  if (initialsEl) fields['__initials__'] = initialsEl.value;

  try {
    chrome.storage.local.set({
      [DRAFT_KEY]: { pathwayId, savedAt: Date.now(), fields },
    });
  } catch (_) {}
}

function scheduleDraftSave(pathwayId, form) {
  // Sensitive pathways: no autosave at all. Guarded here as well as at the call
  // site so a future caller can't reintroduce the leak by forgetting the check.
  if (pathwayIsSensitive(pathwayId)) return;
  if (_draftDebounceTimer !== null) clearTimeout(_draftDebounceTimer);
  _draftDebounceTimer = setTimeout(() => {
    _draftDebounceTimer = null;
    saveDraft(pathwayId, form);
  }, 400);
}

function clearDraft() {
  if (_draftDebounceTimer !== null) {
    clearTimeout(_draftDebounceTimer);
    _draftDebounceTimer = null;
  }
  try {
    chrome.storage.local.remove(DRAFT_KEY);
  } catch (_) {}
}

function fmtHHMM(epochMs) {
  try {
    return new Date(epochMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function restoreDraftFields(form, fields) {
  if (!form || !fields || typeof fields !== 'object') return;
  // Restore initials
  if (fields['__initials__'] !== undefined) {
    const el = form.querySelector('#rcpInitials');
    if (el) {
      el.value = fields['__initials__'];
      _takerInitials = fields['__initials__'];
    }
  }
  // Restore text inputs, selects, textareas by name
  form.querySelectorAll('input[type="text"], select, textarea').forEach((el) => {
    if (el.name && fields[el.name] !== undefined) el.value = fields[el.name];
  });
  // Restore radios
  const radioGroups = new Set();
  form.querySelectorAll('input[type="radio"]').forEach((el) => {
    if (el.name) radioGroups.add(el.name);
  });
  radioGroups.forEach((name) => {
    const val = fields[name];
    if (val) {
      const target = form.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(val)}"]`);
      if (target) target.checked = true;
    }
  });
  // Restore checkboxes
  const cbGroups = new Set();
  form.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (el.name) cbGroups.add(el.name);
  });
  cbGroups.forEach((name) => {
    const vals = fields[name];
    if (Array.isArray(vals)) {
      form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`).forEach((el) => {
        el.checked = vals.includes(el.value);
      });
    }
  });
}

// Tile organisation (reception.tilePrefs) — colour / order / sort. Display only.
let _tilePrefs = { sortMode: 'manual', order: [], colours: {} };
let _organising = false; // true → reorder/colour mode (tiles don't launch capture)
let _openColourFor = null; // pathway id whose colour palette is open, or null
let _ignoreNextTilePrefsChange = false; // skip our own storage write echo

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Leaflet suggestion handoff ────────────────────────────────────────────────
// Each pathway tile carries a small secondary "Leaflet" link — pure signposting
// to the NHS A-Z leaflet index (Leaflets tab), no clinical claim, and it never
// touches the tile's own capture-launch click.
//
// There is no exported switchModule, so the jump is done the same way as the
// other cross-tab links in this file (see rcpGotoSentinel below) and in
// today.js:64 — click the nav-tab button. The search query itself travels via
// a one-shot storage key (leaflets.pendingQuery): leaflets.js's init() reads
// it as the initial query and removes it immediately. Machine-local and
// transient — deliberately NOT added to shared/io/leaflets-io.js.

// Turn a pathway title into a plausible NHS leaflet search term. Deliberately
// simple — searchIndex() is a forgiving fuzzy match with its own "no bundled
// match" fallback (search nhs.uk directly), so this only needs to strip the
// obvious non-condition noise, not guarantee a hit.
function deriveLeafletQuery(title) {
  let q = String(title || '').trim();
  // Trailing age/context qualifier, e.g. "Headache (adult)" -> "Headache"
  q = q.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // Titles offering alternates via "/" — the first term is the more specific one
  if (q.includes('/')) q = q.split('/')[0].trim();
  // A couple of generic trailing words that don't help a leaflet search
  q = q.replace(/\s+(symptoms|problems?)$/i, '').trim();
  return q;
}

async function goToLeaflet(query) {
  try {
    await chrome.storage.local.set({ 'leaflets.pendingQuery': query });
  } catch (_) {
    // best-effort — worst case the Leaflets tab just opens with a blank search
  }
  document.querySelector('.nav-tab[data-module="leaflets"]')?.click();
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _organising = false;
  _openColourFor = null;
  _snapshotRefreshing = false;
  _patientCardHtml = null; // the card body was just re-created — never skip its first render
  _cardPatientUuid = null;
  _capturePatient = null;

  container.innerHTML = `
    <div class="rcp-module">
      <div class="rcp-head">
        <h2 class="rcp-title">Reception</h2>
        <span class="rcp-subtitle">Ask the caller a set of standard questions — a clinician always reviews and decides.</span>
      </div>
      <div class="rcp-card" id="rcpPatientCard"><div class="rcp-card-title">Patient</div><div class="rcp-card-body rcp-muted">Looking for an open patient record…</div></div>
      <div class="rcp-card" id="rcpFirstAvailCard"><div class="rcp-card-body" id="rcpFirstAvailBody"></div></div>
      <div class="rcp-card" id="rcpCaptureCard"><div class="rcp-card-title">Guided capture</div><div class="rcp-card-body" id="rcpCaptureBody"></div></div>
    </div>`;

  // "First available appointment" — the shared read-only lookup component
  // (also a section on the Slots tab). No patient, no booking, no gate: it
  // answers "when is the next <type>?" for the phone, nothing more. The
  // component renders its own collapsed toggle row as the card title.
  _firstAvail = createFirstAvailablePanel();
  _firstAvail.attach(container.querySelector('#rcpFirstAvailBody'));

  try {
    const r = await fetch(chrome.runtime.getURL('rules/reception-pathways.json'));
    _bundledDoc = await r.json();
  } catch (e) {
    const body = container?.querySelector('#rcpCaptureBody');
    if (body) body.innerHTML = `<div class="rcp-error">Could not load capture pathways: ${esc(e.message)}</div>`;
    _bundledDoc = null;
  }

  await loadConfigAndResolve();
  const initDraft = await loadDraft();
  renderPathwayPicker(initDraft);
  refreshPatientCard();

  _onActivated = () => schedulePatientCardRefresh();
  chrome.tabs.onActivated.addListener(_onActivated);

  // The content script broadcasts sentinel:snapshot-updated on every SPA
  // patient change (invalidate + publish — see content-scripts/sentinel.js
  // notifySnapshotUpdated). Without this listener the Patient card is a
  // one-shot render pinned to whoever was open when the tab was entered — the
  // stale name/NHS-number bug (H-001 field evidence, v3.206.0). Same idiom as
  // patient-alerts.js / record.js / sentinel.js; the pop-out shell delivers
  // the same message (pop-out.js registers no relay for it by design).
  _snapshotListener = (msg, sender) => {
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (msg?.type === 'sentinel:snapshot-updated') schedulePatientCardRefresh();
  };
  chrome.runtime.onMessage.addListener(_snapshotListener);

  // Backstop only — the ping above is the real trigger. Visibility-gated: each
  // tick costs tabs.query + executeScript + IPC, pointless while hidden.
  _pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshPatientCard();
  }, SNAPSHOT_POLL_MS);

  // Live-update when the admin changes reception config/pathways in Options, or
  // when tile prefs change in another context (pop-out ↔ panel).
  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    const tileOnly =
      changes['reception.tilePrefs'] &&
      !changes['reception.config'] &&
      !changes['reception.customPathways'] &&
      !changes['reception.pathwayOverrides'];
    if (tileOnly) {
      // Skip the echo of our own write so an in-progress organise action isn't reset.
      if (_ignoreNextTilePrefsChange) {
        _ignoreNextTilePrefsChange = false;
        return;
      }
      loadConfigAndResolve().then(async () => {
        if (container) renderPathwayPicker(await loadDraft());
      });
      return;
    }
    if (
      changes['reception.config'] ||
      changes['reception.customPathways'] ||
      changes['reception.pathwayOverrides'] ||
      changes['reception.routingAttestation'] ||
      changes['suite.practiceAcceptedAt'] // the single "Accept for practice" switch
    ) {
      loadConfigAndResolve().then(async () => {
        if (!container) return;
        renderPathwayPicker(await loadDraft());
        refreshPatientCard();
      });
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return cleanup;
}

function cleanup() {
  if (_onActivated) {
    chrome.tabs.onActivated.removeListener(_onActivated);
    _onActivated = null;
  }
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  if (_snapshotListener) {
    chrome.runtime.onMessage.removeListener(_snapshotListener);
    _snapshotListener = null;
  }
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_snapshotDebounce) {
    clearTimeout(_snapshotDebounce);
    _snapshotDebounce = null;
  }
  if (_draftDebounceTimer !== null) {
    clearTimeout(_draftDebounceTimer);
    _draftDebounceTimer = null;
  }
  _snapshotRefreshing = false;
  _patientCardHtml = null;
  _cardPatientUuid = null;
  _capturePatient = null;
  // Panel teardown must release a held slot reservation (plan D3.6). The
  // component's own `pagehide` listener covers a window/panel close; this
  // covers a module switch, where pagehide never fires.
  destroyBookingCard();
  _firstAvail?.destroy();
  _firstAvail = null;
  _bookedLines = [];
  _snapshot = null;
  container = null;
}

export { cleanup };

async function loadConfigAndResolve() {
  const r = await chrome.storage.local.get([
    'reception.config',
    'reception.customPathways',
    'reception.pathwayOverrides',
    'reception.tilePrefs',
    'reception.routingAttestation',
    'suite.practiceAcceptedAt',
  ]);
  _config = r['reception.config'] || {};
  // Validated inside evaluateDisposition — anything malformed simply fails the
  // check there and custom pathways stay clinician-only.
  _routingAttestation = r['reception.routingAttestation'] || null;
  // Acceptance is satisfied by EITHER the per-install reception disclaimer OR the
  // single suite-level "Accept for practice" switch (which travels in backups).
  const accepted = _config.disclaimerAcceptedAt != null || r['suite.practiceAcceptedAt'] != null;
  const PU = typeof window !== 'undefined' ? window.ReceptionPathwayUtils : null;
  _tilePrefs = PU
    ? PU.sanitiseTilePrefs(r['reception.tilePrefs'] || {})
    : r['reception.tilePrefs'] || { sortMode: 'manual', order: [], colours: {} };
  if (PU && _bundledDoc) {
    _effective = PU.resolveEffectivePathways({
      bundled: _bundledDoc.pathways || [],
      overrides: r['reception.pathwayOverrides'] || {},
      customPathways: r['reception.customPathways'] || [],
      enabledPathways: _config.enabledPathways || {},
      disclaimerAccepted: accepted,
    });
  } else {
    _effective = { all: [], enabled: [] };
  }
}

// ── Card 1: patient status pill ───────────────────────────────────────────────

// Coalesces the snapshot-updated ping bursts (a patient switch fires at least
// two: invalidate, then publish) into one fetch. Same 400 ms shape as
// patient-alerts.js scheduleSnapshotRefresh.
function schedulePatientCardRefresh() {
  if (_snapshotDebounce) return;
  _snapshotDebounce = setTimeout(() => {
    _snapshotDebounce = null;
    refreshPatientCard();
  }, 400);
}

// Sentinel value: the content script answered, but its snapshot is invalidated
// mid SPA-navigation — the new patient's data is a re-evaluation away.
const SNAPSHOT_UNAVAILABLE = { unavailable: true };

async function findMedicusTab() {
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active[0]?.url && /medicus\.health/.test(active[0].url)) return active[0];
  // Pop-out only: currentWindow is the pop-out popup itself, so the active-tab
  // query can never see Medicus there — fall back to any open Medicus tab so
  // the Patient card works at all in the pop-out. The DOCKED panel deliberately
  // has no fallback: the active-tab snapshot is the documented booking identity
  // source (H-051 control (b)), and booking is hard-gated off in the pop-out,
  // so this fallback can never feed a booking.
  if (isPopOutContext()) {
    const any = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    return any[0] || null;
  }
  return null;
}

async function fetchSnapshot() {
  const tab = await findMedicusTab();
  if (!tab?.id) return null;
  const mountCheck = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => !!window.__sentinelMounted,
  });
  if (!mountCheck?.[0]?.result) return null;
  const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
  if (!snapshot) return null;
  if (snapshot.unavailable) return SNAPSHOT_UNAVAILABLE;
  if (!snapshot.chips) return null;
  return snapshot;
}

async function refreshPatientCard() {
  if (!container) return;
  const card = container.querySelector('#rcpPatientCard .rcp-card-body');
  if (!card) return;
  const gen = ++_patientCardGen;
  let snapshot;
  try {
    snapshot = await fetchSnapshot();
  } catch (_) {
    snapshot = null;
  }
  if (gen !== _patientCardGen) return; // a newer refresh superseded this one — discard stale result
  if (!container) return; // cleaned up mid-fetch
  if (snapshot === SNAPSHOT_UNAVAILABLE) {
    // Mid-navigation transient: blank the identity NOW (the previous patient's
    // name must never sit under a new record — H-001) but do NOT push the null
    // into the booking gate — the publish ping that always follows a
    // re-evaluation lands the real answer within ~a second, and tearing down a
    // held reservation on every same-patient sub-navigation blip would push
    // reception back to booking in Medicus (H-051 review q4). A genuinely dead
    // content script fails the mount check instead and takes the null path
    // below, which DOES re-gate the booking card.
    _snapshot = null;
    _snapshotRefreshing = true;
    renderPatientCard();
    return;
  }
  _snapshotRefreshing = false;
  _snapshot = snapshot;
  // A different patient (or none) behind the card: the expanded pill detail
  // would otherwise swap its rows silently under the reader.
  const pc = snapshot?.patientContext;
  const uuid = (pc && (pc.patientUuid || pc.patientId)) || null;
  if (uuid !== _cardPatientUuid) {
    _cardPatientUuid = uuid;
    _pillExpanded = false;
  }
  renderPatientCard();
  // The open record IS the booking identity source, so a snapshot refresh that
  // changes (or loses) the patient must reach the booking card: it re-gates and,
  // if the patient changed under an armed panel, the panel releases and re-arms.
  if (_bookingCtx) updateBookingCard(_bookingCtx.form, _bookingCtx.pathway);
}

function renderPatientCard() {
  const card = container?.querySelector('#rcpPatientCard .rcp-card-body');
  if (!card) return;

  if (!_snapshot) {
    // Two distinct empty states: "no record open" (idle) vs "the record is
    // changing right now" (Sentinel invalidated mid-navigation; the publish
    // ping repopulates this in under a second). Rendering the transient as the
    // idle copy made every patient switch read as "it lost the patient".
    const html = _snapshotRefreshing
      ? `<span class="rcp-muted">Record changing in Medicus — refreshing…</span>`
      : `<span class="rcp-muted">This panel mirrors the patient open in Medicus. Open a record and their details appear here.</span>
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>`;
    if (html === _patientCardHtml) return;
    _patientCardHtml = html;
    card.innerHTML = html;
    card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
    return;
  }

  const pc = _snapshot.patientContext || {};
  const sum = summariseActionChips(_snapshot.chips, _config.hiddenChipRules || {});
  const who = [pc.patientName, pc.ageYears != null ? `${pc.ageYears}y` : null].filter(Boolean).join(', ');

  // Single status pill: red wins over amber, green = nothing to action.
  const level = sum.red > 0 ? 'red' : sum.amber > 0 ? 'amber' : 'green';
  const pillText =
    level === 'green' ? 'Nothing flagged' : `${sum.red + sum.amber} to action${sum.red ? ` · ${sum.red} overdue` : ''}`;

  const degradedNote = _snapshot.degraded
    ? `<div class="rcp-error">Record extraction incomplete — this status may be missing data.</div>`
    : '';
  const filteredNote =
    sum.hiddenCount > 0
      ? `<div class="rcp-fineprint">${sum.hiddenCount} alert(s) not shown here by practice settings (visible in Monitoring).</div>`
      : '';

  let detailHtml = '';
  if (_pillExpanded) {
    const rows = sum.items
      .map(
        (i) =>
          `<div class="rcp-detail-row rcp-detail-${i.colour}"><span class="rcp-detail-name">${esc(i.name)}</span><span class="rcp-detail-status">${esc(i.statusLabel)}</span></div>`
      )
      .join('');
    detailHtml = `
      <div class="rcp-pill-detail" id="rcpPillDetail">
        ${rows || '<div class="rcp-muted">No action-needed alerts in the current data.</div>'}
        ${filteredNote}
        <div class="rcp-fineprint">${NO_ALERT_CAVEAT} The Monitoring tab has the full picture.</div>
        <button class="rcp-link-btn" id="rcpGotoSentinel">Open Monitoring <span aria-hidden="true">→</span></button>
      </div>`;
  }

  const html = `
    <div class="rcp-patient-line"><strong>${esc(who || 'Patient')}</strong>${pc.nhsNumber ? ` <span class="rcp-nhs">NHS ${esc(pc.nhsNumber)}</span>` : ''}
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>
    </div>
    ${degradedNote}
    <button class="rcp-pill rcp-pill-${level}" id="rcpPill" aria-expanded="${_pillExpanded}" aria-controls="rcpPillDetail">
      <span class="rcp-pill-dot" aria-hidden="true"></span>${esc(pillText)}
      <span class="rcp-pill-caret" aria-hidden="true">${_pillExpanded ? '▴' : '▾'}</span>
    </button>
    ${detailHtml}`;
  // With the card auto-refreshing, an unchanged render must be a no-op: an
  // innerHTML replace drops keyboard focus and shifts the red-flag radios
  // below the card mid-click. The markup itself is the change key.
  if (html === _patientCardHtml) return;
  _patientCardHtml = html;
  card.innerHTML = html;

  card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
  card.querySelector('#rcpPill')?.addEventListener('click', () => {
    _pillExpanded = !_pillExpanded;
    renderPatientCard();
  });
  card.querySelector('#rcpGotoSentinel')?.addEventListener('click', () => {
    document.querySelector('.nav-tab[data-module="sentinel"]')?.click();
  });
}

// ── Card 2: guided capture ────────────────────────────────────────────────────

function renderPathwayPicker(_activeDraft) {
  if (!container) return;
  // Leaving the capture form (tile navigation, an Options storage-change
  // re-render, "New capture") tears the booking card down and releases any
  // reservation it was holding.
  destroyBookingCard();
  const body = container.querySelector('#rcpCaptureBody');
  if (!body || !_bundledDoc) return;

  const enabled = _effective.enabled;
  if (enabled.length === 0) {
    body.innerHTML = `
      <div class="rcp-setup-note">
        This is a one-time practice setup. Ask your practice manager to enable
        pathways. Nothing for you to do here.
      </div>
      <div class="rcp-disabled-note">
        <strong>Capture pathways are switched off.</strong>
        All pathways ship disabled. A practice administrator can review the
        disclaimer and enable them in Options → Reception.
      </div>
      <button class="rcp-btn" id="rcpOpenOptions">Open options</button>`;
    body.querySelector('#rcpOpenOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  const PU = window.ReceptionPathwayUtils;
  const ordered = PU ? PU.orderTiles(enabled, _tilePrefs) : enabled;
  const alpha = _tilePrefs.sortMode === 'alpha';
  const colourKeys = (PU && PU.TILE_COLOUR_KEYS) || ['default'];

  // _activeDraft may be passed in from the async init path; otherwise not shown.
  const draftPathwayId = _activeDraft ? _activeDraft.pathwayId : null;

  const toolbar = `
    <div class="rcp-tile-toolbar">
      <div class="rcp-sort-ctrl">
        <span class="rcp-sort-label">Order</span>
        <button class="rcp-seg ${alpha ? '' : 'rcp-seg-on'}" data-sort="manual" type="button">Manual</button>
        <button class="rcp-seg ${alpha ? 'rcp-seg-on' : ''}" data-sort="alpha" type="button">A&ndash;Z</button>
      </div>
      <button class="rcp-link-btn rcp-organise-toggle" id="rcpOrganise" type="button">${_organising ? 'Done' : 'Organise tiles'}</button>
    </div>`;

  const tiles = ordered
    .map((p) => {
      const colour = PU ? PU.tileColourFor(_tilePrefs, p.id) : 'default';
      const draggable = _organising && !alpha;
      const handle = draggable ? `<span class="rcp-drag-handle" aria-hidden="true">&#10303;</span>` : '';
      const swatch = _organising
        ? `<button class="rcp-tile-swatch rcp-tile-c-${esc(colour)}" data-colour-for="${esc(p.id)}" type="button" aria-label="Set tile colour"></button>`
        : '';
      const palette =
        _organising && _openColourFor === p.id
          ? `<div class="rcp-colour-palette">` +
            colourKeys
              .map(
                (k) =>
                  `<button class="rcp-colour-dot rcp-tile-c-${esc(k)} ${k === colour ? 'rcp-colour-sel' : ''}" data-set-colour="${esc(k)}" data-for="${esc(p.id)}" type="button" aria-label="${esc(k)}"></button>`
              )
              .join('') +
            `</div>`
          : '';
      const draftPill =
        !_organising && draftPathwayId === p.id
          ? `<span class="rcp-draft-pill" aria-label="Unsaved draft">draft</span>`
          : '';
      // Persistent colour-label dot (organise mode shows the interactive swatch
      // in the same corner instead). A dot reads as a personal tag, not a
      // clinical-severity edge-bar.
      const tag = !_organising && colour !== 'default' ? `<span class="rcp-tile-tag" aria-hidden="true"></span>` : '';
      // Secondary, non-competing suggestion — hidden in organise mode, same as
      // the draft pill and colour tag above.
      const leafletLink = !_organising
        ? `<a href="#" class="rcp-tile-leaflet" data-leaflet-query="${esc(deriveLeafletQuery(p.title))}" title="Find the NHS patient leaflet for this">Leaflet <span aria-hidden="true">&rarr;</span></a>`
        : '';
      return `<div class="rcp-pathway-tile rcp-tile-c-${esc(colour)}${_organising ? ' rcp-tile-organising' : ''}" data-pathway="${esc(p.id)}"${draggable ? ' draggable="true"' : ''}>
      ${handle}
      <button class="rcp-pathway-btn" data-pathway-go="${esc(p.id)}" type="button"${_organising ? ' tabindex="-1"' : ''}>
        <span class="rcp-pathway-title">${esc(p.title)}</span>
        <span class="rcp-pathway-applies">${esc(p.appliesTo || '')}</span>
        ${draftPill}
      </button>
      ${tag}${swatch}${palette}${leafletLink}
    </div>`;
    })
    .join('');

  const note = _organising
    ? `<div class="rcp-fineprint">${alpha ? 'Switch to &ldquo;Manual&rdquo; to drag tiles into your own order. ' : 'Drag tiles to reorder. '}Tap the dot to colour-label a tile. Colours and order organise your tiles only &mdash; they are not a clinical flag.</div>`
    : `<div class="rcp-picker-note">Pick the problem that best matches what the caller describes. Red-flag (safety) questions come first — if the caller answers YES to any, stop and follow the on-screen action, which tells you exactly who to contact.</div>`;

  body.innerHTML = `${toolbar}${note}<div class="rcp-pathway-grid${_organising ? ' rcp-organising' : ''}">${tiles}</div>`;

  body.querySelector('#rcpOrganise')?.addEventListener('click', () => {
    _organising = !_organising;
    _openColourFor = null;
    renderPathwayPicker();
  });
  body
    .querySelectorAll('.rcp-seg')
    .forEach((btn) => btn.addEventListener('click', () => setSortMode(btn.dataset.sort)));

  body.querySelectorAll('.rcp-pathway-btn[data-pathway-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (_organising) return; // organise mode: launching a capture is disabled
      const p = enabled.find((x) => x.id === btn.dataset.pathwayGo);
      if (p) renderCaptureForm(p);
    });
  });
  body.querySelectorAll('.rcp-tile-leaflet').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // do not also trigger the tile's capture launch
      goToLeaflet(a.dataset.leafletQuery);
    });
  });

  if (_organising) {
    body.querySelectorAll('.rcp-tile-swatch').forEach((sw) =>
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = sw.dataset.colourFor;
        _openColourFor = _openColourFor === id ? null : id;
        renderPathwayPicker();
      })
    );
    body.querySelectorAll('.rcp-colour-dot').forEach((dot) =>
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        setTileColour(dot.dataset.for, dot.dataset.setColour);
      })
    );
    if (!alpha) wireTileDrag(body);
  }
}

// Persist the in-memory tile prefs. _ignoreNextTilePrefsChange suppresses the
// storage-change echo so the listener doesn't re-render over an active action.
function persistTilePrefs() {
  _ignoreNextTilePrefsChange = true;
  try {
    chrome.storage.local.set({
      'reception.tilePrefs': {
        sortMode: _tilePrefs.sortMode === 'alpha' ? 'alpha' : 'manual',
        order: Array.isArray(_tilePrefs.order) ? _tilePrefs.order : [],
        colours: _tilePrefs.colours || {},
      },
    });
  } catch (_) {
    _ignoreNextTilePrefsChange = false;
  }
}

function setSortMode(mode) {
  _tilePrefs.sortMode = mode === 'alpha' ? 'alpha' : 'manual';
  persistTilePrefs();
  renderPathwayPicker();
}

function setTileColour(id, key) {
  if (!id) return;
  _tilePrefs.colours = _tilePrefs.colours || {};
  if (key === 'default') delete _tilePrefs.colours[id];
  else _tilePrefs.colours[id] = key;
  _openColourFor = null;
  persistTilePrefs();
  renderPathwayPicker();
}

// The pathway ids in the current MANUAL order (independent of sort mode), used
// as the basis for a drag reorder so switching to A–Z then back is stable.
function currentManualOrder() {
  const PU = window.ReceptionPathwayUtils;
  const list = PU
    ? PU.orderTiles(_effective.enabled, { sortMode: 'manual', order: _tilePrefs.order })
    : _effective.enabled;
  return list.map((p) => p.id);
}

function reorderTile(dragId, targetId) {
  const ids = currentManualOrder();
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, dragId);
  _tilePrefs.order = ids;
  _tilePrefs.sortMode = 'manual';
  persistTilePrefs();
  renderPathwayPicker();
}

function wireTileDrag(body) {
  const grid = body.querySelector('.rcp-pathway-grid');
  if (!grid) return;
  let dragId = null;
  grid.querySelectorAll('.rcp-pathway-tile[draggable="true"]').forEach((tile) => {
    tile.addEventListener('dragstart', (e) => {
      dragId = tile.dataset.pathway;
      tile.classList.add('rcp-tile-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', dragId);
        } catch (_) {}
      }
    });
    tile.addEventListener('dragend', () => {
      tile.classList.remove('rcp-tile-dragging');
      grid.querySelectorAll('.rcp-tile-over').forEach((t) => t.classList.remove('rcp-tile-over'));
      dragId = null;
    });
    tile.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (dragId && tile.dataset.pathway !== dragId) tile.classList.add('rcp-tile-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('rcp-tile-over'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      tile.classList.remove('rcp-tile-over');
      const targetId = tile.dataset.pathway;
      if (dragId && targetId) reorderTile(dragId, targetId);
    });
  });
}

function inputHtml(scope, q) {
  const nm = `${scope}-${q.id}`;
  if (q.type === 'yesno') {
    return `<span class="rcp-yn">
      <label><input type="radio" name="${esc(nm)}" value="Yes"> Yes</label>
      <label><input type="radio" name="${esc(nm)}" value="No"> No</label>
    </span>`;
  }
  if (q.type === 'choice') {
    const opts = (q.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<select name="${esc(nm)}"><option value="">—</option>${opts}</select>`;
  }
  if (q.type === 'multi') {
    return (
      `<span class="rcp-multi">` +
      (q.options || [])
        .map((o) => `<label><input type="checkbox" name="${esc(nm)}" value="${esc(o)}"> ${esc(o)}</label>`)
        .join('') +
      `</span>`
    );
  }
  return `<input type="text" name="${esc(nm)}" autocomplete="off">`;
}

function amalgamListHtml(tier, flags, title) {
  if (!flags.length) return '';
  const cls = tier === '999' ? 'rcp-amalgam-emergency' : 'rcp-amalgam-duty';
  const items = flags
    .map(
      (rf) => `
      <label class="rcp-amalgam-item rcp-rf-row" data-rf="${esc(rf.id)}">
        <input type="checkbox" name="rf-${esc(rf.id)}" value="yes" data-tier="${esc(tier)}">
        <span class="rcp-rf-ask">${esc(rf.ask)}</span>
      </label>`
    )
    .join('');
  return `<div class="rcp-q-row">
      <label class="rcp-q-ask">${esc(title)}</label>
      <div class="rcp-amalgam ${cls}" data-tier="${esc(tier)}">
        ${items}
        <label class="rcp-amalgam-item rcp-amalgam-none">
          <input type="checkbox" name="rf-none-${esc(tier)}" value="none" data-tier="${esc(tier)}" data-none="1">
          <span>None of these</span>
        </label>
      </div>
    </div>`;
}

async function renderCaptureForm(pathway) {
  const body = container?.querySelector('#rcpCaptureBody');
  if (!body || !_bundledDoc) return;

  const sensitive = isSensitivePathway(pathway);
  // Sensitive pathway: bin any stored draft the moment the form opens, before a
  // single keystroke can be autosaved, and never offer a restore banner below.
  if (sensitive) clearDraft();

  // A new capture starts with no bookings recorded, and any booking panel left
  // over from the previous pathway is torn down (releasing its reservation)
  // before this one's is built.
  destroyBookingCard();
  _bookedLines = [];

  // PIN the patient identity to this capture, now. The Patient card
  // auto-refreshes (v3.206.0), so `_snapshot` tracks whatever record is open in
  // Medicus — which can change mid-call on a shared front-desk profile. The
  // summary header must name the patient this capture STARTED on, never
  // whoever happens to be open when Generate is pressed (H-001/H-029 class);
  // generateSummary compares this pin against the live snapshot and warns on
  // divergence. No record open when the form opens → nothing pinned, no
  // patient line in the text (as before).
  const pinPc = _snapshot?.patientContext || null;
  _capturePatient = pinPc
    ? {
        patientId: pinPc.patientUuid || pinPc.patientId || null,
        patientName: pinPc.patientName || '',
        dateOfBirth: pinPc.dateOfBirth || '',
        nhsNumber: pinPc.nhsNumber || '',
        ageYears: pinPc.ageYears ?? null,
      }
    : null;

  const { emergency, duty } = splitRedFlags(pathway.redFlags);
  const closing = _bundledDoc.closingQuestions || [];
  const durationQ = (pathway.questions || []).find((q) => q.id === CALL_DURATION_ID);
  const courseQ = closing.find((q) => q.id === CALL_COURSE_ID);
  const durationRow = showDurationRow(pathway)
    ? `<div class="rcp-q-row rcp-duration-row">
        <label class="rcp-q-ask">How long, and is it better, worse, or the same?</label>
        <div class="rcp-duration-grid">
          ${durationQ ? inputHtml('q', durationQ) : '<input type="text" name="q-duration" autocomplete="off" placeholder="How long">'}
          ${courseQ ? inputHtml('c', courseQ) : ''}
        </div>
      </div>`
    : '';

  const qRows = mainQuestions(pathway)
    .map(
      (q) => `
    <div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml('q', q)}</div>`
    )
    .join('');
  const cRows = closingInOrder(closing, mainClosingIds(pathway))
    .map(
      (q) => `
    <div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml('c', q)}</div>`
    )
    .join('');
  const moreQ = moreQuestions(pathway);
  const moreC = moreClosingQuestions(pathway, closing);
  const moreRows = [...moreQ, ...moreC]
    .map((q) => {
      const scope = moreQ.includes(q) ? 'q' : 'c';
      return `<div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml(scope, q)}</div>`;
    })
    .join('');
  const moreDrawer = moreRows
    ? `<details class="rcp-more"><summary>More for the clinician</summary>${moreRows}</details>`
    : '';

  // Sensitive pathways: the crisis route is a fixed footer on the form (and goes
  // into the pasted text too). Practice-editable via reception.config.
  const crisisFooter = sensitive
    ? `<div class="rcp-crisis-line" id="rcpCrisisLine">${esc(crisisLineText(_config.crisisLineText))}</div>`
    : '';
  const sensitiveNote = sensitive
    ? `<div class="rcp-fineprint">This pathway is marked sensitive: nothing typed here is saved as a draft, and your initials are required before a summary can be generated.</div>`
    : '';

  body.innerHTML = `
    <form class="rcp-form" id="rcpForm">
      <div class="rcp-form-head">
        <button type="button" class="rcp-link-btn" id="rcpBack"><span aria-hidden="true">←</span> All pathways</button>
        <span class="rcp-form-title">${esc(pathway.title)}</span>
        <label class="rcp-initials">Your initials <input type="text" id="rcpInitials" maxlength="5" value="${esc(_takerInitials)}"></label>
      </div>
      ${sensitiveNote}

      <div class="rcp-draft-banner rcp-draft-banner-hidden" id="rcpDraftBanner" aria-live="polite"></div>

      <div class="rcp-banner rcp-banner-hidden" id="rcpEscBanner" role="alert" aria-atomic="true"></div>

      <div class="rcp-section">
        <div class="rcp-q-row"><label class="rcp-q-ask">${esc(ownWordsLabel(pathway))}</label>
          <textarea name="ownWords" rows="2"></textarea></div>
        ${durationRow}
        ${amalgamListHtml('999', emergency, 'Any of these — we stop and treat as an emergency?')}
        ${amalgamListHtml('duty', duty, 'Any of these — duty doctor today, not routine?')}
        <div class="rcp-after-stop">
          ${qRows}
          ${cRows}
        </div>
        ${moreDrawer}
      </div>

      <div class="rcp-disposition rcp-disposition-hidden" id="rcpDisposition">
        <div class="rcp-disp-head">
          <span class="rcp-disp-title">Where could this patient safely go?</span>
          <label class="rcp-disp-age">Age confirmed on the call
            <input type="number" id="rcpDispAge" min="0" max="120" step="1" inputmode="numeric" placeholder="yrs" autocomplete="off">
          </label>
        </div>
        <div id="rcpDispBody"></div>
      </div>

      <div class="rcp-form-actions">
        <button type="submit" class="rcp-btn rcp-btn-primary">Generate summary</button>
        <span class="rcp-form-msg" id="rcpFormMsg"></span>
      </div>
      ${crisisFooter}
    </form>`;

  const form = body.querySelector('#rcpForm');
  resetDispositionState();

  // Check for a restorable draft for this specific pathway (never for a sensitive
  // one — there is no stored draft to restore, and offering one would be a leak).
  const draft = sensitive ? null : await loadDraft();
  if (draft && draft.pathwayId === pathway.id) {
    const banner = form.querySelector('#rcpDraftBanner');
    if (banner) {
      banner.className = 'rcp-draft-banner';
      banner.innerHTML = `Draft from ${esc(fmtHHMM(draft.savedAt))} — <button type="button" class="rcp-link-btn rcp-draft-restore" id="rcpDraftRestore">Restore</button> · <button type="button" class="rcp-link-btn rcp-draft-discard" id="rcpDraftDiscard">Discard</button>`;
      banner.querySelector('#rcpDraftRestore')?.addEventListener('click', () => {
        restoreDraftFields(form, draft.fields);
        updateEscalationBanner(form, pathway);
        // Restoring red-flag answers can complete the screen — re-evaluate the
        // disposition too (the age is never restored; it must be re-confirmed).
        updateDispositionCard(form, pathway);
        updateBookingCard(form, pathway);
        banner.className = 'rcp-draft-banner rcp-draft-banner-hidden';
      });
      banner.querySelector('#rcpDraftDiscard')?.addEventListener('click', () => {
        clearDraft();
        banner.className = 'rcp-draft-banner rcp-draft-banner-hidden';
      });
    }
  }

  body.querySelector('#rcpBack')?.addEventListener('click', () => {
    loadDraft().then((d) => renderPathwayPicker(d));
  });
  body.querySelector('#rcpInitials')?.addEventListener('input', (e) => {
    _takerInitials = e.target.value.trim();
  });

  // Escalation banner reacts the moment any red flag is answered YES; the
  // disposition card re-evaluates on the same hook, so a red flag flipped to
  // YES removes a suggestion that was already on screen.
  form.addEventListener('change', (e) => {
    syncAmalgamExclusive(form, e.target);
    updateEscalationBanner(form, pathway);
    updateDispositionCard(form, pathway);
    // Same hook, same red-flag evaluation: a flag flipped to YES pulls the
    // booking card and releases any slot it was holding.
    updateBookingCard(form, pathway);
    if (!sensitive) scheduleDraftSave(pathway.id, form);
  });
  form.addEventListener('input', () => {
    if (!sensitive) scheduleDraftSave(pathway.id, form);
  });
  // The confirmed-age field re-evaluates live (an age typed digit by digit
  // would otherwise only take effect on blur). It is deliberately NOT part of
  // the draft autosave (no `name` attribute): the age must be re-confirmed on
  // the call every time, never restored from an earlier contact.
  form.querySelector('#rcpDispAge')?.addEventListener('input', () => updateDispositionCard(form, pathway));
  updateDispositionCard(form, pathway);
  updateBookingCard(form, pathway);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    generateSummary(form, pathway);
  });
}

function syncAmalgamExclusive(form, target) {
  if (!target || !target.dataset || !target.dataset.tier) return;
  const tier = target.dataset.tier;
  if (target.dataset.none === '1' && target.checked) {
    form.querySelectorAll(`input[data-tier="${CSS.escape(tier)}"]:not([data-none])`).forEach((el) => {
      el.checked = false;
    });
    return;
  }
  if (target.checked && target.dataset.none !== '1') {
    const none = form.querySelector(`input[data-none="1"][data-tier="${CSS.escape(tier)}"]`);
    if (none) none.checked = false;
  }
}

function readRedFlagAnswers(form, pathway) {
  const answers = {};
  const { emergency, duty } = splitRedFlags(pathway.redFlags);
  const applyTier = (tier, flags) => {
    const noneChecked = !!form.querySelector(`input[data-none="1"][data-tier="${CSS.escape(tier)}"]:checked`);
    const checkedIds = flags
      .filter((rf) => form.querySelector(`input[name="rf-${CSS.escape(rf.id)}"]:checked`))
      .map((rf) => rf.id);
    applyAmalgamAnswers(answers, flags, { noneChecked, checkedIds });
  };
  applyTier('999', emergency);
  applyTier('duty', duty);
  return answers;
}

function updateEscalationBanner(form, pathway) {
  const banner = form.querySelector('#rcpEscBanner');
  if (!banner) return;
  const { positives } = evaluateRedFlags(pathway.redFlags, readRedFlagAnswers(form, pathway));
  form.classList.toggle('rcp-stopped-999', positives.some((p) => p.escalate === '999'));
  if (positives.length === 0) {
    banner.className = 'rcp-banner rcp-banner-hidden';
    banner.textContent = '';
    return;
  }
  // 999-level escalation wins over duty-level when both are present.
  const level = positives.some((p) => p.escalate === '999') ? '999' : 'duty';
  banner.className = `rcp-banner rcp-banner-${level === '999' ? 'red' : 'amber'}`;
  // Fallback includes the level so the receptionist always knows 999-vs-duty even if
  // the escalations map entry is missing (near-unreachable; validation forces level ∈ {999,duty}).
  banner.textContent = `RED FLAG — ${(_bundledDoc.escalations && _bundledDoc.escalations[level]) || `ACTION (level ${level}): Escalate immediately.`}`;
  // A safeguarding-flagged positive adds its own line INSIDE the same banner: duty
  // clinician AND the practice safeguarding lead, bypassing all other routing.
  // textContent throughout — the configured contact is free practice text.
  if (positives.some((p) => p.safeguarding === true)) {
    const sg = document.createElement('div');
    sg.className = 'rcp-banner-safeguarding';
    sg.textContent = safeguardingActionLine(_config.safeguardingContact);
    banner.appendChild(sg);
  }
}

// ── Disposition card (plan E) ─────────────────────────────────────────────────
// A SUGGESTION, never a booking. It renders only when evaluateDisposition says
// 'suggest' — i.e. every red flag answered and none positive, the pathway is not
// clinician-only, and (for custom/edited packs) a CSO/partner routing sign-off
// exists. Withheld and 'none' states render nothing on the form; withheld states
// are still recorded in the pasted capture text.
//
// The receptionist's own decision lives here, not in storage: it is part of the
// contact in front of them and dies with the form.
let _disp = { decision: null, decidedFor: null, overrideOpen: false, overrideTo: '', overrideNote: '' };

function resetDispositionState() {
  _disp = { decision: null, decidedFor: null, overrideOpen: false, overrideTo: '', overrideNote: '' };
}

// The age the RECEPTIONIST confirmed on the call. Never seeded from the open
// record's ageYears — a wrong record open is exactly how a three-year-old
// caller would be handed an adult Pharmacy First suggestion.
function readConfirmedAge(form) {
  const raw = (form.querySelector('#rcpDispAge')?.value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 120) return null;
  return n;
}

// The single red-flag evaluation for this form, shared by the disposition card
// and the booking gate (plan D3.3: "same gate as E's guardrail 1; write it
// once, use it twice"). Both must see identical positives/unanswered — a
// booking card that disagreed with the disposition card about whether a flag
// was answered is the whole hazard.
function redFlagState(form, pathway) {
  return evaluateRedFlags(pathway.redFlags, readRedFlagAnswers(form, pathway));
}

function dispositionContext(form, pathway) {
  const { positives, unanswered } = redFlagState(form, pathway);
  const entry = (_effective.all || []).find((e) => e.pathway && e.pathway.id === pathway.id);
  const origin = entry ? entry.origin : 'custom';
  return {
    redFlagPositives: positives,
    redFlagUnanswered: unanswered,
    confirmedAge: readConfirmedAge(form),
    // A practice-edited bundled pathway keeps its bundled id, which is what the
    // frozen clinician-only sets are keyed on.
    bundledId: origin === 'custom' ? null : pathway.id,
    origin,
    routingAttestation: _routingAttestation,
  };
}

// The full record written into the capture text: what the engine said plus what
// the receptionist did with it. Re-evaluated at submit time, never trusted from
// the last render.
function dispositionRecord(form, pathway) {
  const result = evaluateDisposition(pathway, dispositionContext(form, pathway));
  if (result.status !== 'suggest') return result;
  if (_disp.decision && _disp.decidedFor === result.destination) {
    return Object.assign({}, result, {
      decision: _disp.decision,
      overrideTo: _disp.overrideTo,
      overrideNote: _disp.overrideNote,
    });
  }
  return result;
}

function updateDispositionCard(form, pathway) {
  const card = form.querySelector('#rcpDisposition');
  const body = form.querySelector('#rcpDispBody');
  if (!card || !body) return;
  const ctx = dispositionContext(form, pathway);
  const result = evaluateDisposition(pathway, ctx);

  if (result.status !== 'suggest') {
    card.className = 'rcp-disposition rcp-disposition-hidden';
    body.innerHTML = '';
    return;
  }
  // The suggestion changed under a recorded decision (e.g. the age was edited
  // after Confirm) — drop the decision rather than carry it onto a different
  // destination.
  if (_disp.decision && _disp.decidedFor !== result.destination) {
    _disp.decision = null;
    _disp.decidedFor = null;
  }
  card.className = 'rcp-disposition';

  const decided =
    _disp.decision === 'confirmed'
      ? `<div class="rcp-disp-decided">Recorded: receptionist confirmed this route.</div>`
      : _disp.decision === 'overridden'
        ? `<div class="rcp-disp-decided">Recorded: overridden to ${esc(destinationLabel(_disp.overrideTo))}${_disp.overrideNote ? ` — ${esc(_disp.overrideNote)}` : ''}.</div>`
        : '';

  const dests = overrideDestinations(pathway, ctx.confirmedAge);
  const overridePanel = _disp.overrideOpen
    ? `<div class="rcp-disp-override">
        <label class="rcp-disp-override-lbl">Send instead to
          <select id="rcpDispOverrideTo">${dests
            .map(
              (d) =>
                `<option value="${esc(d)}" ${d === (_disp.overrideTo || '') ? 'selected' : ''}>${esc(destinationLabel(d))}</option>`
            )
            .join('')}</select>
        </label>
        <input type="text" id="rcpDispOverrideNote" maxlength="120" placeholder="Note (optional) — why this route" autocomplete="off" value="${esc(_disp.overrideNote)}">
        <button type="button" class="rcp-btn rcp-btn-small" id="rcpDispOverrideSave">Record override</button>
       </div>`
    : '';

  body.innerHTML = `
    <div class="rcp-disp-suggest">Suggested route: <strong>${esc(destinationLabel(result.destination))}</strong>${result.basis ? ` &mdash; ${esc(result.basis)}` : ''}</div>
    <div class="rcp-disp-fallback">${esc(result.fallbackLine)}</div>
    ${decided}
    <div class="rcp-disp-actions">
      <button type="button" class="rcp-btn rcp-btn-small" id="rcpDispConfirm">Confirm</button>
      <button type="button" class="rcp-link-btn" id="rcpDispOverride">${_disp.overrideOpen ? 'Cancel override' : 'Override…'}</button>
    </div>
    ${overridePanel}
    <div class="rcp-fineprint">A suggestion only &mdash; nothing is booked and nothing is sent. A clinician decides. If in any doubt, offer the clinician callback.</div>`;

  body.querySelector('#rcpDispConfirm')?.addEventListener('click', () => {
    _disp.decision = 'confirmed';
    _disp.decidedFor = result.destination;
    _disp.overrideOpen = false;
    updateDispositionCard(form, pathway);
  });
  body.querySelector('#rcpDispOverride')?.addEventListener('click', () => {
    _disp.overrideOpen = !_disp.overrideOpen;
    if (_disp.overrideOpen && !_disp.overrideTo) _disp.overrideTo = dests[0] || 'gp_routine';
    updateDispositionCard(form, pathway);
  });
  body.querySelector('#rcpDispOverrideNote')?.addEventListener('input', (e) => {
    _disp.overrideNote = e.target.value;
  });
  body.querySelector('#rcpDispOverrideTo')?.addEventListener('change', (e) => {
    _disp.overrideTo = e.target.value;
  });
  body.querySelector('#rcpDispOverrideSave')?.addEventListener('click', () => {
    const sel = body.querySelector('#rcpDispOverrideTo');
    const note = body.querySelector('#rcpDispOverrideNote');
    _disp.overrideTo = sel ? sel.value : 'gp_routine';
    _disp.overrideNote = (note ? note.value : '').trim();
    _disp.decision = 'overridden';
    _disp.decidedFor = result.destination;
    _disp.overrideOpen = false;
    updateDispositionCard(form, pathway);
  });
}

// ── Card 3: booking (plan D3, hazard H-051) ───────────────────────────────────
//
// The suite's first clinical WRITE surface aimed at non-clinical staff. It is
// created and destroyed WITH the capture form — never in the pathway picker,
// never in the summary/output view — and every gate below is load-bearing:
//
//   • Docked panel only. Reception also renders in the floating pop-out, and a
//     slot list + write flow in a narrow always-on-top window that can sit over
//     a DIFFERENT Medicus tab is exactly the identity hazard the booking-core
//     extraction (plan D1.2) exists to kill. The pop-out gets a one-line note
//     pointing at the docked panel instead — recorded deliberately, the same
//     convention as the panel-only demand strips.
//   • An open record is mandatory. Capture deliberately works with no record
//     open; booking must never fire against an ambient one.
//   • Any positive OR unanswered red flag stops a booking, using the SAME
//     evaluation the disposition card uses (redFlagState above). A POSITIVE flag
//     hides the card outright; an UNANSWERED one leaves an explanatory note in
//     its place ("answer every red-flag question first") — CSO decision
//     2026-07-28, H-051 review question 4, reasoning in booking-panel-core.js.
//   • Sensitive pathways (mental-health) NEVER show it, red flags or not:
//     what to offer someone in distress is a clinician's decision, not a slot
//     the front desk picks off a list mid-call.
//
// All of that lives in bookingGateState() (booking-panel-core.js) as a pure
// truth table so test-reception-booking.js can drive it directly.

let _bookingPanel = null; // createBookingPanel() instance, or null
let _bookingCtx = null; // { form, pathway } the panel's closures read
let _bookingGateKey = null; // last rendered gate+patient key (re-render only on change)
let _bookedLines = []; // capture-text lines for appointments booked in THIS capture

// POP-OUT DETECTION. The reception module is loaded by both shells; the pop-out
// shell lives at /pop-out/pop-out.html and the docked panel at
// /side-panel/panel.html. Anything we cannot classify counts as "not the docked
// panel" — the gate fails closed towards no booking.
function isPopOutContext() {
  try {
    return /(^|\/)pop-out\//.test(location.pathname);
  } catch (_) {
    return true;
  }
}

// THE BOOKING IDENTITY SOURCE — deliberately singular and documented here.
// It is the Sentinel snapshot taken from the ACTIVE Medicus tab
// (fetchSnapshot() queries { active: true, currentWindow: true }; the
// any-Medicus-tab fallback in findMedicusTab runs ONLY in the pop-out, where
// booking is hard-gated off, so it can never feed this), i.e. the
// same record whose name/DOB the patient card is showing the receptionist. The
// booking shim's own detectMedicusTab() resolves the FIRST matching Medicus
// tab instead, which can be a different one; the booking panel therefore
// requires the two to AGREE both when it arms and again at commit rather than
// trusting either alone (plan D1.2, hazard H-043).
//
// No patient uuid → no booking: the panel could not re-verify at commit, so the
// card renders in its disabled "open the caller's record" state rather than
// leading the receptionist to a dead end.
function bookingPatientContext() {
  const pc = _snapshot?.patientContext;
  if (!pc) return null;
  const patientId = pc.patientUuid || pc.patientId || null;
  if (!patientId) return null;
  return {
    patientId,
    name: pc.patientName || '',
    dob: pc.dateOfBirth || pc.dobRaw || pc.dob || '',
    nhsNumber: pc.nhsNumber || '',
  };
}

function bookingGateFor(form, pathway) {
  const flags = form && pathway ? redFlagState(form, pathway) : { positives: [], unanswered: ['*'] };
  return bookingGateState({
    hasPatientContext: !!bookingPatientContext(),
    redFlagPositives: flags.positives,
    redFlagUnanswered: flags.unanswered,
    isSensitivePathway: isSensitivePathway(pathway),
    isPopOut: isPopOutContext(),
  });
}

function ensureBookingCard() {
  if (!container) return null;
  const captureCard = container.querySelector('#rcpCaptureCard');
  if (!captureCard) return null;
  let card = container.querySelector('#rcpBookingCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'rcp-card';
    card.id = 'rcpBookingCard';
    card.innerHTML = `<div class="rcp-card-title">Book an appointment</div><div class="rcp-card-body" id="rcpBookingBody"></div>`;
    captureCard.insertAdjacentElement('afterend', card);
  }
  if (!_bookingPanel) {
    _bookingPanel = createBookingPanel({
      mountEl: card.querySelector('#rcpBookingBody'),
      getPatientContext: bookingPatientContext,
      getGateState: () => bookingGateFor(_bookingCtx?.form, _bookingCtx?.pathway),
      // Reason pre-fill = the active pathway's title, editable at the confirm
      // step (plan D3.1). The clinician reading the record sees what the caller
      // was booked for, in the practice's own pathway wording.
      getDefaultReason: () => _bookingCtx?.pathway?.title || '',
      onBooked: (summary) => {
        if (summary && summary.line) _bookedLines.push(summary.line);
      },
    });
  }
  return card;
}

// Called on first render of the capture form and on every answer change, so a
// red flag flipped to YES pulls the card (and hands back any held slot) in the
// same beat as the escalation banner appearing.
function updateBookingCard(form, pathway) {
  if (!container) return;
  _bookingCtx = { form, pathway };
  const gate = bookingGateFor(form, pathway);
  const card = ensureBookingCard();
  if (!card) return;
  card.hidden = gate.render === 'hidden';
  const key = [gate.render, gate.reason, bookingPatientContext()?.patientId || ''].join('|');
  if (key === _bookingGateKey) return; // nothing the panel needs to redraw for
  _bookingGateKey = key;
  _bookingPanel?.render();
}

// EVERY exit from the capture form runs through here: pathway-tile navigation
// ("All pathways"), the picker re-render triggered by an Options storage change,
// the summary/output view, and module cleanup(). destroy() releases any held
// reservation, so no exit path can leave a slot locked for the rest of the
// practice (plan D3.6).
function destroyBookingCard() {
  if (_bookingPanel) {
    _bookingPanel.destroy();
    _bookingPanel = null;
  }
  _bookingCtx = null;
  _bookingGateKey = null;
  container?.querySelector('#rcpBookingCard')?.remove();
}

function readQuestionAnswers(form, scope, questions) {
  const out = {};
  for (const q of questions || []) {
    const nm = `${scope}-${q.id}`;
    if (q.type === 'multi') {
      const vals = Array.from(form.querySelectorAll(`input[name="${CSS.escape(nm)}"]:checked`)).map((i) => i.value);
      out[q.id] = vals;
    } else {
      const el = form.querySelector(`[name="${CSS.escape(nm)}"]${q.type === 'yesno' ? ':checked' : ''}`);
      out[q.id] = el ? el.value : '';
    }
  }
  return out;
}

function generateSummary(form, pathway) {
  const msg = form.querySelector('#rcpFormMsg');
  const rfAnswers = readRedFlagAnswers(form, pathway);
  const gate = generateAllowed(pathway.redFlags, rfAnswers);

  form.querySelectorAll('.rcp-rf-row').forEach((row) => {
    row.classList.toggle('rcp-rf-missing', !gate.ok && gate.unanswered.includes(row.dataset.rf));
  });
  if (!gate.ok) {
    if (msg) msg.textContent = `Answer the safety lists first (${gate.unanswered.length} unanswered). Tick any that apply, or None of these.`;
    form.querySelector('.rcp-rf-missing')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // Sensitive pathways: the taker's initials are mandatory (same block-and-tell
  // UX as the unanswered-red-flag guard above — nothing is generated until it's
  // clear who took the call).
  if (isSensitivePathway(pathway) && !_takerInitials.trim()) {
    if (msg) msg.textContent = 'Enter your initials before generating the summary (required for this pathway).';
    const initials = form.querySelector('#rcpInitials');
    initials?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    initials?.focus();
    return;
  }
  if (msg) msg.textContent = '';

  // Identity comes from the PIN taken when this capture form opened
  // (renderCaptureForm), NOT the live snapshot: with the Patient card
  // auto-refreshing, reading `_snapshot` here would stamp whichever record a
  // colleague has open at generate time onto THIS caller's answers.
  const pc = _capturePatient;
  const patientLine = pc?.patientName
    ? [pc.patientName, pc.dateOfBirth ? `DOB ${pc.dateOfBirth}` : null, pc.nhsNumber ? `NHS ${pc.nhsNumber}` : null]
        .filter(Boolean)
        .join(', ')
    : null;
  const livePc = _snapshot?.patientContext || null;
  const liveId = livePc ? livePc.patientUuid || livePc.patientId || null : null;
  const identityChanged = !!(pc?.patientId && liveId && liveId !== pc.patientId);

  const text = buildCaptureText({
    pathway,
    closingQuestions: _bundledDoc.closingQuestions || [],
    escalations: _bundledDoc.escalations || {},
    ownWords: (form.querySelector('[name="ownWords"]')?.value || '').trim(),
    redFlagAnswers: rfAnswers,
    questionAnswers: (() => {
      const qa = readQuestionAnswers(form, 'q', pathway.questions);
      // Mental-health "today" is the own-words box — copy through so the
      // paste still has the pathway question label.
      if (pathway.id === 'mental-health' && !qa.today) {
        qa.today = (form.querySelector('[name="ownWords"]')?.value || '').trim();
      }
      return qa;
    })(),
    closingAnswers: readQuestionAnswers(form, 'c', _bundledDoc.closingQuestions),
    meta: {
      takerInitials: _takerInitials,
      nowIso: new Date().toISOString(),
      suiteVersion: chrome.runtime.getManifest?.().version || '',
      patientLine,
      pharmacyFirstHint: pharmacyFirstHint(pathway, pc?.ageYears ?? null),
      safeguardingContact: _config.safeguardingContact || '',
      crisisLine: _config.crisisLineText || '',
      // Re-evaluated here, not read off the last render: what goes in the
      // record is what the guardrails say at the moment the summary is built.
      // Withheld states are recorded too (an SEA needs to see what the tool
      // did NOT say); 'none' writes nothing.
      disposition: dispositionRecord(form, pathway),
      // Appointments booked from card 3 during THIS capture (plan D3.1 — the
      // chosen type and slot land in the capture text so the clinician sees
      // what reception booked). In-memory only; never persisted.
      bookedLines: _bookedLines.slice(),
    },
  });

  // Draft completed — clear it before rendering the output screen.
  clearDraft();

  renderOutput(text, pathway, { identityChanged });
}

function renderOutput(text, pathway, opts) {
  const body = container?.querySelector('#rcpCaptureBody');
  if (!body) return;
  // The capture is finished: the booking card belongs to the form, not the
  // summary view. Tearing it down here also releases any reservation still held.
  destroyBookingCard();
  body.innerHTML = `
    <div class="rcp-output">
      <div class="rcp-output-head">
        <span class="rcp-form-title">${esc(pathway.title)} — summary</span>
      </div>
      <textarea class="rcp-output-text" id="rcpOutputText" readonly rows="16"></textarea>
      <div class="rcp-form-actions">
        <button class="rcp-btn rcp-btn-primary" id="rcpCopy">Copy to clipboard</button>
        <button class="rcp-btn" id="rcpNewCapture">New capture</button>
        <span class="rcp-form-msg" id="rcpCopyMsg"></span>
      </div>
      ${
        opts?.identityChanged
          ? `<div class="rcp-error">The record open in Medicus has changed since this capture started. The summary above is headed with the patient the capture began on — if you paste it into the record now open, it goes in the wrong patient's notes.</div>`
          : ''
      }
      <div class="rcp-fineprint">Paste into the Medicus triage entry / task for this patient. Double-check you're on the right patient before pasting.</div>
    </div>`;
  const ta = body.querySelector('#rcpOutputText');
  ta.value = text;
  body.querySelector('#rcpCopy')?.addEventListener('click', async () => {
    const m = body.querySelector('#rcpCopyMsg');
    try {
      await navigator.clipboard.writeText(ta.value);
      if (m) {
        m.textContent = 'Copied.';
        m.className = 'rcp-form-msg rcp-form-msg-ok';
      }
    } catch (_) {
      ta.focus();
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      if (m) {
        m.textContent = ok ? 'Copied.' : 'Copy failed — select the text and copy manually.';
        m.className = ok ? 'rcp-form-msg rcp-form-msg-ok' : 'rcp-form-msg';
      }
    }
  });
  body.querySelector('#rcpNewCapture')?.addEventListener('click', renderPathwayPicker);
}
