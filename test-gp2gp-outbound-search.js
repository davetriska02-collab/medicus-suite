// Medicus Suite — GP2GP outbound search (provisional) + discovery redaction.
// Run with: node test-gp2gp-outbound-search.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
    process.exitCode = 1;
  }
}

function splitTop(sel, comma) {
  const parts = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (comma && c === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function matchCompound(el, compound) {
  let rest = compound.trim();
  if (!rest || rest === '*') return el.nodeType === 1;
  const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest) {
    if (rest[0] === '#') {
      const m = rest.match(/^#([\w-]+)/);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '.') {
      const m = rest.match(/^\.([\w-]+)/);
      if (!m || !el.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '[') {
      const m = rest.match(/^\[([^\]=~|^$*\s]+)(?:([~|^$*]?=)(?:"([^"]*)"|([^\]]+)))?(?:\s+([iI]))?\]/);
      if (!m) return false;
      const name = m[1];
      const op = m[2] || '';
      let expected = m[3] != null ? m[3] : m[4] != null ? m[4] : '';
      const insensitive = !!m[5];
      const actual = el.getAttribute(name);
      if (actual == null) return false;
      if (op) {
        const left = insensitive ? actual.toLowerCase() : actual;
        const right = insensitive ? expected.toLowerCase() : expected;
        if (op === '=' && left !== right) return false;
        if (op === '*=' && left.indexOf(right) === -1) return false;
        if (op === '~=' && left.split(/\s+/).indexOf(right) === -1) return false;
      }
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return el.nodeType === 1;
}

function tokeniseComplex(selector) {
  const tokens = [];
  let buf = '';
  let depth = 0;
  function flushCompound() {
    if (buf.trim()) tokens.push({ type: 'compound', value: buf.trim() });
    buf = '';
  }
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '[') depth++;
    if (c === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && c === '>') {
      flushCompound();
      tokens.push({ type: 'child' });
      continue;
    }
    if (depth === 0 && /\s/.test(c)) {
      flushCompound();
      if (!tokens.length || tokens[tokens.length - 1].type !== 'desc') tokens.push({ type: 'desc' });
      continue;
    }
    buf += c;
  }
  flushCompound();
  return tokens.filter((token, index, arr) => !(token.type === 'desc' && (index === 0 || index === arr.length - 1)));
}

function matchesComplex(el, selector) {
  const tokens = tokeniseComplex(selector);
  if (!tokens.length) return false;
  let index = tokens.length - 1;
  if (tokens[index].type !== 'compound' || !matchCompound(el, tokens[index].value)) return false;
  let cur = el;
  index -= 1;
  while (index >= 0) {
    const comb = tokens[index];
    index -= 1;
    const compound = tokens[index];
    if (!compound || compound.type !== 'compound') return false;
    if (comb.type === 'child') {
      cur = cur.parentElement;
      if (!cur || !matchCompound(cur, compound.value)) return false;
    } else {
      let found = false;
      cur = cur.parentElement;
      while (cur) {
        if (matchCompound(cur, compound.value)) {
          found = true;
          break;
        }
        cur = cur.parentElement;
      }
      if (!found) return false;
    }
    index -= 1;
  }
  return true;
}

function matchesSel(el, selector) {
  return splitTop(selector, true).some((part) => matchesComplex(el, part.trim()));
}

function makeDocument() {
  function refreshAttrs(node) {
    node.attributes = Object.keys(node._attrs).map((name) => ({ name: name, value: node._attrs[name] }));
  }
  function El(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.parentElement = null;
    this.childNodes = [];
    this._attrs = {};
    this.attributes = [];
    this.id = '';
    this._class = '';
    this._listeners = {};
    this.value = '';
    const self = this;
    this.classList = {
      contains(name) {
        return self._class.split(/\s+/).indexOf(name) !== -1;
      },
      add() {
        const names = self._class.split(/\s+/).filter(Boolean);
        Array.prototype.forEach.call(arguments, (name) => {
          if (names.indexOf(name) === -1) names.push(name);
        });
        self.className = names.join(' ');
      },
      remove() {
        let names = self._class.split(/\s+/).filter(Boolean);
        Array.prototype.forEach.call(arguments, (name) => {
          names = names.filter((item) => item !== name);
        });
        self.className = names.join(' ');
      },
    };
  }
  Object.defineProperty(El.prototype, 'className', {
    get() {
      return this._class;
    },
    set(value) {
      this._class = String(value || '');
      if (this._class) this._attrs.class = this._class;
      else delete this._attrs.class;
      refreshAttrs(this);
    },
  });
  Object.defineProperty(El.prototype, 'children', {
    get() {
      return this.childNodes.filter((node) => node.nodeType === 1);
    },
  });
  Object.defineProperty(El.prototype, 'textContent', {
    get() {
      if (this.childNodes.length) return this.childNodes.map((node) => node.textContent || '').join('');
      return '';
    },
    set(value) {
      this.childNodes = [{ nodeType: 3, textContent: String(value == null ? '' : value), parentNode: this }];
    },
  });
  Object.defineProperty(El.prototype, 'nextSibling', {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      return siblings[siblings.indexOf(this) + 1] || null;
    },
  });
  Object.defineProperty(El.prototype, 'firstChild', {
    get() {
      return this.childNodes[0] || null;
    },
  });
  Object.defineProperty(El.prototype, 'previousElementSibling', {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      return siblings[siblings.indexOf(this) - 1] || null;
    },
  });
  Object.defineProperty(El.prototype, 'isConnected', {
    get() {
      let cur = this;
      while (cur) {
        if (cur.nodeType === 9) return true;
        cur = cur.parentNode;
      }
      return false;
    },
  });
  El.prototype.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  };
  El.prototype.setAttribute = function (name, value) {
    this._attrs[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    refreshAttrs(this);
  };
  El.prototype.appendChild = function (child) {
    child.parentNode = this;
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  };
  El.prototype.insertBefore = function (child, before) {
    child.parentNode = this;
    child.parentElement = this;
    if (!before) {
      this.childNodes.push(child);
      return child;
    }
    const index = this.childNodes.indexOf(before);
    if (index === -1) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  };
  El.prototype.removeChild = function (child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    child.parentElement = null;
    return child;
  };
  El.prototype.contains = function (node) {
    let cur = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  El.prototype.matches = function (selector) {
    return matchesSel(this, selector);
  };
  El.prototype.querySelectorAll = function (selector) {
    const out = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (matchesSel(child, selector)) out.push(child);
        walk(child);
      });
    };
    walk(this);
    return out;
  };
  El.prototype.querySelector = function (selector) {
    return this.querySelectorAll(selector)[0] || null;
  };
  El.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  El.prototype.dispatchEvent = function (event) {
    (this._listeners[event.type] || []).forEach((fn) => fn(event));
  };
  El.prototype.focus = function () {};
  El.prototype.getBoundingClientRect = function () {
    return { height: 20, width: 100, top: 0, left: 0 };
  };

  const doc = {
    nodeType: 9,
    documentElement: null,
    body: null,
    createElement(tag) {
      return new El(tag, doc);
    },
    createTextNode(value) {
      return { nodeType: 3, textContent: String(value), parentNode: null, parentElement: null };
    },
  };
  const root = new El('html', doc);
  const body = new El('body', doc);
  root.appendChild(body);
  root.parentNode = doc;
  doc.documentElement = root;
  doc.body = body;
  doc.querySelectorAll = function (selector) {
    return root.querySelectorAll(selector);
  };
  doc.querySelector = function (selector) {
    return root.querySelector(selector);
  };
  doc.getElementById = function (id) {
    const all = root.querySelectorAll('*');
    // '*' matches every element via matchCompound
    return all.concat([root, body]).find((el) => el.id === id) || null;
  };
  return doc;
}

function text(doc, value) {
  return doc.createTextNode(value);
}
function element(doc, tag, attrs, kids) {
  const node = doc.createElement(tag);
  Object.keys(attrs || {}).forEach((key) => {
    if (key === 'class') node.className = attrs[key];
    else node.setAttribute(key, attrs[key]);
  });
  (kids || []).forEach((kid) => node.appendChild(typeof kid === 'string' ? text(doc, kid) : kid));
  return node;
}

const Core = require('./shared/gp2gp-outbound-search-core.js');

console.log('--- match rules ---');
check(Core.rowMatches('Ada Example', '943 476 5919', '') === true, 'empty query keeps the row');
check(Core.rowMatches('Ada Example', '943 476 5919', 'ada') === true, 'name match is case-insensitive');
check(Core.rowMatches('Ada Example', '943 476 5919', 'ADA EXAMPLE') === true, 'full name still matches');
check(Core.rowMatches('Bo Example', '111 222 3333', 'ada') === false, 'other name does not match');
check(Core.rowMatches('Ada Example', '943 476 5919', '943 476') === true, 'NHS match ignores spaces');
check(Core.rowMatches('Ada Example', '943 476 5919', '9434765919') === true, 'NHS match ignores spaces in the cell');
check(Core.rowMatches('Bo Example', '111 222 3333', '943476') === false, 'other NHS does not match');
check(Core.rowMatches('Ada Example', '943 476 5919', 'ada 5919') === true, 'name and NHS digits must both match');
check(Core.rowMatches('Ada Example', '943 476 5919', 'ada 3333') === false, 'name with the wrong NHS does not match');
check(Core.rowMatches('Bo Example', '111 222 3333', 'example 222') === true, 'shared surname plus NHS digits');
check(Core.countLabel(1, 4) === '1 of 4 shown', 'count reads x of y shown');
check(Core.isOutboundRoute('/gp2gp/outbound', '') === true, 'path gp2gp outbound matches');
check(Core.isOutboundRoute('/tasks', '#/gp2gp/transfers/outbound') === true, 'hash route matches');
check(Core.isOutboundRoute('/gp2gp/inbound', '') === false, 'inbound does not match');
check(Core.isOutboundRoute('/patient/outbound', '') === false, 'outbound without gp2gp does not match');
check(Core.noteFor({ limited: true }).indexOf('paginated or virtualised') !== -1, 'limited lists say so');
check(
  Core.noteFor({ limited: false }).indexOf('paginated or virtualised') === -1,
  'a plain list omits the page warning'
);
check(Core.noteFor(null).indexOf('not the same as not on the transfer list') !== -1, 'standing caveat is always there');

console.log('\n--- fixture DOM filter ---');
const doc = makeDocument();
const toolbar = element(doc, 'div', { 'data-ms-gp2gp-toolbar': '1' });
const list = element(doc, 'div', { 'data-ms-gp2gp-list': '1', 'aria-rowcount': '2' });
function addRow(name, nhs) {
  const row = element(doc, 'div', { 'data-ms-gp2gp-row': '1' }, [
    element(doc, 'span', { 'data-ms-gp2gp-name': '1' }, [name]),
    element(doc, 'span', { 'data-ms-gp2gp-nhs': '1' }, [nhs]),
  ]);
  list.appendChild(row);
  return row;
}
const ada = addRow('Ada Example', '943 476 5919');
const bo = addRow('Bo Example', '111 222 3333');
doc.body.appendChild(toolbar);
doc.body.appendChild(list);
const session = Core.createSession(doc);
let result = session.mount();
check(result.found === true && result.shown === 2 && result.total === 2, 'mount shows both loaded rows');
check(result.count === '2 of 2 shown', 'count starts at 2 of 2 shown');
check(toolbar.contains(session.host()), 'bar is mounted in the toolbar');
check(session.host().getAttribute('data-provisional') === 'true', 'bar is marked provisional');
check(session.host().querySelector('#ms-gp2gp-search-clear').textContent === 'Clear', 'clear button is present');
const note = session.host().querySelector('[data-ms-gp2gp-note]').textContent;
check(note.indexOf('Provisional') !== -1, 'note says the selectors are provisional');
check(note.indexOf('not the same as not on the transfer list') !== -1, 'note states a hidden row is not absent');

result = session.setQuery('ADA');
check(result.shown === 1 && result.total === 2, 'name filter leaves one of two');
check(ada.classList.contains(Core.HIDDEN_CLASS) === false, 'matching row stays visible');
check(bo.classList.contains(Core.HIDDEN_CLASS) === true, 'other row is hidden');
check(session.host().querySelector('[data-ms-gp2gp-count]').textContent === '1 of 2 shown', 'count follows the filter');

result = session.setQuery('111 222');
check(result.shown === 1 && bo.classList.contains(Core.HIDDEN_CLASS) === false, 'NHS digits ignore spaces');
check(ada.classList.contains(Core.HIDDEN_CLASS) === true, 'name row hides when the NHS does not match');

result = session.setQuery('bo 3333');
check(result.shown === 1 && bo.classList.contains(Core.HIDDEN_CLASS) === false, 'combined name and NHS match');
result = session.setQuery('bo 5919');
check(result.shown === 0, 'combined query hides a row that only matches the name');

const input = session.host().querySelector('input');
input.value = '';
input.dispatchEvent({ type: 'input' });
result = session.apply();
check(result.shown === 2 && !ada.classList.contains(Core.HIDDEN_CLASS), 'clearing the field shows every loaded row');

input.value = 'ada';
input.dispatchEvent({ type: 'input' });
session.host().querySelector('button').dispatchEvent({ type: 'click' });
check(
  input.value === '' && !bo.classList.contains(Core.HIDDEN_CLASS),
  'clear button empties the query and unhides rows'
);

addRow('Cy Example', '555 666 7777');
result = session.setQuery('cy');
check(result.total === 3 && result.shown === 1, 're-apply includes a row added after mount');

const pager = element(doc, 'nav', { 'aria-label': 'pagination', 'data-ms-gp2gp-pager': '1' });
doc.body.appendChild(pager);
result = session.apply();
check(
  result.limited === true && result.reasons.indexOf('paginated') !== -1,
  'pagination control marks the list limited'
);
check(result.note.indexOf('paginated or virtualised') !== -1, 'limited note is in the UI text');

const virtualDoc = makeDocument();
const grid = element(virtualDoc, 'div', { role: 'grid', 'aria-rowcount': '80', class: 'ag-center-cols-container' });
const only = element(virtualDoc, 'div', { class: 'ag-row', 'col-id': 'patientName' }, ['Ada Example 943 476 5919']);
grid.appendChild(only);
virtualDoc.body.appendChild(grid);
const virtual = Core.applyFilter(virtualDoc, 'nope', Core.SELECTORS);
check(
  virtual.found === true && virtual.shown === 0 && virtual.limited === true,
  'provisional grid selector hides and flags aria-rowcount'
);
check(virtual.reasons.indexOf('virtualised') !== -1, 'aria-rowcount above the DOM rows means virtualised');

session.unmount();
check(session.host() === null, 'unmount removes the bar');
check(
  !bo.classList.contains(Core.HIDDEN_CLASS) && !ada.classList.contains(Core.HIDDEN_CLASS),
  'unmount restores hidden rows'
);

console.log('\n--- discovery redacts the fixture ---');
const sandbox = {
  __MS_GP2GP_DISCOVERY_HOLD: true,
  console: console,
  URL: URL,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'tools/discovery/gp2gp-outbound-discovery.js'), 'utf8'), sandbox, {
  filename: 'gp2gp-outbound-discovery.js',
});
const Discovery = sandbox.__msGp2gpDiscovery;
check(Discovery && typeof Discovery.discover === 'function', 'hold mode exports discover');
check(Discovery.shapeText('Ada Example') === 'Aa Aa', 'a name becomes Aa Aa');
check(Discovery.shapeText('943 476 5919') === '### ### ####', 'an NHS number becomes a shape');
check(Discovery.shapeText('01-Jan-1980') === 'dd-Mmm-yyyy', 'a date becomes dd-Mmm-yyyy');
check(
  Discovery.redactPath('/gp2gp/outbound/019dde9e-1111-2222-3333-444444444444').indexOf('019dde9e') === -1,
  'uuid stripped from a path'
);

const live = makeDocument();
live.documentElement['__vueParentComponent'] = { hidden: 'Ada Example' };
const table = element(live, 'table', { role: 'grid', 'aria-rowcount': '40', class: 'ag-root' });
const headRow = element(live, 'tr', {}, [
  element(live, 'th', { role: 'columnheader' }, ['Patient name']),
  element(live, 'th', { role: 'columnheader' }, ['NHS number']),
  element(live, 'th', { role: 'columnheader' }, ['Date of birth']),
  element(live, 'th', { role: 'columnheader' }, ['Status']),
]);
table.appendChild(element(live, 'thead', {}, [headRow]));
function dataRow(name, nhs, dob) {
  const row = element(live, 'tr', { role: 'row', 'data-patient': name }, [
    element(live, 'td', { role: 'gridcell', 'col-id': 'patientName' }, [name]),
    element(live, 'td', { role: 'gridcell', 'col-id': 'nhsNumber' }, [nhs]),
    element(live, 'td', { role: 'gridcell', 'col-id': 'dob' }, [dob]),
    element(live, 'td', { role: 'gridcell', 'col-id': 'status' }, ['Sent']),
  ]);
  row['__reactFiber$abc'] = { patient: name, nhs: nhs };
  return row;
}
table.appendChild(
  element(live, 'tbody', {}, [
    dataRow('Ada Example', '943 476 5919', '01-Jan-1980'),
    dataRow('Bo Example', '111 222 3333', '15 Mar 1972'),
  ])
);
live.body.appendChild(table);
const typed = element(live, 'input', { type: 'search', placeholder: 'Search patients', 'aria-label': 'Filter list' });
typed.value = 'Ada Example';
live.body.appendChild(typed);
live.body.appendChild(element(live, 'button', {}, ['Load more']));
live.body.appendChild(element(live, 'div', { class: 'MuiTablePagination-root' }));
const pageSize = element(live, 'select', { 'aria-label': 'Rows per page' });
pageSize.value = '25';
live.body.appendChild(pageSize);

const report = Discovery.discover({
  document: live,
  location: {
    pathname: '/gp2gp/outbound/019dde9e-1111-2222-3333-444444444444',
    hash: '#/transfers/outbound?patient=Ada',
    search: '?nhs=9434765919',
  },
  resourceEntries: [
    {
      initiatorType: 'xmlhttprequest',
      name: 'https://abcd.api.england.medicus.health/gp2gp/transfers/outbound/019dde9e-1111-2222-3333-444444444444?patientName=Ada%20Example',
    },
    {
      initiatorType: 'fetch',
      name: 'https://abcd.api.england.medicus.health/tasks/data/secret-patient',
    },
    { initiatorType: 'img', name: 'https://abcd.api.england.medicus.health/gp2gp/outbound/icon.png' },
  ],
});
const json = JSON.stringify(report);
[
  'Ada',
  'Example',
  'Bo',
  '943',
  '476',
  '5919',
  '111',
  '222',
  '3333',
  '1980',
  '1972',
  'Jan',
  'Mar',
  'abcd',
  'secret',
  '019dde9e',
].forEach((needle) => {
  check(json.indexOf(needle) === -1, 'discovery JSON omits ' + needle);
});
check(json.indexOf('patientName=') === -1 && json.indexOf('%20') === -1, 'query values are stripped');
check(
  report.firstRow.cells.some((cell) => cell.role === 'name' && cell.colId === 'patientName'),
  'column id is kept as a selector hint'
);
check(report.route.pathname === '/gp2gp/outbound/:uuid', 'pathname keeps the route and drops the uuid');
check(report.route.hash.indexOf('?') === -1 && report.route.hash.indexOf('Ada') === -1, 'hash drops the query');
check(report.route.patterns.indexOf('contains gp2gp') !== -1, 'route pattern records gp2gp');
check(report.route.patterns.indexOf('contains outbound') !== -1, 'route pattern records outbound');
check(
  report.framework.react === true && report.framework.vue === true && report.framework.agGrid === true,
  'framework markers are booleans'
);
check(
  report.list.candidates.length >= 1 && report.list.candidates[0].rowsInDom === 2,
  'candidate counts rows without their text'
);
check(report.list.candidates[0].virtualised === true, 'aria-rowcount above the DOM count marks virtualised');
check(
  report.list.pagination.present === true && report.list.pagination.infiniteScroll === true,
  'pagination and load-more are flagged'
);
check(report.list.pagination.pageSize === 25, 'page size is the control value');
check(
  report.headers.some((header) => header.role === 'name' && header.text === 'Patient name'),
  'safe column header text is kept'
);
check(
  report.headers.some((header) => header.role === 'nhs'),
  'NHS column is classified'
);
check(
  report.headers.some((header) => header.role === 'dob'),
  'DOB column is classified'
);
check(
  report.firstRow.cells.some((cell) => cell.role === 'name' && cell.shape === 'Aa Aa'),
  'name cell is a shape'
);
check(
  report.firstRow.cells.some((cell) => cell.role === 'nhs' && cell.shape === '### ### ####'),
  'NHS cell is a shape'
);
check(
  report.firstRow.cells.some((cell) => cell.role === 'dob' && cell.shape === 'dd-Mmm-yyyy'),
  'DOB cell is a shape'
);
check(report.firstRow.outline.data.indexOf('data-patient') !== -1, 'data attribute names are kept');
check(JSON.stringify(report.firstRow.outline).indexOf('Ada') === -1, 'row outline has no name');
check(
  report.existingSearch.length === 1 && report.existingSearch[0].type === 'search',
  'existing search input is listed'
);
check(json.indexOf('Search patients') === -1, 'placeholder text is shaped');
check(report.resources.matchingPaths.length === 1, 'one gp2gp resource path');
check(report.resources.matchingPaths[0].indexOf('?') === -1, 'resource path has no query');
check(report.resources.matchingPaths[0] === '/gp2gp/transfers/outbound/:uuid', 'resource path drops the uuid');
check(report.resources.fetchEntries === 2, 'image resources are not scanned as the list API');
check(report.mounts.length > 0, 'a mount point is described');

console.log('\n--- pack is opt-in and selectors stay in one map ---');
const Packs = require('./shared/practice-packs.js');
check(Packs.KEYS.gp2gpOutboundSearch === 'suite.ui.gp2gpOutboundSearch', 'pack key');
check(Packs.isGrandfather(Packs.KEYS.gp2gpOutboundSearch) === false, 'missing key is not grandfathered on');
check(Packs.isEnabled(Packs.KEYS.gp2gpOutboundSearch, undefined) === false, 'missing key stays off');
check(Packs.isEnabled(Packs.KEYS.gp2gpOutboundSearch, false) === false, 'explicit false stays off');
check(Packs.isEnabled(Packs.KEYS.gp2gpOutboundSearch, true) === true, 'explicit true turns it on');
const packsSrc = fs.readFileSync(path.join(__dirname, 'shared/practice-packs.js'), 'utf8');
const grandfather = packsSrc.slice(packsSrc.indexOf('const GRANDFATHER_KEYS'), packsSrc.indexOf('const ALL_PACK_KEYS'));
check(grandfather.indexOf('gp2gpOutboundSearch') === -1, 'GP2GP search is outside the grandfather list');

const content = fs.readFileSync(path.join(__dirname, 'content-scripts/gp2gp-outbound-search.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(__dirname, 'shared/gp2gp-outbound-search-core.js'), 'utf8');
check(
  /MutationObserver/.test(content) && /childList:\s*true/.test(content),
  'content script re-applies on DOM mutation'
);
check(/hashchange/.test(content) && /InjectorRuntime/.test(content), 'content script follows SPA navigation');
check(/unmount/.test(content) && /bindInjector/.test(content), 'pack off tears the bar down');
check(!/_packOn = true/.test(content.replace(/_packOn = true;\s*\n\s*Runtime\.sync/, '')), 'pack does not default on');
check(!/innerHTML/.test(content) && !/innerHTML/.test(coreSrc), 'bar is not built with innerHTML');
check(
  !/\b(POST|PUT|PATCH|DELETE)\b/.test(content) && !/fetch\(/.test(content),
  'content script does not write or fetch'
);
check(/querySelector\(/.test(content) === false, 'content script does not hard-code a list selector');
check(/SELECTORS/.test(coreSrc) && /col-id="patientName"/.test(coreSrc), 'provisional selectors live in the core map');
const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
check(manifest.indexOf('shared/gp2gp-outbound-search-core.js') !== -1, 'core is in the manifest');
check(manifest.indexOf('content-scripts/gp2gp-outbound-search.js') !== -1, 'content script is in the manifest');
check(manifest.indexOf('content-scripts/gp2gp-outbound-search.css') !== -1, 'stylesheet is in the manifest');
const optionsHtml = fs.readFileSync(path.join(__dirname, 'options/options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(__dirname, 'options/options.js'), 'utf8');
check(/id="pfGp2gpOutboundSearch"/.test(optionsHtml), 'options has the GP2GP outbound search switch');
check(/suite\.ui\.gp2gpOutboundSearch[\s\S]{0,80}grandfather:\s*false/.test(optionsJs), 'options toggle is opt-in');
const suiteIo = fs.readFileSync(path.join(__dirname, 'shared/io/suite-io.js'), 'utf8');
check(/suite\.ui\.gp2gpOutboundSearch/.test(suiteIo), 'suite backup includes the pack key');
const profile = fs.readFileSync(path.join(__dirname, 'shared/io/practice-profile.js'), 'utf8');
check(/'ui\.gp2gpOutboundSearch'/.test(profile), 'practice profile allow-list includes the pack');
const profileGrand = profile.slice(
  profile.indexOf('const GRANDFATHER_PACK_KEYS'),
  profile.indexOf('const ENVELOPE_ALIASES')
);
check(profileGrand.indexOf('gp2gpOutboundSearch') === -1, 'profile merge does not treat a missing key as on');

const hazard = fs.readFileSync(path.join(__dirname, 'docs/HAZARD-LOG.md'), 'utf8');
const h092 = (hazard.split('### H-092')[1] || '').split('\n## ')[0];
check(/### H-092 — /.test(hazard), 'hazard log has H-092');
check(/Proposed/.test(h092) && /sign-off blank/i.test(h092), 'H-092 is proposed with sign-off blank');
check(!/signed off/i.test(h092) && !/GMC/.test(h092), 'H-092 entry does not invent a CSO signature');
const notice = fs.readFileSync(path.join(__dirname, 'docs/CLINICAL-SAFETY-NOTICE.md'), 'utf8');
check(
  /H-092/.test(notice) && /sign-off blank/i.test(notice),
  'clinical safety notice drafts H-092 with sign-off blank'
);
const changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
check(/## \[v3\.268\.8\]/.test(changelog) && /H-092/.test(changelog), 'changelog records the patch and H-092');
const manifestJson = JSON.parse(manifest);
check(manifestJson.version === '3.268.8', 'manifest patch version is 3.268.8');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
