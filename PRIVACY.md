# Medicus Suite — Privacy Policy

**Effective date:** 7 August 2026
**Developer:** Graysbrook Ltd (United Kingdom)
**Contact:** Dr Dave Triska — davetriska02@gmail.com

Medicus Suite is a browser extension for clinical and administrative staff in
UK GP practices that use the Medicus electronic patient record. It is a
read-only display layer: it reorganises and surfaces information the signed-in
user can already see in Medicus. This policy explains what data the extension
handles and — more importantly — what it does not do with it.

## The short version

- **All processing happens locally in your browser.** The extension never
  transmits patient data, usage data, or any other personal data to the
  developer or to any third party.
- **There is no analytics, telemetry, advertising, or tracking of any kind.**
- **Nothing is sold, shared, or transferred.** There is no server behind this
  extension and no developer-held database.

## What data the extension processes

When you use Medicus Suite on a `*.medicus.health` page while signed in to
Medicus, the extension reads data already available in your authenticated
session — via the page content and the Medicus API, using your own session
cookies. Depending on the features you use, this can include patient
demographics (name, NHS number, date of birth, age, sex), medications,
observations and test results, problem lists, and appointment/queue metadata.

This is special-category health data. The deploying GP practice remains the
data controller for it, exactly as it is for the Medicus session itself. The
extension introduces no new processing purpose: it displays, to an authorised
user, information that user is already authorised to view, to support direct
care.

## Where data is held

- **Patient-identifiable context (name, NHS number, date of birth) is held in
  memory only** while the relevant page or panel is open. It is not persisted.
- A **minimised subset** of working data is kept in the browser's local
  extension storage (`chrome.storage.local`) on your workstation — for
  example, the request monitor stores patient initials only, and transient
  print/passport data is automatically deleted within 60 seconds. Your own
  configuration (rules, thresholds, preferences) is also stored there.
- **No data is held on any server.** The developer cannot access, and never
  receives, anything the extension processes or stores.

Local data is removed when you uninstall the extension or clear the browser
profile. Optional backup exports are files you create and control yourself.

## What leaves your browser

Nothing that identifies you or any patient. The only outbound network
connections the extension makes are:

1. **The Medicus API (`*.medicus.health`)** — the same service your Medicus
   session already talks to, using your existing sign-in. The extension only
   reads; it writes nothing back to the patient record.
2. **A version check to the GitHub API** (`api.github.com`) — for manually
   installed (unpacked) copies only, a once-daily request to find out whether
   a newer release exists. It carries no personal or patient data. Copies
   installed from the Chrome Web Store do not make this request at all;
   the browser manages their updates.

The feedback feature opens a pre-addressed email in your own mail client — it
is user-initiated, and you see and control everything it contains before
sending.

## Browser permissions

The extension requests only the permissions its features need: access to
`*.medicus.health` pages (to read and annotate the Medicus session), local
storage (configuration and minimised working data), the side panel and pop-out
windows (its user interface), alarms and idle detection (scheduled background
refresh that pauses when the workstation is idle or locked), notifications
(optional local alerts, e.g. new triage requests — these are generated and
displayed entirely on your machine), and tab access (to find and focus your
open Medicus tabs). None of these permissions is used to collect data.

## Chrome Web Store disclosures

For the purposes of the Chrome Web Store's user-data policy: Medicus Suite
does **not** collect or transmit user data. Use of information the extension
handles locally complies with the Chrome Web Store **Limited Use**
requirements — it is used solely to provide the extension's single purpose,
is never sold, is never used for advertising or creditworthiness purposes,
and is never transferred to any party.

## Your rights

Because the developer holds no personal data about users or patients, data
subject requests concerning patient records should be directed to the GP
practice (the data controller) in the usual way. Questions about this policy
or the extension's data handling are welcome at the contact address above.

## Changes to this policy

Material changes will be recorded here with a new effective date, and the
version history is publicly visible in the project repository.
