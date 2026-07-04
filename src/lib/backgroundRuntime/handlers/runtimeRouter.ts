// Single runtime.onMessage listener that routes messages to handlers in order.
// Handlers signal "not mine" with the UNHANDLED marker; anything a handler
// throws is converted to an error result so one bad message cannot leave a
// sender hanging on a rejected promise.

import browser from "webextension-polyfill";
import { BackgroundRuntimeMessage } from "../../common/contracts/runtimeMessages";

export const UNHANDLED = Symbol("background-runtime-unhandled");
export type RuntimeMessageResult = unknown | typeof UNHANDLED;

export type RuntimeMessageHandler = (
  message: BackgroundRuntimeMessage,
  sender: browser.Runtime.MessageSender,
) => Promise<RuntimeMessageResult>;

export function registerRuntimeMessageRouter(
  handlers: RuntimeMessageHandler[],
): void {
  browser.runtime.onMessage.addListener(async (receivedMessage: unknown, sender: browser.Runtime.MessageSender) => {
    if (typeof receivedMessage !== "object" || receivedMessage === null) return null;
    const message = receivedMessage as BackgroundRuntimeMessage;
    for (const handler of handlers) {
      try {
        const result = await handler(message, sender);
        if (result !== UNHANDLED) {
          return result;
        }
      } catch (error) {
        console.error("[TabWheel] Runtime message handler failed:", error);
        // Overview is a query, not an action — its callers retry on rejection
        // (getTabWheelOverviewWithRetry), so rethrow instead of returning a
        // result shape the popup would misread as a healthy-but-empty overview.
        if (message.type === "TABWHEEL_GET_OVERVIEW") {
          throw error;
        }
        return { ok: false, reason: "Internal error" };
      }
    }
    return null;
  });
}
