// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — record delta surveillance (ported from the private
// composite-features prototype: delta/record-delta.mjs)
//
// "What changed since we last looked." Two normalised-record snapshots of the
// same patient in, a list of clinically-meaningful CHANGE EVENTS out:
//   new allergy · new diagnosis · medication started/stopped · new immunisation.
//
// This is the substrate for the Record tab's "Since last visit" section (see
// side-panel/modules/record/record.js) — it turns a whole-record diff into a
// short, human list of what changed since the clinician last opened this
// patient's record.
//
// PRIVACY: the persisted state is a FINGERPRINT — a per-item stable key hashed
// to a short hex digest, NEVER the clinical content. Fingerprints can be
// stored between runs to detect change over time without retaining any PHI.
// The change EVENTS themselves (returned in-memory to drive the section) do
// carry labels — the caller decides whether to surface them, and must not
// persist them (record.js stores only { keys, at }, nothing else).
//
// PORT NOTE: the original (Node/Cloudflare-worker) implementation hashed with
// node:crypto's sha256. This file also has to run in the extension's browser
// side-panel (no node:crypto there), so the digest below uses a small,
// dependency-free synchronous string hash (two independently-seeded 32-bit
// FNV-1a passes, concatenated into a 16-hex-char digest) instead — kept
// IDENTICAL in both the Node test run and the browser so the one code path is
// exercised everywhere. This changes nothing about the privacy property the
// original claimed: that property comes from persisting a short digest
// instead of the clinical text, not from the specific algorithm (the
// item-identity keyspace — e.g. SNOMED codes, drug names — is small/
// enumerable regardless of hash choice). The diffing LOGIC below — itemKey
// identity, medication dose-insensitivity, ranking, added/removed semantics —
// is preserved unchanged from the source.

(function (global) {
  'use strict';

  const norm = (s) =>
    String(s || '')
      .trim()
      .toLowerCase();

  // Small, dependency-free 32-bit FNV-1a pass — see PORT NOTE above.
  function _hash32(str, seed) {
    let hVal = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      hVal = (hVal ^ str.charCodeAt(i)) >>> 0;
      hVal = Math.imul(hVal, 16777619) >>> 0; // FNV prime
    }
    return hVal >>> 0;
  }
  // h(s) -> 16-char lowercase hex digest. Deterministic; not the clinical text.
  function h(s) {
    const str = String(s);
    const a = _hash32(str, 0x811c9dc5); // FNV offset basis
    const b = _hash32(str, 0x9e3779b9); // second, differently-seeded pass
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }

  // A stable identity key for each record item (what makes it "the same item").
  // Medication identity is the drug name only (so a dose change reads as the
  // same med, not a stop+start); allergy/problem/immunisation by code||label.
  function itemKey(kind, item) {
    // Medication identity is the DRUG NAME ONLY (strip strength/form at the first
    // digit) so a dose change reads as the same med, not a stop+start. e.g.
    // "Metformin 500mg tablets" and "Metformin 1g tablets" -> "med:metformin".
    if (kind === 'medication') {
      return `med:${norm(item.name || item.label)
        .replace(/\s*\d.*$/, '')
        .trim()}`;
    }
    if (kind === 'allergy') return `alg:${item.code || norm(item.label)}`;
    if (kind === 'problem') return `prb:${item.code || norm(item.label)}`;
    if (kind === 'immunisation') return `imm:${item.code || norm(item.label)}`;
    return `${kind}:${norm(item.label || item.name)}`;
  }

  // fingerprint(bundle) -> { keys:Set<hashedKey>, labels:Map<hashedKey,label> }
  // keys are safe to persist (hashed, no PHI); labels are in-memory only.
  function fingerprint(bundle) {
    const b = bundle || {};
    const groups = [
      ['medication', b.medications || []],
      ['allergy', b.allergies || []],
      ['problem', [...(b.problems || []), ...(b.pastProblems || [])]],
      ['immunisation', b.immunisations || []],
    ];
    const keys = new Set();
    const labels = new Map();
    for (const [kind, items] of groups) {
      for (const it of items) {
        const k = h(itemKey(kind, it));
        keys.add(k);
        labels.set(k, { kind, label: it.name || it.label || '(unlabelled)' });
      }
    }
    return { keys, labels };
  }

  // Persistable form: just the hashed keys (array). No PHI.
  function fingerprintKeys(bundle) {
    return [...fingerprint(bundle).keys];
  }

  // recordDelta(prevKeys, currentBundle) -> { added:[], removedCount, counts, nextKeys, ... }
  //   prevKeys : array of hashed keys from a previous fingerprint (or [] first run)
  //   Returns change EVENTS. `added` uses the current bundle's labels; `removed`
  //   items are only known by hash (we no longer hold the prior label) — reported
  //   by count only, which is the honest privacy trade-off of storing hashes.
  function recordDelta(prevKeys, currentBundle) {
    const prev = new Set(Array.isArray(prevKeys) ? prevKeys : []);
    const cur = fingerprint(currentBundle);

    const added = [];
    for (const k of cur.keys) {
      if (!prev.has(k)) {
        const meta = cur.labels.get(k);
        added.push({ event: `${meta.kind}-added`, kind: meta.kind, label: meta.label });
      }
    }
    // Removed: in prev, not in current. We only know the hash (kind is encoded in
    // the pre-hash key, but that's lost post-hash) — report count, flag for review.
    const removedKeys = [...prev].filter((k) => !cur.keys.has(k));

    // Rank: a new allergy or new problem is the most clinically significant.
    const rank = { allergy: 3, problem: 2, medication: 1, immunisation: 1 };
    added.sort((a, b) => (rank[b.kind] || 0) - (rank[a.kind] || 0));

    return {
      added,
      removedCount: removedKeys.length,
      nextKeys: [...cur.keys], // persist these for the next run
      counts: { added: added.length, removed: removedKeys.length },
      // Convenience flags for the composite features that consume this:
      hasNewAllergy: added.some((a) => a.kind === 'allergy'),
      hasNewProblem: added.some((a) => a.kind === 'problem'),
      hasNewMedication: added.some((a) => a.kind === 'medication'),
    };
  }

  const api = { fingerprint, fingerprintKeys, recordDelta };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelRecordDelta = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
