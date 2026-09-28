import React from "react";
import { Loader2, Plus, Trash2, UploadCloud } from "lucide-react";

export const FONT_OPTIONS = ["Inter", "Poppins", "Merriweather", "Playfair Display", "Nunito", "Lora"];

export function ColorField({ label, value, onChange }) {
  return (
    <label>
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1 flex rounded-lg border border-slate-200 bg-white">
        <input type="color" value={value || "#0f766e"} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 bg-transparent p-1" />
        <input value={value || ""} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 px-3 py-2 text-sm font-medium outline-none" />
      </div>
    </label>
  );
}

export function FontField({ label, value, onChange }) {
  return (
    <label>
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value || "Inter"} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500">
        {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
      </select>
    </label>
  );
}

export function TextField({ label, value, onChange, required = false, placeholder }) {
  return (
    <label className="min-w-0">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

export function TextAreaField({ label, value, onChange, rows = 3 }) {
  return (
    <label className="min-w-0 md:col-span-2">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <textarea
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

export function ImageUrlField({ label, value, onChange, onUpload, uploading = false, hint }) {
  return (
    <label className="min-w-0 max-w-full md:col-span-2">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {hint && <span className="ml-2 text-[11px] font-medium text-slate-400">{hint}</span>}
      <div className="mt-1 flex min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <input
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste image URL or upload"
          className="w-0 min-w-0 flex-1 truncate px-3 py-2 text-sm font-medium text-slate-900 outline-none"
        />
        <span className="relative inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 border-l border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload?.(file);
            }}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </span>
      </div>
    </label>
  );
}

export function SmallButton({ children, ...props }) {
  return (
    <button {...props} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
      {children}
    </button>
  );
}

export function AddItemButton({ label, onClick }) {
  return (
    <SmallButton type="button" onClick={onClick}>
      <Plus className="h-4 w-4" /> {label}
    </SmallButton>
  );
}

export function RemoveItemButton({ onClick, label = "Remove" }) {
  return (
    <button type="button" onClick={onClick} className="mt-5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700" aria-label={label}>
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

export function ItemCard({ children, onRemove }) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_auto]">
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
      <RemoveItemButton onClick={onRemove} />
    </div>
  );
}
