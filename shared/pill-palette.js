// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — organising-swatch key list (single source)
//
// Display / organising colours only — NEVER a clinical status.
// CSS --swatch-* tokens stay in panel.css (stylesheets cannot import JS);
// test-pill-palette-sync.js still pins token names to this list.

'use strict';

(function (global) {
  const SWATCH_KEYS = ['default', 'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink'];
  const TILE_COLOUR_KEYS = SWATCH_KEYS;
  const api = { SWATCH_KEYS, TILE_COLOUR_KEYS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.PillPalette = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
