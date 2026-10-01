// src/pages/PayrollPage.jsx
//
// Mahima Ministry — state-of-the-art Payroll module.
//
// Backend contract (unchanged):
//   GET    /api/payroll/settings
//   POST   /api/payroll/settings                  (upsert)
//   GET    /api/payroll/summary?userId&from&to
//   GET    /api/payroll/runs?userId
//   POST   /api/payroll/runs                       (snapshot)
//   DELETE /api/payroll/runs/{id}
//   GET    /api/payroll/runs/{id}/slip             (PDF blob)
//   GET    /api/payroll/slip?userId&from&to        (PDF blob)
//   GET    /api/attendance?userId&from&to
//   GET    /api/expenses?month=YYYY-MM&category=PAYROLL
//
// Calculation formula (matches backend):
//   Days         = count(attendance.status == "present")
//   HourlyAmount = Days * DailyRate
//   Gross        = Fixed + HourlyAmount + Allowances
//   Deductions   = Fines (from settings) + PayrollAdvances (from expenses)
//   Net          = max(0, Gross - Deductions)
//
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import dayjs from "dayjs";
import {
  FileText, Download, Calendar as CalendarIcon, Search,
  Loader2, History as HistoryIcon, Trash2, CheckCircle2,
  AlertCircle, X, Eye, IndianRupee, Settings as SettingsIcon,
  TrendingUp, TrendingDown, ArrowRight, Info,
  RefreshCw, Calculator, Users as UsersIcon, FileDown,
  Sparkles, Wallet, MinusCircle, PlusCircle, BadgeCheck,
  Save, ChevronRight, Building2, ClipboardList, Pencil,
} from "lucide-react";
import api from "../api";

/* ============================================================================
 *  Helpers
 * ========================================================================= */
const INITIAL_SUMMARY = {
  userId: "", displayName: "", from: "", to: "",
  totalHours: 0, hourlyRate: 0, fixedAmount: 0, hourlyAmount: 0,
  allowances: 0, deductions: 0, grossAmount: 0, netAmount: 0,
  payrollAdvance: 0, fines: 0,
  previousArrears: 0, payableAmount: 0, paidAmount: 0, balanceAmount: 0,
  paymentStatus: "UNPAID", paymentNotes: "", calculated: false,
};
const INITIAL_SETTINGS = {
  userId: "", hourlyRate: 0, monthlyFixedAmount: 0,
  allowances: 0, deductions: 0, weeklyOffDay: 0, isActive: true,
};

const RUPEE = String.fromCharCode(0x20b9);
const formatINR = (value) => {
  const num = Number(value);
  const formatted = Number.isFinite(num)
    ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)
    : "0.00";
  return `${RUPEE} ${formatted}`;
};
const formatINRCompact = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return `${RUPEE} 0`;
  return `${RUPEE} ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(num)}`;
};
const safeNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const arrayFrom = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};
const monthRange = (anchor = dayjs()) => ({
  from: anchor.startOf("month").format("YYYY-MM-DD"),
  to:   anchor.endOf("month").format("YYYY-MM-DD"),
});

const errMsg = (err, fallback = "Something went wrong.") =>
  err?.response?.data?.message ||
  (typeof err?.response?.data === "string" ? err.response.data : null) ||
  err?.message || fallback;

const readField = (obj, name, fallback = undefined) =>
  obj?.[name] ?? obj?.[name[0].toUpperCase() + name.slice(1)] ?? fallback;

const paymentStatus = (paid, balance, payable) => {
  if (payable <= 0 || balance <= 0) return "PAID";
  if (paid <= 0) return "UNPAID";
  return "PARTIAL";
};

const normalizePayrollRun = (run) => {
  if (!run) return null;
  const net = safeNum(readField(run, "netAmount"));
  const arrears = safeNum(readField(run, "previousArrears"));
  const payable = safeNum(readField(run, "payableAmount"), net + arrears) || net + arrears;
  const paid = safeNum(readField(run, "paidAmount"));
  const balance = safeNum(readField(run, "balanceAmount"), Math.max(0, payable - paid));
  return {
    ...run,
    previousArrears: arrears,
    payableAmount: payable,
    paidAmount: paid,
    balanceAmount: balance,
    paymentStatus: readField(run, "paymentStatus", paymentStatus(paid, balance, payable)),
    paymentNotes: readField(run, "paymentNotes", ""),
    paidAtUtc: readField(run, "paidAtUtc", null),
  };
};

/* role detection */
const STAFF_ROLE_FIELDS = ["role","Role","userRole","UserRole","userType","UserType","accountType","AccountType","type","Type"];
const STAFF_ROLE_LIST_FIELDS = ["roles","Roles","authorities","Authorities","permissions"];
const collectRoleStrings = (u) => {
  if (!u) return [];
  const out = [];
  for (const k of STAFF_ROLE_FIELDS) {
    const v = u[k];
    if (typeof v === "string" && v.trim()) out.push(v);
    else if (v && typeof v === "object")
      out.push(v.name || v.Name || v.role || v.Role || "");
  }
  for (const k of STAFF_ROLE_LIST_FIELDS) {
    const arr = u[k];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object")
        out.push(item.name || item.Name || item.role || item.Role || "");
    }
  }
  return out.filter(Boolean).map((s) => String(s).trim().toLowerCase());
};

const isPayrollEnabledUser = (u) =>
  Boolean(u?.payrollEnabled ?? u?.PayrollEnabled ?? u?.isPayrollEnabled ?? u?.IsPayrollEnabled);

const useCurrentUser = () => {
  const [user, setUser] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("mahima_user") ||
                  localStorage.getItem("mahima:user") ||
                  localStorage.getItem("currentUser");
      if (raw) setUser(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  return user;
};

const initials = (name) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0,2).map(s => s[0]?.toUpperCase()).join("") || "?";

const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep the object URL alive until the browser has consumed the binary stream.
  window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
};

const ensurePdfBlob = async (data) => {
  const blob = data instanceof Blob ? data : new Blob([data], { type: "application/pdf" });
  const header = await blob.slice(0, 5).text();
  if (header === "%PDF-" && blob.size > 500) return blob;

  const text = await blob.text().catch(() => "");
  throw new Error(text?.trim() || "Server did not return a valid PDF.");
};

const downloadCsv = (filename, rows) => {
  if (!rows?.length) return;
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = Object.keys(rows[0]);
  const csv = headers.join(",") + "\n" + rows.map(r => headers.map(h => escape(r[h])).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
};

/* ============================================================================
 *  Toast & Confirm
 * ========================================================================= */
const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((type, message, ttl = 3500) => {
    const id = ++idRef.current;
    setToasts((p) => [...p, { id, type, message }]);
    if (ttl > 0) setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), ttl);
    return id;
  }, []);
  const dismiss = useCallback((id) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  return {
    toasts,
    success: (m, ttl) => push("success", m, ttl),
    error:   (m, ttl) => push("error",   m, ttl ?? 5000),
    info:    (m, ttl) => push("info",    m, ttl),
    dismiss,
  };
};

const ToastStack = ({ toasts, onDismiss }) => (
  <div className="fixed top-20 right-4 z-[200] flex flex-col gap-2 w-[min(92vw,360px)]">
    {toasts.map((t) => (
      <div key={t.id}
        className={`flex items-start gap-2 rounded-2xl border px-3.5 py-2.5 shadow-xl backdrop-blur bg-white/95 text-sm animate-[slideIn_200ms_ease-out] ${
          t.type === "success" ? "border-emerald-200 text-emerald-900"
          : t.type === "error" ? "border-rose-200 text-rose-900"
          : "border-slate-200 text-slate-800"}`}
        role="status">
        {t.type === "success" ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
         : t.type === "error" ? <AlertCircle  className="w-4 h-4 mt-0.5 text-rose-500    shrink-0" />
         :                      <Info         className="w-4 h-4 mt-0.5 text-slate-500   shrink-0" />}
        <div className="flex-1 leading-snug">{t.message}</div>
        <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-700">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
  </div>
);

const ConfirmModal = ({ open, title, body, onConfirm, onCancel, danger }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[180] bg-slate-900/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 *  Main page
 * ========================================================================= */
export default function PayrollPage() {
  const { from: initialFrom, to: initialTo } = monthRange();
  const currentUser = useCurrentUser();
  const toast = useToasts();

  /* ------------ state -------------------------------------------- */
  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate]     = useState(initialTo);

  const [staffList, setStaffList] = useState([]);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");

  const [summary, setSummary]   = useState(INITIAL_SUMMARY);
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [allSettings, setAllSettings] = useState([]);   // for bulk run
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentNotes, setPaymentNotes] = useState("");

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingSlip, setLoadingSlip]       = useState(false);
  const [savingRun, setSavingRun]           = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [history, setHistory] = useState([]);             // selected user
  const [allRuns, setAllRuns] = useState([]);             // every staff
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [downloadingHistoryId, setDownloadingHistoryId] = useState(null);
  const [deletingRunId, setDeletingRunId] = useState(null);
  const [editingRun, setEditingRun] = useState(null);
  const [currentRunId, setCurrentRunId] = useState(null);

  const [confirm, setConfirm] = useState(null);
  const [showBulk, setShowBulk] = useState(false);

  const [tab, setTab] = useState("calculate"); // calculate | setup | history

  /* ------------ derived ------------------------------------------ */
  const selectedStaff = useMemo(
    () => (staffList || []).find((u) => (u.id || u.userId) === selectedUserId) || null,
    [staffList, selectedUserId]
  );
  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return staffList;
    return staffList.filter((u) => {
      const hay = [u.displayName, u.fullName, u.username, u.email, u.id, u.userId]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [staffList, staffSearch]);

  /* ------------ load payroll-enabled staff ---------------- */
  const [staffFilterFellBack, setStaffFilterFellBack] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const usersRes = await api.get("/users", { params: { payrollEnabled: true, limit: 5000 } });
        if (cancelled) return;
        const all = arrayFrom(usersRes?.data);
        setStaffList(all.filter(isPayrollEnabledUser));
        setStaffFilterFellBack(false);
      } catch (err) {
        console.warn("Failed to load staff", err);
        if (!cancelled) setStaffList([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ------------ load global settings + global runs (for KPIs) ---- */
  const reloadGlobalRuns = useCallback(async () => {
    try {
      const res = await api.get("/payroll/runs");
      setAllRuns(arrayFrom(res?.data).map(normalizePayrollRun));
    } catch {
      setAllRuns([]);
    }
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/payroll/settings");
        setAllSettings(arrayFrom(res?.data));
      } catch { setAllSettings([]); }
    })();
    reloadGlobalRuns();
  }, [reloadGlobalRuns]);

  const sameSelectedPeriod = useCallback((run) => {
    if (!run) return false;
    return dayjs(run.from || run.From).format("YYYY-MM-DD") === dayjs(fromDate).format("YYYY-MM-DD") &&
           dayjs(run.to || run.To).format("YYYY-MM-DD") === dayjs(toDate).format("YYYY-MM-DD");
  }, [fromDate, toDate]);

  const applySavedRun = useCallback((run) => {
    const normalized = normalizePayrollRun(run);
    if (!normalized) return;
    const payable = safeNum(normalized.payableAmount, safeNum(normalized.netAmount) + safeNum(normalized.previousArrears));
    const paid = safeNum(normalized.paidAmount);
    const balance = safeNum(normalized.balanceAmount, Math.max(0, payable - paid));
    setSummary({
      ...INITIAL_SUMMARY,
      ...normalized,
      userId: normalized.userId || normalized.UserId || selectedUserId,
      displayName: normalized.displayName || normalized.DisplayName || selectedStaff?.displayName || selectedStaff?.username || selectedUserId,
      from: normalized.from || normalized.From || fromDate,
      to: normalized.to || normalized.To || toDate,
      totalHours: safeNum(normalized.totalHours ?? normalized.TotalHours),
      hourlyRate: safeNum(normalized.hourlyRate ?? normalized.HourlyRate),
      fixedAmount: safeNum(normalized.fixedAmount ?? normalized.FixedAmount),
      hourlyAmount: safeNum(normalized.hourlyAmount ?? normalized.HourlyAmount),
      allowances: safeNum(normalized.allowances ?? normalized.Allowances),
      deductions: safeNum(normalized.deductions ?? normalized.Deductions),
      grossAmount: safeNum(normalized.grossAmount ?? normalized.GrossAmount),
      netAmount: safeNum(normalized.netAmount ?? normalized.NetAmount),
      previousArrears: safeNum(normalized.previousArrears ?? normalized.PreviousArrears),
      payableAmount: payable,
      paidAmount: paid,
      balanceAmount: balance,
      paymentStatus: normalized.paymentStatus || normalized.PaymentStatus || paymentStatus(paid, balance, payable),
      paymentNotes: normalized.paymentNotes || normalized.PaymentNotes || "",
      calculated: true,
    });
    setPaidAmount(paid);
    setPaymentNotes(normalized.paymentNotes || normalized.PaymentNotes || "");
    setCurrentRunId(normalized.id ?? normalized.Id ?? null);
  }, [fromDate, toDate, selectedStaff, selectedUserId]);

  /* ------------ when selection changes --------------------------- */
  useEffect(() => {
    if (!selectedUserId) {
      setSettings({ ...INITIAL_SETTINGS });
      setHistory([]);
      setSummary(INITIAL_SUMMARY);
      setCurrentRunId(null);
      setPaidAmount(0);
      setPaymentNotes("");
      return;
    }
    setSummary({ ...INITIAL_SUMMARY, userId: selectedUserId, from: fromDate, to: toDate });
    setCurrentRunId(null);
    setPaidAmount(0);
    setPaymentNotes("");
    let cancelled = false;
    (async () => {
      try {
        const sFound = allSettings.find((x) => x.userId === selectedUserId);
        if (!cancelled) {
          setSettings(sFound
            ? {
                userId: sFound.userId,
                hourlyRate: safeNum(sFound.hourlyRate),
                monthlyFixedAmount: safeNum(sFound.monthlyFixedAmount),
                allowances: safeNum(sFound.allowances),
                deductions: safeNum(sFound.deductions),
                weeklyOffDay: safeNum(sFound.weeklyOffDay),
                isActive: sFound.isActive !== false,
              }
            : { ...INITIAL_SETTINGS, userId: selectedUserId });
        }
      } catch { /* ignore */ }
      setLoadingHistory(true);
      try {
        const res = await api.get("/payroll/runs", { params: { userId: selectedUserId } });
        if (!cancelled) {
          const runs = arrayFrom(res?.data).map(normalizePayrollRun);
          setHistory(runs);
          const selectedPeriodRun = runs.find(sameSelectedPeriod);
          if (selectedPeriodRun) applySavedRun(selectedPeriodRun);
        }
      } catch { if (!cancelled) setHistory([]); }
      finally  { if (!cancelled) setLoadingHistory(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedUserId, allSettings, fromDate, toDate, sameSelectedPeriod, applySavedRun]);

  const reloadHistory = async () => {
    if (!selectedUserId) return;
    setLoadingHistory(true);
    try {
      const res = await api.get("/payroll/runs", { params: { userId: selectedUserId } });
      setHistory(arrayFrom(res?.data).map(normalizePayrollRun));
    } catch { /* ignore */ }
    finally  { setLoadingHistory(false); }
  };

  /* ------------ validation --------------------------------------- */
  const validatePeriod = () => {
    if (!fromDate || !toDate) { toast.error("Pick a from and to date."); return false; }
    const a = dayjs(fromDate), b = dayjs(toDate);
    if (!a.isValid() || !b.isValid()) { toast.error("Invalid dates."); return false; }
    if (a.isAfter(b)) { toast.error("'From' cannot be after 'To'."); return false; }
    if (b.diff(a, "day") > 92) { toast.error("Period can't exceed 92 days."); return false; }
    return true;
  };

  /* ------------ core calculate ----------------------------------- */
  const calculateFor = useCallback(async (userId, overrideSettings = null) => {
    const monthKey = dayjs(fromDate).format("YYYY-MM");
    const params = { from: fromDate, to: toDate, userId };
    const [payrollRes, attendanceRes, expensesRes] = await Promise.all([
      api.get("/payroll/summary",   { params }).catch(() => ({ data: {} })),
      api.get("/attendance",        { params }).catch(() => ({ data: [] })),
      api.get("/expenses",          { params: { month: monthKey, category: "PAYROLL" } }).catch(() => ({ data: [] })),
    ]);

    const data = payrollRes?.data || {};
    const attendanceList = arrayFrom(attendanceRes?.data);
    // Pay is driven by days actually marked Present/P -- matches V4.0's real payroll
    // behavior. This is computed client-side from the same attendance fetch, never
    // from the backend's totalHours/Timesheets, so it can't silently drift back to
    // an hours-based figure.
    const presentDays = attendanceList.filter((r) => ["present", "p"].includes((r.status ?? r.Status ?? "").toString().trim().toLowerCase())).length;
    const totalHours = presentDays;

    const s = overrideSettings || (allSettings.find(x => x.userId === userId)) || {};
    const hourlyRate  = safeNum(s.hourlyRate)         || safeNum(data.hourlyRate ?? data.HourlyRate);
    const fixedAmount = safeNum(data.fixedAmount ?? data.monthlyFixedAmount) || safeNum(s.monthlyFixedAmount);
    const allowances  = safeNum(data.allowances  ?? data.Allowances) || safeNum(s.allowances);
    const configuredDeductions = safeNum(s.deductions);
    const payLossAmount = safeNum(data.payLossAmount ?? data.PayLossAmount);
    // Backend deductions = fines + payrollAdvance (no leave-loss -- V4.0 never had
    // that concept). Back out its own advance figure to isolate fines alone, since
    // the advance is recomputed fresh below from this page's own expense fetch.
    const backendAdvance = safeNum(data.payrollAdvance ?? data.PayrollAdvance);
    const fines       = Math.max(configuredDeductions, safeNum(data.deductions ?? data.Deductions) - backendAdvance);

    /* Payroll advances from expenses */
    const expensesList = arrayFrom(expensesRes?.data);
    const staff = staffList.find((u) => (u.id || u.userId) === userId);
    const matchKeys = [staff?.displayName, staff?.fullName, staff?.username, staff?.email,
                       String(staff?.id ?? staff?.userId ?? userId)]
      .filter(Boolean).map((k) => k.toString().trim().toLowerCase());
    const payrollAdvance = expensesList
      .filter((e) => {
        const person = (e.payrollPerson ?? e.PayrollPerson ?? "").toString().trim().toLowerCase();
        const month  = (e.payrollMonth  ?? e.PayrollMonth  ?? "").toString().trim();
        if (!person) return false;
        if (month && month !== monthKey) return false;
        return matchKeys.includes(person);
      })
      .reduce((sum, e) => sum + safeNum(e.amount ?? e.Amount), 0);

    /* CORRECT formula */
    const hourlyAmount   = totalHours * hourlyRate;
    const grossAmount    = fixedAmount + hourlyAmount + allowances;
    // Leave-loss is tracked (below, for display) but not deducted -- V4.0 never
    // subtracted it from Net; Deductions = Fines + Payroll advances only.
    const totalDeductions = Math.max(0, fines + payrollAdvance);
    const netAmount      = Math.max(0, grossAmount - totalDeductions);
    const previousArrears = safeNum(data.previousArrears ?? data.PreviousArrears);
    const payableAmount = Math.max(0, netAmount + previousArrears);
    const displayName    = data.displayName || staff?.displayName || staff?.fullName ||
                           staff?.username  || staff?.email || userId;
    return {
      userId, displayName, from: data.from || fromDate, to: data.to || toDate,
      totalHours, hourlyRate, fixedAmount, hourlyAmount, allowances,
      deductions: totalDeductions, grossAmount, netAmount, payrollAdvance, fines,
      leaveDays: safeNum(data.leaveDays ?? data.LeaveDays),
      paidLeaveDays: safeNum(data.paidLeaveDays ?? data.PaidLeaveDays),
      payLossDays: safeNum(data.payLossDays ?? data.PayLossDays),
      payLossAmount, workingDays: safeNum(data.workingDays ?? data.WorkingDays),
      weeklyOffDay: safeNum(data.weeklyOffDay ?? data.WeeklyOffDay),
      previousArrears, payableAmount, paidAmount: 0,
        balanceAmount: payableAmount, paymentStatus: paymentStatus(0, payableAmount, payableAmount),
        calculated: true,
      };
  }, [fromDate, toDate, allSettings, staffList]);

  const persistRun = useCallback(async (s) => {
    try {
      const res = await api.post("/payroll/runs", {
        userId: s.userId, displayName: s.displayName,
        from: s.from, to: s.to,
        totalHours: s.totalHours, hourlyRate: s.hourlyRate,
        fixedAmount: s.fixedAmount, hourlyAmount: s.hourlyAmount,
        allowances: s.allowances, deductions: s.deductions,
        grossAmount: s.grossAmount, netAmount: s.netAmount,
        paidAmount: s.paidAmount || 0,
        paymentNotes: s.paymentNotes || "",
      });
      return normalizePayrollRun(res?.data || {});
    } catch (err) {
      console.error("Persist run failed", err);
      return null;
    }
  }, []);

  const handleCalculate = async () => {
    if (!selectedUserId) { toast.error("Select a staff member first."); return; }
    if (!validatePeriod()) return;
    setLoadingSummary(true);
    try {
      const calculated = await calculateFor(selectedUserId, settings);
      const payable = safeNum(calculated.payableAmount, calculated.netAmount + calculated.previousArrears);
      const paid = Math.min(Math.max(0, safeNum(paidAmount)), payable);
      const balance = Math.max(0, payable - paid);
      const result = {
        ...calculated,
        paidAmount: paid,
        balanceAmount: balance,
        paymentStatus: paymentStatus(paid, balance, payable),
        paymentNotes,
      };
      setSummary(result);
      setCurrentRunId(null);
      toast.success("Payroll calculated. Review it, then press Save run.");
    } catch (err) {
      console.error(err);
      toast.error(errMsg(err, "Failed to calculate payroll."));
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleSaveRun = async () => {
    if (!selectedUserId) { toast.error("Select a staff member first."); return; }
    if (!summary?.calculated || !summary?.userId || summary.userId !== selectedUserId || !summary.from || !summary.to) {
      toast.error("Calculate payroll before saving this run.");
      return;
    }
    setSavingRun(true);
    try {
      const payable = safeNum(summary.payableAmount, summary.netAmount + summary.previousArrears);
      const paid = Math.min(Math.max(0, safeNum(paidAmount)), payable);
      const balance = Math.max(0, payable - paid);
      const result = {
        ...summary,
        paidAmount: paid,
        balanceAmount: balance,
        paymentStatus: paymentStatus(paid, balance, payable),
        paymentNotes,
      };
      const created = await persistRun(result);
      if (created?.id != null || created?.Id != null) {
        setSummary({ ...result, ...created, calculated: true });
        setCurrentRunId(created.id ?? created.Id);
        await reloadHistory();
        await reloadGlobalRuns();
        toast.success("Payroll run saved.");
      } else {
        toast.error("Could not save payroll run.");
      }
    } catch (err) {
      console.error(err);
      toast.error(errMsg(err, "Failed to save payroll run."));
    } finally {
      setSavingRun(false);
    }
  };

  /* ------------ download current slip ---------------------------- */
  const handleDownloadSlip = async () => {
    if (!selectedUserId) { toast.error("Select a staff member first."); return; }
    if (!validatePeriod()) return;
    setLoadingSlip(true);
    try {
      const res = await api.get("/payroll/slip", {
        params: { userId: selectedUserId, from: fromDate, to: toDate },
        responseType: "blob",
      });
      const blob = await ensurePdfBlob(res.data);
      const name = summary.displayName || selectedStaff?.displayName || selectedStaff?.username || "salary";
      downloadBlob(blob, `SalarySlip_${name}_${dayjs(fromDate).format("YYYYMM")}.pdf`);
      toast.success("Salary slip downloaded.");
    } catch (err) {
      console.error(err);
      toast.error(errMsg(err, "Failed to download salary slip."));
    } finally { setLoadingSlip(false); }
  };

  const handleDownloadHistorySlip = async (record) => {
    const runId = record?.id || record?.Id;
    if (!runId) return;
    setDownloadingHistoryId(runId);
    try {
      const res = await api.get(`/payroll/runs/${runId}/slip`, { responseType: "blob" });
      const blob = await ensurePdfBlob(res.data);
      const name = record.displayName || record.DisplayName || selectedStaff?.displayName || "salary";
      const fromVal = record.from || record.From;
      downloadBlob(blob, `SalarySlip_${name}_${dayjs(fromVal).format("YYYYMM")}.pdf`);
      toast.success("Slip downloaded.");
    } catch (err) {
      console.error(err);
      toast.error(errMsg(err, "Failed to download slip."));
    } finally { setDownloadingHistoryId(null); }
  };

  /* ------------ delete run --------------------------------------- */
  const handleDeleteRun = (record) => {
    const runId = record.id || record.Id;
    if (!runId) return;
    setConfirm({
      title: "Delete payroll run?",
      body: "This permanently removes the saved payroll record. This cannot be undone.",
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        setDeletingRunId(runId);
        try {
          await api.delete(`/payroll/runs/${runId}`);
          await reloadHistory();
          await reloadGlobalRuns();
          if (currentRunId === runId) setCurrentRunId(null);
          toast.success("Payroll run deleted.");
        } catch (err) {
          console.error(err);
          toast.error(errMsg(err, "Failed to delete payroll run."));
        } finally { setDeletingRunId(null); }
      },
    });
  };

  /* ------------ edit historical run ------------------------------- */
  const handleUpdateRun = async (values) => {
    const runId = values.id || values.Id;
    const res = await api.put(`/payroll/runs/${runId}`, values);
    await reloadHistory();
    await reloadGlobalRuns();
    if (currentRunId === runId) applySavedRun(res.data);
    toast.success("Payroll record updated.");
    setEditingRun(null);
  };

  /* ------------ settings save ----------------------------------- */
  const handleSaveSettings = async () => {
    if (!settings.userId) { toast.error("Select a staff member first."); return; }
    if (settings.hourlyRate < 0 || settings.monthlyFixedAmount < 0 || settings.allowances < 0 || settings.deductions < 0) {
      toast.error("Amounts cannot be negative."); return;
    }
    setSavingSettings(true);
    try {
      await api.post("/payroll/settings", {
        userId: settings.userId,
        hourlyRate: safeNum(settings.hourlyRate),
        monthlyFixedAmount: safeNum(settings.monthlyFixedAmount),
        allowances: safeNum(settings.allowances),
        deductions: safeNum(settings.deductions),
        weeklyOffDay: safeNum(settings.weeklyOffDay),
        isActive: !!settings.isActive,
      });
      // refresh the cached settings list
      const res = await api.get("/payroll/settings").catch(() => ({ data: [] }));
      setAllSettings(arrayFrom(res?.data));
      toast.success("Payroll setup saved.");
    } catch (err) {
      console.error(err);
      toast.error(errMsg(err, "Failed to save payroll setup."));
    } finally { setSavingSettings(false); }
  };

  /* ------------ presets ----------------------------------------- */
  const presets = [
    { id: "thisMonth",     label: "This month",      get: () => monthRange(dayjs()) },
    { id: "lastMonth",     label: "Last month",      get: () => monthRange(dayjs().subtract(1, "month")) },
    { id: "twoMonths",     label: "Two months ago",  get: () => monthRange(dayjs().subtract(2, "month")) },
  ];
  const [activePreset, setActivePreset] = useState("thisMonth");
  const setPreset = (id) => {
    const p = presets.find(x => x.id === id);
    if (!p) return;
    const r = p.get();
    setFromDate(r.from);
    setToDate(r.to);
    setActivePreset(id);
  };

  /* ------------ live preview (without saving) ------------------- */
  const preview = useMemo(() => {
    const rate  = safeNum(settings.hourlyRate);
    const fixed = safeNum(settings.monthlyFixedAmount);
    const allow = safeNum(settings.allowances);
    const deduct = safeNum(settings.deductions);
    const days = safeNum(summary.totalHours, 0); // last known
    const hourlyAmount = days * rate;
    const gross = fixed + hourlyAmount + allow;
    const advances = safeNum(summary.payrollAdvance, 0);
    const totalDed = Math.max(0, deduct + advances);
    return {
      days, rate, fixed, allow, deduct, advances,
      hourlyAmount, gross, totalDed,
      net: Math.max(0, gross - totalDed),
    };
  }, [settings, summary.totalHours, summary.payrollAdvance]);

  /* ------------ KPIs across all staff for the current month ----- */
  const monthKey = dayjs(fromDate).format("YYYY-MM");
  const monthRuns = useMemo(() =>
    allRuns.filter(r => dayjs(r.from || r.From).format("YYYY-MM") === monthKey),
    [allRuns, monthKey]
  );
  const prevMonthKey = dayjs(fromDate).subtract(1, "month").format("YYYY-MM");
  const prevMonthRuns = useMemo(() =>
    allRuns.filter(r => dayjs(r.from || r.From).format("YYYY-MM") === prevMonthKey),
    [allRuns, prevMonthKey]
  );
  const kpis = useMemo(() => {
    const sum = (arr, k) => arr.reduce((s, r) => s + safeNum(r[k] ?? r[k[0].toUpperCase()+k.slice(1)]), 0);
    const grossTotal = sum(monthRuns, "grossAmount");
    const netTotal   = sum(monthRuns, "netAmount");
    const payableTotal = sum(monthRuns, "payableAmount");
    const paidTotal = sum(monthRuns, "paidAmount");
    const balanceTotal = sum(monthRuns, "balanceAmount");
    const prevNet    = sum(prevMonthRuns, "netAmount");
    const delta      = prevNet > 0 ? Math.round(((netTotal - prevNet) / prevNet) * 100) : null;
    const peopleSet  = new Set(monthRuns.map(r => r.userId || r.UserId));
    return {
      grossTotal, netTotal, payableTotal, paidTotal, balanceTotal, runs: monthRuns.length,
      people: peopleSet.size, prevNet, delta,
      avgNet: monthRuns.length ? netTotal / monthRuns.length : 0,
    };
  }, [monthRuns, prevMonthRuns]);

  /* ------------ export CSV -------------------------------------- */
  const exportHistoryCsv = () => {
    const rows = (tab === "history" ? allRuns : history).map(r => ({
      Date: dayjs(r.from || r.From).format("YYYY-MM-DD"),
      To:   dayjs(r.to   || r.To).format("YYYY-MM-DD"),
      Staff: r.displayName || r.DisplayName || r.userId || r.UserId,
      Days: r.totalHours ?? r.TotalHours,
      "Daily Rate": r.hourlyRate ?? r.HourlyRate,
      Fixed: r.fixedAmount ?? r.FixedAmount,
      Allowances: r.allowances ?? r.Allowances,
      Deductions: r.deductions ?? r.Deductions,
      Gross: r.grossAmount ?? r.GrossAmount,
      Net: r.netAmount ?? r.NetAmount,
      "Previous Arrears": r.previousArrears ?? r.PreviousArrears,
      Payable: r.payableAmount ?? r.PayableAmount,
      Paid: r.paidAmount ?? r.PaidAmount,
      Balance: r.balanceAmount ?? r.BalanceAmount,
      Status: r.paymentStatus ?? r.PaymentStatus,
    }));
    if (!rows.length) { toast.info("Nothing to export."); return; }
    downloadCsv(`payroll_${monthKey}.csv`, rows);
  };

  /* =====================================================================
   *  UI
   * ================================================================== */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-indigo-50/40">
      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
      <ConfirmModal open={!!confirm} {...(confirm || {})} onCancel={() => setConfirm(null)} />
      {editingRun && (
        <EditPayrollRunModal
          run={editingRun}
          onClose={() => setEditingRun(null)}
          onSave={handleUpdateRun}
          toast={toast}
        />
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-5 py-6 space-y-5 pb-20">
        {/* ============ HERO ============ */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-xl">
          <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-fuchsia-300/20 blur-3xl" />
          <div className="relative p-5 sm:p-7">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
                  <Wallet className="w-3.5 h-3.5" /> Payroll · {dayjs(fromDate).format("MMM YYYY")}
                </div>
                <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">Payroll &amp; Salary Slips</h1>
                <p className="mt-1 text-sm text-indigo-100">
                  Compute, save and download — accurate to the rupee, audited every step.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <HeroKpi icon={IndianRupee} label="Payable" value={formatINRCompact(kpis.payableTotal || kpis.netTotal)} delta={kpis.delta} />
                <HeroKpi icon={CheckCircle2} label="Paid"        value={formatINRCompact(kpis.paidTotal)} />
                <HeroKpi icon={AlertCircle} label="Balance"      value={formatINRCompact(kpis.balanceTotal)} />
                <HeroKpi icon={ClipboardList} label="Runs"       value={kpis.runs} />
              </div>
            </div>
          </div>
        </section>

        {/* ============ TOOLBAR (period + actions) ============ */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label>From</Label>
                <input type="date" value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setActivePreset(""); }}
                  className="input" />
              </div>
              <div>
                <Label>To</Label>
                <input type="date" value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setActivePreset(""); }}
                  className="input" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label>Quick range</Label>
                <div className="flex gap-1 mt-1">
                  {presets.map(p => (
                    <button key={p.id}
                      onClick={() => setPreset(p.id)}
                      className={`flex-1 px-2 py-2 rounded-xl border text-[11px] font-semibold transition truncate ${
                        activePreset === p.id
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 lg:self-end">
              <button onClick={() => setShowBulk(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-3.5 py-2 text-sm font-semibold transition shadow-sm">
                <Sparkles className="w-4 h-4" /> Bulk run
              </button>
              <button onClick={exportHistoryCsv}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 px-3.5 py-2 text-sm font-semibold transition">
                <FileDown className="w-4 h-4" /> CSV
              </button>
            </div>
          </div>
        </section>

        {/* ============ MAIN GRID ============ */}
        <section className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {/* ----- staff picker ----- */}
          <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[640px]">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-800">Staff</h2>
                <span className="ml-auto text-[11px] text-slate-500">
                  {filteredStaff.length} of {staffList.length}
                </span>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)}
                  placeholder="Search by name, email..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>
              {staffFilterFellBack && (
                <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  Payroll filter was unavailable. Please mark staff as Payroll Enabled in Users.
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredStaff.length === 0 && (
                <div className="py-8 text-center text-sm text-slate-400">No matching staff.</div>
              )}
              {filteredStaff.map((u) => {
                const id = u.id || u.userId;
                const name = u.displayName || u.fullName || u.username || u.email || id;
                const active = id === selectedUserId;
                const setupOk = !!allSettings.find(s => s.userId === id && s.isActive !== false);
                return (
                  <button key={id} onClick={() => setSelectedUserId(id)}
                    className={`w-full mb-1 rounded-xl px-3 py-2.5 flex items-center gap-2.5 text-left transition ${
                      active ? "bg-indigo-50 border border-indigo-200" : "hover:bg-slate-50 border border-transparent"
                    }`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                      active ? "bg-gradient-to-br from-indigo-500 to-violet-500 text-white" : "bg-slate-100 text-slate-700"
                    }`}>
                      {initials(name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{u.email || id}</div>
                    </div>
                    {setupOk && <BadgeCheck className="w-4 h-4 text-emerald-500 shrink-0" title="Payroll configured" />}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* ----- right pane ----- */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* tabs */}
            <div className="flex items-center gap-1 px-2 sm:px-3 py-2 border-b border-slate-100 overflow-x-auto">
              {[
                { id: "calculate", label: "Calculate", icon: Calculator },
                { id: "setup",     label: "Setup",     icon: SettingsIcon },
                { id: "history",   label: "History",   icon: HistoryIcon },
              ].map(t => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
                      active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                    }`}>
                    <Icon className="w-4 h-4" /> {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-4 sm:p-5">
              {!selectedUserId && tab !== "history" && (
                <EmptyHero />
              )}

              {selectedUserId && tab === "calculate" && (
                <CalculateTab
                  staff={selectedStaff}
                  summary={summary}
                  preview={preview}
                  fromDate={fromDate}
                  toDate={toDate}
                  loadingSummary={loadingSummary}
                  loadingSlip={loadingSlip}
                  savingRun={savingRun}
                  paidAmount={paidAmount}
                  setPaidAmount={setPaidAmount}
                  paymentNotes={paymentNotes}
                  setPaymentNotes={setPaymentNotes}
                  onCalculate={handleCalculate}
                  onSaveRun={handleSaveRun}
                  onDownload={handleDownloadSlip}
                  onOpenSetup={() => setTab("setup")}
                  prevMonthRuns={prevMonthRuns}
                />
              )}

              {selectedUserId && tab === "setup" && (
                <SetupTab
                  staff={selectedStaff}
                  settings={settings}
                  setSettings={setSettings}
                  savingSettings={savingSettings}
                  onSave={handleSaveSettings}
                  preview={preview}
                />
              )}

              {tab === "history" && (
                <HistoryTab
                  history={selectedUserId ? history : allRuns}
                  loadingHistory={loadingHistory}
                  downloadingHistoryId={downloadingHistoryId}
                  deletingRunId={deletingRunId}
                  currentRunId={currentRunId}
                  onDownload={handleDownloadHistorySlip}
                  onDelete={handleDeleteRun}
                  onEdit={setEditingRun}
                  scope={selectedUserId ? "user" : "global"}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Bulk run modal */}
      {showBulk && (
        <BulkRunModal
          onClose={() => setShowBulk(false)}
          staff={staffList}
          allSettings={allSettings}
          fromDate={fromDate}
          toDate={toDate}
          calculateFor={calculateFor}
          persistRun={persistRun}
          onDone={() => { reloadGlobalRuns(); }}
          toast={toast}
        />
      )}

      <style>{`
        .input {
          width: 100%; padding: 9px 12px; border-radius: 12px;
          border: 1px solid #e2e8f0; font-size: 14px; background: #fff;
          outline: none; transition: border 120ms;
        }
        .input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.18); }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

/* ============================================================================
 *  Sub-components
 * ========================================================================= */
function Label({ children }) {
  return <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{children}</label>;
}

function HeroKpi({ icon: Icon, label, value, delta }) {
  return (
    <div className="rounded-2xl bg-white/15 backdrop-blur border border-white/10 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-indigo-100">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums leading-tight">{value}</div>
      {delta != null && (
        <div className={`text-[10px] mt-0.5 font-semibold ${delta >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs prev
        </div>
      )}
    </div>
  );
}

function EmptyHero() {
  return (
    <div className="py-12 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center">
        <Wallet className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-800">Pick a staff member to begin</h3>
      <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
        Select someone from the left, then Calculate, Save, or download a slip. Or run payroll for everyone at once via the <strong>Bulk run</strong> button above.
      </p>
    </div>
  );
}

function CalculateTab({
  staff, summary, preview, fromDate, toDate,
  loadingSummary, loadingSlip, savingRun,
  paidAmount, setPaidAmount, paymentNotes, setPaymentNotes,
  onCalculate, onSaveRun, onDownload, onOpenSetup, prevMonthRuns,
}) {
  const setupComplete = preview.rate > 0 || preview.fixed > 0;
  const prevRun = prevMonthRuns.find(r => (r.userId || r.UserId) === (staff?.id || staff?.userId));
  const prevNet = safeNum(prevRun?.netAmount ?? prevRun?.NetAmount);
  const currentNet = summary.netAmount || preview.net;
  const delta = prevNet > 0 ? Math.round(((currentNet - prevNet) / prevNet) * 100) : null;
  const previousArrears = safeNum(summary.previousArrears);
  const payableAmount = safeNum(summary.payableAmount, currentNet + previousArrears) || currentNet + previousArrears;
  const paidNow = Math.min(Math.max(0, safeNum(paidAmount)), payableAmount);
  const balanceAmount = Math.max(0, payableAmount - paidNow);
  const savedRunLoaded = Boolean(summary?.id || summary?.Id);
  const canSaveRun = Boolean(summary?.calculated && !savedRunLoaded && summary?.userId && summary.userId === (staff?.id || staff?.userId) && summary.from && summary.to);

  return (
    <div className="space-y-4">
      {/* Staff header */}
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-base font-bold flex items-center justify-center">
          {initials(staff?.displayName || staff?.fullName || staff?.username)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-slate-900 truncate">
            {staff?.displayName || staff?.fullName || staff?.username || staff?.email}
          </div>
          <div className="text-[12px] text-slate-500 truncate">
            {staff?.email} · Period {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}
          </div>
        </div>
        {!setupComplete && (
          <button onClick={onOpenSetup}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-200 px-3 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">
            <AlertCircle className="w-3 h-3" /> Setup needed
          </button>
        )}
      </div>

      {/* Big net card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-900 text-white p-5">
          <div className="text-[11px] uppercase tracking-wider text-indigo-200">Payable</div>
          <div className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums tracking-tight">
            {formatINR(payableAmount)}
          </div>
          <div className="mt-3 flex items-center gap-3 text-[12px] text-indigo-100/85 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="w-3 h-3" />
              {summary.totalHours || preview.days} days present
            </span>
            <span className="text-indigo-300/40">·</span>
            <span>Daily rate {formatINR(preview.rate)}</span>
            {delta != null && (
              <>
                <span className="text-indigo-300/40">·</span>
                <span className={`inline-flex items-center gap-1 ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(delta)}% vs prev month
                </span>
              </>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 p-5 flex flex-col gap-3 bg-white">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Gross / Deductions</div>
          <div className="flex items-center gap-2 justify-between">
            <span className="text-sm text-slate-700">Gross</span>
            <span className="text-base font-bold text-slate-900 tabular-nums">{formatINR(summary.grossAmount || preview.gross)}</span>
          </div>
          <div className="flex items-center gap-2 justify-between">
            <span className="text-sm text-slate-700">Deductions</span>
            <span className="text-base font-bold text-rose-600 tabular-nums">− {formatINR(summary.deductions || preview.totalDed)}</span>
          </div>
          <div className="border-t border-slate-100 pt-3 flex items-center gap-2 justify-between">
            <span className="text-sm text-slate-700 font-medium">Current unpaid balance</span>
            <span className="text-base font-bold text-amber-700 tabular-nums">{formatINR(balanceAmount)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr] gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
        <div>
          <Label>Paid this run</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{RUPEE}</span>
            <input
              type="number"
              min="0"
              step="100"
              value={paidAmount}
              onChange={(event) => setPaidAmount(event.target.value)}
              className="input pl-8 tabular-nums"
            />
          </div>
          <p className="mt-1 text-[11px] font-semibold text-amber-800">
            Payable {formatINR(payableAmount)}. Current unpaid balance {formatINR(balanceAmount)} will become arrears only if this saved run remains unpaid or partial.
          </p>
        </div>
        <div>
          <Label>Payment notes</Label>
          <input
            value={paymentNotes}
            onChange={(event) => setPaymentNotes(event.target.value)}
            className="input"
            placeholder="Bank ref, cash voucher, partial reason..."
          />
        </div>
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Breakdown</h3>
        </div>
        <div className="divide-y divide-slate-100">
          <BreakdownRow icon={PlusCircle} accent="emerald" label="Fixed monthly"  value={formatINR(summary.fixedAmount || preview.fixed)} />
          <BreakdownRow icon={PlusCircle} accent="emerald"
            label="Daily compensation"
            sub={`${summary.totalHours || preview.days} days × ${formatINR(preview.rate)}`}
            value={formatINR(summary.hourlyAmount || preview.hourlyAmount)} />
          <BreakdownRow icon={PlusCircle} accent="emerald" label="Allowances"     value={formatINR(summary.allowances || preview.allow)} />
          <BreakdownRow icon={ArrowRight} accent="slate" label="Gross"            value={formatINR(summary.grossAmount || preview.gross)} bold />
          <BreakdownRow icon={MinusCircle} accent="rose" label="Fines"           value={formatINR(summary.fines || preview.deduct)} />
          <BreakdownRow icon={MinusCircle} accent="rose" label="Payroll advances" value={formatINR(summary.payrollAdvance || preview.advances)} />
          <BreakdownRow icon={ChevronRight} accent="indigo" label="Net pay"      value={formatINR(summary.netAmount || preview.net)} bold highlight />
          <BreakdownRow icon={ArrowRight} accent="slate" label="Previous arrears" value={formatINR(previousArrears)} />
          <BreakdownRow icon={IndianRupee} accent="indigo" label="Total payable" value={formatINR(payableAmount)} bold />
          <BreakdownRow icon={CheckCircle2} accent="emerald" label="Paid" value={formatINR(paidNow)} />
          <BreakdownRow icon={AlertCircle} accent="rose" label="Current unpaid balance" value={formatINR(balanceAmount)} bold highlight />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <button onClick={onCalculate} disabled={loadingSummary}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-3 text-sm font-semibold shadow-sm">
          {loadingSummary ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
          {loadingSummary ? "Calculating..." : "Calculate"}
        </button>
        <button onClick={onSaveRun} disabled={savingRun || !canSaveRun}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-3 text-sm font-semibold shadow-sm">
          {savingRun ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {savingRun ? "Saving..." : savedRunLoaded ? "Saved run loaded" : "Save run"}
        </button>
        <button onClick={onDownload} disabled={loadingSlip}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-3 text-sm font-semibold">
          {loadingSlip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download slip
        </button>
      </div>
    </div>
  );
}

function BreakdownRow({ icon: Icon, accent, label, sub, value, bold, highlight }) {
  const tints = {
    emerald: "text-emerald-500",
    rose:    "text-rose-500",
    indigo:  "text-indigo-500",
    slate:   "text-slate-500",
  };
  return (
    <div className={`px-4 py-2.5 flex items-center gap-3 ${highlight ? "bg-indigo-50/50" : ""}`}>
      <Icon className={`w-4 h-4 ${tints[accent] || tints.slate} shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] ${bold ? "font-bold text-slate-900" : "text-slate-700"}`}>{label}</div>
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      </div>
      <div className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${highlight ? "text-indigo-900" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

function SetupTab({ staff, settings, setSettings, savingSettings, onSave, preview }) {
  const update = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white text-sm font-bold flex items-center justify-center">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900">Payroll setup</h3>
          <p className="text-[12px] text-slate-500">
            Configure the base components used to calculate {staff?.displayName || staff?.fullName || "this staff"}'s salary.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Monthly fixed amount</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{RUPEE}</span>
            <input type="number" min="0" step="100"
              value={settings.monthlyFixedAmount}
              onChange={(e) => update("monthlyFixedAmount", e.target.value)}
              className="input pl-8 tabular-nums" />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Paid every month regardless of days worked.</p>
        </div>

        <div>
          <Label>Daily rate</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{RUPEE}</span>
            <input type="number" min="0" step="10"
              value={settings.hourlyRate}
              onChange={(e) => update("hourlyRate", e.target.value)}
              className="input pl-8 tabular-nums" />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Multiplied by the count of present days.</p>
        </div>

        <div>
          <Label>Allowances</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{RUPEE}</span>
            <input type="number" min="0" step="100"
              value={settings.allowances}
              onChange={(e) => update("allowances", e.target.value)}
              className="input pl-8 tabular-nums" />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">HRA, transport, etc. — added to gross.</p>
        </div>

        <div>
          <Label>Standard fines / standing deductions</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{RUPEE}</span>
            <input type="number" min="0" step="50"
              value={settings.deductions}
              onChange={(e) => update("deductions", e.target.value)}
              className="input pl-8 tabular-nums" />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Payroll advances from Costs are added automatically.</p>
        </div>

        <div>
          <Label>Weekly day off</Label>
          <select value={settings.weeklyOffDay ?? 0}
            onChange={(e) => update("weeklyOffDay", Number(e.target.value))}
            className="input bg-white">
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">Excluded from working days and leave/pay-loss calculations.</p>
        </div>

        <div className="sm:col-span-2 flex items-center gap-2 px-1">
          <input id="isActive" type="checkbox"
            checked={!!settings.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
          <label htmlFor="isActive" className="text-sm text-slate-700">
            Active — include in bulk run and use these values when calculating
          </label>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-4 h-4 text-indigo-500" />
          <h4 className="text-sm font-semibold text-slate-800">Live preview</h4>
          <span className="ml-auto text-[11px] text-slate-500">Based on currently saved attendance</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <PreviewBox label="Gross"      value={formatINR(preview.gross)} accent="emerald" />
          <PreviewBox label="Deductions" value={formatINR(preview.totalDed)} accent="rose" />
          <PreviewBox label="Days"       value={preview.days} accent="slate" />
          <PreviewBox label="Net"        value={formatINR(preview.net)} accent="indigo" big />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={savingSettings}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-semibold shadow-sm">
          {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save setup
        </button>
      </div>
    </div>
  );
}

function PreviewBox({ label, value, accent, big }) {
  const tint = {
    emerald: "bg-emerald-50 border-emerald-100 text-emerald-700",
    rose:    "bg-rose-50 border-rose-100 text-rose-700",
    slate:   "bg-slate-100 border-slate-200 text-slate-700",
    indigo:  "bg-indigo-50 border-indigo-100 text-indigo-700",
  }[accent] || "bg-slate-50 border-slate-100 text-slate-700";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tint}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold">{label}</div>
      <div className={`mt-1 tabular-nums font-bold ${big ? "text-lg" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function HistoryTab({ history, loadingHistory, downloadingHistoryId, deletingRunId, currentRunId, onDownload, onDelete, onEdit, scope }) {
  const rows = (history || []).slice().sort((a, b) => {
    return dayjs(b.from || b.From).unix() - dayjs(a.from || a.From).unix();
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HistoryIcon className="w-4 h-4 text-slate-500" />
        <h3 className="text-base font-semibold text-slate-900">Payroll history</h3>
        <span className="ml-auto text-[11px] text-slate-500">
          {scope === "global" ? "All staff" : "This staff"} · {rows.length} run{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {loadingHistory && (
        <div className="py-10 text-center text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading…
        </div>
      )}
      {!loadingHistory && rows.length === 0 && (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-10 text-center">
          <ClipboardList className="w-6 h-6 mx-auto text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700">No runs yet</p>
          <p className="text-xs text-slate-500">Saved payroll runs will appear here.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-left">
                <Th>Period</Th>
                {scope === "global" && <Th>Staff</Th>}
                <Th num>Days</Th>
                <Th num>Daily</Th>
                <Th num>Gross</Th>
                <Th num>Ded.</Th>
                <Th num>Net</Th>
                <Th num>Arrears</Th>
                <Th num>Payable</Th>
                <Th num>Paid</Th>
                <Th num>Balance</Th>
                <Th>Status</Th>
                <Th center>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = r.id || r.Id;
                const isCurrent = id === currentRunId;
                return (
                  <tr key={id} className={`border-t border-slate-100 ${isCurrent ? "bg-indigo-50/40" : "hover:bg-slate-50/50"}`}>
                    <td className="px-4 py-2.5">
                      <div className="text-sm font-medium text-slate-800">
                        {dayjs(r.from || r.From).format("MMM YYYY")}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {dayjs(r.from || r.From).format("DD MMM")} – {dayjs(r.to || r.To).format("DD MMM")}
                      </div>
                    </td>
                    {scope === "global" && (
                      <td className="px-4 py-2.5">
                        <div className="text-sm text-slate-800 truncate max-w-[180px]">
                          {r.displayName || r.DisplayName || r.userId || r.UserId}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.totalHours ?? r.TotalHours ?? 0}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatINR(r.hourlyRate ?? r.HourlyRate ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 font-medium">{formatINR(r.grossAmount ?? r.GrossAmount ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-600">− {formatINR(r.deductions ?? r.Deductions ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 font-bold">{formatINR(r.netAmount ?? r.NetAmount ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{formatINR(r.previousArrears ?? r.PreviousArrears ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700 font-bold">{formatINR(r.payableAmount ?? r.PayableAmount ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatINR(r.paidAmount ?? r.PaidAmount ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-700 font-semibold">{formatINR(r.balanceAmount ?? r.BalanceAmount ?? 0)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                        (r.paymentStatus ?? r.PaymentStatus) === "PAID"
                          ? "bg-emerald-50 text-emerald-700"
                          : (r.paymentStatus ?? r.PaymentStatus) === "PARTIAL"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-rose-50 text-rose-700"
                      }`}>
                        {r.paymentStatus ?? r.PaymentStatus ?? "UNPAID"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="inline-flex gap-1">
                        <button onClick={() => onDownload(r)} disabled={downloadingHistoryId === id}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50" title="Download slip">
                          {downloadingHistoryId === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        </button>
                        <button onClick={() => onEdit(r)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-indigo-600 hover:bg-indigo-50" title="Edit record">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => onDelete(r)} disabled={deletingRunId === id}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-50" title="Delete">
                          {deletingRunId === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, num, center }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${num ? "text-right" : center ? "text-center" : "text-left"}`}>
      {children}
    </th>
  );
}

/* ============================================================================
 *  Edit payroll run modal -- full edit of a saved historical record (period,
 *  days/rate/fixed/allowances/deductions/arrears/paid amount), not just the
 *  paid-amount-only patch. Ported from V4.0, which had this but V4.1 never did.
 * ========================================================================= */
function EditPayrollRunModal({ run, onClose, onSave, toast }) {
  const field = (name, fallback = 0) => readField(run, name, fallback);
  const [form, setForm] = useState({
    id: run.id || run.Id,
    userId: field("userId", ""),
    displayName: field("displayName", ""),
    from: dayjs(field("from")).format("YYYY-MM-DD"),
    to: dayjs(field("to")).format("YYYY-MM-DD"),
    totalHours: safeNum(field("totalHours")),
    hourlyRate: safeNum(field("hourlyRate")),
    fixedAmount: safeNum(field("fixedAmount")),
    allowances: safeNum(field("allowances")),
    deductions: safeNum(field("deductions")),
    previousArrears: safeNum(field("previousArrears")),
    paidAmount: safeNum(field("paidAmount")),
    paymentNotes: field("paymentNotes", "") || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const numbers = ["totalHours", "hourlyRate", "fixedAmount", "allowances", "deductions", "previousArrears", "paidAmount"];
  const computed = useMemo(() => {
    const gross = safeNum(form.fixedAmount) + safeNum(form.totalHours) * safeNum(form.hourlyRate) + safeNum(form.allowances);
    const net = Math.max(0, gross - safeNum(form.deductions));
    const payable = net + safeNum(form.previousArrears);
    const paid = Math.min(safeNum(form.paidAmount), payable);
    return { gross, net, payable, paid, balance: Math.max(0, payable - paid) };
  }, [form]);
  const submit = async (e) => {
    e.preventDefault();
    if (!form.from || !form.to || dayjs(form.from).isAfter(dayjs(form.to))) { toast.error("Enter a valid payroll period."); return; }
    if (numbers.some((name) => safeNum(form[name], -1) < 0)) { toast.error("Amounts cannot be negative."); return; }
    setSaving(true);
    try { await onSave({ ...form, ...computed }); }
    catch (err) { toast.error(errMsg(err, "Failed to update payroll record.")); }
    finally { setSaving(false); }
  };
  const inputs = [
    ["totalHours", "Days / units"], ["hourlyRate", "Daily rate"], ["fixedAmount", "Fixed amount"],
    ["allowances", "Allowances"], ["deductions", "Deductions"], ["previousArrears", "Previous arrears"], ["paidAmount", "Paid amount"],
  ];
  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <form onSubmit={submit} className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Pencil className="w-5 h-5 text-indigo-600" />
          <div><h3 className="font-semibold text-slate-900">Edit payroll record</h3><p className="text-xs text-slate-500">{form.displayName || form.userId}</p></div>
          <button type="button" onClick={onClose} className="ml-auto w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <EditField label="From" type="date" value={form.from} onChange={(v) => set("from", v)} />
            <EditField label="To" type="date" value={form.to} onChange={(v) => set("to", v)} />
            {inputs.map(([name, label]) => <EditField key={name} label={label} type="number" value={form[name]} onChange={(v) => set(name, v)} />)}
          </div>
          <label className="block text-xs font-semibold text-slate-600">Payment notes<textarea value={form.paymentNotes} onChange={(e) => set("paymentNotes", e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-indigo-200" /></label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <PreviewBox label="Gross" value={formatINR(computed.gross)} accent="slate" />
            <PreviewBox label="Net" value={formatINR(computed.net)} accent="emerald" />
            <PreviewBox label="Payable" value={formatINR(computed.payable)} accent="indigo" />
            <PreviewBox label="Balance" value={formatINR(computed.balance)} accent="rose" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes</button>
        </div>
      </form>
    </div>
  );
}

function EditField({ label, type, value, onChange }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}<input type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} value={value} onChange={(e) => onChange(e.target.value)} required className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200" /></label>;
}

/* ============================================================================
 *  Bulk run modal
 * ========================================================================= */
function BulkRunModal({ onClose, staff, allSettings, fromDate, toDate, calculateFor, persistRun, onDone, toast }) {
  const [selected, setSelected] = useState(() => {
    const set = new Set();
    for (const u of staff) {
      const id = u.id || u.userId;
      const s = allSettings.find((x) => x.userId === id);
      if (s && s.isActive !== false) set.add(id);
    }
    return set;
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSel = staff.length > 0 && selected.size === staff.length;
  const toggleAll = () => {
    if (allSel) setSelected(new Set());
    else setSelected(new Set(staff.map((u) => u.id || u.userId)));
  };

  const run = async () => {
    if (selected.size === 0) { toast.error("Select at least one staff."); return; }
    setRunning(true);
    setResults([]);
    let i = 0;
    const out = [];
    for (const id of selected) {
      i++;
      const u = staff.find((s) => (s.id || s.userId) === id);
      const name = u?.displayName || u?.fullName || u?.username || id;
      try {
        const settings = allSettings.find((s) => s.userId === id);
        const res = await calculateFor(id, settings);
        const created = await persistRun(res);
        out.push({ id, name, ok: true, net: created?.payableAmount ?? res.payableAmount ?? res.netAmount });
      } catch (err) {
        out.push({ id, name, ok: false, error: errMsg(err) });
      }
      setProgress(Math.round((i / selected.size) * 100));
      setResults([...out]);
    }
    setRunning(false);
    const ok = out.filter((r) => r.ok).length;
    const fail = out.length - ok;
    if (ok) toast.success(`Bulk run complete — ${ok} processed${fail ? `, ${fail} failed` : ""}.`);
    else if (fail) toast.error(`All ${fail} runs failed.`);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[190] bg-slate-900/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-500" />
          <h3 className="text-base font-semibold text-slate-900">Bulk payroll run</h3>
          <button onClick={onClose} className="ml-auto w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="text-sm text-slate-700">
            Period: <strong>{dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}</strong>
          </div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            Each selected staff member will have their attendance + setup pulled and a snapshot saved.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">{selected.size} of {staff.length} selected</span>
            <button onClick={toggleAll}
              className="text-xs rounded-lg border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-50">
              {allSel ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="space-y-1">
            {staff.map((u) => {
              const id = u.id || u.userId;
              const name = u.displayName || u.fullName || u.username || u.email || id;
              const sSetup = allSettings.find((x) => x.userId === id);
              const result = results.find((r) => r.id === id);
              return (
                <div key={id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)}
                    disabled={running}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    {initials(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{name}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {sSetup
                        ? `Fixed ${formatINR(sSetup.monthlyFixedAmount)} · ${formatINR(sSetup.hourlyRate)}/day`
                        : "No payroll setup"}
                    </div>
                  </div>
                  {result && (
                    result.ok
                      ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {formatINR(result.net)}
                        </span>
                      : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700" title={result.error}>
                          <AlertCircle className="w-3.5 h-3.5" /> Failed
                        </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {running && (
          <div className="px-5 py-2 bg-violet-50">
            <div className="flex items-center justify-between text-[12px] font-semibold text-violet-800 mb-1">
              <span>Running…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-violet-200 overflow-hidden">
              <div className="h-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} disabled={running}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Close
          </button>
          <button onClick={run} disabled={running || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold shadow-sm">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Run for {selected.size || "?"}
          </button>
        </div>
      </div>
    </div>
  );
}
