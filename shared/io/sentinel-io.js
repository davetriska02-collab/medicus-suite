// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel IO helpers
// Exports and imports all Sentinel storage keys as a plain object.
// Used by suite-wide backup and by the Sentinel options page.

'use strict';

// Defence-in-depth: strip keys that could trigger prototype-pollution when
// merged via Object.assign. Mirrors engine/ruleset-io.js safeCopy — applied
// to the untrusted import operand only.
const _DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
function _stripDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (!_DANGEROUS_KEYS.includes(k)) out[k] = obj[k];
  });
  return out;
}

const SENTINEL_KEYS = [
  'sentinel.config',
  'sentinel.rules',
  'sentinel.orgRules',
  'sentinel.customRules',
  'sentinel.alertLibrary.acknowledged',
  'sentinel.hiddenRules',
  'sentinel.briefCollapsed',
  // NOTE: 'sentinel.extractionBaseline' is intentionally NOT in this list.
  // It stores ephemeral machine-local extraction telemetry (rolling per-view
  // counts, zero PII). Restoring it from a backup onto another machine or after
  // a Medicus UI change would corrupt the drift baseline and could mask or fake
  // drift detection. It is on the ALLOWLIST in test-backup-coverage.js with the
  // same rationale. See shared/extraction-health.js for the full schema.
];

// Export all Sentinel storage keys into a plain data object.
async function sentinelExport() {
  const r = await chrome.storage.local.get(SENTINEL_KEYS);
  return {
    config: r['sentinel.config'] ?? {},
    rules: r['sentinel.rules'] ?? {},
    orgRules: r['sentinel.orgRules'] ?? null,
    customRules: r['sentinel.customRules'] ?? [],
    alertLibraryAcknowledged: r['sentinel.alertLibrary.acknowledged'] ?? false,
    hiddenRules: r['sentinel.hiddenRules'] ?? {},
    briefCollapsed: r['sentinel.briefCollapsed'] ?? false,
  };
}

// Import a Sentinel data object back into storage.
// If merge=true, custom rules and individual overrides are merged rather than replaced.
// If skipInvalidCustomRules=true, invalid custom rules are collected and returned rather
// than throwing — valid rules still import. Default (strict) throws on the first invalid rule.
// Throws with a descriptive message if the data shape is invalid.
async function sentinelImport(data, { merge = false, skipInvalidCustomRules = false } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Sentinel data must be an object.');

  const toSet = {};
  // Rules rejected by validateCustomRule when skipInvalidCustomRules is on. Returned
  // so callers (suite restore) can SURFACE them — never drop a clinical rule silently.
  const rejectedCustomRules = [];

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
      // Strip dangerous keys from the untrusted import operand before merging.
      toSet['sentinel.rules'] = Object.assign({}, existing['sentinel.rules'] || {}, _stripDangerousKeys(data.rules));
    } else {
      // L1: non-merge path must also strip dangerous keys so __proto__/constructor/
      // prototype cannot be persisted and later trigger prototype-pollution when
      // the stored object is spread or Object.assign'd at runtime.
      toSet['sentinel.rules'] = _stripDangerousKeys(data.rules);
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
    let incoming;
    if (skipInvalidCustomRules) {
      // Resilient mode (suite restore): validate per-rule, keep the valid ones,
      // and record the rejects so the caller can surface them. A single legacy/
      // malformed rule must NOT abort the whole restore.
      incoming = [];
      data.customRules.forEach((rule, i) => {
        try {
          validateCustomRule(rule, i);
          incoming.push(rule);
        } catch (e) {
          rejectedCustomRules.push({
            id: (rule && rule.id) || null,
            label: (rule && rule.label) || null,
            error: e.message,
          });
        }
      });
    } else {
      // Strict mode (default): any invalid rule rejects the whole import.
      data.customRules.forEach((rule, i) => validateCustomRule(rule, i));
      incoming = data.customRules;
    }
    if (merge) {
      const existing = await chrome.storage.local.get('sentinel.customRules');
      const existingRules = existing['sentinel.customRules'] || [];
      const existingIds = new Set(existingRules.map((r) => r.id));
      const merged = [...existingRules];
      incoming.forEach((rule) => {
        if (!existingIds.has(rule.id)) merged.push(rule);
      });
      toSet['sentinel.customRules'] = merged;
    } else {
      toSet['sentinel.customRules'] = incoming;
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
      if (
        entry.until !== null &&
        entry.until !== undefined &&
        (typeof entry.until !== 'string' || !ISO_DATE_RE.test(entry.until))
      ) {
        throw new Error(`sentinel.hiddenRules["${ruleId}"].until: must be null or a YYYY-MM-DD date string.`);
      }
      if (
        entry.statusAtDismissal !== undefined &&
        entry.statusAtDismissal !== null &&
        typeof entry.statusAtDismissal !== 'string'
      ) {
        throw new Error(`sentinel.hiddenRules["${ruleId}"].statusAtDismissal: must be a string or null.`);
      }
      if (
        entry.dismissedAt !== undefined &&
        entry.dismissedAt !== null &&
        (typeof entry.dismissedAt !== 'string' || !ISO_DATE_RE.test(entry.dismissedAt))
      ) {
        throw new Error(`sentinel.hiddenRules["${ruleId}"].dismissedAt: must be null or a YYYY-MM-DD date string.`);
      }
    }
    toSet['sentinel.hiddenRules'] = data.hiddenRules;
  }

  if (data.briefCollapsed !== undefined) {
    if (typeof data.briefCollapsed !== 'boolean') {
      throw new Error('sentinel.briefCollapsed must be a boolean.');
    }
    toSet['sentinel.briefCollapsed'] = data.briefCollapsed;
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  return { rejectedCustomRules };
}

// Validate a custom rule object. Throws on failure.
// Exposed so the rule builder form can call it before save.
function validateCustomRule(rule, index) {
  const loc = index !== undefined ? ` (index ${index})` : '';
  if (!rule || typeof rule !== 'object') throw new Error(`Custom rule${loc} is not an object.`);
  if (!rule.id || typeof rule.id !== 'string') throw new Error(`Custom rule${loc}: id is required.`);
  if (!/^custom-[a-z0-9-]{1,60}$/.test(rule.id)) throw new Error(`Custom rule${loc}: id must match /^custom-[a-z0-9-]{1,60}$/.`);

  if (rule.type === 'drug-monitoring') return validateDrugMonitoringRule(rule, loc);
  if (rule.type === 'qof-indicator') return validateQofIndicatorRule(rule, loc);
  if (rule.type === 'drug-combo') return validateDrugComboRule(rule, loc);
  if (rule.type === 'event-count') return validateEventCountRule(rule, loc);
  if (rule.type === 'composite') return validateCompositeRule(rule, loc);
  throw new Error(
    `Custom rule${loc}: type must be one of "drug-monitoring", "qof-indicator", "drug-combo", "event-count", "composite".`
  );
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
    if (t.snomed !== undefined && (!Array.isArray(t.snomed) || t.snomed.some((s) => typeof s !== 'string'))) {
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
    if (rule[f] != null && (!Array.isArray(rule[f]) || rule[f].some((t) => typeof t !== 'string'))) {
      throw new Error(`Custom rule${loc}: ${f} must be an array of strings.`);
    }
  }
}

const ALLOWED_QOF_REGISTERS = ['DM', 'HYP', 'CHD', 'HF', 'STIA', 'CKD', 'PAD', 'ASTHMA', 'COPD', 'AF'];
// Keep in sync with IMPLEMENTED_KINDS in test-rule-schema.js and check.kind === guards in engine/rules-engine.js.
const ALLOWED_CHECK_KINDS = [
  'observation-threshold',
  'medication-present',
  'observation-recent',
  'observation-trend',
  'observation-alert',
  'observation-bundle',
];
const ALLOWED_SEVERITIES = ['red', 'amber', 'info'];
const ALLOWED_SEX_VALUES = ['any', 'M', 'F'];
const ALLOWED_EVENT_COUNT_OPERATORS = ['>=', '>', '=', '<=', '<'];
const ALLOWED_SOURCE_KINDS = ['problems', 'observations'];

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
      throw new Error(
        `Custom rule${loc}: provide either (threshold + operator) or (thresholdSystolic + thresholdDiastolic).`
      );
    }
    if (hasSingle && !['<=', '<', '>=', '>', '='].includes(rule.check.operator)) {
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
    if (!['rising', 'falling'].includes(rule.check.direction)) {
      throw new Error(`Custom rule${loc}: check.direction must be "rising" or "falling".`);
    }
    if (rule.check.minPoints != null && (typeof rule.check.minPoints !== 'number' || rule.check.minPoints < 2)) {
      throw new Error(`Custom rule${loc}: check.minPoints must be a number >= 2.`);
    }
    if (
      rule.check.withinMonths != null &&
      (typeof rule.check.withinMonths !== 'number' || rule.check.withinMonths <= 0)
    ) {
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
    if (rule.check.comparator !== undefined && !['above', 'below'].includes(rule.check.comparator)) {
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
  if (
    rule.requiresRegister != null &&
    rule.requiresRegister !== '' &&
    !ALLOWED_QOF_REGISTERS.includes(rule.requiresRegister)
  ) {
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
    if (rule[f] != null && (!Array.isArray(rule[f]) || rule[f].some((t) => typeof t !== 'string'))) {
      throw new Error(`Custom rule${loc}: ${f} must be an array of strings.`);
    }
  }
  if (
    rule.check.kind === 'medication-present' &&
    rule.check.medicationExclude != null &&
    (!Array.isArray(rule.check.medicationExclude) || rule.check.medicationExclude.some((t) => typeof t !== 'string'))
  ) {
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
  if (!['AND', 'OR'].includes(rule.operator)) {
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

// ---------------------------------------------------------------------------
// customRuleSchemaPrompt() → string
// Returns a self-contained LLM instruction string for authoring a single
// Medicus Suite Sentinel custom monitoring rule. Embed the returned string in
// an LLM chat, then paste the JSON response into the "Author rule with LLM"
// import box in the Sentinel custom-rules options page.
//
// The embedded EXAMPLE JSON blocks are delimited by the stable markers
//   --- EXAMPLE JSON ---
//   --- END EXAMPLE ---
// so that tests can slice them out and feed through validateCustomRule().
// ---------------------------------------------------------------------------
function customRuleSchemaPrompt() {
  return `You are generating a single Medicus Suite Sentinel custom monitoring rule for a UK GP practice. Output ONLY a JSON object — no prose, no markdown fences, no code blocks. The object must conform exactly to the schema below.

=== CLINICAL SAFETY INSTRUCTIONS ===

1. Matching is CASE-INSENSITIVE SUBSTRING: "methotrexate" matches "Methotrexate 10mg tablets".
   A short generic term auto-covers qualified forms — "lithium" matches "lithium carbonate" and "lithium citrate".
2. Every DISTINCT BRAND NAME must be listed explicitly in drug.match or it will NEVER match — silently, with no error.
   Check the current BNF / dm+d for the complete UK brand set and enumerate every brand.
3. drug.exclude strings are equally silent and sharp — they drop every medication whose name contains the term.
   Use exclude ONLY to suppress genuine false positives. Ask: "Could a patient who NEEDS this monitoring match this string?"
4. Imported rules arrive DISABLED (enabled:false is forced on import). A clinician must review and enable each rule
   before it fires. Always cite your source in the notes and source fields so the reviewer can verify currency.
5. Be conservative: missing a monitoring alert is a patient-safety risk. When in doubt, include more match terms.

=== COMMON FIELDS (all rule types) ===

  type        (string, required)
              One of: "drug-monitoring" | "qof-indicator" | "drug-combo" | "event-count" | "composite"

  id          (string, required)
              MUST start with "custom-". Use a slug, e.g. "custom-ciclosporin-fbc-lft-bp".
              The importer will prefix "custom-" if absent and de-duplicate if already in use.

  enabled     (boolean, required)
              Always set false in your output — the importer forces this regardless, but be explicit.

  label       (string, optional)
              Human-readable name shown in the rule list (e.g. "Ciclosporin monitoring").

  notes       (string, optional)
              Shown on the alert chip hover. Include a brief clinical rationale.

  source      (string, optional)
              URL or citation: BNF monitoring requirements, BSR/NHSE shared-care protocol, MHRA DSU, NICE guideline.
              Always include this — it is the reviewer's only audit trail.

  sex         (string, optional)
              "M" | "F" | "any". Omit for any sex.

  ageRange    (object, optional)
              { min: number, max: number } — either or both can be present. Ages in whole years.

  requiresProblem  (array of strings, optional)  — ALL listed problem terms must be present (substring match).
  excludesProblem  (array of strings, optional)  — ANY matching problem disqualifies the patient.

=== TYPE: drug-monitoring ===

  drug        (object, required)
    .match    (array of strings, required, non-empty)
              Case-insensitive substring list. Include: generic name, all current UK brand names (BNF/dm+d).
    .exclude  (array of strings, optional)
              Drop meds whose name contains any of these strings. Use with caution (see safety note 3).

  tests       (array, required, non-empty)
              Each test:
    .name           (string, required)  — Human label, e.g. "FBC".
    .match          (array of strings, required, non-empty)
                    Case-insensitive substring against observation names, e.g. ["fbc","full blood count"].
    .intervalDays   (number, required)  — Positive integer ≤ 3650. Standard monitoring intervals:
                    every 12 weeks = 84 days; every 3 months = 90 days; every 6 months = 182 days;
                    annually = 365 days.
    .dueSoonDays    (number, optional)  — Days before due date to show "due soon". Default: 28 days
                    for intervals ≥ 12 weeks; otherwise interval/6 capped at 30.
    .snomed         (array of strings, optional)  — SNOMED CT codes matched in addition to text terms.

  drugClass   (string, optional)   — e.g. "DMARD", "biologic", "immunosuppressant".
  sharedCare  (boolean, optional)  — true if this is a shared-care drug.

=== TYPE: qof-indicator ===

  indicatorCode   (string, required)  — Short code, e.g. "LOCAL-MTX-LFT".
  indicatorName   (string, required)  — Display name, e.g. "MTX LFT within 3 months".

  check           (object, required)
    .kind         (string, required)  — One of:
                  "observation-threshold" | "medication-present" | "observation-recent" |
                  "observation-trend" | "observation-alert" | "observation-bundle"

  For kind "observation-threshold":
    .observation  (array of strings, required, non-empty)  — observation match terms.
    .threshold    (number) + .operator ("<="|"<"|">="|">"|"=")  — single value comparison.
    OR
    .thresholdSystolic + .thresholdDiastolic  (numbers)  — blood pressure dual threshold.
    .withinDays   (number, optional)  — observation window. Default: 365 (QOF year).

  For kind "observation-recent":
    .observation  (array of strings, required, non-empty)
    .withinDays   (number, required, > 0)

  For kind "medication-present":
    .medicationMatch  (array of strings, required, non-empty)
    .medicationExclude (array of strings, optional)

  For kind "observation-trend":
    .observation  (array of strings, required, non-empty)
    .direction    ("rising"|"falling", required)
    .minPoints    (number, optional, ≥ 2, default 3)
    .withinMonths (number, optional, > 0)
    .minDelta     (number, optional, ≥ 0)

  For kind "observation-alert":
    .observation  (array of strings, required, non-empty)
    .comparator   ("above"|"below", optional, default "above")
    .amber        (number, optional)  — at least one of amber/red required.
    .red          (number, optional)
    .withinDays   (number, optional)
    .unit         (string, optional)

  For kind "observation-bundle":
    .observations (array, required, non-empty)  — array of observation term arrays.

  requiresRegister (string, optional)
              One of: "DM"|"HYP"|"CHD"|"HF"|"STIA"|"CKD"|"PAD"|"ASTHMA"|"COPD"|"AF"
  points       (number, optional, ≥ 0)
  useQofYearFloor (boolean, optional)
  requiresProblem / requiresAnyProblem / excludeIfProblem  (arrays of strings, optional)

=== SUMMARY OF OTHER TYPES ===

  "drug-combo":    drugSets (array of {name, match[], exclude[]}), severity ("red"|"amber"|"info").
                   Fires when patient is on at least one drug from EVERY set concurrently.

  "event-count":   sourceKind ("problems"|"observations"), match[], windowMonths, countThreshold,
                   operator (">="|">"|"="|"<="|"<"), severity. Fires when count operator threshold
                   within the rolling window.

  "composite":     operator ("AND"|"OR"), ruleIds (array of existing custom rule ids), severity.
                   Combines other custom rules with boolean logic.

=== EXAMPLES ===

--- EXAMPLE JSON ---
{
  "type": "drug-monitoring",
  "id": "custom-ciclosporin-monitoring",
  "enabled": false,
  "label": "Ciclosporin monitoring",
  "drugClass": "immunosuppressant",
  "sharedCare": true,
  "drug": {
    "match": ["ciclosporin", "cyclosporin", "neoral", "sandimmun", "capimune", "capsorin", "deximune"]
  },
  "tests": [
    {
      "name": "FBC",
      "match": ["fbc", "full blood count", "full blood picture"],
      "intervalDays": 84,
      "dueSoonDays": 28
    },
    {
      "name": "U&E / Creatinine",
      "match": ["urea", "creatinine", "u&e", "urea and electrolytes", "renal function", "renal profile"],
      "intervalDays": 84,
      "dueSoonDays": 28
    },
    {
      "name": "LFT",
      "match": ["lft", "liver function", "alanine aminotransferase", "alt", "bilirubin"],
      "intervalDays": 84,
      "dueSoonDays": 28
    }
  ],
  "notes": "BSR/NHSE shared-care: FBC, U&E, LFT every 12 weeks once stable. Monitor BP and lipids annually.",
  "source": "https://www.rheumatology.org.uk/guidelines/shared-care"
}
--- END EXAMPLE ---

--- EXAMPLE JSON ---
{
  "type": "qof-indicator",
  "id": "custom-dm-egfr-annual",
  "enabled": false,
  "label": "DM — eGFR within 12 months",
  "indicatorCode": "LOCAL-DM-EGFR",
  "indicatorName": "eGFR/CKD review in diabetes within 12 months",
  "requiresRegister": "DM",
  "check": {
    "kind": "observation-recent",
    "observation": ["egfr", "estimated glomerular filtration rate", "creatinine"],
    "withinDays": 365
  },
  "useQofYearFloor": false,
  "points": 0,
  "notes": "NICE NG28 recommends annual renal function monitoring in all patients with type 1 or 2 diabetes.",
  "source": "https://www.nice.org.uk/guidance/ng28"
}
--- END EXAMPLE ---

=== CLOSING REMINDER ===

The rule you output will be imported DISABLED. A GP or nominated clinical reviewer MUST inspect the
match terms, thresholds, and behaviour before enabling the rule. A monitoring rule that silently fails
to fire is a patient-safety risk — err on the side of including more match terms and citing your sources.
`;
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
  module.exports = {
    sentinelExport,
    sentinelImport,
    validateCustomRule,
    generateCustomRuleId,
    defaultDueSoonDays,
    customRuleSchemaPrompt,
  };
}
