# Learnings: cleaning up outdated SNOMED problem/diagnosis descriptions

Phase 0 discovery for "clean up outdated SNOMED code descriptions" — many
older problem/diagnosis entries carry a historic Read-code-migration display
string (a `[X]`/`[D]`/`[M]`-style ICD cross-map prefix, or a trailing `NOS`)
even though the underlying SNOMED concept has a perfectly good modern plain
synonym. Medicus's own "Edit Problem" UI lets a clinician pick a cleaner
description for the SAME code. Captured 2026-07-22 via
`scripts/document-create-capture.js` (`chDocCap`, `.all()` mode — same
capture tool as `docs/learnings-triage-attachment-to-document.md`, reused
unchanged) on a real patient's real "[X]Attention deficit disorder" problem,
performing the actual intended edit end-to-end.

## Confirmed contract

### 1. Prefill — `GET clinical/data/problem/edit-problem/{problemId}`

```json
{
  "problemId": "{problemId}",
  "problemCode": {
    "label": "[X]Attention deficit disorder",
    "value": { "conceptId": "35253001", "description": "[X]Attention deficit disorder", "descriptionId": null }
  },
  "existingProblems": [
    {
      "label": "[X]Depression NOS (Onset unknown)",
      "value": { "description": "[X]Depression NOS", "descriptionId": null, "conceptId": "35489007" }
    }
    /* … every other CURRENT problem on this patient, same {description,descriptionId,conceptId} shape,
         used by the form to warn about duplicates — NOT itself an edit target */
  ],
  "significance": "major",
  "episode": null,
  "onsetDate": null,
  "additionalInformation": "…",
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "status": "active",
  "endDate": null,
  "reasonEnded": null,
  "patientId": "{patientId}",
  "recordDate": "2019-06-27",
  "recordedAtAnotherOrganisation": true,
  "recordedByOrganisation": { "organisationName": "…", "organisationIdentifierType": null, "organisationIdentifierValue": null },
  "recordedByPractitioner": "…",
  "staff": [ /* {value, label} for recordedByStaff, only relevant when recordedAtAnotherOrganisation=false */ ]
}
```

- **`descriptionId: null` is the reliable machine-detectable signal**, not just
  the bracket/NOS text — a legacy/degraded code carries no live SNOMED
  description link at all, only a free-text `description` string plus the
  `conceptId`. TWO other problems on this same real patient showed the exact
  same pattern (`"[X]Depression NOS"` conceptId `35489007`, `"Fracture of
  radius NOS"` conceptId `12676007`, both `descriptionId: null`) — consistent,
  not a one-off.
- `existingProblems` is a full list of the patient's OTHER current problems in
  the identical `{description, descriptionId, conceptId}` shape — a
  side-channel confirmation that this shape is the general "coded entry"
  representation across the record, not something special to this one field.

### 2. Search for alternate descriptions of the SAME concept —
`GET clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&query={text}`

This is Medicus's own generic problem/diagnosis-code search (parent concepts:
clinical finding / procedure / situation-with-explicit-context / (unconfirmed)
/ event — `307824009` excluded). Confirmed real response for
`query=Attention+deficit+disorder`:

```json
{
  "results": [
    { "label": "Attention deficit disorder", "value": { "description": "Attention deficit disorder", "conceptId": "35253001", "descriptionId": "486108019" } },
    { "label": "ADD - Attention deficit disorder", "value": { "description": "ADD - Attention deficit disorder", "conceptId": "35253001", "descriptionId": "486104017" } },
    { "label": "Attention deficit disorder without hyperactivity", "value": { "description": "Attention deficit disorder without hyperactivity", "conceptId": "35253001", "descriptionId": "486107012" } },
    { "label": "ADD - Attention deficit disorder without hyperactivity", "value": { "description": "ADD - Attention deficit disorder without hyperactivity", "conceptId": "35253001", "descriptionId": "486105016" } },
    { "label": "Child attention deficit disorder", "value": { "description": "Child attention deficit disorder", "conceptId": "192127007", "descriptionId": "295618015" } }
    /* … 15 more results, mostly DIFFERENT conceptIds (ADHD, adult ADHD, etc.) */
  ]
}
```

**This confirms the "single store" the question was about**: it isn't a
static file, it's this live search — one `conceptId` genuinely has several
description rows (synonyms), and querying by the cleaned-up text (bracket/NOS
stripped) surfaces them alongside unrelated concepts. **The safe filter for a
cleanup tool is: keep only results whose `value.conceptId` matches the
problem's CURRENT `conceptId`** — this guarantees the tool only ever offers
alternate descriptions of the exact same code, never a re-code to a different
clinical concept.

### 3. Save — `POST clinical/problem/edit-problem/{problemId}`

**Full replace, not a partial patch** — confirmed real body (this is
everything the Vue form (`edit-problem-form.vue`) submits, all fields, not
just the changed one):

```json
{
  "onsetDate": null,
  "contextId": null,
  "contextType": null,
  "significance": "major",
  "episode": null,
  "problemCode": { "description": "Attention deficit disorder", "conceptId": "35253001", "descriptionId": "486108019" },
  "additionalInformation": "adult ( provisional diagnosis )",
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "endDate": null,
  "reasonEnded": null,
  "recordDate": "2019-06-27",
  "recordedByOrganisation": { "organisationName": "The Park Road Surgery", "organisationIdentifierType": null, "organisationIdentifierValue": null },
  "recordedByPractitioner": "Mrs Sarah Elliott"
}
```

→ `200 {}` (empty body). A subsequent `GET
clinical/data/problem/slideover/overview/{problemId}` confirms the change
stuck: `conceptId` unchanged (`35253001`), `description` now `"Attention
deficit disorder"`, `descriptionId` now populated (`486108019`, was `null`)
— **exactly the "same code, clearer description" behaviour the whole feature
is about**, confirmed end-to-end on a real patient record, not a test one.

- Only `problemCode` changed between the GET-prefill values and the POST body
  in this capture — every other field (`significance`, `additionalInformation`,
  `recordDate`, `recordedByOrganisation`/`recordedByPractitioner`, etc.) was
  resent unchanged. **A cleanup tool must GET the full prefill first and
  round-trip every other field untouched** — sending only `{problemCode:...}`
  has never been confirmed and, given `m-edit-form`'s full-object binding, is
  likely to blank the other fields.
- Whether `recordedByOrganisation`+`recordedByPractitioner` or
  `recordedByStaff` is required depends on `recordedAtAnotherOrganisation`
  (from the GET prefill) — mirror whichever branch the prefill indicates,
  don't assume one.

## What this means for a cleanup tool

- **Detection**: `patient/data/clinical-summary/summary/{patientId}`'s
  `problems[].problemCodeDescription` (plain text, already used elsewhere in
  this repo) is enough to flag CANDIDATES by pattern (`/^\[[A-Za-z]{1,2}\]/`,
  `/\bNOS$/i`) for a quick scan across a problem list without extra calls.
  `descriptionId === null` (only visible after the per-problem
  `edit-problem` GET) is the more RELIABLE signal, confirmed correlated with
  the bracket/NOS text on every example seen so far, but costs one API call
  per candidate to check.
- **Suggesting a fix**: GET `edit-problem/{problemId}` for the current
  `conceptId`, search with the bracket/NOS stripped from the current
  description, filter results to the same `conceptId`, and offer the
  shortest/no-bracket/no-NOS survivor as the suggested replacement — never
  auto-apply; a clinician must confirm, same as Medicus's own UI requires.
- **Applying a fix**: resend the FULL `edit-problem` payload with only
  `problemCode` swapped (per §3 above).

## 4. DOM injection point (live capture, 2026-07-22)

Address bar, viewing a patient's Active Problems (Clinical Summary tab):

```
https://england.medicus.health/{siteId}/patient/patient/care-record/{patientId}?careRecordTab=clinical-summary
```

Each problem renders as:

```html
<li class="item">
  <a class="item__link m-link medicus-outline item__link">[X]Depression NOS</a>
  Jan 2004*
</li>
```

nested inside `div.m-card-v2 > div.m-card-v2__content > ul` under an "Active
Problems" heading — the same `li.item` shape
`engine/extractors/problems.js`'s own Strategy 1 selector
(`li.m-list-item, li.item, li`) already expects for this page. The `<a>`'s
trimmed textContent is an EXACT match for `problemCodeDescription` from the
`clinical-summary/summary` API response — safe to match by text, same
discipline already proven for attachment detection
(`docs/learnings-triage-attachment-to-document.md` §8).

The bare `.../{siteId}/care-record/{patientId}` URL form (no
`patient/patient/` segment) is supported by the widget's URL regex too, but
only BY ANALOGY — `content-scripts/triage-lens/content.js`'s `pageType()`
already treats `/care-record/` and `/patient/patient/` as equivalent
record-page markers, and a `window.open()` elsewhere in that file constructs
exactly this shorter path — not independently captured this session.

## What's NOT yet confirmed

- Whether `descriptionId === null` is EVER seen on a legitimately-current,
  freshly-coded problem (i.e. is it a 100%-reliable "needs cleanup" signal,
  or could a fresh entry also have a null descriptionId for an unrelated
  reason)? Only 3 examples seen so far, all genuinely historic/migrated —
  worth widening the sample before trusting this as the sole detector.
  before Do NOT rely on this signal alone without checking a few more real
  examples first.
- Whether the SAME endpoint pair applies to non-"problem" coded entries that
  can carry the same bracket/NOS legacy pattern (e.g. procedures, referral
  reasons, other coded record types) — only problems have been captured.
- The full meaning of `constrainingParentConcepts=404684003,71388002,
243796009,48176007,272379006` and `excludeConstrainingConcepts=307824009` —
  `404684003` (Clinical finding) and `71388002` (Procedure) are confirmed SCT
  root concepts by general SNOMED knowledge; the other three parent concepts
  and the excluded one were not individually verified against a SNOMED
  browser in this session.
- Whether `descriptionId === null` correlates with the "H/O"/"H/O:" free-text
  prefix (`LEGACY_HO_PREFIX_RE`, `shared/legacy-coded-description.js`,
  2026-07-25) the same way it's confirmed to for the ICD-bracket/NOS/NEC
  patterns above. Different origin (GP2GP-era free-text shorthand, not a
  Read-code migration artefact) — the correlation is not assumed to transfer,
  per that file's own comment. Doesn't affect the fix action's safety either
  way (`sameConceptAlternatives` always re-derives the current `conceptId`
  live and only ever offers same-concept synonyms) — this is purely about
  whether `descriptionId` could additionally be trusted as a confirmatory
  signal for this specific prefix. Live probe below, not yet run.

## Probe: does `descriptionId === null` hold for H/O-prefixed problems?

Paste into the Medicus **page console** on a patient's care-record page (any
tab under `/care-record/{patientId}` or `/patient/patient/care-record/{patientId}`
works — matches the widget's own URL detection). Finds every current problem
whose description starts "H/O " or "H/O:", fetches each one's `edit-problem`
prefill, and reports whether `descriptionId` is null — same real ids/PHI only
ever printed to your own browser console, per this project's established
convention.

```js
// ── H/O-prefix descriptionId-correlation probe (Medicus PAGE console) ──
(async function () {
  'use strict';
  const RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;
  const m = location.pathname.match(RECORD_URL_RE);
  if (!m) {
    console.error('[probe] Not on a patient care-record page.');
    return;
  }
  const [, siteId, patientId] = m;
  const apiBase = `https://${siteId}.api.${location.hostname}`;
  const HO_RE = /^h\/o(?:\s+|:\s*)/i;

  async function apiFetch(path) {
    const res = await fetch(apiBase + path, { credentials: 'include', headers: { Accept: 'application/json, text/plain, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }

  let summary;
  try {
    summary = await apiFetch(`/clinical/data/clinical-summary/summary/${encodeURIComponent(patientId)}`);
  } catch (e) {
    console.error('[probe] clinical-summary fetch failed:', e.message);
    return;
  }
  const candidates = (summary.problems || []).filter((p) => HO_RE.test(String(p.problemCodeDescription || '')));
  console.log(`[probe] ${candidates.length} problem(s) with an H/O prefix found.`);
  if (!candidates.length) {
    console.warn('[probe] No H/O-prefixed problems on this patient — try a different patient.');
    return;
  }

  const results = [];
  for (const p of candidates) {
    try {
      const form = await apiFetch(`/clinical/data/problem/edit-problem/${encodeURIComponent(p.id)}`);
      const val = (form.problemCode && form.problemCode.value) || {};
      results.push({
        problemId: p.id,
        description: p.problemCodeDescription,
        conceptId: val.conceptId || null,
        descriptionId: val.descriptionId,
        descriptionIdIsNull: val.descriptionId === null,
      });
    } catch (e) {
      results.push({ problemId: p.id, description: p.problemCodeDescription, error: e.message });
    }
  }

  console.table(results);
  const withNull = results.filter((r) => r.descriptionIdIsNull).length;
  console.log(
    `[probe] ${withNull} / ${results.length} H/O-prefixed problems have descriptionId === null.`,
    withNull === results.length
      ? 'Correlation HOLDS for every example — matches the bracket/NOS pattern.'
      : 'Correlation does NOT hold for every example — see the table above for which ones differ.'
  );
  window.__hoDescriptionIdProbe = results;
})();
```

**What to look for:** if `descriptionId` is null on every H/O-prefixed problem found, the
correlation holds and the code comment's caveat can be dropped. If some are non-null, the
correlation doesn't transfer — worth noting in the comment as a confirmed negative
(no code change needed either way, since the fix action doesn't rely on this signal).

### Results (captured 2026-07-26) — invalid test sample; question still open

One H/O-prefixed problem found: **"H/O: hay fever"**, `conceptId: 161524000`,
`descriptionId: 251711015` — not null. **But this example doesn't answer the question**:
the tester added this problem themselves via Medicus's own current SNOMED search moments
before probing it, rather than finding a genuine pre-existing historic entry. A
freshly-coded problem is trivially expected to carry a populated `descriptionId` regardless
of the H/O-prefix hypothesis — the whole question is about problems that were
**historically** imported/migrated with this prefix already in place (the same population
the bracket/NOS correlation was itself confirmed against), not ones coded fresh through
the current UI. This result is discarded as not evidential either way.

**No code change made** (the fix action never depended on this signal regardless — see the
DETECTION comment in `content-scripts/problem-description-cleanup.js`), but the comment was
corrected to keep this framed as genuinely unconfirmed, not refuted, pending a real example.

### Results, take 2 (captured 2026-07-26) — genuine example confirms the correlation

Re-run against a genuine pre-existing patient problem (not tester-added this time):
**"H/O: varicose veins"**, `conceptId: 161509009`, `descriptionId: null` — **null**, matching
the ICD-bracket/NOS pattern. 1/1 genuine H/O-prefixed problems found so far have
`descriptionId === null`.

**Correlation confirmed** for the H/O prefix, same evidential weight (n=1 genuine example) as
the bracket/NOS pattern's own original small sample — worth widening if more examples turn up
naturally, not worth a dedicated hunt. Code comment
(`content-scripts/problem-description-cleanup.js`, DETECTION section) updated to reflect
this. No code change needed either way, since (as already noted) the fix action never relied
on this signal for safety — it was only ever a potential bonus corroborating signal, and is
now confirmed usable as one. Investigation closed.

## Probe: does the existing descendant-alternative pipeline already catch a site-specific GI-polyp recode?

Raised 2026-07-26: a real "[M]Tubular adenoma NOS" problem with `additionalInformation`
"Descending colon and sigmoid colon - removed." — user suggests SNOMED 444898006 would be a
better code, inferred from the site text. `descendantAlternatives()`
(`shared/coding-specificity.js`, generalised 2026-07-23 from laterality-only to any
significant word in the whole `additionalInformation` field) may already attempt exactly
this with zero new code — but two things need live confirmation before trusting it or
building anything further: (1) whether 444898006's own SNOMED wording literally contains a
matching word (the pipeline has already hit a word-literalism miss once, on
"myomectomy"/"resection"), and (2) whether it's a TRUE descendant of the currently-coded
concept at all (never assume — this feature's entire safety model rests on the
`parentConceptIds` ancestry check, confirmed per-concept, not inferred from a code number).

Paste into the Medicus **page console** on this patient's care-record page:

```js
// ── Descendant-alternative pipeline replay for a GI-polyp problem (Medicus PAGE console) ──
(async function () {
  'use strict';
  const RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;
  const m = location.pathname.match(RECORD_URL_RE);
  if (!m) {
    console.error('[probe] Not on a patient care-record page.');
    return;
  }
  const [, siteId, patientId] = m;
  const apiBase = `https://${siteId}.api.${location.hostname}`;
  const TARGET_CODE = '444898006';
  const SEARCH_PATH =
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&outputParentConceptIds=1&query=';

  async function apiFetch(path) {
    const res = await fetch(apiBase + path, { credentials: 'include', headers: { Accept: 'application/json, text/plain, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }
  async function searchDescriptions(queryText) {
    const data = await apiFetch(SEARCH_PATH + encodeURIComponent(queryText));
    return (data && data.results) || [];
  }
  async function searchDescendantsNarrowed(parentConceptId, queryText) {
    const path =
      `/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=${encodeURIComponent(parentConceptId)}` +
      `&outputParentConceptIds=1&query=${encodeURIComponent(queryText)}`;
    const data = await apiFetch(path);
    return (data && data.results) || [];
  }
  // Mirrors shared/coding-specificity.js's significantWords exactly.
  const GENERIC_STOP_WORDS = ['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'];
  function significantWords(text) {
    const whole = String(text == null ? '' : text).toLowerCase();
    const candidates = whole.match(/[a-z]+/g) || [];
    const seen = new Set();
    const out = [];
    candidates.forEach((w) => {
      if (w.length < 3 || GENERIC_STOP_WORDS.includes(w) || seen.has(w)) return;
      seen.add(w);
      out.push(w);
    });
    return out;
  }

  let summary;
  try {
    summary = await apiFetch(`/clinical/data/clinical-summary/summary/${encodeURIComponent(patientId)}`);
  } catch (e) {
    console.error('[probe] clinical-summary fetch failed:', e.message);
    return;
  }
  const target = (summary.problems || []).find((p) => /tubular adenoma/i.test(String(p.problemCodeDescription || '')));
  if (!target) {
    console.warn('[probe] No "tubular adenoma" problem found on this patient.');
    return;
  }
  console.log('[probe] Found problem:', target.problemCodeDescription, target.id);

  const prefill = await apiFetch(`/clinical/data/problem/edit-problem/${encodeURIComponent(target.id)}`);
  const code = prefill.problemCode && prefill.problemCode.value;
  if (!code || !code.conceptId) {
    console.error('[probe] No conceptId on this problem\'s prefill.');
    return;
  }
  console.log('[probe] Current code:', code.conceptId, code.description, '| additionalInformation:', prefill.additionalInformation);

  const hintWords = significantWords(prefill.additionalInformation);
  console.log('[probe] Extracted hint words:', hintWords);

  const allDescendants = await searchDescendantsNarrowed(code.conceptId, '');
  console.log(`[probe] Blank-query descendant fetch returned ${allDescendants.length} result(s).`);

  const targetResult = allDescendants.find((r) => r.value && r.value.conceptId === TARGET_CODE);
  if (targetResult) {
    const isTrueDescendant = Array.isArray(targetResult.value.parentConceptIds) && targetResult.value.parentConceptIds.includes(code.conceptId);
    const matchedWords = hintWords.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(targetResult.value.description || ''));
    console.log(`[probe] ${TARGET_CODE} FOUND in the descendant fetch:`, targetResult.value.description);
    console.log('[probe]   true descendant of current concept (parentConceptIds contains it)?', isTrueDescendant);
    console.log('[probe]   hint words that literally match its description:', matchedWords, matchedWords.length ? '-> WOULD be offered today' : '-> word-literalism miss, would NOT be offered despite being a true descendant');
  } else {
    console.warn(`[probe] ${TARGET_CODE} NOT present in the blank-query descendant fetch at all.`);
    // Independent check: search for it directly by its own conceptId, to see what
    // it actually IS (label/description) and whether it's a true descendant —
    // separates "doesn't exist / not what I think" from "exists but the
    // descendant-fetch pagination/scope missed it".
    const direct = await searchDescriptions(TARGET_CODE);
    const match = direct.find((r) => r.value && r.value.conceptId === TARGET_CODE);
    if (match) {
      const isTrueDescendant = Array.isArray(match.value.parentConceptIds) && match.value.parentConceptIds.includes(code.conceptId);
      console.log(`[probe] ${TARGET_CODE} DOES exist as a concept:`, match.value.description);
      console.log('[probe]   true descendant of the CURRENT coded concept?', isTrueDescendant, isTrueDescendant ? '(genuinely missed by the descendant fetch — a real gap)' : '(NOT a descendant of what\'s currently coded — would be unsafe to offer via this mechanism regardless)');
    } else {
      console.error(`[probe] ${TARGET_CODE} not found via direct search either — double-check the code.`);
    }
  }
  window.__giPolypProbe = { target, code, hintWords, allDescendants };
})();
```

**What the output tells us:**
- `444898006` found, true descendant, hint words matched → **already works today, no code change**, just confirms live.
- `444898006` found, true descendant, but zero hint-word matches → the word-literalism gap, same class of bug as the earlier myomectomy case — a real, scoped fix (broaden matching, e.g. stem/synonym awareness for anatomical terms).
- `444898006` missing from the blank-query fetch but confirmed a true descendant via direct search → the "not provably complete" pagination caveat already flagged in this file's own comments has a real instance — worth a targeted fix to the retrieval, not the matching.
- `444898006` exists but is **not** a true descendant of what's currently coded → the suggestion would be clinically wrong regardless of matching, and this file's safety rule (ancestry only, never guessed) is correctly protecting against it not being offered.
