// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel IO helpers
// Exports and imports all Sentinel storage keys as a plain object.
// Used by suite-wide backup and by the Sentinel options page.

'use strict';

const SENTINEL_KEYS = [
  'sentinel.config',
  'sentinel.rules',
  'sentinel.orgRules',
  'sentinel.customRules',
  'sentinel.alertLibrary.acknowledged',
  'sentinel.hiddenRules',
];

// Export all Sentinel storage keys into a plain data object.
async function sentinelExport() {
  const r = await chrome.storage.local.get(SENTINEL_KEYS);
  return {
    config:      r['sentinel.config']      ?? {},
    rules:       r['sentinel.rules']       ?? {},
    orgRules:    r['sentinel.orgRules']    ?? null,
    customRules: r['sentinel.customRules'] ?? [],
    alertLibraryAcknowledged: r['sentinel.alertLibrary.acknowledged'] ?? false,
    hiddenRules: r['sentinel.hiddenRules'] ?? {},
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

  if (data.alertLibraryAcknowledged !== undefined) {
    if (typeof data.alertLibraryAcknowledged !== 'boolean') {
      throw new Error('sentinel.alertLibrary.acknowledged must be a boolean.');
    }
    toSet['sentinel.alertLibrary.acknowledged'] = data.alertLibraryAcknowledged;
  }

  if (data.hiddenRules !== undefined) {
    if (typeof data.hiddenRules !== 'object' || Array.isArray(data.hiddenRules) || data.hiddenRules === null) {
      throw new Error('sentinel.hiddenRules must be an object.');
    }
    // NF3: validate each entry is {until: ISO-date-string | null} to prevent
    // malformed values causing unpredictable hide/show behaviour at runtime.
    // Optional new fields: statusAtDismissal (string) and dismissedAt (YYYY-MM-DD).
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    for (const [ruleId, entry] of Object.entries(data.hiddenRules)) {
      if (typeof entry !== 'object' || Array.isArray(entry) || entry === null) {
        throw new Error(`sentinel.hiddenRules["${ruleId}"]: entry must be an object.`);
      }
      if (entry.until !== null && entry.until !== undefined &&
          (typeof entry.until !== 'string' || !ISO_DATE_RE.test(entry.until))) {
        throw new Error(`sentinel.hiddenRules["${ruleId}"].until: must be null or a YYYY-MM-DD date string.`);
      }
      if (entry.statusAtDismissal !== undefined && entry.statusAtDismissal !== null &&
          typeof entry.statusAtDismissal !== 'string') {
        throw new Error(`sentinel.hiddenRules["${ruleId}"].statusAtDismissal: must be a string or null.`);
      }
      if (entry.dismissedAt !== undefined && entry.dismissedAt !== null &&
          (typeof entry.dismissedAt !== 'string' || !ISO_DATE_RE.test(entry.dismissedAt))) {
        throw new Error(`sentinel.hiddenRules["${ruleId}"].dismissedAt: must be null or a YYYY-MM-DD date string.`);
      }
    }
    toSet['sentinel.hiddenRules'] = data.hiddenRules;
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
  if (rule.type === 'drug-combo')       return validateDrugComboRule(rule, loc);
  if (rule.type === 'event-count')      return validateEventCountRule(rule, loc);
  if (rule.type === 'composite')        return validateCompositeRule(rule, loc);
  throw new Error(`Custom rule${loc}: type must be one of "drug-monitoring", "qof-indicator", "drug-combo", "event-count", "composite".`);
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
    if (t.snomed !== undefined && (!Array.isArray(t.snomed) || t.snomed.some(s => typeof s !== 'string'))) {
      throw new Error(`Custom rule${loc} test[${ti}]: snomed must be an array of strings.`);
    }
  });
  // Optional patient filters (the engine gates drug-monitoring rules on these).
  if (rule.sex != null && !ALLOWED_SEX_VALUES.includes(rule.sex)) {
    throw new Error(`Custom rule${loc}: sex must be one of: ${ALLOWED_SEX_VALUES.join(', ')}.`);
  }
  if (rule.ageRange) {
    if (rule.ageRange.min != null && (typeof rule.ageRange.min !== 'number' || rule.ageRange.min < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.min must be a non-negative number.`);
    }
    if (rule.ageRange.max != null && (typeof rule.ageRange.max !== 'number' || rule.ageRange.max < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.max must be a non-negative number.`);
    }
  }
  for (const f of ['requiresProblem', 'excludesProblem']) {
    if (rule[f] != null && (!Array.isArray(rule[f]) || rule[f].some(t => typeof t !== 'string'))) {
      throw new Error(`Custom rule${loc}: ${f} must be an array of strings.`);
    }
  }
}

const ALLOWED_QOF_REGISTERS = ['DM','HYP','CHD','HF','STIA','CKD','PAD','ASTHMA','COPD','AF'];
// Keep in sync with IMPLEMENTED_KINDS in test-rule-schema.js and check.kind === guards in engine/rules-engine.js.
const ALLOWED_CHECK_KINDS = ['observation-threshold','medication-present','observation-recent','observation-trend','observation-alert','observation-bundle'];
const ALLOWED_SEVERITIES = ['red','amber','info'];
const ALLOWED_SEX_VALUES = ['any','M','F'];
const ALLOWED_EVENT_COUNT_OPERATORS = ['>=','>','=','<=','<'];
const ALLOWED_SOURCE_KINDS = ['problems','observations'];

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
  if (rule.check.kind === 'observation-trend') {
    if (!Array.isArray(rule.check.observation) || rule.check.observation.length === 0) {
      throw new Error(`Custom rule${loc}: check.observation must be a non-empty array.`);
    }
    if (!['rising','falling'].includes(rule.check.direction)) {
      throw new Error(`Custom rule${loc}: check.direction must be "rising" or "falling".`);
    }
    if (rule.check.minPoints != null && (typeof rule.check.minPoints !== 'number' || rule.check.minPoints < 2)) {
      throw new Error(`Custom rule${loc}: check.minPoints must be a number >= 2.`);
    }
    if (rule.check.withinMonths != null && (typeof rule.check.withinMonths !== 'number' || rule.check.withinMonths <= 0)) {
      throw new Error(`Custom rule${loc}: check.withinMonths must be a positive number.`);
    }
    if (rule.check.minDelta != null && (typeof rule.check.minDelta !== 'number' || rule.check.minDelta < 0)) {
      throw new Error(`Custom rule${loc}: check.minDelta must be a non-negative number.`);
    }
  }
  if (rule.check.kind === 'observation-bundle') {
    // An empty observations array is vacuously "achieved" — not a useful rule.
    if (!Array.isArray(rule.check.observations) || rule.check.observations.length === 0) {
      throw new Error(`Custom rule${loc}: check.observations must be a non-empty array for observation-bundle.`);
    }
  }
  if (rule.check.kind === 'observation-alert') {
    if (!Array.isArray(rule.check.observation) || rule.check.observation.length === 0) {
      throw new Error(`Custom rule${loc}: check.observation must be a non-empty array.`);
    }
    if (rule.check.comparator !== undefined && !['above','below'].includes(rule.check.comparator)) {
      throw new Error(`Custom rule${loc}: check.comparator must be "above" or "below".`);
    }
    if (rule.check.amber == null && rule.check.red == null) {
      throw new Error(`Custom rule${loc}: at least one of check.amber or check.red must be present.`);
    }
    if (rule.check.amber != null && typeof rule.check.amber !== 'number') {
      throw new Error(`Custom rule${loc}: check.amber must be a number.`);
    }
    if (rule.check.red != null && typeof rule.check.red !== 'number') {
      throw new Error(`Custom rule${loc}: check.red must be a number.`);
    }
    if (rule.check.withinDays != null && (typeof rule.check.withinDays !== 'number' || rule.check.withinDays <= 0)) {
      throw new Error(`Custom rule${loc}: check.withinDays must be a positive number.`);
    }
    if (rule.check.unit != null && typeof rule.check.unit !== 'string') {
      throw new Error(`Custom rule${loc}: check.unit must be a string.`);
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
  if (rule.sex != null && !['M', 'F', 'any'].includes(rule.sex)) {
    throw new Error(`Custom rule${loc}: sex must be "M", "F" or "any".`);
  }
  for (const f of ['requiresProblem', 'requiresAnyProblem', 'excludeIfProblem']) {
    if (rule[f] != null && (!Array.isArray(rule[f]) || rule[f].some(t => typeof t !== 'string'))) {
      throw new Error(`Custom rule${loc}: ${f} must be an array of strings.`);
    }
  }
  if (rule.check.kind === 'medication-present' && rule.check.medicationExclude != null &&
      (!Array.isArray(rule.check.medicationExclude) || rule.check.medicationExclude.some(t => typeof t !== 'string'))) {
    throw new Error(`Custom rule${loc}: check.medicationExclude must be an array of strings.`);
  }
}

// Validate a drug-combo rule: concurrent drug combinations with optional patient filters.
function validateDrugComboRule(rule, loc) {
  if (!Array.isArray(rule.drugSets) || rule.drugSets.length === 0) {
    throw new Error(`Custom rule${loc}: drugSets must be a non-empty array.`);
  }
  rule.drugSets.forEach((set, si) => {
    if (!set.name || typeof set.name !== 'string') {
      throw new Error(`Custom rule${loc} drugSets[${si}]: name is required.`);
    }
    if (!Array.isArray(set.match) || set.match.length === 0) {
      throw new Error(`Custom rule${loc} drugSets[${si}]: match must be a non-empty array.`);
    }
    if (set.exclude !== undefined && !Array.isArray(set.exclude)) {
      throw new Error(`Custom rule${loc} drugSets[${si}]: exclude must be an array.`);
    }
  });
  if (!ALLOWED_SEVERITIES.includes(rule.severity)) {
    throw new Error(`Custom rule${loc}: severity must be one of ${ALLOWED_SEVERITIES.join(', ')}.`);
  }
  if (rule.sex !== undefined && !ALLOWED_SEX_VALUES.includes(rule.sex)) {
    throw new Error(`Custom rule${loc}: sex must be one of ${ALLOWED_SEX_VALUES.join(', ')}.`);
  }
  if (rule.ageRange) {
    if (rule.ageRange.min != null && (typeof rule.ageRange.min !== 'number' || rule.ageRange.min < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.min must be a non-negative number.`);
    }
    if (rule.ageRange.max != null && (typeof rule.ageRange.max !== 'number' || rule.ageRange.max < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.max must be a non-negative number.`);
    }
  }
  if (rule.requiresProblem !== undefined && !Array.isArray(rule.requiresProblem)) {
    throw new Error(`Custom rule${loc}: requiresProblem must be an array.`);
  }
  if (rule.excludesProblem !== undefined && !Array.isArray(rule.excludesProblem)) {
    throw new Error(`Custom rule${loc}: excludesProblem must be an array.`);
  }
  if (rule.mustNotBePresent !== undefined && !Array.isArray(rule.mustNotBePresent)) {
    throw new Error(`Custom rule${loc}: mustNotBePresent must be an array of drug name strings.`);
  }
}

// Validate an event-count rule: count matching coded items within a time window.
function validateEventCountRule(rule, loc) {
  if (!ALLOWED_SOURCE_KINDS.includes(rule.sourceKind)) {
    throw new Error(`Custom rule${loc}: sourceKind must be one of ${ALLOWED_SOURCE_KINDS.join(', ')}.`);
  }
  if (!Array.isArray(rule.match) || rule.match.length === 0) {
    throw new Error(`Custom rule${loc}: match must be a non-empty array.`);
  }
  if (rule.exclude !== undefined && !Array.isArray(rule.exclude)) {
    throw new Error(`Custom rule${loc}: exclude must be an array.`);
  }
  if (typeof rule.windowMonths !== 'number' || rule.windowMonths <= 0) {
    throw new Error(`Custom rule${loc}: windowMonths must be a positive number.`);
  }
  if (typeof rule.countThreshold !== 'number' || rule.countThreshold < 0) {
    throw new Error(`Custom rule${loc}: countThreshold must be a non-negative number.`);
  }
  if (!ALLOWED_EVENT_COUNT_OPERATORS.includes(rule.operator)) {
    throw new Error(`Custom rule${loc}: operator must be one of ${ALLOWED_EVENT_COUNT_OPERATORS.join(', ')}.`);
  }
  if (!ALLOWED_SEVERITIES.includes(rule.severity)) {
    throw new Error(`Custom rule${loc}: severity must be one of ${ALLOWED_SEVERITIES.join(', ')}.`);
  }
  if (rule.sex !== undefined && !ALLOWED_SEX_VALUES.includes(rule.sex)) {
    throw new Error(`Custom rule${loc}: sex must be one of ${ALLOWED_SEX_VALUES.join(', ')}.`);
  }
  if (rule.ageRange) {
    if (rule.ageRange.min != null && (typeof rule.ageRange.min !== 'number' || rule.ageRange.min < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.min must be a non-negative number.`);
    }
    if (rule.ageRange.max != null && (typeof rule.ageRange.max !== 'number' || rule.ageRange.max < 0)) {
      throw new Error(`Custom rule${loc}: ageRange.max must be a non-negative number.`);
    }
  }
}

// Validate a composite rule: boolean AND/OR over other custom rule IDs.
// The validator does NOT resolve the referenced IDs — that is a runtime concern.
// Composite rules cannot reference other composite rules (enforced at runtime).
function validateCompositeRule(rule, loc) {
  if (!['AND','OR'].includes(rule.operator)) {
    throw new Error(`Custom rule${loc}: operator must be "AND" or "OR".`);
  }
  if (!Array.isArray(rule.ruleIds) || rule.ruleIds.length === 0) {
    throw new Error(`Custom rule${loc}: ruleIds must be a non-empty array.`);
  }
  rule.ruleIds.forEach((id, ri) => {
    if (typeof id !== 'string' || !id) {
      throw new Error(`Custom rule${loc} ruleIds[${ri}]: each id must be a non-empty string.`);
    }
  });
  if (!ALLOWED_SEVERITIES.includes(rule.severity)) {
    throw new Error(`Custom rule${loc}: severity must be one of ${ALLOWED_SEVERITIES.join(', ')}.`);
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
