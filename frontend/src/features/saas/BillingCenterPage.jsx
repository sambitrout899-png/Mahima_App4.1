import React, { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  Download,
  Save,
  Trash2,
} from "lucide-react";
import {
  applyBillingInvoicePayment,
  deleteBillingInvoice,
  deleteBillingInvoicePeriod,
  generateBillingInvoices,
  getBillingSettings,
  listBillingInvoices,
  markPaymentPaid,
  saveBillingSettings,
} from "../../api/multiTenantApi";
import { QR_URL, money, printDonationInvoice } from "./invoicePrint";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function readDonationDetails(record) {
  try {
    const parsed = record?.metadataJson ? JSON.parse(record.metadataJson) : {};
    return parsed?.donation || {};
  } catch {
    return {};
  }
}

export default function BillingCenterPage() {
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState({ summary: {}, items: [], donationRecords: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [billingDay, setBillingDay] = useState(1);
  const [proRata, setProRata] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ invoiceId: "", amountInr: "", providerPaymentId: "", note: "" });

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const result = await listBillingInvoices({ month, status });
      setData({
        summary: result?.summary || {},
        items: Array.isArray(result?.items) ? result.items : [],
        donationRecords: Array.isArray(result?.donationRecords) ? result.donationRecords : [],
      });
    } catch (error) {
      setMessage(error?.message || "Could not load billing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [month, status]);

  useEffect(() => {
    getBillingSettings()
      .then((result) => setBillingDay(Number(result?.billingDay) || 1))
      .catch((error) => setMessage(error?.message || "Could not load billing settings."));
  }, []);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const invoices = Array.isArray(data.items) ? data.items : [];
    if (!q) return invoices;
    return invoices.filter((invoice) =>
      [
        invoice.invoiceNumber,
        invoice.tenantName,
        invoice.tenantSlug,
        invoice.status,
        ...(Array.isArray(invoice.lines) ? invoice.lines.map((line) => line.description || line.moduleCode) : []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [data.items, search]);

  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const result = await generateBillingInvoices({ month, proRata, replaceExisting, billingDay });
      setMessage(`${replaceExisting ? "Regenerated" : "Generated"} ${result?.created ?? 0} invoice(s) for ${month}${proRata ? " on a pro-rata basis" : ""}.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not generate invoices.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    setMessage("");
    try {
      const result = await saveBillingSettings({ billingDay: Number(billingDay) });
      setBillingDay(Number(result?.billingDay) || 1);
      setMessage(`Billing day saved as day ${result?.billingDay}.`);
    } catch (error) {
      setMessage(error?.message || "Could not save billing settings.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePeriod() {
    if (!window.confirm(`Permanently delete every invoice for ${month}, including paid invoices and payment links?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteBillingInvoicePeriod({ month });
      setMessage(`Deleted ${result?.deleted ?? 0} unpaid invoice(s) for ${month}.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not delete invoices.");
    } finally {
      setBusy(false);
    }
  }

  async function generateTenantBill(invoice, replace) {
    setBusy(true);
    setMessage("");
    try {
      const result = await generateBillingInvoices({
        month,
        tenantId: invoice.tenantId,
        proRata,
        replaceExisting: replace,
        billingDay,
      });
      setMessage(`${replace ? "Regenerated" : "Generated"} ${invoice.tenantName || invoice.tenantSlug} bill for ${month}.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not generate tenant invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function dropTenantBill(invoice) {
    if (!window.confirm(`Permanently drop ${invoice.invoiceNumber} for ${invoice.tenantName || invoice.tenantSlug}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await deleteBillingInvoice(invoice.id);
      setMessage(`Dropped ${invoice.invoiceNumber}.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not drop invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function applyPayment(invoice) {
    const amount = paymentDraft.invoiceId === invoice.id ? paymentDraft.amountInr : "";
    const providerPaymentId = paymentDraft.invoiceId === invoice.id ? paymentDraft.providerPaymentId : "";
    const note = paymentDraft.invoiceId === invoice.id ? paymentDraft.note : "";
    setBusy(true);
    setMessage("");
    try {
      await applyBillingInvoicePayment(invoice.id, {
        amountInr: amount ? Number(amount) : Number(invoice.balanceInr || invoice.totalInr || 0),
        providerPaymentId,
        note,
      });
      setPaymentDraft({ invoiceId: "", amountInr: "", providerPaymentId: "", note: "" });
      setMessage(`Donation applied to ${invoice.invoiceNumber}.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not apply donation.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDonation(record) {
    const paymentIntentId = record?.id || record?.Id;
    const providerPaymentId = record?.providerPaymentId || record?.ProviderPaymentId || readDonationDetails(record).upiTransactionNumber;
    if (!paymentIntentId) {
      setMessage("Could not confirm donation because the payment record id was missing. Please refresh billing and try again.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      await markPaymentPaid(paymentIntentId, {
        providerPaymentId,
        payloadJson: JSON.stringify({ source: "admin_confirmed_upi_donation", donationRecordId: paymentIntentId }),
      });
      setMessage(`Donation confirmed. ${record.moduleName || record.moduleCode} activated for ${record.tenantName || record.tenantSlug}.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not confirm donation.");
    } finally {
      setBusy(false);
    }
  }

  const summary = data.summary || {};
  const donationRecords = Array.isArray(data.donationRecords) ? data.donationRecords : [];

  return (
    <main className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-indigo-800 ring-1 ring-indigo-100">
              <ReceiptText className="h-3.5 w-3.5" /> SAAS Billing
            </div>
            <h1 className="mt-3 text-3xl font-black text-slate-950">Church Billing Center</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Generate monthly donation invoices and track collections for every church.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} disabled={loading || busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            <button type="button" onClick={generate} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {replaceExisting ? "Regenerate Bills" : "Generate Bills"}
            </button>
            <button type="button" onClick={deletePeriod} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:opacity-60">
              <Trash2 className="h-4 w-4" /> Delete Period
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={FileText} label="Invoices" value={summary.invoiceCount || 0} />
          <Metric icon={CalendarClock} label="Monthly Recurring" value={money(summary.monthlyRecurringInr)} />
          <Metric icon={Banknote} label="Open Amount" value={money(summary.openAmountInr)} tone="amber" />
          <Metric icon={CheckCircle2} label="Collected" value={money(summary.paidAmountInr)} tone="emerald" />
        </div>

        {message && <div className="mt-4 rounded-lg bg-sky-50 p-3 text-sm font-bold text-sky-800 ring-1 ring-sky-100">{message}</div>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[180px_180px_1fr]">
          <label className="text-sm font-black text-slate-700">
            Billing month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none ring-emerald-100 focus:ring-4" />
          </label>
          <label className="text-sm font-black text-slate-700">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none ring-emerald-100 focus:ring-4">
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label className="text-sm font-black text-slate-700">
            Search
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Church, invoice, package" className="min-h-10 w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm font-bold outline-none ring-emerald-100 focus:ring-4" />
            </div>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4">
          <label className="text-sm font-black text-slate-700">
            Billing day
            <div className="mt-1 flex gap-2">
              <input type="number" min="1" max="28" value={billingDay} onChange={(e) => setBillingDay(e.target.value)} className="min-h-10 w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none ring-emerald-100 focus:ring-4" />
              <button type="button" onClick={saveSettings} disabled={busy || Number(billingDay) < 1 || Number(billingDay) > 28} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                <Save className="h-3.5 w-3.5" /> Save
              </button>
            </div>
          </label>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700">
            <input type="checkbox" checked={proRata} onChange={(e) => setProRata(e.target.checked)} className="h-4 w-4 accent-emerald-700" />
            Pro-rata active days
          </label>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800">
            <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} className="h-4 w-4 accent-amber-700" />
            Replace unpaid invoices
          </label>
          <p className="max-w-xl text-xs font-semibold leading-5 text-slate-500">
            Billing periods start on the selected day. Pro-rata charges each package only for its active days. Delete and replace operations remove all matching invoices, including paid records.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-3">
          <div>
            <h2 className="text-lg font-black text-emerald-950">Pending UPI Donation Confirmations</h2>
            <p className="mt-1 text-sm font-semibold text-emerald-800">Confirm received UPI details to settle billing and activate the requested module.</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-800 ring-1 ring-emerald-100">{donationRecords.length} pending</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1040px] w-full text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
              <tr className="text-left">
                <th className="px-4 py-3">Church</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">UPI Details</th>
                <th className="px-4 py-3">Submitted By</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {donationRecords.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center font-bold text-slate-500">No UPI donation submissions are waiting for confirmation.</td></tr>
              ) : donationRecords.map((record) => {
                const details = readDonationDetails(record);
                return (
                  <tr key={record.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-900">{record.tenantName || record.tenantSlug || "Church"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{record.tenantSlug}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-900">{record.moduleName || record.moduleCode}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{record.moduleCode}</div>
                    </td>
                    <td className="px-4 py-4 text-right font-black text-slate-900">{money(details.amountInr || record.amountInr)}</td>
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-800">{details.upiTransactionNumber || record.providerPaymentId || "Reference not provided"}</div>
                      {details.note && <div className="mt-1 text-xs font-semibold text-slate-500">{details.note}</div>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-800">{details.payerName || "Not provided"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{[details.payerPhone, details.payerEmail].filter(Boolean).join(" | ")}</div>
                    </td>
                    <td className="px-4 py-4">
                      <button type="button" onClick={() => confirmDonation(record)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-60">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Confirm & Activate
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1320px] table-fixed text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
              <tr className="text-left">
                <th className="w-56 px-4 py-3">Invoice</th>
                <th className="w-64 px-4 py-3">Church</th>
                <th className="w-60 px-4 py-3">Packages</th>
                <th className="w-32 px-4 py-3 text-right">Total</th>
                <th className="w-32 px-4 py-3 text-right">Paid</th>
                <th className="w-32 px-4 py-3 text-right">Balance</th>
                <th className="w-32 px-4 py-3">Status</th>
                <th className="w-56 px-4 py-3">Bill Actions</th>
                <th className="w-80 px-4 py-3">Donation Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center font-bold text-slate-500">Loading invoices...</td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center font-bold text-slate-500">No invoices found for this filter.</td></tr>
              ) : filteredInvoices.map((invoice) => {
                const draftOpen = paymentDraft.invoiceId === invoice.id;
                return (
                  <tr key={invoice.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-950">{invoice.invoiceNumber}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {new Date(invoice.periodStartUtc).toLocaleDateString()} - {new Date(invoice.periodEndUtc).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-800">{invoice.tenantName || invoice.tenantSlug || "Church"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{invoice.tenantSlug}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        {(invoice.lines || []).map((line) => (
                          <div key={line.id || line.moduleCode} className="rounded-md bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
                            {line.description} - {money(line.amountInr)}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right font-black text-slate-900">{money(invoice.totalInr)}</td>
                    <td className="px-4 py-4 text-right font-black text-emerald-700">{money(invoice.paidInr)}</td>
                    <td className="px-4 py-4 text-right font-black text-amber-700">{money(invoice.balanceInr)}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${invoice.status === "paid" ? "bg-emerald-50 text-emerald-800" : invoice.status === "partial" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                        {invoice.status || "open"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => generateTenantBill(invoice, false)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                          <FileText className="h-3.5 w-3.5" /> Generate
                        </button>
                        <button type="button" onClick={() => generateTenantBill(invoice, true)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-black text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                          <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                        </button>
                        <button type="button" onClick={() => dropTenantBill(invoice)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" /> Drop
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <PaymentRecordList records={invoice.paymentRecords} />
                      {invoice.status === "paid" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Settled</span>
                          <button type="button" onClick={() => printDonationInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                            <Download className="h-3.5 w-3.5" /> PDF
                          </button>
                        </div>
                      ) : draftOpen ? (
                        <div className="grid gap-2">
                          <input value={paymentDraft.amountInr} onChange={(e) => setPaymentDraft((d) => ({ ...d, amountInr: e.target.value }))} placeholder={`Amount (${money(invoice.balanceInr)})`} className="min-h-9 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold outline-none" />
                          <input value={paymentDraft.providerPaymentId} onChange={(e) => setPaymentDraft((d) => ({ ...d, providerPaymentId: e.target.value }))} placeholder="Donation / UPI reference" className="min-h-9 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold outline-none" />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => applyPayment(invoice)} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-60">Apply</button>
                            <button type="button" onClick={() => setPaymentDraft({ invoiceId: "", amountInr: "", providerPaymentId: "", note: "" })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setPaymentDraft({ invoiceId: invoice.id, amountInr: invoice.balanceInr || "", providerPaymentId: "", note: "" })} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100">
                            Record Donation
                          </button>
                          <button type="button" onClick={() => printDonationInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                            <Download className="h-3.5 w-3.5" /> PDF
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[140px_1fr] md:items-center">
          <img src={QR_URL} alt="UPI donation QR" className="h-32 w-32 rounded-lg border border-emerald-100 bg-white object-contain p-2" />
          <div>
            <h2 className="text-lg font-black text-emerald-950">UPI Donation QR</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-emerald-800">
              All SAAS collections should be received as donations into the welfare society account. Share this QR with churches and record the UPI reference against the invoice.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function PaymentRecordList({ records }) {
  const items = Array.isArray(records) ? records : [];
  if (!items.length) {
    return <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">No payment record linked yet.</div>;
  }

  return (
    <div className="mb-3 grid gap-2">
      {items.map((record) => {
        const details = readDonationDetails(record);
        return (
          <div key={record.id || record.Id} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-black">{record.status || record.Status || "payment"}</span>
              <span className="font-black">{money(details.amountInr || record.amountInr || record.AmountInr)}</span>
            </div>
            <div className="mt-1 font-bold text-emerald-800">
              UPI: {details.upiTransactionNumber || record.providerPaymentId || record.ProviderPaymentId || "not uploaded"}
            </div>
            {details.payerName && <div className="mt-1 font-semibold text-emerald-700">By {details.payerName}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-800",
    amber: "bg-amber-50 text-amber-800",
    emerald: "bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={`rounded-lg p-4 ring-1 ring-slate-200 ${tones[tone] || tones.slate}`}>
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide opacity-80">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </div>
  );
}
