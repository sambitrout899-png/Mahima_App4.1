import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  HardDrive,
  Home,
  Info,
  LayoutList,
  Loader2,
  MoveRight,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { API_BASE } from "../../api";
import { getToken } from "../../utils/auth";
import { apiFetch } from "../../utils/fetch-auth-shim";

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function withAccessToken(url, token) {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}

function isChildPath(parentPath, childPath) {
  const parent = String(parentPath || "").replace(/\/+$/, "");
  const child = String(childPath || "");
  return Boolean(parent) && child.startsWith(`${parent}/`);
}

function fileKind(entry) {
  if (entry?.isDirectory) return "Folder";
  const ext = String(entry?.name || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "Image";
  if (["mp4", "mov", "mkv", "avi", "webm"].includes(ext)) return "Video";
  if (["mp3", "wav", "m4a", "ogg", "aac"].includes(ext)) return "Audio";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "Archive";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"].includes(ext)) return "Document";
  return "File";
}

function FileIcon({ entry, className = "h-5 w-5" }) {
  const kind = fileKind(entry);
  if (kind === "Folder") return <Folder className={className} />;
  if (kind === "Image") return <FileImage className={className} />;
  if (kind === "Video") return <FileVideo className={className} />;
  if (kind === "Audio") return <FileAudio className={className} />;
  if (kind === "Archive") return <FileArchive className={className} />;
  if (kind === "Document") return <FileText className={className} />;
  return <File className={className} />;
}

function TransferProgress({ transfer }) {
  if (!transfer) return null;

  const total = Number(transfer.total || 0);
  const loaded = Number(transfer.loaded || 0);
  const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-blue-950">
            {transfer.type === "download" ? "Downloading" : "Uploading"} {transfer.name}
          </p>
          <p className="text-xs font-bold text-blue-700">
            {transfer.queue ? `${transfer.queue} - ` : ""}
            {formatSize(loaded)}
            {total > 0 ? ` of ${formatSize(total)}` : ""} {percent !== null ? `- ${percent}%` : ""}
          </p>
        </div>
        {transfer.status === "done" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Complete
          </span>
        )}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
        <div
          className={`h-full rounded-full bg-blue-600 transition-all ${percent === null ? "animate-pulse" : ""}`}
          style={{ width: percent === null ? "35%" : `${percent}%` }}
        />
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function ServerFilesPage() {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState(null);
  const [root, setRoot] = useState("");
  const [entries, setEntries] = useState([]);
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [view, setView] = useState("list");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState("");
  const [transfer, setTransfer] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [transferModal, setTransferModal] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [renameName, setRenameName] = useState("");
  const [transferDestination, setTransferDestination] = useState("");

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.has(entry.path)),
    [entries, selectedPaths]
  );

  const folders = useMemo(() => entries.filter((entry) => entry.isDirectory), [entries]);
  const files = useMemo(() => entries.filter((entry) => !entry.isDirectory), [entries]);
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + Number(file.size || 0), 0), [files]);

  const visibleEntries = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = term
      ? entries.filter((entry) => entry.name.toLowerCase().includes(term) || fileKind(entry).toLowerCase().includes(term))
      : entries;

    return [...filtered].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const direction = sortDir === "desc" ? -1 : 1;
      if (sortBy === "modified") {
        return direction * (new Date(a.modifiedAtUtc || 0) - new Date(b.modifiedAtUtc || 0));
      }
      if (sortBy === "size") return direction * (Number(a.size || 0) - Number(b.size || 0));
      return direction * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [entries, query, sortBy, sortDir]);

  const singleSelection = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const currentSegments = currentPath ? currentPath.split("/").filter(Boolean) : [];

  async function load(path = currentPath, nextSortBy = sortBy, nextSortDir = sortDir) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      params.set("sortBy", nextSortBy);
      params.set("direction", nextSortDir);
      const queryString = params.toString() ? `?${params.toString()}` : "";
      const data = await apiFetch(`/server-files${queryString}`);
      setRoot(data?.root || "");
      setCurrentPath(data?.path || "");
      setParentPath(data?.parentPath ?? null);
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
      setSelectedPaths(new Set());
    } catch (err) {
      setError(err?.body || err?.message || "Could not load server files.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  function toggleSelected(entry) {
    setSelectedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedPaths((previous) => {
      if (visibleEntries.length > 0 && visibleEntries.every((entry) => previous.has(entry.path))) return new Set();
      return new Set(visibleEntries.map((entry) => entry.path));
    });
  }

  async function uploadFiles(fileList) {
    const filesToUpload = Array.from(fileList || []).filter(Boolean);
    if (filesToUpload.length === 0) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      for (let index = 0; index < filesToUpload.length; index += 1) {
        const file = filesToUpload[index];
        const relativePath = file.webkitRelativePath || "";
        const form = new FormData();
        form.append("file", file);
        if (currentPath) form.append("path", currentPath);
        if (relativePath) form.append("relativePath", relativePath);

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const token = getToken();
          xhr.open("POST", withAccessToken(`${API_BASE}/server-files/upload`, token));
          xhr.withCredentials = true;
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

          xhr.upload.onprogress = (event) => {
            setTransfer({
              type: "upload",
              name: relativePath || file.name,
              loaded: event.loaded,
              total: event.lengthComputable ? event.total : file.size,
              status: "active",
              queue: filesToUpload.length > 1 ? `${index + 1}/${filesToUpload.length}` : "",
            });
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
            else reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error("Network error during upload."));
          xhr.onabort = () => reject(new Error("Upload cancelled."));

          setTransfer({
            type: "upload",
            name: relativePath || file.name,
            loaded: 0,
            total: file.size,
            status: "active",
            queue: filesToUpload.length > 1 ? `${index + 1}/${filesToUpload.length}` : "",
          });
          xhr.send(form);
        });
      }

      const hasFolders = filesToUpload.some((file) => file.webkitRelativePath);
      setMessage(`${filesToUpload.length} file${filesToUpload.length === 1 ? "" : "s"} uploaded${hasFolders ? " with folder structure" : ""}.`);
      const last = filesToUpload[filesToUpload.length - 1];
      setTransfer({
        type: "upload",
        name: last.webkitRelativePath || last.name,
        loaded: last.size,
        total: last.size,
        status: "done",
      });
      window.setTimeout(() => setTransfer(null), 1800);
      await load(currentPath);
    } catch (err) {
      setError(err?.message || "Upload failed.");
      setTransfer(null);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  async function downloadFile(file) {
    setError("");
    setMessage("");
    setDownloadingPath(file.path);

    try {
      const token = getToken();
      const url = withAccessToken(`${API_BASE}/server-files/download?path=${encodeURIComponent(file.path)}`, token);
      const blob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.responseType = "blob";
        xhr.withCredentials = true;
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.onprogress = (event) => {
          setTransfer({
            type: "download",
            name: file.name,
            loaded: event.loaded,
            total: event.lengthComputable ? event.total : file.size,
            status: "active",
          });
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
          else reject(new Error(`Download failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error during download."));
        xhr.onabort = () => reject(new Error("Download cancelled."));

        setTransfer({
          type: "download",
          name: file.name,
          loaded: 0,
          total: file.size || 0,
          status: "active",
        });
        xhr.send();
      });

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.name || "server-file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      setTransfer({
        type: "download",
        name: file.name,
        loaded: file.size || blob.size || 0,
        total: file.size || blob.size || 0,
        status: "done",
      });
      window.setTimeout(() => setTransfer(null), 1800);
    } catch (err) {
      setError(err?.message || "Download failed.");
      setTransfer(null);
    } finally {
      setDownloadingPath("");
    }
  }

  async function downloadSelected() {
    if (selectedEntries.length === 0) {
      setError("Select one or more files or folders to download.");
      return;
    }

    for (const entry of selectedEntries) {
      await downloadFile(entry);
    }
  }

  function openTransfer(kind) {
    if (selectedEntries.length === 0) return;
    setTransferDestination(currentPath);
    setTransferModal(kind);
  }

  async function transferSelected(event) {
    event.preventDefault();
    if (!transferModal || selectedEntries.length === 0) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      for (const entry of selectedEntries) {
        await apiFetch(`/server-files/${transferModal}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourcePath: entry.path,
            destinationPath: transferDestination.trim(),
          }),
        });
      }
      setMessage(`${selectedEntries.length} item${selectedEntries.length === 1 ? "" : "s"} ${transferModal === "copy" ? "copied" : "moved"}.`);
      setTransferModal(null);
      await load(currentPath);
    } catch (err) {
      setError(err?.body || err?.message || `Could not ${transferModal} selected item.`);
    } finally {
      setBusy(false);
    }
  }

  async function createFolder(event) {
    event.preventDefault();
    if (!folderName.trim()) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await apiFetch("/server-files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, name: folderName.trim() }),
      });
      setFolderName("");
      setFolderModalOpen(false);
      setMessage("Folder created.");
      await load(currentPath);
    } catch (err) {
      setError(err?.body || err?.message || "Could not create folder.");
    } finally {
      setBusy(false);
    }
  }

  function openRename() {
    if (!singleSelection) return;
    setRenameName(singleSelection.name);
    setRenameModalOpen(true);
  }

  async function renameSelected(event) {
    event.preventDefault();
    if (!singleSelection || !renameName.trim()) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await apiFetch("/server-files/rename", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: singleSelection.path, newName: renameName.trim() }),
      });
      setRenameModalOpen(false);
      setMessage("Item renamed.");
      await load(currentPath);
    } catch (err) {
      setError(err?.body || err?.message || "Could not rename item.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (selectedEntries.length === 0) return;
    const names = selectedEntries.map((entry) => entry.name).join(", ");
    if (!window.confirm(`Delete ${selectedEntries.length} selected item(s)?\n\n${names}`)) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      for (const entry of selectedEntries) {
        await apiFetch(`/server-files?path=${encodeURIComponent(entry.path)}`, {
          method: "DELETE",
        });
      }
      setMessage(`${selectedEntries.length} item${selectedEntries.length === 1 ? "" : "s"} deleted.`);
      await load(currentPath);
    } catch (err) {
      setError(err?.body || err?.message || "Could not delete selected item.");
    } finally {
      setBusy(false);
    }
  }

  function openFolder(path) {
    load(path || "");
  }

  function breadcrumbPath(index) {
    if (index < 0) return "";
    return currentSegments.slice(0, index + 1).join("/");
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    uploadFiles(event.dataTransfer.files);
  }

  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedPaths.has(entry.path));

  return (
    <div
      className="min-h-full bg-slate-50 px-4 py-5 sm:px-6 lg:px-8"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header
            id="mahima-server-files-page-header"
            className="mahima-standard-page-header mahima-standard-page-header-attached flex flex-col gap-4 border-b border-slate-100 px-5 py-5 xl:flex-row xl:items-center xl:justify-between"
            data-mahima-explicit-header="true"
          >
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                <ShieldCheck className="h-4 w-4" />
                Admin File Workspace
              </div>
              <h1 className="mahima-standard-page-title mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl" data-mahima-explicit-title="true">Server Files</h1>
              <p className="mahima-standard-page-subtitle mt-1 max-w-3xl text-sm font-semibold text-slate-500">
                Manage backend download files with a SharePoint-style workspace: folders, search, upload queue, downloads, rename, and delete.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-5">
              <button
                type="button"
                onClick={() => setFolderModalOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700"
              >
                <FolderPlus className="h-4 w-4" />
                New
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50"
              >
                <UploadCloud className="h-4 w-4" />
                Upload
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50"
              >
                <FolderOpen className="h-4 w-4" />
                Upload Folder
              </button>
              <button
                type="button"
                onClick={() => load(currentPath)}
                disabled={loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
              <button
                type="button"
                onClick={downloadSelected}
                disabled={selectedEntries.length === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => uploadFiles(event.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={(event) => uploadFiles(event.target.files)}
            />
          </header>

          <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold text-slate-600">
              <button
                type="button"
                onClick={() => openFolder("")}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-blue-700 hover:bg-blue-50"
              >
                <Home className="h-4 w-4" />
                Root
              </button>
              {currentSegments.map((segment, index) => (
                <React.Fragment key={`${segment}-${index}`}>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                  <button
                    type="button"
                    onClick={() => openFolder(breadcrumbPath(index))}
                    className="max-w-[160px] truncate rounded-lg px-2 py-1 hover:bg-slate-100"
                  >
                    {segment}
                  </button>
                </React.Fragment>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search files and folders"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="name">Sort: Name</option>
                <option value="modified">Sort: Modified</option>
                <option value="size">Sort: Size</option>
              </select>
              <select
                value={sortDir}
                onChange={(event) => setSortDir(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={`grid h-9 w-9 place-items-center rounded-lg ${view === "list" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                  title="List view"
                >
                  <LayoutList className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  className={`grid h-9 w-9 place-items-center rounded-lg ${view === "grid" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                  title="Grid view"
                >
                  <Grid3X3 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {(message || error) && (
          <div
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${
              error
                ? "border-rose-100 bg-rose-50 text-rose-700"
                : "border-emerald-100 bg-emerald-50 text-emerald-800"
            }`}
          >
            {error ? <AlertCircle className="mt-0.5 h-4 w-4" /> : <CheckCircle2 className="mt-0.5 h-4 w-4" />}
            <span>{error || message}</span>
          </div>
        )}

        <TransferProgress transfer={transfer} />

        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <main className="space-y-5">
            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-700">
                    <HardDrive className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">Storage Root</p>
                    <p className="truncate text-sm font-black text-slate-800">{root || "Loading..."}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Items</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{entries.length}</p>
                <p className="text-sm font-bold text-slate-500">{folders.length} folders, {files.length} files</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">File Size</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{formatSize(totalSize)}</p>
                <p className="text-sm font-bold text-slate-500">Current folder total</p>
              </div>
            </section>

            <section
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                dragging ? "border-blue-400 ring-4 ring-blue-100" : "border-slate-200"
              }`}
            >
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
                    <FolderOpen className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black text-slate-950">{currentPath || "Download folder"}</h2>
                    <p className="text-xs font-bold text-slate-500">
                      {visibleEntries.length} visible - {selectedEntries.length} selected
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {parentPath !== null && (
                    <button
                      type="button"
                      onClick={() => load(parentPath || "")}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50"
                    >
                      Up one folder
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openRename}
                    disabled={!singleSelection || busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => openTransfer("copy")}
                    disabled={selectedEntries.length === 0 || busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => openTransfer("move")}
                    disabled={selectedEntries.length === 0 || busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <MoveRight className="h-4 w-4" />
                    Move
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    disabled={selectedEntries.length === 0 || busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-200"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm font-black text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading files...
                </div>
              ) : entries.length === 0 ? (
                <div className="px-4 py-16 text-center">
                  <FolderOpen className="mx-auto h-12 w-12 text-slate-300" />
                  <p className="mt-3 text-lg font-black text-slate-700">This folder is empty</p>
                  <p className="text-sm font-semibold text-slate-500">Upload files or create a folder to get started.</p>
                </div>
              ) : view === "grid" ? (
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleEntries.map((entry) => {
                    const selected = selectedPaths.has(entry.path);
                    return (
                      <div
                        key={entry.path || entry.name}
                        className={`group rounded-2xl border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md ${
                          selected ? "border-blue-500 ring-4 ring-blue-100" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => toggleSelected(entry)}
                            className={`mt-1 h-5 w-5 rounded border ${selected ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"}`}
                            aria-label={`Select ${entry.name}`}
                          />
                          <button
                            type="button"
                            onDoubleClick={() => entry.isDirectory && openFolder(entry.path)}
                            onClick={() => !entry.isDirectory && toggleSelected(entry)}
                            className="flex min-w-0 flex-1 flex-col items-center text-center"
                          >
                            <span className={`grid h-16 w-16 place-items-center rounded-2xl ${
                              entry.isDirectory ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                            }`}>
                              <FileIcon entry={entry} className="h-8 w-8" />
                            </span>
                            <span className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-black text-slate-900">
                              {entry.name}
                            </span>
                          </button>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-bold text-slate-500">
                          <span>{fileKind(entry)}</span>
                          <span>{entry.isDirectory ? "" : formatSize(entry.size)}</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          {entry.isDirectory ? (
                            <button
                              type="button"
                              onClick={() => openFolder(entry.path)}
                              className="h-9 flex-1 rounded-xl bg-slate-950 text-xs font-black text-white hover:bg-slate-800"
                            >
                              Open
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => downloadFile(entry)}
                              disabled={downloadingPath === entry.path}
                              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 text-xs font-black text-white hover:bg-slate-800 disabled:bg-slate-300"
                            >
                              {downloadingPath === entry.path ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                              Download
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-12 px-4 py-3">
                          <button
                            type="button"
                            onClick={selectAllVisible}
                            className={`h-5 w-5 rounded border ${allVisibleSelected ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"}`}
                            aria-label="Select all visible"
                          />
                        </th>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Size</th>
                        <th className="px-4 py-3">Modified</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleEntries.map((entry) => {
                        const selected = selectedPaths.has(entry.path);
                        return (
                          <tr key={entry.path || entry.name} className={selected ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"}>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => toggleSelected(entry)}
                                className={`h-5 w-5 rounded border ${selected ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"}`}
                                aria-label={`Select ${entry.name}`}
                              />
                            </td>
                            <td className="max-w-[360px] px-4 py-3">
                              <button
                                type="button"
                                onClick={() => entry.isDirectory ? openFolder(entry.path) : toggleSelected(entry)}
                                className="flex min-w-0 items-center gap-3 text-left"
                              >
                                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                                  entry.isDirectory ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                                }`}>
                                  <FileIcon entry={entry} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-black text-slate-900">{entry.name}</span>
                                  <span className="block truncate text-xs font-bold text-slate-500">{entry.path}</span>
                                </span>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm font-bold text-slate-600">{fileKind(entry)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-slate-600">{entry.isDirectory ? "-" : formatSize(entry.size)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-slate-600">{formatDate(entry.modifiedAtUtc)}</td>
                            <td className="px-4 py-3 text-right">
                              {entry.isDirectory ? (
                                <button
                                  type="button"
                                  onClick={() => openFolder(entry.path)}
                                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                >
                                  Open
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => downloadFile(entry)}
                                  disabled={downloadingPath === entry.path}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                                >
                                  {downloadingPath === entry.path ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                  Download
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </main>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-700">
                  <Info className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-black text-slate-950">Details</h2>
                  <p className="text-xs font-bold text-slate-500">{selectedEntries.length} selected</p>
                </div>
              </div>

              {singleSelection ? (
                <div className="mt-5 space-y-4">
                  <div className="grid place-items-center rounded-2xl bg-slate-50 p-6 text-blue-700">
                    <FileIcon entry={singleSelection} className="h-14 w-14" />
                  </div>
                  <div>
                    <p className="break-words text-base font-black text-slate-950">{singleSelection.name}</p>
                    <p className="mt-1 text-sm font-bold text-slate-500">{fileKind(singleSelection)}</p>
                  </div>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="font-black text-slate-400">Path</dt>
                      <dd className="break-words font-semibold text-slate-700">{singleSelection.path || "/"}</dd>
                    </div>
                    <div>
                      <dt className="font-black text-slate-400">Size</dt>
                      <dd className="font-semibold text-slate-700">{singleSelection.isDirectory ? "-" : formatSize(singleSelection.size)}</dd>
                    </div>
                    <div>
                      <dt className="font-black text-slate-400">Modified</dt>
                      <dd className="font-semibold text-slate-700">{formatDate(singleSelection.modifiedAtUtc)}</dd>
                    </div>
                  </dl>
                </div>
              ) : selectedEntries.length > 1 ? (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600">
                  {selectedEntries.length} items selected. Use the command bar to download files or delete selected items.
                </div>
              ) : (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600">
                  Select a file or folder to see metadata and actions.
                </div>
              )}
            </section>

            <section className={`rounded-2xl border border-dashed p-5 text-center shadow-sm ${
              dragging ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white"
            }`}>
              <UploadCloud className="mx-auto h-9 w-9 text-blue-600" />
              <h3 className="mt-3 text-base font-black text-slate-950">Drop files here</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">Supports large files up to your server/Nginx limit.</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
              >
                Choose files
              </button>
            </section>
          </aside>
        </div>
      </div>

      {folderModalOpen && (
        <Modal title="Create Folder" onClose={() => setFolderModalOpen(false)}>
          <form onSubmit={createFolder} className="space-y-4">
            <label className="block">
              <span className="text-sm font-black text-slate-700">Folder name</span>
              <input
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                autoFocus
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="New folder"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !folderName.trim()}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              Create
            </button>
          </form>
        </Modal>
      )}

      {renameModalOpen && (
        <Modal title="Rename Item" onClose={() => setRenameModalOpen(false)}>
          <form onSubmit={renameSelected} className="space-y-4">
            <label className="block">
              <span className="text-sm font-black text-slate-700">New name</span>
              <input
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                autoFocus
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="File or folder name"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !renameName.trim()}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Rename
            </button>
          </form>
        </Modal>
      )}

      {transferModal && (
        <Modal title={transferModal === "copy" ? "Copy Selected" : "Move Selected"} onClose={() => setTransferModal(null)}>
          <form onSubmit={transferSelected} className="space-y-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
              {selectedEntries.length} item{selectedEntries.length === 1 ? "" : "s"} selected
            </div>
            <label className="block">
              <span className="text-sm font-black text-slate-700">Destination folder path</span>
              <input
                value={transferDestination}
                onChange={(event) => setTransferDestination(event.target.value)}
                autoFocus
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="Leave blank for root"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : transferModal === "copy" ? <Copy className="h-4 w-4" /> : <MoveRight className="h-4 w-4" />}
              {transferModal === "copy" ? "Copy items" : "Move items"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
