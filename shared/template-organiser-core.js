// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template & document organiser core
//
// Pure logic: no DOM, no chrome.*, no fetch. The canvas owns the overlay.
// Practice group definitions and card order live in chrome.storage.local at
// templateOrganiser.config. Medicus has no group field on these lists
// (capture 2026-09-24: every DOM tag was untagged). Membership is a local
// overlay keyed by the Medicus template id.
//
// List parsing and the practice API host live here so a test can lock them
// without a network call. The client performs catalogue GETs only. Opening
// a template is Medicus’s own form (the slash Use-template path). This file
// does not build a create body.

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
    'dataEntryTemplates',
    'list',
    'page',
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
    const nested = plain(json.data) ? json.data.data : null;
    return from(json) || from(json.data) || from(nested);
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

  const HEADING_ID_RE =
    /^heading-(history|examination|impression|plan)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const HEADING_CONTEXT_TYPE = 'consultation-topic-heading';
  const HEADING_KINDS = { history: true, examination: true, impression: true, plan: true };

  // The slash menu is labelled heading-history-{uuid} (and the same shape for
  // examination, impression, and plan). That uuid is the heading context, not
  // the consultation topic id.
  function headingContextId(value) {
    const parts = String(value || '')
      .trim()
      .split(/\s+/);
    for (let i = 0; i < parts.length; i += 1) {
      const match = HEADING_ID_RE.exec(parts[i]);
      if (match && UUID_RE.test(match[2])) return match[2];
    }
    return '';
  }

  function headingKindToken(value) {
    const parts = String(value || '')
      .trim()
      .split(/\s+/);
    for (let i = 0; i < parts.length; i += 1) {
      const match = /^heading-(history|examination|impression|plan)(?:-|$)/i.exec(parts[i]);
      if (match) return match[1].toLowerCase();
    }
    return '';
  }

  function plainHeadingKind(value) {
    const text = String(value || '')
      .replace(/[!\u2013\u2014]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return HEADING_KINDS[text] ? text : '';
  }

  // A heading row may carry a bare uuid or the slash-menu id. The title is
  // the kind only when it is exactly one of the four clinical words.
  function headingRecord(heading) {
    if (!plain(heading)) return null;
    const idText = typeof heading.id === 'string' ? heading.id : '';
    const altText = typeof heading.headingId === 'string' ? heading.headingId : '';
    const uuid = takeUuid(idText) || takeUuid(altText) || headingContextId(idText) || headingContextId(altText);
    if (!uuid) return null;
    const kind =
      headingKindToken(idText) ||
      headingKindToken(altText) ||
      plainHeadingKind(heading.title) ||
      plainHeadingKind(heading.name) ||
      plainHeadingKind(heading.label) ||
      plainHeadingKind(heading.type) ||
      plainHeadingKind(heading.headingType);
    return { uuid, kind };
  }

  function absorbNamed(node, ctx, depth) {
    if (!plain(node) || depth > 4) return;
    if (!ctx.patientId) ctx.patientId = takePatient(node);
    if (!ctx.consultationTopicId) ctx.consultationTopicId = takeUuid(node.consultationTopicId);
    if (!ctx.contextId) ctx.contextId = takeUuid(node.contextId);
    if (!ctx.contextType && typeof node.contextType === 'string' && CONTEXT_TYPE_RE.test(node.contextType)) {
      ctx.contextType = node.contextType;
    }
    ['data', 'encounter', 'consultation', 'consultationTopic'].forEach((key) => {
      if (plain(node[key])) absorbNamed(node[key], ctx, depth + 1);
    });
  }

  function takePatient(node) {
    if (!plain(node)) return '';
    if (takeUuid(node.patientId)) return takeUuid(node.patientId);
    if (!plain(node.patient)) return '';
    return takeUuid(node.patient.id) || takeUuid(node.patient.patientId);
  }

  function sameHeading(value, headingId) {
    if (!headingId || typeof value !== 'string') return false;
    if (takeUuid(value) === headingId) return true;
    return headingContextId(value) === headingId;
  }

  function ownsHeading(topic, headingId) {
    if (!headingId || !plain(topic) || !Array.isArray(topic.headings)) return false;
    return topic.headings.some((heading) => {
      if (!plain(heading)) return false;
      return sameHeading(heading.id, headingId) || sameHeading(heading.headingId, headingId);
    });
  }

  function collectTopics(node, out, depth) {
    if (!plain(node) || depth > 5 || out.length >= 32) return;
    if (Array.isArray(node.consultationTopics)) {
      node.consultationTopics.forEach((topic) => {
        if (plain(topic) && out.length < 32) out.push(topic);
      });
    }
    ['data', 'encounter', 'consultation'].forEach((key) => {
      if (plain(node[key])) collectTopics(node[key], out, depth + 1);
    });
  }

  // Headings that can fill document search. A focused uuid wins. A focused
  // kind (history, examination, impression, plan) counts only when exactly
  // one heading of that kind has an id — two would be a guess.
  function headingHits(topics, focusedUuid, focusedKind) {
    const hits = [];
    topics.forEach((topic) => {
      if (!plain(topic) || !Array.isArray(topic.headings)) return;
      topic.headings.forEach((heading) => {
        const rec = headingRecord(heading);
        if (!rec) return;
        if (focusedUuid && rec.uuid === focusedUuid) hits.push({ topic, rec });
        else if (!focusedUuid && focusedKind && rec.kind === focusedKind) hits.push({ topic, rec });
      });
    });
    return hits;
  }

  // Live encounter overview keeps the topic on consultationTopics[].id (or
  // consultationTopicId) and the patient on the topic or a nested patient.
  // A scalar consultationTopicId is not what that endpoint returns. When
  // several topics are present, the one whose headings include the focused
  // heading is the list to read. That heading's uuid is the document
  // contextId, with contextType consultation-topic-heading.
  function applyOverviewTopics(ctx, overview, focusedUuid, focusedKind) {
    const topics = [];
    collectTopics(overview, topics, 0);
    if (!topics.length) return;
    const hits = headingHits(topics, focusedUuid, focusedKind);
    const uuidHit = focusedUuid ? hits.find((hit) => hit.rec.uuid === focusedUuid) : null;
    const uniqueHit = !focusedUuid && hits.length === 1 ? hits[0] : null;
    const owner =
      (uuidHit && uuidHit.topic) ||
      (focusedUuid ? topics.find((topic) => ownsHeading(topic, focusedUuid)) : null) ||
      (uniqueHit && uniqueHit.topic) ||
      null;
    const chosen = owner || (!ctx.consultationTopicId ? topics[0] : null);
    if (chosen) {
      const topicId = takeUuid(chosen.id) || takeUuid(chosen.consultationTopicId);
      if (topicId && (owner || !ctx.consultationTopicId)) ctx.consultationTopicId = topicId;
    }
    if (!ctx.patientId) {
      const fromChosen = chosen ? takePatient(chosen) : '';
      ctx.patientId = fromChosen || takePatient(topics[0]) || takePatient(overview);
    }
    if (!ctx.contextId && focusedUuid) {
      ctx.contextId = focusedUuid;
      ctx.contextType = HEADING_CONTEXT_TYPE;
    } else if (!ctx.contextId && uniqueHit) {
      ctx.contextId = uniqueHit.rec.uuid;
      if (!ctx.contextType) ctx.contextType = HEADING_CONTEXT_TYPE;
    }
    if (ctx.contextId && !ctx.contextType && (focusedUuid || uniqueHit)) {
      ctx.contextType = HEADING_CONTEXT_TYPE;
    }
  }

  function fillUuid(current, match) {
    if (!match || !UUID_RE.test(match[1])) return current;
    return match[1];
  }

  // Ids come from the page URL, from request URLs the page has already made,
  // from the focused heading id, and from encounter overview JSON. Nothing
  // here is a hardcoded patient or topic.
  function readSessionContext(input) {
    const src = plain(input) ? input : {};
    const ctx = emptyContext();
    const href = String(src.href || '');
    const encounter = href.match(/\/clinical\/encounter\/overview\/([0-9a-f-]{36})/i);
    if (encounter && UUID_RE.test(encounter[1])) ctx.encounterId = encounter[1];
    const urls = Array.isArray(src.resourceUrls) ? src.resourceUrls : [];
    urls.forEach((url) => {
      const s = String(url);
      const topicQuery = s.match(/[?&]consultationTopicId=([0-9a-f-]{36})/i);
      if (topicQuery && UUID_RE.test(topicQuery[1])) ctx.consultationTopicId = topicQuery[1];
      const draft = s.match(/\/draft-consultation-topic\/([0-9a-f-]{36})/i);
      if (!ctx.consultationTopicId) ctx.consultationTopicId = fillUuid('', draft);
      const summary = s.match(/\/clinical-summary\/summary\/([0-9a-f-]{36})/i);
      if (summary && UUID_RE.test(summary[1])) ctx.patientId = summary[1];
      const encounterQuery = s.match(/[?&]encounterId=([0-9a-f-]{36})/i);
      if (!ctx.encounterId) ctx.encounterId = fillUuid('', encounterQuery);
      const patient =
        s.match(/\/document\/template\/search\/([0-9a-f-]{36})/i) ||
        s.match(/\/new-document-modal\/([0-9a-f-]{36})/i) ||
        s.match(/\/medicus-template-form\/([0-9a-f-]{36})/i) ||
        s.match(/\/create-care-record-communication\/([0-9a-f-]{36})/i);
      if (patient && UUID_RE.test(patient[1])) ctx.patientId = patient[1];
      const headingEntries = s.match(/\/topic-heading-entries\/([0-9a-f-]{36})/i);
      if (headingEntries && UUID_RE.test(headingEntries[1])) {
        ctx.contextId = headingEntries[1];
        if (!ctx.contextType) ctx.contextType = HEADING_CONTEXT_TYPE;
      }
      const contextId = s.match(/[?&]contextId=([0-9a-f-]{36})/i);
      if (contextId && UUID_RE.test(contextId[1])) ctx.contextId = contextId[1];
      const contextType = s.match(/[?&]contextType=([a-z0-9-]{1,64})/i);
      if (contextType && CONTEXT_TYPE_RE.test(contextType[1])) ctx.contextType = contextType[1];
    });
    const focusedHeading = headingContextId(src.headingId);
    const focusedKind = headingKindToken(src.headingId) || plainHeadingKind(src.headingKind);
    if (focusedHeading) {
      ctx.contextId = focusedHeading;
      ctx.contextType = HEADING_CONTEXT_TYPE;
    }
    if (plain(src.overview)) {
      absorbNamed(src.overview, ctx, 0);
      applyOverviewTopics(ctx, src.overview, focusedHeading, focusedKind);
    }
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

  // Practice API host is {siteId}.api.{page hostname}. The page host serves
  // the SPA shell for these paths (200 HTML), which is not the list JSON.
  const SITE_ID_RE = /^[a-f0-9]{4,8}$/i;

  function apiOriginFromResource(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (err) {
      return '';
    }
    const host = parsed.hostname || '';
    const match = /^([a-f0-9]{4,8})\.api\.(.+)$/i.exec(host);
    if (!match || match[2].indexOf('medicus') === -1) return '';
    return parsed.protocol + '//' + host;
  }

  function resolveApiBase(input) {
    const src = plain(input) ? input : {};
    const urls = Array.isArray(src.resourceUrls) ? src.resourceUrls : [];
    for (let i = 0; i < urls.length; i += 1) {
      const fromResource = apiOriginFromResource(urls[i]);
      if (fromResource) return fromResource;
    }
    let hostname = typeof src.hostname === 'string' ? src.hostname : '';
    let pathname = typeof src.pathname === 'string' ? src.pathname : '';
    if ((!hostname || !pathname) && src.href) {
      try {
        const parsed = new URL(String(src.href));
        if (!hostname) hostname = parsed.hostname;
        if (!pathname) pathname = parsed.pathname;
      } catch (err) {
        /* href was not a URL */
      }
    }
    const seg = String(pathname || '')
      .split('/')
      .filter(Boolean)[0];
    let siteId = '';
    if (seg && SITE_ID_RE.test(seg)) siteId = seg.toLowerCase();
    else if (typeof src.practiceCode === 'string' && SITE_ID_RE.test(src.practiceCode)) {
      siteId = src.practiceCode.toLowerCase();
    }
    if (!siteId || !hostname || hostname.indexOf('medicus') === -1) return '';
    return 'https://' + siteId + '.api.' + hostname;
  }

  const API_RING_MAX = 40;

  function isClinicalApiUrl(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (err) {
      return false;
    }
    const host = parsed.hostname || '';
    if (!/\.api\./i.test(host) || host.indexOf('medicus') === -1) return false;
    return /\/clinical\/|\/patient\/data\//.test(parsed.pathname || '');
  }

  // The performance resource buffer is about 250 entries and rotates. Keep a
  // short ring of practice-API clinical URLs so a later open can still see
  // draft-consultation-topic, clinical-summary, and topic-heading-entries.
  function rememberClinicalUrl(ring, url) {
    const next = Array.isArray(ring) ? ring.filter((item) => typeof item === 'string') : [];
    const value = String(url || '');
    if (!isClinicalApiUrl(value)) return next.slice(-API_RING_MAX);
    const without = next.filter((item) => item !== value);
    without.push(value);
    return without.slice(-API_RING_MAX);
  }

  function mergeResourceUrls(ring, live) {
    const out = [];
    const seen = new Set();
    function add(list) {
      (Array.isArray(list) ? list : []).forEach((url) => {
        const value = String(url || '');
        if (!value || seen.has(value)) return;
        seen.add(value);
        out.push(value);
      });
    }
    add(ring);
    add(live);
    return out.slice(-80);
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

  function normaliseLabel(value) {
    return String(value || '')
      .replace(/[!\u2013\u2014]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // History, examination, impression, plan. A heading id from the slash menu
  // (heading-history-{uuid}) wins. A visible heading of those four words
  // counts only when the focused control is editable, so a mention of "plan"
  // in other text does not.
  function clinicalFieldKind(input) {
    const src = plain(input) ? input : {};
    const id = String(src.id || '');
    const labelledBy = String(src.labelledBy || '');
    const idMatch = /^heading-(history|examination|impression|plan)(?:-|$)/i.exec(id);
    if (idMatch) return idMatch[1].toLowerCase();
    const labelMatch = /^heading-(history|examination|impression|plan)(?:-|$)/i.exec(labelledBy);
    if (labelMatch) return labelMatch[1].toLowerCase();
    if (src.editable) {
      const text = normaliseLabel(src.headingText);
      if (text === 'history' || text === 'examination' || text === 'impression' || text === 'plan') return text;
    }
    return '';
  }

  // The slash menu item that opens Medicus's own list. The canvas clicks it
  // only when the matching Use / Create control is not already on the page.
  function nativeMenuId(item) {
    const src = plain(item) ? item : {};
    if (src.insert === 'data-entry') return 'id-template';
    if (src.insert === 'document' || src.insert === 'reflow') return 'id-document';
    return '';
  }

  // One plan for every card. Which column holds the card is not an input.
  // posts stays false: the suite does not build or send a create body.
  function nativeOpenPlan(item) {
    const src = plain(item) ? item : {};
    const insert = INSERTS.indexOf(src.insert) !== -1 ? src.insert : '';
    return { posts: false, menuId: nativeMenuId(src), insert };
  }

  // True when a live Medicus control is the open path for this card.
  // Data-entry: "Use template" on the card with that title.
  // Documents: a control titled "Create {title}", or the same Use template pair.
  function nativeControlMatches(item, control) {
    const src = plain(item) ? item : {};
    const ctl = plain(control) ? control : {};
    const want = normaliseLabel(src.title);
    if (!want) return false;
    const text = normaliseLabel(ctl.text);
    const titleAttr = normaliseLabel(ctl.title);
    const card = normaliseLabel(ctl.cardTitle);
    if (src.insert === 'data-entry') {
      return text === 'use template' && card === want;
    }
    if (src.insert === 'document' || src.insert === 'reflow') {
      if (titleAttr === normaliseLabel('Create ' + String(src.title || ''))) return true;
      if (text === 'use template' && card === want) return true;
      return false;
    }
    return false;
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

  function queryText(query) {
    return String(query ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // View filter only. Group columns stay, including a pot whose cards all miss.
  // Title, preview, and category are the haystack. Stored order is not touched.
  function filterBoard(board, query) {
    const q = queryText(query);
    const groups = board && Array.isArray(board.groups) ? board.groups : [];
    return {
      groups: groups.map((group) => {
        const items = Array.isArray(group && group.items) ? group.items : [];
        const visible = q
          ? items.filter((item) => {
              const clean = sanitiseItem(item);
              if (!clean) return false;
              const hay = (clean.title + '\n' + clean.preview + '\n' + clean.category).toLowerCase();
              return hay.indexOf(q) !== -1;
            })
          : items.slice();
        return {
          id: group && group.id,
          name: group && group.name,
          locked: !!(group && group.locked),
          items: visible,
        };
      }),
    };
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
    headingContextId,
    rememberClinicalUrl,
    mergeResourceUrls,
    mergeSession,
    sessionDrift,
    resolveApiBase,
    clinicalFieldKind,
    nativeMenuId,
    nativeOpenPlan,
    nativeControlMatches,
    buildBoard,
    filterBoard,
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
