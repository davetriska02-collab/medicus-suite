// Medicus Suite — Practice features v2 (pack board + mute gates)
// Run with: node test-practice-features.js

'use strict';

const fs = require('fs');
const path = require('path');

const store = {};
const changeListeners = [];
global.chrome = {
  storage: {
    local: {
      async get(keys, cb) {
        const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
        const out = {};
        ks.forEach((k) => {
          if (k in store) out[k] = store[k];
        });
        if (typeof cb === 'function') cb(out);
        return out;
      },
      async set(obj, cb) {
        const changes = {};
        Object.keys(obj).forEach((k) => {
          changes[k] = { newValue: obj[k], oldValue: store[k] };
        });
        Object.assign(store, obj);
        changeListeners.forEach((fn) => fn(changes, 'local'));
        if (typeof cb === 'function') cb();
      },
    },
    onChanged: {
      addListener(fn) {
        changeListeners.push(fn);
      },
      removeListener(fn) {
        const i = changeListeners.indexOf(fn);
        if (i >= 0) changeListeners.splice(i, 1);
      },
    },
  },
};

function resetStore() {
  for (const k of Object.keys(store)) delete store[k];
}

delete require.cache[require.resolve('./shared/practice-packs.js')];
const Packs = require('./shared/practice-packs.js');

const { knowledgeImport } = require('./shared/io/knowledge-io.js');
const { receptionImport } = require('./shared/io/reception-io.js');
const { sentinelImport } = require('./shared/io/sentinel-io.js');
const { submissionsImport } = require('./shared/io/submissions-io.js');
const { slotCounterImport } = require('./shared/io/slot-counter-io.js');
const { capacityImport } = require('./shared/io/capacity-io.js');
const { referralsImport } = require('./shared/io/referrals-io.js');
const { requestMonitorImport } = require('./shared/io/request-monitor-io.js');
const TriageAlertIO = require('./shared/io/triage-alert-io.js');
const KnowledgeUtils = require('./shared/knowledge-utils.js');
const { problemDescriptionCleanupImport } = require('./shared/io/problem-description-cleanup-io.js');
global.knowledgeImport = knowledgeImport;
global.receptionImport = receptionImport;
global.sentinelImport = sentinelImport;
global.submissionsImport = submissionsImport;
global.slotCounterImport = slotCounterImport;
global.capacityImport = capacityImport;
global.referralsImport = referralsImport;
global.requestMonitorImport = requestMonitorImport;
global.TriageAlertIO = TriageAlertIO;
global.KnowledgeUtils = KnowledgeUtils;
global.problemDescriptionCleanupImport = problemDescriptionCleanupImport;
global.chrome.runtime = {
  getURL: (p) => `chrome-extension://test/${p}`,
  getManifest: () => ({ version: '3.261.15' }),
};
global.chrome.notifications = { create: () => {} };

const PP = require('./shared/io/practice-profile.js');
const suiteIo = require('./shared/io/suite-io.js');
const suiteEnv = require('./shared/io/suite-envelope.js');

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

function makeProfile(over = {}) {
  return Object.assign(
    {
      format: 'medicus-suite-practice-profile',
      profileVersion: 'v1.0',
      generatedAt: '2026-09-09T00:00:00Z',
      generatedBy: { name: 'test', email: 'test@example.com' },
      suiteVersion: '3.261.15',
      apply: { modules: {} },
      envelope: { modules: {} },
    },
    over
  );
}

const NEW_PACKS = [
  { suffix: 'ui.allocateCanvases', key: 'suite.ui.allocateCanvases', alias: 'allocateCanvases' },
  { suffix: 'ui.contactsCanvas', key: 'suite.ui.contactsCanvas', alias: 'contactsCanvas' },
  { suffix: 'ui.routineRxButton', key: 'suite.ui.routineRxButton', alias: 'routineRxButton' },
  { suffix: 'ui.quickActionsWidget', key: 'suite.ui.quickActionsWidget', alias: 'quickActionsWidget' },
];

(async () => {
  console.log('--- practice-packs: opt-in vs grandfather ---');
  check(Packs.isEnabled(Packs.KEYS.softFlags, undefined) === false, 'softFlags missing === OFF');
  check(Packs.isEnabled(Packs.KEYS.softFlags, false) === false, 'softFlags false === OFF');
  check(Packs.isEnabled(Packs.KEYS.softFlags, true) === true, 'softFlags true === ON');
  NEW_PACKS.forEach((p) => {
    check(Packs.isEnabled(p.key, undefined) === true, `${p.key} missing === ON (grandfather)`);
    check(Packs.isEnabled(p.key, false) === false, `${p.key} explicit false === OFF`);
    check(Packs.isEnabled(p.key, true) === true, `${p.key} explicit true === ON`);
  });

  console.log('\n--- materializeGrandfather writes explicit true once ---');
  resetStore();
  const wrote = await Packs.materializeGrandfather();
  NEW_PACKS.forEach((p) => {
    check(wrote[p.key] === true && store[p.key] === true, `first load materialises ${p.key}=true`);
  });
  check(store['suite.signing.softFlags'] === undefined, 'materialize does not touch softFlags');
  const wroteAgain = await Packs.materializeGrandfather();
  check(Object.keys(wroteAgain).length === 0, 'second load does not rewrite explicit booleans');
  store['suite.ui.allocateCanvases'] = false;
  const afterOff = await Packs.materializeGrandfather();
  check(
    store['suite.ui.allocateCanvases'] === false && !afterOff['suite.ui.allocateCanvases'],
    'materialize never overwrites an explicit false'
  );

  console.log('\n--- allow-list: unknown ignored; extras unread ---');
  resetStore();
  const extras = {
    display: { theme: 'dark' },
    hiddenTabs: ['signing'],
    practiceAcceptedAt: '2026-01-01T00:00:00Z',
    'ui.labFile': true,
    'ui.unknownPack': true,
    labFile: true,
  };
  await PP.applyProfile(
    makeProfile({
      profileVersion: 'pf-allow-1',
      apply: { modules: { suite: 'replace' } },
      envelope: {
        modules: {
          suite: {
            'ui.allocateCanvases': true,
            ...extras,
          },
        },
      },
    })
  );
  check(store['suite.ui.allocateCanvases'] === true, 'known pack writes suite.ui.allocateCanvases');
  check(store['suite.ui.labFile'] === undefined, 'unknown ui.labFile ignored');
  check(store['suite.ui.unknownPack'] === undefined, 'unknown ui.unknownPack ignored');
  check(store['suite.practiceAcceptedAt'] === undefined, 'practiceAcceptedAt unread from pack apply');
  check(store['suite.hiddenTabs'] === undefined, 'hiddenTabs unread from pack apply');
  check(store['suite.display'] === undefined, 'display unread from pack apply');

  console.log('\n--- sticky-on merge + replace may write false ---');
  for (const p of NEW_PACKS) {
    resetStore();
    store[p.key] = true;
    await PP.applyProfile(
      makeProfile({
        profileVersion: `pf-sticky-off-${p.suffix}`,
        apply: { modules: { suite: 'merge' } },
        envelope: { modules: { suite: { [p.suffix]: false } } },
      })
    );
    check(store[p.key] === true, `sticky-on: local true survives incoming false (${p.key})`);

    resetStore();
    store[p.key] = false;
    await PP.applyProfile(
      makeProfile({
        profileVersion: `pf-sticky-on-${p.suffix}`,
        apply: { modules: { suite: 'merge' } },
        envelope: { modules: { suite: { [p.alias]: true } } },
      })
    );
    check(store[p.key] === true, `sticky-on: incoming true turns local off on (${p.key})`);

    resetStore();
    await PP.applyProfile(
      makeProfile({
        profileVersion: `pf-gf-miss-${p.suffix}`,
        apply: { modules: { suite: 'merge' } },
        envelope: { modules: { suite: { [p.suffix]: false } } },
      })
    );
    check(store[p.key] === undefined, `sticky-on: merge false does not mute grandfather-missing (${p.key})`);

    resetStore();
    store[p.key] = true;
    await PP.applyProfile(
      makeProfile({
        profileVersion: `pf-rep-${p.suffix}`,
        apply: { modules: { suite: 'replace' } },
        envelope: { modules: { suite: { [p.suffix]: false } } },
      })
    );
    check(store[p.key] === false, `replace: may write false (${p.key})`);
  }

  console.log('\n--- Accept never enables packs; packs never set Accept ---');
  resetStore();
  store['suite.practiceAcceptedAt'] = '2026-06-01T09:00:00Z';
  store['suite.ui.allocateCanvases'] = false;
  await PP.applyProfile(
    makeProfile({
      profileVersion: 'pf-accept-sep-1',
      apply: { modules: { suite: 'replace' } },
      envelope: {
        modules: {
          suite: {
            'ui.allocateCanvases': true,
            'ui.contactsCanvas': true,
            practiceAcceptedAt: '2099-01-01T00:00:00Z',
          },
        },
      },
    })
  );
  check(store['suite.ui.allocateCanvases'] === true, 'pack on writes allocateCanvases');
  check(store['suite.ui.contactsCanvas'] === true, 'pack on writes contactsCanvas');
  check(store['suite.practiceAcceptedAt'] === '2026-06-01T09:00:00Z', 'pack apply leaves practiceAcceptedAt');

  resetStore();
  NEW_PACKS.forEach((p) => {
    store[p.key] = false;
  });
  store['suite.signing.softFlags'] = false;
  await PP.applyProfile(
    makeProfile({
      profileVersion: 'pf-accept-sep-2',
      apply: { modules: {} },
      practiceAttestation: {
        attestedBy: 'cso@gp.nhs.uk',
        attestedAt: '2026-06-02T08:00:00Z',
        gates: { reception: true, alertLibrary: true },
      },
      envelope: { modules: {} },
    })
  );
  check(store['suite.signing.softFlags'] === false, 'Accept/attestation does not enable softFlags');
  NEW_PACKS.forEach((p) => {
    check(store[p.key] === false, `Accept/attestation does not enable ${p.key}`);
  });

  console.log('\n--- suiteImport is not the practice-profile apply path ---');
  const ppSrc = fs.readFileSync(path.join(__dirname, 'shared/io/practice-profile.js'), 'utf8');
  const ppCode = ppSrc.replace(/\/\/.*$/gm, '');
  check(!/suiteImport\s*\(/.test(ppCode), 'applyProfile does not call suiteImport()');
  const allowList = (ppSrc.match(/const ALLOWED_SUITE_KEYS = \[([^\]]+)\]/) || [])[1] || '';
  check(/'signing\.softFlags'/.test(allowList), 'allow-list includes signing.softFlags');
  check(/'ui\.allocateCanvases'/.test(allowList), 'allow-list includes ui.allocateCanvases');
  check(/'ui\.contactsCanvas'/.test(allowList), 'allow-list includes ui.contactsCanvas');
  check(/'ui\.routineRxButton'/.test(allowList), 'allow-list includes ui.routineRxButton');
  check(/'ui\.quickActionsWidget'/.test(allowList), 'allow-list includes ui.quickActionsWidget');
  check(!/practiceAcceptedAt/.test(allowList), 'practiceAcceptedAt is not on the pack allow-list');
  check(!/hiddenTabs/.test(allowList), 'hiddenTabs is not on the pack allow-list');

  console.log('\n--- suite-io backup uses the same keys (not a second door) ---');
  resetStore();
  await suiteIo.suiteImport({
    allocateCanvases: true,
    contactsCanvas: false,
    routineRxButton: true,
    quickActionsWidget: false,
  });
  check(store['suite.ui.allocateCanvases'] === true, 'suiteImport writes suite.ui.allocateCanvases');
  check(store['suite.ui.contactsCanvas'] === false, 'suiteImport writes suite.ui.contactsCanvas');
  const exp = await suiteIo.suiteExport();
  check(exp.allocateCanvases === true && exp.contactsCanvas === false, 'suiteExport round-trips pack aliases');
  let packErr = null;
  try {
    await suiteIo.suiteImport({ allocateCanvases: 'yes' });
  } catch (e) {
    packErr = e.message;
  }
  check(packErr && packErr.includes('boolean'), 'suiteImport rejects non-boolean allocateCanvases');
  const preview = suiteEnv.previewEnvelope(
    suiteEnv.wrap('suite', { suite: { allocateCanvases: true, contactsCanvas: true } })
  );
  check(
    preview.some((l) => /Allocate/.test(l)) && preview.some((l) => /Contacts/.test(l)),
    'previewEnvelope mentions chrome packs when ON'
  );

  console.log('\n--- Options board: one screen, CSS toggles, same-key mirrors ---');
  const optionsHtml = fs.readFileSync(path.join(__dirname, 'options/options.html'), 'utf8');
  const optionsJs = fs.readFileSync(path.join(__dirname, 'options/options.js'), 'utf8');
  const signingSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/signing/signing.js'), 'utf8');
  const signingCss = fs.readFileSync(path.join(__dirname, 'side-panel/modules/signing/signing.css'), 'utf8');
  check(/id="sect-practice-features"/.test(optionsHtml), 'Practice features section exists');
  check(/id="pfSoftFlags"/.test(optionsHtml), 'softFlags lives on the practice board');
  check(/id="pfAllocateCanvases"/.test(optionsHtml), 'allocate pack lives on the practice board');
  check(/id="pfContactsCanvas"/.test(optionsHtml), 'contacts pack lives on the practice board');
  check(/id="pfRoutineRxButton"/.test(optionsHtml), 'routine-Rx pack lives on the practice board');
  check(/id="pfQuickActionsWidget"/.test(optionsHtml), 'quick-actions pack lives on the practice board');
  check(/id="signingSoftFlags"/.test(optionsHtml), 'Suite still mirrors softFlags (same key)');
  check(/id="sgSoftFlags"/.test(signingSrc), 'Signing Queue still mirrors softFlags (same key)');
  check(!/id="signingAllocateCanvases"/.test(optionsHtml), 'new packs are not mirrored on Suite');
  check((optionsHtml.match(/class="suite-toggle"/g) || []).length >= 6, 'Practice + Suite use suite-toggle switches');
  check(
    /\.suite-toggle-track/.test(optionsHtml) && /\.suite-toggle-track/.test(signingCss),
    'Suite + Signing share the stealth-switch track tokens'
  );
  check(/sg-soft-toggle:has\(input:checked\)/.test(signingCss), 'Signing armed colour matches the board station');
  check(/role="switch"/.test(optionsHtml) && /role="switch"/.test(signingSrc), 'switches expose role=switch');
  check(/Accept for practice stays separate/.test(optionsHtml), 'Accept copy sits above the fold on the board');
  check(/sticky-on/.test(optionsHtml) && /Suite replace/.test(optionsHtml), 'one briefing strip documents sticky-on + replace');
  check(
    (optionsHtml.match(/Accept for practice does not enable this pack/g) || []).length === 0,
    'pack stations do not repeat the Accept essay'
  );
  check(/\.pf-station:has\(input:checked\)/.test(optionsHtml), 'armed station paints when the switch is on');
  check(/inset 4px 0 0 var\(--accent\)/.test(optionsHtml), 'armed station uses the Suite accent rail');
  check(/class="pf-deck"/.test(optionsHtml) && /class="pf-station"/.test(optionsHtml), 'board is a compact station deck');
  check(
    /PRACTICE_PACK_TOGGLES/.test(optionsJs) && /bindPracticePackToggle/.test(optionsJs),
    'Options binds each pack toggle to its storage key'
  );
  check(/materializeGrandfather/.test(optionsJs), 'Options first load materialises grandfather keys');
  const acceptFn = optionsJs.match(
    /async function acceptForPractice\(\)[\s\S]*?\nasync function withdrawPracticeAcceptance/
  );
  check(
    !!acceptFn &&
      !/allocateCanvases/.test(acceptFn[0]) &&
      !/contactsCanvas/.test(acceptFn[0]) &&
      !/routineRxButton/.test(acceptFn[0]) &&
      !/quickActionsWidget/.test(acceptFn[0]) &&
      !/signing\.softFlags/.test(acceptFn[0]),
    'tick Accept does not write any pack key'
  );
  check(
    !/chrome\.storage\.local\.set\(\{[^}]*practiceAcceptedAt[^}]*allocateCanvases/.test(optionsJs) &&
      !/chrome\.storage\.local\.set\(\{[^}]*softFlags[^}]*practiceAcceptedAt/.test(optionsJs),
    'pack toggles do not set practiceAcceptedAt'
  );

  console.log('\n--- mute no-ops: injectors check pack key and tear down ---');
  const injectors = [
    ['content-scripts/lab-allocate-canvas.js', 'suite.ui.allocateCanvases', 'muteAllocateChrome'],
    ['content-scripts/workflow-allocate-canvas.js', 'suite.ui.allocateCanvases', 'muteAllocateChrome'],
    ['content-scripts/rx-allocate-canvas.js', 'suite.ui.allocateCanvases', 'muteAllocateChrome'],
    ['content-scripts/request-allocate-canvas.js', 'suite.ui.allocateCanvases', 'muteAllocateChrome'],
    ['content-scripts/appointment-organise-canvas.js', 'suite.ui.allocateCanvases', 'muteAllocateChrome'],
    ['content-scripts/contacts-canvas.js', 'suite.ui.contactsCanvas', 'closeOverlay'],
    ['content-scripts/contacts-link-button.js', 'suite.ui.contactsCanvas', 'removeWidget'],
    ['content-scripts/triage-lens/routine-rx-button.js', 'suite.ui.routineRxButton', 'removeHost'],
    ['content-scripts/reception-quick-actions.js', 'suite.ui.quickActionsWidget', 'removeWidget'],
  ];
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(/shared\/practice-packs\.js/.test(manifest), 'practice-packs.js is in the manifest');
  injectors.forEach(([file, key, mute]) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    check(src.includes(key), `${file} reads ${key}`);
    check(src.includes('bindInjector') || src.includes('if (!_packOn)'), `${file} gates on pack state`);
    check(src.includes(mute), `${file} tears down with ${mute} when muted`);
    check(!/chrome\.scripting\.unregisterContentScripts/.test(src), `${file} does not unregister MV3 content_scripts`);
  });
  check(!/chrome\.scripting\.unregisterContentScripts/.test(optionsJs), 'Options never unregisters content_scripts');
  check(
    !/whole extension off|disable the extension|unregister all content/.test(optionsHtml),
    'board never claims the whole extension is off'
  );

  const forbiddenMute = [
    'content-scripts/page-world.js',
    'engine/rules-engine.js',
    'content-scripts/patient-alerts-banner.js',
    'content-scripts/triage-lens/lab-file-button.js',
  ];
  forbiddenMute.forEach((file) => {
    if (!fs.existsSync(path.join(__dirname, file))) return;
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    check(
      !/suite\.ui\.(allocateCanvases|contactsCanvas|routineRxButton|quickActionsWidget)/.test(src),
      `${file} is not gated by a chrome pack`
    );
  });

  console.log('\n--- no dual doors / no config-bag reuse ---');
  const rxSrc = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/routine-rx-button.js'), 'utf8');
  check(
    /suite\.ui\.routineRxButton/.test(rxSrc) && /triagelens\.routineRx/.test(rxSrc),
    'routine-Rx pack is the button inject, not the config bag'
  );
  const qaSrc = fs.readFileSync(path.join(__dirname, 'content-scripts/reception-quick-actions.js'), 'utf8');
  check(
    /suite\.ui\.quickActionsWidget/.test(qaSrc) && /triagelens\.quickActions/.test(qaSrc),
    'quick-actions widget pack is a separate key from the phrase list'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
