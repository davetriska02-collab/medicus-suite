// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — GP2GP outbound list search (pure).
//
// PROVISIONAL. The live Medicus GP2GP transfers outbound page has not been
// captured yet. Every selector below is a guess (AG-Grid / ARIA grid / table,
// the same families as the queue). tools/discovery/gp2gp-outbound-discovery.js
// is what confirms them. Keep selectors in SELECTORS only — the content
// script does not hard-code a second set.
//
// The search hides non-matching rows in the DOM. It does not write to
// Medicus. A hidden row is still on the transfer list. See H-092.

(function (global) {
  'use strict';
  if (global.Gp2gpOutboundSearchCore) return;

  var HIDDEN_CLASS = 'ms-gp2gp-row-hidden';
  var HOST_ID = 'ms-gp2gp-search';

  // First entry of each list is the test/confirmed hook. Later entries are
  // provisional live guesses. findList/findRows use the first selector that
  // actually matches rows, so putting the confirmed selector first is the
  // whole correction once discovery comes back.
  var SELECTORS = {
    provisional: true,
    routeNeedles: ['gp2gp', 'outbound'],
    list: ['[data-ms-gp2gp-list]', '.ag-center-cols-container', '[role="grid"]', '[role="table"]', 'table'],
    row: ['[data-ms-gp2gp-row]', '.ag-row', '[role="row"]', 'tbody > tr'],
    skipRow: ['[data-ms-gp2gp-header]', 'thead [role="row"]', 'thead tr'],
    nameCell: [
      '[data-ms-gp2gp-name]',
      '[col-id="patientName"]',
      '[col-id="name"]',
      '[data-field="patientName"]',
      '[data-field="name"]',
      '[data-col="patientName"]',
    ],
    nhsCell: [
      '[data-ms-gp2gp-nhs]',
      '[col-id="nhsNumber"]',
      '[col-id="nhs"]',
      '[data-field="nhsNumber"]',
      '[data-field="nhs"]',
      '[data-col="nhsNumber"]',
    ],
    toolbar: ['[data-ms-gp2gp-toolbar]', '[role="toolbar"]', '.MuiToolbar-root', 'header'],
    pagination: [
      '[data-ms-gp2gp-pager]',
      '.MuiTablePagination-root',
      '.ag-paging-panel',
      '[aria-label="pagination"]',
      'nav[aria-label*="pagination" i]',
    ],
    virtualMarker: [
      '[data-ms-gp2gp-virtual]',
      '.ag-body-viewport',
      '[data-virtuoso-scroller]',
      '.ReactVirtualized__Grid',
    ],
  };

  var COPY = {
    label: 'Search outbound transfers',
    placeholder: 'Name or NHS number',
    clear: 'Clear',
    standing: 'Only rows loaded on this page are filtered. Not shown here is not the same as not on the transfer list.',
    limited:
      'This list looks paginated or virtualised, so a patient on another page or not yet loaded can be missing from this search.',
    missing: 'Outbound list not found. Selectors are provisional and have not been confirmed on the live page.',
    provisional: 'Provisional search. Selectors are not confirmed yet.',
  };

  function isOutboundRoute(pathname, hash) {
    var blob = (String(pathname || '') + ' ' + String(hash || '')).toLowerCase();
    return blob.indexOf('gp2gp') !== -1 && blob.indexOf('outbound') !== -1;
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function letterPart(query) {
    return String(query || '')
      .replace(/[0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Letters and digits together must both match (name AND NHS).
  // Digits alone match the NHS number with spaces ignored.
  // Letters alone match the patient name, case-insensitive.
  // An empty query matches every row.
  function rowMatches(name, nhs, query) {
    var q = String(query || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!q) return true;
    var letters = letterPart(q);
    var digs = digits(q);
    var nameOk =
      !letters ||
      String(name || '')
        .toLowerCase()
        .indexOf(letters) !== -1;
    var nhsOk = !digs || digits(nhs).indexOf(digs) !== -1;
    if (letters && digs) return nameOk && nhsOk;
    if (digs) return nhsOk;
    return nameOk;
  }

  function countLabel(shown, total) {
    return String(shown) + ' of ' + String(total) + ' shown';
  }

  function noteFor(flags) {
    var text = COPY.provisional + ' ' + COPY.standing;
    if (flags && flags.limited) text += ' ' + COPY.limited;
    return text;
  }

  function queryAll(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function queryFirst(root, selectors) {
    if (!root || !selectors) return null;
    for (var i = 0; i < selectors.length; i++) {
      var hits = queryAll(root, selectors[i]);
      if (hits.length) return hits[0];
    }
    return null;
  }

  function textOf(el) {
    if (!el) return '';
    return String(el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSkippableRow(row, selectors) {
    if (!row) return true;
    var role = '';
    try {
      role = row.getAttribute ? row.getAttribute('role') || '' : '';
    } catch (err) {
      role = '';
    }
    if (role === 'columnheader') return true;
    for (var i = 0; i < selectors.skipRow.length; i++) {
      try {
        if (row.matches && row.matches(selectors.skipRow[i])) return true;
      } catch (err) {
        /* selector not supported here */
      }
    }
    if (typeof row.querySelector === 'function') {
      try {
        if (row.querySelector('[role="columnheader"], th')) return true;
      } catch (err) {
        /* ignore */
      }
    }
    return false;
  }

  function findRows(list, selectors) {
    if (!list) return { rows: [], selector: '' };
    for (var i = 0; i < selectors.row.length; i++) {
      var nodes = queryAll(list, selectors.row[i]);
      var rows = [];
      for (var j = 0; j < nodes.length; j++) {
        if (!isSkippableRow(nodes[j], selectors)) rows.push(nodes[j]);
      }
      if (rows.length) return { rows: rows, selector: selectors.row[i] };
    }
    return { rows: [], selector: '' };
  }

  function findList(doc, selectors) {
    var firstSel = selectors.list[0];
    var hooked = queryAll(doc, firstSel)[0];
    if (hooked && findRows(hooked, selectors).rows.length) {
      return { list: hooked, selector: firstSel };
    }
    var best = null;
    var bestCount = 0;
    var bestSel = '';
    for (var i = 0; i < selectors.list.length; i++) {
      var nodes = queryAll(doc, selectors.list[i]);
      for (var n = 0; n < nodes.length && n < 12; n++) {
        var found = findRows(nodes[n], selectors);
        if (found.rows.length > bestCount) {
          best = nodes[n];
          bestCount = found.rows.length;
          bestSel = selectors.list[i];
        }
      }
    }
    return { list: best, selector: bestSel };
  }

  function readIdentity(row, selectors) {
    var nameEl = null;
    var nhsEl = null;
    for (var i = 0; i < selectors.nameCell.length; i++) {
      var nameHits = queryAll(row, selectors.nameCell[i]);
      if (nameHits.length) {
        nameEl = nameHits[0];
        break;
      }
    }
    for (var k = 0; k < selectors.nhsCell.length; k++) {
      var nhsHits = queryAll(row, selectors.nhsCell[k]);
      if (nhsHits.length) {
        nhsEl = nhsHits[0];
        break;
      }
    }
    var all = textOf(row);
    var name = nameEl ? textOf(nameEl) : all;
    var nhs = nhsEl ? textOf(nhsEl) : '';
    if (!nhs) {
      var grouped = all.match(/\d{3}\s?\d{3}\s?\d{4}/);
      if (grouped) nhs = grouped[0];
      else if (digits(all).length >= 10) nhs = digits(all);
    }
    return { name: name, nhs: nhs };
  }

  function ariaRowCount(list) {
    if (!list || !list.getAttribute) return 0;
    var raw = parseInt(list.getAttribute('aria-rowcount') || '', 10);
    return raw > 0 ? raw : 0;
  }

  function listLimits(doc, list, rowCount, selectors) {
    var reasons = [];
    if (queryFirst(doc, selectors.pagination)) reasons.push('paginated');
    if (queryFirst(list || doc, selectors.virtualMarker) || queryFirst(doc, selectors.virtualMarker)) {
      reasons.push('virtualised');
    }
    var total = ariaRowCount(list);
    if (total && rowCount && total > rowCount) reasons.push('virtualised');
    var seen = {};
    var uniq = [];
    reasons.forEach(function (reason) {
      if (!seen[reason]) {
        seen[reason] = true;
        uniq.push(reason);
      }
    });
    return { limited: uniq.length > 0, reasons: uniq };
  }

  function setRowHidden(row, hidden) {
    if (!row || !row.classList) return;
    if (hidden) row.classList.add(HIDDEN_CLASS);
    else row.classList.remove(HIDDEN_CLASS);
  }

  function clearHidden(doc) {
    queryAll(doc, '.' + HIDDEN_CLASS).forEach(function (row) {
      row.classList.remove(HIDDEN_CLASS);
    });
  }

  function applyFilter(doc, query, selectors) {
    selectors = selectors || SELECTORS;
    var found = findList(doc, selectors);
    if (!found.list) {
      return {
        found: false,
        shown: 0,
        total: 0,
        limited: false,
        reasons: [],
        count: countLabel(0, 0),
        note: COPY.missing + ' ' + COPY.provisional,
        listSelector: '',
        rowSelector: '',
      };
    }
    var rows = findRows(found.list, selectors);
    var limits = listLimits(doc, found.list, rows.rows.length, selectors);
    var shown = 0;
    rows.rows.forEach(function (row) {
      var id = readIdentity(row, selectors);
      var keep = rowMatches(id.name, id.nhs, query);
      setRowHidden(row, !keep);
      if (keep) shown += 1;
    });
    return {
      found: true,
      shown: shown,
      total: rows.rows.length,
      limited: limits.limited,
      reasons: limits.reasons,
      count: countLabel(shown, rows.rows.length),
      note: noteFor(limits),
      listSelector: found.selector,
      rowSelector: rows.selector,
    };
  }

  function el(doc, tag, attrs) {
    var node = doc.createElement(tag);
    var spec = attrs || {};
    Object.keys(spec).forEach(function (key) {
      if (key === 'className') node.className = spec[key];
      else if (key === 'text') node.textContent = spec[key];
      else node.setAttribute(key, spec[key]);
    });
    for (var i = 3; i < arguments.length; i++) {
      if (arguments[i]) node.appendChild(arguments[i]);
    }
    return node;
  }

  function placeHost(doc, host, selectors) {
    var found = findList(doc, selectors);
    var toolbar = queryFirst(doc, selectors.toolbar);
    var toolbarOwnsList =
      toolbar && found.list && typeof toolbar.contains === 'function' && toolbar.contains(found.list);
    if (toolbar && !toolbarOwnsList) {
      if (host.parentNode !== toolbar) toolbar.insertBefore(host, toolbar.firstChild || null);
      return;
    }
    if (found.list && found.list.parentNode) {
      if (host.nextSibling !== found.list) found.list.parentNode.insertBefore(host, found.list);
      return;
    }
    if (doc.body && host.parentNode !== doc.body) doc.body.insertBefore(host, doc.body.firstChild || null);
  }

  function createSession(doc, opts) {
    var selectors = (opts && opts.selectors) || SELECTORS;
    var query = '';
    var host = null;
    var input = null;
    var countEl = null;
    var noteEl = null;

    function paint(result) {
      if (countEl) countEl.textContent = result.found ? result.count : '0 of 0 shown';
      if (noteEl) noteEl.textContent = result.note;
    }

    function apply() {
      var result = applyFilter(doc, query, selectors);
      paint(result);
      return result;
    }

    function ensureHost() {
      if (host && host.isConnected !== false && host.ownerDocument === doc) return host;
      var existing = typeof doc.getElementById === 'function' ? doc.getElementById(HOST_ID) : null;
      if (existing) {
        host = existing;
        input = existing.querySelector('input');
        countEl = existing.querySelector('[data-ms-gp2gp-count]');
        noteEl = existing.querySelector('[data-ms-gp2gp-note]');
        return host;
      }
      input = el(doc, 'input', {
        type: 'search',
        id: 'ms-gp2gp-search-input',
        placeholder: COPY.placeholder,
        'aria-label': COPY.label,
      });
      var clearBtn = el(doc, 'button', { type: 'button', id: 'ms-gp2gp-search-clear', text: COPY.clear });
      countEl = el(doc, 'span', {
        'data-ms-gp2gp-count': '1',
        className: 'ms-gp2gp-search-count',
        text: '0 of 0 shown',
      });
      noteEl = el(doc, 'p', { 'data-ms-gp2gp-note': '1', className: 'ms-gp2gp-search-note', text: noteFor(null) });
      var row = el(doc, 'div', { className: 'ms-gp2gp-search-row' }, input, clearBtn, countEl);
      host = el(doc, 'div', { id: HOST_ID, className: 'ms-gp2gp-search', 'data-provisional': 'true' }, row, noteEl);
      input.addEventListener('input', function () {
        query = input.value || '';
        apply();
      });
      clearBtn.addEventListener('click', function () {
        query = '';
        input.value = '';
        apply();
        if (typeof input.focus === 'function') input.focus();
      });
      return host;
    }

    function mount() {
      ensureHost();
      placeHost(doc, host, selectors);
      if (input && input.value !== query) input.value = query;
      return apply();
    }

    function unmount() {
      clearHidden(doc);
      query = '';
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      input = null;
      countEl = null;
      noteEl = null;
    }

    function setQuery(value) {
      query = String(value || '');
      if (input) input.value = query;
      return apply();
    }

    return {
      mount: mount,
      unmount: unmount,
      apply: apply,
      setQuery: setQuery,
      host: function () {
        return host;
      },
    };
  }

  var api = {
    SELECTORS: SELECTORS,
    COPY: COPY,
    HIDDEN_CLASS: HIDDEN_CLASS,
    HOST_ID: HOST_ID,
    isOutboundRoute: isOutboundRoute,
    digits: digits,
    rowMatches: rowMatches,
    countLabel: countLabel,
    noteFor: noteFor,
    readIdentity: readIdentity,
    findList: findList,
    findRows: findRows,
    listLimits: listLimits,
    applyFilter: applyFilter,
    clearHidden: clearHidden,
    createSession: createSession,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Gp2gpOutboundSearchCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
