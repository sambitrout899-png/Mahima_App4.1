// src/features/auth/ChangePasswordModal.jsx
import React, { useEffect, useState } from "react";
import { getToken, setToken } from "./authService";

export default function ChangePasswordModal({ open, onClose }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setLoading(false);
      setGenerating(false);
      setMessage(null);
      setSuccess(false);
    }
  }, [open]);

  if (!open) return null;

  const apiBase = import.meta.env.VITE_API_BASE || "/api";

  const generatePassword = async () => {
    setMessage(null);
    setGenerating(true);
    try {
      const token = getToken?.() || localStorage.getItem("mahima_token") || null;
      const resp = await fetch(`${apiBase}/auth/generate-password`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.password) throw new Error(json?.message || "Could not generate a password.");
      setNewPw(json.password);
      setConfirmPw(json.password);
    } catch (err) {
      setMessage(err?.message || "Could not generate a password.");
    } finally {
      setGenerating(false);
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    setMessage(null);
    setSuccess(false);

    if (!currentPw) {
      setMessage("Please enter your current password.");
      return;
    }
    if (!newPw) {
      setMessage("Please provide a new password.");
      return;
    }
    if (newPw !== confirmPw) {
      setMessage("New password and confirmation do not match.");
      return;
    }

    setLoading(true);
    try {
      const token = getToken?.() || localStorage.getItem("mahima_token") || localStorage.getItem("token") || null;

      const resp = await fetch(`${apiBase}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok) {
        setMessage(json?.message || `Error ${resp.status}`);
        return;
      }

      setSuccess(true);
      setMessage(json?.message || "Password updated successfully.");
      if (json?.token) {
        try { setToken(json.token); } catch { localStorage.setItem("mahima_token", json.token); }
      }
    } catch (err) {
      console.error("Change password error:", err);
      setMessage("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const backdropStyle = { position: "fixed", inset: 0, zIndex: 1200, background: "linear-gradient(rgba(9,18,28,0.45), rgba(9,18,28,0.45))", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
  const panelStyle = { width: 480, maxWidth: "100%", borderRadius: 12, background: "#fff", boxShadow: "0 18px 50px rgba(6,22,46,0.35)", padding: 20, color: "#0b2a47", display: "grid", gap: 12 };
  const fieldWrap = { display: "flex", alignItems: "center", gap: 8, background: "#fbfbfb", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(11,42,71,0.06)" };
  const inputStyle = { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15 };
  const hintStyle = { fontSize: 13, color: "#6b6b6b" };

  return (
    <div style={backdropStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form onSubmit={submit} style={panelStyle} role="dialog" aria-modal="true" aria-label="Change password">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#fff6e3,#fff1d6)", fontSize: 22 }}>🔒</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Change password</div>
            <div style={hintStyle}>Updates the password for your own account.</div>
          </div>
        </div>

        <div>
          <label style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>Current password</label>
          <div style={fieldWrap}>
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Enter your current password" style={inputStyle} autoComplete="current-password" required />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <label style={{ fontWeight: 700 }}>New password</label>
            <button type="button" onClick={generatePassword} disabled={generating} style={{ background: "none", border: "none", color: "#166534", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              {generating ? "Generating…" : "Generate strong password"}
            </button>
          </div>
          <div style={{ ...fieldWrap, marginTop: 8 }}>
            <input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="At least 8 characters" style={inputStyle} autoComplete="new-password" />
          </div>
          <div style={{ marginTop: 8, ...hintStyle }}>At least 8 characters, including 3 of: uppercase, lowercase, digits, symbols.</div>
        </div>

        <div>
          <label style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>Confirm new password</label>
          <div style={fieldWrap}>
            <input type="text" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repeat new password" style={inputStyle} autoComplete="new-password" />
          </div>
        </div>

        {message && (
          <div style={{ padding: "8px 10px", borderRadius: 8, background: success ? "rgba(34,197,94,0.12)" : "rgba(220,38,38,0.06)", color: success ? "#166534" : "#991b1b", fontWeight: 700 }}>
            {message}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
          <button type="button" onClick={onClose} disabled={loading} style={{ background: "transparent", border: "1px solid rgba(11,42,71,0.08)", padding: "8px 12px", borderRadius: 8 }}>{success ? "Close" : "Cancel"}</button>
          {!success && (
            <button type="submit" disabled={loading} style={{ display: "inline-flex", gap: 8, alignItems: "center", background: "linear-gradient(90deg,#f1c232,#f6d980)", border: "none", padding: "8px 14px", borderRadius: 8, fontWeight: 800 }}>{loading ? "Saving…" : "Save"}<span aria-hidden>{loading ? "⏳" : "💾"}</span></button>
          )}
        </div>
      </form>
    </div>
  );
}
