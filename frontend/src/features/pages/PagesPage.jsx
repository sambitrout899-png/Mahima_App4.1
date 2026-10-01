// src/features/pages/PagesPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getToken } from "../auth/authService";

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Centralized fetch helper:
// - attaches auth (Bearer token from localStorage; adjust the key if you use something else)
// - sends credentials so cookie-based sessions also work
// - throws a clear error on non-2xx instead of failing later in r.json()
// - safely parses JSON only when there's a body
async function apiFetch(path, options = {}) {
  const token = getToken?.() || localStorage.getItem('mahima_token') || localStorage.getItem('authToken') || localStorage.getItem('token');
  const headers = {
    'Accept': 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: 'include', // remove if you don't use cookies
    ...options,
    headers,
  });

  if (resp.status === 401) {
    const err = new Error('Unauthorized — please log in again.');
    err.status = 401;
    // Optional: redirect to login automatically
    // window.location.assign('/#/login');
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(text || `HTTP ${resp.status} ${resp.statusText}`);
  }

  if (resp.status === 204) return null;
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server returned invalid JSON');
  }
}

function IconPage() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 3v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function PagesPage() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ key: "", title: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const json = (await apiFetch('/pages')) || {};
      setPages(json.items || json.data || []);
    } catch (err) {
      console.error("load pages error", err);
      setPages([]);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm({ key: "", title: "", description: "" }); setShow(true); };
  const openEdit = (p) => { setForm({ key: p.key, title: p.title, description: p.description || "" }); setShow(true); };

  const save = async (e) => {
    e?.preventDefault?.();
    if (!form.key || !form.title) return alert("Key and Title required.");
    setSaving(true);
    try {
      const isNew = !(pages.find(px => px.key === form.key));
      const path = isNew ? `/pages` : `/pages/${encodeURIComponent(form.key)}`;
      const method = isNew ? "POST" : "PUT";
      await apiFetch(path, {
        method,
        body: JSON.stringify({ Key: form.key, Title: form.title, Description: form.description })
      });
      setShow(false);
      await load();
    } catch (err) {
      alert("Save failed: " + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const del = async (key) => {
    if (!window.confirm("Delete page?")) return;
    try {
      await apiFetch(`/pages/${encodeURIComponent(key)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert("Delete failed: " + (err?.message || err));
    }
  };

  const filtered = useMemo(() => {
    if (!query) return pages;
    const s = query.toLowerCase();
    return pages.filter(p => `${p.title} ${p.key} ${p.description || ""}`.toLowerCase().includes(s));
  }, [pages, query]);

  /* ------------------- styles (mobile-first, dark-ready) ------------------- */
  const Styles = (
    <style>{`
      :root{
        --bg: linear-gradient(180deg, rgba(255,255,255,.96), rgba(246,248,251,.96));
        --muted: var(--enterprise-muted, #617086); --deep: var(--enterprise-ink, #102033); --accent: var(--enterprise-primary, #047857); --gold: var(--enterprise-primary, #047857); --card: var(--enterprise-surface, #ffffff);
        --shadow: var(--enterprise-shadow-sm, 0 1px 2px rgba(15,23,42,.05)); --radius: var(--enterprise-radius-lg, 12px);
        --safe-top: env(safe-area-inset-top); --safe-bottom: env(safe-area-inset-bottom);
      }
      @media(prefers-color-scheme:dark){
        :root{ --bg: linear-gradient(180deg,#0f172a,#111827); --muted:#cbd5e1; --deep:#f8fafc; --accent:#34d399; --card:rgba(15,23,42,0.92); }
      }
      .pages-wrap{ min-height:100vh; padding: max(8px,var(--safe-top)) 12px calc(64px + var(--safe-bottom)); background: var(--bg); font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: var(--deep); }
      /* Sticky header */
      .pages-header{ position:sticky; top:8px; z-index:40; display:flex; gap:10px; align-items:flex-start; padding:14px; border-radius: var(--radius); background: rgba(255,255,255,.94); box-shadow: var(--shadow); border:1px solid var(--enterprise-border, #dfe7ef); margin-bottom:10px; }
      .pages-title{ font-size:18px; font-weight:900; }
      .subtitle{ color:var(--muted); margin-top:4px; font-size:13px; }
      .search-row{ display:flex; gap:8px; width:100%; }
      .search{ padding:14px 12px; border-radius:12px; border:1px solid rgba(0,0,0,0.06); width:100%; font-size:15px; background:#fff; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
      .btn{ border:none; border-radius:12px; padding:12px 14px; font-weight:800; cursor:pointer; font-size:14px; display:inline-flex; align-items:center; gap:8px; }
      .btn-primary{ background: linear-gradient(180deg,var(--accent), var(--enterprise-primary-strong, #065f46)); color:#fff; box-shadow: 0 8px 20px rgba(4,120,87,0.18); }
      .btn-muted{ background:#fff; border:1px solid var(--enterprise-border, #dfe7ef); color:var(--deep); }
      .btn-danger{ background: linear-gradient(180deg,#e74c3c,#c0392b); color:#fff; }
      .grid{ display:grid; grid-template-columns:1fr; gap:10px; }
      .card{ background: var(--card); border-radius: var(--radius); padding:12px; box-shadow: var(--shadow); border:1px solid rgba(0,0,0,0.04); }
      .page-card{ background:#fff; border-radius:16px; padding:12px; box-shadow: 0 10px 28px rgba(14,22,34,0.08); border:1px solid rgba(0,0,0,0.04); display:grid; grid-template-columns:auto 1fr auto; gap:10px; }
      .icon-wrap{ width:48px; height:48px; border-radius:12px; display:grid; place-items:center; background: linear-gradient(180deg,#fff6e3,#fff1d6); color:#112b44; font-weight:900; }
      .page-title{ font-weight:900; font-size:16px; color:#112b44; display:flex; gap:8px; align-items:center; }
      .page-key{ color:#8a6a00; font-size:12px; font-weight:800; background: linear-gradient(180deg,#fff7e6,#fff0d6); padding:6px 10px; border-radius:999px; border:1px solid rgba(200,170,90,0.12); }
      .page-desc{ color:#6b5a46; font-size:13px; margin-top:4px; }
      .chip{ padding:6px 10px; border-radius:999px; background:#f8fafc; border:1px solid rgba(0,0,0,.06); font-size:12px; }
      .actions{ display:flex; gap:8px; align-items:center; }
      .icon-btn{ min-width:44px; min-height:44px; display:inline-flex; align-items:center; justify-content:center; border-radius:12px; border:1px solid rgba(0,0,0,0.06); background:#fff; }
      /* Skeletons */
      .skeleton{ background: linear-gradient(90deg, rgba(0,0,0,0.05), rgba(0,0,0,0.09), rgba(0,0,0,0.05)); background-size: 200% 100%; animation: shimmer 1.2s infinite; border-radius: 10px; }
      @keyframes shimmer { 0%{ background-position: 200% 0; } 100%{ background-position: -200% 0; } }
      /* Desktop table switch */
      @media(min-width: 980px){ .grid{ grid-template-columns: repeat(2, 1fr); } }
      @media(max-width: 720px){
        .pages-wrap{ padding: 10px 10px calc(84px + var(--safe-bottom)); }
        .pages-header{ position:relative; top:auto; flex-direction:column; align-items:stretch; padding:12px; }
        .pages-header > div{ min-width:0 !important; width:100%; }
        .search-row{ display:grid; grid-template-columns:1fr; }
        .page-card{ grid-template-columns:48px 1fr; align-items:start; }
        .page-card > .actions{ grid-column:1 / -1; justify-content:flex-end; }
        .page-title{ align-items:flex-start; flex-direction:column; gap:6px; }
        .fab{ right:12px; bottom:calc(12px + var(--safe-bottom)); }
        .modal-panel{ max-height:90dvh; }
      }
      /* FAB */
      .fab{ position: fixed; right: 16px; bottom: calc(18px + var(--safe-bottom)); z-index: 70; }
      /* Modal sheet */
      .modal-backdrop{ position:fixed; inset:0; background: rgba(8,6,4,0.45); display:flex; align-items:flex-end; justify-content:center; z-index:120; }
      .modal-panel{ width:100%; max-width:720px; background: linear-gradient(180deg,#fff,#fffdf8); padding:16px; border-radius:18px 18px 0 0; box-shadow: 0 18px 48px rgba(6,6,6,0.45); border:1px solid rgba(200,170,90,0.07); display:block; max-height:86vh; overflow:auto; }
      @media (min-width: 860px){ .modal-backdrop{ align-items:center; } .modal-panel{ border-radius: 18px; } }
      .form-row{ display:flex; gap:10px; flex-wrap:wrap; }
      .form-col{ flex:1 1 220px; min-width: 220px; }
      .form-col input{ width:100%; padding:12px; border-radius:12px; border:1px solid rgba(0,0,0,0.08); background:#fff; font-size:14px; }
      label{ display:block; font-size:12px; color:#6b5a46; font-weight:700; }
    `}</style>
  );

  /* ------------------- render ------------------- */
  return (
    <div className="pages-wrap">
      {Styles}
      {/* Header */}
      <div className="pages-header mahima-standard-page-header" data-mahima-explicit-header="true" role="region" aria-label="Pages header">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flex:1 }}>
          <div className="icon-wrap" aria-hidden>
            <IconPage />
          </div>
          <div>
            <h1 className="pages-title mahima-standard-page-title" data-mahima-explicit-title="true">Pages</h1>
            <div className="subtitle mahima-standard-page-subtitle">Manage which pages exist in the application and their descriptions.</div>
          </div>
        </div>
        <div style={{ minWidth: 260, flex:1 }}>
          <div className="search-row">
            <input className="search" placeholder="Search pages…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn btn-muted" onClick={() => { setQuery(""); }}>Clear</button>
            <button className="btn btn-muted" onClick={() => load()}>Refresh</button>
          </div>
        </div>
        <div className="actions" style={{ flexWrap:'wrap' }}>
          <button className="btn btn-primary" onClick={openAdd}>Add Page</button>
        </div>
      </div>

      {/* Content */}
      <div className="grid" role="list">
        {loading ? (
          [...Array(6)].map((_,i) => (
            <div key={i} className="page-card" aria-hidden>
              <div className="icon-wrap skeleton" />
              <div style={{ display:'grid', gap:8 }}>
                <div className="skeleton" style={{ height:16, width:'40%' }} />
                <div className="skeleton" style={{ height:12, width:'70%' }} />
                <div className="skeleton" style={{ height:12, width:'55%' }} />
              </div>
              <div className="skeleton" style={{ width:44, height:44, borderRadius:12 }} />
            </div>
          ))
        ) : error ? (
          <div className="card" style={{ color: '#b91c1c', fontWeight: 700 }}>{error}</div>
        ) : (
          <>
            {filtered.map(p => (
              <article className="page-card" key={p.key} role="listitem" aria-labelledby={`page-${p.key}`}>
                <div className="icon-wrap" aria-hidden>
                  <IconPage />
                </div>
                <div>
                  <div className="page-title">
                    <span id={`page-${p.key}`}>{p.title}</span>
                    <span className="page-key">{p.key}</span>
                  </div>
                  <div className="page-desc">{p.description || <span style={{ opacity:.6 }}>No description</span>}</div>
                  <div style={{ marginTop:8, display:'flex', gap:8, flexWrap:'wrap' }}>
                    <span className="chip">Page</span>
                    <button className="chip" onClick={() => { try{ navigator.clipboard.writeText(p.key); } catch{} }}>Copy key</button>
                  </div>
                </div>
                <div className="actions" style={{ marginLeft: 6 }}>
                  <button className="icon-btn" onClick={() => openEdit(p)} aria-label={`Edit ${p.title}`}>✎</button>
                  <button className="icon-btn btn-danger" onClick={() => del(p.key)} aria-label={`Delete ${p.title}`}>🗑</button>
                </div>
              </article>
            ))}
            {filtered.length === 0 && <div className="card" style={{ color: "#6f5f4f" }}>No pages match your search.</div>}
          </>
        )}
      </div>

      {/* Floating Add button */}
      <div className="fab">
        <button className="btn btn-primary" onClick={openAdd} aria-label="Add page">＋ Add Page</button>
      </div>

      {/* modal */}
      {show && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={form.key ? 'Edit Page' : 'Add Page'} onClick={(e)=>{ if(e.target.classList.contains('modal-backdrop')) setShow(false); }}>
          <div className="modal-panel">
            <h3 style={{ marginTop: 0 }}>{form.key ? "Edit Page" : "Add Page"}</h3>
            <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
              <div className="form-row">
                <div className="form-col">
                  <label>Key
                    <input value={form.key} onChange={(e) => setForm({...form, key: e.target.value})} disabled={!!form.key} />
                  </label>
                </div>
                <div className="form-col">
                  <label>Title
                    <input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} />
                  </label>
                </div>
              </div>
              <div className="form-row">
                <div className="form-col" style={{ minWidth: '100%' }}>
                  <label>Description
                    <input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap:'wrap' }}>
                <button type="button" className="btn btn-muted" onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
