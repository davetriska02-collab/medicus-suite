// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Triage Alert IO

'use strict';

(function (global) {

  const RULES_KEY = 'suite.triageAlert.rules';

  const DEFAULT_RULES = [
    { key: 'medNew',     label: 'New medical',   threshold: 10, enabled: false },
    { key: 'medReply',   label: 'Medical reply',  threshold: 5,  enabled: false },
    { key: 'adminNew',   label: 'New admin',      threshold: 10, enabled: false },
    { key: 'adminReply', label: 'Admin reply',    threshold: 5,  enabled: false },
  ];

  async function getRules() {
    const r = await chrome.storage.local.get(RULES_KEY);
    return r[RULES_KEY] ?? DEFAULT_RULES.map(x => ({ ...x }));
  }

  async function setRules(rules) {
    if (!Array.isArray(rules)) throw new Error('rules must be an array');
    // M2: validate each rule's numeric threshold before persisting so a crafted
    // backup with a string/NaN/Infinity threshold cannot reach the consumer where
    // `value >= NaN` is always false and alerts silently never fire.
    rules.forEach((rule, i) => {
      if (rule == null || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new Error(`triageAlert.rules[${i}]: must be a non-null object.`);
      }
      if (typeof rule.key !== 'string' || rule.key.length === 0) {
        throw new Error(`triageAlert.rules[${i}]: key must be a non-empty string.`);
      }
      if (rule.threshold != null) {
        if (!Number.isFinite(rule.threshold) || rule.threshold <= 0) {
          throw new Error(
            `triageAlert.rules[${i}] ("${rule.key}"): threshold must be a finite positive number (got ${JSON.stringify(rule.threshold)}).`
          );
        }
      }
      if (rule.enabled != null && typeof rule.enabled !== 'boolean') {
        throw new Error(
          `triageAlert.rules[${i}] ("${rule.key}"): enabled must be a boolean (got ${JSON.stringify(rule.enabled)}).`
        );
      }
    });
    await chrome.storage.local.set({ [RULES_KEY]: rules });
  }

  async function exportData() {
    return { rules: await getRules() };
  }

  async function importData(data) {
    if (!data || typeof data !== 'object') return;
    // setRules validates each rule; any invalid rule throws — intentional.
    // practice-profile.js calls this inside a try/catch, so throwing here
    // surfaces the error correctly rather than silently storing bad data.
    if (Array.isArray(data.rules)) await setRules(data.rules);
  }

  const TriageAlertIO = { getRules, setRules, exportData, importData, DEFAULT_RULES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TriageAlertIO;
  } else {
    global.TriageAlertIO = TriageAlertIO;
  }

})(typeof self !== 'undefined' ? self : this);
