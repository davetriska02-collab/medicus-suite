// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — SMR (Structured Medication Review) prep pack core (pure ES
// module, no chrome/DOM).
//
// buildSmrPack(model, chips, letterhead, nowISO) → SmrPackObject
//
// FORK of sentinel/passport-core.js, not an extension of it. Passport is
// patient-facing (reading age 9-11, plain English, hand-out at the end of a
// consultation). This pack is the opposite audience: a dense, clinician-facing
// prep sheet a pharmacist/GP reads BEFORE an SMR appointment, composed from the
// same in-memory model record.js already builds (see record.js buildRecordSummaryText,
// which this mirrors for provenance/gap-marker/safety-score conventions).
//
// CLINICAL-SAFETY FRAMING (non-negotiable — mirrors record.js header) ─────────
// This pack is a CODED LIVE SNAPSHOT, not the complete record. It cannot show
// allergies, immunisations or free-text consultation history (no live
// endpoint) — those render as explicit gap markers, never as silent absence.
// Every section that can be empty renders an explicit "none recorded in live
// view" line so absence is never mistaken for "reviewed and clear". ACB and
// STOPP/START are prompts to review, not prescribing decisions.
//
// buildSmrPack is pure and side-effect free: it does not touch chrome.storage,
// does not fetch, and does not format HTML (smr-pack.js does the HTML
// rendering + escaping from the object this returns, same division of labour
// as passport-core.js / passport.js).
//
// Parameters:
//   model      — normaliseAll() output (same shape record.js holds as
//                _lastModel): { patientContext, problems, pastProblems,
//                medications, observations, apiErrors? }
//   chips      — live chip array from getSentinelSnapshot.chips, or null when
//                unavailable (mirrors record.js's `chips` param throughout)
//   letterhead — { practiceName, clinicianName } from 'suite.letterhead', or
//                null/undefined when unset
//   nowISO     — ISO timestamp string for "generated at" (caller passes a
//                fixed value so a test's expectations match; falls back to
//                the real clock when omitted)

'use strict';

// ── Verbatim clinical-safety caveat — top AND bottom of the pack ────────────
// A second "SMR prep pack" click overwrites the one-key store. The print
// tab must refuse a payload whose packId does not match its own URL, or it
// can render the WRONG patient (fail closed → empty state).
export function smrPackMatchesRequest(stored, packIdFromUrl) {
  if (!stored || !stored.patient) return false;
  if (!packIdFromUrl || !stored.packId) return false;
  return stored.packId === packIdFromUrl;
}

export const SMR_CAVEAT =
  'Coded live snapshot, not the complete record. Excludes allergies, immunisations and free-text history. ' +
  'Verify against the patient record before any prescribing decision.';

// ── Mandatory gap block — verbatim wording family from record.js:405-410 ────
// Always present, always exactly these three entries. Never conditional on
// whether anything else is missing — the gap block documents what this LIVE
// VIEW structurally cannot show, independent of what data happens to be present.
const GAP_BLOCK = [
  {
    label: 'Allergies & adverse reactions',
    note: 'Not shown in this pack — verify in Medicus before prescribing',
  },
  {
    label: 'Immunisations',
    note: 'Not shown in this pack — verify in Medicus',
  },
  {
    label: 'Consultation history',
    note: 'Not shown in this pack — use the full visualiser for the timeline',
  },
];

// ── Status vocabulary → human label ──────────────────────────────────────────
// Local copy (rules-engine.js's STATUS_PHRASE is not exported) covering every
// key in sentinel-core.js's STATUS_RANK, so no live status ever falls through
// to a raw/undefined label.
const STATUS_PHRASE = {
  overdue: 'Overdue',
  not_met: 'Not met',
  alert: 'Alert',
  stale: 'Severely overdue',
  due_soon: 'Due soon',
  caution: 'Caution',
  no_data: 'No data',
  noted: 'Noted',
  recently_initiated: 'Recently initiated',
  achieved: 'Achieved',
  in_date: 'In date',
  vax_given: 'Given',
  vax_declined: 'Declined',
  vax_due: 'Due',
};

function statusLabel(status) {
  return STATUS_PHRASE[status] || (status ? String(status) : 'Unknown');
}

// ── Letterhead resolution ────────────────────────────────────────────────────
// Mirrors action-packs.js resolveLetterhead's placeholder convention (letter
// variants — this pack is a printed clinical document, not an SMS) without
// importing that module (kept dependency-free per passport-core.js precedent).
function resolveLetterhead(letterhead) {
  const lh = letterhead || {};
  const practice = typeof lh.practiceName === 'string' ? lh.practiceName.trim() : '';
  const clinician = typeof lh.clinicianName === 'string' ? lh.clinicianName.trim() : '';
  return {
    practiceName: practice || '[Practice name]',
    clinicianName: clinician || '[Clinician name]',
  };
}

// ── eGFR extraction (mirrors record.js's _latestEgfrPlain) ──────────────────
function latestEgfr(obs) {
  const e = (obs || []).find((o) => /e?gfr/i.test(o.name || ''));
  if (!e) return null;
  const n = parseFloat(String(e.rawValue));
  return Number.isFinite(n) ? n : null;
}

// ── Monitoring test due-text (mirrors rules-engine.js's dueBit logic) ───────
function testDueText(t) {
  if (t.days == null || t.intervalDays == null) return null;
  if (t.status === 'overdue' || t.status === 'stale') return `due ${t.days - t.intervalDays}d ago`;
  if (t.status === 'due_soon') return `due in ${t.intervalDays - t.days}d`;
  return `${t.days}d since last`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildSmrPack(model, chips, letterhead, nowISO) → SmrPackObject
 *
 * Returns a plain data object (no HTML) — smr-pack.js renders + escapes it.
 * Never returns null: an SMR prep pack with an absent/empty model still
 * renders every section with its explicit "none recorded" honesty line,
 * because absence must never read as "reviewed and clear".
 */
export function buildSmrPack(model, chips, letterhead, nowISO) {
  const m = model || {};
  const pc = m.patientContext || {};
  const problems = Array.isArray(m.problems) ? m.problems : [];
  const past = Array.isArray(m.pastProblems) ? m.pastProblems : [];
  const meds = Array.isArray(m.medications) ? m.medications : [];
  const obs = Array.isArray(m.observations) ? m.observations : [];
  const chipsAvailable = Array.isArray(chips);
  const chipList = chipsAvailable ? chips : [];

  const generatedAt = typeof nowISO === 'string' && nowISO ? nowISO : new Date().toISOString();

  // ── Header / patient ───────────────────────────────────────────────────────
  const patient = {
    name: pc.patientName || 'Unknown patient',
    ageYears: pc.ageYears != null ? pc.ageYears : null,
    sex: pc.sex || null,
    dob: pc.dob || null,
    nhsNumber: pc.nhsNumber || null,
    namedGP: pc.namedGP || null,
    isDeceased: !!pc.isDeceased,
    testPatient: !!pc.testPatient,
  };

  const practice = resolveLetterhead(letterhead);

  // ── Active problems ─────────────────────────────────────────────────────────
  const activeProblems = problems.map((p) => ({
    label: p && p.label ? p.label : 'Unnamed problem',
    codedDate: (p && p.codedDate) || null,
    major: !!(p && p.significance && /major/i.test(p.significance)),
  }));
  const problemsSection = {
    active: activeProblems,
    count: activeProblems.length,
    pastCount: past.length,
    emptyNote: activeProblems.length === 0 ? 'No active problems recorded in live view.' : null,
  };

  // ── Current medications ─────────────────────────────────────────────────────
  const medItems = meds.map((mVal) => ({
    name: mVal && mVal.name ? mVal.name : 'Unnamed medication',
    dosage: (mVal && mVal.dosage) || null,
    overdue: !!(mVal && mVal.isOverDue),
    reviewOverdue: !!(mVal && mVal.isReviewOverDue),
  }));
  const medicationsSection = {
    items: medItems,
    count: medItems.length,
    emptyNote: medItems.length === 0 ? 'No current medications recorded in live view.' : null,
  };

  // ── Monitoring status per drug-monitoring chip ──────────────────────────────
  const monitoringChips = chipList.filter((c) => c && c.type === 'drug-monitoring');
  const monitoringItems = monitoringChips.map((c) => ({
    drugName: c.drugName || 'Unnamed medication',
    ruleId: c.ruleId || null,
    status: c.status || null,
    statusLabel: statusLabel(c.status),
    sharedCare: !!c.sharedCare,
    tests: Array.isArray(c.tests)
      ? c.tests.map((t) => ({
          name: (t && (t.name || t.testName)) || 'Unnamed test',
          status: (t && t.status) || null,
          statusLabel: statusLabel(t && t.status),
          days: t && t.days != null ? t.days : null,
          intervalDays: t && t.intervalDays != null ? t.intervalDays : null,
          dueText: t ? testDueText(t) : null,
        }))
      : [],
  }));
  const monitoringSection = {
    available: chipsAvailable,
    items: monitoringItems,
    count: monitoringItems.length,
    emptyNote: !chipsAvailable
      ? 'Live monitoring chips unavailable in this snapshot — check the Monitoring tab.'
      : monitoringItems.length === 0
        ? 'No drug-monitoring chips recorded for this patient in live view.'
        : null,
  };

  // ── Prescribing safety prompts — ACB + STOPP/START ─────────────────────────
  // Framed throughout as prompts to review, never as decisions. Uses the same
  // window-global engines record.js's safetyCard()/buildRecordSummaryText() use;
  // deliberately absent in a non-browser (test/Node) environment, in which case
  // the section renders its explicit unavailable note rather than a blank.
  const drugObjs = meds.map((mVal) => ({ label: mVal && mVal.name }));
  const probObjs = problems.map((p) => ({ name: p && p.label }));

  let acbResult = null;
  try {
    acbResult = typeof window !== 'undefined' && window.ACBScores ? window.ACBScores.computeACB(drugObjs) : null;
  } catch (_) {
    acbResult = null;
  }
  const acb = acbResult
    ? {
        available: true,
        total: acbResult.total,
        alert: !!acbResult.alert,
        perDrug: Array.isArray(acbResult.perDrug)
          ? acbResult.perDrug.map((d) => ({ name: d.name, score: d.score }))
          : [],
        note: acbResult.total > 0 ? null : 'None of the current medications score on the anticholinergic burden scale.',
      }
    : {
        available: false,
        total: 0,
        alert: false,
        perDrug: [],
        note: 'Anticholinergic burden engine unavailable in this view — open the Record tab to compute it.',
      };

  let ssResult = null;
  try {
    ssResult =
      typeof window !== 'undefined' && window.StoppStart
        ? window.StoppStart.computeStoppStart({
            drugs: drugObjs,
            problems: probObjs,
            ageYears: pc.ageYears != null ? Number(pc.ageYears) : null,
            egfr: latestEgfr(obs),
          })
        : null;
  } catch (_) {
    ssResult = null;
  }
  const stoppStart = Array.isArray(ssResult)
    ? {
        available: true,
        count: ssResult.length,
        flags: ssResult.map((f) => ({
          kind: f.kind === 'start' ? 'start' : 'stopp',
          criterion: f.criterion || '',
          detail: f.detail || '',
          severity: f.severity || null,
        })),
        note: ssResult.length === 0 ? 'No deterministic STOPP/START prompts on the coded data available.' : null,
      }
    : {
        available: false,
        count: 0,
        flags: [],
        note: 'STOPP/START engine unavailable in this view — open the Record tab to compute it.',
      };

  const safety = { acb, stoppStart };

  // ── QOF gaps ─────────────────────────────────────────────────────────────────
  // All QOF-type chips (indicator + process-indicator + register), not just
  // outstanding ones — showing only gaps would let "nothing shown" be misread
  // as "nothing checked" instead of "checked, all met".
  const qofChips = chipList.filter(
    (c) => c && (c.type === 'qof-indicator' || c.type === 'qof-process-indicator' || c.type === 'qof-register')
  );
  const qofItems = qofChips.map((c) => {
    const isRegister = c.type === 'qof-register';
    return {
      code: c.indicatorCode || c.registerCode || null,
      name: c.indicatorName || c.registerName || null,
      status: c.status || null,
      statusLabel: isRegister ? 'On register' : statusLabel(c.status),
      kind: isRegister ? 'register' : 'indicator',
    };
  });
  const qofSection = {
    available: chipsAvailable,
    items: qofItems,
    checkedCount: qofItems.length,
    emptyNote: !chipsAvailable
      ? 'Live QOF chips unavailable in this snapshot — check the Monitoring tab.'
      : qofItems.length === 0
        ? 'No QOF indicator or register chips recorded for this patient in live view.'
        : null,
  };

  // ── Latest observations ─────────────────────────────────────────────────────
  const namedObs = obs.filter((o) => o && o.name && o.rawValue != null && o.rawValue !== '');
  const obsItems = namedObs.slice(0, 14).map((o) => ({
    name: o.name,
    value: o.value != null ? o.value : '',
    date: o.date || null,
    flag: o.isAbove ? 'high' : o.isBelow ? 'low' : null,
  }));
  const observationsSection = {
    items: obsItems,
    count: namedObs.length,
    emptyNote: obsItems.length === 0 ? 'No recent results recorded in live view.' : null,
  };

  return {
    generatedAt,
    practice,
    patient,
    gaps: GAP_BLOCK,
    problems: problemsSection,
    medications: medicationsSection,
    monitoring: monitoringSection,
    safety,
    qof: qofSection,
    observations: observationsSection,
    caveat: SMR_CAVEAT,
  };
}
