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
  function normaliseProblems(listing) {
    if (!listing || !Array.isArray(listing.activeProblems)) return [];
    return listing.activeProblems
      .filter(p => !p.hasEnded && !p.isMarkedAsIncorrect)
      .map(p => ({
        label: p.problemCodeDescription || null,
        codedDate: p.dateToDisplay || p.createdInOriginalSystemDateTime || null,
        status: 'active',
        significance: p.significance || null,   // "Major" | "Minor" | "Unknown" — for QOF UI grouping
        source: 'API:problem-listing',
        id: p.id || null
      }))
      .filter(p => p.label);
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
      const yyyy = latestKey.slice(4, 8);
      const mm = latestKey.slice(8, 10);
      const dd = latestKey.slice(10, 12);
      const dateIso = `${yyyy}-${mm}-${dd}`;
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

  // ---- Combined normalisation ----
  function normaliseAll(apiResults, urlContext) {
    return {
      patientContext: normaliseBanner(apiResults?.banner, urlContext),
      medications: normaliseMedications(apiResults?.medicationRegimen),
      observations: normaliseObservations(apiResults?.investigationDashboard),
      problems: normaliseProblems(apiResults?.problemListing),
      apiErrors: apiResults?.errors || {}
    };
  }

  const api = {
    normaliseBanner,
    normaliseMedications,
    normaliseProblems,
    normaliseObservations,
    normaliseAll
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelNormalisers = api;
  }
})(typeof window !== 'undefined' ? window : global);
