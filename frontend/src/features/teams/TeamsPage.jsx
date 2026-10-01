import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "../../utils/fetch-auth-shim";
import { useNavigate, Outlet, useMatch } from "react-router-dom";

const emptyForm = { name: "", description: "" };

const getPayload = (res) => res?.data ?? res;

const getArray = (value) => {
  const data = getPayload(value);
  const arr = Array.isArray(data)
    ? data
    : data?.items ?? data?.Items ?? data?.teams ?? data?.Teams ?? data?.data ?? data?.Data ?? [];

  return Array.isArray(arr) ? arr : [];
};

const getTeamId = (team) => team?.id ?? team?.Id;
const getTeamName = (team) => team?.name ?? team?.Name ?? "";
const getTeamDescription = (team) => team?.description ?? team?.Description ?? "";

const getInlineMemberCount = (team) => {
  const value =
    team?.memberCount ??
    team?.MemberCount ??
    team?.membersCount ??
    team?.MembersCount ??
    team?.totalMembers ??
    team?.TotalMembers ??
    team?.totalMemberCount ??
    team?.TotalMemberCount ??
    team?.members?.length ??
    team?.Members?.length;

  return typeof value === "number" ? value : null;
};

const getInitials = (name) => {
  if (!name) return "T";

  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

function IconButton({
  icon: Icon,
  label,
  onClick,
  type = "button",
  disabled = false,
  loading = false,
  variant = "neutral",
  size = "md",
}) {
  return (
    <button
      type={type}
      className={`team-icon-btn team-icon-btn-${variant} team-icon-btn-${size}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <Loader2 className="team-spin" size={18} /> : <Icon size={18} />}
      <span className="team-tooltip">{label}</span>
    </button>
  );
}

function ActionButton({
  icon: Icon,
  children,
  type = "button",
  onClick,
  disabled = false,
  loading = false,
  variant = "primary",
}) {
  return (
    <button
      type={type}
      className={`team-action-btn team-action-btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <Loader2 className="team-spin" size={18} /> : <Icon size={18} />}
      <span>{children}</span>
    </button>
  );
}

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [countsLoading, setCountsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const [isOpen, setIsOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [form, setForm] = useState(emptyForm);

  // Group chat creation state: { [teamId]: "creating" | "done" | "error" }
  const [chatStatus, setChatStatus] = useState({});

  const navigate = useNavigate();
  const isMembersPage = useMatch("/home/teams/:teamId/members");

  const isEditing = Boolean(editingTeam);
  const editingId = editingTeam ? getTeamId(editingTeam) : null;

  const fetchMemberCounts = useCallback(async (teamList) => {
    const teamsNeedingCounts = teamList.filter((team) => {
      const id = getTeamId(team);
      return id && getInlineMemberCount(team) === null;
    });

    const inlineCounts = {};
    teamList.forEach((team) => {
      const id = getTeamId(team);
      const count = getInlineMemberCount(team);
      if (id && count !== null) inlineCounts[id] = count;
    });

    setMemberCounts((prev) => ({ ...prev, ...inlineCounts }));

    if (teamsNeedingCounts.length === 0) return;

    setCountsLoading(true);

    try {
      const results = await Promise.allSettled(
        teamsNeedingCounts.map(async (team) => {
          const id = getTeamId(team);
          const res = await apiFetch(`/teams/${encodeURIComponent(id)}/members`);
          const members = getArray(res);
          return { id, count: members.length };
        })
      );

      const nextCounts = {};
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          nextCounts[result.value.id] = result.value.count;
        }
      });

      setMemberCounts((prev) => ({ ...prev, ...nextCounts }));
    } catch (err) {
      console.warn("Unable to load member counts", err);
    } finally {
      setCountsLoading(false);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch("/teams");
      const list = getArray(res);

      setTeams(list);
      fetchMemberCounts(list);
    } catch (err) {
      console.error(err);
      setTeams([]);
      setError("Unable to load teams. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [fetchMemberCounts]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const openMembers = (team) => {
    const id = getTeamId(team);
    if (id) navigate(`/home/teams/${id}/members`);
  };

  const openCreateModal = () => {
    setEditingTeam(null);
    setForm(emptyForm);
    setError("");
    setIsOpen(true);
  };

  const openEditModal = (team) => {
    setEditingTeam(team);
    setForm({
      name: getTeamName(team),
      description: getTeamDescription(team),
    });
    setError("");
    setIsOpen(true);
  };

  const closeModal = () => {
    if (saving) return;

    setIsOpen(false);
    setEditingTeam(null);
    setForm(emptyForm);
  };

  const deleteTeam = async (id) => {
    if (!id || !window.confirm("Delete this team?")) return;

    setDeletingId(id);
    setError("");

    try {
      await apiFetch(`/teams/${encodeURIComponent(id)}`, { method: "DELETE" });

      setTeams((prev) => prev.filter((team) => getTeamId(team) !== id));
      setMemberCounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error(err);
      setError("Unable to delete team. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const save = async (e) => {
    e.preventDefault();

    const name = form.name.trim();
    const description = form.description.trim();

    if (!name) {
      setError("Team name is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = { name, description };

      if (isEditing) {
        await apiFetch(`/teams/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });

        setTeams((prev) =>
          prev.map((team) =>
            getTeamId(team) === editingId
              ? {
                  ...team,
                  name,
                  Name: team.Name !== undefined ? name : team.Name,
                  description,
                  Description: team.Description !== undefined ? description : team.Description,
                }
              : team
          )
        );
      } else {
        await apiFetch("/teams", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        await fetchTeams();
      }

      closeModal();
    } catch (err) {
      console.error(err);
      setError(isEditing ? "Unable to update team." : "Unable to create team.");
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-create Jai Masih group chat for a team ──────────────────────────
  const createTeamGroupChat = useCallback(async (team) => {
    const id = getTeamId(team);
    const name = getTeamName(team);
    if (!id) return;

    setChatStatus((prev) => ({ ...prev, [id]: "creating" }));
    try {
      // 1. Fetch all team members
      const membersRes = await apiFetch(`/teams/${encodeURIComponent(id)}/members`);
      const members = getArray(membersRes);

      const memberIds = members
        .map((m) => {
          const user = m?.user ?? m?.User ?? m;
          return (
            user?.id ?? user?.userId ?? user?.Id ?? user?.UserId ??
            m?.userId ?? m?.UserId ?? m?.id ?? m?.Id ?? null
          );
        })
        .filter(Boolean)
        .map(String);

      if (memberIds.length === 0) {
        setChatStatus((prev) => ({ ...prev, [id]: "error" }));
        alert(`No members found in "${name}". Add members first.`);
        return;
      }

      // 2. Create the group chat
      const chatRes = await apiFetch("/chats", {
        method: "POST",
        body: JSON.stringify({ isGroup: true, name, memberIds }),
      });
      const chat = chatRes?.id ?? chatRes?.Id ? chatRes : chatRes?.data ?? chatRes;
      const chatId = chat?.id ?? chat?.Id;

      if (!chatId) throw new Error("Chat created but no ID returned");

      // 3. Send welcome message
      const welcome = `🙏 Jai Masih Ji! Welcome to the *${name}* group chat. This is your dedicated space to coordinate, share updates, and pray together. God bless! ✝️`;
      await apiFetch(`/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: welcome }),
      }).catch(() => {}); // non-fatal if message fails

      setChatStatus((prev) => ({ ...prev, [id]: "done" }));
    } catch (err) {
      console.error("[TeamsPage] createTeamGroupChat failed", err);
      setChatStatus((prev) => ({ ...prev, [id]: "error" }));
      alert(`Failed to create group chat for "${name}": ${err?.message || "Unknown error"}`);
    }
  }, []);

  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return teams;

    return teams.filter((team) => {
      const name = getTeamName(team).toLowerCase();
      const description = getTeamDescription(team).toLowerCase();
      return name.includes(query) || description.includes(query);
    });
  }, [teams, search]);

  if (isMembersPage) {
    return (
      <div className="teams-page">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="teams-page">
      <style>{`
        .teams-page {
          min-height: 100vh;
          padding: 14px;
          background: #f9f6ef;
          color: #332817;
        }

        .teams-header {
          display: grid;
          gap: 16px;
          margin-bottom: 18px;
        }

        .teams-title {
          margin: 0;
          color: #6b4f1d;
          font-size: clamp(28px, 9vw, 38px);
          line-height: 1.05;
          font-weight: 900;
        }

        .teams-subtitle {
          margin-top: 8px;
          color: #8a7a5c;
          font-size: 14px;
          line-height: 1.45;
        }

        .teams-toolbar {
          display: grid;
          grid-template-columns: 1fr 48px 48px;
          gap: 10px;
          width: 100%;
          align-items: center;
        }

        .teams-search-wrap {
          position: relative;
          min-width: 0;
        }

        .teams-search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #8a7a5c;
          pointer-events: none;
        }

        .teams-input {
          width: 100%;
          height: 46px;
          border: 1px solid #ddd2bd;
          border-radius: 14px;
          background: #fff;
          color: #332817;
          padding: 0 12px;
          font-size: 16px;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .teams-search-input {
          padding-left: 40px;
        }

        .teams-input:focus {
          outline: none;
          border-color: #b89b58;
          box-shadow: 0 0 0 4px rgba(184, 155, 88, 0.18);
        }

        .teams-alert {
          margin-bottom: 14px;
          padding: 12px;
          border-radius: 12px;
          background: #fff3f3;
          color: #9b1c1c;
          border: 1px solid #ffd1d1;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          line-height: 1.4;
        }

        .teams-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .team-card {
          background: #fff;
          border: 1px solid #eee2cf;
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 8px 24px rgba(80, 60, 28, 0.08);
          display: grid;
          gap: 14px;
          transition: transform 160ms ease, box-shadow 160ms ease;
        }

        .team-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 28px rgba(80, 60, 28, 0.12);
        }

        .team-card-top {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .team-avatar {
          width: 50px;
          height: 50px;
          border-radius: 14px;
          background: linear-gradient(135deg, #efe4ca, #d7be83);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          color: #6b4f1d;
          flex-shrink: 0;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }

        .team-card-body {
          min-width: 0;
        }

        .team-card-name {
          color: #332817;
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .team-card-desc {
          margin-top: 4px;
          color: #777;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 70vw;
        }

        .team-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }

        .team-badge {
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

        .team-card-actions {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
        }

        .teams-empty {
          color: #76664b;
          background: #fff;
          border: 1px dashed #d8c9ad;
          border-radius: 12px;
          padding: 18px;
          line-height: 1.45;
        }

        .team-icon-btn,
        .team-action-btn {
          font-family: inherit;
          cursor: pointer;
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, color 160ms ease;
          -webkit-tap-highlight-color: transparent;
        }

        .team-icon-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-radius: 14px;
          width: 100%;
          min-width: 0;
        }

        .team-icon-btn-md {
          height: 48px;
        }

        .team-icon-btn-sm {
          width: 40px;
          height: 40px;
        }

        .team-icon-btn-neutral {
          background: #fff;
          color: #6b4f1d;
          border-color: #e6dcc8;
        }

        .team-icon-btn-soft {
          background: #f8f2e6;
          color: #6b4f1d;
          border-color: #eadfca;
        }

        .team-icon-btn-primary {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .team-icon-btn-danger {
          background: #fff5f5;
          color: #a83232;
          border-color: #f3c3c3;
        }

        .team-icon-btn-chat {
          background: #f0fdf4;
          color: #166534;
          border-color: #bbf7d0;
        }

        .team-icon-btn-chat-done {
          background: #d1fae5;
          color: #065f46;
          border-color: #6ee7b7;
        }

        .team-icon-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(80, 60, 28, 0.14);
        }

        .team-icon-btn-neutral:hover:not(:disabled),
        .team-icon-btn-soft:hover:not(:disabled) {
          background: #efe4ca;
        }

        .team-icon-btn-primary:hover:not(:disabled) {
          background: #5a4217;
        }

        .team-icon-btn-danger:hover:not(:disabled) {
          background: #a83232;
          color: #fff;
          border-color: #a83232;
        }

        .team-icon-btn-chat:hover:not(:disabled) {
          background: #dcfce7;
        }

        .team-icon-btn-chat-done:hover:not(:disabled) {
          background: #a7f3d0;
        }

        .team-icon-btn:disabled,
        .team-action-btn:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        .team-icon-btn:focus-visible,
        .team-action-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(184, 155, 88, 0.25);
        }

        .team-tooltip {
          display: none;
        }

        .team-action-btn {
          width: 100%;
          min-height: 46px;
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

        .team-action-btn-primary {
          background: #6b4f1d;
          color: #fff;
          border-color: #6b4f1d;
        }

        .team-action-btn-primary:hover:not(:disabled) {
          background: #5a4217;
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(80, 60, 28, 0.14);
        }

        .team-action-btn-secondary {
          background: #fff;
          color: #6b4f1d;
          border-color: #e1d6c0;
        }

        .team-action-btn-secondary:hover:not(:disabled) {
          background: #efe4ca;
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(80, 60, 28, 0.12);
        }

        .teams-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(38, 30, 18, 0.48);
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .teams-modal {
          width: 100%;
          max-height: 92vh;
          overflow: hidden;
          background: #fff;
          border: 1px solid #efe2cb;
          border-radius: 18px 18px 0 0;
          box-shadow: 0 -18px 60px rgba(0, 0, 0, 0.22);
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          padding-bottom: max(14px, env(safe-area-inset-bottom));
        }

        .teams-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .teams-modal-title {
          margin: 0;
          color: #332817;
          font-size: 20px;
          font-weight: 900;
        }

        .teams-modal-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 4px;
        }

        .team-spin {
          animation: team-spin 0.8s linear infinite;
        }

        @keyframes team-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (min-width: 640px) {
          .teams-page {
            padding: 24px;
          }

          .teams-header {
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 20px;
            margin-bottom: 24px;
          }

          .teams-toolbar {
            display: flex;
            width: auto;
          }

          .teams-search-input {
            width: 260px;
          }

          .team-icon-btn {
            width: 42px;
          }

          .team-icon-btn-md {
            height: 42px;
          }

          .teams-grid {
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 20px;
          }

          .team-card {
            padding: 18px;
          }

          .team-card-desc {
            max-width: 100%;
          }

          .teams-modal-backdrop {
            align-items: center;
            padding: 16px;
          }

          .teams-modal {
            width: min(380px, 100%);
            border-radius: 16px;
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
            padding: 22px;
          }

          .team-action-btn {
            width: auto;
          }

          .team-tooltip {
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

          .team-icon-btn:hover .team-tooltip {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .teams-page {
          background:
            linear-gradient(180deg, rgba(255,255,255,.96), rgba(246,248,251,.96)),
            radial-gradient(circle at 100% 0%, rgba(4,120,87,.08), transparent 28rem) !important;
          color: var(--enterprise-ink, #102033) !important;
        }
        .teams-header:not(.mahima-standard-page-header),
        .team-card,
        .teams-modal,
        .teams-search-wrap {
          border-color: var(--enterprise-border, #dfe7ef) !important;
          border-radius: var(--enterprise-radius-lg, 12px) !important;
          background: var(--enterprise-surface, #ffffff) !important;
          box-shadow: var(--enterprise-shadow-sm, 0 1px 2px rgba(15,23,42,.05)) !important;
        }
        .teams-title:not(.mahima-standard-page-title),
        .team-card-title,
        .teams-modal-title {
          color: var(--enterprise-ink, #102033) !important;
        }
        .teams-subtitle:not(.mahima-standard-page-subtitle),
        .team-card-desc,
        .team-meta {
          color: var(--enterprise-muted, #617086) !important;
        }
        .teams-input,
        .teams-select,
        .teams-textarea {
          border-color: var(--enterprise-border, #dfe7ef) !important;
          border-radius: var(--enterprise-radius, 10px) !important;
          background: #ffffff !important;
          color: var(--enterprise-ink, #102033) !important;
        }
        .team-icon-btn-primary,
        .team-action-btn-primary {
          border-color: transparent !important;
          background: linear-gradient(180deg, var(--enterprise-primary, #047857), var(--enterprise-primary-strong, #065f46)) !important;
          color: #ffffff !important;
          box-shadow: 0 8px 20px rgba(4,120,87,.18) !important;
        }
        .team-icon-btn-soft,
        .team-action-btn-secondary,
        .team-icon-btn {
          border-color: var(--enterprise-border, #dfe7ef) !important;
          background: #ffffff !important;
          color: var(--enterprise-ink, #102033) !important;
        }
        .team-badge,
        .team-member-count {
          border-color: rgba(4,120,87,.22) !important;
          background: var(--enterprise-primary-soft, #ecfdf5) !important;
          color: var(--enterprise-primary-strong, #065f46) !important;
        }
        #mahima-teams-page-header.teams-header.mahima-standard-page-header {
          padding: clamp(22px, 2.3vw, 32px) !important;
          border: 1px solid rgba(255,255,255,.14) !important;
          border-radius: 22px !important;
          background:
            radial-gradient(circle at 87% -18%, rgba(255,255,255,.2), transparent 19rem),
            linear-gradient(118deg, #07815f 0%, #087456 56%, #12654f 100%) !important;
          color: #ffffff !important;
          box-shadow: 0 18px 42px rgba(5,96,68,.18) !important;
        }
        #mahima-teams-page-header.teams-header.mahima-standard-page-header .teams-title {
          color: #ffffff !important;
        }
        #mahima-teams-page-header.teams-header.mahima-standard-page-header .teams-subtitle {
          color: rgba(242,252,248,.9) !important;
        }
        #mahima-teams-page-header.teams-header.mahima-standard-page-header .team-icon-btn {
          border-color: rgba(255,255,255,.3) !important;
          background: rgba(255,255,255,.15) !important;
          color: #ffffff !important;
          box-shadow: none !important;
        }
        #mahima-teams-page-header.teams-header.mahima-standard-page-header .teams-search-wrap {
          background: transparent !important;
          box-shadow: none !important;
        }
      `}</style>

      <div id="mahima-teams-page-header" className="teams-header mahima-standard-page-header" data-mahima-explicit-header="true">
        <div>
          <h1 className="teams-title mahima-standard-page-title" data-mahima-explicit-title="true">Teams</h1>
          <div className="teams-subtitle mahima-standard-page-subtitle">Manage ministry teams and their members.</div>
        </div>

        <div className="teams-toolbar">
          <div className="teams-search-wrap">
            <Search className="teams-search-icon" size={18} />
            <input
              className="teams-input teams-search-input"
              placeholder="Search teams..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <IconButton
            icon={RefreshCw}
            label="Refresh teams"
            onClick={fetchTeams}
            loading={loading}
            variant="soft"
          />

          <IconButton
            icon={Plus}
            label="Create team"
            onClick={openCreateModal}
            variant="primary"
          />
        </div>
      </div>

      {error && (
        <div className="teams-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="teams-grid">
        {loading ? (
          <div className="teams-empty">Loading teams...</div>
        ) : filteredTeams.length === 0 ? (
          <div className="teams-empty">
            {search ? "No matching teams found." : "No teams created yet."}
          </div>
        ) : (
          filteredTeams.map((team) => {
            const id = getTeamId(team);
            const name = getTeamName(team);
            const description = getTeamDescription(team);
            const isDeleting = deletingId === id;
            const count = memberCounts[id] ?? getInlineMemberCount(team);
            const chatState = chatStatus[id]; // undefined | "creating" | "done" | "error"

            return (
              <article className="team-card" key={id}>
                <div className="team-card-top">
                  <div className="team-avatar">{getInitials(name)}</div>

                  <div className="team-card-body">
                    <div className="team-card-name">{name || "Untitled Team"}</div>
                    <div className="team-card-desc">
                      {description || "No description"}
                    </div>

                    <div className="team-meta">
                      <span className="team-badge">
                        <Users size={14} />
                        {count === null || count === undefined
                          ? countsLoading
                            ? "Checking members"
                            : "Members unknown"
                          : `${count} member${count === 1 ? "" : "s"}`}
                      </span>
                      {chatState === "done" && (
                        <span className="team-badge" style={{ background: "#d1fae5", color: "#065f46", borderColor: "#6ee7b7" }}>
                          <CheckCircle2 size={13} /> Group chat created
                        </span>
                      )}
                      {chatState === "error" && (
                        <span className="team-badge" style={{ background: "#fff5f5", color: "#a83232", borderColor: "#f3c3c3" }}>
                          <AlertCircle size={13} /> Chat creation failed
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="team-card-actions">
                  <IconButton
                    icon={Users}
                    label="Manage members"
                    onClick={() => openMembers(team)}
                    variant="soft"
                  />

                  <IconButton
                    icon={Pencil}
                    label="Edit team"
                    onClick={() => openEditModal(team)}
                    variant="neutral"
                  />

                  <IconButton
                    icon={chatState === "done" ? CheckCircle2 : MessageSquarePlus}
                    label={chatState === "done" ? "Group chat created ✓" : chatState === "creating" ? "Creating chat…" : "Create Jai Masih group chat"}
                    onClick={() => chatState !== "done" && createTeamGroupChat(team)}
                    loading={chatState === "creating"}
                    disabled={chatState === "creating" || chatState === "done"}
                    variant={chatState === "done" ? "chat-done" : "chat"}
                  />

                  <IconButton
                    icon={Trash2}
                    label="Delete team"
                    onClick={() => deleteTeam(id)}
                    loading={isDeleting}
                    disabled={Boolean(deletingId && deletingId !== id)}
                    variant="danger"
                  />
                </div>
              </article>
            );
          })
        )}
      </div>

      {isOpen && (
        <div className="teams-modal-backdrop" role="dialog" aria-modal="true">
          <form className="teams-modal" onSubmit={save}>
            <div className="teams-modal-header">
              <h3 className="teams-modal-title">
                {isEditing ? "Update Team" : "Create Team"}
              </h3>

              <IconButton
                icon={X}
                label="Close"
                onClick={closeModal}
                disabled={saving}
                variant="neutral"
                size="sm"
              />
            </div>

            <input
              className="teams-input"
              placeholder="Team name"
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              autoFocus
            />

            <input
              className="teams-input"
              placeholder="Description"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />

            <div className="teams-modal-actions">
              <ActionButton
                icon={X}
                onClick={closeModal}
                disabled={saving}
                variant="secondary"
              >
                Cancel
              </ActionButton>

              <ActionButton icon={Save} type="submit" loading={saving}>
                {isEditing ? "Update" : "Save"}
              </ActionButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
