// src/api.js

import { apiFetchJson } from "./utils/fetch-auth-shim";

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

  // final fallback
  if (!base) base = "/api";

  // normalize (remove trailing slash)
  return base.toString().trim().replace(/\/+$/, "");
}

export const API_BASE = buildApiBase();

console.log("🔥 FINAL API BASE:", API_BASE);

/* ---------------- API WRAPPER ---------------- */

const api = {
  get: (url, options = {}) => {
  let finalUrl = url;

  // ? append query params manually
  if (options.params) {
    const query = new URLSearchParams(options.params).toString();
    finalUrl += `?${query}`;
  }

  return apiFetchJson(finalUrl, {
    method: "GET",
  });
},

  post: (url, data, options = {}) => {
  let finalUrl = url;

  if (options.params) {
    const query = new URLSearchParams(options.params).toString();
    finalUrl += `?${query}`;
  }

  return apiFetchJson(finalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : null,
  });
},
  put: (url, data) =>
    apiFetchJson(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  delete: (url) =>
    apiFetchJson(url, {
      method: "DELETE",
    }),
};

export default api;

/* ---------------- TOKEN HELPER ---------------- */

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem("mahima_token", token);
    } else {
      localStorage.removeItem("mahima_token");
    }
  } catch (e) {
    console.warn("Token storage failed:", e);
  }
}
