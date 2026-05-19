// Medicus Suite — Sentinel IO helpers
// Exports and imports all Sentinel storage keys as a plain object.
// Used by suite-wide backup and by the Sentinel options page.

'use strict';

const SENTINEL_KEYS = [
  'sentinel.config',
  'sentinel.rules',
  'sentinel.orgRules',
  'sentinel.customRules',
];

// Export all Sentinel storage keys into a plain data object.
async function sentinelExport() {
  const r = await chrome.storage.local.get(SENTINEL_KEYS);
  return {
    config:      r['sentinel.config']      ?? {},
    rules:       r['sentinel.rules']       ?? {},
    orgRules:    r['sentinel.orgRules']    ?? null,
    customRules: r['sentinel.customRules'] ?? [],
  };
}

// Import a Sentinel data object back into storage.
// If merge=true, custom rules and individual overrides are merged rather than replaced.
// Throws with a descriptive message if the data shape is invalid.
async function sentinelImport(data, { merge = false } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Sentinel data must be an object.');

  const toSet = {};

  if (data.config !== undefined) {
    if (typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw new Error('sentinel.config must be an object.');
    }
    toSet['sentinel.config'] = data.config;
  }

  if (data.rules !== undefined) {
    if (typeof data.rules !== 'object' || Array.isArray(data.rules)) {
      throw new Error('sentinel.rules must be an object.');
    }
    if (merge) {
      const existing = await chrome.storage.local.get('sentinel.rules');
      toSet['sentinel.rules'] = Object.assign({}, existing['sentinel.rules'] || {}, data.rules);
    } else {
      toSet['sentinel.rules'] = data.rules;
    }
  }

  if (data.orgRules !== undefined) {
    if (data.orgRules !== null && (typeof data.orgRules !== 'object' || Array.isArray(data.orgRules))) {
      throw new Error('sentinel.orgRules must be an object or null.');
    }
    toSet['sentinel.orgRules'] = data.orgRules;
  }

  if (data.customRules !== undefined) {
    if (!Array.isArray(data.customRules)) {
      throw new Error('sentinel.customRules must be an array.');
    }
    data.customRules.forEach((rule, i) => validateCustomRule(rule, i));
    if (merge) {
      const existing = await chrome.storage.local.get('sentinel.customRules');
      const existingRules = existing['sentinel.customRules'] || [];
      const existingIds = new Set(existingRules.map(r => r.id));
      const merged = [...existingRules];
      data.customRules.forEach(rule => {
        if (!existingIds.has(rule.id)) merged.push(rule);
      });
      toSet['sentinel.customRules'] = merged;
    } else {
      toSet['sentinel.customRules'] = data.customRules;
    }
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

// Validate a custom rule object. Throws on failure.
// Exposed so the rule builder form can call it before save.
function validateCustomRule(rule, index) {
  const loc = index !== undefined ? ` (index ${index})` : '';
  if (!rule || typeof rule !== 'object') throw new Error(`Custom rule${loc} is not an object.`);
  if (!rule.id || typeof rule.id !== 'string') throw new Error(`Custom rule${loc}: id is required.`);
  if (!rule.id.startsWith('custom-')) throw new Error(`Custom rule${loc}: id must start with "custom-".`);

  if (rule.type === 'drug-monitoring')  return validateDrugMonitoringRule(rule, loc);
  if (rule.type === 'qof-indicator')    return validateQofIndicatorRule(rule, loc);
  throw new Error(`Custom rule${loc}: type must be "drug-monitoring" or "qof-indicator".`);
}

function validateDrugMonitoringRule(rule, loc) {
  if (!rule.drug || !Array.isArray(rule.drug.match) || rule.drug.match.length === 0) {
    throw new Error(`Custom rule${loc}: drug.match must be a non-empty array.`);
  }
  if (!Array.isArray(rule.tests) || rule.tests.length === 0) {
    throw new Error(`Custom rule${loc}: tests must be a non-empty array.`);
  }
  rule.tests.forEach((t, ti) => {
    if (!t.name || typeof t.name !== 'string') {
      throw new Error(`Custom rule${loc} test[${ti}]: name is required.`);
    }
    if (!Array.isArray(t.match) || t.match.length === 0) {
      throw new Error(`Custom rule${loc} test[${ti}]: match must be a non-empty array.`);
    }
    if (typeof t.intervalDays !== 'number' || t.intervalDays <= 0 || t.intervalDays > 3650) {
      throw new Error(`Custom rule${loc} test[${ti}]: intervalDays must be a positive number <= 3650.`);
    }
    if (t.dueSoonDays !== undefined && (typeof t.dueSoonDays !== 'number' || t.dueSoonDays < 0)) {
      throw new Error(`Custom rule${loc} test[${ti}]: dueSoonDays must be a non-negative number.`);
    }
  });
}

const ALLOWED_QOF_REGISTERS = ['DM','HYP','CHD','HF','STIA','CKD','PAD','ASTHMA','COPD','AF'];
const ALLOWED_CHECK_KINDS = ['observation-threshold','medication-present','observation-recent'];

function validateQofIndicatorRule(rule, loc) {
  if (!rule.indicatorCode || typeof rule.indicatorCode !== 'string') {
    throw new Error(`Custom rule${loc}: indicatorCode is required.`);
  }
  if (!rule.indicatorName || typeof rule.indicatorName !== 'string') {
    throw new Error(`Custom rule${loc}: indicatorName is required.`);
  }
  if (!rule.check || typeof rule.check !== 'object') {
    throw new Error(`Custom rule${loc}: check object is required.`);
  }
  if (!ALLOWED_CHECK_KINDS.includes(rule.check.kind)) {
    throw new Error(`Custom rule${loc}: check.kind must be one of: ${ALLOWED_CHECK_KINDS.join(', ')}.`);
  }
  if (rule.check.kind === 'observation-threshold') {
    if (!Array.isArray(rule.check.observation) || rule.check.observation.length === 0) {
      throw new Error(`Custom rule${loc}: check.observation must be a non-empty array.`);
    }
    const hasBp = rule.check.thresholdSystolic && rule.check.thresholdDiastolic;
    const hasSingle = rule.check.threshold != null && rule.check.operator;
    if (!hasBp && !hasSingle) {
      throw new Error(`Custom rule${loc}: provide either (threshold + operator) or (thresholdSystolic + thresholdDiastolic).`);
    }
    if (hasSingle && !['<=','<','>=','>','='].includes(rule.check.operator)) {
      throw new Error(`Custom rule${loc}: operator must be one of <= < >= > =`);
    }
  }
  if (rule.check.kind === 'medication-present') {
    if (!Array.isArray(rule.check.medicationMatch) || rule.check.medicationMatch.length === 0) {
      throw new Error(`Custom rule${loc}: check.medicationMatch must be a non-empty array.`);
    }
  }
  if (rule.check.kind === 'observation-recent') {
    if (!Array.isArray(rule.check.observation) || rule.check.observation.length === 0) {
      throw new Error(`Custom rule${loc}: check.observation must be a non-empty array.`);
    }
    if (typeof rule.check.withinDays !== 'number' || rule.check.withinDays <= 0) {
      throw new Error(`Custom rule${loc}: check.withinDays must be a positive number.`);
    }
  }
  if (rule.requiresRegister != null && rule.requiresRegister !== '' && !ALLOWED_QOF_REGISTERS.includes(rule.requiresRegister)) {
    throw new Error(`Custom rule${loc}: requiresRegister must be one of: ${ALLOWED_QOF_REGISTERS.join(', ')}.`);
  }
  if (rule.points != null && (typeof rule.points !== 'number' || rule.points < 0)) {
    throw new Error(`Custom rule${loc}: points must be a non-negative number.`);
  }
  if (rule.ageRange) {
    if (rule.ageRange.min != null && (typeof rule.ageRange.min !== 'number' || rule.ageRange.min < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.min must be a non-negative number.`);
    }
    if (rule.ageRange.max != null && (typeof rule.ageRange.max !== 'number' || rule.ageRange.max < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.max must be a non-negative number.`);
    }
  }
  if (rule.useQofYearFloor !== undefined && typeof rule.useQofYearFloor !== 'boolean') {
    throw new Error(`Custom rule${loc}: useQofYearFloor must be a boolean.`);
  }
}

// Generate a unique custom rule ID from a drug name and current timestamp.
function generateCustomRuleId(drugName) {
  const slug = String(drugName || 'drug')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const ts = Math.floor(Date.now() / 1000);
  return `custom-${slug || 'rule'}-${ts}`;
}

// Compute the default dueSoonDays for an interval.
// >= 84 days (12 weeks): 4 weeks (28 days)
// Otherwise: interval / 6, capped at 30
function defaultDueSoonDays(intervalDays) {
  if (intervalDays >= 84) return 28;
  return Math.min(Math.round(intervalDays / 6), 30);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sentinelExport, sentinelImport, validateCustomRule, generateCustomRuleId, defaultDueSoonDays };
}
