# Duplicate Checker — detection stages

This document explains how the Duplicate Checker finds duplicate records. It
covers every stage in the pipeline, in order, and states what each stage
looks for. It also lists which checks run always and which checks run only
on request. A history section at the end maps each stage to the change that
added or changed it.

Written in Simplified Technical English (ASD-STE100, STE-flavored mode): short
sentences, active voice, one topic per paragraph. Source: `CHANGELOG.md`
entries for the Duplicate Checker, cross-checked against the current code in
`engine/record-duplicate-parser.js` and `duplicate-checker.js`.

Use this document to answer two questions. First, what does the tool check
today. Second, when did a specific check change, so a report of "we used to
catch this and now we do not" can point at a specific version.

## What the tool does

The Duplicate Checker reads one patient's full clinical journal. It finds
records that are the same real-world event, entered twice. The most common
cause is a GP2GP reimport — moving records from an old clinical system to
Medicus. A reimport can create two copies of the same problem, note,
document, prescription, or lab result.

The tool never removes anything on its own. It groups records, ranks how
confident it is, and shows the human what it found. A human must review a
group before anything is removed or merged.

## Stage 1 — Read the journal into a flat list

The first stage reads Medicus's own journal payload and produces one flat
list of entries. The source function is `flattenJournal`.

The journal groups records by day. Inside each day, records nest inside
encounters, consultation topics, and headings. This stage walks that nested
structure and pulls out six kinds of record:

- **Problem** — a coded clinical problem.
- **Note** — a consultation note or free-text entry.
- **Document** — an inbound letter, referral, or other file.
- **Prescription** — one prescription issue.
- **Investigation request** — an order for a lab test.
- **Investigation** — one reported lab result (see Stage 1a).

A record with no code is dropped. A code is required to compare two records
against each other.

### Stage 1a — Lab results

Lab results are read from `item.data.investigationGroups[].results[]`, one
entry per reported value. Each result carries its own collection time, to
the minute. This stage groups results by that exact time, not by the day
alone. Two tests taken on the same day but at different times must not
collide into one group.

A result with no collection time, no result code, or no parent report ID is
skipped. When a skipped result belongs to a report that DOES have other
readable results, the report is marked as having unread data. Stage 2 uses
that mark to refuse a "full match" verdict on the report — see Stage 2b.

## Stage 2 — Group records and drop known false positives

The second stage groups the flat list by `(kind, date, normalised code)`. A
group with fewer than two members is not a duplicate. It is dropped before
tiering. The source function is `groupAndTier`.

Four exclusion rules run inside this stage. Each one removes a group that
looks like a duplicate but is not. Each drop is also recorded in a
diagnostic list, so the summary line can state how many groups were excluded
and why.

1. **Same real record, several links.** A `problem` entry's ID is the
   patient's one real record for that problem, not a per-mention ID. The
   same problem can be linked from several encounters on the same day. This
   stage first removes repeat IDs. A group survives only if at least two
   DISTINCT problem IDs remain.
2. **Same consultation, mentioned twice.** Two records that share one date,
   one code, AND one non-null encounter ID are one consultation mentioning
   something twice, not two consultations. This is excluded ONLY when every
   member shares the same single encounter ID. A record with no encounter
   ID (a flat, top-level entry) is never excluded by this rule, even when it
   shares a date and code with a nested one — that pairing is the exact
   flat-versus-nested duplicate this tool exists to find.
3. **Same prescription, different quantity.** Two prescription issues on the
   same day, same product, same dose text, but a DIFFERENT quantity, are
   usually two genuine issues — for example, a top-up of an acute
   medicine. This rule excludes them.
4. **Investigation results that do not agree.** A lab-result group survives
   only when it tiers EXACT (see Stage 3). Any other tier is dropped
   silently. See Stage 3b for why.

## Stage 3 — Assign a confidence tier

Every group that survives Stage 2 gets a tier. The source function is
`buildGroupRecord`. There are three tiers, ranked by confidence:

| Tier | Meaning |
|---|---|
| EXACT | Every member has the same text AND the same author. |
| HIGH | Every member has the same text. The author differs. |
| REVIEW | The text itself differs between members. |

Three rules can CAP a tier down, even when the raw text comparison would
allow a higher one.

### Stage 3a — Documents are always capped at REVIEW

A `document` group never tiers above REVIEW, even when the journal text
matches closely. Two unrelated documents (a real example: an asthma
questionnaire and an unrelated triage form) shared the same generic
metadata and tiered EXACT under the raw rule. The record that actually
distinguishes one document from another does not live in the fields this
stage compares.

### Stage 3b — Investigation results must be fully accounted for

An investigation-result group is kept only when it tiers EXACT (Stage 2,
rule 4). This document calls that "detection-only". The tool will show an
EXACT group but will not offer a lower-confidence lab-result group for
review at all, even flagged as uncertain.

`fullMatch`, computed separately by `buildInvestigationReportGroups`,
narrows this further at the report level (a lab REPORT can hold several
results). A report is offered for removal only when every result on every
member report of a cluster is a confirmed duplicate. A report holding even
one unread result (see Stage 1a) is shown, but its removal action is
withheld.

### Stage 3c — A content-free wrapper is not a genuine match

A `note` group that tiers HIGH (same text, different author) is capped down
to REVIEW when the ENTIRE matched text is a GP2GP "Episodicity" wrapper with
nothing else inside it. This wrapper is not specific to one clinical event —
it is reused across a patient's whole record. A real example found three
different vaccines, given by three different staff, all sharing this empty
wrapper as their only "matching" text.

This cap applies to HIGH only. An EXACT match (same empty wrapper, same
author) is left alone — a same-author, same-wrapper pair is a confirmed
genuine duplicate, not this false-positive pattern.

## Stage 4 — Cross-checks that can downgrade a REVIEW group further

These checks run automatically once a group exists. Each one looks for
evidence that two entries which LOOK like duplicates are not. A check here
never raises a tier. It only downgrades one, or adds a warning banner.

- **GP2GP wrapper display.** The wrapper text is shown to the reviewer,
  highlighted, as a visual guide. It is not hidden. The diff underneath it
  is still computed on the text with the wrapper stripped out.
- **Attached-document mismatch.** A `note` entry can carry a sibling
  document in the same heading. Two notes with identical text can still
  point at two DIFFERENT attached documents. When this stage finds a known,
  differing file type or file size between the attachments, it downgrades
  the note group to REVIEW and shows a warning.
- **Questionnaire template mismatch.** A questionnaire-response document
  carries its own template reference. Two documents matched by date and
  code, but built from different templates, are flagged this way.
- **Prescription timing mismatch.** Checked as a cross-check on top of the
  Stage 2 quantity exclusion — see `hasPrescriptionTimingMismatch`.
- **Suspicious-document markers.** Every analysis also computes, at no
  extra cost, whether a document's title carries a raw filename or ID
  fragment, or whether its creation time falls in the same minute as
  another document's. These markers do not change a tier. They feed the
  Stage 5 banner instead.

## Stage 5 — Opt-in second passes

These checks do NOT run automatically. The reviewer must click a button to
start each one. They cost more time or more network calls than the checks
above, so they stay off by default.

### Stage 5a — Cross-record file match

Matches `document` entries across the WHOLE record by `(file type, file
size)`. This is the one check that can catch two copies of the same file
filed under two DIFFERENT dates — a case the date-based grouping in Stage 2
can never see, regardless of how the two dates are recorded.

A banner offers this check whenever any document shows a suspicious-document
marker (Stage 4), including when the normal pass found zero groups. This
covers the exact case the check was built for: a patient flagged as
suspicious, with nothing caught by the main pass.

Two named exceptions narrow a match, so this check does not merge two
files that only coincidentally share a size:

- A URL-only attachment (an SMS/message-app delivery wrapper) matches only
  when the extracted URL also matches, not on file type and size alone.
- A cluster that is already covered, member-for-member, by an existing
  group is not reported again.

### Stage 5b — Content-hash verification

Runs per group, on a group already confirmed same-type-and-same-size by
Stage 5a or the main pass. Downloads the real file bytes and hashes them
(SHA-256). Splits the group apart if the hashes differ.

This check never widens a group. It only confirms or splits one that
another check already formed. A real example needed this: six historical
vaccination documents, dated across two decades, all auto-generated from one
template, sharing type AND size, but genuinely different vaccines.

## Stage 6 — Document-linked entries (a special case)

Some documents in Medicus link directly to one journal entry — the entry IS
the document's content, not a separate copy of it. A reimport can break that
link. The result is a freestanding copy that duplicates the still-linked
original.

This check reads `GET clinical/document/entries/{documentId}` for every
document. It compares the linked entry against the freestanding one. When it
finds a match, it FORCES the linked entry to be the keeper. Every other
check in this tool computes the keeper from which copy has the earliest
record ID. This is the one exception, because the two copies here are not
interchangeable — one is provably the original.

## Stage 7 — Review, merge, and removal

Once a group is formed and tiered, the reviewer acts on it. The action
available depends on the entry kind and the tier:

- **EXACT and HIGH** groups get a direct removal action. The reviewer picks
  which copy to keep, confirms, and the tool removes the rest.
- **REVIEW** groups get a side-by-side compare view. For `note` entries, an
  editable merge box drafts combined text and applies it through the
  confirmed note-edit endpoint. For `document` entries, a field-by-field
  table lets the reviewer pick a value per field and apply the chosen set
  to the kept copy.
- **`problem`** entries have no confirmed edit endpoint. The tool offers
  merge guidance to copy by hand, not an automated apply.
- **`prescription`** entries are never merged. A tier here only informs the
  quantity and timing checks in Stage 2.

Every removal or merge goes through a write contract confirmed live against
Medicus's own API — see `WRITE_CONTRACTS` and `isRemovableKind` in
`engine/record-duplicate-parser.js`. A kind with no confirmed contract gets
no removal button, whatever its tier.

## What runs always, and what needs a click

| Check | Runs automatically | Needs a click |
|---|---|---|
| Flatten, group, tier (Stages 1–3) | Yes | — |
| Wrapper display, attachment/template/timing cross-checks (Stage 4) | Yes | — |
| Suspicious-document markers | Yes | — |
| Cross-record file match (Stage 5a) | — | Yes |
| Content-hash verification (Stage 5b) | — | Yes, per group |
| Document-linked-entry matching (Stage 6) | Yes | — |
| Investigation report-level grouping | Yes | — |

## Where a real duplicate can still be missed

This section lists every point in the pipeline where a group is dropped
silently, or where a check needs a click to run. A missing duplicate often
traces back to one of these, not to a bug.

1. A record with no code at all (Stage 1) is never compared to anything.
2. An investigation result with no collection time, code, or report ID
   (Stage 1a) is skipped, and can make its report ineligible for a "full
   match" removal offer (Stage 3b).
3. A `problem` group collapses to one real record once repeat links are
   removed (Stage 2, rule 1) — this is correct behaviour, not a miss, but it
   looks like one until the reason is known.
4. Two records sharing one encounter ID (Stage 2, rule 2) are excluded as
   one consultation, even when they are a genuine duplicate that happens to
   share an encounter ID for another reason.
5. An investigation-result group that is not EXACT (Stage 2 rule 4, Stage
   3b) is dropped with no REVIEW-tier fallback.
6. Cross-record file match (Stage 5a) and content-hash verification (Stage
   5b) do not run until the reviewer clicks the banner or button. A
   duplicate only these checks can find stays invisible until then.
7. `problem` and `prescription` REVIEW groups have no automated
   remove-or-merge action — a human must act in Medicus directly.

## History

This table lists every Duplicate Checker change found in `CHANGELOG.md`, in
date order. It states which stage each change touches. Read this table
against the stage descriptions above to find when a specific check was
added, narrowed, or moved behind a click.

| Date | Version | Stage | Change |
|---|---|---|---|
| 2026-07-07 | v3.162.1 | 5a | File-match check widened from file type alone to (file type, file size). Confirmed the field names live. |
| 2026-07-08 | v3.162.2 | 6 | Document-linked-entry matching rebuilt against the real endpoint (`clinical/document/entries/{id}`). Forced-keeper rule added. |
| 2026-07-08 | v3.163.0 | 7 | Field-by-field compare table added for `document` REVIEW groups. |
| 2026-07-08 | v3.164.0 | 7 | Document field-apply write contract added (`POST clinical/document/edit-details`). |
| 2026-07-08 | v3.164.1 | 7 | Compare-table display fixes. Created/Filed/File type/File size marked read-only. |
| 2026-07-08 | v3.164.2 | 6 | Document-linked groups given the side-by-side layout. Groups sorted into journal order. |
| 2026-07-08 | v3.164.3 | 7 | Field-apply refusal reasons named per field, instead of one blanket message. |
| 2026-07-08 | v3.164.4 | 7 | Author/organisation no longer blocks a field apply when the source record was blank. |
| 2026-07-08 | v3.164.5 | 7 | Diagnosed: an uncoded document type blocks ALL saves, in Medicus's own UI too. Message corrected to name the real field. |
| 2026-07-08 | v3.165.0 | 7 | HIGH-tier `note`/`problem` groups given a remove action and a merge action, where previously they had neither. |
| 2026-07-08 | v3.166.0 | 3, 7 | Fixed a null-text-vs-junk-text pair mis-tiering REVIEW. Added a read-only note-detail compare view. Added an explicit KEEP/DISCARD marker on every card. |
| 2026-07-08 | v3.167.0 | 7 | EXACT `note`/`problem` pairs given the side-by-side compare view too. "Compare details" and "Suggest a merge" combined into one view for notes. |
| 2026-07-08 | v3.168.0 | 7 | Previous-practice notes can now auto-merge, using a confirmed write shape. |
| 2026-07-08 | v3.169.0 | 7 | Document removal added (`POST clinical/document/mark-incorrect`). |
| 2026-07-08 | v3.170.0 | 4, 7 | GP2GP wrapper shown in place (Stage 4), not stripped from the display. Removal/merge confirm reduced to one keep marker. |
| 2026-07-08 | v3.171.0 | 7 | Added links out to Medicus: the patient's own journal, and the original document file. |
| 2026-07-08 | v3.172.0 | 5a | Cross-record file match added. Ran automatically at this point — see v3.173.0. |
| 2026-07-08 | v3.173.0 | 5a | Cross-record file match moved behind a click. Confirmed too slow to run automatically on a document-heavy record (~46% slower). |
| 2026-07-13 | v3.176.5 | 5a | Fixed: the file-match second pass could replay an already-removed entry. Now always re-fetches first. Banner is no longer gated on a suspicious-document finding. |
| 2026-07-13 | v3.176.6 | 4 | Added: a `note` EXACT/HIGH match is downgraded to REVIEW when its attached document actually differs (Stage 4). |
| 2026-07-17 | v3.176.7 | 1 | Confirmed live field names for prescription and investigation-request entries. Fixed two fields that were being read from the wrong place. |
| 2026-07-17 | v3.176.8 | 5a | Added: a URL-only attachment (accurx delivery) is excluded from a file-type/size match unless the URL itself also matches. |
| 2026-07-17 | v3.176.9 | 3c | Added: the content-free GP2GP wrapper cap (Stage 3c), after three genuinely different vaccinations tiered HIGH on empty-wrapper text alone. |
| 2026-07-17 | v3.176.10 | 2 | Fixed: a `problem` group with one shared record ID computed "0 duplicates to remove", not 2+. Added the repeat-link dedupe (Stage 2, rule 1). |
| 2026-07-27 | v3.194.0 | — | Added a SEPARATE bulk problem-ending tool. Not part of this pipeline — listed here because it shares the Duplicate Checker's confirm pattern. |
| 2026-07-28 | v3.199.1 | — | Safety documentation corrected to list all eleven write paths that existed at this date, including this tool's. No behaviour change. |
| 2026-08-03 | v3.217.0 | 7 | Added a same-code merge tool INSIDE the separate "Nest problems" panel, using this tool's own keeper convention and removal contract. |
| 2026-08-12 | v3.228.0 | — | Added a SEPARATE journal-duplicate check inside "Clean up code" (a different panel). Read-only. Recommends this tool when it finds more than one match. |
| 2026-08-14 | v3.230.2 | — | Fixed an unrelated auto-sync feature so it stops firing several confirm prompts. Its own text names this tool as the fallback for an unresolved case. |
| 2026-08-22 | v3.236.25 | — | Reordered rows in the safety documentation. No behaviour change. |
| 2026-08-23 | v3.238.0 | 1a, 2, 3b, 5b | Investigation-result duplicate detection added (Stages 1a, 2 rule 4, 3b). Content-hash verification added (Stage 5b). Journal-URL template stripped of a stale filter. Removal-form summary boxes reordered to match the on-screen keeper. |
| 2026-08-24 | v3.238.4 | — | Housekeeping: removed a stray draft-copy file for this tool's own help text. No behaviour change. |
| 2026-09-08 | v3.261.14 | — | Housekeeping: removed the same stray file (listed again — it recurred) and unrelated preview images. No behaviour change. |

## Open question this document does not answer

This document states what the code does today, checked directly against
`engine/record-duplicate-parser.js`. It does not explain why a specific
patient's real duplicate stopped appearing. That needs a live comparison:
run the analysis on the affected record, and check which stage in this
document is the one that drops it.
