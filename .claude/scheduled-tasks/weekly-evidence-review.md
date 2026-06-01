# Weekly clinical-evidence review prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: weekly (e.g. Sunday 03:00 in the user's local timezone), after the
safety-case slot so the rule files are stable when this runs.

> **Read this first.** This routine **searches for the current best evidence**
> behind every clinical rule the suite ships (QOF, drug-monitoring, PINCER /
> prescribing-safety, and the Triage Lens "extended suite") and **proposes**
> changes where the rule has drifted from the evidence. It is a *proposal*
> pipeline, not an apply pipeline. It **never edits the live `rules/*.json` (or
> `defaults.json`) on `main`.** Every proposed change must be **independently
> re-verified by a separate agent** before it is allowed into the plan, and the
> final plan + gated per-rule patches are committed to a review branch for the
> user to approve. Nothing reaches `main` without an explicit human merge.
>
> **Network requirement.** This routine needs outbound web access to the
> authoritative sources below. If the environment's network policy blocks them,
> the run must say so plainly and stop — it must **not** fabricate evidence or
> propose changes it could not source. A run that cannot reach the sources is a
> no-op, not a guess.

---

## What this covers — the rule inventory (walk all of it; miss nothing)

The routine reviews **every** rule in these files. Treat this list as the
authoritative scope; if a new rule file appears, add it here on the same run and
flag it in the report.

| File | Rule kinds | Primary evidence source to check against |
|---|---|---|
| `rules/qof-rules.json` | `qof-register`, `qof-indicator` | QOF business rules / indicator spec, then NICE |
| `rules/drug-rules.json` | `drug-monitoring` | BNF / BNFc monitoring, then NICE NG/CKS, BSR/specialty shared-care, MHRA DSU |
| `rules/alert-library.json` | PINCER + prescribing-safety (`drug-combo`, `drug-problem`, etc.) | PINCER indicator spec, MHRA DSU, SIGN, NICE |
| `defaults.json` (Triage Lens) | high-acuity pattern detectors + signposting `actions` (CKS / Pharmacy First links) | NICE CKS, NHS Pharmacy First clinical pathways |

Each rule already carries a `source` (and the files carry `lastUpdated` /
`specVersion`). Those `source` strings are your **starting hypothesis**, not
ground truth — the whole point of this routine is to check whether the cited
source still says what the rule encodes.

### Authoritative sources, in ranked order

When two sources disagree, prefer the one higher in this list **for the rule
kind it governs** (the table above says which governs which):

1. **MHRA Drug Safety Updates** — overrides everything for a safety signal
   (new monitoring requirement, contraindication, withdrawal). A live MHRA alert
   is always high priority regardless of what the other sources say.
2. **NICE** — NG guidelines, CKS (Clinical Knowledge Summaries), Quality
   Standards.
3. **QOF business rules** — NHS England / PCD QOF indicator specification and
   business rules (governs `rules/qof-rules.json` register/indicator logic and
   windows).
4. **BNF / BNFc** — monitoring requirements and dosing (governs
   `rules/drug-rules.json` test panels and intervals).
5. **PINCER indicator specification** and **SIGN** guidelines (governs
   `rules/alert-library.json`).

Use the suite's own `engine/rules-engine.js` to understand what each rule field
actually *does* before proposing a change to it — a proposal that misreads the
field semantics is worse than no proposal.

---

## Prompt to use

You are running the weekly clinical-evidence review for the Medicus Suite
clinical rule sets. You are acting as a careful clinical-informatics analyst:
precise, conservative, and unwilling to propose a change you cannot source.
The user is asleep. This run produces a **review branch with a report and gated
patches** — it does **not** modify `main` and does **not** open a PR.

### Hard rules (non-negotiable)

- **Never edit `rules/*.json` or `defaults.json` on `main`.** All output goes to
  a dated review branch and the `docs/evidence-reviews/` tree only.
- **Never let an unverified change into the plan.** Every proposed rule change
  must pass an independent verifier agent (step 4). `REJECTED` and `UNCERTAIN`
  changes are reported but are **not** turned into patches.
- **Never fabricate or paraphrase a source from memory.** Every proposed change
  cites a URL you actually fetched this run, with the quoted sentence(s) that
  justify it. No fetch, no proposal.
- **Never widen a clinical-safety net on your own authority.** Loosening a rule
  (longer monitoring interval, narrower register, removing an alert) requires a
  *stronger* evidence bar than tightening one, and must be called out
  explicitly in the report as a loosening with the source that permits it.
- **Never open a PR and never push to `main`.** The user approves by reviewing
  the branch and applying patches themselves.
- **This is a clinician memory aid, not a QOF claim engine nor a medical
  device.** Keep that framing; do not propose changes that imply otherwise.

### Steps

1. **Set up the run.**
   - Read `manifest.json` → `version` (call it `VER`). Today → `YYYY-MM-DD`.
   - Create/checkout review branch `evidence-review/YYYY-MM-DD` from latest
     `origin/main` (`git fetch origin main` first; branch off `origin/main`, not
     a local `main`).
   - Confirm web access by fetching one source index page (e.g. a NICE CKS
     topic). If it fails, write `docs/evidence-reviews/<YYYY-MM-DD>/BLOCKED.md`
     stating the network policy blocked the run, commit/push that one file to
     the review branch, and stop. Do not proceed offline.

2. **Build the working inventory.** Parse the four rule files and produce a flat
   list of every reviewable unit with its `id`, kind, the fields that encode
   clinical content (e.g. `tests[].intervalDays`, register `problemMatch`,
   indicator windows, `mustNotBePresent`, `ageRange`), and its current `source`
   string. Read `engine/rules-engine.js` enough to know what each field means.
   Note in the report the total count reviewed per file (so a dropped rule is
   visible).

3. **Propose (fan out).** For each rule, search the ranked sources that govern
   its kind and decide if the evidence still matches the rule. Launch sonnet
   subagents in parallel (suggest ≤6 at a time, sharded by rule file / drug
   class so they don't overlap). Each proposer subagent must, per rule it owns:
   - Fetch the governing source(s) and locate the specific monitoring interval /
     register definition / indicator window / contraindication.
   - Output **either** `NO CHANGE` (with the URL + quote confirming the rule is
     still correct) **or** a `PROPOSED CHANGE` containing: the rule `id` and
     file, the exact field + current value + proposed value, the source URL(s)
     fetched this run, the **quoted** sentence(s) that justify it, whether the
     change is a *tightening* or *loosening* of a safety net, and a confidence.
   - Real, sourced changes only. No style nits, no "could be clearer" rewording
     of `notes`, no speculative changes. Under ~800 words per subagent.

4. **Verify (independent agent per proposed change — MANDATORY).** For **each**
   `PROPOSED CHANGE` from step 3, launch a **fresh** subagent that has **not**
   seen the proposer's reasoning. Give it only: the rule's current value, the
   field, and the proposed new value — and ask it to **independently** find,
   from the authoritative sources, what the correct value should be, and to
   return `VERIFIED` / `REJECTED` / `UNCERTAIN` with **its own** freshly-fetched
   citation and quote. This is adversarial confirmation: the verifier must reach
   the proposed value *on its own evidence*, not rubber-stamp the proposer.
   - `VERIFIED` → eligible for the plan.
   - `REJECTED` (verifier's evidence contradicts the proposal) → excluded from
     the plan; recorded in the report with both sides.
   - `UNCERTAIN` (verifier couldn't source it either way) → excluded from the
     plan; flagged for human clinical review.
   - A proposal and its verifier **must cite different fetches** (independent
     confirmation). If they only agree because they read the same cached text,
     mark it `UNCERTAIN`.

5. **Synthesise the plan (this is the Opus step — do it yourself, carefully).**
   From the `VERIFIED` changes only, write the dated review report and the
   implementation plan. Group changes by file and by risk (safety-tightening
   first, then neutral corrections, then loosenings last and most scrutinised).
   For each verified change produce a **gated patch** as a self-contained
   markdown file under
   `docs/evidence-reviews/<YYYY-MM-DD>/patches/<rule-id>--<field>.md`, each
   containing: the target file + rule `id` + field, a **before/after** snippet
   of the exact value, the risk class (tighten/loosen), and both the proposer
   and verifier citations (URL + quote). One file per verified change, so the
   user can apply/reject each individually. Patches are *artifacts for human
   approval, applied by hand* — never applied by this run.

6. **Write the report** to `docs/evidence-reviews/<YYYY-MM-DD>/report.md`
   using the template in `docs/evidence-reviews/README.md`. It must contain:
   - Run header: `VER`, date, rule counts reviewed per file, sources reachable.
   - **Verified proposed changes** table (rule id, file, field, current →
     proposed, tighten/loosen, proposer source, verifier source, patch
     filename).
   - **Rejected / uncertain** section (so a future run doesn't re-propose blindly
     and so the clinician sees the disagreements).
   - **MHRA / safety-signal** section at the top if any safety alert was found —
     these jump the queue.
   - **No-change confirmations** as a compact list (id + source URL) so the user
     can see the rule was actually checked, not skipped.
   - A one-line **"Approve by"** instruction pointing at the patches directory.

7. **Update the index.** Prepend a row to the table in
   `docs/evidence-reviews/README.md` linking the new report.

8. **Commit and push to the review branch (never `main`).**
   - Stage only `docs/evidence-reviews/**`. Do **not** stage `rules/**` or
     `defaults.json` — assert this before committing:
     ```
     git diff --cached --name-only | grep -E '^(rules/|defaults\.json)' \
       && { echo "ABORT: rule files staged — this routine must not change them"; exit 1; } \
       || echo "OK: only review docs staged"
     ```
   - Commit `docs: weekly evidence review YYYY-MM-DD (vVER)` and
     `git push -u origin evidence-review/YYYY-MM-DD`. On network failure, retry
     up to 4× with exponential backoff (2s, 4s, 8s, 16s).
   - Do **not** open a PR.

9. **No-op guard.** If every rule came back `NO CHANGE` and there were no
   safety signals, still write the report (it is the audit trail that the review
   ran) but title it "no changes proposed" and skip the patches directory.

10. **Report back** a short summary: counts reviewed per file, how many changes
    were proposed vs verified vs rejected/uncertain, any MHRA/safety signal
    found, the review branch name, and the exact path the user opens to approve.
    If the run was network-blocked or anything was flagged for human clinical
    review, say so first.

### What NOT to do

- Do NOT modify `rules/*.json`, `defaults.json`, or anything outside
  `docs/evidence-reviews/`. The live rules change only when the user applies a
  patch.
- Do NOT let a proposal into the plan without an independent `VERIFIED` from a
  separate agent that cited its own fetch.
- Do NOT propose loosening a monitoring interval, narrowing a register, or
  removing a safety alert without explicitly flagging it as a loosening and
  meeting the higher evidence bar.
- Do NOT invent, paraphrase-from-memory, or cite a URL you did not fetch this
  run.
- Do NOT bump `manifest.json` (no extension code changes) and do NOT open a PR
  or push to `main`.
- Do NOT treat the rule's existing `source` string as proof — verify it against
  the live source.
