// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception module: pure-logic core (no chrome APIs, no DOM)
//
// Exported functions:
//   summariseActionChips(chips, hiddenRuleIds) — compact red/amber summary of Sentinel chips
//   evaluateRedFlags(redFlags, answers)        — positives + unanswered for a pathway's red flags
//   buildCaptureText(input)                    — the plain-text capture block for copy-paste
//   pharmacyFirstHint(pathway, ageYears)       — eligibility hint line (age-gated), or null
//   isSensitivePathway(pathway)                — pathway.sensitive === true (strict)
//   safeguardingActionLine(contact)            — the safeguarding escalation sentence
//   crisisLineText(configured)                 — practice crisis route, or the shipped default

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

// ---------------------------------------------------------------------------
// summariseActionChips(chips, hiddenRuleIds)
// Compact summary of the action-needed (red/amber) chips from a Sentinel
// snapshot, for the reception "while they're on the phone" alert.
// hiddenRuleIds — optional { [ruleId]: true } map of chips the practice has
// chosen NOT to surface to reception (reception.config.hiddenChipRules).
// Returns { red, amber, hiddenCount, items: [{ name, statusLabel, colour }] }
// — items red-first then amber, preserving snapshot order within each colour.
// hiddenCount counts action chips suppressed by the config so the practice
// admin view can show that filtering is active (never silently zero).
// ---------------------------------------------------------------------------
function summariseActionChips(chips, hiddenRuleIds) {
  const items = [];
  const hidden = hiddenRuleIds || {};
  let red = 0, amber = 0, hiddenCount = 0;
  for (const chip of (chips || [])) {
    const colour = STATUS_COLOUR[chip.status];
    if (colour !== 'red' && colour !== 'amber') continue;
    if (chip.ruleId && hidden[chip.ruleId] === true) { hiddenCount++; continue; }
    if (colour === 'red') red++; else amber++;
    items.push({
      // G1: non-clinical reception staff should see a friendly label, not a raw
      // QOF code. Prefer human-readable names (indicatorName/drugName/displayName)
      // ahead of opaque codes (indicatorCode/ruleId), which remain as a last resort.
      name:
        chip.indicatorName ||
        chip.drugName ||
        chip.displayName ||
        chip.registerName ||
        chip.ruleName ||
        chip.indicatorCode ||
        chip.ruleId ||
        '',
      statusLabel: STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase(),
      colour
    });
  }
  items.sort((a, b) => (a.colour === b.colour) ? 0 : (a.colour === 'red' ? -1 : 1));
  return { red, amber, hiddenCount, items };
}

// ---------------------------------------------------------------------------
// evaluateRedFlags(redFlags, answers)
// answers: { [flagId]: 'yes' | 'no' | undefined }
// Returns { unanswered: string[], positives: [{ id, ask, escalate, safeguarding? }] }.
// Every flag must be explicitly answered — an undefined answer is NOT a "no".
// `safeguarding: true` is carried through (strict boolean) so the escalation
// banner and the pasted capture text can both mark it — the mechanism behind the
// "safeguarding bypasses all routing" guardrail.
// ---------------------------------------------------------------------------
function evaluateRedFlags(redFlags, answers) {
  const unanswered = [];
  const positives = [];
  for (const rf of (redFlags || [])) {
    const a = answers ? answers[rf.id] : undefined;
    if (a !== 'yes' && a !== 'no') { unanswered.push(rf.id); continue; }
    if (a === 'yes') {
      const entry = { id: rf.id, ask: rf.ask, escalate: rf.escalate };
      if (rf.safeguarding === true) entry.safeguarding = true;
      positives.push(entry);
    }
  }
  return { unanswered, positives };
}

// ---------------------------------------------------------------------------
// Sensitive pathways / safeguarding / crisis line — pure helpers shared by
// reception.js (DOM) and buildCaptureText below. Chrome-free by design.
// ---------------------------------------------------------------------------

// isSensitivePathway(pathway) — strict: only the literal boolean true counts, so
// a malformed pathway can never accidentally read as "not sensitive"… and never
// accidentally read as sensitive either. Validation already enforces the type.
function isSensitivePathway(pathway) {
  return !!pathway && pathway.sensitive === true;
}

// safeguardingActionLine(contact) — the sentence shown on the escalation banner
// and written into the capture text when a safeguarding-flagged red flag is
// positive. `contact` is free practice-configured text (a name / extension);
// when it is blank the wording stays generic rather than dropping the escalation.
function safeguardingActionLine(contact) {
  const who = (contact == null) ? '' : String(contact).trim();
  return 'SAFEGUARDING CONCERN — escalate NOW to the duty clinician AND the practice safeguarding lead' +
    (who ? ` (${who})` : '') +
    '. Do not route or book this contact anywhere else first.';
}

// Shipped default crisis route for sensitive (mental-health) pathways. The
// practice can override it in Options → Reception; the default must never be
// empty, so a blank/absent config falls back to this line.
const DEFAULT_CRISIS_LINE = 'If the patient needs urgent mental-health support now: NHS 111, option 2 (24/7)';

function crisisLineText(configured) {
  const s = (configured == null) ? '' : String(configured).trim();
  return s || DEFAULT_CRISIS_LINE;
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
//     pharmacyFirstHint,// optional hint line (already age-checked), or null
//     safeguardingContact, // optional practice safeguarding-lead free text
//     crisisLine        // optional practice crisis-route text (sensitive pathways)
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
      // Fallback includes the level so the reading clinician knows 999-vs-duty even if
      // the escalations map is missing or the key is unknown — this path is near-unreachable
      // (validation forces escalate ∈ {999,duty}) but must never silently hide the level.
      const esc = (escalations && escalations[p.escalate]) || `ACTION (level ${p.escalate}): Escalate immediately.`;
      lines.push(`*** RED FLAG REPORTED: ${p.ask} — YES`);
      // A safeguarding-flagged positive gets its own loud line ABOVE the routine
      // escalation text: it bypasses all routing and goes to the safeguarding lead
      // as well as the duty clinician.
      // safeguardingActionLine() already opens with "SAFEGUARDING CONCERN — ", so
      // the *** marker prefixes it directly rather than repeating the word.
      if (p.safeguarding) lines.push(`*** ${safeguardingActionLine(m.safeguardingContact)}`);
      lines.push(`*** ACTION: ${esc}`);
    }
    lines.push('');
  }
  // Build the asked/denied summary line. If two flags produce the same short label,
  // append " (#n)" (1-based index within the pathway) to all colliding entries so
  // the line is unambiguous. The loud *** block already names positives in full.
  const rawLabels = (pathway.redFlags || []).map(rf => shortFlagLabel(rf.ask));
  const labelCounts = {};
  for (const lbl of rawLabels) labelCounts[lbl] = (labelCounts[lbl] || 0) + 1;
  const labelSeenIndex = {};
  const disambiguated = rawLabels.map((lbl, idx) => {
    if (labelCounts[lbl] > 1) {
      labelSeenIndex[lbl] = (labelSeenIndex[lbl] || 0) + 1;
      return `${lbl} (#${labelSeenIndex[lbl]})`;
    }
    return lbl;
  });
  const flagSummary = (pathway.redFlags || []).map((rf, idx) => {
    const a = redFlagAnswers ? redFlagAnswers[rf.id] : undefined;
    const short = disambiguated[idx];
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

  // Sensitive pathways close with the practice's crisis route, in the pasted text
  // as well as on screen — the receptionist may have read it out, and the reading
  // clinician needs to see what the caller was told. Falls back to the shipped
  // default when the practice has not configured one, so it is never omitted.
  if (isSensitivePathway(pathway)) {
    lines.push('');
    lines.push(`Crisis route given: ${crisisLineText(m.crisisLine)}`);
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
  pharmacyFirstHint,
  isSensitivePathway,
  safeguardingActionLine,
  crisisLineText,
  DEFAULT_CRISIS_LINE,
  STATUS_COLOUR
};
