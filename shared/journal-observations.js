// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Patient-journal observation parsing + observationHistory merge (v3.264.3)
//
// Pure helpers behind content-scripts/sentinel.js's journal augment. Extracted
// from fetchJournalObservations so the parsing is unit-testable AND so the two
// live-consult ingestion gaps found 2026-09-21 stay fixed:
//
//   1. FLAT top-level `observation` items. The bulk journal payload
//      (docs/learnings-patient-journal-api.md, confirmed live 2026-07-02:
//      `observation` is one of the 11 confirmed top-level item.type values)
//      carries observations coded OUTSIDE a consultation as flat
//      `items[]` entries — exactly what a clinician gets when adding a
//      standalone "Journal Observation" mid-consult (BP "119/86",
//      "Teetotaller", "Ex-smoker"). The old parser walked ONLY
//      `item.type === 'encounter'` → consultationTopics → headings → entries,
//      so every flat observation was silently dropped and the Companion
//      showed stale/absent BP, alcohol and smoking status during the consult.
//   2. Journal observations never reached data.observationHistory — only
//      data.observations — so history consumers (Trends buildBpModel,
//      Sentinel brief/passport BP lines) could not see a journal-coded BP at
//      all. mergeJournalObsIntoHistory below is the one ingest path that
//      folds them in.
//
// Dual-mode export (same pattern as shared/smoking-status.js):
//   Browser (classic script): window.JournalObservations.<fn>(...)
//   Node / test:              require('./shared/journal-observations.js').<fn>(...)

(function (global) {
  'use strict';

  var MONTH_INDEX = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  // Parse "DD Mon YYYY" (entry.observationDate) or "DayName DD Mon YYYY"
  // (day-group record.title — the two formats differ, see
  // docs/learnings-patient-journal-api.md "Day-group shape").
  function parseDisplayDate(str) {
    if (!str) return null;
    var parts = String(str).trim().split(' ').filter(Boolean);
    var dayStr = parts.length === 3 ? parts[0] : parts[1];
    var monStr = parts.length === 3 ? parts[1] : parts[2];
    var yearStr = parts.length === 3 ? parts[2] : parts[3];
    if (!dayStr || !monStr || !yearStr) return null;
    var mon = MONTH_INDEX[monStr];
    if (mon === undefined) return null;
    var d = new Date(parseInt(yearStr, 10), mon, parseInt(dayStr, 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // Minimal numeric parse for history points (mirrors the common cases of
  // engine/normalisers.js parseObservationValue — callers in the extension
  // pass the real parseObservationValue in; this is the test/fallback impl).
  function defaultParseValue(rawValue) {
    if (rawValue == null) return NaN;
    var s = String(rawValue).trim();
    if (s === '') return NaN;
    var bpMatch = s.match(/^(\d{2,3})\s*\/\s*\d{2,3}/);
    if (bpMatch) return parseFloat(bpMatch[1]);
    var stripped = s.replace(/^[<>~=≤≥]+\s*/, '');
    var n = parseFloat(stripped);
    return isFinite(n) ? n : NaN;
  }

  // Calendar day of a local Date. parseDisplayDate builds local midnight
  // (`new Date(y, m, d)`). toISOString() then shifts that instant to UTC, so
  // during British Summer Time every journal date is stored as the previous
  // day — 21 Sep becomes 20 Sep, and a 1 Apr code lands in the previous QOF
  // year. Dashboard dates are already YYYY-MM-DD, so the shift also breaks
  // same-day de-dupe and draws a second trend point.
  function localIsoDate(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // parseJournalObservations(payload, opts) → [{ name, value, date, source: 'journal' }]
  //
  // payload: the raw /clinical/data/patient-journal/overview/{patientId} JSON.
  // opts:
  //   existingObs — observations already extracted (investigation dashboard);
  //                 used to de-dupe by lowercased name + ISO date.
  //   now         — Date or ISO string for the recency window (default: today).
  //   windowDays  — how far back to ingest (default 400 — the "13 months"
  //                 window shared/smoking-status.js's honest-absence wording
  //                 is derived from; keep in sync).
  //
  // Walks BOTH confirmed shapes that carry coded observations:
  //   - nested:  encounter items → consultationTopics → headings → entries
  //              (entry.entryType === 'observation')
  //   - flat:    top-level items with item.type === 'observation' whose
  //              entry-like fields live on item.data (finer-grained
  //              data.entryType confirmed in the 2026-07-02 full-entry scan)
  // Pure and defensive: never throws on malformed payloads; unrecognised
  // items are skipped, never guessed at.
  function parseJournalObservations(payload, opts) {
    var o = opts || {};
    var windowDays = typeof o.windowDays === 'number' ? o.windowDays : 400;
    var now = o.now ? new Date(o.now) : new Date();
    var cutoff = new Date(now.getTime());
    cutoff.setDate(cutoff.getDate() - windowDays);

    var existingKeys = {};
    (Array.isArray(o.existingObs) ? o.existingObs : []).forEach(function (obs) {
      if (!obs) return;
      existingKeys[String(obs.name || '').toLowerCase() + '|' + (obs.date || '')] = true;
    });

    var result = [];

    // Generic wrapper names carry no coded meaning — Medicus labels a
    // standalone flat item with a UI wrapper title when the coded term lives
    // in `value` instead. The rules engine matches observation NAMES only
    // (filterMatchingObservations), so an entry named "Journal observation"
    // with value "Ex-smoker" is invisible to every indicator (the SMOK002
    // live NO DATA report, 2026-09-21).
    var GENERIC_NAME_RE = /^(?:journal\s+)?(?:observation|entry)s?$/i;

    // Naming hardening: promote the coded term out of `value` when the
    // resolved name is absent/generic and the value reads as a term (has
    // letters — never a bare numeric/BP reading — and is short enough to be
    // a coded display name, not free text).
    function resolveName(name, value) {
      var n = name == null ? '' : String(name).trim();
      var v = typeof value === 'string' ? value.trim() : '';
      var generic = !n || GENERIC_NAME_RE.test(n);
      if (generic && v && v.length <= 80 && /[a-z]/i.test(v)) return v;
      return n || null;
    }

    function pushEntry(name, value, entryDate) {
      if (!name || !entryDate || entryDate < cutoff) return;
      var isoDate = localIsoDate(entryDate);
      var nameKey = String(name).toLowerCase() + '|' + isoDate;
      if (existingKeys[nameKey]) return; // already in the investigation dashboard
      existingKeys[nameKey] = true; // de-dupe within journal results too
      result.push({
        name: name,
        value: typeof value === 'string' ? value : '',
        date: isoDate,
        source: 'journal',
      });
    }

    try {
      var records = (payload && payload.patientJournalRecords) || [];
      for (var r = 0; r < records.length; r++) {
        var record = records[r] || {};
        var groupDate = parseDisplayDate(record.title);
        var items = record.items || [];
        for (var i = 0; i < items.length; i++) {
          var item = items[i] || {};
          // Flat top-level observation item — standalone "Journal Observation"
          // coded outside a consultation (live-consult gap 1 above).
          if (item.type === 'observation') {
            var fd = item.data || {};
            if (fd.entryType && fd.entryType !== 'observation') continue;
            pushEntry(
              resolveName(fd.type || item.title || null, fd.value),
              fd.value,
              parseDisplayDate(fd.observationDate) || groupDate
            );
            continue;
          }
          // Nested consultation-coded entries (the original path).
          if (item.type !== 'encounter') continue;
          var topics = (item.data && item.data.consultationTopics) || [];
          for (var t = 0; t < topics.length; t++) {
            var headings = (topics[t] && topics[t].headings) || [];
            for (var h = 0; h < headings.length; h++) {
              var entries = (headings[h] && headings[h].entries) || [];
              for (var e = 0; e < entries.length; e++) {
                var entry = entries[e] || {};
                // Skip entries missing a type name, or that aren't observations
                // (e.g. medications, problems, notes).
                if (!entry.type || entry.entryType !== 'observation') continue;
                pushEntry(
                  resolveName(entry.type, entry.value),
                  entry.value,
                  parseDisplayDate(entry.observationDate) || groupDate
                );
              }
            }
          }
        }
      }
    } catch (err) {
      // Defensive only — a malformed record must not lose the entries already
      // parsed. Callers treat the returned array as best-effort.
    }
    return result;
  }

  // mergeJournalObsIntoHistory(observationHistory, journalObs, parseValue?) →
  // a NEW observationHistory array with the journal observations folded in,
  // so Trends / brief / passport (which read data.observationHistory, not
  // data.observations) see journal-coded readings (live-consult gap 2 above).
  //
  //   - Merges into an existing group on exact (case-insensitive) name match;
  //     otherwise creates a new group.
  //   - A new group named exactly "Blood pressure" is UNSHIFTED to the front —
  //     the same convention as normaliseObservationHistory's synthesised BP
  //     group, so first-hit consumers (brief-core/passport-core find()) still
  //     land on it. All other new groups are appended, so substring matchers
  //     (e.g. Trends seriesFor 'weight') keep preferring the dashboard's
  //     fuller series.
  //   - Same-date entries already in a group win (the dashboard is
  //     authoritative); journal points never overwrite them.
  //   - History stays newest-first (the observationHistory contract).
  // Never mutates the input arrays/groups.
  function mergeJournalObsIntoHistory(observationHistory, journalObs, parseValue) {
    var base = Array.isArray(observationHistory) ? observationHistory : [];
    if (!Array.isArray(journalObs) || journalObs.length === 0) return base;
    var pv = typeof parseValue === 'function' ? parseValue : defaultParseValue;
    var out = base.map(function (g) {
      return Object.assign({}, g, { history: Array.isArray(g.history) ? g.history.slice() : [] });
    });
    var byName = {};
    out.forEach(function (g) {
      byName[String(g.name || '').toLowerCase()] = g;
    });
    journalObs.forEach(function (obs) {
      if (!obs || !obs.name || !obs.date) return;
      var key = String(obs.name).toLowerCase();
      var group = byName[key];
      if (!group) {
        group = { name: obs.name, code: null, group: null, unit: null, history: [] };
        byName[key] = group;
        if (key === 'blood pressure') out.unshift(group);
        else out.push(group);
      }
      var duplicate = group.history.some(function (h) {
        return h && h.date === obs.date;
      });
      if (duplicate) return; // dashboard point for that date is authoritative
      group.history.push({
        date: obs.date,
        value: pv(obs.value),
        rawValue: String(obs.value == null ? '' : obs.value),
        isAbove: false,
        isBelow: false,
        source: 'journal',
      });
      group.history.sort(function (a, b) {
        return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
      });
    });
    return out;
  }

  var api = {
    parseJournalObservations: parseJournalObservations,
    mergeJournalObsIntoHistory: mergeJournalObsIntoHistory,
    parseDisplayDate: parseDisplayDate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.JournalObservations = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
