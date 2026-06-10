// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Knowledge utilities (pure logic, no chrome APIs, no DOM)
//
// Shared by the Knowledge side-panel module, options page (LLM starter import)
// and shared/io/knowledge-io.js. Loaded as a plain script in extension pages
// (window.KnowledgeUtils) and via require() in node tests.
//
// Exported functions:
//   validateEntry(e)                  — schema errors array ([] = valid)
//   sanitiseEntry(e)                  — whitelist-rebuild a validated entry
//   sanitiseCategories(arr)           — whitelist-rebuild the category list
//   generateEntryId(title, takenIds)  — slug id, collision-suffixed
//   normaliseTitle(s)                 — { text, tokens } for similarity checks
//   findSimilar(title, items, opts)   — near-duplicate entries, best first
//   phiWarnings(entries)              — heuristic patient-identifier warnings
//   kbSchemaPrompt()                  — copy-paste prompt for external LLMs

'use strict';

const KB_ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/i;

const KB_DEFAULT_CATEGORIES = [
  { id: 'referrals', name: 'Referral criteria' },
  { id: 'contacts',  name: 'Contacts & numbers' },
  { id: 'pathways',  name: 'Pathways & protocols' },
  { id: 'templates', name: 'Templates' },
];

const KB_SOURCES = ['manual', 'llm', 'import'];

const KB_LIMITS = { title: 120, body: 4000, phone: 60, url: 300, tagLen: 30, tags: 10 };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Validation / sanitisation ─────────────────────────────────────────────────

function validateEntry(e) {
  const errs = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['Entry must be an object.'];
  if (typeof e.title !== 'string' || !e.title.trim()) errs.push('title is required.');
  else if (e.title.trim().length > KB_LIMITS.title) errs.push(`title must be ${KB_LIMITS.title} characters or fewer.`);
  if (typeof e.category !== 'string' || !KB_ID_RE.test(e.category)) {
    errs.push('category is required and must be a short id (letters, digits, hyphens).');
  }
  if (e.id !== undefined && (typeof e.id !== 'string' || !KB_ID_RE.test(e.id))) {
    errs.push('id must match [a-z0-9][a-z0-9-]{0,49}.');
  }
  if (e.body !== undefined && typeof e.body !== 'string') errs.push('body must be a string.');
  if (e.phone !== undefined && typeof e.phone !== 'string') errs.push('phone must be a string.');
  if (e.url !== undefined && e.url !== '' && (typeof e.url !== 'string' || !/^https?:\/\//i.test(e.url))) {
    errs.push('url must start with http:// or https://.');
  }
  if (e.tags !== undefined) {
    if (!Array.isArray(e.tags) || e.tags.some(t => typeof t !== 'string')) errs.push('tags must be an array of strings.');
  }
  if (e.source !== undefined && !KB_SOURCES.includes(e.source)) {
    errs.push(`source must be one of: ${KB_SOURCES.join(', ')}.`);
  }
  if (e.reviewBy !== undefined && e.reviewBy !== null && e.reviewBy !== '' &&
      (typeof e.reviewBy !== 'string' || !ISO_DATE_RE.test(e.reviewBy))) {
    errs.push('reviewBy must be a YYYY-MM-DD date.');
  }
  return errs;
}

// Whitelist rebuild — never copies unknown fields, clamps lengths. Run
// validateEntry first; this assumes a structurally valid entry.
function sanitiseEntry(e) {
  const clamp = (s, n) => String(s ?? '').trim().slice(0, n);
  const tags = (Array.isArray(e.tags) ? e.tags : [])
    .map(t => clamp(t, KB_LIMITS.tagLen).toLowerCase())
    .filter(Boolean)
    .slice(0, KB_LIMITS.tags);
  return {
    id: (typeof e.id === 'string' && KB_ID_RE.test(e.id)) ? e.id.toLowerCase() : undefined,
    title: clamp(e.title, KB_LIMITS.title),
    category: String(e.category).toLowerCase(),
    body: clamp(e.body, KB_LIMITS.body),
    phone: clamp(e.phone, KB_LIMITS.phone),
    url: /^https?:\/\//i.test(e.url || '') ? clamp(e.url, KB_LIMITS.url) : '',
    tags,
    source: KB_SOURCES.includes(e.source) ? e.source : 'manual',
    reviewed: e.reviewed === true,
    reviewBy: (typeof e.reviewBy === 'string' && ISO_DATE_RE.test(e.reviewBy)) ? e.reviewBy : null,
    updatedAt: (typeof e.updatedAt === 'string' && e.updatedAt) ? e.updatedAt : new Date().toISOString(),
  };
}

function sanitiseCategories(arr) {
  const out = [];
  const seen = new Set();
  for (const c of (Array.isArray(arr) ? arr : [])) {
    if (!c || typeof c !== 'object') continue;
    const id = String(c.id || '').toLowerCase();
    if (!KB_ID_RE.test(id) || seen.has(id)) continue;
    const name = String(c.name || '').trim().slice(0, 40);
    if (!name) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out.length ? out : KB_DEFAULT_CATEGORIES.map(c => ({ ...c }));
}

function generateEntryId(title, takenIds) {
  const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
  let slug = String(title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!slug || !KB_ID_RE.test(slug)) slug = 'entry';
  let id = slug, n = 2;
  while (taken.has(id)) id = `${slug}-${n++}`;
  return id;
}

// ── Near-duplicate detection ──────────────────────────────────────────────────
// Titles are normalised (lowercase, punctuation stripped) and tokenised with
// boilerplate words removed, so "Cardiology referral criteria" and
// "Referral criteria — cardiology" compare equal. A hit is either containment
// of one normalised title in the other, or token-set Jaccard overlap ≥ 0.6.

const KB_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with',
  'referral', 'referrals', 'criteria', 'pathway', 'pathways', 'protocol',
  'protocols', 'guidance', 'guideline', 'guidelines', 'local', 'practice',
  'contact', 'contacts', 'number', 'numbers', 'phone', 'service',
]);

function normaliseTitle(s) {
  const text = String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  let tokens = text.split(' ').filter(t => t && !KB_STOPWORDS.has(t));
  // All-boilerplate titles ("Referral criteria") would otherwise match nothing —
  // fall back to the raw tokens so identical titles still compare equal.
  if (tokens.length === 0) tokens = text.split(' ').filter(Boolean);
  return { text, tokens };
}

function findSimilar(title, items, { threshold = 0.6, limit = 5, excludeId = null } = {}) {
  const a = normaliseTitle(title);
  if (!a.text) return [];
  const hits = [];
  for (const item of (items || [])) {
    if (!item || typeof item.title !== 'string') continue;
    if (excludeId && item.id === excludeId) continue;
    const b = normaliseTitle(item.title);
    if (!b.text) continue;
    let score = 0;
    if (a.text === b.text) score = 1;
    else if (a.text.includes(b.text) || b.text.includes(a.text)) score = 0.9;
    else {
      const setA = new Set(a.tokens), setB = new Set(b.tokens);
      let inter = 0;
      for (const t of setA) if (setB.has(t)) inter++;
      const union = setA.size + setB.size - inter;
      score = union > 0 ? inter / union : 0;
    }
    if (score >= threshold) hits.push({ item, score });
  }
  hits.sort((x, y) => y.score - x.score);
  return hits.slice(0, limit);
}

// ── PHI heuristics ────────────────────────────────────────────────────────────
// The knowledge base holds practice reference material — never patient data.
// These checks are a warning net for accidental pastes, not a guarantee.

const NHS_NUMBER_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/;
const DOB_RE = /\b(dob|date of birth)\b/i;

function phiWarnings(entries) {
  const warnings = [];
  for (const e of (entries || [])) {
    const text = `${e?.title || ''}\n${e?.body || ''}`;
    if (NHS_NUMBER_RE.test(text)) {
      warnings.push(`"${e.title}": contains a 10-digit number formatted like an NHS number — check no patient identifier has been pasted in.`);
    }
    if (DOB_RE.test(text)) {
      warnings.push(`"${e.title}": mentions a date of birth — check no patient details have been pasted in.`);
    }
  }
  return warnings;
}

// ── LLM starter-pack prompt ───────────────────────────────────────────────────
// Same convention as pathwaySchemaPrompt() / customRuleSchemaPrompt(): a single
// self-contained prompt the user copies into any external LLM, with the example
// JSON delimited by --- EXAMPLE JSON --- markers (extracted and validated by
// test-knowledge-utils.js).

function kbSchemaPrompt() {
  return `You are helping a UK NHS GP practice build its Practice Knowledge base: short, factual reference entries the practice team looks up during their working day (referral criteria, key phone numbers, internal pathways, document templates).

Output ONLY a valid JSON object of the form { "entries": [ ... ] } — no markdown fences, no commentary.

ENTRY SCHEMA (every entry):
- "title"    (required) — short descriptive title, max 120 chars, e.g. "Dermatology — 2WW suspected melanoma".
- "category" (required) — exactly one of: "referrals", "contacts", "pathways", "templates".
- "body"     — the reference content as plain text, max 4000 chars. Use short lines and simple dashes for lists. No markdown syntax.
- "phone"    — a single phone number string if the entry is primarily a contact, else omit.
- "url"      — a single http(s) link if there is an authoritative source page (e.g. ICB referral page), else omit.
- "tags"     — up to 10 short lowercase tags, e.g. ["2ww", "dermatology"].
- "reviewBy" — a YYYY-MM-DD date roughly 6 months from now, so the practice is prompted to re-check the entry.

Do NOT include "id", "source", "reviewed" or "updatedAt" — the extension sets those.

CONTENT INSTRUCTIONS:
1. Use UK general-practice terminology (2WW, e-RS, ICB, DN, ARRS, Pharmacy First).
2. Be factual and conservative. Where a detail is practice- or area-specific (a phone number, a named provider, a local threshold), write it as an obvious placeholder in square brackets, e.g. "[local dermatology 2WW phone]" — never invent a real-looking number or address.
3. NEVER include any patient details, real or invented.
4. Each entry must cover ONE distinct topic. Do not produce two entries for the same topic with reworded titles.
5. Prefer 10–20 genuinely useful entries over padding.

If the practice pastes local documents below, extract entries from them faithfully — do not embellish.

--- EXAMPLE JSON ---
{
  "entries": [
    {
      "title": "Dermatology — 2WW suspected melanoma",
      "category": "referrals",
      "body": "Refer via e-RS 2WW dermatology for: new or changing pigmented lesion scoring 3+ on the 7-point checklist, or any lesion suspicious of melanoma.\\n- Include dermoscopy photo if available\\n- Do NOT excise in primary care\\nSource: [local ICB skin cancer pathway]",
      "url": "https://www.nice.org.uk/guidance/ng12",
      "tags": ["2ww", "dermatology", "melanoma"],
      "reviewBy": "2026-12-01"
    },
    {
      "title": "District nursing — single point of access",
      "category": "contacts",
      "body": "Referrals for housebound patients: dressings, catheter care, end-of-life support.\\nHours: [local hours]. Use the SPA form on [local intranet page] for routine; phone for same-day.",
      "phone": "[local DN SPA phone]",
      "tags": ["district-nursing", "community"],
      "reviewBy": "2026-12-01"
    }
  ]
}
--- END EXAMPLE ---

After this line, the practice may paste local documents, rota emails or guideline extracts to turn into entries:
`;
}

const KnowledgeUtilsApi = {
  KB_ID_RE, KB_DEFAULT_CATEGORIES, KB_SOURCES, KB_LIMITS,
  validateEntry, sanitiseEntry, sanitiseCategories, generateEntryId,
  normaliseTitle, findSimilar, phiWarnings, kbSchemaPrompt,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KnowledgeUtilsApi;
} else if (typeof window !== 'undefined') {
  window.KnowledgeUtils = KnowledgeUtilsApi;
}
