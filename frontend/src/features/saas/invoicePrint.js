import { getTenantPrintDefinition, tenantPrintContact } from "../../utils/tenantPrintDefinition";

const QR_URL = "/assets/upi-qr.png";

function money(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printDonationInvoice(invoice) {
  if (!invoice) return;
  const template = getTenantPrintDefinition();
  const printContact = tenantPrintContact(template);
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  // Browsers may deliberately return `null` for a window opened with the
  // `noopener` feature. That left a real tab open but gave us no document to
  // populate, producing the reported blank invoice. Open a writable document
  // first, then sever the opener reference immediately.
  const w = window.open("", "_blank", "width=960,height=720");
  if (!w) {
    window.alert("The invoice window was blocked. Please allow pop-ups for this site and try again.");
    return;
  }
  try { w.opener = null; } catch { /* browser may already isolate the window */ }

  const lineRows = lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.description || line.moduleCode || "Subscription package")}</td>
      <td>${escapeHtml(line.moduleCode || "")}</td>
      <td class="num">${Number(line.quantity || 1)}</td>
      <td class="num">${money(line.unitPriceInr)}</td>
      <td class="num">${money(line.amountInr)}</td>
    </tr>
  `).join("");

  w.document.write(`<!doctype html>
<html>
<head>
  <base href="${escapeHtml(`${window.location.origin}/`)}">
  <title>${escapeHtml(invoice.invoiceNumber || "Donation Invoice")}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
    .top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid ${escapeHtml(template.primaryColor)}; padding-bottom: 18px; }
    .brand { display:flex; align-items:center; gap:12px; }
    .brand img { width:54px; height:54px; object-fit:contain; }
    h1 { margin: 0; font-size: 28px; }
    .muted { color: #64748b; font-size: 13px; line-height: 1.5; }
    .badge { display: inline-block; margin-top: 8px; padding: 6px 10px; border-radius: 999px; background: #ecfdf5; color: #047857; font-weight: 800; font-size: 12px; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 22px; }
    .box { border: 1px solid #dbe3ef; border-radius: 8px; padding: 14px; }
    .label { color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
    .value { margin-top: 6px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th { text-align: left; background: #f8fafc; color: #64748b; font-size: 11px; text-transform: uppercase; padding: 10px; border-bottom: 1px solid #e2e8f0; }
    td { padding: 11px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; margin-top: 18px; width: 320px; }
    .totals div { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .total { font-size: 18px; font-weight: 900; color: #065f46; }
    .donation { display: grid; grid-template-columns: 150px 1fr; gap: 18px; align-items: center; margin-top: 28px; border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 10px; padding: 16px; }
    .donation img { width: 150px; height: 150px; object-fit: contain; border-radius: 8px; background: white; }
    .footer { margin-top: 24px; font-size: 12px; line-height: 1.6; color: #475569; }
    .print-help { margin: 0 0 18px; padding: 10px 12px; border-radius: 8px; background: #eff6ff; color: #1e40af; font-size: 12px; font-weight: 700; }
    @page { size: ${escapeHtml(template.paperSize)} ${escapeHtml(template.orientation)}; margin: 14mm; }
    @media print { .no-print { display: none !important; } body { margin: 0; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="float:right;padding:10px 14px;border:0;border-radius:8px;background:#047857;color:white;font-weight:800;cursor:pointer;">Save / Print PDF</button>
  <div class="print-help no-print">Invoice loaded successfully. Select “Save / Print PDF” when the preview is ready.</div>
  <div class="top">
    <div class="brand">
      ${template.logoUrl ? `<img src="${escapeHtml(template.logoUrl)}" alt="Organization logo" />` : ""}
      <div>
        <h1>Donation Invoice</h1>
        <div class="muted"><strong>${escapeHtml(template.organizationName)}</strong>${printContact ? `<br>${escapeHtml(printContact)}` : ""}</div>
        ${template.headerText ? `<div class="muted">${escapeHtml(template.headerText)}</div>` : ""}
        <span class="badge">${escapeHtml(invoice.status || "open")}</span>
      </div>
    </div>
    <div class="muted" style="text-align:right">
      <div><strong>${escapeHtml(invoice.invoiceNumber || "")}</strong></div>
      <div>Period: ${new Date(invoice.periodStartUtc).toLocaleDateString()} - ${new Date(invoice.periodEndUtc).toLocaleDateString()}</div>
      <div>Generated: ${new Date().toLocaleString()}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <div class="label">Church</div>
      <div class="value">${escapeHtml(invoice.tenantName || invoice.tenantSlug || "Church")}</div>
      <div class="muted">${escapeHtml(invoice.tenantSlug || "")}</div>
    </div>
    <div class="box">
      <div class="label">Purpose</div>
      <div class="value">Monthly SAAS ministry platform donation</div>
      <div class="muted">All contributions are received as welfare society donations.</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th>Code</th><th class="num">Qty</th><th class="num">Donation</th><th class="num">Amount</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><strong>${money(invoice.subtotalInr)}</strong></div>
    <div><span>Tax</span><strong>${money(invoice.taxInr)}</strong></div>
    <div class="total"><span>Total Donation</span><strong>${money(invoice.totalInr)}</strong></div>
    <div><span>Received</span><strong>${money(invoice.paidInr)}</strong></div>
    <div><span>Balance</span><strong>${money(invoice.balanceInr)}</strong></div>
  </div>

  <div class="donation">
    <img src="${QR_URL}" alt="UPI QR Code" />
    <div>
      <h2 style="margin:0 0 8px;">Donate via UPI QR</h2>
      <div class="muted">Scan this QR to donate to the account shown. Please share the UPI reference with your church administrator for reconciliation.</div>
      <div class="value" style="margin-top:10px;">Amount: ${money(invoice.balanceInr || invoice.totalInr)}</div>
    </div>
  </div>

  <div class="footer">
    ${template.footerText ? `${escapeHtml(template.footerText)}<br>` : ""}This document is generated for monthly church SAAS access tracking. The amount is treated as a donation to the welfare society account, not a commercial sale invoice.
  </div>
</body>
</html>`);
  w.document.close();
  const finish = () => {
    try {
      w.document.title = invoice.invoiceNumber || "Donation Invoice";
      w.focus();
    } catch { /* window may have been closed */ }
  };
  if (w.document.readyState === "complete") finish();
  else w.addEventListener("load", finish, { once: true });
}

export { QR_URL, money };
