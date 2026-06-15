# Medicus Suite — DTAC Readiness Tracker

**Document reference:** MS-DOC-DTAC-001
**Product version:** 3.84.2
**Date:** 2026-06-14 · **Manufacturer:** Graysbrook Ltd
**Status:** DRAFT working tracker — maintained alongside the DTAC self-assessment

This tracker records the state of each NHS **Digital Technology Assessment
Criteria (DTAC)** domain for Medicus Suite and what remains to make it
submission-ready. Status reflects artefacts in this repository; reconcile exact
question numbers against the DTAC v2.0 form when completing it.

**Legend:** ✅ ready · ✍️ drafted (DRAFT, needs sign-off/placeholders) · 👤 needs
information only you hold · 🏛️ external/organisational action · 🔴 not started.

## Domain status

| Domain | Status | Primary evidence | Remaining work |
|---|---|---|---|
| **Company / product info** | ✅ / 👤 | `INTENDED-PURPOSE.md`, `VISION.md`, `README.md`, LICENSE | ICO registration no.; Companies House no. |
| **A · Clinical safety (DCB0129)** | ✍️ | `HAZARD-LOG.md`, `CLINICAL-SAFETY-NOTICE.md`, `CLINICAL-SAFETY-CASE-REPORT.md`, `CSO-DECLARATION.md` | CSO signature + date; sync safety docs to current version (see note) |
| **B · Data protection** | ✍️ / 🏛️ | `DPIA.md`, zero-egress architecture, `SECURITY-AUDIT.md` | Fill ICO no./DPO contact; **DSPT** publication (organisational) |
| **C · Technical security** | ✅ / 🏛️ | `SECURITY-AUDIT.md`, `PEN-TEST-2026-06-14.md`, `SOUP.md`, `vendor-versions.json`, `SECURITY.md` | **Cyber Essentials**; **independent** penetration test |
| **D · Interoperability** | ✍️ | `INTEROPERABILITY-STATEMENT.md` | Sign off (reasoned N/A) |
| **E · Usability & accessibility** | ✍️ / 🔴 | `ACCESSIBILITY-STATEMENT.md`, `docs/appraisal/PRACTICE-*` | **Formal WCAG 2.1 AA audit** (axe/Lighthouse + assistive-tech) before claiming conformance |

## Cross-cutting

- **Deployment model** — unpacked/sideloaded Chrome extension is non-standard for
  NHS IT assurance. Mitigations to present: daily GitHub version-check + signed
  release workflow, named-user distribution control, `SECURITY.md` support route.
  Strategic answer: the SEAL / supported-distribution direction.

## What only you can supply (👤)

- ICO registration number (Graysbrook Ltd) and Companies House number.
- DPO contact email; CSO signature and sign-off dates.
- Any consultation records (practice IG lead / Caldicott Guardian).

## External / organisational actions (🏛️)

- **DSPT** (Data Security & Protection Toolkit) — annual organisational submission.
- **Cyber Essentials** (or Plus) — certification.
- **Independent penetration test** — current pen-test evidence is self/AI-conducted.

## Note — safety-document currency

The clinical-safety documents (`HAZARD-LOG.md`, `CLINICAL-SAFETY-NOTICE.md`,
`SOUP.md`) are pinned at **product version 3.64.0**, but the manifest is now
**3.84.2** — roughly twenty releases on, several of which shipped **clinical**
content (new Investigation-Results threshold/text rules, bowel-screening
non-responder rule, base-rules-red-only, culture-rule hardening, Keeper currency
updates). The safety case should be re-synchronised to the current version. This
is a **CSO task** (it asserts a clinical review) and must not be a silent version
bump — flagged here so it is not lost.
