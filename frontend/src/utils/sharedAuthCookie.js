// Shares the auth token across sibling subdomains (app./www./beta./bare domain) via a
// cookie scoped to the registrable parent domain, since localStorage never crosses origins.
// The JWT itself (read from localStorage everywhere else) remains the source of truth --
// this cookie only exists to seed localStorage the first time a given origin is visited.

const COOKIE_NAME = "mahima_shared_token";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches the 30-day JWT lifetime

// A handful of common compound public-suffix TLDs where "last two labels" isn't the
// registrable domain. Anything not listed falls back to the last-two-labels heuristic,
// which is correct for mahimaministries.in and the vast majority of real domains.
const COMPOUND_SUFFIXES = new Set(["co.in", "co.uk", "com.au", "org.in", "net.in"]);

function parentDomain() {
  try {
    const host = window.location.hostname;
    if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";

    const labels = host.split(".");
    if (labels.length < 2) return ""; // single-label host, nothing to scope a Domain attribute to

    const lastTwo = labels.slice(-2).join(".");
    if (labels.length < 3) return lastTwo; // already the bare registrable domain (e.g. mahimaministries.in)

    const lastThree = labels.slice(-3).join(".");
    return COMPOUND_SUFFIXES.has(lastTwo) ? lastThree : lastTwo;
  } catch {
    return "";
  }
}

export function writeSharedAuthToken(token) {
  try {
    if (!token) return;
    const domain = parentDomain();
    const domainAttr = domain ? `; Domain=.${domain}` : "";
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax; Secure${domainAttr}`;
  } catch {}
}

export function readSharedAuthToken() {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

export function clearSharedAuthToken() {
  try {
    const domain = parentDomain();
    const domainAttr = domain ? `; Domain=.${domain}` : "";
    document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; Secure${domainAttr}`;
    // Also clear a same-origin copy in case it was ever set without the Domain attribute.
    document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  } catch {}
}
