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
