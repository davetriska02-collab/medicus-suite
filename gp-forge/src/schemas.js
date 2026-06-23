// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — JSON schemas for constrained decoding + downstream validation.

// PHASE 2 (medical-device-class) — generative SOAP summarisation. Grounded by an evidence array
// whose quotes must appear verbatim in the source transcript (validated downstream in phase2.js).
export const SOAP_NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subjective', 'objective', 'assessment', 'plan', 'evidence'],
  properties: {
    subjective: { type: 'string', minLength: 1, maxLength: 4000 },
    objective: { type: 'string', minLength: 1, maxLength: 4000 },
    assessment: { type: 'string', minLength: 1, maxLength: 4000 },
    plan: { type: 'string', minLength: 1, maxLength: 4000 },
    evidence: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'quote'],
        properties: {
          section: { type: 'string', enum: ['subjective', 'objective', 'assessment', 'plan'] },
          quote: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

// Local-guidance RAG — extractive answer with grounded citations (validated in rag.js).
export const RAG_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'grounded', 'citations'],
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 4000 },
    grounded: { type: 'boolean' },
    citations: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'quote'],
        properties: {
          source: { type: 'string', maxLength: 200 },
          quote: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

export const ADMIN_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'body', 'placeholders'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 8000 },
    // Placeholders the human author must fill in (we never invent patient-specific detail).
    placeholders: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 120 },
      maxItems: 50,
    },
  },
};
