// Translates TabWheel runtime messages into domain calls. Returns the router's
// UNHANDLED marker for message types it does not own so additional handlers
// can be composed behind it.

import browser from "webextension-polyfill";
import { TabWheelDomain } from "../domains/tabWheelDomain";
import { RuntimeMessageHandler, UNHANDLED } from "./runtimeRouter";

async function openHelpInActiveTab(): Promise<TabWheelActionResult> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) {
    return { ok: false, reason: "No active tab" };
  }
  try {
    await browser.tabs.sendMessage(tab.id, { type: "OPEN_TABWHEEL_HELP" });
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: "Help is unavailable on this page" };
  }
}

async function openOptionsPage(): Promise<TabWheelActionResult> {
  try {
    await browser.runtime.openOptionsPage();
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: "Settings unavailable" };
  }
}

export function createTabWheelMessageHandler(
  domain: TabWheelDomain,
): RuntimeMessageHandler {
  return async (message, sender) => {
    switch (message.type) {
      case "TABWHEEL_CONTENT_READY":
        return domain.markContentScriptReady(sender.tab);

      case "TABWHEEL_CYCLE":
        return await domain.cycle(message.direction, sender.tab);

      case "TABWHEEL_REFRESH_CURRENT_TAB":
        return await domain.refreshCurrentTab(sender.tab, message.windowId ?? sender.tab?.windowId);

      case "TABWHEEL_GET_OVERVIEW":
        return await domain.getOverview(sender.tab, message.windowId ?? sender.tab?.windowId);

      case "TABWHEEL_TOGGLE_CYCLE_SCOPE":
        return await domain.toggleCycleScope(sender.tab, message.windowId);

      case "TABWHEEL_SET_CYCLE_SCOPE":
        return await domain.setCycleScope(message.cycleScope, sender.tab, message.windowId, {
          suppressPageStatus: message.suppressPageStatus,
        });

      case "TABWHEEL_OPEN_SEARCH_TAB":
        return await domain.openSearchTab(message.query, sender.tab, message.windowId);

      case "TABWHEEL_OPEN_NATIVE_NEW_TAB":
        return await domain.openNativeNewTab(sender.tab, message.windowId);

      case "TABWHEEL_ACTIVATE_MOST_RECENT_TAB":
        return await domain.activateMostRecentTab(sender.tab, message.windowId);

      case "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT":
        return await domain.closeCurrentTabAndActivateRecent(sender.tab, message.windowId);

      case "TABWHEEL_DUPLICATE_TAB":
        return await domain.duplicateTab(sender.tab, message.windowId);

      case "TABWHEEL_SAVE_SCROLL_POSITION": {
        const tabId = sender.tab?.id;
        const windowId = sender.tab?.windowId;
        if (tabId == null || windowId == null) return { ok: false, reason: "No sender tab" };
        return await domain.saveScrollPosition(
          tabId,
          windowId,
          sender.tab?.url,
          message,
        );
      }

      case "TABWHEEL_OPEN_HELP":
        return await openHelpInActiveTab();

      case "TABWHEEL_OPEN_OPTIONS":
        return await openOptionsPage();

      default:
        return UNHANDLED;
    }
  };
}
