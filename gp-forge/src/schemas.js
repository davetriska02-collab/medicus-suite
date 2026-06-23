// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — JSON schemas for constrained decoding + downstream validation.

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
