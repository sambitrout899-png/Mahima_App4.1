// src/api.js

import { apiFetchBlob, apiFetchJson } from "./utils/fetch-auth-shim";
import { activePositionHeaderValue } from "./utils/positionContext";
import { mobileClientHeaders } from "./utils/mobileAccessPolicy";
import { defaultActionMessage, notifyError, notifySuccess } from "./utils/notifications";
import { writeSharedAuthToken, clearSharedAuthToken } from "./utils/sharedAuthCookie";

/* ---------------- API BASE ---------------- */
function buildApiBase() {
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

  if (!base) base = "/api";
  return base.toString().trim().replace(/\/+$/, "");
}

export const API_BASE = buildApiBase();

console.log("FINAL API BASE:", API_BASE);

/* ---------------- API WRAPPER ---------------- */
const defaults = {
  headers: {
    common: {},
  },
};

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

function appendParams(url, params) {
  if (!params) return url;

  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          query.append(key, item);
        }
      });
    } else {
      query.set(key, value);
    }
  });

  const qs = query.toString();
  if (!qs) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${qs}`;
}

function headersWithDefaults(headers) {
  return {
    ...(defaults.headers.common || {}),
    ...mobileClientHeaders(),
    ...(headers || {}),
  };
}

function bodyFor(data, headers) {
  if (data === undefined) return undefined;
  if (data === null) return null;
  if (typeof FormData !== "undefined" && data instanceof FormData) return data;
  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return typeof data === "string" ? data : JSON.stringify(data);
}

async function request(method, url, data, options = {}) {
  const { params, headers: optionHeaders, responseType, notify: shouldNotify = true, successMessage, ...rest } = options || {};
  const headers = headersWithDefaults(optionHeaders);
  const tenantSlug = activeTenantSlug();
  if (tenantSlug && !headers["X-Tenant-Slug"] && !headers["X-Tenant-Id"]) headers["X-Tenant-Slug"] = tenantSlug;
  const activePositionId = activePositionHeaderValue();
  if (activePositionId && !headers["X-Mahima-Position-Id"]) headers["X-Mahima-Position-Id"] = activePositionId;
  const init = {
    ...rest,
    method,
    headers,
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = bodyFor(data, headers);
  }

  const finalUrl = appendParams(url, params);
  if (String(responseType || "").toLowerCase() === "blob") {
    const download = await apiFetchBlob(finalUrl, init);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      data: download.blob,
      fileName: download.fileName,
      contentType: download.contentType,
    };
  }
  const response = await apiFetchJson(finalUrl, init);
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
  if (shouldNotify && isMutation) {
    if (response?.ok) notifySuccess(successMessage || defaultActionMessage(method, url));
    else notifyError(response, "The action could not be completed.");
  }
  return response;
}

const api = {
  defaults,
  get: (url, options = {}) => request("GET", url, undefined, options),
  post: (url, data, options = {}) => request("POST", url, data, options),
  put: (url, data, options = {}) => request("PUT", url, data, options),
  patch: (url, data, options = {}) => request("PATCH", url, data, options),
  delete: (url, options = {}) => request("DELETE", url, undefined, options),
};

export default api;

/* ---------------- TOKEN HELPER ---------------- */
export function setAuthToken(token) {
  try {
    if (token) {
      const cleanToken = String(token).replace(/^Bearer\s+/i, "").trim();
      localStorage.setItem("mahima_token", cleanToken);
      localStorage.setItem("authToken", cleanToken);
      localStorage.setItem("token", cleanToken);
      writeSharedAuthToken(cleanToken);
      defaults.headers.common.Authorization = `Bearer ${cleanToken}`;
    } else {
      localStorage.removeItem("mahima_token");
      localStorage.removeItem("authToken");
      localStorage.removeItem("auth_token");
      localStorage.removeItem("token");
      clearSharedAuthToken();
      delete defaults.headers.common.Authorization;
    }

    window.dispatchEvent(new CustomEvent("auth:change", { detail: { token: token || null } }));
  } catch (e) {
    console.warn("Token storage failed:", e);
  }
}

