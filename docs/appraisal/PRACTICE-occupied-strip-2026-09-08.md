# Occupied request strip — synthetic panel (2026-09-08)

**Surface:** `#ms-tp-banner` on a Medicus patient-request overview (v3.261.4)
**Caveat:** this is a synthetic 6-person panel plus a code review of main after PR #369/#370. It is not real user research. No quote here is a GP.

## Verdict

Not 9/10. Practice-lead score **7/10** on the primary path (one named colleague), **6/10** once unnamed and six-person states are included.

The strip now does the job a pragmatist needs: a name, a pulse, “has this open. You can still work it.”, Hide for now. Wipe/idle/dead-socket bugs from the v3.261.1 path are fixed. The host page is no longer restyled.

What holds the score down: Margaret still treats any occupancy notice as a reason to leave once the crowd or the nameless “A colleague” appears (6/10 for one name, 3/10 for a crowd). Chloe wants “Leave this for Dr Nair” (a lock). That stays overruled. Dual-tab same-UUID is not visible on live Pusher.

## Panel (ease /10)

| Handle | Band | Score | One line |
|---|---|---|---|
| Margaret Aldous | technophobe | 6 (1 name) / 3 (crowd) | Carries on for Priya; closes on “A colleague” or +3 |
| Tom Hollis | pragmatist | 8 | One glance is enough when the name is there |
| Sam Okonkwo | locum | 7 | Wants stale-tab vs typing; self-only silence is OK |
| Priya Nair | registrar | 8 | Hide-for-now still has no visible “until when” |
| Geoff Pellew | power user | 7 | Wants +3 expand and a freshness clock |
| Chloe Danvers | reception | 6 | Wants “leave it for them” (overruled) |

Earlier passes (LIVE / Not a lock / Here now / On it now) scored 4–8. Those words were dropped because they were misread as a lock, a webcast, or the patient arriving.

## Adopted

- One sentence, same weight: “X has this open. You can still work it.”
- Pulse pip only. No LIVE / Here now / On it now word.
- “A colleague”, never “Someone else”.
- Hide for now + title that it returns if the people change.
- Three names then “and N others”; +N avatar.
- Hairline banner, not a 4px halt rail on `<main>`.
- Known store name wins over empty native info. Dead socket hides the bar.
- Task-change wipe actually emits; idle emits once.

## Overruled

- Do not lock the request. Chloe’s 6 is the cost.
- Do not enable dual-tab self via `chrome.tabs`.
- Do not show a “just you” chip (would nag Margaret on every open).
- Do not invent opened-at. Membership has no timestamp.

## Addendum — queue title strip (v3.261.5)

The live queue showed Medicus’s own grey **GP** disc + “is also working this list”. The Suite now replaces that widget with a named peach pill (`Dr Priya Nair is also on this list. You can still work it.`) from `presence-{site}-task-list-{slug}`. List members are never treated as per-request occupants. Only-self restores the host widget.

Retargeted bar is an **average of 8/10**, not 9 per feature. Fresh 6-person scores on the named pill + request strip:

| Handle | Score |
|---|---|
| Margaret | 6 |
| Tom | 8 |
| Chloe | 7 |
| Sam | 7 |
| Priya | 8 |
| Geoff | 8 |

Mean **7.3**. Named peach was preferred to the GP disc by every persona. Not 8 yet: Margaret still wants a name every time (unnamed “A colleague” is a 3 for her); Chloe still wants a lock (overruled).

## Addendum — Note lead + note wash (v3.261.7)

Synthetic panel on fresh rig shots (`one-other-light`, `list-one`, `list-self-only`). Not user research.

`Looking:` was tried and dropped: Margaret and Sam read it as peeking, not as “this is a note”. The heading is now **Note:**. Peach/amber wash on the masthead and list pill was read as a halt; both now use the accent/note wash. Queue 👁 chips stay amber.

Host **GP is also working this list** on `list-self-only` and on the request-launcher (no list presence) is fail-closed restore of Medicus’s widget, not an unnamed Suite strip. Personas who scored that as our defect were overruled on the evidence.

| Handle | Score | One line |
|---|---|---|
| Margaret | 8 | Note: + cool wash; she would work a named request |
| Tom | 8 | One glance is enough |
| Chloe | 8 | Named + “You can still work it”; lock still overruled |
| Sam | 8 | Named path is enough at a new practice |
| Priya | 8 | Observational, not exclusive |
| Geoff | 8 | Same verb set on request and list; launcher no longer fights the strip |

Mean **8.0** on the named primary path. Unnamed “A colleague” stays a 3 for Margaret (fail-closed: no invented name). Chloe lock stays overruled.

Feature average with groups 8.0 is **8.0**.

## Reproduce

`node test-task-presence.js`. Rig: `/tmp/the-practice/rig/run.sh` (list states under `shots/list/`).
