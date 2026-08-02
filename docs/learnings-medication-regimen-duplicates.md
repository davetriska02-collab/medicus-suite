# Live-verification: medication-regimen duplicate records (`clinical/data/medication/medication-regimen/{patientId}`)

Companion to `docs/learnings-patient-journal-api.md`'s "Live verification"
section (2026-07-17) — a different endpoint/tab, deliberately kept separate.
See that doc for the Journal-side probe this one's second half reuses.

## Trigger (2026-07-17)

While reviewing the just-shipped prescription/investigation-request field-
name fix (v3.176.1), the developer noticed that on the same patient,
Medicus's **Medication history tab** (`careRecordTab=medication` query
param, internal extractor id `care-record-medication` —
`engine/extractors/patient-context.js:18`) appears to show a duplicated
medication that is **not** visible anywhere in the Journal tab's
`prescription` entries for that patient.

**No endpoint discovery needed here** — unlike the Journal API work, the
Medication tab's backing endpoint is already confirmed and live in
production code:
- `engine/api-client.js:183-185` — `fetchMedicationRegimen(apiBase, uuid)` →
  `GET {apiBase}/clinical/data/medication/medication-regimen/{uuid}`,
  already called for every patient Sentinel monitors.
- `engine/normalisers.js:44-97` (`normaliseMedications`) documents the raw
  response shape from real production use: **8 raw buckets** (comment at
  lines 46-49) — `currentRepeatPrescribingMedications`,
  `currentVariableRepeatMedications`, `currentRepeatDispensingMedications`,
  `acuteMedicationsLastTwelveMonths`, `discontinuedRepeatMedications`,
  `medicationsPrescribedElsewhere`, `overTheCounterMedicationStatements`,
  `unIssuedAcutePrescriptions`. The normaliser itself only walks 6 of these
  (skips `discontinuedRepeatMedications` and `unIssuedAcutePrescriptions`,
  lines 55-62) — a duplicate could easily live in either skipped bucket, so
  the probe below scans all 8.
- Confirmed per-item fields (normaliser's own reads, lines 68-92):
  `m.description` (fallback `m.vtmProductName`) = drug name; `m.id`;
  `m.status`; `m.isOverDue`/`m.isReviewOverDue`; `m.dosageInstructions`;
  `m.quantityAndUnit`; `m.medicationIssueHistory.data[].issueDate`/`.date`
  (or `m.issueDate` as fallback when no history array exists).

**Working hypothesis to test** (not assumed): the medication-regimen
endpoint returns one row per **regimen/course "master" record**, not one row
per issue event like the Journal. If a GP2GP reimport created two separate
master regimen records for one ongoing repeat medication — each with its own
independent `medicationIssueHistory`, i.e. two issue-date sets that never
coincide on the same day — the Medication tab would show the drug listed
twice (visually obvious), while the Journal's per-issue `(date, product,
text)` grouping (`groupAndTier`, `engine/record-duplicate-parser.js:703`;
prescription branches at lines 570-588/639-654) would never catch it,
because no two issue-event dates from the two masters would ever align.
This would fully explain "duplicated on one tab, invisible on the other"
without implicating the field-name fix just shipped.

Nothing in this codebase has ever checked the medication-regimen endpoint
for duplicates — `duplicate-checker.js` and `record-duplicate-parser.js`
have zero references to `medication-regimen`, and neither existing
learnings doc discusses possible disagreement between the Journal's
prescription entries and this endpoint's "current regimen" view. This is
new territory.

## Non-goals for this pass

No changes to `engine/record-duplicate-parser.js`, `duplicate-checker.js`,
`engine/api-client.js`, or `engine/normalisers.js` in this pass — capture
and report only. Any feature work is gated on what the probe below actually
shows.

## The probe script

Fetches both the medication-regimen endpoint and the (already-confirmed)
journal endpoint for the same patient in parallel, walks all 8 regimen
buckets, and groups records by their real `description`/`vtmProductName`
text — printing the actual drug name is the point, since that's what lets
the developer confirm "yes, these two records really are the same drug"
rather than trust an opaque token. This is safe to do here specifically
because the script only ever runs client-side in the clinician's own browser
console, on a patient they already have full clinical access to and are
actively viewing — nothing is transmitted anywhere, logged to a file, or
seen by anyone else. `issueDatesFor()` mirrors `engine/normalisers.js:72-81`'s
derivation exactly, so what the probe reports matches what the shipped
normaliser would compute. The journal cross-reference walks flat
(`item.type === 'prescription'`) and nested (`entry.entryType ===
'prescription'`) entries the same way `flattenJournal()` does, and reports
matching journal prescription entries' dates + productName text for the same
drug. A zero-cluster run prints an explicit `console.warn` rather than
silence.

Paste into the **Medicus page console** (not the extension console) while on
the patient's Medication history tab.

```js
// ── Medication-regimen duplicate probe (paste into the Medicus PAGE console) ──
// Runs entirely client-side in your own browser console, on a patient you
// already have full clinical access to and are actively viewing — nothing
// here is transmitted anywhere or persisted outside this console session.
// Prints real drug names deliberately: the whole point is confirming
// whether two regimen records are actually the same medication, which is
// not possible from a hash or type-only shape alone. The endpoint itself is
// already confirmed in production (engine/api-client.js:183-185) — only the
// duplicate-detection question is new.
(async function () {
  'use strict';

  // Same URL-construction pattern as sentinel.js's getMedicusApiOrigin() /
  // api-discovery.js's currentPatientUuid() / the journal probe — derived
  // live from the page route, never hardcoded.
  const siteCode = location.pathname.split('/').filter(Boolean)[0];
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const patientId = (location.pathname.match(UUID_RE) || [])[0];
  if (!siteCode || !patientId) {
    console.error('[probe] Not on a patient care-record page — open the patient\'s Medication history tab first.');
    return;
  }

  const regimenUrl = `https://${siteCode}.api.${location.hostname}/clinical/data/medication/medication-regimen/${patientId}`;
  const journalUrl = `https://${siteCode}.api.${location.hostname}/clinical/data/patient-journal/overview/${patientId}`;

  function normName(name) {
    return String(name || '').trim().toLowerCase();
  }

  // All 8 raw buckets per engine/normalisers.js:46-49 — INCLUDING the 2 the
  // normaliser itself skips (discontinuedRepeatMedications,
  // unIssuedAcutePrescriptions), since a duplicate could easily live there.
  const BUCKETS = [
    'currentRepeatPrescribingMedications',
    'currentVariableRepeatMedications',
    'currentRepeatDispensingMedications',
    'acuteMedicationsLastTwelveMonths',
    'discontinuedRepeatMedications',
    'medicationsPrescribedElsewhere',
    'overTheCounterMedicationStatements',
    'unIssuedAcutePrescriptions',
  ];

  // Same issue-date derivation as engine/normalisers.js:72-81.
  function issueDatesFor(m) {
    if (Array.isArray(m.medicationIssueHistory?.data) && m.medicationIssueHistory.data.length > 0) {
      return m.medicationIssueHistory.data.map((i) => i.issueDate || i.date).filter(Boolean).sort();
    }
    return m.issueDate ? [m.issueDate] : [];
  }

  let regimen, journal;
  try {
    const [rRes, jRes] = await Promise.all([
      fetch(regimenUrl, { credentials: 'include' }),
      fetch(journalUrl, { credentials: 'include' }),
    ]);
    if (!rRes.ok) throw new Error(`medication-regimen HTTP ${rRes.status}`);
    if (!jRes.ok) throw new Error(`patient-journal HTTP ${jRes.status}`);
    regimen = await rRes.json();
    journal = await jRes.json();
  } catch (e) {
    console.error('[probe] Fetch failed:', e.message);
    return;
  }

  // ── Walk all 8 regimen buckets, group by real drug name ──
  const byName = new Map(); // normName -> { displayName, records: [{bucket, id, status, isOverDue, isReviewOverDue, issueDates}] }
  BUCKETS.forEach((bucket) => {
    const arr = regimen[bucket];
    if (!Array.isArray(arr)) return;
    arr.forEach((m) => {
      const displayName = m.description || m.vtmProductName;
      const key = normName(displayName);
      if (!key) return;
      if (!byName.has(key)) byName.set(key, { displayName, records: [] });
      byName.get(key).records.push({
        bucket,
        id: m.id || null,
        status: m.status || null,
        isOverDue: !!m.isOverDue,
        isReviewOverDue: !!m.isReviewOverDue,
        issueDates: issueDatesFor(m),
      });
    });
  });
  const duplicateClusters = Array.from(byName.values()).filter((c) => c.records.length >= 2);

  // ── Same grouping against Journal prescription entries (flat + nested) ──
  const journalByName = new Map(); // normName -> { displayName, hits: [{date, entryId}] }
  function recordJournalHit(name, date, entryId) {
    const key = normName(name);
    if (!key) return;
    if (!journalByName.has(key)) journalByName.set(key, { displayName: name, hits: [] });
    journalByName.get(key).hits.push({ date, entryId: entryId || null });
  }
  const days = journal.patientJournalRecords || [];
  for (const day of days) {
    for (const item of day.items || []) {
      if (item.type === 'prescription') {
        recordJournalHit(item.data?.productName, day.title, item.id);
      }
      if (item.type === 'encounter') {
        for (const topic of item.data?.consultationTopics || []) {
          for (const heading of topic.headings || []) {
            for (const entry of heading.entries || []) {
              if (entry.entryType === 'prescription') {
                recordJournalHit(entry.productName, day.title, entry.id);
              }
            }
          }
        }
      }
    }
  }

  // ── Report ──
  console.log('[probe] Medication-regimen duplicate probe.');
  console.log('[probe] Regimen buckets scanned (all 8, including the 2 the normaliser skips):', BUCKETS.join(', '));

  if (duplicateClusters.length === 0) {
    console.warn('[probe] No same-name duplication found across regimen buckets for this patient.');
  } else {
    duplicateClusters.forEach((cluster) => {
      console.log(`[probe] "${cluster.displayName}" appears in ${cluster.records.length} regimen record(s):`, cluster.records);
      const journalHit = journalByName.get(normName(cluster.displayName));
      console.log(
        journalHit
          ? `[probe]   same drug ALSO appears in journal prescription entries:`
          : `[probe]   this drug does NOT appear anywhere in this patient's journal prescription entries.`,
        journalHit ? journalHit.hits : ''
      );
    });
  }

  const fullReport = {
    duplicateClusters,
    journalByName: Object.fromEntries(Array.from(journalByName.entries()).map(([k, v]) => [v.displayName, v.hits])),
  };
  console.log('[probe] Full report:', JSON.stringify(fullReport, null, 2));
  window.__medicationRegimenProbe = { ...fullReport, regimen, journal }; // left on window for further inspection this session
})();
```

## Results (captured 2026-07-17) — hypothesis REJECTED, no feature warranted

Run against the same patient already probed for the Journal field-name work.
One duplicate cluster found, on **Fexofenadine 120mg tablets**, two records
both in `currentRepeatPrescribingMedications`:

| regimen `id` | status |
|---|---|
| `019cd6ab-9b1a-7069-b481-92da4998269c` | "2 of 4 issued 08 Jun 2026 - Supply ended 06 Jul 2026" |
| `019ea759-5262-70c4-8e74-19c8cf986d1d` | "1 of 6 issued 08 Jun 2026 - Supply ended 06 Jul 2026" |

Both `isOverDue: true`, both `issueDates: []` (`medicationIssueHistory` was
empty/absent on both records in this payload — not investigated further,
not needed for the conclusion below).

**Cross-referencing both regimen ids directly against the same patient's
journal data (already captured for the field-name work) settles the
question**: both ids are literal ids of real, distinct journal `prescription`
entries — `019cd6ab-9b1a-...` is the issue dated **Tue 10 Mar 2026**,
`019ea759-5262-...` is the issue dated **Mon 08 Jun 2026**. Both dates
appear exactly once each in Fexofenadine's otherwise-clean 21-entry journal
history; every *other* date in that same history shows the normal
flat+nested dual-render pair (already correctly collapsed to one candidate
by the existing journal-based checker) — these two recent dates don't, i.e.
they were never flagged as journal duplicates because they aren't journal
duplicates.

**Conclusion: a regimen-view "duplicate" is not the same thing as a
reimport-artifact duplicate.** A regimen record's `id` is not a separate
"master course" identifier — it anchors to a specific real issue event. The
two Fexofenadine rows are two real, distinct, already-correctly-recorded
prescribing events (10 Mar 2026 and 08 Jun 2026), most likely a mid-course
reauthorization (same "Supply ended" date, differing "N of M issued"
counts) where the superseded authorization row simply hasn't dropped off
Medicus's own "current" bucket yet. This is a Medicus-side display
question, not a GP2GP reimport data-quality problem in this patient's
record — there is nothing here for the duplicate-checker (whose whole
purpose is catching reimport artifacts) to detect, and nothing here that
would be safe to "clean up" even if it wanted to: removing either regimen
record would delete a real, valid past authorization.

**Confirmed not a one-off**: the developer re-ran the same check by eye
against several further patients, deliberately including patients suspected
of a different prior GP clinical system (SystemOne/EMIS, i.e. a different
GP2GP source system than the original sample this whole duplicate-checker
project was built from) — no definite journal-level medication duplicates
were found on any of them either.

**Decision: no Phase 2 feature.** The working hypothesis (GP2GP reimport
creating two master regimen records with disjoint issue-date histories) is
rejected by direct evidence, not just unconfirmed. Building medication-
regimen duplicate detection on the strength of one Medicus UI artifact that
turned out not to be a data problem would be solving a problem that doesn't
exist, at real safety cost (any removal path here touches live prescribing
state — see the Phase 2 safety note in the session plan, never built).
Closing this investigation; no code changes result from it.
