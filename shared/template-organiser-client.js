// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template organiser catalogue client
//
// Reads go to the practice API host ({siteId}.api.{page hostname}), which
// the canvas passes in as apiBase. The page host returns the SPA HTML shell
// for these paths. This client lists templates and documents. It does not
// POST a create body. Opening a template is Medicus’s own form.

'use strict';

(function (global) {
  var CoreRef =
    (typeof window !== 'undefined' && window.TemplateOrganiserCore) ||
    (typeof require === 'function' ? require('./template-organiser-core.js') : null);

  function createClient(deps) {
    deps = deps || {};
    var C = deps.core || CoreRef;
    if (!C) throw new Error('template organiser core required');
    var fetchImpl = deps.fetchImpl || fetch;
    var origin = String(deps.apiBase || deps.origin || '').replace(/\/$/, '');
    if (!origin) throw new Error('template organiser apiBase required');

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
        var body = String(res.text || '');
        var html = /^\s*</.test(body) || /<!doctype html/i.test(body);
        var bad = new Error('HTTP ' + res.status + ' response was ' + (html ? 'HTML, ' : '') + 'not JSON');
        bad.status = res.status;
        throw bad;
      }
      return res.json;
    }

    async function listTemplates(ctx) {
      if (!ctx || !ctx.consultationTopicId) {
        return {
          ok: false,
          items: [],
          gap: 'No consultation topic id on this page yet. Nothing was read.',
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
          gap: 'No patient and document context on this page yet. Nothing was read.',
        };
      }
      var json = await getJson(C.PATHS.documentSearch(ctx.patientId, ctx.contextId, ctx.contextType));
      return C.parseList(json, 'documents');
    }

    async function hydrate(ctx, href, resourceUrls, headingId, headingKind) {
      var seed = {
        href: href,
        resourceUrls: resourceUrls,
        overview: null,
        headingId: headingId || '',
        headingKind: headingKind || '',
      };
      var next = C.mergeSession(ctx, C.readSessionContext(seed));
      // Document search needs patient + heading context, not only the topic
      // that listTemplates uses. Fetch overview when any of those are missing.
      var needsOverview =
        next.encounterId && (!next.patientId || !next.consultationTopicId || !next.contextId || !next.contextType);
      if (needsOverview) {
        try {
          var overview = await getJson(C.PATHS.encounterOverview(next.encounterId));
          next = C.readSessionContext({
            href: href,
            resourceUrls: resourceUrls,
            overview: overview,
            headingId: headingId || '',
            headingKind: headingKind || '',
          });
        } catch (err) {
          /* named fields may already be on the resource URLs or the heading */
        }
      }
      return next;
    }

    return {
      hydrate: hydrate,
      listTemplates: listTemplates,
      listDocuments: listDocuments,
    };
  }

  var api = { createClient: createClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TemplateOrganiserClient = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
