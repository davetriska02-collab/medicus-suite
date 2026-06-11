// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Tab ordering helper
//
// Pure ordering logic shared by the side panel, the pop-out, and the node test.
// No DOM, no chrome.* — given the shell's default tab ids and the user's stored
// preferred order, returns the final ordered list of ids to render.

'use strict';

// Storage key holding the user's global preferred tab order (array of module ids).
// One key is shared by panel and pop-out; each shell reconciles against its own
// tab set, so the pop-out simply ignores ids it doesn't have (e.g. visualiser).
const STORAGE_KEY = 'suite.tabOrder';

// Reconcile a stored order against a shell's default tab ids.
//   - ids present in storedOrder (in that order) that also exist in defaultIds, then
//   - any defaultIds NOT in storedOrder, in their original default order.
// Ids in storedOrder that aren't in defaultIds are ignored (forward/back-compat:
// a removed module, or one absent from this shell). Never drops or duplicates a
// default id.
function reconcileTabOrder(defaultIds, storedOrder) {
  const defaults = Array.isArray(defaultIds) ? defaultIds : [];
  const stored   = Array.isArray(storedOrder) ? storedOrder : [];
  const defaultSet = new Set(defaults);

  const result = [];
  const seen = new Set();
  for (const id of stored) {
    if (defaultSet.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of defaults) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

export { reconcileTabOrder, STORAGE_KEY };
