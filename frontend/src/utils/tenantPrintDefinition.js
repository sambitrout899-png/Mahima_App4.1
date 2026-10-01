import { resolveLogoUrl } from "../components/TenantLogo";

function storedTenantName() {
  try {
    const user = JSON.parse(localStorage.getItem("mahima_user") || localStorage.getItem("user") || "{}");
    return user?.tenantName || user?.TenantName || user?.organizationName || user?.churchName || "";
  } catch {
    return "";
  }
}

export function getTenantPrintDefinition() {
  const template = window.__mahimaPrintTemplate || {};
  return {
    ...template,
    organizationName: String(template.organizationName || storedTenantName() || "Church").trim(),
    logoUrl: template.showLogo !== false && template.logoUrl ? resolveLogoUrl(template.logoUrl) : "",
    address: template.showAddress !== false ? String(template.address || "").trim() : "",
    phone: template.showPhone !== false ? String(template.phone || "").trim() : "",
    email: template.showEmail !== false ? String(template.email || "").trim() : "",
    headerText: String(template.headerText || "").trim(),
    footerText: String(template.footerText || "").trim(),
    primaryColor: template.primaryColor || "#047857",
    paperSize: template.paperSize || "A4",
    orientation: template.orientation || "portrait",
  };
}

export function tenantPrintContact(definition) {
  return [definition.address, definition.phone, definition.email].filter(Boolean).join(" · ");
}
