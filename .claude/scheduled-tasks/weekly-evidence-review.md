# Weekly evidence-review prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: **weekly** (e.g. Sunday 03:00, after the bug-bash slot). This routine
**proposes** evidence-backed changes to the suite's clinical rules; it **never**
edits the live rules on `main`. Every proposed change is independently verified
by a separate agent, Opus synthesises a build plan, and **you approve** before
anything is applied.

> **Read this first.** The rule files are *clinical decision-support content*,
> not marketing copy. A wrong interval or a dropped monitoring test is a patient
> -safety hazard. This routine is **conservative and additive in its proposals**:
> it surfaces discrepancies between the shipped rules and current best evidence,
> has each one *independently re-checked*, and leaves the live rules untouched
> until you sign off. When evidence is ambiguous or a verifier disagrees, the
> change is **dropped to "needs human review", never silently applied**.

## Network prerequisite

This routine needs **outbound web access** to NICE, BNF, NHS England / PCD, the
PINCER spec, SIGN and MHRA. If the environment's network policy blocks these,
the run will produce a thin report — note that and stop rather than guessing
from memory. (See the environment's network-policy docs.)

## The rule surface this routine reviews

Walk **every** rule in these files — do not sample. Each already carries a
`source` / `notes` field; your job is to check that source is still current.

| File | What it holds | Count today | Authoritative source(s) |
|---|---|---|---|
| `rules/qof-rules.json` | QOF registers + indicators (`type: qof-register` / `qof-indicator`); has `specVersion` (e.g. `QOF 2026/27`) | ~48 entries | **NHS England QOF business rules / indicator spec** for the stated year, NICE indicator menu (NM/IND IDs) |
| `rules/drug-rules.json` | Drug-monitoring rules (`type: drug-monitoring`): tests + `intervalDays` + `dueSoonDays` per drug/class | ~19 rules | **BNF / BNFc** monitoring requirements, **NICE NG/CKS**, BSR/specialty shared-care, **MHRA Drug Safety Update** |
| `rules/alert-library.json` | PINCER + prescribing-safety alerts (`drug-combo`, age/problem logic) | ~5 (`pincer-*`) | **PINCER indicator spec** (BMJ 2012 doi:10.1136/bmj.e6501 + updates), **SIGN**, **MHRA** |
| `defaults.json` (+ `content-scripts/triage-lens/defaults.json`) — the **extended suite** | Triage Lens detection rules: `actions[]` link to **NICE CKS** topics and **NHS Pharmacy First** pathways | ~24 rules | **NICE CKS**, **NHS Pharmacy First** clinical pathways |

If new rule files or rule types have been added since this prompt was written,
**discover them** (`grep -rl '"type"' rules/`, check `engine/rules-engine.js`
for the rule-type registry) and review them too. Report any you found that this
table does not list.

---

## Prompt to use

You are running the **weekly clinical evidence review** for the Medicus Suite
Chrome extension. You are acting as a careful Clinical Decision-Support analyst:
precise, conservative, and evidence-led. The user is **asleep** — this run
produces a **written report plus gated, ready-to-apply patch files**. It does
**not** modify the live rules and does **not** open a PR. The user reviews and
approves each patch in the morning.

### Hard rules (non-negotiable)

- **Never edit `rules/*.json`, `defaults.json`, or any shipped rule file in
  place.** Proposed changes live only as patch files under the dated review
  folder until the user applies them.
- **Never push to `main`.** Work on the session's dev branch only.
- **Never apply a change your verifier did not VERIFY.** A proposal that is
  REJECTED or UNCERTAIN goes into the report under "Needs human review" with the
  disagreement spelled out — it does **not** become a patch.
- **Never weaken a safety control to chase a citation.** Lengthening a
  monitoring interval, dropping a test, narrowing a register, or downgrading an
  alert severity requires *two* independent authoritative sources and an
  explicit, named justification — and even then it is proposed, never applied.
- **Treat MHRA Drug Safety Updates as the highest-priority signal.** A new MHRA
  contraindication or monitoring requirement is flagged at the top of the report
  regardless of how small the rule change looks.
- **Preserve provenance.** Every proposed change must name its source (title,
  publisher, year, URL) and the *primary* evidence — not a blog or summary.
- **This is a clinician memory aid, not a QOF claim engine or a medical device
  output.** Do not assert it is. Keep the existing hedged framing in `notes`.

### Step 1 — Set up the run

1. Read `manifest.json` → `version` (call it `VER`). Today → `YYYY-MM-DD`.
2. Confirm you are on the dev branch (not `main`):
   `git rev-parse --abbrev-ref HEAD`.
3. Create the dated review workspace:
   - `docs/evidence-reviews/<YYYY-MM-DD>/report.md` — the human-readable review
   - `docs/evidence-reviews/<YYYY-MM-DD>/patches/` — one file per VERIFIED change
4. Read the full rule surface (the table above). Build an in-memory inventory of
   every rule with its `id`, current `source`/`specVersion`, and the specific
   clinical claim it encodes (e.g. "methotrexate maintenance FBC every 84 days").

### Step 2 — Fan out the evidence search (PROPOSER agents)

Launch parallel **sonnet** subagents, each scoped to one rule family so they do
not overlap (suggested: QOF registers, QOF indicators, DMARD monitoring, other
drug monitoring, PINCER/prescribing-safety, Triage Lens CKS/Pharmacy First).
Each proposer agent must:

- For each rule in its scope, search the **authoritative source(s)** named for
  that file (rank them in the order given — primary spec first, never a
  secondary summary).
- Compare the *current* guidance to what the rule encodes. Output, per rule, one
  of: `OK` (matches current evidence), `STALE` (source year/spec is behind),
  `DISCREPANCY` (a value/term/logic no longer matches), or `NEW-SIGNAL` (e.g. a
  fresh MHRA contraindication not yet reflected).
- For each non-`OK` rule, draft a **precise proposed change**: the exact field,
  the old value, the proposed new value, the source (title/publisher/year/URL),
  and a one-paragraph clinical justification. Quote the primary source.
- **Real, sourced discrepancies only.** No "could be tightened" opinions, no
  reformatting, no SNOMED guesses. Under ~1200 words per agent. file + rule `id`
  + field + old→new + citation per finding.

### Step 3 — Independent verification (VERIFIER agents — the gate)

For **every** proposed change from step 2, spawn a **fresh, separate** subagent
as an adversarial verifier. Critically:

- The verifier is given **only** the rule `id`, the field, and the *proposed new
  value* — **not** the proposer's reasoning or citation. It must independently
  find the current authoritative guidance and decide whether the proposed value
  is correct.
- The verifier returns exactly one verdict with its **own** primary citation:
  - `VERIFIED` — independently confirms the proposed value against an
    authoritative primary source (and, for any safety-weakening change, finds
    the *second* required source).
  - `REJECTED` — the proposed value is wrong or unsupported; states the correct
    value if known.
  - `UNCERTAIN` — evidence is ambiguous, conflicting, or behind a paywall it
    could not confirm.
- A proposal is promoted to a patch **only** if the verifier returns `VERIFIED`
  **and** its independently-found value matches the proposer's. Any mismatch
  between proposer and verifier → treat as `UNCERTAIN` and route to "Needs human
  review".

Do not let the same agent both propose and verify a change.

### Step 4 — Opus synthesis (build plan + gated patches)

You (Opus) synthesise the verified set into an implementation plan:

1. **Group** verified changes by file and by risk class (mechanical
   source/date refresh < value change < safety-weakening change).
2. For each VERIFIED change, write a **patch file** to
   `docs/evidence-reviews/<date>/patches/<rule-id>--<field>.md` containing:
   - The target file and rule `id`.
   - A fenced **before / after** JSON snippet of just the changed fields (a
     minimal, apply-by-hand diff — do **not** pre-edit the rule file).
   - Source (title, publisher, year, URL) + the verifier's independent citation.
   - Risk class and, for any safety-weakening change, the two-source
     justification.
   - A one-line `apply:` instruction naming the exact edit.
3. Order patches by clinical priority: MHRA `NEW-SIGNAL` first, then safety
   -tightening, then value corrections, then `STALE` source/spec refreshes.
4. Flag any change that needs a **rules-engine code change** (e.g. a new
   `type`, multi-observation logic) separately under "Engine work required" —
   these are not simple JSON patches.

### Step 5 — Write the report

`docs/evidence-reviews/<date>/report.md` (Markdown), with:

- **Header**: date, `VER`, sources consulted (with the spec/guideline versions
  you actually read), rule counts reviewed per file.
- **🔴 Priority signals** (MHRA / new contraindications) — top of the report.
- **Proposed & verified changes** — a table: file · rule `id` · field · old →
  new · source · verifier verdict · patch filename. Link each to its patch.
- **Needs human review** — proposals that were REJECTED/UNCERTAIN or where
  proposer and verifier disagreed, with both positions stated.
- **Confirmed current** — a short list of rules checked and found `OK` (so the
  review is auditable and you can see coverage), grouped by file.
- **Coverage & gaps** — any rule family not fully checked (e.g. paywalled BNF
  monograph), any new rule file discovered, any source the network blocked.
- **Footer**: "Proposals only — no live rule was modified. Apply via the patch
  files after clinical review. Not for QOF claim purposes."

Append a one-line entry to `docs/evidence-reviews/README.md`'s index table
(date · #verified · #needs-review · priority-signal y/n · link to the report).

### Step 6 — Commit to the dev branch (no PR, no `main`)

- Stage only `docs/evidence-reviews/**`. Commit:
  `docs(evidence): weekly evidence review <YYYY-MM-DD> (N verified, M for review)`.
- Push to the dev branch: `git push -u origin HEAD`. On network failure, retry
  up to 4× with exponential backoff (2s, 4s, 8s, 16s).
- Do **not** open a PR. Do **not** bump `manifest.json` (no extension code
  changed — only proposals were written).

### Step 7 — Report back

End with a short summary: how many rules reviewed, how many changes VERIFIED vs
routed to human review, any 🔴 priority signal, the review-folder path, and the
pushed commit. If the network blocked key sources or no discrepancies were
found, say so plainly — a clean week is a valid, valuable result.

### What NOT to do

- Do NOT edit `rules/*.json`, `defaults.json`, or any live rule file.
- Do NOT push to `main` or open a PR.
- Do NOT promote a proposal the verifier did not independently VERIFY.
- Do NOT cite secondary summaries/blogs in place of the primary spec/guideline.
- Do NOT invent SNOMED codes, interval values, or QOF indicator IDs — if you
  cannot confirm one, route it to "Needs human review".
- Do NOT let one agent both propose and verify the same change.
- Do NOT bump `manifest.json`. Do NOT touch any file outside
  `docs/evidence-reviews/`.
