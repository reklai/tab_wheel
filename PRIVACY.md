# Privacy Policy — TabWheel

TabWheel does not collect, transmit, or share user data with developer-owned services. It has no telemetry, analytics, tracking, account, remote code, or developer-owned server. All extension state stays in the browser's local extension storage.

## Data stored locally

- **Settings** (`tabWheelSettings`): modifier, optional Shift requirement, preserved wheel direction, the Open settings/Off middle-click preference, cycle order, tab filters, wheel feel, sensitivity, cooldown, acceleration, and whether a badge appears on browser-restricted pages. Reliability rules for page-position restore, editable fields, horizontal input, protected pages, wraparound, and overshoot protection are stored as always enabled.
- **Onboarding state** (`tabWheelOnboarding`): whether the local demo was completed, whether the first real wheel cycle succeeded, and whether the one-time focused-release notice was seen.
- **MRU state** (`tabWheelMruState`): recent tab IDs grouped by window for recently used cycling. It is cleared on browser startup and bounded to 100 tabs per window.
- **Scroll memory** (`tabWheelScrollMemory`): tab and window IDs, the page URL used only to verify that restore targets the same page, root X/Y position, normalized position, page/viewport dimensions, and update time. It is bounded to 300 entries.
- **Schema version** (`storageSchemaVersion`): a number used to migrate local settings safely.

TabWheel processes the timing, magnitude, and scroll mode of wheel events made with the gesture modifier held in memory only to recognize and complete the gesture itself (including the momentum guard that filters out unintended trailing switches); this is never stored, transmitted, or shared, and is discarded as soon as the gesture is handled.

TabWheel does not read page text, form values, browsing history, or bookmarks. It does not store mouse clicks or normal page scrolling.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Read and activate browser tabs for left-to-right and recently used cycling |
| `storage` | Save settings, onboarding state, MRU order, scroll positions, and schema version locally |
| `scripting` | Chrome-only: activate or retry the content script on already-open supported tabs |
| `tabGroups` | Chrome-only: detect collapsed groups when hidden-tab skipping is enabled |
| `<all_urls>` | Run the configured modifier-wheel listener and page-position capture/restore on supported web pages |

TabWheel does not request `search`, `history`, or `bookmarks` permissions.

## Data sharing and deletion

There is no data sharing by TabWheel. Resetting the extension clears its settings, MRU order, and scroll memory. Removing the extension allows the browser to remove its local extension storage.
