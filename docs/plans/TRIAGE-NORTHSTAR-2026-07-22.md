# Triage North Star — 2026-07-22

**What this is:** the market-informed successor horizon to
`TRIAGE-LENS-2026-07-02.md`. That plan (phases 0–5) is largely shipped through
v3.176.4; this one starts from two research passes done on 2026-07-22 — a full
codebase hook/API inventory, and a market + policy sweep of the UK GP triage
landscape (Rapid Health, Klinik, eConsult, Patchs, Anima, Accurx, askmyGP;
HSSIB, BMA, NHSE contract changes, MHRA SaMD guidance, BJGP evidence base) —
and answers one question: **given the hooks and data the suite already has,
what is the best triage functionality we can feasibly build?**

It does not re-propose anything shipped. Open items from the 2026-07-02 plan
that the market evidence *validates* are pulled forward here by their original
IDs rather than duplicated. A virtual-Dave verdict pass was applied
(2026-07-22): A1 de-reassured, B-family fan-out costs surfaced and re-rated,
B2 stale-cache/H6 hazards named, B5 carry-over and D3 continuity fallback
added, MHRA opinion made a release-3 gate.

**Status update (same day, v3.177.0):** the first implementation wave shipped
— A2 (breach strip), B-substrate, B2, B3, B5 are live on this branch with
hazard entries H-045–H-048 pending CSO review. Two verify-before-build
corrections against this plan's claims: **E-1.1 was already shipped**
(v3.148.0, H-005 controls — this plan's "still open" claim was stale), and
**B4 was already live** (the monitoring pipeline is queue-agnostic; the only
gate is the deliberate global default-off toggle — no code change needed).
Two items were added from the same-day Practice-board and GP-panel reviews:
C4 and C5 below, plus the cross-cutting role-visibility question under
"Regulatory & safety programme".

**Status update (2026-08-23, v3.239.0):** the duty-doctor cockpit tranche is
on the Pulse (v3.236.4+): A1 Created-column SLA chips, A2/E-1.2 huddle on
the existing status bar + `#slaBreachStrip`, Pulse-specific E-1.1 dashed
rail, hollow silent diamond for B2/B4 headlines, C4 prepare-only Book
snippet + local Park. Still out: B1 context headlines, C1 queue lens, C2
batch packs. No new CSN §6.1 write. H-063 / H-064 Proposed.

---

## Why now — the market context in five lines

1. **From April 2026 the GP contract makes urgent-same-day handling a measured
   contractual obligation** (urgent requests actioned same day; non-urgent
   answered by end of next working day; performance collected nationally).
   "Find the urgent ones fast, and prove you did" is now the single most
   valuable triage-assist function in England — and no vendor gives practices
   the *prove-you-did* half.
2. **Oct 2025 already forced online consultation tools open all core hours**;
   the BMA dispute was precisely that intake tools "cannot distinguish urgent
   from non-urgent at submission". Most requests still land in an ungraded
   queue read by a human.
3. **HSSIB (2024) found OC tools contributed to missed/delayed care including
   deaths**, with the recurring theme that the *clinical record isn't surfaced
   at the moment of triage*. Intake vendors (Klinik, eConsult, Anima, Patchs)
   compete on the form; **nobody owns the triage decision moment inside the
   EPR queue**. That moment is exactly where this extension lives, with
   `fetchAll` + normalisers + two grading engines already pointed at it.
4. **The evidence on GP experience** (BJGP, JCM workload studies): what makes
   total triage tolerable is the *sense of control*; what makes it hateful is
   thin information forcing rework, and decision fatigue across 60–100
   requests/session (~4 min each = the whole session).
5. **Regulatory line (MHRA SaMD + symptom-checker appendix):** surfacing
   existing record/queue data is workflow software; *interpreting clinical
   content to output per-patient urgency* is (at least) Class I medical-device
   territory — Patchs registered Class I for exactly that. Two products doing
   real algorithmic grading hold device registrations (Klinik IIa, Patchs I);
   Accurx, the market leader, deliberately grades nothing.

## Design principles (binding, from the incident evidence)

- **Escalate, never reassure.** No chip ever renders an affirmative "low
  risk"/"this patient is fine" verdict. States are: positive escalation,
  assessed-normal (results only, where the lab itself graded), or visibly
  "not assessed". A wrong "routine" is worse than no chip (automation bias —
  the deprioritisation harm theme in HSSIB/coroner material).
- **Reasons on every chip.** Anima's visible-trigger RAG is the pattern GPs
  accept; a badge with no "why" gets ignored or over-trusted. Matches 2.1/2.2
  from the previous plan (match-evidence, detail popovers) — now shipped;
  every new chip inherits the same obligation.
- **The human decides; we sort, surface and evidence.** Nothing here books,
  rejects, replies, or auto-disposes. Rapid Health's rejection backlash is the
  cautionary tale.
- **Fail visible, fail closed.** "Couldn't check" must never look like
  "checked, fine" (Phase 1.1 lineage, hazard H-series).
- **Injection mechanics are settled law** — prepend-only, durable-map keyed,
  re-inject on refresh, de-dupe, token-scoped CSS (CLAUDE.md). Every new
  element adds DOM contracts + smoke-harness fixtures.

---

## Workstream A — The Contract Clock (urgency SLA + evidence) — **new, highest value**

Nothing in the market or in our previous plan covers the April-2026 obligation.
All of it is *workflow* (timestamps and counts, no clinical interpretation) —
the safest regulatory ground we have, and directly monetisable value for every
English practice.

| # | Item | Builds on | Effort |
|---|---|---|---|
| A1 | **SLA countdown chip.** Task-age chips (`queue.taskAgeAmber/Red`, `thresholds.taskAgeAmber/Red` in days) become contract-aware for request queues: urgent-flagged rows (Medicus `priorityDisplay`, already in every bridge row) show "must action **today** · received 09:12". The non-urgent chip must **state its source, never imply clinical safety**: "intake-flagged routine · due EOD tomorrow" — a deadline echo of an *unvalidated upstream flag* (the BMA dispute is precisely that intake tools mislabel urgency), never a "tomorrow is fine" verdict. Hazard entry required for the flag-echo. Pure decoration-family chip (DOM/bridge-driven, no fetch) — copy `decorateOneRow`. | bridge `ch-task-list-data` (`priorityDisplay` per row), existing age-chip pipeline | M |
| A2 | **Breach-risk strip.** Fifth global strip after the `#wrStrip`/`#rmStrip`/`#subRagStrip`/`#healthStrip` pattern: "3 urgent requests unactioned, oldest 4h12m" — amber approaching cutoff, red past it. Reuses `shared/request-monitor.js` buckets (already polls `new-request`/`reply-received` counts + items with timestamps) + `TriageAlertEngine.evaluate`. Panel-only per convention. | request-monitor poller, triage-alert-engine, strip CSS pattern | M |
| A3 | **Evidence ledger: time-to-disposition.** Record (Event Ledger, day-sharded) the pair *first-seen-urgent → row disposed/opened/status-change*, per task, no patient identity beyond taskUuid. Surface as a Condor card + monthly export: "% urgent actioned same day", the exact figure practices must evidence from April 2026. Nobody sells this. | `shared/event-ledger.js`, Condor card pattern, submissions-ledger day-shard precedent | M |
| A4 | **Demand-surge early warning** (stretch): submissions ledger already keeps hourly same-weekday baselines (`demandBaseline`); alert when today's intake runs ≥ X% over baseline before noon — the "unsafe surge" the BMA dispute is about, caught while there's still rota room to react. | `submissions-ledger.js` baselines, `#subRagStrip` | S/M |

*Safety posture:* no clinical interpretation; hazard-log entries for A1 (the
chip echoes Medicus's own priority flag and must say so) and A2/A3 to record
that the strip/ledger can never suppress or reorder anything. A3 stores no
free text.

*Honesty note:* this workstream is deliberate policy-chasing — it goes first
because it is the safest ground (pure timestamps and counts) and lands the
year's contractual pain, not because it is the deepest value. If the
April-2026 contract detail shifts, A1–A3's value moves with it. The durable
clinical moat is Workstream B.

## Workstream B — The record next to the request — **new, biggest clinical gap**

HSSIB's core finding, and the one thing no intake vendor can do: they don't
have the record; we do. The fetch-driven chip pipeline (`.ch-q-mon` family:
resolve task → `fetchAll` → normalise → evaluate → inject, cached + capped at
8 rows/pass) is the vehicle — but be honest about the cost this family
shares: on a results queue we fetch to grade anyway; on a *request* queue,
every B item needs `resolveTaskToPatient` + record fetch for potentially
60–100 rows/session through a cap sized for "grade the visible results". This
is a **scheduler/caching job, not a config-and-surface job** — and
scheduler/caching is where this suite's historical regressions live. Effort
ratings below already reflect that; a shared "resolve-and-cache patient
identity per request row" substrate is the first task of the workstream, built
once, load-tested against the smoke harness, then reused by B1–B4.

| # | Item | Builds on | Effort |
|---|---|---|---|
| B1 | **Context chips on request-queue rows.** The record engine already computes (for the HUD) palliative, frailty red/amber, recent-admission, polypharmacy, risk-to-self — but only on record/detail pages. Run the same per-row evaluation on *request* queues and surface a compact, capped subset (max 2 chips/row, severity-ranked): a "tired all the time" request reads differently against `frailtyRed` + `recentAdmission 12d`. Escalation-context only — no chip for their absence. | `computeQueueRowMonitoring` pipeline, `record.*` systemChip evaluators, `evaluatePatient` | L |
| B2 | **Pending-abnormal-lab cross-link.** `_queueResultCache` already holds graded reports keyed by taskUuid; `resolveTaskToPatient` gives patientUuid. Maintain a session patientUuid→worst-severity map; when a *request* row's patient has an unfiled red/amber result in cache, chip it: "⚠ pending K⁺ 6.2 on this patient". This is the HSSIB death-scenario interceptor, built from data already fetched this session. **Known hazards to design out:** a patient-keyed map derived from the taskUuid-keyed cache can outlive its source entry (2×TTL prune) and surface a stale value, and it must respect the v3.176.4 sort-canary invalidation (H6) — every cross-link chip carries its data timestamp and dies with its source entry. | `_queueResultCache`, `resolveTaskToPatient`, result-severity, H6 sort canary | M/L |
| B3 | **Repeat-contact chip — unblock the 4.5 deferral.** Deferred (v3.151.0) because the queue payload has no patient identifier. The fetch-driven path already resolves taskUuid→patientUuid per row and caches it; no name+DOB heuristic needed. Tier 1: "2 open requests, both queues" from resolved identities of current bridge rows. Tier 2: rolling 28-day local contact ledger (patientUuid + date only) → "3rd contact in 14 days" — a classic deterioration signal and coroner theme no intake product detects cross-channel. | shared B-substrate resolve cache, event-ledger day-shard pattern | M/L |
| B4 | **Monitoring chips on request queues.** `.ch-q-mon` currently targets results queues; the same cached evaluation should chip a medication-request row whose patient is overdue safety bloods ("methotrexate — FBC overdue 6w") — the moment the request is *about* the drug is the cheapest possible intervention point. | existing `.ch-q-mon` cache + scheduler, shared B-substrate | M/L |
| B5 | **Aged-request carry-over.** The duty reality the bridge can't see: a request bounced between clinicians over several days. Tier-1 B3 only sees *current* rows; B5 keeps a light task ledger (taskUuid, firstSeen, status transitions, assignee-count if visible — no free text) so the queue can chip "day 4 · 3rd holder" and the breach strip (A2) can count carried-over items, not just today's. | event-ledger, request-monitor items, A2 strip | M |

*Safety posture:* all escalate-only surfacing of record data that already
exists; CSO review for the chip *selection* (which contexts, what cap, what
ranking) rather than new grading. B2/B3 need hazard entries for stale-cache
states (chip must carry its data timestamp). Fetch fan-out rides the existing
8-row/pass cap + TTL caches; new fetches go through `record-provider.js`
(txn/session dual-path), not raw `api-client`.

## Workstream C — Batch triage cockpit — **new UX, evidence-gap experiment**

The duty-GP decision-fatigue findings + NHSE's "quick wins first" duty model
point at like-with-like batching, which no vendor and no study has properly
built or measured. We can do both.

| # | Item | Builds on | Effort |
|---|---|---|---|
| C1 | **Queue lens: group-by-presentation.** A toggleable overlay (status-bar control, keyboard-reachable) that visually groups/orders rows by matched rule family — reds first, then clinical clusters (UTI-like, MSK, skin+photo, med queries), green admin tail last. Client-side sort *presentation* only — never hides a row, never reorders the underlying grid data model (sort-canary rules apply). Rated honestly: re-presenting row order against a Vue reconciler that strips foreign DOM is the hardest UI item in this plan — the injection smoke harness must cover the lens *before* the first line of it is written, and if a non-destructive presentation layer proves impossible, the fallback is a grouped *listing in the side panel* (bridge data, no DOM surgery) that jump-scrolls the real grid. | 80 shipped request rules + `rule-match.js`, status bar (1.2), keyboard triage (4.6, shipped), 0.1 smoke harness | L |
| C2 | **Batch disposition packs.** For a selected group, one popover offering the *already-authored* per-rule `actions[]` (snippets/links/ask-back drafts from `reception-pathways.json`) so a like-with-like run reuses one prepared response pattern. Prepare-only, never sends — the shipped Pharmacy First/ask-back posture. | rule `actions[]`, reception-match, action-packs | M |
| C3 | **Instrument it.** Ledger events for triage session length, decisions/hour, with/without the lens (no patient data). We'd be generating the batching evidence the literature lacks — and our own proof of value. | event-ledger, Condor | S |
| C4 | **Next-green-day disposition assist.** The disposition half of triage: once the GP decides "not today", make executing that decision one click. The unit of disposition is an existing **capacity preset** (`{name, slotTypes[], tight, low, minimumByDay}` — capacity-core.js): scan the appointment-book embedded-overview forward N days and mark a day green when free slots of the preset's types clear its own thresholds and weekday minimum. v1: picker + timestamped prepare-only snippet ("book [patient] — Routine GP f2f — Thu 25 Jul, 3 free as of 10:42 — or nearest equivalent"). v2: one click creates the actual reception task via the existing `createGeneralTask` write path under 1.4-style confirm/undo/audit. Never holds or books a slot; never *suggests* deferring — activates only after the GP's decision. Slot claims always timestamped. Empty state links to the capacity tab when no presets exist. Pairs with C2 (batch-book a whole group) and D2 (next green day *with Dr X*). | slots/booking-api embedded-overview, capacity presets + capacity-core, submissions demand baselines, action-pack snippet machinery, task-api createGeneralTask | v1 S/M · v2 M |
| C5 | **Curated resource actions pass (GP-panel verdict: "build-differently").** The link mechanism already shipped (v3.149 chip popovers surface rule `actions[]`); what's missing is content and plumbing, not UI. (1) A curated actions pass over ~15 rules aimed at the *twice-a-year* lookups — fitness-to-fly/DVLA intervals, menopause/HRT, feverish-child thresholds, skin-lesion 2WW/photo guidance, Pharmacy First eligibility — and deliberately nothing on bread-and-butter presentations (a CKS link on a sore-throat chip is condescension that earns the off-switch). Deep links to the relevant section, never topic homepages; inline snippet with the load-bearing number where possible. (2) Two new action kinds: `leaflet` (hands off to the Leaflets tab via the existing `leaflets.pendingQuery` mechanism for patient-facing sends) and `knowledge-ref` (points at a practice-owned Knowledge-tab entry, so local pathway links are practice-curated, never shipped URLs that are wrong for every practice but one). (3) **Stale links are the kill risk:** extend `scripts/verify-nhs-index.js` to sweep every `actions[]` URL in defaults.json in CI; add link review to the Keeper's periodic rule pass. Ceiling: three links per rule (the mh-crisis precedent). Feeds C2's batch packs. | shipped actions[] popovers (v3.149), leaflets module + nhs-az-index verifier, knowledge module, Keeper process | S/M (content + plumbing) |

*Safety posture:* C1 needs a hazard entry proving the lens cannot hide or
suppress (a "grouped view" that drops a row is the failure mode); H-037
seen-dimming is the precedent for how to write it.

## Workstream D — Continuity assist — **discovery-gated stretch**

Strong 2025 evidence (BJGP systematic review: continuity reduces mortality and
utilisation) and an explicit policy worry that triage models route on
availability, not relationship. Only askmyGP ever centred it, and it's fading.

| # | Item | Builds on | Effort |
|---|---|---|---|
| D1 | **Live-Medicus discovery:** does any reachable endpoint (patient banner, task payload, appointment book) expose the registered/usual GP? Nothing in the current codebase reads one — this is a discovery task with the api-discovery tooling before anything is promised. **The spike may simply fail**; plan for it. | `api-discovery.js`, banner fetch | S (spike) |
| D2 | **"Usual GP" chip + duty match** (only if D1 lands): "Usual GP: Dr X — on duty today / has 2 bookable slots" from the slots feed. Informational only; no auto-assignment. | slots/booking-api, appointments-feed | M |
| D3 | **Fallback if D1 fails:** continuity is the strongest-evidenced item in the whole brief (2025 BJGP review: mortality reduction) — it doesn't die with an endpoint. Patient-alerts already keeps per-patient local annotations; add a structured "usual GP" field there, settable in one click from the record page, surfaced as the same D2 chip. Manual, but durable and practice-owned. | patient-alerts store + banner, slots feed | S/M |

## Workstream E — Finish the spine (pulled forward from 2026-07-02, market-validated)

The market brief independently validates these still-open items; they keep
their original IDs and gates. Priority order re-ranked by the pain-point
evidence:

1. **1.1 fail-visible "not assessed" states** — HSSIB's under-reporting theme
   makes this the top trust item; a blank that means "couldn't check" is a
   latent miss. (L)
2. **1.2 triage status bar** — the cockpit (C1) and SLA (A1) both want to live
   in it; build it first. (M)
3. **3.4 negation/history demotion** — thin-information rework is pain-point
   #2; "no chest pain" firing like "chest pain" is alert-fatigue fuel.
   Demote-visually-never-suppress stance already agreed. (M)
4. **3.6 trend/delta rule kind** — rising creatinine / falling Hb; the
   deferred Phase-3 follow-up. CSO-gated. (L)
5. **1.4 confirm/undo/audit for machine writes** — prerequisite hygiene for
   any A3 evidence claims about what the suite did. (M)
6. **4.8 photo-missing prompt** — still gated on live discovery of attachment
   visibility; fold into the D1 discovery session. (S/M)

## Explicit non-goals (decided, from the market evidence)

- **No autonomous disposition/booking/rejection** (Rapid Health backlash).
- **No probabilistic condition-matching / symptom-checker** (Klinik's Class
  IIa moat; a validation burden we cannot carry, and don't need — our edge is
  the record, not the algorithm).
- **No composite per-patient "urgency score."** We surface *named, sourced
  signals* (SLA state, record context, repeat contact, rule hits) side by
  side; collapsing them into one number is where MHRA classification, alert
  opacity, and automation bias all get worse at once. The GP is the
  aggregation function.
- **No "low-risk/fine" output, ever** (restating the principle as a scope
  decision: green remains admin-routing only, per the shipped 4.3 posture).

## Regulatory & safety programme (runs alongside, not after)

- **Honest MHRA self-assessment.** The shipped result-severity escalations and
  request red-flag rules arguably already sit at the symptom-checker boundary
  (Patchs registered Class I for the equivalent). Commission a written
  qualification/classification opinion (The Safety Bureau format), decide
  registration posture deliberately, and record it in `INTENDED-PURPOSE.md`.
  Workstream A is defensible as workflow software; **B2 and B4 are not** —
  they interpret clinical content (a K⁺ value, an overdue FBC) to output
  per-patient urgency, the same boundary the existing grading features
  already sit on. The opinion therefore **must land before release 3** (the
  first B release), alongside the paperwork the existing features need.
- **Role-based chip visibility (board finding, unresolved).** The care
  navigator touches every request before any GP and this plan never mentioned
  roles: if the first-pass sorter can see "risk-to-self"/"palliative" context
  chips they carry clinical weight they aren't trained for. Before B1 ships,
  decide on purpose what the navigator screen shows versus the GP screen —
  a governance/hazard item, not polish. (Same review flagged the A3 evidence
  ledger as disclosable and surveillance-adjacent: retention, export
  permissions and the DPIA answer ship *with* release 2, not after.)
- **DCB0129 as an adoption lever:** a clean safety case + hazard log makes
  every deploying practice's DCB0160 work easier — worth packaging, not just
  keeping. New hazard entries required: A2/A3 (no-suppression proof), B2/B3
  (stale-cache/wrong-patient states), C1 (grouping cannot hide), D2
  (informational-only).
- **Standing gates unchanged:** shipped-config changes need the defaults
  integer bump + regen + config-lock + `RETIRED_*` un-stick; new injected
  elements need DOM contracts + smoke-harness fixtures; Keeper verification
  for any new clinical content; CSO review for anything that changes what
  fires.

## Sequencing

| Release | Content | Rationale |
|---|---|---|
| 1 (minor) | E-1.2 status bar → A1 SLA chips → A2 breach strip | First not because it's the deepest value but because it's the **safest ground that lands this year's contractual pain**: timestamps and counts, zero clinical interpretation, fast to ship. The status bar is the home for everything later. |
| 2 (minor) | A3 evidence ledger + Condor card; A4 surge alert; B5 carry-over; E-1.1 fail-visible | "Prove you did" + honest states + the bounced-request ledger — the trust release. |
| 3 (minor) | B-substrate (shared resolve/cache layer, load-tested) → B3 repeat-contact (tier 1→2) → B4 monitoring-on-requests → B2 pending-lab cross-link | The record-next-to-request release — the durable moat. **Gated on the MHRA opinion and the CSO cycle**; the substrate is built and soak-tested before any chip rides it. |
| 4 (minor) | B1 context chips + E-3.4 negation | The context release; heaviest CSO involvement. |
| 5 (minor) | C1–C3 cockpit + instrumentation | UX experiment, instrumented from day one; smoke-harness coverage precedes the lens. |
| 6 | D (D1 spike early, D3 fallback if it fails), E-3.6 deltas, E-4.8 | Continuity ships either way — via the endpoint or the manual fallback. |

Each release independently shippable; version bumps + CHANGELOG per standing
convention. The MHRA self-assessment starts immediately, does not block
releases 1–2, and **blocks release 3**.

## Feasibility summary — why this is buildable and the market can't follow

Every workstream rides hooks that exist today: the MAIN-world task-list bridge
(`ch-task-list-data` with per-row `priorityDisplay`/`unmatched`/`overviewURL`),
the durable row map, the two grading engines and their per-row caches, the
four-strip alert pattern, the day-sharded Event Ledger with hourly demand
baselines, CSO-signed pathway content with authored actions, and a
record-fetch pipeline with caps, TTLs and a dual-path provider already in
migration. The intake vendors would need EPR-side access they don't have to
copy Workstreams A–D; the EPR itself doesn't surface its own record at the
queue. That intersection — record access + queue presence + an existing safety
case culture — is the moat.
