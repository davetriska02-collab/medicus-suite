// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — PHASE 2 (medical-device-class) features. DISABLED by default (GPF_ENABLE_PHASE2).
//
// Generative summarisation of a consultation into a structured SOAP note IS a medical-device function
// (per NHS England AVT guidance, ≥ MHRA Class 1). This module is provided for evaluation / an MHRA
// AI Airlock track ONLY and is NOT for clinical use without conformity assessment. The key
// anti-fabrication control here is GROUNDING: every evidence quote must appear verbatim in the
// source transcript, or the note is rejected.

import { detectInjection } from './phase1.js';

export { detectInjection };

export const SOAP_SYSTEM_PROMPT = [
  'You convert a VERBATIM consultation transcript into a structured SOAP note.',
  'Use ONLY information explicitly present in the transcript. Do NOT infer, assume, or invent.',
  'If a section has no supporting content, write "Not documented".',
  'For every clinically meaningful statement, include a supporting VERBATIM quote from the transcript',
  'in the evidence array (section + exact quote copied from the transcript). Never quote text that is',
  'not present in the transcript. Respond ONLY with JSON matching the provided schema.',
].join(' ');

export function buildSoapPrompt(transcript) {
  return `Transcript:\n"""\n${transcript}\n"""\n\nProduce the SOAP note as JSON per the schema, grounding each section in verbatim quotes from the transcript above.`;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'];

// Structural validation PLUS grounding: every evidence quote must be a substring of the transcript.
// (Format does not guarantee facts — but an ungrounded quote is a concrete, catchable fabrication.)
export function validateSoapNote(value, transcript) {
  const errors = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['output is not a JSON object'] };
  }
  for (const k of SECTIONS) {
    if (typeof value[k] !== 'string' || value[k].trim() === '') errors.push(`${k} must be a non-empty string`);
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    errors.push('evidence must be a non-empty array (grounding is required)');
  } else {
    const hay = norm(transcript);
    for (const e of value.evidence) {
      if (!e || typeof e.quote !== 'string' || !SECTIONS.includes(e.section)) {
        errors.push('each evidence item needs { section, quote }');
        break;
      }
      if (!hay.includes(norm(e.quote))) {
        errors.push(`evidence quote not found in transcript (possible fabrication): "${e.quote.slice(0, 60)}"`);
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}
