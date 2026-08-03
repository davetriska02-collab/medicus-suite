# Learnings — Medicus SNOMED search, live console verification (2026-08-01)

Live run by Dave, DevTools console, england.medicus.health, logged-in session.
Purpose: verify the Document Coder extraction engine's offered-term vocabulary
resolves against Medicus's OWN concept index (the runtime resolution path).

## Confirmed (live)

- **API base discovery from console**: `performance.getEntriesByType('resource')`
  → first entry containing `.api.england.medicus.health` → origin. App at
  `england.medicus.health`, API at `https://560b6c.api.england.medicus.health`
  (site code is NOT derivable from the app hostname label — earlier attempt
  `england.api.england…` 500s with no CORS headers).
- **CORS**: credentialed console fetch to the real API origin succeeds (server
  sends ACAO for the app origin). Console-world diagnostics work; the earlier
  guide assumption holds.
- **`query` without `constrainingParentConcepts` returns HTTP 200 with an
  EMPTY result set** — a malformed call fails silently-empty, not loudly.
  Product code must treat empty-with-missing-param as its own failure mode
  (four-state honesty: "search did not run correctly" ≠ "no matches").
- **Response shape** exactly as SNOMED-API-GUIDE.md: `{results:[{label,
  value:{description, conceptId, descriptionId, parentConceptIds?}}]}`.
- **All 14 extractor corpus terms resolve** (constrained to 404684003
  Clinical finding, `outputParentConceptIds=1`): 12/14 with the exact concept
  as top hit, incl. Community acquired pneumonia→385093006 (unique match),
  **Atrial fibrillation→49436004 (mockup's pinned ID, now live-confirmed)**,
  T2DM→44054006, Hypertension→38341003, NSTEMI→401314000, Gout→90560007,
  Acute otitis media→3110003, Falls→161898004, Recurrent falls→279992002.
- **Laterality survives resolution**: "Cellulitis of left leg" → pre-coordinated
  "Cellulitis of left lower leg" (41651000087106) — descendant refinement works.
- **One instructive weak case**: "Moderate depressive episode" has no exact
  concept; top hits are recurrent/bipolar variants — exactly the case the
  tier system must grade weak (tier B/C), never one-click. Keep as the
  canonical tier-calibration example.

## Still to confirm
- Same calls from the extension's isolated world (expected fine — host
  permission exists); the §14 capture session Q1–Q6 remain open.
