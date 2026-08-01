# Document Coder — build plan (2026-08-01)

**Status:** plan, pre-build, **ready for the Phase 0 capture session** (protocol at §14).
Nothing here is shipped; roadmap = absent per Gauntlet rules.
**Inputs:** [GAUNTLET-2026-08-01](../benchmark/GAUNTLET-2026-08-01.md) (market case, L1),
[PANEL-document-coder-2026-08-01](../appraisal/PANEL-document-coder-2026-08-01.md)
(20-persona synthetic panel), and a code-level substrate audit of Nick's coding/merge
stack (below). Owner for clinical content and sign-off: CSO (Dave). Good first tickets
for Nick are marked **[N]**.

---

## 1 · What this is, in one paragraph

An **assistant inside the document coding/processing workflow**. When a coder or GP has
an inbound document open in Medicus — the moment they are deciding its type, its codes
and its actions — the suite reads the document text locally, extracts
diagnosis/medication/observation/action candidates from **anchored, semi-structured
patterns only** (never prose-wide NLP), resolves them against Medicus's own SNOMED index
with hierarchy proof and retirement checking, diffs them against the patient's actual
coded record (including resolved entries and retired-code chains), and presents its
suggestions **beside Medicus's own coding controls**, whose *first* job is honesty about
what it could and could not assess. The human accepts suggestions through Medicus's own
controls, one deliberate confirmation at a time, with every shown/clicked event
auditable. It is the letters-modality answer to the results queue: same doctrine
(escalate-only, fail-loud, absence asserts nothing), applied at the exact moment the
coding decision is being made — not a separate review surface the coder must remember to
visit.

**Why now:** letter/inbox coding is ranked GP pain #3 nationally (Gauntlet run 3); Docman
AI and Anima own it on EMIS/S1 and nobody ships it on Medicus; MHRA (29-07-2026)
explicitly placed code-suggestion-for-clinician-review outside medical-device scope; and
the substrate below means most of the hard machinery already exists in this repo. The
window is ~12 months before Doctolib's secretarial-automation ambition reaches letters.

## 2 · Substrate inventory — what Nick's stack already provides

| Capability | Where it lives | State |
|---|---|---|
| Attachment content read path (task attachments, incl. non-`<a>` and thread replies) | `docs/learnings-triage-attachment-to-document.md` §5/§8; `content-scripts/document-file-inline.js` | Confirmed by live capture, shipped |
| Document-type SNOMED refset (1,768 members, byte-verified) | `rules/document-types.json`, learnings §9 | Shipped |
| Text→concept search against Medicus's own index, with `parentConceptIds` ancestor closure | `docs/SNOMED-API-GUIDE.md` §1; used by `shared/coding-specificity.js` | Confirmed, shipped |
| Three-tier graded suggestions (descendant-proofed / exact-text / hint-combined), each tier visually escalated | `shared/coding-specificity.js` | Shipped for problems; engine reusable |
| Retired-code detection + confirmed-replacement search (incl. PARTIALLY EQUIVALENT TO, body-structure axis) | `shared/snomed-retirement.js` + `rules/snomed-terminology-server.json` (public termbrowser, conceptId-only queries, fail-closed) | Shipped |
| Coded problem-list enumeration + duplicate/legacy variant awareness | `engine/record-duplicate-parser.js`, duplicate-checker | Shipped |
| Medication started/stopped differ with dose-insensitive identity | `shared/record-delta.js` (+ tests) | Shipped |
| Write paths: document filing, problem edit (edit-problem POST), bulk end | `document-file-inline.js`, `problem-description-cleanup.js`, `problem-bulk-end.js`; signed at INTENDED-PURPOSE v3.202.0 / CSN §6.1 | Shipped. **Problem-CREATE is NOT a confirmed contract** |
| Macro pattern for driving Medicus's own on-screen controls with click-time re-verification | `lab-file-button.js` (W7 fail-closed posture) | Shipped |
| Audit ledger (machine-local, UUID-keyed, CSV export) | Event Ledger | Shipped; needs export upgrades (Phase 4) |
| Deterministic calm/alarm text classification with word-boundary asymmetry | `engine/result-rules.js` `kind:'text'`, `engine/result-severity.js` | Shipped; pattern to copy for action flags |

**Blocked substrate:** the Transactional API `create-document` path stays untouched until
the Clinical Safety Notice §6 CORRECTION PENDING (items 1/8/9 + DPIA + hazard entry) is
closed. Nothing in this plan depends on it.

**New engine work this plan actually requires:** (a) the anchored-pattern candidate
extractor with negation/temporality/qualifier binding, (b) the four-state coverage model,
(c) PDF.js text extraction in a content-script/panel context under MV3 CSP, (d) the
delta-with-qualifiers logic. Everything else is composition.

## 3 · The design spine: the four-state honesty model (P1, 17/20)

Every document the feature touches is in exactly one state, and the state is the loudest
thing on screen and in the ledger:

| State | Meaning | Render weight |
|---|---|---|
| 🟦 ASSESSED — N candidates | Text layer read, anchors found, candidates below | Normal card |
| 🟨 ASSESSED — nothing anchored · coverage X/Y | Text read; no anchored patterns matched; coverage meter shows how much of the document the anchors covered | Amber, wordy, never green |
| 🟥 COULD NOT READ | No text layer (scanned image), garbled extraction, or PDF.js failure | Dominant red banner: "This document could not be read — full manual review required". Never blank |
| ⬜ NOT RUN | Feature disabled / role-gated / pre-flight failed | Explicit "Document Coder did not run", never an absent card |

Rules that fall out of the panel and the house doctrine:
- The two negative states **visually dominate** the positive ones (part-time GP: "the
  unassessed state must dominate over the confident ones"). Colour-blind-safe, worded, not
  colour-only.
- The state is **stamped per-document into the Event Ledger** (DQ lead: "'the tool missed
  it' vs 'nobody looked' — I'm the one who has to answer that").
- A per-letter **coverage meter** ("3 of 5 numbered problems anchored · 2 sections not
  assessed") on every ASSESSED card (senior coder). No percentage theatre: counts of
  concrete things.
- **No card ever says or implies "fully coded" / "letter reviewed" / "all clear"** — extend
  the source-grep guard convention (`test-reception-quick-actions-ui.js` pattern) to ban
  the strings outright. **[N]**

## 4 · Wrong-patient guard rails (P2, 10/20)

- Patient banner (name · DOB · NHS number) pinned at card top in the same visual weight as
  suggestions, exactly the Sentinel identity-banner pattern.
- Pre-flight identity check before any suggestion renders: the card asserts which task and
  patient the attachment belongs to and re-verifies at accept-click time (the W7
  click-time re-verify posture from `lab-file-button.js`).
- The card never renders suggestions on a document whose patient context cannot be
  resolved — that is a COULD-NOT-READ-class state with its own wording.
- **What we cannot do and say so:** the suite cannot detect a letter *correctly attached*
  to the wrong patient (hospital's error). The card carries the standing line "Check this
  letter is about this patient" under the banner — a nudge the panel's misfiled-letter
  war stories (7 personas) say pays for itself.

## 5 · Extraction: anchored, negation-aware, qualifier-bound (P4)

- **Anchors v1:** `Diagnosis:` / `Diagnoses:` / `Impression:` / `Problems:` /
  `Primary diagnosis:` headed blocks; numbered/bulleted lists under them; medication
  sections (`Medications on discharge:` etc.) routed to `record-delta`.
- **Coded-data lane (suggestion-only):** clearly-unitised numeric observations stated in
  the letter — BP (`nnn/nn`), weight/BMI, HbA1c (mmol/mol), eGFR — extracted with their
  units and the letter's clinical date, offered as *copy-ready coded-entry suggestions*
  ("BP 152/94, 12-Jun-2026 — copy for coding"), never entered automatically. Unit or
  date ambiguity → the candidate is not offered (fail-closed, same rule as everything
  else). No observation write path exists or is proposed; this lane is display +
  copy-assist in every phase, and each analyte pattern needs CSO review before it ships
  (a mis-extracted potassium is a clinical harm, not a typo — start with BP/weight only).
- **Negation/temporality/status classifiers run per candidate line before any search**:
  ruled-out (`?`, "excluded", "no evidence of"), historical ("previous", "PMH", year-only
  dates, "known"), resolved ("resolved", "treated"), suspected ("query", "awaiting
  histology"). Candidates classified anything other than *active-asserted* are **never
  presented as codeable suggestions** — they render in a separate, visually distinct
  "mentioned, not offered (historical / ruled-out / suspected)" group. This kills the
  ?PE-coded-as-PE trap (ST3), the previous-MI-as-active trap (Band-3, deputy PM, PCN) and
  the apprentice's wrong-side cancer case in one rule.
- **Laterality and certainty stay bound to their source sentence** — a candidate is a
  (sentence, extracted-term, qualifiers) tuple end to end; the card shows the source
  sentence beside every suggestion (ST3's #1 want, apprentice's read-back).
- **Action flags are the one whole-text scan** — 2WW-outcome, "GP to action",
  "for GP to arrange", follow-up-by-date phrases scan the entire text layer, not just
  anchors, because they are escalate-only (a false positive costs a glance; the
  sub-paragraph AF war story appeared five times). Copy the `kind:'text'`
  word-boundary-asymmetry discipline from `engine/result-severity.js`.
- **No OCR in any phase of this plan.** Image-only PDFs are COULD NOT READ. The PCN
  lead's OCR-drops-"no" case is disqualifying; revisit only as its own future plan with
  its own hazard analysis.

## 6 · The delta: presence is not enough (P4 continued)

"Already coded — nothing to do" is a negative assertion and earns the same paranoia as
the rest:
- Diff against **active AND resolved/inactive** problems, and walk
  **retirement/replacement chains** (`snomed-retirement.js`) before ever claiming "not on
  problem list" — the DQ lead's GP2GP war story (old practice coded a since-retired
  concept; naive tool flags a duplicate) is the acceptance test.
- **Qualifier conflicts surface as their own flag class**, not as a match: same concept
  family but different stage/severity ("CKD 3a coded, letter says 3b — stage may have
  changed"), and letter-status-vs-record-status conflicts ("letter says resolved, record
  says active"). This is the QOF lead's CKD003 war story and the senior coder's
  AKI-resolved case; it is also the cheapest genuinely-novel thing in the plan — nobody
  in the market diffs qualifiers.
- Default view: **delta-first, matches collapsed** (senior partner's killer detail) — a
  clean letter is a 3-second dismiss; a letter with two new problems and a stage change
  stops you.

## 7 · Accept flow: deliberate, dated, tiered (vetoes 1/3/4)

- **Phase-gated** (see §9). End state: accept drives Medicus's **own** add/edit-problem
  control (macro class, like `lab-file-button.js`), with a **mandatory read-back step** —
  source sentence and SNOMED term side-by-side, laterality/certainty words highlighted,
  accept disabled until the read-back is displayed (apprentice's killer detail; also the
  sceptic's and ST3's veto).
- **Tier (c) hint-combined is never one-clickable.** It renders as "possible match —
  search and code manually", with the pre-filled search term. Tiers are distinguished by
  position + shape + wording, never colour alone (PCN veto).
- **The clinical event date from the letter is carried into the flow and shown**; if no
  date is extractable the field is explicitly "date not found — set manually", never
  defaulted silently to today (QOF lead's register-corruption veto).
- **Escalate button** on every card: one click flags the document to a named reviewer
  (writes a suite Follow-up entry, no Medicus write) — the apprentice's supervisor path.
- Sensitive-content gate: if extraction hits the sensitive-category term list (mental
  health, safeguarding, HIV, termination), the card renders **no diagnosis content** for
  seats not enabled for coding (Practice Profile role config); it shows only "clinical
  content — coding-enabled staff only" (Caldicott veto). Ship the gate default-on.

## 8 · Audit: governance-grade from day one (P5)

- Every render and click already fits the Event Ledger; add per-document state stamps
  (§3) and per-suggestion provenance (anchor sentence hash, tier, concept id, ancestor
  path used).
- **New export surfaces** (the panel's managers were unanimous that the per-machine
  ledger is not enough): (a) per-patient "Document Coder history" export for SAR/complaint
  bundles (deputy PM's killer detail), (b) per-coder per-tier weekly acceptance CSV the
  practice manager can pull unaided (PM's killer detail), (c) inclusion of acceptance-rate
  aggregates (counts only, no PHI) in the Practice Profile export so a PCN lead can roll
  up across sites. All user-initiated, all documented in the DPIA.

## 9 · Phases

| Phase | Contents | Write surface | Effort | Gate |
|---|---|---|---|---|
| **0 · Truth + discovery** | Fix `docs/VISION.md` stale read-only claims; INTENDED-PURPOSE addendum (code suggestion = display + assisted use of Medicus's own controls); hazard workshop (draft entries §10); **capture session on the document coding/processing workflow screen itself** — how the open document's content is served there, what coding controls the screen exposes (document type, coded entries, actions), where a widget can anchor (composer-pattern rules from CLAUDE.md apply: insertion anchor climbing, layout-inert, style-patch-and-restore) — plus the filed-letters/backlog read contract; corpus collection: 20–30 real letter formats from our trusts, anonymised, as fixtures. The task-attachment `fileURI` path is already confirmed and serves as the fallback surface if the processing-screen contract disappoints | none | M (CSO-heavy) | Blocks everything |
| **1 · Document Lens, display-only** | Four-state model; PDF.js text extraction; anchored extractor + negation/qualifier classifier; coded-data lane (BP/weight only, copy-assist); delta-with-qualifiers; med diff; action flags (whole-text); patient banner + pre-flight; coverage meter; sensitive gate; ledger stamps. Injected **beside Medicus's own coding controls on the processing screen** (primary surface per Phase 0 capture; task-attachment card as fallback). No accept button. Ships **disabled**, per-practice enable | none | XL (the extractor + four-state model are the bulk) | CSO sign-off on hazard entries |
| **2 · Assisted coding** | Per-suggestion "copy + open Medicus coding screen" (Action-Pack class assist: copies term/concept, navigates, human does everything in Medicus); read-back step; event-date extraction + display; escalate-to-reviewer | none (assist only) | M | CSO review |
| **3 · One-click accept (tiers a/b only)** | Drive Medicus's own add/edit-problem control macro-style with click-time re-verify; CSN §6.1 new row; tier (c) permanently excluded from one-click | new macro write path | L | Full CSO sign-off + CSN update |
| **4 · Worklist + governance surfaces** | Inbox triage view: one collapsed line per document (nothing new / N unmatched / not assessed / could not read), keyboard-first, action-flags visible at list level; persistent 2WW/action task banner until actioned; QOF register-impact badge on unmatched candidates (reuse register rules + `summariseQofPointsAtRisk` pattern, cohort-honest framing); audit exports (§8) | none | L–XL | CSO review of banner semantics |
| **5 · Backlog (filed documents)** | Only if Phase 0's capture confirms a read contract for filed-document content; same card on the patient's document history (reception lead's "the backlog is where the losses hide") | none | ? (gated on capture) | New capture learnings doc first |

Phase 1 before Phase 4 is deliberate: the per-document card must earn trust before a
whole-inbox view multiplies it. But the **triage-line subset of Phase 4** (action flags
at list level) should ship with Phase 1 if cheap — it was the reception lead's entire
review.

## 10 · Hazard entries to draft (workshop with CSO, Phase 0)

- **H-A** Blank/quiet state misread as "reviewed, nothing to code" → four-state model,
  dominance rules, ledger stamps, source-grep guard. (The panel's #1, five vetoes.)
- **H-B** Suggestion accepted onto wrong patient (misfiled letter) → banner, pre-flight,
  click-time re-verify, standing check line. Residual risk stated: correctly-attached
  wrong-patient letters are undetectable.
- **H-C** Ruled-out/historical/suspected item coded as active → negation classifier,
  "mentioned, not offered" group, read-back step, fixtures for every war-story variant.
- **H-D** Qualifier hidden behind a match ("already coded" hiding a stage change) →
  qualifier-conflict flag class; test on CKD 3a/3b and AKI-resolved cases.
- **H-E** Tier fatigue (hint-combined rubber-stamped) → tier (c) never one-clickable,
  shape+wording+position distinction, per-tier acceptance reporting to make drift visible.
- **H-F** Sensitive-content disclosure to non-coding staff → sensitive gate default-on.
- **H-G** Wrong event date corrupting QOF achievement → date shown, never silently
  defaulted.
- **H-H** Action flag seen but not actioned across absences → persistent task banner
  until actioned; visible to any seat.

## 11 · What this plan refuses to do

No LLM over letter text ever (PHI leaves the browser; the copy-prompt pattern stays
config-only). No OCR in this plan. No prose-wide diagnosis NLP — the coverage meter names
the gap instead of pretending it closed. No auto-accept, no batch-accept across patients,
no write without a human confirming in Medicus's own control. No use of the Transactional
API while the CSN correction is pending. No "reviewed", "complete", "all clear", or any
other negative assertion, enforced by source-grep test.

## 12 · Tests that must exist before Phase 1 ships

- Fixture corpus: every war-story letter from the panel record rendered as a fixture —
  nine-diagnosis discharge (new AF mid-list), ?PE-excluded in numbered list, previous-MI
  historical, CKD 3a→3b stage change, right-?malignant/left-benign laterality pair,
  sub-paragraph "GP to arrange" action line, 2WW outcome in prose paragraph four,
  image-only PDF, retired-concept GP2GP variant. **[N — fixture authoring is a
  self-contained ticket]**
- Four-state render tests incl. "blank card is impossible" (an attachment task with the
  feature enabled must always render exactly one state).
- Negation/temporality classifier unit tests (the classifier fails closed: unclassifiable
  → "mentioned, not offered", never active-asserted).
- Delta tests against active/resolved/retired-chain problem lists.
- Source-grep guard for banned completion language.
- Ledger stamp round-trip tests.

## 13 · Effort and the honest clock

Phase 0+1 is the real investment (roughly: extractor M–L, four-state card M, PDF.js
plumbing M, delta-qualifiers M, gates/ledger S–M — an XL in aggregate). Phases 2–4 are
each individually shippable increments on top. Against the market: this neutralises the
letters column of Docman AI and Anima *on Medicus only*, and it is the feature squarely
in the path of Doctolib's stated secretarial-automation ambition — the Gauntlet's
assessment stands: ~12 months of clear water, build it cheap and composable (it reuses
nine shipped components; §2), and let the durable value accrue to the doctrine pieces
(four-state honesty, qualifier diffs, audit exports) that a platform vendor moving fast
will not replicate soon.

## 14 · Capture protocol — Phase 0, run live at the practice (~60–90 min)

**Instrument:** `scripts/document-create-capture.js` unchanged — its fetch/XHR wrapper is
generic (observation-only, never replays, key-based PHI redactor on by default,
file bytes never read). Paste into the page console, `chDocCap.mark('…')` between steps,
`chDocCap.summary()` / `.dump()` / `.copy()` at the end. **Use a test patient throughout
and a dummy inbound document** (blank PDF with typed dummy headings — seed it via
Medicus's own Add-document upload first if the inbound queue has no safe item).

**Write-up:** a new `docs/learnings-document-processing-2026-08-XX.md` in the house
learnings doctrine — confirmed vs unconfirmed clearly separated, endpoint shapes quoted,
DOM snippets saved to `fixtures/medicus/` (redacted). The session is done when Q1–Q6
below are each either answered or explicitly recorded as unanswerable.

**The questions, in capture order:**

1. **Where does document processing live?** Record the URL/route of the inbound-document
   queue and of a single document opened for processing. Does the queue go through the
   same `/tasks/data/{slug}/task-list` shape as every other task queue (which the
   Triage Lens router already handles)? Capture the slug, a row's JSON shape, and its
   `overviewURL`.
2. **How is the open document's content served?** With a document open on the processing
   screen, capture the request that delivers its content — endpoint, content-type,
   whether it is a direct PDF/image GET (fileURI-like), a blob in an iframe, or something
   else. Note whether the dummy PDF's text layer survives to the network response. This
   single answer decides whether the primary surface is viable.
3. **What coding controls does the screen expose, and what do they fire?** Using
   Medicus's own controls on the test document, one at a time with a `mark()` before
   each: set document type; add/edit a coded entry (does a problem-add exist here, or
   only document-type coding?); set the document/clinical date; complete/file the
   document; any action/task control. Capture each endpoint + payload shape. This
   answers whether Phase 3's accept can drive an on-screen control (macro class) and
   where the event date lives.
4. **Where can a widget anchor?** Save redacted `outerHTML` of the container around the
   coding controls and around the document viewer (two or three ancestor levels — enough
   to apply the composer rules: single-child wrapper climb, grid-vs-flex identification).
   These become the injection fixtures.
5. **The queue row, for the worklist line** (Phase 4): what does a queue row show, and is
   there a preview-row/master-detail structure like the results queue that a per-row
   verdict line can prepend into?
6. **Backlog read contract:** from the test patient's document history, open an
   already-filed document and capture how its *content* is fetched (metadata contract is
   already known from the duplicate parser; content is not). Gates Phase 5.
7. **Reality stats (no capture tooling needed):** flick through the last 20–30 real
   inbound letters *without opening a capture* and tally text-layer vs scanned-image and
   the section-heading formats each trust uses (`Diagnosis:` vs `Impression:` vs
   numbered `Problems`). Record heading/layout shapes only — never patient content. This
   sizes the COULD-NOT-READ share (the Band-3 veto: "if 'not assessed' appears on more
   than a small minority of letters, I lose all the time savings") and seeds the anchor
   list and fixture corpus.

**Decision point at write-up:** if Q2/Q3 confirm a workable contract, Phase 1 targets the
processing screen as planned; if not, Phase 1 falls back to the confirmed task-attachment
surface and the processing screen becomes a later phase behind further discovery. Either
way the extractor, four-state model and delta work are unaffected — they consume text,
not a particular screen.
