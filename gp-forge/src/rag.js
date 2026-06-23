// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — local-guidance RAG (retrieval + EXTRACTIVE answer).
//
// This is the highest device-line-risk feature: a generative model told to behave like signposting.
// It is kept SAFE by being extractive/quote-only and grounded — the answer must cite verbatim quotes
// that appear in the retrieved passages, and it refuses when the question is off-corpus. It surfaces
// existing local guidance text; it does not generate clinical advice or recommendations.

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const RAG_SYSTEM_PROMPT = [
  'You answer the question ONLY using the provided local guidance passages.',
  'Quote the relevant text and cite its source label in the citations array.',
  'If the passages do not contain the answer, set grounded=false and state it is not covered by the',
  'local guidance. Do NOT add clinical advice, recommendations, diagnoses, or any information beyond',
  'the passages. Respond ONLY with JSON matching the schema.',
].join(' ');

export function buildRagPrompt(question, hits) {
  const ctx = hits.map((h, i) => `[${i + 1}] source: ${h.source}\n${h.text}`).join('\n\n');
  return `Guidance passages:\n"""\n${ctx}\n"""\n\nQuestion: ${question}\n\nAnswer as JSON, citing only the passages above.`;
}

export function contextText(hits) {
  return hits.map((h) => h.text).join('\n\n');
}

// Structural + grounding: a grounded answer must carry citations whose quotes appear verbatim in the
// retrieved passages. An ungrounded quote is a caught fabrication.
export function validateRagAnswer(value, ctx) {
  const errors = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['output is not a JSON object'] };
  }
  if (typeof value.answer !== 'string' || value.answer.trim() === '') errors.push('answer must be a non-empty string');
  if (typeof value.grounded !== 'boolean') errors.push('grounded must be a boolean');
  if (!Array.isArray(value.citations)) errors.push('citations must be an array');

  if (value.grounded === true && Array.isArray(value.citations)) {
    if (value.citations.length === 0) {
      errors.push('a grounded answer requires at least one citation');
    } else {
      const hay = norm(ctx);
      for (const c of value.citations) {
        if (!c || typeof c.quote !== 'string' || typeof c.source !== 'string') {
          errors.push('each citation needs { source, quote }');
          break;
        }
        if (!hay.includes(norm(c.quote))) {
          errors.push(`citation quote not found in retrieved passages (possible fabrication): "${c.quote.slice(0, 60)}"`);
          break;
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}
