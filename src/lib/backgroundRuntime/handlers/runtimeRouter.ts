// Keep one onMessage listener and compose handlers behind it. Most handler
// failures become action results; overview failures are allowed to reject so
// popup retry logic can distinguish "worker still waking" from "empty state."

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
        // The popup retries overview requests on rejection. Returning an action
        // error shape here would look like a healthy but empty overview.
        if (message.type === "TABWHEEL_GET_OVERVIEW") {
          throw error;
        }
        return { ok: false, reason: "Something went wrong in TabWheel" };
      }
    }
    return null;
  });
}
