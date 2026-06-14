# Proposal: A Safe, Client-Side EHR Augmentation Layer for UK Primary Care (SEAL)

**Clinician-led, vendor-hosted, read-only overlays for compliant EPRs**

**Version 0.2 · 14 June 2026 · Dr Dave Triska (Witley & Milford Surgery), with the Medicus Suite project**

> *Naming note:* this was drafted as "EAL-1". That collides with Common Criteria
> Evaluation Assurance Levels (a security-certification term), so it is renamed
> **SEAL — Safe EHR Augmentation Layer**. The "sealed" connotation (no write-back,
> no data egress) is deliberate.

---

## Executive summary

We propose **SEAL**, a narrow, open interface that lets an EPR vendor safely host
**clinician-built, read-only intelligence overlays** inside their product — safety
chips, triage red-flagging, capacity dashboards, reception prompts, record
visualisers — without those overlays writing to the record or moving patient data
outside the session.

A **working reference implementation already exists**: the Medicus Suite (v3.77.x)
delivers exactly this pattern on the live Medicus EPR today, as an external Chrome
extension. SEAL's contribution is to turn that *unofficial, scraping-based* pattern
into an *official, vendor-hosted, sandboxed* one — safer, more durable, and
adoptable beyond a single project.

We are deliberately scoping this as a **Medicus-first pilot**, not a finished
national standard. The realistic path is: prove the interface on the most modern,
lowest-friction vendor, then take the evidence to NHS England and HL7.

---

## How this relates to existing standards (read this first)

The obvious question is *"why not just use SMART on FHIR or CDS Hooks?"* — and the
answer is the whole point of SEAL.

- **SMART on FHIR** standardises app launch and FHIR data access. It governs *what
  data an app can read*, not *how an overlay is injected into the live clinical
  screen*.
- **CDS Hooks** (HL7) is the closest prior art: the EHR calls out at workflow points
  (`patient-view`, `order-select`) and a decision-support **service returns "cards"**.
  But CDS Hooks is **server-side** by design — it assumes an external service receives
  the hook payload and responds. That means patient context leaves the EPR to a remote
  endpoint, which brings a data-flow, DPIA and information-governance burden every time.

**SEAL is the client-side, local-only complement to CDS Hooks.** The rule logic runs
*inside the user's browser session* against data already on screen; **nothing is sent
to any external service**. The strongest version of this proposal is not "instead of"
the HL7 work — it is *"profile the CDS Hooks card model, but execute locally"*. We
should align SEAL's manifest and UI vocabulary with CDS Hooks/SMART where they fit, so
this reads to HL7 as an extension of their model, not a competitor to it.

---

## The problem

EPRs are general-purpose. The deep, workflow-specific intelligence GPs actually need
arrives slowly or never, and today's workarounds are fragmented (bolt-on SaaS,
template packs, raw browser extensions, IM1 integrations) — each either expensive,
narrow, or carrying its own data-flow risk. Clinicians have the domain insight but no
safe, standardised way to ship their own augmentations.

## The proposed interface — SEAL

A compliant EPR exposes a narrow, sandboxed, auditable client-side surface:

| Component | Purpose | Safety property |
|---|---|---|
| **Augmentation Manifest** | JSON declaring the hooks, data scopes, and UI slots requested | Signed + versioned; approval gated to practice/ICB; aligns with CDS Hooks/SMART vocabulary where possible |
| **Read-only observers** | Scoped access to current patient, queue, requests, prescribing screen | No write API is exposed by the host to overlays (see "the read-only guarantee" below) |
| **UI injection slots** | Pre-defined, style-controlled positions: side panel, in-record chips, toolbar, queue-row overlays | Host owns layout; overlay cannot reach outside its slot |
| **Local rule engine hook** | Register thresholds/rules (JSON) evaluated **in the sandbox** | No outbound network from the sandbox; no external call |
| **Update & verification** | Signed auto-update + static manifest check at install | Vendor verifies signature, declared scopes, and the no-egress attestation |
| **Attestation profile** | Machine-readable "this overlay is read-only and uses only these hooks / makes no external call" | Required to publish to a shared registry |

## The read-only guarantee — stated honestly

This matters, because it is where the original draft overclaimed.

- **In the Medicus Suite today**, read-only is **architectural**: it is an external
  extension with no write path to Medicus and no API key — it *could not* write even
  if it tried, and it reads only the logged-in session's own data.
- **Under a vendor-hosted SEAL interface**, read-only becomes **enforced by the host
  sandbox and the signed manifest** — i.e. it is a guarantee the *vendor* upholds by
  exposing no write APIs to overlays and by sandboxing network egress. That is a
  different (and stronger, if done right) trust model, but it is a *property the vendor
  enforces*, not a law of physics. SEAL must be specified so the sandbox makes write
  and egress **impossible for an overlay**, not merely disallowed.

## Clinical safety and governance — the part that needs solving, not asserting

A national pattern that lets clinicians *build and share* overlays influencing
clinical action sits squarely inside **DCB0129/0160 clinical risk management** and
potentially **MHRA Software-as-a-Medical-Device** scope. "Read-only" does **not**
dissolve this: a chip that wrongly displays "monitoring overdue" — or fails to — is a
clinical-safety event regardless of write access. SEAL must ship with a governance
model, not a hope. Proposed:

- **Risk tiers for overlays.**
  - *Tier 0 — display/reorganisation only* (re-presents data already on the screen,
    no thresholds): lowest risk.
  - *Tier 1 — threshold/rule overlays* that could influence clinical action: require a
    named clinical safety officer and a DCB0129-style hazard log **per published rule
    pack**.
  - *Tier 2 — anything that writes or calls externally*: **out of SEAL scope entirely.**
- **Who is the "manufacturer".** The clinician/practice that *publishes* a shared rule
  pack is its manufacturer and owns its safety case; the **vendor** owns the sandbox,
  the interface integrity, and signature verification. The registry requires an
  attestation + a link to the pack's hazard log before it can be shared.
- **Personal vs published.** An overlay a clinician runs only for themselves is closer
  to a personal checklist; the governance weight attaches when a pack is *distributed*
  to other practices. SEAL should make that boundary explicit.

This section is deliberately the longest because it is the real obstacle, and a
credible proposal owns it.

## Benefits

- **Clinicians:** ship a needed feature in weeks, share it safely with colleagues.
- **Practices/ICBs:** scoped approval, full audit trail, **no new external data flows**.
- **Vendors:** richer functionality with little development burden, a clear governance
  boundary, and differentiation ("our platform supports SEAL").
- **NHS:** faster, cheaper innovation; less lock-in to single-vendor add-ons.

## Proof of concept (what is actually true today)

The Medicus Suite ([github.com/davetriska02-collab/medicus-suite](https://github.com/davetriska02-collab/medicus-suite))
demonstrates the pattern working on a live NHS EPR:

- Per-patient safety chips (Sentinel), free-text triage lens, reception pathways,
  Condor ops dashboards, offline record visualiser.
- **Internal red-team security passes**, data-minimisation by design, no patient-data
  egress, versioned config migration.
- **In daily use in one practice**, with all clinical judgement retained by the clinician.

Honest caveats (a reviewer will check, so we state them): this is a **single-practice,
real-use** deployment, not an at-scale rollout; the live Medicus estate is still small
(early-adopter stage in 2026); and the suite's compliance artefacts are **"style-of"
DCB0129, not certified** — appropriate for a named-user internal tool, and a known
gap to close before any wider distribution. It required **no vendor changes** today —
but would be materially safer and more adoptable with official hooks.

## Scope and sequencing

We are **not** asking NHS England to ratify a national standard on day one. The order is:

1. **Medicus-first.** Medicus is the most modern, lowest-friction, challenger vendor
   with the smallest legacy add-on ecosystem to disrupt — the natural and realistic
   first mover. (Incumbents EMIS/TPP monetise the add-on market and carry the liability;
   their incentives cut against this until it is proven elsewhere.)
2. **Pilot, measure, document** the interface and the governance model on Medicus.
3. **Then** take the evidence to NHS England Digital and HL7 UK, positioned as a
   client-side profile alongside CDS Hooks.

## Requested next steps (low-friction)

1. **Medicus Health** to review this note and consider piloting a minimal SEAL surface
   (one read-only observer + one injection slot + signed manifest).
2. **A 2–3 hour joint workshop** (Medicus Health + 2–3 interested practices + a clinical
   safety officer) to refine the manifest spec and the Tier-1 governance model.
3. Publish **SEAL v0.x** as an open specification with the Medicus Suite as reference
   implementation, explicitly cross-referenced to SMART on FHIR and CDS Hooks.

---

## Appendix A — illustrative augmentation manifest

Sketch only, to make the surface concrete. Vocabulary intentionally echoes CDS Hooks.

```jsonc
{
  "seal": "0.2",
  "id": "uk.witleymilford.sentinel-monitoring",
  "name": "Drug-monitoring safety chips",
  "publisher": { "name": "Witley & Milford Surgery", "clinicalSafetyOfficer": "Dr D Triska" },
  "riskTier": 1,                       // 0 display-only | 1 threshold/rule | 2 = rejected
  "hazardLog": "https://…/HAZARD-LOG.md",
  "hooks": ["patient-view"],           // CDS-Hooks-aligned workflow points
  "dataScopes": ["patient.medications", "patient.observations", "patient.problems"],
  "uiSlots": ["record.sidePanel", "record.inlineChips"],
  "execution": "local",                // host MUST sandbox; no outbound network
  "attestation": { "readOnly": true, "noExternalCall": true },
  "signature": "…"                     // verified by host at install/update
}
```

The host rejects the manifest if it requests a write scope, declares `execution`
other than `local`, requests a slot it does not own, or fails signature/attestation
verification.
