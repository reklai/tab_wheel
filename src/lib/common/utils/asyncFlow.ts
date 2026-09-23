// Promise-sequencing primitives. The background service worker handles many
// messages concurrently, and these keep its loads, storage writes, and
// per-window work in a predictable order.

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A memoized task started by calling it; see createInFlightMemo. */
export type InFlightMemo = () => Promise<void>;

/**
 * Wraps `task` so it runs once for all callers: while it is in flight every
 * call gets the same promise, and after it succeeds every call resolves at
 * once without running it again. A failure is not memoized, so the next call
 * retries.
 */
export function createInFlightMemo(task: () => Promise<void>): InFlightMemo {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = task().catch((error: unknown) => {
      inFlight = null;
      throw error;
    });
    return inFlight;
  };
}

/** Serializes async writes; see createWriteChain. */
export interface WriteChain {
  enqueue(task: () => Promise<void>): Promise<void>;
}

/**
 * Runs enqueued tasks one at a time, in order. Each starts only after every
 * earlier one has settled, and a failure never blocks the tasks behind it.
 * The promise `enqueue` returns reports that task's own outcome.
 */
export function createWriteChain(): WriteChain {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(task: () => Promise<void>): Promise<void> {
      const scheduledWrite = chain.catch(() => {}).then(() => task());
      chain = scheduledWrite.catch(() => {});
      return scheduledWrite;
    },
  };
}

/** Serializes tasks per key; see createKeyedTaskQueue. */
export interface KeyedTaskQueue {
  run<T>(key: number, task: () => Promise<T>): Promise<T>;
}

/** A debounced call; `cancel()` drops a pending call. */
export interface DebouncedFunction<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/**
 * Delays calling `fn` until `delayMs` ms pass with no further call; the last
 * call's arguments win.
 */
export function createDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): DebouncedFunction<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: A): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
  debounced.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/**
 * Runs tasks one at a time per key (the background keys by window id), in
 * call order, while tasks for different keys run concurrently. A failed task
 * does not block the next one for its key, and a key whose queue drains is
 * dropped from the map.
 */
export function createKeyedTaskQueue(): KeyedTaskQueue {
  const tasksByKey = new Map<number, Promise<void>>();
  return {
    run<T>(key: number, task: () => Promise<T>): Promise<T> {
      const previousTask = tasksByKey.get(key) ?? Promise.resolve();
      const result = previousTask.then(() => task());
      const settled = result.then(() => {}, () => {});
      tasksByKey.set(key, settled);
      void settled.then(() => {
        if (tasksByKey.get(key) === settled) {
          tasksByKey.delete(key);
        }
      });
      return result;
    },
  };
}
