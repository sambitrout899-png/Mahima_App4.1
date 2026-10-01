<#
ensure_logo_and_layout_fix.ps1
- Locate the project root by searching upward for package.json
- Ensure public/logo.png exists (copy from candidate names in project root)
- Create src/components/Logo.jsx and src/components/Layout.jsx if missing (backs up existing)
- Patch src/App.jsx OR src/main.jsx (whichever exists) to use Layout around routes
- Uses absolute paths and writes UTF-8 without BOM

Run from any folder:
  powershell -ExecutionPolicy Bypass -File .\ensure_logo_and_layout_fix.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-ProjectRoot {
  $p = (Get-Location).Path
  while ($p -and (Split-Path $p -Parent) -ne $p) {
    if (Test-Path (Join-Path $p 'package.json')) { return $p }
    $p = Split-Path $p -Parent
  }
  return $null
}

$proj = Find-ProjectRoot
if (-not $proj) {
  Write-Error "Could not find project root (package.json). Run this in or under your project folder."
  exit 1
}
Write-Host "Project root: $proj"

# helper to write UTF8 no BOM
function Write-NoBOM($filePath, $text) {
  $dir = Split-Path -Parent $filePath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($filePath, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Wrote: $filePath"
}

# ensure logo - check candidates in project root
$logoCandidates = @('logo.png','mahima.png','mahima_logo.png','logo.jpg','logo.jpeg')
$found = $null
foreach ($c in $logoCandidates) {
  $p = Join-Path $proj $c
  if (Test-Path $p) { $found = $p; break }
}

$publicDir = Join-Path $proj 'public'
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir | Out-Null; Write-Host "Created public/ folder" }

$destLogo = Join-Path $publicDir 'logo.png'
if ($found) {
  if (Test-Path $destLogo) {
    $bak = "$destLogo.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item -Path $destLogo -Destination $bak -Force
    Write-Host "Backed up existing public/logo.png -> $(Split-Path $bak -Leaf)"
  }
  Copy-Item -Path $found -Destination $destLogo -Force
  Write-Host "Copied logo from project root -> public/logo.png"
} else {
  Write-Host "No logo file found in project root. Expected one of: $($logoCandidates -join ', ')"
  Write-Host "If you have the file elsewhere, copy it to project root as logo.png and re-run this script."
}

# write src/components/Logo.jsx
$componentsDir = Join-Path $proj 'src\components'
if (-not (Test-Path $componentsDir)) { New-Item -ItemType Directory -Path $componentsDir -Force | Out-Null; Write-Host "Created src/components/" }

$logoComp = @'
import React from "react";
import { Link } from "react-router-dom";

/**
 * Logo component - uses /logo.png from public folder
 */
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

$logoCompPath = Join-Path $componentsDir 'Logo.jsx'
if (Test-Path $logoCompPath) {
  $bak = "$logoCompPath.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
  Copy-Item $logoCompPath $bak -Force
  Write-Host "Backed up existing Logo.jsx -> $(Split-Path $bak -Leaf)"
}
Write-NoBOM $logoCompPath $logoComp

# write Layout.jsx (safe replacement - backup original)
$layoutPath = Join-Path $componentsDir 'Layout.jsx'
$layoutContent = @'
import React from "react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";

/**
 * Global Layout used by the app - header includes logo and nav.
 * Edit this file if you have a custom layout; a backup was created.
 */
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

      <main className="p-6 max-w-7xl mx-auto">
        {children}
      </main>

      <footer className="p-4 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Mahima Ministry
      </footer>
    </div>
  );
}
'@

if (Test-Path $layoutPath) {
  $bak = "$layoutPath.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
  Copy-Item $layoutPath $bak -Force
  Write-Host "Backed up existing Layout.jsx -> $(Split-Path $bak -Leaf)"
}
Write-NoBOM $layoutPath $layoutContent

# Now patch entry point: prefer src/App.jsx; otherwise src/main.jsx
$entryCandidates = @('src\App.jsx','src\main.jsx','src\index.jsx')
$patched = $false
foreach ($rel in $entryCandidates) {
  $entry = Join-Path $proj $rel
  if (Test-Path $entry) {
    # back up original
    $bak = "$entry.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item $entry $bak -Force
    Write-Host "Backed up entry $rel -> $(Split-Path $bak -Leaf)"

    # create a safe App wrapper if App.jsx found OR patch main.jsx to mount <App/> inside <Layout>
    $content = Get-Content -Raw -Encoding UTF8 $entry

    if ($rel -ieq 'src\App.jsx') {
      # Replace or create App.jsx content that uses Layout and routes.
      $newApp = @'
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
      Write-NoBOM $entry $newApp
      Write-Host "Patched App.jsx to render Layout + routes"
      $patched = $true
      break
    } else {
      # For main.jsx or index.jsx, attempt to ensure the app is mounted inside BrowserRouter and Layout
      # We'll create a simple main that mounts App inside BrowserRouter and Layout
      $mainNew = @'
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
      Write-NoBOM $entry $mainNew
      Write-Host "Patched $rel (main/index) to mount App inside BrowserRouter"
      $patched = $true
      break
    }
  }
}

if (-not $patched) {
  Write-Host "No entry file (src/App.jsx or src/main.jsx or src/index.jsx) found to patch. You may need to integrate Layout manually into your app entry."
} else {
  Write-Host "Patched entry. Restart dev server (npm run dev) and reload the page."
}

Write-Host "`nFinished. If the logo still doesn't appear:"
Write-Host " - Open browser DevTools -> Network -> check that GET /logo.png returns 200."
Write-Host " - If GET /logo.png returns 404, ensure public/logo.png exists."
Write-Host " - If still failing, paste the first 30 lines of src/components/Logo.jsx and the browser console error (if any)."
