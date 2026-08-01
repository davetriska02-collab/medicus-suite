// engine/letter-delta.js — Document Coder: candidate-vs-coded-record delta
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Takes the letter-extraction engine's candidates (engine/letter-extract.js)
// and the patient's coded problem list, and answers, per candidate:
// is this probably already coded, does the letter DISAGREE with the record
// (stage change, laterality, active-vs-resolved), or is it possibly new?
// Pure — no DOM, no network, no writes.
//
// VERDICTS (per candidate):
//   'probable-match'     — a coded problem matches; shown WITH the matched
//                          problem so the human can confirm (never a silent
//                          "nothing to do" — panel P4, the CKD-stage war story)
//   'qualifier-conflict' — same condition family, different stage/laterality
//                          ("CKD 3a coded, letter says 3b") — its own flag
//                          class, louder than a match
//   'status-conflict'    — letter and record disagree on activity (letter says
//                          resolved, record active — or letter active, record
//                          resolved: possible recurrence)
//   'possibly-new'       — no confident match; the nearest miss (if any) is
//                          returned so the coder sees WHY it wasn't matched
//
// FAIL DIRECTION: uncertain → 'possibly-new' with the nearest miss shown.
//   A wrong "possibly-new" risks a duplicate code, which the human-gated flow
//   and the shown nearest-miss defend against; a wrong "probable-match" hides
//   a new diagnosis behind "already coded", which nothing downstream can
//   catch. So matching is HIGH-PRECISION: normalised equality, containment,
//   token-set equality, and a SMALL curated acronym list — no fuzzy scoring.
//
// WIRING HOOK: when live, problems may carry conceptId/parentConceptIds from
//   Medicus's own index; a caller that has hierarchy proof can upgrade a
//   'possibly-new' to 'probable-match' via matchByConcept(). Text matching
//   here is the floor, not the ceiling. Retirement-chain walking stays in
//   shared/snomed-retirement.js and composes at the caller.

(function (global) {
  'use strict';

  // Ubiquitous, unambiguous UK primary-care acronyms only. Deliberately
  // small: an ambiguous expansion here fabricates a match, and the failure is
  // silent. Extend via test-guarded additions, never casually.
  const ACRONYMS = {
    af: 'atrial fibrillation',
    t2dm: 'type 2 diabetes mellitus',
    t1dm: 'type 1 diabetes mellitus',
    htn: 'hypertension',
    ckd: 'chronic kidney disease',
    mi: 'myocardial infarction',
    hf: 'heart failure',
    ccf: 'congestive cardiac failure',
    ihd: 'ischaemic heart disease',
    copd: 'chronic obstructive pulmonary disease',
    pe: 'pulmonary embolism',
    dvt: 'deep vein thrombosis',
    tia: 'transient ischaemic attack',
    aki: 'acute kidney injury',
    uti: 'urinary tract infection',
    gord: 'gastro-oesophageal reflux disease',
    oa: 'osteoarthritis',
    ra: 'rheumatoid arthritis',
    pmr: 'polymyalgia rheumatica',
  };

  const STAGE_RE = /\bstage\s*(5|4|3a|3b|3|2|1)\b|\bckd[- ]?(5|4|3a|3b|3|2|1)\b|\bg(3a|3b|[1-5])\b/i;
  const LATERALITY_RE = /\b(right|left|bilateral)\b/i;
  const INACTIVE_STATUSES = /^(?:inactive|resolved|ended|past|historic|historical)$/i;

  function norm(s) {
    let t = String(s || '')
      .toLowerCase()
      .replace(/^\[(x|d|so|v|m|q)\]\s*/, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // whole-token acronym expansion only — never substring
    t = t
      .split(' ')
      .map((w) => ACRONYMS[w] || w)
      .join(' ');
    return t;
  }

  function tokenSet(s) {
    // Order-insensitive comparison ("diabetes mellitus type 2" vs
    // "type 2 diabetes mellitus" — the GP2GP variant war story).
    return new Set(norm(s).split(' ').filter(Boolean));
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  function stripQualifiers(s) {
    return norm(s).replace(STAGE_RE, ' ').replace(LATERALITY_RE, ' ').replace(/\s+/g, ' ').trim();
  }

  function stageOf(s) {
    const m = String(s || '').match(STAGE_RE);
    return m ? (m[1] || m[2] || m[3] || '').toLowerCase() : null;
  }

  function lateralityOf(s) {
    const m = String(s || '').match(LATERALITY_RE);
    return m ? m[0].toLowerCase() : null;
  }

  // Severity/management qualifiers that may legitimately trail a coded term
  // without changing the disease ("Asthma - mild", "T2DM - insulin treated",
  // "HF with preserved ejection fraction"). Anything OUTSIDE this lexicon is
  // treated as disease-modifying, so "PULMONARY hypertension", "diabetes
  // INSIPIDUS" and "IRON DEFICIENCY anaemia" can never containment-match
  // their shorter cousins — that wrong-match direction hides new diagnoses
  // (red-team probe, 2026-08-01).
  const QUALIFIER_WORDS = new Set([
    'mild',
    'moderate',
    'severe',
    'stable',
    'unstable',
    'poorly',
    'well',
    'controlled',
    'uncontrolled',
    'treated',
    'untreated',
    'managed',
    'insulin',
    'diet',
    'on',
    'with',
    'without',
    'preserved',
    'reduced',
    'ejection',
    'fraction',
    'chronic',
    'recurrent',
    'essential',
    'primary',
  ]);

  // Text-level base match: token-set equality, or subset where every EXTRA
  // token on the longer side is a pure qualifier. Qualifier-stripped first so
  // "ckd stage 3a"/"ckd stage 3b" share a base (the conflict check separates
  // them). No raw string containment — substrings fabricate matches.
  function baseMatches(a, b) {
    const na = stripQualifiers(a);
    const nb = stripQualifiers(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = tokenSet(na);
    const tb = tokenSet(nb);
    if (setsEqual(ta, tb)) return true;
    const subsetWithQualifierExtras = (small, big) => {
      for (const t of small) if (!big.has(t)) return false;
      for (const t of big) if (!small.has(t) && !QUALIFIER_WORDS.has(t)) return false;
      return true;
    };
    return subsetWithQualifierExtras(ta, tb) || subsetWithQualifierExtras(tb, ta);
  }

  function problemActive(problem) {
    const st = problem && problem.status ? String(problem.status) : '';
    return !INACTIVE_STATUSES.test(st.trim());
  }

  // Compare ONE candidate against the full problem list.
  function assessCandidate(candidate, problems) {
    const cText = candidate.sourceSentence || candidate.term || '';
    const cStage = stageOf(cText);
    const cLat = candidate.laterality || lateralityOf(cText);

    let best = null;
    for (const p of problems || []) {
      const pText = p.description || '';
      if (!baseMatches(candidate.term, pText) && !baseMatches(cText, pText)) continue;
      const pStage = stageOf(pText);
      const pLat = lateralityOf(pText);

      // qualifier conflicts outrank a plain match — never hide a stage change
      if (cStage && pStage && cStage !== pStage) {
        return verdict('qualifier-conflict', p, { kind: 'stage', letter: cStage, record: pStage });
      }
      if (cLat && pLat && cLat !== pLat && cLat !== 'bilateral' && pLat !== 'bilateral') {
        return verdict('qualifier-conflict', p, { kind: 'laterality', letter: cLat, record: pLat });
      }

      // status conflicts: letter resolved vs record active, or the reverse
      if (candidate.status === 'resolved' && problemActive(p)) {
        return verdict('status-conflict', p, { kind: 'letter-resolved-record-active' });
      }
      if (candidate.status === 'active' && !problemActive(p)) {
        return verdict('status-conflict', p, { kind: 'letter-active-record-inactive' });
      }

      best = p; // clean match — keep scanning in case a conflict exists elsewhere
    }
    if (best) return verdict('probable-match', best, null);

    // nearest miss: shared-token overlap, reported only (never a match)
    let near = null;
    let nearScore = 0;
    const cTok = tokenSet(candidate.term);
    for (const p of problems || []) {
      const shared = [...tokenSet(p.description || '')].filter((t) => cTok.has(t)).length;
      if (shared > nearScore) {
        nearScore = shared;
        near = p;
      }
    }
    return {
      verdict: 'possibly-new',
      matchedProblem: null,
      conflict: null,
      nearestMiss: nearScore >= 2 ? near : null,
    };

    function verdict(v, p, conflict) {
      return { verdict: v, matchedProblem: p, conflict, nearestMiss: null };
    }
  }

  // Main entry: annotate every candidate. Nothing here can express
  // "letter fully reconciled" — the caller renders per-candidate verdicts
  // plus the extraction coverage, never a summary all-clear.
  function computeDelta(candidates, problems) {
    return (candidates || []).map((c) => ({ candidate: c, ...assessCandidate(c, problems) }));
  }

  const api = { computeDelta, assessCandidate, baseMatches, stageOf, lateralityOf, norm, ACRONYMS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SuiteLetterDelta = api;
  }
})(typeof window !== 'undefined' ? window : global);
