# Reception pathways — slim-down proposal

**What this is:** a design proposal, not a content change. Nothing in
`rules/reception-pathways.json` is edited here. The v1.9 bundled set is
CSO-signed (Dr D. Triska, 2026-08-18). Slimming *questions* or changing
*when* a red flag must be answered is a later CSO review, not a silent
data edit.

**Ask:** the bundled capture scripts feel long. Slim them, stay safe,
make the flow work on a live reception **call**. Constraint added
2026-08-22: **tap out at 10 questions total**, even if that means
amalgamating.

**Verdict in one line:** a call is ten spoken turns, not twenty yes/no
rows — amalgamate same-tier red flags into two safety lists, give each
pathway two clinical slots, and stop the line on a 999.

---

## 1. What receptionists actually face today

The capture form (`side-panel/modules/reception/reception.js`
`renderCaptureForm`) is **one scroll of three equal-looking sections**:

1. **Red flags — ask every one** (yes/no, **required** — Generate will
   not fire until every flag has an answer)
2. **About the problem** (own-words + pathway questions — **optional**)
3. **Wrapping up** (six shared closing questions — **optional**)

Then, only after every red flag is answered and none is positive: the
disposition card, confirmed-age field, and booking card.

That last sentence is the trap. Confirmed age — the one fact that could
hide a child-only flag — sits **below** the longest lists. Generate sits
below 20-odd rows. The 999 banner appears at the top, but the next
action is still “finish the form”.

The safety notice itself assumed a shorter script: CSN limitation 27
talks about a “10–15 question phone capture”. The shipped set has grown
past that. The 10-question cap below takes the bottom of that range as
the hard ceiling for a **call**.

### Item count per pathway today (everything on the scroll)

Own-words is counted once. Closing is the six shared questions every
time. History questions do **not** block Generate; they still occupy the
eye and the call.

| Pathway | Red flags (required) | History Q | Closing | Visible items |
|---|---:|---:|---:|---:|
| Headache | 11 | 7 | 6 | **25** |
| Cough | 9 | 8 | 6 | **24** |
| Gynae / urinary (female) | 9 | 8 | 6 | **24** |
| Feverish child | 8 | 8 | 6 | **23** |
| Urinary / genital (male) | 8 | 8 | 6 | **23** |
| Mental health | 9 | 6 | 6 | **22** |
| Rash | 7 | 8 | 6 | **22** |
| Sore throat | 7 | 7 | 6 | **21** |
| Something else / general | 11 | 3 | 6 | **21** |
| Earache | 6 | 7 | 6 | **20** |
| Sinusitis | 7 | 6 | 6 | **20** |
| Urinary (woman 16–64) | 7 | 5 | 6 | **19** |
| Low back pain | 6 | 6 | 6 | **19** |

Mental health is the only pathway that was *designed* short (NG225: no
scores, no disposition). It still looks long because nine red flags plus
six closings sit on the same scroll as the six history lines.

---

## 2. Why it feels long (the real problems)

Not “receptionists won’t ask safety questions”. Three structural ones:

**A. Optional work is dressed as mandatory.** Section titles are `1 ·`
`2 ·` `3 ·`. Only section 1 is gated. A receptionist in a queue will
treat the whole page as the job. That is how a 7-flag pathway becomes a
20-item call.

**B. Every flag is asked of every caller, including ones that cannot
apply.** “If a child…”, “If a baby under 18 months…”, “brand-new
headache in someone over 50…”, “If the problem involves the penis…”,
“If the cough has lasted more than 3 weeks…”. Asking a 54-year-old man
whether the baby’s fontanelle is bulging trains people to skim.

**C. Generate cannot fire on a 999 until the rest of the list is
ticked.** After “thunderclap — yes” the tool still wants ten more
yes/no answers. That is the opposite of the escalation text (“do not
put the caller in a queue”). Capture text already supports `NOT ASKED`.
The form refuses to use it.

Secondary drag, not the main event:

- Closing always adds six questions, two of which duplicate pathway
  lines (`tried` vs rash/earache analgesia; `wants` vs mental-health
  `hoping`).
- Several history lines re-ask a red flag in slower words (cough
  weight-loss, gynae ovarian cluster, GU blood/fever/testicle, gynae
  pregnancy / post-coital / unwell).
- FeverPAIN / Centor extras (glands, cough, quinsy history) belong to
  the pharmacist or the GP, not the person routing the call.
- The side panel is narrow. A 25-row form puts Generate below the fold
  on a typical docked panel.

---

## 3. Safety invariants (do not bargain these)

From the frozen intended-purpose statement and CSN limitation 27:

1. This is **structured capture**, not triage. A full set of “no”
   answers is not “safe to routine”. The receiving clinician reads every
   capture.
2. The question set is **fixed and identical-every-time** *for a given
   presenting problem*. Age-gating a child-only flag is not triage if
   the capture stamps `NOT ASKED (age gate, confirmed 42y)`. Branching
   on “they sound fine” is triage and is out.
3. **Red-flag *meanings* stay.** Do not delete a signed-off flag to hit
   ten. Amalgamate **same-tier** flags into one spoken question (see
   §4). The paste still names every id that was shown.
4. **No conditional escalations.** `escalate` stays `999` or `duty` on
   each **id**. A 999 list and a duty list are two questions, not one
   “yes = maybe 999 maybe duty” blob. The headache GCA split and the
   gynae bleed split exist because of this rule — they stay as separate
   *ids* inside the right amalgam, not re-bundled into one escalate.
5. **Do not read sex or pregnancy from the open record** to hide a
   flag. Confirmed age on *this* call is already the fail-closed pattern
   (disposition / Pharmacy First). Record demographics are how a
   three-year-old inherits an adult script.
6. **Mental-health stays non-stratifying.** No score, no destination,
   no “this one looks low risk so skip the rest”. Amalgamating the 999
   MH flags into one danger-now list is a spoken-form change, not a
   risk tool.
7. **Clinician-only pathways** (`gu-male`, `gyn-female`, `mental-health`,
   `general`) must not grow a Pharmacy First suggestion as a side-effect
   of slimming.

Anything below that respects those is fair game.

---

## 4. Hard cap: 10 spoken questions on a call

A **question** is one turn the receptionist puts to the caller. A
checklist read as “I’m going to read a short list — say if any apply”
is **one** question. A fused “how long, and is it better or worse?” is
**one** question. Each current yes/no red-flag row is how we blew past
fifteen.

The cap is **≤10 for a completed all-clear capture**. A 999 can tap
out at 5 (caller, age, own words, duration, emergency list → Generate).

Walk-in / desk contacts can still open “More for the clinician”. The
ten is the **call script**, not a ban on extra fields existing.

### Shared skeleton (every pathway)

| # | Slot | Ask |
|---|---|---|
| 1 | Caller | Am I speaking to the patient, or someone on their behalf? |
| 2 | Age | Age on this call (gates child / over-50 lines; fail closed if blank — show every age-gated flag) |
| 3 | Own words | In their words, what’s the problem? |
| 4 | Duration / course | How long, and is it better, worse, the same, or coming and going? |
| 5 | **999 amalgam** | “Any of these — we stop and call 999 / get the duty doctor as an emergency.” Mandatory **None of these**. |
| 6 | **Duty amalgam** | “Any of these — same-day duty, not routine.” Mandatory **None of these**. Skipped after a 999 yes. |
| 7 | Pathway A | One condition-specific turn (see §6) |
| 8 | Pathway B | One more, or unused |
| 9 | Wants | What were you hoping for today? |
| 10 | Contact | Best number today — OK to leave a message? |

That is the whole call. `lastSeen` and a standalone `tried` live under
More. `tried` may be folded into Pathway B where it actually changes
the route (earache analgesia, feverish-child antipyretics).

### How amalgamation stays honest

- **Same tier only inside one list.** Question 5 is every *shown* 999
  id for that pathway. Question 6 is every *shown* duty id. Never mix
  tiers in one “any of these?” with a single escalate.
- **Ids stay.** Ticking “thunderclap” still writes `rf-thunderclap:
  yes`. Unticked items on a list that has **None of these** checked
  write `no`. Neither None nor any tick → unanswered, Generate blocked
  (fail closed). Do not treat an empty list as “all no”.
- **Age / area gates change who appears on the list, not the count.**
  A child-only 999 line is an extra bullet inside question 5, not
  question 11.
- **Which-ones is the list itself.** Do not add a follow-up “which of
  those?” — that would be question 11. The ticks *are* the which.
- **Mental health** uses the same two-list shape (danger-now / duty),
  read as full sentences, not a chip cloud. NG225 is about not scoring;
  it is not a ban on reading two short lists.

### Why not one single safety question

Amalgamating 999 *and* duty into one breath saves a slot and buys a
third pathway question. It also hides the stop-the-line moment inside
a mixed list, and it re-creates the conditional-escalation smell
(“yes — but which tier?”). Two lists, ten questions, two pathway
slots. If a pathway truly cannot live in two slots, fuse the *history*
lines (bleeding + pain, temp + wet nappies), not the tiers.

### Flow (not a 111 wizard)

One-question-per-screen is still rejected: extra clicks, caller talks
over the script, looks like triage.

The call form is **one screen of ten slots**, sticky 999 banner,
sticky **Generate now**. Questions 7–10 stay visible but do not block
a 999 generate. “More for the clinician” is a drawer, not slots 11–20
dressed as the job.

```
┌──────────────────────────────────────────┐
│ Sore throat                    Initials  │
│ Call script  6 / 10                      │
├──────────────────────────────────────────┤
│ 1  Caller          [ patient / other  ]  │
│ 2  Age this call   [ 42 ]                │
│ 3  Own words       [ ………… ]              │
│ 4  How long / course                     │
│ 5  Emergencies — any of these?           │
│      □ can’t breathe / noisy breathing   │
│      □ drooling / can’t swallow saliva   │
│      □ non-blanching rash                │
│      ☑ None of these                     │
│ 6  Duty today — any of these?            │
│      □ hot-potato voice / can’t open     │
│      □ one-sided + face/neck swelling    │
│      □ immune-suppressing medicine       │
│      ☑ None of these                     │
│ 7  Fever last 24h, and eating/drinking?  │
│ 8  (unused on this pathway)              │
│ 9  Hoping for      [ callback / … ]      │
│ 10 Number + message OK                   │
│                                          │
│ [ Generate ]     More for the clinician  │
└──────────────────────────────────────────┘
```

Walk-ins and quiet moments can open More (FeverPAIN extras, last seen,
smoking, PSA…). That must not be the default call path.

---

## 5. What still must be askable (just not as its own turn)

For each leftover line: **does a yes change what reception does in the
next sixty seconds**, or does it only make a nicer note for the GP?

### Inside the two safety lists (not extra questions)

Every signed red flag, **when it can apply**, is a bullet on question
5 or 6.

| Flag | Hide the bullet when |
|---|---|
| `rf-unwell-child` (sore throat, earache) | Confirmed age ≥ 16 |
| `rf-fontanelle`, `rf-under3m` (feverish child) | Confirmed age rules them out |
| Headache `rf-new50` / `rf-new50-visual` | Confirmed age < 50 |
| Cough `rf-weightloss` | Duration (Q4) already given and is ≤ 3 weeks |
| GU-male `rf-priapism` / `rf-paraphimosis` | Prefix stays on the bullet (“if this involves the penis / foreskin”) — do not spend a slot on area before the lists |
| Urinary `rf-male-child` | Woman-16–64 tile **and** confirmed age 16–64 → replace the bullet with a wrong-pathway escape, not a seventh flag |

**Do not hide** pregnancy, blood-thinners, immunosuppression, or
mental-health bullets from the open record.

Duration sits at question 4 so the cough >3-week bullet can appear on
question 6 in the same call. Age sits at question 2 so child bullets
can appear on question 5.

### Pathway slots (questions 7–8 only)

- Duration is already question 4 — do not ask it again.
- Own words is already question 3.
- Pharmacy First still needs a *symptom* turn: UTI multi, sinus nasal,
  ear side + discharge, rash where + spreading.
- Sore throat still needs eating/drinking (not fully covered by the
  drooling 999 bullet).
- Mental health still needs who-is-with-them and known-to-a-team
  (context, not a score).
- Wants and contact stay 9 and 10. Those are the reception job.

### Drop from the call script (drawer or delete)

**Duplicates of a flag or of 9/10 — delete from `questions`:**

- Cough `weightloss` — duty bullet.
- Rash `tried` / earache `analgesia` / mental-health `hoping`.
- Feverish-child `age`.
- Gynae `pregnancy`, `postcoital`, `ovarian`, `unwell` — already
  bullets. Bleeding + pain fuse into question 7.
- GU-male `blood`, `fever`, `testicle` — already bullets.

**Clinician extras — drawer only:**

- Sore throat: cough, glands, earache, quinsy history.
- Earache: hearing (sudden loss is a duty bullet), grommets.
- Cough: sputum, wheeze, smoking.
- Headache: location, /10, photophobia, vomiting, painkiller days.
- Back pain: trigger, function, previous episodes.
- Sinusitis: toothache, previous.
- Feverish child: imms, “other symptoms” multi.
- Rash: exposures, itch/pain, blisters.
- Urinary: previous UTI count. Antibiotic allergy **is** question 8
  when Pharmacy First is in play.
- GU-male: perineal pain, prostate/PSA.
- Gynae: LMP/menopause unless already implied by a PMB bullet.
- Closing: last seen. Course is already inside question 4.

---

## 6. Per-pathway call script (exactly the ten, or fewer)

Red-flag *meanings* unchanged. Each line below is one spoken turn.
“— / —” means that slot is unused (call ends at 9).

| # | Shared | Sore throat | Earache | Cough | Urinary ♀ 16–64 |
|---|---|---|---|---|---|
| 1 | Caller | | | | |
| 2 | Age | | | | |
| 3 | Own words | | | | |
| 4 | Duration / course | | | | |
| 5 | 999 list | breathe, drool, non-blanching, floppy/not drinking if child | mastoid, meningism, floppy child | can’t finish sentence, blue lips, large/painful haemoptysis, PE, severe chest pain, confusion | urosepsis, rigors, new confusion |
| 6 | Duty list | hot-potato / trismus, one-sided + swelling, immune meds | head injury / CSF, sudden deaf, facial droop | streaky blood, >3wk weight-loss/sweats (if Q4 >3wk), inhaler failing | loin pain, vomiting, pregnancy chance, (male/child escape) |
| 7 | Pathway A | Fever last 24h **and** eating/drinking | Which ear **and** discharge | Breathless on exertion **and** known asthma/COPD / inhalers | Which of these UTI symptoms (multi) |
| 8 | Pathway B | — | Fever (if not already in own words — else —) | — | Antibiotic allergy (PF) |
| 9 | Wants | | | | |
| 10 | Contact | | | | |

| # | Headache | Back pain | Sinusitis | Feverish child | Rash |
|---|---|---|---|---|---|
| 5 | thunderclap, FAST/neuro, meningism, injury+vomit/drowsy, red eye + halos, GCA+visual if ≥50, morning-worse + vomit, household same headache (CO) | saddle, bladder/bowel, both legs | orbital / pushed eye / vision, forehead swelling, meningism, new confusion/weakness/slur | non-blanching, floppy/cry, fontanelle if <18m, breathing/grunting, colour, seizure, neck/light | non-blanching, anaphylaxis, spreading+unwell (NF), blistering+mucosa (SJS), meningism |
| 6 | GCA no visual if ≥50, pregnant + severe, thinners after a knock | trauma, fever/unwell (± IVDU/immune/surgery), cancer + new pain | rapidly worse + very unwell, immune meds, one-sided bloody/green discharge | under 3 months + any fever, no wet nappy 12h / sunken eyes | new drug + unwell, changing mole |
| 7 | Same as their usual headaches, or different? | Pain below the knee — no / one / both | Blocked or runny nose — colour | Temp if measured **and** drinking / wet nappies | Where **and** is it spreading? |
| 8 | — | — | Fever | How are they in themselves? (playing / clingy / sleepy) | Fever or unwell with it? |

| # | General | GU-male | Gynae | Mental health |
|---|---|---|---|---|
| 5 | can’t breathe, chest pain now, FAST, heavy bleeding, collapse/confusion, anaphylaxis, sepsis, MH attempt/means, overdose/injury-to-other, self-harm injury that needs ED, acute psychosis | torsion, retention, sepsis, priapism (if penis) | ectopic pain/faint, ectopic shoulder, heavy early-preg bleed / faint, sudden pelvic + vomit/faint, sepsis | attempt / plan+means now, danger now (OD / injured / other at risk), self-harm injury that needs ED, psychosis rapidly worse |
| 6 | MH thoughts no plan, visible haematuria 45+, hoarseness ≥3wk | loin+fever, paraphimosis (if foreskin), visible blood, painless testis lump | early-preg bleed/tissue without faint, PMB, PCB more than once, ovarian cluster ≥3wk | thoughts no plan, self-harm today injury not ED, psychosis present not worse, safeguarding, no safe place / nobody with them |
| 7 | What is the main thing worrying them? | Waterworks / testicle / both / other **and** burning | Bleeding vs a normal period **and** pain (side /10) | Is anyone with you just now? |
| 8 | How is day-to-day life affected? | LUTS multi (frequency, stream, urgency…) | Unusual discharge (colour / smell / itch) | Already known to an MH / crisis team? |

Mental-health own words (Q3) *is* “what’s happening today — their
words, do not interpret”. Do not also ask `harm-thoughts` or `hoping`.
`safe-now` is the 999 list, not a fourth MH question.

Gynae LMP/menopause and GU prostate/PSA stay in the drawer. The
clinician gets them if reception has time; they do not own a slot.

### Counts vs today

| Pathway | Today | Call script | How the cut is made |
|---|---:|---:|---|
| Headache | 25 | **9** (slot 8 unused) | 11 flags → 2 lists; history → 1 |
| Cough | 24 | **9** | 9 flags → 2 lists; drop sputum/smoke/weight-loss Q |
| Gynae | 24 | **10** | 9 flags → 2 lists; bleed+pain fused |
| Feverish child | 23 | **10** | 8 flags → 2 lists; temp+fluids fused |
| GU-male | 23 | **10** | 8 flags → 2 lists; area+dysuria fused |
| Mental health | 22 | **10** | 9 flags → 2 lists; drop hoping / harm-thoughts / safe-now as rows |
| Rash | 22 | **10** | 7 flags → 2 lists; where+spreading fused |
| Sore throat | 21 | **9** | 7 flags → 2 lists; fever+eat/drink fused |
| General | 21 | **10** | 11 flags → 2 lists |
| Earache | 20 | **10** | 6 flags → 2 lists; side+discharge fused |
| Sinusitis | 20 | **10** | 7 flags → 2 lists |
| Urinary | 19 | **10** | 7 flags → 2 lists (+ escape) |
| Back pain | 19 | **9** | 6 flags → 2 lists |

Nothing on this table deletes a signed flag. Unused slots are unused,
not hidden clinical content.

---

## 7. Stop-on-999 (the one engine change)

Today `generateSummary` refuses until `unanswered.length === 0`.

**Proposal:** if any **shown** 999 id is ticked, Generate is allowed.
Question 6 and slots 7–10 record as `NOT ASKED (stopped — 999)`. The
banner stays red. Disposition and booking stay suppressed (they
already die on any positive).

Duty-level yes on question 6: **do not** skip the rest of that list
(the ticks are the list). Slots 7–10 stay optional. A duty tick must
not skip an unanswered 999 list — question 5 is always first.

This is a small engine change with a large safety argument: the
escalation text already says stop. The form should not argue.

CSO signs the *rule* (“999 may leave later slots unasked”), not new
flag sentences.

---

## 8. What I would not do

- **Do not delete signed red flags to hit ten.** Ten is a spoken-turn
  budget. Amalgamate, gate, or fuse history. Do not drop thunderclap,
  saddle anaesthesia, or FAST.
- **Do not auto-mark remaining flags “no”.** `NOT ASKED` is honest; a
  fake “no” is a forged screen.
- **Do not hide pregnancy / MH / immunosuppression from the record.**
- **Do not add a “skip remaining — they sound well” control.**
- **Do not turn this into NHS 111.** Different legal and clinical
  object. Care-navigation suggestions stay suggestions.
- **Do not mix 999 and duty in one “any of these?”** with a single
  escalate. That is how you re-introduce conditional escalation.
- **Do not treat an empty amalgam as all-no.** None-of-these is a
  required tick.
- **Do not let a custom pack inherit stop-on-999 without the same
  stamp.** Practice-authored pathways use the same generate path.

---

## 9. How this would land (if you say go)

Three cuts, separately reviewable. The 10-cap is a **renderer +
schema** job first. Do not mix a wording delete into the amalgam PR.

### Cut 1 — call-script renderer (no new flag sentences)

- Age + duration move to slots 2 and 4.
- Red flags render as two amalgams (999 / duty) with required None.
- Generate allowed on a 999 tick; later slots stamp
  `NOT ASKED (stopped — 999)`.
- Slots 7–8 show only the two pathway questions in §6; everything
  else is the More drawer.
- Slots 9–10 are caller-already-asked… no: 1 and 9–10 as in the
  skeleton. Sticky Generate.

**Review:** CSO on amalgamation-as-spoken-form and stop-on-999.
Tests: none-of-these fail-closed, each id still round-trips in the
paste, booking still blocked on any positive, 10-slot cap asserted
per bundled pathway (`test-reception-pathways.js`: default call
script ≤10).

### Cut 2 — applicability schema

`showWhen` on a bullet (`ageMin` / `ageMax` / `durationDaysMin`).
Validate in `reception-pathway-utils.js`. Stamp gated ids. No
confirmed age → show every age-gated bullet (today’s behaviour).

### Cut 3 — content slim (CSO + Keeper)

Delete the duplicate `questions` in §5. Shorten the two
paragraph-length headache bullets (GCA-with-visual, morning vomit) to
one spoken clause each — **meaning unchanged**. Bump `specVersion` /
`lastUpdated`.

---

## 10. Open questions for Dave

1. **Two safety lists vs one.** This draft spends two of the ten on
   999 then duty, so we never mix tiers. One mixed list would free a
   third pathway slot (gynae LMP, cough smoking). I would not.
2. **Age as a question.** Counted. If you do not count confirmed age,
   every pathway gains a spare slot — I would still not put FeverPAIN
   extras back on the call.
3. **Age gate for “if a child”** — 16, fail closed if blank.
4. **Urinary male/child** — wrong-pathway escape, not a duty bullet,
   once age 16–64 is confirmed on that tile.
5. **Walk-in vs call.** Ten is the call script. Same form, More drawer
   for desk contacts who have time. Or do you want a literal second
   mode?
6. **Pop-out vs docked.** Same ten both places. Booking stays
   docked-only.

---

## 11. Recommendation

Accept ten as the call ceiling. Build Cut 1 as a renderer over the
existing ids so the signed meanings do not move. Then walk the §6
lists once as CSO (are these the right bullets on the 999 card?) and
only then delete duplicate history lines.

The first build that is still 13–16 “default items” has not met this
constraint. If a pathway cannot be told in ten turns after fusing
history, the next lever is a tighter 999 card — not a longer form.
