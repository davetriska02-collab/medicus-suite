/**
 * Occupancy look (colour / size / highlight).
 *
 * Practice-set in Options, user-tweakable by clicking the live strip.
 * Stored at `suite.display.presenceLook` (merge-patch; do not clobber
 * theme / size / colourblind / zen).
 *
 * Default is fluoro yellow + medium + fill — the previous accent-blue
 * wash read as chrome, not as an occupant alert.
 *
 * Node: `require('../shared/presence-look.js')`.
 * Browser: `window.PresenceLook`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PresenceLook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLOURS = {
    fluoro: {
      label: 'Fluoro yellow',
      wash: '#fff44a',
      border: '#c9b400',
      text: '#1a1600',
      quiet: '#3d3400',
    },
    amber: {
      label: 'Amber',
      wash: '#fde68a',
      border: '#d97706',
      text: '#3d2a00',
      quiet: '#5c4300',
    },
    blue: {
      label: 'Note blue',
      wash: '#dbeafe',
      border: '#2563eb',
      text: '#0f2744',
      quiet: '#1e3a5f',
    },
    lime: {
      label: 'Lime',
      wash: '#bef264',
      border: '#65a30d',
      text: '#1a2600',
      quiet: '#365314',
    },
    pink: {
      label: 'Hot pink',
      wash: '#fbcfe8',
      border: '#db2777',
      text: '#4a0d2a',
      quiet: '#831843',
    },
    slate: {
      label: 'Slate',
      wash: '#e2e8f0',
      border: '#475569',
      text: '#0f172a',
      quiet: '#334155',
    },
  };

  const SIZES = {
    compact: { label: 'Compact', padY: '4px', padX: '8px', font: '12px', avatar: '18px' },
    medium: { label: 'Medium', padY: '7px', padX: '10px', font: '13.5px', avatar: '22px' },
    large: { label: 'Large', padY: '10px', padX: '12px', font: '15px', avatar: '26px' },
  };

  const HIGHLIGHTS = {
    fill: { label: 'Fill + border' },
    edge: { label: 'Left edge only' },
    flash: { label: 'Fill + pulse' },
  };

  const WEIGHTS = {
    bold: { label: 'Bold headline' },
    regular: { label: 'Regular headline' },
  };

  const DEFAULTS = {
    colour: 'fluoro',
    size: 'medium',
    highlight: 'fill',
    avatars: true,
    quiet: true,
    weight: 'bold',
  };

  function sanitizePresenceLook(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      colour: COLOURS[src.colour] ? src.colour : DEFAULTS.colour,
      size: SIZES[src.size] ? src.size : DEFAULTS.size,
      highlight: HIGHLIGHTS[src.highlight] ? src.highlight : DEFAULTS.highlight,
      avatars: src.avatars !== false,
      quiet: src.quiet !== false,
      weight: WEIGHTS[src.weight] ? src.weight : DEFAULTS.weight,
    };
  }

  function lookCssVars(look) {
    const safe = sanitizePresenceLook(look);
    const c = COLOURS[safe.colour];
    const s = SIZES[safe.size];
    return {
      '--ms-tp-wash': c.wash,
      '--ms-tp-border': c.border,
      '--ms-tp-text': c.text,
      '--ms-tp-quiet': c.quiet,
      '--ms-tp-pad-y': s.padY,
      '--ms-tp-pad-x': s.padX,
      '--ms-tp-font': s.font,
      '--ms-tp-avatar': s.avatar,
    };
  }

  function applyLookToEl(el, look) {
    if (!el) return sanitizePresenceLook(look);
    const safe = sanitizePresenceLook(look);
    const vars = lookCssVars(safe);
    Object.keys(vars).forEach((k) => el.style.setProperty(k, vars[k]));
    el.dataset.lookColour = safe.colour;
    el.dataset.lookSize = safe.size;
    el.dataset.lookHighlight = safe.highlight;
    el.dataset.lookAvatars = safe.avatars ? '1' : '0';
    el.dataset.lookQuiet = safe.quiet ? '1' : '0';
    el.dataset.lookWeight = safe.weight;
    return safe;
  }

  return {
    COLOURS,
    SIZES,
    HIGHLIGHTS,
    WEIGHTS,
    DEFAULTS,
    sanitizePresenceLook,
    lookCssVars,
    applyLookToEl,
  };
});
