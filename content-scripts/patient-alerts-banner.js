// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Patient Alerts — on-page flag banner (content script, isolated world)
//
// Renders the practice's own per-patient flags (patientAlerts.byPatient, owned
// by the Pt Alerts side-panel tab) as a slim banner INSIDE the live Medicus
// patient record page, prepended into Medicus's own patient header — so the
// flag is seen by anyone who opens the record, whether or not the side panel
// is open.
//
// WRONG-PATIENT SAFETY (H-042): patient identity is re-resolved from the live
// page on EVERY render pass — URL patient UUID (SentinelApiClient) first, NHS
// number scraped from the on-screen banner (SentinelPatientContext) as the
// lookup fallback; a name alone never matches. When identity cannot be
// resolved, or the patient has no flags, the banner is REMOVED — absence is
// "none recorded or not identified", never an all-clear.
//
// SPA survival: Medicus's Vue reconciler strips trailing foreign DOM nodes on
// re-render, so the banner is PREPENDED (CLAUDE.md chip-injection rule #1) and
// re-injected on every DOM churn via the shared rAF-coalesced observer hub
// (content-scripts/dom-observer-hub.js). Injection is idempotent: a banner
// whose patient-key and content signature are unchanged is left alone.
//
// Read-only surface: this script never writes to the store. Lookup helpers
// come from shared/patient-alerts-lookup.js (kept in sync with the panel's
// ES-module core by test-patient-alerts-lookup.js).

(function () {
  'use strict';

  if (window.__paBannerMounted) return;
  window.__paBannerMounted = true;

  var BANNER_CLASS = 'pa-page-banner';
  var STORE_KEY = 'patientAlerts.byPatient';
  // Medicus's own patient header containers — same selector set sentinel's
  // pageReady() waits on (content-scripts/triage-lens/content.js).
  var HOST_SELECTOR = '[class*="patient-banner"], [class*="patient-header"], [data-cy*="patient-banner"]';

  var _store = null; // null until first load; {} = loaded, empty
  var _renderQueued = false;

  function lookupApi() {
    return typeof window !== 'undefined' ? window.PatientAlertsLookup : null;
  }

  function loadStore(cb) {
    try {
      chrome.storage.local.get(STORE_KEY, function (r) {
        _store = r && r[STORE_KEY] && typeof r[STORE_KEY] === 'object' ? r[STORE_KEY] : {};
        if (cb) cb();
      });
    } catch (_) {
      _store = {};
      if (cb) cb();
    }
  }

  // Resolve the on-screen patient's identity from the live page. Returns
  // { patientUuid, nhsNumber } (either may be null) — never a name.
  function resolveIdentity() {
    var patientUuid = null;
    var nhsNumber = null;
    try {
      var ctx = window.SentinelApiClient && window.SentinelApiClient.detectMedicusContext(location.href);
      if (ctx && ctx.patientUuid) patientUuid = ctx.patientUuid;
    } catch (_) {
      /* identity stays null — banner will be removed, never stale */
    }
    try {
      var pc = window.SentinelPatientContext && window.SentinelPatientContext.extract(document);
      if (pc && pc.nhsNumber) nhsNumber = pc.nhsNumber;
    } catch (_) {
      /* as above */
    }
    return { patientUuid: patientUuid, nhsNumber: nhsNumber };
  }

  function removeBanner() {
    var existing = document.querySelectorAll('.' + BANNER_CLASS);
    for (var i = 0; i < existing.length; i++) existing[i].remove();
  }

  function buildBanner(summary, key, sig) {
    var el = document.createElement('div');
    el.className = BANNER_CLASS + ' ' + BANNER_CLASS + '--' + (summary.severity === 'red' ? 'red' : 'amber');
    el.setAttribute('data-pa-key', key);
    el.setAttribute('data-pa-sig', sig);
    el.setAttribute('role', 'note');
    var icon = document.createElement('span');
    icon.className = 'pa-page-banner-icon';
    icon.textContent = '⚑';
    el.appendChild(icon);
    var lead = document.createElement('span');
    lead.className = 'pa-page-banner-lead';
    lead.textContent = 'Practice alerts:';
    el.appendChild(lead);
    // Flag pills — textContent only (user-authored labels, never innerHTML).
    for (var i = 0; i < summary.all.length && i < 5; i++) {
      var pill = document.createElement('span');
      pill.className = 'pa-page-banner-pill';
      pill.textContent = summary.all[i];
      el.appendChild(pill);
    }
    if (summary.all.length > 5) {
      var more = document.createElement('span');
      more.className = 'pa-page-banner-more';
      more.textContent = '+' + (summary.all.length - 5) + ' more';
      el.appendChild(more);
    }
    el.title =
      'Recorded by this practice in Medicus Suite (Pt Alerts tab) — not part of the clinical record. Manage in the side panel.';
    return el;
  }

  function render() {
    var LK = lookupApi();
    if (!LK || _store === null) return;

    var ids = resolveIdentity();
    if (!ids.patientUuid && !ids.nhsNumber) {
      removeBanner();
      return;
    }
    var found = LK.findEntry(_store, ids);
    var summary = found ? LK.summariseFlags(found.entry.alerts) : null;
    if (!summary) {
      removeBanner();
      return;
    }

    var host = document.querySelector(HOST_SELECTOR);
    if (!host) {
      // Header not rendered (yet, or not a record view) — never float the
      // banner elsewhere; it must sit with Medicus's own patient identity.
      removeBanner();
      return;
    }

    // Idempotence + wrong-patient guard: an existing banner is kept only when
    // it belongs to the SAME patient key with the SAME content; anything else
    // is torn down and rebuilt from the fresh lookup.
    var sig = summary.severity + '|' + summary.all.join('|');
    var current = host.querySelector('.' + BANNER_CLASS);
    if (current && current.getAttribute('data-pa-key') === found.key && current.getAttribute('data-pa-sig') === sig) {
      return;
    }
    removeBanner();
    // PREPEND — trailing foreign nodes get reconciled away by Vue (rule #1).
    host.insertBefore(buildBanner(summary, found.key, sig), host.firstChild);
  }

  // Coalesce render calls: the observer hub fires per animation frame during
  // SPA churn; one queued render per frame is plenty.
  function queueRender() {
    if (_renderQueued) return;
    _renderQueued = true;
    setTimeout(function () {
      _renderQueued = false;
      try {
        render();
      } catch (_) {
        /* a banner bug must never break the host page */
      }
    }, 100);
  }

  // Boot: load the store, then watch for DOM churn + store edits + navigation.
  loadStore(function () {
    queueRender();
  });

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[STORE_KEY]) return;
      _store =
        changes[STORE_KEY].newValue && typeof changes[STORE_KEY].newValue === 'object'
          ? changes[STORE_KEY].newValue
          : {};
      queueRender();
    });
  } catch (_) {
    /* storage unavailable — banner simply stays absent */
  }

  if (window.__chObserverHub && typeof window.__chObserverHub.subscribe === 'function') {
    window.__chObserverHub.subscribe(function () {
      queueRender();
    });
  } else {
    // Fallback: low-frequency poll if the hub failed to load before us.
    setInterval(queueRender, 2000);
  }
  window.addEventListener('popstate', queueRender);
  window.addEventListener('hashchange', queueRender);
})();
