import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, CheckCircle2, Clock3, ExternalLink, Film, Globe2, Loader2, Mail, Megaphone, MessageCircle, MousePointerClick, RefreshCw, Send, ShieldCheck, UserRoundSearch } from "lucide-react";
import * as marketing from "../../api/marketingAutomationApi";

const emptyProspect = { organizationName: "", country: "India", state: "", city: "", website: "", contactName: "", publicEmail: "", publicPhone: "", publicWhatsapp: "", denomination: "", sourceUrl: "", contactBasis: "public-business-contact", consentStatus: "unknown" };
const emptyAudience = { countries: "", state: "", city: "", contactChannel: "", minScore: 0, denomination: "", onlyNeverContacted: false };
const emptyCampaign = { name: "", objective: "", channels: ["email"], audience: emptyAudience, subject: "A one-month Mahima demonstration for {{church}}", body: "<p>Hello {{contact}},</p><p>We would like to invite {{church}} to try Mahima's church-management platform for one month with all features enabled.</p><p><a href=\"{{demoLink}}\">Register your church and start your one-month Mahima demonstration</a></p><p>{{optOut}}</p>", socialBody: "Hello {{contact}}, explore Mahima church management for {{church}}: {{demoLink}}. {{optOut}}", demoVideoUrl: "", language: "English", whatsAppContentSid: "", intervalDays: 30, nextRunAtUtc: "" };
const languages = ["English", "Hindi", "Tamil", "Telugu", "Bengali", "Marathi", "Kannada", "Malayalam", "Punjabi", "Spanish", "Portuguese", "French", "Swahili"];
const audienceToApi = (a) => ({ countries: (a.countries || "").split(",").map(s => s.trim()).filter(Boolean), state: a.state || "", city: a.city || "", contactChannel: a.contactChannel || "", minScore: Number(a.minScore) || 0, denomination: a.denomination || "", onlyNeverContacted: !!a.onlyNeverContacted });
const errorText = (e) => e?.response?.data?.message || e?.response?.data?.detail || e?.message || "The request failed.";
const tone = { approved: "bg-emerald-100 text-emerald-800", active: "bg-emerald-100 text-emerald-800", sent: "bg-blue-100 text-blue-800", pending_approval: "bg-amber-100 text-amber-800", draft: "bg-slate-100 text-slate-700", rejected: "bg-red-100 text-red-800", suppressed: "bg-red-100 text-red-800", demo_active: "bg-violet-100 text-violet-800" };

export default function DigitalMarketingPage() {
  const [tab, setTab] = useState("analytics");
  const [dashboard, setDashboard] = useState({});
  const [data, setData] = useState({ prospects: [], campaigns: [], leads: [], quotes: [] });
  const [prospect, setProspect] = useState(emptyProspect);
  const [campaign, setCampaign] = useState(emptyCampaign);
  const [discovery, setDiscovery] = useState({ regions: "India, Asia, Africa, Europe, North America, South America, Oceania", languages: "English, Hindi", contactFocus: "mobile", maxProspects: 25 });
  const [schedule, setSchedule] = useState({ id: null, name: "Weekly global church discovery", regions: "India, Asia, Africa, Europe, North America, South America, Oceania", languages: "English, Hindi", contactFocus: "mobile", maxProspects: 25, intervalDays: 7, nextRunAtUtc: "" });
  const [dispatchReview, setDispatchReview] = useState(null);
  const [dispatchDecisions, setDispatchDecisions] = useState({});
  const [followUpDates, setFollowUpDates] = useState({});
  const [ai, setAi] = useState({ audience: "Church administrators and ministry leaders", objective: "Invite qualified churches to a one-month full-feature demonstration", countries: "India and global English-speaking regions", language: "English" });
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [prospectsFilter, setProspectsFilter] = useState({ status: "", country: "", state: "", city: "", contactChannel: "" });
  const [prospectsList, setProspectsList] = useState({ items: [], total: 0, page: 1, pageSize: 50 });
  const [commsFilter, setCommsFilter] = useState({ status: "", channel: "" });
  const [commsList, setCommsList] = useState({ items: [], total: 0, page: 1, pageSize: 50 });
  const [phoneCountries, setPhoneCountries] = useState([]);
  const [whatsAppStatus, setWhatsAppStatus] = useState(null);

  async function refresh() {
    setBusy(true); setError("");
    try {
      const whatsAppStatusRequest = typeof marketing.getWhatsAppStatus === "function"
        ? marketing.getWhatsAppStatus().catch(() => null)
        : Promise.resolve(null);
      const [d, w, wa] = await Promise.all([
        marketing.getMarketingDashboard(),
        marketing.getMarketingWorkspace(),
        whatsAppStatusRequest,
      ]);
      setDashboard(d || {});
      setData(w || data);
      setWhatsAppStatus(wa);
    }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function loadProspectsPage(page = 1) {
    setBusy(true);
    try { const r = await marketing.getProspectsPage({ ...prospectsFilter, page, pageSize: prospectsList.pageSize }); setProspectsList(page === 1 ? r : { ...r, items: [...prospectsList.items, ...r.items] }); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function loadCommsPage(page = 1) {
    setBusy(true);
    try { const r = await marketing.getCommunicationsPage({ ...commsFilter, page, pageSize: commsList.pageSize }); setCommsList(page === 1 ? r : { ...r, items: [...commsList.items, ...r.items] }); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    refresh();
    if (typeof marketing.getPhoneCountries !== "function") {
      setError("Country lookup is unavailable in this frontend build. Deploy DigitalMarketingPage.jsx and marketingAutomationApi.js together, rebuild, and reload the page.");
      return;
    }
    let cancelled = false;
    async function loadPhoneCountries() {
      try {
        const countries = await marketing.getPhoneCountries();
        if (!Array.isArray(countries)) throw new Error("Country lookup returned an invalid response.");
        if (!cancelled) setPhoneCountries(countries);
      } catch (e) {
        if (!cancelled) setError(`Country lookup unavailable: ${errorText(e)}`);
      }
    }
    loadPhoneCountries();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (tab === "prospects") loadProspectsPage(1); }, [tab, prospectsFilter]);
  useEffect(() => { if (tab === "communications") loadCommsPage(1); }, [tab, commsFilter]);
  async function act(fn, success) {
    setBusy(true); setError(""); setMessage("");
    try {
      await fn();
      setMessage(success);
      await refresh();
      // Workspace refresh does not include paginated queues. Reload whichever
      // queue is visible so an approved/rejected row updates immediately.
      if (tab === "prospects") await loadProspectsPage(1);
      if (tab === "communications") await loadCommsPage(1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function reviewProspectNow(p, review, success) {
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await marketing.reviewProspect(p.id, review);
      const nextProspect = updated && updated.id
        ? updated
        : {
            ...p,
            status: review.approved ? "approved" : "rejected",
            doNotContact: !!review.doNotContact,
            consentStatus: review.consentStatus ?? p.consentStatus,
          };

      // Reflect the completed review immediately. The queue endpoint is a
      // separate paginated read and can otherwise leave the old row visible
      // until its next successful fetch.
      setProspectsList(current => ({
        ...current,
        items: current.items.map(item => item.id === p.id ? { ...item, ...nextProspect } : item),
      }));
      setMessage(success);

      // Reconcile totals and server-computed fields without delaying the UI.
      await Promise.all([refresh(), loadProspectsPage(1)]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function previewAudienceNow() { setBusy(true); setError(""); try { setAudiencePreview(await marketing.previewAudience(audienceToApi(campaign.audience))); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  function startEditCampaign(c) {
    let audience = emptyAudience;
    try { const parsed = JSON.parse(c.audienceJson || "{}"); audience = { countries: (parsed.countries || []).join(", "), state: parsed.state || "", city: parsed.city || "", contactChannel: parsed.contactChannel || "", minScore: parsed.minScore || 0, denomination: parsed.denomination || "", onlyNeverContacted: !!parsed.onlyNeverContacted }; } catch {}
    setEditingCampaignId(c.id);
    setCampaign({ name: c.name, objective: c.objective, channels: JSON.parse(c.channelsJson || "[]"), audience, subject: c.subjectTemplate, body: c.bodyTemplate, socialBody: c.socialTemplate || "", demoVideoUrl: c.demoVideoUrl || "", language: c.language || "English", whatsAppContentSid: c.whatsAppContentSid || "", intervalDays: c.intervalDays, nextRunAtUtc: "" });
    setAudiencePreview(null);
  }
  async function reviewBatch(id) { setBusy(true); setError(""); try { const preview=await marketing.previewCampaignDispatch(id); setDispatchReview(preview); setDispatchDecisions(Object.fromEntries((preview.rows||[]).map(x=>[`${x.prospectId}:${x.channel}`,"skip"]))); } catch(e){setError(errorText(e));} finally{setBusy(false);} }
  function setBulkDispatchDecision(action, predicate = () => true) {
    if (!dispatchReview) return;
    setDispatchDecisions(current => {
      const next = { ...current };
      (dispatchReview.rows || [])
        .filter(row => predicate(row) && (action === "skip" || !!row.recipient?.trim()))
        .forEach(row => { next[`${row.prospectId}:${row.channel}`] = action; });
      return next;
    });
  }
  async function executeBatch() {
    const decisions = Object.entries(dispatchDecisions).map(([key, action]) => {
      const split = key.lastIndexOf(":");
      return { prospectId: key.slice(0, split), channel: key.slice(split + 1), action };
    });
    if (!decisions.some(x => x.action === "send")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await marketing.dispatchCampaign(dispatchReview.campaignId, decisions);
      setDispatchReview(null); setDispatchDecisions({});
      setMessage("Selected recipients dispatched.");
      await refresh();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const responseRate = dashboard.sent ? Math.round((dashboard.responses / dashboard.sent) * 100) : 0;
  const cards = useMemo(() => [
    ["Prospects", dashboard.prospects || 0, UserRoundSearch], ["Approved audience", dashboard.approvedProspects || 0, ShieldCheck],
    ["Provider accepted", dashboard.sent || 0, Send], ["Verified reply rate", `${responseRate}%`, BarChart3],
    ["Confirmed clicks", dashboard.confirmedClicks || 0, MousePointerClick], ["Registrations", dashboard.registrations || 0, CheckCircle2],
    ["Qualified leads", dashboard.qualifiedLeads || 0, CheckCircle2], ["Active demos", dashboard.demos || 0, Globe2]
  ], [dashboard, responseRate]);
  const funnel = useMemo(() => [
    ["Approved audience", dashboard.approvedProspects || 0], ["Accepted by provider", dashboard.sent || 0],
    ["Delivery confirmed", dashboard.delivered || 0], ["Confirmed click", dashboard.confirmedClicks || 0],
    ["Human reply", dashboard.responses || 0], ["Registered", dashboard.registrations || 0],
    ["Qualified", dashboard.qualifiedLeads || 0], ["Active demo", dashboard.demos || 0]
  ], [dashboard]);
  const followUps = useMemo(() => (data.leads || []).filter(l => !["won","lost"].includes(l.stage) && l.qualificationNotes !== "Created automatically after a tracked demonstration-link click.")
    .sort((a,b) => new Date(a.nextActionAtUtc || 8640000000000000) - new Date(b.nextActionAtUtc || 8640000000000000)), [data.leads]);

  return <div className="min-h-full bg-slate-100 p-4 md:p-7">
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-r from-emerald-950 to-teal-800 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-emerald-200"><Megaphone size={18}/> Root growth operations</div><h1 className="mt-2 text-3xl font-black">Digital Marketing & Revenue Center</h1><p className="mt-2 max-w-3xl text-emerald-100">Public-source prospecting, approval-gated campaigns, lead qualification, quotations, customer acceptance, one-month demonstrations and SaaS conversion.</p></div>
        <button onClick={refresh} disabled={busy} className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-3 font-bold hover:bg-white/25"><RefreshCw size={17} className={busy ? "animate-spin" : ""}/> Refresh</button></div>
        <div className="mt-5 rounded-xl border border-white/20 bg-white/10 p-3 text-sm"><strong>Governance:</strong> only reviewed public business contacts may enter an approved audience. Nothing is sent until Root Admin approves the campaign. Suppression and opt-out are permanent.</div>
      </section>
      {(error || message) && <div className={`rounded-xl border p-4 font-semibold ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-8">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-2xl border bg-white p-4"><Icon className="text-emerald-700" size={20}/><div className="mt-3 text-2xl font-black">{value}</div><div className="text-xs font-bold uppercase text-slate-500">{label}</div></div>)}</div>
      <div className="flex flex-wrap gap-2">{[["analytics","Funnel & follow-up"],["discovery","AI Discovery"],["prospects","1. Prospects"],["campaigns","2. Campaigns"],["communications","Communication log"],["leads","3. Leads"],["quotes","4. Quotes & orders"]].map(([key,label]) => <button key={key} onClick={()=>setTab(key)} className={`rounded-xl px-4 py-2 font-bold ${tab===key?"bg-emerald-700 text-white":"border bg-white text-slate-700"}`}>{label}</button>)}</div>

      {tab === "analytics" && <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border bg-white p-5"><h2 className="text-xl font-black">Verified enrollment funnel</h2><p className="mb-5 text-sm text-slate-500">Only provider confirmations, explicit customer actions, replies, registrations and sales stages are treated as verified engagement.</p><div className="space-y-3">{funnel.map(([label,value],index)=>{const base=Math.max(1,funnel[0][1]); const width=Math.max(value?8:2,Math.round((value/base)*100)); const previous=index?funnel[index-1][1]:value; const conversion=index?(previous?Math.round((value/previous)*100):null):100; return <div key={label}><div className="mb-1 flex justify-between text-sm"><strong>{label}</strong><span>{value}{index>0?` · ${conversion==null?"—":`${conversion}%`} from prior stage`:""}</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-400" style={{width:`${Math.min(100,width)}%`}}/></div></div>})}</div><div className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl bg-sky-50 p-3"><strong>{dashboard.trackingOpens||0}</strong><div>Tracking-pixel loads · unverified</div></div><div className="rounded-xl bg-sky-50 p-3"><strong>{dashboard.unverifiedLinkVisits||0}</strong><div>Unconfirmed link visits · may include scanners</div></div><div className="rounded-xl bg-red-50 p-3"><strong>{dashboard.bounced||0}</strong><div>Failed or bounced</div></div><div className="rounded-xl bg-amber-50 p-3"><strong>{dashboard.unsubscribed||0}</strong><div>Unsubscribed</div></div></div></div>
        <div className="space-y-5">
        <div className="rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 text-xl font-black"><Clock3 size={20}/> Root Admin follow-up queue</h2><p className="mb-4 text-sm text-slate-500">Engaged and qualified churches should receive a human follow-up, not another automatic batch email.</p><div className="max-h-[34rem] space-y-3 overflow-auto">{followUps.map(l=><div key={l.id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-2"><strong>{l.prospect?.organizationName||"Prospect"}</strong><span className={`rounded-full px-2 py-1 text-xs font-bold ${tone[l.stage]||tone.draft}`}>{l.stage}</span></div><div className="mt-1 text-xs text-slate-500">Score {l.score} · {l.nextActionAtUtc?`follow up ${new Date(l.nextActionAtUtc).toLocaleString()}`:"follow-up date not scheduled"}</div><input type="datetime-local" value={followUpDates[l.id]||""} className="mt-3 w-full rounded-lg border p-2 text-sm" onChange={e=>setFollowUpDates({...followUpDates,[l.id]:e.target.value})}/><button className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white" onClick={()=>{const value=followUpDates[l.id]; if(!value){setError("Select a follow-up date and time.");return;} act(()=>marketing.moveLead(l.id,{stage:l.stage,notes:null,nextActionAtUtc:new Date(value).toISOString()}),"Follow-up scheduled.");}}>Schedule follow-up</button></div>)}{!followUps.length&&<div className="rounded-xl bg-slate-50 p-6 text-center text-slate-500">No open lead follow-ups.</div>}</div></div>
        <div className="rounded-2xl border bg-white p-5"><h2 className="mb-3 text-xl font-black">Performance by channel</h2><div className="space-y-2">{(dashboard.byChannel||[]).map(ch=><div key={ch.channel} className="flex items-center justify-between rounded-xl border p-3 text-sm"><strong className="capitalize">{ch.channel}</strong><span>{ch.accepted} provider accepted · {ch.delivered} delivery confirmed · {ch.confirmedClicks} confirmed clicks · {ch.failed} failed</span></div>)}{!(dashboard.byChannel||[]).length&&<div className="rounded-xl bg-slate-50 p-6 text-center text-slate-500">No channel activity yet.</div>}</div></div>
        </div>
      </section>}

      {tab === "discovery" && <section className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 text-xl font-black"><Bot/> Discover church mobile contacts</h2><p className="my-2 text-sm text-slate-500">Uses the configured OpenAI Responses web-search tool. Results are saved as drafts with supporting source URLs and must still be reviewed by SambitR.</p>
            <label className="text-sm font-bold">Countries, states and cities</label><textarea rows={3} value={discovery.regions} onChange={e=>setDiscovery({...discovery,regions:e.target.value})} className="mt-1 w-full rounded-xl border p-3"/>
            <label className="mt-3 block text-sm font-bold">Discovery focus<select value={discovery.contactFocus} onChange={e=>setDiscovery({...discovery,contactFocus:e.target.value})} className="mt-1 w-full rounded-xl border p-3"><option value="mobile">Public mobile / WhatsApp contacts</option><option value="all">All public contacts, including email</option></select></label>
            <p className="mt-2 text-xs text-slate-500">Search specific geographies, e.g. Punjab, Delhi NCR, Karnataka or Tamil Nadu, India. Numbers include ISD codes. Results depend on public sources; discovery cannot guarantee every church or prove buying intent.</p>
            <button type="button" onClick={()=>setDiscovery({...discovery,regions:"Punjab, Delhi NCR, Karnataka, Tamil Nadu, Kerala, Telangana, Andhra Pradesh, Maharashtra, Odisha, Northeast India",contactFocus:"mobile"})} className="mt-2 text-sm font-bold text-blue-700">Use Indian church regions</button>
            <label className="mt-3 block text-sm font-bold">Languages</label><input value={discovery.languages} onChange={e=>setDiscovery({...discovery,languages:e.target.value})} className="mt-1 w-full rounded-xl border p-3"/>
            <label className="mt-3 block text-sm font-bold">Maximum results</label><input type="number" min="1" max="100" value={discovery.maxProspects} onChange={e=>setDiscovery({...discovery,maxProspects:Number(e.target.value)})} className="mt-1 w-full rounded-xl border p-3"/>
            <button disabled={busy} onClick={()=>act(()=>marketing.runProspectDiscovery(discovery),"Discovery completed. New candidates are in the Prospect review queue.")} className="mt-4 rounded-xl bg-violet-700 px-4 py-3 font-bold text-white">Run discovery now</button>
          </div>
          <form onSubmit={e=>{e.preventDefault(); act(()=>marketing.saveDiscoverySchedule({...schedule,nextRunAtUtc:schedule.nextRunAtUtc||null}),"Schedule saved in disabled state. Review and approve it below.");}} className="rounded-2xl border bg-white p-5"><h2 className="text-xl font-black">Scheduled discovery</h2><p className="my-2 text-sm text-slate-500">Saving or editing disables the schedule until Root Admin approves it again.</p>
            <label className="mb-2 block text-sm font-bold">Discovery focus<select value={schedule.contactFocus} onChange={e=>setSchedule({...schedule,contactFocus:e.target.value})} className="mt-1 w-full rounded-xl border p-3"><option value="mobile">Public mobile / WhatsApp contacts</option><option value="all">All public contacts</option></select></label>
            <input required value={schedule.name} onChange={e=>setSchedule({...schedule,name:e.target.value})} className="mb-2 w-full rounded-xl border p-3"/><textarea rows={3} value={schedule.regions} onChange={e=>setSchedule({...schedule,regions:e.target.value})} className="mb-2 w-full rounded-xl border p-3"/>
            <div className="grid grid-cols-3 gap-2"><input value={schedule.languages} onChange={e=>setSchedule({...schedule,languages:e.target.value})} className="rounded-xl border p-3"/><input title="Maximum prospects" type="number" min="1" max="100" value={schedule.maxProspects} onChange={e=>setSchedule({...schedule,maxProspects:Number(e.target.value)})} className="rounded-xl border p-3"/><input title="Interval days" type="number" min="1" max="90" value={schedule.intervalDays} onChange={e=>setSchedule({...schedule,intervalDays:Number(e.target.value)})} className="rounded-xl border p-3"/></div>
            <input type="datetime-local" value={schedule.nextRunAtUtc} onChange={e=>setSchedule({...schedule,nextRunAtUtc:e.target.value})} className="mt-2 w-full rounded-xl border p-3"/>
            <button className="mt-4 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Save schedule for approval</button>
          </form>
        </div>
        <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-5"><h2 className="mb-3 text-xl font-black">Schedules</h2>{(data.discoverySchedules||[]).map(s=><div key={s.id} className="mb-2 flex items-center justify-between rounded-xl border p-3"><div><strong>{s.name}</strong><div className="text-xs text-slate-500">{s.contactFocus === "mobile" ? "Mobile / WhatsApp" : "All contacts"} · Every {s.intervalDays} day(s) · next {s.nextRunAtUtc?new Date(s.nextRunAtUtc).toLocaleString():"not set"}</div></div><button onClick={()=>act(()=>marketing.approveDiscoverySchedule(s.id,!s.enabled),s.enabled?"Schedule paused.":"Schedule approved and enabled.")} className={`rounded-lg px-3 py-2 text-sm font-bold ${s.enabled?"border text-slate-700":"bg-blue-700 text-white"}`}>{s.enabled?"Pause":"Approve & enable"}</button></div>)}</div>
        <div className="rounded-2xl border bg-white p-5"><h2 className="mb-3 text-xl font-black">Discovery run history</h2>{(data.discoveryRuns||[]).map(r=><div key={r.id} className="mb-2 rounded-xl border p-3"><div className="flex justify-between"><strong>{r.trigger} run</strong><span className={`rounded-full px-2 py-1 text-xs font-bold ${r.status==="completed"?tone.approved:r.status==="failed"?tone.rejected:tone.draft}`}>{r.status}</span></div><div className="mt-1 text-xs text-slate-500">Found {r.candidatesFound} · imported {r.candidatesImported} · skipped {r.candidatesSkipped} · {new Date(r.startedAtUtc).toLocaleString()}</div>{r.error&&<div className="mt-2 text-xs text-red-700">{r.error}</div>}</div>)}</div></div>
      </section>}

      {tab === "prospects" && <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form onSubmit={(e)=>{e.preventDefault(); act(async()=>{await marketing.addProspect(prospect); setProspect(emptyProspect);},"Prospect registered for review.");}} className="h-fit space-y-3 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-black">Register public prospect</h2><p className="text-sm text-slate-500">Every record requires a source URL and human review.</p>
          <label className="block text-sm font-bold">Country / ISD<select value={prospect.country} onChange={e=>setProspect({...prospect,country:e.target.value})} className="mt-1 w-full rounded-xl border p-3"><option value="">Select country (or enter +ISD numbers)</option>{phoneCountries.map(c=><option key={c.code} value={c.name}>{c.name} ({c.isdCode})</option>)}</select></label>
          {[["organizationName","Church / organization *"],["state","State / province"],["city","City"],["website","Website"],["contactName","Public contact name"],["publicEmail","Public email"],["publicPhone","Public mobile / phone (+ISD)"],["publicWhatsapp","WhatsApp"],["denomination","Denomination"],["sourceUrl","Public source URL *"]].map(([k,p])=><input key={k} required={k==="organizationName"||k==="sourceUrl"} value={prospect[k]} onChange={e=>setProspect({...prospect,[k]:e.target.value})} placeholder={p} className="w-full rounded-xl border px-3 py-2.5"/>)}
          <label className="block text-sm font-bold text-slate-700">WhatsApp consent status<select value={prospect.consentStatus} onChange={e=>setProspect({...prospect,consentStatus:e.target.value})} className="mt-1 w-full rounded-xl border px-3 py-2.5"><option value="unknown">Not obtained</option><option value="whatsapp_opted_in">Explicit WhatsApp opt-in verified</option><option value="whatsapp_opted_out">Opted out</option></select><span className="mt-1 block text-xs font-normal text-slate-500">A public phone number is not consent. Select verified only when you have auditable permission.</span></label>
          <button disabled={busy} className="w-full rounded-xl bg-emerald-700 py-3 font-bold text-white">Save for review</button>
        </form>
        <div className="overflow-hidden rounded-2xl border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><h2 className="text-xl font-black">Prospect review queue</h2><div className="flex gap-2"><select value={prospectsFilter.status} onChange={e=>setProspectsFilter({...prospectsFilter,status:e.target.value})} className="rounded-lg border px-3 py-2 text-sm"><option value="">All statuses</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="suppressed">Suppressed</option></select><input placeholder="Country" value={prospectsFilter.country} onChange={e=>setProspectsFilter({...prospectsFilter,country:e.target.value})} className="rounded-lg border px-3 py-2 text-sm"/></div></div>
          <div className="flex flex-wrap gap-2 border-b p-3">{["state","city"].map(k=><input key={k} aria-label={k} placeholder={k === "state" ? "State / province" : "City"} value={prospectsFilter[k]} onChange={e=>setProspectsFilter({...prospectsFilter,[k]:e.target.value})} className="rounded-lg border p-2 text-sm"/>)}<select aria-label="Contact channel" value={prospectsFilter.contactChannel} onChange={e=>setProspectsFilter({...prospectsFilter,contactChannel:e.target.value})} className="rounded-lg border p-2 text-sm"><option value="">All contact types</option><option value="sms">Has public phone</option><option value="whatsapp">Has published WhatsApp</option></select></div>
          <div className="divide-y">{(prospectsList.items||[]).map(p=><div key={p.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-black">{p.organizationName}</div><div className="text-sm text-slate-500">{[p.city,p.state,p.country,p.denomination,p.publicEmail].filter(Boolean).join(" · ")}</div><div className="my-2 text-sm"><div>Phone: {p.publicPhone || "Not published"} {p.publicPhone && `(${p.phoneType || "unverified"})`}</div><div>WhatsApp: {p.publicWhatsapp || "Not published"} · ISD: {p.isdCode || "Unverified"}</div><div className="text-xs text-slate-500">Consent: {p.consentStatus} · Retrieved: {p.sourceRetrievedAtUtc ? new Date(p.sourceRetrievedAtUtc).toLocaleDateString() : "Unknown"}</div>{p.aiSummary&&<p className="mt-1 text-xs text-slate-600">{p.aiSummary}</p>}</div><a className="text-xs text-blue-700 underline" href={p.sourceUrl} target="_blank" rel="noreferrer">Verify source</a></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${tone[p.status]||tone.draft}`}>{p.status}</span></div>
          <div className="mt-3 flex flex-wrap gap-2">{p.publicWhatsapp && !p.doNotContact && p.consentStatus !== "whatsapp_opted_in" && <button disabled={busy} title="Use only when you have auditable permission for WhatsApp marketing" onClick={()=>reviewProspectNow(p,{approved:true,doNotContact:false,consentStatus:"whatsapp_opted_in"},"Prospect approved and verified WhatsApp opt-in recorded.")} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-bold">Approve + record verified WhatsApp opt-in</button>}{p.status==="draft"&&<><button disabled={busy} onClick={()=>reviewProspectNow(p,{approved:true,doNotContact:false,consentStatus:p.consentStatus},"Prospect approved.")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Approve</button><button disabled={busy} onClick={()=>reviewProspectNow(p,{approved:false,doNotContact:true,consentStatus:"not_permitted"},"Prospect rejected and suppressed.")} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-60">Reject</button></>} {!p.doNotContact&&<button onClick={()=>act(()=>marketing.suppressProspect(p.id),"Contact suppressed.")} className="rounded-lg border px-3 py-2 text-sm font-bold">Do not contact</button>}</div></div>)}{!(prospectsList.items||[]).length&&<div className="p-10 text-center text-slate-500">No prospects match this filter.</div>}</div>
          {prospectsList.items.length<prospectsList.total&&<div className="border-t p-4 text-center"><button onClick={()=>loadProspectsPage(prospectsList.page+1)} className="rounded-lg border px-4 py-2 text-sm font-bold">Load more ({prospectsList.items.length} of {prospectsList.total})</button></div>}
        </div>
      </section>}

      {tab === "campaigns" && <section className="space-y-5">
        {whatsAppStatus&&<div className={`rounded-2xl border p-5 ${whatsAppStatus.ready?"border-emerald-200 bg-emerald-50":"border-amber-300 bg-amber-50"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-black"><MessageCircle size={21}/> WhatsApp communications</h2><p className="mt-1 text-sm text-slate-700">{whatsAppStatus.nextStep}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${whatsAppStatus.ready?"bg-emerald-700 text-white":"bg-amber-200 text-amber-900"}`}>{whatsAppStatus.ready?"Ready to send":"Sender setup required"}</span></div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl bg-white/80 p-3"><div className="text-xs font-bold uppercase text-slate-500">WABA ID</div><div className="mt-1 font-black">{whatsAppStatus.whatsAppBusinessAccountId||"Not configured"}</div></div><div className="rounded-xl bg-white/80 p-3"><div className="text-xs font-bold uppercase text-slate-500">Meta Business Manager</div><div className="mt-1 font-black">{whatsAppStatus.metaBusinessManagerId||"Not configured"}</div></div><div className="rounded-xl bg-white/80 p-3"><div className="text-xs font-bold uppercase text-slate-500">API credentials</div><div className="mt-1 font-black">{whatsAppStatus.credentialsConfigured?"Configured":"Missing"}</div></div><div className="rounded-xl bg-white/80 p-3"><div className="text-xs font-bold uppercase text-slate-500">Approved sender</div><div className="mt-1 font-black">{whatsAppStatus.senderConfigured?(whatsAppStatus.sender||"Messaging Service"):"Missing"}</div></div></div>
        </div>}
        <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 text-xl font-black"><Bot/> AI campaign assistant</h2><p className="mb-3 text-sm text-slate-500">AI drafts copy; it does not invent contacts or dispatch anything.</p>
          {Object.keys(ai).filter(k=>k!=="language").map(k=><textarea key={k} value={ai[k]} onChange={e=>setAi({...ai,[k]:e.target.value})} className="mb-2 w-full rounded-xl border p-3" rows={k==="objective"?2:1}/>)}
          <label className="mb-2 block text-sm font-bold">Draft language</label><select value={ai.language} onChange={e=>setAi({...ai,language:e.target.value})} className="mb-2 w-full rounded-xl border p-3">{languages.map(l=><option key={l}>{l}</option>)}</select>
          <button onClick={()=>act(async()=>{const r=await marketing.aiDraftCampaign(ai); setCampaign({...campaign, subject:r.subject||campaign.subject, body:r.emailBody||r.draft||campaign.body, socialBody:r.socialPost||campaign.socialBody, language:ai.language});},"AI draft generated and parsed; review it before creating the campaign.")} className="rounded-xl bg-violet-700 px-4 py-3 font-bold text-white">Generate governed draft</button></div>
        <form onSubmit={e=>{e.preventDefault(); const payload={...campaign, audience:audienceToApi(campaign.audience), nextRunAtUtc:campaign.nextRunAtUtc||null}; if(editingCampaignId){act(()=>marketing.updateCampaign(editingCampaignId,payload),"Campaign updated."); setEditingCampaignId(null);}else{act(()=>marketing.createCampaign(payload),"Campaign submitted for Root Admin approval.");} setCampaign(emptyCampaign); setAudiencePreview(null);}} className="space-y-2 rounded-2xl border bg-white p-5"><h2 className="flex items-center justify-between text-xl font-black"><span>{editingCampaignId?"Edit campaign":"Campaign definition"}</span>{editingCampaignId&&<button type="button" onClick={()=>{setEditingCampaignId(null); setCampaign(emptyCampaign); setAudiencePreview(null);}} className="rounded-lg border px-3 py-1 text-xs font-bold text-slate-600">Cancel edit</button>}</h2>
          <input required placeholder="Campaign name" value={campaign.name} onChange={e=>setCampaign({...campaign,name:e.target.value})} className="w-full rounded-xl border p-3"/><input required placeholder="Objective" value={campaign.objective} onChange={e=>setCampaign({...campaign,objective:e.target.value})} className="w-full rounded-xl border p-3"/>
          <label className="block text-sm font-bold">Copy language</label><select value={campaign.language} onChange={e=>setCampaign({...campaign,language:e.target.value})} className="w-full rounded-xl border p-3">{languages.map(l=><option key={l}>{l}</option>)}</select>
          <input required placeholder="Email subject" value={campaign.subject} onChange={e=>setCampaign({...campaign,subject:e.target.value})} className="w-full rounded-xl border p-3"/><textarea required rows={5} value={campaign.body} onChange={e=>setCampaign({...campaign,body:e.target.value})} className="w-full rounded-xl border p-3"/>
          <label className="block text-sm font-bold">Message body for WhatsApp / SMS / social channels</label><textarea rows={3} placeholder="Required when any non-email channel is selected" value={campaign.socialBody} onChange={e=>setCampaign({...campaign,socialBody:e.target.value})} className="w-full rounded-xl border p-3"/>
          {campaign.channels.includes("sms")&&<p className="text-xs text-slate-600">SMS sends your written message with opt-out text. Automatic tracking and demo-video links are omitted; the demoLink placeholder is removed. Website addresses you type are kept. SMS link clicks are not tracked.</p>}
          {campaign.channels.some(c=>c!=="email")&&!campaign.socialBody&&<div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-bold text-amber-800">A message body is required for the non-email channels selected below.</div>}
          <label className="block rounded-xl border border-violet-200 bg-violet-50 p-3"><span className="flex items-center gap-2 text-sm font-black text-violet-900"><Film size={17}/> Public demo video URL <span className="font-medium text-violet-600">(optional)</span></span><input type="url" inputMode="url" placeholder="https://youtube.com/watch?v=... or public MP4 URL" value={campaign.demoVideoUrl} onChange={e=>setCampaign({...campaign,demoVideoUrl:e.target.value})} className="mt-2 w-full rounded-xl border border-violet-200 bg-white p-3"/><span className="mt-2 block text-xs font-semibold text-violet-700">This link is automatically added to non-SMS campaign messages. SMS does not add tracking or demo-video links. Use a URL anyone can open without signing in.</span>{campaign.demoVideoUrl&&<a href={campaign.demoVideoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-blue-700 underline">Test video link <ExternalLink size={14}/></a>}</label>
          <div className="flex flex-wrap gap-3">{["email","sms","whatsapp","linkedin","facebook","instagram","x"].map(c=><label key={c} className="text-sm"><input type="checkbox" checked={campaign.channels.includes(c)} onChange={e=>setCampaign({...campaign,channels:e.target.checked?[...campaign.channels,c]:campaign.channels.filter(x=>x!==c)})}/> {c}</label>)}</div>
          {campaign.channels.includes("whatsapp")&&<label className="block rounded-xl border border-emerald-200 bg-emerald-50 p-3"><span className="text-sm font-black text-emerald-900">Twilio WhatsApp Content Template SID (optional override)</span><input placeholder="Uses the approved Mahima marketing template by default" value={campaign.whatsAppContentSid} onChange={e=>setCampaign({...campaign,whatsAppContentSid:e.target.value})} className="mt-2 w-full rounded-xl border border-emerald-200 bg-white p-3"/><span className="mt-2 block text-xs font-semibold text-emerald-700">The default Mahima marketing template fills variables 1–3 with contact name, church name and the tracked demo link. It becomes usable after Meta approval.</span></label>}
          <div className="rounded-xl border bg-slate-50 p-3"><h3 className="mb-2 text-sm font-black">Audience segmentation</h3>
            <div className="grid gap-2 md:grid-cols-2">
              <input placeholder="Countries (comma separated, blank = all)" value={campaign.audience.countries} onChange={e=>setCampaign({...campaign,audience:{...campaign.audience,countries:e.target.value}})} className="rounded-lg border p-2 text-sm"/>
              {["state","city"].map(k=><input key={k} aria-label={`Audience ${k}`} placeholder={k === "state" ? "State / province" : "City"} value={campaign.audience[k]} onChange={e=>setCampaign({...campaign,audience:{...campaign.audience,[k]:e.target.value}})} className="rounded-lg border p-2 text-sm"/>)}
              <select aria-label="Audience contact type" value={campaign.audience.contactChannel} onChange={e=>setCampaign({...campaign,audience:{...campaign.audience,contactChannel:e.target.value}})} className="rounded-lg border p-2 text-sm"><option value="">All contact types</option><option value="sms">Has public phone</option><option value="whatsapp">Has published WhatsApp</option></select>
              <input type="number" min="0" max="100" placeholder="Minimum score" value={campaign.audience.minScore} onChange={e=>setCampaign({...campaign,audience:{...campaign.audience,minScore:e.target.value}})} className="rounded-lg border p-2 text-sm"/>
              <input placeholder="Denomination keyword" value={campaign.audience.denomination} onChange={e=>setCampaign({...campaign,audience:{...campaign.audience,denomination:e.target.value}})} className="rounded-lg border p-2 text-sm"/>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={campaign.audience.onlyNeverContacted} onChange={e=>setCampaign({...campaign,audience:{...campaign.audience,onlyNeverContacted:e.target.checked}})}/> Only prospects never contacted</label>
            </div>
            <button type="button" onClick={previewAudienceNow} className="mt-3 rounded-lg border px-3 py-2 text-sm font-bold text-slate-700">Preview audience size</button>
            {audiencePreview&&<div className="mt-2 text-sm font-bold text-emerald-800">{audiencePreview.count} approved prospect(s) match this segment.</div>}
          </div>
          <button className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">{editingCampaignId?"Save changes":"Submit for approval"}</button></form></div>
        <div className="grid gap-3 md:grid-cols-2">{(data.campaigns||[]).map(c=><div key={c.id} className="rounded-2xl border bg-white p-5"><div className="flex justify-between gap-3"><h3 className="font-black">{c.name}</h3><span className={`rounded-full px-2 py-1 text-xs font-bold ${tone[c.status]||tone.draft}`}>{c.status}</span></div><p className="my-2 text-sm text-slate-600">{c.objective}</p><div className="mb-2 text-xs font-bold uppercase text-slate-400">{c.language||"English"}</div>{c.demoVideoUrl&&<a href={c.demoVideoUrl} target="_blank" rel="noreferrer" className="mb-3 inline-flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800"><Film size={15}/> Demo video <ExternalLink size={13}/></a>}<div className="flex flex-wrap gap-2">{["draft","pending_approval"].includes(c.status)&&<button onClick={()=>act(()=>marketing.approveCampaign(c.id),"Campaign approved.")} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white">Approve</button>}{["approved","active"].includes(c.status)&&<button onClick={()=>reviewBatch(c.id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white"><Mail size={14} className="mr-1 inline"/>Review batch before dispatch</button>}{["draft","pending_approval"].includes(c.status)&&<button onClick={()=>startEditCampaign(c)} className="rounded-lg border px-3 py-2 text-sm font-bold text-slate-700">Edit</button>}<button onClick={()=>act(()=>marketing.cloneCampaign(c.id),"Campaign cloned as a new draft.")} className="rounded-lg border px-3 py-2 text-sm font-bold text-slate-700">Clone</button>{["draft","pending_approval"].includes(c.status)&&<button onClick={()=>{if(confirm("Delete this draft campaign?")) act(()=>marketing.deleteCampaign(c.id),"Campaign deleted.");}} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700">Delete</button>}</div></div>)}</div>
        {dispatchReview&&<div className="rounded-2xl border-2 border-blue-300 bg-white p-5 shadow-xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">Select campaign recipients — {dispatchReview.name}</h2><p className="text-sm text-slate-500">{dispatchReview.firstTime} first-time · {dispatchReview.previouslySent} previously sent · {dispatchReview.previouslyFailed} previously failed</p></div><button onClick={()=>setDispatchReview(null)} className="rounded-lg border px-3 py-2 font-bold">Cancel</button></div><div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3"><span className="mr-1 text-sm font-black text-blue-950">Bulk selection:</span><button type="button" onClick={()=>setBulkDispatchDecision("send")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Select all recipients</button><button type="button" onClick={()=>setBulkDispatchDecision("skip")} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white">Clear selection</button><button type="button" onClick={()=>setBulkDispatchDecision("send",row=>row.lastStatus==="failed")} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700">Retry all failed</button><button type="button" onClick={()=>setBulkDispatchDecision("send",row=>row.lastStatus==="sent")} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-800">Resend all sent</button><span className="ml-auto text-sm font-bold text-blue-900">{Object.values(dispatchDecisions).filter(x=>x==="send").length} selected to send · {Object.values(dispatchDecisions).filter(x=>x==="skip").length} skipped</span></div><div className="mt-4 max-h-[32rem] space-y-2 overflow-auto">{(dispatchReview.rows||[]).map(row=>{const key=`${row.prospectId}:${row.channel}`; const bg=row.lastStatus==="failed"?"border-red-300 bg-red-50":row.lastStatus==="sent"?"border-emerald-300 bg-emerald-50":"border-slate-200 bg-slate-50"; return <div key={key} className={`rounded-xl border p-3 ${bg}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{row.organizationName}</strong><div className="text-sm text-slate-600">{row.channel} → {row.recipient||"No recipient"}</div><div className="text-xs font-bold">Attempts: {row.attemptCount} · Last: {row.lastStatus}{row.lastAttemptedAtUtc?` · ${new Date(row.lastAttemptedAtUtc).toLocaleString()}`:""}</div>{row.lastFailureReason&&<div className="mt-1 text-xs text-red-700">{row.lastFailureReason}</div>}</div><label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-bold"><input type="checkbox" aria-label={`Send ${row.channel} to ${row.organizationName}`} disabled={busy || !row.recipient?.trim()} checked={dispatchDecisions[key]==="send"} onChange={e=>setDispatchDecisions(current=>({...current,[key]:e.target.checked?"send":"skip"}))}/>{!row.recipient?.trim()?"No recipient":row.attemptCount>0?"Send again":"Send to this recipient"}</label></div></div>})}</div><div className="mt-4 flex justify-end"><button disabled={busy || !Object.values(dispatchDecisions).some(x=>x==="send")} onClick={executeBatch} className="rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">Send to selected recipients ({Object.values(dispatchDecisions).filter(x=>x==="send").length})</button></div></div>}
      </section>}

      {tab === "communications" && <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="text-xl font-black">Communication attempt log</h2><p className="text-sm text-slate-500">Auditable payload and outcome for every successful, failed, suppressed, or connector-queued attempt.</p></div><div className="flex gap-2"><select value={commsFilter.status} onChange={e=>setCommsFilter({...commsFilter,status:e.target.value})} className="rounded-xl border px-3 py-2"><option value="">All outcomes</option><option value="sent">Passed / sent</option><option value="failed">Failed</option><option value="suppressed">Suppressed</option><option value="awaiting_connector">Awaiting connector</option></select><select value={commsFilter.channel} onChange={e=>setCommsFilter({...commsFilter,channel:e.target.value})} className="rounded-xl border px-3 py-2"><option value="">All channels</option><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></div></div>
        <div className="divide-y">{(commsList.items||[]).map(item=><details key={item.id} className="group p-4"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3"><div><strong>{item.prospect?.organizationName||"Unknown prospect"}</strong><div className="text-sm text-slate-500">{item.channel} → {item.recipient||"No recipient"} · attempt {item.attemptNumber} · {new Date(item.attemptedAtUtc||item.createdAtUtc).toLocaleString()}</div></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status==="sent"?tone.approved:item.status==="failed"?tone.rejected:tone.draft}`}>{item.status}</span></summary><div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm"><div><span className="font-bold">Campaign:</span> {item.campaign?.name||"-"}</div><div><span className="font-bold">Provider:</span> {item.provider||"-"}</div><div><span className="font-bold">Subject:</span> {item.renderedSubject||"-"}</div><div><div className="mb-1 font-bold">Exact content attempted</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border bg-white p-3 font-sans">{item.renderedBody||"(empty)"}</pre></div>{item.failureReason&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"><strong>Failure:</strong> {item.failureReason}</div>}<div><div className="mb-2 font-bold">Customer engagement timeline</div><div className="space-y-2 border-l-2 border-emerald-200 pl-4">{[...(item.events||[])].sort((a,b)=>new Date(a.eventAtUtc)-new Date(b.eventAtUtc)).map(event=><div key={event.id}><span className="font-bold capitalize">{event.eventType.replaceAll("_"," ")}</span><span className="ml-2 text-xs text-slate-500">{new Date(event.eventAtUtc).toLocaleString()}</span>{event.linkUrl&&<div className="truncate text-xs text-blue-700">{event.linkUrl}</div>}</div>)}{!(item.events||[]).length&&<div className="text-slate-500">No delivery or engagement events recorded.</div>}</div></div><div className="text-xs text-slate-500">Attempted: {item.attemptedAtUtc?new Date(item.attemptedAtUtc).toLocaleString():"-"} · Completed: {item.completedAtUtc?new Date(item.completedAtUtc).toLocaleString():"-"} · External ID: {item.externalMessageId||"-"}</div></div></details>)}{!(commsList.items||[]).length&&<div className="p-10 text-center text-slate-500">No communication attempts have been recorded yet.</div>}</div>
        {commsList.items.length<commsList.total&&<div className="border-t p-4 text-center"><button onClick={()=>loadCommsPage(commsList.page+1)} className="rounded-lg border px-4 py-2 text-sm font-bold">Load more ({commsList.items.length} of {commsList.total})</button></div>}
      </section>}

      {tab === "leads" && <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 text-xl font-black">Lead pipeline</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{["new","contacted","engaged","qualified","proposal","negotiation","won","lost"].map(stage=><div key={stage} className="rounded-xl bg-slate-50 p-3"><div className="mb-3 font-black capitalize">{stage}</div>{(data.leads||[]).filter(l=>l.stage===stage).map(l=><div key={l.id} className="mb-2 rounded-xl border bg-white p-3"><strong>{l.prospect?.organizationName}</strong><div className="text-xs text-slate-500">Score {l.score}{l.nextActionAtUtc?` · next ${new Date(l.nextActionAtUtc).toLocaleString()}`:""}</div><select value={l.stage} onChange={e=>act(()=>marketing.moveLead(l.id,{stage:e.target.value,notes:null}),"Lead stage updated.")} className="mt-2 w-full rounded-lg border p-2 text-sm">{["new","contacted","engaged","qualified","proposal","negotiation","won","lost"].map(x=><option key={x}>{x}</option>)}</select></div>)}</div>)}</div></section>}
      {tab === "quotes" && <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 text-xl font-black">Quotations, acceptance & demo orders</h2><div className="divide-y">{(data.quotes||[]).map(q=><div key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><strong>{q.quoteNumber}</strong><div className="text-sm text-slate-500">{q.currency} {Number(q.amount).toLocaleString()} · valid until {new Date(q.validUntilUtc).toLocaleDateString()}</div></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-bold ${tone[q.order?.status||q.status]||tone.draft}`}>{q.order?.status||q.status}</span>{q.status==="draft"&&<button onClick={()=>act(()=>marketing.approveSendQuote(q.id),"Quote approved and sent.")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Approve & send</button>}</div></div>)}</div><p className="mt-4 text-sm text-slate-500">After customer acceptance, Root Admin links the order to an existing/provisioned tenant and activates a 30-day all-feature demo. Paid conversion continues through the existing Subscriptions & SAAS Billing module.</p></section>}
      {busy&&<div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-white shadow-xl"><Loader2 className="animate-spin" size={18}/> Working</div>}
    </div>
  </div>;
}
