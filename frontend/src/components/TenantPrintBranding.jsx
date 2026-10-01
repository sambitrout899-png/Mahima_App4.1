import React, { useEffect, useState } from "react";
import { getTenantPrintTemplate } from "../api/multiTenantApi";
import TenantLogo from "./TenantLogo";

export default function TenantPrintBranding() {
  const [template, setTemplate] = useState(null);

  useEffect(() => {
    let active = true;
    getTenantPrintTemplate().then((value) => {
      if (active) {
        setTemplate(value);
        window.__mahimaPrintTemplate = value;
      }
    }).catch(() => {});
    const update = (event) => {
      const value = event?.detail;
      if (!value) return;
      setTemplate(value);
      window.__mahimaPrintTemplate = value;
    };
    window.addEventListener("mahima:print-template-changed", update);
    return () => {
      active = false;
      window.removeEventListener("mahima:print-template-changed", update);
    };
  }, []);

  if (!template) return null;
  return (
    <>
      <style>{`
        .mahima-print-branding { display: none; }
        @media print {
          .mahima-print-branding { display: flex !important; align-items: center; gap: 14px; padding: 0 0 12px; margin: 0 0 18px; border-bottom: 2px solid ${template.primaryColor || "#047857"}; }
          .mahima-print-branding-details { flex: 1; }
          .mahima-print-branding-name { font-size: 20px; font-weight: 800; color: ${template.primaryColor || "#047857"}; }
          .mahima-print-branding-meta { font-size: 10px; color: #475569; }
          @page { size: ${template.paperSize || "A4"} ${template.orientation || "portrait"}; margin: 14mm; }
        }
      `}</style>
      <div className="mahima-print-branding">
        {template.showLogo && <TenantLogo src={template.logoUrl} name={template.organizationName} className="h-16 w-16 rounded-md" />}
        <div className="mahima-print-branding-details">
          <div className="mahima-print-branding-name">{template.organizationName}</div>
          {template.headerText && <div className="mahima-print-branding-meta">{template.headerText}</div>}
          {template.showAddress && template.address && <div className="mahima-print-branding-meta">{template.address}</div>}
          <div className="mahima-print-branding-meta">{[template.phone, template.email].filter(Boolean).join(" • ")}</div>
        </div>
      </div>
    </>
  );
}
