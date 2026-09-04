// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — API Normalisers
// Convert raw Medicus API responses to Sentinel's internal data shapes.

(function (global) {
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
      badges: Array.isArray(banner.badges) ? banner.badges.map((b) => ({ text: b.text, colour: b.colour })) : [],
      isDeceased: !!banner.isDeceased,
      namedGP: banner.namedGP || null,
      testPatient: !!banner.testPatient,
    };
  }

  // Converts a medicationIssueHistory entry's startDate/endDate — a structured
  // { year, month, day } object on the real API, NOT a flat date string — to
  // "YYYY-MM-DD". Confirmed against real HAR captures while building the
  // repeat-authorisation classifier (see shared/repeat-authorisation.js's
  // _toUtcDays): every key on this endpoint was enumerated and there is no
  // issueDate/date string field on these entries at all.
  function _issueHistoryDateToIso(d) {
    if (!d || d.year == null || d.month == null || d.day == null) return null;
    const y = parseInt(d.year, 10);
    const mo = parseInt(d.month, 10);
    const da = parseInt(d.day, 10);
    if (!y || !mo || !da) return null;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }

  // ---- Full prescribing history (from medication-history) ----
  // Returns a Map of normalised substance name -> earliest EVER issueDate (ISO
  // "YYYY-MM-DD"), across every prescriptionIssue for that substance regardless
  // of prescriptionStatus — a discontinued course still counts, because the
  // question is "how long ago did the patient first go on this drug", not
  // "how long has the CURRENT authorisation run" (a brand/strength change, or a
  // stop/restart, must not reset this). Confirmed against a real HAR (2026-08-29):
  // medicationRegimen's own medicationIssueHistory is capped to a rolling ~12-month
  // window server-side (its response carries a `range: {startDate, endDate}`
  // proving this) — a repeat running since 2013 read as "started 16 Sep 2025" off
  // that endpoint alone, while this one's full prescriptionIssues correctly go
  // back to the real 2013-10-04 first issue. Returns null (not a Map) when the
  // endpoint didn't return usable data, so callers fall back cleanly — same
  // convention as normalisePatientRegisters.
  function normaliseMedicationHistory(medicationHistory) {
    if (!medicationHistory || !medicationHistory.items || typeof medicationHistory.items !== 'object') return null;
    const out = new Map();
    Object.entries(medicationHistory.items).forEach(([substance, entry]) => {
      const issues = entry && Array.isArray(entry.prescriptionIssues) ? entry.prescriptionIssues : [];
      const dates = issues
        .map((i) => i.issueDate)
        .filter(Boolean)
        .sort();
      if (dates.length) out.set(String(substance).trim().toLowerCase(), dates[0]);
    });
    return out;
  }

  // ---- Medications from regimen ----
  // The regimen has multiple buckets:
  //   currentRepeatPrescribingMedications, currentVariableRepeatMedications,
  //   currentRepeatDispensingMedications, acuteMedicationsLastTwelveMonths,
  //   discontinuedRepeatMedications, medicationsPrescribedElsewhere,
  //   overTheCounterMedicationStatements, unIssuedAcutePrescriptions
  // For Sentinel's drug-monitoring purposes we want active meds only — i.e.
  // current repeats (any kind) + acute meds in last 12m, but NOT discontinued.
  function normaliseMedications(regimen, medicationHistory) {
    if (!regimen) return [];
    const out = [];
    const buckets = [
      ['currentRepeatPrescribingMedications', 'Repeat'],
      ['currentVariableRepeatMedications', 'Variable repeat'],
      ['currentRepeatDispensingMedications', 'Repeat dispensing'],
      ['acuteMedicationsLastTwelveMonths', 'Acute'],
      ['medicationsPrescribedElsewhere', 'Prescribed elsewhere'],
      ['overTheCounterMedicationStatements', 'OTC'],
    ];
    buckets.forEach(([key, label]) => {
      const arr = regimen[key];
      if (!Array.isArray(arr)) return;
      arr.forEach((m) => {
        // description is the full drug name e.g. "Atenolol 50mg tablets"
        const name = m.description || m.vtmProductName || null;
        if (!name) return;
        // For repeat items, the start date is derived from medicationIssueHistory
        // — never assume array order, take the EARLIEST issue.
        let startDate = null;
        if (Array.isArray(m.medicationIssueHistory?.data) && m.medicationIssueHistory.data.length > 0) {
          const dates = m.medicationIssueHistory.data
            .map((i) => _issueHistoryDateToIso(i.startDate) || i.issueDate || i.date)
            .filter(Boolean)
            .sort();
          if (dates.length) startDate = dates[0];
        }
        // Fall back to a flat issueDate whenever the history array didn't yield a
        // usable date (missing entirely, OR present but its entries carried none
        // of the recognised date shapes) — a med must never silently end up with
        // no start date just because one of two paths uses `else if`.
        if (!startDate && m.issueDate) {
          startDate = m.issueDate;
        }
        // Prefer the TRUE first-ever issue from medication-history when available —
        // medicationIssueHistory above is capped to a rolling ~12-month window
        // server-side, so it can only ever reflect the CURRENT authorisation batch's
        // start, never the drug's real clinical start (see normaliseMedicationHistory).
        if (medicationHistory && medicationHistory.size) {
          const substanceKey = String(m.vtmProductName || '').trim().toLowerCase();
          const trueStart = substanceKey ? medicationHistory.get(substanceKey) : null;
          if (trueStart) startDate = trueStart;
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
          id: m.id || null,
        });
      });
    });
    return out;
  }

  // ---- Onset-date confidence (from clinical-summary) ----
  // clinical-summary's own problems[] carries a boolean hasOnsetDate alongside
  // its displayDate/orderingDateString — Medicus's own signal for whether that
  // date is a genuine clinical onset date or a fallback "ordering" date (shown
  // asterisked in its UI). problem-listing (the primary source for
  // data.problems, via normaliseProblemsAll below) has no equivalent flag, so
  // this builds an id -> hasOnsetDate lookup to join onto it. Joined by the
  // problem's own id, which both endpoints expose for the same underlying
  // record. Returns null when clinical-summary is unavailable — callers must
  // treat "no lookup" the same as "id not found in it" (hasOnsetDate: null,
  // i.e. unknown, never a false claim either way).
  function buildOnsetDateIndex(clinicalSummary) {
    if (!clinicalSummary || !Array.isArray(clinicalSummary.problems)) return null;
    const index = new Map();
    clinicalSummary.problems.forEach((p) => {
      if (p && p.id) index.set(p.id, !!p.hasOnsetDate);
    });
    return index;
  }

  // ---- Problems from problem-listing ----
  // Returns { active, past } — active for QOF/rule matching, past for
  // procedure-history checks (e.g. hysterectomy coded as a past/ended problem).
  // onsetIndex (optional): see buildOnsetDateIndex above. Each returned record
  // carries hasOnsetDate: true | false | null (null = unknown — index absent or
  // this id wasn't in it). codedDate itself is UNCHANGED by this — still
  // dateToDisplay || createdInOriginalSystemDateTime — hasOnsetDate is a
  // confidence signal on that value, not a replacement for it (callers that
  // care, e.g. earliestRegisterCodedDate in rules-engine.js, use it to prefer
  // confirmed-onset dates over fallback ones).
  function normaliseProblemsAll(listing, onsetIndex) {
    if (!listing || !Array.isArray(listing.activeProblems)) return { active: [], past: [] };
    const active = [],
      past = [];
    const hasOnsetDateFor = (id) => (onsetIndex && id && onsetIndex.has(id) ? onsetIndex.get(id) : null);
    listing.activeProblems
      .filter((p) => !p.isMarkedAsIncorrect)
      .forEach((p) => {
        const label = p.problemCodeDescription || null;
        if (!label) return;
        const rec = {
          label,
          codedDate: p.dateToDisplay || p.createdInOriginalSystemDateTime || null,
          hasOnsetDate: hasOnsetDateFor(p.id),
          significance: p.significance || null,
          source: 'API:problem-listing',
          id: p.id || null,
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
        .filter((p) => !p.isMarkedAsIncorrect)
        .forEach((p) => {
          const label = p.problemCodeDescription || null;
          if (!label) return;
          past.push({
            label,
            codedDate: p.dateToDisplay || p.createdInOriginalSystemDateTime || null,
            hasOnsetDate: hasOnsetDateFor(p.id),
            significance: p.significance || null,
            source: 'API:problem-listing',
            id: p.id || null,
            status: 'past',
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
    // European comma-decimal: convert "3,5" → "3.5" only for 1-2 digits after
    // the comma (audit M21, 2026-07-18: the old \d+ pattern also matched
    // thousands-grouped values, so "1,234" parsed as 1.234 — 1000× off for a
    // platelet count). 3+ digits after a single comma reads as a thousands
    // separator and the comma is dropped instead.
    if (/^\d+,\d{1,2}$/.test(stripped)) stripped = stripped.replace(',', '.');
    else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(stripped)) stripped = stripped.replace(/,/g, '');
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
    dashboard.rowData.forEach((row) => {
      if (!row.investigationType) return;
      const dataKeys = Object.keys(row).filter((k) => /^data\d{8}$/.test(k));
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
        source: 'API:investigation-dashboard',
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
      dashboard.rowData.forEach((row) => {
        if (!row.investigationType) return;
        const dataKeys = Object.keys(row).filter((k) => /^data\d{8}$/.test(k));
        const isSys = SYS_RE.test(row.investigationType);
        const isDia = DIA_RE.test(row.investigationType);
        if (!isSys && !isDia) return;
        const target = isSys ? sysMap : diaMap;
        dataKeys.forEach((key) => {
          const cell = row[key];
          if (!cell || cell.result == null || cell.result === '') return;
          const d = keyToIsoDate(key);
          if (!target[d]) target[d] = { result: String(cell.result), unit: row.unit || '' };
        });
      });
      // Emit one synthetic "Blood pressure" obs per same-date pair (exact match first),
      // then pair remaining systolic readings with a diastolic within ±1 day.
      // Each diastolic date may pair at most once. The synthesised observation takes
      // the systolic reading's date (clinical convention: record on the measurement day).
      const usedDiaDates = new Set();
      // Helper: add ISO date string offset by ±1 day
      function adjacentDates(d) {
        const ms = new Date(d).getTime();
        const fmt = (t) => new Date(t).toISOString().slice(0, 10);
        return [fmt(ms - 86400000), fmt(ms + 86400000)];
      }
      function emitBp(sysDate, diaDate) {
        const sys = sysMap[sysDate].result;
        const dia = diaMap[diaDate].result;
        const unit = sysMap[sysDate].unit || diaMap[diaDate].unit || 'mmHg';
        const combined = `${sys}/${dia}`;
        out.push({
          name: 'Blood pressure',
          code: null,
          date: sysDate,
          value: unit ? `${combined} ${unit}` : combined,
          rawValue: combined,
          unit: unit || null,
          group: 'Key observations',
          isAbove: false,
          isBelow: false,
          source: 'API:investigation-dashboard (synthesised)',
        });
      }
      // Pass 1: exact same-date pairs
      Object.keys(sysMap).forEach((d) => {
        if (!diaMap[d]) return;
        usedDiaDates.add(d);
        emitBp(d, d);
      });
      // Pass 2: ±1-day pairs for unpaired systolic readings
      Object.keys(sysMap).forEach((d) => {
        if (diaMap[d]) return; // already paired in pass 1
        const [prev, next] = adjacentDates(d);
        const diaDate =
          diaMap[prev] && !usedDiaDates.has(prev) ? prev : diaMap[next] && !usedDiaDates.has(next) ? next : null;
        if (!diaDate) return;
        usedDiaDates.add(diaDate);
        emitBp(d, diaDate);
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
        source: 'API:investigation-dashboard (group aggregate)',
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
    dashboard.rowData.forEach((row) => {
      if (!row.investigationType) return;
      const dataKeys = Object.keys(row).filter((k) => /^data\d{8}$/.test(k));
      if (dataKeys.length === 0) return;
      // Collect all date-keyed cells that have a non-empty result
      const historyEntries = [];
      dataKeys.forEach((key) => {
        const cell = row[key];
        if (!cell || cell.result == null || cell.result === '') return;
        historyEntries.push({
          date: keyToIsoDate(key),
          value: parseObservationValue(cell.result),
          rawValue: String(cell.result),
          isAbove: !!cell.isAboveReferenceRange,
          isBelow: !!cell.isBelowReferenceRange,
          source: 'API:investigation-dashboard',
        });
      });
      if (historyEntries.length === 0) return;
      // Sort newest-first. ISO YYYY-MM-DD strings sort lexicographically the
      // same as chronologically; use plain string comparison (not localeCompare)
      // to avoid any locale-collation surprises.
      historyEntries.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
      out.push({
        name: row.investigationType,
        code: null,
        group: row.investigationGroup || null,
        unit: row.unit || null,
        history: historyEntries,
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
      dashboard.rowData.forEach((row) => {
        if (!row.investigationType) return;
        const isSys = SYS_RE.test(row.investigationType);
        const isDia = DIA_RE.test(row.investigationType);
        if (!isSys && !isDia) return;
        const target = isSys ? sysMap : diaMap;
        Object.keys(row)
          .filter((k) => /^data\d{8}$/.test(k))
          .forEach((key) => {
            const cell = row[key];
            if (!cell || cell.result == null || cell.result === '') return;
            const d = keyToIsoDate(key);
            if (!target[d]) target[d] = String(cell.result);
          });
      });
      const combinedHistory = [];
      Object.keys(sysMap).forEach((d) => {
        if (!diaMap[d]) return;
        combinedHistory.push({
          date: d,
          value: NaN,
          rawValue: `${sysMap[d]}/${diaMap[d]}`,
          isAbove: false,
          isBelow: false,
          source: 'API:investigation-dashboard (synthesised)',
        });
      });
      if (combinedHistory.length > 0) {
        combinedHistory.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
        out.unshift({
          name: 'Blood pressure',
          code: null,
          group: 'Key observations',
          unit: 'mmHg',
          history: combinedHistory,
        });
      }
    }
    return out;
  }

  // ---- Date string normaliser ----
  // Handles two formats seen in investigationReport payloads:
  //   "2026-01-09 08:26:00"  → "2026-01-09"
  //   "11 Jun 26, 14:30"     → "2026-06-11"
  //   ISO 8601 "2026-01-09T08:26:00Z" → "2026-01-09"
  // Returns null for unparseable input.
  const MONTH_MAP = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  function normaliseDateString(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    // "YYYY-MM-DD ..." or "YYYY-MM-DDTHH:MM..."
    const isoLike = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoLike) return isoLike[1];
    // "DD Mon YY, HH:MM" e.g. "11 Jun 26, 14:30"
    const ddMonYY = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})(?:[,\s]|$)/);
    if (ddMonYY) {
      const day = ddMonYY[1].padStart(2, '0');
      const mon = MONTH_MAP[ddMonYY[2].toLowerCase()];
      if (!mon) return null;
      const yr = parseInt(ddMonYY[3], 10);
      const year = yr < 100 ? (yr >= 50 ? 1900 + yr : 2000 + yr) : yr;
      return `${year}-${mon}-${day}`;
    }
    return null;
  }

  // ---- Investigation report normaliser ----
  // Converts a raw investigationReport payload (from the queued-result API) to
  // a structured shape suitable for result-severity scoring.
  function normaliseInvestigationReport(payload) {
    const safe = {
      patientUuid: null,
      unmatched: false,
      results: [],
    };
    try {
      if (!payload || !payload.data) return safe;
      const data = payload.data;
      safe.patientUuid = (data.patient && data.patient.id) || data.patientId || null;
      const report = data.investigationReport;
      if (!report) return safe;
      safe.unmatched = report.isMatchedToPatient === false;

      // Collect all result objects from groups + ungrouped.
      // Each result from a named group gets a `specimen` field set to the group's
      // human-readable title (trimmed string), or null if none is discoverable.
      // Ungrouped results and results from untitled groups get specimen: null.
      // This is fail-open: a missing or unrecognised header never drops a result.
      const rawResults = [];
      if (Array.isArray(report.investigationGroups)) {
        report.investigationGroups.forEach((g) => {
          // Ordered candidate keys — first non-empty string wins; never use id/uuid fields.
          const specimenHeader =
            (typeof g.groupName === 'string' && g.groupName.trim()) ||
            (typeof g.name === 'string' && g.name.trim()) ||
            (typeof g.title === 'string' && g.title.trim()) ||
            (typeof g.heading === 'string' && g.heading.trim()) ||
            (typeof g.description === 'string' && g.description.trim()) ||
            null;
          if (Array.isArray(g.results)) {
            g.results.forEach((r) => rawResults.push({ _raw: r, _specimen: specimenHeader }));
          }
        });
      }
      if (Array.isArray(report.ungroupedResults)) {
        report.ungroupedResults.forEach((r) => rawResults.push({ _raw: r, _specimen: null }));
      }

      // Parse reference range limits from the first entry
      function parseRefRange(referenceRanges) {
        if (!Array.isArray(referenceRanges) || referenceRanges.length === 0) {
          return { low: null, high: null };
        }
        const rr = referenceRanges[0];
        const low = parseObservationValue(rr.lowerReferenceLimit);
        const high = parseObservationValue(rr.upperReferenceLimit);
        return {
          low: isFinite(low) ? low : null,
          high: isFinite(high) ? high : null,
        };
      }

      // Derive above/below flag for a history value against parent ranges
      function deriveHistoryFlag(numericValue, low, high) {
        if (!isFinite(numericValue)) return 'unknown';
        if (high !== null && numericValue > high) return 'above';
        if (low !== null && numericValue < low) return 'below';
        if (low !== null || high !== null) return 'normal';
        return 'unknown';
      }

      rawResults.forEach((entry) => {
        // Each entry is { _raw, _specimen } from grouped path, or { _raw, _specimen: null }
        // from ungrouped. Guard against any stray non-object entries.
        if (!entry || typeof entry !== 'object') return;
        const r = entry._raw;
        const specimenHeader = entry._specimen !== undefined ? entry._specimen : null;
        if (!r || typeof r !== 'object') return;
        const name = r.description || null;
        // text-result types (e.g. microbiology / culture) carry their content in
        // `resultText`, not `resultValue` (which is absent entirely). Fall back to it
        // so the result has a displayable value and the searchable text below is populated.
        const rawValue =
          r.resultValue != null ? String(r.resultValue) : r.resultText != null ? String(r.resultText) : '';
        const numValue = parseObservationValue(rawValue);
        const { low, high } = parseRefRange(r.referenceRanges);

        // Best available date: prefer formattedSpecimenCollectionDate, then specimenCollectionDate, then issuedDateTime
        const date =
          normaliseDateString(r.formattedSpecimenCollectionDate) ||
          normaliseDateString(r.specimenCollectionDate) ||
          normaliseDateString(r.issuedDateTime) ||
          null;

        // Build history array (newest-first) from previousResults
        const history = [];
        if (Array.isArray(r.previousResults)) {
          r.previousResults.forEach((pr) => {
            if (!pr || typeof pr !== 'object') return;
            const prevRaw = pr.result != null ? String(pr.result) : '';
            const prevNum = parseObservationValue(prevRaw);
            const prevDate =
              normaliseDateString(pr.formattedSpecimenCollectionDate) ||
              normaliseDateString(pr.specimenCollectionDate) ||
              null;
            // unit — ADDITIVE (item 2.6, TRIAGE-LENS-2026-07-02.md trend arrows): a
            // previousResults entry from the API has never been observed to carry its
            // own unit (same analyte/test code as the parent result, reported over
            // time), so this inherits the parent result's unit unless the entry
            // explicitly states a different one. Consumers (result-severity.js
            // extractPrior) compare this against the CURRENT result's unit before ever
            // showing a trend — inheriting here just lets that guard pass in the
            // ordinary case instead of always failing closed for lack of data; an
            // explicit differing unit on the historical entry still blocks the trend.
            history.push({
              date: prevDate,
              value: prevNum,
              flag: deriveHistoryFlag(prevNum, low, high),
              unit: pr.resultUnit != null ? String(pr.resultUnit) : r.resultUnit || null,
            });
          });
          // Sort newest-first (nulls last)
          history.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
          });
        }

        // Build a single searchable text string for text-classification rules
        // (microbiology / free-text results that have no numeric high/low flag).
        // We gather rawValue, interpretation, performerComments, resultPerformerComments,
        // and filingComments defensively, then join with spaces. Case is preserved;
        // callers must lowercase before searching.
        const textParts = [];
        if (rawValue) textParts.push(rawValue);
        // resultText explicitly (covers results that carry BOTH a numeric resultValue
        // and a separate free-text resultText where a normal phrase may live).
        if (r.resultText && typeof r.resultText === 'string' && r.resultText !== rawValue) {
          textParts.push(r.resultText);
        }
        if (r.interpretation && typeof r.interpretation === 'string') {
          textParts.push(r.interpretation);
        }
        if (r.performerComments && typeof r.performerComments === 'string') {
          textParts.push(r.performerComments);
        }
        // resultPerformerComments — may be an array of strings or objects
        if (Array.isArray(r.resultPerformerComments)) {
          r.resultPerformerComments.forEach((item) => {
            if (typeof item === 'string') {
              textParts.push(item);
            } else if (item && typeof item === 'object') {
              // Pull any of text / comment / value sub-field present
              const sub = item.text || item.comment || item.value;
              if (sub && typeof sub === 'string') textParts.push(sub);
            }
          });
        }
        // filingComments — may be an array of strings or objects
        if (Array.isArray(r.filingComments)) {
          r.filingComments.forEach((item) => {
            if (typeof item === 'string') {
              textParts.push(item);
            } else if (item && typeof item === 'object') {
              const sub = item.text || item.comment || item.value;
              if (sub && typeof sub === 'string') textParts.push(sub);
            }
          });
        }
        const text = textParts.join(' ');

        safe.results.push({
          name,
          value: numValue,
          rawValue,
          comparator: r.resultComparator || null,
          unit: r.resultUnit || null,
          low,
          high,
          isAbove: !!r.isAboveReferenceRange,
          isBelow: !!r.isBelowReferenceRange,
          urgent: !!r.requiresUrgentReview,
          interpretation: r.interpretation || null,
          date,
          history,
          text,
          specimen: specimenHeader,
        });
      });
    } catch (_) {
      // Never throw — return whatever safe shape we've built so far
    }
    return safe;
  }

  // ---- Patient registers (from clinical-summary) ----
  // Medicus's OWN computed register membership — authoritative, unlike the
  // text-matched `problems` list ASTHMA/DM/etc. registers fall back to (see
  // patientOnRegister in rules-engine.js). Returns null (not []) when the
  // clinical-summary endpoint didn't return usable data, so callers can tell
  // "fetch failed/unavailable" (null — fall back to text-matching) apart from
  // "fetched, patient genuinely has zero registers" ([] — trust it).
  function normalisePatientRegisters(clinicalSummary) {
    if (!clinicalSummary || !Array.isArray(clinicalSummary.patientRegisters)) return null;
    return clinicalSummary.patientRegisters
      .filter((r) => r && typeof r.registerType === 'string' && r.registerType)
      .map((r) => ({ registerType: r.registerType, registerLabel: r.registerLabel || null }));
  }

  function normaliseAll(apiResults, urlContext) {
    const onsetIndex = buildOnsetDateIndex(apiResults?.clinicalSummary);
    const allProbs = normaliseProblemsAll(apiResults?.problemListing, onsetIndex);
    return {
      patientContext: normaliseBanner(apiResults?.banner, urlContext),
      medications: normaliseMedications(
        apiResults?.medicationRegimen,
        normaliseMedicationHistory(apiResults?.medicationHistory)
      ),
      observations: normaliseObservations(apiResults?.investigationDashboard),
      observationHistory: normaliseObservationHistory(apiResults?.investigationDashboard),
      problems: allProbs.active,
      pastProblems: allProbs.past,
      patientRegisters: normalisePatientRegisters(apiResults?.clinicalSummary),
      apiErrors: apiResults?.errors || {},
    };
  }

  const api = {
    normaliseBanner,
    normaliseMedications,
    normaliseMedicationHistory,
    normaliseProblems,
    normaliseProblemsAll,
    normaliseObservations,
    normaliseObservationHistory,
    buildOnsetDateIndex,
    parseObservationValue,
    normalisePatientRegisters,
    normaliseAll,
    normaliseInvestigationReport,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelNormalisers = api;
  }
})(typeof window !== 'undefined' ? window : global);
