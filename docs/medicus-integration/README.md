# Medicus integration workspace

**Audience:** Medicus (Doctolib) engineering collaborators — specifically Tim Gray and any
AI assistant (Claude or otherwise) working on bringing the **Sentinel engine** into the
Medicus platform natively.

This directory is the deliberate entry point for that work. It exists so a collaborator's
Claude can self-orient in this repo without a human walking it through: what Sentinel is,
where its code lives, what its data contracts are, and how its concepts map onto
Medicus-native primitives (coded data instead of display-text matching; platform endpoints
instead of browser-session scraping).

## Reading order

1. **[`SENTINEL-PORTING-GUIDE.md`](./SENTINEL-PORTING-GUIDE.md)** — the core document.
   What the engine is, its exact input/output contracts, the rule schema, the
   text-matching → coded-data migration map, and three candidate integration
   architectures ranked by effort.
2. **[`RESOURCE-PUBLISHING-API.md`](./RESOURCE-PUBLISHING-API.md)** — reference for the
   Medicus Resource Publishing API (Transactional API family), embedded here so client
   code can be written against it without scraping build.medicus.health.
3. `../sentinel-README.md` — Sentinel's original standalone README: intended purpose
   (frozen regulatory statement), hazard register, endpoint list, QOF coverage.
4. `../TRANSACTIONAL-API-INTEGRATION.md` — how this repo *already* consumes the official
   Transactional API (GP Connect Structured feed via a signing proxy), including the
   shadow-parity safety gate. The FHIR normaliser it describes is the existence proof
   that the engine is feed-agnostic.
5. `../INTENDED-PURPOSE.md`, `../HAZARD-LOG.md`, `../CLINICAL-SAFETY-CASE-REPORT.md` —
   clinical-safety context. Any Medicus-native port inherits these hazards and must
   re-assess them under DCB0129 as a *deployed* product, not a personal pilot.

## One-paragraph orientation

"Sentinel" is the clinical rules engine at the heart of this Chrome-extension suite. It is
**pure, dependency-free JavaScript** (`engine/rules-engine.js` + sibling engines) that
evaluates curated rule sets (`rules/*.json`) against a normalised patient bundle and emits
status **chips** (overdue / due_soon / achieved / alert / …). Everything else in the repo —
data fetching, DOM scraping, FHIR normalisation, sidebar rendering — exists to *feed* that
engine or *display* its output. The engine itself has no knowledge of Chrome, the DOM,
Medicus URLs, or how the bundle was obtained. That separation is what makes a
Medicus-native port tractable: replace the feed (coded data from platform services) and
the renderer (native UI / dashboards), keep or re-express the rule semantics.

## Ground rules for this collaboration

- The engine's clinical rule content (`rules/drug-rules.json`, `rules/qof-rules.json`,
  `rules/vaccine-rules.json`, `rules/alert-library.json`) is curated against named UK
  primary sources (BNF, BSR, MHRA DSU, NICE, QOF PRN02356) with a review trail in each
  file's `sourceNotes`. Treat rule *content* changes as clinical-safety changes: they go
  through the CSO review process described in `docs/CSO-DECLARATION.md`, not casual edits.
- Sentinel is deliberately **read-only and recommendation-free** (see the frozen intended
  purpose statement in `../sentinel-README.md`). A Medicus-native version that adds
  write-back, task creation, or recall booking is a *different product* with a different
  regulatory posture — flag that early, don't inherit the "out of scope of MHRA
  regulation" position by default.
- Questions about repo conventions (tests, versioning, storage-key backup discipline) are
  answered in the root `CLAUDE.md`.

## Contact

Repo owner: Dave Triska (davetriska02@gmail.com) — GP, and the single-user pilot clinician
for Sentinel. Medicus-side collaborator: Tim Gray.
