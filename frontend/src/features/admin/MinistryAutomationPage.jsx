import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BellRing,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  Play,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import { API_BASE } from "../../api";
import { apiFetch } from "../../utils/fetch-auth-shim";

const defaults = {
  enabled: true,
  timeZone: "Asia/Kolkata",
  dailyWordTime: "06:30",
  welcomeTime: "07:00",
  nightPrayerTime: "18:30",
  sundayServiceReminderTime: "08:00",
  sundayServiceReminderChannels: ["jai-masih"],
  sundayServiceReminderWhatsAppTemplateSid: "",
  deliveryWindowMinutes: 90,
  dailyWordEnabled: true,
  welcomeEnabled: true,
  nightPrayerEnabled: true,
  sundayServiceReminderEnabled: true,
};

const messageTypes = [
  { key: "daily-word", label: "Daily Word", desc: "Fresh Bible verse, reflection, and prayer.", field: "dailyWordTime", enabled: "dailyWordEnabled" },
  { key: "welcome", label: "Welcome", desc: "Morning welcome and blessing.", field: "welcomeTime", enabled: "welcomeEnabled" },
  { key: "night-prayer", label: "Night Prayer", desc: "Tuesday and Friday night prayer reminder at 6:30 PM.", field: "nightPrayerTime", enabled: "nightPrayerEnabled" },
  { key: "sunday-service-reminder", label: "Sunday Church Reminder", desc: "Every Sunday at 8:00 AM to all members (in the selected time zone).", field: "sundayServiceReminderTime", enabled: "sundayServiceReminderEnabled" },
];

const fallbackLanguages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "hi", name: "Hindi", nativeName: "Hindi" },
  { code: "pa", name: "Punjabi", nativeName: "Punjabi" },
];

const pastorModes = {
  en: { label: "English Pastor", language: "en", persona: "english-evangelist" },
  hi: { label: "Hindi Pastor", language: "hi", persona: "hindi-pastoral-guide" },
};

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateInput(date);
}

function StatusPill({ enabled }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      {enabled ? "Active" : "Paused"}
    </span>
  );
}

function welcomeUserName(user) {
  const candidates = [user?.displayName, user?.name, user?.username, user?.email]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const visible = candidates.find((value) => !/^deleted\s+user$/i.test(value));
  return visible || "New member";
}

function welcomeUserInitials(user) {
  return welcomeUserName(user)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

export default function MinistryAutomationPage() {
  const [settings, setSettings] = useState(defaults);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState("");
  const [question, setQuestion] = useState("");
  const [pastorReply, setPastorReply] = useState("");
  const [pastorMode, setPastorMode] = useState("en");
  const [sendToJaiMasih, setSendToJaiMasih] = useState(true);
  const [asking, setAsking] = useState(false);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [customMessages, setCustomMessages] = useState({});
  const [languages, setLanguages] = useState(fallbackLanguages);
  const [selectedLanguageCodes, setSelectedLanguageCodes] = useState(["en", "hi", "pa"]);
  const [customSending, setCustomSending] = useState(false);
  const [welcomeRange, setWelcomeRange] = useState({ from: dateDaysAgo(30), to: toDateInput(new Date()) });
  const [welcomeAnalytics, setWelcomeAnalytics] = useState(null);
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const [welcomeDraft, setWelcomeDraft] = useState("");
  const [welcomeDrafting, setWelcomeDrafting] = useState(false);
  const [welcomeSending, setWelcomeSending] = useState(false);
  const [selectedWelcomeUserIds, setSelectedWelcomeUserIds] = useState([]);

  const activeCount = useMemo(
    () => messageTypes.filter((item) => settings[item.enabled]).length,
    [settings]
  );

  const selectedLanguages = useMemo(
    () => languages.filter((language) => selectedLanguageCodes.includes(language.code)),
    [languages, selectedLanguageCodes]
  );

  const customHasMessage = useMemo(
    () => selectedLanguageCodes.some((code) => (customMessages[code] || "").trim()),
    [customMessages, selectedLanguageCodes]
  );

  const pendingWelcomeUsers = welcomeAnalytics?.pendingUsers || [];
  const welcomeMonthPoints = welcomeAnalytics?.byMonth || [];
  const welcomeMonthMax = Math.max(1, ...welcomeMonthPoints.map((point) => Number(point.count) || 0));
  const selectedWelcomeCount = selectedWelcomeUserIds.length;

  async function load() {
    setLoading(true);
    setNotice("");
    try {
      const [settingsData, runsData, languagesData] = await Promise.all([
        apiFetch("/ministry-automation/settings"),
        apiFetch("/ministry-automation/runs"),
        apiFetch("/languages").catch(() => fallbackLanguages),
      ]);
      setSettings({
        ...defaults,
        ...(settingsData || {}),
        nightPrayerTime: settingsData?.nightPrayerTime === "21:30" ? "18:30" : (settingsData?.nightPrayerTime || defaults.nightPrayerTime),
      });
      setRuns(Array.isArray(runsData) ? runsData : []);
      const enabledLanguages = Array.isArray(languagesData) && languagesData.length > 0
        ? languagesData
        : fallbackLanguages;
      setLanguages(enabledLanguages);
      setSelectedLanguageCodes((current) => {
        const available = new Set(enabledLanguages.map((language) => language.code));
        const retained = current.filter((code) => available.has(code));
        if (retained.length > 0) return retained;
        const preferred = ["en", "hi", "pa"].filter((code) => available.has(code));
        return preferred.length > 0 ? preferred : enabledLanguages.slice(0, 1).map((language) => language.code);
      });
    } catch (err) {
      setNotice(err.message || "Could not load automation settings.");
    } finally {
      setLoading(false);
    }
  }

  async function loadWelcomeAnalytics(range = welcomeRange) {
    setWelcomeLoading(true);
    try {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      const data = await apiFetch(`/ministry-automation/new-user-welcome/analytics?${params.toString()}`);
      setWelcomeAnalytics(data || null);
      const ids = Array.isArray(data?.pendingUsers) ? data.pendingUsers.map((user) => user.id) : [];
      setSelectedWelcomeUserIds(ids);
    } catch (err) {
      setNotice(err.message || "Could not load new-user welcome analytics.");
    } finally {
      setWelcomeLoading(false);
    }
  }

  function setWelcomeQuickRange(days) {
    setWelcomeRange({ from: dateDaysAgo(days), to: toDateInput(new Date()) });
    setWelcomeDraft("");
  }

  function toggleWelcomeUser(id) {
    setSelectedWelcomeUserIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function generateWelcomeDraft() {
    const targetIds = selectedWelcomeUserIds.length > 0
      ? selectedWelcomeUserIds
      : pendingWelcomeUsers.map((user) => user.id);

    setWelcomeDrafting(true);
    setNotice("");
    try {
      const data = await apiFetch("/ministry-automation/new-user-welcome/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: welcomeRange.from,
          to: welcomeRange.to,
          languages: selectedLanguageCodes,
          userIds: targetIds,
        }),
      });
      setWelcomeDraft(data?.message || "");
      const ids = Array.isArray(data?.users) ? data.users.map((user) => user.id) : targetIds;
      setSelectedWelcomeUserIds(ids);
      setNotice(data?.count > 0 ? `AI Counseller welcome draft is ready for ${data.count} new users.` : "No pending new users found for this range.");
    } catch (err) {
      setNotice(err.message || "Could not generate AI Counseller welcome draft.");
    } finally {
      setWelcomeDrafting(false);
    }
  }

  async function approveWelcomeDraft() {
    if (!welcomeDraft.trim() || selectedWelcomeUserIds.length === 0) return;
    setWelcomeSending(true);
    setNotice("");
    try {
      await apiFetch("/ministry-automation/new-user-welcome/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: welcomeRange.from,
          to: welcomeRange.to,
          languages: selectedLanguageCodes,
          userIds: selectedWelcomeUserIds,
          message: welcomeDraft,
        }),
      });
      setWelcomeDraft("");
      await Promise.all([loadWelcomeAnalytics(), load()]);
      setNotice(`Approved welcome sent to Jai Masih for ${selectedWelcomeUserIds.length} new users.`);
    } catch (err) {
      setNotice(err.message || "Could not approve and send the welcome message.");
    } finally {
      setWelcomeSending(false);
    }
  }

  function toggleLanguage(code) {
    setSelectedLanguageCodes((current) => {
      if (current.includes(code)) {
        return current.length === 1 ? current : current.filter((item) => item !== code);
      }
      return [...current, code];
    });
  }

  function setCustomMessageFor(code, value) {
    setCustomMessages((current) => ({ ...current, [code]: value }));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadWelcomeAnalytics();
  }, [welcomeRange.from, welcomeRange.to]);

  function update(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const saved = await apiFetch("/ministry-automation/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSettings({ ...defaults, ...(saved || settings) });
      setNotice("Schedule saved. The background service will use these timings.");
    } catch (err) {
      setNotice(err.message || "Could not save schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function trigger(type) {
    setTriggering(type);
    setNotice("");
    try {
      const result = await apiFetch("/ministry-automation/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageType: type, languages: selectedLanguageCodes }),
      });
      await load();
      setNotice(result?.errors?.length ? `Some deliveries failed: ${result.errors.join("; ")}` : "Message sent using the saved channels.");
    } catch (err) {
      setNotice(err.message || "Could not send message.");
    } finally {
      setTriggering("");
    }
  }

  async function sendCustomMessage() {
    const messages = Object.fromEntries(
      selectedLanguageCodes
        .map((code) => [code, (customMessages[code] || "").trim()])
        .filter(([, value]) => value)
    );
    if (Object.keys(messages).length === 0) return;
    setCustomSending(true);
    setNotice("");
    try {
      await apiFetch("/ministry-automation/custom-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          languages: selectedLanguageCodes,
          messages,
          message: messages.en || Object.values(messages)[0] || "",
        }),
      });
      setCustomMessages({});
      setNotice("Custom Jai Masih message sent to all users.");
      await load();
    } catch (err) {
      setNotice(err.message || "Could not send custom message.");
    } finally {
      setCustomSending(false);
    }
  }

  async function askPastor() {
    if (!question.trim()) return;
    setAsking(true);
    setNotice("");
    try {
      const data = await apiFetch("/pastorbot/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          sendToJaiMasih,
          language: pastorModes[pastorMode].language,
          persona: pastorModes[pastorMode].persona,
        }),
      });
      setPastorReply(data?.answer || "");
      setNotice(sendToJaiMasih ? "Pastor message sent to Jai Masih." : "Pastor reply generated.");
    } catch (err) {
      setNotice(err.message || "Pastor bot could not reply.");
    } finally {
      setAsking(false);
    }
  }

  async function uploadVoiceSample(file) {
    if (!file) return;
    setVoiceUploading(true);
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const token = localStorage.getItem("mahima_token") || "";
      const response = await fetch(`${API_BASE}/pastorbot/voice-sample`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      setNotice("Voice sample uploaded for the pastor bot.");
    } catch (err) {
      setNotice(err.message || "Could not upload voice sample.");
    } finally {
      setVoiceUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea] px-5 py-8 text-slate-950 md:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-amber-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-800">
              <CalendarClock className="h-4 w-4" />
              Jai Masih Automation
            </div>
            <h1 className="text-4xl font-black tracking-normal text-slate-950">Ministry Message Center</h1>
            <p className="mt-2 max-w-3xl text-lg text-slate-600">
              Schedule daily word, welcome, night prayer, Sunday service reminders, and pastor bot messages from one admin panel.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 text-base font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            Save Schedule
          </button>
        </header>

        {notice && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-amber-900 shadow-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            {notice}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">Automation</div>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-2xl font-black">{settings.enabled ? "Running" : "Paused"}</span>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => update("enabled", e.target.checked)}
                className="h-6 w-6 accent-emerald-700"
              />
            </label>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">Active Timers</div>
            <div className="mt-3 text-4xl font-black">{activeCount}/4</div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <label className="text-sm font-semibold text-slate-500">Time Zone</label>
            <input
              value={settings.timeZone}
              onChange={(e) => update("timeZone", e.target.value)}
              className="mt-3 w-full rounded-xl border border-amber-200 px-3 py-3 font-semibold outline-none focus:border-emerald-600"
            />
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <label className="text-sm font-semibold text-slate-500">Delivery Window</label>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="number"
                min="1"
                max="720"
                value={settings.deliveryWindowMinutes}
                onChange={(e) => update("deliveryWindowMinutes", Number(e.target.value))}
                className="w-28 rounded-xl border border-amber-200 px-3 py-3 font-semibold outline-none focus:border-emerald-600"
              />
              <span className="font-semibold text-slate-600">minutes</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black">Broadcast Languages</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Pick the languages to include in Jai Masih sends. Add or disable languages from Admin Languages.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {languages.map((language) => {
                const active = selectedLanguageCodes.includes(language.code);
                return (
                  <button
                    key={language.code}
                    type="button"
                    onClick={() => toggleLanguage(language.code)}
                    className={`rounded-full border px-4 py-2 text-sm font-black ${
                      active
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}
                  >
                    {language.name || language.code.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-800">
                <UserPlus className="h-4 w-4" />
                New Joiner Welcome Control
              </div>
              <h2 className="mt-3 text-2xl font-black">AI Counseller welcome approval</h2>
              <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">
                Analyze new members by period, generate a pastor welcome draft, review it here, then approve the Jai Masih send.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setWelcomeQuickRange(7)} className="rounded-full border border-amber-200 px-4 py-2 text-sm font-black text-amber-900 hover:bg-amber-50">7 days</button>
              <button type="button" onClick={() => setWelcomeQuickRange(30)} className="rounded-full border border-amber-200 px-4 py-2 text-sm font-black text-amber-900 hover:bg-amber-50">30 days</button>
              <button type="button" onClick={() => setWelcomeQuickRange(90)} className="rounded-full border border-amber-200 px-4 py-2 text-sm font-black text-amber-900 hover:bg-amber-50">Quarter</button>
              <button type="button" onClick={() => setWelcomeQuickRange(365)} className="rounded-full border border-amber-200 px-4 py-2 text-sm font-black text-amber-900 hover:bg-amber-50">Year</button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="block">
              <span className="text-sm font-black text-slate-600">From</span>
              <input
                type="date"
                value={welcomeRange.from}
                onChange={(e) => {
                  setWelcomeRange((current) => ({ ...current, from: e.target.value }));
                  setWelcomeDraft("");
                }}
                className="mt-2 w-full rounded-xl border border-amber-200 px-3 py-3 font-semibold outline-none focus:border-emerald-600"
              />
            </label>
            <label className="block">
              <span className="text-sm font-black text-slate-600">To</span>
              <input
                type="date"
                value={welcomeRange.to}
                onChange={(e) => {
                  setWelcomeRange((current) => ({ ...current, to: e.target.value }));
                  setWelcomeDraft("");
                }}
                className="mt-2 w-full rounded-xl border border-amber-200 px-3 py-3 font-semibold outline-none focus:border-emerald-600"
              />
            </label>
            <button
              type="button"
              onClick={() => loadWelcomeAnalytics()}
              disabled={welcomeLoading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 font-black text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
            >
              {welcomeLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BarChart3 className="h-5 w-5" />}
              Analyze
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Selected", welcomeAnalytics?.totals?.selected ?? 0],
              ["Pending", welcomeAnalytics?.totals?.pending ?? 0],
              ["This Week", welcomeAnalytics?.totals?.thisWeek ?? 0],
              ["This Month", welcomeAnalytics?.totals?.thisMonth ?? 0],
              ["This Year", welcomeAnalytics?.totals?.thisYear ?? 0],
              ["All Time", welcomeAnalytics?.totals?.allTime ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                <div className="text-xs font-black uppercase text-amber-800">{label}</div>
                <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.1fr]">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-black text-slate-900">
                  <Users className="h-5 w-5 text-emerald-700" />
                  Pending New Users
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWelcomeUserIds(pendingWelcomeUsers.map((user) => user.id))}
                  className="text-sm font-black text-emerald-700"
                >
                  Select all
                </button>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {pendingWelcomeUsers.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">
                    No pending new users in this period.
                  </div>
                )}
                {pendingWelcomeUsers.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-3 shadow-sm">
                    <input
                      type="checkbox"
                      checked={selectedWelcomeUserIds.includes(user.id)}
                      onChange={() => toggleWelcomeUser(user.id)}
                      className="h-5 w-5 accent-emerald-700"
                    />
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-sm font-black text-emerald-800">
                      {welcomeUserInitials(user)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-black text-slate-900">{welcomeUserName(user)}</span>
                      <span className="block text-xs font-semibold text-slate-500">
                        Joined {user.joinDate ? new Date(user.joinDate).toLocaleDateString() : "-"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2 font-black text-slate-900">
                <BarChart3 className="h-5 w-5 text-emerald-700" />
                Monthly Joiner Trend
              </div>
              <div className="space-y-3">
                {welcomeMonthPoints.slice(-8).map((point) => (
                  <div key={point.month || point.label} className="grid grid-cols-[90px_1fr_42px] items-center gap-3">
                    <div className="text-sm font-bold text-slate-600">{point.label}</div>
                    <div className="h-3 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${Math.max(8, ((Number(point.count) || 0) / welcomeMonthMax) * 100)}%` }}
                      />
                    </div>
                    <div className="text-right text-sm font-black text-slate-900">{point.count}</div>
                  </div>
                ))}
                {welcomeMonthPoints.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">
                    No joiner history available yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 font-black text-emerald-950">
                  <Wand2 className="h-5 w-5" />
                  Reviewable AI Counseller Draft
                </div>
                <p className="mt-1 text-sm font-semibold text-emerald-900">
                  {selectedWelcomeCount} selected for approval. Edit the message before sending if needed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={generateWelcomeDraft}
                  disabled={welcomeDrafting || selectedWelcomeCount === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {welcomeDrafting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                  Generate Draft
                </button>
                <button
                  type="button"
                  onClick={approveWelcomeDraft}
                  disabled={welcomeSending || selectedWelcomeCount === 0 || !welcomeDraft.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {welcomeSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                  Approve & Send
                </button>
              </div>
            </div>
            <textarea
              value={welcomeDraft}
              onChange={(e) => setWelcomeDraft(e.target.value)}
              rows={8}
              maxLength={12000}
              placeholder="Generate an AI Counseller welcome draft for the selected new users..."
              className="mt-4 w-full rounded-2xl border border-emerald-200 bg-white px-4 py-4 text-base font-semibold leading-7 outline-none focus:border-emerald-700"
            />
            <div className="mt-1 text-right text-xs font-bold text-emerald-900">{welcomeDraft.length}/12000</div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {messageTypes.map((item) => (
            <div key={item.key} className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
                    <BellRing className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-black">{item.label}</h2>
                      <StatusPill enabled={settings[item.enabled]} />
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-500">{item.desc}</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings[item.enabled]}
                  onChange={(e) => update(item.enabled, e.target.checked)}
                  className="h-6 w-6 accent-emerald-700"
                />
              </div>

              {item.key === "sunday-service-reminder" && (
                <fieldset className="mt-4 rounded-xl border border-emerald-100 p-3">
                  <legend className="px-1 text-sm font-bold">Communication channels</legend>
                  <div className="flex flex-wrap gap-4">
                    {[["jai-masih", "Jai Masih"], ["sms", "SMS"], ["whatsapp", "WhatsApp"], ["email", "Email"]].map(([channel, label]) => (
                      <label key={channel} className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" className="accent-emerald-700"
                          checked={settings.sundayServiceReminderChannels.includes(channel)}
                          onChange={(e) => update("sundayServiceReminderChannels", e.target.checked
                            ? [...settings.sundayServiceReminderChannels, channel]
                            : settings.sundayServiceReminderChannels.filter((value) => value !== channel))} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Jai Masih is selected by default. Enable other channels after configuring SMS/WhatsApp and email providers. Save settings before sending a test to all members.</p>
                  {settings.sundayServiceReminderChannels.includes("whatsapp") && (
                    <label className="mt-3 block text-sm font-semibold">
                      Approved WhatsApp reminder template SID
                      <input type="text" value={settings.sundayServiceReminderWhatsAppTemplateSid}
                        onChange={(e) => update("sundayServiceReminderWhatsAppTemplateSid", e.target.value)}
                        placeholder="HX..." className="mt-1 block w-full rounded-lg border p-2" />
                      <span className="text-xs font-normal text-slate-500">Use an approved Sunday church reminder template with no variables.</span>
                    </label>
                  )}
                </fieldset>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-xl border border-amber-200 px-3 py-2">
                  <Clock3 className="h-5 w-5 text-amber-800" />
                  <input
                    type="time"
                    value={settings[item.field]}
                    onChange={(e) => update(item.field, e.target.value)}
                    className="bg-transparent text-lg font-black outline-none"
                  />
                </label>
                <button
                  onClick={() => trigger(item.key)}
                  disabled={triggering === item.key}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {triggering === item.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Send Test
                </button>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-800">
                <MessageSquareText className="h-4 w-4" />
                Open Jai Masih Broadcast
              </div>
              <h2 className="mt-3 text-2xl font-black">Send any message now</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Type an announcement, prayer request, urgent reminder, or blessing and deliver it to Jai Masih immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={sendCustomMessage}
              disabled={customSending || !customHasMessage}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {customSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              Send to Jai Masih
            </button>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {selectedLanguages.map((language) => (
              <label key={language.code} className="block">
                <span className="text-sm font-black text-slate-600">{language.name || language.code.toUpperCase()}</span>
                <textarea
                  value={customMessages[language.code] || ""}
                  onChange={(e) => setCustomMessageFor(language.code, e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder={`Write ${language.name || language.code.toUpperCase()} message...`}
                  className="mt-2 w-full rounded-2xl border border-amber-200 px-4 py-4 text-base font-semibold outline-none focus:border-emerald-600"
                />
                <span className="mt-1 block text-right text-xs font-bold text-slate-400">
                  {(customMessages[language.code] || "").length}/4000
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-700 text-white">
                <Bot className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-2xl font-black">AI Counseller</h2>
                <p className="font-medium text-slate-500">Trigger pastor guidance from UI only.</p>
              </div>
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={5}
              placeholder="Ask the pastor bot for a prayer, devotional thought, family guidance, or message to share..."
              className="mt-5 w-full rounded-2xl border border-amber-200 px-4 py-4 text-base outline-none focus:border-emerald-600"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(pastorModes).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPastorMode(key)}
                  className={`rounded-full px-4 py-2 text-sm font-black ${
                    pastorMode === key ? "bg-emerald-700 text-white" : "bg-amber-50 text-amber-950"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 font-bold text-amber-900">
                <input
                  type="checkbox"
                  checked={sendToJaiMasih}
                  onChange={(e) => setSendToJaiMasih(e.target.checked)}
                  className="h-5 w-5 accent-emerald-700"
                />
                Send reply to Jai Masih
              </label>
              <button
                onClick={askPastor}
                disabled={asking || !question.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {asking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                Ask Pastor
              </button>
            </div>
            {pastorReply && (
              <div className="mt-5 rounded-2xl bg-emerald-50 p-5 text-base font-medium leading-7 text-slate-800">
                <div className="mb-2 flex items-center gap-2 font-black text-emerald-900">
                  <Sparkles className="h-5 w-5" />
                  Pastor Reply
                </div>
                {pastorReply}
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-black text-amber-950">Pastor voice sample</div>
                  <div className="text-sm font-semibold text-amber-800">Upload only a consented sample. Generated voice must be labeled as AI-created.</div>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-bold text-amber-950 shadow-sm hover:bg-amber-100">
                  {voiceUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                  Upload
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => uploadVoiceSample(e.target.files?.[0])}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-emerald-700" />
              <h2 className="text-xl font-black">Recent Sends</h2>
            </div>
            <div className="space-y-3">
              {runs.length === 0 && <p className="text-sm font-medium text-slate-500">No scheduled sends yet.</p>}
              {runs.slice(0, 10).map((run, index) => (
                <div key={`${run.messageKey}-${run.sentAtUtc}-${index}`} className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="font-black text-slate-800">{run.messageKey}</div>
                  <div className="text-sm font-medium text-slate-500">
                    {new Date(run.sentAtUtc).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
