# The Practice — Note display board (pass 3, after v3.249.1)

**Date:** 2026-08-29 · **Scope:** Note companion and kiosk after the
second-pass leftover list (wait caveat weight, fail chrome, TV steps,
Steady subtitle, Pressure caption, Ops opener restyle).
**Lens:** features, UX, ease of use; same 20 personalities as
`docs/appraisal/PRACTICE-note-2026-08-29.md` and the first rerun.
**Bar:** 9/10 for all its users, as asked. Intrinsic usability.
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona.
Heuristic device only. This is not real user research and must never
be quoted as a real clinician's or patient's view.

**Shots:** `/tmp/the-practice/note-pass3/` (copied to
`/opt/cursor/artifacts/the-practice/note-pass3/`).
**Product:** v3.249.1 on `cursor/note-practice-fixes-fd60`.
This write-up is report-only.

Patients were told DEMO FIGURES is a preview stamp and not to deduct
for it, so scores are about the live layout, not the harness label.

## Verdict

Not 9/10 for every user. Closer than pass 2, and good enough that
another product loop will not get the rest without reversing a
judgement call or breaking H-067.

The thing carrying it is that **the public board is now a waiting-room
board**: sit down, four waiting, a normal amount of people, no request
counts, no names, a dead feed that looks broken. Maureen, Chloe, Geoff,
Jordan, Amira and Liam's mum all scored 9 on the job they came to do.

The thing holding a suite-wide 9 is no longer a buried setup card or a
ticker of medical requests. It is three asks we have already ruled on:

- a personal wait or a name on the wall (Elsie, Tom Reid) — H-067
- a PIN or a name regex on the flap (Raj) — judgement call
- drop the split-flap look (Harold) — judgement call

The floor moved 6 to 7. The middle is 8. The ceiling is 9. That is a
different product from this morning. It is not a 9 for all twenty.

## The panel

Same cast. Pass 2 scores in brackets.

| # | Persona (synthetic) | Role / band | Score /10 | Was (pass 2) |
|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner, technophobe | 8 | 6 |
| 2 | Maureen Castle | Medical secretary, technophobe | 9 | 8 |
| 3 | Sister Eileen Cobb | Practice nurse, reluctant | 8 | 7 |
| 4 | Chloe Danvers | Receptionist, savvy-consumer / low clinical | 9 | 8 |
| 5 | Dr Tom Hollis | Salaried GP, pragmatist | 8 clinic / 6 wall (7 overall) | 7 / 4 (6) |
| 6 | Dr Sam Okonkwo | Locum GP, pragmatist | 8.5 | 8 |
| 7 | Dr Priya Nair | GP registrar, savvy | 8 | 6 |
| 8 | Janet Briggs | Practice manager, reluctant-but-capable | 8 | 7 |
| 9 | Raj Patel | Clinical pharmacist, savvy + domain | 7 | 7 |
| 10 | Dr Geoff Pellew | Partner / tinkerer, savvy | 9 | 8 |
| P1 | Elsie Ward, 81 | Patient, treats times as promises | 7 (2 if Ops) | 6 / 2 |
| P2 | Jordan Blake, 17 | Patient, first visit alone | 9 (3 if Ops) | 8 / 3 |
| P3 | Amira Hassan, 34 | Patient, English second language | 9 | 8 |
| P4 | David Chen, 45 | Patient, deuteranopia | 8 | 6 |
| P5 | Patrice Okeke, 52 | Patient, wheelchair, back row | 8 | 7 |
| P6 | Liam O'Connor, 8 + mum | Patient + parent | 9 public / 3 Ops | 8 / 3 |
| P7 | Sandra Miles, 68 | Patient, scans for names | 8 public / 3 Ops | 7 / 3 |
| P8 | Tom Reid, 29 | Patient, booked online | 7 public / 2 Ops | 7 / 2 |
| P9 | Grace Nwosu, 41 | Patient, toddler, one glance | 8 | 7 |
| P10 | Harold Finch, 76 | Patient, distrusts screens | 7 | 6 |

Staff spread: 7 to 9. Floor is Raj (wants locks we overruled) and Tom
Hollis's wall score (wants minutes off the public card). Patient
public spread: 7 to 9. Floor is Elsie, Tom Reid, Harold.

## What pass 2 asked for, and what this run saw

Verified against v3.249.1 pixels and code.

| Pass 2 leftover | This run |
|---|---|
| Wait caveat at band weight; minutes off the ticker | **Closed as specified.** Patrice (synthetic) can read both lines from the back. Tom Hollis: ticker is only "4 people waiting / This room is steady." Elsie still quotes the minutes from the card. That is the leftover of judgement call 7, not a missed patch. |
| Fail chrome said Showing live | **Closed.** Harold: badge now says Live figures failed and matches the face. Priya 6 to 8 on that. |
| Staff flap warning | **Closed.** Ops companion: "This text goes on the staff-room board." |
| HDMI / drag-a-tab last step | **Closed for the floor.** Margaret 6 to 8. Maureen 8 to 9. The hint is now "use the computer already plugged into the TV." |
| Pressure caption | **Closed enough for Janet.** She will not quote 42, and she can now say why. Demo still twins 42 and 42. |
| Ops same blue Open | **Closed.** Peach "Open the staff board on a TV tab" plus "You will be asked to confirm." Chloe 9. Priya 8. |

## Findings by bucket

### Universal friction

None that a band cannot complete. The last universal items from pass 1
and 2 are closed on pixels.

### The tech-literacy gradient

1. **[OVERRULE · reason recorded]** Tom Hollis (wall 6) and Elsie (7)
   still want the named minutes off the public card. Pass 1 judgement
   call 7: do not delete the wait band. The caveat is now as large as
   the band and the ticker no longer sells the minutes. Reverse with:
   occupancy count only, no minutes.

2. **[ADAPT · minor · David]** Steady is still the big word. The new
   subtitle "A normal amount of people" is what he reads. He scored 8
   and asked for the big word to be the plain one. Optional: paint
   "Normal" as the public label for steady, keep Quiet / Busy / Very
   busy. Do not merge with staff Busy.

### Role-specific needs

3. **[OVERRULE · reason recorded]** Raj still 7: hard-block names in
   the flap and refuse to open Ops on a public TV. Confirm, chrome
   lock, peach opener, and the no-names line shipped. A PIN or a name
   regex is the same judgement call as pass 1.

4. **[OVERRULE · reason recorded]** Tom Reid still 7: he wants how
   many are ahead of *his* booking, or a latest time for his boss.
   That is a personal queue. H-067 forbids names. A public aggregate
   board cannot do this job. Reverse with: a ticketed queue product,
   not Note.

5. **[OVERRULE · reason recorded]** Harold still 7: drop the flaps.
   Pass 1 judgement call 1. Reverse: flat sans-serif kiosk.

6. **[ADAPT · minor · Patrice]** Fail-loud body copy is smaller than
   "Please ask reception." She asked for the "do not judge how busy we
   are" line at the same size. Polish, not a blocker. She scored 8.

### Standout strengths

- **Technophobe floor on the companion is now 8–9.** Margaret can do
  the TV steps. Maureen called them plain English.
- **Chloe can defend the public TV at the desk** (9), including the
  wait line and the dead board.
- **H-067 held again.** Sandra hunted three frames. No names.
- **Fail-loud is consistent.** Harold's lie is gone.
- **Amira 9.** Tempo is gone; "A normal amount of people" is how a
  person talks.
- **Geoff 9.** He would put both boards up.

## Prioritised path (only if you want a fourth loop)

These will not get every persona to 9. They may lift David and
Patrice. They will not lift Raj, Tom Reid, Elsie, or Harold without
reversing a call above.

| # | Fix | Size | Who it helps |
|---|---|---|---|
| 1 | Public Steady big-word "Normal" (keep the four states) | S | David |
| 2 | Fail-loud body at reception-line weight | S | Patrice |
| 3 | Blue button says "Open the waiting-room board" | S | Margaret, Maureen, Sam |

Do not do, unless you reverse the call:

- Minutes off the public card (Tom Hollis, Elsie)
- PIN / name regex (Raj)
- Personal ETA (Tom Reid)
- Kill the flaps (Harold)

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
node  (design-crit harness + Playwright)
out   /tmp/the-practice/note-pass3/
pages board.html?demo=1#waiting-room|ops|message
      board.html#waiting-room
      side-panel/panel.html  (panel.activeModule=board)
cast  PERSONAS.md 1–10 + P1–P10
```

Delete `.tmp-shots.mjs` after the run (done). Do not treat any quote
in this file as a real GP, receptionist, or patient.
