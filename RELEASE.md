# Release Notes

Release packages are generated from `dist/` after browser builds complete.

Expected package names use the TabWheel brand:

- `tabwheel-firefox-v<version>.xpi`
- `tabwheel-chrome-v<version>.zip`
- `tabwheel-source-v<version>.zip`

Run `npm run ci` before preparing a release, then run:

```bash
npm run release:package
```

## 2.1.0

Search launcher and store-readiness release:

- Added local search launcher suggestions from recent searches, open tabs, browser history, and bookmarks.
- Added `/tab`, `/hist`, and `/book` filters, fuzzy highlighting, keyboard navigation, and open-tab reuse for matching history/bookmark URLs.
- Kept private-window searches out of stored recent searches and kept history/bookmark suggestions out of page-visible DOM.
- Removed the dedicated help menu and moved the options/popup settings controls toward the updated toolbar flow.
- Tightened reset/default behavior, fresh-install migration behavior, and popup/options settings sync.
- Added 16px and 32px icon assets, regenerated Chrome/Firefox/source release packages, and kept package/browser manifests aligned at `2.1.0`.

## 2.0.1

Hardening release for the unpublished 2.0.0 work:

- Fixed Chrome gestures never working in tabs that were already open at install time: programmatic injection now recovers when a restricted subframe makes Chrome reject all-frames injection, re-injects existing tabs on extension updates, and primes each window's focused tab on every background start (covering disable/enable).
- Wheel cycling never activates a tab whose gesture availability was not verified when skip-restricted-pages is enabled; unverified tabs are skipped for that tick and retried after probing.
- Cycling through sleeping (discarded) tabs no longer freezes for the wake grace period; the grace window now only protects the waking tab's remembered scroll position from being overwritten.
- Panel-open click suppression follows the remapped click actions and no longer swallows primary-button clicks aimed at the panel's own controls.
- Most Recent Tab click actions report a status message when no recent tab is available.
- Cached collapsed tab-group lookups off the wheel hot path and hardened the runtime message router against malformed messages.
- Added per-button click action remapping for modifier + left, middle, and right click, including TabWheel Search, Browser Default new tab, Most Recent Tab, Close Tab, Duplicate Tab, Open Settings, and native click pass-through.
- Reorganized the options page into titled sections and added a reset-to-defaults button.
- Added a skip-hidden-tabs setting to keep collapsed tab groups and hidden panes out of wheel cycling.
- Migrated the old Browser Default left-click preference into the new v13 `leftClickAction` setting and removed the legacy storage key.
- Fixed service-worker race paths with in-flight loading, serialized MRU writes, serialized per-window gesture actions, guarded tab API failures, and runtime handler error isolation.
- Reduced content-script hot-path listener work by removing duplicate document-level capture listeners.
- Debounced popup overview refreshes after settings changes and bounded restricted-page probing for click and wheel gesture targets.
- Skipped the full storage snapshot on service-worker wake when the stored schema version is already current.
- Kept the package and browser manifests aligned at `2.0.1`.

## 2.0.0

Major wheel tuning and restricted-page reliability release:

- Added meaningful wheel tuning across four sliders: tab sensitivity, tab cooldown, page-scroll speed, and viewport step cap.
- Page-scroll tuning preserves native scrolling at default settings and only filters normal vertical wheel scrolling when page-scroll values are non-default.
- Made tab-switch cooldown the direct timing gate while overshoot guard now dampens wheel momentum instead of imposing a fixed hidden delay.
- Added bounded runtime capability probing for normal-looking `https` tabs so TabWheel can skip pages where content scripts cannot actually run without stalling wheel or recent-tab gestures.
- Added a short-lived per-tab URL unavailable cache that expires quickly and is cleared on URL changes, tab removal, and browser startup.
- Expanded restricted-page detection for known browser stores such as Chrome Web Store and Mozilla Add-ons.
- Updated restricted-page copy so fallback controls describe the actual Close Tab action.
- Rebuilt Chrome, Firefox, and source release artifacts from the current implementation.
- Kept the package and browser manifests aligned at `2.0.0`.

## 1.0.4

Store-listing and release packaging update:

- Renamed the store-facing extension title for Firefox/Zen and Chrome to `Scroll Wheel Tab Switcher`.
- Updated the store short summary and description around mouse-wheel tab switching, left-click new tab mode, recent-tab, close-tab, privacy, constraints, and scroll memory.
- Updated modifier + right click so it always closes the current tab, activating the most recent eligible tab first when available.
- Made right-click close-to-recent use asynchronous scroll restore so closing the original tab does not wait on the restored page.
- Rebuilt Chrome, Firefox, and source release artifacts from the current implementation.
- Kept the package and browser manifests aligned at `1.0.4`.

## 1.0.1

Reliability release for mouse gestures, search-panel lifecycle, and restricted-page fallback clarity:

- Stabilized modifier + middle click by activating the recent tab on the completed middle-click event instead of the initial button-down event.
- Added a no-recent-tab guard for modifier + right click in that release; 1.0.4 restores the always-close behavior while still preferring a recent-tab target when available.
- Kept normal right click native while the search launcher is open, and suppresses modifier + right click there so search mode cannot accidentally close a tab.
- Search launcher now closes when its tab is hidden or when TabWheel switches away from that tab.
- Added a Browser Default new tab option so modifier + left click can open the browser's normal new tab page instead of TabWheel search.
- Popup restricted-page fallback copy now explains that browser restrictions block page shortcuts while popup buttons still use extension APIs.
- Removed the restricted-page toast so the popup has one clear fallback state.
- Kept the package and browser manifests aligned at `1.0.1`.

## 1.0.0

Initial public release focused on reliability over surface area:

- Modifier-wheel tab cycling on normal web pages.
- General and MRU wheel cycling modes.
- Modifier + left click opens an in-page search launcher using the browser's default search provider, with a fixed Google fallback if the browser search API is unavailable.
- Modifier + middle click activates the most recently used tab.
- Modifier + right click closes the current tab and activates the most recently used tab.
- Popup fallback controls for restricted pages.
- Popup Refresh action that reconnects TabWheel without reloading the page.
- Local-only scroll memory with URL validation, normalized root position, and layout-stability restore.
- Wheel presets, sensitivity, cooldown, horizontal wheel support, restricted-page skipping, safe overshoot guard, and optional acceleration.
- Clear store/privacy language: no page content leaves the browser.
