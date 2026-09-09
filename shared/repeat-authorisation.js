// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Repeat-prescribing authorisation classifier — pure logic, no DOM/chrome/fetch.
//
// Classifies one item from GET /clinical/data/medication/medication-regimen/
// {patientId}'s `currentRepeatPrescribingMedications` bucket as either:
//   'fixed'   — a POSITIVELY confirmed fixed-number-of-issues authorisation
//   'unclear' — everything else
//
// THE SIGNAL: `status` carries a leading "<N> of <M> issued" count ONLY
// while a fixed-number-of-issues authorisation still has issues remaining
// (N < M). Confirmed against real patient data across 4 HAR captures / ~30
// items (2026-08-26): every item showing this count was a confirmed fixed
// authorisation; every item without it was a genuine MIX of "until
// medication review date" repeats (the common case in the sample) AND
// fixed-number repeats that have simply run out (once N reaches M, the
// status collapses to the exact same "Supply ends/ended DATE" text an
// until-review item uses — there is nothing left in this field to tell them
// apart). No other field on this endpoint carries the distinction either —
// every key in a real response was enumerated and none of
// numberOfIssuesAuthorised / repeatType / issueType / expiryType exists.
//
// Deliberately does NOT attempt to assert a positive 'review-date' verdict.
// In the sampled evidence, ~40% of "no count" items were actually exhausted
// fixed courses, not genuine until-review — asserting 'review-date' on that
// evidence would silently reassure exactly the patients this classifier
// exists to catch (the downstream purpose is flagging anyone NOT on
// until-review so a practice can convert them). 'unclear' is the honest
// answer for that whole bucket until a cleaner signal is found (most likely
// the prescription's own edit/authorisation screen, not yet captured).
//
// Dual-mode export (same doctrine as shared/extraction-health.js):
//   Browser (classic script): window.RepeatAuthorisation.<fn>(...)
//   Node / test:              require('./shared/repeat-authorisation.js').<fn>(...)

'use strict';

(function () {
  const FIXED_COUNT_RE = /^(\d+)\s+of\s+(\d+)\s+issued/i;

  // { verdict: 'fixed'|'unclear', issuesUsed: number|null, issuesAuthorised: number|null }
  function classifyAuthorisation(item) {
    const status = String((item && item.status) || '').trim();
    const m = FIXED_COUNT_RE.exec(status);
    if (m) {
      return { verdict: 'fixed', issuesUsed: parseInt(m[1], 10), issuesAuthorised: parseInt(m[2], 10) };
    }
    return { verdict: 'unclear', issuesUsed: null, issuesAuthorised: null };
  }

  function _toUtcDays(d) {
    if (!d || d.year == null || d.month == null || d.day == null) return null;
    const y = parseInt(d.year, 10);
    const mo = parseInt(d.month, 10);
    const da = parseInt(d.day, 10);
    if (!y || !mo || !da) return null;
    return Date.UTC(y, mo - 1, da);
  }

  // Days supply: no explicit field exists on this endpoint for it (every key
  // in a real response was enumerated — confirmed absent). Derived instead
  // from the medicationIssueHistory entry with the LATEST startDate (never
  // assume array order) as endDate - startDate — this is Medicus's own
  // computed issue-period length, validated against two real examples where
  // quantity ÷ dose-per-day independently produced the same number (28 days
  // for both Apixaban 56 tablets/twice-daily and Dapagliflozin 28
  // tablets/once-daily).
  function daysSupplyFor(item) {
    const data = item && item.medicationIssueHistory && item.medicationIssueHistory.data;
    if (!Array.isArray(data) || !data.length) return null;
    let latest = null;
    for (const entry of data) {
      const start = _toUtcDays(entry.startDate);
      if (start == null) continue;
      if (!latest || start > latest.start) latest = { start, entry };
    }
    if (!latest) return null;
    const end = _toUtcDays(latest.entry.endDate);
    if (end == null) return null;
    const days = Math.round((end - latest.start) / 86400000);
    return days > 0 ? days : null;
  }

  // ── Days-supply cross-check ──────────────────────────────────────────────────
  // Medicus's own reported days-supply (derived from real issue dates on the
  // Medication tab, or its own displaySupplyDuration field on a task
  // overview) is a value someone set up once when the repeat was authorised
  // — it does not automatically stay in sync if the dose or pack size
  // changes later, and per the developer it is "often wrong... manually
  // inputted incorrectly". This independently recomputes it from
  // quantity ÷ confident daily dose and flags a disagreement, WITHOUT ever
  // trusting the computed number over the reported one — it's a cross-check,
  // not a replacement.
  //
  // FAILS CLOSED on purpose, in two ways a real example already proved
  // necessary (2026-08-26): a genuine drug on this patient's own repeat list,
  // Tranexamic acid, is dosed "2 tabs 4 times a day DURING MENSTRUATION" —
  // taken only on some days of a cycle, not daily. A naive computation would
  // say 60 tablets ÷ 8/day = 7.5 days and flag a false "disagreement"
  // against the genuinely correct reported 56 days. So:
  //   (a) only discrete, countable units are ever computed from — tablets,
  //       capsules and patches (extended 2026-09-09, HAR
  //       116-HRT-patches.har — see below), inhaler doses/puffs (extended
  //       2026-09-10 — a fixed, universal 1 puff = 1 dose equivalence
  //       needing no per-product factor, unlike the gel/cream case), PLUS
  //       gram-issued gel/cream products that have a known, product-
  //       specific grams-per-dose factor (extended 2026-09-09, HAR
  //       117-HRT-gel.har + Nick's own HRT-prescribing spreadsheet — see
  //       the "Gram-based gel/cream cross-check" section below). Everything
  //       else — liquids, drops, or a gram-issued product with NO known
  //       factor — still returns null rather than guess a ratio that isn't
  //       a simple quantity÷dose relationship. Extend DISCRETE_UNIT_WORDS /
  //       the gel/cream factor table only from confirmed real evidence,
  //       never speculatively.
  //   (b) the dosage text must be an unconditional, unambiguous, exact-count
  //       fixed dose at a confident FREQUENCY — daily, weekly, or a plain
  //       day/hour interval (see FREQUENCY tables below) — anything with a
  //       range ("1-2"), a cap ("up to", "maximum"), or PRN/conditional
  //       wording ("as needed", "when required", "during", "before",
  //       "after") returns null rather than guess.
  //
  // Confirmed live 2026-09-09 (HAR 116-HRT-patches.har, Evorel Conti):
  // "ONE PATCH TO BE APPLIED TWICE A WEEK", quantityAndUnit "8 patch" -> 28
  // days, independently cross-checked against Medicus's own
  // lastIssueDate/expectedEndDate on the same item (17 Jul -> 13 Aug 2026,
  // 28 days inclusive) — not just the dose-text maths in isolation. This is
  // what motivated extending DAILY_FREQUENCIES (daily-only) to also cover
  // weekly and day/hour-interval dosing, generically, rather than
  // special-casing Evorel: the SAME frequency tables and DISCRETE_UNIT_WORDS
  // list are shared by every caller of doseUnitsPerDay/computedDaysSupply,
  // both medication-regimen (describeForPill) and task-overview
  // (describeForPillFromTaskItem) items.
  // "dose(s)"/"puffs?" added 2026-09-10 for inhalers — quantityAndUnit is
  // issued as a dose count ("200 dose"), but dosageInstruction is written
  // in "puffs" (e.g. "2 PUFFS TWICE A DAY"), a DIFFERENT word from the
  // quantity's own unit. Unlike the gram-based gel/cream case, this needs
  // no product-specific conversion factor/rules file at all: 1 puff = 1
  // dose is a fixed, universal equivalence for every inhaler (Nick's own
  // framing, 2026-09-10), so simply adding both words as alternatives in
  // the SAME list — already shared identically between quantity-matching
  // (DISCRETE_UNIT_RE) and dose-count-matching (unitsPerDayFromText) — is
  // sufficient: the arithmetic comes out correct even though the literal
  // word differs between the two sides, because the two words denote the
  // same physical quantity 1:1.
  const DISCRETE_UNIT_WORDS = 'tablets?|capsules?|patch(?:es)?|doses?|puffs?';
  const DISCRETE_UNIT_RE = new RegExp(`^(\\d+)\\s*(${DISCRETE_UNIT_WORDS})$`, 'i');

  const DOSE_DISQUALIFIERS = [
    /\bas\s+needed\b/,
    /\bwhen\s+needed\b/,
    /\bwhen\s+required\b/,
    /\bif\s+needed\b/,
    /\bif\s+required\b/,
    /\bprn\b/,
    /\bas\s+directed\b/,
    /\bas\s+required\b/,
    /\bduring\b/,
    /\bbefore\b/,
    /\bafter\b/,
    /\balternate/,
    /\bmonthly\b/, // a calendar month's day-count is itself ambiguous (28-31) — deliberately not attempted, unlike weekly/day/hour intervals below
    /\d+\s*-\s*\d+/, // any numeric range, e.g. "1-2"
    /\b\d+\s+to\s+\d+\b/, // the SAME range, spelled out in words — e.g. "1 TO 2 PUFFS" (evidenced live 2026-09-10, a reliever-inhaler instruction)
    /\bor\b/,
  ];

  // "maximum"/"up to" cap wording — kept SEPARATE from the absolute
  // disqualifiers above, relaxed 2026-09-10 for a specific, narrow,
  // evidence-based reason (Nick's own framing, real HAR
  // 119-co-codamol.har): "Take 1 tablet every 6 hours - oral - Maximum
  // dose 4 doses DAILY" was being disqualified purely because of the word
  // "Maximum", computing null instead of the 14 days a full-rate patient
  // genuinely gets through 56 tablets at 4/day. Nick's point: "every 6
  // hours" IS an unconditional, definite schedule — the trailing "Maximum
  // dose ... DAILY" is a redundant restatement of that same rate (BNF-style
  // safety labelling), not a genuine "somewhere between 0 and N" range —
  // and the practice explicitly permits patients to use the full amount,
  // so flagging a re-authorisation need at the WORST-CASE (fastest
  // exhaustion) rate is exactly the point, not something to suppress.
  // Contrast a bare cap with NO separate interval, e.g. "up to 2 tablets
  // daily" or "up to four times a day" — genuinely ambiguous (the patient,
  // not a fixed schedule, decides how many of the permitted maximum they
  // take), and STILL correctly disqualified: this relaxation applies ONLY
  // when a definite INTERVAL (intervalDaysFromText — "every N hours/days",
  // "every other day") is separately present elsewhere in the same text —
  // never for a DAILY_FREQUENCIES/WEEKLY_FREQUENCIES-style count phrase
  // like "four times a day", which "up to"/"maximum" much more plausibly
  // genuinely modifies (see unitsPerDayFromText/gelDosesPerDay below for
  // where this check is applied).
  const CAP_DISQUALIFIERS = [/\bmax(imum)?\b/, /\bup\s+to\b/];

  // Ordered: check more-specific ("twice a day") phrases before less regex
  // could otherwise partially overlap; each maps to a confident times/day.
  const DAILY_FREQUENCIES = [
    [/\bfour\s+times\s+(a\s+day|daily)\b/, 4],
    [/\bthree\s+times\s+(a\s+day|daily)\b/, 3],
    [/\btwo\s+times\s+(a\s+day|daily)\b/, 2],
    [/\btwice\s+(a\s+day|daily)\b/, 2],
    [/\bonce\s+(a\s+day|daily)\b/, 1],
    [/\bevery\s+(morning|night|day)\b/, 1],
    [/\beach\s+(morning|night|day)\b/, 1],
    [/\bat\s+night\b/, 1],
    [/\bin\s+the\s+morning\b/, 1],
    [/\bnightly\b/, 1],
    // Bare "daily" with no "once/twice" qualifier — added 2026-09-09,
    // confirmed live (HAR 117-HRT-gel.har): "3 PUMPS DAILY" has nothing
    // else above to match ("twice/once (a day|daily)" both require a
    // leading count word this phrasing doesn't have — the count is
    // already captured separately as "3 pumps"). Placed LAST so every
    // more specific phrase above — which could itself contain the literal
    // word "daily", e.g. "twice daily" — still wins first.
    [/\bdaily\b/, 1],
  ];

  // Weekly frequencies — "twice a week" / "once weekly" etc. — a confident
  // times-per-WEEK count, converted to a fractional times-per-day rate
  // (÷7) by doseUnitsPerDay below. Confirmed live: Evorel Conti "TWICE A
  // WEEK" (HAR 116). Same ordering discipline as DAILY_FREQUENCIES.
  const WEEKLY_FREQUENCIES = [
    [/\bfour\s+times\s+(a\s+week|weekly)\b/, 4],
    [/\bthree\s+times\s+(a\s+week|weekly)\b/, 3],
    [/\btwo\s+times\s+(a\s+week|weekly)\b/, 2],
    [/\btwice\s+(a\s+week|weekly)\b/, 2],
    [/\bonce\s+(a\s+week|weekly)\b/, 1],
    // Bare "weekly" with no "once/twice" qualifier — added 2026-09-10,
    // confirmed live (Folic acid 5mg tablets): "Take two (10mg) weekly" —
    // the "two" is the per-dose TABLET count (see impliedUnitCount below),
    // not a frequency count, so nothing above it matches; "weekly" alone
    // means once a week. Same placement discipline as DAILY_FREQUENCIES'
    // own bare "daily" entry — LAST, so "twice weekly" etc. still win first.
    [/\bweekly\b/, 1],
  ];

  // Plain interval dosing — "every 3 days" / "every 72 hours" / "every
  // other day" — a confident number of DAYS between doses (hours divided
  // down to days), converted to a fractional times-per-day rate (1/days)
  // by doseUnitsPerDay below. Not yet confirmed against a real HAR (built
  // generically alongside the weekly case, same underlying maths) —
  // revisit if a real example disproves the assumed phrasing.
  function intervalDaysFromText(text) {
    if (/\bevery\s+other\s+day\b/.test(text)) return 2;
    const dayMatch = /\bevery\s+(\d+)\s+days?\b/.exec(text);
    if (dayMatch) return parseInt(dayMatch[1], 10);
    const hourMatch = /\bevery\s+(\d+)\s+hours?\b/.exec(text);
    if (hourMatch) return parseInt(hourMatch[1], 10) / 24;
    return null;
  }

  // Confident times-PER-DAY from whichever FREQUENCY table/interval matches
  // (never the per-dose count itself) — shared by unitsPerDayFromText below
  // AND gelDosesPerDay further down, since the frequency maths itself
  // (DAILY_FREQUENCIES/WEEKLY_FREQUENCIES/intervalDaysFromText) is identical
  // regardless of what's being counted (tablets vs pumps vs applications).
  // intervalDaysFromText is checked FIRST — changed 2026-09-10 (real HAR
  // 119-co-codamol.har): "Take 1 tablet every 6 hours - oral - Maximum
  // dose 4 doses DAILY" also contains the bare word "daily" (from the
  // trailing "Maximum dose ... DAILY" clause), which DAILY_FREQUENCIES'
  // own bare-"daily" entry would otherwise match FIRST and silently return
  // 1/day instead of the correct 4/day from "every 6 hours" — an interval
  // phrase is always the more specific, deliberate statement when both are
  // present, so it takes priority.
  function frequencyPerDay(text) {
    const intervalDays = intervalDaysFromText(text);
    if (intervalDays) return 1 / intervalDays;
    for (const [re, timesPerDay] of DAILY_FREQUENCIES) {
      if (re.test(text)) return timesPerDay;
    }
    for (const [re, timesPerWeek] of WEEKLY_FREQUENCIES) {
      if (re.test(text)) return timesPerWeek / 7;
    }
    return null;
  }

  // Bare word-number count with NO unit word attached anywhere in the text
  // at all — evidenced live 2026-09-10 (Folic acid 5mg tablets): "Take two
  // (10mg) weekly" never says "tablet"/"tablets" anywhere, unlike every
  // other discrete-unit example seen before this one (which always repeat
  // the unit word right next to the count, e.g. "2 tablets twice a day").
  // Deliberately narrow: only recognises "one"/"two" ("one" already
  // trusted from the ONE-PATCH case above, just in the unit-word-PRESENT
  // form; "two" is the newly evidenced word here) directly after "take",
  // and ONLY tried once the explicit-unit-word regexes above have both
  // failed AND `unitWordsPattern` is confirmed absent from the whole text
  // — if the unit word appeared anywhere, the explicit regexes should
  // already have matched it, so guessing here too could otherwise latch
  // onto an unrelated number instead (e.g. the "10" inside a parenthetical
  // "(10mg)" strength annotation, which must NOT be read as a tablet
  // count). This is judged safe specifically because unitsPerDayFromText
  // is only ever reached (via doseUnitsPerDay) once quantityAndUnit has
  // ALREADY confirmed the product IS issued in this exact discrete unit —
  // unlike a genuinely unknown unit, there's nothing else the bare word
  // "two" could plausibly be counting here.
  const IMPLIED_UNIT_WORD_NUMBERS = { one: 1, two: 2 };
  function impliedUnitCount(text, unitWordsPattern) {
    if (new RegExp(unitWordsPattern).test(text)) return null;
    const m = /\btake\s+(one|two)\b/.exec(text);
    return m ? IMPLIED_UNIT_WORD_NUMBERS[m[1]] : null;
  }

  // Confident units-per-day for the discrete tablet/capsule/patch case —
  // requires an EXPLICIT count (a digit/word-number, either directly on
  // the unit word or, per impliedUnitCount above, on its own once the
  // unit word is confirmed entirely absent); with neither, returns null
  // rather than guess (a tablet dose genuinely varies patient to patient,
  // so assuming a count out of nowhere would be a real clinical guess).
  // Compare gelDosesPerDay below, which additionally assumes "1" with NO
  // count word at all for the gram-based gel/cream path — a stronger
  // assumption this function deliberately does not make.
  function unitsPerDayFromText(text, unitWordsPattern) {
    if (!text) return null;
    if (DOSE_DISQUALIFIERS.some((re) => re.test(text))) return null;
    // See CAP_DISQUALIFIERS' own comment: "maximum"/"up to" only blocks
    // computation when there's no separate, unconditional INTERVAL
    // schedule already establishing a genuine fixed rate.
    if (CAP_DISQUALIFIERS.some((re) => re.test(text)) && !intervalDaysFromText(text)) return null;

    const qtyDigitMatch = new RegExp(`\\b(\\d+)\\s*(${unitWordsPattern})\\b`).exec(text);
    const qtyOneMatch = new RegExp(`\\bone\\s+(${unitWordsPattern})\\b`).exec(text);
    let perDose;
    if (qtyDigitMatch) perDose = parseInt(qtyDigitMatch[1], 10);
    else if (qtyOneMatch) perDose = 1;
    else perDose = impliedUnitCount(text, unitWordsPattern);
    if (perDose == null) return null;

    const freq = frequencyPerDay(text);
    return freq ? perDose * freq : null;
  }

  // Confident (possibly fractional) units-per-day from a free-text dosage
  // instruction, or null for anything other than a simple, unconditional,
  // fixed dose at a confident frequency. The per-dose quantity is usually a
  // digit ("2 tabs"), but confirmed live (HAR 116) Medicus free text
  // sometimes spells it out ("ONE PATCH") — only "one" is evidenced, so
  // that's the only word-number recognised; others are deliberately not
  // guessed.
  function doseUnitsPerDay(dosageInstruction) {
    return unitsPerDayFromText(String(dosageInstruction || '').toLowerCase(), DISCRETE_UNIT_WORDS);
  }

  // ── Gram-based gel/cream cross-check ─────────────────────────────────────────
  // A DIFFERENT shape from the discrete tablet/capsule/patch case above: the
  // issued quantity is in GRAMS, but the dose is written as a count of
  // pumps/actuations/applications — a unit that does not appear in the
  // quantity at all. Converting between them needs a PRODUCT-SPECIFIC
  // grams-per-dose factor (how much gel one pump actually delivers), which
  // isn't derivable from the dosage text alone — Nick's own framing,
  // 2026-09-09, confirmed by his practice's own HRT-prescribing spreadsheet
  // ("HRT prescribing checker.xlsx"), which carries exactly this packSize/
  // packDoses model per product. See rules/hrt-gram-dose-factors.json for
  // the factor table and its sourcing; `gelDoseFactors` here is that file's
  // already-loaded `products` array, passed in by the caller (this module
  // stays pure — no fetch of its own, same discipline as every other
  // rules/*.json consumer in this repo).
  const GEL_DOSE_UNIT_WORDS = 'pumps?|applications?|actuations?';
  const GRAM_UNIT_RE = /^(\d+(?:\.\d+)?)\s*grams?$/i;

  function findGramDoseFactor(product, gelDoseFactors) {
    if (!Array.isArray(gelDoseFactors) || !product) return null;
    const text = String(product);
    for (const factor of gelDoseFactors) {
      if (!factor || !factor.match || !factor.gramsPerDose) continue;
      try {
        if (new RegExp(factor.match, 'i').test(text)) return factor;
      } catch (_) {
        continue; // a malformed match pattern in the data file must never throw
      }
    }
    return null;
  }

  // Confident applications/pumps-PER-DAY for the gram-based gel/cream case —
  // DELIBERATELY different from unitsPerDayFromText's tablet rule above: if
  // no explicit pump/application COUNT word is present at all, this assumes
  // ONE (rather than returning null), as long as a confident FREQUENCY is
  // still found. Confirmed necessary live, 2026-09-10 (HAR
  // 118-oestrogen-gel.har): a real Estriol 1mg/g cream item's own
  // dosageInstruction is "TWICE WEEKLY LONG TERM" — no "application"/"pump"
  // word anywhere in it at all, unlike every gel example seen so far. This
  // is judged safe specifically FOR THIS PATH (never extended to the
  // tablet/capsule/patch case, where a missing count is a genuine ambiguity
  // worth failing closed on): every product computedGramDaysSupply can even
  // reach here for is one already matched against the curated, evidence-
  // backed rules/hrt-gram-dose-factors.json list, where the applicator/pump
  // is a fixed metered-dose device by design — "apply twice weekly" on one
  // of these products means one measured dose, twice weekly, the same way
  // "twice weekly" alone would for a patch. If a future product on that
  // list is ever dosed in more than one applicator-load per administration,
  // real prescribing text should say so explicitly ("2 applications..."),
  // which the digit-count branch below still parses correctly.
  function gelDosesPerDay(text) {
    if (!text) return null;
    if (DOSE_DISQUALIFIERS.some((re) => re.test(text))) return null;
    // See CAP_DISQUALIFIERS' own comment: relaxed only when a separate,
    // unconditional INTERVAL schedule is present — same rule as
    // unitsPerDayFromText above, not yet evidenced for a gel/cream product
    // specifically but the same reasoning applies uniformly.
    if (CAP_DISQUALIFIERS.some((re) => re.test(text)) && !intervalDaysFromText(text)) return null;
    const qtyDigitMatch = new RegExp(`\\b(\\d+)\\s*(${GEL_DOSE_UNIT_WORDS})\\b`).exec(text);
    const perDose = qtyDigitMatch ? parseInt(qtyDigitMatch[1], 10) : 1;
    const freq = frequencyPerDay(text);
    return freq ? perDose * freq : null;
  }

  // Computed days-supply for a gram-issued gel/cream, or null unless ALL of:
  // quantityAndUnit is a plain gram figure, `product` matches a known entry
  // in gelDoseFactors, and the dosage text is an unambiguous, confident
  // applications/pumps-per-day count (same disqualifier/frequency rules as
  // the tablet case — PRN/ranges/etc. still return null, not a guess; see
  // gelDosesPerDay's own comment for the one deliberate difference).
  function computedGramDaysSupply(quantityAndUnit, dosageInstruction, product, gelDoseFactors) {
    const qm = GRAM_UNIT_RE.exec(String(quantityAndUnit || '').trim());
    if (!qm) return null;
    const factor = findGramDoseFactor(product, gelDoseFactors);
    if (!factor) return null;
    const dosesPerDay = gelDosesPerDay(String(dosageInstruction || '').toLowerCase());
    if (!dosesPerDay) return null;
    const totalGrams = parseFloat(qm[1]);
    const totalDoses = totalGrams / factor.gramsPerDose;
    return Math.round(totalDoses / dosesPerDay);
  }

  // Computed days-supply from quantity ÷ confident daily dose. Tries the
  // discrete tablet/capsule/patch path first; falls through to the
  // gram-based gel/cream path (needs `product` + `gelDoseFactors`, both
  // optional so every existing caller that doesn't pass them keeps working
  // unchanged) only when the quantity isn't a discrete-unit figure at all —
  // the two unit shapes are mutually exclusive by construction (grams vs
  // tablets/capsules/patches), so there's no ambiguity about which applies.
  function computedDaysSupply(quantityAndUnit, dosageInstruction, product, gelDoseFactors) {
    const qty = String(quantityAndUnit || '').trim();
    const discreteMatch = DISCRETE_UNIT_RE.exec(qty);
    if (discreteMatch) {
      const totalUnits = parseInt(discreteMatch[1], 10);
      const perDay = doseUnitsPerDay(dosageInstruction);
      return perDay ? Math.round(totalUnits / perDay) : null;
    }
    return computedGramDaysSupply(qty, dosageInstruction, product, gelDoseFactors);
  }

  // { agrees: true|false|null (null = nothing to compare), computedDays }
  // Never asserts the computed value is "correct" — only whether it matches
  // what Medicus itself reports. ALWAYS computes computedDays when possible
  // (2026-09-10, changed from short-circuiting to null the moment
  // reportedDays is null) — daysClause below needs it even when there is
  // nothing to compare it against, to offer it as a labelled estimate
  // rather than nothing at all. `agrees` still stays null whenever
  // reportedDays is null — there is genuinely nothing to agree or disagree
  // with, so the mismatch-flagging behaviour (which only ever checks
  // `agrees === false`) is unchanged.
  function checkDaysSupply(reportedDays, quantityAndUnit, dosageInstruction, product, gelDoseFactors) {
    const computedDays = computedDaysSupply(quantityAndUnit, dosageInstruction, product, gelDoseFactors);
    if (reportedDays == null) return { agrees: null, computedDays };
    if (computedDays == null) return { agrees: null, computedDays: null };
    return { agrees: computedDays === reportedDays, computedDays };
  }

  function daysSuffix(days) {
    return days != null ? days + (days === 1 ? ' day' : ' days') : 'days unknown';
  }

  // The "<N days>[, mismatch: ...]" / "~<N days> (estimated from dose)" /
  // "days unknown" portion of a pill — shared by describeForPill
  // (medication-regimen) and describeForPillFromTaskItem (task-overview) so
  // the three states below can never drift apart between the two screens.
  // Three states, deliberately never blurred together:
  //   - reportedDays known: show it plainly; cross-check against the
  //     computed value and flag a genuine DISAGREEMENT only (unchanged
  //     behaviour from before 2026-09-10).
  //   - reportedDays unknown but a confident computed estimate exists
  //     (2026-09-10, Nick's own request — the Evorel Conti "no issues
  //     left" case: fulfilledByPrescription is null there by construction,
  //     so there is NEVER a reported figure to check the estimate
  //     against, even though the dose text is often perfectly computable):
  //     show the estimate, marked "~" and "(estimated from dose)" so it is
  //     never mistaken for something Medicus itself reported.
  //   - neither known: "days unknown", same as always.
  function daysClause(reportedDays, quantityAndUnit, dosageInstruction, product, gelDoseFactors) {
    const check = checkDaysSupply(reportedDays, quantityAndUnit, dosageInstruction, product, gelDoseFactors);
    if (reportedDays != null) {
      const parts = [daysSuffix(reportedDays)];
      if (check.agrees === false) parts.push('mismatch: qty/dose suggests ' + daysSuffix(check.computedDays));
      return parts.join(', ');
    }
    if (check.computedDays != null) return '~' + daysSuffix(check.computedDays) + ' (estimated from dose)';
    return daysSuffix(null);
  }

  // "<Fixed|Unclear>, <days clause>" — the pill's full text. Quantity
  // itself is deliberately omitted: it's already visible on every screen
  // this pill appears on, so repeating it would just be noise. Deliberately
  // just "Unclear", not "Unclear – check" (Nick's own call, 2026-09-08):
  // across a whole batch of repeats this isn't an instruction to the
  // clinician for each individual item, just an honest classification
  // label — "check" read as telling them what to do, item by item.
  function describeForPill(item, gelDoseFactors) {
    const { verdict } = classifyAuthorisation(item);
    const label = verdict === 'fixed' ? 'Fixed' : 'Unclear';
    const days = daysSupplyFor(item);
    const product = item && item.description;
    return [
      label,
      daysClause(days, item && item.quantityAndUnit, item && item.dosageInstructions, product, gelDoseFactors),
    ].join(', ');
  }

  // ── Prescription-request task-overview shape ────────────────────────────────
  // GET /tasks/data/prescription-requests/overview/{taskUuid} — the same
  // response resolveTaskToPatient() already fetches for identity — carries
  // its own "repeat" item shape under
  // data.prescriptionRequestItemsByType.repeatWithAnAuthorisedIssue.items[]
  // (wrapper key renamed from prescriptionRequestsByType by Medicus
  // themselves sometime between 2026-08-26 and 2026-09-03 — caught live via
  // a debug capture showing the old key absent from a real response; item
  // shape below the rename not yet re-confirmed):
  // { product, issueNumberAsXOfY: "<N> of <M>", quantityAndUnit,
  //   fulfilledByPrescription: { displaySupplyDuration: "<N> days supply", ... } }
  //
  // issueNumberAsXOfY carries the SAME ambiguity as medication-regimen's
  // status text, just as a plain "<N> of <M>" pair instead of prose with a
  // trailing "issued": confirmed live (2026-08-26) that a genuine
  // until-review item (Venlafaxine, both strengths) shows N === M here
  // ("5 of 5", "7 of 7") — indistinguishable from an exhausted fixed course
  // on this field alone. So the same rule applies: only N < M is a positive
  // 'fixed' signal; N === M is 'unclear', same as everywhere else.
  //
  // variable-repeat items (confirmed: Naproxen, Omeprazole in the same
  // capture) always carry issueNumberAsXOfY: null — call this ONLY on
  // 'repeat' type items, never on 'variable-repeat' ones (which have no
  // fixed/until-review distinction to make at all).
  function classifyFromXOfY(xOfY) {
    const s = String(xOfY || '').trim();
    const m = /^(\d+)\s+of\s+(\d+)$/.exec(s);
    if (m) {
      const n = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (n < total) return { verdict: 'fixed', issuesUsed: n, issuesAuthorised: total };
    }
    return { verdict: 'unclear', issuesUsed: null, issuesAuthorised: null };
  }

  // Days supply straight from the task JSON's own labelled field (e.g.
  // "30 days supply") — no derivation needed here, unlike medication-regimen.
  function daysSupplyFromDuration(label) {
    const m = /(\d+)\s*day/i.exec(String(label || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  // Days supply for one item from repeatWithAnAuthorisedIssue.items[] /
  // repeatPrescribingWithNoIssues.items[] — Medicus's own reported figure
  // when the item has been issued at least once (fulfilledByPrescription
  // is populated); null when it hasn't (a never-issued item has nothing to
  // report yet — confirmed live 2026-09-08, EpiPen "Issue 1 of 1").
  function daysSupplyFromTaskItem(item) {
    const duration = item && item.fulfilledByPrescription && item.fulfilledByPrescription.displaySupplyDuration;
    return daysSupplyFromDuration(duration);
  }

  // Pill text for one item from repeatWithAnAuthorisedIssue.items[]. Note:
  // this shape's dosage field is `dosageInstruction` (singular) — different
  // from medication-regimen's `dosageInstructions` (plural). See
  // describeForPill's comment above for why the label is just "Unclear".
  function describeForPillFromTaskItem(item, gelDoseFactors) {
    const { verdict } = classifyFromXOfY(item && item.issueNumberAsXOfY);
    const label = verdict === 'fixed' ? 'Fixed' : 'Unclear';
    const days = daysSupplyFromTaskItem(item);
    const product = item && item.product;
    return [
      label,
      daysClause(days, item && item.quantityAndUnit, item && item.dosageInstruction, product, gelDoseFactors),
    ].join(', ');
  }

  // ── Reauthorisation-form shape (re-authorise / modify popup) ────────────────
  // GET /clinical/data/prescription/re-authorise/{prescriptionId} — confirmed
  // live 2026-09-10, HAR 120-reauthorise.har + 121-reauthorise2.har (Nick
  // editing the form to deliberately create a mismatch) — carries a
  // `prescription.authorisationMethod` field that is a DIRECT, literal enum
  // ('review-date' | 'fixed-number-of-issues'), backed by the form's own
  // `authorisationMethods` picklist. This is a GENUINELY different
  // confidence level from every other screen this file reads: there, the
  // signal is inferred from ambiguous status text and can never positively
  // confirm "until review date" (see the file's own header comment — ~40%
  // of "no count" items sampled elsewhere turned out to be exhausted fixed
  // courses, not genuine until-review). Here, Medicus itself states which
  // one it is, so classifyFromAuthorisationMethod can safely assert a real
  // THIRD verdict, 'review-date', with full confidence — something no other
  // classifier in this file does.
  function classifyFromAuthorisationMethod(authorisationMethod) {
    if (authorisationMethod === 'fixed-number-of-issues') return { verdict: 'fixed' };
    if (authorisationMethod === 'review-date') return { verdict: 'review-date' };
    return { verdict: 'unclear' };
  }

  // Pill text for the reauthorisation-form screen's own `prescription`
  // object. Label set differs from describeForPill/describeForPillFromTaskItem's
  // Fixed/Unclear-only convention specifically because this screen's signal
  // is unambiguous — "Until review date" is asserted here, never elsewhere
  // in this file.
  //
  // The quantity÷dose cross-check (daysClause/checkDaysSupply, same as the
  // other two screens) WAS removed 2026-09-10, then RESTORED the same day
  // once a real counter-example showed the removal was over-generalised.
  // The removal's reasoning was correct for STRUCTURED dosage (a picklist
  // dose/frequency, e.g. Apixaban "1 tablet twice a day" —
  // dosageInstruction.useManualDosageText: false): confirmed live that
  // Medicus's own client-side JS keeps issueQuantity in sync with whatever
  // "Expected days supply" is set for those, so a cross-check there really
  // was just reproducing Medicus's own already-correct arithmetic. But it
  // does NOT hold for FREE-TEXT dosage (useManualDosageText: true) —
  // confirmed live 2026-09-11: an Estradiol 0.06% gel item dosed "3 pumps
  // daily" (free text) reported "Expected days supply: 84", which
  // computedGramDaysSupply independently derives as 64 (240g / 1.25g per
  // pump / 3 pumps/day) — Medicus has no structured dose/frequency to
  // recalculate FROM for free text, so nothing on the form ever corrects
  // an inconsistency there; the extension's own cross-check is the ONLY
  // thing that can catch it. Rather than branch explicitly on
  // useManualDosageText (not read from the response at all currently),
  // the check just always runs: for structured-dosage items it will
  // typically agree with Medicus's own corrected value in practice
  // (harmless no-op), and for free-text items it does genuinely new work.
  // Known, accepted trade-off: a brief structured-dosage item can show a
  // transient false mismatch in the moment before Medicus's own
  // auto-correction fires (the original staleness bug this file's history
  // already covers) — not re-solved here since it wasn't the thing
  // reported broken; revisit only if it's actually hit again live.
  function describeForReauthorisationForm(prescription, gelDoseFactors) {
    const method = prescription && prescription.authorisationMethod;
    const { verdict } = classifyFromAuthorisationMethod(method);
    const label = verdict === 'fixed' ? 'Fixed' : verdict === 'review-date' ? 'Until review date' : 'Unclear';
    const rawDays = prescription && prescription.expectedDaysSupply;
    const reportedDays = rawDays != null && rawDays !== '' && !Number.isNaN(Number(rawDays)) ? Number(rawDays) : null;
    const issueQuantity = prescription && prescription.issueQuantity;
    const quantityAndUnit =
      issueQuantity && issueQuantity.value != null && issueQuantity.snomedCtCode
        ? `${issueQuantity.value} ${issueQuantity.snomedCtCode.description}`
        : null;
    const dosageText = prescription && prescription.dosageInstruction && prescription.dosageInstruction.dosageText;
    const product = prescription && (prescription.productName || prescription.productDescription);
    return [label, daysClause(reportedDays, quantityAndUnit, dosageText, product, gelDoseFactors)].join(', ');
  }

  // Cross-item outlier check, deliberately separate from the per-item
  // quantity/dose cross-check above: given every item's own days-supply
  // (already computed, in the SAME order as the items — nulls where
  // unknown), flags whichever ones disagree with the rest of the SAME
  // task. Everything reauthorised together on one task would normally
  // share the same supply interval, so a lone item on a different one is a
  // stronger signal of a genuine data-entry error than a single item's own
  // dose-derived estimate can be.
  //
  // Deliberately requires a genuine, unambiguous majority before flagging
  // anything — never just "whichever value appears most, even by one":
  //   - fewer than 3 known (non-null) values: nothing to compare against
  //     with any confidence, so nothing is flagged.
  //   - a tie for the most common value (including a full three-way split
  //     with no repeats at all): no single value is "the majority", so
  //     nothing is flagged — asserting a winner from an even split would
  //     be exactly the kind of unsupported guess this classifier elsewhere
  //     goes out of its way to avoid (see the file header comment).
  //   - the "majority" needs at least 2 items agreeing — one item agreeing
  //     only with itself is not a majority.
  // A null (days unknown) entry is never itself flagged — there's nothing
  // confirmed about it to disagree with anything.
  //
  // Returns { outliers: [bool, ...] (same order/length as daysList),
  // majorityDays: number|null }.
  function daysSupplyOutliers(daysList) {
    const list = Array.isArray(daysList) ? daysList : [];
    const known = list.filter((d) => d != null);
    const none = { outliers: list.map(() => false), majorityDays: null };
    if (known.length < 3) return none;
    const counts = {};
    known.forEach((d) => {
      counts[d] = (counts[d] || 0) + 1;
    });
    let majorityDays = null;
    let majorityCount = 0;
    let tie = false;
    Object.keys(counts).forEach((k) => {
      if (counts[k] > majorityCount) {
        majorityCount = counts[k];
        majorityDays = Number(k);
        tie = false;
      } else if (counts[k] === majorityCount) {
        tie = true;
      }
    });
    if (tie || majorityCount < 2) return none;
    return {
      outliers: list.map((d) => d != null && d !== majorityDays),
      majorityDays,
    };
  }

  // "-2 vs majority at 30 days" / "+5 vs majority at 30 days" — the delta
  // clause for one flagged outlier. Sign is always shown explicitly: a
  // negative delta already prints its own "-" via normal number-to-string,
  // but a positive one needs a "+" added, or the direction (over vs under
  // the majority) would be ambiguous. Only ever called with a known
  // (non-null) `days` — daysSupplyOutliers never flags a null entry.
  function formatDaysOutlierDelta(days, majorityDays) {
    const delta = days - majorityDays;
    const sign = delta >= 0 ? '+' : '';
    return sign + delta + ' vs majority at ' + daysSuffix(majorityDays);
  }

  // A colour ROLE per item, not a literal colour — palette/hex choices are
  // a rendering concern owned by the content script, which is the only
  // thing that touches the DOM. Nick's own request (2026-09-09): "assign
  // colours after review, so that the majority is green, with different
  // outliers different colours". Roles:
  //   'unknown'       — days is null ("days unknown"), never grouped with
  //                     a real interval regardless of majority/outlier
  //   'majority'      — matches outlierResult.majorityDays
  //   'outlier:<N>'    — disagrees with the majority, keyed by the item's
  //                     OWN days value — so two items outlying in the SAME
  //                     way share a role (and so a colour), two outlying
  //                     in DIFFERENT ways get different roles
  //   null            — outlierResult never established a majority at all
  //                     (see daysSupplyOutliers' own fail-closed rules —
  //                     fewer than 3 known values, or a tie). Nothing to
  //                     single out as "the odd one out" here — a caller
  //                     wanting a majority-vs-outlier scheme should treat
  //                     this as "fall back to some other colouring", not
  //                     paint everything as if they were all majority.
  function daysSupplyColourRoles(daysList, outlierResult) {
    const list = Array.isArray(daysList) ? daysList : [];
    const majorityDays = outlierResult && outlierResult.majorityDays;
    return list.map((d) => {
      if (d == null) return 'unknown';
      if (majorityDays == null) return null;
      return d === majorityDays ? 'majority' : 'outlier:' + d;
    });
  }

  const api = {
    classifyAuthorisation,
    daysSupplyFor,
    describeForPill,
    classifyFromXOfY,
    daysSupplyFromDuration,
    daysSupplyFromTaskItem,
    describeForPillFromTaskItem,
    classifyFromAuthorisationMethod,
    describeForReauthorisationForm,
    doseUnitsPerDay,
    computedDaysSupply,
    computedGramDaysSupply,
    checkDaysSupply,
    daysSupplyOutliers,
    formatDaysOutlierDelta,
    daysSupplyColourRoles,
    daysSuffix,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined') {
    self.RepeatAuthorisation = api;
  }
})();
