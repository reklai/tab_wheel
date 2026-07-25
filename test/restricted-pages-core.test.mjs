import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/core/tabWheel/restrictedPagesCore.ts"),
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

test("normalizePageUrl only accepts http/https URLs", async () => {
  const { normalizePageUrl } = await loadCore();

  assert.equal(normalizePageUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(normalizePageUrl("http://example.com/"), "http://example.com/");
  assert.equal(normalizePageUrl("chrome://extensions"), null);
  assert.equal(normalizePageUrl("about:blank"), null);
  assert.equal(normalizePageUrl(undefined), null);
  assert.equal(normalizePageUrl("not a url"), null);
});

test("normalizeHostname lowercases and strips a leading www.", async () => {
  const { normalizeHostname } = await loadCore();

  assert.equal(normalizeHostname("WWW.Example.COM"), "example.com");
  assert.equal(normalizeHostname("example.com"), "example.com");
  assert.equal(normalizeHostname("Sub.Example.com"), "sub.example.com");
});

test("isKnownBrowserStoreRestrictedUrl flags addon and web store hosts only", async () => {
  const { isKnownBrowserStoreRestrictedUrl } = await loadCore();

  assert.equal(isKnownBrowserStoreRestrictedUrl("https://addons.mozilla.org/en-US/firefox/"), true);
  assert.equal(isKnownBrowserStoreRestrictedUrl("https://chromewebstore.google.com/detail/abc"), true);
  assert.equal(isKnownBrowserStoreRestrictedUrl("https://chrome.google.com/webstore/detail/abc"), true);
  assert.equal(isKnownBrowserStoreRestrictedUrl("https://chrome.google.com/other-path"), false);
  assert.equal(isKnownBrowserStoreRestrictedUrl("https://example.com"), false);
  assert.equal(isKnownBrowserStoreRestrictedUrl(undefined), false);
  assert.equal(isKnownBrowserStoreRestrictedUrl("chrome://extensions"), false);
});

test("isPageGestureRestrictedUrl blocks internal pages, store pages, and bad input", async () => {
  const { isPageGestureRestrictedUrl } = await loadCore();

  assert.equal(isPageGestureRestrictedUrl("chrome://extensions"), true);
  assert.equal(isPageGestureRestrictedUrl("about:blank"), true);
  assert.equal(isPageGestureRestrictedUrl("https://addons.mozilla.org/en-US/firefox/"), true);
  assert.equal(isPageGestureRestrictedUrl("https://chromewebstore.google.com/detail/abc"), true);
  assert.equal(isPageGestureRestrictedUrl("https://chrome.google.com/webstore/detail/abc"), true);
  assert.equal(isPageGestureRestrictedUrl(undefined), true);
  assert.equal(isPageGestureRestrictedUrl("not a url"), true);
  assert.equal(isPageGestureRestrictedUrl("https://example.com/page"), false);
});

test("resolveToolbarBadge only shows the exclamation badge when enabled and restricted", async () => {
  const { resolveToolbarBadge } = await loadCore();

  assert.deepEqual(resolveToolbarBadge("chrome://extensions", true), { text: "!" });
  assert.deepEqual(resolveToolbarBadge("https://addons.mozilla.org/en-US/firefox/", true), { text: "!" });
  assert.equal(resolveToolbarBadge("https://example.com/page", true), null);
  assert.equal(resolveToolbarBadge("chrome://extensions", false), null);
  assert.equal(resolveToolbarBadge(undefined, false), null);
  assert.deepEqual(resolveToolbarBadge(undefined, true), { text: "!" });
});
