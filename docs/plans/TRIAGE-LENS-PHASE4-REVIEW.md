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

## 4.1 / 4.2 / 4.3 — Clinical wave (in progress)

*Populated as the Pharmacy-First divert chip, missing-info ask-back, and green
routine rule set are built. The reception-match engine (synonym + red-flag topic
maps) is CSO-reviewable content already on the branch but inert until wired.*

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

- [ ] 4.5 repeat-contact: option 1 (name+DOB) / 2 (defer) / 3 (fetch-gated)
- [ ] 4.1/4.2/4.3 clinical content (when built)
- [ ] 4.8 photo prompt (when feasibility known)
- [ ] Phase 3 follow-ups: build now / later
