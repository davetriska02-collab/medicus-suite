// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — guided tour step definitions (DATA ONLY — no logic here)
//
// Editing rules (see .claude/skills/update-tour/SKILL.md):
//   - Bump TOUR_VERSION whenever steps are added or materially reworked.
//   - New steps get `addedIn: <new TOUR_VERSION>` so users who completed an
//     earlier tour get a short "What's new" pass showing only the new steps.
//   - `module` names the side-panel tab the step lives on; the engine
//     activates it before resolving the target. Shell-chrome steps (nav,
//     strips, header buttons) need no module.
//   - `target` is a CSS selector (or array of fallback selectors, first
//     visible match wins). Steps whose target is absent are skipped silently,
//     unless `centerFallback: true` shows them as a centred card instead —
//     use that for anchors that only exist conditionally (alert strips,
//     patient-data sections).
//   - `center: true` steps are always centred cards (intro/outro).
//   - Voice: sans-serif human voice, sentence case, ≤ 2 sentences per body.
//
// Version history:
//   1 — Monitoring-panel-only tour (v3.57.0)
//   2 — Suite-wide walkthrough on first install; Monitoring action bar
//       relocated under the pre-consultation brief (v3.58.0)
//   3 — Command palette (Ctrl+K) step (v3.59.0)
//   4 — Today tab — morning command centre (v3.60.0)
//   5 — Record tab — live-first patient record
//   6 — Today "what needs you now" headline; Sentinel rule-coverage
//       drill-down (v3.144.0)
//   7 — Record Pre-flight (what-if safety preview) (v3.145.0). Condor Pulse
//       and Options → Event Ledger deliberately not taught: the 20-step cap
//       was reached, Condor stays overview-only (nav-tabs step) as before,
//       and the tour only covers the side panel, not the Options page.
//   8 — Leaflets tab — NHS patient information search (bundled A-Z + optional
//       in-panel API rendering) (v3.147.0). To stay within the 20-step cap,
//       'display' and 'popout' were consolidated into one 'header-controls'
//       step (same content, one fewer step) — no user-visible step was
//       dropped.
//   9 — 'monitoring-intro' body extended to mention panel auto-follow and the
//       clickable "N unmatched" audit count (help-text pass — both were
//       already shipped, just hard to find). No step added or removed (still
//       20 steps); the existing step's addedIn was retagged 2 → 9 so the
//       reworked copy reaches returning users via the "What's new" pass.
//  10 — 'header-controls' extended to lead with the new quick-leaflet header
//       button (v3.154.0 — shipped for mid-triage use and immediately missed
//       by its own requester, so it earns the what's-new spotlight). Same
//       consolidation pattern as 9: no step added or removed (still 20
//       steps); addedIn retagged 2 → 10 so returning users get shown.
//  11 — 'alert-strips' reworked to teach the new Patient Alerts flag strip
//       (v3.175.0 — per-patient practice flags; #paStrip added to the
//       target fallbacks). 20-step cap still reached, so the Pt Alerts tab
//       itself stays overview-only (recorded in test-tour-steps.js
//       NAV_COVERED_BY_OVERVIEW); addedIn retagged 2 → 11 so returning
//       users get shown the reworked strip step.

'use strict';

export const TOUR_VERSION = 11;

export const TOUR_STEPS = [
  {
    id: 'welcome',
    addedIn: 2,
    center: true,
    title: 'Welcome to Medicus Suite',
    body: 'A one-minute walkthrough of the suite. Use the buttons or arrow keys; skip any time — you can replay it later from Options → Suite.',
  },
  {
    id: 'nav-tabs',
    addedIn: 2,
    target: ['.nav-tabs'],
    title: 'Every module is a tab',
    body: 'Slots, Monitoring, Trends, Reception, Sweep and more. Drag tabs to reorder them — your order syncs to the floating pop-out window too.',
  },
  {
    id: 'alert-strips',
    // Reworked in v11 to teach the Patient Alerts flag strip (per-patient
    // practice flags, Pt Alerts tab) — retagged 2 → 11 so returning users see
    // the new content in their "What's new" pass.
    addedIn: 11,
    target: ['#wrStrip', '#rmStrip', '#subRagStrip', '#paStrip'],
    centerFallback: true,
    title: 'Global alert strips',
    body: 'When patients wait, queues build, demand thresholds trip — or the open patient carries one of your practice’s own flags (interpreter needed, safeguarding; set them in Pt Alerts) — a strip appears under the tab bar, on every tab.',
  },
  {
    id: 'today',
    addedIn: 4,
    module: 'today',
    target: ['.today-module'],
    title: 'Today — your morning at a glance',
    body: 'One screen shows waiting patients, triage load, demand counts, available slots and the pre-clinic sweep result so you can start clinic fully briefed.',
  },
  {
    id: 'today-headline',
    addedIn: 6,
    module: 'today',
    target: ['.today-headline'],
    title: 'One line: what needs you now',
    body: 'A plain-English summary of the cards below — worst thing first, quiet when nothing is outstanding — always stamped with when it was last checked.',
  },
  {
    id: 'slots',
    addedIn: 2,
    module: 'slots',
    target: ['#suiteContent .module-wrap'],
    title: 'Slots — capacity at a glance',
    body: 'Live appointment-slot counts by type for any date, updating in real time while a Medicus tab is open.',
  },
  {
    id: 'monitoring-intro',
    // Body materially reworked in v9 (auto-follow + clickable unmatched count),
    // so retagged to 9 rather than left at its original 2 — returning users get
    // this step in their "What's new" pass instead of it silently changing
    // under them. See TOUR_VERSION history above.
    addedIn: 9,
    module: 'sentinel',
    target: ['.sent-header'],
    title: 'Monitoring — the clinical core',
    body: 'Sentinel auto-follows the patient open in Medicus, showing drug-monitoring, QOF and vaccine status as colour-ranked chips — red needs action, click any chip for its evidence. The "N unmatched" audit count is clickable to name the medicines.',
  },
  {
    id: 'rule-coverage',
    addedIn: 6,
    module: 'sentinel',
    target: ['#sentRulesToggle'],
    centerFallback: true,
    title: 'What the monitoring rules actually cover',
    body: 'Click the rule-currency line to expand every drug and QOF rule with the terms it matches — so you can check a specific drug is covered, not just that rules exist.',
  },
  {
    id: 'waiting-room',
    addedIn: 1,
    module: 'sentinel',
    target: ['.wr-pinned', '#wrStrip'],
    title: 'Waiting room, live',
    body: 'Patients arrived and waiting right now, refreshed every 30 seconds. Wait times turn amber at 10 minutes and red at 20.',
  },
  {
    id: 'brief',
    addedIn: 1,
    module: 'sentinel',
    target: ['.sent-brief-card'],
    centerFallback: true,
    title: 'The pre-consultation brief',
    body: 'A risk-ranked glance before you call the patient in: red chips need action, amber are due soon. Click the bar to collapse or expand it.',
  },
  {
    id: 'actions',
    addedIn: 2,
    module: 'sentinel',
    target: ['.sent-actionbar'],
    centerFallback: true,
    title: 'Patient actions, right under the brief',
    body: 'Appointments needed, copy-ready actions and the printable patient summary sit here; rarer tools — settings, evaluation log export, this tour — are under More.',
  },
  {
    id: 'verify',
    addedIn: 1,
    module: 'sentinel',
    target: ['#sentVerifyBannerBtn'],
    centerFallback: true,
    title: 'Verify before acting',
    body: 'This panel is a memory aid, not the record. Verify in Medicus focuses the source tab so you can check the live record before acting on any alert.',
  },
  {
    id: 'unmatched-meds',
    addedIn: 1,
    module: 'sentinel',
    target: ['.sent-unmatched-section'],
    centerFallback: true,
    title: 'Meds without a monitoring rule',
    body: 'Most medicines need no routine monitoring. Scan this list for brand names that should have matched a rule but didn’t — and report any you spot.',
  },
  {
    id: 'palette',
    addedIn: 3,
    target: ['#paletteBtn'],
    title: 'One keystroke to anywhere',
    body: 'Press Ctrl+K (or click here) for the command palette: jump to any tab, change theme or text size, open the right settings section, or replay this tour.',
  },
  {
    id: 'header-controls',
    addedIn: 10,
    target: ['#quickLeafletBtn', '#displayBtn', '#popoutBtn'],
    title: 'Quick leaflets, themes, pop-out',
    body: 'The open-book button finds an NHS patient leaflet from any tab — type, Enter, done (built for mid-triage). Next to it: light/dark theme, text sizes, and a floating pop-out window for a second screen.',
  },
  {
    id: 'settings',
    addedIn: 2,
    target: ['#settingsBtn'],
    title: 'Settings and backups',
    body: 'Practice code, per-module options, and full-suite backup and restore live in the settings page.',
  },
  {
    id: 'record',
    addedIn: 5,
    module: 'record',
    target: ['.rec-root'],
    title: 'Record — the open patient, live',
    body: 'A live snapshot of the patient open in Medicus — problems, medicines, results and safety prompts, no PDF needed. Incomplete by design (no allergies); read the gap-markers and verify the record. The full visualiser opens from the footer.',
  },
  {
    id: 'preflight',
    addedIn: 7,
    module: 'record',
    target: ['#recPreflight'],
    centerFallback: true,
    title: 'Pre-flight — check before you prescribe',
    body: 'Type a drug you’re considering to see how it would change ACB and STOPP/START, any new interactions with current meds, and what monitoring it would need — before it exists in the record. A decision aid, not advice.',
  },
  {
    id: 'leaflets',
    addedIn: 8,
    module: 'leaflets',
    target: ['.lf-module'],
    centerFallback: true,
    title: 'Leaflets — NHS patient information, fast',
    body: 'Search a condition or medicine to open or copy a link to its nhs.uk page — always works, no setup. Add an API key in Options → Leaflets to render the leaflet text right here.',
  },
  {
    id: 'finish',
    addedIn: 2,
    center: true,
    title: 'That’s the suite',
    body: 'Explore the remaining tabs at your own pace. Replay this walkthrough any time from Options → Suite, or the Monitoring panel’s More menu.',
  },
];
