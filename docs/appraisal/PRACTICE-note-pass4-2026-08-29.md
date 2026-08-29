# The Practice — Note display board (pass 4, after v3.249.2)

**Date:** 2026-08-29 · **Scope:** Note companion and kiosk after the
third-pass leftover list (public tempo word Normal, fail-loud body at
reception-line weight, named TV opener).
**Lens:** features, UX, ease of use; same 20 personalities as
`docs/appraisal/PRACTICE-note-2026-08-29.md`, the first rerun, and pass 3.
**Bar:** 9/10 for all its users, as asked. Intrinsic usability.
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona.
Heuristic device only. This is not real user research and must never
be quoted as a real clinician's or patient's view.

**Shots:** `/tmp/the-practice/note-pass4/` (copied to
`/opt/cursor/artifacts/the-practice/note-pass4/`).
**Product:** v3.249.2 on `cursor/note-practice-fixes-fd60`.
This write-up is report-only.

Patients were told DEMO FIGURES is a preview stamp and not to deduct
for it, so scores are about the live layout, not the harness label.

## Verdict

Not 9/10 for every user. The leftover polish closed as specified.
Another product loop will not get the rest without reversing a
judgement call or breaking H-067.

What landed: the public tempo big word is **Normal**, the ticker says
"This room is normal", the fail-loud body is the same size as "Please
ask reception", and the companion button names the board (waiting-room,
message, or staff). David and Patrice, who asked for those last two
pixel changes, both scored 9. Sam scored 9 on a cold start.

What still holds a suite-wide 9 is the same three asks we have already
ruled on:

- a personal wait or a name on the wall (Elsie, Tom Reid) — H-067
- a PIN or a name regex on the flap (Raj) — judgement call
- drop the split-flap look (Harold) — judgement call

Margaret's 4 this run is run-to-run noise on the same HDMI copy that
previously scored 8. The leftover she asked for (name the waiting-room
board on the button) is on the pixels. The remaining ask is a button
that puts the board on the waiting-room television from her own desk.
Same Wi-Fi is not pairing. That is not a missed patch.

## The panel

Same cast. Pass 3 scores in brackets.

| # | Persona (synthetic) | Role / band | Score /10 | Was (pass 3) |
|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner, technophobe | 4 | 8 |
| 2 | Maureen Castle | Medical secretary, technophobe | 8 | 9 |
| 3 | Sister Eileen Cobb | Practice nurse, reluctant | 8 | 8 |
| 4 | Chloe Danvers | Receptionist, savvy-consumer / low clinical | 8 | 9 |
| 5 | Dr Tom Hollis | Salaried GP, pragmatist | 8 clinic / 6 wall (7 overall) | 8 / 6 (7) |
| 6 | Dr Sam Okonkwo | Locum GP, pragmatist | 9 | 8.5 |
| 7 | Dr Priya Nair | GP registrar, savvy | 8 | 8 |
| 8 | Janet Briggs | Practice manager, reluctant-but-capable | 8 | 8 |
| 9 | Raj Patel | Clinical pharmacist, savvy + domain | 7 | 7 |
| 10 | Dr Geoff Pellew | Partner / tinkerer, savvy | 8 | 9 |
| P1 | Elsie Ward, 81 | Patient, treats times as promises | 6 (2 if Ops) | 7 / 2 |
| P2 | Jordan Blake, 17 | Patient, first visit alone | 8 (2 if Ops) | 9 / 3 |
| P3 | Amira Hassan, 34 | Patient, English second language | 8 | 9 |
| P4 | David Chen, 45 | Patient, deuteranopia | 9 | 8 |
| P5 | Patrice Okeke, 52 | Patient, wheelchair, back row | 9 | 8 |
| P6 | Liam O'Connor, 8 + mum | Patient + parent | 9 public / 2 Ops | 9 / 3 |
| P7 | Sandra Miles, 68 | Patient, scans for names | 9 public / 8 Ops (names only) | 8 / 3 |
| P8 | Tom Reid, 29 | Patient, booked online | 5 public / 2 Ops | 7 / 2 |
| P9 | Grace Nwosu, 41 | Patient, toddler, one glance | 8 | 8 |
| P10 | Harold Finch, 76 | Patient, distrusts screens | 5 | 7 |

Staff spread: 4 to 9. The 4 is Margaret on HDMI from her own chair
(variance; see below). Floor among people doing the job they came for
is Raj (locks we overruled) and Tom Hollis's wall score (minutes we
kept). Patient public spread: 5 to 9. Floor is Tom Reid, Harold, Elsie.

Sandra's Ops 8 is a name-hunt score, not an Ops-on-the-wall score.
Every other patient who saw Ops on the public wall scored 2.

## What pass 3 asked for, and what this run saw

Verified against v3.249.2 pixels and code.

| Pass 3 leftover | This run |
|---|---|
| Public Steady big-word Normal | **Closed.** Waiting-room tile is "This room / Normal / A normal amount of people." Ticker: "THIS ROOM IS NORMAL." Staff still says Steady or Busy. David (synthetic) 8 to 9: "You put Normal. That is what I meant." |
| Fail-loud body at reception-line weight | **Closed.** Same `clamp(22px, 2.8vw, 36px)` as "Please ask reception." Patrice (synthetic) 8 to 9: she can read both lines from the back. |
| Blue button says Open the waiting-room board | **Closed.** Waiting room: "Open the waiting-room board on a TV tab." Message: "Open the message board on a TV tab." Ops: peach "Open the staff board on a TV tab." Sam (synthetic) 8.5 to 9. |

## Findings by bucket

### Universal friction

None that a band cannot complete. The last leftover list is closed on
pixels.

### The tech-literacy gradient

1. **[OVERRULE · variance, not a new defect]** Margaret (synthetic)
   scored 4 this run because she pressed the button at her own desk
   and read "the tab will not jump to the TV by itself" as failure.
   Pass 3 she scored 8 on the same HDMI sentence. The leftover she
   asked for (name the waiting-room board) is on the button. Reverse
   with: a button that casts from her laptop onto the waiting-room
   television. Same Wi-Fi is not pairing. Chrome plus HDMI on the
   computer already on the TV is the product.

2. **[OVERRULE · reason recorded]** Tom Hollis (wall 6) and Elsie (6)
   still want the named minutes off the public card, or a personal
   time. Pass 1 judgement call 7: do not delete the wait band. The
   caveat is band-weight and the ticker no longer sells the minutes.
   Reverse with: occupancy count only, no minutes.

3. **[ADAPT · minor · David, closed]** Steady to Normal. Done. Do not
   merge with staff Busy.

### Role-specific needs

4. **[OVERRULE · reason recorded]** Raj still 7: PIN, or type STAFF,
   and a name regex on the flap. Confirm, chrome lock, peach opener,
   and the no-names line shipped. Same judgement call as pass 1.

5. **[OVERRULE · reason recorded]** Tom Reid still 5: his place in the
   queue, or a latest time for his boss. That is a personal queue.
   H-067 forbids names. A public aggregate board cannot do this job.
   Reverse with: a ticketed queue product, not Note.

6. **[OVERRULE · reason recorded]** Harold still 5: drop the flaps.
   Pass 1 judgement call 1. Reverse: flat sans-serif kiosk.

7. **[ADAPT · minor · Chloe, Janet]** Companion widget label is still
   "How busy we are"; the public tile is "This room". Same setting,
   two words. Optional: rename the public checkbox to "This room".
   Do not merge the tempo formulas.

8. **[ADAPT · minor · Eileen]** Staff "1 urgent" is a caption, not a
   fail-loud face. Optional staff-only louder urgent tile. Not a
   public-TV change.

9. **[ADAPT · minor · Janet]** Demo still twins Pressure 42 and
   Requests today 42. The caption already says they are different.
   Changing demo numbers is polish, not a product rule.

### Standout strengths

- **Sam 9 on a cold start.** Setup can wait, waiting-room already
  selected, button names the board, HDMI sentence names the computer
  already on the TV.
- **David 9.** Normal is the big word. Colour is not the signal.
- **Patrice 9 from the back row.** Fail-loud body matches the ask line.
- **H-067 held again.** Sandra hunted three frames. No names, no
  initials, no NHS numbers.
- **Chloe can still defend the public TV at the desk** even at 8:
  sit down, four waiting, this room, not a promise, dead board asks
  reception.
- **Liam's mum 9.** One glance, sit him down, nothing to hide.

## Prioritised path

There is no fourth leftover list that gets every persona to 9.

Do not do, unless you reverse the call:

- Minutes off the public card (Tom Hollis, Elsie)
- PIN / name regex (Raj)
- Personal ETA (Tom Reid)
- Kill the flaps (Harold)
- Cast from a laptop onto the waiting-room TV (Margaret this run)

Optional S polish if you want a quieter companion, not a suite-wide 9:

| # | Fix | Size | Who it helps |
|---|---|---|---|
| 1 | Public checkbox label "This room" | S | Chloe, Janet |
| 2 | Demo pressure figure not 42 | S | Janet |
| 3 | Staff urgent tile louder | S | Eileen |

## Judgement calls

Unchanged. Still reversible.

1. Keep the split-flap look.
2. Keep three shipped profiles.
3. Keep public tempo ignoring request volume.
4. Do not delete the ticker.
5. Do not add a PIN on Ops.
6. Do not remove "Please take a seat."
7. Do not delete the wait band.

## Reproduce

```text
node  (design-crit harness + Playwright, chromium-1234 executable)
out   /tmp/the-practice/note-pass4/
pages board.html?demo=1#waiting-room|ops|message
      board.html#waiting-room
      side-panel/panel.html  (panel.activeModule=board)
cast  PERSONAS.md 1–10 + P1–P10
```

Delete `.tmp-shots.mjs` after the run (done). Do not treat any quote
in this file as a real GP, receptionist, or patient.
