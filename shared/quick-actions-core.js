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

'use strict';

(function (global) {
  // ── Limits ────────────────────────────────────────────────────────────────────
  const QA_LIMITS = {
    label: 28, // one Action / With whom / Timeframe chip label
    fallback: 140, // one "if not / other" suggestion, and the free-text note itself
    list: 24, // entries per list
    line: 240, // the whole composed sentence
  };

  // Prototype-pollution defence for user-supplied set keys — same doctrine as the
  // flag-map key guard in shared/io/reception-io.js.
  const QA_FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  // ── Shipped defaults ──────────────────────────────────────────────────────────
  // Deliberately short lists: this is a picker a GP taps mid-triage, not a taxonomy.
  // Per-surgery edits happen on the options page (Quick Actions section).

  const DEFAULT_CONFIG = deepFreeze({
    version: 1,
    activeSet: 'default',
    sets: {
      default: {
        actions: [
          'Book F2F appt',
          'Book telephone appt',
          'Send booking link',
          'Phone patient',
          'Book bloods (HCA/phlebotomy)',
          'Add to duty list',
          'No appt needed — inform patient',
          'FYI only — no action',
        ],
        who: [
          'Any GP',
          'Usual GP',
          'Me',
          'Duty doctor',
          'Practice nurse',
          'HCA / phlebotomy',
          'Pharmacist',
          'ANP / Paramedic',
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
    'Practice nurse': 'the practice nurse',
    'HCA / phlebotomy': 'HCA/phlebotomy',
    Pharmacist: 'the pharmacist',
    'ANP / Paramedic': 'the ANP/paramedic',
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

    return { version, activeSet, sets };
  }

  // ── Module export (dual-mode: Node require OR browser global) ─────────────────
  const api = {
    DEFAULT_CONFIG,
    QA_LIMITS,
    composeLine,
    appendToComment,
    sanitiseConfig,
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
