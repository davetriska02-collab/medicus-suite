// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared helpers for the panel demand/alert strips (architecture plan Phase 4.1).

'use strict';

export function escStrip(s) {
  // Quote-safe (audit M8, 2026-07-18): escStrip feeds double-quoted attribute
  // contexts (pa-strip pill title carries staff-typed free text) — without
  // quote escaping a '"' broke out of the attribute.
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtHHMM(epochMs) {
  const d = new Date(epochMs);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Prepend entry to suite.alertLog (capped at 50). Never stores patient names —
// counts/labels only. Safe to call from any panel context.
export async function appendAlertLog(entry) {
  try {
    const r = await chrome.storage.local.get('suite.alertLog');
    const log = Array.isArray(r['suite.alertLog']) ? r['suite.alertLog'] : [];
    log.unshift(entry);
    if (log.length > 50) log.length = 50;
    await chrome.storage.local.set({ 'suite.alertLog': log });
  } catch (_) {}
}

// makePoller(fn, baseMs, label) → { start(overrideMs?), stop() }
//
// Runs fn() on a self-scheduling setTimeout chain.  fn() should return true
// (or any truthy value) on success and false on a network/API failure.
// Consecutive failures double the interval (capped at 8× base); a single
// success resets to base.  console.warn fires once per new escalation level.
//
// start(overrideMs) can be called while a tick is in progress (e.g. the RM
// strip restarts itself on config change) — a _scheduledByStart flag prevents
// the in-progress tick from stacking a second setTimeout on top.
export function makePoller(fn, baseMs, label) {
  let _timer = null;
  let _failCount = 0;
  let _currentBaseMs = baseMs;
  let _startedDuring = false; // set if start() called while tick is running

  function _schedule(delayMs) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(_tick, delayMs);
  }

  async function _tick() {
    _timer = null;
    _startedDuring = false;
    const ok = await fn();
    if (_startedDuring) return; // start() rescheduled us already — don't double-schedule
    if (ok === false) {
      _failCount++;
      const level = Math.min(_failCount, 3); // 2^3 = 8 → cap at 8×
      const delay = _currentBaseMs * Math.pow(2, level);
      console.warn(`[${label}] poll failure #${_failCount}, backing off to ${delay}ms`);
      _schedule(delay);
    } else {
      _failCount = 0;
      _schedule(_currentBaseMs);
    }
  }

  return {
    start(overrideMs) {
      _startedDuring = true; // suppress any in-progress tick's post-schedule
      if (overrideMs != null) _currentBaseMs = overrideMs;
      _failCount = 0;
      _schedule(0); // fire first tick immediately
      return this;
    },
    stop() {
      _startedDuring = true;
      if (_timer) {
        clearTimeout(_timer);
        _timer = null;
      }
    },
  };
}
