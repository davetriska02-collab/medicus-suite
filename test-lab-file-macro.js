// Medicus Suite — Lab Filing execution-macro tests
// Run with: node test-lab-file-macro.js
//
// The live Medicus filing-screen DOM is not available here, so the macro's
// DOM-driving core (fileAllNormal) is exercised against a small fake DOM. These
// assert the SAFETY behaviours that matter:
//   • never acts unless severity is level:'none'
//   • aborts (clicks nothing) when the File control or the normal options the
//     profile names are absent
//   • 'manual' mode marks options but never files; 'confirm' files only on OK,
//     and a cancelled confirm files nothing
//   • files only AFTER marking subheadings, then completes
//   • prepares (never sends) the patient message

'use strict';

const { fileAllNormal } = require('./content-scripts/triage-lens/lab-file-button.js');
const LF = require('./shared/lab-filing-utils.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── minimal fake DOM ──────────────────────────────────────────────────────────
let CLICKS = [];
class El {
  constructor(spec) {
    this.tag = (spec.tag || 'div').toLowerCase();
    this.role = spec.role || null;
    this.type = spec.type || null;
    this.classes = spec.classes || [];
    this.contenteditable = spec.contenteditable || null;
    this.ariaLabel = spec.ariaLabel || null;
    this.ariaChecked = spec.ariaChecked || null;
    this.placeholder = spec.placeholder || null;
    this.textContent = spec.text || '';
    this.value = '';
    this.disabled = !!spec.disabled;
    this.label = spec.label || spec.text || ''; // for readability
    this.classList = { contains: (c) => this.classes.includes(c) };
    this.style = {};
  }
  getAttribute(name) {
    if (name === 'aria-label') return this.ariaLabel;
    if (name === 'aria-checked') return this.ariaChecked;
    if (name === 'aria-disabled') return this.disabled ? 'true' : null;
    if (name === 'placeholder') return this.placeholder;
    if (name === 'role') return this.role;
    if (name === 'contenteditable') return this.contenteditable;
    return null;
  }
  matches(sel) {
    sel = sel.trim();
    if (sel === this.tag) return true;
    if (sel.startsWith('.')) return this.classes.includes(sel.slice(1));
    let m = sel.match(/^\[role="(.+)"\]$/);
    if (m) return this.role === m[1];
    m = sel.match(/^input\[type="(.+)"\]$/);
    if (m) return this.tag === 'input' && this.type === m[1];
    m = sel.match(/^\[contenteditable="(.+)"\]$/);
    if (m) return this.contenteditable === m[1];
    return false;
  }
  click() {
    CLICKS.push(this.label || this.textContent);
    if (this.role === 'radio' || (this.classes || []).includes('q-radio')) this.ariaChecked = 'true';
    if (typeof this.onClick === 'function') this.onClick();
  }
  dispatchEvent() {}
}
class Root {
  constructor(els) {
    this.els = els;
  }
  querySelectorAll(sel) {
    return this.els.filter((e) => e.matches(sel));
  }
}

const vis = () => true;
const immediateWait = async (fn) => fn(); // single attempt
const baseOpts = (over) =>
  Object.assign(
    {
      visible: vis,
      waitForFn: immediateWait,
      clickFn: (el) => el.click(),
      setValueFn: (el, v) => {
        el.value = v;
      },
      confirmFn: () => true,
      buildMessage: LF.fillTemplate,
      buildConfirm: LF.buildFilingConfirmMessage,
      mode: 'confirm',
      severity: { level: 'none' },
      report: { results: [{ name: 'Haemoglobin' }, { name: 'Sodium' }] },
      patient: 'Smith, John',
    },
    over
  );

const profile = {
  name: 'Test profile',
  filing: { normalOptionText: 'No action required', fileButtonText: 'File', completeButtonText: 'Complete' },
  patientMessage: { enabled: false, template: 'Dear {firstName}, normal.' },
  commitMode: 'confirm',
};

function normalScreen() {
  return [
    new El({ tag: 'button', text: 'File', label: 'FileBtn' }),
    new El({ tag: 'button', text: 'Complete', label: 'CompleteBtn' }),
    new El({ role: 'radio', text: 'No action required', label: 'opt1' }),
    new El({ role: 'radio', text: 'No action required', label: 'opt2' }),
    new El({ role: 'radio', text: 'No action required', label: 'opt3' }),
  ];
}

(async () => {
  // 1. severity gate
  console.log('--- severity gate ---');
  CLICKS = [];
  let res = await fileAllNormal(baseOpts({ root: new Root(normalScreen()), profile, severity: { level: 'amber' } }));
  check(res.ok === false && res.reason === 'not-normal', 'refuses when severity is not none');
  check(CLICKS.length === 0, 'nothing clicked when not all-normal');

  // 1b. fail-closed blockers (free text / unmatched / no rules) — even at level none
  console.log('\n--- fail-closed blockers ---');
  CLICKS = [];
  res = await fileAllNormal(
    baseOpts({ root: new Root(normalScreen()), profile, blockers: ['contains a free-text result'] })
  );
  check(res.ok === false && res.reason === 'blocked', 'refuses when fail-closed blockers are present');
  check(CLICKS.length === 0, 'nothing clicked when blocked');

  // 2. happy path, confirm = OK
  console.log('\n--- confirm mode, all normal ---');
  CLICKS = [];
  res = await fileAllNormal(baseOpts({ root: new Root(normalScreen()), profile }));
  check(res.ok === true && res.filed === true, 'files when all normal and confirmed');
  check(res.marked === 3, 'marked all three subheadings normal');
  check(res.completed === true, 'completed the task');
  check(CLICKS.indexOf('FileBtn') > CLICKS.lastIndexOf('opt3'), 'File clicked AFTER marking subheadings');
  check(CLICKS[CLICKS.length - 1] === 'CompleteBtn', 'Complete clicked last');

  // 3. manual mode
  console.log('\n--- manual mode ---');
  CLICKS = [];
  res = await fileAllNormal(baseOpts({ root: new Root(normalScreen()), profile, mode: 'manual' }));
  check(res.reason === 'manual-ready' && res.filed === false, 'manual mode marks but does not file');
  check(res.marked === 3, 'manual mode still marked the subheadings');
  check(CLICKS.indexOf('FileBtn') === -1, 'manual mode never clicks File');

  // 4. cancelled confirm
  console.log('\n--- cancelled confirm ---');
  CLICKS = [];
  res = await fileAllNormal(baseOpts({ root: new Root(normalScreen()), profile, confirmFn: () => false }));
  check(res.reason === 'cancelled' && res.filed === false, 'cancelled confirm files nothing');
  check(CLICKS.indexOf('FileBtn') === -1, 'cancelled confirm never clicks File');

  // 5. missing File control
  console.log('\n--- missing File control ---');
  CLICKS = [];
  const noFile = normalScreen().filter((e) => e.label !== 'FileBtn');
  res = await fileAllNormal(baseOpts({ root: new Root(noFile), profile }));
  check(res.reason === 'no-file-button', 'aborts when File control absent');
  check(CLICKS.length === 0, 'nothing clicked when File control absent');

  // 6. profile labels do not match any option
  console.log('\n--- normal option label mismatch ---');
  CLICKS = [];
  const wrongLabels = [
    new El({ tag: 'button', text: 'File', label: 'FileBtn' }),
    new El({ role: 'radio', text: 'Something else entirely', label: 'optX' }),
  ];
  res = await fileAllNormal(baseOpts({ root: new Root(wrongLabels), profile }));
  check(res.reason === 'no-normal-controls', 'aborts when the normal option label is not on screen');
  check(CLICKS.indexOf('FileBtn') === -1, 'does not file when no subheading could be marked');

  // 7. openControlText (per-row menu) path
  console.log('\n--- per-row menu (openControlText) ---');
  CLICKS = [];
  const menuProfile = {
    name: 'Menu profile',
    filing: { normalOptionText: 'No action required', openControlText: 'Select action', fileButtonText: 'File' },
    patientMessage: { enabled: false },
    commitMode: 'confirm',
  };
  const menuScreen = [
    new El({ tag: 'button', text: 'File', label: 'FileBtn' }),
    new El({ tag: 'button', text: 'Select action', label: 'menu1' }),
    new El({ tag: 'button', text: 'Select action', label: 'menu2' }),
    new El({ role: 'option', text: 'No action required', label: 'opt' }),
  ];
  res = await fileAllNormal(baseOpts({ root: new Root(menuScreen), profile: menuProfile }));
  check(res.marked === 2 && res.filed === true, 'opens each per-row menu and selects the normal option');
  check(CLICKS.indexOf('menu1') !== -1 && CLICKS.indexOf('menu2') !== -1, 'clicked each row menu opener');

  // 8. patient message prepared, never sent
  console.log('\n--- patient message (prepare only) ---');
  CLICKS = [];
  const msgProfile = {
    name: 'Msg profile',
    filing: { normalOptionText: 'No action required', fileButtonText: 'File' },
    patientMessage: { enabled: true, template: 'Dear {firstName}, all normal.', fieldText: 'Message' },
    commitMode: 'confirm',
  };
  const msgField = new El({ tag: 'textarea', ariaLabel: 'Message', label: 'msgField' });
  const msgScreen = normalScreen().concat([msgField]);
  res = await fileAllNormal(baseOpts({ root: new Root(msgScreen), profile: msgProfile }));
  check(res.preparedMessage === 'Dear John, all normal.', 'prepares message with {firstName} filled');
  check(msgField.value === 'Dear John, all normal.', 'pre-fills the named message field');
  check(res.filed === true, 'still files the result alongside preparing the message');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
