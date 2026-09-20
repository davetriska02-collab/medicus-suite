# SIGNED — CSO sign-off — H-063–H-076 + txn-proxy open actions

> ## ✔ SIGNED 2026-09-20
>
> **Signed:** Dr D. Triska (Clinical Safety Officer), GMC 6159481, in session, 2026-09-20 ("Reviews and signed").
> **Product at signature:** v3.264.1.
> **Scope signed:** every Proposed row in the inventory below — **H-063–H-076 all Accepted (ALARP)** at their proposed residual scores — plus the txn-proxy trio: **H-077 Accepted (ALARP)**, **CSN §6 items 1/8/9 as rewritten at doc v3.82** (recorded as CSN doc v3.83), and **DPIA v1.3** (the DPIA's first signature).
> **Not signed** (exactly as this pack scoped it): H-060, H-061, the H-002 (w) / H-003 (k) U&E-restore addendum, and the long tail of 2026-08/09 PENDING CSN/hazard addenda — those remain PENDING.
> **Recorded in:** `docs/HAZARD-LOG.md` v3.68, `docs/CLINICAL-SAFETY-NOTICE.md` v3.83, `docs/DPIA.md` v1.3 (signed), and `docs/cso-review-ledger.json` (`last_cso_review_version` → 3.264.1 for CSN / HAZARD-LOG / DPIA).
> **Txn-proxy consequence:** with the trio signed, the remaining gate on `txn.integrationMode` `hybrid`/`transactional` is the practice-side processing record / DPA with Graysbrook (DPIA §2.2 "Lawful basis") — enabling stays a deliberate practice configuration act.

**Product at this pack:** v3.264.1 (docs increment; **not** a re-baseline).  
**Last signed CSO review at drafting:** v3.261.21 (2026-09-10, Dr D. Triska, GMC 6159481).  
This pack was drafted without inventing a signature or a sign-off date; the signature above was recorded on Dave's own session instruction of 2026-09-20.

The sections below are the review agenda as it was put to the CSO, retained verbatim for the record. Controls described here are already in shipped code unless marked draft-this-increment.

---

## How this was signed (completed 2026-09-20)

The steps this pack prescribed were carried out on Dave's instruction, all on 2026-09-20:

1. ~~Read each Proposed row against the live control text in `docs/HAZARD-LOG.md`.~~ Done in session.
2. ~~Change **Acceptability** to Accepted (ALARP) and the §6 Status cell to match; record the date and GMC number.~~ Done — hazard-log v3.68, every row H-063–H-076 (and H-077) now reads "Accepted (ALARP) — CSO signed off 2026-09-20 (Dr D. Triska, GMC 6159481, in session)".
3. ~~For the txn-proxy trio (CSN §6 items 1/8/9 as rewritten, DPIA §2.2, H-077): same — human signature only.~~ Done — CSN doc v3.83, DPIA v1.3 signed, H-077 Accepted.
4. ~~Only then move `last_cso_review_version` in `docs/cso-review-ledger.json`.~~ Done — moved to 3.264.1 / 2026-09-20 for CSN, HAZARD-LOG and DPIA. Pending notes did not move it; the signature did.

With (3) signed, a practice may set `txn.integrationMode` to `hybrid` or `transactional` only after putting its own processing record / DPA with Graysbrook in place (DPIA §2.2).

---

## Inventory — hazards H-063–H-076 (all Accepted (ALARP) 2026-09-20; table retained as put to the CSO)

Controls are already written as shipped. Residual scores are from the register. At drafting, none of these were Accepted; all fifteen (including H-077 below) were Accepted at the 2026-09-20 signature.

| ID | Title | Residual | Shipped controls (short) | Ask of CSO |
| --- | --- | --- | --- | --- |
| H-063 | "Possibly already saved" hint missed or wrongly asserted | 4 | Display-date parse, ±2-day window, one entry per attachment, evidence wording, never disables the chip | Accept or amend |
| H-064 | Wrong investigation-report task reassigned from lab canvas | 4 | Unique staff UUID or refuse; re-GET abort; captured keys only; `canWriteAllocations` gated on GET token | Accept or amend |
| H-065 | Wrong/excess safeguarding note cleared from banner | 5 | Identity pin + recheck; named list; no silent batch | Accept or amend |
| H-066 | Wrong inbound-document / workflow task reassigned | 4 | Same allocation-canvas write doctrine as H-064 | Accept or amend |
| H-067 | Patient-identifiable data on a public Note board | 4 | Public profiles never paint names (H-067); staff-only tiles; fail-loud dead feed | Accept or amend |
| H-068 | Wrong Rx request reassigned from allocation canvas | 4 | Stage-only even-split; write does not issue/sign/file; usual-GP send is user-initiated | Accept or amend |
| H-069 | Companion outstanding-investigations / open-tasks over-read | 3 | "No result back yet" is not confirmation; incomplete/snoozed only | Accept or amend |
| H-070 | Capacity look-ahead false "no days at risk" | 2 | Coverage-honest: unreachable Medicus / past calendar / unbuilt rota reported as unchecked | Accept or amend |
| H-071 | Wrong patient-request reassigned or stale allocation group | 4 | Groups for even-split; request canvas stages only; Write blocked until dummy capture | Accept or amend |
| H-072 | Wrong name applied by contacts-canvas name-quality fix | 4 | Re-fetch + re-validate immediately before POST; initials-only shorter-former-name delete | Accept or amend |
| H-073 | Lab-filing comment allow-list / profile sync unwanted auto-file | 4 | Synced profiles arrive force-disabled via `lockForReview` | Accept or amend |
| H-074 | Lab filing offered for an undeclared analyte | 4 | `unrecognisedAnalyteBlockers`; live-confirmed | Accept or amend |
| H-075 | Filing macro radio-select click silently failed | 4 | `realClick` clicks the associated control once; live-confirmed | Accept or amend |
| H-076 | Repeat-prescribing authorisation pill wrong judgement | 6 | Fail-closed on ambiguity; advisory only; no write | Accept or amend |

**Also still Proposed (outside this number range, listed so they are not forgotten):** H-060 (allergy cleanup), H-061 (queue pulse). H-062 is already Accepted (2026-08-23).

**Also still pending as incremental CSN/hazard addenda** (no new ID): provenance-gated U&E restore (H-002 (w) / H-003 (k), CSN v3.81), plus the long tail of 2026-08/09 PENDING notes on CSN/HAZARD-LOG. This pack does not collapse that tail into a fake review.

---

## Txn-proxy open actions (v3.202.0 / v3.261.21)

These three were left open at the 2026-07-28 INTENDED-PURPOSE signature and again at the 2026-09-10 re-freeze.

| # | Open action | What this increment did | Still needs |
| --- | --- | --- | --- |
| (i) | CSN §6 items 1 / 8 / 9 asserted unqualified no-external-transmission | Items **rewritten**. Correction-pending box removed. Item 3 Select-all wording corrected to current W22. | CSO signature on CSN doc v3.82 |
| (ii) | No DPIA for the transactional API proxy | DPIA **§2.2** added (controller/processor, UK transfer, SW-only `txn.callerKey`, read-only, default off). §1 / §5 no longer say zero egress. | CSO / DPO signature on DPIA v1.3 (still DRAFT) |
| (iii) | No hazard for the txn-proxy path | **H-077** raised, Proposed. H-009 addendum records `txn.callerKey` vs control (d). | CSO signature on H-077 |

**Shipped technical controls (already in code — do not treat as signed):**

- Default `txn.integrationMode` = `session` (local Medicus session only).
- `shared/txn-transport.js` throws on `isWrite` — proxy path is read-only.
- `txn.callerKey` is service-worker-only; content scripts never see it; excluded from suite backups.
- Manifest host list includes `*.supabase.co/*` (H-009 (a) already names this).
- Practices are told in INTENDED-PURPOSE and this pack not to enable hybrid/transactional until sign-off.

---

## What this increment did **not** do

- Did not change H-063–H-076 from Proposed to Accepted.
- Did not move `last_cso_review_version` off 3.261.21.
- Did not invent a sign-off date or GMC countersignature.
- Did not enable hybrid/transactional by default.

---

## Suggested review order

1. H-077 + DPIA §2.2 + CSN §6 items 1/8/9 (the open txn trio — blocks any practice that wants hybrid/transactional).
2. H-074 / H-075 (live-confirmed lab-filing).
3. H-063–H-073, H-076 (Proposed register catch-up).
4. Remaining PENDING CSN addenda since 3.261.21 (U&E restore, usual-GP send, etc.) if this sitting is a wider review.
