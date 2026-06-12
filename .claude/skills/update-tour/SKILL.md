---
name: update-tour
description: Keep the Monitoring panel's guided tour current with the UI. On each build/release (or whenever panel UI changed), diffs the UI since the last tour version bump, updates side-panel/modules/sentinel/tour-steps.js, verifies every step's anchor selector still exists in the rendered markup, and bumps TOUR_VERSION so returning users get a "What's new" pass. Use when the user says update the tour, check the tour, tour audit, or after merging UI changes to the side panel.
---

# Update the guided tour

The Monitoring panel ships a spotlight tour (engine:
`side-panel/modules/sentinel/tour.js`, steps:
`side-panel/modules/sentinel/tour-steps.js`). Steps are **pure data** — keeping
the tour current is a data edit, never an engine change. This skill is the
maintenance procedure.

## How the tour maps to features

| Step `id` | Anchor selector(s) | Feature it teaches | Rendered by |
|---|---|---|---|
| `welcome` | — (`center: true`) | Orientation / replay affordance | — |
| `waiting-room` | `.wr-pinned`, `#wrStrip` | Live waiting-room block + global strip | `renderWaitingRoomBlock()` in `sentinel.js`; `panel.html` |
| `brief` | `.sent-brief-card` | Pre-consultation brief, red/amber counts | `renderBriefCard()` in `sentinel.js` |
| `verify` | `#sentVerifyBannerBtn` | Verify-in-Medicus (H-007 anti-automation-bias) | patient banner in `render()` |
| `unmatched-meds` | `.sent-unmatched-section` | Meds without a monitoring rule (silent-miss safety net) | `renderUnmatchedMedsSection()` |
| `toolbar` | `.sent-toolbar` | Header action toolbar + ⋯ overflow menu | `scaffoldHtml()` in `sentinel.js` |
| `finish` | — (`center: true`) | Chip evidence panels, replay paths | — |

Versioning contract (enforced by the engine):

- `TOUR_VERSION` is an integer. The user's last completed version is stored in
  `localStorage['suite.tour.seenVersion']` (shared across extension pages;
  Options › Suite › "Show the tour again" deletes it).
- Every step has `addedIn: <version>`. When `TOUR_VERSION` > seen version, the
  engine runs a **"What's new" pass of only the steps with
  `addedIn > seenVersion`** — so tagging `addedIn` correctly is what makes
  release announcements work.
- Steps whose selector resolves to nothing are skipped silently at runtime
  (most anchors need a patient record open). A *permanently* dead selector is
  still a bug — it means that step can never show. That's what step 3 below
  catches.

## Procedure

### 1. Find what changed since the last tour bump

```
git log -1 --format=%H -- side-panel/modules/sentinel/tour-steps.js
git diff <that-commit>..HEAD --stat -- side-panel/ pop-out/ shared/chip-renderer.js
```

Read the CHANGELOG entries since that commit too. You are looking for:
**new user-facing features** in the side panel (new buttons, cards, strips,
sections), **renamed/moved actions**, and **removed features** a step still
describes.

### 2. Update the steps (data edit only)

- New feature worth teaching → add a step with `addedIn: <TOUR_VERSION + 1>`,
  a `target` selector (prefer a stable id like `#sentVerifyBannerBtn`, else a
  component root class like `.sent-brief-card`; supply fallbacks as an array),
  and a ≤2-sentence body in sentence case, human voice.
- Reworded/moved feature → edit the existing step's `title`/`body`/`target`
  in place; only re-tag `addedIn` if you want returning users to see it again.
- Removed feature → delete its step.
- Keep the tour ≤ 8 steps. If adding one would exceed that, fold or drop the
  weakest step — a tour nobody finishes teaches nothing.

### 3. Verify every anchor selector still exists (non-negotiable)

For each `target` selector in `tour-steps.js`, confirm the class/id is still
emitted by the source that renders it:

```
grep -rn "sent-toolbar\|sent-brief-card\|sentVerifyBannerBtn\|sent-unmatched-section\|wr-pinned\|wrStrip" \
  side-panel/ pop-out/ shared/chip-renderer.js
```

Each selector must hit a **JS template/HTML file that renders it** (a hit only
in CSS does not count — the rule may be dead). If a selector is gone, fix the
step, don't delete the verification. Then render it for real: run
`node .claude/skills/ui-design/screenshot.mjs` and check the panel screenshot
still shows the always-present anchors (header toolbar, waiting-room slot).

### 4. Bump the version

- Increment `TOUR_VERSION` in `tour-steps.js` **only if** steps were added or
  materially changed (a typo fix doesn't warrant re-showing the tour).
- Per `CLAUDE.md`: bump `manifest.json` (patch) and add a CHANGELOG entry
  naming the new/changed steps.

### 5. Sanity checks before committing

- `npx eslint side-panel/modules/sentinel/tour-steps.js`
- `npm test` (the tour is data-only; failures mean you strayed elsewhere)
- Every step has `id`, `addedIn`, `title`, `body`, and either `target` or
  `center: true`. No step body over 2 sentences. No ALL-CAPS labels.

## What NOT to do

- Don't put logic, selectors-with-JS, or chrome API calls in
  `tour-steps.js` — it must stay importable as inert data.
- Don't change the localStorage key (`suite.tour.seenVersion`) — Options'
  reset button and the engine both pin it.
- Don't add steps for features outside the Monitoring panel; the tour runs
  inside the sentinel module's lifecycle.
- Don't lower `TOUR_VERSION` — seen-version comparisons are monotonic.
