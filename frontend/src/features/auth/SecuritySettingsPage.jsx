import React, { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Copy, Check, KeyRound } from "lucide-react";
import api from "../../api";
import { requireModuleResponse } from "../../utils/moduleContracts.mjs";

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data ?? err?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

export default function SecuritySettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Setup flow state
  const [setupSecret, setSetupSecret] = useState(null);
  const [setupUri, setSetupUri] = useState(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [copied, setCopied] = useState(false);

  // Disable flow state
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/auth/mfa/status", { notify: false });
      requireModuleResponse(res, "Could not load security settings.");
      setEnabled(Boolean(res?.data?.enabled));
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load security settings."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  async function startSetup() {
    setError("");
    setBusy(true);
    try {
      const res = await api.post("/auth/mfa/setup", {}, { notify: false });
      requireModuleResponse(res, "Could not start MFA setup.");
      setSetupSecret(res?.data?.secret || "");
      setSetupUri(res?.data?.otpauthUri || "");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not start MFA setup."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.post("/auth/mfa/verify-setup", { code: verifyCode.trim() }, { notify: false });
      requireModuleResponse(res, "That code did not match. Check your authenticator app and try again.");
      setRecoveryCodes(Array.isArray(res?.data?.recoveryCodes) ? res.data.recoveryCodes : []);
      setEnabled(true);
      setSetupSecret(null);
      setSetupUri(null);
      setVerifyCode("");
    } catch (err) {
      setError(apiErrorMessage(err, "That code did not match. Check your authenticator app and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.post("/auth/mfa/disable", { password: disablePassword }, { notify: false });
      requireModuleResponse(res, "Could not disable MFA. Check your password.");
      setEnabled(false);
      setShowDisable(false);
      setDisablePassword("");
      setNotice("Two-factor authentication has been turned off.");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not disable MFA. Check your password."));
    } finally {
      setBusy(false);
    }
  }

  function copySecret() {
    navigator.clipboard?.writeText(setupSecret || "").then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Security</h1>
        <p className="text-sm text-slate-500">Add a second authentication step to your account.</p>
      </header>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading...</div>
      ) : recoveryCodes ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-2 flex items-center gap-2 font-bold text-emerald-800"><KeyRound className="h-5 w-5" /> Save your recovery codes</div>
          <p className="mb-3 text-sm text-emerald-800">
            Two-factor authentication is now on. Store these one-time codes somewhere safe — each can be used once if you lose access to your authenticator app. They will not be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-3 font-mono text-sm">
            {recoveryCodes.map((code) => <div key={code}>{code}</div>)}
          </div>
          <button onClick={() => setRecoveryCodes(null)} className="mt-4 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white">
            I've saved these codes
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-full ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
              </span>
              <div>
                <div className="font-semibold text-slate-900">Two-factor authentication</div>
                <div className="text-xs text-slate-500">{enabled ? "Enabled — a code is required at every sign-in." : "Not enabled."}</div>
              </div>
            </div>
            {enabled ? (
              <button onClick={() => setShowDisable(true)} className="rounded-lg border border-rose-300 px-3.5 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                Turn off
              </button>
            ) : !setupSecret ? (
              <button onClick={startSetup} disabled={busy} className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                Set up
              </button>
            ) : null}
          </div>

          {setupSecret && (
            <form onSubmit={confirmSetup} className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                1. In your authenticator app (Google Authenticator, Authy, etc.), add a new account and enter this key manually:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">{setupSecret}</code>
                <button type="button" onClick={copySecret} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-4 text-sm text-slate-600">2. Enter the 6-digit code your app now shows:</p>
              <input
                autoFocus
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest"
                placeholder="000000"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                required
              />
              <button type="submit" disabled={busy} className="mt-4 w-full rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                {busy ? "Verifying..." : "Confirm & Enable"}
              </button>
            </form>
          )}

          {showDisable && (
            <form onSubmit={disableMfa} className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">Enter your password to turn off two-factor authentication.</p>
              <input
                type="password"
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
              />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowDisable(false)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
                <button type="submit" disabled={busy} className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Working..." : "Turn off MFA"}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
