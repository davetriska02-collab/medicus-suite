// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Shared click-to-explain tooltip helper
//
// Self-initialising, document-level popover. Any page that loads this script
// gains a single delegated click/keyboard handler: elements carrying
//   data-tip="<literal text>"   → show that text
//   data-tip-key="<glossary key>" → show window.Glossary.lookup(key)
// get a subtle "help" affordance (cursor + dotted underline) and, on click or
// Enter/Space (when focusable), open a small popover near them. Clicking
// elsewhere, pressing Esc, or re-activating the trigger closes it. Only one
// popover is open at a time.
//
// Defensive by design:
//   - Guards against window.Glossary being absent (shows nothing / raw key).
//   - Elements that only carry data-tip stay harmless if this script never
//     loads — callers ALSO set title= with the same text for native-hover
//     fallback, so no JS is required for the basic explanation to be reachable.
//
// Exposes window.Tip = { show(el), hide(), refresh() }. Callers normally just
// add the data-* attributes and need nothing else.

(function (global) {
  'use strict';

  const doc = global.document;
  if (!doc) return;

  let popover = null; // the single open popover element, or null
  let activeTrigger = null; // the element the popover is anchored to

  // Resolve the explanation text for a trigger element.
  // data-tip wins as a literal; otherwise data-tip-key goes via the glossary.
  function textFor(el) {
    if (!el) return '';
    const literal = el.getAttribute('data-tip');
    if (literal) return literal;
    const key = el.getAttribute('data-tip-key');
    if (!key) return '';
    if (global.Glossary && typeof global.Glossary.lookup === 'function') {
      return global.Glossary.lookup(key) || '';
    }
    return ''; // glossary not loaded — degrade silently (title= still covers it)
  }

  function ensureStyles() {
    if (doc.getElementById('ch-tip-styles')) return;
    const s = doc.createElement('style');
    s.id = 'ch-tip-styles';
    // Popover modelled on .dp-popover (radius/shadow/border/surface tokens).
    s.textContent = `
      [data-tip], [data-tip-key] {
        cursor: help;
        text-decoration: underline dotted;
        text-underline-offset: 2px;
      }
      .ch-tip-pop {
        position: absolute;
        z-index: 99999;
        max-width: 260px;
        background: var(--bg-elev, #fff);
        color: var(--text-2, var(--t2, #334155));
        border: 1px solid var(--border, #cbd5e1);
        border-radius: var(--r-lg, 8px);
        padding: 9px 11px;
        font-family: var(--sans, sans-serif);
        font-size: 12px;
        line-height: 1.4;
        box-shadow: var(--shadow-3, 0 8px 28px rgba(15, 23, 42, 0.14));
      }
    `;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function hide() {
    if (popover && popover.parentNode) popover.parentNode.removeChild(popover);
    popover = null;
    activeTrigger = null;
  }

  // Show a popover for the given trigger element. Re-activating the same
  // trigger closes it (toggle). Only one popover exists at a time.
  function show(el) {
    if (!el) return;
    if (activeTrigger === el) {
      hide();
      return;
    }
    const text = textFor(el);
    if (!text) {
      hide();
      return;
    }
    hide();
    ensureStyles();

    const pop = doc.createElement('div');
    pop.className = 'ch-tip-pop';
    pop.setAttribute('role', 'tooltip');
    pop.textContent = text;
    doc.body.appendChild(pop);

    // Position below the trigger, clamped into the viewport.
    const r = el.getBoundingClientRect();
    const scrollX = global.pageXOffset || doc.documentElement.scrollLeft || 0;
    const scrollY = global.pageYOffset || doc.documentElement.scrollTop || 0;
    let left = r.left + scrollX;
    const top = r.bottom + scrollY + 6;
    const maxLeft = scrollX + (doc.documentElement.clientWidth || global.innerWidth || 0) - pop.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(scrollX + 8, maxLeft);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    popover = pop;
    activeTrigger = el;
  }

  function triggerFrom(target) {
    if (!target || !target.closest) return null;
    return target.closest('[data-tip], [data-tip-key]');
  }

  // Single delegated click listener.
  doc.addEventListener('click', (e) => {
    const trig = triggerFrom(e.target);
    if (trig) {
      e.preventDefault();
      e.stopPropagation();
      show(trig);
      return;
    }
    // Click outside any trigger (and outside the popover) closes it.
    if (popover && !(popover.contains && popover.contains(e.target))) {
      hide();
    }
  });

  // Keyboard: Enter/Space opens on a focused trigger; Esc closes and restores focus.
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (popover) {
        const restore = activeTrigger;
        hide();
        if (restore && typeof restore.focus === 'function') restore.focus();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      const trig = triggerFrom(e.target);
      if (trig) {
        e.preventDefault();
        show(trig);
      }
    }
  });

  // refresh() is a no-op for the delegated model (attributes are read live),
  // but kept on the API so callers that re-render can call it harmlessly.
  function refresh() {}

  global.Tip = { show, hide, refresh };
})(typeof window !== 'undefined' ? window : global);
