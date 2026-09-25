// src/pages/CostsPage.jsx
//
// Modern accounting dashboard. Same API endpoints as before
// (/api/accounting/{accounts,balances,ledger,pnl,journal,opening-balance}),
// rebuilt with proper React patterns: controlled forms, toast system,
// confirm modals, charts, tabbed views, date presets, search/filter.
//
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import axios from "axios";
import { API_BASE } from "../api";
import { getToken } from "../utils/auth";
import dayjs from "dayjs";
import {
  LayoutDashboard,
  BookOpen,
  Layers,
  BarChart3,
  FileSpreadsheet,
  Plus,
  Printer,
  Download,
  Upload,
  Loader2,
  X,
  Search,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  CheckCircle2,
  AlertCircle,
  Info,
  Pencil,
  Trash2,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Building2,
  PieChart as PieIcon,
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/* ======================================================================== */
/*  Helpers                                                                  */
/* ======================================================================== */

// Rupee symbol via String.fromCharCode keeps source pure ASCII so the glyph
// survives any UTF-8 / Windows-1252 mishap during build.
const RUPEE = String.fromCharCode(0x20b9);

const formatINR = (value) => {
  const num = Number(value);
  const formatted = Number.isFinite(num)
    ? new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num)
    : "0.00";
  return `${RUPEE} ${formatted}`;
};

const formatINRCompact = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return `${RUPEE} 0`;
  if (Math.abs(num) >= 10000000) return `${RUPEE} ${(num / 10000000).toFixed(2)}Cr`;
  if (Math.abs(num) >= 100000) return `${RUPEE} ${(num / 100000).toFixed(2)}L`;
  if (Math.abs(num) >= 1000) return `${RUPEE} ${(num / 1000).toFixed(1)}K`;
  return `${RUPEE} ${num.toFixed(0)}`;
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

const errMsg = (err, fallback = "Something went wrong.") =>
  err?.response?.data?.message ||
  (typeof err?.response?.data === "string" ? err.response.data : null) ||
  err?.message ||
  fallback;

const ACCOUNTING_API = `${String(API_BASE || "/api").replace(/\/+$/, "")}/accounting`;

const accountingUrl = (path = "") => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${ACCOUNTING_API}${normalized}`;
};

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
};

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const authConfig = (config = {}) => {
  const token = getToken();
  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
};

const ACCOUNT_TYPE_META = {
  ASSET:     { label: "Assets",      tone: "emerald", icon: Wallet },
  LIABILITY: { label: "Liabilities", tone: "rose",    icon: CreditCard },
  INCOME:    { label: "Income",      tone: "blue",    icon: TrendingUp },
  EXPENSE:   { label: "Expenses",    tone: "amber",   icon: TrendingDown },
  EQUITY:    { label: "Equity",      tone: "violet",  icon: Building2 },
};

const TONE_CLASSES = {
  emerald: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "text-emerald-600", bg: "bg-emerald-500" },
  rose:    { chip: "bg-rose-50 text-rose-700 border-rose-200",          text: "text-rose-600",    bg: "bg-rose-500" },
  blue:    { chip: "bg-blue-50 text-blue-700 border-blue-200",          text: "text-blue-600",    bg: "bg-blue-500" },
  amber:   { chip: "bg-amber-50 text-amber-700 border-amber-200",       text: "text-amber-600",   bg: "bg-amber-500" },
  violet:  { chip: "bg-violet-50 text-violet-700 border-violet-200",    text: "text-violet-600",  bg: "bg-violet-500" },
  slate:   { chip: "bg-slate-50 text-slate-700 border-slate-200",       text: "text-slate-600",   bg: "bg-slate-500" },
};

const CHART_COLORS = ["#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

/* ======================================================================== */
/*  Toast system                                                             */
/* ======================================================================== */

const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((type, message, ttl = 3500) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    if (ttl > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    }
    return id;
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Each toast helper is its own useCallback so consumers can put it
  // in a useCallback / useEffect dependency array without triggering a
  // re-render loop.
  const success = useCallback((m, ttl) => push("success", m, ttl), [push]);
  const error = useCallback((m, ttl) => push("error", m, ttl ?? 5000), [push]);
  const info = useCallback((m, ttl) => push("info", m, ttl), [push]);

  return { toasts, success, error, info, dismiss };
};

const ToastStack = ({ toasts, onDismiss }) => (
  <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-[min(92vw,360px)]">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`flex items-start gap-2 rounded-xl border px-3 py-2 shadow-lg backdrop-blur bg-white/95 text-xs ${
          t.type === "success" ? "border-emerald-200 text-emerald-800"
          : t.type === "error" ? "border-red-200 text-red-800"
          : "border-slate-200 text-slate-800"
        }`}
        role="status"
      >
        {t.type === "success" ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
         : t.type === "error" ? <AlertCircle className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />
         : <Info className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />}
        <div className="flex-1 leading-snug">{t.message}</div>
        <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
  </div>
);

/* ======================================================================== */
/*  Confirm modal                                                            */
/* ======================================================================== */

const ConfirmModal = ({ open, title, body, onConfirm, onCancel, danger }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[180] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
         onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onConfirm}
                  className={`rounded-xl px-3 py-2 text-xs font-medium text-white ${
                    danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-500 hover:bg-amber-600"
                  }`}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

/* ======================================================================== */
/*  Main page                                                                */
/* ======================================================================== */

export default function CostsPage() {
  // Pull individual toast helpers; each is a stable useCallback inside.
  // useToasts, so depending on them in our own useCallbacks/useEffects
  // does NOT cause a render loop.
  const { toasts, success: toastSuccess, error: toastError, info: toastInfo, dismiss: toastDismiss } = useToasts();

  // Data
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [trialBalance, setTrialBalance] = useState(null);
  const [pnlSeries, setPnlSeries] = useState([]); // last 6 months for chart

  // UI state
  const [view, setView] = useState("dashboard"); // dashboard | transactions | accounts | reports
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filters
  const today = dayjs();
  const financialYearStartYear = today.month() >= 3 ? today.year() : today.year() - 1;
  const financialYearStart = dayjs(`${financialYearStartYear}-04-01`);
  const financialYearEnd = financialYearStart.add(1, "year").subtract(1, "day");
  const [fromDate, setFromDate] = useState(financialYearStart.format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(financialYearEnd.format("YYYY-MM-DD"));
  const periodParams = useMemo(() => {
    const from = fromDate ? dayjs(fromDate).startOf("day").toISOString() : "";
    const to = toDate ? dayjs(toDate).endOf("day").toISOString() : "";
    return { from, to };
  }, [fromDate, toDate]);
  const periodLabel = useMemo(() => {
    const from = fromDate ? dayjs(fromDate).format("DD MMM YYYY") : "Start";
    const to = toDate ? dayjs(toDate).format("DD MMM YYYY") : "Today";
    return from === to ? from : `${from} - ${to}`;
  }, [fromDate, toDate]);

  // Loading flags
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [loadingPnl, setLoadingPnl] = useState(false);

  // Modals
  const [confirm, setConfirm] = useState(null);
  const [expenseModal, setExpenseModal] = useState(false);
  const [incomeModal, setIncomeModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [manualJournalModal, setManualJournalModal] = useState(false);
  const [journalEditModal, setJournalEditModal] = useState(null);
  const [accountModal, setAccountModal] = useState(false);
  const [openingModal, setOpeningModal] = useState(null); // { accountId, accountName }
  const ledgerAutoPickRef = useRef(false);
  const importFileRef = useRef(null);
  const [importMode, setImportMode] = useState("upsert");
  const [importing, setImporting] = useState(false);

  /* ---------------- API ---------------- */
  const fetchAccountsAndBalances = useCallback(async () => {
    setLoadingAll(true);
    try {
      const balancePath = periodParams.to
        ? `/balances?toDate=${encodeURIComponent(periodParams.to)}`
        : "/balances";
      const [a, b] = await Promise.all([
        axios.get(accountingUrl("/accounts"), authConfig()),
        axios.get(accountingUrl(balancePath), authConfig()),
      ]);
      setAccounts(arrayFrom(a?.data));
      setBalances(arrayFrom(b?.data));
    } catch (e) {
      console.error("Fetch error", e);
      toastError(errMsg(e, "Failed to load accounts."));
    } finally {
      setLoadingAll(false);
    }
  }, [periodParams.to, toastError]);

  // Load 6-month P&L trend on dashboard mount
  const fetchPnlTrend = useCallback(async () => {
    try {
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const m = dayjs().subtract(i, "month");
        months.push({
          label: m.format("MMM"),
          // UTC ISO so Npgsql accepts as timestamptz.
          from: m.startOf("month").toISOString(),
          to: m.endOf("month").toISOString(),
        });
      }
      const series = await Promise.all(
        months.map(async (m) => {
          try {
            const r = await axios.get(
              accountingUrl(`/pnl?fromDate=${encodeURIComponent(m.from)}&toDate=${encodeURIComponent(m.to)}`),
              authConfig()
            );
            return {
              month: m.label,
              income: safeNum(r.data?.income ?? r.data?.totalIncome),
              expense: safeNum(r.data?.expense ?? r.data?.totalExpense),
              net: safeNum(r.data?.net),
            };
          } catch {
            return { month: m.label, income: 0, expense: 0, net: 0 };
          }
        })
      );
      setPnlSeries(series);
    } catch (e) {
      console.warn("PnL trend failed", e);
    }
  }, []);

  useEffect(() => {
    fetchAccountsAndBalances();
    fetchPnlTrend();
  }, [fetchAccountsAndBalances, fetchPnlTrend]);

  // Build query params for date filters. We always emit UTC ISO strings
  // ending in "Z"; bare strings like "2026-04-01T00:00:00" arrive at the
  // backend as DateTime with Kind=Unspecified, which Npgsql refuses to
  // write to a `timestamp with time zone` column.
  // dayjs parses "YYYY-MM-DD" as local midnight; startOf/endOf ensures
  // we cover the whole local day, then toISOString() converts to UTC.
  const periodSlug = useMemo(() => `${fromDate || "start"}-to-${toDate || "today"}`, [fromDate, toDate]);

  const loadLedger = async (account) => {
    setSelectedAccount(account);
    setLoadingLedger(true);
    try {
      const { from, to } = periodParams;
      const res = await axios.get(
        accountingUrl(`/ledger/${account.id}?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`),
        authConfig()
      );
      setLedger(arrayFrom(res?.data));
    } catch (e) {
      toastError(errMsg(e, "Failed to load ledger."));
      setLedger([]);
    } finally {
      setLoadingLedger(false);
    }
  };

  const loadPnl = useCallback(async () => {
    setLoadingPnl(true);
    try {
      const { from, to } = periodParams;
      const [res, bs, tb] = await Promise.all([
        axios.get(
          accountingUrl(`/pnl?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`),
          authConfig()
        ),
        axios.get(accountingUrl(`/balance-sheet?toDate=${encodeURIComponent(to)}`), authConfig()),
        axios.get(accountingUrl(`/trial-balance?toDate=${encodeURIComponent(to)}`), authConfig()),
      ]);
      setPnl({
        income: safeNum(res.data?.income ?? res.data?.totalIncome),
        expense: safeNum(res.data?.expense ?? res.data?.totalExpense),
        net: safeNum(res.data?.net),
        incomeAccounts: arrayFrom(res.data?.incomeAccounts),
        expenseAccounts: arrayFrom(res.data?.expenseAccounts),
      });
      setBalanceSheet(bs?.data || null);
      setTrialBalance(tb?.data || null);
    } catch (e) {
      toastError(errMsg(e, "Failed to load P&L."));
    } finally {
      setLoadingPnl(false);
    }
  }, [periodParams, toastError]);

  // Reload range-sensitive reports whenever the selected period changes.
  useEffect(() => {
    if (view === "dashboard" || view === "reports") loadPnl();
  }, [view, loadPnl]);

  useEffect(() => {
    if (view === "transactions" && selectedAccount) loadLedger(selectedAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodParams.from, periodParams.to, view]);

  // Auto-load default ledger when entering Transactions view
  useEffect(() => {
    if (view !== "transactions" || ledgerAutoPickRef.current || accounts.length === 0) return;
    const activeIds = new Set(
      balances
        .filter((b) => Math.abs(safeNum(b.balance ?? b.rawBalance ?? b.debit ?? b.credit)) > 0.009)
        .map((b) => String(b.accountId))
    );
    const byName = (pattern) => accounts.find((a) => activeIds.has(String(a.id)) && pattern.test(a.name || ""));
    const preferred =
      byName(/cash in hand/i) ||
      byName(/bank/i) ||
      byName(/easter/i) ||
      byName(/rent/i) ||
      accounts.find((a) => activeIds.has(String(a.id))) ||
      accounts.find((a) => a.type === "ASSET") ||
      accounts[0];

    if (preferred) {
      ledgerAutoPickRef.current = true;
      loadLedger(preferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accounts, balances]);

  /* ---------------- Mutations ---------------- */

  const postJournal = async (payload) => {
    await axios.post(accountingUrl("/journal"), payload, authConfig());
  };

  const putJournal = async (entryId, payload) => {
    await axios.put(accountingUrl(`/journal/${entryId}`), payload, authConfig());
  };

  const refreshAfterJournalChange = async () => {
    await fetchAccountsAndBalances();
    if (selectedAccount) await loadLedger(selectedAccount);
    if (view === "dashboard" || view === "reports") await loadPnl();
    fetchPnlTrend();
  };

  const saveExpense = async (form) => {
    try {
      await postJournal({
        date: form.date,
        description: form.description,
        lines: [
          { accountId: Number(form.debitAccountId), debit: safeNum(form.amount), credit: 0 },
          { accountId: Number(form.creditAccountId), debit: 0, credit: safeNum(form.amount) },
        ],
      });
      toastSuccess("Expense recorded.");
      setExpenseModal(false);
      await refreshAfterJournalChange();
    } catch (e) {
      toastError(errMsg(e, "Save failed."));
    }
  };

  const saveIncome = async (form) => {
    try {
      await postJournal({
        date: form.date,
        description: form.description,
        // Income: credit the income account, debit the cash/bank account
        lines: [
          { accountId: Number(form.debitAccountId), debit: safeNum(form.amount), credit: 0 },
          { accountId: Number(form.creditAccountId), debit: 0, credit: safeNum(form.amount) },
        ],
      });
      toastSuccess("Income recorded.");
      setIncomeModal(false);
      await refreshAfterJournalChange();
    } catch (e) {
      toastError(errMsg(e, "Save failed."));
    }
  };

  const saveTransfer = async (form) => {
    try {
      await postJournal({
        date: form.date,
        description: form.description || "Transfer",
        lines: [
          { accountId: Number(form.toAccountId), debit: safeNum(form.amount), credit: 0 },
          { accountId: Number(form.fromAccountId), debit: 0, credit: safeNum(form.amount) },
        ],
      });
      toastSuccess("Transfer posted.");
      setTransferModal(false);
      await refreshAfterJournalChange();
    } catch (e) {
      toastError(errMsg(e, "Save failed."));
    }
  };

  const saveManualJournal = async (form) => {
    try {
      await postJournal({
        date: form.date,
        description: form.description,
        lines: form.lines.map((line) => ({
          accountId: Number(line.accountId),
          debit: safeNum(line.debit),
          credit: safeNum(line.credit),
        })),
      });
      toastSuccess("Journal entry posted.");
      setManualJournalModal(false);
      await refreshAfterJournalChange();
    } catch (e) {
      toastError(errMsg(e, "Journal entry failed."));
    }
  };

  const saveAccount = async (form) => {
    try {
      await axios.post(
        accountingUrl("/accounts"),
        {
          name: form.name.trim(),
          type: form.type,
          code: form.code?.trim() || undefined,
        },
        authConfig()
      );
      toastSuccess("Account created.");
      setAccountModal(false);
      await fetchAccountsAndBalances();
    } catch (e) {
      toastError(errMsg(e, "Failed to create account."));
    }
  };

  const bootstrapAccounts = async () => {
    try {
      const res = await axios.post(accountingUrl("/bootstrap"), {}, authConfig());
      const added = safeNum(res.data?.added);
      toastSuccess(added > 0 ? `Chart of accounts updated (${added} added).` : "Chart of accounts is already ready.");
      await fetchAccountsAndBalances();
    } catch (e) {
      toastError(errMsg(e, "Failed to initialize chart of accounts."));
    }
  };

  const saveOpening = async (form) => {
    try {
      await axios.post(
        accountingUrl("/opening-balance"),
        {
          accountId: form.accountId,
          amount: safeNum(form.amount),
        },
        authConfig()
      );
      toastSuccess("Opening balance saved.");
      setOpeningModal(null);
      await fetchAccountsAndBalances();
    } catch (e) {
      toastError(errMsg(e, "Failed to save opening balance."));
    }
  };

  const editJournalEntry = async (entryId) => {
    if (!entryId) return;
    try {
      const res = await axios.get(accountingUrl(`/journal/${entryId}`), authConfig());
      setJournalEditModal(res.data);
    } catch (e) {
      toastError(errMsg(e, "Could not load transaction for editing."));
    }
  };

  const saveJournalEdit = async (form) => {
    const entryId = journalEditModal?.id || journalEditModal?.Id;
    if (!entryId) return;
    try {
      await putJournal(entryId, {
        date: form.date,
        description: form.description,
        lines: form.lines.map((line) => ({
          accountId: Number(line.accountId),
          debit: safeNum(line.debit),
          credit: safeNum(line.credit),
        })),
      });
      toastSuccess("Transaction updated. Balances and reports recalculated.");
      setJournalEditModal(null);
      await refreshAfterJournalChange();
    } catch (e) {
      toastError(errMsg(e, "Could not update transaction."));
    }
  };

  const deleteJournalEntry = (entryId) => {
    if (!entryId) return;
    setConfirm({
      title: "Delete transaction?",
      body: "This removes the full accounting voucher and recalculates balances and reports. This cannot be undone.",
      danger: true,
      onConfirm: async () => {
        try {
          await axios.delete(accountingUrl(`/journal/${entryId}`), authConfig());
          setConfirm(null);
          toastSuccess("Transaction deleted. Balances and reports recalculated.");
          await refreshAfterJournalChange();
        } catch (e) {
          setConfirm(null);
          toastError(errMsg(e, "Could not delete transaction."));
        }
      },
    });
  };

  /* ---------------- Date presets ---------------- */
  const setPreset = (preset) => {
    const now = dayjs();
    if (preset === "thisMonth") {
      setFromDate(now.startOf("month").format("YYYY-MM-DD"));
      setToDate(now.endOf("month").format("YYYY-MM-DD"));
    } else if (preset === "lastMonth") {
      const m = now.subtract(1, "month");
      setFromDate(m.startOf("month").format("YYYY-MM-DD"));
      setToDate(m.endOf("month").format("YYYY-MM-DD"));
    } else if (preset === "thisYear") {
      setFromDate(now.startOf("year").format("YYYY-MM-DD"));
      setToDate(now.endOf("year").format("YYYY-MM-DD"));
    } else if (preset === "thisQuarter") {
      const q = Math.floor(now.month() / 3);
      setFromDate(now.month(q * 3).startOf("month").format("YYYY-MM-DD"));
      setToDate(now.month(q * 3 + 2).endOf("month").format("YYYY-MM-DD"));
    } else if (preset === "ytd") {
      setFromDate(now.startOf("year").format("YYYY-MM-DD"));
      setToDate(now.format("YYYY-MM-DD"));
    } else if (preset === "lastYear") {
      const y = now.subtract(1, "year");
      setFromDate(y.startOf("year").format("YYYY-MM-DD"));
      setToDate(y.endOf("year").format("YYYY-MM-DD"));
    } else if (preset === "fy") {
      const y = now.month() >= 3 ? now.year() : now.year() - 1;
      setFromDate(dayjs(`${y}-04-01`).format("YYYY-MM-DD"));
      setToDate(dayjs(`${y + 1}-03-31`).format("YYYY-MM-DD"));
    }
  };

  /* ---------------- Computed ---------------- */
  const totalsByType = useMemo(() => {
    const totals = { ASSET: 0, LIABILITY: 0, INCOME: 0, EXPENSE: 0, EQUITY: 0 };
    for (const b of balances) {
      const t = b.type || accounts.find((a) => a.id === b.accountId)?.type;
      if (totals[t] !== undefined) totals[t] += safeNum(b.balance);
    }
    return totals;
  }, [balances, accounts]);

  const cashAndBank = useMemo(() => {
    return balances
      .filter((b) => {
        const acc = accounts.find((a) => a.id === b.accountId);
        const isAsset = (b.type || acc?.type) === "ASSET";
        const name = (b.accountName || acc?.name || "").toLowerCase();
        return isAsset && (name.includes("cash") || name.includes("bank"));
      })
      .reduce((s, b) => s + safeNum(b.balance), 0);
  }, [balances, accounts]);

  const expenseBreakdown = useMemo(() => {
    const periodExpenses = arrayFrom(pnl?.expenseAccounts)
      .map((row) => ({
        name: row.accountName || row.AccountName || "Expense",
        value: safeNum(row.amount ?? row.Amount),
      }))
      .filter((row) => row.value > 0)
      .sort((x, y) => y.value - x.value)
      .slice(0, 6);

    if (periodExpenses.length > 0) return periodExpenses;

    const data = balances
      .filter((b) => {
        const t = b.type || accounts.find((a) => a.id === b.accountId)?.type;
        return t === "EXPENSE" && safeNum(b.balance) > 0;
      })
      .map((b) => ({
        name: b.accountName || accounts.find((a) => a.id === b.accountId)?.name || "—",
        value: safeNum(b.balance),
      }))
      .sort((x, y) => y.value - x.value)
      .slice(0, 6);
    return data;
  }, [pnl, balances, accounts]);

  const filteredLedger = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter(
      (l) =>
        (l.description || "").toLowerCase().includes(q) ||
        String(l.debit || "").includes(q) ||
        String(l.credit || "").includes(q)
    );
  }, [ledger, searchQuery]);

  const downloadLedgerCsv = () => {
    if (!selectedAccount || filteredLedger.length === 0) {
      toastInfo("Pick an account with ledger entries first.");
      return;
    }
    const rows = [
      ["Date", "JournalEntryId", "Description", "Debit", "Credit", "Balance"],
      ...filteredLedger.map((l) => [
        dayjs(l.date || l.Date).format("YYYY-MM-DD"),
        l.journalEntryId || l.JournalEntryId || "",
        l.description || l.Description || "",
        safeNum(l.debit ?? l.Debit).toFixed(2),
        safeNum(l.credit ?? l.Credit).toFixed(2),
        safeNum(l.balance ?? l.Balance).toFixed(2),
      ]),
    ];
    downloadCsv(`${selectedAccount.name || "account"}-ledger-${fromDate}-to-${toDate}.csv`, rows);
  };

  const downloadDetailedTransactionsCsv = async () => {
    try {
      const { from, to } = periodParams;
      const res = await axios.get(
        accountingUrl(`/journal?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}&take=10000`),
        authConfig()
      );
      const entries = arrayFrom(res.data?.items);
      const rows = [
        ["Date", "JournalEntryId", "Narration", "AccountId", "AccountName", "AccountType", "Debit", "Credit", "VoucherDebitTotal", "VoucherCreditTotal"],
      ];
      for (const entry of entries) {
        const lines = arrayFrom(entry.lines);
        for (const line of lines) {
          rows.push([
            dayjs(entry.date).format("YYYY-MM-DD"),
            entry.id,
            entry.description,
            line.accountId,
            line.accountName,
            line.accountType,
            safeNum(line.debit).toFixed(2),
            safeNum(line.credit).toFixed(2),
            safeNum(entry.totalDebit).toFixed(2),
            safeNum(entry.totalCredit).toFixed(2),
          ]);
        }
      }
      downloadCsv(`accounting-detail-transactions-${periodSlug}.csv`, rows);
      toastSuccess(`Detail transaction report exported (${rows.length - 1} lines).`);
    } catch (e) {
      toastError(errMsg(e, "Failed to export detailed transaction report."));
    }
  };

  const downloadPnlCsv = async () => {
    try {
      const { from, to } = periodParams;
      const res = await axios.get(
        accountingUrl(`/pnl?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`),
        authConfig()
      );
      const data = res.data || {};
      const rows = [
        ["Section", "AccountId", "AccountName", "Amount"],
        ...arrayFrom(data.incomeAccounts).map((row) => ["Income", row.accountId, row.accountName, safeNum(row.amount).toFixed(2)]),
        ["Income Total", "", "", safeNum(data.income ?? data.totalIncome).toFixed(2)],
        ...arrayFrom(data.expenseAccounts).map((row) => ["Expense", row.accountId, row.accountName, safeNum(row.amount).toFixed(2)]),
        ["Expense Total", "", "", safeNum(data.expense ?? data.totalExpense).toFixed(2)],
        ["Net Surplus / Deficit", "", "", safeNum(data.net).toFixed(2)],
      ];
      downloadCsv(`accounting-pnl-${periodSlug}.csv`, rows);
      toastSuccess("P&L exported.");
    } catch (e) {
      toastError(errMsg(e, "Failed to export P&L."));
    }
  };

  const downloadBalanceSheetCsv = async () => {
    try {
      const { to } = periodParams;
      const res = await axios.get(accountingUrl(`/balance-sheet?toDate=${encodeURIComponent(to)}`), authConfig());
      const data = res.data || {};
      const rows = [["Section", "AccountId", "AccountName", "Amount"]];
      arrayFrom(data.assets).forEach((row) => rows.push(["Assets", row.accountId, row.accountName, safeNum(row.balance).toFixed(2)]));
      rows.push(["Total Assets", "", "", safeNum(data.totalAssets).toFixed(2)]);
      arrayFrom(data.liabilities).forEach((row) => rows.push(["Liabilities", row.accountId, row.accountName, safeNum(row.balance).toFixed(2)]));
      rows.push(["Total Liabilities", "", "", safeNum(data.totalLiabilities).toFixed(2)]);
      arrayFrom(data.equityAccounts).forEach((row) => rows.push(["Equity", row.accountId, row.accountName, safeNum(row.balance).toFixed(2)]));
      rows.push(["Current Year Surplus / Deficit", "", "", safeNum(data.currentYearSurplus).toFixed(2)]);
      rows.push(["Total Equity", "", "", safeNum(data.totalEquity).toFixed(2)]);
      rows.push(["Liabilities + Equity", "", "", safeNum(data.liabilitiesAndEquity).toFixed(2)]);
      rows.push(["Difference", "", "", safeNum(data.difference).toFixed(2)]);
      downloadCsv(`accounting-balance-sheet-${periodSlug}.csv`, rows);
      toastSuccess("Balance sheet exported.");
    } catch (e) {
      toastError(errMsg(e, "Failed to export balance sheet."));
    }
  };

  const downloadTrialBalanceCsv = async () => {
    try {
      const { to } = periodParams;
      const res = await axios.get(accountingUrl(`/trial-balance?toDate=${encodeURIComponent(to)}`), authConfig());
      const data = res.data || {};
      const rows = [
        ["AccountId", "Account", "Type", "Debit", "Credit", "NaturalBalance"],
        ...arrayFrom(data.accounts).map((row) => [
          row.accountId ?? row.AccountId,
          row.account ?? row.Account,
          row.type ?? row.Type,
          safeNum(row.debit ?? row.Debit).toFixed(2),
          safeNum(row.credit ?? row.Credit).toFixed(2),
          safeNum(row.balance ?? row.Balance).toFixed(2),
        ]),
        ["", "TOTAL", "", safeNum(data.totalDebit).toFixed(2), safeNum(data.totalCredit).toFixed(2), ""],
      ];
      downloadCsv(`accounting-trial-balance-${periodSlug}.csv`, rows);
      toastSuccess("Trial balance exported.");
    } catch (e) {
      toastError(errMsg(e, "Failed to export trial balance."));
    }
  };

  const downloadAllGlCsv = async () => {
    try {
      const { from, to } = periodParams;
      const activeAccounts = accounts.filter((account) => {
        const bal = balances.find((b) => String(b.accountId) === String(account.id));
        return Math.abs(safeNum(bal?.balance ?? bal?.rawBalance ?? bal?.debit ?? bal?.credit)) > 0.009;
      });
      const exportAccounts = activeAccounts.length ? activeAccounts : accounts;
      const results = await Promise.all(
        exportAccounts.map(async (account) => {
          const res = await axios.get(
            accountingUrl(`/ledger/${account.id}?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`),
            authConfig()
          );
          return { account, lines: arrayFrom(res.data?.items) };
        })
      );
      const rows = [["AccountId", "AccountName", "AccountType", "Date", "JournalEntryId", "Description", "Debit", "Credit", "RunningBalance"]];
      for (const result of results) {
        for (const line of result.lines) {
          rows.push([
            result.account.id,
            result.account.name,
            result.account.type,
            dayjs(line.date).format("YYYY-MM-DD"),
            line.journalEntryId,
            line.description,
            safeNum(line.debit).toFixed(2),
            safeNum(line.credit).toFixed(2),
            safeNum(line.balance).toFixed(2),
          ]);
        }
      }
      downloadCsv(`accounting-general-ledger-${periodSlug}.csv`, rows);
      toastSuccess(`General ledger exported (${rows.length - 1} lines).`);
    } catch (e) {
      toastError(errMsg(e, "Failed to export general ledger."));
    }
  };

  const printLedger = () => {
    if (!selectedAccount) {
      toastInfo("Pick an account first.");
      return;
    }
    window.print();
  };

  const handlePdf = async () => {
    const { from, to } = periodParams;
    try {
      const res = await axios.get(
        accountingUrl(`/pnl/pdf?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`),
        authConfig({ responseType: "blob" })
      );
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      toastError(errMsg(e, "Failed to download P&L PDF."));
    }
  };

  const downloadImportTemplate = async () => {
    try {
      const res = await axios.get(accountingUrl("/import-template"), authConfig({ responseType: "blob" }));
      downloadBlob("mahima_accounting_import_template.csv", new Blob([res.data], { type: "text/csv;charset=utf-8" }));
    } catch (e) {
      toastError(errMsg(e, "Failed to download accounting import template."));
    }
  };

  const downloadJournalExport = async () => {
    const { from, to } = periodParams;
    try {
      const res = await axios.get(
        accountingUrl(`/export?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`),
        authConfig({ responseType: "blob" })
      );
      downloadBlob(`mahima_accounting_journal_${periodSlug}.csv`, new Blob([res.data], { type: "text/csv;charset=utf-8" }));
      toastSuccess("Journal export downloaded.");
    } catch (e) {
      toastError(errMsg(e, "Failed to download accounting export."));
    }
  };

  const importAccountingCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", importMode);

      const res = await axios.post(accountingUrl("/import"), form, authConfig());
      const data = res.data || {};
      toastSuccess(
        `Import complete. Inserted ${data.inserted || 0}, updated ${data.updated || 0}, deleted ${data.deleted || 0}, skipped ${data.skipped || 0}.`,
        6500
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        toastInfo(data.errors.slice(0, 2).join(" | "), 9000);
      }
      await fetchAccountsAndBalances();
      if (selectedAccount) await loadLedger(selectedAccount);
      if (view === "dashboard" || view === "reports") await loadPnl();
    } catch (e) {
      toastError(errMsg(e, "Failed to import accounting CSV."));
    } finally {
      setImporting(false);
      if (event.target) event.target.value = "";
    }
  };

  /* ---------------- Render ---------------- */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-amber-50/40 px-3 sm:px-6 py-4 sm:py-6">
      <ToastStack toasts={toasts} onDismiss={toastDismiss} />
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        danger={confirm?.danger}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* Header */}
      <header className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500 text-white shadow-sm">
              <Receipt className="w-5 h-5" />
            </span>
            Accounting
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 ml-11">
            Professional double-entry books with journals, ledgers, trial balance, P&L, and balance sheet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={bootstrapAccounts} className="btn-secondary">
            <Layers className="w-4 h-4" /> Setup COA
          </button>
          <button onClick={() => setManualJournalModal(true)} className="btn-secondary">
            <BookOpen className="w-4 h-4" /> Journal
          </button>
          <button onClick={() => setExpenseModal(true)} className="btn-primary">
            <ArrowDownRight className="w-4 h-4" /> Expense
          </button>
          <button onClick={() => setIncomeModal(true)} className="btn-success">
            <ArrowUpRight className="w-4 h-4" /> Income
          </button>
          <button onClick={() => setTransferModal(true)} className="btn-secondary">
            <ArrowLeftRight className="w-4 h-4" /> Transfer
          </button>
          <button onClick={() => setAccountModal(true)} className="btn-secondary">
            <Plus className="w-4 h-4" /> Account
          </button>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-1 md:grid-cols-4 gap-2">
        {[
          ["Double-entry control", "Every voucher must balance debits and credits."],
          ["India-ready structure", "Chart of accounts grouped for ASSET, LIABILITY, EQUITY, INCOME, EXPENSE."],
          ["Audit trail", "Journal lines feed every ledger and report."],
          ["Finance reports", "Trial balance, profit and loss, balance sheet, ledger export, and PDF."],
        ].map(([title, text]) => (
          <div key={title} className="rounded-2xl border border-amber-100 bg-white/80 p-3 shadow-sm">
            <div className="text-xs font-semibold text-slate-900">{title}</div>
            <div className="mt-1 text-[11px] leading-snug text-slate-500">{text}</div>
          </div>
        ))}
      </section>

      {/* Period bar */}
      <section className="mb-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        <CalendarIcon className="w-4 h-4 text-amber-500" />
        <span className="text-xs text-slate-500 mr-2">Period</span>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input-sm" />
        <span className="text-xs text-slate-400">to</span>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input-sm" />
        <div className="flex flex-wrap gap-1 ml-auto">
          {[
            { id: "fy", label: `FY ${financialYearStartYear}-${String(financialYearStartYear + 1).slice(-2)}` },
            { id: "thisMonth", label: "This month" },
            { id: "lastMonth", label: "Last month" },
            { id: "thisQuarter", label: "This quarter" },
            { id: "thisYear", label: "This year" },
            { id: "ytd", label: "YTD" },
            { id: "lastYear", label: "Last year" },
          ].map((p) => (
            <button key={p.id} onClick={() => setPreset(p.id)} className="chip">
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-2">
          <button onClick={fetchAccountsAndBalances} title="Refresh" className="icon-btn">
            <RefreshCw className={`w-4 h-4 ${loadingAll ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => window.print()} title="Print" className="icon-btn">
            <Printer className="w-4 h-4" />
          </button>
          <button onClick={handlePdf} title="P&L PDF" className="icon-btn">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </section>

      <section className="mb-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          Import / Export
        </span>
        <select
          value={importMode}
          onChange={(e) => setImportMode(e.target.value)}
          className="input-sm min-w-[130px]"
          title="CSV import mode"
        >
          <option value="upsert">Upsert</option>
          <option value="insert">Insert</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>
        <input
          ref={importFileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={importAccountingCsv}
        />
        <button onClick={downloadImportTemplate} className="btn-secondary">
          <Download className="w-4 h-4" />
          Template
        </button>
        <button onClick={downloadJournalExport} className="btn-secondary">
          <Download className="w-4 h-4" />
          Export Journal
        </button>
        <button
          onClick={() => importFileRef.current?.click()}
          disabled={importing}
          className="btn-primary"
        >
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Import CSV
        </button>
        <p className="text-xs font-semibold text-slate-500">
          Template supports insert, update, upsert, and delete journal vouchers.
        </p>
      </section>

      {/* Tabs */}
      <nav className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-white border border-slate-200 shadow-sm p-1 w-fit">
        {[
          { id: "dashboard",    label: "Dashboard",    icon: LayoutDashboard },
          { id: "transactions", label: "Transactions", icon: BookOpen },
          { id: "accounts",     label: "Accounts",     icon: Layers },
          { id: "reports",      label: "Reports",      icon: BarChart3 },
        ].map((t) => (
          <button key={t.id}
                  onClick={() => setView(t.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 transition ${
                    view === t.id
                      ? "bg-amber-500 text-white shadow"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </nav>

      {/* Views */}
      {view === "dashboard" && (
        <DashboardView
          totalsByType={totalsByType}
          cashAndBank={cashAndBank}
          balances={balances}
          accounts={accounts}
          periodPnl={pnl}
          periodLabel={periodLabel}
          pnlSeries={pnlSeries}
          expenseBreakdown={expenseBreakdown}
          loading={loadingAll || loadingPnl}
          onCardClick={(type) => {
            if (type === "EXPENSE") setExpenseModal(true);
            else if (type === "INCOME") setIncomeModal(true);
            else setView("accounts");
          }}
        />
      )}

      {view === "transactions" && (
        <TransactionsView
          accounts={accounts}
          balances={balances}
          selectedAccount={selectedAccount}
          ledger={filteredLedger}
          ledgerTotal={ledger.length}
          loading={loadingLedger}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAccountSelect={loadLedger}
          onDownloadCsv={downloadLedgerCsv}
          onPrintLedger={printLedger}
          onEditEntry={editJournalEntry}
          onDeleteEntry={deleteJournalEntry}
        />
      )}

      {view === "accounts" && (
        <AccountsView
          accounts={accounts}
          balances={balances}
          loading={loadingAll}
          onSetOpening={(b) => setOpeningModal(b)}
        />
      )}

      {view === "reports" && (
        <ProfessionalReportsView
          pnl={pnl}
          balanceSheet={balanceSheet}
          trialBalance={trialBalance}
          balances={balances}
          accounts={accounts}
          totalsByType={totalsByType}
          pnlSeries={pnlSeries}
          loading={loadingPnl}
          onDownloadPdf={handlePdf}
          onExportTransactions={downloadDetailedTransactionsCsv}
          onExportPnl={downloadPnlCsv}
          onExportBalanceSheet={downloadBalanceSheetCsv}
          onExportTrialBalance={downloadTrialBalanceCsv}
          onExportGl={downloadAllGlCsv}
          onPrint={() => window.print()}
        />
      )}

      {/* Modals */}
      {expenseModal && (
        <JournalEntryModal
          mode="expense"
          accounts={accounts}
          onCancel={() => setExpenseModal(false)}
          onSave={saveExpense}
        />
      )}
      {incomeModal && (
        <JournalEntryModal
          mode="income"
          accounts={accounts}
          onCancel={() => setIncomeModal(false)}
          onSave={saveIncome}
        />
      )}
      {transferModal && (
        <TransferModal
          accounts={accounts}
          onCancel={() => setTransferModal(false)}
          onSave={saveTransfer}
        />
      )}
      {manualJournalModal && (
        <ManualJournalModal
          accounts={accounts}
          onCancel={() => setManualJournalModal(false)}
          onSave={saveManualJournal}
        />
      )}
      {journalEditModal && (
        <ManualJournalModal
          accounts={accounts}
          initialEntry={journalEditModal}
          title="Edit transaction"
          submitLabel="Save changes"
          onCancel={() => setJournalEditModal(null)}
          onSave={saveJournalEdit}
        />
      )}
      {accountModal && (
        <AccountModal
          onCancel={() => setAccountModal(false)}
          onSave={saveAccount}
        />
      )}
      {openingModal && (
        <OpeningBalanceModal
          row={openingModal}
          onCancel={() => setOpeningModal(null)}
          onSave={saveOpening}
        />
      )}

      {/* Local utility classes */}
      <style>{`
        .input-sm{ width:auto; border-radius:0.5rem; border:1px solid rgb(226,232,240); background:#fff; padding:0.35rem 0.6rem; font-size:12px; outline:none; }
        .input-sm:focus{ border-color:rgb(245,158,11); box-shadow:0 0 0 1px rgb(245,158,11); }
        .input{ width:100%; border-radius:0.625rem; border:1px solid rgb(226,232,240); background:#fff; padding:0.5rem 0.75rem; font-size:13px; outline:none; }
        .input:focus{ border-color:rgb(245,158,11); box-shadow:0 0 0 1px rgb(245,158,11); }
        .chip{ font-size:11px; padding:0.25rem 0.65rem; border-radius:9999px; border:1px solid rgb(226,232,240); background:#fff; color:rgb(71,85,105); cursor:pointer; }
        .chip:hover{ background:rgb(254,243,199); border-color:rgb(252,211,77); color:rgb(146,64,14); }
        .icon-btn{ width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border:1px solid rgb(226,232,240); background:#fff; border-radius:0.5rem; color:rgb(71,85,105); }
        .icon-btn:hover{ background:rgb(248,250,252); }
        .btn-primary{ display:inline-flex; align-items:center; gap:0.4rem; padding:0.45rem 0.8rem; font-size:12px; font-weight:600; background:rgb(245,158,11); color:#fff; border-radius:0.625rem; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .btn-primary:hover{ background:rgb(217,119,6); }
        .btn-success{ display:inline-flex; align-items:center; gap:0.4rem; padding:0.45rem 0.8rem; font-size:12px; font-weight:600; background:rgb(16,185,129); color:#fff; border-radius:0.625rem; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .btn-success:hover{ background:rgb(5,150,105); }
        .btn-secondary{ display:inline-flex; align-items:center; gap:0.4rem; padding:0.45rem 0.8rem; font-size:12px; font-weight:600; background:#fff; color:rgb(71,85,105); border-radius:0.625rem; border:1px solid rgb(226,232,240); }
        .btn-secondary:hover{ background:rgb(248,250,252); }
        .panel{ background:#fff; border:1px solid rgb(226,232,240); border-radius:1rem; box-shadow:0 1px 2px rgba(15,23,42,0.04); }
      `}</style>
    </div>
  );
}

/* ======================================================================== */
/*  Dashboard view                                                           */
/* ======================================================================== */

function DashboardView({ totalsByType, cashAndBank, balances, accounts, periodPnl, periodLabel, pnlSeries, expenseBreakdown, loading, onCardClick }) {
  const selectedIncome = safeNum(periodPnl?.income ?? periodPnl?.totalIncome);
  const selectedExpense = safeNum(periodPnl?.expense ?? periodPnl?.totalExpense);
  const selectedNet = safeNum(periodPnl?.net);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* KPI cards row */}
      <div className="lg:col-span-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Cash & Bank"
          value={formatINR(cashAndBank)}
          icon={<Wallet className="w-4 h-4" />}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          label={`Income (${periodLabel})`}
          value={formatINR(selectedIncome)}
          deltaPositive
          icon={<TrendingUp className="w-4 h-4" />}
          tone="blue"
          loading={loading}
          onClick={() => onCardClick("INCOME")}
        />
        <KpiCard
          label={`Expense (${periodLabel})`}
          value={formatINR(selectedExpense)}
          icon={<TrendingDown className="w-4 h-4" />}
          tone="amber"
          loading={loading}
          onClick={() => onCardClick("EXPENSE")}
        />
        <KpiCard
          label={`Net (${periodLabel})`}
          value={formatINR(selectedNet)}
          icon={<BarChart3 className="w-4 h-4" />}
          tone={selectedNet >= 0 ? "emerald" : "rose"}
          loading={loading}
        />
      </div>

      {/* 6-month trend */}
      <div className="lg:col-span-2 panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-900">Income vs Expense — last 6 months</h3>
        </div>
        <div className="h-64">
          {pnlSeries.length === 0 ? (
            <SkeletonBlock />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pnlSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={formatINRCompact} />
                <Tooltip
                  formatter={(v) => formatINR(v)}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                <Area type="monotone" dataKey="expense" stroke="#f59e0b" fill="url(#expenseGrad)" strokeWidth={2} name="Expense" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top expense categories */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <PieIcon className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-900">Top expense categories</h3>
        </div>
        <div className="h-64">
          {expenseBreakdown.length === 0 ? (
            <EmptyState message="No expense data yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expenseBreakdown}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {expenseBreakdown.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatINR(v)}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-2 space-y-1">
          {expenseBreakdown.map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="text-slate-700 truncate max-w-[140px]">{c.name}</span>
              </span>
              <span className="text-slate-900 font-medium tabular-nums">{formatINR(c.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Account balances strip */}
      <div className="lg:col-span-3 panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Account balances</h3>
          <span className="text-xs text-slate-500">{balances.length} accounts</span>
        </div>
        {loading ? (
          <SkeletonBlock />
        ) : balances.length === 0 ? (
          <EmptyState message="No accounts yet — add one to get started." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {balances.map((b) => {
              const acc = accounts.find((a) => a.id === b.accountId);
              const type = b.type || acc?.type;
              const meta = ACCOUNT_TYPE_META[type] || { label: type, tone: "slate", icon: Wallet };
              const Icon = meta.icon;
              const tone = TONE_CLASSES[meta.tone] || TONE_CLASSES.slate;
              return (
                <div key={b.accountId} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 border ${tone.chip}`}>
                        <Icon className="w-3 h-3" /> {meta.label}
                      </div>
                      <div className="mt-1 text-xs text-slate-700 truncate" title={b.accountName || acc?.name}>
                        {b.accountName || acc?.name}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">{formatINR(b.balance)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Transactions view                                                        */
/* ======================================================================== */

function TransactionsView({
  accounts,
  balances,
  selectedAccount,
  ledger,
  ledgerTotal,
  loading,
  searchQuery,
  onSearchChange,
  onAccountSelect,
  onDownloadCsv,
  onPrintLedger,
  onEditEntry,
  onDeleteEntry,
}) {
  const totals = useMemo(() => {
    return ledger.reduce(
      (acc, l) => ({
        debit: acc.debit + safeNum(l.debit),
        credit: acc.credit + safeNum(l.credit),
      }),
      { debit: 0, credit: 0 }
    );
  }, [ledger]);

  const endingBalance = useMemo(() => {
    const last = ledger[ledger.length - 1];
    return safeNum(last?.balance ?? last?.Balance);
  }, [ledger]);

  const balanceByAccount = useMemo(() => {
    const map = new Map();
    for (const b of balances || []) map.set(String(b.accountId), b);
    return map;
  }, [balances]);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const ab = balanceByAccount.get(String(a.id));
      const bb = balanceByAccount.get(String(b.id));
      const aActive = Math.abs(safeNum(ab?.balance ?? ab?.rawBalance ?? ab?.debit ?? ab?.credit)) > 0.009 ? 1 : 0;
      const bActive = Math.abs(safeNum(bb?.balance ?? bb?.rawBalance ?? bb?.debit ?? bb?.credit)) > 0.009 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [accounts, balanceByAccount]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
      {/* Account list */}
      <div className="panel p-3 lg:col-span-1">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Accounts</h3>
        <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
          {accounts.length === 0 && (
            <div className="text-xs text-slate-400 italic px-2 py-1">No accounts.</div>
          )}
          {sortedAccounts.map((a) => {
            const meta = ACCOUNT_TYPE_META[a.type];
            const tone = TONE_CLASSES[meta?.tone || "slate"];
            const isActive = selectedAccount?.id === a.id;
            const bal = balanceByAccount.get(String(a.id));
            const hasActivity = Math.abs(safeNum(bal?.balance ?? bal?.rawBalance ?? bal?.debit ?? bal?.credit)) > 0.009;
            return (
              <button key={a.id}
                      onClick={() => onAccountSelect(a)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 ${
                        isActive ? "bg-amber-50 text-amber-900" : "hover:bg-slate-50 text-slate-700"
                      }`}>
                <span className="truncate">{a.name}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {hasActivity && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Has transactions" />}
                  <span className={`text-[9px] uppercase font-semibold ${tone.text}`}>{a.type?.[0]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ledger */}
      <div className="panel p-3 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {selectedAccount ? selectedAccount.name : "Select an account"}
            </h3>
            {selectedAccount && (
              <p className="text-[11px] text-slate-500">{ledgerTotal} entries</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onPrintLedger} className="icon-btn" title="Print account ledger" disabled={!selectedAccount}>
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDownloadCsv} className="icon-btn" title="Download account ledger CSV" disabled={!selectedAccount || ledger.length === 0}>
              <Download className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search…"
                className="input-sm pl-7 w-44"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <SkeletonBlock />
        ) : !selectedAccount ? (
          <EmptyState message="Pick an account on the left to view its ledger." />
        ) : ledger.length === 0 ? (
          <EmptyState message="No entries for this account in the selected period. Try FY view or select Cash in Hand, Easter Day Meeting Expense, Rent Expense, Capital Fund, or Sambit Raut Unsecured Loan." />
        ) : (
          <div className="overflow-x-auto -mx-3">
            <table className="min-w-[840px] w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l, i) => {
                  const entryId = l.journalEntryId || l.JournalEntryId || l.entryId || l.EntryId;
                  return (
                    <tr key={l.id || l.Id || `${entryId || "entry"}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {l.date ? dayjs(l.date).format("DD MMM YYYY") : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{l.description || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {safeNum(l.debit) ? formatINR(l.debit) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {safeNum(l.credit) ? formatINR(l.credit) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatINR(l.balance ?? l.Balance)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onEditEntry?.(entryId)}
                            disabled={!entryId}
                            className="icon-btn"
                            title="Edit transaction"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteEntry?.(entryId)}
                            disabled={!entryId}
                            className="icon-btn text-red-600 hover:bg-red-50"
                            title="Delete transaction"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={2} className="px-3 py-2 text-right">Totals</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(totals.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(totals.credit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">{formatINR(endingBalance)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Accounts view (Chart of Accounts + balances)                             */
/* ======================================================================== */

function AccountsView({ accounts, balances, loading, onSetOpening }) {
  const balanceByAccount = useMemo(() => {
    const map = new Map();
    for (const b of balances) map.set(b.accountId, b);
    return map;
  }, [balances]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const a of accounts) {
      const t = a.type || "OTHER";
      if (!groups[t]) groups[t] = [];
      groups[t].push(a);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((x, y) => (x.name || "").localeCompare(y.name || ""));
    }
    return groups;
  }, [accounts]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Object.keys(ACCOUNT_TYPE_META).map((type) => {
        const meta = ACCOUNT_TYPE_META[type];
        const list = grouped[type] || [];
        const tone = TONE_CLASSES[meta.tone];
        const Icon = meta.icon;
        const total = list.reduce(
          (s, a) => s + safeNum(balanceByAccount.get(a.id)?.balance),
          0
        );
        return (
          <div key={type} className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-white ${tone.bg}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">{meta.label}</h3>
              </div>
              <span className="text-xs font-semibold tabular-nums text-slate-700">
                {formatINR(total)}
              </span>
            </div>
            {loading ? (
              <SkeletonBlock lines={3} />
            ) : list.length === 0 ? (
              <div className="text-xs text-slate-400 italic">No accounts in this category.</div>
            ) : (
              <div className="space-y-1">
                {list.map((a) => {
                  const bal = balanceByAccount.get(a.id);
                  return (
                    <div key={a.id} className="flex items-center justify-between border-b border-slate-100 last:border-0 py-1.5 group">
                      <div className="flex items-center gap-2 min-w-0">
                        {a.code && (
                          <span className="text-[10px] font-mono text-slate-400">{a.code}</span>
                        )}
                        <span className="text-xs text-slate-800 truncate">{a.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs tabular-nums text-slate-700">{formatINR(bal?.balance)}</span>
                        <button
                          onClick={() => onSetOpening({ accountId: a.id, accountName: a.name })}
                          className="opacity-0 group-hover:opacity-100 text-[10px] text-amber-700 hover:underline transition"
                          title="Set opening balance"
                        >
                          Set opening
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ======================================================================== */
/*  Reports view                                                             */
/* ======================================================================== */

function ReportsView({ pnl, balances, accounts, totalsByType, pnlSeries, loading, onDownloadPdf, onPrint }) {
  const assets = balances.filter((b) => (b.type || accounts.find((a) => a.id === b.accountId)?.type) === "ASSET");
  const liabilities = balances.filter((b) => (b.type || accounts.find((a) => a.id === b.accountId)?.type) === "LIABILITY");
  const equity = balances.filter((b) => (b.type || accounts.find((a) => a.id === b.accountId)?.type) === "EQUITY");

  const totalAssets = assets.reduce((s, b) => s + safeNum(b.balance), 0);
  const totalLiabilities = liabilities.reduce((s, b) => s + safeNum(b.balance), 0);
  const totalEquity = equity.reduce((s, b) => s + safeNum(b.balance), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* P&L */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Profit & Loss</h3>
          <div className="flex gap-1">
            <button onClick={onPrint} className="icon-btn" title="Print">
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDownloadPdf} className="icon-btn" title="Download PDF">
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading ? (
          <SkeletonBlock />
        ) : !pnl ? (
          <EmptyState message="P&L data unavailable." />
        ) : (
          <div className="space-y-2">
            <ReportRow label="Total income" value={pnl.income} positive />
            <ReportRow label="Total expense" value={pnl.expense} negative />
            <div className="border-t border-slate-200 pt-2 mt-2">
              <ReportRow
                label="Net profit / (loss)"
                value={pnl.net}
                bold
                tone={pnl.net >= 0 ? "emerald" : "rose"}
              />
            </div>
          </div>
        )}

        {/* Mini trend */}
        {pnlSeries.length > 0 && (
          <div className="h-32 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlSeries} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={formatINRCompact} />
                <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Net" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Balance Sheet */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Balance Sheet</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <BalanceColumn title="Assets" rows={assets} accounts={accounts} total={totalAssets} tone="emerald" />
          <BalanceColumn
            title="Liabilities + Equity"
            rows={[...liabilities, ...equity]}
            accounts={accounts}
            total={totalLiabilities + totalEquity}
            tone="rose"
          />
        </div>

        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${
          Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
            : "bg-amber-50 text-amber-800 border border-amber-200"
        }`}>
          {Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
            ? "Balanced — Assets equal Liabilities + Equity."
            : `Out of balance by ${formatINR(totalAssets - (totalLiabilities + totalEquity))}`}
        </div>
      </div>

      {/* Trial balance */}
      <div className="lg:col-span-2 panel p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Trial Balance</h3>
        {loading ? (
          <SkeletonBlock />
        ) : balances.length === 0 ? (
          <EmptyState message="No balances to show." />
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-4 py-2 text-left">Account</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => {
                  const acc = accounts.find((a) => a.id === b.accountId);
                  const type = b.type || acc?.type;
                  const meta = ACCOUNT_TYPE_META[type];
                  const tone = TONE_CLASSES[meta?.tone || "slate"];
                  return (
                    <tr key={b.accountId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-slate-800">{b.accountName || acc?.name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-semibold uppercase rounded-full px-1.5 py-0.5 border ${tone.chip}`}>
                          {meta?.label || type}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                        {formatINR(b.balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfessionalReportsView({
  pnl,
  balanceSheet,
  trialBalance,
  balances,
  accounts,
  pnlSeries,
  loading,
  onDownloadPdf,
  onExportTransactions,
  onExportPnl,
  onExportBalanceSheet,
  onExportTrialBalance,
  onExportGl,
  onPrint,
}) {
  const fallbackAssets = balances.filter((b) => (b.type || accounts.find((a) => a.id === b.accountId)?.type) === "ASSET");
  const fallbackLiabilities = balances.filter((b) => (b.type || accounts.find((a) => a.id === b.accountId)?.type) === "LIABILITY");
  const fallbackEquity = balances.filter((b) => (b.type || accounts.find((a) => a.id === b.accountId)?.type) === "EQUITY");

  const assets = arrayFrom(balanceSheet?.assets).length ? arrayFrom(balanceSheet?.assets) : fallbackAssets;
  const liabilities = arrayFrom(balanceSheet?.liabilities).length ? arrayFrom(balanceSheet?.liabilities) : fallbackLiabilities;
  const equity = arrayFrom(balanceSheet?.equityAccounts).length ? arrayFrom(balanceSheet?.equityAccounts) : fallbackEquity;
  const currentSurplus = safeNum(balanceSheet?.currentYearSurplus ?? pnl?.net);
  const equityRows = currentSurplus === 0
    ? equity
    : [...equity, { accountId: "current-surplus", accountName: "Current period surplus / (deficit)", balance: currentSurplus }];

  const totalAssets = safeNum(balanceSheet?.totalAssets ?? assets.reduce((s, b) => s + safeNum(b.balance), 0));
  const totalLiabilitiesAndEquity = safeNum(
    balanceSheet?.liabilitiesAndEquity ??
    liabilities.reduce((s, b) => s + safeNum(b.balance), 0) + equityRows.reduce((s, b) => s + safeNum(b.balance), 0)
  );
  const balanceDifference = safeNum(balanceSheet?.difference ?? totalAssets - totalLiabilitiesAndEquity);

  const backendTrialRows = arrayFrom(trialBalance?.accounts).length ? arrayFrom(trialBalance?.accounts) : arrayFrom(trialBalance?.items);
  const trialRows = backendTrialRows.length
    ? backendTrialRows
    : balances.map((b) => ({
        accountId: b.accountId,
        account: b.accountName,
        type: b.type,
        debit: safeNum(b.rawBalance) > 0 ? safeNum(b.rawBalance) : 0,
        credit: safeNum(b.rawBalance) < 0 ? Math.abs(safeNum(b.rawBalance)) : 0,
        balance: b.balance,
      }));
  const totalTrialDebit = safeNum(trialBalance?.totalDebit ?? trialRows.reduce((s, r) => s + safeNum(r.debit ?? r.Debit), 0));
  const totalTrialCredit = safeNum(trialBalance?.totalCredit ?? trialRows.reduce((s, r) => s + safeNum(r.credit ?? r.Credit), 0));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="lg:col-span-2 panel p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Data Extracts</h3>
            <p className="text-[11px] text-slate-500">Download finance-ready CSV reports for audit, Excel, tallying, and review.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onExportTransactions} className="btn-secondary">
              <Download className="w-4 h-4" /> Detail Transactions
            </button>
            <button onClick={onExportGl} className="btn-secondary">
              <Download className="w-4 h-4" /> GL
            </button>
            <button onClick={onExportPnl} className="btn-secondary">
              <Download className="w-4 h-4" /> P&L
            </button>
            <button onClick={onExportBalanceSheet} className="btn-secondary">
              <Download className="w-4 h-4" /> Balance Sheet
            </button>
            <button onClick={onExportTrialBalance} className="btn-secondary">
              <Download className="w-4 h-4" /> Trial Balance
            </button>
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Profit and Loss Statement</h3>
            <p className="text-[11px] text-slate-500">Income minus expenses for the selected period.</p>
          </div>
          <div className="flex gap-1">
            <button onClick={onPrint} className="icon-btn" title="Print">
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDownloadPdf} className="icon-btn" title="Download PDF">
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading ? (
          <SkeletonBlock />
        ) : !pnl ? (
          <EmptyState message="P&L data unavailable." />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <ReportRow label="Total income" value={pnl.income} positive />
              <ReportRow label="Total expense" value={pnl.expense} negative />
              <div className="border-t border-slate-200 pt-2 mt-2">
                <ReportRow
                  label="Net surplus / (deficit)"
                  value={pnl.net}
                  bold
                  tone={pnl.net >= 0 ? "emerald" : "rose"}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MiniStatement title="Income accounts" rows={pnl.incomeAccounts || []} tone="emerald" />
              <MiniStatement title="Expense accounts" rows={pnl.expenseAccounts || []} tone="amber" />
            </div>
          </div>
        )}

        {pnlSeries.length > 0 && (
          <div className="h-32 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlSeries} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={formatINRCompact} />
                <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Net" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Balance Sheet</h3>
            <p className="text-[11px] text-slate-500">Assets against liabilities, corpus fund, and current surplus.</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold border ${
            Math.abs(balanceDifference) < 0.01
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
            {Math.abs(balanceDifference) < 0.01 ? "Balanced" : "Review"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BalanceColumn title="Assets" rows={assets} accounts={accounts} total={totalAssets} tone="emerald" />
          <BalanceColumn
            title="Liabilities + Equity"
            rows={[...liabilities, ...equityRows]}
            accounts={accounts}
            total={totalLiabilitiesAndEquity}
            tone="rose"
          />
        </div>

        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${
          Math.abs(balanceDifference) < 0.01
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
            : "bg-amber-50 text-amber-800 border border-amber-200"
        }`}>
          {Math.abs(balanceDifference) < 0.01
            ? "Balanced: Assets equal liabilities plus equity."
            : `Out of balance by ${formatINR(balanceDifference)}. Review opening balances and journal entries.`}
        </div>
      </div>

      <div className="lg:col-span-2 panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Trial Balance</h3>
            <p className="text-[11px] text-slate-500">Closing debit and credit balances across the chart of accounts.</p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${
            Math.abs(totalTrialDebit - totalTrialCredit) < 0.01
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}>
            Dr {formatINR(totalTrialDebit)} | Cr {formatINR(totalTrialCredit)}
          </div>
        </div>
        {loading ? (
          <SkeletonBlock />
        ) : trialRows.length === 0 ? (
          <EmptyState message="No balances to show." />
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-4 py-2 text-left">Account</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Debit</th>
                  <th className="px-4 py-2 text-right">Credit</th>
                  <th className="px-4 py-2 text-right">Natural balance</th>
                </tr>
              </thead>
              <tbody>
                {trialRows.map((row) => {
                  const type = row.type || row.Type;
                  const meta = ACCOUNT_TYPE_META[type];
                  const tone = TONE_CLASSES[meta?.tone || "slate"];
                  return (
                    <tr key={row.accountId || row.AccountId || row.account} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-slate-800">{row.account || row.accountName || row.Account}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-semibold uppercase rounded-full px-1.5 py-0.5 border ${tone.chip}`}>
                          {meta?.label || type}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatINR(row.debit ?? row.Debit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatINR(row.credit ?? row.Credit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatINR(row.balance ?? row.Balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStatement({ title, rows, tone }) {
  const t = TONE_CLASSES[tone] || TONE_CLASSES.slate;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className={`text-[11px] font-semibold uppercase ${t.text}`}>{title}</div>
      <div className="mt-2 space-y-1">
        {rows.length === 0 ? (
          <div className="text-[11px] text-slate-400 italic">No activity.</div>
        ) : rows.slice(0, 6).map((row) => (
          <div key={row.accountId || row.accountName} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-600">{row.accountName}</span>
            <span className="tabular-nums font-medium text-slate-900">{formatINR(row.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BalanceColumn({ title, rows, accounts, total, tone }) {
  const t = TONE_CLASSES[tone] || TONE_CLASSES.slate;
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wide ${t.text} mb-2`}>{title}</div>
      <div className="space-y-1">
        {rows.length === 0 && (
          <div className="text-[11px] text-slate-400 italic">No accounts.</div>
        )}
        {rows.map((b) => (
          <div key={b.accountId} className="flex items-center justify-between text-xs">
            <span className="text-slate-700 truncate pr-2">
              {b.accountName || accounts.find((a) => a.id === b.accountId)?.name}
            </span>
            <span className="tabular-nums text-slate-900">{formatINR(b.balance)}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 mt-2 pt-2 flex items-center justify-between text-xs font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatINR(total)}</span>
      </div>
    </div>
  );
}

function ReportRow({ label, value, positive, negative, bold, tone }) {
  const t = TONE_CLASSES[tone] || null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={`${bold ? "font-semibold" : "text-slate-600"}`}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""} ${t ? t.text : positive ? "text-emerald-600" : negative ? "text-amber-600" : "text-slate-900"}`}>
        {formatINR(value)}
      </span>
    </div>
  );
}

/* ======================================================================== */
/*  Modals — controlled forms                                                */
/* ======================================================================== */

function JournalEntryModal({ mode, accounts, onCancel, onSave }) {
  const isExpense = mode === "expense";
  const [form, setForm] = useState({
    date: dayjs().format("YYYY-MM-DD"),
    description: "",
    amount: "",
    debitAccountId: "", // category for expense, cash/bank for income
    creditAccountId: "", // cash/bank for expense, source for income
  });
  const [saving, setSaving] = useState(false);

  // Sensible defaults
  useEffect(() => {
    if (accounts.length === 0) return;
    const cash = accounts.find((a) => a.type === "ASSET" && /cash/i.test(a.name || ""));
    const bank = accounts.find((a) => a.type === "ASSET" && /bank/i.test(a.name || ""));
    const cashOrBank = cash || bank || accounts.find((a) => a.type === "ASSET");

    if (isExpense) {
      const firstExpense = accounts.find((a) => a.type === "EXPENSE");
      setForm((f) => ({
        ...f,
        debitAccountId: f.debitAccountId || firstExpense?.id || "",
        creditAccountId: f.creditAccountId || cashOrBank?.id || "",
      }));
    } else {
      const firstIncome = accounts.find((a) => a.type === "INCOME");
      setForm((f) => ({
        ...f,
        debitAccountId: f.debitAccountId || cashOrBank?.id || "",
        creditAccountId: f.creditAccountId || firstIncome?.id || "",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, isExpense]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || safeNum(form.amount) <= 0) return alert("Enter an amount.");
    if (!form.debitAccountId || !form.creditAccountId) return alert("Pick both accounts.");
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");
  const incomeAccounts = accounts.filter((a) => a.type === "INCOME");
  const cashLikeAccounts = accounts.filter((a) => a.type === "ASSET");

  return (
    <ModalShell title={isExpense ? "Record expense" : "Record income"}
                onCancel={onCancel}
                onSubmit={handleSubmit}
                saving={saving}
                tone={isExpense ? "amber" : "emerald"}>
      <Field label="Date">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" required />
      </Field>
      <Field label="Description">
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" placeholder="e.g. Office supplies" />
      </Field>
      <Field label={`Amount (${RUPEE})`}>
        <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" required />
      </Field>
      {isExpense ? (
        <>
          <Field label="Expense category">
            <select value={form.debitAccountId} onChange={(e) => setForm({ ...form, debitAccountId: e.target.value })} className="input">
              <option value="">Choose category…</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Paid from">
            <select value={form.creditAccountId} onChange={(e) => setForm({ ...form, creditAccountId: e.target.value })} className="input">
              <option value="">Choose account…</option>
              {cashLikeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field label="Income source">
            <select value={form.creditAccountId} onChange={(e) => setForm({ ...form, creditAccountId: e.target.value })} className="input">
              <option value="">Choose source…</option>
              {incomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Received in">
            <select value={form.debitAccountId} onChange={(e) => setForm({ ...form, debitAccountId: e.target.value })} className="input">
              <option value="">Choose account…</option>
              {cashLikeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        </>
      )}
    </ModalShell>
  );
}

function ManualJournalModal({
  accounts,
  onCancel,
  onSave,
  initialEntry = null,
  title = "Manual journal entry",
  submitLabel = "Save",
}) {
  const [form, setForm] = useState(() => ({
    date: initialEntry?.date
      ? dayjs(initialEntry.date).format("YYYY-MM-DD")
      : dayjs().format("YYYY-MM-DD"),
    description: initialEntry?.description || "",
    lines: Array.isArray(initialEntry?.lines) && initialEntry.lines.length > 0
      ? initialEntry.lines.map((line) => {
          const debit = safeNum(line.debit ?? line.Debit);
          const credit = safeNum(line.credit ?? line.Credit);
          return {
            accountId: String(line.accountId ?? line.AccountId ?? ""),
            debit: debit ? String(debit) : "",
            credit: credit ? String(credit) : "",
          };
        })
      : [
          { accountId: "", debit: "", credit: "" },
          { accountId: "", debit: "", credit: "" },
        ],
  }));
  const [saving, setSaving] = useState(false);

  const debitTotal = form.lines.reduce((s, line) => s + safeNum(line.debit), 0);
  const creditTotal = form.lines.reduce((s, line) => s + safeNum(line.credit), 0);
  const difference = debitTotal - creditTotal;
  const balanced = Math.abs(difference) < 0.01 && debitTotal > 0;

  const updateLine = (index, patch) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => i === index ? { ...line, ...patch } : line),
    }));
  };

  const addLine = () => {
    setForm((current) => ({
      ...current,
      lines: [...current.lines, { accountId: "", debit: "", credit: "" }],
    }));
  };

  const removeLine = (index) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.description.trim()) return alert("Description is required.");
    if (form.lines.length < 2) return alert("A journal needs at least two lines.");
    if (form.lines.some((line) => !line.accountId)) return alert("Select an account for every line.");
    if (!balanced) return alert("Debit and credit totals must match.");

    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <ModalShell title={title} onCancel={onCancel} onSubmit={handleSubmit} saving={saving} tone="blue" submitLabel={submitLabel}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Voucher date">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" required />
        </Field>
        <Field label="Narration">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" placeholder="e.g. Accrued salary payable" required />
        </Field>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-x-auto">
        <div className="min-w-[620px] grid grid-cols-[1fr_100px_100px_36px] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase text-slate-500">
          <span>Account</span>
          <span className="text-right">Debit</span>
          <span className="text-right">Credit</span>
          <span />
        </div>
        {form.lines.map((line, index) => (
          <div key={index} className="min-w-[620px] grid grid-cols-[1fr_100px_100px_36px] gap-2 border-t border-slate-100 px-3 py-2">
            <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })} className="input">
              <option value="">Choose account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.type} - {a.name}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={line.debit}
              onChange={(e) => updateLine(index, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
              className="input text-right"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={line.credit}
              onChange={(e) => updateLine(index, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
              className="input text-right"
            />
            <button
              type="button"
              onClick={() => removeLine(index)}
              disabled={form.lines.length <= 2}
              className="rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              title="Remove line"
            >
              <X className="w-4 h-4 mx-auto" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={addLine} className="btn-secondary">
          <Plus className="w-4 h-4" /> Add line
        </button>
        <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${
          balanced ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}>
          Debit {formatINR(debitTotal)} | Credit {formatINR(creditTotal)}
        </div>
      </div>
    </ModalShell>
  );
}

function TransferModal({ accounts, onCancel, onSave }) {
  const [form, setForm] = useState({
    date: dayjs().format("YYYY-MM-DD"),
    description: "Transfer between accounts",
    amount: "",
    fromAccountId: "",
    toAccountId: "",
  });
  const [saving, setSaving] = useState(false);
  const cashLike = accounts.filter((a) => a.type === "ASSET" || a.type === "LIABILITY");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || safeNum(form.amount) <= 0) return alert("Enter an amount.");
    if (!form.fromAccountId || !form.toAccountId) return alert("Pick both accounts.");
    if (form.fromAccountId === form.toAccountId) return alert("From and To must differ.");
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <ModalShell title="Transfer between accounts" onCancel={onCancel} onSubmit={handleSubmit} saving={saving} tone="blue">
      <Field label="Date">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" required />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <select value={form.fromAccountId} onChange={(e) => setForm({ ...form, fromAccountId: e.target.value })} className="input">
            <option value="">Choose…</option>
            {cashLike.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select value={form.toAccountId} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })} className="input">
            <option value="">Choose…</option>
            {cashLike.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label={`Amount (${RUPEE})`}>
        <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" required />
      </Field>
      <Field label="Note (optional)">
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" />
      </Field>
    </ModalShell>
  );
}

function AccountModal({ onCancel, onSave }) {
  const [form, setForm] = useState({ name: "", type: "EXPENSE", code: "" });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return alert("Account name is required.");
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <ModalShell title="New account" onCancel={onCancel} onSubmit={handleSubmit} saving={saving} tone="blue">
      <Field label="Name">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" autoFocus required />
      </Field>
      <Field label="Type">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
          {Object.entries(ACCOUNT_TYPE_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Code (optional)">
        <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input" placeholder="e.g. 4100" />
      </Field>
    </ModalShell>
  );
}

function OpeningBalanceModal({ row, onCancel, onSave }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || safeNum(amount) < 0) return alert("Enter a non-negative amount.");
    setSaving(true);
    await onSave({ accountId: row.accountId, amount });
    setSaving(false);
  };

  return (
    <ModalShell title={`Opening balance — ${row.accountName}`} onCancel={onCancel} onSubmit={handleSubmit} saving={saving} tone="emerald">
      <Field label={`Amount (${RUPEE})`}>
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" autoFocus required />
      </Field>
    </ModalShell>
  );
}

function ModalShell({ title, children, onCancel, onSubmit, saving, tone = "amber", submitLabel = "Save" }) {
  const t = TONE_CLASSES[tone] || TONE_CLASSES.amber;
  return (
    <div className="fixed inset-0 z-[160] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
         onClick={onCancel}>
      <form onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${t.bg} disabled:opacity-60`}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ======================================================================== */
/*  Small reusable bits                                                      */
/* ======================================================================== */

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500 mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}

function KpiCard({ label, value, icon, tone = "slate", delta, deltaPositive, loading, onClick }) {
  const t = TONE_CLASSES[tone] || TONE_CLASSES.slate;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl bg-white border border-slate-200 shadow-sm p-3 hover:shadow-md transition"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{label}</span>
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${t.bg} text-white`}>
          {icon}
        </span>
      </div>
      <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
        {loading ? <span className="block h-5 w-24 rounded bg-slate-100 animate-pulse" /> : value}
      </div>
      {delta != null && Number.isFinite(delta) && (
        <div className={`mt-0.5 text-[11px] inline-flex items-center gap-0.5 ${
          (deltaPositive ? delta >= 0 : delta <= 0)
            ? "text-emerald-600" : "text-rose-600"
        }`}>
          {delta >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {Math.abs(delta).toFixed(1)}% vs prev
        </div>
      )}
    </button>
  );
}

function SkeletonBlock({ lines = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-8 rounded-xl bg-gradient-to-r from-slate-50 via-slate-100 to-slate-50 bg-[length:200%_100%] animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="text-center py-8 px-3 text-xs text-slate-500">
      <Receipt className="w-7 h-7 mx-auto text-slate-300 mb-2" />
      {message}
    </div>
  );
}
