# Store Reference - TabWheel

## Listing Title

Scroll Wheel Tab Switcher

## Extension Names

- Firefox / Zen: Scroll Wheel Tab Switcher
- Chrome: Scroll Wheel Tab Switcher

## Summary (short, <=132 chars)

Hold Alt and scroll your mouse wheel to switch tabs. Alt+middle-click opens settings. Optional: choose what each mouse click does.

## Description

WHAT'S NEW IN 2.1.0:
- TabWheel Search now suggests local matches from recent searches, open tabs, browser history, and bookmarks as you type.
- Type /tab, /hist, or /book to filter suggestions to open tabs, history, or bookmarks.
- Fuzzy highlighting and keyboard navigation make the search launcher faster to use from the page.
- History and bookmark selections switch to an already-open matching tab when possible instead of creating duplicates.
- Private-window search submissions are not saved as recent searches.
- Popup and options controls were streamlined with a settings gear, clearer descriptions, matching Refresh / Reset buttons, and consistent settings sync.
- Reset to defaults now clears local TabWheel settings and state so the current defaults take effect cleanly.

CURRENT DEFAULTS:
- Hold Alt and scroll the mouse wheel to switch tabs.
- Left-To-Right mode is the default cycle mode; Most Recently Used mode is also available.
- Alt + Middle Click opens Settings by default.
- Alt + Left Click and Alt + Right Click keep their native browser/page behavior until you remap them.
- Left, middle, and right click can each be remapped to TabWheel Search, Browser Default new tab, Most Recent Tab, Close Tab, Duplicate Tab, Open Settings, or native click pass-through.
- Restricted pages are skipped by default. Pinned-tab and hidden-tab skipping are available options.
- Normal page scrolling stays browser-native at 1.0x speed and a 100% viewport step cap until you change page-scroll tuning.

Scroll Wheel Tab Switcher lets you switch browser tabs with your mouse wheel. Hold Alt and scroll on a normal web page to move to the next or previous tab, making tab switching a fast hand-on-mouse gesture instead of clicking through the tab bar or reaching for keyboard shortcuts. By default, Alt + Middle Click opens the Settings page, while Alt + Left Click and Alt + Right Click keep their native click behavior until you remap them. Left, middle, and right click actions can each be remapped to TabWheel Search, Browser Default new tab, Most Recent Tab, Close Tab, Duplicate Tab, Open Settings, or native click pass-through. Mouse wheel cycling can use Left-To-Right mode or Most Recently Used mode. These behaviors are configurable from the extension popup toolbar and options page.

ACCESS EXTENSION POPUP TOOLBAR:
1. Look at the top-right of Chrome, next to the address bar.
2. Click the puzzle-piece icon for Extensions.
3. Find Scroll Wheel Tab Switcher.
4. Click the extension icon to open the popup toolbar.
5. Optional: click the pin icon next to Scroll Wheel Tab Switcher so it always appears beside the address bar.

FUNCTIONALITY:
Use Alt + Wheel to switch tabs based on the selected cycle mode. Left-To-Right mode cycles eligible tabs in visible tab-strip order. Most Recently Used mode cycles tabs based on recent use. Use Alt + Middle Click to open Settings by default; Alt + Left Click and Alt + Right Click stay native until remapped to actions like TabWheel Search, Most Recent Tab, or Close Tab. When closing with a recent-tab target available, it is activated before closing so the return target is deterministic.

CLICK ACTIONS:
TabWheel Search opens the in-page search launcher. As you type, it suggests matches from your recent searches, open tabs, browser history, and bookmarks, all matched locally on your device with fuzzy highlighting and keyboard navigation; type /tab, /hist, or /book to narrow to one source. Press Enter to run a web search, jump to the selected open tab, or open the selected history or bookmark page, switching to an already-open tab instead of duplicating it. Search uses the browser's default search provider first, with a fixed Google fallback if the browser search API is unavailable. Browser Default opens the browser's normal new tab page. Left, middle, and right click can each be remapped to Search, Browser Default, Most Recent Tab, Close Tab, Duplicate Tab, Open Settings, or native click pass-through.

CUSTOMIZATION:
Customize the modifier key, optional Shift requirement, click action remapping, wheel direction, tab-switch sensitivity, tab-switch cooldown, normal page-scroll speed, viewport step cap, acceleration, horizontal wheel support, pinned-tab handling, hidden-tab skipping, restricted-page skipping, wrap-around behavior, editable-field behavior, and safe overshoot guard for trackpads or free-spinning wheels. Page scrolling stays browser-native at 1.0x speed and 100% viewport cap; non-default page-scroll values filter normal vertical wheel scrolling on supported pages.

PRIVACY MODEL:
Scroll Wheel Tab Switcher does not use telemetry, tracking, analytics, remote code, or developer-owned servers. Extension settings, most-recently-used tab order, recent search queries, recent scroll positions, page geometry, and scroll-restore URL checks are stored locally in browser storage. Search launcher suggestions from recent searches, open tabs, browser history, and bookmarks are matched locally and are never transmitted. Submitted TabWheel Search queries go to the browser's current default search provider, with Google fallback only if the browser search API is unavailable.

CONSTRAINTS / LIMITATIONS:
Page gestures work on normal web pages. Browser UI pages, extension pages, browser stores such as Chrome Web Store and Mozilla Add-ons, devtools, PDF viewers, and some restricted pages may block content scripts. Some modifier + click combinations may also be reserved by websites, the browser, or the operating system. When that happens, use the popup toolbar or choose a different modifier / Shift setting.

EXTENSION POPUP TOOLBAR:
The popup toolbar provides reliable controls when page shortcuts are blocked. It includes Mouse Scroll Wheel Cycle Mode, Click Actions, Previous / Next buttons, TabWheel Search, Most Recent Tab, Close Tab, Reset, Settings, Refresh Scroll Wheel Tab Switcher, and four wheel tuning controls for tab sensitivity, tab cooldown, page-scroll speed, and viewport step cap.

SCROLL MEMORY:
Scroll Wheel Tab Switcher can remember recent scroll positions and restore them when cycling back to the same URL. Scroll restore uses URL checks, layout checks, and stale-restore cancellation to avoid restoring the wrong page position.

## Privacy

No data leaves your browser for telemetry, tracking, analytics, or developer-owned services. TabWheel stores settings, MRU tab order, recent scroll positions, page geometry, and URL checks for scroll restore through browser storage. Submitted TabWheel Search queries go to the browser's current default search provider, with the Google fallback used only if the browser search API is unavailable.

## Permissions

- `tabs`: Read, activate, create, and close tabs for cycling and click actions.
- `storage`: Store settings, MRU tab order, recent searches, scroll positions, page geometry, and schema version locally.
- `search`: Run searches with the browser's current default search provider, with Google fallback if the browser search API is unavailable.
- `history`: Match browser history against search launcher queries locally on your device; nothing is transmitted.
- `bookmarks`: Match bookmarks against search launcher queries locally on your device; nothing is transmitted.
- `scripting` (Chrome): Activate the content script on already-open normal web tabs after install or update.
- `tabGroups` (Chrome): Detect collapsed tab groups so hidden-tab skipping can leave their tabs out of cycling.
- `<all_urls>`: Run the content script on pages so modifier-wheel cycling, page-scroll wheel tuning, and scroll memory can work.

## Browser Support

Works on Firefox, Chrome, and Zen Browser.
