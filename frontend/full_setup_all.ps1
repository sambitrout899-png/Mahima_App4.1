<#
full_setup_all.ps1
Creates frontend CRUD UI and API clients for modules and optionally scaffolds a simple ASP.NET Core backend.

USAGE:
  1) Save this file to your Windows machine.
  2) Open PowerShell (recommended: Administrator).
  3) Run: powershell -ExecutionPolicy Bypass -File .\full_setup_all.ps1
  4) The script will prompt for:
      - Frontend project root (where package.json resides)  (default: C:\Users\Administrator\projects\mahima-frontend)
      - Whether to scaffold backend files (Y/N)
      - If yes, backend project root (where .csproj resides) and the DB connection string to use in appsettings.json
  5) It will back up replaced files into timestamped .bak files.

WHAT IT DOES (frontend):
  - Writes safe API clients into src/api (list fallback GET->POST, create strips id, update PUT->POST fallback)
  - Creates src/features/<module>/Page.jsx pages with full-row tables, Add/Edit/Delete forms (modal)
  - Creates Logo.jsx and Layout.jsx (light red theme) and patches App.jsx/main.jsx to use Layout
  - Drops your provided logo into public/logo.png if present in project root (candidates: logo.png, mahima*.png/jpg)
  - Creates .env.local with VITE_API_BASE_URL pointing at your backend

WHAT IT DOES (backend - optional):
  - Writes Models (User, Team, TaskItem, PrayerRequest, Meeting, Sermon, Attachment)
  - Writes ApplicationDbContext.cs and minimal controllers with CRUD endpoints
  - Adds example Program.cs snippet to register DbContext and endpoints (you must merge manually if your project differs)
  - Does NOT run dotnet ef/migrations automatically (instructions provided)

IMPORTANT: review files before committing. This is a scaffold to get you running quickly.

#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ask($prompt, $default='') {
  if ($default -ne '') { $val = Read-Host "$prompt [$default]" }
  else { $val = Read-Host $prompt }
  if ($val -eq '') { return $default } else { return $val }
}

# find default frontend path
$defaultFrontend = "C:\Users\Administrator\projects\mahima-frontend"
$frontend = Ask "Frontend project root (where package.json is)" $defaultFrontend
if (-not (Test-Path (Join-Path $frontend 'package.json'))) {
  Write-Host "Warning: package.json not found at $frontend. Continue? (Y/N)"
  $c = Read-Host
  if ($c -notin @('Y','y')) { Write-Host "Aborting."; exit 1 }
}

# prompt for backend scaffold
$scaffoldBackend = Ask "Scaffold .NET backend files? (Y/N)" "N"

# backend prompts if needed
if ($scaffoldBackend -match '^[Yy]') {
  $backend = Ask "Backend project root (folder containing .csproj)" ""
  if (-not (Get-ChildItem -Path $backend -Filter *.csproj -File -ErrorAction SilentlyContinue)) {
    Write-Host "Warning: no .csproj found in $backend. Continue? (Y/N)"
    $c = Read-Host
    if ($c -notin @('Y','y')) { Write-Host "Aborting."; exit 1 }
  }
  $dbConn = Ask "Database connection string for appsettings (e.g. Host=localhost;Port=5432;Database=mahima;Username=...;Password=...)" ""
}

# helper: backup file
function Backup-IfExists($path) {
  if (Test-Path $path) {
    $bak = "$path.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item -Path $path -Destination $bak -Force
    Write-Host "Backed up $path -> $(Split-Path $bak -Leaf)"
  }
}

# helper: write utf8 no BOM
function Write-NoBOM($path, $text) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Wrote: $path"
}

# ---------- FRONTEND: write API clients and UI pages ----------
$apiDir = Join-Path $frontend 'src\api'
if (-not (Test-Path $apiDir)) { New-Item -ItemType Directory -Path $apiDir -Force | Out-Null }

# api client templates (list fallback GET->POST; create strips id)
$clients = @{
  "users.js" = @'
import { call, cleanPayload } from "./_helper";

async function tryList(path) {
  try { return await call(path); } catch (e) { if (e && e.status === 405) return await call(path, { method: "POST", body: JSON.stringify({}) }); throw e; }
}

export const usersApi = {
  list: ({ search="", page=1, limit=50 }={}) => tryList(`/api/users?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`),
  get: (id) => call(`/api/users/${id}`),
  create: (p) => { const payload=cleanPayload(p)||{}; delete payload.id; delete payload.Id; return call("/api/users",{method:"POST", body:JSON.stringify(payload)}); },
  update: async (id,p) => { try { return await call(`/api/users/${id}`,{method:"PUT", body: JSON.stringify(cleanPayload(p))}); } catch (e) { if (e && e.status===405) return await call("/api/users",{method:"POST", body:JSON.stringify({...cleanPayload(p), id})}); throw e; } },
  remove: (id) => call(`/api/users/${id}`, { method: "DELETE" })
};
'@

  "teams.js" = @'
import { call, cleanPayload } from "./_helper";
async function tryList(path){try{return await call(path)}catch(e){if(e&&e.status===405) return await call(path,{method:"POST",body:JSON.stringify({})}); throw e}}
export const teamsApi = {
  list: () => tryList("/api/teams"),
  get: (id) => call(`/api/teams/${id}`),
  create: (p) => { const payload = cleanPayload(p)||{}; delete payload.id; delete payload.Id; return call("/api/teams",{method:"POST", body: JSON.stringify(payload)}); },
  update: async (id,p) => { try{return await call(`/api/teams/${id}`,{method:"PUT", body:JSON.stringify(cleanPayload(p))}); } catch(e) { if(e && e.status===405) return await call("/api/teams",{method:"POST", body: JSON.stringify({...cleanPayload(p), id})}); throw e; } },
  remove: (id) => call(`/api/teams/${id}`,{ method:"DELETE" })
};
'@

  "tasks.js" = @'
import { call, cleanPayload } from "./_helper";
async function tryList(path){try{return await call(path)}catch(e){if(e&&e.status===405) return await call(path,{method:"POST",body:JSON.stringify({})}); throw e}}
export const tasksApi = {
  list: () => tryList("/api/tasks"),
  get: (id) => call(`/api/tasks/${id}`),
  create: (p) => { const payload = cleanPayload(p)||{}; delete payload.id; delete payload.Id; return call("/api/tasks",{method:"POST", body: JSON.stringify(payload)}); },
  update: async (id,p) => { try{return await call(`/api/tasks/${id}`,{method:"PUT", body:JSON.stringify(cleanPayload(p))}); } catch(e) { if(e && e.status===405) return await call("/api/tasks",{method:"POST", body: JSON.stringify({...cleanPayload(p), id})}); throw e; } },
  remove: (id) => call(`/api/tasks/${id}`,{ method:"DELETE" })
};
'@

  "meetings.js" = @'
import { call, cleanPayload } from "./_helper";
async function tryList(path){try{return await call(path)}catch(e){if(e&&e.status===405) return await call(path,{method:"POST",body:JSON.stringify({})}); throw e}}
export const meetingsApi = {
  list: () => tryList("/api/meetings"),
  get: (id) => call(`/api/meetings/${id}`),
  create: (p) => { const payload = cleanPayload(p)||{}; delete payload.id; delete payload.Id; return call("/api/meetings",{method:"POST", body: JSON.stringify(payload)}); },
  update: async (id,p) => { try{return await call(`/api/meetings/${id}`,{method:"PUT", body:JSON.stringify(cleanPayload(p))}); } catch(e) { if(e && e.status===405) return await call("/api/meetings",{method:"POST", body: JSON.stringify({...cleanPayload(p), id})}); throw e; } },
  remove: (id) => call(`/api/meetings/${id}`,{ method:"DELETE" })
};
'@

  "prayerrequests.js" = @'
import { call, cleanPayload } from "./_helper";
async function tryList(path){try{return await call(path)}catch(e){if(e&&e.status===405) return await call(path,{method:"POST",body:JSON.stringify({})}); throw e}}
export const prayerrequestsApi = {
  list: () => tryList("/api/prayerrequests"),
  get: (id) => call(`/api/prayerrequests/${id}`),
  create: (p) => { const payload = cleanPayload(p)||{}; delete payload.id; delete payload.Id; return call("/api/prayerrequests",{method:"POST", body: JSON.stringify(payload)}); },
  update: async (id,p) => { try{return await call(`/api/prayerrequests/${id}`,{method:"PUT", body:JSON.stringify(cleanPayload(p))}); } catch(e) { if(e && e.status===405) return await call("/api/prayerrequests",{method:"POST", body: JSON.stringify({...cleanPayload(p), id})}); throw e; } },
  remove: (id) => call(`/api/prayerrequests/${id}`,{ method:"DELETE" })
};
'@

  "sermons.js" = @'
import { call, cleanPayload } from "./_helper";
async function tryList(path){try{return await call(path)}catch(e){if(e&&e.status===405) return await call(path,{method:"POST",body:JSON.stringify({})}); throw e}}
export const sermonsApi = {
  list: () => tryList("/api/sermons"),
  get: (id) => call(`/api/sermons/${id}`),
  create: (p) => { const payload = cleanPayload(p)||{}; delete payload.id; delete payload.Id; return call("/api/sermons",{method:"POST", body: JSON.stringify(payload)}); }
  // server may not implement other verbs
};
'@

  "attachments.js" = @'
import { call } from "./_helper";
async function tryList(path){try{return await call(path)}catch(e){if(e&&e.status===405) return await call(path,{method:"POST",body:JSON.stringify({})}); throw e}}
export const attachmentsApi = {
  list: () => tryList("/api/attachments"),
  get: (id) => call(`/api/attachments/${id}`)
  // file uploads require FormData and a direct fetch from UI
};
'@
}

# write clients
foreach ($name in $clients.Keys) {
  $target = Join-Path $apiDir $name
  Backup-IfExists $target
  Write-NoBOM $target $clients[$name]
}

# write helper _helper.js
$helperPath = Join-Path $apiDir '_helper.js'
Backup-IfExists $helperPath
$helperContent = @'
// _helper.js - call() centralizes base URL and JSON handling
const BASE = import.meta.env.VITE_API_BASE_URL || "";

export async function call(pathOrUrl, opts = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : (BASE.replace(/\/$/, "") + (pathOrUrl.startsWith("/") ? "" : "/") + pathOrUrl);
  const options = { credentials: "include", headers: { "Content-Type": "application/json", ...(opts.headers||{}) }, ...opts };
  const res = await fetch(url, options);
  const text = await res.text();
  const ct = res.headers.get("content-type")||"";
  if (!res.ok) {
    const err = new Error(`API error (${res.status}): ${res.statusText}`);
    err.status = res.status;
    try { err.body = ct.includes("application/json") ? JSON.parse(text) : text } catch { err.body = text }
    throw err;
  }
  if (!text) return null;
  if (ct.includes("application/json")) return JSON.parse(text);
  return text;
}

// remove undefined and empty-string fields
export function cleanPayload(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}
'@
Write-NoBOM $helperPath $helperContent

# layout & logo components
$componentsDir = Join-Path $frontend 'src\components'
if (-not (Test-Path $componentsDir)) { New-Item -ItemType Directory -Path $componentsDir -Force | Out-Null }

# Logo.jsx
$logoPath = Join-Path $componentsDir 'Logo.jsx'
Backup-IfExists $logoPath
$logoComp = @'
import React from "react";
import { Link } from "react-router-dom";
export default function Logo({ size = 56 }) {
  return (
    <Link to="/" className="flex items-center space-x-3">
      <img src="/logo.png" alt="Mahima Ministry" width={size} height={size} className="rounded" />
      <div className="hidden sm:block">
        <div className="text-xl font-bold text-red-700">Mahima Ministry</div>
        <div className="text-sm text-gray-600">Admin UI</div>
      </div>
    </Link>
  );
}
'@
Write-NoBOM $logoPath $logoComp

# Layout.jsx
$layoutPath = Join-Path $componentsDir 'Layout.jsx'
Backup-IfExists $layoutPath
$layoutComp = @'
import React from "react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";
export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-red-50">
      <header className="flex items-center justify-between px-6 py-4 bg-red-100 shadow">
        <Logo size={52} />
        <nav className="space-x-4">
          <NavLink to="/users" className="hover:text-red-700">Users</NavLink>
          <NavLink to="/teams" className="hover:text-red-700">Teams</NavLink>
          <NavLink to="/tasks" className="hover:text-red-700">Tasks</NavLink>
          <NavLink to="/sermons" className="hover:text-red-700">Sermons</NavLink>
          <NavLink to="/prayerrequests" className="hover:text-red-700">PrayerRequests</NavLink>
          <NavLink to="/meetings" className="hover:text-red-700">Meetings</NavLink>
          <NavLink to="/attachments" className="hover:text-red-700">Attachments</NavLink>
        </nav>
      </header>
      <main className="p-6 max-w-7xl mx-auto">{children}</main>
      <footer className="p-4 text-center text-sm text-gray-500">© {new Date().getFullYear()} Mahima Ministry</footer>
    </div>
  );
}
'@
Write-NoBOM $layoutPath $layoutComp

# create features pages with full-row tables and forms (Page.jsx for each feature)
$features = @('users','teams','tasks','sermons','prayerrequests','meetings','attachments')
$featuresBase = Join-Path $frontend 'src\features'
foreach ($f in $features) {
  $dir = Join-Path $featuresBase $f
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $pagePath = Join-Path $dir 'Page.jsx'
  Backup-IfExists $pagePath

  # Create a robust Page.jsx that lists, opens modal form for add/edit, and deletes.
  # Note: uses <form> with basic inputs generated from the model keys from first item OR a fallback field set.
  $pageTemplate = @"
import React, { useEffect, useState } from 'react';
import { ${f}Api } from '../../api/$f';
import Modal from '../../components/_SimpleModal'; // we'll create a tiny modal below

function DetectFields(obj) {
  if (!obj || typeof obj !== 'object') return ['id','name'];
  return Object.keys(obj);
}

export default function Page() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await ${f}Api.list();
      setItems(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Load error:', e);
      setError(e && e.message ? e.message : String(e));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openAdd() { setEditing(null); setForm({}); setOpen(true); }
  function openEdit(item) { setEditing(item); setForm({ ...item }); setOpen(true); }

  async function save() {
    try {
      if (editing) {
        const id = editing.id ?? editing.Id ?? editing.ID;
        await ${f}Api.update(id, form);
        setOpen(false); await load();
      } else {
        // ensure id is not sent on create
        const payload = { ...form };
        delete payload.id; delete payload.Id;
        await ${f}Api.create(payload);
        setOpen(false); await load();
      }
      alert('Saved');
    } catch (e) {
      console.error('Save error', e);
      alert('Create/Update failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  async function doDelete(id) {
    if (!confirm('Delete record?')) return;
    try { await ${f}Api.remove(id); await load(); alert('Deleted'); } catch(e) { console.error(e); alert('Delete failed: ' + (e && e.message? e.message: e)); }
  }

  if (loading) return <div className='text-center py-10'>Loading...</div>;
  if (error) return <div className='text-center py-10 text-red-600'>Error: {error}</div>;

  const cols = items[0] ? Object.keys(items[0]) : ['id','name'];

  return (
    <div>
      <div className='flex justify-between items-center mb-4'>
        <h2 className='text-xl font-semibold capitalize'>{'$f'}</h2>
        <button onClick={openAdd} className='px-3 py-2 bg-red-600 text-white rounded'>Add Record</button>
      </div>

      <div className='overflow-auto rounded shadow'>
        <table className='min-w-full divide-y divide-red-200 bg-red-50'>
          <thead className='bg-red-100'>
            <tr>
              {cols.map(c => <th key={c} className='px-4 py-2 text-left text-sm font-medium text-red-700'>{c}</th>)}
              <th className='px-4 py-2 text-left text-sm font-medium text-red-700'>Actions</th>
            </tr>
          </thead>
          <tbody className='bg-white divide-y divide-red-200'>
            {items.map((it, idx) => (
              <tr key={idx} className='hover:bg-red-50'>
                {cols.map(c => <td key={c} className='px-4 py-2 text-sm text-gray-700'>{String(it[c] ?? '')}</td>)}
                <td className='px-4 py-2'>
                  <button className='px-2 py-1 mr-2 border rounded text-sm' onClick={() => navigator.clipboard?.writeText(JSON.stringify(it))}>Copy</button>
                  <button className='px-2 py-1 mr-2 border rounded text-sm' onClick={() => openEdit(it)}>Edit</button>
                  <button className='px-2 py-1 bg-red-600 text-white rounded text-sm' onClick={() => doDelete(it.id ?? it.Id ?? it.ID)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title={editing ? 'Edit Record' : 'Add Record'} onClose={() => setOpen(false)}>
          <div className='space-y-3'>
            {(DetectFields(editing || items[0] || { id:'', name:'' })).map(key => {
              const val = form[key] ?? '';
              const isId = key.toLowerCase() === 'id' || key.toLowerCase().endsWith('id');
              // joinDate readonly for users
              const readonly = (('$f' === 'users') && (key.toLowerCase().includes('joindate') || isId));
              return (
                <div key={key}>
                  <label className='block text-sm font-medium'>{key} {readonly ? <span className='text-red-500'>*</span> : null}</label>
                  <input value={val} onChange={e => setForm({...form, [key]: e.target.value})} readOnly={readonly} className='w-full px-3 py-2 border rounded'/>
                </div>
              );
            })}
            <div className='flex space-x-2'>
              <button onClick={save} className='px-4 py-2 bg-indigo-700 text-white rounded'>Save</button>
              <button onClick={() => setOpen(false)} className='px-4 py-2 border rounded'>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
"@

  # write page
  Write-NoBOM $pagePath $pageTemplate
}

# write a tiny Modal component used by pages
$modalPath = Join-Path $componentsDir '_SimpleModal.jsx'
Backup-IfExists $modalPath
$modalContent = @'
import React from "react";
export default function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-8">
      <div className="absolute inset-0 bg-black opacity-25" onClick={onClose}></div>
      <div className="bg-white rounded shadow-lg z-10 w-full max-w-2xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="px-2 py-1 border rounded">X</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
'@
Write-NoBOM $modalPath $modalContent

# copy logo from project root if present (candidates)
$logoCandidates = @('logo.png','mahima.png','mahima_logo.png','logo.jpg','logo.jpeg')
$found = $null
foreach ($n in $logoCandidates) { $p = Join-Path $frontend $n; if (Test-Path $p) { $found = $p; break } }
if ($found) {
  $public = Join-Path $frontend 'public'
  if (-not (Test-Path $public)) { New-Item -ItemType Directory -Path $public | Out-Null }
  $dest = Join-Path $public 'logo.png'
  Backup-IfExists $dest
  Copy-Item $found -Destination $dest -Force
  Write-Host "Copied logo to public/logo.png"
} else {
  Write-Host "No logo file found in project root. Place logo.png in project root and re-run to copy automatically."
}

# create .env.local for VITE_API_BASE_URL
$envPath = Join-Path $frontend '.env.local'
if (-not (Test-Path $envPath)) {
  $defaultApi = Ask "Enter API base URL for frontend (e.g. http://localhost:5001)" "http://localhost:5001"
  $content = "VITE_API_BASE_URL=$defaultApi`n"
  Write-NoBOM $envPath $content
} else {
  Write-Host ".env.local already exists; leaving it unchanged."
}

# patch App.jsx or main.jsx to ensure Layout usage
$entryCandidates = @('src\App.jsx','src\main.jsx','src\index.jsx')
$patched = $false
foreach ($c in $entryCandidates) {
  $entry = Join-Path $frontend $c
  if (Test-Path $entry) {
    Backup-IfExists $entry
    $text = Get-Content -Raw -Path $entry -ErrorAction SilentlyContinue
    if ($text -match 'Layout') {
      Write-Host "$entry already references Layout; skipping patch"
      $patched = $true
      break
    }
    if ($c -like 'src\App.jsx') {
      $new = @'
import React from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import UsersPage from "./features/users/Page";
import TeamsPage from "./features/teams/TeamsPage";
import TasksPage from "./features/tasks/Page";
import SermonsPage from "./features/sermons/Page";
import PrayerRequestsPage from "./features/prayerrequests/Page";
import MeetingsPage from "./features/meetings/Page";
import AttachmentsPage from "./features/attachments/Page";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/users" element={<UsersPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/sermons" element={<SermonsPage />} />
        <Route path="/prayerrequests" element={<PrayerRequestsPage />} />
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/attachments" element={<AttachmentsPage />} />
      </Routes>
    </Layout>
  );
}
'@
      Write-NoBOM $entry $new
      Write-Host "Rewrote $entry to use Layout and routes"
      $patched = $true
      break
    } else {
      # patch main.jsx to ensure BrowserRouter wraps <App />
      $newMain = @'
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
'@
      Write-NoBOM $entry $newMain
      Write-Host "Rewrote $entry to mount App inside BrowserRouter"
      $patched = $true
      break
    }
  }
}
if (-not $patched) { Write-Host "No entry file patched; ensure your project mounts Layout or integrate manually." }

Write-Host "`nFrontend changes complete. Restart dev server: cd $frontend ; npm run dev"

# ---------- BACKEND SCAFFOLD (optional) ----------
if ($scaffoldBackend -match '^[Yy]') {
  if (-not $backend) { Write-Host "Backend path not set. Aborting backend scaffold."; }
  else {
    $backendDir = $backend
    $modelsDir = Join-Path $backendDir 'Models'
    if (-not (Test-Path $modelsDir)) { New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null }

    Write-Host "`nWriting backend scaffolding into $backendDir (C# files). Backups not taken - please review."

    # ApplicationDbContext.cs
    $dbContext = @"
using Microsoft.EntityFrameworkCore;

namespace Backend.Models
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        public DbSet<User> Users { get; set; }
        public DbSet<Team> Teams { get; set; }
        public DbSet<TaskItem> Tasks { get; set; }
        public DbSet<Sermon> Sermons { get; set; }
        public DbSet<PrayerRequest> PrayerRequests { get; set; }
        public DbSet<Meeting> Meetings { get; set; }
        public DbSet<Attachment> Attachments { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'ApplicationDbContext.cs') $dbContext

    # Model templates (User, Team, TaskItem, PrayerRequest, Meeting, Sermon, Attachment)
    $userModel = @"
using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class User
    {
        [Key]
        public Guid Id { get; set; }
        [Required] public string u { get; set; } // short username required by your API
        public string Email { get; set; }
        public string Role { get; set; }
        public string CognitoSub { get; set; }
        public string DisplayName { get; set; }
        public DateTime? JoinDate { get; set; }
        public DateTime? LastLogin { get; set; }
        public string Phone { get; set; }
        public string Username { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'User.cs') $userModel

    $teamModel = @"
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class Team
    {
        [Key]
        public long Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'Team.cs') $teamModel

    $taskModel = @"
using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class TaskItem
    {
        [Key]
        public long Id { get; set; }
        public string Title { get; set; }
        public string Details { get; set; }
        public DateTime? DueDate { get; set; }
        public bool Completed { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'TaskItem.cs') $taskModel

    $prayerModel = @"
using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class PrayerRequest
    {
        [Key]
        public long Id { get; set; }
        public string Title { get; set; }
        public string Details { get; set; }
        public DateTime? Created { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'PrayerRequest.cs') $prayerModel

    $meetingModel = @"
using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class Meeting
    {
        [Key]
        public long Id { get; set; }
        public string Subject { get; set; }
        public DateTime? When { get; set; }
        public string Notes { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'Meeting.cs') $meetingModel

    $sermonModel = @"
using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class Sermon
    {
        [Key]
        public long Id { get; set; }
        public string Title { get; set; }
        public string Speaker { get; set; }
        public DateTime? Date { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'Sermon.cs') $sermonModel

    $attachmentModel = @"
using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Models
{
    public class Attachment
    {
        [Key]
        public long Id { get; set; }
        public string FileName { get; set; }
        public string Url { get; set; }
    }
}
"@
    Write-NoBOM (Join-Path $modelsDir 'Attachment.cs') $attachmentModel

    # Controllers folder
    $controllersDir = Join-Path $backendDir 'Controllers'
    if (-not (Test-Path $controllersDir)) { New-Item -ItemType Directory -Path $controllersDir -Force | Out-Null }

    # A generic controller template (example for Users)
    $usersCtrl = @"
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Models;
using System;
using System.Threading.Tasks;
using System.Linq;

namespace Backend.Controllers
{
    [ApiController]
    [Route(""api/[controller]"")]
    public class UsersController : ControllerBase
    {
        private readonly ApplicationDbContext _db;
        public UsersController(ApplicationDbContext db) { _db = db; }

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string search, int page = 1, int limit = 50)
        {
            var q = _db.Users.AsQueryable();
            if (!string.IsNullOrEmpty(search)) q = q.Where(u => u.DisplayName.Contains(search) || u.Email.Contains(search) || u.u.Contains(search));
            var items = await q.Skip((page-1)*limit).Take(limit).ToListAsync();
            return Ok(items);
        }

        [HttpGet(""{id}"")]
        public async Task<IActionResult> Get(Guid id)
        {
            var item = await _db.Users.FindAsync(id);
            if (item == null) return NotFound();
            return Ok(item);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] User model)
        {
            if (model == null) return BadRequest();
            model.Id = model.Id == Guid.Empty ? Guid.NewGuid() : model.Id;
            model.JoinDate ??= DateTime.UtcNow;
            _db.Users.Add(model);
            await _db.SaveChangesAsync();
            return CreatedAtAction(nameof(Get), new { id = model.Id }, model);
        }

        [HttpPut(""{id}"")]
        public async Task<IActionResult> Update(Guid id, [FromBody] User model)
        {
            var existing = await _db.Users.FindAsync(id);
            if (existing == null) return NotFound();
            _db.Entry(existing).CurrentValues.SetValues(model);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        [HttpDelete(""{id}"")]
        public async Task<IActionResult> Delete(Guid id)
        {
            var existing = await _db.Users.FindAsync(id);
            if (existing == null) return NotFound();
            _db.Users.Remove(existing);
            await _db.SaveChangesAsync();
            return NoContent();
        }
    }
}
"@
    Write-NoBOM (Join-Path $controllersDir 'UsersController.cs') $usersCtrl

    # For brevity, generate simple controllers for other models using long id
    $simpleController = @"
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Models;
using System.Threading.Tasks;

namespace Backend.Controllers
{
    [ApiController]
    [Route(""api/[controller]"")]
    public class {NAME}Controller : ControllerBase
    {
        private readonly ApplicationDbContext _db;
        public {NAME}Controller(ApplicationDbContext db) { _db = db; }

        [HttpGet]
        public async Task<IActionResult> List() {
            var items = await _db.{SET}.ToListAsync();
            return Ok(items);
        }

        [HttpGet(""{id}"")]
        public async Task<IActionResult> Get(long id) {
            var item = await _db.{SET}.FindAsync(id);
            if (item==null) return NotFound();
            return Ok(item);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] {MODEL} model) {
            if (model == null) return BadRequest();
            _db.{SET}.Add(model);
            await _db.SaveChangesAsync();
            return CreatedAtAction(nameof(Get), new { id = model.Id }, model);
        }

        [HttpPut(""{id}"")]
        public async Task<IActionResult> Update(long id, [FromBody] {MODEL} model) {
            var existing = await _db.{SET}.FindAsync(id);
            if (existing==null) return NotFound();
            _db.Entry(existing).CurrentValues.SetValues(model);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        [HttpDelete(""{id}"")]
        public async Task<IActionResult> Delete(long id) {
            var existing = await _db.{SET}.FindAsync(id);
            if (existing==null) return NotFound();
            _db.{SET}.Remove(existing);
            await _db.SaveChangesAsync();
            return NoContent();
        }
    }
}
"@

    $pairs = @(
      @{ NAME="Teams"; SET="Teams"; MODEL="Team" },
      @{ NAME="Tasks"; SET="Tasks"; MODEL="TaskItem" },
      @{ NAME="Meetings"; SET="Meetings"; MODEL="Meeting" },
      @{ NAME="PrayerRequests"; SET="PrayerRequests"; MODEL="PrayerRequest" },
      @{ NAME="Sermons"; SET="Sermons"; MODEL="Sermon" },
      @{ NAME="Attachments"; SET="Attachments"; MODEL="Attachment" }
    )
    foreach ($p in $pairs) {
      $ctrl = $simpleController -replace '\{NAME\}',$p.NAME -replace '\{SET\}',$p.SET -replace '\{MODEL\}',$p.MODEL
      Write-NoBOM (Join-Path $controllersDir ($p.NAME + 'Controller.cs')) $ctrl
    }

    # Write Program.cs snippet guidance
    $programNote = @"
-- ADD THESE SNIPPETS TO YOUR Program.cs / Startup.cs --

In Program.cs (minimal API style):

using Backend.Models;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString(""DefaultConnection"")));

var app = builder.Build();
app.MapControllers();
app.Run();

Also set connection string in appsettings.json:
  ""ConnectionStrings"": {
    ""DefaultConnection"": ""$dbConn""
  }
Install packages:
  dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL
  dotnet add package Microsoft.EntityFrameworkCore.Design

Then run migrations:
  dotnet ef migrations add Init
  dotnet ef database update

-- END SNIPPET --
"@
    Write-Host $programNote
  }
}

Write-Host "`nALL DONE. Summary:"
Write-Host " - Frontend patched (API clients, feature pages, layout, logo, modal). Backup files created alongside originals with .bak_ timestamp suffix."
if ($scaffoldBackend -match '^[Yy]') { Write-Host " - Backend scaffold files written to $backend (Models, Controllers). See the Program.cs snippet printed above." }
Write-Host "Next steps:"
Write-Host " 1) Frontend: cd $frontend ; npm install (if needed) ; npm run dev"
Write-Host " 2) Backend (if scaffolded): cd <backend> ; dotnet restore ; add EF packages; update Program.cs; run migrations and start."
Write-Host "`nIf anything breaks, paste the FIRST red Vite error or the browser console error here and I will adjust."
