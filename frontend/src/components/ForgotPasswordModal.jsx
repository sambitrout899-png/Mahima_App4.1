import React, { useState } from "react";
import { getToken, saveToken, clearToken } from "../features/auth/authService"; // adapt paths to your auth helpers

export default function ForgotPasswordModal({ open, onClose }) {
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  if (!open) return null;

  const API_BASE = import.meta.env.VITE_API_BASE || '/api';

  const resetStateAndClose = () => {
    setUsernameOrEmail("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setMessage(null);
    setBusy(false);
    onClose?.();
  };

  const onSubmit = async (e) => {
    e?.preventDefault?.();

    setMessage(null);

    if (!usernameOrEmail) {
      setMessage({ type: "error", text: "Please enter your username or email." });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setMessage({ type: "error", text: "New password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setMessage({ type: "error", text: "New password and confirmation do not match." });
      return;
    }

    setBusy(true);

    try {
      // First, see if we already have a token
      let token = getToken();

      // If there's no token, but user supplied currentPassword, attempt login to obtain a token
      if (!token) {
        if (!currentPassword) {
          setMessage({ type: "info", text: "You must either be signed in or supply your current password to change it. If you forgot your password completely ask an admin to reset it." });
          setBusy(false);
          return;
        }

        // attempt temporary login
        const loginResp = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernameOrEmail, password: currentPassword })
        });

        if (!loginResp.ok) {
          const txt = await loginResp.text().catch(() => "");
          setMessage({ type: "error", text: `Login failed: ${txt || loginResp.status}` });
          setBusy(false);
          return;
        }

        const loginJson = await loginResp.json();
        token = loginJson?.token;
        if (!token) {
          setMessage({ type: "error", text: "Login succeeded but token missing." });
          setBusy(false);
          return;
        }

        // save token to localStorage temporarily so change-password route can verify
        // (optionally, client might not want to persist; adjust as needed)
        saveToken(token);
      }

      // Call change-password endpoint
      const cpResp = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (!cpResp.ok) {
        const txt = await cpResp.text().catch(() => "");
        // if we logged in temporarily, clear token
        const hadTempLogin = !getToken();
        if (hadTempLogin) clearToken();
        setMessage({ type: "error", text: `Change password failed: ${txt || cpResp.status}` });
        setBusy(false);
        return;
      }

      // success
      setMessage({ type: "success", text: "Password changed successfully. Please sign in with your new password." });

      // If we used a temp-token, clear it so user signs in again
      // (if user was already signed in, you may want to force re-login too)
      // We will clear token to be safe
      clearToken();

      setTimeout(() => {
        resetStateAndClose();
      }, 1400);
    } catch (err) {
      console.error("change password error", err);
      setMessage({ type: "error", text: "Unexpected error changing password." });
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.45)", zIndex: 9999
    }}>
      <div style={{ width: 520, maxWidth: "96%", background: "white", borderRadius: 12, padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Reset / Change password</h3>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, color: "#444" }}>Username or email</label>
            <input value={usernameOrEmail} onChange={(e) => setUsernameOrEmail(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6 }} />
          </div>

          <div>
            <label style={{ fontSize: 13, color: "#444" }}>
              Current password (required if not already signed-in)
            </label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6 }} />
          </div>

          <div>
            <label style={{ fontSize: 13, color: "#444" }}>New password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6 }} />
          </div>

          <div>
            <label style={{ fontSize: 13, color: "#444" }}>Confirm new password</label>
            <input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6 }} />
          </div>

          {message && (
            <div style={{ padding: 8, borderRadius: 8, background: message.type === "error" ? "#ffe9e9" : "#e9ffe9", color: "#333" }}>
              {message.text}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={() => { clearToken(); onClose?.(); }} disabled={busy} style={{ padding: "8px 12px" }}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={busy} style={{ background: "#0b2a47", color: "white", padding: "8px 12px" }}>
              {busy ? "Working…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

