# Template and document organiser

Practice overlay on Medicus’s own template and document lists. It is not Suite Phrases, Practice Knowledge, or an allocate canvas.

The pack `suite.ui.templateOrganiser` is off until Options → Practice features switches it on. The **Organise templates…** button mounts on a consultation or plan URL (`/clinical/encounter/`, `/clinical/plan`) and while a Data Entry Templates, Document Templates, or New Document drawer is open.

## Endpoints wired

Same-origin on the page host, the way the 2026-09-24 slash capture called them (`sameOrigin: true`). Paths are root-absolute. The capture did not use a separate `{practice}.api` host.

| Slash step | Method and path |
|---|---|
| Data-entry list | `GET /clinical/data/data-entry-template/list?consultationTopicId=` |
| Data-entry form | `GET /clinical/data/data-entry-template/create/{consultationTopicId}/{templateId}` |
| Data-entry insert | `POST /clinical/data-entry-template/create` |
| Document list | `GET /clinical/data/document/template/search/{patientId}?contextId=&contextType=` |
| Document form | `GET /clinical/data/document/template/form/{templateId}?patientId=&contextId=&contextType=` |
| Document preview | `POST /clinical/template/preview-document/{templateId}` |
| Document insert | `POST /clinical/data/document/template/create` |
| Built-in letter form | `GET /clinical/data/document/template/medicus-template-form/{patientId}?contextId=&contextType=` |
| Built-in letter preview | `POST /clinical/document/template/preview-reflow-document/{slug}` |
| Built-in letter insert | `POST /clinical/document/template/reflow/create` |

Consult reads used only to find ids or `sortOrder` + `sortOrderHash` (no new write):

- `GET /clinical/data/encounter/overview/{encounterId}`
- `GET /clinical/data/encounter/consultation-topic/draft-consultation-topic/{consultationTopicId}`
- `GET /clinical/encounter/consultation-topic/topic-heading-entries/{contextId}`

Ids are taken from the encounter overview path and from request URLs the page has already made. They are not hardcoded.

Insert runs only after the matching GET returns the fields the slash POST sent. Data-entry needs a `form` object and `dataEntryTemplateVersionId`. Documents need `formValues`, both visibility booleans, and a consult object that already contains `sortOrder` and `sortOrderHash` together. The hash is copied. It is not calculated. Preview POST runs immediately before document create, in that order. A missing field returns a gap and does not POST.

## How groups persist

Key: `templateOrganiser.config` in `chrome.storage.local` (practice tier, suite backup scope `templateOrganiser`).

The value is `{ version, surfaces: { templates, documents } }`. Each surface is `{ groups: [{ id, name }], order: { [groupId]: [medicusTemplateId, …] } }`. The lane `ungrouped` (“Not in a group”) is fixed. A fresh install seeds Nursing, Co-op, and Admin on both surfaces, empty. Drag, create, rename, and delete are local until **Save organisation**. That save does not call Medicus. **Use** on a card is the separate insert.

Medicus template ids are the order keys. Titles are not stored.

## GAPS

The capture file `medicus-native-template-capture` v1 (2026-09-24) has 84 network entries. Two are responses, both `GET /version` with a build string. Every list, form, and consult response body is absent. DOM snapshots are untagged. Drawer HTML shows titles and a publisher (“Primary Care IT”) and the buttons Preview / Use template, and it does not include template UUIDs, so the DOM cannot supply ids.

Consequences:

- List JSON is parsed defensively (array, or `items` / `data` / `templates` / `results` / `content` / `records`). Any other shape shows a gap and no invented rows.
- Data-entry insert does not guess opaque form keys. The live form GET must already contain `form` and `dataEntryTemplateVersionId`.
- Document and reflow insert do not guess `sortOrderHash`. If the consult GETs above do not return that pair, insert does not run.
- Visibility flags are not defaulted. The food-bank capture had `hiddenFromPatientFacingServices: true` because someone set it. A form GET that omits the booleans does not insert.
- Communication templates were in the capture (`GET /communication/data/content/communication-template-options`, `GET /communication/data/content/format-communication-template`, `POST /care-record/communication/create-care-record-communication`) and are not wired. The create body includes a message, recipients, and assignee fields this capture did not return.

## Safety

W25 in `docs/CLINICAL-SAFETY-NOTICE.md`. H-082 in `docs/HAZARD-LOG.md` (pending CSO review). Copy on the canvas does not say Done, Sent, Booked, or Submitted. “Medicus accepted the insert” is used only after the create POST returns ok.
