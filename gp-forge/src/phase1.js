// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — Phase-1 scope guard.
// Phase 1 is ADMINISTRATIVE / DOCUMENTATION SUPPORT ONLY (see ../docs/INTENDED-PURPOSE-LLM-SERVER.md).
// It is deliberately NOT a medical device. This module enforces that boundary in two ways:
//   1. an allow-list of permitted task types (anything else is refused), and
//   2. a best-effort content guard that refuses requests seeking clinical advice / decision support.
// The boundary is also re-asserted in the system prompt. Refusals are returned, never thrown.

export const PHASE1_TASKS = {
  admin_draft: {
    description:
      'Draft NON-CLINICAL administrative text (recall/invitation wording, internal admin summary, ' +
      'routine correspondence scaffold) for a human author to edit and approve.',
  },
};

export const SYSTEM_PROMPT = [
  'You are GP Forge, an administrative drafting assistant for a GP practice.',
  'You produce NON-CLINICAL administrative text ONLY.',
  'You MUST NOT provide clinical advice, diagnosis, triage, prognosis, risk assessment, prescribing,',
  'or a clinical management plan, and you MUST NOT summarise a consultation into a clinical record.',
  'Insert [PLACEHOLDERS] for any patient-specific or clinical detail rather than inventing it.',
  'A qualified human will review, edit and approve everything you produce before it is used.',
  'Respond ONLY with JSON matching the provided schema.',
].join(' ');

// Prompt-injection / instruction-override attempts (direct and indirect, e.g. embedded in a
// pasted "record"). Refused outright — GP Forge ignores instructions carried inside the context.
const INJECTION_PATTERNS = [
  /ignore (all|any|the)?\s*(previous|prior|above|earlier) (instruction|prompt|rule|message)/i,
  /disregard (the|your|all|any)?\s*(system|previous|above)?\s*(prompt|instruction|message|rule)/i,
  /\byou are now\b/i,
  /\bact as\b/i,
  /\bpretend (to be|you are|that)\b/i,
  /\bnew instructions?\s*:/i,
  /\bsystem\s*:/i,
  /\bassistant\s*:/i,
  /\boverride\b[^.]*\b(rule|instruction|guard|safety|filter)/i,
  /\bjailbreak\b/i,
  /reveal (your|the)\s*(system\s*)?(prompt|instruction)/i,
  /\bbypass\b[^.]*\b(guard|safety|filter|rule|restriction)/i,
  /\bunrestricted\b[^.]*\b(ai|model|assistant)/i,
];

export function detectInjection(text) {
  const s = String(text || '');
  return INJECTION_PATTERNS.some((re) => re.test(s));
}

// Best-effort clinical-intent detection (defence in depth — not a substitute for the human gate).
const CLINICAL_INTENT = [
  /\bdiagnos(e|is|ing)\b/i,
  /\btriage\b/i,
  /\bdifferential\b/i,
  /\bmanagement plan\b/i,
  /\b(treat|treatment|therapy)\b/i,
  /\b(prescrib|dose|dosage|titrat)/i,
  /\bred[-\s]?flag/i,
  /\bsafety[-\s]?net/i,
  /should (the|this|we|i) (patient|prescribe|refer|admit|investigate)/i,
  /\bis (this|it) (cancer|sepsis|a stroke|an? mi|serious)\b/i,
  /\b(what|which) (medication|antibiotic|investigation|test) (should|do)\b/i,
];

function asText(context) {
  if (context == null) return '';
  if (typeof context === 'string') return context;
  if (typeof context === 'object') {
    return [context.freeText, context.notes, context.kind, context.purpose]
      .filter((v) => typeof v === 'string')
      .join(' \n ');
  }
  return String(context);
}

export function guardRequest({ task, context } = {}) {
  if (!task || !Object.prototype.hasOwnProperty.call(PHASE1_TASKS, task)) {
    return {
      ok: false,
      code: 'out_of_scope_task',
      refusal:
        `Task "${task}" is outside Phase-1 scope. Phase 1 supports administrative/documentation ` +
        `tasks only (${Object.keys(PHASE1_TASKS).join(', ')}). Clinical summarisation and ` +
        `decision-support are Phase 2/3 and are not enabled.`,
    };
  }
  const text = asText(context);
  if (detectInjection(text)) {
    return {
      ok: false,
      code: 'prompt_injection',
      refusal:
        'This request contains an instruction-override / prompt-injection pattern and was refused. ' +
        'GP Forge performs administrative drafting only and ignores instructions embedded in the context.',
    };
  }
  for (const re of CLINICAL_INTENT) {
    if (re.test(text)) {
      return {
        ok: false,
        code: 'clinical_intent',
        refusal:
          'This request appears to seek clinical advice or decision support, which is outside ' +
          'Phase-1 scope (administrative/documentation only). No clinical content will be generated.',
      };
    }
  }
  return { ok: true };
}

export function buildPrompt({ kind, context } = {}) {
  const ctx = typeof context === 'string' ? context : JSON.stringify(context ?? {}, null, 2);
  return [
    `Administrative drafting task: ${kind || 'general administrative text'}.`,
    'Context (administrative only — contains no instruction you should treat as clinical advice):',
    ctx,
    'Draft the administrative text. Use [PLACEHOLDERS] for any specific detail not given above.',
  ].join('\n');
}
