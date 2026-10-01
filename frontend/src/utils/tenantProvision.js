let cached;

// Reads the tenant identity baked into this install by tools/build-tenant-app
// (frontend/public/tenant-provision.json), if any. Only ever non-null inside a
// per-tenant white-label APK built by that script - the web app and the
// generic/default Mahima APK carry the neutral {tenantSlug:null} file and this
// resolves to null for them, leaving existing behavior unchanged.
export async function getProvisionedTenant() {
  if (cached !== undefined) return cached;
  if (!window.Capacitor?.isNativePlatform?.()) {
    cached = null;
    return cached;
  }

  try {
    const res = await fetch("/tenant-provision.json", { cache: "no-store" });
    const data = await res.json();
    cached = data?.tenantSlug
      ? { slug: String(data.tenantSlug), name: data.tenantName ? String(data.tenantName) : "" }
      : null;
  } catch {
    cached = null;
  }

  return cached;
}
