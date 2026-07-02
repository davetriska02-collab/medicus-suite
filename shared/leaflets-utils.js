// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — NHS Patient Leaflets utilities (pure logic, no chrome APIs, no DOM)
//
// Shared by the Leaflets side-panel module, Options → Leaflets card and
// shared/io/leaflets-io.js. Loaded as a plain script in extension pages
// (window.LeafletsUtils) and via require() in node tests — same dual-export
// pattern as shared/knowledge-utils.js.
//
// Two tiers this file supports:
//   Tier 1 (always available) — fuzzy search over the bundled A-Z index
//     (rules/nhs-az-index.json), URL building for "open in a new tab" / "copy
//     link" / the guaranteed nhs.uk search fallback, and the recent-list
//     helper.
//   Tier 2 (config-gated, needs an NHS Website Content API key) — mapping a
//     schema.org MedicalWebPage-shaped API response into a plain-text render
//     model. mapApiResponseToRenderModel() and stripTags() build TEXT ONLY —
//     no HTML ever survives into the render model, so the caller can build
//     DOM nodes with textContent (never innerHTML) from remote content. See
//     test-xss-attribute-escaping.js for the house convention this follows.
//
// Exported functions:
//   searchIndex(entries, query, opts)     — ranked fuzzy matches (aliases + prefix typos-lite)
//   buildLeafletUrl(entry)                — https://www.nhs.uk/{conditions|medicines}/{slug}/
//   buildSearchUrl(term)                  — the guaranteed nhs.uk search fallback URL
//   buildApiUrl(entry)                    — https://api.nhs.uk/{conditions|medicines}/{slug}
//   canFetchLeaflet(config)                — true only when tier 2 is enabled AND a key is set
//   addRecent(list, item, max)            — recent-list push with de-dupe + cap
//   validateIndexEntries(entries)         — schema errors array ([] = valid)
//   mapApiResponseToRenderModel(json, entry) — API JSON → { title, sections, sourceUrl, lastReviewed } or null
//   stripTags(html)                       — plain text, tags/attributes removed
//   leafletOpenLedgerEvent(entry, nowIso) — pure builder for the ledger 'leaflets' event shape

'use strict';

const NHS_SITE_BASE = 'https://www.nhs.uk';
const NHS_API_BASE = 'https://api.nhs.uk';
const RECENT_MAX = 10;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KIND_SEGMENT = { condition: 'conditions', medicine: 'medicines' };

// ── URL building ──────────────────────────────────────────────────────────────

function _segmentFor(kind) {
  return KIND_SEGMENT[kind] || 'conditions';
}

function buildLeafletUrl(entry) {
  if (!entry || typeof entry.slug !== 'string') return null;
  return `${NHS_SITE_BASE}/${_segmentFor(entry.kind)}/${entry.slug}/`;
}

function buildSearchUrl(term) {
  const q = String(term == null ? '' : term).trim();
  return `${NHS_SITE_BASE}/search/results?q=${encodeURIComponent(q)}`;
}

function buildApiUrl(entry) {
  if (!entry || typeof entry.slug !== 'string') return null;
  return `${NHS_API_BASE}/${_segmentFor(entry.kind)}/${entry.slug}`;
}

// ── Search ────────────────────────────────────────────────────────────────────

function _normalise(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .trim();
}

function _tokens(s) {
  return _normalise(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Small bounded Levenshtein distance — only ever called on short strings
// (single search-box words), so no need for the usual DP-row optimisation.
function _levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length,
    bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const prev = new Array(bl + 1);
  const curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bl; j++) prev[j] = curr[j];
  }
  return prev[bl];
}

// Score one entry against a normalised query. Higher is better; 0 = no match.
function _matchScore(q, entry) {
  if (!q) return 0;
  const candidates = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
  let best = 0;
  for (const c of candidates) {
    const cn = _normalise(c);
    if (!cn) continue;
    if (cn === q) {
      best = Math.max(best, 100);
      continue;
    }
    if (cn.startsWith(q)) best = Math.max(best, 85);
    else if (cn.includes(q)) best = Math.max(best, 65);

    for (const t of _tokens(c)) {
      if (t === q) best = Math.max(best, 90);
      else if (t.startsWith(q)) best = Math.max(best, 70);
      // Typos-lite: a short query within 1 edit of a same-length word prefix
      // (e.g. "eczma" ~ "eczem" the first 5 letters of "eczema"). Requires a
      // minimum length so 1-2 letter queries don't fuzz-match everything.
      else if (q.length >= 4 && t.length >= q.length && _levenshtein(q, t.slice(0, q.length)) <= 1) {
        best = Math.max(best, 35);
      }
    }
  }
  return best;
}

/**
 * Fuzzy-search the bundled index. Returns entries ranked best-first, capped
 * at opts.limit (default 8). Empty/whitespace query returns [].
 */
function searchIndex(entries, query, opts) {
  const q = _normalise(query);
  if (!q || !Array.isArray(entries)) return [];
  const limit = (opts && opts.limit) || 8;
  const scored = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const score = _matchScore(q, entry);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.entry.name).localeCompare(String(b.entry.name)));
  return scored.slice(0, limit).map((x) => x.entry);
}

// ── Recent list ───────────────────────────────────────────────────────────────

/** Push item to the front of list, de-duped by slug, capped at max (default 10). */
function addRecent(list, item, max) {
  const cap = max || RECENT_MAX;
  const arr = Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : [];
  const filtered = arr.filter((x) => x.slug !== item.slug);
  filtered.unshift({
    slug: item.slug,
    name: item.name,
    kind: item.kind === 'medicine' ? 'medicine' : 'condition',
    openedAt: item.openedAt || new Date().toISOString(),
  });
  return filtered.slice(0, cap);
}

// ── Index schema validation (also used by test-leaflets-core.js) ──────────────

function validateIndexEntries(entries) {
  const errors = [];
  if (!Array.isArray(entries)) return ['entries must be an array'];
  const seen = new Set();
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.push(`entry ${i}: must be an object`);
      return;
    }
    if (typeof e.slug !== 'string' || !SLUG_RE.test(e.slug)) {
      errors.push(`entry ${i} (${e.name || '?'}): slug must be lowercase-hyphen (got "${e.slug}")`);
    } else if (seen.has(e.slug)) {
      errors.push(`duplicate slug: "${e.slug}"`);
    } else {
      seen.add(e.slug);
    }
    if (typeof e.name !== 'string' || !e.name.trim()) errors.push(`entry ${i} (${e.slug}): name is required`);
    if (e.kind !== 'condition' && e.kind !== 'medicine') {
      errors.push(`entry ${i} (${e.slug}): kind must be "condition" or "medicine" (got "${e.kind}")`);
    }
    if (!Array.isArray(e.aliases)) errors.push(`entry ${i} (${e.slug}): aliases must be an array`);
  });
  return errors;
}

// ── Tier 2 gating ─────────────────────────────────────────────────────────────

/** True only when the Leaflets API is enabled AND a non-blank key is configured. */
function canFetchLeaflet(config) {
  if (!config || typeof config !== 'object') return false;
  return config.enabled === true && typeof config.apiKey === 'string' && config.apiKey.trim().length > 0;
}

// ── Sanitisation — text-only, no HTML ever ─────────────────────────────────────

/**
 * Strip every tag AND its attributes, leaving plain text. Used on every string
 * pulled from a remote API response before it is used as textContent — belt
 * and braces, since textContent alone cannot execute markup, but a value that
 * still contains literal "<script>" text would be confusing to read verbatim.
 */
function stripTags(html) {
  return String(html == null ? '' : html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Split a block of (possibly-HTML) text into plain-text paragraphs on
// block-level boundaries, stripping tags from each chunk. Never returns HTML.
function _htmlToParagraphs(html) {
  if (typeof html !== 'string' || !html.trim()) return [];
  const chunks = html.split(/<\/(?:p|li|h[1-6]|div)>/i);
  const out = [];
  for (const c of chunks) {
    const text = stripTags(c);
    if (text) out.push(text);
  }
  if (out.length === 0) {
    const text = stripTags(html);
    if (text) out.push(text);
  }
  return out.slice(0, 40); // sanity cap — a runaway response can't blow up the panel
}

/**
 * Map a schema.org MedicalWebPage-shaped API response into a plain-text
 * render model: { title, sections: [{ heading, paragraphs: [string] }],
 * sourceUrl, lastReviewed }. Returns null when the shape is not usable —
 * the caller falls back to tier-1 "open in tab" behaviour with a calm notice
 * (see CLAUDE.md-style fail-graceful convention: 401/403/429/network/shape
 * are all treated the same way by the caller).
 */
function mapApiResponseToRenderModel(json, entry) {
  if (!json || typeof json !== 'object') return null;
  const rawName = typeof json.name === 'string' && json.name.trim() ? json.name : entry && entry.name;
  if (typeof rawName !== 'string' || !rawName.trim()) return null;

  const partsSrc = Array.isArray(json.hasPart) ? json.hasPart : [];
  const sections = [];
  for (const p of partsSrc) {
    if (!p || typeof p !== 'object') continue;
    const heading = typeof p.name === 'string' ? stripTags(p.name) : '';
    const bodySrc = typeof p.text === 'string' ? p.text : typeof p.articleBody === 'string' ? p.articleBody : '';
    const paragraphs = _htmlToParagraphs(bodySrc);
    if (!heading && paragraphs.length === 0) continue;
    sections.push({ heading, paragraphs });
  }
  if (sections.length === 0) return null; // unusable shape — reject, don't guess

  const sourceUrl =
    typeof json.url === 'string' && /^https:\/\/www\.nhs\.uk\//.test(json.url)
      ? json.url
      : entry
        ? buildLeafletUrl(entry)
        : null;
  const lastReviewed = typeof json.lastReviewed === 'string' ? json.lastReviewed.slice(0, 10) : null;

  return {
    title: stripTags(rawName),
    sections,
    sourceUrl,
    lastReviewed,
  };
}

// ── Ledger event (pure builder — the actual write goes through shared/event-ledger.js) ─
//
// Builds the exact event shape (source 'leaflets', patientRef always null,
// label = slug, action 'opened') that side-panel/modules/leaflets/leaflets.js
// hands to window.EventLedger.record(evt, { dedupe: true }) on every leaflet
// open. shared/event-ledger.js's SOURCES/ACTIONS include 'leaflets'/'opened'.

function leafletOpenLedgerEvent(entry, nowIso) {
  if (!entry || typeof entry.slug !== 'string') return null;
  return {
    ts: nowIso || new Date().toISOString(),
    source: 'leaflets',
    patientRef: null,
    severity: null,
    ruleId: null,
    label: entry.slug,
    action: 'opened',
  };
}

const LeafletsUtilsApi = {
  NHS_SITE_BASE,
  NHS_API_BASE,
  RECENT_MAX,
  SLUG_RE,
  searchIndex,
  buildLeafletUrl,
  buildSearchUrl,
  buildApiUrl,
  addRecent,
  validateIndexEntries,
  canFetchLeaflet,
  stripTags,
  mapApiResponseToRenderModel,
  leafletOpenLedgerEvent,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LeafletsUtilsApi;
} else if (typeof self !== 'undefined') {
  self.LeafletsUtils = LeafletsUtilsApi;
}
