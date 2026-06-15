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

  const api = { compileRule, ruleMatchesText };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TriageLensMatch = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
