// src/pages/BaptismsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getToken as authGetToken } from "../features/auth/authService";
import { API_BASE as ROOT_API_BASE } from "../api";
import { createWorkflowStyles } from "./ministryWorkflowStyles";
import { printMinistryToken } from "../utils/printMinistryToken";

const API_BASE = `${ROOT_API_BASE}/baptisms`;

const statusTabs = [
  { key: "", label: "All", tone: "#0f172a" },
  { key: "Pending", label: "Pending", tone: "#2563eb" },
  { key: "ChurchVerified", label: "Church Verified", tone: "#0f766e" },
  { key: "AwaitingChurchVerification", label: "Awaiting Verification", tone: "#c2410c" },
  { key: "ReadyForToken", label: "Ready For Token", tone: "#7c3aed" },
  { key: "TokenGenerated", label: "Token Generated", tone: "#0891b2" },
  { key: "Completed", label: "Completed", tone: "#16a34a" },
];

const workflowSteps = [
  { label: "Request", hint: "Candidate details captured", tone: "#2563eb" },
  { label: "Verification", hint: "Church membership checked", tone: "#0f766e" },
  { label: "Consent", hint: "Consent signed", tone: "#7c3aed" },
  { label: "Token", hint: "Certificate prepared", tone: "#0891b2" },
  { label: "Complete", hint: "Baptism closed", tone: "#16a34a" },
];

const emptyForm = {
  fullName: "",
  fatherName: "",
  motherName: "",
  dateOfBirth: "",
  contactNumber: "",
  email: "",
  address: "",
  preferredDate: "",
  preferredService: "",
};

function display(value) {
  return value || "-";
}

function arrayFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function getStatusMeta(status) {
  const map = {
    Pending: { bg: "#dbeafe", color: "#1d4ed8", label: "Pending" },
    ChurchVerified: { bg: "#dcfce7", color: "#166534", label: "Church Verified" },
    AwaitingChurchVerification: {
      bg: "#ffedd5",
      color: "#c2410c",
      label: "Awaiting Verification",
    },
    ReadyForToken: { bg: "#ede9fe", color: "#6d28d9", label: "Ready For Token" },
    TokenGenerated: { bg: "#cffafe", color: "#0e7490", label: "Token Generated" },
    Completed: { bg: "#dcfce7", color: "#15803d", label: "Completed" },
  };

  return map[status] || { bg: "#f1f5f9", color: "#334155", label: status || "-" };
}

export default function BaptismsPage() {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [attachmentRecord, setAttachmentRecord] = useState(null);
  const [certificateFile, setCertificateFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");

  const stats = useMemo(() => {
    return {
      visible: requests.length,
      verified: requests.filter((r) => r.churchVerified).length,
      consent: requests.filter((r) => r.consentSigned).length,
      token: requests.filter((r) => r.token).length,
    };
  }, [requests]);

  function authHeaders() {
    const token = authGetToken ? authGetToken() : localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadRequests() {
    try {
      setLoading(true);
      setError("");

      const res = await axios.get(API_BASE, {
        params: statusFilter ? { status: statusFilter } : {},
        headers: authHeaders(),
      });

      setRequests(arrayFrom(res.data));
    } catch (err) {
      console.error("Error loading baptism requests", err);
      setError("Failed to load baptism requests.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadSignedCertificate(e) {
    e.preventDefault();
    if (!certificateFile || !/\.(pdf|jpe?g|png)$/i.test(certificateFile.name) ||
        certificateFile.size === 0 || certificateFile.size > 10 * 1024 * 1024) {
      setAttachmentError("Choose a non-empty PDF, JPG, or PNG file up to 10 MB.");
      return;
    }
    setUploading(true);
    setAttachmentError("");
    try {
      const data = new FormData();
      data.append("file", certificateFile);
      await axios.post(`${API_BASE}/${attachmentRecord.id}/signed-certificates`, data, { headers: authHeaders() });
      setAttachmentRecord(null);
      setCertificateFile(null);
      await loadRequests();
    } catch (err) {
      setAttachmentError(typeof err?.response?.data === "string" ? err.response.data : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function downloadSignedCertificate(id, attachment) {
    setError("");
    try {
      const response = await axios.get(`${API_BASE}/${id}/signed-certificates/${attachment.id}`, {
        headers: authHeaders(), responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not download the signed certificate. Please try again.");
    }
  }

  // The generated certificate endpoint requires auth now (it used to be anonymous, which
  // let anyone with the URL fetch any tenant's certificate) -- so this is a blob-fetch +
  // client-side download trigger instead of a plain <a target="_blank"> link.
  async function downloadCertificate(id) {
    setError("");
    try {
      const response = await axios.get(`${API_BASE}/${id}/certificate`, {
        headers: authHeaders(), responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `BaptismCertificate_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not download the certificate. Please try again.");
    }
  }

  useEffect(() => {
    loadRequests();
  }, [statusFilter]);

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();

    if (!form.fullName) {
      setError("Full name is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    const payload = {
      fullName: form.fullName,
      fatherName: form.fatherName || null,
      motherName: form.motherName || null,
      dateOfBirth: form.dateOfBirth || null,
      contactNumber: form.contactNumber || null,
      email: form.email || null,
      address: form.address || null,
      preferredDate: form.preferredDate || null,
      preferredService: form.preferredService || null,
    };

    try {
      await axios.post(API_BASE, payload, { headers: authHeaders() });
      setForm(emptyForm);
      setCreating(false);
      setStatusFilter("");
      await loadRequests();
    } catch (err) {
      console.error("Error creating baptism request", err);
      setError("Failed to create baptism request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function withActionLoading(id, fn) {
    setActionLoadingId(id);
    setError("");

    try {
      await fn();
      await loadRequests();
    } catch (err) {
      console.error("Action failed", err);
      const msg =
        err?.response?.data ||
        err?.message ||
        "Action failed. Please try again.";

      setError(typeof msg === "string" ? msg : "Action failed.");
    } finally {
      setActionLoadingId(null);
    }
  }

  const handleVerifyChurch = (id) =>
    withActionLoading(id, () =>
      axios.post(`${API_BASE}/${id}/verify-church`, null, {
        headers: authHeaders(),
      })
    );

  const handleMarkConsent = (id) =>
    withActionLoading(id, () =>
      axios.post(`${API_BASE}/${id}/sign-consent`, null, {
        headers: authHeaders(),
      })
    );

  const handleGenerateToken = (id) =>
    withActionLoading(id, () =>
      axios.post(`${API_BASE}/${id}/generate-token`, null, {
        headers: authHeaders(),
      })
    );

  const handleComplete = (id) =>
    withActionLoading(id, () =>
      axios.put(
        `${API_BASE}/${id}/complete`,
        {},
        {
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
        }
      )
    );

  const handleDelete = (id) => {
    if (!window.confirm("Delete this baptism record permanently?")) return;
    return withActionLoading(id, () =>
      axios.delete(`${API_BASE}/${id}`, { headers: authHeaders() })
    );
  };

  return (
    <div className="ministry-workflow-page baptism-workflow-page" style={styles.page}>
      <div style={styles.hero}>
        <div>
          <div style={styles.kicker}>Baptism Ministry</div>
          <h1 style={styles.title}>Baptism Registrations</h1>
          <p style={styles.subtitle}>
            Manage baptism requests, church verification, consent, token generation,
            certificates, and completion from one pastoral workflow.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          style={styles.primaryButton}
        >
          {creating ? "Close Form" : "+ New Baptism Request"}
        </button>
      </div>

      <div style={styles.statsGrid}>
        <StatCard label="Visible" value={stats.visible} hint="Current status records" />
        <StatCard label="Church Verified" value={stats.verified} hint="Verified in this view" />
        <StatCard label="Consent Signed" value={stats.consent} hint="Consent completed" />
        <StatCard label="Tokens" value={stats.token} hint="Issued tokens" />
      </div>

      <WorkflowSteps steps={workflowSteps} />

      {error && <div style={styles.error}>{error}</div>}

      {attachmentRecord && (
        <section style={styles.formCard} aria-label="Attach signed certificate">
          <h2 style={styles.formTitle}>Attach Signed Certificate</h2>
          <p style={styles.formSub}>For {attachmentRecord.fullName}. Upload an already signed PDF, JPG, or PNG (up to 10 MB).</p>
          <form onSubmit={uploadSignedCertificate}>
            <label style={styles.field}>
              <span style={styles.label}>Signed certificate file</span>
              <input key={attachmentRecord.id} type="file" accept=".pdf,.jpg,.jpeg,.png" required disabled={uploading}
                onChange={(e) => { setCertificateFile(e.target.files?.[0] || null); setAttachmentError(""); }} />
            </label>
            {attachmentError && <p role="alert" style={styles.error}>{attachmentError}</p>}
            <div style={styles.formActions}>
              <button type="button" disabled={uploading} style={styles.secondaryButton}
                onClick={() => { setAttachmentRecord(null); setCertificateFile(null); }}>Cancel</button>
              <button type="submit" disabled={uploading || !certificateFile} style={styles.darkButton}>
                {uploading ? "Uploading..." : "Upload Signed Certificate"}
              </button>
            </div>
          </form>
        </section>
      )}

      {creating && (
        <div style={styles.formCard}>
          <div style={styles.formHeader}>
            <div>
              <h2 style={styles.formTitle}>New Baptism Request</h2>
              <p style={styles.formSub}>
                Capture candidate details and preferred baptism service.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreate} style={styles.formGrid}>
            <TextField
              label="Full Name"
              name="fullName"
              value={form.fullName}
              onChange={handleFormChange}
              required
            />

            <TextField
              label="Father's Name"
              name="fatherName"
              value={form.fatherName}
              onChange={handleFormChange}
            />

            <TextField
              label="Mother's Name"
              name="motherName"
              value={form.motherName}
              onChange={handleFormChange}
            />

            <TextField
              label="Date of Birth"
              type="date"
              name="dateOfBirth"
              value={form.dateOfBirth}
              onChange={handleFormChange}
            />

            <TextField
              label="Contact Number"
              type="tel"
              name="contactNumber"
              value={form.contactNumber}
              onChange={handleFormChange}
            />

            <TextField
              label="Email"
              type="email"
              name="email"
              value={form.email}
              onChange={handleFormChange}
            />

            <label style={{ ...styles.field, gridColumn: "1 / -1" }}>
              <span style={styles.label}>Address</span>
              <textarea
                name="address"
                value={form.address}
                onChange={handleFormChange}
                rows={3}
                style={styles.textarea}
              />
            </label>

            <TextField
              label="Preferred Date"
              type="date"
              name="preferredDate"
              value={form.preferredDate}
              onChange={handleFormChange}
            />

            <label style={styles.field}>
              <span style={styles.label}>Preferred Service</span>
              <select
                name="preferredService"
                value={form.preferredService}
                onChange={handleFormChange}
                style={styles.input}
              >
                <option value="">Select</option>
                <option value="Morning">Morning</option>
                <option value="Evening">Evening</option>
                <option value="Special">Special Service</option>
              </select>
            </label>

            <div style={styles.formActions}>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setForm(emptyForm);
                }}
                style={styles.secondaryButton}
              >
                Cancel
              </button>

              <button type="submit" disabled={submitting} style={styles.darkButton}>
                {submitting ? "Saving..." : "Save Request"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.tabs}>
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
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

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Candidate</th>
                <th style={styles.th}>Contact</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Flags</th>
                <th style={styles.th}>Token</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={styles.emptyCell}>
                    Loading baptism requests...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} style={styles.emptyCell}>
                    {statusFilter
                      ? "No baptism requests found for this status."
                      : "No baptism requests found."}
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <BaptismRow
                    key={request.id}
                    item={request}
                    isLoading={actionLoadingId === request.id}
                    onVerify={handleVerifyChurch}
                    onConsent={handleMarkConsent}
                    onToken={handleGenerateToken}
                    onPrint={(item) => printMinistryToken({ ministry: "Baptism", token: item.token, personName: item.fullName, date: item.preferredDate, location: item.preferredService, status: item.status })}
                    onComplete={handleComplete}
                    onDelete={handleDelete}
                    onAttach={() => {
                      setAttachmentRecord(request);
                      setCertificateFile(null);
                      setAttachmentError("");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    attachmentBusy={uploading}
                    onDownloadAttachment={downloadSignedCertificate}
                    onDownloadCertificate={downloadCertificate}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BaptismRow({ item, isLoading, onVerify, onConsent, onToken, onPrint, onComplete, onDelete, onAttach, attachmentBusy, onDownloadAttachment, onDownloadCertificate }) {
  const meta = getStatusMeta(item.status);

  return (
    <tr style={styles.tr}>
      <td style={styles.td}>
        <div style={styles.name}>{display(item.fullName)}</div>
        <div style={styles.muted}>
          Father: {display(item.fatherName)} | Mother: {display(item.motherName)}
        </div>
        {item.signedCertificates?.map((attachment) => (
          <div key={attachment.id} style={{ marginTop: 8 }}>
            <button type="button" style={{ ...styles.pdfButton, maxWidth: 260, overflowWrap: "anywhere", textAlign: "left" }}
              onClick={() => onDownloadAttachment(item.id, attachment)} title="Download signed certificate">
              Signed: {attachment.filename}
            </button>
          </div>
        ))}
      </td>

      <td style={styles.td}>
        <div>{display(item.contactNumber)}</div>
        <div style={styles.muted}>{display(item.email)}</div>
      </td>

      <td style={styles.td}>
        <span style={{ ...styles.badge, background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </td>

      <td style={styles.td}>
        <div style={styles.flagGroup}>
          {item.churchVerified && <Flag label="Church OK" bg="#dcfce7" color="#166534" />}
          {item.consentSigned && <Flag label="Consent" bg="#dbeafe" color="#1d4ed8" />}
          {item.certificatePdfUrl && <Flag label="Certificate" bg="#ede9fe" color="#6d28d9" />}
          {!item.churchVerified && !item.consentSigned && !item.certificatePdfUrl && (
            <span style={styles.muted}>-</span>
          )}
        </div>
      </td>

      <td style={styles.td}>
        <span style={styles.token}>{display(item.token)}</span>
      </td>

      <td style={{ ...styles.td, textAlign: "right" }}>
        <div style={styles.actionGroup}>
          <button type="button" onClick={onAttach} disabled={isLoading || attachmentBusy}
            style={styles.actionButton("#6d28d9")}>
            Attach Signed Certificate
          </button>
          {!item.churchVerified && (
            <button
              type="button"
              onClick={() => onVerify(item.id)}
              disabled={isLoading}
              style={styles.actionButton("#0f766e")}
            >
              {isLoading ? "..." : "Verify"}
            </button>
          )}

          {!item.consentSigned && (
            <button
              type="button"
              onClick={() => onConsent(item.id)}
              disabled={isLoading}
              style={styles.actionButton("#4f46e5")}
            >
              {isLoading ? "..." : "Mark Consent"}
            </button>
          )}

          {item.churchVerified && item.consentSigned && !item.token && (
            <button
              type="button"
              onClick={() => onToken(item.id)}
              disabled={isLoading}
              style={styles.actionButton("#2563eb")}
            >
              {isLoading ? "..." : "Token + Cert"}
            </button>
          )}

          {item.status === "TokenGenerated" && (
            <button
              type="button"
              onClick={() => onComplete(item.id)}
              disabled={isLoading}
              style={styles.actionButton("#16a34a")}
            >
              {isLoading ? "..." : "Complete"}
            </button>
          )}

          {item.token && (
            <button type="button" onClick={() => onPrint(item)} style={styles.actionButton("#7c3aed")}>
              Print Token
            </button>
          )}

          {item.certificatePdfUrl && (
            <button type="button" onClick={() => onDownloadCertificate(item.id)} style={styles.pdfButton}>
              PDF
            </button>
          )}

          <button
            type="button"
            onClick={() => onDelete(item.id)}
            disabled={isLoading}
            style={styles.actionButton("#dc2626")}
          >
            {isLoading ? "..." : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function TextField({ label, name, value, onChange, type = "text", required = false }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        style={styles.input}
      />
    </label>
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

function Flag({ label, bg, color }) {
  return <span style={{ ...styles.flag, background: bg, color }}>{label}</span>;
}

const styles = createWorkflowStyles({
  accent: "#0ea5e9",
  accent2: "#f59e0b",
  heroFrom: "#123a63",
  heroTo: "#075985",
  kicker: "#bae6fd",
  title: "#123a63",
});
