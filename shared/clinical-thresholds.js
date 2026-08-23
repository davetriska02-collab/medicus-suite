// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — clinical thresholds (single source)
//
// KDIGO eGFR/ACR staging, NICE NG28/NG136 chart zones, RCV table, BP targets.
// No-value-change extract from trends.js / visualiser-core.js / trend-chart.js.
// Flagged to CSO as a location refactor only — values are byte-identical.
//
// Dual-mode: window.ClinicalThresholds (classic script) / require() in Node.
// ESM consumers read globalThis.ClinicalThresholds after the classic script loads.

'use strict';

(function (global) {
  function gStage(e) {
    if (e == null || !Number.isFinite(e)) return null;
    if (e >= 90) return 'G1';
    if (e >= 60) return 'G2';
    if (e >= 45) return 'G3a';
    if (e >= 30) return 'G3b';
    if (e >= 15) return 'G4';
    return 'G5';
  }
  function aStage(a) {
    if (a == null || !Number.isFinite(a)) return null;
    if (a < 3) return 'A1';
    if (a <= 30) return 'A2';
    return 'A3';
  }
  function bpTarget(registers, age, acrOver70) {
    const codes = new Set((registers || []).map((r) => String(r.code || '').toUpperCase()));
    if (codes.has('CKD') && acrOver70) return { sys: 130, dia: 80, label: 'CKD + ACR >70' };
    if (codes.has('HYP') && age != null && age >= 80) return { sys: 150, dia: 90, label: 'HYP ≥80' };
    if (['HYP', 'DM', 'CHD', 'STIA'].some((c) => codes.has(c))) return { sys: 140, dia: 90, label: 'standard' };
    return null;
  }
  const ACR_BANDS = [
    { lo: 0, hi: 3, cls: 'tc-a1' },
    { lo: 3, hi: 30, cls: 'tc-a2' },
    { lo: 30, hi: 100, cls: 'tc-a3' },
  ];
  const EGFR_BANDS = [
    { lo: 90, hi: 200, cls: 'tc-g1' },
    { lo: 60, hi: 90, cls: 'tc-g2' },
    { lo: 45, hi: 60, cls: 'tc-g3a' },
    { lo: 30, hi: 45, cls: 'tc-g3b' },
    { lo: 15, hi: 30, cls: 'tc-g4' },
    { lo: 0, hi: 15, cls: 'tc-g5' },
  ];
  const CLINICAL_ZONES = {
    egfr: [
      { from: 90, to: 250, colour: 'rgba(0,127,59,0.10)', label: 'G1 (≥90)' },
      { from: 60, to: 90, colour: 'rgba(120,194,72,0.12)', label: 'G2 (60–89)' },
      { from: 45, to: 60, colour: 'rgba(255,235,59,0.18)', label: 'G3a (45–59)' },
      { from: 30, to: 45, colour: 'rgba(244,119,56,0.20)', label: 'G3b (30–44)' },
      { from: 15, to: 30, colour: 'rgba(212,53,28,0.22)', label: 'G4 (15–29)' },
      { from: 0, to: 15, colour: 'rgba(95,17,9,0.28)', label: 'G5 (<15)' },
    ],
    hba1c: [
      { from: 0, to: 42, colour: 'rgba(0,127,59,0.10)', label: 'Normal (<42)' },
      { from: 42, to: 48, colour: 'rgba(255,235,59,0.15)', label: 'Pre-diabetes (42–47)' },
      { from: 48, to: 58, colour: 'rgba(120,194,72,0.18)', label: 'On-target (48–57)' },
      { from: 58, to: 75, colour: 'rgba(244,119,56,0.18)', label: 'Suboptimal (58–74)' },
      { from: 75, to: 250, colour: 'rgba(212,53,28,0.22)', label: 'Poor control (≥75)' },
    ],
    'systolic blood pressure': [
      { from: 0, to: 120, colour: 'rgba(0,127,59,0.10)', label: 'Optimal' },
      { from: 120, to: 140, colour: 'rgba(255,235,59,0.10)', label: 'Pre-HTN' },
      { from: 140, to: 160, colour: 'rgba(244,119,56,0.15)', label: 'Stage 1 HTN' },
      { from: 160, to: 300, colour: 'rgba(212,53,28,0.18)', label: 'Stage 2 HTN' },
    ],
  };
  const RCV_TABLE = {
    sodium: 0.013,
    potassium: 0.05,
    chloride: 0.025,
    bicarbonate: 0.1,
    urea: 0.16,
    creatinine: 0.14,
    egfr: 0.14,
    calcium: 0.04,
    phosphate: 0.13,
    magnesium: 0.07,
    albumin: 0.045,
    'total protein': 0.04,
    bilirubin: 0.35,
    alt: 0.35,
    ast: 0.2,
    'alkaline phosphatase': 0.1,
    alp: 0.1,
    ggt: 0.3,
    haemoglobin: 0.08,
    hgb: 0.08,
    ' hb ': 0.08,
    'white cell count': 0.2,
    wbc: 0.2,
    platelet: 0.15,
    mcv: 0.025,
    mch: 0.025,
    hba1c: 0.12,
    glucose: 0.15,
    tsh: 0.45,
    'free t4': 0.1,
    t4: 0.1,
    'total cholesterol': 0.13,
    cholesterol: 0.13,
    hdl: 0.13,
    ldl: 0.2,
    triglyceride: 0.3,
    ferritin: 0.3,
    crp: 0.4,
    b12: 0.2,
    folate: 0.3,
    'vitamin d': 0.3,
    psa: 0.3,
  };
  const api = { gStage, aStage, bpTarget, ACR_BANDS, EGFR_BANDS, CLINICAL_ZONES, RCV_TABLE };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ClinicalThresholds = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
