# Store Reference — TabWheel

## Listing Title

Scroll Wheel Tab Switcher

## Extension Names

- Firefox / Zen: Scroll Wheel Tab Switcher
- Chrome: Scroll Wheel Tab Switcher

## Summary (short, <=132 chars)

Switch tabs with Alt + mouse wheel anywhere on the page. Fast, focused, private, and configurable.

## Description

SWITCH TABS WITHOUT CHASING THE TAB BAR

Hold Alt / Option and scroll the mouse wheel anywhere on a normal web page. Wheel down moves to the next tab and wheel up moves to the previous tab. Your hand stays on the mouse and your focus stays on the page.

BUILT FOR THIS ONE WORKFLOW

- Left-to-right mode follows the visible tab strip.
- Recently used mode follows your browsing flow.
- Page-position restore takes you back to where you stopped reading.
- Precise, Balanced, Fast, and Custom wheel feel support different mice and trackpads.
- Optional filters can skip pinned or hidden/collapsed tabs.
- Ctrl / Control and Meta / Command are available as alternative modifiers.
- The same modifier + middle click opens settings by default, or can be turned Off for native middle-click behavior.

CURRENT DEFAULTS

- Gesture: Alt / Option + wheel.
- Modifier + middle click: Open settings.
- Order: Left-to-right.
- Wheel direction: wheel down moves to the next tab.
- Skip hidden or collapsed tabs: on.
- Skip pinned tabs: off.
- Wheel feel: Balanced.
- Sensitivity: 1.0×.
- Cooldown: 160ms.
- Acceleration: off.

Page-position restore, editable-field gestures, horizontal wheel input, protected-page skipping, wraparound, and overshoot protection are always enabled automatically.

EASY FIRST RUN

A three-step welcome page lets you practice the exact gesture, choose your modifier, optional Shift requirement, and middle-click behavior, and understand page-position restore. The popup keeps a short reminder until your first successful gesture. This progress stays in local browser storage and is not telemetry.

PROTECTED PAGES

Browser settings, extension stores, PDF viewers, devtools, and some internal pages do not allow extension content scripts. TabWheel handles these restrictions automatically. Open the toolbar popup to use Previous and Next fallback buttons there.

PRIVATE BY DESIGN

No data leaves your browser for telemetry, tracking, analytics, or developer-owned services. TabWheel has no remote code and no account. Settings, onboarding progress, most-recently-used tab order, and recent page positions are stored locally.

WHAT CHANGED IN 3.0.0

TabWheel now owns the scroll-wheel tab-switching niche instead of bundling adjacent browser tools. Search, left/right-click remapping, alternate middle-click actions, and normal page-scroll tuning were removed. The focused modifier + middle-click settings shortcut remains and can be turned Off. Existing core wheel preferences and saved page positions are preserved during upgrade. The extension requests fewer permissions.

## Privacy

No data leaves your browser. TabWheel stores only the local state needed for settings, onboarding, tab order, and page-position restore. See `PRIVACY.md` for details.

## Permissions

- `tabs`: Read and activate tabs for left-to-right or recently used cycling.
- `storage`: Store settings, onboarding progress, MRU order, page positions, and the migration version locally.
- `scripting` (Chrome): Reconnect the content script to already-open normal web tabs after install, update, or manual refresh.
- `tabGroups` (Chrome): Detect collapsed groups so hidden-tab skipping can exclude their tabs.
- `<all_urls>`: Run the modifier-wheel listener and page-position capture/restore on supported web pages.

TabWheel does not request `search`, `history`, or `bookmarks` permissions.

## Browser Support

Works on Firefox, Chrome, and Zen Browser.

## Store Assets

Prepare these from the production Chrome build at 100% browser zoom:

1. 1280 × 800 — onboarding gesture demo, caption: “Switch tabs without chasing the tab bar.”
2. 1280 × 800 — successful gesture and active demo tab, caption: “One natural gesture.”
3. 1280 × 800 — complete popup ready state, caption: “Every control, right from the toolbar.”
4. 1280 × 800 — focused settings, caption: “Tune your gesture and tab cycling.”
5. 1280 × 800 — protected-page popup fallback, caption: “Reliable fallback controls.”
6. 440 × 280 — promo tile using the extension icon, “Alt + Wheel,” and “Switch tabs anywhere.”
