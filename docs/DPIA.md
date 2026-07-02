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
- **No external transmission of patient data.** By default, the only outbound
  network call is a version check to `api.github.com` carrying no patient data.
- **Leaflets tab (optional, off by default).** With no API key configured, this
  tab searches a bundled local index and opens nhs.uk in a new browser tab —
  no new endpoint is contacted. If a user opts in by pasting an NHS Website
  Content API key (Options → Leaflets), selecting a search result sends a GET
  request to `api.nhs.uk` containing only the **condition or medicine name**
  the user selected — never a patient identifier or any other patient data.
  The key is stored locally on that device only and is excluded from suite
  backups.

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
zero-egress architecture. Approved for the stated processing.

**DPO / accountable person:** Dr Dave Triska — [SIGNATURE / DATE]
**Review:** at each minor/major release and on any change to data flows.
