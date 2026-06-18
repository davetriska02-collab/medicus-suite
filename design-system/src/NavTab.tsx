import React from 'react';

export interface NavTabProps {
  /**
   * Active (selected) tab. The active state is wash + line from the accent triad;
   * the rest state reserves a transparent border so activation never shifts layout.
   */
  active?: boolean;
  /** Optional leading icon (e.g. a 14px stroke glyph). */
  icon?: React.ReactNode;
  /** Tab label — rendered mono, uppercase, tracked. */
  children?: React.ReactNode;
  /** Click handler. */
  onClick?: () => void;
}

/**
 * Navigation tab — the suite-nav pill.
 *
 * Mono, uppercase, 10px, tracked. Accent-triad active state with a reserved
 * transparent border at rest (no layout shift on selection).
 */
export function NavTab({ active = false, icon, children, onClick }: NavTabProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`mds-nav-tab${active ? ' mds-nav-tab--active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon != null && <span className="mds-nav-tab__icon">{icon}</span>}
      {children}
    </button>
  );
}
