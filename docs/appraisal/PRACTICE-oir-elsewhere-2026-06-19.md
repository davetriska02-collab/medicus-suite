# The Practice — appraisal: OIR "resulted elsewhere" feature (v3.119.0)

Date: 2026-06-19.
Scope: The `enrichWithHistory` pass on the Outstanding Investigation Requests card
(Review Investigation Report task detail page), specifically the "resulted elsewhere"
badges, "Tick off" button, and confirmation gate.
Lens: features / UX / ease-of-use, weighted toward ease-of-use.

**These personas are synthetic.** They are a structured heuristic for surfacing
UX and safety friction cheaply. Nothing here is real user testing and no line
may be cited as "a clinician said X."

**Mock fidelity note.** The screenshots the panel reviewed were rendered from a
static mock using the real `hud.css` tokens. One state was more favourable than
the real implementation: the mock showed the `elsewhereDate` as visible text
beside the badge, whereas the real code (`content.js` line 2318) puts it only in
`badge.title` (hover tooltip). All panel comments about "the dates are useful"
reflect the mock. In the real product, the date is invisible until hover —
that is a concrete code defect, not a design question.

---

## The panel

| Handle | Role | Band | Score /10 |
|---|---|---|---|
| Dr Margaret Aldous | senior GP partner | technophobe | 6 |
| Sister Eileen Cobb | practice nurse | reluctant | 6 |
| Dr Tom Hollis | salaried GP | pragmatist | 7 |
| Dr Sam Okonkwo | locum GP | pragmatist | 7 |
| Dr Priya Nair | GP registrar | savvy | 7 |
| Raj Patel | clinical pharmacist | savvy + domain | 7 |

---

## Verdict

Not yet best-of-type for all users, but the bones are right and it solves the
stated problem cleanly. Every persona — including the technophobe — understood
what the card was doing inside five seconds, and all six praised the confirmation
dialog as correctly proportioned to the clinical weight of the action. The feature
consistently earns 6-7/10 across the full band range, which for a first pass at a
complex clinical flow is a solid result.

The single biggest thing carrying it: differentiation. FIT, XR Knee, and Bone
Profile correctly stay "outstanding" where a naive match-all tool would have
cleared them — and every clinician-band noticed and valued that. The confirm
gate ("this is your clinical decision") was praised by all six as the right framing.

The single biggest thing holding it back: **"elsewhere" is a word that invites
trust it hasn't earned.** Every persona, independently, wanted to know WHERE the
result came from and what it actually said before clicking OK. The feature shows
a date (in a tooltip the panel couldn't see without the mock cheat); it does not
show the source, the actual result value, or whether that result was previously
reviewed. Without those three things, a careful clinician is ticking off a
result from an unknown source that might have been abnormal.

---

## Findings by bucket

### Universal friction — every band hit these

**U1 [MAJOR — all bands] "Elsewhere" carries no source context.**

Every persona asked: elsewhere where? Another GP surgery? A hospital outpatient
lab? A previous private test? A pharmacy? "Elsewhere" as written means only "not
this report." A locum (Sam) making a tick-off decision for a patient they don't
know is relying on one word that could mean anything. Even a minimal source label
("from: observation history" or "Medicus lab record") would ground the decision.

Ruling: **Adopt.** Source label should appear on the badge or in the dialog.
"From: observation history" is accurate and sufficient for now.
Fix: small text label added to the badge or dialog body.
Effort: S (under 2h).

---

**U2 [MAJOR — all bands] "↩? elsewhere?" badge explains nothing.**

The dashed amber border and "?" communicate uncertainty visually. They explain
nothing. Margaret: "explain in a word, not a doodle." Sam: no tooltip, cannot
action it. Raj: "amber badge alone with a question mark is not enough." The reason
WHY a match is uncertain is already computed by the engine (e.g. "only 1 analyte
matched: TSH") but currently surfaces nowhere visible.

`verdict.reason` for tentative elsewhere is generic ("possibly resulted elsewhere
— confirm before clearing"). That needs to be made specific: "Possible match:
1 analyte (TSH) found — check Thyroid function in patient history."

Ruling: **Adopt.** Tooltip on `ch-oir-elsewhere-tentative` badges should expose
a specific reason. The engine needs to surface the matched analyte name(s) in the
reason string, not just a generic phrase.
Fix: engine enriches `reason` for tentative elsewhere with matched analyte names;
content.js uses that on `badge.title`.
Effort: S-M.

---

**U3 [MAJOR — all bands] Date is tooltip-only — invisible in the real product.**

This is the mock fidelity gap. In `content.js`, the `elsewhereDate` appears only
in `badge.title` (a hover tooltip) and in the confirm dialog. The badge text is
just "↩ resulted elsewhere." The mock rendered the date visibly, which is why
six personas said "the dates are useful" — they were reading a rendering that
does not exist in the real product. In the real product a clinician on a 10-min
appointment will never hover a badge.

Ruling: **Adopt.** Date should appear inline in the badge text:
"↩ elsewhere · 02 Apr 2026"
One-line change to `annotateOutstandingRow`. The reason string can keep the date
in its tooltip form as a second-channel check.
Effort: S.

---

### The tech-literacy gradient

**G1 [MINOR — Sam/Priya] Auto-ticked green badge misread as prior work.**

Sam and Priya independently assumed on first load that the green ticked Lipid
Profile had been worked by another user in an earlier session. The badge says
"✓ resulted" — it could equally mean "already ticked by the last person who
opened this task." A parenthetical distinguishes it:
"✓ resulted (this report)"

Ruling: **Adopt.** Small text change to badge label for the `ch-oir-resulted`
case when it comes from the current report (i.e. `status === 'resulted'`).
Effort: S.

---

**G2 [MINOR — Tom] Date label missing when visible.**

Once the date is shown inline (U3 fix), it should be prefixed "Result:" so a
clinician scanning quickly cannot mistake it for the request date.
"↩ elsewhere · Result: 02 Apr 2026"

Ruling: **Adopt** as part of the U3 fix. No extra effort.

---

### Role-specific needs

**R1 [MAJOR — Eileen/Raj/Priya] Result value not accessible without navigating away.**

All three independently raised this. The badge tells them a result exists on a
date. It does not tell them whether it was normal. Eileen: "I know a result exists
somewhere, but I have no way of knowing if it's been reviewed and is safe to
clear." Raj: "show me the actual observation value and reference range inline on
click."

The engine already has access to `obs.history[0].rawValue` and `obs.unit`. These
could be passed through in the verdict (`matchedValue`, `matchedUnit`) and
surfaced in the confirm dialog:
"LFT · Most recent: 02 Apr 2026 · ALT 28 U/L (normal range: 7–56)"

This is the highest-value M-size fix: it closes the gap between "I know the
result exists" and "I can make the decision without leaving the card."

Ruling: **Adopt.** Requires engine change to surface matched observation value
in enriched verdict. Content.js threads it into the confirm dialog body.
Effort: M (half-day).

---

**R2 [MAJOR — Raj] Two PSA requests resolved to the same observation with no signal.**

Two outstanding PSA requests (Dr Azadian Feb 2026, Dr Nicholls Jul 2025) both
show "↩ resulted elsewhere (2026-03-18)." Raj correctly identified this: is one
March 2026 result being claimed as evidence for both? If yes, is that clinically
correct? And crucially — there is no signal to the clinician that two requests
are pointing at the same result.

Verified: the engine processes each verdict independently via `enrichWithHistory`,
so both do point at the same observation history entry. The decision to tick both
off is correct for the scenario (one result satisfies both outstanding requests for
the same test), but the clinician needs to know this.

Ruling: **Adopt.** When two or more outstanding requests resolve to the same
`elsewhereDate` + key, the confirm dialog should add a note:
"Note: this result also satisfies 1 other outstanding request for this test."
Effort: M.

---

**R3 [MAJOR — Raj/Eileen] Tick-off persistence is unstated.**

The confirm dialog says "removes it from the outstanding list" but does not say
whether this writes to Medicus or is extension-session-only. In practice,
`box.click()` fires the Quasar checkbox handler, which triggers Vue reactivity
and Medicus's server-side save — the tick IS written to the Medicus task record.
But no clinician knows this.

For a locum (Sam): "If I tick off LFT as resulted elsewhere and the registered
GP wanted it repeated here, I've just closed something I shouldn't have."
This is a real risk if the tick-off persists in Medicus and cannot be undone.

Ruling: **Adopt.** The confirm dialog should state "This will tick off the
request in Medicus" (if confirmed that it writes through) or "Extension-only:
this marks the request in this session only" (if it is session-local). Confirm
the actual write-through behaviour before shipping this fix.
**Action required:** verify whether `box.click()` on a Quasar checkbox on the
Outstanding Requests card writes to the Medicus server. If it does, the
irreversibility must be stated plainly in the dialog.
Effort: S once verified.

---

**R4 [MINOR — Priya] No undo for manual tick-offs.**

Once ticked via "Tick off," there is no visible mechanism to reverse the action.
If the Quasar checkbox write is immediate and server-side, an accidental tick-off
could only be reversed by a manual Medicus workflow. Priya: "I want to un-tick a
mistake."

Ruling: **Adapt.** Full undo is an L-size build. For now, the correct mitigation
is the confirm gate (already present) plus a clearer warning in R3. A separate
undo is desirable but not blocking.

---

**R5 [MINOR — Sam] No "confirmed outstanding" affordance for residual rows.**

Rows that remain "⏳ outstanding" after history enrichment have no action
available. Sam: "I want a way to record 'I've seen this, I know it's outstanding,
I'm chasing it.'" This would let a locum leave a visible trail.

Ruling: **Adapt — future roadmap item.** Implementing per-row "I've reviewed
this" marking requires persistence (either Medicus server-side or extension
storage keyed to the task). It is the right feature but out of scope for this
pass. Note for backlog.

---

### Standout strengths

**S1 Differentiation is excellent.** FIT, XR Knee, Bone Profile correctly stay
"⏳ outstanding" — not falsely matched. This is the feature the old "Match all"
button never had. Every clinician-band noticed and valued it. Protect this.

**S2 Confirmation dialog.** Six for six on praising the gate. Named test, date
(in dialog), explicit "your clinical decision," Cancel/OK. This is the right
architecture for a clinical action with real consequences. The verbosity Tom
noticed on the third/fourth use is the gate working as designed — do not shorten
it.

**S3 Loading progression.** Auto-tick of the current report's test shows
immediately; history enrichment follows asynchronously. The card is never blocked
and the first-arrived verdict is always safe (report-only). Good resilience design.

**S4 Badge colour hierarchy.** Green / blue / amber / grey reads clearly in both
light and dark modes. Dark-mode rendering holds without token collapse.

---

## Prioritised path to best-of-type

| # | Fix | Effort | Personas unblocked | Skill to route to |
|---|---|---|---|---|
| 1 | Show date inline in badge: "↩ elsewhere · Result: 02 Apr 2026" | S | All 6 | Code (1-line) |
| 2 | Add source label "from: observation history" to badge/dialog | S | All 6 | Code |
| 3 | Add "(this report)" to auto-tick green badge label | S | Sam, Priya | Code |
| 4 | Verify tick-off write-through to Medicus; state in dialog | S | All 6 | Engineering verify |
| 5 | Enrich tentative `reason` with matched analyte names; surface on tooltip | S-M | All 6 | Engine + content.js |
| 6 | Surface matched observation rawValue in confirm dialog | M | Eileen, Raj, Priya | Engine + content.js |
| 7 | Note in dialog when two requests resolve to same observation | M | Raj | Content.js |
| 8 | Clickable badge/date → navigate to matched observation | L | Priya, Raj | Engineering |
| 9 | "Confirmed outstanding" affordance for residual rows | L | Sam | Roadmap |

Items 1–4 are S-size and address the top universal finding. Ship them as a point
release (v3.119.1) before the feature is relied upon clinically.

---

## Judgement calls

**Dialog length kept.** Tom (pragmatist) found the dialog slightly verbose after
the third repeat. This is overruled: clinical-safety salience is never recommended
down. The dialog is proportioned correctly to its weight (an irreversible action
on a clinical task). To reverse: shorten the dialog body — but only after
R3 (write-through verification) is resolved, since today the dialog is the
primary brake.

**No bulk tick-off added.** No persona asked for a "tick off all elsewhere rows"
button. The per-row confirmation is correct for the clinical risk involved. This
is intentional and should not be changed without a specific clinical workflow case.

---

## Reproduce

Screenshots: `/tmp/practice-oir/` (1-loading, 2-enriched, 3-confirm-dialog,
4-after-tickoff, 5-all-outstanding, 2-enriched-dark).

Panel cast: Margaret Aldous (haiku), Tom Hollis (sonnet), Eileen Cobb (sonnet),
Sam Okonkwo (sonnet), Priya Nair (sonnet), Raj Patel (sonnet).

Surface under review: `content-scripts/triage-lens/content.js` `annotateOutstandingRow`,
`applyOutstandingMatch`, `fetchOutstandingHistory`, `confirmTickOff`;
`engine/outstanding-match.js` `enrichWithHistory`;
`content-scripts/triage-lens/hud.css` `.ch-oir-*`.
