# Triage Lens Phase 4 — Review & Decisions

**For:** Dr Dave Triska (CSO). Phase 4 is "workload off the GP." Client-side
items ship on self-review; anything that changes what a patient sees, marks
something routine, or groups patients needs your call. This doc collects those.

## Shipped (client-side, self-reviewed)

- **4.6 Keyboard triage** (v-pending) — j/k/Enter/n queue navigation.
- **4.7 Seen-dimming** (opt-in, default off) — dims worked rows; never dims a
  red/amber row (cache-truth escalation gate, holds even with row-tint off);
  auto-undims on escalation. Hazard log H-037.
- **4.4 Fileable-normal marker** — green ✓ on all-normal-no-blocker rows, reusing
  the lab-file gate (`window.LabFilingUtils`), fail-closed.

## 4.5 Repeat-contact — DEFERRED, needs your decision

**Finding:** the Medicus task-list payload the queue bridge reads carries **no
patient identifier** — only task UUIDs and an `unmatchedToPatient` boolean.
Confirmed three ways: the bridge's own `pickUuid` deliberately skips
patient-shaped keys; patient id is only obtainable via a separate per-row
`resolveTaskToPatient` fetch; the changelog documents task-list as metadata-only.
So "N open requests from this patient" cannot be computed zero-fetch as planned,
and nothing was built (shipping it would silently never fire).

**Options (pick one):**

1. **Group by name+DOB from the rendered grid cells** — zero-fetch, zero-storage,
   durable like the age chips. Risk: two different patients with the *same name
   AND same DOB* would be grouped (rare; it's an info chip the GP verifies by
   opening). Undercounting (safe direction) is the likelier error. Would ship
   with exact-match-only + a "verify" framing. **← my recommendation** — the
   downside is mild (info chip, not a clinical action) and the signal is real.
2. **Defer entirely** — safest; no false-grouping risk. The current state.
3. **Fetch-gated partial** — piggyback the throttled monitoring fetches (≤8/load);
   gives inconsistent counts (a 3-request patient might show "1"). *Advise
   against* — an undercount reads as false reassurance on a safety signal.

**Tier 2** ("3rd contact in 14 days") needs persisted per-patient contact history
— a new PII category (salted-hash key, machine-local, backup-excluded, rolling
14–30 day retention). Needs a DPIA note before any build. Not implemented.

## 4.1 / 4.2 / 4.3 — Clinical wave (BUILT, draft-not-released)

All three are committed as draft (not released, no manifest bump). They **fire
clinical content**, so release is gated on your review of the items below.

### 4.1 Pharmacy First divert + 4.2 Ask-back (draft `f002ea4`)
Wires `engine/reception-match.js` into the request-queue chips. What fires:
- A green **"Pharmacy First"** chip when a request matches a pathway *and*
  `pharmacyFirstEligibility` returns eligible (age from the DOB cell; **fails
  closed on unknown age** — no chip). Clicking shows the pathway note + a
  **prepare-only** redirect draft (copy-to-clipboard; nothing auto-sends).
- Otherwise an info **"Ask-back"** chip when there are red-flag gaps or a
  patient-volunteered red flag. The menu lists the not-yet-mentioned questions
  and a prepare-only ask-back draft, and surfaces any volunteered **999/duty**
  red flag as a prominent escalation note.
- **What needs your review:** the `SYNONYM_TERMS` and `RED_FLAG_TOPIC_TERMS`
  maps in `engine/reception-match.js` — these are the new matching content
  (distinct from the signed `reception-pathways.json`) that decide which
  request maps to which pathway and which red-flag topics count as "mentioned".
  UI wording is kept to info + prepare-only drafts (no auto-advice), consistent
  with the pathways file's "captures history, does not triage" stance.

### 4.3 Green routine set (draft `d095227`, defaults config 23→24)
Two conservative green rules (the other candidate categories already ship as
info rules):

| id | label | example phrasings | why safe-to-green | still fires if a symptom co-occurs |
|---|---|---|---|---|
| `practice-admin-details` | Practice admin (non-clinical) | proof of address, change of address/phone/name, registration query, deregister, transfer records | pure reception-desk data-maintenance, no clinical content possible | "change my address, also chest pain" → chest-pain (red) tops; green demoted to +1 |
| `pharmacy-process-query` | Pharmacy/prescription admin | pharmacy query, prescription not ready, wrong/nominated pharmacy, collect prescription | dispensing/collection process only; disjoint from `repeat-meds` (info) | co-occurring sepsis/epistaxis text → red/amber tops |

**Safety argument:** green ranks LAST (red < amber < info < green) in both rank
maps, so a green chip is the headline ONLY when nothing more urgent matched — a
symptom co-occurring with an admin phrase always wins by kind, and the green
match is never suppressed, only demoted into "+N". (This fixed a real bug: green
had been ranked *above* info.)

**Your review:** are these two rules safe to ship as green, and is the phrasing
tight enough? Prune/amend freely.

## 4.8 Photo-missing prompt

*Feasibility check pending — depends on whether attachment presence is visible in
the task data.*

## Phase 3 follow-ups (from the Phase 3 sign-off)

- **FIB-4 correct age-split** — needs a small engine change (a context rule that
  raises a rule's *own* lower cutoff for a band; the escalate-only model can't
  suppress today). Then the McPherson/AASLD scheme drops in.
- **Hb-fall / K⁺-rise deltas** — need defensible sourced magnitudes.

---

## Decisions needed

- [ ] **4.1/4.2** — approve the reception-match SYNONYM / RED_FLAG topic maps (now firing)
- [ ] **4.3** — approve / prune the two green routine rules
- [ ] **4.5 repeat-contact** — option 1 (name+DOB, recommended) / 2 (defer) / 3 (fetch-gated)
- [ ] **4.8 photo prompt** — build after feasibility check, or drop
- [ ] **Phase 3 follow-ups** (FIB-4 age-split, deltas) — build now / later
- [ ] **Release v3.151.0** authorised (bundles the approved 4.1/4.2/4.3 content)

*The three clinical drafts (`f002ea4`, `d095227`) do not release until the boxes
above are ticked. Client-side items 4.4/4.6/4.7 are already live on the branch.*
