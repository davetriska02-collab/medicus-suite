// Sentinel — Ruleset Import / Export
//
// Supports two-tier rule overrides:
//   1. Organisational ruleset (sentinelOrgRules): practice/PCN-level policy.
//      Shared between clinicians via export/import. Examples: tighter MTX
//      monitoring intervals, locally enabled/disabled QOF indicators.
//   2. Individual overrides (sentinelRules): per-clinician personal tweaks.
//      Sit ON TOP OF the organisational layer.
//
// Merge order at runtime: default rule -> organisational override -> individual override
//
// Export format is a self-describing JSON document. The same format is used
// for organisational and individual rulesets; the `scope` field distinguishes.

(function(global) {
  'use strict';

  const FORMAT = 'sentinel-ruleset';
  const FORMAT_VERSION = 1;
  const SUPPORTED_RULE_SCHEMA = 2;

  // ---- Build an export document ----
  function buildExport(opts) {
    opts = opts || {};
    const doc = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      scope: opts.scope || 'individual',
      label: opts.label || 'Sentinel ruleset',
      notes: opts.notes || '',
      createdAt: new Date().toISOString(),
      createdBy: opts.createdBy || '',
      ruleSchemaVersion: SUPPORTED_RULE_SCHEMA,
      qofSpecVersion: opts.qofSpecVersion || 'QOF 2025/26',
      drugRuleOverrides: opts.drugRuleOverrides || {},
      qofRuleOverrides: opts.qofRuleOverrides || {},
      displayConfig: opts.scope === 'organisation' ? null : (opts.displayConfig || null)
    };
    return doc;
  }

  // ---- Validate an imported document ----
  // Returns { valid: bool, errors: [strings], warnings: [strings] }
  function validateImport(doc) {
    const errors = [];
    const warnings = [];
    if (!doc || typeof doc !== 'object') {
      errors.push('Document is not an object.');
      return { valid: false, errors, warnings };
    }
    if (doc.format !== FORMAT) {
      errors.push(`Unrecognised format. Expected "${FORMAT}", got "${doc.format}".`);
    }
    if (typeof doc.formatVersion !== 'number') {
      errors.push('Missing or invalid formatVersion.');
    } else if (doc.formatVersion > FORMAT_VERSION) {
      warnings.push(`This file was created with a newer version of Sentinel (formatVersion ${doc.formatVersion} > ${FORMAT_VERSION}). Some fields may be ignored.`);
    }
    if (doc.ruleSchemaVersion && doc.ruleSchemaVersion !== SUPPORTED_RULE_SCHEMA) {
      warnings.push(`Rule schema mismatch (file: v${doc.ruleSchemaVersion}, this Sentinel: v${SUPPORTED_RULE_SCHEMA}). Rules may not behave as expected.`);
    }
    if (!['individual', 'organisation'].includes(doc.scope)) {
      warnings.push(`Unknown scope "${doc.scope}". Treating as individual.`);
    }
    // Validate override shapes — must be plain objects keyed by rule id
    ['drugRuleOverrides', 'qofRuleOverrides'].forEach(key => {
      if (doc[key] == null) return;
      if (typeof doc[key] !== 'object' || Array.isArray(doc[key])) {
        errors.push(`${key} must be an object keyed by rule id.`);
        return;
      }
      Object.entries(doc[key]).forEach(([ruleId, override]) => {
        if (typeof ruleId !== 'string' || !ruleId) {
          errors.push(`${key}: invalid rule id`);
        }
        if (override === null || typeof override !== 'object') {
          errors.push(`${key}.${ruleId}: override must be an object`);
          return;
        }
        // Field whitelist - reject unknown fields with warning
        const allowed = ['enabled', 'tests', 'thresholds', 'check', 'ageRange', 'excludeIfProblem',
                         'problemMatch', 'problemExclude', 'intervalDays', 'dueSoonDays', 'notes'];
        Object.keys(override).forEach(field => {
          if (!allowed.includes(field)) {
            warnings.push(`${key}.${ruleId}.${field}: unknown override field, will be applied as-is.`);
          }
        });
        // Validate tests array if present
        if (override.tests != null) {
          if (!Array.isArray(override.tests)) {
            errors.push(`${key}.${ruleId}.tests: must be an array`);
          } else {
            override.tests.forEach((t, i) => {
              if (!t || typeof t !== 'object') {
                errors.push(`${key}.${ruleId}.tests[${i}]: not an object`);
              } else {
                if (t.intervalDays != null && (typeof t.intervalDays !== 'number' || t.intervalDays <= 0 || t.intervalDays > 3650)) {
                  errors.push(`${key}.${ruleId}.tests[${i}].intervalDays: must be a positive number <= 3650 (10 years)`);
                }
                if (t.dueSoonDays != null && (typeof t.dueSoonDays !== 'number' || t.dueSoonDays < 0)) {
                  errors.push(`${key}.${ruleId}.tests[${i}].dueSoonDays: must be a non-negative number`);
                }
              }
            });
          }
        }
      });
    });
    // displayConfig validation (basic)
    if (doc.displayConfig != null && (typeof doc.displayConfig !== 'object' || Array.isArray(doc.displayConfig))) {
      errors.push('displayConfig must be an object or null');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // ---- Count what's in an import ----
  function summariseImport(doc) {
    const drugCount = doc.drugRuleOverrides ? Object.keys(doc.drugRuleOverrides).length : 0;
    const qofCount = doc.qofRuleOverrides ? Object.keys(doc.qofRuleOverrides).length : 0;
    const displayCount = doc.displayConfig ? Object.keys(doc.displayConfig).length : 0;
    return {
      scope: doc.scope,
      label: doc.label,
      notes: doc.notes,
      createdAt: doc.createdAt,
      createdBy: doc.createdBy,
      drugRuleOverrideCount: drugCount,
      qofRuleOverrideCount: qofCount,
      displayConfigCount: displayCount
    };
  }

  // ---- Merge logic ----
  // Given canonical rules from JSON files, apply org and individual overrides in order.
  // Returns merged rules array. Also annotates each rule with _orgOverridden / _personalOverridden flags
  // for UI display.
  function mergeRules(canonicalRules, orgOverrides, individualOverrides) {
    const orgMap = (orgOverrides && orgOverrides.drugRuleOverrides) || {};
    const orgQofMap = (orgOverrides && orgOverrides.qofRuleOverrides) || {};
    const indMap = individualOverrides || {};
    return canonicalRules.map(rule => {
      const fromOrg = orgMap[rule.id] || orgQofMap[rule.id] || null;
      const fromInd = indMap[rule.id] || null;
      if (!fromOrg && !fromInd) return rule;
      // Apply in order: canonical -> org -> individual
      const merged = { ...rule };
      if (fromOrg) {
        Object.assign(merged, fromOrg);
        merged._orgOverridden = true;
      }
      if (fromInd) {
        Object.assign(merged, fromInd);
        merged._personalOverridden = true;
      }
      return merged;
    });
  }

  // ---- Suggest a filename ----
  function suggestFilename(scope, label) {
    const slug = String(label || 'sentinel-ruleset')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const stamp = new Date().toISOString().slice(0, 10);
    const ext = scope === 'organisation' ? '.sentinel-org.json' : '.sentinel-config.json';
    return `${slug || 'sentinel-ruleset'}-${stamp}${ext}`;
  }

  const api = {
    FORMAT,
    FORMAT_VERSION,
    SUPPORTED_RULE_SCHEMA,
    buildExport,
    validateImport,
    summariseImport,
    mergeRules,
    suggestFilename
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelRulesetIo = api;
  }
})(typeof window !== 'undefined' ? window : global);
