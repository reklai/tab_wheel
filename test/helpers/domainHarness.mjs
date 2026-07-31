// Shared behavioral-test harness: bundles the real background domain with
// esbuild, swapping only the webextension-polyfill boundary and the sleep
// primitive for test doubles installed on globalThis.
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
let domainBundlePromise;
let domainImportSerial = 0;

export function createDeferred() {
  let resolveDeferred = () => {};
  const promise = new Promise((resolvePromise) => {
    resolveDeferred = resolvePromise;
  });
  return { promise, resolve: resolveDeferred };
}

export function createListenerEvent() {
  let listener;
  return {
    addListener(nextListener) {
      listener = nextListener;
    },
    get listener() {
      return listener;
    },
  };
}

export async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

export async function loadTabWheelDomain(browserMock, sleepMock) {
  domainBundlePromise ??= build({
    entryPoints: [resolve(ROOT, "src/lib/backgroundRuntime/domains/tabWheelDomain.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    plugins: [{
      name: "domain-browser-boundary",
      setup(builder) {
        builder.onResolve(
          { filter: /^webextension-polyfill$/ },
          () => ({ path: "browser-polyfill", namespace: "domain-test" }),
        );
        builder.onLoad(
          { filter: /^browser-polyfill$/, namespace: "domain-test" },
          () => ({
            contents: "export default globalThis.__tabWheelDomainBrowserMock;",
            loader: "js",
          }),
        );
        builder.onResolve(
          { filter: /^\.\.\/\.\.\/common\/utils\/asyncFlow$/ },
          (args) => args.importer.endsWith("tabWheelDomain.ts")
            ? { path: "async-flow", namespace: "domain-test" }
            : null,
        );
        builder.onLoad(
          { filter: /^async-flow$/, namespace: "domain-test" },
          () => ({
            contents: `
              export {
                createInFlightMemo,
                createKeyedTaskQueue,
                createWriteChain,
              } from ${JSON.stringify(resolve(ROOT, "src/lib/common/utils/asyncFlow.ts"))};
              export const sleep = (...args) => globalThis.__tabWheelDomainSleepMock(...args);
            `,
            loader: "js",
            resolveDir: ROOT,
          }),
        );
      },
    }],
  }).then((result) => result.outputFiles[0].text);

  globalThis.__tabWheelDomainBrowserMock = browserMock;
  globalThis.__tabWheelDomainSleepMock = sleepMock;
  const bundledCode = await domainBundlePromise;
  const encoded = Buffer.from(bundledCode, "utf8").toString("base64");
  domainImportSerial += 1;
  return import(`data:text/javascript;base64,${encoded}#domain-${domainImportSerial}`);
}
