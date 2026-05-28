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
  const STATUS_RANK = {
    overdue: 0,
    not_met: 0,
    stale: 1,
    due_soon: 2,
    no_data: 3,
    recently_initiated: 4,
    achieved: 5,
    in_date: 5
  };

  // === DRUG MATCHING ===
  function normaliseDrugString(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
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
    matches.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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

    const hasHysterectomy = problems.some(p =>
      (hrtConfig.hysterectomyTerms || []).some(t => norm(p.label).includes(norm(t)))
    );

    const iusMed = meds.find(m =>
      (hrtConfig.iusTerms || []).some(t => norm(m.name).includes(norm(t)))
    );

    const progestogenMed = meds.find(m =>
      (hrtConfig.progestogenTerms || []).some(t => norm(m.name).includes(norm(t)))
    );

    return {
      hasHysterectomy,
      iusMed:          iusMed          ? iusMed.name          : null,
      progestogenMed:  progestogenMed  ? progestogenMed.name  : null,
    };
  }

  // === REGISTER MEMBERSHIP ===
  function patientOnRegister(problems, registerRule) {
    if (!Array.isArray(problems) || !registerRule.problemMatch) return null;
    const excluded = registerRule.problemExclude || [];
    for (const p of problems) {
      const label = String(p.label || '').toLowerCase();
      // Exclusions
      if (excluded.some(e => label.includes(String(e).toLowerCase()))) continue;
      // Matches
      if (registerRule.problemMatch.some(m => label.includes(String(m).toLowerCase()))) {
        return { matched: true, problem: p };
      }
    }
    return { matched: false };
  }

  // === EVALUATORS ===

  // Drug-monitoring rule evaluator
  function evaluateDrugRule(rule, data, now) {
    const matchedMeds = (data.medications || []).filter(m => drugMatchesRule(m.name, rule));
    return matchedMeds.map(med => {
      const testEvaluations = (rule.tests || []).map(test => {
        const obs = findLatestObservation(data.observations, test);
        if (!obs || !obs.date) {
          return { ...test, status: 'no_data', latestObs: null, days: null };
        }
        const days = daysBetween(obs.date, now);
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
        notes: rule.notes || null
      };

      // HRT-specific: annotate oestrogen chips with progestogen coverage context.
      // Only fires when the matched medication is an oestrogen (not the IUS or
      // oral progestogen, which have their own chip when prescribed standalone).
      if (rule.hrtContext && (rule.hrtContext.oestrogenTerms || []).some(
          t => normaliseDrugString(med.name).includes(normaliseDrugString(t)))) {
        chip.hrtContext = buildHrtContext(rule.hrtContext, data);
      }

      return chip;
    });
  }

  // QOF register rule evaluator -> chip if patient is on register
  function evaluateQofRegisterRule(rule, data) {
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
      notes: rule.notes || null
    }];
  }

  // === SEVERITY → STATUS MAPPING ===
  // Maps the user-facing severity field on custom rules to the STATUS_RANK keys
  // used throughout the engine. "red" is the worst (overdue), "amber" is due_soon,
  // "info" is in_date (neutral/informational).
  function severityToStatus(severity) {
    if (severity === 'red')   return 'overdue';
    if (severity === 'amber') return 'due_soon';
    return 'in_date';
  }

  // === AGE / SEX PATIENT FILTERS (shared by drug-combo and event-count) ===
  function passesAgeFilter(ageRange, patientContext) {
    if (!ageRange) return true;
    const age = patientContext ? patientContext.ageYears : null;
    if (ageRange.min != null && (age == null || age < ageRange.min)) return false;
    if (ageRange.max != null && (age == null || age > ageRange.max)) return false;
    return true;
  }

  function passesSexFilter(sex, patientContext) {
    if (!sex || sex === 'any') return true;
    const patSex = patientContext ? String(patientContext.sex || '').toLowerCase() : '';
    if (sex === 'M' && !patSex.startsWith('m')) return false;
    if (sex === 'F' && !patSex.startsWith('f')) return false;
    return true;
  }

  // === DRUG-COMBO EVALUATOR ===
  // Fires when at least one drug from each drugSet is present in active medications,
  // AND the patient passes age/sex/problem filters.
  // Optional mustNotBePresent: any match in that list disqualifies the rule.
  function evaluateDrugComboRule(rule, data) {
    if (!passesAgeFilter(rule.ageRange, data.patientContext)) return [];
    if (!passesSexFilter(rule.sex, data.patientContext)) return [];

    const meds  = data.medications || [];
    const probs = data.problems    || [];
    const norm  = s => String(s || '').toLowerCase();

    // Problem filters
    const requiresProblems = rule.requiresProblem || [];
    const excludesProblems = rule.excludesProblem || [];

    if (requiresProblems.length > 0) {
      const allMet = requiresProblems.every(req =>
        probs.some(p => norm(p.label).includes(norm(req)))
      );
      if (!allMet) return [];
    }
    if (excludesProblems.some(exc =>
      probs.some(p => norm(p.label).includes(norm(exc)))
    )) return [];

    // mustNotBePresent: single-drug absence check (e.g. "no PPI prescribed")
    const mustNotBePresent = rule.mustNotBePresent || [];
    if (mustNotBePresent.length > 0) {
      const anyForbiddenPresent = mustNotBePresent.some(term =>
        meds.some(m => norm(m.name).includes(norm(term)))
      );
      if (anyForbiddenPresent) return [];
    }

    // Each drugSet must have at least one matching active medication
    const matchedPerSet = (rule.drugSets || []).map(set => {
      return meds.filter(m => {
        const n = norm(m.name);
        const excluded = (set.exclude || []).some(e => n.includes(norm(e)));
        if (excluded) return false;
        return set.match.some(term => n.includes(norm(term)));
      });
    });

    // All sets must have at least one match
    if (matchedPerSet.some(matched => matched.length === 0)) return [];

    const matchSummary = matchedPerSet.map((matched, i) => ({
      setName: (rule.drugSets[i] || {}).name || `Set ${i + 1}`,
      drugs:   matched.map(m => m.name)
    }));

    return [{
      type:        'drug-combo',
      ruleId:      rule.id,
      status:      severityToStatus(rule.severity),
      label:       rule.label || rule.id,
      matchSummary,
      source:      rule.source || null,
      notes:       rule.notes  || null
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
    const windowMs      = (rule.windowMonths || 12) * 30.4375 * 24 * 60 * 60 * 1000;
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
      source:      rule.source || null
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

    return [{
      type:      'composite',
      ruleId:    rule.id,
      status:    severityToStatus(rule.severity),
      label:     rule.label || rule.id,
      operator:  rule.operator,
      firedRuleIds: ruleIds.filter(id => {
        const chips = evaluatedById.get(id);
        return chips && chips.length > 0;
      }),
      notes:     rule.notes  || null,
      source:    rule.source || null
    }];
  }

  // QOF indicator rule evaluator
  function evaluateQofIndicatorRule(rule, data, now) {
    // Step 1: register membership precondition
    if (rule.requiresRegister) {
      const registerRule = (data._registerLookup || {})[rule.requiresRegister];
      if (!registerRule) return [];  // register rule not configured/disabled
      const reg = patientOnRegister(data.problems, registerRule);
      if (!reg || !reg.matched) return [];
    }

    // Step 2: age constraints
    const age = data.patientContext?.ageYears;
    if (rule.ageRange) {
      if (rule.ageRange.min != null && (age == null || age < rule.ageRange.min)) return [];
      if (rule.ageRange.max != null && (age == null || age > rule.ageRange.max)) return [];
    }

    // Step 3: problem-based exclusions (e.g. frailty)
    if (rule.excludeIfProblem) {
      const probs = data.problems || [];
      const hit = probs.some(p => {
        const label = String(p.label || '').toLowerCase();
        return rule.excludeIfProblem.some(e => label.includes(String(e).toLowerCase()));
      });
      if (hit) return [];
    }

    // Step 4: evaluate the check
    const check = rule.check || {};
    let status = 'no_data';
    let valueText = null;
    let dateText = null;
    let days = null;

    if (check.kind === 'observation-threshold') {
      const obs = findLatestObservation(data.observations, { match: check.observation });
      if (obs && obs.date) {
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
      const found = (data.medications || []).some(m => {
        const norm = normaliseDrugString(m.name);
        return matchTerms.some(t => norm.includes(normaliseDrugString(t)));
      });
      status = found ? 'achieved' : 'not_met';
    } else if (check.kind === 'observation-recent') {
      const obs = findLatestObservation(data.observations, { match: check.observation });
      if (obs && obs.date) {
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
          // Not enough data points for a meaningful trend
          status = 'no_data';
          valueText = `${inWindow.length} point${inWindow.length !== 1 ? 's' : ''} in window (need ${check.minPoints || 2})`;
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
      notes: rule.notes || null
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
    severityToStatus,
    STATUS_RANK
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelRules = api;
  }
})(typeof window !== 'undefined' ? window : global);
