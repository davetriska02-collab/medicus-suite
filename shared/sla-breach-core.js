// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — SLA breach-risk core (Workstream A2)
//
// Pure, testable computation behind the urgent-request breach-risk strip
// (#slaBreachStrip, panel-only). Given the open new/reply request items already
// fetched and cached by shared/request-monitor.js (its bucket item mapping
// carries `priority` / `priorityDisplay` / `createdAt`), it decides:
//   - how many are flagged URGENT by Medicus's own upstream priority field, and
//   - the age of the oldest such item,
// then maps that to a strip level.
//
// SAFETY POSTURE (see docs HAZARD-LOG A2 entry):
//   - This is WORKFLOW arithmetic only: counts and timestamps, zero clinical
//     interpretation of request content. It echoes Medicus's OWN priority flag
//     (unvalidated upstream) — it never grades urgency itself.
//   - It is additive: it can never suppress, reorder or hide a request. It only
//     surfaces an aggregate warning.
//   - FAIL VISIBLE: if the fetched items carry NO readable priority field at
//     all (schema change / field absent), it returns the 'unknown' level so the
//     strip can show "urgency unknown — check queue" rather than silently
//     reporting zero urgent (which would look like a reassuring "all clear").
//   - No green / "all clear" state: when there are zero urgent items, or the
//     oldest urgent item is still fresh (below the amber threshold), the level
//     is non-visible and the strip is simply hidden — matching the four
//     existing global strips, which are also threshold-gated.

(function(global) {
  'use strict';

  // Case-insensitive substring match on the priority string. Mirrors the
  // urgency test already used in content.js (/high|urgent|immediate/i) so the
  // strip and the queue chips agree on what "urgent" means.
  const URGENT_RE = /(urgent|high|immediate)/i;

  // Default thresholds (hours) — overridable via suite.requestMonitor config.
  const DEFAULT_AMBER_HOURS = 2;
  const DEFAULT_RED_HOURS = 4;

  // A priority field is "readable" when the item exposes it as a string at all
  // (an empty string still counts — that is a routine item, schema present).
  // undefined / null / missing => not readable => fail-visible 'unknown'.
  function hasReadablePriority(it) {
    if (!it || typeof it !== 'object') return false;
    return typeof it.priority === 'string' || typeof it.priorityDisplay === 'string';
  }

  function isUrgentItem(it) {
    if (!it || typeof it !== 'object') return false;
    return URGENT_RE.test(String(it.priority || '')) || URGENT_RE.test(String(it.priorityDisplay || ''));
  }

  // Age of an item in ms relative to `now`. Returns null for a missing or
  // unparseable createdAt, or a timestamp in the future (clock skew).
  function itemAgeMs(it, now) {
    if (!it) return null;
    const t = Date.parse(it.createdAt);
    if (!Number.isFinite(t)) return null;
    const age = now - t;
    return age >= 0 ? age : null;
  }

  // computeBreachRisk(items, opts) → result
  //   items: array of { priority?, priorityDisplay?, createdAt? }
  //   opts:  { now?: ms, amberMs?: ms, redMs?: ms }
  // result: { level, urgentCount, oldestAgeMs, totalItems, priorityKnown, visible }
  //   level ∈ 'none' | 'below' | 'amber' | 'red' | 'unknown'
  //     none    — zero urgent items (or no items)          → hidden
  //     below   — urgent items exist but oldest < amber     → hidden (still fresh)
  //     amber   — oldest urgent age ≥ amber, < red          → visible
  //     red     — oldest urgent age ≥ red                    → visible
  //     unknown — items present but priority unreadable      → visible (fail-visible)
  function computeBreachRisk(items, opts) {
    opts = opts || {};
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const amberMs = Number.isFinite(opts.amberMs) ? opts.amberMs : DEFAULT_AMBER_HOURS * 3600000;
    const redMs = Number.isFinite(opts.redMs) ? opts.redMs : DEFAULT_RED_HOURS * 3600000;

    const list = Array.isArray(items) ? items : [];
    const totalItems = list.length;

    if (totalItems === 0) {
      return { level: 'none', urgentCount: 0, oldestAgeMs: null, totalItems: 0, priorityKnown: true, visible: false };
    }

    // FAIL VISIBLE: if NOT a single item exposes a readable priority field, we
    // cannot tell urgent from routine — surface that rather than report zero.
    const priorityKnown = list.some(hasReadablePriority);
    if (!priorityKnown) {
      return { level: 'unknown', urgentCount: 0, oldestAgeMs: null, totalItems, priorityKnown: false, visible: true };
    }

    let urgentCount = 0;
    let oldestAgeMs = null;
    for (const it of list) {
      if (!isUrgentItem(it)) continue;
      urgentCount++;
      const age = itemAgeMs(it, now);
      if (age !== null && (oldestAgeMs === null || age > oldestAgeMs)) oldestAgeMs = age;
    }

    if (urgentCount === 0) {
      return { level: 'none', urgentCount: 0, oldestAgeMs: null, totalItems, priorityKnown: true, visible: false };
    }

    // Urgent items exist but none carried a usable timestamp — be conservative
    // and surface (amber), never hide an urgent item just because we can't age it.
    if (oldestAgeMs === null) {
      return { level: 'amber', urgentCount, oldestAgeMs: null, totalItems, priorityKnown: true, visible: true };
    }

    let level;
    if (oldestAgeMs >= redMs) level = 'red';
    else if (oldestAgeMs >= amberMs) level = 'amber';
    else level = 'below';

    return {
      level,
      urgentCount,
      oldestAgeMs,
      totalItems,
      priorityKnown: true,
      visible: level === 'amber' || level === 'red',
    };
  }

  // formatAge(ms) → compact human age, e.g. 15132000 → "4h12m", 2700000 → "45m".
  // Hours are not rolled into days (SLA reasoning stays in same-day hours).
  function formatAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
    return `${m}m`;
  }

  const api = {
    URGENT_RE,
    DEFAULT_AMBER_HOURS,
    DEFAULT_RED_HOURS,
    hasReadablePriority,
    isUrgentItem,
    itemAgeMs,
    computeBreachRisk,
    formatAge,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SlaBreachCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
