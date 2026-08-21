// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Organise problems" canvas overlay
//
// PURPOSE (user request 2026-08-08, expanded 2026-08-17, tray folded into
// the tiles 2026-08-19): a visual, drag-and-drop organiser for the problem
// list. Three significance lanes (Major / Minor / Unresolved) each hold
// their own nest tree; an End bin resolves a problem. There is no separate
// suggestion pane any more — a SNOMED-ancestry or "(Grouped with X)"
// text-link suggestion now renders as a dotted line straight onto the
// suggested tile itself (see tileHtml/annotateTreeSuggestions), and dragging
// that tile onto its match confirms it via the SAME general tile-onto-tile
// gesture as any other nest/link. Dropping on a lane or the End bin STAGES
// the change on the canvas — tiles move immediately, nothing is written —
// until Finalise commits the whole draft.
// Existing single-action buttons: Clean up code stays on the page.
// "Bulk remove/merge" is retired (2026-08-21) — End + merge live on this
// canvas. "Change significance" is no longer a page button (2026-08-19) — it
// now happens by dragging a tile between the canvas's own significance
// lanes, and the tray's old "Unknown significance, pick a grade" card is
// gone with it — the Unresolved lane already IS that decision, dragging out
// of it already stages it.
//
// TILE ACTIONS (revised 2026-08-08 — clicking the connector line to unlink
// wasn't intuitive enough): clicking a tree-pane tile reveals two buttons
// beside it — "Remove link" (only when the tile has a parent) and "Edit
// problem…" (always), plus (2026-08-19) the relationship-choice buttons for
// a pending "(Grouped with X)" text-link suggestion, if this tile carries
// one. Only one tile's actions show at a time.
//
// "Edit problem" opens problem-description-cleanup.js's own review panel
// (same-concept alternatives, descendant/laterality, cross-concept,
// generic-import-text, severity-contradiction, and — since 2026-08-19, once
// this canvas became the primary way to reach it — retirement/legacy-Read-
// code detection too, run per-problem instead of duplicating the separate
// opt-in scan's whole-patient pass) for ANY problem, not just ones its own
// text-pattern scan already flagged. It renders as a
// modal ON TOP of this canvas (never closes it — "I would prefer not to
// close the canvas... this is helpful precisely because it gives a genuine
// view of the whole problem page") via a persistent #ms-pnc-edit-overlay
// sibling of .ms-pnc-root that render() never rebuilds, so the embedded
// panel survives every canvas re-render.
//
// This file owns NO state and makes NO API calls of its own — every read
// (the live scan) and every write (commitParentLink, commitUnlink,
// wouldCreateCycle) goes through window.ProblemNesting, the bridge
// problem-nesting.js exposes at the bottom of its own IIFE, plus
// window.ProblemDescriptionCleanup.openInContainer/close for the embedded
// edit panel. That keeps every piece of scan/commit/cycle-guard/alternative-
// search logic in exactly one place, already tested — this file is a view
// over them, not a second implementation of either.
//
// LAYOUT, deliberately NOT a free-form node canvas: tiles have no persisted
// position. The tree is always recomputed from (sort-by-date + the live
// parent map); a drag or a tile click is a pure gesture, not a placement to
// remember. A confirmed change re-renders the whole tree from scratch.
//
// TWO coordinate-math connector mechanisms plus one purely-visual stub:
//   - Left-pane parent→children connectors are purely visual — simple
//     nested-DOM + CSS (a small stub between the branch's indent guide and
//     each child's tile), no coordinate math, no click handler.
//   - Linked-problem lines AND suggestion lines (2026-08-19: the two were
//     unified onto ONE elbow/bus mechanism — see updateConnectorLines'
//     own comment) both connect two TREE tiles that can sit anywhere
//     relative to each other — no hierarchy constrains their position,
//     unlike parent/child. Every line's horizontal arm reaches out from
//     its own tile's right edge to a SHARED vertical bus (computeLinkBusX),
//     each connected SET (groupLinkedPairsIntoSets: pairs sharing a
//     problem, directly or via a chain, are one set) getting its OWN lane
//     (linkSetLaneX) so sets never overlap — linked-line sets claim the
//     first lanes, suggestion-line sets continue right after them, so the
//     two families never share a lane either. Linked lines are solid, one
//     colour per SET (linkSetColor); suggestion lines are dashed (never a
//     written relationship yet) with a shape+letter flag naming the
//     suggestion's OWN kind — SNOMED-ancestry vs "(Grouped with X)"
//     text-link — since this suite's colourblind mode must survive on
//     colour alone never being the only cue (suggestionFlagHtml). Linked
//     lines are still display-only — no create/remove interaction (explicit
//     scope decision), even though the write contract is fully confirmed
//     (see docs/learnings-problem-nesting-api.md); suggestion lines confirm
//     via the ordinary tile-onto-tile drag, same as any other nest/link.
//
// UN-NESTING: CONFIRMED live 2026-08-08 (two real HAR captures Nick
// recorded — see docs/learnings-problem-nesting-api.md). Same endpoint, same
// three-field payload as creating a link, parentProblemId: null.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ───

  var DATE_RE = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/;
  // Same regex/table as allergy-cleanup.js's normalizeOnsetDateForSubmit —
  // duplicated, not shared, the same way each content script already
  // carries its own copy of small parsing helpers.
  var MONTH_ABBR = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  // recordDate comes back from slideover/overview ALREADY in ISO shape
  // (confirmed live 2026-08-08, HAR 48: "recordDate":"2025-01-15" on the
  // SAME response as "onsetDate":"20 Apr 2006") — onsetDate and recordDate
  // are two DIFFERENT formats on the same object, not one format that's
  // sometimes present. dateSortKey below must recognise both, or the
  // onset-blank record-date fallback silently returns null and sorts as
  // undated (the mis-sorting Nick found live 2026-08-08).
  var ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // Parses either the confirmed "DD Mon YYYY" onset-date display shape OR
  // an already-ISO "YYYY-MM-DD" shape (recordDate) into a zero-padded
  // 'YYYY-MM-DD' string (lexically sortable). Returns null for
  // missing/malformed input — never guesses a date.
  function dateSortKey(value) {
    if (value == null) return null;
    var s = String(value).trim();
    var iso = ISO_DATE_RE.exec(s);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var m = DATE_RE.exec(s);
    if (!m) return null;
    var month = MONTH_ABBR[m[2]];
    if (!month) return null;
    var day = m[1].length === 1 ? '0' + m[1] : m[1];
    return m[3] + '-' + month + '-' + day;
  }

  // Descending by date; undated entries always sort last regardless of
  // comparison direction (least specific = lowest priority position).
  function compareDatesDesc(dateA, dateB) {
    var ka = dateSortKey(dateA);
    var kb = dateSortKey(dateB);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    if (ka === kb) return 0;
    return ka < kb ? 1 : -1;
  }

  // The date shown/sorted on a tile: onset date, falling back to record date
  // when onset is blank (2026-08-08 request) — a problem with NO onset but a
  // real record date should neither show blank nor sort as if fully undated.
  function resolveDisplayDate(info) {
    if (!info) return null;
    return info.onsetDate || info.recordDate || null;
  }

  // Single-line truncation for free-text additionalInformation on a tile —
  // keeps tiles compact (2026-08-08 request to reduce their footprint) while
  // still surfacing enough of the text to be useful; the full text is always
  // still on the real record, this is a hint, not the record itself.
  function truncateText(text, maxLen) {
    if (text == null) return null;
    var s = String(text).trim();
    if (!s) return null;
    var limit = typeof maxLen === 'number' && maxLen > 1 ? maxLen : 70;
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1).trim() + '…';
  }

  // Builds the left-pane tree. Roots are problems with no live parent.
  // 2026-08-19: a problem carrying an unconfirmed suggestion (SNOMED-
  // ancestry parent, or a "(Grouped with X)" text-link match) used to be
  // hidden here whenever it had no real children of its own — it lived only
  // in the now-removed right-hand suggestion tray, as a separate draggable
  // card. It now always renders as an ordinary lane tile like any other
  // active problem; annotateTreeSuggestions (called by buildLaneTrees)
  // attaches the candidate-parent/text-link info AFTER the tree is built, so
  // tileHtml can draw the dotted suggestion line and (for text-link) surface
  // the relationship-choice buttons straight on the tile.
  function buildProblemTree(problems, infoById, parentIdByProblemId) {
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var parentMap = parentIdByProblemId || {};
    var byId = {};
    list.forEach(function (p) {
      if (!p || !p.id) return;
      var i = info[p.id];
      byId[p.id] = {
        id: p.id,
        description: p.description,
        displayDate: resolveDisplayDate(i),
        additionalInformation: (i && i.additionalInformation) || null,
        // Set below, only when the parent genuinely exists as another tile
        // in this same tree — never a raw/unvalidated copy of parentMap[id]
        // — so a "Remove link" button never targets a parent that isn't
        // actually rendered.
        parentId: null,
        // "Linked problems" (2026-08-08) — a SEPARATE, non-hierarchical,
        // symmetric relationship from parent/child (see
        // docs/learnings-problem-nesting-api.md). Display-only for now:
        // drawn as lines between tree tiles, no create/remove interaction
        // yet. Raw ids, unvalidated against this tree — the line-drawing
        // step itself skips any id that isn't currently rendered.
        linkedProblemIds: (i && Array.isArray(i.linkedProblemIds) ? i.linkedProblemIds : []).slice(),
        children: [],
      };
    });
    Object.keys(byId).forEach(function (id) {
      var parentId = parentMap[id];
      if (parentId && byId[parentId]) {
        byId[parentId].children.push(byId[id]);
        byId[id].parentId = parentId;
      }
    });
    var roots = [];
    var reachable = new Set();
    function markReachable(node) {
      if (reachable.has(node.id)) return;
      reachable.add(node.id);
      node.children.forEach(markReachable);
    }
    Object.keys(byId).forEach(function (id) {
      var parentId = parentMap[id];
      if (parentId && byId[parentId]) return; // already placed as a real child, above
      roots.push(byId[id]);
      markReachable(byId[id]);
    });
    // Cycle rescue: server data CAN contain a parent-map cycle (Medicus's
    // own parent picker isn't cycle-guarded — only this extension's writes
    // are). Every member of a cycle has a live parent, so the roots loop
    // above skips them all — yet none is reachable from any real root, and
    // without this pass they'd silently VANISH from the rendered problem
    // list (review finding). Promote the first-listed unreachable member of
    // each cycle to a root, cutting only its own parent edge — the rest of
    // the cycle then renders beneath it as ordinary children.
    list.forEach(function (p) {
      if (!p || !p.id || !byId[p.id] || reachable.has(p.id)) return;
      var node = byId[p.id];
      var parentNode = byId[node.parentId];
      if (!parentNode) return; // not a cycle member — already handled above
      var idx = parentNode.children.indexOf(node);
      if (idx !== -1) parentNode.children.splice(idx, 1);
      node.parentId = null;
      roots.push(node);
      markReachable(node);
    });
    function sortRecursive(nodes) {
      nodes.sort(function (a, b) {
        return compareDatesDesc(a.displayDate, b.displayDate);
      });
      nodes.forEach(function (n) {
        sortRecursive(n.children);
      });
    }
    sortRecursive(roots);
    return roots;
  }

  // Every id currently rendered in the tree (roots + every depth of
  // children) — a pure, generic helper the cycle-rescue tests rely on to
  // verify no problem silently vanishes from the tree.
  function flattenTreeIds(tree) {
    var ids = new Set();
    function walk(nodes) {
      (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
        if (ids.has(n.id)) return; // belt-and-braces vs a cyclic structure — never recurse forever
        ids.add(n.id);
        walk(n.children);
      });
    }
    walk(tree);
    return ids;
  }

  // Live-filters the bridge's raw suggestion list down to what's still worth
  // annotating onto a tile right now: the child problem still exists (not
  // merged away this session), still has no real parent (not linked via
  // another route this session), and its candidate-parent list is narrowed
  // to options that still exist and wouldn't create a cycle right now.
  function filterLiveSuggestions(suggestions, problems, parentIdByProblemId, wouldCreateCycleFn) {
    var problemIds = new Set(
      (Array.isArray(problems) ? problems : []).map(function (p) {
        return p.id;
      })
    );
    var parentMap = parentIdByProblemId || {};
    var cycleCheck =
      typeof wouldCreateCycleFn === 'function'
        ? wouldCreateCycleFn
        : function () {
            return false;
          };
    var out = [];
    (Array.isArray(suggestions) ? suggestions : []).forEach(function (s) {
      if (!s || !problemIds.has(s.childId) || parentMap[s.childId]) return;
      var liveOptions = (Array.isArray(s.parentOptions) ? s.parentOptions : []).filter(function (o) {
        return o && problemIds.has(o.id) && !cycleCheck(s.childId, o.id, parentMap);
      });
      if (!liveOptions.length) return;
      out.push({ childId: s.childId, childDescription: s.childDescription, parentOptions: liveOptions });
    });
    return out;
  }

  // Accurate provenance copy (2026-08-08, rules/problem-nesting-overrides.json):
  // 'snomed' — a genuine live SNOMED-descendant hit — credited differently
  // from 'override' — a practice-defined pair SNOMED itself doesn't
  // recognise as a hierarchy (e.g. pseudophakia as a child of cataract).
  // Crediting SNOMED for a pairing it never actually made would be
  // misleading. Plain text, not HTML (2026-08-19: this now feeds an SVG
  // <title> tooltip on the suggestion flag — see suggestionFlagHtml's own
  // comment for why the "SNOMED marks this as a child of X" explanation
  // moved off the card onto the connector line's own flag — an SVG title
  // has no markup rendering, unlike the old card-hint's <strong> tags).
  // One CANDIDATE at a time (not the old multi-candidate "X or Y" join):
  // each candidate now draws its OWN line and OWN flag, so there is no
  // multi-candidate sentence to build any more.
  function suggestionCandidateTitleText(candidateDescription, source) {
    var desc = candidateDescription || '';
    return source === 'override'
      ? "this practice's own reference list marks this as a child of " + desc
      : 'SNOMED marks this as a child of ' + desc;
  }

  function relativeRect(rect, containerRect) {
    return {
      left: rect.left - containerRect.left,
      right: rect.right - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  // "Linked problems" (2026-08-08, docs/learnings-problem-nesting-api.md) —
  // a SEPARATE, non-hierarchical, SYMMETRIC relationship from parent/child:
  // either problem's own record lists the other, so a plain scan over every
  // tile's own linkedIds would draw each real link TWICE (once from each
  // side). Dedupes to one unordered {a, b} pair per genuine link. Display-
  // only for now — no create/remove interaction, see the file header.
  function buildLinkedProblemPairs(entries) {
    var seen = new Set();
    var pairs = [];
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      (Array.isArray(entry.linkedIds) ? entry.linkedIds : []).forEach(function (otherId) {
        if (!otherId || otherId === entry.id) return;
        var key = entry.id < otherId ? entry.id + '|' + otherId : otherId + '|' + entry.id;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push({ a: entry.id, b: otherId });
      });
    });
    return pairs;
  }

  // Suggestion pairs (2026-08-19, moved off the removed tray) — unlike
  // linked-problem pairs above, these are directional (a = the suggested
  // child/subject, b = the candidate parent/matched problem) and never
  // symmetric on the record, so no dedup-by-unordered-pair is needed: each
  // tile only ever lists its OWN outgoing suggestion(s). `kind` distinguishes
  // a SNOMED-ancestry candidate from a "(Grouped with X)" text-link match so
  // the line-drawer can flag each one differently (Nick's feedback:
  // "differentiate the SNOMED marks this... explanation from the additional
  // details explanation visually" — shape/label, not colour alone, per this
  // suite's colourblind-mode requirement). entries: [{id, suggestedIds,
  // textlinkId}]. Each suggestedIds entry is either a bare id or an
  // "id|source" compound string (2026-08-19 follow-up — tileHtml now tags
  // each candidate with its own provenance so the flag's tooltip can name
  // the exact source, "SNOMED marks this..." vs "this practice's own
  // reference list..."); a bare id with no "|" defaults to 'snomed', same
  // as every candidate meant before this field existed.
  function buildSuggestionPairs(entries) {
    var pairs = [];
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      (Array.isArray(entry.suggestedIds) ? entry.suggestedIds : []).forEach(function (raw) {
        var parts = String(raw).split('|');
        var otherId = parts[0];
        var source = parts[1] === 'override' ? 'override' : 'snomed';
        if (!otherId || otherId === entry.id) return;
        pairs.push({ a: entry.id, b: otherId, kind: 'snomed', source: source });
      });
      if (entry.textlinkId && entry.textlinkId !== entry.id) {
        pairs.push({ a: entry.id, b: entry.textlinkId, kind: 'textlink' });
      }
    });
    return pairs;
  }

  // The flag marker's position for one elbow-routed line — the midpoint of
  // its OWN vertical bus segment (not the shared bus's full extent), so two
  // lines on the same lane but at very different heights don't both plant
  // their flag at the same spot. Mirrors buildElbowConnectorPath's own
  // y-coordinate math exactly (tile right-edge, vertical-centre).
  function elbowFlagPoint(rectA, rectB, busX) {
    if (!rectA || !rectB || typeof busX !== 'number') return null;
    var yA = rectA.top + rectA.height / 2;
    var yB = rectB.top + rectB.height / 2;
    return { x: busX, y: (yA + yB) / 2 };
  }

  // The small marker naming a suggestion line's OWN kind (2026-08-19,
  // Nick's feedback) — deliberately shape + letter, not colour alone: this
  // suite's colourblind mode must survive every change (see
  // .claude/skills/ui-design/DOCTRINE.md), so a SNOMED-ancestry candidate
  // (circle, "S") and a "(Grouped with X)" text-link match (square, "G")
  // stay distinguishable with colour vision entirely disabled. The dash
  // pattern on the line itself differs too (see the CSS), a third,
  // independent cue. pointer-events re-enabled on just the flag (the whole
  // SVG is pointer-events:none, same "visual only" discipline the plain
  // lines keep) so its <title> gives an accessible hover tooltip naming the
  // suggestion in full — the flag is the only interactive part of a line.
  // `title`: the FULL explanation text (2026-08-19 follow-up — this used to
  // be a generic "SNOMED ancestry suggestion" string; the caller now builds
  // the exact per-candidate sentence, e.g. "SNOMED marks this as a child of
  // Hypertension", the same one the removed on-card hint used to show, and
  // passes it straight through here).
  function suggestionFlagHtml(point, kind, title) {
    if (!point) return '';
    var isTextlink = kind === 'textlink';
    var label = isTextlink ? 'G' : 'S';
    var shapeClass = 'ms-pnc-flag ' + (isTextlink ? 'ms-pnc-flag-textlink' : 'ms-pnc-flag-snomed');
    var shape = isTextlink
      ? '<rect x="' +
        (point.x - 7) +
        '" y="' +
        (point.y - 7) +
        '" width="14" height="14" rx="3" class="' +
        shapeClass +
        '"></rect>'
      : '<circle cx="' + point.x + '" cy="' + point.y + '" r="7.5" class="' + shapeClass + '"></circle>';
    return (
      '<g class="ms-pnc-flag-group">' +
      '<title>' +
      esc(title || (isTextlink ? 'Import text match ("Grouped with…")' : 'SNOMED ancestry suggestion')) +
      '</title>' +
      shape +
      '<text x="' +
      point.x +
      '" y="' +
      point.y +
      '" class="ms-pnc-flag-label" text-anchor="middle" dominant-baseline="central">' +
      label +
      '</text>' +
      '</g>'
    );
  }

  // The red (X) removal marker for an EXISTING linked-problem line
  // (2026-08-19, Nick's feedback: "in the middle of the connector where
  // it's an existing link" — a direct way to remove a flat link without
  // first clicking the tile to select it, mirroring the suggestion flag's
  // own always-visible marker on the SAME kind of elbow-routed line).
  // data-remove-a/-b carry the pair's raw ids — bindEvents' delegated click
  // handler reads them straight off the DOM (the SVG is fully rebuilt on
  // every scroll/resize via updateConnectorLines, so per-node listeners
  // here would be orphaned the moment that happens; one delegated listener
  // on the stable root element, same technique the rest of this file
  // avoids re-binding costs with, survives that rebuild). Only ARMS the
  // confirm bar (_pendingAction) — never commits directly on click, same
  // discipline as every other write in this canvas.
  function linkRemoveFlagHtml(point, aId, bId, aDescription, bDescription) {
    if (!point) return '';
    return (
      '<g class="ms-pnc-flag-group ms-pnc-remove-flag-group" data-remove-a="' +
      esc(aId) +
      '" data-remove-b="' +
      esc(bId) +
      '" data-remove-a-desc="' +
      esc(aDescription) +
      '" data-remove-b-desc="' +
      esc(bDescription) +
      '">' +
      '<title>Remove the link between ' +
      esc(aDescription) +
      ' and ' +
      esc(bDescription) +
      '</title>' +
      '<circle cx="' +
      point.x +
      '" cy="' +
      point.y +
      '" r="7.5" class="ms-pnc-remove-flag"></circle>' +
      '<text x="' +
      point.x +
      '" y="' +
      point.y +
      '" class="ms-pnc-remove-flag-label" text-anchor="middle" dominant-baseline="central">×</text>' +
      '</g>'
    );
  }

  // Groups deduped {a,b} pairs into connected "sets" — 2026-08-08 follow-up:
  // separate, unrelated sets of linked problems were sharing the exact same
  // vertical bus AND the same colour, making them visually indistinguishable
  // from one genuinely connected group. Two pairs belong to the SAME set if
  // they share a problem id, directly or via a chain of other pairs (a
  // three-way A–B–C link is still one set) — classic union-find over the
  // pair graph. Each returned set gets its OWN lane (see linkSetLaneX) and
  // colour (see linkSetColor) when drawn.
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

  // Each linked-problem SET's own lane — a small rightward step from the
  // shared base bus position (computeLinkBusX) per set index, so two sets
  // whose tiles' y-ranges overlap don't land on the exact same vertical
  // line. Only the BASE is capped at the tree pane's own edge (see
  // computeLinkBusX) — an extreme case with many separate sets may push the
  // furthest lanes past that cap; an acceptable degradation, still far
  // better than every set sharing one line.
  function linkSetLaneX(baseX, setIndex, laneWidth) {
    if (typeof baseX !== 'number') return null;
    var w = typeof laneWidth === 'number' ? laneWidth : 14;
    return baseX + setIndex * w;
  }

  // A small, visually-distinct colour per SET, cycling by index. Hues
  // deliberately spaced away from every colour already meaningful elsewhere
  // in this canvas — the suggestion lines' accent blue (~221°), the
  // cycle-error confirm bar's red (~0°) and amber (~28°) — so a set's own
  // colour is never mistaken for one of those. Green (142°) stays first,
  // matching the original single-colour version for visual continuity.
  var LINK_SET_HUES = [142, 280, 320, 180, 90];
  function linkSetColor(index) {
    var i = typeof index === 'number' && index >= 0 ? index : 0;
    var hue = LINK_SET_HUES[i % LINK_SET_HUES.length];
    return 'hsl(' + hue + ', 65%, 42%)';
  }

  // Elbow ("bus/rail") routing for linked-problem lines — revised 2026-08-08,
  // replacing a first cut of straight diagonal lines that Nick found unclear
  // ("don't link clearly themselves"). Every link's horizontal arm reaches
  // out from its own tile's RIGHT edge to the SAME shared vertical line
  // (busX, see computeLinkBusX below), travels along that line to the other
  // tile's own y-level, then back in via its own horizontal arm — the
  // classic orthogonal "bus" pattern (like a genogram's shared sibling rail)
  // that stays traceable even with several links on screen at once, unlike
  // a diagonal line that can cross straight through unrelated tiles.
  function buildElbowConnectorPath(rectA, rectB, busX) {
    if (!rectA || !rectB || typeof busX !== 'number') return null;
    var xA = rectA.right;
    var yA = rectA.top + rectA.height / 2;
    var xB = rectB.right;
    var yB = rectB.top + rectB.height / 2;
    return 'M ' + xA + ' ' + yA + ' L ' + busX + ' ' + yA + ' L ' + busX + ' ' + yB + ' L ' + xB + ' ' + yB;
  }

  // The shared vertical bus position: clear of EVERY rendered tree tile, not
  // just linked ones — indentation means an unlinked, deeply-nested tile
  // could still be the widest thing on screen, and the bus must sit to the
  // right of all of them or it would cut through tile content. Capped at
  // the lanes pane's own right boundary (when known) so it never bleeds
  // past the End bin sitting alongside it.
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

  // Reads this canvas's own drag payload off a drop event, proving the drag
  // actually originated here rather than being a foreign drag (selected
  // text, a dragged file) that happened to land on a tile. Same
  // provenance-via-dataTransfer technique contacts-canvas.js uses.
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
      if (!parsed || typeof parsed !== 'object' || !parsed.problemId) return null;
      return parsed;
    } catch (_) {
      return null; // malformed, or plain dragged text that happens not to be JSON
    }
  }

  // Builds the pending 'link' action a drop (or keyboard drop) proposes —
  // shared by both input paths so neither can skip the re-parent check. When
  // the child ALREADY has a live parent, the returned action carries
  // previousParentId/previousParentDescription so the confirm bar can
  // disclose the move (review finding: the deleted manual builder always
  // named the existing parent before a re-parent; a silent move visually
  // demotes a live clinical problem out of a hierarchy the clinician chose).
  // Only a parent that still exists in descById counts — a dangling
  // parentMap entry pointing at a merged-away problem is not a move the
  // confirm needs to warn about.
  function buildPendingLink(childId, parentId, descById, parentIdByProblemId) {
    var byId = descById || {};
    var previousParentId = (parentIdByProblemId || {})[childId] || null;
    if (!(previousParentId && Object.prototype.hasOwnProperty.call(byId, previousParentId))) {
      previousParentId = null;
    }
    return {
      kind: 'link',
      childId: childId,
      parentId: parentId,
      childDescription: byId[childId] || childId,
      parentDescription: byId[parentId] || parentId,
      previousParentId: previousParentId,
      previousParentDescription: previousParentId ? byId[previousParentId] : null,
      // false when nesting this pair would create a hierarchy loop
      // (proposeLink's cycle check). The FLAT link is still legitimate for
      // such a pair — flat links are non-hierarchical and can never loop —
      // so instead of blocking the whole drop (review note: a pair that
      // couldn't nest could never be flat-linked by drag either), the
      // confirm bar drops the nest choice and offers only the flat link.
      nestAllowed: true,
      linking: false,
      error: null,
    };
  }

  // Significance lane for a Medicus display label. Same prefix match as
  // problem-nesting.js's sigCurrentMatchesTarget — "Major", "Minor",
  // "Unknown" / "Unknown significance" / missing all land in a bucket.
  // Anything that isn't major/minor is unresolved (unknown).
  function significanceLaneKey(label) {
    var s = String(label == null ? '' : label)
      .trim()
      .toLowerCase();
    if (s.indexOf('major') === 0) return 'major';
    if (s.indexOf('minor') === 0) return 'minor';
    return 'unknown';
  }

  var SIGNIFICANCE_LANES = ['major', 'minor', 'unknown'];

  function partitionProblemsBySignificance(problems, infoById) {
    var out = { major: [], minor: [], unknown: [] };
    var info = infoById || {};
    (Array.isArray(problems) ? problems : []).forEach(function (p) {
      if (!p || !p.id) return;
      var current = (info[p.id] && info[p.id].significance) || 'Unknown';
      out[significanceLaneKey(current)].push(p);
    });
    return out;
  }

  // After a per-lane buildProblemTree, mark roots whose live parent sits in
  // a *different* lane so the tile can say "nested under X" without pulling
  // that parent into this column.
  function annotateCrossLaneParents(tree, problems, parentIdByProblemId) {
    var descById = {};
    (Array.isArray(problems) ? problems : []).forEach(function (p) {
      if (p && p.id) descById[p.id] = p.description;
    });
    var parentMap = parentIdByProblemId || {};
    function walk(nodes) {
      (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
        if (!n) return;
        var pid = parentMap[n.id];
        if (pid && !n.parentId && descById[pid]) {
          n.crossLaneParentId = pid;
          n.crossLaneParentDescription = descById[pid];
        }
        walk(n.children);
      });
    }
    walk(tree);
    return tree;
  }

  // 2026-08-19: attaches each tile's own unconfirmed-suggestion data
  // directly to its tree node, now that suggestion-only problems render as
  // ordinary lane tiles instead of separate tray cards. tileHtml reads
  // node.suggestedParentOptions to emit data-suggested-ids (the dashed
  // candidate line(s) updateConnectorLines draws, elbow/bus-routed the same
  // way as linked-problem lines) and node.textLinkSuggestion to emit
  // data-textlink-id (its own dashed line) plus offer the "Grouped with X"
  // relationship-choice buttons alongside Remove link/Edit problem once the
  // tile is selected. suggestionsByChildId/textLinkByProblemId are plain
  // id->suggestion lookup objects, built once in render() from the SAME
  // filtered lists the removed tray used to consume.
  function annotateTreeSuggestions(tree, suggestionsByChildId, textLinkByProblemId) {
    function walk(nodes) {
      (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
        if (!n) return;
        var s = suggestionsByChildId[n.id];
        if (s) n.suggestedParentOptions = s.parentOptions;
        var t = textLinkByProblemId[n.id];
        if (t) n.textLinkSuggestion = t;
        walk(n.children);
      });
    }
    walk(tree);
    return tree;
  }

  function buildLaneTrees(problems, infoById, parentIdByProblemId, suggestionsByChildId, textLinkByProblemId) {
    var parts = partitionProblemsBySignificance(problems, infoById);
    var trees = {};
    SIGNIFICANCE_LANES.forEach(function (key) {
      var tree = buildProblemTree(parts[key], infoById, parentIdByProblemId);
      tree = annotateCrossLaneParents(tree, problems, parentIdByProblemId);
      trees[key] = annotateTreeSuggestions(tree, suggestionsByChildId || {}, textLinkByProblemId || {});
    });
    return trees;
  }

  // Classifies a drop (or keyboard drop) against a target. Tile→tile is a
  // nest/link; tile→lane chrome is a significance change; tile→bin is an
  // end. Returns null for no-ops (same lane, self-drop, unknown target).
  // currentLaneKey is the dragged problem's current significance lane.
  function classifyDrop(payload, dropTarget, currentLaneKey) {
    if (!payload || !payload.problemId || !dropTarget || !dropTarget.type) return null;
    if (dropTarget.type === 'tile') {
      if (!dropTarget.id || dropTarget.id === payload.problemId) return null;
      return { kind: 'link', childId: payload.problemId, parentId: dropTarget.id };
    }
    if (dropTarget.type === 'lane') {
      var key = dropTarget.key;
      if (SIGNIFICANCE_LANES.indexOf(key) === -1) return null;
      if (currentLaneKey === key) return null;
      return { kind: 'sig-' + key, problemId: payload.problemId, targetKey: key };
    }
    if (dropTarget.type === 'bin') {
      return { kind: 'end', problemId: payload.problemId };
    }
    return null;
  }

  // True when no other live problem lists this id as its parent. Same
  // "can't end a parent while children are active" rule as
  // problem-bulk-end.js's isEndable — the commit path re-checks against
  // Medicus's own end-problem form.
  function canProposeEnd(problemId, parentIdByProblemId) {
    return canStageEnd(problemId, parentIdByProblemId, []);
  }

  // Parent may be staged for End once every live child is also staged
  // (or already gone). Children-first staging, children-first commit.
  function canStageEnd(problemId, parentIdByProblemId, endIds) {
    if (!problemId) return false;
    var staged = {};
    (endIds || []).forEach(function (id) {
      staged[id] = true;
    });
    staged[problemId] = true;
    var map = parentIdByProblemId || {};
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (map[keys[i]] === problemId && !staged[keys[i]]) return false;
    }
    return true;
  }

  function emptyDraft() {
    return { endIds: [], sigById: {} };
  }

  function cloneDraft(draft) {
    var src = draft || emptyDraft();
    return { endIds: (src.endIds || []).slice(), sigById: Object.assign({}, src.sigById || {}) };
  }

  function hasDraftChanges(draft) {
    if (!draft) return false;
    return (draft.endIds && draft.endIds.length > 0) || Object.keys(draft.sigById || {}).length > 0;
  }

  function significanceLabel(key) {
    if (key === 'major') return 'Major';
    if (key === 'minor') return 'Minor';
    return 'Unknown significance';
  }

  function liveLaneKey(infoById, problemId) {
    var current = (infoById && infoById[problemId] && infoById[problemId].significance) || 'Unknown';
    return significanceLaneKey(current);
  }

  function effectiveLaneKey(infoById, draft, problemId) {
    if (draft && draft.sigById && draft.sigById[problemId]) return draft.sigById[problemId];
    return liveLaneKey(infoById, problemId);
  }

  function stageEnd(draft, problemId, parentIdByProblemId) {
    var next = cloneDraft(draft);
    if (!problemId) return { draft: next, error: 'A problem must be chosen.' };
    if (next.endIds.indexOf(problemId) !== -1) return { draft: next, error: null };
    if (!canStageEnd(problemId, parentIdByProblemId, next.endIds)) {
      return { draft: draft || emptyDraft(), error: 'has-children' };
    }
    next.endIds.push(problemId);
    delete next.sigById[problemId];
    return { draft: next, error: null };
  }

  function unstageEnd(draft, problemId, parentIdByProblemId) {
    var next = cloneDraft(draft);
    next.endIds = next.endIds.filter(function (id) {
      return id !== problemId;
    });
    var changed = true;
    while (changed) {
      changed = false;
      var keep = [];
      for (var i = 0; i < next.endIds.length; i++) {
        var id = next.endIds[i];
        var others = next.endIds.filter(function (x) {
          return x !== id;
        });
        if (canStageEnd(id, parentIdByProblemId, others)) keep.push(id);
        else changed = true;
      }
      next.endIds = keep;
    }
    return next;
  }

  function stageSignificance(draft, problemId, targetKey, liveKey, parentIdByProblemId) {
    var next = unstageEnd(draft || emptyDraft(), problemId, parentIdByProblemId);
    if (!problemId || SIGNIFICANCE_LANES.indexOf(targetKey) === -1) return next;
    if (targetKey === liveKey) delete next.sigById[problemId];
    else next.sigById[problemId] = targetKey;
    return next;
  }

  function overlayInfoById(infoById, draft) {
    var out = {};
    var src = infoById || {};
    Object.keys(src).forEach(function (id) {
      out[id] = src[id];
    });
    var sig = (draft && draft.sigById) || {};
    Object.keys(sig).forEach(function (id) {
      var prev = out[id] || {};
      var copy = {};
      Object.keys(prev).forEach(function (k) {
        copy[k] = prev[k];
      });
      copy.significance = significanceLabel(sig[id]);
      out[id] = copy;
    });
    return out;
  }

  function problemsNotEnded(problems, draft) {
    var ended = {};
    ((draft && draft.endIds) || []).forEach(function (id) {
      ended[id] = true;
    });
    return (problems || []).filter(function (p) {
      return p && p.id && !ended[p.id];
    });
  }

  function endedProblemList(problems, draft) {
    var byId = {};
    (problems || []).forEach(function (p) {
      if (p && p.id) byId[p.id] = p;
    });
    return ((draft && draft.endIds) || [])
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean);
  }

  // Children before parents so a staged parent is not POSTed while its
  // children are still live on Medicus.
  function orderEndsForCommit(endIds, parentIdByProblemId) {
    var remaining = (endIds || []).slice();
    var map = parentIdByProblemId || {};
    var out = [];
    while (remaining.length) {
      var pick = -1;
      for (var i = 0; i < remaining.length; i++) {
        var id = remaining[i];
        var hasChildStill = remaining.some(function (other) {
          return other !== id && map[other] === id;
        });
        if (!hasChildStill) {
          pick = i;
          break;
        }
      }
      if (pick === -1) return out.concat(remaining);
      out.push(remaining[pick]);
      remaining.splice(pick, 1);
    }
    return out;
  }

  function summariseDraft(draft, descById) {
    var endIds = (draft && draft.endIds) || [];
    var sigById = (draft && draft.sigById) || {};
    var ends = endIds.map(function (id) {
      return { id: id, description: (descById && descById[id]) || id };
    });
    var sigs = [];
    Object.keys(sigById).forEach(function (id) {
      if (endIds.indexOf(id) !== -1) return;
      sigs.push({
        id: id,
        description: (descById && descById[id]) || id,
        targetKey: sigById[id],
        targetLabel: significanceLabel(sigById[id]),
      });
    });
    return { ends: ends, sigs: sigs, count: ends.length + sigs.length };
  }

  // ── Node test hook ────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      dateSortKey: dateSortKey,
      compareDatesDesc: compareDatesDesc,
      resolveDisplayDate: resolveDisplayDate,
      truncateText: truncateText,
      buildProblemTree: buildProblemTree,
      flattenTreeIds: flattenTreeIds,
      filterLiveSuggestions: filterLiveSuggestions,
      suggestionCandidateTitleText: suggestionCandidateTitleText,
      buildLinkedProblemPairs: buildLinkedProblemPairs,
      buildSuggestionPairs: buildSuggestionPairs,
      elbowFlagPoint: elbowFlagPoint,
      groupLinkedPairsIntoSets: groupLinkedPairsIntoSets,
      linkSetLaneX: linkSetLaneX,
      linkSetColor: linkSetColor,
      buildElbowConnectorPath: buildElbowConnectorPath,
      computeLinkBusX: computeLinkBusX,
      relativeRect: relativeRect,
      readDropPayload: readDropPayload,
      buildPendingLink: buildPendingLink,
      significanceLaneKey: significanceLaneKey,
      partitionProblemsBySignificance: partitionProblemsBySignificance,
      annotateCrossLaneParents: annotateCrossLaneParents,
      buildLaneTrees: buildLaneTrees,
      annotateTreeSuggestions: annotateTreeSuggestions,
      classifyDrop: classifyDrop,
      canProposeEnd: canProposeEnd,
      canStageEnd: canStageEnd,
      emptyDraft: emptyDraft,
      hasDraftChanges: hasDraftChanges,
      stageEnd: stageEnd,
      unstageEnd: unstageEnd,
      stageSignificance: stageSignificance,
      overlayInfoById: overlayInfoById,
      problemsNotEnded: problemsNotEnded,
      endedProblemList: endedProblemList,
      orderEndsForCommit: orderEndsForCommit,
      summariseDraft: summariseDraft,
      effectiveLaneKey: effectiveLaneKey,
      liveLaneKey: liveLaneKey,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msProblemNestingCanvas) return;
  window.__msProblemNestingCanvas = true;

  var OVERLAY_ID = 'ms-pnc-overlay';

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

  // ── State ─────────────────────────────────────────────────────────────────
  var _subscribed = false;
  var _resizeBound = false;
  var _linkedCount = 0;
  // {kind: 'link'|'unlink', childId, parentId, childDescription,
  //  parentDescription, linking, error} — one shared confirm-before-write
  // flow for both a drag-created link and an unlink, triggered from the
  // tile's own action buttons; only the confirm copy and which bridge
  // function fires on confirm differ.
  var _pendingAction = null;
  // Draft workspace for End + significance. Tiles move on the canvas
  // immediately; Medicus is not written until Finalise. Nest/link still
  // use _pendingAction (one pair, one confirm) because those need the
  // nest-vs-flat choice.
  var _draft = emptyDraft();
  // Session-local, canvas-only (never touches problem-nesting.js's own
  // state/bridge): problemIds whose text-derived suggestion has just been
  // successfully actioned. Unlike the SNOMED tray (filterLiveSuggestions
  // re-checks the live parent map fresh every render, so an actioned
  // suggestion disappears automatically), _textLinkSuggestions has no
  // equivalent live-state check — the underlying "(Grouped with X)" text
  // stays on the record until problem-description-cleanup.js's OWN apply
  // path strips it (a write this canvas never makes), so without this the
  // same card would keep reappearing after every render even though the
  // writes themselves are safely idempotent (commitFlatLink/commitParentLink
  // both no-op harmlessly on a relationship that already exists).
  var _dismissedTextLinkProblemIds = new Set();
  var _cycleError = null;
  var _dragPayload = null;
  var _lineUpdateScheduled = false;
  // The one tile currently showing its action buttons (click to select,
  // click again — or select another — to deselect). Tree-pane tiles only.
  var _selectedTileId = null;
  // Keyboard equivalent of the drag payload (review finding: dragging was
  // the ONLY way to create a link — unreachable without a pointer). Enter/
  // Space on a focused tile "picks it up"; Enter/Space on another tile
  // proposes the same link a drop would; Escape cancels the pick-up.
  var _kbPickedId = null;
  // The patientId this canvas was opened against. The overlay is
  // position:fixed and nothing in the host SPA closes it on a patient
  // navigation — render() compares this against every snapshot and
  // hard-closes on a mismatch, and confirmPendingAction re-checks it right
  // before committing, so a confirm queued on patient A can never write
  // against patient B's id (review finding).
  var _openedPatientId = null;
  // The problemId currently open in the "Edit problem" panel, or null.
  // Tracked so close() can tell problem-description-cleanup.js's own state
  // to close too (window.ProblemDescriptionCleanup.close), not just hide
  // our wrapper.
  var _editingProblemId = null;

  function announce(text) {
    var live = document.querySelector('#' + OVERLAY_ID + ' .ms-pnc-live');
    if (live) live.textContent = text;
  }

  function captureFocusedProblemId(root) {
    var a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    return (a.getAttribute && a.getAttribute('data-problem-id')) || null;
  }

  function restoreFocusedProblemId(root, id) {
    if (!id) return;
    var target = root.querySelector('[data-problem-id="' + cssEscapeId(id) + '"]');
    if (target && typeof target.focus === 'function') target.focus();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  // Buttons revealed to the RIGHT of a tile once it's clicked/selected
  // (2026-08-08 feedback: clicking the connector line to remove a link
  // wasn't intuitive enough — this replaces that as the one way to unlink).
  // "Remove link" only offered when the tile actually HAS a parent (a root
  // has nothing to unlink); "Edit problem" always offered. Deliberately
  // data-target-id, NOT data-problem-id — these buttons must never match
  // the drag/drop-target queries (which key off data-problem-id) and become
  // spurious drop targets of their own.
  //
  // 2026-08-19: a selected tile carrying a "(Grouped with X)" text-link
  // suggestion (node.textLinkSuggestion) ALSO gets the relationship-choice
  // buttons the now-removed suggestion tray used to show on its own
  // duplicate card — same classes/data attributes (.ms-pnc-textlink-btn,
  // data-textlink-action/data-problem-id/data-matched-id), so the existing
  // click handlers in bindEvents work unchanged.
  function tileActionsHtml(node) {
    // Single outer wrapper (2026-08-19) — .ms-pnc-tile-row is itself a flex
    // row (tile-main sits alongside these actions), so this needs to be ONE
    // flex item that stacks its own two button rows vertically, rather than
    // letting .ms-pnc-tile-actions and .ms-pnc-textlink-actions become two
    // separate flex items competing for the same horizontal row.
    return (
      '<div class="ms-pnc-tile-actions-wrap">' +
      '<div class="ms-pnc-tile-actions">' +
      (node.parentId
        ? '<button type="button" class="ms-pnc-tile-action" data-action="unlink" data-target-id="' +
          esc(node.id) +
          '">Remove link</button>'
        : '') +
      '<button type="button" class="ms-pnc-tile-action" data-action="edit" data-target-id="' +
      esc(node.id) +
      '">Edit problem…</button>' +
      '</div>' +
      (node.textLinkSuggestion ? textLinkActionsHtml(node.textLinkSuggestion) : '') +
      '</div>'
    );
  }

  // Each child's connector is purely visual (a small stub between the
  // branch's indent guide and the child's tile, reading as "this tile
  // attaches here") — un-nesting now happens via the tile's own action
  // button (see tileActionsHtml), not by clicking the line itself.
  //
  // 2026-08-19: node.suggestedParentOptions (SNOMED-ancestry) and
  // node.textLinkSuggestion ("Grouped with X") — annotated by
  // annotateTreeSuggestions, since suggestion-only problems now render as
  // ordinary tiles instead of separate tray cards — both surface here:
  // data-suggested-ids / data-textlink-id feed updateConnectorLines' elbow/
  // bus line-drawing (same routing as linked-problem lines, with a
  // shape-flagged dashed line instead of a solid one), and a small
  // always-visible hint names the suggestion so it's discoverable without
  // clicking (the tray equivalent never required a click either).
  // Confirming still works via the ALREADY-generic tile-onto-tile drag/drop
  // this file already has — no new drag logic needed, just both tiles now
  // genuinely existing.
  function tileHtml(node) {
    var branch = node.children.length
      ? '<div class="ms-pnc-branch">' +
        node.children
          .map(function (c) {
            return (
              '<div class="ms-pnc-branch-item">' +
              '<div class="ms-pnc-connector" aria-hidden="true"></div>' +
              tileHtml(c) +
              '</div>'
            );
          })
          .join('') +
        '</div>'
      : '';
    var addInfo = truncateText(node.additionalInformation, 70);
    var selected = _selectedTileId === node.id;
    // Two SEPARATE attributes (2026-08-19, was one combined data-candidate-ids)
    // — the line-drawer needs to tell a SNOMED-ancestry candidate apart from
    // a text-link match to flag each line's kind distinctly (Nick's
    // feedback: "differentiate the SNOMED marks this... explanation from
    // the additional details explanation visually"). Each id carries its own
    // `|source` suffix (2026-08-19 follow-up: "remove the SNOMED marks this
    // as a child... text from the card, and add it to the hover tooltip") —
    // updateConnectorLines needs to know, per CANDIDATE, whether it came
    // from SNOMED itself or this practice's own override list, to build the
    // exact same "SNOMED marks this as a child of X" / "this practice's own
    // reference list marks this as a child of X" sentence the removed
    // on-card hint used to show, now per-line instead of one combined
    // sentence for every candidate at once.
    var suggestedIds = (node.suggestedParentOptions || []).map(function (o) {
      return o.id + '|' + (o.source === 'override' ? 'override' : 'snomed');
    });
    return (
      '<div class="ms-pnc-node">' +
      '<div class="ms-pnc-tile-row">' +
      '<div class="ms-pnc-tile' +
      (selected ? ' ms-pnc-tile-selected' : '') +
      (_kbPickedId === node.id ? ' ms-pnc-tile-picked' : '') +
      (_draft.sigById && _draft.sigById[node.id] ? ' ms-pnc-tile-staged' : '') +
      (node.suggestedParentOptions || node.textLinkSuggestion ? ' ms-pnc-tile-suggested' : '') +
      '" draggable="true" tabindex="0" data-problem-id="' +
      esc(node.id) +
      '"' +
      (node.linkedProblemIds.length ? ' data-linked-ids="' + esc(node.linkedProblemIds.join(',')) + '"' : '') +
      (suggestedIds.length ? ' data-suggested-ids="' + esc(suggestedIds.join(',')) + '"' : '') +
      (node.textLinkSuggestion
        ? ' data-textlink-id="' + esc(node.textLinkSuggestion.matchedProblemId) + '"'
        : '') +
      '>' +
      '<div class="ms-pnc-tile-main">' +
      '<div class="ms-pnc-tile-desc">' +
      esc(node.description) +
      '</div>' +
      (node.displayDate ? '<div class="ms-pnc-tile-date">' + esc(node.displayDate) + '</div>' : '') +
      '</div>' +
      (addInfo ? '<div class="ms-pnc-tile-info">' + esc(addInfo) + '</div>' : '') +
      (node.crossLaneParentDescription
        ? '<div class="ms-pnc-tile-hint">nested under ' + esc(node.crossLaneParentDescription) + '</div>'
        : '') +
      // 2026-08-19: the SNOMED-ancestry explanation moved off the card
      // entirely, onto the (S)/override flag's own hover tooltip on the
      // connector line (see suggestionFlagHtml) — a card carrying several
      // candidate suggestions no longer stacks one combined sentence for
      // all of them; each line now names its OWN candidate instead. The
      // "(Grouped with X)" text-link hint stays on the card (not asked to
      // move, and it carries actionable state — alreadyRelated/
      // hasOtherRelationship — the flag's tooltip doesn't need to repeat).
      (node.textLinkSuggestion ? textLinkHintHtml(node.textLinkSuggestion) : '') +
      '</div>' +
      (selected ? tileActionsHtml(node) : '') +
      '</div>' +
      branch +
      '</div>'
    );
  }

  function treeHtml(tree) {
    if (!tree.length) return '<div class="ms-pnc-empty">No problems to organise yet.</div>';
    return (
      '<div class="ms-pnc-roots">' +
      tree
        .map(function (n) {
          return '<div class="ms-pnc-root-item">' + tileHtml(n) + '</div>';
        })
        .join('') +
      '</div>'
    );
  }

  // "(Grouped with X)" text-derived suggestion (2026-08-09; folded onto the
  // tile itself 2026-08-19 — see tileHtml/tileActionsHtml's own comments).
  // Split into a short always-visible hint (textLinkHintHtml, so it's
  // discoverable without clicking — the removed tray card never required a
  // click either) and the actual relationship-choice buttons
  // (textLinkActionsHtml, shown only once the tile is selected, alongside
  // Remove link/Edit problem). Each click sets _pendingAction, same
  // two-step confirm-bar discipline as every other write in this canvas —
  // never commits directly on click.
  function textLinkHintHtml(s) {
    if (s.alreadyRelated) {
      return (
        '<div class="ms-pnc-tile-hint ms-pnc-tile-hint-suggested">🔗 Already linked/nested with <strong>' +
        esc(s.matchedDescription) +
        '</strong> — the import text is now redundant.</div>'
      );
    }
    return (
      '<div class="ms-pnc-tile-hint ms-pnc-tile-hint-suggested">🔗 "Grouped with' +
      (s.confidence === 'partial' ? '" (best match)' : '"') +
      ' — <strong>' +
      esc(s.matchedDescription) +
      '</strong></div>' +
      // A relationship with someone ELSE already exists (checkExistingRelationship,
      // 2026-08-09 follow-up — real case: the text named a plausible-but-wrong
      // problem, the clinician had actually already sorted this one out with a
      // DIFFERENT problem). The 3-way offer below still stands, but a "Leave
      // as-is" escape hatch avoids forcing a redundant/conflicting write.
      (s.hasOtherRelationship
        ? '<div class="ms-pnc-tile-hint">This problem already has another relationship recorded.</div>'
        : '')
    );
  }

  function textLinkActionsHtml(s) {
    // Someone already created this relationship manually in Medicus
    // (checkExistingRelationship, run at scan time) — offering to
    // (re)create it would be redundant; only the leftover import text is
    // still a genuine action here (2026-08-09 request).
    if (s.alreadyRelated) {
      return (
        '<div class="ms-pnc-textlink-actions">' +
        '<button type="button" class="ms-pnc-textlink-btn" data-textlink-action="alreadyRelated" data-problem-id="' +
        esc(s.problemId) +
        '" data-matched-id="' +
        esc(s.matchedProblemId) +
        '">Remove import text</button>' +
        '</div>'
      );
    }
    return (
      '<div class="ms-pnc-textlink-actions">' +
      '<button type="button" class="ms-pnc-textlink-btn" data-textlink-action="linked" data-problem-id="' +
      esc(s.problemId) +
      '" data-matched-id="' +
      esc(s.matchedProblemId) +
      '">Link as related</button>' +
      '<button type="button" class="ms-pnc-textlink-btn" data-textlink-action="thisChildOfMatch" data-problem-id="' +
      esc(s.problemId) +
      '" data-matched-id="' +
      esc(s.matchedProblemId) +
      '">Nest this under it</button>' +
      '<button type="button" class="ms-pnc-textlink-btn" data-textlink-action="matchChildOfThis" data-problem-id="' +
      esc(s.problemId) +
      '" data-matched-id="' +
      esc(s.matchedProblemId) +
      '">Nest it under this</button>' +
      (s.hasOtherRelationship
        ? '<button type="button" class="ms-pnc-textlink-btn ms-pnc-textlink-btn-leave" data-textlink-action="leaveAsIs" data-problem-id="' +
          esc(s.problemId) +
          '" data-matched-id="' +
          esc(s.matchedProblemId) +
          '">Leave as-is, remove text</button>'
        : '') +
      '</div>'
    );
  }

  function confirmBarHtml() {
    if (_cycleError) {
      return (
        '<div class="ms-pnc-confirmbar ms-pnc-confirmbar-error">' +
        esc(_cycleError) +
        ' <button type="button" id="ms-pnc-error-dismiss">Dismiss</button></div>'
      );
    }
    if (!_pendingAction) return '';
    var d = _pendingAction;
    var message;
    var confirmLabel;
    var busyLabel;
    // Only the drag/keyboard drop gesture (kind 'link') offers a second
    // choice — see the 'link' branch below and confirmPendingAction's own
    // commitAs parameter (2026-08-09: "now we have the option of linking
    // problems rather than/as well as nesting them" via drag-and-drop, not
    // just the text-derived suggestions, which already offered this choice
    // as three separate tray buttons instead of one drop gesture).
    var secondaryConfirmLabel = null;
    var secondaryBusyLabel = null;
    if (d.kind === 'unlink') {
      message =
        'This will remove the link between <strong>' +
        esc(d.childDescription) +
        '</strong> and <strong>' +
        esc(d.parentDescription) +
        '</strong> — <strong>' +
        esc(d.childDescription) +
        '</strong> will become a top-level problem again. There is no undo; re-link it by dragging it onto ' +
        esc(d.parentDescription) +
        ' again.';
      confirmLabel = 'Confirm — remove link';
      busyLabel = 'Removing…';
    } else if (d.kind === 'flat-unlink') {
      // The red (X) on a confirmed linked-problem line (2026-08-19) — a
      // FLAT (non-hierarchical, symmetric) relationship, distinct from
      // 'unlink' above (which only ever removes a parent/child nest).
      message =
        'This will remove the link between <strong>' +
        esc(d.aDescription) +
        '</strong> and <strong>' +
        esc(d.bDescription) +
        '</strong> — neither becomes a child of the other, this just un-links them. There is no undo; re-link them ' +
        'by dragging one onto the other again.';
      confirmLabel = 'Confirm — remove link';
      busyLabel = 'Removing…';
    } else if (d.kind === 'link') {
      // Each choice states ITS OWN consequence (review finding: the nest
      // copy — including the re-parent "will move it out of there"
      // disclosure — sat above BOTH buttons, describing the opposite of
      // what "Confirm — link problems" actually does).
      if (d.nestAllowed === false) {
        message =
          'Nesting <strong>' +
          esc(d.childDescription) +
          '</strong> under <strong>' +
          esc(d.parentDescription) +
          '</strong> would create a loop in the hierarchy, so only a flat link is offered: ' +
          '"Confirm — link problems" records them as related problems — no nesting, neither becomes a child of the other.';
        confirmLabel = 'Confirm — link problems';
        busyLabel = 'Linking…';
      } else {
        message =
          '"Confirm — nest it" will nest <strong>' +
          esc(d.childDescription) +
          '</strong> under <strong>' +
          esc(d.parentDescription) +
          '</strong> — it will display as a child on the problem list, not as a top-level problem. ' +
          // Re-parent disclosure (see buildPendingLink): moving a problem
          // out of a hierarchy the clinician chose must be named, never
          // implied — confirming the NEST is a MOVE, not an addition.
          (d.previousParentId
            ? 'It is <strong>currently nested under ' +
              esc(d.previousParentDescription) +
              '</strong> — nesting will move it out of there. '
            : '') +
          '"Confirm — link problems" instead records a flat "related problems" link — no nesting changes' +
          (d.previousParentId ? ' (it stays under ' + esc(d.previousParentDescription) + ')' : '') +
          '. There is no bulk undo; links are removed individually — click the red × on the link\'s own line once it\'s drawn.';
        confirmLabel = 'Confirm — nest it';
        busyLabel = 'Linking…';
        secondaryConfirmLabel = 'Confirm — link problems';
        secondaryBusyLabel = 'Linking…';
      }
    } else if (d.kind === 'textlink-linked') {
      message =
        'This will create a flat (non-hierarchical) link between <strong>' +
        esc(d.problemDescription) +
        '</strong> and <strong>' +
        esc(d.matchedDescription) +
        '</strong> — neither becomes a child of the other.';
      confirmLabel = 'Confirm — link them';
      busyLabel = 'Linking…';
    } else if (d.kind === 'textlink-thisChildOfMatch' || d.kind === 'textlink-matchChildOfThis') {
      var childDesc = d.kind === 'textlink-thisChildOfMatch' ? d.problemDescription : d.matchedDescription;
      var parentDesc = d.kind === 'textlink-thisChildOfMatch' ? d.matchedDescription : d.problemDescription;
      message =
        'This will nest <strong>' +
        esc(childDesc) +
        '</strong> under <strong>' +
        esc(parentDesc) +
        '</strong> — it will display as a child on the problem list, not as a top-level problem.';
      confirmLabel = 'Confirm — nest it';
      busyLabel = 'Linking…';
    } else if (d.kind === 'textlink-alreadyRelated') {
      message =
        'This problem is already linked/nested with <strong>' +
        esc(d.matchedDescription) +
        '</strong> — this will just remove the now-redundant import text.';
      confirmLabel = 'Confirm — remove text';
      busyLabel = 'Removing…';
    } else if (d.kind === 'textlink-leaveAsIs') {
      message =
        'This problem already has another relationship recorded — this will just remove the ' +
        'now-redundant import text, leaving that relationship as-is.';
      confirmLabel = 'Confirm — remove text';
      busyLabel = 'Removing…';
    } else if (d.kind === 'finalise') {
      var s = d.summary || { ends: [], sigs: [], count: 0 };
      var lines = [];
      if (s.ends.length) {
        lines.push(
          '<strong>' +
            s.ends.length +
            '</strong> problem' +
            (s.ends.length === 1 ? '' : 's') +
            ' ended as <strong>Resolved</strong> (today’s date): ' +
            s.ends
              .slice(0, 12)
              .map(function (item) {
                return esc(item.description);
              })
              .join('; ') +
            (s.ends.length > 12 ? '…' : '')
        );
      }
      if (s.sigs.length) {
        lines.push(
          '<strong>' +
            s.sigs.length +
            '</strong> significance change' +
            (s.sigs.length === 1 ? '' : 's') +
            ': ' +
            s.sigs
              .slice(0, 12)
              .map(function (item) {
                return esc(item.description) + ' → ' + esc(item.targetLabel);
              })
              .join('; ') +
            (s.sigs.length > 12 ? '…' : '')
        );
      }
      message =
        'This will write everything you have staged on this canvas, via Medicus’s own forms. ' +
        'There is no canvas undo — use Medicus to reopen an ended problem. ' +
        lines.join(' ') +
        '. Nesting and linking you already confirmed are already written.';
      confirmLabel = 'Confirm — write all ' + s.count;
      busyLabel = 'Writing…';
    } else if (d.kind === 'abandon') {
      message =
        'You have <strong>' +
        (d.count || 0) +
        '</strong> unwritten staged change' +
        ((d.count || 0) === 1 ? '' : 's') +
        ' on this canvas. Discard them and close?';
      confirmLabel = 'Discard and close';
      busyLabel = 'Closing…';
    } else if (d.kind === 'discard') {
      message =
        'Discard <strong>' +
        (d.count || 0) +
        '</strong> staged change' +
        ((d.count || 0) === 1 ? '' : 's') +
        ' and put the tiles back? Nothing has been written.';
      confirmLabel = 'Discard staged';
      busyLabel = 'Discarding…';
    } else {
      return '';
    }
    return (
      '<div class="ms-pnc-confirmbar">' +
      message +
      '<div class="ms-pnc-confirmbar-actions">' +
      '<button type="button" class="ms-pnc-cancel" id="ms-pnc-action-cancel"' +
      (d.linking ? ' disabled' : '') +
      '>Cancel</button>' +
      (secondaryConfirmLabel
        ? '<button type="button" class="ms-pnc-confirm-btn ms-pnc-confirm-btn-secondary" id="ms-pnc-action-confirm-alt"' +
          (d.linking ? ' disabled' : '') +
          '>' +
          (d.linking ? secondaryBusyLabel : secondaryConfirmLabel) +
          '</button>'
        : '') +
      '<button type="button" class="ms-pnc-confirm-btn" id="ms-pnc-action-confirm"' +
      (d.linking ? ' disabled' : '') +
      '>' +
      (d.linking ? busyLabel : confirmLabel) +
      '</button>' +
      '</div>' +
      (d.error ? '<div class="ms-pnc-card-error">' + esc(d.error) + '</div>' : '') +
      '</div>'
    );
  }

  function footerHtml(summary) {
    var parts = [];
    if (summary && summary.count) {
      var bits = [];
      if (summary.ends.length) bits.push(summary.ends.length + ' to end');
      if (summary.sigs.length) bits.push(summary.sigs.length + ' significance');
      parts.push(
        '<span class="ms-pnc-draft-summary">' +
          summary.count +
          ' staged (' +
          bits.join(', ') +
          ') — not written yet</span>' +
          '<button type="button" class="ms-pnc-discard" id="ms-pnc-discard">Discard staged</button>' +
          '<button type="button" class="ms-pnc-finalise" id="ms-pnc-finalise">Finalise…</button>'
      );
    }
    if (_linkedCount) {
      parts.push(
        '<span>' +
          _linkedCount +
          ' change' +
          (_linkedCount === 1 ? '' : 's') +
          ' written</span> <button type="button" id="ms-pnc-refresh">Refresh page</button>'
      );
    }
    if (!parts.length) return '';
    return '<div class="ms-pnc-footer">' + parts.join('<span class="ms-pnc-footer-gap"></span>') + '</div>';
  }

  function wrapPanel(contentHtml) {
    return (
      '<div class="ms-pnc-backdrop">' +
      '<div class="ms-pnc-panel" role="dialog" aria-modal="true" aria-label="Organise problems">' +
      '<div class="ms-pnc-header"><h2 class="ms-pnc-title">Organise problems</h2>' +
      '<button type="button" class="ms-pnc-close" id="ms-pnc-close">Close</button></div>' +
      contentHtml +
      '</div>' +
      '</div>'
    );
  }

  // 2026-08-19: the right-hand "Suggested links" tray pane is gone —
  // SNOMED-ancestry and "(Grouped with X)" suggestions now render as
  // dotted lines straight onto the suggested tiles themselves (see
  // tileHtml/annotateTreeSuggestions), and the separate "Unknown
  // significance, pick a grade" card is dropped entirely: the Unresolved
  // lane already IS "needs a significance decision", and dragging a tile
  // out of it into Major/Minor already stages exactly that (Nick's
  // confirmed call — the lane + existing drag is the same information,
  // without a second UI for it).
  function bodyHtml(laneTrees, endedProblems) {
    return (
      '<div class="ms-pnc-explainer">Drag a problem onto another to nest or link it (that still ' +
      'confirms one pair at a time) — a dotted line marks a suggested pairing worth trying. Drop on ' +
      '<strong>Major / Minor / Unresolved</strong> or <strong>End</strong> to stage the change — arrange as ' +
      'many as you like, then <strong>Finalise</strong> to write them all. Drag a staged tile back out to ' +
      'undo it. Click a tile to recode it or remove a nest.</div>' +
      '<div class="ms-pnc-body">' +
      '<svg class="ms-pnc-lines" aria-hidden="true"></svg>' +
      '<div class="ms-pnc-lanes" id="ms-pnc-lanes">' +
      laneHtml('major', 'Major', laneTrees.major) +
      laneHtml('minor', 'Minor', laneTrees.minor) +
      laneHtml('unknown', 'Unresolved', laneTrees.unknown) +
      binHtml(endedProblems) +
      '</div>' +
      '</div>'
    );
  }

  function laneHtml(key, label, tree) {
    var empty = !tree || !tree.length;
    return (
      '<div class="ms-pnc-lane" data-sig-lane="' +
      esc(key) +
      '" tabindex="0" aria-label="' +
      esc(label) +
      ' problems">' +
      '<div class="ms-pnc-lane-heading">' +
      esc(label) +
      '</div>' +
      (empty ? '<div class="ms-pnc-empty">None</div>' : treeHtml(tree)) +
      '</div>'
    );
  }

  function binTileHtml(problem) {
    if (!problem || !problem.id) return '';
    return (
      '<div class="ms-pnc-tile ms-pnc-bin-tile' +
      (_kbPickedId === problem.id ? ' ms-pnc-tile-picked' : '') +
      '" draggable="true" tabindex="0" data-problem-id="' +
      esc(problem.id) +
      '">' +
      '<div class="ms-pnc-tile-main">' +
      '<div class="ms-pnc-tile-desc">' +
      esc(problem.description || problem.id) +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function binHtml(endedProblems) {
    var list = Array.isArray(endedProblems) ? endedProblems : [];
    var count = list.length;
    return (
      '<div class="ms-pnc-bin" data-end-bin tabindex="0" aria-label="End problems (' +
      count +
      ' staged)">' +
      '<div class="ms-pnc-bin-heading">End' +
      (count ? ' (' + count + ')' : '') +
      '</div>' +
      (count
        ? '<div class="ms-pnc-bin-list">' +
          list
            .map(function (p) {
              return binTileHtml(p);
            })
            .join('') +
          '</div>'
        : '<div class="ms-pnc-bin-hint">Drop problems here. Nothing is ended until you Finalise.</div>') +
      '</div>'
    );
  }

  // ── Connector-line drawing ────────────────────────────────────────────────

  // 2026-08-19: suggestion lines now route the SAME elbow/bus way as
  // confirmed linked-problem lines (Nick's feedback: "please can the dotted
  // lines work as the linked lines do so they are visible to the right of
  // the problems themselves") — both reach out from a tile's own RIGHT edge
  // to a shared vertical bus, so this is one shared routing pass over BOTH
  // pair types rather than two separate code paths. The earlier diagonal
  // bezier version (buildConnectorPath) is fully removed, not just retired
  // — it had no remaining caller once this switched to elbow routing.
  // Suggestion-line sets continue the SAME lane-index sequence linked-line
  // sets use, immediately after them, so the two never share a lane and
  // stay visually separate strips.
  function updateConnectorLines(root) {
    var svg = root.querySelector('.ms-pnc-lines');
    var body = root.querySelector('.ms-pnc-body');
    if (!svg || !body) return;
    var containerRect = body.getBoundingClientRect();
    svg.setAttribute('width', String(containerRect.width));
    svg.setAttribute('height', String(containerRect.height));
    var markup = [];
    var treeTileRects = [];
    root.querySelectorAll('.ms-pnc-lane .ms-pnc-tile[data-problem-id]').forEach(function (tile) {
      treeTileRects.push(relativeRect(tile.getBoundingClientRect(), containerRect));
    });
    var treePaneEl = root.querySelector('#ms-pnc-lanes');
    var treePaneRightEdge = treePaneEl
      ? relativeRect(treePaneEl.getBoundingClientRect(), containerRect).right
      : undefined;
    var busX = computeLinkBusX(treeTileRects, 16, treePaneRightEdge);
    if (busX === null) {
      svg.innerHTML = '';
      return;
    }

    function tileRect(id) {
      var tile = root.querySelector('.ms-pnc-lane .ms-pnc-tile[data-problem-id="' + cssEscapeId(id) + '"]');
      return tile ? relativeRect(tile.getBoundingClientRect(), containerRect) : null;
    }
    // Reads a tile's own visible description straight off the DOM — cheap,
    // and always current (2026-08-19, for both the remove-flag's tooltip
    // and the suggestion flag's per-candidate tooltip; no separate id->desc
    // map needs threading through from render()).
    var descCache = {};
    function tileDesc(id) {
      if (id in descCache) return descCache[id];
      var tile = root.querySelector('.ms-pnc-lane .ms-pnc-tile[data-problem-id="' + cssEscapeId(id) + '"]');
      var descEl = tile && tile.querySelector('.ms-pnc-tile-desc');
      var text = descEl ? descEl.textContent : id;
      descCache[id] = text;
      return text;
    }

    var nextLane = 0;

    // Linked problems (2026-08-08, revised same day to elbow/bus routing —
    // see buildElbowConnectorPath's own comment for why) — display-only
    // until 2026-08-19: each pair now ALSO gets a red (X) removal marker at
    // its own midpoint (linkRemoveFlagHtml), Nick's request for a direct
    // way to remove a flat link without first clicking the tile to select
    // it. Reads data-linked-ids straight off the DOM, not passed-in state,
    // so this stays correct across scheduleLineUpdate's scroll/resize
    // recomputes without needing to thread render()'s own data through.
    var linkEntries = [];
    root.querySelectorAll('.ms-pnc-lane .ms-pnc-tile[data-linked-ids]').forEach(function (tile) {
      linkEntries.push({
        id: tile.getAttribute('data-problem-id'),
        linkedIds: (tile.getAttribute('data-linked-ids') || '').split(',').filter(Boolean),
      });
    });
    // Each connected SET (2026-08-08 follow-up: separate sets were sharing
    // one bus AND one colour, indistinguishable from a single genuinely-
    // connected group) gets its own lane and colour — see
    // groupLinkedPairsIntoSets/linkSetLaneX/linkSetColor's own comments.
    groupLinkedPairsIntoSets(buildLinkedProblemPairs(linkEntries)).forEach(function (setPairs) {
      var laneX = linkSetLaneX(busX, nextLane, 14);
      var color = linkSetColor(nextLane);
      nextLane++;
      setPairs.forEach(function (pair) {
        var rectA = tileRect(pair.a);
        var rectB = tileRect(pair.b);
        if (!rectA || !rectB) return; // one side not currently rendered — no line to draw
        var d = buildElbowConnectorPath(rectA, rectB, laneX);
        if (!d) return;
        markup.push('<path d="' + d + '" class="ms-pnc-link-line" style="stroke: ' + color + '"></path>');
        markup.push(
          linkRemoveFlagHtml(elbowFlagPoint(rectA, rectB, laneX), pair.a, pair.b, tileDesc(pair.a), tileDesc(pair.b))
        );
      });
    });

    // Suggestion lines (2026-08-19: moved off the removed suggestion tray
    // onto the suggested tiles themselves — see tileHtml's own comment). A
    // SNOMED-ancestry child points to each of its candidate parents; a
    // "(Grouped with X)" subject points to its matched problem. Both are
    // ordinary lane tiles now (data-suggested-ids / data-textlink-id).
    // Dashed (unconfirmed — never a written relationship yet, unlike the
    // solid links above) plus a shape+letter flag naming each line's own
    // kind (suggestionFlagHtml) — continues the SAME lane sequence the
    // linked-line sets above used, so the two pair types never collide on
    // one lane even though they share the one bus position. The flag's
    // tooltip carries the FULL per-candidate explanation (2026-08-19 — this
    // used to sit permanently on the card; see tileHtml's own comment for
    // why it moved here instead).
    var suggestionEntries = [];
    root.querySelectorAll('.ms-pnc-lane .ms-pnc-tile[data-suggested-ids], .ms-pnc-lane .ms-pnc-tile[data-textlink-id]').forEach(
      function (tile) {
        suggestionEntries.push({
          id: tile.getAttribute('data-problem-id'),
          suggestedIds: (tile.getAttribute('data-suggested-ids') || '').split(',').filter(Boolean),
          textlinkId: tile.getAttribute('data-textlink-id') || null,
        });
      }
    );
    groupLinkedPairsIntoSets(buildSuggestionPairs(suggestionEntries)).forEach(function (setPairs) {
      var laneX = linkSetLaneX(busX, nextLane, 14);
      nextLane++;
      setPairs.forEach(function (pair) {
        var rectA = tileRect(pair.a);
        var rectB = tileRect(pair.b);
        if (!rectA || !rectB) return; // candidate not currently rendered — no line to draw
        var d = buildElbowConnectorPath(rectA, rectB, laneX);
        if (!d) return;
        var lineClass = pair.kind === 'textlink' ? 'ms-pnc-suggestion-line ms-pnc-suggestion-line-textlink' : 'ms-pnc-suggestion-line';
        markup.push('<path d="' + d + '" class="' + lineClass + '"></path>');
        var title =
          pair.kind === 'textlink'
            ? 'Import text match — "Grouped with ' + tileDesc(pair.b) + '"'
            : suggestionCandidateTitleText(tileDesc(pair.b), pair.source) + ' — drag onto it to confirm';
        markup.push(suggestionFlagHtml(elbowFlagPoint(rectA, rectB, laneX), pair.kind, title));
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
      var root = el && el.querySelector('.ms-pnc-root');
      if (root) updateConnectorLines(root);
    });
  }

  // ── Drag / drop / connector-click / confirm ───────────────────────────────

  // commitAs (2026-08-09) — only meaningful for kind 'link' (the drag/
  // keyboard drop gesture), which now offers TWO relationship types from
  // the SAME drop instead of always nesting: pass 'flatlink' (from the
  // confirm bar's secondary button) to create a flat, non-hierarchical
  // link via commitFlatLink instead of the default commitParentLink. Every
  // other kind ignores this parameter entirely.
  async function confirmPendingAction(commitAs) {
    var d = _pendingAction;
    if (!d || d.linking || !window.ProblemNesting) return;
    // Commit-time patient re-check — the last line of defence behind
    // render()'s own mismatch guard: the bridge's commit functions POST with
    // ITS current _lastPatientId, so a confirm built while patient A was
    // loaded must never fire once the SPA has navigated to patient B.
    if (window.ProblemNesting.getSnapshot().patientId !== _openedPatientId) {
      close();
      return;
    }
    d.linking = true;
    d.error = null;
    render();
    try {
      if (d.kind === 'unlink') {
        await window.ProblemNesting.commitUnlink(d.childId);
        announce(d.childDescription + ' is no longer nested under ' + d.parentDescription);
      } else if (d.kind === 'flat-unlink') {
        await window.ProblemNesting.commitFlatUnlink(d.a, d.b);
        announce(d.aDescription + ' is no longer linked with ' + d.bDescription);
      } else if (d.kind === 'link') {
        // nestAllowed === false means the bar's ONE button is the flat
        // link (see buildPendingLink) — the primary confirm handler passes
        // no commitAs, so without this a loop-blocked pair would fall into
        // the nest branch it was never offered.
        if (commitAs === 'flatlink' || d.nestAllowed === false) {
          await window.ProblemNesting.commitFlatLink(d.childId, d.parentId);
          announce('Linked ' + d.childDescription + ' with ' + d.parentDescription);
        } else {
          await window.ProblemNesting.commitParentLink(d.childId, d.parentId);
          announce('Nested ' + d.childDescription + ' under ' + d.parentDescription);
        }
      } else if (d.kind === 'textlink-linked') {
        await window.ProblemNesting.commitFlatLink(d.problemId, d.matchedId);
        announce('Linked ' + d.problemDescription + ' with ' + d.matchedDescription);
        await settleTextLinkAfterRelationship(d.problemId);
      } else if (d.kind === 'textlink-thisChildOfMatch') {
        await window.ProblemNesting.commitParentLink(d.problemId, d.matchedId);
        announce('Nested ' + d.problemDescription + ' under ' + d.matchedDescription);
        await settleTextLinkAfterRelationship(d.problemId);
      } else if (d.kind === 'textlink-matchChildOfThis') {
        await window.ProblemNesting.commitParentLink(d.matchedId, d.problemId);
        announce('Nested ' + d.matchedDescription + ' under ' + d.problemDescription);
        await settleTextLinkAfterRelationship(d.problemId);
      } else if (d.kind === 'textlink-alreadyRelated' || d.kind === 'textlink-leaveAsIs') {
        // 'textlink-alreadyRelated': the relationship the text described is
        // already real. 'textlink-leaveAsIs': a DIFFERENT relationship
        // already exists and the clinician is satisfied with it, not the
        // text's guess (both via checkExistingRelationship, run at scan
        // time). Either way — no write here, just the text cleanup. Unlike
        // the three commit branches above (which already have a real
        // relationship write to count/dismiss even if this fails), removing
        // the text IS the whole action here — every outcome must be told
        // apart (review finding: the old code announced success on a no-op
        // and did nothing visible at all when the bridge was missing).
        var stripResult = await stripTextLinkBoilerplate(d.problemId);
        if (stripResult === 'failed') {
          d.error = 'Failed to remove the import text — please try again.';
          return; // card stays offered; d.linking resets via finally
        }
        if (stripResult === 'unavailable') {
          d.error = 'The text-editing tool isn’t available on this page — the import text was not removed.';
          return;
        }
        _dismissedTextLinkProblemIds.add(d.problemId);
        window.ProblemNesting.consumeTextLinkSuggestion(d.problemId);
        if (stripResult === 'nothing-to-strip') {
          // The text is already gone (removed elsewhere since the scan) —
          // nothing was written just now, so don't count a change: dismiss
          // the stale card, say what actually happened, and stop.
          announce('The import text was already removed — nothing left to do.');
          _pendingAction = null;
          window.ProblemNesting.refresh();
          return;
        }
        announce('Removed the import text for ' + d.problemDescription);
      } else if (d.kind === 'abandon') {
        _draft = emptyDraft();
        _pendingAction = null;
        close();
        return;
      } else if (d.kind === 'discard') {
        _draft = emptyDraft();
        _pendingAction = null;
        announce('Staged changes discarded — nothing was written.');
        render();
        return;
      } else if (d.kind === 'finalise') {
        if (!window.ProblemNesting.commitEndProblem && (_draft.endIds || []).length) {
          throw new Error('Ending a problem isn’t available on this page.');
        }
        var remaining = cloneDraft(_draft);
        var snapNow = window.ProblemNesting.getSnapshot();
        var parentMap = snapNow.parentIdByProblemId || {};
        var sigKeys = Object.keys(remaining.sigById || {});
        for (var si = 0; si < sigKeys.length; si++) {
          var sid = sigKeys[si];
          if (remaining.endIds.indexOf(sid) !== -1) continue;
          await window.ProblemNesting.commitSignificanceChange(sid, remaining.sigById[sid]);
          delete remaining.sigById[sid];
          _draft = cloneDraft(remaining);
          _linkedCount++;
        }
        var endOrder = orderEndsForCommit(remaining.endIds, parentMap);
        for (var ei = 0; ei < endOrder.length; ei++) {
          var eid = endOrder[ei];
          await window.ProblemNesting.commitEndProblem(eid);
          remaining.endIds = remaining.endIds.filter(function (id) {
            return id !== eid;
          });
          _draft = cloneDraft(remaining);
          _linkedCount++;
        }
        _draft = emptyDraft();
        announce('Wrote the staged canvas changes.');
        _pendingAction = null;
        window.ProblemNesting.refresh();
        return;
      } else {
        return;
      }
      _linkedCount++;
      _pendingAction = null;
      // refresh() re-renders problem-nesting.js's own accordion DOM (if
      // mounted) and fires onChange, which re-renders this canvas too — see
      // the bridge in problem-nesting.js.
      window.ProblemNesting.refresh();
    } catch (err) {
      d.error = (err && err.message) || 'Failed to save this change — please try again.';
      if (d.kind === 'finalise') {
        var failSnap = window.ProblemNesting.getSnapshot();
        var failDesc = {};
        (failSnap.problems || []).forEach(function (p) {
          if (p && p.id) failDesc[p.id] = p.description;
        });
        d.summary = summariseDraft(_draft, failDesc);
      }
    } finally {
      d.linking = false;
      render();
    }
  }

  // Best-effort follow-up after a successful "(Grouped with X)" relationship
  // commit (or, for the already-related case, on its own) — delegates the
  // actual text edit to problem-description-cleanup.js's own bridge (this
  // file owns no text-editing write path of its own; see
  // window.ProblemDescriptionCleanup.stripGenericAdditionalInfoText's own
  // header for why the implementation lives there, not duplicated here).
  // 2026-08-09 follow-up: "offer to remove the generic text as part of the
  // linking process" — this file's own inline widget already does this
  // automatically after a successful link; the canvas now matches it. A
  // failure here does NOT roll back or fail the relationship (already
  // real) — surfaced as its own distinct announcement rather than implying
  // the whole action failed, same non-fatal discipline problem-description-
  // cleanup.js's own applyLinkSuggestion uses for its identical step.
  // Returns a distinct status per outcome rather than a bare boolean
  // (review finding: the old true/false collapsed "stripped", "nothing to
  // strip", "bridge missing" and "failed" into two values — a no-op strip
  // was announced as "Removed the import text", a missing bridge was a
  // silent dead click, and the failure announcement claimed "the
  // relationship was created" even for the text-only actions that create
  // none). The CALLER decides what each outcome means for its own action —
  // no announcements happen in here.
  //   'stripped'         — the text edit was posted and the text removed
  //   'nothing-to-strip' — the edit form no longer carries recognisable
  //                        boilerplate (someone already removed it)
  //   'unavailable'      — the ProblemDescriptionCleanup bridge isn't on
  //                        this page, so no text edit is possible
  //   'failed'           — a real fetch/post error
  async function stripTextLinkBoilerplate(problemId) {
    if (!window.ProblemDescriptionCleanup || !window.ProblemDescriptionCleanup.stripGenericAdditionalInfoText) {
      return 'unavailable';
    }
    try {
      var did = await window.ProblemDescriptionCleanup.stripGenericAdditionalInfoText(problemId);
      return did ? 'stripped' : 'nothing-to-strip';
    } catch (err) {
      return 'failed';
    }
  }

  // Shared tail of the three relationship-commit branches below: the
  // relationship write has ALREADY succeeded; try the best-effort text
  // strip, then settle the suggestion's lifecycle in problem-nesting.js's
  // own list (review finding: the canvas-local dismissed Set is reset on
  // every open(), so without consuming the SOURCE suggestion the same card
  // came back on reopen offering to re-create the just-created
  // relationship). Strip ok/no-op -> the suggestion is fully consumed;
  // strip failed/unavailable -> the leftover text is the only remaining
  // work, so the suggestion converts to the single "remove import text"
  // offer instead of vanishing with the text still on the record.
  async function settleTextLinkAfterRelationship(problemId) {
    var stripResult = await stripTextLinkBoilerplate(problemId);
    _dismissedTextLinkProblemIds.add(problemId);
    if (stripResult === 'stripped' || stripResult === 'nothing-to-strip') {
      window.ProblemNesting.consumeTextLinkSuggestion(problemId);
    } else {
      window.ProblemNesting.markTextLinkAlreadyRelated(problemId);
      announce(
        'The relationship was created, but the import text could not be removed automatically — reopen this canvas to try removing it again.'
      );
    }
  }

  // Shared endpoint of BOTH link gestures (pointer drop and keyboard drop) —
  // one cycle guard, one re-parent disclosure (buildPendingLink), one
  // confirm bar, whichever input proposed it.
  function proposeLink(childId, parentId, snap, descById) {
    if (!childId || !parentId || childId === parentId || !window.ProblemNesting) return;
    _draft = unstageEnd(_draft, childId, snap.parentIdByProblemId);
    var pending = buildPendingLink(childId, parentId, descById, snap.parentIdByProblemId);
    if (window.ProblemNesting.wouldCreateCycle(childId, parentId, snap.parentIdByProblemId)) {
      // Nesting would loop — but a FLAT link between the same pair is
      // non-hierarchical and always safe, so offer that instead of
      // blocking the whole gesture (see buildPendingLink's nestAllowed
      // comment). commitParentLink re-checks the cycle at commit time
      // regardless, so this stays advisory, not the only line of defence.
      pending.nestAllowed = false;
    }
    _pendingAction = pending;
    render();
  }

  function proposeSignificance(problemId, targetKey, snap, descById) {
    if (!problemId || !targetKey || !snap) return;
    var liveKey = liveLaneKey(snap.infoById, problemId);
    var currentKey = effectiveLaneKey(snap.infoById, _draft, problemId);
    if (currentKey === targetKey && !(_draft.sigById && _draft.sigById[problemId]) && _draft.endIds.indexOf(problemId) === -1) {
      return;
    }
    _cycleError = null;
    _pendingAction = null;
    _draft = stageSignificance(_draft, problemId, targetKey, liveKey, snap.parentIdByProblemId);
    announce(
      'Staged ' +
        ((descById && descById[problemId]) || 'problem') +
        ' as ' +
        (targetKey === 'unknown' ? 'Unresolved' : targetKey === 'major' ? 'Major' : 'Minor') +
        '. Finalise when the board looks right.'
    );
    render();
  }

  function proposeEnd(problemId, snap, descById) {
    if (!problemId || !snap) return;
    var description = (descById && descById[problemId]) || problemId;
    var result = stageEnd(_draft, problemId, snap.parentIdByProblemId);
    if (result.error === 'has-children') {
      _cycleError =
        description +
        ' still has active child problems that are not also in End. Stage the children first, or un-nest them.';
      render();
      return;
    }
    _cycleError = null;
    _pendingAction = null;
    _draft = result.draft;
    announce('Staged ' + description + ' in End (' + _draft.endIds.length + ' waiting). Finalise when ready.');
    render();
  }

  function proposeFinalise(snap, descById) {
    var summary = summariseDraft(_draft, descById);
    if (!summary.count) return;
    _cycleError = null;
    _pendingAction = { kind: 'finalise', summary: summary, linking: false, error: null };
    render();
  }

  function proposeDiscard() {
    var summary = summariseDraft(_draft, {});
    if (!summary.count) return;
    _pendingAction = { kind: 'discard', count: summary.count, linking: false, error: null };
    render();
  }

  function bindCommonEvents(root) {
    root.querySelector('#ms-pnc-close')?.addEventListener('click', requestClose);
    root.querySelector('.ms-pnc-backdrop')?.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) requestClose();
    });
  }

  function bindEvents(root, snap) {
    bindCommonEvents(root);
    root.querySelector('#ms-pnc-refresh')?.addEventListener('click', function () {
      location.reload();
    });
    root.querySelector('#ms-pnc-error-dismiss')?.addEventListener('click', function () {
      _cycleError = null;
      render();
    });
    root.querySelector('#ms-pnc-action-cancel')?.addEventListener('click', function () {
      _pendingAction = null;
      render();
    });
    root.querySelector('#ms-pnc-action-confirm')?.addEventListener('click', function () {
      confirmPendingAction();
    });
    root.querySelector('#ms-pnc-action-confirm-alt')?.addEventListener('click', function () {
      confirmPendingAction('flatlink');
    });

    // Delegated (2026-08-19) — the red (X) remove-flag markers live inside
    // .ms-pnc-lines' SVG, whose innerHTML updateConnectorLines fully
    // rebuilds on every scroll/resize (scheduleLineUpdate), not just on a
    // full render(). A listener bound directly to one of those <g> nodes
    // would be silently orphaned the next time that happens. One listener
    // on root (rebuilt only by render() itself, so it survives those SVG
    // rebuilds) closest()-matches the click instead — same technique this
    // file already leans on for everything that must survive a rebuild
    // without needing to re-run bindEvents.
    root.querySelector('.ms-pnc-lines')?.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('.ms-pnc-remove-flag-group');
      if (!g) return;
      var a = g.getAttribute('data-remove-a');
      var b = g.getAttribute('data-remove-b');
      if (!a || !b) return;
      _pendingAction = {
        kind: 'flat-unlink',
        a: a,
        b: b,
        aDescription: g.getAttribute('data-remove-a-desc') || a,
        bDescription: g.getAttribute('data-remove-b-desc') || b,
        linking: false,
        error: null,
      };
      render();
    });

    var descById = {};
    (snap.problems || []).forEach(function (p) {
      descById[p.id] = p.description;
    });
    root.querySelector('#ms-pnc-finalise')?.addEventListener('click', function () {
      proposeFinalise(snap, descById);
    });
    root.querySelector('#ms-pnc-discard')?.addEventListener('click', function () {
      proposeDiscard();
    });

    // click toggles this tile's action buttons; clicking the SAME tile
    // again, or any other tile, deselects/reselects. A drag never reaches
    // this handler: dragstart fires instead of click for an actual drag
    // gesture, standard HTML5 DnD behaviour.
    //
    // ROOT-TILE SHORTCUT (2026-08-08 follow-up): a tile with no parent has
    // nothing to unlink — "Remove link" would never show anyway (see
    // tileActionsHtml) — so there's only one real choice, and asking for a
    // click-to-select-then-click-the-button round trip for a single option
    // is friction, not safety. Skips straight to Edit problem instead.
    // "Has a parent" is judged the SAME way buildProblemTree decides
    // node.parentId (parent id present AND that parent still exists in the
    // live problem list), not the raw parentIdByProblemId value alone, so
    // this never disagrees with what the tile's own action buttons would
    // have shown. 2026-08-19: the shortcut is now ALSO skipped for a tile
    // carrying a pending "(Grouped with X)" text-link suggestion
    // (data-textlink-id) — that tile has a second real choice beyond Edit
    // problem (the relationship buttons in tileActionsHtml), so it needs
    // the select step same as a tile with a parent to unlink. A pending
    // SNOMED-ancestry suggestion alone does NOT block the shortcut — that's
    // confirmed by dragging the tile, not a button, so Edit problem is
    // still the only click-driven action on a root tile with no text-link.
    root.querySelectorAll('.ms-pnc-lane .ms-pnc-tile[data-problem-id]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var id = tile.getAttribute('data-problem-id');
        var parentId = snap.parentIdByProblemId[id];
        var hasRealParent = !!(parentId && Object.prototype.hasOwnProperty.call(descById, parentId));
        if (!hasRealParent && !tile.hasAttribute('data-textlink-id')) {
          _selectedTileId = null;
          openEditPanel(id, descById[id]);
          return;
        }
        _selectedTileId = _selectedTileId === id ? null : id;
        render();
      });
    });

    root.querySelectorAll('.ms-pnc-tile-action[data-action="unlink"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var childId = btn.getAttribute('data-target-id');
        var parentId = snap.parentIdByProblemId[childId];
        if (!childId || !parentId) return;
        _selectedTileId = null;
        _pendingAction = {
          kind: 'unlink',
          childId: childId,
          parentId: parentId,
          childDescription: descById[childId] || childId,
          parentDescription: descById[parentId] || parentId,
          linking: false,
          error: null,
        };
        render();
      });
    });

    root.querySelectorAll('.ms-pnc-tile-action[data-action="edit"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-target-id');
        if (!id) return;
        openEditPanel(id, descById[id]);
      });
    });

    // "(Grouped with X)" text-link suggestion buttons (2026-08-09) — same
    // set-_pendingAction-then-confirm flow as unlink/link above, never a
    // direct commit on click.
    root.querySelectorAll('.ms-pnc-textlink-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var problemId = btn.getAttribute('data-problem-id');
        var matchedId = btn.getAttribute('data-matched-id');
        var action = btn.getAttribute('data-textlink-action');
        if (!problemId || !matchedId || !action) return;
        _pendingAction = {
          kind: 'textlink-' + action,
          problemId: problemId,
          matchedId: matchedId,
          problemDescription: descById[problemId] || problemId,
          matchedDescription: descById[matchedId] || matchedId,
          linking: false,
          error: null,
        };
        render();
      });
    });

    var clearDrag = function () {
      _dragPayload = null;
    };
    root.querySelectorAll('[draggable="true"][data-problem-id]').forEach(function (tile) {
      tile.addEventListener('dragstart', function (e) {
        var id = tile.getAttribute('data-problem-id');
        _dragPayload = { problemId: id };
        e.dataTransfer.setData('text/plain', JSON.stringify(_dragPayload));
        e.dataTransfer.effectAllowed = 'move';
      });
      tile.addEventListener('dragend', clearDrag);
    });
    root.querySelectorAll('[data-problem-id]').forEach(function (tile) {
      tile.addEventListener('dragover', function (e) {
        if (!_dragPayload) return;
        var targetId = tile.getAttribute('data-problem-id');
        if (targetId === _dragPayload.problemId) return; // can't drop a tile on itself
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.stopPropagation(); // innermost tile under the pointer decides — a parent tile's own tree ancestor must not also claim this drop
      });
      tile.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var payload = readDropPayload(e);
        _dragPayload = null;
        if (!payload) return;
        proposeLink(payload.problemId, tile.getAttribute('data-problem-id'), snap, descById);
      });
    });

    function currentLaneOf(problemId) {
      if (_draft.endIds.indexOf(problemId) !== -1) return null;
      return effectiveLaneKey(snap.infoById, _draft, problemId);
    }

    function applyClassifiedDrop(payload, dropTarget) {
      var classified = classifyDrop(payload, dropTarget, currentLaneOf(payload.problemId));
      if (!classified) return;
      if (classified.kind === 'link') {
        proposeLink(classified.childId, classified.parentId, snap, descById);
      } else if (classified.kind === 'end') {
        proposeEnd(classified.problemId, snap, descById);
      } else if (classified.targetKey) {
        proposeSignificance(classified.problemId, classified.targetKey, snap, descById);
      }
    }

    root.querySelectorAll('[data-sig-lane]').forEach(function (lane) {
      lane.addEventListener('dragover', function (e) {
        if (!_dragPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        lane.classList.add('ms-pnc-drop-hover');
      });
      lane.addEventListener('dragleave', function (e) {
        if (lane.contains(e.relatedTarget)) return;
        lane.classList.remove('ms-pnc-drop-hover');
      });
      lane.addEventListener('drop', function (e) {
        e.preventDefault();
        lane.classList.remove('ms-pnc-drop-hover');
        var payload = readDropPayload(e);
        _dragPayload = null;
        if (!payload) return;
        applyClassifiedDrop(payload, { type: 'lane', key: lane.getAttribute('data-sig-lane') });
      });
    });

    var bin = root.querySelector('[data-end-bin]');
    if (bin) {
      bin.addEventListener('dragover', function (e) {
        if (!_dragPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        bin.classList.add('ms-pnc-drop-hover');
      });
      bin.addEventListener('dragleave', function (e) {
        if (bin.contains(e.relatedTarget)) return;
        bin.classList.remove('ms-pnc-drop-hover');
      });
      bin.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        bin.classList.remove('ms-pnc-drop-hover');
        var payload = readDropPayload(e);
        _dragPayload = null;
        if (!payload) return;
        applyClassifiedDrop(payload, { type: 'bin' });
      });
    }

    // Keyboard path to the same link gesture (review finding: drag-and-drop
    // was the ONLY way to link — the widget's core function was unreachable
    // without a pointer, a regression from the deleted accordion's native
    // form controls). Enter/Space on a focused tile picks it up (announced
    // via the live region and shown via .ms-pnc-tile-picked); Enter/Space on
    // another tile proposes exactly the link a drop would — same
    // proposeLink, same cycle guard, same confirm bar. Escape cancels the
    // pick-up (see onKeydown). keydown, not click: these tiles are plain
    // divs, so Enter/Space never synthesise clicks the way buttons do — the
    // tree tiles' click-to-select behaviour is untouched.
    root.querySelectorAll('.ms-pnc-tile[data-problem-id]').forEach(function (tile) {
      tile.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        var id = tile.getAttribute('data-problem-id');
        if (!id) return;
        if (!_kbPickedId) {
          _kbPickedId = id;
          announce(
            'Picked up ' +
              (descById[id] || 'problem') +
              '. Move focus to the problem to nest it under and press Enter. Press Escape to cancel.'
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
        proposeLink(childId, id, snap, descById);
      });
    });

    root.querySelectorAll('[data-sig-lane]').forEach(function (lane) {
      lane.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!_kbPickedId) return;
        if (e.target !== lane) return; // a focused tile inside the lane handles its own Enter
        e.preventDefault();
        e.stopPropagation();
        var childId = _kbPickedId;
        _kbPickedId = null;
        applyClassifiedDrop({ problemId: childId }, { type: 'lane', key: lane.getAttribute('data-sig-lane') });
      });
    });
    root.querySelector('[data-end-bin]')?.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!_kbPickedId) return;
      e.preventDefault();
      e.stopPropagation();
      var childId = _kbPickedId;
      _kbPickedId = null;
      applyClassifiedDrop({ problemId: childId }, { type: 'bin' });
    });

    root.querySelectorAll('.ms-pnc-lane').forEach(function (pane) {
      pane.addEventListener('scroll', scheduleLineUpdate);
    });
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    // Escape closes whichever is on top first — the edit panel if it's
    // open, then a keyboard pick-up if one is in progress, otherwise the
    // whole canvas — never more than one at once.
    var el = document.getElementById(OVERLAY_ID);
    var overlay = el && el.querySelector('#ms-pnc-edit-overlay');
    if (overlay && !overlay.hidden) {
      closeEditPanel();
      return;
    }
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
    if (!window.ProblemNesting) return; // bridge not present — nothing to open onto
    window.ProblemNesting.ensureScanned();
    _pendingAction = null;
    _draft = emptyDraft();
    _cycleError = null;
    _kbPickedId = null;
    _linkedCount = 0;
    _dismissedTextLinkProblemIds = new Set();
    // Pin this canvas to the patient it opened against — see render()'s
    // mismatch guard and confirmPendingAction's commit-time re-check.
    _openedPatientId = window.ProblemNesting.getSnapshot().patientId;
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    // .ms-pnc-edit-overlay is a PERSISTENT sibling of .ms-pnc-root, same
    // discipline as .ms-pnc-live — render() only ever touches .ms-pnc-root,
    // so the "Edit problem" panel problem-description-cleanup.js builds
    // inside #ms-pnc-edit-body survives every canvas re-render (a
    // suggestion re-sorting, a merge elsewhere, …) instead of being
    // destroyed and losing whatever the clinician was mid-typing there.
    el.innerHTML =
      '<div class="ms-pnc-live" role="status" aria-live="polite"></div>' +
      '<div class="ms-pnc-root"></div>' +
      '<div class="ms-pnc-edit-overlay" id="ms-pnc-edit-overlay" hidden>' +
      '<div class="ms-pnc-edit-backdrop">' +
      '<div class="ms-pnc-edit-panel" role="dialog" aria-modal="true" aria-label="Edit problem">' +
      '<div class="ms-pnc-edit-header">' +
      '<h3 class="ms-pnc-edit-title" id="ms-pnc-edit-title"></h3>' +
      '<button type="button" class="ms-pnc-close" id="ms-pnc-edit-close">Close</button>' +
      '</div>' +
      '<div class="ms-pnc-edit-body" id="ms-pnc-edit-body"></div>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);
    render();
    el.querySelector('#ms-pnc-edit-close').addEventListener('click', closeEditPanel);
    el.querySelector('.ms-pnc-edit-backdrop').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeEditPanel();
    });
    document.addEventListener('keydown', onKeydown);
    if (!_resizeBound) {
      _resizeBound = true;
      window.addEventListener('resize', scheduleLineUpdate);
    }
    if (!_subscribed && window.ProblemNesting.onChange) {
      _subscribed = true;
      window.ProblemNesting.onChange(render);
    }
  }

  // Opens problem-description-cleanup.js's own review panel — unchanged
  // logic and rendering, just embedded in our overlay's edit-body container
  // instead of inline next to the Medicus row (see that file's
  // window.ProblemDescriptionCleanup.openInContainer). Idempotent: reopening
  // the same already-open problem just re-renders from its own cache.
  function openEditPanel(problemId, description) {
    var el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    var overlay = el.querySelector('#ms-pnc-edit-overlay');
    var body = el.querySelector('#ms-pnc-edit-body');
    var title = el.querySelector('#ms-pnc-edit-title');
    if (!overlay || !body) return;
    if (!window.ProblemDescriptionCleanup) {
      title.textContent = description || 'Edit problem';
      body.innerHTML = '<div class="ms-pnc-body-msg ms-pnc-error">Edit problem isn’t available on this page.</div>';
      overlay.hidden = false;
      return;
    }
    title.textContent = description || 'Edit problem';
    overlay.hidden = false;
    _editingProblemId = problemId;
    // onApplied fires once the code edit actually saves (2026-08-08
    // follow-up: "problem code edits refresh within the canvas") — updates
    // this scan's cached description (so the tile shows the corrected text
    // the moment this closes) and closes the modal itself, same "the
    // corrected text is the confirmation, no lingering saved chip"
    // philosophy problem-description-cleanup.js already follows for its own
    // inline panel — its own panelEl is already gone by this point (it
    // removes itself on a successful save), so leaving our wrapper open
    // would just show an empty modal.
    window.ProblemDescriptionCleanup.openInContainer(problemId, body, function (newDescription) {
      if (window.ProblemNesting) window.ProblemNesting.updateProblemDescription(problemId, newDescription);
      closeEditPanel();
    });
  }

  function closeEditPanel() {
    var el = document.getElementById(OVERLAY_ID);
    var overlay = el && el.querySelector('#ms-pnc-edit-overlay');
    if (overlay) overlay.hidden = true;
    if (_editingProblemId && window.ProblemDescriptionCleanup) {
      window.ProblemDescriptionCleanup.close(_editingProblemId);
    }
    _editingProblemId = null;
  }

  function requestClose() {
    if (hasDraftChanges(_draft)) {
      var summary = summariseDraft(_draft, {});
      _pendingAction = { kind: 'abandon', count: summary.count, linking: false, error: null };
      render();
      return;
    }
    close();
  }

  function close() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', onKeydown);
    closeEditPanel();
    _pendingAction = null;
    _draft = emptyDraft();
    _cycleError = null;
    _selectedTileId = null;
    _kbPickedId = null;
    _openedPatientId = null;
  }

  function render() {
    var el = document.getElementById(OVERLAY_ID);
    if (!el) return; // closed — a stray onChange notification is a harmless no-op
    var root = el.querySelector('.ms-pnc-root');
    if (!root) return;
    if (!window.ProblemNesting) {
      root.innerHTML = wrapPanel(
        '<div class="ms-pnc-body-msg ms-pnc-error">This tool needs to be opened from the "Organise problems?" panel.</div>'
      );
      bindCommonEvents(root);
      return;
    }
    var snap = window.ProblemNesting.getSnapshot();
    // Patient changed under the open overlay (SPA navigation — nothing in
    // the host page closes a fixed overlay): hard-close rather than render
    // patient B's data under a canvas whose transient state (_pendingAction,
    // _kbPickedId, the edit panel) was all built against patient A.
    // resetForPatient in problem-nesting.js fires onChange for exactly this
    // guard to run on.
    if (_openedPatientId !== null && snap.patientId !== _openedPatientId) {
      close();
      return;
    }
    var focusId = captureFocusedProblemId(root);
    if (snap.scanState === 'scanning' || snap.scanState === 'idle') {
      // 'idle' with the canvas open means the bridge's scan state was reset
      // under us (same patient — a change of patient closes above): kick the
      // scan off again rather than showing a loading message nothing will
      // ever resolve (ensureScanned no-ops unless genuinely idle).
      if (snap.scanState === 'idle') window.ProblemNesting.ensureScanned();
      root.innerHTML = wrapPanel(
        '<div class="ms-pnc-body-msg ms-pnc-loading">Checking SNOMED relationships between the active problems…</div>'
      );
      bindCommonEvents(root);
      return;
    }
    if (snap.scanState === 'error') {
      root.innerHTML = wrapPanel(
        '<div class="ms-pnc-body-msg ms-pnc-error">Could not scan the problem list. ' +
          '<button type="button" id="ms-pnc-retry">Retry</button></div>'
      );
      bindCommonEvents(root);
      root.querySelector('#ms-pnc-retry')?.addEventListener('click', function () {
        window.ProblemNesting.ensureScanned();
      });
      return;
    }
    // Linked-problem ids load lazily, first time a scanned tree actually
    // renders (this canvas is their sole consumer — see
    // ensureLinkedIdsLoaded in problem-nesting.js). Fire-and-forget: the
    // bridge re-renders when they arrive and the lines appear then; every
    // later call is a state-guarded no-op.
    if (window.ProblemNesting.ensureLinkedIdsLoaded) window.ProblemNesting.ensureLinkedIdsLoaded();
    var overlayInfo = overlayInfoById(snap.infoById, _draft);
    var visibleProblems = problemsNotEnded(snap.problems, _draft);
    var liveSuggestions = filterLiveSuggestions(
      snap.suggestions,
      visibleProblems,
      snap.parentIdByProblemId,
      window.ProblemNesting.wouldCreateCycle
    );
    var suggestionsByChildId = {};
    liveSuggestions.forEach(function (s) {
      suggestionsByChildId[s.childId] = s;
    });
    // See _dismissedTextLinkProblemIds' own comment — filters out a
    // suggestion just actioned this session, since nothing in the scan data
    // itself changes to make it disappear on its own (the underlying text
    // is still there until the OTHER surface's own apply path strips it).
    var liveTextLinkSuggestions = (Array.isArray(snap.textLinkSuggestions) ? snap.textLinkSuggestions : []).filter(
      function (s) {
        return s && !_dismissedTextLinkProblemIds.has(s.problemId);
      }
    );
    var textLinkByProblemId = {};
    liveTextLinkSuggestions.forEach(function (s) {
      textLinkByProblemId[s.problemId] = s;
    });
    var endedProblems = endedProblemList(snap.problems, _draft);
    var descById = {};
    (snap.problems || []).forEach(function (p) {
      if (p && p.id) descById[p.id] = p.description;
    });
    var draftSummary = summariseDraft(_draft, descById);
    var laneTrees = buildLaneTrees(
      visibleProblems,
      overlayInfo,
      snap.parentIdByProblemId,
      suggestionsByChildId,
      textLinkByProblemId
    );
    root.innerHTML = wrapPanel(bodyHtml(laneTrees, endedProblems) + confirmBarHtml() + footerHtml(draftSummary));
    bindEvents(root, snap);
    updateConnectorLines(root);
    restoreFocusedProblemId(root, focusId);
  }

  window.ProblemNestingCanvas = { open: open, close: close };
})();
