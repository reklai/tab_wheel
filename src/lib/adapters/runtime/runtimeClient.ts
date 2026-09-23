// Low-level sender for messages to the background service worker. Every
// surface (content script, popup, options, onboarding) goes through here via
// the typed wrappers in tabWheelApi.ts.
//
// The MV3 service worker can be asleep when a UI surface opens, and the first
// message may reject while it starts. Callers that need fresh state use the
// retry wrapper instead of handling that wake-up race inline.

import browser from "webextension-polyfill";
import { BackgroundRuntimeMessage } from "../../common/contracts/runtimeMessages";
import { sleep } from "../../common/utils/asyncFlow";

/** Delays before each attempt, in order; the attempt count is the array length. */
export interface RuntimeRetryPolicy {
  retryDelaysMs: number[];
}

/** Four attempts spread over roughly 700ms, enough to cover a cold worker start. */
export const DEFAULT_RUNTIME_RETRY_POLICY: RuntimeRetryPolicy = {
  retryDelaysMs: [0, 80, 220, 420],
};

/**
 * Sends one message to the background and resolves with the handler's result.
 * Rejects if the worker cannot be reached; the result type is not validated.
 */
export async function sendRuntimeMessage<T>(
  message: BackgroundRuntimeMessage,
): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}

/**
 * Sends `message`, retrying on rejection after each delay in `policy`.
 * Rethrows the last error once every attempt has failed. Use only for
 * idempotent requests, since an attempt may reach the worker and still reject.
 */
export async function sendRuntimeMessageWithRetry<T>(
  message: BackgroundRuntimeMessage,
  policy: RuntimeRetryPolicy = DEFAULT_RUNTIME_RETRY_POLICY,
): Promise<T> {
  let lastError: unknown = null;
  for (const delay of policy.retryDelaysMs) {
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      return await sendRuntimeMessage<T>(message);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Runtime message failed: ${message.type}`);
}
