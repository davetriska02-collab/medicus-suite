# Reception pathways — slim-down proposal

**What this is:** a design proposal, not a content change. Nothing in
`rules/reception-pathways.json` is edited here. The v1.9 bundled set is
CSO-signed (Dr D. Triska, 2026-08-18). Slimming *questions* or changing
*when* a red flag must be answered is a later CSO review, not a silent
data edit.

**Ask:** the bundled capture scripts feel long. Can we slim them, stay
safe, and make the flow work better on a live reception call? Blue-sky:
multi-panel vs one scroll; are all questions needed for every condition?

**Verdict in one line:** keep every red-flag *meaning*, stop treating the
history block as part of the same job, and stop the line on a 999 — do
not replace the scroll with a 111-style one-question wizard.

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
past that.

### Item count per pathway (everything on the scroll)

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
3. **Red flags are escalation triggers, not exclusions.** Do not delete
   a signed-off flag because the list is long. Merge two flags only when
   they are the same clinical meaning at the same tier — and that is a
   CSO edit, not a UX trick.
4. **No conditional escalations.** `escalate` stays `999` or `duty`.
   The headache GCA split and the gynae bleed split exist because of
   this rule. Do not re-bundle them to save a row.
5. **Do not read sex or pregnancy from the open record** to hide a
   flag. Confirmed age on *this* call is already the fail-closed pattern
   (disposition / Pharmacy First). Record demographics are how a
   three-year-old inherits an adult script.
6. **Mental-health stays non-stratifying.** No score, no destination,
   no “this one looks low risk so skip the rest”.
7. **Clinician-only pathways** (`gu-male`, `gyn-female`, `mental-health`,
   `general`) must not grow a Pharmacy First suggestion as a side-effect
   of slimming.

Anything below that respects those is fair game.

---

## 4. Blue-sky: multi-panel vs scroll

### One-question-per-screen wizard (111-style)

**Reject for this product.** Extra clicks on a live phone call; the
caller talks over the script; the next question is hidden so the
taker cannot glance ahead; it *looks* like a triage algorithm, which
is exactly what the CSN says this is not. Fine for a public website.
Wrong for a receptionist with a headset and a queue.

### Three-step wizard (Safety → History → Finish)

Better, still too stiff. Callers answer out of order (“and I’ve had it
two weeks, and my sister had tonsillitis”). A hard wizard fights that.
Draft restore across steps is fiddly. The narrow panel spends chrome on
a stepper.

### Keep today’s single scroll, just delete questions

Helps the count, does not fix Generate-below-the-fold or “ask the
fontanelle question of a teenager”. Content slim without a flow change
is a third of the win.

### Recommended: **stop-the-line panels, not a wizard**

Two panels plus an optional drawer. Same questions, different attention.

```
┌──────────────────────────────────────────┐
│ Sore throat                    Initials  │
│ [ Safety ]   History    Finish           │  ← tabs, not a locked wizard
├──────────────────────────────────────────┤
│ Age on this call   [ 42 ] years          │  ← FIRST, gates child flags
│                                          │
│ 1 · Red flags — every one that applies   │
│     6 of 6 shown · 3 answered            │
│                                          │
│ Any difficulty breathing…        Yes No  │
│ Drooling / can’t swallow saliva  Yes No  │
│ …                                        │
│                                          │
│ ⚠ RED FLAG — advise 999 now.             │  ← sticky
│ [ Generate now ]                         │  ← sticky, enabled on 999
└──────────────────────────────────────────┘
```

**Panel A — Safety (default).** Confirmed age + the red flags that
apply + own-words. Sticky escalate banner. Sticky **Generate now** once
either (i) every *shown* flag is answered and none is 999, or (ii) any
shown flag is 999.

**Panel B — History (optional).** The short “enough to route” set, with
FeverPAIN-class extras behind “More for the clinician”. Never blocks
Generate. Default-open after an all-clear so the taker is not
surprised; skippable.

**Panel C — Finish.** Three operational closings (who is calling, what
they want, best number). Disposition + booking stay here, still gated
on an all-clear red-flag screen. `lastSeen` / `course` / duplicate
`tried` sit under “More”.

The taker can jump A ↔ B ↔ C. Nothing is hidden from a Generate that
needs it. A 999 just does not make them walk the rest.

Why this and not a pure scroll: the sticky rail is the safety control.
The optional drawer is the honesty control (history was never required).
The age field at the top is the length control that does not delete
clinical content.

---

## 5. Are all questions needed? Three buckets

For each line, ask: **does a yes change what reception does in the
next sixty seconds** (999 / duty / Pharmacy First / book / take a
number), or does it only make a nicer note for the GP?

### Bucket 1 — must ask (or must remain askable)

- Every signed red flag, **when it can apply**.
- Own words.
- Duration on infection / pain pathways (Pharmacy First and “how long”
  are how those routes are judged).
- The symptom cluster that defines the Pharmacy First offer (UTI
  multi-select; sinus nasal; ear side + discharge).
- Eating/drinking on sore throat (struggling with fluids is the
  practical severity the duty doctor wants, and it is not fully covered
  by the drooling 999 flag).
- Mental-health: today’s words, who is with them, known to a team.
  Not a score — context for the clinician who will ring back.
- Closing: **caller**, **wants**, **contact**.

### Bucket 2 — ask when it applies; hide when it cannot

These stay in the JSON. The form stamps `NOT ASKED` with a reason.

| Flag / question | Hide when |
|---|---|
| `rf-unwell-child` (sore throat, earache) | Confirmed age ≥ 16 |
| `rf-fontanelle`, `rf-under3m` (feverish child) | Confirmed age rules them out |
| Headache `rf-new50` / `rf-new50-visual` | Confirmed age < 50 |
| Cough `rf-weightloss` | Duration already given and is ≤ 3 weeks |
| GU-male `rf-priapism` / `rf-paraphimosis` | Area is “waterworks” only |
| Urinary `rf-male-child` | Already on the woman-16–64 tile **and** confirmed age 16–64 — keep a one-line “wrong pathway? go back” instead of a seventh flag |

**Do not hide** pregnancy, blood-thinners, immunosuppression, or
mental-health flags from demographics. Those are volunteered or asked.

Move **confirmed age to panel A**. Today it only appears on the
disposition card, after the long list, and only to unlock Pharmacy
First. It is doing the wrong job in the wrong place.

### Bucket 3 — drop from the default script (keep as optional extra, or delete)

Safe to take off the main path because they **duplicate a red flag**,
**duplicate a closing question**, or are **clinician/pharmacist work**.

**Duplicates (prefer delete from `questions`, keep the flag):**

- Cough `weightloss` — same ground as `rf-weightloss`.
- Rash `tried` — shared closing `tried`.
- Earache `analgesia` — same.
- Mental-health `hoping` — shared closing `wants`.
- Feverish-child `age` — confirmed age on panel A.
- Gynae `pregnancy`, `postcoital`, `ovarian`, `unwell` — already binary
  red flags. Keep **bleeding** and **pain** as optional free-text if the
  flag was yes (the story, not a second screen).
- GU-male `blood`, `fever`, `testicle` — already flags. Keep `area`
  (it gates the others) + LUTS.

**Clinician extras (keep in JSON, default-collapsed):**

- Sore throat: cough, glands, earache, quinsy history (FeverPAIN lives
  in Pharmacy First / the GP consult, not reception).
- Earache: hearing (sudden complete loss is already a flag), grommets.
- Cough: sputum colour, wheeze, smoking.
- Headache: location, /10, photophobia, vomiting, painkiller days
  (meningism / raised-ICP flags already cover the dangerous versions).
- Back pain: trigger, function, previous episodes. Keep duration +
  “pain below the knee” on the main path.
- Sinusitis: toothache, previous. Keep duration + nasal.
- Feverish child: imms, “other symptoms” multi, antipyretics. Keep
  temp, duration, drinking, behaviour.
- Rash: exposures, itch/pain, blisters. Keep where, duration,
  spreading, fever/unwell.
- Urinary: previous UTI count, antibiotic allergy — **promote allergy
  if Pharmacy First is the likely destination**; otherwise extra.
- GU-male: perineal pain, prostate/PSA — extras.
- Gynae: discharge, LMP/menopause — extras unless bleeding/pain
  already opened the drawer.

**Closing slim:**

| Keep on Finish | Move under “More” |
|---|---|
| Caller (already first; tests pin this) | Last seen |
| What were you hoping for | Course (better/worse/same) |
| Best number + message OK | Tried — unless the pathway did not already ask |

That is minus three questions on every call, with no clinical flag
touched.

---

## 6. Per-pathway target (default script only)

Red-flag *meanings* unchanged. Counts are “what the taker is asked
unless they open More”. Age-gated flags are excluded from the default
count when the gate fires.

| Pathway | Default RF shown | Default history | Finish | Default items (all-clear adult) | Today |
|---|---:|---:|---:|---:|---:|
| Sore throat | 6 (child flag gated) | duration, fever, eat/drink | 3 | **13** | 21 |
| Earache | 5 | side, duration, fever, discharge | 3 | **13** | 20 |
| Cough | 8 (weight-loss gated on duration) | duration, fever, exertion, lung hx | 3 | **16** | 24 |
| Urinary | 6 + wrong-pathway line | symptoms, duration, (± allergy) | 3 | **13** | 19 |
| Headache | 9 (GCA pair gated <50) | duration/pattern, same-or-different | 3 | **15** | 25 |
| Back pain | 6 | duration, sciatica | 3 | **12** | 19 |
| Sinusitis | 7 | duration, nasal | 3 | **13** | 20 |
| Feverish child | 6–8 by age | temp, duration, drinking, behaviour | 3 | **14–16** | 23 |
| Rash | 7 | where, duration, spreading, fever | 3 | **15** | 22 |
| General | 11, clustered (below) | duration, main worry, impact | 3 | **18** clustered | 21 |
| GU-male | 6 + 2 gated on area | area, LUTS, dysuria | 3 | **13** | 23 |
| Gynae | 9 | bleeding, pain (if relevant) | 3 | **14** | 24 |
| Mental health | 9 (do not cut) | today, who-with, known-team | 3 | **16** | 22 |

Headache and general stay the long ones. That is correct: they are the
dangerous-undifferentiated nets. Slim them with **clustering and
gating**, not by deleting thunderclap or FAST.

### Clustered red flags (same ids, scan layout)

For headache and general only: render the 999 cluster as a tight yes/no
stack under “Emergencies — ask now”, and the duty/2WW cluster under
“Also ask if it fits”. Still one answer per `id`. Still no
multi-select that OR-s together different tiers (that would re-create
conditional escalation).

Mental-health flags stay a linear list. Clustering “are they in danger”
into a chip cloud is how you get a missed yes.

---

## 7. Stop-on-999 (the one engine change)

Today `generateSummary` refuses until `unanswered.length === 0`.

**Proposal:** if any **shown** flag is answered `yes` and escalates
`999`, Generate is allowed. Remaining shown flags record as
`NOT ASKED (stopped — 999)`. The banner stays red. Disposition and
booking stay suppressed (they already die on any positive).

Duty-level yes: **finish the remaining shown flags**. A duty “new
headache on thinners after a knock” can still upgrade to a 999 sitting
further down. That is why the GCA visual / non-visual split exists.

This is a small engine change with a large safety argument: the
escalation text already says stop. The form should not argue.

CSO needs to sign the *rule* (“999 may leave later flags unasked”),
not new wording.

---

## 8. What I would not do

- **Do not delete signed red flags to hit a number.** If a list is
  still long after gating, that is the condition being dangerous.
- **Do not auto-mark remaining flags “no”** to make Generate work.
  `NOT ASKED` is honest; a fake “no” is a forged screen.
- **Do not hide pregnancy / MH / immunosuppression from the record.**
- **Do not add a “skip remaining — they sound well” control.**
- **Do not turn this into NHS 111.** Different legal and clinical
  object. Care-navigation suggestions stay suggestions.
- **Do not slim mental-health red flags.** The history block can lose
  the two duplicates (`hoping`, and `harm-thoughts` if the flags were
  already asked). The flags stay.
- **Do not let a custom pack inherit stop-on-999 without the same
  stamp.** Practice-authored pathways use the same generate path; the
  rule is engine-level, not “bundled only”.

---

## 9. How this would land (if you say go)

Three cuts, separately reviewable. Do not mix a content edit into a
flow PR.

### Cut 1 — flow only (no JSON wording change)

- Age field to the top of the form.
- Sticky escalate + Generate rail.
- Sections 2 and 3 labelled optional; Finish shows three closings,
  the other three under More.
- Stop-on-999 generate, with `NOT ASKED (stopped — 999)` in the paste.
- Tabs A/B/C, freely jumpable, default A.

**Review:** CSO on the stop-on-999 generate rule. No Keeper pass.
Tests: `test-reception-core.js` generate/unanswered, booking still
blocked on any positive, capture text stamp.

### Cut 2 — applicability schema

Add an optional `showWhen` on a red flag or question
(`ageMin` / `ageMax` / `answered: { area: "Waterworks (passing urine)" }`).
Validate in `reception-pathway-utils.js`. Stamp gated ids as
`NOT ASKED (age gate, confirmed Ny)` / `NOT ASKED (not this area)`.

**Review:** CSO on the gate table in §5, not on new sentences.
Fails closed: no confirmed age → show every age-gated flag (today’s
behaviour). Wrong to hide a child flag because the record says 40.

### Cut 3 — content slim (CSO + Keeper)

Drop or collapse-default the Bucket 3 lines. Shorten the two
paragraph-length headache flags (GCA-with-visual, morning vomit) to
one spoken sentence each — **meaning unchanged, words shorter**. Bump
`specVersion` / `lastUpdated`. Run `test-reception-pathways.js` and
`test-reception-pathway-coverage.js`.

This is the only cut that re-opens signed wording. Do it last, on its
own commit, with a one-page CSO diff (“removed X because it duplicates
flag Y; shortened Z”).

---

## 10. Open questions for Dave

1. **Stop-on-999** — agree that later flags may be `NOT ASKED`, or keep
   forcing a full screen even after thunderclap / saddle anaesthesia /
   non-blanching rash?
2. **Age gate threshold for “if a child”** — 16 (above) vs 12 vs
   “confirmed adult appearance”? Recommend 16, fail closed if age blank.
3. **Urinary `rf-male-child`** — keep as a real flag (current, very
   safe, slightly insulting on a woman-16–64 tile) or replace with a
   wrong-pathway escape?
4. **Cut 1 only first?** That is the reception-effectiveness win
   without touching signed sentences. Cuts 2–3 are how the lists
   actually get shorter.
5. **Pop-out vs docked panel** — same flow both places. Booking stays
   docked-only, as now.

---

## 11. Recommendation

Ship the *shape* before the *deletes*.

A receptionist on a 90-second call needs: the flags that can kill
someone, a way to stop when one fires, three wrap-up facts, and a
paste. Everything else is a gift to the GP and should look like one.

If you want a first build, start Cut 1. If you want a first CSO
session, walk the Bucket 3 table with the v1.9 file open and tick
delete / collapse / keep.
