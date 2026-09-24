// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template & document organiser core
//
// Pure logic: no DOM, no chrome.*, no fetch. The canvas owns the overlay.
// Practice group definitions and card order live in chrome.storage.local at
// templateOrganiser.config. Medicus has no group field on these lists
// (capture 2026-09-24: every DOM tag was untagged). Membership is a local
// overlay keyed by the Medicus template id.
//
// List and insert payloads are built here so a test can lock them to the
// slash-menu capture without a network call. The client performs the GET
// and POST. This file does not invent a form, a version id, or a
// sortOrderHash — if the live JSON does not already carry them, the
// builder returns a gap and the client must not POST.

'use strict';

(function (global) {
  const CONFIG_KEY = 'templateOrganiser.config';
  const CONFIG_VERSION = 1;
  const SURFACES = ['templates', 'documents'];
  const UNGROUPED_ID = 'ungrouped';
  const UNGROUPED_NAME = 'Not in a group';
  const INSERTS = ['data-entry', 'document', 'reflow'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  const HASH_RE = /^[a-f0-9]{32}$/i;
  const CONTEXT_TYPE_RE = /^[a-z0-9-]{1,64}$/;

  const LIMITS = {
    id: 64,
    name: 60,
    title: 120,
    preview: 240,
    category: 40,
    groups: 24,
    items: 200,
  };

  const DEFAULT_GROUPS = [
    { id: 'nursing', name: 'Nursing' },
    { id: 'coop', name: 'Co-op' },
    { id: 'admin', name: 'Admin' },
  ];

  const LIST_KEYS = [
    'items',
    'data',
    'templates',
    'documents',
    'results',
    'content',
    'records',
    'rows',
    'templateList',
    'documentTemplates',
    'values',
  ];

  function clamp(s, n) {
    return String(s ?? '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, n);
  }

  function slugify(s) {
    return String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function badKey(id) {
    return id === '__proto__' || id === 'constructor' || id === 'prototype';
  }

  function plain(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function enc(s) {
    return encodeURIComponent(String(s ?? ''));
  }

  function uniqueId(base, taken) {
    let id = base || 'group';
    if (!taken.has(id)) return id;
    let n = 2;
    while (taken.has(id + '-' + n) && n < 1000) n += 1;
    return id + '-' + n;
  }

  function firstString(raw, keys) {
    if (!plain(raw)) return '';
    for (let i = 0; i < keys.length; i += 1) {
      const v = raw[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function sanitiseItem(raw) {
    if (!plain(raw)) return null;
    const title = clamp(raw.title, LIMITS.title);
    let id = clamp(raw.id, LIMITS.id);
    if (!id) id = slugify(title);
    if (!id || !title || badKey(id) || !ID_RE.test(id)) return null;
    const insert = INSERTS.indexOf(raw.insert) !== -1 ? raw.insert : '';
    return {
      id,
      title,
      preview: clamp(raw.preview, LIMITS.preview),
      category: clamp(raw.category, LIMITS.category),
      insert,
    };
  }

  function emptySurface() {
    return { groups: [], order: { [UNGROUPED_ID]: [] } };
  }

  function sanitiseSurface(raw) {
    const groups = [];
    const seen = new Set([UNGROUPED_ID]);
    const incoming = raw && Array.isArray(raw.groups) ? raw.groups : [];
    for (const g of incoming) {
      if (!plain(g)) continue;
      const name = clamp(g.name, LIMITS.name);
      if (!name || badKey(name)) continue;
      let id = slugify(g.id || name);
      if (!id || id === UNGROUPED_ID || badKey(id)) id = slugify(name) || 'group';
      if (badKey(id) || id === UNGROUPED_ID) continue;
      id = uniqueId(id, seen);
      seen.add(id);
      groups.push({ id, name });
      if (groups.length >= LIMITS.groups) break;
    }

    const allowed = [UNGROUPED_ID].concat(groups.map((g) => g.id));
    const rawOrder = raw && plain(raw.order) ? raw.order : {};
    const order = {};
    const used = new Set();
    allowed.forEach((gid) => {
      const list = Array.isArray(rawOrder[gid]) ? rawOrder[gid] : [];
      const clean = [];
      list.forEach((itemId) => {
        if (typeof itemId !== 'string') return;
        const id = clamp(itemId, LIMITS.id);
        if (!id || badKey(id) || !ID_RE.test(id) || used.has(id)) return;
        used.add(id);
        clean.push(id);
      });
      order[gid] = clean.slice(0, LIMITS.items);
    });
    return { groups, order };
  }

  function defaultSurface() {
    return sanitiseSurface({
      groups: DEFAULT_GROUPS.map((g) => ({ id: g.id, name: g.name })),
      order: {},
    });
  }

  function seedConfig() {
    return {
      version: CONFIG_VERSION,
      surfaces: {
        templates: defaultSurface(),
        documents: defaultSurface(),
      },
    };
  }

  function sanitiseConfig(raw) {
    const src = plain(raw) ? raw : {};
    const surfacesIn = plain(src.surfaces) ? src.surfaces : {};
    const surfaces = {};
    SURFACES.forEach((name) => {
      const incoming = surfacesIn[name];
      surfaces[name] = incoming == null ? defaultSurface() : sanitiseSurface(incoming);
    });
    return { version: CONFIG_VERSION, surfaces };
  }

  function cloneConfig(config) {
    return sanitiseConfig(config);
  }

  function asList(json) {
    if (Array.isArray(json)) return json;
    if (!plain(json)) return null;
    function from(node) {
      if (!plain(node)) return null;
      for (let i = 0; i < LIST_KEYS.length; i += 1) {
        const v = node[LIST_KEYS[i]];
        if (Array.isArray(v)) return v;
        if (plain(v)) {
          if (Array.isArray(v.items)) return v.items;
          if (Array.isArray(v.content)) return v.content;
          if (Array.isArray(v.records)) return v.records;
        }
      }
      return null;
    }
    return from(json) || from(json.data);
  }

  // The list GET responses were not in the capture. Accept an array or a
  // short list of envelopes. A shape that matches none of those is a gap,
  // not a guessed row.
  function parseList(json, surface) {
    const rows = asList(json);
    if (!rows) {
      return {
        ok: false,
        items: [],
        gap: 'The list response did not match a shape this canvas can read. The capture stored no response body for this endpoint.',
      };
    }
    const items = [];
    rows.forEach((raw) => {
      if (!plain(raw)) return;
      const id = firstString(raw, ['id', 'templateId', 'dataEntryTemplateId', 'documentTemplateId', 'uuid', 'value']);
      const slug = firstString(raw, ['template', 'slug', 'reflowTemplate']);
      const title = firstString(raw, ['name', 'title', 'label', 'templateName', 'displayName']);
      const preview = firstString(raw, ['description', 'summary', 'preview', 'subtitle', 'detail']);
      const category = firstString(raw, [
        'category',
        'publisher',
        'publisherName',
        'organisationName',
        'organizationName',
        'owner',
        'ownerName',
        'source',
        'provider',
        'tag',
      ]);
      let insert = surface === 'templates' ? 'data-entry' : 'document';
      let itemId = id;
      if (surface === 'documents') {
        const reflowId = slug && ID_RE.test(slug) && !UUID_RE.test(slug) ? slug : '';
        if (reflowId && (!itemId || itemId === reflowId || !UUID_RE.test(itemId))) {
          itemId = reflowId;
          insert = 'reflow';
        } else if (itemId && ID_RE.test(itemId) && !UUID_RE.test(itemId)) {
          insert = 'reflow';
        }
      }
      const item = sanitiseItem({
        id: itemId,
        title: title || '',
        preview,
        category,
        insert,
      });
      if (item) items.push(item);
    });
    if (rows.length && !items.length) {
      return {
        ok: false,
        items: [],
        gap: 'The list returned rows without an id and a title this canvas can keep. Nothing was invented in their place.',
      };
    }
    return { ok: true, items: items.slice(0, LIMITS.items), gap: '' };
  }

  function emptyContext() {
    return {
      encounterId: '',
      consultationTopicId: '',
      patientId: '',
      contextId: '',
      contextType: '',
    };
  }

  function takeUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value) ? value : '';
  }

  function absorbNamed(node, ctx, depth) {
    if (!plain(node) || depth > 3) return;
    if (!ctx.patientId) ctx.patientId = takeUuid(node.patientId);
    if (!ctx.patientId && plain(node.patient)) ctx.patientId = takeUuid(node.patient.id);
    if (!ctx.consultationTopicId) ctx.consultationTopicId = takeUuid(node.consultationTopicId);
    if (!ctx.contextId) ctx.contextId = takeUuid(node.contextId);
    if (!ctx.contextType && typeof node.contextType === 'string' && CONTEXT_TYPE_RE.test(node.contextType)) {
      ctx.contextType = node.contextType;
    }
    ['data', 'encounter', 'consultation', 'consultationTopic'].forEach((key) => {
      if (plain(node[key])) absorbNamed(node[key], ctx, depth + 1);
    });
  }

  // Ids come from the page URL and from request URLs the page has already
  // made (performance resource entries). Nothing here is a hardcoded patient.
  function readSessionContext(input) {
    const src = plain(input) ? input : {};
    const ctx = emptyContext();
    const href = String(src.href || '');
    const encounter = href.match(/\/clinical\/encounter\/overview\/([0-9a-f-]{36})/i);
    if (encounter && UUID_RE.test(encounter[1])) ctx.encounterId = encounter[1];
    const urls = Array.isArray(src.resourceUrls) ? src.resourceUrls : [];
    urls.forEach((url) => {
      const s = String(url);
      const topic = s.match(/[?&]consultationTopicId=([0-9a-f-]{36})/i);
      if (topic && UUID_RE.test(topic[1])) ctx.consultationTopicId = topic[1];
      const draft = s.match(/\/draft-consultation-topic\/([0-9a-f-]{36})/i);
      if (!ctx.consultationTopicId && draft && UUID_RE.test(draft[1])) ctx.consultationTopicId = draft[1];
      const patient =
        s.match(/\/document\/template\/search\/([0-9a-f-]{36})/i) ||
        s.match(/\/new-document-modal\/([0-9a-f-]{36})/i) ||
        s.match(/\/medicus-template-form\/([0-9a-f-]{36})/i) ||
        s.match(/\/create-care-record-communication\/([0-9a-f-]{36})/i);
      if (patient && UUID_RE.test(patient[1])) ctx.patientId = patient[1];
      const contextId = s.match(/[?&]contextId=([0-9a-f-]{36})/i);
      if (contextId && UUID_RE.test(contextId[1])) ctx.contextId = contextId[1];
      const contextType = s.match(/[?&]contextType=([a-z0-9-]{1,64})/i);
      if (contextType && CONTEXT_TYPE_RE.test(contextType[1])) ctx.contextType = contextType[1];
    });
    absorbNamed(src.overview, ctx, 0);
    return ctx;
  }

  function mergeSession(pinned, live) {
    const out = Object.assign({}, plain(pinned) ? pinned : emptyContext());
    const next = plain(live) ? live : emptyContext();
    ['encounterId', 'consultationTopicId', 'patientId', 'contextId', 'contextType'].forEach((key) => {
      if (next[key]) out[key] = next[key];
    });
    return out;
  }

  function sessionDrift(pinned, live) {
    const a = plain(pinned) ? pinned : emptyContext();
    const b = plain(live) ? live : emptyContext();
    const keys = ['encounterId', 'consultationTopicId', 'patientId', 'contextId', 'contextType'];
    return keys.some((key) => a[key] && b[key] && a[key] !== b[key]);
  }

  function pathsFor() {
    return {
      dataEntryList(topicId) {
        return '/clinical/data/data-entry-template/list?consultationTopicId=' + enc(topicId);
      },
      dataEntryForm(topicId, templateId) {
        return '/clinical/data/data-entry-template/create/' + enc(topicId) + '/' + enc(templateId);
      },
      dataEntryCreate: '/clinical/data-entry-template/create',
      documentSearch(patientId, contextId, contextType) {
        return (
          '/clinical/data/document/template/search/' +
          enc(patientId) +
          '?contextId=' +
          enc(contextId) +
          '&contextType=' +
          enc(contextType)
        );
      },
      documentForm(templateId, patientId, contextId, contextType) {
        return (
          '/clinical/data/document/template/form/' +
          enc(templateId) +
          '?patientId=' +
          enc(patientId) +
          '&contextId=' +
          enc(contextId) +
          '&contextType=' +
          enc(contextType)
        );
      },
      documentPreview(templateId) {
        return '/clinical/template/preview-document/' + enc(templateId);
      },
      documentCreate: '/clinical/data/document/template/create',
      reflowForm(patientId, contextId, contextType) {
        return (
          '/clinical/data/document/template/medicus-template-form/' +
          enc(patientId) +
          '?contextId=' +
          enc(contextId) +
          '&contextType=' +
          enc(contextType)
        );
      },
      reflowPreview(slug) {
        return '/clinical/document/template/preview-reflow-document/' + enc(slug);
      },
      reflowCreate: '/clinical/document/template/reflow/create',
      draftTopic(topicId) {
        return '/clinical/data/encounter/consultation-topic/draft-consultation-topic/' + enc(topicId);
      },
      topicEntries(contextId) {
        return '/clinical/encounter/consultation-topic/topic-heading-entries/' + enc(contextId);
      },
      encounterOverview(encounterId) {
        return '/clinical/data/encounter/overview/' + enc(encounterId);
      },
    };
  }

  const PATHS = pathsFor();

  function findShell(node, depth, ready) {
    if (!plain(node) || depth > 4) return null;
    if (ready(node)) return node;
    const keys = ['data', 'result', 'template', 'payload', 'create', 'model', 'form'];
    for (let i = 0; i < keys.length; i += 1) {
      const found = findShell(node[keys[i]], depth + 1, ready);
      if (found) return found;
    }
    return null;
  }

  function dataEntryCreateBody(formJson, ctx, templateId) {
    const topicId = takeUuid(ctx && ctx.consultationTopicId);
    const cardId = typeof templateId === 'string' && UUID_RE.test(templateId) ? templateId : '';
    if (!topicId || !cardId) {
      return {
        ok: false,
        gap: 'This consultation has no topic id for the data-entry insert. Open the slash Template list once, then try again. Nothing was written.',
      };
    }
    const shell = findShell(formJson, 0, function (node) {
      return plain(node.form) && takeUuid(node.dataEntryTemplateVersionId);
    });
    if (!shell) {
      return {
        ok: false,
        gap: 'The data-entry form response had no form object and version id. The capture did not include that body, so the insert did not run.',
      };
    }
    const versionId = takeUuid(shell.dataEntryTemplateVersionId);
    const fromForm = takeUuid(shell.dataEntryTemplateId);
    if (fromForm && fromForm !== cardId) {
      return {
        ok: false,
        gap: 'The form response named a different template id. The insert did not run.',
      };
    }
    const formTopic = takeUuid(shell.consultationTopicId);
    if (formTopic && formTopic !== topicId) {
      return {
        ok: false,
        gap: 'The form response named a different consultation. The insert did not run.',
      };
    }
    let usage = null;
    if (Object.prototype.hasOwnProperty.call(shell, 'consultationUsageId')) {
      usage = shell.consultationUsageId == null ? null : shell.consultationUsageId;
      if (usage != null && typeof usage !== 'string') {
        return {
          ok: false,
          gap: 'consultationUsageId was not a string. The insert did not run.',
        };
      }
    }
    return {
      ok: true,
      body: {
        form: shell.form,
        consultationTopicId: topicId,
        dataEntryTemplateId: fromForm || cardId,
        dataEntryTemplateVersionId: versionId,
        consultationUsageId: usage,
      },
    };
  }

  function documentContextGap(ctx) {
    const patientId = takeUuid(ctx && ctx.patientId);
    const contextId = takeUuid(ctx && ctx.contextId);
    const contextType = ctx && CONTEXT_TYPE_RE.test(ctx.contextType || '') ? ctx.contextType : '';
    if (!patientId || !contextId || !contextType) {
      return 'This page has no patient, context id, and context type for a document insert. Open the slash Document list once, then try again. Nothing was written.';
    }
    return '';
  }

  function findConsultSort(node, depth) {
    if (!plain(node) || depth > 5) return null;
    if (Array.isArray(node.sortOrder) && typeof node.sortOrderHash === 'string' && HASH_RE.test(node.sortOrderHash)) {
      return { sortOrder: node.sortOrder, sortOrderHash: node.sortOrderHash };
    }
    const keys = [
      'data',
      'consultation',
      'consultationTopic',
      'topic',
      'draft',
      'encounter',
      'result',
      'payload',
      'heading',
    ];
    for (let i = 0; i < keys.length; i += 1) {
      const found = findConsultSort(node[keys[i]], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function withNewEntry(sort, uuid) {
    let order;
    try {
      order = JSON.parse(JSON.stringify(sort.sortOrder));
    } catch (err) {
      return null;
    }
    if (!Array.isArray(order) || order.length > 500) return null;
    const already = order.some((row) => row && row.id === uuid);
    if (!already) order.push({ id: uuid, entryType: 'document' });
    return order;
  }

  function documentCreateBody(input) {
    const src = plain(input) ? input : {};
    const gap = documentContextGap(src.ctx);
    if (gap) return { ok: false, gap };
    const templateId = typeof src.templateId === 'string' && UUID_RE.test(src.templateId) ? src.templateId : '';
    const uuid = typeof src.uuid === 'string' && UUID_RE.test(src.uuid) ? src.uuid : '';
    if (!templateId || !uuid) {
      return { ok: false, gap: 'The document insert is missing a template id or a new entry id. Nothing was written.' };
    }
    const shell = findShell(src.formJson, 0, function (node) {
      return plain(node.formValues);
    });
    if (!shell) {
      return {
        ok: false,
        gap: 'The document form response had no formValues object. The capture did not include that body, so the insert did not run.',
      };
    }
    if (
      typeof shell.hiddenFromPatientFacingServices !== 'boolean' ||
      typeof shell.confidentialFromThirdParties !== 'boolean'
    ) {
      return {
        ok: false,
        gap: 'The document form response did not include the visibility flags the slash insert sends. Those flags were not guessed. Nothing was written.',
      };
    }
    const sort = findConsultSort(src.sortJson, 0) || (plain(src.sort) && findConsultSort(src.sort, 0));
    if (!sort) {
      return {
        ok: false,
        gap: 'The consultation did not return sortOrder and sortOrderHash together. The capture had no response body for that pair, and this canvas does not compute a hash. Nothing was written.',
      };
    }
    const sortOrder = withNewEntry(sort, uuid);
    if (!sortOrder) {
      return { ok: false, gap: 'The consultation sort order could not be copied. Nothing was written.' };
    }
    const ctx = src.ctx;
    const previewBody = {
      formValues: shell.formValues,
      patientId: ctx.patientId,
      contextId: ctx.contextId,
      contextType: ctx.contextType,
    };
    const body = {
      templateId,
      patientId: ctx.patientId,
      formValues: shell.formValues,
      hiddenFromPatientFacingServices: shell.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: shell.confidentialFromThirdParties,
      contextId: ctx.contextId,
      contextType: ctx.contextType,
      linkedProblemIds: Array.isArray(shell.linkedProblemIds) ? shell.linkedProblemIds : [],
      problemCode: Object.prototype.hasOwnProperty.call(shell, 'problemCode') ? shell.problemCode : null,
      clinicalCaseId: Object.prototype.hasOwnProperty.call(shell, 'clinicalCaseId') ? shell.clinicalCaseId : null,
      uuid,
      sortOrder,
      sortOrderHash: sort.sortOrderHash,
    };
    return { ok: true, body, previewBody };
  }

  const REFLOW_STRINGS = ['referralDetails', 'referringClinician', 'referralDate', 'title', 'recipientDetails'];

  function reflowCreateBody(input) {
    const src = plain(input) ? input : {};
    const gap = documentContextGap(src.ctx);
    if (gap) return { ok: false, gap };
    const slug = typeof src.slug === 'string' && ID_RE.test(src.slug) && !UUID_RE.test(src.slug) ? src.slug : '';
    const uuid = typeof src.uuid === 'string' && UUID_RE.test(src.uuid) ? src.uuid : '';
    if (!slug || !uuid) {
      return { ok: false, gap: 'The reflow insert is missing a template slug or a new entry id. Nothing was written.' };
    }
    const shell = findShell(src.formJson, 0, function (node) {
      if (typeof node.template === 'string' && node.template !== slug) return false;
      return REFLOW_STRINGS.every((key) => typeof node[key] === 'string');
    });
    if (!shell) {
      return {
        ok: false,
        gap: 'The built-in document form did not include the referral fields the slash insert sends. Nothing was written.',
      };
    }
    if (
      typeof shell.hiddenFromPatientFacingServices !== 'boolean' ||
      typeof shell.confidentialFromThirdParties !== 'boolean'
    ) {
      return {
        ok: false,
        gap: 'The built-in document form did not include the visibility flags. Those flags were not guessed. Nothing was written.',
      };
    }
    const sort = findConsultSort(src.sortJson, 0) || (plain(src.sort) && findConsultSort(src.sort, 0));
    if (!sort) {
      return {
        ok: false,
        gap: 'The consultation did not return sortOrder and sortOrderHash together. Nothing was written.',
      };
    }
    const sortOrder = withNewEntry(sort, uuid);
    if (!sortOrder) return { ok: false, gap: 'The consultation sort order could not be copied. Nothing was written.' };
    const ctx = src.ctx;
    const previewBody = {
      referralDetails: shell.referralDetails,
      referringClinician: shell.referringClinician,
      patientId: ctx.patientId,
      contextId: ctx.contextId,
      contextType: ctx.contextType,
      referralDate: shell.referralDate,
      title: shell.title,
      recipientDetails: shell.recipientDetails,
    };
    const body = {
      template: slug,
      patientId: ctx.patientId,
      contextId: ctx.contextId,
      contextType: ctx.contextType,
      referralDetails: shell.referralDetails,
      referringClinician: shell.referringClinician,
      referralDate: shell.referralDate,
      title: shell.title,
      recipientDetails: shell.recipientDetails,
      hiddenFromPatientFacingServices: shell.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: shell.confidentialFromThirdParties,
      linkedProblemIds: Array.isArray(shell.linkedProblemIds) ? shell.linkedProblemIds : [],
      problemCode: Object.prototype.hasOwnProperty.call(shell, 'problemCode') ? shell.problemCode : null,
      uuid,
      sortOrder,
      sortOrderHash: sort.sortOrderHash,
    };
    return { ok: true, body, previewBody };
  }

  function buildBoard(items, surfaceState) {
    const cleanItems = (Array.isArray(items) ? items : []).map(sanitiseItem).filter(Boolean);
    const byId = new Map(cleanItems.map((item) => [item.id, item]));
    const state = sanitiseSurface(surfaceState);
    const placed = new Set();

    function take(gid, name, locked) {
      const ids = (state.order[gid] || []).filter((id) => byId.has(id) && !placed.has(id));
      ids.forEach((id) => placed.add(id));
      return {
        id: gid,
        name,
        locked,
        items: ids.map((id) => byId.get(id)),
      };
    }

    const groups = [take(UNGROUPED_ID, UNGROUPED_NAME, true)];
    state.groups.forEach((g) => {
      groups.push(take(g.id, g.name, false));
    });
    const leftovers = cleanItems.filter((item) => !placed.has(item.id));
    if (leftovers.length) groups[0].items = groups[0].items.concat(leftovers);
    return { groups };
  }

  function moveItem(surface, itemId, toGroupId, beforeId) {
    const base = sanitiseSurface(surface);
    const id = clamp(itemId, LIMITS.id);
    const dest = clamp(toGroupId, LIMITS.id);
    if (!id || badKey(id) || !ID_RE.test(id) || !Object.prototype.hasOwnProperty.call(base.order, dest)) {
      return { ok: false, error: 'That group is not on the canvas.', surface: base };
    }
    const order = {};
    Object.keys(base.order).forEach((gid) => {
      order[gid] = base.order[gid].filter((existing) => existing !== id);
    });
    const nextDest = order[dest].slice();
    const before = beforeId && beforeId !== id ? clamp(beforeId, LIMITS.id) : '';
    const at = before ? nextDest.indexOf(before) : -1;
    if (at >= 0) nextDest.splice(at, 0, id);
    else nextDest.push(id);
    order[dest] = nextDest.slice(0, LIMITS.items);
    return { ok: true, surface: { groups: base.groups, order } };
  }

  function createGroup(surface, name) {
    const base = sanitiseSurface(surface);
    const clean = clamp(name, LIMITS.name);
    if (!clean) return { ok: false, error: 'Group needs a name.', surface: base };
    if (base.groups.length >= LIMITS.groups) {
      return { ok: false, error: 'Group limit reached.', surface: base };
    }
    const taken = new Set([UNGROUPED_ID].concat(base.groups.map((g) => g.id)));
    let id = slugify(clean) || 'group';
    if (id === UNGROUPED_ID || badKey(id)) id = 'group';
    id = uniqueId(id, taken);
    const groups = base.groups.concat([{ id, name: clean }]);
    const order = Object.assign({}, base.order, { [id]: [] });
    return { ok: true, surface: { groups, order } };
  }

  function renameGroup(surface, groupId, name) {
    const base = sanitiseSurface(surface);
    if (groupId === UNGROUPED_ID) {
      return { ok: false, error: 'That lane keeps its name.', surface: base };
    }
    const clean = clamp(name, LIMITS.name);
    if (!clean) return { ok: false, error: 'Group needs a name.', surface: base };
    if (!base.groups.some((g) => g.id === groupId)) {
      return { ok: false, error: 'Group not found.', surface: base };
    }
    const groups = base.groups.map((g) => (g.id === groupId ? { id: g.id, name: clean } : g));
    return { ok: true, surface: { groups, order: base.order } };
  }

  function deleteGroup(surface, groupId) {
    const base = sanitiseSurface(surface);
    if (groupId === UNGROUPED_ID) {
      return { ok: false, error: 'That lane stays.', surface: base };
    }
    if (!base.groups.some((g) => g.id === groupId)) {
      return { ok: false, error: 'Group not found.', surface: base };
    }
    const groups = base.groups.filter((g) => g.id !== groupId);
    const moving = base.order[groupId] || [];
    const order = { [UNGROUPED_ID]: (base.order[UNGROUPED_ID] || []).concat(moving) };
    groups.forEach((g) => {
      order[g.id] = (base.order[g.id] || []).slice();
    });
    return { ok: true, surface: { groups, order } };
  }

  function replaceSurface(config, surface, surfaceState) {
    const next = cloneConfig(config);
    if (SURFACES.indexOf(surface) === -1) return next;
    next.surfaces[surface] = sanitiseSurface(surfaceState);
    return next;
  }

  function sameConfig(a, b) {
    return JSON.stringify(sanitiseConfig(a)) === JSON.stringify(sanitiseConfig(b));
  }

  function placementMap(surface) {
    const map = {};
    const ids = [UNGROUPED_ID].concat(surface.groups.map((g) => g.id));
    ids.forEach((gid) => {
      (surface.order[gid] || []).forEach((itemId, index) => {
        map[itemId] = gid + '#' + index;
      });
    });
    return map;
  }

  function diffSummary(before, after) {
    const a = sanitiseConfig(before);
    const b = sanitiseConfig(after);
    const lines = [];
    SURFACES.forEach((surface) => {
      const label = surface === 'templates' ? 'Templates' : 'Documents';
      const left = a.surfaces[surface];
      const right = b.surfaces[surface];
      const leftNames = new Map(left.groups.map((g) => [g.id, g.name]));
      const rightNames = new Map(right.groups.map((g) => [g.id, g.name]));
      rightNames.forEach((name, id) => {
        if (!leftNames.has(id)) lines.push(label + ': new group “' + name + '”');
        else if (leftNames.get(id) !== name) {
          lines.push(label + ': renamed “' + leftNames.get(id) + '” to “' + name + '”');
        }
      });
      leftNames.forEach((name, id) => {
        if (!rightNames.has(id)) lines.push(label + ': removed group “' + name + '”');
      });
      const pa = placementMap(left);
      const pb = placementMap(right);
      const ids = new Set(Object.keys(pa).concat(Object.keys(pb)));
      let moves = 0;
      ids.forEach((id) => {
        if (pa[id] !== pb[id]) moves += 1;
      });
      if (moves) {
        lines.push(label + ': ' + moves + ' card position' + (moves === 1 ? '' : 's') + ' changed');
      }
    });
    if (!lines.length) lines.push('No group or card changes.');
    return lines;
  }

  function confirmPayload(draft, catalogue) {
    const cfg = sanitiseConfig(draft);
    const cat = plain(catalogue) ? catalogue : {};
    SURFACES.forEach((surface) => {
      const items = Array.isArray(cat[surface]) ? cat[surface] : [];
      const order = cfg.surfaces[surface].order;
      const known = new Set();
      Object.keys(order).forEach((gid) => {
        order[gid].forEach((id) => known.add(id));
      });
      items.forEach((item) => {
        const clean = sanitiseItem(item);
        if (!clean || known.has(clean.id)) return;
        order[UNGROUPED_ID].push(clean.id);
        known.add(clean.id);
      });
    });
    return cfg;
  }

  const api = {
    CONFIG_KEY,
    CONFIG_VERSION,
    SURFACES,
    UNGROUPED_ID,
    UNGROUPED_NAME,
    LIMITS,
    DEFAULT_GROUPS,
    PATHS,
    seedConfig,
    sanitiseConfig,
    sanitiseItem,
    cloneConfig,
    parseList,
    readSessionContext,
    mergeSession,
    sessionDrift,
    dataEntryCreateBody,
    documentCreateBody,
    reflowCreateBody,
    findConsultSort,
    buildBoard,
    moveItem,
    createGroup,
    renameGroup,
    deleteGroup,
    replaceSurface,
    sameConfig,
    diffSummary,
    confirmPayload,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TemplateOrganiserCore = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
