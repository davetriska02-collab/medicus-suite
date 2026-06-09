// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Rules Engine
// Evaluates three rule types against extracted patient data:
//   1. drug-monitoring  : drug X -> tests at intervals
//   2. qof-register     : register membership from active problems
//   3. qof-indicator    : threshold check against observation/medication
//
// Returns an array of chips. Each chip has type, ruleId, status, displayName,
// notes, and a payload of evaluation detail for the UI to render.

(function(global) {
  'use strict';

  // === STATUS RANK (worst-first ordering) ===
  // overdue: actionable, lacks recent data within interval
  // not_met: indicator not achieved
  // stale:   data exists but is older than 2x the interval
  // due_soon: within the dueSoon window
  // no_data: no matching observation/value found
  // recently_initiated: drug started recently, no monitoring expected yet
  // achieved: indicator met
  // in_date: drug monitoring within interval
  //
  // Non-time-based statuses (drug-combo / event-count / composite alerts that
  // fire on presence/count/threshold rather than a recall interval). These ride
  // alongside the time-based ranks so they sort and filter consistently:
  // alert (red) ranks with overdue, caution (amber) with due_soon, noted (info)
  // is neutral.
  const STATUS_RANK = {
    overdue: 0,
    not_met: 0,
    alert: 0,
    stale: 1,
    due_soon: 2,
    caution: 2,
    no_data: 3,
    noted: 3,
    recently_initiated: 4,
    achieved: 5,
    in_date: 5,
    vax_given: 5,
    vax_declined: 3,
    vax_due: 1
  };

  // === DRUG MATCHING ===
  function normaliseDrugString(s) {
    return String(s || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function drugMatchesRule(medName, rule) {
    if (!rule.drug || !rule.drug.match) return false;
    const norm = normaliseDrugString(medName);
    const excluded = (rule.drug.exclude || []).some(e => norm.includes(normaliseDrugString(e)));
    if (excluded) return false;
    return rule.drug.match.some(m => norm.includes(normaliseDrugString(m)));
  }

  // === DATE HELPERS ===
  function daysBetween(isoA, isoB) {
    const a = new Date(isoA);
    const b = new Date(isoB);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  }

  // QOF year runs 1 April – 31 March.
  // Returns a Date for 00:00:00 on 1 April of the QOF year that contains nowIso.
  // e.g. 15 Jan 2026  → 1 Apr 2025  (still in 25/26 year)
  //      20 Apr 2026  → 1 Apr 2026  (26/27 year has just started)
  function qofYearStart(nowIso) {
    // Parse date component directly from ISO string to avoid UTC vs local ambiguity.
    // QOF year is a UK local-time concept (1 Apr – 31 Mar); using UTC month on a
    // near-midnight local timestamp can misclassify the year boundary by one day.
    const datePart = String(nowIso).slice(0, 10); // "YYYY-MM-DD"
    const month = parseInt(datePart.slice(5, 7), 10); // 1-indexed
    const year  = parseInt(datePart.slice(0, 4), 10);
    const qofYear = month < 4 ? year - 1 : year; // before April → previous QOF year
    return new Date(Date.UTC(qofYear, 3, 1)); // 1 Apr, midnight UTC
  }

  // Returns "YYYY/YY" label for the current QOF year, e.g. "2025/26"
  function qofYearLabel(nowIso) {
    const start = qofYearStart(nowIso);
    const y = start.getUTCFullYear();
    return `${y}/${String(y + 1).slice(2)}`;
  }

  // === OBSERVATION LOOKUP ===
  function findLatestObservation(observations, testSpec) {
    if (!Array.isArray(observations)) return null;
    const matches = observations.filter(obs => {
      if (testSpec.snomed && obs.code && testSpec.snomed.includes(String(obs.code))) return true;
      if (obs.name && Array.isArray(testSpec.match)) {
        const obsLower = String(obs.name).toLowerCase();
        return testSpec.match.some(m => obsLower.includes(String(m).toLowerCase()));
      }
      return false;
    });
    if (matches.length === 0) return null;
    // Priority = index of the first match term the observation name contains.
    // Used only as a tiebreak when two observations share the same (latest) date,
    // so a rule can express precedence by ordering its `match`/`observation`
    // terms — e.g. CHOL004 lists LDL before non-HDL so LDL wins on the same date.
    const matchPriority = (obs) => {
      if (!obs.name || !Array.isArray(testSpec.match)) return 999;
      const obsLower = String(obs.name).toLowerCase();
      const idx = testSpec.match.findIndex(m => obsLower.includes(String(m).toLowerCase()));
      return idx < 0 ? 999 : idx;
    };
    matches.sort((a, b) => {
      const byDate = (b.date || '').localeCompare(a.date || '');
      if (byDate !== 0) return byDate;
      return matchPriority(a) - matchPriority(b);
    });
    return matches[0];
  }

  // === BP VALUE PARSING ===
  function parseBp(valueStr) {
    if (!valueStr) return null;
    const m = String(valueStr).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (!m) return null;
    return { systolic: parseInt(m[1], 10), diastolic: parseInt(m[2], 10) };
  }

  // === NUMERIC VALUE PARSING ===
  function parseNumeric(valueStr) {
    if (!valueStr) return null;
    const m = String(valueStr).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // === HRT PROGESTOGEN CONTEXT ===
  // For oestrogen-triggered HRT chips, annotate with whether the patient has
  // a hysterectomy, an IUS, or oral progestogen — so the clinician can see
  // at a glance whether progestogen coverage is documented or missing.
  function buildHrtContext(hrtConfig, data) {
    const norm = s => String(s || '').toLowerCase();
    const meds     = data.medications || [];
    const problems = data.problems    || [];
    // Hysterectomy may be coded as a past/ended problem — check both active and past
    const allProblems = [...problems, ...(data.pastProblems || [])];

    const hasHysterectomy = allProblems.some(p =>
      (hrtConfig.hysterectomyTerms || []).some(t => norm(p.label).includes(norm(t)))
    );

    const iusMed = meds.find(m =>
      (hrtConfig.iusTerms || []).some(t => norm(m.name).includes(norm(t)))
    ) || problems.find(p =>
      ([...(hrtConfig.iusTerms || []), ...(hrtConfig.iusProblemTerms || [])]).some(t => norm(p.label).includes(norm(t)))
    );

    const progestogenMed = meds.find(m =>
      (hrtConfig.progestogenTerms || []).some(t => norm(m.name).includes(norm(t)))
    );

    return {
      hasHysterectomy,
      iusMed:          iusMed          ? (iusMed.name || iusMed.label) : null,
      progestogenMed:  progestogenMed  ? progestogenMed.name           : null,
    };
  }

  // === REGISTER MEMBERSHIP ===
  // Register-term matcher. For plain alphanumeric/space terms we use a
  // word-boundary match so a short code like "tia" matches "TIA", "post TIA" or
  // "TIA 2024" but NOT a substring inside another word (e.g. "iniTIAte"). This
  // replaces the fragile space-padding hack (" tia ") that missed abbreviations
  // without surrounding spaces. Terms containing punctuation/operators
  // (e.g. "lvef <40", "type-2") fall back to substring matching, where \b is
  // unreliable.
  function registerTermInLabel(label, term) {
    const t = String(term || '').toLowerCase().trim();
    if (!t) return false;
    if (/^[a-z0-9 ]+$/.test(t)) {
      const rx = new RegExp('\\b' + t.replace(/\s+/g, '\\s+') + '\\b');
      return rx.test(label);
    }
    return label.includes(t);
  }

  function patientOnRegister(problems, registerRule) {
    if (!Array.isArray(problems) || !registerRule.problemMatch) return null;
    const excluded = registerRule.problemExclude || [];
    for (const p of problems) {
      const label = String(p.label || '').toLowerCase();
      // Exclusions — kept as broad substring matching (intentionally inclusive;
      // an exclude term like "non-diabetic"/"pre-diabetic" must catch compound
      // labels such as "pre-diabetic retinopathy").
      if (excluded.some(e => label.includes(String(e).toLowerCase()))) continue;
      // Matches — word-boundary aware (see registerTermInLabel).
      if (registerRule.problemMatch.some(m => registerTermInLabel(label, m))) {
        return { matched: true, problem: p };
      }
    }
    return { matched: false };
  }

  // === EVIDENCE BUILDERS ===
  // Each builder produces a chip.evidence = { summary, facts[], refs?, series? }
  // shape consumed by ChipRenderer.renderEvidencePanel.

  const STATUS_PHRASE = {
    overdue: 'overdue', not_met: 'not met', stale: 'severely overdue',
    due_soon: 'due soon', no_data: 'no data', recently_initiated: 'recently initiated',
    achieved: 'in date', in_date: 'in date',
    alert: 'alert', caution: 'caution', noted: 'noted'
  };

  function fmt(v) { return v == null || v === '' ? '—' : String(v); }

  function buildDrugMonitoringEvidence(rule, med, testEvaluations, worstStatus, data) {
    const facts = [];
    facts.push({ label: 'Drug matched', value: med.name, date: med.startDate || null });
    if (rule.drugClass) facts.push({ label: 'Class', value: rule.drugClass });

    const pat = data.patientContext || {};
    const patBits = [];
    if (pat.ageYears != null) patBits.push(`${pat.ageYears}y`);
    if (pat.sex) patBits.push(String(pat.sex));
    if (patBits.length) facts.push({ label: 'Patient', value: patBits.join(' · ') });

    testEvaluations.forEach(te => {
      const tName = te.testName || te.name || '';
      if (te.latestObs && te.latestObs.date) {
        const valPart = te.latestObs.value != null ? String(te.latestObs.value).trim() : '';
        const dueBit = (te.status === 'overdue' || te.status === 'stale') && te.days != null && te.intervalDays
          ? `due ${te.days - te.intervalDays}d ago`
          : (te.status === 'due_soon' && te.days != null && te.intervalDays
              ? `due in ${te.intervalDays - te.days}d`
              : `${te.days}d since`);
        facts.push({
          label: tName,
          value: valPart || STATUS_PHRASE[te.status] || te.status,
          date: te.latestObs.date,
          detail: `${dueBit} · interval ${te.intervalDays || 365}d · ${STATUS_PHRASE[te.status] || te.status}`
        });
      } else {
        facts.push({
          label: tName,
          value: 'not found in record',
          detail: `we looked for: ${(te.match || []).slice(0, 4).join(', ')}${(te.match || []).length > 4 ? '…' : ''} · interval ${te.intervalDays || 365}d`
        });
      }
    });

    if (med.startDate && testEvaluations.some(te => te.status === 'recently_initiated')) {
      facts.push({ label: 'Note', value: 'within recently-initiated grace window — monitoring not yet due' });
    }

    const summary = `${med.name} — ${STATUS_PHRASE[worstStatus] || worstStatus}`;
    return { summary, facts };
  }

  function buildDrugComboEvidence(rule, matchedPerSet, matchedRequiredProblems, data) {
    const facts = [];
    matchedPerSet.forEach((matched, i) => {
      const set = rule.drugSets[i] || {};
      facts.push({
        label: set.name || `Drug set ${i + 1}`,
        value: matched.map(m => m.name).join(', ')
      });
    });
    const pat = data.patientContext || {};
    const patBits = [];
    if (pat.ageYears != null) patBits.push(`age ${pat.ageYears}`);
    if (pat.sex) patBits.push(String(pat.sex));
    if (patBits.length) facts.push({ label: 'Patient', value: patBits.join(' · ') });

    if (rule.ageRange) {
      const r = rule.ageRange;
      const range = `${r.min != null ? r.min : ''}–${r.max != null ? r.max : ''}`;
      facts.push({ label: 'Age range required', value: range });
    }
    if (rule.sex && rule.sex !== 'any') facts.push({ label: 'Sex required', value: String(rule.sex) });

    matchedRequiredProblems.forEach(p => {
      facts.push({ label: 'Required problem', value: p.label, date: p.codedDate });
    });
    if ((rule.excludesProblem || []).length) {
      facts.push({ label: 'Excluded problems (none matched)', value: rule.excludesProblem.join(', ') });
    }
    if ((rule.mustNotBePresent || []).length) {
      facts.push({ label: 'Drugs that would block this rule (none present)', value: rule.mustNotBePresent.join(', ') });
    }

    const summary = matchedPerSet.map(matched => matched.map(m => m.name).join('/')).join(' + ');
    return { summary, facts };
  }

  function buildEventCountEvidence(rule, items, count, threshold, op, cutoffISO) {
    const facts = [];
    facts.push({ label: 'Count', value: `${count} ${op} ${threshold} (${rule.sourceKind || 'observations'})` });
    facts.push({ label: 'Window', value: `last ${rule.windowMonths || 12} months`, date: cutoffISO, detail: `from ${cutoffISO}` });
    if ((rule.match || []).length) facts.push({ label: 'Match terms', value: rule.match.join(', ') });
    if ((rule.exclude || []).length) facts.push({ label: 'Exclude terms', value: rule.exclude.join(', ') });
    items.slice(0, 15).forEach((it, i) => {
      const det = it.rawValue != null ? String(it.rawValue) : null;
      facts.push({ label: `#${i + 1}`, value: it.name || it.label || '', date: it.date || null, detail: det });
    });
    if (items.length > 15) facts.push({ label: '…', value: `+ ${items.length - 15} more` });
    return { summary: `${count} ${op} ${threshold} in last ${rule.windowMonths || 12}mo`, facts };
  }

  function buildCompositeEvidence(rule, ruleIds, firedIds, evaluatedById, allRules) {
    const labelById = {};
    (allRules || []).forEach(r => {
      if (!r.id) return;
      labelById[r.id] = r.label || r.indicatorName || r.drug?.match?.[0] || r.registerName || r.id;
    });
    const refs = ruleIds.map(id => {
      const fired = firedIds.includes(id);
      const chips = evaluatedById.get(id) || [];
      const labelFromChip = chips[0]?.label || chips[0]?.indicatorName || chips[0]?.drugName || chips[0]?.registerName;
      return { ruleId: id, label: labelFromChip || labelById[id] || id, fired };
    });
    const facts = [
      { label: 'Operator', value: rule.operator || 'AND' },
      { label: 'Fired', value: `${firedIds.length} of ${ruleIds.length}` }
    ];
    return { summary: `${rule.operator || 'AND'}: ${firedIds.length} of ${ruleIds.length} sub-rules fired`, facts, refs };
  }

  function buildQofIndicatorEvidence(rule, status, valueText, dateText, days, ctx) {
    const facts = [];
    const check = rule.check || {};

    if (ctx.matchedRegisterProblem) {
      facts.push({
        label: 'Register precondition',
        value: `${ctx.matchedRegisterProblem.registerName} (${ctx.matchedRegisterProblem.label})`,
        date: ctx.matchedRegisterProblem.codedDate
      });
    }

    if (check.kind === 'observation-threshold' || check.kind === 'observation-recent') {
      if (ctx.matchedObs) {
        facts.push({
          label: 'Observation',
          value: valueText || String(ctx.matchedObs.value || ''),
          date: ctx.matchedObs.date,
          detail: days != null ? `${days}d ago` : null
        });
      } else {
        facts.push({
          label: 'Observation',
          value: 'not found in record',
          detail: `we looked for: ${(check.observation || []).slice(0, 4).join(', ')}`
        });
      }
      if (check.thresholdSystolic && check.thresholdDiastolic) {
        facts.push({ label: 'Threshold', value: `≤ ${check.thresholdSystolic}/${check.thresholdDiastolic}` });
      } else if (check.threshold != null && check.operator) {
        facts.push({ label: 'Threshold', value: `${check.operator} ${check.threshold}${check.unit ? ' ' + check.unit : ''}` });
      }
      const useFloor = rule.useQofYearFloor !== false;
      facts.push({ label: 'Window', value: useFloor ? 'QOF year floor (1 Apr)' : `last ${check.withinDays || 365}d` });
    } else if (check.kind === 'medication-present') {
      facts.push({
        label: 'Medication',
        value: ctx.matchedMed || 'not prescribed',
        detail: `we looked for: ${(check.medicationMatch || []).slice(0, 4).join(', ')}`
      });
    } else if (check.kind === 'observation-trend') {
      const s = ctx.trendSeries;
      if (s && s.points && s.points.length) {
        facts.push({ label: 'Test', value: s.testName, detail: s.unit || null });
        if (s.insufficient) {
          facts.push({ label: 'Trend', value: `not enough readings in window — showing ${s.points.length} found (need ${check.minPoints || 2})` });
        }
        if (s.delta != null && s.spanMonths != null) {
          facts.push({ label: 'Direction', value: `${s.direction} (Δ ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(1)}${s.unit ? ' ' + s.unit : ''}, min ${s.minDelta})` });
          facts.push({ label: 'Span', value: `${s.spanMonths} months · ${s.points.length} points` });
        }
        s.points.forEach((p, i) => {
          facts.push({ label: `Point ${i + 1}`, value: `${p.value.toFixed(1)}${s.unit ? ' ' + s.unit : ''}`, date: p.date });
        });
      } else {
        facts.push({ label: 'Trend', value: valueText || 'insufficient data' });
      }
    }

    if ((rule.excludeIfProblem || []).length) {
      facts.push({ label: 'Excluded if (none matched)', value: rule.excludeIfProblem.join(', ') });
    }

    const phrase = STATUS_PHRASE[status] || status;
    const summary = `${rule.indicatorName || rule.indicatorCode || rule.id} — ${phrase}`;

    const evidence = { summary, facts };
    if (ctx.trendSeries) evidence.series = ctx.trendSeries;
    return evidence;
  }

  // === EVALUATORS ===

  // Drug-monitoring rule evaluator
  function evaluateDrugRule(rule, data, now) {
    if (!passesAgeFilter(rule.ageRange, data.patientContext)) return [];
    if (!passesSexFilter(rule.sex, data.patientContext)) return [];
    if (!passesProblemFilters(rule, data.problems)) return [];
    let matchedMeds = (data.medications || []).filter(m => drugMatchesRule(m.name, rule));
    // HRT gating: an HRT review only applies to systemic oestrogen / HRT agents
    // (estradiol, conjugated oestrogens, tibolone, etc.). A progestogen or
    // LNG-IUS on its own is contraception, not HRT, and must NOT raise an HRT
    // review chip (false BP+weight alert for, e.g., a 25y-old with a Mirena or a
    // POP). When a systemic oestrogen IS co-prescribed it is the oestrogen chip
    // that carries the progestogen-coverage context (built below), so emitting
    // chips only for the oestrogen component also avoids duplicate HRT chips.
    if (rule.hrtContext) {
      const oestrogenTerms = rule.hrtContext.oestrogenTerms || [];
      const isOestrogen = name => oestrogenTerms.some(
        t => normaliseDrugString(name).includes(normaliseDrugString(t)));
      matchedMeds = matchedMeds.filter(m => isOestrogen(m.name));
    }
    return matchedMeds.map(med => {
      const testEvaluations = (rule.tests || []).map(test => {
        const obs = findLatestObservation(data.observations, test);
        if (!obs || !obs.date) {
          return { ...test, status: 'no_data', latestObs: null, days: null };
        }
        const days = daysBetween(obs.date, now);
        // Malformed obs.date → null; null comparisons always false → would silently
        // fall through to 'in_date'. Surface as no_data (same as missing obs).
        if (days == null) {
          return { ...test, status: 'no_data', latestObs: obs, days: null };
        }
        const intervalDays = test.intervalDays || 365;
        const dueSoonDays = test.dueSoonDays || 30;
        const staleDays = intervalDays * 2;
        let status;
        if (days > staleDays) status = 'stale';
        else if (days > intervalDays) status = 'overdue';
        else if (days > intervalDays - dueSoonDays) status = 'due_soon';
        else status = 'in_date';
        return { ...test, status, latestObs: obs, days };
      });

      // Recently-initiated: if drug start date is within smallest interval, suppress no_data
      let suppressedNoData = false;
      if (med.startDate && rule.tests && rule.tests.length > 0) {
        const daysSinceStart = daysBetween(med.startDate, now);
        const minInterval = Math.min(...rule.tests.map(t => t.intervalDays || 365));
        if (daysSinceStart != null && daysSinceStart < minInterval / 2) {
          testEvaluations.forEach(te => { if (te.status === 'no_data') { te.status = 'recently_initiated'; suppressedNoData = true; } });
        }
      }

      const worstStatus = testEvaluations.reduce((worst, te) => {
        const rankCurrent = STATUS_RANK[te.status] ?? 99;
        const rankWorst = STATUS_RANK[worst] ?? 99;
        return rankCurrent < rankWorst ? te.status : worst;
      }, 'in_date');

      const chip = {
        type: 'drug-monitoring',
        ruleId: rule.id,
        drugName: med.name,
        drugClass: rule.drugClass || null,
        status: worstStatus,
        tests: testEvaluations,
        source: rule.source || null,
        sharedCare: !!rule.sharedCare,
        suppressedNoData,
        notes: rule.notes || null,
        evidence: buildDrugMonitoringEvidence(rule, med, testEvaluations, worstStatus, data)
      };

      // HRT-specific: annotate the oestrogen chip with progestogen-coverage
      // context (endometrial protection). matchedMeds is already filtered to
      // oestrogen/HRT agents above, so every HRT chip here is an oestrogen chip.
      if (rule.hrtContext) {
        chip.hrtContext = buildHrtContext(rule.hrtContext, data);
      }

      return chip;
    });
  }

  // QOF register rule evaluator -> chip if patient is on register
  function evaluateQofRegisterRule(rule, data) {
    if (!passesAgeFilter(rule.ageRange, data.patientContext)) return [];
    if (!passesSexFilter(rule.sex, data.patientContext)) return [];
    const result = patientOnRegister(data.problems, rule);
    if (!result || !result.matched) return [];
    return [{
      type: 'qof-register',
      ruleId: rule.id,
      registerCode: rule.registerCode,
      registerName: rule.registerName,
      status: 'achieved',  // membership = "on register" — neutral but rendered green
      matchedProblem: result.problem.label,
      codedDate: result.problem.codedDate,
      source: rule.source || null,
      notes: rule.notes || null,
      evidence: {
        summary: `On ${rule.registerName || rule.registerCode || 'register'} (matched: ${result.problem.label})`,
        facts: [
          { label: 'Register', value: rule.registerName || rule.registerCode || '' },
          { label: 'Matched problem', value: result.problem.label, date: result.problem.codedDate || null }
        ]
      }
    }];
  }

  // === SEVERITY → STATUS MAPPING ===
  // Maps the user-facing severity field on custom rules to status keys. Used by
  // the non-time-based rule types (drug-combo, event-count, composite) which fire
  // on presence / count / threshold, not on a recall interval. These must NOT
  // borrow the time-based vocabulary (OVERDUE / DUE SOON / IN DATE) — for a QTc
  // drug combination or a UTI count, nothing is "due" or "overdue". Instead they
  // map to alert / caution / noted, which carry the same red / amber / neutral
  // colour and ranking but read correctly for a flag.
  function severityToStatus(severity) {
    if (severity === 'red')   return 'alert';
    if (severity === 'amber') return 'caution';
    return 'noted';
  }

  // === AGE / SEX PATIENT FILTERS (shared by drug-combo and event-count) ===
  // IMPORTANT: these filters only EXCLUDE when the patient is *positively known*
  // to be out of scope. When age or sex cannot be determined from the record
  // (extraction returned null/unknown), we fail OPEN — the rule still fires and
  // the clinician verifies applicability. Failing closed on unknown demographics
  // silently suppressed safety alerts (e.g. MHRA valproate, female 12–55) and
  // age-gated QOF indicators whenever the page sex/DOB couldn't be scraped.
  function passesAgeFilter(ageRange, patientContext) {
    if (!ageRange) return true;
    const age = patientContext ? patientContext.ageYears : null;
    if (age == null) return true; // unknown age — do not suppress
    if (ageRange.min != null && age < ageRange.min) return false;
    if (ageRange.max != null && age > ageRange.max) return false;
    return true;
  }

  function passesSexFilter(sex, patientContext) {
    if (!sex || sex === 'any') return true;
    const patSex = patientContext ? String(patientContext.sex || '').toLowerCase() : '';
    if (!patSex) return true; // unknown sex — do not suppress
    const s = String(sex).toUpperCase();
    if (s === 'M' && !patSex.startsWith('m')) return false;
    if (s === 'F' && !patSex.startsWith('f')) return false;
    return true;
  }

  // Negation prefixes that disqualify a substring problem-match. A problem like
  // "no heart failure" or "family history of heart failure" should NOT satisfy
  // requiresProblem: ["heart failure"]. We check whether the match falls within
  // a negating context in the label.
  const PROBLEM_NEGATION_PATTERNS = [
    /\bno\s+/, /\bnot\s+/, /\bfamily history\s+of\s+/, /\bfh\s+of\s+/,
    /\bhistory of\s+/, /\bh\/?o\s+/, /\bpast\s+/, /\bprevious\s+/,
    /\bresolved\s+/, /\bat risk of\s+/, /\brisk of\s+/, /\bquery\s+/, /\b\?/
  ];
  function problemLabelMatchesTerm(label, term) {
    const l = String(label || '').toLowerCase();
    const t = String(term || '').toLowerCase();
    if (!t) return false;
    const idx = l.indexOf(t);
    if (idx < 0) return false;
    // Strip everything from the match onward; check the prefix for negation.
    const prefix = l.slice(0, idx);
    return !PROBLEM_NEGATION_PATTERNS.some(rx => rx.test(prefix));
  }

  // Shared problem-include / problem-exclude filter. Used by drug-monitoring,
  // drug-combo, event-count, qof-indicator. Returns true if patient passes.
  function passesProblemFilters(rule, problems) {
    const probs = problems || [];
    const requiresProblems = rule.requiresProblem || [];
    const excludesProblems = rule.excludesProblem || [];
    if (requiresProblems.length > 0) {
      const allMet = requiresProblems.every(req =>
        probs.some(p => problemLabelMatchesTerm(p.label, req))
      );
      if (!allMet) return false;
    }
    if (excludesProblems.some(exc =>
      probs.some(p => problemLabelMatchesTerm(p.label, exc))
    )) return false;
    return true;
  }

  // === DRUG-COMBO EVALUATOR ===
  // Fires when at least one drug from each drugSet is present in active medications,
  // AND the patient passes age/sex/problem filters.
  // Optional mustNotBePresent: any match in that list disqualifies the rule.
  function evaluateDrugComboRule(rule, data) {
    if (!passesAgeFilter(rule.ageRange, data.patientContext)) return [];
    if (!passesSexFilter(rule.sex, data.patientContext)) return [];

    const meds = data.medications || [];
    const norm = s => String(s || '').toLowerCase();

    // Problem filters (shared helper applies negation-aware substring matching:
    // "no heart failure" / "family history of HF" no longer satisfy requiresProblem)
    if (!passesProblemFilters(rule, data.problems)) return [];

    // mustNotBePresent: single-drug absence check (e.g. "no PPI prescribed")
    const mustNotBePresent = rule.mustNotBePresent || [];
    if (mustNotBePresent.length > 0) {
      const anyForbiddenPresent = mustNotBePresent.some(term =>
        meds.some(m => norm(m.name).includes(norm(term)))
      );
      if (anyForbiddenPresent) return [];
    }

    // Each drugSet must have at least one matching active medication
    if (!rule.drugSets || rule.drugSets.length === 0) return [];
    const matchedPerSet = (rule.drugSets || []).map(set => {
      if (!Array.isArray(set.match) || set.match.length === 0) return [];
      return meds.filter(m => {
        const n = norm(m.name);
        const excluded = (set.exclude || []).some(e => n.includes(norm(e)));
        if (excluded) return false;
        return set.match.some(term => n.includes(norm(term)));
      });
    });

    // All sets must have at least one match
    if (matchedPerSet.some(matched => matched.length === 0)) return [];

    // Distinct-drug guard: when drugSets overlap (e.g. QTc-prolonging A vs B
    // are the same list), a single matched med can satisfy every set. Require
    // the matched meds resolved across all sets to include at least one
    // distinct med per set. We check this greedily: assign the smallest match
    // pool to a set, mark that med as used, repeat. If any set ends with no
    // available med, the rule does not fire.
    if (rule.drugSets.length > 1) {
      const used = new Set();
      const setsByPoolSize = matchedPerSet
        .map((matched, i) => ({ i, matched }))
        .sort((a, b) => a.matched.length - b.matched.length);
      let ok = true;
      for (const { matched } of setsByPoolSize) {
        const pick = matched.find(m => !used.has(m.name));
        if (!pick) { ok = false; break; }
        used.add(pick.name);
      }
      if (!ok) return [];
    }

    const matchSummary = matchedPerSet.map((matched, i) => ({
      setName: (rule.drugSets[i] || {}).name || `Set ${i + 1}`,
      drugs:   matched.map(m => m.name)
    }));

    // Capture which required problems matched (for evidence panel)
    const matchedRequiredProblems = (rule.requiresProblem || []).map(req => {
      const probs = data.problems || [];
      const hit = probs.find(p => problemLabelMatchesTerm(p.label, req));
      return hit ? { term: req, label: hit.label, codedDate: hit.codedDate || null } : null;
    }).filter(Boolean);

    return [{
      type:        'drug-combo',
      ruleId:      rule.id,
      status:      severityToStatus(rule.severity),
      label:       rule.label || rule.id,
      matchSummary,
      source:      rule.source || null,
      notes:       rule.notes  || null,
      evidence:    buildDrugComboEvidence(rule, matchedPerSet, matchedRequiredProblems, data)
    }];
  }

  // === EVENT-COUNT EVALUATOR ===
  // Counts matching items (problems or observations) within a rolling time window
  // and fires when the count satisfies the threshold operator.
  //
  // For sourceKind === 'observations', uses data.observationHistory to count
  // individual historical readings (not just distinct test types).
  function evaluateEventCountRule(rule, data, now) {
    if (!passesAgeFilter(rule.ageRange, data.patientContext)) return [];
    if (!passesSexFilter(rule.sex, data.patientContext)) return [];

    const norm          = s => String(s || '').toLowerCase();
    // Window arithmetic uses the average Gregorian month (30.4375 days). This
    // means "12 months ago" is approximate — not aligned to the calendar date
    // — which keeps event-count and observation-trend consistent with each
    // other but differs from drug-monitoring (which uses calendar daysBetween).
    // Boundary is inclusive: a record dated exactly at cutoffMs is in-window.
    // Reject 0/negative explicitly — a 0 window collapses to "now exactly", silently
    // breaking the rule. Also reject NaN. Fall through to 12-month default for
    // missing/non-numeric values.
    const wm = Number(rule.windowMonths);
    const windowMs      = (Number.isFinite(wm) && wm > 0 ? wm : 12) * 30.4375 * 24 * 60 * 60 * 1000;
    const nowMs         = new Date(now).getTime();
    const cutoffMs      = nowMs - windowMs;
    const matchTerms    = rule.match  || [];
    const excludeTerms  = rule.exclude || [];

    let items = [];

    if (rule.sourceKind === 'problems') {
      // Problems have codedDate; we match label text
      items = (data.problems || []).filter(p => {
        const label = norm(p.label);
        if (excludeTerms.some(e => label.includes(norm(e)))) return false;
        if (!matchTerms.some(m => label.includes(norm(m)))) return false;
        const d = new Date(p.codedDate || '');
        return !isNaN(d.getTime()) && d.getTime() >= cutoffMs;
      });
    } else {
      // sourceKind === 'observations': flatten observationHistory into individual readings.
      // Each history entry represents one recorded result on a specific date.
      // First, find matching investigation types, then collect their in-window readings.
      const matchedEntries = (data.observationHistory || []).filter(entry => {
        const name = norm(entry.name);
        if (excludeTerms.some(e => name.includes(norm(e)))) return false;
        return matchTerms.some(m => name.includes(norm(m)));
      });
      // Flatten to individual { name, date } items for count and chip summary
      matchedEntries.forEach(entry => {
        (entry.history || []).forEach(pt => {
          const d = new Date(pt.date || '');
          if (isNaN(d.getTime()) || d.getTime() < cutoffMs) return;
          items.push({ name: entry.name, date: pt.date, rawValue: pt.rawValue });
        });
      });
    }

    const count = items.length;
    const threshold = rule.countThreshold;
    const op = rule.operator;
    const validOps = ['>=', '>', '=', '<=', '<'];
    if (!validOps.includes(op)) {
      console.warn(`[Sentinel] event-count rule "${rule.label || rule.id}" has unknown operator "${op}" — rule will never fire`);
      return [];
    }
    let fires = false;
    if (op === '>=') fires = count >= threshold;
    else if (op === '>')  fires = count >  threshold;
    else if (op === '=')  fires = count === threshold;
    else if (op === '<=') fires = count <= threshold;
    else if (op === '<')  fires = count <  threshold;

    if (!fires) return [];

    return [{
      type:        'event-count',
      ruleId:      rule.id,
      status:      severityToStatus(rule.severity),
      label:       rule.label || rule.id,
      count,
      countThreshold: threshold,
      operator:    op,
      windowMonths: rule.windowMonths,
      matchedItems: items.slice(0, 10).map(it => it.date ? `${it.name} ${it.date}` : (it.label || it.name || '')),
      notes:       rule.notes || null,
      source:      rule.source || null,
      evidence:    buildEventCountEvidence(rule, items, count, threshold, op, new Date(cutoffMs).toISOString().slice(0, 10))
    }];
  }

  // === COMPOSITE EVALUATOR ===
  // Combines results of other rules by AND (all must fire) or OR (any must fire).
  // evaluatedById is a Map<ruleId, chip[]> built by evaluatePatient before composites run.
  // Composite rules silently skip if any referenced ruleId is not found.
  // Composite rules cannot reference other composite rules (validated here at runtime).
  function evaluateCompositeRule(rule, allRules, evaluatedById) {
    const ruleIds = rule.ruleIds || [];
    if (ruleIds.length === 0) return [];

    // Build a lookup of rule type by id to guard against composite→composite references
    const ruleTypeById = {};
    (allRules || []).forEach(r => { if (r.id) ruleTypeById[r.id] = r.type; });

    const results = ruleIds.map(id => {
      if (ruleTypeById[id] === 'composite') {
        // Silently skip — composite cannot reference composite (prevents infinite recursion)
        return null;
      }
      if (!evaluatedById.has(id)) {
        // Referenced rule not found (may have been deleted) — skip silently
        return null;
      }
      return evaluatedById.get(id);
    });

    // If any referenced rule resolved to null (missing or composite ref), skip the whole rule
    // only when operator is AND; for OR, still allow if at least one resolved.
    const resolved = results.filter(r => r !== null);
    if (resolved.length === 0) return [];

    let fires = false;
    if (rule.operator === 'AND') {
      // All referenced (and resolvable) rules must have fired (non-empty chips)
      if (resolved.length < ruleIds.length) return []; // some were missing/skipped
      fires = resolved.every(chips => chips.length > 0);
    } else {
      // OR: any referenced rule that fired is sufficient
      fires = resolved.some(chips => chips.length > 0);
    }

    if (!fires) return [];

    const firedIds = ruleIds.filter(id => {
      const chips = evaluatedById.get(id);
      return chips && chips.length > 0;
    });
    return [{
      type:      'composite',
      ruleId:    rule.id,
      status:    severityToStatus(rule.severity),
      label:     rule.label || rule.id,
      operator:  rule.operator,
      firedRuleIds: firedIds,
      notes:     rule.notes  || null,
      source:    rule.source || null,
      evidence:  buildCompositeEvidence(rule, ruleIds, firedIds, evaluatedById, allRules)
    }];
  }

  // QOF indicator rule evaluator
  function evaluateQofIndicatorRule(rule, data, now) {
    // evidenceCtx accumulates the matched data the evaluator consults so the
    // evidence panel can show "we looked here, we found X" without re-running
    // the match logic.
    const evidenceCtx = { matchedRegisterProblem: null, matchedObs: null, matchedMed: null, trendSeries: null };

    // Step 1: register membership precondition
    if (rule.requiresRegister) {
      const registerRule = (data._registerLookup || {})[rule.requiresRegister];
      if (!registerRule) return [];  // register rule not configured/disabled
      const reg = patientOnRegister(data.problems, registerRule);
      if (!reg || !reg.matched) return [];
      evidenceCtx.matchedRegisterProblem = { label: reg.problem.label, codedDate: reg.problem.codedDate || null, registerName: registerRule.registerName || registerRule.registerCode };
    }

    // Step 2: age + sex constraints. Age is FAIL-OPEN — an unknown/unextractable
    // age must NOT silently suppress an indicator (a missing chip is a worse
    // failure than an extra one). This mirrors passesAgeFilter used by the
    // drug-monitoring and register evaluators; previously this block was
    // fail-closed (returned [] when age was null), so age-gated indicators
    // vanished whenever age couldn't be read.
    if (!passesAgeFilter(rule.ageRange, data.patientContext)) return [];
    if (!passesSexFilter(rule.sex, data.patientContext)) return [];

    // Step 3: problem-based requirements & exclusions. All matching is
    // negation-aware (problemLabelMatchesTerm) so "no frailty", "family history
    // of stroke", "?CVD" etc. neither satisfy a requirement nor trigger an
    // exclusion. Previously requiresProblem/requiresAnyProblem were ignored here,
    // so frailty/CVD-stratified indicators (DM021, DM035) fired for every
    // register member and showed the wrong target.
    const probs = data.problems || [];
    // requiresProblem: ALL listed problems must be present (conjunctive).
    if (Array.isArray(rule.requiresProblem) && rule.requiresProblem.length) {
      const allMet = rule.requiresProblem.every(req =>
        probs.some(p => problemLabelMatchesTerm(p.label, req)));
      if (!allMet) return [];
    }
    // requiresAnyProblem: AT LEAST ONE listed problem must be present (disjunctive)
    // — e.g. the DM035 secondary-prevention cohort = any coded CVD problem.
    if (Array.isArray(rule.requiresAnyProblem) && rule.requiresAnyProblem.length) {
      const anyMet = rule.requiresAnyProblem.some(req =>
        probs.some(p => problemLabelMatchesTerm(p.label, req)));
      if (!anyMet) return [];
    }
    // excludeIfProblem: any negation-aware match disqualifies (e.g. frailty).
    if (Array.isArray(rule.excludeIfProblem) && rule.excludeIfProblem.length) {
      const hit = probs.some(p =>
        rule.excludeIfProblem.some(e => problemLabelMatchesTerm(p.label, e)));
      if (hit) return [];
    }

    // Step 4: evaluate the check
    const check = rule.check || {};
    let status = 'no_data';
    let valueText = null;
    let dateText = null;
    let days = null;

    // observation-alert: a clinical-safety threshold alert (not a QOF achievement
    // indicator). Reads the latest matching observation value and fires ONLY when
    // it crosses a danger band — amber for the lower band, red for the upper band.
    // Returns no chip when the value is in the safe range, stale, or absent, so it
    // never adds green "MET" noise. comparator 'above' = high values are dangerous
    // (e.g. potassium); 'below' = low values are dangerous.
    if (check.kind === 'observation-alert') {
      const obs = findLatestObservation(data.observations, { match: check.observation });
      if (!obs || !obs.date) return [];
      // Unparseable date: new Date(invalid) gives NaN; the stale check `< _cutoff`
      // is false for NaN so an invalid date would pass the stale gate and fire.
      // Treat the same as a missing date — stale result, do not alert.
      if (isNaN(new Date(obs.date).getTime())) return [];
      const v = parseNumeric(obs.value);
      if (v == null) return [];
      const _withinDays = check.withinDays || 365;
      const _cutoff = new Date(now);
      _cutoff.setDate(_cutoff.getDate() - _withinDays);
      if (new Date(obs.date) < _cutoff) return []; // stale result — do not alert
      const cmp = check.comparator || 'above';
      let sev = null;
      if (cmp === 'above') {
        if (check.red != null && v >= check.red) sev = 'red';
        else if (check.amber != null && v >= check.amber) sev = 'amber';
      } else if (cmp === 'below') {
        if (check.red != null && v <= check.red) sev = 'red';
        else if (check.amber != null && v <= check.amber) sev = 'amber';
      }
      if (!sev) return []; // within safe range — no chip
      const unit = check.unit ? ` ${check.unit}` : '';
      const alertValueText = `${v}${unit}`;
      const alertStatus = severityToStatus(sev);
      const alertDays = daysBetween(obs.date, now);
      evidenceCtx.matchedObs = { name: obs.name || (check.observation || [])[0] || '', value: obs.value, date: obs.date };
      return [{
        type: 'qof-indicator',
        ruleId: rule.id,
        indicatorCode: rule.indicatorCode,
        indicatorName: rule.indicatorName,
        status: alertStatus,
        requiresRegister: rule.requiresRegister || null,
        points: null,
        thresholds: null,
        valueText: alertValueText,
        dateText: obs.date,
        days: alertDays,
        qofYear: qofYearLabel(now),
        qofYearStart: qofYearStart(now).toISOString().slice(0, 10),
        check: rule.check,
        source: rule.source || null,
        notes: rule.notes || null,
        evidence: buildQofIndicatorEvidence(rule, alertStatus, alertValueText, obs.date, alertDays, evidenceCtx)
      }];
    }

    if (check.kind === 'observation-threshold') {
      const obs = findLatestObservation(data.observations, { match: check.observation });
      // Reject unparseable dates: NaN < _qofStart is false so an invalid date
      // would bypass the window check and surface a spurious 'achieved'/'not_met'.
      if (obs && obs.date && !isNaN(new Date(obs.date).getTime())) {
        evidenceCtx.matchedObs = { name: obs.name || (check.observation || [])[0] || '', value: obs.value, date: obs.date };
        days = daysBetween(obs.date, now);
        dateText = obs.date;
        // Boundary check: by default bundled QOF indicators apply the 1 Apr – 31 Mar
        // QOF year floor. Custom indicators can opt out by setting
        // useQofYearFloor: false on the rule, in which case the rolling
        // check.withinDays window is used instead.
        const _obsDate = new Date(obs.date);
        const _qofStart = qofYearStart(now);
        const _useFloor = rule.useQofYearFloor !== false;
        const _withinDays = check.withinDays || 365;
        const _rollingCutoff = new Date(now);
        _rollingCutoff.setDate(_rollingCutoff.getDate() - _withinDays);
        const _outOfWindow = _useFloor
          ? _obsDate < _qofStart
          : _obsDate < _rollingCutoff;
        if (_outOfWindow) {
          status = 'overdue';
        } else if (check.thresholdSystolic && check.thresholdDiastolic) {
          const bp = parseBp(obs.value);
          if (bp) {
            valueText = `${bp.systolic}/${bp.diastolic}`;
            if (bp.systolic <= check.thresholdSystolic && bp.diastolic <= check.thresholdDiastolic) {
              status = 'achieved';
            } else {
              status = 'not_met';
            }
          } else {
            status = 'no_data';
          }
        } else if (check.threshold != null && check.operator) {
          const v = parseNumeric(obs.value);
          if (v != null) {
            valueText = check.unit ? `${v} ${check.unit}` : String(v);
            const op = check.operator;
            if (op === '<=' && v <= check.threshold) status = 'achieved';
            else if (op === '<' && v < check.threshold) status = 'achieved';
            else if (op === '>=' && v >= check.threshold) status = 'achieved';
            else if (op === '>' && v > check.threshold) status = 'achieved';
            else status = 'not_met';
          }
        }
      }
    } else if (check.kind === 'medication-present') {
      const matchTerms = check.medicationMatch || [];
      const excludeTerms = check.medicationExclude || [];
      const foundMed = (data.medications || []).find(m => {
        const norm = normaliseDrugString(m.name);
        if (excludeTerms.some(t => norm.includes(normaliseDrugString(t)))) return false;
        return matchTerms.some(t => norm.includes(normaliseDrugString(t)));
      });
      if (foundMed) evidenceCtx.matchedMed = foundMed.name;
      status = foundMed ? 'achieved' : 'not_met';
    } else if (check.kind === 'observation-recent') {
      const obs = findLatestObservation(data.observations, { match: check.observation });
      // Reject unparseable dates: NaN >= _qofStart is false so an invalid date
      // would produce 'overdue' (conservative but misleading — treat as no data).
      if (obs && obs.date && !isNaN(new Date(obs.date).getTime())) {
        evidenceCtx.matchedObs = { name: obs.name || (check.observation || [])[0] || '', value: obs.value, date: obs.date };
        days = daysBetween(obs.date, now);
        dateText = obs.date;
        // Capture the recorded value so the chip can show e.g. "Weight: 87 kg ·
        // 12 Mar 2025" instead of just the date. observation-threshold sets
        // this already; observation-recent was the gap that left in-date
        // chips (HRT review, smoking status, etc.) value-less.
        if (obs.value != null) valueText = String(obs.value).trim();
        // Boundary check — supports useQofYearFloor opt-out (see threshold case above)
        const _obsDate2 = new Date(obs.date);
        const _qofStart2 = qofYearStart(now);
        const _useFloor2 = rule.useQofYearFloor !== false;
        const _withinDays2 = check.withinDays || 365;
        const _rollingCutoff2 = new Date(now);
        _rollingCutoff2.setDate(_rollingCutoff2.getDate() - _withinDays2);
        const _inWindow = _useFloor2
          ? _obsDate2 >= _qofStart2
          : _obsDate2 >= _rollingCutoff2;
        if (_inWindow) status = 'achieved';
        else status = 'overdue';
      }
    } else if (check.kind === 'observation-bundle') {
      // observation-bundle: checks that EACH observation group (array of name aliases)
      // has a matching result within the QOF window. Used by DM037 to verify all 8
      // care processes were recorded this QOF year.
      const bundleGroups = check.observations || [];
      const _useFloorB = rule.useQofYearFloor !== false;
      const _withinDaysB = check.withinDays || 365;
      const _qofStartB = qofYearStart(now);
      const _rollingCutoffB = new Date(now);
      _rollingCutoffB.setDate(_rollingCutoffB.getDate() - _withinDaysB);
      const bundleResults = bundleGroups.map(aliases => {
        const obs = findLatestObservation(data.observations, { match: aliases });
        if (!obs || !obs.date) return { aliases, obs: null, inWindow: false };
        const obsDate = new Date(obs.date);
        const inWindow = _useFloorB ? obsDate >= _qofStartB : obsDate >= _rollingCutoffB;
        return { aliases, obs, inWindow };
      });
      const metCount = bundleResults.filter(r => r.inWindow).length;
      const totalCount = bundleResults.length;
      if (check.requireAll) {
        if (metCount === totalCount) {
          status = 'achieved';
        } else if (metCount === 0) {
          status = 'no_data';
        } else {
          status = 'not_met';
        }
      } else {
        status = metCount > 0 ? 'achieved' : 'no_data';
      }
      valueText = `${metCount}/${totalCount} care processes`;
      // Most recent observation date across all matched groups
      const latestBundleDate = bundleResults
        .filter(r => r.obs && r.obs.date)
        .map(r => r.obs.date)
        .sort()
        .pop() || null;
      dateText = latestBundleDate;
      if (latestBundleDate) days = daysBetween(latestBundleDate, now);
      evidenceCtx.bundleResults = bundleResults;
    } else if (check.kind === 'observation-trend') {
      // Find matching investigation history entries; multiple substrings may match
      // distinct test types (e.g. "PSA" matches both "PSA" and "PSA free/total ratio").
      // Pick the entry with the most data points so the trend uses the richest series.
      // BP-style "120/80" values are not supported in trend mode — they parse to NaN
      // in observationHistory and get filtered below.
      const normStr = s => String(s || '').toLowerCase();
      const matchTerms = check.observation || [];
      const candidates = (data.observationHistory || []).filter(entry => {
        const name = normStr(entry.name);
        return matchTerms.some(m => name.includes(normStr(m)));
      });
      const historyEntry = candidates.length === 0
        ? null
        : candidates.reduce((a, b) => (b.history?.length || 0) > (a.history?.length || 0) ? b : a);

      if (historyEntry && historyEntry.history && historyEntry.history.length > 0) {
        // Filter history to within check.withinMonths of now
        const withinMs = (check.withinMonths || 24) * 30.4375 * 24 * 60 * 60 * 1000;
        const nowMs    = new Date(now).getTime();
        const cutoffMs = nowMs - withinMs;
        const inWindow = historyEntry.history.filter(pt => {
          const d = new Date(pt.date || '');
          if (isNaN(d.getTime()) || d.getTime() < cutoffMs) return false;
          // isFinite excludes NaN AND Infinity; protects subsequent arithmetic
          return isFinite(pt.value);
        });

        if (inWindow.length < (check.minPoints || 2)) {
          // Not enough data points in the window for a meaningful trend.
          status = 'no_data';
          valueText = `${inWindow.length} point${inWindow.length !== 1 ? 's' : ''} in window (need ${check.minPoints || 2})`;
          // Still surface the readings we DID find so the evidence panel shows the
          // provenance (what values exist) rather than a bare "insufficient data".
          // Prefer in-window readings; if none, fall back to the most recent few
          // from the full history so the clinician can see the actual values.
          const provenance = (inWindow.length ? inWindow : historyEntry.history.slice(0, 6))
            .filter(pt => isFinite(pt.value));
          if (provenance.length) {
            // history is newest-first; reverse to oldest→newest for display.
            const ordered = provenance.slice().reverse();
            const pNewest = ordered[ordered.length - 1].value;
            const pOldest = ordered[0].value;
            const pSpan = Math.round(
              (new Date(ordered[ordered.length - 1].date) - new Date(ordered[0].date)) /
              (30.4375 * 24 * 60 * 60 * 1000)
            );
            evidenceCtx.trendSeries = {
              testName: historyEntry.name,
              unit: historyEntry.unit || '',
              points: ordered.map(p => ({ date: p.date, value: p.value })),
              delta: ordered.length >= 2 ? (pNewest - pOldest) : null,
              direction: check.direction || 'rising',
              minDelta: check.minDelta != null ? check.minDelta : 0,
              spanMonths: ordered.length >= 2 ? pSpan : null,
              fires: false,
              insufficient: true
            };
          }
        } else {
          // History is sorted newest-first; first entry is most recent, last is oldest.
          // Trend direction: compare oldest value to newest value overall.
          // Using first-vs-last comparison (not regression) — simpler and less noisy
          // for the kind of sparse GP data seen in Medicus (3–6 points typical).
          const newest = inWindow[0].value;                       // most recent reading
          const oldest = inWindow[inWindow.length - 1].value;    // earliest reading
          const delta  = newest - oldest;                        // positive = rising
          // minDelta default 0 means "any movement in the named direction fires".
          // The strict-inequality check on delta below prevents a flat line
          // (delta exactly 0) from firing as either rising or falling.
          const minDelta = check.minDelta != null ? check.minDelta : 0;
          const spanMonths = Math.round(
            (new Date(inWindow[0].date) - new Date(inWindow[inWindow.length - 1].date)) /
            (30.4375 * 24 * 60 * 60 * 1000)
          );
          const direction = check.direction || 'rising';
          // Trend fires only when delta moves strictly in the named direction AND meets minDelta.
          // Strict inequality on delta prevents a flat line firing as either direction.
          const trendFires =
            direction === 'rising'  ? (delta > 0 && delta >=  minDelta) :
            direction === 'falling' ? (delta < 0 && delta <= -minDelta) :
            false;

          const unit = historyEntry.unit ? ` ${historyEntry.unit}` : '';
          const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
          valueText = `${oldest.toFixed(1)} → ${newest.toFixed(1)}${unit} (${deltaStr}, ${inWindow.length} pts, ${spanMonths} mo)`;
          dateText  = inWindow[0].date;

          evidenceCtx.trendSeries = {
            testName: historyEntry.name,
            unit: historyEntry.unit || '',
            points: inWindow.slice().reverse().map(p => ({ date: p.date, value: p.value })),
            delta, direction, minDelta, spanMonths, fires: trendFires
          };

          status = trendFires ? 'not_met' : 'achieved';
        }
      }
      // status remains 'no_data' when no history entry found or history array is empty
    }

    return [{
      type: 'qof-indicator',
      ruleId: rule.id,
      indicatorCode: rule.indicatorCode,
      indicatorName: rule.indicatorName,
      status,
      requiresRegister: rule.requiresRegister || null,
      points: rule.points || null,
      thresholds: rule.thresholds || null,
      valueText,
      dateText,
      days,
      qofYear: qofYearLabel(now),        // e.g. "2025/26" — used by UI for context
      qofYearStart: qofYearStart(now).toISOString().slice(0, 10),
      check: rule.check,
      source: rule.source || null,
      notes: rule.notes || null,
      evidence: buildQofIndicatorEvidence(rule, status, valueText, dateText, days, evidenceCtx)
    }];
  }

  // === MAIN ENTRY ===
  function evaluatePatient(medications, observations, rules, options) {
    options = options || {};
    const now = options.now || new Date().toISOString();
    const problems = options.problems || [];
    const patientContext = options.patientContext || null;
    // observationHistory: full multi-point history per investigation type.
    // Populated from the investigation dashboard's dataYYYYMMDD keys by the normaliser.
    // Falls back to empty array when not available (DOM fallback, mock, old callers).
    const observationHistory = options.observationHistory || [];

    const data = { medications, observations, observationHistory, problems, patientContext };

    // Pre-build register lookup for indicator rules
    const registerLookup = {};
    (rules || []).forEach(r => {
      if (r.type === 'qof-register' && r.enabled !== false && r.registerCode) {
        registerLookup[r.registerCode] = r;
      }
    });
    data._registerLookup = registerLookup;

    const chips = [];
    // evaluatedById is keyed by ruleId -> chips[] so composite rules can inspect
    // whether other rules fired. Composites are evaluated last (after the loop).
    const evaluatedById = new Map();

    (rules || []).forEach(rule => {
      if (rule.enabled === false) return;
      const type = rule.type || 'drug-monitoring';
      // Composite rules are collected separately and evaluated after all other rules.
      if (type === 'composite') return;
      let out = [];
      if (type === 'drug-monitoring')  out = evaluateDrugRule(rule, data, now);
      else if (type === 'qof-register')  out = evaluateQofRegisterRule(rule, data);
      else if (type === 'qof-indicator') out = evaluateQofIndicatorRule(rule, data, now);
      else if (type === 'drug-combo')    out = evaluateDrugComboRule(rule, data);
      else if (type === 'event-count')   out = evaluateEventCountRule(rule, data, now);
      else if (type === 'vaccine')       out = evaluateVaccineRule(rule, data, now);
      chips.push(...out);
      if (rule.id) evaluatedById.set(rule.id, out);
    });

    // Evaluate composite rules last so all referenced rule results are available.
    (rules || []).forEach(rule => {
      if (rule.enabled === false) return;
      if ((rule.type || '') !== 'composite') return;
      const out = evaluateCompositeRule(rule, rules, evaluatedById);
      chips.push(...out);
      if (rule.id) evaluatedById.set(rule.id, out);
    });

    // Sort: worst status first; then by type to keep drug-monitoring grouped
    chips.sort((a, b) => {
      const sa = STATUS_RANK[a.status] ?? 99;
      const sb = STATUS_RANK[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return (a.type || '').localeCompare(b.type || '');
    });

    return chips;
  }

  function seasonStart(nowIso, startMonth, startDay) {
    // Use Date.UTC throughout so the returned YYYY-MM-DD is exactly the
    // configured month/day regardless of the browser/host timezone (BST would
    // shift a local-midnight Date into the previous UTC day).
    const nowDatePart = String(nowIso).slice(0, 10); // "YYYY-MM-DD"
    let year = parseInt(nowDatePart.slice(0, 4), 10);
    // Build the candidate season start as a UTC date string for comparison.
    const pad2 = n => String(n).padStart(2, '0');
    const candidateStr = `${year}-${pad2(startMonth)}-${pad2(startDay)}`;
    // If the candidate is in the future (relative to now's date part), use last year.
    if (candidateStr > nowDatePart) year -= 1;
    return `${year}-${pad2(startMonth)}-${pad2(startDay)}`;
  }

  function matchesAnyTerm(str, terms) {
    const s = String(str || '').toLowerCase();
    return terms.some(t => s.includes(t.toLowerCase()));
  }

  function vaccineEventInWindow(rule, data, seasonStartIso) {
    const givenTerms = rule.statusTerms?.given || [];
    const declinedTerms = rule.statusTerms?.declined || [];
    // Search problems
    for (const p of (data.problems || [])) {
      if (!p.label) continue;
      const d = p.codedDate || '';
      if (d && d < seasonStartIso) continue;
      if (matchesAnyTerm(p.label, givenTerms)) return { type: 'given', date: d, source: 'problem' };
      if (matchesAnyTerm(p.label, declinedTerms)) return { type: 'declined', date: d, source: 'problem' };
    }
    // Search observations (name and value)
    for (const o of (data.observations || [])) {
      const d = o.date || '';
      if (d && d < seasonStartIso) continue;
      if (matchesAnyTerm(o.name, givenTerms)) return { type: 'given', date: d, source: 'observation' };
      if (matchesAnyTerm(o.name, declinedTerms)) return { type: 'declined', date: d, source: 'observation' };
    }
    // Search observationHistory (journal entries in history)
    for (const h of (data.observationHistory || [])) {
      if (matchesAnyTerm(h.name, givenTerms)) {
        const latest = (h.history || []).find(pt => pt.date && pt.date >= seasonStartIso);
        if (latest) return { type: 'given', date: latest.date, source: 'history' };
      }
      if (matchesAnyTerm(h.name, declinedTerms)) {
        const latest = (h.history || []).find(pt => pt.date && pt.date >= seasonStartIso);
        if (latest) return { type: 'declined', date: latest.date, source: 'history' };
      }
    }
    return null;
  }

  function matchVaccineEligibility(rule, data) {
    const ctx = data.patientContext || {};
    const age = Number.isFinite(ctx.ageYears) ? ctx.ageYears : (Number.isFinite(ctx.age) ? ctx.age : null);
    const sex = (ctx.sex || ctx.gender || '').toLowerCase();

    for (const clause of (rule.eligibility?.anyOf || [])) {
      const k = clause.kind;

      if (k === 'age') {
        if (age == null) continue;
        const ok = (clause.ageMin == null || age >= clause.ageMin) &&
                   (clause.ageMax == null || age <= clause.ageMax);
        if (ok) return clause;
      }

      if (k === 'problem') {
        if (clause.sex && sex && clause.sex !== sex[0]) continue;
        const terms = clause.match || [];
        const hit = (data.problems || []).find(p =>
          p.status !== 'inactive' && matchesAnyTerm(p.label, terms));
        if (hit) return { ...clause, matchedEvidence: `${clause.label}: ${hit.label}` };
      }

      if (k === 'register') {
        const regs = clause.registers || [];
        let matchedReg = null;
        for (const code of regs) {
          const regRule = (data._registerLookup || {})[code];
          if (!regRule) continue;
          const res = patientOnRegister(data.problems, regRule);
          if (res && res.matched) {
            matchedReg = { regRule, problem: res.problem };
            break;
          }
        }
        if (matchedReg) {
          const regName = matchedReg.regRule.registerName || matchedReg.regRule.registerCode;
          const probLabel = matchedReg.problem && matchedReg.problem.label;
          const detail = probLabel
            ? `${clause.label}: ${probLabel} (${regName} register)`
            : `${clause.label}: ${regName} register`;
          return { ...clause, matchedEvidence: detail };
        }
      }

      if (k === 'medication') {
        const terms = clause.match || [];
        const hit = (data.medications || []).find(m => matchesAnyTerm(m.name, terms));
        if (hit) return { ...clause, matchedEvidence: `${clause.label}: ${hit.name}` };
      }

      if (k === 'observation-threshold') {
        const obsNames = clause.observation || [];
        const obs = (data.observations || []).find(o =>
          obsNames.some(n => (o.name || '').toLowerCase().includes(n.toLowerCase())));
        if (obs) {
          const val = parseNumeric(obs.value);
          const op = clause.operator || '>=';
          const threshold = clause.value;
          const met = op === '>=' ? val >= threshold :
                      op === '>'  ? val >  threshold :
                      op === '<=' ? val <= threshold :
                      op === '<'  ? val <  threshold : false;
          if (met) {
            const unit = obs.unit ? ` ${obs.unit}` : '';
            return { ...clause, matchedEvidence: `${clause.label}: ${obs.name} ${val}${unit}` };
          }
        }
      }

      if (k === 'conditional-register') {
        // Register must be active
        const regRule = (data._registerLookup || {})[clause.register];
        if (!regRule) continue;
        const regRes = patientOnRegister(data.problems, regRule);
        if (!regRes || !regRes.matched) continue;
        // AND any of the sub-conditions — capture which one hit
        let subDetail = null;
        for (const sub of (clause.andAnyOf || [])) {
          if (sub.medication) {
            const m = (data.medications || []).find(med => matchesAnyTerm(med.name, sub.medication));
            if (m) { subDetail = m.name; break; }
          }
          if (sub.problem) {
            const p = (data.problems || []).find(pr =>
              pr.status !== 'inactive' && matchesAnyTerm(pr.label, sub.problem));
            if (p) { subDetail = p.label; break; }
          }
        }
        if (subDetail) {
          const regName = regRule.registerName || regRule.registerCode;
          return { ...clause, matchedEvidence: `${clause.label}: ${subDetail} (${regName} register)` };
        }
      }
    }
    return null;
  }

  function evaluateVaccineRule(rule, data, nowIso) {
    if (rule.enabled === false) return [];
    const matchedClause = matchVaccineEligibility(rule, data);
    if (!matchedClause) return [];

    const startIso = seasonStart(nowIso, rule.season.startMonth, rule.season.startDay || 1);
    const evt = vaccineEventInWindow(rule, data, startIso);

    const status = evt ? (evt.type === 'given' ? 'vax_given' : 'vax_declined') : 'vax_due';

    const seasonYear = startIso.slice(0, 4);
    const seasonLabel = `${seasonYear}/${String(Number(seasonYear) + 1).slice(2)}`;

    const eligibilityDetail = matchedClause.matchedEvidence || matchedClause.label;
    const evidenceParts = [`${rule.displayName} — ${eligibilityDetail}`];
    if (evt) evidenceParts.push(`${evt.type === 'given' ? 'Given' : 'Declined'}: ${evt.date || 'date unknown'}`);
    else evidenceParts.push(`No record in ${seasonLabel} season (from ${startIso})`);
    if (rule.notes) evidenceParts.push(rule.notes);

    return [{
      type: 'vaccine',
      ruleId: rule.id,
      vaccine: rule.vaccine,
      displayName: rule.displayName,
      status,
      eligibilityReason: matchedClause.label,
      matchedEvidence: matchedClause.matchedEvidence || null,
      eventDate: evt ? evt.date : null,
      seasonLabel,
      seasonStartIso: startIso,
      evidence: {
        summary: `${rule.displayName} · ${eligibilityDetail}`,
        facts: evidenceParts
      },
      source: rule.source || '',
      notes: rule.notes || ''
    }];
  }

  const api = {
    evaluatePatient,
    drugMatchesRule,
    findLatestObservation,
    daysBetween,
    qofYearStart,
    qofYearLabel,
    parseBp,
    parseNumeric,
    patientOnRegister,
    evaluateDrugRule,
    evaluateQofRegisterRule,
    evaluateQofIndicatorRule,
    evaluateDrugComboRule,
    evaluateEventCountRule,
    evaluateCompositeRule,
    evaluateVaccineRule,
    severityToStatus,
    STATUS_RANK,
    seasonStart
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelRules = api;
  }
})(typeof window !== 'undefined' ? window : global);
