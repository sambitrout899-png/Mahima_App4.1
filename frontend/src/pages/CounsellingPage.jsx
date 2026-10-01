import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import api from "../api";
import { createWorkflowStyles } from "./ministryWorkflowStyles";
import { printMinistryToken } from "../utils/printMinistryToken";

const TABS = [
  { key: "all", label: "All", status: "", tone: "#0f172a" },
  { key: "new", label: "New Requests", status: "Requested", tone: "#2563eb" },
  { key: "scheduled", label: "Scheduled", status: "Scheduled", tone: "#c2410c" },
  { key: "completed", label: "Completed", status: "Completed", tone: "#0f766e" },
];

const WORKFLOW_STEPS = [
  { label: "Request", hint: "Need shared safely", tone: "#2563eb" },
  { label: "Schedule", hint: "Session and token", tone: "#c2410c" },
  { label: "Care", hint: "Pastoral meeting", tone: "#7c3aed" },
  { label: "Outcome", hint: "Close or follow up", tone: "#0f766e" },
];

const API_BASE = "/counselling";

const ISSUE_OPTIONS = [
  "Marriage & Family",
  "Healing & Deliverance",
  "Financial",
  "Depression / Anxiety",
  "Spiritual Growth",
  "Other",
];

const OUTCOMES = [
  { value: "Resolved", label: "Resolved / case closed" },
  { value: "NeedsFurtherPrayer", label: "Needs further prayer / lay-hands session" },
  { value: "EscalateToSeniorPastor", label: "Escalate to senior pastor" },
];

const EMPTY_REQUEST = {
  fullName: "",
  email: "",
  phone: "",
  isChurchMember: false,
  memberId: "",
  issueCategory: "",
  description: "",
};

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function arrayFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function statusBadge(status) {
  const map = {
    Requested: { bg: "#dbeafe", color: "#1d4ed8", label: "Requested" },
    Scheduled: { bg: "#ffedd5", color: "#c2410c", label: "Scheduled" },
    Completed: { bg: "#dcfce7", color: "#166534", label: "Completed" },
  };

  return map[status] || { bg: "#f1f5f9", color: "#334155", label: status || "-" };
}

export default function CounsellingPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [scheduleModal, setScheduleModal] = useState({ open: false, session: null });
  const [completeModal, setCompleteModal] = useState({ open: false, session: null });

  const counts = useMemo(() => {
    return {
      visible: sessions.length,
      requested: sessions.filter((x) => x.status === "Requested").length,
      scheduled: sessions.filter((x) => x.status === "Scheduled").length,
      completed: sessions.filter((x) => x.status === "Completed").length,
    };
  }, [sessions]);

  async function loadSessions(tabKey = activeTab) {
    const tab = TABS.find((t) => t.key === tabKey);
    if (!tab) return;

    setLoading(true);
    setError("");

    try {
      const res = await api.get(`${API_BASE}/admin/sessions`, {
        params: { status: tab.status },
      });

      if (!res.ok) throw new Error((await res.text?.()) || res.statusText || "Unable to load counselling sessions");

      setSessions(arrayFrom(res.data));
    } catch (err) {
      console.error(err);
      const msg =
        err?.response?.data?.message ||
        err?.response?.data ||
        err?.message ||
        "Unable to load counselling sessions";

      setError(String(msg));
      toast.error("Unable to load counselling sessions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions(activeTab);
  }, [activeTab]);

  function handleCreated() {
    setCreateModalOpen(false);
    setActiveTab("all");
    loadSessions("all");
  }

  function handleScheduled() {
    setScheduleModal({ open: false, session: null });
    loadSessions(activeTab);
  }

  function handleCompleted() {
    setCompleteModal({ open: false, session: null });
    loadSessions(activeTab);
  }

  async function handleDelete(session) {
    if (!session?.sessionId) return;
    if (!window.confirm("Delete this counselling record permanently?")) return;

    try {
      await api.delete(`${API_BASE}/admin/sessions/${session.sessionId}`);
      toast.success("Counselling record deleted");
      await loadSessions(activeTab);
    } catch (err) {
      console.error(err);
      toast.error("Unable to delete counselling record");
    }
  }

  return (
    <div className="ministry-workflow-page counselling-workflow-page" style={styles.page}>
      <div style={styles.hero}>
        <div>
          <div style={styles.kicker}>Pastoral Care</div>
          <h1 style={styles.title}>Counselling Workflow</h1>
          <p style={styles.subtitle}>
            Track requests, schedule counselling sessions, generate tokens, complete
            cases, and escalate sensitive matters to senior pastoral care.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          style={styles.primaryButton}
        >
          + New Counselling Request
        </button>
      </div>

      <div style={styles.statsGrid}>
        <StatCard label="Visible" value={counts.visible} hint="Current tab records" />
        <StatCard label="Requested" value={counts.requested} hint="Need scheduling" />
        <StatCard label="Scheduled" value={counts.scheduled} hint="Upcoming sessions" />
        <StatCard label="Completed" value={counts.completed} hint="Closed cases" />
      </div>

      <WorkflowSteps steps={WORKFLOW_STEPS} />

      <div style={styles.panel}>
        <div style={styles.tabs}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  ...styles.tab,
                  ...(isActive ? styles.activeTab : {}),
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading && <div style={styles.empty}>Loading counselling sessions...</div>}
        {error && !loading && <div style={styles.error}>{error}</div>}

        {!loading && !error && (
          <SessionTable
            items={sessions}
            tab={activeTab}
            onSchedule={(session) => setScheduleModal({ open: true, session })}
            onComplete={(session) => setCompleteModal({ open: true, session })}
            onDelete={handleDelete}
          />
        )}
      </div>

      {createModalOpen && (
        <CreateRequestModal
          onClose={() => setCreateModalOpen(false)}
          onSaved={handleCreated}
        />
      )}

      {scheduleModal.open && scheduleModal.session && (
        <ScheduleSessionModal
          session={scheduleModal.session}
          onClose={() => setScheduleModal({ open: false, session: null })}
          onSaved={handleScheduled}
        />
      )}

      {completeModal.open && completeModal.session && (
        <CompleteSessionModal
          session={completeModal.session}
          onClose={() => setCompleteModal({ open: false, session: null })}
          onSaved={handleCompleted}
        />
      )}
    </div>
  );
}

function SessionTable({ items, tab, onSchedule, onComplete, onDelete }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Candidate</th>
            <th style={styles.th}>Issue</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Scheduled At</th>
            <th style={styles.th}>Token</th>
            <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={7} style={styles.emptyCell}>
                {tab === "all" ? "No counselling sessions found." : "No items in this view."}
              </td>
            </tr>
          )}

          {items.map((s) => {
            const badge = statusBadge(s.status);
            const showScheduleAction = s.status === "Requested";
            const showCompleteAction = s.status === "Scheduled";

            return (
              <tr key={s.sessionId} style={styles.tr}>
                <td style={styles.td}>
                  <div style={styles.name}>{s.candidateName || "-"}</div>
                  <div style={styles.muted}>{s.phone || s.email || ""}</div>
                </td>

                <td style={styles.td}>
                  <div style={styles.nameSmall}>{s.issueCategory || "-"}</div>
                  <div style={styles.muted}>{s.description || ""}</div>
                </td>

                <td style={styles.td}>{s.sessionType || "-"}</td>

                <td style={styles.td}>
                  <span style={{ ...styles.badge, background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                </td>

                <td style={styles.td}>{formatDateTime(s.scheduledAt)}</td>

                <td style={styles.td}>
                  <span style={styles.token}>{s.tokenNumber || "-"}</span>
                </td>

                <td style={{ ...styles.td, textAlign: "right" }}>
                  <div style={styles.actionGroup}>
                    {showScheduleAction && (
                      <button
                        type="button"
                        onClick={() => onSchedule(s)}
                        style={styles.actionButton("#123a63")}
                      >
                        Schedule & Token
                      </button>
                    )}

                    {showCompleteAction && (
                      <button
                        type="button"
                        onClick={() => onComplete(s)}
                        style={styles.actionButton("#0f766e")}
                      >
                        Complete / Escalate
                      </button>
                    )}

                    {s.tokenNumber && (
                      <button
                        type="button"
                        onClick={() => printMinistryToken({ ministry: "Counselling", token: s.tokenNumber, personName: s.candidateName, date: s.scheduledAt, location: s.sessionType, status: s.status })}
                        style={styles.actionButton("#7c3aed")}
                      >
                        Print Token
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDelete(s)}
                      style={styles.actionButton("#dc2626")}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateRequestModal({ onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_REQUEST);
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.fullName || !form.phone || !form.issueCategory) {
      toast.warn("Name, phone and issue category are required");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        fullName: form.fullName,
        email: form.email || null,
        phone: form.phone,
        isChurchMember: form.isChurchMember,
        memberId: form.memberId || null,
        issueCategory: form.issueCategory,
        description: form.description || null,
      };

      const res = await api.post(`${API_BASE}/requests`, payload);
      const data = res.data;

      toast.success(`Request created. Ref: ${data?.requestCode || data?.caseId || ""}`);
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error("Unable to create counselling request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={styles.modalLarge}>
        <ModalHeader title="New Counselling Request" onClose={onClose} />

        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <TextField label="Full name" value={form.fullName} onChange={(v) => update("fullName", v)} />
          <TextField label="Phone" value={form.phone} onChange={(v) => update("phone", v)} />
          <TextField label="Email" type="email" value={form.email} onChange={(v) => update("email", v)} />

          <label style={styles.field}>
            <span style={styles.label}>Issue category</span>
            <select
              value={form.issueCategory}
              onChange={(e) => update("issueCategory", e.target.value)}
              style={styles.input}
              required
            >
              <option value="">Select</option>
              {ISSUE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label style={{ ...styles.field, gridColumn: "1 / -1" }}>
            <span style={styles.label}>Short description</span>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              style={styles.textarea}
              rows={4}
              placeholder="Brief summary of the situation"
            />
          </label>

          <label style={styles.checkboxLine}>
            <input
              type="checkbox"
              checked={form.isChurchMember}
              onChange={(e) => update("isChurchMember", e.target.checked)}
            />
            <span>I am part of Mahima Ministry</span>
          </label>

          {form.isChurchMember && (
            <TextField
              label="Member ID"
              value={form.memberId}
              onChange={(v) => update("memberId", v)}
            />
          )}

          <div style={styles.modalActions}>
            <button type="button" onClick={onClose} style={styles.secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={styles.darkButton}>
              {saving ? "Saving..." : "Create Request"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function ScheduleSessionModal({ session, onClose, onSaved }) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();

    if (!scheduledAt || !location) {
      toast.warn("Please fill date/time and location");
      return;
    }

    setSaving(true);

    try {
      const res = await api.post(
        `${API_BASE}/admin/sessions/${session.sessionId}/schedule`,
        {
          scheduledAt,
          location,
          counselorId: null,
        }
      );

      toast.success(`Session scheduled. Token: ${res.data?.tokenNumber || "generated"}`);
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error("Unable to schedule session");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={styles.modalSmall}>
        <ModalHeader title="Schedule Counselling Session" onClose={onClose} />

        <div style={styles.personBlock}>
          <strong>{session.candidateName}</strong>
          <span>{session.issueCategory}</span>
        </div>

        <form onSubmit={handleSave} style={{ display: "grid", gap: 14 }}>
          <TextField
            label="Date and time"
            type="datetime-local"
            value={scheduledAt}
            onChange={setScheduledAt}
          />

          <TextField
            label="Location / Room"
            value={location}
            onChange={setLocation}
            placeholder="Counselling room / church office"
          />

          <div style={styles.modalActions}>
            <button type="button" onClick={onClose} style={styles.secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={styles.darkButton}>
              {saving ? "Saving..." : "Save & Generate Token"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function CompleteSessionModal({ session, onClose, onSaved }) {
  const [outcome, setOutcome] = useState("Resolved");
  const [notes, setNotes] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [nextLocation, setNextLocation] = useState("");
  const [saving, setSaving] = useState(false);

  const needsFollowup =
    outcome === "NeedsFurtherPrayer" || outcome === "EscalateToSeniorPastor";

  async function handleSave(e) {
    e.preventDefault();

    if (needsFollowup && (!nextAt || !nextLocation)) {
      toast.warn("Please provide date/time and location for follow-up");
      return;
    }

    setSaving(true);

    try {
      await api.post(`${API_BASE}/admin/sessions/${session.sessionId}/complete`, {
        outcome,
        notes,
        nextScheduledAt: needsFollowup ? nextAt : null,
        nextLocation: needsFollowup ? nextLocation : null,
      });

      toast.success(
        outcome === "Resolved"
          ? "Session closed"
          : outcome === "NeedsFurtherPrayer"
          ? "Follow-up prayer session created"
          : "Senior pastor escalation created"
      );

      onSaved();
    } catch (err) {
      console.error(err);
      toast.error("Unable to update session");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={styles.modalSmall}>
        <ModalHeader title="Complete / Escalate Session" onClose={onClose} />

        <div style={styles.personBlock}>
          <strong>{session.candidateName}</strong>
          <span>{session.issueCategory}</span>
        </div>

        <form onSubmit={handleSave} style={{ display: "grid", gap: 14 }}>
          <label style={styles.field}>
            <span style={styles.label}>Outcome</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              style={styles.input}
            >
              {OUTCOMES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={styles.textarea}
              rows={4}
              placeholder="Brief summary for pastoral records"
            />
          </label>

          {needsFollowup && (
            <>
              <TextField
                label="Follow-up date and time"
                type="datetime-local"
                value={nextAt}
                onChange={setNextAt}
              />

              <TextField
                label="Follow-up location"
                value={nextLocation}
                onChange={setNextLocation}
                placeholder="Prayer room / main hall / pastor's office"
              />
            </>
          )}

          <div style={styles.modalActions}>
            <button type="button" onClick={onClose} style={styles.secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={styles.darkButton}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={styles.input}
      />
    </label>
  );
}

function WorkflowSteps({ steps }) {
  return (
    <div style={styles.progressRail}>
      {steps.map((step) => (
        <div key={step.label} style={styles.progressStep}>
          <span style={styles.progressDot(step.tone)} />
          <span>
            <span style={styles.progressLabel}>{step.label}</span>
            <span style={styles.progressHint}>{step.hint}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statHint}>{hint}</div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={styles.overlay} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function ModalHeader({ title, onClose }) {
  return (
    <div style={styles.modalHeader}>
      <h3 style={styles.modalTitle}>{title}</h3>
      <button type="button" onClick={onClose} style={styles.closeButton}>
        x
      </button>
    </div>
  );
}

const styles = createWorkflowStyles({
  accent: "#2563eb",
  accent2: "#f59e0b",
  heroFrom: "#123a63",
  heroTo: "#7f1d1d",
  kicker: "#fed7aa",
  title: "#123a63",
});
