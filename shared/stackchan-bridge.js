// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — StackChan desk-presence bridge (pure mapping + payload).
//
// Suite POSTs { v, cmd, event, severity, ts } to a LAN StackChan. The robot
// never receives patient identifiers, names, NHS numbers, chip labels, or
// free text. Unknown commands fail closed to idle.
//
// Dual-mode:
//   Browser / service worker: self.StackchanBridge
//   Node / test:              require('./shared/stackchan-bridge.js')

(function (global) {
  'use strict';

  const STORAGE_KEY = 'suite.stackchan';
  const PROTOCOL = 1;
  const CMD_PATH = '/cmd';
  const HEALTH_PATH = '/health';
  const TOKEN_HEADER = 'X-StackChan-Token';

  const COMMANDS = Object.freeze(['idle', 'calm', 'alert', 'wait', 'done', 'celebrate', 'listen']);
  const SEVERITIES = Object.freeze(['none', 'green', 'amber', 'red']);

  const EVENTS = Object.freeze({
    SENTINEL: 'sentinel-severity',
    REQUEST_MONITOR: 'requestMonitor-fresh',
    COMPANION: 'companion-role',
    TEST: 'options-test',
    UNKNOWN: 'unknown',
  });

  // Mirror of shared/chip-renderer.js STATUS_COLOUR — kept here so the bridge
  // can run in the service worker without loading the renderer. Keep in lock-step.
  const STATUS_COLOUR = Object.freeze({
    overdue: 'red',
    not_met: 'red',
    stale: 'amber',
    due_soon: 'amber',
    no_data: 'neutral',
    recently_initiated: 'neutral',
    achieved: 'green',
    in_date: 'green',
    alert: 'red',
    caution: 'amber',
    noted: 'neutral',
    vax_due: 'amber',
    vax_given: 'green',
    vax_declined: 'neutral',
  });

  const SEVERITY_RANK = Object.freeze({ red: 0, amber: 1, green: 2, none: 3, neutral: 3 });

  const DEFAULTS = Object.freeze({
    enabled: false,
    baseUrl: '',
    token: '',
    respectQuiet: true,
    hookSentinel: true,
    hookRequestMonitor: true,
    hookCompanion: true,
    timeoutMs: 1500,
  });

  // Keys that must never appear on the wire. Tests probe this list.
  const FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
    'patient',
    'patientName',
    'patientUuid',
    'nhs',
    'nhsNumber',
    'name',
    'dob',
    'label',
    'drug',
    'drugName',
    'text',
    'chips',
    'items',
    'message',
    'summary',
    'comment',
    'body',
  ]);

  function sanitizeCommand(cmd) {
    const c = String(cmd == null ? '' : cmd)
      .toLowerCase()
      .trim();
    return COMMANDS.indexOf(c) >= 0 ? c : 'idle';
  }

  function sanitizeSeverity(sev) {
    const s = String(sev == null ? '' : sev)
      .toLowerCase()
      .trim();
    if (s === 'neutral') return 'none';
    return SEVERITIES.indexOf(s) >= 0 ? s : 'none';
  }

  function sanitizeEvent(event) {
    const e = String(event == null ? '' : event)
      .toLowerCase()
      .trim();
    const allowed = Object.values(EVENTS);
    return allowed.indexOf(e) >= 0 ? e : EVENTS.UNKNOWN;
  }

  function colourFromStatus(status) {
    const key = String(status == null ? '' : status)
      .toLowerCase()
      .trim();
    return STATUS_COLOUR[key] || 'neutral';
  }

  function worstSeverityFromStatuses(statuses) {
    if (!Array.isArray(statuses) || statuses.length === 0) return 'none';
    let worst = 'none';
    let worstRank = SEVERITY_RANK.none;
    for (let i = 0; i < statuses.length; i++) {
      const colour = colourFromStatus(statuses[i]);
      const sev = colour === 'neutral' ? 'none' : colour;
      const rank = SEVERITY_RANK[sev] != null ? SEVERITY_RANK[sev] : SEVERITY_RANK.none;
      if (rank < worstRank) {
        worstRank = rank;
        worst = sev;
      }
    }
    return worst;
  }

  function commandFromSeverity(severity) {
    const sev = sanitizeSeverity(severity);
    if (sev === 'red') return 'alert';
    if (sev === 'amber') return 'wait';
    if (sev === 'green') return 'calm';
    return 'idle';
  }

  function statusesFromChips(chips) {
    if (!Array.isArray(chips)) return [];
    const out = [];
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      if (!c || typeof c !== 'object') continue;
      if (c.status) out.push(c.status);
    }
    return out;
  }

  function mapSentinelEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    if (src.unavailable) {
      return { command: 'idle', severity: 'none', event: EVENTS.SENTINEL };
    }
    let statuses = Array.isArray(src.statuses) ? src.statuses : null;
    if (!statuses) statuses = statusesFromChips(src.chips);
    const severity = worstSeverityFromStatuses(statuses);
    return { command: commandFromSeverity(severity), severity, event: EVENTS.SENTINEL };
  }

  function bucketKeysFrom(input) {
    const src = input && typeof input === 'object' ? input : {};
    if (Array.isArray(src.buckets)) return src.buckets.map(String);
    if (src.freshByBucket && typeof src.freshByBucket === 'object') {
      return Object.keys(src.freshByBucket);
    }
    return [];
  }

  function mapRequestMonitorEvent(input) {
    const keys = bucketKeysFrom(input);
    if (!keys.length) return null;
    const hasMedNew = keys.indexOf('medNew') >= 0;
    const hasAdminNew = keys.indexOf('adminNew') >= 0;
    const hasNew = hasMedNew || hasAdminNew;
    return {
      command: hasMedNew ? 'alert' : 'listen',
      severity: hasNew ? 'red' : 'amber',
      event: EVENTS.REQUEST_MONITOR,
    };
  }

  const ROLE_MAP = Object.freeze({
    clinic: { command: 'idle', severity: 'none' },
    reception: { command: 'listen', severity: 'amber' },
    triage: { command: 'wait', severity: 'amber' },
    nursing: { command: 'calm', severity: 'green' },
  });

  function mapCompanionRole(role) {
    const r = String(role == null ? '' : role)
      .toLowerCase()
      .trim();
    const mapped = ROLE_MAP[r] || ROLE_MAP.clinic;
    return { command: mapped.command, severity: mapped.severity, event: EVENTS.COMPANION };
  }

  function mapSuiteEvent(msg) {
    if (!msg || typeof msg !== 'object') {
      return { command: 'idle', severity: 'none', event: EVENTS.UNKNOWN };
    }
    const src = String(msg.source || msg.type || '')
      .toLowerCase()
      .trim();
    if (src === 'sentinel' || src === 'sentinel-severity' || src === EVENTS.SENTINEL) {
      return mapSentinelEvent(msg);
    }
    if (src === 'requestmonitor' || src === 'requestmonitor-fresh' || src === EVENTS.REQUEST_MONITOR) {
      return mapRequestMonitorEvent(msg);
    }
    if (src === 'companion' || src === 'companion-role' || src === 'companion.role' || src === EVENTS.COMPANION) {
      return mapCompanionRole(msg.role);
    }
    if (src === 'test' || src === 'options-test' || src === 'options.test' || src === EVENTS.TEST) {
      return {
        command: sanitizeCommand(msg.command),
        severity: sanitizeSeverity(msg.severity || 'none'),
        event: EVENTS.TEST,
      };
    }
    return { command: 'idle', severity: 'none', event: EVENTS.UNKNOWN };
  }

  function hookEnabled(cfg, eventCode) {
    if (!cfg) return false;
    if (eventCode === EVENTS.SENTINEL) return cfg.hookSentinel !== false;
    if (eventCode === EVENTS.REQUEST_MONITOR) return cfg.hookRequestMonitor !== false;
    if (eventCode === EVENTS.COMPANION) return cfg.hookCompanion !== false;
    if (eventCode === EVENTS.TEST) return true;
    return true;
  }

  function buildPayload(input) {
    const src = input && typeof input === 'object' ? input : {};
    const ts = typeof src.ts === 'number' && Number.isFinite(src.ts) ? Math.floor(src.ts) : 0;
    const payload = {
      v: PROTOCOL,
      cmd: sanitizeCommand(src.command || src.cmd),
      event: sanitizeEvent(src.event),
      severity: sanitizeSeverity(src.severity),
      ts,
    };
    return payload;
  }

  function payloadHasForbiddenKeys(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const keys = Object.keys(payload);
    for (let i = 0; i < keys.length; i++) {
      if (FORBIDDEN_PAYLOAD_KEYS.indexOf(keys[i]) >= 0) return true;
    }
    return false;
  }

  function normalizeBaseUrl(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    let candidate = s;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      candidate = 'http://' + candidate.replace(/^\/\//, '');
    }
    let url;
    try {
      url = new URL(candidate);
    } catch (_) {
      return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.hostname === '') return '';
    // Reject anything that looks like a credential dump or non-LAN cloud sink.
    // Practices POST to a desk robot on the same LAN. Cloud hosts are allowed
    // only if the user typed them — we do not rewrite.
    const path = url.pathname.replace(/\/+$/, '');
    const origin = url.origin.replace(/\/+$/, '');
    return path && path !== '' && path !== '/' ? origin + path : origin;
  }

  function originFromBaseUrl(raw) {
    const base = normalizeBaseUrl(raw);
    if (!base) return '';
    try {
      return new URL(base).origin;
    } catch (_) {
      return '';
    }
  }

  function buildHeaders(token) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const t = String(token == null ? '' : token).trim();
    if (t) headers[TOKEN_HEADER] = t;
    return headers;
  }

  function buildPost(cfg, payload) {
    const base = normalizeBaseUrl(cfg && cfg.baseUrl);
    if (!base) return null;
    return {
      url: base + CMD_PATH,
      init: {
        method: 'POST',
        headers: buildHeaders(cfg && cfg.token),
        body: JSON.stringify(payload),
      },
    };
  }

  function buildHealthGet(cfg) {
    const base = normalizeBaseUrl(cfg && cfg.baseUrl);
    if (!base) return null;
    return {
      url: base + HEALTH_PATH,
      init: {
        method: 'GET',
        headers: buildHeaders(cfg && cfg.token),
      },
    };
  }

  function clampTimeout(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return DEFAULTS.timeoutMs;
    return Math.min(5000, Math.max(250, Math.floor(n)));
  }

  function shouldDispatch(cfg, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    if (o.isTest) return !!(cfg && normalizeBaseUrl(cfg.baseUrl));
    if (!cfg || cfg.enabled !== true) return false;
    if (!normalizeBaseUrl(cfg.baseUrl)) return false;
    if (cfg.respectQuiet !== false && o.quiet) return false;
    if (o.event && !hookEnabled(cfg, o.event)) return false;
    return true;
  }

  function sanitiseConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: src.enabled === true,
      baseUrl: normalizeBaseUrl(src.baseUrl),
      token: typeof src.token === 'string' ? src.token.trim().slice(0, 128) : '',
      respectQuiet: src.respectQuiet !== false,
      hookSentinel: src.hookSentinel !== false,
      hookRequestMonitor: src.hookRequestMonitor !== false,
      hookCompanion: src.hookCompanion !== false,
      timeoutMs: clampTimeout(src.timeoutMs),
    };
  }

  async function getConfig() {
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      return sanitiseConfig(r[STORAGE_KEY]);
    } catch (_) {
      return sanitiseConfig(null);
    }
  }

  async function setConfig(partial) {
    const cur = await getConfig();
    const next = sanitiseConfig(Object.assign({}, cur, partial && typeof partial === 'object' ? partial : {}));
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  const api = {
    STORAGE_KEY,
    PROTOCOL,
    CMD_PATH,
    HEALTH_PATH,
    TOKEN_HEADER,
    COMMANDS,
    SEVERITIES,
    EVENTS,
    STATUS_COLOUR,
    DEFAULTS,
    FORBIDDEN_PAYLOAD_KEYS,
    sanitizeCommand,
    sanitizeSeverity,
    sanitizeEvent,
    colourFromStatus,
    worstSeverityFromStatuses,
    commandFromSeverity,
    statusesFromChips,
    mapSentinelEvent,
    mapRequestMonitorEvent,
    mapCompanionRole,
    mapSuiteEvent,
    hookEnabled,
    buildPayload,
    payloadHasForbiddenKeys,
    normalizeBaseUrl,
    originFromBaseUrl,
    buildHeaders,
    buildPost,
    buildHealthGet,
    clampTimeout,
    shouldDispatch,
    sanitiseConfig,
    getConfig,
    setConfig,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.StackchanBridge = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
