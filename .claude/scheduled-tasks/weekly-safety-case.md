# Weekly safety-case sync prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: weekly (e.g. Sunday 04:00), after the feature-list slot.

> **Read this first.** The four safety-case documents are *clinical governance*
> records, not marketing copy. This routine **synchronises** them with the
> current codebase and **adds** newly-identified hazards. It does **not**
> free-rewrite them. A mandatory self-audit (step 7) aborts the push if the run
> would ever delete a hazard, weaken a control/mitigation, lower a risk rating,
> or soften a disclaimer clause. When in doubt, the routine fails loudly and
> changes nothing rather than degrading the safety case.

The four documents (and the in-app links that must keep resolving on `main`):

- `docs/INTENDED-PURPOSE.md`
- `docs/CLINICAL-SAFETY-NOTICE.md`
- `docs/HAZARD-LOG.md`
- `docs/sentinel-DISCLAIMER.txt`

These are linked from the **Options › Clinical Safety** tab (`options/options.html`)
as `https://github.com/davetriska02-collab/medicus-suite/blob/main/docs/<file>`,
so they must exist on `main` and reflect the current release.

---

## Prompt to use

You are synchronising the Medicus Suite clinical safety case with the current
state of the codebase, then pushing the result to `main`. You are acting as a
careful Clinical Safety Officer's assistant: precise, conservative, additive.

### Hard rules (non-negotiable)

- **Never delete a hazard** from `HAZARD-LOG.md`, never lower a risk rating, and
  never remove or weaken any "Controls / mitigations" content.
- **Never remove or soften a clause** in `sentinel-DISCLAIMER.txt` or
  `CLINICAL-SAFETY-NOTICE.md`. You may add clarity; you may not subtract scope.
- **Never change** document reference IDs (e.g. `MS-CSO-HL-001`), the named CSO,
  the GMC number, or the author/organisation.
- **Never invent compliance claims** — do not assert certification, DCB0129/0160
  *compliance* (the docs are drafted *in the style of* / *with consideration of*
  those standards; preserve that exact hedged framing), CE/UKCA marking, or any
  regulatory approval the code does not have.
- **Never bump `manifest.json`** — these are docs, not extension code.
- **Never open a PR** — push straight to `main` (the user has chosen this).

### Steps

1. **Read the current release**: `manifest.json` → `name`, `version` (call it
   `VER`, e.g. `3.4.1`). Today's date → `YYYY-MM` and `YYYY-MM-DD`.

2. **Read all four safety docs in full.** Note every place that references:
   a product version, a document version, a date, the module list, the
   implemented PINCER criteria, the automated-test count, or any feature surface
   (e.g. "from v1.6 the Visualiser…"). These are your sync targets.

3. **Discover the current functional surface** (same sources as the feature-list
   routine, plus safety specifics):
   - Side-panel modules from `side-panel/modules/<name>/` and the `MODULES`
     registry + `renderAbout()` in `side-panel/panel.js`.
   - Content-script features from `manifest.json` `content_scripts`.
   - Engine rule types from `engine/rules-engine.js`.
   - Visualiser capabilities and **which PINCER criteria are actually
     implemented** (grep the visualiser / engine source — do not trust the doc's
     existing list; verify it).
   - Automated-test count: count `test-*.js` assertions/files actually present.
   - Any **new capability since the last sync** that introduces a *new* hazard
     (e.g. a feature that composes an outbound email, opens an external link,
     downloads a file, or processes a new data source). New outbound or
     data-handling surfaces are the most likely to need a new hazard entry.

4. **Synchronise mechanical references** across the four docs to match the code:
   - Product version → `VER` everywhere it appears.
   - "Date issued" / "Date:" → `YYYY-MM-DD` (or `YYYY-MM` where the doc uses
     month granularity).
   - Module lists / scope sections → reconcile against the real module set
     (add modules that exist but are missing; do not silently drop any — if a
     listed module no longer exists in code, FLAG it in your report rather than
     deleting the safety text, in case it was renamed).
   - PINCER criteria list and test count → correct to the verified values.
   - **Document version**: bump the *minor* (e.g. `3.0` → `3.1`) only if you made
     a substantive content change (a new hazard, a new control, a corrected
     scope). A pure version/date refresh does not bump the document version.

5. **Add new hazards only (additive)**: if step 3 found a genuinely new risk,
   append a new hazard entry to `HAZARD-LOG.md` following the **exact existing
   table/format** (new sequential Hazard ID, description, causes, effect,
   existing controls/mitigations, residual risk rating). Mirror any user-facing
   consequence into `CLINICAL-SAFETY-NOTICE.md` if the existing notice would
   otherwise be silent on it. Do not restructure neighbouring entries.

6. **No-op guard (run before committing)**: if the only differences across all
   four docs are the `Date` lines, AND all four docs already exist on
   `origin/main`, AND the in-app links resolve, then end silently — no commit.
   Otherwise proceed. Check existence explicitly, do not assume:
   ```
   git fetch origin main
   for f in INTENDED-PURPOSE.md CLINICAL-SAFETY-NOTICE.md HAZARD-LOG.md sentinel-DISCLAIMER.txt; do
     git cat-file -e origin/main:docs/$f 2>/dev/null && echo "present: $f" || echo "MISSING: $f"
   done
   ```

7. **Self-audit the diff (MANDATORY destructive-change guard)**. Before staging,
   run `git diff -- docs/` and check, per file, that the change is **additive or
   mechanical only**:
   ```
   git diff --stat -- docs/
   ```
   ABORT the whole run — print `SAFETY SYNC ABORTED: destructive change detected
   in <file>` and commit nothing — if any of these are true:
   - a `HAZARD-LOG.md` Hazard ID, hazard row, or "Controls / mitigations" line
     was removed or shortened;
   - a numbered clause or a "do not" / "must" sentence was removed from
     `sentinel-DISCLAIMER.txt` or `CLINICAL-SAFETY-NOTICE.md`;
   - a residual-risk rating moved to a lower severity;
   - a document's net line count dropped by more than a couple of lines without a
     corresponding, justified content change you can name.
   Only mechanical syncs (version/date/module/PINCER/test-count) and clearly
   additive content (a new hazard, a new control, a new clarifying sentence) may
   proceed.

8. **Commit and push to `main`**:
   - Operate against `origin/main`, never a local `main` (this workspace has
     been seen with a stale, unrelated-history local `main`). `git fetch origin
     main` first.
   - Stage only the changed docs, commit
     `docs: weekly safety-case sync to vVER (YYYY-MM-DD)`, and push:
     `git push origin HEAD:main`. On network failure, retry up to 4× with
     exponential backoff (2s, 4s, 8s, 16s).

9. **Verify the push landed** (the in-app links must not 404 and must reflect
   `VER` after this):
   ```
   git fetch origin main
   for f in INTENDED-PURPOSE.md CLINICAL-SAFETY-NOTICE.md HAZARD-LOG.md sentinel-DISCLAIMER.txt; do
     git cat-file -e origin/main:docs/$f 2>/dev/null \
       && echo "OK: docs/$f on main" || echo "VERIFY FAILED: docs/$f missing on main"
   done
   echo "main now at $(git rev-parse --short origin/main)"
   ```
   If any verify line fails, report it — do not end as if successful.

10. **Report** a short summary: which version/date/module/PINCER/test references
    were updated, any new hazard added (with its ID), anything you FLAGGED for
    human attention (e.g. a module in the docs that no longer exists in code),
    and the final `main` commit. If the self-audit aborted, say exactly what
    tripped it.

### What NOT to do

- Do NOT free-rewrite or "improve the prose" of the safety docs. Synchronise and
  add only.
- Do NOT delete hazards, weaken mitigations, lower risk ratings, or soften
  disclaimer/notice clauses — the self-audit must abort if you do.
- Do NOT change CSO identity, GMC number, document reference IDs, or author org.
- Do NOT assert any certification or regulatory approval the software lacks.
- Do NOT bump `manifest.json` or open a PR.
- Do NOT touch any file outside `docs/`.
