// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template organiser Medicus client (W25)
//
// Same-origin calls the slash menu already makes. List GETs fill the canvas.
// Insert POSTs only after TemplateOrganiserCore has built the captured body
// from a live GET. A gap returns before any POST.

'use strict';

(function (global) {
  var CoreRef =
    (typeof window !== 'undefined' && window.TemplateOrganiserCore) ||
    (typeof require === 'function' ? require('./template-organiser-core.js') : null);

  function uuidV7() {
    var cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return '';
    var bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    var ms = Date.now();
    bytes[0] = Math.floor(ms / 1099511627776) & 255;
    bytes[1] = Math.floor(ms / 4294967296) & 255;
    bytes[2] = Math.floor(ms / 16777216) & 255;
    bytes[3] = Math.floor(ms / 65536) & 255;
    bytes[4] = Math.floor(ms / 256) & 255;
    bytes[5] = ms & 255;
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = '';
    for (var i = 0; i < 16; i += 1) {
      var h = bytes[i].toString(16);
      hex += h.length === 1 ? '0' + h : h;
    }
    return (
      hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
    );
  }

  function createClient(deps) {
    deps = deps || {};
    var C = deps.core || CoreRef;
    if (!C) throw new Error('template organiser core required');
    var fetchImpl = deps.fetchImpl || fetch;
    var origin = String(deps.origin || '').replace(/\/$/, '');
    if (!origin) throw new Error('template organiser origin required');

    function url(path) {
      return origin + path;
    }

    async function readBody(resp) {
      var text = '';
      try {
        text = await resp.text();
      } catch (err) {
        text = '';
      }
      var json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (err) {
          json = null;
        }
      }
      return { ok: !!resp.ok, status: resp.status, json: json, text: text };
    }

    async function getJson(path) {
      var resp = await fetchImpl(url(path), {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      });
      var res = await readBody(resp);
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      if (res.json == null || typeof res.json !== 'object') {
        var bad = new Error('Unexpected response');
        bad.status = res.status;
        throw bad;
      }
      return res.json;
    }

    async function postJson(path, payload) {
      var resp = await fetchImpl(url(path), {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      return readBody(resp);
    }

    async function readSort(ctx) {
      var tries = [];
      if (ctx.consultationTopicId) tries.push(C.PATHS.draftTopic(ctx.consultationTopicId));
      if (ctx.contextId) tries.push(C.PATHS.topicEntries(ctx.contextId));
      if (ctx.encounterId) tries.push(C.PATHS.encounterOverview(ctx.encounterId));
      for (var i = 0; i < tries.length; i += 1) {
        try {
          var json = await getJson(tries[i]);
          var sort = C.findConsultSort(json, 0);
          if (sort) return json;
        } catch (err) {
          /* next same-origin consult read */
        }
      }
      return null;
    }

    async function listTemplates(ctx) {
      if (!ctx || !ctx.consultationTopicId) {
        return {
          ok: false,
          items: [],
          gap: 'No consultation topic id on this page yet. Open the slash Template list once so the canvas can read the same request. Nothing was written.',
        };
      }
      var json = await getJson(C.PATHS.dataEntryList(ctx.consultationTopicId));
      return C.parseList(json, 'templates');
    }

    async function listDocuments(ctx) {
      if (!ctx || !ctx.patientId || !ctx.contextId || !ctx.contextType) {
        return {
          ok: false,
          items: [],
          gap: 'No patient and document context on this page yet. Open the slash Document list once so the canvas can read the same request. Nothing was written.',
        };
      }
      var json = await getJson(C.PATHS.documentSearch(ctx.patientId, ctx.contextId, ctx.contextType));
      return C.parseList(json, 'documents');
    }

    async function hydrate(ctx, href, resourceUrls) {
      var next = C.mergeSession(ctx, C.readSessionContext({ href: href, resourceUrls: resourceUrls, overview: null }));
      if (next.encounterId && (!next.patientId || !next.consultationTopicId)) {
        try {
          var overview = await getJson(C.PATHS.encounterOverview(next.encounterId));
          next = C.readSessionContext({ href: href, resourceUrls: resourceUrls, overview: overview });
        } catch (err) {
          /* named fields may already be on the resource URLs */
        }
      }
      return next;
    }

    async function insertItem(item, ctx) {
      if (!item || !ctx) return { ok: false, posted: false, gap: 'Nothing to insert.' };
      if (item.insert === 'data-entry') return insertDataEntry(item, ctx);
      if (item.insert === 'document') return insertDocument(item, ctx);
      if (item.insert === 'reflow') return insertReflow(item, ctx);
      return {
        ok: false,
        posted: false,
        gap: 'This card has no slash insert path. Nothing was written.',
      };
    }

    async function insertDataEntry(item, ctx) {
      var formJson;
      try {
        formJson = await getJson(C.PATHS.dataEntryForm(ctx.consultationTopicId, item.id));
      } catch (err) {
        return {
          ok: false,
          posted: false,
          status: err && err.status,
          gap: 'The data-entry form could not be read. Nothing was written.',
        };
      }
      var built = C.dataEntryCreateBody(formJson, ctx, item.id);
      if (!built.ok) return { ok: false, posted: false, gap: built.gap };
      var posted = await postJson(C.PATHS.dataEntryCreate, built.body);
      if (!posted.ok) {
        return { ok: false, posted: true, status: posted.status, gap: '' };
      }
      return { ok: true, posted: true, status: posted.status };
    }

    async function insertDocument(item, ctx) {
      var formJson;
      try {
        formJson = await getJson(C.PATHS.documentForm(item.id, ctx.patientId, ctx.contextId, ctx.contextType));
      } catch (err) {
        return {
          ok: false,
          posted: false,
          status: err && err.status,
          gap: 'The document form could not be read. Nothing was written.',
        };
      }
      var sortJson = await readSort(ctx);
      var uuid = typeof deps.uuid === 'function' ? deps.uuid() : uuidV7();
      var built = C.documentCreateBody({
        formJson: formJson,
        ctx: ctx,
        templateId: item.id,
        sortJson: sortJson,
        uuid: uuid,
      });
      if (!built.ok) return { ok: false, posted: false, gap: built.gap };
      var preview = await postJson(C.PATHS.documentPreview(item.id), built.previewBody);
      if (!preview.ok) {
        return { ok: false, posted: true, status: preview.status, gap: '' };
      }
      var created = await postJson(C.PATHS.documentCreate, built.body);
      if (!created.ok) return { ok: false, posted: true, status: created.status, gap: '' };
      return { ok: true, posted: true, status: created.status };
    }

    async function insertReflow(item, ctx) {
      var formJson;
      try {
        formJson = await getJson(C.PATHS.reflowForm(ctx.patientId, ctx.contextId, ctx.contextType));
      } catch (err) {
        return {
          ok: false,
          posted: false,
          status: err && err.status,
          gap: 'The built-in document form could not be read. Nothing was written.',
        };
      }
      var sortJson = await readSort(ctx);
      var uuid = typeof deps.uuid === 'function' ? deps.uuid() : uuidV7();
      var built = C.reflowCreateBody({
        formJson: formJson,
        ctx: ctx,
        slug: item.id,
        sortJson: sortJson,
        uuid: uuid,
      });
      if (!built.ok) return { ok: false, posted: false, gap: built.gap };
      var preview = await postJson(C.PATHS.reflowPreview(item.id), built.previewBody);
      if (!preview.ok) return { ok: false, posted: true, status: preview.status, gap: '' };
      var created = await postJson(C.PATHS.reflowCreate, built.body);
      if (!created.ok) return { ok: false, posted: true, status: created.status, gap: '' };
      return { ok: true, posted: true, status: created.status };
    }

    return {
      hydrate: hydrate,
      listTemplates: listTemplates,
      listDocuments: listDocuments,
      insertItem: insertItem,
    };
  }

  var api = { createClient: createClient, uuidV7: uuidV7 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TemplateOrganiserClient = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
