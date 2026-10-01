import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Crown,
  GitBranch,
  GripVertical,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import api from "../../api";

const emptyForm = { id: null, name: "", description: "", parentPositionId: "", visibilityScope: "My", isActive: true };
const scopes = [
  { value: "My", label: "My", hint: "Only records owned or assigned to the person." },
  { value: "MyTeams", label: "My Teams", hint: "Personal records plus team-owned records." },
  { value: "ChurchLevel", label: "Church Level", hint: "Full ministry-level visibility. Admin users only." },
];

function scopeLabel(value) {
  if (/church/i.test(String(value))) return "Church Level";
  if (/team/i.test(String(value))) return "My Teams";
  return "My";
}

function scopeTone(value) {
  if (/church/i.test(String(value))) return "border-amber-200 bg-amber-50 text-amber-800";
  if (/team/i.test(String(value))) return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function scopeAccent(value) {
  if (/church/i.test(String(value))) return "bg-amber-500";
  if (/team/i.test(String(value))) return "bg-blue-500";
  return "bg-emerald-500";
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.assignments)) return payload.assignments;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function userIdOf(user) {
  return user?.id || user?.Id || "";
}

function userLabel(user) {
  return user?.displayName || user?.DisplayName || user?.username || user?.Username || user?.email || user?.Email || "User";
}

function userSubLabel(user) {
  return user?.username || user?.Username || user?.email || user?.Email || userIdOf(user) || "No login id";
}

function initials(value) {
  return String(value || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data ?? err?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PositionsPage() {
  const [positions, setPositions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [assignment, setAssignment] = useState({ userId: "", positionId: "", isPrimary: false });
  const [query, setQuery] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draggedPositionId, setDraggedPositionId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [p, a, u] = await Promise.all([
        api.get("/positions"),
        api.get("/positions/assignments"),
        api.get("/users", { params: { page: 1, limit: 500 } }),
      ]);
      setPositions(asArray(p));
      setAssignments(asArray(a));
      setUsers(asArray(u));
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to load positions."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (selectedPositionId && positions.some((position) => String(position.id) === String(selectedPositionId))) return;
    const firstActive = positions.find((position) => position.isActive !== false) || positions[0];
    setSelectedPositionId(firstActive?.id ? String(firstActive.id) : "");
  }, [positions, selectedPositionId]);

  const positionOptions = useMemo(() => positions.filter((position) => position.isActive !== false), [positions]);
  const selectedHierarchyPosition = useMemo(() => {
    if (!selectedPositionId) return null;
    return positions.find((position) => String(position.id) === String(selectedPositionId)) || null;
  }, [positions, selectedPositionId]);
  const selectedUser = useMemo(() => users.find((user) => String(userIdOf(user)) === String(assignment.userId)), [assignment.userId, users]);
  const selectedPosition = useMemo(() => positions.find((position) => String(position.id) === String(assignment.positionId)), [assignment.positionId, positions]);

  const assignmentRows = useMemo(() => {
    const byUser = new Map();
    assignments.forEach((row) => {
      const key = String(row.userId || row.UserId || "");
      if (!key) return;
      const current = byUser.get(key) || {
        userId: key,
        displayName: row.displayName || row.DisplayName || row.username || row.Username || "User",
        username: row.username || row.Username || "",
        positions: [],
      };
      current.positions.push({
        userId: key,
        positionId: row.positionId || row.PositionId,
        name: row.positionName || row.PositionName || "Position",
        visibilityScope: row.visibilityScope || row.VisibilityScope || "My",
        isPrimary: Boolean(row.isPrimary ?? row.IsPrimary),
        assignedAtUtc: row.assignedAtUtc || row.AssignedAtUtc,
      });
      byUser.set(key, current);
    });
    users.forEach((user) => {
      const key = String(userIdOf(user));
      if (!key || byUser.has(key)) return;
      byUser.set(key, {
        userId: key,
        displayName: userLabel(user),
        username: userSubLabel(user),
        positions: [],
      });
    });
    return Array.from(byUser.values()).sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  }, [assignments, users]);

  const usersByPosition = useMemo(() => {
    const map = new Map();
    assignmentRows.forEach((row) => {
      row.positions.forEach((position) => {
        const key = String(position.positionId || "");
        if (!key) return;
        const bucket = map.get(key) || [];
        bucket.push({ ...row, position });
        map.set(key, bucket);
      });
    });
    map.forEach((rows) => rows.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName))));
    return map;
  }, [assignmentRows]);

  const selectedPositionUsers = useMemo(() => {
    if (!selectedPositionId) return [];
    return usersByPosition.get(String(selectedPositionId)) || [];
  }, [selectedPositionId, usersByPosition]);

  const filteredAssignmentRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assignmentRows;
    return assignmentRows.filter((row) => {
      const text = [row.displayName, row.username, ...row.positions.map((position) => position.name)].join(" ").toLowerCase();
      return text.includes(needle);
    });
  }, [assignmentRows, query]);

  const treeRows = useMemo(() => {
    const byParent = new Map();
    positions.forEach((position) => {
      const key = position.parentPositionId || "root";
      byParent.set(key, [...(byParent.get(key) || []), position]);
    });
    const rows = [];
    function visit(parent, depth) {
      (byParent.get(parent) || []).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((position) => {
        rows.push({ ...position, depth });
        visit(position.id, depth + 1);
      });
    }
    visit("root", 0);
    return rows;
  }, [positions]);

  const stats = useMemo(() => {
    const assignedUsers = new Set(assignments.map((row) => String(row.userId || row.UserId || "")).filter(Boolean)).size;
    return {
      positions: positions.length,
      active: positions.filter((position) => position.isActive !== false).length,
      assignments: assignments.length,
      assignedUsers,
      churchLevel: positions.filter((position) => /church/i.test(String(position.visibilityScope))).length,
    };
  }, [assignments, positions]);

  function edit(position) {
    setNotice("");
    setForm({
      id: position.id,
      name: position.name || "",
      description: position.description || "",
      parentPositionId: position.parentPositionId || "",
      visibilityScope: position.visibilityScope || "My",
      isActive: position.isActive !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePosition(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        parentPositionId: form.parentPositionId ? Number(form.parentPositionId) : null,
        visibilityScope: form.visibilityScope,
        isActive: Boolean(form.isActive),
      };
      if (form.id) await api.put(`/positions/${form.id}`, payload);
      else await api.post("/positions", payload);
      setForm(emptyForm);
      setNotice("Position saved.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to save position."));
    } finally {
      setSaving(false);
    }
  }

  async function deletePosition(id) {
    if (!window.confirm("Deactivate this position?")) return;
    setError("");
    setNotice("");
    try {
      await api.delete(`/positions/${id}`);
      setNotice("Position deactivated.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to deactivate position."));
    }
  }

  async function movePosition(positionId, parentPositionId) {
    if (!positionId || String(positionId) === String(parentPositionId || "")) return;
    setError("");
    setNotice("");
    try {
      await api.put(`/positions/${positionId}/parent`, {
        parentPositionId: parentPositionId ? Number(parentPositionId) : null,
      });
      setNotice(parentPositionId ? "Position moved under its new parent." : "Position moved to the top level.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to update the position hierarchy."));
    } finally {
      setDraggedPositionId("");
      setDropTargetId("");
    }
  }

  function dropPosition(event, parentPositionId = null) {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPositionId) movePosition(draggedPositionId, parentPositionId);
  }

  async function saveAssignment(event) {
    event.preventDefault();
    if (!assignment.userId || !assignment.positionId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.post("/positions/assignments", {
        userId: assignment.userId,
        positionId: Number(assignment.positionId),
        isPrimary: Boolean(assignment.isPrimary),
      });
      setAssignment({ userId: "", positionId: "", isPrimary: false });
      setNotice("Position assigned to user.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to assign position."));
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment(row) {
    setError("");
    setNotice("");
    try {
      await api.delete(`/positions/assignments/${row.userId}/${row.positionId}`);
      setNotice("Assignment removed.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to remove assignment."));
    }
  }

  const summaryCards = [
    [Network, "Positions", stats.positions],
    [CheckCircle2, "Active", stats.active],
    [UserCheck, "Assignments", stats.assignments],
    [Users, "Users mapped", stats.assignedUsers],
    [Crown, "Church level", stats.churchLevel],
  ];

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-5 text-slate-950 lg:px-7">
      <section className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <GitBranch className="h-3.5 w-3.5" /> Data visibility architecture
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight">Positions</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Roles decide page visibility. Positions decide record visibility. Build the reporting hierarchy, assign users, then inspect every mapping from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" onClick={() => setForm(emptyForm)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> New position
            </button>
          </div>
        </div>
        <div className="grid border-t border-slate-100 bg-slate-50/70 md:grid-cols-5">
          {summaryCards.map(([Icon, label, value]) => (
            <div key={label} className="flex items-center gap-3 border-b border-r border-slate-100 p-4 last:border-r-0 md:border-b-0">
              <div className="rounded-lg bg-white p-2 text-slate-700 shadow-sm"><Icon className="h-4 w-4" /></div>
              <div>
                <div className="text-xl font-black">{value}</div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</div>}

      <div className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start gap-3 border-b border-slate-100 p-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">1</div>
            <div>
              <h2 className="text-lg font-black">Define Position</h2>
              <p className="mt-1 text-sm text-slate-500">Create hierarchy nodes and decide each node's data visibility boundary.</p>
            </div>
          </div>
          <form onSubmit={savePosition} className="grid gap-4 p-5">
            <label className="grid gap-1 text-sm font-bold text-slate-700">Position name
              <input className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none ring-emerald-200 focus:ring-4" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Example: Worship Lead" />
            </label>
            <div className="grid gap-4">
              <label className="grid gap-1 text-sm font-bold text-slate-700">Visibility
                <select className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none ring-emerald-200 focus:ring-4" value={form.visibilityScope} onChange={(event) => setForm({ ...form, visibilityScope: event.target.value })}>
                  {scopes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
                </select>
              </label>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
              Parent and child relationships are managed directly in the Position Hierarchy panel by drag and drop.
            </div>
            <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${scopeTone(form.visibilityScope)}`}>
              {scopes.find((scope) => scope.value === form.visibilityScope)?.hint || "Personal visibility."}
            </div>
            <label className="grid gap-1 text-sm font-bold text-slate-700">Description
              <textarea className="min-h-24 rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none ring-emerald-200 focus:ring-4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe what this position is responsible for." />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active
              </label>
              <div className="flex gap-2">
                {form.id && <button type="button" onClick={() => setForm(emptyForm)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"><X className="h-4 w-4" /> Cancel</button>}
                <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"><Save className="h-4 w-4" /> Save</button>
              </div>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start gap-3 border-b border-slate-100 p-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">2</div>
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black"><ShieldCheck className="h-5 w-5 text-emerald-600" /> Assign User Position</h2>
              <p className="mt-1 text-sm text-slate-500">Assign one or more positions. Mark one as primary so login starts with that data scope.</p>
            </div>
          </div>
          <form onSubmit={saveAssignment} className="grid gap-4 p-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold text-slate-700">User
                <select className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none ring-emerald-200 focus:ring-4" value={assignment.userId} onChange={(event) => setAssignment({ ...assignment, userId: event.target.value })}>
                  <option value="">Select user</option>
                  {users.map((user) => <option key={userIdOf(user)} value={userIdOf(user)}>{userLabel(user)} - {userSubLabel(user)}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-700">Position
                <select className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none ring-emerald-200 focus:ring-4" value={assignment.positionId} onChange={(event) => setAssignment({ ...assignment, positionId: event.target.value })}>
                  <option value="">Select position</option>
                  {positionOptions.map((position) => <option key={position.id} value={position.id}>{position.name} - {scopeLabel(position.visibilityScope)}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="text-sm text-slate-600">
                <div className="font-bold text-slate-900">{selectedUser ? userLabel(selectedUser) : "No user selected"}</div>
                <div>{selectedPosition ? `${selectedPosition.name} - ${scopeLabel(selectedPosition.visibilityScope)}` : "Choose a position to assign"}</div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={assignment.isPrimary} onChange={(event) => setAssignment({ ...assignment, isPrimary: event.target.checked })} /> Primary login position
              </label>
            </div>
            <button disabled={saving || !assignment.userId || !assignment.positionId} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-sm disabled:opacity-50 hover:bg-emerald-700">Assign position</button>
          </form>
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(360px,0.92fr)_minmax(0,1.08fr)]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white">3</div>
              <div>
                <h2 className="text-lg font-black">Position Hierarchy</h2>
                <p className="mt-1 text-sm text-slate-500">Drag a position onto another to make it a child. Double-click any position to edit its definition.</p>
              </div>
            </div>
            <GitBranch className="h-5 w-5 shrink-0 text-slate-400" />
          </div>
          <div className="max-h-[650px] overflow-auto p-3">
            <div
              onDragOver={(event) => { event.preventDefault(); setDropTargetId("root"); }}
              onDragLeave={() => setDropTargetId("")}
              onDrop={(event) => dropPosition(event, null)}
              className={`mb-3 rounded-lg border-2 border-dashed px-4 py-3 text-center text-xs font-bold transition ${dropTargetId === "root" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}
            >
              Drop here to make a position top-level
            </div>
            {loading ? <div className="p-5 text-sm text-slate-500">Loading positions...</div> : treeRows.map((position) => {
              const isSelected = String(selectedPositionId) === String(position.id);
              const assignedCount = (usersByPosition.get(String(position.id)) || []).length;
              const depth = Number(position.depth || 0);
              return (
                <button
                  key={position.id}
                  type="button"
                  onClick={() => setSelectedPositionId(String(position.id))}
                  onDoubleClick={() => edit(position)}
                  draggable
                  onDragStart={(event) => { setDraggedPositionId(String(position.id)); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(position.id)); }}
                  onDragEnd={() => { setDraggedPositionId(""); setDropTargetId(""); }}
                  onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (String(position.id) !== String(draggedPositionId)) setDropTargetId(String(position.id)); }}
                  onDragLeave={() => setDropTargetId("")}
                  onDrop={(event) => dropPosition(event, position.id)}
                  title="Drag to change hierarchy; double-click to edit"
                  className={`mb-2 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border py-3 pl-2 pr-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60 ${dropTargetId === String(position.id) ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : isSelected ? "border-emerald-300 bg-emerald-50 shadow-sm ring-1 ring-emerald-200" : "border-slate-200 bg-white"} ${draggedPositionId === String(position.id) ? "opacity-50" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3" style={{ paddingLeft: `${depth * 22}px` }}>
                    <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-slate-400" />
                    <span className={`h-10 w-1.5 shrink-0 rounded-full ${scopeAccent(position.visibilityScope)}`} />
                    <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-black text-slate-500">L{depth}</span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-black text-slate-950">{position.name}</span>
                        {position.isActive === false && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Inactive</span>}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">{position.parentName ? `Reports under ${position.parentName}` : "Top-level position"}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${scopeTone(position.visibilityScope)}`}>{scopeLabel(position.visibilityScope)}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{assignedCount} users</span>
                  </div>
                </button>
              );
            })}
            {!loading && treeRows.length === 0 && <div className="p-5 text-sm text-slate-500">No positions defined yet.</div>}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-black">Associated Users</h2>
                <p className="mt-1 text-sm text-slate-500">The selected position's user list, primary login markers, and assignment dates.</p>
              </div>
              {selectedHierarchyPosition && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => edit(selectedHierarchyPosition)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                  <button type="button" onClick={() => deletePosition(selectedHierarchyPosition.id)} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" /> Deactivate</button>
                </div>
              )}
            </div>
            {selectedHierarchyPosition ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-black text-slate-950">{selectedHierarchyPosition.name}</h3>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${scopeTone(selectedHierarchyPosition.visibilityScope)}`}>{scopeLabel(selectedHierarchyPosition.visibilityScope)}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">{selectedPositionUsers.length} associated</span>
                </div>
                <div className="mt-2 text-xs font-semibold text-slate-500">{selectedHierarchyPosition.parentName ? `Reports under ${selectedHierarchyPosition.parentName}` : "Top-level position"}</div>
                {selectedHierarchyPosition.description && <p className="mt-3 text-sm text-slate-600">{selectedHierarchyPosition.description}</p>}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">Select a position from the hierarchy.</div>
            )}
          </div>

          <div className="max-h-[520px] overflow-auto p-4">
            {selectedPositionUsers.length ? selectedPositionUsers.map((row) => (
              <div key={`${row.userId}-${row.position.positionId}`} className="mb-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm last:mb-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">{initials(row.displayName)}</div>
                    <div className="min-w-0">
                      <div className="truncate font-black text-slate-950">{row.displayName}</div>
                      <div className="truncate text-xs text-slate-500">{row.username || row.userId}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.position.isPrimary && <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">Primary</span>}
                    {row.position.assignedAtUtc && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{formatDateTime(row.position.assignedAtUtc)}</span>}
                    <button type="button" onClick={() => removeAssignment(row.position)} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100">Remove</button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500">
                No users are assigned to this position yet.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black">All User To Position Mapping</h2>
            <p className="mt-1 text-sm text-slate-500">Complete assignment register with primary login positions. Click a position chip to inspect its users above.</p>
          </div>
          <label className="relative min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none ring-emerald-200 focus:ring-4" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users or positions" />
          </label>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <div className="grid grid-cols-[1fr_1.5fr] border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
            <div>User</div>
            <div>Assigned positions</div>
          </div>
          {filteredAssignmentRows.map((row) => (
            <div key={row.userId} className="grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 md:grid-cols-[1fr_1.5fr]">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-700">{initials(row.displayName)}</div>
                <div className="min-w-0">
                  <div className="truncate font-black text-slate-950">{row.displayName}</div>
                  <div className="truncate text-xs text-slate-500">{row.username || row.userId}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.positions.length ? row.positions.map((position) => (
                  <button key={`${row.userId}-${position.positionId}`} type="button" onClick={() => setSelectedPositionId(String(position.positionId))} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${scopeTone(position.visibilityScope)} hover:ring-2 hover:ring-emerald-100`}>
                    {position.name} - {scopeLabel(position.visibilityScope)}
                    {position.isPrimary && <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">Primary</span>}
                    {position.assignedAtUtc && <span className="text-[10px] font-semibold opacity-70">{formatDateTime(position.assignedAtUtc)}</span>}
                    <span onClick={(event) => { event.stopPropagation(); removeAssignment(position); }} className="rounded-full px-1 font-black text-rose-600 hover:bg-white" title="Remove assignment">x</span>
                  </button>
                )) : <span className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-400">No position assigned</span>}
              </div>
            </div>
          ))}
          {!filteredAssignmentRows.length && <div className="p-5 text-sm text-slate-500">No matching users or positions.</div>}
        </div>
      </section>
    </main>
  );
}
