import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

// Every failure string a user can see is written in the user's voice: what
// did not happen and, where there is something to do, what to do. Developer
// vocabulary must never leak into the page notice or the popup toast.
const FORBIDDEN = /\b(session|internal|unavailable|failed|sender|invalid|error|null|undefined)\b/i;

function collectUserStrings() {
  const sources = [
    "src/lib/backgroundRuntime/domains/tabWheelDomain.ts",
    "src/lib/backgroundRuntime/handlers/tabWheelMessageHandler.ts",
    "src/lib/backgroundRuntime/handlers/runtimeRouter.ts",
    "src/lib/appInit/appInit.ts",
    "src/entryPoints/toolbarPopup/toolbarPopup.ts",
    "src/entryPoints/optionsPage/optionsPage.ts",
  ];
  const strings = [];
  for (const path of sources) {
    const text = readText(path);
    for (const match of text.matchAll(/reason:\s*"([^"]+)"/g)) strings.push({ path, text: match[1] });
    for (const match of text.matchAll(/reason:\s*`([^`]+)`/g)) strings.push({ path, text: match[1] });
    for (const line of text.split("\n")) {
      if (!/showStatus\(|showToast\(|showStatusBar\(|STATUS\s*=/.test(line)) continue;
      for (const match of line.matchAll(/"([^"]+)"/g)) strings.push({ path, text: match[1] });
    }
  }
  return strings;
}

test("user-visible failure strings never use developer vocabulary", () => {
  const strings = collectUserStrings();
  assert.ok(strings.length >= 20, `expected to collect the failure strings, got ${strings.length}`);
  for (const { path, text } of strings) {
    assert.doesNotMatch(text, FORBIDDEN, `${path}: "${text}"`);
    assert.match(text, /^[A-Z]/, `${path}: "${text}" should start with a capital letter`);
    assert.ok(text.length <= 90, `${path}: "${text}" is too long for a one-line notice`);
  }
});

test("a background that cannot be reached gets one consistent, actionable notice", () => {
  const app = readText("src/lib/appInit/appInit.ts");

  assert.match(
    app,
    /const ACTION_UNREACHABLE_STATUS =\s*"TabWheel couldn't reach the browser\. Use Refresh extension in the popup\.";/,
  );
  // Every one-shot action reports the same thing when the message itself fails;
  // per-action failures come back as reasons from the background instead.
  assert.doesNotMatch(app, /runActionWithStatus\([A-Za-z]+,\s*"/);
  assert.match(app, /async function runActionWithStatus\(\s*task: \(\) => Promise<TabWheelActionResult>,?\s*\)/);
});

test("the page notice is a bottom snackbar, not a centred box, and respects reduced motion", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const notice = app.slice(app.indexOf("function showStatus("), app.indexOf("function sendScrollSnapshot("));

  assert.ok(notice.length > 0, "showStatus should precede sendScrollSnapshot");
  assert.match(notice, /"bottom:24px"/);
  assert.match(notice, /"transform:translateX\(-50%\)"/);
  assert.match(notice, /"border-radius:999px"/);
  assert.doesNotMatch(notice, /top:50%|translate\(-50%,-50%\)/);
  assert.match(notice, /prefers-reduced-motion: reduce/);
  assert.match(notice, /setAttribute\("role", "status"\)/);
  // Display time scales with reading length instead of one fixed number.
  assert.match(notice, /statusDisplayMs\(message\)/);
});
