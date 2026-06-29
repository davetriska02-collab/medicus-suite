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

'use strict';

export const TOUR_VERSION = 6;

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
    addedIn: 2,
    target: ['#wrStrip', '#rmStrip', '#subRagStrip'],
    centerFallback: true,
    title: 'Global alert strips',
    body: 'When patients are waiting, triage queues build, or demand thresholds trip, alert strips appear just under the tab bar — on every tab, so nothing is missed.',
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
    id: 'slots',
    addedIn: 2,
    module: 'slots',
    target: ['#suiteContent .module-wrap'],
    title: 'Slots — capacity at a glance',
    body: 'Live appointment-slot counts by type for any date, updating in real time while a Medicus tab is open.',
  },
  {
    id: 'monitoring-intro',
    addedIn: 2,
    module: 'sentinel',
    target: ['.sent-header'],
    title: 'Monitoring — the clinical core',
    body: 'Sentinel reads the open patient record and shows drug-monitoring, QOF and vaccine status as colour-ranked chips. Red needs action; click any chip for its evidence.',
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
    id: 'labfiling',
    addedIn: 6,
    module: 'labfiling',
    target: ['.lf-module'],
    centerFallback: true,
    title: 'Lab filing — file normal results in one click',
    body: 'Set up a profile for your lab, then when the suite confirms a result is all-normal a “File all normal” button appears in Medicus. It only ever files behind your confirmation — never automatically.',
  },
  {
    id: 'palette',
    addedIn: 3,
    target: ['#paletteBtn'],
    title: 'One keystroke to anywhere',
    body: 'Press Ctrl+K (or click here) for the command palette: jump to any tab, change theme or text size, open the right settings section, or replay this tour.',
  },
  {
    id: 'display',
    addedIn: 2,
    target: ['#displayBtn'],
    title: 'Make it yours',
    body: 'Light or dark theme, three text sizes, and a colour-blind-safe palette.',
  },
  {
    id: 'popout',
    addedIn: 2,
    target: ['#popoutBtn'],
    title: 'Pop out the panel',
    body: 'Open the suite in a floating window you can park on a second screen while Medicus fills this one.',
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
    id: 'finish',
    addedIn: 2,
    center: true,
    title: 'That’s the suite',
    body: 'Explore the remaining tabs at your own pace. Replay this walkthrough any time from Options → Suite, or the Monitoring panel’s More menu.',
  },
];
