# Middle-click Drag Default and Cold-start Activation

## Goal

Make modifier + middle click drag the current tab by default, and make TabWheel
gestures available on eligible restored tabs immediately after a browser
startup or restart without reloading those tabs.

## Default mouse action

- Fresh installs use `dragCurrentTab` for `middleClickAction`.
- Reset to defaults restores `dragCurrentTab` for `middleClickAction`.
- Settings normalization uses `dragCurrentTab` when the stored middle-click
  action is missing or invalid.
- Upgrades preserve every valid saved middle-click action. This change must not
  overwrite an existing user's customization.
- Product documentation, onboarding copy, and store assets describe modifier +
  middle click as Drag current tab.

## Browser cold-start activation

At `runtime.onStartup`, TabWheel performs startup housekeeping and content-script
activation as independent best-effort operations. A storage or housekeeping
failure must not prevent restored-tab activation.

For each browser window, TabWheel programmatically injects `contentScript.js`
into eligible loaded tabs using the target browser's supported API:

- Chrome and other Manifest V3 builds use `scripting.executeScript`.
- Firefox and other Manifest V2 builds use `tabs.executeScript`.

Injection first targets all frames to match manifest-declared content-script
coverage. If a restricted child frame makes that fail, TabWheel retries the top
frame, which is sufficient for page-level gestures. Repeated injection remains
safe because content-script initialization removes the previous TabWheel
listeners before registering replacements.

The startup handler awaits an initial activation pass and active-tab readiness,
then waits two seconds and repeats the pass. The delayed pass covers tabs that
appear late during browser session restoration. No startup path reloads or
navigates a tab.

## Eligibility and lazy-restored tabs

Startup activation skips browser-restricted URLs and tabs whose `discarded`
state is true. It must not wake discarded tabs merely to install TabWheel,
because doing so would defeat the browser's lazy session restoration and spend
memory without user intent.

When a discarded tab is activated and wakes, the existing tab-activation path
ensures its content script is present. A normal navigation also receives the
manifest-declared content script. Browser settings pages, extension stores,
PDF viewers, devtools, and other browser-protected pages remain outside content
script control and continue using the toolbar fallback.

## Failure handling

- Startup housekeeping logs failure and allows activation to continue.
- Initial activation logs failure and still permits the delayed retry.
- Delayed activation logs failure without destabilizing the background runtime.
- A failure in one tab is recorded by the activation result but does not abort
  injection into other eligible tabs.
- Startup activation must not erase user settings or overwrite valid mouse
  mappings.

## Verification

Automated checks must prove that:

1. Default mouse policies map the middle button to a drag interaction.
2. Fresh/reset normalization uses `dragCurrentTab` while upgrades preserve
   valid saved mappings.
3. Startup registration invokes the programmatic injection path, ensures active
   tabs, retries after two seconds, and contains no tab reload.
4. Both the Manifest V3 and Manifest V2 injection APIs remain wired.
5. Repeated content-script initialization cleans up old listeners.
6. Documentation, onboarding, and store assets agree with the new default.
7. Lint, tests, type checking, compatibility checks, store checks, and Firefox
   and Chrome builds pass.

Manual smoke testing should restart each supported browser with normal and
discarded tabs restored. Loaded eligible pages should accept the configured
modifier-wheel and modifier + middle-drag gestures without a reload. A
discarded page should remain asleep until selected, then accept gestures after
activation. Existing customized middle-click mappings must remain unchanged.
