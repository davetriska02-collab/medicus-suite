# The Practice — Note display board (rerun after v3.249.0)

**Date:** 2026-08-29 · **Scope:** Note companion tab
(`side-panel/modules/board/`) and the full-tab kiosk (`board.html`) after
the first-pass adopted items landed in v3.249.0.
**Lens:** features, UX, ease of use; red-team overlay (misread, rumour,
dignity, PII, fail-closed). Same 20 personalities as
`docs/appraisal/PRACTICE-note-2026-08-29.md`.
**Bar:** intrinsic usability (not a competitor gauntlet).
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona
(`.claude/skills/the-practice/PERSONAS.md` plus the same ten invented
patients). Heuristic device only. This is not real user research and
must never be quoted as a real clinician's or patient's view.

**Shots:** `/tmp/the-practice/note-rerun/` (copied to
`/opt/cursor/artifacts/the-practice/note-rerun/`). Companion cold-start
(setup not dismissed), waiting light / dark / colourblind, Ops scrolled
to the staff warning, kiosk Waiting room / Ops / Message at 1080p,
Waiting room at 720p, kiosk live-fail with a chrome shim and no demo.

**Product under review:** v3.249.0 on `cursor/note-practice-fixes-fd60`.
The first-pass adopted items are in the product. This write-up is
report-only.

## Verdict

Closer to best-of-type, not there yet for every user. The thing
carrying it is that the **public board no longer narrates the
practice**: twenty synthetic people hunted for medical/admin request
counts on the waiting-room TV and found none, and a dead feed now looks
broken instead of quietly empty. H-067 still held on every painted
frame (no names, initials, or visit reasons). The thing holding it
back is residual, not the old blockers: the wait band is still
quoteable from the back row because "Not a promise for you" is too
small, and Ops on a public wall is still the dignity incident if
someone ignores the confirm. The technophobe floor moved from 3 to 6.
That is a different product from this morning.

## The panel

Same cast. First-pass scores in brackets.

| # | Persona (synthetic) | Role / band | Score /10 | Was |
|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner, technophobe | 6 | 3 |
| 2 | Maureen Castle | Medical secretary, technophobe | 8 | 3 |
| 3 | Sister Eileen Cobb | Practice nurse, reluctant | 7 | 5 |
| 4 | Chloe Danvers | Receptionist, savvy-consumer / low clinical | 8 | 6.5 |
| 5 | Dr Tom Hollis | Salaried GP, pragmatist | 7 clinic / 4 wall (6 overall) | 3 / 6 |
| 6 | Dr Sam Okonkwo | Locum GP, pragmatist | 8 | 5 |
| 7 | Dr Priya Nair | GP registrar, savvy | 6 | 5 |
| 8 | Janet Briggs | Practice manager, reluctant-but-capable | 7 | 4 |
| 9 | Raj Patel | Clinical pharmacist, savvy + domain | 7 | 4 |
| 10 | Dr Geoff Pellew | Partner / tinkerer, savvy | 8 | 5 |
| P1 | Elsie Ward, 81 | Patient, bifocals, treats times as promises | 6 (2 if Ops on the wall) | 6 / 2 |
| P2 | Jordan Blake, 17 | Patient, first visit alone, anxious | 8 (3 if Ops) | 5 |
| P3 | Amira Hassan, 34 | Patient, English second language | 8 | 6 |
| P4 | David Chen, 45 | Patient, deuteranopia | 6 | 7 |
| P5 | Patrice Okeke, 52 | Patient, wheelchair, back row | 7 | 6 |
| P6 | Liam O'Connor, 8 + mum | Patient + parent | 8 public / 3 Ops | 8 / 3 |
| P7 | Sandra Miles, 68 | Patient, scans for names | 7 public / 3 Ops | 6 / 2 |
| P8 | Tom Reid, 29 | Patient, booked online | 7 public / 2 Ops | 4 |
| P9 | Grace Nwosu, 41 | Patient, toddler, one glance | 7 | 7 |
| P10 | Harold Finch, 76 | Patient, distrusts screens | 6 | 3 |

Staff spread: 6 to 8. The floor no longer fails. The middle is "I would
put the waiting-room board up." Patient spread on the proper
Waiting-room profile: 6 to 8. The floor holds if you accept that Elsie
will still quote a wait band. Ops on a public TV still drops every
patient who saw it to 2–3.

## What the first pass asked for, and what this run saw

Verified against the v3.249.0 code and these pixels, not against
persona memory.

| First-pass finding | Ruling then | This run |
|---|---|---|
| Public ticker announces medical/admin counts | ADOPT blocker | **Closed.** Tom Reid (synthetic) said the 28 is gone. Elsie, Liam's mum, Chloe, Raj: same. Ticker is "4 people waiting / Most waits are under 10 minutes / This room is steady." `buildTickerLines` keeps demand lines inside `audience === 'staff'`. |
| Dead feed looks like a quiet surgery | ADOPT blocker | **Closed.** Live-fail is a full-face "This board is not updating / Please ask reception." Harold (synthetic) called it the first honest line. Raj would defend it in an SEA. No 0 / Quiet / No one waiting. |
| "Typical wait under 10 minutes" as a promise | ADOPT major | **Partly closed.** Copy is now "Most waits are under 10 minutes" plus "Not a promise for you." Tom Hollis and Elsie still quote the minutes. Patrice can read the band from the back and still cannot read the caveat. Wording landed. Caveat size did not. |
| Public Steady vs Ops Busy at the same clock | ADOPT major (caption, do not merge) | **Closed enough for Janet.** Public tile is "This room / Steady." Staff is "How busy we are / Busy / Includes today's requests." Janet (synthetic) said she can defend both. Do not merge the formulas. |
| Three launch buttons | ADAPT major | **Closed.** One primary: "Open this profile on a TV tab." Maureen no longer thinks it means her laptop. |
| Get set up buries Note | ADOPT major | **Closed.** Cold-start strip: "Setup can wait. The TV board is below." Margaret did not close the tab. Sam found the board. |
| The word Tempo | ADOPT major | **Closed.** Public tile "This room." Companion checkbox "How busy we are." Amira no longer thinks it is music. |
| Wait band too small / ticker too fast | ADAPT major | **Mostly closed.** Patrice: the wait line is now big enough from the back. The ticker is still a smear. The caveat is the leftover. |
| Geoff "no keyboard" | OVERRULE | **Still overruled.** Keys 1/2/3, F, D exist. Geoff asked for a `?` overlay as a want. |
| Ops on a public TV | ADOPT major | **Controls landed, residual remains.** Companion confirms before `openBoardTab('ops')`. Key 2 and the profile `<select>` confirm. Public audience hides the profile picker. Patients who saw the Ops shot still treat "1 urgent" as a person. Confirm is a dialog, so it is not in the stills. Priya (synthetic) could not see it and scored the footgun as still open. Code has the confirm. |
| Pressure 42 twins Requests 42 | ADOPT major | **Closed enough for Janet.** Tile is "Pressure index" plus AMBER. She still will not quote 42 until she has one sentence for what the index is. Demo coincidence of 42 === 42 remains. |
| Flap box can take a name | ADAPT major | **Closed as specified.** Companion: "Do not type patient names. This text goes on a public TV." Raj wants a hard block. That was optional then and is still a judgement call. |
| Demo button labelled the next action | ADAPT minor | **Closed, with a leftover.** Button says "Showing demo" / "Showing live." On the fail board, "Showing live" sits next to "not updating." Harold and Priya both tripped on that. |

## Findings by bucket

### Universal friction

1. **[ADAPT · major · patients + Tom Hollis]** The wait band is still
   quoteable from a chair. Elsie (synthetic) still treats "under 10
   minutes" as "in by ten to four." Tom Hollis still expects it in
   room 3. Patrice can now read the band from the back and still
   cannot read "Not a promise for you." Verified: the caveat is
   `.note-tile-s-caveat`, smaller and muted; the ticker repeats the
   band and never the caveat (`board/board.js`, `buildTickerLines`).
   Fix: make the caveat count-adjacent (same weight as the band), or
   drop the minutes from the ticker. Do not show a named wait. Do not
   quiet the tone bar. Do not delete the band (judgement call from
   pass 1 still stands).

2. **[ADAPT · minor · Priya + Harold + Tom Hollis]** Fail-loud chrome
   still says "Showing live." Verified: `syncDemoBtn` labels the mode,
   not the health of the feed (`board/board.js`). The fail face is the
   control. The chip fights it. Fix: when `publicFeedFailed()`, label
   the button "Live figures failed" or hide it. Do not put stale
   counts back.

### The tech-literacy gradient

3. **[ADAPT · minor · Margaret + Maureen]** "Drag that tab onto the
   TV, then press F" is still the last step they cannot do alone.
   Margaret would fetch the practice manager. Maureen asked for the
   HDMI steps in big English. This is TV reality (Chrome on a PC),
   not a missing button. Fix: one more sentence under the opener
   ("You need a computer plugged into that TV. The tab will not jump
   there by itself."). Do not invent a pairing code.

4. **[ADAPT · minor · Ops companion]** The flap warning always says
   "This text goes on a public TV," even when STAFF ROOM is selected
   (Sam, Eileen, Janet, Priya, Raj, Geoff). Verified: one string in
   `side-panel/modules/board/board.js`. Fix: staff profile says "This
   text goes on the staff-room board." Keep the no-names line on both.

### Role-specific needs

5. **[OVERRULE · reason recorded]** Hard-block names in the flap box
   (Raj) and hard-block Ops from opening on a public TV (Chloe,
   Eileen, Raj). Confirm plus chrome-lock plus the peach box is what
   pass 1 adopted. A PIN or a name regex is the judgement call from
   pass 1. Reverse with: PIN on staff profiles, or a weak name
   warning. Not a missing-control defect on this rerun.

6. **[ADAPT · minor · Janet + Tom Hollis]** Pressure index is labelled
   and still unexplained. Janet will not quote 42. Tom thinks it twins
   Requests today because the demo fixture is 42 and 42. Verified:
   coincidence of the canned PPI, not the same input
   (`condor-index-core.js`). Fix: one caption, "Weighted index, not
   today's request count." Do not hide the number.

### Standout strengths

- **No names, initials, or visit reasons on any painted frame.**
  Twenty synthetic people hunted again. H-067 held on pixels.
- **Public ticker no longer announces request volume.** Tom Reid
  (synthetic) would not text "28 ahead" from the proper TV.
- **Dead feed fails loud.** Harold's score moved 3 to 6 on that
  screen alone.
- **One opener + PUBLIC TV / STAFF ROOM.** Maureen 3 to 8. Sam found
  Note on cold start.
- **Tempo is gone as a word.** Amira 6 to 8.
- **Janet can defend Steady versus Busy** without merging the
  formulas.
- **Flap sentence + clock** still carry the back row (Grace, Patrice,
  Liam).

## Prioritised path to best-of-type

Leftovers only. The first-pass blockers are closed.

| # | Fix | Size | Unblocks |
|---|---|---|---|
| 1 | Wait caveat at band weight, and/or keep minutes off the ticker | S | Elsie, Tom Hollis, Patrice |
| 2 | Fail-loud chrome: do not say "Showing live" | S | Harold, Priya, Tom Hollis |
| 3 | Staff flap warning names the staff room | S | Sam, Eileen, Janet |
| 4 | One HDMI sentence under the opener | S | Margaret, Maureen |
| 5 | Pressure index caption (not the request count) | S | Janet, Tom Hollis |

Feature gaps still not this pass: fourth profile, threshold editor,
`?` overlay, name regex, PIN on Ops.

## Judgement calls

Unchanged from pass 1. Flagged so they can still be reversed.

1. **Keep the split-flap look.** Harold still calls it a toy. Liam
   still likes it. Reverse: flat sans-serif kiosk.
2. **Keep three shipped profiles.** Reverse: clone-profile control.
3. **Keep public tempo ignoring request volume.** Janet can now
   defend the split. Reverse: one tempo everywhere, and accept the
   public-TV Busy lie.
4. **Do not delete the ticker.** It no longer carries request
   volume. Reverse: no ticker on public.
5. **Do not add a PIN on Ops** unless a practice asks. Confirm plus
   chrome-lock shipped. Reverse: PIN / passcode on staff profiles.
6. **Do not remove "Please take a seat."** Patrice still understood
   it from a wheelchair. Reverse: "We will call you" only.
7. **Do not delete the wait band.** Elsie will quote minutes until
   the caveat is as large as the band. Killing the minutes is a
   different product. Reverse: occupancy count only, no minutes.

## Reproduce

```text
node  (design-crit harness + Playwright, Chrome
      /home/ubuntu/.cache/ms-playwright/chromium-1234/...)
out   /tmp/the-practice/note-rerun/
pages board.html?demo=1#waiting-room|ops|message
      board.html#waiting-room          (chrome shim, live-fail)
      side-panel/panel.html            (panel.activeModule=board;
                                        cold-start has no suite.setup.dismissedAt)
cast  PERSONAS.md 1–10 + P1–P10 as named above
```

Delete `.tmp-shots.mjs` after the run (done). Do not treat any quote
in this file as a real GP, receptionist, or patient.
