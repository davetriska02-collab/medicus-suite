// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Clinical Event Ledger (F2)
//
// A machine-local, append-only ring buffer of what THIS extension displayed or
// did on THIS machine: alerts shown, dismissals, recall tasks created, patient
// summaries copied, pre-flight checks run, results filed via Lab Filing, and
// (Horizon-1 H2) DOM-contract canary transitions — a runtime probe of the
// suite's OWN integration points going degraded/recovered (source 'health',
// see shared/contract-canary.js; always patientRef null — self-diagnosis, not
// a clinical event). It exists to answer "did the tool flag this?" with
// evidence instead of a shrug.
//
// WHAT IT IS NOT (load-bearing honesty, mirrored in the Options disclosure):
//   - NOT part of the clinical record, and no substitute for Medicus's own
//     audit trail.
//   - Absence of an event is NOT evidence nothing was shown — the extension
//     only logs while it is open and running on this machine.
//
// Storage key: ledger.events (chrome.storage.local) — newest-first array.
//   Cap: MAX_EVENTS (5000) AND RETENTION_DAYS (90); pruned on every append.
//   DELIBERATELY EXCLUDED from suite backup — same doctrine as
//   labfiling.auditLog / triagelens.oir.auditLog: restoring an event ledger
//   onto another machine would fabricate a misleading "what was shown here"
//   record. See test-backup-coverage.js ALLOWLIST.
//
// Event shape (all fields short strings or null — see makeEvent):
//   { ts, source, patientRef, severity, ruleId, label, action }
//   - patientRef is the Medicus patient UUID ONLY — NEVER a patient name.
//     sanitisePatientRef() enforces this shape-wise: anything that does not
//     look like a UUID/hex identifier (e.g. contains spaces/letters beyond
//     hex) is stored as null rather than risk writing PHI at rest.
//   - label is clipped and must come from MATCHED rule/drug/profile names,
//     never free-typed user text (callers' responsibility; the clip is the
//     backstop against bloat).
//
// Fire-and-forget writes: every public storage API here swallows its own
// errors (console.warn only) — a throwing or quota-full storage layer must
// NEVER break the calling surface (a chip render, a filing click).
//
// Dedupe: record(evt, { dedupe: true }) collapses same patient+ruleId+action
// within the same calendar day into one event (evidence, not noise). Used by
// Sentinel's "shown" instrumentation, which re-renders every ~10 s. A
// session-local key cache short-circuits repeat calls without a storage read.
//
// Usage (browser classic script): window.EventLedger.<fn>(...)
// Usage (Node / test):             require('./shared/event-ledger.js').<fn>(...)
// Dual-export pattern: same as shared/extraction-health.js.

(function (global) {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'ledger.events';
  const MAX_EVENTS = 5000;
  const RETENTION_DAYS = 90;
  // 'health' (Horizon-1 H2) — shared/contract-canary.js's own runtime DOM-contract
  // probes, NOT a clinical source: patientRef is always null for these events (see
  // contract-canary.js). 'contract-degraded'/'contract-recovered' are its two actions.
  const SOURCES = ['sentinel', 'sweep', 'labfiling', 'record', 'preflight', 'health'];
  const ACTIONS = [
    'shown',
    'dismissed',
    'recall-created',
    'summary-copied',
    'preflight-run',
    'sweep-run',
    'filed',
    'contract-degraded',
    'contract-recovered',
  ];
  const MAX_LABEL_LEN = 120;
  const MAX_RULEID_LEN = 80;
  const MAX_SEVERITY_LEN = 24;
  const SESSION_CACHE_MAX = 2000;

  // Medicus patient identifiers are UUIDs (hex + hyphens). Anything else —
  // in particular anything containing whitespace or non-hex letters, i.e. a
  // patient NAME passed by mistake — is rejected to null so PHI can never be
  // written to this log.
  const UUIDISH_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/;

  function warn(e) {
    try {
      console.warn('[EventLedger] ignored storage failure:', e && e.message ? e.message : e);
    } catch (_) {
      /* console unavailable — still never throw */
    }
  }

  function storageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  // ── Pure helpers (unit-tested directly in test-event-ledger.js) ───────────

  /** Reject anything that does not look like a UUID/hex identifier → null. */
  function sanitisePatientRef(ref) {
    if (ref == null) return null;
    const s = String(ref).trim();
    return UUIDISH_RE.test(s) ? s.toLowerCase() : null;
  }

  /**
   * Normalise a raw event into the stored shape, or null when unusable
   * (unknown source/action). Strings are clipped as a bloat/PHI backstop.
   */
  function makeEvent(raw, nowIso) {
    if (!raw || typeof raw !== 'object') return null;
    const source = SOURCES.includes(raw.source) ? raw.source : null;
    const action = ACTIONS.includes(raw.action) ? raw.action : null;
    if (!source || !action) return null;
    const clip = (v, n) => {
      if (v == null) return null;
      const s = String(v).slice(0, n);
      return s || null;
    };
    return {
      ts: typeof raw.ts === 'string' && raw.ts ? raw.ts : nowIso,
      source,
      patientRef: sanitisePatientRef(raw.patientRef),
      severity: clip(raw.severity, MAX_SEVERITY_LEN),
      ruleId: clip(raw.ruleId, MAX_RULEID_LEN),
      label: clip(raw.label, MAX_LABEL_LEN),
      action,
    };
  }

  /**
   * Enforce both caps on a newest-first array: drop events older than
   * RETENTION_DAYS, then keep the newest MAX_EVENTS. Non-mutating.
   */
  function pruneEvents(events, nowIso) {
    const arr = Array.isArray(events) ? events.filter((e) => e && typeof e.ts === 'string') : [];
    const cutoff = new Date(new Date(nowIso).getTime() - RETENTION_DAYS * 86400000).toISOString();
    return arr.filter((e) => e.ts >= cutoff).slice(0, MAX_EVENTS);
  }

  /** Calendar-day dedupe key: same patient + rule + action on the same day. */
  function dedupeKey(evt) {
    return [evt.patientRef || '', evt.ruleId || '', evt.action || '', String(evt.ts || '').slice(0, 10)].join('|');
  }

  /**
   * True when the newest-first array already holds an event with the same
   * patient+ruleId+action on the same calendar day as evt. Scans only the
   * head of the array (events are newest-first, so once ts is before evt's
   * day the scan can stop).
   */
  function hasSameDayDuplicate(events, evt) {
    if (!Array.isArray(events)) return false;
    const day = String(evt.ts || '').slice(0, 10);
    const key = dedupeKey(evt);
    for (const e of events) {
      if (!e || typeof e.ts !== 'string') continue;
      if (e.ts.slice(0, 10) < day) break; // newest-first: past evt's day, stop
      if (dedupeKey(e) === key) return true;
    }
    return false;
  }

  /**
   * Filter events by patient UUID (exact or prefix, case-insensitive) and/or
   * an inclusive YYYY-MM-DD date range. Order is preserved (newest-first in).
   */
  function filterEvents(events, query) {
    const q = query || {};
    const ref = q.patientRef ? String(q.patientRef).trim().toLowerCase() : '';
    const from = q.from ? String(q.from).slice(0, 10) : null;
    const to = q.to ? String(q.to).slice(0, 10) : null;
    return (Array.isArray(events) ? events : []).filter((e) => {
      if (!e) return false;
      if (
        ref &&
        !String(e.patientRef || '')
          .toLowerCase()
          .startsWith(ref)
      )
        return false;
      const day = String(e.ts || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }

  /**
   * One CSV cell: RFC-4180 quote-doubling (house pattern — see
   * shared/lab-filing-utils.js auditCsv / referrals csvCell) PLUS a
   * spreadsheet formula-injection guard — a cell starting with = + - @ or a
   * tab/CR is prefixed with a literal apostrophe so Excel/Sheets render it as
   * text rather than executing it. ruleId/label originate from rule files and
   * profiles, but this export is the one surface a crafted value would reach
   * a spreadsheet, so it is neutralised here at write time.
   */
  function csvCell(val) {
    let s = String(val == null ? '' : val);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** CSV of events for export — header + one row per event, newest-first. */
  function eventsCsv(events) {
    const cols = ['ts', 'source', 'patientRef', 'severity', 'ruleId', 'label', 'action'];
    const rows = [cols.join(',')];
    for (const e of Array.isArray(events) ? events : []) {
      rows.push(cols.map((c) => csvCell(e ? e[c] : '')).join(','));
    }
    return rows.join('\r\n');
  }

  // ── Session dedupe cache ───────────────────────────────────────────────────
  // Keys of events already recorded (or confirmed duplicate) this session.
  // Day is part of the key, so midnight rolls over naturally. Bounded.
  let _sessionKeys = new Set();

  function resetSessionDedupe() {
    _sessionKeys = new Set();
  }

  // ── Storage APIs — fire-and-forget, NEVER throw ───────────────────────────

  /**
   * Append one event. Fire-and-forget: resolves true when written, false when
   * skipped (invalid event, duplicate, no storage) or when storage failed —
   * it NEVER rejects and NEVER throws, so calling surfaces cannot be broken
   * by a full/broken storage layer.
   *
   * @param {object} raw   { source, patientRef, severity, ruleId, label, action, ts? }
   * @param {object} [opts] { dedupe: true } → collapse same patient+ruleId+action
   *                        within the same calendar day into one event.
   */
  async function record(raw, opts) {
    try {
      const evt = makeEvent(raw, new Date().toISOString());
      if (!evt) return false;
      const dedupe = !!(opts && opts.dedupe);
      const key = dedupeKey(evt);
      if (dedupe && _sessionKeys.has(key)) return false;
      if (!storageAvailable()) return false;
      const r = await chrome.storage.local.get(STORAGE_KEY);
      const arr = Array.isArray(r[STORAGE_KEY]) ? r[STORAGE_KEY] : [];
      if (dedupe && hasSameDayDuplicate(arr, evt)) {
        _sessionKeys.add(key);
        return false;
      }
      arr.unshift(evt);
      await chrome.storage.local.set({ [STORAGE_KEY]: pruneEvents(arr, evt.ts) });
      if (dedupe) {
        if (_sessionKeys.size >= SESSION_CACHE_MAX) resetSessionDedupe();
        _sessionKeys.add(key);
      }
      return true;
    } catch (e) {
      warn(e);
      return false;
    }
  }

  /** Read all events (newest-first). Returns [] on any failure — never throws. */
  async function getEvents() {
    try {
      if (!storageAvailable()) return [];
      const r = await chrome.storage.local.get(STORAGE_KEY);
      return Array.isArray(r[STORAGE_KEY]) ? r[STORAGE_KEY] : [];
    } catch (e) {
      warn(e);
      return [];
    }
  }

  /** Wipe the ledger. Resolves true on success, false on failure — never throws. */
  async function clearLedger() {
    try {
      if (!storageAvailable()) return false;
      await chrome.storage.local.remove(STORAGE_KEY);
      resetSessionDedupe();
      return true;
    } catch (e) {
      warn(e);
      return false;
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const api = {
    record,
    getEvents,
    clearLedger,
    // pure helpers (tested directly; also used by the Options card)
    makeEvent,
    sanitisePatientRef,
    pruneEvents,
    dedupeKey,
    hasSameDayDuplicate,
    filterEvents,
    eventsCsv,
    csvCell,
    resetSessionDedupe, // test hook — clears the session dedupe cache
    constants: {
      STORAGE_KEY,
      MAX_EVENTS,
      RETENTION_DAYS,
      SOURCES,
      ACTIONS,
      MAX_LABEL_LEN,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.EventLedger = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
