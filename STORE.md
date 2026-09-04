# Store Reference — TabWheel

## Listing Title

Scroll Wheel Tab Switcher

## Extension Names

- Firefox / Zen: Scroll Wheel Tab Switcher
- Chrome: Scroll Wheel Tab Switcher

## Summary (short, <=132 chars)

Switch tabs with Alt + mouse wheel anywhere on the page. Fast, private, mouse-first tab control.

## Description

SWITCH TABS FROM ANYWHERE ON THE PAGE

Hold Alt / Option and scroll the mouse wheel anywhere on a normal web page for instant tab scrolling. Wheel down moves to the next tab and wheel up moves to the previous tab. Chrome removed its built-in tab-strip scrolling, so a lot of people go looking for tab scrolling again — TabWheel brings it back, and it works anywhere on the page instead of a narrow strip of tabs. Your hand stays on the mouse and your focus stays on the page.

MOUSE ACTIONS AND SETTINGS

Alt / Option is the default modifier. You can change it to Ctrl / Control or Meta / Command and optionally require Shift.

- Modifier + left click opens the browser's New Tab page beside the current tab.
- Modifier + middle click drags the current tab (hold and drag horizontally).
- Modifier + right click uses Close current tab and returns to the most recent tab.
- Every mouse button can be remapped to Browser new tab, Most recent tab, Close current tab, Duplicate tab, Drag current tab, Open settings, Mute / unmute tab, Go back, Go forward, or Off.
- Drag current tab moves the active tab live as you drag horizontally, one slot at a time, while preserving pinned and tab-group boundaries. A Drag speed control sets how far you drag per slot (about 96 px by default).
- Open the extension popup and select the settings icon to review or change every action.

WHEEL EXPERIENCE

- Wheel cycling follows the visible tab strip from left to right.
- Page-position restore takes you back to where you stopped reading.
- Precise, Balanced, Fast, and Custom wheel feel support different mice and trackpads.
- A momentum guard stops trackpad momentum-tail scrolling from firing extra unintended tab switches, including right after you land on a newly focused tab.
- Cycling lands reliably on sleeping (unloaded) tabs and waits for them to wake before restoring your place.
- Works immediately after install or update, even on tabs you already had open — no reload needed.
- Optional filters can skip pinned or hidden/collapsed tabs.

CURRENT DEFAULTS

- Gesture: Alt / Option + wheel.
- Modifier + left click: Browser new tab.
- Modifier + middle click: Drag current tab.
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

Page-position restore, editable-field gestures, horizontal wheel input, protected-page skipping, overshoot protection, and a toolbar badge marking recognized browser-restricted URLs are always enabled automatically.

EASY FIRST RUN

Fresh installs and updates from pre-V4 releases start with the original wheel demo. Next, a separate mouse-action onboarding experience lets users change each button and immediately test it in the safe simulator. The setup then returns to shared gesture settings, where users choose the modifier, optional Shift, and revise every mouse-click action, then finish with Start browsing. The popup keeps a short reminder until your first successful gesture. This progress stays in local browser storage and is not telemetry.

LIMITATIONS AND FALLBACK

TabWheel works on normal webpages where the browser allows extensions to run. Browser settings, internal pages, extension pages, extension stores, PDF viewers, devtools, and other protected pages may block its content script. TabWheel marks the toolbar icon with a small badge for recognized browser-restricted URLs. If a page gesture is unavailable, open the toolbar popup to use Previous and Next fallback buttons.

Enabled modifier-click actions suppress native page-delivered behavior. Setting a button to Off leaves it completely native. OS shortcuts, browser-chrome shortcuts, and Firefox's reserved Shift + right-click context menu cannot be overridden by a page extension.

ACCESS THE EXTENSION POPUP

1. Look beside the address bar and select the puzzle-piece Extensions icon.
2. Find Scroll Wheel Tab Switcher.
3. Select the extension to open its popup.
4. Optionally select the pin icon to keep it beside the address bar.

PRIVATE BY DESIGN

No data is sent to TabWheel, its developer, or any developer-owned service. TabWheel has no telemetry, tracking, analytics, ads, remote code, account, or search feature. Settings, onboarding progress, recent-tab order, recent page positions, and page geometry are stored locally. URLs used to verify page-position restoration remain local. TabWheel does not request browser-history or bookmarks permissions.

WHAT'S NEW IN 4.1.0

Three new mouse actions for any button: Mute / unmute tab, Go back, and Go forward. Defaults are unchanged; remap any button in the popup or settings.

## Privacy

No data is sent to TabWheel or developer-owned services. TabWheel stores only the local state needed for settings, onboarding, tab order, and page-position restore. See `PRIVACY.md` for details.

## Permissions

- `tabs`: Create, duplicate, move, close, mute, read, activate, and navigate the history of tabs for configured actions and tab-strip cycling.
- `storage`: Store settings, onboarding progress, recent-tab order, page positions, and the migration version locally.
- `scripting` (Chrome): Reconnect the content script to already-open normal web tabs after install, update, or manual refresh.
- `tabGroups` (Chrome): Detect collapsed groups so hidden-tab skipping can exclude their tabs.
- `<all_urls>`: Run the modifier-wheel listener and page-position capture/restore on supported web pages.

TabWheel does not request `history` or `bookmarks` permissions.

## Browser Support

Works on Firefox, Chrome, and Zen Browser.

## Store Assets

Prepare these from the production Chrome build at 100% browser zoom:

1. 1280 × 800 — onboarding gesture demo, caption: “Switch tabs from anywhere on the page.”
2. 1280 × 800 — three-button onboarding simulator, caption: “One modifier. Three mouse actions.”
3. 1280 × 800 — shared wheel-and-click settings, caption: “Configure every gesture.”
4. 1280 × 800 — complete popup ready state, caption: “Every control, right from the toolbar.”
5. 1280 × 800 — protected-page popup fallback, caption: “Reliable fallback controls.”
6. 440 × 280 — promo tile using the extension icon, “Alt + Wheel,” and “Switch tabs anywhere.”
