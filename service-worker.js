// Medicus Suite — Service Worker v1.0.0
// Handles: Sentinel sidebar toggle, options page, Pusher relay, slot polling, storage migration.

'use strict';

// Load shared modules. Service worker is a classic script — importScripts is
// the way to bring in non-module helpers. RequestMonitor exposes itself on
// `self` (the service worker's global scope).
try {
  importScripts('shared/request-monitor.js');
  importScripts('shared/update-checker.js');
} catch (e) {
  console.warn('[Service Worker] importScripts failed:', e.message);
}

// ── Side panel behaviour ─────────────────────────────────────────────────────

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  switch (msg.action) {
    // Sentinel: toggle sidebar on the active tab
    case 'toggleSidebar':
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (!tab?.id) return;
        chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' }).catch(() => {});
      });
      break;

    // Sentinel: open options page
    case 'openOptionsPage':
      chrome.runtime.openOptionsPage();
      break;

    // Pusher relay: scheduling channel fired appointments-updated
    case 'pusher:scheduling:appointments-updated':
      broadcastToSidePanel({ type: 'slots:refresh' });
      broadcastToSidePanel({ type: 'waiting:refresh' });
      chrome.runtime.sendMessage({ type: 'waiting:refresh' }).catch(() => {});
      break;

    // Triage Lens: open its options (routes to unified options page)
    case 'openTriageLensOptions':
      chrome.runtime.openOptionsPage();
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

async function startPolling() {
  const existing = await chrome.alarms.get(SLOTS_ALARM);
  if (existing) return;
  await chrome.alarms.create(SLOTS_ALARM, { periodInMinutes: 1 });
}

async function stopPolling() {
  await chrome.alarms.clear(SLOTS_ALARM);
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === SLOTS_ALARM) {
    const medicusTabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    if (medicusTabs.length === 0) {
      broadcastToSidePanel({ type: 'slots:refresh' });
    }
  }
});

// Start polling on install/startup
chrome.runtime.onInstalled.addListener(() => {
  startPolling();
  runMigration();
  migrateTriageLensConfig();
  initialiseTriage();
  initialiseRequestMonitor();
  initialiseUpdateChecker();
});

chrome.runtime.onStartup.addListener(() => {
  startPolling();
  initialiseRequestMonitor();
  initialiseUpdateChecker();
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
    const defaults = await fetch(url).then(r => r.json());
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
    'sentinelConfig', 'sentinelRules', 'sentinelOrgRules',
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

async function initialiseRequestMonitor() {
  if (!self.RequestMonitor) {
    console.warn('[Request Monitor] module not loaded');
    return;
  }
  const cfg = await self.RequestMonitor.getConfig();
  if (cfg.enabled && cfg.assigneeId) {
    await scheduleRmAlarm(cfg.pollSeconds);
    pollRequestMonitor();  // initial fetch
  } else {
    await chrome.alarms.clear(RM_ALARM);
  }
}

async function scheduleRmAlarm(seconds) {
  const minutes = Math.max(0.5, seconds / 60);
  await chrome.alarms.clear(RM_ALARM);
  await chrome.alarms.create(RM_ALARM, { periodInMinutes: minutes, delayInMinutes: 0 });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === RM_ALARM) pollRequestMonitor();
});

// Re-evaluate alarm and immediate poll on any RM config change
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some(k => k.startsWith('suite.requestMonitor.'))) {
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
      if (m?.[1]) { code = m[1].toLowerCase(); break; }
    }
  } catch (_) {}
  if (!code) {
    const stored = await chrome.storage.local.get('suite.practiceCode');
    code = stored['suite.practiceCode'] || null;
  }
  if (!code) return;

  const result = await self.RequestMonitor.pollAll(code, cfg.assigneeId);

  // Broadcast to side panel so it can re-render without waiting for its own poll
  broadcastToSidePanel({ type: 'requestMonitor:refresh' });

  // Notifications: only fire if explicitly enabled, and skip the very first
  // poll after install (otherwise everything currently in the queue would
  // pop a notification — annoying).
  if (cfg.notifyEnabled && !result.isFirstPoll && Object.keys(result.freshByBucket).length > 0) {
    await sendRmNotifications(result.freshByBucket, cfg, code);
  }
}

async function sendRmNotifications(freshByBucket, cfg, practiceCode) {
  const map = (await chrome.storage.local.get(RM_NOTIF_MAP_KEY))[RM_NOTIF_MAP_KEY] || {};

  for (const [, { bucket, items }] of Object.entries(freshByBucket)) {
    const count = items.length;
    const kind = bucket.taskType.includes('medical') ? 'Medical' : 'Admin';
    const verb = bucket.status === 'new-request' ? 'new request' : 'reply received';
    const title = `${kind}: ${count} ${verb}${count > 1 ? 's' : ''}`;

    const sample = items.slice(0, 3).map(it => it.patient || 'Unknown patient').join(', ');
    const more = items.length > 3 ? ` +${items.length - 3} more` : '';

    const clickUrl = self.RequestMonitor.buildClickUrl(practiceCode, bucket.taskType, bucket.status, cfg.assigneeId);
    const notifId = `mrm_${bucket.key}_${Date.now()}`;
    map[notifId] = clickUrl;

    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title,
      message: `${sample}${more}`,
      priority: bucket.status === 'new-request' ? 2 : 1,
      requireInteraction: bucket.status === 'new-request',
      silent: !cfg.notifySound,
    });
  }

  // Cap notif map at 50 entries
  const entries = Object.entries(map);
  await chrome.storage.local.set({ [RM_NOTIF_MAP_KEY]: Object.fromEntries(entries.slice(-50)) });
}

chrome.notifications?.onClicked.addListener(async notifId => {
  if (!notifId.startsWith('mrm_')) return;
  const map = (await chrome.storage.local.get(RM_NOTIF_MAP_KEY))[RM_NOTIF_MAP_KEY] || {};
  const url = map[notifId];
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
});

// ── Update Checker: once-daily GitHub releases poll (v1.3.1) ──────────────────
//
// Runs on install/startup and once every 24h via chrome.alarms. Writes result
// to storage; UI contexts (options page) render an update banner when the
// stored latestVersion is newer than the installed manifest version.

const UPDATE_ALARM = 'update-checker-poll';

async function initialiseUpdateChecker() {
  if (!self.UpdateChecker) {
    console.warn('[Update Checker] module not loaded');
    return;
  }
  // Schedule daily check
  await chrome.alarms.clear(UPDATE_ALARM);
  await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 60 * 24, delayInMinutes: 1 });
  // Initial check (respects internal 23h cooldown so it won't refetch on every reload)
  self.UpdateChecker.checkForUpdate().catch(e => console.warn('[Update Checker] check failed:', e.message));
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === UPDATE_ALARM && self.UpdateChecker) {
    self.UpdateChecker.checkForUpdate().catch(e => console.warn('[Update Checker]', e.message));
  }
});
