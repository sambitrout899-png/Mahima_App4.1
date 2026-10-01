import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Search,
  X,
  ListTodo,
  LayoutGrid,
  Columns3,
  Flame,
  Flag,
  CalendarDays,
  Filter,
  SortAsc,
  Inbox,
  Loader2,
  TrendingUp,
  Pause,
  PlayCircle,
  Users,
  User,
  ChevronDown,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const API_BASE = import.meta.env?.VITE_API_BASE || "/api";

const STATUS = {
  0: { label: "Pending",     color: "#f59e0b", soft: "#fef3c7", icon: Circle      },
  1: { label: "In Progress", color: "#3b82f6", soft: "#dbeafe", icon: PlayCircle  },
  2: { label: "Completed",   color: "#10b981", soft: "#d1fae5", icon: CheckCircle2},
  3: { label: "On Hold",     color: "#ef4444", soft: "#fee2e2", icon: Pause       },
};

const PRIORITY = {
  1: { label: "Low",      color: "#94a3b8", soft: "#f1f5f9" },
  2: { label: "Normal",   color: "#3b82f6", soft: "#dbeafe" },
  3: { label: "High",     color: "#f59e0b", soft: "#fef3c7" },
  4: { label: "Critical", color: "#ef4444", soft: "#fee2e2" },
  5: { label: "Urgent",   color: "#dc2626", soft: "#fecaca" },
};

const TASK_TYPES = [
  { value: "general", label: "General" },
  { value: "pastoral-care", label: "Pastoral care" },
  { value: "prayer-follow-up", label: "Prayer follow-up" },
  { value: "member-care", label: "Member care" },
  { value: "visitor-follow-up", label: "Visitor follow-up" },
  { value: "service-planning", label: "Service planning" },
  { value: "worship", label: "Worship" },
  { value: "sermon-prep", label: "Sermon prep" },
  { value: "event", label: "Event" },
  { value: "outreach", label: "Outreach" },
  { value: "discipleship", label: "Discipleship" },
  { value: "children-youth", label: "Children/youth" },
  { value: "admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "facility", label: "Facility" },
  { value: "media", label: "Media" },
  { value: "volunteer", label: "Volunteer" },
  { value: "counselling", label: "Counselling" },
];

const PROCESS_STAGES = [
  { value: "intake", label: "Intake" },
  { value: "assigned", label: "Assigned" },
  { value: "in-progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "follow-up", label: "Follow-up" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

const labelFrom = (items, value, fallback = "General") =>
  items.find((x) => x.value === value)?.label || fallback;
const subTaskPlural = (count) => count === 1 ? "" : "s";

/* ------------------------------------------------------------------ */
/*  API helpers                                                        */
/* ------------------------------------------------------------------ */

function getToken() {
  const keys = ["authToken", "mahima_token", "mahimaToken"];
  for (const k of keys) {
    const v = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (v) return v.replace(/^Bearer\s+/i, "");
  }
  return "";
}

async function api(path, opt = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path.startsWith("/") ? path : "/" + path}`, {
    ...opt,
    headers: {
      ...(opt.headers || {}),
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(json?.message || res.statusText || "Request failed");
  return json;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

const fmtDate = (d) => {
  if (!d) return null;
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const isOverdue = (t) =>
  t.dueDate && t.status !== 2 && new Date(t.dueDate).getTime() < Date.now();

function readOnlyMessage(task) {
  const reason = task?.visibilityReason || "";
  if (reason.startsWith("member-")) {
    return "Member position users can edit only records they created.";
  }
  if (reason === "same-position-readonly") {
    return "Same-position visibility: ask the position leader to assign this task before editing.";
  }
  if (reason === "position-scope") {
    return "This task is visible to your position, but not editable until assigned to you.";
  }
  return "This task is read-only for your current position.";
}

const daysUntil = (d) => {
  if (!d) return null;
  const ms = new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
  return Math.round(ms / 86400000);
};

const dueLabel = (t) => {
  if (!t.dueDate) return "No due date";
  const n = daysUntil(t.dueDate);
  if (n < 0)  return `${Math.abs(n)}d overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n < 7)  return `Due in ${n}d`;
  return fmtDate(t.dueDate);
};

/* ----- People / teams helpers ----- */
const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase() || "?";

// deterministic pleasant color from a string
const AVATAR_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
];
const colorFor = (key) => {
  const s = String(key ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const normalizeUser = (u) => ({
  id: u.id ?? u.Id,
  type: "user",
  name: u.name ?? u.Name ?? u.fullName ?? u.FullName ?? u.displayName ?? u.DisplayName ?? u.email ?? u.Email ?? "User",
  email: u.email ?? u.Email ?? "",
  avatarUrl: u.avatarUrl ?? u.AvatarUrl ?? u.avatar ?? u.Avatar ?? null,
});
const normalizeTeam = (t) => ({
  id: t.id ?? t.Id,
  type: "team",
  name: t.name ?? t.Name ?? "Team",
  memberCount: t.memberCount ?? t.MemberCount ?? null,
  color: t.color ?? t.Color ?? null,
});
const normalizeAssignee = (a) => {
  if (!a) return null;
  const type = (a.type ?? a.Type ?? a.assigneeType ?? a.AssigneeType ?? "user").toString().toLowerCase();
  return type === "team" ? normalizeTeam(a) : normalizeUser(a);
};

const sameAssignee = (a, b) => a && b && a.type === b.type && String(a.id) === String(b.id);

/* ------------------------------------------------------------------ */
/*  Toast system                                                       */
/* ------------------------------------------------------------------ */

function useToasts() {
  const [items, setItems] = useState([]);
  const push = (msg, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  };
  return { items, push };
}

function Toasts({ items }) {
  return (
    <div className="toast-stack">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === "success" && <CheckCircle2 size={16} />}
          {t.kind === "error"   && <AlertTriangle size={16} />}
          {t.kind === "info"    && <TrendingUp size={16} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TasksPage() {
  const [tasks, setTasks]       = useState([]);
  const [users, setUsers]       = useState([]);
  const [teams, setTeams]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [showModal, setShow]    = useState(false);
  const [confirmDel, setConf]   = useState(null);
  const [view, setView]         = useState("grid");      // grid | board
  const [statusFilter, setSF]   = useState("all");
  const [priorityFilter, setPF] = useState("all");
  const [sortBy, setSort]       = useState("due");
  const [query, setQuery]       = useState("");
  const [form, setForm]         = useState({
    id: null, title: "", description: "", priority: 2, status: 0, dueDate: "",
    parentTaskId: "", taskType: "general", processStage: "intake", followUpDate: "", followUpNotes: "",
    assignees: [],
  });
  const toast = useToasts();

  /* ------------------ data ------------------ */

  async function fetchTasks() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/tasks");
      const normalized = Array.isArray(data)
        ? data.map((t) => {
            // assignees can be: an array of {id,type}, separate users[]+teams[],
            // or just a legacy assigneeId — handle all three
            let assignees = [];
            const raw = t.assignees ?? t.Assignees;
            if (Array.isArray(raw)) {
              assignees = raw.map(normalizeAssignee).filter(Boolean);
            } else {
              const us = t.users ?? t.Users;
              const ts = t.teams ?? t.Teams;
              if (Array.isArray(us)) assignees.push(...us.map(normalizeUser));
              if (Array.isArray(ts)) assignees.push(...ts.map(normalizeTeam));
            }
            const legacyId = t.assigneeId ?? t.AssigneeId;
            if (legacyId != null && !assignees.some((a) => a.type === "user" && String(a.id) === String(legacyId))) {
              assignees.push({ id: legacyId, type: "user", name: `User #${legacyId}` });
            }
            return {
              id: t.id ?? t.Id,
              title: t.title ?? t.Title ?? "",
              description: t.description ?? t.Description ?? "",
              status: Number(t.status ?? t.Status ?? 0),
              priority: Number(t.priority ?? t.Priority ?? 2),
              dueDate: t.dueDate ?? t.DueDate ?? null,
              parentTaskId: t.parentTaskId ?? t.ParentTaskId ?? null,
              taskType: t.taskType ?? t.TaskType ?? "general",
              processStage: t.processStage ?? t.ProcessStage ?? "intake",
              followUpDate: t.followUpDate ?? t.FollowUpDate ?? null,
              followUpNotes: t.followUpNotes ?? t.FollowUpNotes ?? "",
              subTaskIds: t.subTaskIds ?? t.SubTaskIds ?? [],
              subTaskCount: Number(t.subTaskCount ?? t.SubTaskCount ?? 0),
              activityLog: t.activityLog ?? t.ActivityLog ?? [],
              canUpdate: Boolean(t.canUpdate ?? t.CanUpdate ?? true),
              readOnly: Boolean(t.readOnly ?? t.ReadOnly ?? false),
              visibilityReason: t.visibilityReason ?? t.VisibilityReason ?? "",
              ownerPositionId: t.ownerPositionId ?? t.OwnerPositionId ?? null,
              createdById: t.createdById ?? t.CreatedById ?? null,
              assigneeId: legacyId ?? null,
              assignees,
            };
          })
        : [];
      setTasks(normalized);
    } catch (e) {
      setError("Couldn't load tasks. Check your session and try again.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPeople() {
    // fetch users + teams in parallel; tolerate either being unavailable.
    // /users returns { items, total, page, limit }; /teams returns a bare array.
    const [u, tm] = await Promise.allSettled([
      api("/users?page=1&limit=500"),
      api("/teams"),
    ]);
    if (u.status === "fulfilled" && u.value) {
      const arr = Array.isArray(u.value) ? u.value : (u.value.items || []);
      setUsers(arr.map(normalizeUser));
    }
    if (tm.status === "fulfilled" && Array.isArray(tm.value)) {
      setTeams(tm.value.map(normalizeTeam));
    }
  }

  // Cached team-members loader for the picker
  const teamMembersCache = useRef(new Map());
  async function loadTeamMembers(teamId) {
    const key = String(teamId);
    if (teamMembersCache.current.has(key)) return teamMembersCache.current.get(key);
    try {
      const data = await api(`/teams/${teamId}/members`);
      const userIds = Array.isArray(data)
        ? data.map((m) => m.userId ?? m.UserId ?? m.userid).filter(Boolean).map(String)
        : [];
      teamMembersCache.current.set(key, userIds);
      return userIds;
    } catch {
      teamMembersCache.current.set(key, []);
      return [];
    }
  }

  useEffect(() => {
    fetchTasks();
    fetchPeople();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.push("Title is required", "error");
      return;
    }
    setSaving(true);
    const assignees = form.assignees ?? [];
    // Legacy column is bigint — only safe to populate from numeric IDs.
    // Once the TaskAssignees join table is live, this can stay null and the
    // join table becomes the source of truth.
    const numericId = (() => {
      for (const a of assignees) {
        const n = Number(a.id);
        if (Number.isFinite(n) && String(n) === String(a.id)) return n;
      }
      return null;
    })();
    const payload = {
      Title: form.title.trim(),
      Description: form.description.trim(),
      Status: parseInt(form.status, 10),
      Priority: parseInt(form.priority, 10),
      DueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      ParentTaskId: form.parentTaskId ? Number(form.parentTaskId) : null,
      TaskType: form.taskType || "general",
      ProcessStage: form.processStage || "intake",
      FollowUpDate: form.followUpDate ? new Date(form.followUpDate).toISOString() : null,
      FollowUpNotes: form.followUpNotes?.trim() || null,
      AssigneeId: numericId, // legacy single-assignee column (bigint)
      Assignees: assignees.map((a) => ({ Id: String(a.id), Type: a.type })),
    };
    try {
      if (form.id) {
        await api(`/tasks/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast.push("Task updated", "success");
      } else {
        await api("/tasks", { method: "POST", body: JSON.stringify(payload) });
        toast.push("Task created", "success");
      }
      setShow(false);
      setForm(emptyForm());
      fetchTasks();
    } catch (e) {
      toast.push(e.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const task = tasks.find((item) => item.id === id);
    if (task?.readOnly || task?.canUpdate === false) {
      setConf(null);
      toast.push(readOnlyMessage(task), "info");
      return;
    }
    setConf(null);
    // optimistic
    const prev = tasks;
    setTasks((s) => s.filter((t) => t.id !== id));
    try {
      await api(`/tasks/${id}`, { method: "DELETE" });
      toast.push("Task deleted", "success");
    } catch (e) {
      setTasks(prev);
      toast.push("Delete failed", "error");
    }
  }

  async function toggleStatus(task) {
    if (task?.readOnly || task?.canUpdate === false) {
      toast.push(readOnlyMessage(task), "info");
      return;
    }
    const next = task.status === 2 ? 0 : 2;
    // optimistic
    setTasks((s) => s.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    try {
      const firstUser = (task.assignees || []).find((a) => a.type === "user");
      await api(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({
          Title: task.title,
          Description: task.description,
          Status: next,
          Priority: task.priority,
          DueDate: task.dueDate,
          ParentTaskId: task.parentTaskId ?? null,
          TaskType: task.taskType || "general",
          ProcessStage: next === 2 ? "done" : (task.processStage || "intake"),
          FollowUpDate: task.followUpDate ?? null,
          FollowUpNotes: task.followUpNotes ?? null,
          AssigneeId: firstUser ? firstUser.id : (task.assigneeId ?? null),
          Assignees: (task.assignees || []).map((a) => ({ Id: a.id, Type: a.type })),
        }),
      });
    } catch (e) {
      // revert
      setTasks((s) => s.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
      toast.push("Couldn't update status", "error");
    }
  }

  function openEdit(t) {
    if (t?.readOnly || t?.canUpdate === false) {
      toast.push(readOnlyMessage(t), "info");
      return;
    }
    setForm({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
      parentTaskId: t.parentTaskId ? String(t.parentTaskId) : "",
      taskType: t.taskType || "general",
      processStage: t.processStage || "intake",
      followUpDate: t.followUpDate ? new Date(t.followUpDate).toISOString().slice(0, 10) : "",
      followUpNotes: t.followUpNotes || "",
      assigneeId: t.assigneeId ?? null,
      assignees: t.assignees ? [...t.assignees] : [],
    });
    setShow(true);
  }

  function emptyForm(parentTask = null) {
    return {
      id: null,
      title: "",
      description: "",
      priority: 2,
      status: 0,
      dueDate: "",
      parentTaskId: parentTask ? String(parentTask.id) : "",
      taskType: parentTask?.taskType || "general",
      processStage: parentTask ? "assigned" : "intake",
      followUpDate: "",
      followUpNotes: "",
      assignees: [],
    };
  }

  function openNew(parentTask = null) {
    setForm(emptyForm(parentTask));
    setShow(true);
  }

  /* ------------------ derived ------------------ */

  const stats = useMemo(() => ({
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 0).length,
    progress: tasks.filter((t) => t.status === 1).length,
    done: tasks.filter((t) => t.status === 2).length,
    overdue: tasks.filter(isOverdue).length,
  }), [tasks]);

  const sortTasks = useCallback((list) => {
    return [...list].sort((a, b) => {
      if (sortBy === "due") {
        const av = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bv = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return av - bv;
      }
      if (sortBy === "priority") return b.priority - a.priority;
      return b.id - a.id;
    });
  }, [sortBy]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter !== "all")    list = list.filter((t) => t.status === Number(statusFilter));
    if (priorityFilter !== "all")  list = list.filter((t) => t.priority === Number(priorityFilter));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q) ||
          labelFrom(TASK_TYPES, t.taskType).toLowerCase().includes(q) ||
          labelFrom(PROCESS_STAGES, t.processStage, "Intake").toLowerCase().includes(q)
      );
    }
    return sortTasks(list);
  }, [tasks, statusFilter, priorityFilter, query, sortTasks]);

  const hierarchy = useMemo(() => {
    const byId = new Map(tasks.map((t) => [String(t.id), t]));
    const visibleIds = new Set(filtered.map((t) => String(t.id)));
    const displayIds = new Set(visibleIds);

    for (const task of filtered) {
      let parentId = task.parentTaskId ? String(task.parentTaskId) : "";
      const seen = new Set([String(task.id)]);
      while (parentId && byId.has(parentId) && !seen.has(parentId)) {
        displayIds.add(parentId);
        seen.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent?.parentTaskId ? String(parent.parentTaskId) : "";
      }
    }

    const nodes = new Map();
    for (const id of displayIds) {
      const task = byId.get(id);
      if (task) nodes.set(id, { task, children: [], isContext: !visibleIds.has(id) });
    }

    const roots = [];
    for (const node of nodes.values()) {
      const parentId = node.task.parentTaskId ? String(node.task.parentTaskId) : "";
      const parent = parentId ? nodes.get(parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const sortNodes = (items) => {
      const sorted = sortTasks(items.map((n) => n.task)).map((task) => nodes.get(String(task.id))).filter(Boolean);
      for (const node of sorted) node.children = sortNodes(node.children);
      return sorted;
    };

    return sortNodes(roots);
  }, [tasks, filtered, sortTasks]);

  /* ------------------ render ------------------ */

  return (
    <div className="tp-root">
      <Styles />

      {/* Header */}
      <header className="tp-header">
        <div className="tp-header-inner">
          <div className="tp-brand">
            <div className="tp-logo"><ListTodo size={20} /></div>
            <div>
              <div className="tp-title">Tasks</div>
              <div className="tp-subtitle">Stay on top of what matters</div>
            </div>
          </div>

          <div className="tp-search">
            <Search size={16} />
            <input
              placeholder="Search tasks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="tp-clear" onClick={() => setQuery("")}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="tp-header-actions">
            <button className="tp-btn ghost" onClick={fetchTasks} title="Refresh">
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              <span className="hide-sm">Refresh</span>
            </button>
            <button className="tp-btn primary" onClick={openNew}>
              <Plus size={16} /> New task
            </button>
          </div>
        </div>
      </header>

      <main className="tp-main">

        {/* Stats */}
        <section className="tp-stats">
          <StatCard
            label="Total"
            value={stats.total}
            icon={<Inbox size={18} />}
            color="#6366f1"
          />
          <StatCard
            label="Pending"
            value={stats.pending}
            icon={<Circle size={18} />}
            color="#f59e0b"
          />
          <StatCard
            label="In Progress"
            value={stats.progress}
            icon={<PlayCircle size={18} />}
            color="#3b82f6"
          />
          <StatCard
            label="Completed"
            value={stats.done}
            icon={<CheckCircle2 size={18} />}
            color="#10b981"
          />
          <StatCard
            label="Overdue"
            value={stats.overdue}
            icon={<Flame size={18} />}
            color="#ef4444"
            highlight={stats.overdue > 0}
          />
        </section>

        {/* Toolbar */}
        <section className="tp-toolbar">
          <div className="tp-chips">
            <Chip active={statusFilter === "all"} onClick={() => setSF("all")}>
              All <span className="count">{stats.total}</span>
            </Chip>
            {Object.entries(STATUS).map(([k, v]) => {
              const Icon = v.icon;
              const count = tasks.filter((t) => t.status === Number(k)).length;
              return (
                <Chip
                  key={k}
                  active={statusFilter === k}
                  onClick={() => setSF(k)}
                  color={v.color}
                >
                  <Icon size={13} /> {v.label} <span className="count">{count}</span>
                </Chip>
              );
            })}
          </div>

          <div className="tp-controls">
            <div className="tp-select-wrap">
              <Flag size={14} />
              <select value={priorityFilter} onChange={(e) => setPF(e.target.value)}>
                <option value="all">All priorities</option>
                {Object.entries(PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            <div className="tp-select-wrap">
              <SortAsc size={14} />
              <select value={sortBy} onChange={(e) => setSort(e.target.value)}>
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
                <option value="newest">Newest</option>
              </select>
            </div>

            <div className="tp-view-toggle">
              <button
                className={view === "grid" ? "on" : ""}
                onClick={() => setView("grid")}
                title="Grid view"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                className={view === "board" ? "on" : ""}
                onClick={() => setView("board")}
                title="Board view"
              >
                <Columns3 size={15} />
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="tp-alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button onClick={() => setError("")}><X size={14} /></button>
          </div>
        )}

        {/* Body */}
        {loading ? (
          <SkeletonGrid />
        ) : filtered.length === 0 ? (
          <EmptyState
            hasAny={tasks.length > 0}
            onClear={() => { setSF("all"); setPF("all"); setQuery(""); }}
            onNew={openNew}
          />
        ) : view === "grid" ? (
          <TaskHierarchy
            nodes={hierarchy}
            onToggle={toggleStatus}
            onEdit={openEdit}
            onSubTask={openNew}
            onDelete={setConf}
          />
        ) : (
          <Board
            tasks={filtered}
            onToggle={toggleStatus}
            onEdit={openEdit}
            onSubTask={openNew}
            onDelete={setConf}
          />
        )}
      </main>

      {/* FAB on mobile */}
      <button className="tp-fab" onClick={openNew} aria-label="New task">
        <Plus size={24} />
      </button>

      {/* Modal */}
      {showModal && (
        <TaskModal
          form={form}
          setForm={setForm}
          saving={saving}
          users={users}
          teams={teams}
          loadTeamMembers={loadTeamMembers}
          tasks={tasks}
          onClose={() => setShow(false)}
          onSubmit={handleSave}
        />
      )}

      {/* Confirm delete */}
      {confirmDel && (
        <ConfirmDialog
          title="Delete this task?"
          message={`"${confirmDel.title}" will be permanently removed.`}
          onCancel={() => setConf(null)}
          onConfirm={() => handleDelete(confirmDel.id)}
        />
      )}

      <Toasts items={toast.items} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, icon, color, highlight }) {
  return (
    <div className={`tp-stat ${highlight ? "highlight" : ""}`}>
      <div className="tp-stat-icon" style={{ background: `${color}15`, color }}>{icon}</div>
      <div>
        <div className="tp-stat-value">{value}</div>
        <div className="tp-stat-label">{label}</div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, color, children }) {
  return (
    <button
      className={`tp-chip ${active ? "active" : ""}`}
      style={active && color ? { background: `${color}15`, color, borderColor: `${color}40` } : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}


function TaskHierarchy({ nodes, onToggle, onEdit, onSubTask, onDelete }) {
  return (
    <div className="tp-tree">
      {nodes.map((node) => (
        <TaskTreeNode
          key={node.task.id}
          node={node}
          depth={0}
          onToggle={onToggle}
          onEdit={onEdit}
          onSubTask={onSubTask}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TaskTreeNode({ node, depth, onToggle, onEdit, onSubTask, onDelete }) {
  const task = node.task;
  return (
    <div className={`tp-tree-node ${depth > 0 ? "is-child" : ""} ${node.isContext ? "is-context" : ""}`} style={{ "--depth": Math.min(depth, 5) }}>
      {depth > 0 && <div className="tp-tree-rail" aria-hidden="true" />}
      <TaskCard
        task={task}
        onToggle={() => onToggle(task)}
        onEdit={() => onEdit(task)}
        onSubTask={() => onSubTask(task)}
        onDelete={() => onDelete(task)}
      />
      {node.children.length > 0 && (
        <div className="tp-tree-children">
          {node.children.map((child) => (
            <TaskTreeNode
              key={child.task.id}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onEdit={onEdit}
              onSubTask={onSubTask}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onToggle, onEdit, onSubTask, onDelete }) {
  const status = STATUS[task.status];
  const priority = PRIORITY[task.priority];
  const overdue = isOverdue(task);
  const StatusIcon = status.icon;
  const completed = task.status === 2;
  const readOnly = task.readOnly || task.canUpdate === false;
  const readOnlyTitle = readOnlyMessage(task);

  return (
    <article className={`tp-card ${completed ? "done" : ""} ${overdue ? "overdue" : ""} ${readOnly ? "read-only" : ""}`}>
      <div className="tp-card-bar" style={{ background: priority.color }} />
      <div className="tp-card-body">
        <div className="tp-card-head">
          <button
            className="tp-check"
            onClick={onToggle}
            title={completed ? "Mark as pending" : "Mark as complete"}
            style={completed ? { background: status.color, borderColor: status.color, color: "#fff" } : undefined}
          >
            {completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
          </button>
          <div className="tp-card-title-wrap">
            <h3 className="tp-card-title">{task.title}</h3>
            {task.description ? (
              <p className="tp-card-desc">{task.description}</p>
            ) : (
              <p className="tp-card-desc empty">No description</p>
            )}
          </div>
        </div>

        <div className="tp-card-meta">
          <span
            className="tp-pill"
            style={{ background: status.soft, color: status.color }}
          >
            <StatusIcon size={12} /> {status.label}
          </span>
          <span
            className="tp-pill"
            style={{ background: priority.soft, color: priority.color }}
          >
            <Flag size={12} /> {priority.label}
          </span>
          <span className={`tp-pill due ${overdue ? "overdue" : ""}`}>
            <Clock size={12} /> {dueLabel(task)}
          </span>
          <span className="tp-pill">
            <Filter size={12} /> {labelFrom(TASK_TYPES, task.taskType)}
          </span>
          <span className="tp-pill">
            <ListTodo size={12} /> {labelFrom(PROCESS_STAGES, task.processStage, "Intake")}
          </span>
          {task.parentTaskId ? <span className="tp-pill">Subtask</span> : null}
          {task.subTaskCount > 0 ? <span className="tp-pill">{task.subTaskCount} follow-up{subTaskPlural(task.subTaskCount)}</span> : null}
          {task.followUpDate ? <span className="tp-pill due"><CalendarDays size={12} /> Follow up {fmtDate(task.followUpDate)}</span> : null}
          {readOnly ? <span className="tp-pill readonly" title={readOnlyTitle}>Read-only</span> : null}
        </div>

        <div className="tp-card-actions">
          <AvatarStack assignees={task.assignees} max={3} />
          <div className="tp-card-actions-end">
            <button className="tp-icon-btn" onClick={onSubTask} title={readOnly ? readOnlyTitle : "Add follow-up subtask"} disabled={readOnly}>
              <Plus size={14} />
            </button>
            <button className="tp-icon-btn" onClick={onEdit} title={readOnly ? readOnlyTitle : "Edit"} disabled={readOnly}>
              <Pencil size={14} />
            </button>
            <button className="tp-icon-btn danger" onClick={onDelete} title={readOnly ? readOnlyTitle : "Delete"} disabled={readOnly}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function Board({ tasks, onToggle, onEdit, onSubTask, onDelete }) {
  const cols = Object.entries(STATUS).map(([k, v]) => ({
    key: Number(k),
    label: v.label,
    color: v.color,
    soft: v.soft,
    icon: v.icon,
    tasks: tasks.filter((t) => t.status === Number(k)),
  }));
  return (
    <div className="tp-board">
      {cols.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.key} className="tp-col">
            <header className="tp-col-head" style={{ borderTopColor: c.color }}>
              <span className="tp-col-title" style={{ color: c.color }}>
                <Icon size={14} /> {c.label}
              </span>
              <span className="tp-col-count">{c.tasks.length}</span>
            </header>
            <div className="tp-col-body">
              {c.tasks.length === 0 ? (
                <div className="tp-col-empty">No tasks</div>
              ) : (
                c.tasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onToggle={() => onToggle(t)}
                    onEdit={() => onEdit(t)}
                    onSubTask={() => onSubTask(t)}
                    onDelete={() => onDelete(t)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ hasAny, onClear, onNew }) {
  return (
    <div className="tp-empty">
      <div className="tp-empty-art">
        <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden>
          <defs>
            <linearGradient id="eg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="56" fill="#eef2ff" />
          <rect x="34" y="36" width="52" height="56" rx="8" fill="#fff" stroke="url(#eg)" strokeWidth="2" />
          <path d="M44 52h32M44 64h32M44 76h20" stroke="#c7d2fe" strokeWidth="3" strokeLinecap="round" />
          <circle cx="86" cy="38" r="14" fill="url(#eg)" />
          <path d="M80 38l4 4 8-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
      <h3>{hasAny ? "Nothing matches your filters" : "All clear"}</h3>
      <p>
        {hasAny
          ? "Try clearing filters or adjusting your search."
          : "Create your first task to get started."}
      </p>
      <div className="tp-empty-actions">
        {hasAny ? (
          <button className="tp-btn ghost" onClick={onClear}>Clear filters</button>
        ) : null}
        <button className="tp-btn primary" onClick={onNew}>
          <Plus size={16} /> New task
        </button>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="tp-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="tp-card skeleton" key={i}>
          <div className="tp-card-bar" />
          <div className="tp-card-body">
            <div className="sk sk-line w70" />
            <div className="sk sk-line w90" />
            <div className="sk sk-line w50" />
            <div className="tp-card-meta">
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------ Avatars ------------------ */

function Avatar({ entity, size = 26, ring = true }) {
  if (!entity) return null;
  const isTeam = entity.type === "team";
  const bg = entity.color || colorFor(`${entity.type}-${entity.id}-${entity.name}`);
  const style = {
    width: size, height: size,
    background: entity.avatarUrl ? "transparent" : bg,
    color: "#fff",
    fontSize: Math.max(9, Math.round(size * 0.42)),
    boxShadow: ring ? "0 0 0 2px #fff" : "none",
  };
  const title = isTeam
    ? `${entity.name}${entity.memberCount ? ` (${entity.memberCount})` : ""} · Team`
    : `${entity.name}${entity.email ? ` · ${entity.email}` : ""}`;

  return (
    <span className={`tp-avatar ${isTeam ? "is-team" : ""}`} style={style} title={title}>
      {entity.avatarUrl ? (
        <img src={entity.avatarUrl} alt={entity.name} />
      ) : isTeam ? (
        <Users size={Math.round(size * 0.5)} />
      ) : (
        initials(entity.name)
      )}
    </span>
  );
}

function AvatarStack({ assignees = [], max = 3 }) {
  if (!assignees || assignees.length === 0) {
    return (
      <span className="tp-assignee-empty" title="Unassigned">
        <User size={13} /> Unassigned
      </span>
    );
  }
  const shown = assignees.slice(0, max);
  const extra = assignees.length - shown.length;
  return (
    <div className="tp-stack">
      {shown.map((a) => (
        <Avatar key={`${a.type}-${a.id}`} entity={a} />
      ))}
      {extra > 0 && (
        <span
          className="tp-avatar tp-avatar-more"
          title={assignees.slice(max).map((a) => a.name).join(", ")}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

/* ------------------ Assignee picker ------------------ */

function AssigneePicker({ users, teams, selected, onChange, loadTeamMembers }) {
  const [open, setOpen]               = useState(false);
  const [query, setQuery]             = useState("");
  const [expandedTeams, setExpanded]  = useState({});  // { [teamId]: true }
  const [teamMembers, setTeamMembers] = useState({});  // { [teamId]: [userId, ...] }
  const [loadingTeam, setLoadingTeam] = useState({});

  // user lookup by string id, for team-member resolution
  const userIndex = useMemo(() => {
    const m = new Map();
    (users || []).forEach((u) => m.set(String(u.id), u));
    return m;
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users || [];
    return (users || []).filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [users, query]);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams || [];
    return (teams || []).filter((t) => (t.name || "").toLowerCase().includes(q));
  }, [teams, query]);

  const isSelected = (e) => selected.some((s) => sameAssignee(s, e));

  const toggleEntity = (e) => {
    if (isSelected(e)) onChange(selected.filter((s) => !sameAssignee(s, e)));
    else onChange([...selected, e]);
  };
  const remove = (e) => onChange(selected.filter((s) => !sameAssignee(s, e)));

  async function expandTeam(team) {
    const id = String(team.id);
    setExpanded((s) => ({ ...s, [id]: !s[id] }));
    if (!teamMembers[id]) {
      setLoadingTeam((s) => ({ ...s, [id]: true }));
      const ids = await loadTeamMembers(team.id);
      setTeamMembers((s) => ({ ...s, [id]: ids }));
      setLoadingTeam((s) => ({ ...s, [id]: false }));
    }
  }

  function addAllMembers(team) {
    const id = String(team.id);
    const ids = teamMembers[id] || [];
    if (ids.length === 0) return;
    const toAdd = ids
      .map((uid) => userIndex.get(String(uid)))
      .filter(Boolean)
      .filter((u) => !selected.some((s) => sameAssignee(s, u)));
    if (toAdd.length) onChange([...selected, ...toAdd]);
  }

  return (
    <div className={`tp-picker ${open ? "open" : ""}`}>
      <div
        className="tp-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className="tp-picker-chips">
          {selected.length === 0 ? (
            <span className="tp-picker-placeholder">
              <Users size={14} /> Assign people or teams...
            </span>
          ) : (
            selected.map((a) => (
              <span key={`${a.type}-${a.id}`} className="tp-chip-selected">
                <Avatar entity={a} size={18} ring={false} />
                <span className="tp-chip-name">{a.name}</span>
                {a.type === "team" && <span className="tp-tag-team">team</span>}
                <span
                  className="tp-chip-remove"
                  role="button"
                  tabIndex={0}
                  onClick={(ev) => { ev.stopPropagation(); remove(a); }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      remove(a);
                    }
                  }}
                >
                  <X size={12} />
                </span>
              </span>
            ))
          )}
        </div>
        <ChevronDown size={16} className={`tp-picker-caret ${open ? "open" : ""}`} />
      </div>

      {open && (
        <div className="tp-picker-panel">
          <div className="tp-picker-search">
            <Search size={14} />
            <input
              autoFocus
              placeholder="Search people or teams..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="tp-picker-list">
            {filteredTeams.length === 0 && filteredUsers.length === 0 ? (
              <div className="tp-picker-empty">No matches</div>
            ) : (
              <>
                {filteredTeams.length > 0 && (
                  <>
                    <div className="tp-picker-group">Teams</div>
                    {filteredTeams.map((team) => {
                      const id = String(team.id);
                      const expanded = !!expandedTeams[id];
                      const memberIds = teamMembers[id] || [];
                      const loading = !!loadingTeam[id];
                      return (
                        <div key={`team-${id}`} className="tp-team-block">
                          <div className={`tp-picker-row ${isSelected(team) ? "selected" : ""}`}>
                            <button
                              type="button"
                              className="tp-row-tap"
                              onClick={() => toggleEntity(team)}
                            >
                              <Avatar entity={team} size={28} ring={false} />
                              <div className="tp-picker-row-text">
                                <div className="tp-picker-row-name">{team.name}</div>
                                <div className="tp-picker-row-sub">Team</div>
                              </div>
                              <span className={`tp-picker-check ${isSelected(team) ? "on" : ""}`}>
                                {isSelected(team) ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="tp-team-expand"
                              onClick={(e) => { e.stopPropagation(); expandTeam(team); }}
                              title={expanded ? "Hide members" : "Show members"}
                              aria-expanded={expanded}
                            >
                              <ChevronDown size={15} className={expanded ? "rot" : ""} />
                            </button>
                          </div>

                          {expanded && (
                            <div className="tp-team-members">
                              {loading ? (
                                <div className="tp-picker-empty small">
                                  <Loader2 size={13} className="spin" /> Loading members…
                                </div>
                              ) : memberIds.length === 0 ? (
                                <div className="tp-picker-empty small">No members in this team</div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="tp-add-all"
                                    onClick={() => addAllMembers(team)}
                                  >
                                    <Plus size={13} /> Add all {memberIds.length} member{memberIds.length === 1 ? "" : "s"} as individuals
                                  </button>
                                  {memberIds.map((uid) => {
                                    const u = userIndex.get(String(uid));
                                    if (!u) return (
                                      <div key={`m-${uid}`} className="tp-picker-empty small">
                                        Unknown user · {String(uid).slice(0, 8)}…
                                      </div>
                                    );
                                    return (
                                      <PickerRow
                                        key={`m-${uid}`}
                                        entity={u}
                                        selected={isSelected(u)}
                                        onToggle={() => toggleEntity(u)}
                                        compact
                                      />
                                    );
                                  })}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {filteredUsers.length > 0 && (
                  <>
                    <div className="tp-picker-group">People</div>
                    {filteredUsers.map((u) => (
                      <PickerRow
                        key={`user-${u.id}`}
                        entity={u}
                        selected={isSelected(u)}
                        onToggle={() => toggleEntity(u)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          <div className="tp-picker-foot">
            <span className="tp-picker-count">
              {selected.length} selected
            </span>
            <button type="button" className="tp-picker-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({ entity, selected, onToggle, compact = false }) {
  return (
    <button
      type="button"
      className={`tp-picker-row ${selected ? "selected" : ""} ${compact ? "compact" : ""}`}
      onClick={onToggle}
    >
      <Avatar entity={entity} size={compact ? 24 : 28} ring={false} />
      <div className="tp-picker-row-text">
        <div className="tp-picker-row-name">{entity.name}</div>
        <div className="tp-picker-row-sub">
          {entity.type === "team"
            ? `Team${entity.memberCount ? ` · ${entity.memberCount} members` : ""}`
            : entity.email || "User"}
        </div>
      </div>
      <span className={`tp-picker-check ${selected ? "on" : ""}`}>
        {selected ? <CheckCircle2 size={16} /> : <Circle size={16} />}
      </span>
    </button>
  );
}

/* ------------------ Modal ------------------ */

function TaskModal({ form, setForm, saving, users, teams, loadTeamMembers, tasks, onClose, onSubmit }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <form className="tp-modal" onSubmit={onSubmit}>
        <header className="tp-modal-head">
          <div>
            <h2>{form.id ? "Edit task" : "New task"}</h2>
            <p>{form.id ? "Update the details below." : "What needs to get done?"}</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="tp-modal-body">
          <Field label="Title" required>
            <input
              autoFocus
              placeholder="e.g. Ship onboarding flow"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
            />
          </Field>

          <Field label="Description">
            <textarea
              rows={4}
              placeholder="Add notes, links, acceptance criteria..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <div className="tp-row-2">
            <Field label="Task type">
              <select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Process stage">
              <select value={form.processStage} onChange={(e) => setForm({ ...form, processStage: e.target.value })}>
                {PROCESS_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Parent task / follow-up of">
            <select value={form.parentTaskId || ""} onChange={(e) => setForm({ ...form, parentTaskId: e.target.value })}>
              <option value="">Top-level task</option>
              {(tasks || []).filter((t) => String(t.id) !== String(form.id)).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            <div className="tp-field-hint">Use this to create follow-up activities and subtasks under a larger process.</div>
          </Field>

          <Field label="Assignees">
            <AssigneePicker
              users={users}
              teams={teams}
              selected={form.assignees || []}
              onChange={(next) => setForm({ ...form, assignees: next })}
              loadTeamMembers={loadTeamMembers}
            />
            {(users.length === 0 && teams.length === 0) && (
              <div className="tp-field-hint">
                No people or teams loaded. Make sure <code>/api/users</code> and <code>/api/teams</code> are reachable.
              </div>
            )}
          </Field>

          <div className="tp-row-2">
            <Field label="Follow-up date">
              <div className="tp-date-input">
                <CalendarDays size={15} />
                <input
                  type="date"
                  value={form.followUpDate}
                  onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                />
              </div>
            </Field>
            <Field label="Follow-up notes">
              <input
                value={form.followUpNotes}
                onChange={(e) => setForm({ ...form, followUpNotes: e.target.value })}
                placeholder="Call, visit, reminder, review..."
              />
            </Field>
          </div>

          <Field label="Due date">
            <div className="tp-date-input">
              <CalendarDays size={15} />
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </Field>
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="tp-btn primary" disabled={saving}>
            {saving ? <><Loader2 size={15} className="spin" /> Saving…</> : (form.id ? "Save changes" : "Create task")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="tp-field">
      <span className="tp-field-label">
        {label}{required && <span className="req">*</span>}
      </span>
      {children}
    </label>
  );
}

function ConfirmDialog({ title, message, onCancel, onConfirm }) {
  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onCancel()}>
      <div className="tp-confirm">
        <div className="tp-confirm-icon"><AlertTriangle size={22} /></div>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="tp-confirm-actions">
          <button className="tp-btn ghost" onClick={onCancel}>Cancel</button>
          <button className="tp-btn danger" onClick={onConfirm}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

function Styles() {
  return (
    <style>{`
      :root {
        --bg: #f7f7fb;
        --surface: #ffffff;
        --surface-2: #fafafe;
        --border: #e7e7ee;
        --border-strong: #d6d6e0;
        --text: #18181b;
        --text-2: #52525b;
        --text-3: #8a8a93;
        --primary: #6366f1;
        --primary-600: #4f46e5;
        --primary-50: #eef2ff;
        --danger: #ef4444;
        --danger-50: #fef2f2;
        --success: #10b981;
        --shadow-sm: 0 1px 2px rgba(16,18,40,.04), 0 1px 1px rgba(16,18,40,.03);
        --shadow-md: 0 4px 16px rgba(16,18,40,.06), 0 2px 4px rgba(16,18,40,.03);
        --shadow-lg: 0 12px 40px rgba(16,18,40,.12), 0 4px 12px rgba(16,18,40,.06);
        --radius: 14px;
      }

      .tp-root {
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(1200px 600px at 0% -10%, #eef2ff 0%, transparent 60%),
          radial-gradient(900px 500px at 100% 0%, #fdf4ff 0%, transparent 55%),
          var(--bg);
        min-height: 100vh;
        color: var(--text);
        -webkit-font-smoothing: antialiased;
      }

      /* Header */
      .tp-header {
        position: sticky;
        top: 0;
        z-index: 30;
        backdrop-filter: saturate(140%) blur(12px);
        background: rgba(255,255,255,.78);
        border-bottom: 1px solid var(--border);
      }
      .tp-header-inner {
        max-width: 1280px;
        margin: 0 auto;
        padding: 14px 24px;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 18px;
        align-items: center;
      }
      .tp-brand { display: flex; align-items: center; gap: 12px; }
      .tp-logo {
        width: 38px; height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
        color: #fff;
        display: grid; place-items: center;
        box-shadow: 0 6px 18px rgba(99,102,241,.35);
      }
      .tp-title {
        font-size: 18px; font-weight: 700;
        letter-spacing: -0.01em;
      }
      .tp-subtitle {
        font-size: 12px; color: var(--text-3);
        margin-top: 1px;
      }

      .tp-search {
        display: flex; align-items: center; gap: 8px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 12px;
        max-width: 460px;
        width: 100%;
        justify-self: center;
        transition: border-color .15s, box-shadow .15s;
        color: var(--text-3);
      }
      .tp-search:focus-within {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.12);
        color: var(--text-2);
      }
      .tp-search input {
        flex: 1;
        border: none; outline: none;
        background: transparent;
        font-size: 14px;
        color: var(--text);
      }
      .tp-clear {
        border: none; background: transparent;
        color: var(--text-3); cursor: pointer;
        padding: 2px; border-radius: 4px;
      }
      .tp-clear:hover { color: var(--text); background: var(--surface-2); }

      .tp-header-actions { display: flex; gap: 8px; }

      /* Main */
      .tp-main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 28px 24px 100px;
      }

      /* Stats */
      .tp-stats {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 14px;
        margin-bottom: 22px;
      }
      .tp-stat {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 16px;
        display: flex; align-items: center; gap: 14px;
        box-shadow: var(--shadow-sm);
        transition: transform .15s, box-shadow .15s;
      }
      .tp-stat:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
      .tp-stat.highlight {
        border-color: #fecaca;
        background: linear-gradient(180deg, #fff 0%, #fff5f5 100%);
      }
      .tp-stat-icon {
        width: 40px; height: 40px;
        border-radius: 10px;
        display: grid; place-items: center;
      }
      .tp-stat-value {
        font-size: 22px; font-weight: 700;
        letter-spacing: -0.02em;
      }
      .tp-stat-label {
        font-size: 12px; color: var(--text-3);
        font-weight: 500;
      }

      /* Toolbar */
      .tp-toolbar {
        display: flex; flex-wrap: wrap; gap: 12px;
        align-items: center; justify-content: space-between;
        margin-bottom: 18px;
      }
      .tp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .tp-chip {
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--text-2);
        font-size: 13px; font-weight: 500;
        padding: 7px 12px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        transition: all .15s;
      }
      .tp-chip:hover { background: var(--surface-2); color: var(--text); }
      .tp-chip.active {
        background: var(--primary-50);
        color: var(--primary-600);
        border-color: #c7d2fe;
        font-weight: 600;
      }
      .tp-chip .count {
        font-size: 11px;
        background: rgba(0,0,0,.06);
        padding: 1px 6px;
        border-radius: 999px;
        font-weight: 600;
      }
      .tp-chip.active .count { background: rgba(99,102,241,.18); }

      .tp-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .tp-select-wrap {
        display: flex; align-items: center; gap: 6px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0 10px 0 12px;
        color: var(--text-3);
      }
      .tp-select-wrap select {
        background: transparent;
        border: none; outline: none;
        padding: 8px 4px;
        font-size: 13px;
        color: var(--text);
        font-family: inherit;
        cursor: pointer;
      }
      .tp-view-toggle {
        display: flex;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
      }
      .tp-view-toggle button {
        background: transparent;
        border: none;
        padding: 8px 12px;
        cursor: pointer;
        color: var(--text-3);
        display: grid; place-items: center;
        transition: background .15s, color .15s;
      }
      .tp-view-toggle button:hover { color: var(--text); background: var(--surface-2); }
      .tp-view-toggle button.on { background: var(--primary-50); color: var(--primary-600); }

      /* Buttons */
      .tp-btn {
        border: 1px solid transparent;
        font-family: inherit;
        font-weight: 600;
        font-size: 13.5px;
        border-radius: 10px;
        padding: 9px 14px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all .15s;
        white-space: nowrap;
      }
      .tp-btn:disabled { opacity: .6; cursor: not-allowed; }
      .tp-btn.primary {
        background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
        color: #fff;
        box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 4px 12px rgba(99,102,241,.32);
      }
      .tp-btn.primary:hover { filter: brightness(1.05); transform: translateY(-1px); }
      .tp-btn.ghost {
        background: var(--surface);
        color: var(--text-2);
        border-color: var(--border);
      }
      .tp-btn.ghost:hover { background: var(--surface-2); color: var(--text); }
      .tp-btn.danger {
        background: var(--danger);
        color: #fff;
        box-shadow: 0 4px 12px rgba(239,68,68,.32);
      }
      .tp-btn.danger:hover { filter: brightness(1.05); }

      .hide-sm { display: inline; }

      /* Alert */
      .tp-alert {
        background: #fff5f5;
        border: 1px solid #fecaca;
        color: #b91c1c;
        padding: 10px 14px;
        border-radius: 10px;
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 14px;
        font-size: 13.5px;
      }
      .tp-alert button {
        margin-left: auto;
        border: none; background: transparent;
        color: inherit; cursor: pointer;
        padding: 4px; border-radius: 4px;
      }
      .tp-alert button:hover { background: rgba(185,28,28,.08); }

      /* Hierarchy */
      .tp-tree {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .tp-tree-node {
        position: relative;
        margin-left: calc(var(--depth, 0) * 28px);
      }
      .tp-tree-node.is-child {
        margin-top: 10px;
      }
      .tp-tree-node.is-context > .tp-card {
        opacity: .72;
      }
      .tp-tree-children {
        position: relative;
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .tp-tree-rail {
        position: absolute;
        left: -18px;
        top: -10px;
        bottom: 50%;
        width: 18px;
        border-left: 2px solid var(--border-strong);
        border-bottom: 2px solid var(--border-strong);
        border-bottom-left-radius: 10px;
      }

      /* Grid + Card */
      .tp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 14px;
      }
      .tp-card {
        position: relative;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
        box-shadow: var(--shadow-sm);
        transition: transform .18s, box-shadow .18s, border-color .18s;
        display: flex;
      }
      .tp-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: var(--border-strong);
      }
      .tp-card.done .tp-card-title { color: var(--text-3); text-decoration: line-through; }
      .tp-card.done { opacity: .85; }
      .tp-card.overdue { border-color: #fecaca; }
      .tp-card-bar {
        width: 4px;
        flex-shrink: 0;
      }
      .tp-card-body {
        flex: 1;
        padding: 14px 16px 12px;
        display: flex; flex-direction: column; gap: 10px;
        min-width: 0;
      }
      .tp-card-head {
        display: flex; gap: 10px;
        align-items: flex-start;
      }
      .tp-card-title-wrap { flex: 1; min-width: 0; }
      .tp-card-title {
        font-size: 15px; font-weight: 600;
        line-height: 1.3;
        margin: 0 0 4px;
        word-break: break-word;
      }
      .tp-card-desc {
        font-size: 13px; color: var(--text-2);
        margin: 0;
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .tp-card-desc.empty { color: var(--text-3); font-style: italic; }
      .tp-check {
        flex-shrink: 0;
        width: 24px; height: 24px;
        border-radius: 999px;
        border: 1.5px solid var(--border-strong);
        background: var(--surface);
        cursor: pointer;
        display: grid; place-items: center;
        color: var(--text-3);
        transition: all .15s;
        margin-top: 1px;
      }
      .tp-check:hover { border-color: var(--success); color: var(--success); }
      .tp-card-meta {
        display: flex; flex-wrap: wrap; gap: 6px;
      }
      .tp-pill {
        font-size: 11.5px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 6px;
        display: inline-flex; align-items: center; gap: 4px;
        background: var(--surface-2);
        color: var(--text-2);
      }
      .tp-pill.due { background: var(--surface-2); color: var(--text-2); }
      .tp-pill.due.overdue { background: var(--danger-50); color: var(--danger); }

      .tp-card-actions {
        display: flex; gap: 6px; align-items: center;
        margin-top: auto;
        padding-top: 8px;
        border-top: 1px dashed var(--border);
      }
      .tp-card-actions-end {
        display: flex; gap: 6px; margin-left: auto;
      }
      .tp-assignee-empty {
        font-size: 11.5px;
        color: var(--text-3);
        display: inline-flex; align-items: center; gap: 4px;
        font-weight: 500;
      }

      /* Avatars */
      .tp-avatar {
        width: 26px; height: 26px;
        border-radius: 999px;
        display: inline-grid; place-items: center;
        font-size: 10.5px;
        font-weight: 700;
        color: #fff;
        overflow: hidden;
        flex-shrink: 0;
        letter-spacing: .02em;
      }
      .tp-avatar img {
        width: 100%; height: 100%; object-fit: cover;
      }
      .tp-avatar.is-team { border-radius: 7px; }
      .tp-stack {
        display: inline-flex;
        align-items: center;
      }
      .tp-stack > .tp-avatar {
        margin-right: -8px;
      }
      .tp-stack > .tp-avatar:last-child { margin-right: 0; }
      .tp-avatar-more {
        background: #e5e7eb !important;
        color: var(--text-2) !important;
        font-size: 10px !important;
        box-shadow: 0 0 0 2px #fff !important;
      }
      .tp-icon-btn {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 8px;
        width: 30px; height: 30px;
        cursor: pointer;
        color: var(--text-2);
        display: grid; place-items: center;
        transition: all .15s;
      }
      .tp-icon-btn:hover { background: var(--surface-2); color: var(--text); }
      .tp-icon-btn.danger:hover { background: var(--danger-50); color: var(--danger); border-color: #fecaca; }

      /* Board */
      .tp-board {
        display: grid;
        grid-template-columns: repeat(4, minmax(260px, 1fr));
        gap: 14px;
        overflow-x: auto;
      }
      .tp-col {
        background: rgba(255,255,255,.55);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
        display: flex; flex-direction: column;
        max-height: 80vh;
      }
      .tp-col-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 6px 10px;
        border-top: 3px solid;
        border-radius: 2px;
        margin: -12px -12px 10px;
        padding: 14px 14px 10px;
      }
      .tp-col-title {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 13px; font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .tp-col-count {
        font-size: 12px; font-weight: 600;
        background: rgba(0,0,0,.05);
        color: var(--text-2);
        padding: 2px 8px;
        border-radius: 999px;
      }
      .tp-col-body {
        display: flex; flex-direction: column; gap: 10px;
        overflow-y: auto;
      }
      .tp-col-empty {
        text-align: center;
        color: var(--text-3);
        font-size: 13px;
        padding: 22px 8px;
        border: 1px dashed var(--border);
        border-radius: 10px;
      }

      /* Empty state */
      .tp-empty {
        text-align: center;
        padding: 48px 16px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .tp-empty-art { display: grid; place-items: center; margin-bottom: 16px; }
      .tp-empty h3 {
        font-size: 18px; font-weight: 700;
        margin: 0 0 6px;
      }
      .tp-empty p {
        color: var(--text-3); font-size: 14px;
        margin: 0 0 18px;
      }
      .tp-empty-actions { display: inline-flex; gap: 10px; }

      /* Skeleton */
      .tp-card.skeleton { pointer-events: none; }
      .tp-card.skeleton .tp-card-bar { background: var(--border); }
      .sk {
        background: linear-gradient(90deg, #eef0f4 0%, #f6f7fa 50%, #eef0f4 100%);
        background-size: 200% 100%;
        animation: shine 1.4s linear infinite;
        border-radius: 6px;
      }
      .sk-line { height: 12px; margin-bottom: 8px; }
      .w50 { width: 50%; } .w70 { width: 70%; } .w90 { width: 90%; }
      .sk-pill { width: 70px; height: 22px; border-radius: 6px; }
      @keyframes shine {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }

      /* FAB */
      .tp-fab {
        display: none;
        position: fixed;
        right: 20px; bottom: 20px;
        width: 56px; height: 56px;
        border-radius: 999px;
        border: none;
        background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
        color: #fff;
        cursor: pointer;
        box-shadow: 0 10px 30px rgba(99,102,241,.45);
        z-index: 20;
        align-items: center; justify-content: center;
      }
      .tp-fab:active { transform: scale(.96); }

      /* Modal */
      .tp-modal-bg {
        position: fixed; inset: 0;
        background: rgba(15,16,30,.55);
        backdrop-filter: blur(4px);
        z-index: 80;
        display: grid;
        place-items: center;
        padding: 20px;
        animation: fadeIn .18s ease;
      }
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      .tp-modal {
        background: var(--surface);
        width: 100%;
        max-width: 520px;
        max-height: min(90vh, 760px);
        border-radius: 18px;
        box-shadow: var(--shadow-lg);
        overflow: hidden;
        animation: pop .22s cubic-bezier(.2,.7,.3,1.3);
        display: flex;
        flex-direction: column;
      }
      @keyframes pop { from { transform: translateY(12px) scale(.98); opacity: 0 } to { transform: none; opacity: 1 } }
      .tp-modal-head {
        flex-shrink: 0;
        padding: 20px 22px 12px;
        display: flex; justify-content: space-between; align-items: flex-start;
      }
      .tp-modal-head h2 {
        font-size: 18px; font-weight: 700;
        margin: 0 0 3px;
        letter-spacing: -0.01em;
      }
      .tp-modal-head p {
        margin: 0; font-size: 13px;
        color: var(--text-3);
      }
      .tp-modal-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 8px 22px 20px;
        display: flex; flex-direction: column; gap: 14px;
      }
      .tp-modal-foot {
        flex-shrink: 0;
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 14px 22px;
        border-top: 1px solid var(--border);
        background: var(--surface-2);
      }
      .tp-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .tp-field { display: flex; flex-direction: column; gap: 6px; }
      .tp-field-label {
        font-size: 12.5px; font-weight: 600;
        color: var(--text-2);
        letter-spacing: .01em;
      }
      .tp-field-label .req { color: var(--danger); margin-left: 3px; }
      .tp-field input,
      .tp-field textarea,
      .tp-field select {
        font-family: inherit;
        font-size: 14px;
        color: var(--text);
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        padding: 10px 12px;
        width: 100%;
        transition: border-color .15s, box-shadow .15s;
        outline: none;
      }
      .tp-field textarea { resize: vertical; min-height: 80px; }
      .tp-field input:focus,
      .tp-field textarea:focus,
      .tp-field select:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.14);
      }
      .tp-date-input {
        display: flex; align-items: center; gap: 8px;
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        padding: 0 12px;
        color: var(--text-3);
      }
      .tp-date-input input {
        border: none; padding: 10px 0;
      }
      .tp-date-input input:focus { box-shadow: none; }
      .tp-date-input:focus-within {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.14);
      }

      /* Confirm */
      .tp-confirm {
        background: var(--surface);
        width: 100%;
        max-width: 380px;
        border-radius: 16px;
        padding: 22px;
        text-align: center;
        box-shadow: var(--shadow-lg);
        animation: pop .22s cubic-bezier(.2,.7,.3,1.3);
      }
      .tp-confirm-icon {
        width: 48px; height: 48px;
        background: var(--danger-50);
        color: var(--danger);
        border-radius: 999px;
        margin: 0 auto 12px;
        display: grid; place-items: center;
      }
      .tp-confirm h3 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
      .tp-confirm p { margin: 0 0 18px; color: var(--text-2); font-size: 14px; }
      .tp-confirm-actions { display: flex; gap: 8px; justify-content: center; }

      /* Toasts */
      .toast-stack {
        position: fixed; bottom: 22px; left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        display: flex; flex-direction: column;
        align-items: center; gap: 8px;
      }
      .toast {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 16px;
        border-radius: 10px;
        background: #1f2937;
        color: #fff;
        font-size: 13.5px; font-weight: 500;
        box-shadow: var(--shadow-lg);
        animation: toastIn .25s ease;
      }
      .toast-success { background: #064e3b; }
      .toast-error   { background: #7f1d1d; }
      @keyframes toastIn {
        from { transform: translateY(8px); opacity: 0 }
        to   { transform: none; opacity: 1 }
      }

      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Field hint */
      .tp-field-hint {
        font-size: 12px; color: var(--text-3); margin-top: 4px;
      }
      .tp-field-hint code {
        background: var(--surface-2);
        padding: 1px 5px; border-radius: 4px;
        font-size: 11.5px;
      }

      /* Assignee picker */
      .tp-picker {
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        transition: border-color .15s, box-shadow .15s;
      }
      .tp-picker.open {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.14);
      }
      .tp-picker-trigger {
        width: 100%;
        background: transparent;
        border: none;
        padding: 8px 10px;
        min-height: 42px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: inherit;
        text-align: left;
      }
      .tp-picker-chips {
        display: flex; flex-wrap: wrap; gap: 6px;
        flex: 1;
        align-items: center;
      }
      .tp-picker-placeholder {
        color: var(--text-3);
        font-size: 13.5px;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .tp-chip-selected {
        display: inline-flex; align-items: center; gap: 6px;
        background: var(--primary-50);
        border: 1px solid #c7d2fe;
        color: var(--primary-600);
        border-radius: 999px;
        padding: 3px 4px 3px 4px;
        font-size: 12.5px;
        font-weight: 600;
        max-width: 220px;
      }
      .tp-chip-name {
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tp-tag-team {
        background: rgba(99,102,241,.18);
        color: var(--primary-600);
        font-size: 9.5px;
        padding: 1px 5px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .tp-chip-remove {
        display: inline-grid;
        place-items: center;
        width: 16px; height: 16px;
        border-radius: 999px;
        cursor: pointer;
        color: var(--primary-600);
        opacity: .7;
        transition: opacity .12s, background .12s;
      }
      .tp-chip-remove:hover {
        opacity: 1;
        background: rgba(99,102,241,.18);
      }
      .tp-picker-caret {
        color: var(--text-3);
        flex-shrink: 0;
        transition: transform .15s;
      }
      .tp-picker-caret.open { transform: rotate(180deg); }

      /* Inline expanding panel — no overflow surprises inside scrollable parents */
      .tp-picker-panel {
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        animation: panelIn .16s ease;
      }
      @keyframes panelIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: none; }
      }
      .tp-picker-search {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        color: var(--text-3);
        background: var(--surface-2);
      }
      .tp-picker-search input {
        flex: 1; border: none; outline: none;
        background: transparent; font-size: 13.5px;
        color: var(--text); font-family: inherit;
      }
      .tp-picker-list {
        max-height: 280px;
        overflow-y: auto;
        padding: 6px;
      }
      .tp-picker-group {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: var(--text-3);
        padding: 8px 8px 4px;
      }

      /* Rows */
      .tp-picker-row {
        width: 100%;
        background: transparent;
        border: none;
        font-family: inherit;
        text-align: left;
        display: flex; align-items: center; gap: 10px;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
        transition: background .12s;
      }
      .tp-picker-row.compact { padding: 6px 8px; }
      .tp-picker-row:hover { background: var(--surface-2); }
      .tp-picker-row.selected { background: var(--primary-50); }
      .tp-picker-row-text { flex: 1; min-width: 0; }
      .tp-picker-row-name {
        font-size: 13.5px; font-weight: 600;
        color: var(--text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tp-picker-row-sub {
        font-size: 11.5px; color: var(--text-3);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        margin-top: 1px;
      }
      .tp-picker-check { color: var(--text-3); flex-shrink: 0; }
      .tp-picker-check.on { color: var(--primary); }
      .tp-picker-empty {
        text-align: center;
        color: var(--text-3);
        padding: 20px;
        font-size: 13px;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .tp-picker-empty.small { padding: 10px; font-size: 12.5px; }

      /* Team block: row + expand button + nested members */
      .tp-team-block {
        border-radius: 8px;
      }
      .tp-team-block .tp-picker-row {
        flex: 1;
        padding-right: 0;
      }
      .tp-team-block > .tp-picker-row {
        display: flex;
      }
      .tp-row-tap {
        flex: 1;
        background: transparent;
        border: none;
        font-family: inherit;
        text-align: left;
        display: flex; align-items: center; gap: 10px;
        padding: 0;
        cursor: pointer;
        min-width: 0;
      }
      .tp-team-expand {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 6px 8px;
        margin-left: 4px;
        border-radius: 6px;
        color: var(--text-3);
        display: grid; place-items: center;
        transition: background .12s, color .12s;
      }
      .tp-team-expand:hover { background: var(--surface-2); color: var(--text); }
      .tp-team-expand .rot { transform: rotate(180deg); }
      .tp-team-members {
        margin: 4px 0 6px 36px;
        padding: 6px 6px 6px 10px;
        border-left: 2px dashed var(--border);
      }
      .tp-add-all {
        width: 100%;
        background: var(--primary-50);
        border: 1px dashed #c7d2fe;
        color: var(--primary-600);
        border-radius: 8px;
        padding: 6px 10px;
        margin-bottom: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      }
      .tp-add-all:hover { background: rgba(99,102,241,.15); }

      /* Footer of picker */
      .tp-picker-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-top: 1px solid var(--border);
        background: var(--surface-2);
      }
      .tp-picker-count {
        font-size: 12px;
        color: var(--text-3);
        font-weight: 500;
      }
      .tp-picker-done {
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 7px;
        padding: 6px 14px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .tp-picker-done:hover { background: var(--primary-600); }

      /* Responsive */
      @media (max-width: 1100px) {
        .tp-stats { grid-template-columns: repeat(3, 1fr); }
      }
      @media (max-width: 900px) {
        .tp-board { grid-template-columns: repeat(2, minmax(240px, 1fr)); }
      }
      @media (max-width: 740px) {
        .tp-header-inner {
          grid-template-columns: 1fr auto;
          row-gap: 10px;
        }
        .tp-search { grid-column: 1 / -1; max-width: none; }
        .tp-subtitle { display: none; }
        .tp-stats { grid-template-columns: repeat(2, 1fr); }
        .tp-toolbar { flex-direction: column; align-items: stretch; }
        .tp-controls { justify-content: space-between; }
        .tp-fab { display: flex; }
        .hide-sm { display: none; }
        .tp-board { grid-template-columns: 1fr; }
      }
      @media (max-width: 480px) {
        .tp-main { padding: 18px 14px 100px; }
        .tp-header-inner { padding: 12px 14px; }
        .tp-row-2 { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}



