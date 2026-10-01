/**
 * Native Android bootstrap for notification reliability.
 *
 * This runs outside React so Android channels, FCM registration, token storage,
 * and foreground notification mirroring are ready as early as possible.
 */

const CHAT_CHANNEL_ID = "jai-masih";
const CALL_CHANNEL_ID = "jai-masih-calls";
const GENERAL_CHANNEL_ID = "mahima-general";
const NOTIFICATION_ICON = "ic_stat_jai_masih";
const NOTIFICATION_COLOR = "#047857";
const FCM_TOKEN_KEY = "mahima_fcm_token";
const PENDING_CALL_KEY = "mahima_pending_call_notification";
const PENDING_SHARE_KEY = "mahima_pending_share_intent";

function getCapacitor() {
  try {
    return typeof window !== "undefined" ? window.Capacitor : null;
  } catch {
    return null;
  }
}

function getNativePlatform(fallback = "android") {
  try {
    return getCapacitor()?.getPlatform?.() || fallback;
  } catch {
    return fallback;
  }
}

function isNative() {
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

function getPlugin(name) {
  try {
    return getCapacitor()?.Plugins?.[name] || null;
  } catch {
    return null;
  }
}

async function waitForPlugin(name, retries = 24, delayMs = 250) {
  for (let i = 0; i <= retries; i += 1) {
    const plugin = getPlugin(name);
    if (plugin) return plugin;
    if (i < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

function readAuthToken() {
  try {
    return (
      localStorage.getItem("mahima_token") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("token") ||
      ""
    ).replace(/^Bearer\s+/i, "").trim();
  } catch {
    return "";
  }
}

function resolveApiBase() {
  try {
    const configured =
      (typeof window !== "undefined" && window.__API_BASE__) ||
      import.meta.env.VITE_API_BASE_URL ||
      "https://beta.mahimaministries.in/api";
    return String(configured).replace(/\/+$/, "");
  } catch {
    return "https://beta.mahimaministries.in/api";
  }
}

async function waitForStoredFcmToken(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const token = (() => {
      try { return localStorage.getItem(FCM_TOKEN_KEY) || window.__pendingFcmToken || ""; } catch { return ""; }
    })();
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "";
}

async function readFirebaseTokenDirectly() {
  const NativePushToken = await waitForPlugin("MahimaPushToken", 12, 250);
  if (!NativePushToken?.getToken) {
    window.__mahimaNativeTokenError = "MahimaPushToken native fallback is not available in this APK.";
    return "";
  }

  try {
    const result = await NativePushToken.getToken();
    const token = String(result?.token || result?.value || "").trim();
    if (!token) {
      window.__mahimaNativeTokenError = "Firebase returned an empty token.";
      return "";
    }

    window.__mahimaNativeTokenError = "";
    window.__mahimaLastFcmToken = token;
    await saveFcmTokenToBackend(token);
    return token;
  } catch (err) {
    window.__mahimaNativeTokenError = err?.message || String(err);
    console.warn("[initNativeApp] Native Firebase token fallback failed:", err);
    return "";
  }
}

async function readNativePendingCallIntent() {
  const NativePushToken = await waitForPlugin("MahimaPushToken", 4, 150);
  if (!NativePushToken?.getPendingCallIntent) return;

  try {
    const result = await NativePushToken.getPendingCallIntent();
    const json = String(result?.json || "").trim();
    if (!json) return;
    const data = JSON.parse(json);
    if (data?.chatId) {
      openNotificationTarget({ kind: "call", ...data });
    }
  } catch (err) {
    console.warn("[initNativeApp] Could not read pending native call intent:", err);
  }
}

async function readNativePendingShareIntent() {
  const NativePushToken = await waitForPlugin("MahimaPushToken", 4, 150);
  if (!NativePushToken?.getPendingShareIntent) return;

  try {
    const result = await NativePushToken.getPendingShareIntent();
    const json = String(result?.json || "").trim();
    if (!json) return;
    const data = JSON.parse(json);
    const text = [data?.subject, data?.text].filter(Boolean).join("\n").trim();
    if (!text) return;
    localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({
      text,
      subject: data?.subject || "",
      receivedAt: data?.receivedAt || new Date().toISOString(),
    }));
    window.location.hash = "#/home/chat?share=1";
  } catch (err) {
    console.warn("[initNativeApp] Could not read pending native share intent:", err);
  }
}

function notificationBodyFromPayload(notification, data = {}) {
  return (
    notification?.body ||
    data.body ||
    data.preview ||
    data.message ||
    "New chat message"
  );
}

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

async function showNativeTrayNotification({ title, body, channelId, data }) {
  const NativeTray = await waitForPlugin("MahimaTrayNotification", 4, 150);
  if (!NativeTray?.show) {
    window.__mahimaNativeTrayError = "MahimaTrayNotification native plugin is not available in this APK.";
    return false;
  }

  try {
    await NativeTray.show({
      id: Math.floor(Date.now() % 2147483000),
      title: title || "Jai Masih Di",
      body: body || "New message",
      channelId: channelId || CHAT_CHANNEL_ID,
      data: data || {},
    });
    window.__mahimaNativeTrayError = "";
    window.__mahimaNativeTrayShownAt = new Date().toISOString();
    return true;
  } catch (err) {
    window.__mahimaNativeTrayError = err?.message || String(err);
    console.warn("[initNativeApp] Native tray notification failed:", err);
    return false;
  }
}

async function saveFcmTokenToBackend(tokenValue) {
  const token = String(tokenValue || "").trim();
  if (!token) return false;

  try {
    localStorage.setItem(FCM_TOKEN_KEY, token);
  } catch {}

  const authToken = readAuthToken();
  if (!authToken) {
    window.__pendingFcmToken = token;
      console.info("[initNativeApp] FCM token cached until login.");
      return false;
  }

  try {
    const response = await fetch(`${resolveApiBase()}/device-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      credentials: "include",
      body: JSON.stringify({
        token,
        platform: getNativePlatform("android"),
        appVersion: import.meta.env.VITE_APP_VERSION || "4.0",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[initNativeApp] Device-token save failed:", response.status, body);
      window.__pendingFcmToken = token;
      return false;
    }

      window.__pendingFcmToken = null;
      window.__mahimaFcmTokenSavedAt = new Date().toISOString();
      console.info("[initNativeApp] FCM token saved to backend.");
      return true;
  } catch (err) {
    console.warn("[initNativeApp] Failed to save FCM token:", err);
    window.__pendingFcmToken = token;
    return false;
  }
}

const CHANNELS = [
  {
    id: CHAT_CHANNEL_ID,
    name: "Jai Masih - Chat Messages",
    description: "Real-time chat messages from the Mahima Ministry community",
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true,
    lights: true,
    lightColor: NOTIFICATION_COLOR,
  },
  {
    id: CALL_CHANNEL_ID,
    name: "Jai Masih - Calls",
    description: "Incoming Jai Masih audio and video calls",
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true,
    lights: true,
    lightColor: NOTIFICATION_COLOR,
  },
  {
    id: GENERAL_CHANNEL_ID,
    name: "Mahima Ministry - General",
    description: "Prayer requests, meeting reminders and general alerts",
    importance: 4,
    visibility: 1,
    sound: "default",
    vibration: true,
    lights: true,
    lightColor: NOTIFICATION_COLOR,
  },
];

async function createNotificationChannels() {
  const LocalNotifications = await waitForPlugin("LocalNotifications");
  if (!LocalNotifications?.createChannel) {
    console.info("[initNativeApp] LocalNotifications plugin not available; skipping channels.");
    return;
  }

  for (const channel of CHANNELS) {
    try {
      await LocalNotifications.createChannel(channel);
    } catch (err) {
      console.warn(`[initNativeApp] Channel ${channel.id} creation failed:`, err);
    }
  }

  LocalNotifications.addListener?.("localNotificationActionPerformed", (action) => {
    const data = action?.notification?.extra || action?.notification?.data || {};
    openNotificationTarget(data);
  });
}

let pushListenersAttached = false;

async function registerForPushNotifications() {
  const PushNotifications = await waitForPlugin("PushNotifications");
  if (!PushNotifications?.requestPermissions || !PushNotifications?.register) {
    console.info("[initNativeApp] PushNotifications plugin not available; skipping FCM registration.");
    return false;
  }

  if (!pushListenersAttached) {
    pushListenersAttached = true;

    PushNotifications.addListener?.("registration", (token) => {
      const tokenValue = token?.value || token?.token || token;
      if (tokenValue) {
        window.__mahimaLastFcmToken = tokenValue;
        saveFcmTokenToBackend(tokenValue);
      }
    });

    PushNotifications.addListener?.("registrationError", (err) => {
      console.error("[initNativeApp] FCM registration error:", err);
    });

    PushNotifications.addListener?.("pushNotificationReceived", async (notification) => {
      const data = notification?.data || {};
      const title = notification?.title || data.title || "Jai Masih Di";
      const body = notificationBodyFromPayload(notification, data);
      const channelId = data.kind === "call" ? CALL_CHANNEL_ID : data.kind === "message" ? CHAT_CHANNEL_ID : GENERAL_CHANNEL_ID;

      const nativeShown = await showNativeTrayNotification({
        title,
        body,
        channelId,
        data,
      });
      if (nativeShown) return;

      const LocalNotifications = getPlugin("LocalNotifications");
      if (!LocalNotifications?.schedule) return;

      try {
        if (LocalNotifications.requestPermissions) {
          const permission = await LocalNotifications.requestPermissions().catch(() => null);
          if (permission && permission.display !== "granted") return;
        }

        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.floor(Date.now() % 2147483000),
              title,
              body,
              channelId,
              sound: "default",
              smallIcon: NOTIFICATION_ICON,
              iconColor: NOTIFICATION_COLOR,
              extra: data,
            },
          ],
        });
      } catch (err) {
        console.warn("[initNativeApp] Foreground tray notification failed:", err);
      }
    });

    PushNotifications.addListener?.("pushNotificationActionPerformed", (action) => {
      const data = action?.notification?.data || {};
      openNotificationTarget(data);
    });

    window.__mahimaNativePushInitialized = true;
  }

  let permission;
  try {
    permission = await PushNotifications.requestPermissions();
  } catch (err) {
    console.warn("[initNativeApp] Push permission request failed:", err);
    return false;
  }

  if (permission?.receive !== "granted") {
    console.warn("[initNativeApp] Push notification permission not granted:", permission);
    return false;
  }

  const cachedToken = (() => {
    try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return ""; }
  })();
  if (cachedToken) saveFcmTokenToBackend(cachedToken);

  try {
    window.__mahimaFcmRegistrationAttemptAt = new Date().toISOString();
    await PushNotifications.register();
    await readFirebaseTokenDirectly();
    console.info("[initNativeApp] FCM registration requested.");
    return true;
  } catch (err) {
    console.warn("[initNativeApp] FCM register() failed:", err);
    return false;
  }
}

let initialized = false;

export async function initNativeApp() {
  if (!isNative()) return;
  if (initialized) {
    await readNativePendingCallIntent();
    await readNativePendingShareIntent();
    await registerForPushNotifications();
    await flushPendingFcmToken();
    return;
  }
  initialized = true;

  try {
    await createNotificationChannels();
    await readNativePendingCallIntent();
    await readNativePendingShareIntent();
    await registerForPushNotifications();
    console.info("[initNativeApp] Native notification initialization complete.");
  } catch (err) {
    console.error("[initNativeApp] Initialization error:", err);
    initialized = false;
  }
}

export async function flushPendingFcmToken() {
  const pending =
    window.__pendingFcmToken ||
    (() => {
      try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return ""; }
    })();

  if (!pending) return false;
  return saveFcmTokenToBackend(pending);
}

function maskToken(token) {
  const raw = String(token || "");
  if (!raw) return "";
  return raw.length <= 14 ? `${raw.length} chars` : `${raw.slice(0, 8)}...${raw.slice(-6)} (${raw.length} chars)`;
}

async function fetchDeviceTokenStatus() {
  const authToken = readAuthToken();
  if (!authToken) return { ok: false, status: 0, body: "No auth token in localStorage." };

  try {
    const response = await fetch(`${resolveApiBase()}/device-tokens/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${authToken}`, Accept: "application/json" },
      credentials: "include",
    });
    const text = await response.text().catch(() => "");
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: err?.message || String(err) };
  }
}

export async function getNotificationDiagnostics() {
  const localToken = (() => {
    try { return localStorage.getItem(FCM_TOKEN_KEY) || window.__pendingFcmToken || ""; } catch { return ""; }
  })();

  return {
    native: isNative(),
    capacitorPlatform: getNativePlatform(""),
    hasPushPlugin: Boolean(await waitForPlugin("PushNotifications", 2, 100)),
    hasLocalPlugin: Boolean(await waitForPlugin("LocalNotifications", 2, 100)),
    hasNativeTokenPlugin: Boolean(await waitForPlugin("MahimaPushToken", 2, 100)),
    hasNativeTrayPlugin: Boolean(await waitForPlugin("MahimaTrayNotification", 2, 100)),
    authTokenPresent: Boolean(readAuthToken()),
    localFcmToken: maskToken(localToken),
    nativeTokenError: window.__mahimaNativeTokenError || "",
    nativeTrayError: window.__mahimaNativeTrayError || "",
    nativeTrayShownAt: window.__mahimaNativeTrayShownAt || "",
    registrationAttemptAt: window.__mahimaFcmRegistrationAttemptAt || "",
    tokenSavedAt: window.__mahimaFcmTokenSavedAt || "",
    backendStatus: await fetchDeviceTokenStatus(),
  };
}

export async function ensurePushTokenRegistered() {
  if (!isNative()) return false;

  await createNotificationChannels();
  await registerForPushNotifications();

  const token = (await waitForStoredFcmToken(12000)) || (await readFirebaseTokenDirectly());
  if (!token) {
    console.warn("[initNativeApp] Android did not return an FCM token during ensurePushTokenRegistered.");
    return false;
  }

  return saveFcmTokenToBackend(token);
}

export async function sendLocalNotificationTest() {
  if (!isNative()) return { ok: false, stage: "native", message: "Not running inside the mobile app." };

  await createNotificationChannels();

  const nativeShown = await showNativeTrayNotification({
    title: "Jai Masih Di",
    body: "Native Android tray notification is working on this phone.",
    channelId: CHAT_CHANNEL_ID,
    data: { kind: "diagnostic" },
  });
  if (nativeShown) {
    return { ok: true, stage: "native-local", message: "Native Android tray notification posted." };
  }

  const LocalNotifications = await waitForPlugin("LocalNotifications");
  if (!LocalNotifications?.schedule) {
    return { ok: false, stage: "local-plugin", message: "LocalNotifications plugin is not available." };
  }

  if (LocalNotifications.requestPermissions) {
    const permission = await LocalNotifications.requestPermissions().catch(() => null);
    if (permission && permission.display !== "granted") {
      return { ok: false, stage: "local-permission", message: "Android notification permission is not granted." };
    }
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id: Math.floor(Date.now() % 2147483000),
        title: "Jai Masih Di",
        body: "Local tray notification is working on this phone.",
        channelId: CHAT_CHANNEL_ID,
        sound: "default",
        smallIcon: NOTIFICATION_ICON,
        iconColor: NOTIFICATION_COLOR,
        extra: { kind: "diagnostic" },
      },
    ],
  });

  return { ok: true, stage: "local", message: "Local tray notification scheduled." };
}

export async function sendBackendPushTest() {
  if (!isNative()) return { ok: false, stage: "native", message: "Not running inside the mobile app." };

  await registerForPushNotifications();
  const storedToken = (await waitForStoredFcmToken()) || (await readFirebaseTokenDirectly());
  if (!storedToken) {
    const reason = window.__mahimaNativeTokenError ? ` Native fallback: ${window.__mahimaNativeTokenError}` : "";
    return { ok: false, stage: "fcm-token", message: `Android did not return an FCM token yet. Check google-services.json and Firebase app id.${reason}` };
  }
  await flushPendingFcmToken();

  const authToken = readAuthToken();
  if (!authToken) {
    return { ok: false, stage: "auth", message: "Login token is missing, so the FCM token cannot be saved." };
  }

  const statusResponse = await fetch(`${resolveApiBase()}/device-tokens/status`, {
    method: "GET",
    headers: { Authorization: `Bearer ${authToken}`, Accept: "application/json" },
    credentials: "include",
  }).catch(() => null);

  if (statusResponse?.ok) {
    const status = await statusResponse.json().catch(() => null);
    if (status && !status.firebaseProjectConfigured) {
      return { ok: false, stage: "server-config", message: "Firebase project id is not configured on the backend." };
    }
    if (status && !status.serviceAccountConfigured) {
      return { ok: false, stage: "server-config", message: "Firebase service account is not configured on the backend." };
    }
    if (status && Number(status.savedTokens || 0) <= 0) {
      return { ok: false, stage: "server-token", message: "This phone's FCM token was not saved on the backend." };
    }
  }

  const response = await fetch(`${resolveApiBase()}/device-tokens/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    credentials: "include",
    body: JSON.stringify({ message: "Firebase push notification is working on this phone." }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, stage: "server-push", message: body || `Backend returned ${response.status}` };
  }

  return { ok: true, stage: "server-push", message: "Backend Firebase push requested." };
}

export async function runNotificationSelfTest() {
  const local = await sendLocalNotificationTest().catch((err) => ({
    ok: false,
    stage: "local-error",
    message: err?.message || String(err),
  }));

  const push = await sendBackendPushTest().catch((err) => ({
    ok: false,
    stage: "push-error",
    message: err?.message || String(err),
  }));

  const diagnostics = await getNotificationDiagnostics().catch((err) => ({
    error: err?.message || String(err),
  }));

  return { local, push, diagnostics };
}
