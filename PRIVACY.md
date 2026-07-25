# Privacy Policy — TabWheel

TabWheel does not collect, transmit, or share user data with developer-owned services. It has no telemetry, analytics, tracking, account, remote code, or developer-owned server. All extension state stays in the browser's local extension storage.

## Data stored locally

- **Settings** (`tabWheelSettings`): modifier, optional Shift requirement, preserved wheel direction, the Open settings/Off middle-click preference, cycle order, tab filters, wheel feel, sensitivity, cooldown, acceleration, whether wheel feel auto-tunes to your device, and whether a badge appears on browser-restricted pages. Reliability rules for page-position restore, editable fields, horizontal input, protected pages, wraparound, and overshoot protection are stored as always enabled.
- **Onboarding state** (`tabWheelOnboarding`): whether the local demo was completed, whether the first real wheel cycle succeeded, and whether the one-time focused-release notice was seen.
- **MRU state** (`tabWheelMruState`): recent tab IDs grouped by window for recently used cycling. It is cleared on browser startup and bounded to 100 tabs per window.
- **Scroll memory** (`tabWheelScrollMemory`): tab and window IDs, the page URL used only to verify that restore targets the same page, root X/Y position, normalized position, page/viewport dimensions, and update time. It is bounded to 300 entries.
- **Device profile** (`tabWheelDeviceProfile`): what auto-tune recognized about the pointing device driving your wheel gesture — the device kind (clicky wheel, free-spin wheel, or trackpad) and, for a clicky wheel, its notch size in pixels, plus when it was last updated. It is derived only from wheel event timing and distance, never from page content, and it is stored so every tab can share one answer instead of re-deriving it. It never leaves your browser.
- **Schema version** (`storageSchemaVersion`): a number used to migrate local settings safely.

TabWheel measures wheel timing, magnitude, and scroll mode in memory as you scroll. These measurements are used for device detection only when "Auto-tune for your device" is on (and during the welcome page's calibration step); they are never stored, transmitted, or shared, and are discarded when the page unloads.

TabWheel does not read page text, form values, browsing history, or bookmarks. It does not store mouse clicks or normal page scrolling.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Read and activate browser tabs for left-to-right and recently used cycling |
| `storage` | Save settings, onboarding state, MRU order, scroll positions, the recognized device profile, and schema version locally |
| `scripting` | Chrome-only: activate or retry the content script on already-open supported tabs |
| `tabGroups` | Chrome-only: detect collapsed groups when hidden-tab skipping is enabled |
| `<all_urls>` | Run the configured modifier-wheel listener and page-position capture/restore on supported web pages |

TabWheel does not request `search`, `history`, or `bookmarks` permissions.

## Data sharing and deletion

There is no data sharing by TabWheel. Resetting the extension clears its settings, MRU order, and scroll memory. It leaves the device profile in place, because that is measured evidence about your hardware rather than a preference, and it is re-measured automatically if you change devices. Removing the extension allows the browser to remove its local extension storage, including the device profile.
