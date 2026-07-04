# Store Reference - TabWheel

## Listing Title

Scroll Wheel Tab Switcher

## Extension Names

- Firefox / Zen: Scroll Wheel Tab Switcher
- Chrome: Scroll Wheel Tab Switcher

## Summary (short, <=132 chars)

Alt + mouse wheel switches tabs. Left/middle/right clicks remap to search, new tab, recent, close, duplicate, settings.

## Description

Scroll Wheel Tab Switcher lets you switch browser tabs with your mouse wheel. Hold Alt and scroll on a normal web page to move to the next or previous tab, making tab switching a fast hand-on-mouse gesture instead of clicking through the tab bar or reaching for keyboard shortcuts. By default, Alt + Left Click opens TabWheel Search, Alt + Middle Click switches to the Most Recent Tab, and Alt + Right Click closes the current tab after activating a recent-tab target when available. Left, middle, and right click actions can each be remapped to TabWheel Search, Browser Default new tab, Most Recent Tab, Close Tab, Duplicate Tab, Open Settings, or native click pass-through. Mouse wheel cycling can use Left-To-Right mode or Most Recently Used mode. These behaviors are configurable from the extension popup toolbar and options page.

ACCESS EXTENSION POPUP TOOLBAR:
1. Look at the top-right of Chrome, next to the address bar.
2. Click the puzzle-piece icon for Extensions.
3. Find Scroll Wheel Tab Switcher.
4. Click the extension icon to open the popup toolbar.
5. Optional: click the pin icon next to Scroll Wheel Tab Switcher so it always appears beside the address bar.

FUNCTIONALITY:
Use Alt + Wheel to switch tabs based on the selected cycle mode. Left-To-Right mode cycles eligible tabs in visible tab-strip order. Most Recently Used mode cycles tabs based on recent use. Use Alt + Left Click to open TabWheel Search by default, Alt + Middle Click to switch to the Most Recent Tab, and Alt + Right Click to close the current tab. When a recent-tab target is available, it is activated before closing so the return target is deterministic.

CLICK ACTIONS:
TabWheel Search opens the in-page search launcher. Search uses the browser's default search provider first, with a fixed Google fallback if the browser search API is unavailable. Browser Default opens the browser's normal new tab page. Left, middle, and right click can each be remapped to Search, Browser Default, Most Recent Tab, Close Tab, Duplicate Tab, Open Settings, or native click pass-through.

CUSTOMIZATION:
Customize the modifier key, optional Shift requirement, click action remapping, wheel direction, tab-switch sensitivity, tab-switch cooldown, normal page-scroll speed, viewport step cap, acceleration, horizontal wheel support, pinned-tab handling, hidden-tab skipping, restricted-page skipping, wrap-around behavior, editable-field behavior, and safe overshoot guard for trackpads or free-spinning wheels. Page scrolling stays browser-native at 1.0x speed and 100% viewport cap; non-default page-scroll values filter normal vertical wheel scrolling on supported pages.

PRIVACY MODEL:
Scroll Wheel Tab Switcher does not use telemetry, tracking, analytics, remote code, or developer-owned servers. Extension settings, most-recently-used tab order, recent scroll positions, page geometry, and scroll-restore URL checks are stored locally in browser storage. Submitted TabWheel Search queries go to the browser's current default search provider, with Google fallback only if the browser search API is unavailable.

CONSTRAINTS / LIMITATIONS:
Page gestures work on normal web pages. Browser UI pages, extension pages, browser stores such as Chrome Web Store and Mozilla Add-ons, devtools, PDF viewers, and some restricted pages may block content scripts. Some modifier + click combinations may also be reserved by websites, the browser, or the operating system. When that happens, use the popup toolbar or choose a different modifier / Shift setting.

EXTENSION POPUP TOOLBAR:
The popup toolbar provides reliable controls when page shortcuts are blocked. It includes Mouse Scroll Wheel Cycle Mode, Click Actions, Previous / Next buttons, TabWheel Search, Most Recent Tab, Close Tab, Settings, Help, Refresh Scroll Wheel Tab Switcher, and four wheel tuning controls for tab sensitivity, tab cooldown, page-scroll speed, and viewport step cap.

SCROLL MEMORY:
Scroll Wheel Tab Switcher can remember recent scroll positions and restore them when cycling back to the same URL. Scroll restore uses URL checks, layout checks, and stale-restore cancellation to avoid restoring the wrong page position.

## Privacy

No data leaves your browser for telemetry, tracking, analytics, or developer-owned services. TabWheel stores settings, MRU tab order, recent scroll positions, page geometry, and URL checks for scroll restore through browser storage. Submitted TabWheel Search queries go to the browser's current default search provider, with the Google fallback used only if the browser search API is unavailable.

## Permissions

- `tabs`: Read, activate, create, and close tabs for cycling and click actions.
- `storage`: Store settings, MRU tab order, scroll positions, page geometry, and schema version locally.
- `search`: Run searches with the browser's current default search provider, with Google fallback if the browser search API is unavailable.
- `scripting` (Chrome): Activate the content script on already-open normal web tabs after install or update.
- `tabGroups` (Chrome): Detect collapsed tab groups so hidden-tab skipping can leave their tabs out of cycling.
- `<all_urls>`: Run the content script on pages so modifier-wheel cycling, page-scroll wheel tuning, and scroll memory can work.

## Browser Support

Works on Firefox, Chrome, and Zen Browser.
