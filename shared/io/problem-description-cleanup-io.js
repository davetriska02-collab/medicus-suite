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
//
// CLEARING an override is a DECISION, not an absence — hence the two extra
// entry-level markers this file understands (and shared/preferred-descriptions.js
// deliberately does not, see normaliseWithMarkers below):
//   overrideSetAt:   ISO timestamp of when the override was pinned
//   overrideCleared: ISO timestamp of when the override was explicitly cleared
// Without them `override: incoming.override || local.override` has no way to
// tell "this snapshot never had an override" from "someone deliberately removed
// it", so Clear-override was undone by the next daily practice-profile sync and
// a practice-wide override could never be removed at all. The merge rule is:
// the NEWER of {set at T1, cleared at T2} wins; a set with no timestamp is
// legacy data and counts as older than any explicit clear (fail toward
// honouring the deliberate act). Tombstones are never pruned — they are a few
// bytes each and they are the only record that a removal ever happened.
//
// KNOWN LIMITATION (documented, not silently accepted): recordChoice() in
// shared/preferred-descriptions.js rebuilds an entry as {tally, override}, so a
// later clinical "Clean up code" save on the SAME concept on the SAME machine
// drops that machine's local tombstone. The published tombstone still reaches
// it via the next sync; only a local clear that has not yet been published can
// be lost this way.

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

// pdcShared.normaliseEntry() knows only {tally, override} — the override
// set/cleared markers are this file's own concern (see the header), so every
// place an entry is normalised here has to carry them through explicitly or a
// deliberate clear silently evaporates on the next export/merge.
function normaliseWithMarkers(entry) {
  const norm = pdcShared.normaliseEntry(entry);
  if (entry && typeof entry === 'object') {
    if (typeof entry.overrideSetAt === 'string' && entry.overrideSetAt) norm.overrideSetAt = entry.overrideSetAt;
    if (typeof entry.overrideCleared === 'string' && entry.overrideCleared)
      norm.overrideCleared = entry.overrideCleared;
  }
  return norm;
}

async function problemDescriptionCleanupExport() {
  const r = await chrome.storage.local.get(PDC_KEYS);
  const preferredDescriptions = r['pdc.preferredDescriptions'] || {};
  const conceptRemap = r['pdc.conceptRemap'] || {};
  const out1 = {};
  Object.keys(preferredDescriptions).forEach((key) => {
    out1[key] = normaliseWithMarkers(preferredDescriptions[key]);
  });
  const out2 = {};
  Object.keys(conceptRemap).forEach((key) => {
    out2[key] = normaliseWithMarkers(conceptRemap[key]);
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
  // Override decision markers (see file header) — timestamps, never rendered,
  // but load-bearing for the merge, so reject anything that isn't a string.
  ['overrideSetAt', 'overrideCleared'].forEach((marker) => {
    if (entry[marker] !== undefined && typeof entry[marker] !== 'string') {
      throw new Error(`${fieldName}[${topKey}].${marker} must be an ISO timestamp string.`);
    }
  });
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
//
// opts.tallyMode:
//   'add' (default) — sum the two counts. Correct for a genuine one-off
//     combine of two DISTINCT histories (the manual backup restore this file
//     was designed for — each import happens once, deliberately).
//   'max' — take the larger of the two counts instead of summing. Required
//     when the SAME incoming snapshot may be applied more than once, e.g.
//     the practice-profile shared-folder sync (shared/io/practice-profile.js),
//     which re-checks and re-applies on every published version bump. 'add'
//     there would double/triple-count the same published total on every
//     cycle it re-syncs; 'max' adopts the larger of "what this machine
//     already has" vs "what's published" without ever inflating, and without
//     discarding local growth the machine has made since the last sync.
// opts.overrideWins:
//   'local' (default) — an existing local override is never silently
//     replaced by an import (see file header).
//   'incoming' — the imported override is authoritative, replacing any local
//     one. Used when a practice-profile publish is explicitly marked
//     "enforce for everyone" (replace mode) — the published override
//     represents a deliberate, curated practice decision, same trust model
//     as how the Knowledge module's replace mode already works.
//   NOTE overrideWins only decides a SET-vs-SET conflict. A set-vs-CLEARED
//   conflict is decided by the timestamps instead (see overrideDecision /
//   resolveOverrideDecision) — otherwise "local wins" would make a published
//   removal impossible and "incoming wins" would undo every local Clear.
// opts.acceptIncomingClear (default true): whether an incoming `overrideCleared`
//   tombstone is allowed to remove the existing override. Set false by the
//   UNATTENDED daily publish, for exactly the same reason includeOverride is
//   false there: what's enforced practice-wide must only ever change when a
//   human is present, and un-enforcing is just as much a change as re-pinning.
function pickLastUsed(a, b) {
  // '2026-01-01' > undefined is false, so a naive compare silently DROPPED a
  // real timestamp whenever the other side's row carried none. Prefer whichever
  // side actually has a value; take the later one when both do.
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// What did each side last DECIDE about this entry's override? 'none' means the
// side is silent (never pinned, never cleared) and must not affect the result.
function overrideDecision(entry) {
  const cleared = entry && typeof entry.overrideCleared === 'string' ? entry.overrideCleared : '';
  const setAt = entry && typeof entry.overrideSetAt === 'string' ? entry.overrideSetAt : '';
  const override = entry ? entry.override : null;
  if (override && cleared) {
    // Both markers present (hand-edited backup, or an entry written before the
    // markers existed). The later act is the real decision; an untimestamped
    // set counts as older than any explicit clear.
    return setAt && setAt > cleared ? { kind: 'set', at: setAt, override } : { kind: 'cleared', at: cleared };
  }
  if (override) return { kind: 'set', at: setAt, override };
  if (cleared) return { kind: 'cleared', at: cleared };
  return { kind: 'none', at: '' };
}

function resolveOverrideDecision(localDec, incomingDec, overrideWins, acceptIncomingClear) {
  let inc = incomingDec;
  if (!acceptIncomingClear && inc.kind === 'cleared') inc = { kind: 'none', at: '' };
  if (inc.kind === 'none') return localDec;
  if (localDec.kind === 'none') return inc;
  if (localDec.kind === 'set' && inc.kind === 'set') {
    return overrideWins === 'incoming' ? inc : localDec;
  }
  if (localDec.kind === 'cleared' && inc.kind === 'cleared') {
    return localDec.at >= inc.at ? localDec : inc;
  }
  // One set, one cleared — the newer decision wins outright, regardless of
  // overrideWins. An untimestamped set (legacy data) loses to any clear.
  const setDec = localDec.kind === 'set' ? localDec : inc;
  const clearDec = localDec.kind === 'cleared' ? localDec : inc;
  return setDec.at && setDec.at > clearDec.at ? setDec : clearDec;
}

function mergeField(existing, incoming, opts) {
  const tallyMode = (opts && opts.tallyMode) === 'max' ? 'max' : 'add';
  const overrideWins = (opts && opts.overrideWins) === 'incoming' ? 'incoming' : 'local';
  const acceptIncomingClear = !(opts && opts.acceptIncomingClear === false);
  const merged = {};
  Object.keys(existing).forEach((topKey) => {
    merged[topKey] = normaliseWithMarkers(existing[topKey]);
  });
  Object.keys(incoming).forEach((topKey) => {
    const incomingEntry = normaliseWithMarkers(incoming[topKey]);
    const localEntry = merged[topKey] || pdcShared.emptyEntry();
    const mergedTally = {};
    Object.keys(localEntry.tally).forEach((tallyKey) => {
      mergedTally[tallyKey] = localEntry.tally[tallyKey];
    });
    Object.keys(incomingEntry.tally).forEach((tallyKey) => {
      const inc = incomingEntry.tally[tallyKey];
      const loc = mergedTally[tallyKey];
      const locCount = loc ? loc.count : 0;
      mergedTally[tallyKey] = {
        candidate: inc.candidate !== undefined && inc.candidate !== null ? inc.candidate : loc && loc.candidate,
        count: tallyMode === 'max' ? Math.max(locCount, inc.count) : locCount + inc.count,
        lastUsed: pickLastUsed(loc && loc.lastUsed, inc.lastUsed),
      };
    });
    const decision = resolveOverrideDecision(
      overrideDecision(localEntry),
      overrideDecision(incomingEntry),
      overrideWins,
      acceptIncomingClear
    );
    const out = { tally: mergedTally, override: decision.kind === 'set' ? decision.override : null };
    // Carry only the marker belonging to the winning decision — a superseded
    // one must not linger and re-fight the same conflict on the next merge.
    if (decision.kind === 'set' && decision.at) out.overrideSetAt = decision.at;
    if (decision.kind === 'cleared') out.overrideCleared = decision.at;
    merged[topKey] = out;
  });
  return merged;
}

async function problemDescriptionCleanupImport(data, opts) {
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
      data.preferredDescriptions,
      opts
    );
  }
  if (hasConceptRemap) {
    const existingR = await chrome.storage.local.get('pdc.conceptRemap');
    toSet['pdc.conceptRemap'] = mergeField(existingR['pdc.conceptRemap'] || {}, data.conceptRemap, opts);
  }
  await chrome.storage.local.set(toSet);
}

// Combine what's CURRENTLY published in the shared practice-profile.json for
// this module with this machine's own local snapshot, producing the payload
// to actually publish. Used by the "Publish to shared folder" flow
// (options.js doPublish) — unlike every other module, which is meant to be
// curated by one admin from one machine (so overwriting the shared file with
// the publishing machine's current state is correct), this module
// accumulates from MULTIPLE machines' independent local usage. Publishing a
// raw local snapshot would risk regressing another machine's growth that
// hasn't made it back to THIS machine via a pull yet. Same tallyMode: 'max'
// as the sync-apply path (never inflate on repeated publishes).
//
// opts.includeOverride (default true): whether this machine's local override
// is allowed to become the newly-published one. TALLIES always merge in
// regardless — every machine's genuine picks should count toward the
// collective pool, including ones a reviewer might disagree with. The
// OVERRIDE is different: it's what becomes "enforced for everyone" once
// published, and that should only ever change as a result of a conscious,
// attended publish — never an unattended one (options.js's daily
// maybeAutoPublish passes includeOverride:false). Without this, a machine's
// own incidental local pin (set just from someone using "Clean up code"
// clinically, not as a deliberate practice-wide decision) could silently
// become the enforced choice the next time an unattended sync happens to
// run — nobody decided that, it just rode along.
function problemDescriptionCleanupMergeForPublish(existingModuleData, localModuleData, opts) {
  const existing = existingModuleData && typeof existingModuleData === 'object' ? existingModuleData : {};
  const local = localModuleData && typeof localModuleData === 'object' ? localModuleData : {};
  const includeOverride = !(opts && opts.includeOverride === false);
  // 'incoming' here = local (2nd arg to mergeField) wins; 'local' = existing/published survives untouched.
  // acceptIncomingClear tracks includeOverride: an unattended publish must not
  // un-enforce a practice-wide override any more than it may re-pin one.
  const mergeOpts = {
    tallyMode: 'max',
    overrideWins: includeOverride ? 'incoming' : 'local',
    acceptIncomingClear: includeOverride,
  };
  return {
    preferredDescriptions: mergeField(
      existing.preferredDescriptions || {},
      local.preferredDescriptions || {},
      mergeOpts
    ),
    conceptRemap: mergeField(existing.conceptRemap || {}, local.conceptRemap || {}, mergeOpts),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    problemDescriptionCleanupExport,
    problemDescriptionCleanupImport,
    problemDescriptionCleanupMergeForPublish,
    PDC_KEYS,
  };
}
