import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();
const readText = (path) => readFileSync(resolve(ROOT, path), "utf8");

async function loadNotice() {
  const transformed = await transform(readText("src/lib/common/utils/notice.ts"), {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

// One notice, three surfaces. The page notice, the popup toast, and the
// settings status share the same pill: capsule, translucent dark glass with a
// backdrop blur, hairline inset, bottom-centre, reading-time display, and a
// short rise-and-settle that reduced motion turns off.
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PILL = {
  background: "rgba(28, 28, 30, 0.72)",
  blur: "blur(24px) saturate(160%)",
  shadow: "0 8px 24px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.12)",
  color: "rgba(255, 255, 255, 0.92)",
  font: "500 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, \"Segoe UI\", sans-serif",
};

test("notice display time scales with reading length inside fixed bounds", async () => {
  const notice = await loadNotice();

  assert.equal(notice.noticeDisplayMs("Settings saved"), 1200 + 14 * 30);
  assert.equal(notice.noticeDisplayMs(""), 1200);
  assert.equal(notice.noticeDisplayMs("x".repeat(400)), 4000);
  assert.equal(notice.NOTICE_ENTER_MS, 180);
  assert.equal(notice.NOTICE_EXIT_MS, 140);
});

test("all three surfaces use the shared notice timing instead of fixed timers", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const popup = readText("src/entryPoints/toolbarPopup/toolbarPopup.ts");
  const options = readText("src/entryPoints/optionsPage/optionsPage.ts");

  for (const [name, source] of [["appInit", app], ["popup", popup], ["options", options]]) {
    assert.match(source, /from "[./]*(?:lib\/)?common\/utils\/notice"/, `${name} imports the shared notice module`);
    assert.match(source, /noticeDisplayMs\(message\)/, `${name} uses noticeDisplayMs`);
    assert.doesNotMatch(source, /setTimeout\([^)]*,\s*(1500|1800|2200)\)/, `${name} has no fixed toast timer`);
  }
});

test("popup toast and settings status are the same bottom-centre pill", () => {
  const popupCss = readText("src/entryPoints/toolbarPopup/toolbarPopup.css");
  const optionsCss = readText("src/entryPoints/optionsPage/optionsPage.css");
  const popupToast = popupCss.slice(popupCss.indexOf(".toast {"), popupCss.indexOf(".toast.visible"));
  const optionsBar = optionsCss.slice(optionsCss.indexOf(".status-bar {"), optionsCss.indexOf(".status-bar.visible"));

  for (const [name, rule] of [["popup .toast", popupToast], ["options .status-bar", optionsBar]]) {
    assert.match(rule, /left: 50%;/, name);
    assert.match(rule, /bottom: \d+px;/, name);
    assert.match(rule, /border-radius: 999px;/, name);
    assert.match(rule, /width: max-content;/, name);
    assert.match(rule, /max-width: min\(440px, calc\(100% - 32px\)\);/, name);
    assert.match(rule, new RegExp(`background: ${esc(PILL.background)};`), name);
    assert.match(rule, new RegExp(`backdrop-filter: ${esc(PILL.blur)};`), name);
    assert.match(rule, new RegExp(`box-shadow: ${esc(PILL.shadow)};`), name);
    assert.match(rule, new RegExp(`color: ${esc(PILL.color)};`), name);
    assert.match(rule, new RegExp(`font: ${esc(PILL.font)};`), name);
    assert.match(rule, /transform: translate\(-50%, 6px\) scale\(0\.96\);/, name);
    assert.match(rule, /transition: opacity 180ms [^;]+, transform 180ms [^;]+;/, name);
    assert.doesNotMatch(rule, /border: 1px solid/, `${name} uses the inset hairline, not a border`);
  }
  assert.match(popupCss, /\.toast\.visible \{ opacity: 1; transform: translate\(-50%, 0\) scale\(1\); \}/);
  assert.match(optionsCss, /\.status-bar\.visible \{ opacity: 1; transform: translate\(-50%, 0\) scale\(1\); \}/);
  assert.match(popupCss, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.toast \{ transition: none; \}/);
  assert.match(optionsCss, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.status-bar \{ transition: none; \}/);
});

test("the page notice is the same pill drawn inline", () => {
  const app = readText("src/lib/appInit/appInit.ts");
  const notice = app.slice(app.indexOf("function showStatus("), app.indexOf("function sendScrollSnapshot("));

  assert.match(notice, /"bottom:24px"/);
  assert.match(notice, /"border-radius:999px"/);
  assert.match(notice, /"width:max-content"/);
  assert.match(notice, /"max-width:min\(440px,calc\(100vw - 32px\)\)"/);
  assert.match(notice, new RegExp(`"background:${esc(PILL.background)}"`));
  assert.match(notice, new RegExp(`"backdrop-filter:${esc(PILL.blur)}"`));
  assert.match(notice, new RegExp(`"box-shadow:${esc(PILL.shadow)}"`));
  assert.match(notice, new RegExp(`"color:${esc(PILL.color)}"`));
  assert.match(notice, new RegExp(`"font:${esc(PILL.font).replace(/"/g, '\\\\"')}"`));
  assert.match(notice, /translate\(-50%,6px\) scale\(0\.96\)/);
  assert.match(notice, /NOTICE_ENTER_MS/);
  assert.match(notice, /NOTICE_EXIT_MS/);
  assert.match(notice, /prefersReducedMotion\(\)/);
});
