// src/features/staff/TimesheetPage.jsx
//
// Timesheets & Attendance — professional redesign.
//
//   Tabs:                    Overview | Timesheet | Attendance
//   Overview:                KPIs, per-staff summary table (admin)
//   Timesheet:               Weekly grid + list view, modal form, CSV export
//   Attendance:              Weekly grid + list view, modal form, bulk dialog
//                            (admin), quick "Mark me present" (staff)
//   Top toolbar:             date range, staff filter, view-mode toggle,
//                            export, "Log time / Mark present" CTA
//
// Backend API contract is unchanged:
//   GET    /timesheets   ?from&to&userId
//   POST   /timesheets
//   PUT    /timesheets/:id
//   DELETE /timesheets/:id
//   GET    /attendance   ?from&to&userId
//   POST   /attendance
//   PUT    /attendance/:id
//   DELETE /attendance/:id
//
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { API_BASE as ROOT_API_BASE } from "../../api";
import dayjs from "dayjs";
import {
  Clock,
  User as UserIcon,
  Calendar,
  Filter,
  Plus,
  ClipboardList,
  ListChecks,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  LayoutGrid,
  List as ListIcon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  TrendingUp,
  Users as UsersIcon,
  CalendarCheck,
  X,
  Send,
  Loader2,
  Search,
  Home,
} from "lucide-react";

import { getToken as authGetToken } from "../auth/authService";
import {
  getCurrentUser as permGetCurrentUser,
} from "../auth/permissionService";

/* =========================================================================
 *  Auth + API
 * ====================================================================== */
function getTokenFallback() {
  try {
    const direct =
      localStorage.getItem("mahima_token") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("token");
    if (direct) return direct.replace(/^Bearer\s+/i, "").trim();

    for (const key of ["mahima:user", "mahima_user", "user", "me", "mahima_currentUser", "currentUser"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const token = parsed?.token || parsed?.accessToken || parsed?.jwt || parsed?.data?.token;
      if (token) return String(token).replace(/^Bearer\s+/i, "").trim();
    }

    return "";
  } catch {
    return "";
  }
}
function getCurrentUserFallback() {
  try {
    const raw =
      localStorage.getItem("mahima_currentUser") ||
      localStorage.getItem("currentUser");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
const getToken = authGetToken || getTokenFallback;
const getCurrentUser = permGetCurrentUser || getCurrentUserFallback;

const API_BASE =
  (typeof window !== "undefined" && window.__API_BASE__) ||
  ROOT_API_BASE ||
  "/api";

const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use((config) => {
  try {
    const token = getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch { /* ignore */ }
  return config;
});

/* =========================================================================
 *  Constants & helpers
 * ====================================================================== */
const STATUSES = ["Present", "Absent", "Leave (Standard)", "Leave (Medical)", "Leave (Casual)", "Half-day", "WFH", "Weekend"];
const ASSIGNABLE_ROLE_NAMES = new Set(["admin", "administrator", "finance", "staff", "volunteer", "volunteers", "callcentermanager", "call center manager", "call centre manager"]);
const ROLE_ID_ALIASES = {
  "1": "admin",
  "10": "volunteer",
  "11": "staff",
};

const STATUS_META = {
  present:  { label: "Present",  dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, value: 1 },
  absent:   { label: "Absent",   dot: "bg-rose-500",    chip: "bg-rose-50 text-rose-700 border-rose-200",          icon: XCircle,      value: 0 },
  leave:    { label: "Leave (Standard)", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertCircle, value: 0 },
  "leave (standard)": { label: "Leave (Standard)", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertCircle, value: 0 },
  "leave (medical)": { label: "Leave (Medical)", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 border-rose-200", icon: AlertCircle, value: 0 },
  "leave (casual)": { label: "Leave (Casual)", dot: "bg-orange-500", chip: "bg-orange-50 text-orange-700 border-orange-200", icon: AlertCircle, value: 0 },
  "half-day":{ label: "Half-day",dot: "bg-sky-500",     chip: "bg-sky-50 text-sky-700 border-sky-200",              icon: Clock,        value: 0.5 },
  wfh:      { label: "WFH",      dot: "bg-violet-500",  chip: "bg-violet-50 text-violet-700 border-violet-200",     icon: Home,         value: 1 },
  weekend:  { label: "Weekly off", dot: "bg-slate-400", chip: "bg-slate-50 text-slate-700 border-slate-200", icon: Calendar, value: 0 },
};
const statusMeta = (s) => STATUS_META[(s || "").toLowerCase()] || STATUS_META.absent;

const defaultSheet = {
  id: null, userId: "", date: dayjs().format("YYYY-MM-DD"),
  hours: 0, task: "", notes: "",
};
const defaultAttendance = {
  id: null, userId: "", date: dayjs().format("YYYY-MM-DD"), status: "Present",
};

function normalizeStaffList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((u) => {
    const id = u.id ?? u.Id ?? u.userId ?? u.UserId ?? u.userID ?? u.memberId ?? u.guid;
    const displayName =
      u.name ?? u.Name ?? u.fullName ?? u.FullName ??
      u.displayName ?? u.DisplayName ??
      u.email ?? u.Email ?? u.username ?? u.UserName ?? u.userName ?? "Staff";
    if (!id) return null;
    return { ...u, id, displayName };
  }).filter(Boolean);
}

function arrayFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function shortUserId(id) {
  if (!id) return "—";
  return id.length <= 8 ? id : id.slice(0, 8) + "…";
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = Object.keys(rows[0]);
  const csv =
    headers.join(",") + "\n" +
    rows.map((r) => headers.map((h) => escape(r[h])).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isPayrollEnabledUser(u) {
  return Boolean(
    u?.payrollEnabled ??
    u?.PayrollEnabled ??
    u?.enabledPayroll ??
    u?.EnabledPayroll ??
    u?.isPayrollEnabled ??
    u?.IsPayrollEnabled
  );
}

function roleName(role) {
  const value = String(
    typeof role === "string"
      ? role
      : role?.name || role?.roleName || role?.RoleName || role?.role || role?.Role || role?.id || ""
  ).trim().toLowerCase();
  return ROLE_ID_ALIASES[value] || value;
}

function userRoles(user) {
  if (!user) return [];
  const direct = [
    user.role,
    user.Role,
    user.roleName,
    user.RoleName,
    user.role_name,
    user.roleId,
    user.RoleId,
  ];
  const nested = Array.isArray(user.roles) ? user.roles : [];
  return [...direct, ...nested].map(roleName).filter(Boolean);
}

function hasAssignableTimesheetRole(user) {
  const roles = userRoles(user);
  if (roles.length === 0) return false;
  return roles.some((role) => ASSIGNABLE_ROLE_NAMES.has(role));
}

function buildWeekDates(anchor) {
  const start = dayjs(anchor).startOf("week");
  return Array.from({ length: 7 }, (_, i) => start.add(i, "day"));
}

/* =========================================================================
 *  Toasts
 * ====================================================================== */
function useToasts() {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((msg, kind = "info", ttl = 3000) => {
    const id = ++idRef.current;
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), ttl);
  }, []);
  const dismiss = (id) => setItems((s) => s.filter((t) => t.id !== id));
  return { items, push, dismiss };
}

function Toasts({ items, onDismiss }) {
  return (
    <div className="fixed top-20 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto min-w-[260px] max-w-sm rounded-2xl shadow-xl border px-4 py-3 flex items-start gap-2.5 backdrop-blur bg-white/95 ${
            t.kind === "error" ? "border-rose-200"
            : t.kind === "success" ? "border-emerald-200"
            : "border-slate-200"
          }`}
        >
          {t.kind === "error" ? <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
            : t.kind === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
            : <Sparkles className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />}
          <div className="flex-1 text-sm text-slate-800">{t.msg}</div>
          <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
 *  Modal
 * ====================================================================== */
function Modal({ open, onClose, title, children, footer, size = "md" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const maxW = size === "lg" ? "max-w-2xl" : size === "sm" ? "max-w-sm" : "max-w-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-2 sm:px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div className={`relative w-full ${maxW} bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">{footer}</div>}
      </div>
    </div>
  );
}

/* =========================================================================
 *  Main page
 * ====================================================================== */
export default function TimesheetPage() {
  const [user, setUser] = useState(() => getCurrentUserFallback());

  /* ---- core data ---- */
  const [staff, setStaff] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ---- filters ---- */
  const [query, setQuery] = useState({
    from: dayjs().startOf("month").format("YYYY-MM-DD"),
    to:   dayjs().endOf("month").format("YYYY-MM-DD"),
    userId: "",
  });
  const [activeRange, setActiveRange] = useState("month");

  /* ---- UI state ---- */
  const [tab, setTab] = useState("overview"); // overview | timesheet | attendance
  const [viewMode, setViewMode] = useState("grid"); // grid | list
  const [weekAnchor, setWeekAnchor] = useState(dayjs().format("YYYY-MM-DD"));

  /* ---- modals ---- */
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [showAttModal, setShowAttModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [sheetDraft, setSheetDraft] = useState(defaultSheet);
  const [attDraft, setAttDraft] = useState(defaultAttendance);
  const [saving, setSaving] = useState(false);

  /* ---- toasts ---- */
  const toast = useToasts();

  /* ---- permissions ---- */
  useEffect(() => {
    let mounted = true;
    Promise.resolve(getCurrentUser())
      .then((resolved) => {
        if (mounted && resolved) setUser(resolved);
      })
      .catch(() => {
        const fallback = getCurrentUserFallback();
        if (mounted && fallback) setUser(fallback);
      });
    return () => { mounted = false; };
  }, []);

  const currentUserId = user?.id || user?.Id || user?.userId || user?.UserId || user?._id || user?.userID || "";
  const currentUserName =
    user?.displayName || user?.DisplayName || user?.name || user?.Name || user?.fullName || user?.FullName || user?.email || user?.Email || user?.username || user?.UserName || "Me";

  const allRoles = userRoles(user);
  const isAdminRole = allRoles.includes("admin") || allRoles.includes("administrator");
  const isFinanceRole = allRoles.includes("finance");
  const isStaffRoleSelf = allRoles.includes("staff") || allRoles.some((r) => ["callcentermanager", "call center manager", "call centre manager"].includes(r));
  const isAdmin = isAdminRole || isFinanceRole;
  const roleAllows = isAdmin || isStaffRoleSelf;
  const canSee = !!user && roleAllows;

  /* ---- lock non-admins to themselves ---- */
  useEffect(() => {
    if (!currentUserId || isAdmin) return;
    setQuery((q) => (q.userId ? q : { ...q, userId: currentUserId }));
    setSheetDraft((s) => (s.userId ? s : { ...s, userId: currentUserId }));
    setAttDraft((s) => (s.userId ? s : { ...s, userId: currentUserId }));
  }, [currentUserId, isAdmin]);

  /* ---- staff list (admin loads all, staff sees only self) ---- */
  useEffect(() => {
    if (!canSee) { setLoading(false); return; }
    let mounted = true;
    (async () => {
      try {
        if (isAdmin) {
          let list = [];
          let lastError = null;

          try {
            const res = await api.get("/users", { params: { page: 1, limit: 5000 } });
            list = arrayFrom(res.data).filter(hasAssignableTimesheetRole);
          } catch (err) {
            lastError = err;
          }

          if (list.length === 0) {
            try {
              const res = await api.get("/chats/contacts", { params: { page: 1, limit: 1000 } });
              list = arrayFrom(res.data).filter(hasAssignableTimesheetRole);
            } catch (err) {
              lastError = err;
            }
          }

          if (list.length === 0 && lastError) throw lastError;
          if (mounted) setStaff(normalizeStaffList(list));
        } else if (currentUserId) {
          setStaff([{ id: currentUserId, displayName: currentUserName, role: "staff" }]);
        }
      } catch (e) {
        toast.push(e?.response?.data?.message || e.message || "Failed to load staff", "error");
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee, isAdmin, currentUserId, currentUserName]);

  /* ---- fetch data ---- */
  const fetchData = useCallback(async () => {
    if (!canSee) return;
    setLoading(true);
    try {
      const [tsResult, attResult] = await Promise.allSettled([
        api.get("/timesheets", { params: query }),
        api.get("/attendance", { params: query }),
      ]);

      const ts = tsResult.status === "fulfilled" ? arrayFrom(tsResult.value.data) : [];
      const att = attResult.status === "fulfilled" ? arrayFrom(attResult.value.data) : [];

      if (tsResult.status === "rejected" || attResult.status === "rejected") {
        const failed = tsResult.status === "rejected" ? tsResult.reason : attResult.reason;
        toast.push(failed?.response?.data?.message || failed?.message || "Some attendance data could not be loaded", "error");
      }

      setTimesheets(ts);
      setAttendance(att);

      // resolve unknown user ids for admins
      if (isAdmin && (ts.length || att.length)) {
        const known = new Set(staff.map((u) => u.id));
        const unknown = new Set();
        ts.forEach((r) => r.userId && !known.has(r.userId) && unknown.add(r.userId));
        att.forEach((r) => r.userId && !known.has(r.userId) && unknown.add(r.userId));
        if (unknown.size) {
          const looked = await Promise.all(
            [...unknown].map((id) =>
              api.get(`/users/${id}`).then((r) => ({ id, u: r.data })).catch(() => null)
            )
          );
          const extras = looked.filter(Boolean).map(({ id, u }) => ({
            id, role: "staff",
            displayName: u.name || u.fullName || u.displayName || u.email || shortUserId(id),
          }));
          if (extras.length) {
            setStaff((prev) => {
              const seen = new Set(prev.map((p) => p.id));
              return [...prev, ...extras.filter((e) => !seen.has(e.id))];
            });
          }
        }
      }
    } catch (e) {
      toast.push(e?.response?.data?.message || e.message || "Failed to load data", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, canSee, isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* =====================================================================
   *  Derived data
   * ================================================================== */
  const staffById = useMemo(() => {
    const map = new Map();
    staff.forEach((u) => map.set(u.id, u));
    if (currentUserId && !map.has(currentUserId)) {
      map.set(currentUserId, { id: currentUserId, displayName: currentUserName, role: "staff" });
    }
    return map;
  }, [staff, currentUserId, currentUserName]);

  const selectableStaff = useMemo(
    () => staff,
    [staff]
  );

  const nameFor = useCallback((uid) => {
    const u = staffById.get(uid);
    if (u) return u.displayName || u.name || u.fullName || u.email || shortUserId(uid);
    if (uid === currentUserId) return currentUserName;
    return shortUserId(uid);
  }, [staffById, currentUserId, currentUserName]);

  /* ---- KPIs ---- */
  const stats = useMemo(() => {
    const totalHours = timesheets.reduce((s, t) => s + (Number(t.hours) || 0), 0);
    const presentCount = attendance.filter((a) => (a.status || "").toLowerCase() === "present").length;
    const absentCount  = attendance.filter((a) => (a.status || "").toLowerCase() === "absent").length;
    const wfhCount     = attendance.filter((a) => (a.status || "").toLowerCase() === "wfh").length;
    const countStatus = (status) => attendance.filter((a) => (a.status || "").toLowerCase() === status).length;
    const standardLeaveCount = attendance.filter((a) => ["leave", "leave (standard)"].includes((a.status || "").toLowerCase())).length;
    const medicalLeaveCount = countStatus("leave (medical)");
    const casualLeaveCount = countStatus("leave (casual)");
    const leaveCount = standardLeaveCount + medicalLeaveCount + casualLeaveCount;
    const weekendCount = countStatus("weekend");
    const totalDays = attendance.length;
    const scheduledMarkedDays = Math.max(0, totalDays - weekendCount);
    const attendanceRate = scheduledMarkedDays > 0
      ? Math.round(((presentCount + wfhCount) / scheduledMarkedDays) * 100)
      : 0;
    const uniqueDays = new Set(timesheets.map((t) => dayjs(t.date).format("YYYY-MM-DD"))).size;
    const avgHours = uniqueDays > 0 ? (totalHours / uniqueDays).toFixed(1) : "0.0";
    return { totalHours, presentCount, absentCount, leaveCount, standardLeaveCount, medicalLeaveCount, casualLeaveCount, weekendCount, wfhCount, totalDays, attendanceRate, avgHours };
  }, [timesheets, attendance]);

  /* ---- per-staff summary (admin) ---- */
  const perStaff = useMemo(() => {
    const buckets = new Map();
    const ensure = (uid) => {
      if (!buckets.has(uid)) buckets.set(uid, {
        userId: uid, name: nameFor(uid),
        hours: 0, present: 0, absent: 0, leave: 0, halfDay: 0, wfh: 0, total: 0,
      });
      return buckets.get(uid);
    };
    timesheets.forEach((t) => {
      const b = ensure(t.userId);
      b.hours += Number(t.hours) || 0;
    });
    attendance.forEach((a) => {
      const b = ensure(a.userId);
      const s = (a.status || "").toLowerCase();
      if (s === "present")  b.present++;
      else if (s === "absent") b.absent++;
      else if (s === "leave" || s.startsWith("leave (")) b.leave++;
      else if (s === "half-day") b.halfDay++;
      else if (s === "wfh")    b.wfh++;
      b.total++;
    });
    return [...buckets.values()].sort((a, b) => b.hours - a.hours);
  }, [timesheets, attendance, nameFor]);

  /* ---- week grid data ---- */
  const weekDates = useMemo(() => buildWeekDates(weekAnchor), [weekAnchor]);
  const weekStaff = useMemo(() => {
    if (!isAdmin) {
      return [{ id: currentUserId, displayName: currentUserName }];
    }
    // show only staff who have any activity in this week, or the whole list if filter selected
    if (query.userId) {
      const u = staffById.get(query.userId);
      return u ? [u] : [];
    }
    const start = weekDates[0].format("YYYY-MM-DD");
    const end   = weekDates[6].format("YYYY-MM-DD");
    const activeIds = new Set();
    timesheets.forEach((t) => {
      const d = dayjs(t.date).format("YYYY-MM-DD");
      if (d >= start && d <= end) activeIds.add(t.userId);
    });
    attendance.forEach((a) => {
      const d = dayjs(a.date).format("YYYY-MM-DD");
      if (d >= start && d <= end) activeIds.add(a.userId);
    });
    const active = [...activeIds].map((id) => staffById.get(id) || { id, displayName: nameFor(id) });
    return active.length ? active : selectableStaff.slice(0, 8);
  }, [isAdmin, currentUserId, currentUserName, query.userId, weekDates, timesheets, attendance, staffById, selectableStaff, nameFor]);

  const cellForTs = (uid, day) => {
    const ds = day.format("YYYY-MM-DD");
    const rows = timesheets.filter((t) => t.userId === uid && dayjs(t.date).format("YYYY-MM-DD") === ds);
    return { hours: rows.reduce((s, r) => s + (Number(r.hours) || 0), 0), entries: rows };
  };
  const cellForAtt = (uid, day) => {
    const ds = day.format("YYYY-MM-DD");
    return attendance.find((a) => a.userId === uid && dayjs(a.date).format("YYYY-MM-DD") === ds) || null;
  };

  /* =====================================================================
   *  Actions
   * ================================================================== */
  function setRange(range) {
    setActiveRange(range);
    if (range === "today") {
      const d = dayjs().format("YYYY-MM-DD");
      setQuery((q) => ({ ...q, from: d, to: d }));
    } else if (range === "week") {
      setQuery((q) => ({
        ...q,
        from: dayjs().startOf("week").format("YYYY-MM-DD"),
        to:   dayjs().endOf("week").format("YYYY-MM-DD"),
      }));
      setWeekAnchor(dayjs().format("YYYY-MM-DD"));
    } else {
      setQuery((q) => ({
        ...q,
        from: dayjs().startOf("month").format("YYYY-MM-DD"),
        to:   dayjs().endOf("month").format("YYYY-MM-DD"),
      }));
    }
  }

  function openSheetModal(initial = null) {
    setSheetDraft(initial ? { ...initial, date: dayjs(initial.date).format("YYYY-MM-DD") } : {
      ...defaultSheet,
      date: dayjs().format("YYYY-MM-DD"),
      userId: isAdmin ? "" : currentUserId,
    });
    setShowSheetModal(true);
  }
  function openAttModal(initial = null) {
    setAttDraft(initial ? { ...initial, date: dayjs(initial.date).format("YYYY-MM-DD") } : {
      ...defaultAttendance,
      date: dayjs().format("YYYY-MM-DD"),
      userId: isAdmin ? "" : currentUserId,
    });
    setShowAttModal(true);
  }

  async function saveTimesheet() {
    if (!isAdmin && sheetDraft.userId && sheetDraft.userId !== currentUserId) {
      toast.push("You can only update your own timesheet.", "error");
      return;
    }
    if (!sheetDraft.userId)          { toast.push("Pick a staff member.", "error"); return; }
    if (!Number(sheetDraft.hours))   { toast.push("Hours must be greater than zero.", "error"); return; }
    if (Number(sheetDraft.hours) > 24){ toast.push("Hours can't exceed 24 in a day.", "error"); return; }
    setSaving(true);
    try {
      const payload = { ...sheetDraft, hours: Number(sheetDraft.hours) || 0 };
      const isEdit = !!payload.id;
      if (!isEdit) delete payload.id;
      if (payload.task && payload.model == null) payload.model = payload.task;
      const url = isEdit ? `/timesheets/${payload.id}` : "/timesheets";
      const method = isEdit ? "put" : "post";
      await api[method](url, payload);
      toast.push(isEdit ? "Timesheet updated." : "Timesheet saved.", "success");
      setShowSheetModal(false);
      fetchData();
    } catch (e) {
      toast.push(e?.response?.data?.message || e.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveAttendance() {
    if (!isAdmin && attDraft.userId && attDraft.userId !== currentUserId) {
      toast.push("You can only update your own attendance.", "error");
      return;
    }
    if (!attDraft.userId) { toast.push("Pick a staff member.", "error"); return; }
    setSaving(true);
    try {
      const payload = { ...attDraft };
      const isEdit = !!payload.id;
      if (!isEdit) delete payload.id;
      const url = isEdit ? `/attendance/${payload.id}` : "/attendance";
      const method = isEdit ? "put" : "post";
      await api[method](url, payload);
      toast.push(isEdit ? "Attendance updated." : "Attendance saved.", "success");
      setShowAttModal(false);
      fetchData();
    } catch (e) {
      toast.push(e?.response?.data?.message || e.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTimesheet(id) {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await api.delete(`/timesheets/${id}`);
      toast.push("Deleted.", "success");
      fetchData();
    } catch (e) {
      toast.push(e?.response?.data?.message || e.message || "Delete failed", "error");
    }
  }
  async function deleteAttendance(id) {
    if (!window.confirm("Delete this mark?")) return;
    try {
      await api.delete(`/attendance/${id}`);
      toast.push("Deleted.", "success");
      fetchData();
    } catch (e) {
      toast.push(e?.response?.data?.message || e.message || "Delete failed", "error");
    }
  }

  /* ---- quick actions ---- */
  async function quickMarkPresent() {
    setSaving(true);
    try {
      await api.post("/attendance", {
        userId: currentUserId,
        date: dayjs().format("YYYY-MM-DD"),
        status: "Present",
      });
      toast.push("Marked as present today. 👍", "success");
      fetchData();
    } catch (e) {
      toast.push(e?.response?.data?.message || e.message || "Couldn't mark", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ---- CSV exports ---- */
  function exportTimesheetCsv() {
    const rows = timesheets.map((t) => ({
      Date: dayjs(t.date).format("YYYY-MM-DD"),
      Staff: nameFor(t.userId),
      Hours: t.hours,
      Task: t.task || "",
      Notes: t.notes || "",
    }));
    if (!rows.length) { toast.push("Nothing to export.", "info"); return; }
    downloadCsv(`timesheets_${query.from}_to_${query.to}.csv`, rows);
  }
  function exportAttendanceCsv() {
    const rows = attendance.map((a) => ({
      Date: dayjs(a.date).format("YYYY-MM-DD"),
      Staff: nameFor(a.userId),
      Status: a.status || "",
    }));
    if (!rows.length) { toast.push("Nothing to export.", "info"); return; }
    downloadCsv(`attendance_${query.from}_to_${query.to}.csv`, rows);
  }

  /* =====================================================================
   *  Access gate
   * ================================================================== */
  if (!canSee) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 via-white to-indigo-50 px-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-6 text-center space-y-3 border border-slate-200">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Access restricted</h1>
          <p className="text-sm text-slate-500">
            Only users with the <span className="font-semibold">Admin</span>,{" "}
            <span className="font-semibold">Finance</span>, or{" "}
            <span className="font-semibold">Staff</span> role can view this page.
          </p>
        </div>
      </div>
    );
  }

  /* =====================================================================
   *  UI
   * ================================================================== */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-indigo-50/40">
      <Toasts items={toast.items} onDismiss={toast.dismiss} />

      <div className="max-w-7xl mx-auto px-3 sm:px-5 py-6 space-y-5 pb-24">
        {/* =================== HERO =================== */}
        <Hero
          totalHours={stats.totalHours}
          presentCount={stats.presentCount}
          attendanceRate={stats.attendanceRate}
          range={query}
          activeRange={activeRange}
          onRangeChange={setRange}
        />

        {/* =================== TOOLBAR =================== */}
        <Toolbar
          query={query} setQuery={setQuery}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          selectableStaff={selectableStaff}
          activeRange={activeRange} setActiveRange={setActiveRange}
          onResetFilters={() => {
            setActiveRange("month");
            setQuery({
              from: dayjs().startOf("month").format("YYYY-MM-DD"),
              to:   dayjs().endOf("month").format("YYYY-MM-DD"),
              userId: isAdmin ? "" : currentUserId,
            });
            setWeekAnchor(dayjs().format("YYYY-MM-DD"));
          }}
        />

        {/* =================== TABS =================== */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-1 px-2 sm:px-3 py-2 border-b border-slate-100 overflow-x-auto">
            {[
              { id: "overview",   label: "Overview",   icon: TrendingUp },
              { id: "timesheet",  label: "Timesheet",  icon: Clock },
              { id: "attendance", label: "Attendance", icon: CalendarCheck },
            ].map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition shrink-0 ${
                    active
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}

            <div className="flex-1" />

            {/* Quick CTAs */}
            {tab !== "overview" && (
              <div className="flex items-center gap-1.5 shrink-0">
                {/* View toggle */}
                <div className="hidden sm:inline-flex border border-slate-200 rounded-full p-0.5 bg-slate-50 mr-2">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${
                      viewMode === "grid" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" /> Grid
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${
                      viewMode === "list" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
                    }`}
                  >
                    <ListIcon className="w-3.5 h-3.5" /> List
                  </button>
                </div>

                {tab === "timesheet" && (
                  <>
                    <button
                      onClick={exportTimesheetCsv}
                      className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      title="Export to CSV"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                    <button
                      onClick={() => openSheetModal()}
                      className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" /> Log time
                    </button>
                  </>
                )}

                {tab === "attendance" && (
                  <>
                    <button
                      onClick={exportAttendanceCsv}
                      className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      title="Export to CSV"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                    {!isAdmin && (
                      <button
                        onClick={quickMarkPresent}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm disabled:opacity-50"
                        title="Mark me present today"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> I'm present
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setShowBulkModal(true)}
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 px-3 py-1.5 text-xs font-semibold hover:bg-violet-100"
                        title="Mark multiple staff for a single date"
                      >
                        <UsersIcon className="w-3.5 h-3.5" /> Bulk mark
                      </button>
                    )}
                    <button
                      onClick={() => openAttModal()}
                      className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" /> Mark
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Tab body */}
          <div className="p-3 sm:p-5">
            {tab === "overview" && (
              <OverviewTab
                stats={stats}
                perStaff={perStaff}
                isAdmin={isAdmin}
                loading={loading}
              />
            )}
            {tab === "timesheet" && (
              <TimesheetTab
                viewMode={viewMode}
                weekDates={weekDates}
                weekStaff={weekStaff}
                weekAnchor={weekAnchor}
                setWeekAnchor={setWeekAnchor}
                cellForTs={cellForTs}
                timesheets={timesheets}
                nameFor={nameFor}
                loading={loading}
                onEdit={(row) => openSheetModal(row)}
                onDelete={deleteTimesheet}
                onCellClick={(uid, day, existing) => openSheetModal(
                  existing[0]
                    ? { ...existing[0], date: day.format("YYYY-MM-DD") }
                    : { ...defaultSheet, userId: uid, date: day.format("YYYY-MM-DD"), hours: 8 }
                )}
              />
            )}
            {tab === "attendance" && (
              <AttendanceTab
                viewMode={viewMode}
                weekDates={weekDates}
                weekStaff={weekStaff}
                weekAnchor={weekAnchor}
                setWeekAnchor={setWeekAnchor}
                cellForAtt={cellForAtt}
                attendance={attendance}
                nameFor={nameFor}
                loading={loading}
                onEdit={(row) => openAttModal(row)}
                onDelete={deleteAttendance}
                onCellClick={(uid, day, existing) => openAttModal(
                  existing
                    ? existing
                    : { ...defaultAttendance, userId: uid, date: day.format("YYYY-MM-DD") }
                )}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <SheetModal
        open={showSheetModal} onClose={() => setShowSheetModal(false)}
        draft={sheetDraft} setDraft={setSheetDraft}
        staff={selectableStaff} isAdmin={isAdmin}
        onSave={saveTimesheet} saving={saving}
      />
      <AttModal
        open={showAttModal} onClose={() => setShowAttModal(false)}
        draft={attDraft} setDraft={setAttDraft}
        staff={selectableStaff} isAdmin={isAdmin}
        onSave={saveAttendance} saving={saving}
      />
      <BulkAttendanceModal
        open={showBulkModal} onClose={() => setShowBulkModal(false)}
        staff={selectableStaff}
        onDone={() => { setShowBulkModal(false); fetchData(); }}
        toast={toast}
      />
    </div>
  );
}

/* =========================================================================
 *  Sub-components
 * ====================================================================== */

function Hero({ totalHours, presentCount, attendanceRate, range, activeRange, onRangeChange }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-xl">
      <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-fuchsia-300/20 blur-3xl" />
      <div className="relative p-5 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
              <ClipboardList className="h-3.5 w-3.5" /> Staff tracking
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">
              Timesheets &amp; Attendance
            </h1>
            <p className="mt-1 text-sm text-indigo-100">
              Log hours, mark presence, and see your team at a glance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HeroStat icon={Clock}         label="Hours"      value={`${totalHours}`} />
            <HeroStat icon={CheckCircle2}  label="Present"    value={presentCount} />
            <HeroStat icon={TrendingUp}    label="Attendance" value={`${attendanceRate}%`} />
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-indigo-100/90 inline-flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {dayjs(range.from).format("DD MMM YYYY")} — {dayjs(range.to).format("DD MMM YYYY")}
          </div>
          <div className="flex gap-1.5">
            {[
              { id: "today", label: "Today" },
              { id: "week",  label: "This week" },
              { id: "month", label: "This month" },
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => onRangeChange(r.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  activeRange === r.id
                    ? "bg-white text-indigo-700 border-white shadow-sm"
                    : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl bg-white/15 backdrop-blur border border-white/10 px-3 py-2 min-w-[88px]">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-indigo-100">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Toolbar({ query, setQuery, isAdmin, currentUserId, selectableStaff, onResetFilters }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">From</label>
            <input
              type="date"
              value={dayjs(query.from).format("YYYY-MM-DD")}
              onChange={(e) => setQuery((q) => ({ ...q, from: e.target.value || q.from }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To</label>
            <input
              type="date"
              value={dayjs(query.to).format("YYYY-MM-DD")}
              onChange={(e) => setQuery((q) => ({ ...q, to: e.target.value || q.to }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Staff</label>
            <select
              value={query.userId}
              onChange={(e) => setQuery((q) => ({ ...q, userId: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              disabled={!isAdmin}
            >
              {isAdmin && <option value="">All staff</option>}
              {selectableStaff.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
              ))}
              {!isAdmin && selectableStaff.length === 0 && currentUserId && (
                <option value={currentUserId}>Me</option>
              )}
            </select>
          </div>
        </div>

        <button
          onClick={onResetFilters}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:self-end"
        >
          <Filter className="w-3.5 h-3.5" /> Reset
        </button>
      </div>
    </section>
  );
}

function StatCard({ icon: Icon, label, value, hint, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">{label}</div>
        </div>
      </div>
      {hint && <div className="mt-2 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function OverviewTab({ stats, perStaff, isAdmin, loading }) {
  const [sortKey, setSortKey] = useState("hours");
  const [sortDir, setSortDir] = useState("desc");
  const sorted = useMemo(() => {
    const arr = [...perStaff];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av - bv) : (bv - av);
    });
    return arr;
  }, [perStaff, sortKey, sortDir]);

  function setSort(k) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  }
  function sortArrow(k) { return sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""; }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Clock}         label="Total hours"   value={stats.totalHours}   accent="bg-indigo-50 text-indigo-600" />
        <StatCard icon={CheckCircle2}  label="Days present"  value={stats.presentCount} accent="bg-emerald-50 text-emerald-600" />
        <StatCard icon={TrendingUp}    label="Attendance %"  value={`${stats.attendanceRate}%`} accent="bg-violet-50 text-violet-600" hint={`${stats.totalDays} marked`} />
        <StatCard icon={Sparkles}      label="Avg hrs/day"   value={stats.avgHours}     accent="bg-amber-50 text-amber-600" />
      </div>

      {/* Status breakdown */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Status breakdown</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label: "Present", value: stats.presentCount, bg: "bg-emerald-50/60 border-emerald-100", title: "text-emerald-700", num: "text-emerald-900" },
            { label: "Absent",  value: stats.absentCount,  bg: "bg-rose-50/60 border-rose-100",       title: "text-rose-700",    num: "text-rose-900" },
            { label: "Standard leave", value: stats.standardLeaveCount, bg: "bg-amber-50/60 border-amber-100", title: "text-amber-700", num: "text-amber-900" },
            { label: "Medical leave", value: stats.medicalLeaveCount, bg: "bg-rose-50/60 border-rose-100", title: "text-rose-700", num: "text-rose-900" },
            { label: "Casual leave", value: stats.casualLeaveCount, bg: "bg-orange-50/60 border-orange-100", title: "text-orange-700", num: "text-orange-900" },
            { label: "Weekly off", value: stats.weekendCount, bg: "bg-slate-50/60 border-slate-200", title: "text-slate-600", num: "text-slate-800" },
            { label: "WFH",     value: stats.wfhCount,     bg: "bg-violet-50/60 border-violet-100",   title: "text-violet-700",  num: "text-violet-900" },
            { label: "Total",   value: stats.totalDays,    bg: "bg-slate-50/60 border-slate-100",     title: "text-slate-700",   num: "text-slate-900" },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border ${s.bg} p-3`}>
              <div className={`text-[11px] uppercase tracking-wider ${s.title} font-semibold`}>{s.label}</div>
              <div className={`text-xl font-bold ${s.num} tabular-nums`}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-staff table (admin) */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <UsersIcon className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Per-staff summary</h3>
            </div>
            <span className="text-[11px] text-slate-500">{sorted.length} {sorted.length === 1 ? "person" : "people"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="text-left">
                  <Th onClick={() => setSort("name")}>Staff {sortArrow("name")}</Th>
                  <Th onClick={() => setSort("hours")} num>Hours {sortArrow("hours")}</Th>
                  <Th onClick={() => setSort("present")} num>Present {sortArrow("present")}</Th>
                  <Th onClick={() => setSort("absent")} num>Absent {sortArrow("absent")}</Th>
                  <Th onClick={() => setSort("leave")} num>Leave {sortArrow("leave")}</Th>
                  <Th onClick={() => setSort("halfDay")} num>Half-day {sortArrow("halfDay")}</Th>
                  <Th onClick={() => setSort("wfh")} num>WFH {sortArrow("wfh")}</Th>
                  <Th onClick={() => setSort("total")} num>Total {sortArrow("total")}</Th>
                </tr>
              </thead>
              <tbody>
                {loading && sorted.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-1.5" /> Loading…
                  </td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No activity in this range.
                  </td></tr>
                )}
                {sorted.map((r) => (
                  <tr key={r.userId} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-xs font-bold flex items-center justify-center">
                          {(r.name || "?").charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-800 truncate max-w-[200px]">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{r.hours}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{r.present}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">{r.absent}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{r.leave}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sky-700">{r.halfDay}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-violet-700">{r.wfh}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 font-medium">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, onClick, num }) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none ${
        num ? "text-right" : "text-left"
      } hover:text-slate-900`}
    >
      {children}
    </th>
  );
}

function WeekNav({ weekAnchor, setWeekAnchor, weekDates }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setWeekAnchor(dayjs(weekAnchor).subtract(1, "week").format("YYYY-MM-DD"))}
          className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600"
          title="Previous week"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => setWeekAnchor(dayjs().format("YYYY-MM-DD"))}
          className="px-3 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Today
        </button>
        <button
          onClick={() => setWeekAnchor(dayjs(weekAnchor).add(1, "week").format("YYYY-MM-DD"))}
          className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600"
          title="Next week"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="text-sm font-semibold text-slate-700">
        {weekDates[0].format("DD MMM")} – {weekDates[6].format("DD MMM YYYY")}
      </div>
    </div>
  );
}

function TimesheetTab({
  viewMode, weekDates, weekStaff, weekAnchor, setWeekAnchor,
  cellForTs, timesheets, nameFor, loading, onEdit, onDelete, onCellClick,
}) {
  if (viewMode === "grid") {
    return (
      <div>
        <WeekNav weekAnchor={weekAnchor} setWeekAnchor={setWeekAnchor} weekDates={weekDates} />
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold sticky left-0 bg-slate-50 z-10 min-w-[160px]">
                  Staff
                </th>
                {weekDates.map((d) => {
                  const isToday = d.isSame(dayjs(), "day");
                  return (
                    <th
                      key={d.format("YYYY-MM-DD")}
                      className={`px-3 py-2 text-center text-[11px] uppercase tracking-wider font-semibold min-w-[80px] ${
                        isToday ? "text-indigo-700 bg-indigo-50/60" : "text-slate-500"
                      }`}
                    >
                      <div>{d.format("ddd")}</div>
                      <div className={`text-base font-bold ${isToday ? "text-indigo-700" : "text-slate-700"}`}>
                        {d.format("DD")}
                      </div>
                    </th>
                  );
                })}
                <th className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {weekStaff.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin inline-block mr-1.5" />Loading…</> : "No staff to show."}
                </td></tr>
              )}
              {weekStaff.map((u) => {
                let weekTotal = 0;
                return (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                          {(u.displayName || u.name || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="text-sm font-medium text-slate-800 truncate max-w-[140px]">
                          {u.displayName || u.name}
                        </div>
                      </div>
                    </td>
                    {weekDates.map((d) => {
                      const { hours, entries } = cellForTs(u.id, d);
                      weekTotal += hours;
                      const isToday = d.isSame(dayjs(), "day");
                      return (
                        <td
                          key={d.format("YYYY-MM-DD")}
                          className={`px-2 py-2 text-center align-middle border-l border-slate-50 ${
                            isToday ? "bg-indigo-50/40" : ""
                          }`}
                        >
                          <button
                            onClick={() => onCellClick(u.id, d, entries)}
                            className={`w-full min-h-[44px] rounded-xl text-xs font-semibold transition flex items-center justify-center border ${
                              hours > 0
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                                : "bg-slate-50 border-dashed border-slate-200 text-slate-400 hover:bg-white hover:border-slate-300"
                            }`}
                            title={hours > 0 ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` : "Add"}
                          >
                            {hours > 0 ? `${hours}h` : <Plus className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                      {weekTotal}h
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // list view
  return (
    <div className="space-y-2">
      {loading && timesheets.length === 0 && (
        <SkeletonRows />
      )}
      {!loading && timesheets.length === 0 && (
        <EmptyState
          icon={Clock}
          title="No timesheet entries"
          subtitle="Use 'Log time' or click a day in the Grid view to add one."
        />
      )}
      {timesheets.map((row) => (
        <article key={row.id} className="rounded-2xl border border-slate-200 bg-white hover:shadow-sm transition px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
              {(nameFor(row.userId) || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900 truncate">{nameFor(row.userId)}</div>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 text-white px-2.5 py-1 text-[11px] font-semibold tabular-nums shrink-0">
                  <Clock className="w-3 h-3" /> {row.hours}h
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                <Calendar className="w-3 h-3" /> {dayjs(row.date).format("ddd, DD MMM YYYY")}
                {row.task && (<><span>·</span><span className="font-medium text-slate-700 truncate">{row.task}</span></>)}
              </div>
              {row.notes && (
                <div className="mt-1 text-[12px] text-slate-600 line-clamp-2">{row.notes}</div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button onClick={() => onEdit(row)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                  <Edit3 className="w-3 h-3" /> Edit
                </button>
                <button onClick={() => onDelete(row.id)} className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-100">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function AttendanceTab({
  viewMode, weekDates, weekStaff, weekAnchor, setWeekAnchor,
  cellForAtt, attendance, nameFor, loading, onEdit, onDelete, onCellClick,
}) {
  if (viewMode === "grid") {
    return (
      <div>
        <WeekNav weekAnchor={weekAnchor} setWeekAnchor={setWeekAnchor} weekDates={weekDates} />
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold sticky left-0 bg-slate-50 z-10 min-w-[160px]">Staff</th>
                {weekDates.map((d) => {
                  const isToday = d.isSame(dayjs(), "day");
                  return (
                    <th
                      key={d.format("YYYY-MM-DD")}
                      className={`px-3 py-2 text-center text-[11px] uppercase tracking-wider font-semibold min-w-[80px] ${
                        isToday ? "text-violet-700 bg-violet-50/60" : "text-slate-500"
                      }`}
                    >
                      <div>{d.format("ddd")}</div>
                      <div className={`text-base font-bold ${isToday ? "text-violet-700" : "text-slate-700"}`}>
                        {d.format("DD")}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {weekStaff.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin inline-block mr-1.5" />Loading…</> : "No staff to show."}
                </td></tr>
              )}
              {weekStaff.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 sticky left-0 bg-white z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                        {(u.displayName || u.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="text-sm font-medium text-slate-800 truncate max-w-[140px]">
                        {u.displayName || u.name}
                      </div>
                    </div>
                  </td>
                  {weekDates.map((d) => {
                    const att = cellForAtt(u.id, d);
                    const meta = att ? statusMeta(att.status) : null;
                    const isToday = d.isSame(dayjs(), "day");
                    return (
                      <td
                        key={d.format("YYYY-MM-DD")}
                        className={`px-2 py-2 text-center align-middle border-l border-slate-50 ${
                          isToday ? "bg-violet-50/40" : ""
                        }`}
                      >
                        <button
                          onClick={() => onCellClick(u.id, d, att)}
                          className={`w-full min-h-[44px] rounded-xl text-[11px] font-semibold transition flex items-center justify-center border ${
                            att
                              ? `${meta.chip} hover:brightness-95`
                              : "bg-slate-50 border-dashed border-slate-200 text-slate-400 hover:bg-white hover:border-slate-300"
                          }`}
                          title={att ? meta.label : "Mark"}
                        >
                          {att ? (
                            <span className="inline-flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </span>
                          ) : (
                            <Plus className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {loading && attendance.length === 0 && <SkeletonRows />}
      {!loading && attendance.length === 0 && (
        <EmptyState
          icon={CalendarCheck}
          title="No attendance marks"
          subtitle="Use 'Mark' or click a day in the Grid view to record one."
        />
      )}
      {attendance.map((row) => {
        const meta = statusMeta(row.status);
        const Icon = meta.icon;
        return (
          <article key={row.id} className="rounded-2xl border border-slate-200 bg-white hover:shadow-sm transition px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                {(nameFor(row.userId) || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 truncate">{nameFor(row.userId)}</div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.chip}`}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                  <Calendar className="w-3 h-3" /> {dayjs(row.date).format("ddd, DD MMM YYYY")}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => onEdit(row)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                    <Edit3 className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => onDelete(row.id)} className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-100">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-10 px-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0,1,2].map((i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-200 rounded w-1/3" />
            <div className="h-2.5 bg-slate-100 rounded w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
 *  Modals (Sheet, Att, BulkAttendance)
 * ====================================================================== */
function SheetModal({ open, onClose, draft, setDraft, staff, isAdmin, onSave, saving }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit timesheet" : "Log time"}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {draft.id ? "Update" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className={isAdmin ? "" : "opacity-60"}>
          <Label>Staff</Label>
          <select
            disabled={!isAdmin}
            value={draft.userId}
            onChange={(e) => setDraft((s) => ({ ...s, userId: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">Select staff</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Date</Label>
          <input
            type="date"
            value={dayjs(draft.date).format("YYYY-MM-DD")}
            onChange={(e) => setDraft((s) => ({ ...s, date: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <Label>Hours</Label>
          <input
            type="number" min="0" step="0.5" max="24"
            value={draft.hours}
            onChange={(e) => setDraft((s) => ({ ...s, hours: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 tabular-nums"
          />
        </div>
        <div>
          <Label>Task</Label>
          <input
            type="text"
            value={draft.task}
            onChange={(e) => setDraft((s) => ({ ...s, task: e.target.value }))}
            placeholder="What did you work on?"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Notes</Label>
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => setDraft((s) => ({ ...s, notes: e.target.value }))}
            placeholder="Any extra context"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
          />
        </div>
      </div>
    </Modal>
  );
}

function AttModal({ open, onClose, draft, setDraft, staff, isAdmin, onSave, saving }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit attendance" : "Mark attendance"}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {draft.id ? "Update" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className={isAdmin ? "" : "opacity-60"}>
          <Label>Staff</Label>
          <select
            disabled={!isAdmin}
            value={draft.userId}
            onChange={(e) => setDraft((s) => ({ ...s, userId: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value="">Select staff</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Date</Label>
          <input
            type="date"
            value={dayjs(draft.date).format("YYYY-MM-DD")}
            onChange={(e) => setDraft((s) => ({ ...s, date: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Status</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STATUSES.map((s) => {
              const m = statusMeta(s);
              const Icon = m.icon;
              const active = (draft.status || "").toLowerCase() === s.toLowerCase();
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, status: s }))}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                    active ? `${m.chip} ring-2 ring-offset-1 ring-current` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BulkAttendanceModal({ open, onClose, staff, onDone, toast }) {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [defaultStatus, setDefaultStatus] = useState("Present");
  const [selected, setSelected] = useState(() => new Set());
  const [overrides, setOverrides] = useState({}); // userId -> status
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(dayjs().format("YYYY-MM-DD"));
      setDefaultStatus("Present");
      setSelected(new Set(staff.map((u) => u.id))); // pre-select all
      setOverrides({});
      setFilter("");
    }
  }, [open, staff]);

  const filtered = useMemo(
    () => staff.filter((u) =>
      !filter ||
      (u.displayName || u.name || "").toLowerCase().includes(filter.toLowerCase())
    ),
    [staff, filter]
  );

  function toggle(uid) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((u) => u.id)));
  }

  async function save() {
    if (!selected.size) { toast.push("Pick at least one staff member.", "error"); return; }
    setBusy(true);
    const items = [...selected].map((uid) => ({
      userId: uid,
      date,
      status: overrides[uid] || defaultStatus,
    }));
    let ok = 0, fail = 0;
    for (const it of items) {
      try {
        await api.post("/attendance", it);
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    if (ok) toast.push(`Marked ${ok} staff${fail ? `, ${fail} failed` : ""}.`, fail ? "info" : "success");
    if (!ok && fail) toast.push(`All ${fail} marks failed.`, "error");
    onDone();
  }

  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title="Bulk mark attendance"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Mark {selected.size > 0 ? selected.size : ""}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Date</Label>
            <input
              type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <div>
            <Label>Default status</Label>
            <select
              value={defaultStatus}
              onChange={(e) => setDefaultStatus(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search staff..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <button
            onClick={toggleAll}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
          >
            {selected.size === filtered.length ? "Clear all" : "Select all"}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 max-h-[40vh] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No staff match.</div>
          )}
          {filtered.map((u) => {
            const checked = selected.has(u.id);
            const stat = overrides[u.id] || defaultStatus;
            const m = statusMeta(stat);
            return (
              <div key={u.id} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(u.id)}
                  className="rounded border-slate-300"
                />
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {(u.displayName || u.name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 text-sm font-medium text-slate-800 truncate">
                  {u.displayName || u.name}
                </div>
                <select
                  value={stat}
                  disabled={!checked}
                  onChange={(e) =>
                    setOverrides((o) => ({ ...o, [u.id]: e.target.value }))
                  }
                  className={`text-[11px] font-semibold rounded-full border px-2 py-1 ${m.chip} disabled:opacity-50`}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function Label({ children }) {
  return (
    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
      {children}
    </label>
  );
}
