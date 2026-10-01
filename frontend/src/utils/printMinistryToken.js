import { getTenantPrintDefinition, tenantPrintContact } from "./tenantPrintDefinition";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTokenDate(value) {
  if (!value) return "To be confirmed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: date.getHours() || date.getMinutes() ? "2-digit" : undefined,
    minute: date.getHours() || date.getMinutes() ? "2-digit" : undefined,
  });
}

export function printMinistryToken({ ministry, token, personName, companionName, date, location, detail, status }) {
  if (!token) {
    window.alert("Generate a token before printing.");
    return;
  }

  const template = getTenantPrintDefinition();
  const organizationName = template.organizationName;
  const address = tenantPrintContact(template);
  const logo = template.logoUrl;
  const primary = template.primaryColor;
  const printWindow = window.open("", "_blank", "width=760,height=680");
  if (!printWindow) {
    window.alert("Please allow pop-ups to print the token.");
    return;
  }
  try { printWindow.opener = null; } catch { /* already isolated */ }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><base href="${escapeHtml(`${window.location.origin}/`)}">
<title>${escapeHtml(ministry)} Token - ${escapeHtml(token)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;padding:24px;background:#eef2f7;color:#0f172a;font-family:"Segoe UI",Arial,sans-serif}
  .toolbar{width:148mm;margin:0 auto 12px;display:flex;justify-content:flex-end}.toolbar button{border:0;border-radius:10px;background:#047857;color:#fff;padding:10px 16px;font-weight:800;cursor:pointer}
  .token{position:relative;overflow:hidden;width:148mm;min-height:100mm;margin:0 auto;padding:10mm;border:1px solid #cbd5e1;border-radius:18px;background:linear-gradient(145deg,#fff,#f0fdfa 62%,#fffbeb);box-shadow:0 24px 60px rgba(15,23,42,.18)}
  .token:before{content:"";position:absolute;inset:0 0 auto;height:7px;background:linear-gradient(90deg,${escapeHtml(primary)},#0ea5e9,#8b5cf6,#f59e0b)}
  .header{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid #dbe4ef}.logo{width:52px;height:52px;object-fit:contain}.org{font-size:19px;font-weight:900;color:${escapeHtml(primary)}}.address{margin-top:2px;font-size:10px;color:#64748b}
  .ministry{margin-top:16px;color:#64748b;font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.number{margin-top:4px;font-size:30px;font-weight:950;letter-spacing:.05em;color:#111827}
  .grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px;margin-top:15px}.box{border:1px solid #dbe4ef;border-radius:12px;background:rgba(255,255,255,.86);padding:10px}.label{font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b}.value{margin-top:4px;font-size:13px;font-weight:800;line-height:1.4}.wide{grid-column:1/-1}
  .note{margin-top:14px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:9px;line-height:1.5;color:#64748b}.status{display:inline-block;border-radius:999px;background:#dcfce7;color:#166534;padding:4px 9px;font-size:9px;font-weight:900;text-transform:uppercase}
  @page{size:A6 landscape;margin:7mm}@media print{body{padding:0;background:#fff}.toolbar{display:none}.token{width:100%;min-height:0;border:0;border-radius:0;box-shadow:none;page-break-inside:avoid}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print Token</button></div>
<section class="token">
  <div class="header">${logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="Church logo">` : ""}<div><div class="org">${escapeHtml(organizationName)}</div>${address ? `<div class="address">${escapeHtml(address)}</div>` : ""}</div></div>
  <div class="ministry">${escapeHtml(ministry)} Ministry Token</div><div class="number">${escapeHtml(token)}</div>
  <div class="grid">
    <div class="box"><div class="label">Name</div><div class="value">${escapeHtml(personName || "-")}${companionName ? ` &amp; ${escapeHtml(companionName)}` : ""}</div></div>
    <div class="box"><div class="label">Status</div><div class="value"><span class="status">${escapeHtml(status || "Issued")}</span></div></div>
    <div class="box"><div class="label">Scheduled date</div><div class="value">${escapeHtml(formatTokenDate(date))}</div></div>
    <div class="box"><div class="label">Location / Service</div><div class="value">${escapeHtml(location || "To be confirmed")}</div></div>
    ${detail ? `<div class="box wide"><div class="label">Reference</div><div class="value">${escapeHtml(detail)}</div></div>` : ""}
  </div>
  <div class="note">Please bring this token when attending. This is a ministry appointment token and not a civil or legal certificate.</div>
</section></body></html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.addEventListener("load", () => printWindow.focus(), { once: true });
}
