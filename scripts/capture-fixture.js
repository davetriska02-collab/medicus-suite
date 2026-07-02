// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — DOM-contract FIXTURE capture (READ-ONLY: clicks nothing,
// sends nothing, writes nothing back to Medicus).
//
// Dev / onboarding tool. NOT shipped (scripts/ is excluded from the release
// zip). Paste the IIFE below into the PAGE console (DevTools) on the Medicus
// screen a shared/dom-contracts.js contract cares about (the OIR card, a
// queue row + its preview row, the prescribing form, a lab-filing screen, …)
// to capture a SANITISED HTML snapshot ready to drop into fixtures/medicus/,
// replacing a synthesised fixture with a real one. See
// fixtures/medicus/README.md for the full replace-a-fixture workflow.
//
// Why a page-console capture (not a devtools extension, not a script the
// content script itself runs): the content script runs in the ISOLATED
// world, so the page console can't read its state — but it CAN read shared
// DOM. This mirrors scripts/labfiling-capture.js / scripts/
// booking-flow-capture.js and CLAUDE.md's "Debugging injected queue chips …
// (capture first)" house doctrine — reach for a page-console capture rather
// than reasoning in the abstract.
//
// ── Usage ─────────────────────────────────────────────────────────────────
//   1. In DevTools' Elements panel, select the element you want to capture
//      (it becomes $0) — e.g. the OIR card, a queue row's containing
//      element, the prescribing/lab-filing form. Pick the SMALLEST subtree
//      that still contains everything the relevant contract's `anchor` and
//      `target`/`legacy` selectors need — see the contract's `source` field
//      in shared/dom-contracts.js for exactly what to include.
//   2. Paste this whole file into the Console tab and press Enter once —
//      this defines window.chFixtureCapture and does nothing else yet.
//   3. Preview BEFORE downloading — always look at the sanitised output
//      yourself first:
//        chFixtureCapture.preview($0)
//      This logs the sanitised HTML to the console. Read it. Confirm by eye
//      that no real patient name, DOB, NHS number or free-text clinical
//      content survived (see the sanitisation rules below — they are
//      best-effort, not a guarantee).
//   4. Once you're satisfied, download it:
//        chFixtureCapture.save($0, 'oir.checkbox')
//      The second argument is a short label used only to name the download
//      (it is also embedded in the provenance header). This triggers a
//      normal browser file download — nothing is uploaded anywhere.
//   5. Move the downloaded file into fixtures/medicus/, following the naming
//      convention in fixtures/medicus/README.md, and run
//      `node test-dom-contracts.js` to confirm it satisfies the contract.
//
// ── Sanitisation rules (best-effort — ALWAYS review before committing) ────
//   - Every UUID-shaped substring (patient/task/encounter ids, in text AND
//     attribute values) is replaced with a fixed placeholder UUID.
//   - Every 10-digit run (spaced or not — an NHS number shape, whether or
//     not it happens to pass the Modulus-11 checksum) is replaced with a
//     placeholder.
//   - Common date shapes ("DD Mon YYYY", "DD/MM/YYYY", "YYYY-MM-DD") are
//     replaced with a placeholder date.
//   - Any element matching a "this is a patient identity surface" selector
//     (patient banner / name — the same family lab-file-button.js's
//     readPatientBanner() and CLAUDE.md's patient-identifying conventions
//     use) has ALL of its text content replaced outright — a name inside a
//     banner won't reliably match a generic pattern, so the whole surface is
//     redacted rather than pattern-matched.
//   - Attributes most likely to carry a raw identifier by name
//     (data-patient-id / data-patientid / data-patient / data-pid /
//     data-nhs-number) are also sanitised.
//   - Every OTHER attribute value and text node is scanned with the same
//     UUID/NHS-number/date patterns (covers aria-label, title, placeholder,
//     value, href, and ordinary text).
//   - Comments and <script>/<style> content are stripped entirely (never
//     needed for a selector fixture, and a stray inline script is a smell
//     either way).
//   - What is DELIBERATELY NOT touched: tag names, class names, id/role/
//     aria-* attribute NAMES (only string VALUES are sanitised), and other
//     structural markup — a fixture is only useful if the selectors this
//     registry declares still match it.
//
// This is a heuristic sanitiser, not a certified de-identification tool.
// Nothing captured by this script leaves the browser except via the file you
// explicitly choose to save and then commit — review it like you would any
// other diff before it goes in.

/* eslint-disable */
(function () {
  const PLACEHOLDER_UUID = 'deadbeef-dead-4eef-8eef-deadbeefdead';
  const PLACEHOLDER_NHS = '000 000 0000';
  const PLACEHOLDER_DATE = '01 Jan 2026';
  const PLACEHOLDER_NAME = 'Placeholder Patient';

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  // NHS-number SHAPE (10 digits, optionally space/hyphen-grouped) — redacted
  // regardless of checksum validity, since shape alone is enough to be PHI-risk.
  const NHS_SHAPE_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/g;
  const DATE_RE_1 = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi;
  const DATE_RE_2 = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
  const DATE_RE_3 = /\b\d{4}-\d{2}-\d{2}\b/g;

  // Attribute NAMES known to carry a raw identifier directly (regardless of
  // whether the VALUE happens to look UUID/NHS-shaped) — nulled outright.
  const IDENTITY_ATTR_NAMES = ['data-patient-id', 'data-patientid', 'data-patient', 'data-pid', 'data-nhs-number'];

  // Selectors identifying "this subtree IS a patient's identity" — mirrors
  // lab-file-button.js's readPatientBanner() selector family. Every text node
  // inside a MATCHING element (not just the element itself) is blanked.
  const IDENTITY_SURFACE_SEL = '[class*="patient-banner"], [class*="patientBanner"], [data-test*="patient-name"]';

  function sanitiseString(s) {
    if (s == null) return s;
    return String(s)
      .replace(UUID_RE, PLACEHOLDER_UUID)
      .replace(DATE_RE_1, PLACEHOLDER_DATE)
      .replace(DATE_RE_2, PLACEHOLDER_DATE)
      .replace(DATE_RE_3, '2026-01-01')
      .replace(NHS_SHAPE_RE, PLACEHOLDER_NHS);
  }

  function sanitiseSubtree(root) {
    // 1. Strip comments and script/style content entirely (never needed for a
    //    selector fixture; a stray inline <script> in a fixture is a smell).
    root.querySelectorAll('script, style').forEach((el) => el.remove());
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null);
    const comments = [];
    let cn;
    while ((cn = walker.nextNode())) comments.push(cn);
    comments.forEach((c) => c.remove());

    // 2. Blank every text node inside a known patient-identity surface outright.
    root.querySelectorAll(IDENTITY_SURFACE_SEL).forEach((el) => {
      el.querySelectorAll('*').forEach((child) => {
        for (const node of child.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = PLACEHOLDER_NAME;
        }
      });
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = PLACEHOLDER_NAME;
      }
    });

    // 3. Walk every element: sanitise attribute values + text nodes.
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (el.attributes) {
        for (const attr of Array.from(el.attributes)) {
          if (IDENTITY_ATTR_NAMES.includes(attr.name.toLowerCase())) {
            el.setAttribute(attr.name, PLACEHOLDER_UUID);
            continue;
          }
          const sanitised = sanitiseString(attr.value);
          if (sanitised !== attr.value) el.setAttribute(attr.name, sanitised);
        }
      }
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent) {
          const sanitised = sanitiseString(node.textContent);
          if (sanitised !== node.textContent) node.textContent = sanitised;
        }
      }
    }
    return root;
  }

  function provenanceHeader(label) {
    const lines = [
      `  Fixture: ${label || '(unlabelled)'}`,
      `  Provenance: CAPTURED from a live page on ${new Date().toISOString().slice(0, 10)}, `,
      `  sanitised via scripts/capture-fixture.js. URL path pattern only — no query`,
      `  string or full URL retained. REVIEW BEFORE COMMIT: confirm no real patient`,
      `  name, DOB, NHS number or free-text clinical content survived sanitisation.`,
      `  See fixtures/medicus/README.md for the replace-a-fixture workflow.`,
    ];
    return `<!--\n${lines.join('\n')}\n-->\n`;
  }

  function buildFixtureHtml(el, label) {
    const clone = el.cloneNode(true);
    sanitiseSubtree(clone);
    return provenanceHeader(label) + clone.outerHTML;
  }

  function resolveEl(elOrSelector) {
    if (!elOrSelector) throw new Error('chFixtureCapture: pass an element (e.g. $0) or a CSS selector string');
    if (typeof elOrSelector === 'string') {
      const found = document.querySelector(elOrSelector);
      if (!found) throw new Error(`chFixtureCapture: selector "${elOrSelector}" matched nothing`);
      return found;
    }
    return elOrSelector;
  }

  window.chFixtureCapture = {
    // Returns the sanitised HTML string without downloading anything.
    build: function (elOrSelector, label) {
      return buildFixtureHtml(resolveEl(elOrSelector), label);
    },
    // Logs the sanitised HTML to the console for review — ALWAYS run this
    // before save().
    preview: function (elOrSelector, label) {
      const html = buildFixtureHtml(resolveEl(elOrSelector), label);
      console.log(html);
      console.log(
        '%cReview the above BEFORE calling save() — confirm no real patient name/DOB/NHS number/free text survived.',
        'color:#b45309;font-weight:bold'
      );
      return html;
    },
    // Triggers a normal browser download of the sanitised HTML — nothing is
    // uploaded anywhere. `label` is used only for the filename + header.
    save: function (elOrSelector, label) {
      const html = buildFixtureHtml(resolveEl(elOrSelector), label);
      const safeLabel = String(label || 'capture').replace(/[^a-z0-9.-]+/gi, '-');
      const filename = `${safeLabel}-${new Date().toISOString().slice(0, 10)}.html`;
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      console.log(
        `[capture-fixture] saved ${filename} — move it into fixtures/medicus/ and review it before committing.`
      );
      return filename;
    },
  };

  console.log(
    '[capture-fixture] ready. Select an element in Elements ($0), then run:\n' +
      '  chFixtureCapture.preview($0)   // review sanitised HTML first\n' +
      "  chFixtureCapture.save($0, 'contract.id')   // download once satisfied"
  );
})();
