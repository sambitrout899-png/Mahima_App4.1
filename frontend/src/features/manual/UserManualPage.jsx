import React, { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, Monitor, Search, ShieldCheck, Smartphone, Sparkles, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { guides, quickLinks, findGuidesForPath } from "./manualContent";

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function UserManualPage() {
  const [platform, setPlatform] = useState("all");
  const [query, setQuery] = useState("");
  const location = useLocation();
  const cardRefs = useRef({});
  const [highlighted, setHighlighted] = useState([]);
  const [contextNotice, setContextNotice] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref");
    if (!ref) { setHighlighted([]); setContextNotice(null); return; }
    const matches = findGuidesForPath(ref);
    if (!matches.length) { setHighlighted([]); setContextNotice(null); return; }
    setHighlighted(matches.map((guide) => guide.title));
    setContextNotice(matches[0].title);
    const target = cardRefs.current[slug(matches[0].title)];
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [location.search]);

  const filtered = useMemo(() => guides.filter((guide) => {
    const matchesPlatform = platform === "all" || guide.platforms.includes(platform);
    const haystack = `${guide.group} ${guide.title} ${guide.access} ${guide.steps.join(" ")}`.toLowerCase();
    return matchesPlatform && haystack.includes(query.trim().toLowerCase());
  }), [platform, query]);
  const grouped = useMemo(() => filtered.reduce((result, guide) => {
    (result[guide.group] ||= []).push(guide);
    return result;
  }, {}), [filtered]);

  return (
    <div className="min-h-full bg-slate-50 px-3 py-4 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-600 p-5 text-white shadow-xl sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-widest"><Sparkles className="h-4 w-4" /> Code-aligned guide</div><h1 className="text-3xl font-black sm:text-4xl">User Manual</h1><p className="mt-3 text-sm leading-6 text-emerald-50 sm:text-base">Practical instructions for the current web and Android application. Some modules appear only when your role, tenant subscription, and device allow them.</p></div>
            <div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-2xl bg-white/10 p-3"><Monitor className="mx-auto h-6 w-6"/><strong className="mt-1 block">Web</strong><span className="text-xs text-emerald-100">Full administration</span></div><div className="rounded-2xl bg-white/10 p-3"><Smartphone className="mx-auto h-6 w-6"/><strong className="mt-1 block">Mobile</strong><span className="text-xs text-emerald-100">Focused ministry use</span></div></div>
          </div>
        </section>

        <section className="sticky top-16 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4">
          <div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="Search the manual…" /></label><div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">{[["all","All"],["web","Web"],["mobile","Mobile"]].map(([key,label]) => <button key={key} onClick={() => setPlatform(key)} className={`rounded-lg px-4 py-2 text-sm font-black ${platform === key ? "bg-white text-emerald-800 shadow" : "text-slate-500"}`}>{label}</button>)}</div></div>
        </section>

        <section className="grid gap-3 sm:grid-cols-5">{quickLinks.map(([label,to]) => <Link key={to} to={to} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700 shadow-sm hover:border-emerald-300 hover:text-emerald-800">{label}<ChevronRight className="h-4 w-4"/></Link>)}</section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0"/><p><strong>Access works in three layers:</strong> your role controls page permission, your position controls which records you can see, and your tenant subscription controls which modules are enabled. Mobile intentionally offers a smaller set of operational pages than web.</p></div></section>

        {contextNotice && <section className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"><span><strong>Showing help for the page you came from:</strong> {contextNotice}</span><button onClick={() => { setHighlighted([]); setContextNotice(null); }} className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-emerald-800 shadow-sm"><X className="h-3.5 w-3.5"/> Show everything</button></section>}

        {Object.entries(grouped).map(([group, items]) => <section key={group}><div className="mb-3 flex items-center gap-2"><BookOpen className="h-5 w-5 text-emerald-700"/><h2 className="text-xl font-black text-slate-900">{group}</h2><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{items.length}</span></div><div className="grid gap-4 lg:grid-cols-2">{items.map((guide) => { const isHighlighted = highlighted.includes(guide.title); return <article key={guide.title} ref={(el) => { cardRefs.current[slug(guide.title)] = el; }} className={`rounded-2xl border p-4 shadow-sm sm:p-5 transition ${isHighlighted ? "border-emerald-400 bg-emerald-50 ring-4 ring-emerald-100" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-slate-900">{guide.title}</h3><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Access: {guide.access}</p></div><div className="flex gap-1">{guide.platforms.includes("web") && <span title="Web" className="rounded-lg bg-blue-50 p-2 text-blue-700"><Monitor className="h-4 w-4"/></span>}{guide.platforms.includes("mobile") && <span title="Mobile" className="rounded-lg bg-violet-50 p-2 text-violet-700"><Smartphone className="h-4 w-4"/></span>}</div></div><ol className="mt-4 space-y-3">{guide.steps.map((step,index) => <li key={step} className="flex gap-3 text-sm leading-5 text-slate-600"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">{index + 1}</span><span>{step}</span></li>)}</ol></article>; })}</div></section>)}

        {!filtered.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-slate-400"/><h2 className="mt-3 font-black">No matching guide</h2><p className="mt-1 text-sm text-slate-500">Try another search or select All platforms.</p></div>}

        <footer className="rounded-2xl bg-slate-900 p-5 text-sm text-slate-300"><strong className="text-white">Need more help?</strong><p className="mt-1">Contact your tenant administrator for access, position, or data questions. For paid subscription activation outside India, write to contact@mahimaministries.in.</p></footer>
      </div>
    </div>
  );
}
