// Medicus Suite — template & document organiser
// Run with: node test-template-organiser.js

'use strict';

const fs = require('fs');
const path = require('path');

const store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
        const out = {};
        ks.forEach((k) => {
          if (k in store) out[k] = store[k];
        });
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
      },
    },
  },
};

const C = require('./shared/template-organiser-core.js');
const Client = require('./shared/template-organiser-client.js');
const io = require('./shared/io/template-organiser-io.js');
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

const TOPIC = '11111111-1111-4111-8111-111111111111';
const PATIENT = '22222222-2222-4222-8222-222222222222';
const CONTEXT = '33333333-3333-4333-8333-333333333333';
const TPL = '44444444-4444-4444-8444-444444444444';
const ENTRY = '66666666-6666-4666-8666-666666666666';
const DOC = '77777777-7777-4777-8777-777777777777';

function names(surface) {
  return C.seedConfig().surfaces[surface].groups.map((g) => g.name);
}

(async () => {
  console.log('--- default groups, no sample catalogue ---');
  const seed = C.seedConfig();
  check(names('templates').join('|') === 'Nursing|Co-op|Admin', 'template groups');
  check(names('documents').join('|') === 'Nursing|Co-op|Admin', 'document groups');
  check(seed.surfaces.templates.order.nursing.length === 0, 'nursing starts empty');
  check(seed.surfaces.templates.order.ungrouped.length === 0, 'ungrouped starts empty');
  const coreSrc = fs.readFileSync(path.join(__dirname, 'shared/template-organiser-core.js'), 'utf8');
  check(!/Wound review|MOCK_CATALOGUE|source: 'mock'/.test(coreSrc), 'core has no sample catalogue');

  console.log('\n--- stage: move, reorder, groups ---');
  const placed = C.moveItem(C.moveItem(seed.surfaces.templates, TPL, 'nursing', null).surface, DOC, 'nursing', null);
  check(placed.ok, 'place two cards');
  const nursingIds = placed.surface.order.nursing.slice();
  const reordered = C.moveItem(placed.surface, nursingIds[0], 'nursing', null);
  check(reordered.ok, 'reorder within a group');
  check(
    reordered.surface.order.nursing[reordered.surface.order.nursing.length - 1] === nursingIds[0],
    'card moved to end'
  );
  check(reordered.surface.order.nursing[0] === nursingIds[1], 'former second card is now first');
  const moved = C.moveItem(placed.surface, nursingIds[0], 'admin', null);
  check(moved.ok && moved.surface.order.admin[0] === nursingIds[0], 'drag into admin');
  check(!moved.surface.order.nursing.includes(nursingIds[0]), 'card left nursing');
  const before = C.moveItem(placed.surface, nursingIds[0], 'nursing', nursingIds[1]);
  check(before.ok && before.surface.order.nursing[0] === nursingIds[0], 'insert before a card');

  const created = C.createGroup(seed.surfaces.templates, 'Vaccination templates');
  check(created.ok, 'create group');
  const createdId = created.surface.groups.find((g) => g.name === 'Vaccination templates').id;
  const renamed = C.renameGroup(created.surface, createdId, 'Immunisation templates');
  check(
    renamed.ok && renamed.surface.groups.find((g) => g.id === createdId).name === 'Immunisation templates',
    'rename group'
  );
  check(C.createGroup(seed.surfaces.templates, '   ').ok === false, 'blank group name refused');
  check(C.renameGroup(seed.surfaces.templates, 'ungrouped', 'Bin').ok === false, 'ungrouped lane cannot be renamed');
  const removed = C.deleteGroup(placed.surface, 'nursing');
  check(removed.ok && !removed.surface.groups.some((g) => g.id === 'nursing'), 'delete group');
  check(removed.surface.order.ungrouped.length === nursingIds.length, 'deleted group cards move to Not in a group');
  check(C.deleteGroup(seed.surfaces.templates, 'ungrouped').ok === false, 'ungrouped lane cannot be deleted');

  const summary = C.diffSummary(seed, C.replaceSurface(seed, 'templates', renamed.surface));
  check(
    summary.some((line) => /new group/.test(line)),
    'confirm summary names a new group'
  );

  console.log('\n--- list parser and session context ---');
  const parsed = C.parseList(
    {
      items: [
        { id: TPL, name: 'Asthma review', description: 'QoF', publisherName: 'Primary Care IT' },
        { template: 'referral-letter', name: 'Referral letter', description: 'Built in' },
      ],
    },
    'documents'
  );
  check(parsed.ok && parsed.items.length === 2, 'document list reads an items envelope');
  check(
    parsed.items[0].insert === 'document' && parsed.items[0].category === 'Primary Care IT',
    'uuid row is a document'
  );
  check(parsed.items[1].insert === 'reflow' && parsed.items[1].id === 'referral-letter', 'slug row is reflow');
  check(!Object.prototype.hasOwnProperty.call(parsed.items[0], 'groupId'), 'parsed row has no group');
  const templates = C.parseList([{ dataEntryTemplateId: TPL, title: 'Asthma review' }], 'templates');
  check(templates.ok && templates.items[0].insert === 'data-entry', 'data-entry id field');
  const unknown = C.parseList({ totallyDifferent: true }, 'templates');
  check(unknown.ok === false && unknown.items.length === 0, 'unknown list shape is a gap');
  const ctx = C.readSessionContext({
    href: 'https://example.medicus.health/560b6c/clinical/encounter/overview/' + ENTRY,
    resourceUrls: [
      'https://example.medicus.health/clinical/data/data-entry-template/list?consultationTopicId=' + TOPIC,
      'https://example.medicus.health/clinical/data/document/template/search/' +
        PATIENT +
        '?contextId=' +
        CONTEXT +
        '&contextType=consultation-topic-heading',
    ],
  });
  check(ctx.encounterId === ENTRY, 'encounter id from the overview path');
  check(ctx.consultationTopicId === TOPIC, 'topic id from the list query');
  check(ctx.patientId === PATIENT && ctx.contextId === CONTEXT, 'patient and context from the search URL');
  check(ctx.contextType === 'consultation-topic-heading', 'context type from the search URL');
  check(C.sessionDrift(ctx, Object.assign({}, ctx, { patientId: DOC })) === true, 'a changed patient id is drift');
  check(C.mergeSession(ctx, { patientId: '' }).patientId === PATIENT, 'an empty live id does not wipe a pinned one');

  const pageHref = 'https://england.medicus.health/560b6c/clinical/encounter/overview/' + ENTRY;
  const fromPath = C.resolveApiBase({
    href: pageHref,
    pathname: '/560b6c/clinical/encounter/overview/' + ENTRY,
    hostname: 'england.medicus.health',
    resourceUrls: [],
  });
  check(fromPath === 'https://560b6c.api.england.medicus.health', 'api base is {site}.api.{page hostname}');
  const fromResource = C.resolveApiBase({
    href: 'https://england.medicus.health/not-a-site/clinical/encounter/overview/' + ENTRY,
    pathname: '/not-a-site/clinical/encounter/overview/' + ENTRY,
    hostname: 'england.medicus.health',
    resourceUrls: [
      'https://560b6c.api.england.medicus.health/clinical/data/data-entry-template/list?consultationTopicId=' + TOPIC,
    ],
  });
  check(
    fromResource === 'https://560b6c.api.england.medicus.health',
    'a resource URL that already contains .api. wins over the path segment'
  );
  const staging = C.resolveApiBase({
    pathname: '/560b6c/clinical/encounter/overview/' + ENTRY,
    hostname: 'staging.medicus.health',
  });
  check(staging === 'https://560b6c.api.staging.medicus.health', 'hostname variant stays on the page host');
  const fromCode = C.resolveApiBase({
    pathname: '/clinical/encounter/overview/' + ENTRY,
    hostname: 'england.medicus.health',
    practiceCode: '560b6c',
  });
  check(
    fromCode === 'https://560b6c.api.england.medicus.health',
    'practice code fills in when the path has no site id'
  );

  const OTHER = '88888888-8888-4888-8888-888888888888';
  const OTHER_HEADING = '99999999-9999-4999-8999-999999999999';
  const fromTopics = C.readSessionContext({
    href: pageHref,
    overview: { consultationTopics: [{ id: TOPIC, patientId: PATIENT }] },
  });
  check(
    fromTopics.consultationTopicId === TOPIC && fromTopics.patientId === PATIENT,
    'overview consultationTopics id hydrates topic and patient'
  );
  const owned = C.readSessionContext({
    href: pageHref,
    resourceUrls: [
      'https://560b6c.api.england.medicus.health/clinical/data/data-entry-template/list?consultationTopicId=' + OTHER,
    ],
    headingId: 'heading-history-' + CONTEXT,
    overview: {
      patient: { id: PATIENT },
      consultationTopics: [
        { id: OTHER, headings: [{ id: OTHER_HEADING, title: 'History' }] },
        { id: TOPIC, patientId: PATIENT, headings: [{ id: CONTEXT, title: 'History' }] },
      ],
    },
  });
  check(owned.consultationTopicId === TOPIC, 'focused heading picks the topic that owns it');
  check(owned.patientId === PATIENT, 'overview patient stays when the heading picks a topic');
  check(
    owned.contextId === CONTEXT && owned.contextType === 'consultation-topic-heading',
    'heading-history uuid is the document context'
  );
  const fromSummary = C.readSessionContext({
    href: pageHref,
    resourceUrls: [
      'https://560b6c.api.england.medicus.health/clinical/data/clinical-summary/summary/' +
        PATIENT +
        '?encounterId=' +
        ENTRY,
      'https://560b6c.api.england.medicus.health/clinical/data/encounter/consultation-topic/draft-consultation-topic/' +
        TOPIC,
      'https://560b6c.api.england.medicus.health/clinical/encounter/consultation-topic/topic-heading-entries/' +
        CONTEXT,
    ],
  });
  check(fromSummary.patientId === PATIENT, 'clinical-summary URL yields patient');
  check(fromSummary.consultationTopicId === TOPIC, 'draft-consultation-topic URL yields topic');
  check(
    fromSummary.contextId === CONTEXT && fromSummary.contextType === 'consultation-topic-heading',
    'topic-heading-entries URL yields context'
  );
  const nestedTopic = C.readSessionContext({
    href: pageHref,
    overview: { data: { consultationTopics: [{ consultationTopicId: TOPIC, patient: { id: PATIENT } }] } },
  });
  check(
    nestedTopic.consultationTopicId === TOPIC && nestedTopic.patientId === PATIENT,
    'nested consultationTopics and patient hydrate'
  );
  const notRows = C.parseList({ consultationTopics: [{ id: TOPIC, title: 'Surgery consultation' }] }, 'templates');
  check(notRows.ok === false && notRows.items.length === 0, 'consultation topics are not template rows');
  const listEnvelope = C.parseList({ list: [{ id: TPL, name: 'Asthma review' }] }, 'templates');
  check(listEnvelope.ok && listEnvelope.items[0].id === TPL, 'list envelope is a catalogue');
  let ring = C.rememberClinicalUrl([], 'https://england.medicus.health/version');
  check(ring.length === 0, 'page-origin URL is not kept in the api ring');
  ring = C.rememberClinicalUrl(
    ring,
    'https://560b6c.api.england.medicus.health/clinical/data/encounter/consultation-topic/draft-consultation-topic/' +
      TOPIC
  );
  check(ring.length === 1, 'practice api clinical URL is kept');
  const fromRing = C.readSessionContext({ href: pageHref, resourceUrls: C.mergeResourceUrls(ring, []) });
  check(fromRing.consultationTopicId === TOPIC, 'a remembered api URL still yields the topic');

  console.log('\n--- clinical field and native open, no suite create body ---');
  check(C.clinicalFieldKind({ id: 'heading-history-' + TOPIC }) === 'history', 'heading-history id is history');
  check(
    C.clinicalFieldKind({ labelledBy: 'heading-examination-' + TOPIC }) === 'examination',
    'aria-labelledby heading-examination is examination'
  );
  check(
    C.clinicalFieldKind({ headingText: 'Impression', editable: true }) === 'impression',
    'editable impression heading'
  );
  check(C.clinicalFieldKind({ headingText: 'Plan', editable: true }) === 'plan', 'editable plan heading');
  check(C.clinicalFieldKind({ headingText: 'Plan', editable: false }) === '', 'plan text outside an editor is ignored');
  check(
    C.clinicalFieldKind({ headingText: 'Clinical history', editable: true }) === '',
    'a longer heading is not history'
  );
  check(C.clinicalFieldKind({ id: 'heading-other-' + TOPIC }) === '', 'other heading ids are not clinical fields');
  const asthma = { id: TPL, title: '! Asthma Diagnosis [Contracts]', insert: 'data-entry' };
  check(
    C.nativeControlMatches(asthma, {
      text: 'Use template',
      title: '',
      cardTitle: '! Asthma Diagnosis [Contracts]',
    }),
    'data-entry matches Use template on that card'
  );
  check(
    C.nativeControlMatches(asthma, { text: 'Use template', cardTitle: 'Stroke' }) === false,
    'Use template on a different card does not match'
  );
  check(C.nativeMenuId(asthma) === 'id-template', 'data-entry opens from the template menu item');
  const letter = { id: DOC, title: 'Food bank letter', insert: 'document' };
  check(
    C.nativeControlMatches(letter, { text: '', title: 'Create Food bank letter', cardTitle: 'Food bank letter' }),
    'document matches the Create control'
  );
  check(C.nativeMenuId(letter) === 'id-document', 'documents open from the document menu item');
  check(
    C.nativeMenuId({ insert: 'reflow', title: 'Referral letter' }) === 'id-document',
    'built-in letters use the document menu'
  );
  const coreHasCreateBody = /function dataEntryCreateBody|function documentCreateBody|function reflowCreateBody/.test(
    coreSrc
  );
  check(coreHasCreateBody === false, 'core does not build a suite create body');

  console.log('\n--- open from a group uses the same native plan as ungrouped ---');
  const tplItem = {
    id: TPL,
    title: '! Asthma Diagnosis [Contracts]',
    preview: 'Short',
    category: 'QoF',
    insert: 'data-entry',
  };
  const docItem = { id: DOC, title: 'Food bank letter', preview: 'Letter', category: '', insert: 'document' };
  const reflowItem = { id: 'referral-letter', title: 'Referral letter', preview: '', category: '', insert: 'reflow' };
  const tplSurface = C.moveItem(seed.surfaces.templates, TPL, 'nursing', null).surface;
  const docSurface = C.moveItem(seed.surfaces.documents, DOC, 'admin', null).surface;
  const reflowSurface = C.moveItem(seed.surfaces.documents, 'referral-letter', 'coop', null).surface;
  const potTpl = C.buildBoard([tplItem], tplSurface).groups.find((g) => g.id === 'nursing').items[0];
  const looseTpl = C.buildBoard([tplItem], seed.surfaces.templates).groups[0].items[0];
  const potDoc = C.buildBoard([docItem], docSurface).groups.find((g) => g.id === 'admin').items[0];
  const looseDoc = C.buildBoard([docItem], seed.surfaces.documents).groups[0].items[0];
  const potReflow = C.buildBoard([reflowItem], reflowSurface).groups.find((g) => g.id === 'coop').items[0];
  const looseReflow = C.buildBoard([reflowItem], seed.surfaces.documents).groups[0].items[0];
  const useSpec = { text: 'Use template', title: '', cardTitle: '! Asthma Diagnosis [Contracts]' };
  const createSpec = { text: '', title: 'Create Food bank letter', cardTitle: 'Food bank letter' };
  check(
    potTpl && looseTpl && potTpl.id === TPL && looseTpl.id === TPL,
    'template card is the same item in a pot and ungrouped'
  );
  check(
    JSON.stringify(C.nativeOpenPlan(potTpl)) === JSON.stringify(C.nativeOpenPlan(looseTpl)),
    'potted template open plan matches ungrouped'
  );
  check(
    C.nativeOpenPlan(potTpl).posts === false && C.nativeOpenPlan(potTpl).menuId === 'id-template',
    'potted template does not POST and uses the template menu'
  );
  check(
    C.nativeControlMatches(potTpl, useSpec) === true && C.nativeControlMatches(looseTpl, useSpec) === true,
    'potted template matches the same Use template control'
  );
  check(potDoc && looseDoc && potDoc.id === DOC, 'document card is the same item in a pot and ungrouped');
  check(
    JSON.stringify(C.nativeOpenPlan(potDoc)) === JSON.stringify(C.nativeOpenPlan(looseDoc)),
    'potted document open plan matches ungrouped'
  );
  check(
    C.nativeOpenPlan(potDoc).posts === false && C.nativeOpenPlan(potDoc).menuId === 'id-document',
    'potted document does not POST and uses the document menu'
  );
  check(
    C.nativeControlMatches(potDoc, createSpec) === true && C.nativeControlMatches(looseDoc, createSpec) === true,
    'potted document matches the same Create control'
  );
  check(
    JSON.stringify(C.nativeOpenPlan(potReflow)) === JSON.stringify(C.nativeOpenPlan(looseReflow)) &&
      C.nativeOpenPlan(potReflow).posts === false &&
      C.nativeOpenPlan(potReflow).menuId === 'id-document',
    'potted built-in letter uses the same document menu and does not POST'
  );
  check(
    !/function dataEntryCreateBody|function documentCreateBody|fetch\(/.test(
      coreSrc.slice(coreSrc.indexOf('function nativeOpenPlan'), coreSrc.indexOf('function buildBoard'))
    ),
    'native open plan does not fetch or build a create body'
  );

  console.log('\n--- catalogue paths, not a suite insert ---');
  check(
    C.PATHS.dataEntryList(TOPIC) === '/clinical/data/data-entry-template/list?consultationTopicId=' + TOPIC,
    'data-entry list path'
  );
  check(
    C.PATHS.dataEntryForm(TOPIC, TPL) === '/clinical/data/data-entry-template/create/' + TOPIC + '/' + TPL,
    'data-entry form path'
  );
  check(C.PATHS.dataEntryCreate === '/clinical/data-entry-template/create', 'data-entry create path');
  check(
    C.PATHS.documentSearch(PATIENT, CONTEXT, 'consultation-topic-heading') ===
      '/clinical/data/document/template/search/' +
        PATIENT +
        '?contextId=' +
        CONTEXT +
        '&contextType=consultation-topic-heading',
    'document search path'
  );
  check(
    C.PATHS.documentForm(DOC, PATIENT, CONTEXT, 'consultation-topic-heading').indexOf(
      '/clinical/data/document/template/form/' + DOC + '?patientId='
    ) === 0,
    'document form path'
  );
  check(C.PATHS.documentCreate === '/clinical/data/document/template/create', 'document create path');
  check(C.PATHS.documentPreview(DOC) === '/clinical/template/preview-document/' + DOC, 'document preview path');
  check(C.PATHS.reflowCreate === '/clinical/document/template/reflow/create', 'reflow create path');
  check(
    C.PATHS.reflowPreview('referral-letter') === '/clinical/document/template/preview-reflow-document/referral-letter',
    'reflow preview path'
  );

  console.log('\n--- client lists on the practice API host and does not POST ---');
  const calls = [];
  const client = Client.createClient({
    fetchImpl(url, init) {
      calls.push({ url: String(url), method: init.method, body: init.body || '' });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ id: TPL, name: 'Asthma review', description: 'Short' }] }),
      });
    },
    origin: 'https://example.medicus.health',
  });
  const listed = await client.listTemplates(ctx);
  check(listed.ok && listed.items[0].id === TPL, 'client lists data-entry templates');
  check(
    calls.some((c) => c.method === 'GET' && c.url.indexOf(C.PATHS.dataEntryList(TOPIC)) !== -1),
    'list GET is the catalogue URL'
  );
  check(typeof client.insertItem !== 'function', 'client has no insert');
  check(!calls.some((c) => c.method === 'POST'), 'listing does not POST');

  const hostCalls = [];
  const hostClient = Client.createClient({
    fetchImpl(url, init) {
      hostCalls.push({ url: String(url), method: init.method });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ id: TPL, name: 'Asthma review' }] }),
      });
    },
    apiBase: fromPath,
  });
  await hostClient.listTemplates({ consultationTopicId: TOPIC });
  check(
    hostCalls[0].url.indexOf('https://560b6c.api.england.medicus.health/clinical/data/data-entry-template/list') === 0,
    'list GET uses the practice API host'
  );
  check(hostCalls[0].url.indexOf('https://england.medicus.health/') !== 0, 'list GET does not use the page origin');
  let htmlMessage = '';
  const htmlClient = Client.createClient({
    fetchImpl() {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '<!doctype html><html></html>',
      });
    },
    apiBase: fromPath,
  });
  try {
    await htmlClient.listTemplates({ consultationTopicId: TOPIC });
  } catch (err) {
    htmlMessage = err.message;
  }
  check(
    /HTTP 200/.test(htmlMessage) && /not JSON/.test(htmlMessage),
    'HTML body names the status and that it was not JSON'
  );

  const harvestCalls = [];
  const harvestClient = Client.createClient({
    apiBase: fromPath,
    fetchImpl(url, init) {
      harvestCalls.push({ url: String(url), method: init.method });
      const target = String(url);
      if (target.indexOf('/clinical/data/encounter/overview/') !== -1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              patient: { id: PATIENT },
              consultationTopics: [{ id: TOPIC, headings: [{ id: CONTEXT }] }],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ id: TPL, name: 'Asthma review' }] }),
      });
    },
  });
  const harvestHref = pageHref;
  const harvestHeading = 'heading-examination-' + CONTEXT;
  const harvested = await harvestClient.hydrate(
    C.readSessionContext({ href: harvestHref, resourceUrls: [], headingId: harvestHeading }),
    harvestHref,
    [],
    harvestHeading
  );
  check(harvested.consultationTopicId === TOPIC, 'hydrate reads consultationTopics from overview');
  check(harvested.contextId === CONTEXT, 'hydrate keeps the focused heading as context');
  const harvestedList = await harvestClient.listTemplates(harvested);
  check(harvestedList.ok && harvestedList.items[0].id === TPL, 'hydrated topic lists templates');
  check(
    harvestCalls.some(
      (call) =>
        call.method === 'GET' &&
        call.url ===
          'https://560b6c.api.england.medicus.health/clinical/data/data-entry-template/list?consultationTopicId=' +
            TOPIC
    ),
    'listTemplates uses that topic on the practice API host'
  );
  check(
    harvestCalls.every((call) => call.url.indexOf('https://england.medicus.health/') !== 0),
    'hydrate does not call the page origin'
  );

  console.log('\n--- confirm payload is the local group overlay ---');
  const payload = C.confirmPayload(seed, {
    templates: [{ id: TPL, title: 'Asthma review', preview: 'Short', category: 'QoF', insert: 'data-entry' }],
    documents: [],
  });
  check(payload.surfaces.templates.order.ungrouped.includes(TPL), 'unknown harvested id lands in ungrouped');
  check(!/"(method|url|endpoint)"/.test(JSON.stringify(payload)), 'group payload has no request fields');
  const proto = C.sanitiseConfig({
    surfaces: {
      templates: {
        groups: [{ id: '__proto__', name: 'Bad' }],
        order: { ungrouped: ['__proto__', 'constructor', TPL] },
      },
    },
  });
  check(
    proto.surfaces.templates.groups.every((g) => g.id !== '__proto__'),
    'group id __proto__ is not kept'
  );
  check(!proto.surfaces.templates.order.ungrouped.includes('__proto__'), 'item id __proto__ dropped');
  check(!proto.surfaces.templates.order.ungrouped.includes('constructor'), 'item id constructor dropped');
  check(proto.surfaces.templates.order.ungrouped.includes(TPL), 'real item id kept');

  console.log('\n--- storage round-trip ---');
  check(io.TEMPLATE_ORGANISER_KEYS.includes('templateOrganiser.config'), 'io owns templateOrganiser.config');
  let empty = await io.templateOrganiserExport();
  check(empty.config === null, 'export is null when unset');
  await io.templateOrganiserImport({ config: seed });
  const again = await io.templateOrganiserExport();
  check(C.sameConfig(again.config, seed), 'import sanitises and round-trips the practice config');
  let threw = false;
  try {
    await io.templateOrganiserImport({ config: ['nope'] });
  } catch (err) {
    threw = /object/.test(err.message);
  }
  check(threw, 'import rejects a non-object config');

  const preview = suiteEnv.previewEnvelope(
    suiteEnv.wrap('templateOrganiser', { templateOrganiser: { config: seed } }, '3.265.0')
  );
  check(
    preview.some((line) => /3 template group\(s\), 3 document group\(s\)/.test(line)),
    'backup preview counts both surfaces'
  );

  console.log('\n--- canvas wires the client and stays gated ---');
  const canvas = fs.readFileSync(
    path.join(__dirname, 'content-scripts/template-organiser/template-organiser-canvas.js'),
    'utf8'
  );
  const clientSrc = fs.readFileSync(path.join(__dirname, 'shared/template-organiser-client.js'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, 'content-scripts/template-organiser/README.md'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(!/method:\s*['"]POST['"]/.test(canvas), 'canvas file does not itself POST');
  check(!/method:\s*['"]POST['"]/.test(clientSrc), 'client does not POST a create body');
  check(/method:\s*'GET'/.test(clientSrc), 'client still GETs the catalogue');
  check(/TemplateOrganiserClient/.test(canvas), 'canvas calls the client');
  check(
    /function persistDraft\(/.test(canvas) && /chrome\.storage\.local\.set/.test(canvas),
    'groups still save locally'
  );
  check(/templateOrganiser\.config/.test(canvas), 'canvas names the practice config key');
  check(/suite\.ui\.templateOrganiser/.test(canvas), 'canvas names the pack key');
  check(
    /consultPage/.test(canvas) && /\/clinical\/encounter\//.test(canvas) && /clinicalFieldKind/.test(canvas),
    'launcher requires a consultation page and a clinical field'
  );
  check(
    !/Data Entry Templates/.test(canvas) && !/Document Templates/.test(canvas),
    'launcher does not mount because a template drawer is open'
  );
  check(/Document and Template Organiser/.test(canvas), 'canvas uses the product name');
  check(
    /nativeOpenPlan/.test(canvas) && /nativeMenuId/.test(coreSrc) && /id-template/.test(coreSrc),
    'open goes through the shared Medicus menu plan'
  );
  const openNativeSrc = canvas.slice(
    canvas.indexOf('function openNative('),
    canvas.indexOf('function ensureLauncher(')
  );
  const onClickSrc = canvas.slice(canvas.indexOf('function onClick('), canvas.indexOf('function onInput('));
  check(
    /nativeOpenPlan/.test(openNativeSrc) && /plan\.posts/.test(openNativeSrc),
    'openNative uses the shared plan and refuses a POST'
  );
  check(!/ungrouped|data-group-id|\.locked/.test(openNativeSrc), 'openNative does not branch on the column');
  check(!/method:\s*['"]POST['"]/.test(openNativeSrc), 'openNative does not POST');
  check(/execCommand\(\s*'insertText',\s*false,\s*'\/'\s*\)/.test(canvas), 'slash is typed into the clinical field');
  check(
    /data-drag-hold/.test(canvas) && /onOpenMouseDown/.test(canvas) && /onOpenMouseUp/.test(canvas),
    'pressing Open does not drag the card, and a swallowed click still opens'
  );
  check(
    /data-open/.test(onClickSrc) && /itemsForSurface\(/.test(onClickSrc) && !/ungrouped/.test(onClickSrc),
    'Open resolves the catalogue item and does not special-case Not in a group'
  );
  check(!/Use template/.test(canvas), 'canvas does not label its own button Use template');
  check(/nativeControlMatches/.test(canvas), 'open matches Medicus’s own control');
  check(!/Insert into consultation/.test(canvas), 'suite insert confirm is gone');
  check(!/Submitted|Booked|\bSent\b|\bDone\b/.test(canvas), 'canvas does not claim a completed send');
  check(!/Medicus accepted the insert/.test(canvas), 'canvas does not claim a suite insert');
  check(/resolveApiBase/.test(canvas) && /apiBase:\s*base/.test(canvas), 'canvas passes the practice API host');
  check(!/origin:\s*location\.origin/.test(canvas), 'canvas does not call the page origin');
  const coreAt = manifest.indexOf('shared/template-organiser-core.js');
  const clientAt = manifest.indexOf('shared/template-organiser-client.js');
  const canvasAt = manifest.indexOf('content-scripts/template-organiser/template-organiser-canvas.js');
  check(
    coreAt !== -1 && clientAt !== -1 && canvasAt !== -1 && coreAt < clientAt && clientAt < canvasAt,
    'core and client load before the canvas'
  );
  check(/GAPS/.test(readme) && /templateOrganiser\.config/.test(readme), 'README names persistence and gaps');
  check(
    /data-entry-template\/list/.test(readme) && /does not POST/.test(readme) && /\.api\./.test(readme),
    'README names the catalogue GET, the API host, and that the suite does not POST'
  );
  check(/Document and Template Organiser/.test(readme), 'README uses the product name');
  check(/History/.test(readme) && /Examination/.test(readme), 'README names the clinical fields');
  check(
    /consultationTopics/.test(readme) && /clinical-summary/.test(readme) && /heading-/.test(readme),
    'README names overview topics, clinical-summary, and the heading id'
  );
  check(/headingId/.test(canvas) && /rememberClinicalUrl/.test(canvas), 'canvas passes the heading and the api ring');
  check(/PerformanceObserver/.test(canvas), 'canvas watches practice API resource URLs');
  check(/ms-toc-gap/.test(canvas), 'a missing id is shown at the bottom of the canvas');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
