// Medicus Suite — Referrals Discovery
//
// Runs on all Medicus pages but activates only on the referrals clinical-audit-
// report page. Watches outbound fetch/XHR calls via PerformanceObserver, re-
// fetches the first matching referrals API URL with the page's own credentials,
// and stores the full response in chrome.storage.local['referrals.discovery']
// so the side-panel Referrals module can read it.

(function() {
  'use strict';

  if (!location.pathname.includes('/referrals/clinical-audit-report')) return;
  if (window.__referralsDiscoveryMounted) return;
  window.__referralsDiscoveryMounted = true;

  const STORAGE_KEY = 'referrals.discovery';
  const API_PATTERN = /\.api\.england\.medicus\.health.*referral/i;
  let captured = false;

  async function capture(url) {
    if (captured) return;
    captured = true;

    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) { captured = false; return; }
      const data = await r.json();
      const discovery = {
        url,
        discoveredAt: new Date().toISOString(),
        sample: data,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: discovery });
      chrome.runtime.sendMessage({ action: 'referrals:discovered' }).catch(() => {});
    } catch (e) {
      captured = false;
      console.warn('[Referrals Discovery] fetch failed:', e.message);
    }
  }

  // Check entries that already exist (page may have loaded before this script ran)
  function scanExisting() {
    const entries = performance.getEntriesByType('resource');
    for (const e of entries) {
      if ((e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') && API_PATTERN.test(e.name)) {
        capture(e.name);
        return true;
      }
    }
    return false;
  }

  // Watch for future entries (SPA navigation, lazy load)
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if ((entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') && API_PATTERN.test(entry.name)) {
        capture(entry.name);
        break;
      }
    }
  });
  observer.observe({ type: 'resource', buffered: true });

  // Immediate scan + retry cadence in case the page renders data asynchronously
  const delays = [1000, 2500, 5000];
  delays.forEach(ms => setTimeout(() => { if (!captured) scanExisting(); }, ms));
})();
