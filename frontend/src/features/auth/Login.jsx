import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { googleLogin, login, mfaLoginVerify, register, persistSharedAuthToken } from "../../utils/fetch-auth-shim";
import { clearSharedAuthToken } from "../../utils/sharedAuthCookie";
import { API_BASE } from "../../api";
import mahimaLogo from "../../assets/mahima-logo.png";
import { initNativeApp, flushPendingFcmToken, ensurePushTokenRegistered } from "../../utils/initNativeApp";
import { registerMobilePushNotifications } from "../../utils/mobilePushNotifications";
import { getProvisionedTenant } from "../../utils/tenantProvision";
import "./Login.css";

const REMEMBER_LOGIN_KEY = "mahima_remember_login";
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function isMobileAppMode() {
  try {
    return (
      import.meta.env.MODE === "mobile" ||
      Boolean(window.Capacitor?.isNativePlatform?.())
    );
  } catch {
    return false;
  }
}

function readRememberedLogin() {
  try {
    const raw = localStorage.getItem(REMEMBER_LOGIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function tenantSlugFromCurrentUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const hash = window.location.hash || "";
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    const hashTenantMatch = hash.match(/^#\/t\/([^/?#]+)/i);
    const fromUrl = (
      params.get("tenantSlug") ||
      params.get("tenant") ||
      hashParams.get("tenantSlug") ||
      hashParams.get("tenant") ||
      (hashTenantMatch ? decodeURIComponent(hashTenantMatch[1]) : "") ||
      ""
    ).trim();
    return fromUrl || (
      localStorage.getItem("mahima_tenant_slug") ||
      localStorage.getItem("tenantSlug") ||
      localStorage.getItem("tenant_slug") ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function humanizeSlug(slug) {
  return String(slug || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveAsset(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/uploads/")) {
        parsed.pathname = `/api${parsed.pathname}`;
        return parsed.toString();
      }
    } catch {
      return value;
    }
    return value;
  }
  if (/^(data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/uploads/")) return `/api${value}`;
  return `${value.startsWith("/") ? "" : "/"}${value}`;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidUsername(value) {
  return /^[A-Za-z0-9._-]{3,50}$/.test(String(value || "").trim());
}

function isValidEmail(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254;
}

function normalizeIndianMobile(value) {
  const digits = digitsOnly(value);
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return "";
}

function validateRegistrationForm({ username, displayName, phone, password }) {
  const cleanUsername = username.trim();
  const cleanDisplayName = displayName.trim();
  const mobile = normalizeIndianMobile(phone);

  if (!cleanDisplayName || !cleanUsername || !phone.trim() || !password) {
    return "Display Name, Username, Mobile Number and Password are required";
  }

  if (!isValidUsername(cleanUsername)) {
    return "Username must be 3-50 characters and can use letters, numbers, dot, underscore, or hyphen only.";
  }

  if (!mobile) {
    return "Enter a valid 10-digit Indian mobile number.";
  }

  if (password.length < 6) {
    return "Password must be at least 6 characters";
  }

  if (cleanUsername.includes("@") && !isValidEmail(cleanUsername)) {
    return "If you use an email as username, enter a valid email address.";
  }

  return "";
}

export default function Login() {
  const navigate = useNavigate();
  const [loginTenantSlug, setLoginTenantSlug] = useState(() => tenantSlugFromCurrentUrl());
  const [fullTenantOptions, setFullTenantOptions] = useState([]);
  const [tenantDirectoryLoading, setTenantDirectoryLoading] = useState(false);
  const [provisionedTenant, setProvisionedTenant] = useState(null);
  const [tenantPickerUnlocked, setTenantPickerUnlocked] = useState(false);
  const tenantOptions = provisionedTenant && !tenantPickerUnlocked
    ? [{ name: provisionedTenant.name || humanizeSlug(provisionedTenant.slug), slug: provisionedTenant.slug }]
    : fullTenantOptions;
  const autoLoginStarted = useRef(false);
  const googleButtonRef = useRef(null);
  const runtimeGoogleClientId = typeof window !== "undefined" ? (window.__GOOGLE_CLIENT_ID__ || window.__GOOGLE_WEB_CLIENT_ID__ || "") : "";
  const runtimeGoogleAndroidClientId = typeof window !== "undefined" ? (window.__GOOGLE_ANDROID_CLIENT_ID__ || "") : "";
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || runtimeGoogleClientId;
  const googleAndroidClientId = import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID || runtimeGoogleAndroidClientId;
  const googleWebClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || runtimeGoogleClientId || googleClientId;

  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => isMobileAppMode() || Boolean(readRememberedLogin()));
  const [showPwd, setShowPwd] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [nativeGoogleReady, setNativeGoogleReady] = useState(false);
  const [tenantBrand, setTenantBrand] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setTenantDirectoryLoading(true);
    fetch(`${API_BASE}/public/tenants`, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Church directory could not be loaded (${res.status}).`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setFullTenantOptions(Array.isArray(data?.tenants) ? data.tenants : []);
      })
      .catch((err) => {
        console.warn("[login] Church directory failed", err);
        if (!cancelled) setError("Could not load the church list. Check your internet connection and try again.");
      })
      .finally(() => { if (!cancelled) setTenantDirectoryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getProvisionedTenant().then((tenant) => {
      if (cancelled || !tenant?.slug) return;
      setProvisionedTenant(tenant);
      selectTenant(tenant.slug);
    });
    return () => { cancelled = true; };
  }, []);

  function selectTenant(slug) {
    const nextSlug = String(slug || "").trim();
    setLoginTenantSlug(nextSlug);
    setTenantBrand(null);
    setError("");
    setForgotSent("");
    if (nextSlug) {
      localStorage.setItem("mahima_tenant_slug", nextSlug);
      localStorage.setItem("tenantSlug", nextSlug);
    } else {
      localStorage.removeItem("mahima_tenant_slug");
      localStorage.removeItem("tenantSlug");
      localStorage.removeItem("tenant_slug");
    }
    localStorage.removeItem("authToken");
    localStorage.removeItem("mahima_token");
    localStorage.removeItem("token");
    localStorage.removeItem("mahima_user");
    localStorage.removeItem("user");
    localStorage.removeItem("me");
    localStorage.removeItem("mahima_auth_tenant_slug");
    clearSharedAuthToken();
  }

  function persistAuthSession(token, user = null) {
    localStorage.setItem("authToken", token);
    localStorage.setItem("mahima_token", token);
    localStorage.setItem("token", token);
    persistSharedAuthToken(token);
    if (loginTenantSlug) {
      localStorage.setItem("mahima_auth_tenant_slug", loginTenantSlug);
      localStorage.setItem("mahima_tenant_slug", loginTenantSlug);
      localStorage.setItem("tenantSlug", loginTenantSlug);
    }

    if (user) {
      localStorage.setItem("mahima_user", JSON.stringify(user));
      localStorage.setItem("user", JSON.stringify(user));
    }
  }

  useEffect(() => {
    const tenantSlug = loginTenantSlug;
    if (tenantSlug) {
      localStorage.setItem("mahima_tenant_slug", tenantSlug);
      localStorage.setItem("tenantSlug", tenantSlug);
      localStorage.removeItem("authToken");
      localStorage.removeItem("mahima_token");
      localStorage.removeItem("token");
      localStorage.removeItem("mahima_user");
      localStorage.removeItem("user");
      localStorage.removeItem("me");
      clearSharedAuthToken();
    }

    if (getStoredToken()) {
      navigate("/home", { replace: true });
      return;
    }

    const remembered = readRememberedLogin();
    if (!remembered?.username || !remembered?.password) return;

    setUsername(remembered.username);
    setPassword(remembered.password);
    setRememberMe(true);

    if (!isMobileAppMode() || !tenantSlug || remembered.tenantSlug !== tenantSlug || autoLoginStarted.current) return;
    autoLoginStarted.current = true;
    performLogin(remembered.username, remembered.password, true);
  }, [loginTenantSlug]);

  useEffect(() => {
    let cancelled = false;
    const landingUrl = loginTenantSlug
      ? `${API_BASE}/public/tenants/${encodeURIComponent(loginTenantSlug)}/landing`
      : `${API_BASE}/public/landing/current`;
    fetch(landingUrl, {
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const slug = data?.tenant?.slug || data?.tenant?.Slug || "";
        if (slug) {
          localStorage.setItem("mahima_tenant_slug", slug);
          localStorage.setItem("tenantSlug", slug);
        }
        setTenantBrand(data || null);
      })
      .catch((err) => {
        console.warn("[login] Tenant branding failed", err);
        if (!cancelled) setTenantBrand(null);
      });

    return () => {
      cancelled = true;
    };
  }, [loginTenantSlug]);

  useEffect(() => {
    setGoogleReady(false);
    if (mode !== "login" || !googleWebClientId || !googleButtonRef.current || isMobileAppMode()) return;

    let cancelled = false;

    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;

        window.google.accounts.id.initialize({
          client_id: googleWebClientId,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: "signin_with",
          width: 320,
        });
        setGoogleReady(true);
      })
      .catch((err) => {
        console.warn("[login] Google sign-in script failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, googleWebClientId]);

  function loadGoogleIdentityScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  useEffect(() => {
    if (mode !== "login" || !isMobileAppMode()) {
      setNativeGoogleReady(false);
      return;
    }

    const plugins = window.Capacitor?.Plugins || {};
    setNativeGoogleReady(Boolean(plugins.GoogleAuth?.signIn || plugins.FirebaseAuthentication?.signInWithGoogle));
  }, [mode]);

  function extractGoogleIdToken(result) {
    return (
      result?.authentication?.idToken ||
      result?.credential?.idToken ||
      result?.idToken ||
      result?.serverAuthCodeIdToken ||
      result?.user?.authentication?.idToken ||
      result?.result?.credential?.idToken ||
      ""
    );
  }

  async function signInWithNativeGoogle() {
    const plugins = window.Capacitor?.Plugins || {};

    if (plugins.GoogleAuth?.initialize) {
      await plugins.GoogleAuth.initialize({
        clientId: googleWebClientId || undefined,
        serverClientId: googleWebClientId || undefined,
        androidClientId: googleAndroidClientId || undefined,
        scopes: ["profile", "email"],
        grantOfflineAccess: false,
      }).catch(() => {});
    }

    if (plugins.GoogleAuth?.signIn) {
      return plugins.GoogleAuth.signIn();
    }

    if (plugins.FirebaseAuthentication?.signInWithGoogle) {
      return plugins.FirebaseAuthentication.signInWithGoogle({
        mode: "popup",
      });
    }

    throw new Error("Native Google sign-in plugin is not installed in this app build.");
  }

  async function handleGoogleButtonClick() {
    setError("");

    if (isMobileAppMode()) {
      setLoading(true);
      try {
        const result = await signInWithNativeGoogle();
        const idToken = extractGoogleIdToken(result);
        if (!idToken) throw new Error("Google sign-in did not return an ID token from the app.");
        await handleGoogleCredential({ credential: idToken });
      } catch (err) {
        setError(err.message || "Google sign-in failed in the app.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!googleWebClientId) {
      setError("Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID in the frontend and GoogleAuth:ClientIds in the API.");
      return;
    }

    try {
      await loadGoogleIdentityScript();
      if (!window.google?.accounts?.id) throw new Error("Google Identity Services did not load.");
      window.google.accounts.id.initialize({
        client_id: googleWebClientId,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.prompt((notification) => {
        const blocked = notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.();
        if (blocked && !googleReady) {
          setError("Google sign-in could not be displayed. Check the Google client ID and authorized JavaScript origin.");
        }
      });
    } catch (err) {
      setError(err.message || "Google sign-in could not start.");
    }
  }

  useEffect(() => {
    setGoogleReady(false);
    if (mode !== "login" || !googleWebClientId || !googleButtonRef.current || isMobileAppMode()) return;

    let cancelled = false;

    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;

        window.google.accounts.id.initialize({
          client_id: googleWebClientId,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: "signin_with",
          width: 320,
        });
        setGoogleReady(true);
      })
      .catch((err) => {
        console.warn("[login] Google sign-in script failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, googleWebClientId]);

  function loadGoogleIdentityScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  useEffect(() => {
    if (mode !== "login" || !isMobileAppMode()) {
      setNativeGoogleReady(false);
      return;
    }

    const plugins = window.Capacitor?.Plugins || {};
    setNativeGoogleReady(Boolean(plugins.GoogleAuth?.signIn || plugins.FirebaseAuthentication?.signInWithGoogle));
  }, [mode]);

  function extractGoogleIdToken(result) {
    return (
      result?.authentication?.idToken ||
      result?.credential?.idToken ||
      result?.idToken ||
      result?.serverAuthCodeIdToken ||
      result?.user?.authentication?.idToken ||
      result?.result?.credential?.idToken ||
      ""
    );
  }

  async function signInWithNativeGoogle() {
    const plugins = window.Capacitor?.Plugins || {};

    if (plugins.GoogleAuth?.initialize) {
      await plugins.GoogleAuth.initialize({
        clientId: googleWebClientId || undefined,
        serverClientId: googleWebClientId || undefined,
        androidClientId: googleAndroidClientId || undefined,
        scopes: ["profile", "email"],
        grantOfflineAccess: false,
      }).catch(() => {});
    }

    if (plugins.GoogleAuth?.signIn) {
      return plugins.GoogleAuth.signIn();
    }

    if (plugins.FirebaseAuthentication?.signInWithGoogle) {
      return plugins.FirebaseAuthentication.signInWithGoogle({
        mode: "popup",
      });
    }

    throw new Error("Native Google sign-in plugin is not installed in this app build.");
  }

  async function handleGoogleButtonClick() {
    setError("");

    if (isMobileAppMode()) {
      setLoading(true);
      try {
        const result = await signInWithNativeGoogle();
        const idToken = extractGoogleIdToken(result);
        if (!idToken) throw new Error("Google sign-in did not return an ID token from the app.");
        await handleGoogleCredential({ credential: idToken });
      } catch (err) {
        setError(err.message || "Google sign-in failed in the app.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!googleWebClientId) {
      setError("Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID in the frontend and GoogleAuth:ClientIds in the API.");
      return;
    }

    try {
      await loadGoogleIdentityScript();
      if (!window.google?.accounts?.id) throw new Error("Google Identity Services did not load.");
      window.google.accounts.id.initialize({
        client_id: googleWebClientId,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.prompt((notification) => {
        const blocked = notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.();
        if (blocked && !googleReady) {
          setError("Google sign-in could not be displayed. Check the Google client ID and authorized JavaScript origin.");
        }
      });
    } catch (err) {
      setError(err.message || "Google sign-in could not start.");
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
    setPassword("");
    if (nextMode !== "login") setForgotSent("");
  }

  function getStoredToken() {
    return (
      localStorage.getItem("authToken") ||
      localStorage.getItem("mahima_token") ||
      localStorage.getItem("token")
    );
  }

  async function readError(res) {
    const text = await res.text().catch(() => "");

    if (text) {
      try {
        const json = JSON.parse(text);
        return json?.message || json?.error || text;
      } catch {
        return text;
      }
    }

    if (res.status === 401) {
      return "Account creation is blocked because this API is secured. Ask admin to enable public registration or create the user from an authenticated admin account.";
    }

    if (res.status === 404) {
      return "Registration API not found. Please check API_BASE and backend route.";
    }

    return "Account creation failed";
  }

  function saveRememberedLogin(cleanUsername, cleanPassword) {
    try {
      if (rememberMe) {
        localStorage.setItem(
          REMEMBER_LOGIN_KEY,
          JSON.stringify({
            username: cleanUsername,
            password: cleanPassword,
            tenantSlug: loginTenantSlug,
            savedAt: new Date().toISOString(),
          })
        );
      } else {
        localStorage.removeItem(REMEMBER_LOGIN_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }

  async function syncNativePushAfterAuth(user = null) {
    if (!isMobileAppMode()) return;
    try {
      await initNativeApp();
      await flushPendingFcmToken();
      await registerMobilePushNotifications(user);

      for (const delayMs of [1000, 3000, 7000]) {
        window.setTimeout(() => {
          ensurePushTokenRegistered()
            .then(() => registerMobilePushNotifications(user))
            .then(() => flushPendingFcmToken())
            .catch((err) => console.warn("[login] delayed native push sync failed", err));
        }, delayMs);
      }
    } catch (err) {
      console.warn("[login] native push sync failed", err);
    }
  }

  function updateRememberMe(checked) {
    setRememberMe(checked);
    if (!checked) {
      try {
        localStorage.removeItem(REMEMBER_LOGIN_KEY);
      } catch {
        // ignore storage failures
      }
    }
  }

  async function performLogin(cleanUsername, cleanPassword, silent = false) {
    setError("");

    if (!loginTenantSlug) {
      setError("Select your church before signing in.");
      return;
    }

    if (!cleanUsername || !cleanPassword) {
      setError("Username and Password are required");
      return;
    }

    setLoading(true);

    try {
      const res = await login({
        usernameOrEmail: cleanUsername,
        username: cleanUsername,
        password: cleanPassword,
      }, loginTenantSlug);

      const mfaRequired = res?.mfaRequired || res?.data?.mfaRequired;
      const challengeId = res?.challengeId || res?.data?.challengeId;
      if (mfaRequired && challengeId) {
        setMfaChallengeId(challengeId);
        saveRememberedLogin(cleanUsername, cleanPassword);
        return;
      }

      const token = res?.token || res?.data?.token;
      const user = res?.user || res?.data?.user;

      if (!token) {
        throw new Error(
          "If you are a first time user, please contact Mahima Ministry Administrator to activate your ID. For all other users, check your credentials and contact admin."
        );
      }

      persistAuthSession(token, user);
      saveRememberedLogin(cleanUsername, cleanPassword);

      await syncNativePushAfterAuth(user);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(
        silent
          ? "Saved login expired. Please sign in once."
          : err.message || "Login failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitMfaCode(e) {
    e.preventDefault();
    if (!mfaCode.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await mfaLoginVerify({ challengeId: mfaChallengeId, code: mfaCode.trim() }, loginTenantSlug);
      const token = res?.token || res?.data?.token;
      const user = res?.user || res?.data?.user;
      if (!token) throw new Error("Invalid or expired code.");

      persistAuthSession(token, user);
      setMfaChallengeId(null);
      setMfaCode("");

      await syncNativePushAfterAuth(user);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid or expired code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    await performLogin(username.trim(), password, false);
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");

    if (!loginTenantSlug) {
      setError("Select your church before creating an account.");
      return;
    }

    const cleanUsername = username.trim();
    const cleanDisplayName = displayName.trim();
    const cleanPhone = normalizeIndianMobile(phone);

    const validationError = validateRegistrationForm({
      username,
      displayName,
      phone,
      password,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        username: cleanUsername,
        password,
        phone: cleanPhone,
        displayName: cleanDisplayName,
      };

      const res = await register(payload, loginTenantSlug);
      if (!res?.ok) {
        throw new Error(res?.error || "Account creation failed");
      }

      const data = res.data || {};
      const token = data?.token || data?.accessToken;
      const user = data?.user || data?.data?.user;

      if (!token) {
        await performLogin(cleanUsername, password, false);
        return;
      }

      persistAuthSession(token, user);
      saveRememberedLogin(cleanUsername, password);

      await syncNativePushAfterAuth(user);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(err.message || "Account creation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(response) {
    setError("");

    if (!loginTenantSlug) {
      setError("Select your church before signing in with Google.");
      return;
    }

    if (!response?.credential) {
      setError("Google sign-in did not return a login token.");
      return;
    }

    setLoading(true);

    try {
      const res = await googleLogin({ idToken: response.credential }, loginTenantSlug);
      if (!res?.ok) {
        throw new Error(res?.error || "Google login failed");
      }

      const data = res.data || {};
      const token = data?.token || data?.accessToken || data?.data?.token;
      const user = data?.user || data?.data?.user;

      if (!token) {
        throw new Error("Google login did not return a Mahima token.");
      }

      persistAuthSession(token, user);
      localStorage.removeItem(REMEMBER_LOGIN_KEY);

      await syncNativePushAfterAuth(user);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(err.message || "Google login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError("");

    if (!loginTenantSlug) {
      setError("Select your church before resetting a password.");
      return;
    }

    if (!username.trim()) {
      setError("Username / Email is required");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(loginTenantSlug ? { "X-Tenant-Slug": loginTenantSlug } : {}),
        },
        body: JSON.stringify({
          usernameOrEmail: username.trim(),
        }),
      });
      let msg = res.ok
        ? "If this account has an email address, a password reset link has been sent."
        : "Password reset request failed. Please try again.";
      try {
        const json = await res.json();
        if (json?.message) msg = json.message;
      } catch { /* ignore — response body may be empty */ }

      if (!res.ok) {
        setError(msg);
        return;
      }

      setForgotSent(msg);
      setMode("login");
    } catch (err) {
      setError(err.message || "Password reset failed");
    } finally {
      setLoading(false);
    }
  }

  const tenantLanding = tenantBrand?.landing || {};
  const tenantName =
    tenantBrand?.tenant?.name ||
    tenantLanding.heroTitle ||
    (loginTenantSlug ? humanizeSlug(loginTenantSlug) : "Mahima Ministry");
  const tenantLogo = resolveAsset(tenantLanding.logoUrl) || mahimaLogo;
  const tenantPrimary = tenantLanding.primaryColor || "#047857";
  const brandedActiveTab = {
    ...activeTab,
    background: `linear-gradient(180deg, ${tenantPrimary}, ${tenantPrimary})`,
  };
  const brandedButton = {
    ...button,
    background: `linear-gradient(180deg, ${tenantPrimary}, ${tenantPrimary})`,
  };

  return (
    <div className="login-experience" style={page}>
      <div className="login-stars" aria-hidden="true">
        {Array.from({ length: 28 }, (_, index) => (
          <span key={index} style={{
            "--star-size": `${2 + (index % 4)}px`,
            "--star-opacity": 0.25 + (index % 5) * 0.1,
            "--star-duration": `${8 + (index % 7) * 1.2}s`,
            "--star-delay": `${index * -0.73}s`,
            left: `${(index * 37) % 100}%`,
          }} />
        ))}
      </div>
      <div className="login-shell">
        <aside className="login-welcome">
          <span className="login-kicker">One church. One connected ministry.</span>
          <h1>Welcome back to your <span>digital church home.</span></h1>
          <p>Serve your people, coordinate your teams and keep every ministry moving together from one secure place.</p>
          <div className="login-trust-row">
            <span>Secure tenant access</span><span>Ministry tools in one place</span><span>Available anywhere</span>
          </div>
        </aside>
        <div className="login-glass-card" style={card}>
        <div style={logoSection}>
          <img src={tenantLogo} alt={tenantName} style={logo} />
          <h2 style={title}>{tenantName}</h2>
        </div>

        {mfaChallengeId ? (
          <form onSubmit={submitMfaCode} style={{ width: "100%" }}>
            <p style={subtitle}>Enter verification code</p>
            <p style={{ color: "#d1fae5", fontSize: 13, marginBottom: 16, textAlign: "left" }}>
              Enter the 6-digit code from your authenticator app to finish signing in.
            </p>
            <input
              autoFocus
              style={{ ...input, textAlign: "center", letterSpacing: 4, fontSize: 20 }}
              placeholder="000000"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              required
            />
            {error && <div style={errorBox}>{error}</div>}
            <button type="submit" style={brandedButton} disabled={loading}>
              {loading ? "Verifying..." : "Verify & Sign In"}
            </button>
            <div style={row}>
              <button
                type="button"
                style={linkButton}
                onClick={() => { setMfaChallengeId(null); setMfaCode(""); setError(""); }}
              >
                Back to login
              </button>
            </div>
          </form>
        ) : (
          <>
        <p style={subtitle}>
          {mode === "login"
            ? "Welcome back"
            : mode === "register"
            ? "Create your account"
            : "Reset your password"}
        </p>

        {(
          <label style={{ display: "grid", gap: 6, marginBottom: 14, color: "#d1fae5", fontSize: 13, fontWeight: 800 }}>
            Select your church
            <select
              value={loginTenantSlug}
              onChange={(event) => selectTenant(event.target.value)}
              disabled={tenantDirectoryLoading || Boolean(provisionedTenant && !tenantPickerUnlocked)}
              required
              style={{ ...input, marginBottom: 0, cursor: "pointer" }}
            >
              <option value="">{tenantDirectoryLoading ? "Loading churches..." : "Choose church / tenant"}</option>
              {tenantOptions.map((tenant) => (
                <option key={tenant.slug} value={tenant.slug}>
                  {tenant.name} ({tenant.slug})
                </option>
              ))}
            </select>
            {provisionedTenant && !tenantPickerUnlocked ? (
              <button
                type="button"
                onClick={() => setTenantPickerUnlocked(true)}
                style={{ justifySelf: "start", background: "none", border: "none", padding: 0, color: "#a7f3d0", fontSize: 11, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
              >
                Not your church? Tap to change
              </button>
            ) : (
              <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>
                Your selection controls church branding, landing page and user authentication.
              </span>
            )}
          </label>
        )}

        {mode !== "forgot" && (
          <div style={tabRow}>
            <button
              type="button"
              style={mode === "login" ? brandedActiveTab : tab}
              onClick={() => switchMode("login")}
            >
              Sign In
            </button>

            <button
              type="button"
              style={mode === "register" ? brandedActiveTab : tab}
              onClick={() => switchMode("register")}
            >
              Create Account
            </button>
          </div>
        )}

        {mode === "login" && googleWebClientId && !isMobileAppMode() && (
          <>
            <div ref={googleButtonRef} style={googleButtonSlot} />
            {!googleReady && (
              <button type="button" style={googleFallbackButton} disabled={loading} onClick={handleGoogleButtonClick}>
                Continue with Google
              </button>
            )}
            <div style={dividerRow}>
              <span style={dividerLine} />
              <span style={dividerText}>or</span>
              <span style={dividerLine} />
            </div>
          </>
        )}

        {mode === "login" && (!googleWebClientId || isMobileAppMode()) && (
          <>
            <button
              type="button"
              style={{
                ...googleFallbackButton,
                opacity: (!googleWebClientId && !nativeGoogleReady) ? 0.72 : 1,
                cursor: (!googleWebClientId && !nativeGoogleReady) ? "not-allowed" : "pointer",
              }}
              disabled={loading || (!googleWebClientId && !nativeGoogleReady)}
              title={isMobileAppMode() && !nativeGoogleReady ? "Native Google sign-in plugin is not installed in this APK." : "Continue with Google"}
              onClick={handleGoogleButtonClick}
            >
              {isMobileAppMode()
                ? nativeGoogleReady ? "Continue with Google" : "Google sign-in needs app plugin"
                : googleWebClientId ? "Continue with Google" : "Google sign-in not configured"}
            </button>
            <div style={dividerRow}>
              <span style={dividerLine} />
              <span style={dividerText}>or</span>
              <span style={dividerLine} />
            </div>
          </>
        )}

        <form
          onSubmit={
            mode === "login"
              ? handleLogin
              : mode === "register"
              ? handleRegister
              : handleForgot
          }
        >
          <input
            style={input}
            placeholder={mode === "register" ? "User ID" : "Username / Email"}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          {mode === "register" && (
            <>
              <input
                style={input}
                placeholder="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />

              <input
                style={input}
                type="tel"
                inputMode="numeric"
                maxLength={14}
                placeholder="Mobile Number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </>
          )}

          {mode === "forgot" && (
            <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
              Enter your root ID or email. We will send a secure, single-use reset link to the email registered on the account.
            </div>
          )}

          {mode !== "forgot" && (
            <div style={passwordWrap}>
              <input
                style={{ ...input, paddingRight: 56 }}
                type={showPwd ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                style={eyeButton}
              >
                {showPwd ? "Hide" : "Show"}
              </button>
            </div>
          )}

          {mode === "login" && (
            <label style={rememberRow}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => updateRememberMe(e.target.checked)}
                style={rememberCheck}
              />
              <span>
                Remember me on this app
                <small style={rememberHint}>Open next time without typing again</small>
              </span>
            </label>
          )}

          {mode === "login" && (
            <div style={row}>
              <button
                type="button"
                style={linkButton}
                onClick={() => switchMode("forgot")}
              >
                Forgot Password?
              </button>
            </div>
          )}

          {mode === "forgot" && (
            <div style={row}>
              <button
                type="button"
                style={linkButton}
                onClick={() => switchMode("login")}
              >
                Back to Login
              </button>
            </div>
          )}

          {forgotSent && mode === "login" && (
            <div style={successBox}>{forgotSent}</div>
          )}
          {error && <div style={errorBox}>{error}</div>}

          <button type="submit" style={brandedButton} disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Login"
              : mode === "register"
              ? "Create Account"
              : "Reset Password"}
          </button>
        </form>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

const page = {
  height: "100dvh",
  minHeight: "100vh",
  overflowY: "auto",
  background: "#06131b",
  padding: 24,
  boxSizing: "border-box",
};

const card = {
  width: "100%",
  maxWidth: 420,
  padding: 30,
  borderRadius: 24,
  background: "linear-gradient(145deg, rgba(12,27,35,.9), rgba(7,19,27,.82))",
  border: "1px solid rgba(255,255,255,.16)",
  boxShadow: "0 30px 80px rgba(0,0,0,.42)",
  textAlign: "center",
  boxSizing: "border-box",
};

const logoSection = {
  marginBottom: 15,
};

const logo = {
  width: 55,
  marginBottom: 8,
};

const title = {
  margin: 0,
  fontSize: 26,
  fontWeight: 600,
  color: "#ffffff",
};

const subtitle = {
  color: "#d1fae5",
  marginBottom: 20,
  fontSize: 18,
};

const tabRow = {
  display: "flex",
  marginBottom: 20,
  gap: 8,
};

const activeTab = {
  flex: 1,
  padding: 10,
  background: "linear-gradient(180deg, #047857, #065f46)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: "bold",
  fontSize: 16,
};

const tab = {
  flex: 1,
  padding: 10,
  background: "rgba(255,255,255,.08)",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: "bold",
  fontSize: 16,
};

const googleButtonSlot = {
  display: "flex",
  justifyContent: "center",
  minHeight: 44,
  marginBottom: 14,
};

const googleFallbackButton = {
  width: "100%",
  minHeight: 44,
  marginBottom: 14,
  border: "1px solid #dfe7ef",
  borderRadius: 8,
  background: "rgba(255,255,255,.92)",
  color: "#102033",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 15,
};

const dividerRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "0 0 14px",
};

const dividerLine = {
  flex: 1,
  height: 1,
  background: "rgba(255,255,255,.2)",
};

const dividerText = {
  color: "#d1fae5",
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
};

const input = {
  width: "100%",
  padding: 12,
  marginBottom: 12,
  borderRadius: 8,
  border: "1px solid #dfe7ef",
  background: "rgba(255,255,255,.94)",
  fontSize: 16,
  outline: "none",
  boxSizing: "border-box",
};

const passwordWrap = {
  position: "relative",
};

const eyeButton = {
  position: "absolute",
  right: 8,
  top: 8,
  height: 32,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 13,
  color: "#047857",
};

const row = {
  display: "flex",
  justifyContent: "flex-end",
  marginBottom: 10,
};

const rememberRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  textAlign: "left",
  margin: "0 0 12px",
  padding: "10px 12px",
  border: "1px solid rgba(4,120,87,0.22)",
  borderRadius: 10,
  background: "#ecfdf5",
  color: "#065f46",
  fontWeight: 700,
  fontSize: 14,
};

const rememberCheck = {
  width: 18,
  height: 18,
  accentColor: "#047857",
  flex: "0 0 auto",
};

const rememberHint = {
  display: "block",
  marginTop: 2,
  color: "#047857",
  fontWeight: 500,
  fontSize: 11,
};

const linkButton = {
  color: "#047857",
  cursor: "pointer",
  fontSize: 14,
  border: "none",
  background: "transparent",
  padding: 0,
};

const button = {
  width: "100%",
  padding: 12,
  background: "linear-gradient(180deg, #047857, #065f46)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: "bold",
  fontSize: 18,
};

const errorBox = {
  background: "#fee2e2",
  color: "#b91c1c",
  padding: 10,
  borderRadius: 8,
  marginBottom: 10,
  fontSize: 14,
};

const successBox = {
  background: "#ecfdf5",
  color: "#047857",
  border: "1px solid #a7f3d0",
  padding: 10,
  borderRadius: 8,
  marginBottom: 10,
  fontSize: 13,
  lineHeight: 1.5,
};
