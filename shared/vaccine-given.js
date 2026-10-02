// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — vaccine dose identity (concept id + normalised wording)
//
// Dose counting used to be a case-insensitive substring of statusTerms.given.
// Two records of a real dose then stayed due:
//   1. The journal stores a SNOMED concept id and the rules never read it.
//   2. A semantic tag "(situation)" or another parenthetical splits the stem
//      ("SARS-CoV-2 (severe acute respiratory syndrome coronavirus 2) vaccine",
//      "Administration of RSV (respiratory syncytial virus) vaccine").
// H-090 still rejects invitation, offer and recall text before any of this
// runs. Stripping "(situation)" does not make an invitation a dose.
// The stored name is not rewritten; normalisation is match-time only, so
// "Needs influenza immunization (situation)" stays eligible and is not a dose.
//
// Dual-mode (same pattern as shared/journal-observations.js):
//   Browser: window.VaccineGiven
//   Node:    require('./shared/vaccine-given.js')

(function (global) {
  'use strict';

  // NHSD Primary Care Domain refset FLU_COD, OpenCodelists tag 20250912.
  // Includes pharmacist, other healthcare provider, midwife, school and
  // hospital-inpatient administration, plus the intranasal and inactivated
  // procedure concepts. 185903001 (Needs influenza immunization) is eligibility,
  // not a dose, and is not in this list.
  var FLU_GIVEN = [
    '1037311000000106',
    '1037331000000103',
    '1037351000000105',
    '1037371000000101',
    '1066171000000108',
    '1066181000000105',
    '1066191000000107',
    '1239861000000100',
    '884861000000100',
    '884881000000109',
    '945831000000105',
    '955651000000100',
    '955661000000102',
    '955671000000109',
    '955681000000106',
    '955691000000108',
    '955701000000108',
    '985151000000100',
    '985171000000109',
  ];

  // PRIMIS COVADM1 (1324681000000101, 840534001) plus the second-dose and
  // course concepts on OpenSAFELY "COVID-19 vaccination given"
  // (1324691000000104, 1324671000000103, 1324851000000106).
  // 90640007 is not used: that international "Coronavirus vaccination" concept
  // has been published against influenza as well as COVID.
  var COVID_GIVEN = ['1324681000000101', '1324691000000104', '840534001', '1324671000000103', '1324851000000106'];

  // NHSD RSVADMIN_COD, OpenCodelists tag 20241205. Both rows are
  // "Administration of vaccine product containing only Human orthopneumovirus antigen".
  var RSV_GIVEN = ['1303503001', '1853491000000104'];

  // NHSD PNEUVAC1_COD, OpenCodelists tag 20250912.
  // 1296904008 is the 13-valent conjugate (PCV13). 12866006 is the generic
  // Streptococcus pneumoniae antigen product. Neither is on the under-65 rule:
  // an infant PCV13 course must not satisfy that rule for life.
  var PNEUMO_65_GIVEN = [
    '1119367000',
    '12866006',
    '1296904008',
    '1344704001',
    '170337005',
    '310578008',
    '571631000119106',
    '871833000',
  ];
  var PNEUMO_U65_GIVEN = ['1119367000', '1344704001', '170337005', '310578008', '571631000119106', '871833000'];

  // NHS England, General practice shingles vaccination programme technical
  // guidance (Table 1, payment codes). Shingrix dose codes are on both rules.
  // Zostavax (871898007, 871899004) and the generic product 722215002 (previously
  // presumed to be Zostavax) are on the routine rule only. 1730561000000103
  // ("Requires vaccination against herpes zoster") is not a dose.
  // 868511000000106 is administration by another provider: not a payment code,
  // and it is a dose for recall purposes.
  var SHINGLES_SHINGRIX = ['1326101000000105', '1326111000000107'];
  var SHINGLES_ROUTINE_ONLY = ['871898007', '871899004', '722215002'];
  var SHINGLES_EITHER = ['859641000000109', '868511000000106'];

  var CODES_BY_RULE = {
    'vax-flu': FLU_GIVEN,
    'vax-covid': COVID_GIVEN,
    'vax-rsv': RSV_GIVEN,
    'vax-pneumo-ppv23': PNEUMO_65_GIVEN,
    'vax-pneumo-risk-u65': PNEUMO_U65_GIVEN,
    'vax-shingles': SHINGLES_SHINGRIX.concat(SHINGLES_ROUTINE_ONLY, SHINGLES_EITHER),
    'vax-shingles-immuno': SHINGLES_SHINGRIX.concat(SHINGLES_EITHER),
  };

  // One-off vaccines only. Flu and COVID codes are absent on purpose: a coded
  // flu note stays on the 400-day journal window, and the season window still
  // decides whether it counts for this season.
  var LIFETIME_CODES = {};
  RSV_GIVEN.concat(PNEUMO_65_GIVEN, SHINGLES_SHINGRIX, SHINGLES_ROUTINE_ONLY, SHINGLES_EITHER).forEach(function (id) {
    LIFETIME_CODES[id] = true;
  });

  // Stems that identify an RSV, pneumococcal or shingles record after
  // parentheticals are removed. Flu and COVID wording is not here.
  var LIFETIME_STEMS = [
    'orthopneumovirus',
    'respiratory syncytial',
    'rsv vaccin',
    'abrysvo',
    'arexvy',
    'mresvia',
    'administration of rsv',
    'pneumococcal',
    'pneumovax',
    'ppv23',
    'pcv20',
    'apexxnar',
    'prevenar',
    'shingles',
    'herpes zoster',
    'shingrix',
    'zostavax',
    'zoster vaccin',
    'alphaherpesvirus 3',
    'antigen for shingles',
  ];

  function codesForRule(ruleId) {
    var list = CODES_BY_RULE[ruleId];
    return list ? list.slice() : [];
  }

  function conceptIdsOf(item) {
    if (item == null || item === '') return [];
    if (typeof item === 'string' || typeof item === 'number') return [String(item).trim()];
    var raw = [
      item.code,
      item.conceptId,
      item.snomed,
      item.descriptionId,
      item.problemCode && item.problemCode.conceptId,
      item.problemCode && item.problemCode.descriptionId,
    ];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] == null) continue;
      var s = String(raw[i]).trim();
      if (s) out.push(s);
    }
    return out;
  }

  function codeHits(item, codes) {
    if (!codes || !codes.length || item == null) return false;
    var ids = conceptIdsOf(item);
    if (!ids.length) return false;
    for (var i = 0; i < codes.length; i++) {
      if (ids.indexOf(String(codes[i])) !== -1) return true;
    }
    return false;
  }

  // Drop SNOMED semantic tags and any other parenthetical, then collapse
  // whitespace. "(situation)" is a tag, not a reason to ignore an
  // administration. Invitation wording is outside the brackets and is rejected
  // separately, before this result is matched.
  function normalizeVaccineText(text) {
    var s = String(text || '');
    var prev;
    do {
      prev = s;
      s = s.replace(/\([^()]*\)/g, ' ');
    } while (s !== prev);
    return s.replace(/\s+/g, ' ').trim();
  }

  // Not a dose and not a decline. "(situation)" is intentionally absent:
  // administration concepts carry that tag. "sent" is a whole word so
  // "consent" is not rejected.
  function textIsNonAdministration(text) {
    var s = String(text || '');
    if (!s.trim()) return false;
    return (
      /\binvitations?\b/i.test(s) ||
      /\boffered\b/i.test(s) ||
      /\boffers?\b/i.test(s) ||
      /\bshort message service\b/i.test(s) ||
      /\btext messages? sent\b/i.test(s) ||
      /\bsent\b/i.test(s) ||
      /filed automatically with the invitation/i.test(s)
    );
  }

  // True when a coded note is an RSV, pneumococcal or shingles record and
  // must not be cut by the 400-day journal window. Invitations return false.
  // Flu, COVID and the flu eligibility flag return false.
  function isLifetimeVaccineRecord(name, code) {
    if (textIsNonAdministration(name)) return false;
    if (codeHits(code, Object.keys(LIFETIME_CODES))) return true;
    var norm = normalizeVaccineText(name).toLowerCase();
    if (!norm) return false;
    for (var i = 0; i < LIFETIME_STEMS.length; i++) {
      if (norm.indexOf(LIFETIME_STEMS[i]) !== -1) return true;
    }
    return false;
  }

  var ALL_GIVEN_CODES = [];
  Object.keys(CODES_BY_RULE).forEach(function (ruleId) {
    CODES_BY_RULE[ruleId].forEach(function (id) {
      if (ALL_GIVEN_CODES.indexOf(id) === -1) ALL_GIVEN_CODES.push(id);
    });
  });

  // A coded procedure is read only when it is a vaccine record. Other
  // procedures (a blood test, an operation) stay out of the observation list.
  var PROCEDURE_TEXT_RE =
    /\b(?:vaccin|immunis|fluenz|influvac|comirnaty|spikevax|nuvaxovid|abrysvo|arexvy|mresvia|shingrix|zostavax|pneumovax|prevenar|vaxneuvance|influenza|covid-19|covid|coronavirus|pneumococcal|shingles|herpes zoster)\b/i;

  function isVaccineProcedureRecord(name, code) {
    if (textIsNonAdministration(name)) return false;
    if (codeHits(code, ALL_GIVEN_CODES)) return true;
    if (isLifetimeVaccineRecord(name, code)) return true;
    var norm = normalizeVaccineText(name);
    return PROCEDURE_TEXT_RE.test(norm);
  }

  // Structured not-given, only when the record exposes it. Absent, and
  // ordinary problem status ("active", "inactive"), are not a not-given.
  // "not-done" / "not given" are the FHIR and journal tokens. entered-in-error
  // is not a dose and is not a decline.
  var NOT_GIVEN_RE = /^(?:not[-_ ]?done|not[-_ ]?given)$/i;
  var STATUS_KEYS = [
    'administrationStatus',
    'immunisationStatus',
    'immunizationStatus',
    'doseStatus',
    'outcome',
    'status',
  ];

  function statusTokens(value) {
    if (value == null || value === false || value === true) return [];
    if (typeof value === 'string' || typeof value === 'number') {
      var s = String(value).trim();
      return s ? [s] : [];
    }
    if (typeof value !== 'object') return [];
    var out = [];
    if (value.code != null && String(value.code).trim()) out.push(String(value.code).trim());
    if (value.display != null && String(value.display).trim()) out.push(String(value.display).trim());
    if (value.text != null && String(value.text).trim()) out.push(String(value.text).trim());
    if (Array.isArray(value.coding)) {
      value.coding.forEach(function (c) {
        if (!c) return;
        if (c.code != null && String(c.code).trim()) out.push(String(c.code).trim());
        if (c.display != null && String(c.display).trim()) out.push(String(c.display).trim());
      });
    }
    return out;
  }

  function structuredVaccineOutcome(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.vaccineOutcome === 'not-given' || item.vaccineOutcome === 'entered-in-error') return item.vaccineOutcome;
    if (item.notGiven === true || item.isNotGiven === true || item.notAdministered === true) return 'not-given';
    for (var k = 0; k < STATUS_KEYS.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(item, STATUS_KEYS[k])) continue;
      var tokens = statusTokens(item[STATUS_KEYS[k]]);
      for (var t = 0; t < tokens.length; t++) {
        if (NOT_GIVEN_RE.test(tokens[t])) return 'not-given';
        if (/^entered-in-error$/i.test(tokens[t])) return 'entered-in-error';
      }
    }
    return null;
  }

  var api = {
    codesForRule: codesForRule,
    codeHits: codeHits,
    normalizeVaccineText: normalizeVaccineText,
    textIsNonAdministration: textIsNonAdministration,
    isLifetimeVaccineRecord: isLifetimeVaccineRecord,
    isVaccineProcedureRecord: isVaccineProcedureRecord,
    structuredVaccineOutcome: structuredVaccineOutcome,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.VaccineGiven = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
