// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Rx list "anything overdue" (Monitoring / QOF) selectors.
//
// Pure: no DOM, no fetch. Given SentinelRules.evaluatePatient chips, pick the
// action-needed Monitoring and QOF findings a prescription-queue row should
// show. Absence of a finding is never an all-clear — the caller only renders
// a button when this returns a non-null group.
//
// Dual-mode: module.exports for Node, window.RxOverdueCore in the page.

'use strict';

(function (global) {
  var MONITORING_OVERDUE = { overdue: true, stale: true, no_data: true };
  var QOF_OVERDUE = { not_met: true, overdue: true };
  var QOF_TYPES = { 'qof-indicator': true, 'qof-process-indicator': true };

  function chipName(chip) {
    if (!chip) return '';
    return String(
      chip.displayName || chip.drugName || chip.indicatorName || chip.label || chip.indicatorCode || ''
    ).trim();
  }

  function chipDetail(chip) {
    if (!chip) return '';
    if (chip.status === 'no_data') {
      var missing = (chip.tests || [])
        .filter(function (t) {
          return t && t.status === 'no_data' && t.name;
        })
        .map(function (t) {
          return t.name;
        });
      if (missing.length) return 'no recent ' + missing.join(', ');
      return 'no monitoring on record';
    }
    return String(chip.detail || (chip.evidence && chip.evidence.summary) || chip.status || '').trim();
  }

  function itemFromChip(chip) {
    var name = chipName(chip) || 'Item';
    return {
      name: name,
      status: chip.status || '',
      detail: chipDetail(chip),
    };
  }

  function selectMonitoringOverdue(chips) {
    if (!Array.isArray(chips)) return null;
    var due = chips.filter(function (c) {
      return c && c.type === 'drug-monitoring' && MONITORING_OVERDUE[c.status];
    });
    if (!due.length) return null;
    return { count: due.length, level: 'red', items: due.map(itemFromChip) };
  }

  function selectQofOverdue(chips) {
    if (!Array.isArray(chips)) return null;
    var due = chips.filter(function (c) {
      return c && QOF_TYPES[c.type] && QOF_OVERDUE[c.status];
    });
    if (!due.length) return null;
    return { count: due.length, level: 'red', items: due.map(itemFromChip) };
  }

  function selectOverdue(chips) {
    return {
      monitoring: selectMonitoringOverdue(chips),
      qof: selectQofOverdue(chips),
    };
  }

  function hasOverdue(result) {
    return !!(result && (result.monitoring || result.qof));
  }

  function buttonLabel(kind, count) {
    var n = Number(count) || 0;
    if (kind === 'qof') return n > 1 ? 'QOF ×' + n : 'QOF';
    return n > 1 ? 'Monitoring ×' + n : 'Monitoring';
  }

  function itemsTitle(group) {
    if (!group || !Array.isArray(group.items) || !group.items.length) return '';
    return group.items
      .map(function (it) {
        var line = it.name || '';
        if (it.detail && it.detail !== it.name) line += ' — ' + it.detail;
        return line;
      })
      .join('\n');
  }

  function scanIdleLabel() {
    return 'Check for overdue monitoring';
  }

  function scanProgressLabel(done, total) {
    var d = Number(done) || 0;
    var t = Number(total) || 0;
    if (t < 1) return 'Checking…';
    return 'Checking… ' + d + '/' + t;
  }

  // Never "all clear". Zero flags means we did not find a flag, not that
  // nothing is overdue.
  function scanDoneLabel(flagged, scanned) {
    var f = Number(flagged) || 0;
    var s = Number(scanned) || 0;
    if (f > 0) return f + ' with overdue';
    if (s > 0) return 'Scan finished';
    return scanIdleLabel();
  }

  var api = {
    selectMonitoringOverdue: selectMonitoringOverdue,
    selectQofOverdue: selectQofOverdue,
    selectOverdue: selectOverdue,
    hasOverdue: hasOverdue,
    buttonLabel: buttonLabel,
    itemsTitle: itemsTitle,
    scanIdleLabel: scanIdleLabel,
    scanProgressLabel: scanProgressLabel,
    scanDoneLabel: scanDoneLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.RxOverdueCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
