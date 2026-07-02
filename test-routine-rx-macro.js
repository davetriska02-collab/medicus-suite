// Medicus Suite — Routine-Rx reassign macro tests
// Run with: node test-routine-rx-macro.js
//
// routine-rx-button.js (content-scripts/triage-lens/routine-rx-button.js) had
// NO behavioural test — asymmetric with lab-file-button.js, which has
// test-lab-file-macro.js. Unlike lab-file-button.js, routine-rx-button.js is a
// single unconditional IIFE with no `module.exports` Node hook (it reaches
// straight for `window`/`document`/`chrome` at load time), and per the task
// this file must NOT be modified to add one. So this test extracts the pure
// DOM-driving functions (findByText / collectByText / sharesPanel /
// findAssignInput / findRoutingControl / findActionAnchor / runMacro)
// VERBATIM from the source via `vm`, the same "extract, don't reimplement"
// technique test-pincer-parity.js uses for content.js/visualiser-core.js. The
// extracted code runs against a small fake DOM (mirroring test-lab-file-macro.js's
// El/Root style, but with a real (if tiny) CSS-selector matcher — routine-rx's
// selectors include attribute/class/compound forms lab-file's regex-per-selector
// approach doesn't need to handle: `[role="radio"]`, `.radio`, `[id^="select-item-"]`,
// `[class*="label"]`, `li[role="option"]`, comma lists).
//
// Two free identifiers the real code hard-codes long timeouts on — `waitFor`
// (4000/5000/6000ms) and the per-keystroke `typeText` (45ms/char) — are NOT
// extracted from source; they are not caller-injectable in the real macro (unlike
// lab-file-button.js's fileAllNormal, which takes waitForFn as an option), so this
// test supplies fast test-double replacements with the SAME poll/resolve and
// char-by-char/dispatch contract, just short-timed, so the suite runs in
// milliseconds instead of the real ~15s worst case. `toast` / `highlight` /
// `saveCfg` / `renderButton` (UI/storage side effects, not extracted — they live
// in the "UI: floating button" section this test doesn't pull in) are stubbed as
// recorders so runMacro's abort/manual/confirm/auto paths can be observed without
// building the full floating-button UI.
//
// Safety behaviours pinned here:
//   • findActionAnchor gates on ALL THREE conditions (routing control present +
//     visible, "More actions" sharing the same panel, not inside a dialog) —
//     missing any one means the button (and therefore the whole macro surface)
//     never appears.
//   • runMacro's happy path clicks in strict order: radio → assign input →
//     type the team char-by-char → team option → wait for commit to ENABLE →
//     commit per commitMode.
//   • commitMode 'manual' highlights the commit button and clicks nothing;
//     'confirm' clicks only after window.confirm() returns true, and a
//     cancelled confirm clicks nothing; 'auto' clicks the commit itself.
//   • Every abort path (no radio, assign input never appears, team option not
//     in the list, commit stays disabled) fails safe: it never reaches the
//     commit click.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── Extract the pure DOM-driving functions from routine-rx-button.js ──────────
// (no production file modified — this is read-only source slicing, same
// technique as test-pincer-parity.js's extraction of content.js/visualiser-core.js)

const SRC_PATH = path.join(__dirname, 'content-scripts', 'triage-lens', 'routine-rx-button.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function slice(startNeedle, endNeedle) {
  const s = SRC.indexOf(startNeedle);
  if (s < 0) throw new Error('extraction start needle not found (source changed?): ' + startNeedle);
  const e = SRC.indexOf(endNeedle, s);
  if (e < 0) throw new Error('extraction end needle not found (source changed?): ' + endNeedle);
  return SRC.slice(s, e);
}

const EXTRACTED = [
  // var DC = window.DomContracts;
  slice('var DC = window.DomContracts;', '\n'),
  // config: STORE_KEY / DEFAULTS / cfg (loadCfg/saveCfg deliberately excluded —
  // they touch chrome.storage and are stubbed separately below)
  slice("var STORE_KEY = 'triagelens.routineRx';", '\n\n  function loadCfg'),
  // norm / visible / isEnabled / textOf / findByText / collectByText / sharesPanel
  slice('function norm(s) {', '\n\n  function waitFor(fn, timeout, interval) {'),
  // realClick / setNativeValue (waitFor and typeText deliberately excluded — see
  // file header: both get fast test-double replacements)
  slice('function realClick(el) {', '// The "Assign to" picker (Medicus'),
  // findAssignInput
  slice('function findAssignInput() {', '\n\n  // ---- the macro'),
  // commitAndAudit / highlightAndAudit (recordAudit itself is NOT extracted —
  // audit persistence is covered by test-routine-rx-audit.js; here a sandbox
  // spy stands in so the macro paths can call it)
  slice('function commitAndAudit(', '\n\n  // ---- DOM helpers'),
  // running / abort / runMacro
  slice('var running = false;', '\n\n  // ---- UI: floating button'),
  // findRoutingControl / findActionAnchor
  slice('function findRoutingControl() {', '\n\n  // The anchor the host is currently parented to.'),
].join('\n\n');

check(/function runMacro/.test(EXTRACTED), 'extraction: runMacro source captured');
check(/function findActionAnchor/.test(EXTRACTED), 'extraction: findActionAnchor source captured');
check(/function findRoutingControl/.test(EXTRACTED), 'extraction: findRoutingControl source captured');
check(/function sharesPanel/.test(EXTRACTED), 'extraction: sharesPanel source captured');
check(
  !/function waitFor\(/.test(EXTRACTED),
  'extraction: real long-timeout waitFor NOT pulled in (fast double supplied instead)'
);
check(
  !/function typeText\(/.test(EXTRACTED),
  'extraction: real 45ms/char typeText NOT pulled in (fast double supplied instead)'
);

// ── Tiny CSS-selector engine for the fake DOM ──────────────────────────────────
// routine-rx-button.js's selectors go beyond lab-file-button.js's simple
// tag/.class/[attr="v"] set: comma lists, `[id^="v"]` prefix, `[class*="v"]`
// substring, and compound `li[role="option"]`. Descendant combinators are never
// used in this file's querySelectorAll calls, so a single-compound-per-clause
// matcher (no combinator support needed) is sufficient.
function parseSimpleSelector(sel) {
  const attrs = [];
  const attrRe = /\[([a-zA-Z-]+)(?:([~^$*|]?=)"([^"]*)")?\]/g;
  let m;
  while ((m = attrRe.exec(sel))) attrs.push({ name: m[1], op: m[2], value: m[3] });
  let rest = sel.replace(attrRe, '');
  const classes = [];
  const classRe = /\.([\w-]+)/g;
  while ((m = classRe.exec(rest))) classes.push(m[1]);
  rest = rest.replace(classRe, '').trim();
  return { tag: rest ? rest.toLowerCase() : null, classes, attrs };
}
function elementMatchesSimple(elx, parts) {
  if (parts.tag && elx.tag !== parts.tag) return false;
  for (const c of parts.classes) if (!elx.classes.includes(c)) return false;
  for (const a of parts.attrs) {
    const val = elx.getAttribute(a.name);
    if (val === null || val === undefined) return false;
    if (a.op === undefined) continue; // presence-only
    if (a.op === '=' && val !== a.value) return false;
    if (a.op === '^=' && val.indexOf(a.value) !== 0) return false;
    if (a.op === '*=' && val.indexOf(a.value) === -1) return false;
    if (a.op === '$=' && val.slice(-a.value.length) !== a.value) return false;
  }
  return true;
}
function elementMatches(elx, selectorList) {
  return selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => elementMatchesSimple(elx, parseSimpleSelector(s)));
}

// ── Fake DOM ─────────────────────────────────────────────────────────────────
let CLICKS = [];
class FakeEl {
  constructor(tag, opts) {
    opts = opts || {};
    this.tag = tag.toLowerCase();
    this.classes = opts.classes || [];
    this.attrs = opts.attrs || {};
    this.textContent = opts.text || '';
    this.value = opts.value !== undefined ? opts.value : '';
    this.disabled = !!opts.disabled;
    this.hiddenEl = !!opts.hidden;
    this.label = opts.label || opts.text || '';
    this.children = [];
    this.parentElement = null;
    this.onClickFn = opts.onClick || null;
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  get classList() {
    return { contains: (c) => this.classes.includes(c) };
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get offsetParent() {
    return this.hiddenEl ? null : {};
  }
  getClientRects() {
    return this.hiddenEl ? [] : [{}];
  }
  contains(other) {
    let n = other;
    while (n) {
      if (n === this) return true;
      n = n.parentElement;
    }
    return false;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n.tag && elementMatches(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  matches(sel) {
    return elementMatches(this, sel);
  }
  querySelectorAll(sel) {
    return collectDescendants(this, sel);
  }
  querySelector(sel) {
    return collectDescendants(this, sel)[0] || null;
  }
  click() {
    CLICKS.push(this.label || this.textContent);
    if (typeof this.onClickFn === 'function') this.onClickFn();
  }
  focus() {}
  dispatchEvent() {}
}
function collectDescendants(root, sel) {
  const out = [];
  (function walk(node) {
    for (const c of node.children) {
      if (elementMatches(c, sel)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}
function el(tag, opts) {
  return new FakeEl(tag, opts);
}
function buildRoot(elements) {
  const root = new FakeEl('document-root');
  elements.forEach((e) => root.appendChild(e));
  return root;
}
// Wrap `inner` in `times` plain <div> ancestors — used to push a node's shared
// root beyond sharesPanel's depth cap (default 12), so a fixture can model
// "truly a different panel" rather than "merely a different immediate parent"
// (everything in a real page ultimately shares <body>, so the depth cap is
// what makes sharesPanel meaningful — see routine-rx-button.js sharesPanel).
function wrapDeep(inner, times) {
  let node = inner;
  for (let i = 0; i < times; i++) {
    const wrapper = el('div', {});
    wrapper.appendChild(node);
    node = wrapper;
  }
  return node;
}

// ── Fixture-derived screens ─────────────────────────────────────────────────
// Mirrors fixtures/medicus/routine-rx-*.html: a "More actions" button, the
// routing label, the assign-to input, and (once revealed) the team option list
// + commit button. The team option and commit button are added dynamically by
// the test to model Medicus's live/async picker, matching
// fixtures/medicus/routine-rx-assignee-option.html's `<li id="select-item-1"
// role="option">`.
function fullScreen(overrides) {
  overrides = overrides || {};
  const els = [
    el('button', { text: 'More actions', label: 'MoreActions' }),
    el('label', { text: 'Save & send to routine requests task list', label: 'RoutingRadio' }),
  ];
  if (!overrides.omitAssignInput) {
    els.push(el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' }));
  }
  if (overrides.teamOptionText) {
    els.push(
      el('li', {
        attrs: { id: 'select-item-1', role: 'option' },
        text: overrides.teamOptionText,
        label: 'TeamOption',
      })
    );
  }
  const commitDisabled = overrides.commitDisabled !== false; // disabled until team chosen, by default
  els.push(
    el('button', {
      text: 'Send to routine list',
      label: 'CommitBtn',
      disabled: overrides.commitInitiallyDisabled !== false,
    })
  );
  return els;
}

// Fast test doubles for the two hard-coded-long-timeout helpers. Same
// poll-then-resolve(null) / char-by-char-set-then-dispatch contract as the real
// functions, just capped short so the suite runs fast (see file header).
function fastWaitFor(fn, timeout, interval) {
  timeout = Math.min(timeout || 5000, 200);
  interval = Math.min(interval || 120, 15);
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      let v;
      try {
        v = fn();
      } catch (e) {
        v = null;
      }
      if (v) return resolve(v);
      if (Date.now() - t0 >= timeout) return resolve(null);
      setTimeout(poll, interval);
    })();
  });
}
const TYPED_KEYSTROKES = []; // records progressive built-so-far values per typeText call, for the char-by-char assertion
function fastTypeText(elx, text) {
  TYPED_KEYSTROKES.length = 0;
  return new Promise((resolve) => {
    let i = 0;
    let built = '';
    (function step() {
      if (i >= text.length) return resolve();
      built += text[i++];
      elx.value = built;
      TYPED_KEYSTROKES.push(built);
      setTimeout(step, 2);
    })();
  });
}

// ── Build the vm sandbox and run the extracted source once ────────────────────
const DomContracts = require(path.join(__dirname, 'shared', 'dom-contracts.js'));

let CONFIRM_RETURN = true;
const TOASTS = [];
const HIGHLIGHTED = [];

function makeSandbox(rootEl, pathname) {
  CLICKS = [];
  TOASTS.length = 0;
  HIGHLIGHTED.length = 0;
  const sandbox = {
    console,
    setTimeout,
    Date,
    Promise,
    Object,
    Array,
    String,
    JSON,
    document: rootEl,
    location: { pathname: pathname || '/tasks/data/prescription-requests/overview/abc-123' },
    window: {
      DomContracts,
      confirm: (msg) => {
        TOASTS.push({ kind: 'confirm-prompt', msg });
        return CONFIRM_RETURN;
      },
    },
    // realClick's synthetic-event constructors — Node has none of these; the
    // real function already wraps each `new MouseEvent(...)` in its own
    // try/catch and falls through to `el.click()` regardless, but we supply
    // trivial stand-ins for cleanliness rather than relying on a swallowed
    // ReferenceError.
    MouseEvent: function (type, opts) {
      this.type = type;
      Object.assign(this, opts || {});
    },
    Event: function (type, opts) {
      this.type = type;
      Object.assign(this, opts || {});
    },
    // Fast test doubles (see file header) — supplied as free identifiers so
    // runMacro's unqualified `waitFor(...)` / `typeText(...)` calls resolve to
    // these instead of the real long-timeout versions.
    waitFor: fastWaitFor,
    typeText: fastTypeText,
    // UI/storage side effects stubbed as recorders — not part of the safety
    // logic under test, and their real definitions live outside the extracted
    // slice (see file header).
    toast: (msg, kind) => TOASTS.push({ kind, msg }),
    highlight: (elx) => HIGHLIGHTED.push(elx),
    // spy for the audit sink the commit/abort paths call (see extraction note)
    recordAudit: () => {},
    saveCfg: () => {},
    renderButton: () => {},
    setBusy: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(EXTRACTED, sandbox);
  vm.runInContext(
    [
      'this.runMacro = runMacro;',
      'this.findRoutingControl = findRoutingControl;',
      'this.findActionAnchor = findActionAnchor;',
      'this.sharesPanel = sharesPanel;',
      'this.findByText = findByText;',
      'this.collectByText = collectByText;',
      'this.findAssignInput = findAssignInput;',
      'this.cfg = cfg;',
    ].join('\n'),
    sandbox
  );
  return sandbox;
}

// Sanity-check the extraction actually produced callable functions before
// building the real test scenarios on top of it.
{
  const sb = makeSandbox(buildRoot([]), '/x');
  check(typeof sb.runMacro === 'function', 'sandbox: runMacro is callable after extraction');
  check(typeof sb.findRoutingControl === 'function', 'sandbox: findRoutingControl is callable');
  check(typeof sb.findActionAnchor === 'function', 'sandbox: findActionAnchor is callable');
  check(typeof sb.sharesPanel === 'function', 'sandbox: sharesPanel is callable');
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // findActionAnchor placement gates
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- findActionAnchor: placement gates ---');

  {
    // Happy path: routing control present + visible, "More actions" shares the
    // same panel → anchor found.
    const more = el('button', { text: 'More actions', label: 'MoreActions' });
    const routing = el('label', { text: 'Save & send to routine requests task list', label: 'RoutingRadio' });
    const panel = el('div', { classes: ['rx-form'] });
    panel.appendChild(more);
    panel.appendChild(routing);
    const root = buildRoot([panel]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    const anchor = sb.findActionAnchor();
    check(anchor === more.parentElement, 'gate pass: routing control + shared-panel More actions → anchor returned');
  }

  {
    // Gate 1: wrong URL (not a prescription overview) → null, even with a perfect DOM
    const more = el('button', { text: 'More actions' });
    const routing = el('label', { text: 'Save & send to routine requests task list' });
    const panel = el('div', {});
    panel.appendChild(more);
    panel.appendChild(routing);
    const root = buildRoot([panel]);
    const sb = makeSandbox(root, '/tasks/data/appointments/overview/abc-123');
    check(sb.findActionAnchor() === null, 'gate 1: non-prescription URL → null anchor');
  }

  {
    // Gate 2: routing control absent → null, even with "More actions" present
    const more = el('button', { text: 'More actions' });
    const root = buildRoot([more]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    check(sb.findActionAnchor() === null, 'gate 2: routing control absent → null anchor');
  }

  {
    // Gate 2: routing control present but NOT VISIBLE → null
    const more = el('button', { text: 'More actions' });
    const routing = el('label', {
      text: 'Save & send to routine requests task list',
      hidden: true,
    });
    const panel = el('div', {});
    panel.appendChild(more);
    panel.appendChild(routing);
    const root = buildRoot([panel]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    check(sb.findActionAnchor() === null, 'gate 2: routing control present but hidden → null anchor');
  }

  {
    // Gate 3: "More actions" exists but in a DIFFERENT panel (not sharing an
    // ancestor within sharesPanel's depth cap) — must not be picked. Everything
    // ultimately shares <body>/document, so the decoy is wrapped deep enough
    // that its shared ancestor with the routing control falls beyond the cap —
    // otherwise the depth check is a no-op (see wrapDeep).
    const more = el('button', { text: 'More actions' });
    const otherPanel = el('div', { classes: ['other-drawer'] });
    otherPanel.appendChild(more);
    const deepOtherPanel = wrapDeep(otherPanel, 13);
    const routing = el('label', { text: 'Save & send to routine requests task list' });
    const routingPanel = el('div', { classes: ['rx-form'] });
    routingPanel.appendChild(routing);
    const root = buildRoot([deepOtherPanel, routingPanel]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    check(sb.findActionAnchor() === null, "gate 3: More actions in a separate panel (doesn't share) → null anchor");
  }

  {
    // Gate 3: "More actions" is inside a dialog → excluded even though it
    // otherwise shares the panel with the routing control.
    const dialog = el('div', { attrs: { role: 'dialog' } });
    const more = el('button', { text: 'More actions' });
    dialog.appendChild(more);
    const routing = el('label', { text: 'Save & send to routine requests task list' });
    const panel = el('div', {});
    panel.appendChild(dialog);
    panel.appendChild(routing);
    const root = buildRoot([panel]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    check(sb.findActionAnchor() === null, 'gate 3: More actions inside [role="dialog"] → excluded, null anchor');
  }

  {
    // Two "More actions" candidates: one in an unrelated overlay drawer (must be
    // skipped), one sharing the routing panel (must be picked). Confirms the
    // function chooses by context, not "first match". The decoy is pushed
    // beyond sharesPanel's depth cap (see wrapDeep) so it's genuinely a
    // separate panel, not just a different immediate parent.
    const decoyMore = el('button', { text: 'More actions', label: 'DecoyMore' });
    const decoyPanel = el('div', { classes: ['appointment-drawer'] });
    decoyPanel.appendChild(decoyMore);
    const deepDecoyPanel = wrapDeep(decoyPanel, 13);

    const realMore = el('button', { text: 'More actions', label: 'RealMore' });
    const routing = el('label', { text: 'Save & send to routine requests task list' });
    const rxPanel = el('div', { classes: ['rx-form'] });
    rxPanel.appendChild(realMore);
    rxPanel.appendChild(routing);

    const root = buildRoot([deepDecoyPanel, rxPanel]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    const anchor = sb.findActionAnchor();
    check(
      anchor === realMore.parentElement,
      'gate 3: chooses the More actions sharing the routing panel, not the decoy'
    );
  }

  {
    // Legacy DOM variant (fixtures/medicus/routine-rx-routing-control-legacy.html):
    // routing option rendered as a bare <div>, not a label/[role=radio]/.radio —
    // the narrow pass must fall back to the wide div/span sweep.
    const more = el('button', { text: 'More actions' });
    const routing = el('div', { classes: ['routing-option'], text: 'Save & send to routine requests task list' });
    const panel = el('div', { classes: ['rx-form'] });
    panel.appendChild(more);
    panel.appendChild(routing);
    const root = buildRoot([panel]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    check(
      sb.findRoutingControl() === routing,
      'legacy variant: findRoutingControl falls back to the wide div/span sweep'
    );
    check(
      sb.findActionAnchor() === more.parentElement,
      'legacy variant: findActionAnchor still resolves via the fallback'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // runMacro: happy path
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- runMacro: happy path (confirm mode, OK) ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    const root = buildRoot([radio, assign]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    CONFIRM_RETURN = true;

    // Model the async picker: the team option and enabled commit button appear
    // only once the search has "landed" — added a tick after runMacro starts,
    // matching the real debounced/server-driven search this macro drives.
    const teamName = 'Prescribing / Meds Management';
    setTimeout(() => {
      const option = el('li', { attrs: { id: 'select-item-1', role: 'option' }, text: teamName, label: 'TeamOption' });
      root.appendChild(option);
    }, 5);
    setTimeout(() => {
      const commit = el('button', { text: 'Send to routine list', label: 'CommitBtn', disabled: false });
      root.appendChild(commit);
    }, 10);

    await sb.runMacro(teamName, 'confirm');

    check(CLICKS[0] === 'Radio', 'happy path: step 1 clicks the routing radio first');
    check(CLICKS.indexOf('AssignInput') > CLICKS.indexOf('Radio'), 'happy path: assign input clicked after the radio');
    check(
      CLICKS.indexOf('TeamOption') > CLICKS.indexOf('AssignInput'),
      'happy path: team option clicked after the assign input'
    );
    check(
      CLICKS.indexOf('CommitBtn') > CLICKS.indexOf('TeamOption'),
      'happy path: commit clicked LAST, after the team option'
    );
    check(
      TYPED_KEYSTROKES.length === teamName.length,
      'happy path: typed the team name char-by-char (one step per character)'
    );
    check(
      TYPED_KEYSTROKES[TYPED_KEYSTROKES.length - 1] === teamName,
      'happy path: final typed value is the full team name'
    );
    check(assign.value === teamName, 'happy path: assign input value ends up as the full team name');
    check(sb.cfg.lastTeam === teamName, 'happy path: cfg.lastTeam updated to the sent team');
    check(
      TOASTS.some((t) => t.kind === 'confirm-prompt' && t.msg.includes(teamName)),
      'happy path: confirm dialog names the destination team'
    );
    check(
      TOASTS.some((t) => t.kind === 'ok' && /Sent to/.test(t.msg)),
      'happy path: a success toast is shown after commit'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // commitMode variants
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- commitMode: manual (highlights, never clicks) ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    const teamName = 'Prescribing / Meds Management';
    const option = el('li', { attrs: { id: 'select-item-1', role: 'option' }, text: teamName, label: 'TeamOption' });
    const commit = el('button', { text: 'Send to routine list', label: 'CommitBtn', disabled: false });
    const root = buildRoot([radio, assign, option, commit]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');

    await sb.runMacro(teamName, 'manual');

    check(CLICKS.indexOf('CommitBtn') === -1, 'manual mode: commit is never clicked');
    check(HIGHLIGHTED.indexOf(commit) !== -1, 'manual mode: the commit button is highlighted for the clinician');
    check(
      TOASTS.some((t) => t.kind === 'ok' && /Ready/.test(t.msg)),
      'manual mode: a "ready" toast is shown instead of a sent confirmation'
    );
  }

  console.log('\n--- commitMode: confirm, cancelled (clicks nothing) ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    const teamName = 'Prescribing / Meds Management';
    const option = el('li', { attrs: { id: 'select-item-1', role: 'option' }, text: teamName, label: 'TeamOption' });
    const commit = el('button', { text: 'Send to routine list', label: 'CommitBtn', disabled: false });
    const root = buildRoot([radio, assign, option, commit]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    CONFIRM_RETURN = false;

    await sb.runMacro(teamName, 'confirm');

    check(CLICKS.indexOf('CommitBtn') === -1, 'confirm cancelled: commit is never clicked');
    check(
      TOASTS.some((t) => t.kind === 'warn' && /Cancelled/.test(t.msg)),
      'confirm cancelled: a "cancelled, nothing sent" toast is shown'
    );
    CONFIRM_RETURN = true; // reset for subsequent scenarios
  }

  console.log('\n--- commitMode: auto (clicks commit without asking) ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    const teamName = 'Prescribing / Meds Management';
    const option = el('li', { attrs: { id: 'select-item-1', role: 'option' }, text: teamName, label: 'TeamOption' });
    const commit = el('button', { text: 'Send to routine list', label: 'CommitBtn', disabled: false });
    const root = buildRoot([radio, assign, option, commit]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');

    let confirmCalled = false;
    sb.window.confirm = () => {
      confirmCalled = true;
      return true;
    };

    await sb.runMacro(teamName, 'auto');

    check(CLICKS.indexOf('CommitBtn') !== -1, 'auto mode: commit IS clicked');
    check(!confirmCalled, 'auto mode: window.confirm is never invoked');
    check(
      TOASTS.some((t) => t.kind === 'ok' && /Sent to/.test(t.msg)),
      'auto mode: a success toast is shown'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // abort paths — every one must fail safe: never reach the commit click
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- abort: routing radio absent ---');
  {
    const root = buildRoot([]); // no radio at all
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    await sb.runMacro('Prescribing / Meds Management', 'auto');
    check(CLICKS.length === 0, 'abort (no radio): clicks nothing at all');
    check(
      TOASTS.some((t) => t.kind === 'err' && /Save & send to routine/.test(t.msg)),
      'abort (no radio): toasts an error naming the missing routing control'
    );
  }

  console.log('\n--- abort: assign input never appears (timeout) ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const root = buildRoot([radio]); // radio only — no assign input ever added
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    const t0 = Date.now();
    await sb.runMacro('Prescribing / Meds Management', 'auto');
    const elapsed = Date.now() - t0;
    check(
      CLICKS.length === 1 && CLICKS[0] === 'Radio',
      'abort (no assign input): only the radio was clicked, nothing further'
    );
    check(
      TOASTS.some((t) => t.kind === 'err' && /Assign to/.test(t.msg)),
      'abort (no assign input): toasts an error naming the missing "Assign to" picker'
    );
    check(elapsed < 2000, `abort (no assign input): resolves quickly via the fast waitFor double (took ${elapsed}ms)`);
  }

  console.log('\n--- abort: team option not in the assignee list ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    // Deliberately no matching <li id="select-item-*" role="option"> — the team
    // name typed does not exist in the picker's results.
    const root = buildRoot([radio, assign]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    await sb.runMacro('Nonexistent Team', 'auto');
    check(CLICKS.indexOf('CommitBtn') === -1, 'abort (team not in list): commit is never clicked');
    check(
      TOASTS.some((t) => t.kind === 'err' && /isn.t in the assignee list/.test(t.msg)),
      'abort (team not in list): toasts an error naming the team and the picker'
    );
  }

  console.log('\n--- abort: commit stays disabled after selection ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    const teamName = 'Prescribing / Meds Management';
    const option = el('li', { attrs: { id: 'select-item-1', role: 'option' }, text: teamName, label: 'TeamOption' });
    // Commit button present but NEVER becomes enabled (models Medicus not
    // registering the assignee, e.g. a stale/partial selection).
    const commit = el('button', { text: 'Send to routine list', label: 'CommitBtn', disabled: true });
    const root = buildRoot([radio, assign, option, commit]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    await sb.runMacro(teamName, 'auto');
    check(CLICKS.indexOf('CommitBtn') === -1, 'abort (commit disabled): commit is never clicked while disabled');
    check(CLICKS.indexOf('TeamOption') !== -1, 'abort (commit disabled): the team option WAS selected (got that far)');
    check(
      TOASTS.some((t) => t.kind === 'err' && /stayed disabled/.test(t.msg)),
      'abort (commit disabled): toasts an error explaining the button stayed disabled'
    );
  }

  console.log('\n--- abort: commit button absent entirely ---');
  {
    const radio = el('label', { text: 'Save & send to routine requests task list', label: 'Radio' });
    const assign = el('input', { attrs: { 'aria-label': 'Assign to' }, label: 'AssignInput' });
    const teamName = 'Prescribing / Meds Management';
    const option = el('li', { attrs: { id: 'select-item-1', role: 'option' }, text: teamName, label: 'TeamOption' });
    // No "Send to routine list" button anywhere on screen.
    const root = buildRoot([radio, assign, option]);
    const sb = makeSandbox(root, '/tasks/data/prescription-requests/overview/abc-123');
    await sb.runMacro(teamName, 'auto');
    check(CLICKS.indexOf('CommitBtn') === -1, 'abort (no commit control): nothing is clicked for the commit step');
    check(
      TOASTS.some((t) => t.kind === 'err' && /couldn.t find the .Send to routine list. button/.test(t.msg)),
      'abort (no commit control): toasts an error naming the missing commit control'
    );
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
