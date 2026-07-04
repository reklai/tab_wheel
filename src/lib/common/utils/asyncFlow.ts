// Async coordination primitives used by both the background worker and content
// scripts: single-flight memoization, serialized write chains, keyed task
// queues for per-window gesture serialization, and promise timeouts.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type InFlightMemo = () => Promise<void>;

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

export interface WriteChain {
  enqueue(task: () => Promise<void>): Promise<void>;
}

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

export interface KeyedTaskQueue {
  run<T>(key: number, task: () => Promise<T>): Promise<T>;
}

export interface DebouncedFunction<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

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
