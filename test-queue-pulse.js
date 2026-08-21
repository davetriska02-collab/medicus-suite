// Queue pulse composer — named-signal compression (not a score).
// Run with: node test-queue-pulse.js
'use strict';

const fs = require('fs');
const path = require('path');
const { composePulse, isContextOnly } = require('./content-scripts/triage-lens/queue-pulse.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const rule = (kind, name) => ({ kind, name, family: 'rule', source: 'request' });
const mon = (kind, name) => ({ kind, name, family: 'monitoring', silent: true });
const pending = (kind, name) => ({ kind, name, family: 'pending', silent: true });
const age = (name) => ({ kind: 'amber', name, family: 'age', source: 'dob' });
const pf = () => ({ kind: 'green', name: 'Pharmacy First', family: 'pf' });
const ask = () => ({ kind: 'info', name: 'Ask-back', family: 'askback' });
const repeat = (name) => ({ kind: 'amber', name, family: 'repeat' });

console.log('Layer 1: composePulse ranking');

{
  const p = composePulse([age('Child · 7y'), rule('red', 'MH crisis'), repeat('2nd contact · 6d')]);
  check(p.rail === 'red', 'rail is red when a request-text red exists');
  check(p.headline && p.headline.name === 'MH crisis', 'headline names the red rule, not age or thread');
  check(p.overflowCount === 2, 'age + thread sit in overflow, not dropped');
  check(p.silent === false, 'request-text headline is not marked silent');
}

{
  const p = composePulse([mon('red', 'MTX · FBC overdue'), age('Elder · 72y')]);
  check(p.rail === 'red', 'record-only red still owns the rail');
  check(p.headline && p.headline.name === 'MTX · FBC overdue', 'silent monitoring can be the headline');
  check(p.silent === true, 'diamond: headline came from the record');
}

{
  const p = composePulse([rule('red', 'Chest pain'), mon('red', 'MTX · FBC overdue')]);
  check(p.headline && p.headline.family === 'rule', 'same-kind: request-text preferred over record');
  check(p.silent === false, 'preferred request-text headline is not silent');
}

{
  const p = composePulse([pf(), ask(), age('34y')]);
  check(p.rail === 'empty', 'Pharmacy First / age do not raise the rail');
  check(p.headline && p.headline.name === 'Ask-back', 'ask-back may headline when nothing clinical-worse fired');
}

{
  const p = composePulse([repeat('4th contact · 10d'), pf()]);
  check(p.rail === 'empty', 'thread count alone does not raise the rail');
  check(p.headline === null, 'thread count is not a headline');
  check(p.thread && p.thread.name === '4th contact · 10d', 'thread is still returned for the mark');
}

{
  const p = composePulse([rule('amber', 'UTI words'), rule('red', 'Chest pain')]);
  check(p.headline.name === 'Chest pain', 'red outranks amber');
  check(p.rail === 'red', 'rail follows worst clinical kind');
}

{
  const p = composePulse([]);
  check(p.rail === 'empty', 'no signals → empty rail (not green, not a score)');
  check(p.headline === null, 'no signals → no headline');
}

{
  const p = composePulse([rule('red', 'MH crisis')], { recordChecked: false });
  check(p.rail === 'unchecked', 'recordChecked:false forces dashed rail even if a red exists');
}

{
  const p = composePulse(null);
  check(p.rail === 'empty' && p.signals.length === 0, 'null input fails closed to empty');
}

console.log('\nLayer 2: isContextOnly');
check(isContextOnly(age('Child')), 'age is context');
check(isContextOnly(pf()), 'Pharmacy First is context');
check(isContextOnly(repeat('3rd')), 'repeat-contact is context');
check(!isContextOnly(rule('red', 'MH crisis')), 'request rule is clinical');
check(!isContextOnly(mon('red', 'MTX')), 'monitoring is clinical (may own rail)');
check(!isContextOnly(pending('red', 'Pending K')), 'pending result is clinical');
check(!isContextOnly(ask()), 'ask-back is not context — it can headline');
check(isContextOnly({ kind: 'meta', name: '+2', family: 'rule' }), 'meta overflow chips are context');

console.log('\nLayer 3: wiring / safety greps');
const content = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/content.js'), 'utf8');
const hud = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/hud.css'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const options = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/options.html'), 'utf8');

check(/queue-pulse\.js/.test(manifest), 'manifest loads queue-pulse.js before content.js');
check(/queuePulseCompress/.test(content), 'content.js reads the pulse pref');
check(/data-pref="queuePulseCompress"/.test(options), 'options has a pulse checkbox');
check(/\.ch-q-pulse/.test(hud.split('{')[0]), 'hud.css token-block lists .ch-q-pulse');
check(/\.ch-q-why/.test(hud.split('{')[0]), 'hud.css token-block lists .ch-q-why');
check(/\.ch-q-act/.test(hud.split('{')[0]), 'hud.css token-block lists .ch-q-act');
check(
  /\.ch-queue-chips, \.ch-q-mon, \.ch-q-result, \.ch-q-pa, \.ch-q-pending, \.ch-q-repeat, \.ch-q-carry, \.ch-q-pulse/.test(
    content
  ),
  'refreshQueueChips wipe includes .ch-q-pulse'
);
check(/cl\.contains\('ch-q-pulse'\)/.test(content), 'observer self-write filter includes pulse');
check(/reapplyQueuePulses\(\)/.test(content), 'refreshQueueChips re-applies pulses after reinjects');
const actFn = content.match(/const buildPulseActTray = \([\s\S]*?\n  \};/);
check(!!actFn, 'buildPulseActTray found');
if (actFn) {
  check(
    !/\bDone\b|\bSent\b|\bBooked\b|\bSubmitted\b/.test(actFn[0]),
    'act tray copy-ban: no Done/Sent/Booked/Submitted'
  );
}
check(/Not a score/.test(content), 'why-tray footer refuses the score reading');
check(
  /composed\.rail === 'amber'/.test(content) && /ch-q-pulse-rail-ring/.test(content),
  'amber rail paints a hollow ring in the pulse chrome, not a second filled bar'
);
check(/\.ch-q-pulse-rail-ring/.test(hud.split('{')[0]), 'hud.css token-block lists the amber ring');
check(/\.ch-row-pulse-red \{[\s\S]*?inset 4px 0 0 0 var\(--red\)/.test(hud), 'red rail is still a filled inset bar');
check(
  /\.ch-row-pulse-amber \{\s*\/\* marker only/.test(hud) &&
    !/\.ch-row-pulse-amber \{[\s\S]*?box-shadow: inset/.test(hud),
  'amber marker class does not paint a filled bar (shape, not hue)'
);
check(/\.ch-q-pulse-rail-ring \{[\s\S]*?border-radius: 50%/.test(hud), 'amber ring is a hollow circle');
const applyFn = content.match(/const applyPulseRail = \([\s\S]*?\n  \};/);
check(!!applyFn, 'applyPulseRail found');
if (applyFn) {
  check(
    /rail !== 'red' && rail !== 'amber'/.test(applyFn[0]) && /PULSE_ON/.test(applyFn[0]),
    'empty rail does not hide chips (quiet row is not all-clear)'
  );
}
check(
  /escalate && composed\.headline/.test(content) && /escalate && composed\.thread/.test(content),
  'pulse compression chrome is escalate-only — quiet rows keep the chip pile'
);
check(/Nothing named matched/.test(content), 'empty why-tray refuses the all-clear reading');
const tintedFn = content.match(/const getQueueTintedRowIndexes = \(\) => \{[\s\S]*?\n  \};/);
check(!!tintedFn, 'getQueueTintedRowIndexes found');
if (tintedFn) {
  check(
    /PULSE_RED/.test(tintedFn[0]) && /PULSE_AMBER/.test(tintedFn[0]),
    'jump button / n key see pulse rails as red/amber alerts'
  );
}
check(
  /\.ch-q-focus-alerts[\s\S]{0,200}?:not\(\.ch-row-pulse-red\):not\(\.ch-row-pulse-amber\)/.test(hud) &&
    /\.ch-q-focus-alerts .ag-row:not\(\.ch-row-sev-red\):not\(\.ch-row-sev-amber\):not\(\.ch-row-pulse-red\):not\(\.ch-row-pulse-amber\)/.test(
      content
    ),
  'focus-alerts dim never fades a pulse-red/amber row (both CSS copies)'
);

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---\n');
if (failed > 0) process.exit(1);
