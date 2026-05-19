// Medicus Suite — API Diagnostics
//
// Records every API fetch attempt with full context so we can diagnose
// 403s, 401s, network errors, and "wrong practice code" issues from the
// user-visible debug panel rather than guessing.
//
// Each entry: { ts, module, url, codeSource, code, status, error, ok }
//
// Kept in memory only (last 50 entries). Available via window.ApiDiag for
// the side panel's debug section and via console.log for developer inspection.

(function(global) {
  'use strict';

  const MAX_ENTRIES = 50;
  const _entries = [];
  const _listeners = [];

  // Record an API attempt. Returns the entry for chaining or extension.
  function record(entry) {
    const e = {
      ts: new Date().toISOString(),
      module: entry.module || 'unknown',
      url: entry.url || null,
      code: entry.code || null,
      codeSource: entry.codeSource || null,  // 'tab' | 'storage' | null
      status: entry.status ?? null,
      ok: entry.ok ?? null,
      error: entry.error || null,
      durationMs: entry.durationMs ?? null,
    };
    _entries.unshift(e);
    if (_entries.length > MAX_ENTRIES) _entries.length = MAX_ENTRIES;
    if (typeof console !== 'undefined') {
      const tag = `[Medicus Suite/${e.module}]`;
      if (e.ok) console.log(`${tag} ${e.status} ← ${e.url}`);
      else console.warn(`${tag} ${e.status || 'ERR'} ← ${e.url}`, e.error || '');
    }
    _listeners.forEach(cb => { try { cb(e); } catch (_) {} });
    return e;
  }

  // Wrap a fetch call with diagnostics. Returns the response on success,
  // throws an Error with rich diagnostic context on failure.
  //
  // Usage:
  //   const r = await ApiDiag.fetch({
  //     module: 'sentinel-wr',
  //     url, code, codeSource,
  //   });
  async function diagFetch({ module: mod, url, code, codeSource, init }) {
    const t0 = Date.now();
    let r, status = null, error = null;
    try {
      r = await fetch(url, init || { credentials: 'include' });
      status = r.status;
      if (!r.ok) {
        error = humanError(r.status, code, codeSource);
        record({ module: mod, url, code, codeSource, status, ok: false, error, durationMs: Date.now() - t0 });
        const err = new Error(error);
        err.status = status;
        err.code = code;
        err.codeSource = codeSource;
        throw err;
      }
      record({ module: mod, url, code, codeSource, status, ok: true, durationMs: Date.now() - t0 });
      return r;
    } catch (e) {
      if (status == null) {
        // Network error, CORS error, etc — fetch itself threw
        error = e.message;
        record({ module: mod, url, code, codeSource, status: null, ok: false, error, durationMs: Date.now() - t0 });
        const err = new Error(`Network: ${e.message}`);
        err.code = code;
        err.codeSource = codeSource;
        throw err;
      }
      throw e;
    }
  }

  function humanError(status, code, source) {
    const src = source === 'tab' ? 'detected from tab' : source === 'storage' ? 'from saved settings' : 'unknown source';
    if (status === 401) return `Not signed in to Medicus (401 for code "${code}" ${src})`;
    if (status === 403) return `Access denied (403 for code "${code}" ${src}) — likely wrong practice or session expired`;
    if (status === 404) return `Endpoint not found (404 for code "${code}" ${src}) — code may be invalid`;
    if (status >= 500) return `Medicus server error ${status} (code "${code}" ${src})`;
    return `HTTP ${status} for code "${code}" ${src}`;
  }

  function getEntries() {
    return _entries.slice();
  }

  function onEntry(cb) {
    _listeners.push(cb);
  }

  function clear() {
    _entries.length = 0;
  }

  function summary() {
    if (_entries.length === 0) return 'No API calls yet.';
    const recent = _entries.slice(0, 10);
    const codes = [...new Set(recent.map(e => e.code).filter(Boolean))];
    const sources = [...new Set(recent.map(e => e.codeSource).filter(Boolean))];
    const okCount = recent.filter(e => e.ok).length;
    const failCount = recent.filter(e => e.ok === false).length;
    return `Last 10 calls: ${okCount} OK, ${failCount} failed. Codes: ${codes.join(', ') || '(none)'}. Sources: ${sources.join(', ') || '(none)'}.`;
  }

  const api = { record, fetch: diagFetch, getEntries, onEntry, clear, summary };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ApiDiag = api;
  }
})(typeof window !== 'undefined' ? window : global);
