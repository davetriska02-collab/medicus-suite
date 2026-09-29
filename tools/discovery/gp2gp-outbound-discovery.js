/* © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
 * Medicus Suite — GP2GP outbound page discovery (paste into DevTools).
 *
 * Open the Medicus GP2GP transfers OUTBOUND page, DevTools → Console, paste
 * this whole file, Enter. It prints one JSON blob and copies it (copy()).
 * Every text node is replaced with a shape token. Query strings are dropped.
 * Path ids and UUIDs become :id / :uuid. Do not paste the page HTML itself.
 *
 * If the console rejects a multi-line paste, open Sources → Snippets, paste
 * there, and run the snippet. The script is one IIFE.
 *
 * Hold mode (tests only): set globalThis.__MS_GP2GP_DISCOVERY_HOLD = true
 * before evaluating. The script then exports __msGp2gpDiscovery and does
 * not walk the page.
 */
(function (root) {
  'use strict';

  function shapeToken(tok) {
    if (!tok) return '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tok)) return 'uuid';
    if (/^\d{3}$/.test(tok) || /^\d{4}$/.test(tok) || /^\d{2}$/.test(tok)) return tok.replace(/\d/g, '#');
    if (/^\d+$/.test(tok)) return '#'.repeat(Math.min(tok.length, 12));
    if (/[A-Za-z]/.test(tok) && /\d/.test(tok)) return 'Aa#';
    if (/^[A-Z]{2,}$/.test(tok)) return 'AA';
    if (/^[a-z]+$/.test(tok)) return 'aa';
    if (/[A-Za-z]/.test(tok)) return 'Aa';
    return 'sym';
  }

  function shapeText(raw) {
    var s = String(raw == null ? '' : raw)
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';
    if (s.length > 180) s = s.slice(0, 180);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return 'uuid';
    if (/^\d{3}\s\d{3}\s\d{4}$/.test(s) || /^\d{3}-\d{3}-\d{4}$/.test(s)) return '### ### ####';
    if (/^\d{10}$/.test(s)) return '##########';
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) return 'dd/mm/yyyy';
    if (/^\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}$/.test(s)) return 'dd-Mmm-yyyy';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'yyyy-mm-dd';
    if (/@/.test(s) && /\./.test(s)) return 'a@a.a';
    return s.split(' ').map(shapeToken).join(' ');
  }

  function scrubLeak(json) {
    return String(json)
      .replace(/\b\d{3}[ -]\d{3}[ -]\d{4}\b/g, '### ### ####')
      .replace(/\b\d{10}\b/g, '##########')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':uuid')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'a@a.a');
  }

  function redactPath(pathname) {
    return String(pathname || '')
      .split('?')[0]
      .split('#')[0]
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
      .split('/')
      .map(function (seg) {
        if (!seg) return seg;
        if (/^\d{2,}$/.test(seg)) return ':id';
        if (/^[0-9a-f]{12,}$/i.test(seg)) return ':id';
        if (seg.length > 24 && /[0-9]/.test(seg)) return ':id';
        return seg;
      })
      .join('/');
  }

  function pathOnly(url) {
    try {
      var u = new URL(String(url), 'https://discovery.invalid');
      return redactPath(u.pathname);
    } catch (err) {
      return redactPath(String(url || '').replace(/^[a-z]+:\/\/[^/]+/i, ''));
    }
  }

  function routeReport(loc) {
    var path = redactPath(loc && loc.pathname);
    var hashRaw = loc && loc.hash ? String(loc.hash) : '';
    var hashPath = redactPath(hashRaw.replace(/^#/, ''));
    var blob = (path + ' ' + hashPath).toLowerCase();
    var patterns = [];
    ['gp2gp', 'outbound', 'inbound', 'transfer'].forEach(function (needle) {
      if (blob.indexOf(needle) !== -1) patterns.push('contains ' + needle);
    });
    return {
      pathname: path,
      hash: hashPath ? '#' + hashPath : '',
      patterns: patterns,
    };
  }

  function classNames(el) {
    var raw = '';
    if (el && typeof el.className === 'string') raw = el.className;
    else if (el && el.className && typeof el.className.baseVal === 'string') raw = el.className.baseVal;
    return raw.split(/\s+/).filter(Boolean).slice(0, 6);
  }

  function safeToken(name) {
    var s = String(name || '');
    if (!s) return '';
    if (/\d{4,}/.test(s) || s.length > 48) return shapeText(s);
    return s;
  }

  function safeClass(name) {
    return safeToken(name);
  }

  function dataAttrNames(el) {
    var names = [];
    var attrs = el && el.attributes;
    if (!attrs) return names;
    for (var i = 0; i < attrs.length && names.length < 12; i++) {
      var name = attrs[i] && attrs[i].name;
      if (name && name.indexOf('data-') === 0) names.push(name);
    }
    return names;
  }

  function attr(el, name) {
    try {
      return el && el.getAttribute ? el.getAttribute(name) || '' : '';
    } catch (err) {
      return '';
    }
  }

  function ariaShape(el) {
    var out = {};
    ['aria-label', 'aria-labelledby', 'aria-rowcount', 'aria-rowindex', 'aria-colindex'].forEach(function (name) {
      var value = attr(el, name);
      if (!value) return;
      if (name === 'aria-rowcount' || name === 'aria-rowindex' || name === 'aria-colindex') {
        var n = parseInt(value, 10);
        out[name] = n > 0 ? n : shapeText(value);
      } else {
        out[name] = shapeText(value);
      }
    });
    return out;
  }

  function outline(el, depth) {
    if (!el || el.nodeType !== 1) return null;
    if (depth > 3) return { tag: String(el.tagName || '').toLowerCase(), truncated: true };
    var node = {
      tag: String(el.tagName || '').toLowerCase(),
      class: classNames(el).map(safeClass),
      data: dataAttrNames(el),
      role: attr(el, 'role'),
    };
    var aria = ariaShape(el);
    if (Object.keys(aria).length) node.aria = aria;
    var texts = [];
    var children = [];
    var nodes = el.childNodes || [];
    for (var i = 0; i < nodes.length; i++) {
      var child = nodes[i];
      if (!child) continue;
      if (child.nodeType === 3) {
        var shaped = shapeText(child.textContent);
        if (shaped) texts.push(shaped);
      } else if (child.nodeType === 1 && children.length < 8) {
        children.push(outline(child, depth + 1));
      }
    }
    if (texts.length) node.text = texts.join(' ');
    if (children.length) node.children = children;
    return node;
  }

  function headerRole(text) {
    var s = String(text || '');
    if (/nhs/i.test(s)) return 'nhs';
    if (/dob|birth|born/i.test(s)) return 'dob';
    if (/name|patient/i.test(s)) return 'name';
    if (/date/i.test(s)) return 'date';
    if (/status|state/i.test(s)) return 'status';
    return 'other';
  }

  function headerOut(text, bodyBlob) {
    var s = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    var role = headerRole(s);
    var hinted =
      /patient|name|nhs|dob|birth|date|status|practice|gp|address|postcode|gender|sex|age|transfer|outbound|inbound|registered|organisation|org|code|type|action/i.test(
        s
      );
    var safe = hinted && s.length <= 40 && !/\d{6,}/.test(s) && s.split(' ').length <= 6;
    if (safe && bodyBlob && s.length > 2 && bodyBlob.toLowerCase().indexOf(s.toLowerCase()) !== -1) safe = false;
    return { role: role, text: safe ? s : shapeText(s) };
  }

  function qsa(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function firstText(el) {
    var nodes = (el && el.childNodes) || [];
    var parts = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].nodeType === 3) parts.push(nodes[i].textContent || '');
    }
    if (!parts.length) return el && el.textContent ? el.textContent : '';
    return parts.join(' ');
  }

  function collectHeaders(doc) {
    var nodes = qsa(doc, '[role="columnheader"], thead th, thead td');
    return nodes.slice(0, 16).map(function (node) {
      return firstText(node);
    });
  }

  function bodyBlob(row) {
    return row && row.textContent ? String(row.textContent) : '';
  }

  function cellShape(text) {
    var shaped = shapeText(text);
    if (shaped === '### ### ####' || shaped === '##########') return 'nhs';
    if (shaped === 'dd/mm/yyyy' || shaped === 'dd-Mmm-yyyy' || shaped === 'yyyy-mm-dd') return 'dob';
    if (/^Aa( Aa)+$/.test(shaped)) return 'name';
    return 'other';
  }

  function likelyCells(headers, row) {
    var cells = qsa(row, '[role="gridcell"], [role="cell"], td, [col-id]');
    if (!cells.length) cells = Array.prototype.slice.call(row.children || []).slice(0, 12);
    var out = [];
    for (var i = 0; i < cells.length && i < 12; i++) {
      var raw = cells[i].textContent || '';
      var fromHeader = headers[i] ? headerRole(headers[i]) : 'other';
      var fromShape = cellShape(raw);
      var role = fromHeader !== 'other' ? fromHeader : fromShape;
      out.push({
        index: i,
        role: role,
        shape: shapeText(raw),
        colId: safeToken(attr(cells[i], 'col-id') || attr(cells[i], 'data-field') || ''),
      });
    }
    return out;
  }

  function rect(el) {
    try {
      if (el && el.getBoundingClientRect) return el.getBoundingClientRect();
    } catch (err) {
      /* ignore */
    }
    return { height: 0, width: 0 };
  }

  function computed(el) {
    try {
      if (typeof root.getComputedStyle === 'function') return root.getComputedStyle(el);
    } catch (err) {
      /* ignore */
    }
    return { overflowY: '', transform: '', display: '' };
  }

  function rowVisible(el) {
    var style = computed(el);
    if (style.display === 'none') return false;
    if (!el || typeof el.getBoundingClientRect !== 'function') return true;
    var box = rect(el);
    return box.height > 0 || box.width > 0;
  }

  function hasTransform(el) {
    var styleAttr = attr(el, 'style');
    if (/translate|matrix/i.test(styleAttr)) return true;
    var style = computed(el);
    return !!(style.transform && style.transform !== 'none');
  }

  function scrollInfo(el) {
    var style = computed(el);
    var overflow = style.overflowY || style.overflow || '';
    var sh = el && el.scrollHeight ? el.scrollHeight : 0;
    var ch = el && el.clientHeight ? el.clientHeight : 0;
    return {
      overflow: overflow || '',
      scrolls: sh > ch + 40,
    };
  }

  var LIST_SELECTORS = [
    'table',
    '[role="grid"]',
    '[role="table"]',
    '.ag-root',
    '.ag-root-wrapper',
    '.ag-center-cols-container',
    '.ag-body-viewport',
    '.MuiDataGrid-root',
    '.MuiTable-root',
    '[data-virtuoso-scroller]',
    '.ReactVirtualized__Grid',
  ];

  function rowNodes(container) {
    var groups = [
      qsa(container, '.ag-row'),
      qsa(container, '[role="row"]'),
      qsa(container, 'tbody > tr'),
      qsa(container, 'tr'),
    ];
    for (var i = 0; i < groups.length; i++) {
      var rows = groups[i].filter(function (row) {
        return attr(row, 'role') !== 'columnheader' && !qsa(row, '[role="columnheader"], th').length;
      });
      if (rows.length) return rows;
    }
    return [];
  }

  function summariseContainer(el, doc) {
    var rows = rowNodes(el);
    var visible = 0;
    var transformed = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rowVisible(rows[i])) visible += 1;
      if (hasTransform(rows[i])) transformed += 1;
    }
    var aria = parseInt(attr(el, 'aria-rowcount') || '0', 10);
    if (!aria) aria = 0;
    var scroll = scrollInfo(el);
    var parentScroll = el && el.parentElement ? scrollInfo(el.parentElement) : { overflow: '', scrolls: false };
    var virtual =
      !!(aria && rows.length && aria > rows.length) || transformed > 0 || scroll.scrolls || parentScroll.scrolls;
    var classHit = classNames(el).join(' ');
    if (/virtual|ag-body-viewport|ReactVirtualized|virtuoso/i.test(classHit)) virtual = true;
    return {
      tag: String(el.tagName || '').toLowerCase(),
      role: attr(el, 'role'),
      class: classNames(el).map(safeClass),
      data: dataAttrNames(el),
      rowSelectorGuess: qsa(el, '.ag-row').length
        ? '.ag-row'
        : qsa(el, '[role="row"]').length
          ? '[role="row"]'
          : qsa(el, 'tbody > tr').length
            ? 'tbody > tr'
            : '',
      rowsInDom: rows.length,
      rowsVisible: visible,
      ariaRowCount: aria || null,
      transformedRows: transformed,
      virtualised: virtual,
      scroll: scroll.scrolls || parentScroll.scrolls,
      overflow: scroll.overflow || parentScroll.overflow || '',
    };
  }

  function paginationReport(doc) {
    var nodes = qsa(
      doc,
      '.MuiTablePagination-root, .ag-paging-panel, [aria-label="pagination"], nav[aria-label*="page" i], [class*="pagination" i]'
    );
    var labels = [];
    qsa(doc, 'button, a, [role="button"]').forEach(function (node) {
      var raw = attr(node, 'aria-label') || firstText(node);
      if (!/next|prev|previous|page|load more|show more/i.test(raw)) return;
      var shaped = shapeText(raw);
      if (labels.length < 6 && labels.indexOf(shaped) === -1) labels.push(shaped);
    });
    var pageSize = null;
    qsa(doc, 'select').forEach(function (sel) {
      var hint = (attr(sel, 'aria-label') + ' ' + attr(sel, 'name')).toLowerCase();
      if (!/page|row/.test(hint)) return;
      var n = parseInt(sel.value, 10);
      /* value here is a page-size control, not a typed search. Still only keep a small integer. */
      if (n > 0 && n <= 500) pageSize = n;
    });
    var infinite = false;
    qsa(doc, 'button, [role="button"]').forEach(function (node) {
      var raw = (attr(node, 'aria-label') || firstText(node) || '').replace(/\s+/g, ' ').trim();
      if (/^(load more|show more|load more rows)$/i.test(raw)) infinite = true;
    });
    return {
      present: nodes.length > 0 || labels.length > 0,
      controlCount: nodes.length,
      pageSize: pageSize,
      buttonShapes: labels,
      infiniteScroll: infinite,
    };
  }

  function frameworkReport(doc) {
    var sample = [doc.documentElement, doc.body].concat(qsa(doc, 'body *').slice(0, 40));
    function keyPrefix(prefix) {
      for (var i = 0; i < sample.length; i++) {
        var el = sample[i];
        if (!el) continue;
        var keys = [];
        try {
          keys = Object.keys(el);
        } catch (err) {
          keys = [];
        }
        for (var k = 0; k < keys.length; k++) {
          if (keys[k].indexOf(prefix) === 0) return true;
        }
      }
      return false;
    }
    return {
      react:
        keyPrefix('__reactFiber') || keyPrefix('__reactInternalInstance') || qsa(doc, '[data-reactroot]').length > 0,
      vue: keyPrefix('__vue') || qsa(doc, '[data-v-app]').length > 0,
      angular: qsa(doc, '[ng-version]').length > 0 || keyPrefix('__ng'),
      agGrid: qsa(doc, '.ag-root, .ag-root-wrapper, .ag-body-viewport').length > 0,
      mui: qsa(doc, '[class*="Mui"]').length > 0,
      reactVirtual: qsa(doc, '.ReactVirtualized__Grid, [data-virtuoso-scroller], [class*="react-window"]').length > 0,
    };
  }

  function searchInputs(doc) {
    var nodes = qsa(doc, 'input, textarea, [role="searchbox"], [role="combobox"]');
    var out = [];
    nodes.forEach(function (node) {
      if (out.length >= 8) return;
      var hint = (
        attr(node, 'type') +
        ' ' +
        attr(node, 'placeholder') +
        ' ' +
        attr(node, 'aria-label') +
        ' ' +
        attr(node, 'name')
      ).toLowerCase();
      if (!/search|filter|find|query/.test(hint) && attr(node, 'type') !== 'search') return;
      out.push({
        tag: String(node.tagName || '').toLowerCase(),
        type: attr(node, 'type'),
        placeholderShape: shapeText(attr(node, 'placeholder')),
        ariaShape: shapeText(attr(node, 'aria-label')),
        /* .value is never read — it may be a patient name the user already typed. */
      });
    });
    return out;
  }

  function mountPoints(doc, listEl) {
    var points = [];
    function push(el, why) {
      if (!el || el.nodeType !== 1 || points.length >= 6) return;
      points.push({
        why: why,
        tag: String(el.tagName || '').toLowerCase(),
        role: attr(el, 'role'),
        class: classNames(el).map(safeClass),
        data: dataAttrNames(el),
      });
    }
    qsa(doc, '[role="toolbar"], header, .MuiToolbar-root, [class*="toolbar" i]')
      .slice(0, 4)
      .forEach(function (el) {
        push(el, 'toolbar');
      });
    if (listEl && listEl.previousElementSibling) push(listEl.previousElementSibling, 'before-list');
    if (listEl && listEl.parentElement) push(listEl.parentElement, 'list-parent');
    return points;
  }

  function resourceReport(entries) {
    var scanned = 0;
    var paths = [];
    (entries || []).forEach(function (entry) {
      if (!entry) return;
      var kind = entry.initiatorType || '';
      if (kind && kind !== 'fetch' && kind !== 'xmlhttprequest') return;
      scanned += 1;
      var path = pathOnly(entry.name || '');
      if (!/gp2gp|transfer|outbound/i.test(path)) return;
      if (paths.indexOf(path) === -1 && paths.length < 20) paths.push(path);
    });
    return { fetchEntries: scanned, matchingPaths: paths };
  }

  function discover(env) {
    env = env || {};
    var doc = env.document;
    var headers = collectHeaders(doc);
    var seen = [];
    var pairs = [];
    LIST_SELECTORS.forEach(function (selector) {
      qsa(doc, selector).forEach(function (el) {
        if (seen.indexOf(el) !== -1 || pairs.length >= 8) return;
        seen.push(el);
        var summary = summariseContainer(el, doc);
        summary.selector = selector;
        pairs.push({ summary: summary, el: el });
      });
    });
    pairs.sort(function (a, b) {
      return b.summary.rowsInDom - a.summary.rowsInDom;
    });
    var containers = pairs.map(function (pair) {
      return pair.summary;
    });
    var chosenEl = pairs[0] ? pairs[0].el : null;
    var rows = chosenEl ? rowNodes(chosenEl) : [];
    var first = rows[0] || null;
    var blob = first ? bodyBlob(first) : '';
    var report = {
      kind: 'gp2gp-outbound-discovery',
      provisional: true,
      route: routeReport(env.location || {}),
      framework: frameworkReport(doc),
      list: {
        candidates: containers,
        pagination: paginationReport(doc),
      },
      headers: headers.map(function (text) {
        return headerOut(text, blob);
      }),
      firstRow: first
        ? {
            outline: outline(first, 0),
            cells: likelyCells(headers, first),
          }
        : null,
      existingSearch: searchInputs(doc),
      mounts: mountPoints(doc, chosenEl),
      resources: resourceReport(env.resourceEntries || []),
    };
    return JSON.parse(scrubLeak(JSON.stringify(report)));
  }

  function run() {
    var report = discover({
      document: root.document,
      location: root.location,
      resourceEntries:
        root.performance && root.performance.getEntriesByType ? root.performance.getEntriesByType('resource') : [],
    });
    var json = JSON.stringify(report);
    if (root.console && root.console.log) root.console.log(json);
    if (typeof root.copy === 'function') root.copy(json);
    else if (root.console && root.console.warn)
      root.console.warn('[gp2gp-discovery] copy() is not available; the JSON is in the log above');
    return report;
  }

  if (root.__MS_GP2GP_DISCOVERY_HOLD) {
    root.__msGp2gpDiscovery = {
      discover: discover,
      shapeText: shapeText,
      redactPath: redactPath,
      scrubLeak: scrubLeak,
    };
    return;
  }
  run();
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
