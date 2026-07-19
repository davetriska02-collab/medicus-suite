// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Content Script (suite mode, data pipeline only)
// Fetches patient data, evaluates rules, and publishes the in-memory snapshot
// the side panel reads (getSentinelSnapshot). The legacy floating-sidebar UI
// (~800 lines: mount/refresh/render*) was DELETED 2026-07-19 (audit M5) — it
// had been unreachable since suite mode (bootDataOnly is the only boot), and
// its duplicate journal/patient-resolution logic had already drifted from the
// live evaluateAndPublish path. The standalone sidebar lives in git history
// (pre-v3.176.4) if a non-suite deployment is ever revived.

(function () {
  'use strict';

  if (window.__sentinelMounted) return;
  window.__sentinelMounted = true;

  let currentMode = 'live';

  // === CONFIG ===
  // Default config; user overrides loaded from chrome.storage.local['sentinel.config'].
  // Many keys here (chipStyle, density, sidebar*, collapsedSections, …) belonged to
  // the deleted floating-sidebar UI and are no longer read by this file. They are
  // KEPT so the stored-config shape (options page, backups, existing installs)
  // stays stable. Only autoRefresh and defaultMode are still consulted.
  const DEFAULT_CONFIG = {
    // Colours
    chipStyle: 'subtle', // subtle | bold | minimal
    // Density
    density: 'normal', // compact | normal | spacious
    fontSize: 'medium', // small | medium | large
    sidebarWidth: 380, // 320 | 380 | 440 | 520
    sidebarSide: 'right', // left | right
    // Content visibility
    showAchieved: true,
    showNoData: true,
    showDebugPanel: true,
    showDataSourceLine: true,
    showRegisterPills: true,
    showViewLabel: true,
    expandChipsByDefault: false,
    // Sorting & grouping
    chipSort: 'status', // status | name | points
    chipGrouping: 'by-type', // by-type | flat
    collapsedSections: [],
    // Behaviour
    autoRefresh: true,
    refreshDebounceMs: 600,
    defaultMode: 'live', // live | mock
    // Chip style cycle order (used by the sidebar quick-toggle)
    _chipStyleCycle: ['subtle', 'bold', 'minimal'],
  };
  let CONFIG = { ...DEFAULT_CONFIG };

  // ============================================================
  // INIT
  // ============================================================

  function loadSettings(cb) {
    chrome.storage.local.get(['sentinel.config'], (res) => {
      const stored = res['sentinel.config'] || {};
      CONFIG = { ...DEFAULT_CONFIG, ...stored };
      currentMode = CONFIG.defaultMode || 'live';
      cb && cb();
    });
  }

  // Listen for config + rule changes from the options page.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // Rule edits: invalidate the merged-rules cache and re-publish so the side
    // panel reflects the change immediately. Previously this handler only watched
    // sentinel.config and called refresh(), which is a no-op in suite mode
    // (no shadowRoot) — so an edited rule didn't take effect until navigation.
    if (changes['sentinel.rules'] || changes['sentinel.orgRules'] || changes['sentinel.customRules']) {
      _mergedRulesCache = null;
      if (CONFIG.autoRefresh !== false) {
        loadRules()
          .then((rules) => evaluateAndPublish(rules))
          .catch(() => {});
      }
    }
    if (!changes['sentinel.config']) return;
    const newConfig = changes['sentinel.config'].newValue || {};
    CONFIG = { ...DEFAULT_CONFIG, ...newConfig };
  });


  // ============================================================
  // API SHADOW (crossover safety: hybrid parity check + transactional fallback)
  // ============================================================
  // Thin glue over shared/txn-shadow-summary.js (SentinelShadowCompare wrapper)
  // and shared/event-ledger.js — all the actual "is this parity, what does the
  // status say" logic lives in txn-shadow-summary.js so this stays thin.
  //
  // Called from evaluateAndPublish()'s side-panel snapshot path with the chips already
  // decided for the DISPLAYED (session) bundle — this function only computes a
  // status suffix and (best-effort, never awaited) records a ledger event; it
  // can never change or delay the chips already rendered/published.
  //
  // debug.txnShadow (hybrid mode, see engine/data-fetcher.js fetchHybrid):
  //   { bundle }  -> shadow-evaluate the same rules against the txn bundle's
  //                  fields, diff against the displayed chips, append
  //                  ' · API shadow: parity' or ' · API shadow: N difference(s)'.
  //                  A divergence also records ONE 'txn-shadow-divergence'
  //                  ledger event (dedup'd per patient/day).
  //   { error }   -> ' · API shadow: unavailable', records 'txn-shadow-unavailable'.
  // debug.txnFallback (transactional mode: the user asked for the API feed but
  // is seeing session data) -> ' · API feed unavailable — using session data',
  // records 'txn-fallback' with the reason.
  //
  // Wrapped end-to-end in try/catch: a shadow-compare bug must never break
  // clinical rendering, so any failure collapses to ' · API shadow: error'
  // (only when we were actually attempting a shadow diff) or '' otherwise.
  //
  // EventLedger's SOURCES/ACTIONS are a fixed, validated enum (see
  // shared/event-ledger.js) that this feature may not extend — 'sentinel' is
  // the correct source, and the specific "kind" of event (txn-shadow-divergence
  // / txn-shadow-unavailable / txn-fallback) is carried in `ruleId` (the same
  // slot shared/contract-canary.js uses for a non-clinical feature id, not
  // just clinical rule ids). `action` is the closest existing fit: 'shown' for
  // a divergence surfaced alongside chips that were shown, 'aborted' for the
  // two cases where the transactional attempt did not complete as intended.
  function computeApiShadowStatus(data, rules, nowIso, displayedChips) {
    const TSS = typeof window !== 'undefined' ? window.TxnShadowSummary : null;
    const EL = typeof window !== 'undefined' ? window.EventLedger : null;
    const debug = data && data.debug;
    try {
      const patientRef = (data && data.patientContext && data.patientContext.patientUuid) || null;
      if (debug && debug.txnShadow && debug.txnShadow.bundle) {
        const sb = debug.txnShadow.bundle;
        const out = window.SentinelRules.evaluatePatient(sb.medications || [], sb.observations || [], rules, {
          now: nowIso,
          problems: sb.problems || [],
          pastProblems: sb.pastProblems || [],
          patientContext: sb.patientContext,
          observationHistory: sb.observationHistory || [],
          allergies: sb.allergies || [],
        });
        const shadowChips = out.chips || out;
        const summary = TSS ? TSS.summariseShadow({ displayedChips, shadowChips }) : { parity: true };
        const suffix = TSS
          ? TSS.buildStatusSuffix(summary.parity ? { kind: 'parity' } : { kind: 'divergence', count: summary.count })
          : '';
        if (!summary.parity && EL) {
          const p = EL.record(
            {
              source: 'sentinel',
              patientRef,
              ruleId: 'txn-shadow-divergence',
              label: `missing ${summary.missing.length} added ${summary.added.length} changed ${summary.severityChange.length}`,
              severity: summary.safe ? 'escalation-only' : 'regression',
              action: 'shown',
            },
            { dedupe: true }
          );
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return suffix;
      }
      if (debug && debug.txnShadow && debug.txnShadow.error) {
        if (EL) {
          const p = EL.record(
            {
              source: 'sentinel',
              patientRef,
              ruleId: 'txn-shadow-unavailable',
              label: String(debug.txnShadow.error).slice(0, 120),
              action: 'aborted',
            },
            { dedupe: true }
          );
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return TSS ? TSS.buildStatusSuffix({ kind: 'unavailable' }) : '';
      }
      if (debug && debug.txnFallback) {
        if (EL) {
          const p = EL.record(
            {
              source: 'sentinel',
              patientRef,
              ruleId: 'txn-fallback',
              label: String(debug.txnFallback).slice(0, 120),
              action: 'aborted',
            },
            { dedupe: true }
          );
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return TSS ? TSS.buildStatusSuffix({ kind: 'fallback' }) : '';
      }
      return '';
    } catch (e) {
      // Never let a shadow-compare bug break clinical rendering.
      return debug && debug.txnShadow ? ' · API shadow: error' : '';
    }
  }

  // Rule caches. The canonical JSON ships with the extension and never changes at
  // runtime, so we fetch it once. The merged result (canonical + org + individual
  // + custom) is cached too and invalidated by the storage.onChanged listener
  // when any rule key changes — previously loadRules did 2× fetch + 1× storage.get
  // on EVERY evaluation, including the 800ms journal-search re-eval churn.
  let _canonicalRulesCache = null;
  let _mergedRulesCache = null;
  // Rule file metadata (lastUpdated, specVersion) captured from the canonical
  // JSON at load time. Used by buildTraceEnvelope to stamp the export header.
  // In-memory only — never written to storage.
  let _ruleFileMeta = null;

  async function loadRules() {
    if (_mergedRulesCache) return _mergedRulesCache;
    // Load both drug-rules.json and qof-rules.json and merge.
    // Three-tier overrides: canonical -> organisational -> individual -> custom appended.
    if (!_canonicalRulesCache) {
      const drugUrl = chrome.runtime.getURL('rules/drug-rules.json');
      const qofUrl = chrome.runtime.getURL('rules/qof-rules.json');
      const vaccineUrl = chrome.runtime.getURL('rules/vaccine-rules.json');
      const [drugDoc, qofDoc, vaccineDoc] = await Promise.all([
        fetch(drugUrl).then((r) => r.json()),
        fetch(qofUrl).then((r) => r.json()),
        fetch(vaccineUrl).then((r) => r.json()),
      ]);
      _canonicalRulesCache = [...(drugDoc.rules || []), ...(qofDoc.rules || []), ...(vaccineDoc.rules || [])];
      // Capture rule file metadata for trace envelope stamping.
      _ruleFileMeta = [
        { id: 'drug', lastUpdated: drugDoc.lastUpdated || null, specVersion: drugDoc.specVersion || null },
        { id: 'qof', lastUpdated: qofDoc.lastUpdated || null, specVersion: qofDoc.specVersion || null },
        { id: 'vaccine', lastUpdated: vaccineDoc.lastUpdated || null, specVersion: vaccineDoc.specVersion || null },
      ];
    }
    const canonical = _canonicalRulesCache;

    // Load org + individual overrides + custom rules
    return new Promise((resolve) => {
      chrome.storage.local.get(['sentinel.rules', 'sentinel.orgRules', 'sentinel.customRules'], (res) => {
        const individual = res['sentinel.rules'] || {};
        const org = res['sentinel.orgRules'] || null;
        const customRules = res['sentinel.customRules'] || [];
        const RIO = window.SentinelRulesetIo;
        let merged;
        if (RIO) {
          merged = RIO.mergeRules(canonical, org, individual);
        } else {
          // Fallback: apply individual overrides only
          merged = canonical.map((rule) => {
            if (individual[rule.id]) return Object.assign({}, rule, individual[rule.id]);
            return rule;
          });
        }
        // Append enabled custom rules as additions (not overlays)
        const enabledCustom = customRules.filter((r) => r.enabled !== false);
        merged.push(...enabledCustom);
        _mergedRulesCache = merged;
        resolve(merged);
      });
    });
  }

  // ============================================================
  // JOURNAL OBSERVATIONS (for AST007 and future encounter-coded rules)
  // ============================================================

  // Derive the Medicus API origin from the current page URL.
  // Pattern: https://england.medicus.health/560b6c/... → https://560b6c.api.england.medicus.health
  function getMedicusApiOrigin() {
    const siteCode = location.pathname.split('/').filter(Boolean)[0];
    if (!siteCode || !/^[a-f0-9]{5,8}$/.test(siteCode)) return null;
    return `https://${siteCode}.api.${location.hostname}`;
  }

  // Fetch encounter-coded observations from the patient journal overview endpoint.
  // The investigation dashboard misses entries coded inside consultations (e.g. asthma annual
  // review, smoking status, depression questionnaire scores). This function fills that gap
  // for indicators like AST007 whose evidence lives exclusively in the journal.
  //
  // Returns an array of { name, value, date (ISO YYYY-MM-DD), source: 'journal' } objects,
  // filtered to the last 400 days and de-duplicated against existingObs by name+date.
  async function fetchJournalObservations(patientId, existingObs) {
    const apiOrigin = getMedicusApiOrigin();
    if (!apiOrigin || !patientId) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 400);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(`${apiOrigin}/clinical/data/patient-journal/overview/${patientId}`, {
        credentials: 'include',
        signal: ctrl.signal,
      });
      // Audit H5 (2026-07-18): failures must THROW, not return [] — an empty
      // array is indistinguishable from "patient has no journal codes", which
      // made evaluateAndPublish's journalAugmentFailed warning unreachable and
      // let a 500/timeout silently degrade journal-coded QOF indicators to a
      // false-all-clear no_data.
      if (!resp.ok) throw new Error(`journal fetch HTTP ${resp.status}`);
      const d = await resp.json();

      const monthIndex = {
        Jan: 0,
        Feb: 1,
        Mar: 2,
        Apr: 3,
        May: 4,
        Jun: 5,
        Jul: 6,
        Aug: 7,
        Sep: 8,
        Oct: 9,
        Nov: 10,
        Dec: 11,
      };

      // Parse "DD Mon YYYY" (entry.observationDate) or "DayName DD Mon YYYY" (record.title)
      function parseDisplayDate(str) {
        if (!str) return null;
        const parts = str.trim().split(' ').filter(Boolean);
        // "20 Apr 2026" → [20, Apr, 2026]  or  "Mon 11 May 2026" → [Mon, 11, May, 2026]
        const dayStr = parts.length === 3 ? parts[0] : parts[1];
        const monStr = parts.length === 3 ? parts[1] : parts[2];
        const yearStr = parts.length === 3 ? parts[2] : parts[3];
        if (!dayStr || !monStr || !yearStr) return null;
        const mon = monthIndex[monStr];
        if (mon === undefined) return null;
        const d = new Date(parseInt(yearStr), mon, parseInt(dayStr));
        return isNaN(d.getTime()) ? null : d;
      }

      // Build a Set of "name|date" keys already present in the investigation dashboard
      const existingKeys = new Set((existingObs || []).map((o) => `${(o.name || '').toLowerCase()}|${o.date || ''}`));

      const result = [];
      for (const record of d.patientJournalRecords || []) {
        const groupDate = parseDisplayDate(record.title);
        for (const item of record.items || []) {
          // Only encounter items contain consultation-coded observations
          if (item.type !== 'encounter') continue;
          for (const topic of item.data?.consultationTopics || []) {
            for (const heading of topic.headings || []) {
              for (const entry of heading.entries || []) {
                // Skip entries missing a type name, or entries that aren't observations (e.g. medications, problems).
                if (!entry.type || entry.entryType !== 'observation') continue;
                const entryDate = parseDisplayDate(entry.observationDate) || groupDate;
                if (!entryDate || entryDate < cutoff) continue;
                const isoDate = entryDate.toISOString().split('T')[0];
                const nameKey = `${entry.type.toLowerCase()}|${isoDate}`;
                if (existingKeys.has(nameKey)) continue; // already in investigation dashboard
                existingKeys.add(nameKey); // de-dupe within journal results too
                result.push({
                  name: entry.type,
                  value: typeof entry.value === 'string' ? entry.value : '',
                  date: isoDate,
                  source: 'journal',
                });
              }
            }
          }
        }
      }
      return result;
    } catch (e) {
      // Rethrow so callers can distinguish "journal unavailable" from "no
      // journal codes" (audit H5). evaluateAndPublish catches this and stamps
      // journalAugmentFailed onto the snapshot; the panel shows the warning.
      console.warn('[Sentinel] fetchJournalObservations failed:', e.message);
      throw e.name === 'AbortError' ? new Error('journal fetch timed out') : e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Pure: decide whether a zero-result render is genuinely "no matched rules" or a
  // likely extraction failure (Medicus DOM/API drift) that must NOT read as an
  // "all clear". Degraded = we are on a live patient view (a patient was
  // identified) yet extracted no medications, problems, observations AND no
  // demographics — a real record virtually always has at least demographics, so
  // an across-the-board blank means our scrapers stopped matching the page.
  function assessExtractionHealth(data) {
    if (!data || data.mode !== 'live') return { degraded: false, modules: null };
    const pc = data.patientContext || {};
    const onPatientView = !!(pc.patientId || pc.id || pc.uuid || pc.patientName);
    if (!onPatientView) return { degraded: false, modules: null };
    const medCount = (data.medications || []).length;
    const obsCount = (data.observations || []).length;
    const probCount = (data.problems || []).length;
    const demographics = !!(pc.dob || pc.dobRaw || pc.ageYears != null || pc.sex || pc.nhsNumber);
    // Per-module extraction breakdown surfaced (informationally) in the side panel.
    // A zero count is amber-flagged for the clinician to sanity-check against
    // Medicus, but is deliberately NOT treated as a failure: real records
    // legitimately have e.g. no problems or no observations, so per-module zeros
    // must never raise an alarm on their own. The hard `degraded` signal below —
    // the across-the-board blank that means our scrapers stopped matching the
    // page — remains the only thing that must never read as an "all clear".
    const modules = { medications: medCount, observations: obsCount, problems: probCount, demographics };
    const clinical = medCount + obsCount + probCount;
    if (clinical > 0) return { degraded: false, modules };
    if (demographics) return { degraded: false, modules };
    return {
      degraded: true,
      modules,
      reason:
        'A patient was identified, but no medications, problems, observations or demographics could be extracted from this page — Medicus may have changed its layout.',
    };
  }

  // Boot
  // SUITE MODE: do NOT mount the floating sidebar — UI is in the Chrome side panel.
  // We still need the data pipeline (fetch + evaluate) to run so the snapshot bridge
  // has chips to expose to the side panel.
  bootDataOnly();

  function bootDataOnly() {
    if (window.__sentinelBootDataObserver) return;
    loadSettings(async () => {
      try {
        const rules = await loadRules();
        evaluateAndPublish(rules);
        // Re-evaluation timing. A CONFIRMED patient switch (the new URL resolves to
        // a different, known patient) re-evaluates almost immediately; the longer
        // window is reserved for ambiguous churn — journal-search keystrokes emit a
        // burst of patient-unresolvable URLs, and coalescing those avoids the
        // "QOF rules flash up then vanish" flicker. Paying the long window on a
        // confirmed switch was pure dead time (most visible when leaving a heavy
        // documents view), so it now branches on confidence.
        const REEVAL_DELAY_CONFIRMED_MS = 150;
        const REEVAL_DELAY_AMBIGUOUS_MS = 800;
        const URL_POLL_MS = 400; // backstop-poll period (see signal 3 below)

        // Re-evaluate on URL changes inside the SPA. Detection is driven by THREE
        // independent signals so no single one being starved can stall it:
        //   1. a MutationObserver on <body> — the SPA re-render signal (original),
        //   2. the Navigation API `currententrychange` event — fires on pushState/
        //      replaceState/traversal independent of DOM-mutation volume, and
        //   3. a low-frequency `location.href` backstop poll.
        // Why three: a heavy documents view (a large PNG/PDF rendered inline) floods
        // the observer and pins the main thread, which used to delay patient-change
        // detection — the pane appeared "not to reload" until a manual F5, while
        // lightweight task views (labs / med requests) detected instantly. The extra
        // signals make detection robust to that render storm. The handler is
        // idempotent (it no-ops when the URL is unchanged), so all three calling it
        // is harmless — whichever fires first wins and the rest short-circuit.
        let lastUrl = location.href;
        let reevalTimer = null;

        function onUrlMaybeChanged() {
          if (location.href === lastUrl) return;
          lastUrl = location.href;
          // A SPA URL change is EITHER a genuine patient change OR same-patient
          // sub-navigation (journal search, care-record tab switch, a filter).
          // Only a genuine patient change should blank the panel. Wiping valid
          // chips on every journal-search URL update is what made the QOF rules
          // "flash up then get overwritten": invalidate → "Loading…" → re-eval →
          // chips → next keystroke → invalidate again.
          const urlPatient = resolveUrlPatientUuid();
          if (urlPatient && _lastPatientUuid && urlPatient === _lastPatientUuid) {
            // Same patient still on screen — keep the existing chips untouched.
            return;
          }
          // Genuine navigation (different patient, or patient not resolvable from
          // the new URL): invalidate immediately so the side panel can never show
          // the previous patient's chips during the fetch window, then re-evaluate.
          invalidateSnapshot();
          const confirmedSwitch = !!(urlPatient && _lastPatientUuid && urlPatient !== _lastPatientUuid);
          const delay = confirmedSwitch ? REEVAL_DELAY_CONFIRMED_MS : REEVAL_DELAY_AMBIGUOUS_MS;
          if (reevalTimer) clearTimeout(reevalTimer);
          reevalTimer = setTimeout(async () => {
            try {
              evaluateAndPublish(await loadRules());
            } catch (e) {
              invalidateSnapshot();
            }
          }, delay);
        }

        // Signal 1: SPA re-render observer (original).
        const obs = new MutationObserver(onUrlMaybeChanged);
        obs.observe(document.body, { childList: true, subtree: true });
        window.__sentinelBootDataObserver = obs;

        // Signal 2: Navigation API — the direct SPA-navigation signal, independent
        // of DOM-mutation volume so a render storm cannot starve it. Feature-detected
        // (older Chromium without it falls back to signals 1 + 3) and wrapped so a
        // throw can never break boot. `popstate` covers back/forward everywhere.
        try {
          if (window.navigation && typeof window.navigation.addEventListener === 'function') {
            window.navigation.addEventListener('currententrychange', onUrlMaybeChanged);
          }
        } catch (_) {}
        window.addEventListener('popstate', onUrlMaybeChanged);

        // Signal 3: backstop poll. One string compare per tick; bounds detection
        // latency to ~URL_POLL_MS even if signals 1 and 2 are both delayed by a
        // heavy render. Stored so a future teardown can clear it.
        window.__sentinelUrlPoll = setInterval(onUrlMaybeChanged, URL_POLL_MS);
      } catch (e) {}
    });
  }

  function evaluateAndPublish(rules) {
    // Tag this evaluation so a slow fetch that resolves after a newer evaluation
    // (or after a navigation) can't publish stale chips over fresh ones — the
    // journal-search churn fires this repeatedly.
    const gen = ++_evalGen;
    try {
      const fetcher = window.SentinelDataFetcher;
      if (!fetcher) return;
      const result = fetcher.fetchPatientData ? fetcher.fetchPatientData(currentMode) : null;
      Promise.resolve(result)
        .then(async (data) => {
          if (gen !== _evalGen) return; // superseded — drop this stale result
          if (!data || !window.SentinelRules) {
            invalidateSnapshot();
            return;
          }
          // Assess extraction health so publishSnapshot can stamp the degraded flag
          // onto the snapshot the side panel reads (the H-005 canary). Kept local to
          // this call so concurrent evaluations can't cross-contaminate the flag.
          const health = assessExtractionHealth(data);
          // Augment observations with encounter/journal-coded entries (annual-review
          // codes, questionnaire scores, CHA2DS2-VASc, etc.) that never appear in the
          // investigation dashboard, so indicators whose evidence lives only in the
          // journal (AST007, COPD010, HF007, DM014, AF006…) can fire in the SIDE
          // PANEL too — previously this augmentation ran only in the now-dead HUD
          // refresh() path, so these read no_data in suite mode.
          const _patientId =
            data.patientContext?.patientUuid ||
            data.patientContext?.patientId ||
            data.patientContext?.id ||
            data.patientContext?.uuid ||
            null;
          let _journalAugmentFailed = false;
          let _journalAugmentError = null;
          if (currentMode === 'live' && _patientId) {
            try {
              const journalObs = await fetchJournalObservations(_patientId, data.observations || []);
              if (gen !== _evalGen) return; // navigation superseded us during the journal fetch
              if (journalObs.length) data.observations = [...(data.observations || []), ...journalObs];
            } catch (journalErr) {
              // Journal augmentation is best-effort; never block the chip. Record
              // the failure so the side panel can surface a non-blocking warning —
              // QOF chips that rely on journal codes (AST007, COPD010, HF007, etc.)
              // may show no_data when they should not, which is a silent clinical gap.
              // No patient data in the error message — only the error type/message.
              _journalAugmentFailed = true;
              _journalAugmentError = journalErr && journalErr.message ? String(journalErr.message) : 'unknown error';
              console.warn(
                '[Sentinel] Journal augmentation failed — QOF journal-coded indicators may show no_data:',
                _journalAugmentError
              );
            }
          }
          // Evaluate with the FULL merged drug+QOF ruleset, capture the chips, and
          // publish them directly. We deliberately do NOT rely on a side effect of
          // window.SentinelRules.evaluatePatient (see publishSnapshot for why).
          // options.trace:true produces { chips, trace } instead of a plain array;
          // the trace is in-memory only and never written to chrome.storage.local.
          const _evalNowIso = new Date().toISOString();
          const evalResult = window.SentinelRules.evaluatePatient(
            data.medications || [],
            data.observations || [],
            rules,
            {
              now: _evalNowIso,
              problems: data.problems || [],
        pastProblems: data.pastProblems || [],
              patientContext: data.patientContext,
              observationHistory: data.observationHistory || [],
              allergies: data.allergies || [],
              trace: true,
            }
          );
          if (gen !== _evalGen) return; // a navigation invalidated us mid-evaluation
          const chips = evalResult.chips || evalResult; // back-compat guard
          // Crossover-safety visibility (F3): hybrid shadow parity/divergence, and
          // transactional-mode fallback. Computed from the chips already decided
          // above — never blocks or alters them. See computeApiShadowStatus.
          const apiShadowSuffix = computeApiShadowStatus(data, rules, _evalNowIso, chips);
          const rawTrace = evalResult.trace || null;
          // Compute medications with no matching drug-monitoring rule. The detailed
          // variant explains WHY each med is unmatched (no-rule vs. excluded).
          const unmatchedMedsDetailed = window.SentinelRules.listUnmatchedMedicationsDetailed
            ? window.SentinelRules.listUnmatchedMedicationsDetailed(data.medications || [], rules)
            : [];
          const unmatchedMeds = unmatchedMedsDetailed.map((u) => u.name);
          // Elevate any high-risk drug that slipped through unmatched (odd brand,
          // exclude, or disabled rule) — a silent monitoring blind spot.
          const unmatchedHighRisk = window.SentinelRules.flagHighRiskUnmatched
            ? window.SentinelRules.flagHighRiskUnmatched(unmatchedMedsDetailed)
            : [];
          // Stamp rule file metadata onto the trace envelope (captured once at loadRules time).
          let trace = rawTrace;
          if (trace && trace.ruleset) {
            trace.ruleset.files = _ruleFileMeta || trace.ruleset.files || [];
            // Count custom rules (those appended beyond the canonical set)
            const customRuleCount = (rules || []).filter((r) => r.id && r.id.startsWith('custom-')).length;
            trace.ruleset.customRuleCount = customRuleCount;
          }
          // Attach unmatched meds detail to trace envelope
          if (trace) {
            trace.unmatchedMedications = unmatchedMedsDetailed;
          }
          // Assess extraction drift (best-effort — never blocks chip publication).
          const drift = await recordAndAssessDrift(data);
          if (gen !== _evalGen) return; // navigation superseded us during drift assess
          publishSnapshot(
            chips,
            data.patientContext,
            health,
            data,
            unmatchedMeds,
            unmatchedMedsDetailed,
            trace,
            drift,
            _journalAugmentFailed,
            _journalAugmentError,
            unmatchedHighRisk,
            apiShadowSuffix
          );
        })
        .catch(() => {
          if (gen === _evalGen) invalidateSnapshot();
        });
    } catch (e) {
      if (gen === _evalGen) invalidateSnapshot();
    }
  }

  // ── Side panel bridge ──────────────────────────────────────────────────────
  // Stores the last evaluated chip snapshot so the suite side panel can read it
  // without needing a fresh fetch. Written ONLY by publishSnapshot (called from
  // evaluateAndPublish with the full merged drug+QOF ruleset). It is deliberately
  // NOT written as a side effect of window.SentinelRules.evaluatePatient: the
  // triage-lens HUD (content.js) calls that same global with a drug-rules-only
  // ruleset on every record/route tick, and a shared side effect let those calls
  // overwrite the snapshot with QOF-less chips — that was the "QOF rules flash up
  // then vanish on journal search" bug.
  let _lastSnapshot = null;
  // Trend data (observationHistory + problems) cached in lockstep with _lastSnapshot.
  // Cleared on every invalidation so the trend tabs can never render a previous
  // patient's readings against the current record. Modules must also assert that
  // the patientUuid in this payload matches the one in _lastSnapshot before rendering.
  let _lastTrendData = null;
  // Monotonic evaluation generation. Bumped on every evaluateAndPublish and on
  // every invalidateSnapshot so a slow/stale async fetch (e.g. mid journal-search
  // churn) can't publish chips after a newer evaluation or a navigation.
  let _evalGen = 0;
  // UUID of the patient last successfully evaluated. Persists across snapshot
  // invalidation (which clears patientContext) so the nav watcher can tell a
  // same-patient sub-navigation (journal search, tab switch) apart from a real
  // patient change without blanking valid chips.
  let _lastPatientUuid = null;

  // ── Extraction-drift detection (in-memory state) ───────────────────────────
  // The UUID/name+bucket key is in-memory only — never written to storage.
  // Storage only holds integer counts + ISO timestamps (zero PII).
  let _lastSampleKey = null; // `${patientId}|${bucket}` — in-memory only, never persisted
  let _lastSampleAt = 0;
  let _lastDrift = null; // cached so re-renders don't re-read storage

  // Cheap, synchronous "which patient is this URL about?" — used only to decide
  // whether a SPA URL change is a real patient change or same-patient
  // sub-navigation. Mirrors the URL-path resolution in detectMedicusContext and
  // returns null for encounter/task URLs that need async resolution, in which
  // case we conservatively treat the change as a navigation.
  function resolveUrlPatientUuid() {
    try {
      return window.SentinelApiClient?.detectMedicusContext(location.href)?.patientUuid || null;
    } catch (_) {
      return null;
    }
  }

  // Notify any open side panel that the snapshot changed.
  function notifySnapshotUpdated() {
    try {
      const p = chrome.runtime.sendMessage({ type: 'sentinel:snapshot-updated' });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }

  // Assess extraction drift and update the per-view baseline in storage.
  // Entirely wrapped in try/catch — drift detection must NEVER break chip publication.
  // Returns the drift object if drifted and not muted, otherwise null.
  async function recordAndAssessDrift(data) {
    try {
      const EH = window.ExtractionHealth;
      if (!EH) return null;
      const nowIso = new Date().toISOString();
      const summary = EH.summariseExtraction(data, nowIso);
      if (!summary) return null;

      const r = await chrome.storage.local.get('sentinel.extractionBaseline');
      const stored = r['sentinel.extractionBaseline'] || null;

      const drift = EH.assessDrift(stored, summary.bucket, summary.sample);

      // Sample throttle: don't flood storage on every keypress / rapid re-eval.
      // The in-memory key includes the patient id/name so a patient change always
      // records immediately.
      const pc = data.patientContext || {};
      const patientId = pc.patientUuid || pc.patientId || pc.id || pc.uuid || pc.patientName || '?';
      const sampleKey = patientId + '|' + summary.bucket;
      if (EH.shouldRecordSample(_lastSampleKey, _lastSampleAt, sampleKey, Date.now())) {
        // Read-modify-write. Last-writer-wins across tabs is acceptable for
        // this telemetry — occasional sample loss does not affect safety.
        let updated = EH.updateBaseline(stored, summary.bucket, summary.sample);
        if (drift.drifted) updated = EH.markWarned(updated, nowIso);
        chrome.storage.local.set({ 'sentinel.extractionBaseline': updated });
        _lastSampleKey = sampleKey;
        _lastSampleAt = Date.now();
      }

      // Only surface drift when not muted.
      if (drift.drifted && !EH.isMuted(stored, nowIso)) {
        _lastDrift = drift;
        return drift;
      }
      _lastDrift = null;
      return null;
    } catch (_) {
      // Drift detection must never break chip publication.
      return null;
    }
  }

  // Drop any prior patient's snapshot. Called the instant the SPA navigates and
  // whenever an extraction fails, so the side panel can never render a previous
  // patient's chips as if they belonged to the record now on screen. The panel
  // treats `unavailable` as "refreshing", never as a clinical "all clear".
  function invalidateSnapshot() {
    // Cancel any in-flight evaluation so its (now stale) chips can't land after us.
    _evalGen++;
    _lastSnapshot = { chips: null, patientContext: null, evaluatedAt: new Date().toISOString(), unavailable: true };
    _lastTrendData = null;
    notifySnapshotUpdated();
  }

  // Publish a fresh snapshot for the side panel. Called only from
  // evaluateAndPublish, which always uses the full merged drug+QOF ruleset, so
  // the panel never sees a partial (e.g. drug-only) evaluation. We intentionally
  // do NOT monkeypatch window.SentinelRules.evaluatePatient: that global is shared
  // with the triage-lens HUD (content.js:1448, 2092), which evaluates a
  // drug-rules-only set and would otherwise clobber the QOF chips on every
  // record/route tick (e.g. when searching the journal).
  function publishSnapshot(
    chips,
    pc,
    health,
    rawData,
    unmatchedMeds,
    unmatchedMedsDetailed,
    trace,
    drift,
    journalAugmentFailed,
    journalAugmentError,
    unmatchedHighRisk,
    apiShadowSuffix
  ) {
    // Remember the patient we just evaluated so the nav watcher can recognise
    // same-patient sub-navigation and avoid blanking these chips.
    if (pc && pc.patientUuid) _lastPatientUuid = pc.patientUuid;
    _lastSnapshot = {
      chips,
      patientContext: pc || null,
      // Patient-level smoking-status fact for the panel's banner line
      // (shared/smoking-status.js, Practice-panel ruling 2026-07-16). Derived
      // from the SAME observations the chips were evaluated on (incl. the
      // journal augment), so line and chips can never disagree. Null when no
      // smoking-related entry is visible in the window OR the shared helper
      // is absent — the panel then renders the honest-absence wording.
      smoking:
        typeof window !== 'undefined' && window.SmokingStatus && rawData
          ? window.SmokingStatus.deriveSmokingStatus(rawData.observations || [])
          : null,
      evaluatedAt: new Date().toISOString(),
      degraded: !!(health && health.degraded),
      reason: (health && health.reason) || null,
      modules: (health && health.modules) || null,
      unmatchedMeds: unmatchedMeds || [],
      unmatchedMedsDetailed: unmatchedMedsDetailed || [],
      unmatchedHighRisk: unmatchedHighRisk || [],
      // trace is in-memory only — never written to chrome.storage.local.
      // It is invalidated with the snapshot on navigation (invalidateSnapshot).
      trace: trace || null,
      // drift is in-memory only — extraction drift assessment, null when no drift
      // or when muted by the clinician. Never written to chrome.storage.local.
      drift: drift || null,
      // journalAugmentFailed: true when fetchJournalObservations threw.
      // QOF chips that rely on journal codes may show no_data incorrectly.
      // In-memory only — no patient data stored, only the error message string.
      journalAugmentFailed: journalAugmentFailed === true,
      journalAugmentError: journalAugmentFailed ? journalAugmentError || 'unknown error' : null,
      // Crossover-safety (F3): the ' · API shadow: ...' / ' · API feed
      // unavailable — using session data' suffix (built by
      // computeApiShadowStatus), '' when neither the hybrid shadow nor the
      // transactional fallback debug signal is present.
      apiShadowSuffix: apiShadowSuffix || '',
    };
    // Cache the raw observation + problem data for the BP/ACR trend tabs.
    // Written in lockstep with _lastSnapshot and cleared in invalidateSnapshot,
    // so the trend data always belongs to the same patient as the chip snapshot.
    _lastTrendData = rawData
      ? {
          observationHistory: rawData.observationHistory || [],
          problems: rawData.problems || [],
          patientContext: pc || null,
        }
      : null;
    // Notify any open side panel that a fresh snapshot is available so it can
    // re-render immediately on patient change instead of waiting for its poll.
    notifySnapshotUpdated();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // F5: Only accept messages from this extension's own contexts.
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (msg && msg.action === 'getSentinelSnapshot') {
      sendResponse(_lastSnapshot || { chips: null, patientContext: null, evaluatedAt: null });
      return false;
    }
    if (msg && msg.action === 'getTrendData') {
      if (!_lastTrendData) {
        sendResponse(null);
        return false;
      }
      // Attach achieved register chips so trend modules can determine BP targets
      // without re-evaluating rules. Includes only qof-register chips to keep the
      // payload small.
      const registers = ((_lastSnapshot && _lastSnapshot.chips) || [])
        .filter((c) => c.type === 'qof-register')
        .map((c) => ({ code: c.registerCode, name: c.registerName, problem: c.matchedProblem }));
      sendResponse({ ..._lastTrendData, registers });
      return false;
    }
  });
})();
