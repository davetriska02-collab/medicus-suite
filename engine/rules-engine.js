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
    const d = new Date(nowIso);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth(); // 0-indexed; April = 3
    const qofYear = month < 3 ? year - 1 : year;
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
      if (obs.name && testSpec.match) {
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
      if (med.startDate) {
        const daysSinceStart = daysBetween(med.startDate, now);
        const minInterval = Math.min(...(rule.tests || []).map(t => t.intervalDays || 365));
        if (daysSinceStart != null && daysSinceStart < minInterval / 2) {
          testEvaluations.forEach(te => { if (te.status === 'no_data') { te.status = 'recently_initiated'; suppressedNoData = true; } });
        }
      }

      const worstStatus = testEvaluations.reduce((worst, te) => {
        const rankCurrent = STATUS_RANK[te.status] ?? 99;
        const rankWorst = STATUS_RANK[worst] ?? 99;
        return rankCurrent < rankWorst ? te.status : worst;
      }, 'in_date');

      return {
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
            valueText = String(v);
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

    const data = { medications, observations, problems, patientContext };

    // Pre-build register lookup for indicator rules
    const registerLookup = {};
    (rules || []).forEach(r => {
      if (r.type === 'qof-register' && r.enabled !== false && r.registerCode) {
        registerLookup[r.registerCode] = r;
      }
    });
    data._registerLookup = registerLookup;

    const chips = [];
    (rules || []).forEach(rule => {
      if (rule.enabled === false) return;
      const type = rule.type || 'drug-monitoring';
      let out = [];
      if (type === 'drug-monitoring') out = evaluateDrugRule(rule, data, now);
      else if (type === 'qof-register') out = evaluateQofRegisterRule(rule, data);
      else if (type === 'qof-indicator') out = evaluateQofIndicatorRule(rule, data, now);
      chips.push(...out);
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
    STATUS_RANK
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelRules = api;
  }
})(typeof window !== 'undefined' ? window : global);
