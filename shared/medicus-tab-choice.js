// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Pure policy for "which Medicus tab is this panel talking about?"
//
// Never pick chrome.tabs.query()[0] — that is window order, not the patient
// the clinician was looking at. Docked panel: active Medicus tab, else the
// last tab we successfully resolved, else none. Pop-out may fall back to the
// most recently accessed Medicus tab.

'use strict';

export function isPopOutPath(pathname) {
  return /(^|\/)pop-out\//.test(pathname || '');
}

export function chooseMedicusTab({ activeTab, lastTab, anyMedicusTabs, isPopOut }) {
  const isMedicus = (t) => !!(t && t.url && /medicus\.health/.test(t.url));
  if (isMedicus(activeTab)) return { tab: activeTab, reason: 'active' };
  if (isMedicus(lastTab)) return { tab: lastTab, reason: 'last' };
  if (isPopOut && Array.isArray(anyMedicusTabs) && anyMedicusTabs.length) {
    const sorted = anyMedicusTabs.slice().sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return { tab: sorted[0] || null, reason: 'popout-fallback' };
  }
  return { tab: null, reason: 'none' };
}
