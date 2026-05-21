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
    await chrome.storage.local.set({ [RULES_KEY]: rules });
  }

  async function exportData() {
    return { rules: await getRules() };
  }

  async function importData(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.rules)) await setRules(data.rules);
  }

  const TriageAlertIO = { getRules, setRules, exportData, importData, DEFAULT_RULES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TriageAlertIO;
  } else {
    global.TriageAlertIO = TriageAlertIO;
  }

})(typeof self !== 'undefined' ? self : this);
