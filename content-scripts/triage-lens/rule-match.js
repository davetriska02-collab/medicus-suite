// Shared Triage Lens rule matcher — the SINGLE source of truth for compiling a
// triage rule's patterns into regexes and testing text against them.
//
// Both the live content script (content.js) and the Options preview
// (triage-lens/options.js) use this, so the preview can never diverge from what
// actually fires on the page. (Previously options.js re-implemented the compile
// step with a different object shape and a silent catch that dropped invalid
// regexes with no feedback — a clinical-safety footgun: a preview that lies
// about whether a rule fires.) Loaded as a classic script that exposes
// `window.TriageLensMatch` before content.js (manifest order) and before
// options.js (its HTML), and is also require()-able from Node tests.
(function (global) {
  'use strict';

  // Compile a rule's patterns to an array of RegExp.
  //  - Plain-text mode: leading \b only — the pattern is a word STEM
  //    ("cough" matches "cough"/"coughing"/"coughed"), which is what clinical
  //    keyword lists usually want.
  //  - Regex mode: both \b — power-user mode, predictable bounds.
  // Returns { ...rule, _compiled: RegExp[], _errors: string[] } or null when the
  // rule is disabled / has no usable patterns (identical to the prior content.js
  // behaviour). `_errors` lists patterns that failed to compile so a caller (the
  // preview) can SURFACE them rather than swallow them.
  function compileRule(rule) {
    if (!rule || !rule.enabled) return null;
    const compiled = [];
    const errors = [];
    for (const p of rule.patterns || []) {
      const s = String(p || '').trim();
      if (!s) continue;
      try {
        const src = rule.regex ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wrapped = rule.regex ? '\\b' + src + '\\b' : '\\b' + src;
        compiled.push(new RegExp(wrapped, 'i'));
      } catch (e) {
        // A dropped pattern is a silent clinical gap — record it (for the
        // preview to show) and log it (for the runtime console).
        errors.push(`pattern ${JSON.stringify(s)} failed to compile: ${e.message}`);
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(
            `[Sentinel] rule "${rule.label || rule.id}" pattern ${JSON.stringify(s)} failed to compile and was skipped: ${e.message}`
          );
        }
      }
    }
    if (!compiled.length) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          `[Sentinel] rule "${rule.label || rule.id}" has no usable patterns after compilation — rule will never fire`
        );
      }
      return null;
    }
    return { ...rule, _compiled: compiled, _errors: errors };
  }

  // Does the compiled rule match the given text? Mirrors content.js matchRules'
  // inner test exactly (`_compiled.some(re => re.test(text))`).
  function ruleMatchesText(compiledRule, text) {
    if (!compiledRule || !compiledRule._compiled) return false;
    return compiledRule._compiled.some((re) => re.test(text));
  }

  // ---- Match evidence (item 2.1, TRIAGE-LENS-2026-07-02.md) ----
  // Built ON TOP of the SAME compiled pattern array ruleMatchesText tests
  // against — same patterns, same order, same "first pattern that matches
  // wins" — so this can never disagree with ruleMatchesText: evidence !==
  // null exactly when ruleMatchesText(compiledRule, text) is true. Returns
  // null when nothing matches, else:
  //   term    — the matched substring exactly as it appears in `text`
  //             (patterns are case-insensitive, so this preserves the
  //             original text's casing/inflection, e.g. "Coughing").
  //   start/end — character offsets of the match within `text`.
  //   context — the sentence containing the match (bounded by the nearest
  //             `.`/`!`/`?`/newline on each side, or the start/end of `text`
  //             itself), trimmed. If `text` contains NO sentence-ending
  //             punctuation anywhere (common in free-typed patient request
  //             text), falls back to an ellipsised +/-80 character window
  //             around the match instead.
  //   qualifier / qualifierTerm — item 3.4 (TRIAGE-LENS-2026-07-02.md),
  //             display-only negation/past-tense demotion. See below.
  const SENTENCE_BOUNDARY = /[.!?\n]/;
  const CONTEXT_WINDOW = 80;

  // The sentence (or, absent any sentence punctuation, the +/-80 char window)
  // bounding a match — shared by matchContext (the human-readable evidence
  // snippet) and detectQualifier (item 3.4's negation/past-tense scan), so
  // both always agree on "the same sentence as the match". `isSentence`
  // distinguishes the two paths because only the window-fallback path gets
  // ellipsis markers in matchContext.
  function sentenceSpan(text, start, end) {
    if (SENTENCE_BOUNDARY.test(text)) {
      let left = start;
      while (left > 0 && !SENTENCE_BOUNDARY.test(text[left - 1])) left--;
      let right = end;
      while (right < text.length && !SENTENCE_BOUNDARY.test(text[right])) right++;
      if (right < text.length) right++; // include the terminating punctuation itself
      return { left, right, isSentence: true };
    }
    const left = Math.max(0, start - CONTEXT_WINDOW);
    const right = Math.min(text.length, end + CONTEXT_WINDOW);
    return { left, right, isSentence: false };
  }

  function matchContext(text, start, end) {
    const { left, right, isSentence } = sentenceSpan(text, start, end);
    if (isSentence) {
      return text.slice(left, right).trim();
    }
    let ctx = text.slice(left, right).trim();
    if (left > 0) ctx = '…' + ctx;
    if (right < text.length) ctx = ctx + '…';
    return ctx;
  }

  // ---- Negation / past-tense demotion (item 3.4, TRIAGE-LENS-2026-07-02.md) ----
  // DISPLAY-ONLY: a qualified match is never suppressed, only ranked lower and
  // shown distinctly (escalate-only safety stance — see content.js's rule-chip
  // rendering and CLAUDE.md's clinical-safety conventions). Kept as exported
  // consts so they're listed in the phase's clinical review doc.
  //
  //  - negated: one of NEGATORS appearing as a WHOLE WORD before the matched
  //    term, within 6 words of the match start, in the SAME sentence as the
  //    match (sentenceSpan above). Order matters: a negator AFTER the term
  //    ("chest pain, no relief") does not qualify.
  //  - past: one of PAST_MARKERS appearing as a whole PHRASE anywhere in the
  //    same sentence ("had a UTI last year").
  //  - negated wins if both are present.
  const NEGATORS = ['no', 'not', 'denies', 'denied', 'denying', 'without', 'never', 'nil'];
  const PAST_MARKERS = [
    'last year',
    'last month',
    'years ago',
    'months ago',
    'weeks ago',
    'previously',
    'in the past',
    'history of',
    'previous',
  ];
  const NEGATOR_SET = new Set(NEGATORS);
  const PAST_MARKER_PATTERNS = PAST_MARKERS.map(
    (phrase) => new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
  );
  const NEGATION_WORD_WINDOW = 6;

  function detectQualifier(text, start, end) {
    const { left, right } = sentenceSpan(text, start, end);
    const sentenceText = text.slice(left, right);
    const matchStartInSentence = start - left;

    // Negation: a whole-word negator among the (up to) 6 words immediately
    // BEFORE the match, within this sentence only.
    const before = sentenceText.slice(0, Math.max(0, matchStartInSentence));
    const beforeWords = before.split(/\s+/).filter(Boolean);
    const window = beforeWords.slice(-NEGATION_WORD_WINDOW);
    for (let i = window.length - 1; i >= 0; i--) {
      // Strip surrounding punctuation so "no," / "(no" still match, but
      // "notable"/"nothing" — real words that merely CONTAIN a negator —
      // never do (whole-word discipline).
      const clean = window[i].replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (NEGATOR_SET.has(clean)) {
        return { qualifier: 'negated', qualifierTerm: clean };
      }
    }

    // Past-tense: a whole phrase anywhere in the sentence (before OR after).
    for (let i = 0; i < PAST_MARKERS.length; i++) {
      if (PAST_MARKER_PATTERNS[i].test(sentenceText)) {
        return { qualifier: 'past', qualifierTerm: PAST_MARKERS[i] };
      }
    }

    return { qualifier: null, qualifierTerm: null };
  }

  // Every match (across the WHOLE compiled pattern set) in `text`, sorted by
  // position — used only to look for a later, unqualified restatement of the
  // same rule (see ruleMatchEvidence below). Each compiled regex is re-run in
  // global mode so every one of its occurrences is found, not just the first.
  function findAllMatches(compiledRule, text) {
    const matches = [];
    for (const re of compiledRule._compiled) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const globalRe = new RegExp(re.source, flags);
      let m;
      while ((m = globalRe.exec(text))) {
        matches.push({ term: m[0], start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) globalRe.lastIndex++; // defensive: never spin on a zero-width match
      }
    }
    matches.sort((a, b) => a.start - b.start);
    return matches;
  }

  function evidenceFromMatch(text, match) {
    const q = detectQualifier(text, match.start, match.end);
    return {
      term: match.term,
      start: match.start,
      end: match.end,
      context: matchContext(text, match.start, match.end),
      qualifier: q.qualifier,
      qualifierTerm: q.qualifierTerm,
    };
  }

  function ruleMatchEvidence(compiledRule, text) {
    if (!compiledRule || !compiledRule._compiled) return null;
    const s = text == null ? '' : String(text);
    // "First pattern that matches wins" — same order/short-circuit as
    // ruleMatchesText, unchanged.
    let first = null;
    for (const re of compiledRule._compiled) {
      const m = re.exec(s);
      if (m) {
        first = { term: m[0], start: m.index, end: m.index + m[0].length };
        break;
      }
    }
    if (!first) return null;

    const firstEv = evidenceFromMatch(s, first);
    if (!firstEv.qualifier) return firstEv;

    // The first match is negated/past — a request can contain a LATER,
    // un-negated restatement of the same rule ("no chest pain yesterday but
    // definite chest pain again now"); prefer that stronger evidence over the
    // qualified one so the chip/menu lead with the live mention.
    const later = findAllMatches(compiledRule, s).find(
      (m) => m.start >= first.end && !detectQualifier(s, m.start, m.end).qualifier
    );
    return later ? evidenceFromMatch(s, later) : firstEv;
  }

  const api = { compileRule, ruleMatchesText, ruleMatchEvidence, NEGATORS, PAST_MARKERS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TriageLensMatch = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
