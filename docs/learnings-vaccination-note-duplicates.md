# Live-verification: vaccination-note false positives + "Remove 0" bug

## Trigger (2026-07-17)

User report, third-pass (document/note) review: three vaccination-related
journal `note` entries, all in one consultation (same record date), tier as
"HIGH - identical text" and are NOT duplicates (three different vaccines
given in one visit). Match signature: same record date, same SNOMED
`clinicalCodeDescription` on each entry, and identical `note` text reading
`"{Episodicity : code=303350001, displayName=Ongoing, originalText=Review}"`
on all three. Separately, the group's "Remove N duplicate copies" button
reads **"Remove 0 duplicate copies"**, and none of the three entry cards can
be clicked to toggle keep/remove.

## Root causes traced in code (no live data needed for this part)

**False-positive tiering** — `engine/record-duplicate-parser.js`'s
`normText()` (`EPISODICITY_SUFFIX_RE`, anchored `$`) strips the *entire*
note body when it's nothing but the Episodicity wrapper, collapsing all
three entries to the same empty string regardless of which vaccine each
describes. Tiering (`buildGroupRecord`) then sees `distinctText.size === 1`
→ EXACT/HIGH, exactly as reported. `clinicalCodeDescription` (the grouping
`code`) is, per the user's report, also identical across the three —
consistent with all three sharing one generic "Review"/Episodicity SNOMED
code rather than a vaccine-specific one.

`consultationTopics[].title` — the one field that plausibly carries a
vaccine-specific label (e.g. an "Influenza vaccination" vs "Pneumococcal
vaccination" heading) — is read exactly once in the whole file
(`isTransferEncounter`, checking only for `"Data Transferred from other
system"`) and is **never propagated onto a note entry or used in
grouping/tiering**. This is the candidate fix, but it's unconfirmed whether
real data actually carries a distinguishing value there — needs checking
before building anything on it.

**"Remove 0" bug** — `removalButtonHtml`'s count is
`g.entries.filter(e => e.id !== keeperId).length`. `keeperEntryId` is always
drawn from the group's own `members[].id` (`buildGroupRecord`). The only way
this count can be `0` for a 3-member group is if **all three members share
the identical `.id` value**. The same id is used as `data-entry-id` for the
click-to-toggle cards, so an id collision would also explain why no card can
be individually selected — every card matches `keeperId` already; clicking
any of them recomputes the same shared id and the re-render is a no-op.

This needs live confirmation because the fix differs by cause:
- If Medicus's API genuinely returns the same `id` for what are meant to be
  three distinct note entries, bulk-remove must be **disabled** for this
  shape of group, not patched to "work" — the removal write endpoint
  (`patient/note/mark-incorrect-and-hidden`) is keyed by `noteId`; calling
  it with an ambiguous/shared id risks silently acting on the wrong record.
- If the ids are actually distinct in the raw payload and something else in
  the pipeline is aliasing them, the real fix is elsewhere and bulk-remove
  can stay enabled once found.

## The probe script

Paste into the Medicus **page console** on the same patient's Journal tab.
Walks the (already-confirmed) journal endpoint, finds every `note` entry
whose text is (after trimming) exactly the Episodicity wrapper with SNOMED
`303350001`, and prints — per matching entry — its real `id`,
`encounterId`, `clinicalCodeDescription`, `recordedBy`, and (read directly
from the raw payload, not currently captured by the shipped parser) the
enclosing `heading.title` and `consultationTopic.title`. Explicitly flags
any id collision. Real values are printed deliberately (per this session's
established convention): this only runs in your own browser console, on a
patient you already have full clinical access to.

```js
// ── Vaccination-note false-positive / id-collision probe (Medicus PAGE console) ──
(async function () {
  'use strict';
  const siteCode = location.pathname.split('/').filter(Boolean)[0];
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const patientId = (location.pathname.match(UUID_RE) || [])[0];
  if (!siteCode || !patientId) {
    console.error('[probe] Not on a patient care-record page — open the patient\'s Journal tab first.');
    return;
  }
  const journalUrl = `https://${siteCode}.api.${location.hostname}/clinical/data/patient-journal/overview/${patientId}`;

  // Matches the exact reported wrapper text, tolerant of the specific
  // code/displayName/originalText values so it also catches near-variants.
  const EPISODICITY_RE = /^\{episodicity\s*:\s*code=\d+.*\}$/i;

  let journal;
  try {
    const res = await fetch(journalUrl, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    journal = await res.json();
  } catch (e) {
    console.error('[probe] Fetch failed:', e.message);
    return;
  }

  const matches = [];
  const days = journal.patientJournalRecords || [];
  for (const day of days) {
    for (const item of day.items || []) {
      if (item.type !== 'encounter') continue;
      const enc = item.data || {};
      for (const topic of enc.consultationTopics || []) {
        for (const heading of topic.headings || []) {
          for (const entry of heading.entries || []) {
            if (entry.entryType !== 'note') continue;
            if (typeof entry.note !== 'string' || !EPISODICITY_RE.test(entry.note.trim())) continue;
            matches.push({
              date: day.title,
              encounterId: item.id,
              entryId: entry.id,
              clinicalCodeDescription: entry.clinicalCodeDescription,
              recordedBy: entry.recordedBy,
              note: entry.note,
              headingTitle: heading.title,
              topicTitle: topic.title,
            });
          }
        }
      }
    }
  }

  console.log(`[probe] Found ${matches.length} matching Episodicity-wrapper note entr${matches.length === 1 ? 'y' : 'ies'}.`);
  console.log('[probe] Full detail:', JSON.stringify(matches, null, 2));

  const idCounts = new Map();
  for (const m of matches) idCounts.set(m.entryId, (idCounts.get(m.entryId) || 0) + 1);
  const collided = Array.from(idCounts.entries()).filter(([, n]) => n > 1);
  if (collided.length) {
    console.error('[probe] ID COLLISION CONFIRMED — these entry ids appear more than once:', collided);
  } else {
    console.log('[probe] No id collisions found among matched entries — every entry has a distinct id.');
  }

  const distinctHeadingTitles = new Set(matches.map((m) => m.headingTitle || '(none)'));
  const distinctTopicTitles = new Set(matches.map((m) => m.topicTitle || '(none)'));
  console.log(
    `[probe] heading.title distinguishes them: ${distinctHeadingTitles.size > 1} (${distinctHeadingTitles.size} distinct value(s): ${[...distinctHeadingTitles].join(' | ')})`
  );
  console.log(
    `[probe] consultationTopic.title distinguishes them: ${distinctTopicTitles.size > 1} (${distinctTopicTitles.size} distinct value(s): ${[...distinctTopicTitles].join(' | ')})`
  );
  window.__vaccineNoteProbe = matches;
})();
```

## Results, part 1 (captured 2026-07-17) — the false-positive question is settled; the "Remove 0" bug needs a second, targeted probe

The probe returned **100+ matches spanning 1994 to 2026** — this Episodicity
wrapper is **not vaccine-specific at all**. It's the generic "Problem title"
review stub GP2GP attaches to essentially every problem in this patient's
entire history (conjunctivitis, UTI, eczema, immunisations, cough, travel
advice, registration admin…), going back three decades. The specific
3-vaccine group the user found is one instance of a pattern that recurs
constantly across the whole record.

**`heading.title` is useless as a disambiguator, confirmed rather than
inferred** — it's the literal string `"Problem title"` on every single one
of 100+ matches, zero variation.

**`consultationTopic.title` varies (47 distinct values) but does NOT solve
the vaccine case** — direct evidence: on **Tue 19 Jun 2007**, three separate
`"Immunisations"`-coded note entries exist, all sharing `topicTitle:
"Infectious dis:prevent/control"`, in three *different* encounters, recorded
by three different staff (Dr J R Jones / Mrs Janine McGilly / Ms Clare
Lower). This is structurally the same shape as the user's reported group —
and `consultationTopic.title` is **identical across all three**, because
multiple genuinely different vaccines given around the same time are
routinely coded under one shared generic immunisation topic, not a
vaccine-specific one. There is no field on a `note`-kind entry that reliably
distinguishes "three different vaccines" from "one review stub duplicated
three times" — the vaccine's actual product identity isn't captured on this
entry type at all.

**The same dataset also contains what look like genuine reimport
duplicates** — e.g. **Thu 15 Jul 1999**: `"Eczema NOS"` appears **three
times**, same date, same code, same topic, same `recordedBy`, but three
different `encounterId`s. That's the pattern this tool exists to catch, and
it's structurally indistinguishable from the "Immunisations" case above
using any field currently read.

**Conclusion:** building an automatic content-based disambiguator (e.g. off
`consultationTopic.title`) is not viable — proven not just unconfirmed. Given
the clinical stakes of auto-flagging a real vaccination record as
one-click-removable, the correct fix is not to guess harder, it's to stop
treating "identical text" as meaningful evidence when the only text present
is the content-free Episodicity wrapper AND the authors disagree.

**Applied in v3.176.3** — narrower than the first draft of this
recommendation: caps a `note`-kind group at REVIEW **only when it would
otherwise tier HIGH** (different `recordedBy`), not EXACT. A first attempt
capping both tiers broke an existing, live-confirmed real duplicate (2026-07-08
"Perianal abscess" pair, `note:null` vs the bare Episodicity block, **same**
`recordedBy`) — that combination is a genuine GP2GP dual-render duplicate,
not a false positive, and must stay EXACT and removable. Same-author +
empty-wrapper is trustworthy (confirmed by that real pair, and by this
session's "Eczema NOS" ×3-same-day/same-author example above, which also
should stay EXACT). Different-author + empty-wrapper is the unsafe
combination the vaccination case actually reported — mirrors the existing
`document`-kind REVIEW cap in spirit ("the real distinguishing content lives
below the journal payload"), applied only where the evidence actually
supports it.

**The "Remove 0" bug is NOT explained by an id collision** — zero collisions
across 100+ matched entries in this probe, which refutes the code-traced
hypothesis (all group members sharing one `.id`). The real cause needs
inspecting the SPECIFIC problem group's already-computed state directly in
the duplicate-checker tool, not a fresh re-derivation — see part 2 below.

## Results, part 2 — pending (targeted probe for the actual "Remove 0" instance)

Since ids aren't colliding, the bug's real cause needs the tool's own
already-computed group state — not a fresh re-derivation from the raw
journal, which could easily diverge from what `analyzeJournal`/the on-demand
cross-checks actually produced (grouping/tiering/keeper-selection all happen
inside the tool, not in this probe). `runJournalAnalysis`
(`duplicate-checker.js:632-674`) stores the full analysis on the result
container itself — `out.__analysis = analysis` where `out =
document.getElementById('journal-result-${idx}')` — and each group's DOM
card carries `data-group-idx` (`duplicate-checker.js:1137`), with the remove
button itself carrying `data-keeper-id` directly
(`duplicate-checker.js:1297`).

**Run this in the duplicate-checker extension tab's own DevTools console**
(not the Medicus page — this one reads the extension page's own in-memory
state), with the patient's journal analysis already open on screen showing
the "Remove 0 duplicate copies" button:

```js
// ── Targeted probe: find the "Remove 0" group in the tool's own state ──
(function () {
  const btns = Array.from(document.querySelectorAll('.remove-group-btn')).filter((b) =>
    /Remove 0 duplicate/.test(b.textContent)
  );
  if (!btns.length) {
    console.warn('[probe] No "Remove 0" button currently on screen — make sure the analysis is rendered first.');
    return;
  }
  const resultEls = Array.from(document.querySelectorAll('[id^="journal-result-"]')).filter((el) => el.__analysis);
  if (!resultEls.length) {
    console.error('[probe] No journal-result element with __analysis found.');
    return;
  }
  const out = resultEls[0]; // normally exactly one is populated at a time
  const analysis = out.__analysis;

  btns.forEach((btn) => {
    const gIdx = Number(btn.dataset.groupIdx);
    const domKeeperId = btn.dataset.keeperId;
    const g = analysis.groups[gIdx];
    console.log(`[probe] group index ${gIdx}: kind=${g.kind} tier=${g.tier} code=${JSON.stringify(g.code)} date=${g.date}`);
    console.log('[probe]   analysis.groups[gIdx].keeperEntryId:', g.keeperEntryId);
    console.log('[probe]   button data-keeper-id (what the DOM actually rendered):', domKeeperId);
    console.log(
      '[probe]   entries:',
      g.entries.map((e) => ({ id: e.id, isKeeper: e.isKeeper, recordedBy: e.recordedBy, encounterId: e.encounterId }))
    );
    const idSet = new Set(g.entries.map((e) => e.id));
    console.log(`[probe]   distinct ids in this group: ${idSet.size} / ${g.entries.length} entries`);
    console.log(
      '[probe]   toRemove as the button computes it (entries whose id !== domKeeperId):',
      g.entries.filter((e) => e.id !== domKeeperId).length
    );
  });
})();
```

### Results (captured 2026-07-17)

```
group index 0: kind=problem tier=high code="Immunisations" date=Tue 19 Jun 2007
analysis.groups[gIdx].keeperEntryId: 019dde9e-3bf9-7353-95d7-18911f516285
button data-keeper-id: 019dde9e-3bf9-7353-95d7-18911f516285
distinct ids in this group: 1 / 6 entries
toRemove: 0
```

Root cause confirmed, and it wasn't what part 1's code-tracing predicted:
**the "Remove 0" group is `kind=problem`, not `note`** — a completely
different code path from the vaccine-note false-positive investigated
above. All 6 entries share one real `problem.id`: the same canonical
"Immunisations" problem-list record, legitimately linked from 6 different
encounters on the same day (`pushProblem` is called once per encounter for
every problem that encounter links, and nothing deduped across encounters —
only within one, via `collectProblemsOnce`). `groupAndTier`'s (date, code)
bucketing then treated those 6 *references to one record* as 6 *candidate
duplicate records*, and since they all share one id, the keeper tie-breaker
picks that shared id and every entry "matches" it — hence 0 removable and
no card individually distinguishable.

**Fixed in v3.176.4**: `groupAndTier` now dedupes `problem`-kind members by
`id` before deciding whether a bucket is a duplicate-record candidate at
all — same-record linkage (however many encounters reference it) no longer
forms a group; two genuinely distinct problem-list records sharing a
code/date still do. See CHANGELOG.md v3.176.4.

This investigation is now closed — both reported issues (the false-positive
vaccine-note tiering, and the "Remove 0" bug) are root-caused and fixed,
and turned out to be two unrelated bugs that happened to surface on the
same patient/date.
