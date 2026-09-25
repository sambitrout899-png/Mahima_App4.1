// src/features/admin/AdminDashboard.jsx  v3.0
// ── Fixes: Members=0 (arrayFrom shape), compact() decimals, snapshotAt null, chatStats key
// ── New:   Prayer RAG donut · Church Community · Upcoming Week · Team Performance
//           Quick Actions bar · Recent Joiners · Ministry Milestones · trend arrows
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, Ban, BookOpen,
  CalendarCheck, CalendarDays, Download, ExternalLink,
  HeartHandshake, IndianRupee, Layers, Lock,
  MessageSquare, Plus, RefreshCw, ShieldCheck,
  Sparkles, Target, UnlockKeyhole, Users,
} from "lucide-react";
import {
  BarChart, Bar, Cell, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import api from "../../api";

/* ═══════════════════ CONSTANTS ═══════════════════ */
const PALETTE = {
  emerald:"#059669", teal:"#0d9488", blue:"#2563eb", sky:"#0284c7",
  amber:"#d97706", orange:"#ea580c", rose:"#e11d48", violet:"#7c3aed",
  slate:"#475569", indigo:"#4f46e5", pink:"#db2777", lime:"#65a30d",
};
const PIE_COLORS = [PALETTE.emerald, PALETTE.blue, PALETTE.violet, PALETTE.amber, PALETTE.orange, PALETTE.rose, PALETTE.sky, PALETTE.indigo];
const DATE_RANGES = [{ label:"7 days", v:7 },{ label:"30 days", v:30 },{ label:"90 days", v:90 }];
const AUTO_REFRESH = 300;

/* ═══════════════════ HELPERS ═══════════════════ */
function getCurrentUser() {
  try {
    for (const k of ["mahima_user","user","currentUser","mahima_currentUser","me"]) {
      const r = localStorage.getItem(k); if (r) return JSON.parse(r);
    }
  } catch {} return null;
}
function normalizeRoles(u) {
  const out = [];
  const push = (v) => { if (typeof v === "string" && v.trim()) out.push(v.toLowerCase().trim()); };
  push(u?.role); push(u?.Role); push(u?.userRole);
  if (Array.isArray(u?.roles)) u.roles.forEach(r => typeof r === "string" ? push(r) : (push(r?.name), push(r?.role)));
  return out;
}
function hasDashPage(u) {
  const pages = Array.isArray(u?.pages) ? u.pages.map(p => String(p).toUpperCase()) : [];
  return pages.includes("ADMIN") || pages.includes("ADMINDASHBOARD");
}

// ── Data extraction ──
function arrayFrom(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  // Cover every response wrapper shape encountered in the wild
  for (const k of ["data","items","records","rows","results","users","members","list","content","payload","value","collection"]) {
    if (Array.isArray(v[k])) return v[k];
  }
  return [];
}
function totalFrom(v) {
  if (typeof v === "number") return v;
  const rows = arrayFrom(v);
  for (const k of ["total","count","totalCount","recordsTotal","TotalCount","Total","totalRecords","totalItems","length"]) {
    const n = Number(v?.[k]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return rows.length;
}
function num(v, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function compact(v) {
  const n = num(v);
  const abs = Math.abs(n);
  if (abs >= 1e7)      return `${+(n/1e7).toFixed(1)}Cr`;
  if (abs >= 1e5)      return `${+(n/1e5).toFixed(1)}L`;
  if (abs >= 1e3)      return `${+(n/1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
function pct(v, total) {
  if (total !== undefined) return total > 0 ? Math.round((v/total)*100) + "%" : "0%";
  return Math.round(num(v)) + "%";
}
function currency(v) {
  return new Intl.NumberFormat("en-IN",{ style:"currency", currency:"INR", maximumFractionDigits:0 }).format(num(v));
}
function amtFrom(v, ...keys) {
  for (const k of keys) { if (v?.[k] != null) return num(v[k]); } return 0;
}
function countBy(rows, picker) {
  const m = new Map();
  arrayFrom(rows).forEach(row => {
    const key = String((typeof picker === "function" ? picker(row) : row?.[picker]) || "—").trim();
    m.set(key, (m.get(key)||0)+1);
  });
  return [...m.entries()].map(([name,value]) => ({ name, value })).sort((a,b) => b.value-a.value);
}
function titleCaseRole(v) {
  const s = String(v ?? "").trim();
  if (!s) return "Unassigned";
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}
function roleLabel(v, roles = []) {
  const s = String(v ?? "").trim();
  if (!s) return "Member";
  const l = s.toLowerCase();
  const map = { "1":"Admin","2":"Member","10":"Volunteer","11":"Staff","12":"Pastor",
                "admin":"Admin","member":"Member","staff":"Staff","volunteer":"Volunteer","pastor":"Pastor" };
  if (/^\d+$/.test(s)) {
    const found = arrayFrom(roles).find(role => String(role.id ?? role.Id) === s);
    const name = found?.name ?? found?.Name;
    if (name) return titleCaseRole(name);
  }
  return map[s] || map[l] || titleCaseRole(s);
}
function userRole(u, roles = []) { return roleLabel(u?.roleName ?? u?.RoleName ?? u?.role ?? u?.Role ?? u?.roleId ?? u?.RoleId ?? "Member", roles); }
function reportRoleRows(reports, roles = []) {
  return arrayFrom(reports?.users?.byRole)
    .map(row => ({
      name: roleLabel(row.role ?? row.Role ?? row.name ?? row.Name, roles),
      value: num(row.count ?? row.Count ?? row.value ?? row.Value),
    }))
    .filter(row => row.value > 0)
    .sort((a,b) => b.value - a.value || a.name.localeCompare(b.name));
}
function reconcileRoleRows(rows, total, roles = []) {
  const merged = new Map();
  arrayFrom(rows).forEach(row => {
    const name = roleLabel(row.name, roles);
    const value = num(row.value);
    if (value > 0) merged.set(name, (merged.get(name) || 0) + value);
  });
  const out = [...merged.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a,b) => b.value - a.value || a.name.localeCompare(b.name));
  const roleTotal = out.reduce((sum, row) => sum + row.value, 0);
  const missing = Math.max(0, num(total) - roleTotal);
  if (missing > 0) out.push({ name:"Unassigned / Missing Role", value:missing });
  return out;
}
function statusLabel(v) {
  const c = Number(v); const s = String(v||"").toLowerCase();
  if (c===2||/complete|done|closed|finish/.test(s)) return "Completed";
  if (c===3||/hold/.test(s))  return "On Hold";
  if (c===1||/progress|review/.test(s)) return "In Progress";
  return "Pending";
}
function priorityLabel(v) {
  const c = num(v);
  if (c===5) return "Urgent"; if (c===4||c===3) return "Critical";
  if (c===2) return "High";   if (c===1) return "Normal"; if (c===0) return "Low";
  return String(v||"Normal");
}
function taskDue(t) { return t?.dueDate||t?.DueDate||t?.due||t?.Due; }
function isDone(t)  { return statusLabel(t?.status??t?.Status)  === "Completed"; }
function isOver(t)  { const d=taskDue(t); return Boolean(d && !isDone(t) && new Date(d)<new Date()); }
function daysFrom(d, from = new Date()) {
  return Math.ceil((new Date(d)-from)/(864e5));
}
function safeDate(daysBack=0) {
  const d=new Date(); d.setDate(d.getDate()-daysBack);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function monthIsoRange(date = new Date()) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from:from.toISOString(), to:to.toISOString() };
}
function addDays(d, n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
async function safeGet(key, url, cfg={}) {
  try {
    const res = await api.get(url, cfg);
    if (res && typeof res === "object" && "ok" in res && "data" in res) {
      if (!res.ok) throw new Error(res.error || res.statusText || `HTTP ${res.status || ""}`.trim() || "Unavailable");
      return { key, ok:true, data:res.data, error:null };
    }
    return { key, ok:true, data:res, error:null };
  }
  catch(e) { return { key, ok:false, data:null, error:e?.response?.data?.message||e?.message||"Unavailable" }; }
}
function byKey(results) { return results.reduce((a,r)=>{ a[r.key]=r; return a; }, {}); }

/* ═══════════════════ DASHBOARD BUILDER ═══════════════════ */
function buildDashboard(results, days) {
  const r = byKey(results);
  const overview     = r.overview?.data    || {};
  const reports      = r.reports?.data     || {};
  const prayerApi    = r.prayers?.data     || {};
  const roles        = arrayFrom(r.roles?.data);

  // ── Extract arrays with fixed arrayFrom ──
  const users        = arrayFrom(r.users?.data);
  const tasks        = arrayFrom(r.tasks?.data);
  const teams        = arrayFrom(r.teams?.data);
  const attendance   = arrayFrom(r.attendance?.data);
  const timesheets   = arrayFrom(r.timesheets?.data);
  const sermons      = arrayFrom(r.sermons?.data);
  const baptisms     = arrayFrom(r.baptisms?.data);
  const marriages    = arrayFrom(r.marriage?.data);
  const counselling  = arrayFrom(r.counselling?.data);
  const prayerReqs   = arrayFrom(r.prayerRequests?.data);
  const payroll      = arrayFrom(r.payrollRuns?.data);
  const accounts     = arrayFrom(r.accounts?.data);
  const balances     = arrayFrom(r.balances?.data);
  const pnl          = r.costPnl?.data || r.pnl?.data || {};
  const balanceSheet = r.balanceSheet?.data || {};

  // ── Users ──  FIX: use || not ?? so that 0 from analytics falls through to live data
  const userRows     = users.length ? users : arrayFrom(reports?.users);
  const rawRoleRows  = countBy(userRows, u => userRole(u, roles));
  const analyticsRoleRows = reportRoleRows(reports, roles);
  // Each step in the chain: 0 falls through to the next source via ||
  const uTotal  = totalFrom(r.users?.data) || userRows.length || num(overview?.users?.total) || num(reports?.users?.total);
  const roleRows = reconcileRoleRows(rawRoleRows.length ? rawRoleRows : analyticsRoleRows, uTotal, roles);
  const roleVal = (lbl) => roleRows.find(x=>x.name.toLowerCase()===lbl.toLowerCase())?.value || 0;
  const uMembers    = roleVal("Member") || roleVal("member") || num(overview?.users?.members);
  const uAdmins     = roleVal("Admin")  || roleVal("admin")  || num(overview?.users?.admins);
  const uStaff      = roleVal("Staff")  || roleVal("staff")  || num(overview?.users?.staff);
  const uVolunteers = roleVal("Volunteer") || roleVal("volunteer") || num(overview?.users?.volunteers);
  const uNew        = num(overview?.users?.newMembers30d) || num(overview?.users?.new30);
  const roleTotal   = roleRows.reduce((sum,row)=>sum+num(row.value),0);
  const roleMismatch = roleTotal - uTotal;

  // Recent joiners — sorted by createdAt descending
  const recentJoiners = userRows
    .filter(u => u.createdAt||u.joinedAt)
    .sort((a,b)=>new Date(b.createdAt||b.joinedAt)-new Date(a.createdAt||a.joinedAt))
    .slice(0,6)
    .map(u=>({
      name:   u.name||u.Name||u.fullName||u.username||"User",
      role:   userRole(u, roles),
      joined: u.createdAt||u.joinedAt,
      initials:(u.name||u.fullName||"U").trim().split(/\s+/).map(w=>w[0]).join("").toUpperCase().slice(0,2),
    }));

  // Role distribution for chart
  const usersByRole = roleRows.filter(r=>r.value>0);

  // ── Tasks ──
  const liveTasks = tasks.length ? tasks : arrayFrom(reports?.tasks?.items);
  const taskTotal = liveTasks.length || num(reports?.tasks?.total ?? overview?.tasks?.total);

  const taskByStatus = ["Pending","In Progress","Completed","On Hold"].map(name=>{
    const value = liveTasks.length
      ? liveTasks.filter(t=>statusLabel(t?.status??t?.Status)===name).length
      : num(reports?.tasks?.byStatus?.find?.(x=>statusLabel(x.status)===name)?.count);
    return { name, value };
  }).filter(x=>x.value>0);

  const taskByPriority = ["Critical","Urgent","High","Normal","Low"].map(name=>{
    const value = liveTasks.length
      ? liveTasks.filter(t=>priorityLabel(t?.priority??t?.Priority)===name).length
      : num(reports?.tasks?.byPriority?.find?.(x=>priorityLabel(x.priority)===name)?.count);
    return { name, value };
  }).filter(x=>x.value>0);

  const completed   = taskByStatus.find(x=>x.name==="Completed")?.value || 0;
  const openTasks   = Math.max(0, taskTotal - completed);
  const overdue     = liveTasks.filter(isOver);
  const now         = new Date();
  const upcoming    = liveTasks
    .filter(t => !isDone(t) && taskDue(t) && daysFrom(taskDue(t),now)>=0 && daysFrom(taskDue(t),now)<=7)
    .sort((a,b)=>new Date(taskDue(a))-new Date(taskDue(b)))
    .slice(0,8)
    .map(t=>({
      id:t.id??t.Id, title:(t.title??t.Title)||"Untitled",
      due:taskDue(t), daysLeft:daysFrom(taskDue(t),now),
      priority:priorityLabel(t?.priority??t?.Priority),
    }));
  const overdueList = overdue
    .sort((a,b)=>new Date(taskDue(a))-new Date(taskDue(b))).slice(0,8)
    .map(t=>({
      id:t.id??t.Id, title:(t.title??t.Title)||"Untitled",
      due:taskDue(t), daysAgo:Math.abs(daysFrom(taskDue(t),now)),
      priority:priorityLabel(t?.priority??t?.Priority),
    }));
  const todayKey = new Date().toISOString().slice(0,10);
  const taskReminderLogs = liveTasks.flatMap(t =>
    arrayFrom(t.activityLog ?? t.ActivityLog).filter(log =>
      /reminder/i.test(String(log.action ?? log.Action ?? ""))
    )
  );
  const taskReminderTotal = taskReminderLogs.length;
  const taskReminderToday = taskReminderLogs.filter(log => {
    const d = log.createdAt ?? log.CreatedAt;
    return d && new Date(d).toISOString().slice(0,10) === todayKey;
  }).length;

  // ── Chats ── (BUG FIX: backend key is recentMessages30d)
  const chats = reports?.chats || {};
  const chatStats = {
    total:    num(chats.total ?? totalFrom(r.chats?.data)),
    groups:   num(chats.groupChats),
    direct:   num(chats.directChats),
    messages: num(chats.recentMessages30d ?? chats.messages30 ?? chats.messages),
  };

  // ── Prayers ──
  const prayerWindow = prayerApi?.counts?.[days] || prayerApi?.counts?.[String(days)] || {};
  const prayerRowsInPeriod = prayerReqs.filter(p => {
    const d = p.createdAt || p.CreatedAt;
    return !d || new Date(d) >= new Date(safeDate(days));
  });
  const hasResponseData = prayerReqs.some(p => Array.isArray(p.responses ?? p.Responses));
  const hasPrayerResponse = (p) => {
    const responses = p.responses ?? p.Responses;
    if (Array.isArray(responses)) return responses.length > 0;
    return num(p.responseCount ?? p.ResponseCount ?? p.responsesCount ?? p.ResponsesCount) > 0;
  };
  const totalPrayer  = prayerReqs.length || num(prayerApi?.total ?? prayerWindow?.total ?? reports?.prayers?.total);
  const prayer30     = num(reports?.prayers?.created30d) ||
    num(prayerWindow?.total) ||
    prayerRowsInPeriod.length;
  const pResponded   = hasResponseData
    ? prayerRowsInPeriod.filter(hasPrayerResponse).length
    : (num(prayerWindow?.responded) || prayerReqs.filter(p=>/respond|closed|answer|testif/i.test(String(p.status))).length);
  const prayerReminderTotal = prayerReqs.reduce((s,p)=>s+num(p.reminderCount??p.ReminderCount),0);
  const prayerReminderToday = prayerReqs.reduce((s,p)=>s+num(p.reminderTodayCount??p.ReminderTodayCount),0);
  const pReminderTotal = prayerReminderTotal + taskReminderTotal;
  const pReminderToday = prayerReminderToday + taskReminderToday;
  const ragRed   = prayerReqs.filter(p=>String(p.ragStatus??p.RagStatus).toLowerCase()==="red").length;
  const ragAmber = prayerReqs.filter(p=>String(p.ragStatus??p.RagStatus).toLowerCase()==="amber").length;
  const ragGreen = prayerReqs.filter(p=>{
    const s=String((p.ragStatus??p.RagStatus)||"").toLowerCase(); return s===""||s==="green";
  }).length;
  const ragData  = [
    { name:"Green 🟢", value:ragGreen||Math.max(0,totalPrayer-ragRed-ragAmber) },
    { name:"Amber 🟡", value:ragAmber },
    { name:"Red 🔴",   value:ragRed   },
  ].filter(x=>x.value>0);
  const prayerByCategory = countBy(prayerReqs, p=>p.category||p.Category||p.type||p.Type||"General").slice(0,6);

  // ── Teams ──
  const teamList = teams.map(t=>({
    id:   t.id??t.Id??t.teamId,
    name: t.name??t.Name??t.teamName,
    memberCount: num(t.memberCount??t.MemberCount??t.members?.length),
    taskCount:   liveTasks.filter(x=>x.teamId===t.id||x.TeamId===t.Id).length,
    completed:   liveTasks.filter(x=>(x.teamId===t.id||x.TeamId===t.Id)&&isDone(x)).length,
  })).slice(0,8);

  // ── Finance ── primary: accounting P&L; fallback: raw expenses table
  const expenseRows = arrayFrom(r.expenses?.data);
  const expenseRows30 = expenseRows.filter(e => {
    const d = e.date || e.Date || e.createdAt || e.CreatedAt;
    return !d || new Date(d) >= new Date(safeDate(days));
  });
  const rawExpenseTotal = expenseRows30.reduce((s,e) => s + num(e.amount || e.Amount), 0);
  const expenseByCategory = countBy(expenseRows30, e => e.category || e.Category || "Other").slice(0,8);

  const income  = amtFrom(pnl,"income","Income","totalIncome","TotalIncome");
  // Use accounting P&L expense if available, else sum expense table directly
  const expense = amtFrom(pnl,"expense","Expense","totalExpense","TotalExpense") || rawExpenseTotal;
  const net     = amtFrom(pnl,"net","Net","netSurplus","NetSurplus","netIncome","NetIncome") || (income - expense);
  const accountFor = (balance) => accounts.find(a => String(a.id ?? a.Id) === String(balance.accountId ?? balance.AccountId));
  const balanceType = (balance) => balance.type || balance.Type || accountFor(balance)?.type || accountFor(balance)?.Type;
  const balanceName = (balance) => balance.accountName || balance.AccountName || accountFor(balance)?.name || accountFor(balance)?.Name || "";
  const cashBank= balances
    .filter(b => String(balanceType(b)).toUpperCase() === "ASSET" && /cash|bank/i.test(balanceName(b)))
    .reduce((s,b)=>s+amtFrom(b,"balance","Balance","closingBalance","ClosingBalance","amount","Amount"),0)
    || amtFrom(balanceSheet,"cashAndBank","cash","bank","totalCash");
  // Per-category expense breakdown for display
  const incomeAccounts  = arrayFrom(pnl.incomeAccounts  || pnl.IncomeAccounts);
  const pnlExpenseAccounts = arrayFrom(pnl.expenseAccounts || pnl.ExpenseAccounts);
  const balanceExpenseAccounts = balances
    .filter(b => String(balanceType(b)).toUpperCase() === "EXPENSE" && amtFrom(b,"balance","Balance") > 0)
    .map(b => ({ accountName: balanceName(b) || "Other", amount: amtFrom(b,"balance","Balance") }))
    .sort((a,b)=>b.amount-a.amount)
    .slice(0,6);
  const expenseAccounts = pnlExpenseAccounts.length
    ? pnlExpenseAccounts
    : (balanceExpenseAccounts.length ? balanceExpenseAccounts : expenseByCategory.map(e => ({ accountName: e.name, amount: e.value })));

  // ── Ministry ──
  const statusOf = x => x.status||x.Status||x.applicationStatus||"Pending";
  const activeB = baptisms.filter(x=>/pending|progress|active/i.test(statusOf(x))).length;
  const activeM = marriages.filter(x=>/pending|progress|active/i.test(statusOf(x))).length;
  const activeC = counselling.filter(x=>/pending|progress|active|open/i.test(statusOf(x))).length;
  const doneB   = baptisms.filter(x=>/complet|baptis/i.test(statusOf(x))).length;
  const doneM   = marriages.filter(x=>/complet|married/i.test(statusOf(x))).length;
  const doneC   = counselling.filter(x=>/complet|closed/i.test(statusOf(x))).length;
  const pipelines = [
    { name:"Baptism",     total:baptisms.length,    active:activeB,   done:doneB    },
    { name:"Marriage",    total:marriages.length,   active:activeM,   done:doneM    },
    { name:"Counselling", total:counselling.length, active:activeC,   done:doneC    },
    { name:"Prayers",     total:prayer30,           active:Math.max(0,prayer30-pResponded), done:pResponded },
  ];

  // ── Attendance / Timesheets ──
  const presentSet = new Set(attendance.filter(a=>!/absent|miss/i.test(String(a.status||""))).map(a=>a.userId||a.UserId||a.user?.id).filter(Boolean));
  const attendPct  = uStaff ? Math.min(100, (presentSet.size/uStaff)*100) : num(overview?.teams?.productivity?.[0]?.attendanceRate);
  const totalHrs   = timesheets.reduce((s,x)=>s+num(x.hours??x.Hours),0);
  const tsUsers    = new Set(timesheets.map(x=>x.userId??x.UserId).filter(Boolean)).size;
  const avgHrs     = tsUsers ? totalHrs/tsUsers : num(overview?.teams?.productivity?.[0]?.avgHours);

  // ── Health ──
  const failed    = results.filter(x=>!x.ok);
  const available = results.length - failed.length;
  const compRate  = taskTotal ? (completed/taskTotal)*100 : 0;
  const respRate  = prayer30  ? (pResponded/prayer30)*100 : 0;
  const healthScore = Math.round(Math.min(100, Math.max(0,
    30 + (available/results.length)*25 + Math.min(compRate,100)*0.18 + Math.min(respRate,100)*0.12 + (failed.length===0?15:0)
  )));

  // ── Attention cards ──
  const attention = [
    { label:"Open Tasks",          value:openTasks,       tone:openTasks>0?"amber":"emerald",    detail:`${pct(compRate)} completed`,          link:"/home/tasks" },
    { label:"Overdue Tasks",       value:overdue.length,  tone:overdue.length>0?"rose":"emerald",detail:"Need immediate follow-up",             link:"/home/tasks" },
    { label:"Prayer Follow-ups",   value:Math.max(0,prayer30-pResponded), tone:prayer30-pResponded>0?"blue":"emerald", detail:`${pct(respRate)} responded`, link:"/home/prayerrequests" },
    { label:"Reminders Today",     value:pReminderToday,  tone:pReminderToday>0?"amber":"emerald",detail:`${compact(pReminderTotal)} total sent · ${compact(taskReminderTotal)} task`, link:"/home/prayerrequests" },
    { label:"RAG 🔴 Urgent",       value:ragRed,          tone:ragRed>0?"rose":"emerald",         detail:`${ragAmber} amber · ${ragGreen||Math.max(0,totalPrayer-ragRed-ragAmber)} green`, link:"/home/prayerrequests" },
    { label:"Module Warnings",     value:failed.length,   tone:failed.length?"rose":"emerald",    detail:"Unavailable data feeds",              link:null },
  ];

  // ── Operations ──
  const operations = [
    { name:"Total Members",  value:uTotal,          detail:`${uNew} new · ${compact(uAdmins)} admin`, icon:Users,         link:"/home/users" },
    { name:"Active Chats",   value:chatStats.total, detail:`${compact(chatStats.messages)} messages`,  icon:MessageSquare, link:"/home/chat" },
    { name:"Teams",          value:teams.length,    detail:`${teamList.reduce((s,t)=>s+t.memberCount,0)} total member slots`, icon:Layers, link:"/home/teams" },
    { name:"Attendance",     value:pct(attendPct),  detail:`${presentSet.size || compact(attendance.length)} recorded`,      icon:CalendarCheck, link:"/home/attendance" },
    { name:"Content",        value:sermons.length,  detail:`${countBy(sermons,x=>x.type||x.resourceType||"Sermon").length} categories`, icon:BookOpen, link:"/home/sermons" },
    { name:"Payroll Runs",   value:payroll.length,  detail:"Recent salary runs",                       icon:IndianRupee,   link:"/home/payroll" },
  ];

  const moduleHealth = results.map(x=>({
    name:  x.key.charAt(0).toUpperCase()+x.key.slice(1),
    ok:    x.ok,
    detail:x.ok ? "Live" : (x.error||"Error"),
  }));

  const rawSnap = reports?.snapshotAt || overview?.snapshotAt;
  const snapshotAt = rawSnap ? new Date(rawSnap).toLocaleString() : "Live";
  const chatSafety = r.chatSafety?.data || {};
  const chatAlerts = arrayFrom(r.chatAlerts?.data);

  return {
    healthScore, snapshotAt, available, failed, moduleHealth,
    // users
    uTotal, uMembers, uAdmins, uStaff, uVolunteers, uNew, roleTotal, roleMismatch,
    usersByRole, recentJoiners,
    // tasks
    taskTotal, openTasks, completed, overdueList, upcoming,
    taskByStatus, taskByPriority,
    compRate, overdueCnt: overdue.length,
    // chats
    chatStats,
    // prayers
    prayer30, pResponded, pReminderTotal, pReminderToday,
    ragRed, ragAmber, ragGreen, ragData, prayerByCategory, totalPrayer, respRate,
    // teams
    teamList,
    // finance
    income, expense, net, cashBank, incomeAccounts, expenseAccounts, rawExpenseTotal,
    // ministry
    pipelines,
    // operations
    attendPct, avgHrs, totalHrs, operations, attention,
    // content
    contentMix: countBy(sermons, x=>x.type||x.resourceType||"Sermon"),
    dailyRoutines: r.dailyRoutines?.data || {},
    dailyRoutinesFeed: r.dailyRoutines || { ok:false },
    chatSafety,
    chatAlerts,
  };
}

/* ═══════════════════ PAGE ═══════════════════ */
export default function AdminDashboard({ tenantId = "", tenantName = "", title = "Admin Dashboard" }) {
  const [user]    = useState(getCurrentUser);
  const roles     = useMemo(()=>normalizeRoles(user),[user]);
  const canAccess = Boolean(user&&(roles.some(r=>["admin","staff"].includes(r))||hasDashPage(user)));
  const navigate  = useNavigate();

  const [rawResults, setRawResults] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error,   setError]         = useState("");
  const [dateRange, setDateRange]   = useState(30);
  const [countdown, setCountdown]   = useState(AUTO_REFRESH);
  const timerRef = useRef(null);

  const db = useMemo(()=>buildDashboard(rawResults,dateRange),[rawResults,dateRange]);
  const tenantHeaders = useMemo(() => {
    const id = String(tenantId || "").trim();
    return id ? { "X-Tenant-Id": id } : null;
  }, [tenantId]);
  const scopedOptions = useCallback((options = {}) => ({
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(tenantHeaders || {}),
    },
  }), [tenantHeaders]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const today = safeDate(0), from = safeDate(dateRange);
    const month = monthIsoRange();
    try {
      setRawResults(await Promise.all([
        safeGet("overview",      "/analytics/overview",          scopedOptions()),
        safeGet("reports",       "/analytics/reports",           scopedOptions()),
        safeGet("prayers",       "/analytics/prayers",           scopedOptions({ params:{ windows:"7,15,30,60,90" } })),
        safeGet("users",         "/users",                       scopedOptions({ params:{ page:1,limit:500 } })),
        safeGet("roles",         "/roles",                       scopedOptions()),
        safeGet("chats",         "/chats",                       scopedOptions()),
        safeGet("tasks",         "/tasks",                       scopedOptions({ params:{ limit:500 } })),
        safeGet("teams",         "/teams",                       scopedOptions()),
        safeGet("attendance",    "/attendance",                  scopedOptions({ params:{ from, to:today } })),
        safeGet("timesheets",    "/timesheets",                  scopedOptions({ params:{ from, to:today } })),
        safeGet("costPnl",       "/accounting/pnl",              scopedOptions({ params:{ fromDate:month.from, toDate:month.to } })),
        safeGet("pnl",           "/accounting/pnl",              scopedOptions({ params:{ fromDate:from, toDate:today } })),
        safeGet("accounts",      "/accounting/accounts",         scopedOptions()),
        safeGet("balances",      "/accounting/balances",         scopedOptions()),
        safeGet("balanceSheet",  "/accounting/balance-sheet",    scopedOptions({ params:{ toDate:today } })),
        safeGet("sermons",       "/sermons",                     scopedOptions()),
        safeGet("baptisms",      "/baptisms",                    scopedOptions()),
        safeGet("marriage",      "/marriage/admin/applications", scopedOptions()),
        safeGet("counselling",   "/counselling/admin/sessions",  scopedOptions()),
        safeGet("payrollRuns",   "/payroll/runs",                scopedOptions()),
        safeGet("prayerRequests","/prayerrequests",              scopedOptions({ params:{ includeResponses:true,limit:500 } })),
        safeGet("expenses",      "/expenses",                    scopedOptions()),
        safeGet("dailyRoutines", "/admin/daily-routines",        scopedOptions({ params:{ date:today } })),
        safeGet("chatSafety",    "/admin/chat-safety/summary",   scopedOptions()),
        safeGet("chatAlerts",    "/admin/chat-safety/alerts",    scopedOptions({ params:{ limit:8 } })),
      ]));
      setCountdown(AUTO_REFRESH);
    } catch(e) { setError(e?.message||"Unable to load analytics."); }
    finally    { setLoading(false); }
  },[dateRange, scopedOptions]);

  useEffect(()=>{ if(canAccess) load(); },[canAccess,load]);

  useEffect(()=>{
    if(!canAccess) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(()=>{
      setCountdown(p=>{ if(p<=1){load();return AUTO_REFRESH;} return p-1; });
    },1000);
    return ()=>clearInterval(timerRef.current);
  },[canAccess,load]);

  async function blockUser(uid,reason){ if(!uid||!confirm("Block this user?"))return; try{ await api.post(`/admin/daily-routines/users/${uid}/block`,{reason}, scopedOptions()); load(); }catch(e){setError(e.message);} }
  async function unblockUser(uid)    { if(!uid||!confirm("Unblock?"))return;           try{ await api.post(`/admin/daily-routines/users/${uid}/unblock`, {}, scopedOptions());        load(); }catch(e){setError(e.message);} }
  async function scanChatSafety()     { try{ setLoading(true); await api.post("/admin/chat-safety/scan-now", {}, scopedOptions()); await load(); }catch(e){setError(e.message);} finally{setLoading(false);} }
  async function resolveChatAlert(id) { if(!id)return; try{ await api.post(`/admin/chat-safety/alerts/${id}/resolve`, {}, scopedOptions()); load(); }catch(e){setError(e.message);} }
  async function blockChatSafetyUser(userId, reason) {
    if(!userId || !confirm("Block this user from logging in?")) return;
    try{ await api.post(`/admin/chat-safety/users/${userId}/block`, { reason }, scopedOptions()); load(); }catch(e){setError(e.message);}
  }
  async function unblockChatSafetyUser(userId) {
    if(!userId || !confirm("Unblock this user and allow login again?")) return;
    try{ await api.post(`/admin/chat-safety/users/${userId}/unblock`, {}, scopedOptions()); load(); }catch(e){setError(e.message);}
  }

  if(!canAccess) return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white border rounded-2xl p-10 text-center shadow-sm max-w-sm w-full">
        <ShieldCheck className="w-12 h-12 mx-auto text-slate-300 mb-4"/>
        <h1 className="font-bold text-slate-900">Access Denied</h1>
        <p className="text-sm text-slate-500 mt-1">Admin and Staff roles only.</p>
      </div>
    </main>
  );

  const mins = Math.floor(countdown/60), secs = String(countdown%60).padStart(2,"0");

  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">

      {/* ═════ STICKY HEADER ═════ */}
      <header className="mahima-standard-page-header sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm" data-mahima-explicit-header="true">
        <div className="px-5 lg:px-8 py-3 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow">
              <Sparkles className="w-4 h-4 text-white"/>
            </div>
            <div>
              <h1 className="mahima-standard-page-title text-base font-extrabold tracking-tight" data-mahima-explicit-title="true">{title}</h1>
              <p className="mahima-standard-page-subtitle text-[11px] text-slate-400">
                {tenantName ? `${tenantName} · ` : ""}Snapshot: {db.snapshotAt}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabGroup options={DATE_RANGES.map(d=>d.label)} active={DATE_RANGES.find(d=>d.v===dateRange)?.label}
              onSelect={l=>setDateRange(DATE_RANGES.find(d=>d.label===l).v)}/>
            <Btn icon={Download} label="Export" onClick={()=>window.print()} />
            <Btn icon={RefreshCw} label={loading?"Loading…":`Refresh · ${mins}:${secs}`}
              onClick={load} disabled={loading} spin={loading} primary />
          </div>
        </div>
      </header>

      <div className="px-5 lg:px-8 py-5 space-y-5">
        {error && <ErrorBanner message={error}/>}

        {/* ═════ QUICK ACTIONS ═════ */}
        <QuickActions navigate={navigate}/>

        {/* ═════ ROW 1: HERO + 5 KPIs ═════ */}
        <div className="grid gap-4 2xl:grid-cols-[1fr_2.2fr]">
          <HeroCard db={db} loading={loading}/>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            <KpiCard title="Total Members"    value={compact(db.uTotal)}         sub={`${compact(db.uNew||0)} new this period`}  tone="blue"    link="/home/users"          navigate={navigate} loading={loading}/>
            <KpiCard title="Task Completion"  value={pct(db.compRate)}            sub={`${db.openTasks} open · ${db.overdueCnt} overdue`} tone="emerald" link="/home/tasks" navigate={navigate} loading={loading}/>
            <KpiCard title="Prayer Response"  value={pct(db.respRate)}            sub={`${compact(db.prayer30)} requests · ${compact(db.pReminderTotal)} reminders`} tone="violet" link="/home/prayerrequests" navigate={navigate} loading={loading}/>
            <KpiCard title="Chats Active"     value={compact(db.chatStats.total)} sub={`${compact(db.chatStats.messages)} msgs in period`} tone="sky"   link="/home/chat" navigate={navigate} loading={loading}/>
            <KpiCard title="Net Surplus"      value={currency(db.net)}            sub={`${currency(db.cashBank)} cash/bank`}     tone={db.net>=0?"emerald":"rose"} link={null} navigate={navigate} loading={loading}/>
          </div>
        </div>

        {/* ═════ ROW 2: ATTENTION STRIP ═════ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {db.attention.map(a=><AttentionCard key={a.label} item={a} navigate={navigate}/>)}
        </div>

        {/* ═════ ROW 3: CHURCH COMMUNITY + PRAYER ANALYTICS + FINANCE ═════ */}
        <div className="grid gap-5 xl:grid-cols-3">
          <Panel title="Church Community" icon={Users}>
            <ChurchCommunity db={db}/>
          </Panel>
          <Panel title="Prayer Analytics" icon={HeartHandshake}>
            <PrayerAnalytics db={db}/>
          </Panel>
          <Panel title="Financial Pulse" icon={IndianRupee}>
            <FinancePanel income={db.income} expense={db.expense} net={db.net} cashBank={db.cashBank}
            incomeAccounts={db.incomeAccounts} expenseAccounts={db.expenseAccounts}/>
          </Panel>
        </div>

        <ChatSafetyPanel
          summary={db.chatSafety}
          alerts={db.chatAlerts}
          loading={loading}
          onScan={scanChatSafety}
          onResolve={resolveChatAlert}
          onBlockUser={blockChatSafetyUser}
          onUnblockUser={unblockChatSafetyUser}
          navigate={navigate}
        />

        {/* ═════ ROW 4: TASK STATUS + PRIORITY + UPCOMING THIS WEEK ═════ */}
        <div className="grid gap-5 xl:grid-cols-3">
          <Panel title="Tasks by Status" icon={Target}>
            <DonutChart data={db.taskByStatus} colors={[PALETTE.blue,PALETTE.emerald,PALETTE.rose,PALETTE.amber]}/>
          </Panel>
          <Panel title="Priority Load" icon={AlertTriangle}>
            <HBarChart data={db.taskByPriority} colorMap={{ Critical:PALETTE.rose, Urgent:PALETTE.orange, High:PALETTE.amber, Normal:PALETTE.blue, Low:PALETTE.slate }}/>
          </Panel>
          <Panel title="Upcoming This Week" icon={CalendarDays} badgeCount={db.upcoming.length} badgeTone="blue">
            <UpcomingList tasks={db.upcoming} navigate={navigate}/>
          </Panel>
        </div>

        {/* ═════ ROW 5: OVERDUE + TEAM PERFORMANCE ═════ */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Overdue Tasks" icon={AlertTriangle} badgeCount={db.overdueCnt} badgeTone="rose">
            <OverdueList tasks={db.overdueList} navigate={navigate}/>
          </Panel>
          <Panel title="Team Performance" icon={Layers}>
            <TeamPerformance teams={db.teamList} navigate={navigate}/>
          </Panel>
        </div>

        {/* ═════ DAILY ROUTINES ═════ */}
        <DailyRoutinesPanel data={db.dailyRoutines} feed={db.dailyRoutinesFeed} onBlock={blockUser} onUnblock={unblockUser}/>

        {/* ═════ ROW 6: MINISTRY PIPELINE + OPERATIONS ═════ */}
        <div className="grid gap-5 xl:grid-cols-[1fr_2fr]">
          <Panel title="Ministry Pipeline" icon={HeartHandshake}>
            <MinistryPipeline data={db.pipelines}/>
          </Panel>
          <Panel title="Operations Snapshot" icon={Activity}>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {db.operations.map(op=><OperationCard key={op.name} item={op} navigate={navigate}/>)}
            </div>
          </Panel>
        </div>

        {/* ═════ ROW 7: RECENT JOINERS + CONTENT + COMMS ═════ */}
        <div className="grid gap-5 xl:grid-cols-3">
          <Panel title="Recent Joiners" icon={Users}>
            <RecentJoiners joiners={db.recentJoiners} navigate={navigate}/>
          </Panel>
          <Panel title="Care & Content" icon={BookOpen}>
            <DonutChart data={db.contentMix.slice(0,6)} colors={PIE_COLORS} height={200}/>
          </Panel>
          <Panel title="Jai Masih Comms" icon={MessageSquare}>
            <CommsPanel db={db} navigate={navigate}/>
          </Panel>
        </div>

        {/* ═════ ROW 8: DATA FEED HEALTH ═════ */}
        <Panel title="Data Feed Health" icon={ShieldCheck}>
          <div className="flex items-center gap-4 mb-4">
            <FeedBadge label="Live"  count={db.available}                    color="emerald"/>
            <FeedBadge label="Error" count={db.failed.length}                color="rose"/>
            <FeedBadge label="Total" count={db.moduleHealth.length}          color="slate"/>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
            {db.moduleHealth.map(f=>(
              <div key={f.name} className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${f.ok?"border-emerald-100 bg-emerald-50/60":"border-rose-100 bg-rose-50/60"}`}>
                <span className={`mt-1 shrink-0 w-2 h-2 rounded-full ${f.ok?"bg-emerald-500":"bg-rose-500"}`}/>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800 capitalize">{f.name}</div>
                  <div className={`text-[11px] truncate ${f.ok?"text-emerald-700":"text-rose-600"}`}>{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}

/* ═══════════════════ HERO CARD ═══════════════════ */
function HeroCard({ db, loading }) {
  const score = db.healthScore;
  const R = 44, circ = 2*Math.PI*R;
  const dash = circ*(1-score/100);
  const color = score>=75?"#10b981":score>=50?"#f59e0b":"#e11d48";
  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-700 via-teal-700 to-slate-900 text-white p-5 shadow-md flex flex-col justify-between min-h-[190px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-emerald-200 font-bold">Operational Health</p>
          <p className="text-sm text-emerald-100 mt-1">{db.available}/{db.moduleHealth.length} data feeds live</p>
        </div>
        <svg width="108" height="108" viewBox="0 0 108 108" className="shrink-0">
          <circle cx="54" cy="54" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="11"/>
          <circle cx="54" cy="54" r={R} fill="none" stroke={color} strokeWidth="11"
            strokeDasharray={circ} strokeDashoffset={loading?circ:dash}
            strokeLinecap="round" transform="rotate(-90 54 54)"
            style={{transition:"stroke-dashoffset 1s ease"}}/>
          <text x="54" y="59" textAnchor="middle" fontSize="22" fontWeight="800" fill="white">{score}</text>
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-1">
        <HeroMini label="Avg Hrs"    value={compact(db.avgHrs)}  />
        <HeroMini label="Attendance" value={pct(db.attendPct)}   />
        <HeroMini label="Sermons"    value={compact(db.contentMix.reduce((s,x)=>s+x.value,0))} />
      </div>
    </div>
  );
}
function HeroMini({ label, value }) {
  return (
    <div className="rounded-xl bg-white/10 border border-white/15 px-2 py-2 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] text-emerald-100 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

/* ═══════════════════ KPI CARD ═══════════════════ */
const TONE_MAP = {
  blue:    "bg-blue-50   border-blue-100   text-blue-700",
  emerald: "bg-emerald-50 border-emerald-100 text-emerald-700",
  violet:  "bg-violet-50 border-violet-100 text-violet-700",
  rose:    "bg-rose-50   border-rose-100   text-rose-700",
  amber:   "bg-amber-50  border-amber-100  text-amber-700",
  sky:     "bg-sky-50    border-sky-100    text-sky-700",
  slate:   "bg-slate-50  border-slate-200  text-slate-700",
};
function KpiCard({ title, value, sub, tone="blue", link, navigate, loading }) {
  return (
    <div onClick={()=>link&&navigate(link)}
      className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm ${link?"cursor-pointer hover:shadow-md transition-shadow":""}`}>
      <div className={`inline-flex w-8 h-8 rounded-xl border items-center justify-center ${TONE_MAP[tone]||TONE_MAP.blue}`}>
        <span className="text-xs font-black">#</span>
      </div>
      {loading
        ? <div className="mt-3 h-8 w-20 bg-slate-100 rounded-lg animate-pulse"/>
        : <div className="mt-3 text-2xl font-black tracking-tight truncate">{value}</div>}
      <div className="text-xs font-bold text-slate-800 mt-0.5">{title}</div>
      <div className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-snug">{sub}</div>
      {link&&<div className="mt-2 flex items-center gap-1 text-[11px] text-blue-600 font-semibold"><ExternalLink className="w-2.5 h-2.5"/>View</div>}
    </div>
  );
}

/* ═══════════════════ ATTENTION CARDS ═══════════════════ */
const ATN_TONE = {
  amber:   "border-amber-200   bg-amber-50   text-amber-800",
  rose:    "border-rose-200    bg-rose-50    text-rose-800",
  blue:    "border-blue-200    bg-blue-50    text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
function AttentionCard({ item, navigate }) {
  return (
    <div onClick={()=>item.link&&navigate(item.link)}
      className={`min-w-0 rounded-2xl border p-3.5 ${ATN_TONE[item.tone]||ATN_TONE.emerald} ${item.link?"cursor-pointer hover:opacity-90 transition":""}`}>
      <div className="text-2xl font-black">{compact(item.value)}</div>
      <div className="text-xs font-bold leading-snug mt-0.5">{item.label}</div>
      <div className="text-[11px] mt-1 leading-snug opacity-70 line-clamp-2">{item.detail}</div>
    </div>
  );
}

/* ═══════════════════ QUICK ACTIONS ═══════════════════ */
const QA = [
  { label:"Add Member",  icon:Plus,          link:"/home/users" },
  { label:"New Task",    icon:Plus,          link:"/home/tasks" },
  { label:"Prayers",     icon:HeartHandshake,link:"/home/prayerrequests" },
  { label:"Chat",        icon:MessageSquare, link:"/home/chat" },
  { label:"Teams",       icon:Layers,        link:"/home/teams" },
  { label:"Reports",     icon:Activity,      link:"/home/reports" },
  { label:"Sermons",     icon:BookOpen,      link:"/home/sermons" },
  { label:"Attendance",  icon:CalendarCheck, link:"/home/attendance" },
];
function QuickActions({ navigate }) {
  return (
    <div className="flex flex-wrap gap-2">
      {QA.map(q=>{
        const Icon=q.icon;
        return (
          <button key={q.label} onClick={()=>navigate(q.link)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:shadow-md transition-all">
            <Icon className="w-3 h-3 text-slate-400"/>{q.label}
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════ PANEL WRAPPER ═══════════════════ */
function Panel({ title, icon:Icon, children, className="", badgeCount, badgeTone }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5"/>
          </span>
          <h2 className="font-bold text-slate-900 text-sm tracking-tight">{title}</h2>
        </div>
        {badgeCount!==undefined&&(
          <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${badgeTone==="rose"?"bg-rose-100 text-rose-700":badgeTone==="blue"?"bg-blue-100 text-blue-700":"bg-slate-100 text-slate-600"}`}>
            {badgeCount}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/* ═══════════════════ CHURCH COMMUNITY ═══════════════════ */
function ChurchCommunity({ db }) {
  const roles = arrayFrom(db.usersByRole);
  const max = Math.max(...roles.map(r=>num(r.value)),1);
  const assignedTotal = db.roleTotal || roles.reduce((sum,row)=>sum+num(row.value),0);
  const mismatch = num(db.roleMismatch);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {[["Total",db.uTotal,"slate"],["Role mapped",assignedTotal,"emerald"],["Members",db.uMembers,"blue"],["Admin",db.uAdmins,"violet"]].map(([l,v,t])=>(
          <div key={l} className={`rounded-xl p-2.5 text-center border ${TONE_MAP[t]||TONE_MAP.slate}`}>
            <div className="text-xl font-black">{compact(v)}</div>
            <div className="text-[11px] font-semibold mt-0.5">{l}</div>
          </div>
        ))}
      </div>
      <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${mismatch===0 ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
        Roles add up to {compact(assignedTotal)} of {compact(db.uTotal)}
        {mismatch !== 0 ? ` (${mismatch > 0 ? "+" : ""}${compact(mismatch)} difference)` : ""}
      </div>
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Role Breakdown</h3>
      {roles.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {roles.map((role,i)=>{
            const value = num(role.value);
            return (
              <div key={`${role.name}-${i}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-slate-800 truncate" title={role.name}>{role.name}</span>
                  <span className="text-xs font-black text-slate-900 shrink-0">{compact(value)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-white overflow-hidden border border-slate-100">
                    <div className="h-full rounded-full transition-all" style={{ width:`${Math.max(4,(value/max)*100)}%`, backgroundColor:PIE_COLORS[i%PIE_COLORS.length] }}/>
                  </div>
                  <span className="w-10 text-right text-[10px] font-bold text-slate-500">{pct(value, db.uTotal)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState text="No role data available."/>
      )}
    </div>
  );
}

/* ═══════════════════ PRAYER ANALYTICS ═══════════════════ */
function PrayerAnalytics({ db }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[["Total",db.totalPrayer,"blue"],["Responded",db.pResponded,"emerald"],["Pending",Math.max(0,db.prayer30-db.pResponded),"amber"]].map(([l,v,t])=>(
          <div key={l} className={`rounded-xl p-2.5 text-center border ${TONE_MAP[t]||TONE_MAP.blue}`}>
            <div className="text-xl font-black">{compact(v)}</div>
            <div className="text-[11px] font-semibold mt-0.5">{l}</div>
          </div>
        ))}
      </div>
      {db.ragData.length>0?(
        <>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">RAG Status</h3>
          <DonutChart data={db.ragData} colors={[PALETTE.emerald,PALETTE.amber,PALETTE.rose]} height={160}/>
        </>
      ):<EmptyState text="No RAG status assigned yet."/>}
      {db.prayerByCategory.length>0&&(
        <>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-2">By Category</h3>
          <div className="space-y-1.5">
            {db.prayerByCategory.map(c=>(
              <div key={c.name} className="flex items-center gap-2">
                <span className="text-[11px] text-slate-600 w-24 truncate">{c.name}</span>
                <div className="flex-1 rounded-full bg-slate-100 h-2 overflow-hidden">
                  <div className="h-2 rounded-full bg-violet-500 transition-all" style={{width:`${Math.min(100,(c.value/Math.max(db.totalPrayer,1))*100)}%`}}/>
                </div>
                <span className="text-[11px] font-bold text-slate-700 w-5 text-right">{c.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════ FINANCE PANEL ═══════════════════ */
function FinancePanel({ income, expense, net, cashBank, incomeAccounts = [], expenseAccounts = [] }) {
  const hasData = Math.abs(income)+Math.abs(expense)+Math.abs(net)+Math.abs(cashBank) > 0;
  const topExpenses = expenseAccounts.slice(0,6);
  const topIncome   = incomeAccounts.slice(0,5);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {[["Income",income,"emerald"],["Expense",expense,"rose"],["Net",net,net>=0?"emerald":"rose"],["Cash/Bank",cashBank,"blue"]].map(([l,v,t])=>(
          <div key={l} className={`rounded-xl border p-2.5 text-center ${TONE_MAP[t]||TONE_MAP.blue}`}>
            <div className="text-sm font-black">{currency(v)}</div>
            <div className="text-[11px] font-semibold mt-0.5">{l}</div>
          </div>
        ))}
      </div>
      {hasData ? (
        <>
          <div className="h-40">
            <ResponsiveContainer>
              <BarChart data={[{name:"Income",v:income},{name:"Expense",v:expense},{name:"Net",v:net}]} margin={{left:-16,right:4,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                <XAxis dataKey="name" tick={{fontSize:11}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>compact(v)}/>
                <Tooltip formatter={v=>currency(v)} contentStyle={{fontSize:12,borderRadius:10}}/>
                <Bar dataKey="v" name="Amount" radius={[8,8,0,0]}>
                  {[income,expense,net].map((v,i)=>(
                    <Cell key={i} fill={i===0?PALETTE.emerald:i===1?PALETTE.rose:(v>=0?PALETTE.teal:PALETTE.orange)}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {topExpenses.length > 0 && (
            <>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Expense Breakdown (Cost Module)</p>
              <div className="space-y-1.5">
                {topExpenses.map((e,i) => {
                  const name = e.accountName || e.name || e.category || e.Category || "Other";
                  const amt  = num(e.amount || e.Amount || e.value);
                  const pct  = expense > 0 ? Math.min(100, (amt/expense)*100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-600 w-28 truncate" title={name}>{name}</span>
                      <div className="flex-1 rounded-full bg-rose-50 h-2 overflow-hidden">
                        <div className="h-2 rounded-full bg-rose-400 transition-all" style={{width:`${pct}%`}}/>
                      </div>
                      <span className="text-[11px] font-bold text-slate-700 w-16 text-right">{currency(amt)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {topIncome.length > 0 && (
            <>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Income Sources</p>
              <div className="space-y-1.5">
                {topIncome.map((e,i) => {
                  const name = e.accountName || e.name || "Other";
                  const amt  = num(e.amount || e.Amount || e.value);
                  const pct  = income > 0 ? Math.min(100, (amt/income)*100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-600 w-28 truncate" title={name}>{name}</span>
                      <div className="flex-1 rounded-full bg-emerald-50 h-2 overflow-hidden">
                        <div className="h-2 rounded-full bg-emerald-400 transition-all" style={{width:`${pct}%`}}/>
                      </div>
                      <span className="text-[11px] font-bold text-slate-700 w-16 text-right">{currency(amt)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : <EmptyState text="No financial data yet. Add expenses in the Cost module or record journal entries in Accounting."/>}
    </div>
  );
}

/* ═══════════════════ UPCOMING LIST ═══════════════════ */
function UpcomingList({ tasks, navigate }) {
  if(!tasks?.length) return <EmptyState text="No tasks due in the next 7 days. 🎉"/>;
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {tasks.map((t,i)=>(
        <div key={t.id||i} onClick={()=>navigate("/home/tasks")}
          className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 cursor-pointer hover:bg-blue-50 hover:border-blue-100 transition group">
          <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black ${t.daysLeft===0?"bg-rose-100 text-rose-700":t.daysLeft<=2?"bg-amber-100 text-amber-700":"bg-blue-100 text-blue-700"}`}>
            {t.daysLeft}d
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-800 truncate group-hover:text-blue-700">{t.title}</div>
            <div className="text-[11px] text-slate-500">{new Date(t.due).toLocaleDateString("en-IN")}</div>
          </div>
          <PriorityBadge p={t.priority}/>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ OVERDUE LIST ═══════════════════ */
function OverdueList({ tasks, navigate }) {
  if(!tasks?.length) return <EmptyState text="No overdue tasks. Excellent! 🎉"/>;
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {tasks.map((t,i)=>(
        <div key={t.id||i} onClick={()=>navigate("/home/tasks")}
          className="flex items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2.5 cursor-pointer hover:bg-rose-50 transition group">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-xs font-black">
            -{t.daysAgo}d
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-800 truncate">{t.title}</div>
            <div className="text-[11px] text-rose-600">{new Date(t.due).toLocaleDateString("en-IN")}</div>
          </div>
          <PriorityBadge p={t.priority}/>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ TEAM PERFORMANCE ═══════════════════ */
function TeamPerformance({ teams, navigate }) {
  if(!teams?.length) return <EmptyState text="No teams found. Create a team to see stats here."/>;
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {teams.map(t=>{
        const rate = t.taskCount ? Math.round((t.completed/t.taskCount)*100) : null;
        return (
          <div key={t.id} onClick={()=>navigate("/home/teams")}
            className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 cursor-pointer hover:bg-slate-100 transition">
            <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center shrink-0">
              {(t.name||"T")[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-800 truncate">{t.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 rounded-full bg-slate-200 h-1.5 overflow-hidden">
                  {rate!==null&&<div className="h-1.5 rounded-full bg-emerald-500" style={{width:`${rate}%`}}/>}
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">
                  {rate!==null?`${rate}% done`:"-"}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-slate-700">{t.memberCount||"—"}</div>
              <div className="text-[10px] text-slate-400">members</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════ MINISTRY PIPELINE ═══════════════════ */
function MinistryPipeline({ data }) {
  const hasData = data.some(x=>x.total>0);
  if(!hasData) return <EmptyState text="No ministry pipeline records yet."/>;
  return (
    <div className="space-y-3">
      {data.map(p=>(
        <div key={p.name}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-700">{p.name}</span>
            <span className="text-xs text-slate-500">{p.active} active / {p.total} total</span>
          </div>
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-slate-100">
            {p.done>0&&<div className="bg-emerald-500 transition-all" style={{width:`${(p.done/Math.max(p.total,1))*100}%`}}/>}
            {p.active>0&&<div className="bg-amber-400 transition-all"  style={{width:`${(p.active/Math.max(p.total,1))*100}%`}}/>}
          </div>
          <div className="flex gap-3 mt-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block"/>Completed: {p.done}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block"/>Active: {p.active}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ OPERATION CARD ═══════════════════ */
function OperationCard({ item, navigate }) {
  const Icon=item.icon;
  return (
    <div onClick={()=>item.link&&navigate(item.link)}
      className={`rounded-xl border border-slate-100 bg-slate-50 p-3 ${item.link?"cursor-pointer hover:bg-slate-100 transition":""}`}>
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 text-slate-400"/>
        <span className="text-xl font-black text-slate-900">{typeof item.value==="number"?compact(item.value):item.value}</span>
      </div>
      <div className="text-xs font-bold text-slate-700">{item.name}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{item.detail}</div>
      {item.link&&<div className="mt-2 flex items-center gap-1 text-[11px] text-blue-600 font-semibold"><ExternalLink className="w-2.5 h-2.5"/>View</div>}
    </div>
  );
}

/* ═══════════════════ RECENT JOINERS ═══════════════════ */
function RecentJoiners({ joiners, navigate }) {
  if(!joiners?.length) return <EmptyState text="No recent joiners found. Ensure users have a createdAt date."/>;
  return (
    <div className="space-y-2">
      {joiners.map((j,i)=>(
        <div key={i} onClick={()=>navigate("/home/users")}
          className="flex items-center gap-2.5 rounded-xl border border-slate-100 px-3 py-2 cursor-pointer hover:bg-slate-50 transition">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xs font-black shrink-0">
            {j.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-800 truncate">{j.name}</div>
            <div className="text-[11px] text-slate-500">{j.role}</div>
          </div>
          {j.joined&&<div className="text-[11px] text-slate-400 shrink-0">{new Date(j.joined).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ COMMS PANEL ═══════════════════ */
function CommsPanel({ db, navigate }) {
  return (
    <div className="space-y-3">
      {[["Total Chats",db.chatStats.total,"blue"],["Group Chats",db.chatStats.groups,"violet"],["Direct Chats",db.chatStats.direct,"sky"],[`Messages (${db.chatStats.messages??"—"})`,db.chatStats.messages,"emerald"]].map(([l,v,t])=>(
        <div key={l} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${TONE_MAP[t]||TONE_MAP.blue}`}>
          <span className="text-xs font-semibold">{l}</span>
          <span className="font-black">{compact(v||0)}</span>
        </div>
      ))}
      <button onClick={()=>navigate("/home/chat")}
        className="w-full mt-2 rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center justify-center gap-1.5 transition">
        <ExternalLink className="w-3 h-3"/>Open Jai Masih
      </button>
    </div>
  );
}

/* ═══════════════════ DAILY ROUTINES ═══════════════════ */
function ChatSafetyPanel({ summary, alerts, loading, onScan, onResolve, onBlockUser, onUnblockUser, navigate }) {
  const rows = arrayFrom(alerts);
  const open = num(summary?.open);
  const special = num(summary?.special);
  const critical = num(summary?.critical);
  const categoryRows = arrayFrom(summary?.byCategory).slice(0, 5);

  return (
    <section className={`rounded-2xl border shadow-sm overflow-hidden ${special || critical ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between px-5 py-4 border-b border-white/70">
        <div className="flex items-center gap-3">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center border ${special || critical ? "bg-rose-100 text-rose-700 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-100"}`}>
            <AlertTriangle className="w-4 h-4"/>
          </span>
          <div>
            <h2 className="font-bold text-slate-950 text-sm">Chat Safety Intelligence</h2>
            <p className="text-xs text-slate-500">AI-assisted moderation, pastoral care, and special user-level alerts</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onScan} disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            Full scan now
          </button>
          <button onClick={()=>navigate("/home/chat")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
            <ExternalLink className="w-3 h-3"/>Open chats
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 px-5 pt-4">
        {[["Open", open, open ? "amber" : "emerald"], ["Special", special, special ? "rose" : "emerald"], ["Critical", critical, critical ? "rose" : "emerald"]].map(([label,value,tone])=>(
          <div key={label} className={`rounded-xl border p-3 text-center ${TONE_MAP[tone] || TONE_MAP.slate}`}>
            <div className="text-2xl font-black">{compact(value)}</div>
            <div className="text-[11px] font-bold mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {categoryRows.length > 0 && (
        <div className="px-5 pt-3 flex flex-wrap gap-2">
          {categoryRows.map(c=>(
            <span key={c.category} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {String(c.category || "risk").replace(/_/g, " ")}: {c.count}
            </span>
          ))}
        </div>
      )}

      <div className="p-5">
        {!rows.length ? (
          <EmptyState text="No unresolved chat safety alerts."/>
        ) : (
          <div className="space-y-2">
            {rows.map(alert=>(
              <div key={alert.id} className={`rounded-xl border bg-white p-3 ${alert.alertLevel === "special_user" ? "border-rose-200" : "border-slate-100"}`}>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${alert.alertLevel === "special_user" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                        {String(alert.alertLevel || "admin").replace(/_/g, " ")}
                      </span>
                      {alert.securityEscalation && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase bg-red-600 text-white">
                          Security flag
                        </span>
                      )}
                      <span className="text-xs font-black text-slate-900">{alert.senderName || "Unknown user"}</span>
                      <span className="text-[11px] text-slate-400">{new Date(alert.createdAtUtc).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-700">{alert.summary}</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {String(alert.category || "risk").replace(/_/g, " ")} - {alert.severity} - {Math.round(num(alert.confidence) * 100)}%
                      {alert.pastorFollowupSent ? " - AI Pastor follow-up sent" : ""}
                    </div>
                    {alert.evidenceSnippet && (
                      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        <span className="font-black text-slate-700">Flagged line: </span>{alert.evidenceSnippet}
                      </div>
                    )}
                    {alert.conversationSnippet && (
                      <div className="mt-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-500 whitespace-pre-wrap max-h-28 overflow-auto">
                        <div className="font-black text-slate-700 mb-1">Conversation snippet</div>
                        {alert.conversationSnippet}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-row md:flex-col gap-2">
                    {(alert.securityEscalation || alert.alertLevel === "special_user") && (
                      alert.isBlocked ? (
                        <button onClick={()=>onUnblockUser?.(alert.senderId)}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                          Unblock user
                        </button>
                      ) : (
                        <button onClick={()=>onBlockUser?.(alert.senderId, `Chat safety ${alert.category || "policy"} alert: ${alert.summary || ""}`)}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100">
                          Block user
                        </button>
                      )
                    )}
                    <button onClick={()=>onResolve(alert.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                      Resolve
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const DR_TABS=["Attendance","Site Usage","Security","Malpractice","Blocked"];
function DailyRoutinesPanel({ data, feed, onBlock, onUnblock }) {
  const [tab,setTab]=useState("Attendance");
  const att     = data?.attendance || {};
  const site    = data?.siteUsage  || {};
  const sec     = data?.security   || {};
  const mal     = data?.malpractice|| {};
  const blocked = arrayFrom(data?.blockedUsers);
  const feedErr = feed?.ok===false?(feed.error||"Daily routines feed unavailable."):"";
  const counts  = { Attendance:att.missing||0, Security:sec.cyberSignals||0, Malpractice:mal.totalFlags||0, Blocked:blocked.length };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
            <CalendarCheck className="w-4 h-4"/>
          </span>
          <div>
            <h2 className="font-bold text-slate-900 text-sm">Automated Daily Routines</h2>
            <p className="text-xs text-slate-400">Attendance · Site · Security · Malpractice · Blocks</p>
          </div>
        </div>
        <span className="text-xs rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-slate-500 font-semibold self-start sm:self-auto">{data?.date||safeDate(0)}</span>
      </div>
      {feedErr&&<div className="mx-5 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{feedErr}</div>}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 px-5 pt-3">
        {[["Present",att.present,"emerald"],["Missing",att.missing||0,att.missing?"rose":"emerald"],["Page Views",site.pageViews,"blue"],["Visitors",site.uniqueVisitors,"violet"],["Cyber",sec.cyberSignals||0,sec.cyberSignals?"rose":"emerald"],["Flags",mal.totalFlags||0,mal.totalFlags?"amber":"emerald"]].map(([l,v,t])=>(
          <div key={l} className={`rounded-xl border p-2.5 text-center ${TONE_MAP[t]||TONE_MAP.slate}`}>
            <div className="text-xl font-black">{compact(v||0)}</div>
            <div className="text-[11px] font-semibold mt-0.5 leading-tight">{l}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 px-5 mt-4 overflow-x-auto border-b border-slate-100">
        {DR_TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px transition ${tab===t?"border-emerald-600 text-emerald-700":"border-transparent text-slate-400 hover:text-slate-700"}`}>
            {t}{counts[t]>0&&<span className={`rounded-full text-[10px] px-1.5 py-0.5 font-black ${t==="Blocked"||t==="Security"||t==="Malpractice"?"bg-rose-100 text-rose-700":"bg-slate-100 text-slate-600"}`}>{counts[t]}</span>}
          </button>
        ))}
      </div>
      <div className="px-5 py-4">
        {tab==="Attendance"&&(
          <div className="grid gap-4 md:grid-cols-2">
            <RoutineList title="Present" rows={arrayFrom(att.presentUsers)} empty="No attendance logged today."
              render={row=><UserRow row={row} onAction={()=>onBlock(row.userId,"blocked from attendance")} actionLabel="Block" actionTone="rose"/>}/>
            <RoutineList title="Missing" rows={arrayFrom(att.missingUsers)} empty="Everyone marked present. 🎉"
              render={row=><UserRow row={row} onAction={()=>onBlock(row.userId,"blocked — absent")} actionLabel="Block" actionTone="rose"/>}/>
          </div>
        )}
        {tab==="Site Usage"&&(
          <div className="grid gap-4 md:grid-cols-2">
            <RoutineList title="Top Pages" rows={arrayFrom(site.topPages)} empty="No page visits yet."
              render={row=><div className="flex justify-between text-xs"><span className="truncate text-slate-700 font-semibold pr-2">{row.path||"Page"}</span><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{row.views||0}</span></div>}/>
            <RoutineList title="Logged In" rows={arrayFrom(site.loggedInToday)} empty="No logins today."
              render={row=><div className="text-xs"><div className="font-semibold text-slate-800 truncate">{row.name||row.username||"User"}</div><div className="text-slate-400">{row.detail||""}</div></div>}/>
          </div>
        )}
        {tab==="Security"&&(
          <RoutineList title="Cyber Signals" rows={arrayFrom(sec.events)} empty={sec.note||"No security signals today. ✅"}
            render={row=>(
              <div className="flex justify-between gap-2 text-xs">
                <div className="min-w-0"><div className="font-semibold text-slate-800 truncate">{row.eventType||"Event"}</div><div className="text-slate-500 truncate">{row.path||row.details||""}</div></div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${row.severity==="high"?"bg-rose-100 text-rose-700":"bg-amber-100 text-amber-700"}`}>{row.severity||"watch"}</span>
              </div>
            )}/>
        )}
        {tab==="Malpractice"&&(
          <div className="grid gap-4 md:grid-cols-2">
            <RoutineList title="Flagged Uploads" rows={arrayFrom(mal.flaggedUploads)} empty="No flagged uploads."
              render={row=><div className="flex justify-between gap-2 text-xs"><div className="min-w-0"><div className="font-semibold text-slate-800 truncate">{row.fileName||"File"}</div><div className="text-slate-500">{row.reason||""}</div></div>{row.userId&&<button onClick={()=>onBlock(row.userId,"upload flag")} className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"><Ban className="w-2.5 h-2.5 inline mr-0.5"/>Block</button>}</div>}/>
            <RoutineList title="High Data Activity" rows={arrayFrom(mal.dataManipulationFlags)} empty="No suspicious data activity."
              render={row=><div className="flex justify-between gap-2 text-xs"><div className="min-w-0"><div className="font-semibold text-slate-800 truncate">{row.userName||"User"}</div><div className="text-slate-500">{row.totalChanges} changes</div></div><div className="flex gap-1.5 shrink-0 items-center"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.severity==="high"?"bg-rose-100 text-rose-700":"bg-amber-100 text-amber-700"}`}>{row.severity}</span>{row.userId&&<button onClick={()=>onBlock(row.userId,"data flag")} className="rounded-lg border border-rose-200 bg-rose-50 px-1.5 py-1 text-rose-700 hover:bg-rose-100"><Ban className="w-2.5 h-2.5"/></button>}</div></div>}/>
          </div>
        )}
        {tab==="Blocked"&&(
          blocked.length===0
            ?<EmptyState text="No users are currently blocked."/>
            :<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {blocked.map(row=>(
                <div key={row.userId||row.username} className="rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5"><Lock className="w-3 h-3 text-rose-500 shrink-0"/><span className="font-semibold text-slate-800 text-sm truncate">{row.name||row.username}</span></div>
                    <div className="text-xs text-rose-600 truncate">{row.reason||"Blocked"}</div>
                  </div>
                  <button onClick={()=>onUnblock(row.userId)} className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 flex items-center gap-1">
                    <UnlockKeyhole className="w-3 h-3"/>Unblock
                  </button>
                </div>
              ))}
            </div>
        )}
      </div>
    </section>
  );
}
function UserRow({ row, onAction, actionLabel, actionTone }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-[10px] font-black flex items-center justify-center shrink-0">
          {(row.name||row.username||"U")[0].toUpperCase()}
        </div>
        <div className="min-w-0"><div className="text-xs font-semibold text-slate-800 truncate">{row.name||row.username||"User"}</div><div className="text-[11px] text-slate-400">{row.role||""}</div></div>
      </div>
      {row.userId&&onAction&&(
        <button onClick={onAction} className={`shrink-0 rounded-lg border text-[11px] font-bold px-2 py-1 flex items-center gap-0.5 ${actionTone==="rose"?"border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100":"border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
          <Ban className="w-2.5 h-2.5"/>{actionLabel}
        </button>
      )}
    </div>
  );
}
function RoutineList({ title, rows, empty, render }) {
  const all=arrayFrom(rows), items=all.slice(0,10);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-bold text-slate-700">{title}</h3>
        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">{all.length}</span>
      </div>
      {items.length
        ?<div className="space-y-1.5">{items.map((row,i)=><div key={row.id||row.userId||i} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">{render(row)}</div>)}{all.length>10&&<div className="text-center text-xs text-slate-400 pt-1">+{all.length-10} more</div>}</div>
        :<div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-xs text-slate-500">{empty}</div>}
    </div>
  );
}

/* ═══════════════════ CHARTS ═══════════════════ */
function DonutChart({ data, colors, height=220 }) {
  if(!data?.length) return <EmptyState text="No data available."/>;
  return (
    <div style={{width:"100%",height}}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="72%" paddingAngle={3}>
            {data.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}
          </Pie>
          <Tooltip contentStyle={{fontSize:12,borderRadius:10,border:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}/>
          <Legend iconSize={10} iconType="circle" wrapperStyle={{fontSize:11}}/>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
function HBarChart({ data, colorMap }) {
  if(!data?.length) return <EmptyState text="No priority data."/>;
  const max = Math.max(...data.map(x=>x.value),1);
  return (
    <div className="space-y-2.5">
      {data.map(d=>(
        <div key={d.name}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-700">{d.name}</span>
            <span className="text-xs font-black text-slate-900">{d.value}</span>
          </div>
          <div className="rounded-full bg-slate-100 h-3 overflow-hidden">
            <div className="h-3 rounded-full transition-all duration-700" style={{width:`${(d.value/max)*100}%`,backgroundColor:colorMap[d.name]||PALETTE.blue}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ TINY COMPONENTS ═══════════════════ */
const PRIORITY_COLORS = { Critical:"bg-rose-100 text-rose-700", Urgent:"bg-orange-100 text-orange-700", High:"bg-amber-100 text-amber-700", Normal:"bg-blue-100 text-blue-700", Low:"bg-slate-100 text-slate-500" };
function PriorityBadge({ p }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${PRIORITY_COLORS[p]||PRIORITY_COLORS.Normal}`}>{p}</span>;
}
function EmptyState({ text }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-5 text-xs text-slate-400 text-center">{text}</div>;
}
function ErrorBanner({ message }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0"/>{message}
    </div>
  );
}
function FeedBadge({ label, count, color }) {
  const cls = { emerald:"bg-emerald-100 text-emerald-700", rose:"bg-rose-100 text-rose-700", slate:"bg-slate-100 text-slate-600" };
  return (
    <div className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${cls[color]}`}>
      <span className={`w-2 h-2 rounded-full ${color==="emerald"?"bg-emerald-500":color==="rose"?"bg-rose-500":"bg-slate-400"}`}/>
      {count} {label}
    </div>
  );
}
function TabGroup({ options, active, onSelect }) {
  return (
    <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
      {options.map(o=>(
        <button key={o} onClick={()=>onSelect(o)}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${active===o?"bg-emerald-600 text-white":"text-slate-500 hover:bg-slate-50"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}
function Btn({ icon:Icon, label, onClick, disabled, spin, primary }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-60 shadow-sm ${
        primary?"bg-emerald-600 text-white hover:bg-emerald-700":"border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}>
      <Icon className={`w-3.5 h-3.5 ${spin?"animate-spin":""}`}/>{label}
    </button>
  );
}
