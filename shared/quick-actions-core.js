// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — GP → reception "Quick actions" composer core (pure logic, no chrome APIs, no DOM)
//
// Shared by the injected composer strip (content-scripts/reception-quick-actions.js),
// the practice editor on the options page, and node tests. Loaded as a plain script in
// extension pages/content scripts (window.QuickActionsCore) and via require() in node
// tests — same dual-mode export as engine/reception-match.js.
//
// WHAT THIS IS
//   On a Medicus task overview a GP types a free-text instruction to reception into the
//   "Internal comment" box ("routine with nat please"). This module turns three picked
//   chips — WHAT needs to happen, WITH WHOM, and BY WHEN — plus an optional free-text
//   "if not / other" note into ONE plain-English sentence for that box.
//
// WHAT THIS IS NOT
//   It books nothing, sends nothing and submits nothing. composeLine() returns a STRING;
//   appendToComment() returns a STRING. Every clinical effect downstream comes from the
//   GP reading what was inserted and pressing Medicus's own Submit control. See H-049.
//
// SENTENCE DOCTRINE (why the maps below exist)
//   The line is read by a receptionist, not parsed by a machine, so it must read as
//   English: verb first, one sentence, a full stop, no prefixes, no pipes, no CAPS, no
//   emoji. The chip LABELS are written for a picker ("Usual GP", "Within 48h"), which is
//   not how they read mid-sentence ("Book F2F appt with Usual GP" is wrong), so shipped
//   generic labels get an exact-match rendering. Anything NOT in the map — above all a
//   person's name a practice added ("Nat") — is rendered VERBATIM: guessing at a human
//   name's grammar is how you end up telling reception to book with "the nat".
//
// Exported functions:
//   DEFAULT_CONFIG                          — shipped chip lists (deep-frozen)
//   composeLine({action, who, when, note})  — the one sentence ('' when no action)
//   appendToComment(existing, line)         — append-only join, never rewrites `existing`
//   sanitiseConfig(raw)                     — a valid config from ANY input
//   mergeShippedPresets(raw)                — version-gated union of new shipped presets
//   normaliseLabel(label) / isShippedLabel(listKey, label) — tombstone helpers

'use strict';

(function (global) {
  // ── Limits ────────────────────────────────────────────────────────────────────
  const QA_LIMITS = {
    label: 28, // one Action / With whom / Timeframe chip label
    fallback: 140, // one "if not / other" suggestion, and the free-text note itself
    list: 24, // entries per list
    line: 240, // the whole composed sentence
    tombstones: 96, // removedShipped entries (4 lists × `list`) — see mergeShippedPresets
  };

  // Prototype-pollution defence for user-supplied set keys — same doctrine as the
  // flag-map key guard in shared/io/reception-io.js.
  const QA_FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  // ── Shipped defaults ──────────────────────────────────────────────────────────
  // Deliberately short lists: this is a picker a GP taps mid-triage, not a taxonomy.
  // Per-surgery edits happen on the options page (Quick Actions section).

  // `version` gates mergeShippedPresets(): bump it whenever an entry is ADDED to a
  // list below, or existing installs (which all carry a stored config) never see it —
  // the same stranded-defaults failure class as defaults.json's integer version.
  const DEFAULT_CONFIG = deepFreeze({
    version: 2,
    activeSet: 'default',
    removedShipped: [],
    sets: {
      default: {
        actions: [
          'Book F2F appt',
          'Book telephone appt',
          'Send booking link',
          'Phone patient',
          'Book bloods (HCA/phlebotomy)',
          'Book medication review',
          'Book DOAC review',
          'Book CVD review',
          'Add to duty list',
          'Add to jobs list',
          // "No appt needed — inform patient" was 31 chars and silently clamped to
          // "No appt needed — inform pati" (QA_LIMITS.label) — the exact failure the
          // label-length assertion in test-quick-actions-core.js now guards.
          'No appt — inform patient',
          'FYI only — no action',
        ],
        who: [
          'Any GP',
          'Usual GP',
          'Me',
          'Duty doctor',
          'Registrar',
          'Practice nurse',
          'HCA / phlebotomy',
          'Pharmacist',
          'ANP / Paramedic',
          'First-contact physio',
          'Mental health practitioner',
        ],
        when: [
          'Today',
          'Tomorrow',
          'Within 48h',
          'This week',
          'Within 2 weeks',
          'Within 4 weeks',
          'Routine (next available)',
        ],
        fallbacks: [
          'if no answer, text booking link',
          'if none free, book next available and let me know',
          'if patient declines, task back to me',
        ],
      },
    },
  });

  const LIST_KEYS = ['actions', 'who', 'when', 'fallbacks'];

  // ── Mid-sentence rendering maps (exact match only — see SENTENCE DOCTRINE) ────

  const WHO_RENDER = {
    'Any GP': 'any GP',
    'Usual GP': 'their usual GP',
    Me: 'me',
    'Duty doctor': 'the duty doctor',
    Registrar: 'the registrar',
    'Practice nurse': 'the practice nurse',
    'HCA / phlebotomy': 'HCA/phlebotomy',
    Pharmacist: 'the pharmacist',
    'ANP / Paramedic': 'the ANP/paramedic',
    // "a", not "the": a practice has one duty doctor on a given day but may have
    // several of these, and "book with the first-contact physio" reads as a named
    // individual reception is expected to identify.
    'First-contact physio': 'a first-contact physio',
    'Mental health practitioner': 'a mental health practitioner',
  };

  const WHEN_RENDER = {
    Today: 'today',
    Tomorrow: 'tomorrow',
    'Within 48h': 'within 48h',
    'This week': 'this week',
    'Within 2 weeks': 'within 2 weeks',
    'Within 4 weeks': 'within 4 weeks',
    'Routine (next available)': 'routine',
  };

  // An action beginning "FYI" means "nothing needs doing" — a "with whom / by when"
  // tail on it would be a contradiction reception could act on, so both are dropped.
  const FYI_RE = /^FYI/i;
  const FYI_LINE = 'FYI — no action needed.';

  // ── Helpers ───────────────────────────────────────────────────────────────────

  // Same shape as shared/lab-filing-utils.js's clamp(): coerce → trim → slice.
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

  // Lower-case the first character unless the SECOND character is also upper case —
  // the acronym guard, so "ASAP" survives while "Before Friday" becomes
  // "before Friday". Only ever applied to custom (unmapped) timeframe labels.
  function decapitalise(s) {
    if (!s) return s;
    if (s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase()) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function capitalise(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // The identity used for "is this the same entry?" everywhere outside rendering:
  // trim, collapse internal whitespace, lower-case. Deliberately loose, because it
  // decides whether a migration RE-ADDS a preset the practice already has under a
  // slightly different casing ("Duty Doctor") — a duplicate chip is the failure.
  function normaliseLabel(label) {
    return String(label ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // Is this label one the suite ships for that list? (Only shipped labels are worth
  // tombstoning — a practice's own entry is never re-added by a migration.)
  function isShippedLabel(listKey, label) {
    if (!LIST_KEYS.includes(listKey)) return false;
    const n = normaliseLabel(label);
    if (!n) return false;
    return DEFAULT_CONFIG.sets.default[listKey].some((x) => normaliseLabel(x) === n);
  }

  function renderWho(who) {
    const label = clamp(who, QA_LIMITS.label);
    if (!label) return '';
    return Object.prototype.hasOwnProperty.call(WHO_RENDER, label) ? WHO_RENDER[label] : label;
  }

  function renderWhen(when) {
    const label = clamp(when, QA_LIMITS.label);
    if (!label) return '';
    return Object.prototype.hasOwnProperty.call(WHEN_RENDER, label) ? WHEN_RENDER[label] : decapitalise(label);
  }

  // The free-text tail. Clamped, sentence-cased and full-stopped so the composed
  // line stays one readable instruction however the GP typed it.
  function renderNote(note) {
    const text = clamp(note, QA_LIMITS.fallback);
    if (!text) return '';
    const cased = capitalise(text);
    return /[.!?]$/.test(cased) ? cased : cased + '.';
  }

  // ── composeLine ───────────────────────────────────────────────────────────────
  //
  //   {action} with {who}, {when}.[ {note}]
  //
  // `who` and `when` are OPTIONAL (each simply drops its clause). `action` is
  // required — with no action there is no instruction, so the function returns ''
  // and the widget keeps its Insert button disabled.

  function composeLine(sel) {
    const s = sel && typeof sel === 'object' ? sel : {};
    const action = clamp(s.action, QA_LIMITS.label);
    if (!action) return '';

    const note = renderNote(s.note);

    let head;
    if (FYI_RE.test(action)) {
      head = FYI_LINE;
    } else {
      const who = renderWho(s.who);
      const when = renderWhen(s.when);
      head = action + (who ? ' with ' + who : '') + (when ? ', ' + when : '') + '.';
    }

    const line = note ? head + ' ' + note : head;
    return line.slice(0, QA_LIMITS.line);
  }

  // ── appendToComment ───────────────────────────────────────────────────────────
  //
  // APPEND-ONLY, by design (H-049 control): whatever the clinician already typed is
  // returned untouched at the head of the result. The separator is a single newline,
  // and only when one is actually needed.

  function appendToComment(existing, line) {
    const base = typeof existing === 'string' ? existing : '';
    const add = typeof line === 'string' ? line : '';
    if (!add) return base;
    if (!base) return add;
    const sep = base.endsWith('\n') ? '' : '\n';
    return base + sep + add;
  }

  // ── sanitiseConfig ────────────────────────────────────────────────────────────
  //
  // Never throws, never returns a partial shape: whatever comes out of
  // chrome.storage (or a restored backup, or a hand-edited import) becomes a
  // usable config or the shipped one. Chip labels are rendered by the injected
  // widget, so lengths are clamped here and escaped at render time — this function
  // deliberately does NOT strip markup, it just carries text (see the <script>
  // case pinned in test-quick-actions-core.js).

  function sanitiseList(arr, itemMax) {
    return (Array.isArray(arr) ? arr : [])
      .filter((x) => typeof x === 'string')
      .map((x) => clamp(x, itemMax))
      .filter(Boolean)
      .slice(0, QA_LIMITS.list);
  }

  function itemMaxFor(key) {
    return key === 'fallbacks' ? QA_LIMITS.fallback : QA_LIMITS.label;
  }

  function defaultList(key) {
    return DEFAULT_CONFIG.sets.default[key].slice();
  }

  function sanitiseSet(raw, isDefaultSet) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const key of LIST_KEYS) {
      if (!Array.isArray(src[key])) {
        // Missing entirely — the shipped list for the default set, empty elsewhere.
        out[key] = isDefaultSet ? defaultList(key) : [];
      } else {
        out[key] = sanitiseList(src[key], itemMaxFor(key));
      }
    }
    return out;
  }

  // Tombstones: normalised labels of SHIPPED entries the practice deleted. Stored
  // normalised (that is the comparison key), de-duplicated, and capped like every
  // other list so a corrupt import cannot grow unbounded.
  function sanitiseTombstones(arr) {
    const out = [];
    const seen = new Set();
    for (const x of Array.isArray(arr) ? arr : []) {
      if (typeof x !== 'string') continue;
      const n = normaliseLabel(clamp(x, QA_LIMITS.fallback));
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= QA_LIMITS.tombstones) break;
    }
    return out;
  }

  function sanitiseConfig(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    const v = Number(src.version);
    const version = Number.isFinite(v) && Math.floor(v) >= 1 ? Math.floor(v) : 1;

    const rawSets = src.sets && typeof src.sets === 'object' && !Array.isArray(src.sets) ? src.sets : {};
    const sets = {};
    for (const key of Object.keys(rawSets)) {
      if (QA_FORBIDDEN_KEYS.includes(key)) continue; // prototype-pollution defence
      const name = clamp(key, QA_LIMITS.label);
      if (!name) continue;
      // Re-check AFTER clamping: a padded key ("  __proto__") passes the raw
      // check, then trims into a forbidden name — and sets[name] = … with
      // name '__proto__' would rewrite the object's prototype, not add a key.
      if (QA_FORBIDDEN_KEYS.includes(name)) continue;
      sets[name] = sanitiseSet(rawSets[key], name === 'default');
    }
    if (!sets.default) sets.default = sanitiseSet(null, true);

    const wanted = clamp(src.activeSet, QA_LIMITS.label);
    const activeSet = wanted && Object.prototype.hasOwnProperty.call(sets, wanted) ? wanted : 'default';

    return { version, activeSet, removedShipped: sanitiseTombstones(src.removedShipped), sets };
  }

  // ── mergeShippedPresets ───────────────────────────────────────────────────────
  //
  // Version-gated migration: a practice with a stored config would otherwise never
  // receive a preset added after their first save (the stranded-defaults failure
  // class — see CHANGELOG v3.75.2). When the stored `version` is behind the shipped
  // one, union in shipped entries the config does not already have, matching on
  // normalised label. Pure and idempotent: nothing is ever removed or reordered,
  // user entries keep their positions, and a second run is a no-op.
  //
  // MUST be called on BOTH storage-key load paths in lock-step — the injected widget
  // (content-scripts/reception-quick-actions.js) and the options editor
  // (options/options.js initQuickActions) — or whichever surface loads second saves
  // a stale-version config back and un-migrates the practice.
  //
  // Deletions survive: a shipped label in `removedShipped` is skipped, so a preset
  // the practice deliberately deleted is not resurrected on every version bump.
  //
  // Returns { cfg, changed } — `changed` is the caller's cue to persist (the version
  // stamp alone must be written, or the migration re-runs on every load).
  function mergeShippedPresets(raw) {
    const cfg = sanitiseConfig(raw);
    if (cfg.version >= DEFAULT_CONFIG.version) return { cfg, changed: false };

    const tombstoned = new Set(cfg.removedShipped);

    for (const setName of Object.keys(cfg.sets)) {
      const set = cfg.sets[setName];
      for (const key of LIST_KEYS) {
        const list = set[key];
        // An EMPTY list is left empty on purpose: it is either a practice's second
        // set (sanitiseSet ships those empty by design) or a list the practice
        // cleared. Seeding either one from the shipped defaults would be a
        // resurrection, not a migration.
        if (!Array.isArray(list) || list.length === 0) continue;
        const present = new Set(list.map(normaliseLabel));
        for (const shipped of DEFAULT_CONFIG.sets.default[key]) {
          const n = normaliseLabel(shipped);
          if (!n || present.has(n) || tombstoned.has(n)) continue;
          // Never displace a user entry: sanitiseConfig would slice the overflow
          // off the TAIL, which is exactly where the practice's own entries sit.
          if (list.length >= QA_LIMITS.list) break;
          list.push(shipped);
          present.add(n);
        }
      }
    }

    cfg.version = DEFAULT_CONFIG.version;
    return { cfg, changed: true };
  }

  // ── Module export (dual-mode: Node require OR browser global) ─────────────────
  const api = {
    DEFAULT_CONFIG,
    QA_LIMITS,
    composeLine,
    appendToComment,
    sanitiseConfig,
    mergeShippedPresets,
    normaliseLabel,
    isShippedLabel,
    // Exposed so the options-page editor and the tests can pin the rendering maps.
    WHO_RENDER,
    WHEN_RENDER,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.QuickActionsCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
