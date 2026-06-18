import React from 'react';
import { NavTab } from '@medicus/design-system';

/** A populated nav bar — one tab active, the accent-triad wash marking selection. */
export const Bar = () => (
  <div
    style={{
      display: 'flex',
      gap: 4,
      background: 'var(--bg-mid)',
      padding: 6,
      borderRadius: 8,
    }}
  >
    <NavTab active>Today</NavTab>
    <NavTab>Sentinel</NavTab>
    <NavTab>Referrals</NavTab>
    <NavTab>Results</NavTab>
  </div>
);

/** The three states side by side: rest, active, and with a leading icon. */
export const States = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <NavTab>Rest</NavTab>
    <NavTab active>Active</NavTab>
    <NavTab icon={<span aria-hidden>◆</span>}>With icon</NavTab>
  </div>
);
