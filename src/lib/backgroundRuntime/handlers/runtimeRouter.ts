// The background's single runtime.onMessage listener. Every message from the
// content script, popup, options, and onboarding pages lands here and is
// offered to each handler in order; see tabWheelApi.ts for the full path.
//
// Keep exactly one listener and compose handlers behind it, so the reply for a
// message comes from one place. The listener is async because
// webextension-polyfill turns its returned promise into the sendMessage reply.

import browser from "webextension-polyfill";
import { BackgroundRuntimeMessage } from "../../common/contracts/runtimeMessages";

/** Returned by a handler to pass a message it does not own to the next one. */
export const UNHANDLED = Symbol("background-runtime-unhandled");
export type RuntimeMessageResult = unknown | typeof UNHANDLED;

/**
 * One slice of the message space. Resolves with the reply for messages it
 * owns and with UNHANDLED for everything else.
 */

export type RuntimeMessageHandler = (
  message: BackgroundRuntimeMessage,
  sender: browser.Runtime.MessageSender,
) => Promise<RuntimeMessageResult>;

/**
 * Installs the onMessage listener. Must run synchronously during worker
 * startup (see background.ts). A handler that throws produces a generic
 * failure result, except for overview requests, which reject: the popup
 * retries on rejection, and a failure result would read as a healthy but
 * empty overview.
 */
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
        // Let overview failures reject so the popup's retry can tell a waking
        // worker from an empty state.
        if (message.type === "TABWHEEL_GET_OVERVIEW") {
          throw error;
        }
        return { ok: false, reason: "Something went wrong in TabWheel" };
      }
    }
    return null;
  });
}
