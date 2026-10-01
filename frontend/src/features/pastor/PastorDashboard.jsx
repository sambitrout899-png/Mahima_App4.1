import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bot, CalendarCheck, CheckCircle2, HeartHandshake, Loader2, Plus, RefreshCw, Sparkles, TrendingUp, Users } from "lucide-react";
import api from "../../api";
import "./PastorDashboard.css";

function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "data", "records", "results", "users", "requests", "sermons"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function count(value) {
  for (const key of ["total", "totalCount", "count", "recordsTotal"]) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number)) return number;
  }
  return rows(value).length;
}

function userName() {
  try {
    const user = JSON.parse(localStorage.getItem("mahima_user") || "null");
    return user?.displayName || user?.fullName || user?.name || user?.username || "Pastor";
  } catch { return "Pastor"; }
}

function isClosed(item) {
  return /closed|answered|complete|resolved/i.test(String(item?.status ?? item?.Status ?? ""));
}

function dateOf(item) {
  return item?.createdAt || item?.CreatedAt || item?.requestDate || item?.RequestDate || item?.date;
}

async function safe(key, request) {
  try { return [key, await request(), null]; }
  catch (error) { return [key, null, error?.message || "Unavailable"]; }
}

export default function PastorDashboard() {
  const navigate = useNavigate();
  const [result, setResult] = useState({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    const from = new Date(today); from.setDate(from.getDate() - 90);
    const output = await Promise.all([
      safe("users", () => api.get("/users", { params: { page: 1, limit: 500 }, notify: false })),
      safe("prayers", () => api.get("/prayerrequests", { params: { includeResponses: true, limit: 500 }, notify: false })),
      safe("attendance", () => api.get("/attendance", { params: { from: from.toISOString(), to: today.toISOString() }, notify: false })),
      safe("sermons", () => api.get("/sermons", { notify: false })),
    ]);
    setResult(Object.fromEntries(output.map(([key, data, error]) => [key, { data, error }])));
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const dashboard = useMemo(() => {
    const members = rows(result.users?.data);
    const prayers = rows(result.prayers?.data);
    const attendance = rows(result.attendance?.data);
    const sermons = rows(result.sermons?.data);
    const openPrayers = prayers.filter((item) => !isClosed(item));
    const urgent = openPrayers.filter((item) => /red|urgent|critical/i.test(String(item?.ragStatus || item?.priority || item?.status || "")));
    const recentPrayers = [...openPrayers].sort((a, b) => new Date(dateOf(b) || 0) - new Date(dateOf(a) || 0)).slice(0, 4);
    const newMembers = members.filter((member) => {
      const created = new Date(member?.createdAt || member?.CreatedAt || member?.joinedAt || 0);
      return Number.isFinite(created.getTime()) && Date.now() - created.getTime() < 30 * 86400000;
    }).length;
    const attended = attendance.reduce((sum, entry) => sum + Number(entry?.presentCount || entry?.PresentCount || entry?.count || 0), 0);
    const growth = Array.from({ length: 7 }, (_, index) => {
      const cutoff = Date.now() - (6 - index) * 30 * 86400000;
      return members.filter((member) => new Date(member?.createdAt || member?.CreatedAt || member?.joinedAt || 0).getTime() <= cutoff).length;
    });
    const maxGrowth = Math.max(...growth, 1);
    return { members: count(result.users?.data), newMembers, openPrayers, urgent, recentPrayers, attended, sermons: sermons.length, growth, maxGrowth };
  }, [result]);

  const firstName = userName().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return <div className="pastor-dashboard">
    <header className="pastor-dashboard__header">
      <div><div className="pastor-dashboard__eyebrow"><Sparkles/> {greeting}, {firstName}</div><h1>Your ministry at a glance.</h1><p>Care priorities, community health and the next faithful actions—all in one place.</p></div>
      <div className="pastor-dashboard__header-actions">
        <button className="pastor-refresh" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""}/> {updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}</button>
        <button className="pastor-primary" onClick={() => navigate("/home/users")}><Plus/> Add member</button>
      </div>
    </header>

    {loading && !updatedAt ? <div className="pastor-dashboard__loading"><Loader2/> Preparing your ministry view…</div> : <>
      <section className="pastor-kpis" aria-label="Ministry summary">
        <Metric icon={Users} label="Members" value={result.users?.error ? "—" : dashboard.members.toLocaleString("en-IN")} detail={result.users?.error ? "Access unavailable" : `+${dashboard.newMembers} in the last 30 days`} tone="indigo" onClick={() => navigate("/home/users")}/>
        <Metric icon={HeartHandshake} label="Prayer requests" value={result.prayers?.error ? "—" : dashboard.openPrayers.length} detail={result.prayers?.error ? "Access unavailable" : `${dashboard.urgent.length} need urgent attention`} tone="rose" onClick={() => navigate("/home/prayerrequests")}/>
        <Metric icon={CalendarCheck} label="Attendance" value={result.attendance?.error ? "—" : dashboard.attended.toLocaleString("en-IN")} detail={result.attendance?.error ? "Access unavailable" : "Recorded in the last 90 days"} tone="emerald" onClick={() => navigate("/home/attendance")}/>
        <Metric icon={CheckCircle2} label="Sermons" value={result.sermons?.error ? "—" : dashboard.sermons} detail={result.sermons?.error ? "Access unavailable" : "Messages in your library"} tone="amber" onClick={() => navigate("/home/sermons")}/>
      </section>

      <section className="pastor-dashboard__main-grid">
        <article className="pastor-card pastor-growth">
          <div className="pastor-card__heading"><div><span>COMMUNITY</span><h2>Community growth</h2></div><TrendingUp/></div>
          {result.users?.error ? <Empty text="Member growth is not available for this role."/> : <><div className="pastor-growth__chart">{dashboard.growth.map((value, index) => <div key={index}><i style={{ height: `${Math.max(12, value / dashboard.maxGrowth * 100)}%` }}/><small>{new Date(Date.now() - (6-index)*30*86400000).toLocaleDateString("en-IN", { month: "short" })}</small></div>)}</div><p>Member records accumulated over the last seven months.</p></>}
        </article>

        <article className="pastor-card pastor-ai">
          <div className="pastor-ai__icon"><Bot/></div><span>JAIMASIH AI</span><h2>Your ministry co-pilot</h2><p>Prepare a message, find Scripture, draft a pastoral response or ask for guidance in Hindi or English.</p><button onClick={() => navigate("/home/pastor")}>Ask JaiMasih AI <ArrowRight/></button>
        </article>

        <article className="pastor-card pastor-care">
          <div className="pastor-card__heading"><div><span>CARE QUEUE</span><h2>Prayer follow-ups</h2></div><button onClick={() => navigate("/home/prayerrequests")}>View all</button></div>
          {result.prayers?.error || dashboard.recentPrayers.length === 0 ? <Empty text={result.prayers?.error ? "Prayer requests are not available for this role." : "No open prayer requests. Your care queue is clear."}/> : <div className="pastor-care__list">{dashboard.recentPrayers.map((request, index) => <button key={request?.id || index} onClick={() => navigate("/home/prayerrequests")}><span className={/red|urgent|critical/i.test(String(request?.ragStatus || request?.priority || "")) ? "urgent" : ""}><HeartHandshake/></span><div><b>{request?.title || request?.subject || request?.category || "Prayer request"}</b><p>{request?.description || request?.request || request?.details || "Follow up with care and prayer."}</p></div><ArrowRight/></button>)}</div>}
        </article>

        <article className="pastor-card pastor-actions"><div className="pastor-card__heading"><div><span>NEXT ACTIONS</span><h2>Lead from here</h2></div></div><div className="pastor-actions__grid"><Quick icon={HeartHandshake} label="Review prayers" onClick={() => navigate("/home/prayerrequests")}/><Quick icon={Users} label="Member directory" onClick={() => navigate("/home/users")}/><Quick icon={CalendarCheck} label="Attendance" onClick={() => navigate("/home/attendance")}/><Quick icon={Bot} label="Ask AI Counsellor" onClick={() => navigate("/home/pastor")}/></div></article>
      </section>
    </>}
  </div>;
}

function Metric({ icon: Icon, label, value, detail, tone, onClick }) { return <button className={`pastor-metric ${tone}`} onClick={onClick}><span><Icon/></span><small>{label}</small><b>{value}</b><em>{detail}</em></button>; }
function Quick({ icon: Icon, label, onClick }) { return <button onClick={onClick}><span><Icon/></span><b>{label}</b><ArrowRight/></button>; }
function Empty({ text }) { return <div className="pastor-empty">{text}</div>; }
