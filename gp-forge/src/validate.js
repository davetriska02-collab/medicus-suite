// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — downstream validation of model output.
// Constrained decoding guarantees the *shape*; this guarantees we never silently accept output that
// is malformed OR that has leaked clinical-advice content into an administrative draft (defence in
// depth). It does NOT — and cannot — validate clinical correctness; that is the human review gate.

const CLINICAL_LEAK = [
  /\byou should (take|start|stop|increase|decrease|reduce|continue|avoid)\b/i,
  /\b(start|stop|increase|decrease|reduce|titrate|continue) (taking |your |the )?(this |that )?(medication|dose|antibiotic|statin|insulin|inhaler|treatment|tablets?)\b/i,
  /\b(diagnos(is|ed|e)|differential|prognosis)\b/i,
  /\b(prescrib|titrat)/i,
  /\bmanagement plan\b/i,
  /\b\d+\s?(mg|mcg|microgram|ml|units?|g)\b/i, // a dose/quantity in an administrative draft is a red flag
  /\b(two[-\s]?week wait|2ww|urgent(ly)? refer|refer urgently|admit to (hospital|a&e)|attend a&e|emergency department)\b/i,
  /\b(likely|suspected|consistent with|concerning for) (cancer|sepsis|stroke|mi|dvt|pe|infection|malignancy)\b/i,
  /\bsafety[-\s]?net/i,
  /\bwe suspect\b/i,
];

export function parseJson(content) {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (err) {
    return { ok: false, errors: [`output is not valid JSON: ${err.message}`] };
  }
}

export function validateAdminDraft(value) {
  const errors = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['output is not a JSON object'] };
  }
  const { title, body, placeholders } = value;
  if (typeof title !== 'string' || title.trim() === '') errors.push('title must be a non-empty string');
  if (typeof body !== 'string' || body.trim() === '') errors.push('body must be a non-empty string');
  if (!Array.isArray(placeholders) || !placeholders.every((p) => typeof p === 'string')) {
    errors.push('placeholders must be an array of strings');
  }
  if (typeof body === 'string') {
    for (const re of CLINICAL_LEAK) {
      if (re.test(body)) {
        errors.push(`administrative draft contains clinical-advice-like content (matched ${re}) — rejected`);
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, body, placeholders } };
}
