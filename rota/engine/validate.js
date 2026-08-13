// Shape validation for the nine rota.* scopes.
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
// rota.access is an object OR null — null is the real, meaningful value for
// "no passcode has ever been set", so it cannot live in OBJECT_SCOPES.
export const NULLABLE_OBJECT_SCOPES = ['access'];
export const ROTA_SCOPES = [...ARRAY_SCOPES, ...OBJECT_SCOPES, ...NULLABLE_OBJECT_SCOPES];

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

// rota.access members. salt/hash/iterations are REQUIRED on a non-null record
// (a config missing its salt can never be unlocked); the rest are optional but
// typed.
export const ACCESS_BOOLEAN_FIELDS = ['enabled', 'strict'];
export const ACCESS_STRING_FIELDS = ['kdf', 'hint', 'updatedAt'];

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
  // rota.access is the passcode gate (rota/engine/access.js). A malformed one
  // is not cosmetic: rota/app/app.js decides whether the app is locked from
  // `enabled`/`strict`, and verifyPasscode() refuses anything whose salt, hash
  // or iteration count is the wrong type — which would leave a machine showing
  // an unlock screen no correct passcode can satisfy.
  const access = scopes.access;
  if (access !== undefined && access !== null) {
    if (!isPlainObject(access)) {
      rejects.push('rota.access must be an object or null.');
    } else {
      if (typeof access.salt !== 'string') rejects.push('rota.access.salt must be a string.');
      if (typeof access.hash !== 'string') rejects.push('rota.access.hash must be a string.');
      if (typeof access.iterations !== 'number' || !Number.isFinite(access.iterations)) {
        rejects.push('rota.access.iterations must be a number.');
      }
      for (const field of ACCESS_BOOLEAN_FIELDS) {
        if (access[field] !== undefined && typeof access[field] !== 'boolean') {
          rejects.push(`rota.access.${field} must be a boolean.`);
        }
      }
      for (const field of ACCESS_STRING_FIELDS) {
        if (access[field] !== undefined && typeof access[field] !== 'string') {
          rejects.push(`rota.access.${field} must be a string.`);
        }
      }
    }
  }

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
