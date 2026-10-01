import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Search,
  X,
  ListTodo,
  LayoutGrid,
  Columns3,
  Flame,
  Flag,
  CalendarDays,
  Filter,
  SortAsc,
  Inbox,
  Loader2,
  TrendingUp,
  Pause,
  PlayCircle,
  Users,
  User,
  ChevronDown,
  Bell,
  Send,
  Repeat,
  Zap,
  Settings,
  CalendarCheck,
  Moon,
  Heart,
  MessageCircle,
  Star,
  BarChart3,
  ChevronUp,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const API_BASE = import.meta.env?.VITE_API_BASE || "/api";
const ACTIVITY_TEMPLATE_STORAGE_KEY = "mahima_task_activity_templates";
const DEFAULT_TASK_NOTIFICATION_LANGUAGE = "en";
const TASK_NOTIFICATION_LANGUAGES = [
  { value: "en", label: "English", short: "EN" },
  { value: "hi", label: "Hindi", short: "HI" },
  { value: "pa", label: "Punjabi", short: "PA" },
];

const DEFAULT_LANGUAGE_MESSAGES = {
  en: 'Jai Masih Ji! Reminder for "{eventTitle}". Please complete the assigned task and confirm readiness.',
  hi: 'जय मसीह जी! "{eventTitle}" के लिए स्मरण है। कृपया सौंपा गया काम पूरा करें और तैयारी की पुष्टि करें।',
  pa: 'ਜੈ ਮਸੀਹ ਜੀ! "{eventTitle}" ਲਈ ਯਾਦ ਦਿਹਾਨੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਦਿੱਤਾ ਕੰਮ ਪੂਰਾ ਕਰੋ ਅਤੇ ਤਿਆਰੀ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ।',
};

const STATUS = {
  0: { label: "Pending",     color: "#f59e0b", soft: "#fef3c7", icon: Circle      },
  1: { label: "In Progress", color: "#3b82f6", soft: "#dbeafe", icon: PlayCircle  },
  2: { label: "Completed",   color: "#10b981", soft: "#d1fae5", icon: CheckCircle2},
  3: { label: "On Hold",     color: "#ef4444", soft: "#fee2e2", icon: Pause       },
};

const PRIORITY = {
  1: { label: "Low",      color: "#94a3b8", soft: "#f1f5f9" },
  2: { label: "Normal",   color: "#3b82f6", soft: "#dbeafe" },
  3: { label: "High",     color: "#f59e0b", soft: "#fef3c7" },
  4: { label: "Critical", color: "#ef4444", soft: "#fee2e2" },
  5: { label: "Urgent",   color: "#dc2626", soft: "#fecaca" },
};

const TASK_TYPES = [
  { value: "general", label: "General" },
  { value: "pastoral-care", label: "Pastoral care" },
  { value: "prayer-follow-up", label: "Prayer follow-up" },
  { value: "member-care", label: "Member care" },
  { value: "visitor-follow-up", label: "Visitor follow-up" },
  { value: "service-planning", label: "Service planning" },
  { value: "worship", label: "Worship" },
  { value: "sermon-prep", label: "Sermon prep" },
  { value: "event", label: "Event" },
  { value: "outreach", label: "Outreach" },
  { value: "discipleship", label: "Discipleship" },
  { value: "children-youth", label: "Children/youth" },
  { value: "admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "facility", label: "Facility" },
  { value: "media", label: "Media" },
  { value: "volunteer", label: "Volunteer" },
  { value: "counselling", label: "Counselling" },
];

const PROCESS_STAGES = [
  { value: "intake", label: "Intake" },
  { value: "assigned", label: "Assigned" },
  { value: "in-progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "follow-up", label: "Follow-up" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

// ── Church event auto-generator ──────────────────────────────────────────────
const CHURCH_EVENTS_DEFAULT = [
  { id: "sat_meeting", label: "Saturday Evening Meeting", day: 6, time: "18:00", taskType: "event",            priority: 3, icon: "🙌", defaultTeamId: null },
  { id: "tue_prayer",  label: "Tuesday Night Prayer",     day: 2, time: "19:00", taskType: "prayer-follow-up", priority: 2, icon: "🙏", defaultTeamId: null },
  { id: "fri_prayer",  label: "Friday Night Prayer",      day: 5, time: "19:00", taskType: "prayer-follow-up", priority: 2, icon: "🕯️", defaultTeamId: null },
];

const AUTO_MARKER = "Automation:";

const TASK_FLUSH_RANGES = [
  { value: "1d", label: "Last 1 day" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "15d", label: "Last 15 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
];

const EVENT_ACTIVITY_TEMPLATES = [
  {
    id: "night_prayer",
    label: "Night Prayer",
    matchEventIds: ["tue_prayer", "fri_prayer"],
    titleKeywords: ["night prayer"],
    activities: [
      {
        id: "prayer_request_list",
        title: "Prepare and finalize prayer request list",
        offsetHours: -24,
        taskType: "prayer-follow-up",
        priority: 4,
        audience: { teamKeywords: ["call center", "prayer"], roleKeywords: ["admin", "pastor"] },
        message: (eventTitle) => `Jai Masih Ji! Please prepare and finalize all prayer requests for "${eventTitle}" and share the list with Call Center Manager, Admin, and Pastors.`,
        description: "Prepare and finalize all prayer requests one day before Night Prayer, then share the list over Jai Masih with Call Center Manager, Admin, and Pastors.",
      },
      {
        id: "prayer_status_calls",
        title: "Call prayer request members and collect testimonies",
        offsetHours: -8,
        taskType: "prayer-follow-up",
        priority: 5,
        audience: { teamKeywords: ["call center"], roleKeywords: ["call center"] },
        message: (eventTitle) => `Jai Masih Ji! "${eventTitle}" begins in 8 hours. Please call everyone who raised prayer requests, understand prayer status, and generate testimonies where applicable.`,
        description: "Call people who raised prayer requests, understand prayer status, and generate testimonies. Reminder goes to Call Center 8 hours before Night Prayer.",
      },
      {
        id: "night_prayer_all_user_reminder",
        title: "Send Night Prayer reminder to all users",
        offsetHours: -4,
        taskType: "event",
        priority: 3,
        audience: { allUsers: true },
        message: (eventTitle) => `Jai Masih Ji! Reminder for "${eventTitle}". Please join us for Night Prayer and come with faith and expectation.`,
        description: "Send Night Prayer reminders to all users via Jai Masih.",
      },
      {
        id: "oil_and_place_ready",
        title: "Prepare oil and place for Night Prayer",
        offsetHours: -2,
        taskType: "facility",
        priority: 4,
        audience: { teamKeywords: ["facility", "admin", "prayer"] },
        message: (eventTitle) => `Jai Masih Ji! "${eventTitle}" starts in 2 hours. Please prepare the oil and prayer place.`,
        description: "Prepare oil and the place for Night Prayer 2 hours before the event begins.",
      },
    ],
  },
  {
    id: "saturday_meeting",
    label: "Saturday Meeting",
    matchEventIds: ["sat_meeting"],
    titleKeywords: ["saturday meeting", "saturday evening meeting"],
    activities: [
      {
        id: "main_staff_invite",
        title: "Send Saturday Meeting reminder to Main Staff",
        offsetHours: -24,
        taskType: "event",
        priority: 3,
        audience: { teamKeywords: ["main staff", "staff"] },
        message: (eventTitle) => `Jai Masih Ji! Reminder for "${eventTitle}". Main Staff team, please be ready and aligned for the meeting.`,
        description: "Send Jai Masih reminders to all who are part of the Main Staff team.",
      },
      {
        id: "worship_team_prepare",
        title: "Remind Worship Team to prepare worship",
        offsetHours: -48,
        taskType: "worship",
        priority: 4,
        audience: { teamKeywords: ["worship", "music", "choir"] },
        message: (eventTitle) => `Jai Masih Ji! "${eventTitle}" is in 48 hours. Worship Team, please prepare worship for Saturday.`,
        description: "Send reminder to Worship Team 48 hours before Saturday meeting for worship preparation.",
      },
      {
        id: "rupesh_tent_work",
        title: "Remind Rupesh for tent work",
        offsetHours: -8,
        taskType: "facility",
        priority: 4,
        audience: { userKeywords: ["rupesh"] },
        message: (eventTitle) => `Jai Masih Ji Rupesh! "${eventTitle}" starts in 8 hours. Please complete tent work readiness.`,
        description: "Send Jai Masih reminder to Staff Rupesh for tent work 8 hours before the event.",
      },
      {
        id: "laxmi_food_preparation",
        title: "Remind Laxmi sister for food preparation",
        offsetHours: -8,
        taskType: "volunteer",
        priority: 4,
        audience: { userKeywords: ["laxmi"] },
        message: (eventTitle) => `Jai Masih Ji Laxmi Sister! "${eventTitle}" starts in 8 hours. Please prepare food arrangements.`,
        description: "Send Jai Masih reminder to Laxmi sister for food preparation 8 hours before the event.",
      },
      {
        id: "admin_pastor_readiness",
        title: "Invite Admin and Pastors for readiness",
        offsetHours: -8,
        taskType: "sermon-prep",
        priority: 4,
        audience: { roleKeywords: ["admin", "pastor"], teamKeywords: ["admin", "pastor"] },
        message: (eventTitle) => `Jai Masih Ji! "${eventTitle}" starts in 8 hours. Admin and Pastors, please confirm meeting readiness and sermon readiness.`,
        description: "Send Jai Masih invite to Admin and Pastors for meeting readiness and sermon readiness 8 hours before the meeting.",
      },
      {
        id: "media_sermon_live_ready",
        title: "Remind Media team for sermon live readiness",
        offsetHours: -5,
        taskType: "media",
        priority: 4,
        audience: { teamKeywords: ["media", "tech", "audio", "visual"] },
        message: (eventTitle) => `Jai Masih Ji! "${eventTitle}" starts in 5 hours. Media Team, please prepare thumbnail, media readiness, Word setting, and sermon live setup.`,
        description: "Send Jai Masih reminder to Media team 5 hours before the meeting for thumbnail, media readiness, Word setting, and sermon live setup.",
      },
    ],
  },
  {
    id: "sunday_service",
    label: "Sunday Service",
    matchEventIds: [],
    titleKeywords: ["sunday service", "sunday meeting"],
    activities: [
      { id: "sermon_notes", title: "Confirm sermon notes and Bible references", offsetHours: -24, taskType: "sermon-prep", priority: 4, audience: { roleKeywords: ["pastor"], teamKeywords: ["pastor"] }, message: (eventTitle) => `Jai Masih Ji! Please confirm sermon notes and Bible references for "${eventTitle}".`, description: "Confirm sermon notes, references, and flow one day before Sunday Service." },
      { id: "ushers_ready", title: "Confirm ushers and seating readiness", offsetHours: -4, taskType: "volunteer", priority: 3, audience: { teamKeywords: ["usher", "volunteer", "hospitality"] }, message: (eventTitle) => `Jai Masih Ji! Please confirm usher, seating, and hospitality readiness for "${eventTitle}".`, description: "Confirm ushers, seating, and welcome readiness before Sunday Service." },
      { id: "media_live_ready", title: "Confirm media and livestream readiness", offsetHours: -3, taskType: "media", priority: 4, audience: { teamKeywords: ["media", "tech"] }, message: (eventTitle) => `Jai Masih Ji! Please confirm media and livestream readiness for "${eventTitle}".`, description: "Confirm livestream, media, and projection readiness before Sunday Service." },
    ],
  },
];

// ── Jai Masih reminder templates ─────────────────────────────────────────────
const JAI_MASIH_TEMPLATES = [
  { id: "jm1", label: "Morning Blessing",   message: "Jai Masih Ji! 🙏 Good morning, beloved. May today be filled with God's grace and strength. You are loved! 💛" },
  { id: "jm2", label: "Event Reminder",     message: "Jai Masih Ji! This is a friendly reminder about today's task/event. See you there! 🙌" },
  { id: "jm3", label: "Prayer Call",        message: "Jai Masih Ji! 🙏 Come join us for prayer. Together in His presence. ✨" },
  { id: "jm4", label: "Follow-up Nudge",    message: "Jai Masih Ji! 🌟 Just checking in on this task — let us know if you need any support. We're here for you!" },
];

// ── Recurring patterns ────────────────────────────────────────────────────────
const RECUR_PATTERNS = [
  { value: "none",    label: "Does not repeat" },
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// ── Radar: task types grouped for the spider chart ────────────────────────────
const RADAR_CATEGORIES = [
  { type: "event",            label: "Events",      color: "#047857" },
  { type: "prayer-follow-up", label: "Prayer F/U",  color: "#8b5cf6" },
  { type: "pastoral-care",    label: "Pastoral",    color: "#ec4899" },
  { type: "member-care",      label: "Member",      color: "#0ea5e9" },
  { type: "outreach",         label: "Outreach",    color: "#f97316" },
  { type: "worship",          label: "Worship",     color: "#f59e0b" },
  { type: "admin",            label: "Admin",       color: "#64748b" },
  { type: "general",          label: "General",     color: "#10b981" },
];

// ── Smart team keyword map ────────────────────────────────────────────────────
// Keys match taskType values. Each array lists substrings to look for in a
// team name (case-insensitive). First match wins.
const TEAM_KEYWORDS = {
  "event":            ["service", "event", "meeting", "evening", "sunday", "main"],
  "prayer-follow-up": ["prayer", "intercession", "pray", "night"],
  "pastoral-care":    ["pastoral", "shepherd", "care", "pastor"],
  "member-care":      ["member", "care", "pastoral", "connect"],
  "outreach":         ["outreach", "evangelism", "mission", "street"],
  "worship":          ["worship", "music", "choir", "band", "praise"],
  "admin":            ["admin", "office", "management", "operations"],
  "counselling":      ["counsell", "support", "welfare"],
  "children-youth":   ["youth", "children", "kids", "young", "junior"],
  "sermon-prep":      ["sermon", "teaching", "preaching", "media"],
  "media":            ["media", "tech", "audio", "visual", "stream"],
  "finance":          ["finance", "steward", "account", "treasurer"],
  "facility":         ["facility", "property", "maintenance", "ushers"],
  "visitor-follow-up":["welcome", "visitor", "hospitality", "connect"],
  "discipleship":     ["discipleship", "bible", "study", "growth"],
  "general":          [],
};

/**
 * Attempt to find the best matching team for a given task.
 * Priority order:
 *   1. Explicit defaultTeamId configured on the church event
 *   2. Keyword match by taskType
 *   3. Keyword match by title words
 *   4. null (no auto-assign)
 */
function smartMatchTeam(taskType, title, teams, defaultTeamId) {
  if (!teams || teams.length === 0) return null;

  // 1. Explicit override
  if (defaultTeamId) {
    const explicit = teams.find((t) => String(t.id) === String(defaultTeamId));
    if (explicit) return explicit;
  }

  // 2. Type-based keyword match
  const typeKws = TEAM_KEYWORDS[taskType] || [];
  for (const kw of typeKws) {
    const m = teams.find((t) => t.name.toLowerCase().includes(kw));
    if (m) return m;
  }

  // 3. Title word match (words > 3 chars, skip stop-words)
  const STOP = new Set(["that", "this", "with", "from", "team", "for", "the", "and", "night", "evening", "morning", "weekly", "saturday", "tuesday", "friday"]);
  const titleKws = title
    .toLowerCase()
    .split(/[\s\-–]+/)
    .filter((w) => w.length > 3 && !STOP.has(w));

  for (const kw of titleKws) {
    const m = teams.find((t) => t.name.toLowerCase().includes(kw));
    if (m) return m;
  }

  return null;
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}

function textIncludesAny(value, keywords = []) {
  const text = String(value || "").toLowerCase();
  return keywords.some((kw) => text.includes(String(kw).toLowerCase()));
}

function normalizeNotificationLanguage(language) {
  const value = String(language || DEFAULT_TASK_NOTIFICATION_LANGUAGE).toLowerCase();
  return TASK_NOTIFICATION_LANGUAGES.some((item) => item.value === value) ? value : DEFAULT_TASK_NOTIFICATION_LANGUAGE;
}

function notificationLanguageLabel(language) {
  const normalized = normalizeNotificationLanguage(language);
  return TASK_NOTIFICATION_LANGUAGES.find((item) => item.value === normalized)?.label || "English";
}

function normalizeOffsetHours(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageTemplatesFor(activity) {
  const legacy = typeof activity.message === "function"
    ? activity.message("{eventTitle}")
    : activity.messageTemplate;
  const configured = activity.messageTemplates && typeof activity.messageTemplates === "object"
    ? activity.messageTemplates
    : {};
  const english = configured.en || legacy || DEFAULT_LANGUAGE_MESSAGES.en;
  return {
    en: english,
    hi: configured.hi || DEFAULT_LANGUAGE_MESSAGES.hi,
    pa: configured.pa || DEFAULT_LANGUAGE_MESSAGES.pa,
  };
}

function messageTemplateFor(activity, language = DEFAULT_TASK_NOTIFICATION_LANGUAGE) {
  const templates = messageTemplatesFor(activity);
  const normalized = normalizeNotificationLanguage(language);
  return templates[normalized] || templates.en || DEFAULT_LANGUAGE_MESSAGES.en;
}

function localizedMessageFor(activity, eventTitle, language = DEFAULT_TASK_NOTIFICATION_LANGUAGE) {
  return messageTemplateFor(activity, language).replaceAll("{eventTitle}", eventTitle || "this event");
}

function serializeActivityTemplates(templates = EVENT_ACTIVITY_TEMPLATES) {
  return templates.map((tpl) => ({
    id: tpl.id,
    label: tpl.label,
    matchEventIds: tpl.matchEventIds || [],
    titleKeywords: tpl.titleKeywords || [],
    notificationLanguage: normalizeNotificationLanguage(tpl.notificationLanguage),
    activities: (tpl.activities || []).map((activity) => {
      const messageTemplates = messageTemplatesFor(activity);
      return {
        id: activity.id,
        title: activity.title,
        offsetHours: normalizeOffsetHours(activity.offsetHours),
        taskType: activity.taskType || "general",
        priority: Number(activity.priority || 2),
        audience: activity.audience || {},
        messageTemplate: messageTemplates.en,
        messageTemplates,
        description: activity.description || "",
      };
    }),
  }));
}

function hydrateActivityTemplates(rawTemplates) {
  const source = Array.isArray(rawTemplates) ? rawTemplates : EVENT_ACTIVITY_TEMPLATES;
  return source.map((tpl) => ({
    ...tpl,
    notificationLanguage: normalizeNotificationLanguage(tpl.notificationLanguage),
    matchEventIds: Array.isArray(tpl.matchEventIds) ? tpl.matchEventIds : [],
    titleKeywords: Array.isArray(tpl.titleKeywords) ? tpl.titleKeywords : [],
    activities: (Array.isArray(tpl.activities) ? tpl.activities : []).map((activity) => {
      const messageTemplates = messageTemplatesFor(activity);
      return {
        ...activity,
        offsetHours: normalizeOffsetHours(activity.offsetHours),
        priority: Number(activity.priority || 2),
        audience: activity.audience || {},
        messageTemplate: messageTemplates.en,
        messageTemplates,
        message: (eventTitle, language = DEFAULT_TASK_NOTIFICATION_LANGUAGE) => localizedMessageFor({ ...activity, messageTemplates }, eventTitle, language),
      };
    }),
  }));
}
function loadActivityTemplates() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVITY_TEMPLATE_STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length > 0) return hydrateActivityTemplates(saved);
  } catch {}
  return hydrateActivityTemplates(EVENT_ACTIVITY_TEMPLATES);
}

function readCurrentUser() {
  const keys = ["mahima_user", "user", "currentUser", "mahima_currentUser"];
  for (const key of keys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || "null");
      if (parsed) return parsed;
    } catch {}
  }
  return null;
}

function isAdminUser(user) {
  const roleValues = [
    user?.role,
    user?.Role,
    user?.roleName,
    user?.RoleName,
    ...(Array.isArray(user?.roles) ? user.roles : []),
    ...(Array.isArray(user?.Roles) ? user.Roles : []),
  ];
  return roleValues.some((role) => {
    const normalized = String(role || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return ["admin", "administrator", "rootadmin", "tenantadmin", "superadmin", "platformadmin"].includes(normalized);
  });
}

function isStaffUser(user) {
  const roleValues = [
    user?.role,
    user?.Role,
    user?.roleName,
    user?.RoleName,
    ...(Array.isArray(user?.roles) ? user.roles : []),
    ...(Array.isArray(user?.Roles) ? user.Roles : []),
  ];
  return roleValues.some((role) => String(role || "").trim().toLowerCase() === "staff");
}

function findEventTemplate(task, eventConfig, templates = EVENT_ACTIVITY_TEMPLATES) {
  const eventId = eventConfig?.id || task?.eventRef?.split("_")?.[0] || "";
  const title = task?.title || "";
  return templates.find((tpl) =>
    (tpl.matchEventIds || []).includes(eventId) || textIncludesAny(title, tpl.titleKeywords || [])
  );
}

function automationKeyFor(templateId, activityId) {
  return `${templateId}:${activityId}`;
}

function hasAutomationKey(task, key) {
  return String(task?.description || "").includes(`${AUTO_MARKER} ${key}`);
}

function resolveActivityAssignees(activity, users, teams) {
  const audience = activity.audience || {};
  const out = [];
  const add = (item) => {
    if (!item?.id || out.some((x) => sameAssignee(x, item))) return;
    out.push(item);
  };

  const arr = (value) => Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]);
  const stringEq = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

  [...arr(audience.teamIds), ...arr(audience.teams)].forEach((id) => {
    const team = teams.find((t) => stringEq(t.id, id));
    add({ id, type: "team", name: team?.name || `Team #${id}` });
  });

  [...arr(audience.userIds), ...arr(audience.users)].forEach((id) => {
    const user = users.find((u) => stringEq(u.id, id));
    add({ id, type: "user", name: user?.name || `User #${id}` });
  });

  (audience.teamNames || []).forEach((name) => {
    const team = teams.find((t) => stringEq(t.name, name));
    if (team) add({ id: team.id, type: "team", name: team.name });
  });

  (audience.userEmails || []).forEach((email) => {
    const user = users.find((u) => stringEq(u.email, email));
    if (user) add({ id: user.id, type: "user", name: user.name });
  });

  (audience.userNames || []).forEach((name) => {
    const user = users.find((u) => stringEq(u.name, name));
    if (user) add({ id: user.id, type: "user", name: user.name });
  });

  (audience.roleIds || []).forEach((roleId) => {
    users
      .filter((u) => stringEq(u.role, roleId) || stringEq(u.roleId, roleId))
      .slice(0, 20)
      .forEach((u) => add({ id: u.id, type: "user", name: u.name }));
  });

  (audience.teamKeywords || []).forEach((kw) => {
    const team = teams.find((t) => textIncludesAny(t.name, [kw]));
    if (team) add({ id: team.id, type: "team", name: team.name });
  });

  (audience.userKeywords || []).forEach((kw) => {
    users
      .filter((u) => textIncludesAny(`${u.name} ${u.email}`, [kw]))
      .slice(0, 3)
      .forEach((u) => add({ id: u.id, type: "user", name: u.name }));
  });

  (audience.roleKeywords || []).forEach((kw) => {
    users
      .filter((u) => textIncludesAny(`${u.name} ${u.email} ${u.role}`, [kw]))
      .slice(0, 12)
      .forEach((u) => add({ id: u.id, type: "user", name: u.name }));
  });

  if (out.length === 0 && activity.taskType) {
    const fallbackTeam = smartMatchTeam(activity.taskType, activity.title || "", teams, null);
    if (fallbackTeam) add({ id: fallbackTeam.id, type: "team", name: fallbackTeam.name });
  }

  return out;
}

function messageAudienceUserIds(task, users) {
  if (String(task.description || "").includes("Audience: all-users")) {
    return users.map((u) => u.id).filter(Boolean);
  }
  return (task.assignees || []).filter((a) => a.type === "user").map((a) => a.id).filter(Boolean);
}

function sameCalendarDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function masterMatchesEvent(task, eventConfig, dueDate) {
  const title = String(task?.title || "").toLowerCase();
  return title.includes(String(eventConfig?.label || "").toLowerCase()) && sameCalendarDay(task?.dueDate, dueDate);
}

function isTemplateAutomationTask(task) {
  return String(task?.description || "").includes(AUTO_MARKER);
}

function jaiMasihMessageFromTask(task) {
  const match = String(task?.description || "").match(/^JaiMasihMessage:\s*(.+)$/im);
  return match?.[1]?.trim() || `Jai Masih Ji! Reminder for "${task?.title || "task"}".`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function nextOccurrence(dayOfWeek, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date();
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  const diff = (dayOfWeek - now.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 && d <= now ? 7 : diff));
  return d;
}

const labelFrom = (items, value, fallback = "General") =>
  items.find((x) => x.value === value)?.label || fallback;
const subTaskPlural = (count) => count === 1 ? "" : "s";

function taskIdFromLocation() {
  if (typeof window === "undefined") return "";
  const hashQuery = String(window.location.hash || "").split("?")[1] || "";
  const search = String(window.location.search || "").replace(/^\?/, "");
  return new URLSearchParams(hashQuery || search).get("taskId") || "";
}

/* ------------------------------------------------------------------ */
/*  API helpers                                                        */
/* ------------------------------------------------------------------ */

function getToken() {
  const keys = ["authToken", "mahima_token", "mahimaToken"];
  for (const k of keys) {
    const v = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (v) return v.replace(/^Bearer\s+/i, "");
  }
  return "";
}

async function api(path, opt = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path.startsWith("/") ? path : "/" + path}`, {
    ...opt,
    headers: {
      ...(opt.headers || {}),
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(json?.message || res.statusText || "Request failed");
  return json;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

const fmtDate = (d) => {
  if (!d) return null;
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const isOverdue = (t) =>
  t.dueDate && t.status !== 2 && t.status !== 3 && new Date(t.dueDate).getTime() < Date.now();

const normalizeTaskStatus = (rawStatus, rawStage) => {
  const stage = String(rawStage || "").trim().toLowerCase();
  const status = Number(rawStatus ?? 0);
  return stage === "done" ? 2 : (Number.isFinite(status) ? status : 0);
};

const normalizeTaskStage = (rawStage, rawStatus) => {
  const status = Number(rawStatus ?? 0);
  return status === 2 ? "done" : (rawStage || "intake");
};

function readOnlyMessage(task) {
  const reason = task?.visibilityReason || "";
  if (reason.startsWith("member-")) {
    return "Member position users can edit only records they created.";
  }
  if (reason === "same-position-readonly") {
    return "Same-position visibility: ask the position leader to assign this task before editing.";
  }
  if (reason === "position-scope") {
    return "This task is visible to your position, but not editable until assigned to you.";
  }
  return "This task is read-only for your current position.";
}

const daysUntil = (d) => {
  if (!d) return null;
  const ms = new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
  return Math.round(ms / 86400000);
};

const dueLabel = (t) => {
  if (!t.dueDate) return "No due date";
  const n = daysUntil(t.dueDate);
  if (n < 0)  return `${Math.abs(n)}d overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n < 7)  return `Due in ${n}d`;
  return fmtDate(t.dueDate);
};

/* ----- People / teams helpers ----- */
const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase() || "?";

// deterministic pleasant color from a string
const AVATAR_COLORS = [
  "#047857", "#0f766e", "#2563eb", "#b7791f", "#dc2626",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
];
const colorFor = (key) => {
  const s = String(key ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const normalizeUser = (u) => ({
  id: u.id ?? u.Id,
  type: "user",
  name: u.name ?? u.Name ?? u.fullName ?? u.FullName ?? u.displayName ?? u.DisplayName ?? u.email ?? u.Email ?? "User",
  email: u.email ?? u.Email ?? "",
  role: u.role ?? u.Role ?? u.roleName ?? u.RoleName ?? "",
  roleId: u.roleId ?? u.RoleId ?? u.role_id ?? u.role ?? u.Role ?? "",
  avatarUrl: u.avatarUrl ?? u.AvatarUrl ?? u.avatar ?? u.Avatar ?? null,
});
const normalizeTeam = (t) => ({
  id: t.id ?? t.Id,
  type: "team",
  name: t.name ?? t.Name ?? "Team",
  memberCount: t.memberCount ?? t.MemberCount ?? null,
  color: t.color ?? t.Color ?? null,
});
const normalizeAssignee = (a) => {
  if (!a) return null;
  const type = (a.type ?? a.Type ?? a.assigneeType ?? a.AssigneeType ?? "user").toString().toLowerCase();
  return type === "team" ? normalizeTeam(a) : normalizeUser(a);
};

const sameAssignee = (a, b) => a && b && a.type === b.type && String(a.id) === String(b.id);

/* ------------------------------------------------------------------ */
/*  Toast system                                                       */
/* ------------------------------------------------------------------ */

function useToasts() {
  const [items, setItems] = useState([]);
  const push = (msg, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  };
  return { items, push };
}

function Toasts({ items }) {
  return (
    <div className="toast-stack">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === "success" && <CheckCircle2 size={16} />}
          {t.kind === "error"   && <AlertTriangle size={16} />}
          {t.kind === "info"    && <TrendingUp size={16} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TasksPage() {
  const [tasks, setTasks]       = useState([]);
  const [users, setUsers]       = useState([]);
  const [teams, setTeams]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [showModal, setShow]    = useState(false);
  const [confirmDel, setConf]   = useState(null);
  const [view, setView]         = useState("grid");      // grid | board
  const [statusFilter, setSF]   = useState("all");
  const [priorityFilter, setPF] = useState("all");
  const [sortBy, setSort]       = useState("due");
  const [query, setQuery]       = useState("");
  const [form, setForm]         = useState({
    id: null, title: "", description: "", priority: 2, status: 0, dueDate: "",
    parentTaskId: "", taskType: "general", processStage: "intake", followUpDate: "", followUpNotes: "",
    assignees: [], recurring: "none",
  });
  const toast = useToasts();

  // ── Radar + auto-gen + reminders ──
  const [showRadar,    setShowRadar]    = useState(() => (
    typeof window === "undefined" ? true : window.innerWidth > 740
  ));
  const [showAutoGen,  setShowAutoGen]  = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplateAdmin, setShowTemplateAdmin] = useState(false);
  const [showFlushTasks, setShowFlushTasks] = useState(false);
  const [showTaskReport, setShowTaskReport] = useState(false);
  const [taskReportRows, setTaskReportRows] = useState([]);
  const [taskReportLoading, setTaskReportLoading] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [reminderTask, setReminderTask] = useState(null);
  const [reminderNote, setReminderNote] = useState("");
  const [reminderSent, setReminderSent] = useState(false);
  const [generating,   setGenerating]   = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [activityTemplates, setActivityTemplates] = useState(() => loadActivityTemplates());
  const [templateJson, setTemplateJson] = useState(() =>
    JSON.stringify(serializeActivityTemplates(loadActivityTemplates()), null, 2)
  );
  const currentUser = useMemo(() => readCurrentUser(), []);
  const isAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);
  const canCreateTask = useMemo(() => isAdmin || isStaffUser(currentUser), [currentUser, isAdmin]);
  const [genWeeks,     setGenWeeks]     = useState(4);
  const [genSelected,  setGenSelected]  = useState(() => new Set(CHURCH_EVENTS_DEFAULT.map((e) => e.id)));
  const [genDesign, setGenDesign] = useState({});
  const [churchEvents, setChurchEvents] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mahima_church_events") || "null") || CHURCH_EVENTS_DEFAULT; }
    catch { return CHURCH_EVENTS_DEFAULT; }
  });
  // Track which auto-reminders have already been sent: key = `{taskId}_{days}d`
  const [linkedTaskId, setLinkedTaskId] = useState(() => taskIdFromLocation());
  const [sentReminders, setSentReminders] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mahima_sent_reminders") || "{}"); }
    catch { return {}; }
  });

  /* ------------------ data ------------------ */

  async function fetchTasks() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/tasks");
      const normalized = Array.isArray(data)
        ? data.map((t) => {
            // assignees can be: an array of {id,type}, separate users[]+teams[],
            // or just a legacy assigneeId — handle all three
            let assignees = [];
            const raw = t.assignees ?? t.Assignees;
            if (Array.isArray(raw)) {
              assignees = raw.map(normalizeAssignee).filter(Boolean);
            } else {
              const us = t.users ?? t.Users;
              const ts = t.teams ?? t.Teams;
              if (Array.isArray(us)) assignees.push(...us.map(normalizeUser));
              if (Array.isArray(ts)) assignees.push(...ts.map(normalizeTeam));
            }
            const legacyId = t.assigneeId ?? t.AssigneeId;
            if (legacyId != null && !assignees.some((a) => a.type === "user" && String(a.id) === String(legacyId))) {
              assignees.push({ id: legacyId, type: "user", name: `User #${legacyId}` });
            }
            return {
              id: t.id ?? t.Id,
              title: t.title ?? t.Title ?? "",
              description: t.description ?? t.Description ?? "",
              status: normalizeTaskStatus(t.status ?? t.Status, t.processStage ?? t.ProcessStage),
              priority: Number(t.priority ?? t.Priority ?? 2),
              dueDate: t.dueDate ?? t.DueDate ?? null,
              parentTaskId: t.parentTaskId ?? t.ParentTaskId ?? null,
              taskType: t.taskType ?? t.TaskType ?? "general",
              processStage: normalizeTaskStage(t.processStage ?? t.ProcessStage, t.status ?? t.Status),
              followUpDate: t.followUpDate ?? t.FollowUpDate ?? null,
              followUpNotes: t.followUpNotes ?? t.FollowUpNotes ?? "",
              subTaskIds: t.subTaskIds ?? t.SubTaskIds ?? [],
              subTaskCount: Number(t.subTaskCount ?? t.SubTaskCount ?? 0),
              activityLog: t.activityLog ?? t.ActivityLog ?? [],
              canUpdate: Boolean(t.canUpdate ?? t.CanUpdate ?? true),
              canReassign: Boolean(t.canReassign ?? t.CanReassign ?? false),
              canDelete: Boolean(t.canDelete ?? t.CanDelete ?? false),
              readOnly: Boolean(t.readOnly ?? t.ReadOnly ?? false),
              visibilityReason: t.visibilityReason ?? t.VisibilityReason ?? "",
              ownerPositionId: t.ownerPositionId ?? t.OwnerPositionId ?? null,
              createdById: t.createdById ?? t.CreatedById ?? null,
              assigneeId: legacyId ?? null,
              recurring: t.recurring ?? t.Recurring ?? "none",
              eventRef:  t.eventRef  ?? t.EventRef  ?? null,
              isAutoGen: Boolean(t.isAutoGen ?? t.IsAutoGen ?? false),
              assignees,
            };
          })
        : [];

      // Older task API versions do not return ParentTaskId/EventRef even
      // though generated sub-activities carry an explicit "Master:" marker
      // in their description. Rebuild the hierarchy deterministically so
      // each weekly event stays grouped after refresh or deployment.
      const mastersByTitle = new Map(
        normalized
          .filter((task) => /^Auto-generated for /i.test(task.description || ""))
          .map((task) => [String(task.title || "").trim().toLowerCase(), task])
      );
      normalized.forEach((task) => {
        const description = String(task.description || "");
        const masterTitle = description.match(/^Master:\s*(.+)$/im)?.[1]?.trim();
        if (!task.parentTaskId && masterTitle) {
          const master = mastersByTitle.get(masterTitle.toLowerCase());
          if (master && String(master.id) !== String(task.id)) task.parentTaskId = master.id;
        }
        if (!task.isAutoGen && (description.includes(AUTO_MARKER) || /^Auto-generated for /i.test(description))) {
          task.isAutoGen = true;
        }
        if (task.recurring === "none" && /^Auto-generated for /i.test(description)) {
          task.recurring = "weekly";
        }
      });
      setTasks(normalized);
    } catch (e) {
      setError("Couldn't load tasks. Check your session and try again.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPeople() {
    // Staff only receive users in their active position. The API enforces the
    // same boundary on create/reassign, so this is both a focused picker and
    // not merely a client-side restriction.
    if (!isAdmin) {
      try {
        const data = await api("/tasks/eligible-assignees");
        const nextUsers = Array.isArray(data) ? data.map(normalizeUser) : [];
        setUsers(nextUsers);
        setTeams([]);
        return { users: nextUsers, teams: [] };
      } catch {
        setUsers([]);
        setTeams([]);
        return { users: [], teams: [] };
      }
    }

    // fetch users + teams in parallel; tolerate either being unavailable.
    // /users returns { items, total, page, limit }; /teams returns a bare array.
    const [u, tm] = await Promise.allSettled([
      api("/users?page=1&limit=500"),
      api("/teams"),
    ]);
    let nextUsers = users;
    let nextTeams = teams;
    if (u.status === "fulfilled" && u.value) {
      const arr = Array.isArray(u.value) ? u.value : (u.value.items || []);
      nextUsers = arr.map(normalizeUser);
      setUsers(nextUsers);
    }
    if (tm.status === "fulfilled" && Array.isArray(tm.value)) {
      nextTeams = tm.value.map(normalizeTeam);
      setTeams(nextTeams);
    }
    return { users: nextUsers, teams: nextTeams };
  }

  // Cached team-members loader for the picker
  const teamMembersCache = useRef(new Map());
  async function loadTeamMembers(teamId) {
    const key = String(teamId);
    if (teamMembersCache.current.has(key)) return teamMembersCache.current.get(key);
    try {
      const data = await api(`/teams/${teamId}/members`);
      const userIds = Array.isArray(data)
        ? data.map((m) => m.userId ?? m.UserId ?? m.userid).filter(Boolean).map(String)
        : [];
      teamMembersCache.current.set(key, userIds);
      return userIds;
    } catch {
      teamMembersCache.current.set(key, []);
      return [];
    }
  }

  useEffect(() => {
    fetchTasks();
    fetchPeople();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-generate church event tasks ──────────────────────────────────────
  async function createTemplateSubActivities(masterTask, eventConfig, knownTasks = [], people = { users, teams }, design = {}) {
    const template = activityTemplates.find((tpl) => tpl.id === design.templateId)
      || findEventTemplate(masterTask, eventConfig, activityTemplates);
    if (!template || !masterTask?.id || !masterTask?.dueDate) return 0;

    let createdCount = 0;
    const known = [...knownTasks];

    const notificationLanguage = normalizeNotificationLanguage(design.notificationLanguage || template.notificationLanguage);

    for (const activity of template.activities) {
      const key = automationKeyFor(template.id, activity.id);
      const alreadyExists = known.some((t) =>
        String(t.parentTaskId ?? t.ParentTaskId ?? "") === String(masterTask.id) && hasAutomationKey(t, key)
      );
      if (alreadyExists) continue;

      const due = addHours(masterTask.dueDate, normalizeOffsetHours(activity.offsetHours));
      if (due <= new Date()) continue;
      const manualAssignees = design.assigneesByActivity?.[activity.id] || [];
      const assignees = manualAssignees.length > 0
        ? manualAssignees
        : resolveActivityAssignees(activity, people.users || [], people.teams || []);
      const audienceLine = activity.audience?.allUsers ? "Audience: all-users" : "";
      const message = localizedMessageFor(activity, masterTask.title, notificationLanguage);
      const payload = {
        Title: activity.title,
        Description: [
          activity.description,
          `${AUTO_MARKER} ${key}`,
          `Master: ${masterTask.title}`,
          `NotificationLanguage: ${notificationLanguage}`,
          `TriggerOffsetHours: ${normalizeOffsetHours(activity.offsetHours)}`,
          `JaiMasihMessage: ${message}`,
          audienceLine,
        ].filter(Boolean).join("\n"),
        Status: 0,
        Priority: activity.priority,
        DueDate: due.toISOString(),
        ParentTaskId: Number(masterTask.id),
        TaskType: activity.taskType,
        ProcessStage: "assigned",
        FollowUpDate: due.toISOString(),
        FollowUpNotes: message,
        Recurring: "none",
        IsAutoGen: true,
        AssigneeId: null,
        Assignees: assignees.map((a) => ({ Id: String(a.id), Type: a.type })),
      };

      try {
        const res = await api("/tasks", { method: "POST", body: JSON.stringify(payload) });
        const child = {
          ...payload,
          id: res?.id ?? `local_${Date.now()}_${activity.id}`,
          title: payload.Title,
          description: payload.Description,
          status: payload.Status,
          priority: payload.Priority,
          dueDate: payload.DueDate,
          parentTaskId: payload.ParentTaskId,
          taskType: payload.TaskType,
          processStage: payload.ProcessStage,
          followUpDate: payload.FollowUpDate,
          followUpNotes: payload.FollowUpNotes,
          isAutoGen: true,
          assignees,
        };
        known.push(child);
        createdCount += 1;
      } catch (e) {
        console.warn("Template sub-activity creation failed", key, e);
      }
    }

    return createdCount;
  }

  async function generateChurchTasks() {
    setGenerating(true);
    const created = [];
    let subCreated = 0;
    const knownTasks = [...tasks];
    const people = users.length > 0 || teams.length > 0
      ? { users, teams }
      : await fetchPeople();
    for (const evt of churchEvents.filter((e) => genSelected.has(e.id))) {
      const design = genDesign[evt.id] || {};
      if (design.parentTaskId) {
        const parentTask = knownTasks.find((t) => String(t.id) === String(design.parentTaskId));
        if (parentTask) {
          subCreated += await createTemplateSubActivities(parentTask, evt, knownTasks, people, design);
          continue;
        }
      }

      // Resolve the team to assign (explicit → smart match → null)
      const resolvedTeam = smartMatchTeam(evt.taskType, evt.label, people.teams, evt.defaultTeamId);

      for (let w = 0; w < genWeeks; w++) {
        const base = nextOccurrence(evt.day, evt.time);
        base.setDate(base.getDate() + w * 7);
        const isoDate = base.toISOString();
        const eventRef = `${evt.id}_${base.toDateString()}`;
        // skip duplicates already in state
        const existing = knownTasks.find((t) => t.eventRef === eventRef || masterMatchesEvent(t, evt, base));
        if (existing) {
          subCreated += await createTemplateSubActivities(existing, evt, knownTasks, people, design);
          continue;
        }

        const assignees = resolvedTeam
          ? [{ Id: String(resolvedTeam.id), Type: "team" }]
          : [];

        const payload = {
          Title: `${evt.label} – ${base.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
          Description: `Auto-generated for ${evt.label}.${resolvedTeam ? ` Assigned to: ${resolvedTeam.name}.` : ""}`,
          Status: 0,
          Priority: evt.priority,
          DueDate: isoDate,
          TaskType: evt.taskType,
          ProcessStage: "intake",
          Recurring: "weekly",
          EventRef: eventRef,
          IsAutoGen: true,
          Assignees: assignees,
          AssigneeId: null,
        };
        try {
          const res = await api("/tasks", { method: "POST", body: JSON.stringify(payload) });
          created.push(res);
          const masterTask = {
            ...payload,
            id: res?.id,
            title: payload.Title,
            description: payload.Description,
            status: payload.Status,
            priority: payload.Priority,
            dueDate: payload.DueDate,
            parentTaskId: null,
            taskType: payload.TaskType,
            eventRef,
            assignees: assignees.map((a) => ({ id: a.Id, type: a.Type })),
          };
          knownTasks.push(masterTask);
          subCreated += await createTemplateSubActivities(masterTask, evt, knownTasks, people, design);
        } catch {
          created.push({ ...payload, id: `local_${Date.now()}_${w}`, eventRef });
        }
      }
    }
    if (created.length === 0 && subCreated === 0) {
      toast.push("No new tasks or sub-activities to generate", "info");
    } else {
      toast.push(`Generated ${created.length} task${created.length === 1 ? "" : "s"} and ${subCreated} sub-activit${subCreated === 1 ? "y" : "ies"} ✓`, "success");
      fetchTasks();
    }
    setShowAutoGen(false);
    setGenerating(false);
  }

  // ── Send Jai Masih reminder ───────────────────────────────────────────────
  async function sendReminder(task, message) {
    const userIds = await getTaskRecipientUserIds(task);
    if (userIds.length === 0) {
      toast.push("No users are assigned to receive this reminder", "error");
      return;
    }
    try {
      await api("/messages/send", {
        method: "POST",
        body: JSON.stringify({
          type: "Reminder",
          message,
          userIds,
          taskId: task.id,
          source: "manual",
          channels: { email: false, whatsapp: false, sms: false },
        }),
      });
      toast.push(`Jai Masih reminder sent for "${task.title}"`, "success");
      setReminderSent(true);
      fetchTasks();
    } catch (e) {
      toast.push(e.message || "Reminder send failed", "error");
    }
  }

  // ── Smart due-date reminders (auto, threshold-based) ─────────────────────
  // Reads tasks from the latest fetched list (via a ref so this function is
  // always fresh without needing tasks in the dep array).
  const tasksRef = React.useRef([]);
  React.useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const REMINDER_THRESHOLDS = [
    { days: 7, label: "7 days",  message: (title) => `🙏 Jai Masih Ji! Just a gentle reminder — "${title}" is due in 7 days. Please plan accordingly. God bless you! 🙌` },
    { days: 5, label: "5 days",  message: (title) => `🙏 Jai Masih Ji! "${title}" is approaching — due in 5 days. Please make sure preparations are on track. Jai Masih! ✝️` },
    { days: 3, label: "3 days",  message: (title) => `🙏 Jai Masih Ji! Friendly reminder — "${title}" is due in just 3 days. Please wrap up any pending items. Blessings! 🙏` },
    { days: 2, label: "2 days",  message: (title) => `⚠️ Jai Masih Ji! "${title}" is due in 2 days. Please ensure everything is ready. Jai Masih Ji! 🙏` },
    { days: 1, label: "1 day",   message: (title) => `🔴 Jai Masih Ji! URGENT — "${title}" is due TOMORROW. Please complete it today. God's grace be with you! 🙏` },
  ];

  async function getTaskRecipientUserIds(task) {
    const ids = new Set(messageAudienceUserIds(task, users).map(String));
    for (const assignee of task.assignees || []) {
      if (assignee.type !== "team") continue;
      const memberIds = await loadTeamMembers(assignee.id);
      memberIds.forEach((id) => ids.add(String(id)));
    }
    return [...ids].filter(Boolean);
  }

  async function markTaskDone(task) {
    if (!task || task.status === 2 || task.readOnly || task.canUpdate === false) return;
    const firstUser = (task.assignees || []).find((a) => a.type === "user");
    await api(`/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({
        Title: task.title,
        Description: task.description,
        Status: 2,
        Priority: task.priority,
        DueDate: task.dueDate,
        ParentTaskId: task.parentTaskId ?? null,
        TaskType: task.taskType || "general",
        ProcessStage: "done",
        FollowUpDate: task.followUpDate ?? null,
        FollowUpNotes: task.followUpNotes ?? null,
        AssigneeId: firstUser ? firstUser.id : (task.assigneeId ?? null),
        Assignees: (task.assignees || []).map((a) => ({ Id: a.id, Type: a.type })),
      }),
    });
  }

  async function checkDueReminders() {
    const now = new Date();
    const allTasks = tasksRef.current;
    // Load latest sent log from localStorage (handles page-reload freshness)
    let sent = {};
    try { sent = JSON.parse(localStorage.getItem("mahima_sent_reminders") || "{}"); } catch { sent = {}; }
    let updated = false;

    for (const task of allTasks) {
      // Skip completed / on-hold tasks
      if (task.status === 2 || task.status === 3) continue;
      if (!task.dueDate) continue;
      const due = new Date(task.dueDate);

      if (isTemplateAutomationTask(task)) {
        if (due > now) continue;
        const key = `auto_${task.id}`;
        if (sent[key]) continue;
        const userIds = await getTaskRecipientUserIds(task);
        let reminderSent = false;

        if (userIds.length > 0) {
          try {
            await api("/messages/send", {
              method: "POST",
              body: JSON.stringify({
                type: "Reminder",
                message: jaiMasihMessageFromTask(task),
                userIds,
                taskId: task.id,
                source: "auto",
                channels: { email: false, whatsapp: false, sms: false },
              }),
            });
            reminderSent = true;
          } catch (e) {
            console.warn("Auto reminder send failed; completing automation task anyway", task.id, e);
          }
        } else {
          console.warn("Auto reminder had no recipients; completing automation task anyway", task.id);
        }

        try {
          await markTaskDone(task);
          task.status = 2;
          task.processStage = "done";
        } catch (e) {
          console.warn("Auto-complete sub-activity failed", task.id, e);
          continue;
        }

        sent[key] = { at: new Date().toISOString(), reminderSent, recipients: userIds.length };
        updated = true;
        toast.push(`Jai Masih automation completed — "${task.title}"`, "success");
        continue;
      }

      const daysLeft = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

      for (const threshold of REMINDER_THRESHOLDS) {
        // Only fire when daysLeft is exactly at this threshold (±0.5 day window)
        if (daysLeft > threshold.days || daysLeft < threshold.days - 0.5) continue;
        const key = `${task.id}_${threshold.days}d`;
        if (sent[key]) continue; // already sent for this threshold

        const userIds = await getTaskRecipientUserIds(task);

        if (userIds.length === 0) continue; // no one to notify

        const message = threshold.message(task.title);
        await api("/messages/send", {
          method: "POST",
          body: JSON.stringify({
            type: "Reminder",
            message,
            userIds,
            taskId: task.id,
            source: "auto",
            channels: { email: false, whatsapp: false, sms: false },
          }),
        });

        sent[key] = new Date().toISOString();
        updated = true;
        toast.push(`🔔 ${threshold.label} reminder sent — "${task.title}"`, "info");
      }
    }

    if (updated) {
      localStorage.setItem("mahima_sent_reminders", JSON.stringify(sent));
      setSentReminders({ ...sent });
      fetchTasks();
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.push("Title is required", "error");
      return;
    }
    setSaving(true);
    const assignees = form.assignees ?? [];
    // Legacy column is bigint — only safe to populate from numeric IDs.
    // Once the TaskAssignees join table is live, this can stay null and the
    // join table becomes the source of truth.
    const numericId = (() => {
      for (const a of assignees) {
        const n = Number(a.id);
        if (Number.isFinite(n) && String(n) === String(a.id)) return n;
      }
      return null;
    })();
    const requestedStage = form.processStage || "intake";
    const requestedStatus = requestedStage === "done" ? 2 : parseInt(form.status, 10);
    const payload = {
      Title: form.title.trim(),
      Description: form.description.trim(),
      Status: requestedStatus,
      Priority: parseInt(form.priority, 10),
      DueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      ParentTaskId: form.parentTaskId ? Number(form.parentTaskId) : null,
      TaskType: form.taskType || "general",
      ProcessStage: requestedStatus === 2 ? "done" : requestedStage,
      FollowUpDate: form.followUpDate ? new Date(form.followUpDate).toISOString() : null,
      FollowUpNotes: form.followUpNotes?.trim() || null,
      Recurring: form.recurring || "none",
      AssigneeId: numericId, // legacy single-assignee column (bigint)
      Assignees: assignees.map((a) => ({ Id: String(a.id), Type: a.type })),
    };
    try {
      if (form.id && form.reassignOnly) {
        await api(`/tasks/${form.id}/reassign`, {
          method: "POST",
          body: JSON.stringify(payload.Assignees),
        });
        toast.push("Task reassigned. The assignee will be notified.", "success");
      } else if (form.id) {
        await api(`/tasks/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast.push("Task updated", "success");
      } else {
        await api("/tasks", { method: "POST", body: JSON.stringify(payload) });
        toast.push("Task created", "success");
      }
      setShow(false);
      setForm(emptyForm());
      fetchTasks();
    } catch (e) {
      toast.push(e.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const task = tasks.find((item) => item.id === id);
    if (task?.readOnly || task?.canUpdate === false) {
      setConf(null);
      toast.push(readOnlyMessage(task), "info");
      return;
    }
    setConf(null);
    // optimistic
    const prev = tasks;
    setTasks((s) => s.filter((t) => t.id !== id));
    try {
      await api(`/tasks/${id}`, { method: "DELETE" });
      toast.push("Task deleted", "success");
    } catch (e) {
      setTasks(prev);
      toast.push("Delete failed", "error");
    }
  }

  async function handleFlushTasks(range) {
    if (!isAdmin || !range) return;
    setFlushing(true);
    try {
      const result = await api(`/tasks/flush?range=${encodeURIComponent(range)}`, { method: "DELETE" });
      const deleted = Number(result?.tasksDeleted ?? result?.matched ?? 0);
      toast.push(`Flushed ${deleted} task${deleted === 1 ? "" : "s"} and activities`, "success");
      setShowFlushTasks(false);
      fetchTasks();
    } catch (e) {
      toast.push(e.message || "Task flush failed", "error");
    } finally {
      setFlushing(false);
    }
  }

  function handleSaveActivityTemplates() {
    if (!isAdmin) return;
    try {
      const parsed = JSON.parse(templateJson);
      if (!Array.isArray(parsed)) throw new Error("Template JSON must be an array.");
      const hydrated = hydrateActivityTemplates(parsed);
      localStorage.setItem(ACTIVITY_TEMPLATE_STORAGE_KEY, JSON.stringify(serializeActivityTemplates(hydrated), null, 2));
      setActivityTemplates(hydrated);
      setTemplateJson(JSON.stringify(serializeActivityTemplates(hydrated), null, 2));
      toast.push("Activity templates saved", "success");
      setShowTemplateAdmin(false);
    } catch (e) {
      toast.push(e.message || "Invalid template JSON", "error");
    }
  }

  function handleResetActivityTemplates() {
    if (!isAdmin) return;
    const defaults = hydrateActivityTemplates(EVENT_ACTIVITY_TEMPLATES);
    localStorage.removeItem(ACTIVITY_TEMPLATE_STORAGE_KEY);
    setActivityTemplates(defaults);
    setTemplateJson(JSON.stringify(serializeActivityTemplates(defaults), null, 2));
    toast.push("Activity templates reset", "info");
  }

  async function openTaskReport() {
    setShowTaskReport(true);
    setTaskReportLoading(true);
    try {
      const people = users.length > 0 || teams.length > 0
        ? { users, teams }
        : await fetchPeople();
      const userMap = new Map((people.users || []).map((u) => [String(u.id), u]));
      const buckets = new Map();

      const makeBucket = (id, name, meta = {}) => ({
        id,
        name,
        email: meta.email || "",
        avatarUrl: meta.avatarUrl || null,
        total: 0,
        pending: 0,
        progress: 0,
        completed: 0,
        onHold: 0,
        overdue: 0,
        tasks: [],
      });

      const getBucket = (id, fallbackName, meta = {}) => {
        const key = String(id);
        if (!buckets.has(key)) buckets.set(key, makeBucket(key, fallbackName, meta));
        return buckets.get(key);
      };

      const bump = (bucket, task) => {
        bucket.total += 1;
        if (task.status === 2) bucket.completed += 1;
        else if (task.status === 1) bucket.progress += 1;
        else if (task.status === 3) bucket.onHold += 1;
        else bucket.pending += 1;
        if (isOverdue(task)) bucket.overdue += 1;
        bucket.tasks.push(task);
      };

      for (const task of tasks) {
        const userIds = new Set();
        for (const assignee of task.assignees || []) {
          if (assignee.type === "user") {
            userIds.add(String(assignee.id));
          } else if (assignee.type === "team") {
            const memberIds = await loadTeamMembers(assignee.id);
            memberIds.forEach((id) => userIds.add(String(id)));
          }
        }

        if (userIds.size === 0) {
          bump(getBucket("__unassigned__", "Unassigned"), task);
          continue;
        }

        userIds.forEach((id) => {
          const user = userMap.get(String(id));
          bump(
            getBucket(id, user?.name || `User #${id}`, { email: user?.email, avatarUrl: user?.avatarUrl }),
            task
          );
        });
      }

      setTaskReportRows(
        [...buckets.values()]
          .map((row) => ({
            ...row,
            completion: row.total ? Math.round((row.completed / row.total) * 100) : 0,
          }))
          .sort((a, b) => {
            if (a.id === "__unassigned__") return -1;
            if (b.id === "__unassigned__") return 1;
            return b.total - a.total || a.name.localeCompare(b.name);
          })
      );
    } catch (e) {
      toast.push(e.message || "Task report failed", "error");
      setTaskReportRows([]);
    } finally {
      setTaskReportLoading(false);
    }
  }

  async function toggleStatus(task) {
    if (task?.readOnly || task?.canUpdate === false) {
      toast.push(readOnlyMessage(task), "info");
      return;
    }
    const next = task.status === 2 ? 0 : 2;
    // optimistic
    setTasks((s) => s.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    try {
      const firstUser = (task.assignees || []).find((a) => a.type === "user");
      await api(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({
          Title: task.title,
          Description: task.description,
          Status: next,
          Priority: task.priority,
          DueDate: task.dueDate,
          ParentTaskId: task.parentTaskId ?? null,
          TaskType: task.taskType || "general",
          ProcessStage: next === 2 ? "done" : (task.processStage || "intake"),
          FollowUpDate: task.followUpDate ?? null,
          FollowUpNotes: task.followUpNotes ?? null,
          AssigneeId: firstUser ? firstUser.id : (task.assigneeId ?? null),
          Assignees: (task.assignees || []).map((a) => ({ Id: a.id, Type: a.type })),
        }),
      });
    } catch (e) {
      // revert
      setTasks((s) => s.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
      toast.push(e.message || "Couldn't update status", "error");
    }
  }

  function openEdit(t) {
    if ((t?.readOnly || t?.canUpdate === false) && !t?.canReassign) {
      toast.push(readOnlyMessage(t), "info");
      return;
    }
    setForm({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
      parentTaskId: t.parentTaskId ? String(t.parentTaskId) : "",
      taskType: t.taskType || "general",
      processStage: t.processStage || "intake",
      followUpDate: t.followUpDate ? new Date(t.followUpDate).toISOString().slice(0, 10) : "",
      followUpNotes: t.followUpNotes || "",
      assigneeId: t.assigneeId ?? null,
      assignees: t.assignees ? [...t.assignees] : [],
      recurring: t.recurring || "none",
      reassignOnly: !t.canUpdate && Boolean(t.canReassign),
    });
    setShow(true);
  }

  function emptyForm(parentTask = null) {
    return {
      id: null,
      title: "",
      description: "",
      priority: 2,
      status: 0,
      dueDate: "",
      parentTaskId: parentTask ? String(parentTask.id) : "",
      taskType: parentTask?.taskType || "general",
      processStage: parentTask ? "assigned" : "intake",
      followUpDate: "",
      followUpNotes: "",
      assignees: [],
      recurring: "none",
      reassignOnly: false,
    };
  }

  function openNew(parentTask = null) {
    setForm(emptyForm(parentTask));
    setShow(true);
  }

  /* ------------------ derived ------------------ */

  const stats = useMemo(() => ({
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 0).length,
    progress: tasks.filter((t) => t.status === 1).length,
    done: tasks.filter((t) => t.status === 2).length,
    overdue: tasks.filter(isOverdue).length,
  }), [tasks]);

  const sortTasks = useCallback((list) => {
    return [...list].sort((a, b) => {
      if (sortBy === "due") {
        const av = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bv = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return av - bv;
      }
      if (sortBy === "priority") return b.priority - a.priority;
      return b.id - a.id;
    });
  }, [sortBy]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter !== "all")    list = list.filter((t) => t.status === Number(statusFilter));
    if (priorityFilter !== "all")  list = list.filter((t) => t.priority === Number(priorityFilter));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q) ||
          labelFrom(TASK_TYPES, t.taskType).toLowerCase().includes(q) ||
          labelFrom(PROCESS_STAGES, t.processStage, "Intake").toLowerCase().includes(q)
      );
    }
    return sortTasks(list);
  }, [tasks, statusFilter, priorityFilter, query, sortTasks]);

  useEffect(() => {
    const onLocation = () => setLinkedTaskId(taskIdFromLocation());
    window.addEventListener("hashchange", onLocation);
    window.addEventListener("popstate", onLocation);
    return () => {
      window.removeEventListener("hashchange", onLocation);
      window.removeEventListener("popstate", onLocation);
    };
  }, []);

  useEffect(() => {
    if (!linkedTaskId || tasks.length === 0) return;
    const linked = tasks.find((task) => String(task.id) === String(linkedTaskId));
    if (!linked) return;
    setSF("all");
    setPF("all");
    setQuery("");
    window.setTimeout(() => {
      document.getElementById(`task-card-${linkedTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, [linkedTaskId, tasks]);

  const hierarchy = useMemo(() => {
    const byId = new Map(tasks.map((t) => [String(t.id), t]));
    const visibleIds = new Set(filtered.map((t) => String(t.id)));
    const displayIds = new Set(visibleIds);

    for (const task of filtered) {
      let parentId = task.parentTaskId ? String(task.parentTaskId) : "";
      const seen = new Set([String(task.id)]);
      while (parentId && byId.has(parentId) && !seen.has(parentId)) {
        displayIds.add(parentId);
        seen.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent?.parentTaskId ? String(parent.parentTaskId) : "";
      }
    }

    const nodes = new Map();
    for (const id of displayIds) {
      const task = byId.get(id);
      if (task) nodes.set(id, { task, children: [], isContext: !visibleIds.has(id) });
    }

    const roots = [];
    for (const node of nodes.values()) {
      const parentId = node.task.parentTaskId ? String(node.task.parentTaskId) : "";
      const parent = parentId ? nodes.get(parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const sortNodes = (items) => {
      const sorted = sortTasks(items.map((n) => n.task)).map((task) => nodes.get(String(task.id))).filter(Boolean);
      for (const node of sorted) node.children = sortNodes(node.children);
      return sorted;
    };

    return sortNodes(roots);
  }, [tasks, filtered, sortTasks]);

  /* ------------------ render ------------------ */

  return (
    <div className="tp-root">
      <Styles />

      {/* Header */}
      <header className="tp-header mahima-standard-page-header" data-mahima-explicit-header="true">
        <div className="tp-header-inner">
          <div className="tp-brand">
            <div className="tp-logo"><ListTodo size={20} /></div>
            <div>
              <h1 className="tp-title mahima-standard-page-title" data-mahima-explicit-title="true">Tasks</h1>
              <div className="tp-subtitle mahima-standard-page-subtitle">Stay on top of what matters</div>
            </div>
          </div>

          <div className="tp-search">
            <Search size={16} />
            <input
              placeholder="Search tasks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="tp-clear" onClick={() => setQuery("")}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="tp-header-actions">
            <button className="tp-btn ghost" onClick={fetchTasks} title="Refresh">
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              <span className="hide-sm">Refresh</span>
            </button>
            <button className="tp-btn ghost" onClick={() => setShowRadar((v) => !v)} title="Toggle radar">
              <BarChart3 size={15} />
              <span className="hide-sm">Radar</span>
            </button>
            {isAdmin && (
              <button className="tp-btn ghost" onClick={openTaskReport} title="User task completion report">
                <TrendingUp size={15} />
                <span className="hide-sm">Report</span>
              </button>
            )}
            {isAdmin && <button className="tp-btn ghost" onClick={() => { setShowAutoGen(true); }} title="Auto-generate church events">
              <Zap size={15} />
              <span className="hide-sm">Auto-generate</span>
            </button>}
            {isAdmin && <button className="tp-btn ghost" onClick={() => setShowSettings(true)} title="Church event settings">
              <Settings size={15} />
            </button>}
            {isAdmin && (
              <>
                <button className="tp-btn ghost" onClick={() => setShowTemplateAdmin(true)} title="Activity templates">
                  <ListTodo size={15} />
                  <span className="hide-sm">Templates</span>
                </button>
                <button className="tp-btn danger" onClick={() => setShowFlushTasks(true)} title="Flush task activities">
                  <Trash2 size={15} />
                  <span className="hide-sm">Flush</span>
                </button>
              </>
            )}
            {canCreateTask && <button className="tp-btn primary" onClick={openNew}>
              <Plus size={16} /> New task
            </button>}
          </div>
        </div>
      </header>

      <main className="tp-main">

        {/* Stats */}
        <section className="tp-stats">
          <StatCard
            label="Total"
            value={stats.total}
            icon={<Inbox size={18} />}
            color="#047857"
          />
          <StatCard
            label="Pending"
            value={stats.pending}
            icon={<Circle size={18} />}
            color="#f59e0b"
          />
          <StatCard
            label="In Progress"
            value={stats.progress}
            icon={<PlayCircle size={18} />}
            color="#3b82f6"
          />
          <StatCard
            label="Completed"
            value={stats.done}
            icon={<CheckCircle2 size={18} />}
            color="#10b981"
          />
          <StatCard
            label="Overdue"
            value={stats.overdue}
            icon={<Flame size={18} />}
            color="#ef4444"
            highlight={stats.overdue > 0}
          />
        </section>

        {/* Toolbar */}
        <section className="tp-toolbar">
          <div className="tp-chips">
            <Chip active={statusFilter === "all"} onClick={() => setSF("all")}>
              All <span className="count">{stats.total}</span>
            </Chip>
            {Object.entries(STATUS).map(([k, v]) => {
              const Icon = v.icon;
              const count = tasks.filter((t) => t.status === Number(k)).length;
              return (
                <Chip
                  key={k}
                  active={statusFilter === k}
                  onClick={() => setSF(k)}
                  color={v.color}
                >
                  <Icon size={13} /> {v.label} <span className="count">{count}</span>
                </Chip>
              );
            })}
          </div>

          <div className="tp-controls">
            <div className="tp-select-wrap">
              <Flag size={14} />
              <select value={priorityFilter} onChange={(e) => setPF(e.target.value)}>
                <option value="all">All priorities</option>
                {Object.entries(PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            <div className="tp-select-wrap">
              <SortAsc size={14} />
              <select value={sortBy} onChange={(e) => setSort(e.target.value)}>
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
                <option value="newest">Newest</option>
              </select>
            </div>

            <div className="tp-view-toggle">
              <button
                className={view === "grid" ? "on" : ""}
                onClick={() => setView("grid")}
                title="Grid view"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                className={view === "board" ? "on" : ""}
                onClick={() => setView("board")}
                title="Board view"
              >
                <Columns3 size={15} />
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="tp-alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button onClick={() => setError("")}><X size={14} /></button>
          </div>
        )}

        {/* Body */}
        {loading ? (
          <SkeletonGrid />
        ) : filtered.length === 0 ? (
          <EmptyState
            hasAny={tasks.length > 0}
            onClear={() => { setSF("all"); setPF("all"); setQuery(""); }}
            onNew={canCreateTask ? openNew : null}
          />
        ) : view === "grid" ? (
          <TaskHierarchy
            nodes={hierarchy}
            onToggle={toggleStatus}
            onEdit={openEdit}
            onSubTask={canCreateTask ? openNew : null}
            onDelete={setConf}
            onRemind={(t) => { setReminderTask(t); setReminderNote(""); setReminderSent(false); setShowReminder(true); }}
            linkedTaskId={linkedTaskId}
          />
        ) : (
          <Board
            tasks={filtered}
            onToggle={toggleStatus}
            onEdit={openEdit}
            onSubTask={canCreateTask ? openNew : null}
            onDelete={setConf}
            onRemind={(t) => { setReminderTask(t); setReminderNote(""); setReminderSent(false); setShowReminder(true); }}
            linkedTaskId={linkedTaskId}
          />
        )}
      </main>

      {/* FAB on mobile */}
      {canCreateTask && <button className="tp-fab" onClick={openNew} aria-label="New task">
        <Plus size={24} />
      </button>}

      {/* Modal */}
      {showModal && (
        <TaskModal
          form={form}
          setForm={setForm}
          saving={saving}
          users={users}
          teams={teams}
          loadTeamMembers={loadTeamMembers}
          tasks={tasks}
          canManageAutomation={isAdmin}
          onClose={() => setShow(false)}
          onSubmit={handleSave}
        />
      )}

      {/* Confirm delete */}
      {confirmDel && (
        <ConfirmDialog
          title="Delete this task?"
          message={`"${confirmDel.title}" will be permanently removed.`}
          onCancel={() => setConf(null)}
          onConfirm={() => handleDelete(confirmDel.id)}
        />
      )}

      <Toasts items={toast.items} />

      {/* ── Activity Radar panel ── */}
      {showRadar && (
        <div className="tp-radar-wrap">
          <div className="tp-radar-header">
            <BarChart3 size={16} /> Activity Radar
            <button className="tp-radar-close" onClick={() => setShowRadar(false)}><X size={14} /></button>
          </div>
          <div className="tp-radar-body">
            <TaskRadar tasks={tasks} />
            <div className="tp-radar-legend">
              {RADAR_CATEGORIES.map((c) => {
                const count = tasks.filter((t) => t.taskType === c.type).length;
                return (
                  <div key={c.type} className="tp-radar-legend-row">
                    <span className="tp-radar-dot" style={{ background: c.color }} />
                    <span className="tp-radar-legend-label">{c.label}</span>
                    <span className="tp-radar-legend-count">{count}</span>
                  </div>
                );
              })}
              <div className="tp-radar-legend-row" style={{ marginTop: 8, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                <Repeat size={12} style={{ color: "var(--enterprise-primary, #047857)" }} />
                <span className="tp-radar-legend-label">Recurring</span>
                <span className="tp-radar-legend-count">{tasks.filter((t) => t.recurring && t.recurring !== "none").length}</span>
              </div>
              <div className="tp-radar-legend-row">
                <Zap size={12} style={{ color: "#f59e0b" }} />
                <span className="tp-radar-legend-label">Auto-generated</span>
                <span className="tp-radar-legend-count">{tasks.filter((t) => t.isAutoGen).length}</span>
              </div>
            </div>
          </div>
          {/* Upcoming 7 days */}
          <div className="tp-upcoming">
            <div className="tp-upcoming-title"><CalendarCheck size={13} /> Upcoming (next 7 days)</div>
            {tasks
              .filter((t) => {
                if (!t.dueDate || t.status === 2 || t.status === 3) return false;
                const d = new Date(t.dueDate);
                const now = new Date();
                return d >= now && d <= new Date(now.getTime() + 7 * 864e5);
              })
              .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
              .slice(0, 5)
              .map((t) => {
                const daysLeft = t.dueDate
                  ? Math.ceil((new Date(t.dueDate) - new Date()) / (1000 * 60 * 60 * 24))
                  : null;
                // Find the highest-priority threshold already sent for this task
                const sentThreshold = [1, 2, 3, 5, 7].find(
                  (d) => sentReminders[`${t.id}_${d}d`]
                );
                // What's the next upcoming threshold that will fire?
                const nextThreshold = daysLeft !== null
                  ? [7, 5, 3, 2, 1].find((d) => daysLeft <= d && !sentReminders[`${t.id}_${d}d`])
                  : null;
                return (
                  <div key={t.id} className="tp-upcoming-item">
                    <span className="tp-upcoming-dot" style={{ background: PRIORITY[t.priority]?.color ?? "#ccc" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="tp-upcoming-title-text">{t.title}</span>
                      <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                        {sentThreshold && (
                          <span style={{ fontSize: 10, background: "#d1fae5", color: "#065f46", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                            🔔 {sentThreshold}d reminder sent
                          </span>
                        )}
                        {nextThreshold && (
                          <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                            ⏳ {nextThreshold}d reminder upcoming
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="tp-upcoming-date">{dueLabel(t)}</span>
                  </div>
                );
              })}
            {tasks.filter((t) => {
              if (!t.dueDate || t.status === 2 || t.status === 3) return false;
              const d = new Date(t.dueDate); const now = new Date();
              return d >= now && d <= new Date(now.getTime() + 7 * 864e5);
            }).length === 0 && <div className="tp-upcoming-empty">Nothing due this week 🎉</div>}
          </div>
        </div>
      )}

      {/* ── Auto-generate modal ── */}
      {isAdmin && showAutoGen && (
        <AutoGenModal
          churchEvents={churchEvents}
          genSelected={genSelected}
          setGenSelected={setGenSelected}
          genDesign={genDesign}
          setGenDesign={setGenDesign}
          genWeeks={genWeeks}
          setGenWeeks={setGenWeeks}
          generating={generating}
          onGenerate={generateChurchTasks}
          onClose={() => setShowAutoGen(false)}
          existingTasks={tasks}
          templates={activityTemplates}
          users={users}
          teams={teams}
          loadTeamMembers={loadTeamMembers}
        />
      )}

      {/* ── Church event settings modal ── */}
      {isAdmin && showSettings && (
        <ChurchEventSettings
          churchEvents={churchEvents}
          setChurchEvents={(next) => {
            setChurchEvents(next);
            localStorage.setItem("mahima_church_events", JSON.stringify(next));
          }}
          onClose={() => setShowSettings(false)}
          teams={teams}
        />
      )}

      {isAdmin && showTemplateAdmin && (
        <ActivityTemplateAdminModal
          templateJson={templateJson}
          setTemplateJson={setTemplateJson}
          templates={activityTemplates}
          setTemplates={setActivityTemplates}
          onSave={handleSaveActivityTemplates}
          onReset={handleResetActivityTemplates}
          onClose={() => setShowTemplateAdmin(false)}
        />
      )}

      {isAdmin && showFlushTasks && (
        <FlushTasksModal
          flushing={flushing}
          onFlush={handleFlushTasks}
          onClose={() => setShowFlushTasks(false)}
        />
      )}

      {isAdmin && showTaskReport && (
        <TaskReportModal
          rows={taskReportRows}
          loading={taskReportLoading}
          totalTasks={tasks.length}
          onRefresh={openTaskReport}
          onClose={() => setShowTaskReport(false)}
        />
      )}

      {/* ── Jai Masih reminder modal ── */}
      {showReminder && reminderTask && (
        <ReminderModal
          task={reminderTask}
          reminderNote={reminderNote}
          setReminderNote={setReminderNote}
          reminderSent={reminderSent}
          onSend={() => sendReminder(reminderTask, reminderNote)}
          onClose={() => { setShowReminder(false); setReminderSent(false); setReminderNote(""); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, icon, color, highlight }) {
  return (
    <div className={`tp-stat ${highlight ? "highlight" : ""}`}>
      <div className="tp-stat-icon" style={{ background: `${color}15`, color }}>{icon}</div>
      <div>
        <div className="tp-stat-value">{value}</div>
        <div className="tp-stat-label">{label}</div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, color, children }) {
  return (
    <button
      className={`tp-chip ${active ? "active" : ""}`}
      style={active && color ? { background: `${color}15`, color, borderColor: `${color}40` } : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}


function TaskHierarchy({ nodes, linkedTaskId, onToggle, onEdit, onSubTask, onDelete, onRemind }) {
  return (
    <div className="tp-tree">
      {nodes.map((node) => (
        <TaskTreeNode
          key={node.task.id}
          node={node}
          depth={0}
          linkedTaskId={linkedTaskId}
          onToggle={onToggle}
          onEdit={onEdit}
          onSubTask={onSubTask}
          onDelete={onDelete}
          onRemind={onRemind}
        />
      ))}
    </div>
  );
}

function TaskTreeNode({ node, depth, linkedTaskId, onToggle, onEdit, onSubTask, onDelete, onRemind }) {
  const task = node.task;
  return (
    <div className={`tp-tree-node ${depth > 0 ? "is-child" : ""} ${node.isContext ? "is-context" : ""}`} style={{ "--depth": Math.min(depth, 5) }}>
      {depth > 0 && <div className="tp-tree-rail" aria-hidden="true" />}
      <TaskCard
        task={task}
        children={node.children}
        onToggle={() => onToggle(task)}
        onEdit={() => onEdit(task)}
        onSubTask={onSubTask ? () => onSubTask(task) : null}
        onDelete={() => onDelete(task)}
        onRemind={() => onRemind(task)}
        linked={String(linkedTaskId || "") === String(task.id)}
      />
      {node.children.length > 0 && (
        <div className="tp-tree-children">
          {node.children.map((child) => (
            <TaskTreeNode
              key={child.task.id}
              node={child}
              depth={depth + 1}
              linkedTaskId={linkedTaskId}
              onToggle={onToggle}
              onEdit={onEdit}
              onSubTask={onSubTask}
              onDelete={onDelete}
              onRemind={onRemind}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, children = [], linked = false, onToggle, onEdit, onSubTask, onDelete, onRemind }) {
  const status = STATUS[task.status];
  const priority = PRIORITY[task.priority];
  const overdue = isOverdue(task);
  const StatusIcon = status.icon;
  const completed = task.status === 2;
  const readOnly = task.readOnly || task.canUpdate === false;
  const readOnlyTitle = readOnlyMessage(task);
  const childTotal = children.length || task.subTaskCount || 0;
  const childDone = children.filter((child) => child.task?.status === 2).length;
  const childHealth = childTotal ? Math.round((childDone / childTotal) * 100) : null;

  return (
    <article id={`task-card-${task.id}`} className={`tp-card ${completed ? "done" : ""} ${overdue ? "overdue" : ""} ${readOnly ? "read-only" : ""} ${linked ? "linked" : ""}`}>
      <div className="tp-card-bar" style={{ background: priority.color }} />
      <div className="tp-card-body">
        <div className="tp-card-head">
          <button
            className="tp-check"
            onClick={onToggle}
            title={completed ? "Mark as pending" : "Mark as complete"}
            style={completed ? { background: status.color, borderColor: status.color, color: "#fff" } : undefined}
          >
            {completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
          </button>
          <div className="tp-card-title-wrap">
            <h3 className="tp-card-title">{task.title}</h3>
            {task.description ? (
              <p className="tp-card-desc">{task.description}</p>
            ) : (
              <p className="tp-card-desc empty">No description</p>
            )}
          </div>
        </div>

        <div className="tp-card-meta">
          <span
            className="tp-pill"
            style={{ background: status.soft, color: status.color }}
          >
            <StatusIcon size={12} /> {status.label}
          </span>
          <span
            className="tp-pill"
            style={{ background: priority.soft, color: priority.color }}
          >
            <Flag size={12} /> {priority.label}
          </span>
          <span className={`tp-pill due ${overdue ? "overdue" : ""}`}>
            <Clock size={12} /> {dueLabel(task)}
          </span>
          <span className="tp-pill">
            <Filter size={12} /> {labelFrom(TASK_TYPES, task.taskType)}
          </span>
          <span className="tp-pill">
            <ListTodo size={12} /> {labelFrom(PROCESS_STAGES, task.processStage, "Intake")}
          </span>
          {task.parentTaskId ? <span className="tp-pill">Subtask</span> : null}
          {childTotal > 0 ? <span className="tp-pill">{childDone}/{childTotal} sub-activities · {childHealth}% health</span> : null}
          {task.followUpDate ? <span className="tp-pill due"><CalendarDays size={12} /> Follow up {fmtDate(task.followUpDate)}</span> : null}
          {task.recurring && task.recurring !== "none" && (
            <span className="tp-pill tp-pill-recur"><Repeat size={11} /> {task.recurring}</span>
          )}
          {task.isAutoGen && (
            <span className="tp-pill tp-pill-autogen"><Zap size={11} /> Auto</span>
          )}
          {readOnly ? <span className="tp-pill readonly" title={readOnlyTitle}>Read-only</span> : null}
        </div>

        <div className="tp-card-actions">
          <AvatarStack assignees={task.assignees} max={3} />
          <div className="tp-card-actions-end">
            <button className="tp-icon-btn remind" onClick={onRemind} title="Send Jai Masih reminder">
              <Bell size={14} />
            </button>
            {onSubTask && <button className="tp-icon-btn" onClick={onSubTask} title={readOnly ? readOnlyTitle : "Add follow-up subtask"} disabled={readOnly}>
              <Plus size={14} />
            </button>}
            <button className="tp-icon-btn" onClick={onEdit} title={readOnly ? readOnlyTitle : "Edit"} disabled={readOnly}>
              <Pencil size={14} />
            </button>
            {task.canDelete && <button className="tp-icon-btn danger" onClick={onDelete} title="Delete">
              <Trash2 size={14} />
            </button>}
          </div>
        </div>
      </div>
    </article>
  );
}

function Board({ tasks, linkedTaskId, onToggle, onEdit, onSubTask, onDelete, onRemind }) {
  const cols = Object.entries(STATUS).map(([k, v]) => ({
    key: Number(k),
    label: v.label,
    color: v.color,
    soft: v.soft,
    icon: v.icon,
    tasks: tasks.filter((t) => t.status === Number(k)),
  }));
  return (
    <div className="tp-board">
      {cols.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.key} className="tp-col">
            <header className="tp-col-head" style={{ borderTopColor: c.color }}>
              <span className="tp-col-title" style={{ color: c.color }}>
                <Icon size={14} /> {c.label}
              </span>
              <span className="tp-col-count">{c.tasks.length}</span>
            </header>
            <div className="tp-col-body">
              {c.tasks.length === 0 ? (
                <div className="tp-col-empty">No tasks</div>
              ) : (
                c.tasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onToggle={() => onToggle(t)}
                    onEdit={() => onEdit(t)}
                    onSubTask={onSubTask ? () => onSubTask(t) : null}
                    onDelete={() => onDelete(t)}
                    onRemind={() => onRemind(t)}
                    linked={String(linkedTaskId || "") === String(t.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ hasAny, onClear, onNew }) {
  return (
    <div className="tp-empty">
      <div className="tp-empty-art">
        <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden>
          <defs>
            <linearGradient id="eg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="56" fill="#ecfdf5" />
          <rect x="34" y="36" width="52" height="56" rx="8" fill="#fff" stroke="url(#eg)" strokeWidth="2" />
          <path d="M44 52h32M44 64h32M44 76h20" stroke="#a7f3d0" strokeWidth="3" strokeLinecap="round" />
          <circle cx="86" cy="38" r="14" fill="url(#eg)" />
          <path d="M80 38l4 4 8-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
      <h3>{hasAny ? "Nothing matches your filters" : "All clear"}</h3>
      <p>
        {hasAny
          ? "Try clearing filters or adjusting your search."
          : "Create your first task to get started."}
      </p>
      <div className="tp-empty-actions">
        {hasAny ? (
          <button className="tp-btn ghost" onClick={onClear}>Clear filters</button>
        ) : null}
        {onNew && <button className="tp-btn primary" onClick={onNew}>
          <Plus size={16} /> New task
        </button>}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="tp-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="tp-card skeleton" key={i}>
          <div className="tp-card-bar" />
          <div className="tp-card-body">
            <div className="sk sk-line w70" />
            <div className="sk sk-line w90" />
            <div className="sk sk-line w50" />
            <div className="tp-card-meta">
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------ Avatars ------------------ */

function Avatar({ entity, size = 26, ring = true }) {
  if (!entity) return null;
  const isTeam = entity.type === "team";
  const bg = entity.color || colorFor(`${entity.type}-${entity.id}-${entity.name}`);
  const style = {
    width: size, height: size,
    background: entity.avatarUrl ? "transparent" : bg,
    color: "#fff",
    fontSize: Math.max(9, Math.round(size * 0.42)),
    boxShadow: ring ? "0 0 0 2px #fff" : "none",
  };
  const title = isTeam
    ? `${entity.name}${entity.memberCount ? ` (${entity.memberCount})` : ""} · Team`
    : `${entity.name}${entity.email ? ` · ${entity.email}` : ""}`;

  return (
    <span className={`tp-avatar ${isTeam ? "is-team" : ""}`} style={style} title={title}>
      {entity.avatarUrl ? (
        <img src={entity.avatarUrl} alt={entity.name} />
      ) : isTeam ? (
        <Users size={Math.round(size * 0.5)} />
      ) : (
        initials(entity.name)
      )}
    </span>
  );
}

function AvatarStack({ assignees = [], max = 3 }) {
  if (!assignees || assignees.length === 0) {
    return (
      <span className="tp-assignee-empty" title="Unassigned">
        <User size={13} /> Unassigned
      </span>
    );
  }
  const shown = assignees.slice(0, max);
  const extra = assignees.length - shown.length;
  return (
    <div className="tp-stack">
      {shown.map((a) => (
        <Avatar key={`${a.type}-${a.id}`} entity={a} />
      ))}
      {extra > 0 && (
        <span
          className="tp-avatar tp-avatar-more"
          title={assignees.slice(max).map((a) => a.name).join(", ")}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

/* ------------------ Assignee picker ------------------ */

function AssigneePicker({ users, teams, selected, onChange, loadTeamMembers }) {
  const [open, setOpen]               = useState(false);
  const [query, setQuery]             = useState("");
  const [expandedTeams, setExpanded]  = useState({});  // { [teamId]: true }
  const [teamMembers, setTeamMembers] = useState({});  // { [teamId]: [userId, ...] }
  const [loadingTeam, setLoadingTeam] = useState({});

  // user lookup by string id, for team-member resolution
  const userIndex = useMemo(() => {
    const m = new Map();
    (users || []).forEach((u) => m.set(String(u.id), u));
    return m;
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users || [];
    return (users || []).filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [users, query]);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams || [];
    return (teams || []).filter((t) => (t.name || "").toLowerCase().includes(q));
  }, [teams, query]);

  const isSelected = (e) => selected.some((s) => sameAssignee(s, e));

  const toggleEntity = (e) => {
    if (isSelected(e)) onChange(selected.filter((s) => !sameAssignee(s, e)));
    else onChange([...selected, e]);
  };
  const remove = (e) => onChange(selected.filter((s) => !sameAssignee(s, e)));

  async function expandTeam(team) {
    const id = String(team.id);
    setExpanded((s) => ({ ...s, [id]: !s[id] }));
    if (!teamMembers[id]) {
      setLoadingTeam((s) => ({ ...s, [id]: true }));
      const ids = await loadTeamMembers(team.id);
      setTeamMembers((s) => ({ ...s, [id]: ids }));
      setLoadingTeam((s) => ({ ...s, [id]: false }));
    }
  }

  function addAllMembers(team) {
    const id = String(team.id);
    const ids = teamMembers[id] || [];
    if (ids.length === 0) return;
    const toAdd = ids
      .map((uid) => userIndex.get(String(uid)))
      .filter(Boolean)
      .filter((u) => !selected.some((s) => sameAssignee(s, u)));
    if (toAdd.length) onChange([...selected, ...toAdd]);
  }

  return (
    <div className={`tp-picker ${open ? "open" : ""}`}>
      <div
        className="tp-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className="tp-picker-chips">
          {selected.length === 0 ? (
            <span className="tp-picker-placeholder">
              <Users size={14} /> Assign people or teams...
            </span>
          ) : (
            selected.map((a) => (
              <span key={`${a.type}-${a.id}`} className="tp-chip-selected">
                <Avatar entity={a} size={18} ring={false} />
                <span className="tp-chip-name">{a.name}</span>
                {a.type === "team" && <span className="tp-tag-team">team</span>}
                <span
                  className="tp-chip-remove"
                  role="button"
                  tabIndex={0}
                  onClick={(ev) => { ev.stopPropagation(); remove(a); }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      remove(a);
                    }
                  }}
                >
                  <X size={12} />
                </span>
              </span>
            ))
          )}
        </div>
        <ChevronDown size={16} className={`tp-picker-caret ${open ? "open" : ""}`} />
      </div>

      {open && (
        <div className="tp-picker-panel">
          <div className="tp-picker-search">
            <Search size={14} />
            <input
              autoFocus
              placeholder="Search people or teams..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="tp-picker-list">
            {filteredTeams.length === 0 && filteredUsers.length === 0 ? (
              <div className="tp-picker-empty">No matches</div>
            ) : (
              <>
                {filteredTeams.length > 0 && (
                  <>
                    <div className="tp-picker-group">Teams</div>
                    {filteredTeams.map((team) => {
                      const id = String(team.id);
                      const expanded = !!expandedTeams[id];
                      const memberIds = teamMembers[id] || [];
                      const loading = !!loadingTeam[id];
                      return (
                        <div key={`team-${id}`} className="tp-team-block">
                          <div className={`tp-picker-row ${isSelected(team) ? "selected" : ""}`}>
                            <button
                              type="button"
                              className="tp-row-tap"
                              onClick={() => toggleEntity(team)}
                            >
                              <Avatar entity={team} size={28} ring={false} />
                              <div className="tp-picker-row-text">
                                <div className="tp-picker-row-name">{team.name}</div>
                                <div className="tp-picker-row-sub">Team</div>
                              </div>
                              <span className={`tp-picker-check ${isSelected(team) ? "on" : ""}`}>
                                {isSelected(team) ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="tp-team-expand"
                              onClick={(e) => { e.stopPropagation(); expandTeam(team); }}
                              title={expanded ? "Hide members" : "Show members"}
                              aria-expanded={expanded}
                            >
                              <ChevronDown size={15} className={expanded ? "rot" : ""} />
                            </button>
                          </div>

                          {expanded && (
                            <div className="tp-team-members">
                              {loading ? (
                                <div className="tp-picker-empty small">
                                  <Loader2 size={13} className="spin" /> Loading members…
                                </div>
                              ) : memberIds.length === 0 ? (
                                <div className="tp-picker-empty small">No members in this team</div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="tp-add-all"
                                    onClick={() => addAllMembers(team)}
                                  >
                                    <Plus size={13} /> Add all {memberIds.length} member{memberIds.length === 1 ? "" : "s"} as individuals
                                  </button>
                                  {memberIds.map((uid) => {
                                    const u = userIndex.get(String(uid));
                                    if (!u) return (
                                      <div key={`m-${uid}`} className="tp-picker-empty small">
                                        Unknown user · {String(uid).slice(0, 8)}…
                                      </div>
                                    );
                                    return (
                                      <PickerRow
                                        key={`m-${uid}`}
                                        entity={u}
                                        selected={isSelected(u)}
                                        onToggle={() => toggleEntity(u)}
                                        compact
                                      />
                                    );
                                  })}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {filteredUsers.length > 0 && (
                  <>
                    <div className="tp-picker-group">People</div>
                    {filteredUsers.map((u) => (
                      <PickerRow
                        key={`user-${u.id}`}
                        entity={u}
                        selected={isSelected(u)}
                        onToggle={() => toggleEntity(u)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          <div className="tp-picker-foot">
            <span className="tp-picker-count">
              {selected.length} selected
            </span>
            <button type="button" className="tp-picker-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({ entity, selected, onToggle, compact = false }) {
  return (
    <button
      type="button"
      className={`tp-picker-row ${selected ? "selected" : ""} ${compact ? "compact" : ""}`}
      onClick={onToggle}
    >
      <Avatar entity={entity} size={compact ? 24 : 28} ring={false} />
      <div className="tp-picker-row-text">
        <div className="tp-picker-row-name">{entity.name}</div>
        <div className="tp-picker-row-sub">
          {entity.type === "team"
            ? `Team${entity.memberCount ? ` · ${entity.memberCount} members` : ""}`
            : entity.email || "User"}
        </div>
      </div>
      <span className={`tp-picker-check ${selected ? "on" : ""}`}>
        {selected ? <CheckCircle2 size={16} /> : <Circle size={16} />}
      </span>
    </button>
  );
}

/* ------------------ Modal ------------------ */

function TaskModal({ form, setForm, saving, users, teams, loadTeamMembers, tasks, canManageAutomation, onClose, onSubmit }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <form className="tp-modal" onSubmit={onSubmit}>
        <header className="tp-modal-head">
          <div>
            <h2>{form.reassignOnly ? "Reassign task" : form.id ? "Edit task" : "New task"}</h2>
            <p>{form.reassignOnly ? "Read-only task access; reassignment is limited to your active position." : form.id ? "Update the details below." : "What needs to get done?"}</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className={`tp-modal-body${form.reassignOnly ? " reassign-only" : ""}`}>
          <Field label="Title" required>
            <input
              autoFocus
              placeholder="e.g. Ship onboarding flow"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
            />
          </Field>

          <Field label="Description">
            <textarea
              rows={4}
              placeholder="Add notes, links, acceptance criteria..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <div className="tp-row-2">
            <Field label="Task type">
              <select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Process stage">
              <select value={form.processStage} onChange={(e) => setForm({ ...form, processStage: e.target.value })}>
                {PROCESS_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Parent task / follow-up of">
            <select value={form.parentTaskId || ""} onChange={(e) => setForm({ ...form, parentTaskId: e.target.value })}>
              <option value="">Top-level task</option>
              {(tasks || []).filter((t) => String(t.id) !== String(form.id)).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            <div className="tp-field-hint">Use this to create follow-up activities and subtasks under a larger process.</div>
          </Field>

          {form.id ? <Field label="Assignees" className="reassign-field">
            <AssigneePicker
              users={users}
              teams={teams}
              selected={form.assignees || []}
              onChange={(next) => setForm({ ...form, assignees: next })}
              loadTeamMembers={loadTeamMembers}
            />
            {(users.length === 0 && teams.length === 0) && (
              <div className="tp-field-hint">
                No people or teams loaded. Make sure <code>/api/users</code> and <code>/api/teams</code> are reachable.
              </div>
            )}
          </Field> : (
            <div className="tp-field-hint">
              This task will initially be assigned to you. After creating it, you can reassign it according to your role and position access.
            </div>
          )}

          <div className="tp-row-2">
            <Field label="Follow-up date">
              <div className="tp-date-input">
                <CalendarDays size={15} />
                <input
                  type="date"
                  value={form.followUpDate}
                  onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                />
              </div>
            </Field>
            <Field label="Follow-up notes">
              <input
                value={form.followUpNotes}
                onChange={(e) => setForm({ ...form, followUpNotes: e.target.value })}
                placeholder="Call, visit, reminder, review..."
              />
            </Field>
          </div>

          <Field label="Due date">
            <div className="tp-date-input">
              <CalendarDays size={15} />
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </Field>

          {canManageAutomation && <Field label="Recurring">
            <select value={form.recurring || "none"} onChange={(e) => setForm({ ...form, recurring: e.target.value })}>
              {RECUR_PATTERNS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>}
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="tp-btn primary" disabled={saving}>
            {saving ? <><Loader2 size={15} className="spin" /> Saving…</> : (form.reassignOnly ? "Reassign task" : form.id ? "Save changes" : "Create task")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, required, children, className = "" }) {
  return (
    <label className={`tp-field ${className}`}>
      <span className="tp-field-label">
        {label}{required && <span className="req">*</span>}
      </span>
      {children}
    </label>
  );
}

function ConfirmDialog({ title, message, onCancel, onConfirm }) {
  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onCancel()}>
      <div className="tp-confirm">
        <div className="tp-confirm-icon"><AlertTriangle size={22} /></div>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="tp-confirm-actions">
          <button className="tp-btn ghost" onClick={onCancel}>Cancel</button>
          <button className="tp-btn danger" onClick={onConfirm}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task Radar (SVG spider chart)                                      */
/* ------------------------------------------------------------------ */

function TaskRadar({ tasks }) {
  const N  = RADAR_CATEGORIES.length;
  const R  = 70;
  const cx = 90;
  const cy = 90;

  const counts = useMemo(() => {
    const map = {};
    RADAR_CATEGORIES.forEach((c) => { map[c.type] = 0; });
    tasks.forEach((t) => { if (map[t.taskType] !== undefined) map[t.taskType]++; });
    return map;
  }, [tasks]);

  const maxCount = Math.max(...Object.values(counts), 1);

  const pts = RADAR_CATEGORIES.map((cat, i) => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    const r = (counts[cat.type] / maxCount) * R;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      lx: cx + (R + 20) * Math.cos(angle),
      ly: cy + (R + 20) * Math.sin(angle),
      cat,
    };
  });

  const gridLine = (scale) =>
    RADAR_CATEGORIES.map((_, i) => {
      const angle = (2 * Math.PI * i) / N - Math.PI / 2;
      return `${cx + R * scale * Math.cos(angle)},${cy + R * scale * Math.sin(angle)}`;
    }).join(" ");

  const dataPath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + "Z";

  return (
    <svg viewBox="0 0 180 180" width="180" height="180" style={{ overflow: "visible", flexShrink: 0 }}>
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <polygon key={s} points={gridLine(s)} fill="none" stroke="#e5e7eb" strokeWidth={s === 1 ? 1.5 : 0.7} />
      ))}
      {RADAR_CATEGORIES.map((_, i) => {
        const angle = (2 * Math.PI * i) / N - Math.PI / 2;
        return (
          <line key={i} x1={cx} y1={cy}
            x2={cx + R * Math.cos(angle)} y2={cy + R * Math.sin(angle)}
            stroke="#e5e7eb" strokeWidth={0.7} />
        );
      })}
      <polygon points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="rgba(4,120,87,0.15)" stroke="#047857" strokeWidth={2} />
      {pts.map((p) => (
        <circle key={p.cat.type} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={3}
          fill={p.cat.color} stroke="#fff" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Auto-generate modal                                                */
/* ------------------------------------------------------------------ */

function AutoGenModal({
  churchEvents,
  genSelected,
  setGenSelected,
  genDesign,
  setGenDesign,
  genWeeks,
  setGenWeeks,
  generating,
  onGenerate,
  onClose,
  existingTasks,
  templates = [],
  users = [],
  teams = [],
  loadTeamMembers,
}) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const parentTasks = existingTasks.filter((t) => !t.parentTaskId);

  const updateDesign = (eventId, patch) => {
    setGenDesign((prev) => ({
      ...prev,
      [eventId]: {
        ...(prev[eventId] || {}),
        ...patch,
      },
    }));
  };

  const updateActivityAssignees = (eventId, activityId, assignees) => {
    setGenDesign((prev) => {
      const current = prev[eventId] || {};
      return {
        ...prev,
        [eventId]: {
          ...current,
          assigneesByActivity: {
            ...(current.assigneesByActivity || {}),
            [activityId]: assignees,
          },
        },
      };
    });
  };

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <div className="tp-modal" style={{ maxWidth: 540 }}>
        <header className="tp-modal-head">
          <div>
            <h2><Zap size={18} style={{ verticalAlign: "middle", marginRight: 6, color: "#f59e0b" }} />Auto-generate Church Tasks</h2>
            <p>Create tasks for upcoming church events automatically.</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="tp-modal-body">
          <div className="tp-field">
            <span className="tp-field-label">Generate for how many weeks?</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {[1, 2, 4, 8, 12].map((w) => (
                <button key={w} type="button"
                  className={`tp-gen-chip${genWeeks === w ? " active" : ""}`}
                  onClick={() => setGenWeeks(w)}>
                  {w}w
                </button>
              ))}
            </div>
          </div>

          <div className="tp-field" style={{ marginTop: 14 }}>
            <span className="tp-field-label">Select events</span>
            <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
              {churchEvents.map((evt) => {
                const sel = genSelected.has(evt.id);
                const design = genDesign[evt.id] || {};
                const probeDate = nextOccurrence(evt.day, evt.time).toISOString();
                const probeTask = {
                  title: evt.label,
                  dueDate: probeDate,
                  eventRef: `${evt.id}_${new Date(probeDate).toDateString()}`,
                };
                const selectedTemplate = templates.find((tpl) => tpl.id === design.templateId)
                  || findEventTemplate(probeTask, evt, templates);
                const upcoming = [];
                for (let w = 0; w < Math.min(genWeeks, 3); w++) {
                  const d = nextOccurrence(evt.day, evt.time);
                  d.setDate(d.getDate() + w * 7);
                  upcoming.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
                }
                const dupCount = existingTasks.filter((t) => t.eventRef?.startsWith(evt.id)).length;
                const resolvedTeam = smartMatchTeam(evt.taskType, evt.label, teams, evt.defaultTeamId);
                return (
                  <div key={evt.id}
                    className={`tp-gen-card${sel ? " selected" : ""}`}
                    onClick={() => setGenSelected((prev) => {
                      const next = new Set(prev);
                      next.has(evt.id) ? next.delete(evt.id) : next.add(evt.id);
                      return next;
                    })}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>{evt.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{evt.label}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          {DAYS[evt.day]} · {evt.time} · {upcoming.join(", ")}
                          {dupCount > 0 && <span style={{ color: "#f59e0b", marginLeft: 6 }}>({dupCount} already exist)</span>}
                        </div>
                        {resolvedTeam ? (
                      <div style={{ marginTop: 3, fontSize: 11, color: "var(--enterprise-primary-strong, #065f46)", fontWeight: 600 }}>
                            👥 Auto-assign → {resolvedTeam.name}
                            {evt.defaultTeamId ? " (explicit)" : " (smart match)"}
                          </div>
                        ) : (
                          <div style={{ marginTop: 3, fontSize: 11, color: "#9ca3af" }}>
                            No team matched — assign manually after
                          </div>
                        )}
                      </div>
                      <input type="checkbox" readOnly checked={sel} style={{ width: 16, height: 16, accentColor: "var(--enterprise-primary, #047857)" }} />
                    </div>
                    {sel && (
                      <div className="tp-gen-design" onClick={(e) => e.stopPropagation()}>
                        <div className="tp-gen-design-row">
                          <Field label="Parent task for sub-activities">
                            <select
                              value={design.parentTaskId || ""}
                              onChange={(e) => updateDesign(evt.id, { parentTaskId: e.target.value || "" })}
                            >
                              <option value="">Auto-create parent for each week</option>
                              {parentTasks.map((task) => (
                                <option key={task.id} value={task.id}>
                                  {task.title}{task.dueDate ? ` · ${fmtDate(task.dueDate)}` : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Sub-activity template">
                            <select
                              value={design.templateId || ""}
                              onChange={(e) => updateDesign(evt.id, { templateId: e.target.value || "" })}
                            >
                              <option value="">Auto-match template</option>
                              {templates.map((tpl) => (
                                <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Notification language">
                            <select
                              value={normalizeNotificationLanguage(design.notificationLanguage || selectedTemplate?.notificationLanguage)}
                              onChange={(e) => updateDesign(evt.id, { notificationLanguage: e.target.value })}
                            >
                              {TASK_NOTIFICATION_LANGUAGES.map((language) => (
                                <option key={language.value} value={language.value}>{language.label}</option>
                              ))}
                            </select>
                          </Field>
                        </div>

                        {selectedTemplate?.activities?.length > 0 && (
                          <div className="tp-gen-activities">
                            {selectedTemplate.activities.map((activity) => {
                              const manual = design.assigneesByActivity?.[activity.id] || [];
                              const fallback = resolveActivityAssignees(activity, users, teams);
                              return (
                                <div key={activity.id} className="tp-gen-activity">
                                  <div className="tp-gen-activity-head">
                                    <div>
                                      <strong>{activity.title}</strong>
                                      <span>{normalizeOffsetHours(activity.offsetHours)}h · {labelFrom(TASK_TYPES, activity.taskType)} · {notificationLanguageLabel(design.notificationLanguage || selectedTemplate?.notificationLanguage)}</span>
                                    </div>
                                    {manual.length === 0 && fallback.length > 0 ? (
                                      <AvatarStack assignees={fallback} max={4} />
                                    ) : null}
                                  </div>
                                  <AssigneePicker
                                    users={users}
                                    teams={teams}
                                    selected={manual}
                                    onChange={(next) => updateActivityAssignees(evt.id, activity.id, next)}
                                    loadTeamMembers={loadTeamMembers}
                                  />
                                  <div className="tp-field-hint">
                                    {manual.length > 0
                                      ? "Manual assignment will be used for this sub-activity."
                                      : "No manual override. Auto assignment will use template audience rules."}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 12, color: "#166534" }}>
            Will create up to <strong>{genSelected.size * genWeeks}</strong> tasks (skipping duplicates).
          </div>
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="tp-btn primary" disabled={generating || genSelected.size === 0} onClick={onGenerate}>
            {generating ? <><Loader2 size={14} className="spin" /> Generating…</> : <><Zap size={14} /> Generate {genSelected.size * genWeeks} tasks</>}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Church event settings modal                                        */
/* ------------------------------------------------------------------ */

function ChurchEventSettings({ churchEvents, setChurchEvents, onClose, teams = [] }) {
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const update = (idx, key, val) => {
    const next = churchEvents.map((e, i) => i === idx ? { ...e, [key]: val } : e);
    setChurchEvents(next);
  };

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <div className="tp-modal" style={{ maxWidth: 560 }}>
        <header className="tp-modal-head">
          <div>
            <h2><Settings size={18} style={{ verticalAlign: "middle", marginRight: 6 }} />Church Event Settings</h2>
            <p>Customise the recurring events used for auto-generation.</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="tp-modal-body">
          {churchEvents.map((evt, idx) => (
            <div key={evt.id} style={{ padding: 14, borderRadius: 12, border: "1px solid #e5e7eb", marginBottom: 10, background: "#fafafa" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Event name">
                  <input value={evt.label} onChange={(e) => update(idx, "label", e.target.value)} />
                </Field>
                <Field label="Icon (emoji)">
                  <input value={evt.icon} onChange={(e) => update(idx, "icon", e.target.value)} style={{ maxWidth: 80 }} />
                </Field>
                <Field label="Day of week">
                  <select value={evt.day} onChange={(e) => update(idx, "day", Number(e.target.value))}>
                    {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Time">
                  <input type="time" value={evt.time} onChange={(e) => update(idx, "time", e.target.value)} />
                </Field>
                {teams.length > 0 && (
                  <Field label="Default Team (explicit)" style={{ gridColumn: "1 / -1" }}>
                    <select
                      value={evt.defaultTeamId || ""}
                      onChange={(e) => update(idx, "defaultTeamId", e.target.value || null)}>
                      <option value="">— Use smart auto-match —</option>
                      {teams.map((t) => (
                        <option key={t.id} value={String(t.id)}>{t.name}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
                      If set, always assigns this team. Otherwise, smart keyword matching is used.
                    </div>
                  </Field>
                )}
              </div>
            </div>
          ))}
          <button type="button" className="tp-btn ghost" style={{ width: "100%", marginTop: 4, justifyContent: "center" }}
            onClick={() => setChurchEvents([...churchEvents, { id: `custom_${Date.now()}`, label: "New Event", day: 0, time: "10:00", taskType: "event", priority: 2, icon: "⛪" }])}>
            <Plus size={14} /> Add event
          </button>
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost"
            onClick={() => { setChurchEvents(CHURCH_EVENTS_DEFAULT); localStorage.removeItem("mahima_church_events"); }}>
            Reset defaults
          </button>
          <button type="button" className="tp-btn primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin maintenance modals                                           */
/* ------------------------------------------------------------------ */

function FlushTasksModal({ flushing, onFlush, onClose }) {
  const [range, setRange] = useState("1d");

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && !flushing && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [flushing, onClose]);

  const selected = TASK_FLUSH_RANGES.find((item) => item.value === range);

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && !flushing && onClose()}>
      <div className="tp-modal" style={{ maxWidth: 520 }}>
        <header className="tp-modal-head">
          <div>
            <h2><Trash2 size={18} style={{ verticalAlign: "middle", marginRight: 6, color: "#ef4444" }} />Flush Tasks & Activities</h2>
            <p>Admin-only cleanup for tasks and generated sub-activities created in the selected period.</p>
          </div>
          <button type="button" className="tp-icon-btn" disabled={flushing} onClick={onClose}><X size={16} /></button>
        </header>

        <div className="tp-modal-body">
          <div className="tp-flush-grid">
            {TASK_FLUSH_RANGES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`tp-gen-chip${range === item.value ? " active danger" : ""}`}
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="tp-danger-note">
            This will permanently remove master tasks, sub-activities, task assignees, and activity logs from {selected?.label.toLowerCase()}.
          </div>
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" disabled={flushing} onClick={onClose}>Cancel</button>
          <button type="button" className="tp-btn danger" disabled={flushing} onClick={() => onFlush(range)}>
            {flushing ? <><Loader2 size={14} className="spin" /> Flushing...</> : <><Trash2 size={14} /> Flush {selected?.label}</>}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ActivityTemplateAdminModal({ templateJson, setTemplateJson, templates, setTemplates, onSave, onReset, onClose }) {
  const [tab, setTab] = useState("messages");
  const [messageLanguage, setMessageLanguage] = useState(DEFAULT_TASK_NOTIFICATION_LANGUAGE);
  const [draftTemplates, setDraftTemplates] = useState(() => hydrateActivityTemplates(templates));
  const [activeTemplateId, setActiveTemplateId] = useState(() => hydrateActivityTemplates(templates)[0]?.id || "");

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const saveMessageTemplates = () => {
    const hydrated = hydrateActivityTemplates(draftTemplates);
    const serialized = serializeActivityTemplates(hydrated);
    localStorage.setItem(ACTIVITY_TEMPLATE_STORAGE_KEY, JSON.stringify(serialized, null, 2));
    setTemplates(hydrated);
    setTemplateJson(JSON.stringify(serialized, null, 2));
    onClose();
  };

  const resetMessages = () => {
    const defaults = hydrateActivityTemplates(EVENT_ACTIVITY_TEMPLATES);
    setDraftTemplates(defaults);
    setActiveTemplateId(defaults[0]?.id || "");
    setTemplateJson(JSON.stringify(serializeActivityTemplates(defaults), null, 2));
  };

  const activeTemplate = useMemo(
    () => draftTemplates.find((tpl) => tpl.id === activeTemplateId) || draftTemplates[0],
    [draftTemplates, activeTemplateId]
  );

  useEffect(() => {
    if (draftTemplates.length && !draftTemplates.some((tpl) => tpl.id === activeTemplateId)) {
      setActiveTemplateId(draftTemplates[0].id);
    }
  }, [draftTemplates, activeTemplateId]);

  const updateActivity = (templateId, activityId, patch) => {
    setDraftTemplates((prev) => prev.map((tpl) => tpl.id !== templateId
      ? tpl
      : {
          ...tpl,
          activities: tpl.activities.map((activity) => {
            if (activity.id !== activityId) return activity;
            const messageTemplates = {
              ...messageTemplatesFor(activity),
              ...(patch.messageTemplates || {}),
            };
            if (patch.messageTemplate != null) messageTemplates.en = patch.messageTemplate;
            const next = {
              ...activity,
              ...patch,
              messageTemplates,
              messageTemplate: messageTemplates.en,
            };
            return {
              ...next,
              message: (eventTitle, language = DEFAULT_TASK_NOTIFICATION_LANGUAGE) => localizedMessageFor(next, eventTitle, language),
            };
          }),
        }));
  };

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <div className="tp-modal tp-template-modal" style={{ width: "min(1240px, calc(100vw - 32px))", maxWidth: 1240 }}>
        <header className="tp-modal-head">
          <div>
            <h2><ListTodo size={18} style={{ verticalAlign: "middle", marginRight: 6, color: "var(--enterprise-primary, #047857)" }} />Task Messages</h2>
            <p>Map standard Jai Masih messages to generated tasks. Use {"{eventTitle}"} where the task name should appear.</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="tp-modal-body">
          <div className="tp-template-tabs">
            <button type="button" className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>Task Messages</button>
            <button type="button" className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>Advanced JSON</button>
          </div>

          {tab === "messages" ? (
            <div className="tp-template-workspace">
              <aside className="tp-template-nav" aria-label="Task message template groups">
                {draftTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`tp-template-nav-item${activeTemplate?.id === tpl.id ? " active" : ""}`}
                    onClick={() => setActiveTemplateId(tpl.id)}
                  >
                    <span>{tpl.label}</span>
                    <strong>{tpl.activities.length}</strong>
                  </button>
                ))}
              </aside>

              <section className="tp-template-editor-panel">
                <div className="tp-template-panel-head">
                  <div>
                    <h3>{activeTemplate?.label || "Task Messages"}</h3>
                    <p>{activeTemplate?.activities?.length || 0} standard messages mapped to generated tasks.</p>
                  </div>
                  <div className="tp-template-language-tabs">
                    {TASK_NOTIFICATION_LANGUAGES.map((language) => (
                      <button
                        key={language.value}
                        type="button"
                        className={messageLanguage === language.value ? "active" : ""}
                        onClick={() => setMessageLanguage(language.value)}
                        title={language.label}
                      >
                        {language.short}
                      </button>
                    ))}
                  </div>
                  <span className="tp-template-token">{"{eventTitle}"}</span>
                </div>

                <div className="tp-message-template-list">
                  {(activeTemplate?.activities || []).map((activity, index) => (
                    <div key={activity.id} className="tp-message-template-card">
                      <div className="tp-message-template-card-head">
                        <span>Message {index + 1}</span>
                        <strong>{TASK_TYPES.find((type) => type.value === activity.taskType)?.label || "General"}</strong>
                      </div>
                      <div className="tp-message-template-meta three">
                        <label>
                          <span>Task title</span>
                          <input
                            value={activity.title || ""}
                            onChange={(e) => updateActivity(activeTemplate.id, activity.id, { title: e.target.value })}
                            className="tp-input"
                          />
                        </label>
                        <label>
                          <span>Type</span>
                          <select
                            value={activity.taskType || "general"}
                            onChange={(e) => updateActivity(activeTemplate.id, activity.id, { taskType: e.target.value })}
                            className="tp-select"
                          >
                            {TASK_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>Trigger before event</span>
                          <input
                            type="number"
                            step="0.5"
                            value={Math.abs(normalizeOffsetHours(activity.offsetHours))}
                            onChange={(e) => updateActivity(activeTemplate.id, activity.id, { offsetHours: -Math.abs(Number(e.target.value || 0)) })}
                            className="tp-input"
                          />
                        </label>
                      </div>
                      <label className="tp-message-field">
                        <span>Jai Masih message ({notificationLanguageLabel(messageLanguage)})</span>
                        <textarea
                          value={messageTemplateFor(activity, messageLanguage)}
                          onChange={(e) => updateActivity(activeTemplate.id, activity.id, {
                            messageTemplates: { [messageLanguage]: e.target.value },
                          })}
                          rows={4}
                          className="tp-message-template-text"
                          placeholder='Jai Masih Ji! "{eventTitle}" starts soon...'
                        />
                      </label>
                      <label className="tp-message-field compact">
                        <span>Internal task description</span>
                        <input
                          value={activity.description || ""}
                          onChange={(e) => updateActivity(activeTemplate.id, activity.id, { description: e.target.value })}
                          className="tp-input"
                          placeholder="Internal task description"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <>
              <Field label="Template JSON">
                <textarea
                  className="tp-template-editor"
                  spellCheck="false"
                  rows={22}
                  value={templateJson}
                  onChange={(e) => setTemplateJson(e.target.value)}
                />
              </Field>
              <div className="tp-template-help">
                Each template can define matchEventIds, titleKeywords, and activities. Activities support offsetHours trigger sequence, taskType, priority, audience team/user/role keywords, messageTemplate/messageTemplates { en, hi, pa }, and description.
              </div>
            </>
          )}
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" onClick={tab === "messages" ? resetMessages : onReset}>Reset defaults</button>
          <button type="button" className="tp-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="tp-btn primary" onClick={tab === "messages" ? saveMessageTemplates : onSave}>
            <CheckCircle2 size={14} /> Save templates
          </button>
        </footer>
      </div>
    </div>
  );
}

function TaskReportModal({ rows, loading, totalTasks, onRefresh, onClose }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const assignedRows = rows.filter((row) => row.id !== "__unassigned__");
  const unassigned = rows.find((row) => row.id === "__unassigned__");
  const totals = rows.reduce((acc, row) => {
    acc.total += row.total;
    acc.completed += row.completed;
    acc.pending += row.pending;
    acc.progress += row.progress;
    acc.onHold += row.onHold;
    acc.overdue += row.overdue;
    return acc;
  }, { total: 0, completed: 0, pending: 0, progress: 0, onHold: 0, overdue: 0 });
  totals.completion = totals.total ? Math.round((totals.completed / totals.total) * 100) : 0;

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <div className="tp-modal tp-report-modal">
        <header className="tp-modal-head">
          <div>
            <h2><TrendingUp size={18} style={{ verticalAlign: "middle", marginRight: 6, color: "var(--enterprise-primary, #047857)" }} />Task Completion Report</h2>
            <p>User-wise status across assigned tasks, team-expanded tasks, and unassigned tasks.</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="tp-modal-body">
          <div className="tp-report-summary">
            <ReportMetric label="Unique tasks" value={totalTasks} />
            <ReportMetric label="Assigned rows" value={assignedRows.length} />
            <ReportMetric label="Unassigned" value={unassigned?.total || 0} />
            <ReportMetric label="Completion" value={`${totals.completion}%`} />
            <ReportMetric label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? "danger" : "ok"} />
          </div>

          {loading ? (
            <div className="tp-report-loading">
              <Loader2 size={18} className="spin" /> Building report...
            </div>
          ) : rows.length === 0 ? (
            <div className="tp-report-loading">No task data available.</div>
          ) : (
            <div className="tp-report-table-wrap">
              <table className="tp-report-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Total</th>
                    <th>Done</th>
                    <th>Pending</th>
                    <th>In Progress</th>
                    <th>Hold</th>
                    <th>Overdue</th>
                    <th>Completion</th>
                    <th>Recent tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={row.id === "__unassigned__" ? "is-unassigned" : ""}>
                      <td>
                        <div className="tp-report-user">
                          <Avatar entity={{
                            id: row.id,
                            type: "user",
                            name: row.name,
                            email: row.email,
                            avatarUrl: row.avatarUrl,
                            color: row.id === "__unassigned__" ? "#9ca3af" : undefined,
                          }} size={28} />
                          <div>
                            <strong>{row.name}</strong>
                            {row.email ? <span>{row.email}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td>{row.total}</td>
                      <td className="ok">{row.completed}</td>
                      <td>{row.pending}</td>
                      <td>{row.progress}</td>
                      <td>{row.onHold}</td>
                      <td className={row.overdue > 0 ? "danger" : ""}>{row.overdue}</td>
                      <td>
                        <div className="tp-report-progress">
                          <span style={{ width: `${row.completion}%` }} />
                        </div>
                        <strong>{row.completion}%</strong>
                      </td>
                      <td>
                        <div className="tp-report-task-list">
                          {row.tasks.slice(0, 3).map((task) => (
                            <span key={task.id}>{task.title}</span>
                          ))}
                          {row.tasks.length > 3 ? <em>+{row.tasks.length - 3} more</em> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh report
          </button>
          <button type="button" className="tp-btn primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}

function ReportMetric({ label, value, tone }) {
  return (
    <div className={`tp-report-metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Jai Masih reminder modal                                           */
/* ------------------------------------------------------------------ */

function ReminderModal({ task, reminderNote, setReminderNote, reminderSent, onSend, onClose }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="tp-modal-bg" onClick={(e) => e.target.classList.contains("tp-modal-bg") && onClose()}>
      <div className="tp-modal" style={{ maxWidth: 500 }}>
        <header className="tp-modal-head">
          <div>
            <h2><Bell size={18} style={{ verticalAlign: "middle", marginRight: 6, color: "#f59e0b" }} />Jai Masih Reminder</h2>
            <p style={{ fontWeight: 600 }}>{task.title}</p>
          </div>
          <button type="button" className="tp-icon-btn" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="tp-modal-body">
          {reminderSent ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🙏</div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#065f46" }}>Jai Masih Ji!</div>
              <div style={{ color: "#6b7280", fontSize: 13, marginTop: 6 }}>
                Reminder sent to {task.assignees?.filter((a) => a.type === "user").length || 0} assignee(s).
              </div>
            </div>
          ) : (
            <>
              <div className="tp-field">
                <span className="tp-field-label">Quick templates</span>
                <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                  {JAI_MASIH_TEMPLATES.map((tpl) => (
                    <button key={tpl.id} type="button"
                      style={{
                        textAlign: "left", padding: "10px 14px", borderRadius: 10,
                        border: `1.5px solid ${reminderNote === tpl.message ? "var(--enterprise-primary, #047857)" : "#e5e7eb"}`,
                        background: reminderNote === tpl.message ? "var(--enterprise-primary-soft, #ecfdf5)" : "#fff",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                      onClick={() => setReminderNote(tpl.message)}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: "var(--enterprise-primary-strong, #065f46)", marginBottom: 3 }}>🕊 {tpl.label}</div>
                      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.4 }}>{tpl.message}</div>
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Custom message">
                <textarea
                  rows={4}
                  placeholder="Jai Masih Ji! 🙏 Your message here…"
                  value={reminderNote}
                  onChange={(e) => setReminderNote(e.target.value)}
                />
              </Field>

              <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 4 }}>
                Sends an in-app notification to all assignees of this task.
              </div>
            </>
          )}
        </div>

        <footer className="tp-modal-foot">
          <button type="button" className="tp-btn ghost" onClick={onClose}>
            {reminderSent ? "Close" : "Cancel"}
          </button>
          {!reminderSent && (
            <button type="button" className="tp-btn primary" disabled={!reminderNote.trim()} onClick={onSend}>
              <Send size={14} /> Jai Masih Ji! 🙏
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

function Styles() {
  return (
    <style>{`
      :root {
        --bg: var(--enterprise-bg, #f6f8fb);
        --surface: var(--enterprise-surface, #ffffff);
        --surface-2: var(--enterprise-surface-subtle, #f8fafc);
        --border: var(--enterprise-border, #dfe7ef);
        --border-strong: var(--enterprise-border-strong, #cbd6e2);
        --text: var(--enterprise-ink, #102033);
        --text-2: var(--enterprise-muted, #617086);
        --text-3: #8390a3;
        --primary: var(--enterprise-primary, #047857);
        --primary-600: var(--enterprise-primary-strong, #065f46);
        --primary-50: var(--enterprise-primary-soft, #ecfdf5);
        --danger: #ef4444;
        --danger-50: #fef2f2;
        --success: #10b981;
        --shadow-sm: var(--enterprise-shadow-sm, 0 1px 2px rgba(15,23,42,.05));
        --shadow-md: var(--enterprise-shadow, 0 12px 28px rgba(15,23,42,.08));
        --shadow-lg: var(--enterprise-shadow-lg, 0 24px 54px rgba(15,23,42,.14));
        --radius: var(--enterprise-radius-lg, 12px);
      }

      .tp-root {
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        background:
          linear-gradient(180deg, rgba(255,255,255,.96), rgba(246,248,251,.96)),
          radial-gradient(900px 500px at 100% 0%, rgba(4,120,87,.08) 0%, transparent 55%),
          var(--bg);
        min-height: 100vh;
        color: var(--text);
        -webkit-font-smoothing: antialiased;
      }

      /* Header */
      .tp-header {
        position: sticky;
        top: 0;
        z-index: 30;
        backdrop-filter: saturate(140%) blur(12px);
        background: rgba(255,255,255,.78);
        border-bottom: 1px solid var(--border);
      }
      .tp-header-inner {
        max-width: 1280px;
        margin: 0 auto;
        padding: 14px 24px;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 18px;
        align-items: center;
      }
      .tp-brand { display: flex; align-items: center; gap: 12px; }
      .tp-logo {
        width: 38px; height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--enterprise-primary, #047857) 0%, var(--enterprise-primary-strong, #065f46) 100%);
        color: #fff;
        display: grid; place-items: center;
        box-shadow: 0 6px 18px rgba(99,102,241,.35);
      }
      .tp-title {
        font-size: 18px; font-weight: 700;
        letter-spacing: -0.01em;
      }
      .tp-subtitle {
        font-size: 12px; color: var(--text-3);
        margin-top: 1px;
      }

      .tp-search {
        display: flex; align-items: center; gap: 8px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 12px;
        max-width: 460px;
        width: 100%;
        justify-self: center;
        transition: border-color .15s, box-shadow .15s;
        color: var(--text-3);
      }
      .tp-search:focus-within {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.12);
        color: var(--text-2);
      }
      .tp-search input {
        flex: 1;
        min-width: 0;
        border: none; outline: none;
        background: transparent;
        font-size: 14px;
        color: var(--text);
      }
      .tp-clear {
        border: none; background: transparent;
        color: var(--text-3); cursor: pointer;
        padding: 2px; border-radius: 4px;
      }
      .tp-clear:hover { color: var(--text); background: var(--surface-2); }

      .tp-header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        min-width: 0;
      }

      /* Main */
      .tp-main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 28px 24px 100px;
      }

      /* Stats */
      .tp-stats {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 14px;
        margin-bottom: 22px;
      }
      .tp-stat {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 16px;
        display: flex; align-items: center; gap: 14px;
        box-shadow: var(--shadow-sm);
        transition: transform .15s, box-shadow .15s;
      }
      .tp-stat:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
      .tp-stat.highlight {
        border-color: #fecaca;
        background: linear-gradient(180deg, #fff 0%, #fff5f5 100%);
      }
      .tp-stat-icon {
        width: 40px; height: 40px;
        border-radius: 10px;
        display: grid; place-items: center;
      }
      .tp-stat-value {
        font-size: 22px; font-weight: 700;
        letter-spacing: -0.02em;
      }
      .tp-stat-label {
        font-size: 12px; color: var(--text-3);
        font-weight: 500;
      }

      /* Toolbar */
      .tp-toolbar {
        display: flex; flex-wrap: wrap; gap: 12px;
        align-items: center; justify-content: space-between;
        margin-bottom: 18px;
      }
      .tp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .tp-chip {
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--text-2);
        font-size: 13px; font-weight: 500;
        padding: 7px 12px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        transition: all .15s;
      }
      .tp-chip:hover { background: var(--surface-2); color: var(--text); }
      .tp-chip.active {
        background: var(--primary-50);
        color: var(--primary-600);
        border-color: rgba(4,120,87,.24);
        font-weight: 600;
      }
      .tp-chip .count {
        font-size: 11px;
        background: rgba(0,0,0,.06);
        padding: 1px 6px;
        border-radius: 999px;
        font-weight: 600;
      }
      .tp-chip.active .count { background: rgba(99,102,241,.18); }

      .tp-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .tp-select-wrap {
        display: flex; align-items: center; gap: 6px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0 10px 0 12px;
        color: var(--text-3);
      }
      .tp-select-wrap select {
        background: transparent;
        border: none; outline: none;
        padding: 8px 4px;
        font-size: 13px;
        color: var(--text);
        font-family: inherit;
        cursor: pointer;
      }
      .tp-view-toggle {
        display: flex;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
      }
      .tp-view-toggle button {
        background: transparent;
        border: none;
        padding: 8px 12px;
        cursor: pointer;
        color: var(--text-3);
        display: grid; place-items: center;
        transition: background .15s, color .15s;
      }
      .tp-view-toggle button:hover { color: var(--text); background: var(--surface-2); }
      .tp-view-toggle button.on { background: var(--primary-50); color: var(--primary-600); }

      /* Buttons */
      .tp-btn {
        border: 1px solid transparent;
        font-family: inherit;
        font-weight: 600;
        font-size: 13.5px;
        border-radius: 10px;
        padding: 9px 14px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all .15s;
        white-space: nowrap;
      }
      .tp-btn:disabled { opacity: .6; cursor: not-allowed; }
      .tp-btn.primary {
        background: linear-gradient(180deg, var(--enterprise-primary, #047857) 0%, var(--enterprise-primary-strong, #065f46) 100%);
        color: #fff;
        box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 4px 12px rgba(99,102,241,.32);
      }
      .tp-btn.primary:hover { filter: brightness(1.05); transform: translateY(-1px); }
      .tp-btn.ghost {
        background: var(--surface);
        color: var(--text-2);
        border-color: var(--border);
      }
      .tp-btn.ghost:hover { background: var(--surface-2); color: var(--text); }
      .tp-btn.danger {
        background: var(--danger);
        color: #fff;
        box-shadow: 0 4px 12px rgba(239,68,68,.32);
      }
      .tp-btn.danger:hover { filter: brightness(1.05); }

      .hide-sm { display: inline; }

      /* Alert */
      .tp-alert {
        background: #fff5f5;
        border: 1px solid #fecaca;
        color: #b91c1c;
        padding: 10px 14px;
        border-radius: 10px;
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 14px;
        font-size: 13.5px;
      }
      .tp-alert button {
        margin-left: auto;
        border: none; background: transparent;
        color: inherit; cursor: pointer;
        padding: 4px; border-radius: 4px;
      }
      .tp-alert button:hover { background: rgba(185,28,28,.08); }

      /* Hierarchy */
      .tp-tree {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .tp-tree-node {
        position: relative;
        margin-left: calc(var(--depth, 0) * 28px);
      }
      .tp-tree-node.is-child {
        margin-top: 10px;
      }
      .tp-tree-node.is-context > .tp-card {
        opacity: .72;
      }
      .tp-tree-children {
        position: relative;
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .tp-tree-rail {
        position: absolute;
        left: -18px;
        top: -10px;
        bottom: 50%;
        width: 18px;
        border-left: 2px solid var(--border-strong);
        border-bottom: 2px solid var(--border-strong);
        border-bottom-left-radius: 10px;
      }

      /* Grid + Card */
      .tp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 14px;
      }
      .tp-card {
        position: relative;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
        box-shadow: var(--shadow-sm);
        transition: transform .18s, box-shadow .18s, border-color .18s;
        display: flex;
      }
      .tp-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: var(--border-strong);
      }
      .tp-card.done .tp-card-title { color: var(--text-3); text-decoration: line-through; }
      .tp-card.done { opacity: .85; }
      .tp-card.overdue { border-color: #fecaca; }
      .tp-card.linked { border-color: var(--enterprise-primary, #047857); box-shadow: 0 0 0 3px rgba(4,120,87,.14), var(--shadow-md); }
      .tp-card-bar {
        width: 4px;
        flex-shrink: 0;
      }
      .tp-card-body {
        flex: 1;
        padding: 14px 16px 12px;
        display: flex; flex-direction: column; gap: 10px;
        min-width: 0;
      }
      .tp-card-head {
        display: flex; gap: 10px;
        align-items: flex-start;
      }
      .tp-card-title-wrap { flex: 1; min-width: 0; }
      .tp-card-title {
        font-size: 15px; font-weight: 600;
        line-height: 1.3;
        margin: 0 0 4px;
        word-break: break-word;
      }
      .tp-card-desc {
        font-size: 13px; color: var(--text-2);
        margin: 0;
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .tp-card-desc.empty { color: var(--text-3); font-style: italic; }
      .tp-check {
        flex-shrink: 0;
        width: 24px; height: 24px;
        border-radius: 999px;
        border: 1.5px solid var(--border-strong);
        background: var(--surface);
        cursor: pointer;
        display: grid; place-items: center;
        color: var(--text-3);
        transition: all .15s;
        margin-top: 1px;
      }
      .tp-check:hover { border-color: var(--success); color: var(--success); }
      .tp-card-meta {
        display: flex; flex-wrap: wrap; gap: 6px;
      }
      .tp-pill {
        font-size: 11.5px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 6px;
        display: inline-flex; align-items: center; gap: 4px;
        background: var(--surface-2);
        color: var(--text-2);
      }
      .tp-pill.due { background: var(--surface-2); color: var(--text-2); }
      .tp-pill.due.overdue { background: var(--danger-50); color: var(--danger); }

      .tp-card-actions {
        display: flex; gap: 6px; align-items: center;
        margin-top: auto;
        padding-top: 8px;
        border-top: 1px dashed var(--border);
      }
      .tp-card-actions-end {
        display: flex; gap: 6px; margin-left: auto;
      }
      .tp-assignee-empty {
        font-size: 11.5px;
        color: var(--text-3);
        display: inline-flex; align-items: center; gap: 4px;
        font-weight: 500;
      }

      /* Avatars */
      .tp-avatar {
        width: 26px; height: 26px;
        border-radius: 999px;
        display: inline-grid; place-items: center;
        font-size: 10.5px;
        font-weight: 700;
        color: #fff;
        overflow: hidden;
        flex-shrink: 0;
        letter-spacing: .02em;
      }
      .tp-avatar img {
        width: 100%; height: 100%; object-fit: cover;
      }
      .tp-avatar.is-team { border-radius: 7px; }
      .tp-stack {
        display: inline-flex;
        align-items: center;
      }
      .tp-stack > .tp-avatar {
        margin-right: -8px;
      }
      .tp-stack > .tp-avatar:last-child { margin-right: 0; }
      .tp-avatar-more {
        background: #e5e7eb !important;
        color: var(--text-2) !important;
        font-size: 10px !important;
        box-shadow: 0 0 0 2px #fff !important;
      }
      .tp-icon-btn {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 8px;
        width: 30px; height: 30px;
        cursor: pointer;
        color: var(--text-2);
        display: grid; place-items: center;
        transition: all .15s;
      }
      .tp-icon-btn:hover { background: var(--surface-2); color: var(--text); }
      .tp-icon-btn.danger:hover { background: var(--danger-50); color: var(--danger); border-color: #fecaca; }

      /* Board */
      .tp-board {
        display: grid;
        grid-template-columns: repeat(4, minmax(260px, 1fr));
        gap: 14px;
        overflow-x: auto;
      }
      .tp-col {
        background: rgba(255,255,255,.55);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
        display: flex; flex-direction: column;
        max-height: 80vh;
      }
      .tp-col-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 6px 10px;
        border-top: 3px solid;
        border-radius: 2px;
        margin: -12px -12px 10px;
        padding: 14px 14px 10px;
      }
      .tp-col-title {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 13px; font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .tp-col-count {
        font-size: 12px; font-weight: 600;
        background: rgba(0,0,0,.05);
        color: var(--text-2);
        padding: 2px 8px;
        border-radius: 999px;
      }
      .tp-col-body {
        display: flex; flex-direction: column; gap: 10px;
        overflow-y: auto;
      }
      .tp-col-empty {
        text-align: center;
        color: var(--text-3);
        font-size: 13px;
        padding: 22px 8px;
        border: 1px dashed var(--border);
        border-radius: 10px;
      }

      /* Empty state */
      .tp-empty {
        text-align: center;
        padding: 48px 16px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .tp-empty-art { display: grid; place-items: center; margin-bottom: 16px; }
      .tp-empty h3 {
        font-size: 18px; font-weight: 700;
        margin: 0 0 6px;
      }
      .tp-empty p {
        color: var(--text-3); font-size: 14px;
        margin: 0 0 18px;
      }
      .tp-empty-actions { display: inline-flex; gap: 10px; }

      /* Skeleton */
      .tp-card.skeleton { pointer-events: none; }
      .tp-card.skeleton .tp-card-bar { background: var(--border); }
      .sk {
        background: linear-gradient(90deg, #eef0f4 0%, #f6f7fa 50%, #eef0f4 100%);
        background-size: 200% 100%;
        animation: shine 1.4s linear infinite;
        border-radius: 6px;
      }
      .sk-line { height: 12px; margin-bottom: 8px; }
      .w50 { width: 50%; } .w70 { width: 70%; } .w90 { width: 90%; }
      .sk-pill { width: 70px; height: 22px; border-radius: 6px; }
      @keyframes shine {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }

      /* FAB */
      .tp-fab {
        display: none;
        position: fixed;
        right: 20px; bottom: 20px;
        width: 56px; height: 56px;
        border-radius: 999px;
        border: none;
        background: linear-gradient(135deg, var(--enterprise-primary, #047857) 0%, var(--enterprise-primary-strong, #065f46) 100%);
        color: #fff;
        cursor: pointer;
        box-shadow: 0 10px 30px rgba(99,102,241,.45);
        z-index: 20;
        align-items: center; justify-content: center;
      }
      .tp-fab:active { transform: scale(.96); }

      /* Modal */
      .tp-modal-bg {
        position: fixed; inset: 0;
        background: rgba(15,16,30,.55);
        backdrop-filter: blur(4px);
        z-index: 80;
        display: grid;
        place-items: center;
        padding: 20px;
        animation: fadeIn .18s ease;
      }
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      .tp-modal {
        background: var(--surface);
        width: 100%;
        max-width: 520px;
        max-height: min(90vh, 760px);
        border-radius: 18px;
        box-shadow: var(--shadow-lg);
        overflow: hidden;
        animation: pop .22s cubic-bezier(.2,.7,.3,1.3);
        display: flex;
        flex-direction: column;
      }
      @keyframes pop { from { transform: translateY(12px) scale(.98); opacity: 0 } to { transform: none; opacity: 1 } }
      .tp-modal-head {
        flex-shrink: 0;
        padding: 20px 22px 12px;
        display: flex; justify-content: space-between; align-items: flex-start;
      }
      .tp-modal-head h2 {
        font-size: 18px; font-weight: 700;
        margin: 0 0 3px;
        letter-spacing: -0.01em;
      }
      .tp-modal-head p {
        margin: 0; font-size: 13px;
        color: var(--text-3);
      }
      .tp-modal-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 8px 22px 20px;
        display: flex; flex-direction: column; gap: 14px;
      }
      .tp-modal-foot {
        flex-shrink: 0;
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 14px 22px;
        border-top: 1px solid var(--border);
        background: var(--surface-2);
      }
      .tp-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .tp-field { display: flex; flex-direction: column; gap: 6px; }
      .tp-field-label {
        font-size: 12.5px; font-weight: 600;
        color: var(--text-2);
        letter-spacing: .01em;
      }
      .tp-field-label .req { color: var(--danger); margin-left: 3px; }
      .tp-field input,
      .tp-field textarea,
      .tp-field select {
        font-family: inherit;
        font-size: 14px;
        color: var(--text);
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        padding: 10px 12px;
        width: 100%;
        transition: border-color .15s, box-shadow .15s;
        outline: none;
      }
      .tp-field textarea { resize: vertical; min-height: 80px; }
      .tp-field input:focus,
      .tp-field textarea:focus,
      .tp-field select:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.14);
      }
      .tp-date-input {
        display: flex; align-items: center; gap: 8px;
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        padding: 0 12px;
        color: var(--text-3);
      }
      .tp-date-input input {
        border: none; padding: 10px 0;
      }
      .tp-date-input input:focus { box-shadow: none; }
      .tp-date-input:focus-within {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.14);
      }

      /* Confirm */
      .tp-confirm {
        background: var(--surface);
        width: 100%;
        max-width: 380px;
        border-radius: 16px;
        padding: 22px;
        text-align: center;
        box-shadow: var(--shadow-lg);
        animation: pop .22s cubic-bezier(.2,.7,.3,1.3);
      }
      .tp-confirm-icon {
        width: 48px; height: 48px;
        background: var(--danger-50);
        color: var(--danger);
        border-radius: 999px;
        margin: 0 auto 12px;
        display: grid; place-items: center;
      }
      .tp-confirm h3 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
      .tp-confirm p { margin: 0 0 18px; color: var(--text-2); font-size: 14px; }
      .tp-confirm-actions { display: flex; gap: 8px; justify-content: center; }

      /* Toasts */
      .toast-stack {
        position: fixed; bottom: 22px; left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        display: flex; flex-direction: column;
        align-items: center; gap: 8px;
      }
      .toast {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 16px;
        border-radius: 10px;
        background: #1f2937;
        color: #fff;
        font-size: 13.5px; font-weight: 500;
        box-shadow: var(--shadow-lg);
        animation: toastIn .25s ease;
      }
      .toast-success { background: #064e3b; }
      .toast-error   { background: #7f1d1d; }
      @keyframes toastIn {
        from { transform: translateY(8px); opacity: 0 }
        to   { transform: none; opacity: 1 }
      }

      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ── Recurring / autogen pills ── */
      .tp-pill-recur  { background: #ede9fe; color: #7c3aed; }
      .tp-pill-autogen{ background: #fef3c7; color: #b45309; }

      /* ── Remind icon button ── */
      .tp-icon-btn.remind:hover { background: #fef3c7; color: #b45309; border-color: #fde68a; }

      /* ── Activity Radar panel ── */
      .tp-radar-wrap {
        position: fixed;
        bottom: 24px; right: 24px;
        z-index: 50;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 18px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.14);
        width: min(440px, calc(100vw - 40px));
        overflow: hidden;
        animation: pop .22s cubic-bezier(.2,.7,.3,1.3);
      }
      .tp-radar-header {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 16px;
        font-weight: 700; font-size: 13px; color: #111827;
        border-bottom: 1px solid #f3f4f6;
        background: #f9fafb;
      }
      .tp-radar-close {
        margin-left: auto;
        background: transparent; border: none; cursor: pointer;
        color: #9ca3af; display: grid; place-items: center;
        border-radius: 6px; padding: 3px;
      }
      .tp-radar-close:hover { background: #f3f4f6; color: #374151; }
      .tp-radar-body {
        display: flex; gap: 16px; align-items: flex-start;
        padding: 14px 16px;
      }
      .tp-radar-legend { flex: 1; display: grid; gap: 5px; }
      .tp-radar-legend-row {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: #374151;
      }
      .tp-radar-dot {
        width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0;
      }
      .tp-radar-legend-label { flex: 1; font-weight: 500; }
      .tp-radar-legend-count {
        font-weight: 700; color: var(--enterprise-primary-strong, #065f46); font-size: 12px;
        background: var(--enterprise-primary-soft, #ecfdf5); border-radius: 6px;
        padding: 1px 7px;
      }
      .tp-upcoming {
        border-top: 1px solid #f3f4f6;
        padding: 12px 16px;
      }
      .tp-upcoming-title {
        font-size: 11px; font-weight: 700; color: #6b7280;
        text-transform: uppercase; letter-spacing: .05em;
        display: flex; align-items: center; gap: 5px;
        margin-bottom: 8px;
      }
      .tp-upcoming-item {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 0;
        border-bottom: 1px solid #f9fafb;
        font-size: 12px;
      }
      .tp-upcoming-item:last-child { border-bottom: none; }
      .tp-upcoming-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }
      .tp-upcoming-title-text { flex: 1; font-weight: 600; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tp-upcoming-date { font-size: 11px; color: #6b7280; white-space: nowrap; }
      .tp-upcoming-empty { font-size: 12px; color: #9ca3af; text-align: center; padding: 8px 0; }

      /* ── Auto-gen chips & cards ── */
      .tp-gen-chip {
        padding: 5px 14px; border-radius: 20px;
        border: 1.5px solid #e5e7eb; background: #fff;
        font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: all .14s; color: #374151;
      }
      .tp-gen-chip.active { background: var(--enterprise-primary-soft, #ecfdf5); color: var(--enterprise-primary-strong, #065f46); border-color: rgba(4,120,87,.24); }
      .tp-gen-chip.active.danger { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
      .tp-gen-chip:hover { border-color: var(--enterprise-primary, #047857); }
      .tp-flush-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 8px;
      }
      .tp-modal-body.reassign-only > .tp-field:not(.reassign-field),
      .tp-modal-body.reassign-only > .tp-row-2 {
        display: none;
      }
      .tp-danger-note {
        margin-top: 14px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #991b1b;
        font-size: 12.5px;
        line-height: 1.45;
      }
      .tp-template-editor {
        font-family: "Cascadia Code", "Consolas", monospace;
        font-size: 12px;
        min-height: 420px;
        white-space: pre;
        overflow: auto;
      }
      .tp-template-help {
        margin-top: 8px;
        color: var(--text-3);
        font-size: 12px;
        line-height: 1.45;
      }
      .tp-template-tabs {
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        margin-bottom: 12px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: #f8fafc;
      }
      .tp-template-tabs button {
        border: 0;
        border-radius: 8px;
        padding: 8px 12px;
        background: transparent;
        color: var(--text-2);
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }
      .tp-template-tabs button.active {
        background: #fff;
        color: var(--primary-700);
        box-shadow: var(--shadow-1);
      }
      .tp-input,
      .tp-select {
        width: 100%;
        min-height: 38px;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 10px;
        outline: none;
        background: #fff;
        color: var(--text-1);
        font-size: 13px;
        font-weight: 700;
      }
      .tp-input:focus,
      .tp-select:focus {
        border-color: var(--primary-400);
        box-shadow: 0 0 0 3px rgba(16,185,129,.14);
      }
      .tp-template-modal {
        width: min(1240px, calc(100vw - 32px));
        max-width: 1240px;
        max-height: calc(100dvh - 32px);
        border-radius: 20px;
      }
      .tp-template-modal .tp-modal-head {
        padding: 22px 28px 16px;
        border-bottom: 1px solid var(--border);
        background: linear-gradient(135deg, #ffffff, #f0fdf4 58%, #fffbeb);
      }
      .tp-template-modal .tp-modal-head h2 {
        font-size: 22px;
        font-weight: 900;
      }
      .tp-template-modal .tp-modal-head p {
        margin-top: 5px;
        max-width: 760px;
        font-size: 13.5px;
        line-height: 1.5;
      }
      .tp-template-modal .tp-modal-body {
        display: block;
        padding: 20px 28px 28px;
        overflow-x: hidden;
        overflow-y: auto;
      }
      .tp-template-modal .tp-modal-foot {
        padding: 16px 28px;
      }
      .tp-template-workspace {
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        gap: 22px;
        align-items: start;
      }
      .tp-template-nav {
        position: sticky;
        top: 0;
        display: grid;
        gap: 8px;
        max-height: none;
        overflow: visible;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: #f8fafc;
      }
      .tp-template-nav-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        border: 1px solid transparent;
        border-radius: 10px;
        min-height: 48px;
        padding: 12px 14px;
        background: transparent;
        color: var(--text-2);
        cursor: pointer;
        text-align: left;
      }
      .tp-template-nav-item:hover { background: #fff; border-color: var(--border); }
      .tp-template-nav-item.active {
        background: #fff;
        border-color: rgba(4,120,87,.24);
        color: var(--primary-700);
        box-shadow: var(--shadow-1);
      }
      .tp-template-nav-item span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 800;
      }
      .tp-template-nav-item strong {
        display: inline-grid;
        place-items: center;
        min-width: 24px;
        height: 22px;
        border-radius: 999px;
        background: #e2e8f0;
        color: var(--text-2);
        font-size: 11px;
      }
      .tp-template-nav-item.active strong {
        background: var(--enterprise-primary-soft, #ecfdf5);
        color: var(--enterprise-primary-strong, #065f46);
      }
      .tp-template-editor-panel {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: #fff;
        overflow: visible;
        box-shadow: 0 14px 36px rgba(15,23,42,.07);
      }
      .tp-template-panel-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 20px;
        border-bottom: 1px solid var(--border);
        background: linear-gradient(180deg, #f8fafc, #fff);
      }
      .tp-template-panel-head h3 {
        margin: 0;
        color: var(--text-1);
        font-size: 18px;
        font-weight: 900;
      }
      .tp-template-panel-head p {
        margin: 4px 0 0;
        color: var(--text-3);
        font-size: 12px;
      }
      .tp-template-token {
        flex-shrink: 0;
        border: 1px solid rgba(4,120,87,.22);
        border-radius: 999px;
        background: var(--enterprise-primary-soft, #ecfdf5);
        color: var(--enterprise-primary-strong, #065f46);
        padding: 5px 9px;
        font-family: "Cascadia Code", "Consolas", monospace;
        font-size: 11px;
        font-weight: 800;
      }
      .tp-message-template-list {
        display: grid;
        gap: 18px;
        max-height: none;
        overflow: visible;
        padding: 20px;
      }
      .tp-message-template-card {
        display: grid;
        gap: 16px;
        padding: 20px;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: linear-gradient(145deg, #fff, #f8fafc);
        box-shadow: 0 8px 24px rgba(15,23,42,.06);
      }
      .tp-message-template-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: var(--text-3);
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .tp-message-template-card-head strong {
        text-transform: none;
        letter-spacing: 0;
        border-radius: 999px;
        background: #f1f5f9;
        color: var(--text-2);
        padding: 4px 8px;
        font-size: 11px;
      }
      .tp-message-template-meta {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 190px;
        gap: 10px;
      }
      .tp-message-template-meta.three {
        grid-template-columns: minmax(300px, 1.35fr) minmax(170px, .75fr) minmax(160px, .65fr);
      }
      .tp-template-language-tabs {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface-2);
      }
      .tp-template-language-tabs button {
        border: none;
        background: transparent;
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 11px;
        font-weight: 800;
        color: var(--text-2);
        cursor: pointer;
      }
      .tp-template-language-tabs button.active {
        background: var(--primary);
        color: #fff;
      }
      .tp-message-template-meta label,
      .tp-message-field {
        display: grid;
        gap: 5px;
      }
      .tp-message-template-meta label span,
      .tp-message-field span {
        color: var(--text-3);
        font-size: 11px;
        font-weight: 800;
      }
      .tp-message-template-text {
        width: 100%;
        min-height: 132px;
        resize: vertical;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 13px 14px;
        outline: none;
        color: var(--text-1);
        background: #fff;
        font-size: 14px;
        line-height: 1.6;
      }
      .tp-message-template-text:focus {
        border-color: var(--primary-400);
        box-shadow: 0 0 0 3px rgba(16,185,129,.14);
      }
      @media (max-width: 860px) {
        .tp-template-workspace { grid-template-columns: 1fr; }
        .tp-template-nav { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); max-height: none; }
        .tp-message-template-meta.three { grid-template-columns: 1fr 1fr; }
        .tp-message-template-meta.three label:first-child { grid-column: 1 / -1; }
      }
      @media (max-width: 720px) {
        .tp-message-template-meta { grid-template-columns: 1fr; }
        .tp-template-nav { grid-template-columns: 1fr; }
        .tp-template-panel-head { flex-direction: column; }
        .tp-template-modal .tp-modal-head { padding: 18px 18px 14px; }
        .tp-template-modal .tp-modal-body { padding: 14px 14px 20px; }
        .tp-template-modal .tp-modal-foot { padding: 12px 14px; flex-wrap: wrap; }
        .tp-message-template-list { padding: 12px; gap: 12px; }
        .tp-message-template-card { padding: 15px; }
        .tp-message-template-meta.three { grid-template-columns: 1fr; }
        .tp-message-template-meta.three label:first-child { grid-column: auto; }
      }
      .tp-report-modal {
        max-width: min(1120px, calc(100vw - 32px));
      }
      .tp-report-summary {
        display: grid;
        grid-template-columns: repeat(5, minmax(110px, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .tp-report-metric {
        border: 1px solid var(--border);
        background: #fff;
        border-radius: 10px;
        padding: 10px 12px;
      }
      .tp-report-metric span {
        display: block;
        font-size: 11px;
        color: var(--text-3);
        margin-bottom: 4px;
      }
      .tp-report-metric strong {
        font-size: 20px;
        color: var(--text);
      }
      .tp-report-metric.danger strong { color: var(--danger); }
      .tp-report-metric.ok strong { color: var(--success); }
      .tp-report-loading {
        min-height: 180px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--text-2);
        font-size: 13px;
      }
      .tp-report-table-wrap {
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #fff;
      }
      .tp-report-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 920px;
        font-size: 12.5px;
      }
      .tp-report-table th,
      .tp-report-table td {
        padding: 11px 12px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }
      .tp-report-table th {
        position: sticky;
        top: 0;
        background: #f8fafc;
        color: var(--text-2);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .04em;
        z-index: 1;
      }
      .tp-report-table tbody tr:last-child td { border-bottom: none; }
      .tp-report-table tbody tr.is-unassigned { background: #fff7ed; }
      .tp-report-table .ok { color: var(--success); font-weight: 700; }
      .tp-report-table .danger { color: var(--danger); font-weight: 700; }
      .tp-report-user {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 180px;
      }
      .tp-report-user strong {
        display: block;
        color: var(--text);
        font-size: 13px;
      }
      .tp-report-user span {
        display: block;
        color: var(--text-3);
        font-size: 11.5px;
        margin-top: 1px;
      }
      .tp-report-progress {
        width: 86px;
        height: 7px;
        border-radius: 999px;
        background: #e5e7eb;
        overflow: hidden;
        margin-bottom: 4px;
      }
      .tp-report-progress span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #34d399, #10b981);
      }
      .tp-report-task-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
        max-width: 260px;
      }
      .tp-report-task-list span,
      .tp-report-task-list em {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-2);
        font-style: normal;
      }
      .tp-report-task-list em { color: var(--primary-600); font-weight: 700; }
      .tp-gen-card {
        padding: 12px 14px; border-radius: 12px;
        border: 1.5px solid #e5e7eb; background: #fff;
        cursor: pointer; transition: all .14s;
      }
      .tp-gen-card.selected { border-color: var(--enterprise-primary, #047857); background: var(--enterprise-primary-soft, #ecfdf5); }
      .tp-gen-card:hover { border-color: var(--enterprise-primary, #047857); }
      .tp-gen-design {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(4,120,87,.24);
        display: grid;
        gap: 12px;
      }
      .tp-gen-design-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px;
      }
      .tp-gen-activities {
        display: grid;
        gap: 10px;
      }
      .tp-gen-activity {
        background: rgba(255,255,255,.76);
        border: 1px solid #dbe3ff;
        border-radius: 10px;
        padding: 10px;
        display: grid;
        gap: 8px;
      }
      .tp-gen-activity-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .tp-gen-activity-head strong {
        display: block;
        font-size: 12.5px;
        color: #1f2937;
      }
      .tp-gen-activity-head span {
        display: block;
        font-size: 11px;
        color: #6b7280;
        margin-top: 2px;
      }

      /* Field hint */
      .tp-field-hint {
        font-size: 12px; color: var(--text-3); margin-top: 4px;
      }
      .tp-field-hint code {
        background: var(--surface-2);
        padding: 1px 5px; border-radius: 4px;
        font-size: 11.5px;
      }

      /* Assignee picker */
      .tp-picker {
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        transition: border-color .15s, box-shadow .15s;
      }
      .tp-picker.open {
        border-color: var(--primary);
        box-shadow: 0 0 0 4px rgba(99,102,241,.14);
      }
      .tp-picker-trigger {
        width: 100%;
        background: transparent;
        border: none;
        padding: 8px 10px;
        min-height: 42px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: inherit;
        text-align: left;
      }
      .tp-picker-chips {
        display: flex; flex-wrap: wrap; gap: 6px;
        flex: 1;
        align-items: center;
      }
      .tp-picker-placeholder {
        color: var(--text-3);
        font-size: 13.5px;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .tp-chip-selected {
        display: inline-flex; align-items: center; gap: 6px;
        background: var(--primary-50);
        border: 1px solid rgba(4,120,87,.24);
        color: var(--primary-600);
        border-radius: 999px;
        padding: 3px 4px 3px 4px;
        font-size: 12.5px;
        font-weight: 600;
        max-width: 220px;
      }
      .tp-chip-name {
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tp-tag-team {
        background: rgba(99,102,241,.18);
        color: var(--primary-600);
        font-size: 9.5px;
        padding: 1px 5px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .tp-chip-remove {
        display: inline-grid;
        place-items: center;
        width: 16px; height: 16px;
        border-radius: 999px;
        cursor: pointer;
        color: var(--primary-600);
        opacity: .7;
        transition: opacity .12s, background .12s;
      }
      .tp-chip-remove:hover {
        opacity: 1;
        background: rgba(99,102,241,.18);
      }
      .tp-picker-caret {
        color: var(--text-3);
        flex-shrink: 0;
        transition: transform .15s;
      }
      .tp-picker-caret.open { transform: rotate(180deg); }

      /* Inline expanding panel — no overflow surprises inside scrollable parents */
      .tp-picker-panel {
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        animation: panelIn .16s ease;
      }
      @keyframes panelIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: none; }
      }
      .tp-picker-search {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        color: var(--text-3);
        background: var(--surface-2);
      }
      .tp-picker-search input {
        flex: 1; border: none; outline: none;
        background: transparent; font-size: 13.5px;
        color: var(--text); font-family: inherit;
      }
      .tp-picker-list {
        max-height: 280px;
        overflow-y: auto;
        padding: 6px;
      }
      .tp-picker-group {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: var(--text-3);
        padding: 8px 8px 4px;
      }

      /* Rows */
      .tp-picker-row {
        width: 100%;
        background: transparent;
        border: none;
        font-family: inherit;
        text-align: left;
        display: flex; align-items: center; gap: 10px;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
        transition: background .12s;
      }
      .tp-picker-row.compact { padding: 6px 8px; }
      .tp-picker-row:hover { background: var(--surface-2); }
      .tp-picker-row.selected { background: var(--primary-50); }
      .tp-picker-row-text { flex: 1; min-width: 0; }
      .tp-picker-row-name {
        font-size: 13.5px; font-weight: 600;
        color: var(--text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tp-picker-row-sub {
        font-size: 11.5px; color: var(--text-3);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        margin-top: 1px;
      }
      .tp-picker-check { color: var(--text-3); flex-shrink: 0; }
      .tp-picker-check.on { color: var(--primary); }
      .tp-picker-empty {
        text-align: center;
        color: var(--text-3);
        padding: 20px;
        font-size: 13px;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .tp-picker-empty.small { padding: 10px; font-size: 12.5px; }

      /* Team block: row + expand button + nested members */
      .tp-team-block {
        border-radius: 8px;
      }
      .tp-team-block .tp-picker-row {
        flex: 1;
        padding-right: 0;
      }
      .tp-team-block > .tp-picker-row {
        display: flex;
      }
      .tp-row-tap {
        flex: 1;
        background: transparent;
        border: none;
        font-family: inherit;
        text-align: left;
        display: flex; align-items: center; gap: 10px;
        padding: 0;
        cursor: pointer;
        min-width: 0;
      }
      .tp-team-expand {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 6px 8px;
        margin-left: 4px;
        border-radius: 6px;
        color: var(--text-3);
        display: grid; place-items: center;
        transition: background .12s, color .12s;
      }
      .tp-team-expand:hover { background: var(--surface-2); color: var(--text); }
      .tp-team-expand .rot { transform: rotate(180deg); }
      .tp-team-members {
        margin: 4px 0 6px 36px;
        padding: 6px 6px 6px 10px;
        border-left: 2px dashed var(--border);
      }
      .tp-add-all {
        width: 100%;
        background: var(--primary-50);
        border: 1px dashed rgba(4,120,87,.28);
        color: var(--primary-600);
        border-radius: 8px;
        padding: 6px 10px;
        margin-bottom: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      }
      .tp-add-all:hover { background: rgba(99,102,241,.15); }

      /* Footer of picker */
      .tp-picker-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-top: 1px solid var(--border);
        background: var(--surface-2);
      }
      .tp-picker-count {
        font-size: 12px;
        color: var(--text-3);
        font-weight: 500;
      }
      .tp-picker-done {
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 7px;
        padding: 6px 14px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .tp-picker-done:hover { background: var(--primary-600); }

      /* Responsive */
      @media (max-width: 1100px) {
        .tp-stats { grid-template-columns: repeat(3, 1fr); }
      }
      @media (max-width: 900px) {
        .tp-board { grid-template-columns: repeat(2, minmax(240px, 1fr)); }
      }
      @media (max-width: 740px) {
        .tp-header-inner {
          grid-template-columns: 1fr;
          row-gap: 10px;
        }
        .tp-brand { min-width: 0; }
        .tp-search { grid-column: auto; max-width: none; justify-self: stretch; }
        .tp-header-actions {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .tp-header-actions .tp-btn {
          min-width: 0;
          justify-content: center;
          padding: 9px 8px;
        }
        .tp-header-actions .tp-btn.primary {
          display: none;
        }
        .tp-subtitle { display: none; }
        .tp-stats { grid-template-columns: repeat(2, 1fr); }
        .tp-toolbar { flex-direction: column; align-items: stretch; }
        .tp-controls { justify-content: space-between; }
        .tp-fab { display: flex; }
        .hide-sm { display: none; }
        .tp-board { grid-template-columns: 1fr; }
        .tp-radar-wrap {
          left: 12px;
          right: 12px;
          bottom: calc(76px + env(safe-area-inset-bottom, 0px));
          width: auto;
          max-height: min(58dvh, 460px);
        }
        .tp-radar-body {
          flex-direction: column;
          align-items: center;
          gap: 10px;
          overflow-y: auto;
          max-height: calc(min(58dvh, 460px) - 48px);
        }
        .tp-radar-legend {
          width: 100%;
        }
        .tp-gen-design-row { grid-template-columns: 1fr; }
        .tp-gen-activity-head { align-items: flex-start; flex-direction: column; }
        .tp-report-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 480px) {
        .tp-main { padding: 18px 14px 100px; }
        .tp-header-inner { padding: 12px 14px; }
        .tp-header-actions {
          grid-template-columns: repeat(4, minmax(42px, 1fr));
        }
        .tp-header-actions .tp-btn {
          min-height: 40px;
          border-radius: 9px;
        }
        .tp-row-2 { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}



