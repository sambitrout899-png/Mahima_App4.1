// src/utils/chatNotifications.js
//
// Cross-platform notification helpers for the Jai Masih chat:
//   - Plays a short two-tone beep / "Jai Masih" voice when a new message arrives
//   - Triggers haptic feedback on mobile (Web Vibration API + Capacitor Haptics)
//   - Persists the user's mute preference in localStorage
//   - Browser Notification API banner when the tab is hidden / unfocused
//   - Active-tab + visibility helpers so callers can decide what to play
//
// Works in:
//   * Desktop / mobile web browsers (Web Audio API + Notification API)
//   * Capacitor Android & iOS apps (Web Audio + Haptics)
//
// Usage:
//   import {
//     playReceiveSound, playSendSound, unlockAudio, preloadVoices,
//     setMuted, isMuted,
//     requestNotificationPermission, notificationsAllowed,
//     showSystemNotification, notifyIncomingMessage, notifyIncomingCall,
//     isTabActive,
//   } from "./chatNotifications";
//
import { speakText } from "./speech";
import { chatNotificationTitle } from "./chatBranding";

const STORAGE_KEY = "jm_chat_muted";
const notificationTitle = () => chatNotificationTitle();
const DEFAULT_NOTIFICATION_ICON = "";
const ANDROID_NOTIFICATION_ICON = "ic_stat_jai_masih";

let audioCtx = null;
function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { audioCtx = new Ctor(); } catch { audioCtx = null; }
  }
  return audioCtx;
}

/* ---------- audio unlock + voices preload ---------------------------- */

let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export function preloadVoices() {
  try {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.getVoices();
    synth.onvoiceschanged = () => synth.getVoices();
  } catch { /* ignore */ }
}

/* ---------- mute pref ------------------------------------------------ */

export function isMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; }
  catch { return false; }
}

export function setMuted(value) {
  try { localStorage.setItem(STORAGE_KEY, value ? "1" : "0"); } catch {}
}

/* ---------- tones + voice ------------------------------------------- */

function playBeep() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const tones = [
    { freq: 880, start: 0.00, dur: 0.10 },
    { freq: 1320, start: 0.12, dur: 0.12 },
  ];

  for (const { freq, start, dur } of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.18, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.05);
  }
}

function buzz() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([40, 30, 40]);
    }
  } catch { /* ignore */ }

  try {
    const cap = (typeof window !== "undefined" && window.Capacitor) || null;
    const haptics = cap?.Plugins?.Haptics;
    if (haptics?.impact) {
      haptics.impact({ style: "LIGHT" }).catch?.(() => {});
    }
  } catch { /* ignore */ }
}

function speakJaiMasih() {
  if (typeof window === "undefined") return false;
  if (window.Capacitor?.Plugins?.TextToSpeech?.speak && window.Capacitor?.isNativePlatform?.()) {
    return speakText(notificationTitle(), { lang: notificationTitle() === "Jai Masih Di" ? "hi-IN" : "en-US", rate: 0.95, maxLength: 80 });
  }

  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;

  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(notificationTitle());
    u.rate = 0.95;
    u.pitch = 1.05;
    u.volume = 1.0;

    const voices = synth.getVoices() || [];
    const preferred =
      voices.find((v) => /hi-IN/i.test(v.lang)) ||
      voices.find((v) => /en-IN/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang));
    if (preferred) u.voice = preferred;
    u.lang = preferred?.lang || "en-IN";

    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

/* ---------- focus / visibility helpers ------------------------------ */

export function isTabActive() {
  if (typeof document === "undefined") return true;
  const visible = !document.hidden;
  const focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  return visible && focused;
}

export function isTypingInChat() {
  if (typeof document === "undefined") return false;
  return /^(INPUT|TEXTAREA)$/i.test(document.activeElement?.tagName || "");
}

/* ---------- browser Notification API -------------------------------- */

export function notificationsSupported() {
  return typeof window !== "undefined"
    && typeof window.Notification !== "undefined";
}

export function notificationsAllowed() {
  if (!notificationsSupported()) return false;
  return window.Notification.permission === "granted";
}

// ── LocalNotifications plugin access via Capacitor WebView bridge ─────────────
// The plugin is registered in capacitor.plugins.json and available on the bridge.
// No ESM import needed — dynamic imports of @capacitor/* packages fail at build
// time when they're not installed as npm packages (they ship as native plugins).

function getLocalNotifications() {
  try {
    return (typeof window !== "undefined" && window.Capacitor?.Plugins?.LocalNotifications) || null;
  } catch {
    return null;
  }
}

// Async wrapper — waits briefly for the bridge to initialize if needed
async function getLocalNotificationsPlugin() {
  let ln = getLocalNotifications();
  if (ln) return ln;
  // Bridge may not be ready on the very first call — retry a few times
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 200));
    ln = getLocalNotifications();
    if (ln) return ln;
  }
  return null;
}

// ── Channel + permission state ─────────────────────────────────────────────────

let _channelEnsured = false;
let _permissionChecked = false;
let _permissionGranted = false;

async function ensureNativeReady() {
  const ln = await getLocalNotificationsPlugin();
  if (!ln) return null; // not in a native context

  // 1. Create channel (idempotent)
  if (!_channelEnsured && ln.createChannel) {
    try {
      await ln.createChannel({
        id: "jai-masih",
        name: "Jai Masih – Chat Messages",
        importance: 5,
        visibility: 1,
        sound: "default",
        vibration: true,
        lights: true,
        lightColor: "#047857",
      });
      _channelEnsured = true;
    } catch (err) {
      console.warn("[chatNotifications] createChannel failed:", err);
    }
  }

  // 2. Check / request permission — only do this once
  if (!_permissionChecked) {
    _permissionChecked = true;
    try {
      // First check existing permission without prompting
      if (ln.checkPermissions) {
        const current = await ln.checkPermissions();
        if (current?.display === "granted") {
          _permissionGranted = true;
        } else if (ln.requestPermissions) {
          // Show the OS dialog
          const result = await ln.requestPermissions();
          _permissionGranted = result?.display === "granted";
        }
      } else if (ln.requestPermissions) {
        const result = await ln.requestPermissions();
        _permissionGranted = result?.display === "granted";
      } else {
        // Plugin exists but no permission API — assume granted (older Android)
        _permissionGranted = true;
      }
    } catch (err) {
      console.warn("[chatNotifications] permission check failed:", err);
      // Attempt to schedule anyway — Android < 13 doesn't need explicit permission
      _permissionGranted = true;
    }
  }

  return _permissionGranted ? ln : null;
}

// Returns true if the native tray notification was scheduled, false otherwise.
async function scheduleNativeNotification(title, options = {}) {
  const { body = "", tag, data } = options;

  try {
    const ln = await ensureNativeReady();
    if (!ln?.schedule) return false;

    await ln.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 2147483000),
        title,
        body,
        channelId: "jai-masih",
        sound: "default",
        smallIcon: ANDROID_NOTIFICATION_ICON,
        iconColor: "#047857",
        extra: { tag, ...(data || {}) },
      }],
    });
    return true;
  } catch (err) {
    console.warn("[chatNotifications] native notification failed:", err);
    return false;
  }
}

let permissionPromise = null;
export function requestNotificationPermission() {
  if (!notificationsSupported()) return Promise.resolve("unsupported");
  if (window.Notification.permission === "granted") return Promise.resolve("granted");
  if (window.Notification.permission === "denied") return Promise.resolve("denied");
  if (permissionPromise) return permissionPromise;
  try {
    permissionPromise = Promise.resolve(window.Notification.requestPermission())
      .then((result) => {
        permissionPromise = null;
        return result;
      })
      .catch(() => {
        permissionPromise = null;
        return "default";
      });
  } catch {
    permissionPromise = Promise.resolve("default");
  }
  return permissionPromise;
}

/**
 * Show a system (OS-level) notification. Caller passes onClick to focus the
 * window and open the right chat. Returns the Notification (or null).
 */
export function showSystemNotification(title, options = {}) {
  if (isMuted()) return null;
  // Foreground Firebase pushes arrive inside the WebView. Mirror them into
  // Android/iOS local notifications so the message still appears in the tray.
  scheduleNativeNotification(title, options).catch(() => {});

  if (!notificationsSupported() || !notificationsAllowed()) return null;
  try {
    const {
      body = "",
      icon = DEFAULT_NOTIFICATION_ICON,
      tag,                  // e.g. "chat:<chatId>" ? replaces previous notif for same chat
      data,
      requireInteraction = false,
      silent = false,
      onClick,
    } = options;

    const n = new window.Notification(title, {
      body,
      icon,
      tag,
      data,
      requireInteraction,
      silent,
    });

    n.onclick = (ev) => {
      try { ev?.preventDefault?.(); } catch {}
      try { window.focus(); } catch {}
      try { onClick && onClick(ev); } catch {}
      try { n.close(); } catch {}
    };

    // Auto-close after 8s unless requireInteraction.
    if (!requireInteraction) {
      setTimeout(() => { try { n.close(); } catch {} }, 8000);
    }

    return n;
  } catch (err) {
    console.warn("[chatNotifications] showSystemNotification failed", err);
    return null;
  }
}

/* ---------- public message / call notifiers -------------------------- */

/**
 * Notify the user that a new message arrived in some chat.
 *   - In-tab (focused): voice + light buzz
 *   - Tab open but unfocused / hidden: system banner + beep + buzz
 *   - User typing in the open chat: just a buzz (don't talk over them)
 *
 * @param {object} opts
 *   - chatId, senderName, preview, onClick (focus + open chat callback)
 */
export async function notifyIncomingMessage({
  chatId,
  senderName = "New message",
  preview = "",
  onClick,
} = {}) {
  if (isMuted()) return;

  const body = preview
    ? `${senderName}: ${String(preview).slice(0, 120)}`
    : "New chat message";

  // Always attempt the native tray notification first.
  // scheduleNativeNotification returns false if the Capacitor plugin isn't
  // available (i.e. running in a plain web browser, not in the Android app).
  const nativeOk = await scheduleNativeNotification(notificationTitle(), {
    body,
    tag: chatId ? `chat:${chatId}` : undefined,
    data: { kind: "message", chatId },
  });

  // Sound + haptics — always play unless user is actively typing
  if (!isTypingInChat()) {
    if (!speakJaiMasih()) playBeep();
  }
  buzz();

  // Web-only fallback: browser Notification API banner when tab is not active
  if (!nativeOk && !isTabActive()) {
    showSystemNotification(notificationTitle(), {
      body,
      tag: chatId ? `chat:${chatId}` : undefined,
      data: { kind: "message", chatId },
      onClick,
    });
  }
}

/**
 * Notify the user of an incoming call. Persistent banner with caller name.
 *
 * @param {object} opts
 *   - chatId, callerName, type ("audio"|"video"), onClick (accept/focus)
 */
export async function notifyIncomingCall({
  chatId,
  callerName = "Incoming call",
  type = "audio",
  onClick,
} = {}) {
  if (isMuted()) {
    buzz(); // even when muted, vibrate for calls
    return;
  }

  // Always ring + buzz — calls are important.
  if (!speakJaiMasih()) playBeep();
  buzz();

  // Try native tray notification first; fall back to browser API
  const nativeOk = await scheduleNativeNotification(notificationTitle(), {
    body: `${callerName}: incoming ${type} call. Tap to answer.`,
    tag: chatId ? `call:${chatId}` : "call",
    data: { kind: "call", chatId, type },
  });

  if (!nativeOk && !isTabActive()) {
    showSystemNotification(notificationTitle(), {
      body: `${callerName}: incoming ${type} call. Tap to answer.`,
      tag: chatId ? `call:${chatId}` : "call",
      data: { kind: "call", chatId, type },
      requireInteraction: true,
      onClick,
    });
  }
}

/* ---------- legacy aliases (don't break old callers) ----------------- */

export function playReceiveSound() {
  if (isMuted()) return;
  if (isTabActive() && isTypingInChat()) { buzz(); return; }
  if (!speakJaiMasih()) playBeep();
  buzz();
}

export function playSendSound() {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}
