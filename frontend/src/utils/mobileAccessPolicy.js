export const MOBILE_ALLOWED_PAGE_KEYS = new Set([
  "DASHBOARD",
  "SUBSCRIPTIONS",
  "CHAT",
  "PASTOR",
  "README",
  "APP_DOWNLOADS",
  "BIBLE",
  "SERMONS",
  "PRAYER_REQUESTS",
  "TASKS",
  "ATTENDANCE",
  "MARRIAGE",
  "BAPTISM",
  "COUNSELLING",
  "USER_MANUAL",
  "EVENTS",
  "VOLUNTEERS",
  "SECURITY",
  "CHECKIN",
  "SERVICE_PLANS",
]);

export function isMobileAppMode() {
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

export function isPageAvailableInMobile(pageKey) {
  if (!isMobileAppMode()) return true;
  return MOBILE_ALLOWED_PAGE_KEYS.has(String(pageKey || "").trim().toUpperCase());
}

export function mobileClientHeaders() {
  return isMobileAppMode() ? { "X-Mahima-Client": "mobile" } : {};
}
