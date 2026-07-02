// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — DOM Contract Registry (Horizon 1, Part 1)
//
// A declarative catalogue of every DOM selector the suite depends on to inject
// into, or read out of, the live Medicus page. Three of the last six mainline
// fixes (v3.143.1 OIR checkboxes, v3.143.2 assignee picker, the v3.134.x-era
// selector work) were regressions caused by Medicus silently changing frontend
// components, each discovered by a clinician in clinic rather than by CI. This
// registry is the single source of truth those selectors are read FROM, so:
//   - a future consumer change and the registry cannot drift apart (consumers
//     that live outside content-scripts/triage-lens/content.js read their
//     selectors from here rather than hard-coding them a second time), and
//   - fixture-based regression tests (test-dom-contracts.js) and — in Batch H2
//     — a runtime canary can probe the SAME declarations the code actually uses.
//
// SELECTORS ARE VERBATIM. This file is a RELOCATION of truth mined from the
// existing consumers, not a redesign — every `target`/`legacy`/`anchor` string
// below is copied character-for-character from the call site named in `source`.
// Do not "clean up" or generalise a selector here without also changing the
// consumer, and vice versa (see test-dom-contracts-sync.js for the mirrored
// content.js contracts, and the "migrate" contracts' consumer files for the
// non-mirrored ones).
//
// ── content.js constraint ───────────────────────────────────────────────────
// content-scripts/triage-lens/content.js must NOT be edited by this registry
// work (tests pin its exact content). Contracts whose selectors live there
// carry `mirrorOf: 'content.js'` and are READ-ONLY documentation — nothing
// imports them back into content.js. test-dom-contracts-sync.js greps
// content.js for each mirrored literal on every CI run, so a future content.js
// selector rename that isn't mirrored here fails closed instead of drifting
// silently.
//
// ── Contract schema ──────────────────────────────────────────────────────────
//   id          — stable dotted identifier, "<feature>.<surface>"
//   description — what this selector finds and why the feature needs it
//   feature     — the owning feature (short name)
//   degradation — what silently breaks for the clinician when this contract fails
//   source      — "<file>:<lines>" the selectors were mined from
//   pageMatch   — RegExp tested against location.href/pathname where this
//                 contract applies, or null when the contract is a universal
//                 fallback checked on any medicus.health page
//   anchor      — CSS selector (string, may itself be a comma-list) proving the
//                 surface is present and POPULATED — e.g. "OIR rows exist".
//                 Anchor absent → NOT_APPLICABLE (page empty/not loaded — this
//                 must never read as a false alarm).
//   target      — array of CSS selector strings, tried together (OR'd) — the
//                 CURRENT/preferred selector(s) the feature actually needs
//                 (e.g. the checkbox inside a row). Order matters for
//                 migrated consumers that call findByText(target, …) with a
//                 real DOM (first-match-wins iteration order), so the array
//                 order here is copied verbatim from the source.
//   legacy      — array of FALLBACK TIERS, each itself an array of CSS
//                 selector strings, tried in order after `target` — mirrors
//                 whatever fallback chain the code keeps (the m-checkbox vs
//                 q-checkbox pattern from v3.143.1 is the canonical case, but
//                 a "narrow realistic carriers, then a wide sweep" performance
//                 tier — as in booking-inline.js/task-inline.js — is encoded
//                 the same way). Empty array when the code has no fallback.
//   runtime     — true when a live canary (Batch H2) can safely probe this
//                 contract without false alarms; false when the selector
//                 family is too generic (would fire constantly on unrelated
//                 page content) or too transient (only exists for a few
//                 seconds mid-interaction) to probe usefully. `runtimeNote`
//                 explains every `false`.
//   mirrorOf    — 'content.js' for contracts whose selectors live in the file
//                 this repo must not edit; null for contracts owned by a file
//                 this batch migrates to read FROM this registry.
//   suppressedByOk — optional id of another contract whose OK status this same
//                 probe round means THIS contract's own FAIL is a covered
//                 fallback, not a user-visible degradation — e.g.
//                 queue.preview-row-link failing to find the preview row is a
//                 real DOM change, but queue.chip-host's OWN legacy fallback
//                 (the patientName cell) still lands the chip, so the
//                 clinician sees nothing wrong. The canary treats this
//                 contract as OK whenever the referenced contract reads OK in
//                 the same round (see contract-canary.js applyProbeRound).
//
// ── Probe semantics ───────────────────────────────────────────────────────────
//   NOT_APPLICABLE — anchor matches 0 elements (page not loaded / empty —
//                    never a false alarm).
//   FAIL           — anchor matches ≥1 AND neither `target` nor any `legacy`
//                    tier matches ≥1 (the feature's own selector AND every
//                    fallback it keeps are both absent).
//   OK             — anchor matches ≥1 AND (`target` matches ≥1 OR some
//                    `legacy` tier matches ≥1).
//
// ── Dual-mode export (same pattern as shared/event-ledger.js) ─────────────────
//   Browser (classic script): window.DomContracts.<fn>(...)
//   Node / test:               require('./shared/dom-contracts.js').<fn>(...)

(function (global) {
  'use strict';

  // ── Registry ──────────────────────────────────────────────────────────────
  const CONTRACTS = [
    // ── OIR (Outstanding Investigation Requests) — MIRROR ONLY ───────────────
    // content-scripts/triage-lens/content.js readOutstandingRows/tickRows/
    // updateBulkBar/annotateOutstandingRow (lines ~2334-2600) own this DOM
    // entirely — there is no separate consumer file to migrate.
    {
      id: 'oir.checkbox',
      description:
        'Outstanding Investigation Requests card row checkbox. readOutstandingRows() detects the current native-checkbox markup first (label.m-checkbox > input.m-checkbox__native), falling back to legacy Quasar (.q-checkbox with aria-labelledby) — the exact break fixed in v3.143.1.',
      feature: 'OIR smart-match auto-tick / advisory annotation',
      degradation:
        'auto-tick and the "Tick off results found in record" bulk action silently stop firing; per-row ✓/⏳/↩ badges stop rendering — a genuinely-resulted request can look outstanding forever, or vice versa.',
      source: 'content-scripts/triage-lens/content.js:2334-2373 (readOutstandingRows)',
      pageMatch: /\/tasks\/data\/[^/]+\/overview\//i,
      anchor: '[data-testid="test-outstanding-investigation-requests"]',
      target: ['label.m-checkbox'],
      legacy: [['.q-checkbox']],
      runtime: true,
      mirrorOf: 'content.js',
    },

    // ── Queue chip hosts — MIRROR ONLY ───────────────────────────────────────
    // content-scripts/triage-lens/content.js owns injection into the live
    // Vue+AG-Grid queue grid (decorateOneRow / findQueuePreviewRow /
    // refreshQueueChips). See CLAUDE.md "Injecting chips into the live Medicus
    // queue" for the mechanics these contracts document.
    {
      id: 'queue.chip-host',
      description:
        "Where age/decoration and result/monitoring chips are injected on a queue row: the preview/detail row's inner content wrapper when a preview row exists, else the patient-name cell. Mirrors decorateOneRow's own inject-target chain.",
      feature: 'Queue chips (.ch-queue-chips / .ch-q-mon / .ch-q-result)',
      degradation:
        'chips silently stop injecting into the live Medicus queue (or inject then get reconciled away) — age/priority/result/monitoring flags disappear from the worklist with no error.',
      source:
        'content-scripts/triage-lens/content.js:3542-3549,3627-3639 (queueChipHost / decorateOneRow inject block)',
      pageMatch: /\/tasks\/[^/]+\/task-list/,
      anchor: '.ag-row [col-id="dateOfBirth"]',
      target: ['.h-full.w-full'],
      legacy: [['.ag-full-width-container'], ['[col-id="patientName"]']],
      runtime: true,
      mirrorOf: 'content.js',
    },
    {
      id: 'queue.preview-row-link',
      description:
        'How a queue master row\'s own preview/detail row is located: by id (master row-id="<UUID>" ↔ detail row-id="detail_<UUID>"), falling back to a DOM-order .ag-full-width-row sibling for simpler layouts / test mocks.',
      feature: 'Queue chips — master/detail row linkage (findQueuePreviewRow)',
      degradation:
        'chips can no longer find the roomy preview row to inject into and fall back to the width-capped inline cell, or (if the fallback also fails) do not inject at all. The latter case is what the health strip should actually surface — see suppressedByOk.',
      source: 'content-scripts/triage-lens/content.js:3518-3534 (findQueuePreviewRow)',
      pageMatch: /\/tasks\/[^/]+\/task-list/,
      anchor: '.ag-row',
      target: ['[row-id^="detail_"]'],
      legacy: [['.ag-full-width-row']],
      runtime: true,
      mirrorOf: 'content.js',
      // queueChipHost() (content.js:3579-3586) itself falls back to the
      // patientName cell when the preview row is missing, and queue.chip-host
      // probes that whole chain (target + both legacy tiers, including the
      // patientName cell). So when queue.chip-host reads OK, chips are
      // visibly landing somewhere even though this narrower preview-row
      // linkage failed — not a clinician-visible break, don't alarm on it.
      suppressedByOk: 'queue.chip-host',
    },
    {
      id: 'queue.chip-marker-classes',
      description:
        'The three injected chip family classes swept on every refreshQueueChips (wipe-and-redecorate) and de-duped on inject. Per CLAUDE.md rule 5, each must also be present in hud.css\'s token-block selector list or it renders as an unstyled "white rectangle" (that check is out of scope for this registry).',
      feature: 'Queue chips — re-injection / de-dupe',
      degradation:
        'stale chips are never swept on AG-Grid row recycling (duplicate or orphaned chips), or the de-dupe check stops preventing double-injection.',
      source:
        'content-scripts/triage-lens/content.js:3641,3691 (decorateOneRow de-dupe guard; refreshQueueChips sweep)',
      pageMatch: /\/tasks\/[^/]+\/task-list/,
      anchor: '.ag-row',
      target: ['.ch-queue-chips', '.ch-q-mon', '.ch-q-result'],
      legacy: [],
      runtime: true,
      mirrorOf: 'content.js',
    },

    // ── routine-rx-button.js — MIGRATED ──────────────────────────────────────
    {
      id: 'routine-rx.routing-control',
      description:
        'The "Save & send to routine requests task list" radio option. findRoutingControl() tries the realistic carriers first (label / [role="radio"] / .radio) and only widens to a div/span sweep if that narrow pass finds nothing (perf: avoids a reflow storm on the wide fallback).',
      feature: 'Routine-Rx one-click reassign — step 1 (routing radio)',
      degradation:
        'the reassign macro aborts at step 1 ("Couldn’t find the ‘Save & send to routine requests task list’ option") and the floating action button itself never appears (H-035 gate 2 also reads this control).',
      source: 'content-scripts/triage-lens/routine-rx-button.js:528-533 (findRoutingControl)',
      pageMatch: /\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i,
      anchor: 'button, [role="button"]',
      target: ['label', '[role="radio"]', '.radio'],
      legacy: [['div', 'span']],
      runtime: true,
      mirrorOf: null,
    },
    {
      id: 'routine-rx.assignee-option',
      description:
        'The team option rendered by the "Assign to" picker\'s debounced, server-driven live search (Medicus\'s m-simple-select, which replaced the old Quasar q-select in v3.143.2). All three attribute conventions are queried together in one call, not as tiered fallbacks.',
      feature: 'Routine-Rx one-click reassign — step 3 (select team)',
      degradation:
        'the macro times out with "Team … isn’t in the assignee list" even when the team exists — nothing is selected and the commit button never enables.',
      source: 'content-scripts/triage-lens/routine-rx-button.js:282 (runMacro, step 3)',
      pageMatch: /\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i,
      anchor: 'label, [role="radio"], .radio',
      target: ['[id^="select-item-"]', '[role="option"]', 'li[role="option"]'],
      legacy: [],
      runtime: false,
      runtimeNote:
        'the option list only exists in the DOM for the few seconds after the clinician types into the picker (debounced server search) — a page-load/idle probe would see anchor present but the transient target absent almost always, which is not a real degradation. Fixture-tested only.',
      mirrorOf: null,
    },
    {
      id: 'routine-rx.action-anchor',
      description:
        'The "More actions" button beside the routing control, used to place the floating reassign button (H-035 gate 3 — same panel as the routing control, not inside a dialog/drawer).',
      feature: 'Routine-Rx one-click reassign — button placement',
      degradation:
        'the floating "→ Team" button never appears on the prescribing screen even though the routing control is present, so the clinician has no fast path and must use Medicus’s native flow.',
      source: 'content-scripts/triage-lens/routine-rx-button.js:541 (findActionAnchor)',
      pageMatch: /\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i,
      anchor: 'label, [role="radio"], .radio',
      target: ['button', '[role="button"]'],
      legacy: [],
      runtime: false,
      runtimeNote:
        'the selector family alone cannot distinguish the text-filtered "More actions" button from any other button on the page, and buttons are near-universal — a live probe could never usefully distinguish OK from FAIL. Fixture-tested only.',
      mirrorOf: null,
    },

    // ── lab-file-button.js — MIGRATED ────────────────────────────────────────
    {
      id: 'lab-file.file-button',
      description:
        "The commit control family used for the File / Complete / message-send buttons (GATE 2 and STEP 5/6 of fileAllNormal). Matched by the profile's configured button TEXT within this role family.",
      feature: 'Lab Filing "File all normal" — commit controls',
      degradation:
        'the auto-filing card never offers the action (GATE 2 fails closed — "no-file-button") even when every result is genuinely normal; the clinician sees no card at all rather than a broken one.',
      source: 'content-scripts/triage-lens/lab-file-button.js:202,342,355 (fileAllNormal GATE 2 / STEP 5 / STEP 6)',
      pageMatch: /\/tasks\/data\/[^/]*(investigation|result|report)[^/]*\/overview\//i,
      anchor: '[role="radio"], .q-radio, .q-item, label, div, span',
      target: ['button', '[role="button"]', 'input[type="submit"]'],
      legacy: [],
      runtime: false,
      runtimeNote:
        "both this contract's anchor and target are generic interactive-role queries reused for many unrelated controls on a task overview — a match/no-match here cannot distinguish lab-filing's own controls from anything else on the page. Fixture-regression only.",
      mirrorOf: null,
    },
    {
      id: 'lab-file.normal-option-controls',
      description:
        'The "already visible" per-row normal-option control family (used when the profile has no openControlText, i.e. options are inline radios/checkboxes rather than behind a per-row menu).',
      feature: 'Lab Filing "File all normal" — mark subheadings normal',
      degradation:
        'GATE 3 fails closed ("no-normal-controls") — the macro cannot mark a single subheading, so it refuses to file rather than filing an unmarked result.',
      source: 'content-scripts/triage-lens/lab-file-button.js:230-237 (fileAllNormal STEP 1, non-openControlText path)',
      pageMatch: /\/tasks\/data\/[^/]*(investigation|result|report)[^/]*\/overview\//i,
      anchor: 'button, [role="button"], input[type="submit"]',
      target: ['[role="radio"]', '[role="option"]', '.q-radio', '.q-checkbox', '.q-item', 'label', 'button'],
      legacy: [],
      runtime: false,
      runtimeNote: 'same false-positive risk as lab-file.file-button — generic role families, fixture-regression only.',
      mirrorOf: null,
    },

    // ── booking-inline.js / task-inline.js — MIGRATED (shared) ──────────────
    // Both files carry byte-identical HEADING_RE / findHeading / findCard
    // implementations (booking-inline.js:216-252, task-inline.js:125-161) —
    // one shared contract, consumed by both.
    {
      id: 'task-widget.codes-actions-heading',
      description:
        'The "Codes & actions" section heading both inline widgets anchor below. findHeading() searches the realistic heading carriers first (h1-h6/strong/b/legend — a tiny node set) and only falls back to a div/span/p sweep if that narrow pass finds nothing (perf: avoids reading .textContent of large container subtrees).',
      feature: 'Booking-inline / task-inline widget placement',
      degradation:
        'both inline widgets fall through to their weaker fallback anchors (task-inline\'s bottom action-row, or nothing for booking-inline) — "Book appointment" / "Create task" panels can silently stop appearing on task types that used to have a Codes & actions card.',
      source:
        'content-scripts/booking-inline.js:216-236, content-scripts/task-inline.js:125-145 (HEADING_RE / findHeading)',
      pageMatch:
        /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      anchor: 'button, [role="button"], input[type="submit"]',
      target: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'legend'],
      legacy: [['div', 'span', 'p']],
      runtime: true,
      mirrorOf: null,
    },
    {
      id: 'task-widget.card-submit-button',
      description:
        'findCard() walks up from the "Codes & actions" heading looking for the smallest ancestor that also contains a button/[role="button"]/input[type="submit"] whose text is exactly "Submit" — the lowest common ancestor of heading and Submit button is the bounding card the widgets insert after.',
      feature: 'Booking-inline / task-inline widget placement — card boundary',
      degradation:
        "findCard() falls back to the heading's immediate parent (a much smaller ancestor than the real card), so the widget can render inside or awkwardly close to the Codes & actions form instead of cleanly below it.",
      source: 'content-scripts/booking-inline.js:238-252, content-scripts/task-inline.js:147-161 (findCard)',
      pageMatch:
        /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      anchor: 'h1, h2, h3, h4, h5, h6, strong, b, legend',
      target: ['button', '[role="button"]', 'input[type="submit"]'],
      legacy: [],
      runtime: false,
      runtimeNote:
        'the "Submit" text filter that identifies the real button happens at runtime beyond what a selector-only probe encodes, and this generic role family is reused everywhere. Fixture-regression only.',
      mirrorOf: null,
    },
    {
      id: 'task-inline.action-row',
      description:
        'The bottom-most visible "More actions" button\'s row — task-inline\'s universal fallback anchor (gate 3) for task types with no Codes & actions card at all, e.g. prescribing overviews (Routine/Non-Routine Repeat Request, Medications for Re-authorisation).',
      feature: 'Task-inline "Create task" widget — universal fallback anchor',
      degradation:
        'on task types with no Codes & actions card, the "Create task for this patient" widget has nowhere left to anchor and silently never injects (this is exactly the v3.134.2 regression the fallback was added to fix).',
      source: 'content-scripts/task-inline.js:165-175 (findActionRow)',
      pageMatch:
        /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      anchor: 'button, [role="button"], input[type="submit"]',
      target: ['button', '[role="button"]'],
      legacy: [],
      runtime: false,
      runtimeNote:
        'the "more actions" text filter and visibility/dialog exclusion happen at runtime beyond what a selector-only probe encodes, and this target family is a near-subset of its own anchor family. Fixture-regression only.',
      mirrorOf: null,
    },

    // ── sentinel.js — MIGRATED (documented non-dependency) ──────────────────
    {
      id: 'sentinel.mount-anchor',
      description:
        "Sentinel's sidebar host (#sentinel-host) is created fresh and appended directly to document.documentElement — it owns its entire subtree via a closed shadow root and does not query, anchor to, or depend on any Medicus-authored selector. This contract exists to close out the plan's initial-coverage list explicitly rather than silently omit sentinel.js: mining the file found no selector dependency to register.",
      feature: 'Sentinel sidebar mount',
      degradation:
        'none from a Medicus DOM change — the mount is self-contained. (If Medicus ever removes document.documentElement itself the whole page is gone, which is out of scope for this registry.)',
      source: 'content-scripts/sentinel.js:138-162 (mount)',
      pageMatch: null,
      anchor: 'html',
      target: ['body'],
      legacy: [],
      runtime: false,
      runtimeNote: 'not a meaningful Medicus-selector probe — documents an explicitly-verified non-dependency.',
      mirrorOf: null,
    },

    // ── engine/api-client.js — MIGRATED ──────────────────────────────────────
    {
      id: 'api-client.patient-uuid-dom-fallback',
      description:
        'Universal banner-link DOM fallback for resolving the current patient\'s UUID when URL-based detection (detectMedicusContext) fails. Strategy 1 (authoritative): a single distinct data-patient-id/data-patientid/data-patient/data-pid attribute value — the migrated consumer reads `anchor`/`target` from this contract directly (behaviour-identical). Strategies 2/3 (fallback): every a[href] (== `anchor`, also read from this contract) is scanned by a JS regex (UUID_RE_GREEDY, unchanged in engine/api-client.js — a regex extraction has no CSS-selector equivalent to relocate) for a /care-record/{uuid} or /patient/{uuid} link; a single distinct match wins, multiple or zero matches "refuse to guess" and return null. `legacy` here is a STRUCTURAL approximation of that regex (as CSS attribute-substring selectors) for fixture/canary probing only — it is not read by the migrated consumer, whose Strategy 2/3 logic is unchanged.',
      feature:
        'Patient UUID resolution — DOM fallback (used by Sentinel and the triage lens task-list/overview pipeline)',
      degradation:
        'on pages where URL-based UUID detection fails, the extension can no longer resolve which patient it is looking at — the whole data pipeline (chips, OIR, lab filing) falls back to "no patient resolved" rather than silently showing the wrong patient (fail-safe, but a real capability loss). This DOM fallback is only ever consulted when detectMedicusContext() (engine/api-client.js) cannot already resolve a patient/encounter/task id from the URL — the canary skips probing it on rounds where the URL already resolved one, since a FAIL there could never actually be reached (see contract-canary.js runProbeRound).',
      source: 'engine/api-client.js:100-134 (findPatientUuidFromDom)',
      pageMatch: null,
      anchor: 'a[href]',
      target: ['[data-patient-id]', '[data-patientid]', '[data-patient]', '[data-pid]'],
      legacy: [['a[href*="/care-record/"]', 'a[href*="/patient/"]']],
      runtime: true,
      mirrorOf: null,
    },
  ];

  // ── Lookup ────────────────────────────────────────────────────────────────
  function list() {
    return CONTRACTS.slice();
  }
  function get(id) {
    return CONTRACTS.find((c) => c.id === id) || null;
  }

  // Selector helpers a migrated consumer can use directly, e.g.
  //   var C = DomContracts.get('routine-rx.routing-control');
  //   findByText(C.target, text) || findByText(C.legacy[0], text)
  // Returns null when the id is unknown so a consumer can fail closed rather
  // than throw.
  function selectorsFor(id) {
    const c = get(id);
    if (!c) return null;
    return { anchor: c.anchor, target: c.target.slice(), legacy: c.legacy.map((tier) => tier.slice()) };
  }

  // ── Probe ─────────────────────────────────────────────────────────────────
  // root must expose querySelectorAll(selectorString) returning an array-like
  // with .length (a real DOM Element/Document in the browser; the fake-DOM
  // fixture root used by test-dom-contracts.js and, in Batch H2, the same
  // contract objects driving a real content-script canary).
  function countMatches(root, selector) {
    if (!root || !selector) return 0;
    try {
      const found = root.querySelectorAll(selector);
      return found ? found.length : 0;
    } catch (e) {
      return 0;
    }
  }

  const STATUS = { OK: 'ok', FAIL: 'fail', NOT_APPLICABLE: 'not_applicable' };

  // Probe a single contract against `root`. Never throws (a bad/missing
  // selector counts as 0 matches, per countMatches) — a probe failure must
  // never itself break the caller, exactly like shared/event-ledger.js's
  // storage APIs.
  function probeContract(contract, root) {
    if (!contract || typeof contract !== 'object') {
      return { id: null, status: STATUS.NOT_APPLICABLE, anchorCount: 0, targetCount: 0, legacyCounts: [] };
    }
    const anchorCount = countMatches(root, contract.anchor);
    if (anchorCount === 0) {
      return { id: contract.id, status: STATUS.NOT_APPLICABLE, anchorCount: 0, targetCount: 0, legacyCounts: [] };
    }
    const targetCount = (contract.target || []).reduce((sum, sel) => sum + countMatches(root, sel), 0);
    const legacyCounts = (contract.legacy || []).map((tier) =>
      tier.reduce((sum, sel) => sum + countMatches(root, sel), 0)
    );
    const satisfied = targetCount > 0 || legacyCounts.some((n) => n > 0);
    return {
      id: contract.id,
      status: satisfied ? STATUS.OK : STATUS.FAIL,
      anchorCount,
      targetCount,
      legacyCounts,
    };
  }

  function probeAll(root, contracts) {
    return (contracts || CONTRACTS).map((c) => probeContract(c, root));
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const api = {
    CONTRACTS,
    list,
    get,
    selectorsFor,
    probeContract,
    probeAll,
    countMatches,
    STATUS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.DomContracts = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
