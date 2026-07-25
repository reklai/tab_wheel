# Scroll Wheel Tab Switcher

TabWheel is a browser extension built to do one job well: switch browser tabs with `Alt / Option + mouse wheel` anywhere on a normal web page.

It keeps the gesture fast and predictable while preserving the page position you left behind. There is no search launcher, general click remapping, page-scroll modification, telemetry, or remote service.

## What it does

- Switches tabs with `Alt / Option + wheel` by default.
- Cycles in visible left-to-right order or most-recently-used order.
- Restores the root page position when you return to a tab and URL.
- Offers Precise, Balanced, Fast, and Custom wheel feel.
- On a trackpad, tightens wheel feel and momentum protection to match, without rewriting your stored settings; free-spin and clicky wheels are recognized during setup calibration to suggest a matching preset instead, and stay at full speed through the momentum guard in practice.
- Guards against extra tab switches from trackpad momentum, including right after you land on the newly focused tab.
- Can skip collapsed/hidden tabs or pinned tabs.
- Supports `Ctrl / Control` and `Meta / Command` as alternative modifiers.
- Opens settings with the configured modifier + middle click by default; this shortcut can be turned Off to keep middle click native.
- Provides popup Previous/Next buttons when a protected browser page blocks content scripts.
- Shows a toolbar badge on pages the browser blocks extensions from, such as `chrome://`, `about:`, and extension stores.
- Stores settings, onboarding state, MRU order, and scroll positions locally.

Normal scrolling and left/right clicks remain browser-native. Middle click is also native when its two-option shortcut is Off.

## First run

The four-step welcome page lets a new user:

1. Practice the real modifier-wheel gesture in a safe demo.
2. Calibrate their scrolling: TabWheel samples a short scroll and, when it recognizes a trackpad, free-spin wheel, or clicky wheel, suggests a matching wheel-feel preset.
3. Choose a modifier, optional Shift requirement, and middle-click behavior.
4. Review page-position restore, privacy, and protected-page limitations.

The popup keeps a small first-use hint visible until the first successful real gesture. This state is local and is not analytics.

## Defaults

| Setting | Default |
| --- | --- |
| Gesture | `Alt / Option + wheel` |
| Modifier + middle click | Open settings |
| Order | Left-to-right |
| Wheel direction | Wheel down moves to the next tab |
| Skip hidden/collapsed tabs | On |
| Skip pinned tabs | Off |
| Badge on blocked pages | On |
| Wheel feel | Balanced |
| Auto-tune for your device | On |
| Acceleration | Off |
| Sensitivity | 1.0× |
| Cooldown | 160ms |

Page-position restore, editable-field gestures, horizontal wheel input, protected-page skipping, wraparound, and overshoot protection are always enabled automatically.

## Browser support

- Chrome and Chromium-based browsers use the Manifest V3 build.
- Firefox and Zen Browser use the Manifest V2 build.

Browser settings, extension stores, PDF viewers, devtools, and other protected pages may block page gestures. TabWheel handles those pages automatically; the toolbar popup still offers Previous and Next buttons.

## Privacy

TabWheel has no telemetry, tracking, analytics, remote code, or developer-owned server. See [PRIVACY.md](./PRIVACY.md) for the exact local data and permission model.

## Development

```bash
npm ci
npm run ci
```

Build individual targets:

```bash
npm run build:chrome
npm run build:firefox
```

Load the generated build:

- Chrome: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/chrome`.
- Firefox: open `about:debugging`, choose **This Firefox**, then **Load Temporary Add-on**, and select the generated Firefox manifest.

Package a release:

```bash
npm run release:package
```

This creates:

- `release/tabwheel-chrome-v3.1.0.zip`
- `release/tabwheel-firefox-v3.1.0.xpi`
- `release/tabwheel-source-v3.1.0.zip`

## Project structure

```text
src/
  entryPoints/
    backgroundRuntime/  background bootstrap
    contentScript/      page-side bootstrap
    onboarding/         install and focused-update experience
    optionsPage/        complete settings
    toolbarPopup/       mirrored settings, status, and fallback controls
  lib/
    adapters/runtime/   typed extension-message clients
    appInit/            modifier-wheel and scroll-restore listeners
    backgroundRuntime/  tab cycling, MRU, restore, and lifecycle logic
    common/             contracts, settings, and storage migrations
    core/tabWheel/      browser-free gesture math
  icons/
esBuildConfig/          builds, packaging, and verification
test/                   Node tests and migration fixtures
```

## Documentation

- [STORE.md](./STORE.md): store listing copy, defaults, permissions, and asset checklist.
- [PRIVACY.md](./PRIVACY.md): privacy policy.
- [RELEASE.md](./RELEASE.md): release notes and package names.
- [CONTRIBUTING.md](./CONTRIBUTING.md): contributor workflow.

## License

TabWheel is licensed under the [MIT License](./LICENSE).
