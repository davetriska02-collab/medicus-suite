// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Repeat-prescribing authorisation pills — Medication tab (content script)
//
// On the patient's Medication tab (careRecordTab=medication) AND on a
// prescription-request task overview (routine or non-routine — both are the
// same /tasks/data/prescription-requests/overview/{taskUuid} shape, just a
// different taskList query param), decorates each item in the "repeat
// prescribing" list with a small pill showing:
//   - "Fixed" (a positively-confirmed fixed-number-of-issues authorisation)
//     or "Unclear" (everything else — see shared/repeat-authorisation.js for
//     why a third "review date" state is deliberately NOT asserted; NOT
//     "Unclear – check" — across a whole batch of repeats this isn't an
//     instruction to the clinician for each item, just a classification)
//   - the derived days-supply (e.g. "28 days"). Quantity is deliberately
//     NOT shown — it's already visible on every screen this pill appears on.
//   - on a task overview only (multiple drugs from the SAME reauthorisation
//     batch, genuinely comparable): a same-task days-supply OUTLIER check
//     once every item's own figure is known (RepeatAuthorisation.
//     daysSupplyOutliers) — needs a genuine, unambiguous majority before
//     flagging anything. A flagged item's days figure gets a red,
//     underlined "(-2 vs majority at 30 days)" clause, and pill colour
//     switches from the plain per-interval scheme to majority-green /
//     distinct-colour-per-distinct-outlier-value (colourForRole) —
//     Nick's own request, 2026-09-08/09.
//
// Read-only display only — never writes anything, never drives a Medicus
// control. TWO data sources, one per screen (confirmed live 2026-08-26 that
// they need different sources, not just different DOM anchors):
//   - Medication tab: GET .../medication/medication-regimen/{patientId} —
//     already fetched elsewhere in the suite for Sentinel's own
//     drug-monitoring purposes (engine/api-client.js's fetchMedicationRegimen).
//   - Task overview: GET .../tasks/data/{taskTypeSlug}/overview/{taskUuid} —
//     its own prescriptionRequestItemsByType.repeatWithAnAuthorisedIssue.items[]
//     names EXACTLY the drugs on that specific request (not the patient's
//     whole current repeat list — confirmed live that fetching
//     medication-regimen on a task page returned items that were never part
//     of that request at all, e.g. Mirtazapine on a Venlafaxine-only task),
//     with quantity/days-supply pre-labelled, no derivation needed. Identity
//     (apiBase/patientUuid) is still resolved the normal way via
//     resolveTaskToPatient() for caching purposes; this second fetch gets the
//     item list. variable-repeat items (always issueNumberAsXOfY: null) live
//     in a sibling variableRepeat.items[] and are deliberately not read here.
//     NOTE (2026-09-03): the wrapper key was `prescriptionRequestsByType`
//     when this was first built (2026-08-26); confirmed live it is now
//     `prescriptionRequestItemsByType` (Medicus's own rename, sub-shape
//     otherwise unchanged) — caught via a debug capture showing the old key
//     simply absent from a real response.
//
// THIRD screen, added 2026-09-10 (HAR 120-reauthorise.har +
// 121-reauthorise2.har): the individual re-authorise/modify popup
// (/clinical/prescription/re-authorise/{prescriptionId}), reached via a
// prescribeAgainUri link from the overview screens above. GET
// .../clinical/data/prescription/re-authorise/{prescriptionId} carries its
// own `prescription.authorisationMethod` field — a DIRECT, literal enum
// ('review-date' | 'fixed-number-of-issues'), NOT inferred like every other
// screen here — so this is the one place the pill can positively assert
// "Until review date" rather than falling back to "Unclear" (see
// shared/repeat-authorisation.js's classifyFromAuthorisationMethod). Single
// item per page (the one prescription being (re)authorised), inserted right
// after the "Expected days supply" label text — a different anchor shape
// again from the two list-based screens above, so it gets its own small
// loader/injector rather than being folded into the shared _items/inject()
// pipeline built for matching N drugs against N DOM anchors.
//
// CONFIRMED LIVE 2026-09-10 (Nick's own screenshot): the re-authorise form
// pill renders correctly after "Expected days supply". Getting there
// needed a second fix beyond the anchor itself — the popup turned out to
// be a MODAL, not a route (location.href never changed while it was open,
// confirmed via Nick's own console capture), so there is no URL to detect
// the popup OR read a prescriptionId from at all. See page-world.js's
// noteReauthorisePrescription (MAIN-world network stamp) and this file's
// refreshReauthorisationForm (DOM-first detection, independent of
// isActivePage()/location.href entirely) for how that's solved.
//
// QUANTITY÷DOSE CROSS-CHECK — removed 2026-09-10, then RESTORED the same
// day once a real counter-example proved the removal over-generalised.
// First attempt reused describeForPill/describeForPillFromTaskItem's
// existing quantity-vs-reported-days mismatch check here, which correctly
// flagged a real inconsistency (Apixaban) at the moment the popup opened —
// but for STRUCTURED dosage (a picklist dose/frequency), Medicus's own
// client-side JS silently self-corrects the issued quantity to match
// whatever "Expected days supply" is set, so that check only ever ended
// up comparing against a number Medicus had just computed — reproducing
// info already on screen. (An interim fix even tracked Medicus's own live
// recalculation via a second MAIN-world network stamp, before the
// redundancy itself was recognised as the real problem and the whole
// mechanism was removed.) But that reasoning does NOT hold for FREE-TEXT
// dosage — confirmed live 2026-09-11 with a real counter-example: an
// Estradiol 0.06% gel item dosed "3 pumps daily" (free text) reported
// "Expected days supply: 84", genuinely wrong — the extension's own
// computedGramDaysSupply independently derives the correct 64 (240g /
// 1.25g per pump / 3 pumps/day). Medicus has NO structured dose/frequency
// to recalculate FROM for free text, so nothing on the form ever corrects
// an inconsistency there; the cross-check is the ONLY thing that can
// catch it. See shared/repeat-authorisation.js's describeForReauthorisationForm
// for the fuller reasoning and the accepted trade-off (a brief,
// unaddressed transient false-mismatch window for structured-dosage items
// right after the popup opens, before Medicus's own correction fires).
//
// SIBLING-COMPARISON OUTLIER CHECK — the ONE flag this screen's pill
// shows (Nick's own framing, 2026-09-10, from a real live problem he
// hit): re-authorising Apixaban at 30 days auto-bumped its own issue
// quantity from 56 to 60 tablets (Medicus's own "helpful" behaviour) —
// silently drifting it off the 28-day cycle every OTHER repeat on that
// patient was still on, with nothing on screen to catch it. "Tell me if
// I'm about to reauthorise one medication on a 28 day cycle when
// everything else is on 56" — loadReauthorisationFormItem also fetches
// the patient's medication-regimen (patientId comes straight off the SAME
// re-authorise response, no extra identity resolution needed) and runs
// the identical outlier engine the task-overview screen uses
// (daysSupplyOutliers/daysSupplyColourRoles/formatDaysOutlierDelta)
// against it, flagging + colouring the pill the same way. See
// loadReauthorisationFormItem's own comment for an unverified live
// assumption (product-name-based sibling exclusion) worth checking first
// if the flag ever looks wrong.
//
// PILL PLACEMENT IS BEST-EFFORT, like risk-flag-cleanup.js's badge-row
// heuristic before it. Three different anchor strategies:
//   - Medication tab: exact text match against `description` (the "match by
//     visible text" discipline as the queue macros — CLAUDE.md) — each drug
//     name IS its own isolated label there.
//   - Task overview: the page is two columns — the task's own left-hand card
//     and a read-only Clinical Summary on the right that ALSO shows the same
//     drug names (confirmed live: findLabelFor's exact match landed there
//     instead). Anchored to the LEFT column specifically (layout-based, not
//     text/class-based — that's the actual distinguishing trait), trying the
//     product description first and "Issue <N of M>" as a fallback substring.
//   - Re-authorise form: whole-page substring match for the literal label
//     text "Expected days supply" — confirmed live, see above.
// All three still expected to need further live tuning — see the project
// memory / conversation history for what's been tried already if a pill
// doesn't land right on a new screen shape.

(function () {
  'use strict';

  if (window.__rppMounted) return;
  window.__rppMounted = true;

  var PILL_CLASS = 'rpp-pill';
  // Same URL-detection pattern as engine/extractors/patient-context.js's own
  // 'care-record-medication' extractor id, so this activates on exactly the
  // same tab that extractor already recognises.
  var MEDICATION_TAB_RE = /\/care-record\/.*careRecordTab=medication/;
  // Same loose task-type match as routine-rx-button.js's own activation
  // check — covers both routine and non-routine prescription-request task
  // overviews (they differ only in the taskList query param).
  var PRESCRIPTION_REQUEST_RE = /\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i;
  // The re-authorise/modify popup is NOT a route at all — confirmed live
  // 2026-09-10 (Nick's own console capture): location.href stayed on the
  // underlying care-record URL the whole time the popup was open. So
  // there's no URL pattern to gate on here — see refreshReauthorisationForm
  // below, which detects it purely from DOM content (the "Expected days
  // supply" label) + a MAIN-world network stamp (page-world.js's
  // noteReauthorisePrescription) for the id, and runs on every refresh
  // tick regardless of isActivePage().

  function isActivePage() {
    var href = location.href;
    return MEDICATION_TAB_RE.test(href) || PRESCRIPTION_REQUEST_RE.test(href);
  }

  function SAC() {
    return window.SentinelApiClient;
  }
  function RA() {
    return window.RepeatAuthorisation;
  }

  // Same debug-flag convention as triage-lens/content.js: localStorage.setItem
  // ('ch-debug','1') + reload turns this on. console output is visible in the
  // normal page DevTools regardless of isolated- vs main-world execution —
  // unlike window.* state, which the two worlds cannot see across.
  function DEBUG() {
    try {
      return localStorage.getItem('ch-debug') === '1';
    } catch (_) {
      return false;
    }
  }
  function log() {
    if (!DEBUG()) return;
    try {
      console.log.apply(console, ['[RPP]'].concat(Array.prototype.slice.call(arguments)));
    } catch (_) {
      /* logging must never break the pill */
    }
  }

  // Async — the task-overview screens carry only a taskUuid in the URL, not
  // a patient UUID, so resolving identity there needs a real fetch
  // (resolveTaskToPatient), unlike the direct-URL / DOM-fallback cases.
  async function resolveIdentity() {
    try {
      var ctx = SAC() && SAC().detectMedicusContext(location.href);
      if (!ctx || !ctx.apiBase) return null;
      if (ctx.patientUuid) return { apiBase: ctx.apiBase, patientUuid: ctx.patientUuid };
      if (ctx.taskTypeSlug && ctx.taskUuid && typeof SAC().resolveTaskToPatient === 'function') {
        var fromTask = await SAC().resolveTaskToPatient(ctx.apiBase, ctx.taskTypeSlug, ctx.taskUuid);
        if (fromTask) return { apiBase: ctx.apiBase, patientUuid: fromTask };
      }
      var uuid = SAC().findPatientUuidFromDom(document);
      if (uuid) return { apiBase: ctx.apiBase, patientUuid: uuid };
    } catch (_) {
      /* identity stays null — pills simply won't show, never stale */
    }
    return null;
  }

  var _renderQueued = false;
  var _cacheKey = null; // patientUuid this _items snapshot belongs to
  var _items = null; // [{ description, verdict, text, days, colour, deltaText? }] or null (not loaded / not applicable)
  var _reauthCacheKey = null; // prescriptionId the re-authorise form's _reauthItem snapshot belongs to
  var _reauthItem = null; // { prescription, siblingDays } or null — raw data, see loadReauthorisationFormItem/computeReauthorisationPill below

  // Loads rules/hrt-gram-dose-factors.json ONCE per page load — same
  // pattern as problem-nesting.js's ensureNestingOverridesLoaded (a local
  // extension resource, not a Medicus call). Never throws; falls back to
  // an empty list (the gel/cream days-supply path then simply never
  // matches, same as before this file existed) if unavailable. The
  // pure shared/repeat-authorisation.js module never fetches this itself
  // — see that file's own "Gram-based gel/cream cross-check" comment.
  var _gelDoseFactorsPromise = null;
  function ensureGelDoseFactorsLoaded() {
    if (_gelDoseFactorsPromise) return _gelDoseFactorsPromise;
    _gelDoseFactorsPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/hrt-gram-dose-factors.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.products) ? doc.products : [];
      } catch (e) {
        log('ensureGelDoseFactorsLoaded: failed ->', e && e.message);
        return [];
      }
    })();
    return _gelDoseFactorsPromise;
  }

  function removeAllPills() {
    var els = document.querySelectorAll('.' + PILL_CLASS);
    for (var i = 0; i < els.length; i++) els[i].remove();
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Fallback colouring: keyed to the days-supply INTERVAL itself (Nick's
  // 2026-09-08 request — "drugs with the same interval have the same
  // colour"), deliberately deterministic (a plain hash, not per-task
  // state) so the same interval reads as the same colour everywhere. Used
  // on the Medication tab (no sibling items to compare against, so no
  // majority concept applies at all) and on a task where no majority could
  // be established (see daysSupplyColourRoles' own header comment) — the
  // 2026-09-09 majority/outlier scheme below takes over whenever a real
  // majority exists. "Days unknown" (null) always gets the same neutral
  // grey, never lumped in with a real interval. None of these — nor the
  // majority/outlier colours below — are red, since red is reserved for
  // the outlier-delta text (a collision there would blur two different
  // signals together).
  var PILL_COLOURS = ['#2f6b6b', '#6b4c2f', '#4c2f6b', '#2f4c6b', '#6b5b2f', '#2f6b47', '#5a3d6b', '#4a5568'];
  var PILL_COLOUR_UNKNOWN = '#5a5a5a';
  function colourForDays(days) {
    if (days == null) return PILL_COLOUR_UNKNOWN;
    return PILL_COLOURS[Math.abs(days) % PILL_COLOURS.length];
  }

  // Majority/outlier colouring — task-overview page only, once a genuine
  // majority is established (RepeatAuthorisation.daysSupplyOutliers /
  // daysSupplyColourRoles). The majority interval is always green;
  // different outlier VALUES get different colours from a separate
  // palette (never green, never red, never the fallback palette above, so
  // an outlier pill is never mistaken for either a majority pill or a
  // plain no-majority-established one). `assignments` is a plain object
  // the caller creates fresh once per inject() pass — first-seen order
  // within that one task, not a global/persistent map — so unrelated
  // tasks/patients never accumulate stale colour assignments.
  var PILL_COLOUR_MAJORITY = '#2f7d32';
  var OUTLIER_PALETTE = ['#6b4c2f', '#4c2f6b', '#2f4c6b', '#6b5b2f', '#5a3d6b', '#4a5568'];
  function colourForRole(role, days, assignments) {
    if (role === 'unknown') return PILL_COLOUR_UNKNOWN;
    if (role === 'majority') return PILL_COLOUR_MAJORITY;
    if (role && role.indexOf('outlier:') === 0) {
      if (!Object.prototype.hasOwnProperty.call(assignments, role)) {
        assignments[role] = OUTLIER_PALETTE[Object.keys(assignments).length % OUTLIER_PALETTE.length];
      }
      return assignments[role];
    }
    return colourForDays(days); // role === null -> no majority established, fall back
  }

  // `deltaText` (e.g. "-2 vs majority at 30 days", from
  // RepeatAuthorisation.formatDaysOutlierDelta) is optional — only items
  // daysSupplyOutliers() actually flagged carry one. Rendered in its own
  // styled span (red AND underlined — never colour alone, matching this
  // suite's usual hue-is-not-the-only-signal discipline) so it's never
  // mistaken for part of the plain pill text, and never affects the pill's
  // own background colour.
  function buildPill(text, colour, deltaText) {
    var span = document.createElement('span');
    span.className = PILL_CLASS;
    var idempotencyKey = text + (deltaText ? '|' + deltaText : '');
    span.dataset.rppText = idempotencyKey;
    var html = escHtml(text);
    if (deltaText) {
      html += ' <span style="color:#ff6b6b;text-decoration:underline;">(' + escHtml(deltaText) + ')</span>';
    }
    span.innerHTML = html;
    span.style.cssText = [
      'display:inline-block',
      'margin-left:8px',
      'padding:1px 8px',
      'border-radius:10px',
      'font:600 11px/1.6 -apple-system,Segoe UI,sans-serif',
      'white-space:nowrap',
      'vertical-align:middle',
      'background:' + colour,
      'color:#fff',
    ].join(';');
    return span;
  }

  // Matches an element's OWN direct text — never the full recursive
  // .textContent, which would also match a large ancestor wrapping several
  // drug cards (misplacing the pill on that whole container). Deliberately
  // NOT restricted to leaf elements (no element children at all): a real
  // card can have the drug name as a bare text node directly inside a div
  // that ALSO has sibling <br>/<span> detail lines and a button row as
  // element children — confirmed live 2026-09-08 ("Prescriptions for
  // Reauthorisation": <div class="prescription-request">EpiPen Jr.
  // ...<br><span class="secondary-text">...</span>...). A leaf-only rule
  // never even looks at that div's own text, since the div itself isn't a
  // leaf — silently losing the pill with no error either side. Returns the
  // TEXT NODE itself (not the containing element), so the pill can be
  // inserted immediately after just that text — see inject()'s insertion
  // step, which works identically for a Text node or an Element anchor.
  function ownTextNodes(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) out.push(el.childNodes[i]);
    }
    return out;
  }

  // Exact-match version — used on the Medication tab, where each drug name
  // IS its own isolated label (no sibling detail lines sharing its
  // container the way a task-overview card can). `used` is a Set of nodes
  // already claimed by an earlier item THIS inject() pass — skipped so two
  // items that would otherwise resolve to the same text node (e.g.
  // duplicate strength/form text) each get their own.
  function findLabelFor(description, used) {
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.classList && el.classList.contains(PILL_CLASS)) continue;
      var textNodes = ownTextNodes(el);
      for (var j = 0; j < textNodes.length; j++) {
        var node = textNodes[j];
        if (used && used.has(node)) continue;
        if ((node.textContent || '').trim() === description) return node;
      }
    }
    return null;
  }

  // A task-overview page is TWO COLUMNS: the task's own request card on the
  // left ("Next Repeat Prescribing Issue", where the drug name is embedded
  // in a line like "Issue 2 of 4: <description>", not standing alone), and a
  // read-only Clinical Summary of the whole patient on the right — which
  // ALSO shows the same drug name as an isolated label (findLabelFor's exact
  // match would land there instead, confirmed live 2026-08-26). This anchor
  // is deliberately layout-based (left-half of the viewport), not text- or
  // class-based, since that IS the actual distinguishing trait here.
  function isInLeftColumn(el) {
    try {
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return false;
      return (r.left + r.right) / 2 < window.innerWidth * 0.55;
    } catch (_) {
      return false;
    }
  }

  // Finds a left-column element's OWN direct text (see ownTextNodes' header
  // comment — not restricted to leaf elements) containing ANY of the given
  // substrings (tried in order — first substring to match anywhere wins).
  // Used to try the exact product description first, then fall back to the
  // "Issue <N of M>" fragment we know from the task JSON, in case the drug
  // name itself is rendered split across elements or reformatted on screen.
  // `used` (see findLabelFor) is REQUIRED here, not just a nicety: the
  // "Issue <N of M>" fallback is only unique per drug when every item on
  // the task has a distinct issue count — confirmed live (2026-09-03) that
  // two different eye-drop items on the same task both read "Issue 6 of
  // 6", so without skipping already-claimed nodes this fallback returns
  // the SAME literal element for both, silently losing the second pill.
  function findLeftColumnTextMatch(substrings, used) {
    var all = document.querySelectorAll('body *');
    for (var s = 0; s < substrings.length; s++) {
      var needle = substrings[s];
      if (!needle) continue;
      var sawTextMatchOutsideLeftColumn = false;
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.classList && el.classList.contains(PILL_CLASS)) continue;
        var textNodes = ownTextNodes(el);
        for (var j = 0; j < textNodes.length; j++) {
          var node = textNodes[j];
          if (used && used.has(node)) continue;
          var txt = (node.textContent || '').trim();
          if (!txt || txt.indexOf(needle) === -1) continue;
          if (!isInLeftColumn(el)) {
            sawTextMatchOutsideLeftColumn = true;
            continue; // skip the right-hand summary's match
          }
          return node;
        }
      }
      if (!sawTextMatchOutsideLeftColumn) {
        log('findLeftColumnTextMatch: no element on the page has its own text containing', JSON.stringify(needle));
      }
    }
    return null;
  }

  // Whole-page substring match, no left-column restriction (unlike
  // findLeftColumnTextMatch above) and no `used`-set de-duplication (this
  // is only ever used for the re-authorise form, which has exactly one
  // pill to place, so collision with a sibling item's own search can't
  // happen the way it can on a multi-drug task overview).
  function findTextMatch(needle) {
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.classList && el.classList.contains(PILL_CLASS)) continue;
      var textNodes = ownTextNodes(el);
      for (var j = 0; j < textNodes.length; j++) {
        var node = textNodes[j];
        var txt = (node.textContent || '').trim();
        if (txt && txt.indexOf(needle) !== -1) return node;
      }
    }
    return null;
  }

  // Works for either an Element or a Text node (the matchers above now
  // return text nodes — see ownTextNodes) — a Text node has no
  // getBoundingClientRect of its own, so a Range around just that node
  // stands in for it.
  function elTop(node) {
    try {
      if (node.nodeType === 3) {
        var range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().top;
      }
      return node.getBoundingClientRect().top;
    } catch (_) {
      return null;
    }
  }

  // Finds ONLY the heading/description line for one item — no "issued"-line
  // search here. Split out from the old findTaskCardAnchor so inject() can
  // resolve every item's heading FIRST, in one pass, before any item goes
  // looking for its own nearby "issued" sub-line — see inject()'s own
  // comment for why that ordering matters.
  function findTaskHeadingLine(description, xOfY, used) {
    var candidates = [description];
    if (xOfY) candidates.push('Issue ' + xOfY); // e.g. "Issue 5 of 5" heading fragment
    return findLeftColumnTextMatch(candidates, used);
  }

  // Finds the quantity/issue-count/date line near a given heading (e.g. "60
  // tablet - 1 of 4 issued 05 May 2026 - Supply ended 30 Jun 2026") — the
  // pill belongs there, not on the heading line the drug name was found on.
  // `ceilingTop`, when set, is the vertical position of the NEXT item's own
  // heading on the page — the search only accepts a candidate strictly
  // above it, so it can never cross into a sibling drug's card.
  //
  // This boundary exists because an item can genuinely have NO "issued"
  // line of its own to find at all — confirmed live 2026-09-08: a
  // first-ever issue with nothing issued yet ("Issue 1 of 1", 200 dose, no
  // "N of M issued" text anywhere on its own row). Before this boundary
  // existed, that item's climb kept expanding until it found the NEXT
  // drug's "issued" line instead and silently stole it — that sibling then
  // displayed the WRONG item's pill, with no error logged either side.
  // Falls back to the heading line itself if nothing qualifies.
  function findIssuedLineNear(headingLine, used, ceilingTop) {
    var container = headingLine;
    for (var hop = 0; hop < 4 && container.parentElement; hop++) {
      container = container.parentElement;
      var innerCandidates = container.querySelectorAll('*');
      for (var j = 0; j < innerCandidates.length; j++) {
        var c = innerCandidates[j];
        if (c.children.length > 0) continue;
        if (c.classList && c.classList.contains(PILL_CLASS)) continue;
        if (used && used.has(c)) continue;
        if (!/issued/i.test(c.textContent || '')) continue;
        if (ceilingTop != null) {
          var top = elTop(c);
          if (top == null || top >= ceilingTop) continue; // belongs to the next card, not this one
        }
        return c;
      }
    }
    return headingLine;
  }

  function inject() {
    if (!_items || !_items.length) {
      log('inject: nothing to place (_items is', _items, ')');
      return;
    }
    var onTaskPage = PRESCRIPTION_REQUEST_RE.test(location.href);
    // Claimed anchor nodes, across this whole pass — every search below
    // skips nodes already in here, so two items that would otherwise
    // resolve to the identical DOM node (confirmed live: two eye-drop
    // items sharing "Issue 6 of 6") each land on their own occurrence
    // instead of colliding on the first.
    var used = new Set();
    // Pass 1 (task-overview page only): resolve every item's own heading
    // line FIRST, before any item's "issued"-line search runs. Needed so
    // pass 2 can bound each search to strictly above the NEXT item's own
    // heading position — see findIssuedLineNear()'s header comment.
    var resolved = _items.map(function (it) {
      if (!it.description) return null;
      if (!onTaskPage) return { item: it, heading: findLabelFor(it.description, used) };
      var heading = findTaskHeadingLine(it.description, it.xOfY, used);
      return { item: it, heading: heading };
    });
    resolved.forEach(function (r) {
      if (r && r.heading && used) used.add(r.heading);
    });
    if (onTaskPage) {
      resolved.forEach(function (r) {
        if (r && r.heading) r.top = elTop(r.heading);
      });
    }
    // Pass 2: place each item's pill.
    resolved.forEach(function (r) {
      if (!r) return;
      var it = r.item;
      var label = r.heading;
      if (label && onTaskPage) {
        var ceilingTop = null;
        for (var k = 0; k < resolved.length; k++) {
          var other = resolved[k];
          if (!other || other === r || other.top == null || r.top == null) continue;
          if (other.top > r.top && (ceilingTop == null || other.top < ceilingTop)) ceilingTop = other.top;
        }
        label = findIssuedLineNear(r.heading, used, ceilingTop);
      }
      if (!label || !label.parentNode) {
        log('inject: no DOM anchor found for', JSON.stringify(it.description), '- text match failed');
        return;
      }
      if (used) used.add(label);
      log(
        'inject: anchor found for',
        JSON.stringify(it.description),
        '->',
        label.nodeType === 3 ? '#text' : label.tagName,
        JSON.stringify((label.textContent || '').slice(0, 60))
      );
      // Scoped to THIS label's own next sibling only — never a
      // parent-wide querySelector. A parent-wide "does a pill already
      // exist here" lookup could find a DIFFERENT item's already-placed
      // pill if their anchors happen to share a parent element, and wrongly
      // treat it as this item's own — a real risk given the `used`-set
      // anchor-uniqueness fix above exists precisely because two items can
      // otherwise resolve to the same or sibling nodes. Pill placement is
      // always immediately-after its own label, so nextElementSibling is
      // the only correct place to look for an existing pill. `label` can
      // now be a Text node (see ownTextNodes' header comment) as well as
      // an Element — nextElementSibling and insertBefore both work
      // identically for either (the NonDocumentTypeChildNode mixin covers
      // CharacterData, not just Element); insertAdjacentElement does NOT
      // (Element-only), which is why insertion below uses insertBefore
      // instead — it produces the exact same result for an Element anchor
      // and additionally works for a Text node one.
      var sib = label.nextElementSibling;
      // Matches the idempotency key buildPill() itself writes to
      // dataset.rppText (text + deltaText combined) — comparing against
      // plain it.text alone would miss a change in the outlier delta on
      // an otherwise-unchanged item (e.g. the majority shifting because a
      // sibling item's data changed), leaving a stale delta on screen.
      var idempotencyKey = it.text + (it.deltaText ? '|' + it.deltaText : '');
      if (sib && sib.classList && sib.classList.contains(PILL_CLASS)) {
        if (sib.dataset.rppText === idempotencyKey) return; // idempotent
        sib.remove();
      }
      var pill = buildPill(it.text, it.colour, it.deltaText);
      label.parentNode.insertBefore(pill, label.nextSibling);
    });
  }

  // On a task-overview page, the SAME response resolveTaskToPatient() already
  // fetches for identity carries its "repeat" items under
  // data.prescriptionRequestItemsByType, which has (confirmed live, HAR
  // 113-non-routine-repeat-open.har, 2026-09-05) FOUR sibling sections:
  //   - repeatWithAnAuthorisedIssue — an issue is currently outstanding
  //     ("Next Repeat Prescribing Issue" card). issueNumberAsXOfY is a real
  //     "<N> of <M>" pair.
  //   - repeatPrescribingWithNoIssues — no issue currently outstanding
  //     ("Prescriptions for Reauthorisation" → "Repeat Prescribing" card,
  //     e.g. Atorvastatin). issueNumberAsXOfY is always null here — by
  //     definition every item in this bucket has used its last issue
  //     (hasOutstandingIssues: false), so classifyFromXOfY correctly (if
  //     coincidentally) always lands 'unclear', same as an exhausted item
  //     in the other bucket would. fulfilledByPrescription is null too (no
  //     currently-fulfilled issue to describe), so the pill falls back to
  //     "days unknown" rather than guessing — even though quantityAndUnit +
  //     dosageInstruction are present and would let computedDaysSupply()
  //     produce a number, that's deliberately not surfaced as if it were a
  //     reported value; see checkDaysSupply()'s own doc comment for why
  //     these two sources of days-supply are never blurred together.
  //   - repeatDispensing — "Prescriptions for Reauthorisation" → "Repeat
  //     Dispensing" card (e.g. Amlodipine, Ramipril). Deliberately NOT
  //     read: out of scope per the original "not acute, or repeat
  //     dispensing" ask, confirmed again live (Nick: "I wouldn't expect
  //     [pills] next to repeat dispensing items").
  //   - variableRepeat — e.g. Naproxen, Omeprazole, always
  //     issueNumberAsXOfY: null for a different reason (no fixed/
  //     until-review distinction exists for this type at all). Also not
  //     read — a third category again, out of scope.
  // Both READ sections share an identical item shape (product,
  // issueNumberAsXOfY, quantityAndUnit, dosageInstruction,
  // fulfilledByPrescription, …), so the same per-item mapping below
  // handles both without branching.
  //
  // (Wrapper key itself renamed from prescriptionRequestsByType by Medicus
  // sometime between 2026-08-26 and 2026-09-03 — see the file header note.)
  //
  // Fetching medication-regimen instead of this endpoint would be strictly
  // worse: that returns the patient's WHOLE current repeat list, most of
  // which may not even be part of this specific request (confirmed live: a
  // task requesting Venlafaxine fetched Mirtazapine + both Venlafaxine
  // strengths from medication-regimen, none of which matched anything in
  // the left-hand card because Mirtazapine wasn't part of THIS request at
  // all).
  async function loadTaskOverviewItems(ctx) {
    var ra = RA();
    var gelDoseFactors = await ensureGelDoseFactorsLoaded();
    var resp;
    try {
      resp = await fetch(ctx.apiBase + '/tasks/data/' + ctx.taskTypeSlug + '/overview/' + ctx.taskUuid, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      log('loadTaskOverviewItems: fetch threw ->', e && e.message);
      return [];
    }
    if (!resp.ok) {
      log('loadTaskOverviewItems: HTTP', resp.status);
      return [];
    }
    var taskData;
    try {
      taskData = await resp.json();
    } catch (e) {
      log('loadTaskOverviewItems: JSON parse failed ->', e && e.message);
      return [];
    }
    var byType = taskData && taskData.data && taskData.data.prescriptionRequestItemsByType;
    var withIssue = byType && byType.repeatWithAnAuthorisedIssue;
    var noIssues = byType && byType.repeatPrescribingWithNoIssues;
    var items = [].concat(
      Array.isArray(withIssue && withIssue.items) ? withIssue.items : [],
      Array.isArray(noIssues && noIssues.items) ? noIssues.items : []
    );
    log(
      'loadTaskOverviewItems: repeatWithAnAuthorisedIssue + repeatPrescribingWithNoIssues has',
      items.length,
      'item(s):',
      items.map(function (m) {
        return m && m.product;
      })
    );
    // Diagnostic only, never used to decide what to render — distinguishes
    // "this task genuinely has no repeat items of either kind" (the sibling
    // categories below have all this task's real items) from "a field
    // moved" (byType has no key resembling either name at all). See
    // shared/repeat-authorisation.js's header comment — acute,
    // variable-repeat and repeat-dispensing are deliberately out of scope.
    if (!items.length && DEBUG()) {
      log('loadTaskOverviewItems: taskData top-level keys ->', taskData ? Object.keys(taskData) : taskData);
      log(
        'loadTaskOverviewItems: taskData.data top-level keys ->',
        taskData && taskData.data ? Object.keys(taskData.data) : taskData && taskData.data
      );
      log('loadTaskOverviewItems: prescriptionRequestItemsByType keys ->', byType ? Object.keys(byType) : byType);
      if (byType) {
        Object.keys(byType).forEach(function (key) {
          var section = byType[key];
          var n = Array.isArray(section && section.items) ? section.items.length : null;
          log('  ' + key + '.items.length ->', n);
        });
      }
    }
    var mapped = items
      .filter(function (m) {
        return m && m.product;
      })
      .map(function (m) {
        var verdict = ra.classifyFromXOfY(m.issueNumberAsXOfY).verdict;
        return {
          description: m.product,
          xOfY: m.issueNumberAsXOfY || null,
          verdict: verdict,
          text: ra.describeForPillFromTaskItem(m, gelDoseFactors),
          days: ra.daysSupplyFromTaskItem(m),
        };
      });
    // Cross-item outlier check — deliberately AFTER every item's own days
    // figure is known, not folded into the per-item mapping above, so it
    // can compare across the whole task rather than one item at a time.
    // See shared/repeat-authorisation.js's daysSupplyOutliers() for the
    // fail-closed rules (needs a genuine, unambiguous majority — never just
    // "whichever value appears most, even by one, or as a coin-flip
    // between two").
    var daysList = mapped.map(function (m) {
      return m.days;
    });
    var outlierResult = ra.daysSupplyOutliers(daysList);
    var colourRoles = ra.daysSupplyColourRoles(daysList, outlierResult);
    // Fresh per this one task — first-seen order of DISTINCT outlier
    // values within THIS list only, so an unrelated later task never
    // inherits colour assignments from this one. See colourForRole's own
    // header comment.
    var outlierColourAssignments = {};
    mapped.forEach(function (m, i) {
      if (outlierResult.outliers[i]) {
        // m.days is guaranteed non-null here — daysSupplyOutliers() never
        // flags a null entry. Kept as a SEPARATE field, not appended into
        // m.text, so inject()/buildPill() can render it in its own styled
        // (red, underlined) span rather than as plain pill text.
        m.deltaText = ra.formatDaysOutlierDelta(m.days, outlierResult.majorityDays);
      }
      m.colour = colourForRole(colourRoles[i], m.days, outlierColourAssignments);
    });
    log(
      'loadTaskOverviewItems: days-supply outlier check ->',
      JSON.stringify({
        days: daysList,
        majorityDays: outlierResult.majorityDays,
        outliers: outlierResult.outliers,
        colourRoles: colourRoles,
      })
    );
    return mapped;
  }

  async function loadMedicationTabItems(ids) {
    var ra = RA();
    var sac = SAC();
    var gelDoseFactors = await ensureGelDoseFactorsLoaded();
    var regimen = await sac.fetchMedicationRegimen(ids.apiBase, ids.patientUuid);
    var list = Array.isArray(regimen && regimen.currentRepeatPrescribingMedications)
      ? regimen.currentRepeatPrescribingMedications
      : [];
    log(
      'loadMedicationTabItems: currentRepeatPrescribingMedications has',
      list.length,
      'item(s):',
      list.map(function (m) {
        return m && m.description;
      })
    );
    return list
      .filter(function (m) {
        return m && m.description;
      })
      .map(function (m) {
        var verdict = ra.classifyAuthorisation(m).verdict;
        var days = ra.daysSupplyFor(m);
        // No sibling items to compare against on this tab (each drug's
        // whole-list days-supply is unrelated to the others' — no
        // majority concept applies), so this always uses the plain
        // per-interval fallback colour, never the majority/outlier scheme.
        return {
          description: m.description,
          verdict: verdict,
          text: ra.describeForPill(m, gelDoseFactors),
          days: days,
          colour: colourForDays(days),
        };
      });
  }

  async function loadItems(ids) {
    var ra = RA();
    var sac = SAC();
    if (!ra || !sac) {
      log('loadItems: RepeatAuthorisation or SentinelApiClient unavailable', { hasRA: !!ra, hasSAC: !!sac });
      return [];
    }
    if (PRESCRIPTION_REQUEST_RE.test(location.href)) {
      var ctx = sac.detectMedicusContext(location.href);
      if (!ctx || !ctx.taskTypeSlug || !ctx.taskUuid) {
        log('loadItems: could not re-derive taskTypeSlug/taskUuid for', location.href);
        return [];
      }
      return loadTaskOverviewItems(ctx);
    }
    if (typeof sac.fetchMedicationRegimen !== 'function') return [];
    return loadMedicationTabItems(ids);
  }

  // ── Re-authorise form (single item) ─────────────────────────────────────────
  // GET .../clinical/data/prescription/re-authorise/{prescriptionId} — the
  // response's `prescription` field is TOP-LEVEL (no `.data` wrapper, unlike
  // the task-overview endpoint above — confirmed live, HAR
  // 120-reauthorise.har). See shared/repeat-authorisation.js's
  // describeForReauthorisationForm for the field mapping.
  // Only the ONE-TIME fetches live here — `prescription` (mostly static:
  // product, authorisationMethod, unit description) and `siblingDays` (the
  // patient's OTHER repeats, for the outlier comparison below). Anything
  // that can change WITHOUT a fresh fetch of this endpoint — specifically
  // Medicus's own live issue-quantity recalculation, see
  // computeReauthorisationPill below — is deliberately NOT baked in here,
  // so it can be re-applied fresh on every render tick instead of going
  // stale the moment it changes.
  async function loadReauthorisationFormItem(apiBase, prescriptionId) {
    var ra = RA();
    var sac = SAC();
    var resp;
    try {
      resp = await fetch(apiBase + '/clinical/data/prescription/re-authorise/' + prescriptionId, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      log('loadReauthorisationFormItem: fetch threw ->', e && e.message);
      return null;
    }
    if (!resp.ok) {
      log('loadReauthorisationFormItem: HTTP', resp.status);
      return null;
    }
    var json;
    try {
      json = await resp.json();
    } catch (e) {
      log('loadReauthorisationFormItem: JSON parse failed ->', e && e.message);
      return null;
    }
    var prescription = json && json.prescription;
    if (!prescription) {
      log('loadReauthorisationFormItem: no prescription field in response, keys ->', json ? Object.keys(json) : json);
      return null;
    }

    // Compare against the patient's OTHER repeats (Nick's own request,
    // 2026-09-10, live-confirmed problem): Medicus's own "helpful" issue-
    // quantity auto-adjust on reauthorisation can silently drift a drug's
    // interval away from the rest of the patient's repeats. Reuses the
    // EXACT SAME outlier engine as the task-overview screen
    // (daysSupplyOutliers/daysSupplyColourRoles/formatDaysOutlierDelta) —
    // just against a different comparison list (the patient's whole
    // current repeat list via medication-regimen, not one task's items).
    // `json.patientId` comes straight off this SAME re-authorise response
    // — no extra identity resolution needed, unlike the two list screens.
    //
    // UNVERIFIED LIVE ASSUMPTION: siblings are excluded from the
    // comparison by matching `description` against this item's own
    // `productName` — if that string doesn't match Medicus's medication-
    // regimen entry for the SAME drug exactly, this item would be
    // double-counted, which could skew the majority. Check this first if
    // the outlier flag ever looks wrong live.
    var patientId = json.patientId;
    var siblingDays = [];
    if (patientId && typeof sac.fetchMedicationRegimen === 'function') {
      try {
        var regimen = await sac.fetchMedicationRegimen(apiBase, patientId);
        var siblings = Array.isArray(regimen && regimen.currentRepeatPrescribingMedications)
          ? regimen.currentRepeatPrescribingMedications
          : [];
        var productName = prescription.productName || prescription.productDescription;
        siblingDays = siblings
          .filter(function (m) {
            return m && m.description !== productName;
          })
          .map(function (m) {
            return ra.daysSupplyFor(m);
          });
      } catch (e) {
        log('loadReauthorisationFormItem: sibling fetch failed ->', e && e.message);
      }
    }

    log('loadReauthorisationFormItem: prescription ->', prescription.productName, 'siblingDays ->', siblingDays);
    return { prescription: prescription, siblingDays: siblingDays };
  }

  // Builds the pill's text/colour/deltaText from the cached one-time
  // fetch. Shows TWO independent flags:
  //   - the quantity÷dose cross-check (describeForReauthorisationForm ->
  //     daysClause), removed 2026-09-10 then RESTORED the same day —
  //     see that function's own comment for why: it's a genuine no-op for
  //     STRUCTURED dosage (Medicus keeps those self-consistent), but the
  //     ONLY thing that can catch a wrong "Expected days supply" for
  //     FREE-TEXT dosage (e.g. HRT gel "3 pumps daily"), which Medicus has
  //     no mechanism to self-correct at all.
  //   - the sibling-comparison outlier check against the patient's other
  //     repeats (Nick's own framing, 2026-09-10: "tell me if I'm about to
  //     reauthorise one medication on a 28 day cycle when everything else
  //     is on 56").
  function computeReauthorisationPill(cached, gelDoseFactors) {
    var ra = RA();
    var prescription = cached.prescription;
    var text = ra.describeForReauthorisationForm(prescription, gelDoseFactors);
    var rawDays = prescription.expectedDaysSupply;
    var ownDays = rawDays != null && rawDays !== '' && !Number.isNaN(Number(rawDays)) ? Number(rawDays) : null;
    var colour = colourForDays(ownDays);
    var deltaText = null;

    if (ownDays != null && cached.siblingDays.length) {
      var daysList = cached.siblingDays.concat([ownDays]);
      var ownIndex = daysList.length - 1;
      var outlierResult = ra.daysSupplyOutliers(daysList);
      if (outlierResult.outliers[ownIndex]) {
        deltaText = ra.formatDaysOutlierDelta(ownDays, outlierResult.majorityDays);
      }
      var colourRoles = ra.daysSupplyColourRoles(daysList, outlierResult);
      colour = colourForRole(colourRoles[ownIndex], ownDays, {});
    }
    return { text: text, colour: colour, deltaText: deltaText };
  }

  // Placed right after the "Expected days supply" label text (Nick's own
  // instruction, 2026-09-10) — see findTextMatch's own header comment for
  // why this uses a different, simpler anchor strategy than the two
  // multi-item screens above.
  function injectReauthorisationForm(gelDoseFactors) {
    if (!_reauthItem) {
      log('injectReauthorisationForm: nothing to place (_reauthItem is', _reauthItem, ')');
      return;
    }
    var label = findTextMatch('Expected days supply');
    if (!label || !label.parentNode) {
      log('injectReauthorisationForm: no DOM anchor found for "Expected days supply" - text match failed');
      return;
    }
    var pillData = computeReauthorisationPill(_reauthItem, gelDoseFactors);
    var sib = label.nextElementSibling;
    // Same idempotency-key shape as inject() below (text + deltaText) —
    // comparing against plain text alone would miss a sibling-comparison
    // delta appearing/changing/clearing on an otherwise-unchanged item.
    var idempotencyKey = pillData.text + (pillData.deltaText ? '|' + pillData.deltaText : '');
    if (sib && sib.classList && sib.classList.contains(PILL_CLASS)) {
      if (sib.dataset.rppText === idempotencyKey) return; // idempotent
      sib.remove();
    }
    var pill = buildPill(pillData.text, pillData.colour, pillData.deltaText);
    label.parentNode.insertBefore(pill, label.nextSibling);
  }

  // Runs on EVERY refresh tick, independent of isActivePage()/location.href
  // — see the header comment on why this screen has no URL to gate on at
  // all. Detection is DOM-first: findTextMatch('Expected days supply')
  // decides whether the popup is CURRENTLY open (it's torn down by Vue the
  // moment the popup closes, so this is never stale); the prescriptionId
  // comes from page-world.js's MAIN-world network stamp
  // ('data-ch-reauth-prescription', set by noteReauthorisePrescription
  // whenever the page's own fetch/XHR requests
  // .../clinical/data/prescription/re-authorise/{id}) since there is no
  // URL to read it from. The stamp can LINGER after the popup closes (it's
  // just "last seen", never cleared) — that's fine, because the DOM check
  // above is what actually gates whether anything gets rendered.
  async function refreshReauthorisationForm() {
    // Cheap self-gate BEFORE the expensive whole-page findTextMatch scan
    // below: no stamp at all means the re-authorise endpoint has never
    // fired this session, so the popup can't possibly be open — skip the
    // scan entirely rather than running it on every unrelated Medicus page.
    var stampRaw = '';
    try {
      stampRaw = document.documentElement.getAttribute('data-ch-reauth-prescription') || '';
    } catch (_) {
      /* stays empty — pill simply won't show */
    }
    if (!stampRaw) return;
    var label = findTextMatch('Expected days supply');
    if (!label) {
      _reauthItem = null;
      _reauthCacheKey = null;
      return;
    }
    var prescriptionId = stampRaw.split('|')[0];
    if (!prescriptionId) {
      log('refreshReauthorisationForm: "Expected days supply" found but no prescriptionId stamp yet');
      return;
    }
    var sac = SAC();
    var ra = RA();
    if (!sac || !ra) return;
    var ctx = sac.detectMedicusContext(location.href);
    if (!ctx || !ctx.apiBase) {
      log('refreshReauthorisationForm: could not resolve apiBase for', location.href);
      return;
    }
    if (_reauthCacheKey !== prescriptionId) {
      try {
        _reauthItem = await loadReauthorisationFormItem(ctx.apiBase, prescriptionId);
        _reauthCacheKey = prescriptionId;
      } catch (e) {
        log('refreshReauthorisationForm: loadReauthorisationFormItem threw ->', e && e.message);
        _reauthItem = null;
        _reauthCacheKey = prescriptionId;
      }
    }
    var gelDoseFactors = await ensureGelDoseFactorsLoaded();
    injectReauthorisationForm(gelDoseFactors);
  }

  async function refresh() {
    await refreshReauthorisationForm();

    if (!isActivePage()) {
      log('refresh: not an active page for', location.href);
      if (_items) removeAllPills();
      _items = null;
      _cacheKey = null;
      return;
    }
    var ids = await resolveIdentity();
    if (!ids) {
      log('refresh: could not resolve identity (apiBase/patientUuid) for', location.href);
      removeAllPills();
      return;
    }
    log('refresh: identity resolved ->', ids);
    if (_cacheKey !== ids.patientUuid) {
      try {
        _items = await loadItems(ids);
        _cacheKey = ids.patientUuid;
      } catch (e) {
        log('refresh: loadItems threw ->', e && e.message);
        _items = [];
        _cacheKey = ids.patientUuid;
      }
    }
    inject();
  }

  function queueRefresh() {
    if (_renderQueued) return;
    _renderQueued = true;
    setTimeout(function () {
      _renderQueued = false;
      refresh();
    }, 150);
  }

  if (window.__chObserverHub && typeof window.__chObserverHub.subscribe === 'function') {
    window.__chObserverHub.subscribe(queueRefresh);
  } else {
    setInterval(queueRefresh, 3000); // fallback if the hub failed to load before us
  }
  window.addEventListener('popstate', queueRefresh);
  window.addEventListener('hashchange', queueRefresh);
  queueRefresh();
})();
