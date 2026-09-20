// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — OIR write-core (W22 Outstanding-Investigation tick-off).
//
// Decision helpers only: which verdicts may auto-tick, which are pending
// for the clinician-confirmed bulk bar, and the confirm copy. The DOM
// stagger (`tickRows`) stays in content-scripts/triage-lens/content.js —
// it needs the live checkbox nodes. This file exists so the write decision
// is unit-testable without extracting an 8k-line god file.
//
// Dual-mode: module.exports for Node; window.OirWriteCore in the page.

'use strict';

(function () {
  function autoTickPrefEnabled(prefValue) {
    return prefValue === true;
  }

  function pickAutoTickVerdicts(verdicts, rows) {
    return (verdicts || []).filter(function (v) {
      return !!(v && v.autoTick && rows && rows[v.id]);
    });
  }

  function pickAutoTickBoxes(verdicts, rows) {
    return pickAutoTickVerdicts(verdicts, rows).map(function (v) {
      return rows[v.id].box;
    });
  }

  function shouldPerformAutoTick(prefValue, verdicts, rows) {
    if (!autoTickPrefEnabled(prefValue)) {
      return { run: false, verdicts: [], boxes: [] };
    }
    var vs = pickAutoTickVerdicts(verdicts, rows);
    if (!vs.length) return { run: false, verdicts: [], boxes: [] };
    return { run: true, verdicts: vs, boxes: pickAutoTickBoxes(vs, rows) };
  }

  function pendingBulkTickVerdicts(foundVerdicts, rows) {
    return (foundVerdicts || []).filter(function (v) {
      var box = rows && rows[v.id] && rows[v.id].box;
      if (!box) return false;
      return box.type === 'checkbox' ? !box.checked : box.getAttribute('aria-checked') !== 'true';
    });
  }

  function formatBulkTickLine(v, fmtDate) {
    var date = v && v.elsewhereDate ? (fmtDate ? fmtDate(v.elsewhereDate) : String(v.elsewhereDate)) : 'date unknown';
    var val = '';
    if (v && v.matchedValue) {
      var unit = v.matchedUnit ? ' ' + v.matchedUnit : '';
      var ab = v.matchedAbnormal ? ' ' + String(v.matchedAbnormal).toUpperCase() : '';
      val = ' — ' + (v.matchedObsName || v.name) + ' ' + v.matchedValue + unit + ab;
    }
    var shared =
      v && v.sharedCount > 0
        ? ' (also satisfies ' + v.sharedCount + ' other request' + (v.sharedCount > 1 ? 's' : '') + ')'
        : '';
    return ' • ' + ((v && v.name) || 'request') + ' — completed ' + date + val + shared;
  }

  function buildBulkTickConfirmMessage(verdicts, fmtDate) {
    var list = verdicts || [];
    var n = list.length;
    var lines = list.map(function (v) {
      return formatBulkTickLine(v, fmtDate);
    });
    return (
      'Tick off ' +
      n +
      ' request' +
      (n > 1 ? 's' : '') +
      " found in the patient's record?\n\n" +
      'These are NOT covered by this report, but matching results were found ' +
      'elsewhere in the record:\n\n' +
      lines.join('\n') +
      "\n\nSource: the patient's observation history (Medicus lab record).\n\n" +
      'Ticking off writes to Medicus server-side and removes ' +
      (n > 1 ? 'these' : 'this') +
      ' from the outstanding list. This cannot be undone from here. Confirm only if you ' +
      'are satisfied each result has been seen and acted on.\n\n' +
      'OK = tick ' +
      (n > 1 ? 'them all' : 'it') +
      ' off    Cancel = leave outstanding'
    );
  }

  var api = {
    autoTickPrefEnabled: autoTickPrefEnabled,
    pickAutoTickVerdicts: pickAutoTickVerdicts,
    pickAutoTickBoxes: pickAutoTickBoxes,
    shouldPerformAutoTick: shouldPerformAutoTick,
    pendingBulkTickVerdicts: pendingBulkTickVerdicts,
    formatBulkTickLine: formatBulkTickLine,
    buildBulkTickConfirmMessage: buildBulkTickConfirmMessage,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.OirWriteCore = api;
  }
})();
