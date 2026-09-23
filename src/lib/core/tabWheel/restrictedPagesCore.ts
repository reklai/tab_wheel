// Which pages TabWheel cannot run on. Content scripts only reach http(s)
// pages, and Chrome blocks extensions on the Chrome Web Store even there, so
// those pages get no gestures or scroll memory, are skipped when cycling, and
// can show a "!" toolbar badge.
//
// Pure URL checks, browser-free so they run under node:test. Shared by the
// background domain (gesture eligibility, content-script injection) and the
// toolbar badge decision.

/**
 * The canonical href of an http(s) URL, or null for anything else (chrome://,
 * file:, extension pages, unparseable). Also the key scroll memory and
 * content-script readiness are stored under.
 */
export function normalizePageUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch (_) {
    return null;
  }
}

const KNOWN_BROWSER_STORE_RESTRICTED_HOSTS = new Set([
  "chromewebstore.google.com",
]);

/** Lowercases a hostname and drops a leading "www.". */
export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * True for Chrome Web Store pages, where Chrome refuses to run extension
 * content scripts: the current store host, and the legacy
 * chrome.google.com/webstore path.
 */
export function isKnownBrowserStoreRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = normalizeHostname(parsed.hostname);
    if (KNOWN_BROWSER_STORE_RESTRICTED_HOSTS.has(hostname)) return true;
    return hostname === "chrome.google.com" && parsed.pathname.toLowerCase().startsWith("/webstore");
  } catch (_) {
    return false;
  }
}

/** True when TabWheel cannot run on `url`: not http(s), or a store page. */
export function isPageGestureRestrictedUrl(url: string | undefined): boolean {
  return !normalizePageUrl(url) || isKnownBrowserStoreRestrictedUrl(url);
}

/**
 * The toolbar badge for the active page: "!" when the page is restricted and
 * `showBadge` is set, else null (no badge). Only the decision lives here;
 * toolbarBadge.ts reads the setting and applies the badge.
 */
export function resolveToolbarBadge(
  pageUrl: string | undefined,
  showBadge: boolean,
): { text: string } | null {
  if (!showBadge) return null;
  return isPageGestureRestrictedUrl(pageUrl) ? { text: "!" } : null;
}
