import React, { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../api";
import { getToken } from "../features/auth/authService";
import { createWorkflowStyles } from "./ministryWorkflowStyles";
import { printMinistryToken } from "../utils/printMinistryToken";
import { resolveLogoUrl } from "../components/TenantLogo";

const TABS = [
  { key: "", label: "All", tone: "#0f172a" },
  { key: "PendingReview", label: "New Applications", tone: "#2563eb" },
  { key: "Approved", label: "Approved", tone: "#0f766e" },
  { key: "Scheduled", label: "Scheduled", tone: "#c2410c" },
  { key: "Completed", label: "Completed", tone: "#4f46e5" },
];

const WORKFLOW_STEPS = [
  { label: "Apply", hint: "Couple details received", tone: "#2563eb" },
  { label: "Review", hint: "Pastoral approval", tone: "#0f766e" },
  { label: "Schedule", hint: "Ceremony date fixed", tone: "#c2410c" },
  { label: "Complete", hint: "Record closed", tone: "#4f46e5" },
  { label: "Certificate", hint: "Printable church copy", tone: "#be123c" },
];

const EMPTY_FORM = {
  groomFullName: "",
  brideFullName: "",
  groomPhone: "",
  bridePhone: "",
  groomEmail: "",
  brideEmail: "",
  address: "",
  groomIsMember: false,
  brideIsMember: false,
  groomMemberId: "",
  brideMemberId: "",
  preferredDate: "",
  preferredService: "",
};

function formatDate(dtString) {
  if (!dtString) return "-";
  const d = new Date(dtString);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function formatDateOnly(dtString) {
  if (!dtString) return "-";
  const d = new Date(dtString);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function arrayFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusStyle(status) {
  const map = {
    PendingReview: { bg: "#dbeafe", color: "#1d4ed8", label: "Pending Review" },
    Approved: { bg: "#dcfce7", color: "#166534", label: "Approved" },
    Scheduled: { bg: "#ffedd5", color: "#c2410c", label: "Scheduled" },
    Completed: { bg: "#ede9fe", color: "#5b21b6", label: "Completed" },
  };

  return map[status] || { bg: "#f1f5f9", color: "#334155", label: status || "-" };
}

export default function MarriagePage() {
  const [activeTab, setActiveTab] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showNewModal, setShowNewModal] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY_FORM);
  const [scheduleModal, setScheduleModal] = useState(null);
  const [certificateItem, setCertificateItem] = useState(null);

  const apiBase = `${API_BASE}/marriage`;

  const counts = useMemo(() => {
    return {
      total: items.length,
      pending: items.filter((x) => x.status === "PendingReview").length,
      approved: items.filter((x) => x.status === "Approved").length,
      scheduled: items.filter((x) => x.status === "Scheduled").length,
      completed: items.filter((x) => x.status === "Completed").length,
    };
  }, [items]);

  function authHeaders() {
    const token = getToken?.();
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }

  async function loadItems(statusKey = activeTab) {
    setLoading(true);
    setError("");

    try {
      const qs = statusKey ? `?status=${encodeURIComponent(statusKey)}` : "";
      const resp = await fetch(`${apiBase}/admin/applications${qs}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) throw new Error(await resp.text());

      const data = await resp.json();
      setItems(arrayFrom(data));
    } catch (err) {
      console.error(err);
      setError("Failed to load marriage applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems(activeTab);
  }, [activeTab]);

  function updateForm(field, value) {
    setNewForm((prev) => ({ ...prev, [field]: value }));
  }

  function resetNewForm() {
    setNewForm(EMPTY_FORM);
  }

  async function handleCreate() {
    if (!newForm.groomFullName || !newForm.brideFullName) {
      alert("Groom and Bride full names are required.");
      return;
    }

    try {
      const body = {
        ...newForm,
        preferredDate: newForm.preferredDate
          ? new Date(newForm.preferredDate).toISOString()
          : null,
      };

      const resp = await fetch(`${apiBase}/applications`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        console.error(await resp.text());
        alert("Unable to submit marriage application.");
        return;
      }

      setShowNewModal(false);
      resetNewForm();
      setActiveTab("");
      await loadItems("");
    } catch (err) {
      console.error(err);
      alert("Error submitting application.");
    }
  }

  async function handleApprove(id) {
    if (!window.confirm("Approve this marriage application and generate a token?")) return;

    try {
      const resp = await fetch(`${apiBase}/admin/applications/${id}/approve`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ notes: "" }),
      });

      if (!resp.ok) {
        console.error(await resp.text());
        alert("Unable to approve application.");
        return;
      }

      await loadItems(activeTab);
    } catch (err) {
      console.error(err);
      alert("Error approving application.");
    }
  }

  function openScheduleModal(item) {
    setScheduleModal({
      id: item.id,
      scheduledAt: item.scheduledAt ? item.scheduledAt.slice(0, 16) : "",
      ceremonyLocation: item.ceremonyLocation || "",
    });
  }

  async function handleSchedule() {
    if (!scheduleModal?.scheduledAt) {
      alert("Please select ceremony date and time.");
      return;
    }

    try {
      const body = {
        scheduledAt: new Date(scheduleModal.scheduledAt).toISOString(),
        ceremonyLocation: scheduleModal.ceremonyLocation,
      };

      const resp = await fetch(
        `${apiBase}/admin/applications/${scheduleModal.id}/schedule`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(body),
        }
      );

      if (!resp.ok) {
        console.error(await resp.text());
        alert("Unable to schedule marriage.");
        return;
      }

      setScheduleModal(null);
      await loadItems(activeTab);
    } catch (err) {
      console.error(err);
      alert("Error scheduling marriage.");
    }
  }

  async function handleComplete(id) {
    if (!window.confirm("Mark this marriage as completed?")) return;

    try {
      const resp = await fetch(`${apiBase}/admin/applications/${id}/complete`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ notes: "" }),
      });

      if (!resp.ok) {
        console.error(await resp.text());
        alert("Unable to complete marriage.");
        return;
      }

      await loadItems(activeTab);
    } catch (err) {
      console.error(err);
      alert("Error completing marriage.");
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this marriage application permanently?")) return;

    try {
      const resp = await fetch(`${apiBase}/admin/applications/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!resp.ok) {
        console.error(await resp.text());
        alert("Unable to delete application.");
        return;
      }

      await loadItems(activeTab);
    } catch (err) {
      console.error(err);
      alert("Error deleting application.");
    }
  }

  function handlePrintCertificate() {
    if (!certificateItem) return;

    const item = certificateItem;
    const marriageDate = item.scheduledAt || item.preferredDate || item.createdAt;
    const formattedMarriageDate = formatDateOnly(marriageDate);
    const formattedIssueDate = formatDateOnly(new Date().toISOString());
    const printTemplate = window.__mahimaPrintTemplate || {};
    const organizationName = printTemplate.organizationName || "Church";
    const templateAddress = printTemplate.address || "";
    const templateLogo = printTemplate.showLogo !== false ? resolveLogoUrl(printTemplate.logoUrl || "") : "";
    const primaryColor = printTemplate.primaryColor || "#123a63";

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Provisional Marriage Certificate</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; background: #f8fafc; margin: 0; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 22mm 20mm; background: white; box-sizing: border-box; }
  .frame { border: 8px double #8b5e34; padding: 22px; min-height: 245mm; }
  .header { text-align: center; border-bottom: 2px solid #8b5e34; padding-bottom: 14px; }
  .church { font-size: 24px; font-weight: 900; letter-spacing: .08em; color: ${escapeHtml(primaryColor)}; }
  .logo { display:block; max-width:100px; max-height:64px; object-fit:contain; margin:0 auto 8px; }
  .sub { margin-top: 4px; font-size: 12px; color: #64748b; }
  .title { text-align: center; margin: 32px 0 18px; font-size: 22px; font-weight: 800; text-transform: uppercase; text-decoration: underline; color: #7c2d12; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; margin: 10px 0; }
  .body { margin-top: 28px; font-size: 15px; line-height: 1.85; text-align: justify; color: #1f2937; }
  .names { font-weight: 800; color: #111827; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px; }
  .box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; font-size: 12px; line-height: 1.7; background: #fffaf3; }
  .box strong { color: #7c2d12; }
  .signatures { display: flex; justify-content: space-between; margin-top: 70px; font-size: 12px; }
  .sig { width: 42%; text-align: center; border-top: 1px solid #111; padding-top: 8px; }
  .disclaimer { margin-top: 42px; padding-top: 10px; border-top: 1px dashed #94a3b8; font-size: 10px; color: #64748b; line-height: 1.5; }
  @page { size: A4; margin: 12mm; }
</style>
</head>
<body>
<div class="page">
  <div class="frame">
    <div class="header">
      ${templateLogo ? `<img class="logo" src="${escapeHtml(templateLogo)}" alt="Logo" />` : ""}
      <div class="church">${escapeHtml(organizationName)}</div>
      <div class="sub">${escapeHtml(printTemplate.headerText || "Pastoral and Marriage Ministry")}</div>
      ${printTemplate.showAddress !== false && templateAddress ? `<div class="sub">${escapeHtml(templateAddress)}</div>` : ""}
    </div>

    <div class="title">Provisional Marriage Certificate</div>

    <div class="meta">
      <div><strong>Certificate No:</strong> ${escapeHtml(item.token || "-")}</div>
      <div><strong>Date of Issue:</strong> ${escapeHtml(formattedIssueDate)}</div>
    </div>
    <div class="meta">
      <div><strong>Church Location:</strong> ${escapeHtml(item.ceremonyLocation || printTemplate.address || "To be confirmed")}</div>
      <div><strong>Marriage Date:</strong> ${escapeHtml(formattedMarriageDate)}</div>
    </div>

    <div class="body">
      This is to certify that, according to the marriage records of
      <strong>${escapeHtml(organizationName)}</strong>, the Christian marriage of
      <span class="names">${escapeHtml(item.groomFullName || "________________")}</span>
      and
      <span class="names">${escapeHtml(item.brideFullName || "________________")}</span>
      has been duly solemnised in the presence of witnesses and pastoral leadership.
    </div>

    <div class="grid">
      <div class="box">
        <strong>Groom Details</strong><br/>
        Name: ${escapeHtml(item.groomFullName || "-")}<br/>
        Phone: ${escapeHtml(item.groomPhone || "-")}<br/>
        Email: ${escapeHtml(item.groomEmail || "-")}
      </div>
      <div class="box">
        <strong>Bride Details</strong><br/>
        Name: ${escapeHtml(item.brideFullName || "-")}<br/>
        Phone: ${escapeHtml(item.bridePhone || "-")}<br/>
        Email: ${escapeHtml(item.brideEmail || "-")}
      </div>
    </div>

    <div class="box" style="margin-top:18px;">
      <strong>Residential Address As Declared</strong><br/>
      ${escapeHtml(item.address || "-")}
    </div>

    <div class="box" style="margin-top:18px;">
      <strong>Internal Church Reference</strong><br/>
      Application Token: ${escapeHtml(item.token || "-")}<br/>
      Application Created: ${escapeHtml(formatDateOnly(item.createdAt))}
    </div>

    <div class="signatures">
      <div class="sig">Senior Pastor / Marriage Minister</div>
      <div class="sig">Church Seal</div>
    </div>

    <div class="disclaimer">
      This provisional certificate is issued by ${escapeHtml(organizationName)} for pastoral and church-record purposes only.
      It is not a replacement for the civil marriage certificate issued by the competent government authority.
    </div>
  </div>
</div>
<script>window.onload = function(){ window.focus(); window.print(); };</script>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("Please allow pop-ups to print the certificate.");
      return;
    }

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function renderActions(item) {
    const btn = (label, onClick, tone) => (
      <button type="button" onClick={onClick} style={styles.actionButton(tone)}>
        {label}
      </button>
    );

    if (item.status === "PendingReview" || item.status === "Pending" || item.status === "New") {
      return btn("Approve", () => handleApprove(item.id), "#0f766e");
    }

    if (item.status === "Approved") {
      return btn("Schedule", () => openScheduleModal(item), "#c2410c");
    }

    if (item.status === "Scheduled") {
      return btn("Mark Completed", () => handleComplete(item.id), "#123a63");
    }

    if (item.status === "Completed" || item.status === "Closed") {
      return btn("Certificate", () => setCertificateItem(item), "#4f46e5");
    }

    return null;
  }

  return (
    <div className="ministry-workflow-page marriage-workflow-page" style={styles.page}>
      <div style={styles.hero}>
        <div>
          <div style={styles.kicker}>Marriage Ministry</div>
          <h1 style={styles.title}>Marriage Applications</h1>
          <p style={styles.subtitle}>
            Review applications, issue tokens, schedule ceremonies, complete records,
            and generate provisional church certificates.
          </p>
        </div>

        <button type="button" onClick={() => setShowNewModal(true)} style={styles.primaryButton}>
          + New Application
        </button>
      </div>

      <div style={styles.statsGrid}>
        <StatCard label="Current Tab" value={counts.total} hint="Visible records" />
        <StatCard label="Pending" value={counts.pending} hint="Need review" />
        <StatCard label="Approved" value={counts.approved} hint="Token issued" />
        <StatCard label="Completed" value={counts.completed} hint="Certificate ready" />
      </div>

      <WorkflowSteps steps={WORKFLOW_STEPS} />

      <div style={styles.panel}>
        <div style={styles.tabs}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  ...styles.tab,
                  ...(active ? styles.activeTab : {}),
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading && <div style={styles.empty}>Loading applications...</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Couple</th>
                  <th style={styles.th}>Contact</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Preferred</th>
                  <th style={styles.th}>Scheduled</th>
                  <th style={styles.th}>Location</th>
                  <th style={styles.th}>Token</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} style={styles.emptyCell}>
                      {activeTab ? "No items found for this tab." : "No marriage applications found."}
                    </td>
                  </tr>
                )}

                {items.map((m) => {
                  const badge = statusStyle(m.status);
                  return (
                    <tr key={m.id} style={styles.tr}>
                      <td style={styles.td}>
                        <div style={styles.name}>{m.groomFullName || "-"}</div>
                        <div style={styles.muted}>with {m.brideFullName || "-"}</div>
                      </td>
                      <td style={styles.td}>
                        <div>{m.groomPhone || m.bridePhone || "-"}</div>
                        <div style={styles.muted}>{m.groomEmail || m.brideEmail || ""}</div>
                      </td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={styles.td}>{formatDate(m.preferredDate)}</td>
                      <td style={styles.td}>{formatDate(m.scheduledAt)}</td>
                      <td style={styles.td}>{m.ceremonyLocation || "-"}</td>
                      <td style={styles.td}>
                        <span style={styles.token}>{m.token || "-"}</span>
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <div style={styles.actionGroup}>
                          {renderActions(m)}
                          {m.token && (
                            <button type="button" onClick={() => printMinistryToken({ ministry: "Marriage", token: m.token, personName: m.groomFullName, companionName: m.brideFullName, date: m.scheduledAt || m.preferredDate, location: m.ceremonyLocation, status: m.status })} style={styles.actionButton("#7c3aed")}>
                              Print Token
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(m.id)}
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
        )}
      </div>

      {showNewModal && (
        <ApplicationModal
          form={newForm}
          updateForm={updateForm}
          onClose={() => {
            setShowNewModal(false);
            resetNewForm();
          }}
          onSubmit={handleCreate}
        />
      )}

      {scheduleModal && (
        <ScheduleModal
          value={scheduleModal}
          setValue={setScheduleModal}
          onClose={() => setScheduleModal(null)}
          onSubmit={handleSchedule}
        />
      )}

      {certificateItem && (
        <CertificateModal
          item={certificateItem}
          onClose={() => setCertificateItem(null)}
          onPrint={handlePrintCertificate}
        />
      )}
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

function ApplicationModal({ form, updateForm, onClose, onSubmit }) {
  return (
    <Modal onClose={onClose}>
      <div style={styles.modalLarge}>
        <ModalHeader title="New Marriage Application" onClose={onClose} />

        <div style={styles.formGrid}>
          <TextField label="Groom full name" value={form.groomFullName} onChange={(v) => updateForm("groomFullName", v)} />
          <TextField label="Bride full name" value={form.brideFullName} onChange={(v) => updateForm("brideFullName", v)} />
          <TextField label="Groom phone" value={form.groomPhone} onChange={(v) => updateForm("groomPhone", v)} />
          <TextField label="Bride phone" value={form.bridePhone} onChange={(v) => updateForm("bridePhone", v)} />
          <TextField label="Groom email" type="email" value={form.groomEmail} onChange={(v) => updateForm("groomEmail", v)} />
          <TextField label="Bride email" type="email" value={form.brideEmail} onChange={(v) => updateForm("brideEmail", v)} />

          <label style={{ ...styles.field, gridColumn: "1 / -1" }}>
            <span style={styles.label}>Address</span>
            <textarea
              rows={3}
              value={form.address}
              onChange={(e) => updateForm("address", e.target.value)}
              style={styles.textarea}
            />
          </label>

          <TextField label="Preferred date" type="date" value={form.preferredDate} onChange={(v) => updateForm("preferredDate", v)} />

          <label style={styles.field}>
            <span style={styles.label}>Preferred service</span>
            <select
              value={form.preferredService}
              onChange={(e) => updateForm("preferredService", e.target.value)}
              style={styles.input}
            >
              <option value="">Select</option>
              <option value="Morning">Morning</option>
              <option value="Evening">Evening</option>
            </select>
          </label>
        </div>

        <div style={styles.modalActions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>Cancel</button>
          <button type="button" onClick={onSubmit} style={styles.darkButton}>Submit Application</button>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleModal({ value, setValue, onClose, onSubmit }) {
  return (
    <Modal onClose={onClose}>
      <div style={styles.modalSmall}>
        <ModalHeader title="Schedule Marriage" onClose={onClose} />

        <TextField
          label="Date and time"
          type="datetime-local"
          value={value.scheduledAt}
          onChange={(v) => setValue({ ...value, scheduledAt: v })}
        />

        <TextField
          label="Ceremony location"
          value={value.ceremonyLocation}
          onChange={(v) => setValue({ ...value, ceremonyLocation: v })}
        />

        <div style={styles.modalActions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>Cancel</button>
          <button type="button" onClick={onSubmit} style={styles.darkButton}>Save Schedule</button>
        </div>
      </div>
    </Modal>
  );
}

function CertificateModal({ item, onClose, onPrint }) {
  return (
    <Modal onClose={onClose}>
      <div style={styles.modalLarge}>
        <ModalHeader title="Provisional Marriage Certificate" onClose={onClose} />

        <div style={styles.certificatePreview}>
          <div style={styles.certHeader}>{(window.__mahimaPrintTemplate?.organizationName || "Church").toUpperCase()}</div>
          <div style={styles.certSub}>Restoration | Healing | Mission - Marriage Ministry</div>
          <div style={styles.certTitle}>Provisional Marriage Certificate</div>

          <p style={styles.certBody}>
            This certifies that <strong>{item.groomFullName}</strong> and{" "}
            <strong>{item.brideFullName}</strong> were united in Christian marriage on{" "}
            <strong>{formatDateOnly(item.scheduledAt || item.preferredDate || item.createdAt)}</strong>{" "}
            at <strong>{item.ceremonyLocation || window.__mahimaPrintTemplate?.address || "the church"}</strong>.
          </p>

          <div style={styles.certGrid}>
            <div>
              <strong>Certificate No.</strong>
              <br />
              {item.token || "-"}
            </div>
            <div>
              <strong>Issue Date</strong>
              <br />
              {formatDateOnly(new Date().toISOString())}
            </div>
          </div>

          <div style={styles.certNote}>
            This is a church provisional certificate for pastoral and record purposes.
            It is not a replacement for the official government marriage certificate.
          </div>
        </div>

        <div style={styles.modalActions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>Close</button>
          <button type="button" onClick={onPrint} style={styles.darkButton}>Open Printable Certificate</button>
        </div>
      </div>
    </Modal>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={styles.input}
      />
    </label>
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
      <button type="button" onClick={onClose} style={styles.closeButton}>x</button>
    </div>
  );
}

const styles = createWorkflowStyles({
  accent: "#be123c",
  accent2: "#f59e0b",
  heroFrom: "#123a63",
  heroTo: "#7f1d1d",
  kicker: "#fed7aa",
  title: "#123a63",
  extra: {
    certificatePreview: {
      padding: 24,
      borderRadius: 16,
      border: "1px solid #e2e8f0",
      background: "linear-gradient(180deg, #fff7ed, #ffffff)",
    },
    certHeader: {
      textAlign: "center",
      fontWeight: 950,
      color: "#123a63",
      fontSize: 20,
      textTransform: "uppercase",
    },
    certSub: {
      textAlign: "center",
      marginTop: 4,
      color: "#64748b",
      fontSize: 12,
    },
    certTitle: {
      textAlign: "center",
      margin: "20px 0",
      fontSize: 18,
      fontWeight: 900,
      textTransform: "uppercase",
      textDecoration: "underline",
      color: "#7c2d12",
    },
    certBody: {
      fontSize: 15,
      lineHeight: 1.8,
      color: "#1f2937",
    },
    certGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
      marginTop: 18,
      fontSize: 13,
    },
    certNote: {
      marginTop: 20,
      paddingTop: 12,
      borderTop: "1px dashed #cbd5e1",
      color: "#64748b",
      fontSize: 12,
      lineHeight: 1.6,
    },
  },
});
