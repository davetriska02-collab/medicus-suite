// engine/result-rules.js — Analyte-threshold rule schema, validation, and LLM prompt
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Provides:
//   validateResultRule(rule)      → string[]  (empty = valid)
//   resultRuleSchemaPrompt()      → string    (LLM instruction for authoring one rule)
//   RESULT_RULE_FIELDS            → string[]  (field list for UI)
//
// Result rules let clinicians author analyte-threshold escalations on top of the
// lab's own flags. They NEVER lower severity — a lab-urgent result stays urgent
// regardless of what a user rule says. Rules arrive imported as disabled and must
// be reviewed by a clinician before they fire.
//
// Rule object shape:
//   {
//     id          : string          — set by importer; placeholder ok in authored JSON
//     enabled     : boolean         — importer forces false; clinician enables after review
//     builtin     : boolean         — always false for user-authored rules
//     label       : string          — required, ≤ ~60 chars
//     analyte     : {
//       match     : string[]        — required, ≥ 1 non-empty string; case-insensitive
//                                    substring matched against result.name
//     }
//     comparator  : 'above'|'below' — required
//     amber       : number|null     — threshold for amber (abnormal); null = not set
//     red         : number|null     — threshold for red (urgent); null = not set
//     unit        : string          — optional, for display only
//   }
//
// Ordering contract:
//   comparator 'above':  both present → red >= amber  (red is a higher value)
//   comparator 'below':  both present → red <= amber  (red is a lower value)

(function (global) {
  'use strict';

  // ── Public field list (useful for option UIs) ────────────────────────────────
  const RESULT_RULE_FIELDS = ['label', 'analyte', 'comparator', 'amber', 'red', 'unit'];

  // ── validateResultRule ────────────────────────────────────────────────────────

  /**
   * validateResultRule(rule) → string[]
   *
   * Returns an array of human-readable error strings.
   * An empty array means the rule is valid.
   *
   * @param {*} rule
   * @returns {string[]}
   */
  function validateResultRule(rule) {
    const errs = [];
    if (!rule || typeof rule !== 'object') {
      errs.push('Rule must be an object.');
      return errs;
    }

    // label — required non-empty string
    if (!rule.label || typeof rule.label !== 'string' || !rule.label.trim()) {
      errs.push('label is required and must be a non-empty string.');
    } else if (rule.label.trim().length > 60) {
      errs.push('label should be 60 characters or fewer (got ' + rule.label.trim().length + ').');
    }

    // analyte.match — required non-empty array of non-empty strings
    const analyte = rule.analyte;
    if (!analyte || typeof analyte !== 'object') {
      errs.push('analyte must be an object with a match array.');
    } else {
      const match = analyte.match;
      if (!Array.isArray(match)) {
        errs.push('analyte.match must be an array of strings.');
      } else {
        const nonEmpty = match.filter(m => typeof m === 'string' && m.trim().length > 0);
        if (nonEmpty.length === 0) {
          errs.push('analyte.match must contain at least one non-empty string.');
        }
      }
    }

    // comparator — required, one of 'above' | 'below'
    if (rule.comparator !== 'above' && rule.comparator !== 'below') {
      errs.push("comparator must be 'above' or 'below'.");
    }

    // amber and red — each must be a finite number or null; at least one must be set
    const hasAmber = rule.amber !== null && rule.amber !== undefined && Number.isFinite(rule.amber);
    const hasRed = rule.red !== null && rule.red !== undefined && Number.isFinite(rule.red);

    if (rule.amber !== null && rule.amber !== undefined && !Number.isFinite(rule.amber)) {
      errs.push('amber must be a finite number or null.');
    }
    if (rule.red !== null && rule.red !== undefined && !Number.isFinite(rule.red)) {
      errs.push('red must be a finite number or null.');
    }
    if (!hasAmber && !hasRed) {
      errs.push('At least one of amber or red must be a finite number.');
    }

    // Ordering sanity — only checked when comparator is valid and both thresholds present
    if ((rule.comparator === 'above' || rule.comparator === 'below') && hasAmber && hasRed) {
      if (rule.comparator === 'above' && rule.red < rule.amber) {
        errs.push(
          "For comparator 'above', red threshold must be >= amber threshold " +
            '(red fires at a higher value than amber).'
        );
      }
      if (rule.comparator === 'below' && rule.red > rule.amber) {
        errs.push(
          "For comparator 'below', red threshold must be <= amber threshold " +
            '(red fires at a lower value than amber).'
        );
      }
    }

    // unit — optional; if present must be a string
    if (rule.unit !== undefined && rule.unit !== null && typeof rule.unit !== 'string') {
      errs.push('unit must be a string or omitted.');
    }

    // id, enabled, builtin — ignored/allowed; no validation

    return errs;
  }

  // ── resultRuleSchemaPrompt ────────────────────────────────────────────────────

  /**
   * resultRuleSchemaPrompt() → string
   *
   * Returns a self-contained LLM instruction string for authoring a single
   * analyte-threshold result rule. Embed in an LLM chat; paste the JSON back
   * into the Investigation Results rule importer.
   */
  function resultRuleSchemaPrompt() {
    return `You are generating a single Investigation Results analyte-threshold rule for a UK GP practice using Medicus Suite. Output ONLY a JSON object — no prose, no markdown fences, no code blocks. The object must conform exactly to the schema below.

=== CLINICAL SAFETY INSTRUCTIONS ===

1. Analyte matching is CASE-INSENSITIVE SUBSTRING — "potassium" matches "Serum Potassium (EDTA)" and "Potassium". List the most specific substring that uniquely identifies the analyte to avoid false matches.
2. Thresholds ESCALATE severity only — they raise a chip from none→amber or none/amber→red. They NEVER lower a lab-flagged result. If the laboratory has already flagged a result as urgent, it remains urgent regardless of what the rule says.
3. Imported rules arrive DISABLED (enabled:false is forced on import). A clinician MUST review the analyte match strings and threshold values before enabling the rule. Incorrect thresholds are a patient-safety risk.
4. Use current UK reference ranges and NICE/BNF guidance when choosing threshold values. When in doubt, use a more conservative (wider) threshold rather than a narrower one.
5. The 'unit' field is for display only — the engine does not perform unit conversion. Ensure the threshold values are in the same units as reported by your laboratory system.

=== SCHEMA ===

  id          (string)
              Will be replaced on import with a fresh unique id of the form "rule_" + random.
              You may set any placeholder — the importer ignores it.

  enabled     (boolean)
              Set false. The importer forces this regardless — the rule arrives disabled
              and requires clinician review before it can fire.

  builtin     (boolean)
              Always false for user-authored rules.

  label       (string, required)
              Short label shown on the chip, max ~60 characters.
              e.g. "High potassium", "Low sodium — critical".

  analyte     (object, required)
    match     (array of strings, required, non-empty)
              Case-insensitive substrings matched against the result name as it
              appears in the investigation report. At least one string required.
              e.g. ["potassium"] or ["eGFR", "GFR (CKD-EPI)"]

  comparator  (string, required)
              "above" — rule fires when the result value is above the threshold(s).
              "below" — rule fires when the result value is below the threshold(s).

  amber       (number or null, required)
              Threshold value that escalates severity to amber (abnormal).
              For comparator "above": amber fires if value >= amber threshold.
              For comparator "below": amber fires if value <= amber threshold.
              Set null if you only want a red threshold.

  red         (number or null, required)
              Threshold value that escalates severity to red (urgent).
              For comparator "above": red fires if value >= red threshold.
              For comparator "below": red fires if value <= red threshold.
              Set null if you only want an amber threshold.

              Ordering constraint:
                comparator "above" → red must be >= amber (red fires at a higher value).
                comparator "below" → red must be <= amber (red fires at a lower value).

  unit        (string, optional)
              Display unit for the chip tooltip, e.g. "mmol/L". Not used for matching
              or unit conversion — purely informational.

=== EXAMPLE JSON ===

--- EXAMPLE JSON ---
{
  "id": "rule_placeholder",
  "enabled": false,
  "builtin": false,
  "label": "High potassium",
  "analyte": {
    "match": ["potassium"]
  },
  "comparator": "above",
  "amber": 5.5,
  "red": 6.0,
  "unit": "mmol/L"
}
--- END EXAMPLE ---

This example escalates a potassium result to amber if >= 5.5 mmol/L and to red if >= 6.0 mmol/L, regardless of whether the laboratory has flagged it. A laboratory-flagged urgent result (e.g. potassium 6.5 flagged urgent by the lab) is NOT affected — it stays urgent. A laboratory-normal result of 5.6 mmol/L would be escalated to amber by this rule.

=== CLOSING REMINDER ===

The rule will be imported DISABLED. A GP or nominated reviewer MUST check the analyte match strings, comparator, and threshold values before enabling the rule. A rule with an incorrect threshold is a direct patient-safety risk — an overly sensitive threshold creates alert fatigue; a threshold set in the wrong direction silently fails to fire. Review the rule in the Investigation Results settings tab before enabling. Output ONLY valid JSON.
`;
  }

  // ── Module export (dual-mode: Node require OR browser global) ────────────────
  const api = { validateResultRule, resultRuleSchemaPrompt, RESULT_RULE_FIELDS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelResultRules = api;
  }
})(typeof window !== 'undefined' ? window : global);
