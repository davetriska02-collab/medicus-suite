// Medicus Suite — Request Monitor (v1.3)
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
//
// Practice code is resolved at fetch time via PracticeCode.resolve() — never
// duplicated in this module's config.

(function(global) {
  'use strict';

  const CFG_KEYS = {
    enabled:       'suite.requestMonitor.enabled',
    assigneeId:    'suite.requestMonitor.assigneeId',
    pollSeconds:   'suite.requestMonitor.pollSeconds',
    notifyEnabled: 'suite.requestMonitor.notifyEnabled',
    notifySound:   'suite.requestMonitor.notifySound',
  };
  const STATE_KEY = 'suite.requestMonitor.state';

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

  async function fetchBucket(practiceCode, assigneeId, bucket, fetchImpl) {
    const url = buildApiUrl(practiceCode, bucket.taskType, bucket.status, assigneeId);
    const _fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!_fetch) return { count: 0, taskIds: [], items: [], error: 'No fetch impl' };

    try {
      const r = await _fetch(url, { credentials: 'include' });
      if (!r.ok) return { count: 0, taskIds: [], items: [], error: `HTTP ${r.status}` };
      const d = await r.json();
      const tasks = d.tasks || [];
      return {
        count: tasks.length,
        taskIds: tasks.map(t => t.id),
        items: tasks.map(t => ({
          id: t.id,
          patient: t.patientName,
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

  async function pollAll(practiceCode, assigneeId, opts) {
    opts = opts || {};
    const fetchImpl = opts.fetch;

    if (!practiceCode || !assigneeId) {
      return { ok: false, error: 'Not configured', buckets: {}, totalCount: 0, freshByBucket: {} };
    }

    const prevState = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || { buckets: {}, seenIds: {} };
    const seenIds = prevState.seenIds || {};

    const buckets = {};
    let totalCount = 0;
    const freshByBucket = {};
    let firstError = null;

    for (const b of BUCKETS) {
      const result = await fetchBucket(practiceCode, assigneeId, b, fetchImpl);
      buckets[b.key] = result;
      totalCount += result.count;
      if (result.error && !firstError) firstError = result.error;

      // Fresh = items in current poll whose IDs weren't in the previous seenIds
      const seen = new Set(seenIds[b.key] || []);
      const fresh = result.items.filter(it => !seen.has(it.id));
      if (fresh.length > 0) freshByBucket[b.key] = { bucket: b, items: fresh };

      // Update seenIds to current snapshot (resolved tasks naturally fall out)
      seenIds[b.key] = result.taskIds;
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

  // ── Public surface ──────────────────────────────────────────────────────────

  const api = {
    BUCKETS,
    DEFAULTS,
    MIN_POLL_SECONDS,
    CFG_KEYS,
    STATE_KEY,
    getConfig,
    setConfig,
    buildApiUrl,
    buildClickUrl,
    fetchBucket,
    pollAll,
    getState,
    clearState,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.RequestMonitor = api;
  }
})(typeof window !== 'undefined' ? window : global);
