# Store Reference — TabWheel

## Listing Title

Scroll Wheel Tab Switcher

## Extension Names

- Firefox / Zen: Scroll Wheel Tab Switcher
- Chrome: Scroll Wheel Tab Switcher

## Summary (short, <=132 chars)

Switch tabs with Alt + mouse wheel anywhere on the page. Fast, focused, private tab scrolling for mouse or trackpad.

## Description

SWITCH TABS WITHOUT CHASING THE TAB BAR

Hold Alt / Option and scroll the mouse wheel anywhere on a normal web page for instant tab scrolling. Wheel down moves to the next tab and wheel up moves to the previous tab. Chrome removed its built-in tab-strip scrolling, so a lot of people go looking for tab scrolling again — TabWheel brings it back, and it works anywhere on the page instead of a narrow strip of tabs. Your hand stays on the mouse and your focus stays on the page.

BUILT FOR MOUSE-FIRST TAB CONTROL

- Wheel cycling follows the visible tab strip from left to right.
- Modifier + left click opens the browser's New Tab page beside the current tab.
- Modifier + middle click returns to the previous tab.
- Modifier + right click closes the current tab and returns to the previous tab.
- Every mouse button can instead return to the previous tab, close the current tab, duplicate a tab, drag the current tab through its strip section, open settings, or be turned Off for fully native behavior.
- Drag current tab moves the active tab live as you drag horizontally, one slot per 56 px, while preserving pinned and tab-group boundaries.
- Page-position restore takes you back to where you stopped reading.
- Precise, Balanced, Fast, and Custom wheel feel support different mice and trackpads.
- A momentum guard stops trackpad momentum-tail scrolling from firing extra unintended tab switches, including right after you land on a newly focused tab.
- Works immediately after install or update, even on tabs you already had open — no reload needed.
- Optional filters can skip pinned or hidden/collapsed tabs.
- Ctrl / Control and Meta / Command are available as alternative modifiers.

CURRENT DEFAULTS

- Gesture: Alt / Option + wheel.
- Modifier + left click: Browser new tab.
- Modifier + middle click: Most recent tab.
- Modifier + right click: Close current tab.
- Wheel order: Left-to-right.
- Wheel direction: wheel down moves to the next tab.
- Skip hidden or collapsed tabs: on.
- Skip pinned tabs: off.
- Wrap around at the ends: on.
- Cycle within current tab group: off.
- Wheel feel: Balanced.
- Sensitivity: 1.0×.
- Cooldown: 160ms.
- Acceleration: off.

Page-position restore, editable-field gestures, horizontal wheel input, protected-page skipping, overshoot protection, and a toolbar badge marking browser-restricted pages are always enabled automatically.

EASY FIRST RUN

Fresh installs and V4 updates start with the original wheel demo. Next, a separate mouse-action onboarding experience lets users change each button and immediately test it in the safe simulator. The setup then returns to shared gesture settings, where users can choose the modifier, optional Shift, and revise every mouse-click action before finishing on the wheel-ready screen. The popup keeps a short reminder until your first successful gesture. This progress stays in local browser storage and is not telemetry.

PROTECTED PAGES

Browser settings, extension stores, PDF viewers, devtools, and some internal pages do not allow extension content scripts. TabWheel handles these restrictions automatically and marks the toolbar icon with a small badge so you know a page is off-limits. Open the toolbar popup to use Previous and Next fallback buttons there.

Enabled modifier-click actions suppress native page-delivered behavior. Setting a button to Off leaves it completely native. OS shortcuts, browser-chrome shortcuts, and Firefox's reserved Shift + right-click context menu cannot be overridden by a page extension.

PRIVATE BY DESIGN

No data is sent to TabWheel, its developer, or any developer-owned service. TabWheel has no telemetry, tracking, analytics, remote code, account, or search feature. Settings, onboarding progress, recent-tab order, and recent page positions are stored locally.

WHAT'S NEW IN 4.0.0

Modifier + left, middle, and right mouse actions are back. Browser New Tab is the default left-click action and opens actively beside the current tab. Drag current tab is an optional mapping that reorders the active tab live when you drag horizontally. Recently-used wheel cycling was removed; the wheel always follows tab-strip order. Onboarding now runs in the intended order: wheel demo, separate live mouse-action setup, shared wheel-and-click settings, then the wheel-ready screen.

## Privacy

No data is sent to TabWheel or developer-owned services. TabWheel stores only the local state needed for settings, onboarding, tab order, and page-position restore. See `PRIVACY.md` for details.

## Permissions

- `tabs`: Create, duplicate, move, close, read, and activate tabs for configured actions and tab-strip cycling.
- `storage`: Store settings, onboarding progress, recent-tab order, page positions, and the migration version locally.
- `scripting` (Chrome): Reconnect the content script to already-open normal web tabs after install, update, or manual refresh.
- `tabGroups` (Chrome): Detect collapsed groups so hidden-tab skipping can exclude their tabs.
- `<all_urls>`: Run the modifier-wheel listener and page-position capture/restore on supported web pages.

TabWheel does not request `history` or `bookmarks` permissions.

## Browser Support

Works on Firefox, Chrome, and Zen Browser.

## Store Assets

Prepare these from the production Chrome build at 100% browser zoom:

1. 1280 × 800 — onboarding gesture demo, caption: “Switch tabs without chasing the tab bar.”
2. 1280 × 800 — three-button onboarding simulator, caption: “One modifier. Three mouse actions.”
3. 1280 × 800 — shared wheel-and-click settings, caption: “Configure every gesture.”
4. 1280 × 800 — complete popup ready state, caption: “Every control, right from the toolbar.”
5. 1280 × 800 — protected-page popup fallback, caption: “Reliable fallback controls.”
6. 440 × 280 — promo tile using the extension icon, “Alt + Wheel,” and “Switch tabs anywhere.”
