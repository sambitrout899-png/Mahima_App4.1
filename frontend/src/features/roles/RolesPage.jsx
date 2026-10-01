// src/features/roles/RolesPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { getToken } from "../auth/authService";

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

function normalizePageKey(key) {
  return String(key || "").trim().toUpperCase();
}

function normalizePageKeys(keys = []) {
  return Array.from(new Set((keys || []).map(normalizePageKey).filter(Boolean)));
}

// Centralized fetch helper:
// - attaches auth (Bearer token from localStorage, adjust if you use cookies)
// - sends credentials so cookie-based sessions work too
// - throws on non-2xx with the server's message (or status text)
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
    // Surface auth issue clearly instead of "Unexpected end of JSON input"
    const err = new Error('Unauthorized — please log in again.');
    err.status = 401;
    // Optional: redirect to login
    // window.location.assign('/#/login');
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(text || `HTTP ${resp.status} ${resp.statusText}`);
  }

  // Handle empty body (204, etc.)
  if (resp.status === 204) return null;
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server returned invalid JSON');
  }
}

function IconRoles() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ id: null, name: "", description: "", pages: [] });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const [pagesFilter, setPagesFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const jr = (await apiFetch('/roles')) || {};
      setRoles(jr.items || jr.data || []);
      const jp = (await apiFetch('/pages')) || {};
      setPages(jp.items || jp.data || []);
    } catch (err) {
      console.error("load error", err);
      setRoles([]);
      setPages([]);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm({ id: null, name: "", description: "", pages: [] }); setPagesFilter(""); setShow(true); };
  const openEdit = (r) => { setForm({ id: r.id, name: r.name || "", description: r.description || "", pages: normalizePageKeys(r.pages || []) }); setPagesFilter(""); setShow(true); };

  const togglePage = (key) => {
    const pageKey = normalizePageKey(key);
    setForm(prev => {
      const set = new Set(prev.pages || []);
      if (set.has(pageKey)) set.delete(pageKey); else set.add(pageKey);
      return { ...prev, pages: Array.from(set) };
    });
  };

  const selectAllFiltered = () => {
    const list = filteredPages.map(p => normalizePageKey(p.key));
    setForm(prev => ({ ...prev, pages: Array.from(new Set([...(prev.pages||[]), ...list])) }));
  };

  const clearAll = () => setForm(prev => ({ ...prev, pages: [] }));

  const save = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) return alert("Name required");
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), description: (form.description || "").trim() || null, pages: normalizePageKeys(form.pages || []) };
      const path = form.id ? `/roles/${encodeURIComponent(form.id)}` : `/roles`;
      const method = form.id ? "PUT" : "POST";
      await apiFetch(path, { method, body: JSON.stringify(payload) });
      window.dispatchEvent(new CustomEvent("mahima:permissions-changed"));
      setShow(false);
      await load();
    } catch (err) {
      alert("Save failed: " + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id) => {
    if (!window.confirm("Delete this role?")) return;
    try {
      await apiFetch(`/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert("Delete failed: " + (err?.message || err));
    }
  };

  const filteredRoles = useMemo(() => {
    if (!query) return roles;
    const s = query.toLowerCase();
    return roles.filter(r => `${r.name} ${r.description || ""}`.toLowerCase().includes(s));
  }, [roles, query]);

  const filteredPages = useMemo(() => {
    if (!pagesFilter) return pages;
    const s = pagesFilter.toLowerCase();
    return pages.filter(p => `${p.title} ${p.key} ${p.description || ""}`.toLowerCase().includes(s));
  }, [pages, pagesFilter]);

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
      .roles-wrap{ min-height:100vh; padding: max(8px,var(--safe-top)) 12px calc(64px + var(--safe-bottom)); background: var(--bg); font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: var(--deep); }
      .roles-header{ position:sticky; top:8px; z-index:40; display:flex; gap:10px; align-items:flex-start; padding:14px; border-radius: var(--radius); background: rgba(255,255,255,.94); box-shadow: var(--shadow); border:1px solid var(--enterprise-border, #dfe7ef); margin-bottom:10px; }
      .roles-title{ font-size:18px; font-weight:900; }
      .subtitle{ color:var(--muted); margin-top:4px; font-size:13px; }
      .search-row{ display:flex; gap:8px; width:100%; }
      .search{ padding:14px 12px; border-radius:12px; border:1px solid rgba(0,0,0,0.06); width:100%; font-size:15px; background:#fff; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
      .btn{ border:none; border-radius:12px; padding:12px 14px; font-weight:800; cursor:pointer; font-size:14px; display:inline-flex; align-items:center; gap:8px; }
      .btn-primary{ background: linear-gradient(180deg,var(--accent), var(--enterprise-primary-strong, #065f46)); color:#fff; box-shadow: 0 8px 20px rgba(4,120,87,0.18); }
      .btn-muted{ background:#fff; border:1px solid var(--enterprise-border, #dfe7ef); color:var(--deep); }
      .btn-danger{ background: linear-gradient(180deg,#e74c3c,#c0392b); color:#fff; }
      .grid{ display:grid; grid-template-columns:1fr; gap:10px; }
      .card{ background: var(--card); border-radius: var(--radius); padding:12px; box-shadow: var(--shadow); border:1px solid rgba(0,0,0,0.04); }
      .role-card{ background:#fff; border-radius:16px; padding:12px; box-shadow: 0 10px 28px rgba(14,22,34,0.08); border:1px solid rgba(0,0,0,0.04); display:grid; grid-template-columns:auto 1fr auto; gap:10px; }
      .role-avatar{ width:48px; height:48px; border-radius:12px; display:grid; place-items:center; font-weight:900; background: linear-gradient(180deg,#fff6e3,#fff1d6); color:#112b44; }
      .role-name{ font-weight:900; font-size:16px; color:#112b44; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .role-desc{ color:#6b5a46; font-size:13px; margin-top:4px; }
      .small-muted{ font-size:12px; color:#6f5f4f; }
      .chip{ padding:6px 10px; border-radius:999px; background:#f8fafc; border:1px solid rgba(0,0,0,.06); font-size:12px; }
      .icon-btn{ min-width:44px; min-height:44px; display:inline-flex; align-items:center; justify-content:center; border-radius:12px; border:1px solid rgba(0,0,0,0.06); background:#fff; }
      .page-pills{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
      .page-pill{ display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border-radius:999px; background:#fff; border:1px solid rgba(0,0,0,0.06); }
      /* Skeletons */
      .skeleton{ background: linear-gradient(90deg, rgba(0,0,0,0.05), rgba(0,0,0,0.09), rgba(0,0,0,0.05)); background-size: 200% 100%; animation: shimmer 1.2s infinite; border-radius: 10px; }
      @keyframes shimmer { 0%{ background-position: 200% 0; } 100%{ background-position: -200% 0; } }
      /* Desktop grid increase */
      @media(min-width: 980px){ .grid{ grid-template-columns: repeat(2, 1fr); } }
      @media(max-width: 720px){
        .roles-wrap{ padding: 10px 10px calc(84px + var(--safe-bottom)); }
        .roles-header{ position:relative; top:auto; flex-direction:column; align-items:stretch; padding:12px; }
        .roles-header > div{ min-width:0 !important; width:100%; }
        .search-row{ display:grid; grid-template-columns:1fr; }
        .role-card{ grid-template-columns:48px 1fr; align-items:start; }
        .role-card > div:last-child{ grid-column:1 / -1; justify-content:flex-end; }
        .page-pills{ max-height:96px; overflow:auto; }
        .fab{ right:12px; bottom:calc(12px + var(--safe-bottom)); }
        .modal-panel{ max-height:90dvh; }
      }
      /* FAB */
      .fab{ position: fixed; right: 16px; bottom: calc(18px + var(--safe-bottom)); z-index: 70; }
      /* Modal sheet */
      .modal-backdrop{ position:fixed; inset:0; background: rgba(8,6,4,0.45); display:flex; align-items:flex-end; justify-content:center; z-index:120; }
      .modal-panel{ width:100%; max-width:820px; background: linear-gradient(180deg,#fff,#fffdf8); padding:16px; border-radius:18px 18px 0 0; box-shadow: 0 18px 48px rgba(6,6,6,0.45); border:1px solid rgba(200,170,90,0.07); display:block; max-height:86vh; overflow:auto; }
      @media (min-width: 900px){ .modal-backdrop{ align-items:center; } .modal-panel{ border-radius: 18px; } }
      .form-row{ display:flex; gap:10px; flex-wrap:wrap; }
      .form-col{ flex:1 1 240px; min-width: 240px; }
      .form-col input{ width:100%; padding:12px; border-radius:12px; border:1px solid rgba(0,0,0,0.08); background:#fff; font-size:14px; }
      label{ display:block; font-size:12px; color:#6b5a46; font-weight:700; }
      .pages-toolbar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
    `}</style>
  );

  /* ------------------- render ------------------- */
  return (
    <div className="roles-wrap">
      {Styles}
      {/* Header */}
      <div className="roles-header mahima-standard-page-header" data-mahima-explicit-header="true" role="region" aria-label="Roles header">
        <div style={{ display:"flex", gap:12, alignItems:"center", flex:1 }}>
          <div className="role-avatar" aria-hidden>
            <IconRoles />
          </div>
          <div>
            <h1 className="roles-title mahima-standard-page-title" data-mahima-explicit-title="true">Roles</h1>
            <div className="subtitle mahima-standard-page-subtitle">Create roles and assign which pages each role can access.</div>
          </div>
        </div>
        <div style={{ minWidth: 260, flex:1 }}>
          <div className="search-row">
            <input className="search" placeholder="Filter roles…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn btn-muted" onClick={() => setQuery("")}>Clear</button>
            <button className="btn btn-muted" onClick={() => load()}>Refresh</button>
          </div>
        </div>
        <div className="" style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="btn btn-primary" onClick={openAdd}>Add Role</button>
        </div>
      </div>

      {/* Content */}
      <div className="grid" role="list">
        {loading ? (
          [...Array(6)].map((_,i) => (
            <div key={i} className="role-card" aria-hidden>
              <div className="role-avatar skeleton" />
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
            {filteredRoles.map(r => (
              <article className="role-card" key={r.id} role="listitem" aria-labelledby={`role-${r.id}`}>
                <div className="role-avatar" aria-hidden>{(r.name || "R").slice(0,2).toUpperCase()}</div>
                <div className="role-main">
                  <div className="role-name" id={`role-${r.id}`}>
                    {r.name}
                    <span className="small-muted">{(r.pages?.length ?? 0)} pages</span>
                  </div>
                  <div className="role-desc">{r.description || <span style={{ opacity:.6 }}>No description</span>}</div>
                  <div className="page-pills">
                    {(r.pages || []).slice(0,6).map(pk => <span key={pk} className="chip">{pk}</span>)}
                    {(r.pages?.length ?? 0) > 6 && <span className="small-muted">+{(r.pages.length - 6)} more</span>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <button className="icon-btn" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}>✎</button>
                  <button className="icon-btn btn-danger" onClick={() => confirmDelete(r.id)} aria-label={`Delete ${r.name}`}>🗑</button>
                </div>
              </article>
            ))}
            {filteredRoles.length === 0 && <div className="card" style={{ color:"#6f5f4f" }}>No roles found.</div>}
          </>
        )}
      </div>

      {/* Floating Add button */}
      <div className="fab">
        <button className="btn btn-primary" onClick={openAdd} aria-label="Add role">＋ Add Role</button>
      </div>

      {/* modal */}
      {show && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={form.id ? 'Edit Role' : 'Add Role'} onClick={(e)=>{ if(e.target.classList.contains('modal-backdrop')) setShow(false); }}>
          <div className="modal-panel">
            <h3 style={{ marginTop:0 }}>{form.id ? "Edit Role" : "Add Role"}</h3>
            <form onSubmit={save} style={{ display:"grid", gap:12 }}>
              <div className="form-row">
                <div className="form-col">
                  <label>Name
                    <input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
                  </label>
                </div>
                <div className="form-col">
                  <label>Description
                    <input value={form.description || ""} onChange={(e) => setForm({...form, description: e.target.value})} />
                  </label>
                </div>
              </div>
              <div className="card">
                <div className="pages-toolbar">
                  <strong>Assign Pages</strong>
                  <input className="search" style={{ maxWidth: 280 }} placeholder="Filter pages…" value={pagesFilter} onChange={(e)=>setPagesFilter(e.target.value)} />
                  <button type="button" className="btn btn-muted" onClick={selectAllFiltered}>Select filtered</button>
                  <button type="button" className="btn btn-muted" onClick={clearAll}>Clear all</button>
                  <span className="small-muted">{form.pages?.length ?? 0} selected</span>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {filteredPages.map(p => (
                    <label key={p.key} className="page-pill">
                      <input type="checkbox" checked={(form.pages||[]).includes(normalizePageKey(p.key))} onChange={() => togglePage(p.key)} />
                      <span style={{ fontWeight:700 }}>{p.title}</span>
                      <span className="small-muted">{p.key}</span>
                    </label>
                  ))}
                  {filteredPages.length === 0 && <div className="small-muted">No pages found.</div>}
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", gap:8, flexWrap:'wrap' }}>
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
