# Medicus Suite — Clinical Safety Case Report

**Document reference:** MS-CSO-CSCR-001
**Software product:** Medicus Suite (Chrome extension)
**Product version:** 3.84.2
**Document version:** 1.0 (DRAFT — pending CSO sign-off)
**Date issued:** 2026-06-14
**Manufacturer:** Graysbrook Ltd
**Author / Clinical Safety Officer:** Dr Dave Triska (GMC 6159481), registered GP
**Applicable standard:** Structured as a DCB0129 Clinical Safety Case Report.
Medicus Suite is not formally within the regulatory scope of DCB0129/0160 (it is
not a deployed Health IT system in the NHS-contracted sense and is not a medical
device — see §4), but the manufacturer voluntarily manages it against that
standard. Conformance is therefore claimed as *alignment*, not certification.

---

## 1. Purpose and scope

This Clinical Safety Case Report (CSCR) presents the argument and supporting
evidence that Medicus Suite is acceptably safe for its intended use and intended
users. It summarises and references — it does not replace — the controlled
documents that hold the detail:

- `docs/HAZARD-LOG.md` (MS-CSO-HL-001) — full hazard register and residual risk
- `docs/CLINICAL-SAFETY-NOTICE.md` (MS-CSO-CSN-001) — user-facing safety notice
- `docs/INTENDED-PURPOSE.md` — frozen intended-purpose statement
- `docs/SOUP.md` (MS-CSO-SOUP-001) — Software of Unknown Provenance register
- `SECURITY-AUDIT.md` / `docs/PEN-TEST-2026-06-14.md` — security assurance
- `docs/sentinel-DISCLAIMER.txt` — binding terms of use

## 2. Clinical risk management system

A single named Clinical Safety Officer, Dr Dave Triska (GMC 6159481), a
registered GP and the product's manufacturer, is accountable for clinical risk
management. The CSO:

- maintains the hazard log and reviews it at every minor/major release, on any
  reported safety incident or near-miss, on any annual QOF refresh, and on any
  change to Medicus APIs or to relevant UK clinical/regulatory guidance
  (`HAZARD-LOG.md §7`);
- approves each release against the hazard log (recorded sign-off, e.g. PR #78
  for v3.56.0);
- operates a private safety/security reporting channel (`SECURITY.md`,
  dave@graysbrook.co.uk) with point-release remediation.

The risk management process, scoring matrix, and acceptability thresholds are
defined in `HAZARD-LOG.md §3–4`.

## 3. Product overview and intended use

Medicus Suite is a read-only Chrome (Manifest V3) extension that operates
alongside the Medicus EPR. It reads data already present in the clinician's
authenticated Medicus session, applies arithmetic threshold checks and
reorganisation, and re-displays the result in a side panel and on-page overlays.
It writes nothing to the record, transmits no patient data outside the browser,
and performs no runtime AI inference. The frozen intended-purpose statement,
intended users, intended environment, contraindications, and "what this is not"
list are in `INTENDED-PURPOSE.md`.

**Regulatory position (§4 summary):** the manufacturer asserts, on a good-faith
reading of MHRA Software-as-a-Medical-Device guidance, that the product falls
outside the UK Medical Devices Regulations 2002 (as amended): it produces no
diagnosis, recommendation, prognosis, or triage decision, and re-displays values
already visible to the clinician rather than transforming them into new clinical
information (full reasoning in `CLINICAL-SAFETY-NOTICE.md §4`).

## 4. Clinical risk analysis

Hazards were identified by functional decomposition, HAZOP-style "what-if"
prompts, human-factors review (automation bias, alert fatigue, out-of-context
display, point-in-time data reuse), code/security review, and incident learning
(`HAZARD-LOG.md §3`). Risk is scored Severity (1–5) × Likelihood (1–5); a
residual score of 12+ blocks release; 10–11 requires explicit written CSO
acceptance.

**Result:** 30 hazards (H-001…H-030) are recorded and managed.
**No hazard has a residual risk score exceeding 9.** No hazard at residual 10+ is
open. The principal hazards and their controls:

| Hazard | Control summary | Residual |
|---|---|---|
| H-001 Stale / wrong-patient data | UUID-keyed cache, SPA-navigation snapshot invalidation, loading state before chips, mandatory source verification | 8 (ALARP) |
| H-002 False-negative (missing alert) | Memory-aid positioning, fail-open on unknown demographics, journal-coded obs evaluated, 440+ tests, annual QOF review | 6 (ALARP) |
| H-005 Silent failure | Extraction-health drift detector + amber banner, per-module extraction breakdown, "Couldn't read this record" banner | (ALARP) |
| H-016 PINCER false-negative | Documented partial subset, supplementary to Medicus, visualiser/HUD parity work, test-guarded | (ALARP) |
| H-026 Triage red-flag false-negative reliance | "Absence of chip ≠ absence of risk" disclosure, expansion test-guarded | 8 (ALARP) |
| H-030 Results-queue chip misread as assurance | No "safe to file" chip, escalate-only, fail-silent on error, additive attention only | 4 |

The complete register, with causes, controls, and per-hazard acceptability, is in
`HAZARD-LOG.md §5–6`.

## 5. Safety requirements realised in the product

- **Read-only / local-only by construction** — cannot alter a record or transmit
  patient data (the only outbound call is a patient-data-free GitHub version
  check). Architecture, not policy, is the control (`VISION.md`, `SECURITY-AUDIT.md §5`).
- **Fail-safe display semantics** — no data renders as "no data," never as a
  false "clear"; demographic filters fail open so safety alerts are not silently
  suppressed; result-queue rules are escalate-only.
- **Verification duty** — every displayed value must be checked against the source
  record before any clinical action (disclaimer + CSN).
- **Per-patient evaluation audit trail** — exportable "Why?" trace records the
  matched term, interval arithmetic, due date, and rule citation per chip,
  supporting DCB0129/0160-style assurance.

## 6. SOUP

Four vendored libraries (PDF.js + worker, Chart.js, D3.js), all confined to the
offline Patient Record Visualiser, none touching the live Medicus DOM/API or
making network calls. CVE-2024-4367 (PDF.js < 4.2.67) is mitigated by
`isEvalSupported:false` and containment; upgrade tracked (NF6). Checksums pinned
in `vendor-versions.json` and CI-verified. Full register: `docs/SOUP.md`.

## 7. Verification evidence

- 440+ automated checks across 60+ `test-*.js` files (threshold, date, rule-firing,
  import-hardening, clinical-threshold-sync), run in CI.
- Three adversarial red-team passes + an executable pen-test (17 scenarios, 17
  BLOCKED, 0 EXPLOITED) — `SECURITY-AUDIT.md`, `docs/PEN-TEST-2026-06-14.md`.
- Vendor-checksum and defaults-config-lock CI gates.

## 8. Residual risk and conclusion

All identified hazards are reduced to a residual risk that is broadly acceptable
or acceptable-with-controls (ALARP); none exceeds 9. The safety case rests on a
read-only, local-only architecture that bounds worst-case impact, fail-safe
display semantics, an explicit clinician verification duty, and a maintained
hazard log under active CSO review. On this basis the product is considered
acceptably safe for limited distribution to named clinical users who have
accepted the Clinical Safety Notice and disclaimer.

## 9. Clinical Safety Officer declaration

I confirm that the clinical risks of Medicus Suite v3.84.2 have been analysed and
managed in line with the process in `HAZARD-LOG.md`, that the controls described
are in place, and that the residual risks are acceptable for the stated intended
use and users.

**Dr Dave Triska, GMC 6159481**
**Clinical Safety Officer — Medicus Suite, Graysbrook Ltd**
**Date:** [DATE OF SIGN-OFF]
