# Design System (POC — NOT shipped)

> **Status: proof-of-concept. This directory is _not_ part of the shipped Medicus
> Suite extension and is not loaded by it.**

This is an exploratory React/TypeScript design-system package (introduced in #153
as the "Claude Design POC"). It exists to prototype shared UI primitives and is
consumed only by the `.design-sync` tooling — never by the extension at runtime.

## Why it's quarantined

- **Excluded from the release build.** `.github/workflows/release.yml` excludes
  `design-system/` from the packaged zip, so none of it reaches users.
- **Has its own toolchain.** It carries its own `package.json` / `tsconfig.json`
  / esbuild and its own `node_modules`; none of these ship.
- **Lint scope.** `eslint.config.mjs` gives `design-system/**/*.mjs` Node globals
  so it can't break the repo-wide lint gate (it did once — see CHANGELOG v3.117.1).

## If you're auditing the shipped extension

You can ignore this directory entirely. The shipped extension is the plain,
unbundled MV3 code in `side-panel/`, `content-scripts/`, `engine/`, `shared/`,
`options/`, `service-worker.js`, etc. Nothing here is SOUP for the product.

## If this POC is abandoned

Delete the whole `design-system/` directory — there is no runtime dependency on
it from the extension.
