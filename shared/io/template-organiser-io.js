// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template organiser IO
//
// Practice-tier overlay only: templateOrganiser.config (groups + card order).
// Same backup tier as phrases.config — one practice config object, not a
// personal list. Item titles and bodies are not stored here; the canvas
// reads them from Medicus. Import sanitises through TemplateOrganiserCore
// and never calls a Medicus endpoint.

'use strict';

const _TemplateOrganiserCore =
  (typeof self !== 'undefined' && self.TemplateOrganiserCore) ||
  (typeof module !== 'undefined' && typeof require === 'function' ? require('../template-organiser-core.js') : null);

const TEMPLATE_ORGANISER_KEYS = ['templateOrganiser.config'];

async function templateOrganiserExport() {
  const r = await chrome.storage.local.get(TEMPLATE_ORGANISER_KEYS);
  return {
    config: r['templateOrganiser.config'] ?? null,
  };
}

async function templateOrganiserImport(data) {
  if (!data || typeof data !== 'object') return;
  if (data.config == null) return;
  const Core = _TemplateOrganiserCore;
  if (!Core) throw new Error('Template organiser core not loaded — cannot validate import.');
  if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('templateOrganiser.config must be an object.');
  }
  await chrome.storage.local.set({
    'templateOrganiser.config': Core.sanitiseConfig(data.config),
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { templateOrganiserExport, templateOrganiserImport, TEMPLATE_ORGANISER_KEYS };
}
