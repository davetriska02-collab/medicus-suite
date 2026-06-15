# The Practice — appraisal: Reception "Referrals on file" (v3.85.0)

Date: 2026-06-15. Scope: the new Reception "Referrals on file" card and its
fold-in to the reception capture text.

**This panel is synthetic.** The reactions below are a structured heuristic
device for surfacing UX and safety friction cheaply. They are NOT real user
research and no line here is a real clinician's view. Convergence across the
synthetic bands is treated as signal; single gripes as context.

## 1. Verdict

The card is well-built and the panel wants it: clean visual hierarchy, the right
fields at a glance, in-reception placement that saves a tab-hop on every call.
The single thing carrying it is **placement plus scannability** — "context
before action", right where reception already works. The single thing holding it
back is **trust in the name-only match**: four of six personas independently
landed on the same fear, that a common surname could surface a namesake's
referrals, or that a name change could make a real referral silently vanish
behind a reassuring "No referrals on file" empty state. Crucially, the panel's
instinctive fix ("match on NHS number") is **not buildable from this data
source** — the audit-report feed carries no NHS number or DOB — so the real work
is making the uncertainty honest and prominent rather than burying it in a grey
footer. It is not best-of-type yet for the safety-sensitive bands (nurse,
manager), but it is close, and every blocking issue is addressable without new
Medicus integration.

## 2. The panel

| Handle | Role | Band | Score |
|---|---|---|---|
| Chloe Danvers | Receptionist / care navigator | savvy-consumer, low-clinical | 8/10 |
| Maureen Castle | Medical secretary | technophobe | 8/10 |
| Sister Eileen Cobb | Practice nurse | reluctant | 5/10 (trust) |
| Dr Tom Hollis | Salaried GP | pragmatist | 6/10 |
| Janet Briggs | Practice manager | reluctant-but-capable | 4/10 (defensibility) |
| Dr Priya Nair | GP registrar | savvy | 6/10 |

The spread is the story: the people who just *read* it (receptionist,
secretary) score it 8; the people who must *rely on it or defend it* (nurse,
manager) score it 4-5. That gap is the name-match trust problem.

## 3. Findings by bucket

### Universal friction (most/all bands)

**U1 — Name-only match is not trustworthy enough as presented. [BLOCKER — nurse, manager, GP, registrar]**
The caveat "Matched to this record by name — confirm it's the right patient" is
real but sits as small grey footer text under four rows of clinical data the eye
has already consumed. Eileen and Janet both said they would stop noticing it
within a week. Two failure modes the panel named:
- *Wrong patient (shared surname):* a namesake's referrals surface with no
  ambiguity warning.
- *Silent false-negative (name change / maiden name / "J. Smith" vs "Jonathan
  David Smith"):* the patient's real referral is filed under a different name
  string, the card says "No referrals on file in the last 12 months", and that
  empty state reads as clinical reassurance.

*Verification / correction:* the panel's headline fix — match on NHS number — is
**infeasible** from the `clinical-audit-report` feed, which exposes only
given/family name per row (`shared/referrals-api.js:16-18`); no NHS number, no
DOB. "Detect multiple namesakes" is also unreliable: two John Smiths are
indistinguishable in the feed. So this is **adopted with adapted mitigations**,
not the literal ask:
- Move the "matched by name" caveat **above** the list and give it weight (not a
  footer); state it is a name match, not an identity-confirmed match.
- Show the window on the populated card ("last 12 months") and reword the empty
  state so it cannot be read as completeness, e.g. "No referrals found under this
  name in the last 12 months — check the record if the patient may be referred
  under another name." This kills the false-reassurance reading.
- Consider gating the list behind one deliberate tap ("Show referrals matched by
  name") so surfacing it is an act, not passive trust.
- *Roadmap (real fix):* source referrals from the **open patient's own record**
  (identity-correct) instead of name-filtering the practice audit report. That
  needs a new extractor/endpoint — the same lab-vs-referral data-availability
  question from the original feature scoping.

**U2 — Status badges (`INCOMPLETE` / `COMPLETED`) have no defined meaning. [MAJOR — receptionist, manager]**
Chloe could not tell whether `INCOMPLETE` means "hospital has not received it"
vs "received, awaiting appointment" — which changes whether she chases the
hospital or reassures the patient. Janet did not know if it meant incomplete in
Medicus, in the pathway, or in the audit report. Add a one-line expansion or
tooltip.

**U3 — `TWOWEEKWAIT` renders as one unformatted shout. [MINOR — receptionist, secretary, registrar]**
Three personas snagged on it. Display as "2WW" or "Two-week wait" to match
clinical shorthand. Easy win.

### The tech-literacy gradient

The savvy ceiling (Priya) and the floor (Maureen) actually *agree* the layout is
readable — Maureen, the technophobe, scored it 8 and found the dermatology row,
hospital and date without squinting, which is a genuine pass of the eyesight
floor. The gradient issue is not legibility but **acronyms**: both Maureen and
Chloe want "2WW" and the status tags expanded. The colourblind render keeps text
labels on every badge (Priya confirmed priority/status are not colour-only) —
that accessibility lens passes.

### Role-specific needs

**R1 — Manager: provenance and staleness are undefendable. [MAJOR — manager]**
Janet cannot tell where the data comes from, whether it reconciles with the
Referrals tab, when it was last refreshed, or — her sharpest worry — whether the
whole practice's referral list is being pulled into the browser to show one
patient. *Verification:* it **is** a whole-practice pull, filtered client-side by
name, but held **in memory only, never written to disk, dropped on unmount**
(`reception.js` cache is in-RAM by design). That answers her governance question
favourably — but it is invisible. Surface: a "last refreshed HH:MM" line, a note
that data is the same feed as the Referrals tab, and a plain-language line that
no referral data is stored to disk.

**R2 — GP: the fold-into-capture-text has low value for the reader. [MINOR/judgement — GP]**
Tom values the on-screen card during the call but would rarely read the referral
block folded near the bottom of the capture note, and the "matched by name"
caveat there makes him *less* likely to act on it. He is not the one on the call.
See judgement call J1.

**R3 — Clinician-name role is unlabelled. [MINOR — manager]**
Janet could not tell if the named clinician is the referring GP or the receiving
consultant (it is the referring clinician). One word of labelling fixes it.

**R4 — No-patient copy frames it as incoming referrals. [MINOR — registrar]**
"Open a patient record to see who referred them, where and when" reads as
referrals *into* the practice; the card shows referrals *out*. Reword.

### Standout strengths (protect these)

- **Scannability** — bold service/hospital, secondary clinician+date, badge row.
  Parsed in ~half a second by every band including the technophobe.
- **In-reception placement** — saves 2-3 minutes per call vs opening the
  referrals tab and searching (manager and registrar both said so).
- **Colourblind-safe badges** — text labels survive without colour.
- **Honest cold-start** — the "not set up — open the Clinical Audit Report once"
  state is actionable, not a cryptic error. Praised by both manager and registrar.
- **The caveat exists at all** — the right instinct; it just needs to be louder.

## 4. Prioritised path to best-of-type

Quick wins (S < 2h):
- **U3** — display "2WW"/"Two-week wait" instead of `TWOWEEKWAIT`. (design-crit/stylist)
- **R4** — reword the no-patient line to outgoing-referral framing.
- **R3** — label the clinician as the referrer.
- Add the **12-month window** label to the populated card (part of U1).

Medium (half-day):
- **U1 mitigations** — promote the caveat above the list, reword the empty state
  to defeat false reassurance, optionally gate behind one tap. (design-crit owns
  the pixels; wording is a clinical-safety call — run past Dave.)
- **U2** — define `INCOMPLETE`/`COMPLETED` with a tooltip/expansion.
- **R1** — "last refreshed" timestamp + provenance + "not stored to disk" line.

Feature gap (roadmap, L-XL):
- Identity-correct referrals from the **open patient's record** rather than a
  name-filtered practice report. Removes U1 at the root. Needs the Medicus
  patient-referrals endpoint/extractor to exist — scope it like the lab-order
  question. If benchmarking against rivals is wanted, chain into the-gauntlet.

UX/UI fixes route through **design-crit** (this single surface). The empty-state
and caveat wording is a clinical-safety judgement — confirm with Dave before
changing, do not freehand.

## 5. Judgement calls (reversible)

- **J1 — Keep the referral block folded into the capture text.** Tom would rarely
  read it and finds the buried caveat off-putting, which is an argument to drop
  it. I am **keeping** it because Dave explicitly asked for "both" (card +
  capture text) and a clinician reading the pasted note out of context is exactly
  who benefits from seeing the referrals inline. Mitigation instead: ensure the
  caveat travels with the block (it does, as a captioned heading). *To reverse:*
  remove `referralLines` from the `meta` passed to `buildCaptureText` in
  `generateSummary` (reception.js) and the render branch in reception-core.js.
- **J2 — Did not adopt "match on NHS number" despite four personas asking.**
  Overruled as infeasible from the current feed (no NHS number/DOB). The
  underlying risk is adopted via U1 mitigations and the roadmap item.

## 6. Reproduce

Surfaces shot (design-crit harness, reception module, seeded snapshot + referral
fixtures) into `/tmp/the-practice/referrals-on-file/`:
`populated-light`, `populated-dark`, `populated-colourblind`, `empty-no-match`,
`not-set-up`, `no-patient`, `capture-output`.

Panel cast: Chloe Danvers (haiku), Maureen Castle (haiku), Sister Eileen Cobb
(sonnet), Dr Tom Hollis (sonnet), Janet Briggs (sonnet), Dr Priya Nair (sonnet),
each screenshots-only, one persona per subagent.
