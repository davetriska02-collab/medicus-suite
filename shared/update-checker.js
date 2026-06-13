// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Update Checker (v1.3.1)
//
// Polls the GitHub releases API once a day to detect new versions.
// Writes result to storage. UI contexts read the state and render a banner
// when an update is available.
//
// Storage keys:
//   suite.update.latestVersion  string — e.g. "1.3.1"  (no leading "v")
//   suite.update.releaseUrl     string — GitHub release page URL
//   suite.update.releaseNotes   string — release body (markdown)
//   suite.update.downloadUrl    string — direct zip asset URL (if attached)
//   suite.update.checkedAt      number — Unix ms timestamp of last successful check
//   suite.update.error          string — error message from last failed check
//
// Hardcoded for Dave's repo. If you fork this, change REPO_OWNER and REPO_NAME.

(function(global) {
  'use strict';

  // Points at the PUBLIC shopfront repo (where releases live and users
  // download from), not the private workshop repo. See docs/internal/PUBLIC-SYNC-SETUP.md.
  const REPO_OWNER = 'davetriska02-collab';
  const REPO_NAME = 'medicus-suite-public';
  const RELEASES_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

  // Don't recheck more often than this (don't hammer GitHub even if multiple
  // contexts call us). 23h chosen so a daily alarm always finds it stale.
  const MIN_CHECK_INTERVAL_MS = 23 * 60 * 60 * 1000;

  const STORAGE_KEYS = {
    latestVersion: 'suite.update.latestVersion',
    releaseUrl:    'suite.update.releaseUrl',
    releaseNotes:  'suite.update.releaseNotes',
    downloadUrl:   'suite.update.downloadUrl',
    checkedAt:     'suite.update.checkedAt',
    error:         'suite.update.error',
    etag:          'suite.update.etag',
  };

  // ── URL allowlist guard ─────────────────────────────────────────────────────
  // Accepts only HTTPS URLs whose hostname is github.com, api.github.com, or
  // any *.githubusercontent.com subdomain. Returns '' for anything else.
  function allowGithubUrl(raw) {
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') return '';
      const h = u.hostname;
      if (h === 'github.com' || h === 'api.github.com' || h.endsWith('.githubusercontent.com')) {
        return raw;
      }
    } catch (_) { /* unparseable */ }
    return '';
  }

  // ── Semver comparison ───────────────────────────────────────────────────────
  // Returns 1 if a > b, -1 if a < b, 0 if equal. Strips leading "v". Treats
  // missing segments as 0. Does not handle prerelease tags (we don't use them).

  function normaliseVersion(v) {
    if (!v) return '';
    return String(v).trim().replace(/^v/i, '');
  }

  function compareVersions(a, b) {
    const pa = normaliseVersion(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = normaliseVersion(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function isNewer(latest, current) {
    return compareVersions(latest, current) > 0;
  }

  // ── Check for update ────────────────────────────────────────────────────────
  // force=true bypasses the 23h cooldown.

  async function checkForUpdate({ force = false, fetchImpl } = {}) {
    const _fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!_fetch) return { ok: false, error: 'No fetch impl' };

    // Respect cooldown unless forced
    if (!force) {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.checkedAt);
      const lastCheck = stored[STORAGE_KEYS.checkedAt] || 0;
      if (Date.now() - lastCheck < MIN_CHECK_INTERVAL_MS) {
        return { ok: true, skipped: true, reason: 'Within cooldown window' };
      }
    }

    // Build request headers; add If-None-Match if we have a stored ETag
    const stored = await chrome.storage.local.get([STORAGE_KEYS.etag]);
    const storedEtag = stored[STORAGE_KEYS.etag] || null;
    const reqHeaders = { 'Accept': 'application/vnd.github+json' };
    if (storedEtag) reqHeaders['If-None-Match'] = storedEtag;

    let raw;
    try {
      const r = await _fetch(RELEASES_URL, { headers: reqHeaders });

      if (r.status === 304) {
        // Not modified — our cached data is still current; just refresh checkedAt
        await chrome.storage.local.set({ [STORAGE_KEYS.checkedAt]: Date.now() });
        return { ok: true, notModified: true, reason: 'ETag match — release unchanged' };
      }

      if (!r.ok) {
        const err = `GitHub API HTTP ${r.status}`;
        const toWrite = { [STORAGE_KEYS.error]: err };
        // On rate-limit (403/429) also write checkedAt so the 23h cooldown engages
        // and we don't hammer GitHub's API on every subsequent alarm fire.
        if (r.status === 403 || r.status === 429) {
          toWrite[STORAGE_KEYS.checkedAt] = Date.now();
        }
        await chrome.storage.local.set(toWrite);
        return { ok: false, error: err };
      }

      // Capture the ETag for future conditional requests
      const newEtag = r.headers && r.headers.get ? r.headers.get('etag') : null;
      if (newEtag) {
        await chrome.storage.local.set({ [STORAGE_KEYS.etag]: newEtag });
      }

      raw = await r.json();
    } catch (e) {
      const err = `Network: ${e.message || e}`;
      await chrome.storage.local.set({ [STORAGE_KEYS.error]: err });
      return { ok: false, error: err };
    }

    const tag = raw?.tag_name || '';
    const latestVersion = normaliseVersion(tag);
    // allowGithubUrl guards both URLs — releaseUrl is rendered as a clickable link,
    // downloadUrl is stored and offered for download; both must come from GitHub.
    const releaseUrl = allowGithubUrl(raw?.html_url || '');
    const releaseNotes = raw?.body || '';
    // Prefer a zip asset if one is attached; fall back to the auto-generated source zip
    const zipAsset = (raw?.assets || []).find(a => /\.zip$/i.test(a?.name || ''));
    const downloadUrl = allowGithubUrl(zipAsset?.browser_download_url || raw?.zipball_url || '');

    await chrome.storage.local.set({
      [STORAGE_KEYS.latestVersion]: latestVersion,
      [STORAGE_KEYS.releaseUrl]:    releaseUrl,
      [STORAGE_KEYS.releaseNotes]:  releaseNotes,
      [STORAGE_KEYS.downloadUrl]:   downloadUrl,
      [STORAGE_KEYS.checkedAt]:     Date.now(),
      [STORAGE_KEYS.error]:         null,
    });

    return { ok: true, latestVersion, releaseUrl, releaseNotes, downloadUrl };
  }

  // ── State accessors for UI ──────────────────────────────────────────────────

  async function getState() {
    const r = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    return {
      latestVersion: r[STORAGE_KEYS.latestVersion] || null,
      releaseUrl:    r[STORAGE_KEYS.releaseUrl]    || null,
      releaseNotes:  r[STORAGE_KEYS.releaseNotes]  || null,
      downloadUrl:   r[STORAGE_KEYS.downloadUrl]   || null,
      checkedAt:     r[STORAGE_KEYS.checkedAt]     || null,
      error:         r[STORAGE_KEYS.error]         || null,
      etag:          r[STORAGE_KEYS.etag]          || null,
    };
  }

  // Returns the installed version from the manifest, or null if not in an
  // extension context.
  function getInstalledVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return null;
    }
  }

  // Returns true iff a newer version is known to be available.
  async function isUpdateAvailable() {
    const state = await getState();
    const installed = getInstalledVersion();
    if (!state.latestVersion || !installed) return false;
    return isNewer(state.latestVersion, installed);
  }

  const api = {
    REPO_OWNER,
    REPO_NAME,
    RELEASES_URL,
    STORAGE_KEYS,
    allowGithubUrl,
    normaliseVersion,
    compareVersions,
    isNewer,
    checkForUpdate,
    getState,
    getInstalledVersion,
    isUpdateAvailable,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.UpdateChecker = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
