# Chrome Web Store — submission pack

Everything the Developer Dashboard asks for, ready to paste. Kept in the repo
so it stays versioned alongside the manifest it describes.

**Manifest version at time of writing:** 3.126.0

---

## Store listing

**Name:** Medicus Suite

**Summary (from manifest, 132-char limit):**

> The clinical intelligence layer for Medicus: read-only safety monitoring, triage red-flags, QOF tracking and operational dashboards.

**Category:** Productivity → Tools (or Workflow & Planning)

**Language:** English (UK)

**Detailed description (paste into the listing):**

> Medicus Suite is a read-only companion for clinical and administrative staff
> in UK GP practices that use the Medicus electronic patient record. It works
> only on medicus.health pages, using your existing Medicus sign-in.
>
> What it does:
> • Drug-monitoring and QOF 2025/26 context alongside the open patient record
> • Triage red-flag highlighting and result-severity chips on the task queue
> • Operational dashboards: waiting room, appointment slots, submissions,
> activity, referrals and capacity — in the browser side panel or a
> floating pop-out window
>
> What it does not do:
> • It never writes to the patient record
> • It never transmits patient data anywhere — all processing is local to
> your browser
> • It provides no clinical decision support: it is a passive display and
> memory aid; all clinical decisions remain the clinician's responsibility
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

> Displays, to signed-in Medicus (GP electronic patient record) users,
> read-only clinical-safety and operational information derived from their own
> authenticated Medicus session — drug-monitoring status, triage red-flags and
> practice workload dashboards — processed entirely locally in the browser.

**Data usage — "What user data do you plan to collect?":** tick **nothing**.
The extension collects no data: patient data it displays is processed locally
and never transmitted to the developer or any third party. Certify compliance
with the developer program policies / Limited Use.

**Are you using remote code?** No. All JavaScript ships in the package;
third-party libraries are vendored locally (`vendor/`), CSP is
`script-src 'self'`.

### Permission justifications (one per dashboard field)

| Permission      | Justification text                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`       | Stores the user's own configuration (alert rules, thresholds, preferences) and a minimised local working cache in chrome.storage.local. Nothing is transmitted off the device.                                      |
| `sidePanel`     | The extension's main user interface — dashboards and tools — is rendered in the browser side panel.                                                                                                                 |
| `tabs`          | Used to find, open and focus the user's Medicus (medicus.health) tabs from the side panel, and to open the extension's own pages. The extension does not read browsing history or page content of non-Medicus tabs. |
| `windows`       | Opens and manages the extension's own floating pop-out window (an alternative to the side panel) and focuses existing Medicus windows.                                                                              |
| `scripting`     | Injects the extension's bundled content scripts into medicus.health pages on user action (e.g. re-running the in-page overlay after a settings change). Only ever targets medicus.health tabs.                      |
| `alarms`        | Schedules periodic background refresh of dashboard counts (e.g. waiting-room and new-request polling) via the service worker.                                                                                       |
| `notifications` | Optional, user-configurable local desktop alerts — e.g. a new urgent triage request. Generated and displayed entirely on the user's machine.                                                                        |
| `idle`          | Pauses background polling and alerts when the workstation is idle or locked, so refresh work only happens while the user is actively working.                                                                       |

### Host permission justifications

| Host                                                               | Justification text                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://*.medicus.health/*`                                       | The single site the extension exists for: it reads the signed-in user's Medicus electronic patient record session and overlays read-only clinical-safety information on those pages.                                  |
| `https://*.api.england.medicus.health/*`                           | The Medicus application's own API, called with the user's existing session credentials to read the same data the user can already see (read-only).                                                                    |
| `https://api.github.com/repos/davetriska02-collab/medicus-suite/*` | Once-daily version check against the project's public releases feed for manually installed (unpacked) copies. Carries no user or patient data. Store-installed copies never make this request (gated off at runtime). |

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
tests, internal docs, tooling and brand sources). Upload the zip's _inner
folder contents_ re-zipped, or the zip as-is if the dashboard accepts the
nested folder — the store requires `manifest.json` at the zip root, so:

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

---

## Review-friction notes (know before submitting)

- The extension handles health data on-screen; the privacy policy states —
  accurately — that nothing is collected or transmitted. If a reviewer asks,
  the DPIA (`docs/DPIA.md`) and `SECURITY.md` back this up.
- The vendored minified libraries (`vendor/pdf.min.js`, `vendor/d3.min.js`)
  contain `eval`-adjacent code paths that automated review occasionally
  flags; they are widely shipped libraries, CSP (`script-src 'self'`) blocks
  eval at runtime, and vendor integrity is CI-checked
  (`scripts/verify-vendor.js`). No action needed unless review asks.
- Reviewers cannot sign in to Medicus. Provide reviewer notes explaining the
  extension only activates on medicus.health with an authorised clinical
  account, and link a short demo video of the extension running against
  synthetic data if requested.
