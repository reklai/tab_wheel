// Toolbar badge adapter. The decision of whether a tab should show the
// restricted-page badge is pure (resolveToolbarBadge in restrictedPagesCore);
// this module only knows how to talk to whichever toolbar-icon API the
// current manifest exposes and how to keep it tab-scoped.
//
// MV3 Chrome declares "action"; MV2 Firefox declares "browser_action".
// webextension-polyfill only implements the namespace the underlying browser
// actually supports, so both must be feature-detected defensively (mirrors
// getBrowserTabGroupsApi() in tabWheelDomain.ts).

import browser from "webextension-polyfill";
import { resolveToolbarBadge } from "../../core/tabWheel/restrictedPagesCore";

const RESTRICTED_BADGE_BACKGROUND_COLOR = "#b45309";

interface ToolbarBadgeApi {
  setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  setBadgeBackgroundColor?(details: { color: string; tabId?: number }): Promise<void>;
}

// Module-level cache of tabIds currently showing the badge, so a settings
// toggle-off (or event-page reload) knows which tabs to clear. This state is
// a best-effort cache, not a source of truth: an MV2 Firefox event page can
// be suspended and lose it, but the badge text itself persists per-tab in the
// browser UI, and the next activation/update re-applies it from scratch.
const badgedTabIds = new Set<number>();
let badgeBackgroundColorApplied = false;

export function getToolbarBadgeApi(): ToolbarBadgeApi | null {
  const runtimeBrowser = browser as unknown as {
    action?: Partial<ToolbarBadgeApi>;
    browserAction?: Partial<ToolbarBadgeApi>;
  };
  const api = runtimeBrowser.action ?? runtimeBrowser.browserAction ?? null;
  return typeof api?.setBadgeText === "function" ? (api as ToolbarBadgeApi) : null;
}

async function ensureBadgeBackgroundColor(api: ToolbarBadgeApi): Promise<void> {
  if (badgeBackgroundColorApplied || typeof api.setBadgeBackgroundColor !== "function") return;
  badgeBackgroundColorApplied = true;
  try {
    await api.setBadgeBackgroundColor({ color: RESTRICTED_BADGE_BACKGROUND_COLOR });
  } catch (_) {
    badgeBackgroundColorApplied = false;
  }
}

// Always tab-scoped: every setBadgeText call below carries the tabId, and
// this module never calls it without one.
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
      badgedTabIds.add(tabId);
    } catch (_) {
      // Tab likely closed mid-update; nothing further to reconcile.
    }
    return;
  }

  // Always issue the clear call, even if this tabId isn't in badgedTabIds:
  // the Set is wiped on every MV3 service-worker idle restart / MV2
  // event-page suspend, so a badge applied before a restart would otherwise
  // be un-clearable — gating this on Set membership would leave a stale "!"
  // on a backgrounded tab that navigates away after the worker restarts.
  try {
    await api.setBadgeText({ text: "", tabId });
  } catch (_) {
    // Tab likely closed mid-update; still forget it below.
  } finally {
    badgedTabIds.delete(tabId);
  }
}

// Tab removal cleanup: no browser call needed, the tab is already gone.
export function forgetToolbarBadgeTab(tabId: number): void {
  badgedTabIds.delete(tabId);
}

export async function clearAllToolbarBadges(): Promise<void> {
  const api = getToolbarBadgeApi();
  const tabIds = Array.from(badgedTabIds);
  badgedTabIds.clear();
  if (!api) return;
  await Promise.all(tabIds.map((tabId) =>
    api.setBadgeText({ text: "", tabId }).catch(() => {
      // Tab is gone; dropping it from the tracking Set above is enough.
    })));
}
