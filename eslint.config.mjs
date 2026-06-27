import js from '@eslint/js';
import globals from 'globals';

// Dual-context files (browser classic script + Node require via the
// `typeof module !== 'undefined'` guard) need module/require/exports globals.
const cjsGuard = { module: 'readonly', require: 'readonly', exports: 'readonly' };

export default [
  { ignores: ['vendor/**', 'node_modules/**', '_skill/**', '*.zip'] },
  // Suppress warnings about eslint-disable directives that reference rules not in
  // this config (e.g. the no-new-func directive in test-triage-defaults.js).
  { linterOptions: { reportUnusedDisableDirectives: 'warn' } },
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
      'no-unused-vars': 'off',         // widespread across existing codebase (31 instances); rename-to-_foo deferred
      'no-useless-escape': 'off',      // content-scripts/triage-lens/content.js, engine/extractors/*, visualiser-core.js, sentinel-options/options.js
      'no-regex-spaces': 'off',        // test-extraction-health.js, test-monitoring-chip.js, test-prescribing-flags.js (vm-extraction regexes — must not be autofixed)
      'no-func-assign': 'off',         // sentinel-options/options.js:1261
      'no-redeclare': 'off',           // engine/rules-engine.js, shared/ dual-context guards
      'no-undef': 'off',               // visualiser-core.js (pdfjsLib, document, chrome globals called before chrome-api override)
      'no-prototype-builtins': 'off',  // shared/io/*.js, engine/*.js
    },
  },
  {
    // ESM files in side-panel/ and pop-out/
    files: ['side-panel/**/*.js', 'pop-out/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // shared/medicus-api.js is an ES module (uses export keyword)
    files: ['shared/medicus-api.js'],
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
    // Node ESM tooling scripts (e.g. brand/generate-icons.mjs,
    // design-system/build.mjs — esbuild bundlers run under Node, never shipped)
    files: ['brand/**/*.mjs', 'design-system/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
];
