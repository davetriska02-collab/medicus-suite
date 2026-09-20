// Medicus Suite — Lab Result Catalogue IO (backup / restore / practice-profile apply / loader). Phase B2/B3.
// Run with: node test-labcatalogue-io.js

'use strict';
const fs = require('fs');
const path = require('path');
const IO = require('./shared/io/labcatalogue-io.js');
const OV = require('./shared/lab-catalogue-overlay.js');
const LC = require('./shared/lab-catalogue-core.js');

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
const rejects = async (p, re) => {
  try {
    await p;
    return false;
  } catch (e) {
    return re.test(String(e && e.message));
  }
};

const KEY = 'labcatalogue.practice';
const builtin = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'lab-catalogue.json'), 'utf8'));
const OPTS = { builtin };
let STORE = {};
let writes = 0;
global.chrome = {
  storage: {
    local: {
      get: async (k) => {
        const keys = Array.isArray(k) ? k : [k];
        const out = {};
        keys.forEach((x) => {
          if (x in STORE) out[x] = JSON.parse(JSON.stringify(STORE[x]));
        });
        return out;
      },
      set: async (o) => {
        writes++;
        Object.keys(o).forEach((k) => (STORE[k] = JSON.parse(JSON.stringify(o[k]))));
      },
    },
  },
};

const prov = (reviewed) => ({
  source: 'practice',
  reviewed,
  ...(reviewed ? { reviewedBy: 'Dr A', reviewedAt: '2026-09-19' } : {}),
});
const res = (id, code, reviewed) => ({
  id,
  label: id.toUpperCase(),
  valueKind: 'numeric',
  codes: code ? [{ conceptId: code, role: 'primary' }] : [],
  aliases: [{ text: id }],
  provenance: prov(reviewed),
});
const inv = (id, members, reviewed) => ({
  id,
  label: id,
  kind: 'blood',
  requestAliases: [{ text: id, system: 'any' }],
  headingAliases: [],
  exclude: [],
  members,
  provenance: prov(reviewed),
});
const overlayWith = (extra) => ({ ...OV.emptyOverlay(), ...extra });

(async () => {
  console.log('--- export ---');
  {
    STORE = {};
    const e = await IO.labcatalogueExport();
    check(
      e.practice && e.practice.schema === 1 && e.practice.results.length === 0 && !('warning' in e),
      'nothing stored -> an empty overlay is exported'
    );
    STORE[KEY] = overlayWith({
      context: { icb: 'NHS South West London', icbCode: '', borough: 'Richmond', labs: [], orderingSystems: [] },
      results: [res('zzz', '888000111', true)],
    });
    const e2 = await IO.labcatalogueExport();
    check(
      e2.practice.context.icb === 'NHS South West London' &&
        e2.practice.context.borough === 'Richmond' &&
        e2.practice.results.length === 1,
      'the stored overlay (incl. ICB / borough) is exported'
    );
    STORE[KEY] = { schema: 9, results: 'garbage' };
    const e3 = await IO.labcatalogueExport();
    check(
      e3.practice.results.length === 0 && /unreadable/.test(e3.warning),
      'a CORRUPT stored value never blocks a suite backup: empty overlay + a warning'
    );
    check(
      IO.LABCATALOGUE_KEYS.length === 1 && IO.LABCATALOGUE_KEYS[0] === KEY,
      'exactly one storage key is owned by this module'
    );
  }

  console.log('\n--- import (backup restore): forced inert ---');
  {
    STORE = {};
    writes = 0;
    const incoming = overlayWith({
      context: {
        icb: 'NHS South West London',
        icbCode: '36L',
        borough: 'Richmond',
        labs: ['rj700-general-pathology'],
        orderingSystems: ['tquest'],
      },
      results: [res('zzz', '888000111', true)],
      investigations: [inv('zzz-test', [{ result: 'zzz', role: 'core' }], true)],
    });
    const r = await IO.labcatalogueImport({ practice: incoming }, OPTS);
    check(r.stored === true && writes === 1, 'a valid overlay is stored (one write)');
    const st = STORE[KEY];
    check(
      st.results[0].provenance.reviewed === false && st.investigations[0].provenance.reviewed === false,
      'a restored entry that was APPROVED on the source machine arrives UNREVIEWED'
    );
    check(
      !('reviewedBy' in st.results[0].provenance) &&
        st.results[0].provenance.importedFrom === 'practice' &&
        st.results[0].provenance.source === 'imported',
      'approver / approval date are dropped; the origin is remembered'
    );
    check(
      st.context.icb === 'NHS South West London' &&
        st.context.borough === 'Richmond' &&
        st.context.icbCode === '36L' &&
        st.context.orderingSystems[0] === 'tquest',
      'practice context (ICB / borough / ordering systems) IS restored'
    );
    const eff = await IO.labcatalogueLoadEffective(OPTS);
    check(
      !eff.catalogue.results.some((x) => x.id === 'zzz') && eff.excluded.length === 2,
      'the restored entries are NOT in the effective catalogue until approved'
    );
    const ui = await IO.labcatalogueLoadEffective({ ...OPTS, includeUnreviewed: true });
    check(
      ui.catalogue.results.some((x) => x.id === 'zzz'),
      '…but the settings page (includeUnreviewed) can see them for review'
    );
    check(
      (await IO.labcatalogueImport({}, OPTS)).stored === false &&
        (await IO.labcatalogueImport(null, OPTS)).stored === false &&
        writes === 1,
      'a backup with no lab catalogue section changes nothing'
    );
  }

  console.log('\n--- import: rejects bad input, writes nothing ---');
  {
    STORE = { [KEY]: overlayWith({ results: [res('keep-me', null, true)] }) };
    writes = 0;
    check(
      await rejects(
        IO.labcatalogueImport(
          { practice: { results: [{ id: 'x', label: 'x'.repeat(500), valueKind: 'numeric' }] } },
          OPTS
        ),
        /characters or fewer/
      ),
      'an over-long value rejects the import'
    );
    check(
      (await rejects(
        IO.labcatalogueImport({ practice: { results: 'nope' } }, OPTS),
        /must be an array|must be an object/
      )) || (await rejects(IO.labcatalogueImport({ practice: { results: [5] } }, OPTS), /must be an object/)),
      'a mistyped section rejects the import'
    );
    check(
      await rejects(IO.labcatalogueImport({ practice: 'x' }, OPTS), /must be an object/),
      'a non-object overlay rejects the import'
    );
    check(
      writes === 0 && STORE[KEY].results[0].id === 'keep-me',
      'nothing was written — the existing overlay is untouched'
    );
    const polluted = JSON.parse(
      '{"practice":{"results":[{"id":"pz","label":"PZ","valueKind":"numeric","codes":[],"aliases":[{"text":"pz"}],"__proto__":{"x":1}}],"__proto__":{"evil":1}}}'
    );
    await IO.labcatalogueImport(polluted, OPTS);
    check({}.evil === undefined && {}.x === undefined, 'a prototype-pollution payload does not touch Object.prototype');
    check(
      await rejects(
        IO.labcatalogueImport({ practice: OV.emptyOverlay() }, {}),
        /cannot be loaded|cannot be read|not loaded/
      ),
      'without a loadable baseline the import fails closed (nothing to validate against)'
    );
  }

  console.log('\n--- practice-profile apply: MERGE ---');
  {
    STORE = {
      [KEY]: overlayWith({
        context: { icb: 'NHS South West London', icbCode: '', borough: '', labs: ['a'], orderingSystems: [] },
        results: [res('mine', null, true)],
      }),
    };
    const published = overlayWith({
      context: { icb: 'Some other ICB', icbCode: '36L', borough: 'Richmond', labs: ['b'], orderingSystems: ['tquest'] },
      results: [res('mine', null, true), res('theirs', '777000111', true)],
      investigations: [inv('theirs-test', [{ result: 'theirs', role: 'core' }], true)],
      disabled: { results: ['ggt'], investigations: [] },
      retired: ['old'],
    });
    const r = await IO.labcatalogueApplyPublished({ practice: published }, 'merge', OPTS);
    const st = STORE[KEY];
    check(r.applied === true, 'a merge that adds something reports applied');
    check(
      st.results.length === 2 &&
        st.results.some((x) => x.id === 'theirs') &&
        st.investigations.some((x) => x.id === 'theirs-test'),
      'entries the practice published are added'
    );
    check(
      st.results.find((x) => x.id === 'mine').provenance.reviewed === true,
      'a local entry with the same id is left completely untouched (local wins; still approved)'
    );
    check(
      st.results.find((x) => x.id === 'theirs').provenance.reviewed === false &&
        st.investigations[0].provenance.reviewed === false,
      'newly added published entries arrive INERT (unreviewed)'
    );
    check(
      st.context.icb === 'NHS South West London' && st.context.borough === 'Richmond' && st.context.icbCode === '36L',
      'context fields fill blanks only — a local ICB is not overwritten'
    );
    check(
      st.context.labs.includes('a') && st.context.labs.includes('b') && st.context.orderingSystems.includes('tquest'),
      'context lists are unioned'
    );
    check(
      st.disabled.results.includes('ggt') && st.retired.includes('old'),
      'disables and retired ids are unioned (the fail-safe direction: recognise less)'
    );
    writes = 0;
    const again = await IO.labcatalogueApplyPublished({ practice: published }, 'merge', OPTS);
    check(again.applied === false && writes === 0, 'applying the same publish again is a no-op (no write)');
    check(
      (await IO.labcatalogueApplyPublished({}, 'merge', OPTS)).applied === false,
      'a profile with no lab catalogue section is a no-op'
    );
  }

  console.log('\n--- practice-profile apply: MERGE, filing ranges ---');
  {
    const range = (over) => ({
      result: 'alp',
      lab: 'lab-a',
      code: '111',
      unit: 'u/L',
      low: 30,
      high: 130,
      enabled: true,
      provenance: { source: 'practice', reviewed: true, reviewedBy: 'Dr A', reviewedAt: '2026-09-22' },
      ...(over || {}),
    });
    STORE = { [KEY]: overlayWith({ filing: { ranges: [range()] } }) };
    const published = overlayWith({ filing: { ranges: [range({ low: 5, high: 9 }), range({ code: '222' })] } });
    const r = await IO.labcatalogueApplyPublished({ practice: published }, 'merge', OPTS);
    const st = STORE[KEY].filing.ranges;
    check(r.applied === true && st.length === 2, 'a published range that is not here yet is added');
    check(
      st.find((x) => x.code === '111').low === 30 && st.find((x) => x.code === '111').provenance.reviewed === true,
      'a range already here is left untouched (local wins; its approval stands)'
    );
    check(
      st.find((x) => x.code === '222').provenance.reviewed === false,
      'the newly added published range arrives UNAPPROVED — it acts only once approved on this machine'
    );
    const exp = await IO.labcatalogueExport();
    check(
      exp.practice.filing.ranges.every((x) => x.provenance.reviewed === false && !('reviewedBy' in x.provenance)),
      'a backup carries no filing approval and no reviewer name'
    );
    STORE = { [KEY]: overlayWith({ filing: { ranges: [range()] } }) };
    const rep = await IO.labcatalogueApplyPublished(
      { practice: overlayWith({ filing: { ranges: [range()] } }) },
      'replace',
      OPTS
    );
    check(
      rep.applied === true && STORE[KEY].filing.ranges[0].provenance.reviewed === false,
      'replace: the published range arrives unapproved'
    );
  }

  console.log('\n--- practice-profile apply: REPLACE ---');
  {
    STORE = { [KEY]: overlayWith({ results: [res('local-approved', null, true)] }) };
    const published = overlayWith({ results: [res('policy-one', '666000111', true)] });
    const r = await IO.labcatalogueApplyPublished({ practice: published }, 'replace', OPTS);
    const st = STORE[KEY];
    check(
      r.applied === true && st.results.length === 1 && st.results[0].id === 'policy-one',
      'replace makes the published overlay authoritative'
    );
    check(!st.results.some((x) => x.id === 'local-approved'), '…local additions are removed');
    check(st.results[0].provenance.reviewed === false, '…and everything arrives unreviewed for a fresh local review');
  }

  console.log('\n--- effective catalogue for consumers ---');
  {
    STORE = {
      [KEY]: overlayWith({
        results: [res('zzz', '888000111', true), res('yyy', '888000222', false)],
        investigations: [inv('zzz-test', [{ result: 'zzz', role: 'core' }], true)],
      }),
    };
    const eff = await IO.labcatalogueLoadEffective(OPTS);
    check(
      eff.catalogue.results.some((r) => r.id === 'zzz') && !eff.catalogue.results.some((r) => r.id === 'yyy'),
      'consumers get reviewed entries only'
    );
    check(eff.excluded.length === 1 && eff.excluded[0].id === 'yyy', 'the unreviewed one is reported as excluded');
    check(LC.validateCatalogue(eff.catalogue).errors.length === 0, 'the effective catalogue validates');
    check(eff.context && typeof eff.context.icb === 'string', 'the practice context is returned alongside');
    STORE = {};
    const base = await IO.labcatalogueLoadEffective(OPTS);
    check(
      JSON.stringify(base.catalogue) === JSON.stringify(builtin),
      'with no overlay the effective catalogue IS the built-in one'
    );
  }

  console.log('\n--- baseline loading is cached, failures are not ---');
  {
    let fetches = 0;
    global.chrome.runtime = { getURL: (p) => 'chrome-extension://x/' + p };
    global.fetch = async () => {
      fetches++;
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(builtin)) };
    };
    STORE = {};
    await IO.labcatalogueLoadEffective();
    await IO.labcatalogueLoadEffective();
    check(fetches === 1, 'the shipped baseline is fetched once and cached');
    delete global.fetch;
    delete global.chrome.runtime;
  }

  console.log('\n--- backup envelope: scope, round trip and restore preview ---');
  {
    const ENV = require('./shared/io/suite-envelope.js');
    check(ENV.VALID_SCOPES.includes('labcatalogue'), "'labcatalogue' is a valid backup scope");
    STORE = {
      [KEY]: overlayWith({
        context: { icb: 'NHS South West London', icbCode: '', borough: 'Richmond', labs: [], orderingSystems: [] },
        results: [res('zzz', '888000111', true)],
      }),
    };
    const exported = await IO.labcatalogueExport();
    const env = ENV.wrap('labcatalogue', { labcatalogue: exported }, '3.0.0');
    const un = ENV.unwrap(JSON.parse(JSON.stringify(env)), 'labcatalogue');
    check(
      un.valid === true && un.envelope.modules.labcatalogue.practice.results.length === 1,
      'a per-module export wraps and unwraps cleanly'
    );
    const lines = ENV.previewEnvelope(un.envelope).join('\n');
    check(
      /Lab catalogue: 1 result, 0 investigations, 0 lab definitions/.test(lines),
      'the restore preview summarises the contents'
    );
    check(/Practice context: NHS South West London — Richmond/.test(lines), '…including the practice context');
    check(/arrive UNREVIEWED/.test(lines), '…and warns that imported entries arrive unreviewed');
    const suite = ENV.wrap('suite', { labcatalogue: exported }, '3.0.0');
    check(
      ENV.unwrap(JSON.parse(JSON.stringify(suite))).valid === true,
      'a whole-suite envelope carrying the module is valid'
    );
    STORE = {};
    await IO.labcatalogueImport(un.envelope.modules.labcatalogue, OPTS);
    check(
      STORE[KEY].context.borough === 'Richmond' && STORE[KEY].results[0].provenance.reviewed === false,
      'export -> wrap -> unwrap -> import round-trips the context and forces the entries inert'
    );
  }

  console.log('\n--- local save from the settings page (C2) ---');
  {
    STORE = {};
    const o = OV.setContext(OV.emptyOverlay(), { icb: 'NHS South West London', borough: 'Richmond' });
    o.results.push(res('local-thing', '900000000000001', true));
    await IO.labcatalogueSaveOverlay(o, OPTS);
    check(
      STORE[KEY].context.borough === 'Richmond' && STORE[KEY].results[0].provenance.reviewed === true,
      "a locally saved overlay keeps this machine's approvals (not forced inert)"
    );
    const back = await IO.labcatalogueReadOverlay();
    check(
      back.results.length === 1 && back.context.icb === 'NHS South West London',
      'read returns the sanitised overlay'
    );
    const w = writes;
    check(
      await rejects(IO.labcatalogueSaveOverlay({ schema: 1, results: 'nope' }, OPTS), /results/),
      'a malformed overlay is rejected'
    );
    check(writes === w, '…and nothing was written');
    STORE = { [KEY]: { schema: 1, results: 'corrupt' } };
    check(
      await rejects(IO.labcatalogueReadOverlay(), /results/),
      'a corrupt stored overlay makes read throw (page can say so)'
    );
    STORE = {};
  }

  console.log('\n--- code info (descriptions / QOF) ---');
  {
    const inj = { qofClusters: ['IFCCHBAM_COD'], codes: { 1: { d: 'x', c: [] } } };
    check((await IO.labcatalogueLoadCodeInfo({ info: inj })) === inj, 'an injected table is used as is');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'lab-code-info.json'), 'utf8'));
    check(
      real.qofClusters.includes('IFCCHBAM_COD') && !real.qofClusters.includes('DCCTHBA1C_COD'),
      'shipped table: IFCC HbA1c is a QOF cluster, DCCT % (PHSMI only) is not'
    );
    check(
      real.codes['999791000000106'] && /Haemoglobin A1c/.test(real.codes['999791000000106'].d),
      'shipped table: codes carry their SNOMED description'
    );
    const t = await IO.labcatalogueLoadCodeInfo({});
    check(
      Array.isArray(t.qofClusters) && t.qofClusters.length === 0,
      'without a runtime it returns an empty table, never an error'
    );
  }

  console.log('\n--- export strips approvals at the source (they never travel) ---');
  {
    STORE = {
      [KEY]: overlayWith({ results: [res('appr', '900000000000321', true)] }),
    };
    const e = await IO.labcatalogueExport();
    const p = e.practice.results[0].provenance;
    check(
      p.reviewed === false && !('reviewedBy' in p) && !('reviewedAt' in p),
      'an approved entry exports unreviewed, with the reviewer name removed'
    );
    check(
      STORE[KEY].results[0].provenance.reviewed === true,
      'the stored overlay keeps its local approval (export is read-only)'
    );
    STORE = {};
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
