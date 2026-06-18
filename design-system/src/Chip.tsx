import React from 'react';

/**
 * Clinical RAG tone. `red`/`amber`/`green` are the status triads; `info` uses the
 * accent (blue) triad for neutral informational tags; `violet` is the non-clinical
 * custom/user-defined accent (never a clinical status).
 */
export type ChipTone = 'red' | 'amber' | 'green' | 'info' | 'violet';

export interface ChipProps {
  /** RAG tone — drives background (wash), text (ink) and border (line) from one token triad. */
  tone?: ChipTone;
  /** Optional leading glyph. Hue is never the only signal — pair every chip with a glyph or a clear label. */
  icon?: React.ReactNode;
  /** Chip label. */
  children?: React.ReactNode;
}

/**
 * Status chip — the suite's RAG severity tag.
 *
 * Background = triad wash, text = triad ink, border = triad line (see the token
 * canon). Compact, sans, 11px — mirrors the injected clinical-HUD chip.
 */
export function Chip({ tone = 'info', icon, children }: ChipProps): React.JSX.Element {
  return (
    <span className={`mds-chip mds-chip--${tone}`}>
      {icon != null && <span className="mds-chip__icon">{icon}</span>}
      {children}
    </span>
  );
}
