import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import { startDemoPolling } from "./demoPolling";
import { demoVoiceInstructions, DEMO_RENDERER_BUILD, matchesDemoSettings, newDemoRenderAttempt } from "./demoRenderState";
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  FileVideo,
  Flag,
  Gauge,
  Megaphone,
  Milestone,
  PlayCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Upload,
  Users,
  Volume2,
  Wallet,
} from "lucide-react";

const STORAGE_KEY = "mahima_project_management_portfolio_v1";

const DEMO_DURATION_OPTIONS = [
  { seconds: 60, label: "60 seconds", hint: "Complete story · all modules" },
  { seconds: 90, label: "90 seconds", hint: "Complete story · all modules" },
  { seconds: 300, label: "5 minutes", hint: "Standard walkthrough" },
  { seconds: 600, label: "10 minutes", hint: "Detailed presentation" },
];

const DEMO_MUSIC_OPTIONS = [
  { key: "uplifting", label: "Uplifting", description: "Bright and inspirational" },
  { key: "peaceful", label: "Peaceful", description: "Soft ministry ambience" },
  { key: "corporate", label: "Corporate", description: "Clean product-demo pulse" },
  { key: "none", label: "No music", description: "Voice-over only" },
];

const PROJECT_TEMPLATES = {
  construction: {
    type: "Church Construction",
    icon: Building2,
    accent: "#047857",
    phases: ["Land & approvals", "Design", "Foundation", "Structure", "Interiors", "Handover"],
    workstreams: ["Civil", "Electrical", "Plumbing", "Permits", "Finance", "Donor reporting", "Safety"],
    risks: ["Permit delay", "Material escalation", "Contractor capacity", "Rain impact"],
  },
  crusade: {
    type: "Big Crusade Management",
    icon: Megaphone,
    accent: "#dc2626",
    phases: ["Vision", "Venue", "Permissions", "Promotion", "Volunteer mobilization", "Event execution", "Follow-up"],
    workstreams: ["Venue", "Stage", "Prayer", "Transport", "Media", "Security", "Outreach", "Counselling"],
    risks: ["Venue approval", "Crowd safety", "Weather", "Volunteer shortfall"],
  },
  appDemo: {
    type: "Mahima Application Demo",
    icon: FileVideo,
    accent: "#7c3aed",
    phases: ["Discovery", "Route capture", "Voice-over scripts", "Review", "Render", "Publish"],
    workstreams: ["Screenshots", "English voice-over", "Hindi voice-over", "Punjabi voice-over", "MP4 render", "QA"],
    risks: ["Login state expired", "Page permission gap", "Voice-over review", "Renderer unavailable"],
  },
};

const DEMO_ROUTES = [
  { key: "DASHBOARD", title: "Home dashboard", path: "/home" },
  { key: "SUBSCRIPTIONS", title: "Subscriptions and add-ons", path: "/home/subscriptions" },
  { key: "PASTOR", title: "AI Counseller", path: "/home/pastor" },
  { key: "README", title: "ReadMe image assistant", path: "/home/readme" },
  { key: "APP_DOWNLOADS", title: "App Downloads", path: "/home/app-downloads" },
  { key: "SERMONS", title: "Sermons", path: "/home/sermons" },
  { key: "PRAYER_REQUESTS", title: "Prayer Requests", path: "/home/prayerrequests" },
  { key: "TASKS", title: "Tasks", path: "/home/tasks" },
  { key: "PROJECT_MANAGEMENT", title: "Project Management", path: "/home/project-management" },
  { key: "USERS", title: "Users", path: "/home/users" },
  { key: "TEAMS", title: "Teams", path: "/home/teams" },
  { key: "ROLES", title: "Roles and permissions", path: "/home/roles" },
  { key: "PAGES", title: "Pages and module access", path: "/home/pages" },
  { key: "POSITIONS", title: "Positions", path: "/home/positions" },
  { key: "ATTENDANCE", title: "Attendance", path: "/home/attendance" },
  { key: "PAYROLL", title: "Payroll", path: "/home/payroll" },
  { key: "COSTS", title: "Costs", path: "/home/costs" },
  { key: "MARRIAGE", title: "Marriage", path: "/home/marriage" },
  { key: "BAPTISM", title: "Baptism", path: "/home/baptism" },
  { key: "COUNSELLING", title: "Counselling", path: "/home/counselling" },
  { key: "CHAT", title: "Jai Masih or Praise The Lord Chat", path: "/home/chat" },
  { key: "ADMIN_DASHBOARD", title: "Admin Dashboard", path: "/home/admin/dashboard" },
  { key: "LIVE_USERS", title: "Live Users", path: "/home/admin/live-users" },
  { key: "MESSAGE_CENTER", title: "Message Center", path: "/home/admin/ministry-automation" },
  { key: "TENANT_DASHBOARD", title: "All Tenant Dashboards", path: "/home/admin/tenant-dashboard" },
  { key: "MULTITENANT", title: "Multi-tenant Administration", path: "/home/admin/multitenant" },
  { key: "SAAS_BILLING", title: "SaaS Billing", path: "/home/admin/billing" },
  { key: "QA_AUTOMATION", title: "Test Automation", path: "/home/admin/test-automation" },
  { key: "DIGITAL_MARKETING", title: "Digital Marketing", path: "/home/admin/digital-marketing" },
  { key: "LANDING_PAGE", title: "Landing Page Builder", path: "/home/admin/landing" },
  { key: "PRINT_TEMPLATES", title: "Print and PDF Templates", path: "/home/admin/print-templates" },
  { key: "LANGUAGES", title: "Languages", path: "/home/admin/languages" },
  { key: "EMAIL_CLIENT", title: "Email Client", path: "/home/admin/email" },
  { key: "GOOGLE_DRIVE", title: "Google Drive", path: "/home/admin/google-drive" },
  { key: "SERVER_FILES", title: "Server Files", path: "/home/admin/server-files" },
  { key: "REPORTS", title: "Reports", path: "/home/admin/reports" },
  { key: "AUDIT_TRAIL", title: "Audit Trail", path: "/home/admin/audit-trail" },
];

const DEMO_RENDER_ROUTES = DEMO_ROUTES;

const VOICE_SCRIPTS = {
  en: "Welcome to Mahima Ministry. This demo walks through the application modules, ministry workflows, reporting, communication, and project controls used by the church operations team.",
  hi: "महिमा में आपका स्वागत है। आइए देखें, कैसे हमारी कलीसिया प्रार्थना, सेवा और मिलकर काम करने से हर दिन लोगों के जीवन में आशा लाती है।",
  pa: "ਮਹਿਮਾ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਆਓ ਵੇਖੀਏ, ਸਾਡੀ ਕਲੀਸੀਆ ਪ੍ਰਾਰਥਨਾ, ਸੇਵਾ ਅਤੇ ਰਲ ਮਿਲ ਕੇ ਕੰਮ ਕਰਨ ਨਾਲ ਹਰ ਰੋਜ਼ ਲੋਕਾਂ ਦੇ ਜੀਵਨ ਵਿੱਚ ਆਸ ਕਿਵੇਂ ਲਿਆਉਂਦੀ ਹੈ।",
};

const INDIAN_MALE_TTS_INSTRUCTIONS = "Speak like a real Indian male presenter from North India. Use warm Indian English pronunciation with natural pauses, gentle confidence, and a ministry-demo tone. Do not sound robotic, synthetic, theatrical, or like a call-center IVR. Keep it conversational and human.";

const VOICE_OPTIONS = [
  {
    key: "indian_female_presenter",
    label: "Indian woman",
    description: "Warm, expressive presenter",
    ttsVoice: { en: "nova", hi: "nova", pa: "nova" },
    ttsInstructions: "Speak as a warm Indian female presenter with clear pronunciation, natural pauses, and a conversational ministry-demo tone.",
  },
  {
    key: "indian_female_gentle",
    label: "Gentle woman",
    description: "Calm, reassuring narration",
    ttsVoice: { en: "shimmer", hi: "shimmer", pa: "shimmer" },
    ttsInstructions: "Speak as a gentle Indian female ministry presenter, with a calm, reassuring tone and natural pauses.",
  },
  {
    key: "indian_male_presenter",
    label: "Indian man",
    description: "Warm North Indian presenter",
    ttsVoice: { en: "onyx", hi: "onyx", pa: "onyx" },
    ttsInstructions: INDIAN_MALE_TTS_INSTRUCTIONS,
  },
  {
    key: "indian_male_clear",
    label: "Indian trainer",
    description: "Clear training voice",
    ttsVoice: { en: "ash", hi: "ash", pa: "ash" },
    ttsInstructions: "Speak like a real Indian male software trainer. Use Indian English rhythm, clear articulation, natural pauses, and a calm confident tone. Avoid robotic or announcer-style delivery.",
  },
  {
    key: "indian_male_gentle",
    label: "Indian gentle",
    description: "Softer ministry voice",
    ttsVoice: { en: "echo", hi: "echo", pa: "echo" },
    ttsInstructions: "Speak like a gentle Indian male ministry presenter. Sound warm, human, respectful, and conversational, with natural pauses and no machine-like cadence.",
  },
];

const DEMO_NARRATION = {
  en: {
    DASHBOARD: "The home dashboard gives leaders a quick operational view of ministry activity, follow-ups, tasks, and important alerts.",
    SUBSCRIPTIONS: "Subscriptions shows the always-included foundation and each optional add-on, including activation, payment, suspension, and renewal status.",
    PASTOR: "The AI Counsellor supports pastoral conversations with guided prompts, prayerful responses, and structured care notes.",
    README: "The ReadMe image assistant helps convert ministry images and documents into clear notes that teams can act on.",
    APP_DOWNLOADS: "App Downloads gives every user a trusted place to obtain the latest signed Mahima mobile application and review release information.",
    SERMONS: "The sermons module organizes messages, media, references, and publishing workflows for church content.",
    PRAYER_REQUESTS: "Prayer Requests tracks needs, reminders, testimonies, answer status, and the monitoring metrics for follow-up.",
    TASKS: "Tasks converts ministry events into accountable assignments with owners, reminders, sub tasks, and team notifications.",
    PROJECT_MANAGEMENT: "Project Management brings construction projects, crusades, governance, risks, budgets, and demo delivery into one PMO workspace.",
    USERS: "Users centralizes member and staff records, roles, contact information, and access administration.",
    TEAMS: "Teams helps ministry leaders organize groups, members, ownership, and operational responsibilities.",
    ROLES: "Roles and permissions control which modules each role can open, keeping the application secure and manageable.",
    PAGES: "Pages and module access maps functional screens to roles, subscriptions, and tenant entitlements for consistent authorization.",
    POSITIONS: "Positions defines church-level responsibilities and reporting structure for ministry operations.",
    ATTENDANCE: "Attendance captures participation and gives leaders visibility into service, team, and event presence.",
    PAYROLL: "Payroll manages salary runs, accounting entries, and staff payment tracking in a controlled workflow.",
    COSTS: "Costs tracks expenses, budgets, journals, and financial movement across church operations.",
    MARRIAGE: "Marriage records help administer pastoral marriage workflows, documents, and ministry follow-up.",
    BAPTISM: "Baptism records organize candidate information, service planning, and certification steps.",
    COUNSELLING: "Counselling keeps pastoral care interactions structured, private, and follow-up ready.",
    CHAT: "Jai Masih Chat, presented as Praise The Lord outside India, supports direct and group ministry communication with messages, voice notes, and calls.",
    ADMIN_DASHBOARD: "The Admin Dashboard summarizes tenant operations, users, ministry activity, governance, and actions requiring administrative attention.",
    LIVE_USERS: "Live Users provides administrators with real-time visibility into active sessions and current application usage.",
    MESSAGE_CENTER: "Message Center manages automation, reminders, and ministry communication across users and teams.",
    TENANT_DASHBOARD: "All Tenant Dashboards gives the Mahima Root Administrator a consolidated operational view across registered churches.",
    MULTITENANT: "Multi-tenant Administration manages churches, tenant administrators, domains, branding, status, licensing, and package activation.",
    SAAS_BILLING: "SaaS Billing generates donation invoices, tracks collections, reconciles UPI confirmations, and applies subscription adjustments.",
    QA_AUTOMATION: "Test Automation generates detailed positive and negative scenarios, approval-controlled test data, execution results, defects, and fix-impact plans.",
    DIGITAL_MARKETING: "Digital Marketing supports AI-assisted prospect discovery, approval-gated outreach, communication tracking, leads, quotations, demonstrations, and SaaS conversion.",
    LANDING_PAGE: "The Landing Page Builder lets each church maintain its public identity, service information, content, and visitor experience.",
    PRINT_TEMPLATES: "Print and PDF Templates standardizes certificates, tokens, invoices, and other printable church documents.",
    LANGUAGES: "Languages controls the enabled application languages, default language, display order, and multilingual communication availability.",
    EMAIL_CLIENT: "The Email Client provides managed church correspondence, message composition, delivery tracking, and ministry communication history.",
    GOOGLE_DRIVE: "Google Drive integration connects ministry files with the application for easier document access.",
    SERVER_FILES: "Server Files provides controlled access to ministry documents stored and managed by the Mahima platform.",
    REPORTS: "Reports brings operational, ministry, and administrative insights together for review and decision making.",
    AUDIT_TRAIL: "Audit Trail records important application actions so administrators can review accountability, changes, and security events.",
  },

};

function toHashRoute(path) {
  const clean = String(path || "/home").replace(/^#/, "");
  return clean.startsWith("/") ? `#${clean}` : `#/${clean}`;
}

function demoNarration(route, index, language) {
  return DEMO_NARRATION.en[route.key] || route.title;
}

function routeWaitMs(route) {
  if (["DASHBOARD", "PASTOR", "PROJECT_MANAGEMENT", "REPORTS"].includes(route.key)) return 3200;
  if (["MESSAGE_CENTER", "GOOGLE_DRIVE"].includes(route.key)) return 3800;
  return 2400;
}

let voicePreviewAudio;
let voicePreviewUrl;
let voicePreviewRequest = 0;
async function previewVoiceSample(option, language) {
  const request = ++voicePreviewRequest;
  voicePreviewAudio?.pause();
  if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  try {
    const response = await api.post("/projectmanagement/demo-voice-preview", {
      voiceOver: VOICE_SCRIPTS[language],
      ttsVoice: option.ttsVoice[language] || option.ttsVoice.en,
      ttsInstructions: demoVoiceInstructions(option, language),
    }, { responseType: "blob" });
    if (request !== voicePreviewRequest) return;
    voicePreviewUrl = URL.createObjectURL(response instanceof Blob ? response : response.data);
    voicePreviewAudio = new Audio(voicePreviewUrl);
    await voicePreviewAudio.play();
  } catch (error) {
    if (request === voicePreviewRequest) alert("Voice preview could not play. Check the speech service and try again.");
  }
}


function seedProjects() {
  return [
    makeProject("Church Construction - New Worship Hall", "construction"),
    makeProject("Punjab Healing Crusade 2026", "crusade"),
    makeProject("Mahima App 4.0 Guided Demo", "appDemo"),
  ];
}

function makeProject(name, templateKey) {
  const template = PROJECT_TEMPLATES[templateKey] || PROJECT_TEMPLATES.construction;
  const now = new Date();
  const finish = new Date(now);
  finish.setDate(finish.getDate() + (templateKey === "crusade" ? 90 : templateKey === "appDemo" ? 21 : 240));
  return {
    id: `${templateKey}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    templateKey,
    type: template.type,
    sponsor: templateKey === "construction" ? "Senior Pastor" : templateKey === "crusade" ? "Crusade Director" : "Mahima Product Team",
    manager: templateKey === "construction" ? "Construction PMO" : templateKey === "crusade" ? "Event PMO" : "Application PMO",
    status: "Active",
    health: templateKey === "appDemo" ? "Watch" : "Green",
    priority: templateKey === "construction" ? "Strategic" : "High",
    budget: templateKey === "construction" ? 7500000 : templateKey === "crusade" ? 1800000 : 250000,
    spent: templateKey === "construction" ? 2325000 : templateKey === "crusade" ? 420000 : 55000,
    progress: templateKey === "construction" ? 34 : templateKey === "crusade" ? 26 : 18,
    startDate: now.toISOString().slice(0, 10),
    targetDate: finish.toISOString().slice(0, 10),
    phases: template.phases.map((phase, index) => ({
      id: `${templateKey}_phase_${index}`,
      name: phase,
      status: index === 0 ? "Done" : index === 1 ? "In progress" : "Planned",
      owner: index % 2 === 0 ? "PMO" : "Ministry Lead",
    })),
    workstreams: template.workstreams.map((name, index) => ({
      id: `${templateKey}_ws_${index}`,
      name,
      owner: index % 2 === 0 ? "Core Team" : "Support Team",
      completion: Math.max(5, Math.min(90, 18 + index * 8)),
    })),
    risks: template.risks.map((risk, index) => ({
      id: `${templateKey}_risk_${index}`,
      title: risk,
      impact: index === 0 ? "High" : "Medium",
      mitigation: "Assign owner, weekly review, and escalation path.",
      status: index === 0 ? "Open" : "Monitoring",
    })),
    decisions: [
      { id: `${templateKey}_decision_1`, title: "Approve governance cadence", owner: "Sponsor", due: now.toISOString().slice(0, 10), status: "Pending" },
      { id: `${templateKey}_decision_2`, title: "Confirm budget baseline", owner: "Finance", due: finish.toISOString().slice(0, 10), status: "Draft" },
    ],
  };
}

function loadPortfolio() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return seedProjects();
}

function savePortfolio(projects) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects, null, 2));
}

function currency(value) {
  return `INR ${Number(value || 0).toLocaleString("en-IN")}`;
}

function healthClass(health) {
  return String(health || "").toLowerCase();
}
function unwrapApiData(response) {
  if (response && typeof response === "object" && "data" in response) return response.data;
  return response;
}

function buildDemoDownloadUrl(job, language = "en") {
  if (!job?.id) return "";
  const status = String(job.status || job.Status || "").toLowerCase();
  const serverDownloadUrl = job.downloadUrl || job.DownloadUrl || "";
  if (status !== "completed" || !serverDownloadUrl) return "";
  return `/api/projectmanagement/demo-jobs/${encodeURIComponent(job.id)}/download`;
}

export default function ProjectManagementPage() {
  const [projects, setProjects] = useState(() => loadPortfolio());
  const [activeId, setActiveId] = useState(() => loadPortfolio()[0]?.id || "");
  const [isBackendReady, setIsBackendReady] = useState(false);
  const [view, setView] = useState("portfolio");
  const [query, setQuery] = useState("");
  const [demoLanguage, setDemoLanguage] = useState("en");
  const [demoVoice, setDemoVoice] = useState("indian_male_presenter");
  const [demoDuration, setDemoDuration] = useState(90);
  const [demoMusic, setDemoMusic] = useState("uplifting");
  const [demoMusicVolume, setDemoMusicVolume] = useState(35);
  const [demoJob, setDemoJob] = useState(null);
  const [demoJobs, setDemoJobs] = useState([]);
  const [isRenderingDemo, setIsRenderingDemo] = useState(false);
  const [activeRenderId, setActiveRenderId] = useState(null);
  const [isAnalyzingCaptures, setIsAnalyzingCaptures] = useState(false);
  const [renderStartedAt, setRenderStartedAt] = useState(0);
  const [uploadedCaptureCount, setUploadedCaptureCount] = useState(0);
  const [demoProgress, setDemoProgress] = useState({
    captures: { percent: 0, status: "idle", label: "Waiting for screenshots" },
    prepare: { percent: 0, status: "idle", label: "Not started" },
    render: { percent: 0, status: "idle", label: "Not started" },
  });

  function updateDemoProgress(key, patch) {
    setDemoProgress((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  useEffect(() => {
    if (isRenderingDemo) return;
    updateDemoProgress("render", { percent: 0, status: "idle", label: "Generate MP4 to apply these settings" });
  }, [demoLanguage, demoVoice, demoDuration, demoMusic, demoMusicVolume]);

  useEffect(() => {
    if (!isAnalyzingCaptures) return undefined;
    const timer = window.setInterval(() => setDemoProgress((current) => {
      const percent = Math.min(88, current.captures.percent + Math.max(1, Math.round((88 - current.captures.percent) * 0.08)));
      const label = percent < 30 ? "Uploading screenshots" : percent < 70 ? "AI is analyzing screens" : "Writing narration and routes";
      return { ...current, captures: { ...current.captures, percent, label } };
    }), 700);
    return () => window.clearInterval(timer);
  }, [isAnalyzingCaptures]);

  useEffect(() => {
    if (!isRenderingDemo) return undefined;
    const timer = window.setInterval(() => setDemoProgress((current) => {
      const percent = Math.min(96, current.render.percent + Math.max(1, Math.round((96 - current.render.percent) * 0.045)));
      const elapsed = renderStartedAt ? Math.max(1, Math.floor((Date.now() - renderStartedAt) / 60000)) : 0;
      const label = `Rendering on server · ${elapsed} min elapsed · waiting for completion`;
      return { ...current, render: { ...current.render, percent, label } };
    }), 900);
    return () => window.clearInterval(timer);
  }, [isRenderingDemo, renderStartedAt, demoDuration]);

  useEffect(() => {
    if (!isRenderingDemo || !activeRenderId) return undefined;
    const controller = new AbortController();
    const stop = startDemoPolling({
      fetchJob: async () => {
        const requestController = new AbortController();
        const abort = () => requestController.abort();
        controller.signal.addEventListener("abort", abort, { once: true });
        const timeout = window.setTimeout(abort, 15000);
        let response;
        try {
          response = await api.get("/projectmanagement/demo-jobs", { params: { language: demoLanguage }, signal: requestController.signal, notify: false });
        } finally {
          window.clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abort);
        }
        if (controller.signal.aborted) return null;
        const jobs = unwrapApiData(response);
        if (!Array.isArray(jobs)) throw new Error("Server status is unavailable");
        setDemoJobs(jobs);
        return jobs.find(item => item.id === activeRenderId);
      },
      onJob: serverJob => {
        if (Number(serverJob.durationSeconds) !== Number(demoJob.durationSeconds)) {
          updateDemoProgress("render", { label: "Server returned inconsistent settings; rechecking this job" });
          return true;
        }
        const status = String(serverJob.status || "").toLowerCase();
        setDemoJob(current => ({ ...(current || {}), ...serverJob }));
        if (status === "completed" || status === "failed") {
          updateDemoProgress("render", { percent: 100, status: status === "completed" ? "complete" : "failed", label: status === "completed" ? serverJob.durationSeconds + "-second MP4 generated successfully" : serverJob.lastError || "MP4 generation failed on server" });
          setActiveRenderId(null);
          setIsRenderingDemo(false);
        }
      },
      onWaiting: () => updateDemoProgress("render", { label: "Waiting for this job's server status; checking again" }),
      onError: () => updateDemoProgress("render", { label: "Server status unavailable; reconnecting. The render may still be running." }),
    });
    return () => { stop(); controller.abort(); };
  }, [isRenderingDemo, activeRenderId, demoJob?.durationSeconds, demoLanguage]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => `${project.name} ${project.type} ${project.manager} ${project.status}`.toLowerCase().includes(q));
  }, [projects, query]);

  useEffect(() => {
    let mounted = true;
    api.get("/projectmanagement/projects")
      .then((response) => {
        const rows = unwrapApiData(response);
        if (!mounted || !Array.isArray(rows)) return;
        if (rows.length > 0) {
          setProjects(rows);
          savePortfolio(rows);
          setActiveId((current) => rows.some((project) => project.id === current) ? current : rows[0]?.id || "");
        }
        setIsBackendReady(true);
      })
      .catch((error) => {
        console.warn("Project Management backend unavailable; using local portfolio fallback.", error);
        setIsBackendReady(false);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    loadDemoJobs(demoLanguage);
  }, [demoLanguage]);
  const active = projects.find((project) => project.id === activeId) || projects[0];
  const totals = useMemo(() => {
    const totalBudget = projects.reduce((sum, p) => sum + Number(p.budget || 0), 0);
    const totalSpent = projects.reduce((sum, p) => sum + Number(p.spent || 0), 0);
    const avgProgress = projects.length ? Math.round(projects.reduce((sum, p) => sum + Number(p.progress || 0), 0) / projects.length) : 0;
    const openRisks = projects.reduce((sum, p) => sum + (p.risks || []).filter((risk) => risk.status !== "Closed").length, 0);
    return { totalBudget, totalSpent, avgProgress, openRisks };
  }, [projects]);

  function persistProject(project) {
    api.post("/projectmanagement/projects", project)
      .then(() => setIsBackendReady(true))
      .catch((error) => {
        setIsBackendReady(false);
        console.warn("Project Management save stayed local because backend save failed.", error);
      });
  }

  function updateProjects(next) {
    setProjects(next);
    savePortfolio(next);
  }

  function addProject(templateKey) {
    const template = PROJECT_TEMPLATES[templateKey];
    const project = makeProject(`${template.type} - New Project`, templateKey);
    const next = [project, ...projects];
    updateProjects(next);
    persistProject(project);
    setActiveId(project.id);
    setView("control");
  }

  function updateActive(patch) {
    if (!active) return;
    const updated = { ...active, ...patch };
    updateProjects(projects.map((project) => project.id === active.id ? updated : project));
    persistProject(updated);
  }

  async function loadDemoJobs(language = demoLanguage) {
    try {
      const response = await api.get("/projectmanagement/demo-jobs", { params: { language } });
      const rows = unwrapApiData(response);
      if (Array.isArray(rows)) setDemoJobs(rows);
    } catch (error) {
      console.warn("Demo render job history could not be loaded.", error);
    }
  }
  function resumeDemoJob(job) {
    setDemoLanguage(job.language);
    setDemoDuration(Number(job.durationSeconds));
    setDemoVoice(job.voiceKey);
    setDemoMusic(job.musicStyle);
    setDemoMusicVolume(Math.round(Number(job.musicVolume) * 100));
    setDemoJob(job);
    setRenderStartedAt(Date.parse(job.requestedAt) || Date.now());
    setActiveRenderId(job.id);
    setIsRenderingDemo(true);
    updateDemoProgress("render", { percent: 5, status: "running", label: "Checking existing job on server" });
  }

  async function createDemoJob() {
    updateDemoProgress("prepare", { percent: 12, status: "running", label: "Building capture plan" });
    const now = new Date().toISOString();
    const selectedVoice = VOICE_OPTIONS.find((voice) => voice.key === demoVoice) || VOICE_OPTIONS[0];
    const job = {
      id: `demo_${Date.now()}`,
      name: "Mahima Application Demo Project",
      status: "queued",
      requestedAt: now,
      appBaseUrl: window.location.origin,
      language: demoLanguage,
      voiceKey: selectedVoice.key,
      voiceLabel: selectedVoice.label,
      ttsVoice: selectedVoice.ttsVoice?.[demoLanguage] || selectedVoice.ttsVoice?.en || "onyx",
      ttsInstructions: demoVoiceInstructions(selectedVoice, demoLanguage),
      requireOpenAiSpeech: true,
      durationSeconds: demoDuration,
      musicStyle: demoMusic,
      musicVolume: demoMusicVolume / 100,
      output: `mahima-app-demo-${demoLanguage}-${demoDuration}s.mp4`,
      frameRate: 30,
      resolution: "1920x1080",
      voiceOver: VOICE_SCRIPTS[demoLanguage],
      captureRoutes: DEMO_RENDER_ROUTES.map((route, index) => ({
        ...route,
        path: toHashRoute(route.path),
        screenshotName: `${String(index + 1).padStart(2, "0")}-${route.key.toLowerCase()}.png`,
        narration: demoNarration(route, index, demoLanguage),
        waitMs: routeWaitMs(route),
        durationSeconds: index === 0 ? 7 : 6,
      })),
      rendererRequirements: [
        "Authenticated browser session with admin permissions",
        "Playwright screenshot capture for every route with per-page wait timing",
        "OpenAI speech voice-over is required; render fails instead of falling back to machine voice",
        "ffmpeg composition where each segment duration follows the narration length",
        `Final runtime is exactly ${demoDuration} seconds with narration distributed across all screens`,
      ],
    };
    setDemoJob(job);
    try {
      const response = await api.post("/projectmanagement/demo-jobs", job);
      updateDemoProgress("prepare", { percent: 72, status: "running", label: "Saving render configuration" });
      if (!response?.ok) throw new Error(response?.error || "The demo render job could not be saved.");
      setIsBackendReady(true);
      await loadDemoJobs(demoLanguage);
      updateDemoProgress("prepare", { percent: 100, status: "complete", label: "Render job is ready" });
    } catch (error) {
      setIsBackendReady(false);
      setDemoJob((current) => ({ ...(current || job), status: "failed", lastError: error?.message || "The demo render job could not be saved." }));
      console.warn("Demo render job stayed local because backend save failed.", error);
      updateDemoProgress("prepare", { percent: 100, status: "failed", label: "Job preparation failed" });
    }
  }


  async function analyzeUploadedCaptures(files) {
    const selectedFiles = Array.from(files || []).filter(Boolean);
    if (!selectedFiles.length) return;
    setIsAnalyzingCaptures(true);
    updateDemoProgress("captures", { percent: 5, status: "running", label: `Uploading ${selectedFiles.length} screenshot${selectedFiles.length === 1 ? "" : "s"}` });
    try {
      const selectedVoice = VOICE_OPTIONS.find((item) => item.key === demoVoice) || VOICE_OPTIONS[0];
      const form = new FormData();
      selectedFiles.forEach((file) => form.append("files", file));
      form.append("language", demoLanguage);
      form.append("requireAi", "true");
      const response = await api.post("/projectmanagement/demo-jobs/analyze-captures", form);
      const result = unwrapApiData(response) || {};
      const routes = Array.isArray(result.routes) ? result.routes : [];
      if (!routes.length) throw new Error("No screenshot routes were generated.");

      const now = new Date().toISOString();
      const job = {
        id: `demo_${Date.now()}`,
        name: "Mahima Application Demo Project - Uploaded Screens",
        status: "queued",
        requestedAt: now,
        appBaseUrl: window.location.origin,
        captureSetId: result.captureSetId,
        source: "uploaded-screenshots",
        language: demoLanguage,
        voiceKey: selectedVoice.key,
        voiceLabel: selectedVoice.label,
        ttsVoice: selectedVoice.ttsVoice?.[demoLanguage] || selectedVoice.ttsVoice?.en || "onyx",
        ttsInstructions: demoVoiceInstructions(selectedVoice, demoLanguage),
        requireOpenAiSpeech: true,
        durationSeconds: demoDuration,
        musicStyle: demoMusic,
        musicVolume: demoMusicVolume / 100,
        output: `mahima-app-demo-${demoLanguage}-${demoDuration}s.mp4`,
        frameRate: 30,
        resolution: "1920x1080",
        voiceOver: VOICE_SCRIPTS[demoLanguage],
        captureRoutes: routes,
        rendererRequirements: [
          "Uploaded screenshots are used as the capture source",
          "OpenAI vision generates narration from each screenshot when configured",
          "OpenAI speech generates human-like MP3 narration and is required",
          "ffmpeg composition syncs each screenshot with its generated narration",
        ],
      };

      setDemoJob(job);
      setUploadedCaptureCount(routes.length);
      await api.post("/projectmanagement/demo-jobs", job);
      setIsBackendReady(true);
      loadDemoJobs(demoLanguage);
      updateDemoProgress("captures", { percent: 100, status: "complete", label: `${routes.length} screens analyzed and prepared` });
      updateDemoProgress("prepare", { percent: 100, status: "complete", label: "Uploaded-screen render job is ready" });
    } catch (error) {
      setIsBackendReady(false);
      console.warn("Uploaded screenshots could not be analyzed.", error);
      alert(error?.message || "Uploaded screenshots could not be analyzed.");
      updateDemoProgress("captures", { percent: 100, status: "failed", label: "Screenshot analysis failed" });
    } finally {
      setIsAnalyzingCaptures(false);
    }
  }

  async function renderDemoMp4() {
    if (!demoJob?.id) return;
    setActiveRenderId(null);
    setIsRenderingDemo(true);
    setRenderStartedAt(Date.now());
    updateDemoProgress("render", { percent: 2, status: "running", label: "Verifying production renderer" });
    try {
      const selectedVoice = VOICE_OPTIONS.find((item) => item.key === demoVoice) || VOICE_OPTIONS[0];
      const settings = { language: demoLanguage, durationSeconds: demoDuration, voiceKey: demoVoice, musicStyle: demoMusic, musicVolume: demoMusicVolume / 100 };
      const currentJob = newDemoRenderAttempt(demoJob, settings, selectedVoice, 'demo_' + crypto.randomUUID());
      // Refresh saved live plans too: older jobs omitted modules from short films.
      if (demoJob.source !== "uploaded-screenshots") {
        currentJob.captureRoutes = DEMO_RENDER_ROUTES.map((route, index) => ({
          ...route, path: toHashRoute(route.path),
          screenshotName: `${String(index + 1).padStart(2, "0")}-${route.key.toLowerCase()}.png`,
          narration: demoNarration(route, index, demoLanguage), waitMs: routeWaitMs(route),
        }));
      }
      if (demoJob.language !== demoLanguage) {
        if (demoJob.source === "uploaded-screenshots") throw new Error("Analyze the uploaded screenshots in the selected language before rendering.");
        currentJob.captureRoutes = currentJob.captureRoutes.map((route, index) => ({ ...route, narration: demoNarration(route, index, demoLanguage) }));
      }
      const verificationController = new AbortController();
      const verificationTimeout = window.setTimeout(() => verificationController.abort(), 10000);
      let rendererInfoResponse;
      try {
        rendererInfoResponse = await api.get("/projectmanagement/demo-renderer-info", { signal: verificationController.signal, notify: false });
      } finally {
        window.clearTimeout(verificationTimeout);
      }
      const rendererInfo = unwrapApiData(rendererInfoResponse) || {};
      if (!rendererInfoResponse?.ok || rendererInfo.build !== DEMO_RENDERER_BUILD || rendererInfo.sceneSynchronizedSpeech !== true || !rendererInfo.backgroundJobs || !rendererInfo.rendererScriptFound) {
        throw new Error(`Studio update is incomplete. This page requires ${DEMO_RENDERER_BUILD}, but the API reports ${rendererInfo.build || rendererInfo.version || "an unknown build"}. Deploy the matching API and both renderer files (render-demo.js and story.js), restart the API service, then retry.`);
      }
      const saved = await api.post("/projectmanagement/demo-jobs", currentJob);
      if (!saved?.ok) throw new Error("Could not save the selected demo settings.");
      setDemoJob(currentJob);
      updateDemoProgress("render", { percent: 3, status: "running", label: "Starting verified MP4 renderer" });
      const startController = new AbortController();
      const startTimeout = window.setTimeout(() => startController.abort(), 15000);
      let response;
      try {
        response = await api.post(`/projectmanagement/demo-jobs/${encodeURIComponent(currentJob.id)}/render`, {}, { signal: startController.signal, notify: false });
      } finally {
        window.clearTimeout(startTimeout);
      }
      if (!response?.ok) throw new Error(response?.error || response?.statusText || "Demo MP4 render failed.");
      const result = unwrapApiData(response) || {};
      if (result.rendererBuild !== DEMO_RENDERER_BUILD || result.id !== currentJob.id || Number(result.durationSeconds) !== demoDuration) throw new Error("The renderer did not confirm the selected duration and current render build.");
      const status = String(result?.status || result?.Status || "").toLowerCase();
      if (status === "rendering" || status === "queued") {
        setDemoJob({ ...currentJob, ...result, status: "rendering" });
        setActiveRenderId(currentJob.id);
        updateDemoProgress("render", { status: "running", label: "Renderer started · checking server status" });
        return;
      }
      if (String(result?.status || result?.Status || "").toLowerCase() !== "completed" || !(result?.downloadUrl || result?.DownloadUrl)) {
        throw new Error(result?.lastError || result?.LastError || "The renderer did not return a completed MP4 download.");
      }
      const downloadUrl = result?.downloadUrl || result?.DownloadUrl || result?.url || result?.Url || "";
      const outputFileName = result?.outputFileName || result?.OutputFileName || result?.output || demoJob.output;
      setDemoJob((current) => ({
        ...(current || demoJob),
        ...result,
        downloadUrl,
        outputFileName,
        status: result?.status || result?.Status || "completed",
      }));
      setIsBackendReady(true);
      loadDemoJobs(demoLanguage);
      updateDemoProgress("render", { percent: 100, status: "complete", label: "MP4 generated successfully" });
      setIsRenderingDemo(false);
    } catch (error) {
      setDemoJob((current) => ({ ...(current || demoJob), status: "failed", lastError: error?.message || "Render failed" }));
      console.warn("Demo MP4 render failed.", error);
      updateDemoProgress("render", { percent: 100, status: "failed", label: "MP4 generation failed" });
      setIsRenderingDemo(false);
    }
  }

  function downloadDemoJob() {
    if (!demoJob) return;
    const blob = new Blob([JSON.stringify(demoJob, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${demoJob.id}-mp4-render-job.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pm-root">
      <style>{styles}</style>

      <header className="pm-header">
        <div>
          <span className="pm-eyebrow"><Briefcase size={14} /> PMO Workspace {isBackendReady ? "• Synced" : "• Local fallback"}</span>
          <h1>Project Management</h1>
          <p>Manage church construction, crusades, operational portfolios, and Mahima App demo delivery from one PMO control room.</p>
        </div>
        <div className="pm-actions">
          <button onClick={() => addProject("construction")}><Building2 size={16} /> Construction</button>
          <button onClick={() => addProject("crusade")}><Megaphone size={16} /> Crusade</button>
          <button onClick={() => addProject("appDemo")}><FileVideo size={16} /> App Demo</button>
        </div>
      </header>

      <section className="pm-metrics">
        <Metric label="Portfolio budget" value={currency(totals.totalBudget)} icon={<Wallet />} />
        <Metric label="Actual spend" value={currency(totals.totalSpent)} icon={<BarChart3 />} />
        <Metric label="Avg progress" value={`${totals.avgProgress}%`} icon={<Gauge />} />
        <Metric label="Open risks" value={totals.openRisks} icon={<AlertTriangle />} tone={totals.openRisks > 4 ? "watch" : "ok"} />
      </section>

      <nav className="pm-tabs">
        {[
          ["portfolio", "Portfolio"],
          ["control", "PMO Control"],
          ["governance", "Governance"],
          ["demo", "Demo Studio"],
        ].map(([key, label]) => (
          <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{label}</button>
        ))}
      </nav>

      {view === "portfolio" && (
        <section className="pm-layout">
          <aside className="pm-list">
            <div className="pm-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" /></div>
            {filtered.map((project) => {
              const Icon = PROJECT_TEMPLATES[project.templateKey]?.icon || Briefcase;
              return (
                <button key={project.id} className={`pm-project-row ${active?.id === project.id ? "active" : ""}`} onClick={() => setActiveId(project.id)}>
                  <Icon size={18} />
                  <span><strong>{project.name}</strong><em>{project.type}</em></span>
                  <b className={healthClass(project.health)}>{project.health}</b>
                </button>
              );
            })}
          </aside>
          <ProjectOverview project={active} onChange={updateActive} />
        </section>
      )}

      {view === "control" && <ControlRoom project={active} onChange={updateActive} />}
      {view === "governance" && <GovernanceView project={active} />}
      {view === "demo" && (
        <DemoStudio
          language={demoLanguage}
          setLanguage={setDemoLanguage}
          demoJob={demoJob}
          voice={demoVoice}
          setVoice={setDemoVoice}
          duration={demoDuration}
          setDuration={setDemoDuration}
          music={demoMusic}
          setMusic={setDemoMusic}
          musicVolume={demoMusicVolume}
          setMusicVolume={setDemoMusicVolume}
          voiceOptions={VOICE_OPTIONS}
          onPreviewVoice={(voice) => previewVoiceSample(voice, demoLanguage)}
          onCreate={createDemoJob}
          onDownload={downloadDemoJob}
          onRender={renderDemoMp4}
          isRendering={isRenderingDemo}
          onAnalyzeCaptures={analyzeUploadedCaptures}
          isAnalyzingCaptures={isAnalyzingCaptures}
          uploadedCaptureCount={uploadedCaptureCount}
          progress={demoProgress}
          demoJobs={demoJobs}
          onResumeJob={resumeDemoJob}
          onRefreshJobs={() => loadDemoJobs(demoLanguage)}
        />
      )}
    </div>
  );
}

function Metric({ label, value, icon, tone = "" }) {
  return <div className={`pm-metric ${tone}`}>{React.cloneElement(icon, { size: 18 })}<span>{label}</span><strong>{value}</strong></div>;
}

function ProjectOverview({ project, onChange }) {
  if (!project) return <div className="pm-panel">No project selected.</div>;
  const template = PROJECT_TEMPLATES[project.templateKey] || PROJECT_TEMPLATES.construction;
  const Icon = template.icon;
  return (
    <main className="pm-panel">
      <div className="pm-project-head">
        <div className="pm-project-icon" style={{ color: template.accent }}><Icon size={24} /></div>
        <div>
          <input className="pm-title-input" value={project.name} onChange={(e) => onChange({ name: e.target.value })} />
          <p>{project.type} • Sponsor: {project.sponsor} • PM: {project.manager}</p>
        </div>
        <span className={`pm-health ${healthClass(project.health)}`}>{project.health}</span>
      </div>

      <div className="pm-form-grid">
        <Field label="Sponsor" value={project.sponsor} onChange={(value) => onChange({ sponsor: value })} />
        <Field label="Project Manager" value={project.manager} onChange={(value) => onChange({ manager: value })} />
        <Field label="Status" value={project.status} onChange={(value) => onChange({ status: value })} />
        <Field label="Health" value={project.health} onChange={(value) => onChange({ health: value })} />
        <Field label="Target date" type="date" value={project.targetDate} onChange={(value) => onChange({ targetDate: value })} />
        <Field label="Progress %" type="number" value={project.progress} onChange={(value) => onChange({ progress: Number(value) })} />
      </div>

      <div className="pm-progress"><span style={{ width: `${project.progress}%` }} /></div>

      <div className="pm-card-grid">
        <InfoCard title="Budget baseline" value={currency(project.budget)} icon={<Wallet />} />
        <InfoCard title="Actual spend" value={currency(project.spent)} icon={<BarChart3 />} />
        <InfoCard title="Workstreams" value={project.workstreams.length} icon={<ClipboardList />} />
        <InfoCard title="Risks" value={project.risks.length} icon={<AlertTriangle />} />
      </div>
    </main>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return <label className="pm-field"><span>{label}</span><input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></label>;
}

function InfoCard({ title, value, icon }) {
  return <div className="pm-info-card">{React.cloneElement(icon, { size: 18 })}<span>{title}</span><strong>{value}</strong></div>;
}

function ControlRoom({ project, onChange }) {
  if (!project) return <div className="pm-panel">No project selected.</div>;
  return (
    <section className="pm-control-grid">
      <div className="pm-panel">
        <h2><Milestone size={18} /> Phase Gate Plan</h2>
        <div className="pm-phase-list">
          {project.phases.map((phase, index) => (
            <div key={phase.id} className="pm-phase">
              <b>{index + 1}</b>
              <span><strong>{phase.name}</strong><em>{phase.owner}</em></span>
              <small>{phase.status}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="pm-panel">
        <h2><Target size={18} /> Workstream Tracking</h2>
        {project.workstreams.map((stream) => (
          <div key={stream.id} className="pm-stream">
            <div><strong>{stream.name}</strong><span>{stream.owner}</span></div>
            <div className="pm-mini-progress"><i style={{ width: `${stream.completion}%` }} /></div>
            <b>{stream.completion}%</b>
          </div>
        ))}
      </div>
      <div className="pm-panel">
        <h2><AlertTriangle size={18} /> RAID Log</h2>
        {project.risks.map((risk) => (
          <div key={risk.id} className="pm-risk">
            <strong>{risk.title}</strong>
            <span>{risk.impact} impact • {risk.status}</span>
            <p>{risk.mitigation}</p>
          </div>
        ))}
      </div>
      <div className="pm-panel">
        <h2><ShieldCheck size={18} /> PMO Cadence</h2>
        <ul className="pm-checks">
          <li><CheckCircle2 size={15} /> Weekly sponsor review</li>
          <li><CheckCircle2 size={15} /> Budget variance review</li>
          <li><CheckCircle2 size={15} /> Risk escalation board</li>
          <li><CheckCircle2 size={15} /> Milestone acceptance sign-off</li>
        </ul>
      </div>
    </section>
  );
}

function GovernanceView({ project }) {
  if (!project) return <div className="pm-panel">No project selected.</div>;
  return (
    <section className="pm-panel">
      <h2><ShieldCheck size={18} /> Governance and PMO Controls</h2>
      <div className="pm-governance-grid">
        {[
          ["Charter", "Purpose, scope, sponsor, success criteria, and funding baseline."],
          ["Schedule", "Phase gates, dependencies, critical milestones, and delivery forecast."],
          ["Financials", "Budget, commitments, actuals, variance, and donor reporting."],
          ["RAID", "Risks, assumptions, issues, dependencies, owners, and escalations."],
          ["Change Control", "Scope changes, impact assessment, approvals, and audit trail."],
          ["Benefits", "Spiritual, operational, community, and ministry outcome tracking."],
        ].map(([title, text]) => (
          <div key={title} className="pm-governance-card"><Flag size={16} /><strong>{title}</strong><p>{text}</p></div>
        ))}
      </div>
      <h3>Decision Register</h3>
      <table className="pm-table"><thead><tr><th>Decision</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>{project.decisions.map((d) => <tr key={d.id}><td>{d.title}</td><td>{d.owner}</td><td>{d.due}</td><td>{d.status}</td></tr>)}</tbody></table>
    </section>
  );
}

function DemoStudio({ onResumeJob, onRefreshJobs, language, setLanguage, demoJob, demoJobs = [], voice, setVoice, duration, setDuration, music, setMusic, musicVolume, setMusicVolume, voiceOptions = [], onPreviewVoice, onCreate, onDownload, onRender, isRendering, onAnalyzeCaptures, isAnalyzingCaptures, uploadedCaptureCount, progress = {} }) {
  const settings = { language, durationSeconds: duration, voiceKey: voice, musicStyle: music, musicVolume: musicVolume / 100 };
  const latestCompletedJob = demoJobs.find((job) => matchesDemoSettings(job, settings) && buildDemoDownloadUrl(job, language));
  const currentMp4DownloadUrl = matchesDemoSettings(demoJob, settings) ? buildDemoDownloadUrl(demoJob, language) : "";
  const captureSequence = Array.isArray(demoJob?.captureRoutes) && demoJob.captureRoutes.length ? demoJob.captureRoutes : DEMO_RENDER_ROUTES;
  const captureSourceLabel = demoJob?.source === "uploaded-screenshots" ? "Uploaded screenshots" : "Live app routes";
  return (
    <section className="pm-demo-grid">
      <div className="pm-panel">
        <h2><FileVideo size={18} /> Mahima Application Demo Project</h2>
        <p className="pm-muted">Tell a complete ministry story across every module, with expressive AI narration, smooth cinematic camera movement, and vibrant music that softens during speech.</p>
        <div className="pm-language-row">
          {[
            ["en", "English"],
            ["hi", "Hindi"],
            ["pa", "Punjabi"],
          ].map(([code, label]) => <button disabled={isRendering || isAnalyzingCaptures} key={code} className={language === code ? "active" : ""} onClick={() => setLanguage(code)}>{label}</button>)}
        </div>
        <div className="pm-voice-box">
          <div className="pm-voice-title"><Volume2 size={16} /><strong>Voice sample</strong><span>AI narration · native-language story · cinematic delivery</span></div>
          <div className="pm-voice-options">
            {voiceOptions.map((option) => (
              <button disabled={isRendering || isAnalyzingCaptures} key={option.key} type="button" className={voice === option.key ? "active" : ""} onClick={() => setVoice(option.key)}>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
                <em>{language === "hi" ? "हिन्दी" : language === "pa" ? "ਪੰਜਾਬੀ" : "English"}</em>
              </button>
            ))}
          </div>
          <button className="pm-preview-voice" type="button" onClick={() => onPreviewVoice?.(voiceOptions.find((option) => option.key === voice) || voiceOptions[0])}>
            <PlayCircle size={15} /> Preview selected voice
          </button>
        </div>
        <div className="pm-upload-box">
          <div><strong><Upload size={16} /> Upload screen captures</strong><span>Use this when live capture gets stuck. AI will read each screenshot and write narration dynamically.</span></div>
          <label className="pm-upload-button">
            <Upload size={15} /> {isAnalyzingCaptures ? "Analyzing..." : "Choose screenshots"}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={isRendering || isAnalyzingCaptures} onChange={(event) => onAnalyzeCaptures?.(event.target.files)} />
          </label>
          {uploadedCaptureCount > 0 && <em>{uploadedCaptureCount} uploaded screens prepared</em>}
        </div>
        <div className="pm-demo-actions">
          <button disabled={isRendering || isAnalyzingCaptures} className="primary" onClick={onCreate}><Sparkles size={16} /> Prepare live MP4 job</button>
          <button disabled={!demoJob || isRendering || isAnalyzingCaptures} onClick={onRender}><PlayCircle size={16} /> {isRendering ? "Rendering MP4..." : "Generate MP4"}</button>
          <button disabled={!demoJob} onClick={onDownload}><Download size={16} /> Download render job</button>
          {currentMp4DownloadUrl && <a className="pm-download-link current" href={currentMp4DownloadUrl} target="_blank" rel="noreferrer"><Download size={16} /> Download current MP4</a>}
        </div>
        <div className="pm-process-progress" aria-live="polite">
          <div className="pm-progress-heading"><strong><Gauge size={16} /> Process progress</strong><span>{Object.values(progress).some((item) => item?.status === "running") ? "Work in progress" : "Pipeline status"}</span></div>
          {[
            ["captures", "Screen capture analysis"],
            ["prepare", "Render-job preparation"],
            ["render", "MP4 generation"],
          ].filter(([key]) => key !== "captures" || (progress.captures && progress.captures.status !== "idle")).map(([key, title]) => {
            const item = progress[key] || { percent: 0, status: "idle", label: "Not started" };
            return <div className={`pm-process-row ${item.status}`} key={key}>
              <div className="pm-process-meta"><strong>{title}</strong><span>{item.label}</span><b>{Math.round(item.percent || 0)}%</b></div>
              <div className="pm-process-track" role="progressbar" aria-label={title} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(item.percent || 0)}><i style={{ width: `${Math.max(0, Math.min(100, item.percent || 0))}%` }} /></div>
            </div>;
          })}
        </div>
        <div className="pm-output-options">
          <div className="pm-option-group">
            <strong><Timer size={16} /> Video length</strong>
            <div className="pm-duration-options">
              {DEMO_DURATION_OPTIONS.map((option) => (
                <button disabled={isRendering || isAnalyzingCaptures} type="button" key={option.seconds} className={duration === option.seconds ? "active" : ""} onClick={() => setDuration(option.seconds)}>
                  <b>{option.label}</b><span>{option.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pm-option-group">
            <strong><Volume2 size={16} /> Background music</strong>
            <div className="pm-music-options">
              {DEMO_MUSIC_OPTIONS.map((option) => (
                <button disabled={isRendering || isAnalyzingCaptures} type="button" key={option.key} className={music === option.key ? "active" : ""} onClick={() => setMusic(option.key)}>
                  <b>{option.label}</b><span>{option.description}</span>
                </button>
              ))}
            </div>
            <label className="pm-volume-control"><span>Music volume</span><input type="range" min="0" max="60" value={musicVolume} disabled={isRendering || isAnalyzingCaptures || music === "none"} onChange={(event) => setMusicVolume(Number(event.target.value))} /><b>{music === "none" ? "Off" : `${musicVolume}%`}</b></label>
          </div>
        </div>
        {demoJob && String(demoJob.status || demoJob.Status || "").toLowerCase() !== "completed" && (
          <div className={`pm-render-state ${String(demoJob.status || demoJob.Status || "").toLowerCase() === "failed" ? "failed" : "pending"}`}>
            <strong>MP4 status: {demoJob.status || demoJob.Status || "not generated"}</strong>
            {(demoJob.lastError || demoJob.LastError) && <pre>{demoJob.lastError || demoJob.LastError}</pre>}
            <small>Generate the MP4 successfully before downloading it.</small>
          </div>
        )}
        <div className="pm-completed-demo">
          <strong>Recent server jobs</strong>
          <button type="button" onClick={onRefreshJobs}>Refresh server status</button>
          <small>Check an existing job before starting another render.</small>
          {demoJobs.filter(job => ["rendering", "completed", "failed"].includes(String(job.status).toLowerCase())).slice(0, 5).map(job => (
            <button key={job.id} type="button" disabled={isRendering || isAnalyzingCaptures} onClick={() => onResumeJob(job)}>
              {job.durationSeconds}s · {job.language} · {job.status} · {job.requestedAt ? new Date(job.requestedAt).toLocaleString() : job.id} · Check job
            </button>
          ))}
        </div>
        <div className="pm-render-note"><AlertTriangle size={16} /> 60 and 90-second demos tell a complete story across all modules with brief scenes and cinematic camera movement. 5 and 10-minute demos use full live-route recording. Uploaded screenshots remain available as a fallback. AI narration and speech require the configured OpenAI key.</div>
        {latestCompletedJob && <div className="pm-completed-demo"><strong>Latest matching MP4 · {duration} seconds</strong><span>{latestCompletedJob.output || latestCompletedJob.outputFileName || "Mahima demo MP4"}</span><a href={buildDemoDownloadUrl(latestCompletedJob, language)} target="_blank" rel="noreferrer"><Download size={15} /> Open latest MP4</a></div>}
      </div>
      <div className="pm-panel">
        <h2><PlayCircle size={18} /> Dynamic Capture Sequence</h2>
        <p className="pm-sequence-source">{captureSourceLabel}</p>
        <div className="pm-route-list">
          {captureSequence.map((route, index) => <div key={route.key || `${route.title}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span>{route.title}</span><em>{route.path || route.source || "uploaded"}</em><small>{((route.waitMs || routeWaitMs(route)) / 1000).toFixed(1)}s wait</small></div>)}
        </div>
      </div>
      <div className="pm-panel wide">
        <h2><Timer size={18} /> Render Job Status</h2>
        {demoJob ? (
          <pre className="pm-job-preview">{JSON.stringify(demoJob, null, 2)}</pre>
        ) : (
          <div className="pm-empty">No demo render job prepared yet.</div>
        )}
      </div>
    </section>
  );
}

const styles = `
.pm-root { padding: 24px; color: #102033; background: #f6f8fb; min-height: 100%; }
.pm-header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
.pm-eyebrow { display: inline-flex; align-items: center; gap: 7px; color: #047857; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
.pm-header h1 { margin: 8px 0 6px; font-size: 30px; line-height: 1.1; }
.pm-header p, .pm-muted { margin: 0; color: #617086; max-width: 760px; }
.pm-actions, .pm-demo-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pm-upload-box { border: 1px dashed #94a3b8; border-radius: 8px; padding: 12px; margin: 12px 0; display: grid; gap: 10px; background: #f8fafc; }
.pm-upload-box div { display: grid; gap: 4px; }
.pm-upload-box strong { display: flex; align-items: center; gap: 7px; }
.pm-upload-box span, .pm-upload-box em { color: #617086; font-size: 12px; font-style: normal; }
.pm-upload-button { width: max-content; border: 1px solid #dfe7ef; background: #fff; border-radius: 8px; padding: 8px 10px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-weight: 800; }
.pm-upload-button input { display: none; }
.pm-render-state { display:grid; gap:5px; margin:12px 0; padding:11px 12px; border-radius:8px; border:1px solid #fde68a; background:#fffbeb; color:#92400e; font-size:13px; }
.pm-process-progress { margin:12px 0; padding:12px; border:1px solid #dfe7ef; border-radius:8px; background:#f8fafc; display:grid; gap:11px; }
.pm-progress-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.pm-progress-heading strong { display:flex; align-items:center; gap:7px; }
.pm-progress-heading span { color:#617086; font-size:12px; }
.pm-process-row { display:grid; gap:6px; }
.pm-process-meta { display:grid; grid-template-columns:minmax(145px,.7fr) minmax(170px,1fr) 40px; align-items:center; gap:8px; font-size:12px; }
.pm-process-meta span { color:#617086; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pm-process-meta b { text-align:right; color:#475569; }
.pm-process-track { height:9px; overflow:hidden; border-radius:999px; background:#e2e8f0; box-shadow:inset 0 1px 2px rgba(15,23,42,.08); }
.pm-process-track i { display:block; height:100%; min-width:0; border-radius:inherit; background:#94a3b8; transition:width .45s ease; }
.pm-process-row.running .pm-process-track i { background:linear-gradient(90deg,#047857,#10b981); position:relative; }
.pm-process-row.complete .pm-process-track i { background:#16a34a; }
.pm-process-row.failed .pm-process-track i { background:#dc2626; }
.pm-process-row.failed .pm-process-meta span, .pm-process-row.failed .pm-process-meta b { color:#b91c1c; }
.pm-render-state.failed { border-color:#fecaca; background:#fef2f2; color:#991b1b; }
.pm-render-state pre { max-height:220px; margin:2px 0; padding:9px 10px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; border-radius:6px; background:rgba(255,255,255,.72); color:inherit; font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; }
.pm-voice-box { border: 1px solid #dfe7ef; border-radius: 8px; padding: 12px; margin: 14px 0; background: #f8fafc; }
.pm-output-options { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:14px 0; }
.pm-option-group { border:1px solid #dfe7ef; border-radius:8px; padding:12px; background:#f8fafc; display:grid; gap:9px; }
.pm-option-group > strong { display:flex; align-items:center; gap:7px; }
.pm-duration-options, .pm-music-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
.pm-duration-options button, .pm-music-options button { border:1px solid #dfe7ef; background:#fff; border-radius:8px; padding:9px; text-align:left; display:grid; gap:2px; cursor:pointer; min-width:0; white-space:normal; overflow-wrap:anywhere; justify-content:stretch; }
.pm-duration-options button.active, .pm-music-options button.active { border-color:#047857; background:#ecfdf5; box-shadow:inset 0 0 0 1px #047857; }
.pm-duration-options span, .pm-music-options span, .pm-volume-control span { color:#617086; font-size:11px; }
.pm-volume-control { display:grid; grid-template-columns:auto 1fr 34px; align-items:center; gap:8px; }
.pm-volume-control input { accent-color:#047857; width:100%; }
.pm-voice-title { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.pm-voice-title span { color: #617086; font-size: 12px; margin-left: auto; }
.pm-voice-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.pm-voice-options button { border: 1px solid #dfe7ef; background: #fff; border-radius: 8px; padding: 10px; text-align: left; display: grid; gap: 4px; cursor: pointer; }
.pm-voice-options button.active { border-color: #047857; background: #ecfdf5; box-shadow: inset 0 0 0 1px #047857; }
.pm-voice-options span, .pm-voice-options em { color: #617086; font-size: 12px; font-style: normal; }
.pm-preview-voice { margin-top: 10px; border: 1px solid #dfe7ef; background: #fff; border-radius: 8px; padding: 8px 10px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-weight: 700; }
.pm-actions button, .pm-demo-actions button, .pm-demo-actions a, .pm-tabs button, .pm-language-row button { border: 1px solid #dfe7ef; background: #fff; border-radius: 8px; padding: 9px 12px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-weight: 700; }
.pm-actions button:hover, .pm-demo-actions button:hover, .pm-demo-actions a:hover { border-color: #047857; color: #047857; }
.pm-demo-actions button.primary { background: #047857; color: #fff; border-color: #047857; }
.pm-download-link { text-decoration: none; color: #102033; }
.pm-download-link.current { background: #ecfdf5; border-color: #86efac; color: #047857; }
.pm-demo-actions button:disabled { opacity: .5; cursor: not-allowed; }
.pm-metrics { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
.pm-metric, .pm-info-card { background: #fff; border: 1px solid #dfe7ef; border-radius: 8px; padding: 14px; display: grid; gap: 5px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
.pm-metric svg, .pm-info-card svg { color: #047857; }
.pm-metric span, .pm-info-card span { color: #617086; font-size: 12px; font-weight: 700; }
.pm-metric strong, .pm-info-card strong { font-size: 20px; }
.pm-metric.watch svg { color: #f59e0b; }
.pm-tabs { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid #dfe7ef; background: #fff; border-radius: 10px; margin-bottom: 16px; }
.pm-tabs button { border: none; padding: 8px 14px; }
.pm-tabs button.active, .pm-language-row button.active { background: #047857; color: #fff; }
.pm-layout { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; }
.pm-list, .pm-panel { background: #fff; border: 1px solid #dfe7ef; border-radius: 8px; padding: 14px; box-shadow: 0 10px 24px rgba(15,23,42,.05); }
.pm-search { display: flex; align-items: center; gap: 8px; border: 1px solid #dfe7ef; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
.pm-search input { border: none; outline: none; width: 100%; font: inherit; }
.pm-project-row { width: 100%; border: none; background: transparent; display: grid; grid-template-columns: 24px minmax(0,1fr) auto; gap: 9px; align-items: center; padding: 10px; border-radius: 8px; text-align: left; cursor: pointer; }
.pm-project-row:hover, .pm-project-row.active { background: #ecfdf5; }
.pm-project-row span { display: grid; gap: 2px; min-width: 0; }
.pm-project-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-project-row em { color: #617086; font-size: 12px; font-style: normal; }
.pm-project-row b, .pm-health { border-radius: 999px; padding: 3px 8px; font-size: 11px; background: #dcfce7; color: #166534; }
.pm-project-row b.watch, .pm-health.watch { background: #fef3c7; color: #92400e; }
.pm-project-row b.red, .pm-health.red { background: #fee2e2; color: #991b1b; }
.pm-project-head { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
.pm-project-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 8px; background: #f1f5f9; }
.pm-title-input { border: none; outline: none; font-size: 22px; font-weight: 800; width: 100%; color: #102033; }
.pm-project-head p { margin: 3px 0 0; color: #617086; }
.pm-health { margin-left: auto; text-transform: uppercase; font-weight: 800; }
.pm-form-grid { display: grid; grid-template-columns: repeat(3, minmax(150px,1fr)); gap: 10px; }
.pm-field { display: grid; gap: 5px; }
.pm-field span { color: #617086; font-size: 12px; font-weight: 800; }
.pm-field input { border: 1px solid #dfe7ef; border-radius: 8px; padding: 9px 10px; font: inherit; }
.pm-progress, .pm-mini-progress { height: 9px; background: #e2e8f0; border-radius: 999px; overflow: hidden; margin: 16px 0; }
.pm-progress span, .pm-mini-progress i { display: block; height: 100%; background: #047857; border-radius: inherit; }
.pm-card-grid { display: grid; grid-template-columns: repeat(4, minmax(130px,1fr)); gap: 10px; }
.pm-control-grid, .pm-demo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.pm-panel h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 18px; }
.pm-phase, .pm-stream, .pm-risk, .pm-route-list div { border: 1px solid #eef2f7; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.pm-sequence-source { margin: -6px 0 10px; color: #047857; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.pm-route-list { max-height: 620px; overflow: auto; padding-right: 4px; }
.pm-route-list div { display: grid; grid-template-columns: 42px minmax(150px,1fr) minmax(120px, 220px) 70px; gap: 10px; align-items: center; }
.pm-route-list span, .pm-route-list em { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-route-list small { color: #047857; font-size: 12px; font-weight: 800; text-align: right; }
.pm-phase { display: grid; grid-template-columns: 32px 1fr auto; gap: 10px; align-items: center; }
.pm-phase b { width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; background: #ecfdf5; color: #047857; }
.pm-phase span, .pm-stream div { display: grid; gap: 2px; }
.pm-phase em, .pm-stream span, .pm-risk span, .pm-route-list em { color: #617086; font-size: 12px; font-style: normal; }
.pm-stream { display: grid; grid-template-columns: 1fr 140px 44px; gap: 10px; align-items: center; }
.pm-mini-progress { margin: 0; height: 7px; }
.pm-risk strong { display: block; margin-bottom: 4px; }
.pm-risk p { margin: 6px 0 0; color: #617086; font-size: 13px; }
.pm-checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px; }
.pm-checks li { display: flex; align-items: center; gap: 8px; color: #334155; }
.pm-governance-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; margin-bottom: 16px; }
.pm-governance-card { border: 1px solid #dfe7ef; border-radius: 8px; padding: 12px; }
.pm-governance-card svg { color: #047857; }
.pm-governance-card strong { display: block; margin: 6px 0; }
.pm-governance-card p { margin: 0; color: #617086; font-size: 13px; }
.pm-table { width: 100%; border-collapse: collapse; }
.pm-table th, .pm-table td { text-align: left; border-bottom: 1px solid #eef2f7; padding: 10px; }
.pm-language-row { display: flex; gap: 8px; margin: 16px 0; }
.pm-render-note { display: flex; gap: 8px; color: #92400e; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 10px; margin-top: 12px; font-size: 13px; }
.pm-completed-demo { margin-top: 10px; border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 8px; padding: 10px; display: grid; gap: 4px; }
.pm-completed-demo span { color: #617086; font-size: 13px; }
.pm-completed-demo a { color: #047857; display: inline-flex; align-items: center; gap: 6px; font-weight: 800; text-decoration: none; }
.pm-route-list b { color: #047857; }
.pm-panel.wide { grid-column: 1 / -1; }
.pm-job-preview { max-height: 360px; overflow: auto; background: #0f172a; color: #d1fae5; border-radius: 8px; padding: 14px; font-size: 12px; }
.pm-empty { border: 1px dashed #cbd5e1; color: #64748b; padding: 24px; border-radius: 8px; text-align: center; }
@media (max-width: 1050px) { .pm-layout, .pm-control-grid, .pm-demo-grid { grid-template-columns: 1fr; } .pm-metrics, .pm-card-grid, .pm-governance-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
@media (max-width: 720px) { .pm-root { padding: 14px; } .pm-header { flex-direction: column; } .pm-metrics, .pm-card-grid, .pm-form-grid, .pm-governance-grid, .pm-output-options { grid-template-columns: 1fr; } .pm-stream, .pm-route-list div { grid-template-columns: 34px 1fr; } .pm-route-list em, .pm-route-list small { grid-column: 2; text-align: left; } .pm-process-meta { grid-template-columns:1fr auto; } .pm-process-meta span { grid-column:1 / -1; grid-row:2; white-space:normal; } }
`;








