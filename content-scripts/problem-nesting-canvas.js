// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Organise problems" canvas overlay
//
// PURPOSE (user request 2026-08-08): a visual, drag-and-drop alternative to
// the "Suggested links" / "Link manually" accordion sections that used to
// live in content-scripts/problem-nesting.js — a left pane renders the
// problem list as an auto-laid-out tree (root problems sorted by onset date
// [falling back to record date when onset is blank] descending, each one's
// real children nested and sorted the same way beneath it, to whatever depth
// the record actually has); a right pane holds SNOMED-suggested-but-
// unconfirmed children as a draggable tray, each labelled with its candidate
// parent(s) and connected to them by an always-on dotted line. Dragging ANY
// tile onto ANY other tile (either pane — SNOMED candidates are a hint,
// never a constraint) proposes a link; nothing writes without an explicit
// confirm.
//
// TILE ACTIONS (revised 2026-08-08 — clicking the connector line to unlink
// wasn't intuitive enough): clicking a tree-pane tile reveals two buttons
// beside it — "Remove link" (only when the tile has a parent) and "Edit
// problem…" (always). Only one tile's actions show at a time. Tray tiles
// don't get these — they aren't part of the record's structure yet.
//
// "Edit problem" opens problem-description-cleanup.js's own review panel
// (same-concept alternatives, descendant/laterality, cross-concept,
// generic-import-text, severity-contradiction — NOT retirement/legacy-Read-
// code detection, deliberately excluded per Nick, 2026-08-08: already
// available via that file's own separate opt-in scan) for ANY problem, not
// just ones its own text-pattern scan already flagged. It renders as a
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
// THREE connector mechanisms, chosen for what each actually needs:
//   - Left-pane parent→children connectors are purely visual — simple
//     nested-DOM + CSS (a small stub between the branch's indent guide and
//     each child's tile), no coordinate math, no click handler.
//   - Right-pane suggestion arrows point from a tray tile to its candidate
//     parent(s) in the OTHER pane, at positions neither list controls (both
//     are independently sorted, and the tree's own row heights vary with
//     how much is nested under each tile) — that needs real
//     getBoundingClientRect() math, drawn as a dotted SVG bezier overlay,
//     pointer-events:none (visual only, never a click target).
//   - Linked-problem lines (2026-08-08, then revised twice more the same
//     day — straight diagonal lines weren't clear enough, then separate,
//     unrelated SETS of linked problems shared one bus and one colour,
//     indistinguishable from a single connected group) connect two TREE
//     tiles that could sit anywhere relative to each other — no hierarchy
//     constrains their position, unlike parent/child. Every link's
//     horizontal arm reaches out from its own tile's right edge to a
//     vertical bus line (computeLinkBusX + linkSetLaneX) — but each
//     connected SET (groupLinkedPairsIntoSets: two pairs sharing a problem,
//     directly or via a chain, are one set) gets its OWN lane AND its OWN
//     colour (linkSetColor), so two genuinely separate sets never look like
//     one. Solid, distinct from both the dotted suggestion arrows and the
//     plain grey parent/child stubs. Display-only — no create/remove
//     interaction yet (explicit scope decision), even though the write
//     contract is now fully confirmed (see
//     docs/learnings-problem-nesting-api.md).
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

  // Builds the left-pane tree. Roots are problems with no live parent — with
  // one refinement: a problem that's ALSO sitting in the unconfirmed
  // suggestion tray (traySuggestedIds) is skipped as a root ONLY when it has
  // no real children of its own. If it already has real children, it must
  // still render (it's their genuine home in the record) even though it's
  // simultaneously shown in the tray for its own unconfirmed suggestion —
  // hiding it would silently orphan those children from the tree.
  function buildProblemTree(problems, infoById, parentIdByProblemId, traySuggestedIds) {
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var parentMap = parentIdByProblemId || {};
    var suggested = traySuggestedIds instanceof Set ? traySuggestedIds : new Set(traySuggestedIds || []);
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
    Object.keys(byId).forEach(function (id) {
      var parentId = parentMap[id];
      if (parentId && byId[parentId]) return; // already placed as a real child, above
      if (suggested.has(id) && !byId[id].children.length) return; // tray-only, no orphaned children to house
      roots.push(byId[id]);
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
  // children) — the set the tray's actionable/blocked split is judged
  // against, and the set the SVG line-drawer treats as valid targets.
  function flattenTreeIds(tree) {
    var ids = new Set();
    function walk(nodes) {
      (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
        ids.add(n.id);
        walk(n.children);
      });
    }
    walk(tree);
    return ids;
  }

  // Live-filters the bridge's raw suggestion list down to what's still valid
  // to show in the tray right now: the child problem still exists (not
  // merged away this session), still has no real parent (not linked via
  // another route this session), and its candidate-parent list is narrowed
  // to options that still exist and wouldn't create a cycle right now.
  // Mirrors the same per-card filtering the old accordion's cardHtml() used
  // to do, just computed once for the whole tray instead of per card.
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

  // Groups a suggestion's parentOptions by provenance (2026-08-08,
  // rules/problem-nesting-overrides.json): 'snomed' — a genuine live
  // SNOMED-descendant hit — vs 'override' — a practice-defined pair SNOMED
  // itself doesn't recognise as a hierarchy (e.g. pseudophakia as a child
  // of cataract). An option with no 'source' at all (defensive — shouldn't
  // happen from the current bridge, but never assume) groups as 'snomed',
  // matching what every option meant before this field existed. Used to
  // build accurate tray copy — crediting SNOMED for a pairing it never
  // actually made would be misleading now that a second source exists.
  function groupOptionsBySource(parentOptions) {
    var snomed = [];
    var override = [];
    (Array.isArray(parentOptions) ? parentOptions : []).forEach(function (o) {
      if (!o) return;
      (o.source === 'override' ? override : snomed).push(o);
    });
    return { snomed: snomed, override: override };
  }

  // Splits the live tray into 'actionable' (at least one candidate parent
  // already renders in the left-pane tree right now — there's somewhere to
  // drop this tile) and 'blocked' (every candidate is itself still an
  // unconfirmed tray item — nothing to drop onto yet, resolves once that
  // other suggestion is confirmed). Each group sorted by onset date
  // descending.
  function partitionSuggestionTray(suggestions, treeProblemIds, infoById) {
    var ids = treeProblemIds instanceof Set ? treeProblemIds : new Set(treeProblemIds || []);
    var info = infoById || {};
    var actionable = [];
    var blocked = [];
    (Array.isArray(suggestions) ? suggestions : []).forEach(function (s) {
      var options = Array.isArray(s.parentOptions) ? s.parentOptions : [];
      var hasActionable = options.some(function (o) {
        return o && ids.has(o.id);
      });
      (hasActionable ? actionable : blocked).push(s);
    });
    function byDate(a, b) {
      var da = resolveDisplayDate(info[a.childId]);
      var db = resolveDisplayDate(info[b.childId]);
      return compareDatesDesc(da, db);
    }
    actionable.sort(byDate);
    blocked.sort(byDate);
    return { actionable: actionable, blocked: blocked };
  }

  // Pure cubic-bezier path builder for the cross-pane suggestion lines. Both
  // rects are plain {left, right, top, bottom, width, height} objects
  // (container-relative — the caller subtracts the container's own origin
  // before calling this, so it never needs a live DOM element to be tested).
  // Curves from the tray tile's LEFT edge to the target tile's RIGHT edge —
  // the tray sits physically to the right of the tree, so the line points
  // back toward it.
  function buildConnectorPath(fromRect, toRect) {
    if (!fromRect || !toRect) return null;
    var x1 = fromRect.left;
    var y1 = fromRect.top + fromRect.height / 2;
    var x2 = toRect.right;
    var y2 = toRect.top + toRect.height / 2;
    var midX = (x1 + x2) / 2;
    return 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2;
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
  // the tree pane's own right boundary (when known) so it never bleeds into
  // the tray pane sitting alongside it.
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
      groupOptionsBySource: groupOptionsBySource,
      partitionSuggestionTray: partitionSuggestionTray,
      buildConnectorPath: buildConnectorPath,
      buildLinkedProblemPairs: buildLinkedProblemPairs,
      groupLinkedPairsIntoSets: groupLinkedPairsIntoSets,
      linkSetLaneX: linkSetLaneX,
      linkSetColor: linkSetColor,
      buildElbowConnectorPath: buildElbowConnectorPath,
      computeLinkBusX: computeLinkBusX,
      relativeRect: relativeRect,
      readDropPayload: readDropPayload,
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
  var _cycleError = null;
  var _dragPayload = null;
  var _lineUpdateScheduled = false;
  // The one tile currently showing its action buttons (click to select,
  // click again — or select another — to deselect). Tree-pane tiles only.
  var _selectedTileId = null;
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
  function tileActionsHtml(node) {
    return (
      '<div class="ms-pnc-tile-actions">' +
      (node.parentId
        ? '<button type="button" class="ms-pnc-tile-action" data-action="unlink" data-target-id="' +
          esc(node.id) +
          '">Remove link</button>'
        : '') +
      '<button type="button" class="ms-pnc-tile-action" data-action="edit" data-target-id="' +
      esc(node.id) +
      '">Edit problem…</button>' +
      '</div>'
    );
  }

  // Each child's connector is purely visual (a small stub between the
  // branch's indent guide and the child's tile, reading as "this tile
  // attaches here") — un-nesting now happens via the tile's own action
  // button (see tileActionsHtml), not by clicking the line itself.
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
    return (
      '<div class="ms-pnc-node">' +
      '<div class="ms-pnc-tile-row">' +
      '<div class="ms-pnc-tile' +
      (selected ? ' ms-pnc-tile-selected' : '') +
      '" draggable="true" tabindex="0" data-problem-id="' +
      esc(node.id) +
      '"' +
      (node.linkedProblemIds.length ? ' data-linked-ids="' + esc(node.linkedProblemIds.join(',')) + '"' : '') +
      '>' +
      '<div class="ms-pnc-tile-main">' +
      '<div class="ms-pnc-tile-desc">' +
      esc(node.description) +
      '</div>' +
      (node.displayDate ? '<div class="ms-pnc-tile-date">' + esc(node.displayDate) + '</div>' : '') +
      '</div>' +
      (addInfo ? '<div class="ms-pnc-tile-info">' + esc(addInfo) + '</div>' : '') +
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

  function joinOptionNames(options) {
    return options
      .map(function (o) {
        return '<strong>' + esc(o.description) + '</strong>';
      })
      .join(' or ');
  }

  // Accurate provenance copy (2026-08-08) — a pairing from
  // rules/problem-nesting-overrides.json is credited to "this practice's
  // own reference list", never to SNOMED, which never actually made that
  // pairing. A suggestion with candidates from BOTH sources (rare — one
  // real SNOMED hit alongside a separate practice-defined one) shows both
  // sentences.
  function suggestionHintHtml(parentOptions) {
    var groups = groupOptionsBySource(parentOptions);
    var parts = [];
    if (groups.snomed.length) {
      parts.push('SNOMED marks this as a child of ' + joinOptionNames(groups.snomed));
    }
    if (groups.override.length) {
      parts.push("this practice's own reference list marks this as a child of " + joinOptionNames(groups.override));
    }
    return parts.join('; ');
  }

  function trayTileHtml(s, infoById, groupClass) {
    var info = infoById[s.childId];
    var date = resolveDisplayDate(info);
    var addInfo = truncateText(info && info.additionalInformation, 70);
    var candidateIds = s.parentOptions.map(function (o) {
      return o.id;
    });
    return (
      '<div class="ms-pnc-tray-tile ' +
      groupClass +
      '" draggable="true" tabindex="0" data-problem-id="' +
      esc(s.childId) +
      '" data-candidate-ids="' +
      esc(candidateIds.join(',')) +
      '">' +
      '<div class="ms-pnc-tile-main">' +
      '<div class="ms-pnc-tile-desc">' +
      esc(s.childDescription) +
      '</div>' +
      (date ? '<div class="ms-pnc-tile-date">' + esc(date) + '</div>' : '') +
      '</div>' +
      (addInfo ? '<div class="ms-pnc-tile-info">' + esc(addInfo) + '</div>' : '') +
      '<div class="ms-pnc-tray-hint">' +
      suggestionHintHtml(s.parentOptions) +
      '</div>' +
      '</div>'
    );
  }

  function trayHtml(groups, infoById) {
    if (!groups.actionable.length && !groups.blocked.length) {
      return '<div class="ms-pnc-empty">No SNOMED-suggested links right now.</div>';
    }
    var actionableHtml = groups.actionable
      .map(function (s) {
        return trayTileHtml(s, infoById, 'ms-pnc-tray-actionable');
      })
      .join('');
    var blockedHtml = groups.blocked
      .map(function (s) {
        return trayTileHtml(s, infoById, 'ms-pnc-tray-blocked');
      })
      .join('');
    return (
      (actionableHtml ? '<div class="ms-pnc-tray-group">' + actionableHtml + '</div>' : '') +
      (blockedHtml
        ? '<div class="ms-pnc-tray-group ms-pnc-tray-group-blocked">' +
          '<div class="ms-pnc-tray-group-label">Waiting on another suggestion first</div>' +
          blockedHtml +
          '</div>'
        : '')
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
    var message =
      d.kind === 'unlink'
        ? 'This will remove the link between <strong>' +
          esc(d.childDescription) +
          '</strong> and <strong>' +
          esc(d.parentDescription) +
          '</strong> — <strong>' +
          esc(d.childDescription) +
          '</strong> will become a top-level problem again. There is no undo; re-link it by dragging it onto ' +
          esc(d.parentDescription) +
          ' again.'
        : 'This will nest <strong>' +
          esc(d.childDescription) +
          '</strong> under <strong>' +
          esc(d.parentDescription) +
          '</strong> — it will display as a child on the problem list, not as a top-level problem. ' +
          'There is no bulk undo; links are removed individually, by clicking their connector on the tree.';
    var confirmLabel = d.kind === 'unlink' ? 'Confirm — remove link' : 'Confirm — nest it';
    var busyLabel = d.kind === 'unlink' ? 'Removing…' : 'Linking…';
    return (
      '<div class="ms-pnc-confirmbar">' +
      message +
      '<div class="ms-pnc-confirmbar-actions">' +
      '<button type="button" class="ms-pnc-cancel" id="ms-pnc-action-cancel"' +
      (d.linking ? ' disabled' : '') +
      '>Cancel</button>' +
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

  function footerHtml() {
    if (!_linkedCount) return '';
    return (
      '<div class="ms-pnc-footer"><span>' +
      _linkedCount +
      ' change' +
      (_linkedCount === 1 ? '' : 's') +
      ' made</span> <button type="button" id="ms-pnc-refresh">Refresh page</button></div>'
    );
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

  function bodyHtml(tree, groups, infoById) {
    return (
      '<div class="ms-pnc-explainer">Drag and drop problems to create parent-child relationships. ' +
      'Suggested options are on the right. Click on a problem tile to remove a link, or to search ' +
      'for better codes based on free-text.</div>' +
      '<div class="ms-pnc-body">' +
      '<svg class="ms-pnc-lines" aria-hidden="true"></svg>' +
      '<div class="ms-pnc-pane ms-pnc-pane-tree" id="ms-pnc-tree-pane">' +
      treeHtml(tree) +
      '</div>' +
      '<div class="ms-pnc-pane ms-pnc-pane-tray" id="ms-pnc-tray-pane">' +
      '<div class="ms-pnc-pane-heading">Suggested links</div>' +
      trayHtml(groups, infoById) +
      '</div>' +
      '</div>'
    );
  }

  // ── Connector-line drawing ────────────────────────────────────────────────

  function updateConnectorLines(root) {
    var svg = root.querySelector('.ms-pnc-lines');
    var body = root.querySelector('.ms-pnc-body');
    if (!svg || !body) return;
    var containerRect = body.getBoundingClientRect();
    svg.setAttribute('width', String(containerRect.width));
    svg.setAttribute('height', String(containerRect.height));
    var markup = [];
    root.querySelectorAll('.ms-pnc-tray-tile[data-candidate-ids]').forEach(function (trayTile) {
      var idsAttr = trayTile.getAttribute('data-candidate-ids') || '';
      var ids = idsAttr.split(',').filter(Boolean);
      var fromRect = relativeRect(trayTile.getBoundingClientRect(), containerRect);
      ids.forEach(function (id) {
        var target = root.querySelector('.ms-pnc-pane-tree .ms-pnc-tile[data-problem-id="' + cssEscapeId(id) + '"]');
        if (!target) return; // candidate not currently rendered in the tree — no line to draw
        var toRect = relativeRect(target.getBoundingClientRect(), containerRect);
        var d = buildConnectorPath(fromRect, toRect);
        if (d) markup.push('<path d="' + d + '" class="ms-pnc-line"></path>');
      });
    });
    // Linked problems (2026-08-08, revised same day to elbow/bus routing —
    // see buildElbowConnectorPath's own comment for why) — display-only,
    // tree-tile to tree-tile, symmetric. Reads data-linked-ids straight off
    // the DOM (same technique as the suggestion lines' data-candidate-ids
    // above), not passed-in state, so this stays correct across
    // scheduleLineUpdate's scroll/resize recomputes without needing to
    // thread render()'s own data through.
    var treeTileRects = [];
    root.querySelectorAll('.ms-pnc-pane-tree .ms-pnc-tile[data-problem-id]').forEach(function (tile) {
      treeTileRects.push(relativeRect(tile.getBoundingClientRect(), containerRect));
    });
    var treePaneEl = root.querySelector('.ms-pnc-pane-tree');
    var treePaneRightEdge = treePaneEl
      ? relativeRect(treePaneEl.getBoundingClientRect(), containerRect).right
      : undefined;
    var busX = computeLinkBusX(treeTileRects, 16, treePaneRightEdge);

    if (busX !== null) {
      var linkEntries = [];
      root.querySelectorAll('.ms-pnc-pane-tree .ms-pnc-tile[data-linked-ids]').forEach(function (tile) {
        linkEntries.push({
          id: tile.getAttribute('data-problem-id'),
          linkedIds: (tile.getAttribute('data-linked-ids') || '').split(',').filter(Boolean),
        });
      });
      // Each connected SET (2026-08-08 follow-up: separate sets were
      // sharing one bus AND one colour, indistinguishable from a single
      // genuinely-connected group) gets its own lane and colour — see
      // groupLinkedPairsIntoSets/linkSetLaneX/linkSetColor's own comments.
      groupLinkedPairsIntoSets(buildLinkedProblemPairs(linkEntries)).forEach(function (setPairs, setIndex) {
        var laneX = linkSetLaneX(busX, setIndex, 14);
        var color = linkSetColor(setIndex);
        setPairs.forEach(function (pair) {
          var tileA = root.querySelector(
            '.ms-pnc-pane-tree .ms-pnc-tile[data-problem-id="' + cssEscapeId(pair.a) + '"]'
          );
          var tileB = root.querySelector(
            '.ms-pnc-pane-tree .ms-pnc-tile[data-problem-id="' + cssEscapeId(pair.b) + '"]'
          );
          if (!tileA || !tileB) return; // one side not currently rendered — no line to draw
          var rectA = relativeRect(tileA.getBoundingClientRect(), containerRect);
          var rectB = relativeRect(tileB.getBoundingClientRect(), containerRect);
          var d = buildElbowConnectorPath(rectA, rectB, laneX);
          if (d) markup.push('<path d="' + d + '" class="ms-pnc-link-line" style="stroke: ' + color + '"></path>');
        });
      });
    }
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

  async function confirmPendingAction() {
    var d = _pendingAction;
    if (!d || d.linking || !window.ProblemNesting) return;
    d.linking = true;
    d.error = null;
    render();
    try {
      if (d.kind === 'unlink') {
        await window.ProblemNesting.commitUnlink(d.childId);
        announce(d.childDescription + ' is no longer nested under ' + d.parentDescription);
      } else {
        await window.ProblemNesting.commitParentLink(d.childId, d.parentId);
        announce('Nested ' + d.childDescription + ' under ' + d.parentDescription);
      }
      _linkedCount++;
      _pendingAction = null;
      // refresh() re-renders problem-nesting.js's own accordion DOM (if
      // mounted) and fires onChange, which re-renders this canvas too — see
      // the bridge in problem-nesting.js.
      window.ProblemNesting.refresh();
    } catch (err) {
      d.error =
        (err && err.message) ||
        (d.kind === 'unlink' ? 'Failed to remove the link — please try again.' : 'Failed to link — please try again.');
    } finally {
      d.linking = false;
      render();
    }
  }

  function bindCommonEvents(root) {
    root.querySelector('#ms-pnc-close')?.addEventListener('click', close);
    root.querySelector('.ms-pnc-backdrop')?.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) close();
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

    var descById = {};
    (snap.problems || []).forEach(function (p) {
      descById[p.id] = p.description;
    });

    // Tree-pane tiles only (tray tiles aren't part of the record's
    // structure yet, per the 2026-08-08 scope decision) — click toggles
    // this tile's action buttons; clicking the SAME tile again, or any
    // other tile, deselects/reselects. A drag never reaches this handler:
    // dragstart fires instead of click for an actual drag gesture, standard
    // HTML5 DnD behaviour.
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
    // have shown.
    root.querySelectorAll('.ms-pnc-pane-tree .ms-pnc-tile[data-problem-id]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var id = tile.getAttribute('data-problem-id');
        var parentId = snap.parentIdByProblemId[id];
        var hasRealParent = !!(parentId && Object.prototype.hasOwnProperty.call(descById, parentId));
        if (!hasRealParent) {
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
        var childId = payload.problemId;
        var parentId = tile.getAttribute('data-problem-id');
        if (!childId || !parentId || childId === parentId || !window.ProblemNesting) return;
        if (window.ProblemNesting.wouldCreateCycle(childId, parentId, snap.parentIdByProblemId)) {
          _cycleError = 'Linking these two would create a loop — pick a different pair.';
          render();
          return;
        }
        _pendingAction = {
          kind: 'link',
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

    ['#ms-pnc-tree-pane', '#ms-pnc-tray-pane'].forEach(function (sel) {
      root.querySelector(sel)?.addEventListener('scroll', scheduleLineUpdate);
    });
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    // Escape closes whichever is on top first — the edit panel if it's
    // open, otherwise the whole canvas — never both at once.
    var el = document.getElementById(OVERLAY_ID);
    var overlay = el && el.querySelector('#ms-pnc-edit-overlay');
    if (overlay && !overlay.hidden) {
      closeEditPanel();
      return;
    }
    close();
  }

  function open() {
    if (document.getElementById(OVERLAY_ID)) return;
    if (!window.ProblemNesting) return; // bridge not present — nothing to open onto
    window.ProblemNesting.ensureScanned();
    _pendingAction = null;
    _cycleError = null;
    _linkedCount = 0;
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

  function close() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', onKeydown);
    closeEditPanel();
    _pendingAction = null;
    _cycleError = null;
    _selectedTileId = null;
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
    var focusId = captureFocusedProblemId(root);
    if (snap.scanState === 'scanning' || snap.scanState === 'idle') {
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
    var liveSuggestions = filterLiveSuggestions(
      snap.suggestions,
      snap.problems,
      snap.parentIdByProblemId,
      window.ProblemNesting.wouldCreateCycle
    );
    var traySuggestedIds = new Set(
      liveSuggestions.map(function (s) {
        return s.childId;
      })
    );
    var tree = buildProblemTree(snap.problems, snap.infoById, snap.parentIdByProblemId, traySuggestedIds);
    var treeIds = flattenTreeIds(tree);
    var groups = partitionSuggestionTray(liveSuggestions, treeIds, snap.infoById);
    root.innerHTML = wrapPanel(bodyHtml(tree, groups, snap.infoById) + confirmBarHtml() + footerHtml());
    bindEvents(root, snap);
    updateConnectorLines(root);
    restoreFocusedProblemId(root, focusId);
  }

  window.ProblemNestingCanvas = { open: open, close: close };
})();
