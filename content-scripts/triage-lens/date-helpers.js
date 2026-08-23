// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Triage Lens — pure date helpers (architecture plan Phase 4.2).
// Loaded as a classic script before content.js. Dual-mode for Node tests.

'use strict';

(function (global) {
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const NOW = () => new Date();

  const parseDate = (s) => {
    if (!s) return null;
    const t = String(s).trim().replace(/\*$/, '');
    let m;
    if ((m = t.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})$/))) return new Date(+m[3], MONTHS[m[2]], +m[1]);
    if ((m = t.match(/^([A-Z][a-z]{2})\s+(\d{4})$/))) return new Date(+m[2], MONTHS[m[1]], 1);
    if ((m = t.match(/^(\d{4})$/))) return new Date(+m[1], 0, 1);
    return null;
  };

  const monthsAgo = (d) => {
    if (!d) return null;
    const n = NOW();
    return (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth());
  };

  const daysAgo = (d) => {
    if (!d) return null;
    return Math.floor((NOW() - d) / 86400000);
  };

  const api = { MONTHS, NOW, parseDate, monthsAgo, daysAgo };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.TriageDateHelpers = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
