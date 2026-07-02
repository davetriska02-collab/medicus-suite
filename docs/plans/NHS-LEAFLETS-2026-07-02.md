# NHS Patient Leaflets tab — plan — 2026-07-02

Dave's ask: NHS patient advice leaflets in the suite ("I end up sticking it
in Google — NHS wart — and it feels disjointed"). Medicus has no integration.

Feasibility findings (2026-07-02): nhs.uk does not permit cross-origin
framing, so an iframe tab is out. The official route is the **NHS Website
Content API** (NHS England's free syndication programme — Health A-Z,
medicines, common health questions as structured JSON; subscription-key
auth; trial tier 10 calls/min / 1,000 per month; attribution + freshness
terms; the legacy developer portal retires Spring 2026, onboarding is via
the NHS England API catalogue). Exact v2 endpoint/auth details could not be
verified from this sandbox (network policy) — the build must therefore be
config-driven and fail graceful.

**Two-tier design — tier 1 must be fully useful with no key and no network.**

## Tier 1 — bundled A-Z search + open/copy (no config, no new privacy surface)

- New side-panel module `leaflets`: search box, instant fuzzy match over a
  bundled index `rules/nhs-az-index.json` (curated seed: common primary-care
  conditions, name + aliases + slug → https://www.nhs.uk/conditions/{slug}/,
  plus medicines entries → /medicines/{slug}/ where obvious).
- Result actions: **Open** (chrome.tabs.create — user-initiated navigation,
  not an extension fetch), **Copy link** (clipboard, ready for the patient-
  SMS workflow). Recent-leaflets list (last ~10, storage key, in backup).
- ALWAYS append a guaranteed row: "Search nhs.uk for '<term>'" →
  https://www.nhs.uk/search/results?q=<urlencoded> — covers index misses, so
  the tab never dead-ends.
- Index honesty: seed slugs are authored, not scraped (sandbox cannot reach
  nhs.uk). Ship `scripts/verify-nhs-index.js` (Node, plain https) that
  HEAD-checks every slug and reports failures — Dave runs it on a machine
  with normal egress; README in rules/ documents this. Do NOT list entries
  whose slug pattern is guessy — prefer fewer, certain entries (top ~150–250
  presentations: warts, threadworms, impetigo, croup, chickenpox, scarlet
  fever, hand-foot-and-mouth, molluscum, eczema, urticaria, head lice,
  conjunctivitis, styes, otitis media/externa, tonsillitis, sinusitis,
  labyrinthitis, BPPV, plantar fasciitis, carpal tunnel, sciatica, gout,
  shingles, cold sores, UTIs, thrush, BV, menopause, PMS, mastitis, reflux
  in babies, colic, fever in children, sprains, tennis elbow, frozen
  shoulder, Raynaud's, chilblains, iron deficiency, B12 deficiency, IBS,
  diverticular disease, piles, anal fissure, hernias, gallstones, kidney
  stones, migraine, tension headache, cluster headache, insomnia, anxiety,
  depression, panic disorder, health anxiety, restless legs, dry eyes,
  blepharitis, tinnitus, earwax, nosebleeds, hay fever, asthma, COPD, sleep
  apnoea, eustachian tube dysfunction, GORD, coeliac, type 2 diabetes,
  prediabetes, hypertension, high cholesterol, AF, angina, heart failure,
  hypothyroidism, hyperthyroidism, PCOS, endometriosis, fibroids, erectile
  dysfunction, BPH, balanitis, epididymitis, psoriasis, rosacea, acne,
  folliculitis, cellulitis, ringworm, athlete's foot, fungal nails, scabies,
  vitiligo, alopecia, keratosis pilaris, seborrhoeic dermatitis, dandruff,
  ganglion, Dupuytren's, trigger finger, de Quervain's, Achilles
  tendinopathy, bunions, ingrown toenail, verrucas… and the rest of the
  standard GP set where the nhs.uk slug is confidently known).

## Tier 2 — in-panel leaflet rendering via NHS Website Content API (optional)

- Options → Leaflets card: API key field, endpoint base (default
  `https://api.nhs.uk`, overridable — the platform is mid-migration), auth
  header name (default `subscription-key`, overridable), enable toggle, and
  a link to the NHS England API catalogue for onboarding. Config keys in
  backup EXCEPT the API key itself (secrets stay machine-local — document).
- With a key: search hits fetch the condition JSON and render the leaflet
  in-panel — headings/paragraphs only, sanitised (NO innerHTML of remote
  content; build DOM nodes from text — see the repo's XSS test conventions),
  with a **Print** action (letterhead-aware like existing print surfaces if
  cheap, else plain print CSS).
- **Syndication terms honoured:** visible attribution block on every
  rendered leaflet — "From the NHS website" linking to the source page —
  and a 24h render-cache (respect freshness; cache in memory or a small
  capped storage key). Rate-limit courtesy: debounce fetches; one fetch per
  explicit user selection, never per keystroke.
- Fail graceful: any fetch error (401/403/429/network/shape) → tier-1
  behaviour (open in tab) with a calm one-line notice. The module must be
  indistinguishable from tier-1-only when no key is set.
- manifest.json: add `https://api.nhs.uk/*` to host_permissions (and the
  fetch must tolerate a user-configured alternate base by requesting
  optional permission or documenting the default-only constraint — keep it
  simple: fetches allowed to the DEFAULT base only; an overridden base shows
  "open in tab" mode with a note. Do not add broad host permissions).

## Honesty & governance

- README "What it does and does not do" + docs/DPIA.md note: with a key
  configured, the extension contacts api.nhs.uk with the *condition search
  term the user selected* — never patient data. Without a key, no new
  external endpoint is contacted at all. Update the sentence that currently
  claims api.github.com is the only external endpoint.
- No PHI ever in leaflet queries, ledger events for leaflet opens store the
  condition slug with patientRef null.

## New-module checklist (CLAUDE.md — all mandatory)

nav button in side-panel/panel.html AND pop-out/pop-out.html; MODULES entry
in panel.js AND pop-out.js; module files side-panel/modules/leaflets/
(leaflets.js with init/cleanup, leaflets.css); shared/io/leaflets-io.js
(export+import: recent list, config minus API key); VALID_SCOPES in
shared/io/suite-envelope.js; doFullExport()+applyEnvelope() in
options/options.js; previewEnvelope() summary line; script tag + export card
in options/options.html; entry in shared/tab-help.js (coverage test enforces
this); tour: one step for the new tab (TOUR_VERSION bump).

## Tests

- test-leaflets-core.js: fuzzy match (aliases, typos-lite prefix matching),
  guaranteed search-fallback row, recent-list cap, URL building (slug +
  search URL encoding), config gating (no key → no fetch path reachable),
  API response → render-model mapping with a fixture JSON (schema.org
  MedicalWebPage shape), sanitisation (script/style/attributes stripped —
  align with test-xss-attribute-escaping.js conventions).
- test-leaflets-io.js: backup round-trip, API key EXCLUDED from export.
- rules/nhs-az-index.json schema check (unique slugs, lowercase, no spaces).

## Sequencing

Runs AFTER Horizon 1's batches land (H1/H2 touch manifest.json and both
shells — collision risk). Ships as **v3.147.0** with its own CHANGELOG entry
and tour bump. One Sonnet batch + self-finishing (this feature is one
coherent module; splitting it would cost more than it saves).

## Dave's action (only he can do this)

Register for the NHS Website Content API key via the NHS England API
catalogue (the legacy developer.api.nhs.uk portal is retiring/retired as of
Spring 2026). Free. Until then the tab is fully functional in tier 1.
