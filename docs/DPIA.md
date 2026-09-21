# Medicus Suite — Data Protection Impact Assessment (DPIA)

**Document reference:** MS-DPO-DPIA-001
**Product version:** 3.211.0 (§2 employee-data / rota section and the associated §5 rows added at this version; §2 Reception module and its §5 rows at 3.199.1; the remainder was written at 3.84.2)
**Document version:** 1.3 (SIGNED 2026-09-20 — Dr D. Triska, CSO / manufacturer DPO contact, GMC 6159481, in session; practice-side controls per §6 remain with each deploying practice as controller). **Correction addendum §2.3 drafted 2026-09-21 as document version 1.4 — DRAFT, PENDING DPO/CSO SIGN-OFF; no signature invented. The v1.3 signed text below is retained unaltered; dated correction pointers are added beside statements §2.3 corrects.**
**Date:** 2026-06-14; Reception module section added 2026-07-28; rota / employee-data section added 2026-08-02 (v1.2); Transactional API proxy section added 2026-09-20 (v1.3 — optional UK-proxy read path); v1.3 signed 2026-09-20 (the document's first signature — versions 1.0–1.2 were never signed, and no earlier signature is invented)
**Data controller:** The deploying GP practice (each practice is controller for
its own patient data). Graysbrook Ltd is the software manufacturer.
**Manufacturer DPO / contact:** Dr Dave Triska — [DPO CONTACT EMAIL]
**ICO registration (Graysbrook Ltd):** [ICO REGISTRATION NUMBER]

---

## 1. Is a DPIA needed?

Medicus Suite processes special-category health data (patient-identifiable
clinical information) on behalf of clinical users, so a DPIA is conducted as good
practice. Note: the **default** processing is **wholly client-side and local**
(`txn.integrationMode` = `session`). That materially limits the risk profile.
The optional Transactional API path (off by default) is a deliberate exception
and is assessed at §2.2.

From v3.211.0 the suite also processes **employee** data in its rota surface,
including Article 9 special-category health data about staff (sickness absence,
fit-note flags, Bradford Factor scores, parental leave). That is a distinct
processing purpose under a distinct lawful basis and is assessed separately in
§2 and §5 below.

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
  and is **not persisted** (`SECURITY-AUDIT.md §5`). *(CORRECTION 2026-09-21 —
  no longer accurate as an absolute: see §2.3 item 1. Patient Alerts has
  persisted patient name / NHS number / DOB alongside each per-patient flag
  since v3.175.0, and a small set of TTL-bounded local working copies also
  exists. PENDING sign-off.)*
- A minimised subset is held in `chrome.storage.local` (browser-local, on the
  clinician's workstation): the Request Monitor persists **initials only**;
  transient print/passport keys holding fuller data carry a 60-second TTL
  backstop (TF4). No patient data is held on any server.
- **No external transmission of patient data, by default.** The only outbound
  network call in `session` mode is a version check to `api.github.com` carrying
  no patient data. The optional Transactional API path (§2.2) is the exception.
  *(CORRECTION 2026-09-21 — the "only outbound network call" sentence is no
  longer accurate: the shipped extension can contact the enumerated host set at
  §2.3 item 2 (`api.github.com`, `api.nhs.uk`, `termbrowser.nhs.uk`,
  `*.supabase.co`, `www.youtube-nocookie.com`, an optional user-granted
  StackChan LAN origin). None of these carries patient-identifiable data; each
  beyond the GitHub check is opt-in or, in one case
  (`termbrowser.nhs.uk`), carries SNOMED concept IDs only. PENDING sign-off.)*
- **Leaflets tab (optional, off by default).** With no API key configured, this
  tab searches a bundled local index and opens nhs.uk in a new browser tab —
  no new endpoint is contacted. If a user opts in by pasting an NHS Website
  Content API key (Options → Leaflets), selecting a search result sends a GET
  request to `api.nhs.uk` containing only the **condition or medicine name**
  the user selected — never a patient identifier or any other patient data.
  The key is stored locally on that device only and is excluded from suite
  backups.
- **Note YouTube playlist (optional, off by default, from v3.254.0).** A
  practice-authored playlist can play on a waiting-room TV. No patient data is
  sent. The request is an iframe to `youtube-nocookie.com` carrying only a
  sanitised playlist id. Google sees the practice workstation's public IP and
  ordinary playback telemetry. The practice elects this path and owns the
  transfer; it is not on by default.

**Employee data — a second data class (rota, from v3.211.0).** The rota surface
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
  storage. From v3.211.0 the **read-back path is validated** before anything is
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

### 2.2 Optional Transactional API proxy — added 2026-09-20 (SIGNED 2026-09-20)

This is the open action from the v3.202.0 INTENDED-PURPOSE signature: the
optional Medicus Transactional API path had no controller/processor or transfer
assessment. This section is that assessment, **signed 2026-09-20 by Dr D.
Triska (CSO, GMC 6159481, in session)** alongside hazard H-077 and CSN §6
items 1/8/9 — see `docs/CSO-SIGNOFF-PACK-H063-H076.md`. A practice may set
`txn.integrationMode` to `hybrid` or `transactional` only after putting its own
processing record / DPA with Graysbrook in place (see "Lawful basis" below).

**Nature.** When — and only when — a practice sets `txn.integrationMode` to
`hybrid` or `transactional` and supplies a proxy URL plus `txn.callerKey`,
patient **reads** are routed through a Graysbrook-operated UK backend (a
Supabase edge function) which signs a short-lived Medicus token and forwards
the request to the official Medicus Transactional API. The GP Connect structured
care record and demographics return by the same route. The path is **read-only**
(`shared/txn-transport.js` throws on `isWrite`). Hybrid mode also returns the
ordinary session bundle for comparison. Responses may be cached for 60 seconds
on the workstation.

**Roles.** The deploying practice remains **controller**. Graysbrook Ltd is
**processor** for the proxy hop only (token sign + forward). Medicus Health Ltd
remains the system of record. There is no manufacturer-held copy of the care
record after the response is returned to the browser.

**Transfer.** UK-to-UK. The proxy is described as UK-hosted. No international
transfer is intended by this path.

**Credential.** `txn.callerKey` is stored in `chrome.storage.local` on that
device, read only by the service worker, and excluded from suite backups. It is
not a Medicus username or password.

**Lawful basis.** Unchanged Art.6(1)(e) / Art.9(2)(h) for direct care — the
clinician is reading the same record they are already authorised to see in
Medicus. The processor relationship for the proxy hop needs a practice-side
processing record / DPA with Graysbrook before the path is enabled.

**Mitigation posture.** Default off; read-only; SW-only credential; short-lived
token; hazard **H-077** (Accepted (ALARP), CSO 2026-09-20). Enabling the path is
a practice configuration act, not a silent update.

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
  pathway should be told so. *(CORRECTION 2026-09-21 — phase B **shipped at
  v3.200.0 on 2026-07-28**, before this document's v1.3 signature: `sensitive`
  pathways are never draft-saved, never offered for restore, and any
  pre-existing draft is cleared on entry
  (`side-panel/modules/reception/reception.js`). See §2.3 item 3. PENDING
  sign-off.)*

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
when it ships. *(CORRECTION 2026-09-21 — phase D **shipped at v3.202.0 on
2026-07-28**, before this document's v1.3 signature: reception in-panel
appointment search + booking, under hazard **H-051** (signed ALARP at
v3.202.1). The data-protection analysis in this paragraph was borne out —
write into Medicus, no new data category, Medicus sends its own confirmation —
but the "not shipped" and "to be revisited when it ships" statements were
already false at signature. §2.3 item 3 is that revisit. PENDING sign-off.)*

### 2.3 Correction addendum — 2026-09-21 (document version 1.4 — DRAFT, PENDING DPO/CSO SIGN-OFF)

This addendum corrects three factual claims in the signed v1.3 text that no
longer match — or at the moment of signature already did not match — the
shipped code. Per the additive-honesty convention, the signed text above is
retained unaltered with dated pointers; this section states the current facts,
each verified against the code at product v3.264.16. **No signature is
invented; this addendum is not in force until the DPO/CSO signs it.** It makes
no new risk assessment and changes no lawful-basis analysis.

**1. Patient identity IS persisted by one feature (correcting §2 "in memory
only ... not persisted").** Patient Alerts (shipped v3.175.0) stores its
per-patient flags in `chrome.storage.local` under `patientAlerts.byPatient`,
keyed by patient UUID, and each entry carries the patient's **name, NHS number
and DOB** as display metadata
(`side-panel/modules/patient-alerts/patient-alerts-core.js`). Bounds already
in the code: identity fields are stripped from any entry not updated for **90
days** (`IDENTITY_IDLE_MS`, applied on every load via `stripIdleIdentity`), and
since v3.264.1 `patientAlerts.byPatient` is **excluded from suite backups**
(stripped on export, skipped on import — `shared/io/patient-alerts-io.js`), so
a backup file cannot carry the identity list to another machine. In addition,
the TTL-bounded local working copies enumerated in
`docs/CLINICAL-SAFETY-NOTICE.md` §6 item 8 hold patient data transiently:
print/passport payloads (60-second clear backstop), the reception capture
draft (4-hour TTL, answers only), the last Sweep run (2 hours), and the
duplicate-checker scan state (7 days). The Request Monitor initials-only claim
is unchanged. The §5 risk row "Patient data at rest in `chrome.storage.local`"
already covers this at-rest exposure class; its "identifiers in memory only"
mitigation wording is corrected by this item to "identifiers persisted only by
Patient Alerts (90-day idle strip, never backed up) and TTL-bounded working
copies".

**2. Live outbound-host inventory (correcting §2 "the only outbound network
call").** The complete set of hosts the shipped extension can contact, from
`manifest.json` `host_permissions` and the code:

| Host | Trigger | Data carried |
|---|---|---|
| `*.medicus.health` / `*.api.england.medicus.health` | Default; the user's own authenticated Medicus session | Patient data the user is already authorised to see; the enumerated user-initiated writes (CSN §6.1, W1–W24) |
| `api.github.com` (download links restricted to `github.com` / `*.githubusercontent.com`) | Default; daily release check (`shared/update-checker.js`) | No patient data |
| `api.nhs.uk` | **Opt-in** (user pastes an NHS Website Content API key) — Leaflets | The selected condition/medicine name only; never a patient identifier |
| `termbrowser.nhs.uk` | Default when the "Clean up code" widget checks SNOMED concept retirement (service-worker relay, host-locked — `service-worker.js`, added 2026-07-29) | SNOMED concept IDs only; never patient identifiers |
| `*.supabase.co` | **Opt-in ×2**: (a) Transactional API proxy (§2.2 — read-only, `shared/txn-transport.js` throws on any write); (b) task-presence store (practice's **own** Supabase project, `content-scripts/task-presence.js`) | (a) patient reads per §2.2; (b) staff presence beats only — site, task UUID, staff id, initials/display label, timestamps; no patient identifiers |
| `www.youtube-nocookie.com` | **Opt-in** — Note board playlist iframe (CSP `frame-src`) | Sanitised playlist id only |
| User-granted LAN origin (`optional_host_permissions`) | **Opt-in** — StackChan desk robot (Options → StackChan; per-origin grant) | Severity-class commands only; `shared/stackchan-bridge.js` strips patient fields by blocklist |

Link-outs (nhs.uk, NICE/CKS, qrisk.org, etc.) are ordinary user navigations in
new tabs, not extension fetches; the task-presence "native" layer listens on
the Medicus page's **own** Pusher websocket and opens no connection of its own;
the in-app feedback channel composes a mailto and transmits nothing itself.

**3. Reception phases B and D both shipped 2026-07-28 (correcting the two §2.1
"PLANNED (not yet shipped)" statements, and discharging the §6 revisit
trigger).** Phase B (`sensitive` pathways never draft-saved) shipped at
v3.200.0; phase D (reception in-panel appointment search + booking) shipped at
v3.202.0 under hazard H-051 (signed ALARP at v3.202.1). Both were live well
before the v1.3 signature of 2026-09-20; the "PLANNED" wording was carried
forward unrefreshed from the 2026-07-28 v1.1 draft. Consequences already
stated in the signed text and not re-assessed here: the §5 row "highly
sensitive pathways buffered like any other capture" records its own residual
as "Med until phase B ships, then Low" — phase B has shipped, so that row's
own stated post-ship residual (**Low**) applies, subject to sign-off of this
addendum; and §6's "next scheduled revisit ... when phase D and phase B ship"
is discharged by this addendum, which is that revisit.

**Sign-off (addendum v1.4):**
**DPO / accountable person:** _____________________ (Dr Dave Triska, CSO /
manufacturer DPO contact, GMC 6159481) **Date:** ____________
*(Wet-ink/in-session signature required; drafted by an automated agent, no
signature invented.)*

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
  regression-tested (F2 / TF1). *(CORRECTION 2026-09-21 — see §2.3 item 1:
  Patient Alerts persists identity per flagged patient, 90-day idle strip,
  never backed up. PENDING sign-off.)*
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
| Patient data leaving the browser (default `session` mode) | — | None by design in the default configuration | N/A |
| Patient data leaving the browser via the optional Transactional API proxy (`hybrid` / `transactional`) | Low / High if enabled without review | Default off; read-only; SW-only `txn.callerKey`; UK proxy; H-077 Accepted (ALARP); this DPIA increment and H-077 signed 2026-09-20; a practice must put its own processing record / DPA with Graysbrook in place before enabling | Low with the practice-side DPA in place (signed 2026-09-20) |
| Re-identification via desktop notifications | Low / Low | Notification text minimised; "clinic mode" mute (F2) | Low |
| **Reception:** special-category (health) free text buffered in `chrome.storage.local` as a capture draft | Low / Med | Answers only (no name/NHS number/DOB written); 4 h TTL enforced on read; cleared on generate/discard; excluded from suite backups and CI-guarded (`test-backup-coverage.js`); local to the workstation, no server copy | Low |
| **Reception:** a draft on a **shared front-desk workstation** seen or restored by the next member of staff | Med / Med | Restore is never automatic — explicit choice from a time-stamped banner, with the instruction to confirm it belongs to the current contact and discard otherwise (H-029, CSN limitation 34); TTL 4 h; practice shared-workstation controls (per-user profile/login, screen lock, end session at shift end) stated as a deploying-organisation responsibility | Med — residual sits with the practice's own workstation controls |
| **Reception:** highly sensitive pathways (mental health / self-harm, sexual health) buffered like any other capture | Med / Med | Today: the same 4 h TTL, no-backup and clear-on-completion bounds. **PLANNED (phase B, not yet shipped):** `sensitive` pathways skip draft autosave entirely, so this content is never written to storage; sensitive pathways also require taker initials | Med until phase B ships, then Low |
| **Reception:** capture text pasted into the wrong patient's record | Low / High | Patient name/DOB embedded in the generated text header so a wrong-record paste is detectable on reading; staff instructed to verify the destination record before pasting (CSN limitation 27, H-001 discipline) | Low |
| **Reception:** capture data leaving the practice | — | None by design — capture is entirely local; the only onward flow is the user's own paste into Medicus, which is the system of record | N/A |
| Staff special-category data (sickness, Bradford scores, fit-note flags, parental leave) over-shared via the rota's shared-drive folder | Med / Med | Replication is opt-in and off by default; explicit per-machine folder grant; practice-chosen location on the practice's own drive; no cloud/third party; practice sets the folder's share permissions to match who may see colleagues' absence data, and covers the rota in its employee privacy notice / appropriate policy document | Med |
| Malformed or tampered shared-drive rota file corrupting locally stored staff data | Low / Med | Read-back validated before any write (`rota/engine/validate.js`); a malformed document is refused whole and surfaced, never partially applied; store-level coercion of settings shapes; parity-tested against the backup-import validator | Low |
| Lost staff-data edit through last-writer-wins sync | Med / Low | Monotonic version counter, read-modify-write push, named audit trail of changes; local copy retained and never overwritten by a rejected document | Low |

## 6. Outcome and sign-off

Residual data-protection risk is **low** for the default patient-data
processing, driven principally by the local-only architecture. The optional
Transactional API proxy is a separate residual (this increment was signed
2026-09-20; Low with a practice-side DPA in place) and is **off by default**. The Reception module is
the one patient-data area carrying a **medium** residual, and it is medium for an
environmental reason rather than a software one: a shared front-desk workstation,
where the confidentiality of a locally-buffered draft is the confidentiality of
the browser profile. The software-side bounds (answers-only, 4 h TTL,
clear-on-completion, never backed up, explicit time-stamped restore) are in place
and CI-guarded; the remaining control — per-user login, screen lock, ending the
session at shift end — sits with the deploying practice and is stated as such.

For the **staff data held by the rota** the residual risk is **low-to-medium**
and is carried by the deploying practice as employer: the software keeps the data
inside the practice's own storage and validates what it reads back, but the
practice must (a) point shared-folder sync at a location whose permissions match
who may lawfully see colleagues' sickness and leave data, or leave sync off, and
(b) cover the rota in its employee privacy notice and Sch.1 appropriate policy
document.

Approved for the stated processing, subject to those practice-side controls.

**DPO / accountable person:** Dr Dave Triska (CSO / manufacturer DPO contact, GMC 6159481) — signed in session, 2026-09-20 (document version 1.3, product v3.264.1; recorded per `docs/CSO-SIGNOFF-PACK-H063-H076.md` — "Reviews and signed")
**Review:** at each minor/major release and on any change to data flows.
**Next scheduled revisit:** when reception appointment booking (phase D) and the
`sensitive`-pathway autosave exclusion (phase B) ship. *(CORRECTION 2026-09-21 —
both shipped 2026-07-28 (v3.202.0 / v3.200.0); the §2.3 correction addendum is
that revisit and awaits sign-off.)*

## 7. Document history

| Doc version | Date | Author | Status | Change |
|---|---|---|---|---|
| 1.4 | 2026-09-21 | Claude (drafted for DPO/CSO review) | DRAFT — PENDING sign-off | Correction addendum §2.3 (product v3.264.16): (1) corrected the §2 "identifiers in memory only / not persisted" claim — Patient Alerts (`patientAlerts.byPatient`, since v3.175.0) persists patient name/NHS number/DOB per flagged patient in `chrome.storage.local`, bounded by a 90-day idle identity strip and excluded from suite backups since v3.264.1; TTL-bounded working copies (print/passport 60 s, reception draft 4 h, Sweep run 2 h, duplicate-checker scan state 7 d) also enumerated. (2) Corrected the §2 "only outbound network call is api.github.com" claim with the full manifest/code host inventory (`api.nhs.uk`, `termbrowser.nhs.uk`, `*.supabase.co` ×2 paths, `www.youtube-nocookie.com`, optional StackChan LAN origin). (3) Corrected the two §2.1 "PLANNED (not yet shipped)" statements — phase B shipped v3.200.0 and phase D (reception booking, H-051) shipped v3.202.0, both on 2026-07-28, before the v1.3 signature; §6's revisit trigger discharged by this addendum. Signed v1.3 text retained unaltered with dated correction pointers. **No sign-off given. No signature invented.** |
| 1.0 | 2026-06-14 | DT | DRAFT — pending sign-off | Initial DPIA at product v3.84.2. |
| 1.2 | 2026-08-02 | Claude (drafted for DPO review) | DRAFT — pending sign-off | Rota / employee-data section (Article 9 staff health data; optional shared-drive replication). **No sign-off given.** |
| 1.3 | 2026-09-20 | DT | SIGNED 2026-09-20 | **First signature on this document** (versions 1.0–1.2 were never signed). Signed: Dr D. Triska (CSO / manufacturer DPO contact, GMC 6159481), in session, 2026-09-20, alongside H-077 and CSN §6 items 1/8/9 — see `docs/CSO-SIGNOFF-PACK-H063-H076.md` and `docs/cso-review-ledger.json` (product v3.264.1). Approval is for the stated processing, subject to the practice-side controls named in §6 (each deploying practice remains controller; the txn-proxy path additionally needs a practice-side processing record / DPA with Graysbrook before it is enabled). Closes INTENDED-PURPOSE open action (ii). |
| 1.3 | 2026-09-20 | Grok (drafted for DPO/CSO review) | DRAFT — pending sign-off | Added §2.2 Optional Transactional API proxy (controller/processor, UK transfer, SW-only `txn.callerKey`, read-only, default off). Corrected §1 / §2 / §5 claims of unqualified zero egress. New §5 row for the proxy path. **No sign-off given. No signature invented.** Closes the draft of INTENDED-PURPOSE open action (ii); still needs a human DPO/CSO signature. |
| 1.1 | 2026-07-28 | Claude (drafted for DPO review) | DRAFT — pending sign-off | Added §2.1 Reception module (special-category phone-capture text; transient `reception.captureDraft` persistence — 4 h TTL, never backed up, sensitive-pathway exclusion marked PLANNED; shared front-desk workstation processing; paste-into-Medicus flow with Medicus as system of record; planned reception booking marked as not shipped). Added the reception lawful-basis paragraph to §4 recording **no change of lawful basis**. Added five reception rows and one no-egress row to the §5 risk table. Corrected the §2 statement that the extension "writes nothing back to Medicus" (see CSN §6.1). Prepared as Phase 0 of `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`. **No sign-off given.** |
