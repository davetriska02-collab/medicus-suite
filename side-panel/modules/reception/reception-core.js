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
//   evaluateDisposition(pathway, ctx)          — suggest/withhold a destination (plan E)
//   dispositionCaptureLines(record)            — the disposition lines for the pasted text
//   isValidRoutingAttestation(a)               — CSO/partner custom-routing sign-off check

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
//     crisisLine,       // optional practice crisis-route text (sensitive pathways)
//     disposition,      // optional evaluateDisposition() result + the receptionist's
//                       //   decision — see dispositionCaptureLines() below
//     bookedLines       // optional string[] — "Booked: <type> — <when> — reason: <r>"
//                       //   lines for appointments booked from the booking card
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

  // Disposition routing (plan E). Suggested-and-decided routes AND withheld
  // ones are both recorded; status 'none' writes nothing at all (sensitive
  // pathways have a deliberate no-output posture).
  const dispLines = dispositionCaptureLines(m.disposition);
  if (dispLines.length > 0) {
    lines.push('');
    for (const l of dispLines) lines.push(l);
  }

  // Appointments booked from the reception booking card during this capture
  // (plan D3). Pre-formatted by bookedCaptureLine() in
  // side-panel/modules/shared/booking-panel-core.js and passed through verbatim:
  // the pure core stays free of booking-panel knowledge, and the clinician
  // reading this block sees the type, slot and reason reception actually booked.
  const bookedLines = Array.isArray(m.bookedLines)
    ? m.bookedLines.filter(l => typeof l === 'string' && l.trim() !== '')
    : [];
  if (bookedLines.length > 0) {
    lines.push('');
    for (const l of bookedLines) lines.push(l);
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
  const status = pharmacyFirstAgeStatus(pathway, ageYears);
  if (status === 'unknown-age') return `${pf.note} (Patient age unknown — check age criteria.)`;
  if (status === 'out-of-band') return null;
  return pf.note;
}

// pharmacyFirstAgeStatus(pathway, ageYears)
//   'no-block'    — the pathway is not a Pharmacy First condition at all
//   'unknown-age' — PF condition, but no usable age: eligibility CANNOT be asserted
//   'out-of-band' — PF condition, age known, outside the ageMin/ageMax band
//   'eligible'    — PF condition, age known, inside the band
// The single age gate shared by the hint line (above) and the disposition engine
// (below), so "Pharmacy First" can never mean one thing in the hint and another
// in the routing suggestion.
function pharmacyFirstAgeStatus(pathway, ageYears) {
  const pf = pathway && pathway.pharmacyFirst;
  if (!pf) return 'no-block';
  if (ageYears == null || !Number.isFinite(ageYears)) return 'unknown-age';
  if (pf.ageMin != null && ageYears < pf.ageMin) return 'out-of-band';
  if (pf.ageMax != null && ageYears > pf.ageMax) return 'out-of-band';
  return 'eligible';
}

// ---------------------------------------------------------------------------
// Disposition routing (plan section E)
//
// The engine SUGGESTS, a human DECIDES, and every suggestion carries the
// offer-a-clinician fallback line. Nothing here books, sends or automates
// anything: evaluateDisposition returns a plain object that the panel renders
// and the receptionist accepts or overrides.
//
// The guardrails below are FROZEN IN CODE and applied AFTER override
// resolution, keyed on the BUNDLED pathway id — a practice fork that relabels
// its domain cannot walk past them (plan E, corrected guardrail design).
// ---------------------------------------------------------------------------

// Kept in lock-step with shared/reception-pathway-utils.js (a classic script
// that cannot be imported from this ES module). test-reception-disposition.js
// asserts the two copies are identical.
const CLINICIAN_ONLY_IDS = Object.freeze(['mental-health', 'gu-male', 'gyn-female', 'general']);
const CLINICIAN_ONLY_DOMAINS = Object.freeze(['mental_health', 'gu_male', 'gyn_female']);

// The single sentence every rendered suggestion carries — on screen AND in the
// pasted capture text (plan E guardrail 7). Constant, never practice-editable.
const DISPOSITION_FALLBACK_LINE = 'Or a clinician callback if the patient prefers — always offer it.';

// Human labels for the pasted text and the panel. 'duty' is reachable as a
// pathway `default`, not as an `allowed` destination.
const DESTINATION_LABELS = Object.freeze({
  pharmacy_first: 'Pharmacy First',
  anp: 'ANP / minor-illness nurse',
  paramedic: 'Paramedic practitioner',
  gp_routine: 'GP appointment',
  duty: 'Duty clinician',
});

function destinationLabel(dest) {
  return DESTINATION_LABELS[dest] || String(dest || '');
}

// Destinations no patient under 5 may be routed to by this tool. There is no
// "declared paediatric competence" flag in the pathway schema yet, so these are
// stripped for EVERY pathway with a confirmed age under 5 — the plan allows a
// pathway to declare paediatric competence, but until that field exists the
// conservative reading is the only safe one. Adding such a field is a
// clinical-safety change (CSO review), not a schema tidy-up.
const NO_UNDER_FIVE = Object.freeze(['anp', 'paramedic']);

// isValidRoutingAttestation(a) — the CSO/partner sign-off that unlocks routing
// on custom / practice-edited pathways.
//   { attestedBy: string, role: 'cso'|'partner', attestedAt: ISO, scope: 'custom-routing' }
// KEEP IN SYNC with shared/reception-pathway-utils.js.
const _ATTEST_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function isValidRoutingAttestation(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  if (typeof a.attestedBy !== 'string' || a.attestedBy.trim().length === 0) return false;
  if (a.role !== 'cso' && a.role !== 'partner') return false;
  if (typeof a.attestedAt !== 'string' || !_ATTEST_ISO_RE.test(a.attestedAt)) return false;
  if (a.scope !== 'custom-routing') return false;
  return true;
}

// ---------------------------------------------------------------------------
// evaluateDisposition(pathway, ctx) → { status, destination?, reason, basis, fallbackLine }
//
// ctx = {
//   redFlagPositives,    // [{ id, ask, escalate, safeguarding? }] from evaluateRedFlags
//   redFlagUnanswered,   // [flagId] from evaluateRedFlags
//   confirmedAge,        // number of years the RECEPTIONIST confirmed on the call.
//                        //   NEVER the ageYears of the open record — a wrong record
//                        //   open would turn a three-year-old into an adult.
//   bundledId,           // the BUNDLED pathway id this pathway came from, or null
//                        //   for a practice-authored one. The frozen sets are keyed
//                        //   on this, so a fork cannot relabel its way out.
//   origin,              // 'bundled' | 'edited' | 'custom' (optional; inferred when absent)
//   routingAttestation,  // reception.routingAttestation, or null
// }
//
// status:
//   'none'     — render nothing, record nothing (sensitive / mental-health, or the
//                pathway simply has no disposition block)
//   'withheld' — render nothing on the form, but RECORD the reason in the capture
//                text so an SEA can reconstruct what the tool did not say
//   'suggest'  — render the card; `destination` is the suggestion
//
// ORDER OF APPLICATION — each earlier rule wins outright:
//   a1. sensitive pathway, or mental-health (bundled or effective id) → 'none'
//   a2. any other clinician-only frozen id / clinician-only domain    → withheld
//   a3. custom or practice-edited pathway with no valid CSO/partner
//       routing attestation                                          → withheld
//   b1. any POSITIVE red flag                                        → withheld
//   b2. any UNANSWERED red flag                                      → withheld
//   c.  no disposition block                                         → 'none'
//   d.  confirmed age unknown/invalid → suggest gp_routine (fail closed)
//   e1. confirmed age < 1             → suggest gp_routine (clinician only)
//   e2. confirmed age < 5             → anp/paramedic stripped, then rules run
//   f.  rules in order, first match wins; otherwise the pathway's `default`
// ---------------------------------------------------------------------------
function evaluateDisposition(pathway, ctx) {
  const c = ctx || {};
  const p = pathway || {};
  const positives = c.redFlagPositives || [];
  const unanswered = c.redFlagUnanswered || [];
  const disp = p.disposition;
  const bundledId = c.bundledId || null;
  const origin = c.origin || (bundledId && bundledId === p.id ? 'bundled' : 'custom');
  const out = (status, extra) =>
    Object.assign({ status, reason: '', basis: '', fallbackLine: DISPOSITION_FALLBACK_LINE }, extra || {});

  // ── a1/a2. Frozen clinician-only sets, applied AFTER override resolution ────
  const ids = [bundledId, p.id].filter(Boolean);
  const frozenId = ids.some((id) => CLINICIAN_ONLY_IDS.indexOf(id) !== -1);
  const frozenDomain = !!(disp && CLINICIAN_ONLY_DOMAINS.indexOf(disp.domain) !== -1);
  // mental-health and any sensitive pathway output NOTHING — not a card, not a
  // withheld line. Per plan section B its whole posture is capture-and-escalate
  // with no categorisation, and a "we withheld a routing suggestion" line in the
  // pasted text would itself be a categorisation.
  if (isSensitivePathway(p) || ids.indexOf('mental-health') !== -1) {
    return out('none', { reason: 'sensitive pathway — no disposition output' });
  }
  if (frozenId || frozenDomain) {
    return out('withheld', { reason: 'clinician-only pathway' });
  }

  // ── a3. Custom / edited packs are clinician-only until signed off ───────────
  if (origin !== 'bundled' && !isValidRoutingAttestation(c.routingAttestation)) {
    return out('withheld', { reason: 'custom pathway — routing not signed off' });
  }

  // ── b. Red-flag gate ───────────────────────────────────────────────────────
  if (positives.length > 0) return out('withheld', { reason: 'red flag positive' });
  if (unanswered.length > 0) return out('withheld', { reason: 'red flags not all answered' });

  // ── c. No routing declared for this pathway ────────────────────────────────
  if (!disp || typeof disp !== 'object' || Array.isArray(disp)) {
    return out('none', { reason: 'no disposition block' });
  }

  const age = c.confirmedAge;
  const ageOk = typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 120;
  const title = p.title || p.id || 'this problem';

  // ── d. Confirmed age is the only age. No age → fail closed. ────────────────
  if (!ageOk) {
    return out('suggest', {
      destination: 'gp_routine',
      reason: 'age unconfirmed — failed closed',
      basis: `${title}, age not confirmed, no red flags`,
    });
  }

  const basis = `${title}, age ${age} confirmed, no red flags`;

  // ── e1. Age floor: under 1 is clinician-only, always. ──────────────────────
  if (age < 1) {
    return out('suggest', {
      destination: 'gp_routine',
      reason: 'age under 1 — clinician only',
      basis,
    });
  }

  // ── e2. Under 5: no ANP, no paramedic. ─────────────────────────────────────
  const blocked = age < 5 ? NO_UNDER_FIVE : [];
  const allowed = (Array.isArray(disp.allowed) ? disp.allowed : []).filter((d) => blocked.indexOf(d) === -1);

  // ── f. Rules in order, first match wins. ───────────────────────────────────
  const pfEligible = pharmacyFirstAgeStatus(p, age) === 'eligible';
  for (const rule of Array.isArray(disp.rules) ? disp.rules : []) {
    if (!rule || typeof rule !== 'object') continue;
    const suggest = rule.suggest;
    // A suggestion stripped by the age floor is skipped, not downgraded in
    // place — the next rule (or the default) decides instead.
    if (blocked.indexOf(suggest) !== -1) continue;
    if (suggest !== 'gp_routine' && allowed.indexOf(suggest) === -1) continue;
    if (!matchesWhen(rule.when, { pfEligible, age })) continue;
    return out('suggest', {
      destination: suggest,
      reason: `rule matched: ${describeWhen(rule.when)}`,
      basis,
    });
  }

  const fallback = disp.default === 'duty' ? 'duty' : 'gp_routine';
  return out('suggest', { destination: fallback, reason: 'no rule matched — pathway default', basis });
}

// ---------------------------------------------------------------------------
// overrideDestinations(pathway, confirmedAge) → string[]
// The destinations the OVERRIDE control may offer: the pathway's own allowed
// list plus gp_routine (a clinician is always offerable), minus anything the
// age floor blocks. The floor is applied here too — a control that offers a
// paramedic for a two-year-old would undo in the UI what the engine refuses to
// do in code. It fails closed on an unconfirmed age for the same reason the
// suggestion does: unknown age is not evidence the patient is over 5.
// ---------------------------------------------------------------------------
function overrideDestinations(pathway, confirmedAge) {
  const disp = pathway && pathway.disposition;
  const allowed = disp && Array.isArray(disp.allowed) ? disp.allowed.slice() : [];
  const age = confirmedAge;
  const ageKnown = typeof age === 'number' && Number.isFinite(age);
  const blocked = !ageKnown || age < 5 ? NO_UNDER_FIVE : [];
  const out = allowed.filter((d) => blocked.indexOf(d) === -1);
  if (out.indexOf('gp_routine') === -1) out.push('gp_routine');
  return out;
}

// matchesWhen(when, facts) — ALL conditions must hold (AND). The vocabulary is
// closed and validated upstream; an unknown key here means the pathway skipped
// validation, so it fails the rule rather than being ignored.
function matchesWhen(when, facts) {
  if (!when || typeof when !== 'object') return false;
  const keys = Object.keys(when);
  if (keys.length === 0) return false;
  for (const k of keys) {
    if (k === 'pharmacyFirstEligible') {
      if (when[k] !== facts.pfEligible) return false;
    } else if (k === 'ageUnder') {
      if (!(facts.age < when[k])) return false;
    } else if (k === 'ageAtLeast') {
      if (!(facts.age >= when[k])) return false;
    } else {
      return false;
    }
  }
  return true;
}

function describeWhen(when) {
  return Object.keys(when || {})
    .map((k) => `${k}=${when[k]}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// dispositionCaptureLines(record) → string[]
//
// The disposition lines written into the pasted capture text. The NHSE
// record-the-navigation requirement lands here: what was suggested, what the
// receptionist did with it, and — when nothing was suggested — why not, so a
// significant-event review can reconstruct what the tool did and did not say.
//
// record = evaluateDisposition() result plus the receptionist's decision:
//   { status, destination, reason, basis, fallbackLine,
//     decision: 'confirmed'|'overridden'|undefined,
//     overrideTo, overrideNote }
// ---------------------------------------------------------------------------
function dispositionCaptureLines(record) {
  const r = record || {};
  if (r.status === 'withheld') return [`Disposition withheld: ${r.reason || 'guardrail'}`];
  if (r.status !== 'suggest') return [];
  const basis = r.basis ? ` (${r.basis})` : '';
  let tail;
  if (r.decision === 'overridden') {
    const note = String(r.overrideNote || '').trim();
    tail = `receptionist overrode to: ${destinationLabel(r.overrideTo)}${note ? ` — ${note}` : ''}`;
  } else if (r.decision === 'confirmed') {
    tail = 'receptionist confirmed';
  } else {
    tail = 'receptionist decision not recorded';
  }
  return [
    `Suggested route: ${destinationLabel(r.destination)}${basis} — ${tail}`,
    r.fallbackLine || DISPOSITION_FALLBACK_LINE,
  ];
}

export {
  summariseActionChips,
  evaluateRedFlags,
  buildCaptureText,
  pharmacyFirstHint,
  isSensitivePathway,
  safeguardingActionLine,
  crisisLineText,
  pharmacyFirstAgeStatus,
  evaluateDisposition,
  dispositionCaptureLines,
  destinationLabel,
  overrideDestinations,
  isValidRoutingAttestation,
  DEFAULT_CRISIS_LINE,
  DISPOSITION_FALLBACK_LINE,
  DESTINATION_LABELS,
  CLINICIAN_ONLY_IDS,
  CLINICIAN_ONLY_DOMAINS,
  STATUS_COLOUR
};
