# The Practice — Note display board (red-team pass)

**Date:** 2026-08-29 · **Scope:** Note companion tab
(`side-panel/modules/board/`) and the full-tab kiosk (`board.html`) in
all three profiles (Waiting room, Ops, Message), plus the live-feed
failure state.
**Lens:** features, UX, ease of use; red-team overlay (misread, rumour,
dignity, PII, fail-closed). Weighted toward ease of use and public-TV
harm.
**Bar:** intrinsic usability (not a competitor gauntlet).
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona
(`.claude/skills/the-practice/PERSONAS.md` plus ten synthetic patients
invented for this run). Heuristic device only. This is not real user
research and must never be quoted as a real clinician's or patient's
view.

**Shots:** `/tmp/the-practice/note/` (copied to
`/opt/cursor/artifacts/the-practice/note/`). Companion light/dark/
colourblind, cold-start with the suite setup checklist still up,
companion Ops scrolled to the staff warning, kiosk Waiting room / Ops /
Message at 1080p, Waiting room at 720p (back-row), kiosk live-fail.

## Verdict

Not best-of-type yet for all its users. The thing carrying it is the
**public PII lock**: twenty synthetic people hunted for names, initials
and visit reasons; none found any. The flap sentence and the clock are
readable from the back row. The thing holding it back is that the
public board still **narrates the practice** (request volumes, Tempo,
a wait band that reads as a promise) and **fails quiet**: a dead feed
paints 0 / Quiet / No one waiting with "1 feed issue" in the skirting
board. Patients invent a 28- or 42-person queue. Staff will not defend
Steady and Busy at the same clock. Until the public ticker stops
announcing medical/admin counts and a broken feed looks broken, this is
a good board that several bands will unplug.

## The panel

Full staff roster (Note is reception-, manager- and partner-facing).
Ten synthetic patients for the public TV. Maureen and Margaret hold the
technophobe floor; Priya, Raj and Geoff hold the savvy ceiling.

| # | Persona (synthetic) | Role / band | Score /10 |
|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner, technophobe | 3 |
| 2 | Maureen Castle | Medical secretary, technophobe | 3 |
| 3 | Sister Eileen Cobb | Practice nurse, reluctant | 5 |
| 4 | Chloe Danvers | Receptionist, savvy-consumer / low clinical | 6.5 |
| 5 | Dr Tom Hollis | Salaried GP, pragmatist | 3 in clinic / 6 as a wall |
| 6 | Dr Sam Okonkwo | Locum GP, pragmatist | 5 |
| 7 | Dr Priya Nair | GP registrar, savvy | 5 |
| 8 | Janet Briggs | Practice manager, reluctant-but-capable | 4 |
| 9 | Raj Patel | Clinical pharmacist, savvy + domain | 4 |
| 10 | Dr Geoff Pellew | Partner / tinkerer, savvy | 5 |
| P1 | Elsie Ward, 81 | Patient, bifocals, treats times as promises | 6 (2 if Ops on the wall) |
| P2 | Jordan Blake, 17 | Patient, first visit alone, anxious | 5 |
| P3 | Amira Hassan, 34 | Patient, English second language | 6 |
| P4 | David Chen, 45 | Patient, deuteranopia | 7 |
| P5 | Patrice Okeke, 52 | Patient, wheelchair, back row | 6 |
| P6 | Liam O'Connor, 8 + mum | Patient + parent | 8 public / 3 Ops |
| P7 | Sandra Miles, 68 | Patient, scans for names | 6 public / 2 Ops |
| P8 | Tom Reid, 29 | Patient, booked online | 4 |
| P9 | Grace Nwosu, 41 | Patient, toddler, one glance | 7 |
| P10 | Harold Finch, 76 | Patient, distrusts NHS screens | 3 |

Staff spread: 3 to 6.5. The floor fails. The middle is "I can put it up
and I cannot defend it." Patient spread on the proper Waiting-room
profile: 3 to 8. The floor fails when the ticker or a dead feed is in
play. Ops on a public TV drops every patient who saw it to 2–3.

## Findings by bucket

### Universal friction

1. **[ADOPT · blocker · public patients + reception + CSO]** The public
   ticker announces today's medical and admin request counts.
   Tom Reid (synthetic) read "28 medical requests" as 28 people ahead
   of him and would text his boss "42 requests ahead of me." Elsie
   nearly got her coat. Liam asked if they would run out of medicine.
   Chloe said she cannot defend it at the desk. Verified:
   `buildTickerLines` always appends medical/admin counts; the Waiting
   room default widgets include `ticker` and omit `demand`, so turning
   off "Requests today" does not silence the tape
   (`board/board-core.js`). Fix: public ticker may say people waiting,
   the wait band, and tempo. It must not say request volumes. Staff
   ticker may keep them.

2. **[ADOPT · blocker · all bands]** A dead feed looks like a quiet
   surgery. Live-fail shot: 0 waiting, "No one waiting", Tempo Quiet,
   ticker of zeroes, clock still ticking, "UPDATED" matching the clock,
   and "1 feed issue" in the footer. Raj, Priya, Sam, Harold, Elsie
   and Sandra all said they would believe the zero. Verified:
   `fetchAllStreams` threw; `buildSnapshot({})` paints empty
   aggregates; `updateFootRight` whispers the error
   (`board/board.js`). Fix: if `snapshot.errors.length`, the public
   board must stop looking empty: hide wait bands, hide Quiet, hide
   zeroes, full-face "This board is not updating. Please ask
   reception." Footer amber is not a control.

3. **[ADOPT · major · patients + reception + nurses]** "Typical wait
   under 10 minutes" is read as a personal promise. Elsie: seen by
   13:21 or she goes to the desk. Tom Hollis: someone will quote it.
   Verified: `waitBand` is a band against `amberWaitMin` / `redWaitMin`,
   not a forecast (`board/board-core.js`). Fix: wording, not the band
   math. e.g. "Most waits are under 10 minutes" plus, if needed, "not
   a promise for you." Do not show a named wait in minutes. Do not
   quiet the tone bar.

4. **[ADOPT · major · all staff]** Same clock, same 4 waiting: public
   Tempo is Steady, Ops Tempo is Busy. Janet would refuse to quote
   either. Verified: `deriveTempo(..., 'public')` ignores demand;
   staff mode uses today's request pile (`busyDemand` 30). Demo has
   42 requests, so staff is Busy. This is intentional (public must not
   paint Busy over a quiet room). The UI never says so. Fix: one
   caption under staff Tempo ("includes today's requests") and/or
   rename public Tempo to a room word ("This room is steady"). Do not
   merge the two formulas.

5. **[ADAPT · major · locum + secretary + partner]** Three launch
   buttons plus three profile chips. Maureen failed at "Open on this
   screen" (that is her laptop). Sam would put the board on the
   consulting-room screen. Priya: the tired-receptionist footgun is
   inspect Ops, then hit the still-blue Open. Verified: primary button
   is `data-open` of the selected profile; Waiting room / Ops are
   extra openers (`side-panel/modules/board/board.js`). Fix: one
   primary "Open this profile on a TV tab." Drop the duplicate
   Waiting room / Ops launchers, or make them say "Open Waiting room
   on a TV" / "Open Ops on a TV." A confirm when the selected profile
   is staff.

### The tech-literacy gradient

6. **[ADOPT · major · technophobe + locum]** First contact is the suite
   setup checklist, not Note. Margaret closed it. Maureen never found
   the message box on cold start. Verified: `suite.setup` dismissedAt
   unset paints GET SET UP above the module (`side-panel/setup/setup.js`).
   This is suite-wide, not Note-only. Fix for this surface: if
   `panel.activeModule === 'board'`, collapse the checklist to the
   strip so the TV remote is on the first screen. Do not delete the
   checklist.

7. **[ADOPT · major · patients + reception]** The word **Tempo** is
   wasted. Amira thought music. Elsie, Patrice, Liam, Chloe, Eileen
   all asked what it is. David (colourblind) said Quiet / Busy work;
   Steady does not. Verified: the tile key is the literal string
   "Tempo" (`board/board.js`). Fix: drop the label, or use "How busy
   we are." Keep the four words. Keep the dots as a count, not as the
   only signal.

8. **[ADAPT · major · eyesight + back row]** The wait band and the
   ticker are too small / too fast. Patrice from the back: flaps, the
   4, Steady, the clock. Elsie cannot follow the tape with bifocals.
   Amira skipped it. Grace never saw DEMO FIGURES. Verified: ticker is
   a moving track; wait band is tile subtitle, not flap-sized. Fix:
   put the wait band in the same weight as the count, or on the flaps
   when it is the thing you want believed. Do not rely on the ticker
   for anything load-bearing.

9. **[OVERRULE · reason recorded]** Geoff's "no keyboard, send it
   back." Verified: 1 / 2 / 3 switch profiles, F fullscreen, D toggles
   demo (`board/board.js`). Chrome hides in fullscreen; idle only fades
   it to 35% (`board/board.css`). Reverse with: paint a `?` overlay.
   Not a missing-feature defect.

### Role-specific needs

10. **[ADOPT · major · patients + Caldicott]** Ops on a public TV is
    the dignity incident. Every patient who saw the Ops shot treated
    it as overhearing the office: "1 urgent" became a person in the
    room (Sandra, Jordan, Liam's mum). Staff already have the beige
    warning. Verified: there is no confirm, pin, or audience lock on
    `openBoardTab('ops')`. H-067 residual already says this. Fix:
    confirm on Ops open ("This is a staff display. Do not put it on
    the waiting-room TV."). On a public-audience tab, hide the profile
    `<select>` or require a long-press / key to switch. Fullscreen
    already hides chrome; pin it for public.

11. **[ADOPT · major · manager]** Practice pressure 42 next to
    Requests today 42. Janet would refuse to quote pressure. Verified:
    PPI is a weighted index (`condor-index-core.js`); 42 matching 42
    on the demo fixture is coincidence, not the same input. Fix: show
    "Index 42 · AMBER" or "Pressure index", never a bare 42 that
    twins the request count.

12. **[ADAPT · major · pharmacist + CSO]** The 80-character flap box
    can take a name. Raj: the widget lock never fires on free text.
    Eileen: "Mrs Khan to room 3" is one tired sentence. Verified:
    `sanitiseMessage` strips markup, not names
    (`board/board-core.js`). Fix: keep free text (practices need it).
    Add a companion line: "Do not type patient names." Optional:
    warn if the string matches a very-weak name pattern. Do not block
    "Dr Smith is running 20 minutes late" without a judgement call.

13. **[ADAPT · minor · receptionist]** Live-fail vs Demo chrome.
    Chloe and Sam read the fail-state **Demo** button as "we are in
    demo," not "press this to show canned figures because live died."
    Verified: `demoBtn.textContent` is the *next* action
    (`board/board.js`). Fix: label the button for the current state
    ("Showing demo" / "Showing live") or use a verb pair that cannot
    invert.

14. **[ADAPT · minor · power user]** No threshold editor on the
    companion. Geoff wanted amber/red cut-offs. Verified: thresholds
    exist on `board.config` and inherit WR amber/red; the companion
    only exposes poll seconds. Reverse with: a small "Busy when N
    waiting" pair. Not required to ship v1 if public Tempo stays a
    room measure.

### Standout strengths

- **No names, initials, or visit reasons on any painted public or Ops
  frame.** Twenty synthetic people hunted. H-067 held on pixels.
  Demo streams plant Alice Smith / chest pain / antibiotics; none
  leaked into `buildSnapshot` JSON either (checked in this run).
- **PUBLIC TV / STAFF ROOM** tags and the green / beige privacy boxes
  are the first sentences Chloe, Sam and Janet trusted.
- **Flap sentence + clock** are the board. Grace, Patrice, David,
  Amira, Liam: sit down, we will call you, here is the time.
- **DEMO FIGURES** in yellow when it *is* demo. Harold still hates
  screens; at least the product admits theatre.
- **Staff-only widgets omitted** from the public companion checkbox
  list. Not merely greyed.

## Prioritised path to best-of-type

UX/UI (hand to `design-crit` for Note, not freehand):

| # | Fix | Size | Unblocks |
|---|---|---|---|
| 1 | Public ticker: drop medical/admin request lines | S | Tom Reid, Elsie, Liam, Chloe, Eileen, Priya |
| 2 | Dead feed looks broken, not Quiet / 0 | S–M | Raj, Harold, Priya, Sam, Elsie, Sandra |
| 3 | Wait-band copy: band, not a personal promise | S | Elsie, Tom Hollis, Chloe |
| 4 | One TV opener; confirm before Ops | S | Maureen, Sam, Priya, Margaret |
| 5 | Rename or drop the word Tempo; keep Quiet/Steady/Busy | S | Amira, Chloe, David, Patrice |
| 6 | Pressure tile says "index" | S | Janet |
| 7 | Collapse setup checklist when Note is the active tab | S | Margaret, Maureen, Sam |
| 8 | Public kiosk: hide profile chrome unless unlocked | M | Sandra, Jordan, Chloe, Raj |
| 9 | Wait band at count-weight (or on the flaps) | M | Patrice, Elsie, Amira |

Feature gaps (roadmap, not this pass):

- Fourth profile / clone (Geoff). Judgement call below.
- Threshold editor on the companion (Geoff).
- `?` keyboard overlay (keys already exist).
- Weak name-warning on the flap box (Raj).

## Judgement calls

Flagged so they can be reversed.

1. **Keep the split-flap look.** Harold called it a toy. Liam liked
   it. Readability from the back row is the job. Reverse: flat
   sans-serif kiosk.
2. **Keep three shipped profiles.** Geoff wanted a fourth. v1 is a
   sample pack on purpose. Reverse: clone-profile control.
3. **Keep public Tempo ignoring request volume.** Janet hates Steady
   vs Busy. Merging the formulas would paint Busy on a 4-person room
   (the bug that already shipped and was fixed). Reverse: one tempo
   everywhere, and accept the public-TV Busy lie.
4. **Do not delete the ticker.** Adapt it (finding 1). Reverse: no
   ticker on public.
5. **Do not add a PIN on Ops** unless a practice asks. A confirm plus
   chrome-lock is enough for v1. Reverse: PIN / passcode on staff
   profiles.
6. **Do not remove "Please take a seat."** Patrice noted it is odd
   from a wheelchair. The sentence is still the one thing every
   patient understood. Reverse: "We will call you" only.

## Reproduce

```text
node  (design-crit harness + Playwright, Chrome
      /home/ubuntu/.cache/ms-playwright/chromium-1234/...)
out   /tmp/the-practice/note/
pages board.html?demo=1#waiting-room|ops|message
      board.html#waiting-room          (chrome shim, live-fail)
      side-panel/panel.html            (panel.activeModule=board)
cast  PERSONAS.md 1–10 + P1–P10 as named above
```

Delete `.tmp-shots.mjs` after the run (done). Do not treat any quote
in this file as a real GP, receptionist, or patient.
