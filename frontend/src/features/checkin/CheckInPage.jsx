import React, { useEffect, useState } from "react";
import { Baby, Phone, ShieldCheck, LogOut, Plus, X, History } from "lucide-react";
import api from "../../api";
import { checkInPayload, requireModuleResponse } from "../../utils/moduleContracts.mjs";

const emptyForm = { childName: "", childDob: "", guardianName: "", guardianPhone: "", allergyNotes: "", generalNotes: "" };

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data ?? err?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function CheckInPage() {
  const [tab, setTab] = useState("active");
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState(null);
  const [checkoutCode, setCheckoutCode] = useState("");
  const [lastIssuedCode, setLastIssuedCode] = useState(null);

  async function loadActive() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/checkin/active", { notify: false });
      requireModuleResponse(res, "Could not load checked-in children.");
      setActive(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load checked-in children."));
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/checkin/history", { notify: false });
      requireModuleResponse(res, "Could not load check-in history.");
      setHistory(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load check-in history."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "active") loadActive();
    else loadHistory();
  }, [tab]);

  async function submitCheckIn(e) {
    e.preventDefault();
    if (!form.childName.trim() || !form.guardianName.trim()) {
      setError("Child name and guardian name are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/checkin", checkInPayload(form), { notify: false });
      requireModuleResponse(res, "Could not check in the child.");
      setShowForm(false);
      setForm(emptyForm);
      setLastIssuedCode(res?.data?.securityCode || null);
      setTab("active");
      await loadActive();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not check in the child."));
    } finally {
      setSaving(false);
    }
  }

  async function submitCheckOut(e) {
    e.preventDefault();
    if (!checkoutTarget) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.post(`/checkin/${checkoutTarget.id}/checkout`, { securityCode: checkoutCode.trim() }, { notify: false });
      requireModuleResponse(res, "Security code did not match.");
      setCheckoutTarget(null);
      setCheckoutCode("");
      await loadActive();
    } catch (err) {
      setError(apiErrorMessage(err, "Security code did not match."));
    } finally {
      setSaving(false);
    }
  }

  const list = tab === "active" ? active : history;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Child Check-In</h1>
          <p className="text-sm text-slate-500">Guardian-matched check-in and check-out for kids ministry.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          <Plus className="h-4 w-4" /> Check In Child
        </button>
      </header>

      {lastIssuedCode && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            Security code <strong className="font-mono text-lg">{lastIssuedCode}</strong> — give this to the guardian; it's required at pick-up.
          </span>
          <button onClick={() => setLastIssuedCode(null)} className="text-emerald-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab("active")}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "active" ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Currently Checked In
        </button>
        <button
          onClick={() => setTab("history")}
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "history" ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          <History className="h-3.5 w-3.5" /> Today's History
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading...</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {tab === "active" ? "No children currently checked in." : "No check-ins recorded today."}
        </div>
      ) : (
        <div className="grid gap-2.5">
          {list.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Baby className="h-5 w-5" /></span>
                <div>
                  <div className="font-semibold text-slate-900">{c.childName}</div>
                  <div className="text-xs text-slate-500">
                    Guardian: {c.guardianName} {c.guardianPhone && <span className="inline-flex items-center gap-1 ml-1"><Phone className="h-3 w-3" />{c.guardianPhone}</span>}
                  </div>
                  {c.allergyNotes && <div className="mt-0.5 text-xs font-semibold text-amber-700">Allergy: {c.allergyNotes}</div>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>In: {formatTime(c.checkedInAtUtc)}</span>
                {c.checkedOutAtUtc ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Picked up {formatTime(c.checkedOutAtUtc)}</span>
                ) : tab === "active" ? (
                  <button
                    onClick={() => setCheckoutTarget(c)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2.5 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-50"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Check Out
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitCheckIn} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Check In Child</h2>
              <button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3">
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Child name" value={form.childName} onChange={(e) => setForm({ ...form, childName: e.target.value })} required />
              <input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Date of birth" value={form.childDob} onChange={(e) => setForm({ ...form, childDob: e.target.value })} />
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Guardian name" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} required />
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Guardian phone" value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} />
              <input className="rounded-lg border border-amber-300 px-3 py-2 text-sm" placeholder="Allergy notes (if any)" value={form.allergyNotes} onChange={(e) => setForm({ ...form, allergyNotes: e.target.value })} />
              <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Other notes" rows={2} value={form.generalNotes} onChange={(e) => setForm({ ...form, generalNotes: e.target.value })} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving..." : "Check In"}</button>
            </div>
          </form>
        </div>
      )}

      {checkoutTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitCheckOut} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900"><ShieldCheck className="h-5 w-5 text-emerald-700" /> Verify pick-up</div>
            <p className="mb-3 text-sm text-slate-600">Enter the security code from the guardian's claim ticket to release <strong>{checkoutTarget.childName}</strong>.</p>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest"
              placeholder="0000"
              maxLength={4}
              value={checkoutCode}
              onChange={(e) => setCheckoutCode(e.target.value)}
              required
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCheckoutTarget(null)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Checking..." : "Confirm Check Out"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
