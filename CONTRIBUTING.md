# Contributing

TabWheel is a small Chrome (Manifest V3) extension with one job: switch tabs with a modifier + mouse wheel, plus a few modifier + click actions. This guide is for someone who knows what the product does and wants to change the code. Start with `README.md` for the product itself.

## Getting started

```bash
npm ci          # install
npm run build   # build the extension into dist/
npm run watch   # rebuild on every save
npm run ci      # everything a change must pass (see below)
```

Load the build in Chrome: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `dist`. After a rebuild, press the reload arrow on the extension card. Open tabs pick up the new content script without a page reload.

## How the code is laid out

Every module opens with a comment explaining what it owns and how its flows run. Read those headers first; they are the map.

| Path | What lives there |
| --- | --- |
| `src/entryPoints/` | Thin startup files: the background service worker, the content script, the popup, the options page, and onboarding. |
| `src/lib/appInit/appInit.ts` | The content script. The only code that sees page input: the wheel gesture, click actions, drag current tab, scroll save/restore, and the on-page status pill. |
| `src/lib/backgroundRuntime/` | The service worker. `handlers/` routes runtime messages; `domains/tabWheelDomain.ts` does all tab work (cycling, click actions, drag moves, scroll memory, reinjection). |
| `src/lib/core/tabWheel/` | Pure, browser-free logic: wheel measurement, the momentum guard, click-session policy, drag math, restricted-page rules. |
| `src/lib/adapters/runtime/` | Typed clients for sending runtime messages to the service worker. |
| `src/lib/common/contracts/` | Shared contracts: settings shape, defaults, and normalizers (`tabWheel.ts`), and the runtime message union (`runtimeMessages.ts`). |
| `src/lib/common/utils/` | Promise sequencing, notice timing, and storage migrations. |
| `src/lib/ui/settings/` | Controls shared by the popup, the options page, and onboarding. |
| `esBuildConfig/` | The build, the manifest (`manifest.json`), release packaging, and the verify scripts. |
| `test/` | `node:test` suites, harnesses, and upgrade fixtures. |

`npm run lint` enforces the layering: `core` must stay pure (no `backgroundRuntime` or `ui` imports), `contracts` must not import `utils`, `utils` must not import runtime or UI layers, `adapters` must not import `ui` or `backgroundRuntime`, and `ui` and `backgroundRuntime` must not import each other. UI frameworks (React, Vue, Svelte, and similar) are banned; the extension uses plain TypeScript and DOM APIs.

### Where to put new logic

If a decision can be made from plain numbers and strings, put it in `src/lib/core/tabWheel/` and give it unit tests. Keep the browser wiring (listeners, `browser.*` calls, timers) in `appInit.ts` or `tabWheelDomain.ts`, and have it call the core function. This split is what lets the gesture feel be tested without a browser.

## Common changes

### Adding or changing a setting

1. Add the field to `TabWheelSettings` in `src/types.d.ts`.
2. Add its default to `DEFAULT_TABWHEEL_SETTINGS` and normalize it in `normalizeTabWheelSettings` (`src/lib/common/contracts/tabWheel.ts`). Normalization is what keeps a malformed or old stored value from reaching the gesture code.
3. If existing users' stored settings need transforming, add a migration step in `src/lib/common/utils/storageMigrations.ts`, bump `STORAGE_SCHEMA_VERSION`, and add a fixture in `test/fixtures/upgrade/`. Migration steps use frozen string literals, never live contract names, so renaming a setting later cannot change how old storage is cleaned up. `npm run verify:upgrade` replays every fixture.
4. Wire the control into the popup and the options page (they mirror each other).

### Adding a runtime message

1. Add the message to the union in `src/lib/common/contracts/runtimeMessages.ts`.
2. Add a typed sender in `src/lib/adapters/runtime/tabWheelApi.ts`.
3. Handle it in `src/lib/backgroundRuntime/handlers/tabWheelMessageHandler.ts`, delegating to a method on the domain.

The header of `tabWheelApi.ts` walks through the full message path.

### Changing permissions or what is stored

Keep `esBuildConfig/manifest.json`, `STORE.md`, and `PRIVACY.md` in step. `npm run verify:store` checks that the documented permissions and the privacy statements match.

## Tests

`npm run test` runs every suite under `test/` with `node:test`. There are three kinds of test:

- **Unit tests** for the pure core modules (`*-core.test.mjs`).
- **Simulations** that bundle the real source and drive it with mocked browser APIs. `test/helpers/gestureHarness.mjs` runs the real content script against synthetic wheel and pointer streams; `test/wheel-devices.test.mjs` uses it to replay real device shapes such as macOS notches, Retina screens, and trackpad momentum. `test/helpers/domainHarness.mjs` does the same for the background domain.
- **Source pins** (mostly `test/runtime-wiring.test.mjs`) that assert on exact snippets of source code, to lock in orderings and decisions that are easy to break by accident. When you change pinned code on purpose, a pin fails. Update it in the same commit, and keep or update its comment explaining why the pin exists.

When you fix a behaviour bug, add a test that fails without the fix.

## Code style

### Comments

The comments are modelled on [Ghostty](https://github.com/ghostty-org/ghostty)'s source:

- Give every exported symbol, and every field that is not self-evident, a short doc comment (`/** ... */`): what it is, its units, and any rule a caller must follow.
- Put short `//` comments before logical steps, explaining *why*. A browser or platform quirk is explained where it bites, not in a separate document.
- Describe how the code works now. Do not narrate history ("used to", "previously", "the old approach"); git keeps history. The exception is `storageMigrations.ts`, where each step exists to transform an old format.
- Do not restate the code, and keep rationale short unless the logic is genuinely subtle.

### Naming

These rules are enforced by `npm run lint`:

- Files and folders under `src/lib/` and `src/entryPoints/` use camelCase.
- Function declarations use camelCase.
- No `msg` as a variable or parameter name; use a descriptive name such as `receivedMessage`.
- Event-handler parameters are named `event`, not `e`.

By convention:

- Action functions start with a verb: `load…`, `save…`, `resolve…`, `apply…`, `handle…`.
- Booleans start with `is`, `has`, `can`, or `should`.
- Module-level constants use `UPPER_SNAKE_CASE` and carry their unit in the name (`WHEEL_ARRIVAL_GUARD_WINDOW_MS`, `WHEEL_NOTCH_PX`).
- No single-letter names outside short, obvious loops.

### User-facing text

Every message a user can see is in plain language: what did not happen and, where it helps, what to do ("Couldn't close this tab", "No recent tab to return to"). `test/status-copy.test.mjs` rejects developer words such as "session", "error", or "undefined" in those strings.

## Commits

Use conventional prefixes, matching the history: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. Say in the body why the change was made, not just what changed.

## Before you open a pull request

- `npm run ci` passes. It runs lint, tests, typecheck, `verify:compat`, `verify:upgrade`, `verify:store`, and the build.
- Any renamed file, function, or setting has every reference updated, including tests and docs.
- `README.md`, `STORE.md`, or `PRIVACY.md` are updated if user-visible behaviour, permissions, or stored data changed.
- For a change to how gestures feel, you have tried it in Chrome as well as in the simulations. `RELEASE.md` has the manual checklist.

## Releasing

1. Bump the version in `package.json`, `package-lock.json` (two places), `esBuildConfig/manifest.json`, and `test/compatibility.test.mjs`. Update the package names in `README.md`, the "What's new" section in `STORE.md`, and add a section to `RELEASE.md`.
2. Commit, then run `npm run release:package`. It refuses to run on an uncommitted tree, because the source archive is built from the commit.
3. Upload `release/tabwheel-chrome-v<version>.zip` to the Chrome Web Store. Use `STORE.md` for the listing text and `PRIVACY.md` for the privacy fields.
