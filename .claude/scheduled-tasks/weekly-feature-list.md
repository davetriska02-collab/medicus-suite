# Weekly feature-list generator prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: weekly (e.g. Sunday 03:00). Runs after the bug-bash slot so the two
don't fight for resources.

---

## Prompt to use

You are generating a current-state feature inventory for the medicus-suite
Chrome extension. The output is a Word document (`docs/feature-list.docx`)
plus its Markdown source (`docs/feature-list.md`), both committed to `main`
so the side-panel "About" tab can hotlink to them.

### Steps

1. **Read the version**: `manifest.json` → use `version` and `name`.

2. **Discover modules**: list the side-panel modules from
   `side-panel/modules/<name>/`. For each, read the `init()` JSDoc, the
   module's CSS comment block, and the `renderAbout()` block in
   `side-panel/panel.js` to extract:
   - Module name + version (if shown in the About card)
   - One-paragraph "what it does"
   - Key features as bullets (3–7 each)

3. **Discover engine capabilities**: read `engine/rules-engine.js` evaluators
   (drug-monitoring, qof-register, qof-indicator, drug-combo, event-count,
   composite, observation-trend) and summarise what each rule type can do
   from a user's perspective. Reference `rules/alert-library.json` for the
   bundled starter alerts (count + categories).

4. **Discover content scripts**: from `manifest.json`'s `content_scripts`,
   list the in-page features (triage lens, sentinel, referrals discovery,
   pusher relay) and what page they activate on.

5. **Recent changes**: read `CHANGELOG.md` and summarise the last 4 weeks
   of entries grouped by theme. Don't dump the whole changelog — synthesise.

6. **Compose the Markdown** at `docs/feature-list.md` with this structure:

   ```markdown
   # Medicus Suite — Feature List

   **Version:** v<X.Y.Z>
   **Generated:** YYYY-MM-DD (automated)

   ## What it is
   One-paragraph elevator pitch. Audience: a new GP user, not a developer.

   ## At a glance
   - N side-panel modules
   - M content-script features (in-page overlays)
   - K rule types in the alert engine
   - L bundled starter alerts in the library

   ## Side-panel modules
   ### <Module Name> <version>
   <paragraph>
   - bullet
   - bullet

   ## In-page features (content scripts)
   ...

   ## Alert engine
   ...

   ## Settings & customisation
   - Practice Profile (shared-folder managed deployment)
   - Backup / restore (suite-wide envelope)
   - Display preferences (theme, density, colourblind mode)

   ## Recent additions (last 4 weeks)
   - **vX.Y.Z (date)** — one-line summary
   ...

   ## Safety posture
   Brief note: passive display only, no record writes, no AI inference,
   all data stays in the browser. Reference INTENDED-PURPOSE.md.
   ```

   Aim for 1500–2500 words total. Tight, scannable, no marketing fluff.

7. **No-op guard (run BEFORE generating the .docx)**: this routine must
   produce `docs/feature-list.docx`, because the side-panel About tab hotlinks
   to it at `.../raw/main/docs/feature-list.docx`. Skip the run **only if both**
   of these hold:
   - the new `docs/feature-list.md` differs from the copy on `origin/main`
     **only** in the `Generated:` date line (i.e. the feature surface didn't
     move), **and**
   - `docs/feature-list.docx` already exists on `origin/main`.

   Check existence explicitly — do not assume it's there:
   ```
   git fetch origin main
   git cat-file -e origin/main:docs/feature-list.docx 2>/dev/null \
     && echo "docx present on main" || echo "DOCX MISSING — must regenerate"
   ```
   If the docx is missing, **always proceed** even when the .md is unchanged.
   This is the exact bug that left the link 404ing: the old guard abandoned the
   commit whenever the .md looked stable, so the .docx was never committed.

8. **Convert to .docx (mandatory — never skip, never end silently on failure)**.
   Try converters in order; the first that works wins:
   ```
   # (a) pandoc if already installed
   command -v pandoc >/dev/null && pandoc docs/feature-list.md -o docs/feature-list.docx
   # (b) install pandoc once if (a) absent
   # (c) python-docx fallback (no system packages; this is the reliable path)
   python3 -c "import docx" 2>/dev/null || pip install --quiet python-docx
   ```
   Then, if pandoc didn't produce the file, generate it with this script
   (handles `###` sub-headings, `**bold**`, and strips inline `code` backticks
   so the Word doc reads cleanly):
   ```
   python3 - <<'PY'
   import re
   from docx import Document
   md = open('docs/feature-list.md').read()
   doc = Document()
   def add_runs(p, text):
       for seg in re.split(r'(\*\*[^*]+\*\*)', text):
           if not seg: continue
           if seg.startswith('**') and seg.endswith('**'):
               r = p.add_run(seg[2:-2]); r.bold = True
           else:
               p.add_run(seg.replace('`', ''))
   for raw in md.splitlines():
       line = raw.rstrip()
       if not line.strip(): continue
       if   line.startswith('### '): doc.add_heading(line[4:], 2)
       elif line.startswith('## '):  doc.add_heading(line[3:], 1)
       elif line.startswith('# '):   doc.add_heading(line[2:], 0)
       elif line.lstrip().startswith('- '):
           add_runs(doc.add_paragraph(style='List Bullet'), line.lstrip()[2:])
       else:
           add_runs(doc.add_paragraph(), line)
   doc.save('docs/feature-list.docx')
   PY
   ```
   **Verify the artefact before committing.** It must exist and be a valid
   OOXML zip:
   ```
   python3 -c "import zipfile,sys; sys.exit(0 if zipfile.is_zipfile('docs/feature-list.docx') else 1)"
   ```
   If no converter succeeds or the verify fails, **STOP and report loudly** —
   print `ROUTINE FAILED: could not generate a valid docs/feature-list.docx`
   and end **without committing**. Do NOT commit the .md alone (that recreates
   the 404), and do NOT end silently.

9. **Commit and push to `main`**:
   - Always operate against `origin/main`, never a local `main` branch — this
     workspace has been seen with a stale, unrelated-history local `main`.
     `git fetch origin main` first.
   - Stage **both** files (`git add docs/feature-list.md docs/feature-list.docx`),
     commit `docs: weekly feature-list refresh (YYYY-MM-DD)`, and push to `main`.
     A fast-forward push of your working ref to main is fine:
     `git push origin HEAD:main`. On network failure, retry up to 4× with
     exponential backoff (2s, 4s, 8s, 16s).
   - Do NOT bump `manifest.json` — the docs aren't a code change. Do NOT open a PR.

10. **Verify the push landed** (the link can't 404 after this passes):
    ```
    git fetch origin main
    git cat-file -e origin/main:docs/feature-list.docx \
      && echo "OK: docx on main ($(git cat-file -s origin/main:docs/feature-list.docx) bytes, commit $(git rev-parse --short origin/main))" \
      || echo "VERIFY FAILED: docx not on main after push"
    ```
    If verification fails, report it — do not end as if successful.

### What NOT to do

- Do NOT modify any code outside `docs/`.
- Do NOT include implementation details, file paths, or function names in
  the output — this is a user-facing document.
- Do NOT exceed 2500 words; trim aggressively.
- Do NOT include marketing language ("powerful", "seamless", "intuitive").
  State what it does plainly.
