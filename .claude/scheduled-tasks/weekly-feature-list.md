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

7. **Convert to .docx**: prefer `pandoc` if available:
   ```
   pandoc docs/feature-list.md -o docs/feature-list.docx \
     --reference-doc=docs/feature-list-template.docx 2>/dev/null \
     || pandoc docs/feature-list.md -o docs/feature-list.docx
   ```
   If pandoc isn't installed, try `apt-get install -y pandoc` once. If that
   also fails, fall back to a small Python script using `python-docx`:
   ```
   pip install --quiet python-docx
   python -c "
   from docx import Document
   import re
   md = open('docs/feature-list.md').read()
   doc = Document()
   for line in md.splitlines():
       if line.startswith('# '):   doc.add_heading(line[2:], 0)
       elif line.startswith('## '): doc.add_heading(line[3:], 1)
       elif line.startswith('### '): doc.add_heading(line[4:], 2)
       elif line.startswith('- '): doc.add_paragraph(line[2:], style='List Bullet')
       elif line.strip():          doc.add_paragraph(line)
   doc.save('docs/feature-list.docx')
   "
   ```

8. **Commit and push**: stage both files, commit with message
   `docs: weekly feature-list refresh (YYYY-MM-DD)`, push to `main`.
   Do NOT bump `manifest.json` version — the .docx isn't a code change.
   Do NOT open a PR.

9. **No-op if unchanged**: after generating, `git diff --stat` the .md file.
   If only the date line changed (i.e. the feature surface didn't move),
   abandon the commit and end silently. This avoids weekly noise commits
   when nothing has changed.

### What NOT to do

- Do NOT modify any code outside `docs/`.
- Do NOT include implementation details, file paths, or function names in
  the output — this is a user-facing document.
- Do NOT exceed 2500 words; trim aggressively.
- Do NOT include marketing language ("powerful", "seamless", "intuitive").
  State what it does plainly.
