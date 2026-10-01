// src/utils/auth.js
import { readSharedAuthToken, writeSharedAuthToken, clearSharedAuthToken } from "./sharedAuthCookie";

const TOKEN_KEY = "mahima_token";

// Normalize any token (strip accidental "Bearer " prefixes, trim whitespace)
function normalizeToken(token) {
  if (!token || typeof token !== "string") return "";
  const t = token.trim();
  return t.toLowerCase().startsWith("bearer ")
    ? t.slice(7).trim()
    : t;
}

export function setToken(token) {
  const clean = normalizeToken(token);
  if (!clean) return;
  try {
    localStorage.setItem(TOKEN_KEY, clean);
    localStorage.setItem("authToken", clean);
    localStorage.setItem("token", clean);
    writeSharedAuthToken(clean);
  } catch {
    // ignore storage errors (quota/private mode)
  }
}

export function getToken() {
  // Always read from storage at call time (no in-memory cache!)
  try {
    let t =
      localStorage.getItem(TOKEN_KEY) ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("token") ||
      "";

    if (!t) {
      for (const key of ["mahima:user", "mahima_user", "user", "me", "mahima_currentUser", "currentUser"]) {
      const userRaw = localStorage.getItem(key);
      if (userRaw) {
        const parsed = JSON.parse(userRaw);
        t = parsed?.token || parsed?.accessToken || parsed?.jwt || parsed?.data?.token || parsed?.data?.accessToken || "";
        if (t) break;
      }
      }
    }

    if (!t) {
      const shared = readSharedAuthToken();
      if (shared) {
        t = shared;
        try {
          localStorage.setItem(TOKEN_KEY, normalizeToken(shared));
          localStorage.setItem("authToken", normalizeToken(shared));
          localStorage.setItem("token", normalizeToken(shared));
        } catch {}
      }
    }

    return normalizeToken(t);
  } catch {
    return "";
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("authToken");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("token");
    localStorage.removeItem("mahima_remember_login");
    clearSharedAuthToken();
  } catch {
    // ignore
  }
}

/**
 * Handy helper: returns an Authorization header object if a token exists,
 * otherwise an empty object. Use like:
 *   fetch(url, { headers: { ...authHeader(), 'Content-Type': 'application/json' } })
 */
export function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
