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
//     normalText  : string[]        — calm-if-present; if any phrase is found
//                                    (case-insensitive) in result.text → outcome 'noGrowth'.
//                                    A rule whose normalText is ABSENT → 'review'.
//     abnormalText: string[]        — OPTIONAL; flag-if-present. If any phrase is found in
//                                    result.text → outcome 'review' (e.g. "no response to
//                                    bowel cancer screening"). A positive abnormalText flag
//                                    is never overridden by a normal phrase. Use this to
//                                    surface a specific coded finding without having to
//                                    enumerate the full "normal" set (which risks a
//                                    false-negative — e.g. "abnormal" contains "normal").
//     normalLabel : string          — optional; label shown on chip when outcome is 'noGrowth'
//                                    (default "No growth")
//   }
//   At least one of normalText / abnormalText must be a non-empty array.
//
// Text rules are ESCALATE-ONLY. A result whose text contains a normal phrase gets a
// calm 'noGrowth' info outcome (does not raise level). A result flagged by abnormalText, or
// (for a normalText rule) whose text does NOT contain a normal phrase, gets 'review' which
// escalates the row to amber. A rule with ONLY abnormalText flags nothing unless a flag
// phrase is present — normal / other results are left untouched (no chip).
//
// kind:'combo':
//   {
//     id          : string          — set by importer
//     enabled     : boolean         — importer forces false; clinician enables after review
//     builtin     : boolean         — always false for user-authored rules
//     kind        : 'combo'         — required to use this path
//     label       : string          — required, ≤ 60 chars; shown on chip when the combo fires
//     level       : 'amber'|'red'   — OPTIONAL; default 'amber'. Escalate-only.
//     conditions  : <condition>[]   — required, array, length ≥ 2. ALL must be satisfied (AND).
//     suppressIfProblem : {...}      — OPTIONAL; same semantics as the other kinds.
//   }
//   A <condition> targets ONE analyte and is NUMERIC or TEXT (exactly one form):
//     common:  analyte:{ match:string[] (≥1 non-empty), exclude?:string[], specimen?:string[] }
//     NUMERIC: comparator:'above'|'below', value:number — satisfied if some matching result's
//              numeric value >= value (above) / <= value (below). Same Number.isFinite guard as
//              computeRuleSev: a non-finite value never satisfies (fail-safe — combo won't fire).
//     TEXT:    contains:string[] (≥1 non-empty) — satisfied if some matching result's combined
//              text contains ANY phrase (case-insensitive, whitespace-collapsed substring).
//
// A combo FIRES iff EVERY condition is satisfied by SOME result within the SAME report (each
// condition may be satisfied by a DIFFERENT result row). Combo is ESCALATE-ONLY: a fired amber
// combo raises the report level to ≥ amber; a fired red combo to red. It never lowers severity
// and never calms/suppresses (other than honouring its own suppressIfProblem).

(function (global) {
  'use strict';

  // ── Public field list (useful for option UIs) ────────────────────────────────
  const RESULT_RULE_FIELDS = ['label', 'analyte', 'comparator', 'amber', 'red', 'unit'];

  // ── Shared validators ─────────────────────────────────────────────────────────

  // suppressIfProblem — OPTIONAL on every rule kind. Object:
  //   { match: string[] (≥1 non-empty), exclude?: string[] }.
  // Pushes any errors onto `errs`. Shared so threshold/text/combo all behave identically.
  function validateSuppressIfProblem(rule, errs) {
    if (rule.suppressIfProblem === undefined) return;
    const s = rule.suppressIfProblem;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      errs.push('suppressIfProblem, if present, must be an object with a match array.');
      return;
    }
    const sm = Array.isArray(s.match) ? s.match.filter((m) => typeof m === 'string' && m.trim()) : null;
    if (!sm || sm.length === 0) {
      errs.push('suppressIfProblem.match must contain at least one non-empty string.');
    }
    if (s.exclude !== undefined && (!Array.isArray(s.exclude) || s.exclude.some((e) => typeof e !== 'string'))) {
      errs.push('suppressIfProblem.exclude, if present, must be an array of strings.');
    }
  }

  // Validate a single combo condition's analyte block (match required, exclude/specimen
  // optional arrays of strings). Pushes errors onto `errs`, prefixed with `where`.
  function validateConditionAnalyte(analyte, errs, where) {
    if (!analyte || typeof analyte !== 'object' || Array.isArray(analyte)) {
      errs.push(where + 'analyte must be an object with a match array.');
      return;
    }
    const match = analyte.match;
    if (!Array.isArray(match)) {
      errs.push(where + 'analyte.match must be an array of strings.');
    } else if (match.filter((m) => typeof m === 'string' && m.trim().length > 0).length === 0) {
      errs.push(where + 'analyte.match must contain at least one non-empty string.');
    }
    if (analyte.exclude !== undefined) {
      if (!Array.isArray(analyte.exclude) || analyte.exclude.some((e) => typeof e !== 'string')) {
        errs.push(where + 'analyte.exclude, if present, must be an array of strings.');
      }
    }
    if (analyte.specimen !== undefined) {
      if (!Array.isArray(analyte.specimen) || analyte.specimen.some((sp) => typeof sp !== 'string')) {
        errs.push(where + 'analyte.specimen, if present, must be an array of strings.');
      }
    }
  }

  // Validate the combo-specific fields: level (optional amber|red) and the conditions
  // array (≥ 2 conditions, each NUMERIC xor TEXT). Pushes errors onto `errs`.
  function validateComboFields(rule, errs) {
    // level — OPTIONAL; default amber. If present must be 'amber' or 'red'.
    if (rule.level !== undefined && rule.level !== 'amber' && rule.level !== 'red') {
      errs.push("combo level, if present, must be 'amber' or 'red'.");
    }

    const conditions = rule.conditions;
    if (!Array.isArray(conditions)) {
      errs.push('combo conditions must be an array.');
      return;
    }
    if (conditions.length < 2) {
      errs.push('combo conditions must contain at least 2 conditions (a combo ANDs multiple conditions).');
    }

    conditions.forEach((cond, i) => {
      const where = 'conditions[' + i + ']: ';
      if (!cond || typeof cond !== 'object' || Array.isArray(cond)) {
        errs.push(where + 'each condition must be an object.');
        return;
      }
      validateConditionAnalyte(cond.analyte, errs, where);

      // A condition is NUMERIC iff it carries `comparator`; TEXT iff it carries `contains`.
      // Exactly one form is permitted.
      const isNumeric = cond.comparator !== undefined;
      const isText = cond.contains !== undefined;
      if (isNumeric && isText) {
        errs.push(where + 'a condition must be NUMERIC (comparator+value) XOR TEXT (contains), not both.');
        return;
      }
      if (!isNumeric && !isText) {
        errs.push(where + 'a condition must define either comparator+value (numeric) or contains (text).');
        return;
      }

      if (isNumeric) {
        if (cond.comparator !== 'above' && cond.comparator !== 'below') {
          errs.push(where + "numeric condition comparator must be 'above' or 'below'.");
        }
        if (!Number.isFinite(cond.value)) {
          errs.push(where + 'numeric condition value must be a finite number.');
        }
      } else {
        // TEXT
        if (!Array.isArray(cond.contains)) {
          errs.push(where + 'text condition contains must be an array of strings.');
        } else if (cond.contains.filter((c) => typeof c === 'string' && c.trim().length > 0).length === 0) {
          errs.push(where + 'text condition contains must contain at least one non-empty string.');
        }
      }
    });
  }

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

    // Determine kind — absent or 'threshold' → numeric; 'text' → text classification;
    // 'combo' → composite (AND of conditions across results in one report).
    const kind = rule.kind !== undefined ? rule.kind : 'threshold';

    if (kind !== 'threshold' && kind !== 'text' && kind !== 'combo') {
      errs.push("rule.kind must be 'threshold', 'text', or 'combo' (or omitted, which defaults to 'threshold').");
      return errs; // unknown kind — no further field checks make sense
    }

    // label — required non-empty string (all kinds)
    if (!rule.label || typeof rule.label !== 'string' || !rule.label.trim()) {
      errs.push('label is required and must be a non-empty string.');
    } else if (rule.label.trim().length > 60) {
      errs.push('label should be 60 characters or fewer (got ' + rule.label.trim().length + ').');
    }

    // ── combo kind: a top-level rule with no single analyte — its analytes live on
    //    each condition. Validate conditions then fall through to the shared
    //    suppressIfProblem block and return; the per-kind analyte/threshold/text
    //    checks below are for threshold/text rules only.
    if (kind === 'combo') {
      validateComboFields(rule, errs);
      validateSuppressIfProblem(rule, errs);
      return errs;
    }

    // analyte.match — required non-empty array of non-empty strings (threshold/text)
    const analyte = rule.analyte;
    if (!analyte || typeof analyte !== 'object') {
      errs.push('analyte must be an object with a match array.');
    } else {
      const match = analyte.match;
      if (!Array.isArray(match)) {
        errs.push('analyte.match must be an array of strings.');
      } else {
        const nonEmpty = match.filter((m) => typeof m === 'string' && m.trim().length > 0);
        if (nonEmpty.length === 0) {
          errs.push('analyte.match must contain at least one non-empty string.');
        }
      }
      // analyte.exclude — OPTIONAL. If present, must be an array of strings.
      // Drops false-positive analytes that share a match token (see header).
      if (analyte.exclude !== undefined) {
        if (!Array.isArray(analyte.exclude)) {
          errs.push('analyte.exclude, if present, must be an array of strings.');
        } else if (analyte.exclude.some((e) => typeof e !== 'string')) {
          errs.push('analyte.exclude must contain only strings.');
        }
      }
      // analyte.specimen — OPTIONAL. If present, must be an array of non-empty strings.
      // Scopes the rule to results whose specimen header (from normaliseInvestigationReport)
      // contains at least one term as a case-insensitive substring. Fail-open: if the
      // result carries no specimen header, the rule still applies (never blocks on absence).
      if (analyte.specimen !== undefined) {
        if (!Array.isArray(analyte.specimen)) {
          errs.push('analyte.specimen, if present, must be an array of strings.');
        } else if (analyte.specimen.some((s) => typeof s !== 'string')) {
          errs.push('analyte.specimen must contain only strings.');
        }
      }
    }

    // suppressIfProblem — OPTIONAL (all kinds). Suppresses the rule when the patient
    // already has a matching problem on record (e.g. don't flag a possible new diabetes
    // for a known diabetic). Object: { match: string[] (≥1 non-empty), exclude?: string[] }.
    validateSuppressIfProblem(rule, errs);

    if (kind === 'text') {
      // A text rule classifies by phrase lists: normalText (calm-if-present) and/or
      // abnormalText (flag-if-present). At least one must be a non-empty array of strings.
      const countNonEmpty = (arr) =>
        Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim().length > 0).length : -1;
      const normalCount = countNonEmpty(rule.normalText); // -1 = not an array
      const abnormalCount = countNonEmpty(rule.abnormalText);

      // normalText — if present, must be an array of strings.
      if (rule.normalText !== undefined && !Array.isArray(rule.normalText)) {
        errs.push('normalText, if present, must be an array of strings for kind "text" rules.');
      }
      // abnormalText — if present, must be an array of strings.
      if (rule.abnormalText !== undefined && !Array.isArray(rule.abnormalText)) {
        errs.push('abnormalText, if present, must be an array of strings for kind "text" rules.');
      }
      // At least one non-empty classification list is required.
      if (normalCount <= 0 && abnormalCount <= 0) {
        errs.push('A text rule must define at least one non-empty normalText or abnormalText array.');
      }

      // normalLabel — optional string
      if (rule.normalLabel !== undefined && rule.normalLabel !== null && typeof rule.normalLabel !== 'string') {
        errs.push('normalLabel must be a string or omitted.');
      }
    } else {
      // threshold kind: comparator, amber, red, unit

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

  kind:"text"       — free-text / coded-finding result (e.g. MSU, urine culture, blood
                      culture, HVS, bowel cancer screening). These results have no numeric
                      high/low flag, so the engine searches the result text for phrases.
                      Two complementary lists (at least one required):
                        • normalText  — calm-if-present. If a normal phrase is found → calm
                          "No growth" info chip (does NOT raise severity). If a normalText
                          rule finds NO normal phrase → "Needs review" amber chip. Best for
                          microbiology/cultures where "normal" is one of a few known phrases.
                        • abnormalText — flag-if-present. If a flag phrase is found → amber
                          review chip; nothing else about the result is flagged or calmed.
                          Best for surfacing ONE specific coded finding (e.g. a bowel cancer
                          screening non-responder) without enumerating the whole normal set.

=== CLINICAL SAFETY INSTRUCTIONS ===

1. Analyte matching is CASE-INSENSITIVE SUBSTRING — "potassium" matches "Serum Potassium (EDTA)" and "Potassium". List the most specific substring that uniquely identifies the analyte to avoid false matches.
2. Rules ESCALATE severity only — they raise a chip from none→amber or none/amber→red (threshold) or flag a result for review (text). They NEVER lower a lab-flagged result. If the laboratory has already flagged a result as urgent, it remains urgent regardless of what the rule says.
3. Imported rules arrive DISABLED (enabled:false is forced on import). A clinician MUST review the analyte match strings and threshold/text values before enabling the rule. Incorrect rules are a patient-safety risk.
4. For threshold rules: use current UK reference ranges and NICE/BNF guidance when choosing threshold values. When in doubt, use a more conservative (wider) threshold rather than a narrower one.
5. The 'unit' field is for display only — the engine does not perform unit conversion. Ensure the threshold values are in the same units as reported by your laboratory system.
6. For text rules: normalText / abnormalText phrases are matched case-insensitively anywhere in the result text (rawValue, interpretation, performer comments). For normalText, only include phrases that unambiguously indicate a negative / no-growth result — a phrase that is too short or too generic risks a false-negative (a positive result classed as normal; note "abnormal" contains the substring "normal", so never use a bare "normal"). For abnormalText, prefer a positive match on the exact finding you want to surface; it only ever ADDS a review flag, so it cannot hide a result.

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
    specimen  (string[], optional) — Case-insensitive substrings matched against the specimen
                                     group header. Fail-open: absent header → rule still applies.
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
    specimen  (string[], optional) — Case-insensitive substrings matched against the specimen
                                     group header captured by the normaliser (e.g. "THROAT SWAB",
                                     "BLOOD CULTURE"). Fail-open: if the result has no specimen
                                     header the rule still applies. Use to scope a text rule so
                                     a generic analyte name ("Culture") only fires on the intended
                                     specimen type and not on unrelated cultures.
  normalText  (string[], optional*) — Phrases searched (case-insensitive) in the combined
                                                result text (rawValue + interpretation +
                                                performer/filing comments). If ANY phrase is found,
                                                outcome is 'noGrowth' (calm info chip, no severity
                                                escalation). If a normalText rule finds NONE,
                                                outcome is 'review' (amber — needs a clinician's eye).
                                                e.g. ["no growth", "no significant growth"]
  abnormalText (string[], optional*) — Phrases searched the same way. If ANY phrase is found, the
                                                result is flagged 'review' (amber). Unlike normalText
                                                it ONLY adds a flag — a result with no abnormalText
                                                phrase is left untouched (no chip), so a lone
                                                abnormalText rule cannot hide or calm anything.
                                                e.g. ["no response to bowel cancer screening"]
                                   * At least one of normalText / abnormalText is required.
  normalLabel (string, optional) — Label on the calm chip when a normal phrase is found.
                                   Default "No growth" if omitted.

--- TEXT EXAMPLE (MSU / urine culture — normalText) ---
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

--- TEXT EXAMPLE (bowel cancer screening non-responder — abnormalText) ---
{
  "id": "rule_placeholder",
  "enabled": false,
  "builtin": false,
  "kind": "text",
  "label": "Bowel screening: no response",
  "analyte": {
    "match": ["bcs:fob", "bowel cancer screening", "faecal occult blood"]
  },
  "abnormalText": ["no response to bowel cancer screening", "bowel cancer screening programme non-responder"]
}
--- END TEXT EXAMPLE ---

This example surfaces bowel cancer screening non-responders: it applies to bowel-screening results and flags 'review' ONLY when the text contains a "no response" phrase. A normal or abnormal screening result contains no such phrase, so it is left untouched — the rule can never hide a positive result.

=== SCHEMA — kind:"combo" ===

A combo rule fires ONLY when MULTIPLE conditions are ALL satisfied (logical AND) by results within the SAME investigation report. Each condition may be satisfied by a DIFFERENT result row in that report. Use a combo when no single analyte is alarming on its own, but a PATTERN across several analytes is clinically significant (e.g. sterile pyuria: pus cells raised AND the culture shows no growth). A combo is ESCALATE-ONLY: when it fires it raises the report to its level (default amber); it NEVER lowers a lab flag or another rule, and it never calms or suppresses anything.

  id          (string)   — Will be replaced on import.
  enabled     (boolean)  — Set false. Forced on import.
  builtin     (boolean)  — Always false for user-authored rules.
  kind        (string)   — "combo" (required for this path).
  label       (string, required) — Short label for the chip shown when the combo fires. Max ~60 chars.
  level       ("amber"|"red", optional) — Severity the combo escalates to. Default "amber".
  conditions  (array, required, length ≥ 2) — ALL must be satisfied for the combo to fire.
    Each condition targets ONE analyte and is EITHER numeric OR text (exactly one form):
      analyte (object, required)
        match    (string[], required, non-empty) — Case-insensitive substrings against result.name.
        exclude  (string[], optional) — Skip a result whose name contains any of these.
        specimen (string[], optional) — Case-insensitive substrings against the specimen header.
                                        Fail-open: a result with no header still applies.
      NUMERIC condition — adds:
        comparator ("above"|"below", required) — satisfied if a matching result's numeric value
                                                  is >= value (above) or <= value (below).
        value      (number, required)          — the threshold.
        (A non-numeric / missing result value never satisfies the condition — fail-safe.)
      TEXT condition — adds:
        contains   (string[], required, non-empty) — satisfied if a matching result's combined
                                                      text contains ANY of these phrases
                                                      (case-insensitive substring).
    A condition must define comparator+value (numeric) XOR contains (text) — never both, never neither.
  suppressIfProblem (object, optional) — same as the other kinds: { match:string[], exclude?:string[] }.

--- COMBO EXAMPLE (sterile pyuria — pus cells up AND culture no growth) ---
{
  "id": "rule_placeholder",
  "enabled": false,
  "builtin": false,
  "kind": "combo",
  "label": "Sterile pyuria (pus cells, no growth)",
  "level": "amber",
  "conditions": [
    {
      "analyte": { "match": ["pus cells", "white cells", "wbc"], "specimen": ["urine", "msu"] },
      "comparator": "above",
      "value": 40
    },
    {
      "analyte": { "match": ["culture", "msu"], "specimen": ["urine", "msu"] },
      "contains": ["no growth", "no significant growth"]
    }
  ]
}
--- END COMBO EXAMPLE ---

This example fires amber ONLY when a urine report shows BOTH a pus-cell count above 40 AND a culture that reads "no growth" (sterile pyuria — a pattern a clinician should review). Either finding alone does not fire it. It cannot lower a lab-urgent flag on the same report.

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
