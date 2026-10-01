// src/utils/fetch-auth-shim.js
import { activePositionHeaderValue } from "./positionContext";
import { mobileClientHeaders } from "./mobileAccessPolicy";
import { readSharedAuthToken, writeSharedAuthToken } from "./sharedAuthCookie";

/* ---------------- API BASE ---------------- */
function resolveApiBase() {
  let base = "";

  try {
    if (import.meta?.env?.VITE_API_BASE) {
      base = import.meta.env.VITE_API_BASE;
    } else if (import.meta?.env?.VITE_API_BASE_URL) {
      base = import.meta.env.VITE_API_BASE_URL;
    }
  } catch {}

  try {
    if (!base && typeof window !== "undefined" && window.__API_BASE__) {
      base = String(window.__API_BASE__).trim();
    }
  } catch {}

  try {
    if (!base && typeof window !== "undefined") {
      const isNative =
        import.meta.env.MODE === "mobile" ||
        Boolean(window.Capacitor?.isNativePlatform?.()) ||
        window.location?.protocol === "capacitor:";

      if (isNative) {
        base =
          import.meta.env.VITE_MOBILE_API_BASE ||
          "https://beta.mahimaministries.in/api";
      }
    }
  } catch {}

  if (!base) {
    console.warn("API BASE not set. Falling back to /api");
    base = "/api";
  }

  return base.toString().trim().replace(/\/+$/, "");
}

const PUBLIC_API_BASE = "https://beta.mahimaministries.in/api";
const API_BASE = resolveApiBase();
console.log("FINAL API BASE =", API_BASE);
const TENANT_SLUG_KEY = "mahima_tenant_slug";

function activeTenantSlug() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const hash = window.location.hash || "";
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    const hashTenantMatch = hash.match(/^#\/t\/([^/?#]+)/i);
    const fromUrl = (
      params.get("tenant") ||
      params.get("tenantSlug") ||
      hashParams.get("tenant") ||
      hashParams.get("tenantSlug") ||
      (hashTenantMatch ? decodeURIComponent(hashTenantMatch[1]) : "") ||
      ""
    ).trim();
    if (fromUrl) {
      localStorage.setItem(TENANT_SLUG_KEY, fromUrl);
      localStorage.setItem("tenantSlug", fromUrl);
      return fromUrl;
    }

    const host = window.location.hostname.toLowerCase();
    const isKnownMahimaHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local") ||
      host.includes("mahimaministries.");

    if (!isKnownMahimaHost) {
      return "";
    }

    return (
      localStorage.getItem(TENANT_SLUG_KEY) ||
      localStorage.getItem("tenantSlug") ||
      localStorage.getItem("tenant_slug") ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function tenantHeaders() {
  const tenantSlug = activeTenantSlug();
  return tenantSlug ? { "X-Tenant-Slug": tenantSlug } : {};
}

/* ---------------- TOKEN ---------------- */
function readJsonToken(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return (
      parsed?.token ||
      parsed?.accessToken ||
      parsed?.jwt ||
      parsed?.bearerToken ||
      parsed?.data?.token ||
      parsed?.data?.accessToken ||
      ""
    );
  } catch {
    return "";
  }
}

function normalizeToken(token) {
  if (!token || typeof token !== "string") return "";
  const raw = token.trim();
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
}

function readToken() {
  try {
    const raw =
      localStorage.getItem("mahima_token") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("token") ||
      readJsonToken("mahima:user") ||
      readJsonToken("mahima_user") ||
      readJsonToken("user") ||
      readJsonToken("me") ||
      readJsonToken("mahima_currentUser") ||
      readJsonToken("currentUser");

    if (raw) return normalizeToken(raw);

    // Nothing in this origin's localStorage yet -- this can happen the first time a
    // sibling subdomain (app./www./beta.) is visited after logging in on another one.
    // Seed this origin's localStorage from the shared cross-subdomain cookie so every
    // other localStorage-reading call site in the app keeps working unchanged.
    const shared = normalizeToken(readSharedAuthToken());
    if (shared) {
      localStorage.setItem("mahima_token", shared);
      localStorage.setItem("authToken", shared);
      localStorage.setItem("token", shared);
      return shared;
    }

    return "";
  } catch {
    return "";
  }
}

// Re-exported so login/token-write call sites can seed the shared cookie without each
// needing to import sharedAuthCookie.js directly.
export function persistSharedAuthToken(token) {
  writeSharedAuthToken(normalizeToken(token));
}

/* ---------------- URL BUILDER ---------------- */
function isNativeAppMode() {
  try {
    return (
      import.meta.env.MODE === "mobile" ||
      Boolean(window.Capacitor?.isNativePlatform?.()) ||
      window.location?.protocol === "capacitor:" ||
      (window.location?.protocol === "https:" && window.location?.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function buildUrlWithBase(url, base) {
  if (!url) return url;
  const deduplicateApiPath = (value) =>
    String(value).replace(/\/api(?:\/api)+(?=\/|[?#]|$)/gi, "/api");
  if (/^https?:\/\//i.test(url)) return deduplicateApiPath(url);

  const normalized = deduplicateApiPath(url.startsWith("/") ? url : `/${url}`);
  const cleanBase = String(base || API_BASE).trim().replace(/\/+$/, "");
  if (normalized.toLowerCase().startsWith("/api/") && cleanBase.toLowerCase().endsWith("/api")) {
    return deduplicateApiPath(cleanBase + normalized.slice(4));
  }

  return deduplicateApiPath(cleanBase + normalized);
}

function buildUrl(url) {
  return buildUrlWithBase(url, API_BASE);
}

async function readErrorBody(res) {
  const text = await res.text().catch(() => "");
  if (!text) return "";

  try {
    const json = JSON.parse(text);
    const summary = json?.message || json?.error || json?.detail || json?.title;
    const technicalDetails = json?.details || json?.lastError;
    if (summary && technicalDetails && technicalDetails !== summary) {
      return `${summary}\n\n${technicalDetails}`;
    }
    if (json?.detail && json?.title && json.detail !== json.title) {
      return `${json.title}: ${json.detail}`;
    }
    return summary || text;
  } catch {
    return text;
  }
}

function makeHttpError(res, body) {
  const err = new Error(body || `${res.status} ${res.statusText}` || "Request failed");
  err.status = res.status;
  err.statusText = res.statusText || "ERROR";
  err.body = body || "";
  return err;
}

function readDownloadFilename(headers) {
  const disposition = headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].replace(/"/g, "").trim());
    } catch {}
  }

  const plain = disposition.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() || "";
}

async function fetchWithOptionalTimeout(urlToCall, options, timeoutMs) {
  if (!timeoutMs || options.signal) {
    return fetch(urlToCall, options);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(urlToCall, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutError = new Error(
        `Request timed out calling ${urlToCall}. Please check the server or connectivity settings.`
      );
      timeoutError.status = 408;
      timeoutError.statusText = "TIMEOUT";
      timeoutError.body = "";
      throw timeoutError;
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ---------------- MAIN FETCH ---------------- */
export async function apiFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url || "";
  const {
    skipAuth = false,
    retryPublicApi = true,
    timeoutMs = 0,
    ...fetchInit
  } = init || {};
  const finalUrl = buildUrl(url);
  const headers = new Headers(fetchInit.headers || {});
  Object.entries(mobileClientHeaders()).forEach(([key, value]) => headers.set(key, value));
  const tenantSlug = activeTenantSlug();
  if (tenantSlug && !headers.has("X-Tenant-Slug") && !headers.has("X-Tenant-Id")) {
    headers.set("X-Tenant-Slug", tenantSlug);
  }
  const token = readToken();

  if (token && !skipAuth) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const activePositionId = activePositionHeaderValue();
  if (activePositionId && !headers.has("X-Mahima-Position-Id")) {
    headers.set("X-Mahima-Position-Id", activePositionId);
  }

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!headers.has("Content-Type") && fetchInit.body && !(fetchInit.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const options = {
    credentials: "same-origin",
    cache: "no-store",
    ...fetchInit,
    headers,
  };

  console.log("API CALL:", options.method || "GET", finalUrl);

  async function fetchOnce(urlToCall) {
    return fetchWithOptionalTimeout(urlToCall, options, timeoutMs);
  }

  let res;
  try {
    res = await fetchOnce(finalUrl);
  } catch (err) {
    if (retryPublicApi && isNativeAppMode() && !finalUrl.startsWith(PUBLIC_API_BASE)) {
      const fallbackUrl = buildUrlWithBase(url, PUBLIC_API_BASE);
      try {
        console.warn("API fallback:", options.method || "GET", fallbackUrl);
        res = await fetchOnce(fallbackUrl);
      } catch (fallbackErr) {
        if (fallbackErr?.status === 408) throw fallbackErr;
        const networkError = new Error(
          `Network error calling ${fallbackUrl}. Please check internet, HTTPS, and CORS.`
        );
        networkError.status = 0;
        networkError.statusText = "NETWORK_ERROR";
        networkError.body = fallbackErr?.message || err?.message || "";
        throw networkError;
      }
    } else {
      if (err?.status === 408) throw err;
      const networkError = new Error(
        `Network error calling ${finalUrl}. Please check internet, HTTPS, and CORS.`
      );
      networkError.status = 0;
      networkError.statusText = "NETWORK_ERROR";
      networkError.body = err?.message || "";
      throw networkError;
    }
  }

  if (!res) {
    const networkError = new Error("Network error. Please check your connection.");
    networkError.status = 0;
    networkError.statusText = "NETWORK_ERROR";
    networkError.body = "";
    throw networkError;
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw makeHttpError(res, body);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return await res.text().catch(() => "");
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiFetchBlob(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url || "";
  const {
    skipAuth = false,
    retryPublicApi = true,
    timeoutMs = 0,
    ...fetchInit
  } = init || {};
  const finalUrl = buildUrl(url);
  const headers = new Headers(fetchInit.headers || {});
  Object.entries(mobileClientHeaders()).forEach(([key, value]) => headers.set(key, value));
  const token = readToken();

  if (token && !skipAuth) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const activePositionId = activePositionHeaderValue();
  if (activePositionId && !headers.has("X-Mahima-Position-Id")) {
    headers.set("X-Mahima-Position-Id", activePositionId);
  }

  if (!headers.has("Accept")) {
    headers.set("Accept", "*/*");
  }

  const options = {
    credentials: "same-origin",
    cache: "no-store",
    ...fetchInit,
    headers,
  };

  async function fetchOnce(urlToCall) {
    return fetchWithOptionalTimeout(urlToCall, options, timeoutMs);
  }

  let res;
  try {
    res = await fetchOnce(finalUrl);
  } catch (err) {
    if (retryPublicApi && isNativeAppMode() && !finalUrl.startsWith(PUBLIC_API_BASE)) {
      const fallbackUrl = buildUrlWithBase(url, PUBLIC_API_BASE);
      try {
        res = await fetchOnce(fallbackUrl);
      } catch (fallbackErr) {
        if (fallbackErr?.status === 408) throw fallbackErr;
        const networkError = new Error(
          `Network error calling ${fallbackUrl}. Please check internet, HTTPS, and CORS.`
        );
        networkError.status = 0;
        networkError.statusText = "NETWORK_ERROR";
        networkError.body = fallbackErr?.message || err?.message || "";
        throw networkError;
      }
    } else {
      if (err?.status === 408) throw err;
      const networkError = new Error(
        `Network error calling ${finalUrl}. Please check internet, HTTPS, and CORS.`
      );
      networkError.status = 0;
      networkError.statusText = "NETWORK_ERROR";
      networkError.body = err?.message || "";
      throw networkError;
    }
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw makeHttpError(res, body);
  }

  return {
    blob: await res.blob(),
    fileName: readDownloadFilename(res.headers),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

/* ---------------- JSON WRAPPER ---------------- */
export async function apiFetchJson(input, init = {}) {
  try {
    const data = await apiFetch(input, init);

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      data,
      text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
      json: () => Promise.resolve(data),
    };
  } catch (err) {
    const message = err?.body || err?.message || "";
    return {
      ok: false,
      status: err?.status || 500,
      statusText: err?.statusText || "ERROR",
      data: null,
      error: message,
      text: () => Promise.resolve(message),
      json: () => Promise.resolve(null),
    };
  }
}

/* ---------------- AUTH APIs ---------------- */
export function register(data, tenantSlug = "") {
  return apiFetchJson("/auth/register", {
    method: "POST",
    skipAuth: true,
    retryPublicApi: true,
    headers: { "Content-Type": "application/json", ...(tenantSlug ? { "X-Tenant-Slug": tenantSlug } : tenantHeaders()) },
    body: JSON.stringify(data),
  });
}

export function login(data, tenantSlug = "") {
  return apiFetchJson("/auth/login", {
    method: "POST",
    skipAuth: true,
    retryPublicApi: true,
    headers: { "Content-Type": "application/json", ...(tenantSlug ? { "X-Tenant-Slug": tenantSlug } : tenantHeaders()) },
    body: JSON.stringify(data),
  });
}

export function mfaLoginVerify(data, tenantSlug = "") {
  return apiFetchJson("/auth/mfa/login-verify", {
    method: "POST",
    skipAuth: true,
    retryPublicApi: true,
    headers: { "Content-Type": "application/json", ...(tenantSlug ? { "X-Tenant-Slug": tenantSlug } : tenantHeaders()) },
    body: JSON.stringify(data),
  });
}

export function googleLogin(data, tenantSlug = "") {
  return apiFetchJson("/auth/google", {
    method: "POST",
    skipAuth: true,
    retryPublicApi: true,
    headers: { "Content-Type": "application/json", ...(tenantSlug ? { "X-Tenant-Slug": tenantSlug } : tenantHeaders()) },
    body: JSON.stringify(data),
  });
}
