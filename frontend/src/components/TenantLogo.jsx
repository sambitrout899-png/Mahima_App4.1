import React, { useEffect, useMemo, useState } from "react";
import { Church } from "lucide-react";
import { API_BASE } from "../api";

function initialsFor(name = "") {
  const value = String(name || "").trim();
  if (!value) return "";
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function resolveLogoUrl(src = "") {
  const value = String(src || "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;

  const apiBase = String(API_BASE || "").replace(/\/+$/, "");
  const apiOrigin = apiBase
    .replace(/\/api\/?$/i, "")
    .replace(/\/+$/, "");
  if (apiOrigin && value.startsWith("/api/uploads/")) return `${apiOrigin}${value}`;
  if (apiBase && value.startsWith("/uploads/")) return `${apiBase}${value}`;
  if (apiBase && !value.startsWith("/") && value.includes("/uploads/")) return `${apiBase}/${value.replace(/^\/+/, "")}`;

  if (typeof window !== "undefined") {
    return `${window.location.origin}${value.startsWith("/") ? "" : "/"}${value}`;
  }
  return value;
}

export default function TenantLogo({
  src = "",
  name = "Church",
  className = "h-12 w-12 rounded-lg",
  imgClassName = "object-contain p-1.5",
  fallbackClassName = "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100",
  style,
}) {
  const [broken, setBroken] = useState(false);
  const cleanSrc = String(src || "").trim();
  const resolvedSrc = useMemo(() => resolveLogoUrl(cleanSrc), [cleanSrc]);
  const initials = useMemo(() => initialsFor(name), [name]);

  useEffect(() => {
    setBroken(false);
  }, [resolvedSrc]);

  return (
    <span className={`inline-grid shrink-0 place-items-center overflow-hidden ${className} ${!cleanSrc || broken ? fallbackClassName : "bg-white ring-1 ring-slate-200"}`} style={style}>
      {resolvedSrc && !broken ? (
        <img
          src={resolvedSrc}
          alt={name || "Church logo"}
          className={`h-full w-full ${imgClassName}`}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : initials ? (
        <span className="text-sm font-black leading-none">{initials}</span>
      ) : (
        <Church className="h-5 w-5" />
      )}
    </span>
  );
}
