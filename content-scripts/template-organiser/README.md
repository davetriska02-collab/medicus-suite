# Document and Template Organiser

Practice overlay on Medicus’s own template and document lists. It is not Suite Phrases, Practice Knowledge, or an allocate canvas.

The pack `suite.ui.templateOrganiser` is off until Options → Practice features switches it on. The **Document and Template Organiser** button shows while the cursor is in History, Examination, Impression, or Plan on a consultation or plan page (`/clinical/encounter/`, `/clinical/plan`). The encounter page on its own is not enough, and an open Template or Document drawer is not enough. The button hides when focus leaves those fields.

Storage keys are unchanged: `suite.ui.templateOrganiser` and `templateOrganiser.config`.

## What Open does

Open on a card uses Medicus’s own template form, the same one forward-slash insertion opens. Medicus places the finished item at the cursor when the clinician finishes that form. This canvas does not POST a create body and does not show an “Insert into consultation” confirm.

The control Medicus already renders is used when it is on the page:

- Data-entry: the **Use template** button on the card with that title.
- Documents: the **Create {title}** control, or **Use template** on that card.

If that control is not mounted, the canvas focuses the clinical field and asks Medicus for the same menu item slash uses (`#id-template` or `#id-document`), then clicks the matching control. A slash character is not left in the note. The suite does not submit Medicus’s form.

## Endpoints the catalogue still reads

Host is the practice API base, `https://{siteId}.api.{page hostname}` (for example `https://560b6c.api.england.medicus.health`). The page host returns the SPA HTML shell for these paths. A resource URL that already contains `.api.` wins over the first path segment. Paths stay root-absolute.

| Catalogue step | Method and path |
|---|---|
| Data-entry list | `GET /clinical/data/data-entry-template/list?consultationTopicId=` |
| Document list | `GET /clinical/data/document/template/search/{patientId}?contextId=&contextType=` |
| Consult ids | `GET /clinical/data/encounter/overview/{encounterId}` |

Medicus’s own open (not called by this canvas as a create POST) is still:

- `GET /clinical/data/data-entry-template/create/{consultationTopicId}/{templateId}` then Medicus’s create form
- `GET /clinical/data/document/template/form/{templateId}?patientId=&contextId=&contextType=` then Medicus’s document form
- Built-in letters: `GET /clinical/data/document/template/medicus-template-form/{patientId}?...`

Medicus itself POSTs `/clinical/data-entry-template/create`, `/clinical/data/document/template/create`, or `/clinical/document/template/reflow/create` when the clinician finishes the form. The suite does not POST those.

The template list needs a consultation topic id. Document search needs a patient id, a heading context id, and context type `consultation-topic-heading`. Those are read from the focused field’s `heading-(history|examination|impression|plan)-{uuid}` (that uuid is the heading, not the topic), from request URLs the page has already made, and from a short ring of recent practice-API URLs so a rotated performance buffer does not drop them. The URLs that carry ids are `draft-consultation-topic/{topicId}`, `clinical-summary/summary/{patientId}`, and `topic-heading-entries/{contextId}`. When the page URL has an encounter id and the topic, the patient, or the heading context is still missing, the canvas GETs `encounter/overview/{encounterId}` and reads `consultationTopics[]` (`id` or `consultationTopicId`, plus `patientId`, plus `headings[]`). If several topics are present, the one whose heading matches the focused field is used. A heading row supplies the document context when its id is that uuid, or when the focused field is History, Examination, Impression, or Plan and exactly one heading of that kind has an id. Two headings of the same kind are not a guess: document search is not called, and the gap stays in the footer. Ids are not hardcoded.

## How groups persist

Key: `templateOrganiser.config` in `chrome.storage.local` (practice tier, suite backup scope `templateOrganiser`).

The value is `{ version, surfaces: { templates, documents } }`. Each surface is `{ groups: [{ id, name }], order: { [groupId]: [medicusTemplateId, …] } }`. The lane `ungrouped` (“Not in a group”) is fixed. A fresh install seeds Nursing, Co-op, and Admin on both surfaces, empty. Drag, create, rename, and delete are local until **Save organisation**. That save does not call Medicus.

Medicus template ids are the order keys. Titles are not stored.

## GAPS

The capture file `medicus-native-template-capture` v1 (2026-09-24) has 84 network entries. Two are responses, both `GET /version` with a build string. Every list, form, and consult response body is absent. DOM snapshots are untagged. Drawer HTML shows titles and a publisher (“Primary Care IT”) and the buttons Preview / Use template, and it does not include template UUIDs, so the DOM cannot supply ids. The slash menu list is labelled by `heading-history-{uuid}`. Examination, impression, and plan use the same heading-id shape when that is what Medicus renders; otherwise the launcher accepts an editable field whose previous heading is exactly one of those four words.

Consequences:

- List JSON is parsed defensively (array, or `items` / `data` / `templates` / `results` / `content` / `records` / `list` / `page`). `consultationTopics` is an encounter shape, not a template list. Any other shape shows a gap at the bottom of the canvas and no invented rows. A missing topic, patient, or heading context shows that gap as well. The empty columns are not a successful empty catalogue.
- Open matches a Medicus control by title. Two cards with the same title can hit the first control.
- If Medicus does not open its menu from the field, nothing is written.
- Communication templates were in the capture and are not wired.

## Safety

W25 in `docs/CLINICAL-SAFETY-NOTICE.md`. H-082 in `docs/HAZARD-LOG.md` (pending CSO review). The suite click opens Medicus’s form. It does not POST the record. Copy does not say Done, Sent, Booked, or Submitted.
