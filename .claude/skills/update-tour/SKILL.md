---
name: update-tour
description: Keep the suite's guided walkthrough current with the UI. On each build/release (or whenever side-panel UI changed), diffs the UI since the last tour version bump, updates side-panel/tour/tour-steps.js, verifies every step's anchor selector still exists in the rendered markup, and bumps TOUR_VERSION so returning users get a "What's new" pass. Use when the user says update the tour, check the tour, tour audit, or after merging UI changes to the side panel.
---

# Update the guided tour

The suite ships a spotlight walkthrough that greets first-run users in the
side panel and can switch tabs as it goes (engine: `side-panel/tour/tour.js`,
steps: `side-panel/tour/tour-steps.js`). Steps are **pure data** — keeping the
tour current is a data edit, never an engine change. This skill is the
maintenance procedure.

## How the tour maps to features

| Step `id` | `module` | Anchor selector(s) | Feature it teaches |
|---|---|---|---|
| `welcome` | — | — (`center: true`) | Orientation / replay affordance |
| `nav-tabs` | — | `.nav-tabs` | Module tabs + drag-to-reorder (`panel.html`) |
| `alert-strips` | — | `#wrStrip`, `#rmStrip`, `#subRagStrip` (`centerFallback`) | Global alert strips (hidden unless firing — hence the fallback) |
| `today` | `today` | `.today-module` | Morning command centre (waiting room, triage, demand, slots, sweep) |
| `slots` | `slots` | `#suiteContent .module-wrap` | Live slot counts |
| `monitoring-intro` | `sentinel` | `.sent-header` | Sentinel chips concept |
| `waiting-room` | `sentinel` | `.wr-pinned`, `#wrStrip` | Live waiting-room block (`renderWaitingRoomBlock()`) |
| `brief` | `sentinel` | `.sent-brief-card` | Pre-consultation brief (`renderBriefCard()` → `#sentBriefSlot`) |
| `actions` | `sentinel` | `.sent-actionbar` | Labelled patient-action bar under the brief (`scaffoldHtml()`) |
| `verify` | `sentinel` | `#sentVerifyBannerBtn` | Verify-in-Medicus (H-007 anti-automation-bias) |
| `unmatched-meds` | `sentinel` | `.sent-unmatched-section` | Meds without a monitoring rule (silent-miss safety net) |
| `palette` | — | `#paletteBtn` | Command palette (Ctrl+K) |
| `display` | — | `#displayBtn` | Theme/size/colour-blind settings |
| `popout` | — | `#popoutBtn` | Floating window |
| `settings` | — | `#settingsBtn` | Options page + backups |
| `finish` | — | — (`center: true`) | Replay paths |

Engine contract (enforced by `tour.js`):

- `TOUR_VERSION` is an integer. The user's last completed version is stored in
  `localStorage['suite.tour.seenVersion']` (shared across extension pages;
  Options › Suite › "Show the tour again" deletes it).
- Every step has `addedIn: <version>`. When `TOUR_VERSION` > seen version, the
  engine runs a **"What's new" pass of only the steps with
  `addedIn > seenVersion`** — so tagging `addedIn` correctly is what makes
  release announcements work. Re-tag an *existing* step to the new version
  only when its feature moved or changed enough that returning users should
  see it again.
- `module` names the tab a step lives on; the engine activates it (via the
  loader hook from `panel.js` / `pop-out.js`) and waits up to 2.5s for the
  target to render.
- Steps whose selector resolves to nothing are skipped silently — unless
  `centerFallback: true`, which shows a centred card instead (use for anchors
  that legitimately may not exist: alert strips, patient-data sections). A
  *permanently* dead selector is still a bug — step 3 below catches it.
- Auto-start happens once per first run, from `panel.js` only; the pop-out is
  replay-only.

## Procedure

> **CI backstop:** `test-tour-steps.js` runs in the normal test suite and
> fails the build when (a) a step's selector token is no longer rendered by
> any JS/HTML source, (b) a new `data-module` tab exists in `panel.html` that
> is neither taught by a step nor consciously listed in its
> `NAV_COVERED_BY_OVERVIEW` set, or (c) step structure/`addedIn` tags are
> malformed. So UI changes that outrun the tour surface as red CI on the PR
> that ships them — this skill is the procedure you run to make that green
> again (or proactively, before it ever goes red).

### 1. Find what changed since the last tour bump

```
git log -1 --format=%H -- side-panel/tour/tour-steps.js
git diff <that-commit>..HEAD --stat -- side-panel/ pop-out/ shared/chip-renderer.js
```

Read the CHANGELOG entries since that commit too. You are looking for:
**new user-facing features** in the side panel (new tabs, buttons, cards,
strips, sections), **renamed/moved actions**, and **removed features** a step
still describes.

### 2. Update the steps (data edit only)

- New feature worth teaching → add a step with `addedIn: <TOUR_VERSION + 1>`,
  a `target` selector (prefer a stable id like `#sentVerifyBannerBtn`, else a
  component root class like `.sent-brief-card`; supply fallbacks as an array),
  `module` if it lives on a tab, and a ≤2-sentence body in sentence case.
- Reworded/moved feature → edit the existing step in place; re-tag `addedIn`
  only if returning users should see it again.
- Removed feature → delete its step.
- Keep the suite pass ≤ ~14 steps and each module's deep-dive ≤ 5. If adding
  one would exceed that, fold or drop the weakest step — a tour nobody
  finishes teaches nothing.

### 3. Verify every anchor selector still exists (non-negotiable)

For each `target` selector in `tour-steps.js`, confirm the class/id is still
emitted by the source that renders it:

```
grep -rn "sent-actionbar\|sent-brief-card\|sentVerifyBannerBtn\|sent-unmatched-section\|wr-pinned\|wrStrip\|rmStrip\|subRagStrip\|displayBtn\|popoutBtn\|settingsBtn\|nav-tabs\|sent-header" \
  side-panel/ pop-out/ shared/chip-renderer.js
```

Each selector must hit a **JS template/HTML file that renders it** (a hit only
in CSS does not count — the rule may be dead). If a selector is gone, fix the
step, don't delete the verification. Then render it for real: run
`node .claude/skills/ui-design/screenshot.mjs` and check the panel screenshot
still shows the always-present anchors (nav, header buttons, the Monitoring
action bar).

### 4. Bump the version

- Increment `TOUR_VERSION` in `tour-steps.js` **only if** steps were added or
  materially changed (a typo fix doesn't warrant re-showing the tour), and
  append a line to the version-history comment at the top of that file.
- Per `CLAUDE.md`: bump `manifest.json` (patch) and add a CHANGELOG entry
  naming the new/changed steps.

### 5. Sanity checks before committing

- `node test-tour-steps.js` — the staleness guard (structure, selector
  tokens, nav coverage). If you added a module step, remove that module from
  `NAV_COVERED_BY_OVERVIEW`; if a new tab is deliberately overview-only, add
  it there with the others.
- `npx eslint side-panel/tour/ test-tour-steps.js`
- `npm test` (the tour is data-only; other failures mean you strayed elsewhere)
- Every step has `id`, `addedIn`, `title`, `body`, and either `target` or
  `center: true`. No step body over 2 sentences. No ALL-CAPS labels.

## Practice-pushed deployments (shared-folder updates)

Most users receive updates as a practice-pushed overwrite of a shared
unpacked-extension folder, not an individual install. The tour is designed
for that:

- **No install hooks needed.** `suite.tour.seenVersion` lives in the browser
  profile's localStorage. A profile that has never seen the tour (genuinely
  new user, new machine) gets the **full** walkthrough on first panel open; a
  profile that completed version N gets a **"What's new"** pass only when
  `TOUR_VERSION` > N. A folder push by itself triggers nothing.
- **Bumping `TOUR_VERSION` is therefore a release decision**: bump it when a
  push carries user-facing features worth announcing, leave it alone for
  fixes — that keeps routine pushes silent instead of nagging a whole
  practice.
- **Deployment caveat to relay to whoever runs the push:** an unpacked
  extension's ID is derived from its folder path. Pushing to a *new* path
  (e.g. versioned folders) changes the ID and resets ALL extension state —
  chrome.storage config, not just the tour. Overwrite the same path.
- **Shared Chrome profiles** (hot-desking on a generic login) see the tour
  once per profile, not per person. Colleagues who missed it can replay from
  Options → Suite or the Monitoring **More** menu — worth a line in any
  practice rollout note.

## What NOT to do

- Don't put logic, selectors-with-JS, or chrome API calls in
  `tour-steps.js` — it must stay importable as inert data.
- Don't change the localStorage key (`suite.tour.seenVersion`) — Options'
  reset button and the engine both pin it.
- Don't make modules stop the tour in their `cleanup()` — the walkthrough
  switches tabs itself, and a module teardown must not kill it.
- Don't auto-start from anywhere except `panel.js` (the pop-out and module
  ⋯ menus are replay-only).
- Don't lower `TOUR_VERSION` — seen-version comparisons are monotonic.
