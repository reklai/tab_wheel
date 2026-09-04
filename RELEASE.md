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

## 4.1.0

- Added three remappable modifier + mouse-button actions: Mute / unmute tab (toggles the active tab's audio), Go back, and Go forward (navigate the active tab's history). On Chrome, back and forward show a short status when the history has no entry in that direction; Firefox treats that case as a silent no-op.
- Fixed a right-click action leaking the trailing pointerup, mouseup, and auxclick to the page. A right-click action runs on the context-menu event, which is not the last event of the interaction, so the events after it used to reach the page (a right-click mapped to a tab action could still trigger page behaviour bound to those events). The whole interaction is now claimed until it ends, matching left and middle clicks.
- Fixed a claimed mouse button still handing the page a double-click: the browser synthesizes dblclick after two clicks even when both were swallowed, so two quick modifier-clicks (the natural way to use Mute / unmute tab) could fullscreen a video or select a word. dblclick is now intercepted whenever the modifier is held and the button is mapped.
- Left every default and every saved mapping unchanged; the new actions are extra dropdown options listed before Off, and no storage migration runs.
- Added a GitHub Actions workflow that runs the full `npm run ci` gate on every push and pull request.
- Ordered the mouse-action dropdowns alphabetically by their label, with Off kept last as the disable option (Browser new tab, Close current tab, Drag current tab, Duplicate tab, Go back, Go forward, Most recent tab, Mute / unmute tab, Open settings, Off). This is display order only: defaults are unchanged, no migration runs, and every saved mapping is preserved exactly, so no existing user is affected.
- Refreshed the popup, settings page, and onboarding to a macOS-inspired look while keeping the existing dark blue brand: the SF system typeface, panels lit from above with soft depth, pop-up-button dropdowns with a chevron, push buttons with a pressed state, refined toggles with a spring motion, and a macOS-style focus halo. Settings groups now use plain System Settings-style headers instead of numbered badges. No behaviour or layout changed.
- Unified every notice into one pill: the on-page failure notice, the popup toast, and the settings page status now share the same bottom-centre capsule with a translucent blurred surface, a hairline inset, and a short rise-and-settle that reduced motion turns off. Display time scales with message length on all three. The page notice was previously a box in the centre of the viewport and remains the only thing TabWheel ever draws on a page.
- Rewrote every failure message in plain language that says what did not happen and, where useful, what to do: for example "Couldn't close this tab", "No recent tab to return to", "Nothing to go back to", and one consistent "TabWheel couldn't reach the browser. Use Refresh extension in the popup." when the background is unreachable. The popup and settings page use the same vocabulary. A test now rejects developer wording in any user-visible string.
- Added a quiet rating star beside the settings gear in the popup header and beside the close button in the settings page header, on the Chrome build only. It is a plain link to the store's reviews page with a tooltip, no prompt, timer, storage, or dismiss logic; the Firefox build renders nothing there until a Firefox listing exists.

## 4.0.3

- Shortened first-run onboarding: removed the final summary screen so setup ends on shared gesture settings with Start browsing.
- Made the setup progress bar a shared three-step indicator (wheel demo → mouse practice → shared settings) that stays visible across the whole journey.

## 4.0.2

- Made Drag current tab the default middle-click action for fresh installs and resets. Upgrades preserve every valid saved middle-click mapping, including through the historical v14 migration step that previously narrowed them.
- Activated restored tabs on browser cold start: `runtime.onStartup` now reinjects the content script into eligible restored tabs (immediate pass plus an independent two-second retry), so gestures work after a browser restart without reloading any tab.
- Injected with `injectImmediately` on Chrome so restored documents that never reach the idle phase still connect.
- Left discarded (sleeping) tabs asleep at startup; they gain gestures when they wake normally, and waking preserves their saved page position.
- Let wheel and popup cycling land on sleeping (discarded) tabs again: landing wakes the tab by activating it. Previously the readiness probe silently skipped sleeping tabs and briefly blacklisted them from cycling, so after a browser restart the wheel could not reach restored tabs that had never been clicked.
- Made cycling land on slow pages instead of skipping them. Only pages that provably refuse content scripts (restricted URLs, refused injection) are skipped now; readiness that merely lags the probe budget lands, so the strip you see is always the strip the wheel walks. The per-candidate probe budget dropped from 320ms to 150ms because expiry no longer costs reachability.
- Kept the scroll-preservation hold on a waking tab until its load actually completes instead of a fixed 700ms grace, so cycling away from a still-loading woken tab can no longer overwrite the page position you left it at with top-of-page.
- A sleeping tab that wakes into a page that refuses content scripts (for example a PDF viewer on a normal-looking URL) costs one landing, then is skipped by later cycles exactly like any other restricted page; the popup fallback remains the exit while on it.
- Pre-warmed the background worker the moment the gesture modifier is pressed (rate-limited, top frame only), so Manifest V3 cold starts overlap the wind-up before the first wheel notch instead of delaying the first switch.
- Isolated startup housekeeping, the initial activation pass, and the delayed retry from each other, so one failure or stall cannot cancel the rest.
- Aligned onboarding copy and store assets with the middle-click drag default.

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
