# Medicus Suite — Clinical Safety Officer Declaration

**Document reference:** MS-CSO-DECL-001
**Product version:** 3.84.2 · **Date:** [DATE]
**Status:** DRAFT — pending CSO signature

I, Dr Dave Triska (GMC 6159481), registered General Practitioner and Clinical
Safety Officer for Medicus Suite (Graysbrook Ltd), declare that:

1. A clinical risk management process aligned with DCB0129 has been applied to
   Medicus Suite, and is documented in `docs/HAZARD-LOG.md` and the Clinical
   Safety Case Report (MS-CSO-CSCR-001).
2. All identified hazards (H-001…H-030) have been assessed and reduced to a
   residual risk that is acceptable (no residual score exceeds 9); the controls
   described are in place at v3.84.2.
3. The product's intended purpose, limitations, contraindications, and regulatory
   position are stated in `docs/INTENDED-PURPOSE.md` and
   `docs/CLINICAL-SAFETY-NOTICE.md`.
4. I am suitably qualified (a practising registered clinician) and competent to
   act as CSO for a product of this scope, and I remain accountable for its
   clinical safety and for reviewing this declaration at each release.
5. This declaration is made for a product distributed to named clinical users who
   have read and accepted the Clinical Safety Notice and disclaimer.

**Signed:** Dr Dave Triska — Clinical Safety Officer, Graysbrook Ltd
**GMC:** 6159481 · **Date:** [DATE]

---

# Deploying-Organisation Clinical Safety Note (DCB0160-style hand-off)

**Document reference:** MS-CSO-DCB0160-001

Medicus Suite is a manufacturer-managed product; the **deploying GP practice**
retains DCB0160-style responsibilities for safe local use. To deploy safely, the
practice should:

1. **Nominate a local clinical safety contact** (and, where the practice
   authors custom rules, a named rules owner) accountable for local use.
2. **Read and accept** the Clinical Safety Notice, hazard log, intended-purpose
   statement, and disclaimer before installation, and ensure all users do so.
3. **Confirm the intended-use boundary:** the tool is a memory aid/display; every
   displayed value must be verified against the live Medicus record before any
   clinical action. It is not the system of record.
4. **Own the clinical validity of any practice-authored rules** (H-004): review
   custom rules at authoring time (using the built-in live preview) and whenever
   relevant guidance changes.
5. **Govern enablement of staged-disabled features** — e.g. Reception guided
   capture and user-authored result-triage rules ship disabled and require
   explicit practice review/sign-off before use (H-024, H-030).
6. **Restrict use to authorised staff** operating under their own Medicus
   credentials, within their professional scope.
7. **Manage incidents locally:** any suspected hazardous behaviour or patient
   safety incident is handled under the practice's own significant-event/SEA
   process and reported in parallel to the CSO (dave@graysbrook.co.uk; no
   patient-identifiable data by email).
8. **Keep current:** install updates promptly (the extension surfaces an update
   banner); only the latest version is supported.
