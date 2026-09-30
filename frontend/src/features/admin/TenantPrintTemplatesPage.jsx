import React, { useEffect, useState } from "react";
import { FileText, Loader2, Save, UploadCloud } from "lucide-react";
import { API_BASE } from "../../api";
import { getToken } from "../../utils/auth";
import { getTenantPrintTemplate, saveTenantPrintTemplate } from "../../api/multiTenantApi";
import TenantLogo from "../../components/TenantLogo";

const defaults = {
  organizationName: "Church", logoUrl: "", address: "", phone: "", email: "",
  registrationNumber: "", taxNumber: "", headerText: "", footerText: "This document is system generated.",
  primaryColor: "#047857", showLogo: true, showAddress: true, showPageNumbers: true,
  paperSize: "A4", orientation: "portrait",
  signatureUrl: "", signatoryName: "", signatoryTitle: "",
};

export default function TenantPrintTemplatesPage() {
  const [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getTenantPrintTemplate()
      .then((data) => setForm({ ...defaults, ...(data || {}) }))
      .catch((e) => setMessage(e?.message || "Could not load settings."))
      .finally(() => setBusy(false));
  }, []);

  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));

  async function uploadImage(file, field, label) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_BASE}/uploads`, {
        method: "POST", body, credentials: "include",
        headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      set(field, data?.url || data?.absoluteUrl || "");
      setMessage(`${label} uploaded. Save the template to apply it.`);
    } catch (e) {
      setMessage(e?.message || `${label} upload failed.`);
    } finally { setUploading(false); }
  }

  const uploadLogo = (file) => uploadImage(file, "logoUrl", "Logo");
  const uploadSignature = (file) => uploadImage(file, "signatureUrl", "Signature");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveTenantPrintTemplate(form);
      setForm({ ...defaults, ...saved });
      window.__mahimaPrintTemplate = saved;
      window.dispatchEvent(new CustomEvent("mahima:print-template-changed", { detail: saved }));
      setMessage("Print and report template saved for this tenant.");
    } catch (e) {
      setMessage(e?.message || "Could not save settings.");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full bg-slate-50 p-4 sm:p-6">
      <form onSubmit={submit} className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><FileText className="h-5 w-5" /></span>
              <div><h1 className="text-xl font-black text-slate-900">Print & Report Templates</h1><p className="text-sm text-slate-500">Tenant-wide identity for PDFs, reports, certificates and printouts.</p></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Organization name" value={form.organizationName} onChange={(v) => set("organizationName", v)} required />
              <Field label="Header text" value={form.headerText} onChange={(v) => set("headerText", v)} placeholder="Optional ministry motto" />
              <Field label="Email" value={form.email} onChange={(v) => set("email", v)} />
              <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
              <Field label="Registration number" value={form.registrationNumber} onChange={(v) => set("registrationNumber", v)} />
              <Field label="Tax / PAN / GST number" value={form.taxNumber} onChange={(v) => set("taxNumber", v)} />
              <label className="md:col-span-2 text-sm font-bold text-slate-700">Address<textarea value={form.address || ""} onChange={(e) => set("address", e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
              <Field label="Footer text" value={form.footerText} onChange={(v) => set("footerText", v)} />
              <label className="text-sm font-bold text-slate-700">Brand color<input type="color" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 p-1" /></label>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-black text-slate-900">Page format</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Paper size" value={form.paperSize} onChange={(v) => set("paperSize", v)} options={["A4", "Letter"]} />
              <Select label="Orientation" value={form.orientation} onChange={(v) => set("orientation", v)} options={["portrait", "landscape"]} />
            </div>
            <div className="mt-4 flex flex-wrap gap-4">
              <Check label="Show logo" checked={form.showLogo} onChange={(v) => set("showLogo", v)} />
              <Check label="Show address" checked={form.showAddress} onChange={(v) => set("showAddress", v)} />
              <Check label="Show page numbers" checked={form.showPageNumbers} onChange={(v) => set("showPageNumbers", v)} />
            </div>
          </section>
          <div className="flex items-center gap-3">
            <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save template</button>
            {message && <span className="text-sm font-semibold text-slate-600">{message}</span>}
          </div>
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-black text-slate-900">Logo</h2>
            <div className="flex items-center gap-4">
              <TenantLogo src={form.logoUrl} name={form.organizationName} className="h-24 w-24 rounded-xl" />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"><UploadCloud className="h-4 w-4" />{uploading ? "Uploading…" : "Upload logo"}<input type="file" accept="image/*" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} /></label>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-black text-slate-900">Authorized signatory</h2>
            <p className="mb-3 text-xs text-slate-500">Stored here once and reused automatically on every generated appointment letter - no need to re-upload each time.</p>
            <div className="flex items-center gap-4 mb-4">
              {form.signatureUrl ? (
                <img src={form.signatureUrl} alt="Signature" className="h-16 max-w-[160px] object-contain" />
              ) : (
                <div className="h-16 w-40 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">No signature yet</div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"><UploadCloud className="h-4 w-4" />{uploading ? "Uploading…" : "Upload signature"}<input type="file" accept="image/*" hidden onChange={(e) => uploadSignature(e.target.files?.[0])} /></label>
            </div>
            <div className="grid gap-3">
              <Field label="Signatory name" value={form.signatoryName} onChange={(v) => set("signatoryName", v)} placeholder="e.g. Sambit Rout" />
              <Field label="Signatory title" value={form.signatoryTitle} onChange={(v) => set("signatoryTitle", v)} placeholder="e.g. President, Mahima Welfare Society" />
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-black text-slate-900">Live header preview</h2>
            <div className="border-b-2 pb-4" style={{ borderColor: form.primaryColor }}>
              <div className="flex items-center gap-3">
                {form.showLogo && <TenantLogo src={form.logoUrl} name={form.organizationName} className="h-16 w-16 rounded-lg" />}
                <div><div className="text-lg font-black" style={{ color: form.primaryColor }}>{form.organizationName}</div><div className="text-xs text-slate-500">{form.headerText}</div>{form.showAddress && <div className="text-xs text-slate-500">{form.address}</div>}</div>
              </div>
            </div>
            <div className="py-10 text-center text-sm text-slate-400">Report content</div>
            <div className="border-t pt-3 text-xs text-slate-500">{form.footerText}</div>
          </section>
        </aside>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, ...props }) { return <label className="text-sm font-bold text-slate-700">{label}<input value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" {...props} /></label>; }
function Select({ label, value, onChange, options }) { return <label className="text-sm font-bold text-slate-700">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal">{options.map((x) => <option key={x}>{x}</option>)}</select></label>; }
function Check({ label, checked, onChange }) { return <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />{label}</label>; }
