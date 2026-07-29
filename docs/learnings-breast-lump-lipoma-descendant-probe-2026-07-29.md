# Investigation: "Lipoma of breast" (276891009) not offered for "Breast lump" (162160003)

**Status (2026-07-29, live investigation, not yet resolved):** reported by the user —
problem coded 162160003, additionalInformation "14 x 5 x 10mm - lipoma left breast", "Clean
up code" suggests several codes but not the obvious 276891009 "Lipoma of breast".

## What's confirmed via the public SNOMED API (not guessed)

- 162160003 "Breast lump symptom (finding)" — **retired**, `SAME AS` association to
  **89164003 "Breast lump (finding)"** (inactivation reason "Duplicate component"). This is
  exactly the retirement shape the 2026-07-29 SAME AS + retired-concept-pivot fixes target —
  `st.retiredInfo.replacement.conceptId` should resolve to `89164003`, and
  `descendantSearchTargetConceptId` should search under `89164003`, not the dead
  `162160003`.
- 89164003 "Breast lump" has **at least 31 direct children** (confirmed via `/children`) —
  a BROAD parent, same class of case as the earlier "Fracture" (125605004) broad-parent bug:
  the blank-query descendant enumeration caps at ~20 results with no pagination, so it is
  almost certainly NOT complete for this concept.
- **276891009 "Lipoma of breast" IS a genuine, if 3-levels-deep, descendant of 89164003** —
  confirmed via the ancestor chain: 276891009 → 269485000 "Benign neoplasm of breast" →
  126926005 "Neoplasm of breast" → 89164003 "Breast lump" (126926005 is a confirmed direct
  child of 89164003). **This is NOT the same failure mode as the 179304004/430694001 hip
  case** — that one was a genuinely different SNOMED axis with no valid combined code, and
  the tool was correctly excluding it. Here, the target code IS reachable in principle; the
  question is purely whether MEDICUS'S OWN search retrieval actually finds it.
- `significantWords("14 x 5 x 10mm - lipoma left breast")` (the function that supplies
  hintWords for the descendant search, independent of the separate curated
  PATHOLOGY_HINT_WORDS/ANATOMICAL_SITE_HINT_WORDS lists used only by hintExpandedAlternatives)
  extracts `['lipoma', 'left', 'breast']` — none are stop words, all ≥3 chars. So a narrowed
  query `constrainingParentConcepts=89164003&query=lipoma` SHOULD already be firing.

## What's NOT confirmed — needs a live probe

Whether Medicus's OWN search index (a different system from the public termbrowser API used
above) actually returns 276891009 for that narrowed query, and if so whether the result
carries `89164003` in its own `parentConceptIds` array (confirming the ancestry-safety check
would accept it). Possible culprits, in rough order of likelihood:

1. **Retrieval never reaches 3-levels-deep for this concept** — the "Fracture" precedent
   worked multi-level, but that doesn't guarantee EVERY broad parent's search behaves
   identically; needs direct confirmation for this specific hierarchy.
2. **The blank-query cap swallows it and the narrowed "lipoma" query also somehow doesn't
   surface it** — possible if Medicus's `constrainingParentConcepts` scoping behaves
   differently than assumed for this concept.
3. **It IS found, but `parentConceptIds` doesn't include 89164003** — would mean Medicus's
   own index encodes a different/incomplete ancestor closure than the public termbrowser API
   for this specific concept (unlikely but not impossible — different release/edition sync).
4. **The retirement pivot isn't actually engaging for this row** — e.g. if the row was only
   ever flagged by the automatic text scan (not the opt-in "Check for retired/legacy codes?"
   scan), `st.retiredInfo` would be null and the OLD dead 162160003 would still be the search
   target. Worth confirming the scan was actually run for this patient before digging further.

## Live probe (not yet run) — paste into the Medicus PAGE console

Same established convention as every other investigation in this codebase: real
ids/descriptions only ever printed in the user's own browser console, never sent elsewhere.
Open the patient's Clinical Summary tab first.

```js
// ── "Lipoma of breast" retrieval probe (Medicus PAGE console) ──
(async function () {
  'use strict';
  const RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;
  const m = location.pathname.match(RECORD_URL_RE);
  if (!m) {
    console.error("[probe] Not on a patient care-record page — open the patient's Clinical Summary tab first.");
    return;
  }
  const siteId = m[1];
  const patientId = m[2];
  const apiBase = 'https://' + siteId + '.api.' + location.hostname;

  async function apiFetch(path) {
    const res = await fetch(apiBase + path, { credentials: 'include' });
    if (!res.ok) throw new Error('API ' + res.status + ' for ' + path);
    return res.json();
  }

  // Step 1: find the breast-lump problem on this patient.
  const summary = await apiFetch('/clinical/data/clinical-summary/summary/' + encodeURIComponent(patientId));
  const candidates = (summary.problems || []).filter((p) => /breast|lump/i.test(p.problemCodeDescription || ''));
  if (!candidates.length) {
    console.error('[probe] No problem with "breast" or "lump" in its description found on this patient.');
    return;
  }
  console.log(
    `[probe] Found ${candidates.length} candidate problem(s):`,
    candidates.map((p) => p.problemCodeDescription)
  );

  const REPLACEMENT_CONCEPT_ID = '89164003'; // confirmed live via the public termbrowser API, see the accompanying learnings doc
  const TARGET_CONCEPT_ID = '276891009'; // "Lipoma of breast" — confirmed live to be a genuine descendant

  for (const p of candidates) {
    const prefill = await apiFetch('/clinical/data/problem/edit-problem/' + encodeURIComponent(p.id));
    const code = prefill.problemCode && prefill.problemCode.value;
    console.log(
      `[probe] Problem "${p.problemCodeDescription}" (id ${p.id}) — conceptId ${code && code.conceptId}, additionalInformation:`,
      prefill.additionalInformation
    );
  }

  // Step 2: run the SAME searches the widget runs, under the confirmed
  // replacement concept (89164003 "Breast lump") — blank-query enumeration
  // (checks the ~20-result cap) AND the narrowed "lipoma" query (checks
  // whether the deep descendant is reachable at all).
  const SEARCH_BASE =
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=' +
    REPLACEMENT_CONCEPT_ID +
    '&outputParentConceptIds=1&query=';

  const blank = await apiFetch(SEARCH_BASE);
  console.log(
    `[probe] Blank-query enumeration under ${REPLACEMENT_CONCEPT_ID}: ${(blank.results || []).length} result(s) (cap is ~20, no pagination).`
  );
  const blankHasTarget = (blank.results || []).some((r) => r.value && r.value.conceptId === TARGET_CONCEPT_ID);
  console.log(`[probe]   Contains ${TARGET_CONCEPT_ID} "Lipoma of breast"? ${blankHasTarget}`);

  for (const word of ['lipoma', 'left', 'breast']) {
    const narrowed = await apiFetch(SEARCH_BASE + encodeURIComponent(word));
    const results = narrowed.results || [];
    const match = results.find((r) => r.value && r.value.conceptId === TARGET_CONCEPT_ID);
    console.log(
      `[probe] Narrowed query "${word}" under ${REPLACEMENT_CONCEPT_ID}: ${results.length} result(s). ` +
        `Contains ${TARGET_CONCEPT_ID}? ${!!match}` +
        (match
          ? ` — its own parentConceptIds includes ${REPLACEMENT_CONCEPT_ID}? ${(match.value.parentConceptIds || []).includes(REPLACEMENT_CONCEPT_ID)}`
          : '')
    );
    if (match) {
      console.log('[probe]   Full matched value:', match.value);
    }
  }

  // Step 3: direct bare-SCTID lookup for the target itself, to see what
  // Medicus's OWN index has for it regardless of the constrained search —
  // separates "doesn't exist in Medicus's index" from "exists but the
  // constrained/narrowed search isn't finding it".
  const direct = await apiFetch(
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&outputParentConceptIds=1&query=' +
      TARGET_CONCEPT_ID
  );
  const directMatch = (direct.results || []).find((r) => r.value && r.value.conceptId === TARGET_CONCEPT_ID);
  console.log(
    `[probe] Direct bare-SCTID lookup for ${TARGET_CONCEPT_ID} (broad 6-hierarchy scope, same as "Clean up code"'s own SEARCH_PATH): found? ${!!directMatch}`
  );
  if (directMatch) {
    console.log('[probe]   parentConceptIds:', directMatch.value.parentConceptIds);
    console.log(
      `[probe]   Includes ${REPLACEMENT_CONCEPT_ID} "Breast lump"? ${(directMatch.value.parentConceptIds || []).includes(REPLACEMENT_CONCEPT_ID)}`
    );
  }

  window.__lipomaProbe = { candidates, blank, TARGET_CONCEPT_ID, REPLACEMENT_CONCEPT_ID };
})();
```

**What to look for in the output:**

- If the narrowed `"lipoma"` query DOES return 276891009 with `89164003` in its
  `parentConceptIds` — the retrieval works, and the real bug is elsewhere (e.g. the
  retirement pivot not actually engaging for this row, point 4 above — check whether
  `st.retiredInfo` was populated, i.e. whether "Check for retired/legacy codes?" was run for
  this patient before the panel was opened).
- If the narrowed query returns FEWER results than expected or doesn't include 276891009 at
  all, but the DIRECT bare-SCTID lookup (step 3) finds it fine with `89164003` in its
  ancestor list — the constrained/narrowed search itself has a retrieval gap for deep
  descendants under this specific concept, a genuine code fix needed in
  `searchDescendantsNarrowed`'s usage or `descendantAlternatives`.
- If even the direct lookup can't find 276891009's `parentConceptIds` including 89164003 —
  Medicus's own index disagrees with the public termbrowser data for this concept, a
  different (and much rarer) class of problem.

Paste the console output back for the next step — same discipline as every other
investigation in this codebase: don't guess a fix without a live capture confirming the
actual failure mode.

## Results (captured 2026-07-29) — the search itself is NOT broken

Live run: blank-query enumeration under 89164003 hit the ~20-result cap as predicted and did
NOT contain 276891009 — but the narrowed `"lipoma"` query returned exactly ONE result,
**276891009 itself**, with `89164003` confirmed present in its own `parentConceptIds` (29
entries). The direct bare-SCTID lookup agrees. **So the hypothesis that Medicus's own search
retrieval can't reach a 3-levels-deep descendant is refuted — it works perfectly when
targeted at 89164003.**

This narrows the real question to one thing the probe deliberately did NOT test: whether the
LIVE EXTENSION CODE actually resolves `89164003` as the search target in the first place, or
falls back to the dead `162160003`. The probe's `REPLACEMENT_CONCEPT_ID` was hardcoded from
the public termbrowser lookup earlier in this doc — it bypassed the extension's own
retirement-detection path entirely, so it could confirm the search WOULD work, but not that
the widget WAS actually calling it that way.

Two live candidate explanations, in order of likelihood:

1. **The retired-concept-pivot fix (`descendantSearchTargetConceptId`,
   `content-scripts/problem-description-cleanup.js`) hasn't reached the loaded/reloaded
   extension yet** — that fix has never been confirmed live before this investigation (it
   was implemented, unit-tested, and approved, but this may be the first real-world problem
   it's actually been exercised against). If the browser hasn't picked up the change since it
   landed, the OLD behaviour (search under the dead `162160003`) would still be running.
2. Something in how `st.retiredInfo.replacement` is populated for THIS specific problem
   differs from the 176187002 case it was confirmed against.

Added a diagnostic `console.log` (guarded to retired rows only, so it's not noisy on the
common case) right where `descendantSearchConceptId` is computed in `openPanel` — content
script output appears directly in the page's own DevTools console (no page-console bridge
needed, unlike the isolated-world content scripts elsewhere in this repo). **Next step:**
reload the extension, reopen "Clean up code" for this same problem, and check DevTools
console (F12 on the Medicus tab) for a line starting `[Clean up code] descendant/laterality
search for retired concept 162160003 -> targeting ...` — it will say explicitly which
conceptId was actually targeted and why.
