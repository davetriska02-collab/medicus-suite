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
// Rule object shape — TWO KINDS:
//
// kind:'threshold' (or kind absent — treated as threshold):
//   {
//     id          : string          — set by importer; placeholder ok in authored JSON
//     enabled     : boolean         — importer forces false; clinician enables after review
//     builtin     : boolean         — always false for user-authored rules
//     kind        : 'threshold'     — optional; absence also means threshold
//     label       : string          — required, ≤ ~60 chars
//     analyte     : {
//       match     : string[]        — required, ≥ 1 non-empty string; case-insensitive
//                                    substring matched against result.name
//       exclude   : string[]        — OPTIONAL; case-insensitive substrings. A result
//                                    whose name contains any exclude string is skipped
//                                    even if it matched (drops shared-token false
//                                    positives, e.g. "platelet" rule vs "Mean platelet
//                                    volume", "haemoglobin" rule vs "Haemoglobin A1c",
//                                    serum-electrolyte rule vs a "Urine ..." analyte).
//     }
//     comparator  : 'above'|'below' — required
//     amber       : number|null     — threshold for amber (abnormal); null = not set
//     red         : number|null     — threshold for red (urgent); null = not set
//     unit        : string          — optional, for display only
//   }
//
// Ordering contract (threshold):
//   comparator 'above':  both present → red >= amber  (red is a higher value)
//   comparator 'below':  both present → red <= amber  (red is a lower value)
//
// kind:'text':
//   {
//     id          : string          — set by importer
//     enabled     : boolean         — importer forces false; clinician enables after review
//     builtin     : boolean         — always false for user-authored rules
//     kind        : 'text'          — required to use this path
//     label       : string          — required, ≤ ~60 chars; shown on chip when outcome is 'review'
//     analyte     : {
//       match     : string[]        — required, ≥ 1 non-empty string; matched against result.name
//       exclude   : string[]        — OPTIONAL; same skip-on-substring semantics as above
//     }
//     normalText  : string[]        — required, ≥ 1 non-empty string; if any phrase is found
//                                    (case-insensitive) in result.text → outcome 'noGrowth'
//     normalLabel : string          — optional; label shown on chip when outcome is 'noGrowth'
//                                    (default "No growth")
//   }
//
// Text rules are ESCALATE-ONLY: a result whose text contains a normal phrase gets a
// calm 'noGrowth' info outcome (does not raise level). A result whose text does NOT
// contain any normal phrase gets 'review' which escalates the row to amber.

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

    // Determine kind — absent or 'threshold' → numeric; 'text' → text classification
    const kind = rule.kind !== undefined ? rule.kind : 'threshold';

    if (kind !== 'threshold' && kind !== 'text') {
      errs.push(
        "rule.kind must be 'threshold' or 'text' (or omitted, which defaults to 'threshold')."
      );
      return errs; // unknown kind — no further field checks make sense
    }

    // label — required non-empty string (both kinds)
    if (!rule.label || typeof rule.label !== 'string' || !rule.label.trim()) {
      errs.push('label is required and must be a non-empty string.');
    } else if (rule.label.trim().length > 60) {
      errs.push('label should be 60 characters or fewer (got ' + rule.label.trim().length + ').');
    }

    // analyte.match — required non-empty array of non-empty strings (both kinds)
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
      // analyte.exclude — OPTIONAL. If present, must be an array of strings.
      // Drops false-positive analytes that share a match token (see header).
      if (analyte.exclude !== undefined) {
        if (!Array.isArray(analyte.exclude)) {
          errs.push('analyte.exclude, if present, must be an array of strings.');
        } else if (analyte.exclude.some(e => typeof e !== 'string')) {
          errs.push('analyte.exclude must contain only strings.');
        }
      }
    }

    if (kind === 'text') {
      // normalText — required non-empty array of non-empty strings
      if (!Array.isArray(rule.normalText)) {
        errs.push('normalText must be an array of strings for kind "text" rules.');
      } else {
        const nonEmpty = rule.normalText.filter(
          s => typeof s === 'string' && s.trim().length > 0
        );
        if (nonEmpty.length === 0) {
          errs.push('normalText must contain at least one non-empty string.');
        }
      }

      // normalLabel — optional string
      if (
        rule.normalLabel !== undefined &&
        rule.normalLabel !== null &&
        typeof rule.normalLabel !== 'string'
      ) {
        errs.push('normalLabel must be a string or omitted.');
      }
    } else {
      // threshold kind: comparator, amber, red, unit

      // comparator — required, one of 'above' | 'below'
      if (rule.comparator !== 'above' && rule.comparator !== 'below') {
        errs.push("comparator must be 'above' or 'below'.");
      }

      // amber and red — each must be a finite number or null; at least one must be set
      const hasAmber =
        rule.amber !== null && rule.amber !== undefined && Number.isFinite(rule.amber);
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
    return `You are generating a single Investigation Results rule for a UK GP practice using Medicus Suite. Output ONLY a JSON object — no prose, no markdown fences, no code blocks. The object must conform exactly to the schema below.

There are TWO rule kinds. Choose the correct kind for the analyte you are targeting:

  kind:"threshold"  — numeric analyte (e.g. potassium, eGFR, haemoglobin). Fires when
                      the numeric result value is above or below a threshold. Omitting
                      kind is also treated as "threshold".

  kind:"text"       — free-text / microbiology result (e.g. MSU, urine culture, blood
                      culture, HVS). These results have no numeric high/low flag, so the
                      engine searches the result text for normal phrases (e.g. "no growth").
                      If a normal phrase is found → calm "No growth" info chip (does NOT
                      raise severity). If no normal phrase is found → "Needs review" amber
                      chip. Use this kind for all microbiology and culture results.

=== CLINICAL SAFETY INSTRUCTIONS ===

1. Analyte matching is CASE-INSENSITIVE SUBSTRING — "potassium" matches "Serum Potassium (EDTA)" and "Potassium". List the most specific substring that uniquely identifies the analyte to avoid false matches.
2. Rules ESCALATE severity only — they raise a chip from none→amber or none/amber→red (threshold) or flag a result for review (text). They NEVER lower a lab-flagged result. If the laboratory has already flagged a result as urgent, it remains urgent regardless of what the rule says.
3. Imported rules arrive DISABLED (enabled:false is forced on import). A clinician MUST review the analyte match strings and threshold/text values before enabling the rule. Incorrect rules are a patient-safety risk.
4. For threshold rules: use current UK reference ranges and NICE/BNF guidance when choosing threshold values. When in doubt, use a more conservative (wider) threshold rather than a narrower one.
5. The 'unit' field is for display only — the engine does not perform unit conversion. Ensure the threshold values are in the same units as reported by your laboratory system.
6. For text rules: normalText phrases are matched case-insensitively anywhere in the result text (rawValue, interpretation, performer comments). Only include phrases that unambiguously indicate a negative / no-growth result. A phrase that is too short or too generic risks false-negative classification (a positive culture classed as "no growth").

=== SCHEMA — kind:"threshold" ===

  id          (string)   — Will be replaced on import. Any placeholder is fine.
  enabled     (boolean)  — Set false. Forced on import.
  builtin     (boolean)  — Always false for user-authored rules.
  kind        (string)   — "threshold" (or omit; absence means threshold).
  label       (string, required) — Short label for chip, max ~60 chars.
                                   e.g. "High potassium", "Low sodium — critical".
  analyte     (object, required)
    match     (string[], required, non-empty) — Case-insensitive substrings against result.name.
    exclude   (string[], optional) — Case-insensitive substrings. A result whose name contains
                                     any of these is skipped even if it matched. Use to drop
                                     shared-token false positives, e.g. exclude ["mean platelet"]
                                     on a "platelet" rule so it does not fire on "Mean platelet
                                     volume"; exclude ["a1c"] on a "haemoglobin" rule; exclude
                                     ["urine"] on a serum potassium/sodium rule.
  comparator  ("above"|"below", required)
  amber       (number|null, required) — Amber threshold; null = not set.
  red         (number|null, required) — Red threshold; null = not set.
              Ordering: "above" → red >= amber; "below" → red <= amber.
  unit        (string, optional)     — Display unit only; no conversion performed.

--- THRESHOLD EXAMPLE ---
{
  "id": "rule_placeholder",
  "enabled": false,
  "builtin": false,
  "kind": "threshold",
  "label": "High potassium",
  "analyte": {
    "match": ["potassium"]
  },
  "comparator": "above",
  "amber": 5.5,
  "red": 6.0,
  "unit": "mmol/L"
}
--- END THRESHOLD EXAMPLE ---

This example escalates a potassium result to amber if >= 5.5 mmol/L and to red if >= 6.0 mmol/L. A laboratory-flagged urgent result stays urgent; a laboratory-normal result of 5.6 mmol/L would be escalated to amber.

=== SCHEMA — kind:"text" ===

  id          (string)   — Will be replaced on import.
  enabled     (boolean)  — Set false. Forced on import.
  builtin     (boolean)  — Always false for user-authored rules.
  kind        (string)   — "text" (required for this path).
  label       (string, required) — Label shown on chip when outcome is 'review' (no normal phrase
                                   found). Max ~60 chars. e.g. "Needs review".
  analyte     (object, required)
    match     (string[], required, non-empty) — Case-insensitive substrings against result.name.
                                                e.g. ["MSU", "urine culture"]
    exclude   (string[], optional) — Case-insensitive substrings; a result whose name contains
                                     any is skipped even if matched (drops shared-token false
                                     positives).
  normalText  (string[], required, non-empty) — Phrases searched (case-insensitive) in the
                                                combined result text (rawValue + interpretation +
                                                performer/filing comments). If ANY phrase is found,
                                                outcome is 'noGrowth' (calm info chip, no severity
                                                escalation). If NONE are found, outcome is 'review'
                                                (amber chip — the result needs a clinician's eye).
                                                e.g. ["no growth", "no significant growth"]
  normalLabel (string, optional) — Label on the calm chip when a normal phrase is found.
                                   Default "No growth" if omitted.

--- TEXT EXAMPLE (MSU / urine culture) ---
{
  "id": "rule_placeholder",
  "enabled": false,
  "builtin": false,
  "kind": "text",
  "label": "Needs review",
  "analyte": {
    "match": ["MSU", "urine culture"]
  },
  "normalText": ["no growth"],
  "normalLabel": "No growth"
}
--- END TEXT EXAMPLE ---

This example applies to any result whose name contains "MSU" or "urine culture". If the result text contains "no growth" → calm "No growth" info chip (level not raised). If no normal phrase is found → "Needs review" amber chip (prompts a clinician to look at the result).

=== CLOSING REMINDER ===

The rule will be imported DISABLED. A GP or nominated reviewer MUST check the analyte match strings and (for threshold rules) comparator and threshold values before enabling the rule. A rule with an incorrect threshold or match string is a direct patient-safety risk — an overly sensitive threshold creates alert fatigue; a threshold set in the wrong direction or a missing match string silently fails to fire. Review the rule in the Investigation Results settings tab before enabling. Output ONLY valid JSON.
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
