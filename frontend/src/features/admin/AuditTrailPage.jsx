import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { API_BASE } from "../../api";
import { apiFetch } from "../../utils/fetch-auth-shim";
import { getToken } from "../../utils/auth";

const PAGE_SIZE = 50;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function shortId(value) {
  if (!value) return "-";
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function arrayFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function userDisplay(user) {
  if (!user) return "";
  return user.displayName || user.name || user.username || user.email || user.phone || "";
}

function userIdOf(user) {
  return user?.id || user?.Id || user?.userId || user?.UserId || user?._id || user?.uuid || "";
}

function friendlyEntityName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Record";
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced || "Record";
}

function friendlyAction(value = "") {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.startsWith("Entity")) return text.replace(/^Entity/, "Record ");
  if (text.startsWith("Http")) return text.replace(/^Http/, "Request ");
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function resolveUserName(value, usersById) {
  const id = String(value || "").trim();
  if (!id) return "";
  return usersById[id.toLowerCase()] || "";
}

function replaceKnownUserIds(value, usersById) {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  return value.replace(UUID_RE, (match) => resolveUserName(match, usersById) || match);
}

function entitySubject(row, usersById) {
  const entityType = row.entityType ?? row.EntityType;
  const entityId = row.entityId ?? row.EntityId;
  const details = parseDetails(row.details ?? row.Details);

  if (String(entityType || "").toLowerCase() === "user") {
    return resolveUserName(entityId, usersById) || "User record";
  }

  if (entityId) {
    const parts = String(entityId).split(",");
    const names = parts.map((part) => resolveUserName(part, usersById)).filter(Boolean);
    if (names.length) return names.join(", ");
  }

  const changes = details?.changes;
  if (changes && typeof changes === "object") {
    for (const key of ["UserId", "userId", "SenderId", "CreatedBy", "ActorId", "actorId"]) {
      const value = changes[key]?.newValue ?? changes[key];
      const name = resolveUserName(value, usersById);
      if (name) return name;
    }
  }

  return friendlyEntityName(entityType);
}

function parseDetails(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function detailsPreview(value, usersById = {}) {
  const parsed = parseDetails(value);
  const text = typeof parsed === "string"
    ? replaceKnownUserIds(parsed, usersById)
    : JSON.stringify(humanizeDetails(parsed || {}, usersById));
  return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

function humanizeDetails(value, usersById) {
  if (Array.isArray(value)) return value.map((item) => humanizeDetails(item, usersById));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
      const label = friendlyEntityName(key);
      if (key.toLowerCase() === "entity") return [label, friendlyEntityName(raw)];
      return [label, humanizeDetails(raw, usersById)];
    }));
  }
  return replaceKnownUserIds(value, usersById);
}

function actionTone(action = "") {
  const value = String(action).toLowerCase();
  if (value.includes("delete")) return "bg-red-50 text-red-700 border-red-100";
  if (value.includes("modified") || value.includes("patch") || value.includes("put")) return "bg-amber-50 text-amber-700 border-amber-100";
  if (value.includes("added") || value.includes("post")) return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function defaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

function buildQuery(filters, page) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  Object.entries({
    q: filters.q,
    action: filters.action,
    entityType: filters.entityType,
    entityId: filters.entityId,
    actorId: filters.actorId,
    fromUtc: filters.fromUtc ? `${filters.fromUtc}T00:00:00Z` : "",
    toUtc: filters.toUtc ? `${filters.toUtc}T23:59:59Z` : "",
  }).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

export default function AuditTrailPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 0 });
  const [filters, setFilters] = useState({
    q: "",
    action: "",
    entityType: "",
    entityId: "",
    actorId: "",
    fromUtc: defaultFromDate(),
    toUtc: "",
  });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [usersById, setUsersById] = useState({});

  const activeDetails = useMemo(
    () => humanizeDetails(parseDetails(selected?.details ?? selected?.Details), usersById),
    [selected, usersById]
  );

  async function loadUsers() {
    try {
      const data = await apiFetch("/users?page=1&limit=1000", { timeoutMs: 45000 });
      const map = {};
      for (const user of arrayFrom(data)) {
        const id = userIdOf(user);
        const name = userDisplay(user);
        if (id && name) map[String(id).toLowerCase()] = name;
      }
      setUsersById(map);
    } catch {
      setUsersById({});
    }
  }

  async function load(page = meta.page, nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch(`/audit-trail?${buildQuery(nextFilters, page)}`, {
        timeoutMs: 45000,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setRows(items);
      setMeta({
        total: Number(data?.total || 0),
        page: Number(data?.page || page),
        pageSize: Number(data?.pageSize || PAGE_SIZE),
        totalPages: Number(data?.totalPages || 0),
      });
    } catch (err) {
      setError(err?.body || err?.message || "Could not load audit trail.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1, filters);
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDraft(key, value) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setFilters(draftFilters);
    load(1, draftFilters);
  }

  function resetFilters() {
    const next = {
      q: "",
      action: "",
      entityType: "",
      entityId: "",
      actorId: "",
      fromUtc: defaultFromDate(),
      toUtc: "",
    };
    setDraftFilters(next);
    setFilters(next);
    load(1, next);
  }

  async function downloadCsv() {
    const params = new URLSearchParams();
    Object.entries({
      q: filters.q,
      action: filters.action,
      entityType: filters.entityType,
      entityId: filters.entityId,
      actorId: filters.actorId,
      fromUtc: filters.fromUtc ? `${filters.fromUtc}T00:00:00Z` : "",
      toUtc: filters.toUtc ? `${filters.toUtc}T23:59:59Z` : "",
    }).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const token = getToken();
    const res = await fetch(`${API_BASE}/audit-trail/export.csv?${params.toString()}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "include",
    });
    if (!res.ok) {
      setError(`CSV export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header
        id="mahima-audit-trail-page-header"
        className="mahima-standard-page-header px-4 sm:px-6 py-4"
        data-mahima-explicit-header="true"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 text-white flex items-center justify-center border border-white/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="mahima-standard-page-title text-xl font-semibold tracking-tight" data-mahima-explicit-title="true">Audit Trail</h1>
              <p className="mahima-standard-page-subtitle text-sm">Admin view of application actions with user names and readable records.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => load(meta.page, filters)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 space-y-4">
        <div className="border border-slate-200 bg-white rounded-lg p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <label className="xl:col-span-2">
              <span className="text-xs font-semibold uppercase text-slate-500">Search</span>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={draftFilters.q}
                  onChange={(e) => updateDraft("q", e.target.value)}
                  placeholder="Action, entity, details"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </label>
            <FilterInput label="Action" value={draftFilters.action} onChange={(v) => updateDraft("action", v)} placeholder="HttpPOST" />
            <FilterInput label="Record type" value={draftFilters.entityType} onChange={(v) => updateDraft("entityType", v)} placeholder="User" />
            <FilterInput label="Record ID" value={draftFilters.entityId} onChange={(v) => updateDraft("entityId", v)} placeholder="Exact id" />
            <DateInput label="From" value={draftFilters.fromUtc} onChange={(v) => updateDraft("fromUtc", v)} />
            <DateInput label="To" value={draftFilters.toUtc} onChange={(v) => updateDraft("toUtc", v)} />
          </div>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <label className="max-w-xl flex-1">
              <span className="text-xs font-semibold uppercase text-slate-500">User ID</span>
              <input
                value={draftFilters.actorId}
                onChange={(e) => updateDraft("actorId", e.target.value)}
                placeholder="User GUID"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <X className="w-4 h-4" />
                Reset
              </button>
              <button
                type="button"
                onClick={applyFilters}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Filter className="w-4 h-4" />
                Apply
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <div className="text-sm font-semibold text-slate-700">
              {meta.total.toLocaleString()} records
            </div>
            <div className="text-xs text-slate-500">
              Page {meta.page || 1} of {meta.totalPages || 1}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Time</th>
                  <th className="px-3 py-2 text-left font-semibold">Action</th>
                  <th className="px-3 py-2 text-left font-semibold">Affected</th>
                  <th className="px-3 py-2 text-left font-semibold">User</th>
                  <th className="px-3 py-2 text-left font-semibold">Details</th>
                  <th className="px-3 py-2 text-right font-semibold">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                      <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
                      Loading audit trail...
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">No audit records match the filters.</td>
                  </tr>
                )}
                {rows.map((row) => {
                  const action = row.action ?? row.Action;
                  const entityType = row.entityType ?? row.EntityType;
                  const entityId = row.entityId ?? row.EntityId;
                  const actorId = row.actorId ?? row.ActorId;
                  const details = row.details ?? row.Details;
                  return (
                    <tr key={row.id ?? row.Id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">{formatDate(row.createdAt ?? row.CreatedAt)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${actionTone(action)}`}>
                          {friendlyAction(action)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800">{entitySubject(row, usersById)}</div>
                        <div className="text-xs text-slate-500">{friendlyEntityName(entityType)}</div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">{resolveUserName(actorId, usersById) || "System"}</td>
                      <td className="px-3 py-2 max-w-xl">
                        <div className="truncate text-slate-600">{detailsPreview(details, usersById)}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <FileSearch className="w-3.5 h-3.5" />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2">
            <button
              type="button"
              onClick={() => load(Math.max(1, meta.page - 1), filters)}
              disabled={loading || meta.page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <button
              type="button"
              onClick={() => load(meta.page + 1, filters)}
              disabled={loading || meta.page >= meta.totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[120] bg-slate-900/40 flex justify-end" onClick={() => setSelected(null)}>
          <aside className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-500">Audit Record</div>
                <div className="text-lg font-semibold">{friendlyAction(selected.action ?? selected.Action)}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <Fact label="Time" value={formatDate(selected.createdAt ?? selected.CreatedAt)} />
                <Fact label="User" value={resolveUserName(selected.actorId ?? selected.ActorId, usersById) || "System"} />
                <Fact label="Affected" value={entitySubject(selected, usersById)} />
                <Fact label="Record type" value={friendlyEntityName(selected.entityType ?? selected.EntityType)} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Details</div>
                <pre className="rounded-lg border border-slate-200 bg-slate-950 text-slate-100 p-3 text-xs overflow-auto max-h-[60vh]">
                  {typeof activeDetails === "string" ? activeDetails : JSON.stringify(activeDetails, null, 2)}
                </pre>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </label>
  );
}

function DateInput({ label, value, onChange }) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <div className="relative mt-1">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
    </label>
  );
}

function Fact({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className={`mt-1 text-sm text-slate-900 break-all ${mono ? "font-mono" : "font-semibold"}`}>{value}</div>
    </div>
  );
}
