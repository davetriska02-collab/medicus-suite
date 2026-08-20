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

  // ── Whitespace collapse helper (shared by text-rule and combo-rule phrase matching) ──
  // Collapse every run of whitespace (spaces, NEWLINES, tabs) to a single space before
  // phrase matching. Lab reports hard-wrap free text, so a phrase like "no evidence of
  // dysplasia or malignancy" can arrive as "...no evidence\nof dysplasia...". A literal
  // includes() would miss it; normalising both sides makes matches robust to the lab's
  // line wrapping and can never create a spurious match (the words are adjacent anyway).
  function collapseWs(s) {
    return String(s).replace(/\s+/g, ' ');
  }

  // ── Analyte match/exclude/specimen gate (shared by text, threshold, and combo rules) ──
  // Does `result` satisfy an analyte's match criteria?
  //   - analyte.match must be a non-empty array with at least one case-insensitive
  //     substring hit against result.name.
  //   - analyte.exclude (optional) drops a name that also contains an exclude substring
  //     (checked AFTER match — e.g. a "platelet" rule must NOT fire on "Mean platelet
  //     volume", a "haemoglobin" rule must NOT fire on "Haemoglobin A1c"). Same
  //     case-insensitive substring semantics as match.
  //   - analyte.specimen (optional, fail-open) — see specimenAllows above.
  // Returns true iff all three gates pass.
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

  // ── Patient-context gate (item 3.5, TRIAGE-LENS-2026-07-02.md) ───────────────
  // A rule may carry an OPTIONAL `context: { minAge?, maxAge?, sex? }` AND-gate (see
  // result-rules.js header comment + resultRuleSchemaPrompt for the full schema and
  // the FIB-4-over-65 worked example). contextAllows(rule, patientContext) is the
  // SINGLE gate every rule-kind path consults (computeRuleSev, computeTextOutcome,
  // computeDeltaSev, computeComboOutcome) — one place to keep the fail-closed
  // semantics in lock-step across all four kinds.
  //
  // FAIL CLOSED: a rule with NO context clause is always allowed (byte-identical to
  // pre-3.5 behaviour — this is the ONLY path when opts.patientContext is omitted,
  // since zero shipped rules carry a context clause). A rule WITH a context clause is
  // allowed only when patientContext supplies the specific field(s) that clause needs
  // AND they satisfy it; if patientContext is absent, or lacks the needed field, the
  // rule is SKIPPED (never assumed to match, never assumed not to) — exactly like a
  // rule whose analyte simply didn't match this result. Because every result rule is
  // escalate-only, a skipped context rule never suppresses anything; it just does not
  // add its own escalation for this patient/this surface.
  function contextAllows(rule, patientContext) {
    const ctx = rule && rule.context;
    if (!ctx || typeof ctx !== 'object') return true; // no gate → always allowed
    const pc = patientContext && typeof patientContext === 'object' ? patientContext : null;
    const hasMinAge = Number.isFinite(ctx.minAge);
    const hasMaxAge = Number.isFinite(ctx.maxAge);
    if (hasMinAge || hasMaxAge) {
      const age = pc ? pc.ageYears : undefined;
      if (!Number.isFinite(age)) return false; // can't confirm → fail closed
      if (hasMinAge && age < ctx.minAge) return false;
      if (hasMaxAge && age > ctx.maxAge) return false;
    }
    if (typeof ctx.sex === 'string' && ctx.sex) {
      const sex = pc && typeof pc.sex === 'string' ? pc.sex.toLowerCase() : null;
      if (!sex) return false; // can't confirm → fail closed
      if (sex !== ctx.sex.toLowerCase()) return false;
    }
    return true;
  }

  // ── Unit-mismatch guard (item 3.1, TRIAGE-LENS-2026-07-02.md) ────────────────
  // A threshold rule's `unit` field (e.g. "µg/L" on the digoxin-toxicity rule) has
  // historically been DISPLAY-ONLY — the numeric threshold was applied to
  // result.value regardless of what unit the lab actually reported the result in.
  // A digoxin level reported in nmol/L (rather than the rule's µg/L) or a B12
  // reported in pmol/L (rather than ng/L) would silently be graded against the
  // wrong threshold — a confidently-wrong verdict, not merely an imprecise one.
  //
  // unitsCompatible(ruleUnit, resultUnit) classifies the relationship:
  //   'match'    — both units present and recognised as the SAME family.
  //   'mismatch' — both units present and recognised as DIFFERENT families.
  //   'unknown'  — either side is absent/empty, OR the family-fold below leaves
  //                them unequal but neither is confidently "a different unit" —
  //                in practice this only happens for the both-absent case here,
  //                since any two non-empty strings normalise to SOME value and
  //                are then compared directly.
  //
  // Normalisation (before the equality compare): lowercase; ALL whitespace
  // stripped (not merely collapsed — "×10⁹ /L" and "×10⁹/L" must compare equal);
  // trailing dot(s) stripped; µ (MICRO SIGN, U+00B5) and μ (GREEK SMALL LETTER MU,
  // U+03BC) folded to plain 'u' (so "µg/L" and "ug/L" compare equal); superscript
  // digits (⁰¹²³⁴⁵⁶⁷⁸⁹) folded to plain digits (so "×10⁹/L" and "x10^9/L" compare
  // on the same footing, and "1.73m²"/"1.73m2" fold together too). Two lab-notation
  // families found in this repo's own shipped rules/fixtures are then folded to one
  // canonical form each:
  //   - cell-count notation: "×10⁹/L", "x10^9/L", "10^9/L", "10*9/L" (WBC/platelets/
  //     neutrophils) and the "×10¹²/L" family (RBC) — any ×/x/*/^ combination of
  //     "10 to the power N per litre" is the SAME unit however the lab renders the
  //     multiplication sign.
  //   - "micrograms/L" (base-digoxin-toxicity's shipped unit) vs "µg/L" (already
  //     folded to "ug/L" above; base-low-ferritin's shipped unit) — the SAME unit
  //     spelled out vs symbolic; both appear in this repo's own defaults.json for
  //     what is physically the same unit, so a result reported in either spelling
  //     must not falsely mismatch a rule authored in the other.
  //
  // Deliberately NOT folded: 'iu' and 'u' are kept DISTINCT (International Units
  // vs Units are clinically different doses — e.g. TSH mU/L vs U/L must never be
  // treated as interchangeable) even though they read as "nearly the same" string.
  const UNIT_SUPERSCRIPT_DIGITS = {
    '⁰': '0',
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9',
  };
  function normaliseUnitFamily(u) {
    if (typeof u !== 'string') return '';
    let s = u.trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/\s+/g, ''); // ALL whitespace, not merely collapsed
    s = s.replace(/\.+$/, ''); // trailing dot(s)
    s = s.replace(/[µμ]/g, 'u'); // MICRO SIGN + GREEK SMALL LETTER MU → 'u'
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => UNIT_SUPERSCRIPT_DIGITS[c] || c);
    // Cell-count lab notation family: (×|x)?10(^|*)?<digits>/l → canonical '10^<digits>/l'.
    const cellCount = s.match(/^[×x]?10[*^]?(\d+)\/l$/);
    if (cellCount) return '10^' + cellCount[1] + '/l';
    // "micrograms/L" / "microgram/L" spelled out — same unit as the µg/L (→ 'ug/l'
    // above) symbolic form.
    if (s === 'micrograms/l' || s === 'microgram/l') return 'ug/l';
    return s;
  }
  function unitsCompatible(ruleUnit, resultUnit) {
    const a = typeof ruleUnit === 'string' ? ruleUnit.trim() : '';
    const b = typeof resultUnit === 'string' ? resultUnit.trim() : '';
    if (!a || !b) return 'unknown'; // either side absent/empty → can't tell, fail open
    const an = normaliseUnitFamily(a);
    const bn = normaliseUnitFamily(b);
    if (!an || !bn) return 'unknown';
    return an === bn ? 'match' : 'mismatch';
  }

  // ── Unclassified-positive qualitative safety net (Part B, item 3.2,
  // TRIAGE-LENS-2026-07-02.md) ──────────────────────────────────────────────────
  // A non-numeric result carrying an apparently-positive qualitative token — that NO
  // lab flag (isAbove/isBelow/urgent) AND NO text rule classified — otherwise scores
  // 'none' and vanishes entirely (a "Positive" / "Detected" with no authored rule is
  // invisible today: no numeric chip, since the value is non-finite; no text-rule
  // chip, since nothing matched). This surfaces it as an AMBER-MAX "unclassified"
  // finding — a safety net, not a diagnosis: it can never reach red (only an authored,
  // clinician-reviewed text rule with abnormalLevel:'red', see Part A above, can do
  // that), and it is heavily negation-guarded (below) against exactly the "not
  // detected" / "no growth" phrasing that fills a genuinely calm microbiology report.
  //
  // TIGHT lexicon (deliberately short — this must not become a second, uncalibrated
  // rules engine): whole-word, case-insensitive.
  const POSITIVE_QUALITATIVE = [
    'positive',
    'detected',
    'reactive',
    'isolated',
    'abnormal',
    'seen',
    'present',
    'grown',
    'raised',
  ];

  // NEGATION GUARD — replicates content-scripts/triage-lens/rule-match.js's
  // detectQualifier negation check (item 3.4) EXACTLY: a whole-word negator within 6
  // words IMMEDIATELY BEFORE the matched token, in the SAME sentence (sentence
  // boundary = . ! ? or newline). Deliberately REPLICATED here rather than imported:
  // this file (engine/result-severity.js) is loaded EARLIER than rule-match.js in the
  // manifest's content_scripts ordering — result-severity.js sits in the SECOND
  // content_scripts block, rule-match.js is the FIRST file of the THIRD block — so a
  // top-level `global.TriageLensMatch` read here would see `undefined` in the browser
  // world at this file's load time (the two files DO share one JS global object once
  // both blocks have loaded, since both are the default/isolated world, but that's
  // only true from the time rule-match.js finishes executing onward — too late for a
  // load-time import here). This is the SAME "avoid a content-world dep" reasoning
  // this file already applies to result-rules.js (see computeTextOutcome's header
  // comment) — Node tests CAN require() rule-match.js directly (it's dual-mode too),
  // but the browser path cannot rely on load order, so the logic is duplicated for
  // both rather than forked. Flagged in this change's report for the Phase 3 review:
  // keep NEGATORS/the window/sentence-boundary semantics in lock-step with
  // rule-match.js's NEGATORS/detectQualifier if either ever changes.
  //
  // Extends rule-match.js's base negator set (no/not/denies/denied/denying/without/
  // never/nil) with 'none' — a common microbiology negative-culture phrasing ("None
  // isolated") that none of the base words would catch on their own.
  const UNCLASSIFIED_NEGATORS = ['no', 'not', 'denies', 'denied', 'denying', 'without', 'never', 'nil', 'none'];
  const UNCLASSIFIED_NEGATOR_SET = new Set(UNCLASSIFIED_NEGATORS);
  const UNCLASSIFIED_NEGATION_WORD_WINDOW = 6;
  const UNCLASSIFIED_SENTENCE_BOUNDARY = /[.!?\n]/;

  // The start of the sentence containing `index` in `text` — mirrors rule-match.js's
  // sentenceSpan (left side only; this file only ever needs the BEFORE window).
  function unclassifiedSentenceLeft(text, index) {
    if (!UNCLASSIFIED_SENTENCE_BOUNDARY.test(text)) return 0;
    let left = index;
    while (left > 0 && !UNCLASSIFIED_SENTENCE_BOUNDARY.test(text[left - 1])) left--;
    return left;
  }

  // Is the token match starting at `matchIndex` in `text` negated? Whole-word negator
  // among the (up to) 6 words immediately BEFORE the match, within the same sentence —
  // identical mechanics to rule-match.js's detectQualifier negation branch.
  function isUnclassifiedTokenNegated(text, matchIndex) {
    // A glued "non-" / "non " prefix immediately before the token is a negating
    // prefix — "non-reactive", "non reactive" are standard true-NEGATIVE serology
    // results. The word-window scan below misses this because "non" is not a
    // standalone negator (and adding it to the set would over-suppress a distant
    // "non-Hodgkin ... cells seen"), so handle the abutting prefix precisely.
    // Require "non" to be its own word (boundary or string start before it) so
    // "cannon"/"canon" never trip it.
    const prefix = text.slice(Math.max(0, matchIndex - 5), matchIndex);
    if (/(^|[^a-z])non[-\s]$/.test(prefix)) return true;
    const left = unclassifiedSentenceLeft(text, matchIndex);
    const before = text.slice(left, matchIndex);
    const words = before.split(/\s+/).filter(Boolean);
    const window = words.slice(-UNCLASSIFIED_NEGATION_WORD_WINDOW);
    for (let i = window.length - 1; i >= 0; i--) {
      // Strip surrounding punctuation so "no," / "(no" still match, but "notable"/
      // "nothing" — real words that merely CONTAIN a negator — never do (whole-word
      // discipline, same as rule-match.js).
      const clean = window[i].replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (UNCLASSIFIED_NEGATOR_SET.has(clean)) return true;
    }
    return false;
  }

  // matchUnclassifiedPositive(result) → matched token string | null
  // Scans the result's value string (rawValue) + interpretation + combined text for a
  // POSITIVE_QUALITATIVE token, negation-guarded by isUnclassifiedTokenNegated above.
  // The three sources are joined with an explicit sentence break ('. ') so a negation
  // in one source can never reach across into another (the raw value string and the
  // free text are distinct statements). Whitespace is collapsed first so a token or
  // negator split across a lab line-wrap still matches (same rationale as
  // computeTextOutcome's collapseWs). Scans the lexicon in its declared order, then
  // left-to-right through the text for each token, returning the FIRST occurrence (of
  // any token) that is NOT negated — a later, un-negated positive ("...not detected
  // for chlamydia. Gonorrhoea detected.") is still found even when an earlier
  // occurrence of the same word was negated. Returns null when every occurrence of
  // every lexicon token is negated, or none appear at all. Pure — never consulted
  // unless the caller has already confirmed the result is non-numeric, lab-unflagged,
  // and untouched by any text rule (see evaluateReportSeverity's gate).
  function matchUnclassifiedPositive(result) {
    if (!result || typeof result !== 'object') return null;
    const parts = [];
    if (typeof result.rawValue === 'string') parts.push(result.rawValue);
    if (typeof result.interpretation === 'string') parts.push(result.interpretation);
    if (typeof result.text === 'string') parts.push(result.text);
    const combined = collapseWs(parts.join('. '));
    if (!combined.trim()) return null;
    const lower = combined.toLowerCase();
    for (let t = 0; t < POSITIVE_QUALITATIVE.length; t++) {
      const token = POSITIVE_QUALITATIVE[t];
      const re = new RegExp('\\b' + token + '\\b', 'g');
      let m;
      while ((m = re.exec(lower))) {
        if (!isUnclassifiedTokenNegated(lower, m.index)) return token;
      }
    }
    return null;
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
  //   abnormalLevel — Part A (item 3.2, TRIAGE-LENS-2026-07-02.md): a fired abnormalText
  //                  rule carries an optional abnormalLevel ('amber' default | 'red'). The
  //                  returned `level` is 'red' when ANY fired abnormalText rule declared
  //                  'red', otherwise 'amber' for a review outcome (null when the outcome is
  //                  not a review). Escalate-only — the caller lifts the report to red on a
  //                  red review, never lowers anything.
  //   applied      — Part B support: true iff SOME text rule's analyte matched this result
  //                  (even a lone-abnormalText rule that found no flag phrase, i.e. outcome
  //                  'none' but the analyte WAS seen). The unclassified-positive fall-through
  //                  pass (evaluateReportSeverity) uses this to leave alone any result a text
  //                  rule already covers. A rule skipped by the context gate (item 3.5) is
  //                  NOT "seen" — it counts as though its analyte never matched, so it can
  //                  never mark `applied` true and can never block the unclassified fallback.
  //   `patientContext` (optional, item 3.5) — gates any rule carrying a `context` clause,
  //                  see contextAllows above. Fail closed when absent/insufficient.
  function computeTextOutcome(result, rules, patientContext) {
    if (!Array.isArray(rules) || rules.length === 0) {
      return { outcome: 'none', label: null, normalLabel: null, level: null, applied: false };
    }
    if (!result || typeof result !== 'object') {
      return { outcome: 'none', label: null, normalLabel: null, level: null, applied: false };
    }

    // Collapse every run of whitespace (spaces, NEWLINES, tabs) to a single space before
    // phrase matching. Lab reports hard-wrap free text, so a phrase like "no evidence of
    // dysplasia or malignancy" can arrive as "...no evidence\nof dysplasia...". A literal
    // includes() would miss it — calming a benign result fails (false amber), and worse, an
    // abnormalText flag phrase split across a line break would silently NOT fire (false
    // negative). Normalising both sides makes matches robust to the lab's line wrapping;
    // it can never create a spurious match (the words are adjacent in the sentence anyway).
    // (collapseWs is the shared helper defined above.)
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
    let abnormalRedLabel = null; // label of the first RED-level abnormalText rule that fired
    let abnormalIsRed = false; // Part A — a fired abnormalText rule declared abnormalLevel:'red'
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

      // Patient-context gate (item 3.5) — skip a context-gated rule that patientContext
      // cannot confirm applies. Fail closed, checked before the analyte match so a
      // context-skipped rule is treated exactly like a non-matching analyte (never
      // marks `applied`).
      if (!contextAllows(rule, patientContext)) continue;

      // Does this rule apply to this result? (match / exclude / specimen gate — shared
      // helper, see analyteMatches above.)
      if (!analyteMatches(analyte, result)) continue;

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
          // Part A (item 3.2) — a fired abnormalText rule may declare abnormalLevel:'red'
          // to escalate the report to RED (default 'amber' = historic amber-cap). If ANY
          // fired abnormalText rule is red, the outcome is red; the red rule's own label
          // is preferred for attribution so the chip names the red finding.
          const isRed = rule.abnormalLevel === 'red';
          if (isRed) {
            abnormalIsRed = true;
            if (!abnormalRedLabel) {
              abnormalRedLabel = (typeof rule.label === 'string' && rule.label) || 'Needs review';
            }
          }
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

    if (!anyRuleApplied) return { outcome: 'none', label: null, normalLabel: null, level: null, applied: false };
    // Precedence: an explicit abnormalText flag wins over a normal phrase (never calm a
    // positively-flagged finding); a normal phrase calms; otherwise a "not clearly normal"
    // normalText rule reviews; a lone abnormalText rule that did not match stays none.
    if (abnormalFound) {
      const label = abnormalIsRed
        ? abnormalRedLabel || abnormalLabel || 'Needs review'
        : abnormalLabel || 'Needs review';
      return { outcome: 'review', label, normalLabel: null, level: abnormalIsRed ? 'red' : 'amber', applied: true };
    }
    if (normalFound)
      return { outcome: 'noGrowth', label: null, normalLabel: normalLabel || 'No growth', level: null, applied: true };
    // A normalText-driven review ("not clearly normal") is always amber — abnormalLevel:'red'
    // only ever escalates a POSITIVE abnormalText flag, never the calm-set-absent review.
    if (reviewLabel) return { outcome: 'review', label: reviewLabel, normalLabel: null, level: 'amber', applied: true };
    return { outcome: 'none', label: null, normalLabel: null, level: null, applied: true };
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
  // Uses minimal inline guards only. Returns { sev, label, comparator, threshold }:
  //   sev        — 'none' | 'abnormal' | 'urgent' (highest a matching rule produced)
  //   label      — the label of the rule that produced `sev` (for attributable chips), or null.
  //   comparator — ADDITIVE (item 2.2, TRIAGE-LENS-2026-07-02.md): the winning rule's
  //                'above'/'below' comparator, or null. Display-only — read by the queue
  //                detail popover to render a threshold summary ("red ≥6.5"); never
  //                consumed by grading itself, so it cannot change what fires.
  //   threshold  — ADDITIVE (item 2.2): the specific numeric threshold (red or amber,
  //                whichever produced `sev`) that was crossed, or null. Same
  //                display-only status as `comparator`.
  //   ruleId     — ADDITIVE (item 2.7, TRIAGE-LENS-2026-07-02.md): the winning rule's
  //                `id`, or null. Display-only, same status as comparator/threshold —
  //                lets the queue detail popover look up that rule's `actions` (e.g. a
  //                local hyperkalaemia pathway link) from CONFIG.resultRules at RENDER
  //                time, not grading time, so an edited rule's actions apply
  //                immediately with no cache invalidation needed.
  //   unitMismatches — ADDITIVE (item 3.1, TRIAGE-LENS-2026-07-02.md): array of
  //                { ruleId, ruleLabel, ruleUnit } — one entry per rule that matched
  //                this result's analyte but was SKIPPED (no grade contributed)
  //                because its declared unit conflicted with the result's reported
  //                unit (unitsCompatible === 'mismatch'). Display-only; the caller
  //                (evaluateReportSeverity) folds these into the report-level
  //                `unitMismatches` array. Never affects sev/label/comparator/threshold.
  // `problems` (optional) is the patient's problem list for suppressIfProblem rules.
  // `patientContext` (optional, item 3.5) — { ageYears?, sex? } — gates any rule
  // carrying a `context` clause via contextAllows above; absent/undefined means every
  // context-gated rule is skipped (fail closed), matching pre-3.5 behaviour exactly
  // when no rule has a context clause.
  function computeRuleSev(result, rules, problems, patientContext) {
    const NONE = { sev: 'none', label: null, comparator: null, threshold: null, ruleId: null, unitMismatches: [] };
    if (!Array.isArray(rules) || rules.length === 0) return NONE;
    if (!result || typeof result !== 'object') return NONE;

    const value = result.value;
    if (!Number.isFinite(value)) return NONE;

    let best = 'none';
    let bestLabel = null;
    let bestComparator = null;
    let bestThreshold = null;
    let bestRuleId = null;
    const unitMismatches = [];

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

      // Patient-context gate (item 3.5) — a rule with a context clause is skipped
      // unless patientContext confirms it applies. Fail closed.
      if (!contextAllows(rule, patientContext)) continue;

      // Check if this analyte matches the result (match / exclude / specimen gate —
      // shared helper, see analyteMatches above).
      if (!analyteMatches(analyte, result)) continue;

      // Unit-mismatch guard (item 3.1) — a rule that declares a unit is SKIPPED for
      // this result (no grade contributed) when the result's own reported unit is
      // present and recognised as a DIFFERENT unit family (unitsCompatible above).
      // Fail-OPEN in every other case ('unknown' — either side has no unit; Medicus
      // often omits the result unit, and a naive guard would mass-suppress rules
      // that have never been wrong). The skip is recorded (display-only) so the
      // queue/popover/banner can surface it — see evaluateReportSeverity below.
      if (rule.unit && unitsCompatible(rule.unit, result.unit) === 'mismatch') {
        unitMismatches.push({
          ruleId: (typeof rule.id === 'string' && rule.id) || null,
          ruleLabel: (typeof rule.label === 'string' && rule.label) || null,
          ruleUnit: rule.unit,
        });
        continue;
      }

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
        bestComparator = rule.comparator;
        bestThreshold = ruleSev === 'urgent' ? red : amber;
        bestRuleId = (typeof rule.id === 'string' && rule.id) || null;
      }
      if (best === 'urgent') break; // can't go higher
    }

    return {
      sev: best,
      label: bestLabel,
      comparator: bestComparator,
      threshold: bestThreshold,
      ruleId: bestRuleId,
      unitMismatches,
    };
  }

  // ── Extract the most recent PRIOR numeric value for trend display (item 2.6,
  // TRIAGE-LENS-2026-07-02.md) ────────────────────────────────────────────────
  // Pure, display-only — never consumed by grading. Looks at `result.history`
  // (already built newest-first by normaliseInvestigationReport) and returns the
  // most recent entry with a finite numeric value, PROVIDED its unit matches the
  // current result's unit (via unitsCompatible, item 3.1's shared normalisation)
  // or both are absent.
  //
  // Deliberately conservative: uses the SAME unitsCompatible() family-normalisation
  // as the grading guard above (so "×10⁹/L" history against a "x10^9/L" current
  // result is recognised as the same family rather than spuriously blocking the
  // arrow) but keeps its OWN, stricter, comparability rule on top: only a 'match'
  // (both units present and equal-family) OR 'unknown'-because-BOTH-absent counts
  // as comparable. "One side has a unit, the other doesn't" is NEVER treated as
  // comparable here (unlike a grading rule, which fails open on a bare-absent
  // side) — a trend arrow drawn across an assumed-same-but-unconfirmed unit would
  // be actively misleading, so silence is the safe failure mode for a display-only
  // arrow. This preserves extractPrior's exact prior behaviour byte-for-byte.
  // Returns { value, date, dir } | null, where dir is 'up' | 'down' | 'same'
  // (current vs prior, epsilon-compared).
  function normaliseUnitForCompare(u) {
    return typeof u === 'string' ? u.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  }
  // Shared "is a prior value comparable to the current one" classifier, factored out
  // so both extractPrior (above, display-only trend arrow) and the delta-rule engine
  // (item 3.6, below) apply the EXACT same strict comparability rule:
  //   'match'      — both units present and the same family (unitsCompatible 'match').
  //   'bothAbsent' — neither side carries a unit — treated as comparable (there was
  //                  nothing to conflict with).
  //   'oneAbsent'  — exactly one side carries a unit — NEVER treated as comparable
  //                  (a guess across an unconfirmed unit would be misleading).
  //   'mismatch'   — both present, recognised as DIFFERENT unit families.
  function priorUnitRelation(resultUnit, priorUnit) {
    const rel = unitsCompatible(resultUnit, priorUnit);
    const bothAbsent = !normaliseUnitForCompare(resultUnit) && !normaliseUnitForCompare(priorUnit);
    if (rel === 'mismatch') return 'mismatch';
    if (rel === 'unknown') return bothAbsent ? 'bothAbsent' : 'oneAbsent';
    return 'match';
  }
  function extractPrior(result) {
    if (!result || typeof result !== 'object') return null;
    if (!Number.isFinite(result.value)) return null;
    if (!Array.isArray(result.history) || result.history.length === 0) return null;
    // history is newest-first (normaliseInvestigationReport sorts it); the first
    // entry with a finite value IS the most recent prior numeric value.
    const priorEntry = result.history.find((h) => h && Number.isFinite(h.value));
    if (!priorEntry) return null;
    const rel = priorUnitRelation(result.unit, priorEntry.unit);
    if (rel === 'mismatch' || rel === 'oneAbsent') return null; // never a guess across units
    const EPS = 1e-9;
    const diff = result.value - priorEntry.value;
    const dir = Math.abs(diff) < EPS ? 'same' : diff > 0 ? 'up' : 'down';
    return { value: priorEntry.value, date: priorEntry.date || null, dir };
  }

  // ── Delta/trend rule grading (item 3.6, TRIAGE-LENS-2026-07-02.md) ────────────
  // Grades on CHANGE over time rather than the current absolute value: rising
  // creatinine (AKI), falling Hb (bleed), rising K+. Builds directly on extractPrior's
  // history-walk and priorUnitRelation's comparability rule above, and on
  // unitsCompatible (item 3.1).
  //
  // daysBetween(dateA, dateB) — both 'YYYY-MM-DD' (normaliseDateString's output
  // shape). Returns the absolute integer day difference, or null if either date is
  // missing/unparseable. UTC-based (no local-timezone drift on the date boundary).
  function daysBetween(dateA, dateB) {
    if (typeof dateA !== 'string' || typeof dateB !== 'string') return null;
    const ma = dateA.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const mb = dateB.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!ma || !mb) return null;
    const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
    const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
    return Math.round(Math.abs(ta - tb) / 86400000);
  }

  // Most-recent history entry with a finite value (mirrors extractPrior's own
  // walk) — returned WITH its unit and date so the delta engine can apply its own
  // unit-comparability and maxDays gates on top. Does not itself judge
  // comparability (the caller does, via priorUnitRelation) — kept separate so a
  // 'mismatch' can be distinguished from a silent 'oneAbsent' for unitMismatches
  // recording.
  function findMostRecentNumericPrior(result) {
    if (!result || typeof result !== 'object') return null;
    if (!Array.isArray(result.history) || result.history.length === 0) return null;
    const priorEntry = result.history.find((h) => h && Number.isFinite(h.value));
    if (!priorEntry) return null;
    return { value: priorEntry.value, date: priorEntry.date || null, unit: priorEntry.unit || null };
  }

  // Round a computed change to 2dp for display, stripping float noise
  // (e.g. 37.99999999999998 → 38) without hiding a genuine fractional change.
  function roundDeltaMagnitude(n) {
    return Math.round(n * 100) / 100;
  }

  // formatDeltaSummary(change, usePercent, currentDate, priorDate) → e.g.
  // '+38 in 5 days' (by) or '+18% in 5 days' (byPercent), or the magnitude alone
  // when the day count can't be determined ('-22'). `change` is SIGNED (positive
  // for a rise, negative for a fall); the sign is carried by the number itself,
  // so only a rise gets an explicit '+' prefix.
  function formatDeltaSummary(change, usePercent, currentDate, priorDate) {
    const rounded = roundDeltaMagnitude(change);
    const sign = rounded > 0 ? '+' : '';
    const magStr = sign + String(rounded) + (usePercent ? '%' : '');
    const days = daysBetween(currentDate, priorDate);
    if (days === null) return magStr;
    return magStr + ' in ' + days + ' day' + (days === 1 ? '' : 's');
  }

  // computeDeltaSev(rule, result) — parallel to computeRuleSev, but for ONE
  // kind:'delta' rule against ONE result (the aggregate-across-all-delta-rules
  // loop, mirroring computeRuleSev's own multi-rule loop, lives in
  // computeDeltaSevForResult below — same split as every other per-rule vs
  // per-result-across-rules pairing in this file).
  //
  // Returns { sev, label, direction, ruleThreshold, ruleId, deltaSummary, unitMismatches }:
  //   sev            — 'none' | 'abnormal' | 'urgent'.
  //   label          — the rule's label when sev !== 'none', else null.
  //   direction      — 'rise' | 'fall' (the OBSERVED direction of the fired change,
  //                    never 'either' — that is only ever the rule's CONFIGURATION).
  //                    Deliberately reuses the same slot/shape as computeRuleSev's
  //                    `comparator` so content.js's existing rule-attribution
  //                    rendering (flag arrow, threshold-summary composition) can
  //                    treat it uniformly — see composeRuleThresholdLabel/flagFor
  //                    in content.js, which special-case 'rise'/'fall' alongside
  //                    'above'/'below'.
  //   ruleThreshold  — the winning amber/red magnitude that was crossed.
  //   ruleId         — the rule's `id`, for the popover's actions lookup (item 2.7).
  //   deltaSummary   — ready-to-render change summary e.g. '+38 in 5 days' (item
  //                    3.6's popover line), or null when sev === 'none'.
  //   unitMismatches — array of { ruleId, ruleLabel, ruleUnit } — populated ONLY on
  //                    a genuine unit MISMATCH (both result and prior carry a unit,
  //                    recognised as different families); mirrors computeRuleSev's
  //                    shape/semantics. The "one side has no unit" case is never
  //                    recorded here (nothing confidently wrong to report — see
  //                    priorUnitRelation above), matching 3.1's own precedent of
  //                    only recording an ACTUAL mismatch, never an absence.
  // `patientContext` (optional, item 3.5) — gates a rule carrying a `context` clause,
  // see contextAllows above. Fail closed when absent/insufficient.
  function computeDeltaSev(rule, result, patientContext) {
    const NONE = {
      sev: 'none',
      label: null,
      direction: null,
      ruleThreshold: null,
      ruleId: null,
      deltaSummary: null,
      unitMismatches: [],
    };
    if (!rule || typeof rule !== 'object') return NONE;
    if ((rule.kind || 'threshold') !== 'delta') return NONE;
    if (rule.enabled === false) return NONE;
    const analyte = rule.analyte;
    if (!analyte || !Array.isArray(analyte.match) || analyte.match.length === 0) return NONE;
    if (rule.direction !== 'rise' && rule.direction !== 'fall' && rule.direction !== 'either') return NONE;
    if (!result || typeof result !== 'object') return NONE;
    if (!Number.isFinite(result.value)) return NONE;
    if (!contextAllows(rule, patientContext)) return NONE;
    if (!analyteMatches(analyte, result)) return NONE;

    const prior = findMostRecentNumericPrior(result);
    if (!prior) return NONE; // no history → never fires (nothing to compare against)

    const ruleId = (typeof rule.id === 'string' && rule.id) || null;
    const ruleLabel = (typeof rule.label === 'string' && rule.label) || null;

    // Unit guard (item 3.1's shared unitsCompatible, item 2.6's strict "one-absent
    // is never a guess" comparability rule) — see priorUnitRelation above.
    const rel = priorUnitRelation(result.unit, prior.unit);
    if (rel === 'mismatch') {
      return {
        ...NONE,
        unitMismatches: [{ ruleId, ruleLabel, ruleUnit: prior.unit || null }],
      };
    }
    if (rel === 'oneAbsent') return NONE; // never a guess across an unconfirmed unit; nothing to record

    // maxDays — OPTIONAL. Fail CLOSED (no delta) when configured and either date is
    // unavailable: an unknown age could be exactly the "2-year-old value" this
    // guard exists to exclude. Only checks the SAME most-recent prior found above —
    // never falls back to an older-but-in-range history entry.
    if (Number.isFinite(rule.maxDays) && rule.maxDays > 0) {
      const days = daysBetween(result.date, prior.date);
      if (days === null || days > rule.maxDays) return NONE;
    }

    const usePercent = rule.byPercent === true;
    let change;
    if (usePercent) {
      if (prior.value === 0) return NONE; // no meaningful % change from a zero baseline
      change = ((result.value - prior.value) / Math.abs(prior.value)) * 100;
    } else {
      change = result.value - prior.value;
    }

    const observedDir = change > 0 ? 'rise' : change < 0 ? 'fall' : 'same';
    if (observedDir === 'same') return NONE; // no change at all never fires
    if (rule.direction !== 'either' && observedDir !== rule.direction) return NONE;

    const magnitude = Math.abs(change);
    const amber = rule.amber;
    const red = rule.red;
    let sev = 'none';
    let threshold = null;
    if (Number.isFinite(red) && magnitude >= red) {
      sev = 'urgent';
      threshold = red;
    } else if (Number.isFinite(amber) && magnitude >= amber) {
      sev = 'abnormal';
      threshold = amber;
    }
    if (sev === 'none') return NONE;

    return {
      sev,
      label: ruleLabel,
      direction: observedDir,
      ruleThreshold: threshold,
      ruleId,
      deltaSummary: formatDeltaSummary(change, usePercent, result.date, prior.date),
      unitMismatches: [],
    };
  }

  // computeDeltaSevForResult(result, rules, problems) — aggregate across ALL
  // kind:'delta' rules for one result, keeping the highest severity (mirrors
  // computeRuleSev's own multi-rule loop exactly, including the suppressIfProblem
  // gate and the urgent-short-circuit). Collects unitMismatches from every rule
  // tried, not just the winner (same as computeRuleSev).
  // `patientContext` (optional, item 3.5) — threaded through to computeDeltaSev for
  // each candidate rule.
  function computeDeltaSevForResult(result, rules, problems, patientContext) {
    const NONE = {
      sev: 'none',
      label: null,
      direction: null,
      ruleThreshold: null,
      ruleId: null,
      deltaSummary: null,
      unitMismatches: [],
    };
    if (!Array.isArray(rules) || rules.length === 0) return NONE;
    if (!result || typeof result !== 'object') return NONE;

    let best = NONE;
    const unitMismatches = [];

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') continue;
      if ((rule.kind || 'threshold') !== 'delta') continue;
      if (rule.enabled === false) continue;
      if (ruleSuppressedByProblems(rule, problems)) continue;

      const out = computeDeltaSev(rule, result, patientContext);
      if (Array.isArray(out.unitMismatches) && out.unitMismatches.length) {
        out.unitMismatches.forEach((m) => unitMismatches.push(m));
      }
      if (SEV_ORDER[out.sev] > SEV_ORDER[best.sev]) {
        best = out;
      }
      if (best.sev === 'urgent') break; // can't go higher
    }

    return { ...best, unitMismatches };
  }

  // ── Compute combo-rule outcome across a whole report ──────────────────────────
  // Handles rules with kind === 'combo'. A combo fires when EVERY one of its
  // conditions is satisfied by SOME result in the report (each condition may be met
  // by a DIFFERENT result row). Combos are ESCALATE-ONLY: they raise the report level
  // to their `level` (default 'amber'), never lower it, never calm/suppress.
  // Deliberately self-contained (no result-rules.js import) — mirrors computeTextOutcome.
  //
  // Returns { comboCount, comboTop, unitMismatches } where:
  //   comboCount — number of combo rules that fired
  //   comboTop   — { label, level } of the FIRST fired combo, or null.
  //   unitMismatches — ADDITIVE (item 3.1) — array of { name, resultUnit, ruleId,
  //                    ruleLabel, ruleUnit }, mirroring computeRuleSev's. A numeric
  //                    condition that declares an (optional) `unit` is skipped
  //                    against a candidate result whose reported unit conflicts
  //                    with it, same unitsCompatible guard as computeRuleSev. No
  //                    shipped combo condition carries a `unit` field today (see
  //                    options.js buildComboCondition) — this only activates if/
  //                    when one is added, so it changes nothing for any combo rule
  //                    currently shipped.
  //
  // Numeric condition value access reuses the EXACT computeRuleSev guard
  // (Number.isFinite(result.value)); a non-finite value never satisfies a numeric
  // condition (fail-safe — the combo will not fire on missing data).
  // `patientContext` (optional, item 3.5) — gates a combo rule carrying a top-level
  // `context` clause, see contextAllows above. Fail closed when absent/insufficient.
  function computeComboOutcome(report, rules, problems, patientContext) {
    const NONE = { comboCount: 0, comboTop: null, unitMismatches: [] };
    if (!report || !Array.isArray(report.results)) return NONE;
    if (!Array.isArray(rules) || rules.length === 0) return NONE;
    const results = report.results;

    // (collapseWs, analyteMatches are the shared helpers defined above.)
    const unitMismatches = [];

    // Is a single condition satisfied by SOME result in the report?
    function conditionSatisfied(cond, rule) {
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
          // Unit-mismatch guard (item 3.1) — same semantics as computeRuleSev:
          // fail-open unless the condition declares a unit AND it conflicts with
          // this result's reported unit.
          if (cond.unit && unitsCompatible(cond.unit, r.unit) === 'mismatch') {
            unitMismatches.push({
              name: r.name,
              resultUnit: r.unit || null,
              ruleId: (typeof rule.id === 'string' && rule.id) || null,
              ruleLabel: (typeof rule.label === 'string' && rule.label) || null,
              ruleUnit: cond.unit,
            });
            return false;
          }
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
      // Patient-context gate (item 3.5) — fail closed.
      if (!contextAllows(rule, patientContext)) continue;

      // Every condition must be satisfied by some result (AND).
      const allSatisfied = conditions.every((cond) => conditionSatisfied(cond, rule));
      if (!allSatisfied) continue;

      comboCount++;
      if (!comboTop) {
        const level = rule.level === 'red' ? 'red' : 'amber';
        const label = (typeof rule.label === 'string' && rule.label) || 'Combination alert';
        comboTop = { label, level };
      }
    }

    return { comboCount, comboTop, unitMismatches };
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
   * @param {object} [opts.patientContext]   ADDITIVE (item 3.5, TRIAGE-LENS-2026-07-02.md):
   *                                         { ageYears?, sex? }. Gates any rule carrying a
   *                                         `context` clause (result-rules.js) via
   *                                         contextAllows — FAIL CLOSED: a context-gated rule
   *                                         is skipped (never fires) unless this supplies the
   *                                         field(s) that clause needs. Omitted by default;
   *                                         since zero shipped rules carry a context clause,
   *                                         omitting it (or passing undefined) is
   *                                         byte-identical to pre-3.5 behaviour.
   *
   * top.ruleLabel — when the salient result's severity was RAISED by a rule (not the lab
   * flag), this carries that rule's label so the queue can render an attributable chip.
   * top.prior — ADDITIVE (item 2.6, TRIAGE-LENS-2026-07-02.md): { value, date, dir } |
   *             null from extractPrior(salient) — display-only trend data for the salient
   *             result's chip arrow. Never affects grading.
   *
   * flagged — ADDITIVE (item 2.2, TRIAGE-LENS-2026-07-02.md), display-only: an array of
   * per-result attribution entries, one per result whose effective severity is 'urgent'
   * or 'abnormal' (in report order), for the queue detail popover. Each entry:
   *   { index, name, value, unit, low, high, date, effSev, isAbove, isBelow, urgent,
   *     ruleLabel, ruleComparator, ruleThreshold, ruleId, deltaSummary, prior }
   * `index` is the result's position in report.results (for cross-referencing back to
   * the full normalised result, e.g. its .history). ruleLabel/ruleComparator/
   * ruleThreshold/ruleId are only set when a rule (not the lab flag) drove this result's
   * severity — same ruleDriven gate as top.ruleLabel. ruleId is ADDITIVE (item 2.7): the
   * winning rule's `id`, purely for the popover to look up that rule's `actions` from
   * CONFIG.resultRules by id at render time — it never feeds grading. `deltaSummary` is
   * ADDITIVE (item 3.6, TRIAGE-LENS-2026-07-02.md): a ready-to-render change summary e.g.
   * '+38 in 5 days', set ONLY when a kind:'delta' rule (computeDeltaSevForResult, not a
   * kind:'threshold' rule) drove this result's severity — null otherwise (i.e. on every
   * flagged entry today, since zero delta rules ship in defaults.json). When a delta rule
   * drives severity, `ruleComparator` carries the OBSERVED direction ('rise'/'fall')
   * instead of a threshold rule's 'above'/'below' — content.js's rendering treats the two
   * uniformly (see composeRuleThresholdLabel/flagFor). `prior` is extractPrior(result).
   * This field is purely descriptive: it does not feed level/urgentCount/abnormalCount/top,
   * all of which are computed exactly as before.
   * unitMismatches — ADDITIVE (item 3.1, TRIAGE-LENS-2026-07-02.md), display-only: an
   * array of { name, resultUnit, ruleId, ruleLabel, ruleUnit }, one entry per (result,
   * rule) pair where a threshold rule (computeRuleSev) or a combo numeric condition
   * (computeComboOutcome) matched the result's analyte but was SKIPPED — no grade
   * contributed — because the rule's declared unit conflicted with the result's
   * reported unit (unitsCompatible === 'mismatch'; exported, see below). Deduped per
   * (result, rule). NEVER changes level/urgentCount/abnormalCount/top/flagged/
   * comboCount/comboTop — grading of everything else is byte-identical to before this
   * field existed. Surfaced by content.js as a "unit?" meta chip + popover/banner
   * lines, never as a severity change.
   * reviewTop — now carries a `level` ('amber' | 'red'). Part A (item 3.2): a text rule
   * whose fired abnormalText declared abnormalLevel:'red' produces a red review; reviewTop
   * is promoted to that red review (even if an amber review was seen first), and the report
   * `level` is escalated to red. redReviewCount drives the escalation but is intentionally
   * kept OUT of urgentCount / misprioritised (a lab-urgent-only concept).
   *
   * unclassified — ADDITIVE (Part B, item 3.2), display-only: an array of
   * { name, token } — one entry per result with NO finite numeric value, NO lab flag
   * (isAbove/isBelow/urgent all false), and untouched by any text rule (no rule's
   * analyte both matched AND produced a classification), whose combined text carries a
   * POSITIVE_QUALITATIVE token past the negation guard (matchUnclassifiedPositive).
   * These results would otherwise score 'none' and vanish entirely — no numeric chip
   * (non-finite value), no text-rule chip (nothing matched). Escalate-only to (at most)
   * amber — never red; an uncharacterised free-text hit can be flagged for a look, not
   * graded. Surfaced by content.js as a distinct "unclassified" amber chip (never the
   * same fill as a lab-confirmed abnormal) plus popover/banner lines naming the analyte
   * and the matched token.
   *
   * @returns {{ level, urgentCount, abnormalCount, top, misprioritised, unmatched,
   *             reviewCount, noGrowthCount, reviewTop, noGrowthTop, comboCount, comboTop,
   *             flagged, unitMismatches, unclassified }}
   *
   * `level` is 'none' | 'amber' | 'red' | 'error'. 'error' means evaluation threw —
   * callers MUST treat it as "couldn't check", never as all-clear. Lab-filing
   * and the queue chip both fail closed on it.
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
      flagged: [],
      unitMismatches: [],
      unclassified: [],
    };

    try {
      if (!report || !Array.isArray(report.results)) return none;

      const results = report.results;
      const priorityDisplay = opts && opts.priorityDisplay ? String(opts.priorityDisplay) : '';
      const resultRules = opts && Array.isArray(opts.resultRules) ? opts.resultRules : [];
      const problems = opts && Array.isArray(opts.problems) ? opts.problems : [];
      // ADDITIVE (item 3.5) — undefined by default (fail closed for every
      // context-gated rule; a no-op when no rule carries a context clause).
      const patientContext =
        opts && opts.patientContext && typeof opts.patientContext === 'object' ? opts.patientContext : undefined;

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
      // Part A (item 3.2) — count of red-level text reviews. A red text review escalates
      // the whole report to red (below), deliberately WITHOUT touching urgentCount (and
      // therefore without touching `misprioritised`, which is a lab-urgent concept).
      let redReviewCount = 0;

      // Part B (item 3.2) — unclassified qualitative positives (see
      // matchUnclassifiedPositive). One entry per qualifying result, in report order.
      const unclassified = [];

      // ADDITIVE (item 2.2) — per-result attribution for the queue detail popover.
      // Populated alongside the existing loop below; does not influence any of the
      // existing counters/tops.
      const flagged = [];

      // ADDITIVE (item 3.1) — raw (not-yet-deduped) unit-mismatch entries collected
      // from computeRuleSev (per result, below) and computeComboOutcome (report-wide,
      // after the loop). Deduped into the final `unitMismatches` just before return.
      const rawUnitMismatches = [];

      results.forEach((r, i) => {
        if (!r || typeof r !== 'object') return;

        // Lab-derived severity
        const labSev = r.urgent ? 'urgent' : r.isAbove || r.isBelow ? 'abnormal' : 'none';

        // Rule-derived severity for numeric (threshold) rules
        const ruleResult = computeRuleSev(r, resultRules, problems, patientContext);
        const ruleSev = ruleResult.sev;

        // ADDITIVE (item 3.6) — rule-derived severity for delta/trend rules
        // (kind:'delta'), aggregated across every delta rule matching this
        // result. Escalate-only, exactly like computeRuleSev: folded into effSev
        // below via the SAME maxSev pattern, never lowers labSev or ruleSev.
        const deltaResult = computeDeltaSevForResult(r, resultRules, problems, patientContext);
        const deltaSev = deltaResult.sev;

        // ADDITIVE (item 3.1) — fold this result's skipped-rule unit mismatches
        // (display-only; computeRuleSev/computeDeltaSevForResult already excluded
        // them from grading) into the report-level list.
        if (Array.isArray(ruleResult.unitMismatches) && ruleResult.unitMismatches.length) {
          ruleResult.unitMismatches.forEach((m) => {
            rawUnitMismatches.push({
              name: r.name,
              resultUnit: r.unit || null,
              ruleId: m.ruleId,
              ruleLabel: m.ruleLabel,
              ruleUnit: m.ruleUnit,
            });
          });
        }
        if (Array.isArray(deltaResult.unitMismatches) && deltaResult.unitMismatches.length) {
          deltaResult.unitMismatches.forEach((m) => {
            rawUnitMismatches.push({
              name: r.name,
              resultUnit: r.unit || null,
              ruleId: m.ruleId,
              ruleLabel: m.ruleLabel,
              ruleUnit: m.ruleUnit,
            });
          });
        }

        // Combine threshold-rule and delta-rule outcomes: whichever produced the
        // HIGHER severity attributes the chip (ties favour the threshold-rule
        // result, so a report with NO delta rules configured — every report today,
        // since zero delta rules ship in defaults.json — is byte-identical to
        // before this field existed).
        const combinedSev = SEV_ORDER[deltaSev] > SEV_ORDER[ruleSev] ? deltaResult : ruleResult;
        const bestRuleSev = SEV_ORDER[deltaSev] > SEV_ORDER[ruleSev] ? deltaSev : ruleSev;

        // Effective numeric severity: never below lab severity
        const effSev = maxSev(labSev, bestRuleSev);

        // Was this result's effective severity RAISED by a user/base rule (not the
        // lab flag)? If so, carry the rule's label so the chip can be attributable.
        const ruleDriven = SEV_ORDER[bestRuleSev] > SEV_ORDER[labSev];
        const ruleLabel = ruleDriven ? combinedSev.label : null;
        // The delta path's `direction` ('rise'/'fall') doubles as computeRuleSev's
        // `comparator` slot ('above'/'below') for downstream chip/popover
        // rendering — see computeDeltaSev's doc comment above.
        const ruleComparator = ruleDriven ? combinedSev.comparator || combinedSev.direction || null : null;
        const ruleThreshold = ruleDriven ? (combinedSev.threshold ?? combinedSev.ruleThreshold ?? null) : null;
        const ruleId = ruleDriven ? combinedSev.ruleId : null;
        const deltaSummary = ruleDriven ? combinedSev.deltaSummary || null : null;

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

        // ADDITIVE (item 2.2) — record every flagged result (not just the first),
        // in report order, for the detail popover. Display-only; does not affect
        // level/urgentCount/abnormalCount/top above.
        if (effSev === 'urgent' || effSev === 'abnormal') {
          flagged.push({
            index: i,
            name: r.name,
            value: r.value,
            unit: r.unit,
            low: r.low,
            high: r.high,
            date: r.date,
            effSev,
            isAbove: !!r.isAbove,
            isBelow: !!r.isBelow,
            urgent: !!r.urgent,
            ruleLabel,
            ruleComparator,
            ruleThreshold,
            ruleId,
            // ADDITIVE (item 3.6) — ready-to-render change summary e.g. '+38 in 5
            // days', set ONLY when a delta rule (not a threshold rule) drove this
            // result's severity. null on every existing (non-delta) flagged entry.
            deltaSummary,
            prior: extractPrior(r),
          });
        }

        // Text-rule outcome — independent, does not affect urgentCount/abnormalCount
        const textResult = computeTextOutcome(r, resultRules, patientContext);
        if (textResult.outcome === 'review') {
          reviewCount++;
          // Part A (item 3.2) — a red-level text review (abnormalLevel:'red' fired) carries
          // its own 'red' level. Count it, and promote reviewTop to a red review when one
          // exists (so the queue chip renders in the red family and names the red finding),
          // even if an amber review was seen first in report order.
          const isRedReview = textResult.level === 'red';
          if (isRedReview) redReviewCount++;
          if (!reviewTop || (isRedReview && reviewTop.level !== 'red')) {
            reviewTop = { name: r.name, label: textResult.label, level: isRedReview ? 'red' : 'amber' };
          }
        } else if (textResult.outcome === 'noGrowth') {
          noGrowthCount++;
          if (!noGrowthTop) noGrowthTop = { name: r.name, label: textResult.normalLabel };
        }

        // Part B (item 3.2) — unclassified qualitative positive fall-through. Runs AFTER
        // rules, only for a result that: (1) has NO finite numeric value; (2) has NO lab
        // flag (isAbove/isBelow/urgent all false); and (3) was NOT classified by ANY text
        // rule (textResult.applied is false — this is the "no double-count" guard: a
        // result an authored text rule already covers, even one that matched the analyte
        // but found no phrase, is left to that rule and never re-flagged here). Such a
        // result scores 'none' today and disappears entirely; if its text carries a
        // positive qualitative token past the negation guard, surface it amber.
        // Escalate-only, AMBER-MAX — never red (see matchUnclassifiedPositive header).
        if (!Number.isFinite(r.value) && !r.isAbove && !r.isBelow && !r.urgent && !(textResult && textResult.applied)) {
          const token = matchUnclassifiedPositive(r);
          if (token) unclassified.push({ name: r.name, token });
        }
      });

      // Combo rules (kind:'combo') — evaluated across the whole report, not per result.
      // ESCALATE-ONLY: a fired combo can only raise level, never lower it.
      const combo = computeComboOutcome(report, resultRules, problems, patientContext);
      const comboCount = combo.comboCount;
      const comboTop = combo.comboTop;
      if (Array.isArray(combo.unitMismatches) && combo.unitMismatches.length) {
        combo.unitMismatches.forEach((m) => rawUnitMismatches.push(m));
      }

      // ADDITIVE (item 3.1) — dedupe the collected mismatches per (result, rule):
      // same analyte name + same rule (by id, falling back to label when a rule
      // carries no id) is recorded once even if multiple code paths could observe
      // it (e.g. a combo rule with more than one condition against the same
      // analyte+unit).
      const seenUnitMismatch = new Set();
      const unitMismatches = [];
      rawUnitMismatches.forEach((m) => {
        const key =
          (m.name || '') +
          '|' +
          (m.ruleId || m.ruleLabel || '') +
          '|' +
          (m.resultUnit || '') +
          '|' +
          (m.ruleUnit || '');
        if (seenUnitMismatch.has(key)) return;
        seenUnitMismatch.add(key);
        unitMismatches.push(m);
      });

      let level;
      if (urgentCount > 0) {
        level = 'red';
      } else if (abnormalCount > 0 || reviewCount > 0 || unclassified.length > 0) {
        // review (unclassified culture) escalates to amber; noGrowth does not. Part B —
        // an unclassified qualitative positive also escalates to (at most) amber.
        level = 'amber';
      } else {
        level = 'none';
      }

      // Part A (item 3.2) — a red-level text review escalates the report to RED (escalate-
      // only; never lowers). Kept OUT of urgentCount, so `misprioritised` (lab-urgent only)
      // is unaffected — a clinician-authored red text flag is not the lab marking the
      // result urgent, the same category boundary combos observe.
      if (redReviewCount > 0) {
        level = 'red';
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
            // ADDITIVE (item 2.6) — display-only trend data for the chip's own arrow
            // glyph; never affects grading.
            prior: extractPrior(salient),
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
        flagged,
        unitMismatches,
        unclassified,
      };
    } catch (err) {
      // Fail visible: a throw used to return the same `none` shape as a genuinely
      // clean report, which hid the queue chip AND could arm lab-filing's
      // all-normal gate. Callers treat level:'error' as "couldn't check".
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ResultSeverity] evaluateReportSeverity failed closed', err && err.message);
      }
      return { ...none, level: 'error' };
    }
  }

  // ── Module export (dual-mode: Node require OR browser global) ───────────────
  // analyteMatches / collapseWs / specimenAllows are exported alongside the public API
  // (same flat convention as e.g. rules-engine.js's drugMatchesRule) so the shared
  // match/exclude/specimen gate can be unit-tested directly, not just indirectly through
  // evaluateReportSeverity. extractPrior likewise (item 2.6) — it already backs
  // top.prior and every flagged[].prior computed inside evaluateReportSeverity above,
  // so content.js's queue popover never needs to duplicate the unit-normalise/
  // epsilon-compare logic; it just reads the field. unitsCompatible (item 3.1)
  // likewise — direct unit tests exercise it without going through a full report.
  const api = {
    evaluateReportSeverity,
    extractPrior,
    analyteMatches,
    collapseWs,
    specimenAllows,
    unitsCompatible,
    // Part B (item 3.2) — exported for direct unit tests. See the header comment above
    // matchUnclassifiedPositive for why the negation guard is REPLICATED (not imported)
    // from content-scripts/triage-lens/rule-match.js.
    matchUnclassifiedPositive,
    POSITIVE_QUALITATIVE,
    UNCLASSIFIED_NEGATORS,
    // Item 3.5 — exported for direct unit tests. See the header comment above
    // contextAllows for the fail-closed semantics every rule-kind path shares.
    contextAllows,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelResultSeverity = api;
  }
})(typeof window !== 'undefined' ? window : global);
