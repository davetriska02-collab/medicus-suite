# Chrome Web Store — submission pack

Everything the Developer Dashboard asks for, ready to paste. Kept in the repo
so it stays versioned alongside the manifest it describes.

**Manifest version at time of writing:** 3.223.0

---

## Store listing

**Name:** Medicus Suite

**Summary (from manifest, 132-char limit):**

> Clinical intelligence for Medicus: safety monitoring, triage red-flags, QOF tracking, dashboards, confirmed record tidy-up tools.

**Category:** Productivity → Tools (or Workflow & Planning)

**Language:** English (UK)

**Detailed description (paste into the listing):**

> Medicus Suite is a companion for clinical and administrative staff in UK GP
> practices that use the Medicus electronic patient record. It works only on
> medicus.health pages, using your existing Medicus sign-in.
>
> What it does:
> • Drug-monitoring and QOF context alongside the open patient record
> • Triage red-flag highlighting and result-severity chips on the task queue
> • Operational dashboards: waiting room, appointment slots, submissions,
> activity, referrals and capacity — in the browser side panel or a
> floating pop-out window
> • Record tidy-up tools (problem descriptions, inactive problems, allergy
> clean-up) — every change requires an explicit per-action confirmation by
> the clinician and is made through your own Medicus session
>
> What it does not do:
> • It never changes the record without a clinician confirming that specific
> action
> • It sends no data to the developer: no analytics, no telemetry, no
> tracking. Patient data is processed locally in your browser (see the
> privacy policy for the two optional practice-enabled integrations)
> • It provides no clinical decision support: alerts are a passive display
> and memory aid; all clinical decisions remain the clinician's
> responsibility
>
> Medicus Suite is independent software from Graysbrook Ltd and is not made
> by, or affiliated with, Medicus Health. It requires an authorised Medicus
> user account and does nothing on any other website.

**Privacy policy URL:**
`https://github.com/davetriska02-collab/medicus-suite/blob/main/PRIVACY.md`
(If a graysbrook.co.uk page is preferred, mirror PRIVACY.md there and use that
URL instead — the store only needs a stable, public URL.)

---

## Privacy practices tab

**Single purpose description:**

> Assists signed-in users of the Medicus GP electronic patient record with
> clinical-safety and operational awareness: drug-monitoring status, triage
> red-flags and practice workload dashboards derived from the user's own
> authenticated Medicus session, plus clinician-confirmed record tidy-up
> actions performed through that same session.

**Data usage — "What user data do you plan to collect?":**

In the default configuration the extension transmits nothing about the user
or patients to anyone (NHS terminology lookups carry only the clinical term
being looked up). Two practice-opt-in integrations do transmit data, so
disclose honestly:

- Tick **Personally identifiable information** and **User activity** — the
  optional task-presence feature, when a practice configures a hosted store,
  transmits the staff member's name/identifier and which task they have open
  (never patient data).
- Tick **Health information** — the optional Transactional API integration,
  when a practice completes onboarding and enables it, routes patient
  care-record data through the developer-operated backend proxy to serve the
  request.
- Certify Limited Use compliance: data is used only to provide the single
  purpose, never sold, never used for ads or creditworthiness.

**Are you using remote code?** No. All JavaScript ships in the package;
third-party libraries are vendored locally (`vendor/`), CSP is
`script-src 'self'`.

### Permission justifications (one per dashboard field)

| Permission      | Justification text                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`       | Stores the user's own configuration (alert rules, thresholds, preferences) and a minimised local working cache in chrome.storage.local.                                                                             |
| `sidePanel`     | The extension's main user interface — dashboards and tools — is rendered in the browser side panel.                                                                                                                 |
| `tabs`          | Used to find, open and focus the user's Medicus (medicus.health) tabs from the side panel, and to open the extension's own pages. The extension does not read browsing history or page content of non-Medicus tabs. |
| `windows`       | Opens and manages the extension's own floating pop-out window (an alternative to the side panel) and focuses existing Medicus windows.                                                                              |
| `scripting`     | Injects the extension's bundled content scripts into medicus.health pages on user action (e.g. re-running the in-page overlay after a settings change). Only ever targets medicus.health tabs.                      |
| `alarms`        | Schedules periodic background refresh of dashboard counts (e.g. waiting-room and new-request polling) via the service worker.                                                                                       |
| `notifications` | Optional, user-configurable local desktop alerts — e.g. a new urgent triage request. Generated and displayed entirely on the user's machine.                                                                        |
| `idle`          | Pauses background polling and alerts when the workstation is idle or locked, so refresh work only happens while the user is actively working.                                                                       |

### Host permission justifications

| Host                                                               | Justification text                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://*.medicus.health/*`                                       | The single site the extension exists for: it reads the signed-in user's Medicus electronic patient record session, overlays clinical-safety information, and performs clinician-confirmed record tidy-up actions through that same session.                |
| `https://*.api.england.medicus.health/*`                           | The Medicus application's own API, called with the user's existing session credentials to read the same data the user can already see.                                                                                                                     |
| `https://api.github.com/repos/davetriska02-collab/medicus-suite/*` | Once-daily version check against the project's public releases feed for manually installed (unpacked) copies. Carries no user or patient data. Store-installed copies never make this request (gated off at runtime).                                      |
| `https://termbrowser.nhs.uk/*`                                     | Public NHS SNOMED CT terminology browser API, queried (from the service worker) to verify clinical concept status for the record tidy-up tools. Requests contain only SNOMED concept identifiers — never patient data.                                     |
| `https://api.nhs.uk/*`                                             | Public NHS content API, queried for patient-information material about a condition or medicine the user selects. Requests contain only the selected term — never patient data.                                                                             |
| `https://*.supabase.co/*`                                          | Two optional, practice-enabled integrations, both off by default: a practice-configured task-presence store (staff identity and open-task identifier only — no patient data) and the backend proxy for the official Medicus Transactional API (read-only). |

---

## Assets

- **Icon:** `icons/icon-128.png` (already in repo).
- **Screenshots:** at least one, 1280×800 or 640×400 PNG.
  **Hard rule: screenshots must contain only synthetic/demo patient data.**
  Never screenshot a live Medicus session — a real screenshot would publish
  patient-identifiable data on the store listing. Use the visualiser/demo
  fixtures or a test patient environment.
- **Small promo tile (optional):** 440×280.

---

## Recommended dashboard settings

- **Visibility: Unlisted.** The extension is only useful to practices running
  Medicus; unlisted keeps the trusted-install and auto-update benefits without
  public discoverability. Share the direct store URL with practices.
- **Distribution:** all regions is fine (UK-only also acceptable).

---

## Upload package

Use the release zip built by `.github/workflows/release.yml` (it excludes
tests, internal docs, tooling and brand sources). The store requires
`manifest.json` at the zip root, so re-zip the inner folder's contents:

```
cd medicus-suite-vX.Y.Z && zip -r ../store-upload.zip .
```

---

## Migration note for existing sideloaded installs

A store install gets a **different extension ID** from the unpacked install,
so local settings do not carry over. Rollout instructions for the practice:

1. In the old (unpacked) install: Options → Backup → **export a full suite
   backup**.
2. Install from the store, then Options → Backup → **import** the file.
3. Remove the unpacked extension.

Note: the task-presence shared-folder grant and any `txn.callerKey` are
per-install and deliberately excluded from backups — re-grant / re-enter them
after switching.

---

## Review-friction notes (know before submitting)

- The extension handles health data on-screen; PRIVACY.md describes the data
  flows accurately, including the two opt-in integrations. **The DPIA
  (`docs/DPIA.md`) predates the task-presence and Transactional API features
  and still claims zero egress — refresh it before submission** in case a
  reviewer or deploying practice asks for it.
- The vendored minified libraries (`vendor/pdf.min.js`, `vendor/d3.min.js`)
  contain `eval`-adjacent code paths that automated review occasionally
  flags; they are widely shipped libraries, CSP (`script-src 'self'`) blocks
  eval at runtime, and vendor integrity is CI-checked
  (`scripts/verify-vendor.js`). No action needed unless review asks.
- Reviewers cannot sign in to Medicus. Provide reviewer notes explaining the
  extension only activates on medicus.health with an authorised clinical
  account, and link a short demo video of the extension running against
  synthetic data if requested.
