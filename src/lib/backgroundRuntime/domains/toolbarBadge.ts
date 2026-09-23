// Toolbar badge adapter: shows a "!" on the toolbar icon for tabs where
// TabWheel cannot run. Whether a page gets the badge is decided purely by
// resolveToolbarBadge in restrictedPagesCore; this module only talks to the
// toolbar-icon ("action") API and keeps every badge scoped to one tab.
//
// The API is feature-detected so a missing namespace degrades to no badge
// instead of a thrown error (same pattern as getBrowserTabGroupsApi() in
// tabWheelDomain.ts).

import browser from "webextension-polyfill";
import { resolveToolbarBadge } from "../../core/tabWheel/restrictedPagesCore";

const RESTRICTED_BADGE_BACKGROUND_COLOR = "#b45309";

interface ToolbarBadgeApi {
  setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  setBadgeBackgroundColor?(details: { color: string; tabId?: number }): Promise<void>;
}

let badgeBackgroundColorApplied = false;

/** Returns the toolbar-icon badge API, or null when the browser lacks it. */
export function getToolbarBadgeApi(): ToolbarBadgeApi | null {
  const runtimeBrowser = browser as unknown as {
    action?: Partial<ToolbarBadgeApi>;
  };
  const api = runtimeBrowser.action ?? null;
  return typeof api?.setBadgeText === "function" ? (api as ToolbarBadgeApi) : null;
}

/**
 * Sets the badge color once per worker lifetime. The flag is set before the
 * call so concurrent updates do not repeat it, and reset on failure so the
 * next update retries.
 */
async function ensureBadgeBackgroundColor(api: ToolbarBadgeApi): Promise<void> {
  if (badgeBackgroundColorApplied || typeof api.setBadgeBackgroundColor !== "function") return;
  badgeBackgroundColorApplied = true;
  try {
    await api.setBadgeBackgroundColor({ color: RESTRICTED_BADGE_BACKGROUND_COLOR });
  } catch (_) {
    badgeBackgroundColorApplied = false;
  }
}

// Always tab-scoped: shows or clears the restricted-page badge on `tabId` for
// `pageUrl`; `showBadge` false always clears it. Every setBadgeText call
// in this module carries a tabId; a global call would badge every tab.
export async function updateTabToolbarBadge(
  tabId: number,
  pageUrl: string | undefined,
  showBadge: boolean,
): Promise<void> {
  const api = getToolbarBadgeApi();
  if (!api) return;
  const badge = resolveToolbarBadge(pageUrl, showBadge);

  if (badge) {
    await ensureBadgeBackgroundColor(api);
    try {
      await api.setBadgeText({ text: badge.text, tabId });
    } catch (_) {
      // Tab likely closed mid-update; nothing further to reconcile.
    }
    return;
  }

  // Always issue the clear call rather than remembering which tabs were
  // badged: the service worker can restart at any time, and anything held in
  // memory would be lost, stranding a stale "!" on a tab badged before it.
  try {
    await api.setBadgeText({ text: "", tabId });
  } catch (_) {
    // Tab likely closed mid-update; nothing further to reconcile.
  }
}
