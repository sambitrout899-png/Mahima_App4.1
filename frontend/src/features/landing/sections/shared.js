// Shared helpers for the tenant landing page section components — used by both the
// real public page (PublicLandingView) and the admin editor's live preview.

// The native app loads its pages from Capacitor's local app origin, not from the
// real domain, so a root-relative path like "/api/uploads/..." 404s there even
// though the exact same string works fine in a browser tab on the live site.
// api.js's buildApiBase() already solves this for JSON API calls; this mirrors
// that same native-detection so stored image URLs resolve the same way.
function nativeAssetOrigin() {
  try {
    if (typeof window === "undefined") return "";
    const isNative =
      import.meta.env.MODE === "mobile" ||
      Boolean(window.Capacitor?.isNativePlatform?.()) ||
      window.location?.protocol === "capacitor:";
    if (!isNative) return "";
    const base =
      window.__API_BASE__ ||
      import.meta.env.VITE_MOBILE_API_BASE ||
      "https://beta.mahimaministries.in/api";
    return new URL(base, window.location.href).origin;
  } catch {
    return "";
  }
}

const ASSET_ORIGIN = nativeAssetOrigin();

export function resolveAsset(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/uploads/")) {
        parsed.pathname = `/api${parsed.pathname}`;
        return parsed.toString();
      }
    } catch {
      return value;
    }
    return value;
  }
  if (/^(data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/uploads/")) return `${ASSET_ORIGIN}/api${value}`;
  if (value.startsWith("/")) return `${ASSET_ORIGIN}${value}`;
  return `${ASSET_ORIGIN}/${value}`;
}

// Builds the theme object every section component receives — richer than the old
// 2-color `colors` prop, sourced from TenantBranding.
// `overrides` lets one section replace any subset of the brand-level colors/fonts
// (e.g. a section-specific themeOverride) - fields left out fall back to the
// tenant's brand settings exactly as before.
export function buildTheme(branding = {}, overrides = {}) {
  const primary = overrides.primaryColor || branding.primaryColor || "#0f766e";
  const accent = overrides.accentColor || branding.accentColor || "#f59e0b";
  const neutral = overrides.neutralColor || branding.neutralColor || "#f8fafc";
  const dark = overrides.darkColor || branding.darkColor || "#0f172a";
  return {
    primary,
    accent,
    neutral,
    dark,
    primarySoft: `${primary}18`,
    accentSoft: `${accent}18`,
    headingFont: overrides.headingFont || branding.headingFont || "Inter",
    bodyFont: overrides.bodyFont || branding.bodyFont || "Inter",
  };
}

export function youTubeOrVimeoEmbed(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  const yt = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = value.match(/vimeo\.com\/(\d+)/i);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

export function mapsUrlFor(address, override) {
  const explicit = String(override || "").trim();
  if (explicit) return explicit;
  const addr = String(address || "").trim();
  if (!addr) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}
