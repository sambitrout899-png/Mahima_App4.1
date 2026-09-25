import { apiFetch } from "./fetch-auth-shim";
import { getToken } from "./auth";
import { showSystemNotification } from "./chatNotifications";

const FCM_TOKEN_KEY = "mahima_fcm_token";
const PENDING_CALL_KEY = "mahima_pending_call_notification";

let registrationStarted = false;
let listenersAttached = false;

function openNotificationTarget(data = {}) {
  if (data.kind === "call" && data.chatId) {
    try {
      localStorage.setItem(PENDING_CALL_KEY, JSON.stringify({
        chatId: data.chatId,
        callerId: data.callerId || data.fromUserId || "",
        callerName: data.callerName || "",
        callType: data.callType || data.type || "audio",
        tappedAt: new Date().toISOString(),
      }));
    } catch {}
    window.location.hash = `#/home/chat?call=1&chatId=${encodeURIComponent(data.chatId)}`;
    return;
  }

  if (data.chatId || data.kind === "message") {
    window.location.hash = data.chatId
      ? `#/home/chat?chatId=${encodeURIComponent(data.chatId)}`
      : "#/home/chat";
  }
}

function getCapacitor() {
  try {
    return typeof window !== "undefined" ? window.Capacitor : null;
  } catch {
    return null;
  }
}

function getNativePlatform(fallback = "mobile") {
  try {
    return getCapacitor()?.getPlatform?.() || fallback;
  } catch {
    return fallback;
  }
}

function isNativeApp() {
  try {
    const cap = getCapacitor();
    return (
      import.meta.env.MODE === "mobile" ||
      Boolean(cap?.isNativePlatform?.()) ||
      window.location?.protocol === "capacitor:"
    );
  } catch {
    return false;
  }
}

function currentUserId(user) {
  if (user?.id || user?.Id || user?.userId) return user.id || user.Id || user.userId;
  try {
    const raw = localStorage.getItem("mahima_user") || localStorage.getItem("user") || "{}";
    const parsed = JSON.parse(raw);
    return parsed?.id || parsed?.Id || parsed?.userId || null;
  } catch {
    return null;
  }
}

async function resolvePushPlugin() {
  return getCapacitor()?.Plugins?.PushNotifications || null;
}

async function saveDeviceToken(pushToken, user) {
  const tokenValue = String(pushToken?.value || pushToken?.token || pushToken || "").trim();
  if (!tokenValue) return false;

  try {
    localStorage.setItem(FCM_TOKEN_KEY, tokenValue);
  } catch {}

  if (!getToken()) {
    window.__pendingFcmToken = tokenValue;
    return false;
  }

  return apiFetch("/device-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: tokenValue,
      platform: getNativePlatform("mobile"),
      appVersion: import.meta.env.VITE_APP_VERSION || "4.0",
      userId: currentUserId(user),
    }),
  })
    .then(() => {
      window.__pendingFcmToken = null;
      return true;
    })
    .catch((err) => {
      window.__pendingFcmToken = tokenValue;
      console.warn("[push] device token registration failed", err);
      return false;
    });
}

export async function registerMobilePushNotifications(user = null) {
  if (!isNativeApp()) return false;

  const cachedToken = (() => {
    try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return ""; }
  })();
  if (cachedToken && getToken()) {
    await saveDeviceToken(cachedToken, user);
  }

  const PushNotifications = await resolvePushPlugin();
  if (!PushNotifications?.requestPermissions || !PushNotifications?.register) {
    console.warn("[push] Capacitor PushNotifications plugin is not installed in this build.");
    return false;
  }

  if (!listenersAttached) {
    listenersAttached = true;

    PushNotifications.addListener?.("registration", (token) => {
      saveDeviceToken(token, user);
    });

    PushNotifications.addListener?.("registrationError", (err) => {
      console.warn("[push] registration error", err);
      registrationStarted = false;
    });

    PushNotifications.addListener?.("pushNotificationReceived", (notification) => {
      if (window.__mahimaNativePushInitialized) return;
      const data = notification?.data || {};
      showSystemNotification("Jai Masih Di", {
        body: notification?.body || data.preview || data.message || "New chat message",
        tag: data.chatId ? `chat:${data.chatId}` : undefined,
        data: { kind: "message", ...data },
      });
    });

    PushNotifications.addListener?.("pushNotificationActionPerformed", (action) => {
      const data = action?.notification?.data || {};
      openNotificationTarget(data);
    });
  }

  const permission = await PushNotifications.requestPermissions().catch((err) => {
    console.warn("[push] permission request failed", err);
    return null;
  });

  if (permission?.receive !== "granted") {
    console.warn("[push] notification permission not granted", permission);
    return false;
  }

  try {
    registrationStarted = true;
    window.__mahimaFcmRegistrationAttemptAt = new Date().toISOString();
    await PushNotifications.register();
    return true;
  } catch (err) {
    registrationStarted = false;
    console.warn("[push] register failed", err);
    return false;
  }
}
