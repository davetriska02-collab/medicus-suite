// Queue pulse composer — named-signal compression for the request/results queue.
//
// Pure: given a list of already-computed chips, pick one rail + one headline.
// Never a score. Never invents a signal. Loaded as a classic script
// (`window.TriageQueuePulse`) before content.js, and require()-able from Node.
//
// See docs/design/triage-queue-next/PLAN.md.
(function (global) {
  'use strict';

  const KIND_RANK = { red: 3, amber: 2, info: 1, green: 0, meta: 0 };

  // Age, SLA/priority, thread counts, carry-over and Pharmacy First never own
  // the rail or the headline. They still appear in the why-tray / overflow.
  const CONTEXT_FAMILIES = {
    age: true,
    priority: true,
    taskAge: true,
    sla: true,
    repeat: true,
    carry: true,
    pf: true,
  };

  // Why-tray source names — named, not a family id. Keep in lock-step with
  // the families collectSignalsFromRow emits.
  const SOURCE_LABELS = {
    rule: 'request text',
    request: 'request text',
    monitoring: 'record · monitoring',
    pending: 'record · pending result',
    result: 'record · result',
    flag: 'practice alert',
    'patient-alerts': 'practice alert',
    age: 'date of birth',
    dob: 'date of birth',
    priority: 'Medicus flag',
    taskAge: 'created date',
    sla: 'contract clock · Medicus flag',
    repeat: 'contact ledger',
    carry: 'first seen on this machine',
    pf: 'pathway',
    askback: 'pathway gaps',
    system: 'queue decoration',
  };

  function sourceLabel(signal) {
    if (!signal) return '';
    if (signal.source && SOURCE_LABELS[signal.source]) return SOURCE_LABELS[signal.source];
    if (signal.family && SOURCE_LABELS[signal.family]) return SOURCE_LABELS[signal.family];
    return signal.source || signal.family || '';
  }

  function isContextOnly(signal) {
    if (!signal || !signal.kind) return true;
    if (signal.kind === 'green' || signal.kind === 'meta') return true;
    if (CONTEXT_FAMILIES[signal.family]) return true;
    return false;
  }

  function composePulse(signals, opts) {
    opts = opts || {};
    const list = Array.isArray(signals) ? signals.filter((s) => s && s.name) : [];
    const clinical = list.filter((s) => !isContextOnly(s));

    let headline = null;
    for (let i = 0; i < clinical.length; i++) {
      const s = clinical[i];
      const rank = KIND_RANK[s.kind] || 0;
      const headRank = headline ? KIND_RANK[headline.kind] || 0 : -1;
      if (!headline || rank > headRank) headline = s;
    }
    if (headline) {
      const same = clinical.filter((s) => s.kind === headline.kind);
      const fromRequest = same.find((s) => s.family === 'rule' || s.source === 'request');
      if (fromRequest) headline = fromRequest;
    }

    // Known named red/amber always win the rail (a duty GP must see MH crisis
    // while the record pass is still in flight). Dashed "not checked" is the
    // fail-visible state for a QUIET row whose record pass has not returned —
    // it must never look like empty/"checked, nothing matched".
    let rail = 'empty';
    if (headline && headline.kind === 'red') rail = 'red';
    else if (headline && headline.kind === 'amber') rail = 'amber';
    else if (opts.recordChecked === false) rail = 'unchecked';

    const overflow = list.filter((s) => s !== headline);
    const thread = list.find((s) => s.family === 'repeat') || null;
    const silent = !!(
      headline &&
      (headline.silent ||
        headline.family === 'monitoring' ||
        headline.family === 'pending' ||
        headline.family === 'context')
    );

    return {
      rail: rail,
      headline: headline,
      overflow: overflow,
      overflowCount: overflow.length,
      silent: silent,
      thread: thread,
      signals: list,
    };
  }

  const api = {
    composePulse: composePulse,
    isContextOnly: isContextOnly,
    sourceLabel: sourceLabel,
    KIND_RANK: KIND_RANK,
    SOURCE_LABELS: SOURCE_LABELS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TriageQueuePulse = api;
})(typeof window !== 'undefined' ? window : globalThis);
