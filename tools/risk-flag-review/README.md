# Risk Flag Review

A standalone console tool for finding — and, once you've reviewed and
confirmed them, removing — "flag on patient banner" notes (Risk to self,
Risk to others, Risk from others, Reasonable adjustment, Medico-legal) on a
single patient's Medicus record. Built for practices where a patient has
accumulated dozens of these flags (e.g. repeated "Low suicide risk" entries)
and hunting through Medicus's own risk-category screens one at a time isn't
practical.

**Deliberately not part of the medicus-suite extension.** It isn't in
`manifest.json` and no content script loads it, so it carries none of the
shipped product's write-path/CSO governance. It earns that exemption itself
by following the same discipline the shipped suite uses for every clinical
write (see "Safety discipline" below) rather than skipping it.

There is currently no practice-wide search in Medicus for "every patient with
SNOMED code X" — so this is a per-patient tool: open the patient, run it,
review their flags, remove what you choose. It's not a single cross-practice
sweep.

## What it does

- Reads the current patient's banner badges (`patient-banner` API) and looks
  up the underlying note for each one (SNOMED description, record date,
  recorded-by).
- Shows them in an on-page panel with a text filter, so typing "suicide"
  isolates every "Low suicide risk" flag on that patient instantly.
- Lets you tick any number of rows and remove **just the banner flag** in one
  batch, after an explicit confirm dialog naming every note. This does not
  delete the note, does not change its SNOMED code, and does not touch its
  risk-category classification — it clears exactly the same "Flag on patient
  banner" checkbox you'd otherwise untick by hand on each note's Edit form.
- Each row also links straight to that note's own screen in Medicus, if you'd
  rather edit it yourself.

## The write contract

Confirmed from a live HAR capture (2026-08-26): `POST /clinical/note/change-note`
takes the note's **entire** record back (full-replace, not a partial update).
The two fields that matter — `flagOnPatientBanner` (boolean) and `flags`
(the note's risk-category slugs, e.g. `["risk-to-self"]`) — are both returned
by a fresh `GET /clinical/data/note/edit-note/{noteId}`, so the tool reads
them live off that note immediately before every write. It never guesses or
derives them from a badge label — that same response's `flagOptions` field
is the authoritative slug list (`risk-to-self`, `risk-to-others`,
`risk-from-others`, `local-reasonable-adjustment`, `medico-legal`), and note
that `local-reasonable-adjustment` is **not** what naively kebab-casing
"Reasonable adjustment" would produce — exactly the kind of mismatch reading
the live value avoids.

## Safety discipline

Same pattern the shipped suite uses for every clinical write (see
`docs/CLINICAL-SAFETY-NOTICE.md`'s write-path table):

- Nothing is ticked for you. You choose every row.
- One explicit confirm dialog names every note (description, category, date)
  before any request fires. Cancel is the safe default.
- Each write re-fetches `edit-note` fresh immediately beforehand — never
  reuses the list-view snapshot — and changes **only** `flagOnPatientBanner`;
  every other field goes back exactly as read.
- Already-unflagged notes (e.g. someone else beat you to it) are skipped, not
  re-sent.
- Every write is verified afterwards (re-fetch `note/overview` and check the
  flag actually cleared) and every result — removed, skipped, or failed — is
  shown per-row, plus dumped to the console as a table (`console.table`) you
  can screenshot or copy for your own record.
- Writes run one at a time, never in parallel, and a failure stops the batch
  rather than ploughing on into an unknown state.

## How to run

1. Open the patient's record in Medicus and let the page fully load (the
   patient banner needs to have rendered at least once).
2. Open DevTools (F12) → **Console**.
3. Paste the entire contents of `risk-flag-review.js` and press Enter.
4. A panel appears top-right listing every banner flag on that patient.
5. Tick the ones you want gone (or "Select all shown" after filtering), click
   **Remove N flag(s) from banner**, read the confirm dialog carefully, then
   confirm.
6. Re-run any time (same or a different patient) — it replaces its own panel.

If it reports it couldn't detect the API host or patient ID, reload the page,
open the patient's Clinical Summary or Journal so a relevant request fires,
and try again — or open the Network tab, find the request, and hardcode
`apiHost` / `patientId` in the `OVERRIDE` object at the top of the script.
(Watch out for `iam.api....` hosts — that's the auth service, not the data
host the tool needs.)

If a category's badges don't show up at all, the panel will say so and offer
a "Copy skipped badge JSON" button — send that over so the badge-parsing
logic can be extended to cover it.
