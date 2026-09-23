# Contributing

## Local Setup

1. `npm ci`
2. `npm run lint`
3. `npm run test`
4. `npm run typecheck`
5. `npm run verify:compat`
6. `npm run verify:upgrade`
7. `npm run verify:store`
8. `npm run build`

Contributor orientation: `README.md`

## Release Flow

1. Keep `esBuildConfig/manifest.json`, `STORE.md`, and `PRIVACY.md` updated together whenever permissions, storage limits, or privacy claims change.
2. Run `npm run ci` before release; this includes `verify:compat`, `verify:upgrade`, and `verify:store`.
3. Use `RELEASE.md` for reproducible packaging and submission artifacts.
4. Use `STORE.md` and `PRIVACY.md` as the canonical text for AMO/Chrome submission fields.

## Naming Conventions

### Files and Folders

- `src/entryPoints/*`: use **camelCase** for browser-facing entrypoint paths and asset names.
- `src/lib/*`: keep feature folders in existing **camelCase** style (`tabManager`, `anchorTags`, `sessionMenu`, etc.).
- Naming is lint-enforced: `src/lib/*` paths must be camelCase; `src/entryPoints/*` paths must be camelCase.
- Keep filename and primary export aligned where practical:
  - `tabManager.ts` -> `openTabManager(...)`
  - `optionsPage.ts` -> options page bootstrap logic

### Functions

- Use verb-based names for actions:
  - `open...`, `render...`, `load...`, `save...`, `remove...`, `handle...`
- Use `ensure...Loaded` for lazy initialization guards.
- Function declarations inside `src/lib/*` and `src/entryPoints/*` should be camelCase (lint-enforced).
- Avoid ambiguous abbreviations in exported API names.

### Variables

- Booleans: prefix with `is`, `has`, `can`, or `should`.
- Arrays/collections: use plural nouns (`sessions`, `entries`, `filters`).
- Message payload objects: prefer descriptive names (`receivedMessage` instead of `m`).
- Runtime/request payload variables: avoid `msg`; use domain names like `sessionSaveRequest` or `receivedMessage`.
- DOM event parameters: prefer `event` over single-letter aliases.
- Avoid one-letter variable names except short-lived loop indexes (`i`, `j`) in obvious loops.

### Constants

- Use `UPPER_SNAKE_CASE` for constants shared across a module.
- Keep constant names domain-specific (`MAX_TAB_MANAGER_SLOTS`, `PANEL_DEBOUNCE_MS`).

## Module Boundaries

- `src/entryPoints/*`: thin startup/adaptor layers only.
- `src/lib/common/*`: cross-feature contracts and utility helpers.
- `src/lib/backgroundRuntime/*`: background-only handlers, domains, and lifecycle flows.
- Feature modules should depend on `common`, not on other feature internals unless necessary.
- Runtime message contract changes must go through `src/lib/common/contracts/runtimeMessages.ts`.

## Engineering Promise Guardrails

- Keep runtime UI framework-free: prefer browser primitives, Shadow DOM, and plain TypeScript.
- New overlays must compose from `createPanelHost()`, `getBaseStyles()`, and `registerPanelCleanup()`.
- Overlay CSS should consume shared `panelHost` tokens (`var(--ht-color-*)`) instead of hardcoded palette values.
- Treat UI smoothness as a default requirement: avoid full-list rerenders, prefer rAF-throttled work, and keep compositor-friendly panel containers.
- Keep hot-path guardrails explicit: update instrumentation and tests together when performance-sensitive panels change.

## Pull Request Checklist

- Naming follows this guide.
- Any renamed path/function has all references updated.
- `npm run lint` passes.
- `npm run test` passes.
- `npm run typecheck` passes.
- `npm run verify:compat` passes.
- `npm run verify:upgrade` passes.
- `npm run verify:store` passes.
- `npm run build` passes.
- `README.md` and/or this file updated if contributor-facing release flow changed.
