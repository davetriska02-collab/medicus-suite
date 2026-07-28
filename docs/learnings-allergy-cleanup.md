# Learnings: allergy tidy-up (provenance & reaction from the notes)

**Status: DISCOVERY NOT YET RUN — probes prepared 2026-07-28, awaiting a live
Medicus session.** Nothing in this file is a confirmed contract yet. Every
statement about an allergy endpoint, field name or DOM shape below is marked
**unconfirmed** until the capture session has run and its results are pasted
back into this file in the same format as
`docs/learnings-problem-description-cleanup.md` (confirmed contract →
option-object traps → what's NOT confirmed).

**Purpose.** Phase 0 of `docs/plans/ALLERGY-CLEANUP-2026-07-28.md`. The allergy
tidy-up feature needs two things this repo does not yet have:

1. **The allergy list source** — where the clinical-summary screen's Allergies
   card gets its data, and the exact field names for substance description,
   reaction/manifestation, severity, status, dates and recorded-by (Phase 1
   detection is written against those field names).
2. **The edit-allergy contract** — the prefill GET and save POST analogues of
   `clinical/data/problem/edit-problem/{id}` /
   `clinical/problem/edit-problem/{id}` (Phase 4 apply is written against
   those).

**The hard rule this session exists to honour: never construct a Medicus API
URL from scratch — capture and replay.** Precedent:
`docs/learnings-problem-description-cleanup.md`, where the whole
problem-description cleanup contract (prefill GET → constrained SNOMED
description search → full-replace POST) was obtained by running one real edit
end-to-end through Medicus's own UI under
`scripts/document-create-capture.js`, and where the one field that was
_assumed_ rather than captured (`episode`, §3b) is exactly the one that later
produced a live 400 in the wild. The same discipline applies here, and more
strictly: an allergy record is the highest-stakes record type the suite has
ever written to.

**PHI posture.** The two probes below are read-only and structure-only —
field names and types, never clinical values, plus the established safe-value
allowlist (ids, booleans, counts, dates). The capture session in §4 does
record real clinical text (substance/reaction strings survive `chDocCap`'s
key-based redactor by design, since they are the contract), so its output
stays local and anything pasted back into this file must be pseudonymised
first, exactly as §3b of the problem learnings doc was.

---

## 1. What we need to learn

Expanded from the plan's "What we do NOT yet know". Each item names what a
positive AND a negative answer means, so the session can't end ambiguous.

### (a) Does the clinical-summary payload carry an `allergies[]` array?

`GET clinical/data/clinical-summary/summary/{patientId}` is **confirmed** to
carry `problems[]` with a plain-text `problemCodeDescription`
(`content-scripts/problem-description-cleanup.js`,
`content-scripts/problem-bulk-end.js`, and §"What this means for a cleanup
tool" of the problem learnings doc). Whether the same response carries an
allergies array is **unconfirmed**.

What we need from it, per field:

| We need                                                                 | Likely field (UNCONFIRMED — guesses, to be replaced by captured names) |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Entry id (to address the edit endpoint)                                 | `id`                                                                   |
| Substance description (plain text, for DOM text-matching + label rules) | `?CodeDescription`                                                     |
| Reaction / manifestation (the thing that is usually missing)            | `?reaction` / `?manifestation`                                         |
| Severity                                                                | `?severity`                                                            |
| Status (active / ended / resolved)                                      | `status`                                                               |
| Dates (onset/event vs record/import date — the provenance question)     | `recordDate`, `onsetDate`                                              |
| Recorded-by practitioner + organisation                                 | `recordedByPractitioner`, `recordedByOrganisation`                     |
| "Recorded elsewhere" flag (GP2GP marker)                                | `recordedAtAnotherOrganisation`                                        |

**If there is no allergy key in that response, that is itself a finding**: the
Allergies card is fed by a different endpoint, and the next step is a DevTools
Network capture on tab load (filter the clinical-summary XHRs) rather than
guessing a path. Do not invent `clinical/data/allergy/...`.

The suite's only _current_ allergy source is the GP Connect Structured FHIR
feed — `shared/fhir-normaliser.js` maps `AllergyIntolerance` to
`{label, code, status, recordedDate}` only. That is a **read** feed for the
rules engine (`evaluateDrugAllergyRule`, `engine/rules-engine.js`), not the
edit surface, and it carries no reaction/manifestation at all — so it cannot
answer any of the above.

### (b) The edit-allergy contract

- Does a prefill GET exist, by analogy with
  `clinical/data/problem/edit-problem/{problemId}`? Path **unconfirmed**.
- Does the save POST take a **full replace** body (the confirmed problem
  behaviour) or a partial patch? Assume full-replace until captured, and
  **capture the whole body** so the assumption can be tested.
- **Which fields come back as `{value, label}` option objects.** This is the
  §3b trap from the problem learnings doc: _the GET prefill returns
  select-backed fields as option objects; the POST takes the bare value_, and
  the one field where that wasn't captured (`episode`) produced a live 400
  months later. Allergy forms are select-heavy (severity, certainty,
  reaction-type, status, reason-ended), so expect several. Flatten via the
  same strict rule as `unwrapOptionValue()` — an object with BOTH `value` and
  `label` keys — so genuine object fields (`recordedByOrganisation`'s
  `{organisationName, …}` shape) pass through untouched.
- Is the reaction **coded, free-text, or both**? This determines what "fill in
  the reaction" can actually write (plan Phase 4), and is one of Dave's open
  questions.

### (c) The substance search endpoint

The problem tool uses
`clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&query=…`.
An allergy substance search plausibly uses a **different constraining parent
set** (substance / pharmaceutical product), or **dm+d rather than SNOMED** for
drug allergies. **Unconfirmed.** Capture the actual search call fired while
typing in the substance box; note the full query string verbatim including
every constraining parameter.

(v1 does not change the substance code — safety rule 2 of the plan — so this
is for the record, and for whatever a later description-tidy phase would need.
Capture it anyway while the session is open; a second live session is
expensive.)

### (d) The Allergies card DOM shape

The problem tools anchor by **exact trimmed text match** against
`a.item__link` inside `li.item`, within `div.m-card-v2 > div.m-card-v2__content > ul`
(§4 of the problem learnings doc; `findProblemRow()` in
`content-scripts/problem-description-cleanup.js` queries
`a.item__link, a[class*="item__link"]`, and `injectRetiredWidgetTrigger()`
anchors the card-level widget off `ul[aria-labelledby="problems-major-label"]`
with a row-relative fallback).

Whether the Allergies card uses the **same** `li.item` / `item__link` shape is
**unconfirmed** — the whole anchor-by-text trick depends on it, and the
card-level trigger will need an allergy equivalent of the
`aria-labelledby` hook (or the fallback path). Probe B answers this.

### (e) What an under-specified allergy actually looks like in captured data

Phase 1's detection heuristics must be written against real examples, not
guessed. From the captured allergy array, record (structurally, and in prose —
not by pasting patient text):

- Is the empty reaction an **absent key**, `null`, `""`, or a literal
  `"Unknown"` / `"Unspecified"` / `"Not known"` string? (Each needs a
  different test.)
- Is the dominant scruffy case a **GP2GP import** (`recordedAtAnotherOrganisation`
  true, record date clustering with a `"Data Transferred from other system"`
  encounter — the confirmed marker from `docs/learnings-patient-journal-api.md`),
  a **free-text-only** entry, or a **coded entry with a blank reaction**?
- Do any carry the legacy description markers `shared/legacy-coded-description.js`
  already detects (ICD bracket prefixes, `NOS`/`NEC`, `H/O`, generic import
  text)? That module was deliberately built entity-agnostic for exactly this
  second consumer — confirm it earns its keep here.
- Does an allergy entry expose a `descriptionId`-style field at all (the
  reliable degraded-code signal for problems)?

---

## 2. Probe A — PHI-safe allergy-shape probe

Paste into the Medicus **page console** (MAIN world), on a patient's
care-record page — any tab under `/care-record/{patientId}` or
`/patient/patient/care-record/{patientId}`, matching the widgets' own URL
detection. Pick a patient with a **known scruffy allergy**.

Structure only — field names and types, never clinical values — following
`duplicate-checker.js`'s `describeShape()` convention (type-only, 3 levels
deep, arrays sample only `[0]`), extended with the same small explicit
allowlist of genuinely non-clinical fields (ids, booleans, counts, dates) used
by the journal probe in `docs/learnings-patient-journal-api.md`. Derives the
URL live from the page route (same `RECORD_URL_RE` as the H/O probe in
`docs/learnings-problem-description-cleanup.md`) and does a credentialed
`fetch()` sharing the page's cookie auth, per CLAUDE.md's queue-chip debugging
section. **It hits the CONFIRMED clinical-summary endpoint only — no invented
allergy path.**

```js
// ── PHI-safe allergy-shape probe (paste into the Medicus PAGE console) ──
// Structure/presence only — never logs a clinical-content VALUE. Same
// no-values convention as duplicate-checker.js's describeShape(): field names
// + types, 3 levels deep, arrays inspect only element [0], plus a small
// explicit allowlist of ids/booleans/counts/dates whose value is safe and
// useful to see. Fetches ONLY the already-confirmed clinical-summary
// endpoint — per this repo's "never construct Medicus API URLs from scratch"
// rule (docs/learnings-problem-description-cleanup.md).
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

  // Explicit value-safe allowlist — ids, booleans, counts, dates and state
  // enums ONLY. No substance, reaction, manifestation, note, practitioner or
  // organisation VALUE ever appears here, even truncated.
  const SAFE_VALUE_FIELDS = new Set([
    'id',
    'entryType',
    'type',
    'status', // state enum (active/ended), not clinical text
    'recordDate',
    'onsetDate',
    'startDate',
    'endDate',
    'createdDateTime',
    'authorisedDate',
    'isMarkedIncorrect',
    'isDraft',
    'hiddenFromPatientFacingServices',
    'confidentialFromThirdParties',
    'isRetrospectivelyAmended',
    'recordedAtAnotherOrganisation',
  ]);

  // describeShape — same depth limit, same array-of-[0] sampling, same
  // "type only" default as duplicate-checker.js, plus the allowlist carve-out.
  function describeShape(obj, depth, keyName) {
    if (depth > 3 || obj === null || obj === undefined) return typeof obj;
    if (Array.isArray(obj)) {
      return {
        arrayLength: obj.length,
        itemShape: obj.length ? describeShape(obj[0], depth + 1, keyName) : 'unknown',
      };
    }
    if (typeof obj === 'object') {
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, describeShape(v, depth + 1, k)]));
    }
    if (keyName && SAFE_VALUE_FIELDS.has(keyName)) return { type: typeof obj, safeValue: obj };
    return typeof obj;
  }

  let payload;
  try {
    const res = await fetch(`${apiBase}/clinical/data/clinical-summary/summary/${encodeURIComponent(patientId)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    console.error('[probe] clinical-summary fetch failed:', e.message);
    return;
  }

  const topLevelKeys = Object.keys(payload || {});
  console.log('[probe] clinical-summary top-level keys:', topLevelKeys);

  const allergyKeys = topLevelKeys.filter((k) => /allerg/i.test(k));
  const report = { topLevelKeys, allergyKeys, shapes: {}, counts: {} };

  if (!allergyKeys.length) {
    console.warn(
      '[probe] NO key matching /allerg/i in clinical-summary/summary.',
      'THIS IS ITSELF A FINDING: the Allergies card is fed by a DIFFERENT endpoint.',
      'Next step: DevTools > Network, reload the clinical-summary tab, find the XHR that',
      'returns the allergy list, and record its exact path — do NOT guess a path.'
    );
  } else {
    allergyKeys.forEach((k) => {
      const v = payload[k];
      report.counts[k] = Array.isArray(v) ? v.length : null;
      report.shapes[k] = describeShape(v, 1, k);
      console.log(`[probe] key "${k}" — ${Array.isArray(v) ? v.length + ' entries' : typeof v}`);
      console.log(JSON.stringify(report.shapes[k], null, 2));
    });
  }

  // Emptiness census — answers §1(e) ("is a missing reaction an absent key,
  // null, "", or a literal 'Unknown' string?"), which describeShape alone
  // cannot: ported verbatim, it reports null as "object". Counts only, no
  // values — except membership of a FIXED non-clinical placeholder vocabulary,
  // which leaks nothing about the patient.
  const PLACEHOLDER_WORDS = new Set([
    'unknown',
    'unspecified',
    'not known',
    'not specified',
    'none',
    'nil',
    'n/a',
    '-',
  ]);
  report.emptiness = {};
  allergyKeys.forEach((k) => {
    const arr = Array.isArray(payload[k]) ? payload[k] : [];
    const census = {};
    arr.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const keys = new Set([...Object.keys(entry), ...Object.keys(census)]);
      keys.forEach((f) => {
        census[f] = census[f] || { absent: 0, null: 0, emptyString: 0, placeholderWord: 0, populated: 0 };
        if (!(f in entry)) census[f].absent++;
        else if (entry[f] === null || entry[f] === undefined) census[f].null++;
        else if (typeof entry[f] === 'string' && entry[f].trim() === '') census[f].emptyString++;
        else if (typeof entry[f] === 'string' && PLACEHOLDER_WORDS.has(entry[f].trim().toLowerCase()))
          census[f].placeholderWord++;
        else census[f].populated++;
      });
    });
    report.emptiness[k] = census;
  });
  if (allergyKeys.length) {
    console.log('[probe] Per-field emptiness census (counts only, no values):');
    console.log(JSON.stringify(report.emptiness, null, 2));
  }

  // Structural cross-check only: confirms the CONFIRMED problems[] shape is
  // present in the same payload, so an empty allergy result can be told apart
  // from a wrong/failed response.
  report.problemsPresent = Array.isArray(payload.problems);
  report.problemsCount = Array.isArray(payload.problems) ? payload.problems.length : null;
  console.log('[probe] sanity: problems[] present?', report.problemsPresent, '| count:', report.problemsCount);

  console.log('[probe] Full structure-only report (no clinical values logged):');
  console.log(JSON.stringify(report, null, 2));
  window.__allergyShapeProbe = report;
})();
```

**What to look for**

- An allergy key present with a non-zero `arrayLength` → read the `itemShape`
  and fill in table (a) above with the REAL field names, then move to §4.
- The **emptiness census** answers §1(e) directly: for the reaction-ish field,
  which of `absent` / `null` / `emptyString` / `placeholderWord` is non-zero
  tells Phase 1 exactly what test to write. (`describeShape` alone cannot —
  ported verbatim, it reports `null` as `"object"`.)
- An allergy key present but `arrayLength: 0` on a patient you can see has
  allergies on screen → the card is fed elsewhere; go to DevTools Network.
- No `/allerg/i` key at all, `problems[]` present → confirmed negative, same
  conclusion: DevTools Network capture, no path guessing.
- Fetch failure / `problems[]` absent → the probe, not the finding, is wrong;
  re-check you're on a care-record page.

---

## 3. Probe B — Allergies-card DOM-shape probe

Paste into the Medicus **page console** with the patient's **clinical-summary
tab open and the Allergies card visible**. Finds card containers whose heading
text matches `/allerg/i` and reports the row structure. **PHI-safe: it prints
each row's trimmed text LENGTH, never the text** — card headings and CSS class
names are structural, not patient data.

```js
// ── Allergies-card DOM-shape probe (paste into the Medicus PAGE console) ──
// Clinical-summary tab, Allergies card visible. Prints heading text, the
// row selector structure (tagName + class chain) and each row's text LENGTH
// only — never the row text itself. Confirms (or refutes) that the Allergies
// card uses the same li.item / a.item__link shape as Active Problems, which
// is what the anchor-by-exact-text injection discipline depends on
// (docs/learnings-problem-description-cleanup.md §4).
(function () {
  'use strict';
  const CARD_SELECTOR = '.m-card-v2, [class*="m-card"], [class*="card"], section';
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"], [class*="label"]';
  const ROW_SELECTOR = 'li, [class*="item"], tr';
  const MAX_ROWS = 30;

  // Row granularity: prefer the innermost <li> (the confirmed problems-card
  // level — <li class="item"><a class="item__link">…</a>{date}</li>), because
  // that is the node a widget would attach to. Only fall back to the broader
  // ROW_SELECTOR leaves when the card isn't list-based at all (e.g. a table),
  // otherwise the inner <a class="item__link"> wins the "leaf" test and the
  // li-level structure is never reported.
  function rowsIn(card) {
    const lis = Array.from(card.querySelectorAll('li')).filter((li) => !li.querySelector('li'));
    if (lis.length) return lis;
    return Array.from(card.querySelectorAll(ROW_SELECTOR)).filter((r) => !r.querySelector(ROW_SELECTOR));
  }

  function classChain(el) {
    const parts = [];
    let node = el;
    for (let i = 0; node && node !== document.body && i < 4; i++) {
      const cls = (node.getAttribute && node.getAttribute('class')) || '';
      parts.unshift(node.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\s+/).join('.') : ''));
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
  // Every container with an /allerg/i heading — including nested wrappers and
  // (because a heading's own class can match CARD_SELECTOR) sometimes the
  // heading itself. Rows are counted here so the next step can pick the real
  // card rather than a title wrapper.
  const candidates = [];
  cards.forEach((card) => {
    const heading = Array.from(card.querySelectorAll(HEADING_SELECTOR)).find((h) =>
      /allerg/i.test((h.textContent || '').trim())
    );
    if (!heading) return;
    candidates.push({ card, heading, rows: rowsIn(card) });
  });

  // Keep only the innermost candidate that actually holds rows: drop any
  // candidate that STRICTLY contains another row-bearing candidate. Note
  // Node.contains() is true for the node itself, hence the !== guards —
  // without them a heading matching CARD_SELECTOR rejects its own card.
  const matches = candidates.filter(
    (c) => !candidates.some((o) => o.card !== c.card && c.card.contains(o.card) && o.rows.length > 0)
  );

  if (!matches.length) {
    console.warn(
      '[probe] No card with an /allerg/i heading found.',
      'Check the clinical-summary tab is open and the Allergies card is rendered,',
      'then widen CARD_SELECTOR / HEADING_SELECTOR above rather than guessing the markup.'
    );
    window.__allergyDomProbe = { found: false, cardsScanned: cards.length };
    return;
  }

  const report = matches.map(({ card, heading, rows }) => {
    const headingText = (heading.textContent || '').trim();
    const links = Array.from(card.querySelectorAll('a.item__link, a[class*="item__link"]'));
    const labelledList = card.querySelector('ul[aria-labelledby]');
    return {
      headingText, // card title — structural, not patient data
      headingChain: classChain(heading),
      cardChain: classChain(card),
      listAriaLabelledBy: labelledList ? labelledList.getAttribute('aria-labelledby') : null,
      rowCount: rows.length,
      matchesProblemsShape: links.length > 0,
      itemLinkCount: links.length,
      rows: rows.slice(0, MAX_ROWS).map((r) => ({
        chain: classChain(r),
        textLength: (r.textContent || '').trim().length, // LENGTH ONLY — never the text
        childTags: Array.from(r.children).map(
          (c) => c.tagName.toLowerCase() + (c.className ? '.' + String(c.className).trim().split(/\s+/).join('.') : '')
        ),
      })),
    };
  });

  console.log('[probe] Allergies card(s) found:', report.length);
  report.forEach((r) => {
    console.log(
      `[probe] heading: "${r.headingText}" | rows: ${r.rowCount} | a.item__link present: ${r.matchesProblemsShape}`
    );
    console.log('[probe] card chain:', r.cardChain);
    console.log('[probe] ul[aria-labelledby]:', r.listAriaLabelledBy);
    console.table(
      r.rows.map((row) => ({ chain: row.chain, textLength: row.textLength, children: row.childTags.join(', ') }))
    );
  });
  window.__allergyDomProbe = { found: true, cards: report };
})();
```

**What to look for**

- `matchesProblemsShape: true` and row chains ending `li.item > a.item__link`
  → the Allergies card is the same shape as Active Problems; the
  problem-description-cleanup skeleton ports across with the selectors
  unchanged (plan Phase 3).
- Rows present but no `a.item__link` → the anchor-by-exact-text trick needs a
  different leaf selector; record the actual chain here before writing any
  content script.
- `listAriaLabelledBy` non-null → use it as the card-level trigger anchor, the
  allergy equivalent of `ul[aria-labelledby="problems-major-label"]`. Null →
  the row-relative fallback in `injectRetiredWidgetTrigger()` is the pattern
  to copy.

---

## 4. Capture session — the edit-allergy contract

This is the part that cannot be probed read-only: the contract only reveals
itself when a real edit is performed through Medicus's own UI.

**Tool:** `scripts/document-create-capture.js`, exposed as `chDocCap` — the
same capture tool used unchanged for
`docs/learnings-triage-attachment-to-document.md` and
`docs/learnings-problem-description-cleanup.md`. Read its usage header before
the session; the accurate API is:

| Call                                  | Effect                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| paste the file into the console       | arms it → `[doccap] armed`                                                                                                                 |
| `chDocCap.all()`                      | capture EVERY request (default is document/upload-ish URLs plus all writes — **allergy paths would be missed**, so this is mandatory here) |
| `chDocCap.mark('…')`                  | drop a labelled marker into the timeline                                                                                                   |
| `chDocCap.summary()`                  | deduped endpoint list (method + path) — the first thing to read                                                                            |
| `chDocCap.dump()`                     | full ordered timeline (network + DOM + marks)                                                                                              |
| `chDocCap.copy()` / `chDocCap.save()` | timeline JSON to clipboard / downloaded as `.json`                                                                                         |
| `chDocCap.raw(true)`                  | disable text-body redaction — TEST PATIENT ONLY                                                                                            |
| `chDocCap.filter(reOrFn)`             | custom URL filter (not needed if using `.all()`)                                                                                           |
| `chDocCap.stop()`                     | unwrap and disarm                                                                                                                          |

It is observation-only: it wraps `fetch`/`XMLHttpRequest` to read requests and
responses (the MAIN-world technique from
`content-scripts/triage-lens/page-world.js`), never blocks, rewrites or
replays, and nothing leaves the browser unless you call `.copy()`/`.save()`.
By default a key-based redactor masks patient identifiers (name, DOB, NHS
number, address, postcode, phone, email) by KEY name — note that **allergy
substance and reaction text is NOT a redacted key** (that's deliberate: it is
the contract), so treat the saved timeline as clinical data and pseudonymise
before pasting anything back into this file.

### Checklist

1. Open the patient's **clinical-summary tab** on a record with a genuinely
   scruffy allergy (the same patient used for Probes A and B, ideally). A test
   patient if one exists with a suitable entry; otherwise a real record, and
   keep the timeline local.
2. DevTools → Console. Paste the whole of `scripts/document-create-capture.js`
   → confirm `[doccap] armed`.
3. **`chDocCap.all()`** — non-negotiable. The default `INTEREST_RE` matches
   document/upload/filing paths plus writes; the allergy **prefill GET** and
   **substance search GETs** are reads on unknown paths and would be dropped.
4. `chDocCap.mark('about to open edit allergy')`.
5. Open the allergy entry's own edit form through **Medicus's own UI** — the
   same click path a clinician uses. Do not deep-link a URL.
   → this fires the **prefill GET**. Save it.
6. `chDocCap.mark('typing in substance field')` — then type a few characters
   into the substance/allergen box (even if you intend to leave it unchanged;
   §1c wants this call captured while the session is open).
   → this fires the **search call(s)**. Save every distinct one, with the FULL
   query string including every constraining parameter.
7. `chDocCap.mark('typing in reaction field')` — do the same in the
   reaction/manifestation field. Record whether it is a **free-text input, a
   coded search, or both** (does typing fire a network call at all?). This
   answers Dave's open question and bounds what Phase 4 can write.
8. Make ONE real, intended, clinically-correct edit — ideally **filling in a
   blank reaction**, the exact v1 apply action — and save it through the UI.
   `chDocCap.mark('saved')`.
   → this fires the **save POST**. Save the request body verbatim AND the
   response (status + body; the problem POST returned `200 {}`).
9. `chDocCap.summary()` first (the deduped endpoint list), then
   `chDocCap.dump()`, then `chDocCap.save()`.
10. `chDocCap.stop()`.
11. Re-open the entry (or re-run Probe A) to confirm the change **stuck**, and
    record what the value looks like afterwards — the problem doc's
    end-to-end confirmation step.

### Two questions to answer explicitly from the capture

- **Option-object fields (the §3b trap).** Diff the prefill GET against the
  save POST field by field. Any field the GET returns as `{value, label}` but
  the POST sends as a bare scalar goes on a list here, by name. Assume there
  is at least one (allergy forms are select-heavy: severity, certainty,
  reaction type, status, reason-ended). A field that happens to be `null` in
  this one capture is **not** evidence it isn't an option object — that is
  precisely how `episode` slipped through and produced a live 400 months
  later; note any null-in-this-capture select field as unconfirmed rather than
  clean.
- **Full-replace vs patch.** Does the POST body contain every field the
  prefill returned, or only the changed one? Record the answer explicitly.
  Until it is captured, Phase 4 assumes **full replace** (the confirmed
  problem behaviour) — GET the prefill, round-trip every other field
  untouched, change only the clinician-chosen ones. Also record which
  recorded-by branch is required (`recordedByOrganisation` +
  `recordedByPractitioner` vs `recordedByStaff`) and how it keys off
  `recordedAtAnotherOrganisation` — and note that on problems,
  `recordedByOrganisation` can legitimately be `null` even when
  `recordedAtAnotherOrganisation` is `true`; round-trip the null, don't invent
  an organisation.

---

## 5. What this will unblock

| Answer from Phase 0                                                                     | Unblocks                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) allergy array location + field names for reaction/severity/status/dates/recorded-by | **Phase 1 detection** — `looksOutdated()`'s allergy analogue: "missing reaction" tested against the real empty-shape (absent key vs `null` vs `""` vs `"Unknown"`), and provenance-gap detection keyed off the real recorded-by / `recordedAtAnotherOrganisation` fields |
| (a) the substance description field name                                                | **Phase 1 + 2** — the label passed to `shared/legacy-coded-description.js` (reused unchanged) and normalised by `engine/allergy-evidence.js` before the journal trawl                                                                                                    |
| (e) what "untidy" really looks like                                                     | **Phase 1 heuristics written against captured examples, not guesses** — and it partly answers Dave's "GP2GP imports vs never-filled-in" question, which sets detection priority                                                                                          |
| (d) Allergies card DOM shape                                                            | **Phase 3 UI** — whether the problem-description-cleanup skeleton (anchor-by-exact-text on `a.item__link`, observer hub, own-mutation filter, 400 ms throttle, de-dupe, prepend) ports across unchanged, and what the card-level "Check allergies?" trigger anchors to   |
| (b) prefill GET path + full payload                                                     | **Phase 4 apply** — the round-trip source; without it there is no safe write at all                                                                                                                                                                                      |
| (b) save POST path + full-replace-vs-patch + option-object field list                   | **Phase 4 apply** — `buildEditAllergyPayload`'s shape and its `unwrapOptionValue()` flatten list; the difference between a working apply and a bare 400                                                                                                                  |
| (b) reaction coded vs free-text vs both                                                 | **Phase 4 apply scope** — determines whether "fill in the reaction" writes a code, a string, or both, and what the evidence panel can offer the clinician                                                                                                                |
| (c) substance search endpoint                                                           | **Not v1** (safety rule 2: never change the substance code). Recorded for a later description-tidy phase, which would additionally need the drug-allergy-rule regression guard described in the plan                                                                     |

Phase 2 (`engine/allergy-evidence.js`, the notes trawl) is **not blocked by
this session** — the journal API is already fully mapped
(`docs/learnings-patient-journal-api.md`) and the walker exists
(`engine/record-duplicate-parser.js`). It needs only the normalised allergy
label from (a), so it can be built in parallel against fixtures once the field
name is known.

---

## 6. What is NOT confirmed (running list — update as the session answers them)

- Everything in §1. No allergy endpoint, field name, option-object field or
  DOM selector in this document has been observed live.
- Whether the Allergies card is even fed by `clinical-summary/summary` at all.
- Whether an allergy entry carries a `descriptionId`-style degraded-code
  signal equivalent to the problem one.
- Whether the substance search is SNOMED-constrained (and with which parent
  concepts) or dm+d for drug allergies.
- Whether the reaction is coded, free-text, or both.
- Whether the save is a full replace (assumed, by the problem precedent) or a
  patch.
