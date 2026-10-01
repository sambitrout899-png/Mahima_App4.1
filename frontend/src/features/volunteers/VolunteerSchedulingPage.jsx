import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, Pencil, X, Users } from "lucide-react";
import api from "../../api";
import { apiTime, requireModuleResponse } from "../../utils/moduleContracts.mjs";

const emptyForm = { id: null, title: "", notes: "", shiftDate: "", startTime: "", endTime: "", slotsNeeded: 1 };

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data ?? err?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem("mahima_user") || "null"); } catch { return null; }
}

function isAdminOrStaff(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "staff";
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function VolunteerSchedulingPage() {
  const user = useMemo(() => currentUser(), []);
  const canManage = isAdminOrStaff(user);

  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/volunteer-shifts", { notify: false });
      requireModuleResponse(res, "Could not load volunteer shifts.");
      setShifts(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load volunteer shifts."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() { setForm(emptyForm); setShowForm(true); }
  function openEdit(s) {
    setForm({
      id: s.id, title: s.title || "", notes: s.notes || "",
      shiftDate: s.shiftDate ? String(s.shiftDate).slice(0, 10) : "",
      startTime: s.startTime ? String(s.startTime).slice(0, 5) : "",
      endTime: s.endTime ? String(s.endTime).slice(0, 5) : "",
      slotsNeeded: s.slotsNeeded || 1,
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.shiftDate) { setError("Title and date are required."); return; }
    setSaving(true);
    setError("");
    const payload = {
      title: form.title.trim(), notes: form.notes || null, shiftDate: form.shiftDate,
      startTime: apiTime(form.startTime), endTime: apiTime(form.endTime),
      slotsNeeded: Math.max(1, Number(form.slotsNeeded) || 1),
    };
    try {
      const res = form.id
        ? await api.put(`/volunteer-shifts/${form.id}`, payload, { notify: false })
        : await api.post("/volunteer-shifts", payload, { notify: false });
      requireModuleResponse(res, "Could not save the shift.");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the shift."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this shift?")) return;
    try {
      const res = await api.delete(`/volunteer-shifts/${id}`, { notify: false });
      requireModuleResponse(res, "Could not delete the shift.");
      await load();
    }
    catch (err) { setError(apiErrorMessage(err, "Could not delete the shift.")); }
  }

  async function signUp(id) {
    try {
      const res = await api.post(`/volunteer-shifts/${id}/signup`, undefined, { notify: false });
      requireModuleResponse(res, "Could not sign up.");
      await load();
    }
    catch (err) { setError(apiErrorMessage(err, "Could not sign up.")); }
  }

  async function cancelSignUp(id) {
    try {
      const res = await api.delete(`/volunteer-shifts/${id}/signup`, { notify: false });
      requireModuleResponse(res, "Could not cancel signup.");
      await load();
    }
    catch (err) { setError(apiErrorMessage(err, "Could not cancel signup.")); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Volunteer Scheduling</h1>
          <p className="text-sm text-slate-500">Sign up for open shifts, or manage the roster.</p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            <Plus className="h-4 w-4" /> New Shift
          </button>
        )}
      </header>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading...</div>
      ) : shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No shifts scheduled yet.</div>
      ) : (
        <div className="grid gap-2.5">
          {shifts.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div>
                <div className="font-semibold text-slate-900">{s.title}</div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatDate(s.shiftDate)}{s.startTime ? ` - ${String(s.startTime).slice(0, 5)}` : ""}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {s.signupCount}/{s.slotsNeeded} filled</span>
                </div>
                {s.notes && <div className="mt-1 text-xs text-slate-500">{s.notes}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                {s.iHaveSignedUp ? (
                  <button onClick={() => cancelSignUp(s.id)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel Signup</button>
                ) : (
                  <button onClick={() => signUp(s.id)} disabled={s.isFull} className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {s.isFull ? "Fully staffed" : "Sign Up"}
                  </button>
                )}
                {canManage && (
                  <>
                    <button onClick={() => openEdit(s)} className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(s.id)} className="rounded-lg border border-rose-300 p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Edit Shift" : "New Shift"}</h2>
              <button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3">
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Title (e.g. Sunday Ushering)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              <div className="grid grid-cols-3 gap-3">
                <input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.shiftDate} onChange={(e) => setForm({ ...form, shiftDate: e.target.value })} required />
                <input type="time" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                <input type="time" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
              <input type="number" min="1" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Volunteers needed" value={form.slotsNeeded} onChange={(e) => setForm({ ...form, slotsNeeded: e.target.value })} />
              <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving..." : "Save Shift"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
