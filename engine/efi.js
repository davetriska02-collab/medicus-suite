// engine/efi.js — Electronic Frailty Index (eFI) + slip-into-frailty trend
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Clegg 2016 / NHS England eFI: 36 deficits accumulated from the GP record.
// Score = count / 36. Cut-points (same as visualiser-core.js):
//   ≤0.12 fit; >0.12–<0.25 mild; ≥0.25–≤0.36 moderate; >0.36 severe.
//
// This is a KEYWORD APPROXIMATION of the published instrument, not the
// official NHS Digital eFI (which uses a SNOMED/Read refset). Absence of a
// slip chip is not "fit". REQUIRES CSO REVIEW BEFORE CLINICAL RELIANCE.
//
// Dual-export: Node require OR browser global `Efi`.

(function (global) {
  'use strict';

  // Clegg 2016 36-deficit table. Terms are case-insensitive substrings.
  // Brand-list completeness does not apply here (these are problem labels).
  // Keep ids stable — test-efi.js and the visualiser snapshot both key on them.
  const EFI_DEFICITS = [
    { id: 'anaemia', label: 'Anaemia', terms: ['anaemia', 'anemia'] },
    { id: 'arthritis', label: 'Arthritis', terms: ['osteoarthritis', 'rheumatoid arthritis', 'arthritis'] },
    { id: 'af', label: 'Atrial fibrillation', terms: ['atrial fibrillation'] },
    { id: 'cva', label: 'Cerebrovascular disease', terms: ['stroke', 'transient ischaem', 'tia', 'cerebrovascular'] },
    { id: 'ckd', label: 'Chronic kidney disease', terms: ['chronic kidney', 'ckd stage'] },
    { id: 'diabetes', label: 'Diabetes', terms: ['diabetes mellitus', 'type 2 diabetes', 'type 1 diabetes'] },
    { id: 'dizziness', label: 'Dizziness', terms: ['dizziness', 'vertigo', 'giddiness'] },
    { id: 'dyspnoea', label: 'Dyspnoea', terms: ['dyspnoea', 'breathlessness', 'shortness of breath'] },
    { id: 'falls', label: 'Falls', terms: ['fall ', 'falls', 'fell', 'fallen'] },
    { id: 'foot', label: 'Foot problems', terms: ['foot problem', 'plantar', 'bunion', 'onychomycosis', 'corn '] },
    {
      id: 'fracture',
      label: 'Fragility fracture',
      terms: [
        'fragility fracture',
        'fractured neck of femur',
        'fractured wrist',
        'colles',
        'pubic ramus fracture',
        'vertebral fracture',
      ],
    },
    {
      id: 'hearing',
      label: 'Hearing impairment',
      terms: ['hearing loss', 'deafness', 'hearing impair', 'presbycusis'],
    },
    { id: 'hf', label: 'Heart failure', terms: ['heart failure'] },
    {
      id: 'valve',
      label: 'Heart valve disease',
      terms: ['aortic stenosis', 'mitral regurg', 'aortic regurg', 'valvular', 'valve disease'],
    },
    { id: 'htn', label: 'Hypertension', terms: ['hypertension', 'raised blood pressure'] },
    { id: 'hypotension', label: 'Hypotension / syncope', terms: ['hypotension', 'postural', 'syncope', 'collapse'] },
    {
      id: 'ihd',
      label: 'Ischaemic heart disease',
      terms: ['ischaemic heart', 'coronary', 'angina', 'myocardial infarction'],
    },
    {
      id: 'memory',
      label: 'Memory / cognitive problems',
      terms: ['memory', 'cognitive impair', 'dementia', 'alzheimer', 'confusion'],
    },
    {
      id: 'mobility',
      label: 'Mobility / transfer probs',
      terms: ['mobility', 'immobility', 'transfer problem', 'gait', 'walking diff'],
    },
    { id: 'osteo', label: 'Osteoporosis', terms: ['osteoporosis', 'osteopenia'] },
    { id: 'parkinson', label: 'Parkinsonism / tremor', terms: ['parkinson', 'tremor', 'essential tremor'] },
    { id: 'ulcer', label: 'Peptic ulcer', terms: ['peptic ulcer', 'gastric ulcer', 'duodenal ulcer'] },
    {
      id: 'pvd',
      label: 'Peripheral vascular disease',
      terms: ['peripheral vascular', 'peripheral arterial', 'intermittent claudication'],
    },
    { id: 'polypharm', label: 'Polypharmacy (≥5)', terms: [] },
    { id: 'pressure', label: 'Pressure ulcer', terms: ['pressure ulcer', 'pressure sore', 'decubitus'] },
    {
      id: 'care',
      label: 'Requirement for care',
      terms: ['care home', 'nursing home', 'requires care', 'carer', 'social care'],
    },
    {
      id: 'respiratory',
      label: 'Respiratory disease',
      terms: ['copd', 'chronic obstructive', 'asthma', 'bronchiectasis', 'pulmonary fibrosis'],
    },
    { id: 'skin', label: 'Skin ulcer', terms: ['leg ulcer', 'venous ulcer', 'skin ulcer'] },
    {
      id: 'sleep',
      label: 'Sleep disturbance',
      terms: ['insomnia', 'sleep disturb', 'sleep apnoea', 'obstructive sleep'],
    },
    {
      id: 'social',
      label: 'Social vulnerability',
      terms: ['social isolation', 'lives alone', 'bereavement', 'homelessness', 'safeguarding'],
    },
    { id: 'thyroid', label: 'Thyroid disease', terms: ['hypothyroid', 'hyperthyroid', 'goitre', 'thyroid'] },
    {
      id: 'inc_urin',
      label: 'Urinary incontinence',
      terms: ['urinary incontinence', 'stress incontinence', 'urge incontinence'],
    },
    {
      id: 'urin_sys',
      label: 'Urinary system disease',
      terms: ['benign prostatic', 'prostatic hyperplasia', 'recurrent urinary', 'overactive bladder', 'prostate'],
    },
    { id: 'visual', label: 'Visual impairment', terms: ['cataract', 'macular', 'glaucoma', 'visual impair', 'blind '] },
    { id: 'weight', label: 'Weight loss / anorexia', terms: ['weight loss', 'anorexia', 'cachexia', 'malnutrition'] },
    { id: 'activity', label: 'Activity limitation', terms: ['activity limit', 'frailty', 'functional decline'] },
  ];

  const CATEGORY_RANK = {
    Fit: 0,
    'Mild frailty': 1,
    'Moderate frailty': 2,
    'Severe frailty': 3,
  };

  const CATEGORY_COLOUR = {
    Fit: '#007f3b',
    'Mild frailty': '#ffeb3b',
    'Moderate frailty': '#f47738',
    'Severe frailty': '#d4351c',
  };

  // Same negation reach as rules-engine.js problemLabelMatchesTerm — "no frailty"
  // / "family history of stroke" must not tick a deficit.
  const PROBLEM_NEGATION_PATTERNS = [
    /\bno\s+/,
    /\bnot\s+/,
    /\bfamily history\s+of\s+/,
    /\bfh\s+of\s+/,
    /\bhistory of\s+/,
    /\bh\/?o\s+/,
    /\bpast\s+/,
    /\bprevious\s+/,
    /\bresolved\s+/,
    /\bat risk of\s+/,
    /\brisk of\s+/,
    /\bquery\s+/,
    /\b\?/,
  ];
  const PROBLEM_NEGATION_REACH = 30;

  function problemText(p) {
    if (p == null) return '';
    if (typeof p === 'string') return p;
    return String(p.label || p.name || '');
  }

  function problemDate(p) {
    if (!p || typeof p === 'string') return null;
    return p.codedDate || p.date || p.dateToDisplay || null;
  }

  function parseDate(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function labelMatchesTerm(label, term) {
    const l = String(label || '').toLowerCase();
    const t = String(term || '').toLowerCase();
    if (!t) return false;
    const idx = l.indexOf(t);
    if (idx < 0) return false;
    const prefix = l.slice(0, idx);
    const clauseStart = Math.max(prefix.lastIndexOf(';'), prefix.lastIndexOf('.'), prefix.lastIndexOf(':')) + 1;
    const clause = prefix.slice(clauseStart);
    return !PROBLEM_NEGATION_PATTERNS.some((rx) => {
      const g = new RegExp(rx.source, 'gi');
      let m;
      let lastEnd = -1;
      while ((m = g.exec(clause)) !== null) {
        lastEnd = m.index + m[0].length;
        if (m[0].length === 0) g.lastIndex++;
      }
      return lastEnd >= 0 && clause.length - lastEnd <= PROBLEM_NEGATION_REACH;
    });
  }

  function categoryFromScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0) return 'Fit';
    if (n > 0.36) return 'Severe frailty';
    if (n >= 0.25) return 'Moderate frailty';
    if (n > 0.12) return 'Mild frailty';
    return 'Fit';
  }

  function countActiveMeds(medications) {
    if (!Array.isArray(medications)) return 0;
    return medications.filter((m) => {
      if (!m) return false;
      if (typeof m === 'string') return m.trim().length > 0;
      if (m.active === false) return false;
      return !!(m.name || m.label);
    }).length;
  }

  // Weight series matching Trends (body weight only — not birth/ideal/weight-loss codes).
  const WEIGHT_MATCH = ['weight', 'body weight'];
  const WEIGHT_EXCLUDE = ['weight loss', 'birth weight', 'ideal body weight'];

  function isWeightSeriesName(name) {
    const n = String(name || '').toLowerCase();
    if (!n) return false;
    if (WEIGHT_EXCLUDE.some((ex) => n.includes(ex))) return false;
    return WEIGHT_MATCH.some((m) => n.includes(m));
  }

  // Fried-style unintentional-loss screen: ≥5% or ≥5 kg fall across the window.
  // Used only as a NOW-only deficit source (we cannot reconstruct historical
  // weight at the cutoff without inventing a second series). Confirm
  // unintentional before acting — intentional diet is a known false positive.
  const WEIGHT_MIN_PCT = 5;
  const WEIGHT_MIN_KG = 5;

  function weightDecline(observationHistory, withinMonths, now) {
    if (!Array.isArray(observationHistory) || !withinMonths) return null;
    const nowMs = parseDate(now) ? parseDate(now).getTime() : Date.now();
    const cutoffMs = nowMs - withinMonths * 30.4375 * 24 * 60 * 60 * 1000;
    const candidates = observationHistory.filter((entry) => isWeightSeriesName(entry && entry.name));
    if (!candidates.length) return null;
    const historyEntry = candidates.reduce((a, b) => ((b.history?.length || 0) > (a.history?.length || 0) ? b : a));
    const inWindow = (historyEntry.history || []).filter((pt) => {
      const d = parseDate(pt.date);
      if (!d || d.getTime() < cutoffMs || d.getTime() > nowMs) return false;
      return Number.isFinite(pt.value);
    });
    if (inWindow.length < 2) return null;
    // History is typically newest-first; don't assume — sort.
    const ordered = inWindow.slice().sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const oldest = ordered[0];
    const newest = ordered[ordered.length - 1];
    const deltaKg = newest.value - oldest.value;
    const pct = oldest.value !== 0 ? (deltaKg / oldest.value) * 100 : 0;
    const falling = deltaKg <= -WEIGHT_MIN_KG || pct <= -WEIGHT_MIN_PCT;
    if (!falling) return null;
    return {
      oldest: oldest.value,
      newest: newest.value,
      oldestDate: oldest.date,
      newestDate: newest.date,
      deltaKg,
      pct,
    };
  }

  // Coded Rockwood / eFI category on the problem list (independent of score).
  // Highest rank wins. CFS 1–3 ≈ fit, 4–5 mild, 6 moderate, 7–9 severe.
  const CODED_FRAILTY = [
    {
      rank: 3,
      label: 'Severe frailty',
      terms: [
        'severe frailty',
        'clinical frailty scale 7',
        'clinical frailty scale 8',
        'clinical frailty scale 9',
        'cfs 7',
        'cfs 8',
        'cfs 9',
        'efi severe',
      ],
    },
    {
      rank: 2,
      label: 'Moderate frailty',
      terms: ['moderate frailty', 'clinical frailty scale 6', 'cfs 6', 'efi moderate'],
    },
    {
      rank: 1,
      label: 'Mild frailty',
      terms: ['mild frailty', 'clinical frailty scale 4', 'clinical frailty scale 5', 'cfs 4', 'cfs 5', 'efi mild'],
    },
  ];

  function problemPresentAt(problem, asOf) {
    if (!asOf) return true;
    const d = parseDate(problemDate(problem));
    if (!d) return true; // undated: count in both then and now so it cannot fake a slip
    return d.getTime() <= asOf.getTime();
  }

  function codedFrailty(problems, asOf) {
    let best = { rank: 0, label: 'Fit', evidence: null, date: null };
    for (const p of problems || []) {
      if (!problemPresentAt(p, asOf)) continue;
      const text = problemText(p);
      for (const band of CODED_FRAILTY) {
        if (band.terms.some((t) => labelMatchesTerm(text, t))) {
          if (band.rank > best.rank) {
            best = { rank: band.rank, label: band.label, evidence: text, date: problemDate(p) };
          }
          break;
        }
      }
    }
    return best;
  }

  function computeEFI(opts) {
    opts = opts || {};
    const problems = Array.isArray(opts.problems) ? opts.problems : [];
    const medications = opts.medications || [];
    const asOf = parseDate(opts.asOf);
    const includeObsWeight = !!opts.includeObsWeight;
    const observationHistory = opts.observationHistory || [];
    const withinMonths = Number.isFinite(opts.withinMonths) ? opts.withinMonths : 24;
    const now = opts.now || asOf || new Date();

    const ticked = [];
    for (const d of EFI_DEFICITS) {
      if (d.id === 'polypharm') {
        const n = countActiveMeds(medications);
        if (n >= 5) ticked.push({ ...d, evidence: `${n} drugs detected`, date: null, source: 'medication' });
        continue;
      }
      const match = problems.find((p) => {
        if (!problemPresentAt(p, asOf)) return false;
        return d.terms.some((t) => labelMatchesTerm(problemText(p), t));
      });
      if (match) {
        ticked.push({
          ...d,
          evidence: problemText(match),
          date: problemDate(match),
          source: 'problem',
        });
      }
    }

    const decline = includeObsWeight ? weightDecline(observationHistory, withinMonths, now) : null;
    if (decline && !ticked.some((t) => t.id === 'weight')) {
      const weightDef = EFI_DEFICITS.find((d) => d.id === 'weight');
      ticked.push({
        ...weightDef,
        evidence: `Weight ${Math.round(decline.oldest)} → ${Math.round(decline.newest)} kg (${decline.pct.toFixed(0)}%)`,
        date: decline.newestDate,
        source: 'observation',
      });
    }

    const score = ticked.length / EFI_DEFICITS.length;
    const category = categoryFromScore(score);
    return {
      ticked,
      total: EFI_DEFICITS.length,
      score,
      category,
      colour: CATEGORY_COLOUR[category],
      weightDecline: decline,
    };
  }

  // Visualiser adapter — same return shape as the historical computeEFI().
  function computeFromVisualiserInputs(activeProblems, pastProblems, drugs) {
    const problems = [...(activeProblems || []), ...(pastProblems || [])].map((p) => ({
      label: p && (p.name || p.label),
      codedDate: p && (p.date || p.codedDate || null),
    }));
    const medications = (drugs || []).filter((rx) => rx && rx.active !== false);
    return computeEFI({ problems, medications });
  }

  function monthsBetween(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return null;
    return Math.round(Math.abs(db - da) / (30.4375 * 24 * 60 * 60 * 1000));
  }

  /**
   * Reconstruct eFI now vs `withinMonths` ago and decide whether the patient
   * is slipping. Fires when ANY of:
   *   - eFI category worsened (Fit → Mild is the preventative window)
   *   - coded CFS/eFI category worsened
   *   - ≥ minNewDeficits newly dated (or observation-derived) deficits
   *
   * Polypharmacy is current-only, so it is counted in BOTH snapshots when
   * the live regimen is ≥5 — it cannot invent a slip by itself.
   */
  function progressFrailty(opts) {
    opts = opts || {};
    const now = parseDate(opts.now) || new Date();
    const withinMonths = Number.isFinite(opts.withinMonths) ? opts.withinMonths : 24;
    const minNewDeficits = Number.isFinite(opts.minNewDeficits) ? opts.minNewDeficits : 2;
    const problems = [...(opts.problems || []), ...(opts.pastProblems || [])];
    const medications = opts.medications || [];
    const observationHistory = opts.observationHistory || [];

    const cutoff = new Date(now.getTime() - withinMonths * 30.4375 * 24 * 60 * 60 * 1000);

    const nowScore = computeEFI({
      problems,
      medications,
      observationHistory,
      asOf: now,
      now,
      withinMonths,
      includeObsWeight: true,
    });
    const thenScore = computeEFI({
      problems,
      medications,
      observationHistory,
      asOf: cutoff,
      now: cutoff,
      withinMonths,
      includeObsWeight: false,
    });

    const thenIds = new Set(thenScore.ticked.map((t) => t.id));
    const newDeficits = nowScore.ticked.filter((t) => !thenIds.has(t.id));
    const categoryWorsened = (CATEGORY_RANK[nowScore.category] || 0) > (CATEGORY_RANK[thenScore.category] || 0);

    const codedNow = codedFrailty(problems, now);
    const codedThen = codedFrailty(problems, cutoff);
    const codedWorsened = codedNow.rank > codedThen.rank;

    const fires = categoryWorsened || codedWorsened || newDeficits.length >= minNewDeficits;

    const sameDayCatchUp =
      newDeficits.length >= 2 &&
      newDeficits.every((d) => d.date) &&
      new Set(newDeficits.map((d) => String(d.date).slice(0, 10))).size === 1;

    let valueText;
    if (categoryWorsened) {
      valueText = `${thenScore.category} → ${nowScore.category} (${thenScore.ticked.length} → ${nowScore.ticked.length} deficits)`;
    } else if (codedWorsened) {
      valueText = `Coded ${codedThen.label} → ${codedNow.label}`;
    } else if (fires) {
      valueText = `${nowScore.category} (${thenScore.ticked.length} → ${nowScore.ticked.length} deficits)`;
    } else if (nowScore.ticked.length === 0) {
      valueText = 'Fit (0/36)';
    } else {
      valueText = `${nowScore.category} (${nowScore.ticked.length}/36) — stable`;
    }

    const datedNew = newDeficits.filter((d) => d.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const dateText = datedNew.length ? datedNew[datedNew.length - 1].date : null;

    const thenIso = cutoff.toISOString().slice(0, 10);
    const nowIso = now.toISOString().slice(0, 10);
    const seriesPoints = [
      { date: thenIso, value: thenScore.ticked.length },
      { date: nowIso, value: nowScore.ticked.length },
    ];

    return {
      fires,
      valueText,
      dateText,
      now: nowScore,
      then: thenScore,
      newDeficits,
      categoryWorsened,
      codedNow,
      codedThen,
      codedWorsened,
      sameDayCatchUp,
      withinMonths,
      minNewDeficits,
      spanMonths: monthsBetween(cutoff, now),
      series: {
        testName: 'eFI deficits',
        unit: ' deficits',
        points: seriesPoints,
        delta: nowScore.ticked.length - thenScore.ticked.length,
        direction: 'rising',
        minDelta: minNewDeficits,
        spanMonths: monthsBetween(cutoff, now),
        fires,
      },
    };
  }

  const api = {
    EFI_DEFICITS,
    CATEGORY_RANK,
    computeEFI,
    computeFromVisualiserInputs,
    categoryFromScore,
    progressFrailty,
    codedFrailty,
    weightDecline,
    labelMatchesTerm,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Efi = api;
  }
})(typeof window !== 'undefined' ? window : global);
