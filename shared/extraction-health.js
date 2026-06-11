// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Extraction Health / Drift Detector
//
// Detects sustained extraction drift: when a Medicus view that historically
// yielded meaningful data (medications, observations, problems, demographics)
// starts returning zeros across multiple consecutive records, signalling that
// Medicus may have changed its page layout or API and the extension's extractors
// are no longer matching.
//
// Pure functions only — no I/O, no chrome APIs, no DOM.
// nowIso passed in as a parameter so tests are deterministic.
//
// Storage key: sentinel.extractionBaseline (chrome.storage.local)
// Schema: see §2 of shared/extraction-health.js and ws1-extraction-health.md.
// PII audit: stores ONLY integer counts, ISO timestamps, internal view names,
// and the literal strings 'api'/'dom'. Zero patient-identifiable data.
// Excluded from backups: ephemeral machine-local telemetry — restoring a stale
// baseline onto another machine or after a Medicus UI change would corrupt the
// reference and mask or fake drift. See test-backup-coverage.js ALLOWLIST.
//
// Usage (browser classic script): window.ExtractionHealth.<fn>(...)
// Usage (Node / test):             require('./shared/extraction-health.js').<fn>(...)
//
// Dual-export pattern: same as shared/rule-currency.js.

(function (global) {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const SCHEMA_VERSION = 1;
  const MAX_SAMPLES = 40; // rolling window cap per bucket
  const MAX_BUCKETS = 50; // hard cap on bucket count — a real practice uses ~5-10
  const RECENT_N = 5; // "recent" comparison window
  const MIN_HISTORY = 10; // samples required (excluding recent) before drift can fire
  const MIN_MEANINGFUL_MEDIAN = 3; // metric must historically yield >= 3 to be drift-eligible
  const RECENT_ZERO_RATE = 0.8; // >= 4 of last 5 samples at zero triggers drift
  const MUTE_HOURS = 24; // dismissal snooze duration
  const SAMPLE_MIN_GAP_MS = 15 * 60 * 1000; // same-patient re-sample throttle (15 min)

  // ── Helpers ───────────────────────────────────────────────────────────────

  function median(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function blankBaseline() {
    return { v: SCHEMA_VERSION, buckets: {}, mutedUntil: null, lastWarnAt: null };
  }

  function validBaseline(b) {
    return b && typeof b === 'object' && b.v === SCHEMA_VERSION && b.buckets && typeof b.buckets === 'object';
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Build a { bucket, sample } descriptor from a fetchPatientData() result.
   * Returns null when the result is not suitable for drift tracking:
   *   - not live mode
   *   - no patient identity
   *   - no view, or view is 'unknown'
   *
   * @param {object} data  Return value of fetchPatientData('live').
   * @param {string} nowIso  Current ISO timestamp (passed in for testability).
   * @returns {{ bucket: string, sample: object } | null}
   */
  function summariseExtraction(data, nowIso) {
    if (!data || data.mode !== 'live') return null;
    const pc = data.patientContext || {};
    // Patient must be identifiable (same predicate as assessExtractionHealth).
    const hasPatient = !!(pc.patientUuid || pc.patientId || pc.id || pc.uuid || pc.patientName);
    if (!hasPatient) return null;
    // View must be known.
    const view = pc.view;
    if (!view || view === 'unknown') return null;

    const src = String(data.debug?.dataSource || '').startsWith('api') ? 'api' : 'dom';
    const bucket = view + '|' + src;

    const meds = (data.medications || []).length;
    const obs = (data.observations || []).length;
    const problems = (data.problems || []).length;
    // Count demographic fields (0–5): dob, dobRaw, ageYears (non-null), sex, nhsNumber.
    const d =
      (pc.dob ? 1 : 0) +
      (pc.dobRaw ? 1 : 0) +
      (pc.ageYears != null ? 1 : 0) +
      (pc.sex ? 1 : 0) +
      (pc.nhsNumber ? 1 : 0);

    const sample = { t: nowIso, m: meds, o: obs, p: problems, d };
    return { bucket, sample };
  }

  /**
   * Return a new baseline object with the sample appended to the given bucket.
   * Does NOT mutate the input. Initialises the baseline if null/wrong-version.
   * Trims to MAX_SAMPLES (oldest first).
   *
   * @param {object|null} baseline  Existing baseline from storage, or null.
   * @param {string} bucket  Bucket key, e.g. "care-record-summary|api".
   * @param {object} sample  Sample object { t, m, o, p, d }.
   * @returns {object}  New baseline.
   */
  function updateBaseline(baseline, bucket, sample) {
    const base = validBaseline(baseline) ? JSON.parse(JSON.stringify(baseline)) : blankBaseline();
    if (!base.buckets[bucket]) {
      base.buckets[bucket] = { samples: [], updatedAt: null };
    }
    const entry = base.buckets[bucket];
    entry.samples = [...entry.samples, sample].slice(-MAX_SAMPLES);
    entry.updatedAt = sample.t;

    // Hard cap: evict oldest buckets (by updatedAt) when the count exceeds MAX_BUCKETS.
    // A real practice uses ~5-10 view+source combos; 50 leaves ample headroom while
    // preventing unbounded growth if bucket keys somehow proliferate.
    const bucketKeys = Object.keys(base.buckets);
    if (bucketKeys.length > MAX_BUCKETS) {
      bucketKeys
        .sort((a, b) => {
          const ta = base.buckets[a].updatedAt || '';
          const tb = base.buckets[b].updatedAt || '';
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        })
        .slice(0, bucketKeys.length - MAX_BUCKETS)
        .forEach((k) => { delete base.buckets[k]; });
    }

    return base;
  }

  /**
   * Assess whether current extraction looks like drift compared to history.
   *
   * Algorithm: splits (history + sample) into history (all but last RECENT_N)
   * and recent (last RECENT_N, including the candidate sample). Drift fires when
   * a metric's historical median >= MIN_MEANINGFUL_MEDIAN AND >= RECENT_ZERO_RATE
   * of recent samples are zero. Requires MIN_HISTORY history samples (cold start
   * never warns). Rationale: a single sparse record legitimately has few meds/obs;
   * the drift signature of a broken selector is *sustained absolute zero* on a
   * view that reliably produced data.
   *
   * @param {object|null} baseline  Baseline from storage.
   * @param {string} bucket  Bucket key.
   * @param {object} sample  Candidate sample (treated as the newest of recent).
   * @returns {{ drifted: false } | { drifted: true, metrics: Array, reason: string, bucket: string }}
   */
  function assessDrift(baseline, bucket, sample) {
    const NO_DRIFT = { drifted: false };
    if (!validBaseline(baseline)) return NO_DRIFT;
    const entry = baseline.buckets && baseline.buckets[bucket];
    if (!entry || !Array.isArray(entry.samples)) return NO_DRIFT;

    // Combine stored samples + candidate sample into one array.
    const all = [...entry.samples, sample];
    if (all.length < RECENT_N + MIN_HISTORY) return NO_DRIFT; // cold start

    const recent = all.slice(-RECENT_N);
    const history = all.slice(0, all.length - RECENT_N);

    if (history.length < MIN_HISTORY) return NO_DRIFT;

    const METRIC_NAMES = { m: 'medications', o: 'observations', p: 'problems', d: 'demographics' };
    const driftedMetrics = [];

    for (const [key, name] of Object.entries(METRIC_NAMES)) {
      const histValues = history.map((s) => s[key]);
      const histMed = median(histValues);
      if (histMed < MIN_MEANINGFUL_MEDIAN) continue; // metric not meaningful enough
      const zeroRate = recent.filter((s) => s[key] === 0).length / recent.length;
      if (zeroRate >= RECENT_ZERO_RATE) {
        driftedMetrics.push({ name, histMedian: histMed, zeroRate });
      }
    }

    if (driftedMetrics.length === 0) return NO_DRIFT;

    // Build reason from worst metric (highest histMedian).
    const worst = driftedMetrics.slice().sort((a, b) => b.histMedian - a.histMedian)[0];
    const typicalCount = Math.round(worst.histMedian);
    const zeroCount = Math.round(worst.zeroRate * RECENT_N);
    const reason =
      `This view usually yields ~${typicalCount} ${worst.name}, ` +
      `but ${zeroCount} of the last ${RECENT_N} records yielded none — ` +
      `Medicus may have changed its layout.`;

    return { drifted: true, metrics: driftedMetrics, reason, bucket };
  }

  /**
   * Pure throttle: should we record a sample now?
   * True when the patient/bucket key changed, or when the minimum gap has elapsed.
   *
   * @param {string|null} lastSampleKey  Last recorded in-memory key.
   * @param {number} lastSampleAt  Timestamp (ms) of last sample.
   * @param {string} candidateKey  Key for this potential sample.
   * @param {number} nowMs  Current timestamp in ms.
   * @returns {boolean}
   */
  function shouldRecordSample(lastSampleKey, lastSampleAt, candidateKey, nowMs) {
    if (lastSampleKey !== candidateKey) return true;
    return nowMs - lastSampleAt >= SAMPLE_MIN_GAP_MS;
  }

  /**
   * Is the drift banner currently muted?
   *
   * @param {object|null} baseline
   * @param {string} nowIso  Current ISO timestamp.
   * @returns {boolean}
   */
  function isMuted(baseline, nowIso) {
    if (!baseline || !baseline.mutedUntil) return false;
    return baseline.mutedUntil > nowIso;
  }

  /**
   * Return a new baseline with mutedUntil set MUTE_HOURS from now.
   * Does NOT mutate the input.
   *
   * @param {object|null} baseline
   * @param {string} nowIso
   * @returns {object}
   */
  function muteBaseline(baseline, nowIso) {
    const base = validBaseline(baseline) ? JSON.parse(JSON.stringify(baseline)) : blankBaseline();
    const until = new Date(new Date(nowIso).getTime() + MUTE_HOURS * 60 * 60 * 1000).toISOString();
    base.mutedUntil = until;
    return base;
  }

  /**
   * Return a new baseline with lastWarnAt updated to nowIso — but only if it
   * was not already set recently (within 4 hours) to avoid thrashing.
   * Does NOT mutate the input.
   *
   * @param {object|null} baseline
   * @param {string} nowIso
   * @returns {object}
   */
  function markWarned(baseline, nowIso) {
    const base = validBaseline(baseline) ? JSON.parse(JSON.stringify(baseline)) : blankBaseline();
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    if (base.lastWarnAt && new Date(nowIso).getTime() - new Date(base.lastWarnAt).getTime() < FOUR_HOURS_MS) {
      return base; // already warned recently — no update
    }
    base.lastWarnAt = nowIso;
    return base;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const api = {
    summariseExtraction,
    updateBaseline,
    assessDrift,
    shouldRecordSample,
    isMuted,
    muteBaseline,
    markWarned,
    constants: {
      SCHEMA_VERSION,
      MAX_SAMPLES,
      MAX_BUCKETS,
      RECENT_N,
      MIN_HISTORY,
      MIN_MEANINGFUL_MEDIAN,
      RECENT_ZERO_RATE,
      MUTE_HOURS,
      SAMPLE_MIN_GAP_MS,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ExtractionHealth = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
