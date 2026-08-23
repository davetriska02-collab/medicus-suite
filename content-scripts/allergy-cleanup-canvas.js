// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Clean up allergies?" canvas overlay
//
// PURPOSE (2026-08-20): a visual, drag-and-drop organiser for the allergy
// list, the same *shell* as problem-nesting-canvas.js (overlay, tiles,
// computed lanes, draft + Finalise, confirm bar, keyboard pick-up) over
// the existing allergy-cleanup.js engine. Allergies have no parent/child,
// no flat links, and no significance grade — lanes are the cleanup
// classifications the scan already produces (Active / Junk / Convert /
// Dual-coded) plus an End bin.
//
// This file owns NO state and makes NO API calls of its own — every read
// (the live scan) and every write (commitEndAllergies, commitClearLegacy,
// openReview, openConversionReview) goes through window.AllergyCleanup.
// Merge and convert stay the existing per-entry modals (H-060 control c).
//
// TILE ACTIONS (2026-08-23, mirrors problem-nesting-canvas.js's "Edit
// problem…", but with no extra button — see isConvertEligible's own
// comment): clicking any tile, in EVERY lane (Active, Junk/low-rel, Convert,
// Dual-coded), opens the conversion/reaction-review card DIRECTLY. Only two
// rows fall through to the ordinary select-and-show-Stage-end flow instead:
// a confirmed "not-an-allergy" match, and the NKA sentinel entry — for both,
// "convert to a substance" is simply the wrong action, not merely
// undesirable. For a tile the scan never flagged,
// window.AllergyCleanup.openConversionForAllergy registers an ad-hoc review
// entry on demand and opens the SAME review panel as a flagged conversion —
// pulling through what's ALREADY coded rather than guessing: the pending
// substance defaults to the entry's own current substance, and if it already
// carries coded reaction(s) those are pulled through as the pending picks
// too. Only when there is no coded reaction yet does it fall back to
// seeding the reaction search from the allergy's own additionalInformation
// free text — see openConversionReview's own comment in allergy-cleanup.js.
// An ad-hoc entry is marked `adHoc: true` and must never be treated as a
// scan-flagged Convert-lane match (see liveLaneKey) — it exists only to give
// that one review modal state to live in.
//
// LAYOUT is computed, never persisted x/y. An End bin drop stages
// end-allergy for ANY row, in any lane (2026-08-23, relaxed from the
// original junk/not-an-allergy-only restriction — see
// isEndableClassification's own comment for the reasoning; it is not this
// tool's place to decide what a clinician can and cannot end in their own
// clinical system). Dual-coded tidy is staged by dropping onto the
// Dual-coded lane. Tile-on-tile is a no-op unless both tiles already
// belong to the same duplicate group — that opens the merge modal.
//
// See docs/HAZARD-LOG.md H-060 / CLINICAL-SAFETY-NOTICE W13.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ───

  var WriteCore =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/write-core.js')
      : typeof window !== 'undefined'
        ? window.WriteCore
        : null;
  if (!WriteCore || typeof WriteCore.diffFinaliseOutcome !== 'function') {
    throw new Error(
      'WriteCore.diffFinaliseOutcome missing — load shared/write-core.js before allergy-cleanup-canvas.js'
    );
  }
  var diffFinaliseOutcome = WriteCore.diffFinaliseOutcome;

  var NKA_CONCEPT_ID = '716186003';
  var CLASSIFICATION_LANES = ['active', 'junk', 'convert', 'dual'];

  function normalizeDesc(desc) {
    return String(desc == null ? '' : desc)
      .trim()
      .toLowerCase();
  }

  function isNkaConcept(conceptId, description) {
    if (String(conceptId || '') === NKA_CONCEPT_ID) return true;
    return normalizeDesc(description) === 'no known allergies';
  }

  function truncateText(text, maxLen) {
    if (text == null) return null;
    var s = String(text).trim();
    if (!s) return null;
    var limit = typeof maxLen === 'number' && maxLen > 1 ? maxLen : 70;
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1).trim() + '…';
  }

  function flagsOf(snap) {
    return {
      junkById: (snap && snap.junkById) || {},
      convertById: (snap && snap.convertById) || {},
      dualById: (snap && snap.dualById) || {},
    };
  }

  // Live lane from the scan — junk wins (a junk-matched row is never also
  // offered convert/dual), then convert, then dual-coded, else Active. An
  // `adHoc` convert entry (registered on-demand when the tile's own "Convert…"
  // action is opened from a lane the scan never flagged — see
  // openConversionForAllergy's generalisation in allergy-cleanup.js) must NOT
  // move the tile into the Convert lane; it exists purely to give that one
  // review modal somewhere to keep its state, not to reclassify the row.
  function liveLaneKey(allergyId, flags) {
    var f = flags || {};
    if (f.junkById && f.junkById[allergyId]) return 'junk';
    var conv = f.convertById && f.convertById[allergyId];
    if (conv && !conv.adHoc) return 'convert';
    if (f.dualById && f.dualById[allergyId]) return 'dual';
    return 'active';
  }

  function partitionAllergiesByLane(allergies, flags) {
    var out = { active: [], junk: [], convert: [], dual: [] };
    (Array.isArray(allergies) ? allergies : []).forEach(function (a) {
      if (!a || !a.id) return;
      out[liveLaneKey(a.id, flags)].push(a);
    });
    return out;
  }

  function findDuplicateGroupIndex(allergyId, groups) {
    var list = Array.isArray(groups) ? groups : [];
    for (var i = 0; i < list.length; i++) {
      var entries = (list[i] && list[i].entries) || [];
      for (var j = 0; j < entries.length; j++) {
        if (entries[j] && entries[j].id === allergyId) return i;
      }
    }
    return -1;
  }

  function sameDuplicateGroup(idA, idB, groups) {
    if (!idA || !idB || idA === idB) return false;
    var ia = findDuplicateGroupIndex(idA, groups);
    if (ia === -1) return false;
    return ia === findDuplicateGroupIndex(idB, groups);
  }

  function buildDuplicatePairs(groups) {
    var pairs = [];
    (Array.isArray(groups) ? groups : []).forEach(function (g) {
      var entries = (g && g.entries) || [];
      var ids = entries
        .map(function (e) {
          return e && e.id;
        })
        .filter(Boolean);
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          pairs.push({ a: ids[i], b: ids[j] });
        }
      }
    });
    return pairs;
  }

  function isNotAnAllergy(convertFlag) {
    return !!(convertFlag && convertFlag.rule && convertFlag.rule.kind === 'not-an-allergy');
  }

  // Every tile can open the conversion/reaction-review card — every LANE
  // (2026-08-23: Active, Junk/low-rel and Dual-coded, not just Convert), and
  // regardless of whether the scan itself ever flagged it (an ad-hoc
  // convertById entry, `adHoc: true`, is registered on demand — see
  // window.AllergyCleanup.openConversionForAllergy). A single tile click
  // opens it directly (no separate "Convert…" button/step) — see the tile
  // click handler in bindCommonEvents. Two — and only two — exclusions,
  // both because "convert to a substance" is the wrong action for them, not
  // because of which lane they happen to render in:
  //   - a confirmed "not-an-allergy" match (its own hint already points at
  //     ending it instead — coding a substance+reaction for something
  //     that's not a genuine allergy would be actively wrong, not just
  //     unhelpful);
  //   - the "No known allergies" sentinel entry/entries (isNkaConcept) —
  //     structurally the OPPOSITE of an allergy, so there is no substance to
  //     convert it to; these keep the select-then-"Stage end" flow (and the
  //     last-remaining-NKA protection that only Stage end honours).
  // Every OTHER junk-lane row (a genuine but generically/badly-coded
  // allergy, e.g. "Allergic reaction") is now convert-eligible too — ending
  // it was never the only reasonable outcome, a clinician may equally judge
  // it fixable and want to search for the real substance instead.
  function isConvertEligible(allergyId, flags) {
    var f = flags || {};
    var junk = f.junkById && f.junkById[allergyId];
    if (junk && isNkaConcept(junk.conceptId, junk.description)) return false;
    var conv = f.convertById && f.convertById[allergyId];
    return !isNotAnAllergy(conv);
  }

  // Every allergy is endable from this canvas — RELAXED 2026-08-23, a
  // deliberate product decision, not a bug fix: it is not this tool's place
  // to restrict what a clinician can end in their own clinical system. The
  // underlying SNOMED history stays in the patient's journal regardless of
  // what the allergy list shows — that's where "was this ever
  // checked/coded" belongs, not the allergy section — and a short, current,
  // at-a-glance allergy list is the actual prescribing-safety goal. This
  // replaces the former hard block that only allowed ending junk-classified
  // or confirmed "not-an-allergy" rows, and the separate hard block against
  // ending the LAST "No known allergies" copy (see
  // rules/allergy-junk-codes.json's own note on that code, and
  // docs/HAZARD-LOG.md H-060's dated addendum for the full reasoning). The
  // only thing this still guards against is re-staging a row THIS session
  // already confirmed ended — junk/convert entries track `.ended` once a
  // write succeeds (allergy-cleanup.js's commitEndAllergies); a row with no
  // such flag yet has obviously not been ended.
  function isEndableClassification(allergyId, flags) {
    var f = flags || {};
    var junk = f.junkById && f.junkById[allergyId];
    if (junk) return !junk.ended;
    var conv = f.convertById && f.convertById[allergyId];
    if (conv) return !conv.ended;
    return true;
  }

  function canStageEnd(allergyId, flags) {
    if (!allergyId || !isEndableClassification(allergyId, flags)) return { ok: false, error: 'not-endable' };
    return { ok: true, error: null };
  }

  function canStageTidy(allergyId, flags) {
    var dual = flags && flags.dualById && flags.dualById[allergyId];
    return !!(dual && !dual.tidied);
  }

  function emptyDraft() {
    return { endIds: [], tidyIds: [] };
  }

  function cloneDraft(draft) {
    var src = draft || emptyDraft();
    return { endIds: (src.endIds || []).slice(), tidyIds: (src.tidyIds || []).slice() };
  }

  function hasDraftChanges(draft) {
    if (!draft) return false;
    return (draft.endIds && draft.endIds.length > 0) || (draft.tidyIds && draft.tidyIds.length > 0);
  }

  function stageEnd(draft, allergyId, flags) {
    var next = cloneDraft(draft);
    if (!allergyId) return { draft: next, error: 'A row must be chosen.' };
    if (next.endIds.indexOf(allergyId) !== -1) return { draft: next, error: null };
    var check = canStageEnd(allergyId, flags);
    if (!check.ok) return { draft: draft || emptyDraft(), error: check.error };
    next.endIds.push(allergyId);
    next.tidyIds = next.tidyIds.filter(function (id) {
      return id !== allergyId;
    });
    return { draft: next, error: null };
  }

  function unstageEnd(draft, allergyId) {
    var next = cloneDraft(draft);
    next.endIds = next.endIds.filter(function (id) {
      return id !== allergyId;
    });
    return next;
  }

  function stageTidy(draft, allergyId, flags) {
    var next = unstageEnd(draft || emptyDraft(), allergyId);
    if (!canStageTidy(allergyId, flags)) return { draft: next, error: 'not-tidyable' };
    if (next.tidyIds.indexOf(allergyId) === -1) next.tidyIds.push(allergyId);
    return { draft: next, error: null };
  }

  function unstageTidy(draft, allergyId) {
    var next = cloneDraft(draft);
    next.tidyIds = next.tidyIds.filter(function (id) {
      return id !== allergyId;
    });
    return next;
  }

  function allergiesNotEnded(allergies, draft) {
    var ended = {};
    ((draft && draft.endIds) || []).forEach(function (id) {
      ended[id] = true;
    });
    return (allergies || []).filter(function (a) {
      return a && a.id && !ended[a.id];
    });
  }

  function endedAllergyList(allergies, draft) {
    var byId = {};
    (allergies || []).forEach(function (a) {
      if (a && a.id) byId[a.id] = a;
    });
    return ((draft && draft.endIds) || [])
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean);
  }

  function summariseDraft(draft, descById) {
    var endIds = (draft && draft.endIds) || [];
    var tidyIds = (draft && draft.tidyIds) || [];
    var ends = endIds.map(function (id) {
      return { id: id, description: (descById && descById[id]) || id };
    });
    var tidies = tidyIds.map(function (id) {
      return { id: id, description: (descById && descById[id]) || id };
    });
    return { ends: ends, tidies: tidies, count: ends.length + tidies.length };
  }

  // Tile → tile: merge only inside a known duplicate group. Tile → End:
  // propose end (canStageEnd decides). Tile → Dual-coded lane: stage tidy.
  // Tile → Active: unstage tidy. Same-lane / self / unknown = no-op.
  function classifyDrop(payload, dropTarget, flags, groups) {
    if (!payload || !payload.allergyId || !dropTarget || !dropTarget.type) return null;
    if (dropTarget.type === 'tile') {
      if (!dropTarget.id || dropTarget.id === payload.allergyId) return null;
      if (!sameDuplicateGroup(payload.allergyId, dropTarget.id, groups)) return null;
      return { kind: 'merge', a: payload.allergyId, b: dropTarget.id };
    }
    if (dropTarget.type === 'lane') {
      if (CLASSIFICATION_LANES.indexOf(dropTarget.key) === -1) return null;
      if (dropTarget.key === 'dual') {
        if (!canStageTidy(payload.allergyId, flags)) return null;
        return { kind: 'tidy', allergyId: payload.allergyId };
      }
      if (dropTarget.key === 'active') {
        return { kind: 'unstage-tidy', allergyId: payload.allergyId };
      }
      return null;
    }
    if (dropTarget.type === 'bin') {
      return { kind: 'end', allergyId: payload.allergyId };
    }
    return null;
  }

  function readDropPayload(e) {
    var raw = '';
    try {
      raw = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
    } catch (_) {
      return null;
    }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.allergyId) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function relativeRect(rect, containerRect) {
    if (!rect || !containerRect) return null;
    return {
      top: rect.top - containerRect.top,
      left: rect.left - containerRect.left,
      width: rect.width,
      height: rect.height,
      right: rect.right - containerRect.left,
      bottom: rect.bottom - containerRect.top,
    };
  }

  function buildElbowConnectorPath(rectA, rectB, busX) {
    if (!rectA || !rectB || typeof busX !== 'number') return null;
    var xA = rectA.right;
    var yA = rectA.top + rectA.height / 2;
    var xB = rectB.right;
    var yB = rectB.top + rectB.height / 2;
    return 'M ' + xA + ' ' + yA + ' L ' + busX + ' ' + yA + ' L ' + busX + ' ' + yB + ' L ' + xB + ' ' + yB;
  }

  function computeLinkBusX(tileRects, margin, paneRightEdge) {
    var rects = (Array.isArray(tileRects) ? tileRects : []).filter(Boolean);
    if (!rects.length) return null;
    var maxRight = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.right;
      })
    );
    var m = typeof margin === 'number' ? margin : 16;
    var x = maxRight + m;
    if (typeof paneRightEdge === 'number') x = Math.min(x, paneRightEdge - 4);
    return x;
  }

  function groupLinkedPairsIntoSets(pairs) {
    var list = Array.isArray(pairs) ? pairs : [];
    var parent = {};
    function find(x) {
      while (parent[x] && parent[x] !== x) x = parent[x];
      return x;
    }
    function union(x, y) {
      var rx = find(x);
      var ry = find(y);
      if (rx !== ry) parent[rx] = ry;
    }
    list.forEach(function (p) {
      if (!p) return;
      if (!(p.a in parent)) parent[p.a] = p.a;
      if (!(p.b in parent)) parent[p.b] = p.b;
      union(p.a, p.b);
    });
    var setsByRoot = {};
    var order = [];
    list.forEach(function (p) {
      if (!p) return;
      var root = find(p.a);
      if (!setsByRoot[root]) {
        setsByRoot[root] = [];
        order.push(root);
      }
      setsByRoot[root].push(p);
    });
    return order.map(function (root) {
      return setsByRoot[root];
    });
  }

  function linkSetLaneX(baseX, setIndex, laneWidth) {
    if (typeof baseX !== 'number') return null;
    var w = typeof laneWidth === 'number' ? laneWidth : 14;
    return baseX + setIndex * w;
  }

  var LINK_SET_HUES = [221, 280, 180, 90, 320];
  function linkSetColor(index) {
    var i = typeof index === 'number' && index >= 0 ? index : 0;
    var hue = LINK_SET_HUES[i % LINK_SET_HUES.length];
    return 'hsl(' + hue + ', 65%, 42%)';
  }

  function elbowFlagPoint(rectA, rectB, busX) {
    if (!rectA || !rectB || typeof busX !== 'number') return null;
    var yA = rectA.top + rectA.height / 2;
    var yB = rectB.top + rectB.height / 2;
    return { x: busX, y: (yA + yB) / 2 };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      NKA_CONCEPT_ID: NKA_CONCEPT_ID,
      CLASSIFICATION_LANES: CLASSIFICATION_LANES,
      isNkaConcept: isNkaConcept,
      truncateText: truncateText,
      liveLaneKey: liveLaneKey,
      partitionAllergiesByLane: partitionAllergiesByLane,
      findDuplicateGroupIndex: findDuplicateGroupIndex,
      sameDuplicateGroup: sameDuplicateGroup,
      buildDuplicatePairs: buildDuplicatePairs,
      isNotAnAllergy: isNotAnAllergy,
      isConvertEligible: isConvertEligible,
      isEndableClassification: isEndableClassification,
      canStageEnd: canStageEnd,
      canStageTidy: canStageTidy,
      emptyDraft: emptyDraft,
      hasDraftChanges: hasDraftChanges,
      stageEnd: stageEnd,
      unstageEnd: unstageEnd,
      stageTidy: stageTidy,
      unstageTidy: unstageTidy,
      allergiesNotEnded: allergiesNotEnded,
      endedAllergyList: endedAllergyList,
      summariseDraft: summariseDraft,
      diffFinaliseOutcome: WriteCore.diffFinaliseOutcome,
      classifyDrop: classifyDrop,
      readDropPayload: readDropPayload,
      relativeRect: relativeRect,
      buildElbowConnectorPath: buildElbowConnectorPath,
      computeLinkBusX: computeLinkBusX,
      groupLinkedPairsIntoSets: groupLinkedPairsIntoSets,
      linkSetLaneX: linkSetLaneX,
      linkSetColor: linkSetColor,
      elbowFlagPoint: elbowFlagPoint,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msAllergyCleanupCanvas) return;
  window.__msAllergyCleanupCanvas = true;

  var OVERLAY_ID = 'ms-acc-overlay';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssEscapeId(id) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id);
    return String(id).replace(/["\\]/g, '\\$&');
  }

  var _subscribed = false;
  var _resizeBound = false;
  var _pendingAction = null;
  var _draft = emptyDraft();
  var _dragPayload = null;
  var _lineUpdateScheduled = false;
  var _selectedTileId = null;
  var _kbPickedId = null;
  var _openedPatientId = null;
  var _stageError = null;

  function announce(text) {
    var live = document.querySelector('#' + OVERLAY_ID + ' .ms-acc-live');
    if (live) live.textContent = text;
  }

  function captureFocusedAllergyId(root) {
    var a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    return (a.getAttribute && a.getAttribute('data-allergy-id')) || null;
  }

  function restoreFocusedAllergyId(root, id) {
    if (!id) return;
    var target = root.querySelector('[data-allergy-id="' + cssEscapeId(id) + '"]');
    if (target && typeof target.focus === 'function') target.focus();
  }

  function snapshotFlags() {
    if (!window.AllergyCleanup) return { junkById: {}, convertById: {}, dualById: {} };
    return flagsOf(window.AllergyCleanup.getSnapshot());
  }

  function tileActionsHtml(allergy, flags, groups) {
    var id = allergy.id;
    var buttons = [];
    if (isEndableClassification(id, flags)) {
      buttons.push(
        '<button type="button" class="ms-acc-tile-action" data-action="end" data-target-id="' +
          esc(id) +
          '">Stage end</button>'
      );
    }
    if (canStageTidy(id, flags)) {
      buttons.push(
        '<button type="button" class="ms-acc-tile-action" data-action="tidy" data-target-id="' +
          esc(id) +
          '">Stage tidy</button>'
      );
    }
    // No "Convert…" button here (2026-08-23: removed as an unnecessary extra
    // step) — every tile eligible for conversion opens the review card
    // straight from a single click, see the tile click handler below.
    if (findDuplicateGroupIndex(id, groups) !== -1) {
      buttons.push(
        '<button type="button" class="ms-acc-tile-action" data-action="merge" data-target-id="' +
          esc(id) +
          '">Review duplicates…</button>'
      );
    }
    if (!buttons.length) return '';
    return '<div class="ms-acc-tile-actions">' + buttons.join('') + '</div>';
  }

  function tileHtml(allergy, flags, groups, opts) {
    if (!allergy || !allergy.id) return '';
    opts = opts || {};
    var id = allergy.id;
    var junk = flags.junkById[id];
    var conv = flags.convertById[id];
    var dual = flags.dualById[id];
    var stagedTidy = opts.tidyIds && opts.tidyIds.indexOf(id) !== -1;
    var selected = opts.selectedId === id;
    var picked = opts.pickedId === id;
    var displayDate = allergy.onsetDate || allergy.recordDate || null;
    // Coded reaction(s) inline with the substance name (2026-08-23 request
    // — "Tramadol - nausea", or "- nausea, diarrhoea, skin rash" for
    // several) — additionalInformation free text stays a separate line
    // underneath (the existing `info` hint below), unchanged.
    var reactionsText =
      allergy.reactions && allergy.reactions.length ? allergy.reactions.join(', ') : null;
    var info = truncateText(allergy.additionalInformation, 70);
    var groupIdx = findDuplicateGroupIndex(id, groups);
    var hints = [];
    if (junk && junk.caution) hints.push('<div class="ms-acc-tile-warn">⚠ ' + esc(junk.caution) + '</div>');
    if (conv && isNotAnAllergy(conv)) {
      hints.push(
        '<div class="ms-acc-tile-hint">' +
          esc((conv.rule && conv.rule.notes) || 'This may not be a genuine allergy — consider ending it.') +
          '</div>'
      );
    } else if (conv && !conv.adHoc) {
      hints.push('<div class="ms-acc-tile-hint">Pre-defined-allergy code — convert to a substance</div>');
    }
    if (dual) {
      hints.push(
        '<div class="ms-acc-tile-hint">Legacy: ' +
          esc((dual.legacyCode && dual.legacyCode.description) || 'old code') +
          ' · Substance: ' +
          esc((dual.substance && dual.substance.description) || 'current') +
          '</div>'
      );
      if (dual.tidyError) hints.push('<div class="ms-acc-tile-warn">⚠ ' + esc(dual.tidyError) + '</div>');
    }
    if (groupIdx !== -1) hints.push('<div class="ms-acc-tile-hint">Possible duplicate</div>');
    if (info) hints.push('<div class="ms-acc-tile-info">' + esc(info) + '</div>');
    return (
      '<div class="ms-acc-tile-row">' +
      '<div class="ms-acc-tile' +
      (selected ? ' ms-acc-tile-selected' : '') +
      (picked ? ' ms-acc-tile-picked' : '') +
      (stagedTidy ? ' ms-acc-tile-staged' : '') +
      (junk && junk.caution ? ' ms-acc-tile-caution' : '') +
      '" draggable="true" tabindex="0" data-allergy-id="' +
      esc(id) +
      '"' +
      (groupIdx !== -1 ? ' data-dup-group="' + esc(groupIdx) + '"' : '') +
      '>' +
      '<div class="ms-acc-tile-main">' +
      '<div class="ms-acc-tile-desc">' +
      esc(allergy.description || id) +
      (reactionsText
        ? ' <span class="ms-acc-tile-desc-reactions">- ' + esc(reactionsText) + '</span>'
        : '') +
      '</div>' +
      (displayDate ? '<div class="ms-acc-tile-date">' + esc(displayDate) + '</div>' : '') +
      '</div>' +
      hints.join('') +
      '</div>' +
      (selected ? tileActionsHtml(allergy, flags, groups) : '') +
      '</div>'
    );
  }

  function laneHtml(key, label, allergies, flags, groups, opts) {
    var list = Array.isArray(allergies) ? allergies : [];
    return (
      '<div class="ms-acc-lane" data-acc-lane="' +
      esc(key) +
      '" tabindex="0" aria-label="' +
      esc(label) +
      '">' +
      '<div class="ms-acc-lane-heading">' +
      esc(label) +
      (list.length ? ' (' + list.length + ')' : '') +
      '</div>' +
      (list.length
        ? '<div class="ms-acc-lane-list">' +
          list
            .map(function (a) {
              return tileHtml(a, flags, groups, opts);
            })
            .join('') +
          '</div>'
        : '<div class="ms-acc-empty">None</div>') +
      '</div>'
    );
  }

  function binTileHtml(allergy, flags) {
    if (!allergy || !allergy.id) return '';
    var junk = flags && flags.junkById && flags.junkById[allergy.id];
    var conv = flags && flags.convertById && flags.convertById[allergy.id];
    var endError = (junk && junk.endError) || (conv && conv.endError) || null;
    return (
      '<div class="ms-acc-tile ms-acc-bin-tile" draggable="true" tabindex="0" data-allergy-id="' +
      esc(allergy.id) +
      '">' +
      '<div class="ms-acc-tile-main"><div class="ms-acc-tile-desc">' +
      esc(allergy.description || allergy.id) +
      '</div></div>' +
      (endError ? '<div class="ms-acc-tile-warn">⚠ ' + esc(endError) + '</div>' : '') +
      '</div>'
    );
  }

  function binHtml(endedAllergies, flags) {
    var list = Array.isArray(endedAllergies) ? endedAllergies : [];
    return (
      '<div class="ms-acc-bin" data-end-bin tabindex="0" aria-label="End allergies (' +
      list.length +
      ' staged)">' +
      '<div class="ms-acc-bin-heading">End' +
      (list.length ? ' (' + list.length + ')' : '') +
      '</div>' +
      (list.length
        ? '<div class="ms-acc-bin-list">' +
          list
            .map(function (a) {
              return binTileHtml(a, flags);
            })
            .join('') +
          '</div>'
        : '<div class="ms-acc-bin-hint">Drop any allergy here to stage it for ending. Nothing is ended until you Finalise.</div>') +
      '</div>'
    );
  }

  function confirmBarHtml() {
    var d = _pendingAction;
    if (!d) return '';
    var message = '';
    var confirmLabel = 'Confirm';
    var busyLabel = 'Working…';
    if (d.kind === 'finalise') {
      var bits = [];
      if (d.ends && d.ends.length) {
        bits.push(
          'end ' +
            d.ends.length +
            ' allerg' +
            (d.ends.length === 1 ? 'y' : 'ies') +
            ' (' +
            d.ends
              .slice(0, 8)
              .map(function (x) {
                return esc(x.description);
              })
              .join('; ') +
            (d.ends.length > 8 ? '…' : '') +
            ')'
        );
      }
      if (d.tidies && d.tidies.length) {
        bits.push(
          'clear the stale legacy code from ' +
            d.tidies.length +
            ' entr' +
            (d.tidies.length === 1 ? 'y' : 'ies') +
            ' (substance and clinical detail stay)'
        );
      }
      message =
        'This will write everything you have staged, via Medicus’s own forms. There is no canvas undo. ' +
        bits.join(' · ') +
        '.';
      confirmLabel = 'Confirm — write all ' + d.count;
      busyLabel = 'Writing…';
    } else if (d.kind === 'abandon') {
      message =
        'You have <strong>' +
        (d.count || 0) +
        '</strong> unwritten staged change' +
        ((d.count || 0) === 1 ? '' : 's') +
        '. Discard them and close?';
      confirmLabel = 'Discard and close';
    } else if (d.kind === 'discard') {
      message =
        'Discard <strong>' +
        (d.count || 0) +
        '</strong> staged change' +
        ((d.count || 0) === 1 ? '' : 's') +
        ' and put the tiles back? Nothing has been written.';
      confirmLabel = 'Discard staged';
    } else {
      return '';
    }
    return (
      '<div class="ms-acc-confirmbar">' +
      message +
      '<div class="ms-acc-confirmbar-actions">' +
      '<button type="button" class="ms-acc-cancel" id="ms-acc-action-cancel"' +
      (d.working ? ' disabled' : '') +
      '>Cancel</button>' +
      '<button type="button" class="ms-acc-confirm-btn" id="ms-acc-action-confirm"' +
      (d.working ? ' disabled' : '') +
      '>' +
      (d.working ? busyLabel : confirmLabel) +
      '</button>' +
      '</div>' +
      (d.error ? '<div class="ms-acc-card-error">' + esc(d.error) + '</div>' : '') +
      '</div>'
    );
  }

  function footerHtml(summary) {
    if (!summary || !summary.count) return '';
    var bits = [];
    if (summary.ends.length) bits.push(summary.ends.length + ' to end');
    if (summary.tidies.length) bits.push(summary.tidies.length + ' to tidy');
    return (
      '<div class="ms-acc-footer">' +
      '<span class="ms-acc-draft-summary">' +
      summary.count +
      ' staged (' +
      bits.join(', ') +
      ') — not written yet</span>' +
      '<button type="button" class="ms-acc-discard" id="ms-acc-discard">Discard staged</button>' +
      '<button type="button" class="ms-acc-finalise" id="ms-acc-finalise">Finalise…</button>' +
      '</div>'
    );
  }

  function wrapPanel(contentHtml) {
    return (
      '<div class="ms-acc-backdrop">' +
      '<div class="ms-acc-panel" role="dialog" aria-modal="true" aria-label="Organise allergies">' +
      '<div class="ms-acc-header"><h2 class="ms-acc-title">Organise allergies</h2>' +
      '<button type="button" class="ms-acc-close" id="ms-acc-close">Close</button></div>' +
      contentHtml +
      '</div>' +
      '</div>'
    );
  }

  function bodyHtml(lanes, endedAllergies, flags, groups, opts) {
    return (
      '<div class="ms-acc-explainer">Drag any row onto <strong>End</strong> to stage it for ending; drop a ' +
      'dual-coded tile onto <strong>Dual-coded</strong> to stage clearing the stale legacy code; drop one ' +
      'duplicate onto its pair to review a merge. Click a tile to review or improve its coding. Arrange as ' +
      'many as you like, then <strong>Finalise</strong>.</div>' +
      (_stageError ? '<div class="ms-acc-stage-error">' + esc(_stageError) + '</div>' : '') +
      '<div class="ms-acc-body">' +
      '<svg class="ms-acc-lines" aria-hidden="true"></svg>' +
      '<div class="ms-acc-lanes" id="ms-acc-lanes">' +
      laneHtml('active', 'Active', lanes.active, flags, groups, opts) +
      laneHtml('junk', 'Junk / low-rel', lanes.junk, flags, groups, opts) +
      laneHtml('convert', 'Convert', lanes.convert, flags, groups, opts) +
      laneHtml('dual', 'Dual-coded', lanes.dual, flags, groups, opts) +
      binHtml(endedAllergies, flags) +
      '</div>' +
      '</div>'
    );
  }

  function updateConnectorLines(root) {
    var svg = root.querySelector('.ms-acc-lines');
    var body = root.querySelector('.ms-acc-body');
    if (!svg || !body) return;
    var containerRect = body.getBoundingClientRect();
    svg.setAttribute('width', String(containerRect.width));
    svg.setAttribute('height', String(containerRect.height));
    var tileRects = [];
    root.querySelectorAll('.ms-acc-lane .ms-acc-tile[data-allergy-id]').forEach(function (tile) {
      tileRects.push(relativeRect(tile.getBoundingClientRect(), containerRect));
    });
    var pane = root.querySelector('#ms-acc-lanes');
    var paneRight = pane ? relativeRect(pane.getBoundingClientRect(), containerRect).right : undefined;
    var busX = computeLinkBusX(tileRects, 16, paneRight);
    if (busX === null) {
      svg.innerHTML = '';
      return;
    }
    function tileRect(id) {
      var tile = root.querySelector('.ms-acc-lane .ms-acc-tile[data-allergy-id="' + cssEscapeId(id) + '"]');
      return tile ? relativeRect(tile.getBoundingClientRect(), containerRect) : null;
    }
    var snap = window.AllergyCleanup ? window.AllergyCleanup.getSnapshot() : { duplicateGroups: [] };
    var pairs = buildDuplicatePairs(snap.duplicateGroups);
    var visible = {};
    root.querySelectorAll('.ms-acc-lane .ms-acc-tile[data-allergy-id]').forEach(function (tile) {
      visible[tile.getAttribute('data-allergy-id')] = true;
    });
    pairs = pairs.filter(function (p) {
      return visible[p.a] && visible[p.b];
    });
    var markup = [];
    var nextLane = 0;
    groupLinkedPairsIntoSets(pairs).forEach(function (setPairs) {
      var laneX = linkSetLaneX(busX, nextLane, 14);
      var color = linkSetColor(nextLane);
      nextLane++;
      setPairs.forEach(function (pair) {
        var rectA = tileRect(pair.a);
        var rectB = tileRect(pair.b);
        if (!rectA || !rectB) return;
        var d = buildElbowConnectorPath(rectA, rectB, laneX);
        if (!d) return;
        markup.push('<path d="' + d + '" class="ms-acc-dup-line" style="stroke: ' + color + '"></path>');
        var pt = elbowFlagPoint(rectA, rectB, laneX);
        if (pt) {
          markup.push(
            '<g class="ms-acc-flag-group"><title>Possible duplicate — drop one tile on the other to review a merge</title>' +
              '<rect x="' +
              (pt.x - 7) +
              '" y="' +
              (pt.y - 7) +
              '" width="14" height="14" rx="3" class="ms-acc-flag"></rect>' +
              '<text x="' +
              pt.x +
              '" y="' +
              pt.y +
              '" class="ms-acc-flag-label" text-anchor="middle" dominant-baseline="central">D</text></g>'
          );
        }
      });
    });
    svg.innerHTML = markup.join('');
  }

  function scheduleLineUpdate() {
    if (_lineUpdateScheduled) return;
    _lineUpdateScheduled = true;
    requestAnimationFrame(function () {
      _lineUpdateScheduled = false;
      var el = document.getElementById(OVERLAY_ID);
      var root = el && el.querySelector('.ms-acc-root');
      if (root) updateConnectorLines(root);
    });
  }

  function proposeEnd(allergyId, snap) {
    var flags = flagsOf(snap);
    var result = stageEnd(_draft, allergyId, flags);
    if (result.error === 'not-endable') {
      // Every allergy is endable now (see isEndableClassification's own
      // comment) — this only fires for a row THIS session already
      // confirmed ended.
      _stageError = 'That row was already ended in this session.';
      announce(_stageError);
      render();
      return;
    }
    _stageError = null;
    _draft = result.draft;
    _kbPickedId = null;
    announce(
      'Staged end for ' +
        (
          (snap.allergies || []).find(function (a) {
            return a.id === allergyId;
          }) || {}
        ).description
    );
    render();
  }

  function proposeTidy(allergyId, snap) {
    var result = stageTidy(_draft, allergyId, flagsOf(snap));
    if (result.error) {
      _stageError =
        'Only a dual-coded entry (legacy code alongside an already-correct substance) can be staged for tidy.';
      announce(_stageError);
      render();
      return;
    }
    _stageError = null;
    _draft = result.draft;
    _kbPickedId = null;
    announce('Staged tidy for that entry.');
    render();
  }

  function proposeUnstageTidy(allergyId) {
    _draft = unstageTidy(_draft, allergyId);
    _stageError = null;
    render();
  }

  function proposeMerge(allergyId) {
    if (!window.AllergyCleanup) return;
    window.AllergyCleanup.openReviewForAllergy(allergyId);
  }

  function proposeConvert(allergyId) {
    if (!window.AllergyCleanup) return;
    window.AllergyCleanup.openConversionForAllergy(allergyId);
  }

  function proposeFinalise(snap) {
    var descById = {};
    (snap.allergies || []).forEach(function (a) {
      if (a && a.id) descById[a.id] = a.description;
    });
    var summary = summariseDraft(_draft, descById);
    if (!summary.count) return;
    _pendingAction = {
      kind: 'finalise',
      ends: summary.ends,
      tidies: summary.tidies,
      count: summary.count,
      working: false,
      error: null,
    };
    render();
  }

  function proposeDiscard() {
    var summary = summariseDraft(_draft, {});
    _pendingAction = { kind: 'discard', count: summary.count, working: false, error: null };
    render();
  }

  async function confirmPendingAction() {
    var d = _pendingAction;
    if (!d || d.working || !window.AllergyCleanup) return;
    if (window.AllergyCleanup.getSnapshot().patientId !== _openedPatientId) {
      close();
      return;
    }
    if (d.kind === 'discard') {
      _draft = emptyDraft();
      _pendingAction = null;
      announce('Discarded staged changes.');
      render();
      return;
    }
    if (d.kind === 'abandon') {
      close();
      return;
    }
    if (d.kind !== 'finalise') return;
    d.working = true;
    render();
    try {
      // deferReload on both commits: this gesture chains ends then tidies,
      // so the engine's own post-success reload (scheduled 900ms after the
      // ends land) could fire while the tidy writes are still in flight.
      // The canvas owns the single reload below, after BOTH phases report.
      var wantEnd = _draft.endIds.slice();
      var wantTidy = _draft.tidyIds.slice();
      var endResult = { ended: [], skipped: false };
      var tidyResult = { tidied: [], skipped: false };
      if (wantEnd.length) endResult = await window.AllergyCleanup.commitEndAllergies(wantEnd, { deferReload: true });
      if (window.AllergyCleanup.getSnapshot().patientId !== _openedPatientId) {
        close();
        return;
      }
      if (wantTidy.length) tidyResult = await window.AllergyCleanup.commitClearLegacy(wantTidy, { deferReload: true });
      if (window.AllergyCleanup.getSnapshot().patientId !== _openedPatientId) {
        close();
        return;
      }
      var outcome = diffFinaliseOutcome(wantEnd, wantTidy, endResult.ended, tidyResult.tidied);
      if (outcome.allWritten) {
        _draft = emptyDraft();
        _pendingAction = null;
        announce(
          (outcome.written === 1
            ? 'The staged change was written.'
            : 'All ' + outcome.written + ' staged changes were written.') + ' Reloading to show the updated list…'
        );
        render();
        setTimeout(function () {
          location.reload();
        }, 900);
        return;
      }
      // A write failed (or the bridge refused a row) — keep exactly those
      // rows staged so nothing silently disappears, and say so. Success is
      // never claimed for a write that did not come back confirmed.
      _draft = { endIds: outcome.failedEnds, tidyIds: outcome.failedTidies };
      d.working = false;
      d.error =
        (outcome.written ? outcome.written + ' of ' + outcome.wanted + ' staged changes were written. ' : '') +
        outcome.failed +
        ' could not be written and ' +
        (outcome.failed === 1 ? 'is' : 'are') +
        ' still staged — the record is unchanged for ' +
        (outcome.failed === 1 ? 'that row' : 'those rows') +
        '. Check each staged row for its error, then Finalise again. Nothing is retried automatically.';
      announce(d.error);
      render();
    } catch (err) {
      d.working = false;
      d.error = (err && err.message) || 'Could not write the staged changes.';
      render();
    }
  }

  function bindCommonEvents(root) {
    root.querySelector('#ms-acc-close')?.addEventListener('click', requestClose);
    root.querySelector('.ms-acc-backdrop')?.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) requestClose();
    });
  }

  function bindEvents(root, snap) {
    bindCommonEvents(root);
    root.querySelector('#ms-acc-action-cancel')?.addEventListener('click', function () {
      _pendingAction = null;
      render();
    });
    root.querySelector('#ms-acc-action-confirm')?.addEventListener('click', function () {
      confirmPendingAction();
    });
    var descById = {};
    (snap.allergies || []).forEach(function (a) {
      if (a && a.id) descById[a.id] = a.description;
    });
    root.querySelector('#ms-acc-finalise')?.addEventListener('click', function () {
      proposeFinalise(snap);
    });
    root.querySelector('#ms-acc-discard')?.addEventListener('click', function () {
      proposeDiscard();
    });

    var flags = flagsOf(snap);

    root.querySelectorAll('.ms-acc-lane .ms-acc-tile[data-allergy-id]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var id = tile.getAttribute('data-allergy-id');
        // 2026-08-23: no more "select tile, then click Convert…" — a single
        // click on ANY convert-eligible tile opens the review card directly,
        // in every lane (see isConvertEligible's own comment for the two
        // exclusions: a confirmed "not-an-allergy" match, and the NKA
        // sentinel entry). Those two fall through to the ordinary
        // select-and-show-actions behaviour instead, e.g. Stage end.
        if (isConvertEligible(id, flags)) {
          _selectedTileId = null;
          proposeConvert(id);
          return;
        }
        _selectedTileId = _selectedTileId === id ? null : id;
        render();
      });
    });

    root.querySelectorAll('.ms-acc-tile-action').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-target-id');
        var action = btn.getAttribute('data-action');
        if (!id || !action) return;
        if (action === 'end') proposeEnd(id, snap);
        else if (action === 'tidy') proposeTidy(id, snap);
        else if (action === 'merge') proposeMerge(id);
      });
    });

    var clearDrag = function () {
      _dragPayload = null;
    };
    root.querySelectorAll('[draggable="true"][data-allergy-id]').forEach(function (tile) {
      tile.addEventListener('dragstart', function (e) {
        var id = tile.getAttribute('data-allergy-id');
        _dragPayload = { allergyId: id };
        e.dataTransfer.setData('text/plain', JSON.stringify(_dragPayload));
        e.dataTransfer.effectAllowed = 'move';
      });
      tile.addEventListener('dragend', clearDrag);
    });

    function applyClassifiedDrop(payload, dropTarget) {
      var classified = classifyDrop(payload, dropTarget, flags, snap.duplicateGroups);
      if (!classified) {
        if (dropTarget && dropTarget.type === 'tile') {
          _stageError = 'Those two rows are not a detected duplicate pair — a merge is never guessed.';
          announce(_stageError);
          render();
        }
        return;
      }
      if (classified.kind === 'merge') proposeMerge(classified.a);
      else if (classified.kind === 'end') proposeEnd(classified.allergyId, snap);
      else if (classified.kind === 'tidy') proposeTidy(classified.allergyId, snap);
      else if (classified.kind === 'unstage-tidy') proposeUnstageTidy(classified.allergyId);
    }

    root.querySelectorAll('.ms-acc-lane .ms-acc-tile[data-allergy-id]').forEach(function (tile) {
      tile.addEventListener('dragover', function (e) {
        if (!_dragPayload) return;
        var targetId = tile.getAttribute('data-allergy-id');
        if (targetId === _dragPayload.allergyId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.stopPropagation();
      });
      tile.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var payload = readDropPayload(e) || _dragPayload;
        _dragPayload = null;
        if (!payload) return;
        applyClassifiedDrop(payload, { type: 'tile', id: tile.getAttribute('data-allergy-id') });
      });
    });

    root.querySelectorAll('[data-acc-lane]').forEach(function (lane) {
      lane.addEventListener('dragover', function (e) {
        if (!_dragPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        lane.classList.add('ms-acc-drop-hover');
      });
      lane.addEventListener('dragleave', function (e) {
        if (lane.contains(e.relatedTarget)) return;
        lane.classList.remove('ms-acc-drop-hover');
      });
      lane.addEventListener('drop', function (e) {
        e.preventDefault();
        lane.classList.remove('ms-acc-drop-hover');
        var payload = readDropPayload(e) || _dragPayload;
        _dragPayload = null;
        if (!payload) return;
        applyClassifiedDrop(payload, { type: 'lane', key: lane.getAttribute('data-acc-lane') });
      });
    });

    var bin = root.querySelector('[data-end-bin]');
    if (bin) {
      bin.addEventListener('dragover', function (e) {
        if (!_dragPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        bin.classList.add('ms-acc-drop-hover');
      });
      bin.addEventListener('dragleave', function (e) {
        if (bin.contains(e.relatedTarget)) return;
        bin.classList.remove('ms-acc-drop-hover');
      });
      bin.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        bin.classList.remove('ms-acc-drop-hover');
        var payload = readDropPayload(e) || _dragPayload;
        _dragPayload = null;
        if (!payload) return;
        applyClassifiedDrop(payload, { type: 'bin' });
      });
    }

    root.querySelectorAll('.ms-acc-tile[data-allergy-id]').forEach(function (tile) {
      tile.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        var id = tile.getAttribute('data-allergy-id');
        if (!id) return;
        if (!_kbPickedId) {
          _kbPickedId = id;
          announce(
            'Picked up ' +
              (descById[id] || 'allergy') +
              '. Move focus to a duplicate, the Dual-coded lane, or End, then press Enter. Press Escape to cancel.'
          );
          render();
          return;
        }
        if (_kbPickedId === id) {
          _kbPickedId = null;
          announce('Cancelled — nothing picked up.');
          render();
          return;
        }
        var childId = _kbPickedId;
        _kbPickedId = null;
        applyClassifiedDrop({ allergyId: childId }, { type: 'tile', id: id });
      });
    });

    root.querySelectorAll('[data-acc-lane]').forEach(function (lane) {
      lane.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!_kbPickedId) return;
        if (e.target !== lane) return;
        e.preventDefault();
        e.stopPropagation();
        var childId = _kbPickedId;
        _kbPickedId = null;
        applyClassifiedDrop({ allergyId: childId }, { type: 'lane', key: lane.getAttribute('data-acc-lane') });
      });
    });
    root.querySelector('[data-end-bin]')?.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!_kbPickedId) return;
      e.preventDefault();
      e.stopPropagation();
      var childId = _kbPickedId;
      _kbPickedId = null;
      applyClassifiedDrop({ allergyId: childId }, { type: 'bin' });
    });

    root.querySelectorAll('.ms-acc-lane, .ms-acc-bin').forEach(function (pane) {
      pane.addEventListener('scroll', scheduleLineUpdate);
    });
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    var modal = document.getElementById('ms-ac-modal-root');
    if (modal && modal.style.display !== 'none') return;
    if (_kbPickedId) {
      _kbPickedId = null;
      announce('Cancelled — nothing picked up.');
      render();
      return;
    }
    requestClose();
  }

  function open() {
    if (document.getElementById(OVERLAY_ID)) return;
    if (!window.AllergyCleanup) return;
    window.AllergyCleanup.ensureScanned();
    _pendingAction = null;
    _draft = emptyDraft();
    _kbPickedId = null;
    _selectedTileId = null;
    _stageError = null;
    _openedPatientId = window.AllergyCleanup.getSnapshot().patientId;
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.innerHTML =
      '<div class="ms-acc-live" role="status" aria-live="polite"></div>' + '<div class="ms-acc-root"></div>';
    document.body.appendChild(el);
    render();
    document.addEventListener('keydown', onKeydown);
    if (!_resizeBound) {
      _resizeBound = true;
      window.addEventListener('resize', scheduleLineUpdate);
    }
    if (!_subscribed && window.AllergyCleanup.onChange) {
      _subscribed = true;
      window.AllergyCleanup.onChange(render);
    }
  }

  function requestClose() {
    if (hasDraftChanges(_draft)) {
      var summary = summariseDraft(_draft, {});
      _pendingAction = { kind: 'abandon', count: summary.count, working: false, error: null };
      render();
      return;
    }
    close();
  }

  function close() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', onKeydown);
    _pendingAction = null;
    _draft = emptyDraft();
    _selectedTileId = null;
    _kbPickedId = null;
    _openedPatientId = null;
    _stageError = null;
  }

  function render() {
    var el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    var root = el.querySelector('.ms-acc-root');
    if (!root) return;
    if (!window.AllergyCleanup) {
      root.innerHTML = wrapPanel(
        '<div class="ms-acc-body-msg ms-acc-error">This tool needs to be opened from the "Clean up allergies?" button.</div>'
      );
      bindCommonEvents(root);
      return;
    }
    var snap = window.AllergyCleanup.getSnapshot();
    if (_openedPatientId !== null && snap.patientId !== _openedPatientId) {
      close();
      return;
    }
    var focusId = captureFocusedAllergyId(root);
    if (snap.scanState === 'scanning' || snap.scanState === 'idle') {
      if (snap.scanState === 'idle') window.AllergyCleanup.ensureScanned();
      root.innerHTML = wrapPanel('<div class="ms-acc-body-msg ms-acc-loading">Scanning the allergy list…</div>');
      bindCommonEvents(root);
      return;
    }
    if (snap.scanState === 'error') {
      root.innerHTML = wrapPanel(
        '<div class="ms-acc-body-msg ms-acc-error">' +
          esc(snap.scanError || 'Could not scan the allergy list.') +
          ' <button type="button" id="ms-acc-retry">Retry</button></div>'
      );
      bindCommonEvents(root);
      root.querySelector('#ms-acc-retry')?.addEventListener('click', function () {
        window.AllergyCleanup.ensureScanned();
      });
      return;
    }
    var flags = flagsOf(snap);
    var visible = allergiesNotEnded(snap.allergies, _draft);
    var ended = endedAllergyList(snap.allergies, _draft);
    var lanes = partitionAllergiesByLane(visible, flags);
    var descById = {};
    (snap.allergies || []).forEach(function (a) {
      if (a && a.id) descById[a.id] = a.description;
    });
    var draftSummary = summariseDraft(_draft, descById);
    var opts = {
      selectedId: _selectedTileId,
      pickedId: _kbPickedId,
      tidyIds: _draft.tidyIds,
    };
    root.innerHTML = wrapPanel(
      bodyHtml(lanes, ended, flags, snap.duplicateGroups, opts) + confirmBarHtml() + footerHtml(draftSummary)
    );
    bindEvents(root, snap);
    updateConnectorLines(root);
    restoreFocusedAllergyId(root, focusId);
  }

  window.AllergyCleanupCanvas = { open: open, close: close };
})();
