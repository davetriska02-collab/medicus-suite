# Medicus Suite — SOUP (Software of Unknown Provenance) Register

**Document reference:** MS-CSO-SOUP-001
**Software product:** Medicus Suite (Chrome extension)
**Product version:** 3.62.0
**Document version:** 1.3
**Date issued:** 2026-06-13
**Author:** Dr Dave Triska, Graysbrook Ltd
**Clinical Safety Officer:** Dr Dave Triska (GMC 7534932), registered GP
**Status:** Live — reviewed at each minor or major release, and whenever a vendored library is upgraded
**Applicable standards:** Drafted in the style of IEC 62304 §8.1.2 (SOUP identification) and §7 (SOUP risk management), consistent with the voluntary DCB0129-style management described in `docs/HAZARD-LOG.md`.

---

## 1. Purpose

This register identifies every item of **Software of Unknown Provenance (SOUP)** — third-party software not developed for this product and whose development process is not under the author's control — that ships inside Medicus Suite. For each item it records its identity, the function it performs in the product, any known anomalies (including published CVEs) relevant to that function, and the residual-risk justification for continued use.

It complements, and does not replace:

- `vendor-versions.json` — the machine-readable provenance and **SHA-256 checksum of record** for each vendored file (the integrity source; update it whenever a library is upgraded).
- `docs/HAZARD-LOG.md` — the clinical-safety hazard log (see H-005 silent failure, H-006 regression).
- `SECURITY-AUDIT.md` — the adversarial code-review record, including the supply-chain hygiene findings (F6 / NF6).

> **Checksums live in `vendor-versions.json`, not here.** This register references that file as the integrity source so the two cannot drift; do not duplicate the hashes.

## 2. Scope and risk context

All vendored libraries are used **exclusively within the Patient Record Visualiser** (`visualiser-core.html` / `visualiser-core.js`, opened as a full browser tab) to analyse a PDF the clinician has exported and loaded **locally**. None of these libraries:

- run in the live Medicus content-script context or touch the Medicus DOM/API;
- make any network request (the only outbound contact in the whole product is the GitHub release check, which uses none of these libraries);
- write to any patient record or transmit any data outside the browser.

This containment is the primary risk control for the entire SOUP set: a defect or vulnerability in a vendored library can only be reached by a PDF the user has themselves chosen to open, in an isolated tab, with no clinical-write or network capability.

## 3. SOUP items

| #   | SOUP item                                                    | Version  | Source / manufacturer                                             | Licence    | Function in product                                                                                                                               | Known anomalies (relevant to its use)                                                                                           | Anomaly disposition                                                                                                                                                                                                                                                           | Upgrade status                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------ | -------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **PDF.js** (`pdfjs-dist`, `vendor/pdf.min.js`)               | 3.11.174 | Mozilla, via npm `pdfjs-dist` (jsDelivr CDN build)                | Apache-2.0 | Parses and renders the locally-loaded exported patient PDF so the visualiser can extract text/structure for trends, eFI, PINCER-style flags, etc. | **CVE-2024-4367** — arbitrary JavaScript execution via a crafted PDF `FontMatrix`; affects PDF.js < 4.2.67.                     | **Mitigated.** The visualiser opens every document with `isEvalSupported: false` (`visualiser-core.js:640`), which disables the affected code path. The PDF is user-supplied and processed in an isolated, network-less, write-less tab (see §2), bounding worst-case impact. | **Upgrade deferred (tracked as NF6 in `SECURITY-AUDIT.md` / CHANGELOG).** Moving to ≥ 4.2.67 requires downloading, checksum-verifying and re-vendoring both the library and its matching worker; scheduled as a maintenance task. |
| 2   | **PDF.js worker** (`pdfjs-dist`, `vendor/pdf.worker.min.js`) | 3.11.174 | Mozilla, via npm `pdfjs-dist` (jsDelivr CDN build)                | Apache-2.0 | Web-worker companion to item 1; performs the off-main-thread PDF parsing. **Version must match item 1 exactly.**                                  | As item 1 (same upstream codebase).                                                                                             | As item 1 (covered by the same `isEvalSupported: false` mitigation and containment).                                                                                                                                                                                          | As item 1 — upgraded in lockstep with the main library.                                                                                                                                                                           |
| 3   | **Chart.js** (`vendor/chart.min.js`)                         | 4.4.1    | Chart.js contributors, via npm `chart.js` (jsDelivr CDN build)    | MIT        | Renders the investigation-trend line charts in the visualiser from local numeric arrays.                                                          | No known anomaly affecting this use. Operates only on already-parsed numeric series; no PDF, network or untrusted-markup input. | No action required.                                                                                                                                                                                                                                                           | Current within the 4.4.x line; reviewed at each release.                                                                                                                                                                          |
| 4   | **D3.js** (`vendor/d3.min.js`)                               | 7.8.5    | Mike Bostock / D3 contributors, via npm `d3` (jsDelivr CDN build) | ISC        | Drives the swim-lane event timeline and supporting visualisations in the visualiser.                                                              | No known anomaly affecting this use. Consumes already-parsed local data structures; no network or eval-style input.             | No action required.                                                                                                                                                                                                                                                           | Current within the 7.8.x line; reviewed at each release.                                                                                                                                                                          |

## 4. Non-shipped development dependencies (devDependencies)

The following packages are listed in `package.json` as `devDependencies` and are used **exclusively** for local linting, formatting, and the pre-commit hook during development. They are not vendored, not bundled, and do not ship inside the extension zip. They are therefore not SOUP for the purposes of this register. They are noted here for completeness.

| Package      | Version | Purpose                                  |
| ------------ | ------- | ---------------------------------------- |
| `eslint`     | 9.24.0  | Static code linting                      |
| `@eslint/js` | 9.24.0  | ESLint JS rule set                       |
| `globals`    | 16.0.0  | Global identifier definitions for ESLint |
| `prettier`   | 3.5.3   | Code format checking                     |

These packages are never executed in the browser and have no access to patient data. No CVE disposition is required.

## 5. SOUP verification and maintenance procedure

When any item above is added, upgraded or removed:

1. Update `vendor-versions.json` (version, upstream URL, licence, and the recomputed SHA-256 over the file as shipped).
2. Update the corresponding row in §3 here — in particular re-check the **Known anomalies** column against the upstream changelog / CVE databases for the new version.
3. Re-run the full automated test suite (`node test-*.js`) and the visualiser smoke check.
4. Record the change in `CHANGELOG.md` and bump `manifest.json` per the versioning policy.
5. If the change alters a clinical-safety control (e.g. the PDF.js anomaly mitigation), reflect it in `docs/HAZARD-LOG.md`.

## 6. Document history

| Date       | Version | Author | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-07 | 1.0     | DT     | Initial SOUP register, synchronised to Medicus Suite v3.33.0 and `vendor-versions.json` (generated 2026-06-04). Captures PDF.js 3.11.174 (+ worker), Chart.js 4.4.1, D3.js 7.8.5, including the CVE-2024-4367 mitigation and the deferred PDF.js upgrade (NF6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-06-11 | 1.1     | DT     | Synchronised to Medicus Suite v3.56.0. **SOUP items (§3) verified** against `vendor-versions.json`: PDF.js 3.11.174 (+ worker), Chart.js 4.4.1, D3.js 7.8.5 — all versions unchanged; CVE-2024-4367 mitigation and NF6 deferred-upgrade status unchanged. **Added §4 (non-shipped devDependencies):** ESLint 9.24.0, @eslint/js 9.24.0, globals 16.0.0, Prettier 3.5.3 — dev-only, not shipped, no patient-data access.                                                                                                                                                                                                                                                                                                                  |
| 2026-06-12 | 1.2     | DT     | Synchronised to Medicus Suite v3.60.0. **No SOUP changes.** The v3.57.0–v3.60.0 releases (UX/onboarding: guided tour, command palette, setup checklist, Today tab, view-state continuity, drafts/resumable sweep, notifications/clinic mode) introduced no new vendored libraries and no new shipped dependencies; all new code is first-party. SOUP items (§3) re-verified against `vendor-versions.json`: PDF.js 3.11.174 (+ worker), Chart.js 4.4.1, D3.js 7.8.5 — unchanged; CVE-2024-4367 mitigation and NF6 deferred-upgrade status unchanged. devDependencies (§4) unchanged (Playwright is used transiently for headless design verification, installed with `--no-save`, and is neither a devDependency of record nor shipped). |
| 2026-06-13 | 1.3     | DT     | Reissued at Medicus Suite v3.62.0. No SOUP change — the Investigation Results queue triage feature adds no third-party libraries; it reuses the existing API client, normalisers, and rules infrastructure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
