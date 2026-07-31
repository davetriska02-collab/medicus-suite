// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Phrases (quick responses) core: pure logic, no chrome APIs, no DOM
//
// Shared by the Phrases side-panel module, shared/io/phrases-io.js (backup
// validation) and node tests. Loaded as a plain script in extension pages
// (window.PhrasesCore) and via require() in node tests — the same dual-mode
// export as shared/quick-actions-core.js.
//
// WHAT THIS IS
//   A personal/practice library of short reusable text BLOCKS (opener,
//   substance, safety-net, next-step, sign-off) that compose into one message
//   the clinician COPIES and pastes into Medicus's own message/comment/note
//   boxes themselves.
//
// WHAT THIS IS NOT
//   It sends nothing, inserts nothing into Medicus and writes nothing to the
//   patient record. composeMessage() returns a STRING for the clipboard. Every
//   clinical effect downstream comes from the clinician pasting and sending
//   through Medicus's own controls. See H-052 (docs/HAZARD-LOG.md) and the
//   H-049 no-completion-claim doctrine it inherits.
//
// HARD SAFETY RULE — *** placeholders are MANUAL-FILL ONLY
//   A block body may contain *** where per-patient detail goes (Epic-style
//   SmartPhrase wildcards). They are NEVER auto-filled with patient data by
//   this suite — not from the record snapshot, not from anywhere (Accurx
//   deliberately refuses auto-merge for the same reason: an auto-filled wrong
//   patient detail reads as fact). hasUnfilledPlaceholders() exists so the UI
//   can refuse a casual copy while *** remains.
//
// DATA MODEL
//   Block: { id, title, body, trigger, keywords, category, audience,
//            leafletUrl, slot }
//     audience: 'patient' | 'note' | 'task' — shown on every card and in the
//               compose preview (H-052 wrong-context-paste control). Unknown
//               audience fails CLOSED to 'note' (mislabelling patient text as
//               internal withholds a send; the reverse would invite one).
//     slot:     'opener' | 'substance' | 'safetynet' | 'nextstep' | 'signoff'
//               | 'whole' — compose order is fixed (COMPOSE_ORDER), not
//               click order.
//   Shipped pack ({ version, categories, blocks }) lives in
//   shared/phrases-presets.js — a one-file drop-in for the curated content.
//   Categories are read LIVE from the shipped pack at render time and are
//   deliberately NOT persisted in config, so there is no category-migration
//   problem — only blocks migrate.
//
// Storage shapes (see shared/io/phrases-io.js):
//   phrases.items  — personal blocks (freely editable)
//   phrases.config — { version, usage, practiceBlocks, removedShipped }
//     version        — the shipped-pack integer already merged (gates
//                      mergeShippedPack — same stranded-defaults doctrine as
//                      quick-actions-core / defaults.json)
//     practiceBlocks — merged shipped pack + promoted personal blocks
//     removedShipped — tombstoned shipped block ids: deleted stays deleted
//                      across pack version bumps

'use strict';

(function (global) {
  // ── Limits ────────────────────────────────────────────────────────────────
  const PH_LIMITS = {
    id: 64,
    title: 120,
    body: 2000,
    trigger: 24,
    keywords: 240,
    category: 40,
    catLabel: 40,
    blocks: 500, // per list (personal / practice)
    categories: 24,
    tombstones: 500,
    usageMax: 9999, // per-block use count cap
    usageIds: 1000, // distinct ids tracked in the usage map
  };

  const SLOTS = ['opener', 'substance', 'safetynet', 'nextstep', 'signoff', 'whole'];

  // Compose order. 'whole' (standalone blocks) sits directly after the opener:
  // a whole block is the message body, so it belongs where the substance goes,
  // ahead of any safety-net/next-step/sign-off blocks added around it.
  const COMPOSE_ORDER = ['opener', 'whole', 'substance', 'safetynet', 'nextstep', 'signoff'];

  const AUDIENCES = ['patient', 'note', 'task'];
  const AUDIENCE_LABEL = { patient: 'Patient msg', note: 'Record note', task: 'Task comment' };

  // Prototype-pollution defence for user-supplied map keys — same doctrine as
  // quick-actions-core's QA_FORBIDDEN_KEYS.
  const PH_FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  // The manual-fill placeholder marker. Kept as one regex so the UI guard and
  // the tests cannot drift.
  const PLACEHOLDER_RE = /\*\*\*/;

  // ── Small helpers ─────────────────────────────────────────────────────────

  function clamp(s, n) {
    return String(s ?? '')
      .trim()
      .slice(0, n);
  }

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  function isPlainObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function slugify(s) {
    return String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, PH_LIMITS.id);
  }

  // Deterministic-ish id from a title, avoiding the taken set.
  function generateBlockId(title, takenSet) {
    const base = slugify(title) || 'block';
    let id = base;
    let n = 2;
    while (takenSet && takenSet.has(id)) id = `${base}-${n++}`.slice(0, PH_LIMITS.id);
    return id;
  }

  function hasUnfilledPlaceholders(text) {
    return PLACEHOLDER_RE.test(String(text ?? ''));
  }

  // Character/word count + an APPROXIMATE SMS segment estimate (GSM-7: one
  // segment ≤160 chars, then 153 per segment). Approximate on purpose —
  // Medicus/Accurx do their own accounting; this is a "how long is this
  // really" cue for the clinician, not a billing claim.
  function charCount(text) {
    const s = String(text ?? '');
    const chars = s.length;
    const words = s.trim() ? s.trim().split(/\s+/).length : 0;
    const smsSegments = chars === 0 ? 0 : chars <= 160 ? 1 : Math.ceil(chars / 153);
    return { chars, words, smsSegments };
  }

  // ── Block validation / sanitisation ───────────────────────────────────────
  //
  // validateBlock: human-readable error list for forms and paste-imports.
  // sanitiseBlock: WHITELIST-COPY — only the nine known fields survive, all
  //   clamped; unknown fields from a crafted backup/import are dropped. Does
  //   NOT strip markup: text is carried inert and escaped at render time
  //   (same doctrine as quick-actions-core sanitiseConfig).

  function validateBlock(raw) {
    const errs = [];
    if (!isPlainObject(raw)) return ['Block must be an object.'];
    if (!clamp(raw.title, PH_LIMITS.title)) errs.push('Block needs a title.');
    if (!clamp(raw.body, PH_LIMITS.body)) errs.push('Block needs body text.');
    if (raw.audience !== undefined && raw.audience !== '' && !AUDIENCES.includes(raw.audience)) {
      errs.push(`audience must be one of: ${AUDIENCES.join(', ')}.`);
    }
    if (raw.slot !== undefined && raw.slot !== '' && !SLOTS.includes(raw.slot)) {
      errs.push(`slot must be one of: ${SLOTS.join(', ')}.`);
    }
    if (raw.leafletUrl && !/^https:\/\//i.test(String(raw.leafletUrl).trim())) {
      errs.push('leafletUrl must be an https:// link (or empty).');
    }
    return errs;
  }

  function sanitiseBlock(raw) {
    const src = isPlainObject(raw) ? raw : {};
    const leafletUrl = clamp(src.leafletUrl, 300);
    return {
      id: slugify(src.id),
      title: clamp(src.title, PH_LIMITS.title),
      body: String(src.body ?? '')
        .trim()
        .slice(0, PH_LIMITS.body),
      trigger: slugify(src.trigger).slice(0, PH_LIMITS.trigger),
      keywords: clamp(src.keywords, PH_LIMITS.keywords).toLowerCase(),
      category: slugify(src.category).slice(0, PH_LIMITS.category),
      // Fail CLOSED: unknown audience becomes 'note' (internal). Mislabelled-
      // internal withholds a patient send; defaulting to 'patient' would
      // invite one. See header.
      audience: AUDIENCES.includes(src.audience) ? src.audience : 'note',
      leafletUrl: /^https:\/\//i.test(leafletUrl) ? leafletUrl : '',
      slot: SLOTS.includes(src.slot) ? src.slot : 'whole',
    };
  }

  // Valid, sanitised, id-deduplicated, capped list. Blocks failing
  // validateBlock are dropped (callers wanting per-entry errors run
  // validateBlock themselves first — the paste-import does).
  function sanitiseBlockList(arr) {
    const out = [];
    const taken = new Set();
    for (const raw of Array.isArray(arr) ? arr : []) {
      if (validateBlock(raw).length > 0) continue;
      const b = sanitiseBlock(raw);
      if (!b.id || taken.has(b.id)) b.id = generateBlockId(b.title, taken);
      taken.add(b.id);
      out.push(b);
      if (out.length >= PH_LIMITS.blocks) break;
    }
    return out;
  }

  function sanitiseCategories(arr) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(arr) ? arr : []) {
      if (!isPlainObject(raw)) continue;
      const id = slugify(raw.id);
      const label = clamp(raw.label, PH_LIMITS.catLabel);
      if (!id || !label || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label });
      if (out.length >= PH_LIMITS.categories) break;
    }
    return out;
  }

  // A shipped pack (or a hand-rolled one) → a valid { version, categories,
  // blocks } shape. Never throws.
  function sanitisePack(raw) {
    const src = isPlainObject(raw) ? raw : {};
    const v = Number(src.version);
    return {
      version: Number.isFinite(v) && Math.floor(v) >= 0 ? Math.floor(v) : 0,
      categories: sanitiseCategories(src.categories),
      blocks: sanitiseBlockList(src.blocks),
    };
  }

  // ── Config sanitisation ───────────────────────────────────────────────────
  //
  // Never throws, never returns a partial shape — whatever comes out of
  // chrome.storage / a restored backup becomes a usable config.

  function sanitiseUsage(raw) {
    const out = {};
    if (!isPlainObject(raw)) return out;
    let n = 0;
    for (const key of Object.keys(raw)) {
      if (PH_FORBIDDEN_KEYS.includes(key)) continue; // prototype-pollution defence
      const id = slugify(key);
      if (!id || PH_FORBIDDEN_KEYS.includes(id)) continue; // re-check after slugify
      const v = Number(raw[key]);
      if (!Number.isFinite(v) || v <= 0) continue;
      out[id] = Math.min(Math.floor(v), PH_LIMITS.usageMax);
      if (++n >= PH_LIMITS.usageIds) break;
    }
    return out;
  }

  function sanitiseTombstones(arr) {
    const out = [];
    const seen = new Set();
    for (const x of Array.isArray(arr) ? arr : []) {
      if (typeof x !== 'string') continue;
      const id = slugify(x);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= PH_LIMITS.tombstones) break;
    }
    return out;
  }

  function sanitiseConfig(raw) {
    const src = isPlainObject(raw) ? raw : {};
    const v = Number(src.version);
    return {
      version: Number.isFinite(v) && Math.floor(v) >= 0 ? Math.floor(v) : 0,
      usage: sanitiseUsage(src.usage),
      practiceBlocks: sanitiseBlockList(src.practiceBlocks),
      removedShipped: sanitiseTombstones(src.removedShipped),
    };
  }

  // ── mergeShippedPack ──────────────────────────────────────────────────────
  //
  // Version-gated migration, the quick-actions-core mergeShippedPresets shape:
  // when the stored config's `version` is behind the shipped pack's, union in
  // shipped blocks the config does not already carry, matching on id. Pure and
  // idempotent; nothing is removed, reordered or overwritten:
  //   - a tombstoned id (removedShipped) is skipped — deleted stays deleted;
  //   - an id already present keeps the USER'S stored block untouched (new
  //     blocks arrive on a bump; changed shipped bodies do not — the same
  //     `{...shipped, ...cfg}` doctrine as defaults.json, documented there);
  //   - a fresh config (version 0, no blocks) receives the whole pack.
  // MUST be called on every phrases.config load path in lock-step (the module
  // is the only load path today; keep it that way or mirror the call).
  // Returns { cfg, changed } — `changed` is the caller's cue to persist.

  function mergeShippedPack(rawConfig, rawPack) {
    const cfg = sanitiseConfig(rawConfig);
    const pack = sanitisePack(rawPack);
    if (cfg.version >= pack.version) return { cfg, changed: false };

    const tombstoned = new Set(cfg.removedShipped);
    const present = new Set(cfg.practiceBlocks.map((b) => b.id));
    for (const shipped of pack.blocks) {
      if (!shipped.id || present.has(shipped.id) || tombstoned.has(shipped.id)) continue;
      if (cfg.practiceBlocks.length >= PH_LIMITS.blocks) break;
      cfg.practiceBlocks.push(shipped);
      present.add(shipped.id);
    }
    cfg.version = pack.version;
    return { cfg, changed: true };
  }

  // ── composeMessage ────────────────────────────────────────────────────────
  //
  // ids → the selected blocks, ordered by COMPOSE_ORDER slot position (ties
  // keep selection order — stable sort), bodies joined with ONE blank line.
  // Unknown ids are skipped silently (a block deleted mid-compose must not
  // throw). Returns '' when nothing resolves.

  function composeMessage(ids, blocks) {
    const byId = new Map((Array.isArray(blocks) ? blocks : []).map((b) => [b && b.id, b]));
    const picked = (Array.isArray(ids) ? ids : [])
      .map((id) => byId.get(id))
      .filter((b) => b && typeof b.body === 'string' && b.body);
    const slotRank = (b) => {
      const i = COMPOSE_ORDER.indexOf(b.slot);
      return i === -1 ? COMPOSE_ORDER.length : i;
    };
    return picked
      .map((b, i) => ({ b, i }))
      .sort((x, y) => slotRank(x.b) - slotRank(y.b) || x.i - y.i)
      .map((x) => x.b.body)
      .join('\n\n');
  }

  // ── Search ────────────────────────────────────────────────────────────────
  //
  // scoreMatch is the palette scoring algorithm (side-panel/palette/
  // palette-core.js — that file is an ES module, this one a classic script, so
  // the ~30 lines are duplicated here rather than half-converting either file;
  // test-phrases-core.js pins the behaviour so drift is visible):
  //   0 no match; 1 empty query; 500-idx +80 word-start for a substring hit;
  //   subsequence walk base 100, +8 per word-boundary hit, −1 per gap char.

  function scoreMatch(query, text) {
    const q = String(query || '')
      .trim()
      .toLowerCase();
    const t = String(text || '').toLowerCase();
    if (!q) return 1;
    if (!t) return 0;

    const idx = t.indexOf(q);
    if (idx !== -1) {
      const wordStart = idx === 0 || /[\s/:·-]/.test(t[idx - 1]);
      return 500 - Math.min(idx, 100) + (wordStart ? 80 : 0);
    }

    let score = 100;
    let ti = 0;
    for (const ch of q) {
      let found = -1;
      for (let i = ti; i < t.length; i++) {
        if (t[i] === ch) {
          found = i;
          break;
        }
      }
      if (found === -1) return 0;
      if (found === 0 || /[\s/:·-]/.test(t[found - 1])) score += 8;
      score -= Math.max(0, found - ti - 1);
      ti = found + 1;
    }
    return Math.max(score, 1);
  }

  // Rank blocks for display.
  //   query  — '/xyz' is the trigger fast path: ONLY blocks whose trigger
  //            starts with 'xyz' match; an exact trigger match outranks a
  //            prefix match, and both outrank anything fuzzy could score.
  //   usage  — the per-block use-count map; empty query sorts by it
  //            (most-used-by-me first), and it breaks score ties.
  // Returns a new array; input order is the final tiebreak (stable).

  function searchBlocks(query, blocks, usage) {
    const list = Array.isArray(blocks) ? blocks : [];
    const use = isPlainObject(usage) ? usage : {};
    const uses = (b) => Number(use[b.id]) || 0;
    const q = String(query || '').trim();

    if (!q) {
      return list
        .map((b, i) => ({ b, i }))
        .sort((x, y) => uses(y.b) - uses(x.b) || x.i - y.i)
        .map((x) => x.b);
    }

    if (q.startsWith('/')) {
      const t = q.slice(1).toLowerCase();
      if (!t) return list.filter((b) => b.trigger);
      return list
        .map((b, i) => {
          let score = 0;
          if (b.trigger === t) score = 2000;
          else if (b.trigger && b.trigger.startsWith(t)) score = 1000;
          return { b, i, score };
        })
        .filter((e) => e.score > 0)
        .sort((x, y) => y.score - x.score || uses(y.b) - uses(x.b) || x.i - y.i)
        .map((e) => e.b);
    }

    return list
      .map((b, i) => ({
        b,
        i,
        score:
          b.trigger === q.toLowerCase()
            ? 2000 // bare trigger typed without the slash still wins outright
            : scoreMatch(q, `${b.title} ${b.trigger} ${b.keywords}`),
      }))
      .filter((e) => e.score > 0)
      .sort((x, y) => y.score - x.score || uses(y.b) - uses(x.b) || x.i - y.i)
      .map((e) => e.b);
  }

  // Record one use of a block. Returns a NEW usage map, capped and guarded.
  function bumpUsage(usage, id) {
    const out = sanitiseUsage(usage);
    const key = slugify(id);
    if (!key || PH_FORBIDDEN_KEYS.includes(key)) return out;
    out[key] = Math.min((out[key] || 0) + 1, PH_LIMITS.usageMax);
    return out;
  }

  // ── LLM authoring prompt ──────────────────────────────────────────────────
  // Same convention as knowledge-utils' kbSchemaPrompt(): one self-contained
  // prompt the user copies into any external LLM; the example JSON is
  // delimited by --- EXAMPLE JSON --- markers (extracted and validated by
  // test-phrases-core.js). Output shape is { "blocks": [ ... ] }, imported on
  // the Phrases tab through validateBlock/sanitiseBlock with visible errors.

  function phrasesAuthoringPrompt() {
    return `You are helping a UK NHS GP practice write reusable text BLOCKS for its "Phrases" library: short snippets a GP composes into one message and pastes into the clinical system themselves. Nothing you write is sent automatically.

Output ONLY a valid JSON object of the form { "blocks": [ ... ] } — no markdown fences, no commentary.

BLOCK SCHEMA (every field, exact names):
- "id"         — short lowercase slug, e.g. "results-normal-fbc". Unique per block.
- "title"      (required) — what the block is, max 120 chars, e.g. "Normal blood results — no action".
- "body"       (required) — the text itself, max 2000 chars, plain text only.
- "trigger"    — one short lowercase word for /trigger search, e.g. "normal".
- "keywords"   — space-separated lowercase synonyms for search, e.g. "bloods fbc ok fine".
- "category"   — one of: "openers", "results-normal", "results-borderline", "conditions", "safety-netting", "needs-call", "admin", "sign-offs".
- "audience"   — exactly one of: "patient" (message the patient reads), "note" (consultation/record note), "task" (internal task comment). Choose carefully — the tool shows this tag so text is not pasted into the wrong box.
- "leafletUrl" — "" or one https:// link to an authoritative patient leaflet (nhs.uk preferred).
- "slot"       — where the block sits when composed: "opener", "substance", "safetynet", "nextstep", "signoff", or "whole" (a complete standalone message).

STYLE RULES for "patient" audience blocks:
1. Plain English at a reading age of 9–11 (NHS content style): short sentences, everyday words, no jargon, no abbreviations a patient wouldn't know. Explain what happens next.
2. Warm but factual. Never promise an outcome, never say something has been booked or done — the GP does those things in the clinical system.
3. Where a per-patient detail goes (a name, a value, a date), write exactly *** — three asterisks. The GP types over it every time; it is NEVER auto-filled. Do not invent example values.
4. Safety-netting must state concrete actions ("call 111", "call 999", "contact the practice"), and when.

STYLE RULES for "note" and "task" blocks: concise clinical register is fine; still no patient-identifiable examples.

NEVER include any patient details, real or invented, anywhere.

--- EXAMPLE JSON ---
{
  "blocks": [
    {
      "id": "results-normal-general",
      "title": "Normal results — no action needed",
      "body": "Hello ***, your recent test results have come back and they are normal. You do not need to do anything. If you still feel unwell, or you are worried, please contact the practice.",
      "trigger": "normal",
      "keywords": "results bloods ok fine no action",
      "category": "results-normal",
      "audience": "patient",
      "leafletUrl": "",
      "slot": "whole"
    },
    {
      "id": "sn-worsening-111",
      "title": "Safety-net — worsening symptoms",
      "body": "If your symptoms get worse, or you feel very unwell, call NHS 111. If it is an emergency, call 999.",
      "trigger": "sn111",
      "keywords": "safety net worse 111 999 emergency",
      "category": "safety-netting",
      "audience": "patient",
      "leafletUrl": "",
      "slot": "safetynet"
    }
  ]
}
--- END EXAMPLE ---

After this line, the practice describes the blocks it wants (topics, tone, any local wording to reuse):
`;
  }

  // ── Module export (dual-mode: Node require OR browser global) ─────────────
  const api = deepFreeze({
    PH_LIMITS,
    SLOTS,
    COMPOSE_ORDER,
    AUDIENCES,
    AUDIENCE_LABEL,
    validateBlock,
    sanitiseBlock,
    sanitiseBlockList,
    sanitiseCategories,
    sanitisePack,
    sanitiseConfig,
    mergeShippedPack,
    composeMessage,
    scoreMatch,
    searchBlocks,
    bumpUsage,
    hasUnfilledPlaceholders,
    charCount,
    generateBlockId,
    slugify,
    phrasesAuthoringPrompt,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.PhrasesCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
