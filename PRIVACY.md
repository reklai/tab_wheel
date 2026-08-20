# Privacy Policy — TabWheel

TabWheel does not collect, transmit, or share user data with developer-owned services. It has no telemetry, analytics, tracking, account, remote code, or developer-owned server. All extension state stays in the browser's local extension storage.

## Data stored locally

- **Settings** (`tabWheelSettings`): modifier, optional Shift requirement, the left/middle/right click actions, wheel direction, tab filters, whether cycling wraps around at the ends, whether cycling stays within the active tab's group, wheel feel, sensitivity, cooldown, and acceleration. Reliability rules for page-position restore, editable fields, horizontal input, protected pages, overshoot protection, and a toolbar badge on recognized browser-restricted URLs are stored as always enabled.
- **Onboarding state** (`tabWheelOnboarding`): a version number for the onboarding flow, whether the local demo was completed, whether the first real wheel cycle succeeded, and whether the V4 click-action introduction was seen.
- **Recent-tab state** (`tabWheelRecentTabs`): recent tab IDs grouped by window for the Most recent tab and Close current tab actions. It is cleared on browser startup and bounded to 100 tabs per window.
- **Scroll memory** (`tabWheelScrollMemory`): tab and window IDs, the page URL used only to verify that restore targets the same page, root X/Y position, normalized position, page/viewport dimensions, and update time. It is bounded to 300 entries.
- **Schema version** (`storageSchemaVersion`): a number used to migrate local settings safely.

TabWheel processes the timing, magnitude, and scroll mode of wheel events made with the gesture modifier held in memory only to recognize and complete the gesture itself (including the momentum guard that filters out unintended trailing switches); this is never stored, transmitted, or shared, and is discarded as soon as the gesture is handled. TabWheel also checks key presses only to notice that the configured gesture modifier went down, so it can wake its own background process before the first wheel notch; every other key is ignored immediately, no typed text is read, and nothing about any key press is stored, transmitted, or shared.

TabWheel does not read host-page text, host-page form values, browsing history, or bookmarks. It does not store mouse clicks, modifier-click targets, key presses, or normal page scrolling.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Create, duplicate, move, close, read, and activate browser tabs for configured actions and tab-strip cycling |
| `storage` | Save settings, onboarding state, recent-tab order, scroll positions, and schema version locally |
| `scripting` | Chrome-only: activate or retry the content script on already-open supported tabs |
| `tabGroups` | Chrome-only: detect collapsed groups when hidden-tab skipping is enabled |
| `<all_urls>` | Run the configured modifier-wheel listener and page-position capture/restore on supported web pages |

TabWheel does not request `history` or `bookmarks` permissions.

## Data sharing and deletion

There is no data sharing by TabWheel. Resetting the extension clears its settings, recent-tab order, and scroll memory. Removing the extension allows the browser to remove its local extension storage.
