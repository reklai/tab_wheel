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
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    releasePointerCapture() {}
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
      this.pointerId = opts.pointerId ?? 1;
      this.clientX = opts.clientX ?? 0;
      this.clientY = opts.clientY ?? 0;
      this.movementX = opts.movementX ?? 0;
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

  const clock = { now: 1_000_000 };
  const realDateNow = Date.now;
  Date.now = () => clock.now;

  const windowMock = {
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    top: null,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args),
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
    Date.now = realDateNow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }

  return { dispatch, dispatchDocument, restore, MockEditable, listeners, clock };
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

  const IGNORED = new Set(["TABWHEEL_CONTENT_READY", "TABWHEEL_PING"]);
  function drainMessages() {
    const kept = sentMessages.filter((message) => !IGNORED.has(message.type));
    sentMessages.length = 0;
    return kept;
  }
  function drainActions() {
    return drainMessages().map((message) => message.type);
  }
  drainMessages(); // discard the content-ready ping from init

  const bump = (ms) => { dom.clock.now += ms; };

  // One modifier + wheel notch. Returns whether the page event was suppressed
  // and the cycle directions that fired (drained since the previous call).
  async function wheel({ deltaY = 0, deltaX = 0, deltaMode = 1, alt = true, ctrl = false, meta = false, shift = false, advanceMs = 0 } = {}) {
    if (advanceMs) bump(advanceMs);
    const event = dom.dispatch("wheel", { deltaY, deltaX, deltaMode, alt, ctrl, meta, shift });
    await flushAsyncWork();
    const cycles = drainMessages()
      .filter((message) => message.type === "TABWHEEL_CYCLE")
      .map((message) => message.direction);
    return { suppressed: event.defaultPrevented, cycles };
  }

  // Count the notches a preset needs to fire its first cycle: feed equal notches
  // until a cycle fires or the ceiling is hit.
  async function notchesToFirstCycle(perNotch, { max = 30 } = {}) {
    for (let count = 1; count <= max; count += 1) {
      const { cycles } = await wheel(perNotch);
      if (cycles.length > 0) return { notches: count, direction: cycles[0] };
    }
    return { notches: Infinity, direction: null };
  }

  const BUTTONS_BITMASK = { 0: 1, 1: 4, 2: 2 };
  // Drive a full tab-drag: press, move past `slots` boundaries, release.
  async function drag(button, { slots = 1, pxPerSlot = 56 } = {}) {
    const target = new dom.MockEditable("div"); // any Element carries pointer capture
    const held = BUTTONS_BITMASK[button];
    const suppressed = [];
    const down = dom.dispatch("pointerdown", { button, alt: true, buttons: held, clientX: 0, target, pointerId: 7 });
    if (!down.defaultPrevented) suppressed.push("pointerdown-leaked");
    await flushAsyncWork();
    for (let slot = 1; slot <= slots; slot += 1) {
      const move = dom.dispatch("pointermove", { button, buttons: held, clientX: slot * pxPerSlot, target, pointerId: 7 });
      if (!move.defaultPrevented) suppressed.push(`pointermove-${slot}-leaked`);
      await flushAsyncWork();
    }
    dom.dispatch("pointerup", { button, buttons: 0, clientX: slots * pxPerSlot, target, pointerId: 7 });
    const terminal = button === 0 ? "click" : button === 1 ? "auxclick" : "contextmenu";
    dom.dispatch(terminal, { button, buttons: 0, target, pointerId: 7 });
    await flushAsyncWork();
    bump(1000); // let the finish timer path settle deterministically
    await flushAsyncWork();
    return { actions: drainActions(), leaked: suppressed };
  }

  // Replay a full button interaction and report what the page would have seen.
  async function performClick(button, { alt = true, ctrl = false, meta = false, shift = false, double = false, contextOn = "press", target = null } = {}) {
    const events = browserEventSequence(button, { double, contextOn });
    const leaked = [];
    for (const { type } of events) {
      const event = dom.dispatch(type, { button: buttonForType(type, button), alt, ctrl, meta, shift, target });
      if (!event.defaultPrevented) leaked.push(type);
    }
    await flushAsyncWork();
    return { actions: drainActions(), leaked };
  }

  return {
    dispatch: dom.dispatch,
    dispatchDocument: dom.dispatchDocument,
    wheel,
    notchesToFirstCycle,
    drag,
    advance: bump,
    drainActions,
    drainMessages,
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
