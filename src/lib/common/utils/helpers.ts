// String and URL helpers with no browser or extension dependencies.

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const HTML_ESCAPE_RE = /[&<>"']/;
/**
 * Escapes the five HTML-significant characters so `text` can be placed in
 * markup. Returns `text` itself when there is nothing to escape.
 */
export function escapeHtml(text: string): string {
  if (!HTML_ESCAPE_RE.test(text)) return text;
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character]);
}

/** Escapes RegExp metacharacters so `text` matches literally. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A case-insensitive subsequence matcher for `query`: the characters of each
 * whitespace-separated term, and the terms themselves, must appear in order
 * with anything in between. Returns null for a blank query.
 */
export function buildFuzzyPattern(query: string): RegExp | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const pattern = terms
    .map((term) =>
      term
        .split("")
        .map((character) => escapeRegex(character))
        .join("[^]*?"),
    )
    .join("[^]*?");
  try {
    return new RegExp(pattern, "i");
  } catch (_) {
    return null;
  }
}

// Bounded memo for extractDomain. A Map iterates in insertion order, so the
// first key is the oldest and is evicted first.
const DOMAIN_CACHE_MAX = 500;
const domainCache = new Map<string, string>();

function cacheDomain(url: string, value: string): string {
  if (domainCache.size >= DOMAIN_CACHE_MAX) {
    const firstKey = domainCache.keys().next().value;
    if (firstKey !== undefined) domainCache.delete(firstKey);
  }
  domainCache.set(url, value);
  return value;
}

/**
 * The hostname of `url` for display. An unparseable URL shows as its first 30
 * characters plus an ellipsis.
 */
export function extractDomain(url: string): string {
  const cached = domainCache.get(url);
  if (cached) return cached;
  try {
    return cacheDomain(url, new URL(url).hostname);
  } catch (_) {
    return cacheDomain(url, url.length > 30 ? url.substring(0, 30) + "\u2026" : url);
  }
}

// Query parameters that only carry campaign or click tracking; dropping them
// never changes which page loads.
const TRACKING_QUERY_PREFIXES = ["utm_"];
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

/**
 * A comparison key for `rawUrl` that ignores what does not change the page:
 * scheme and host case, a leading "www.", default ports, repeated or trailing
 * slashes, tracking parameters, parameter order, and the fragment (sites often
 * add one after navigation).
 */
export function normalizeUrlForMatch(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);

    const isDefaultPort = (protocol === "http:" && parsed.port === "80")
      || (protocol === "https:" && parsed.port === "443");
    const port = parsed.port && !isDefaultPort ? `:${parsed.port}` : "";

    let pathname = parsed.pathname || "/";
    pathname = pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

    const kept: Array<[string, string]> = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (TRACKING_QUERY_KEYS.has(lowerKey)) continue;
      if (TRACKING_QUERY_PREFIXES.some((prefix) => lowerKey.startsWith(prefix))) continue;
      kept.push([key, value]);
    }
    kept.sort((a, b) => {
      const keyCompare = a[0].localeCompare(b[0]);
      if (keyCompare !== 0) return keyCompare;
      return a[1].localeCompare(b[1]);
    });
    const search = kept.length
      ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
      : "";

    return `${protocol}//${hostname}${port}${pathname}${search}`;
  } catch (_) {
    // Internal and non-standard URLs still need a deterministic key.
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}
