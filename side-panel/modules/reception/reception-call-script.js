// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Reception call-script layout — CSO-signed 2026-08-22 (Dave, chat).
//
// The bundled pathway JSON still holds every red-flag id and every history
// question. This module decides what a *call* shows: two same-tier amalgam
// lists, a short main-path history set, wants + contact. Everything else
// sits under "More for the clinician". Custom / edited pathways that are
// not in CALL_MAIN_QUESTION_IDS keep every history question on the main
// path (nothing is silently dropped).
//
// Chrome-free. evaluateRedFlags is imported from reception-core.js.

import { evaluateRedFlags } from './reception-core.js';

// History question ids on the default call path, in display order.
// `duration` is rendered on the shared how-long row, not here.
export const CALL_MAIN_QUESTION_IDS = {
  'sore-throat': ['fever', 'eatdrink'],
  earache: ['which', 'discharge', 'fever'],
  cough: ['exertion', 'lungdx'],
  urinary: ['symptoms', 'abxallergy'],
  headache: ['previous'],
  backpain: ['sciatica'],
  sinusitis: ['nasal', 'fever'],
  'feverish-child': ['temp', 'drinking', 'behaviour'],
  rash: ['where', 'spreading', 'fever'],
  general: ['worst', 'impact'],
  'gu-male': ['area', 'dysuria', 'luts'],
  'gyn-female': ['bleeding', 'pain', 'discharge'],
  'mental-health': ['who-with', 'known-team'],
};

export const CALL_MAIN_CLOSING_IDS = ['wants', 'contact'];
export const CALL_SENSITIVE_CLOSING_IDS = ['contact'];
export const CALL_DURATION_ID = 'duration';
export const CALL_COURSE_ID = 'course';

export function splitRedFlags(redFlags) {
  const emergency = [];
  const duty = [];
  for (const rf of redFlags || []) {
    if (rf.escalate === '999') emergency.push(rf);
    else if (rf.escalate === 'duty') duty.push(rf);
  }
  return { emergency, duty };
}

export function mainQuestionIds(pathway) {
  if (!pathway || !pathway.id) return [];
  const listed = CALL_MAIN_QUESTION_IDS[pathway.id];
  if (listed) return listed.slice();
  return (pathway.questions || []).map((q) => q.id).filter((id) => id !== CALL_DURATION_ID);
}

export function questionsInOrder(pathway, ids) {
  const byId = new Map((pathway.questions || []).map((q) => [q.id, q]));
  return (ids || []).map((id) => byId.get(id)).filter(Boolean);
}

export function mainQuestions(pathway) {
  return questionsInOrder(pathway, mainQuestionIds(pathway));
}

export function moreQuestions(pathway) {
  const onMain = new Set(mainQuestionIds(pathway));
  onMain.add(CALL_DURATION_ID);
  return (pathway.questions || []).filter((q) => !onMain.has(q.id));
}

export function mainClosingIds(pathway) {
  if (pathway && (pathway.sensitive === true || pathway.id === 'mental-health')) {
    return CALL_SENSITIVE_CLOSING_IDS.slice();
  }
  return CALL_MAIN_CLOSING_IDS.slice();
}

export function closingInOrder(closingQuestions, ids) {
  const byId = new Map((closingQuestions || []).map((q) => [q.id, q]));
  return (ids || []).map((id) => byId.get(id)).filter(Boolean);
}

export function moreClosingQuestions(pathway, closingQuestions) {
  const onMain = new Set(mainClosingIds(pathway));
  onMain.add(CALL_COURSE_ID);
  return (closingQuestions || []).filter((q) => !onMain.has(q.id));
}

export function showDurationRow(pathway) {
  return !pathway || pathway.id !== 'mental-health';
}

export function ownWordsLabel(pathway) {
  if (pathway && (pathway.id === 'mental-health' || pathway.sensitive === true)) {
    return "What's happening today? (Their own words — do not interpret.)";
  }
  return "In their words, what's the problem?";
}

// A completed 999 amalgam (any emergency yes) may leave later flags unasked.
// Empty amalgam (no ticks, no None) is unanswered — fail closed.
export function generateAllowed(redFlags, answers) {
  const { unanswered, positives } = evaluateRedFlags(redFlags, answers);
  const stop999 = positives.some((p) => p.escalate === '999');
  if (stop999) return { ok: true, stop999: true, unanswered, positives };
  if (unanswered.length > 0) return { ok: false, stop999: false, unanswered, positives };
  return { ok: true, stop999: false, unanswered, positives };
}

// Apply one amalgam list to the answers map.
// noneChecked → every id in the tier is 'no'.
// any item checked → checked ids 'yes', the rest of the tier 'no'.
// otherwise the tier stays unanswered.
export function applyAmalgamAnswers(answers, tierFlags, { noneChecked, checkedIds }) {
  if (!tierFlags || tierFlags.length === 0) return answers;
  const checked = new Set(checkedIds || []);
  if (noneChecked) {
    for (const rf of tierFlags) answers[rf.id] = 'no';
    return answers;
  }
  if (checked.size > 0) {
    for (const rf of tierFlags) answers[rf.id] = checked.has(rf.id) ? 'yes' : 'no';
    return answers;
  }
  return answers;
}
