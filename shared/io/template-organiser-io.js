// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template organiser IO
//
// Two storage keys, same backup scope:
//   templateOrganiser.config    — practice default (shared install / profile)
//   templateOrganiser.personal  — this person’s overlay on that default
// A practice profile applies config only. It does not write personal.
// Item titles and bodies are not stored here; the canvas reads them from
// Medicus. Import sanitises through TemplateOrganiserCore and never calls
// a Medicus endpoint.

'use strict';

const _TemplateOrganiserCore =
  (typeof self !== 'undefined' && self.TemplateOrganiserCore) ||
  (typeof module !== 'undefined' && typeof require === 'function' ? require('../template-organiser-core.js') : null);

const TEMPLATE_ORGANISER_KEYS = ['templateOrganiser.config', 'templateOrganiser.personal'];

async function templateOrganiserExport() {
  const r = await chrome.storage.local.get(TEMPLATE_ORGANISER_KEYS);
  return {
    config: r['templateOrganiser.config'] ?? null,
    personal: r['templateOrganiser.personal'] ?? null,
  };
}

async function templateOrganiserImport(data) {
  if (!data || typeof data !== 'object') return;
  const Core = _TemplateOrganiserCore;
  if (!Core) throw new Error('Template organiser core not loaded — cannot validate import.');
  const toSet = {};
  if (data.config != null) {
    if (typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw new Error('templateOrganiser.config must be an object.');
    }
    toSet['templateOrganiser.config'] = Core.sanitiseConfig(data.config);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'personal') && data.personal != null) {
    if (typeof data.personal !== 'object' || Array.isArray(data.personal)) {
      throw new Error('templateOrganiser.personal must be an object.');
    }
    toSet['templateOrganiser.personal'] = Core.sanitisePersonal(data.personal);
  }
  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { templateOrganiserExport, templateOrganiserImport, TEMPLATE_ORGANISER_KEYS };
}
