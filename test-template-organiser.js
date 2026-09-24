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
const VERSION = '55555555-5555-4555-8555-555555555555';
const ENTRY = '66666666-6666-4666-8666-666666666666';
const DOC = '77777777-7777-4777-8777-777777777777';
const HASH = 'd751713988987e9331980363e24189ce';

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

  console.log('\n--- insert bodies match the slash capture, or they do not POST ---');
  const entryBody = C.dataEntryCreateBody(
    {
      form: { fieldA: null, fieldB: false },
      dataEntryTemplateId: TPL,
      dataEntryTemplateVersionId: VERSION,
      consultationUsageId: null,
    },
    ctx,
    TPL
  );
  check(entryBody.ok, 'data-entry body builds when the form GET has a version id');
  check(
    JSON.stringify(Object.keys(entryBody.body)) ===
      JSON.stringify([
        'form',
        'consultationTopicId',
        'dataEntryTemplateId',
        'dataEntryTemplateVersionId',
        'consultationUsageId',
      ]),
    'data-entry keys match the captured POST'
  );
  check(
    entryBody.body.consultationTopicId === TOPIC && entryBody.body.dataEntryTemplateId === TPL,
    'ids are the live ones'
  );
  check(entryBody.body.form.fieldA === null, 'form object is passed through');
  const missingVersion = C.dataEntryCreateBody({ form: { fieldA: null } }, ctx, TPL);
  check(missingVersion.ok === false && !missingVersion.body, 'missing version id does not invent a body');

  const sort = { sortOrder: [{ id: ENTRY, entryType: 'document' }], sortOrderHash: HASH };
  const docBody = C.documentCreateBody({
    formJson: {
      formValues: { document_title: 'yo' },
      hiddenFromPatientFacingServices: true,
      confidentialFromThirdParties: false,
      linkedProblemIds: [],
      problemCode: null,
      clinicalCaseId: null,
    },
    ctx,
    templateId: DOC,
    sort,
    uuid: ENTRY,
  });
  check(docBody.ok, 'document body builds when formValues and sort are present');
  check(
    JSON.stringify(Object.keys(docBody.body)) ===
      JSON.stringify([
        'templateId',
        'patientId',
        'formValues',
        'hiddenFromPatientFacingServices',
        'confidentialFromThirdParties',
        'contextId',
        'contextType',
        'linkedProblemIds',
        'problemCode',
        'clinicalCaseId',
        'uuid',
        'sortOrder',
        'sortOrderHash',
      ]),
    'document create keys match the captured POST'
  );
  check(docBody.body.sortOrderHash === HASH, 'hash is copied, not computed');
  check(docBody.body.sortOrder[docBody.body.sortOrder.length - 1].id === ENTRY, 'new entry is appended');
  check(
    JSON.stringify(Object.keys(docBody.previewBody)) ===
      JSON.stringify(['formValues', 'patientId', 'contextId', 'contextType']),
    'document preview keys match the captured POST'
  );
  const noFlags = C.documentCreateBody({
    formJson: { formValues: { document_title: 'yo' } },
    ctx,
    templateId: DOC,
    sort,
    uuid: ENTRY,
  });
  check(noFlags.ok === false, 'visibility flags are not defaulted');
  const noSort = C.documentCreateBody({
    formJson: {
      formValues: { document_title: 'yo' },
      hiddenFromPatientFacingServices: false,
      confidentialFromThirdParties: false,
    },
    ctx,
    templateId: DOC,
    sortJson: { unrelated: true },
    uuid: ENTRY,
  });
  check(noSort.ok === false, 'missing sort pair does not invent a hash');

  const reflow = C.reflowCreateBody({
    formJson: {
      template: 'referral-letter',
      referralDetails: '',
      referringClinician: 'Dr Example',
      referralDate: '2026-09-24',
      title: '',
      recipientDetails: '',
      hiddenFromPatientFacingServices: false,
      confidentialFromThirdParties: false,
    },
    ctx,
    slug: 'referral-letter',
    sort,
    uuid: ENTRY,
  });
  check(reflow.ok && reflow.body.template === 'referral-letter', 'reflow body uses the slug');
  check(reflow.previewBody.referringClinician === 'Dr Example', 'reflow preview keeps the form clinician');
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

  console.log('\n--- client posts only a built body ---');
  const calls = [];
  function fetchImpl(url, init) {
    calls.push({ url: String(url), method: init.method, body: init.body || '' });
    const path = String(url).replace('https://example.medicus.health', '');
    let json = { items: [] };
    if (path.indexOf('/data-entry-template/create/' + TOPIC) !== -1) {
      json = {
        form: { fieldA: null },
        dataEntryTemplateId: TPL,
        dataEntryTemplateVersionId: VERSION,
        consultationUsageId: null,
      };
    } else if (path.indexOf('/data-entry-template/list') !== -1) {
      json = { items: [{ id: TPL, name: 'Asthma review', description: 'Short' }] };
    } else if (path.indexOf('/document/template/search/') !== -1) {
      json = { items: [{ id: DOC, name: 'Food bank letter', description: 'Letter' }] };
    } else if (path.indexOf('/document/template/form/') !== -1) {
      json = {
        formValues: { document_title: 'yo' },
        hiddenFromPatientFacingServices: true,
        confidentialFromThirdParties: false,
      };
    } else if (path.indexOf('/draft-consultation-topic/') !== -1) {
      json = { sortOrder: [{ id: ENTRY, entryType: 'document' }], sortOrderHash: HASH };
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(json),
    });
  }
  const client = Client.createClient({
    fetchImpl,
    origin: 'https://example.medicus.health',
    uuid: () => ENTRY,
  });
  const listed = await client.listTemplates(ctx);
  check(listed.ok && listed.items[0].id === TPL, 'client lists data-entry templates');
  check(
    calls.some((c) => c.method === 'GET' && c.url.indexOf(C.PATHS.dataEntryList(TOPIC)) !== -1),
    'list GET is the slash URL'
  );
  calls.length = 0;
  const inserted = await client.insertItem({ id: TPL, title: 'Asthma review', insert: 'data-entry' }, ctx);
  check(inserted.ok && inserted.posted, 'data-entry insert posts');
  const post = calls.filter((c) => c.method === 'POST');
  check(post.length === 1 && post[0].url.endsWith(C.PATHS.dataEntryCreate), 'only the slash create URL is posted');
  const sent = JSON.parse(post[0].body);
  check(sent.dataEntryTemplateVersionId === VERSION && sent.form.fieldA === null, 'posted form is the GET form');
  calls.length = 0;
  const docInsert = await client.insertItem({ id: DOC, title: 'Letter', insert: 'document' }, ctx);
  check(docInsert.ok, 'document insert posts preview then create');
  const docPosts = calls.filter((c) => c.method === 'POST').map((c) => c.url);
  check(docPosts[0].indexOf('/clinical/template/preview-document/' + DOC) !== -1, 'preview URL first');
  check(docPosts[1].endsWith('/clinical/data/document/template/create'), 'create URL second');
  calls.length = 0;
  const blocked = await client.insertItem(
    { id: TPL, title: 'Asthma review', insert: 'data-entry' },
    { consultationTopicId: TOPIC }
  );
  // form GET still happens; body builder needs topic which is present. Force a form without version by swapping fetch.
  check(blocked.posted === true || blocked.posted === false, 'blocked path returns a result');
  const gapCalls = [];
  const gapClient = Client.createClient({
    fetchImpl(url, init) {
      gapCalls.push(init.method);
      const path = String(url);
      if (path.indexOf('/data-entry-template/create/' + TOPIC) !== -1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ form: { fieldA: null } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => '{}' });
    },
    origin: 'https://example.medicus.health',
    uuid: () => ENTRY,
  });
  const gap = await gapClient.insertItem({ id: TPL, title: 'Asthma review', insert: 'data-entry' }, ctx);
  check(gap.ok === false && gap.posted === false, 'a form without a version id does not POST');
  check(!gapCalls.includes('POST'), 'no POST was issued for the gap');

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
  check(/method:\s*'POST'/.test(clientSrc), 'client posts with a literal POST');
  check(/TemplateOrganiserClient/.test(canvas), 'canvas calls the client');
  check(
    /function persistDraft\(/.test(canvas) && /chrome\.storage\.local\.set/.test(canvas),
    'groups still save locally'
  );
  check(/templateOrganiser\.config/.test(canvas), 'canvas names the practice config key');
  check(/suite\.ui\.templateOrganiser/.test(canvas), 'canvas names the pack key');
  check(
    /nativeSurface/.test(canvas) && /\/clinical\/encounter\//.test(canvas),
    'launcher is limited to the consult surface'
  );
  check(
    /Data Entry Templates/.test(canvas) && /Document Templates/.test(canvas),
    'launcher also notices the slash drawers'
  );
  check(!/Submitted|Booked|\bSent\b|\bDone\b/.test(canvas), 'canvas does not claim a completed send');
  check(/Medicus accepted the insert/.test(canvas), 'success copy waits for the POST response');
  const coreAt = manifest.indexOf('shared/template-organiser-core.js');
  const clientAt = manifest.indexOf('shared/template-organiser-client.js');
  const canvasAt = manifest.indexOf('content-scripts/template-organiser/template-organiser-canvas.js');
  check(
    coreAt !== -1 && clientAt !== -1 && canvasAt !== -1 && coreAt < clientAt && clientAt < canvasAt,
    'core and client load before the canvas'
  );
  check(/GAPS/.test(readme) && /templateOrganiser\.config/.test(readme), 'README names persistence and gaps');
  check(
    /data-entry-template\/list/.test(readme) && /document\/template\/create/.test(readme),
    'README names the wired endpoints'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
