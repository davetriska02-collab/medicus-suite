// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Smoking status derivation + display line (v3.174.0)
//
// One authoritative patient-level smoking-status FACT, derived from the
// observations the extension already extracts (investigation dashboard +
// journal augment — see content-scripts/sentinel.js fetchJournalObservations).
// Requested by a real GP user ("can we get a smoking status flag?") and
// placed per the Practice-panel ruling of 2026-07-16
// (docs/appraisal/PRACTICE-smoking-flag-2026-07-16.md): a single calm line in
// the Sentinel "Monitoring for" patient card — NOT a chip, NOT red/amber.
//
// Design rules the panel converged on (all seven personas):
//   - The WORD carries the state, never colour alone (colourblind-safe), and
//     the line is neutral-toned: smoking status is a clinical fact and a
//     conversation, not a safety alert — red/amber stay reserved for the
//     panel's genuine needs-action signals.
//   - Recency is always attached ("Nov 2025 · 8 mo ago") — a status without a
//     date is close to useless for cessation/enzyme-induction questions.
//   - Absence is honestly bounded: the extension only sees ~13 months of
//     coded entries (the journal augment's 400-day window), so the absent
//     state says "no entry in the last 13 months — check record", never
//     "not recorded" (which reads as "never in her life") and never a bare
//     "NO DATA".
//   - Classification is CONSERVATIVE (pharmacist ruling): only unambiguous
//     terms are bucketed; "smoking cessation advice", "nicotine dependence",
//     bare "tobacco use" etc. render as "unclear — see record" with the
//     verbatim term, never a confident guess.
//   - Most-recent entry wins for the headline, but disagreeing buckets among
//     the visible entries are flagged ("multiple entries") rather than
//     silently resolved — an implausible current→never flip is a coding
//     error to review, not a transition.
//
// Dual-mode export (same pattern as shared/event-ledger.js):
//   Browser (classic script): window.SmokingStatus.<fn>(...)
//   Node / test:              require('./shared/smoking-status.js').<fn>(...)

(function (global) {
  'use strict';

  // How far back the extension's observation feed can see (journal augment
  // fetches ~400 days). Copy derived from this so the honest-absence wording
  // can never drift from the real window.
  var WINDOW_DAYS = 400;
  var WINDOW_LABEL = 'the last 13 months';

  // An observation is smoking-RELATED (a candidate) when name or value carries
  // one of these. Deliberately broad — candidacy only; classification below is
  // strict.
  var CANDIDATE_RE = /smok|tobacco|cigarette|nicotine/i;

  // Strict, unambiguous bucket classifiers, tested against name+value text.
  // Order matters: never/ex checked before current so "ex-smoker" can never
  // fall through to a "smoker" substring match.
  var NEVER_RE = /never\s+smoked|never[-\s]?smoker|lifelong\s+non[-\s]?smoker/i;
  var EX_RE = /ex[-\s]?smoker|former\s+smoker|stopped\s+smoking|smoking\s+ceased|ex[-\s]?cigarette\s+smoker/i;
  var CURRENT_RE =
    /current\s+smoker|smoker\s*[-–—]\s*current|current\s+cigarette|cigarette\s+smoker|smokes\s+\d|cigarettes?\s+(per|a)\s+day|current\s+tobacco|(?:^|\W)smoker(?:\W|$)/i;

  var BUCKET_LABEL = {
    current: 'Current smoker',
    ex: 'Ex-smoker',
    never: 'Never smoked',
  };

  function classify(text) {
    var t = String(text || '');
    if (!t) return null;
    if (NEVER_RE.test(t)) return 'never';
    if (EX_RE.test(t)) return 'ex';
    if (CURRENT_RE.test(t)) return 'current';
    return null; // smoking-related but not an unambiguous status
  }

  // deriveSmokingStatus(observations, nowIso?) → null | {
  //   bucket:   'current' | 'ex' | 'never' | null   (null = unclear),
  //   term:     verbatim source text (name + value where value adds info),
  //   date:     'YYYY-MM-DD' | null,
  //   monthsAgo: integer | null,
  //   conflict: true when the visible entries disagree on bucket,
  //   entries:  count of smoking-related entries seen,
  // }
  // Returns null when NO smoking-related observation is visible at all — the
  // caller renders the honest-absence line (see formatSmokingLine).
  // Pure and defensive: never throws on malformed observations.
  function deriveSmokingStatus(observations, nowIso) {
    try {
      var now = nowIso ? new Date(nowIso) : new Date();
      var candidates = [];
      (Array.isArray(observations) ? observations : []).forEach(function (o) {
        if (!o) return;
        var name = String(o.name || '');
        var value = String(o.value || '');
        if (!CANDIDATE_RE.test(name) && !CANDIDATE_RE.test(value)) return;
        candidates.push({
          name: name,
          value: value,
          date: typeof o.date === 'string' ? o.date : null,
          bucket: classify(name + ' ' + value),
        });
      });
      if (candidates.length === 0) return null;

      // Most recent wins the headline (undated entries sort last).
      candidates.sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
      var top = candidates[0];

      // Conflict: any two CLASSIFIED entries disagreeing on bucket. Unclear
      // entries (bucket null) don't conflict — they're already surfaced as
      // "unclear" when they lead.
      var buckets = {};
      candidates.forEach(function (c) {
        if (c.bucket) buckets[c.bucket] = true;
      });
      var conflict = Object.keys(buckets).length > 1;

      var monthsAgo = null;
      if (top.date) {
        var d = new Date(top.date);
        if (!isNaN(d.getTime())) {
          monthsAgo = Math.max(0, Math.floor((now.getTime() - d.getTime()) / (30.44 * 24 * 3600 * 1000)));
        }
      }

      // Verbatim term: prefer the value when it adds information beyond the
      // observation name (e.g. name "Smoking status", value "Ex-smoker").
      var term = top.value && top.value !== top.name ? top.name + ': ' + top.value : top.name;

      return {
        bucket: top.bucket,
        term: term,
        date: top.date,
        monthsAgo: monthsAgo,
        conflict: conflict,
        entries: candidates.length,
      };
    } catch (e) {
      return null; // display aid only — a derivation failure must never break the snapshot
    }
  }

  // ---- Display formatting (used by the panel Sentinel module) --------------

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function shortDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function agoLabel(monthsAgo) {
    if (monthsAgo == null) return null;
    if (monthsAgo < 1) return 'this month';
    return monthsAgo + ' mo ago';
  }

  // formatSmokingLine(smoking) → { text, title } — one truncation-safe line +
  // the full-detail tooltip. `smoking` is deriveSmokingStatus()'s result (may
  // be null = nothing visible in the window).
  function formatSmokingLine(smoking) {
    if (!smoking) {
      return {
        text: 'Smoking: no entry in ' + WINDOW_LABEL + ' — check record',
        title:
          'No smoking-status entry found in ' +
          WINDOW_LABEL +
          ' of coded entries (the window this extension can see). An older status may exist in the full record — this is not "never recorded".',
      };
    }
    var head = smoking.bucket ? BUCKET_LABEL[smoking.bucket] : 'unclear — see record';
    var when = shortDate(smoking.date);
    var ago = agoLabel(smoking.monthsAgo);
    var parts = ['Smoking: ' + head];
    if (when) parts.push(when + (ago ? ' (' + ago + ')' : ''));
    if (smoking.conflict) parts.push('multiple entries');
    var title =
      'Source entry: ' +
      smoking.term +
      (smoking.date ? ' · recorded ' + smoking.date : ' · no date') +
      (smoking.conflict
        ? '. Entries in the visible window DISAGREE on status — review the record before acting.'
        : '') +
      ' Derived from ' +
      WINDOW_LABEL +
      ' of coded entries only — verify in the record before acting.';
    return { text: parts.join(' · '), title: title };
  }

  var api = {
    deriveSmokingStatus: deriveSmokingStatus,
    formatSmokingLine: formatSmokingLine,
    classify: classify,
    WINDOW_DAYS: WINDOW_DAYS,
    WINDOW_LABEL: WINDOW_LABEL,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SmokingStatus = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
