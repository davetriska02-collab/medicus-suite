// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — miniaturised "What's due" list from Sentinel chips.
//
// Used by the floating Companion widget
// (content-scripts/task-actions-panel.js). Same action-needed threshold as
// sentinel-core.js / brief-core.js (STATUS_RANK <= 2), plus drug-monitoring
// `no_data` so TAP matches the on-page HUD (H-002). Clinic wording mirrors
// brief-core.js (pocket Sentinel brief). Reception voice is a booking list
// — drug names + "bloods"/"tests", QOF as "Book a … review" — and drops
// combo/alert chips that are not something reception books. Nursing voice
// uses the same filter (drops combo) and names the treatment-room work
// (bloods / reviews / vaccines) without the booking verb. Visible four
// are red-severity first so a lithium-stale line cannot lose to a QOF
// review. Max 4 lines + "+N more (K of them overdue)" — same cap as the
// side-panel brief.
//
// Dual-mode export (same pattern as shared/smoking-status.js):
//   Browser (classic script): window.MsDueMini.<fn>(...)
//   Node / test:              require('./shared/due-mini.js').<fn>(...)
//
// THIS FILE DOES NOT FETCH. Callers pass chips they already trust belong to
// the on-screen patient. dueFromSnapshot() is the identity gate: it refuses
// to build a list unless snapshot.patientContext matches the caller-supplied
// patient UUID. A mismatch is 'pending', never a list for the wrong person.

(function (global) {
  'use strict';

  // MUST stay in lock-step with STATUS_RANK in engine/rules-engine.js and
  // side-panel/modules/sentinel/sentinel-core.js. test-status-rank-sync.js
  // pins those two; test-due-mini.js pins this copy to the engine table.
  var STATUS_RANK = {
    overdue: 0,
    not_met: 0,
    alert: 0,
    stale: 1,
    due_soon: 2,
    caution: 2,
    no_data: 3,
    noted: 3,
    recently_initiated: 4,
    achieved: 5,
    in_date: 5,
    vax_given: 5,
    vax_declined: 3,
    vax_due: 1,
  };

  var TYPE_RANK = {
    'drug-monitoring': 0,
    'drug-combo': 1,
    'event-count': 1,
    composite: 1,
    'qof-indicator': 2,
    'qof-process-indicator': 2,
    vaccine: 3,
  };

  var MAX_ITEMS = 4;

  // Trojan Source / bidi overrides in EHR text must not reverse a due line.
  var BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;

  function stripBidi(s) {
    return String(s == null ? '' : s).replace(BIDI_RE, '');
  }

  function isChipActionNeeded(status) {
    return (STATUS_RANK[status] ?? 99) <= 2;
  }

  // TAP action list: brief threshold PLUS drug-monitoring no_data (HUD-aligned).
  function isDueMiniActionNeeded(chip) {
    if (!chip) return false;
    if (isChipActionNeeded(chip.status)) return true;
    return chip.type === 'drug-monitoring' && chip.status === 'no_data';
  }

  function typeRank(type) {
    return TYPE_RANK[type] ?? 4;
  }

  // Visual severity. Rank 0 is red; stale (severely overdue) and drug-monitoring
  // no_data are also red so hue matches the tag, not a "due soon" hollow ring.
  function chipSeverity(chip) {
    if (!chip) return 'amber';
    if (chip.status === 'stale') return 'red';
    if (chip.type === 'drug-monitoring' && chip.status === 'no_data') return 'red';
    var rank = STATUS_RANK[chip.status] ?? 99;
    return rank === 0 ? 'red' : 'amber';
  }

  function isDueMiniRed(chip) {
    return chipSeverity(chip) === 'red';
  }

  function missingTestNames(chip) {
    return (chip.tests || [])
      .filter(function (t) {
        return t && t.status === 'no_data';
      })
      .map(function (t) {
        return stripBidi(t.testName || t.name);
      })
      .filter(Boolean);
  }

  // Mirrors brief-core.js drugSignalText — do not drift independently.
  // no_data uses the HUD wording ("no recent FBC, LFT"), never "overdue".
  function drugSignalText(chip) {
    var drug = stripBidi(chip.drugName || chip.ruleId || 'Drug');
    if (chip.status === 'no_data') {
      var missing = missingTestNames(chip);
      var missingPart = missing.length > 0 ? missing.join(', ') : 'monitoring';
      return drug + ' — no recent ' + missingPart;
    }
    var dueTests = (chip.tests || [])
      .filter(function (t) {
        return t && isChipActionNeeded(t.status);
      })
      .map(function (t) {
        return stripBidi(t.testName || t.name);
      })
      .filter(Boolean);
    var testsPart = dueTests.length > 0 ? dueTests.join(', ') : 'monitoring';
    var word = chip.status === 'stale' ? 'severely overdue' : chip.status === 'overdue' ? 'overdue' : 'due soon';
    return drug + ' — ' + testsPart + ' ' + word;
  }

  // Clinician glance, not QOF-code + threshold. DM006 + "≤58 OVERDUE" was
  // being read as "her HbA1c is currently over 58". Prefix map matches
  // sentinel-core QOF_ACTION_BY_PREFIX (admin audience) but names the
  // review, not the booking verb — this strip is a due-list, not a script.
  // Explicit codes beat prefixes (MH011 is a lipid indicator, not an MH review).
  // Prefix match requires a digit (or end) after the letters so LD ≠ LDL.
  var QOF_GLANCE_BY_CODE = {
    MH011: 'Lipid profile (SMI)',
  };

  var QOF_GLANCE_BY_PREFIX = [
    ['HYP', 'Blood pressure check'],
    ['DM', 'Diabetes review'],
    ['AST', 'Asthma review'],
    ['COPD', 'COPD review'],
    ['CHD', 'Heart disease review'],
    ['AF', 'Atrial fibrillation review'],
    ['CKD', 'Kidney review'],
    ['HF', 'Heart failure review'],
    ['MH', 'Mental health review'],
    ['DEP', 'Depression review'],
    ['EP', 'Epilepsy review'],
    ['PAD', 'Circulation review'],
    ['STIA', 'Stroke or TIA review'],
    ['RA', 'Rheumatoid arthritis review'],
    ['OB', 'Weight review'],
    ['SMOK', 'Stop-smoking review'],
    ['LD', 'Annual health check'],
  ].slice().sort(function (a, b) {
    return b[0].length - a[0].length;
  });

  function qofPrefixMatches(code, prefix) {
    if (code.indexOf(prefix) !== 0) return false;
    if (code.length === prefix.length) return true;
    var next = code.charAt(prefix.length);
    return next >= '0' && next <= '9';
  }

  function qofSignalText(chip) {
    var code = stripBidi(String(chip.indicatorCode || chip.ruleId || '')).toUpperCase();
    if (QOF_GLANCE_BY_CODE[code]) return QOF_GLANCE_BY_CODE[code];
    var hit = QOF_GLANCE_BY_PREFIX.find(function (row) {
      return qofPrefixMatches(code, row[0]);
    });
    if (hit) return hit[1];
    if (chip.indicatorName) return stripBidi(String(chip.indicatorName)).slice(0, 40);
    return stripBidi(chip.indicatorCode || chip.ruleId || 'Review');
  }

  // Mirrors brief-core.js genericSignalText.
  function genericSignalText(chip) {
    var label = stripBidi(
      chip.displayName || chip.label || chip.drugName || chip.indicatorCode || chip.ruleName || chip.ruleId || 'Alert'
    );
    var word = chip.status ? String(chip.status).replace(/_/g, ' ') : '';
    return word ? label + ' — ' + word : label;
  }

  function isBloodishTestName(name) {
    return /fbc|lft|u\s*&\s*e|tft|egfr|creat|crp|hb|plt|platelet|alt|ast|inr|lithium|level|cholest|lipid|hba1c|glucose/i.test(
      String(name || '')
    );
  }

  function drugReceptionText(chip) {
    var drug = stripBidi(chip.drugName || chip.ruleId || 'Medicine');
    var names = chip.status === 'no_data' ? missingTestNames(chip) : [];
    if (chip.status !== 'no_data') {
      names = (chip.tests || [])
        .filter(function (t) {
          return t && isChipActionNeeded(t.status);
        })
        .map(function (t) {
          return stripBidi(t.testName || t.name);
        })
        .filter(Boolean);
    }
    var bloodish = names.length === 0 || names.some(isBloodishTestName);
    return bloodish ? drug + ' bloods' : drug + ' tests';
  }

  function articleFor(phrase) {
    return /^[aeiou]/i.test(String(phrase || '')) ? 'an' : 'a';
  }

  function qofReceptionText(chip) {
    var glance = qofSignalText(chip);
    var lower = glance.charAt(0).toLowerCase() + glance.slice(1);
    return 'Book ' + articleFor(lower) + ' ' + lower;
  }

  function vaccineReceptionText(chip) {
    var name = stripBidi(chip.displayName || chip.label || 'vaccination');
    return 'Book ' + name;
  }

  function isReceptionDueChip(chip) {
    if (!isDueMiniActionNeeded(chip)) return false;
    var t = chip.type;
    return t === 'drug-monitoring' || t === 'qof-indicator' || t === 'qof-process-indicator' || t === 'vaccine';
  }

  function chipSignalText(chip, voice) {
    if (voice === 'reception') {
      if (chip.type === 'drug-monitoring') return drugReceptionText(chip);
      if (chip.type === 'qof-indicator' || chip.type === 'qof-process-indicator') return qofReceptionText(chip);
      if (chip.type === 'vaccine') return vaccineReceptionText(chip);
      return genericSignalText(chip);
    }
    // Treatment-room voice: same chip filter as reception (no combo/alerts)
    // but names the work, not the booking. "Methotrexate bloods", "Diabetes
    // review", "Flu vaccination" — never FBC/LFT or serotonin-syndrome.
    if (voice === 'nursing') {
      if (chip.type === 'drug-monitoring') return drugReceptionText(chip);
      if (chip.type === 'qof-indicator' || chip.type === 'qof-process-indicator') return qofSignalText(chip);
      if (chip.type === 'vaccine') return stripBidi(chip.displayName || chip.label || 'Vaccination');
      return genericSignalText(chip);
    }
    if (chip.type === 'drug-monitoring') return drugSignalText(chip);
    if (chip.type === 'qof-indicator' || chip.type === 'qof-process-indicator') return qofSignalText(chip);
    return genericSignalText(chip);
  }

  function toDueItem(chip, voice) {
    var text = chipSignalText(chip, voice);
    var plainLabel = voice === 'reception' || voice === 'nursing';
    return {
      severity: chipSeverity(chip),
      text: text,
      label: plainLabel ? text : stripTrailingStatusWord(text, chip.status),
      status: chip.status,
    };
  }

  // "+3 more (1 of them overdue)" — never "+3, 1 overdue", which readers
  // take as "only one thing is overdue" (the badge is the list total).
  function moreLineText(moreCount, moreRed) {
    var n = moreCount == null ? 0 : moreCount;
    if (n <= 0) return '';
    var red = moreRed == null ? 0 : moreRed;
    if (red > 0) return '+' + n + ' more (' + red + ' of them overdue)';
    return '+' + n + ' more';
  }

  // Strips the trailing status word from a signal line so it can be shown
  // next to a tag (which already names the state) without saying it twice.
  // Drug lines end in "… severely overdue"/"… overdue"/"… due soon" (see
  // drugSignalText); no_data lines use " — no recent {tests}"; generic lines
  // end in " — {status with _ -> space}" (see genericSignalText). QOF lines
  // (qofSignalText) carry no trailing status word at all, so they pass
  // through unchanged — ruling L, brief-aligned.
  function stripTrailingStatusWord(text, status) {
    var stripped = text.replace(/ (severely overdue|overdue|due soon)$/, '');
    if (stripped !== text) return stripped;
    if (status === 'no_data' && text.indexOf(' — no recent ') !== -1) {
      return text.replace(' — no recent ', ' — ');
    }
    var genericWord = status ? String(status).replace(/_/g, ' ') : '';
    if (genericWord) {
      var suffix = ' \u2014 ' + genericWord;
      if (text.slice(-suffix.length) === suffix) {
        return text.slice(0, -suffix.length);
      }
    }
    return text;
  }

  /**
   * buildDueMini(chips, opts) → DueMini
   *
   * @param {Array|null} chips — Sentinel chip array (or null)
   * @param {{ voice?: 'clinic'|'reception'|'nursing' }} [opts]
   * @returns {{
   *   items: Array<{ severity: 'red'|'amber', text: string, label: string, status: string }>,
   *   allItems: Array<{ severity: 'red'|'amber', text: string, label: string, status: string }>,
   *   moreCount: number,
   *   moreRed: number,
   *   redCount: number,
   *   amberCount: number,
   *   nothingDue: boolean,
   *   unclassified: boolean,
   *   voice: 'clinic'|'reception'|'nursing'
   * }}
   */
  function buildDueMini(chips, opts) {
    var voice = 'clinic';
    if (opts && opts.voice === 'reception') voice = 'reception';
    else if (opts && opts.voice === 'nursing') voice = 'nursing';
    var raw = Array.isArray(chips) ? chips.filter(Boolean) : [];
    var filtered =
      voice === 'reception' || voice === 'nursing' ? isReceptionDueChip : isDueMiniActionNeeded;
    var list = raw.filter(filtered);
    var hasUnrecognised = raw.some(function (c) {
      return c.status && !Object.prototype.hasOwnProperty.call(STATUS_RANK, c.status);
    });
    var redCount = 0;
    var amberCount = 0;
    for (var i = 0; i < list.length; i++) {
      if (isDueMiniRed(list[i])) redCount++;
      else amberCount++;
    }
    // Visual red first (so lithium-stale is not buried under a QOF not_met),
    // then type (drug before combo before QOF), then engine STATUS_RANK.
    var sorted = list.slice().sort(function (a, b) {
      var sevDiff = (isDueMiniRed(a) ? 0 : 1) - (isDueMiniRed(b) ? 0 : 1);
      if (sevDiff !== 0) return sevDiff;
      var typeDiff = typeRank(a.type) - typeRank(b.type);
      if (typeDiff !== 0) return typeDiff;
      return (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
    });
    var hidden = sorted.slice(MAX_ITEMS);
    var allItems = sorted.map(function (chip) {
      return toDueItem(chip, voice);
    });
    return {
      items: allItems.slice(0, MAX_ITEMS),
      allItems: allItems,
      moreCount: hidden.length,
      moreRed: hidden.filter(isDueMiniRed).length,
      redCount: redCount,
      amberCount: amberCount,
      nothingDue: list.length === 0 && !hasUnrecognised,
      unclassified: list.length === 0 && hasUnrecognised,
      voice: voice,
    };
  }

  function snapshotPatientUuid(snapshot) {
    var pc = snapshot && snapshot.patientContext;
    if (!pc) return null;
    return pc.patientUuid || pc.patientId || pc.id || pc.uuid || null;
  }

  function samePatientId(a, b) {
    if (!a || !b) return false;
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  function unmatchedHighRiskList(snapshot) {
    var list = snapshot && snapshot.unmatchedHighRisk;
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (h) {
        return h && (h.name || h.riskClass);
      })
      .map(function (h) {
        return {
          name: stripBidi(h.name || ''),
          riskClass: stripBidi(h.riskClass || ''),
        };
      });
  }

  /**
   * dueFromSnapshot(snapshot, patientId, opts) → { state, mini?, degraded?, journalAugmentFailed?, unmatchedHighRisk? }
   *
   * Identity gate. Returns state 'pending' (do not render chips) unless the
   * snapshot carries chips for THIS patientId. A previous patient's snapshot,
   * an unavailable/invalidated snapshot, or a missing patientId must never
   * produce a due list — that is the H-001 control for this surface.
   *
   * opts.voice — 'clinic' (default), 'reception', or 'nursing'. Voice never
   * bypasses the identity gate; it only changes wording / which chip types list.
   *
   * state:
   *   'pending' — no trusted match yet (loading / wrong patient / empty snap)
   *   'ready'   — mini belongs to this patient and may be rendered
   */
  function dueFromSnapshot(snapshot, patientId, opts) {
    if (!snapshot || snapshot.unavailable === true || !Array.isArray(snapshot.chips)) {
      return { state: 'pending' };
    }
    var snapPid = snapshotPatientUuid(snapshot);
    if (!patientId || !snapPid || !samePatientId(snapPid, patientId)) {
      return { state: 'pending' };
    }
    return {
      state: 'ready',
      mini: buildDueMini(snapshot.chips, opts),
      degraded: !!snapshot.degraded,
      journalAugmentFailed: snapshot.journalAugmentFailed === true,
      unmatchedHighRisk: unmatchedHighRiskList(snapshot),
    };
  }

  var api = {
    STATUS_RANK: STATUS_RANK,
    MAX_ITEMS: MAX_ITEMS,
    isChipActionNeeded: isChipActionNeeded,
    isDueMiniActionNeeded: isDueMiniActionNeeded,
    buildDueMini: buildDueMini,
    moreLineText: moreLineText,
    snapshotPatientUuid: snapshotPatientUuid,
    samePatientId: samePatientId,
    dueFromSnapshot: dueFromSnapshot,
    stripBidi: stripBidi,
    isReceptionDueChip: isReceptionDueChip,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MsDueMini = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
