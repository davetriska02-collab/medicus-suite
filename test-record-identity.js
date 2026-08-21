// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Pins Record tab identity guards: never attach to chrome.tabs.query()[0]
// when the focused tab is not Medicus, and SMR pack nonce fail-closed.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

globalThis.chrome = {
  runtime: { onMessage: { addListener() {}, removeListener() {} } },
  tabs: { onActivated: null, onUpdated: null },
};

const TAB_CHOICE_URL = new URL('./shared/medicus-tab-choice.js', `file://${process.cwd()}/`).href;
const SMR_CORE_URL = new URL('./side-panel/modules/record/smr-pack-core.js', `file://${process.cwd()}/`).href;

describe('chooseMedicusTab', async () => {
  let chooseMedicusTab;
  const mod = await import(TAB_CHOICE_URL);
  chooseMedicusTab = mod.chooseMedicusTab;

  const medicusA = { id: 1, url: 'https://ab12.medicus.health/patient/aaa', lastAccessed: 10 };
  const medicusB = { id: 2, url: 'https://ab12.medicus.health/patient/bbb', lastAccessed: 99 };
  const gmail = { id: 3, url: 'https://mail.google.com/', lastAccessed: 50 };

  it('prefers the active Medicus tab', () => {
    const r = chooseMedicusTab({
      activeTab: medicusA,
      lastTab: medicusB,
      anyMedicusTabs: [medicusB, medicusA],
      isPopOut: false,
    });
    assert.equal(r.tab, medicusA);
    assert.equal(r.reason, 'active');
  });

  it('docked panel does not fall back to any[0] when Gmail is focused', () => {
    const r = chooseMedicusTab({
      activeTab: gmail,
      lastTab: null,
      anyMedicusTabs: [medicusB, medicusA],
      isPopOut: false,
    });
    assert.equal(r.tab, null);
    assert.equal(r.reason, 'none');
  });

  it('reuses the last successfully loaded Medicus tab when focus left Medicus', () => {
    const r = chooseMedicusTab({
      activeTab: gmail,
      lastTab: medicusA,
      anyMedicusTabs: [medicusB, medicusA],
      isPopOut: false,
    });
    assert.equal(r.tab, medicusA);
    assert.equal(r.reason, 'last');
  });

  it('pop-out fallback picks the most recently accessed Medicus tab, not query()[0]', () => {
    const r = chooseMedicusTab({
      activeTab: gmail,
      lastTab: null,
      anyMedicusTabs: [medicusA, medicusB],
      isPopOut: true,
    });
    assert.equal(r.tab, medicusB);
    assert.equal(r.reason, 'popout-fallback');
  });
});

describe('smrPackMatchesRequest', async () => {
  const { smrPackMatchesRequest } = await import(SMR_CORE_URL);

  it('rejects a payload whose packId does not match the tab URL', () => {
    assert.equal(smrPackMatchesRequest({ patient: { name: 'A' }, packId: 'one' }, 'two'), false);
  });

  it('rejects a payload with no packId (fail closed)', () => {
    assert.equal(smrPackMatchesRequest({ patient: { name: 'A' } }, 'one'), false);
  });

  it('rejects a tab with no pack query (fail closed)', () => {
    assert.equal(smrPackMatchesRequest({ patient: { name: 'A' }, packId: 'one' }, null), false);
  });

  it('accepts a matching nonce', () => {
    assert.equal(smrPackMatchesRequest({ patient: { name: 'A' }, packId: 'one' }, 'one'), true);
  });
});
