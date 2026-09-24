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
  const PERSONAL_KEY = 'templateOrganiser.personal';
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

  function sanitiseIdList(list, used) {
    const clean = [];
    (Array.isArray(list) ? list : []).forEach((itemId) => {
      if (typeof itemId !== 'string') return;
      const id = clamp(itemId, LIMITS.id);
      if (!id || badKey(id) || !ID_RE.test(id) || used.has(id)) return;
      used.add(id);
      clean.push(id);
    });
    return clean.slice(0, LIMITS.items);
  }

  function sanitiseNameMap(raw) {
    const out = {};
    if (!plain(raw)) return out;
    Object.keys(raw).forEach((key) => {
      if (badKey(key)) return;
      const id = slugify(key);
      if (!id || badKey(id) || id === UNGROUPED_ID) return;
      const name = clamp(raw[key], LIMITS.name);
      if (!name || badKey(name)) return;
      out[id] = name;
    });
    return out;
  }

  // Personal overlay only: extra folders, renamed practice folders, hidden
  // practice folders, and order lists that differ from the practice default.
  // Practice group definitions are not copied in here.
  function sanitisePersonalSurface(raw) {
    const src = plain(raw) ? raw : {};
    const groups = sanitiseSurface({ groups: src.groups, order: {} }).groups;
    const groupIds = new Set(groups.map((g) => g.id));
    const removed = [];
    (Array.isArray(src.removed) ? src.removed : []).forEach((value) => {
      if (removed.length >= LIMITS.groups) return;
      const id = slugify(value);
      if (!id || badKey(id) || id === UNGROUPED_ID || removed.indexOf(id) !== -1) return;
      removed.push(id);
    });
    const names = sanitiseNameMap(src.names);
    removed.forEach((id) => {
      delete names[id];
    });
    const used = new Set();
    const order = {};
    const rawOrder = plain(src.order) ? src.order : {};
    Object.keys(rawOrder).forEach((key) => {
      if (badKey(key)) return;
      const gid = key === UNGROUPED_ID ? UNGROUPED_ID : slugify(key);
      if (!gid || badKey(gid) || removed.indexOf(gid) !== -1) return;
      if (gid !== UNGROUPED_ID && !groupIds.has(gid) && !ID_RE.test(gid)) return;
      order[gid] = sanitiseIdList(rawOrder[key], used);
    });
    return { groups, order, removed, names };
  }

  function emptyPersonal() {
    const surfaces = {};
    SURFACES.forEach((name) => {
      surfaces[name] = { groups: [], order: {}, removed: [], names: {} };
    });
    return { version: CONFIG_VERSION, surfaces };
  }

  function sanitisePersonal(raw) {
    const src = plain(raw) ? raw : {};
    const surfacesIn = plain(src.surfaces) ? src.surfaces : {};
    const surfaces = {};
    SURFACES.forEach((name) => {
      surfaces[name] = sanitisePersonalSurface(surfacesIn[name]);
    });
    return { version: CONFIG_VERSION, surfaces };
  }

  // Practice default underneath, personal overlay on top. A card the person
  // has not moved stays where the practice put it. A new catalogue id that
  // neither side has filed still falls through to Not in a group at render.
  function overlayConfig(practice, personal) {
    const base = sanitiseConfig(practice);
    const over = personal == null ? emptyPersonal() : sanitisePersonal(personal);
    const surfaces = {};
    SURFACES.forEach((name) => {
      const p = base.surfaces[name];
      const o = over.surfaces[name];
      const removed = new Set(o.removed);
      const groups = [];
      p.groups.forEach((g) => {
        if (removed.has(g.id)) return;
        groups.push({ id: g.id, name: o.names[g.id] || g.name });
      });
      o.groups.forEach((g) => {
        if (removed.has(g.id) || groups.some((existing) => existing.id === g.id)) return;
        groups.push(g);
      });
      const trimmed = groups.slice(0, LIMITS.groups);
      const groupIds = [UNGROUPED_ID].concat(trimmed.map((g) => g.id));
      const order = {};
      const used = new Set();
      groupIds.forEach((gid) => {
        order[gid] = [];
      });
      groupIds.forEach((gid) => {
        if (!Object.prototype.hasOwnProperty.call(o.order, gid)) return;
        (o.order[gid] || []).forEach((id) => {
          if (used.has(id) || order[gid].length >= LIMITS.items) return;
          used.add(id);
          order[gid].push(id);
        });
      });
      groupIds.forEach((gid) => {
        if (Object.prototype.hasOwnProperty.call(o.order, gid)) return;
        (p.order[gid] || []).forEach((id) => {
          if (used.has(id) || order[gid].length >= LIMITS.items) return;
          used.add(id);
          order[gid].push(id);
        });
      });
      Object.keys(p.order).forEach((gid) => {
        (p.order[gid] || []).forEach((id) => {
          if (used.has(id) || order[UNGROUPED_ID].length >= LIMITS.items) return;
          used.add(id);
          order[UNGROUPED_ID].push(id);
        });
      });
      surfaces[name] = sanitiseSurface({ groups: trimmed, order });
    });
    return { version: CONFIG_VERSION, surfaces };
  }

  function listsEqual(a, b) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function personalDelta(practice, effective) {
    const base = sanitiseConfig(practice);
    const next = sanitiseConfig(effective);
    const surfaces = {};
    SURFACES.forEach((name) => {
      const p = base.surfaces[name];
      const e = next.surfaces[name];
      const practiceIds = new Set(p.groups.map((g) => g.id));
      const effectiveIds = new Set(e.groups.map((g) => g.id));
      const removed = p.groups.filter((g) => !effectiveIds.has(g.id)).map((g) => g.id);
      const groups = e.groups.filter((g) => !practiceIds.has(g.id));
      const names = {};
      e.groups.forEach((g) => {
        const prior = p.groups.find((item) => item.id === g.id);
        if (prior && prior.name !== g.name) names[g.id] = g.name;
      });
      const order = {};
      const ids = [UNGROUPED_ID].concat(e.groups.map((g) => g.id));
      ids.forEach((gid) => {
        if (!listsEqual(p.order[gid], e.order[gid])) order[gid] = (e.order[gid] || []).slice();
      });
      surfaces[name] = { groups, order, removed, names };
    });
    return sanitisePersonal({ version: CONFIG_VERSION, surfaces });
  }

  function asList(json) {
    if (Array.isArray(json)) return json;
    if (!plain(json)) return null;
    // An empty array must not hide a later key that actually holds the rows.
    // Document search can return items: [] beside the tab arrays.
    function from(node) {
      if (Array.isArray(node)) return node.length ? node : null;
      if (!plain(node)) return null;
      let empty = null;
      for (let i = 0; i < LIST_KEYS.length; i += 1) {
        const v = node[LIST_KEYS[i]];
        if (Array.isArray(v)) {
          if (v.length) return v;
          if (!empty) empty = v;
        } else if (plain(v)) {
          const nestedKeys = ['items', 'content', 'records'];
          for (let n = 0; n < nestedKeys.length; n += 1) {
            const inner = v[nestedKeys[n]];
            if (!Array.isArray(inner)) continue;
            if (inner.length) return inner;
            if (!empty) empty = inner;
          }
        }
      }
      return empty;
    }
    const nested = plain(json.data) ? json.data.data : null;
    const found = from(json) || from(json.data) || from(nested);
    return found;
  }

  function templateLike(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    let good = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!plain(row)) return false;
      if (Array.isArray(row.headings) || Array.isArray(row.consultationTopics)) return false;
      const title = firstString(row, ['name', 'title', 'label', 'templateName', 'displayName', 'documentName']);
      const id = firstString(row, ['id', 'templateId', 'documentTemplateId', 'uuid', 'slug', 'template']);
      if (title || id || plain(row.documentTemplate) || plain(row.template) || plain(row.dataEntryTemplate)) good += 1;
    }
    return good > 0 && good >= Math.ceil(rows.length / 2);
  }

  // Document search is tabbed in Medicus (Document, Referral Form). Those
  // arrays are not named items. consultationTopics is an encounter, not a list.
  function documentRows(json) {
    const direct = asList(json);
    if (templateLike(direct)) return direct;
    const buckets = [];
    function walk(node, depth) {
      if (node == null || depth > 4) return;
      if (Array.isArray(node)) {
        if (templateLike(node)) buckets.push(node);
        return;
      }
      if (!plain(node)) return;
      Object.keys(node).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(node, key)) return;
        if (key === '__proto__' || key === 'constructor') return;
        if (key === 'consultationTopics' || key === 'headings' || key === 'entries' || key === 'linkedProblems') {
          return;
        }
        walk(node[key], depth + 1);
      });
    }
    walk(json, 0);
    if (!buckets.length) return direct;
    const out = [];
    buckets.forEach((bucket) => {
      bucket.forEach((row) => out.push(row));
    });
    return out;
  }

  function catalogueRow(raw) {
    if (!plain(raw)) return raw;
    const nested = plain(raw.documentTemplate)
      ? raw.documentTemplate
      : plain(raw.dataEntryTemplate)
        ? raw.dataEntryTemplate
        : plain(raw.template)
          ? raw.template
          : null;
    if (!nested) return raw;
    return Object.assign({}, nested, raw);
  }

  // The list GET responses were not in the capture. Accept an array or a
  // short list of envelopes. A shape that matches none of those is a gap,
  // not a guessed row.
  function parseList(json, surface) {
    const rows = surface === 'documents' ? documentRows(json) : asList(json);
    if (!rows) {
      return {
        ok: false,
        items: [],
        gap: 'The list response did not match a shape this canvas can read. The capture stored no response body for this endpoint.',
      };
    }
    const items = [];
    rows.forEach((incoming) => {
      const raw = catalogueRow(incoming);
      if (!plain(raw)) return;
      const id = firstString(raw, ['id', 'templateId', 'dataEntryTemplateId', 'documentTemplateId', 'uuid', 'value']);
      const slug = firstString(raw, ['template', 'slug', 'reflowTemplate', 'templateCode', 'medicusTemplate']);
      const title = firstString(raw, ['name', 'title', 'label', 'templateName', 'displayName', 'documentName']);
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
    const altText =
      typeof heading.headingId === 'string'
        ? heading.headingId
        : typeof heading.consultationTopicHeadingId === 'string'
          ? heading.consultationTopicHeadingId
          : typeof heading.uuid === 'string'
            ? heading.uuid
            : '';
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

  // draft-consultation-topic is the topic itself, not an encounter overview.
  // Wrap it so the same heading walk can fill document context.
  function topicEnvelope(json) {
    let node = json;
    if (
      plain(node) &&
      plain(node.data) &&
      !Array.isArray(node.consultationTopics) &&
      !Array.isArray(node.headings) &&
      !Array.isArray(node.consultationTopicHeadings)
    ) {
      node = node.data;
    }
    if (!plain(node)) return null;
    if (Array.isArray(node.consultationTopics)) return node;
    const headings = Array.isArray(node.headings)
      ? node.headings
      : Array.isArray(node.consultationTopicHeadings)
        ? node.consultationTopicHeadings
        : null;
    const id = takeUuid(node.id) || takeUuid(node.consultationTopicId);
    if (!id && !headings) return null;
    const topic = Object.assign({}, node);
    if (headings) topic.headings = headings;
    if (!topic.id && id) topic.id = id;
    return { consultationTopics: [topic] };
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

  function consultActionLabel(value) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!text || text.length > 160) return false;
    return /(?:^|\s)(complete consultation|complete encounter|save consultation|park consultation|end consultation|finish consultation)$/.test(
      text
    );
  }

  // Sit to the left of the consult action, in the main pane. Fall above it
  // when the left edge has no room. Never pin to the window's bottom-right.
  function launcherAnchorBox(anchor, size, viewport) {
    const a = plain(anchor) ? anchor : {};
    const w = Math.max(1, Number(size && size.width) || 220);
    const h = Math.max(1, Number(size && size.height) || 32);
    const vw = Math.max(1, Number(viewport && viewport.width) || 1280);
    const vh = Math.max(1, Number(viewport && viewport.height) || 800);
    const gap = 8;
    const anchorLeft = Number(a.left) || 0;
    const anchorTop = Number(a.top) || 0;
    const anchorRight = Number(a.right) || anchorLeft;
    const anchorBottom = Number(a.bottom) || anchorTop;
    let left = anchorLeft - w - gap;
    let top = anchorTop + Math.max(0, (anchorBottom - anchorTop - h) / 2);
    if (left < gap) {
      left = Math.min(Math.max(gap, anchorRight - w), vw - w - gap);
      top = anchorTop - h - gap;
    }
    if (top < gap) top = anchorBottom + gap;
    if (top + h > vh - gap) top = Math.max(gap, vh - h - gap);
    if (left + w > vw - gap) left = Math.max(gap, vw - w - gap);
    return { left: left, top: top };
  }

  function launcherPaneBox(pane, size) {
    if (!plain(pane)) return null;
    const w = Math.max(1, Number(size && size.width) || 220);
    const h = Math.max(1, Number(size && size.height) || 32);
    const left = Number(pane.left) || 0;
    const right = Number(pane.right) || left;
    const topEdge = Number(pane.top) || 0;
    const bottom = Number(pane.bottom) || topEdge;
    if (right - left < 80 || bottom - topEdge < 80) return null;
    return {
      left: Math.max(left + 8, right - w - 16),
      top: Math.max(topEdge + 8, bottom - h - 16),
    };
  }

  function unionRect(rects) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    rects.forEach((rect) => {
      const r = plain(rect) ? rect : {};
      left = Math.min(left, Number(r.left) || 0);
      top = Math.min(top, Number(r.top) || 0);
      right = Math.max(right, Number(r.right) || 0);
      bottom = Math.max(bottom, Number(r.bottom) || 0);
    });
    if (left === Infinity) return null;
    return { left, top, right, bottom };
  }

  function sameActionRow(rect, band) {
    const mid = ((Number(rect.top) || 0) + (Number(rect.bottom) || 0)) / 2;
    const top = Number(band.top) || 0;
    const bottom = Number(band.bottom) || 0;
    return mid >= top - 6 && mid <= bottom + 6;
  }

  function adjacentToCluster(union, rect) {
    const width = (Number(rect.right) || 0) - (Number(rect.left) || 0);
    const height = (Number(rect.bottom) || 0) - (Number(rect.top) || 0);
    if (width < 8 || height < 8 || width > 360 || height > 80) return false;
    if (!sameActionRow(rect, union)) return false;
    const gap = 24;
    return (Number(rect.right) || 0) >= union.left - gap && (Number(rect.left) || 0) <= union.right + gap;
  }

  function overlapsBox(box, size, rect) {
    const left = Number(box && box.left) || 0;
    const top = Number(box && box.top) || 0;
    const right = left + (Number(size && size.width) || 0);
    const bottom = top + (Number(size && size.height) || 0);
    const r = plain(rect) ? rect : {};
    return (
      left < (Number(r.right) || 0) - 1 &&
      right > (Number(r.left) || 0) + 1 &&
      top < (Number(r.bottom) || 0) - 1 &&
      bottom > (Number(r.top) || 0) + 1
    );
  }

  // After the button has its real width, step it off any footer control it
  // still covers. Measurement can be a few pixels short of the painted pill.
  function clearLauncherBox(box, size, blockers, viewport) {
    const w = Math.max(1, Number(size && size.width) || 220);
    const h = Math.max(1, Number(size && size.height) || 32);
    const vw = Math.max(1, Number(viewport && viewport.width) || 1280);
    const vh = Math.max(1, Number(viewport && viewport.height) || 800);
    const gap = 8;
    let left = Number(box && box.left) || 0;
    let top = Number(box && box.top) || 0;
    const list = Array.isArray(blockers) ? blockers : [];
    for (let n = 0; n < 8; n += 1) {
      let hit = null;
      for (let i = 0; i < list.length; i += 1) {
        if (overlapsBox({ left, top }, { width: w, height: h }, list[i])) {
          hit = list[i];
          break;
        }
      }
      if (!hit) break;
      const nextLeft = (Number(hit.left) || 0) - w - gap;
      if (nextLeft >= gap) left = nextLeft;
      else top = (Number(hit.top) || 0) - h - gap;
    }
    if (top < gap) top = gap;
    if (left < gap) left = gap;
    if (left + w > vw - gap) left = Math.max(gap, vw - w - gap);
    if (top + h > vh - gap) top = Math.max(gap, vh - h - gap);
    return { left, top };
  }

  // Complete consultation plus the More / Save / Park buttons packed against it.
  // The launcher clears the whole cluster, not only the blue button.
  function footerClusterBox(anchor, others) {
    if (!plain(anchor)) return null;
    const cluster = [anchor];
    let guard = 0;
    let changed = true;
    while (changed && guard < 12) {
      changed = false;
      guard += 1;
      const union = unionRect(cluster);
      (Array.isArray(others) ? others : []).forEach((rect) => {
        if (!plain(rect) || cluster.indexOf(rect) !== -1) return;
        if (!adjacentToCluster(union, rect)) return;
        cluster.push(rect);
        changed = true;
      });
    }
    return unionRect(cluster);
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

  // #id-document is Medicus's /documents entry. It opens the New Document
  // chooser (From a template / Upload from my computer). It does not open
  // the catalogue row. The next native step is From a template.
  function nativeChooserText(item) {
    const src = plain(item) ? item : {};
    if (src.insert === 'document' || src.insert === 'reflow') return 'From a template';
    return '';
  }

  function chooserControlMatches(item, control) {
    const want = normaliseLabel(nativeChooserText(item));
    if (!want) return false;
    const ctl = plain(control) ? control : {};
    return normaliseLabel(ctl.text) === want;
  }

  const DOCUMENT_LIST_TABS = ['document', 'referral-form'];

  function isDocumentListTab(name) {
    return DOCUMENT_LIST_TABS.indexOf(String(name || '')) !== -1;
  }

  function documentSearchPlaceholder(value) {
    return normaliseLabel(value) === 'search templates';
  }

  // One plan for every card. Which column holds the card is not an input.
  // posts stays false: the suite does not build or send a create body.
  function nativeOpenPlan(item) {
    const src = plain(item) ? item : {};
    const insert = INSERTS.indexOf(src.insert) !== -1 ? src.insert : '';
    return { posts: false, menuId: nativeMenuId(src), insert, chooser: nativeChooserText(src) };
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
    PERSONAL_KEY,
    CONFIG_VERSION,
    SURFACES,
    UNGROUPED_ID,
    UNGROUPED_NAME,
    LIMITS,
    DEFAULT_GROUPS,
    PATHS,
    seedConfig,
    sanitiseConfig,
    sanitisePersonal,
    emptyPersonal,
    overlayConfig,
    personalDelta,
    sanitiseItem,
    cloneConfig,
    parseList,
    readSessionContext,
    topicEnvelope,
    headingContextId,
    headingKindToken,
    consultActionLabel,
    launcherAnchorBox,
    launcherPaneBox,
    footerClusterBox,
    clearLauncherBox,
    rememberClinicalUrl,
    mergeResourceUrls,
    mergeSession,
    sessionDrift,
    resolveApiBase,
    clinicalFieldKind,
    nativeMenuId,
    nativeChooserText,
    chooserControlMatches,
    isDocumentListTab,
    documentSearchPlaceholder,
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
