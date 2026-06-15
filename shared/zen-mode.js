// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Zen (focus) Mode helper
//
// Zen mode is a VISUAL declutter of the panel / pop-out chrome for focused
// work: it hides the brand, collapses nav tab labels to icons, and suppresses
// CALM demand strips so the active module's content dominates the narrow
// (360–420px) surface. State rides on suite.display.zen, so it persists and
// syncs panel↔pop-out via the same storage key as theme/size; the
// html[data-zen] attribute is applied everywhere by shared/display-prefs.js.
//
// Exposes window.ZenMode = { isOn(), set(on), toggle() } and self-wires the
// #zenBtn toggle, Esc-to-exit and Ctrl/Cmd+. toggle on any page that loads it.
//
// CLINICAL-SAFETY BOUNDARY: Zen hides CHROME and CALM/GREEN decoration only.
// It NEVER hides an AMBER or RED clinical strip — the panel.css Zen hide rules
// are scoped so amber/red waiting-room, triage and demand strips always remain
// visible. Like Quiet mode, Zen touches presentation, never clinical signal.

(function (global) {
  'use strict';

  const KEY = 'suite.display';

  async function _read() {
    try {
      const r = await chrome.storage.local.get(KEY);
      return r[KEY] || {};
    } catch (_) {
      return {};
    }
  }

  async function isOn() {
    return !!(await _read()).zen;
  }

  async function set(on) {
    const cur = await _read();
    await chrome.storage.local.set({ [KEY]: { ...cur, zen: !!on } });
  }

  async function toggle() {
    await set(!(await isOn()));
  }

  const api = { isOn, set, toggle };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ZenMode = api;
  }

  // ── Self-wire UI (no-op on pages without #zenBtn / no storage) ──────────────
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;

  function reflect(on) {
    document.querySelectorAll('#zenBtn').forEach((b) => {
      b.classList.toggle('active', !!on);
      b.setAttribute('aria-pressed', String(!!on));
      b.title = on ? 'Exit focus mode (Esc)' : 'Focus mode — declutter chrome (Ctrl+.)';
    });
  }

  function wire() {
    document.querySelectorAll('#zenBtn').forEach((b) => b.addEventListener('click', () => toggle()));

    chrome.storage.local.get(KEY, (r) => reflect(!!(r[KEY] || {}).zen));
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[KEY]) reflect(!!(changes[KEY].newValue || {}).zen);
    });

    // Esc exits Zen — but only when no modal/overlay is open, so a dialog's own
    // Esc (command palette, tab chooser, setup) closes the dialog first.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      isOn().then((on) => {
        if (on) set(false);
      });
    });

    // Ctrl/Cmd + .  toggles Zen — ignored while typing in a field.
    document.addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key !== '.') return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        toggle();
      },
      true
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
