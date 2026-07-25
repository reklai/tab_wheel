// This handler owns TabWheel messages only; unrelated runtime messages must
// keep flowing to later handlers through UNHANDLED.

import browser from "webextension-polyfill";
import { TabWheelDomain } from "../domains/tabWheelDomain";
import { RuntimeMessageHandler, UNHANDLED } from "./runtimeRouter";

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
        return await domain.cycle(message.direction, message.source, sender.tab);

      case "TABWHEEL_REFRESH_CURRENT_TAB":
        return await domain.refreshCurrentTab(sender.tab, message.windowId ?? sender.tab?.windowId);

      case "TABWHEEL_GET_OVERVIEW":
        return await domain.getOverview(sender.tab, message.windowId ?? sender.tab?.windowId);

      case "TABWHEEL_SET_CYCLE_SCOPE":
        return await domain.setCycleScope(message.cycleScope, sender.tab, message.windowId, {
          suppressPageStatus: message.suppressPageStatus,
        });

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

      case "TABWHEEL_OPEN_OPTIONS":
        return await openOptionsPage();

      case "TABWHEEL_RESET_STATE":
        return await domain.resetState();

      case "TABWHEEL_ACTIVATE_CONTENT_SCRIPTS":
        return await domain.activateExistingContentScripts();

      default:
        return UNHANDLED;
    }
  };
}
