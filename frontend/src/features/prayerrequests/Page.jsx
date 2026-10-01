// src/features/prayerrequests/Page.jsx
//
// Community Prayer Wall — redesigned for clarity and warmth.
//   - Hero compose card with character count + toasts
//   - Stats summary (total / this week / answered)
//   - Tabs (All / Mine / Active / Answered) + status chips + search
//   - Light cards with inline-expand Respond (no permanent textarea on every card)
//   - "I'm praying" button with a local count (stored in browser)
//   - Status badges, friendly time-ago, owner-only delete
//   - Admin section: refined table, bulk select, print, status, close-with-comment
//
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { resolveLogoUrl } from "../../components/TenantLogo";
import {
  Heart,
  HandHeart,
  Send,
  Loader2,
  Trash2,
  MessageCircle,
  X,
  Check,
  Search,
  Filter,
  Sparkles,
  Calendar,
  Printer,
  Lock,
  Globe,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Reply,
  CheckCheck,
  AlertCircle,
  Image as ImageIcon,
  Mic,
  MicOff,
  UploadCloud,
  Download,
  Save,
  Edit3,
  PlusCircle,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getToken as getStoredToken } from "../auth/authService";
import { getCurrentUser } from "../auth/permissionService";
import "./PrayerWall.css";

/* ============================================================================
 *  API HELPERS
 * ========================================================================= */
const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || window.location.origin;
const PRAYER_REQUESTS_URL = `${API_BASE}/prayerrequests`;
const apiUrl = (path) => {
  const base = API_BASE.replace(/\/+$/, "");
  if (base.toLowerCase().endsWith("/api")) return `${base}${path}`;
  return `${base}/api${path}`;
};

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText || ""} – ${text || "Request failed"}`
    );
  }
  return res.json().catch(() => null);
};
const authHeaders = (extra = {}) => {
  const token = getStoredToken?.();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const normalizeAccessName = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const isPrayerDeskManagerName = (value) => {
  const name = normalizeAccessName(value);
  return [
    "callcentermanager",
    "callcentremanager",
    "callcenter",
    "callcentre",
    "prayerdeskmanager",
    "prayercallcentermanager",
  ].includes(name);
};

const ragMeta = (status) => {
  const value = String(status || "green").toLowerCase();
  if (value === "red") return { label: "Red", dot: "bg-red-500", chip: "border-red-200 bg-red-50 text-red-700" };
  if (value === "amber") return { label: "Amber", dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Green", dot: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50 text-emerald-700" };
};

/* ============================================================================
 *  STATUS HELPERS
 * ========================================================================= */
const NORMALIZED_STATUSES = ["new", "open", "prayed", "closed"];

const STATUS_META = {
  new:    { label: "New",     dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  open:   { label: "Open",    dot: "bg-sky-500",     chip: "bg-sky-50 text-sky-700 border-sky-200" },
  prayed: { label: "Prayed",  dot: "bg-violet-500",  chip: "bg-violet-50 text-violet-700 border-violet-200" },
  closed: { label: "Answered",dot: "bg-slate-700",   chip: "bg-slate-100 text-slate-700 border-slate-300" },
};
const statusMeta = (s) => STATUS_META[(s || "new").toLowerCase()] || STATUS_META.new;
const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const ageHours = (iso) => {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 36e5));
};

/* ============================================================================
 *  CATEGORIES  (admin filter + auto-detection from title/keywords)
 * ========================================================================= */
const PRAYER_CATEGORIES = [
  { key: "all",          label: "All",           emoji: "🙏",  keywords: [] },
  { key: "healing",      label: "Healing",        emoji: "💚",  keywords: ["heal","health","sick","ill","hospital","pain","recovery","doctor","medical","disease","cancer","surgery","treatment"] },
  { key: "family",       label: "Family",          emoji: "👨‍👩‍👧", keywords: ["family","marriage","husband","wife","child","children","parent","son","daughter","divorce","sibling","brother","sister","mother","father"] },
  { key: "finance",      label: "Finance",         emoji: "💰",  keywords: ["financial","finance","money","debt","provision","bills","employment","income","poverty","loan","mortgage","salary"] },
  { key: "work",         label: "Work / Career",   emoji: "💼",  keywords: ["work","career","job","business","promotion","boss","colleague","interview","workplace","office"] },
  { key: "spiritual",    label: "Spiritual",       emoji: "✝️",  keywords: ["faith","spiritual","salvation","baptism","conviction","repentance","grow","bible","church","ministry","calling"] },
  { key: "grief",        label: "Grief & Loss",    emoji: "🕊️", keywords: ["loss","grief","death","died","passed away","bereavement","mourn","funeral","widow","orphan"] },
  { key: "thanksgiving", label: "Thanksgiving",    emoji: "🌟",  keywords: ["thank","praise","grateful","testimony","blessed","answered","miracle","breakthrough"] },
  { key: "urgent",       label: "Urgent",          emoji: "🔴",  keywords: [] },
];

function detectPrayerCategory(req) {
  const m = (req.title || "").match(/^\[([^\]]+)\]/i);
  if (m) {
    const key = m[1].toLowerCase();
    if (PRAYER_CATEGORIES.find(c => c.key === key)) return key;
  }
  if (req.ragStatus === "red") return "urgent";
  const text = `${req.title || ""} ${req.message || ""}`.toLowerCase();
  for (const cat of PRAYER_CATEGORIES) {
    if (!cat.keywords?.length) continue;
    if (cat.keywords.some(kw => text.includes(kw))) return cat.key;
  }
  return null;
}

/* ============================================================================
 *  TIME-AGO
 * ========================================================================= */
const timeAgo = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
};

/* ============================================================================
 *  LOCAL PRAYER COUNTER (browser-only)
 * ========================================================================= */
const PRAYERS_KEY = "mahima_prayer_counts";
const I_PRAYED_KEY = "mahima_i_prayed";

const loadPrayerCounts = () => {
  try { return JSON.parse(localStorage.getItem(PRAYERS_KEY) || "{}"); }
  catch { return {}; }
};
const loadIPrayed = () => {
  try {
    const a = JSON.parse(localStorage.getItem(I_PRAYED_KEY) || "[]");
    return new Set(Array.isArray(a) ? a : []);
  } catch { return new Set(); }
};

/* ============================================================================
 *  AVATAR
 * ========================================================================= */
function Avatar({ name, anonymous }) {
  const letter = anonymous
    ? "A"
    : (name || "M").trim().charAt(0).toUpperCase() || "M";
  const grad = anonymous
    ? "from-slate-400 to-slate-500"
    : "from-indigo-500 via-violet-500 to-fuchsia-500";
  return (
    <div className={`w-9 h-9 rounded-2xl bg-gradient-to-br ${grad} text-white flex items-center justify-center text-sm font-bold shadow-sm shrink-0`}>
      {letter}
    </div>
  );
}

/* ============================================================================
 *  TOASTS
 * ========================================================================= */
function Toasts({ items, onDismiss }) {
  return (
    <div className="fixed top-20 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto min-w-[260px] max-w-sm rounded-2xl shadow-xl border px-4 py-3 flex items-start gap-2.5 backdrop-blur bg-white/95 animate-[fadeIn_200ms_ease-out] ${
            t.kind === "error"
              ? "border-red-200"
              : t.kind === "success"
              ? "border-emerald-200"
              : "border-slate-200"
          }`}
        >
          {t.kind === "error" ? (
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          ) : t.kind === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
          )}
          <div className="flex-1 text-sm text-slate-800">{t.msg}</div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
 *  MAIN PAGE
 * ========================================================================= */
export default function PrayerRequestsPage() {
  // Data
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [childApplet, setChildApplet] = useState("prayers");
  const [testimonies, setTestimonies] = useState([]);
  const [testimoniesLoading, setTestimoniesLoading] = useState(false);
  const [editingTestimonyId, setEditingTestimonyId] = useState(null);
  const [testimonyDraft, setTestimonyDraft] = useState({ title: "", testimonyText: "", imageUrl: "", voiceUrl: "" });
  const [testimonySaving, setTestimonySaving] = useState(false);
  const [testimonyBackfillRunning, setTestimonyBackfillRunning] = useState(false);

  // Compose
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-IN");

  // Respond — only one card expanded at a time
  const [expandedRespondId, setExpandedRespondId] = useState(null);
  const [responseText, setResponseText] = useState("");
  const [responseSubmitting, setResponseSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all"); // all | mine | active | answered
  const [statusFilter, setStatusFilter] = useState(null); // null | "new" | "open" | "prayed" | "closed"

  // User / admin
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Admin tools
  const [selectedIds, setSelectedIds] = useState([]);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [closingId, setClosingId] = useState(null);
  const [closeComment, setCloseComment] = useState("");
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [showAdminTable, setShowAdminTable] = useState(true);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showAdminMetrics, setShowAdminMetrics] = useState(false);
  const [bulkAddText, setBulkAddText] = useState("");
  const [bulkAddStatus, setBulkAddStatus] = useState("new");
  const [bulkAddAnonymous, setBulkAddAnonymous] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkActionStatus, setBulkActionStatus] = useState("open");
  const [bulkCloseComment, setBulkCloseComment] = useState("");
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const [metricsRange, setMetricsRange] = useState("30");
  const [metricsDateFrom, setMetricsDateFrom] = useState("");
  const [metricsDateTo, setMetricsDateTo] = useState("");

  // ── Admin advanced-filter state ──────────────────────────────────────────
  const [adminDateFrom, setAdminDateFrom]         = useState("");
  const [adminDateTo, setAdminDateTo]             = useState("");
  const [adminCategory, setAdminCategory]         = useState("all");
  const [adminRag, setAdminRag]                   = useState("all");
  const [adminSortBy, setAdminSortBy]             = useState("date");
  const [adminSortDir, setAdminSortDir]           = useState("desc");
  const [showAdminFilters, setShowAdminFilters]   = useState(false);
  // ─────────────────────────────────────────────────────────────────────────

  const [editingRequestId, setEditingRequestId] = useState(null);
  const [editDraft, setEditDraft] = useState({ title: "", message: "", anonymous: false });
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Prayer counts (browser-only)
  const [prayerCounts, setPrayerCounts] = useState(loadPrayerCounts);
  const [iPrayed, setIPrayed] = useState(loadIPrayed);

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const pushToast = useCallback((msg, kind = "info", ttl = 3500) => {
    const id = ++toastIdRef.current;
    setToasts((arr) => [...arr, { id, msg, kind }]);
    setTimeout(() => setToasts((arr) => arr.filter((t) => t.id !== id)), ttl);
  }, []);
  const dismissToast = (id) => setToasts((arr) => arr.filter((t) => t.id !== id));
  const voiceRecognitionRef = useRef(null);
  const adminTopScrollRef = useRef(null);
  const adminTableScrollRef = useRef(null);

  const syncAdminScroll = useCallback((source) => {
    const from = source === "top" ? adminTopScrollRef.current : adminTableScrollRef.current;
    const to = source === "top" ? adminTableScrollRef.current : adminTopScrollRef.current;
    if (!from || !to || to.scrollLeft === from.scrollLeft) return;
    to.scrollLeft = from.scrollLeft;
  }, []);

  useEffect(() => {
    return () => {
      try { voiceRecognitionRef.current?.stop?.(); } catch {}
      voiceRecognitionRef.current = null;
    };
  }, []);

  const stopVoiceCapture = useCallback(() => {
    try { voiceRecognitionRef.current?.stop?.(); } catch {}
    voiceRecognitionRef.current = null;
    setVoiceListening(false);
    setVoiceBusy(false);
  }, []);

  const startVoiceCapture = useCallback((lang = voiceLang) => {
    if (voiceListening || voiceBusy) {
      stopVoiceCapture();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      pushToast("Voice typing is not available in this browser. Please use Chrome on Android or the Mahima app.", "error");
      return;
    }

    setVoiceLang(lang);
    setVoiceBusy(true);
    setVoiceListening(true);

    const recognition = new SpeechRecognition();
    voiceRecognitionRef.current = recognition;
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;

    const existing = message.trim();
    let finalText = "";

    recognition.onstart = () => {
      setVoiceBusy(false);
      pushToast("Listening now. Speak your prayer request, then review before sharing.", "info", 2500);
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      const spoken = (finalText || interim).trim();
      if (spoken) setMessage([existing, spoken].filter(Boolean).join(existing ? "\n" : ""));
    };

    recognition.onerror = () => {
      setVoiceListening(false);
      setVoiceBusy(false);
      voiceRecognitionRef.current = null;
      pushToast("Could not hear clearly. Please try again or type the request.", "error");
    };

    recognition.onend = () => {
      setVoiceListening(false);
      setVoiceBusy(false);
      voiceRecognitionRef.current = null;
      const spoken = finalText.trim();
      if (spoken) {
        setMessage([existing, spoken].filter(Boolean).join(existing ? "\n" : ""));
        pushToast("Voice request captured. Please review and share.", "success", 3000);
      }
    };

    try {
      recognition.start();
    } catch {
      setVoiceListening(false);
      setVoiceBusy(false);
      voiceRecognitionRef.current = null;
      pushToast("Microphone could not start. Please allow microphone access.", "error");
    }
  }, [message, pushToast, stopVoiceCapture, voiceBusy, voiceLang, voiceListening]);

  /* -------------------------- LOAD USER + ADMIN -------------------------- */
  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setCurrentUser(u || null);
        const rawRoles = [];
        if (u?.role && typeof u.role === "string") rawRoles.push(u.role);
        if (Array.isArray(u?.roles)) {
          for (const r of u.roles) {
            if (!r) continue;
            if (typeof r === "string") rawRoles.push(r);
            else if (typeof r.name === "string") rawRoles.push(r.name);
            else if (typeof r.roleName === "string") rawRoles.push(r.roleName);
          }
        }
        const roleNames = rawRoles.map(normalizeAccessName);
        const rawPositions = [
          ...(Array.isArray(u?.positions) ? u.positions : []),
          u?.primaryPosition,
        ].filter(Boolean);
        const positionNames = rawPositions.map((position) =>
          normalizeAccessName(position?.name || position?.positionName)
        );
        const isCallCenterManager =
          positionNames.some(isPrayerDeskManagerName) ||
          roleNames.some(isPrayerDeskManagerName);
        setIsAdmin(
          isCallCenterManager || roleNames.some((r) =>
            ["admin", "administrator", "superadmin", "superadministrator"].includes(r)
          )
        );
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  const myIdentifier = useMemo(() => {
    if (!currentUser) return null;
    return (
      currentUser.username ||
      currentUser.userName ||
      currentUser.displayName ||
      currentUser.email ||
      null
    );
  }, [currentUser]);

  const isMine = useCallback(
    (req) => {
      if (!myIdentifier || !req.createdBy) return false;
      return String(req.createdBy).toLowerCase() === String(myIdentifier).toLowerCase();
    },
    [myIdentifier]
  );

  /* ----------------------------- LOAD REQUESTS --------------------------- */
  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${PRAYER_REQUESTS_URL}?includeResponses=true`;
      const data = await fetchJson(url, {
        headers: authHeaders(),
      });
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      pushToast("Failed to load prayer requests.", "error");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const loadTestimonies = useCallback(async () => {
    setTestimoniesLoading(true);
    try {
      const data = await fetchJson(`${PRAYER_REQUESTS_URL}/testimonies`, {
        headers: authHeaders(),
      });
      setTestimonies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      pushToast("Failed to load testimonies.", "error");
    } finally {
      setTestimoniesLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    if (childApplet === "testimonies") loadTestimonies();
  }, [childApplet, loadTestimonies]);

  const backfillHindiTestimonies = useCallback(async () => {
    if (!isAdmin || testimonyBackfillRunning) return;
    setTestimonyBackfillRunning(true);
    try {
      const result = await fetchJson(`${PRAYER_REQUESTS_URL}/testimonies/backfill-hindi`, {
        method: "POST",
        headers: authHeaders(),
      });
      await loadTestimonies();
      pushToast(
        `Hindi generated for ${result?.updated ?? 0} testimonies. ${result?.skipped ?? 0} skipped.`,
        "success",
        4500
      );
    } catch (err) {
      console.error(err);
      pushToast("Could not generate Hindi testimonies. Please check AI/API configuration.", "error");
    } finally {
      setTestimonyBackfillRunning(false);
    }
  }, [isAdmin, loadTestimonies, pushToast, testimonyBackfillRunning]);

  /* --------------------------- SUBMIT NEW REQUEST ------------------------ */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) {
      pushToast("Please write your prayer request first.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        title: title?.trim() || null,
        message: message.trim(),
        anonymous,
        status: "new",
        assignedTo: null,
      };
      const url = `${PRAYER_REQUESTS_URL}?includeResponses=true`;
      const created = await fetchJson(url, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      setRequests((prev) => [created, ...prev]);
      setMessage("");
      setTitle("");
      setAnonymous(false);
      pushToast("Your prayer request has been shared. ??", "success");
    } catch (err) {
      console.error(err);
      pushToast("Couldn't submit. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------- RESPOND ------------------------------- */
  const handleAddResponse = async (req) => {
    if (!responseText.trim()) return;
    setResponseSubmitting(true);
    try {
      const url = `${PRAYER_REQUESTS_URL}/${req.id}/responses`;
      const created = await fetchJson(url, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ responseText: responseText.trim() }),
      });
      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, responses: [...(r.responses || []), created] }
            : r
        )
      );
      setResponseText("");
      setExpandedRespondId(null);
      pushToast("Response shared.", "success");
    } catch (err) {
      console.error(err);
      pushToast("Failed to add response.", "error");
    } finally {
      setResponseSubmitting(false);
    }
  };

  /* -------------------------------- DELETE ------------------------------- */
  const handleDeleteRequest = async (id) => {
    if (!window.confirm("Delete this prayer request permanently?")) return;
    try {
      const url = `${PRAYER_REQUESTS_URL}/${id}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed with HTTP ${res.status}`);
      }
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      pushToast("Request deleted.", "info");
    } catch (err) {
      console.error(err);
      pushToast(err?.message || "Failed to delete request.", "error");
    }
  };

  /* --------------------------- PRAYER COUNTER ---------------------------- */
  const togglePray = (id) => {
    setIPrayed((prev) => {
      const next = new Set(prev);
      const prevCount = prayerCounts[id] || 0;
      let nextCount = prevCount;
      if (next.has(id)) {
        next.delete(id);
        nextCount = Math.max(0, prevCount - 1);
      } else {
        next.add(id);
        nextCount = prevCount + 1;
        pushToast("Thank you for praying. ??", "success", 2500);
      }
      setPrayerCounts((pc) => {
        const updated = { ...pc, [id]: nextCount };
        try { localStorage.setItem(PRAYERS_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
      try { localStorage.setItem(I_PRAYED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  /* ---------------------------- ADMIN: EDIT ------------------------------ */
  const startEditRequest = (req) => {
    setEditingRequestId(req.id);
    setEditDraft({
      title: req.title || "",
      message: req.message || "",
      anonymous: Boolean(req.anonymous),
    });
    setClosingId(null);
  };

  const cancelEditRequest = () => {
    setEditingRequestId(null);
    setEditDraft({ title: "", message: "", anonymous: false });
  };

  const saveEditedRequest = async () => {
    if (!editingRequestId) return;
    if (!editDraft.message.trim()) {
      pushToast("Prayer request message is required.", "error");
      return;
    }
    setEditSubmitting(true);
    try {
      const updated = await fetchJson(`${PRAYER_REQUESTS_URL}/${editingRequestId}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: editDraft.title.trim() || null,
          message: editDraft.message.trim(),
          anonymous: Boolean(editDraft.anonymous),
        }),
      });
      setRequests((prev) => prev.map((r) => (
        r.id === editingRequestId
          ? { ...r, ...updated, title: editDraft.title.trim() || null, message: editDraft.message.trim(), anonymous: Boolean(editDraft.anonymous) }
          : r
      )));
      cancelEditRequest();
      pushToast("Prayer request updated.", "success");
    } catch (err) {
      console.error(err);
      pushToast(err?.message || "Failed to update prayer request.", "error");
    } finally {
      setEditSubmitting(false);
    }
  };
  /* ---------------------------- ADMIN: STATUS ---------------------------- */
  const handleStatusChange = async (id, newStatusRaw) => {
    const newStatus = (newStatusRaw || "").toLowerCase();
    if (!NORMALIZED_STATUSES.includes(newStatus)) return;
    setStatusUpdatingId(id);
    try {
      const url = `${PRAYER_REQUESTS_URL}/${id}`;
      const updated = await fetchJson(url, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: newStatus }),
      });
      setRequests((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, ...updated, status: newStatus } : r
        )
      );
      pushToast(`Status set to ${statusMeta(newStatus).label}.`, "info");
    } catch (e) {
      console.error(e);
      pushToast("Failed to update status.", "error");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  /* -------------------- ADMIN: CLOSE WITH COMMENT ------------------------ */
  const startClose = (req) => {
    setEditingRequestId(null);
    setClosingId(req.id);
    setCloseComment(req.closeComment || "");
  };
  const cancelClose = () => {
    setClosingId(null);
    setCloseComment("");
  };
  const handleCloseWithComment = async () => {
    if (!closingId) return;
    setCloseSubmitting(true);
    try {
      const body = {
        status: "closed",
        closeComment: closeComment.trim() || null,
      };
      const url = `${PRAYER_REQUESTS_URL}/${closingId}`;
      const updated = await fetchJson(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(body),
      });
      setRequests((prev) =>
        prev.map((r) =>
          r.id === closingId
            ? { ...r, ...updated, status: "closed", closeComment: body.closeComment }
            : r
        )
      );
      setClosingId(null);
      setCloseComment("");
      pushToast("Marked as answered. ??", "success");
    } catch (e) {
      console.error(e);
      pushToast("Failed to close prayer request.", "error");
    } finally {
      setCloseSubmitting(false);
    }
  };

  const startEditTestimony = (t) => {
    setEditingTestimonyId(t.id);
    setTestimonyDraft({
      title: t.title || "",
      testimonyText: t.testimonyText || "",
      imageUrl: t.imageUrl || "",
      voiceUrl: t.voiceUrl || "",
    });
  };

  const saveTestimony = async (id) => {
    setTestimonySaving(true);
    try {
      const updated = await fetchJson(`${PRAYER_REQUESTS_URL}/testimonies/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(testimonyDraft),
      });
      setTestimonies((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
      setEditingTestimonyId(null);
      pushToast("Testimony updated.", "success");
    } catch (err) {
      console.error(err);
      pushToast("Failed to update testimony.", "error");
    } finally {
      setTestimonySaving(false);
    }
  };

  const uploadTestimonyMedia = async (kind, file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(apiUrl("/uploads"), {
        method: "POST",
        headers: {
          ...authHeaders(),
        },
        body: form,
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Upload failed."));
      const data = await res.json();
      const url = data?.url || data?.absoluteUrl;
      if (!url) throw new Error("Upload did not return a file URL.");
      setTestimonyDraft((draft) => ({
        ...draft,
        [kind === "voice" ? "voiceUrl" : "imageUrl"]: url,
      }));
      pushToast(kind === "voice" ? "Voice record uploaded." : "Image uploaded.", "success");
    } catch (err) {
      console.error(err);
      pushToast(err?.message || "Upload failed.", "error");
    }
  };

  /* ----------------------- ADMIN: SELECTION/PRINT ------------------------ */
  const toggleSelected = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const parseBulkPrayerLines = useCallback((value) => {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+[|-]\s+/);
        if (parts.length > 1) {
          const [rawTitle, ...rest] = parts;
          return {
            title: rawTitle.slice(0, 120).trim() || null,
            message: rest.join(" - ").trim(),
          };
        }
        return { title: null, message: line };
      })
      .filter((item) => item.message);
  }, []);

  const bulkAddPreview = useMemo(
    () => parseBulkPrayerLines(bulkAddText),
    [bulkAddText, parseBulkPrayerLines]
  );

  const handleBulkAddRequests = async () => {
    if (!bulkAddPreview.length) {
      pushToast("Paste one prayer request per line to bulk add.", "error");
      return;
    }
    if (!window.confirm(`Add ${bulkAddPreview.length} prayer request${bulkAddPreview.length === 1 ? "" : "s"}?`)) return;

    setBulkSubmitting(true);
    const created = [];
    const failed = [];
    try {
      for (const item of bulkAddPreview) {
        try {
          const result = await fetchJson(`${PRAYER_REQUESTS_URL}?includeResponses=true`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              title: item.title,
              message: item.message,
              anonymous: bulkAddAnonymous,
              status: bulkAddStatus,
              assignedTo: null,
            }),
          });
          created.push(result);
        } catch (err) {
          failed.push({ item, err });
        }
      }
      if (created.length) {
        setRequests((prev) => [...created, ...prev]);
        setBulkAddText("");
        setShowBulkAdd(false);
      }
      if (failed.length) {
        pushToast(`Added ${created.length}; ${failed.length} failed. Please review and retry failed lines.`, "error", 6000);
      } else {
        pushToast(`Added ${created.length} prayer request${created.length === 1 ? "" : "s"}.`, "success");
      }
    } finally {
      setBulkSubmitting(false);
    }
  };


  const handleBulkStatusUpdate = async (newStatusRaw = bulkActionStatus, closeCommentValue = null) => {
    const ids = selectedVisibleIds;
    const newStatus = String(newStatusRaw || "").toLowerCase();
    if (!ids.length) {
      pushToast("Select one or more prayer requests first.", "error");
      return;
    }
    if (!NORMALIZED_STATUSES.includes(newStatus)) return;
    if (!window.confirm(`Update ${ids.length} selected request${ids.length === 1 ? "" : "s"} to ${statusMeta(newStatus).label}?`)) return;

    setBulkActionBusy(true);
    const updatedItems = [];
    const failed = [];
    try {
      for (const id of ids) {
        try {
          const body = { status: newStatus };
          if (closeCommentValue !== null) body.closeComment = closeCommentValue;
          const updated = await fetchJson(`${PRAYER_REQUESTS_URL}/${id}`, {
            method: "PUT",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
          });
          updatedItems.push({ id, updated, body });
        } catch (err) {
          failed.push({ id, err });
        }
      }
      if (updatedItems.length) {
        setRequests((prev) => prev.map((request) => {
          const match = updatedItems.find((item) => item.id === request.id);
          return match
            ? { ...request, ...match.updated, status: newStatus, ...(closeCommentValue !== null ? { closeComment: closeCommentValue } : {}) }
            : request;
        }));
      }
      if (failed.length) {
        pushToast(`Updated ${updatedItems.length}; ${failed.length} failed.`, "error", 6000);
      } else {
        pushToast(`Updated ${updatedItems.length} prayer request${updatedItems.length === 1 ? "" : "s"}.`, "success");
      }
    } finally {
      setBulkActionBusy(false);
    }
  };

  const handleBulkClose = () => {
    handleBulkStatusUpdate("closed", bulkCloseComment.trim() || null);
  };

  const handleBulkDelete = async () => {
    const ids = selectedVisibleIds;
    if (!ids.length) {
      pushToast("Select one or more prayer requests first.", "error");
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected prayer request${ids.length === 1 ? "" : "s"} permanently?`)) return;

    setBulkActionBusy(true);
    const deleted = [];
    const failed = [];
    try {
      for (const id of ids) {
        try {
          const res = await fetch(`${PRAYER_REQUESTS_URL}/${id}`, {
            method: "DELETE",
            headers: authHeaders(),
          });
          if (!res.ok) throw new Error(await res.text().catch(() => `Delete failed with HTTP ${res.status}`));
          deleted.push(id);
        } catch (err) {
          failed.push({ id, err });
        }
      }
      if (deleted.length) {
        setRequests((prev) => prev.filter((request) => !deleted.includes(request.id)));
        setSelectedIds((prev) => prev.filter((id) => !deleted.includes(id)));
      }
      if (failed.length) {
        pushToast(`Deleted ${deleted.length}; ${failed.length} failed.`, "error", 6000);
      } else {
        pushToast(`Deleted ${deleted.length} prayer request${deleted.length === 1 ? "" : "s"}.`, "success");
      }
    } finally {
      setBulkActionBusy(false);
    }
  };

  /* ------------------------- SORT + FILTER LIST -------------------------- */
  const sortedRequests = useMemo(
    () =>
      [...requests].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [requests]
  );

  const filteredRequests = useMemo(() => {
    let list = sortedRequests;

    if (activeTab === "mine") list = list.filter(isMine);
    else if (activeTab === "active")
      list = list.filter((r) => {
        const s = (r.status || "new").toLowerCase();
        return s !== "closed";
      });
    else if (activeTab === "answered")
      list = list.filter((r) => (r.status || "").toLowerCase() === "closed");

    if (statusFilter) {
      list = list.filter(
        (r) => (r.status || "new").toLowerCase() === statusFilter
      );
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r.title || "").toLowerCase().includes(q) ||
          (r.message || "").toLowerCase().includes(q) ||
          (r.createdBy || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [sortedRequests, activeTab, statusFilter, search, isMine]);

  /* ── Admin extended filter: date range · category · RAG · sort ─────────── */
  const adminFilteredRequests = useMemo(() => {
    let list = [...filteredRequests];

    if (adminDateFrom) {
      const from = new Date(adminDateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter(r => new Date(r.createdAt) >= from);
    }
    if (adminDateTo) {
      const to = new Date(adminDateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(r => new Date(r.createdAt) <= to);
    }
    if (adminCategory !== "all") {
      if (adminCategory === "urgent") {
        list = list.filter(r => r.ragStatus === "red");
      } else {
        list = list.filter(r => detectPrayerCategory(r) === adminCategory);
      }
    }
    if (adminRag !== "all") {
      list = list.filter(r => (r.ragStatus || "green").toLowerCase() === adminRag);
    }

    const statusOrder = { new: 0, open: 1, prayed: 2, closed: 3 };
    const ragOrd      = { red: 0, amber: 1, green: 2 };
    list.sort((a, b) => {
      let cmp = 0;
      if (adminSortBy === "date") {
        cmp = new Date(a.createdAt) - new Date(b.createdAt);
      } else if (adminSortBy === "status") {
        cmp = (statusOrder[(a.status || "new").toLowerCase()] ?? 0)
            - (statusOrder[(b.status || "new").toLowerCase()] ?? 0);
      } else if (adminSortBy === "replies") {
        const aR = Array.isArray(a.responses) ? a.responses.length : 0;
        const bR = Array.isArray(b.responses) ? b.responses.length : 0;
        cmp = aR - bR;
      } else if (adminSortBy === "rag") {
        cmp = (ragOrd[(a.ragStatus || "green").toLowerCase()] ?? 2)
            - (ragOrd[(b.ragStatus || "green").toLowerCase()] ?? 2);
      }
      return adminSortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredRequests, adminDateFrom, adminDateTo, adminCategory, adminRag, adminSortBy, adminSortDir]);

  const adminCatCounts = useMemo(() => {
    const counts = {};
    for (const cat of PRAYER_CATEGORIES) {
      if (cat.key === "all")    { counts.all    = filteredRequests.length; continue; }
      if (cat.key === "urgent") { counts.urgent = filteredRequests.filter(r => r.ragStatus === "red").length; continue; }
      counts[cat.key] = filteredRequests.filter(r => detectPrayerCategory(r) === cat.key).length;
    }
    return counts;
  }, [filteredRequests]);

  const adminActiveFilters = useMemo(() => {
    const chips = [];
    if (adminDateFrom) chips.push({ key: "dateFrom", label: `From: ${adminDateFrom}`,  clear: () => setAdminDateFrom("") });
    if (adminDateTo)   chips.push({ key: "dateTo",   label: `To: ${adminDateTo}`,      clear: () => setAdminDateTo("") });
    if (adminCategory !== "all") {
      const cat = PRAYER_CATEGORIES.find(c => c.key === adminCategory);
      chips.push({ key: "cat", label: `${cat?.emoji || ""} ${cat?.label || adminCategory}`, clear: () => setAdminCategory("all") });
    }
    if (adminRag !== "all") chips.push({ key: "rag", label: `RAG: ${adminRag}`, clear: () => setAdminRag("all") });
    return chips;
  }, [adminDateFrom, adminDateTo, adminCategory, adminRag]);

  const clearAdminFilters = () => {
    setAdminDateFrom(""); setAdminDateTo("");
    setAdminCategory("all"); setAdminRag("all");
    setAdminSortBy("date"); setAdminSortDir("desc");
  };
  /* ──────────────────────────────────────────────────────────────────────── */

  const simpleMemberRequests = useMemo(
    () => sortedRequests.filter(isMine),
    [sortedRequests, isMine]
  );

  const visibleRequestIds = useMemo(
    () => adminFilteredRequests.map((request) => request.id),
    [adminFilteredRequests]
  );

  const selectedVisibleIds = useMemo(
    () => visibleRequestIds.filter((id) => selectedIds.includes(id)),
    [selectedIds, visibleRequestIds]
  );

  const selectedAdminRequests = useMemo(
    () => adminFilteredRequests.filter((request) => selectedVisibleIds.includes(request.id)),
    [adminFilteredRequests, selectedVisibleIds]
  );

  const allSelected =
    visibleRequestIds.length > 0 &&
    visibleRequestIds.every((id) => selectedIds.includes(id));
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      if (allSelected) return prev.filter((id) => !visibleRequestIds.includes(id));
      return Array.from(new Set([...prev, ...visibleRequestIds]));
    });

  const handleExportAdminCsv = () => {
    const toExport = selectedIds.length
      ? adminFilteredRequests.filter(r => selectedIds.includes(r.id))
      : adminFilteredRequests;
    if (!toExport.length) { pushToast("Nothing to export.", "info"); return; }
    const rows = [
      ["#", "Requester", "Title", "Message", "Category", "Status", "RAG", "Created At", "Replies", "Reminders", "Close Comment"],
      ...toExport.map((req, i) => [
        i + 1,
        req.anonymous ? "Anonymous" : req.createdBy || "Member",
        req.title || "",
        req.message || "",
        detectPrayerCategory(req) || "",
        req.status || "new",
        req.ragStatus || "green",
        new Date(req.createdAt).toLocaleString(),
        Array.isArray(req.responses) ? req.responses.length : 0,
        req.reminderCount || 0,
        req.closeComment || "",
      ]),
    ];
    downloadCsv(`prayer-requests-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    pushToast(`Exported ${toExport.length} prayer request${toExport.length !== 1 ? "s" : ""}.`, "success");
  };

  /* ------------------------------- STATS --------------------------------- */
  const stats = useMemo(() => {
    const now = Date.now();
    const week = 7 * 24 * 3600 * 1000;
    const thisWeek = sortedRequests.filter(
      (r) => now - new Date(r.createdAt).getTime() < week
    ).length;
    const answered = sortedRequests.filter(
      (r) => (r.status || "").toLowerCase() === "closed"
    ).length;
    const prayed = sortedRequests.filter(
      (r) => (r.status || "").toLowerCase() === "prayed"
    ).length;
    return {
      total: sortedRequests.length,
      thisWeek,
      answered,
      prayed,
    };
  }, [sortedRequests]);

  const metricsGraphData = useMemo(() => {
    const statusLabels = {
      new: "New",
      open: "Open",
      prayed: "Prayed",
      closed: "Answered",
    };
    const statusColors = {
      new: "#10b981",
      open: "#0ea5e9",
      prayed: "#8b5cf6",
      closed: "#334155",
    };
    const ragLabels = { red: "Urgent", amber: "Watch", green: "Steady" };
    const ragColors = { red: "#dc2626", amber: "#d97706", green: "#059669" };

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const allCreatedDates = sortedRequests
      .map((request) => new Date(request.createdAt))
      .filter((date) => Number.isFinite(date.getTime()))
      .sort((a, b) => a - b);
    const firstCreated = allCreatedDates[0] ? new Date(allCreatedDates[0]) : new Date(today);
    firstCreated.setHours(0, 0, 0, 0);

    let start = new Date(today);
    let end = new Date(today);
    if (metricsRange === "custom") {
      start = metricsDateFrom ? new Date(`${metricsDateFrom}T00:00:00`) : new Date(firstCreated);
      end = metricsDateTo ? new Date(`${metricsDateTo}T23:59:59`) : new Date(today);
    } else if (metricsRange === "all") {
      start = new Date(firstCreated);
    } else {
      const days = Number(metricsRange) || 30;
      start.setDate(today.getDate() - days + 1);
      start.setHours(0, 0, 0, 0);
    }
    if (!Number.isFinite(start.getTime())) start = new Date(firstCreated);
    if (!Number.isFinite(end.getTime())) end = new Date(today);
    if (start > end) [start, end] = [end, start];

    const statusCounts = { new: 0, open: 0, prayed: 0, closed: 0 };
    const ragCounts = { red: 0, amber: 0, green: 0 };
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.max(1, Math.round((end - start) / dayMs) + 1);
    const bucketMode = spanDays > 180 ? "month" : spanDays > 62 ? "week" : "day";

    const bucketKeyFor = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      if (bucketMode === "month") {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      if (bucketMode === "week") {
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1);
      }
      return d.toISOString().slice(0, 10);
    };

    const bucketLabelFor = (key) => {
      if (bucketMode === "month") {
        const [year, month] = key.split("-").map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      }
      const d = new Date(`${key}T00:00:00`);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };

    const bucketMap = new Map();
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = bucketKeyFor(cursor);
      if (!bucketMap.has(key)) {
        bucketMap.set(key, { key, label: bucketLabelFor(key), requests: 0, answered: 0 });
      }
    }

    const rangeRequests = sortedRequests.filter((request) => {
      const created = new Date(request.createdAt);
      return Number.isFinite(created.getTime()) && created >= start && created <= end;
    });

    rangeRequests.forEach((request) => {
      const status = NORMALIZED_STATUSES.includes(String(request.status || "new").toLowerCase())
        ? String(request.status || "new").toLowerCase()
        : "new";
      statusCounts[status] += 1;

      const rag = ["red", "amber", "green"].includes(String(request.ragStatus || "green").toLowerCase())
        ? String(request.ragStatus || "green").toLowerCase()
        : "green";
      ragCounts[rag] += 1;

      const bucket = bucketMap.get(bucketKeyFor(new Date(request.createdAt)));
      if (bucket) {
        bucket.requests += 1;
        if (status === "closed") bucket.answered += 1;
      }
    });

    const totalInRange = rangeRequests.length;
    return {
      rangeLabel: `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`,
      bucketMode,
      total: totalInRange,
      status: Object.keys(statusCounts).map((key) => ({
        key,
        name: statusLabels[key],
        value: statusCounts[key],
        color: statusColors[key],
        pct: totalInRange ? Math.round((statusCounts[key] / totalInRange) * 100) : 0,
      })),
      rag: Object.keys(ragCounts).map((key) => ({
        key,
        name: ragLabels[key],
        value: ragCounts[key],
        color: ragColors[key],
        pct: totalInRange ? Math.round((ragCounts[key] / totalInRange) * 100) : 0,
      })),
      trend: Array.from(bucketMap.values()),
    };
  }, [metricsDateFrom, metricsDateTo, metricsRange, sortedRequests]);

  /* -------------------------------- PRINT -------------------------------- */
  const handlePrintSelected = () => {
    const selectedVisible = selectedVisibleIds.length
      ? adminFilteredRequests.filter((r) => selectedVisibleIds.includes(r.id))
      : [];
    const selected = selectedVisible.length ? selectedVisible : adminFilteredRequests;
    if (!selected.length) return;
    const now = new Date();
    const htmlRows = selected
      .map((req) => {
        const responsesHtml = Array.isArray(req.responses)
          ? req.responses
              .map(
                (res) =>
                  `<li><strong>${
                    res.respondedBy || res.author || "Team"
                  }:</strong> ${(res.responseText || res.message || "")
                    .toString()
                    .replace(/</g, "&lt;")}</li>`
              )
              .join("")
          : "";
        return `
        <tr>
          <td>${req.anonymous ? "Anonymous" : req.createdBy || "Member"}</td>
          <td>${req.title || "—"}</td>
          <td>
            <div>${(req.message || "").toString().replace(/</g, "&lt;")}</div>
            ${responsesHtml ? `<ul style="margin-top:4px;padding-left:16px;font-size:11px;">${responsesHtml}</ul>` : ""}
          </td>
          <td>${new Date(req.createdAt).toLocaleString()}</td>
          <td>${req.status || "new"}</td>
        </tr>`;
      })
      .join("");
    const printTemplate = window.__mahimaPrintTemplate || {};
    const printName = printTemplate.organizationName || "Church";
    const printLogo = printTemplate.showLogo !== false ? resolveLogoUrl(printTemplate.logoUrl || "") : "";
    const printColor = printTemplate.primaryColor || "#047857";
    const html = `
      <html>
        <head>
          <title>Prayer Requests</title>
          <style>
            body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            h2 { font-size: 14px; margin-top: 0; color: #555; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; vertical-align: top; }
            th { background: #f5f5f5; text-align: left; }
          </style>
        </head>
        <body>
          <h1>${printName} – Prayer Requests</h1>
          <h2>Printed at ${now.toLocaleString()} • ${selectedVisibleIds.length ? `${selectedVisibleIds.length} selected` : `${selected.length} filtered`}</h2>
          <table>
            <thead>
              <tr>
                <th>Requester</th><th>Title</th><th>Message &amp; Responses</th>
                <th>Created At</th><th>Status</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </body>
      </html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const eligibleNightPrayerRequests = useMemo(() => {
    const statusWeight = { new: 30, open: 24, prayed: 12 };
    const ragWeight = { red: 28, amber: 16, green: 4 };

    return sortedRequests
      .filter((req) => (req.status || "new").toLowerCase() !== "closed")
      .map((req) => {
        const status = (req.status || "new").toLowerCase();
        const rag = (req.ragStatus || "green").toLowerCase();
        const responses = Array.isArray(req.responses) ? req.responses : [];
        const hours = ageHours(req.createdAt);
        const days = Math.floor(hours / 24);
        const noReplies = responses.length === 0;
        const reminderCount = Number(req.reminderCount || 0);
        const score =
          (statusWeight[status] || 10) +
          (ragWeight[rag] || 4) +
          Math.min(days, 21) +
          (noReplies ? 18 : 0) +
          (reminderCount > 0 ? 4 : 0);
        const focus =
          rag === "red" ? "Urgent pastoral covering" :
          noReplies ? "Call-center follow-up before night prayer" :
          status === "prayed" ? "Continue in night prayer until testimony is confirmed" :
          "Night prayer intercession";
        const lastResponse = responses.length
          ? responses
              .slice()
              .sort((a, b) => new Date(b.respondedAt || b.createdAt || 0) - new Date(a.respondedAt || a.createdAt || 0))[0]
          : null;

        return { req, status, rag, responses, hours, days, noReplies, reminderCount, score, focus, lastResponse };
      })
      .sort((a, b) => b.score - a.score || new Date(a.req.createdAt) - new Date(b.req.createdAt));
  }, [sortedRequests]);

  const handleExportNightPrayerReport = () => {
    const now = new Date();
    const day = now.getDay();
    const isNightPrayerDay = day === 2 || day === 5;
    const reportRows = eligibleNightPrayerRequests;

    if (!reportRows.length) {
      pushToast("No unanswered prayer requests are eligible for the night prayer report.", "info");
      return;
    }

    if (!isNightPrayerDay) {
      pushToast("Night Prayer report is designed for Tuesday and Friday. Printable report opened for preparation review.", "info", 5500);
    }

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));

    const total = reportRows.length;
    const urgent = reportRows.filter((row) => row.rag === "red").length;
    const followUps = reportRows.filter((row) => row.noReplies).length;
    const prayed = reportRows.filter((row) => row.status === "prayed").length;
    const generatedAt = now.toLocaleString();
    const nightPrayerDay = day === 2 ? "Tuesday Night Prayer" : day === 5 ? "Friday Night Prayer" : "Night Prayer Preparation";

    const prayerCards = reportRows.map((row, index) => {
      const requester = row.req.anonymous ? "Anonymous" : row.req.createdBy || "Member";
      const title = row.req.title || "Prayer request";
      const message = row.req.message || "";
      const status = statusMeta(row.status).label;
      const rag = ragMeta(row.rag).label;
      const ragClass = row.rag === "red" ? "danger" : row.rag === "amber" ? "watch" : "steady";
      const lastResponse = row.lastResponse
        ? `${row.lastResponse.respondedBy || row.lastResponse.author || "Team"}: ${row.lastResponse.responseText || row.lastResponse.message || ""}`
        : "No team response yet";

      return `
        <article class="prayer-card ${ragClass}">
          <div class="rank">#${index + 1}</div>
          <div class="card-body">
            <div class="card-top">
              <div>
                <h2>${escapeHtml(title)}</h2>
                <p class="requester">${escapeHtml(requester)} | ${escapeHtml(status)} | ${row.days} day(s) old</p>
              </div>
              <div class="badges">
                <span class="badge ${ragClass}">${escapeHtml(rag)}</span>
                <span class="badge">Replies ${row.responses.length}</span>
                <span class="badge">Reminders ${row.reminderCount}</span>
              </div>
            </div>
            <div class="message">${escapeHtml(message).replace(/\n/g, "<br />")}</div>
            <div class="intelligence">
              <strong>Prayer focus:</strong> ${escapeHtml(row.focus)}
            </div>
            <div class="response">
              <strong>Last follow-up:</strong> ${escapeHtml(lastResponse)}
            </div>
          </div>
        </article>`;
    }).join("");

    const html = `
      <html>
        <head>
          <title>${escapeHtml(nightPrayerDay)} - Prayer Intelligence</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #0f172a; background: #f8fafc; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
            .page { max-width: 960px; margin: 0 auto; background: #fff; min-height: 100vh; }
            .hero { padding: 28px 30px 22px; background: ${escapeHtml(printColor)}; color: #fff; }
            .tenant-logo { max-width: 88px; max-height: 54px; object-fit: contain; margin-bottom: 10px; background: white; border-radius: 6px; padding: 4px; }
            .eyebrow { font-size: 11px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.82; }
            h1 { margin: 8px 0 6px; font-size: 30px; line-height: 1.05; }
            .subtitle { margin: 0; max-width: 720px; font-size: 13px; line-height: 1.55; color: #d1fae5; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 16px 30px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
            .metric { border: 1px solid #dbeafe; border-radius: 10px; background: #fff; padding: 12px; }
            .metric strong { display: block; font-size: 24px; line-height: 1; }
            .metric span { display: block; margin-top: 5px; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
            .section-title { padding: 18px 30px 8px; display: flex; justify-content: space-between; gap: 16px; align-items: end; }
            .section-title h2 { margin: 0; font-size: 17px; }
            .section-title p { margin: 0; font-size: 11px; color: #64748b; font-weight: 700; }
            .cards { padding: 0 30px 28px; }
            .prayer-card { position: relative; display: grid; grid-template-columns: 54px 1fr; gap: 12px; margin-top: 12px; border: 1px solid #e2e8f0; border-left-width: 5px; border-radius: 12px; background: #fff; page-break-inside: avoid; overflow: hidden; }
            .prayer-card.danger { border-left-color: #dc2626; }
            .prayer-card.watch { border-left-color: #d97706; }
            .prayer-card.steady { border-left-color: #059669; }
            .rank { display: grid; place-items: center; background: #f1f5f9; font-size: 16px; font-weight: 900; color: #334155; }
            .card-body { padding: 14px 14px 14px 0; }
            .card-top { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
            .card-top h2 { margin: 0; font-size: 15px; line-height: 1.3; }
            .requester { margin: 4px 0 0; font-size: 11px; color: #64748b; font-weight: 800; }
            .badges { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
            .badge { border: 1px solid #e2e8f0; border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 900; color: #475569; background: #f8fafc; white-space: nowrap; }
            .badge.danger { border-color: #fecaca; color: #b91c1c; background: #fef2f2; }
            .badge.watch { border-color: #fde68a; color: #92400e; background: #fffbeb; }
            .badge.steady { border-color: #bbf7d0; color: #047857; background: #ecfdf5; }
            .message { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: #f8fafc; font-size: 12px; line-height: 1.55; color: #1f2937; }
            .intelligence, .response { margin-top: 8px; font-size: 11px; line-height: 1.45; color: #475569; }
            .intelligence strong, .response strong { color: #0f172a; }
            .footer { padding: 14px 30px 24px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10px; display: flex; justify-content: space-between; gap: 12px; }
            .print-actions { position: sticky; top: 0; z-index: 5; display: flex; justify-content: flex-end; gap: 8px; padding: 10px; background: rgba(248,250,252,.92); border-bottom: 1px solid #e2e8f0; }
            .print-actions button { border: 0; border-radius: 8px; background: #047857; color: #fff; padding: 9px 14px; font-weight: 900; cursor: pointer; }
            .print-actions .secondary { background: #334155; }
            @media print {
              body { background: #fff; }
              .page { max-width: none; }
              .print-actions { display: none; }
              .hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .metric, .rank, .message, .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="print-actions">
            <button type="button" onclick="window.print()">Print / Save PDF</button>
            <button type="button" class="secondary" onclick="window.close()">Close</button>
          </div>
          <main class="page">
            <section class="hero">
              ${printLogo ? `<img class="tenant-logo" src="${escapeHtml(printLogo)}" alt="Logo" />` : ""}
              <div class="eyebrow">${escapeHtml(printName)}</div>
              <h1>${escapeHtml(nightPrayerDay)}</h1>
              <p class="subtitle">Unanswered prayer intelligence prepared for intercession, pastoral covering, and call-center follow-up. Generated ${escapeHtml(generatedAt)}.</p>
            </section>
            <section class="summary">
              <div class="metric"><strong>${total}</strong><span>Unanswered</span></div>
              <div class="metric"><strong>${urgent}</strong><span>Urgent RAG</span></div>
              <div class="metric"><strong>${followUps}</strong><span>Need First Response</span></div>
              <div class="metric"><strong>${prayed}</strong><span>Awaiting Testimony</span></div>
            </section>
            <section class="section-title">
              <div>
                <h2>Prioritized Prayer List</h2>
                <p>Sorted by urgency, age, response gap, and prayer status.</p>
              </div>
              <p>${escapeHtml(isNightPrayerDay ? "Night prayer day" : "Preparation export")}</p>
            </section>
            <section class="cards">${prayerCards}</section>
            <footer class="footer">
              <span>${escapeHtml(printTemplate.footerText || `Generated by ${printName} Prayer Intelligence`)}</span>
              <span>${escapeHtml(printTemplate.showAddress !== false ? (printTemplate.address || "Use for pastoral ministry only") : "Use for pastoral ministry only")}</span>
            </footer>
          </main>
          <script>window.onload = function(){ setTimeout(function(){ window.focus(); window.print(); }, 250); };</script>
        </body>
      </html>`;

    const w = window.open("", "_blank");
    if (!w) {
      pushToast("Popup blocked. Please allow popups and click Night Prayer Export again.", "error");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    pushToast(`Printable Night Prayer report opened: ${total} unanswered prayers, ${urgent} urgent.`, "success", 5500);
  };
  /* ================================ UI =================================== */

  const TABS = [
    { id: "all",      label: "All",      count: sortedRequests.length },
    { id: "mine",     label: "Mine",     count: sortedRequests.filter(isMine).length },
    { id: "active",   label: "Active",   count: sortedRequests.filter((r) => (r.status||"new").toLowerCase()!=="closed").length },
    { id: "answered", label: "Answered", count: stats.answered },
  ];

  const adminInsights = useMemo(() => {
    const counts = { new: 0, open: 0, prayed: 0, closed: 0, reminders: 0, remindersToday: 0, red: 0, amber: 0, green: 0 };
    sortedRequests.forEach((request) => {
      const status = (request.status || "new").toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
      counts.reminders += Number(request.reminderCount || 0);
      counts.remindersToday += Number(request.reminderTodayCount || 0);
      const rag = String(request.ragStatus || "green").toLowerCase();
      if (rag === "red") counts.red += 1;
      else if (rag === "amber") counts.amber += 1;
      else counts.green += 1;
    });
    return counts;
  }, [sortedRequests]);

  const activeQueue = sortedRequests.filter((request) => (request.status || "new").toLowerCase() !== "closed").slice(0, 5);

  if (!isAdmin) {
    return (
      <SimplePrayerRequestsView
        toasts={toasts}
        onDismissToast={dismissToast}
        requests={simpleMemberRequests}
        loading={loading}
        message={message}
        setMessage={setMessage}
        title={title}
        setTitle={setTitle}
        anonymous={anonymous}
        setAnonymous={setAnonymous}
        submitting={submitting}
        onSubmit={handleSubmit}
        voiceLang={voiceLang}
        setVoiceLang={setVoiceLang}
        voiceBusy={voiceBusy}
        voiceListening={voiceListening}
        startVoiceCapture={startVoiceCapture}
        onDelete={handleDeleteRequest}
      />
    );
  }

  return (
    <div className="prayer-wall-page min-h-screen bg-[#f5f7fb]">
      <Toasts items={toasts} onDismiss={dismissToast} />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="prayer-admin-shell overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="prayer-wall-hero grid gap-6 border-b border-slate-100 bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 p-5 text-white sm:p-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-50">
                <HandHeart className="h-4 w-4 text-emerald-200" />
                Community care
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Prayer Wall</h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-emerald-50">
                A shared place for requests, encouragement, follow-up, and answered prayer testimonies.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <StatCard icon={MessageCircle} label="Total" value={stats.total} accent="text-slate-950 bg-white" compact />
                <StatCard icon={Calendar} label="This week" value={stats.thisWeek} accent="text-sky-700 bg-sky-50" compact />
                <StatCard icon={HandHeart} label="Being prayed for" value={stats.prayed} accent="text-violet-700 bg-violet-50" compact />
                <StatCard icon={CheckCircle2} label="Answered" value={stats.answered} accent="text-emerald-700 bg-emerald-50" compact />
              </div>
            </div>

            <div className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-emerald-800">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black">Today&apos;s care queue</h2>
                  <p className="mt-1 text-sm font-semibold text-emerald-50">{activeQueue.length} active requests need prayer or follow-up.</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {activeQueue.length ? activeQueue.map((request) => (
                  <button key={request.id} type="button" onClick={() => { setChildApplet("prayers"); setActiveTab("all"); setStatusFilter((request.status || "new").toLowerCase()); }} className="flex w-full items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2 text-left text-sm font-bold text-white hover:bg-white/15">
                    <span className="truncate">{request.title || request.message || "Prayer request"}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${statusMeta(request.status).chip}`}>{statusMeta(request.status).label}</span>
                  </button>
                )) : (
                  <div className="rounded-lg bg-white/10 px-3 py-3 text-sm font-semibold text-emerald-50">No active prayer requests right now.</div>
                )}
              </div>
            </div>
          </div>

          <div className="prayer-content-grid grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
            {!isAdmin && <aside className="space-y-5">
              <form onSubmit={handleSubmit} className="prayer-compose-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-800">
                    <Send className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-950">Share a Request</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">Type it, or tap the mic and speak it. Review once, then share.</p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-black text-emerald-950">Speak instead of typing</div>
                      <div className="text-xs font-semibold leading-5 text-emerald-800">Tap the mic, speak your request, then review the text before sharing.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startVoiceCapture(voiceLang)}
                      disabled={voiceBusy}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black shadow-sm transition disabled:opacity-60 ${voiceListening ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}
                    >
                      {voiceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : voiceListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {voiceListening ? "Stop listening" : "Start voice request"}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ["en-IN", "English"],
                      ["hi-IN", "Hindi"],
                      ["pa-IN", "Punjabi"],
                    ].map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setVoiceLang(code)}
                        className={`rounded-full border px-3 py-1 text-xs font-black ${voiceLang === code ? "border-emerald-700 bg-white text-emerald-800" : "border-emerald-200 bg-emerald-100/70 text-emerald-800 hover:bg-white"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={7}
                    maxLength={1000}
                    placeholder="Type here, or use the mic above and your spoken request will appear here..."
                    className="min-h-44 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-base font-semibold leading-7 text-slate-900 outline-none ring-emerald-100 transition focus:bg-white focus:ring-4"
                  />
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Optional title"
                    maxLength={120}
                    className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-emerald-100 transition focus:ring-4"
                  />
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                    <input type="checkbox" className="h-4 w-4 accent-emerald-700" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                    {anonymous ? <Lock className="h-4 w-4 text-slate-500" /> : <Globe className="h-4 w-4 text-slate-500" />}
                    {anonymous ? "Anonymous" : "Post as me"}
                  </label>
                  <span className="text-xs font-bold text-slate-400">{message.length}/1000</span>
                </div>
                <button type="submit" disabled={submitting || !message.trim()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "Sharing..." : "Share Prayer Request"}
                </button>
              </form>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black text-slate-950">Prayer Flow</h2>
                <div className="mt-4 space-y-3">
                  {[
                    ["New", "Request is received by the community."],
                    ["Open", "A leader or prayer partner is following up."],
                    ["Prayed", "The request is actively covered in prayer."],
                    ["Answered", "Closed with a testimony or response."],
                  ].map(([label, copy]) => (
                    <div key={label} className="flex gap-3 rounded-lg bg-slate-50 p-3">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusMeta(label.toLowerCase() === "answered" ? "closed" : label.toLowerCase()).dot}`} />
                      <div>
                        <div className="text-sm font-black text-slate-900">{label}</div>
                        <div className="text-xs font-semibold leading-5 text-slate-500">{copy}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </aside>}

            <main className="min-w-0 space-y-5">
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
                <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1">
                  <button type="button" onClick={() => setChildApplet("entry")} className={`rounded-md px-4 py-2 text-sm font-black ${childApplet === "entry" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>Prayer Entry</button>
                  <button type="button" onClick={() => setChildApplet("prayers")} className={`rounded-md px-4 py-2 text-sm font-black ${childApplet === "prayers" ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>Prayer Wall</button>
                  <button type="button" onClick={() => setChildApplet("testimonies")} className={`rounded-md px-4 py-2 text-sm font-black ${childApplet === "testimonies" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>Testimonies</button>
                </div>
                {childApplet === "prayers" && (
                  <div className="relative w-full xl:max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, message, or person" className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-semibold outline-none ring-emerald-100 focus:bg-white focus:ring-4" />
                  </div>
                )}
              </div>

              {childApplet === "entry" && (
                <SimplePrayerRequestsView
                  toasts={[]}
                  onDismissToast={dismissToast}
                  requests={simpleMemberRequests}
                  loading={loading}
                  message={message}
                  setMessage={setMessage}
                  title={title}
                  setTitle={setTitle}
                  anonymous={anonymous}
                  setAnonymous={setAnonymous}
                  submitting={submitting}
                  onSubmit={handleSubmit}
                  voiceLang={voiceLang}
                  setVoiceLang={setVoiceLang}
                  voiceBusy={voiceBusy}
                  voiceListening={voiceListening}
                  startVoiceCapture={startVoiceCapture}
                  onDelete={handleDeleteRequest}
                  embedded
                />
              )}

              {childApplet === "testimonies" && (
                <TestimoniesApplet
                  testimonies={testimonies}
                  loading={testimoniesLoading}
                  editingId={editingTestimonyId}
                  draft={testimonyDraft}
                  setDraft={setTestimonyDraft}
                  onEdit={startEditTestimony}
                  onCancel={() => setEditingTestimonyId(null)}
                  onSave={saveTestimony}
                  saving={testimonySaving}
                  onUpload={uploadTestimonyMedia}
                  canBackfillHindi={isAdmin}
                  onBackfillHindi={backfillHindiTestimonies}
                  backfillRunning={testimonyBackfillRunning}
                />
              )}

              {childApplet === "prayers" && (
                <>
                  <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-100 p-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex items-center gap-1 overflow-x-auto">
                        {TABS.map((tab) => (
                          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`shrink-0 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition ${activeTab === tab.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                            {tab.label}
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${activeTab === tab.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>{tab.count}</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wide text-slate-400"><Filter className="h-3.5 w-3.5" /> Status</span>
                        <ChipButton active={statusFilter === null} onClick={() => setStatusFilter(null)}>Any</ChipButton>
                        {NORMALIZED_STATUSES.map((status) => {
                          const meta = statusMeta(status);
                          return (
                            <ChipButton key={status} active={statusFilter === status} onClick={() => setStatusFilter(statusFilter === status ? null : status)} className={statusFilter === status ? meta.chip : ""}>
                              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </ChipButton>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  {isAdmin && (
                    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-950 text-white">
                            <Sparkles className="h-5 w-5" />
                          </div>
                          <div>
                            <h2 className="text-lg font-black text-slate-950">Admin Prayer Desk</h2>
                            <p className="text-sm font-semibold text-slate-500">Review and manage every prayer request from one focused workspace.</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => setShowBulkAdd((value) => !value)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition ${showBulkAdd ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"}`}>
                            <PlusCircle className="h-4 w-4" /> Bulk Add
                          </button>
                          <button type="button" onClick={() => setShowAdminMetrics((value) => !value)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-black transition ${showAdminMetrics ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                            <ClipboardList className="h-4 w-4" /> Insights {showAdminMetrics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          <button type="button" onClick={handlePrintSelected} disabled={!adminFilteredRequests.length && !selectedVisibleIds.length} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                            <Printer className="h-4 w-4" /> {selectedVisibleIds.length ? `Print (${selectedVisibleIds.length})` : `Print (${adminFilteredRequests.length})`}
                          </button>
                          <button type="button" onClick={handleExportAdminCsv} disabled={!adminFilteredRequests.length} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                            <Download className="h-4 w-4" /> Export CSV
                          </button>
                          <button type="button" onClick={() => setShowAdminTable((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white hover:bg-slate-800">
                            {showAdminTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {showAdminTable ? "Hide requests" : "Show requests"}
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard icon={AlertCircle} label="New" value={adminInsights.new || 0} accent="text-emerald-700 bg-emerald-50" />
                        <StatCard icon={Clock} label="Open" value={adminInsights.open || 0} accent="text-sky-700 bg-sky-50" />
                        <StatCard icon={HandHeart} label="Prayed" value={adminInsights.prayed || 0} accent="text-violet-700 bg-violet-50" />
                        <StatCard icon={CheckCheck} label="Answered" value={adminInsights.closed || 0} accent="text-slate-700 bg-slate-100" />
                      </div>

                      {(adminInsights.red > 0 || adminInsights.remindersToday > 0) && <div className="mx-4 mb-4 flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black text-amber-900">
                        {adminInsights.red > 0 && <span>{adminInsights.red} urgent request{adminInsights.red === 1 ? "" : "s"}</span>}
                        {adminInsights.red > 0 && adminInsights.remindersToday > 0 && <span aria-hidden="true">•</span>}
                        {adminInsights.remindersToday > 0 && <span>{adminInsights.remindersToday} reminder{adminInsights.remindersToday === 1 ? "" : "s"} due today</span>}
                      </div>}

                      {showAdminMetrics && <PrayerMetricsGraph
                        data={metricsGraphData}
                        range={metricsRange}
                        onRangeChange={setMetricsRange}
                        dateFrom={metricsDateFrom}
                        dateTo={metricsDateTo}
                        onDateFromChange={setMetricsDateFrom}
                        onDateToChange={setMetricsDateTo}
                      />}

                      {showBulkAdd && (
                        <div className="border-t border-slate-100 bg-emerald-50/40 p-4">
                          <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <h3 className="flex items-center gap-2 text-sm font-black text-slate-950"><PlusCircle className="h-4 w-4 text-emerald-700" /> Bulk add prayer requests</h3>
                                <p className="mt-1 text-xs font-semibold text-slate-500">Paste one request per line. Use "Title - message" or "Title | message" when you want a separate title.</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <select value={bulkAddStatus} onChange={(e) => setBulkAddStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none ring-emerald-100 focus:ring-4">
                                  <option value="new">New</option>
                                  <option value="open">Open</option>
                                  <option value="prayed">Prayed</option>
                                </select>
                                <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
                                  <input type="checkbox" checked={bulkAddAnonymous} onChange={(e) => setBulkAddAnonymous(e.target.checked)} className="h-4 w-4 accent-emerald-700" /> Anonymous
                                </label>
                              </div>
                            </div>
                            <textarea value={bulkAddText} onChange={(e) => setBulkAddText(e.target.value)} rows={5} placeholder={"Healing request - Please pray for surgery recovery\nFamily - Pray for peace at home"} className="mt-3 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-800 outline-none ring-emerald-100 transition focus:bg-white focus:ring-4" />
                            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="text-xs font-semibold text-slate-500">
                                <span className="font-black text-slate-900">{bulkAddPreview.length}</span> ready to add
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => { setBulkAddText(""); setShowBulkAdd(false); }} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Cancel</button>
                                <button type="button" onClick={handleBulkAddRequests} disabled={bulkSubmitting || !bulkAddPreview.length} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                                  {bulkSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
                                  Add {bulkAddPreview.length || ""}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="border-t border-slate-100 bg-white px-4 py-3">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`grid h-10 w-10 place-items-center rounded-lg ${selectedVisibleIds.length ? "bg-slate-950 text-white" : "bg-white text-slate-400 border border-slate-200"}`}>
                                <ClipboardList className="h-5 w-5" />
                              </div>
                              <div>
                                <h3 className="text-sm font-black text-slate-950">Bulk actions</h3>
                                <p className="text-xs font-semibold text-slate-500">{selectedVisibleIds.length} selected from {adminFilteredRequests.length} filtered requests.</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={bulkActionStatus} onChange={(e) => setBulkActionStatus(e.target.value)} disabled={!selectedVisibleIds.length || bulkActionBusy} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none ring-slate-100 focus:ring-4 disabled:opacity-50">
                                <option value="new">Set New</option>
                                <option value="open">Set Open</option>
                                <option value="prayed">Set Prayed</option>
                                <option value="closed">Set Answered</option>
                              </select>
                              <button type="button" onClick={() => handleBulkStatusUpdate()} disabled={!selectedVisibleIds.length || bulkActionBusy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                                {bulkActionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                                Update selected
                              </button>
                              <button type="button" onClick={handleBulkDelete} disabled={!selectedVisibleIds.length || bulkActionBusy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete selected</button>
                            </div>
                          </div>
                          {selectedVisibleIds.length > 0 && (
                            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
                              <textarea value={bulkCloseComment} onChange={(e) => setBulkCloseComment(e.target.value)} rows={2} placeholder="Optional answered-prayer note for all selected requests" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none ring-emerald-100 focus:ring-4" />
                              <button type="button" onClick={handleBulkClose} disabled={bulkActionBusy} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"><CheckCheck className="h-3.5 w-3.5" /> Mark answered</button>
                            </div>
                          )}
                          {selectedAdminRequests.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {selectedAdminRequests.slice(0, 5).map((request) => (
                                <span key={request.id} className="inline-flex max-w-xs items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">
                                  <span className="truncate">#{request.id} {request.title || request.message}</span>
                                </span>
                              ))}
                              {selectedAdminRequests.length > 5 && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-600">+{selectedAdminRequests.length - 5} more</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ══ ADVANCED FILTER PANEL ════════════════════════════════════════ */}
                      <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                        {/* Toggle row */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setShowAdminFilters(v => !v)}
                              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black transition ${
                                showAdminFilters
                                  ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <Filter className="h-3.5 w-3.5" />
                              Advanced Filters
                              {adminActiveFilters.length > 0 && (
                                <span className="rounded-full bg-indigo-700 px-1.5 py-0.5 text-[10px] font-black text-white">{adminActiveFilters.length}</span>
                              )}
                              {showAdminFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                            {adminActiveFilters.length > 0 && (
                              <button
                                type="button"
                                onClick={clearAdminFilters}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100"
                              >
                                <X className="h-3 w-3" /> Clear all
                              </button>
                            )}
                          </div>
                          <span className="text-xs font-semibold text-slate-500">
                            Showing{" "}
                            <span className="font-black text-slate-800">{adminFilteredRequests.length}</span>
                            {" "}of {requests.length} requests
                          </span>
                        </div>

                        {/* Expanded panel */}
                        {showAdminFilters && (
                          <div className="mt-3 space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

                            {/* ── Date Range ─────────────────────────────── */}
                            <div>
                              <div className="mb-2 flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Date Range</span>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-xs font-bold text-slate-600">From</label>
                                  <input
                                    type="date"
                                    value={adminDateFrom}
                                    onChange={e => setAdminDateFrom(e.target.value)}
                                    max={adminDateTo || undefined}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-indigo-100 transition focus:bg-white focus:ring-4"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs font-bold text-slate-600">To</label>
                                  <input
                                    type="date"
                                    value={adminDateTo}
                                    onChange={e => setAdminDateTo(e.target.value)}
                                    min={adminDateFrom || undefined}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-indigo-100 transition focus:bg-white focus:ring-4"
                                  />
                                </div>
                              </div>
                              {(adminDateFrom || adminDateTo) && (
                                <button
                                  type="button"
                                  onClick={() => { setAdminDateFrom(""); setAdminDateTo(""); }}
                                  className="mt-1.5 text-xs font-bold text-rose-600 hover:underline"
                                >
                                  Clear dates
                                </button>
                              )}
                            </div>

                            {/* ── Category ───────────────────────────────── */}
                            <div>
                              <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">Category</span>
                              <div className="flex flex-wrap gap-2">
                                {PRAYER_CATEGORIES.map(cat => {
                                  const cnt = adminCatCounts[cat.key] ?? 0;
                                  if (cat.key !== "all" && cat.key !== "urgent" && cnt === 0) return null;
                                  if (cat.key === "urgent" && cnt === 0) return null;
                                  const active = adminCategory === cat.key;
                                  return (
                                    <button
                                      key={cat.key}
                                      type="button"
                                      onClick={() => setAdminCategory(active ? "all" : cat.key)}
                                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                                        active
                                          ? "border-indigo-700 bg-indigo-700 text-white"
                                          : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                                      }`}
                                    >
                                      <span role="img" aria-label={cat.label}>{cat.emoji}</span>
                                      {cat.label}
                                      <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>{cnt}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* ── RAG + Sort ─────────────────────────────── */}
                            <div className="grid gap-5 sm:grid-cols-2">
                              {/* RAG status */}
                              <div>
                                <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">RAG Status</span>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    { key: "all",   label: "All",         cls: "border-slate-200 bg-white text-slate-700" },
                                    { key: "red",   label: "🔴 Urgent",    cls: "border-red-200 bg-red-50 text-red-700" },
                                    { key: "amber", label: "🟡 Watch",     cls: "border-amber-200 bg-amber-50 text-amber-700" },
                                    { key: "green", label: "🟢 Steady",    cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
                                  ].map(({ key, label, cls }) => (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => setAdminRag(adminRag === key ? "all" : key)}
                                      className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                                        adminRag === key
                                          ? "border-slate-950 bg-slate-950 text-white"
                                          : `${cls} hover:border-slate-400`
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Sort */}
                              <div>
                                <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">Sort By</span>
                                <div className="flex items-center gap-2">
                                  <select
                                    value={adminSortBy}
                                    onChange={e => setAdminSortBy(e.target.value)}
                                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none ring-indigo-100 focus:ring-4"
                                  >
                                    <option value="date">Date Submitted</option>
                                    <option value="status">Status</option>
                                    <option value="replies">Replies Count</option>
                                    <option value="rag">RAG Priority</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => setAdminSortDir(d => d === "asc" ? "desc" : "asc")}
                                    title={adminSortDir === "desc" ? "Newest / Highest first" : "Oldest / Lowest first"}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                  >
                                    {adminSortDir === "desc" ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                                  </button>
                                </div>
                                <p className="mt-1 text-[11px] font-semibold text-slate-400">
                                  {adminSortDir === "desc" ? "Newest / Highest first" : "Oldest / Lowest first"}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Active filter chips */}
                        {adminActiveFilters.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {adminActiveFilters.map(chip => (
                              <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">
                                {chip.label}
                                <button type="button" onClick={chip.clear} className="rounded-full text-indigo-400 hover:text-indigo-800" aria-label="Remove filter">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* ══════════════════════════════════════════════════ */}

                      {showAdminTable && (
                        <div className="border-t border-slate-100">
                          <div
                            ref={adminTopScrollRef}
                            onScroll={() => syncAdminScroll("top")}
                            className="overflow-x-auto border-b border-slate-100 bg-slate-50/70 px-4 py-2"
                            aria-label="Scroll prayer request table horizontally"
                          >
                            <div className="h-3 min-w-[1680px]" />
                          </div>
                          <div
                            ref={adminTableScrollRef}
                            onScroll={() => syncAdminScroll("table")}
                            className="overflow-x-auto"
                          >
                          <table className="min-w-[1680px] table-fixed text-sm">
                            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                              <tr className="text-left">
                                <th className="w-10 px-4 py-3 text-center"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded border-slate-300" /></th>
                                <th className="w-56 px-5 py-3">Requester</th>
                                <th className="w-[560px] px-5 py-3">Request</th>
                                <th className="w-44 px-5 py-3">Created</th>
                                <th className="w-44 px-5 py-3">Status</th>
                                <th className="w-36 px-5 py-3 text-center">RAG</th>
                                <th className="w-28 px-5 py-3 text-center">Replies</th>
                                <th className="w-36 px-5 py-3 text-center">Reminders</th>
                                <th className="w-36 px-5 py-3 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {adminFilteredRequests.map((req) => {
                                const meta = statusMeta(req.status);
                                const rag = ragMeta(req.ragStatus);
                                return (
                                  <React.Fragment key={req.id}>
                                    <tr className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                                      <td className="px-4 py-5 text-center"><input type="checkbox" checked={selectedIds.includes(req.id)} onChange={() => toggleSelected(req.id)} className="rounded border-slate-300" /></td>
                                      <td className="whitespace-normal break-words px-5 py-5 font-bold leading-6 text-slate-800">{req.anonymous ? "Anonymous" : req.createdBy || "Member"}{req.anonymous && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">Hidden</span>}</td>
                                      <td className="px-5 py-5">
                                        <div className="font-black text-slate-950">{req.title || "Prayer request"}</div>
                                        <div className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-600">{req.message}</div>
                                        {req.closeComment && <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><CheckCheck className="mr-1 inline h-3.5 w-3.5" />{req.closeComment}</div>}
                                      </td>
                                      <td className="whitespace-nowrap px-5 py-5 text-xs font-bold text-slate-500">{new Date(req.createdAt).toLocaleDateString()}<span className="block text-slate-400">{new Date(req.createdAt).toLocaleTimeString()}</span></td>
                                      <td className="px-5 py-5">
                                        <div className="flex items-center gap-2">
                                          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                                          <select value={(req.status || "new").toLowerCase()} onChange={(e) => handleStatusChange(req.id, e.target.value)} disabled={statusUpdatingId === req.id} className={`rounded-lg border px-2.5 py-2 text-xs font-black outline-none ring-emerald-100 focus:ring-4 ${meta.chip}`}>
                                            <option value="new">New</option>
                                            <option value="open">Open</option>
                                            <option value="prayed">Prayed</option>
                                            <option value="closed">Answered</option>
                                          </select>
                                        </div>
                                      </td>
                                      <td className="px-5 py-5 text-center">
                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${rag.chip}`} title={req.ragReason || "Prayer RAG status"}>
                                          <span className={`h-1.5 w-1.5 rounded-full ${rag.dot}`} />
                                          {rag.label}
                                        </span>
                                      </td>
                                      <td className="px-5 py-5 text-center font-black text-slate-700">{Array.isArray(req.responses) ? req.responses.length : 0}</td>
                                      <td className="px-5 py-5 text-center">
                                        <div className={`inline-flex min-w-10 items-center justify-center rounded-full px-2 py-1 text-xs font-black tabular-nums ${Number(req.reminderCount || 0) > 0 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`} title={req.lastReminderAtUtc ? `Last reminder: ${new Date(req.lastReminderAtUtc).toLocaleString()}` : "No reminders sent"}>
                                          {Number(req.reminderCount || 0)}
                                          {Number(req.reminderTodayCount || 0) > 0 && <span className="ml-1 rounded-full bg-amber-200 px-1 text-[10px] text-amber-900">+{req.reminderTodayCount}</span>}
                                        </div>
                                      </td>
                                      <td className="px-5 py-5 text-right">
                                        <div className="flex justify-end gap-2">
                                          <button type="button" onClick={() => startEditRequest(req)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-800 hover:bg-sky-100"><Edit3 className="h-3.5 w-3.5" /> Edit</button>
                                          <button type="button" onClick={() => startClose(req)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100"><CheckCheck className="h-3.5 w-3.5" /> Answered</button>
                                          <button type="button" onClick={() => handleDeleteRequest(req.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                                        </div>
                                      </td>
                                    </tr>
                                    {editingRequestId === req.id && (
                                      <tr>
                                        <td className="bg-slate-50 px-4 pb-4" colSpan={9}>
                                          <div className="mt-2 grid gap-3 rounded-lg border border-sky-100 bg-white p-3">
                                            <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-start">
                                              <div className="grid gap-2">
                                                <input value={editDraft.title} onChange={(e) => setEditDraft((draft) => ({ ...draft, title: e.target.value }))} maxLength={120} placeholder="Prayer request title" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none ring-sky-100 focus:ring-4" />
                                                <textarea value={editDraft.message} onChange={(e) => setEditDraft((draft) => ({ ...draft, message: e.target.value }))} rows={4} maxLength={1000} placeholder="Prayer request message" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none ring-sky-100 focus:ring-4" />
                                                <label className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
                                                  <input type="checkbox" checked={editDraft.anonymous} onChange={(e) => setEditDraft((draft) => ({ ...draft, anonymous: e.target.checked }))} className="h-4 w-4 accent-sky-700" />
                                                  Keep requester anonymous
                                                </label>
                                              </div>
                                              <div className="flex gap-2">
                                                <button type="button" disabled={editSubmitting || !editDraft.message.trim()} onClick={saveEditedRequest} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white hover:bg-sky-800 disabled:opacity-50">{editSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</button>
                                                <button type="button" onClick={cancelEditRequest} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Cancel</button>
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}                                    {closingId === req.id && (
                                      <tr>
                                        <td className="bg-slate-50 px-4 pb-4" colSpan={9}>
                                          <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[1fr_auto] lg:items-start">
                                            <textarea value={closeComment} onChange={(e) => setCloseComment(e.target.value)} rows={3} placeholder="How did God answer this prayer?" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none ring-emerald-100 focus:ring-4" />
                                            <div className="flex gap-2">
                                              <button type="button" disabled={closeSubmitting} onClick={handleCloseWithComment} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">{closeSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save</button>
                                              <button type="button" onClick={cancelClose} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Cancel</button>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                              {adminFilteredRequests.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">No prayer requests match the current filters.</td></tr>}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  <section className="grid gap-3 xl:grid-cols-2">
                    {loading ? (
                      <div className="xl:col-span-2"><SkeletonList /></div>
                    ) : filteredRequests.length === 0 ? (
                      <div className="xl:col-span-2"><EmptyState hasAny={sortedRequests.length > 0} activeTab={activeTab} clearFilters={() => { setSearch(""); setStatusFilter(null); setActiveTab("all"); clearAdminFilters(); }} /></div>
                    ) : (
                      filteredRequests.map((req) => (
                        <PrayerCard
                          key={req.id}
                          req={req}
                          meta={statusMeta(req.status)}
                          mine={isMine(req)}
                          isAdmin={isAdmin}
                          expanded={expandedRespondId === req.id}
                          onExpand={() => { setExpandedRespondId((id) => (id === req.id ? null : req.id)); setResponseText(""); }}
                          responseText={responseText}
                          setResponseText={setResponseText}
                          onSubmitResponse={() => handleAddResponse(req)}
                          responseSubmitting={responseSubmitting && expandedRespondId === req.id}
                          onDelete={() => handleDeleteRequest(req.id)}
                          onPray={() => togglePray(req.id)}
                          prayedByMe={iPrayed.has(req.id)}
                          prayerCount={prayerCounts[req.id] || 0}
                          reminderCount={Number(req.reminderCount || 0)}
                          reminderTodayCount={Number(req.reminderTodayCount || 0)}
                          lastReminderAtUtc={req.lastReminderAtUtc}
                          ragStatus={req.ragStatus}
                          ragReason={req.ragReason}
                          ragAgeHours={req.ragAgeHours}
                        />
                      ))
                    )}
                  </section>
                </>
              )}
            </main>
          </div>
        </section>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ============================================================================
 *  SUB-COMPONENTS
 * ========================================================================= */

function SimplePrayerRequestsView({
  toasts,
  onDismissToast,
  requests,
  loading,
  message,
  setMessage,
  title,
  setTitle,
  anonymous,
  setAnonymous,
  submitting,
  onSubmit,
  voiceLang,
  setVoiceLang,
  voiceBusy,
  voiceListening,
  startVoiceCapture,
  onDelete,
}) {
  return (
    <div className="prayer-wall-page prayer-member-page min-h-screen bg-[#f5f7fb]">
      <Toasts items={toasts} onDismiss={onDismissToast} />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="prayer-member-shell rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="prayer-member-hero border-b border-slate-100 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-800">
                <HandHeart className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-950">Prayer Requests</h1>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Share a prayer request and track the church response here.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
            <form onSubmit={onSubmit} className="prayer-compose-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-800">
                  <Send className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-950">Log a prayer request</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Type it, or use the mic and review before sharing.</p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-emerald-950">Speech to text</div>
                    <div className="text-xs font-semibold leading-5 text-emerald-800">Tap the mic, speak, then check the text below.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startVoiceCapture(voiceLang)}
                    disabled={voiceBusy}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black shadow-sm transition disabled:opacity-60 ${voiceListening ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}
                  >
                    {voiceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : voiceListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {voiceListening ? "Stop listening" : "Start voice request"}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ["en-IN", "English"],
                    ["hi-IN", "Hindi"],
                    ["pa-IN", "Punjabi"],
                  ].map(([code, label]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setVoiceLang(code)}
                      className={`rounded-full border px-3 py-1 text-xs font-black ${voiceLang === code ? "border-emerald-700 bg-white text-emerald-800" : "border-emerald-200 bg-emerald-100/70 text-emerald-800 hover:bg-white"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={8}
                  maxLength={1000}
                  placeholder="Write your prayer request here..."
                  className="min-h-48 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-base font-semibold leading-7 text-slate-900 outline-none ring-emerald-100 transition focus:bg-white focus:ring-4"
                />
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Optional title"
                  maxLength={120}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-emerald-100 transition focus:ring-4"
                />
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-700" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                  {anonymous ? <Lock className="h-4 w-4 text-slate-500" /> : <Globe className="h-4 w-4 text-slate-500" />}
                  {anonymous ? "Submit anonymously" : "Submit as me"}
                </label>
                <span className="text-xs font-bold text-slate-400">{message.length}/1000</span>
              </div>

              <button type="submit" disabled={submitting || !message.trim()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? "Submitting..." : "Submit Prayer Request"}
              </button>
            </form>

            <section className="prayer-track-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-950">Track your requests</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Status updates and church responses appear below.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{requests.length}</span>
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <SkeletonList />
                ) : requests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                    <HandHeart className="mx-auto h-8 w-8 text-emerald-600" />
                    <p className="mt-3 text-sm font-black text-slate-800">No prayer requests yet.</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">When you submit one, it will appear here for tracking.</p>
                  </div>
                ) : (
                  requests.map((req) => {
                    const meta = statusMeta(req.status);
                    const responses = Array.isArray(req.responses) ? req.responses : [];
                    return (
                      <article key={req.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="break-words text-base font-black text-slate-950">{req.title || "Prayer request"}</h3>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-700">{req.message}</p>
                            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-400">
                              <Clock className="h-3.5 w-3.5" />
                              {timeAgo(req.createdAt)}
                            </p>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black ${meta.chip}`}>
                            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                        </div>

                        {req.closeComment && (
                          <div className="mt-3 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-bold leading-6 text-emerald-800">
                            <CheckCheck className="mr-1 inline h-4 w-4" />
                            {req.closeComment}
                          </div>
                        )}

                        {responses.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-black uppercase tracking-wide text-slate-400">Church response</div>
                            {responses.map((res) => (
                              <div key={res.id || `${req.id}-${res.respondedAt || res.createdAt || res.responseText}`} className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                                <div className="text-xs font-black text-emerald-800">{res.respondedBy || res.author || "Church team"}</div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-700">{res.responseText || res.message}</p>
                                {(res.respondedAt || res.createdAt) && (
                                  <p className="mt-1 text-xs font-semibold text-slate-400">{new Date(res.respondedAt || res.createdAt).toLocaleString()}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex justify-end">
                          <button type="button" onClick={() => onDelete(req.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}

const testimonyHindiText = (t) =>
  t.testimonyTextHi ||
  t.testimonyTextHindi ||
  t.hindiTestimonyText ||
  t.testimonyHindi ||
  "";

const testimonyEnglishText = (t) =>
  t.testimonyTextEn ||
  t.testimonyTextEnglish ||
  t.englishTestimonyText ||
  t.testimonyText ||
  "";
function TestimoniesApplet({
  testimonies,
  loading,
  editingId,
  draft,
  setDraft,
  onEdit,
  onCancel,
  onSave,
  saving,
  onUpload,
  canBackfillHindi = false,
  onBackfillHindi,
  backfillRunning = false,
}) {
  if (loading) return <SkeletonList />;
  if (!testimonies.length) {
    return (
      <div className="rounded-3xl border border-dashed border-emerald-200 bg-white p-8 text-center shadow-sm">
        <Sparkles className="mx-auto h-10 w-10 text-emerald-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">No testimonies yet</h2>
        <p className="mt-1 text-sm text-slate-500">When a prayer is marked answered, AI Counseller will draft a testimony here.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {canBackfillHindi && (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-900">Hindi testimony generation</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Fill missing Hindi versions for older English testimonies.</p>
          </div>
          <button
            type="button"
            onClick={onBackfillHindi}
            disabled={backfillRunning}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {backfillRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Hindi
          </button>
        </div>
      )}
      {testimonies.map((t) => {
        const editing = editingId === t.id;
        return (
          <article key={t.id} className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  <CheckCheck className="h-3.5 w-3.5" />
                  Answered Prayer Testimony
                </div>
                {editing ? (
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-base font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                ) : (
                  <h2 className="mt-3 text-xl font-black text-slate-900">{t.title || "Answered Prayer"}</h2>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {t.createdBy ? `${t.createdBy} · ` : ""}{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ""}
                </p>
              </div>
              {editing ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => onSave(t.id)} disabled={saving} className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save
                  </button>
                  <button type="button" onClick={onCancel} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => onEdit(t)} className="rounded-full border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50">
                  Edit testimony
                </button>
              )}
            </div>

            {editing ? (
              <div className="mt-4 space-y-3">
                <textarea
                  value={draft.testimonyText}
                  onChange={(e) => setDraft((d) => ({ ...d, testimonyText: e.target.value }))}
                  rows={6}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Upload image
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload("image", e.target.files?.[0])} />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <Mic className="h-3.5 w-3.5" />
                    Upload voice
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => onUpload("voice", e.target.files?.[0])} />
                  </label>
                  {(draft.imageUrl || draft.voiceUrl) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                      <UploadCloud className="h-3.5 w-3.5" />
                      Media ready
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">English</div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700">{testimonyEnglishText(t) || "No English testimony available yet."}</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Hindi</div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700">{testimonyHindiText(t) || "Hindi testimony is not available yet."}</p>
                </div>
              </div>
            )}

            {!editing && (t.imageUrl || t.voiceUrl) && (
              <div className="mt-4 flex flex-wrap gap-3">
                {t.imageUrl && <img src={t.imageUrl} alt="Testimony" className="max-h-56 rounded-2xl border border-slate-100 object-cover" />}
                {t.voiceUrl && <audio controls src={t.voiceUrl} className="w-full max-w-md" />}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function PrayerMetricsGraph({
  data,
  range,
  onRangeChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}) {
  const hasData = data.total > 0;
  const tooltipStyle = {
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    boxShadow: "0 14px 36px rgba(15, 23, 42, 0.16)",
    fontSize: 13,
    fontWeight: 800,
  };
  const rangeOptions = [
    ["7", "7D"],
    ["14", "14D"],
    ["30", "30D"],
    ["90", "90D"],
    ["all", "All"],
    ["custom", "Custom"],
  ];
  const bucketLabel = data.bucketMode === "month" ? "Monthly" : data.bucketMode === "week" ? "Weekly" : "Daily";

  return (
    <section className="border-t border-slate-100 bg-slate-50/40 p-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-950">Prayer request metrics</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {bucketLabel} request flow, status mix, and priority health for {data.rangeLabel}.
            </p>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {rangeOptions.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onRangeChange(value)}
                  className={`min-h-9 rounded-md px-3 text-xs font-black transition ${range === value ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {range === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 outline-none ring-emerald-100 focus:ring-4" />
                <span className="text-xs font-black text-slate-400">to</span>
                <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 outline-none ring-emerald-100 focus:ring-4" />
              </div>
            )}
          </div>
        </div>

        {!hasData ? (
          <div className="mt-4 grid min-h-72 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
            No prayer request metrics available for this range.
          </div>
        ) : (
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.9fr)]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-600">Request flow</div>
                  <div className="text-xs font-semibold text-slate-400">Created vs answered requests</div>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                  {data.total} in range
                </span>
              </div>
              <div className="h-[360px] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend} margin={{ top: 18, right: 20, left: 0, bottom: 10 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dbe4ef" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fontWeight: 800, fill: "#475569" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} minTickGap={14} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fontWeight: 800, fill: "#475569" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} width={42} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(15, 23, 42, 0.06)" }} />
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 13, fontWeight: 900, paddingBottom: 8 }} />
                    <Bar dataKey="requests" name="Created" fill="#0284c7" radius={[7, 7, 0, 0]} maxBarSize={34} />
                    <Bar dataKey="answered" name="Answered" fill="#059669" radius={[7, 7, 0, 0]} maxBarSize={34} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid gap-5">
              <MetricBars title="Status mix" data={data.status} total={data.total} />
              <MetricBars title="RAG priority" data={data.rag} total={data.total} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MetricBars({ title, data, total }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm font-black uppercase tracking-wide text-slate-600">{title}</div>
        <div className="text-xs font-black text-slate-400">{total} total</div>
      </div>
      <div className="space-y-4">
        {data.map((entry) => (
          <div key={entry.key}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2 font-black text-slate-800">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                <span className="truncate">{entry.name}</span>
              </div>
              <div className="shrink-0 font-black tabular-nums text-slate-950">{entry.value} <span className="text-xs text-slate-400">({entry.pct}%)</span></div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(entry.pct, entry.value ? 3 : 0)}%`, backgroundColor: entry.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent, compact = false }) {
  return (
    <div className={`${compact ? "border-white/15 bg-white/10 text-white" : "border-slate-200 bg-white"} rounded-lg border px-4 py-3 shadow-sm`}>
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className={`text-2xl font-black tabular-nums leading-none ${compact ? "text-white" : "text-slate-950"}`}>{value}</div>
          <div className={`mt-1 truncate text-xs font-black uppercase tracking-wide ${compact ? "text-emerald-50" : "text-slate-500"}`}>{label}</div>
        </div>
      </div>
    </div>
  );
}
function ChipButton({ active, children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-3 py-1 rounded-full border text-xs font-medium transition ${
        active
          ? className || "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-slate-200 rounded w-1/3" />
              <div className="h-2.5 bg-slate-100 rounded w-1/5" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-3 bg-slate-100 rounded w-full" />
            <div className="h-3 bg-slate-100 rounded w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasAny, activeTab, clearFilters }) {
  return (
    <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-10 px-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-500 flex items-center justify-center mx-auto mb-3">
        <HandHeart className="w-6 h-6" />
      </div>
      {hasAny ? (
        <>
          <p className="text-sm font-medium text-slate-700">
            No requests match your filters.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Try changing the tab or clearing search.
          </p>
          <button
            onClick={clearFilters}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-700">
            The wall is quiet — be the first to share.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Whatever is on your heart, this community is here for you.
          </p>
        </>
      )}
    </div>
  );
}

function PrayerCard({
  req,
  meta,
  mine,
  isAdmin,
  expanded,
  onExpand,
  responseText,
  setResponseText,
  onSubmitResponse,
  responseSubmitting,
  onDelete,
  onPray,
  prayedByMe,
  prayerCount,
  reminderCount = 0,
  reminderTodayCount = 0,
  lastReminderAtUtc = null,
  ragStatus = null,
  ragReason = "",
  ragAgeHours = null,
}) {
  const canDelete = mine || isAdmin;
  const responses = Array.isArray(req.responses) ? req.responses : [];
  const rag = ragMeta(ragStatus);

  return (
    <article className="group flex min-h-[260px] flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <Avatar name={req.createdBy} anonymous={req.anonymous} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-black text-slate-950">{req.anonymous ? "Anonymous" : req.createdBy || "Member"}</p>
                {mine && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">Mine</span>}
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${meta.chip}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
                {isAdmin && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${rag.chip}`}
                    title={`${ragReason || "Prayer RAG status"}${ragAgeHours !== null && ragAgeHours !== undefined ? ` (${ragAgeHours}h old)` : ""}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${rag.dot}`} />
                    RAG {rag.label}
                  </span>
                )}
                {isAdmin && reminderCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700"
                    title={lastReminderAtUtc ? `Last reminder: ${new Date(lastReminderAtUtc).toLocaleString()}` : "Prayer response reminders sent"}
                  >
                    <AlertCircle className="h-3 w-3" />
                    {reminderCount} reminder{reminderCount === 1 ? "" : "s"}
                    {reminderTodayCount > 0 && <span className="rounded-full bg-amber-200 px-1 text-amber-900">+{reminderTodayCount} today</span>}
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-400"><Clock className="h-3.5 w-3.5" />{timeAgo(req.createdAt)}</p>
            </div>
            {canDelete && (
              <button type="button" onClick={onDelete} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100" title="Delete request">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex-1">
        <h3 className="text-lg font-black leading-snug text-slate-950">{req.title || "Prayer request"}</h3>
        <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-7 text-slate-700">{req.message}</p>

        {req.closeComment && (
          <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
            <div className="flex items-start gap-2 text-sm font-bold leading-6 text-emerald-900">
              <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <span>{req.closeComment}</span>
            </div>
          </div>
        )}

        {responses.length > 0 && (
          <div className="mt-4 space-y-2 border-l-2 border-emerald-100 pl-3">
            {responses.slice(0, 3).map((res) => (
              <div key={res.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-700">
                <span className="font-black text-emerald-700">{res.respondedBy || res.author || "Team"}:</span>{" "}
                {res.responseText || res.message}
              </div>
            ))}
            {responses.length > 3 && <div className="text-xs font-bold text-slate-400">+{responses.length - 3} more responses</div>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={onPray} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-black transition ${prayedByMe ? "border-rose-200 bg-rose-50 text-rose-600" : "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"}`} title={prayedByMe ? "You prayed for this" : "I'm praying"}>
          <Heart className={`h-3.5 w-3.5 ${prayedByMe ? "fill-rose-500 text-rose-500" : ""}`} />
          {prayedByMe ? "Praying" : "Pray"}
          {prayerCount > 0 && <span className="rounded-full bg-white/70 px-1.5 text-[11px] tabular-nums">{prayerCount}</span>}
        </button>
        <button type="button" onClick={onExpand} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-black transition ${expanded ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"}`}>
          <Reply className="h-3.5 w-3.5" />
          Respond
          {responses.length > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${expanded ? "bg-white/20" : "bg-slate-100"}`}>{responses.length}</span>}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} rows={3} autoFocus placeholder="Write an encouraging response..." className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none ring-emerald-100 focus:ring-4" />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-semibold text-slate-400">Responses are visible on the prayer wall.</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onExpand} className="min-h-9 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-white">Cancel</button>
              <button type="button" disabled={responseSubmitting || !responseText.trim()} onClick={onSubmitResponse} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {responseSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}


