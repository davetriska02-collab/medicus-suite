// Medicus Suite — Options information architecture (labels, anchors, default honesty)
// Run with: node test-options-ia.js
//
// Source-greps options/ only. Does not change clinical thresholds or storage defaults.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

const html = fs.readFileSync(path.join(__dirname, 'options/options.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'options/options.js'), 'utf8');

function inputTag(id) {
  const re = new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`);
  const m = html.match(re);
  return m ? m[0] : '';
}

console.log('\n--- find bar and in-page anchors ---');
check(/aria-label="Find a setting"/.test(html), 'find bar is labelled');
check(/href="#sect-request-monitor"/.test(html), 'find bar links to Request Monitor');
check(/href="#sect-quiet-mode"/.test(html), 'find bar links to Quiet mode');
check(/href="#sect-sentinel"/.test(html), 'find bar links to Monitoring chips');
check(/href="#sect-practice-profile"/.test(html), 'find bar links to the practice profile');
check(/href="#sect-practice-features"/.test(html), 'find bar links to Practice features');
check(/id="sect-request-monitor"/.test(html), 'Request Monitor has an in-page anchor');
check(/id="sect-quiet-mode"/.test(html), 'Quiet mode has an in-page anchor');
check(/id="sect-practice-profile"/.test(html), 'Practice profile has an in-page anchor');
check(
  /IN_PAGE_ANCHORS\s*=\s*\{[\s\S]*?'request-monitor':\s*'suite'[\s\S]*?'quiet-mode':\s*'notifications'[\s\S]*?'practice-profile':\s*'backup'/.test(
    js
  ),
  'hash deep-links open the parent section for the three buried anchors'
);
check(
  !/href="#sect-(today|board|note|tally)/.test(html),
  'find bar does not reintroduce Today, Note TV, or the appointment tally'
);

console.log('\n--- queue chips that ship off: named path and anchor ---');
check(
  /Options → Triage Lens → Baseline chips → Queue/.test(html),
  'the off queue-chip control keeps the #461 path name'
);
check(/id="sect-baseline-chips-queue"/.test(html), 'suite page has a stable anchor for that path');
check(/href="#sect-baseline-chips-queue"/.test(html), 'find bar and the section link to that anchor');
check(
  /'baseline-chips-queue':\s*'queue'/.test(js),
  'the suite hash opens Queue rules, which hosts the Triage Lens iframe'
);
check(/pointTriageFrame\('baseline-chips-queue'\)/.test(js), 'the suite hash points the iframe at the same anchor');
const triageJs = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/options.js'), 'utf8');
check(
  /row\.id = 'baseline-chips-queue'/.test(triageJs) && /meta\.id === 'queue\.monitoringDueRed'/.test(triageJs),
  'the anchor sits on the queue monitoring row that ships off'
);
check(/location\.hash === '#baseline-chips-queue'/.test(triageJs), 'the iframe opens Baseline chips for that hash');
check(/activateTab\('systemChips'\)/.test(triageJs), 'that hash selects the Baseline chips tab');
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8'));
check(defaults.systemChips['queue.monitoringDueRed'].enabled === false, 'queue.monitoringDueRed still ships off');
check(defaults.systemChips['queue.monitoringDueAmber'].enabled === false, 'queue.monitoringDueAmber still ships off');

console.log('\n--- Request Monitor: name, off-by-default, 5-minute poll ---');
check(/<h2[^>]*>Request Monitor<\/h2>/.test(html), 'heading says Request Monitor');
check(!/Triage request monitor/.test(html), 'old "Triage request monitor" heading is gone');
check(/Enable Request Monitor/.test(html), 'enable control uses the Request Monitor name');
check(/Off by default\./.test(html), 'Request Monitor states that it is off by default');
const rmEnabled = inputTag('rmEnabled');
check(rmEnabled && !/\bchecked\b/.test(rmEnabled), 'Request Monitor checkbox is not checked in the markup');
check(
  /id="rmPollSeconds"[\s\S]*?min="120"[\s\S]*?max="600"[\s\S]*?placeholder="300"[\s\S]*?value="300"/.test(html),
  'poll field shows the shipped default of 300 seconds, minimum 120, maximum 600'
);
check(/Default 300 \(5 minutes\)/.test(html), 'helper copy still says the default poll is 300 seconds (5 minutes)');
check(/pollSeconds < 120\) pollSeconds = 300/.test(js), 'save path still falls back to 300 seconds below the minimum');

console.log('\n--- Quiet mode keeps the clinic-mode safety sentence ---');
check(/<h2[^>]*>Quiet mode<\/h2>/.test(html), 'heading says Quiet mode');
check(/Also called clinic mode/.test(html), 'quiet mode names the clinic-mode alias');
check(
  /Clinic mode silences desktop pop-ups and sounds only\. On-screen strips, badges and clinical alerts in the\s+patient record are never muted\./.test(
    html
  ),
  'H-028 boundary sentence is unchanged'
);
check(/id="quietBtn30m"/.test(html) && /id="quietBtn1h"/.test(html), 'quiet duration button ids are unchanged');
check(
  /id="quietBtnUntil18"/.test(html) && /id="quietBtnOff"/.test(html),
  'until-18:00 and off button ids are unchanged'
);
check(/Quiet for 30 min/.test(html) && /Turn quiet off/.test(html), 'quiet buttons say what they do');

console.log('\n--- monitoring chips and notification defaults ---');
check(/Monitoring chips/.test(html), 'channel row is named Monitoring chips');
check(!/>Sentinel chips</.test(html), 'the channel row no longer says only Sentinel chips');
check(/quiet mode does not\s+hide them/.test(html), 'monitoring chips say quiet mode does not hide them');
check(/This table cannot turn them off/.test(html), 'the notifications table does not claim a chip master switch');
const desktop = inputTag('notifDesktopEnabled');
const sound = inputTag('notifSoundEnabled');
const badge = inputTag('notifBadgeEnabled');
check(desktop && !/\bchecked\b/.test(desktop), 'desktop notifications start unchecked');
check(sound && !/\bchecked\b/.test(sound), 'notification sound starts unchecked');
check(badge && /\bchecked\b/.test(badge), 'toolbar badge starts checked (on unless turned off)');
check(/rmCfg\.notifyEnabled === true/.test(js), 'desktop notifications fail closed when config is missing');
check(/rmCfg\.notifySound === true/.test(js), 'notification sound fails closed when config is missing');
check(/badgeEnabled !== false/.test(js), 'toolbar badge still defaults on');

console.log('\n--- practice packs: honest first paint ---');
check(/Signing Queue\s+flags start off/.test(html), 'practice-features brief says Signing Queue flags start off');
check(/Accept for practice stays separate/.test(html), 'Accept-for-practice stays a separate switch');
check(/sticky-on/.test(html) && /Suite replace/.test(html), 'sticky-on and Suite replace briefing is still there');
const softSuite = inputTag('signingSoftFlags');
const softBoard = inputTag('pfSoftFlags');
check(softSuite && !/\bchecked\b/.test(softSuite), 'Suite Signing Queue flags start unchecked');
check(softBoard && !/\bchecked\b/.test(softBoard), 'Practice features Signing Queue flags start unchecked');
['pfAllocateCanvases', 'pfContactsCanvas', 'pfRoutineRxButton', 'pfQuickActionsWidget', 'pfFocusAlerts'].forEach(
  (id) => {
    const tag = inputTag(id);
    check(tag && /\bchecked\b/.test(tag), `${id} starts checked (grandfathered on)`);
  }
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
