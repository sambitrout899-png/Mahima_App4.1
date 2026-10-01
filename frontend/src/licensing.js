import { API_BASE } from "./api";
import { getToken } from "./utils/auth";

export const FREE_PAGE_KEYS = new Set([
  "DASHBOARD",
  "SUBSCRIPTIONS",
  "LANDING_PAGE",
  "USERS",
  "PRAYER_REQUESTS",
  "SERMONS",
  "TEAMS",
  "ROLES",
  "PAGES",
  "APP_DOWNLOADS",
  "BIBLE",
  "SECURITY",
]);

export const PAGE_MODULES = {
  CHAT: "chat",
  TASKS: "operations",
  ATTENDANCE: "operations",
  PAYROLL: "operations",
  COSTS: "operations",
  REPORTS: "operations",
  AUDIT_TRAIL: "operations",
  VOLUNTEERS: "operations",

  PASTOR: "care_ministry",
  README: "care_ministry",
  MARRIAGE: "care_ministry",
  BAPTISM: "care_ministry",
  COUNSELLING: "care_ministry",
  EVENTS: "care_ministry",
  CHECKIN: "care_ministry",
  SERVICE_PLANS: "care_ministry",

  ADMIN_DASHBOARD: "admin_tools",
  LIVE_USERS: "admin_tools",
  MULTITENANT: "admin_tools",
  TENANT_DASHBOARD: "admin_tools",
  SAAS_BILLING: "admin_tools",
  LANGUAGES: "admin_tools",
  QA_AUTOMATION: "admin_tools",

  MESSAGE_CENTER: "communications",
  EMAIL_CLIENT: "communications",
  GOOGLE_DRIVE: "communications",
  SERVER_FILES: "communications",
};

export function moduleForPage(pageKey) {
  const key = String(pageKey || "").toUpperCase();
  if (!key || FREE_PAGE_KEYS.has(key)) return null;
  return PAGE_MODULES[key] || null;
}

export function moduleIsLicensed(modules, moduleCode) {
  if (!moduleCode) return true;
  const code = String(moduleCode).toLowerCase();
  return (modules || []).some(
    (module) =>
      String(module?.code || module?.Code || "").toLowerCase() === code &&
      Boolean(module?.licensed ?? module?.Licensed)
  );
}

export function pageIsLicensed(pageKey, modules, isRootTenant = false) {
  if (isRootTenant) return true;
  return moduleIsLicensed(modules, moduleForPage(pageKey));
}

export async function fetchTenantEntitlements() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/tenants/current/entitlements`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
