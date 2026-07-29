// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Clean up code" preference-learning IO helpers
// Exports/imports TWO storage keys, both using the generic key/candidate
// tally+override shape from shared/preferred-descriptions.js:
//   - pdc.preferredDescriptions[conceptId] — which WORDING this practice
//     prefers for a given SNOMED code (a cosmetic relabel).
//   - pdc.conceptRemap[sourceConceptId] — which OTHER code this practice has
//     actually replaced a given SNOMED code with (a genuine recode —
//     GENERALISED 2026-07-29, real motivating case: "Injection into
//     varicose vein of leg" 449705007 manually replaced with "Injection of
//     varicose vein of lower limb" 449708009).
// See shared/preferred-descriptions.js for the entry shape both keys share.
//
// MERGE, NOT REPLACE, ON IMPORT — deliberately different from most other IO
// files in this repo. The whole point of this module (per the practice's own
// request) is a per-practice signal that accumulates across machines via the
// suite's existing manual export/import backup mechanism — there is no live
// sync. A plain replace-on-import would wipe out whatever this machine has
// locally tallied since the backup being imported was taken, actively
// working against that goal. So import here ADDS incoming tally counts onto
// the existing local ones (per top-level key, per tally key), rather than
// overwriting. CONFLICT RULE for manual overrides: if both the local store
// and the incoming backup have set an override for the same top-level key
// and they disagree, the LOCAL one wins — an admin's already-made decision on
// this machine should not be silently clobbered by importing an older or
// differently-configured snapshot (same "existing local state survives an
// import" discipline as leaflets-io.js's apiKey handling, applied here to
// overrides instead of a secret). Both storage keys share this same merge
// algorithm (mergeEntry below), applied independently.

'use strict';

const PDC_KEYS = ['pdc.preferredDescriptions', 'pdc.conceptRemap'];

// Legitimate key shapes only — everything here is a SNOMED terminology
// identifier, never free text. Top-level keys are conceptIds (all-digit).
// Tally keys and override.key are either a bare descriptionId (axis 1,
// all-digit) or a `targetConceptId|targetDescriptionId` pair (axis 2). A
// backup is untrusted input (it can be hand-edited or come from another
// machine) and these keys/values round-trip straight into
// `data-pdc-*` HTML attributes in options.js — an unvalidated key here is an
// attribute-injection vector (confirmed exploitable pre-fix: a key like
// `" onmouseover="alert(1)" x="` broke out of the attribute). Reject
// anything that doesn't match, same style as the other shape checks below.
const TOP_KEY_RE = /^\d+$/;
const TALLY_KEY_RE = /^\d+(\|\d+)?$/;

const pdcShared =
  typeof module !== 'undefined' && module.exports
    ? require('../preferred-descriptions.js')
    : window.MSPreferredDescriptions;

async function problemDescriptionCleanupExport() {
  const r = await chrome.storage.local.get(PDC_KEYS);
  const preferredDescriptions = r['pdc.preferredDescriptions'] || {};
  const conceptRemap = r['pdc.conceptRemap'] || {};
  const out1 = {};
  Object.keys(preferredDescriptions).forEach((key) => {
    out1[key] = pdcShared.normaliseEntry(preferredDescriptions[key]);
  });
  const out2 = {};
  Object.keys(conceptRemap).forEach((key) => {
    out2[key] = pdcShared.normaliseEntry(conceptRemap[key]);
  });
  return { preferredDescriptions: out1, conceptRemap: out2 };
}

function validateEntryShape(fieldName, topKey, entry) {
  if (!TOP_KEY_RE.test(topKey)) {
    throw new Error(`${fieldName}[${topKey}]: key must be a SNOMED conceptId (digits only).`);
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${fieldName}[${topKey}] must be an object.`);
  }
  if (entry.tally !== undefined) {
    if (typeof entry.tally !== 'object' || entry.tally === null || Array.isArray(entry.tally)) {
      throw new Error(`${fieldName}[${topKey}].tally must be an object.`);
    }
    Object.keys(entry.tally).forEach((tallyKey) => {
      if (!TALLY_KEY_RE.test(tallyKey)) {
        throw new Error(
          `${fieldName}[${topKey}].tally[${tallyKey}]: key must be a descriptionId or conceptId|descriptionId (digits only).`
        );
      }
      const row = entry.tally[tallyKey];
      if (!row || typeof row !== 'object') {
        throw new Error(`${fieldName}[${topKey}].tally[${tallyKey}] must be an object.`);
      }
      if (typeof row.count !== 'number' || row.count < 0) {
        throw new Error(`${fieldName}[${topKey}].tally[${tallyKey}].count must be a non-negative number.`);
      }
      if (row.lastUsed !== undefined && typeof row.lastUsed !== 'string') {
        throw new Error(`${fieldName}[${topKey}].tally[${tallyKey}].lastUsed must be a string.`);
      }
      // candidate is intentionally opaque (its shape differs per axis — a
      // description string+id for preferredDescriptions, a full
      // {conceptId,descriptionId,description} object for conceptRemap) —
      // only reject something structurally impossible (an array).
      if (row.candidate !== undefined && row.candidate !== null && Array.isArray(row.candidate)) {
        throw new Error(`${fieldName}[${topKey}].tally[${tallyKey}].candidate must not be an array.`);
      }
    });
  }
  if (entry.override !== undefined && entry.override !== null) {
    if (typeof entry.override !== 'object' || Array.isArray(entry.override)) {
      throw new Error(`${fieldName}[${topKey}].override must be an object or null.`);
    }
    if (typeof entry.override.key !== 'string' || !entry.override.key) {
      throw new Error(`${fieldName}[${topKey}].override.key is required.`);
    }
    if (!TALLY_KEY_RE.test(entry.override.key)) {
      throw new Error(
        `${fieldName}[${topKey}].override.key must be a descriptionId or conceptId|descriptionId (digits only).`
      );
    }
  }
}

// Shared merge algorithm for one top-level field (preferredDescriptions or
// conceptRemap) — see file header for the "merge not replace" rationale.
function mergeField(existing, incoming) {
  const merged = {};
  Object.keys(existing).forEach((topKey) => {
    merged[topKey] = pdcShared.normaliseEntry(existing[topKey]);
  });
  Object.keys(incoming).forEach((topKey) => {
    const incomingEntry = pdcShared.normaliseEntry(incoming[topKey]);
    const localEntry = merged[topKey] || pdcShared.emptyEntry();
    const mergedTally = {};
    Object.keys(localEntry.tally).forEach((tallyKey) => {
      mergedTally[tallyKey] = localEntry.tally[tallyKey];
    });
    Object.keys(incomingEntry.tally).forEach((tallyKey) => {
      const inc = incomingEntry.tally[tallyKey];
      const loc = mergedTally[tallyKey];
      mergedTally[tallyKey] = {
        candidate: inc.candidate !== undefined && inc.candidate !== null ? inc.candidate : loc && loc.candidate,
        count: (loc ? loc.count : 0) + inc.count,
        lastUsed: loc && loc.lastUsed > inc.lastUsed ? loc.lastUsed : inc.lastUsed,
      };
    });
    merged[topKey] = {
      tally: mergedTally,
      // Local override wins on conflict — see file header.
      override: localEntry.override || incomingEntry.override,
    };
  });
  return merged;
}

async function problemDescriptionCleanupImport(data) {
  if (!data || typeof data !== 'object') return;
  const hasPreferredDescriptions = data.preferredDescriptions !== undefined;
  const hasConceptRemap = data.conceptRemap !== undefined;
  if (!hasPreferredDescriptions && !hasConceptRemap) return;

  if (hasPreferredDescriptions) {
    if (
      !data.preferredDescriptions ||
      typeof data.preferredDescriptions !== 'object' ||
      Array.isArray(data.preferredDescriptions)
    ) {
      throw new Error('preferredDescriptions must be an object.');
    }
    Object.keys(data.preferredDescriptions).forEach((key) =>
      validateEntryShape('preferredDescriptions', key, data.preferredDescriptions[key])
    );
  }
  if (hasConceptRemap) {
    if (!data.conceptRemap || typeof data.conceptRemap !== 'object' || Array.isArray(data.conceptRemap)) {
      throw new Error('conceptRemap must be an object.');
    }
    Object.keys(data.conceptRemap).forEach((key) => validateEntryShape('conceptRemap', key, data.conceptRemap[key]));
  }

  const toSet = {};
  if (hasPreferredDescriptions) {
    const existingR = await chrome.storage.local.get('pdc.preferredDescriptions');
    toSet['pdc.preferredDescriptions'] = mergeField(
      existingR['pdc.preferredDescriptions'] || {},
      data.preferredDescriptions
    );
  }
  if (hasConceptRemap) {
    const existingR = await chrome.storage.local.get('pdc.conceptRemap');
    toSet['pdc.conceptRemap'] = mergeField(existingR['pdc.conceptRemap'] || {}, data.conceptRemap);
  }
  await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { problemDescriptionCleanupExport, problemDescriptionCleanupImport, PDC_KEYS };
}
