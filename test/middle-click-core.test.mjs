import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/core/tabWheel/middleClickCore.ts"),
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

test("only middle-button press and auxclick events can start a session", async () => {
  const core = await loadCore();

  assert.equal(core.isMiddleClickSessionStartEvent({ type: "pointerdown", button: 1 }), true);
  assert.equal(core.isMiddleClickSessionStartEvent({ type: "mousedown", button: 1 }), true);
  assert.equal(core.isMiddleClickSessionStartEvent({ type: "auxclick", button: 1 }), true);
  assert.equal(core.isMiddleClickSessionStartEvent({ type: "pointerup", button: 1 }), false);
  assert.equal(core.isMiddleClickSessionStartEvent({ type: "pointerdown", button: 0 }), false);
  assert.equal(core.isMiddleClickSessionStartEvent({ type: "pointerdown", button: 2 }), false);
});

test("a session runs once on completed middle click", async () => {
  const core = await loadCore();
  const session = core.createMiddleClickSession(100);

  assert.equal(core.shouldRunMiddleClickSession(session, { type: "mousedown", button: 1 }), false);
  assert.equal(core.shouldRunMiddleClickSession(session, { type: "auxclick", button: 1 }), true);
  session.hasRun = true;
  assert.equal(core.shouldRunMiddleClickSession(session, { type: "auxclick", button: 1 }), false);
  assert.equal(core.shouldFinishMiddleClickSession({ type: "auxclick", button: 1 }), true);
});

test("middle-click claims expire without affecting later native clicks", async () => {
  const core = await loadCore();
  const session = core.createMiddleClickSession(100);

  assert.equal(core.isMiddleClickSessionExpired(session, 1000), false);
  assert.equal(core.isMiddleClickSessionExpired(session, 1001), true);
  assert.equal(core.isMiddleClickSessionExpired(session, 200, 50), true);
});
