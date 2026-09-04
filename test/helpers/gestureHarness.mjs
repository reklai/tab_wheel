// Deterministic simulation of the content-script gesture pipeline. Bundles the
// real src/lib/appInit/appInit.ts, swaps only the webextension-polyfill
// boundary for a mock, installs a minimal DOM whose event classes are real
// constructors (so the handler's `instanceof PointerEvent` checks hold), runs
// initApp, and replays the exact event sequences a browser emits for each
// button. "Suppressed" means the handler called preventDefault on the event —
// the same thing that stops the page's native behaviour in Chrome.
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
let bundlePromise;
let importSerial = 0;

// The real ordered event streams a browser dispatches to the window for a
// completed button interaction. Primary and middle end on their terminal
// click; secondary (right) fires contextmenu on press (Linux/macOS) or on
// release (Windows), so both orderings are modelled.
export function browserEventSequence(button, { double = false, contextOn = "press" } = {}) {
  const down = [{ type: "pointerdown" }, { type: "mousedown" }];
  const up = [{ type: "pointerup" }, { type: "mouseup" }];
  if (button === 0) {
    const single = [...down, ...up, { type: "click" }];
    if (!double) return single;
    return [...single, ...down, ...up, { type: "click" }, { type: "dblclick" }];
  }
  if (button === 1) return [...down, ...up, { type: "auxclick" }];
  if (contextOn === "release") return [...down, ...up, { type: "contextmenu" }, { type: "auxclick" }];
  return [...down, { type: "contextmenu" }, ...up, { type: "auxclick" }];
}

const POINTER_TYPES = new Set(["pointerdown", "pointerup", "pointermove", "pointercancel"]);

function installDom() {
  class MockElement {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase();
      this.style = { cssText: "" };
      this.dataset = {};
      this.children = [];
      this.textContent = "";
    }
    setAttribute() {}
    getAttribute() { return null; }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter((c) => c !== child); }
    remove() {}
    closest() { return null; }
    matches() { return false; }
  }
  // An editable target: an Element whose closest() matches the editable
  // selector, so isEditableTarget() returns true for it.
  class MockEditable extends MockElement {
    closest() { return this; }
  }

  class MockMouseEvent {
    constructor(type, opts = {}) {
      this.type = type;
      this.button = opts.button ?? 0;
      this.buttons = opts.buttons ?? 0;
      this.altKey = !!opts.alt;
      this.ctrlKey = !!opts.ctrl;
      this.metaKey = !!opts.meta;
      this.shiftKey = !!opts.shift;
      this.isTrusted = opts.isTrusted !== false;
      this.target = opts.target ?? null;
      this.pointerType = opts.pointerType ?? "mouse";
      this.defaultPrevented = false;
      this.propagationStopped = false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
    stopImmediatePropagation() { this.propagationStopped = true; }
  }
  class MockPointerEvent extends MockMouseEvent {}
  class MockWheelEvent extends MockMouseEvent {
    constructor(type, opts = {}) {
      super(type, opts);
      this.deltaX = opts.deltaX ?? 0;
      this.deltaY = opts.deltaY ?? 0;
      this.deltaMode = opts.deltaMode ?? 0;
    }
  }

  const listeners = { window: new Map(), document: new Map() };
  function addTo(scope, type, fn) {
    if (!scope.has(type)) scope.set(type, []);
    scope.get(type).push(fn);
  }
  function removeFrom(scope, type, fn) {
    if (!scope.has(type)) return;
    scope.set(type, scope.get(type).filter((f) => f !== fn));
  }

  const documentEl = new MockElement("html");
  const bodyEl = new MockElement("body");
  const statusStore = new Map();
  const documentMock = {
    documentElement: documentEl,
    body: bodyEl,
    visibilityState: "visible",
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => statusStore.get(id) ?? null,
    addEventListener: (type, fn) => addTo(listeners.document, type, fn),
    removeEventListener: (type, fn) => removeFrom(listeners.document, type, fn),
  };
  // documentElement.appendChild registers status nodes for getElementById.
  documentEl.appendChild = (child) => {
    documentEl.children.push(child);
    if (child.id) statusStore.set(child.id, child);
    child.remove = () => statusStore.delete(child.id);
    return child;
  };

  const windowMock = {
    innerWidth: 1280,
    scrollX: 0,
    scrollY: 0,
    top: null,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    scrollTo: () => {},
    addEventListener: (type, fn) => addTo(listeners.window, type, fn),
    removeEventListener: (type, fn) => removeFrom(listeners.window, type, fn),
  };
  windowMock.top = windowMock;

  const previous = {};
  const define = (key, value) => {
    previous[key] = globalThis[key];
    globalThis[key] = value;
  };
  define("window", windowMock);
  define("document", documentMock);
  define("Element", MockElement);
  define("MouseEvent", MockMouseEvent);
  define("PointerEvent", MockPointerEvent);
  define("WheelEvent", MockWheelEvent);

  function makeEvent(type, opts) {
    if (type === "wheel") return new MockWheelEvent(type, opts);
    if (POINTER_TYPES.has(type)) return new MockPointerEvent(type, opts);
    return new MockMouseEvent(type, opts);
  }

  function dispatch(type, opts = {}) {
    const event = makeEvent(type, opts);
    const fns = listeners.window.get(type) ?? [];
    for (const fn of fns.slice()) fn(event);
    return event;
  }
  function dispatchDocument(type, opts = {}) {
    const event = makeEvent(type, opts);
    const fns = listeners.document.get(type) ?? [];
    for (const fn of fns.slice()) fn(event);
    return event;
  }

  function restore() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }

  return { dispatch, dispatchDocument, restore, MockEditable, listeners };
}

async function loadBundle() {
  bundlePromise ??= build({
    entryPoints: [resolve(ROOT, "src/lib/appInit/appInit.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    plugins: [{
      name: "appinit-browser-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^webextension-polyfill$/ }, () => ({
          path: "browser-polyfill",
          namespace: "gesture-test",
        }));
        builder.onLoad({ filter: /^browser-polyfill$/, namespace: "gesture-test" }, () => ({
          contents: "export default globalThis.__tabWheelGestureBrowserMock;",
          loader: "js",
        }));
      },
    }],
  }).then((result) => result.outputFiles[0].text);
  return bundlePromise;
}

export async function flushAsyncWork() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

// settings is a partial TabWheelSettings; loadTabWheelSettings normalizes it.
export async function createGestureWorld(settings = {}) {
  const sentMessages = [];
  globalThis.__tabWheelGestureBrowserMock = {
    runtime: {
      sendMessage: async (message) => {
        sentMessages.push(message);
        return { ok: true };
      },
      onMessage: { addListener() {}, removeListener() {} },
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: settings }),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  };

  const dom = installDom();
  const code = await loadBundle();
  const encoded = Buffer.from(code, "utf8").toString("base64");
  importSerial += 1;
  const module = await import(`data:text/javascript;base64,${encoded}#gesture-${importSerial}`);
  module.initApp();
  await flushAsyncWork();

  function drainActions() {
    const types = sentMessages
      .map((message) => message.type)
      .filter((type) => type !== "TABWHEEL_CONTENT_READY" && type !== "TABWHEEL_PING");
    sentMessages.length = 0;
    return types;
  }
  drainActions(); // discard the content-ready ping from init

  // Replay a full button interaction and report what the page would have seen.
  async function performClick(button, { alt = true, double = false, contextOn = "press", target = null } = {}) {
    const events = browserEventSequence(button, { double, contextOn });
    const leaked = [];
    for (const { type } of events) {
      const event = dom.dispatch(type, { button: buttonForType(type, button), alt, target });
      if (!event.defaultPrevented) leaked.push(type);
    }
    await flushAsyncWork();
    return { actions: drainActions(), leaked };
  }

  return {
    dispatch: dom.dispatch,
    dispatchDocument: dom.dispatchDocument,
    drainActions,
    performClick,
    MockEditable: dom.MockEditable,
    cleanup: () => {
      try { globalThis.window.__tabWheelCleanup?.(); } catch (_) { /* ignore */ }
      dom.restore();
      delete globalThis.__tabWheelGestureBrowserMock;
    },
  };
}

// dblclick and click carry the primary button; every other event in a
// non-primary sequence carries that button.
function buttonForType(type, button) {
  if (type === "click" || type === "dblclick") return 0;
  return button;
}
