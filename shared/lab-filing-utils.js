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

// Wrapped in an IIFE so its top-level identifiers (helper regexes like
// NHS_NUMBER_RE, generic helpers like clamp/isStr) never leak into the shared
// global scope of the extension pages, where this file is loaded as a CLASSIC
// <script> alongside knowledge-utils.js et al. Without this, `const NHS_NUMBER_RE`
// here collides with the same global in knowledge-utils.js and throws
// "Identifier already declared", killing this whole script (and the Lab filing
// module with it). node require() module-scopes the file, so tests never saw it.
(function () {
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
    else if (Array.isArray(p.analytes) && p.analytes.length > LF_LIMITS.analytes) {
      errs.push(`analytes may have at most ${LF_LIMITS.analytes} entries.`);
    }

    // filing block. Control-text fields are matched against on-screen labels, so an
    // over-long value is rejected (not silently truncated) — a truncated label
    // could match an unintended control.
    if (p.filing === undefined || p.filing === null || typeof p.filing !== 'object' || Array.isArray(p.filing)) {
      errs.push('filing is required and must be an object.');
    } else {
      const f = p.filing;
      if (!isStr(f.normalOptionText) || !f.normalOptionText.trim()) {
        errs.push('filing.normalOptionText is required — the visible text of the "normal" option on each subheading.');
      } else if (f.normalOptionText.length > LF_LIMITS.control) {
        errs.push(`filing.normalOptionText must be ${LF_LIMITS.control} characters or fewer.`);
      }
      if (!isStr(f.fileButtonText) || !f.fileButtonText.trim()) {
        errs.push('filing.fileButtonText is required — the visible text of the File button.');
      } else if (f.fileButtonText.length > LF_LIMITS.control) {
        errs.push(`filing.fileButtonText must be ${LF_LIMITS.control} characters or fewer.`);
      }
      ['openControlText', 'completeButtonText', 'nextStepText', 'nextStepMessageText'].forEach((k) => {
        if (f[k] !== undefined && !isStr(f[k])) errs.push(`filing.${k} must be a string.`);
        else if (isStr(f[k]) && f[k].length > LF_LIMITS.control)
          errs.push(`filing.${k} must be ${LF_LIMITS.control} characters or fewer.`);
      });
      if (f.rowSelector !== undefined && !isStr(f.rowSelector)) errs.push('filing.rowSelector must be a string.');
      else if (isStr(f.rowSelector) && f.rowSelector.length > LF_LIMITS.selector)
        errs.push(`filing.rowSelector must be ${LF_LIMITS.selector} characters or fewer.`);
      if (f.filingComment !== undefined && !isStr(f.filingComment)) errs.push('filing.filingComment must be a string.');
      else if (isStr(f.filingComment) && f.filingComment.length > LF_LIMITS.comment)
        errs.push(`filing.filingComment must be ${LF_LIMITS.comment} characters or fewer.`);
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
        nextStepText: clamp(f.nextStepText, LF_LIMITS.control),
        nextStepMessageText: clamp(f.nextStepMessageText, LF_LIMITS.control),
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

  // Reasons this report must NOT be offered for one-click filing, even though it
  // may score level:'none'. The numeric severity gate is necessary but NOT
  // sufficient — it reads the lab's own numeric flags and cannot reason about
  // free text, cultures, trends, or whether the report is even the right patient.
  // So we fail CLOSED on anything it cannot judge. Returns [] when fileable, else
  // a list of short human-readable reasons (shown to the clinician). Pure.
  //
  // Discriminator for "the gate can't judge this result": a result with no finite
  // numeric value but with free-text content (cultures, histology, "abnormal film"
  // comments). Normal numeric results have a finite value and are unaffected.
  function fileabilityBlockers(report, severity, resultRules) {
    const reasons = [];
    if (!report || !Array.isArray(report.results) || report.results.length === 0) {
      reasons.push('no results could be read from this report');
      return reasons;
    }
    if (!severity || severity.level !== 'none') reasons.push('not every result is within normal limits');
    if ((severity && severity.unmatched) || report.unmatched) reasons.push('this report is not matched to a patient');
    // Without result rules the suite cannot flag cultures or apply threshold
    // escalations, so an abnormal culture could read as normal — fail closed.
    if (!Array.isArray(resultRules) || resultRules.length === 0) {
      reasons.push('result rules are not loaded, so cultures and thresholds cannot be checked');
    }
    const freeText = [];
    for (const r of report.results) {
      if (!r || typeof r !== 'object') continue;
      const hasText = isStr(r.text) && r.text.trim().length > 0;
      if (!Number.isFinite(r.value) && hasText)
        freeText.push(isStr(r.name) && r.name.trim() ? r.name.trim() : 'unnamed');
    }
    if (freeText.length) {
      const shown = freeText.slice(0, 3).join(', ');
      reasons.push(
        `contains a free-text / non-numeric result the suite cannot score: ${shown}${freeText.length > 3 ? '…' : ''}`
      );
    }
    // De-duplicate (unmatched can be reported by both severity and report).
    return Array.from(new Set(reasons));
  }

  // The enumerated irreversible-action confirm text — mirrors confirmBulkTickOff in
  // content.js. Lists each analyte being filed, states accurately WHAT the suite
  // checked (and what it could not), names the commit mode, and warns it cannot be
  // undone. Deliberately does NOT claim it "confirmed every parameter normal" — it
  // checked numeric values against the profile's ranges; the clinician judges.
  function buildFilingConfirmMessage(report, profile, mode) {
    const names = [];
    if (report && Array.isArray(report.results)) {
      for (const r of report.results) {
        if (r && isStr(r.name) && r.name.trim()) names.push(r.name.trim());
      }
    }
    const n = names.length;
    const list = names.length ? names.map((x) => ` • ${x}`).join('\n') : ' • (no individual analytes detected)';
    const profName = profile && isStr(profile.name) ? profile.name : 'this profile';
    const normalOpt =
      profile && profile.filing && isStr(profile.filing.normalOptionText) ? profile.filing.normalOptionText : 'normal';
    const modeLine =
      mode === 'confirm' ? `You are in "ask, then file" mode — clicking OK files this result now.\n\n` : '';
    return (
      `File this result as NORMAL?\n\n` +
      modeLine +
      `Every numeric value below is within this lab's reference range, and each will be marked "${normalOpt}" using "${profName}":\n\n` +
      list +
      `\n\n` +
      `The suite checks numeric values only — it cannot judge free text, trends over time, or whether this is the right patient. Read the values yourself before confirming.\n\n` +
      `Filing writes to Medicus and removes this from the worklist. This cannot be undone from here.\n\n` +
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
- "name"   (required) — short label for this lab/report layout, e.g. "Routine bloods — normal, no action".
- "match"  — array of lowercase substrings that identify reports this profile applies to. Medicus reports often have NO panel/section title, so match against the ANALYTE NAMES that appear on the report (e.g. ["haemoglobin","platelets","white cell","mcv"] for an FBC, or ["sodium","potassium","creatinine"] for U&E). Leave [] if unsure. At least one must appear in the report for the button to be offered.
- "analytes" — array of the analyte names as they appear on THIS lab's reports (e.g. ["haemoglobin","sodium","potassium","creatinine"]). Read these off the screenshots.
- "filing" (required) — how to file a NORMAL result by DRIVING THE SCREEN. Use the VISIBLE TEXT / button label exactly as it appears, never an internal id. On Medicus, filing is done at WHOLE-REPORT level (not per analyte): there is one button/note that marks the report normal, then a file button.
    - "normalOptionText" (required) — the exact visible text of the control that marks the report as normal / no-action. On Medicus this is the filing-note link "Normal result, no action required".
    - "nextStepText" — if the screen has a "Next Steps" choice (radio/option), the exact visible text of the NO-FURTHER-ACTION option, so the macro selects it explicitly and never files down a "message patient" or "reassign" path. On Medicus this is "File results with no further action". OMIT only if there is no such choice.
    - "nextStepMessageText" — optional: the exact visible text of the "file AND message the patient" Next Step option, e.g. "File results and message patient". Only used when the clinician chooses the "+ message patient" action; the macro selects it and prepares the message but NEVER sends — the clinician sends in the lab system. OMIT if the lab has no messaging step.
    - "fileButtonText"   (required) — the exact visible text of the button that files the result (no-action path). On Medicus this is "File results".
    - "completeButtonText" — only if a SEPARATE button completes/closes the task after filing; OMIT if the file button is the final step (Medicus files in one step, so leave this out).
    - "openControlText"  — only if the normal option is hidden behind a menu you must open first; OMIT otherwise (Medicus shows it directly).
    - "rowSelector"      — leave out; Medicus files at report level, not per row.
    - "filingComment"    — usually unnecessary on Medicus (the "Add filing note…" button already records the note). Omit unless your lab needs an extra free-text comment.
- "patientMessage" — optional. The macro only PREPARES a draft; the clinician sends it.
    - "template" — the message body, e.g. "Dear {firstName}, your recent blood test results are all normal. No action is needed...". Use {firstName} as the only placeholder.
    - "triggerText"/"fieldText" — visible text of the control that opens the message and the message field, if you can see them on the screenshots; else omit.

Do NOT include "id", "source", "reviewed", "enabled" or "updatedAt" — the extension sets those, and the profile always arrives DISABLED until a clinician reviews and enables it.`;

  const LF_PROMPT_RULES = `1. Read everything off the SCREENSHOTS the clinician pastes. Match controls by their VISIBLE TEXT exactly (including capitalisation of words, punctuation like "U&E").
2. If you cannot see a control's exact text on the screenshots, OMIT that field rather than guessing — a wrong label makes the macro abort safely, but a guessed-wrong label that happens to match the wrong control is dangerous.
3. NEVER include any patient details, real or invented, anywhere — not in the message template, not in comments, not in examples. Use {firstName} as the only placeholder.
4. The patient message must say results are normal/no action needed in plain, reassuring English (reading age ~9–11). Never imply a result that needs action is normal.`;

  function filingProfilePrompt() {
    return `You are helping a UK NHS GP configure a "lab results auto-filing" profile for the Medicus clinical system. The clinician will paste SCREENSHOTS of their lab-result FILING screen (the investigation-report task where the whole report is marked normal/no-action and filed). Your job is to turn those screenshots into ONE JSON filing profile that tells a browser macro exactly which on-screen controls to use to file an all-normal result. NOTE: Medicus files the WHOLE report in one step — there is a button to mark it normal/no-action and a button to file; there are usually no per-analyte controls.

This profile is used ONLY when the suite has already confirmed every parameter in the result is within normal limits. It must drive the SAME controls a clinician would click — never invent a shortcut.

Output ONLY a single valid JSON object for one profile — no markdown fences, no commentary.

${LF_PROMPT_SCHEMA}

INSTRUCTIONS:
${LF_PROMPT_RULES}

--- EXAMPLE JSON ---
{
  "name": "Routine bloods — normal, no action (Medicus)",
  "match": ["haemoglobin", "platelets", "white cell", "mcv", "sodium", "potassium", "creatinine"],
  "analytes": ["haemoglobin", "white cell count", "platelets", "rbc", "mcv", "neutrophils", "sodium", "potassium", "creatinine", "egfr"],
  "filing": {
    "normalOptionText": "Normal result, no action required",
    "nextStepText": "File results with no further action",
    "nextStepMessageText": "File results and message patient",
    "fileButtonText": "File results"
  },
  "patientMessage": {
    "template": "Dear {firstName}, your recent blood test results are all normal and no action is needed. Thank you."
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
    fileabilityBlockers,
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
})();
