// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Service Worker v1.1.0
// Handles: Sentinel sidebar toggle, options page, Pusher relay, slot polling, storage migration, popout window.

'use strict';

// ── Click the toolbar icon → open the side panel ──────────────────────────────
// Chrome's native mechanism. One line implements the whole feature: with
// side_panel.default_path in the manifest and no default_popup, this makes a
// left-click on the icon open the side panel (same as right-click → Open side
// panel). Called at the top level (runs on every worker start) AND on install
// (the documented belt-and-braces — onInstalled fires on every reload/update).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Load shared modules. Wrapped in try/catch so that an error in any module can
// NEVER fail the service-worker registration (which would discard the worker
// and the line above with it — the cause of "registration failed, status 2").
// importScripts args must be string literals (Chrome resolves them statically).
try {
  importScripts('shared/request-monitor.js');
  importScripts('shared/update-checker.js');
  importScripts('shared/popout-manager.js');
  importScripts('shared/io/practice-profile.js');
} catch (e) {
  console.warn('[Suite] importScripts failed:', e && e.message);
}

// Dependencies for the v2 practice profile engine.
// Each is wrapped individually so a parse error in one never takes out the others.
try {
  importScripts('shared/knowledge-utils.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/knowledge-utils.js failed:', e && e.message);
}
try {
  importScripts('shared/reception-pathway-utils.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/reception-pathway-utils.js failed:', e && e.message);
}
try {
  importScripts('shared/io/sentinel-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/sentinel-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/triage-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/triage-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/submissions-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/submissions-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/slot-counter-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/slot-counter-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/capacity-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/capacity-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/knowledge-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/knowledge-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/reception-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/reception-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/triage-alert-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/triage-alert-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/referrals-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/referrals-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/request-monitor-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/request-monitor-io.js failed:', e && e.message);
}
try {
  importScripts('shared/io/suite-io.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/io/suite-io.js failed:', e && e.message);
}
try {
  importScripts('shared/quiet-mode.js');
} catch (e) {
  console.warn('[Suite] importScripts shared/quiet-mode.js failed:', e && e.message);
}

// Transactional API integration (official Medicus API via our backend proxy).
// The proxy caller credential (txn.callerKey) is only ever read HERE, in the
// service worker — content scripts request patient bundles by message and
// never see the credential. See docs/TRANSACTIONAL-API-INTEGRATION.md.
try {
  importScripts(
    'shared/txn-config.js',
    'shared/txn-transport.js',
    'shared/txn-api.js',
    'shared/fhir-normaliser.js',
    'shared/immunisation-bridge.js',
    'shared/data-source-transactional.js',
    'shared/txn-bundle-cache.js',
    'shared/txn-request-gate.js'
  );
} catch (e) {
  console.warn('[Suite] importScripts txn modules failed:', e && e.message);
}

// Short-TTL cache for patient bundles (see shared/txn-bundle-cache.js). Clinical
// trade-off: 60s of possible staleness is acceptable for a chip/summary read —
// nothing in this integration writes back through the cache, and the
// shadow/hybrid comparison path benefits equally from not re-fetching on every
// render. Cleared below whenever txn config changes (see chrome.storage.onChanged).
const txnBundleCache = TxnBundleCache.createBundleCache({});

// Protects the proxy / Medicus staging from multi-context stampedes — Sweep
// tab batches, the Record tab, the sentinel content script, and shadow-mode
// comparisons can all message this service worker at once. Every txn network
// call (bundle fetch, connection test) runs through this shared gate; cache
// hits in txnFetchPatientBundle are checked BEFORE the gate so they never
// queue behind in-flight network calls.
const txnGate = TxnRequestGate.createRequestGate({});

// ── Transactional feed: patient-bundle fetcher (SW-side; owns the credential) ─

async function txnFetchPatientBundle(patientUuid) {
  const settings = await TxnConfig.readSettings();
  if (!TxnConfig.isTransactionalEnabled(settings.integrationMode)) {
    return { ok: false, error: 'txn integration not enabled' };
  }
  const stored = await chrome.storage.local.get('suite.practiceCode');
  const tenant = stored['suite.practiceCode'] || null;
  if (!tenant) return { ok: false, error: 'practice code not set' };

  // Cache key includes everything that changes the result: a bundle fetched
  // for one tenant/environment must never be served for another, and a config
  // change (e.g. flipping staging <-> prod) must not serve a stale bundle.
  const cacheKey = `${tenant}|${settings.environment}|${patientUuid}`;
  const cached = txnBundleCache.get(cacheKey);
  if (cached) return { ok: true, bundle: cached, cached: true };

  const txnApi = TxnApi.createTxnApi({
    baseUrl: 'https://proxy.invalid', // unused: the proxy transport forwards {method, path} only
    fetchFn: TxnTransport.createProxyTransport({
      proxyUrl: settings.proxyUrl,
      getCallerCredential: async () => settings.callerKey || null,
      getTenant: async () => tenant,
      getEnvironment: async () => settings.environment,
      getUserEmail: async () => settings.userEmail || null,
    }),
  });
  const fetchFromTransactional = SentinelTransactionalSource.createTransactionalSource({
    txnApi,
    normaliseCareRecord: SentinelFhirNormaliser.normaliseCareRecord,
  });
  // Cache check above stays outside the gate — only the actual network call
  // is gated, so a cache hit never waits behind other in-flight requests.
  const bundle = await txnGate.run(() => fetchFromTransactional({ patientUuid }));
  const bridged = SentinelImmunisationBridge.bridgeImmunisations(bundle);
  txnBundleCache.set(cacheKey, bridged); // only successful results are cached — never errors
  return { ok: true, bundle: bridged };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return; // F5: intra-extension only
  if (!msg || msg.action !== 'txn:fetchPatientBundle') return;
  txnFetchPatientBundle(msg.patientUuid)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async sendResponse
});

// Any change to txn.* settings (proxy URL, environment, integration mode,
// caller key, ...) or suite.practiceCode (tenant) can change what a cached
// bundle should contain — e.g. flipping environment or re-pointing the proxy
// must not keep serving a bundle fetched under the old config. Clear the
// whole cache rather than trying to reason about which entries are affected.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const changedKeys = Object.keys(changes);
  if (changedKeys.some((k) => k.startsWith('txn.') || k === 'suite.practiceCode')) {
    txnBundleCache.clear();
  }
});

// ── Transactional feed: connectivity test (SW-side; owns the credential) ────
// Used by the options page "Test connection" button in the API Integration
// section. Unlike txnFetchPatientBundle this runs even when integrationMode is
// 'session' — the whole point is to let a practice validate proxy/caller-key
// config *before* switching into Hybrid or Transactional.
//
// Response shape: { ok: true, latencyMs } | { ok: false, stage, error }
//   stage: 'config' — proxy URL / caller key / practice code missing
//          'proxy'  — proxy unreachable, or rejected the caller key (401/403)
//          'medicus' — proxy reached Medicus but got an upstream error back
// `error` is always a short, plain-English, caller-key-free string.
async function txnTestConnection() {
  const settings = await TxnConfig.readSettings();
  if (!settings.proxyUrl) return { ok: false, stage: 'config', error: 'Proxy URL not set' };
  if (!settings.callerKey) return { ok: false, stage: 'config', error: 'Caller key not set' };

  const stored = await chrome.storage.local.get('suite.practiceCode');
  const tenant = stored['suite.practiceCode'] || null;
  if (!tenant) return { ok: false, stage: 'config', error: 'Practice code not set (Suite section)' };

  const txnApi = TxnApi.createTxnApi({
    baseUrl: 'https://proxy.invalid', // unused: the proxy transport forwards {method, path} only
    fetchFn: TxnTransport.createProxyTransport({
      proxyUrl: settings.proxyUrl,
      getCallerCredential: async () => settings.callerKey || null,
      getTenant: async () => tenant,
      getEnvironment: async () => settings.environment,
      getUserEmail: async () => settings.userEmail || null,
    }),
  });

  const startedAt = Date.now();
  try {
    await txnGate.run(() => txnApi.ping());
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (e) {
    const status = e && e.status;
    if (e && e.isTimeout) {
      // shared/txn-transport.js aborted the call (default 10s) — the proxy is
      // resolvable but not answering, which is different from a wrong URL.
      return { ok: false, stage: 'proxy', error: 'Proxy timed out (no response within 10s)' };
    }
    if (status === 401 || status === 403) {
      return { ok: false, stage: 'proxy', error: 'Proxy rejected the caller key' };
    }
    if (!status) {
      // No HTTP status means we never got a response from the proxy at all
      // (DNS/connection failure, wrong URL, CORS, etc.) — see the plain
      // `throw new Error(...)` cases in shared/txn-transport.js.
      return { ok: false, stage: 'proxy', error: 'Could not reach the proxy (check the URL)' };
    }
    // Proxy responded with some other status — it forwarded an upstream
    // (Medicus) error. Pass through a short, safe message (never the caller key).
    const message = String((e && e.message) || 'Unknown error')
      .trim()
      .slice(0, 200);
    return { ok: false, stage: 'medicus', error: message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return; // F5: intra-extension only
  if (!msg || msg.action !== 'txn:testConnection') return;
  txnTestConnection()
    .then(sendResponse)
    .catch((e) =>
      sendResponse({
        ok: false,
        stage: 'proxy',
        error: String((e && e.message) || e)
          .trim()
          .slice(0, 200),
      })
    );
  return true; // async sendResponse
});

// ── Public SNOMED CT termbrowser API relay (2026-07-29) ──────────────────────
// A plain `fetch()` from content-scripts/problem-description-cleanup.js (the
// "Clean up code" widget's retirement/REPLACED BY/SAME AS check, injected
// into the Medicus page) to termbrowser.nhs.uk was found live — reported by
// the user, real browser console capture — to be blocked by the browser's own
// CORS check, with the request's origin reported as the MEDICUS PAGE's origin
// (https://england.medicus.health), NOT the extension's, despite
// termbrowser.nhs.uk being correctly declared in manifest.json's
// host_permissions. Content-script-issued fetches to a cross-origin host do
// not reliably get the extension's host_permissions CORS bypass in practice —
// a service-worker-issued fetch doesn't have that page/extension origin
// ambiguity at all, so this relays the exact same request through here
// instead. Restricted to the termbrowser.nhs.uk host specifically (checked
// against the PARSED URL's hostname, not a substring/prefix match) — this
// must never become a general-purpose cross-origin fetch relay for arbitrary
// URLs, even though only intra-extension senders can reach it at all (see the
// sender.id guard below, same discipline as every other handler in this file).
const TERMBROWSER_HOST = 'termbrowser.nhs.uk';

async function fetchTermbrowserConcept(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (e) {
    return { ok: false, error: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== TERMBROWSER_HOST) {
    return { ok: false, error: 'URL not permitted' };
  }
  try {
    const resp = await fetch(parsed.toString(), { headers: { Accept: 'application/json, text/plain, */*' } });
    const text = await resp.text();
    return { ok: true, httpOk: resp.ok, status: resp.status, text };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return; // F5: intra-extension only
  if (!msg || msg.action !== 'termbrowser:fetchConcept') return;
  fetchTermbrowserConcept(msg.url)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async sendResponse
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // F5 DEFENCE-IN-DEPTH: reject messages from outside this extension.
  // Only intra-extension contexts (content scripts, panels, options) should
  // be able to trigger service-worker actions; external pages cannot spoof
  // sender.id, so this prevents cross-extension or web-page message injection.
  if (sender.id !== chrome.runtime.id) return;

  if (!msg || !msg.action) return;

  switch (msg.action) {
    // Sentinel: open options page
    case 'openOptionsPage':
      chrome.runtime.openOptionsPage();
      break;

    // Quick-actions composer (content-scripts/reception-quick-actions.js): its ⚙
    // button opens the options page straight onto the requested section. The
    // section name is validated against the same shape options.js's
    // activateSectionFromHash() accepts (#sect-<a-z->) before it is interpolated
    // into the URL — a content script must never be able to steer this anywhere
    // other than a section of our own options page.
    case 'ms-open-options': {
      const section = String((msg && msg.section) || '');
      const suffix = /^[a-z-]+$/.test(section) ? `#sect-${section}` : '';
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') + suffix });
      break;
    }

    // Pusher relay: scheduling channel fired appointments-updated
    case 'pusher:scheduling:appointments-updated':
      broadcastToSidePanel({ type: 'slots:refresh' });
      broadcastToSidePanel({ type: 'waiting:refresh' });
      break;

    default:
      break;
  }
});

// ── Broadcast to side panel ───────────────────────────────────────────────────

function broadcastToSidePanel(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {
    // Side panel may not be open — that's fine.
  });
}

// ── 60-second polling fallback ────────────────────────────────────────────────
// Fires when no Medicus tab is open (Pusher relay won't be active).
// When a Medicus tab IS open the relay fires immediately on appointment changes,
// so this just keeps the panel fresh if the user only has the panel open.
//
// Uses chrome.alarms rather than setInterval so polling survives MV3 service
// worker termination and restart cycles.

const SLOTS_ALARM = 'slots-poll';
const PP_ALARM = 'pp-check';

async function startPolling() {
  const existing = await chrome.alarms.get(SLOTS_ALARM);
  if (existing) return;
  await chrome.alarms.create(SLOTS_ALARM, { periodInMinutes: 1 });
}

async function stopPolling() {
  await chrome.alarms.clear(SLOTS_ALARM);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SLOTS_ALARM) {
    const medicusTabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    if (medicusTabs.length === 0) {
      broadcastToSidePanel({ type: 'slots:refresh' });
    }
  }

  if (alarm.name === PP_ALARM) {
    // Re-apply practice profile if a new version is available on the share
    runStartupTask('pp-check checkAndApply', () => applyPracticeProfile());
    // Also check whether the extension files on disk have been updated
    runStartupTask('pp-check codeUpdate', _checkForCodeUpdate);
  }
});

// Run a startup task without letting a rejection bubble up as an unhandled
// rejection (which would silently swallow e.g. storage-quota failures).
// Returns the (error-swallowed) promise so callers that need ordering can
// `await` it; fire-and-forget callers can ignore the return value as before.
function runStartupTask(label, fn) {
  try {
    return Promise.resolve(fn()).catch((e) => console.warn(`[Suite] ${label} failed:`, e && e.message));
  } catch (e) {
    console.warn(`[Suite] ${label} threw:`, e && e.message);
    return Promise.resolve();
  }
}

// ── Practice Profile periodic alarm ──────────────────────────────────────────
// Re-checks the profile file on a configurable interval (default 15 min,
// clamped 5..1440) so an admin can push a new version without users needing to
// restart the browser. Also used to drive the polite code-update watcher.
// PP_ALARM is declared near SLOTS_ALARM at the top of the alarms block.

// Read apply.checkEveryMinutes from the profile, clamped to 5..1440.
// Returns 15 if the profile is absent or misconfigured.
async function _ppCheckIntervalMinutes() {
  try {
    const profile = await self.PracticeProfile?.fetchProfile();
    const raw = profile?.apply?.checkEveryMinutes;
    if (typeof raw === 'number' && isFinite(raw)) {
      return Math.max(5, Math.min(1440, raw));
    }
  } catch (_) {}
  return 15;
}

async function _schedulePpAlarm() {
  const periodInMinutes = await _ppCheckIntervalMinutes();
  await chrome.alarms.clear(PP_ALARM);
  await chrome.alarms.create(PP_ALARM, { periodInMinutes });
}

// ── Code-update watcher ───────────────────────────────────────────────────────
// Compares manifest.json on disk against the running manifest. When a new
// version is detected, reloads politely: immediately if the machine is idle or
// locked, or deferred to the next alarm cycle if the user is active. After 8
// consecutive deferrals, shows a single notification and keeps deferring.
//
// Notification deduplication is stored in meta.updateNotifiedVersions inside
// suite.practiceProfile so no extra storage key is needed.

let _pendingUpdateVersion = null; // version waiting for an idle window
let _updateDeferCount = 0; // consecutive alarm cycles the user was active

const _VERSION_RE = /^\d+\.\d+\.\d+$/;

async function _checkForCodeUpdate() {
  try {
    let diskManifest;
    try {
      const resp = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
      // On a shared network drive the file may be mid-copy — any error = skip silently
      if (!resp.ok) return;
      diskManifest = await resp.json();
    } catch (_) {
      return; // mid-copy or parse error — skip this cycle
    }

    const diskVersion = diskManifest?.version;
    if (!diskVersion || !_VERSION_RE.test(diskVersion)) return;

    const runningVersion = chrome.runtime.getManifest().version;
    if (diskVersion === runningVersion) {
      // Back to same version (e.g. admin reverted the update) — reset state
      _pendingUpdateVersion = null;
      _updateDeferCount = 0;
      return;
    }

    // Check profile hasn't disabled auto-reload
    try {
      const profile = await self.PracticeProfile?.fetchProfile();
      if (profile?.apply?.autoReloadOnNewVersion === false) return;
    } catch (_) {}

    // Never reload twice for the same version
    if (_pendingUpdateVersion === diskVersion) {
      // Already know about this version — check idle state
    } else {
      _pendingUpdateVersion = diskVersion;
      _updateDeferCount = 0;
    }

    await _attemptPoliteReload(diskVersion);
  } catch (e) {
    console.warn('[Suite] code-update check failed:', e.message);
  }
}

async function _attemptPoliteReload(version) {
  let idleState = 'active';
  try {
    idleState = await new Promise((resolve) => chrome.idle.queryState(120, resolve));
  } catch (_) {}

  if (idleState === 'idle' || idleState === 'locked') {
    console.log('[Suite] Reloading for update to', version, '(machine is', idleState + ')');
    chrome.runtime.reload();
    return;
  }

  // Machine is active — defer
  _updateDeferCount++;
  if (_updateDeferCount >= 8) {
    // Show a notification once per version, then keep deferring
    await _maybeShowUpdateNotification(version);
  }
}

async function _maybeShowUpdateNotification(version) {
  try {
    const r = await chrome.storage.local.get(META_KEY);
    const meta = r[META_KEY] || {};
    const notified = meta.updateNotifiedVersions || [];
    if (notified.includes(version)) return;

    // Skip desktop notification if clinic mode (quiet) is active.
    // Use a nested try so a missing QuietMode never blocks the notification path.
    let quietNow = false;
    try {
      quietNow = (await self.QuietMode?.isQuiet?.()) ?? false;
    } catch (_) {}
    if (!quietNow && chrome.notifications?.create) {
      chrome.notifications.create(`pp_update_${version}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: `Medicus Suite ${version} is ready`,
        message: 'It will update next time this PC is idle.',
        priority: 0,
        silent: true,
      });
    }

    meta.updateNotifiedVersions = [...notified, version].slice(-10);
    await chrome.storage.local.set({ [META_KEY]: meta });
  } catch (_) {}
}

// Needed by _maybeShowUpdateNotification (matches suite.practiceProfile key in practice-profile.js)
const META_KEY = 'suite.practiceProfile';

// Start polling on install/startup
chrome.runtime.onInstalled.addListener(async () => {
  runStartupTask('startPolling', startPolling);
  runStartupTask('runMigration', runMigration);
  // migrateTriageLensConfig + initialiseTriage must fully settle before
  // applyPracticeProfile runs: both eventually write 'triagelens.config', and on
  // a fresh install (nothing in that key yet) initialiseTriage does an
  // unconditional overwrite from bundled defaults.json once its own fetch
  // resolves, with no re-check for a concurrent writer. Unawaited, whichever of
  // it and the practice-profile merge finished last silently won — confirmed
  // live 2026-07-31: a freshly-applied practice profile's oirTests got stomped
  // back to the shipped-empty default because initialiseTriage's write landed
  // after it.
  await runStartupTask('migrateTriageLensConfig', migrateTriageLensConfig);
  await runStartupTask('initialiseTriage', initialiseTriage);
  runStartupTask('initialiseRequestMonitor', () => initialiseRequestMonitor().then(() => pollRequestMonitor()));
  runStartupTask('initialiseUpdateChecker', initialiseUpdateChecker);
  runStartupTask('schedulePpAlarm', _schedulePpAlarm);
  applyPracticeProfile();
});

chrome.runtime.onStartup.addListener(() => {
  runStartupTask('startPolling', startPolling);
  runStartupTask('initialiseRequestMonitor', () => initialiseRequestMonitor().then(() => pollRequestMonitor()));
  runStartupTask('initialiseUpdateChecker', initialiseUpdateChecker);
  runStartupTask('schedulePpAlarm', _schedulePpAlarm);
  // Clear stale popout window ID on browser restart
  chrome.storage.local.remove('popout.windowId');
  applyPracticeProfile();
});

async function applyPracticeProfile() {
  if (!self.PracticeProfile) return;
  try {
    await self.PracticeProfile.checkAndApply();
  } catch (e) {
    console.warn('[Practice Profile] startup apply failed:', e.message);
  }
}

// ── Popout window lifecycle ───────────────────────────────────────────────────

chrome.windows?.onRemoved.addListener(async (windowId) => {
  if (self.PopoutManager) {
    await self.PopoutManager.onWindowRemoved(windowId);
  }
});

chrome.windows?.onBoundsChanged?.addListener(async (win) => {
  if (!self.PopoutManager) return;
  const stored = await chrome.storage.local.get('popout.windowId');
  if (stored['popout.windowId'] === win.id) {
    await self.PopoutManager.saveWindowBounds(win.id);
  }
});

// ── Triage Lens config initialisation ────────────────────────────────────────
// Replicates what the standalone Triage Lens background.js did on install.
// Without this, the options page opens with an empty rules list because
// chrome.storage has no config key.

async function initialiseTriage() {
  try {
    const existing = await chrome.storage.local.get('triagelens.config');
    if (existing['triagelens.config']?.version) return; // already initialised under new key
    // Fall back: check legacy key
    const legacy = await chrome.storage.local.get('config');
    if (legacy?.config?.version) {
      // Migrate legacy key to namespaced key (idempotent)
      await migrateTriageLensConfig();
      return;
    }
    // Neither key exists — initialise from defaults
    const url = chrome.runtime.getURL('defaults.json');
    const defaults = await fetch(url).then((r) => r.json());
    await chrome.storage.local.set({ 'triagelens.config': defaults });
    console.log('[Suite] Triage Lens config initialised from defaults.json');
  } catch (e) {
    console.error('[Suite] Triage Lens config init failed:', e.message);
  }
}

// ── Phase 0: Triage Lens storage key migration ────────────────────────────────
// Migrates unnamespaced `config` key to `triagelens.config`.
// Idempotent: no-op if triagelens.config already exists.
// Deletes the old `config` key only if it looks like a Triage Lens config
// (has a `version` field) to avoid deleting unrelated data.

async function migrateTriageLensConfig() {
  try {
    const existing = await chrome.storage.local.get(['config', 'triagelens.config']);
    if (existing['triagelens.config']) return; // already migrated
    const legacy = existing['config'];
    if (!legacy || typeof legacy !== 'object') return;
    // Only migrate if it looks like a Triage Lens config
    if (!legacy.version && !legacy.rules && !legacy.systemChips) return;
    await chrome.storage.local.set({ 'triagelens.config': legacy });
    // Remove old key — it was Triage Lens config, not submissions config
    // (submissions config carries practiceCode, not version)
    if (!legacy.practiceCode) {
      await chrome.storage.local.remove('config');
    }
    console.log('[Suite] Triage Lens config migrated: config -> triagelens.config');
  } catch (e) {
    console.error('[Suite] Triage Lens config migration failed:', e.message);
  }
}
// Migrates existing standalone extension storage keys to suite-prefixed keys.
// Copy-not-move: originals retained so uninstalling the suite and reinstalling
// the standalone extensions still works.

async function runMigration() {
  const existing = await chrome.storage.local.get([
    // Sentinel
    'sentinelConfig',
    'sentinelRules',
    'sentinelOrgRules',
    // Submissions Tracker
    'config',
    // Slot Counter
    'hiddenTypes',
    // Triage Lens
    // (also uses 'config' — ambiguous; migration skips if already set)
  ]);

  const toSet = {};
  let needsMigration = false;

  if (existing.sentinelConfig) {
    const current = await chrome.storage.local.get(['sentinel.config']);
    if (!current['sentinel.config']) {
      toSet['sentinel.config'] = existing.sentinelConfig;
      needsMigration = true;
    }
  }
  if (existing.sentinelRules) {
    const current = await chrome.storage.local.get(['sentinel.rules']);
    if (!current['sentinel.rules']) {
      toSet['sentinel.rules'] = existing.sentinelRules;
      needsMigration = true;
    }
  }
  if (existing.sentinelOrgRules) {
    const current = await chrome.storage.local.get(['sentinel.orgRules']);
    if (!current['sentinel.orgRules']) {
      toSet['sentinel.orgRules'] = existing.sentinelOrgRules;
      needsMigration = true;
    }
  }
  if (existing.hiddenTypes) {
    const current = await chrome.storage.local.get(['slots.hiddenTypes']);
    if (!current['slots.hiddenTypes']) {
      toSet['slots.hiddenTypes'] = existing.hiddenTypes;
      needsMigration = true;
    }
  }
  // submissions 'config' key is ambiguous with other extensions that also use 'config';
  // migrate only if it looks like a submissions config (has practiceCode field).
  if (existing.config && existing.config.practiceCode !== undefined) {
    const current = await chrome.storage.local.get(['submissions.config']);
    if (!current['submissions.config']) {
      toSet['submissions.config'] = existing.config;
      needsMigration = true;
    }
    // Also store as suite-level practice code if not set
    const sc = await chrome.storage.local.get(['suite.practiceCode']);
    if (!sc['suite.practiceCode'] && existing.config.practiceCode) {
      toSet['suite.practiceCode'] = existing.config.practiceCode;
    }
  }

  if (needsMigration) {
    await chrome.storage.local.set(toSet);
    console.log('[Suite] Storage migration applied:', Object.keys(toSet));
  }
}

// ── Request Monitor: alarm-driven polling + notifications (v1.3) ──────────────
//
// When enabled, polls every cfg.pollSeconds via chrome.alarms. Fires desktop
// notifications for genuinely-new items (diffed against last poll's seenIds).
// Re-evaluates on storage change so toggling on/off takes effect immediately.

const RM_ALARM = 'request-monitor-poll';
const RM_NOTIF_MAP_KEY = 'suite.requestMonitor.notifMap';

// Consecutive-failure counter for RM poll backoff.
// Intentionally in-memory only (resets on worker restart).  MV3 service
// workers are ephemeral; persisting this counter would require extra storage
// overhead and a migration path. A restart is itself a natural back-off
// (the alarm will not fire again until its next scheduled period), so
// reset-on-restart is an honest, simpler choice that avoids a permanent
// "stuck at max backoff" state after a prolonged outage.
let _rmFailCount = 0;

async function initialiseRequestMonitor() {
  if (!self.RequestMonitor) {
    console.warn('[Request Monitor] module not loaded');
    return;
  }
  const cfg = await self.RequestMonitor.getConfig();
  if (cfg.enabled && cfg.assigneeId) {
    _rmFailCount = 0; // reset backoff when config changes / monitor re-initialised
    await scheduleRmAlarm(cfg.pollSeconds);
    // No synchronous pollRequestMonitor() here — the alarm is the single source
    // of polling. MV3 alarms have a ≥30 s minimum delay so one initial poll is
    // fired explicitly only at install/startup via the onInstalled / onStartup
    // handlers, not on every re-init triggered by a config change.
  } else {
    // User disabled the monitor — abort any in-flight requests immediately
    if (self.RequestMonitor) self.RequestMonitor.abortInFlight();
    await chrome.alarms.clear(RM_ALARM);
  }
}

async function scheduleRmAlarm(seconds) {
  const minutes = Math.max(0.5, seconds / 60);
  await chrome.alarms.clear(RM_ALARM);
  // delayInMinutes omitted so the alarm only fires on its period — avoids a
  // second immediate poll racing with the explicit startup poll.
  await chrome.alarms.create(RM_ALARM, { periodInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RM_ALARM) {
    pollRequestMonitor().catch((e) => console.warn('[RM] poll failed:', e.message));
  }
});

// Allowlist of user-config keys that should trigger a re-init.
// NOTE: deliberately excludes state/notifMap/authError — those are written by
// the poller itself and must NOT re-trigger initialiseRequestMonitor or the
// storage write from every poll cycle causes an infinite reinit loop.
const RM_CONFIG_KEYS = new Set([
  'suite.requestMonitor.enabled',
  'suite.requestMonitor.assigneeId',
  'suite.requestMonitor.pollSeconds',
  'suite.requestMonitor.notifyEnabled',
  'suite.requestMonitor.notifySound',
]);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const changedKeys = Object.keys(changes);
  if (changedKeys.some((k) => RM_CONFIG_KEYS.has(k))) {
    // Clear auth back-off so the user can immediately retry after re-configuring
    if (self.RequestMonitor) self.RequestMonitor.clearAuthPause();
    await initialiseRequestMonitor();
  }
});

async function pollRequestMonitor() {
  if (!self.RequestMonitor) return;
  const cfg = await self.RequestMonitor.getConfig();
  if (!cfg.enabled || !cfg.assigneeId) return;

  // Resolve practice code (try tabs first; fall back to storage)
  let code = null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    for (const t of tabs) {
      const m = t.url && t.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (m?.[1]) {
        code = m[1].toLowerCase();
        break;
      }
    }
  } catch (_) {}
  if (!code) {
    const stored = await chrome.storage.local.get('suite.practiceCode');
    code = stored['suite.practiceCode'] || null;
  }
  if (!code) return;

  let pollOk = false;
  try {
    const result = await self.RequestMonitor.pollAll(code, cfg.assigneeId);
    pollOk = true;

    // Broadcast to side panel so it can re-render without waiting for its own poll
    broadcastToSidePanel({ type: 'requestMonitor:refresh' });

    // Notifications: only fire if explicitly enabled, and skip the very first
    // poll after install (otherwise everything currently in the queue would
    // pop a notification — annoying).
    if (cfg.notifyEnabled && !result.isFirstPoll && Object.keys(result.freshByBucket).length > 0) {
      await sendRmNotifications(result.freshByBucket, cfg, code);
    }
  } catch (pollErr) {
    console.warn('[RM] pollAll failed:', pollErr && pollErr.message);
  }

  // Failure backoff: consistent with makePoller in panel.js (up to 8× base period).
  // _rmFailCount resets on worker restart — see comment near its declaration.
  if (pollOk) {
    if (_rmFailCount > 0) {
      _rmFailCount = 0;
      await scheduleRmAlarm(cfg.pollSeconds); // restore base period on first success
    }
  } else {
    _rmFailCount++;
    const level = Math.min(_rmFailCount, 3); // 2^3 = 8 → cap at 8×
    const backoffSeconds = cfg.pollSeconds * Math.pow(2, level);
    console.warn(`[RM] poll failure #${_rmFailCount}, backing off to ${backoffSeconds}s`);
    await scheduleRmAlarm(backoffSeconds);
  }
}

// ── Alert log helper (service-worker context) ─────────────────────────────────
// Prepend entry to suite.alertLog (capped at 50). Counts/labels only — no patient names.
async function _appendAlertLog(entry) {
  try {
    const r = await chrome.storage.local.get('suite.alertLog');
    const log = Array.isArray(r['suite.alertLog']) ? r['suite.alertLog'] : [];
    log.unshift(entry);
    if (log.length > 50) log.length = 50;
    await chrome.storage.local.set({ 'suite.alertLog': log });
  } catch (_) {}
}

async function sendRmNotifications(freshByBucket, cfg, practiceCode) {
  const map = (await chrome.storage.local.get(RM_NOTIF_MAP_KEY))[RM_NOTIF_MAP_KEY] || {};
  const quietNow = (await self.QuietMode?.isQuiet?.()) ?? false;

  for (const [, { bucket, items }] of Object.entries(freshByBucket)) {
    const count = items.length;
    const kind = bucket.taskType.includes('medical') ? 'Medical' : 'Admin';
    const verb = bucket.status === 'new-request' ? 'new request' : 'reply received';
    const title = `${kind}: ${count} ${verb}${count > 1 ? 's' : ''}`;

    // Always append to alert log (even when quiet) — counts/labels only, no patient names.
    // Guard: _appendAlertLog may be absent in test sandboxes that extract this fn in isolation.
    if (typeof _appendAlertLog === 'function') {
      await _appendAlertLog({
        ts: Date.now(),
        channel: 'rm',
        level: bucket.status === 'new-request' ? 'red' : 'amber',
        label: title,
      });
    }

    // Skip desktop notification if clinic mode (quiet) is active.
    if (quietNow) continue;

    // F2 DATA-MINIMISATION: never reveal full patient names in desktop notifications.
    // Notifications are visible in the OS notification centre (outside the extension
    // sandbox) and may be seen by bystanders. Show counts only; initials are used
    // sparingly (items[].patient already holds initials, not full names).
    let message;
    if (count === 1) {
      // Single item: show initials if available, otherwise just "1 item"
      const initials = items[0].patient || '';
      message = initials ? `${initials} — 1 ${verb}` : `1 ${verb}`;
    } else {
      // Multiple items: count only — e.g. "3 new requests"
      message = `${count} ${verb}s`;
    }

    const clickUrl = self.RequestMonitor.buildClickUrl(practiceCode, bucket.taskType, bucket.status, cfg.assigneeId);
    const notifId = `mrm_${bucket.key}_${Date.now()}`;
    map[notifId] = clickUrl;

    chrome.notifications.create(
      notifId,
      {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title,
        message,
        priority: bucket.status === 'new-request' ? 2 : 1,
        requireInteraction: bucket.status === 'new-request',
        silent: !cfg.notifySound,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[RM] notification create failed:', chrome.runtime.lastError.message);
        }
      }
    );
  }

  // Cap notif map at 50 entries
  const entries = Object.entries(map);
  await chrome.storage.local.set({ [RM_NOTIF_MAP_KEY]: Object.fromEntries(entries.slice(-50)) });
}

chrome.notifications?.onClicked.addListener(async (notifId) => {
  if (!notifId.startsWith('mrm_')) return;
  const map = (await chrome.storage.local.get(RM_NOTIF_MAP_KEY))[RM_NOTIF_MAP_KEY] || {};
  const url = map[notifId];
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
  // Remove this entry from the persisted map so it doesn't accumulate stale entries
  delete map[notifId];
  await chrome.storage.local.set({ [RM_NOTIF_MAP_KEY]: map });
});

chrome.notifications?.onClosed.addListener(async (notifId, byUser) => {
  if (!notifId.startsWith('mrm_')) return;
  // Clean up the map entry when the notification is dismissed (by user or programmatically)
  const map = (await chrome.storage.local.get(RM_NOTIF_MAP_KEY))[RM_NOTIF_MAP_KEY] || {};
  if (map[notifId]) {
    delete map[notifId];
    await chrome.storage.local.set({ [RM_NOTIF_MAP_KEY]: map });
  }
});

// ── Update Checker: once-daily GitHub releases poll (v1.3.1) ──────────────────
//
// Runs on install/startup and once every 24h via chrome.alarms. Writes result
// to storage; UI contexts (options page) render an update banner when the
// stored latestVersion is newer than the installed manifest version.

const UPDATE_ALARM = 'update-checker-poll';
const UPDATE_STATUS_KEY = 'suite.updateCheck.status';

// Persist update-check outcome to suite.updateCheck.status.
// Write-only-on-change: reads first and skips the write if status matches,
// to avoid unnecessary storage churn on every alarm tick.
// Schema: { lastSuccess: <ms-timestamp>|null, lastError: { ts, message }|null }
// No patient data — only timestamps and error message strings.
async function _recordUpdateCheckStatus(ok, errorMessage) {
  try {
    const r = await chrome.storage.local.get(UPDATE_STATUS_KEY);
    const prev = r[UPDATE_STATUS_KEY] || {};
    const now = Date.now();
    const next = ok
      ? { lastSuccess: now, lastError: null }
      : { lastSuccess: prev.lastSuccess || null, lastError: { ts: now, message: String(errorMessage || 'unknown') } };
    // Skip write when nothing changed (avoid storage churn on every poll cycle)
    if (prev.lastSuccess === next.lastSuccess && JSON.stringify(prev.lastError) === JSON.stringify(next.lastError))
      return;
    await chrome.storage.local.set({ [UPDATE_STATUS_KEY]: next });
  } catch (_) {
    // Storage failure must never propagate — this is diagnostic metadata only.
  }
}

async function _runUpdateCheck() {
  if (!self.UpdateChecker) return;
  try {
    const res = await self.UpdateChecker.checkForUpdate();
    if (res && !res.skipped) {
      // skipped means within cooldown — don't update status so the last real
      // outcome (success or failure) is preserved for the options-page display.
      await _recordUpdateCheckStatus(res.ok !== false, res.error || null);
    }
  } catch (e) {
    console.warn('[Update Checker] check failed:', e && e.message);
    await _recordUpdateCheckStatus(false, e && e.message);
  }
}

async function initialiseUpdateChecker() {
  if (!self.UpdateChecker) {
    console.warn('[Update Checker] module not loaded');
    return;
  }
  // Schedule daily check
  await chrome.alarms.clear(UPDATE_ALARM);
  await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 60 * 24, delayInMinutes: 1 });
  // Initial check (respects internal 23h cooldown so it won't refetch on every reload)
  _runUpdateCheck();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) {
    _runUpdateCheck();
  }
});
