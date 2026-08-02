# Lab Results Auto-Filing — response to the GP-panel wishlist

**Date:** 2026-06-29 · responds to `GP-PANEL-labfiling-2026-06-29.md` (the 11-persona
synthetic review). Records what shipped this round, how each P-item was addressed, and
why the remaining items are deferred (with the rationale, so the next session doesn't
re-litigate it).

> Synthetic panel, not real user research — see the panel doc's caveat.

## What shipped this round

The whole pure-logic layer (`shared/lab-filing-utils.js`), the in-Medicus macro
(`content-scripts/triage-lens/lab-file-button.js`) and the side-panel module
(`side-panel/modules/labfiling/`) were extended. All gates fail **closed**: a check the
suite cannot complete blocks the offer rather than letting it through.

| Wishlist item | Status | How |
|---|---|---|
| **P1 — Trend / previous value at point of filing** | ✅ Shipped | `analyteTrend()` reads each result's `history` (newest-first). The confirm dialog (`buildFilingConfirmMessage`) now prints `prev → now (↑+N%)` per analyte. A per-profile **trend guard** (`trend.maxDeltaPct`) blocks the offer when any analyte has moved more than the set % vs last time — catches a creeping creatinine / falling eGFR even when still "in range". `trendBlockers()`. |
| **P2 — Show actual values + your thresholds at confirm** | ✅ Shipped | The confirm dialog enumerates `name: value unit [limit]` per analyte (profile parameter range if set, else the lab's reference range), not just a name list. It explicitly states the gate is numeric-only and names its blind spots; it does **not** over-claim "confirmed every parameter normal". |
| **P3 — Drug-monitoring awareness** | ✅ Quick-win shipped | Per-profile `excludeIfMeds` ("don't offer if on methotrexate / lithium / amiodarone…"). The macro fetches the medication regimen (`fetchMedicationRegimen` → `normaliseMedications`) only when a profile sets exclusions, and **fails closed** if the fetch errors. `medExclusionBlockers()`. (Full drug-rules-engine integration + recall-on-file deferred — see below.) |
| **P5 — Per-patient "never auto-file" watch-list** | ✅ Shipped | A "Never auto-file this patient" link on the in-Medicus button writes the patient UUID to a machine-local list (`labfiling.suppress`). The module shows the list with per-entry Remove. `suppressedBlockers()`. The list holds patient identifiers, so it is **never exported/imported** (same doctrine as the audit log). |
| **P6 — Practice-visible audit (in-extension viewer + CSV)** | ✅ Partial | Recent-filings panel already existed; added **Export CSV** (`auditCsv()`) and per-profile **fire count** on the card. (Writing a note back into the Medicus record + a shared/practice digest is deferred — see below.) |
| **P8 — Profile transparency on the card** | ✅ Shipped | The card now shows the **guards** in force (trend / drug exclusions / text rules / range-required), the **last-edited date**, and **how many times it has filed on this device** — so a locum can see what they're trusting without opening Edit. Plus **Copy JSON** to share a profile (arrives disabled). |
| **P9 — Safety-netting hooks** | ✅ Partial | `suppressIfText` ("don't offer if the report text says 'telephone result' / 'call patient'") — a promised contact blocks the offer. `textSuppressBlockers()`. ("Who requested this test" awareness and reopen/unfile deferred — see below.) |
| **P10 — Smaller asks** | ✅ Mostly shipped | **Practice kill switch** (`config.killSwitch`) — one toggle hides the in-Medicus button everywhere instantly without touching any profile. **`requireRangeForAll` defaults ON** for new profiles (loud opt-out). LLM-built profiles already **badged "Auto-suggested"** with a check-every-field warning and a value-by-value confirm dialog. |

## Deferred — and why

These need infrastructure the extension doesn't have, or a live-DOM scoping pass we
can't do headless. Each is deferred deliberately, not forgotten.

### P4 — Bulk / inbox-level filing *(biggest time lever)*
The per-result button is correct and safe, but the real time win is "review all
all-normal results from the inbox as one batch, confirm once." **Deferred** because it
needs: (a) a reliable inbox/worklist DOM contract (the queue is the Vue+AG-Grid SPA that
strips foreign nodes — see CLAUDE.md), and (b) a batch-confirm UX that still shows each
patient's values (P2) so it isn't a blind "file 40". This is the recommended **next**
build once the inbox DOM is scoped with a console capture, but it is a feature in its own
right, not a tweak.

### P3 remainder — full drug-rules-engine integration + recall-on-file
The quick-win (`excludeIfMeds` substring list) ships now. Wiring the suite's existing
`engine/rules-engine.js` drug-monitoring rules so the exclusion list **auto-populates**
from monitored drugs (rather than the clinician retyping them), plus "interval since last
test" awareness and an optional "set next blood in N months" recall-on-file, is
**deferred**: recall-on-file is an *additional* irreversible write to the record and needs
its own scoping + safety case.

### P6 remainder — note back into the Medicus record + shared digest
Writing a structured "Reviewed all-normal, filed via Lab Filing, profile X, by [GP]" note
into the patient record is **deferred** because it is an extra record write whose control
we have not scoped on the live screen, and a shared/practice digest needs a transport the
extension doesn't have (it is machine-local by design). The CSV export is the
governance bridge in the meantime.

### P7 — Practice deployment / profile push / dry-run / versioning
Profile **push/sync** across machines, a **dry-run** ("what would this file?"), and
full **versioning** (who edited, when) need a practice-level backend the suite doesn't
have — config is per-install `chrome.storage.local`. **Deferred to a practice-sync
epic.** Partial coverage now: **Copy JSON** lets a profile be shared by hand
(arrives disabled), and the card shows last-edited + fire-count as lightweight provenance.

### P9 remainder — "who requested this test" + reopen/unfile
"Warn before filing on another clinician's request" needs the requester field reliably on
the report payload (not yet confirmed in the captures). **Unfile/undo is not possible** —
filing is irreversible in Medicus from our vantage point; the honest answer is the
confirm gate + kill switch + per-patient suppress, not a fake undo. Deferred pending a
capture that confirms the requester field.

## Safety posture (unchanged, reinforced)
Confirm-not-auto (no full-auto commit mode), disabled-until-reviewed, fail-closed on
free-text/cultures/unmatched/missing-rules, prepare-only patient message, machine-local
audit, prototype-pollution-safe import, and now **fail-closed on a meds-fetch error** and
a **practice kill switch**. The trend guard and values-in-dialog directly answer the
panel's single biggest clinical-safety concern (snapshot vs trajectory).

## Tests
`test-lab-filing-utils.js` (116 checks — added trend/med/suppress/text/CSV/schema),
`test-labfiling-io.js` (24 — added killSwitch round-trip), `test-lab-file-macro.js` (37).
Full suite green (`npm test`: 117 files pass).
