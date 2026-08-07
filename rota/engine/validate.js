// Shape validation for the eight rota.* scopes.
//
// WHY THIS EXISTS: the shared-drive sync file is the hot path. It lives in a
// folder anyone with practice-share access can write, is re-read every 15s and
// is last-writer-wins — yet until now it was saved to chrome.storage.local
// verbatim, while the cold backup path (shared/io/rota-io.js) type-checked
// everything. A single malformed value (e.g. settings.openDays = null) is
// enough to make rota/engine/rules.js throw on every render.
//
// CONTRACT: validateRotaScopes(scopes) RETURNS A REJECTS LIST — an array of
// human-readable strings, one per problem found. An EMPTY array means valid.
// It never throws, so a caller can decide what to do (the app refuses the whole
// remote document and surfaces the reasons).
//
// Every scope is OPTIONAL: a document that omits a scope is valid, it simply
// carries no update for it. Unknown extra keys are ignored (forward-compatible).
//
// PURE: no DOM, no chrome.*, no fetch. Deliberately duplicated — not imported —
// by shared/io/rota-io.js, which is a classic script and cannot import an ES
// module. test-rota-validate.js feeds identical fixtures to both and asserts
// they agree, so the two copies cannot drift apart silently.

// Authoritative shapes: rota/shared/model.js (DEFAULT_SETTINGS) and
// rota/shared/store.js (loadAll).
export const ARRAY_SCOPES = ['staff', 'entries', 'leave', 'rooms', 'swaps', 'audit'];
export const OBJECT_SCOPES = ['demand', 'settings'];
export const ROTA_SCOPES = [...ARRAY_SCOPES, ...OBJECT_SCOPES];

// Settings members the engine indexes into without guarding. openDays is the
// one that bit us: rules.js does settings.openDays.includes(...) directly.
export const SETTINGS_ARRAY_FIELDS = ['openDays', 'bankHolidays', 'sites', 'peakPeriods'];
export const SETTINGS_OBJECT_FIELDS = [
  'dutyRequired',
  'maxSimultaneousLeave',
  'bradfordThresholds',
  'registrarWeights',
  'extraPeriods',
  'demand',
];

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function validateRotaScopes(scopes) {
  const rejects = [];
  if (!isPlainObject(scopes)) {
    rejects.push('scopes must be an object.');
    return rejects;
  }

  for (const field of ARRAY_SCOPES) {
    const value = scopes[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      rejects.push(`rota.${field} must be an array.`);
      continue;
    }
    value.forEach((item, i) => {
      if (!isPlainObject(item)) rejects.push(`rota.${field}[${i}] is not an object.`);
    });
  }

  for (const field of OBJECT_SCOPES) {
    const value = scopes[field];
    if (value === undefined) continue;
    if (!isPlainObject(value)) rejects.push(`rota.${field} must be an object.`);
  }

  // rota.demand carries a days map keyed by ISO date.
  const demand = scopes.demand;
  if (isPlainObject(demand) && demand.days !== undefined && !isPlainObject(demand.days)) {
    rejects.push('rota.demand.days must be an object.');
  }

  // rota.settings is merged over DEFAULT_SETTINGS, so a stored null BEATS the
  // default (spread, not fallback) and reaches the engine. Check the members
  // the engine dereferences.
  const settings = scopes.settings;
  if (isPlainObject(settings)) {
    for (const field of SETTINGS_ARRAY_FIELDS) {
      if (settings[field] !== undefined && !Array.isArray(settings[field])) {
        rejects.push(`rota.settings.${field} must be an array.`);
      }
    }
    for (const field of SETTINGS_OBJECT_FIELDS) {
      if (settings[field] !== undefined && !isPlainObject(settings[field])) {
        rejects.push(`rota.settings.${field} must be an object.`);
      }
    }
  }

  return rejects;
}
