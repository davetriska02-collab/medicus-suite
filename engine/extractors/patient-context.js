// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Patient Context Extractor
// Extracts patient identity from the page so chips can be verified against a
// changing patient context (wrong-patient hazard mitigation).
//
// Detects current view based on URL pattern.

(function(global) {
  'use strict';

  function detectView(url) {
    if (!url) return 'unknown';
    // Legacy v0.1 top-level pattern (off siteId, no /tasks/data/ wrapper)
    if (/\/prescription-requests\/overview\//.test(url) && !/\/tasks\/data\//.test(url)) return 'prescription-overview';
    // New: task-wrapped prescription request page (the routine/non-routine inbox view)
    if (/\/tasks\/data\/prescription-requests\/overview\//.test(url)) return 'prescription-request';
    if (/\/tasks\/data\/[^/]+\/overview\//.test(url)) return 'task-overview';
    if (/\/care-record\/.*careRecordTab=medication/.test(url)) return 'care-record-medication';
    if (/\/care-record\/.*careRecordTab=observations/.test(url)) return 'care-record-observations';
    if (/\/care-record\/.*careRecordTab=problems/.test(url)) return 'care-record-problems';
    if (/\/care-record\/.*careRecordTab=summary/.test(url)) return 'care-record-summary';
    if (/\/care-record\//.test(url)) return 'care-record-default';
    if (/\/clinical\/encounter\/overview\//.test(url)) return 'consultation-overview';
    if (/\/clinical\/encounter\/edit\//.test(url)) return 'consultation-edit';
    if (/\/clinical\/encounter\//.test(url)) return 'consultation-other';
    if (/\/patient\//.test(url)) return 'patient-other';
    return 'unknown';
  }

  function computeAge(dobIso, nowIso) {
    if (!dobIso) return null;
    const dob = new Date(dobIso);
    const now = nowIso ? new Date(nowIso) : new Date();
    if (isNaN(dob.getTime())) return null;
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }

  // Parse "Mon, DD MMM YYYY" or "DD/MM/YYYY" or "DD MMM YYYY" -> ISO.
  function parseDob(s) {
    if (!s) return null;
    const t = String(s).trim();
    // Try DD MMM YYYY
    const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    let m = t.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
    }
    // Try DD/MM/YYYY
    m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  function extract(doc, now) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    const title = doc.title || '';
    const url = (typeof location !== 'undefined') ? location.href : '';

    // Patient name from title pattern "..., FirstLast | Medicus"
    let patientName = null;
    const titleMatch = title.match(/,\s*([^|]+?)\s*\|\s*Medicus/i);
    if (titleMatch) patientName = titleMatch[1].trim();

    // NHS number + DOB from typical info container
    let nhsNumber = null;
    let dobRaw = null;
    const infoContainer = doc.querySelector(
      '.encounter-patient-info-top, .patient-info, [class*="patient-info" i], [class*="patient-banner" i]'
    );
    if (infoContainer) {
      const txt = infoContainer.textContent || '';
      const nhsMatch = txt.match(/NHS[:\s]*([\d\s]{10,13})/i);
      if (nhsMatch) nhsNumber = nhsMatch[1].replace(/\s/g, '');
      const dobMatch = txt.match(/DOB[:\s]*([\d\/\-A-Za-z\s]{8,20})/i);
      if (dobMatch) dobRaw = dobMatch[1].trim();
    }

    // Fallback: scan page for "NHS: XXX XXX XXXX" anywhere
    if (!nhsNumber) {
      const body = (doc.body && doc.body.textContent) || '';
      const m = body.match(/NHS[:\s#]*(\d{3}\s*\d{3}\s*\d{4})/);
      if (m) nhsNumber = m[1].replace(/\s/g, '');
    }

    // Fallback: scan the page for a labelled DOB anywhere if the info container
    // didn't carry one (banner layouts vary).
    if (!dobRaw) {
      const body = (doc.body && doc.body.textContent) || '';
      const m = body.match(/DOB[:\s]*([\d\/\-A-Za-z\s]{8,20})/i);
      if (m) dobRaw = m[1].trim();
    }

    const dob = parseDob(dobRaw);
    let ageYears = computeAge(dob, now);

    // Fallback: explicit age token like "Age: 35", "(35y)", "35 yrs old".
    if (ageYears == null) {
      const scan = (infoContainer && infoContainer.textContent) ||
                   (doc.body && doc.body.textContent) || '';
      const am = scan.match(/\bage\b\s*[:\-]?\s*(\d{1,3})\b/i) ||
                 scan.match(/\((\d{1,3})\s*(?:y|yr|yrs|years?)\b/i) ||
                 scan.match(/\b(\d{1,3})\s*(?:y|yr|yrs|years?)\s*old\b/i);
      if (am) { const a = parseInt(am[1], 10); if (a >= 0 && a <= 120) ageYears = a; }
    }

    // Sex extraction — try a dedicated element, then the patient-info text, then
    // a clearly labelled Sex/Gender field anywhere. Female checked before male so
    // a stray "male" inside other text can't pre-empt it.
    const readSex = (t) => {
      if (!t) return null;
      const labelled = t.match(/\b(?:sex|gender)\b\s*[:\-]?\s*(female|male|f|m)\b/i);
      if (labelled) {
        const v = labelled[1].toLowerCase();
        return (v === 'f' || v === 'female') ? 'female' : 'male';
      }
      if (/\bfemale\b/i.test(t)) return 'female';
      if (/\bmale\b/i.test(t)) return 'male';
      return null;
    };
    let sex = null;
    const sexEl = doc.querySelector('[class*="sex" i], [class*="gender" i]');
    if (sexEl) sex = readSex(sexEl.textContent || '');
    if (!sex && infoContainer) sex = readSex(infoContainer.textContent || '');
    if (!sex) {
      const body = (doc.body && doc.body.textContent) || '';
      const m = body.match(/\b(?:sex|gender)\b\s*[:\-]?\s*(female|male|f|m)\b/i);
      if (m) { const v = m[1].toLowerCase(); sex = (v === 'f' || v === 'female') ? 'female' : 'male'; }
    }

    return {
      patientName,
      nhsNumber,
      dob,
      dobRaw,
      ageYears,
      sex,
      url,
      title,
      view: detectView(url)
    };
  }

  const api = { extract, detectView, computeAge, parseDob };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelPatientContext = api;
  }
})(typeof window !== 'undefined' ? window : global);
