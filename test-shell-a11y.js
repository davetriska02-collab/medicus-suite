// Medicus Suite — Shell accessibility static guard
// Run with: node test-shell-a11y.js
//
// Source-greps the two shell pages (side-panel/panel.html, pop-out/pop-out.html),
// the shared module loader, and the modules with glyph-only buttons, so a
// regression that strips an accessible name or the selected-tab state fails CI:
//   1. Settings buttons in both shells carry an aria-label (icon-only control).
//   2. The active .nav-tab exposes selection state via aria-current="page" —
//      statically in both shells' markup AND dynamically in module-loader.js
//      (the single place both shells toggle the .active class).
//   3. Glyph-only buttons (✎ ✕ ◀ ▶ ⬆ ⬇ ↻ +) in the Capacity Forecast and
//      Patient Alerts modules each carry an aria-label — a bare glyph gives
//      assistive tech nothing to announce.

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0;
let failures = 0;
function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  OK    ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL  ${msg}`);
  }
}

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const panelHtml = read('side-panel', 'panel.html');
const popoutHtml = read('pop-out', 'pop-out.html');
const moduleLoader = read('side-panel', 'module-loader.js');

// ── 1. Settings buttons are icon-only → need aria-label ──────────────────────
for (const [name, html, id] of [
  ['panel.html', panelHtml, 'settingsBtn'],
  ['pop-out.html', popoutHtml, 'popoutSettingsBtn'],
]) {
  const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
  check(!!m, `${name}: #${id} exists`);
  check(m && /aria-label="[^"]+"/.test(m[0]), `${name}: #${id} has an aria-label`);
}

// ── 2. Selected nav tab exposes state to assistive tech ───────────────────────
for (const [name, html] of [
  ['panel.html', panelHtml],
  ['pop-out.html', popoutHtml],
]) {
  const m = html.match(/<button[^>]*class="nav-tab active"[^>]*>/);
  check(!!m, `${name}: has a statically-active .nav-tab`);
  check(m && /aria-current="page"/.test(m[0]), `${name}: static active .nav-tab carries aria-current="page"`);
}
check(
  moduleLoader.includes(`setAttribute('aria-current', 'page')`) &&
    moduleLoader.includes(`removeAttribute('aria-current')`),
  'module-loader.js keeps aria-current in step with the .active nav tab (both shells)'
);

// ── 3. Glyph-only buttons carry an accessible name ────────────────────────────
// A button whose entire visible content is a lone glyph (or its HTML entity)
// has no accessible name unless aria-label supplies one.
const GLYPH_ONLY = /^(?:&#x[0-9A-Fa-f]+;|[\u2700-\u27BF\u25B6\u25C0\u2B06\u2B07\u21BB\u00D7+])$/;
for (const file of [
  path.join('side-panel', 'modules', 'capacity', 'capacity.js'),
  path.join('side-panel', 'modules', 'patient-alerts', 'patient-alerts.js'),
]) {
  const src = read(file);
  const offenders = [];
  for (const m of src.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)) {
    const attrs = m[1];
    const content = m[2].trim();
    if (!GLYPH_ONLY.test(content)) continue;
    if (!/aria-label="[^"]+"/.test(attrs)) offenders.push(m[0]);
  }
  check(
    offenders.length === 0,
    offenders.length === 0
      ? `${file}: every glyph-only button has an aria-label`
      : `${file}: glyph-only button(s) missing aria-label: ${offenders.join(' | ')}`
  );
}

console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
process.exit(failures ? 1 : 0);
