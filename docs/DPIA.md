# Medicus Suite — Data Protection Impact Assessment (DPIA)

**Document reference:** MS-DPO-DPIA-001
**Product version:** 3.84.2
**Document version:** 1.0 (DRAFT — pending sign-off)
**Date:** 2026-06-14
**Data controller:** The deploying GP practice (each practice is controller for
its own patient data). Graysbrook Ltd is the software manufacturer.
**Manufacturer DPO / contact:** Dr Dave Triska — [DPO CONTACT EMAIL]
**ICO registration (Graysbrook Ltd):** [ICO REGISTRATION NUMBER]

---

## 1. Is a DPIA needed?

Medicus Suite processes special-category health data (patient-identifiable
clinical information) on behalf of clinical users, so a DPIA is conducted as good
practice. Note: the processing is **wholly client-side and local** — the
software performs no external transmission of patient data — which materially
limits the risk profile.

## 2. Description of the processing

**Nature.** A read-only Chrome extension reads data already rendered in the
clinician's authenticated Medicus session (via the page DOM and the
`*.api.england.medicus.health` API, using the user's own session cookies),
applies arithmetic threshold checks, and re-displays a reorganised view. It
writes nothing back to Medicus.

**Data categories.** Patient demographics (name, NHS number, DOB, age, sex),
medications, observations/results, problem lists, appointment/queue metadata —
all already visible to the authorised clinician in the source record.

**Data flows / storage.**
- Patient-identifiable context (name, NHS number, DOB) is held **in memory only**
  and is **not persisted** (`SECURITY-AUDIT.md §5`).
- A minimised subset is held in `chrome.storage.local` (browser-local, on the
  clinician's workstation): the Request Monitor persists **initials only**;
  transient print/passport keys holding fuller data carry a 60-second TTL
  backstop (TF4). No patient data is held on any server.
- **No external transmission of patient data.** The only outbound network call is
  a version check to `api.github.com` carrying no patient data.

**Scope / context / purpose.** Used by authorised clinical and administrative
staff within a Medicus-enabled GP practice, as a memory aid / operational
display, under each user's own credentials. Purpose: surface monitoring, QOF,
and operational information already in Medicus to support (not replace) clinical
and administrative work.

## 3. Consultation

[RECORD any consultation — e.g. practice IG lead / Caldicott Guardian / DPO sign-off
at deploying practices. Note real-world use at Witley & Milford Surgery.]

## 4. Necessity and proportionality

- **Lawful basis (controller):** Art.6(1)(e) public task and Art.9(2)(h)
  (provision of health care) — the practice's existing bases for direct care.
  The extension introduces no new processing purpose beyond what the clinician is
  already authorised to do in Medicus.
- **Data minimisation:** patient identifiers in memory only; persisted data
  reduced to initials / TTL-bounded; no server-side storage; no analytics or
  telemetry. Minimisation is treated as a patient-safety property and is
  regression-tested (F2 / TF1).
- **Access control:** runs only under the authenticated user's own Medicus
  session; no independent credential store; restricted to `*.medicus.health`.
- **Retention:** browser-local only; cleared with the browser profile / on
  uninstall; no manufacturer-held retention.
- **Transparency:** intended purpose, limitations, and the no-egress design are
  documented and provided to users (`INTENDED-PURPOSE.md`, CSN, disclaimer).

## 5. Risks and mitigations

| Risk | Likelihood / impact | Mitigation | Residual |
|---|---|---|---|
| Patient data at rest in `chrome.storage.local` (plaintext) read by local malware | Low / Med | Identifiers in memory only; persisted data minimised to initials + TTL; same exposure as the browser profile itself | Low |
| Wrong-patient display (IG + safety) | Low / Med | UUID-keyed cache + SPA-navigation invalidation; source-verification duty (H-001) | Low |
| Malicious backup import degrading/altering data handling | Low / Med | Import hardening, type validation, preview warnings, size cap (F1/F7/NF1) | Low |
| Patient data leaving the browser | — | None by design — no external patient-data transmission | N/A |
| Re-identification via desktop notifications | Low / Low | Notification text minimised; "clinic mode" mute (F2) | Low |

## 6. Outcome and sign-off

Residual data-protection risk is **low**, driven principally by the local-only,
zero-egress architecture. Approved for the stated processing. **This outcome covers the core suite; the optional AI Assist module (off by default) is assessed separately in §7 and is not approved for real patient use until that addendum is signed.**

**DPO / accountable person:** Dr Dave Triska — [SIGNATURE / DATE]
**Review:** at each minor/major release and on any change to data flows.

---

## 7. Addendum — optional AI Assist module / GP Forge (proposed, pending DPO + Caldicott sign-off)

Sections 1–6 describe the **core suite**, whose low residual risk rests on its local-only,
zero-egress design. The optional **AI Assist** module (v3.133.0–v3.134.0, **disabled by default**)
introduces a new, bounded processing activity assessed here separately. It must not be enabled with
real patient data until this addendum is signed **and** the deploying practice has completed its own
DPIA and DCB0160 for the GP Forge appliance.

**Nature of the new processing.** When a practice enables AI Assist, the clinician's typed
administrative prompt — or, in Dictate mode, captured consultation audio — is transmitted to a
**practice-hosted, on-premises GP Forge LLM server** for (a) administrative text drafting or
(b) verbatim speech-to-text transcription. No patient record is auto-attached. Outputs are
human-reviewed; nothing is written to Medicus.

**Data categories.** Free-text administrative instructions (which may inadvertently include
patient-identifiable detail) and, in Dictate mode, **consultation audio** (special-category health
data).

**Data flows / recipients.** Browser → **local GP Forge server on the practice LAN only**. **No
internet egress, no cloud service, no third-party processor.** GP Forge enforces a single
allow-listed egress (to the Medicus API host only) as a fail-closed runtime control; it retains no
audio and stores only **hashes** of inputs/outputs in a tamper-evident audit log by default.

**Lawful basis.** Unchanged from §4: Art.6(1)(e) public task + Art.9(2)(h) (provision of health
care). No new purpose beyond supporting the clinician's existing authorised work.

**Why on-prem materially limits risk.** No international transfer (UK GDPR Ch.V not engaged) and no
external processor (no Art.28 contract) — provided the no-egress control is genuine and enforced.

**Risks and mitigations (AI Assist):**

| Risk | Likelihood / impact | Mitigation | Residual |
|---|---|---|---|
| Patient-identifiable detail typed/spoken and sent to the local server | Low / Med | Off by default; admin/verbatim only; no record attached; UI instructs use of [PLACEHOLDERS] + consent acknowledgement; LAN-only, no egress | Low |
| Audio captured/transmitted (special-category) | Low / Med | Local server only; no internet egress; no audio retained by the suite; consent acknowledgement before recording | Low |
| Output relied on as clinical advice | Low / Med | Verbatim/admin only; "not clinical advice" banner; human review/edit; nothing written to Medicus | Low |
| Egress control fails (data could leave the perimeter) | Low / High | GP Forge fail-closed egress runtime control (CSO sign-off condition); off by default until verified | Low |
| Mis-transcription presented as faithful | Med / Med | Transcript shown as unverified for review; clinician verifies against what was said (H-036) | Low |

**Outcome (addendum).** Residual risk is assessed **low when AI Assist is operated off-by-default,
on-prem/no-egress, admin+verbatim only, with human review** — but this is a **new processing
activity** requiring DPO + Caldicott Guardian sign-off, plus the deploying practice's own DPIA /
DCB0160, before enablement with real patients. **Proposed; pending sign-off.**

**DPO / Caldicott Guardian:** [SIGNATURE / DATE]
