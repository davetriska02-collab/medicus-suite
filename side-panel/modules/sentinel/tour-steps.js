// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — guided tour step definitions (DATA ONLY — no logic here)
//
// Editing rules (see .claude/skills/update-tour/SKILL.md):
//   - Bump TOUR_VERSION whenever steps are added or materially reworded.
//   - New steps get `addedIn: <new TOUR_VERSION>` so users who completed an
//     earlier tour get a short "What's new" pass showing only the new steps.
//   - `target` is a CSS selector (or array of fallback selectors, first visible
//     match wins). Steps whose target is absent are skipped silently — most
//     anchors only exist when a patient record is open, and that's fine.
//   - `center: true` steps show a centred card with no spotlight (intro/outro).
//   - Voice: sans-serif human voice, sentence case, ≤ 2 sentences per body.

'use strict';

export const TOUR_VERSION = 1;

export const TOUR_STEPS = [
  {
    id: 'welcome',
    addedIn: 1,
    center: true,
    title: 'Welcome to Clinical Monitoring',
    body: 'A quick tour of what this panel watches and where the actions live — about 30 seconds. Replay it any time from the ⋯ menu in the header.',
  },
  {
    id: 'waiting-room',
    addedIn: 1,
    target: ['.wr-pinned', '#wrStrip'],
    title: 'Waiting room, live',
    body: 'Patients arrived and waiting right now, refreshed every 30 seconds. Wait times turn amber at 10 minutes and red at 20.',
  },
  {
    id: 'brief',
    addedIn: 1,
    target: ['.sent-brief-card'],
    title: 'The pre-consultation brief',
    body: 'A risk-ranked glance before you call the patient in: red chips need action, amber are due soon. Click the bar to collapse or expand it.',
  },
  {
    id: 'verify',
    addedIn: 1,
    target: ['#sentVerifyBannerBtn'],
    title: 'Verify before acting',
    body: 'This panel is a memory aid, not the record. Verify in Medicus focuses the source tab so you can check the live record before acting on any alert.',
  },
  {
    id: 'unmatched-meds',
    addedIn: 1,
    target: ['.sent-unmatched-section'],
    title: 'Meds without a monitoring rule',
    body: 'Most medicines need no routine monitoring. Scan this list for brand names that should have matched a rule but didn’t — and report any you spot.',
  },
  {
    id: 'toolbar',
    addedIn: 1,
    target: ['.sent-toolbar'],
    title: 'Actions live up here',
    body: 'Appointments needed, copy-ready actions and the printable patient summary are in the header now. Rarer tools — settings, evaluation log export — are under ⋯.',
  },
  {
    id: 'finish',
    addedIn: 1,
    center: true,
    title: 'That’s the essentials',
    body: 'Click any chip to see its evidence and why it fired. Replay this tour from the ⋯ menu, or from Options → Suite.',
  },
];
