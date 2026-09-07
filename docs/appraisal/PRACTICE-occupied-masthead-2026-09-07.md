# Occupied request strip — synthetic panel + design-crit

**Date:** 2026-09-07 · shipped v3.261.1
**Surface:** in-page occupied masthead (`#ms-tp-banner`) on a Medicus patient-request overview
**Caveat:** this is a synthetic 5-GP panel plus an art-director/token crit. It is not real user research.

## Panel (GPs only)

| Handle | Band | Ease /10 (their score) | Biggest ask |
|---|---|---|---|
| Dr Margaret Aldous | technophobe | (hallucinated UI — overruled) | — |
| Dr Tom Hollis | pragmatist | 6 | Name, how long, drop lawyer copy |
| Dr Sam Okonkwo | locum / pragmatist | 4 | English: working it vs you can still take it |
| Dr Priya Nair | registrar / savvy | 6 | Never show a nameless colleague; bar vs red chip |
| Dr Geoff Pellew | power user | 6 | Only assert live heartbeat + a real name |

Fresh-eyes and Margaret described a START button that is not on this surface; those returns were overruled as screenshot hallucination.

## Adopted

- One-line instrument strip (not a two-line Slack huddle)
- Headline `--text-1` 12/600; amber spent on rail + LIVE token, not the sentence
- Native presence note is **Live** (Pusher membership now), never a fake “Opened N min ago”
- “Not a lock” in `--text-3`, no “advisory”
- Unnamed identity: “Someone else” + `?`, not a rainbow help-blue disc
- Fail-closed: no self id → no bar; wrong task → no bar; queue presence channel is not per-request; identity stamp lag replays last event

## Overruled

- Do not lock the request (safety: a stale lock delays care)
- Do not delete the bar
- Do not move it below clinical chips (Vue prepend-into-`<main>` is the slot that survives re-render)
- Do not add ping/take-over in this pass (feature gap)

## Reverse a judgement

- Restore two-line banner: revert `#ms-tp-banner` flex to column in `content-scripts/task-presence.css`
- Restore “Opened N min ago” for native: `occupiedNote()` native branch
