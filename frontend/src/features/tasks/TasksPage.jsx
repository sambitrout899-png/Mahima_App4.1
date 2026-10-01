// src/features/tasks/TasksPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Filter,
  Flag,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "../../utils/fetch-auth-shim";

const DEFAULT_LIMIT = 200;

const STATUS_OPTIONS = [
  { code: 0, key: "pending", label: "Pending", bg: "#eef2f7", fg: "#344054" },
  { code: 1, key: "in-progress", label: "In Progress", bg: "#fff5d7", fg: "#8a5c00" },
  { code: 2, key: "completed", label: "Completed", bg: "#e7f7ed", fg: "#146c43" },
  { code: 3, key: "on-hold", label: "On Hold", bg: "#fff0f0", fg: "#a83232" },
];

const PRIORITY_OPTIONS = [
  { value: 1, label: "Low" },
  { value: 2, label: "Normal" },
  { value: 3, label: "High" },
  { value: 4, label: "Critical" },
  { value: 5, label: "Urgent" },
];

const defaultFilters = {
  status: "all",
  assignee: "",
  priority: "all",
  due: "all",
  broadcast: "all",
  sortBy: "smart",
};

function defaultForm() {
  return {
    id: null,
    title: "",
    description: "",
    assignedToIds: [],
    dueDate: "",
    status: "Pending",
    priority: 2,
    broadcast: false,
  };
}


function isUnauthorizedError(err) {
  const text = String(err?.message || err || "");
  return err?.status === 401 || /401|unauthorized/i.test(text);
}

function friendlyError(err, fallback) {
  if (isUnauthorizedError(err)) {
    return "Your session has expired. Please log out and sign in again.";
  }

  return err?.message || fallback;
}

function normalizeResponse(res) {
  const data = res?.data ?? res;
  const items = Array.isArray(data)
    ? data
    : data?.items ?? data?.Items ?? data?.data ?? data?.Data ?? [];

  const list = Array.isArray(items) ? items : [];

  return {
    items: list,
    meta: {
      total: Array.isArray(data) ? list.length : data?.total ?? data?.Total ?? list.length,
      page: Array.isArray(data) ? 1 : data?.page ?? data?.Page ?? 1,
      limit: Array.isArray(data) ? list.length : data?.limit ?? data?.Limit ?? list.length,
    },
  };
}

function userIdOf(user) {
  return user?.id ?? user?.Id ?? user?.userId ?? user?.UserId ?? "";
}

function userNameOf(user) {
  return (
    user?.displayName ??
    user?.DisplayName ??
    user?.name ??
    user?.Name ??
    user?.fullName ??
    user?.FullName ??
    user?.username ??
    user?.userName ??
    user?.UserName ??
    user?.email ??
    user?.Email ??
    "Unknown user"
  );
}

function emailOf(user) {
  return user?.email ?? user?.Email ?? "";
}

function initialsOf(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeStatusValue(raw) {
  if (raw == null || raw === "") return 0;

  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber)) return asNumber;

  const text = normalizeText(raw).replace(/[-_]/g, " ");

  if (text === "done" || text === "complete" || text === "completed") return 2;
  if (text === "in progress" || text === "inprogress") return 1;
  if (text === "on hold" || text === "hold") return 3;

  return 0;
}

function statusOptionOf(value) {
  const code = normalizeStatusValue(value);
  return STATUS_OPTIONS.find((status) => status.code === code) ?? STATUS_OPTIONS[0];
}

function priorityLabel(priority) {
  const value = Number(priority) || 2;
  return PRIORITY_OPTIONS.find((item) => item.value === value)?.label ?? `P${value}`;
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isCompleted(task) {
  return normalizeStatusValue(task.statusCode ?? task.status ?? task.Status) === 2;
}

function isOverdue(task) {
  const raw = task.dueDate ?? task.DueDate;
  if (!raw || isCompleted(task)) return false;

  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return false;

  due.setHours(0, 0, 0, 0);
  return due < startOfToday();
}

function isDueToday(task) {
  const raw = task.dueDate ?? task.DueDate;
  if (!raw) return false;

  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return false;

  due.setHours(0, 0, 0, 0);
  return due.getTime() === startOfToday().getTime();
}

function isDueThisWeek(task) {
  const raw = task.dueDate ?? task.DueDate;
  if (!raw) return false;

  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return false;

  due.setHours(0, 0, 0, 0);

  const today = startOfToday();
  return due >= today && due <= addDays(today, 7);
}

function dueTime(task) {
  const raw = task.dueDate ?? task.DueDate;
  if (!raw) return Number.POSITIVE_INFINITY;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
}

function dueLabel(task) {
  const raw = task.dueDate ?? task.DueDate;
  if (!raw) return "No due date";

  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return "Invalid date";

  due.setHours(0, 0, 0, 0);

  const today = startOfToday();
  const diffDays = Math.round((due - today) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 0) return `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} overdue`;

  return due.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeTask(task) {
  const assignedToIds =
    task.AssigneeIds ??
    task.assigneeIds ??
    task.AssignedToIds ??
    task.assignedToIds ??
    (task.AssigneeId ? [String(task.AssigneeId)] : []);

  const rawStatus = task.Status ?? task.status ?? (task.Completed ? "Completed" : "Pending");
  const status = statusOptionOf(rawStatus);

  return {
    ...task,
    id: task.Id ?? task.id ?? null,
    title: task.Title ?? task.title ?? "",
    description: task.Description ?? task.description ?? "",
    assignedToIds: Array.isArray(assignedToIds) ? assignedToIds.map(String) : [],
    assignedTo:
      Array.isArray(task.AssignedToNames)
        ? task.AssignedToNames.join(", ")
        : task.AssignedToNames ?? task.AssignedToName ?? task.assignedTo ?? "",
    dueDate: task.DueDate ?? task.dueDate ?? "",
    priority: Number(task.Priority ?? task.priority ?? 2),
    broadcast: Boolean(task.Broadcast ?? task.broadcast),
    statusCode: status.code,
    status: status.label,
  };
}

function splitSearchTokens(query) {
  const tokens = [];

  String(query || "").replace(/"([^"]+)"|(\S+)/g, (_, quoted, bare) => {
    tokens.push(quoted || bare);
    return "";
  });

  return tokens.filter(Boolean);
}

function getStoredAdminFlag() {
  const keys = ["mahima_user", "authUser", "currentUser", "user"];

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const user = JSON.parse(raw);
      const roles = [
        user?.role,
        user?.Role,
        ...(Array.isArray(user?.roles) ? user.roles : []),
        ...(Array.isArray(user?.Roles) ? user.Roles : []),
      ]
        .filter(Boolean)
        .map((role) => String(role).toLowerCase());

      if (roles.some((role) => ["admin", "administrator", "superadmin"].includes(role))) {
        return true;
      }
    } catch {
      // Ignore malformed storage.
    }
  }

  return false;
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  type = "button",
  disabled = false,
  loading = false,
  variant = "neutral",
}) {
  return (
    <button
      type={type}
      className={`task-icon-btn task-icon-btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
      title={label}
      aria-label={label}
    >
      {loading ? <Loader2 className="task-spin" size={18} /> : <Icon size={18} />}
      <span className="task-tooltip">{label}</span>
    </button>
  );
}

function ActionButton({
  icon: Icon,
  children,
  onClick,
  type = "button",
  disabled = false,
  loading = false,
  variant = "primary",
}) {
  return (
    <button
      type={type}
      className={`task-action-btn task-action-btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <Loader2 className="task-spin" size={18} /> : <Icon size={18} />}
      <span>{children}</span>
    </button>
  );
}

function MultiUserSelect({ allUsers = [], value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const selectedSet = useMemo(() => new Set((value || []).map(String)), [value]);

  const selectedUsers = useMemo(
    () =>
      (value || []).map((id) => {
        const user = allUsers.find((item) => String(userIdOf(item)) === String(id));
        return user ?? { id, displayName: "Unknown user" };
      }),
    [allUsers, value]
  );

  const filteredUsers = useMemo(() => {
    const query = normalizeText(filter);

    return allUsers
      .filter((user) => {
        if (!query) return true;
        return normalizeText(`${userNameOf(user)} ${emailOf(user)}`).includes(query);
      })
      .slice(0, 120);
  }, [allUsers, filter]);

  const toggleUser = (id) => {
    const next = new Set(selectedSet);

    if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));

    onChange(Array.from(next));
  };

  const removeUser = (id) => {
    const next = new Set(selectedSet);
    next.delete(String(id));
    onChange(Array.from(next));
  };

  return (
    <div className="assignee-picker">
      <div
        role="button"
        tabIndex={0}
        className="assignee-trigger"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "Enter") setOpen((prev) => !prev);
        }}
      >
        <div className="assignee-chip-row">
          {selectedUsers.length === 0 ? (
            <span className="muted-text">Choose assignees</span>
          ) : (
            selectedUsers.map((user) => {
              const id = userIdOf(user) || user.id;
              const name = userNameOf(user);

              return (
                <span className="assignee-chip" key={id}>
                  <span className="mini-avatar">{initialsOf(name)}</span>
                  <span>{name}</span>
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeUser(id);
                    }}
                    aria-label={`Remove ${name}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })
          )}
        </div>

        <span className="assignee-count">{selectedUsers.length}</span>
      </div>

      {open && (
        <div className="assignee-panel">
          <div className="task-search-wrap">
            <Search size={18} />
            <input
              className="task-input task-search-input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search people..."
            />
          </div>

          <div className="assignee-list">
            {filteredUsers.length === 0 ? (
              <div className="task-empty">No users found.</div>
            ) : (
              filteredUsers.map((user) => {
                const id = userIdOf(user);
                const name = userNameOf(user);
                const checked = selectedSet.has(String(id));

                return (
                  <label className="assignee-row" key={id}>
                    <input type="checkbox" checked={checked} onChange={() => toggleUser(id)} />
                    <span className="mini-avatar">{initialsOf(name)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="assignee-name">{name}</span>
                      {emailOf(user) && <span className="assignee-email">{emailOf(user)}</span>}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="assignee-actions">
            <ActionButton icon={X} onClick={() => onChange([])} variant="secondary">
              Clear
            </ActionButton>
            <ActionButton icon={Check} onClick={() => setOpen(false)}>
              Done
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: DEFAULT_LIMIT });
  const [allUsers, setAllUsers] = useState([]);

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [view, setView] = useState("list");

  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState(null);
  const [changingOwnerId, setChangingOwnerId] = useState(null);

  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [form, setForm] = useState(defaultForm());

  const [isAdmin] = useState(getStoredAdminFlag);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const findUser = useCallback(
    (id) =>
      allUsers.find((user) => {
        const uid = userIdOf(user);
        return String(uid) === String(id);
      }),
    [allUsers]
  );

  const findUserDisplay = useCallback(
    (id) => {
      const user = findUser(id);
      return user ? userNameOf(user) : "";
    },
    [findUser]
  );

  const assignedNamesOf = useCallback(
    (task) => {
      if (task.assignedTo && String(task.assignedTo).trim()) return task.assignedTo;

      return (task.assignedToIds || [])
        .map(findUserDisplay)
        .filter(Boolean)
        .join(", ");
    },
    [findUserDisplay]
  );

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);

    try {
      const res = await apiFetch("/users?limit=1000");
      const { items } = normalizeResponse(res);

      const normalized = items
        .map((user) => ({
          ...user,
          id: String(userIdOf(user) || ""),
          displayName: userNameOf(user),
        }))
        .filter((user) => user.id)
        .sort((a, b) => userNameOf(a).localeCompare(userNameOf(b)));

      setAllUsers(normalized);
    } catch (err) {
      if (!isUnauthorizedError(err)) console.warn("fetchUsers:", err);
      setAllUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchTasks = useCallback(async (page = 1, limit = DEFAULT_LIMIT) => {
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch(`/tasks?page=${page}&limit=${limit}`);
      const { items, meta: nextMeta } = normalizeResponse(res);
      const normalized = items.map(normalizeTask);

      setTasks(normalized);
      setMeta({
        total: nextMeta.total ?? normalized.length,
        page: nextMeta.page ?? page,
        limit: nextMeta.limit ?? limit,
      });
    } catch (err) {
      if (!isUnauthorizedError(err)) console.warn("fetchTasks:", err);
      setTasks([]);
      setError(friendlyError(err, "Unable to load tasks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchUsers(), fetchTasks()]);
  }, [fetchUsers, fetchTasks]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const openAdd = () => {
    setForm(defaultForm());
    setShowModal(true);
  };

  const openEdit = (task) => {
    setForm({
      id: task.id ?? task.Id ?? null,
      title: task.title ?? task.Title ?? "",
      description: task.description ?? task.Description ?? "",
      assignedToIds: task.assignedToIds ?? [],
      dueDate: toDateInput(task.dueDate ?? task.DueDate),
      status: task.status ?? statusOptionOf(task.statusCode).label,
      priority: task.priority ?? 2,
      broadcast: Boolean(task.broadcast ?? task.Broadcast),
    });
    setShowModal(true);
  };

  const taskPayload = (task, overrides = {}) => {
    const next = { ...task, ...overrides };

    return {
      Id: next.id ?? next.Id ?? undefined,
      Title: next.title ?? next.Title ?? "",
      Description: next.description ?? next.Description ?? null,
      AssigneeIds: Array.isArray(next.assignedToIds) ? next.assignedToIds.filter(Boolean) : [],
      TeamId: null,
      Status: normalizeStatusValue(next.status ?? next.Status ?? next.statusCode),
      Priority: Number(next.priority ?? next.Priority ?? 2),
      DueDate: next.dueDate ? new Date(next.dueDate).toISOString() : null,
      Broadcast: Boolean(next.broadcast ?? next.Broadcast),
    };
  };

  const saveTask = async (event) => {
    event?.preventDefault?.();

    if (!form.title.trim()) {
      notify("Task title is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = taskPayload(form);
      const method = form.id ? "PUT" : "POST";
      const url = form.id ? `/tasks/${encodeURIComponent(form.id)}` : "/tasks";

  await apiFetch(url, {
  method,
  body: JSON.stringify(payload),
});
      setShowModal(false);
      await fetchTasks(meta.page, meta.limit);
      notify(form.id ? "Task updated." : "Task created.");
    } catch (err) {
      notify(friendlyError(err, "Unable to save task."));
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async (id) => {
    if (!id || !window.confirm("Delete this task?")) return;

    setBusyTaskId(id);

    try {
      await apiFetch(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      await fetchTasks(meta.page, meta.limit);
      notify("Task deleted.");
    } catch (err) {
      notify(friendlyError(err, "Unable to delete task."));
    } finally {
      setBusyTaskId(null);
    }
  };

  const sendTaskNotification = async (id) => {
    if (!id) return;

    setBusyTaskId(id);

    try {
      await apiFetch(`/tasks/${encodeURIComponent(id)}/send`, { method: "POST" });
      await fetchTasks(meta.page, meta.limit);
      notify("Task notification sent.");
    } catch (err) {
      notify(friendlyError(err, "Unable to send notification."));
    } finally {
      setBusyTaskId(null);
    }
  };

  const quickSetStatus = async (task, statusLabel) => {
    const id = task.id ?? task.Id;
    if (!id) return;

    setBusyTaskId(id);

    try {
     await apiFetch(`/tasks/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: JSON.stringify(taskPayload(task, { status: statusLabel })),
});
      await fetchTasks(meta.page, meta.limit);
      notify(`Marked ${statusLabel.toLowerCase()}.`);
    } catch (err) {
      notify(friendlyError(err, "Unable to update status."));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleChangeOwner = async (task, newOwnerId) => {
    const id = task.id ?? task.Id;
    if (!id) return;

    setChangingOwnerId(id);

    try {
    await apiFetch(`/tasks/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: JSON.stringify(taskPayload(task, { assignedToIds: newOwnerId ? [String(newOwnerId)] : [] })),
});
      await fetchTasks(meta.page, meta.limit);
      notify("Owner updated.");
    } catch (err) {
      notify(friendlyError(err, "Unable to update owner."));
    } finally {
      setChangingOwnerId(null);
    }
  };

  const copyTaskLink = async (task) => {
    const id = task.id ?? task.Id;
    const link = `${window.location.origin}${window.location.pathname}#/home/tasks/${id}`;

    try {
      await navigator.clipboard?.writeText(link);
      notify("Task link copied.");
    } catch {
      notify(link);
    }
  };

  const matchesSearch = useCallback(
    (task) => {
      const tokens = splitSearchTokens(query);
      if (tokens.length === 0) return true;

      const status = statusOptionOf(task.statusCode).label;
      const assignees = assignedNamesOf(task);
      const blob = normalizeText(
        [
          task.title,
          task.description,
          status,
          assignees,
          priorityLabel(task.priority),
          dueLabel(task),
          task.broadcast ? "broadcast" : "",
        ].join(" ")
      );

      return tokens.every((token) => {
        const raw = String(token);
        const colonIndex = raw.indexOf(":");

        if (colonIndex > 0) {
          const key = normalizeText(raw.slice(0, colonIndex));
          const value = normalizeText(raw.slice(colonIndex + 1));

          if (key === "status") return normalizeText(status).includes(value);
          if (key === "assignee" || key === "owner") return normalizeText(assignees).includes(value);
          if (key === "priority") return normalizeText(`${task.priority} ${priorityLabel(task.priority)}`).includes(value);
          if (key === "due") return normalizeText(dueLabel(task)).includes(value);
          if (key === "broadcast") return value === "yes" ? task.broadcast : !task.broadcast;

          return blob.includes(value);
        }

        return blob.includes(normalizeText(raw));
      });
    },
    [assignedNamesOf, query]
  );

  const filteredTasks = useMemo(() => {
    let list = tasks.filter(matchesSearch);

    if (filters.status !== "all") {
      list = list.filter((task) => statusOptionOf(task.statusCode).key === filters.status);
    }

    if (filters.assignee) {
      list = list.filter((task) => (task.assignedToIds || []).map(String).includes(String(filters.assignee)));
    }

    if (filters.priority !== "all") {
      list = list.filter((task) => Number(task.priority) === Number(filters.priority));
    }

    if (filters.broadcast !== "all") {
      list = list.filter((task) => Boolean(task.broadcast) === (filters.broadcast === "yes"));
    }

    if (filters.due === "overdue") list = list.filter(isOverdue);
    if (filters.due === "today") list = list.filter(isDueToday);
    if (filters.due === "week") list = list.filter(isDueThisWeek);
    if (filters.due === "none") list = list.filter((task) => !task.dueDate);
    if (filters.due === "future") {
      list = list.filter((task) => task.dueDate && !isOverdue(task) && !isDueToday(task));
    }

    const sorted = [...list];

    sorted.sort((a, b) => {
      if (filters.sortBy === "title") return String(a.title).localeCompare(String(b.title));
      if (filters.sortBy === "priority") return Number(b.priority || 0) - Number(a.priority || 0);
      if (filters.sortBy === "due") return dueTime(a) - dueTime(b);
      if (filters.sortBy === "status") return Number(a.statusCode) - Number(b.statusCode);

      const completedDiff = Number(isCompleted(a)) - Number(isCompleted(b));
      if (completedDiff !== 0) return completedDiff;

      const overdueDiff = Number(isOverdue(b)) - Number(isOverdue(a));
      if (overdueDiff !== 0) return overdueDiff;

      const dueDiff = dueTime(a) - dueTime(b);
      if (dueDiff !== 0) return dueDiff;

      return Number(b.priority || 0) - Number(a.priority || 0);
    });

    return sorted;
  }, [filters, matchesSearch, tasks]);

  const exportTasks = () => {
    const rows = [
      ["Title", "Description", "Status", "Priority", "Due Date", "Assigned To", "Broadcast"],
      ...filteredTasks.map((task) => [
        task.title,
        task.description,
        task.status,
        priorityLabel(task.priority),
        task.dueDate ? toDateInput(task.dueDate) : "",
        assignedNamesOf(task),
        task.broadcast ? "Yes" : "No",
      ]),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "tasks.csv";
    anchor.click();

    URL.revokeObjectURL(url);
  };

  const stats = useMemo(
    () => ({
      visible: filteredTasks.length,
      overdue: tasks.filter(isOverdue).length,
      today: tasks.filter(isDueToday).length,
      completed: tasks.filter(isCompleted).length,
    }),
    [filteredTasks.length, tasks]
  );

  const agendaGroups = useMemo(() => {
    const groups = new Map();

    filteredTasks.forEach((task) => {
      const key = task.dueDate ? toDateInput(task.dueDate) : "No due date";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });

    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "No due date") return 1;
      if (b === "No due date") return -1;
      return String(a).localeCompare(String(b));
    });
  }, [filteredTasks]);

  const activeFilterCount = Object.entries(defaultFilters).filter(
    ([key, value]) => filters[key] !== value
  ).length;

  const renderTaskCard = (task, compact = false) => {
    const id = task.id ?? task.Id;
    const status = statusOptionOf(task.statusCode);
    const assignedNames = assignedNamesOf(task);
    const busy = busyTaskId === id;
    const completed = isCompleted(task);

    return (
      <article className={`task-card ${compact ? "task-card-compact" : ""}`} key={id}>
        <div className="task-card-main">
          <div>
            <div className="task-title">{task.title || "Untitled task"}</div>
            {!compact && <div className="task-desc">{task.description || "No description"}</div>}

            <div className="task-badges">
              <span className="task-badge" style={{ background: status.bg, color: status.fg }}>
                {status.label}
              </span>
              <span className="task-badge">
                <Flag size={14} />
                {priorityLabel(task.priority)}
              </span>
              <span className={`task-badge ${isOverdue(task) ? "task-badge-danger" : ""}`}>
                <Clock size={14} />
                {dueLabel(task)}
              </span>
              {task.broadcast && (
                <span className="task-badge">
                  <Bell size={14} />
                  Broadcast
                </span>
              )}
            </div>
          </div>

          <div className="task-people">
            <Users size={15} />
            <span>{assignedNames || "Unassigned"}</span>
          </div>
        </div>

        {isAdmin && (
          <div className="owner-row">
            <span>Owner</span>
            <select
              className="task-select"
              value={(task.assignedToIds || [])[0] || ""}
              disabled={changingOwnerId === id}
              onChange={(event) => handleChangeOwner(task, event.target.value || null)}
            >
              <option value="">Unassigned</option>
              {allUsers.map((user) => (
                <option key={userIdOf(user)} value={userIdOf(user)}>
                  {userNameOf(user)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="task-card-actions">
          <IconButton icon={Pencil} label="Edit task" onClick={() => openEdit(task)} variant="neutral" />
          <IconButton
            icon={CheckCircle2}
            label={completed ? "Reopen task" : "Mark complete"}
            onClick={() => quickSetStatus(task, completed ? "Pending" : "Completed")}
            loading={busy}
            disabled={Boolean(busyTaskId && busyTaskId !== id)}
            variant={completed ? "soft" : "primary"}
          />
          <IconButton
            icon={Send}
            label="Send notification"
            onClick={() => sendTaskNotification(id)}
            loading={busy}
            disabled={Boolean(busyTaskId && busyTaskId !== id)}
            variant="soft"
          />
          <IconButton icon={Copy} label="Copy link" onClick={() => copyTaskLink(task)} variant="neutral" />
          <IconButton
            icon={Trash2}
            label="Delete task"
            onClick={() => deleteTask(id)}
            loading={busy}
            disabled={Boolean(busyTaskId && busyTaskId !== id)}
            variant="danger"
          />
        </div>
      </article>
    );
  };

  return (
    <div className="tasks-page">
      <style>{`
        .tasks-page {
          min-height: 100vh;
          padding: 14px;
          padding-bottom: calc(92px + env(safe-area-inset-bottom));
          background: #f9f6ef;
          color: #332817;
        }

        .tasks-shell {
          display: grid;
          gap: 14px;
        }

        .tasks-header {
          display: grid;
          gap: 14px;
        }

        .tasks-title {
          margin: 0;
          color: #6b4f1d;
          font-size: clamp(28px, 9vw, 38px);
          line-height: 1.05;
          font-weight: 900;
        }

        .tasks-subtitle {
          color: #8a7a5c;
          font-size: 14px;
          line-height: 1.45;
        }

        .tasks-toolbar {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .tasks-search-stack {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          gap: 8px;
          padding: 10px 0;
          background: #f9f6ef;
        }

        .tasks-search-row {
          display: grid;
          grid-template-columns: 1fr 48px 48px;
          gap: 10px;
        }

        .task-search-wrap {
          position: relative;
          min-width: 0;
        }

        .task-search-wrap svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #8a7a5c;
          pointer-events: none;
        }

        .task-input,
        .task-select,
        .task-textarea {
          width: 100%;
          border: 1px solid #ddd2bd;
          border-radius: 14px;
          background: #fff;
          color: #332817;
          font-size: 16px;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .task-input,
        .task-select {
          height: 46px;
          padding: 0 12px;
        }

        .task-search-input {
          padding-left: 40px;
        }

        .task-textarea {
          min-height: 96px;
          padding: 12px;
          resize: vertical;
          line-height: 1.4;
        }

        .task-input:focus,
        .task-select:focus,
        .task-textarea:focus {
          outline: none;
          border-color: #b89b58;
          box-shadow: 0 0 0 4px rgba(184, 155, 88, 0.18);
        }

        .task-chip-row {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .task-chip-row::-webkit-scrollbar {
          display: none;
        }

        .task-chip {
          border: 1px solid #eadfca;
          border-radius: 999px;
          background: #fff;
          color: #6b4f1d;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          cursor: pointer;
        }

        .task-chip-active {
          background: #f8f2e6;
        }

        .task-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .task-stat {
          min-height: 58px;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid #eee2cf;
          border-radius: 14px;
          background: #fff;
          color: #6b4f1d;
          padding: 12px;
          font-weight: 900;
          box-shadow: 0 8px 24px rgba(80, 60, 28, 0.06);
        }

        .view-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .view-tab {
          min-height: 44px;
          border: 1px solid #eadfca;
          border-radius: 14px;
          background: #fff;
          color: #6b4f1d;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-weight: 900;
          cursor: pointer;
        }

        .view-tab-active {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .task-alert {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          border-radius: 12px;
          background: #fff3f3;
          color: #9b1c1c;
          border: 1px solid #ffd1d1;
          line-height: 1.4;
        }

        .task-list {
          display: grid;
          gap: 12px;
        }

        .task-card {
          display: grid;
          gap: 14px;
          padding: 14px;
          border-radius: 14px;
          border: 1px solid #eee2cf;
          background: #fff;
          box-shadow: 0 8px 24px rgba(80, 60, 28, 0.08);
        }

        .task-card-main {
          display: grid;
          gap: 10px;
          min-width: 0;
        }

        .task-title {
          color: #332817;
          font-weight: 900;
          font-size: 16px;
          line-height: 1.25;
        }

        .task-desc {
          margin-top: 4px;
          color: #777;
          font-size: 13px;
          line-height: 1.4;
        }

        .task-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }

        .task-badge {
          min-height: 32px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 9px;
          border-radius: 9px;
          background: #f8f2e6;
          color: #6b4f1d;
          border: 1px solid #eadfca;
          font-size: 12px;
          font-weight: 900;
        }

        .task-badge-danger {
          background: #fff3f3;
          color: #a83232;
          border-color: #f3c3c3;
        }

        .task-people {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #76664b;
          font-size: 13px;
          font-weight: 800;
          min-width: 0;
        }

        .task-people span {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .task-card-actions {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
        }

        .owner-row {
          display: grid;
          gap: 6px;
          color: #8a7a5c;
          font-size: 12px;
          font-weight: 900;
        }

        .task-empty {
          color: #76664b;
          background: #fff;
          border: 1px dashed #d8c9ad;
          border-radius: 12px;
          padding: 18px;
          line-height: 1.45;
        }

        .board-scroll {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(285px, 86vw);
          gap: 12px;
          overflow-x: auto;
          padding-bottom: 8px;
          scroll-snap-type: x mandatory;
        }

        .board-column {
          scroll-snap-align: start;
          display: grid;
          gap: 10px;
          align-content: start;
          border: 1px solid #eee2cf;
          background: rgba(255, 255, 255, 0.72);
          border-radius: 16px;
          padding: 12px;
        }

        .board-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-weight: 900;
          color: #6b4f1d;
        }

        .agenda-list {
          display: grid;
          gap: 14px;
        }

        .agenda-group {
          display: grid;
          gap: 10px;
        }

        .agenda-title {
          position: sticky;
          top: 76px;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid #eadfca;
          border-radius: 12px;
          background: #f8f2e6;
          color: #6b4f1d;
          font-weight: 900;
        }

        .task-icon-btn,
        .task-action-btn {
          font-family: inherit;
          cursor: pointer;
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, color 160ms ease;
          -webkit-tap-highlight-color: transparent;
        }

        .task-icon-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 46px;
          border: 1px solid;
          border-radius: 14px;
        }

        .task-icon-btn-neutral {
          background: #fff;
          color: #6b4f1d;
          border-color: #e6dcc8;
        }

        .task-icon-btn-soft {
          background: #f8f2e6;
          color: #6b4f1d;
          border-color: #eadfca;
        }

        .task-icon-btn-primary {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .task-icon-btn-danger {
          background: #fff5f5;
          color: #a83232;
          border-color: #f3c3c3;
        }

        .task-icon-btn:hover:not(:disabled),
        .task-action-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(80, 60, 28, 0.14);
        }

        .task-icon-btn-primary:hover:not(:disabled),
        .task-action-btn-primary:hover:not(:disabled) {
          background: #5a4217;
        }

        .task-icon-btn-danger:hover:not(:disabled) {
          background: #a83232;
          color: #fff;
          border-color: #a83232;
        }

        .task-icon-btn:disabled,
        .task-action-btn:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        .task-tooltip {
          display: none;
        }

        .task-action-btn {
          width: 100%;
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 14px;
          padding: 0 14px;
          font-weight: 900;
          border: 1px solid;
          white-space: nowrap;
        }

        .task-action-btn-primary {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .task-action-btn-secondary {
          background: #fff;
          color: #6b4f1d;
          border-color: #e1d6c0;
        }

        .task-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(38, 30, 18, 0.48);
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .task-modal {
          width: 100%;
          max-height: 92vh;
          overflow: hidden;
          background: #fff;
          border: 1px solid #efe2cb;
          border-radius: 18px 18px 0 0;
          box-shadow: 0 -18px 60px rgba(0, 0, 0, 0.22);
          display: flex;
          flex-direction: column;
        }

        .task-modal-header,
        .task-modal-footer {
          padding: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-bottom: 1px solid #f0e5d4;
        }

        .task-modal-footer {
          border-top: 1px solid #f0e5d4;
          border-bottom: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          padding-bottom: max(14px, env(safe-area-inset-bottom));
        }

        .task-modal-title {
          margin: 0;
          color: #332817;
          font-size: 20px;
          font-weight: 900;
        }

        .task-modal-body {
          padding: 14px;
          overflow: auto;
        }

        .task-form-grid,
        .filter-grid {
          display: grid;
          gap: 12px;
        }

        .task-field label {
          display: block;
          margin-bottom: 6px;
          color: #8a7a5c;
          font-size: 12px;
          font-weight: 900;
        }

        .assignee-picker {
          position: relative;
        }

        .assignee-trigger {
          width: 100%;
          min-height: 50px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          border: 1px solid #ddd2bd;
          border-radius: 14px;
          background: #fff;
          padding: 8px;
          color: #332817;
          cursor: pointer;
        }

        .assignee-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
        }

        .assignee-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          max-width: 100%;
          border: 1px solid #eadfca;
          border-radius: 999px;
          background: #f8f2e6;
          color: #6b4f1d;
          padding: 5px 8px;
          font-size: 12px;
          font-weight: 900;
        }

        .mini-avatar {
          width: 24px;
          height: 24px;
          border-radius: 8px;
          background: linear-gradient(135deg, #efe4ca, #d7be83);
          color: #6b4f1d;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 900;
          flex-shrink: 0;
        }

        .chip-remove {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          background: transparent;
          color: #6b4f1d;
          cursor: pointer;
          padding: 0;
        }

        .assignee-count {
          min-width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #6b4f1d;
          color: #fff;
          font-size: 12px;
          font-weight: 900;
        }

        .assignee-panel {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(100% + 8px);
          z-index: 60;
          display: grid;
          gap: 10px;
          padding: 10px;
          border: 1px solid #eee2cf;
          border-radius: 16px;
          background: #fff;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18);
        }

        .assignee-list {
          display: grid;
          gap: 6px;
          max-height: 260px;
          overflow: auto;
        }

        .assignee-row {
          display: grid;
          grid-template-columns: auto auto 1fr;
          gap: 10px;
          align-items: center;
          padding: 8px;
          border-radius: 12px;
          background: #fffdfa;
          border: 1px solid #f0e5d4;
        }

        .assignee-name,
        .assignee-email {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .assignee-name {
          color: #332817;
          font-size: 13px;
          font-weight: 900;
        }

        .assignee-email {
          color: #777;
          font-size: 12px;
        }

        .assignee-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .muted-text {
          color: #8a7a5c;
          font-size: 13px;
          font-weight: 800;
        }

        .tasks-fab {
          position: fixed;
          left: 14px;
          right: 14px;
          bottom: max(14px, env(safe-area-inset-bottom));
          z-index: 30;
        }

        .task-toast {
          position: fixed;
          left: 14px;
          right: 14px;
          bottom: calc(78px + env(safe-area-inset-bottom));
          z-index: 80;
          border-radius: 14px;
          background: #332817;
          color: #fff;
          padding: 12px 14px;
          font-weight: 900;
          box-shadow: 0 14px 38px rgba(0, 0, 0, 0.2);
        }

        .task-spin {
          animation: task-spin 0.8s linear infinite;
        }

        @keyframes task-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (min-width: 760px) {
          .tasks-page {
            padding: 24px;
            padding-bottom: 24px;
          }

          .tasks-header {
            grid-template-columns: 1fr auto;
            align-items: center;
          }

          .tasks-toolbar {
            display: flex;
          }

          .task-stats {
            grid-template-columns: repeat(4, max-content);
          }

          .task-list {
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 18px;
          }

          .task-card-actions {
            display: flex;
          }

          .tasks-fab {
            left: auto;
            right: 24px;
            width: auto;
          }

          .task-modal-backdrop {
            align-items: center;
            padding: 16px;
          }

          .task-modal {
            width: min(860px, 100%);
            max-height: 90vh;
            border-radius: 16px;
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
          }

          .task-modal-header,
          .task-modal-footer {
            padding: 18px;
          }

          .task-modal-footer {
            display: flex;
            justify-content: flex-end;
          }

          .task-modal-body {
            padding: 18px;
          }

          .task-form-grid,
          .filter-grid {
            grid-template-columns: 1fr 1fr;
          }

          .task-field-full {
            grid-column: 1 / -1;
          }

          .task-action-btn {
            width: auto;
          }

          .task-icon-btn {
            width: 42px;
            height: 42px;
          }

          .task-tooltip {
            position: absolute;
            bottom: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%) translateY(4px);
            background: #332817;
            color: #fff;
            font-size: 11px;
            line-height: 1;
            padding: 7px 9px;
            border-radius: 8px;
            opacity: 0;
            pointer-events: none;
            white-space: nowrap;
            transition: opacity 140ms ease, transform 140ms ease;
            z-index: 20;
            display: block;
          }

          .task-icon-btn:hover .task-tooltip {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }

          .task-toast {
            left: auto;
            right: 24px;
            bottom: 24px;
            width: auto;
            min-width: 260px;
          }
        }
      `}</style>

      <div className="tasks-shell">
        <div className="tasks-header mahima-standard-page-header" data-mahima-explicit-header="true">
          <div>
            <h1 className="tasks-title mahima-standard-page-title" data-mahima-explicit-title="true">Tasks</h1>
            <div className="tasks-subtitle mahima-standard-page-subtitle">
              Plan, assign, track, and message ministry tasks with clear ownership.
            </div>
          </div>

          <div className="tasks-toolbar">
            <IconButton icon={RefreshCw} label="Refresh tasks" onClick={() => fetchTasks(meta.page, meta.limit)} loading={loading} variant="soft" />
            <IconButton icon={Download} label="Export tasks" onClick={exportTasks} variant="neutral" />
            <IconButton icon={Plus} label="New task" onClick={openAdd} variant="primary" />
          </div>
        </div>

        <div className="tasks-search-stack">
          <div className="tasks-search-row">
            <div className="task-search-wrap">
              <Search size={18} />
              <input
                className="task-input task-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks, assignees, status..."
              />
            </div>

            <IconButton
              icon={Filter}
              label="Filters"
              onClick={() => setFiltersOpen(true)}
              variant={activeFilterCount > 0 ? "primary" : "neutral"}
            />

            <IconButton
              icon={X}
              label="Clear search"
              onClick={() => {
                setQuery("");
                setFilters(defaultFilters);
              }}
              variant="soft"
            />
          </div>

          <div className="task-chip-row">
            <button className={`task-chip ${filters.due === "overdue" ? "task-chip-active" : ""}`} type="button" onClick={() => setFilters((prev) => ({ ...prev, due: prev.due === "overdue" ? "all" : "overdue" }))}>
              Overdue
            </button>
            <button className={`task-chip ${filters.due === "today" ? "task-chip-active" : ""}`} type="button" onClick={() => setFilters((prev) => ({ ...prev, due: prev.due === "today" ? "all" : "today" }))}>
              Today
            </button>
            <button className={`task-chip ${filters.status === "pending" ? "task-chip-active" : ""}`} type="button" onClick={() => setFilters((prev) => ({ ...prev, status: prev.status === "pending" ? "all" : "pending" }))}>
              Pending
            </button>
            <button className={`task-chip ${filters.status === "completed" ? "task-chip-active" : ""}`} type="button" onClick={() => setFilters((prev) => ({ ...prev, status: prev.status === "completed" ? "all" : "completed" }))}>
              Completed
            </button>
          </div>
        </div>

        <div className="task-stats">
          <div className="task-stat">
            <ClipboardList size={18} />
            Visible: {stats.visible}
          </div>
          <div className="task-stat">
            <AlertCircle size={18} />
            Overdue: {stats.overdue}
          </div>
          <div className="task-stat">
            <CalendarDays size={18} />
            Today: {stats.today}
          </div>
          <div className="task-stat">
            <CheckCircle2 size={18} />
            Done: {stats.completed}
          </div>
        </div>

        <div className="view-tabs">
          <button className={`view-tab ${view === "list" ? "view-tab-active" : ""}`} type="button" onClick={() => setView("list")}>
            <ClipboardList size={17} />
            List
          </button>
          <button className={`view-tab ${view === "board" ? "view-tab-active" : ""}`} type="button" onClick={() => setView("board")}>
            <Users size={17} />
            Board
          </button>
          <button className={`view-tab ${view === "agenda" ? "view-tab-active" : ""}`} type="button" onClick={() => setView("agenda")}>
            <CalendarDays size={17} />
            Agenda
          </button>
        </div>

        {error && (
          <div className="task-alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="task-empty">Loading tasks...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="task-empty">No tasks found.</div>
        ) : view === "list" ? (
          <div className="task-list">{filteredTasks.map((task) => renderTaskCard(task))}</div>
        ) : view === "board" ? (
          <div className="board-scroll">
            {STATUS_OPTIONS.map((status) => {
              const columnTasks = filteredTasks.filter((task) => statusOptionOf(task.statusCode).key === status.key);

              return (
                <section className="board-column" key={status.key}>
                  <div className="board-title">
                    <span>{status.label}</span>
                    <span className="task-badge">{columnTasks.length}</span>
                  </div>

                  {columnTasks.length === 0 ? (
                    <div className="task-empty">No tasks.</div>
                  ) : (
                    columnTasks.map((task) => renderTaskCard(task, true))
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="agenda-list">
            {agendaGroups.map(([date, groupTasks]) => (
              <section className="agenda-group" key={date}>
                <div className="agenda-title">
                  <span>
                    {date === "No due date"
                      ? "No due date"
                      : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                  </span>
                  <span>{groupTasks.length}</span>
                </div>

                {groupTasks.map((task) => renderTaskCard(task, true))}
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="tasks-fab">
        <ActionButton icon={Plus} onClick={openAdd}>
          New Task
        </ActionButton>
      </div>

      {toast && <div className="task-toast">{toast}</div>}

      {filtersOpen && (
        <div
          className="task-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target.classList.contains("task-modal-backdrop")) setFiltersOpen(false);
          }}
        >
          <div className="task-modal">
            <div className="task-modal-header">
              <h2 className="task-modal-title">Task Filters</h2>
              <IconButton icon={X} label="Close filters" onClick={() => setFiltersOpen(false)} variant="neutral" />
            </div>

            <div className="task-modal-body">
              <div className="filter-grid">
                <div className="task-field">
                  <label>Status</label>
                  <select className="task-select" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
                    <option value="all">All statuses</option>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status.key} value={status.key}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="task-field">
                  <label>Assignee</label>
                  <select className="task-select" value={filters.assignee} onChange={(event) => setFilters((prev) => ({ ...prev, assignee: event.target.value }))}>
                    <option value="">Anyone</option>
                    {allUsers.map((user) => (
                      <option key={userIdOf(user)} value={userIdOf(user)}>
                        {userNameOf(user)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="task-field">
                  <label>Priority</label>
                  <select className="task-select" value={filters.priority} onChange={(event) => setFilters((prev) => ({ ...prev, priority: event.target.value }))}>
                    <option value="all">Any priority</option>
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="task-field">
                  <label>Due</label>
                  <select className="task-select" value={filters.due} onChange={(event) => setFilters((prev) => ({ ...prev, due: event.target.value }))}>
                    <option value="all">Any due date</option>
                    <option value="overdue">Overdue</option>
                    <option value="today">Due today</option>
                    <option value="week">Next 7 days</option>
                    <option value="future">Future</option>
                    <option value="none">No due date</option>
                  </select>
                </div>

                <div className="task-field">
                  <label>Broadcast</label>
                  <select className="task-select" value={filters.broadcast} onChange={(event) => setFilters((prev) => ({ ...prev, broadcast: event.target.value }))}>
                    <option value="all">Any</option>
                    <option value="yes">Broadcast only</option>
                    <option value="no">Not broadcast</option>
                  </select>
                </div>

                <div className="task-field">
                  <label>Sort</label>
                  <select className="task-select" value={filters.sortBy} onChange={(event) => setFilters((prev) => ({ ...prev, sortBy: event.target.value }))}>
                    <option value="smart">Smart order</option>
                    <option value="due">Due date</option>
                    <option value="priority">Priority</option>
                    <option value="status">Status</option>
                    <option value="title">Title</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="task-modal-footer">
              <ActionButton icon={X} onClick={() => setFilters(defaultFilters)} variant="secondary">
                Clear
              </ActionButton>
              <ActionButton icon={Check} onClick={() => setFiltersOpen(false)}>
                Done
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div
          className="task-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target.classList.contains("task-modal-backdrop")) setShowModal(false);
          }}
        >
          <form className="task-modal" onSubmit={saveTask}>
            <div className="task-modal-header">
              <h2 className="task-modal-title">{form.id ? "Edit Task" : "New Task"}</h2>
              <IconButton icon={X} label="Close" onClick={() => setShowModal(false)} disabled={saving} variant="neutral" />
            </div>

            <div className="task-modal-body">
              <div className="task-form-grid">
                <div className="task-field task-field-full">
                  <label>Title</label>
                  <input className="task-input" value={form.title} onChange={(event) => setField("title", event.target.value)} autoFocus />
                </div>

                <div className="task-field task-field-full">
                  <label>Description</label>
                  <textarea className="task-textarea" value={form.description} onChange={(event) => setField("description", event.target.value)} />
                </div>

                <div className="task-field task-field-full">
                  <label>Assignees</label>
                  <MultiUserSelect allUsers={allUsers} value={form.assignedToIds} onChange={(ids) => setField("assignedToIds", ids)} />
                  {usersLoading && <div className="muted-text" style={{ marginTop: 6 }}>Loading users...</div>}
                </div>

                <div className="task-field">
                  <label>Due Date</label>
                  <input className="task-input" type="date" value={form.dueDate} onChange={(event) => setField("dueDate", event.target.value)} />
                </div>

                <div className="task-field">
                  <label>Status</label>
                  <select className="task-select" value={form.status} onChange={(event) => setField("status", event.target.value)}>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status.key} value={status.label}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="task-field">
                  <label>Priority</label>
                  <select className="task-select" value={form.priority} onChange={(event) => setField("priority", Number(event.target.value))}>
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="task-field">
                  <label>Broadcast</label>
                  <label className="assignee-trigger" style={{ justifyContent: "flex-start" }}>
                    <input type="checkbox" checked={Boolean(form.broadcast)} onChange={(event) => setField("broadcast", event.target.checked)} />
                    <span className="muted-text">Broadcast to upcoming events</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="task-modal-footer">
              <ActionButton icon={X} onClick={() => setShowModal(false)} disabled={saving} variant="secondary">
                Cancel
              </ActionButton>
              <ActionButton icon={Save} type="submit" loading={saving}>
                Save
              </ActionButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
