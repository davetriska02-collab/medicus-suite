// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Popout Window Manager
// Manages a single floating chrome.windows.create popup showing pop-out/pop-out.html.
// Exposes window.PopoutManager.

'use strict';

(function (global) {

  const WINDOW_ID_KEY    = 'popout.windowId';
  const WINDOW_STATE_KEY = 'popout.windowState';

  const DEFAULT_WIDTH  = 420;
  const DEFAULT_HEIGHT = 700;
  const DEFAULT_LEFT   = 120;
  const DEFAULT_TOP    = 80;

  async function _getStoredWindowId() {
    const r = await chrome.storage.local.get(WINDOW_ID_KEY);
    return r[WINDOW_ID_KEY] ?? null;
  }

  async function _isWindowAlive(id) {
    if (!id) return false;
    try {
      await chrome.windows.get(id);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function isOpen() {
    const id = await _getStoredWindowId();
    return _isWindowAlive(id);
  }

  async function open() {
    const id = await _getStoredWindowId();
    if (id && await _isWindowAlive(id)) {
      await chrome.windows.update(id, { focused: true });
      return;
    }

    const r = await chrome.storage.local.get(WINDOW_STATE_KEY);
    const saved = r[WINDOW_STATE_KEY] ?? {};

    const win = await chrome.windows.create({
      url:    chrome.runtime.getURL('pop-out/pop-out.html'),
      type:   'popup',
      width:  saved.width  ?? DEFAULT_WIDTH,
      height: saved.height ?? DEFAULT_HEIGHT,
      left:   saved.left   ?? DEFAULT_LEFT,
      top:    saved.top    ?? DEFAULT_TOP,
    });

    await chrome.storage.local.set({ [WINDOW_ID_KEY]: win.id });
  }

  async function close() {
    const id = await _getStoredWindowId();
    if (id && await _isWindowAlive(id)) {
      await chrome.windows.remove(id);
    }
    await chrome.storage.local.remove(WINDOW_ID_KEY);
  }

  async function onWindowRemoved(windowId) {
    const stored = await _getStoredWindowId();
    if (stored === windowId) {
      await chrome.storage.local.remove(WINDOW_ID_KEY);
      // Notify open panels so they can update their button state
      chrome.runtime.sendMessage({ type: 'popout:closed' }).catch(() => {});
    }
  }

  async function saveWindowBounds(windowId) {
    try {
      const win = await chrome.windows.get(windowId);
      await chrome.storage.local.set({
        [WINDOW_STATE_KEY]: { left: win.left, top: win.top, width: win.width, height: win.height },
      });
    } catch (_) {}
  }

  const PopoutManager = { open, close, isOpen, onWindowRemoved, saveWindowBounds };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopoutManager;
  } else {
    global.PopoutManager = PopoutManager;
  }

})(typeof self !== 'undefined' ? self : this);
