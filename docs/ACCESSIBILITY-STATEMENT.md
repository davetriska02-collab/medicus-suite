# Medicus Suite — Accessibility Statement

**Document reference:** MS-DOC-A11Y-001
**Product version:** 3.84.2
**Document version:** 1.0 (DRAFT — pending sign-off)
**Date:** 2026-06-14
**Manufacturer:** Graysbrook Ltd
**Contact:** Dr Dave Triska — dave@graysbrook.co.uk

---

## Scope

This statement applies to the user-facing surfaces of the Medicus Suite Chrome
extension: the side panel (`side-panel/`), the floating pop-out window
(`pop-out/`), the options/settings pages (`options/`, `sentinel-options/`), and
the full-tab Patient Record Visualiser. It does **not** cover the Medicus EPR web
application itself, which is a separate product owned by Medicus Health Ltd.

## Compliance status

Medicus Suite is **partially conformant** with the Web Content Accessibility
Guidelines (WCAG) 2.1 level AA. This status is based on an **internal heuristic
review** of the markup and stylesheets (see "How we tested"); it has **not** been
independently audited, and no assistive-technology user testing or formal
automated scan (axe / Lighthouse) has yet been recorded. Conformance is therefore
self-declared and provisional.

## What is accessible (verified by code review)

- **Language and structure:** documents declare `lang="en"`; navigation uses
  semantic `<nav>` / `<button>` elements.
- **Named controls:** primary navigation tabs carry `aria-label`s and pair each
  SVG icon with a visible text label.
- **Live regions:** the waiting-room, request-monitor and submissions-RAG alert
  strips use `role="status"` with `aria-live="polite"`, so threshold changes are
  announced to screen readers.
- **Keyboard focus:** a visible focus indicator is implemented via
  `:focus-visible` across the panel shell and module stylesheets (30+ rules).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` is honoured across
  the panel and module stylesheets, suppressing non-essential animation.
- **Forms:** options/settings inputs are associated with `<label>` elements.
- **Decorative elements:** scroll indicators and similar are marked
  `aria-hidden="true"`.

## Known issues and areas not yet verified

The following are either known gaps or items not yet formally confirmed against
WCAG 2.1 AA. They are disclosed transparently and tracked for remediation:

1. **Colour contrast (WCAG 1.4.3 / 1.4.11):** the design-token palette has not yet
   been measured against AA contrast ratios in both light and dark themes; some
   chip and secondary-text tokens require formal verification.
2. **Icon-only buttons (WCAG 4.1.2):** several toolbar buttons (command palette,
   display, pop-out, settings) currently expose their accessible name via `title`
   only; an explicit `aria-label` should be added.
3. **Injected queue chips (WCAG 1.3.1 / 2.1.1):** the age/monitoring/result chips
   injected into Medicus's Vue + AG-Grid queue have not yet been tested for screen
   reader exposure or keyboard reachability within the host grid.
4. **Automated and assistive-tech testing:** no recorded axe-core / Lighthouse
   run, and no screen-reader (NVDA/VoiceOver) or keyboard-only walkthrough of each
   module has yet been carried out.
5. **Visualiser charts (WCAG 1.1.1):** Chart.js / D3 visualisations may need text
   alternatives or data-table equivalents for non-visual users.

## How we tested

This statement is based on a heuristic review, on 2026-06-14, of the extension's
HTML and CSS at version 3.84.2 — examining semantic structure, ARIA usage,
labelling, focus management, and reduced-motion support. It is **not** a
substitute for a full WCAG 2.1 AA audit with automated tooling and assistive-
technology testing, which is the recommended next step before any conformance is
formally claimed to an NHS buyer.

## Feedback

If you encounter an accessibility barrier, contact Dr Dave Triska at
dave@graysbrook.co.uk with the version (see `manifest.json`), the module, and a
description of the problem. We aim to acknowledge within a few working days.

## Preparation and review

- **Statement prepared:** 2026-06-14 (DRAFT).
- **Review:** to be updated following a formal WCAG 2.1 AA audit and at each
  minor/major release thereafter.
