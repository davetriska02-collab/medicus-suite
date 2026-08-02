# Medicus Suite — Data Protection Impact Assessment (DPIA)

**Document reference:** MS-DPO-DPIA-001
**Product version:** 3.126.0
**Document version:** 1.1 (DRAFT — pending sign-off)
**Date:** 2026-08-02 (v1.1 — adds the rota surface: employee data, including
Article 9 special-category staff health data, and the optional shared-drive
replication of it. v1.0: 2026-06-14.)
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

From v3.126.0 the suite also processes **employee** data in its rota surface,
including Article 9 special-category health data about staff (sickness absence,
fit-note flags, Bradford Factor scores, parental leave). That is a distinct
processing purpose under a distinct lawful basis and is assessed separately in
§2 and §5 below.

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

**Employee data — a second data class (rota, from v3.126.0).** The rota surface
processes **staff** rather than patient data, and it is the only part of the
suite that does so:
- **Categories.** Name, role, employment type, contracted sessions, site, working
  pattern, leave records and an audit trail of who changed what. The leave types
  in `rota/shared/model.js` (`LEAVE_TYPES`) include **sickness** and **parental**
  leave, and the product derives **Bradford Factor** absence scores and carries
  **fit-note** flags. Absence and sickness data concerning an identified employee
  is **health data — UK GDPR Article 9 special-category data** — as are the
  inferences drawn from it. It is employment data, not patient data: no patient
  identifier is stored by the rota.
- **Controller / lawful basis.** The practice is controller **as employer** here,
  not as a health-care provider: Art.6(1)(b)/(c) (contract of employment, legal
  obligation) with Art.9(2)(b) (employment, social security and social protection
  law) and DPA 2018 Sch.1 Pt.1 §1 — which requires an **appropriate policy
  document**. The direct-care bases used elsewhere in this DPIA (Art.6(1)(e) /
  Art.9(2)(h)) do **not** cover it.
- **Storage.** `chrome.storage.local` on the workstation, under the eight
  `rota.*` keys, alongside the rest of the suite's local data.
- **Optional shared-drive replication.** `rota/shared/sync.js` can replicate the
  whole rota — **including the named audit trail and leave records** — to a
  folder the user chooses on the practice's own shared drive, as a single JSON
  file (`medicus-rota-sync.json`) polled every 15 seconds, read-modify-write,
  **last writer wins**. Anyone with access to that folder can read every staff
  record in it and can overwrite it; there is no per-user access control inside
  the file and a concurrent edit can be lost.
- **Mitigation posture.** Replication is **opt-in** and requires an explicit
  File System Access API folder grant per machine; the location is chosen and
  controlled by the practice; **no cloud service, no third party and no
  manufacturer-held copy** is involved — the file never leaves the practice's own
  storage. From v3.126.0 the **read-back path is validated** before anything is
  written to local storage (`rota/engine/validate.js`, called by
  `rota/app/app.js`): a malformed shared file is refused whole, nothing is saved,
  and the rejection is surfaced to the user. The deploying practice remains
  responsible for choosing a folder whose share permissions match who may see
  colleagues' sickness and leave data, and for covering the rota in its own
  employee privacy notice and appropriate policy document.
- **Patient data in the rota.** The Medicus reconciliation is read-only and
  patient names present in appointment-book payloads are counted/displayed
  transiently to size the work; **they are never persisted** — the PHI-minimisation
  rule is a stated invariant of the rota subtree.

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
| Staff special-category data (sickness, Bradford scores, fit-note flags, parental leave) over-shared via the rota's shared-drive folder | Med / Med | Replication is opt-in and off by default; explicit per-machine folder grant; practice-chosen location on the practice's own drive; no cloud/third party; practice sets the folder's share permissions to match who may see colleagues' absence data, and covers the rota in its employee privacy notice / appropriate policy document | Med |
| Malformed or tampered shared-drive rota file corrupting locally stored staff data | Low / Med | Read-back validated before any write (`rota/engine/validate.js`); a malformed document is refused whole and surfaced, never partially applied; store-level coercion of settings shapes; parity-tested against the backup-import validator | Low |
| Lost staff-data edit through last-writer-wins sync | Med / Low | Monotonic version counter, read-modify-write push, named audit trail of changes; local copy retained and never overwritten by a rejected document | Low |

## 6. Outcome and sign-off

Residual data-protection risk is **low** for the patient-data processing, driven
principally by the local-only, zero-egress architecture.

For the **staff data held by the rota** the residual risk is **low-to-medium**
and is carried by the deploying practice as employer: the software keeps the data
inside the practice's own storage and validates what it reads back, but the
practice must (a) point shared-folder sync at a location whose permissions match
who may lawfully see colleagues' sickness and leave data, or leave sync off, and
(b) cover the rota in its employee privacy notice and Sch.1 appropriate policy
document. Approved for the stated processing on that basis.

**DPO / accountable person:** Dr Dave Triska — [SIGNATURE / DATE]
**Review:** at each minor/major release and on any change to data flows.
