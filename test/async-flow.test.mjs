import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadAsyncFlowModule() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/common/utils/asyncFlow.ts"),
    "utf8",
  );

  const transformed = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });

  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function createDeferred() {
  let resolveDeferred = () => {};
  let rejectDeferred = () => {};
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

test("in-flight memo shares a single pending load across concurrent callers", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  let taskRuns = 0;
  const gate = createDeferred();
  const ensureLoaded = asyncFlow.createInFlightMemo(async () => {
    taskRuns += 1;
    await gate.promise;
  });

  const firstCall = ensureLoaded();
  const secondCall = ensureLoaded();
  gate.resolve();
  await Promise.all([firstCall, secondCall]);
  await ensureLoaded();

  assert.equal(taskRuns, 1);
});

test("in-flight memo retries after a failed load", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  let taskRuns = 0;
  const ensureLoaded = asyncFlow.createInFlightMemo(async () => {
    taskRuns += 1;
    if (taskRuns === 1) throw new Error("storage unavailable");
  });

  await assert.rejects(ensureLoaded(), /storage unavailable/);
  await ensureLoaded();
  await ensureLoaded();

  assert.equal(taskRuns, 2);
});

test("write chain serializes writes in enqueue order", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  const chain = asyncFlow.createWriteChain();
  const order = [];
  const firstGate = createDeferred();

  const firstWrite = chain.enqueue(async () => {
    await firstGate.promise;
    order.push("first");
  });
  const secondWrite = chain.enqueue(async () => {
    order.push("second");
  });

  firstGate.resolve();
  await Promise.all([firstWrite, secondWrite]);

  assert.deepEqual(order, ["first", "second"]);
});

test("write chain isolates a failed write from later writes", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  const chain = asyncFlow.createWriteChain();
  const order = [];

  const failingWrite = chain.enqueue(async () => {
    throw new Error("write failed");
  });
  const followupWrite = chain.enqueue(async () => {
    order.push("followup");
  });

  await assert.rejects(failingWrite, /write failed/);
  await followupWrite;

  assert.deepEqual(order, ["followup"]);
});

test("keyed task queue serializes tasks per key", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  const queue = asyncFlow.createKeyedTaskQueue();
  const order = [];
  const firstGate = createDeferred();

  const firstTask = queue.run(1, async () => {
    await firstGate.promise;
    order.push("first");
    return "first";
  });
  const secondTask = queue.run(1, async () => {
    order.push("second");
    return "second";
  });

  firstGate.resolve();
  const results = await Promise.all([firstTask, secondTask]);

  assert.deepEqual(order, ["first", "second"]);
  assert.deepEqual(results, ["first", "second"]);
});

test("keyed task queue runs different keys concurrently", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  const queue = asyncFlow.createKeyedTaskQueue();
  const order = [];
  const firstGate = createDeferred();

  const blockedTask = queue.run(1, async () => {
    await firstGate.promise;
    order.push("window one");
  });
  const independentTask = queue.run(2, async () => {
    order.push("window two");
  });

  await independentTask;
  firstGate.resolve();
  await blockedTask;

  assert.deepEqual(order, ["window two", "window one"]);
});

test("keyed task queue continues after a failed task", async () => {
  const asyncFlow = await loadAsyncFlowModule();
  const queue = asyncFlow.createKeyedTaskQueue();

  const failingTask = queue.run(1, async () => {
    throw new Error("task failed");
  });
  const followupTask = queue.run(1, async () => "recovered");

  await assert.rejects(failingTask, /task failed/);
  assert.equal(await followupTask, "recovered");
});
