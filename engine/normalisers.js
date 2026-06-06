// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — API Normalisers
// Convert raw Medicus API responses to Sentinel's internal data shapes.

(function(global) {
  'use strict';

  // ---- Patient context from banner ----
  function normaliseBanner(banner, urlContext) {
    if (!banner) return null;
    const dob = banner.dateOfBirth || null;
    let ageYears = null;
    // banner.age may be a string "68" or similar
    if (banner.age != null) {
      const parsed = parseInt(String(banner.age), 10);
      if (Number.isFinite(parsed)) ageYears = parsed;
    }
    // Sex: banner.genderIdentity (likely "male", "female", "Male", etc.)
    let sex = null;
    if (banner.genderIdentity) {
      const g = String(banner.genderIdentity).toLowerCase();
      if (g.startsWith('m')) sex = 'male';
      else if (g.startsWith('f')) sex = 'female';
      else sex = g;
    }
    return {
      patientName: banner.displayName || banner.preferredName || null,
      nhsNumber: banner.nhsNumber ? String(banner.nhsNumber).replace(/\s/g, '') : null,
      dob,
      dobRaw: dob || null,
      ageYears,
      sex,
      url: urlContext?.url || (typeof location !== 'undefined' ? location.href : ''),
      title: urlContext?.title || (typeof document !== 'undefined' ? document.title : ''),
      view: urlContext?.view || 'api',
      patientUuid: banner.id || urlContext?.patientUuid || null,
      badges: Array.isArray(banner.badges) ? banner.badges.map(b => ({ text: b.text, colour: b.colour })) : [],
      isDeceased: !!banner.isDeceased,
      namedGP: banner.namedGP || null,
      testPatient: !!banner.testPatient
    };
  }

  // ---- Medications from regimen ----
  // The regimen has multiple buckets:
  //   currentRepeatPrescribingMedications, currentVariableRepeatMedications,
  //   currentRepeatDispensingMedications, acuteMedicationsLastTwelveMonths,
  //   discontinuedRepeatMedications, medicationsPrescribedElsewhere,
  //   overTheCounterMedicationStatements, unIssuedAcutePrescriptions
  // For Sentinel's drug-monitoring purposes we want active meds only — i.e.
  // current repeats (any kind) + acute meds in last 12m, but NOT discontinued.
  function normaliseMedications(regimen) {
    if (!regimen) return [];
    const out = [];
    const buckets = [
      ['currentRepeatPrescribingMedications', 'Repeat'],
      ['currentVariableRepeatMedications', 'Variable repeat'],
      ['currentRepeatDispensingMedications', 'Repeat dispensing'],
      ['acuteMedicationsLastTwelveMonths', 'Acute'],
      ['medicationsPrescribedElsewhere', 'Prescribed elsewhere'],
      ['overTheCounterMedicationStatements', 'OTC']
    ];
    buckets.forEach(([key, label]) => {
      const arr = regimen[key];
      if (!Array.isArray(arr)) return;
      arr.forEach(m => {
        // description is the full drug name e.g. "Atenolol 50mg tablets"
        const name = m.description || m.vtmProductName || null;
        if (!name) return;
        // For repeat items, lastIssued can be derived from medicationIssueHistory
        let startDate = null;
        if (Array.isArray(m.medicationIssueHistory?.data) && m.medicationIssueHistory.data.length > 0) {
          // Earliest issue is the start
          const dates = m.medicationIssueHistory.data
            .map(i => i.issueDate || i.date)
            .filter(Boolean)
            .sort();
          if (dates.length) startDate = dates[0];
        } else if (m.issueDate) {
          startDate = m.issueDate;
        }
        out.push({
          name,
          startDate,
          source: label,
          dosage: m.dosageInstructions || null,
          quantity: m.quantityAndUnit || null,
          status: m.status || null,
          isOverDue: !!m.isOverDue,
          isReviewOverDue: !!m.isReviewOverDue,
          vtm: m.vtmProductName || null,
          id: m.id || null
        });
      });
    });
    return out;
  }

  // ---- Problems from problem-listing ----
  // Returns { active, past } — active for QOF/rule matching, past for
  // procedure-history checks (e.g. hysterectomy coded as a past/ended problem).
  function normaliseProblemsAll(listing) {
    if (!listing || !Array.isArray(listing.activeProblems)) return { active: [], past: [] };
    const active = [], past = [];
    listing.activeProblems
      .filter(p => !p.isMarkedAsIncorrect)
      .forEach(p => {
        const label = p.problemCodeDescription || null;
        if (!label) return;
        const rec = {
          label,
          codedDate: p.dateToDisplay || p.createdInOriginalSystemDateTime || null,
          significance: p.significance || null,
          source: 'API:problem-listing',
          id: p.id || null
        };
        if (p.hasEnded) {
          past.push({ ...rec, status: 'past' });
        } else {
          active.push({ ...rec, status: 'active' });
        }
      });
    // Also pull from inactiveProblems if the API returns that array separately
    if (Array.isArray(listing.inactiveProblems)) {
      listing.inactiveProblems
        .filter(p => !p.isMarkedAsIncorrect)
        .forEach(p => {
          const label = p.problemCodeDescription || null;
          if (!label) return;
          past.push({
            label,
            codedDate: p.dateToDisplay || p.createdInOriginalSystemDateTime || null,
            significance: p.significance || null,
            source: 'API:problem-listing',
            id: p.id || null,
            status: 'past'
          });
        });
    }
    return { active, past };
  }

  function normaliseProblems(listing) {
    return normaliseProblemsAll(listing).active;
  }

  // ---- Observation value numeric parser ----
  // Used when building observationHistory to produce a numeric value from raw strings.
  // Handles common edge cases from the Medicus investigation dashboard:
  //   "58"       → 58
  //   "<5"       → 5   (strip leading comparison operator)
  //   ">100"     → 100
  //   "120/80"   → 120 (BP — take systolic; diastolic is dropped here, used separately)
  //   "Negative" → NaN
  //   Blank/null → NaN
  // Convert a "dataYYYYMMDD" cell key into an ISO date string ("YYYY-MM-DD").
  // The key prefix is always 4 chars; year/month/day are 4/2/2 at fixed offsets.
  function keyToIsoDate(key) {
    return `${key.slice(4, 8)}-${key.slice(8, 10)}-${key.slice(10, 12)}`;
  }

  function parseObservationValue(rawValue) {
    if (rawValue == null) return NaN;
    const s = String(rawValue).trim();
    if (s === '') return NaN;
    // BP "120/80" — take the systolic (first part)
    const bpMatch = s.match(/^(\d{2,3})\s*\/\s*\d{2,3}/);
    if (bpMatch) return parseFloat(bpMatch[1]);
    // Strip leading comparison operators (ASCII + Unicode ≤ ≥)
    let stripped = s.replace(/^[<>~=≤≥]+\s*/, '');
    // European comma-decimal: convert "3,5" → "3.5" only when there's exactly one
    // comma between digits and no period — otherwise leave alone (e.g. thousands).
    if (/^\d+,\d+$/.test(stripped)) stripped = stripped.replace(',', '.');
    const n = parseFloat(stripped);
    return isFinite(n) ? n : NaN;
  }

  // ---- Observations from investigation dashboard ----
  // The dashboard returns:
  //   rowData: [{ investigationGroup, investigationType, unit, dataYYYYMMDD: { result, ... }, ... }]
  // Each rowData entry has many dataYYYYMMDD keys, one per recorded date.
  //
  // We emit TWO kinds of observation:
  //   1. Per-row latest: one entry per investigationType (e.g. "Sodium", "ALT", "HbA1c")
  //   2. Per-group aggregate: one synthetic entry per investigationGroup (e.g. "U&Es", "LFTs", "FBC")
  //      with the date being the most recent date across any member of the group.
  //
  // Aggregates exist because drug-monitoring rules look for PANEL names like "U&E" or "LFT",
  // not individual analyte names. Without aggregates, "Ramipril U&E overdue?" can't be evaluated.
  function normaliseObservations(dashboard) {
    if (!dashboard || !Array.isArray(dashboard.rowData)) return [];
    const out = [];
    const groupLatest = {}; // groupName -> latestIsoDate
    dashboard.rowData.forEach(row => {
      if (!row.investigationType) return;
      const dataKeys = Object.keys(row).filter(k => /^data\d{8}$/.test(k));
      if (dataKeys.length === 0) return;
      dataKeys.sort();
      const latestKey = dataKeys[dataKeys.length - 1];
      const cell = row[latestKey];
      if (!cell || cell.result == null || cell.result === '') return;
      const dateIso = keyToIsoDate(latestKey);
      const valueWithUnit = row.unit ? `${cell.result} ${row.unit}` : String(cell.result);
      out.push({
        name: row.investigationType,
        code: null,
        date: dateIso,
        value: valueWithUnit,
        rawValue: cell.result,
        unit: row.unit || null,
        group: row.investigationGroup || null,
        isAbove: !!cell.isAboveReferenceRange,
        isBelow: !!cell.isBelowReferenceRange,
        source: 'API:investigation-dashboard'
      });
      // Track latest date per group for aggregate emission below
      if (row.investigationGroup) {
        if (!groupLatest[row.investigationGroup] || dateIso > groupLatest[row.investigationGroup]) {
          groupLatest[row.investigationGroup] = dateIso;
        }
      }
    });
    // Synthesise combined "Blood pressure" observations from split systolic/diastolic rows.
    // Medicus API emits these as separate investigationType rows; parseBp() in the rules
    // engine requires "NNN/NN" slash format, so we pair same-date rows here.
    {
      const SYS_RE = /systolic\s+blood\s+pressure/i;
      const DIA_RE = /diastolic\s+blood\s+pressure/i;
      // Collect all dated values for systolic and diastolic rows
      const sysMap = {}; // dateIso -> { result, unit }
      const diaMap = {};
      dashboard.rowData.forEach(row => {
        if (!row.investigationType) return;
        const dataKeys = Object.keys(row).filter(k => /^data\d{8}$/.test(k));
        const isSys = SYS_RE.test(row.investigationType);
        const isDia = DIA_RE.test(row.investigationType);
        if (!isSys && !isDia) return;
        const target = isSys ? sysMap : diaMap;
        dataKeys.forEach(key => {
          const cell = row[key];
          if (!cell || cell.result == null || cell.result === '') return;
          const d = keyToIsoDate(key);
          if (!target[d]) target[d] = { result: String(cell.result), unit: row.unit || '' };
        });
      });
      // Emit one synthetic "Blood pressure" obs per date where both values are present
      Object.keys(sysMap).forEach(d => {
        if (!diaMap[d]) return;
        const sys = sysMap[d].result;
        const dia = diaMap[d].result;
        const unit = sysMap[d].unit || diaMap[d].unit || 'mmHg';
        const combined = `${sys}/${dia}`;
        out.push({
          name: 'Blood pressure',
          code: null,
          date: d,
          value: unit ? `${combined} ${unit}` : combined,
          rawValue: combined,
          unit: unit || null,
          group: 'Key observations',
          isAbove: false,
          isBelow: false,
          source: 'API:investigation-dashboard (synthesised)'
        });
      });
    }
    // Emit synthetic per-group observations. These let panel-level rules match
    // (e.g. "U&E" rule matches "U&Es (Urea and electrolytes)" via substring).
    // Skip the "Key observations" group — its members (BP, BMI, etc.) are
    // already addressed by name in the rules.
    Object.entries(groupLatest).forEach(([groupName, dateIso]) => {
      if (groupName === 'Key observations') return;
      out.push({
        name: groupName,
        code: null,
        date: dateIso,
        value: 'panel done',
        rawValue: null,
        unit: null,
        group: groupName,
        isAbove: false,
        isBelow: false,
        source: 'API:investigation-dashboard (group aggregate)'
      });
    });
    return out;
  }

  // ---- Full observation history from investigation dashboard ----
  // Produces one entry per investigationType, each with a full history array
  // sorted newest-first. This is a SEPARATE field (observationHistory) and does
  // not affect data.observations (latest-per-name) used by all existing rules.
  //
  // Shape per entry:
  //   { name, code, group, unit, history: [{ date, value, rawValue, isAbove, isBelow, source }, ...] }
  //
  // history entries are newest-first by date.
  //
  // IMPORTANT — `value` here is NUMERIC (parseObservationValue output), unlike
  // `observations[].value` which is a display string with unit appended
  // (e.g. "65 mmol/mol"). Engine code that reads observationHistory must treat
  // value as a number and may yield NaN for non-numeric results ("Negative").
  // `rawValue` preserves the original string. `unit` is only on the parent
  // entry, not on each history point (uniform per investigation type).
  //
  // Group aggregates (e.g. "U&Es", "LFTs") are intentionally NOT included —
  // trend and event-count rules match on individual analyte names. No cap on
  // history length; expect <200 entries per type for the most-tested analytes.
  function normaliseObservationHistory(dashboard) {
    if (!dashboard || !Array.isArray(dashboard.rowData)) return [];
    const out = [];
    dashboard.rowData.forEach(row => {
      if (!row.investigationType) return;
      const dataKeys = Object.keys(row).filter(k => /^data\d{8}$/.test(k));
      if (dataKeys.length === 0) return;
      // Collect all date-keyed cells that have a non-empty result
      const historyEntries = [];
      dataKeys.forEach(key => {
        const cell = row[key];
        if (!cell || cell.result == null || cell.result === '') return;
        historyEntries.push({
          date: keyToIsoDate(key),
          value: parseObservationValue(cell.result),
          rawValue: String(cell.result),
          isAbove: !!cell.isAboveReferenceRange,
          isBelow: !!cell.isBelowReferenceRange,
          source: 'API:investigation-dashboard'
        });
      });
      if (historyEntries.length === 0) return;
      // Sort newest-first. ISO YYYY-MM-DD strings sort lexicographically the
      // same as chronologically; use plain string comparison (not localeCompare)
      // to avoid any locale-collation surprises.
      historyEntries.sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
      out.push({
        name:  row.investigationType,
        code:  null,
        group: row.investigationGroup || null,
        unit:  row.unit || null,
        history: historyEntries
      });
    });
    // Synthesise a combined "Blood pressure" history entry from split systolic/diastolic rows.
    // The API emits these as separate investigationType rows; parseBp() requires "NNN/NN" slash
    // format. We build per-date maps then emit a combined entry prepended to out so that any
    // consumer doing a substring/find match hits "Blood pressure" before "Systolic blood pressure".
    {
      const SYS_RE = /systolic\s+blood\s+pressure/i;
      const DIA_RE = /diastolic\s+blood\s+pressure/i;
      const sysMap = {};
      const diaMap = {};
      dashboard.rowData.forEach(row => {
        if (!row.investigationType) return;
        const isSys = SYS_RE.test(row.investigationType);
        const isDia = DIA_RE.test(row.investigationType);
        if (!isSys && !isDia) return;
        const target = isSys ? sysMap : diaMap;
        Object.keys(row).filter(k => /^data\d{8}$/.test(k)).forEach(key => {
          const cell = row[key];
          if (!cell || cell.result == null || cell.result === '') return;
          const d = keyToIsoDate(key);
          if (!target[d]) target[d] = String(cell.result);
        });
      });
      const combinedHistory = [];
      Object.keys(sysMap).forEach(d => {
        if (!diaMap[d]) return;
        combinedHistory.push({
          date: d,
          value: NaN,
          rawValue: `${sysMap[d]}/${diaMap[d]}`,
          isAbove: false,
          isBelow: false,
          source: 'API:investigation-dashboard (synthesised)'
        });
      });
      if (combinedHistory.length > 0) {
        combinedHistory.sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
        out.unshift({
          name: 'Blood pressure',
          code: null,
          group: 'Key observations',
          unit: 'mmHg',
          history: combinedHistory
        });
      }
    }
    return out;
  }

  // ---- Combined normalisation ----
  function normaliseAll(apiResults, urlContext) {
    const allProbs = normaliseProblemsAll(apiResults?.problemListing);
    return {
      patientContext: normaliseBanner(apiResults?.banner, urlContext),
      medications: normaliseMedications(apiResults?.medicationRegimen),
      observations: normaliseObservations(apiResults?.investigationDashboard),
      observationHistory: normaliseObservationHistory(apiResults?.investigationDashboard),
      problems: allProbs.active,
      pastProblems: allProbs.past,
      apiErrors: apiResults?.errors || {}
    };
  }

  const api = {
    normaliseBanner,
    normaliseMedications,
    normaliseProblems,
    normaliseObservations,
    normaliseObservationHistory,
    parseObservationValue,
    normaliseAll
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelNormalisers = api;
  }
})(typeof window !== 'undefined' ? window : global);
