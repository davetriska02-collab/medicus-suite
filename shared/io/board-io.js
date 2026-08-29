// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Note display board IO (backup/restore)
//
// Covers board.config only. The live snapshot is never persisted — it is
// rebuilt from Condor's streams each poll. Import is shape-checked so a
// crafted backup cannot flip a public profile to staff or smuggle unknown
// widgets/messages onto a waiting-room TV (H-067). The kiosk and companion
// also re-run sanitiseConfig() on every load.

(function (global) {
  'use strict';

  const BOARD_KEYS = ['board.config'];
  const PROFILE_IDS = ['waiting-room', 'ops', 'message'];
  const CUSTOM_ID = /^c-[a-z0-9]{4,16}$/;
  const PUBLIC_WIDGETS = ['flap', 'tempo', 'waiting', 'ticker', 'demand', 'clock'];
  const STAFF_WIDGETS = ['pressure', 'triage', 'slots', 'urgent', 'activity'];
  const ALL_WIDGETS = PUBLIC_WIDGETS.concat(STAFF_WIDGETS);
  const MAX_MESSAGE = 80;
  const MAX_NAME = 32;

  function isProfileId(id) {
    return typeof id === 'string' && (PROFILE_IDS.includes(id) || CUSTOM_ID.test(id));
  }

  function isPlainObject(v) {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  }

  function clampMessage(s) {
    return [...String(s == null ? '' : s)]
      .filter((ch) => {
        const c = ch.charCodeAt(0);
        return c >= 32 && c !== 127;
      })
      .join('')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_MESSAGE);
  }

  function sanitiseImported(raw) {
    if (!isPlainObject(raw)) throw new Error('board.config must be an object.');
    const out = { version: 2 };
    if (raw.activeProfileId !== undefined) {
      if (!isProfileId(raw.activeProfileId)) {
        throw new Error('board.config.activeProfileId is not a known profile.');
      }
      out.activeProfileId = raw.activeProfileId;
    }
    if (raw.publicCountsRequests !== undefined) {
      out.publicCountsRequests = raw.publicCountsRequests === true;
    }
    if (raw.copy !== undefined) {
      if (!isPlainObject(raw.copy)) throw new Error('board.config.copy must be an object.');
      out.copy = raw.copy;
    }
    if (raw.pollSeconds !== undefined) {
      const n = Number(raw.pollSeconds);
      if (!Number.isFinite(n)) throw new Error('board.config.pollSeconds must be a number.');
      out.pollSeconds = Math.min(120, Math.max(10, Math.round(n)));
    }
    if (raw.thresholds !== undefined) {
      if (!isPlainObject(raw.thresholds)) throw new Error('board.config.thresholds must be an object.');
      out.thresholds = raw.thresholds;
    }
    if (raw.profiles !== undefined) {
      if (!Array.isArray(raw.profiles)) throw new Error('board.config.profiles must be an array.');
      out.profiles = raw.profiles.map((p, i) => {
        if (!isPlainObject(p)) throw new Error(`board.config.profiles[${i}] must be an object.`);
        if (p.id !== undefined && !isProfileId(p.id)) {
          throw new Error(`board.config.profiles[${i}].id is not a known profile.`);
        }
        const shipped = p.id && PROFILE_IDS.includes(p.id);
        const shippedAudience = p.id === 'ops' ? 'staff' : 'public';
        const audience = shipped ? shippedAudience : p.audience === 'staff' ? 'staff' : 'public';
        const widgets = Array.isArray(p.widgets)
          ? p.widgets.filter((w) => typeof w === 'string' && ALL_WIDGETS.includes(w))
          : undefined;
        const locked = audience === 'public' && widgets ? widgets.filter((w) => PUBLIC_WIDGETS.includes(w)) : widgets;
        const clean = { id: p.id, audience };
        if (locked) clean.widgets = locked;
        if (p.message !== undefined) clean.message = clampMessage(p.message);
        if (p.name !== undefined) clean.name = clampMessage(p.name).slice(0, MAX_NAME);
        return clean;
      });
    }
    return out;
  }

  async function boardExport() {
    const r = await chrome.storage.local.get(BOARD_KEYS);
    return {
      config: r['board.config'] ?? null,
    };
  }

  async function boardImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Note board data must be an object.');
    }
    if (data.config == null) return;
    const clean = sanitiseImported(data.config);
    await chrome.storage.local.set({ 'board.config': clean });
  }

  global.BOARD_KEYS = BOARD_KEYS;
  global.boardExport = boardExport;
  global.boardImport = boardImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { boardExport, boardImport, BOARD_KEYS, sanitiseImported };
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
