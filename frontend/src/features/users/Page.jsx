// src/features/users/UsersPage.CathedralAdvanced.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bell,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileText,
  IdCard,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  UnlockKeyhole,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import api, { API_BASE } from "../../api";
import { useLanguage } from "../../i18n/LanguageContext";

const DEFAULT_LIMIT = 10;
const SEARCH_DATASET_LIMIT = 5000;
const SEARCH_DATASET_PAGE_SIZE = 500;

const defaultSearchFilters = {
  role: "",
  contact: "any",
  sex: "",
  baptized: "any",
  bornAgain: "any",
  believer: "any",
  pastor: "any",
  hasCode: "any",
  joinedFrom: "",
  joinedTo: "",
  sortBy: "relevance",
  sortDir: "asc",
};

const emptyBroadcastChannels = {
  email: true,
  whatsapp: true,
  sms: true,
};

function isoToDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatFriendlyDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

function calculateAge(value) {
  if (!value) return "";
  const birthday = new Date(value);
  if (Number.isNaN(birthday.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDelta = today.getMonth() - birthday.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthday.getDate())) age -= 1;
  return age >= 0 && age < 130 ? String(age) : "";
}

function normalizeResponse(res) {
  if (res?.ok === false) {
    throw new Error(res?.statusText || "Request failed.");
  }

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

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

function defaultForm() {
  return {
    id: null,
    displayName: "",
    username: "",
    email: "",
    phone: "",
    password: "",
    role: "",
    joinDate: new Date().toISOString(),
    UserCode: "",
    profilePhotoUrl: "",
    birthday: "",
    maritalStatus: "",
    sex: "",
    isBaptized: false,
    baptismPlace: "",
    baptismDate: "",
    isBornAgain: false,
    isBeliever: false,
    age: "",
    aadharNumber: "",
    homeAddress: "",
    currentAddress: "",
    emergencyContactPhone: "",
    isPastor: false,
    payrollEnabled: false,
    primaryPosition: "",
    appointmentLetterUrl: "",
    appointmentLetterGeneratedAtUtc: "",
  };
}

const phoneAllowTypingRegex = /^\+?\d*$/;
const phoneFinalRegex = /^\+\d{10,}$/;

const valueOf = (value) => (value == null ? "" : String(value));

const normalizeText = (value) =>
  valueOf(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const userIdOf = (user) => user?.id ?? user?.Id ?? "";

const displayNameOf = (user) =>
  valueOf(
    user?.displayName ??
      user?.DisplayName ??
      user?.name ??
      user?.Name ??
      user?.username ??
      user?.userName ??
      user?.UserName ??
      "Unnamed user"
  );

const usernameOf = (user) => valueOf(user?.username ?? user?.userName ?? user?.UserName);
const emailOf = (user) => valueOf(user?.email ?? user?.Email);
const phoneOf = (user) => valueOf(user?.phone ?? user?.Phone);
const userCodeOf = (user) => valueOf(user?.UserCode ?? user?.userCode);
const profilePhotoUrlOf = (user) =>
  valueOf(user?.profilePhotoUrl ?? user?.ProfilePhotoUrl ?? user?.avatarUrl ?? user?.AvatarUrl ?? user?.photoUrl ?? user?.PhotoUrl);
const isBlockedOf = (user) => Boolean(user?.isBlocked ?? user?.IsBlocked);
const blockReasonOf = (user) => valueOf(user?.blockReason ?? user?.BlockReason);

const resolveMediaUrl = (url) => {
  const value = valueOf(url).trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:")) return value;
  const base = (API_BASE || "/api").replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
};

const initialsOf = (name) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function scopeLabelForPosition(value) {
  if (/church/i.test(String(value))) return "Church Level";
  if (/team/i.test(String(value))) return "My Teams";
  return "My";
}
function roleLabelOf(user, roles) {
  if (user?.RoleName) return user.RoleName;
  if (user?.roleName) return user.roleName;

  const candidate = user?.Role ?? user?.role ?? user?.RoleId ?? user?.roleId;
  if (candidate == null || candidate === "") return "member";

  const asNumber = Number(candidate);
  if (!Number.isNaN(asNumber)) {
    const found = roles.find((role) => Number(role.id ?? role.Id) === asNumber);
    return found?.name ?? found?.Name ?? String(candidate);
  }

  const found = roles.find(
    (role) => String(role.name ?? role.Name).toLowerCase() === String(candidate).toLowerCase()
  );

  return found?.name ?? found?.Name ?? String(candidate);
}

function splitSearchTokens(query) {
  const tokens = [];
  valueOf(query).replace(/"([^"]+)"|(\S+)/g, (_, quoted, bare) => {
    tokens.push(quoted || bare);
    return "";
  });
  return tokens.filter(Boolean);
}

function boolOf(user, camel, pascal) {
  return Boolean(user?.[camel] ?? user?.[pascal]);
}

function searchBlobOf(user, roles) {
  return normalizeText(
    [
      displayNameOf(user),
      usernameOf(user),
      emailOf(user),
      phoneOf(user),
      userCodeOf(user),
      userIdOf(user),
      roleLabelOf(user, roles),
      user?.sex,
      user?.Sex,
      user?.maritalStatus,
      user?.MaritalStatus,
      user?.homeAddress,
      user?.HomeAddress,
      user?.currentAddress,
      user?.CurrentAddress,
      user?.emergencyContactPhone,
      user?.EmergencyContactPhone,
      boolOf(user, "payrollEnabled", "PayrollEnabled") ? "payroll payroll enabled" : "",
      formatFriendlyDate(user?.joinDate ?? user?.JoinDate),
    ].join(" ")
  );
}

function fieldTextForToken(user, roles, key) {
  const normalizedKey = normalizeText(key);

  if (["name", "display", "displayname"].includes(normalizedKey)) return displayNameOf(user);
  if (["user", "username"].includes(normalizedKey)) return usernameOf(user);
  if (normalizedKey === "email") return emailOf(user);
  if (normalizedKey === "phone") return phoneOf(user);
  if (normalizedKey === "role") return roleLabelOf(user, roles);
  if (["code", "mahima", "mahimaid"].includes(normalizedKey)) return userCodeOf(user);
  if (normalizedKey === "id") return userIdOf(user);
  if (normalizedKey === "sex") return user?.sex ?? user?.Sex ?? "";
  if (normalizedKey === "joined") return formatFriendlyDate(user?.joinDate ?? user?.JoinDate);
  if (normalizedKey === "birthday") return formatFriendlyDate(user?.birthday ?? user?.Birthday);
  if (normalizedKey === "address") return `${user?.homeAddress ?? ""} ${user?.currentAddress ?? ""}`;

  return searchBlobOf(user, roles);
}

function tokenMatchesUser(user, token, roles) {
  const raw = valueOf(token).trim();
  if (!raw) return true;

  const colonIndex = raw.indexOf(":");

  if (colonIndex > 0) {
    const key = raw.slice(0, colonIndex);
    const value = normalizeText(raw.slice(colonIndex + 1));

    if (!value) return true;

    const boolKeys = {
      pastor: boolOf(user, "isPastor", "IsPastor"),
      baptized: boolOf(user, "isBaptized", "IsBaptized"),
      believer: boolOf(user, "isBeliever", "IsBeliever"),
      bornagain: boolOf(user, "isBornAgain", "IsBornAgain"),
      payroll: boolOf(user, "payrollEnabled", "PayrollEnabled"),
      payrollenabled: boolOf(user, "payrollEnabled", "PayrollEnabled"),
    };

    const normalizedKey = normalizeText(key);

    if (Object.prototype.hasOwnProperty.call(boolKeys, normalizedKey)) {
      const expectedYes = ["yes", "true", "1", "y"].includes(value);
      const expectedNo = ["no", "false", "0", "n"].includes(value);
      if (!expectedYes && !expectedNo) return true;
      return expectedYes ? boolKeys[normalizedKey] : !boolKeys[normalizedKey];
    }

    return normalizeText(fieldTextForToken(user, roles, key)).includes(value);
  }

  return searchBlobOf(user, roles).includes(normalizeText(raw));
}

function matchesSmartSearch(user, query, roles) {
  const tokens = splitSearchTokens(query);
  if (tokens.length === 0) return true;
  return tokens.every((token) => tokenMatchesUser(user, token, roles));
}

function relevanceScore(user, query, roles) {
  const tokens = splitSearchTokens(query);
  if (tokens.length === 0) return 0;

  const name = normalizeText(displayNameOf(user));
  const username = normalizeText(usernameOf(user));
  const email = normalizeText(emailOf(user));
  const phone = normalizeText(phoneOf(user));
  const role = normalizeText(roleLabelOf(user, roles));
  const code = normalizeText(userCodeOf(user));
  const blob = searchBlobOf(user, roles);

  return tokens.reduce((score, rawToken) => {
    const token = normalizeText(rawToken.includes(":") ? rawToken.split(":").slice(1).join(":") : rawToken);
    if (!token) return score;

    if (name === token) return score + 180;
    if (name.startsWith(token)) return score + 140;
    if (username.startsWith(token)) return score + 115;
    if (email.startsWith(token)) return score + 100;
    if (phone.includes(token)) return score + 90;
    if (code.includes(token)) return score + 80;
    if (role.includes(token)) return score + 70;
    if (blob.includes(token)) return score + 35;

    return score;
  }, 0);
}

function choiceMatches(choice, value) {
  if (choice === "any") return true;
  return choice === "yes" ? Boolean(value) : !Boolean(value);
}

function dateInRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;

  if (from) {
    const fromTime = new Date(from).getTime();
    if (!Number.isNaN(fromTime) && time < fromTime) return false;
  }

  if (to) {
    const toTime = new Date(`${to}T23:59:59`).getTime();
    if (!Number.isNaN(toTime) && time > toTime) return false;
  }

  return true;
}

function matchesFilters(user, filters, roles) {
  if (filters.role) {
    const role = roles.find((item) => String(item.id ?? item.Id) === String(filters.role));
    const selectedRoleName = normalizeText(role?.name ?? role?.Name ?? filters.role);
    const actualRoleName = normalizeText(roleLabelOf(user, roles));
    const rawRole = normalizeText(user?.Role ?? user?.role ?? user?.RoleId ?? user?.roleId);

    if (actualRoleName !== selectedRoleName && rawRole !== normalizeText(filters.role)) return false;
  }

  if (filters.contact === "email" && !emailOf(user)) return false;
  if (filters.contact === "phone" && !phoneOf(user)) return false;
  if (filters.contact === "missing-email" && emailOf(user)) return false;
  if (filters.contact === "missing-phone" && phoneOf(user)) return false;

  if (filters.sex && normalizeText(user?.sex ?? user?.Sex) !== normalizeText(filters.sex)) return false;

  if (!choiceMatches(filters.baptized, boolOf(user, "isBaptized", "IsBaptized"))) return false;
  if (!choiceMatches(filters.bornAgain, boolOf(user, "isBornAgain", "IsBornAgain"))) return false;
  if (!choiceMatches(filters.believer, boolOf(user, "isBeliever", "IsBeliever"))) return false;
  if (!choiceMatches(filters.pastor, boolOf(user, "isPastor", "IsPastor"))) return false;
  if (!choiceMatches(filters.hasCode, Boolean(userCodeOf(user)))) return false;

  return dateInRange(user?.joinDate ?? user?.JoinDate, filters.joinedFrom, filters.joinedTo);
}

function sortUsers(list, filters, query, roles) {
  const sorted = [...list];

  const direction = filters.sortDir === "desc" ? -1 : 1;

  if (filters.sortBy === "relevance") {
    if (query.trim()) {
      sorted.sort((a, b) => {
        const score = relevanceScore(b, query, roles) - relevanceScore(a, query, roles);
        if (score !== 0) return score;
        return displayNameOf(a).localeCompare(displayNameOf(b));
      });
      return sorted;
    }

    sorted.sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
    return sorted;
  }

  sorted.sort((a, b) => {
    let left = "";
    let right = "";

    if (filters.sortBy === "name") {
      left = displayNameOf(a);
      right = displayNameOf(b);
    } else if (filters.sortBy === "username") {
      left = usernameOf(a);
      right = usernameOf(b);
    } else if (filters.sortBy === "role") {
      left = roleLabelOf(a, roles);
      right = roleLabelOf(b, roles);
    } else if (filters.sortBy === "joined") {
      left = new Date(a?.joinDate ?? a?.JoinDate ?? 0).getTime() || 0;
      right = new Date(b?.joinDate ?? b?.JoinDate ?? 0).getTime() || 0;
      return (left - right) * direction;
    }

    return valueOf(left).localeCompare(valueOf(right)) * direction;
  });

  return sorted;
}

function HighlightText({ text, query }) {
  const value = valueOf(text);
  const terms = splitSearchTokens(query)
    .filter((token) => !token.includes(":"))
    .map(normalizeText)
    .filter((token) => token.length > 1);

  if (!value || terms.length === 0) return value;

  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = value.split(regex);

  return parts.map((part, index) =>
    terms.includes(normalizeText(part)) ? (
      <mark className="users-mark" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    )
  );
}

function hasActiveFilters(filters) {
  return Object.entries(defaultSearchFilters).some(([key, value]) => filters[key] !== value);
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
      className={`users-icon-btn users-icon-btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      title={label}
    >
      {loading ? <Loader2 className="users-spin" size={18} /> : <Icon size={18} />}
      <span className="users-tooltip">{label}</span>
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
      className={`users-action-btn users-action-btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <Loader2 className="users-spin" size={18} /> : <Icon size={18} />}
      <span>{children}</span>
    </button>
  );
}

export default function UsersPageCathedralAdvanced() {
  const { t } = useLanguage();
  const [users, setUsers] = useState([]);
  const [allUsers, setAllUsers] = useState(null);
  const [searchUsers, setSearchUsers] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: DEFAULT_LIMIT });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState(defaultSearchFilters);
  const [clientPage, setClientPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);

  const [loading, setLoading] = useState(false);
  const [searchDatasetLoading, setSearchDatasetLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [letterModalOpen, setLetterModalOpen] = useState(false);
  const [letterForm, setLetterForm] = useState({
    department: "",
    reportingManagerUserId: "",
    appointmentDate: new Date().toISOString().slice(0, 10),
    additionalTerms: "",
  });
  const [reportingCandidates, setReportingCandidates] = useState([]);
  const [reportingCandidatesReason, setReportingCandidatesReason] = useState(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [downloadingLetter, setDownloadingLetter] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [unblockingId, setUnblockingId] = useState(null);
  const [sending, setSending] = useState(false);

  const [error, setError] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [modalSuccess, setModalSuccess] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const [form, setForm] = useState(defaultForm());
  const [photoUploading, setPhotoUploading] = useState(false);
  const [roles, setRoles] = useState([]);
  const [positionAssignments, setPositionAssignments] = useState([]);

  const [broadcastType, setBroadcastType] = useState("Welcome");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastChannels, setBroadcastChannels] = useState(emptyBroadcastChannels);
  const [whatsAppContentSid, setWhatsAppContentSid] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sendResults, setSendResults] = useState(null);
  const [modalSearch, setModalSearch] = useState("");


  const primaryPositionByUser = useMemo(() => {
    const map = new Map();
    positionAssignments.forEach((row) => {
      const userId = String(row.userId || row.UserId || "");
      if (!userId) return;
      const current = map.get(userId) || [];
      current.push(row);
      map.set(userId, current);
    });
    const primaryMap = new Map();
    map.forEach((rows, userId) => {
      const primary = rows.find((row) => Boolean(row.isPrimary ?? row.IsPrimary)) || rows[0];
      if (!primary) return;
      const name = primary.positionName || primary.PositionName || "Position";
      const scope = primary.visibilityScope || primary.VisibilityScope || "My";
      primaryMap.set(userId, `${name} (${scopeLabelForPosition(scope)})`);
    });
    return primaryMap;
  }, [positionAssignments]);

  function primaryPositionOfUser(user) {
    return primaryPositionByUser.get(String(userIdOf(user))) || "Not assigned";
  }
  const activeFilterMode = hasActiveFilters(filters);
  const powerSearchActive = Boolean(debouncedSearch || activeFilterMode);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("mahima_user_recent_searches") || "[]");
      setRecentSearches(Array.isArray(stored) ? stored.slice(0, 6) : []);
    } catch {
      setRecentSearches([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) return;

    setRecentSearches((prev) => {
      const next = [debouncedSearch, ...prev.filter((item) => item !== debouncedSearch)].slice(0, 6);
      localStorage.setItem("mahima_user_recent_searches", JSON.stringify(next));
      return next;
    });
  }, [debouncedSearch]);

  const fetchUsers = useCallback(async (page = 1, limit = DEFAULT_LIMIT) => {
    setLoading(true);
    setError("");

    try {
      const resp = await api.get("/users", {
        params: { page, limit },
      });

      const { items, meta: nextMeta } = normalizeResponse(resp);

      const sorted = [...items].sort((a, b) =>
        displayNameOf(a).toLowerCase().localeCompare(displayNameOf(b).toLowerCase())
      );

      setUsers(sorted);
      setMeta({
        page: nextMeta.page ?? page,
        limit,
        total: nextMeta.total ?? sorted.length,
      });
    } catch (err) {
      console.error(err);
      setUsers([]);
      setError(apiErrorMessage(err, "Unable to load users."));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSearchDataset = useCallback(
    async (force = false) => {
      if (searchUsers !== null && !force) return searchUsers;

      setSearchDatasetLoading(true);

      try {
        const collected = [];
        let page = 1;
        let total = null;

        while (collected.length < SEARCH_DATASET_LIMIT) {
          const resp = await api.get("/users", {
            params: { page, limit: SEARCH_DATASET_PAGE_SIZE },
          });

          const { items, meta: nextMeta } = normalizeResponse(resp);
          collected.push(...items);
          total = nextMeta.total ?? total;

          if (!items.length) break;
          if (total !== null && collected.length >= total) break;
          if (items.length < SEARCH_DATASET_PAGE_SIZE) break;
          page += 1;
        }

        const byId = new Map();
        for (const user of collected) {
          const id = userIdOf(user);
          if (id) byId.set(id, user);
        }

        const items = Array.from(byId.values());
        setSearchUsers(items);
        return items;
      } catch (err) {
        console.error("fetchSearchDataset error:", err);
        setSearchUsers([]);
        setError(apiErrorMessage(err, "Unable to load searchable users."));
        return [];
      } finally {
        setSearchDatasetLoading(false);
      }
    },
    [searchUsers]
  );

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);

    try {
      const resp = await api.get("/roles");
      const { items } = normalizeResponse(resp);
      setRoles(items);
    } catch (err) {
      console.warn("fetchRoles error:", err);
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, []);
  const fetchPositionAssignments = useCallback(async () => {
    try {
      const resp = await api.get("/positions/assignments");
      const { items } = normalizeResponse(resp);
      setPositionAssignments(items);
    } catch (err) {
      console.warn("fetchPositionAssignments error:", err);
      setPositionAssignments([]);
    }
  }, []);

  useEffect(() => {
    fetchUsers(1, DEFAULT_LIMIT);
  }, [fetchUsers]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);
  useEffect(() => {
    fetchPositionAssignments();
  }, [fetchPositionAssignments]);

  useEffect(() => {
    setClientPage(1);
    if (powerSearchActive) fetchSearchDataset();
  }, [powerSearchActive, debouncedSearch, filters, fetchSearchDataset]);

  const fetchAllUsers = useCallback(async () => {
    if (allUsers !== null) return;

    try {
      const items = await fetchSearchDataset(true);
      const sorted = [...items].sort((a, b) =>
        displayNameOf(a).toLowerCase().localeCompare(displayNameOf(b).toLowerCase())
      );

      setAllUsers(sorted);
      setSelectedIds(new Set(sorted.map(userIdOf).filter(Boolean)));
    } catch (err) {
      console.error("fetchAllUsers error:", err);
      setAllUsers([]);
    }
  }, [allUsers, fetchSearchDataset]);

  const setField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "birthday") next.age = calculateAge(value);
      return next;
    });
  };

  const uploadProfilePhoto = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      setModalMessage("Please choose an image file.");
      setModalSuccess(false);
      return;
    }

    const token = localStorage.getItem("mahima_token") || localStorage.getItem("authToken") || localStorage.getItem("token") || "";
    const body = new FormData();
    body.append("file", file);

    try {
      setPhotoUploading(true);
      setModalMessage("");
      const base = (API_BASE || "/api").replace(/\/+$/, "");
      const res = await fetch(`${base}/uploads`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}` } : undefined,
        body,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Photo upload failed.");
      const url = data?.url || data?.Url || data?.absoluteUrl || data?.path || data?.Path;
      if (!url) throw new Error("Upload succeeded but no file URL was returned.");
      setField("profilePhotoUrl", url);
      setModalSuccess(true);
      setModalMessage("Photo uploaded. Save the user to keep it.");
    } catch (err) {
      setModalSuccess(false);
      setModalMessage(err?.message || "Photo upload failed.");
    } finally {
      setPhotoUploading(false);
    }
  };

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetSearch = () => {
    setSearch("");
    setDebouncedSearch("");
    setFilters(defaultSearchFilters);
    setClientPage(1);
  };

  const resolveDefaultRole = useCallback(() => {
    const memberRole = roles.find(
      (role) => String(role.name ?? role.Name).toLowerCase() === "member"
    );

    return String(memberRole?.id ?? memberRole?.Id ?? roles[0]?.id ?? roles[0]?.Id ?? "");
  }, [roles]);

  const openAdd = () => {
    setForm({ ...defaultForm(), role: resolveDefaultRole() });
    setModalMessage("");
    setModalSuccess(false);
    setShowModal(true);
  };

  const openEdit = (user) => {
    const rawRole =
      user.Role ??
      user.RoleId ??
      user.role ??
      user.roleId ??
      user.roleName ??
      user.RoleName ??
      "";

    let normalizedRoleId = "";

    if (rawRole !== "") {
      const asNumber = Number(rawRole);
      if (!Number.isNaN(asNumber) && asNumber > 0) {
        normalizedRoleId = String(asNumber);
      } else {
        const match = roles.find(
          (role) => String(role.name ?? role.Name).toLowerCase() === String(rawRole).toLowerCase()
        );
        normalizedRoleId = match ? String(match.id ?? match.Id) : String(rawRole);
      }
    }

    setForm({
      id: userIdOf(user) || null,
      UserCode: user.UserCode ?? user.userCode ?? "",
      profilePhotoUrl: profilePhotoUrlOf(user),
      displayName: user.displayName ?? user.DisplayName ?? user.name ?? user.Name ?? "",
      username: user.username ?? user.userName ?? user.UserName ?? "",
      email: user.email ?? user.Email ?? "",
      phone: user.phone ?? user.Phone ?? "",
      password: "",
      role: normalizedRoleId,
      joinDate: user.joinDate ? new Date(user.joinDate).toISOString() : new Date().toISOString(),
      birthday: formatDate(user.birthday ?? user.Birthday),
      maritalStatus: user.maritalStatus ?? user.MaritalStatus ?? "",
      sex: user.sex ?? user.Sex ?? "",
      isBaptized: Boolean(user.isBaptized ?? user.IsBaptized),
      baptismPlace: user.baptismPlace ?? user.BaptismPlace ?? "",
      baptismDate: formatDate(user.baptismDate ?? user.BaptismDate),
      isBornAgain: Boolean(user.isBornAgain ?? user.IsBornAgain),
      isBeliever: Boolean(user.isBeliever ?? user.IsBeliever),
      age: calculateAge(user.birthday ?? user.Birthday) || user.age || user.Age || "",
      aadharNumber: user.aadharNumber ?? user.AadharNumber ?? "",
      homeAddress: user.homeAddress ?? user.HomeAddress ?? "",
      currentAddress: user.currentAddress ?? user.CurrentAddress ?? "",
      emergencyContactPhone: user.emergencyContactPhone ?? user.EmergencyContactPhone ?? "",
      isPastor: Boolean(user.isPastor ?? user.IsPastor),
      payrollEnabled: Boolean(user.payrollEnabled ?? user.PayrollEnabled ?? user.isPayrollEnabled ?? user.IsPayrollEnabled),
      primaryPosition: primaryPositionOfUser(user),
      appointmentLetterUrl: user.appointmentLetterUrl ?? user.AppointmentLetterUrl ?? "",
      appointmentLetterGeneratedAtUtc: user.appointmentLetterGeneratedAtUtc ?? user.AppointmentLetterGeneratedAtUtc ?? "",
    });

    setModalMessage("");
    setModalSuccess(false);
    setShowModal(true);
  };

  const roleIdFromForm = () => {
    if (form.role == null || form.role === "") return null;

    const asNumber = Number(form.role);
    if (!Number.isNaN(asNumber) && asNumber > 0) return asNumber;

    const byName = roles.find(
      (role) => String(role.name ?? role.Name).toLowerCase() === String(form.role).toLowerCase()
    );

    return byName ? Number(byName.id ?? byName.Id) : null;
  };

  const refreshCurrentView = async () => {
    if (powerSearchActive) {
      await fetchSearchDataset(true);
    } else {
      await fetchUsers(meta.page, meta.limit);
    }
  };

  const saveUser = async (event) => {
    event?.preventDefault?.();

    const username = form.username.trim();

    if (!username) {
      setModalMessage("Username is required.");
      setModalSuccess(false);
      return;
    }

    if (!form.id && !form.password) {
      setModalMessage("Password is required for new users.");
      setModalSuccess(false);
      return;
    }

    if (form.phone && !phoneFinalRegex.test(form.phone)) {
      if (!window.confirm("Phone should start with + and have at least 10 digits. Continue?")) return;
    }

    setSaving(true);
    setModalMessage("");
    setModalSuccess(false);

    try {
      const roleId = roleIdFromForm();

      const payload = {
        DisplayName: form.displayName.trim() || null,
        displayName: form.displayName.trim() || null,
        Username: username,
        Password: form.password || null,
        Email: form.email.trim() || null,
        Phone: form.phone.trim() || null,
        ProfilePhotoUrl: form.profilePhotoUrl || null,
        profilePhotoUrl: form.profilePhotoUrl || null,
        AvatarUrl: form.profilePhotoUrl || null,
        JoinDate: form.joinDate ? new Date(form.joinDate).toISOString() : null,
        Birthday: form.birthday || null,
        MaritalStatus: form.maritalStatus || null,
        Sex: form.sex || null,
        IsBaptized: form.isBaptized ?? null,
        BaptismPlace: form.baptismPlace || null,
        BaptismDate: form.baptismDate || null,
        IsBornAgain: form.isBornAgain ?? null,
        IsBeliever: form.isBeliever ?? null,
        Age: calculateAge(form.birthday) === "" ? (form.age === "" ? null : Number(form.age)) : Number(calculateAge(form.birthday)),
        AadharNumber: form.aadharNumber || null,
        HomeAddress: form.homeAddress || null,
        CurrentAddress: form.currentAddress || null,
        EmergencyContactPhone: form.emergencyContactPhone || null,
        IsPastor: form.isPastor ?? null,
        PayrollEnabled: form.payrollEnabled ?? false,
        ...(form.id ? { Id: form.id } : {}),
      };

      if (roleId != null) {
        payload.Role = roleId;
        payload.RoleId = roleId;

        const role = roles.find((item) => Number(item.id ?? item.Id) === Number(roleId));
        if (role) payload.RoleName = role.name ?? role.Name;
      } else if (form.role) {
        payload.RoleName = form.role;
      }

      if (form.id) {
        const result = await api.put(`/users/${form.id}`, payload);
        if (result?.ok === false) {
          throw new Error(result.error || result.statusText || "Save failed.");
        }
      } else {
        const result = await api.post("/users", payload);
        if (result?.ok === false) {
          throw new Error(result.error || result.statusText || "Create user failed.");
        }
      }

      setShowModal(false);
      setSearchUsers(null);
      setAllUsers(null);
      fetchPositionAssignments();
      setClientPage(1);
      await fetchUsers(form.id ? meta.page : 1, meta.limit);
      if (powerSearchActive) await fetchSearchDataset(true);
    } catch (err) {
      console.error("saveUser error:", err);
      setModalMessage(apiErrorMessage(err, "Save failed."));
      setModalSuccess(false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id) => {
    if (!id || !window.confirm("Delete this user?")) return;

    setDeletingId(id);

    try {
      const result = await api.delete(`/users/${id}`);
      if (result?.ok === false) {
        throw new Error(result.error || result.statusText || "Delete failed");
      }

      setSearchUsers((prev) => (Array.isArray(prev) ? prev.filter((user) => userIdOf(user) !== id) : prev));
      setAllUsers((prev) => (Array.isArray(prev) ? prev.filter((user) => userIdOf(user) !== id) : prev));
      setClientPage(1);

      await fetchUsers(meta.page, meta.limit);
    } catch (err) {
      alert("Delete failed: " + (err?.response?.data?.message || err?.message || String(err)));
    } finally {
      setDeletingId(null);
    }
  };

  const unblockUser = async (id) => {
    if (!id || !window.confirm("Unblock this user and allow login again?")) return;

    setUnblockingId(id);

    try {
      await api.post(`/admin/chat-safety/users/${id}/unblock`);
      setSearchUsers(null);
      setAllUsers(null);
      await refreshCurrentView();
    } catch (err) {
      alert("Unblock failed: " + (err?.response?.data?.message || err?.message || String(err)));
    } finally {
      setUnblockingId(null);
    }
  };

  const resetPasswordForFormUser = async () => {
    setModalMessage("");
    setModalSuccess(false);

    if (!form.id) {
      setModalMessage("User id not available.");
      return;
    }

    const username = form.username.trim();

    if (!username) {
      setModalMessage("Username is required.");
      return;
    }

    const newPassword = `${username}123`;

    if (!window.confirm(`Reset password for "${username}" to "${newPassword}"?`)) return;

    setResetting(true);

    try {
      await api.post(`/users/${form.id}/reset-password`, { newPassword });

      setModalMessage(`Password reset to "${newPassword}".`);
      setModalSuccess(true);
    } catch (err) {
      console.error("resetPassword error:", err);
      setModalMessage(err?.response?.data?.message || err?.message || "Reset failed.");
      setModalSuccess(false);
    } finally {
      setResetting(false);
    }
  };

  const openLetterModal = async () => {
    setLetterForm({
      department: "",
      reportingManagerUserId: "",
      appointmentDate: new Date().toISOString().slice(0, 10),
      additionalTerms: "",
      salaryType: "Monthly",
    });
    setModalMessage("");
    setModalSuccess(false);
    setReportingCandidates([]);
    setReportingCandidatesReason(null);
    setLetterModalOpen(true);

    if (!form.id) return;
    setLoadingCandidates(true);
    try {
      const resp = await api.get(`/users/${form.id}/reporting-candidates`);
      setReportingCandidates(resp?.data?.items || []);
      setReportingCandidatesReason(resp?.data?.reason || null);
    } catch (err) {
      console.warn("fetchReportingCandidates error:", err);
      setReportingCandidates([]);
      setReportingCandidatesReason("error");
    } finally {
      setLoadingCandidates(false);
    }
  };

  const generateAppointmentLetter = async (event) => {
    event?.preventDefault?.();
    if (!form.id) return;

    setGeneratingLetter(true);
    try {
      const payload = {
        Department: letterForm.department.trim() || null,
        ReportingManagerUserId: letterForm.reportingManagerUserId || null,
        AppointmentDate: letterForm.appointmentDate ? new Date(letterForm.appointmentDate).toISOString() : null,
        AdditionalTerms: letterForm.additionalTerms.trim() || null,
        SalaryType: letterForm.salaryType || null,
      };
      await api.post(`/users/${form.id}/appointment-letter`, payload);

      setForm((prev) => ({
        ...prev,
        appointmentLetterUrl: "generated",
        appointmentLetterGeneratedAtUtc: new Date().toISOString(),
      }));
      setLetterModalOpen(false);
      setModalMessage("Appointment letter generated.");
      setModalSuccess(true);
    } catch (err) {
      console.error("generateAppointmentLetter error:", err);
      setModalMessage(apiErrorMessage(err, "Could not generate the appointment letter."));
      setModalSuccess(false);
    } finally {
      setGeneratingLetter(false);
    }
  };

  const downloadAppointmentLetter = async () => {
    if (!form.id) return;
    setDownloadingLetter(true);
    try {
      const response = await api.get(`/users/${form.id}/appointment-letter`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `AppointmentLetter_${form.username || form.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("downloadAppointmentLetter error:", err);
      setModalMessage(apiErrorMessage(err, "Could not download the appointment letter."));
      setModalSuccess(false);
    } finally {
      setDownloadingLetter(false);
    }
  };

  const openBroadcast = async (type) => {
    setBroadcastType(type);
    setBroadcastMessage("");
    setBroadcastChannels(emptyBroadcastChannels);
    setWhatsAppContentSid("");
    setSendResults(null);
    setModalSearch("");
    setBroadcastOpen(true);
    await fetchAllUsers();
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllRecipients = () => {
    if (!allUsers) return;
    setSelectedIds(new Set(allUsers.map(userIdOf).filter(Boolean)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const sendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      alert("Please enter a message to send.");
      return;
    }

    if (selectedIds.size === 0 && !window.confirm("No recipients selected. Continue?")) return;

    setSending(true);
    setSendResults(null);

    try {
      const payload = {
        type: broadcastType,
        message: broadcastMessage.trim(),
        userIds: Array.from(selectedIds),
        channels: {
          email: Boolean(broadcastChannels.email),
          whatsapp: Boolean(broadcastChannels.whatsapp),
          sms: Boolean(broadcastChannels.sms),
        },
        whatsAppContentSid: broadcastChannels.whatsapp ? whatsAppContentSid.trim() || null : null,
      };

      const resp = await api.post("/messages/send", payload);
      setSendResults(resp?.data ?? { success: false, error: "The server returned no send result." });
    } catch (err) {
      setSendResults({
        success: false,
        error: err?.response?.data?.message || err?.message || "Send failed.",
      });
    } finally {
      setSending(false);
    }
  };

  const filteredSearchUsers = useMemo(() => {
    const source = powerSearchActive ? searchUsers ?? [] : users;

    const filtered = source.filter(
      (user) => matchesSmartSearch(user, debouncedSearch, roles) && matchesFilters(user, filters, roles)
    );

    return sortUsers(filtered, filters, debouncedSearch, roles);
  }, [powerSearchActive, searchUsers, users, debouncedSearch, filters, roles]);

  const visibleUsers = useMemo(() => {
    if (!powerSearchActive) return users;

    const startIndex = (clientPage - 1) * meta.limit;
    return filteredSearchUsers.slice(startIndex, startIndex + meta.limit);
  }, [powerSearchActive, users, filteredSearchUsers, clientPage, meta.limit]);

  const filteredRecipients = useMemo(() => {
    if (!allUsers) return null;

    const query = modalSearch.trim().toLowerCase();
    if (!query) return allUsers;

    return allUsers.filter((user) => {
      const text = [
        displayNameOf(user),
        usernameOf(user),
        emailOf(user),
        phoneOf(user),
        roleLabelOf(user, roles),
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(query);
    });
  }, [allUsers, modalSearch, roles]);

  const activeChips = useMemo(() => {
    const chips = [];

    if (debouncedSearch) chips.push(`Search: ${debouncedSearch}`);

    if (filters.role) {
      const role = roles.find((item) => String(item.id ?? item.Id) === String(filters.role));
      chips.push(`Role: ${role?.name ?? role?.Name ?? filters.role}`);
    }

    if (filters.contact !== "any") chips.push(`Contact: ${filters.contact.replace("-", " ")}`);
    if (filters.sex) chips.push(`Sex: ${filters.sex}`);
    if (filters.baptized !== "any") chips.push(`Baptized: ${filters.baptized}`);
    if (filters.bornAgain !== "any") chips.push(`Born again: ${filters.bornAgain}`);
    if (filters.believer !== "any") chips.push(`Believer: ${filters.believer}`);
    if (filters.pastor !== "any") chips.push(`Pastor: ${filters.pastor}`);
    if (filters.hasCode !== "any") chips.push(`Mahima ID: ${filters.hasCode}`);
    if (filters.joinedFrom) chips.push(`From: ${filters.joinedFrom}`);
    if (filters.joinedTo) chips.push(`To: ${filters.joinedTo}`);
    if (filters.sortBy !== "relevance") chips.push(`Sort: ${filters.sortBy}`);

    return chips;
  }, [debouncedSearch, filters, roles]);

  const totalVisible = powerSearchActive ? filteredSearchUsers.length : meta.total;
  const blockedVisible = (powerSearchActive ? filteredSearchUsers : users).filter(isBlockedOf).length;
  const currentPage = powerSearchActive ? clientPage : meta.page;
  const start = totalVisible === 0 ? 0 : (currentPage - 1) * meta.limit + 1;
  const end = Math.min(totalVisible, currentPage * meta.limit);
  const listLoading = loading || (powerSearchActive && searchDatasetLoading && searchUsers === null);

  return (
    <div className="users-page">
      <style>{`
        .users-page {
          min-height: 100vh;
          padding: 14px;
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
          background: #f9f6ef;
          color: #332817;
        }

        .users-shell {
          display: grid;
          gap: 14px;
        }

        .users-header {
          display: grid;
          gap: 14px;
        }

        .users-header-actions {
          display: grid;
          gap: 10px;
        }

        .users-add-top {
          min-width: 0;
        }

        .users-title {
          margin: 0;
          color: #6b4f1d;
          font-size: clamp(28px, 9vw, 38px);
          line-height: 1.05;
          font-weight: 900;
        }

        .users-subtitle {
          color: #8a7a5c;
          font-size: 14px;
          line-height: 1.45;
        }

        .users-broadcast-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 10px;
        }

        .users-search-stack {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          gap: 8px;
          padding: 10px 0;
          background: #f9f6ef;
        }

        .users-search-bar {
          display: grid;
          grid-template-columns: 1fr 48px 48px;
          gap: 10px;
        }

        .users-search-wrap {
          position: relative;
          min-width: 0;
        }

        .users-search-wrap svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #8a7a5c;
          pointer-events: none;
        }

        .users-input,
        .users-select,
        .users-textarea {
          width: 100%;
          border: 1px solid #ddd2bd;
          border-radius: 14px;
          background: #fff;
          color: #332817;
          font-size: 16px;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .users-input,
        .users-select {
          height: 46px;
          padding: 0 12px;
        }

        .users-search-input {
          padding-left: 40px;
        }

        .users-textarea {
          min-height: 96px;
          padding: 12px;
          resize: vertical;
          line-height: 1.4;
        }

        .users-input:focus,
        .users-select:focus,
        .users-textarea:focus {
          outline: none;
          border-color: #b89b58;
          box-shadow: 0 0 0 4px rgba(184, 155, 88, 0.18);
        }

        .users-chip-row {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 2px;
          scrollbar-width: none;
        }

        .users-chip-row::-webkit-scrollbar {
          display: none;
        }

        .users-chip {
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

        .users-chip-active {
          background: #f8f2e6;
        }

        .users-summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .users-stat {
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

        .users-alert {
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

        .users-list {
          display: grid;
          gap: 12px;
        }

        .user-card {
          display: grid;
          gap: 14px;
          padding: 14px;
          border-radius: 14px;
          border: 1px solid #eee2cf;
          background: #fff;
          box-shadow: 0 8px 24px rgba(80, 60, 28, 0.08);
        }

        .user-card-blocked {
          border-color: #fecaca;
          background: #fff7f7;
        }

        .user-card-main {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .user-avatar {
          width: 50px;
          height: 50px;
          border-radius: 14px;
          background: linear-gradient(135deg, #efe4ca, #d7be83);
          color: #6b4f1d;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          flex-shrink: 0;
          overflow: hidden;
        }

        .user-avatar-img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .user-photo-picker {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px;
          margin-bottom: 14px;
          border: 1px solid rgba(130, 102, 48, 0.18);
          border-radius: 16px;
          background: #fffaf0;
        }

        .user-photo-preview {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #efe4ca, #d7be83);
          color: #6b4f1d;
          font-weight: 900;
          flex-shrink: 0;
        }

        .user-photo-actions {
          min-width: 0;
          display: grid;
          gap: 8px;
        }

        .user-name {
          color: #332817;
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .user-meta {
          margin-top: 4px;
          color: #777;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 70vw;
        }

        .users-mark {
          background: #fff1a8;
          color: inherit;
          border-radius: 5px;
          padding: 0 2px;
        }

        .user-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }

        .user-badge {
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

        .user-badge-blocked {
          border-color: #fecaca;
          background: #fff1f2;
          color: #be123c;
        }

        .user-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .users-empty {
          color: #76664b;
          background: #fff;
          border: 1px dashed #d8c9ad;
          border-radius: 12px;
          padding: 18px;
          line-height: 1.45;
        }

        .users-pagination {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          align-items: center;
        }

        .users-page-count {
          grid-column: 1 / -1;
          color: #8a7a5c;
          font-size: 13px;
          font-weight: 800;
        }

        .users-icon-btn,
        .users-action-btn {
          font-family: inherit;
          cursor: pointer;
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, color 160ms ease;
          -webkit-tap-highlight-color: transparent;
        }

        .users-icon-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 48px;
          border: 1px solid;
          border-radius: 14px;
        }

        .users-icon-btn-neutral {
          background: #fff;
          color: #6b4f1d;
          border-color: #e6dcc8;
        }

        .users-icon-btn-soft {
          background: #f8f2e6;
          color: #6b4f1d;
          border-color: #eadfca;
        }

        .users-icon-btn-primary {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .users-icon-btn-danger {
          background: #fff5f5;
          color: #a83232;
          border-color: #f3c3c3;
        }

        .users-icon-btn:hover:not(:disabled),
        .users-action-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(80, 60, 28, 0.14);
        }

        .users-icon-btn-primary:hover:not(:disabled),
        .users-action-btn-primary:hover:not(:disabled) {
          background: #5a4217;
        }

        .users-icon-btn-danger:hover:not(:disabled) {
          background: #a83232;
          color: #fff;
          border-color: #a83232;
        }

        .users-icon-btn:disabled,
        .users-action-btn:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        .users-tooltip {
          display: none;
        }

        .users-action-btn {
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

        .users-action-btn-primary {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .users-action-btn-secondary {
          background: #fff;
          color: #6b4f1d;
          border-color: #e1d6c0;
        }

        .users-action-btn-danger {
          background: #fff5f5;
          color: #a83232;
          border-color: #f3c3c3;
        }

        .users-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(38, 30, 18, 0.48);
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .users-modal {
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

        .users-modal-header,
        .users-modal-footer {
          padding: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-bottom: 1px solid #f0e5d4;
        }

        .users-modal-footer {
          border-top: 1px solid #f0e5d4;
          border-bottom: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          padding-bottom: max(14px, env(safe-area-inset-bottom));
        }

        .users-modal-title {
          margin: 0;
          color: #332817;
          font-size: 20px;
          font-weight: 900;
        }

        .users-modal-body {
          padding: 14px;
          overflow: auto;
        }

        .users-form-grid,
        .users-filter-grid {
          display: grid;
          gap: 12px;
        }

        .users-field label,
        .users-section-label {
          display: block;
          margin-bottom: 6px;
          color: #8a7a5c;
          font-size: 12px;
          font-weight: 900;
        }

        .users-section {
          display: grid;
          gap: 12px;
          padding-top: 12px;
          margin-top: 4px;
          border-top: 1px solid #f0e5d4;
        }

        .users-check-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .users-check {
          min-height: 42px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 12px;
          background: #f8f2e6;
          color: #6b4f1d;
          border: 1px solid #eadfca;
          font-size: 12px;
          font-weight: 900;
        }

        .recipient-list {
          display: grid;
          gap: 10px;
        }

        .recipient-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 12px;
          border-radius: 14px;
          background: #fffdfa;
          border: 1px solid #eee2cf;
        }

        .channel-grid {
          display: grid;
          gap: 10px;
        }

        .users-spin {
          animation: users-spin 0.8s linear infinite;
        }

        @keyframes users-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .users-skeleton {
          background: linear-gradient(90deg, rgba(0,0,0,0.05), rgba(0,0,0,0.09), rgba(0,0,0,0.05));
          background-size: 200% 100%;
          animation: users-shimmer 1.2s infinite;
          border-radius: 10px;
        }

        @keyframes users-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @media (min-width: 760px) {
          .users-page {
            padding: 24px;
            padding-bottom: 24px;
          }

          .users-header {
            grid-template-columns: 1fr auto;
            align-items: center;
          }

          .users-header-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
          }

          .users-broadcast-grid {
            display: flex;
          }

          .users-summary {
            grid-template-columns: repeat(2, max-content);
          }

          .users-list {
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 18px;
          }

          .user-meta {
            max-width: 100%;
          }

          .users-pagination {
            grid-template-columns: 1fr auto auto;
          }

          .users-page-count {
            grid-column: auto;
          }

          .users-modal-backdrop {
            align-items: center;
            padding: 16px;
          }

          .users-modal {
            width: min(880px, 100%);
            max-height: 90vh;
            border-radius: 16px;
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
          }

          .users-modal-header,
          .users-modal-footer {
            padding: 18px;
          }

          .users-modal-footer {
            display: flex;
            justify-content: flex-end;
          }

          .users-modal-body {
            padding: 18px;
          }

          .users-form-grid,
          .users-filter-grid {
            grid-template-columns: 1fr 1fr;
          }

          .users-field-full {
            grid-column: 1 / -1;
          }

          .users-action-btn {
            width: auto;
          }

          .users-icon-btn {
            width: 42px;
            height: 42px;
          }

          .users-tooltip {
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

          .users-icon-btn:hover .users-tooltip {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .users-page {
          background:
            linear-gradient(180deg, rgba(255,255,255,.96), rgba(246,248,251,.96)),
            radial-gradient(circle at 100% 0%, rgba(4,120,87,.08), transparent 28rem) !important;
          color: var(--enterprise-ink, #102033) !important;
        }
        .users-shell,
        .users-toolbar,
        .users-stat-card,
        .user-card,
        .users-modal,
        .users-search-panel,
        .users-filter-chip,
        .users-page-count,
        .recipient-row {
          border-color: var(--enterprise-border, #dfe7ef) !important;
          border-radius: var(--enterprise-radius-lg, 12px) !important;
          background: var(--enterprise-surface, #ffffff) !important;
          box-shadow: var(--enterprise-shadow-sm, 0 1px 2px rgba(15,23,42,.05)) !important;
        }
        .users-title,
        .user-name,
        .users-modal-title {
          color: var(--enterprise-ink, #102033) !important;
        }
        .users-subtitle,
        .user-meta,
        .users-section-label,
        .users-page-count {
          color: var(--enterprise-muted, #617086) !important;
        }
        .users-input,
        .users-select,
        .users-textarea,
        .users-search-wrap {
          border-color: var(--enterprise-border, #dfe7ef) !important;
          border-radius: var(--enterprise-radius, 10px) !important;
          background: #ffffff !important;
          color: var(--enterprise-ink, #102033) !important;
        }
        .users-input:focus,
        .users-select:focus,
        .users-textarea:focus {
          border-color: rgba(4,120,87,.68) !important;
          box-shadow: 0 0 0 4px rgba(4,120,87,.12) !important;
        }
        .users-button-primary,
        .users-action-btn.primary,
        .users-icon-btn.primary {
          border-color: transparent !important;
          background: linear-gradient(180deg, var(--enterprise-primary, #047857), var(--enterprise-primary-strong, #065f46)) !important;
          color: #ffffff !important;
          box-shadow: 0 8px 20px rgba(4,120,87,.18) !important;
        }
        .users-button-soft,
        .users-button-ghost,
        .users-icon-btn,
        .users-filter-chip {
          border-color: var(--enterprise-border, #dfe7ef) !important;
          background: #ffffff !important;
          color: var(--enterprise-ink, #102033) !important;
        }
        .users-button-danger,
        .users-icon-btn.danger {
          background: var(--enterprise-danger, #dc2626) !important;
          color: #ffffff !important;
        }
        .user-badge,
        .users-filter-chip.active {
          border-color: rgba(4,120,87,.22) !important;
          background: var(--enterprise-primary-soft, #ecfdf5) !important;
          color: var(--enterprise-primary-strong, #065f46) !important;
        }
        .user-card-blocked {
          border-color: #fecaca !important;
          background: #fff7f7 !important;
        }
        .user-badge-blocked {
          border-color: #fecaca !important;
          background: #fff1f2 !important;
          color: #be123c !important;
        }
        .user-avatar,
        .user-photo-preview {
          background: linear-gradient(180deg, var(--enterprise-primary-soft, #ecfdf5), #ffffff) !important;
          color: var(--enterprise-primary-strong, #065f46) !important;
        }
      `}</style>

      <div className="users-shell">
        <div className="users-header mahima-standard-page-header" data-mahima-explicit-header="true">
          <div>
            <h1 className="users-title mahima-standard-page-title" data-mahima-explicit-title="true">{t("page.users.title")}</h1>
            <div className="users-subtitle mahima-standard-page-subtitle">{t("page.users.subtitle")}</div>
          </div>

          <div className="users-header-actions">
            <div className="users-broadcast-grid">
              <IconButton icon={Bell} label={t("page.users.welcomeBroadcast")} onClick={() => openBroadcast("Welcome")} variant="primary" />
            </div>

            <div className="users-add-top">
              <ActionButton icon={UserPlus} onClick={openAdd}>
                {t("common.addUser")}
              </ActionButton>
            </div>
          </div>
        </div>

        <div className="users-search-stack" role="search">
          <div className="users-search-bar">
            <div className="users-search-wrap">
              <Search size={18} />
              <input
                className="users-input users-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("page.users.searchPlaceholder")}
                aria-label={t("page.users.searchPlaceholder")}
              />
            </div>

            <IconButton
              icon={SlidersHorizontal}
              label={t("page.users.searchFilters")}
              onClick={() => setFiltersOpen(true)}
              variant={activeFilterMode ? "primary" : "neutral"}
            />

            <IconButton
              icon={RefreshCw}
              label={t("common.refresh")}
              onClick={refreshCurrentView}
              loading={loading || searchDatasetLoading}
              variant="soft"
            />
          </div>

          {!debouncedSearch && recentSearches.length > 0 && (
            <div className="users-chip-row">
              {recentSearches.map((item) => (
                <button className="users-chip" key={item} type="button" onClick={() => setSearch(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}

          {activeChips.length > 0 && (
            <div className="users-chip-row">
              {activeChips.map((chip) => (
                <span className="users-chip users-chip-active" key={chip}>
                  {chip}
                </span>
              ))}
              <button className="users-chip" type="button" onClick={resetSearch}>
                {t("common.clear")}
              </button>
            </div>
          )}
        </div>

        <div className="users-summary">
          <div className="users-stat">
            <Users size={18} />
            Users: {totalVisible}
          </div>
          <div className="users-stat">
            <Shield size={18} />
            Roles: {rolesLoading ? "..." : roles.length}
          </div>
          <div className="users-stat">
            <UnlockKeyhole size={18} />
            Blocked: {blockedVisible}
          </div>
        </div>

        {error && (
          <div className="users-alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {listLoading ? (
          <div className="users-list">
            {[...Array(6)].map((_, index) => (
              <div className="user-card" key={index}>
                <div className="user-card-main">
                  <div className="user-avatar users-skeleton" />
                  <div style={{ flex: 1, display: "grid", gap: 8 }}>
                    <div className="users-skeleton" style={{ height: 16, width: "55%" }} />
                    <div className="users-skeleton" style={{ height: 12, width: "80%" }} />
                    <div className="users-skeleton" style={{ height: 12, width: "65%" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : visibleUsers.length === 0 ? (
          <div className="users-empty">{t("page.users.noUsersFound")}</div>
        ) : (
          <div className="users-list" role="list">
            {visibleUsers.map((user) => {
              const id = userIdOf(user);
              const name = displayNameOf(user);
              const username = usernameOf(user);
              const email = emailOf(user);
              const phone = phoneOf(user);
              const roleLabel = roleLabelOf(user, roles);
              const primaryPosition = primaryPositionOfUser(user);
              const photoUrl = resolveMediaUrl(profilePhotoUrlOf(user));
              const deleting = deletingId === id;
              const blocked = isBlockedOf(user);
              const unblocking = unblockingId === id;
              const blockReason = blockReasonOf(user);

              return (
                <article className={`user-card ${blocked ? "user-card-blocked" : ""}`} key={id} role="listitem">
                  <div className="user-card-main">
                    <div className="user-avatar">
                      {photoUrl ? (
                        <img className="user-avatar-img" src={photoUrl} alt="" />
                      ) : (
                        initialsOf(name)
                      )}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div className="user-name" title={name} data-no-ui-translate>
                        <HighlightText text={name} query={debouncedSearch} />
                      </div>
                      <div className="user-meta" data-no-ui-translate>
                        <HighlightText text={username || "No username"} query={debouncedSearch} />
                        {email ? " - " : ""}
                        {email ? <HighlightText text={email} query={debouncedSearch} /> : ""}
                      </div>

                      <div className="user-badges">
                        <span className="user-badge" data-no-ui-translate>
                          <HighlightText text={String(roleLabel || "member").toUpperCase()} query={debouncedSearch} />
                        </span>
                        {phone && (
                          <span className="user-badge" data-no-ui-translate>
                            <Phone size={14} />
                            <HighlightText text={phone} query={debouncedSearch} />
                          </span>
                        )}
                        <span className="user-badge">{t("page.users.joined")}: <span data-no-ui-translate>{formatFriendlyDate(user.joinDate)}</span></span>
                        <span className="user-badge">{t("page.users.primaryPosition")}: <span data-no-ui-translate>{primaryPosition}</span></span>
                        {blocked && (
                          <span className="user-badge user-badge-blocked" title={blockReason || "Access blocked"} data-no-ui-translate>
                            <Shield size={14} />
                            BLOCKED{blockReason ? `: ${blockReason}` : ""}
                          </span>
                        )}
                        {userCodeOf(user) && (
                          <span className="user-badge" data-no-ui-translate>
                            <IdCard size={14} />
                            <HighlightText text={userCodeOf(user)} query={debouncedSearch} />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="user-actions">
                    <IconButton icon={Edit3} label={t("page.users.editUser")} onClick={() => openEdit(user)} variant="neutral" />
                    {blocked && (
                      <IconButton
                        icon={UnlockKeyhole}
                        label="Unblock user"
                        onClick={() => unblockUser(id)}
                        loading={unblocking}
                        disabled={Boolean(unblockingId && unblockingId !== id)}
                        variant="soft"
                      />
                    )}
                    <IconButton
                      icon={Trash2}
                      label={t("common.delete")}
                      onClick={() => confirmDelete(id)}
                      loading={deleting}
                      disabled={Boolean(deletingId && deletingId !== id)}
                      variant="danger"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="users-pagination">
          <div className="users-page-count">
            {t("common.showing")} {visibleUsers.length === 0 ? 0 : `${start}-${end}`} {t("common.of")} {totalVisible}
          </div>

          <ActionButton
            icon={ChevronLeft}
            onClick={() => {
              if (powerSearchActive) {
                setClientPage((page) => Math.max(1, page - 1));
              } else {
                fetchUsers(Math.max(1, meta.page - 1), meta.limit);
              }
            }}
            disabled={currentPage <= 1 || listLoading}
            variant="secondary"
          >
            {t("common.prev")}
          </ActionButton>

          <ActionButton
            icon={ChevronRight}
            onClick={() => {
              if (powerSearchActive) {
                setClientPage((page) => page + 1);
              } else {
                fetchUsers(meta.page + 1, meta.limit);
              }
            }}
            disabled={end >= totalVisible || listLoading}
            variant="secondary"
          >
            {t("common.next")}
          </ActionButton>
        </div>
      </div>

      {filtersOpen && (
        <div
          className="users-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target.classList.contains("users-modal-backdrop")) setFiltersOpen(false);
          }}
        >
          <div className="users-modal" style={{ maxWidth: 720 }}>
            <div className="users-modal-header">
              <h2 className="users-modal-title">{t("page.users.searchFilters")}</h2>
              <IconButton icon={X} label={t("common.close")} onClick={() => setFiltersOpen(false)} variant="neutral" />
            </div>

            <div className="users-modal-body">
              <div className="users-filter-grid">
                <div className="users-field">
                  <label>{t("form.role")}</label>
                  <select className="users-select" value={filters.role} onChange={(event) => updateFilter("role", event.target.value)}>
                    <option value="">{t("filter.anyRole")}</option>
                    {roles.map((role) => (
                      <option key={role.id ?? role.Id ?? role.name} value={String(role.id ?? role.Id)}>
                        {role.name ?? role.Name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="users-field">
                  <label>{t("filter.contact")}</label>
                  <select className="users-select" value={filters.contact} onChange={(event) => updateFilter("contact", event.target.value)}>
                    <option value="any">{t("filter.anyContact")}</option>
                    <option value="email">{t("filter.hasEmail")}</option>
                    <option value="phone">{t("filter.hasPhone")}</option>
                    <option value="missing-email">{t("filter.missingEmail")}</option>
                    <option value="missing-phone">{t("filter.missingPhone")}</option>
                  </select>
                </div>

                <div className="users-field">
                  <label>{t("form.sex")}</label>
                  <select className="users-select" value={filters.sex} onChange={(event) => updateFilter("sex", event.target.value)}>
                    <option value="">{t("common.any")}</option>
                    <option value="Male">{t("filter.male")}</option>
                    <option value="Female">{t("filter.female")}</option>
                  </select>
                </div>

                <div className="users-field">
                  <label>{t("form.mahimaId")}</label>
                  <select className="users-select" value={filters.hasCode} onChange={(event) => updateFilter("hasCode", event.target.value)}>
                    <option value="any">{t("common.any")}</option>
                    <option value="yes">{t("filter.hasId")}</option>
                    <option value="no">{t("filter.missingId")}</option>
                  </select>
                </div>

                {[
                  ["pastor", t("filter.pastor")],
                  ["baptized", t("filter.baptized")],
                  ["bornAgain", t("filter.bornAgain")],
                  ["believer", t("filter.believer")],
                ].map(([key, label]) => (
                  <div className="users-field" key={key}>
                    <label>{label}</label>
                    <select className="users-select" value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
                      <option value="any">{t("common.any")}</option>
                      <option value="yes">{t("common.yes")}</option>
                      <option value="no">{t("common.no")}</option>
                    </select>
                  </div>
                ))}

                <div className="users-field">
                  <label>{t("filter.joinedFrom")}</label>
                  <input className="users-input" type="date" value={filters.joinedFrom} onChange={(event) => updateFilter("joinedFrom", event.target.value)} />
                </div>

                <div className="users-field">
                  <label>{t("filter.joinedTo")}</label>
                  <input className="users-input" type="date" value={filters.joinedTo} onChange={(event) => updateFilter("joinedTo", event.target.value)} />
                </div>

                <div className="users-field">
                  <label>{t("filter.sortBy")}</label>
                  <select className="users-select" value={filters.sortBy} onChange={(event) => updateFilter("sortBy", event.target.value)}>
                    <option value="relevance">{t("common.relevance")}</option>
                    <option value="name">{t("common.name")}</option>
                    <option value="username">{t("form.username")}</option>
                    <option value="role">{t("common.role")}</option>
                    <option value="joined">{t("common.joinDate")}</option>
                  </select>
                </div>

                <div className="users-field">
                  <label>{t("filter.sortDir")}</label>
                  <select className="users-select" value={filters.sortDir} onChange={(event) => updateFilter("sortDir", event.target.value)}>
                    <option value="asc">{t("common.ascending")}</option>
                    <option value="desc">{t("common.descending")}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="users-modal-footer">
              <ActionButton icon={X} onClick={resetSearch} variant="secondary">
                {t("common.clear")}
              </ActionButton>
              <ActionButton icon={Check} onClick={() => setFiltersOpen(false)}>
                {t("common.done")}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div
          className="users-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target.classList.contains("users-modal-backdrop")) setShowModal(false);
          }}
        >
          <form className="users-modal" onSubmit={saveUser}>
            <div className="users-modal-header">
              <h2 className="users-modal-title">{form.id ? t("page.users.editUser") : t("common.addUser")}</h2>
              <IconButton icon={X} label={t("common.close")} onClick={() => setShowModal(false)} disabled={saving} variant="neutral" />
            </div>

            <div className="users-modal-body">
              <div className="user-photo-picker">
                <div className="user-photo-preview">
                  {form.profilePhotoUrl ? (
                    <img className="user-avatar-img" src={resolveMediaUrl(form.profilePhotoUrl)} alt="" />
                  ) : (
                    initialsOf(form.displayName || form.username)
                  )}
                </div>
                <div className="user-photo-actions">
                  <div className="users-section-label" style={{ margin: 0 }}>{t("page.users.userPhoto")}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <label className="users-button users-button-soft" style={{ cursor: photoUploading ? "wait" : "pointer" }}>
                      <Camera size={15} />
                      {photoUploading ? t("page.users.uploading") : t("page.users.uploadPhoto")}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={photoUploading || saving}
                        onChange={(event) => uploadProfilePhoto(event.target.files?.[0])}
                        style={{ display: "none" }}
                      />
                    </label>
                    {form.profilePhotoUrl && (
                      <button type="button" className="users-button users-button-ghost" onClick={() => setField("profilePhotoUrl", "")} disabled={photoUploading || saving}>
                        {t("page.users.remove")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="users-form-grid">
                <div className="users-field">
                  <label>{t("form.displayName")}</label>
                  <input className="users-input" value={form.displayName} onChange={(event) => setField("displayName", event.target.value)} />
                </div>

                <div className="users-field">
                  <label>{t("form.username")}</label>
                  <input className="users-input" value={form.username} onChange={(event) => setField("username", event.target.value)} />
                </div>

                <div className="users-field">
                  <label>{t("form.password")}</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 48px", gap: 10 }}>
                    <input
                      className="users-input"
                      value={form.password}
                      onChange={(event) => setField("password", event.target.value)}
                      placeholder={form.id ? t("form.keepCurrentPassword") : t("form.passwordRequired")}
                    />
                    <IconButton
                      icon={KeyRound}
                      label="Generate password"
                      onClick={async () => {
                        try {
                          const resp = await api.get("/auth/generate-password");
                          const generated = resp?.data?.password;
                          if (!generated) throw new Error("No password returned.");
                          setField("password", generated);
                        } catch (err) {
                          setModalMessage(err?.message || "Could not generate a password.");
                          setModalSuccess(false);
                        }
                      }}
                      variant="soft"
                    />
                  </div>
                </div>

                <div className="users-field">
                  <label>{t("form.role")}</label>
                  <select className="users-select" value={form.role} onChange={(event) => setField("role", event.target.value)}>
                    {roles.length > 0 ? (
                      roles.map((role) => (
                        <option key={role.id ?? role.Id ?? role.name} value={String(role.id ?? role.Id)}>
                          {role.name ?? role.Name}
                        </option>
                      ))
                    ) : (
                      <option value="">{t("common.noData")}</option>
                    )}
                  </select>
                </div>
                {form.id && (
                  <div className="users-field">
                    <label>{t("form.primaryPosition")}</label>
                    <input className="users-input" value={form.primaryPosition || t("form.notAssigned")} readOnly />
                  </div>
                )}

                <div className="users-field">
                  <label>{t("form.email")}</label>
                  <input className="users-input" value={form.email} onChange={(event) => setField("email", event.target.value)} />
                </div>

                <div className="users-field">
                  <label>{t("form.phone")}</label>
                  <input
                    className="users-input"
                    value={form.phone}
                    placeholder="+911234567890"
                    onChange={(event) => {
                      if (phoneAllowTypingRegex.test(event.target.value)) setField("phone", event.target.value);
                    }}
                  />
                </div>

                <div className="users-field">
                  <label>{t("form.joinDate")}</label>
                  <input
                    className="users-input"
                    type="datetime-local"
                    value={isoToDatetimeLocal(form.joinDate)}
                    onChange={(event) => setField("joinDate", datetimeLocalToIso(event.target.value))}
                  />
                </div>

                {form.id && (
                  <div className="users-field">
                    <label>{t("form.mahimaId")}</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 48px", gap: 10 }}>
                      <input className="users-input" value={form.UserCode || ""} readOnly />
                      <IconButton
                        icon={Copy}
                        label={t("page.users.copyId")}
                        onClick={() => navigator.clipboard?.writeText(String(form.UserCode || ""))}
                        variant="soft"
                      />
                    </div>
                  </div>
                )}
                </div>
              <div className="users-section">
                <div className="users-section-label">{t("page.users.profileDetails")}</div>

                <div className="users-form-grid">
                  <div className="users-field">
                    <label>{t("form.birthday")}</label>
                    <input
                      className="users-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="YYYY-MM-DD"
                      value={form.birthday}
                      onChange={(event) => setField("birthday", event.target.value)}
                    />
                  </div>

                  <div className="users-field">
                    <label>{t("form.maritalStatus")}</label>
                    <select className="users-select" value={form.maritalStatus} onChange={(event) => setField("maritalStatus", event.target.value)}>
                      <option value="">{t("common.select")}</option>
                      <option value="Single">{t("filter.single")}</option>
                      <option value="Married">{t("filter.married")}</option>
                      <option value="Divorced">{t("filter.divorced")}</option>
                      <option value="Widowed">{t("filter.widowed")}</option>
                    </select>
                  </div>

                  <div className="users-field">
                    <label>{t("form.sex")}</label>
                    <select className="users-select" value={form.sex} onChange={(event) => setField("sex", event.target.value)}>
                      <option value="">{t("common.select")}</option>
                      <option value="Male">{t("filter.male")}</option>
                      <option value="Female">{t("filter.female")}</option>
                    </select>
                  </div>

                  <div className="users-field">
                    <label>{t("form.age")}</label>
                    <input className="users-input" type="number" min="0" value={form.age} readOnly title="Automatically calculated from birthday" />
                  </div>

                  <div className="users-field">
                    <label>{t("form.aadharNumber")}</label>
                    <input className="users-input" value={form.aadharNumber} maxLength={12} onChange={(event) => setField("aadharNumber", event.target.value)} />
                  </div>

                  <div className="users-field">
                    <label>{t("form.emergencyPhone")}</label>
                    <input className="users-input" value={form.emergencyContactPhone} onChange={(event) => setField("emergencyContactPhone", event.target.value)} />
                  </div>

                  <div className="users-field">
                    <label>{t("form.baptismDate")}</label>
                    <input className="users-input" type="date" value={form.baptismDate} onChange={(event) => setField("baptismDate", event.target.value)} />
                  </div>

                  <div className="users-field">
                    <label>{t("form.baptismPlace")}</label>
                    <input className="users-input" value={form.baptismPlace} onChange={(event) => setField("baptismPlace", event.target.value)} />
                  </div>

                  <div className="users-field users-field-full">
                    <label>{t("form.homeAddress")}</label>
                    <textarea className="users-textarea" value={form.homeAddress} onChange={(event) => setField("homeAddress", event.target.value)} />
                  </div>

                  <div className="users-field users-field-full">
                    <label>{t("form.currentAddress")}</label>
                    <textarea className="users-textarea" value={form.currentAddress} onChange={(event) => setField("currentAddress", event.target.value)} />
                  </div>
                </div>

                <div className="users-check-grid">
                  {[
                    ["isBaptized", t("form.isBaptized")],
                    ["isBornAgain", t("form.isBornAgain")],
                    ["isBeliever", t("form.isBeliever")],
                    ["isPastor", t("form.isPastor")],
                    ["payrollEnabled", t("form.payrollEnabled")],
                  ].map(([key, label]) => (
                    <label className="users-check" key={key}>
                      <input type="checkbox" checked={Boolean(form[key])} onChange={(event) => setField(key, event.target.checked)} />
                      {label}
                    </label>
                  ))}
                </div>

                {form.payrollEnabled && (
                  <div className="users-field users-field-full" style={{ marginTop: 12 }}>
                    <label>{t("form.appointmentLetter") || "Appointment Letter"}</label>
                    {!form.id ? (
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
                        Save the user first to generate an appointment letter.
                      </p>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <ActionButton icon={FileText} onClick={openLetterModal} loading={generatingLetter} variant="secondary">
                          {form.appointmentLetterUrl ? "Regenerate Letter" : "Generate Appointment Letter"}
                        </ActionButton>
                        {form.appointmentLetterUrl && (
                          <ActionButton icon={Download} onClick={downloadAppointmentLetter} loading={downloadingLetter} variant="secondary">
                            Download
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {modalMessage && (
                <div
                  className="users-alert"
                  style={{
                    marginTop: 12,
                    background: modalSuccess ? "rgba(34,197,94,0.12)" : "#fff3f3",
                    color: modalSuccess ? "#166534" : "#9b1c1c",
                    borderColor: modalSuccess ? "rgba(34,197,94,0.25)" : "#ffd1d1",
                  }}
                >
                  {modalSuccess ? <Check size={18} /> : <AlertCircle size={18} />}
                  <span>{modalMessage}</span>
                </div>
              )}
            </div>

            <div className="users-modal-footer">
              {form.id ? (
                <ActionButton icon={KeyRound} onClick={resetPasswordForFormUser} loading={resetting} variant="secondary">
                  {t("common.reset")}
                </ActionButton>
              ) : (
                <ActionButton icon={X} onClick={() => setShowModal(false)} disabled={saving} variant="secondary">
                  {t("common.cancel")}
                </ActionButton>
              )}

              <ActionButton icon={Save} type="submit" loading={saving}>
                {t("common.save")}
              </ActionButton>
            </div>
          </form>
        </div>
      )}

      {letterModalOpen && (
        <div
          className="users-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target.classList.contains("users-modal-backdrop")) setLetterModalOpen(false);
          }}
        >
          <div className="users-modal" style={{ maxWidth: 480 }}>
            <form onSubmit={generateAppointmentLetter}>
              <div className="users-modal-header">
                <h2 className="users-modal-title">Generate Appointment Letter</h2>
                <IconButton icon={X} label={t("common.close")} onClick={() => setLetterModalOpen(false)} variant="neutral" />
              </div>

              <div className="users-modal-body">
                <div className="users-field users-field-full">
                  <label>Role / Designation</label>
                  <input
                    type="text"
                    value={
                      roles.find((role) => String(role.id ?? role.Id) === String(form.role))?.name ??
                      roles.find((role) => String(role.id ?? role.Id) === String(form.role))?.Name ??
                      "Not set"
                    }
                    disabled
                  />
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                    Taken from this user's Role in the form above. Change the Role there if it's wrong.
                  </p>
                </div>
                <div className="users-field users-field-full">
                  <label>Department</label>
                  <input
                    type="text"
                    value={letterForm.department}
                    onChange={(event) => setLetterForm((prev) => ({ ...prev, department: event.target.value }))}
                  />
                </div>
                <div className="users-field users-field-full">
                  <label>Reporting Manager</label>
                  <select
                    value={letterForm.reportingManagerUserId}
                    onChange={(event) => setLetterForm((prev) => ({ ...prev, reportingManagerUserId: event.target.value }))}
                    disabled={loadingCandidates || reportingCandidates.length === 0}
                  >
                    <option value="">
                      {loadingCandidates
                        ? "Loading..."
                        : reportingCandidatesReason === "top_level"
                        ? "None (top-level position)"
                        : reportingCandidatesReason === "no_position"
                        ? "None (no position assigned to this user)"
                        : reportingCandidatesReason === "no_holder"
                        ? "None (parent position has no one assigned)"
                        : "Select a reporting manager"}
                    </option>
                    {reportingCandidates.map((candidate) => (
                      <option key={candidate.userId} value={candidate.userId}>
                        {candidate.displayName} ({candidate.positionName})
                      </option>
                    ))}
                  </select>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                    Based on the Positions hierarchy: whoever holds the position above this user's.
                  </p>
                </div>
                <div className="users-field users-field-full">
                  <label>Salary Type</label>
                  <select
                    value={letterForm.salaryType}
                    onChange={(event) => setLetterForm((prev) => ({ ...prev, salaryType: event.target.value }))}
                  >
                    <option value="Daily">Daily</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                  </select>
                </div>
                <div className="users-field users-field-full">
                  <label>Appointment Date</label>
                  <input
                    type="date"
                    value={letterForm.appointmentDate}
                    onChange={(event) => setLetterForm((prev) => ({ ...prev, appointmentDate: event.target.value }))}
                  />
                </div>
                <div className="users-field users-field-full">
                  <label>Additional Terms (optional)</label>
                  <textarea
                    className="users-textarea"
                    value={letterForm.additionalTerms}
                    onChange={(event) => setLetterForm((prev) => ({ ...prev, additionalTerms: event.target.value }))}
                  />
                </div>
              </div>

              <div className="users-modal-footer">
                <ActionButton icon={X} onClick={() => setLetterModalOpen(false)} disabled={generatingLetter} variant="secondary">
                  {t("common.cancel")}
                </ActionButton>
                <ActionButton icon={FileText} type="submit" loading={generatingLetter}>
                  Generate
                </ActionButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {broadcastOpen && (
        <div
          className="users-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target.classList.contains("users-modal-backdrop")) setBroadcastOpen(false);
          }}
        >
          <div className="users-modal">
            <div className="users-modal-header">
              <h2 className="users-modal-title">{broadcastType}</h2>
              <IconButton icon={X} label={t("common.close")} onClick={() => setBroadcastOpen(false)} disabled={sending} variant="neutral" />
            </div>

            <div className="users-modal-body">
              <div className="users-section-label">{t("page.users.message")}</div>
              <textarea
                className="users-textarea"
                value={broadcastMessage}
                onChange={(event) => setBroadcastMessage(event.target.value)}
                placeholder={`Enter ${broadcastType} message...`}
              />

              <div className="users-section">
                <div className="users-section-label">{t("page.users.channels")}</div>
                <div className="channel-grid">
                  {[
                    ["email", "Email", Mail],
                    ["whatsapp", "WhatsApp", MessageCircle],
                    ["sms", "SMS", Smartphone],
                  ].map(([key, label, Icon]) => (
                    <label className="users-check" key={key}>
                      <input
                        type="checkbox"
                        checked={Boolean(broadcastChannels[key])}
                        onChange={(event) =>
                          setBroadcastChannels((prev) => ({
                            ...prev,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      <Icon size={16} />
                      {label}
                    </label>
                  ))}
                </div>
                {broadcastChannels.whatsapp && (
                  <div style={{ marginTop: 12 }}>
                    <div className="users-section-label">Approved WhatsApp template SID (optional override)</div>
                    <input
                      className="users-input"
                      value={whatsAppContentSid}
                      onChange={(event) => setWhatsAppContentSid(event.target.value)}
                      placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                    <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
                      Required for proactive WhatsApp messages outside the 24-hour customer service window. Template variables 1 and 2 are filled with the recipient name and this message.
                    </div>
                  </div>
                )}
              </div>

              <div className="users-section">
                <div className="users-section-label">{t("page.users.recipients")}: {selectedIds.size} selected</div>

                <div className="users-search-wrap">
                  <Search size={18} />
                  <input
                    className="users-input users-search-input"
                    value={modalSearch}
                    onChange={(event) => setModalSearch(event.target.value)}
                    placeholder={t("page.users.filterRecipients")}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <ActionButton icon={Users} onClick={selectAllRecipients} variant="secondary">
                    {t("page.users.selectAll")}
                  </ActionButton>
                  <ActionButton icon={X} onClick={clearSelection} variant="secondary">
                    {t("common.clear")}
                  </ActionButton>
                </div>

                <div className="recipient-list">
                  {filteredRecipients === null ? (
                    <div className="users-empty">{t("page.users.loadingRecipients")}</div>
                  ) : filteredRecipients.length === 0 ? (
                    <div className="users-empty">{t("page.users.noRecipientsFound")}</div>
                  ) : (
                    filteredRecipients.map((user) => {
                      const id = userIdOf(user);
                      const name = displayNameOf(user);

                      return (
                        <label className="recipient-row" key={id}>
                          <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelect(id)} />
                          <div style={{ minWidth: 0 }}>
                            <div className="user-name">{name}</div>
                            <div className="user-meta">{emailOf(user) || phoneOf(user) || usernameOf(user) || "No contact"}</div>
                          </div>
                          <span className="user-badge">{roleLabelOf(user, roles).toUpperCase()}</span>
                        </label>
                      );
                    })
                  )}
                </div>

                {sendResults && (
                  <div
                    className="users-alert"
                    style={{
                      background: sendResults.success ? "rgba(34,197,94,0.12)" : "#fff3f3",
                      color: sendResults.success ? "#166534" : "#9b1c1c",
                      borderColor: sendResults.success ? "rgba(34,197,94,0.25)" : "#ffd1d1",
                    }}
                  >
                    {sendResults.success ? <Check size={18} /> : <AlertCircle size={18} />}
                    <span>
                      {sendResults.success
                        ? `Twilio accepted the message${sendResults.successful ? ` for ${sendResults.successful} recipient${sendResults.successful === 1 ? "" : "s"}` : ""}.`
                        : sendResults.error || `${sendResults.failed ?? sendResults.attempted ?? 0} recipient message${(sendResults.failed ?? sendResults.attempted) === 1 ? "" : "s"} failed.`}
                    </span>
                  </div>
                )}
                {Array.isArray(sendResults?.results) && sendResults.results.map((result) => (
                  <div
                    key={result.id || result.phone || result.email}
                    className="users-alert"
                    style={{
                      marginTop: 8,
                      background: result.success ? "rgba(34,197,94,0.08)" : "#fff3f3",
                      color: result.success ? "#166534" : "#9b1c1c",
                      borderColor: result.success ? "rgba(34,197,94,0.2)" : "#ffd1d1",
                    }}
                  >
                    {result.success ? <Check size={18} /> : <AlertCircle size={18} />}
                    <span>
                      {result.displayName || result.phone || result.email || "Recipient"}: {result.success
                        ? `accepted${result.whatsAppMessageSid ? ` (Twilio SID: ${result.whatsAppMessageSid})` : ""}`
                        : (result.errors || []).join(" ") || "Send failed without an error message."}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="users-modal-footer">
              <ActionButton icon={X} onClick={() => setBroadcastOpen(false)} disabled={sending} variant="secondary">
                {t("common.cancel")}
              </ActionButton>
              <ActionButton icon={Bell} onClick={sendBroadcast} loading={sending}>
                {t("common.send")}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
