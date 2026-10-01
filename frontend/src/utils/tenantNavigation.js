const TENANT_KEYS = ["mahima_tenant_slug", "tenantSlug", "tenant_slug"];

export function activeTenantSlug(explicitSlug = "") {
  const supplied = String(explicitSlug || "").trim();
  if (supplied) return supplied;

  try {
    const hash = window.location.hash || "";
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    const searchParams = new URLSearchParams(window.location.search || "");
    const tenantPath = hash.match(/^#\/t\/([^/?#]+)/i);
    const fromUrl = (
      searchParams.get("tenantSlug") ||
      searchParams.get("tenant") ||
      hashParams.get("tenantSlug") ||
      hashParams.get("tenant") ||
      (tenantPath ? decodeURIComponent(tenantPath[1]) : "") ||
      ""
    ).trim();
    if (fromUrl) return fromUrl;

    for (const key of TENANT_KEYS) {
      const stored = (localStorage.getItem(key) || "").trim();
      if (stored) return stored;
    }
  } catch {}

  return "";
}

export function tenantLoginRoute(explicitSlug = "") {
  const slug = activeTenantSlug(explicitSlug);
  return slug ? `/login?tenantSlug=${encodeURIComponent(slug)}` : "/login";
}

export function tenantLoginHref(explicitSlug = "") {
  const slug = activeTenantSlug(explicitSlug);
  return slug ? `/#/login?tenantSlug=${encodeURIComponent(slug)}` : "/#/login";
}
