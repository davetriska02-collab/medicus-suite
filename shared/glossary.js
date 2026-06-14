// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Shared Glossary
//
// A small static map of clinical/operational jargon that has NO source text
// anywhere else in the suite (unlike QOF indicator names or drug-combo labels,
// which travel on the chip objects themselves). Surfaced via shared/tooltip.js
// when an element carries data-tip-key="<key>".
//
// Exposes window.Glossary = { lookup(key), terms }.
// Keep it small and honest; do NOT duplicate data already on chips.

(function (global) {
  'use strict';

  const terms = {
    rag: 'Red / Amber / Green rating. Red = action needed now, amber = due soon, green = up to date.',
    dmard: 'Disease-Modifying Anti-Rheumatic Drug (e.g. methotrexate). Needs regular blood monitoring.',
    'triple-whammy': 'NSAID + ACE inhibitor or ARB + diuretic taken together. Raises the risk of acute kidney injury.',
    ppi: 'Practice Pressure Index: a 0-100 score combining waiting room, request queue, urgent requests and capacity into one pressure figure.',
    efi: 'electronic Frailty Index: an estimate of frailty from problems on the record. Not a validated clinical assessment.',
    'triage-load': 'How many triage requests are waiting. Needs the Triage Monitor set up in Options.',
  };

  // lookup(key) → plain-English string, or '' if the key is unknown.
  // Case-insensitive; tolerates a leading/trailing whitespace.
  function lookup(key) {
    if (!key) return '';
    const k = String(key).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(terms, k) ? terms[k] : '';
  }

  const api = { lookup, terms };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Glossary = api;
  }
})(typeof window !== 'undefined' ? window : global);
