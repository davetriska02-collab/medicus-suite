import js from '@eslint/js';
import globals from 'globals';

// Dual-context files (browser classic script + Node require via the
// `typeof module !== 'undefined'` guard) need module/require/exports globals,
// plus `global` for the `typeof window !== 'undefined' ? window : global`
// export tail those files share.
const cjsGuard = { module: 'readonly', require: 'readonly', exports: 'readonly', global: 'readonly' };

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
      // 'no-undef' stays ON (from js.configs.recommended). Content scripts have no
      // import graph — they talk through window.* globals — so a typo'd bare global
      // is a silently missing clinical chip. Cross-script globals are DECLARED
      // per-file in the overrides below rather than the rule being disabled;
      // it found two live ReferenceErrors when re-enabled (v3.232.1).
      'no-prototype-builtins': 'off', // shared/io/*.js, engine/*.js
    },
  },
  {
    // The options page loads every shared/io/<module>-io.js as a classic <script>
    // (see options/options.html); each defines bare export/import globals that
    // options.js calls. Declared explicitly so a typo'd name is still an error.
    files: ['options/options.js'],
    languageOptions: {
      globals: {
        sentinelExport: 'readonly',
        sentinelImport: 'readonly',
        capacityExport: 'readonly',
        capacityImport: 'readonly',
        triageExport: 'readonly',
        triageImport: 'readonly',
        TriageAlertIO: 'readonly',
        slotCounterExport: 'readonly',
        slotCounterImport: 'readonly',
        submissionsExport: 'readonly',
        submissionsImport: 'readonly',
        popoutExport: 'readonly',
        popoutImport: 'readonly',
        referralsExport: 'readonly',
        referralsImport: 'readonly',
        requestMonitorExport: 'readonly',
        requestMonitorImport: 'readonly',
        condorExport: 'readonly',
        condorImport: 'readonly',
        receptionExport: 'readonly',
        receptionImport: 'readonly',
        knowledgeExport: 'readonly',
        knowledgeImport: 'readonly',
        labfilingExport: 'readonly',
        labfilingImport: 'readonly',
        notificationsExport: 'readonly',
        notificationsImport: 'readonly',
        leafletsExport: 'readonly',
        leafletsImport: 'readonly',
        patientAlertsExport: 'readonly',
        patientAlertsImport: 'readonly',
        problemDescriptionCleanupExport: 'readonly',
        problemDescriptionCleanupImport: 'readonly',
        problemDescriptionCleanupMergeForPublish: 'readonly',
        phrasesExport: 'readonly',
        phrasesImport: 'readonly',
        rotaExport: 'readonly',
        rotaImport: 'readonly',
        suiteExport: 'readonly',
        suiteImport: 'readonly',
        PresenceFolder: 'readonly',
      },
    },
  },
  {
    // panel.html loads shared/io/problem-description-cleanup-io.js as a classic
    // script alongside the ESM panel.js (practice-pool contribution path).
    files: ['side-panel/panel.js'],
    languageOptions: {
      globals: {
        problemDescriptionCleanupExport: 'readonly',
        problemDescriptionCleanupMergeForPublish: 'readonly',
      },
    },
  },
  {
    // sentinel-options.html loads rule-schema.js before options.js.
    files: ['sentinel-options/options.js'],
    languageOptions: {
      globals: { validateCustomRule: 'readonly', customRuleSchemaPrompt: 'readonly' },
    },
  },
  {
    // MV3 service worker: importScripts is the worker global; the Txn* /
    // Sentinel* / PresenceFolder globals are defined by the importScripts'd files.
    files: ['service-worker.js'],
    languageOptions: {
      globals: {
        importScripts: 'readonly',
        TxnBundleCache: 'readonly',
        TxnRequestGate: 'readonly',
        TxnConfig: 'readonly',
        TxnApi: 'readonly',
        TxnTransport: 'readonly',
        SentinelTransactionalSource: 'readonly',
        SentinelFhirNormaliser: 'readonly',
        SentinelImmunisationBridge: 'readonly',
        PresenceFolder: 'readonly',
      },
    },
  },
  {
    // visualiser.html loads the vendored libs (d3, Chart) and the dual-context
    // engine files (ACBScores, StoppStart) as classic scripts before this one.
    files: ['visualiser-core.js'],
    languageOptions: {
      globals: { d3: 'readonly', Chart: 'readonly', ACBScores: 'readonly', StoppStart: 'readonly' },
    },
  },
  {
    // Claude Code skill helper scripts — plain Node, never shipped.
    files: ['.claude/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // ESM files in side-panel/ and pop-out/
    files: ['side-panel/**/*.js', 'pop-out/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // shared/medicus-api.js, shared/task-api.js, shared/tab-help.js,
    // shared/panel-txn-feed.js and shared/booking-core.js are ES modules
    // (export keyword), imported by side-panel modules / panel.js / pop-out.js
    // rather than loaded as classic scripts. (booking-core.js additionally
    // assigns window.BookingCore behind a typeof guard so a classic script can
    // adopt it later — that does not change how it is parsed.)
    files: [
      'shared/medicus-api.js',
      'shared/task-api.js',
      'shared/tab-help.js',
      'shared/panel-txn-feed.js',
      'shared/booking-core.js',
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
    // Node ESM tooling scripts (e.g. brand/generate-icons.mjs,
    // design-system/build.mjs — esbuild bundlers run under Node, never shipped)
    files: ['brand/**/*.mjs', 'design-system/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
];
