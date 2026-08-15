// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Clinical Event Ledger (F2)
//
// A machine-local, append-only ring buffer of what THIS extension displayed or
// did on THIS machine: alerts shown, dismissals, recall tasks created, patient
// summaries copied, pre-flight checks run, results filed via Lab Filing,
// bulk task-queue batches committed (source 'bulk-action' — see H-063), and
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
// Storage layout (chrome.storage.local) — DAY-SHARDED (audit H12, 2026-07-19):
//   ledger.events.<YYYY-MM-DD>  newest-first array of that day's events
//   ledger.shardIndex           { '<YYYY-MM-DD>': count, … } — the shard
//                               directory; getEvents/clearLedger only touch
//                               days listed here.
//   ledger.events               LEGACY monolithic array (pre-v3.176.4);
//                               migrated into shards on first API use and
//                               removed. Kept in the docs so old exports make
//                               sense.
//   Why sharded: the monolithic array meant every record() re-read and
//   re-wrote up to MAX_EVENTS (5000) events — on a busy day that was a
//   multi-hundred-KB storage churn per chip render. An append now touches
//   only TODAY's shard plus the small index.
//   Caps unchanged: MAX_EVENTS (5000) total AND RETENTION_DAYS (90),
//   enforced on every append via the shard index (whole-day drops + a
//   boundary-day trim), and belt-and-braces re-applied on read.
//   ALL keys DELIBERATELY EXCLUDED from suite backup — same doctrine as
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

  // Re-entry guard (audit, 2026-07-18): this file used to be listed in TWO
  // manifest content-script blocks; the second load replaced window.EventLedger
  // and discarded the first instance's session dedupe cache. The duplicate
  // manifest entry is gone, but the guard makes double-loading harmless.
  if (global && global.EventLedger) return;

  // ── Constants ─────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'ledger.events'; // LEGACY monolithic key — migrated to shards
  const SHARD_PREFIX = STORAGE_KEY + '.'; // + YYYY-MM-DD (one key per day)
  const INDEX_KEY = 'ledger.shardIndex'; // { day: eventCount } shard directory
  const MAX_EVENTS = 5000;
  const RETENTION_DAYS = 90;
  // 'health' (Horizon-1 H2) — shared/contract-canary.js's own runtime DOM-contract
  // probes, NOT a clinical source: patientRef is always null for these events (see
  // contract-canary.js). 'contract-degraded'/'contract-recovered' are its two actions.
  // 'leaflets' — side-panel/modules/leaflets/leaflets.js records a leaflet being
  // opened (slug only, patientRef always null — see shared/leaflets-utils.js
  // leafletOpenLedgerEvent). 'opened' is its one action.
  // 'routinerx' — content-scripts/triage-lens/routine-rx-button.js mirrors its
  // one-click "send to routine prescriptions" macro (H-035). patientRef is
  // always null (the button makes no network calls and reads no patient-data
  // field values — see that file's header); `label` carries the assigned team
  // name instead. Actions: 'committed' (macro clicked the commit control —
  // 'auto' mode or an accepted 'confirm' dialog), 'highlighted' ('manual' mode
  // — pre-filled, clinician must click), 'aborted' (couldn't complete,
  // including the clinician declining the confirm dialog — the FULL reason
  // string lives only in the module's own machine-local ring buffer,
  // triagelens.routinerx.auditLog, not in this ledger's fixed shape).
  // 'bulk-action' — the task-queue bulk-action widgets
  // (content-scripts/task-bulk-action.js, instantiated as Privacy Officer
  // "Bulk acknowledge?" and EPS Cancellation "Bulk discard?"). ONE event per
  // BATCH, patientRef always null (a batch spans multiple patients, so there
  // is no one patient to attribute it to); `ruleId` carries the WIDGET
  // IDENTITY ('bulk-acknowledge-privacy-officer' / 'bulk-discard-eps-
  // cancellation') and `label` a fixed template + the success count. Action:
  // 'committed'. Split out of 'record' at v3.233 so H-063's question — "was
  // any bulk-acknowledge performed on this machine in the exposure window?" —
  // is answerable by filtering, not by eyeballing every record event.
  // Pre-split batches were written with source 'record'; isBulkActionEvent()
  // below still recognises them, so old events remain findable.
  // 'patient-alerts' — the Pt Alerts tab (side-panel/modules/patient-alerts/)
  // records every mutation of the persisted per-patient flag store (H-042
  // audit trail): 'flag-added' / 'flag-edited' / 'flag-removed'. patientRef is
  // the store's patient UUID. `ruleId` carries the alert's own id (pa-…) and
  // `label` the alert's PRESET type id (or 'custom') plus severity — NEVER the
  // free-typed alert text, per the no-free-text rule above. The author initials
  // ride on the stored alert itself (createdBy/updatedBy), not in this ledger.
  const SOURCES = [
    'sentinel',
    'sweep',
    'labfiling',
    'record',
    'preflight',
    'health',
    'leaflets',
    'routinerx',
    'patient-alerts',
    'bulk-action',
  ];
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
    'opened',
    'committed',
    'highlighted',
    'aborted',
    'flag-added',
    'flag-edited',
    'flag-removed',
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
   * True for a bulk-action BATCH event (one per batch, patientRef null).
   *
   * Two shapes are recognised, deliberately:
   *   - current: source 'bulk-action'.
   *   - legacy:  source 'record' + action 'committed' + a 'bulk-…' ruleId —
   *     how every batch event was written before the source split (the
   *     v3.226.0–v3.232.x task-bulk-action widgets, and problem-bulk-end.js,
   *     which still writes that way because its batch IS single-patient
   *     record activity). Events already on disk must stay findable: this is
   *     the audit affordance H-063 asks for, so it must cover the exposure
   *     window's OWN events, which predate the new source.
   */
  function isBulkActionEvent(evt) {
    if (!evt) return false;
    if (evt.source === 'bulk-action') return true;
    return evt.source === 'record' && evt.action === 'committed' && /^bulk-/.test(String(evt.ruleId || ''));
  }

  /**
   * Filter events by patient UUID (exact or prefix, case-insensitive), an
   * inclusive YYYY-MM-DD date range, and/or bulkOnly (batch events only —
   * see isBulkActionEvent). Order is preserved (newest-first in).
   */
  function filterEvents(events, query) {
    const q = query || {};
    const ref = q.patientRef ? String(q.patientRef).trim().toLowerCase() : '';
    const from = q.from ? String(q.from).slice(0, 10) : null;
    const to = q.to ? String(q.to).slice(0, 10) : null;
    const bulkOnly = !!q.bulkOnly;
    return (Array.isArray(events) ? events : []).filter((e) => {
      if (!e) return false;
      if (bulkOnly && !isBulkActionEvent(e)) return false;
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

  // ── Day-shard helpers (audit H12 — pure, unit-tested) ─────────────────────

  /** Calendar day of an ISO timestamp ('' when unusable). */
  function dayOf(ts) {
    const d = String(ts || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  }

  function shardKeyFor(day) {
    return SHARD_PREFIX + day;
  }

  /** Sanitise a stored shard index → { day: positive integer count }. */
  function sanitiseIndex(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const day of Object.keys(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const n = Number(raw[day]);
      if (Number.isFinite(n) && n > 0) out[day] = Math.floor(n);
    }
    return out;
  }

  /** Merge two newest-first arrays into one newest-first array (by ts desc). */
  function mergeNewestFirst(a, b) {
    const all = [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []);
    return all.filter((e) => e && typeof e.ts === 'string').sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  }

  /**
   * Enforce RETENTION_DAYS + global MAX_EVENTS over the shard index WITHOUT
   * reading every shard: whole days beyond retention (or beyond the global
   * budget, counted newest-day-first) are dropped; the one day straddling the
   * budget boundary is trimmed to what fits. Returns
   *   { index, removeDays, trimDays } — the new index, days whose shards
   *   should be deleted, and { day: keepCount } for boundary trims.
   */
  function planShardPrune(index, nowIso) {
    const cutoffDay = dayOf(new Date(new Date(nowIso).getTime() - RETENTION_DAYS * 86400000).toISOString());
    const days = Object.keys(index).sort().reverse(); // newest first
    const keep = {};
    const removeDays = [];
    const trimDays = {};
    let budget = MAX_EVENTS;
    for (const day of days) {
      const count = Number(index[day]) || 0;
      if (day < cutoffDay || budget <= 0) {
        removeDays.push(day);
        continue;
      }
      if (count <= budget) {
        keep[day] = count;
        budget -= count;
      } else {
        trimDays[day] = budget;
        keep[day] = budget;
        budget = 0;
      }
    }
    return { index: keep, removeDays, trimDays };
  }

  // ── Legacy-key migration ──────────────────────────────────────────────────
  // Pre-v3.176.4 installs hold one monolithic ledger.events array. On the
  // first storage-API call of a session it is split into day shards (merged
  // with any shards already present — a crash mid-migration must not lose
  // events) and the legacy key removed. The checked flag is only set on
  // SUCCESS, so a transient storage failure retries on the next call.
  let _migrationChecked = false;

  /** Test hook — force the next storage-API call to re-check the legacy key. */
  function resetMigrationCheck() {
    _migrationChecked = false;
  }

  async function ensureMigrated(nowIso) {
    if (_migrationChecked) return;
    const r = await chrome.storage.local.get([STORAGE_KEY, INDEX_KEY]);
    const legacy = r[STORAGE_KEY];
    if (!Array.isArray(legacy) || legacy.length === 0) {
      if (STORAGE_KEY in r) await chrome.storage.local.remove(STORAGE_KEY);
      _migrationChecked = true;
      return;
    }
    const index = sanitiseIndex(r[INDEX_KEY]);
    const byDay = {};
    for (const e of pruneEvents(legacy, nowIso)) {
      const d = dayOf(e.ts);
      if (!d) continue;
      (byDay[d] || (byDay[d] = [])).push(e);
    }
    const days = Object.keys(byDay);
    const existing = days.length ? await chrome.storage.local.get(days.map(shardKeyFor)) : {};
    const writes = {};
    for (const day of days) {
      const merged = mergeNewestFirst(existing[shardKeyFor(day)], byDay[day]);
      writes[shardKeyFor(day)] = merged;
      index[day] = merged.length;
    }
    writes[INDEX_KEY] = index;
    await chrome.storage.local.set(writes);
    await chrome.storage.local.remove(STORAGE_KEY);
    _migrationChecked = true;
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
      await ensureMigrated(evt.ts);
      const day = dayOf(evt.ts);
      if (!day) return false;
      const sk = shardKeyFor(day);
      const r = await chrome.storage.local.get([sk, INDEX_KEY]);
      const shard = Array.isArray(r[sk]) ? r[sk] : [];
      // Dedupe is same-calendar-day by definition, so the day's own shard is
      // the complete search space — no full-ledger read needed.
      if (dedupe && hasSameDayDuplicate(shard, evt)) {
        _sessionKeys.add(key);
        return false;
      }
      shard.unshift(evt);
      const index = sanitiseIndex(r[INDEX_KEY]);
      index[day] = shard.length;
      const plan = planShardPrune(index, evt.ts);
      const writes = { [INDEX_KEY]: plan.index };
      if (!plan.removeDays.includes(day)) {
        writes[sk] = plan.trimDays[day] != null ? shard.slice(0, plan.trimDays[day]) : shard;
      }
      // A boundary trim on an OLDER day needs that shard's contents — rare
      // (only when the global cap is straddled) and one extra read when it is.
      const otherTrims = Object.keys(plan.trimDays).filter((d) => d !== day);
      if (otherTrims.length) {
        const got = await chrome.storage.local.get(otherTrims.map(shardKeyFor));
        for (const d of otherTrims) {
          const cur = got[shardKeyFor(d)];
          writes[shardKeyFor(d)] = (Array.isArray(cur) ? cur : []).slice(0, plan.trimDays[d]);
        }
      }
      await chrome.storage.local.set(writes);
      if (plan.removeDays.length) {
        await chrome.storage.local.remove(plan.removeDays.map(shardKeyFor));
      }
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
      const nowIso = new Date().toISOString();
      await ensureMigrated(nowIso);
      const ir = await chrome.storage.local.get([INDEX_KEY, STORAGE_KEY]);
      const index = sanitiseIndex(ir[INDEX_KEY]);
      const days = Object.keys(index).sort().reverse(); // newest day first
      // Belt-and-braces: a legacy array still present here means migration
      // failed mid-flight — include it rather than silently hide events.
      const legacy = Array.isArray(ir[STORAGE_KEY]) ? ir[STORAGE_KEY] : [];
      if (!days.length && !legacy.length) return [];
      const shards = days.length ? await chrome.storage.local.get(days.map(shardKeyFor)) : {};
      let all = [];
      for (const d of days) {
        const a = shards[shardKeyFor(d)];
        if (Array.isArray(a)) all = all.concat(a);
      }
      if (legacy.length) all = mergeNewestFirst(all, legacy);
      // Day-level shard drops are coarser than the old time-precise prune, so
      // re-apply the exact caps on read — cheap, and keeps read semantics
      // identical to the monolithic ledger.
      return pruneEvents(all, nowIso);
    } catch (e) {
      warn(e);
      return [];
    }
  }

  /** Wipe the ledger. Resolves true on success, false on failure — never throws. */
  async function clearLedger() {
    try {
      if (!storageAvailable()) return false;
      const r = await chrome.storage.local.get(INDEX_KEY);
      const index = sanitiseIndex(r[INDEX_KEY]);
      const keys = new Set([STORAGE_KEY, INDEX_KEY]);
      for (const day of Object.keys(index)) keys.add(shardKeyFor(day));
      // Also sweep every possible in-retention day key (plus slack) so an
      // orphan shard from a crashed index write cannot outlive a user wipe.
      const nowMs = Date.now();
      for (let i = 0; i <= RETENTION_DAYS + 14; i++) {
        keys.add(shardKeyFor(dayOf(new Date(nowMs - i * 86400000).toISOString())));
      }
      await chrome.storage.local.remove(Array.from(keys));
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
    isBulkActionEvent,
    filterEvents,
    eventsCsv,
    csvCell,
    // day-shard pure helpers (audit H12 — tested directly)
    dayOf,
    shardKeyFor,
    sanitiseIndex,
    mergeNewestFirst,
    planShardPrune,
    resetSessionDedupe, // test hook — clears the session dedupe cache
    resetMigrationCheck, // test hook — re-check the legacy key on next call
    constants: {
      STORAGE_KEY,
      SHARD_PREFIX,
      INDEX_KEY,
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
