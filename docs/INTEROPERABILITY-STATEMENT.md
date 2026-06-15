# Medicus Suite — Interoperability Statement

**Document reference:** MS-DOC-INTEROP-001
**Product version:** 3.84.2 · **Date:** 2026-06-14 · **Manufacturer:** Graysbrook Ltd
**Status:** DRAFT — pending sign-off

## Summary

Medicus Suite **does not exchange data with any external system** and therefore
does not implement interoperability/messaging standards (e.g. HL7 FHIR, GP
Connect, IM1 transactions). This is a deliberate design choice, not a gap: the
product is a read-only, client-side augmentation layer over a single host EPR.

| DTAC interoperability area | Position |
|---|---|
| External data exchange / messaging (FHIR, GP Connect, IM1) | **N/A** — the product sends and receives no data to/from external systems. It reads the user's own authenticated Medicus session and writes nothing back. |
| Data source | The Medicus EPR DOM and `*.api.england.medicus.health` API, under the user's own session. No second system is integrated. |
| Clinical terminology (SNOMED CT) | The engine uses **case-insensitive substring matching** against problem/medication/observation text, not SNOMED CT refsets — a documented, test-guarded approximation (`VISION.md`, `CLAUDE.md`). It does not consume or emit coded terminology payloads. |
| Open standards | Local config/backup uses a documented JSON envelope (`shared/io/`); a per-evaluation audit trace is exportable as JSON. No external API surface is exposed. |
| Data portability | Practice configuration and the evaluation audit trail are user-exportable/importable as JSON. |

## Statement

Because Medicus Suite neither transmits patient data externally nor integrates a
second clinical system, the interoperability criteria are **not applicable**. The
absence of integration is itself the primary safety and data-protection control
(see the Clinical Safety Case Report and DPIA). Should a future supported,
vendor-hosted distribution introduce data exchange, this statement and the DPIA
will be revised and the relevant standards assessed at that point.
