// Queue SLA / contract-clock chips (Northstar A1).
//
// Pure: given a Medicus priority flag + created timestamp, name the April-2026
// contract deadline. Never a clinical grade. Never owns the pulse rail.
// Loaded as a classic script (`window.TriageQueueSla`) before content.js,
// and require()-able from Node.
//
// Safety (H-063): the chip ECHOES Medicus's own unvalidated intake flag.
// Urgent copy says "must action today"; routine copy MUST name the source
// ("intake-flagged routine") and must never read as "tomorrow is fine".
(function (global) {
  'use strict';

  const URGENT_RE = /(urgent|high|immediate)/i;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    out.setDate(out.getDate() + n);
    return out;
  }

  function isWeekend(d) {
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  // Next working day after `from` (skips Sat/Sun; no bank-holiday list —
  // fail closed to the next weekday, never invent a holiday calendar).
  function nextWorkingDay(from) {
    let d = addDays(from, 1);
    while (isWeekend(d)) d = addDays(d, 1);
    return d;
  }

  function dayDiff(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function formatDay(d) {
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function formatReceived(created, now) {
    if (!(created instanceof Date) || !Number.isFinite(created.getTime())) return '';
    const hasClock = created.getHours() || created.getMinutes() || created.getSeconds();
    const clock = hasClock ? pad2(created.getHours()) + ':' + pad2(created.getMinutes()) : '';
    const days = dayDiff(created, now);
    if (days === 0) return clock ? 'received ' + clock : 'received today';
    if (days === 1) return clock ? 'received yesterday ' + clock : 'received yesterday';
    return clock ? 'received ' + formatDay(created) + ' ' + clock : 'received ' + formatDay(created);
  }

  function isUrgentPriority(priority) {
    return URGENT_RE.test(String(priority || ''));
  }

  function hasReadablePriority(priority) {
    return typeof priority === 'string';
  }

  // parseCreated(text, now) → Date | null
  // Accepts the Created-column strings decorateOneRow already reads
  // ("23 Aug 2026", "23 Aug 2026 09:12", "23 Aug 2026, 09:12").
  function parseCreated(text, now) {
    if (!text) return null;
    const t = String(text).trim().replace(/\*$/, '');
    const m = t.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    const months = {
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
    const mo = months[m[2]];
    if (mo == null) return null;
    const hh = m[4] != null ? +m[4] : 0;
    const mm = m[5] != null ? +m[5] : 0;
    const d = new Date(+m[3], mo, +m[1], hh, mm, 0, 0);
    if (!Number.isFinite(d.getTime())) return null;
    // Future timestamps (clock skew) are unusable — fail closed.
    if (now instanceof Date && d.getTime() > now.getTime() + 60 * 1000) return null;
    return d;
  }

  // composeSlaChip({ priority, created, now, isRequestQueue })
  // → null | { kind, label, title, family, source, state, due }
  //
  // family is always 'sla' so composePulse treats it as context-only.
  // Results queues return null — the contract clock is a request-queue duty.
  function composeSlaChip(opts) {
    opts = opts || {};
    if (opts.isRequestQueue === false) return null;
    const now = opts.now instanceof Date ? opts.now : new Date();
    const priority = opts.priority;
    const created = opts.created instanceof Date ? opts.created : null;

    if (!hasReadablePriority(priority)) {
      return {
        kind: 'meta',
        label: 'priority unknown',
        title: 'Medicus priority field unreadable — not a clinical grade. Check the request.',
        family: 'sla',
        source: 'Medicus flag',
        state: 'unknown',
        due: null,
      };
    }

    const urgent = isUrgentPriority(priority);
    const received = created ? formatReceived(created, now) : '';

    if (urgent) {
      const sameDay = created ? dayDiff(created, now) === 0 : true;
      const overdue = created ? dayDiff(created, now) > 0 : false;
      const label = overdue ? 'overdue · today' : 'must action today';
      const title =
        (overdue ? 'Must have been actioned the day it arrived. ' : 'Must action today. ') +
        (received ? received + '. ' : '') +
        'Medicus flagged this urgent — an unvalidated intake flag, not a clinical grade.';
      return {
        kind: overdue ? 'red' : 'amber',
        label: received ? label + ' · ' + received.replace(/^received /, '') : label,
        title: title,
        family: 'sla',
        source: 'Medicus flag',
        state: overdue ? 'overdue' : 'today',
        due: startOfDay(now),
        sameDay: sameDay,
      };
    }

    // Routine / anything not urgent. Due end of next working day from created
    // (or from now if created is missing — conservative same-session guess).
    const origin = created || now;
    const due = nextWorkingDay(origin);
    const daysUntil = dayDiff(now, due);
    const overdue = daysUntil < 0;
    const label = overdue ? 'overdue · EOD' : daysUntil === 0 ? 'due EOD today' : 'due EOD tomorrow';
    const title =
      'intake-flagged routine · ' +
      (overdue ? 'deadline has passed' : daysUntil === 0 ? 'due by end of today' : 'due by end of next working day') +
      (received ? ' · ' + received : '') +
      '. Echo of an unvalidated upstream flag — not “tomorrow is fine”.';
    return {
      kind: overdue ? 'amber' : 'info',
      label: label,
      title: title,
      family: 'sla',
      source: 'Medicus flag',
      state: overdue ? 'overdue' : daysUntil === 0 ? 'today' : 'tomorrow',
      due: due,
    };
  }

  const api = {
    URGENT_RE: URGENT_RE,
    isUrgentPriority: isUrgentPriority,
    hasReadablePriority: hasReadablePriority,
    parseCreated: parseCreated,
    nextWorkingDay: nextWorkingDay,
    formatReceived: formatReceived,
    composeSlaChip: composeSlaChip,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TriageQueueSla = api;
})(typeof window !== 'undefined' ? window : globalThis);
