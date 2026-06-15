// engine/result-severity.js — Investigation result severity scorer
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Consumes the output of normaliseInvestigationReport (engine/normalisers.js)
// and returns a severity level for chip display in the investigation results queue.
//
// Severity rules (lab-flag-led; no custom clinical thresholds):
//   red   — any result has urgent === true (requiresUrgentReview from API)
//   amber — any result is above or below reference range (but none urgent)
//   none  — all results within range, or no results
//
// opts.resultRules (optional array of analyte-threshold rules) can ESCALATE severity
// on top of the lab's own flags — they never lower lab-flagged severity.
// Rules are matched case-insensitively by substring against result.name.
//
// The `thresholds` option in opts is an intentional extension point for future
// named-analyte escalation logic (e.g. sodium < 120 → red regardless of lab flag).
// It is accepted but not acted upon in this version — do not add clinical logic here
// without clinical safety officer sign-off.

(function (global) {
  'use strict';

  // ── Severity ordering helpers ─────────────────────────────────────────────────
  // Internal severity levels: 'none' < 'abnormal' < 'urgent'
  const SEV_ORDER = { none: 0, abnormal: 1, urgent: 2 };

  function maxSev(a, b) {
    return SEV_ORDER[a] >= SEV_ORDER[b] ? a : b;
  }

  // ── Specimen-header gate (fail-open narrowing AND-filter) ─────────────────────
  // Implements the analyte.specimen scoping semantics:
  //   - No analyte.specimen (absent or empty array) → pass (no change to today's behaviour).
  //   - analyte.specimen present AND result.specimen is a non-empty string → require at
  //     least one analyte.specimen term to be a case-insensitive substring of result.specimen.
  //   - analyte.specimen present BUT result.specimen is absent/null/empty → PASS (fail-open).
  //     Never drop a rule because the specimen header was not captured from this report.
  // Returns true if the rule should proceed; false if the specimen gate blocks it.
  function specimenAllows(analyte, result) {
    if (!Array.isArray(analyte.specimen) || analyte.specimen.length === 0) return true;
    const spec = typeof result.specimen === 'string' ? result.specimen.trim() : '';
    if (!spec) return true; // fail-open: no header captured → do not gate
    const specLower = spec.toLowerCase();
    return analyte.specimen.some((t) => typeof t === 'string' && t.length > 0 && specLower.includes(t.toLowerCase()));
  }

  // ── Compute text-rule outcome for a single result ────────────────────────────
  // Handles rules with kind === 'text'. Returns 'review', 'noGrowth', or 'none'.
  // Also returns the matched rule's label / normalLabel for chip display.
  // Deliberately does NOT import result-rules.js to avoid a content-world dep.
  //
  // A text rule classifies an applied result (its name matched analyte.match) using:
  //   abnormalText — POSITIVE flag: if any phrase is present in the result text the
  //                  result is flagged 'review' (e.g. "no response to bowel cancer
  //                  screening"). A positive flag is never overridden by a normal phrase.
  //                  This is the safe primitive for surfacing a specific coded finding
  //                  WITHOUT having to enumerate every "normal" phrase — guessing the
  //                  normal set risks a false-negative (e.g. "abnormal" contains "normal").
  //   normalText   — calm-if-present: a phrase present → 'noGrowth' (calm); a rule whose
  //                  normalText is ABSENT → 'review' (the culture "not clearly normal"
  //                  pattern). A rule with ONLY abnormalText that did not match flags
  //                  nothing — its analyte was seen but no flag phrase was present.
  function computeTextOutcome(result, rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
      return { outcome: 'none', label: null, normalLabel: null };
    }
    if (!result || typeof result !== 'object') {
      return { outcome: 'none', label: null, normalLabel: null };
    }

    const name = typeof result.name === 'string' ? result.name.toLowerCase() : '';
    // Collapse every run of whitespace (spaces, NEWLINES, tabs) to a single space before
    // phrase matching. Lab reports hard-wrap free text, so a phrase like "no evidence of
    // dysplasia or malignancy" can arrive as "...no evidence\nof dysplasia...". A literal
    // includes() would miss it — calming a benign result fails (false amber), and worse, an
    // abnormalText flag phrase split across a line break would silently NOT fire (false
    // negative). Normalising both sides makes matches robust to the lab's line wrapping;
    // it can never create a spurious match (the words are adjacent in the sentence anyway).
    const collapseWs = (s) => s.replace(/\s+/g, ' ');
    // result.text is the pre-built combined free-text string (may be absent on old fixtures)
    const resultText = typeof result.text === 'string' ? collapseWs(result.text.toLowerCase()) : '';

    // normalText (calm) phrases are matched WORD-BOUNDARY-aware so a short normal token can't
    // false-calm inside a larger word — the classic "normal" ⊂ "abnormal", or "negative" ⊂
    // "seronegative". Plain alphanumeric phrases get \b…\b (the proven problemLabelMatches
    // pattern); phrases with punctuation/symbols fall back to substring (they can't be
    // \b-wrapped safely). This only ever makes calming STRICTER (→ more review), never hides a
    // positive. abnormalText is DELIBERATELY left substring (see below): keeping the positive-
    // flag path broad biases it toward flagging (e.g. "candida" still catches "candidaemia") —
    // the safe direction — and every shipped abnormalText term is collision-verified against
    // negative report text, so breadth there cannot false-flag a true negative.
    const normalPhrasePresent = (text, phrase) => {
      const p = collapseWs(
        String(phrase || '')
          .toLowerCase()
          .trim()
      );
      if (!p) return false;
      if (/^[a-z0-9 ]+$/.test(p)) {
        return new RegExp('\\b' + p.replace(/\s+/g, '\\s+') + '\\b').test(text);
      }
      return text.includes(p);
    };

    let anyRuleApplied = false;
    let abnormalFound = false; // an abnormalText phrase positively matched → forced review
    let abnormalLabel = null;
    let normalFound = false;
    let reviewLabel = null;
    let normalLabel = null;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') continue;
      if ((rule.kind || 'threshold') !== 'text') continue; // only text rules
      if (rule.enabled === false) continue;

      // analyte.match must be a non-empty array
      const analyte = rule.analyte;
      if (!analyte || !Array.isArray(analyte.match) || analyte.match.length === 0) continue;
      // A text rule must carry at least one classification list — normalText
      // (calm-if-present) and/or abnormalText (flag-if-present). Neither → cannot classify.
      const hasNormal = Array.isArray(rule.normalText) && rule.normalText.length > 0;
      const hasAbnormal = Array.isArray(rule.abnormalText) && rule.abnormalText.length > 0;
      if (!hasNormal && !hasAbnormal) continue;

      // Does this rule apply to this result?
      const nameHit = analyte.match.some(
        (m) => typeof m === 'string' && m.length > 0 && name.includes(m.toLowerCase())
      );
      if (!nameHit) continue;
      // analyte.exclude (optional) — same semantics as in computeRuleSev: skip a
      // result whose name contains an exclude substring (a different test that
      // happens to share a match token).
      if (
        Array.isArray(analyte.exclude) &&
        analyte.exclude.some((e) => typeof e === 'string' && e.length > 0 && name.includes(e.toLowerCase()))
      ) {
        continue;
      }
      // analyte.specimen (optional, fail-open) — scope rule to a specific specimen
      // header (e.g. "throat swab") captured by the normaliser. Fail-open: if the
      // result has no specimen header the rule still applies.
      if (!specimenAllows(analyte, result)) continue;

      anyRuleApplied = true;

      // abnormalText is a POSITIVE flag match (e.g. "no response to bowel cancer
      // screening"). If any phrase is present the result is flagged — and a positive flag
      // is never overridden by a normal phrase, so record it and move on to the next rule.
      if (hasAbnormal) {
        const foundAbnormal = rule.abnormalText.some(
          (phrase) =>
            typeof phrase === 'string' && phrase.length > 0 && resultText.includes(collapseWs(phrase.toLowerCase()))
        );
        if (foundAbnormal) {
          abnormalFound = true;
          if (!abnormalLabel) {
            abnormalLabel = (typeof rule.label === 'string' && rule.label) || 'Needs review';
          }
          continue; // flagged by this rule; do not also apply its normalText
        }
      }

      // normalText classification. A rule with ONLY abnormalText that did not match
      // contributes nothing here (neither calm nor flag).
      if (hasNormal) {
        const foundNormal = rule.normalText.some(
          (phrase) => typeof phrase === 'string' && phrase.length > 0 && normalPhrasePresent(resultText, phrase)
        );
        if (foundNormal) {
          normalFound = true;
          if (!normalLabel) {
            normalLabel = (typeof rule.normalLabel === 'string' && rule.normalLabel) || 'No growth';
          }
        } else {
          if (!reviewLabel) {
            reviewLabel = (typeof rule.label === 'string' && rule.label) || 'Needs review';
          }
        }
      }
    }

    if (!anyRuleApplied) return { outcome: 'none', label: null, normalLabel: null };
    // Precedence: an explicit abnormalText flag wins over a normal phrase (never calm a
    // positively-flagged finding); a normal phrase calms; otherwise a "not clearly normal"
    // normalText rule reviews; a lone abnormalText rule that did not match stays none.
    if (abnormalFound) return { outcome: 'review', label: abnormalLabel || 'Needs review', normalLabel: null };
    if (normalFound) return { outcome: 'noGrowth', label: null, normalLabel: normalLabel || 'No growth' };
    if (reviewLabel) return { outcome: 'review', label: reviewLabel, normalLabel: null };
    return { outcome: 'none', label: null, normalLabel: null };
  }

  // ── Patient-record suppression helper ─────────────────────────────────────────
  // A rule may carry suppressIfProblem:{ match:string[], exclude?:string[] } to mean
  // "do not fire if the patient already has this on their problem record" (e.g. don't
  // flag a possible new diabetes when the patient is already on the diabetes register).
  //
  // Matching mirrors the proven approach in rules-engine.patientOnRegister:
  //   - match terms: word-boundary aware for plain alphanumeric phrases (so "diabetic"
  //     does not match "prediabetes"), substring fallback for terms with punctuation;
  //   - exclude terms: broad substring, checked FIRST, so compound look-alikes like
  //     "non-diabetic hyperglycaemia" / "pre-diabetic retinopathy" are dropped before
  //     a "diabetic" match can fire. This is patient-safety critical: an over-broad
  //     suppression silently hides a genuine new diagnosis.
  // Deliberately self-contained (no rules-engine import) to keep this content-world-safe.
  function problemLabelMatches(label, term) {
    const t = String(term || '')
      .toLowerCase()
      .trim();
    if (!t) return false;
    if (/^[a-z0-9 ]+$/.test(t)) {
      const rx = new RegExp('\\b' + t.replace(/\s+/g, '\\s+') + '\\b');
      return rx.test(label);
    }
    return label.includes(t);
  }
  function ruleSuppressedByProblems(rule, problems) {
    const cond = rule && rule.suppressIfProblem;
    if (!cond || typeof cond !== 'object') return false;
    if (!Array.isArray(problems) || problems.length === 0) return false;
    const match = Array.isArray(cond.match) ? cond.match : [];
    const exclude = Array.isArray(cond.exclude) ? cond.exclude : [];
    if (match.length === 0) return false;
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      const label = String((p && (p.label || p.title || p.description)) || '').toLowerCase();
      if (!label) continue;
      if (exclude.some((e) => typeof e === 'string' && e && label.includes(e.toLowerCase()))) continue;
      if (match.some((m) => typeof m === 'string' && m && problemLabelMatches(label, m))) return true;
    }
    return false;
  }

  // ── Compute rule-derived severity for a single result ─────────────────────────
  // Deliberately does NOT import result-rules.js to avoid a content-world dep.
  // Uses minimal inline guards only. Returns { sev, label }:
  //   sev   — 'none' | 'abnormal' | 'urgent' (highest a matching rule produced)
  //   label — the label of the rule that produced `sev` (for attributable chips), or null.
  // `problems` (optional) is the patient's problem list for suppressIfProblem rules.
  function computeRuleSev(result, rules, problems) {
    const NONE = { sev: 'none', label: null };
    if (!Array.isArray(rules) || rules.length === 0) return NONE;
    if (!result || typeof result !== 'object') return NONE;

    const name = typeof result.name === 'string' ? result.name.toLowerCase() : '';
    const value = result.value;
    if (!Number.isFinite(value)) return NONE;

    let best = 'none';
    let bestLabel = null;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') continue;
      // Guard: skip disabled rules (caller should pass only enabled ones, but be safe)
      if (rule.enabled === false) continue;
      // Guard: analyte.match must be a non-empty array
      const analyte = rule.analyte;
      if (!analyte || !Array.isArray(analyte.match) || analyte.match.length === 0) continue;
      // Guard: comparator must be 'above' or 'below'
      if (rule.comparator !== 'above' && rule.comparator !== 'below') continue;
      // Suppress if the patient already has the relevant problem on record.
      if (ruleSuppressedByProblems(rule, problems)) continue;

      // Check if any match substring hits the result name
      const hits = analyte.match.some((m) => typeof m === 'string' && m.length > 0 && name.includes(m.toLowerCase()));
      if (!hits) continue;
      // analyte.exclude (optional) drops false-positive analytes whose name
      // contains a match substring but are a different test — e.g. a "platelet"
      // rule must NOT fire on "Mean platelet volume", a "haemoglobin" rule must
      // NOT fire on "Haemoglobin A1c", and a serum-electrolyte rule must skip a
      // "Urine ..." analyte. Same case-insensitive substring semantics as match.
      if (
        Array.isArray(analyte.exclude) &&
        analyte.exclude.some((e) => typeof e === 'string' && e.length > 0 && name.includes(e.toLowerCase()))
      ) {
        continue;
      }
      // analyte.specimen (optional, fail-open) — scope rule to a specific specimen
      // header captured by the normaliser. Fail-open: if the result has no specimen
      // header the rule still applies.
      if (!specimenAllows(analyte, result)) continue;

      // Evaluate threshold
      let ruleSev = 'none';
      const amber = rule.amber;
      const red = rule.red;

      if (rule.comparator === 'above') {
        if (Number.isFinite(red) && value >= red) {
          ruleSev = 'urgent';
        } else if (Number.isFinite(amber) && value >= amber) {
          ruleSev = 'abnormal';
        }
      } else {
        // 'below'
        if (Number.isFinite(red) && value <= red) {
          ruleSev = 'urgent';
        } else if (Number.isFinite(amber) && value <= amber) {
          ruleSev = 'abnormal';
        }
      }

      if (SEV_ORDER[ruleSev] > SEV_ORDER[best]) {
        best = ruleSev;
        bestLabel = (typeof rule.label === 'string' && rule.label) || null;
      }
      if (best === 'urgent') break; // can't go higher
    }

    return { sev: best, label: bestLabel };
  }

  // ── Compute combo-rule outcome across a whole report ──────────────────────────
  // Handles rules with kind === 'combo'. A combo fires when EVERY one of its
  // conditions is satisfied by SOME result in the report (each condition may be met
  // by a DIFFERENT result row). Combos are ESCALATE-ONLY: they raise the report level
  // to their `level` (default 'amber'), never lower it, never calm/suppress.
  // Deliberately self-contained (no result-rules.js import) — mirrors computeTextOutcome.
  //
  // Returns { comboCount, comboTop } where:
  //   comboCount — number of combo rules that fired
  //   comboTop   — { label, level } of the FIRST fired combo, or null.
  //
  // Numeric condition value access reuses the EXACT computeRuleSev guard
  // (Number.isFinite(result.value)); a non-finite value never satisfies a numeric
  // condition (fail-safe — the combo will not fire on missing data).
  function computeComboOutcome(report, rules, problems) {
    const NONE = { comboCount: 0, comboTop: null };
    if (!report || !Array.isArray(report.results)) return NONE;
    if (!Array.isArray(rules) || rules.length === 0) return NONE;
    const results = report.results;

    const collapseWs = (s) => String(s).replace(/\s+/g, ' ');

    // Does `result` match a condition's analyte (name match, not excluded, specimen-allowed)?
    function analyteMatches(analyte, result) {
      if (!analyte || !Array.isArray(analyte.match) || analyte.match.length === 0) return false;
      const name = typeof result.name === 'string' ? result.name.toLowerCase() : '';
      const hit = analyte.match.some((m) => typeof m === 'string' && m.length > 0 && name.includes(m.toLowerCase()));
      if (!hit) return false;
      if (
        Array.isArray(analyte.exclude) &&
        analyte.exclude.some((e) => typeof e === 'string' && e.length > 0 && name.includes(e.toLowerCase()))
      ) {
        return false;
      }
      if (!specimenAllows(analyte, result)) return false;
      return true;
    }

    // Is a single condition satisfied by SOME result in the report?
    function conditionSatisfied(cond) {
      if (!cond || typeof cond !== 'object') return false;
      const analyte = cond.analyte;
      const isNumeric = cond.comparator !== undefined;
      const isText = cond.contains !== undefined;
      // Exactly one form — a malformed condition (both/neither) cannot be satisfied.
      if (isNumeric === isText) return false;

      if (isNumeric) {
        if (cond.comparator !== 'above' && cond.comparator !== 'below') return false;
        if (!Number.isFinite(cond.value)) return false;
        return results.some((r) => {
          if (!r || typeof r !== 'object') return false;
          if (!analyteMatches(analyte, r)) return false;
          // Same numeric access + guard as computeRuleSev — fail-safe on missing data.
          if (!Number.isFinite(r.value)) return false;
          return cond.comparator === 'above' ? r.value >= cond.value : r.value <= cond.value;
        });
      }

      // TEXT
      if (!Array.isArray(cond.contains) || cond.contains.length === 0) return false;
      const phrases = cond.contains
        .filter((p) => typeof p === 'string' && p.trim().length > 0)
        .map((p) => collapseWs(p.toLowerCase()));
      if (phrases.length === 0) return false;
      return results.some((r) => {
        if (!r || typeof r !== 'object') return false;
        if (!analyteMatches(analyte, r)) return false;
        const text = typeof r.text === 'string' ? collapseWs(r.text.toLowerCase()) : '';
        if (!text) return false;
        return phrases.some((p) => text.includes(p));
      });
    }

    let comboCount = 0;
    let comboTop = null;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') continue;
      if ((rule.kind || 'threshold') !== 'combo') continue;
      if (rule.enabled === false) continue;
      const conditions = rule.conditions;
      if (!Array.isArray(conditions) || conditions.length < 2) continue;
      // Honour suppressIfProblem (fail-open when problems absent), like every other rule.
      if (ruleSuppressedByProblems(rule, problems)) continue;

      // Every condition must be satisfied by some result (AND).
      const allSatisfied = conditions.every((cond) => conditionSatisfied(cond));
      if (!allSatisfied) continue;

      comboCount++;
      if (!comboTop) {
        const level = rule.level === 'red' ? 'red' : 'amber';
        const label = (typeof rule.label === 'string' && rule.label) || 'Combination alert';
        comboTop = { label, level };
      }
    }

    return { comboCount, comboTop };
  }

  /**
   * evaluateReportSeverity(report, opts)
   *
   * @param {object} report  Output of normaliseInvestigationReport().
   * @param {object} [opts]
   * @param {string} [opts.priorityDisplay]  Queue row priority text e.g. "High", "Routine".
   * @param {object} [opts.thresholds]       Reserved for future named-analyte thresholds.
   * @param {Array}  [opts.resultRules]      Analyte-threshold or text classification rules
   *                                         (see result-rules.js). Rules ESCALATE severity;
   *                                         they never lower lab flags.
   * @param {Array}  [opts.problems]         Patient problem list [{label}]. Used only by rules
   *                                         carrying suppressIfProblem (e.g. don't flag a
   *                                         possible new diabetes when already on the register).
   *                                         When omitted, suppressIfProblem rules are NOT
   *                                         suppressed (fail-open — flag rather than hide).
   *
   * top.ruleLabel — when the salient result's severity was RAISED by a rule (not the lab
   * flag), this carries that rule's label so the queue can render an attributable chip.
   * @returns {{ level, urgentCount, abnormalCount, top, misprioritised, unmatched,
   *             reviewCount, noGrowthCount, reviewTop, noGrowthTop, comboCount, comboTop }}
   *
   * Combo-rule outcomes (kind:'combo') are evaluated across the WHOLE report (not per
   * result): a combo fires when ALL its conditions are satisfied by SOME result in the
   * report. Combos are ESCALATE-ONLY — a fired amber combo raises level to ≥ 'amber', a
   * fired red combo to 'red'; they never lower level and never affect misprioritised
   * (which stays tied to a genuine urgent RESULT via urgentCount).
   *   comboCount — number of combo rules that fired on this report
   *   comboTop   — { label, level } of the FIRST fired combo, or null
   *
   * Text-rule outcomes (kind:'text') are SEPARATE from numeric severity. A text rule
   * flags a result via abnormalText (a flag phrase is present) or via normalText (no
   * normal phrase present); a present normalText phrase calms it.
   *   reviewCount   — results a text rule flagged for review (abnormalText hit, or no
   *                   normal phrase found in text)
   *   noGrowthCount — results matched a text rule AND a normal phrase was found
   *   reviewTop     — { name, label } | null  (first 'review' result + rule label)
   *   noGrowthTop   — { name, label } | null  (first 'noGrowth' result + its label)
   *
   * level is elevated to 'amber' if reviewCount > 0 (a culture needing review).
   * noGrowth results do NOT raise level (negative culture is calm / informational).
   */
  function evaluateReportSeverity(report, opts) {
    const none = {
      level: 'none',
      urgentCount: 0,
      abnormalCount: 0,
      top: null,
      misprioritised: false,
      unmatched: false,
      reviewCount: 0,
      noGrowthCount: 0,
      reviewTop: null,
      noGrowthTop: null,
      comboCount: 0,
      comboTop: null,
    };

    try {
      if (!report || !Array.isArray(report.results)) return none;

      const results = report.results;
      const priorityDisplay = opts && opts.priorityDisplay ? String(opts.priorityDisplay) : '';
      const resultRules = opts && Array.isArray(opts.resultRules) ? opts.resultRules : [];
      const problems = opts && Array.isArray(opts.problems) ? opts.problems : [];

      let urgentCount = 0;
      let abnormalCount = 0;
      let firstUrgent = null;
      let firstUrgentRuleLabel = null;
      let firstAbnormal = null;
      let firstAbnormalRuleLabel = null;

      // Text-rule tracking (separate from numeric severity)
      let reviewCount = 0;
      let noGrowthCount = 0;
      let reviewTop = null;
      let noGrowthTop = null;

      results.forEach((r) => {
        if (!r || typeof r !== 'object') return;

        // Lab-derived severity
        const labSev = r.urgent ? 'urgent' : r.isAbove || r.isBelow ? 'abnormal' : 'none';

        // Rule-derived severity for numeric (threshold) rules
        const ruleResult = computeRuleSev(r, resultRules, problems);
        const ruleSev = ruleResult.sev;

        // Effective numeric severity: never below lab severity
        const effSev = maxSev(labSev, ruleSev);

        // Was this result's effective severity RAISED by a user/base rule (not the
        // lab flag)? If so, carry the rule's label so the chip can be attributable.
        const ruleDriven = SEV_ORDER[ruleSev] > SEV_ORDER[labSev];
        const ruleLabel = ruleDriven ? ruleResult.label : null;

        if (effSev === 'urgent') {
          urgentCount++;
          if (!firstUrgent) {
            firstUrgent = r;
            firstUrgentRuleLabel = ruleLabel;
          }
        }
        if (effSev === 'abnormal' || effSev === 'urgent') {
          abnormalCount++;
          if (!firstAbnormal) {
            firstAbnormal = r;
            firstAbnormalRuleLabel = ruleLabel;
          }
        }

        // Text-rule outcome — independent, does not affect urgentCount/abnormalCount
        const textResult = computeTextOutcome(r, resultRules);
        if (textResult.outcome === 'review') {
          reviewCount++;
          if (!reviewTop) reviewTop = { name: r.name, label: textResult.label };
        } else if (textResult.outcome === 'noGrowth') {
          noGrowthCount++;
          if (!noGrowthTop) noGrowthTop = { name: r.name, label: textResult.normalLabel };
        }
      });

      // Combo rules (kind:'combo') — evaluated across the whole report, not per result.
      // ESCALATE-ONLY: a fired combo can only raise level, never lower it.
      const combo = computeComboOutcome(report, resultRules, problems);
      const comboCount = combo.comboCount;
      const comboTop = combo.comboTop;

      let level;
      if (urgentCount > 0) {
        level = 'red';
      } else if (abnormalCount > 0 || reviewCount > 0) {
        // review (unclassified culture) escalates to amber; noGrowth does not
        level = 'amber';
      } else {
        level = 'none';
      }

      // Fold in a fired combo (escalate-only). A red combo raises level to 'red';
      // an amber combo raises a 'none' level to at least 'amber'. Never lowers.
      if (comboTop) {
        if (comboTop.level === 'red') {
          level = 'red';
        } else if (level === 'none') {
          level = 'amber';
        }
      }

      // The single most salient analyte for chip display:
      // an urgent result if any; otherwise the first abnormal result.
      const salient = firstUrgent || firstAbnormal || null;
      const salientRuleLabel = firstUrgent ? firstUrgentRuleLabel : firstAbnormalRuleLabel;
      const top = salient
        ? {
            name: salient.name,
            value: salient.value,
            unit: salient.unit,
            ruleLabel: salientRuleLabel || null,
          }
        : null;

      // misprioritised: a lab-/rule-urgent result exists but the queue row priority is NOT
      // high/urgent/immediate. Deliberately keyed on urgentCount (a genuine urgent RESULT),
      // NOT on `level` — so a red COMBO does not flip a report to "misprioritised". A combo
      // is a clinician-authored pattern escalation, not the lab marking the result urgent;
      // treating it as a mis-prioritised lab-urgent result would be a category error and would
      // create false "wrongly routed" flags on every fired red combo.
      const misprioritised = urgentCount > 0 && !/high|urgent|immediate/i.test(priorityDisplay);

      return {
        level,
        urgentCount,
        abnormalCount,
        top,
        misprioritised,
        unmatched: !!report.unmatched,
        reviewCount,
        noGrowthCount,
        reviewTop,
        noGrowthTop,
        comboCount,
        comboTop,
      };
    } catch (_) {
      return none;
    }
  }

  // ── Module export (dual-mode: Node require OR browser global) ───────────────
  const api = { evaluateReportSeverity };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelResultSeverity = api;
  }
})(typeof window !== 'undefined' ? window : global);
