// Medicus Suite — Referrals Discovery
//
// Runs on all Medicus pages but activates only on the referrals
// clinical-audit-report page.
//
// Strategy:
//   1. Watch PerformanceObserver for the page's own API calls.
//   2. If the first call returns config/options (has priorityOptions), store
//      it as referrals.config and use it to auto-build and fire the data call
//      with all priorities + statuses selected and the default date range.
//   3. If any call returns actual referral rows (array/object with row data),
//      store as referrals.discovery and notify the side panel.
//   4. Also watch for the page's own user-triggered data call (e.g. after
//      the user clicks Generate) and capture that too.

(function() {
  'use strict';

  if (!location.pathname.includes('/referrals/clinical-audit-report')) return;
  if (window.__referralsDiscoveryMounted) return;
  window.__referralsDiscoveryMounted = true;

  const DISCOVERY_KEY  = 'referrals.discovery';
  const CONFIG_KEY     = 'referrals.config';
  const API_PATTERN    = /\.api\.england\.medicus\.health.*referral/i;

  let configCaptured = false;
  let dataCaptured   = false;

  // ── Config detection ────────────────────────────────────────────────────────

  function isConfigResponse(data) {
    return data && typeof data === 'object' && Array.isArray(data.priorityOptions);
  }

  function isDataResponse(data) {
    if (!data || typeof data !== 'object') return false;
    // Referral list responses typically carry an array of records under a
    // well-known key, or are themselves an array.
    if (Array.isArray(data)) return data.length > 0;
    const keys = Object.keys(data);
    return keys.some(k => Array.isArray(data[k]) && data[k].length > 0 && !['priorityOptions','statusOptions'].includes(k));
  }

  // ── Proactive data fetch using config values ────────────────────────────────
  // Once we have the config endpoint URL and the default date range, try a
  // small set of plausible data endpoint patterns. The first one that returns
  // a non-config JSON response wins.

  async function tryDataEndpoints(configUrl, config) {
    const start = config.defaultReferralStartDate;
    const end   = config.defaultReferralEndDate;

    const priorities = (config.priorityOptions || []).map(o => o.value);
    const statuses   = (config.statusOptions   || []).map(o => o.value);

    // Build query string with all filters open so we get the full dataset
    const params = new URLSearchParams();
    params.append('referralStartDate', start);
    params.append('referralEndDate', end);
    priorities.forEach(p => params.append('priorities[]', p));
    statuses.forEach(s => params.append('statuses[]', s));
    const qs = params.toString();

    // Strip any existing query string from the config URL to get the base
    const base = configUrl.split('?')[0];

    // Candidates: same base URL with params, then common suffix variations
    const candidates = [
      `${base}?${qs}`,
      `${base}/report?${qs}`,
      `${base}/results?${qs}`,
      `${base}/list?${qs}`,
      `${base}/rows?${qs}`,
    ];

    for (const url of candidates) {
      if (dataCaptured) return;
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) continue;
        const data = await r.json();
        if (isConfigResponse(data)) continue;     // same config endpoint, skip
        await storeDataDiscovery(url, data);
        return;
      } catch (_) {
        // try next candidate
      }
    }
  }

  // ── Store helpers ───────────────────────────────────────────────────────────

  async function storeConfig(url, data) {
    if (configCaptured) return;
    configCaptured = true;
    // Skip write if the non-timestamp portion is unchanged (avoids per-page-load storage churn)
    const existing = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
    if (existing && existing.url === url && JSON.stringify(existing.data) === JSON.stringify(data)) {
      tryDataEndpoints(url, data);
      return;
    }
    await chrome.storage.local.set({ [CONFIG_KEY]: { url, discoveredAt: new Date().toISOString(), data } });
    // No runtime message needed: the side panel listens to chrome.storage.onChanged
    // for referrals.config and referrals.discovery and reacts automatically.
    // Immediately try to fetch the actual data using the config values
    tryDataEndpoints(url, data);
  }

  async function storeDataDiscovery(url, data) {
    if (dataCaptured) return;
    dataCaptured = true;
    // Skip write if the non-timestamp portion is unchanged (avoids per-page-load storage churn)
    const existing = (await chrome.storage.local.get(DISCOVERY_KEY))[DISCOVERY_KEY];
    if (existing && existing.url === url && JSON.stringify(existing.sample) === JSON.stringify(data)) {
      return;
    }
    const discovery = { url, discoveredAt: new Date().toISOString(), sample: data };
    await chrome.storage.local.set({ [DISCOVERY_KEY]: discovery });
    // No runtime message needed: the side panel listens to chrome.storage.onChanged
    // for referrals.config and referrals.discovery and reacts automatically.
  }

  // ── Capture from a seen URL ─────────────────────────────────────────────────

  const inFlightUrls = new Set();
  async function captureUrl(url) {
    if (inFlightUrls.has(url)) return;
    inFlightUrls.add(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(url, { credentials: 'include', signal: controller.signal });
      if (!r.ok) return;
      const data = await r.json();
      if (isConfigResponse(data)) {
        await storeConfig(url, data);
      } else if (isDataResponse(data)) {
        await storeDataDiscovery(url, data);
      }
    } catch (e) {
      console.warn('[Referrals Discovery] fetch failed:', url, e.message);
    } finally {
      clearTimeout(timer);
      inFlightUrls.delete(url);
    }
  }

  // ── PerformanceObserver ─────────────────────────────────────────────────────

  function scanEntries(entries) {
    for (const e of entries) {
      if (e.initiatorType !== 'fetch' && e.initiatorType !== 'xmlhttprequest') continue;
      if (!API_PATTERN.test(e.name)) continue;
      // Only capture data endpoint after config is done; config URL often
      // omits query params so exact matching isn't reliable — use heuristic.
      if (dataCaptured) continue;
      captureUrl(e.name);
    }
  }

  const observer = new PerformanceObserver(list => scanEntries(list.getEntries()));
  observer.observe({ type: 'resource', buffered: true });

  // Retry scan at intervals in case the page loads data late
  [1000, 2500, 5000, 10000].forEach(ms =>
    setTimeout(() => { if (!dataCaptured) scanEntries(performance.getEntriesByType('resource')); }, ms)
  );
})();
