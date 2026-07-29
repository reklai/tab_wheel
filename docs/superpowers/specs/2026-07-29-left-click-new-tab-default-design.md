# Left-click Browser New Tab Default

## Goal

Use Browser New Tab as the default modifier + left-click action without
overwriting a user's saved mouse-button mapping.

## Behavior

- Fresh installs use `nativeNewTab` for `leftClickAction`.
- Reset to defaults restores `nativeNewTab` for `leftClickAction`.
- Normalization uses `nativeNewTab` when the stored left-click action is
  missing or invalid.
- Upgrade migrations preserve every valid saved left-click action, including
  `dragCurrentTab`, `recentTab`, and `none`.

## Implementation boundary

The default remains centralized in
`DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS`. Shared settings normalization and
upgrade fallback behavior derive from that contract or use the same
`nativeNewTab` value. No migration may replace a valid saved action.

## Verification

Automated checks must prove that:

1. The default left-click policy runs `nativeNewTab`.
2. Fresh and reset settings normalize to `nativeNewTab`.
3. Upgrade migrations preserve valid customized mappings.
4. The complete Firefox and Chrome builds continue to pass.

The behavior should also be smoke-tested by resetting settings, holding the
configured modifier, and left-clicking a normal web page. The browser's New Tab
page should open beside the current tab.
