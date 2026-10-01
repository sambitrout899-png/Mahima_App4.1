import React, { useEffect, useState } from "react";
import { Music4, Plus, Trash2, Pencil, X, GripVertical, Mic2 } from "lucide-react";
import api from "../../api";
import { requireModuleResponse } from "../../utils/moduleContracts.mjs";

const ITEM_TYPES = ["song", "announcement", "sermon", "prayer", "offering", "other"];
const emptyItem = () => ({ itemType: "song", title: "", details: "", durationMinutes: "" });
const emptyForm = { id: null, title: "", serviceDate: "", notes: "", items: [] };

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data ?? err?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

export default function ServicePlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/service-plans", { notify: false });
      requireModuleResponse(res, "Could not load service plans.");
      setPlans(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load service plans."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() { setForm(emptyForm); setShowForm(true); }

  async function openEdit(planSummary) {
    try {
      const res = await api.get(`/service-plans/${planSummary.id}`, { notify: false });
      requireModuleResponse(res, "Could not load the plan.");
      const plan = res?.data?.plan || planSummary;
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      setForm({
        id: plan.id,
        title: plan.title || "",
        serviceDate: plan.serviceDate ? String(plan.serviceDate).slice(0, 10) : "",
        notes: plan.notes || "",
        items: items.map((i) => ({ itemType: i.itemType, title: i.title, details: i.details || "", durationMinutes: i.durationMinutes ?? "" })),
      });
      setShowForm(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load the plan."));
    }
  }

  function addItem() { setForm((f) => ({ ...f, items: [...f.items, emptyItem()] })); }
  function updateItem(idx, patch) {
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  }
  function removeItem(idx) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }
  function moveItem(idx, dir) {
    setForm((f) => {
      const items = [...f.items];
      const target = idx + dir;
      if (target < 0 || target >= items.length) return f;
      [items[idx], items[target]] = [items[target], items[idx]];
      return { ...f, items };
    });
  }

  async function save(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.serviceDate) { setError("Title and service date are required."); return; }
    setSaving(true);
    setError("");
    const payload = {
      title: form.title.trim(),
      serviceDate: form.serviceDate,
      notes: form.notes || null,
      items: form.items.map((i) => ({
        itemType: i.itemType, title: i.title.trim(), details: i.details || null,
        durationMinutes: i.durationMinutes === "" ? null : Number(i.durationMinutes),
      })),
    };
    try {
      const res = form.id
        ? await api.put(`/service-plans/${form.id}`, payload, { notify: false })
        : await api.post("/service-plans", payload, { notify: false });
      requireModuleResponse(res, "Could not save the service plan.");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the service plan."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this service plan?")) return;
    try {
      const res = await api.delete(`/service-plans/${id}`, { notify: false });
      requireModuleResponse(res, "Could not delete the plan.");
      await load();
    }
    catch (err) { setError(apiErrorMessage(err, "Could not delete the plan.")); }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Worship &amp; Service Planning</h1>
          <p className="text-sm text-slate-500">Run-sheets for each service: songs, sermon, prayer, and assignments.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          <Plus className="h-4 w-4" /> New Plan
        </button>
      </header>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading...</div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No service plans yet.</div>
      ) : (
        <div className="grid gap-2.5">
          {plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Music4 className="h-5 w-5" /></span>
                <div>
                  <div className="font-semibold text-slate-900">{p.title}</div>
                  <div className="text-xs text-slate-500">{formatDate(p.serviceDate)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => openEdit(p)} className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(p.id)} className="rounded-lg border border-rose-300 p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Edit Service Plan" : "New Service Plan"}</h2>
              <button type="button" onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Title (e.g. Sunday Worship Service)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                <input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} required />
              </div>
              <textarea className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

              <div className="mt-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">Run of service</h3>
                <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add item
                </button>
              </div>

              <div className="mt-2 grid gap-2">
                {form.items.length === 0 && <p className="text-xs text-slate-400">No items yet — add songs, sermon, prayer, offering...</p>}
                {form.items.map((item, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300"><GripVertical className="h-4 w-4" /></span>
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        value={item.itemType}
                        onChange={(e) => updateItem(idx, { itemType: e.target.value })}
                      >
                        {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        placeholder="Item title (e.g. song name, sermon topic)"
                        value={item.title}
                        onChange={(e) => updateItem(idx, { title: e.target.value })}
                      />
                      <input
                        type="number" min="0"
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        placeholder="min"
                        value={item.durationMinutes}
                        onChange={(e) => updateItem(idx, { durationMinutes: e.target.value })}
                      />
                      <button type="button" onClick={() => moveItem(idx, -1)} className="text-slate-400 hover:text-slate-700">▲</button>
                      <button type="button" onClick={() => moveItem(idx, 1)} className="text-slate-400 hover:text-slate-700">▼</button>
                      <button type="button" onClick={() => removeItem(idx)} className="text-rose-500 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <input
                      className="mt-1.5 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      placeholder="Details / who's leading"
                      value={item.details}
                      onChange={(e) => updateItem(idx, { details: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60">
                <Mic2 className="h-4 w-4" /> {saving ? "Saving..." : "Save Plan"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
