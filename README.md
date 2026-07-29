# Scroll Wheel Tab Switcher

TabWheel is a browser extension built to do one job well: switch tabs with `Alt / Option + mouse wheel` anywhere on the page.

TabWheel provides fast, private, mouse-first tab control, with focused modifier-mouse actions for creating, revisiting, duplicating, moving, and closing tabs. There is no search feature, page-scroll modification, telemetry, or remote service.

## What it does

- Switches tabs with `Alt / Option + wheel` by default.
- Cycles in visible left-to-right tab-strip order.
- Restores the root page position when you return to a tab and URL.
- Offers Precise, Balanced, Fast, and Custom wheel feel.
- Guards against extra tab switches from trackpad momentum, including right after you land on the newly focused tab.
- Can skip collapsed/hidden tabs or pinned tabs.
- Supports `Ctrl / Control` and `Meta / Command` as alternative modifiers.
- Opens the browser's New Tab page beside the current tab with modifier + left click.
- Returns to the previous tab with modifier + middle click.
- Closes the current tab and returns to the previous tab with modifier + right click.
- Lets every mouse button be remapped to Browser new tab, Most recent tab, Close current tab, Duplicate tab, Drag current tab, Open settings, or Off.
- Drag current tab lets you hold the configured button and drag horizontally; every 56 px moves the active tab one slot without changing its pinned or group membership.
- Provides popup Previous/Next buttons when a protected browser page blocks content scripts.
- Shows a toolbar badge on recognized browser-restricted URLs, such as `chrome://`, `about:`, and extension stores.
- Stores settings, onboarding state, recent-tab order, and scroll positions locally.

Setting a physical button to Off leaves its native modifier-click behavior completely untouched. Enabled combinations suppress page-delivered defaults such as opening or downloading links and showing context menus. OS shortcuts, browser-chrome shortcuts, and protected pages cannot be intercepted; Firefox also reserves Shift + right click for its native context menu.

## First run

Fresh installs and updates from pre-V4 releases follow this sequence:

1. Practice the real modifier-wheel gesture.
2. Enter the separate mouse-action onboarding to change and immediately preview left/middle/right click.
3. Return to shared gesture settings to choose the modifier and directly change all three mouse-click actions.
4. Finish on the wheel-ready screen.

The popup keeps a small first-use hint visible until the first successful real gesture. This state is local and is not analytics.

## Defaults

| Setting | Default |
| --- | --- |
| Gesture | `Alt / Option + wheel` |
| Modifier + left click | Browser new tab |
| Modifier + middle click | Most recent tab |
| Modifier + right click | Close current tab |
| Wheel order | Left-to-right |
| Wheel direction | Wheel down moves to the next tab |
| Skip hidden/collapsed tabs | On |
| Skip pinned tabs | Off |
| Wrap around at the ends | On |
| Cycle within current tab group | Off |
| Wheel feel | Balanced |
| Acceleration | Off |
| Sensitivity | 1.0× |
| Cooldown | 160ms |

Page-position restore, editable-field gestures, horizontal wheel input, protected-page skipping, overshoot protection, and a toolbar badge marking recognized browser-restricted URLs are always enabled automatically.

## Browser support

- Chrome and Chromium-based browsers use the Manifest V3 build.
- Firefox and Zen Browser use the Manifest V2 build.

Browser settings, extension stores, PDF viewers, devtools, and other protected pages may block page gestures. OS or browser-chrome combinations that never reach a page are also outside a WebExtension's control. The toolbar popup still offers Previous and Next buttons.

Browser New Tab opens actively beside the current tab. Its privileged blank page cannot receive TabWheel page gestures, which resume after the user navigates to a normal page.

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

- `release/tabwheel-chrome-v4.0.0.zip`
- `release/tabwheel-firefox-v4.0.0.xpi`
- `release/tabwheel-source-v4.0.0.zip`

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
    appInit/            modifier-wheel, click-action, and restore listeners
    backgroundRuntime/  tab actions, tab-strip cycling, restore, and lifecycle logic
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
