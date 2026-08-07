# Medicus Suite — Privacy Policy

**Effective date:** 7 August 2026
**Developer:** Graysbrook Ltd (United Kingdom)
**Contact:** Dr Dave Triska — davetriska02@gmail.com

Medicus Suite is a browser extension for clinical and administrative staff in
UK GP practices that use the Medicus electronic patient record. It surfaces
clinical-safety and operational information from the signed-in user's own
Medicus session, and provides clinician-confirmed record tidy-up tools. This
policy explains what data the extension handles, where it goes, and — just as
importantly — what it does not do.

## The short version

- **Processing is local-first.** Patient data the extension displays is read
  from your own authenticated Medicus session and processed in your browser.
- **No analytics, telemetry, advertising, or tracking of any kind.** The
  developer receives no usage data and holds no database of users or patients.
- **Nothing is ever sold, shared for marketing, or used for any purpose other
  than the extension's single function.**
- Two optional integrations, **off by default and enabled only by a
  practice's deliberate configuration**, involve data leaving the browser;
  they are described in full below.

## What data the extension processes

When you use Medicus Suite on a `*.medicus.health` page while signed in, the
extension reads data already available in your authenticated session — via the
page content and the Medicus API, using your own session cookies. Depending on
the features you use, this can include patient demographics (name, NHS number,
date of birth, age, sex), medications, observations and test results, problem
lists, allergies, and appointment/queue metadata.

This is special-category health data. The deploying GP practice remains the
data controller for it, exactly as it is for the Medicus session itself. The
extension introduces no new processing purpose: it works, for an authorised
user, on information that user is already authorised to access, to support
direct care.

**Writes to the record.** The record tidy-up tools (for example problem
description clean-up, ending inactive problems, allergy tidy-up, appointment
booking shortcuts) write to the Medicus record **only on an explicit,
per-action clinician confirmation**, through the same authenticated session,
exactly as if the user had made the change in Medicus directly. Nothing is
written automatically.

## Where data is held locally

- **Patient-identifiable context (name, NHS number, date of birth) is held in
  memory only** while the relevant page or panel is open and is not persisted,
  outside of narrowly minimised exceptions: the request monitor stores patient
  initials only, and transient print/passport data is automatically deleted
  within 60 seconds.
- Your own configuration (rules, thresholds, preferences) and a minimised
  working cache live in the browser's local extension storage
  (`chrome.storage.local`) on your workstation.
- Local data is removed when you uninstall the extension or clear the browser
  profile. Optional backup exports are files you create and control yourself.

## What leaves your browser

**Always (core features):**

1. **The Medicus application (`*.medicus.health` and its API)** — the same
   service your Medicus session already talks to, using your existing sign-in.
2. **NHS terminology and content services** (`termbrowser.nhs.uk`,
   `api.nhs.uk`) — public NHS services queried for SNOMED CT concept
   information and patient-information content. Requests carry only the
   clinical term or concept identifier being looked up — **never any patient
   identifier**.
3. **A version check to the GitHub API** (`api.github.com`) — for manually
   installed (unpacked) copies only, a once-daily request to find out whether
   a newer release exists; it carries no personal or patient data. Copies
   installed from the Chrome Web Store never make this request — the browser
   manages their updates.

**Only when a practice explicitly enables them (off by default):**

4. **Task presence** — a small awareness feature that shows colleagues when
   someone already has a triage request open. Its primary store is a **shared
   folder on the practice's own network** (data never leaves the practice).
   A practice without a shared folder may instead configure a hosted store
   (a practice-controlled Supabase project); in that case the extension
   transmits, while a request is open: the staff member's Medicus identifier
   and display name, an opaque task identifier, the practice site code, and
   timestamps. **No patient data of any kind is included.** Entries
   self-expire.
5. **Transactional API integration** — an optional integration with the
   official Medicus Transactional API. When (and only when) a practice
   completes onboarding and enables it, patient care-record bundles
   (GP Connect FHIR data) are fetched via a backend proxy operated by
   Graysbrook Ltd (hosted in London), which authenticates the request and
   forwards it to Medicus. The proxy is a conduit: it processes the data to
   serve the request and does not use it for any other purpose. This
   integration is read-only and falls back to the normal in-session data
   path if unavailable.

The feedback feature opens a pre-addressed email in your own mail client — it
is user-initiated, and you see and control everything it contains before
sending.

## Browser permissions

The extension requests only the permissions its features need: access to
`medicus.health` pages and the NHS/GitHub/Supabase hosts listed above; local
storage (configuration and minimised working data); the side panel and pop-out
windows (its user interface); alarms and idle detection (scheduled background
refresh that pauses when the workstation is idle or locked); notifications
(optional local alerts, generated and displayed entirely on your machine); and
tab access (to find and focus your open Medicus tabs). None of these
permissions is used to collect data for the developer.

## Chrome Web Store disclosures

For the purposes of the Chrome Web Store's user-data policy: in its default
configuration Medicus Suite transmits no user or patient data to the developer
or any third party beyond the NHS terminology lookups described above (which
contain no personal data). Where a practice opts in to the integrations in
the previous section, the data described there is transmitted solely to
provide the feature. All use of data complies with the Chrome Web Store
**Limited Use** requirements: data is used only to provide the extension's
single purpose, is never sold, is never used for advertising or
creditworthiness purposes, and is never transferred except as described here.

## Your rights

Data subject requests concerning patient records should be directed to the GP
practice (the data controller) in the usual way. Questions about this policy
or the extension's data handling are welcome at the contact address above.

## Changes to this policy

Material changes will be recorded here with a new effective date, and the
version history is publicly visible in the project repository.
