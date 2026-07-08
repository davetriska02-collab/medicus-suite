# Draft copy — "Record duplicate cleanup tool" (was "Duplicate Problem Checker")

Draft for review only — not yet applied to duplicate-checker.html.

## Title

Record duplicate cleanup tool

## Intro (your text, lightly tidied)

This tool looks for patterns — either in an individual patient record, or in your overall
patient list — suggesting duplication of data. Usually, this occurs in record transfers via
the GP2GP process, and can in some cases result in the whole record being duplicated. This
tool flags likely candidates in your registered list, and/or allows you to search for and
clean up duplicates within an individual patient record.

The list search works by looking ONLY at problem codes, and identifying where these appear
duplicated. Patients are then flagged for a full record search, which you can do per-patient.
Within a patient record, the rules are more complex, but aim to flag likely duplicates and
make cleaning them up easier.

Please note that removing data in this way is not easily reversible in Medicus (it requires
manual work by the backend team) — so please make sure you are confident that any data you
remove is genuinely a duplicate before proceeding.

## Addition 1 — how duplicates are identified (plain-English summary of the actual logic)

Within a patient's full record, the tool groups entries that share the same clinical code,
the same date, and the same type (problem, note, prescription, etc.), then checks how
confident it can be that they're really the same thing recorded twice:

- **EXACT match** — identical wording and the same author. Safe to bulk-remove.
- **HIGH match** — identical wording, but recorded by a different clinician/organisation
  (a common sign of a GP2GP re-import). Also offered for bulk removal.
- **REVIEW** — same code, but the wording genuinely differs (e.g. one copy has extra
  clinical detail the other doesn't). Never offered for automatic removal — flagged for you
  to look at and merge by hand if needed.

A few safety checks run automatically before anything is even offered for removal:

- Two mentions of the same code within **one single consultation** are not treated as
  duplicates — that's normal clinical recording (e.g. referenced under two headings), not an
  import artefact.
- Prescriptions issued **on the same day but for a different quantity**, or a real minute or
  more apart, are treated as separate genuine issues, not duplicates — even if they look
  alike at first glance.
- **Documents** are never bulk-removable through this tool — only ever flagged for manual
  review, since two documents can share identical-looking metadata (type, date) while being
  completely different records (confirmed live: two questionnaire responses of totally
  different types looked identical until their actual content was checked).
- Where the tool spots the tell-tale "Problem Info: Problem Notes: … {Episodicity…}" text
  wrapper GP2GP leaves behind on a re-imported entry, it treats that as extra supporting
  evidence, not proof on its own.
- If it's genuinely unclear which copy is the original, you're asked to choose before any
  removal is offered — it never guesses.

## Addition 2 — background: how a record moves through GP2GP, in outline

A single patient's record can pass through this cycle more than once in their lifetime —
each time they move practice, it repeats. A patient who has moved GP twice has been through
it twice:

1. **GP EPR 1** prepares and sends the de-registering patient's data.
2. The **GP2GP process** sends that data on to the new practice's system, **GP EPR 2**.
3. **GP EPR 2** receives and processes that data as a new patient.
4. Later, when the patient moves again, **GP EPR 2** prepares and sends the (now
   de-registering) patient's data onward.
5. The **GP2GP process** sends that data on to the next practice's system, **GP EPR 3**.
6. **GP EPR 3** receives and processes that data as a new patient.

Errors and corruption can be introduced at **any** of these six steps — and this tool
deliberately does not try to identify where or why for any given patient. It only detects
that duplication has happened, not which stage of the chain is responsible.
