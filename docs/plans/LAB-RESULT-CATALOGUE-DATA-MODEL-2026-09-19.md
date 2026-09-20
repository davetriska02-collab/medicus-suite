# Lab Result Catalogue — data model

**Status:** DRAFT v0.5 (Phase A implemented — see §11) — 2026-09-19 (v0.2/v0.3 fold in Nick's first review: group↔request is many-to-many;
outstanding-request completion is request-set based, not per-report; ordering systems; shared-folder "seen results"; no co-request time window; plain-English
notes; v0.4: **a partial group clears its request and shared results are optional** — the completeness/waiver machinery
from v0.2/0.3 is removed, kept only as a fallback in §12). Design only; nothing in this document is built.
**Branch:** `feat/lab-filing-analyte-scoping`
**Scope of the first build:** the catalogue **alone**, alongside (not replacing) today's Lab Filing profiles and Outstanding
Investigation matcher. Consumers are migrated in later, separately-reviewed phases (§11).

> **Why this exists.** Lab Filing and the Outstanding Investigations matcher each keep their own private, hand-typed
> vocabulary of "which results belong to which test", matched by free text with different rules. The Bone-profile
> profile fires on a faecal-calprotectin report because `alp` is a substring of "calprotectin". This document defines
> one shared, coded, lab-aware, per-practice catalogue that both can use.

---

## 1. Vocabulary (agreed)

| Term | Meaning | Where it appears |
|---|---|---|
| **Request** | What the practice ordered. A line on Medicus's "Outstanding Investigation Requests" card, e.g. `Bone Profile (Calcium Studies)`. Also feeds the Companion app's outstanding-requests view. | `data.outstandingInvestigationRequestOptions[].label` |
| **Report** | The lab's whole message (arrives as XML; stored raw somewhere in Medicus — parked, §12). One report holds **one or more groups**, so it does **not** map 1:1 to a request; it holds *components* of one or more requests. | `data.investigationReport` |
| **Group** | A complete or partial set of results for **a part of a request — and possibly parts of several requests** — under a heading the *lab* chose (`Bone profile`, `LFTs`, `Renal function tests`, `TSH`). May be absent (results can be *ungrouped*). | `investigationGroups[].description` |
| **Result** | One measured/reported thing (preferred over "analyte"). Several results can come from a single sample (usually microbiology). Carries a SNOMED `resultCode`. | `results[]`, `ungroupedResults[]` |
| **Investigation** *(catalogue term)* | The clinical test as the practice thinks of it — "Bone profile", "LFTs", "HbA1c" — the thing a request asks for and a group (usually) delivers. | new |
| **Lab** *(catalogue term)* | A performing laboratory/department, identified from the report itself. | `investigationReport.performer` |

A request is answered by **one or more groups, possibly in one or more reports**; a group is delivered under a
lab-specific heading; results inside it are identified by **code first**, name second.

**Group ↔ request is many-to-many.** A result such as gamma-GT can be requested on its own, or as part of LFTs, and may
then arrive *inside another request's group* (`LFTs` = ALT + bilirubin + GGT). ALP is delivered under `Bone profile` or
`LFTs` depending on what else was ordered. So **a heading never identifies "the" request**: it identifies a *set of
candidate investigations*, and results — identified by code — are what actually satisfy requests.

## 2. What the real data taught us (evidence behind the design)

From nine scrubbed HARs (135–142): eight investigation-report tasks from **one lab** (RJ700 / General Pathology) plus
the practice's exported rulesets (9 lab-filing profiles, 81 custom investigation entries, 59 result rules) and the TRUD
PCD refset file (20260717).

1. **Every result is coded** (`resultCode.conceptId`, an NHS pathology *observable entity*); none degraded; the same
   analyte has the same code across reports. Today's code ignores it.
2. **Group membership is request-dependent, even within one lab.** ALP arrives under "Bone profile" (135) *or* "LFTs"
   (137); the LFT group is `bilirubin + ALT` in 135 but `albumin + bilirubin + ALP + ALT` in 137.
3. **Group headings vary for the same test:** "U&Es" (136, no potassium) vs "Renal function tests" (135/137, with).
4. **Single tests arrive two ways:** a group named after the test ("TSH", "Se CA 125 level", "CALPROTECTIN (FAECAL)")
   *or* ungrouped (magnesium, vitamin D, CRP). 49 of the practice's 81 entries have `rep == analyte`.
5. **A `text-result` is not a result.** The TSH "result" in 135 is the lab's message *"This test has already been
   performed recently (within 14 days)…"*; eGFR "EGFR not applicable in children". Today's outstanding matcher counts
   the TSH text as covering a TSH request.
6. **Three name layers on a result:** `description` = lab-local display name (`ALP`); `resultCode.description` = the
   coded-test text the lab sent (`Serum alkaline phosphatase`, `Calculated LDL cholesterol lev` — a 30-char legacy
   synonym of the *procedure* concept 395065005, while Medicus attaches the *observable* 1014501000000104); the
   concept's real SNOMED descriptions (termbrowser). **We store our own canonical names and never trust
   `resultCode.description`.**
7. **Request labels are not lab text and not SNOMED** (request `CA 12-5` ↔ result `Se CA 125 level`). Their origin
   (Medicus catalogue vs an ordering system) is unconfirmed (§12).
8. **The same generic result name is reused across specimens:** `Culture` is the result for five microbiology entries
   (throat / nose / mouth / genital / sputum). Only the group heading separates them — scoping is not optional.
9. **Refsets are purpose sets, not panels.** `FBC_COD` has Hb, MCV, RBC, WBC but not platelets/MCH/MCHC/neutrophils;
   `UE_COD` has sodium, potassium but not urea; 18 of 45 real result codes are in no cluster. Refsets are an
   *attribute* of a result ("counts for QOF / future-action rules"), never the definition of a panel.
10. **HbA1c is a code family:** only the three IFCC concepts are in `IFCCHBAM_COD` (QOF Diabetes / Mental health /
    NDH); the DCCT (%) concept is `DCCTHBA1C_COD` = PHSMI only; the parent and two non-IFCC range concepts are in no
    cluster. Labs may use any of them.
11. **The practice's own ruleset is the seed.** Its problems (duplicates, `RAST` request split on commas, typos, 8
    entries with no heading) are exactly what structured authoring must prevent (§7).
12. **Today's outstanding matcher has no completeness check.** Tested on real report data: a group titled `LFTs` holding
    only bilirubin + ALT → *resulted / confident / auto-tick*; a `Bone profile` group **without** ALP → resulted /
    confident; **ALP alone under an `LFTs` heading → LFT resulted / confident / auto-tick**. It never fails for want of a
    shared analyte, and **a partial group clearing its request is the intended behaviour** (Nick, confirmed 2026-09-19) — so
    the catalogue keeps today's clearing semantics and only improves how results are *recognised* (§5.1).
13. **Ordering systems differ by pathway** (Richmond): SWL Pathology (orders via **tQuest**; RJ700), Ashford (**ICE**),
    and some practices can also see West Middlesex results (**ICE**). Request names therefore probably belong to the
    *ordering system's* catalogue, not to Medicus or the lab (unverified — §12).
14. **At this lab Free T4 arrives as its own group** (both samples that carried TSH and FT4).

## 3. Design principles

1. **Codes first for results, text second.** A coded match beats any text match. Text aliases exist for uncoded
   results and for *requests* (which are not in SNOMED).
2. **Scope by group.** A text alias only matches inside a group whose heading's *candidate set* (`mayContain`) includes an
   investigation that lists that result. Unscoped text matching is never used to *file* anything.
3. **A result is not an investigation member by name.** Identity (`results`) is separate from membership
   (`investigations[].members`). ALP is one result, a member of LFTs *and* Bone profile.
4. **Per practice, linked to a named lab, portable.** Every non-built-in entry records who/where/when it came from, so
   a central store can be added later without re-authoring (§8).
5. **Fail closed.** Anything that does not resolve confidently blocks filing and leaves requests outstanding.
6. **Local approval.** Imported/shared definitions arrive **unreviewed and inert**; a person approves them on the
   machine that will act on them (same doctrine as today's filing profiles, H-073).
7. **Thresholds and filing behaviour do not live here.** Ranges, allowed comments, trend limits and commit mode stay in
   the practice-authored filing profile; the catalogue says *what a result is*, the profile says *what to do with it*.
8. **Stable identifiers.** IDs are slugs that are never derived from labels and never reused (retired-key list, as
   `retiredOirKeys` does today).

## 4. Entities

Everything below is JSON, validated by a pure validator, versioned by `schema`.

### 4.1 Practice context (one record)

```json
{
  "practice": {
    "icb": "NHS South West London",
    "icbCode": null,
    "borough": "Richmond",
    "labs": ["rj700-general-pathology"],
    "orderingSystems": ["tquest"]
  }
}
```

* `icb` / `borough` are recorded as given (per the practice). `icbCode` (ODS) to be confirmed at build.
* `orderingSystems` — the systems requests are placed in (`tquest` for SWL Pathology; `ice` for Ashford / West
  Middlesex). A practice may use several; request-name vocabulary is tagged by ordering system (§4.4).
* Richmond practices use either SWL Pathology (order via tQuest) or Ashford (ICE), and some can also view West Middlesex
  (ICE) results — so **one practice can have more than one lab and more than one ordering system**.
* Six boroughs and several labs sit inside NHS SWL, so **borough does not identify the lab** — the *report* does
  (§4.3). Borough exists to (a) suggest labs to a new user and (b) scope central-store packs later.
* Behaviour outside SWL is **unverified** and must be labelled as such wherever it is surfaced.

### 4.2 Result definition (`results[]`)

The identity of a measured thing, independent of any panel.

```json
{
  "id": "alp",
  "label": "Alkaline phosphatase",
  "codes": [
    { "system": "snomed", "conceptId": "1000621000000104", "role": "primary",
      "refsets": ["LFT_COD"], "unit": "u/L" }
  ],
  "aliases": [
    { "text": "ALP", "lab": "rj700-general-pathology" },
    { "text": "alkaline phosphatase" }
  ],
  "excludeAliases": [],
  "valueKind": "numeric",
  "provenance": { "source": "builtin" }
}
```

* `codes[]` — one or **many**. `role`: `primary` | `alternate`. `refsets` = PCD cluster ids the concept belongs to;
  **"counts for QOF" is derived** from the PCD file at build/refresh time (cluster → services), never hand-typed.
  `unit` is per code (IFCC HbA1c mmol/mol vs DCCT %).
* `aliases[]` — text as labs send it. An alias may be tagged with a `lab` (lab-local display names such as `ALP`) or be
  lab-neutral. Matched **token-bounded** (whole tokens/token runs), never substring, and only within scope (§5).
* `valueKind` — `numeric` | `text` | `coded` | `mixed`. Drives the "has a value" rule (§5.4).
* Legacy/truncated coded-test text seen on real reports (`Calculated LDL cholesterol lev`) is stored as an alias so
  uncoded arrivals still resolve, but it is *not* used as the canonical label.

### 4.3 Lab definition (`labs[]`)

Lab-specific vocabulary: how *this* lab headings and names things.

```json
{
  "id": "rj700-general-pathology",
  "name": "General Pathology (RJ700)",
  "identifiers": { "performerOrg": "RJ700", "department": "General Pathology" },
  "structured": true,
  "orderingSystem": "tquest",
  "groupHeadings": [
    { "text": "Bone profile",         "identifies": ["bone-profile"] },
    { "text": "LFTs",                 "identifies": ["lft"], "mayContain": ["inv:ggt"] },
    { "text": "Renal function tests", "identifies": ["ue"] },
    { "text": "U&Es",                 "identifies": ["ue"] },
    { "text": "TSH",                  "identifies": ["tft"] },
    { "text": "FREE T4",              "identifies": ["free-t4"], "mayContain": ["inv:tft"] }
  ],
  "provenance": { "source": "practice", "observedIn": ["135", "136", "137"] }
}
```

* **A heading yields a SET of candidates, not one request.** Two fields (both optional, at least one expected):
  * `identifies` — the investigation(s) the heading *names*: a group under this heading answers them **by heading
    alone** (`LFTs` identifies `lft`). This is what makes a **partial group clear its request**.
  * `mayContain` — investigations (`"inv:<id>"`) or individual results (`"res:<id>"`) the group is *allowed to carry*
    without being the heading's subject (`LFTs` may carry `ggt`, because GGT can be requested alone or with LFTs).
    Being in `mayContain` scopes and attributes a result; it **never clears a request by itself** — a GGT request is only
    covered when a GGT *result* is present. The explicit `inv:` / `res:` prefix removes any id ambiguity.
  Every member of an identified/may-contain investigation is implicitly in scope, so a lab that puts ALP under `LFTs`
  sometimes and `Bone profile` other times needs no special case.

* Identified automatically from `investigationReport.performer.organisationName` (+ `departmentName`); a user is
  *asked to confirm* the suggestion (§8). Unknown lab → the generic (lab-neutral) entries only, resolved at lower
  confidence.
* `groupHeadings` maps a heading to an investigation. Headings are matched token-bounded and case-insensitively.
* Only one lab sends structured reports to this practice today; a second is being sought.

### 4.4 Investigation (`investigations[]`)

The clinical test: what a request asks for and a group delivers.

```json
{
  "id": "lft",
  "label": "Liver function tests",
  "kind": "blood",
  "requestAliases": [
    { "text": "Liver Function", "system": "tquest" },
    { "text": "LFT",            "system": "any" }
  ],
  "members": [
    { "result": "alt",             "role": "core" },
    { "result": "bilirubin-total", "role": "core" },
    { "result": "alp",             "role": "shared" },
    { "result": "albumin",         "role": "shared" },
    { "result": "ggt",             "role": "optional" }
  ],
  "note": "Standard liver profile. ALP and albumin are also reported under Bone profile when both are ordered.",
  "provenance": { "source": "builtin" }
}
```

* `requestAliases[]` — the text on the **request card**, **tagged by ordering system** (`tquest` | `ice` | `medicus` |
  `any`): the same clinical test has different request names in tQuest and ICE, and that vocabulary belongs to the
  ordering system, not to the lab or SNOMED. Token-bounded, with `exclude` terms (e.g. `urine` for a blood U&E), exactly
  the safeguards `outstanding-match.js` has today.
* `note` — an optional short **plain-English description** shown on the Investigations settings page and in confirm
  dialogs (also available on results and labs). Never used for matching.
* `members[].role`:
  * `core` — the results that *identify* this test: used to recognise it (signature / anchor thresholds, attribution)
    and, for a single-result test, its sole identifying result.
  * `shared` — belongs here **and** to another investigation (ALP ∈ LFTs, Bone). Used for attribution and scoping only.
  * `optional` — may appear (Free T4 as an add-on to thyroid; GGT within LFTs).
  * **No role is *required for a request to clear*.** Decision (Nick, 2026-09-19): a partial group clears its request
    (as today's matcher does), and `shared` results are treated as optional. An LFT without ALP does not stay outstanding.
    This can be tightened later (§12) because no abnormal result is hidden by it — abnormal values are flagged by the result
    rules regardless of what the request-clearing logic does.
* **Many-to-many with groups.** GGT is *both* its own investigation (`ggt`, one `core` member — requested alone, it can
  arrive in a `GGT` group, or inside `LFTs` if LFTs were requested too) *and* an `optional` member of `lft`. Which group a
  result lands in never changes which request it satisfies.
* `kind` — `blood` | `microbiology` | `imaging` | `procedure` | `other`. Imaging/histology entries carry no result
  members (as today: `US Liver`, `Cervical screening`).
* `headingAliases[]` — lab-**neutral** heading text (the investigation's label is implicitly one too), used when the lab
  has no entry for a heading. `exclude[]` (e.g. `urine`) applies to request text *and* headings.
* `members[].anchor` — a `core` member that on its own identifies the test (TSH for thyroid: labs reflex-test).
* `legacyKey` — the matching key in today's `TEST_DEFS` (`bone-profile` ↔ `bone`), so Phase D can prove parity.
* ~~`extends`~~ — **dropped for now**: "WITH / WITHOUT potassium" needs no separate model because a partial group clears
  its request (`ue` simply lists potassium as a member).
* A single-result test is just an investigation with one `core` member (`singleResult` is *derived*, not stored).
* Free T4 is **both** its own investigation (`free-t4`) **and** an `optional` member of `thyroid` — requested separately
  or added on, both valid.

### 4.5 Provenance and lifecycle (every entry)

```json
{ "source": "builtin | practice | shared | imported",
  "packId": null, "packVersion": null,
  "createdAt": "2026-09-19", "reviewed": false, "reviewedBy": null,
  "retired": false, "supersededBy": null }
```

* `source: shared/imported` entries arrive `reviewed:false` and are **inert** until approved locally.
* `retired` ids are kept in a tombstone list so an id is never reused.

### 4.6 "Seen results" (practice-wide, in the shared folder)

Testing and daily use will surface results the catalogue has no entry for (microbiology especially — much of it is not
yet modelled). The suite **counts them, in the practice's shared folder** (PCs change often; this data should live in
one place), so authoring can be guided by what actually arrives:

```json
{ "labcatalogue.seen": [
  { "lab": "rj700-general-pathology",
    "code": "1002571000000102",
    "name": "Faecal Calprotectin",
    "heading": "CALPROTECTIN (FAECAL)",
    "valueKind": "numeric",
    "resolvedAs": null,
    "count": 12, "firstSeen": "2026-09", "lastSeen": "2026-09" } ] }
```

* Stores **names, codes, headings, value *kind* and a count** — never values, patient ids, task ids or exact dates
  (month precision). Nothing here is patient data.
* **Source of truth = the shared folder; each PC keeps only a small local transit buffer.** A Medicus tab (content script)
  cannot write to a shared file — writing needs a page context (options page / side panel) holding a granted file handle,
  never a service worker, and never a permission prompt from a background cycle. So a PC accumulates a bounded local
  *delta* and flushes it from a page context; a lapsed grant surfaces as a "Reconnect" affordance, exactly as the existing
  Cleanup-Code-Preferences contribution does (`shared/io/pdc-contribute.js`: contributes this machine's tallies into the
  shared profile, re-reads immediately before writing and aborts/retries if the file moved, no-ops when nothing changed,
  daily cadence). Only the unflushed delta is lost if a PC is replaced.
* **Merge semantics:** add the local delta to the shared count under that optimistic-concurrency guard, clear the local
  delta only after a confirmed write, keep `firstSeen = min`, `lastSeen = max`. Counts are **approximate by design** (a
  crash between write and clear can double-count) — the store guides authoring, it does not drive behaviour.
* **Where in the shared folder** (decided, §13.8): (A) as a module inside the existing practice-profile file,
  reusing the contribution machinery and the existing handle — no new permission grant, but every flush bumps
  `profileVersion` (mitigated by a daily cadence and no-op-when-unchanged); or (B) a separate `lab-seen-results.json`
  with its own handle — no profile churn, but one more folder grant per PC. **Decided: A first, move to B once A is tested
  and working.**
* Bounded (cap + least-recently-seen eviction) so the file cannot grow without limit.
* Feeds the Investigations page ("12 results seen with no definition") and, later, the **deferred** "offer to create an
  entry" prompt. Nothing acts on it automatically.

## 5. Resolution (the pure resolver — the only new logic)

`resolveReport(catalogue, normalisedReport) → Resolution` — no DOM, no network, no storage; unit-testable in Node.

1. **Identify the lab** from `performer` → lab definition, or `null` (generic only).
2. **Resolve each result**, in order, first hit wins:
   1. **By code** — `resultCode.conceptId` ∈ some result's `codes[]` → confidence `coded`.
   2. **By alias, in scope** — result name equals/token-matches an alias of a result that its *group heading* may
      contain (`mayContain`, directly or via an investigation it lists) → `alias-in-scope`.
   3. **By alias, unscoped** — matches a result alias somewhere → `alias-unscoped` (**never sufficient to file**;
      usable only for advisory display).
   4. Otherwise `unresolved` (and counted in the shared "seen results" store, §4.6).
3. **Resolve each group heading to a *set* of candidate investigations** (never a single one): via
   `lab.groupHeadings[].mayContain`, else lab-neutral heading aliases, else **infer** from the resolved members
   (distinctive results ≥ threshold, anchors — the existing `reportCoverage` idea) → heading confidence `heading` |
   `inferred`. A heading with no match is **unmapped**, and its results are still resolved individually by code.
   *Ungrouped results* have no heading: they resolve by code (or a lab alias) to a result, and to investigations through
   the investigations that list that result as a member (magnesium, vitamin D, CRP: sole `core` member).
4. **Attribute results to investigations by membership, not by heading.** Result *r* in group *g* is attributed to every
   investigation *I* where *r* ∈ members(*I*) **and** *I* ∈ candidates(*g*) (or *g* is unmapped and *I* is inferred).
   This is what makes group ↔ request many-to-many work: GGT inside an `LFTs` group is attributed to `ggt` *and* `lft`.
5. **Value rule.** A result has `hasValue = true` only if `resultType` is numeric with a value (or an accepted coded
   value). A `text-result` with no value is `hasValue:false` and is surfaced as **"lab message"** (TSH "already
   performed recently", eGFR "not applicable in children"). It always **blocks filing**. For an *outstanding request* it **still clears** (decided, Nick 2026-09-19 — the lab has
   answered and will not issue a value), but coverage carries `labMessageOnly` and each message is classified so a
   consumer can warn: `sample-problem` ("dropped", "wrong bottle", "haemolysed" — the test may need **repeating**),
   `already-done`, `not-applicable`, `other`.
6. **Output:** per result `{ resultId, confidence, hasValue, valueKind, attributedTo:[investigationId…] }`; per group
   `{ candidates:[…], headingConfidence }`; per report the set of resolved `resultId`s **with a value**.

### 5.1 How the two first consumers would use it (later phases)

* **Auto-filing (Phase E):** a filing profile is linked to investigation ids. It applies to a report only if some group's
  candidate set contains one of its investigations at `heading` confidence. **Every result in the report** must be
  `coded` or `alias-in-scope`, have a value, and be attributed to at least one investigation that (a) is a candidate of
  its group and (b) is covered by an enabled, reviewed profile — otherwise the whole task **blocks**. (`optional` members
  — GGT inside `LFTs` — are covered by the `lft` profile; a lone GGT group needs the `ggt` profile.) Filing needs
  **no completeness rule**: it only ever files what is present and recognised. This subsumes today's H-074
  unrecognised-analyte gate.
* **Outstanding requests (Phase D): today's clearing semantics, with better inputs.** Decided with Nick:
  1. A card line resolves to an investigation via `requestAliases` (+`exclude`, ordering-system aware).
  2. It is *covered* by the report when (a) some group heading's candidate set contains that investigation
     (`confident`), or (b) the results attributed to the investigation include enough identifying (`core`) results —
     one for a single-result test or an anchor, otherwise two (`confident`); fewer → `tentative` (shown, not
     auto-ticked). These are today's thresholds.
  3. **A partial group clears its request.** `LFTs` with bilirubin + ALT and no ALP clears LFT; `Bone profile` without
     ALP clears Bone; ALP alone under an `LFTs` heading clears LFT. Bob's two separate reports each clear their own
     request. **Correct as intended — not a defect.**
  4. **Every request line for that investigation that predates the sample clears together** (the card's stale duplicates —
     Liver Function ×3, Urine ACR ×4 …), exactly as today (`requestedDate ≤ sample`).
  5. The improvement is confined to **how results are recognised**: coded identity instead of substring text, group
     scoping, ordering-system-aware request names, and results that today are "not recognised" (magnesium, urine ACR,
     vitamin D). It changes **what is recognised**, not **what clears**.
  6. The earlier waiver / `partial`-state design is **not needed** and is recorded as a fallback in §12.
  Behaviour on today's `test-outstanding-match.js` expectations must be reproduced (or each intended change explicitly
  approved) before Phase D is accepted.

### 5.2 Cross-report accumulation (failsafe note only)

With clear-on-partial, a panel split across two reports needs no accumulation: the first report that carries any of its
results clears the request, and the second finds nothing left to clear. Accumulation (remembering the results already
received for the same sample across the patient's reports) would only matter **if a completeness rule is added later** —
e.g. a bone profile with calcium in report 1 and phosphate in report 2, judged report by report, would never complete.
Recorded so the fallback design (§12) is ready; not built.

## 6. Worked examples (real data)

**A. FBC (report 140).** Group `FBC` → lab heading → `fbc`. 15 results all `coded` (Hb 1022431000000105, WBC
1022541000000102 …). `FBC_COD` contains only some of them (Hb, MCV, RBC, WBC) — recorded on those results as `refsets`,
not used to decide membership. A profile for `fbc` must see every one of the 15 recognised; the practice's current FBC
profile lists 16 names.

**B. LFT vs Bone, shared ALP (reports 135 and 137).** ALP (`1000621000000104`) is one result, `shared` in both
investigations. In 135 the card has LFT and Bone ordered together: group `Bone profile` (albumin, ALP, calcium, adjusted
calcium, phosphate) clears Bone; group `LFTs` (bilirubin, ALT) clears LFT **even though it has no ALP** — as today. In 137
the same lab puts ALP/albumin under `LFTs` with no Bone group; LFT clears, nothing else changes. ALP is never required.

**B2. Bob's two separate reports.** Report 1 = `LFTs` (bilirubin + ALT); report 2 = `Bone profile` (no ALP). Each clears
its own request; neither is held back. (A completeness rule would have made each fail on the shared results it lacks —
which is why shared results are optional and the waiver design is only a fallback, §12.)

**B3. GGT requested separately, or inside LFTs.** `ggt` is its own single-result investigation *and* an `optional` member
of `lft`. Ordered alone it may arrive as a `GGT` group or as a lone result; ordered with LFTs it arrives inside `LFTs`.
`LFTs.mayContain` includes `ggt`, so the result is recognised in either place, attributed to `ggt` (and `lft`), and the
`ggt` request is satisfied by that result *wherever it sits*. A group therefore never "belongs" to one request.

**C. TSH text-result (report 135).** Group `TSH`, result TSH resolved by code `1022791000000101`, `resultType`
`text-result`, no value → `hasValue:false`, shown as a **lab message** ("already performed recently… previous TSH 2.70").
For **filing** any profile **blocks**. The **outstanding** TSH request still **clears** (decided), flagged `labMessageOnly` / `already-done`. Had the message been
"sample dropped" or "wrong bottle sent" it would clear the same way but be classified `sample-problem` so the clinician is
told it may need repeating.

**D. Calprotectin vs Bone (report 141 — the reported bug).** The single result `Faecal Calprotectin`
(`1002571000000102`) resolves by code to `faecal-calprotectin` → investigation `calprotectin`. The Bone profile is not
selected because no group resolves to `bone-profile`; there is no text match at all, so `alp ⊂ calprotectin` cannot arise.

**E. Urine ACR (report 138).** `Urine creatinine`, `Urine microalbumin`, `Urine ACR` resolve by code
(`1003271000000106`, `1010251000000109`, `1023491000000104`) to *urine* results, members of `urine-acr`. They are not
serum `creatinine`/`albumin`, so neither the U&E nor Bone profile can be selected (today both are, by shared terms).

**F. Microbiology `Culture`.** Result `culture` is a member of `throat-swab`, `nose-swab`, `mouth-swab`, `genital-swab`,
`sputum` … The **group heading** (`THROAT SWAB`, `NOSE SWAB`) is the only discriminator; step 3 resolves the heading, and
the practice's existing `specimen`-scoped result rules already assume exactly this.

**G. HbA1c (report 142).** One group `HbA1c`, one result coded `999791000000106`:

```json
{ "id": "hba1c", "label": "HbA1c", "valueKind": "numeric",
  "codes": [
    { "conceptId": "999791000000106",  "role": "primary",   "unit": "mmol/mol", "refsets": ["IFCCHBAM_COD"] },
    { "conceptId": "1049301000000100", "role": "alternate", "unit": "mmol/mol", "refsets": ["IFCCHBAM_COD"] },
    { "conceptId": "1049321000000109", "role": "alternate", "unit": "mmol/mol", "refsets": ["IFCCHBAM_COD"] },
    { "conceptId": "1019431000000105", "role": "alternate", "unit": "%",        "refsets": ["DCCTHBA1C_COD"] }
  ] }
```

`derived.services` (computed, not stored): the IFCC concepts → QOF Diabetes / Mental health / NDH; the DCCT concept →
PHSMI only. The request card text `HbA1C (Glycated Haemoglobin)` resolves through `requestAliases` (text), the
result through the code — the two vocabularies meet only at the investigation. No hand-listed "glycated / glycosylated /
haemoglobin a1c" result synonyms are needed for coded arrivals.

**H. Ungrouped single results (135/136/137).** `Serum magnesium level`, `Serum 25-HO vit D3 level`, `CRP` have no
group. Each resolves by code; each is the sole `core` member of `magnesium` / `vitamin-d` / `crp`, so a
`Magnesium Blood` request is recognised (today: "request test not recognised").

## 7. Seeding from the practice's existing rules (import mapping)

An import wizard (Phase C) turns the practice's current data into *unreviewed* catalogue entries — nothing is re-typed.

| Existing item | Becomes |
|---|---|
| `oirTests[].req` | `investigations[].requestAliases` (**request-side, not comma-split** — the `RAST mixed foods (egg, milk, …)` entry was split into 6 fragments by the current editor; the importer re-joins by detecting fragments that only close a bracket) |
| `oirTests[].rep` | `labs[rj700].groupHeadings` → the investigation |
| `oirTests[].analytes` | `results[].aliases` tagged `lab: rj700`, **enriched with codes** wherever the same name appears in a captured report (≈45 codes are already known from the HAR corpus) |
| `oirTests[].singleAnalyte` | derived (one `core` member), not stored |
| duplicates (`vitd`/`vitamin_d`, `iron`/`iron_binding`, `lipase` keyed `amylase`, `cervical screening` ×2) | merged into one investigation; the importer lists each merge for review |
| `labfiling.profiles[]` | left **as is**; linked to the investigation(s) they cover in Phase E (`match[]` becomes derived, not authored) |
| results with no known code | stay alias-only (`confidence` capped at `alias-in-scope`) until a report supplies a code |

Counts on the real export: 81 custom entries (13 extend a built-in key, 68 new); 26 built-in defs; 8 entries have no
heading; 1 has no analytes. The importer produces a review list, not an auto-apply.

## 8. Storage, backup and distribution

* **Shipped defaults:** `rules/lab-catalogue.json` (built-in results/investigations seeded from `TEST_DEFS` and the HAR
  corpus; generic, lab-neutral). Data file from the start.
* **Per-practice overlay:** `chrome.storage.local` — `labcatalogue.practice` (context, labs, practice entries, retired
  ids) and `labcatalogue.config`. **Merge is append-only on built-ins** (same safety rule as `mergeTestDefs`): a practice
  can add codes/aliases/members, never remove a built-in term; `disabled` is a fail-safe (the thing simply stops being
  recognised → requests stay outstanding, filing blocks).
* **Backup:** a brand-new module with its own keys, so the CLAUDE.md convention applies in full —
  `shared/io/labcatalogue-io.js` (`labcatalogueExport/Import`), `VALID_SCOPES`, `doFullExport`/`applyEnvelope`,
  `previewEnvelope`, options.html script + export card. Import validates, drops `__proto__`/`constructor`, and forces
  every imported non-built-in entry to `reviewed:false` (never carries approvals).
* **Practice-wide sync:** a new module in the existing `shared/io/practice-profile.js` channel (as `labfiling` did),
  arriving unreviewed.
* **Central store (deferred):** a portable **pack** —
  `{ packId, version, area:{ icb, borough? }, lab, entries:[…], signature? }` — that a practice imports as unreviewed
  local entries. Because every entry already carries `source`/`packId` and lab/area scope, nothing has to be re-authored.
* **Lab prompt:** on first sight of a `performer` the UI shows "This report is from **RJ700 General Pathology** — is this
  the lab you use?" and records the answer; borough is used only to *suggest* candidates.

## 9. Safety framing (for the eventual hazard log — not yet raised)

* **Hazard:** a false match causes a wrong auto-file (a non-normal result filed as normal) or a wrongly-cleared
  outstanding request.
* **Controls in the model:** coded-first identity; group-scoped text; value rule (a lab message is never a result);
  clear-on-partial semantics preserved from today (no new way for a request to stay outstanding), shared results optional
  (no abnormal result is hidden — result rules still flag abnormal values); fail-closed unresolved handling;
  append-only built-ins; imported entries inert until approved on the acting machine; QOF flags *derived* from the PCD
  refsets, not typed; explicit "unverified outside SWL" labelling.
* **Residual risks to review:** a wrong code in a shipped or shared entry (mitigated by a golden corpus and a
  refset/termbrowser cross-check test); a lab that re-codes results; degraded codes
  (`hasUnresolvedDegradedTypeCode`) on other labs; a request alias that is too broad.
* A hazard-log entry and CSO review accompany the **first phase that changes behaviour** (Phase D or E), not the
  catalogue-only build.

## 10. Testing

* **Golden corpus:** the scrubbed HARs (135–142) become fixtures — report + expected resolution — including the
  adversarial cases: `alp`/calprotectin, `alt`/`salt`, `ast`/elastase, albumin/microalbumin, urine vs serum creatinine,
  text-result TSH/eGFR, ungrouped magnesium, `Culture` under different headings, request `WITH`/`WITHOUT` potassium.
* **Catalogue validation tests** (like `test-drug-brand-coverage.js`): unique ids; no concept claimed as `primary` by two
  results; every member references an existing result; every code exists and is active (termbrowser snapshot);
  refset ids exist in the PCD file; aliases contain no bare 1–3 character token unless lab-scoped.
* **Resolver tests:** pure Node, table-driven from the corpus.
* **Import tests:** the real 81 + 9 export → expected review list (duplicates, comma-split, empty headings).
* Lab-facing scrubbed fixtures need re-scrubbing if request dates matter (the month-name scrubber bug is fixed).

## 11. Phasing

**Catalogue-only build (in scope now)**

* **A — Model + resolver (IMPLEMENTED, uncommitted on `feat/lab-filing-analyte-scoping`):** schema + validator, the
  `rules/lab-catalogue.json` seed (63 results, 30 investigations, one *suggested* lab definition; from `TEST_DEFS` + the 45 real
  result codes + TRUD refset ids), the pure `shared/lab-catalogue-core.js` resolver, and tests: `test-lab-catalogue-core.js` (92
  checks — validator, whole-token matching, group↔request many-to-many, microbiology scoping, lab messages, adapter) and
  `test-lab-catalogue-corpus.js` (110 checks against eight structure-only fixtures in `fixtures/lab-catalogue/`). Not loaded by the
  manifest or any page; nothing else reads it.
* **B — Storage/backup/sync (B1–B3 IMPLEMENTED, uncommitted):** `shared/lab-catalogue-overlay.js`, `shared/io/labcatalogue-io.js`, backup
  convention, practice-profile module. **B4 (seen-results store in the shared folder) deferred** until shared-folder testing is available.
* **C — Investigations settings page:** C1 import from `oirTests` (`shared/lab-catalogue-import.js`) and C2 the Options page
  (`options/investigations-section.js`: practice context, import preview/add, browse, approve / approve-all / remove / disable,
  labs and headings) are **IMPLEMENTED, uncommitted**. **C3 (hand authoring) is also IMPLEMENTED, uncommitted:** new/edit
  investigation (request wordings by ordering system, report headings for any lab or one lab, never-matches, results with role and
  "any one", new results with optional SNOMED code), edit result (add codes / wordings). Built-ins are add-only (locked items shown);
  every save withdraws approval; editing a practice result sends the tests using it back to review; approving a test also approves
  its results and the lab-heading entries that point only at live tests.

**Later, separately reviewed (each with its own hazard entry)**

* **D — Outstanding matcher on the catalogue** (same clearing semantics as today; better recognition; must reproduce existing
  expectations).
* **E — Lab-filing on the catalogue** (profiles reference investigations; H-074 gate generalised).
* **F — Result-triage rules scoping** (analyte → result by code; `specimen` gate → group scope).
* **G — Monitoring / QOF / future-action rules** referencing catalogue results and refsets (`FBC_COD`, `UE_COD`, …,
  already used in the future-action work).

### 11.1 Revision after live review (2026-09-20) — built-ins are editable; approval is gated; `kind` is the sample

* **Built-ins editable (reverses the append-only rule for the settings page).** A practice may correct a shipped result /
  investigation / lab or adapt it to a different lab. The page stores a COMPLETE practice version marked `override: true`;
  it is inert until approved on that machine (the shipped definition keeps applying until then, and again if the override is
  removed — "Revert to built-in"). Imports and shared profiles still arrive append-only and inert. The review screen lists
  "Differs from the shipped version" (`describeChanges`) so a removed exclusion or result is visible before approval.
* **Approval gate.** No one-click / bulk approve: a test is approved only from its review screen, after an explicit
  "I have checked…" tick; approving saves any edits, then approves the test, its dependent results and the lab-heading entries
  that point only at live tests.
* **`kind` is the SAMPLE:** blood | urine | faeces | microbiology (swab / culture) | imaging | procedure | other. Specimen kinds
  need at least one result. Shipped data corrected: urine ACR = urine; FIT and calprotectin = faeces.
* **Headings for labs the practice does not use** are kept but hidden once the practice has named its labs.

### 11.2 C4 — learning the group and result forms from real reports (2026-09-21)

The Outstanding-Requests import supplies only the REQUEST form of a test. `shared/lab-catalogue-scan.js` reads the pending
Investigation Results queue (`/tasks/data/review_investigation_results_task/task-list`, then each row's overview — the same
read-only calls the allocation board makes, via `LabAllocateCore.createClient`) and proposes, for the tests the person selects
(default: every test lacking a lab heading or result codes — `findGaps`): the lab report heading, its results (SNOMED code, unit,
role) and codes for results known by name only. Rules: only names/headings/codes/units are kept (never values or patient/staff
data); a report does not say which request it answers and the card lists ALL outstanding requests, so an unrecognised group can only
belong to a SELECTED test on that card — candidates are INTERSECTED across cards, one survivor = "consistent"/"sole", several =
"ambiguous" (the person chooses; a name-similarity hint pre-selects but never ticks); a second core result is never added to a test
that already has one (new results become optional); a lab not in the catalogue is proposed as a NEW unreviewed lab. Output is
proposals; `OV.applyFills` writes ADDITIVE, unreviewed entries (never overrides) and leaves a carrier entry per touched test so the
test's review approves its heading/results. Not yet done: keeping observations between scans (belongs with the B4 seen-results store),
ungrouped results, creating a NEW investigation from an unmatched heading.

## 12. Deferred / parked (recorded, not lost)

1. **Patient-level match-back to the original request** — after the initial phases: link a patient's arriving
   groups to their own request (feeds Outstanding Investigations and the Companion app). Stale duplicate requests on the
   card (Liver Function ×3, Urine ACR ×4 …) and cross-report accumulation of core results make this a real problem.
2. **Raw report XML / "original message"** — no in-app "view original message"; believed reachable via a web link.
   Parked.
3. **Request vocabulary source** — the request picker runs in a legacy (IE8-era) UI and cannot be HAR-captured.
   Working hypothesis: request names are the **ordering system's** catalogue — **tQuest** for SWL Pathology (the picker is
   plausibly tQuest itself), **ICE** for Ashford / West Middlesex. Options: a catalogue export from SWL Pathology / the
   ICB, an IE-mode debugger or proxy capture, or passively harvesting the distinct request labels the suite already sees.
4. **"Seen a new result → offer to create an entry"** prompt — deferred by decision. (The local *count* it will draw on
   is in scope, §4.6.)
5. **Central store** of shared packs — deferred; the model is shaped for it (§8).
6. **Other labs / other areas** — one lab sends structured reports today; a second (Ashford or West Middlesex, via ICE)
   is being sought; non-SWL behaviour unverified and must be labelled so.
7. **Microbiology** — many results are not modelled yet. Multiple results per sample, organisms and sensitivities need a
   real capture (and probably their own value kinds) before microbiology entries are trusted; until then unmodelled
   microbiology resolves as `unresolved` (fails closed) and is counted in "seen results".
8. **Missing shared results (fallback design).** By decision, shared results (ALP in an LFT, albumin, …) are **optional**;
   an LFT without ALP still clears. If "missing" ones ever matter, the fallback is retained: *request-set waiver* — a shared
   result is required for a request unless any other outstanding line that also predates the sample carries it (no time
   window), shown on the card as "ALP not in this report — waived because Liver Function is also outstanding"; plus a
   `partial (n of m)` state that is never auto-ticked; plus cross-report accumulation (§5.2). Not built.
9. **tQuest catalogue** — SWL Pathology's tQuest is IE8-era and nobody appears to hold its contract; no catalogue export
   is coming. Revisit later (proxy / IE-mode capture, or brute-force) — **do not wait on it**. Request aliases are seeded
   from the practice's existing entries and harvested passively (§4.6-style, request-label side) meanwhile.

## 13. Open questions

1. **Richmond labs — answered:** SWL Pathology (order via tQuest) or Ashford (ICE); some practices can also view West
   Middlesex (ICE) results. Modelled as `labs` + `orderingSystems` on the practice (§4.1).
2. **Free T4 — answered (at this lab):** arrives as its own group in both samples that carried it. Still modelled as its
   own investigation and an `optional` thyroid member, since either request style is valid.
3. **Plain-English notes — accommodated:** optional `note` on investigations, results and labs (§4.4).
4. **Counting — accommodated, and moved to the shared folder:** practice-wide "seen results" store with a small local
   transit buffer (§4.6).
5. **Answered:** no tQuest catalogue export is coming (§12.9). ICE (Ashford / West Middlesex) not yet asked. Request aliases
   are seeded from the practice's own entries and harvested meanwhile.
6. **Answered:** no co-request time window; a partial group clears its request; all predating requests for that
   investigation clear together (as today).
7. **Answered:** shared results are **optional** — an LFT without ALP still clears (§4.4, §12.8). Tighten later if needed.
8. **Seen-results location — decided:** **A** (module inside the existing practice-profile file) first; move to **B** (a
   separate `lab-seen-results.json`) once A is tested and working. No shared folder is set up on the development PC, so
   the live multi-PC test needs a work computer with a *separate test shared folder* (never the live practice one). Most of
   the merge/flush logic is testable in Node with injected file I/O (as `pdc-contribute` is); whether a scratch folder on the
   development PC can stand in for a single-machine live run depends on how the profile-verification step treats it — to
   be checked in Phase B.
9. **Answered:** a **lab message with no value** ("test already performed recently", "sample dropped", "wrong bottle sent")
   still **clears the outstanding request** (keep clearing), with the caveat that some messages mean the test must be
   **repeated** — so each is classified (`sample-problem` / `already-done` / `not-applicable` / `other`) and coverage
   carries `labMessageOnly` so a consumer can warn. It always blocks *filing*. (Phase A implements the classification and
   the flag; the warning UI is Phase D.)
