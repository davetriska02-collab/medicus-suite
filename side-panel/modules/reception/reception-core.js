// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception module: pure-logic core (no chrome APIs, no DOM)
//
// Exported functions:
//   summariseActionChips(chips)            — compact red/amber summary of Sentinel chips
//   evaluateRedFlags(redFlags, answers)    — positives + unanswered for a pathway's red flags
//   buildCaptureText(input)                — the plain-text capture block for copy-paste
//   extractPatientAppointments(raw, uuid)  — match one day's appointment-book to a patient
//   pharmacyFirstHint(pathway, ageYears)   — eligibility hint line (age-gated), or null

'use strict';

// Colour map (mirrors chip-renderer.js STATUS_COLOUR exactly)
// keep in sync with shared/chip-renderer.js STATUS_COLOUR
const STATUS_COLOUR = {
  overdue: 'red', not_met: 'red', alert: 'red',
  stale: 'amber', due_soon: 'amber', caution: 'amber',
  no_data: 'neutral', recently_initiated: 'neutral', noted: 'neutral',
  achieved: 'green', in_date: 'green',
  vax_due: 'amber', vax_given: 'green', vax_declined: 'neutral'
};

const STATUS_LABEL = {
  overdue: 'OVERDUE', not_met: 'NOT MET', alert: 'ALERT', stale: 'SEVERELY OVERDUE',
  due_soon: 'DUE SOON', caution: 'CAUTION', vax_due: 'VACCINE DUE'
};

// UUID shape used by Medicus APIs.
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// ---------------------------------------------------------------------------
// summariseActionChips(chips)
// Compact summary of the action-needed (red/amber) chips from a Sentinel
// snapshot, for the reception "while they're on the phone" card.
// Returns { red, amber, items: [{ name, statusLabel, colour }] } — items
// red-first then amber, preserving snapshot order within each colour.
// ---------------------------------------------------------------------------
function summariseActionChips(chips) {
  const items = [];
  let red = 0, amber = 0;
  for (const chip of (chips || [])) {
    const colour = STATUS_COLOUR[chip.status];
    if (colour !== 'red' && colour !== 'amber') continue;
    if (colour === 'red') red++; else amber++;
    items.push({
      name: chip.drugName || chip.indicatorCode || chip.displayName || chip.registerName || chip.ruleName || chip.ruleId || '',
      statusLabel: STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase(),
      colour
    });
  }
  items.sort((a, b) => (a.colour === b.colour) ? 0 : (a.colour === 'red' ? -1 : 1));
  return { red, amber, items };
}

// ---------------------------------------------------------------------------
// evaluateRedFlags(redFlags, answers)
// answers: { [flagId]: 'yes' | 'no' | undefined }
// Returns { unanswered: string[], positives: [{ id, ask, escalate }] }.
// Every flag must be explicitly answered — an undefined answer is NOT a "no".
// ---------------------------------------------------------------------------
function evaluateRedFlags(redFlags, answers) {
  const unanswered = [];
  const positives = [];
  for (const rf of (redFlags || [])) {
    const a = answers ? answers[rf.id] : undefined;
    if (a !== 'yes' && a !== 'no') { unanswered.push(rf.id); continue; }
    if (a === 'yes') positives.push({ id: rf.id, ask: rf.ask, escalate: rf.escalate });
  }
  return { unanswered, positives };
}

// ---------------------------------------------------------------------------
// buildCaptureText(input)
//
// input = {
//   pathway,            // pathway object from reception-pathways.json
//   closingQuestions,   // shared closing questions array
//   escalations,        // { '999': text, 'duty': text }
//   ownWords,           // string — patient's own words
//   redFlagAnswers,     // { [flagId]: 'yes'|'no' }
//   questionAnswers,    // { [questionId]: string | string[] }   (multi → array)
//   closingAnswers,     // { [questionId]: string | string[] }
//   meta: {
//     takerInitials,    // string ('' allowed)
//     nowIso,           // ISO datetime string for the header
//     suiteVersion,     // manifest version string
//     patientLine,      // optional "Name, DOB ..." line from the OPEN record
//     pharmacyFirstHint // optional hint line (already age-checked), or null
//   }
// }
//
// Returns a plain-text block. Deliberately ASCII-safe apart from the warning
// glyph: it is pasted into Medicus free-text fields.
// Unanswered questions render as "not recorded" so the reading clinician can
// distinguish "asked and denied" from "not asked".
// ---------------------------------------------------------------------------
function buildCaptureText(input) {
  const { pathway, closingQuestions, escalations, ownWords,
          redFlagAnswers, questionAnswers, closingAnswers, meta } = input;
  const lines = [];
  const m = meta || {};

  const when = formatWhen(m.nowIso);
  lines.push(`=== RECEPTION CAPTURE: ${pathway.title} ===`);
  lines.push(`Taken by ${m.takerInitials ? m.takerInitials + ' ' : ''}(reception) ${when}` +
             (m.suiteVersion ? ` · Medicus Suite v${m.suiteVersion}, pathway set v${pathway.pathwayVersion || '1'}` : ''));
  if (m.patientLine) lines.push(`Patient (from open record): ${m.patientLine}`);
  lines.push('');

  // Red flags — positives first and loud, then the full asked/denied record.
  const { positives } = evaluateRedFlags(pathway.redFlags, redFlagAnswers);
  if (positives.length > 0) {
    for (const p of positives) {
      const esc = (escalations && escalations[p.escalate]) || 'Escalate to the duty clinician now.';
      lines.push(`*** RED FLAG REPORTED: ${p.ask} — YES`);
      lines.push(`*** ACTION: ${esc}`);
    }
    lines.push('');
  }
  const flagSummary = (pathway.redFlags || []).map(rf => {
    const a = redFlagAnswers ? redFlagAnswers[rf.id] : undefined;
    const short = shortFlagLabel(rf.ask);
    return `${short}: ${a === 'yes' ? 'YES' : a === 'no' ? 'no' : 'NOT ASKED'}`;
  });
  if (flagSummary.length > 0) {
    lines.push(`Red flags asked — ${flagSummary.join('; ')}`);
    lines.push('');
  }

  lines.push(`In their own words: ${ownWords ? `"${ownWords}"` : 'not recorded'}`);

  for (const q of (pathway.questions || [])) {
    lines.push(`${q.label || q.ask}: ${renderAnswer(questionAnswers ? questionAnswers[q.id] : undefined)}`);
  }
  lines.push('');
  for (const q of (closingQuestions || [])) {
    lines.push(`${q.label || q.ask}: ${renderAnswer(closingAnswers ? closingAnswers[q.id] : undefined)}`);
  }

  if (m.pharmacyFirstHint) {
    lines.push('');
    lines.push(`Pharmacy First: ${m.pharmacyFirstHint}`);
  }

  lines.push('');
  lines.push('NOTE: structured capture by reception staff using a fixed question set — not a clinical assessment. Clinician to review.');
  return lines.join('\n');
}

function renderAnswer(a) {
  if (Array.isArray(a)) return a.length ? a.join(', ') : 'not recorded';
  const s = (a == null) ? '' : String(a).trim();
  return s ? s : 'not recorded';
}

// Compress a red-flag question into a short label for the asked/denied line.
// First clause up to the first '?', ',', '—' or '(' — enough to identify the flag.
function shortFlagLabel(ask) {
  const s = String(ask || '');
  const cut = s.search(/[?,(—]/);
  const head = (cut > 0 ? s.slice(0, cut) : s).trim();
  return head.length > 60 ? head.slice(0, 57) + '...' : head;
}

function formatWhen(nowIso) {
  if (!nowIso) return '';
  const d = new Date(nowIso);
  if (isNaN(d.getTime())) return String(nowIso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// extractPatientAppointments(raw, patientUuid)
//
// raw: one day's /scheduling/data/appointment-book/embedded-overview response
//      ({ staffSchedules: [{ name, schedule: [{ entries: [...] }] }] }).
// Matches strictly by patient UUID (never by name — wrong-patient hazard H-001):
// tries entry.patient.{id,uuid,patientId,patientUuid}, then any UUID-shaped
// string on entry.patient. Returns [{ clinician, startDateTime, type, status }].
// ---------------------------------------------------------------------------
function extractPatientAppointments(raw, patientUuid) {
  if (!patientUuid) return [];
  const want = String(patientUuid).toLowerCase();
  const out = [];
  for (const staff of (raw?.staffSchedules || [])) {
    for (const session of (staff?.schedule || [])) {
      for (const entry of (session?.entries || [])) {
        if (entry?.diaryEntryType?.value !== 'appointment') continue;
        if (entryPatientUuid(entry) !== want) continue;
        out.push({
          clinician: staff?.name || 'Unknown clinician',
          startDateTime: entry.startDateTime || null,
          type: entry.appointmentType?.name || '',
          status: entry.displayStatus?.value || ''
        });
      }
    }
  }
  return out;
}

function entryPatientUuid(entry) {
  const p = entry?.patient;
  if (!p || typeof p !== 'object') return null;
  for (const field of ['id', 'uuid', 'patientId', 'patientUuid']) {
    const v = p[field];
    if (typeof v === 'string') {
      const m = v.match(UUID_RE);
      if (m) return m[1].toLowerCase();
    }
  }
  for (const val of Object.values(p)) {
    if (typeof val === 'string') {
      const m = val.match(UUID_RE);
      if (m) return m[1].toLowerCase();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// pharmacyFirstHint(pathway, ageYears)
// Returns the pathway's Pharmacy First note when the patient's age (from the
// open record) is inside the pathway's age band, null otherwise. With no known
// age, returns the note suffixed with an age caveat — the hint must fail
// towards "clinician to confirm", never silently assert eligibility.
// ---------------------------------------------------------------------------
function pharmacyFirstHint(pathway, ageYears) {
  const pf = pathway && pathway.pharmacyFirst;
  if (!pf) return null;
  if (ageYears == null || !Number.isFinite(ageYears)) {
    return `${pf.note} (Patient age unknown — check age criteria.)`;
  }
  if (pf.ageMin != null && ageYears < pf.ageMin) return null;
  if (pf.ageMax != null && ageYears > pf.ageMax) return null;
  return pf.note;
}

export {
  summariseActionChips,
  evaluateRedFlags,
  buildCaptureText,
  extractPatientAppointments,
  pharmacyFirstHint,
  STATUS_COLOUR
};
