# Security Policy

Medicus Suite is a Chrome (Manifest V3) extension used inside UK GP practices.
It reads the clinician's already-authenticated Medicus session to surface
clinical and operational information. It handles patient-identifiable data, so
security and data-minimisation are treated as patient-safety properties, not
just engineering hygiene.

## Reporting a vulnerability

Please report suspected security or privacy issues **privately** — do not open a
public GitHub issue for anything that could expose patient data or a usable
exploit path.

- **Email:** Dr Dave Triska — davetriska02@gmail.com
- Include: affected version (see `manifest.json`), a description of the issue,
  and a reproduction or proof-of-concept if you have one.
- Please allow a reasonable window for a fix before any public disclosure.

You will normally get an acknowledgement within a few days. Verified issues that
affect patient data are prioritised and remediated in a point release, with the
finding recorded in [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).

## Supported versions

Only the **latest released version** is supported. The extension checks this
repository daily and surfaces an update banner; users are expected to keep
current. Fixes ship in the newest release rather than being back-ported.

## Scope

In scope:

- The extension's own code (`side-panel/`, `pop-out/`, `content-scripts/`,
  `engine/`, `shared/`, `options/`, `service-worker.js`, the visualiser).
- Cross-context messaging, `chrome.storage.local` handling, and backup
  import/export validation.
- Vendored third-party libraries under `vendor/` (integrity is enforced by
  `scripts/verify-vendor.js` in CI).

Out of scope:

- The Medicus host application and its API — owned by Medicus, not this project.
- Sentry telemetry and Vue warnings originating from the Medicus page itself.
- Dev-only tooling in `package.json` `devDependencies` (ESLint/Prettier); none of
  it is executed in the browser or shipped in the release zip (see
  [`docs/SOUP.md`](docs/SOUP.md)).

## How security is maintained

- **Regular adversarial audits.** Red-team passes sweep the extension's attack
  surfaces (manifest/permissions, content-script XSS, cross-context messaging,
  storage/PII, backup import, network/exfiltration, visualiser/PDF, and clinical
  rule logic). Findings, severities, and remediations are logged in
  [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).
- **Software bill of materials.** Vendored runtime libraries and their CVE
  disposition are tracked in [`docs/SOUP.md`](docs/SOUP.md); checksums are pinned
  in `vendor-versions.json` and verified on every CI run.
- **Data minimisation.** The extension contacts only `api.github.com` (update
  checks, no patient data) besides the user's own Medicus session. It does not
  create, modify, or transmit patient records to any external server.

## Related documents

- [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) — audit history and findings
- [`docs/SOUP.md`](docs/SOUP.md) — software of unknown provenance register
- [`docs/CLINICAL-SAFETY-NOTICE.md`](docs/CLINICAL-SAFETY-NOTICE.md) — clinical safety
- [`docs/INTENDED-PURPOSE.md`](docs/INTENDED-PURPOSE.md) — intended purpose and limits
