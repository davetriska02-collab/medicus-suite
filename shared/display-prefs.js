// Medicus Suite — Shared display-preferences applicator
// Classic (non-module) script; attach before the page's main script.
// Exposes window.SuiteDisplayPrefs = { apply(prefs) } and self-wires:
//   • reads suite.display from chrome.storage on load
//   • re-applies on chrome.storage.onChanged for the same key
'use strict';

(function () {
  function apply(p) {
    p = p || {};
    document.documentElement.setAttribute('data-theme',      p.theme      || 'light');
    document.documentElement.setAttribute('data-size',       p.size       || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!p.colorblind));
    document.documentElement.setAttribute('data-zen',        p.zen ? '1' : '0');
  }

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('suite.display', function (r) {
      apply((r && r['suite.display']) || {});
    });
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes['suite.display']) apply(changes['suite.display'].newValue || {});
    });
  }

  window.SuiteDisplayPrefs = { apply: apply };
})();
