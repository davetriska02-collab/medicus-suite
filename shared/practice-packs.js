// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice feature packs
//
// ONE boolean storage key per pack: suite.<domain>.<pack>. Options → Practice
// features is the practice board. Suite + Signing mirrors of softFlags write
// the same key. Mute is a runtime gate (injectors no-op) — never unregister
// MV3 content_scripts, and never claim the whole extension is off.
//
// Grandfather: chrome that was always-on before these keys existed treats a
// missing key as ON at runtime so upgrade day does not hide buttons. Options
// materialises an explicit true on first load. softFlags stays opt-in
// (missing === OFF). An explicit false always wins.

(function (global) {
  'use strict';
  if (global.PracticePacks) return;

  const KEYS = {
    softFlags: 'suite.signing.softFlags',
    allocateCanvases: 'suite.ui.allocateCanvases',
    contactsCanvas: 'suite.ui.contactsCanvas',
    routineRxButton: 'suite.ui.routineRxButton',
    quickActionsWidget: 'suite.ui.quickActionsWidget',
  };

  const GRANDFATHER_KEYS = [KEYS.allocateCanvases, KEYS.contactsCanvas, KEYS.routineRxButton, KEYS.quickActionsWidget];

  const ALL_PACK_KEYS = [KEYS.softFlags].concat(GRANDFATHER_KEYS);

  const ENVELOPE_ALIASES = {
    'signing.softFlags': 'signingSoftFlags',
    'ui.allocateCanvases': 'allocateCanvases',
    'ui.contactsCanvas': 'contactsCanvas',
    'ui.routineRxButton': 'routineRxButton',
    'ui.quickActionsWidget': 'quickActionsWidget',
  };

  const _raw = Object.create(null);

  function isGrandfather(key) {
    return GRANDFATHER_KEYS.indexOf(key) !== -1;
  }

  function isEnabled(key, stored) {
    if (stored === true) return true;
    if (stored === false) return false;
    return isGrandfather(key);
  }

  function peek(key) {
    return Object.prototype.hasOwnProperty.call(_raw, key) ? isEnabled(key, _raw[key]) : isEnabled(key, undefined);
  }

  function remember(key, stored) {
    _raw[key] = stored;
    return isEnabled(key, stored);
  }

  function read(key) {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(peek(key));
        return;
      }
      try {
        chrome.storage.local.get(key, function (r) {
          resolve(remember(key, r ? r[key] : undefined));
        });
      } catch (_) {
        resolve(peek(key));
      }
    });
  }

  function watch(key, cb) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
      return function () {};
    }
    function onChange(changes, area) {
      if (area && area !== 'local') return;
      if (!changes[key]) return;
      cb(remember(key, changes[key].newValue));
    }
    chrome.storage.onChanged.addListener(onChange);
    return function () {
      try {
        chrome.storage.onChanged.removeListener(onChange);
      } catch (_) {}
    };
  }

  // start when ON, stop when OFF. Missing helper must not hide always-on chrome:
  // callers that skip bindInjector should boot as they do today.
  function bindInjector(key, hooks) {
    hooks = hooks || {};
    var started = false;
    function apply(on) {
      if (on) {
        if (!started) {
          started = true;
          if (typeof hooks.on === 'function') hooks.on();
        } else if (typeof hooks.refresh === 'function') {
          hooks.refresh();
        }
      } else {
        started = false;
        if (typeof hooks.off === 'function') hooks.off();
      }
    }
    read(key).then(apply);
    watch(key, apply);
  }

  async function materializeGrandfather() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return {};
    const r = await chrome.storage.local.get(GRANDFATHER_KEYS);
    const toSet = {};
    GRANDFATHER_KEYS.forEach(function (key) {
      if (r[key] !== true && r[key] !== false) toSet[key] = true;
      remember(key, r[key] === true || r[key] === false ? r[key] : true);
    });
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
    return toSet;
  }

  const api = {
    KEYS,
    GRANDFATHER_KEYS,
    ALL_PACK_KEYS,
    ENVELOPE_ALIASES,
    isGrandfather,
    isEnabled,
    peek,
    remember,
    read,
    watch,
    bindInjector,
    materializeGrandfather,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.PracticePacks = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
