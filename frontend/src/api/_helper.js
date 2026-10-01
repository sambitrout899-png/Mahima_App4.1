/**
 * _helper.js - normalized API helper.
 * Exports `call` and `cleanPayload` for compatibility with older modules.
 */

function getApiBase() {
  let base = "";

  try {
    if (typeof window !== "undefined" && window.__API_BASE__) {
      base = String(window.__API_BASE__).trim();
    }
  } catch {}

  try {
    if (!base) {
      base =
        import.meta.env.VITE_API_BASE ||
        import.meta.env.VITE_API_BASE_URL ||
        "";
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

  return (base || "/api").toString().replace(/\/+$/g, "");
}

function buildUrl(pathOrUrl) {
  if (!pathOrUrl) return getApiBase();
  let p = pathOrUrl.toString();
  if (/^https?:\/\//i.test(p)) return p;
  p = p.replace(/^\/+/, "");
  const base = getApiBase();
  if (/\/?api$/i.test(base) && /^api\//i.test(p)) {
    p = p.replace(/^api\//i, "");
  }
  return `${base.replace(/\/+$/g, "")}/${p.replace(/^\/+/, "")}`;
}

function normalizeToken(token) {
  if (!token || typeof token !== "string") return "";
  const raw = token.trim();
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
}

function readJsonToken(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.token || parsed?.accessToken || parsed?.jwt || parsed?.data?.token || "";
  } catch {
    return "";
  }
}

function getToken() {
  try {
    return normalizeToken(
      localStorage.getItem("mahima_token") ||
        localStorage.getItem("authToken") ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("token") ||
        readJsonToken("mahima:user") ||
        readJsonToken("mahima_user") ||
        readJsonToken("user") ||
        readJsonToken("me") ||
        ""
    );
  } catch {
    return "";
  }
}

function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function cleanPayload(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  const result = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !(v instanceof FormData)) {
      const cleaned = cleanPayload(v);
      if (cleaned === null) continue;
      if (
        typeof cleaned === "object" &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned).length === 0
      ) {
        continue;
      }
      result[k] = cleaned;
    } else {
      result[k] = v;
    }
  }
  return result;
}

export async function call(pathOrUrl, opts = {}) {
  const url = buildUrl(pathOrUrl);
  const fetchOpts = {
    credentials: "same-origin",
    cache: "no-store",
    ...opts,
  };

  const headers = {
    Accept: "application/json",
    ...authHeader(),
    ...(fetchOpts.headers || {}),
  };

  if (fetchOpts.body && typeof fetchOpts.body === "object" && !(fetchOpts.body instanceof FormData)) {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    fetchOpts.body = JSON.stringify(cleanPayload(fetchOpts.body));
  }

  fetchOpts.headers = headers;

  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.response = body;
    throw err;
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}
