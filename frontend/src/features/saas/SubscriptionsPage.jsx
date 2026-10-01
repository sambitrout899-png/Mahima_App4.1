import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Download, Loader2, Lock, Mail, QrCode, RefreshCw, Sparkles } from "lucide-react";
import { API_BASE } from "../../api";
import { getToken } from "../../utils/auth";
import {
  createCurrentTenantModulePaymentIntent,
  decideCurrentPackageVersion,
  changeCurrentSubscription,
  listCurrentTenantBillingInvoices,
  submitPackagePaymentRequest,
  submitDonationDetails,
} from "../../api/multiTenantApi";
import { QR_URL, money, printDonationInvoice } from "./invoicePrint";
import TenantStorageUsage from "../../components/TenantStorageUsage";

const TENANT_SLUG_KEY = "mahima_tenant_slug";

function currentTenantUrl(slug) {
  if (!slug) return "";
  return `${window.location.origin}${window.location.pathname}#/t/${encodeURIComponent(slug)}`;
}

export default function SubscriptionsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyModule, setBusyModule] = useState("");
  const [message, setMessage] = useState("");
  const [invoiceData, setInvoiceData] = useState({ items: [] });
  const [donationIntent, setDonationIntent] = useState(null);
  const [donationSubmitting, setDonationSubmitting] = useState(false);
  const [selectedAddOnId, setSelectedAddOnId] = useState("");
  const [donationDetails, setDonationDetails] = useState({
    upiTransactionNumber: "",
    payerName: "",
    payerPhone: "",
    payerEmail: "",
    amountInr: "",
    note: "",
  });

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/tenants/current/entitlements`, {
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      if (json?.tenant?.slug) localStorage.setItem(TENANT_SLUG_KEY, json.tenant.slug);
      setData(json);
      const invoices = await listCurrentTenantBillingInvoices().catch(() => ({ items: [] }));
      setInvoiceData({ items: Array.isArray(invoices?.items) ? invoices.items : [] });
    } catch (err) {
      setMessage(err?.message || "Unable to load subscriptions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const modules = Array.isArray(data?.modules) ? data.modules : [];
  const packages = Array.isArray(data?.packages) ? data.packages : [];
  const baseModule = modules.find((item) => Boolean(item.isBaseModule ?? item.IsBaseModule));
  const tenantUrl = useMemo(() => currentTenantUrl(data?.tenant?.slug), [data?.tenant?.slug]);
  const countryCode = String(data?.tenant?.countryCode || data?.tenant?.CountryCode || "IN").trim().toUpperCase();
  const isIndia = countryCode === "IN" || countryCode === "IND" || countryCode === "+91";

  async function donateForModule(module) {
    setBusyModule(module.code);
    setMessage("");
    try {
      if (!isIndia) {
        window.location.href = "mailto:contact@mahimaministries.in?subject=Paid%20subscription%20activation";
        return;
      }
      const intent = await createCurrentTenantModulePaymentIntent(module.code, { provider: "upi" });
      if (intent.status === "activated" || intent.status === "active") {
        setMessage(`${module.name} is active.`);
        await load();
        window.dispatchEvent(new CustomEvent("mahima:permissions-changed"));
        return;
      }
      setDonationIntent({ ...intent, moduleName: module.name });
      setDonationDetails({
        upiTransactionNumber: "",
        payerName: "",
        payerPhone: "",
        payerEmail: "",
        amountInr: String(intent.amountInr || ""),
        note: "",
      });
      setMessage(`Scan the UPI QR and donate Rs ${intent.amountInr}. Share the UPI reference with Mahima admin for activation.`);
    } catch (err) {
      setMessage(err?.message || "Unable to create donation request.");
    } finally {
      setBusyModule("");
    }
  }

  async function copyTenantUrl() {
    if (!tenantUrl) return;
    await navigator.clipboard?.writeText(tenantUrl);
    setMessage("Tenant URL copied.");
  }

  async function decideVersion(item, accept) {
    setBusyModule(`package-${item.id}`);
    setMessage("");
    try {
      await decideCurrentPackageVersion(item.id, item.version, accept);
      setMessage(accept
        ? `${item.name} v${item.version} was applied immediately. Your current invoice has been recalculated pro-rata.`
        : `You will remain on ${item.name} v${item.currentVersion} with the existing price and features.`);
      await load();
      window.dispatchEvent(new CustomEvent("mahima:permissions-changed"));
    } catch (err) {
      setMessage(err?.message || "Could not save your version choice.");
    } finally {
      setBusyModule("");
    }
  }

  async function changeSubscription(item, action, targetPlanId = null) {
    const label = action === "resume" ? "resume" : action;
    const penaltyNotice = action === "terminate" || action === "downgrade"
      ? " An early-exit penalty may apply during the contract period."
      : "";
    if (!window.confirm(`Are you sure you want to ${label} ${item.name}?${penaltyNotice}`)) return;
    setBusyModule(`package-${item.id}`);
    setMessage("");
    try {
      const result = await changeCurrentSubscription(item.subscriptionId, action, targetPlanId);
      setMessage(`${item.name} ${result.status}.${result.penaltyInr > 0 ? ` An early-exit penalty of ${money(result.penaltyInr)} was added to billing.` : ""}`);
      await load();
      window.dispatchEvent(new CustomEvent("mahima:permissions-changed"));
    } catch (err) {
      setMessage(err?.message || "Could not change the subscription.");
    } finally {
      setBusyModule("");
    }
  }

  function updateDonationDetails(field, value) {
    setDonationDetails((current) => ({ ...current, [field]: value }));
  }

  async function submitDonationReceipt(event) {
    event.preventDefault();
    if (!donationIntent?.id) {
      setMessage("Please choose a package first.");
      return;
    }
    if (!donationDetails.upiTransactionNumber.trim() || !donationDetails.payerName.trim()) {
      setMessage("UPI transaction number and name are required.");
      return;
    }

    setDonationSubmitting(true);
    setMessage("");
    try {
      await submitDonationDetails(donationIntent.id, {
        upiTransactionNumber: donationDetails.upiTransactionNumber.trim(),
        payerName: donationDetails.payerName.trim(),
        payerPhone: donationDetails.payerPhone.trim(),
        payerEmail: donationDetails.payerEmail.trim(),
        amountInr: Number(donationDetails.amountInr || donationIntent.amountInr || 0),
        note: donationDetails.note.trim(),
      });
      setMessage("Donation details submitted. Mahima admin will confirm the payment and activate the module.");
      setDonationIntent((current) => (current ? { ...current, status: "submitted" } : current));
    } catch (err) {
      setMessage(err?.message || "Could not submit donation details.");
    } finally {
      setDonationSubmitting(false);
    }
  }

  async function submitAddOnPayment(event, item) {
    event.preventDefault();
    if (!donationDetails.upiTransactionNumber.trim() || !donationDetails.payerName.trim()) {
      setMessage("UPI transaction number and payer name are required.");
      return;
    }
    setDonationSubmitting(true);
    setMessage("");
    try {
      const result = await submitPackagePaymentRequest(item.id, {
        upiTransactionNumber: donationDetails.upiTransactionNumber.trim(),
        payerName: donationDetails.payerName.trim(),
        payerPhone: donationDetails.payerPhone.trim(),
        payerEmail: donationDetails.payerEmail.trim(),
        amountInr: Number(donationDetails.amountInr || item.monthlyPriceInr || 0),
        note: donationDetails.note.trim(),
      });
      setSelectedAddOnId("");
      await load();
      setMessage(`${item.name} donation transaction recorded. ${
        result.rootEmailSent ? "SambitR has been emailed for verification." : "It is visible in SambitR's verification queue."
      } Access remains locked until approval.`);
    } catch (err) {
      setMessage(err?.message || "Could not submit the add-on donation.");
    } finally {
      setDonationSubmitting(false);
    }
  }

  function beginAddOnDonation(item) {
    setSelectedAddOnId(item.id);
    setDonationDetails({
      upiTransactionNumber: "",
      payerName: "",
      payerPhone: "",
      payerEmail: "",
      amountInr: String(item.monthlyPriceInr || ""),
      note: "",
    });
  }

  if (loading) {
    return (
      <div className="grid min-h-[420px] place-items-center">
        <div className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-slate-600 shadow-sm ring-1 ring-slate-200">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subscriptions
        </div>
      </div>
    );
  }

  return (
    <main className="space-y-6">
      <TenantStorageUsage />
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100">
              <Sparkles className="h-3.5 w-3.5" /> Beta tenant
            </div>
            <h1 className="mt-3 text-3xl font-black text-slate-950">Subscriptions</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {data?.tenant?.name || "Current church"} package access and tenant URL.
            </p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {tenantUrl && (
          <div className="mt-5 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Published tenant URL</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="break-all text-sm font-bold text-slate-800">{tenantUrl}</code>
              <button type="button" onClick={copyTenantUrl} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white">
                <Copy className="h-4 w-4" /> Copy
              </button>
            </div>
          </div>
        )}

        {message && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800 ring-1 ring-amber-100">{message}</div>}
      </section>

      {isIndia ? <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[150px_1fr] md:items-center">
          <img src={QR_URL} alt="UPI donation QR" className="h-36 w-36 rounded-lg border border-emerald-100 bg-white object-contain p-2" />
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100">
              <QrCode className="h-3.5 w-3.5" /> Welfare Donation
            </div>
            <h2 className="mt-3 text-xl font-black text-emerald-950">Donate by UPI QR</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-emerald-800">
              Monthly SAAS contributions are received as donations to the welfare society account. Scan the QR and share the UPI reference with Mahima admin for reconciliation and activation.
            </p>
            {donationIntent && (
              <div className="mt-4 rounded-lg bg-white p-4 text-sm font-bold text-slate-700 ring-1 ring-emerald-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wide text-emerald-800">Selected donation</div>
                    <div className="mt-1 text-base font-black text-slate-950">
                      {donationIntent.moduleName || donationIntent.moduleCode}: {money(donationIntent.amountInr)}
                    </div>
                  </div>
                  {donationIntent.status === "submitted" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-sky-800 ring-1 ring-sky-100">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
                    </span>
                  )}
                </div>
                <form onSubmit={submitDonationReceipt} className="mt-4 grid gap-3 lg:grid-cols-2">
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                    UPI Transaction Number
                    <input value={donationDetails.upiTransactionNumber} onChange={(event) => updateDonationDetails("upiTransactionNumber", event.target.value)} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal outline-none ring-emerald-100 focus:ring-4" />
                  </label>
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Name
                    <input value={donationDetails.payerName} onChange={(event) => updateDonationDetails("payerName", event.target.value)} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal outline-none ring-emerald-100 focus:ring-4" />
                  </label>
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Phone
                    <input value={donationDetails.payerPhone} onChange={(event) => updateDonationDetails("payerPhone", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal outline-none ring-emerald-100 focus:ring-4" />
                  </label>
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Email
                    <input type="email" value={donationDetails.payerEmail} onChange={(event) => updateDonationDetails("payerEmail", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal outline-none ring-emerald-100 focus:ring-4" />
                  </label>
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Amount
                    <input type="number" min="1" value={donationDetails.amountInr} onChange={(event) => updateDonationDetails("amountInr", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal outline-none ring-emerald-100 focus:ring-4" />
                  </label>
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500 lg:col-span-2">
                    Notes
                    <textarea value={donationDetails.note} onChange={(event) => updateDonationDetails("note", event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal outline-none ring-emerald-100 focus:ring-4" />
                  </label>
                  <div className="lg:col-span-2">
                    <button type="submit" disabled={donationSubmitting || donationIntent.status === "submitted"} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
                      {donationSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Upload UPI Payment Details
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </section> : <section className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-950 to-slate-950 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-indigo-100"><Mail className="h-4 w-4"/> International subscription</div><h2 className="mt-3 text-2xl font-black">Activate a paid subscription</h2><p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-indigo-100">In order to activate your paid subscriptions, please write to us at <a className="font-black text-white underline" href="mailto:contact@mahimaministries.in">contact@mahimaministries.in</a>.</p></div>
          <div className="rounded-xl bg-white/10 px-4 py-3 text-sm font-bold"><div className="text-xs uppercase tracking-wide text-indigo-200">Payment region</div><div className="mt-1">International · {countryCode}</div></div>
        </div>
      </section>}

      {packages.length > 0 && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
          <h2 className="text-xl font-black text-indigo-950">Base plan and add-ons</h2>
          <p className="mt-1 text-sm font-semibold text-indigo-700">Base Free is always included. Add or manage each optional package independently.</p>
          {baseModule && (
            <article className="mt-4 rounded-lg border border-emerald-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Included foundation</div>
                  <h3 className="mt-1 font-black text-slate-950">{baseModule.name || baseModule.Name || "Base Free"}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{baseModule.description || baseModule.Description}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-black uppercase text-emerald-800">Always active · Free</span>
              </div>
            </article>
          )}
          <h3 className="mt-5 text-sm font-black uppercase tracking-wide text-indigo-900">Optional add-ons</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {packages.map((item) => (
              <article key={item.id} className="rounded-lg border border-indigo-100 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black text-slate-950">{item.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${item.active ? "bg-emerald-100 text-emerald-800" : "bg-indigo-100 text-indigo-800"}`}>
                    {item.addOnState === "active" ? "Active add-on" :
                      item.addOnState === "suspended" ? "Suspended" :
                      item.addOnState === "payment_pending" ? "Verification pending" :
                      item.addOnState === "payment_rejected" ? "Payment rejected" :
                      "Available add-on"}
                  </span>
                </div>
                {isIndia && <div className="mt-3 text-base font-black text-indigo-800">Rs {Number(item.monthlyPriceInr || 0).toLocaleString("en-IN")}/mo</div>}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                  <div className="rounded-lg bg-slate-50 p-2"><span className="block text-[10px] uppercase text-slate-400">Data growth</span>{Number(item.storageLimitGb || 0).toLocaleString()} GB included</div>
                  <div className="rounded-lg bg-slate-50 p-2"><span className="block text-[10px] uppercase text-slate-400">AI allowance</span>₹{Number(item.aiCreditsIncludedInr || 0).toLocaleString()} credits/mo</div>
                </div>
                <p className="mt-2 text-[11px] font-bold text-slate-500">Storage growth stops at your allowance. Delete unused data or upgrade your package to continue.</p>
                {item.active && (
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Current version: v{item.currentVersion || item.version}
                    {item.contractEndsAtUtc ? ` · Contract ends ${new Date(item.contractEndsAtUtc).toLocaleDateString()}` : ""}
                  </p>
                )}
                {item.upgradePending && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-black text-amber-900">Version {item.version} requires your approval</p>
                    <p className="mt-1 text-xs font-semibold text-amber-800">Accept to apply the new features and price immediately with pro-rata billing, or stay on your current version.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={busyModule === `package-${item.id}`} onClick={() => decideVersion(item, true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-60">Accept upgrade</button>
                      <button type="button" disabled={busyModule === `package-${item.id}`} onClick={() => decideVersion(item, false)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-60">Stay on v{item.currentVersion}</button>
                    </div>
                  </div>
                )}
                {item.active && item.subscriptionId && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button type="button" disabled={busyModule === `package-${item.id}`} onClick={() => changeSubscription(item, "suspend")} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-60">Suspend</button>
                    <button type="button" disabled={busyModule === `package-${item.id}`} onClick={() => changeSubscription(item, "terminate")} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-60">Terminate</button>
                  </div>
                )}
                {item.subscriptionStatus === "suspended" && item.subscriptionId && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <button type="button" disabled={busyModule === `package-${item.id}`} onClick={() => changeSubscription(item, "resume")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-60">Resume subscription</button>
                  </div>
                )}
                {item.addOnState === "payment_pending" && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-black text-amber-900">
                    {isIndia ? "UPI donation submitted · Awaiting SambitR verification" : "Stripe payment submitted · Awaiting confirmation"}
                  </div>
                )}
                {(item.addOnState === "available" || item.addOnState === "payment_rejected") && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    {item.paymentStatus === "rejected" && <p className="mb-2 text-xs font-bold text-rose-700">The previous payment was rejected. Please submit a new payment.</p>}
                    {isIndia ? <button type="button" onClick={() => beginAddOnDonation(item)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white">Donate by UPI & request activation</button> : <a href="mailto:contact@mahimaministries.in?subject=Paid%20subscription%20activation" className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-black text-white"><Mail size={15}/> Write to us</a>}
                  </div>
                )}
                {isIndia && selectedAddOnId === item.id && (
                  <form onSubmit={(event) => submitAddOnPayment(event, item)} className="mt-3 grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <input required value={donationDetails.upiTransactionNumber} onChange={(event) => updateDonationDetails("upiTransactionNumber", event.target.value)} placeholder="UPI transaction/reference number" className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold" />
                    <input required value={donationDetails.payerName} onChange={(event) => updateDonationDetails("payerName", event.target.value)} placeholder="Payer name" className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input value={donationDetails.payerPhone} onChange={(event) => updateDonationDetails("payerPhone", event.target.value)} placeholder="Phone" className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold" />
                      <input type="email" value={donationDetails.payerEmail} onChange={(event) => updateDonationDetails("payerEmail", event.target.value)} placeholder="Email" className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold" />
                    </div>
                    <input required type="number" min="1" value={donationDetails.amountInr} onChange={(event) => updateDonationDetails("amountInr", event.target.value)} placeholder="Donation amount" className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold" />
                    <textarea value={donationDetails.note} onChange={(event) => updateDonationDetails("note", event.target.value)} placeholder="Optional note" rows={2} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={donationSubmitting} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-60">
                        {donationSubmitting ? "Submitting..." : "Record transaction"}
                      </button>
                      <button type="button" onClick={() => setSelectedAddOnId("")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black">Cancel</button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {packages.length === 0 && <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => {
          const licensed = Boolean(module.licensed ?? module.Licensed);
          const pendingRequest = Boolean(module.pendingRequest ?? module.PendingRequest);
          const isFree = Boolean(module.isBaseModule ?? module.IsBaseModule) || Number(module.monthlyPriceInr || module.MonthlyPriceInr || 0) === 0;
          const code = module.code || module.Code;
          return (
            <article key={code} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">{isFree ? "Free essentials" : "Donation package"}</div>
                  <h2 className="mt-2 text-xl font-black text-slate-950">{module.name || module.Name}</h2>
                </div>
                {licensed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800 ring-1 ring-emerald-100">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Active
                  </span>
                ) : pendingRequest ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800 ring-1 ring-amber-100">
                    <RefreshCw className="h-3.5 w-3.5" /> Requested
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                    <Lock className="h-3.5 w-3.5" /> Locked
                  </span>
                )}
              </div>
              <p className="mt-3 min-h-16 text-sm leading-6 text-slate-600">{module.description || module.Description}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                {isIndia && <div className="text-lg font-black text-slate-950">
                  {isFree ? "Free" : `Rs ${module.monthlyPriceInr || module.MonthlyPriceInr}/mo`}
                </div>}
                {!licensed && !isFree && (
                  <button type="button" disabled={busyModule === code || pendingRequest} onClick={() => donateForModule({ ...module, code, name: module.name || module.Name })} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-black text-white disabled:opacity-60">
                    {busyModule === code ? <Loader2 className="h-4 w-4 animate-spin" /> : isIndia ? <QrCode className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    {pendingRequest ? "Requested" : isIndia ? "Donate via QR" : "Write to us"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>}
      {isIndia && <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950">Monthly Donation Invoices</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Read-only invoices generated by Mahima admin for your church.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[860px] w-full text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
              <tr className="text-left">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Packages</th>
                <th className="px-4 py-3 text-right">Total Donation</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">PDF</th>
              </tr>
            </thead>
            <tbody>
              {(invoiceData.items || []).length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center font-bold text-slate-500">No monthly invoices generated yet.</td></tr>
              ) : invoiceData.items.map((invoice) => (
                <tr key={invoice.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-4 font-black text-slate-900">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-4 text-xs font-semibold text-slate-500">{new Date(invoice.periodStartUtc).toLocaleDateString()} - {new Date(invoice.periodEndUtc).toLocaleDateString()}</td>
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
                  <td className="px-4 py-4 text-right font-black text-amber-700">{money(invoice.balanceInr)}</td>
                  <td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${invoice.status === "paid" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{invoice.status}</span></td>
                  <td className="px-4 py-4">
                    <button type="button" onClick={() => printDonationInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
    </main>
  );
}
