// Admin → Languages.
// Manages the application's language list used for UI translations and
// multi-language message broadcasts.
import React, { useEffect, useMemo, useState } from "react";
import {
  listAllLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  reorderLanguages,
  ISO_LANGUAGE_DIRECTORY,
} from "../../api/languagesApi";

export default function AdminLanguages() {
  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  function notifyPicker() {
    window.dispatchEvent(new CustomEvent("mahima:languages-updated"));
  }

  async function refresh() {
    setLoad(true);
    setError("");
    try {
      const data = await listAllLanguages();
      // sort by displayOrder then name
      data.sort((a, b) => (a.displayOrder - b.displayOrder) || a.name.localeCompare(b.name));
      setItems(data);
    } catch (e) {
      setError(String(e?.response?.data || e?.message || e));
    } finally {
      setLoad(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function toggleEnabled(row) {
    setBusy(true);
    try {
      await updateLanguage(row.code, { enabled: !row.enabled });
      await refresh();
      notifyPicker();
    } catch (e) {
      alert("Update failed: " + (e?.response?.data || e?.message));
    } finally { setBusy(false); }
  }

  async function makeDefault(row) {
    if (row.isDefault) return;
    setBusy(true);
    try {
      await updateLanguage(row.code, { isDefault: true });
      await refresh();
      notifyPicker();
    } catch (e) {
      alert("Update failed: " + (e?.response?.data || e?.message));
    } finally { setBusy(false); }
  }

  async function move(row, dir) {
    const idx = items.findIndex((i) => i.code === row.code);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= items.length) return;
    const next = items.slice();
    const tmp  = next[idx];
    next[idx]    = next[target];
    next[target] = tmp;
    // Re-index 10, 20, 30 ...
    const payload = next.map((it, i) => ({ code: it.code, displayOrder: (i + 1) * 10 }));
    setBusy(true);
    try {
      await reorderLanguages(payload);
      await refresh();
      notifyPicker();
    } catch (e) {
      alert("Reorder failed: " + (e?.response?.data || e?.message));
    } finally { setBusy(false); }
  }

  async function removeRow(row) {
    if (row.isDefault) {
      alert("Cannot delete the default language. Mark another as default first.");
      return;
    }
    if (!window.confirm(`Delete language "${row.name}" (${row.code})?`)) return;
    setBusy(true);
    try {
      await deleteLanguage(row.code);
      await refresh();
      notifyPicker();
    } catch (e) {
      alert("Delete failed: " + (e?.response?.data || e?.message));
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Languages</h1>
          <p className="text-gray-600 text-sm">
            Manage the languages available across the Mahima app. Enabled languages appear in the
            user&apos;s language switcher and are used by the message center to translate broadcasts.
          </p>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={() => setShowAdd(true)}
          disabled={busy}
        >
          + Add Language
        </button>
      </header>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded border border-red-200">{error}</div>}
      {loading && <div className="text-gray-500">Loading…</div>}

      {!loading && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left text-sm">
              <th className="p-2 border">Order</th>
              <th className="p-2 border">Code</th>
              <th className="p-2 border">Name</th>
              <th className="p-2 border">Native</th>
              <th className="p-2 border text-center">Enabled</th>
              <th className="p-2 border text-center">Default</th>
              <th className="p-2 border text-center">RTL</th>
              <th className="p-2 border text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, idx) => (
              <tr key={row.code} className="text-sm">
                <td className="p-2 border w-24">
                  <div className="flex gap-1">
                    <button className="px-2 border rounded" onClick={() => move(row, -1)} disabled={busy || idx === 0}>↑</button>
                    <button className="px-2 border rounded" onClick={() => move(row, +1)} disabled={busy || idx === items.length - 1}>↓</button>
                  </div>
                </td>
                <td className="p-2 border font-mono">{row.code}</td>
                <td className="p-2 border">{row.name}</td>
                <td className="p-2 border">{row.nativeName}</td>
                <td className="p-2 border text-center">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={() => toggleEnabled(row)}
                    disabled={busy || row.isDefault}
                    title={row.isDefault ? "Default language is always enabled" : ""}
                  />
                </td>
                <td className="p-2 border text-center">
                  <input
                    type="radio"
                    name="defaultLang"
                    checked={row.isDefault}
                    onChange={() => makeDefault(row)}
                    disabled={busy}
                  />
                </td>
                <td className="p-2 border text-center">{row.rtl ? "Yes" : "No"}</td>
                <td className="p-2 border text-right">
                  <button
                    className="px-2 py-1 text-blue-700 hover:underline disabled:text-gray-400"
                    onClick={() => setEditing(row)}
                    disabled={busy}
                  >Edit</button>
                  <button
                    className="px-2 py-1 text-red-600 hover:underline disabled:text-gray-400"
                    onClick={() => removeRow(row)}
                    disabled={busy || row.isDefault}
                  >Delete</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td className="p-4 text-gray-500 text-center" colSpan={8}>No languages configured.</td></tr>
            )}
          </tbody>
        </table>
      )}

      <p className="text-xs text-gray-500">
        Disabling a language hides it from the language picker and excludes it from automatic message
        translations. Existing messages already translated into that language are preserved.
      </p>

      {showAdd && (
        <AddLanguageModal
          existingCodes={items.map((i) => i.code)}
          onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); await refresh(); notifyPicker(); }}
        />
      )}
      {editing && (
        <EditLanguageModal
          language={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); notifyPicker(); }}
        />
      )}
    </div>
  );
}

function EditLanguageModal({ language, onClose, onSaved }) {
  const [name, setName] = useState(language.name || "");
  const [nativeName, setNativeName] = useState(language.nativeName || "");
  const [rtl, setRtl] = useState(Boolean(language.rtl));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim() || !nativeName.trim()) { setError("Name and native name are required."); return; }
    setSaving(true);
    setError("");
    try {
      await updateLanguage(language.code, { name: name.trim(), nativeName: nativeName.trim(), rtl });
      await onSaved();
    } catch (e) {
      setError(String(e?.response?.data?.message || e?.response?.data || e?.message || e));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg max-w-md w-full p-6 space-y-4" role="dialog" aria-modal="true">
        <h2 className="text-xl font-semibold">Edit Language</h2>
        <p className="text-sm text-gray-500">Code: <span className="font-mono">{language.code}</span></p>
        <label className="block"><span className="text-sm text-gray-600">English name</span>
          <input className="mt-1 w-full border rounded px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="block"><span className="text-sm text-gray-600">Native name</span>
          <input className="mt-1 w-full border rounded px-2 py-1" value={nativeName} onChange={(e) => setNativeName(e.target.value)} maxLength={80} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rtl} onChange={(e) => setRtl(e.target.checked)} /> Right-to-left layout</label>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1 border rounded" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

function AddLanguageModal({ existingCodes, onClose, onSaved }) {
  const directory = useMemo(
    () => ISO_LANGUAGE_DIRECTORY.filter((d) => !existingCodes.includes(d.code)),
    [existingCodes]
  );
  const [pickerCode, setPickerCode] = useState(directory[0]?.code || "");
  const [customCode, setCustomCode] = useState("");
  const [name, setName]             = useState("");
  const [nativeName, setNative]     = useState("");
  const [rtl, setRtl]               = useState(false);
  const [enabled, setEnabled]       = useState(true);
  const [isDefault, setIsDefault]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [mode, setMode]             = useState("picker"); // 'picker' | 'custom'

  function onPickerChange(code) {
    setPickerCode(code);
    const entry = ISO_LANGUAGE_DIRECTORY.find((d) => d.code === code);
    if (entry) {
      setName(entry.name);
      setNative(entry.nativeName);
      setRtl(entry.rtl);
    }
  }

  // initial sync
  useEffect(() => {
    if (mode === "picker" && pickerCode) onPickerChange(pickerCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function save() {
    const code = (mode === "picker" ? pickerCode : customCode).trim().toLowerCase();
    if (!code) { setError("Code is required."); return; }
    if (!name.trim() || !nativeName.trim()) { setError("Name and native name are required."); return; }
    setSaving(true);
    setError("");
    try {
      await createLanguage({
        code,
        name: name.trim(),
        nativeName: nativeName.trim(),
        rtl,
        enabled,
        isDefault,
        displayOrder: 1000, // append; admin can reorder afterwards
      });
      await onSaved();
    } catch (e) {
      setError(String(e?.response?.data || e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg max-w-md w-full p-6 space-y-4">
        <h2 className="text-xl font-semibold">Add Language</h2>

        <div className="flex gap-2 text-sm">
          <button
            className={`px-3 py-1 rounded ${mode === "picker" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            onClick={() => setMode("picker")}
          >From list</button>
          <button
            className={`px-3 py-1 rounded ${mode === "custom" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            onClick={() => setMode("custom")}
          >Custom code</button>
        </div>

        {mode === "picker" ? (
          <label className="block">
            <span className="text-sm text-gray-600">Language</span>
            <select
              className="mt-1 w-full border rounded px-2 py-1"
              value={pickerCode}
              onChange={(e) => onPickerChange(e.target.value)}
            >
              {directory.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name} — {d.nativeName} ({d.code})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-sm text-gray-600">ISO code (e.g. pt-BR)</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1 font-mono"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              maxLength={8}
              placeholder="e.g. pt-BR"
            />
          </label>
        )}

        <label className="block">
          <span className="text-sm text-gray-600">English name</span>
          <input className="mt-1 w-full border rounded px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="block">
          <span className="text-sm text-gray-600">Native name</span>
          <input className="mt-1 w-full border rounded px-2 py-1" value={nativeName} onChange={(e) => setNative(e.target.value)} />
        </label>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled}   onChange={(e) => setEnabled(e.target.checked)} /> Enabled
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Set as default
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rtl}       onChange={(e) => setRtl(e.target.checked)} /> RTL
          </label>
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <div className="flex justify-end gap-2">
          <button className="px-3 py-1 border rounded" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
