// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Request Monitor (v1.4)
//
// Polls Medicus task-list API for new/replied medical and admin requests
// against a configured team (assignee UUID). Tracks seen task IDs across
// polls so desktop notifications only fire for genuinely new items.
//
// Storage keys:
//   suite.requestMonitor.enabled       boolean — feature toggle (default false)
//   suite.requestMonitor.assigneeId    string  — team UUID (e.g. Triage Doctor)
//   suite.requestMonitor.pollSeconds   number  — poll interval, min 30 (default 60)
//   suite.requestMonitor.notifyEnabled boolean — desktop notifications (default false)
//   suite.requestMonitor.notifySound   boolean — sound on notification (default false)
//   suite.requestMonitor.state         object  — { buckets, seenIds, lastPoll, error }
//   suite.requestMonitor.authError     boolean — transient: true when paused after 401/403
//
// Practice code is resolved at fetch time via PracticeCode.resolve() — never
// duplicated in this module's config.
//
// DATA-MINIMISATION (F2): chrome.storage.local is plaintext on disk. Patient
// names are never persisted in full. Only initials (e.g. "J.S.") are stored
// in items[].patient so that task deduplication and notification counts work
// without exposing PHI at rest. The strip UI only uses counts, not names.

(function(global) {
  'use strict';

  const CFG_KEYS = {
    enabled:       'suite.requestMonitor.enabled',
    assigneeId:    'suite.requestMonitor.assigneeId',
    pollSeconds:   'suite.requestMonitor.pollSeconds',
    notifyEnabled: 'suite.requestMonitor.notifyEnabled',
    notifySound:   'suite.requestMonitor.notifySound',
  };
  const STATE_KEY     = 'suite.requestMonitor.state';
  const AUTH_ERR_KEY  = 'suite.requestMonitor.authError';

  // ── Practice code format validator ──────────────────────────────────────────
  // Matches the short hex site ID used in Medicus URLs and API subdomains.
  // Reuses the same pattern as practice-code.js (SITE_CODE_RE) so the
  // definition stays in one place and cannot drift. (F8)
  // keep in sync with _SITE_CODE_RE in shared/medicus-api.js
  const PRACTICE_CODE_RE = /^[a-f0-9]{4,8}$/i;

  function isValidPracticeCode(code) {
    return typeof code === 'string' && PRACTICE_CODE_RE.test(code);
  }

  // ── PHI minimisation helper ──────────────────────────────────────────────────
  // Reduces a full patient name to initials before persisting to storage.
  // "John Smith" → "J.S."  |  "Mary O'Brien" → "M.O."  |  "" → ""
  // This ensures chrome.storage.local (plaintext on disk) never holds full names.
  function toInitials(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    return fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(word => word[0].toUpperCase() + '.')
      .join('');
  }

  // ── In-flight deduplication ─────────────────────────────────────────────────
  // A single Promise shared across concurrent callers (SW alarm + panel strip).
  // Cleared in .finally() so the next invocation starts a fresh poll.

  let inFlightPoll = null;

  // ── Auth failure back-off ───────────────────────────────────────────────────
  // When the API returns 401/403, polling is paused for 5 minutes so we don't
  // burn rate-limited requests against a session that has expired.

  let pausedUntil = 0;
  const AUTH_PAUSE_MS = 5 * 60 * 1000;

  // ── AbortController for in-flight requests ──────────────────────────────────
  // Replaced on every new pollAll. The previous controller is never explicitly
  // aborted except via abortInFlight(), so ongoing fetches are only cancelled
  // when the caller (SW) decides to stop polling (e.g. user disables the monitor).

  let currentAbortController = null;

  const DEFAULTS = {
    enabled: false,
    assigneeId: '',
    pollSeconds: 60,
    notifyEnabled: false,
    notifySound: false,
  };
  const MIN_POLL_SECONDS = 30;

  // Four buckets the monitor watches. taskType + status → API filter values.
  const BUCKETS = [
    { key: 'medNew',     taskType: 'medical_patient_request_task', status: 'new-request',    label: 'New med',     short: 'NM' },
    { key: 'medReply',   taskType: 'medical_patient_request_task', status: 'reply-received', label: 'Med reply',   short: 'MR' },
    { key: 'adminNew',   taskType: 'admin_patient_request_task',   status: 'new-request',    label: 'New admin',   short: 'NA' },
    { key: 'adminReply', taskType: 'admin_patient_request_task',   status: 'reply-received', label: 'Admin reply', short: 'AR' },
  ];

  // ── Config ──────────────────────────────────────────────────────────────────

  async function getConfig() {
    const r = await chrome.storage.local.get(Object.values(CFG_KEYS));
    return {
      enabled:       r[CFG_KEYS.enabled]       ?? DEFAULTS.enabled,
      assigneeId:    r[CFG_KEYS.assigneeId]    ?? DEFAULTS.assigneeId,
      pollSeconds:   Math.max(MIN_POLL_SECONDS, r[CFG_KEYS.pollSeconds] ?? DEFAULTS.pollSeconds),
      notifyEnabled: r[CFG_KEYS.notifyEnabled] ?? DEFAULTS.notifyEnabled,
      notifySound:   r[CFG_KEYS.notifySound]   ?? DEFAULTS.notifySound,
    };
  }

  async function setConfig(partial) {
    const updates = {};
    for (const [k, v] of Object.entries(partial)) {
      if (CFG_KEYS[k]) updates[CFG_KEYS[k]] = v;
    }
    await chrome.storage.local.set(updates);
  }

  // ── URL builders ────────────────────────────────────────────────────────────

  function buildApiUrl(practiceCode, taskType, status, assigneeId) {
    const base = `https://${practiceCode}.api.england.medicus.health/tasks/data/${taskType}/task-list`;
    const params = new URLSearchParams();
    params.append('statuses[]', status);
    params.append('viewContext', 'homepage');
    params.append('masterAssignee', assigneeId);
    return `${base}?${params.toString()}`;
  }

  function buildClickUrl(practiceCode, taskType, status, assigneeId) {
    const base = `https://england.medicus.health/${practiceCode}/tasks/${taskType}/task-list`;
    const params = new URLSearchParams();
    params.append('statuses[]', status);
    params.append('viewContext', 'homepage');
    params.append('masterAssignee', assigneeId);
    return `${base}?${params.toString()}`;
  }

  // ── Bucket fetch ────────────────────────────────────────────────────────────

  async function fetchBucket(practiceCode, assigneeId, bucket, fetchImpl, signal) {
    // F8: Validate practice code format before interpolating into fetch URL.
    // Abort with a safe error rather than building a request to an unexpected host.
    if (!isValidPracticeCode(practiceCode)) {
      return { count: 0, taskIds: [], items: [], error: 'Invalid practice code format' };
    }
    const url = buildApiUrl(practiceCode, bucket.taskType, bucket.status, assigneeId);
    const _fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!_fetch) return { count: 0, taskIds: [], items: [], error: 'No fetch impl' };

    try {
      const r = await _fetch(url, { credentials: 'include', signal });
      if (!r.ok) {
        // 401/403: signal auth failure to pollAll so it can pause polling
        if (r.status === 401 || r.status === 403) {
          return { count: 0, taskIds: [], items: [], error: `HTTP ${r.status}`, authFailed: true };
        }
        return { count: 0, taskIds: [], items: [], error: `HTTP ${r.status}` };
      }
      const d = await r.json();
      const tasks = d.tasks || [];
      return {
        count: tasks.length,
        taskIds: tasks.map(t => t.id),
        // F2 DATA-MINIMISATION: store only initials, never the full patient name.
        // chrome.storage.local is plaintext on disk; the strip UI only uses counts.
        items: tasks.map(t => ({
          id: t.id,
          patient: toInitials(t.patientName),
          summary: t.summary || t.summaryLabel,
          priority: t.priority,
          createdAt: t.createdAt,
        })),
        error: null,
      };
    } catch (e) {
      return { count: 0, taskIds: [], items: [], error: String(e.message || e) };
    }
  }

  // ── Poll all four buckets ───────────────────────────────────────────────────
  //
  // Deduplication: if a poll is already in flight (e.g. SW alarm fires while
  // the panel strip is also polling), share the same Promise rather than
  // launching a second set of fetches that would race on the storage write.
  //
  // Auth back-off: when any bucket returns 401/403, polling is paused for
  // AUTH_PAUSE_MS (5 min) and suite.requestMonitor.authError is set to true.
  // The pause is cleared when the user updates any config key.

  function pollAll(practiceCode, assigneeId, opts) {
    if (inFlightPoll) return inFlightPoll;

    inFlightPoll = _doPollAll(practiceCode, assigneeId, opts).finally(() => {
      inFlightPoll = null;
    });
    return inFlightPoll;
  }

  async function _doPollAll(practiceCode, assigneeId, opts) {
    opts = opts || {};
    const fetchImpl = opts.fetch;
    // usesRealFetch: true when running against the live Medicus API (no override).
    // Auth back-off only applies to real API calls — mocked tests always proceed.
    const usesRealFetch = !fetchImpl;

    if (!practiceCode || !assigneeId) {
      return { ok: false, error: 'Not configured', buckets: {}, totalCount: 0, freshByBucket: {} };
    }

    // Return cached state without fetching if we are in auth back-off (production only)
    if (usesRealFetch && pausedUntil > Date.now()) {
      const cached = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || { buckets: {}, seenIds: {} };
      return {
        ok: false,
        error: 'Auth error — polling paused',
        buckets: cached.buckets || {},
        totalCount: 0,
        freshByBucket: {},
        isFirstPoll: !cached.lastPoll,
        authPaused: true,
      };
    }

    // New AbortController per poll cycle; previous cycle's signal is not reused
    const ac = new (typeof AbortController !== 'undefined' ? AbortController : function() {
      this.signal = null; this.abort = function() {};
    })();
    currentAbortController = ac;
    const signal = ac.signal;

    const prevState = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || { buckets: {}, seenIds: {} };
    const seenIds = prevState.seenIds || {};

    const buckets = {};
    let totalCount = 0;
    const freshByBucket = {};
    let firstError = null;
    let authFailed = false;

    for (const b of BUCKETS) {
      const result = await fetchBucket(practiceCode, assigneeId, b, fetchImpl, signal);
      buckets[b.key] = result;
      totalCount += result.count;
      if (result.error && !firstError) firstError = result.error;
      if (result.authFailed) authFailed = true;

      // Fresh = items in current poll whose IDs weren't in the previous seenIds
      const seen = new Set(seenIds[b.key] || []);
      const fresh = result.items.filter(it => !seen.has(it.id));
      if (fresh.length > 0) freshByBucket[b.key] = { bucket: b, items: fresh };

      // Update seenIds to current snapshot (resolved tasks naturally fall out)
      seenIds[b.key] = result.taskIds;
    }

    // If any bucket signalled an auth failure, engage 5-min back-off (production only)
    if (authFailed && usesRealFetch) {
      pausedUntil = Date.now() + AUTH_PAUSE_MS;
      await chrome.storage.local.set({ [AUTH_ERR_KEY]: true });
    }

    const newState = {
      buckets,
      seenIds,
      lastPoll: Date.now(),
      error: firstError,
    };
    await chrome.storage.local.set({ [STATE_KEY]: newState });

    return {
      ok: !firstError,
      error: firstError,
      buckets,
      totalCount,
      freshByBucket,
      isFirstPoll: !prevState.lastPoll,  // don't notify on the very first poll after install
    };
  }

  // ── State accessors ─────────────────────────────────────────────────────────

  async function getState() {
    const r = await chrome.storage.local.get(STATE_KEY);
    return r[STATE_KEY] || { buckets: {}, seenIds: {}, lastPoll: null, error: null };
  }

  async function clearState() {
    await chrome.storage.local.set({ [STATE_KEY]: { buckets: {}, seenIds: {}, lastPoll: null, error: null } });
  }

  // ── Abort helper ────────────────────────────────────────────────────────────
  // Called by the SW when the user disables the monitor so in-flight network
  // requests are cancelled immediately rather than completing and writing state.

  function abortInFlight() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  }

  // ── Config-change reset ─────────────────────────────────────────────────────
  // Clears auth back-off so a user who re-enters their credentials (or changes
  // any config key) can immediately retry without waiting 5 minutes.

  function clearAuthPause() {
    pausedUntil = 0;
    // Clear transient storage flag (fire-and-forget)
    chrome.storage.local.remove(AUTH_ERR_KEY).catch(() => {});
  }

  // ── Public surface ──────────────────────────────────────────────────────────

  const api = {
    BUCKETS,
    DEFAULTS,
    MIN_POLL_SECONDS,
    CFG_KEYS,
    STATE_KEY,
    AUTH_ERR_KEY,
    PRACTICE_CODE_RE,
    isValidPracticeCode,
    toInitials,
    getConfig,
    setConfig,
    buildApiUrl,
    buildClickUrl,
    fetchBucket,
    pollAll,
    getState,
    clearState,
    abortInFlight,
    clearAuthPause,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.RequestMonitor = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
