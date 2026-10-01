// src/pages/SermonsPage.jsx
//
// Modern resource library: Sermons, Books, Articles.
// - Lucide icons everywhere (no mojibake from emoji glyphs)
// - Toast + Confirm modals (no alert/confirm)
// - Bookmarks via localStorage
// - Detail modal with full player
// - Sort + filter + search
// - Hover-to-preview thumbnails
// - Encoding-safe: ASCII-only source, special chars via lucide icons
//
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import axios from "axios";
import * as sermonsApiModule from "../../api/sermons";
import {
  Headphones,
  BookOpen,
  FileText,
  Search,
  Plus,
  Edit2,
  Trash2,
  Play,
  ExternalLink,
  Share2,
  Bookmark,
  BookmarkCheck,
  Calendar as CalendarIcon,
  User as UserIcon,
  X,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  ShieldCheck,
  Shield,
  ArrowUpDown,
  Sparkles,
  ChevronDown,
  Copy,
  Download,
  CreditCard,
  UploadCloud,
} from "lucide-react";

/* ======================================================================== */
/*  YouTube helpers                                                          */
/* ======================================================================== */

function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      const v = new URLSearchParams(u.search).get("v");
      if (v) return v;
      const m = u.pathname.match(/embed\/([^/?]+)/);
      if (m) return m[1];
      const sm = u.pathname.match(/shorts\/([^/?]+)/);
      if (sm) return sm[1];
    }
  } catch {
    // not a URL — fall through
  }
  const maybe = String(url).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(maybe)) return maybe;
  return null;
}
const watchUrlFromId = (id) => (id ? `https://www.youtube.com/watch?v=${id}` : null);
const thumbnailUrlFromId = (id, q = "hqdefault") => (id ? `https://img.youtube.com/vi/${id}/${q}.jpg` : null);
const embedUrlFromId = (id, opts = { autoplay: false, mute: true, controls: 1 }) => {
  if (!id) return null;
  const qp = new URLSearchParams();
  if (opts.autoplay) qp.set("autoplay", "1");
  if (opts.mute) qp.set("mute", "1");
  if (opts.controls != null) qp.set("controls", String(opts.controls));
  qp.set("rel", "0");
  qp.set("modestbranding", "1");
  qp.set("playsinline", "1");
  return `https://www.youtube.com/embed/${id}?${qp.toString()}`;
};

/* ======================================================================== */
/*  Admin detection                                                          */
/* ======================================================================== */

const HARDCODED_ADMIN_ID = "ae9dfc94-07d8-469a-a8f6-a4c5aedcf3a9";
const tryParseJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
const normalizeAccessName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const canManageMediaRole = (value) => {
  const role = normalizeAccessName(value);
  return ["admin", "administrator", "superadmin", "superadministrator", "mediamanager"].includes(role);
};
const decodeJwtPayload = (token) => {
  try {
    const [, p] = token.split(".");
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
};

function useAdminDetection() {
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    const stored =
      localStorage.getItem("currentUser") ||
      localStorage.getItem("mahima_user") ||
      localStorage.getItem("user");
    const user = stored ? tryParseJSON(stored) : null;

    const ids = [
      user?.id, user?.Id, user?.userId, user?.UserId,
      localStorage.getItem("userId"),
      localStorage.getItem("mahima_user_id"),
    ].filter(Boolean);

    const roles = [user?.role, user?.Role, user?.roleName, user?.RoleName]
      .filter(Boolean).map(String);
    [user?.roles, user?.Roles, user?.positions, user?.Positions].forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((item) => roles.push(String(item?.name ?? item?.Name ?? item?.role ?? item?.Role ?? item)));
      }
    });
    [user?.position, user?.Position, user?.positionName, user?.PositionName, user?.primaryPosition, user?.PrimaryPosition]
      .filter(Boolean)
      .forEach((item) => roles.push(String(item?.name ?? item?.Name ?? item)));

    const token = localStorage.getItem("mahima_token") || localStorage.getItem("token");
    if (token) {
      const p = decodeJwtPayload(token);
      if (p) {
        const jwtRoles = []
          .concat(p.role, p.roles, p["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"])
          .filter(Boolean);
        jwtRoles.forEach((r) => roles.push(...(Array.isArray(r) ? r : [r]).map(String)));
      }
    }

    const byId = ids.some((x) => String(x) === HARDCODED_ADMIN_ID);
    const byRole = roles.some(canManageMediaRole);
    setIsAdminUser(byId || byRole);
  }, []);

  const [adminMode, setAdminModeState] = useState(
    () => sessionStorage.getItem("sermons_admin_mode") === "1"
  );
  const setAdminMode = useCallback((v) => {
    setAdminModeState(v);
    sessionStorage.setItem("sermons_admin_mode", v ? "1" : "0");
  }, []);

  useEffect(() => {
    if (!isAdminUser) setAdminMode(false);
  }, [isAdminUser, setAdminMode]);

  return { isAdminUser, adminMode, setAdminMode };
}

/* ======================================================================== */
/*  API resolution                                                           */
/* ======================================================================== */

const resolveApi = (mod, name) => {
  if (!mod) return undefined;
  if (typeof mod[name] === "function") return mod[name];
  const obj = mod.sermonsApi ?? mod.default ?? mod;
  if (obj && typeof obj[name] === "function") return obj[name];
  return undefined;
};

const sermonsApis = {
  list: resolveApi(sermonsApiModule, "list"),
};

/* ======================================================================== */
/*  Toast system                                                             */
/* ======================================================================== */

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
  const success = useCallback((m, ttl) => push("success", m, ttl), [push]);
  const error = useCallback((m, ttl) => push("error", m, ttl ?? 5000), [push]);
  const info = useCallback((m, ttl) => push("info", m, ttl), [push]);

  return { toasts, success, error, info, dismiss };
};

const ToastStack = ({ toasts, onDismiss }) => (
  <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-[min(92vw,360px)]">
    {toasts.map((t) => (
      <div key={t.id}
           className={`flex items-start gap-2 rounded-xl border px-3 py-2 shadow-lg backdrop-blur bg-white/95 text-xs ${
             t.type === "success" ? "border-emerald-200 text-emerald-800"
             : t.type === "error" ? "border-red-200 text-red-800"
             : "border-slate-200 text-slate-800"
           }`}>
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
/*  Tab metadata                                                             */
/* ======================================================================== */

const TABS = [
  { key: "sermon",  label: "Sermons",  icon: Headphones, gradient: "from-indigo-500 to-blue-600" },
  { key: "book",    label: "Books",    icon: BookOpen,   gradient: "from-amber-500 to-orange-600" },
  { key: "article", label: "Articles", icon: FileText,   gradient: "from-emerald-500 to-teal-600" },
];

const SORT_OPTIONS = [
  { id: "date_desc",  label: "Newest first" },
  { id: "date_asc",   label: "Oldest first" },
  { id: "title_asc",  label: "Title A-Z" },
  { id: "title_desc", label: "Title Z-A" },
];

// Unwraps common API client response shapes:
//   raw axios response  ->  { data: { items: [...] } }
//   axios.data          ->  { items: [...] }
//   plain JSON          ->  { items: [...] }  or  [...]
//   wrapped envelope    ->  { data: [...] }
// Best-effort clipboard write that works on insecure (http://) origins
// where the modern navigator.clipboard API is unavailable. Returns true
// on success.
function legacyCopyToClipboard(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Pull a meaningful message out of any axios/fetch/native error.
const errMsg = (err, fallback = "Something went wrong.") => {
  const r = err?.response;
  if (r) {
    if (typeof r.data === "string" && r.data.trim()) return r.data;
    if (r.data?.message) return r.data.message;
    if (r.data?.error) return r.data.error;
    if (r.statusText) return `${r.status} ${r.statusText}`;
    return `HTTP ${r.status}`;
  }
  return err?.message || fallback;
};

const authToken = () =>
  localStorage.getItem("mahima_token") ||
  localStorage.getItem("token") ||
  localStorage.getItem("authToken") ||
  "";

const authHeaders = () => {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatMoney = (amount, currency = "INR") => {
  const value = Number(amount || 0);
  if (!value) return "Free";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency || "INR"} ${value.toFixed(2)}`;
  }
};

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const arrayFrom = (data) => {
  const candidates = [
    data,
    data?.items,
    data?.data,
    data?.data?.items,
    data?.data?.data,
    data?.results,
    data?.data?.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
};

/* ======================================================================== */
/*  Bookmarks (localStorage)                                                 */
/* ======================================================================== */

const BOOKMARK_KEY = "mahima_resource_bookmarks";
const useBookmarks = () => {
  const [bookmarks, setBookmarks] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]")); }
    catch { return new Set(); }
  });

  const persist = (next) => {
    setBookmarks(next);
    try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...next])); } catch {}
  };

  const toggle = useCallback((id) => {
    const key = String(id);
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  return { bookmarks, toggle, has: (id) => bookmarks.has(String(id)) };
};

/* ======================================================================== */
/*  Main                                                                     */
/* ======================================================================== */

export default function SermonsPage() {
  const { toasts, success: toastSuccess, error: toastError, dismiss: toastDismiss } = useToasts();
  const { isAdminUser, adminMode, setAdminMode } = useAdminDetection();
  const { bookmarks, toggle: toggleBookmark, has: isBookmarked } = useBookmarks();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("sermon");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [hoverPlayingId, setHoverPlayingId] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listApi = sermonsApis.list;
      if (typeof listApi !== "function") {
        setError("sermons API: 'list' not available.");
        setItems([]);
        return;
      }
      let raw;
      try { raw = await listApi(); }
      catch { raw = await listApi(1, 1000, ""); }
      setItems(arrayFrom(raw));
    } catch (e) {
      setError(e?.message ?? String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Counts per tab (for badge labels)
  const counts = useMemo(() => {
    const c = { sermon: 0, book: 0, article: 0 };
    for (const r of items) {
      const t = String(r.type ?? r.Type ?? "sermon").toLowerCase();
      if (c[t] !== undefined) c[t]++;
    }
    return c;
  }, [items]);

  // Filtered + sorted items for active tab
  const visibleItems = useMemo(() => {
    const tab = activeTab;
    const q = query.trim().toLowerCase();
    let list = items.filter((r) => {
      const t = String(r.type ?? r.Type ?? "sermon").toLowerCase();
      if (t !== tab) return false;
      if (showBookmarksOnly && !isBookmarked(r.id ?? r.Id)) return false;
      if (!q) return true;
      const hay = `${r.title ?? r.name ?? ""} ${r.speaker ?? r.preacher ?? r.author ?? ""} ${
        r.youtubeUrl ?? r.YoutubeUrl ?? ""
      } ${r.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });

    list.sort((a, b) => {
      const aDate = a.publishedAt ?? a.date ?? "";
      const bDate = b.publishedAt ?? b.date ?? "";
      const aTitle = (a.title ?? a.name ?? "").toLowerCase();
      const bTitle = (b.title ?? b.name ?? "").toLowerCase();
      switch (sortBy) {
        case "date_asc":   return new Date(aDate) - new Date(bDate);
        case "title_asc":  return aTitle.localeCompare(bTitle);
        case "title_desc": return bTitle.localeCompare(aTitle);
        case "date_desc":
        default:           return new Date(bDate) - new Date(aDate);
      }
    });
    return list;
  }, [items, activeTab, query, sortBy, showBookmarksOnly, isBookmarked]);

  const featured = useMemo(() => {
    // Pick newest item with playable YouTube media or a local file on the active tab.
    return visibleItems.find((r) => {
      const yt = r.youtubeUrl ?? r.YoutubeUrl ?? r.youtube ?? r.YouTubeURL;
      return !!extractYouTubeId(yt) || Boolean(r.hasDigitalFile ?? r.HasDigitalFile);
    });
  }, [visibleItems]);

  /* ----- mutations ----- */

  const requireAdmin = () => {
    if (!isAdminUser) {
      toastError("Only admins can do that.");
      return false;
    }
    if (!adminMode) {
      toastError("Enable management mode first.");
      return false;
    }
    return true;
  };

  const handleSave = async (form) => {
    if (!requireAdmin()) return;
    if (!form.title?.trim()) { toastError("Title is required."); return; }
    const resourceType = (form.type || "sermon").toLowerCase();
    const alreadyHasLocalFile = Boolean(form.hasDigitalFile || targetHasDigitalFile(form));
    if (resourceType === "sermon" && !form.youtube?.trim() && !form.digitalFile && !alreadyHasLocalFile) {
      toastError("Add a YouTube URL or upload a local sermon file.");
      return;
    }

    const ytId = extractYouTubeId(form.youtube);
    const isFree = resourceType === "sermon" ? true : !!form.isFree;
    const priceAmount = isFree ? 0 : Math.max(0, Number(form.priceAmount || 0));

    // Backend SermonDto: Title, Speaker, Date, YoutubeUrl, Description, Type, ...
    const payload = {
      Title: form.title.trim(),
      Speaker: form.speaker?.trim() || null,
      Type: resourceType,
      Date: form.date ? new Date(form.date).toISOString() : null,
      YoutubeUrl: form.youtube?.trim() ? (ytId ? watchUrlFromId(ytId) : form.youtube.trim()) : null,
      Description: form.description?.trim() || null,
      IsFree: isFree,
      PriceAmount: priceAmount,
      Currency: form.currency || "INR",
    };

    const isEdit = !!form.id;

    try {
      let savedId = form.id;
      if (isEdit) {
        // PUT /api/sermons/{id} — id MUST be in URL
        const res = await axios.put(`/api/sermons/${form.id}`, payload);
        savedId = res?.data?.id ?? res?.data?.Id ?? form.id;
      } else {
        const res = await axios.post(`/api/sermons`, payload);
        savedId = res?.data?.id ?? res?.data?.Id;
      }

      if (form.digitalFile && savedId) {
        const data = new FormData();
        data.append("file", form.digitalFile);
        await axios.post(`/api/sermons/${savedId}/digital-file`, data, {
          headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
        });
      }
      toastSuccess(isEdit ? "Updated." : "Added.");
      setShowAddModal(false);
      setEditTarget(null);
      await load();
    } catch (err) {
      console.error("Save failed:", err?.response ?? err);
      toastError("Save failed: " + errMsg(err));
    }
  };

  const downloadResource = async (record) => {
    const id = record.id ?? record.Id;
    if (!id) return;
    try {
      const res = await fetch(`/api/sermons/${id}/download`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => `Download failed (${res.status})`));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = record.digitalFileName || record.title || "mahima-resource";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError(err?.message || "Download failed.");
    }
  };

  const handleResourceAccess = async (record) => {
    const id = record.id ?? record.Id;
    if (!id) return;
    const isFree = record.isFree ?? record.IsFree ?? true;
    const price = Number(record.priceAmount ?? record.PriceAmount ?? 0);
    if (isFree || price <= 0) {
      await downloadResource(record);
      return;
    }

    try {
      const loaded = await loadRazorpayCheckout();
      if (!loaded || !window.Razorpay) {
        toastError("Could not load Razorpay checkout.");
        return;
      }
      const orderRes = await fetch(`/api/sermons/${id}/razorpay-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      if (!orderRes.ok) throw new Error(await orderRes.text().catch(() => "Could not start payment."));
      const order = await orderRes.json();
      const user = tryParseJSON(localStorage.getItem("currentUser") || localStorage.getItem("mahima_user") || "{}") || {};

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "Mahima Ministry",
        description: order.name || record.title || "Digital resource",
        order_id: order.orderId,
        prefill: {
          name: user.displayName || user.name || "",
          email: user.email || "",
          contact: user.phone || "",
        },
        handler: async (response) => {
          const verifyRes = await fetch(`/api/sermons/${id}/razorpay-verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              RazorpayOrderId: response.razorpay_order_id,
              RazorpayPaymentId: response.razorpay_payment_id,
              RazorpaySignature: response.razorpay_signature,
            }),
          });
          if (!verifyRes.ok) throw new Error(await verifyRes.text().catch(() => "Payment verification failed."));
          toastSuccess("Payment received. Download starting.");
          await downloadResource(record);
        },
        theme: { color: "#d97706" },
      });
      checkout.open();
    } catch (err) {
      toastError(err?.message || "Payment failed.");
    }
  };

  const handleDelete = (record) => {
    if (!requireAdmin()) return;
    const id = record.id ?? record.Id;
    if (id == null) {
      toastError("Can't delete: this item has no id.");
      return;
    }
    setConfirm({
      title: "Delete this item?",
      body: `"${record.title ?? record.name ?? "Untitled"}" will be permanently removed.`,
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        try {
          // DELETE /api/sermons/{id}
          await axios.delete(`/api/sermons/${id}`);
          setItems((arr) => arr.filter((x) => String(x.id ?? x.Id) !== String(id)));
          toastSuccess("Deleted.");
        } catch (err) {
          console.error("Delete failed:", err?.response ?? err);
          toastError("Delete failed: " + errMsg(err));
        }
      },
    });
  };

  const copyShareLink = async (rec) => {
    const yt = rec.youtubeUrl ?? rec.YoutubeUrl ?? rec.youtube;
    const id = extractYouTubeId(yt);
    const url = id ? watchUrlFromId(id) : null;
    if (!url) { toastError("No shareable link."); return; }

    // 1) Modern Web Share — only works in HTTPS / secure contexts. We
    //    explicitly check `isSecureContext` because some browsers expose
    //    `navigator.share` on http:// but throw at call time.
    if (window.isSecureContext && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: rec.title ?? "Resource", url });
        toastSuccess("Shared.");
        return;
      } catch (err) {
        // User cancelled the share sheet — that's not an error.
        if (err?.name === "AbortError") return;
        // Otherwise fall through to clipboard.
      }
    }

    // 2) Async clipboard — also requires secure context.
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toastSuccess("Link copied.");
        return;
      } catch {
        // fall through to legacy
      }
    }

    // 3) Legacy fallback that works on plain http:// dev servers.
    if (legacyCopyToClipboard(url)) {
      toastSuccess("Link copied.");
    } else {
      // 4) Last resort — show the URL so the user can copy it manually.
      window.prompt("Copy this link:", url);
    }
  };


function targetHasDigitalFile(form) {
  return Boolean(form?.hasDigitalFile);
}

  const tabMeta = TABS.find((t) => t.key === activeTab) || TABS[0];

  /* ----- render ----- */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-amber-50/30">
      {/* Constrain content so the page looks consistent whether it's mounted
          inside the /home/* app shell or rendered standalone. */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      <ToastStack toasts={toasts} onDismiss={toastDismiss} />
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        danger={confirm?.danger}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* HEADER */}
      <header className={`relative mb-4 rounded-2xl overflow-hidden shadow-md text-white p-5 sm:p-6 bg-gradient-to-br ${tabMeta.gradient}`}>
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{ background: "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.4), transparent 50%)" }} />
        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6" />
              Resource library
            </h1>
            <p className="text-sm text-white/80 mt-1">
              Sermons, books, and articles for the community.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={load} className="btn-ghost-light">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {isAdminUser && (
              <button
                onClick={() => setAdminMode(!adminMode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  adminMode
                    ? "bg-white text-slate-900"
                    : "bg-white/20 text-white border border-white/30 hover:bg-white/30"
                }`}
              >
                {adminMode ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                Manage {adminMode ? "ON" : "OFF"}
              </button>
            )}
            {isAdminUser && adminMode && (
              <button onClick={() => { setEditTarget(null); setShowAddModal(true); }} className="btn-light">
                <Plus className="w-4 h-4" />
                Add {tabMeta.label.replace(/s$/, "").toLowerCase()}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="relative mt-5 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  active
                    ? "bg-white text-slate-900"
                    : "bg-white/15 text-white border border-white/30 hover:bg-white/25"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                  active ? "bg-slate-100 text-slate-600" : "bg-white/25 text-white"
                }`}>
                  {counts[t.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {/* FEATURED */}
      {featured && !showBookmarksOnly && !query && (
        <FeaturedCard
          record={featured}
          onPlay={() => setDetailTarget(featured)}
          isBookmarked={isBookmarked(featured.id ?? featured.Id)}
          onToggleBookmark={() => toggleBookmark(featured.id ?? featured.Id)}
          onShare={() => copyShareLink(featured)}
          onAccess={() => handleResourceAccess(featured)}
        />
      )}

      {/* TOOLBAR */}
      <div className="mb-3 rounded-2xl bg-white border border-slate-200 shadow-sm p-2 sm:p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tabMeta.label.toLowerCase()} by title, speaker, link...`}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none"
          />
        </div>

        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="appearance-none pl-8 pr-7 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-amber-400"
          >
            {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <ArrowUpDown className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        <button
          onClick={() => setShowBookmarksOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition ${
            showBookmarksOnly
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          {showBookmarksOnly ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          Bookmarks ({bookmarks.size})
        </button>
      </div>

      {/* CONTENT */}
      {error && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading ? (
        <CardGridSkeleton />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          tab={tabMeta}
          query={query}
          showingBookmarksOnly={showBookmarksOnly}
          canAdd={isAdminUser && adminMode}
          onAdd={() => { setEditTarget(null); setShowAddModal(true); }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visibleItems.map((rec) => (
            <ResourceCard
              key={rec.id ?? rec.Id}
              record={rec}
              hoverPlayingId={hoverPlayingId}
              setHoverPlayingId={setHoverPlayingId}
              isBookmarked={isBookmarked(rec.id ?? rec.Id)}
              onToggleBookmark={() => toggleBookmark(rec.id ?? rec.Id)}
              onOpenDetail={() => setDetailTarget(rec)}
              onShare={() => copyShareLink(rec)}
              onAccess={() => handleResourceAccess(rec)}
              onEdit={() => { setEditTarget(rec); setShowAddModal(true); }}
              onDelete={() => handleDelete(rec)}
              canManage={isAdminUser && adminMode}
            />
          ))}
        </div>
      )}

      {/* MODALS */}
      {showAddModal && (
        <ResourceFormModal
          target={editTarget}
          defaultType={activeTab}
          onCancel={() => { setShowAddModal(false); setEditTarget(null); }}
          onSave={handleSave}
        />
      )}

      {detailTarget && (
        <DetailModal
          record={detailTarget}
          onClose={() => setDetailTarget(null)}
          isBookmarked={isBookmarked(detailTarget.id ?? detailTarget.Id)}
          onToggleBookmark={() => toggleBookmark(detailTarget.id ?? detailTarget.Id)}
          onShare={() => copyShareLink(detailTarget)}
          onAccess={() => handleResourceAccess(detailTarget)}
        />
      )}

      <style>{`
        .btn-light{ display:inline-flex; align-items:center; gap:0.4rem; padding:0.45rem 0.85rem; border-radius:0.625rem; background:#fff; color:#0f172a; font-size:12px; font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .btn-light:hover{ background:#f8fafc; }
        .btn-ghost-light{ display:inline-flex; align-items:center; gap:0.4rem; padding:0.45rem 0.85rem; border-radius:0.625rem; background:rgba(255,255,255,0.18); color:#fff; font-size:12px; font-weight:600; border:1px solid rgba(255,255,255,0.3); }
        .btn-ghost-light:hover{ background:rgba(255,255,255,0.28); }
      `}</style>
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Featured card                                                            */
/* ======================================================================== */

function FeaturedCard({ record, onPlay, isBookmarked, onToggleBookmark, onShare, onAccess }) {
  const yt = record.youtubeUrl ?? record.YoutubeUrl ?? record.youtube ?? record.YouTubeURL;
  const id = extractYouTubeId(yt);
  const thumb = thumbnailUrlFromId(id, "maxresdefault") || thumbnailUrlFromId(id);
  const hasDigitalFile = Boolean(record.hasDigitalFile ?? record.HasDigitalFile);
  const digitalSize = record.digitalSizeBytes ?? record.DigitalSizeBytes;
  const title = record.title ?? record.name ?? "Untitled";
  const speaker = record.speaker ?? record.preacher ?? record.author ?? "";
  const date = record.date ?? record.publishedAt ?? "";

  return (
    <div className="mb-4 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-md grid grid-cols-1 lg:grid-cols-[55%_45%]">
      <div className="relative aspect-video lg:aspect-auto bg-slate-900 cursor-pointer group" onClick={onPlay}>
        {thumb ? (
          <img src={thumb} alt={title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">{hasDigitalFile ? "Local file available" : "No preview"}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute left-4 top-4">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-1">
            <Sparkles className="w-3 h-3" /> Featured
          </span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition">
            <Play className="w-6 h-6 text-slate-900 fill-slate-900 ml-1" />
          </div>
        </div>
      </div>
      <div className="p-5 flex flex-col">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight">{title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {speaker && <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" />{speaker}</span>}
          {date && <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3 h-3" />{new Date(date).toLocaleDateString()}</span>}
        </div>
        {record.description && (
          <p className="mt-3 text-sm text-slate-600 line-clamp-3">{record.description}</p>
        )}
        <div className="mt-auto pt-4 flex flex-wrap gap-2">
          {id ? (
            <button onClick={onPlay} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold px-3 py-2 hover:bg-slate-800">
              <Play className="w-3.5 h-3.5" /> Play
            </button>
          ) : hasDigitalFile ? (
            <button onClick={onAccess} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold px-3 py-2 hover:bg-slate-800">
              <Download className="w-3.5 h-3.5" /> Open local file{digitalSize ? ` (${formatBytes(digitalSize)})` : ""}
            </button>
          ) : null}
          <button onClick={onToggleBookmark} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium px-3 py-2 hover:bg-slate-50">
            {isBookmarked ? <BookmarkCheck className="w-3.5 h-3.5 text-amber-600" /> : <Bookmark className="w-3.5 h-3.5" />}
            {isBookmarked ? "Bookmarked" : "Bookmark"}
          </button>
          <button onClick={onShare} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium px-3 py-2 hover:bg-slate-50">
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Resource card                                                            */
/* ======================================================================== */

function ResourceCard({
  record, hoverPlayingId, setHoverPlayingId, isBookmarked, onToggleBookmark,
  onOpenDetail, onShare, onAccess, onEdit, onDelete, canManage,
}) {
  const id = record.id ?? record.Id;
  const title = record.title ?? record.name ?? "Untitled";
  const speaker = record.speaker ?? record.preacher ?? record.author ?? "";
  const date = record.date ?? record.publishedAt ?? "";
  const type = String(record.type ?? record.Type ?? "sermon").toLowerCase();
  const yt = record.youtubeUrl ?? record.YoutubeUrl ?? record.youtube ?? record.YouTubeURL;
  const ytId = extractYouTubeId(yt);
  const thumb = thumbnailUrlFromId(ytId);
  const watchUrl = watchUrlFromId(ytId);
  const isPlaying = String(hoverPlayingId) === String(id);
  const tabMeta = TABS.find((t) => t.key === type) || TABS[0];
  const Icon = tabMeta.icon;
  const hasDigitalFile = Boolean(record.hasDigitalFile ?? record.HasDigitalFile);
  const isFree = record.isFree ?? record.IsFree ?? true;
  const priceAmount = Number(record.priceAmount ?? record.PriceAmount ?? 0);
  const currency = record.currency ?? record.Currency ?? "INR";
  const digitalSize = record.digitalSizeBytes ?? record.DigitalSizeBytes;

  return (
    <article className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition overflow-hidden flex flex-col">
      <div
        className="relative aspect-video bg-slate-900 cursor-pointer"
        role="button"
        tabIndex={0}
        onMouseEnter={() => ytId && setHoverPlayingId(id)}
        onMouseLeave={() => isPlaying && setHoverPlayingId(null)}
        onClick={onOpenDetail}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDetail(); } }}
      >
        {isPlaying && ytId ? (
          <iframe
            title={`yt-${id}`}
            src={embedUrlFromId(ytId, { autoplay: true, mute: true, controls: 1 })}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
            frameBorder="0"
          />
        ) : thumb ? (
          <img src={thumb} alt={title} className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-white/60 text-xs">{hasDigitalFile ? "Local file" : "No preview"}</div>
        )}

        {!isPlaying && (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-800">
              <Icon className="w-3 h-3" /> {tabMeta.label.replace(/s$/, "")}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
              className="absolute right-2 top-2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center hover:bg-white"
              aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
            >
              {isBookmarked
                ? <BookmarkCheck className="w-4 h-4 text-amber-600" />
                : <Bookmark className="w-4 h-4 text-slate-700" />}
            </button>
            {ytId && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition">
                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow">
                  <Play className="w-5 h-5 text-slate-900 fill-slate-900 ml-0.5" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col">
        <h3 className="font-semibold text-sm text-slate-900 line-clamp-2" title={title}>{title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          {speaker && <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" />{speaker}</span>}
          {date && <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3 h-3" />{new Date(date).toLocaleDateString()}</span>}
        </div>
        {hasDigitalFile && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isFree || priceAmount <= 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}>
              {type === "sermon" ? "Local file" : isFree || priceAmount <= 0 ? "Free" : formatMoney(priceAmount, currency)}
            </span>
            {hasDigitalFile && digitalSize ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {formatBytes(digitalSize)}
              </span>
            ) : null}
          </div>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between gap-1">
          <div className="flex gap-1">
            {hasDigitalFile && (
              <button
                onClick={onAccess}
                title={isFree || priceAmount <= 0 ? "Download" : "Pay and download"}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
              >
                {isFree || priceAmount <= 0 ? <Download className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                {type === "sermon" ? "Open" : isFree || priceAmount <= 0 ? "Download" : "Pay"}
              </button>
            )}
            <button
              onClick={onShare}
              title="Share"
              className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            {watchUrl && (
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open on YouTube"
                onClick={(e) => e.stopPropagation()}
                className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          {canManage && (
            <div className="flex gap-1">
              <button
                onClick={onEdit}
                title="Edit"
                className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                title="Delete"
                className="w-8 h-8 rounded-lg border border-red-100 bg-white hover:bg-red-50 flex items-center justify-center text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/* ======================================================================== */
/*  Detail modal — full embedded player                                      */
/* ======================================================================== */

function DetailModal({ record, onClose, isBookmarked, onToggleBookmark, onShare, onAccess }) {
  const title = record.title ?? record.name ?? "Untitled";
  const speaker = record.speaker ?? record.preacher ?? record.author ?? "";
  const date = record.date ?? record.publishedAt ?? "";
  const yt = record.youtubeUrl ?? record.YoutubeUrl ?? record.youtube ?? record.YouTubeURL;
  const id = extractYouTubeId(yt);
  const watchUrl = watchUrlFromId(id);
  const hasDigitalFile = Boolean(record.hasDigitalFile ?? record.HasDigitalFile);
  const isFree = record.isFree ?? record.IsFree ?? true;
  const priceAmount = Number(record.priceAmount ?? record.PriceAmount ?? 0);
  const currency = record.currency ?? record.Currency ?? "INR";
  const digitalSize = record.digitalSizeBytes ?? record.DigitalSizeBytes;

  // Close on Esc
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[170] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
         onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 truncate pr-4">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="aspect-video bg-black">
          {id ? (
            <iframe
              title={`detail-${record.id ?? record.Id}`}
              src={embedUrlFromId(id, { autoplay: true, mute: false, controls: 1 })}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
              frameBorder="0"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/60 text-sm">{hasDigitalFile ? "Local file available" : "No video available"}</div>
          )}
        </div>

        <div className="p-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {speaker && <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" />{speaker}</span>}
            {date && <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3 h-3" />{new Date(date).toLocaleDateString()}</span>}
          </div>

          {record.description && (
            <p className="mt-3 text-sm text-slate-700 whitespace-pre-line">{record.description}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {hasDigitalFile && (
              <button onClick={onAccess} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 text-white text-xs font-semibold px-3 py-2 hover:bg-amber-600">
                {isFree || priceAmount <= 0 ? <Download className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                {isFree || priceAmount <= 0 ? "Open local file" : `Pay ${formatMoney(priceAmount, currency)}`}
                {digitalSize ? <span className="opacity-80">({formatBytes(digitalSize)})</span> : null}
              </button>
            )}
            <button onClick={onToggleBookmark} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium px-3 py-2 hover:bg-slate-50">
              {isBookmarked ? <BookmarkCheck className="w-3.5 h-3.5 text-amber-600" /> : <Bookmark className="w-3.5 h-3.5" />}
              {isBookmarked ? "Bookmarked" : "Bookmark"}
            </button>
            <button onClick={onShare} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium px-3 py-2 hover:bg-slate-50">
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            {watchUrl && (
              <a href={watchUrl} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium px-3 py-2 hover:bg-slate-50">
                <ExternalLink className="w-3.5 h-3.5" /> Open on YouTube
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Add / Edit form modal                                                    */
/* ======================================================================== */

function ResourceFormModal({ target, defaultType, onCancel, onSave }) {
  const isEdit = !!target;
  const [form, setForm] = useState(() => {
    if (target) {
      return {
        id: target.id ?? target.Id ?? null,
        type: String(target.type ?? target.Type ?? defaultType ?? "sermon").toLowerCase(),
        title: target.title ?? target.name ?? "",
        speaker: target.speaker ?? target.preacher ?? target.author ?? "",
        date: (target.date || target.publishedAt || "").slice(0, 10),
        youtube: target.youtube ?? target.youtubeUrl ?? target.YoutubeUrl ?? "",
        description: target.description ?? "",
        isFree: target.isFree ?? target.IsFree ?? true,
        priceAmount: target.priceAmount ?? target.PriceAmount ?? 0,
        currency: target.currency ?? target.Currency ?? "INR",
        digitalFile: null,
        hasDigitalFile: Boolean(target.hasDigitalFile ?? target.HasDigitalFile),
      };
    }
    return {
      id: null,
      type: defaultType || "sermon",
      title: "",
      speaker: "",
      date: "",
      youtube: "",
      description: "",
      isFree: true,
      priceAmount: 0,
      currency: "INR",
      digitalFile: null,
      hasDigitalFile: false,
    };
  });
  const [saving, setSaving] = useState(false);

  const ytId = extractYouTubeId(form.youtube);
  const previewUrl = ytId ? embedUrlFromId(ytId, { autoplay: false, mute: true, controls: 1 }) : null;
  const isSermon = form.type === "sermon";
  const uploadLabel = isSermon ? "Local sermon file" : "Digital print";
  const uploadHelp = isSermon
    ? "Upload sermon audio/video locally under Server Files. YouTube can still be used as an optional external link."
    : "Upload a PDF, EPUB, Word, text, MOBI, or ZIP file for member download.";
  const uploadAccept = isSermon
    ? ".mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.m4v,.webm,.pdf,.doc,.docx,.txt,.zip,audio/*,video/*,application/pdf"
    : ".pdf,.epub,.mobi,.doc,.docx,.txt,.zip,application/pdf,application/epub+zip";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[160] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {isEdit ? "Edit" : "Add"} resource
          </h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-3 gap-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              const sel = form.type === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t.key }))}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                    sel
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label.replace(/s$/, "")}
                </button>
              );
            })}
          </div>

          <Field label="Title *">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                   required autoFocus className="input" />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Speaker / Author">
              <input value={form.speaker} onChange={(e) => setForm({ ...form, speaker: e.target.value })} className="input" />
            </Field>
            <Field label="Date">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" />
            </Field>
          </div>

          <Field label={form.type === "sermon" ? "YouTube URL or 11-character ID (optional if uploading local file)" : "URL or YouTube ID (optional)"}>
            <input
              value={form.youtube}
              onChange={(e) => setForm({ ...form, youtube: e.target.value })}
              placeholder={form.type === "sermon" ? "https://youtu.be/VIDEO_ID  or  VIDEO_ID" : "External article/book link, YouTube ID, or leave blank"}
              className="input font-mono text-xs"
            />
            {form.youtube && !ytId && (
              <span className="text-[11px] text-amber-700 mt-1 inline-block">
                Couldn't recognize that as a YouTube URL or ID.
              </span>
            )}
          </Field>

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-800">{uploadLabel}</div>
                  <div className="text-[11px] text-slate-500">{uploadHelp}</div>
                </div>
                {form.hasDigitalFile ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
Existing file attached
                  </span>
                ) : null}
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <UploadCloud className="h-4 w-4" />
                {form.digitalFile ? form.digitalFile.name : isSermon ? "Choose local sermon file" : "Choose digital print file"}
                <input
                  type="file"
                  className="hidden"
                  accept={uploadAccept}
                  onChange={(e) => setForm({ ...form, digitalFile: e.target.files?.[0] || null })}
                />
              </label>

              {!isSermon && (
              <div className="grid gap-2 sm:grid-cols-[1fr_120px_90px]">
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!form.isFree}
                    onChange={(e) => setForm({ ...form, isFree: e.target.checked, priceAmount: e.target.checked ? 0 : form.priceAmount })}
                  />
                  Mark as free
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  disabled={!!form.isFree}
                  value={form.priceAmount}
                  onChange={(e) => setForm({ ...form, priceAmount: e.target.value })}
                  className="input"
                  placeholder="Price"
                />
                <input
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  disabled={!!form.isFree}
                  className="input"
                  placeholder="INR"
                />
              </div>
              )}
            </div>

          <Field label="Description (optional)">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="input resize-y"
              placeholder="A short summary, scripture references, or notes."
            />
          </Field>

          {previewUrl && (
            <div>
              <span className="text-[11px] text-slate-500 mb-1 block">Preview</span>
              <div className="aspect-video rounded-xl overflow-hidden bg-black border border-slate-200">
                <iframe
                  title="form-preview"
                  src={previewUrl}
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                  frameBorder="0"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <button type="button" onClick={onCancel}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Add"}
          </button>
        </div>

        <style>{`
          .input{ width:100%; padding:0.5rem 0.75rem; border-radius:0.625rem; border:1px solid rgb(226,232,240); background:#fff; font-size:13px; outline:none; }
          .input:focus{ border-color:rgb(245,158,11); box-shadow:0 0 0 1px rgb(245,158,11); }
        `}</style>
      </form>
    </div>
  );
}

/* ======================================================================== */
/*  Empty state + Skeleton                                                   */
/* ======================================================================== */

function EmptyState({ tab, query, showingBookmarksOnly, canAdd, onAdd }) {
  const Icon = tab.icon;
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
      <Icon className="w-10 h-10 mx-auto text-slate-300" />
      <h3 className="mt-3 text-sm font-semibold text-slate-700">
        {showingBookmarksOnly
          ? `No bookmarked ${tab.label.toLowerCase()}.`
          : query
          ? `No ${tab.label.toLowerCase()} match "${query}".`
          : `No ${tab.label.toLowerCase()} yet.`}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {canAdd ? "Add the first one to get started." : "Check back later — new content arrives regularly."}
      </p>
      {canAdd && (
        <button onClick={onAdd}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-2">
          <Plus className="w-3.5 h-3.5" /> Add {tab.label.replace(/s$/, "").toLowerCase()}
        </button>
      )}
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="aspect-video bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100 bg-[length:200%_100%] animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500 mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}

