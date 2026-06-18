import React from 'react';
import { Chip } from '@medicus/design-system';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

/** The clinical RAG triads — red / amber / green — with realistic result labels. */
export const RagSeverity = () => (
  <div style={row}>
    <Chip tone="red">Critical high potassium</Chip>
    <Chip tone="amber">Low eGFR — significant CKD</Chip>
    <Chip tone="green">Within range</Chip>
  </div>
);

/** Non-clinical tones: `info` (accent) for decoration, `violet` for user-defined rules. */
export const Informational = () => (
  <div style={row}>
    <Chip tone="info">Elder (84)</Chip>
    <Chip tone="info">Reviewed today</Chip>
    <Chip tone="violet">Custom rule</Chip>
  </div>
);

/** Hue is never the only signal — pair each chip with a leading glyph. */
export const WithGlyph = () => (
  <div style={row}>
    <Chip tone="red" icon={<span aria-hidden>▲</span>}>
      Urgent result
    </Chip>
    <Chip tone="amber" icon={<span aria-hidden>●</span>}>
      Monitoring due
    </Chip>
    <Chip tone="green" icon={<span aria-hidden>✓</span>}>
      No action
    </Chip>
  </div>
);
