import js from '@eslint/js';
import globals from 'globals';

// Dual-context files (browser classic script + Node require via the
// `typeof module !== 'undefined'` guard) need module/require/exports globals.
const cjsGuard = { module: 'readonly', require: 'readonly', exports: 'readonly' };

export default [
  { ignores: ['vendor/**', 'node_modules/**', '_skill/**', '*.zip'] },
  // Suppress warnings about eslint-disable directives that reference rules not in
  // this config (e.g. the no-new-func directive in test-triage-defaults.js).
  { linterOptions: { reportUnusedDisableDirectives: false } },
  js.configs.recommended,
  {
    // Default: classic browser scripts (engine/, content-scripts/, shared/,
    // options/, sentinel-options/, sidebar/, service-worker.js, visualiser-core.js)
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, ...cjsGuard },
    },
    rules: {
      // Tuned so EXISTING code passes (repo style: `catch (_) {}` everywhere)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Rules disabled after survey — see comments for triggering files:
      'no-unused-vars': 'off', // widespread across existing codebase (31 instances); rename-to-_foo deferred
      'no-useless-escape': 'off', // content-scripts/triage-lens/content.js, engine/extractors/*, visualiser-core.js, sentinel-options/options.js
      'no-regex-spaces': 'off', // test-extraction-health.js, test-monitoring-chip.js, test-prescribing-flags.js (vm-extraction regexes — must not be autofixed)
      'no-func-assign': 'off', // sentinel-options/options.js:1261
      'no-redeclare': 'off', // engine/rules-engine.js, shared/ dual-context guards
      'no-undef': 'off', // visualiser-core.js (pdfjsLib, document, chrome globals called before chrome-api override)
      'no-prototype-builtins': 'off', // shared/io/*.js, engine/*.js
    },
  },
  {
    // ESM files in side-panel/ and pop-out/
    files: ['side-panel/**/*.js', 'pop-out/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // shared/medicus-api.js, shared/task-api.js, shared/tab-help.js,
    // shared/panel-txn-feed.js, shared/booking-core.js, shared/booking-identity.js
    // and shared/practice-report-api.js are ES modules (export keyword),
    // imported by side-panel modules / panel.js / pop-out.js / practice-report.js
    // rather than loaded as classic scripts. (booking-core.js additionally
    // assigns window.BookingCore behind a typeof guard so a classic script can
    // adopt it later — that does not change how it is parsed.)
    files: [
      'shared/medicus-api.js',
      'shared/task-api.js',
      'shared/tab-help.js',
      'shared/panel-txn-feed.js',
      'shared/booking-core.js',
      'shared/booking-identity.js',
      'shared/practice-report-api.js',
    ],
    languageOptions: { sourceType: 'module' },
  },
  {
    // Ported Rota Manager subtree — ES modules throughout (rota/package.json
    // sets "type":"module"). app/ is DOM, engine/ + shared/ are pure.
    files: ['rota/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // options/tabs-section.js is loaded as <script type="module"> and imports
    // from side-panel/tab-catalog.js (the rest of options/ is classic script).
    files: ['options/tabs-section.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // practice-report.js — the Practice Report page controller, loaded as
    // <script type="module"> from practice-report.html (root, like the visualiser).
    // cqc-readiness.js — the CQC Inspection Readiness controller, same pattern.
    // cqc-render.js — the CQC readiness renderer (root ES module, like report-render).
    // (engine/cqc-evidence.js is a classic dual-export IIFE like rule-currency.js, so it
    //  stays on the default 'script' config — not listed here.)
    files: ['practice-report.js', 'cqc-readiness.js', 'cqc-render.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['test-*.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // New write-path safety-net files: stricter than the repo-wide
    // "existing code passes" defaults. Do not widen this override to
    // legacy files — turn rules on as new modules land.
    files: ['shared/write-core.js', 'test-write-core.js', 'test-write-path-inventory.js'],
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
    },
  },
  {
    // Node ESM tooling scripts (e.g. brand/generate-icons.mjs,
    // design-system/build.mjs — esbuild bundlers, docs/design mock screenshot
    // capture scripts — all run under Node, never shipped)
    files: ['brand/**/*.mjs', 'design-system/**/*.mjs', 'docs/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
];
