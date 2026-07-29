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

## 4.0.0

- Restored remappable modifier + left, middle, and right click actions.
- Made Browser New Tab the default left-click action; it opens actively beside the current tab.
- Added Browser New Tab, Most recent tab, Close current tab, Duplicate tab, Drag current tab, Open settings, and Off choices for every physical button.
- Added the optional Drag current tab action: hold its configured mouse button and drag horizontally to move the active tab live, one slot per 56 px, without crossing pinned or tab-group boundaries.
- Made Off a strict native pass-through: no gesture session, default cancellation, or propagation suppression.
- Removed the MRU wheel-cycle mode; wheel and popup cycling now always follow tab-strip order.
- Retained bounded recent-tab history only for the previous-tab click actions and renamed its storage record in schema v18.
- Preserved the wheel demo as the first onboarding screen, followed it with a separate live mouse-action setup where mappings can be changed and tested immediately, then returned users to shared settings where they can revise the modifier and all three click actions before the wheel-ready screen. Fresh installs and pre-V4 updates follow the same sequence.
- Documented the WebExtension boundary for OS/browser-chrome shortcuts, protected pages, and Firefox Shift + right click.

## 3.1.0

Feel and reliability release:

- Added a momentum guard: an always-on internal reliability rule (no setting) that stops trackpad momentum-tail scrolling from firing extra unintended tab switches after a switch, including in the newly focused tab (the cross-tab arrival guard). A handed-off momentum tail is judged in the tab it lands in rather than re-accumulating into an unintended switch there, with one narrow, bounded exception: a wheel notch landing inside the 32ms post-switch arrival window can cost that one notch, the same tradeoff a trackpad accepts on every switch.
- Added a toolbar badge for blocked pages: an always-on internal reliability rule (no setting) that shows a tab-scoped "!" badge on browser-restricted pages such as `chrome://`, `about:`, and extension stores.
- Pre-warmed the background service worker on the first gesture wheel event of a burst (rate-limited to once per 15 seconds), so Manifest V3's cold-start delay overlaps the wheel motion still to come instead of landing entirely on the switch. This helps where a gesture spans several wheel events, such as on a trackpad.
- Added neighbor pre-probing: after each switch, TabWheel quietly prepares the two nearest tabs in each cycle direction (skipping sleeping/discarded tabs) so cycling on to them lands faster. This speculative warm-up can only make a future switch quicker — it never changes which tabs a cycle can reach.
- Made the zero-reload guarantee test-enforced: `test/zero-reload.test.mjs` locks the install/update reinjection wiring behind automated assertions, in addition to the manual checklist below.
- Streamlined onboarding to three steps: live gesture demo, gesture choices, and ready.
- Preserved existing wheel preferences and scroll positions through the v16 storage migration, leaving every other setting untouched for upgrading users.
- Exposed wrap-around (`wrapAround`, default On) as a regular setting instead of an internal reliability rule, and added cycling within the active tab's group (`cycleWithinTabGroup`, default Off), backfilled for upgrading users through the v17 storage migration.

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
   badge.
7. Arrival guard, on a clicky (detented) mouse wheel. On the Fast preset,
   notch quickly and deliberately across several tabs, including switching
   between them mid-notch. Expect the occasional swallowed notch: a notch
   landing inside the 32ms post-switch arrival window costs that one notch —
   Chrome reports clicky wheels in pixel mode, so it is the more likely of the
   two browsers to show this occasionally. At the Fast preset the 90ms
   cooldown itself also drops a notch that lands inside it (the accumulator is
   zeroed on any blocked crossing), so distinguish that cooldown drop from an
   arrival-window drop rather than attributing both to the guard. The arrival
   guard only ever engages on pixel-mode wheel events (`deltaMode === 0`);
   Firefox reports clicky wheels in line mode, so it can never trigger there,
   and the Firefox pass of this step is expected to show zero arrival-window
   drops. The check is that arrival-window drops stay occasional on Chrome,
   not that they never happen.
