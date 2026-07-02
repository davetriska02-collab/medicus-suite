# fixtures/medicus/ — recorded DOM fixtures

Static HTML snapshots of the Medicus DOM surfaces declared in
`shared/dom-contracts.js`. `test-dom-contracts.js` loads every fixture into a
small self-contained fake DOM (no dependency added — see the parser at the top
of that test file) and checks each contract's `anchor`/`target`/`legacy`
selectors against it.

## What's here now

The seed set is **SYNTHESISED** — built from the markup the code demonstrably
handles today (both current `m-*`/current-tag markup and the legacy Quasar
`q-*` variants, per the v3.143.1/v3.143.2 fixes and the existing fake-DOM
tests), not captured from a live page. Every fixture carries a provenance
comment header saying so, and contains **zero patient data**: names, dates and
UUIDs are all placeholders (`deadbeef-dead-4eef-…` style hex-only UUIDs,
"Placeholder Patient" names).

Naming convention: `<contract-id-with-dots-as-dashes>-<variant>.html`, e.g.
`oir-checkbox-current.html` / `oir-checkbox-legacy.html`. A contract with more
than one legacy fallback tier gets `-legacy-1.html`, `-legacy-2.html`, … in
the same order as the `legacy` array in `shared/dom-contracts.js`. A contract
with no legacy tier has only a `-current.html` (or an untagged `.html` when
there's exactly one fixture and no current/legacy distinction is meaningful).

## How a real capture replaces a synthesised fixture

1. On the live Medicus page, open the console and paste
   `scripts/capture-fixture.js` (or a page-console snippet built from it —
   see that file's header for the exact workflow and the sanitisation rules).
2. Right-click the DOM subtree the relevant contract cares about (the OIR
   card, a queue row + its preview row, the prescribing form, …) and use the
   helper to clone + sanitise it. It strips every text node and attribute
   value that could carry PHI (names, dates of birth, NHS numbers, free text)
   down to placeholders, keeping only the **structural** selectors —
   tag/class/role/attribute-name — that the contract actually depends on.
3. It triggers a browser download of the sanitised HTML.
4. Review the downloaded file yourself before committing — the capture helper
   is a best-effort sanitiser, not a guarantee. Confirm by eye that no real
   patient name, date, NHS number or free-text clinical content survived.
5. Replace the matching synthesised fixture in this directory (keep the
   provenance header, but change "SYNTHESISED from vX.Y.Z selector
   expectations" to "CAPTURED from a live page on <date>, vX.Y.Z, sanitised
   via scripts/capture-fixture.js").
6. Run `node test-dom-contracts.js` — a captured fixture must satisfy the same
   anchor/target/legacy selectors a synthesised one did, or the contract
   itself needs updating (which means the registry has caught real Medicus
   drift — exactly the point of this exercise).

## Zero patient data, always

Nothing in this directory may ever contain a real patient name, DOB, NHS
number or free-text clinical content — captured fixtures are sanitised at
capture time (step 2 above) and reviewed by a human before commit (step 4).
The suite's `scripts/check-no-patient-data.js` CI guard also scans every
added line for checksum-valid NHS numbers, but do not rely on that as the
only defence — review before you commit.
