// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Results Auto-Filing utilities (pure logic, no chrome APIs, no DOM)
//
// Shared by the Lab Filing side-panel module, the injected execution macro
// (content-scripts/triage-lens/lab-file-button.js) and shared/io/labfiling-io.js.
// Loaded as a plain script in extension pages (window.LabFilingUtils) and via
// require() in node tests.
//
// A "filing profile" describes — for ONE lab / area / report layout — how to file
// a NORMAL result on the live Medicus filing screen: the visible text of the
// "normal" option to pick on each subheading, the file/complete controls, and an
// optional (prepare-only) patient message. Because lab layouts differ area-to-area,
// the clinician authors the profile (assisted by the external-LLM workflow), the
// suite never guesses the live DOM. Everything is matched by VISIBLE TEXT, never by
// per-session ids — the same safety doctrine as routine-rx-button.js.
//
// SAFETY INVARIANTS encoded here:
//   • A profile is INERT until a clinician reviews and enables it. Author/import
//     paths force enabled:false, reviewed:false (use lockForReview()).
//   • The patient message is PREPARE-ONLY — the macro pre-fills a draft and stops;
//     the clinician sends. patientMessage.enabled is forced false on author/import.
//   • commitMode is 'manual' (default) or 'confirm' ONLY. There is no full-auto
//     mode for an irreversible patient-record write — a human always presses the
//     final button. Any other value clamps to 'manual'.
//
// Exported functions:
//   validateProfile(p)                     — schema errors array ([] = valid)
//   sanitiseProfile(p)                     — whitelist-rebuild a validated profile
//   lockForReview(p, source)               — force enabled/reviewed/message off
//   generateProfileId(name, takenIds)      — slug id, collision-suffixed
//   seedAnalytesFromResultRules(rules)     — derive known analyte names from resultRules
//   phiWarnings(profiles)                  — heuristic patient-identifier warnings
//   filingProfilePrompt()                  — copy-paste prompt for external LLMs

'use strict';

const LF_ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/i;
const LF_SOURCES = ['manual', 'llm', 'import'];
const LF_COMMIT_MODES = ['manual', 'confirm']; // NB: no 'auto' — see header.

const LF_LIMITS = {
  name: 120,
  matchItem: 80,
  match: 30,
  analyteItem: 80,
  analytes: 300,
  control: 120, // visible-text / aria-label of a control
  selector: 200, // CSS selector hint
  comment: 500,
  template: 500,
  notes: 1000,
};

// ── Validation ────────────────────────────────────────────────────────────────

function isStr(v) {
  return typeof v === 'string';
}
function strArrOk(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateProfile(p) {
  const errs = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['Profile must be an object.'];

  if (!isStr(p.name) || !p.name.trim()) errs.push('name is required.');
  else if (p.name.trim().length > LF_LIMITS.name) errs.push(`name must be ${LF_LIMITS.name} characters or fewer.`);

  if (p.id !== undefined && (!isStr(p.id) || !LF_ID_RE.test(p.id))) {
    errs.push('id must match [a-z0-9][a-z0-9-]{0,49}.');
  }

  if (p.match !== undefined && !strArrOk(p.match)) errs.push('match must be an array of strings.');
  else if (Array.isArray(p.match) && p.match.length > LF_LIMITS.match) {
    errs.push(`match may have at most ${LF_LIMITS.match} entries.`);
  }

  if (p.analytes !== undefined && !strArrOk(p.analytes)) errs.push('analytes must be an array of strings.');

  // filing block
  if (p.filing === undefined || p.filing === null || typeof p.filing !== 'object' || Array.isArray(p.filing)) {
    errs.push('filing is required and must be an object.');
  } else {
    const f = p.filing;
    if (!isStr(f.normalOptionText) || !f.normalOptionText.trim()) {
      errs.push('filing.normalOptionText is required — the visible text of the "normal" option on each subheading.');
    }
    if (!isStr(f.fileButtonText) || !f.fileButtonText.trim()) {
      errs.push('filing.fileButtonText is required — the visible text of the File button.');
    }
    ['openControlText', 'completeButtonText'].forEach((k) => {
      if (f[k] !== undefined && !isStr(f[k])) errs.push(`filing.${k} must be a string.`);
    });
    if (f.rowSelector !== undefined && !isStr(f.rowSelector)) errs.push('filing.rowSelector must be a string.');
    if (f.filingComment !== undefined && !isStr(f.filingComment)) errs.push('filing.filingComment must be a string.');
  }

  // patientMessage block (optional)
  if (p.patientMessage !== undefined) {
    const m = p.patientMessage;
    if (!m || typeof m !== 'object' || Array.isArray(m)) errs.push('patientMessage must be an object.');
    else {
      if (m.enabled !== undefined && typeof m.enabled !== 'boolean')
        errs.push('patientMessage.enabled must be a boolean.');
      ['triggerText', 'fieldText', 'template'].forEach((k) => {
        if (m[k] !== undefined && !isStr(m[k])) errs.push(`patientMessage.${k} must be a string.`);
      });
      if (isStr(m.template) && m.template.length > LF_LIMITS.template) {
        errs.push(`patientMessage.template must be ${LF_LIMITS.template} characters or fewer.`);
      }
    }
  }

  if (p.commitMode !== undefined && !LF_COMMIT_MODES.includes(p.commitMode)) {
    errs.push(`commitMode must be one of: ${LF_COMMIT_MODES.join(', ')}.`);
  }
  if (p.source !== undefined && !LF_SOURCES.includes(p.source)) {
    errs.push(`source must be one of: ${LF_SOURCES.join(', ')}.`);
  }
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') errs.push('enabled must be a boolean.');
  if (p.reviewed !== undefined && typeof p.reviewed !== 'boolean') errs.push('reviewed must be a boolean.');
  if (p.notes !== undefined && !isStr(p.notes)) errs.push('notes must be a string.');

  return errs;
}

// ── Sanitisation ────────────────────────────────────────────────────────────────
// Whitelist rebuild — never copies unknown fields (incl. __proto__/constructor),
// clamps lengths, clamps commitMode. Run validateProfile first; this assumes a
// structurally valid profile. Faithfully reflects enabled/reviewed/message.enabled
// as given — the AUTHOR/IMPORT paths call lockForReview() to force them off.

function clamp(s, n) {
  return String(s ?? '')
    .trim()
    .slice(0, n);
}

function sanitiseStrArr(arr, itemMax, listMax) {
  return (Array.isArray(arr) ? arr : [])
    .map((s) => clamp(s, itemMax))
    .filter(Boolean)
    .slice(0, listMax);
}

function sanitiseProfile(p) {
  const f = p.filing && typeof p.filing === 'object' ? p.filing : {};
  const m = p.patientMessage && typeof p.patientMessage === 'object' ? p.patientMessage : null;

  const out = {
    id: isStr(p.id) && LF_ID_RE.test(p.id) ? p.id.toLowerCase() : undefined,
    name: clamp(p.name, LF_LIMITS.name),
    match: sanitiseStrArr(p.match, LF_LIMITS.matchItem, LF_LIMITS.match),
    analytes: sanitiseStrArr(p.analytes, LF_LIMITS.analyteItem, LF_LIMITS.analytes),
    filing: {
      rowSelector: clamp(f.rowSelector, LF_LIMITS.selector),
      openControlText: clamp(f.openControlText, LF_LIMITS.control),
      normalOptionText: clamp(f.normalOptionText, LF_LIMITS.control),
      fileButtonText: clamp(f.fileButtonText, LF_LIMITS.control),
      completeButtonText: clamp(f.completeButtonText, LF_LIMITS.control),
      filingComment: clamp(f.filingComment, LF_LIMITS.comment),
    },
    patientMessage: {
      enabled: m ? m.enabled === true : false,
      triggerText: clamp(m && m.triggerText, LF_LIMITS.control),
      fieldText: clamp(m && m.fieldText, LF_LIMITS.control),
      template: clamp(m && m.template, LF_LIMITS.template),
    },
    commitMode: LF_COMMIT_MODES.includes(p.commitMode) ? p.commitMode : 'manual',
    source: LF_SOURCES.includes(p.source) ? p.source : 'manual',
    reviewed: p.reviewed === true,
    enabled: p.enabled === true,
    notes: clamp(p.notes, LF_LIMITS.notes),
    updatedAt: isStr(p.updatedAt) && p.updatedAt ? p.updatedAt : new Date().toISOString(),
  };
  return out;
}

// Force a profile inert pending clinician review. Used by the LLM-paste path and
// by backup import — a profile must never arrive enabled, reviewed, or with the
// patient message switched on. `source` records provenance ('llm' | 'import').
function lockForReview(p, source) {
  const clean = sanitiseProfile(p);
  clean.enabled = false;
  clean.reviewed = false;
  clean.patientMessage.enabled = false;
  clean.source = LF_SOURCES.includes(source) ? source : clean.source;
  return clean;
}

function generateProfileId(name, takenIds) {
  const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
  let slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug || !LF_ID_RE.test(slug)) slug = 'profile';
  let id = slug;
  let n = 2;
  while (taken.has(id)) id = `${slug}-${n++}`;
  return id;
}

// Derive a deduplicated, sorted list of known analyte names from the suite's
// shipped/saved resultRules — used to pre-seed a new profile's `analytes` so the
// clinician isn't typing every test name from scratch. Pure: pass CONFIG.resultRules.
function seedAnalytesFromResultRules(resultRules) {
  const names = new Set();
  for (const rule of Array.isArray(resultRules) ? resultRules : []) {
    if (!rule || typeof rule !== 'object') continue;
    const collect = (a) => {
      if (a && Array.isArray(a.match))
        a.match.forEach((m) => isStr(m) && m.trim() && names.add(m.trim().toLowerCase()));
    };
    if (rule.analyte) collect(rule.analyte);
    if (Array.isArray(rule.conditions)) rule.conditions.forEach((c) => c && collect(c.analyte || c));
  }
  return Array.from(names).sort();
}

// ── Runtime helpers (pure — used by the execution macro) ──────────────────────
// These are DOM-free so they can be unit-tested without a browser; the macro
// (content-scripts/triage-lens/lab-file-button.js) calls them via window.LabFilingUtils.

// Build a lowercase haystack of everything identifying a normalised report — the
// analyte names and their specimen/group headers — so a profile's match[]
// substrings can be tested against it.
function reportHaystack(report) {
  if (!report || !Array.isArray(report.results)) return '';
  const parts = [];
  for (const r of report.results) {
    if (!r || typeof r !== 'object') continue;
    if (isStr(r.name)) parts.push(r.name);
    if (isStr(r.specimen)) parts.push(r.specimen);
  }
  return parts.join(' • ').toLowerCase();
}

// Pick the ENABLED profile that best fits this report. A profile fits when at
// least one of its match[] substrings appears in the report haystack. The best
// fit is the one with the most matching substrings (most specific). Returns the
// profile object, or null. A profile with an empty match[] never auto-fits — it
// must be selected deliberately, never fired on a guess.
function matchProfile(profiles, report) {
  const hay = reportHaystack(report);
  if (!hay) return null;
  let best = null;
  let bestScore = 0;
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (!p || p.enabled !== true || !Array.isArray(p.match) || p.match.length === 0) continue;
    let score = 0;
    for (const sub of p.match) {
      if (isStr(sub) && sub.trim() && hay.includes(sub.trim().toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// Extract a first name from a Medicus patient banner string. Handles the UK
// "Surname, Firstname" order and plain "Firstname Surname"; falls back to "there".
function extractFirstName(patient) {
  const name = isStr(patient) ? patient.trim() : isStr(patient && patient.name) ? patient.name.trim() : '';
  if (!name) return 'there';
  if (name.includes(',')) {
    const after = name.split(',')[1] || '';
    const first = after.trim().split(/\s+/)[0];
    if (first) return first;
  }
  const first = name.split(/\s+/)[0];
  return first || 'there';
}

// Fill the only supported placeholder, {firstName}. Never throws.
function fillTemplate(template, patient) {
  if (!isStr(template)) return '';
  return template.replace(/\{firstName\}/g, extractFirstName(patient));
}

// The enumerated irreversible-action confirm text — mirrors confirmBulkTickOff in
// content.js. Lists each analyte being filed as normal, names the action, and
// warns it cannot be undone.
function buildFilingConfirmMessage(report, profile) {
  const names = [];
  if (report && Array.isArray(report.results)) {
    for (const r of report.results) {
      if (r && isStr(r.name) && r.name.trim()) names.push(r.name.trim());
    }
  }
  const n = names.length;
  const list = names.length ? names.map((x) => ` • ${x}`).join('\n') : ' • (no individual analytes detected)';
  const profName = profile && isStr(profile.name) ? profile.name : 'this profile';
  return (
    `File this result as NORMAL?\n\n` +
    `The suite has confirmed every parameter below is within normal limits, and will mark each as "${profile && profile.filing ? profile.filing.normalOptionText : 'normal'}" using "${profName}":\n\n` +
    list +
    `\n\n` +
    `Filing writes to Medicus and removes this from the worklist. This cannot be undone from here. ` +
    `Confirm only if you are satisfied every result has been seen and is genuinely normal.\n\n` +
    `OK = file ${n > 1 ? 'them all as normal' : 'as normal'}    Cancel = leave for manual review`
  );
}

// ── PHI heuristics ──────────────────────────────────────────────────────────────
// A filing profile is configuration — it must never carry patient data. These
// checks are a warning net for accidental pastes (e.g. a message template copied
// with a real name/NHS number in it), not a guarantee.

const NHS_NUMBER_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/;
const DOB_RE = /\b(dob|date of birth)\b/i;

function profileText(p) {
  if (!p || typeof p !== 'object') return '';
  const m = p.patientMessage || {};
  const f = p.filing || {};
  return [p.name, p.notes, m.template, f.filingComment, ...(Array.isArray(p.match) ? p.match : [])]
    .filter(isStr)
    .join('\n');
}

function phiWarnings(profiles) {
  const warnings = [];
  for (const p of Array.isArray(profiles) ? profiles : []) {
    const text = profileText(p);
    if (NHS_NUMBER_RE.test(text)) {
      warnings.push(
        `"${p && p.name}": contains a 10-digit number formatted like an NHS number — check no patient identifier has been pasted in.`
      );
    }
    if (DOB_RE.test(text)) {
      warnings.push(`"${p && p.name}": mentions a date of birth — check no patient details have been pasted in.`);
    }
  }
  return warnings;
}

// ── LLM prompt ────────────────────────────────────────────────────────────────
// Same convention as kbSingleEntryPrompt() / resultRuleSchemaPrompt(): one
// self-contained prompt the clinician copies into any external LLM, alongside
// SCREENSHOTS of the Medicus filing screen, with the example JSON delimited by
// --- EXAMPLE JSON --- markers (extracted and round-trip-validated by
// test-lab-filing-utils.js).

const LF_PROMPT_SCHEMA = `FILING-PROFILE SCHEMA (output a single JSON object):
- "name"   (required) — short label for this lab/report layout, e.g. "City Hospital — U&E / FBC".
- "match"  — array of lowercase substrings that identify reports this profile applies to, matched against the report/specimen title (e.g. ["full blood count","u&e","liver function"]). Leave [] if unsure.
- "analytes" — array of the analyte/subheading names as they appear on THIS lab's reports (e.g. ["haemoglobin","sodium","potassium","creatinine"]). Read these off the screenshots.
- "filing" (required) — how to file a NORMAL result by DRIVING THE SCREEN. Use the VISIBLE TEXT / button label exactly as it appears, never an internal id:
    - "normalOptionText" (required) — the exact visible text of the option that marks a subheading as normal / no-action, e.g. "No action required" or "Normal — file".
    - "openControlText"  — if each subheading's options are behind a menu/dropdown, the visible text/label that opens it; else omit.
    - "rowSelector"      — optional CSS selector that matches each subheading row, if you can infer it from the screenshots; else omit.
    - "fileButtonText"   (required) — the exact visible text of the button that files the result, e.g. "File".
    - "completeButtonText" — the exact visible text of the button that completes/closes the task, e.g. "Complete"; omit if filing also completes.
    - "filingComment"    — optional short free-text comment to record on filing, e.g. "All results within normal limits."
- "patientMessage" — optional. The macro only PREPARES a draft; the clinician sends it.
    - "template" — the message body, e.g. "Dear {firstName}, your recent blood test results are all normal. No action is needed...". Use {firstName} as the only placeholder.
    - "triggerText"/"fieldText" — visible text of the control that opens the message and the message field, if you can see them on the screenshots; else omit.

Do NOT include "id", "source", "reviewed", "enabled" or "updatedAt" — the extension sets those, and the profile always arrives DISABLED until a clinician reviews and enables it.`;

const LF_PROMPT_RULES = `1. Read everything off the SCREENSHOTS the clinician pastes. Match controls by their VISIBLE TEXT exactly (including capitalisation of words, punctuation like "U&E").
2. If you cannot see a control's exact text on the screenshots, OMIT that field rather than guessing — a wrong label makes the macro abort safely, but a guessed-wrong label that happens to match the wrong control is dangerous.
3. NEVER include any patient details, real or invented, anywhere — not in the message template, not in comments, not in examples. Use {firstName} as the only placeholder.
4. The patient message must say results are normal/no action needed in plain, reassuring English (reading age ~9–11). Never imply a result that needs action is normal.`;

function filingProfilePrompt() {
  return `You are helping a UK NHS GP configure a "lab results auto-filing" profile for the Medicus clinical system. The clinician will paste SCREENSHOTS of their lab-result FILING screen (the page where each subheading of a blood test is marked normal/abnormal and the result is filed). Your job is to turn those screenshots into ONE JSON filing profile that tells a browser macro exactly which on-screen controls to use to file an all-normal result.

This profile is used ONLY when the suite has already confirmed every parameter in the result is within normal limits. It must drive the SAME controls a clinician would click — never invent a shortcut.

Output ONLY a single valid JSON object for one profile — no markdown fences, no commentary.

${LF_PROMPT_SCHEMA}

INSTRUCTIONS:
${LF_PROMPT_RULES}

--- EXAMPLE JSON ---
{
  "name": "Example Hospital — routine bloods (FBC / U&E / LFT)",
  "match": ["full blood count", "u&e", "urea and electrolytes", "liver function"],
  "analytes": ["haemoglobin", "white cell count", "platelets", "sodium", "potassium", "creatinine", "egfr", "alt", "bilirubin"],
  "filing": {
    "normalOptionText": "No action required",
    "openControlText": "Select action",
    "fileButtonText": "File",
    "completeButtonText": "Complete",
    "filingComment": "All results within normal limits, no action needed."
  },
  "patientMessage": {
    "template": "Dear {firstName}, your recent blood test results are all normal and no action is needed. Thank you.",
    "triggerText": "Send message",
    "fieldText": "Message"
  }
}
--- END EXAMPLE ---

After this line, the clinician pastes screenshots of the filing screen (and may describe the exact button labels):
`;
}

const LabFilingUtilsApi = {
  LF_ID_RE,
  LF_SOURCES,
  LF_COMMIT_MODES,
  LF_LIMITS,
  validateProfile,
  sanitiseProfile,
  lockForReview,
  generateProfileId,
  seedAnalytesFromResultRules,
  phiWarnings,
  filingProfilePrompt,
  reportHaystack,
  matchProfile,
  extractFirstName,
  fillTemplate,
  buildFilingConfirmMessage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LabFilingUtilsApi;
} else if (typeof self !== 'undefined') {
  // Works in both extension pages (window === self) and service workers (no window).
  self.LabFilingUtils = LabFilingUtilsApi;
}
