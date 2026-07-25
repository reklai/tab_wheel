# Release Notes

Release packages are generated from `dist/` after browser builds complete.

Expected package names:

- `tabwheel-firefox-v<version>.xpi`
- `tabwheel-chrome-v<version>.zip`
- `tabwheel-source-v<version>.zip`

Run the complete gate and package:

```bash
npm run ci
npm run release:package
```

## 3.1.0

Feel and reliability release:

- Added auto-tune for your device (`deviceAwareTuning`, default On): recognizes trackpads, free-spin wheels, and clicky wheels from natural scrolling and adjusts the effective trigger distance and cooldown to match. Stored settings and presets are never rewritten.
- Added a momentum guard: an always-on internal reliability rule (no setting) that stops trackpad momentum-tail scrolling from firing extra unintended tab switches after a switch, including in the newly focused tab (the arrival guard). Clicky/detented wheels and free-spin traversal are unaffected.
- Added a toolbar badge for blocked pages (`showRestrictedBadge`, default On): a tab-scoped "!" badge on browser-restricted pages such as `chrome://`, `about:`, and extension stores.
- Expanded onboarding to four steps: live gesture demo, calibrate your scrolling (device detection with a suggested wheel-feel preset), gesture choices, and ready.
- Made the zero-reload guarantee test-enforced: `test/zero-reload.test.mjs` locks the install/update reinjection wiring behind automated assertions, in addition to the manual checklist below.
- Preserved existing wheel preferences and scroll positions through the v15 storage migration, which backfills the two new settings to their defaults for upgrading users.

## 3.0.0

Focused product release:

- Narrowed TabWheel to its defining workflow: `Alt / Option + wheel` tab switching.
- Removed the search launcher, left/right-click remapping, alternate middle-click actions, and normal page-scroll tuning.
- Kept one focused modifier + middle-click shortcut with two choices: Open settings or Off.
- Removed the corresponding `search`, `history`, and `bookmarks` permissions.
- Added an interactive three-step install experience using the same gesture math as the extension.
- Added a one-time update explanation for users upgrading from a pre-v3 release.
- Added local first-success state and a popup coaching hint; no telemetry was introduced.
- Made page-position restore, editable-field gestures, horizontal input, protected-page skipping, wraparound, and overshoot protection automatic instead of exposing maintenance controls.
- Audited visible defaults for predictable first use: left-to-right order, Balanced wheel feel, hidden-tab skipping on, pinned-tab skipping off, and acceleration off.
- Preserved core wheel preferences, MRU state, and valid scroll positions through the v14 storage migration while removing retired settings and search history.
- Rebuilt the popup and options page around the same Gesture and Tab Cycling controls—including wheel direction—protected-page fallbacks, and a live keybind title.
- Aligned Chrome, Firefox/Zen, package, store, privacy, and release metadata at `3.0.0`.

## Earlier releases

The 1.x and 2.x releases established modifier-wheel cycling, left-to-right and MRU order, scroll restoration, protected-page handling, and cross-browser packaging. Version 3.0 removes the adjacent experiments added during that period and makes the original wheel-switching workflow the complete product.

## Zero-reload verification

TabWheel injects into already-open tabs on install and update so the gesture
works immediately, without the user reloading anything. `test/zero-reload.test.mjs`
locks the wiring behind this promise with automated regex assertions, but the
end-to-end behavior still needs a manual pass before each release, on both
target browsers:

1. Open at least 5 tabs before installing: a normal https page, chrome://settings
   (Firefox: about:config), a PDF, a discarded/sleeping tab, and an iframe-heavy
   page.
2. Install the unpacked/temporary extension. Without reloading anything: the
   gesture works immediately on the active tab, and switching to a background
   tab and gesturing there works too.
3. Bump the version and reload the extension (the update path), then repeat
   the same checks.
4. Repeat steps 1-3 on both Chrome (unpacked, MV3) and Firefox (temporary
   add-on, MV2).
5. Use the popup's "Refresh extension" control and confirm it reports the
   injected tab counts.
6. Check the toolbar badge: a restricted tab shows "!", a normal tab shows no
   badge, and toggling "Badge on blocked pages" off clears it.
