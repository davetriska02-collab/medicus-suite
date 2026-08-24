# The Practice — Companion HUD role format

**Date:** 2026-08-24 · **Scope:** the in-page Companion floater
(`#ms-tap-widget`) and its four role views (Clinic / Reception / Triage /
Nursing). Not the side-panel modules.
**Lens:** features, UX, ease of use; weighted toward ease of use.
**Bar:** intrinsic usability (not a competitor gauntlet).
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona
(`.claude/skills/the-practice/PERSONAS.md`), a heuristic device. This is
not real user research and must never be quoted as a real clinician's
view. Report-only: this run does not change product code.

## Verdict

Not best-of-type for all its users yet. The thing carrying it is the
**one-box role split**: Reception's "To book" list is in language a
desk can act on, Clinic keeps the clinical due list plus Book / Create
task on the record, collapse keeps the count badge, and the error state
says unknown instead of inventing a clean patient. The thing holding it
back is **trust in the red number**. Eight synthetic staff independently
tripped on the same arithmetic: a badge of 7, four OVERDUE rows, and a
footnote that reads "+3, 1 overdue". The counts are internally correct
(4 shown + 3 hidden = 7; 1 of the hidden 3 is red). The wording is not.
The technophobe partner scored it 4/10 and would close it. Until that
line and the buried lithium row are fixed, the format is a good idea
that several bands will not trust enough to use.

## The panel

Cast from people who would actually touch this floater. Maureen (medical
secretary) and Raj (pharmacist) were left off: they do not live here.
Margaret holds the technophobe floor; Priya and Geoff hold the savvy
ceiling.

| # | Persona (synthetic) | Role / band | Score /10 |
|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner, technophobe | 4 |
| 3 | Sister Eileen Cobb | Practice nurse, reluctant | 6 |
| 4 | Chloe Danvers | Receptionist, savvy-consumer / low clinical | 6 (4 if she lands on Clinic) |
| 5 | Dr Tom Hollis | Salaried GP, pragmatist | 7 |
| 6 | Dr Sam Okonkwo | Locum GP, pragmatist | 7 |
| 7 | Dr Priya Nair | GP registrar, savvy | 7 |
| 8 | Janet Briggs | Practice manager, reluctant-but-capable | 5 |
| 10 | Dr Geoff Pellew | Partner / tinkerer, savvy | 6 |

Spread: 4 to 7. The floor fails. The middle is "I'd use it with caveats."

## Findings by bucket

### Universal friction

1. **[ADOPT · major · all bands] The "+N more, 1 overdue" line is
   misread as "only one thing is overdue".** Margaret, Tom, Sam, Priya
   and Janet all did the same double-take: badge 7, four OVERDUE cards,
   footnote "1 overdue". Verified against `shared/due-mini.js`: the
   badge is `redCount + amberCount` (7); the footnote's "1 overdue" is
   `moreRed` among the *hidden* three, not the list total. Fix: say
   what it means, e.g. "+3 more (1 of them overdue) — full list is in
   Monitoring." Do not quiet the red badge.

2. **[ADOPT · major · clinic / nursing / locum] A red lithium line can
   lose the visible four to QOF reviews.** The fixture had lithium
   "severely overdue" (status `stale`, visual red) hidden behind
   diabetes and asthma reviews. Verified: sort is `STATUS_RANK` then
   type, so `not_met` (0) beats `stale` (1), even though
   `chipSeverity('stale')` is red and the tag says "Severely overdue".
   The file comment in `test-due-mini.js` claims "red-before-amber,
   drug-before-QOF"; the sort does not actually put visual-red drugs
   ahead of rank-0 QOF. Fix: when capping to four, show red-severity
   items first (lithium stale before an overdue asthma review), then
   the existing rank. This is a missed-alert risk, not polish.

3. **[ADAPT · major · all bands] "Full list is in Monitoring / Slot
   Counter" is not a control.** Every band asked where to click.
   Verified: those strings are plain text in
   `content-scripts/task-actions-panel.js`, not links. Fix: make them
   open the existing Monitoring module / Slot Counter the same way the
   side panel already does. Do not invent a second clinical fetch.

### The tech-literacy gradient

4. **[ADAPT · major · technophobe + reluctant] The four role pills look
   like a test Margaret can fail.** She asked why a GP already in clinic
   must "choose a hat." Priya wanted a one-line hint under each pill.
   Sam (locum) was fine because Clinic was already selected. Ruling: do
   not add permanent subtitles (that is density Geoff already hates).
   Do persist the last role (already shipped) and add a one-time first
   run line, then never again. Do not hide the pills from Clinic: Chloe
   and Eileen need to get *to* their view, and Priya uses them to learn
   the practice.

5. **[ADAPT · major · reception / low clinical] Landing on Clinic is a
   hard stop for the desk.** Chloe: 6/10 on Reception, 4/10 if she
   opens Clinic ("FBC, LFT", "Serotonin syndrome risk" — she would
   interrupt a GP rather than guess). Verified: Reception voice already
   drops combo chips and rewrites drugs as "Methotrexate bloods". The
   leak is the toggle sitting next to her, not the Reception list
   itself. Fix: if the saved role is Reception, do not let a page
   suggestion yank her (already the rule). Optional: a one-line "this
   is the GP list" if she taps Clinic, not a lock-out.

6. **[OVERRULE · reason recorded] Geoff's "show all / configurable row
   count".** The four-line cap and "+N more" are a settled Companion
   rule (one box, not the all-four stack Dave rejected). A preference
   for "show all" is a judgement call below, not a default. Reverse
   with: add a `ms-companion-show-all` preference. Not recommended for
   v1.

### Role-specific needs

7. **[ADOPT · major · nursing] Nursing What's due is still Clinic
   voice.** Eileen got methotrexate FBC/LFT and "serotonin syndrome
   risk" on the Nursing tab, plus useful nurse slots underneath.
   Verified: `dueVoiceForRole` is reception or clinic;
   nursing maps to clinic. The role table promised treatment-room
   voice (bloods / BP / jabs). Slots are already nurse-filtered; the
   due list is not. Fix: a `nursing` voice that keeps identity-gate
   and the four-line cap, drops combo/alert chips the nurse cannot
   action, and names the work (bloods, BP, vaccine) the way Reception
   already names bookings.

8. **[ADAPT · major · reception] A due line does not say which slot
   type to pick.** Chloe and Sam both stalled at "Book a diabetes
   review" vs GP telephone / HCA bloods / phlebotomy. Do not
   auto-select a type (wrong book is worse than a pause). Fix later:
   a suggested type *label* on the due row, or pre-open Book with a
   hint, always overridable.

9. **[ADAPT · minor · triage] Off-queue copy reads like a button.**
   Priya treated "Open the medical queue for the pulse" as a control.
   Verified: it is empty-state text, not a click target. Fix: "Pulse
   is on the medical queue — open that list in Medicus." Do not fake
   counts. The on-queue pulse (23 · 2 red-flag · 1 red result + two
   worst rows) was the one triage screen the panel understood.

10. **[ADAPT · minor · manager] "Slots left today" needs a source
    line.** Janet scored 5 because two screenshots showed 23 across 5
    types vs 38 across 14 types with the same desk numbers. That was
    two *fixture densities* in this run, not the live widget
    contradicting itself. Overruled as a product defect. Still adapt:
    the lead line should say it is remaining slots on today's
    appointment book, and the "+N more types" line already points at
    Slot Counter. An as-of time is optional; a fake 0 is never
    allowed.

11. **[NOTE · reception] Existing appointments for this patient are
    Clinic-only (old TAP "Patient record" block).** Not on the
    screenshots Chloe saw, so she did not complain. Still a hole if
    reception is booking from this box: they cannot see the patient
    is already booked next Tuesday. Flag, do not invent a second
    appointments fetch in this appraisal.

### Standout strengths (protect these)

- **Reception voice.** Chloe: "Book a diabetes review is something I
  can actually say to a patient." Combo chips stay off that list.
- **Honest unknown.** Janet and Sam both praised "Couldn't check
  what's due — treat as unknown." It is an orange box, not a blank
  zero. Do not ever render a fake all-clear.
- **Empty state is not "all clear".** "Nothing due right now. The
  full picture is in Monitoring." Margaret exhaled; Eileen called it
  honest. Keep the pointer.
- **Due list + Book / Create task on the same patient page.** Tom and
  Priya: no new tab, no second login. Collapse keeps the badge.
- **Zero setup.** Sam: Clinic already selected, no practice code, no
  assignee UUID. That is the locum floor. Do not add a required
  config to open the box.
- **OVERDUE is a word, not only a colour.** The colourblind shot is
  an approximate filter (injected TAP has no suite colourblind
  tokens). The real control is the tag text plus the left bar. Do
  not drop the word.

## Prioritised path to best-of-type

Implementation is a separate request. Clinical-safety salience is not
to be turned down. UI work on this one surface goes through
`design-crit` if you want pixels restyled; do not freehand a restack
of all four roles into one box.

### UX / UI (small)

| Size | Fix | Unblocks |
|---|---|---|
| S | Rewrite the more line: "+3 more (1 of them overdue)" | Margaret, Tom, Sam, Priya, Janet |
| S | Off-queue triage copy that is not a fake button | Priya, Tom |
| S | First-run one-liner under the role pills, then never again | Margaret, Priya |
| M | Visible-four sort: red severity first, then existing rank (lithium stale before asthma review) | Eileen, Tom, Sam; missed-alert risk |
| M | Nursing due voice (bloods / BP / jabs; drop combo) | Eileen |
| M | "Monitoring" / "Slot Counter" open the existing suite surfaces | all bands |

### Feature gaps (roadmap)

| Size | Gap | Unblocks |
|---|---|---|
| M | Suggested appointment type on a Reception due row (hint, not auto-book) | Chloe, Sam |
| M | This-patient future appointments on Reception (same data Clinic already has) | Chloe, Janet |
| L | Named "oldest wait" on the queue pulse | Tom, Priya |
| XL | Configurable "show all" density | Geoff only; judgement call |

If you want those gaps scored against rivals, that is `the-gauntlet`,
not this panel.

## Judgement calls

Flagged so they can be reversed in one line.

1. **Keep the four-line cap.** Reverse: add a show-all preference
   (Geoff's ask). Default stays capped so the box does not become the
   stack Dave already rejected.
2. **Keep the name "Companion".** Reverse: retitle the header "What's
   due" (Margaret). That title is a lie on Reception and Triage.
3. **Keep all four role pills visible.** Reverse: hide the toggle
   once a role is saved (Margaret). That traps Chloe and Eileen on
   Clinic.
4. **Do not auto-pick a booking type from a due line.** Reverse: map
   "Methotrexate bloods" → HCA bloods and commit it. Wrong book is
   worse than a pause.
5. **Do not calm OVERDUE.** If a persona finds the red wall shouty,
   that is the alert working.

## Reproduce

Surfaces shot to `/tmp/the-practice/companion-hud/` (copies of the
telling ones under `docs/appraisal/companion-hud-2026-08-24/`):

- first contact / alerting: `clinic.png`, `reception.png`, `nursing.png`,
  `triage.png`, `triage-queue.png`
- empty / error / collapsed: `clinic-empty.png`, `clinic-error.png`,
  `clinic-collapsed.png`
- interactive: `clinic-book.png`, `clinic-task.png`,
  `reception-slots-busy.png`
- host variants: `clinic-dark.png` (widget stays light-token),
  `clinic-colourblind.png` (deuteranopia *filter*, not suite mode)

Rendered from a one-off appraisal page that loads the real TAP CSS,
`shared/due-mini.js` and `shared/companion-role.js` (same wording as
live). Injected TAP has no dark theme; the dark shot is the light
widget on a dark host. Colourblind mode does not apply to this
floater; dual-coding was checked via filter plus the OVERDUE word.

Cast: personas 1, 3, 4, 5, 6, 7, 8, 10. Margaret and Chloe on a
small/plain model; the rest on sonnet-class. Screenshots only; no
source; no cross-talk. Practice lead verified factual claims against
`shared/due-mini.js` and `content-scripts/task-actions-panel.js`
before adopting.
