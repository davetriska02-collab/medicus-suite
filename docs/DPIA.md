# Medicus Suite — Data Protection Impact Assessment (DPIA)

**Document reference:** MS-DPO-DPIA-001
**Product version:** 3.199.1 (§2 Reception module and the associated §5 rows added at this version; the remainder was written at 3.84.2)
**Document version:** 1.1 (DRAFT — pending sign-off)
**Date:** 2026-06-14; Reception module section added 2026-07-28
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
applies arithmetic threshold checks, and re-displays a reorganised view. It also
performs a small, enumerated set of **user-initiated writes** back into Medicus
(appointment booking, task creation, document/lab filing, record tidying) under
the user's own authenticated session — no new categories of personal data are
created by these, and Medicus remains the system of record; the full list and
its controls is at `docs/CLINICAL-SAFETY-NOTICE.md` §6.1.

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

### 2.1 Reception module (guided phone capture) — added 2026-07-28

The Reception module is the one part of the suite where the practice's staff
**originate** personal data rather than re-display data already in Medicus, so
it is assessed separately. It ships **disabled**; each capture pathway is
enabled only after a clinician has reviewed its content and staff have been
briefed (CSN limitation 27).

**Nature and purpose.** A member of non-clinical front-desk staff, on the phone
to a patient, works through a fixed, clinician-reviewed question set for the
presenting problem (red-flag questions first) and the module composes a
plain-text complaint description. The text is copied to the clipboard and the
member of staff **pastes it into Medicus**, where it becomes part of the
patient's record.

**Data categories.** **Special-category data (health, UK GDPR Art.9)** —
symptoms, red-flag answers and free-text detail about a live clinical problem,
captured as the caller reports it. Depending on the pathway this can include
data about sexual health, pregnancy, and mental health / self-harm. Also
captured: the taker's initials (staff data). The generated text carries the open
patient's name/DOB in its header specifically so that a wrong-record paste is
detectable on reading; those identifiers are held **in memory only** and are
never written to storage.

**Data flows.**
- Capture happens **entirely locally** in the browser side panel. Nothing about
  a capture is transmitted anywhere: no external endpoint, no manufacturer
  telemetry, no server-side copy.
- The only onward flow is the **user's own paste into Medicus**. From that point
  the data is in the patient's record under the practice's existing controls —
  **Medicus is, and remains, the system of record**; the extension keeps no copy
  of what was pasted.

**Transient draft persistence (`reception.captureDraft`).** A 10–15 question
telephone capture is lost entirely if the user switches module or tab, so the
in-progress answers are auto-saved (debounced ~400 ms) to
`chrome.storage.local` on that workstation. This key is PHI-bearing and is
therefore bounded on every axis:
- **TTL 4 hours** — a draft older than that is discarded on read and the key
  removed;
- **cleared on completion** — removed when the summary is generated or the user
  discards;
- **never backed up** — explicitly excluded from the suite backup envelope and
  regression-guarded by the allowlist in `test-backup-coverage.js`, so a backup
  file cannot carry a caller's answers to another machine;
- **local only** — browser-profile storage on that workstation; no server copy,
  and it is cleared with the browser profile / on uninstall;
- **answers only** — the draft holds the form field values, the pathway id and
  the taker's initials; the patient's name/NHS number/DOB are not written into
  it (free-text answers are user-typed and could in principle contain a name —
  staff are briefed to record the caller's account, not to re-key identifiers).
- **PLANNED (not yet shipped):** pathways marked `sensitive` — the mental-health
  / emotional-distress pathway in particular — will be **excluded from draft
  autosave entirely**, so suicidal-ideation free text never sits in
  `chrome.storage.local` at all. This is phase B of
  `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`; until it ships, the 4-hour TTL
  above is the only bound on that content and practices enabling a mental-health
  pathway should be told so.

**Shared front-desk workstation processing.** Unlike the clinical modules, the
reception surface runs on a **workstation shared between staff across a shift**.
Two consequences follow, both of which the deploying practice must manage:
- a draft restored by the *next* user is a previous caller's data. Restoration is
  never automatic: it is an explicit choice from a time-stamped banner, and staff
  are instructed to confirm the draft belongs to the current contact and discard
  it otherwise (CSN limitation 34, hazard H-029);
- the draft's confidentiality is the confidentiality of the browser profile.
  Practices must apply their normal shared-workstation controls — per-user
  Chrome profiles or login, screen lock on step-away, and ending the session at
  the end of a shift. Screen visibility at a front desk is a practice
  environmental control, not something the software can enforce.

**Retention.** Draft ≤ 4 hours, then automatic deletion. Generated text and
taker initials are in-memory only and are discarded when the panel closes.
Persisted reception **configuration** (`reception.config`,
`reception.customPathways`, `reception.pathwayOverrides`, `reception.tilePrefs`)
is practice configuration and pathway content — not patient data — and is the
only reception data included in suite backups.

**PLANNED — booking under clinician-agreed rules** (phase D of the same plan,
not shipped at the date of this document): would let reception create an
appointment for the caller. That is a write into Medicus, not a new collection
of personal data, and it causes Medicus to send its own booking-confirmation
SMS/email to the patient. It introduces no new data category and no new
recipient beyond the patient themselves; its risk is wrong-patient booking,
assessed as a clinical-safety hazard (H-043 and the hazard entry required before
that phase ships) rather than a data-protection one. This DPIA is to be revisited
when it ships.

## 3. Consultation

[RECORD any consultation — e.g. practice IG lead / Caldicott Guardian / DPO sign-off
at deploying practices. Note real-world use at Witley & Milford Surgery.]

## 4. Necessity and proportionality

- **Lawful basis (controller):** Art.6(1)(e) public task and Art.9(2)(h)
  (provision of health care) — the practice's existing bases for direct care.
  The extension introduces no new processing purpose beyond what the clinician is
  already authorised to do in Medicus.
- **Reception module — no change of lawful basis.** Taking a caller's account of
  their problem at the front desk, recording it, and routing it is the practice's
  existing direct-care processing, performed by staff who already do it on paper
  or in Medicus free text under the practice's delegated-authority arrangements.
  The module structures and locally buffers that same processing; it introduces
  no new purpose, no new controller, no new recipient, and no processor —
  **Art.6(1)(e) / Art.9(2)(h) continue to apply unchanged.** Non-clinical staff
  processing health data in this way are covered by the practice's existing
  confidentiality obligations and duty of confidence (Art.9(3) — processing under
  the responsibility of a professional subject to an obligation of secrecy /
  equivalent duty). What does change is the *sensitivity concentration* of a
  locally-buffered draft, addressed by the controls at §2.1 and the risk rows at
  §5.
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
| **Reception:** special-category (health) free text buffered in `chrome.storage.local` as a capture draft | Low / Med | Answers only (no name/NHS number/DOB written); 4 h TTL enforced on read; cleared on generate/discard; excluded from suite backups and CI-guarded (`test-backup-coverage.js`); local to the workstation, no server copy | Low |
| **Reception:** a draft on a **shared front-desk workstation** seen or restored by the next member of staff | Med / Med | Restore is never automatic — explicit choice from a time-stamped banner, with the instruction to confirm it belongs to the current contact and discard otherwise (H-029, CSN limitation 34); TTL 4 h; practice shared-workstation controls (per-user profile/login, screen lock, end session at shift end) stated as a deploying-organisation responsibility | Med — residual sits with the practice's own workstation controls |
| **Reception:** highly sensitive pathways (mental health / self-harm, sexual health) buffered like any other capture | Med / Med | Today: the same 4 h TTL, no-backup and clear-on-completion bounds. **PLANNED (phase B, not yet shipped):** `sensitive` pathways skip draft autosave entirely, so this content is never written to storage; sensitive pathways also require taker initials | Med until phase B ships, then Low |
| **Reception:** capture text pasted into the wrong patient's record | Low / High | Patient name/DOB embedded in the generated text header so a wrong-record paste is detectable on reading; staff instructed to verify the destination record before pasting (CSN limitation 27, H-001 discipline) | Low |
| **Reception:** capture data leaving the practice | — | None by design — capture is entirely local; the only onward flow is the user's own paste into Medicus, which is the system of record | N/A |

## 6. Outcome and sign-off

Residual data-protection risk is **low**, driven principally by the local-only,
zero-egress architecture. The Reception module is the one area carrying a
**medium** residual, and it is medium for an environmental reason rather than a
software one: a shared front-desk workstation, where the confidentiality of a
locally-buffered draft is the confidentiality of the browser profile. The
software-side bounds (answers-only, 4 h TTL, clear-on-completion, never backed
up, explicit time-stamped restore) are in place and CI-guarded; the remaining
control — per-user login, screen lock, ending the session at shift end — sits
with the deploying practice and is stated as such. Approved for the stated
processing, subject to that.

**DPO / accountable person:** Dr Dave Triska — [SIGNATURE / DATE]
**Review:** at each minor/major release and on any change to data flows.
**Next scheduled revisit:** when reception appointment booking (phase D) and the
`sensitive`-pathway autosave exclusion (phase B) ship.

## 7. Document history

| Doc version | Date | Author | Status | Change |
|---|---|---|---|---|
| 1.0 | 2026-06-14 | DT | DRAFT — pending sign-off | Initial DPIA at product v3.84.2. |
| 1.1 | 2026-07-28 | Claude (drafted for DPO review) | DRAFT — pending sign-off | Added §2.1 Reception module (special-category phone-capture text; transient `reception.captureDraft` persistence — 4 h TTL, never backed up, sensitive-pathway exclusion marked PLANNED; shared front-desk workstation processing; paste-into-Medicus flow with Medicus as system of record; planned reception booking marked as not shipped). Added the reception lawful-basis paragraph to §4 recording **no change of lawful basis**. Added five reception rows and one no-egress row to the §5 risk table. Corrected the §2 statement that the extension "writes nothing back to Medicus" (see CSN §6.1). Prepared as Phase 0 of `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`. **No sign-off given.** |
