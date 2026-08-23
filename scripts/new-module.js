#!/usr/bin/env node
// Medicus Suite — scaffold a new side-panel module (architecture plan Phase 5.4)
// Usage: node scripts/new-module.js <id> "Display name" "One-line blurb"
//
// Writes the module dir, a TAB_CATALOG stub instruction, help/tour reminders.
// Does NOT edit tab-catalog.js automatically (that file is curated) — prints
// the entry to paste.

'use strict';

const fs = require('fs');
const path = require('path');

const id = String(process.argv[2] || '')
  .trim()
  .toLowerCase();
const name = process.argv[3] || id;
const blurb = process.argv[4] || 'Describe this tab in one sentence.';

if (!/^[a-z][a-z0-9-]+$/.test(id)) {
  console.error('Usage: node scripts/new-module.js <kebab-id> "Display name" "Blurb"');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'side-panel', 'modules', id);
if (fs.existsSync(dir)) {
  console.error(`Already exists: ${dir}`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const js = `// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.

'use strict';

export async function init(container) {
  container.innerHTML = '<div class="module-wrap"><h2>${name.replace(/[<>&]/g, '')}</h2></div>';
  return function cleanup() {
    container.innerHTML = '';
  };
}
`;
const css = `.${id} { }\n`;
fs.writeFileSync(path.join(dir, `${id}.js`), js);
fs.writeFileSync(path.join(dir, `${id}.css`), css);

console.log(`Created side-panel/modules/${id}/${id}.js and .css`);
console.log('\nPaste this into TAB_CATALOG in side-panel/tab-catalog.js:');
console.log(`  {
    id: '${id}',
    name: ${JSON.stringify(name)},
    blurb: ${JSON.stringify(blurb)},
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: '${id}/${id}.js',
    css: '${id}/${id}.css',
  },`);
console.log('\nThen:');
console.log(`  - add <button class="nav-tab" data-module="${id}"> to panel.html AND pop-out.html`);
console.log(`  - add a TAB_HELP entry in shared/tab-help.js`);
console.log(`  - add a tour step or NAV_COVERED_BY_OVERVIEW`);
console.log(`  - if it stores anything, add shared/io/${id}-io.js, MODULE_SCOPES + MODULE_IO, preview line, options.html script + card`);
