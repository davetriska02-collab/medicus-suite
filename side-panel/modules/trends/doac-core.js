// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Trends DOAC review core (pure ES module, no chrome/DOM)
//
// Display-only Cockcroft-Gault CrCl + DOAC context for the Trends tab.
// Does NOT band or suppress Sentinel drug-monitoring intervals (hazard D-001
// still stands — a wrong CrCl must never hide a due U&E). Fail closed when
// any Cockcroft-Gault input is missing, paediatric, or unit-ambiguous.
//
// Formula (UK SI, SPS / BNF):
//   CrCl (mL/min) = ((140 − age) × weight(kg) × F) / serum creatinine (μmol/L)
//   F = 1.23 male, 1.04 female. Actual recorded body weight (not IBW).

'use strict';

export const DOAC_TERMS = [
  { key: 'apixaban', label: 'Apixaban', match: ['apixaban', 'eliquis'] },
  { key: 'rivaroxaban', label: 'Rivaroxaban', match: ['rivaroxaban', 'xarelto'] },
  { key: 'edoxaban', label: 'Edoxaban', match: ['edoxaban', 'lixiana'] },
  { key: 'dabigatran', label: 'Dabigatran', match: ['dabigatran', 'pradaxa'] },
];

export const CG_MALE = 1.23;
export const CG_FEMALE = 1.04;
export const ADULT_MIN_AGE = 18;
export const WEIGHT_STALE_DAYS = 365;
export const CREAT_STALE_DAYS = 365;
export const WEIGHT_PAIR_STALE_DAYS = 90;

const CREAT_NAMES = ['creatinine', 'serum creatinine'];
const CREAT_EXCLUDE = ['urine', 'acr', 'albumin', 'clearance', 'crcl', 'ratio', 'urine creatinine', 'microalbumin'];
const WEIGHT_NAMES = ['weight', 'body weight'];
const WEIGHT_EXCLUDE = ['weight loss', 'birth weight', 'ideal body weight', 'loss'];
const HEIGHT_NAMES = ['height', 'body height'];
const HEIGHT_EXCLUDE = ['sitting', 'fundal', 'uterine'];
const FBC_NAMES = ['fbc', 'full blood count', 'haemoglobin', 'hemoglobin'];
const FBC_EXCLUDE = ['glycated', 'hba1c', 'a1c', 'mean cell', 'mch', 'mcv', 'rdw'];
const LFT_NAMES = ['lft', 'liver function', 'alanine aminotransferase', 'alt'];
const LFT_EXCLUDE = ['salt', 'altitude'];

const NSAID_TERMS = [
  'ibuprofen',
  'naproxen',
  'diclofenac',
  'indometacin',
  'indomethacin',
  'meloxicam',
  'etoricoxib',
  'celecoxib',
  'mefenamic',
  'ketoprofen',
  'piroxicam',
  'tenoxicam',
  'aceclofenac',
];
const ANTIPLATELET_TERMS = ['aspirin', 'clopidogrel', 'prasugrel', 'ticagrelor', 'dipyridamole'];

export const DOAC_SPEC = {
  apixaban: {
    contraCrcl: 15,
    renalNote: 'Least renally cleared (~27%). Avoid if CrCl <15 mL/min.',
    doseReview:
      'AF dose may reduce to 2.5 mg BD if CrCl 15–29, or if two of: age ≥80, weight ≤60 kg, creatinine ≥133 µmol/L.',
  },
  rivaroxaban: {
    contraCrcl: 15,
    renalNote: '~35% renally cleared. Avoid if CrCl <15 mL/min. 15/20 mg tablets with food.',
    doseReview: 'AF dose is usually 15 mg OD when CrCl 15–49 (20 mg OD otherwise).',
  },
  edoxaban: {
    contraCrcl: 15,
    renalNote: 'Avoid if CrCl <15 mL/min. BNF: caution if CrCl >95 mL/min in AF (reduced-efficacy signal).',
    doseReview: 'AF dose is usually 30 mg OD when CrCl 15–50, weight ≤60 kg, or with certain P-gp inhibitors.',
  },
  dabigatran: {
    contraCrcl: 30,
    renalNote: '~80% renally cleared. Contraindicated if CrCl <30 mL/min.',
    doseReview: 'Consider 110 mg BD if CrCl 30–50, age ≥80, or high bleed risk.',
  },
};

function nameOf(row) {
  return String(row?.name || row?.label || '').toLowerCase();
}

function rowMatches(row, names, exclude) {
  const n = nameOf(row);
  if (!n) return false;
  if (exclude.some((x) => n.includes(x))) return false;
  return names.some((x) => n.includes(x));
}

function historyPoints(row) {
  return (row?.history || [])
    .filter((h) => Number.isFinite(h.value))
    .map((h) => ({ date: h.date, value: h.value, unit: row?.unit || h.unit || '', rawValue: h.rawValue }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function daysBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.round((db - da) / (24 * 3600 * 1000));
}

export function computeAgeYears(pc, now) {
  if (!pc) return null;
  if (Number.isFinite(pc.ageYears)) return pc.ageYears;
  if (Number.isFinite(pc.age)) return pc.age;
  const dob = pc.dob || pc.dateOfBirth || pc.dobRaw;
  if (!dob) return null;
  return ageAt(dob, now || new Date());
}

export function ageAt(dob, onDate) {
  const d = new Date(dob);
  const on = new Date(onDate);
  if (isNaN(d) || isNaN(on)) return null;
  let age = on.getFullYear() - d.getFullYear();
  const md = on.getMonth() - d.getMonth();
  if (md < 0 || (md === 0 && on.getDate() < d.getDate())) age -= 1;
  return age;
}

export function normalizeSex(sex) {
  if (sex == null) return null;
  const s = String(sex).trim().toLowerCase();
  if (!s) return null;
  if (s === 'm' || s.startsWith('male') || s === 'man') return 'male';
  if (s === 'f' || s.startsWith('female') || s === 'woman') return 'female';
  return null;
}

export function identifyDoac(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  for (const d of DOAC_TERMS) {
    if (d.match.some((t) => n.includes(t))) return { key: d.key, label: d.label };
  }
  return null;
}

export function findDoacs(medications) {
  const out = [];
  const seen = new Set();
  for (const med of medications || []) {
    const id = identifyDoac(med?.name);
    if (!id) continue;
    const key = id.key + '|' + String(med.name || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key: id.key,
      label: id.label,
      name: med.name,
      dosage: med.dosage || null,
      source: med.source || null,
      startDate: med.startDate || null,
    });
  }
  return out;
}

export function seriesFor(history, names, exclude) {
  const row = (history || []).find((o) => rowMatches(o, names, exclude));
  if (!row) return { pts: [], unit: '' };
  return { pts: historyPoints(row), unit: row.unit || '' };
}

export function creatSeries(history) {
  return seriesFor(history, CREAT_NAMES, CREAT_EXCLUDE);
}

export function weightSeries(history) {
  return seriesFor(history, WEIGHT_NAMES, WEIGHT_EXCLUDE);
}

export function heightSeries(history) {
  return seriesFor(history, HEIGHT_NAMES, HEIGHT_EXCLUDE);
}

export function latestPoint(pts) {
  return pts && pts.length ? pts[pts.length - 1] : null;
}

// Convert a serum creatinine reading to μmol/L. Fail closed on ambiguous units
// (a mg/dL value treated as μmol/L would invent a near-zero CrCl).
export function normalizeCreatinineUmol(value, unit) {
  if (!Number.isFinite(value) || value <= 0) return { umol: null, reason: 'missing-creatinine' };
  const u = String(unit || '')
    .toLowerCase()
    .replace(/µ/g, 'u')
    .replace(/μ/g, 'u');
  if (!u) {
    // UK records almost always omit the unit and store μmol/L (typically 40–800).
    // Values ≤20 without a unit could be mg/dL — refuse rather than guess.
    if (value > 20) return { umol: value, reason: null, assumed: 'umol/L' };
    return { umol: null, reason: 'ambiguous-unit' };
  }
  if (u.includes('mg/dl') || u.includes('mg/d l') || (u.includes('mg') && u.includes('dl'))) {
    return { umol: value * 88.4, reason: null };
  }
  if (u.includes('mmol') && !u.includes('umol') && !u.includes('micromol')) {
    return { umol: value * 1000, reason: null };
  }
  if (u.includes('umol') || u.includes('micromol') || u.includes('mcmol')) {
    return { umol: value, reason: null };
  }
  // Unknown unit string — only accept if the number itself is clearly SI.
  if (value > 20) return { umol: value, reason: null, assumed: 'umol/L' };
  return { umol: null, reason: 'ambiguous-unit' };
}

export function cockcroftGault({ ageYears, sex, weightKg, creatUmol }) {
  const missing = [];
  if (!Number.isFinite(ageYears)) missing.push('age');
  const sexN = normalizeSex(sex);
  if (!sexN) missing.push('sex');
  if (!Number.isFinite(weightKg) || weightKg <= 0) missing.push('weight');
  if (!Number.isFinite(creatUmol) || creatUmol <= 0) missing.push('creatinine');
  if (missing.length) return { crcl: null, reason: 'missing-inputs', missing };

  if (ageYears < ADULT_MIN_AGE) return { crcl: null, reason: 'paediatric', missing: [] };
  if (ageYears > 120) return { crcl: null, reason: 'invalid-age', missing: [] };
  if (weightKg < 20 || weightKg > 300) return { crcl: null, reason: 'invalid-weight', missing: [] };
  if (creatUmol < 20 || creatUmol > 2000) return { crcl: null, reason: 'invalid-creatinine', missing: [] };

  const F = sexN === 'male' ? CG_MALE : CG_FEMALE;
  const crcl = ((140 - ageYears) * weightKg * F) / creatUmol;
  if (!Number.isFinite(crcl) || crcl <= 0) return { crcl: null, reason: 'invalid-result', missing: [] };
  return { crcl, reason: null, missing: [], factor: F, sex: sexN };
}

export function crclMonitorBand(crcl, { ageYears, drugKey } = {}) {
  if (!Number.isFinite(crcl)) {
    return { id: 'unknown', label: 'Cannot band — CrCl not calculated', months: null, severity: 'unknown' };
  }
  const spec = drugKey ? DOAC_SPEC[drugKey] : null;
  if (spec && crcl < spec.contraCrcl) {
    return {
      id: 'contra',
      label:
        drugKey === 'dabigatran'
          ? 'CrCl <30 — dabigatran contraindicated; refer'
          : 'CrCl <15 — DOACs contraindicated; refer',
      months: null,
      severity: 'red',
    };
  }
  if (crcl < 15) {
    return { id: 'contra', label: 'CrCl <15 — all DOACs contraindicated; refer', months: null, severity: 'red' };
  }
  if (crcl < 30) {
    return { id: 'q3', label: '3-monthly renal monitoring (CrCl 15–29)', months: 3, severity: 'red' };
  }
  if (ageYears != null && ageYears > 75) {
    if (crcl < 60) {
      return {
        id: 'q6-elderly',
        label: '6-monthly renal monitoring (CrCl 30–59); age >75',
        months: 6,
        severity: 'amber',
      };
    }
    return { id: 'elderly', label: 'Age >75 — at least 4–6 monthly regardless of CrCl', months: 6, severity: 'amber' };
  }
  if (crcl < 60) {
    return { id: 'q6', label: '6-monthly renal monitoring (CrCl 30–59)', months: 6, severity: 'amber' };
  }
  return { id: 'annual', label: 'Annual renal monitoring (CrCl ≥60)', months: 12, severity: 'ok' };
}

export function pairWeightForDate(weightPts, date) {
  if (!weightPts?.length || !date) return null;
  const target = new Date(date);
  if (isNaN(target)) return null;
  let bestBefore = null;
  let bestAfter = null;
  for (const p of weightPts) {
    const d = new Date(p.date);
    if (isNaN(d)) continue;
    const delta = daysBetween(p.date, date);
    if (delta == null) continue;
    if (delta >= 0) {
      if (!bestBefore || daysBetween(p.date, date) < daysBetween(bestBefore.date, date)) bestBefore = p;
    } else if (!bestAfter || daysBetween(date, p.date) < daysBetween(date, bestAfter.date)) {
      bestAfter = p;
    }
  }
  if (bestBefore) {
    const gap = Math.abs(daysBetween(bestBefore.date, date));
    return { ...bestBefore, gapDays: gap, stalePair: gap > WEIGHT_PAIR_STALE_DAYS };
  }
  if (bestAfter) {
    const gap = Math.abs(daysBetween(date, bestAfter.date));
    return { ...bestAfter, gapDays: gap, stalePair: gap > WEIGHT_PAIR_STALE_DAYS };
  }
  return null;
}

export function findIndication(problems) {
  const hits = [];
  const add = (label) => {
    if (!hits.includes(label)) hits.push(label);
  };
  for (const p of problems || []) {
    const l = String(p.label || p.name || p.problem || '')
      .toLowerCase()
      .trim();
    if (!l) continue;
    if (/atrial fibrillation|\bafib\b|non[- ]?valvular af/.test(l) || /^a\.?f\.?$/.test(l)) add('AF');
    if (/pulmonary embol/.test(l)) add('PE');
    if (/deep vein thromb|\bdvt\b/.test(l)) add('DVT');
    if (/venous thrombo|\bvte\b/.test(l)) add('VTE');
  }
  return hits;
}

export function findInteractingMeds(medications) {
  const out = [];
  for (const med of medications || []) {
    const n = String(med?.name || '').toLowerCase();
    if (!n) continue;
    if (NSAID_TERMS.some((t) => n.includes(t))) {
      out.push({ kind: 'NSAID', name: med.name, risk: 'GI bleed risk with DOAC (PINCER)' });
    } else if (ANTIPLATELET_TERMS.some((t) => n.includes(t))) {
      out.push({ kind: 'antiplatelet', name: med.name, risk: 'Bleed risk — dual antithrombotic; gastroprotection?' });
    }
  }
  return out;
}

export function lastTestDate(history, names, exclude) {
  let latest = null;
  for (const row of history || []) {
    if (!rowMatches(row, names, exclude)) continue;
    for (const h of row.history || []) {
      if (!h?.date) continue;
      if (!latest || String(h.date) > String(latest)) latest = h.date;
    }
  }
  return latest;
}

export function drugRenalFlags(drugKey, { crcl, ageYears, weightKg, creatUmol } = {}) {
  const spec = DOAC_SPEC[drugKey];
  const flags = [];
  if (!spec) return flags;
  if (Number.isFinite(crcl) && crcl < spec.contraCrcl) {
    flags.push({
      severity: 'red',
      text:
        drugKey === 'dabigatran'
          ? 'CrCl below 30 mL/min — dabigatran is contraindicated.'
          : 'CrCl below 15 mL/min — this DOAC is contraindicated.',
    });
  }
  if (drugKey === 'edoxaban' && Number.isFinite(crcl) && crcl > 95) {
    flags.push({
      severity: 'amber',
      text: 'CrCl >95 mL/min — BNF cautions reduced efficacy of edoxaban in AF.',
    });
  }
  if (drugKey === 'apixaban') {
    const hits = [];
    if (Number.isFinite(ageYears) && ageYears >= 80) hits.push('age ≥80');
    if (Number.isFinite(weightKg) && weightKg <= 60) hits.push('weight ≤60 kg');
    if (Number.isFinite(creatUmol) && creatUmol >= 133) hits.push('creatinine ≥133');
    if (hits.length >= 2) {
      flags.push({
        severity: 'amber',
        text: `Apixaban AF dose-reduction criteria may apply (${hits.join(', ')}). Review 2.5 mg BD.`,
      });
    }
    if (Number.isFinite(crcl) && crcl >= 15 && crcl < 30) {
      flags.push({
        severity: 'amber',
        text: 'CrCl 15–29 — AF dose is usually 2.5 mg BD.',
      });
    }
  }
  if (drugKey === 'rivaroxaban' && Number.isFinite(crcl) && crcl >= 15 && crcl < 50) {
    flags.push({
      severity: 'amber',
      text: 'CrCl 15–49 — AF dose is usually 15 mg OD (with food).',
    });
  }
  if (drugKey === 'edoxaban' && Number.isFinite(crcl) && crcl >= 15 && crcl <= 50) {
    flags.push({
      severity: 'amber',
      text: 'CrCl 15–50 — AF dose is usually 30 mg OD.',
    });
  }
  if (drugKey === 'dabigatran' && Number.isFinite(crcl) && crcl >= 30 && crcl < 50) {
    flags.push({
      severity: 'amber',
      text: 'CrCl 30–50 — consider dabigatran 110 mg BD.',
    });
  }
  return flags;
}

export function buildCrclSeries({ creatPts, weightPts, ageYears, sex, dob, now }) {
  const pts = [];
  for (const c of creatPts || []) {
    const creat = normalizeCreatinineUmol(c.value, c.unit);
    if (!creat.umol) continue;
    const w = pairWeightForDate(weightPts, c.date);
    if (!w) continue;
    const age = dob ? ageAt(dob, c.date) : ageYears;
    const cg = cockcroftGault({ ageYears: age, sex, weightKg: w.value, creatUmol: creat.umol });
    if (!Number.isFinite(cg.crcl)) continue;
    pts.push({
      date: c.date,
      value: Math.round(cg.crcl),
      crcl: cg.crcl,
      creatUmol: creat.umol,
      weightKg: w.value,
      weightDate: w.date,
      stalePair: !!w.stalePair,
    });
  }
  void now;
  return pts;
}

function missingLabel(reason, missing) {
  if (reason === 'paediatric') return 'Cockcroft-Gault is for adults — not calculated under 18.';
  if (reason === 'ambiguous-unit') return 'Creatinine unit is ambiguous — CrCl not calculated.';
  if (reason === 'invalid-weight') return 'Recorded weight is outside a plausible adult range — CrCl not calculated.';
  if (reason === 'invalid-creatinine') return 'Creatinine is outside a plausible range — CrCl not calculated.';
  if (reason === 'invalid-age') return 'Age is not usable — CrCl not calculated.';
  if (reason === 'missing-inputs' || missing?.length) {
    return `Cannot calculate CrCl — missing ${missing.join(', ')}.`;
  }
  return 'Cannot calculate CrCl.';
}

export function buildDoacModel(data, now) {
  const when = now ? new Date(now) : new Date();
  const meds = data?.medications || [];
  const doacs = findDoacs(meds);
  const onDoac = doacs.length > 0;
  const primary = doacs[0] || null;

  const history = data?.observationHistory || [];
  const creat = creatSeries(history);
  const weight = weightSeries(history);
  const height = heightSeries(history);
  const latestCreat = latestPoint(creat.pts);
  const latestWeight = latestPoint(weight.pts);
  const latestHeight = latestPoint(height.pts);

  const pc = data?.patientContext || {};
  const ageYears = computeAgeYears(pc, when);
  const sex = normalizeSex(pc.sex || pc.gender);
  const dob = pc.dob || pc.dateOfBirth || pc.dobRaw || null;

  let creatUmol = null;
  let creatReason = latestCreat ? null : 'missing-creatinine';
  if (latestCreat) {
    const n = normalizeCreatinineUmol(latestCreat.value, latestCreat.unit || creat.unit);
    creatUmol = n.umol;
    creatReason = n.reason;
  }

  const cg = cockcroftGault({
    ageYears,
    sex,
    weightKg: latestWeight?.value,
    creatUmol,
  });
  if (!cg.crcl && creatReason === 'ambiguous-unit') cg.reason = 'ambiguous-unit';

  const crcl = Number.isFinite(cg.crcl) ? cg.crcl : null;
  const crclRounded = crcl == null ? null : Math.round(crcl);
  const band = crclMonitorBand(crcl, { ageYears, drugKey: primary?.key });

  const creatAgeDays = latestCreat ? daysBetween(latestCreat.date, when) : null;
  const weightAgeDays = latestWeight ? daysBetween(latestWeight.date, when) : null;
  const creatStale = creatAgeDays != null && creatAgeDays > CREAT_STALE_DAYS;
  const weightStale = weightAgeDays != null && weightAgeDays > WEIGHT_STALE_DAYS;

  const crclPts = buildCrclSeries({
    creatPts: creat.pts,
    weightPts: weight.pts,
    ageYears,
    sex,
    dob,
    now: when,
  });

  const flags = [];
  if (primary) flags.push(...drugRenalFlags(primary.key, { crcl, ageYears, weightKg: latestWeight?.value, creatUmol }));
  if (creatStale && latestCreat) {
    flags.push({
      severity: 'amber',
      text: `Creatinine is ${Math.round(creatAgeDays / 30)} months old — recheck before relying on this CrCl.`,
    });
  }
  if (weightStale && latestWeight) {
    flags.push({
      severity: 'amber',
      text: `Weight is ${Math.round(weightAgeDays / 30)} months old — CrCl uses the last recorded weight.`,
    });
  }
  if (Number.isFinite(latestWeight?.value) && latestWeight.value >= 120) {
    flags.push({
      severity: 'amber',
      text: 'Weight ≥120 kg — Cockcroft-Gault with actual body weight may overestimate CrCl; consider adjusted weight.',
    });
  }

  const interactions = onDoac ? findInteractingMeds(meds) : [];
  const indications = findIndication(data?.problems || []);

  return {
    onDoac,
    doacs,
    primary,
    spec: primary ? DOAC_SPEC[primary.key] : null,
    ageYears,
    sex,
    crcl,
    crclRounded,
    crclReason: cg.reason,
    crclMissing: cg.missing || [],
    crclMessage: crcl == null ? missingLabel(cg.reason, cg.missing) : null,
    band,
    creatPts: creat.pts,
    creatUnit: creat.unit || 'µmol/L',
    latestCreat,
    creatUmol,
    creatStale,
    creatAgeDays,
    weightPts: weight.pts,
    latestWeight,
    weightStale,
    weightAgeDays,
    latestHeight,
    crclPts,
    flags,
    interactions,
    indications,
    lastFbc: lastTestDate(history, FBC_NAMES, FBC_EXCLUDE),
    lastLft: lastTestDate(history, LFT_NAMES, LFT_EXCLUDE),
    lastUe: latestCreat?.date || lastTestDate(history, ['u&e', 'urea and electrolyte', 'renal profile'], []),
  };
}

export function patientOnDoac(data) {
  return findDoacs(data?.medications || []).length > 0;
}
