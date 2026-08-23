// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared negation terms (single source)
//
// Loaded BEFORE engine/result-severity.js and content-scripts/triage-lens/rule-match.js.
// Hard-throws if a consumer runs without this file (silent fallback would drop chips).

'use strict';

(function (global) {
  // Base set from content-scripts/triage-lens/rule-match.js NEGATORS.
  const BASE_NEGATORS = ['no', 'not', 'denies', 'denied', 'denying', 'without', 'never', 'nil'];
  // result-severity adds 'none' for microbiology ("None isolated").
  const MICRO_NEGATORS = BASE_NEGATORS.concat(['none']);
  const NEGATION_WORD_WINDOW = 6;
  const SENTENCE_BOUNDARY = /[.!?\n]/;

  function sentenceLeft(text, index) {
    if (!SENTENCE_BOUNDARY.test(text)) return 0;
    let left = index;
    while (left > 0 && !SENTENCE_BOUNDARY.test(text[left - 1])) left--;
    return left;
  }

  function isTokenNegated(text, matchIndex, negatorSet) {
    const set = negatorSet || new Set(BASE_NEGATORS);
    const prefix = text.slice(Math.max(0, matchIndex - 5), matchIndex);
    if (/(^|[^a-z])non[-\s]$/.test(prefix)) return true;
    const left = sentenceLeft(text, matchIndex);
    const before = text.slice(left, matchIndex);
    const words = before.split(/\s+/).filter(Boolean);
    const window = words.slice(-NEGATION_WORD_WINDOW);
    for (let i = window.length - 1; i >= 0; i--) {
      const clean = window[i].replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (set.has(clean)) return true;
    }
    return false;
  }

  const api = {
    BASE_NEGATORS,
    MICRO_NEGATORS,
    NEGATION_WORD_WINDOW,
    SENTENCE_BOUNDARY,
    sentenceLeft,
    isTokenNegated,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.NegationTerms = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
