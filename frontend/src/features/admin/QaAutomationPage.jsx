import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Download, FileCheck2, Fingerprint, FlaskConical, History, Loader2, Play, Radar, RefreshCw, SearchCode, ShieldCheck, Siren, Wrench } from "lucide-react";
import { approveQaPlan, generateQaPlan, getQaCatalog, getQaRun, getQaRuns, getSecurityMonitorRun, getSecurityMonitorRuns, getSecurityMonitorStatus, getSolutionReport, runApprovedQaPlan, runSecurityMonitorNow } from "../../api/qaAutomationApi";

const resultTone = { passed: "bg-emerald-50 text-emerald-800 border-emerald-200", warning: "bg-amber-50 text-amber-800 border-amber-200", failed: "bg-red-50 text-red-800 border-red-200" };
const severityTone = { critical: "bg-red-100 text-red-800", high: "bg-orange-100 text-orange-800", medium: "bg-amber-100 text-amber-800", low: "bg-blue-100 text-blue-800" };
const errorText = (error) => {
  const body = error?.response?.data || error?.data || error;
  return body?.detail || body?.message || body?.title || error?.message || "The QA request failed.";
};

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export default function QaAutomationPage() {
  const [submodule, setSubmodule] = useState("qa");
  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState(["platform"]);
  const [runs, setRuns] = useState([]);
  const [plan, setPlan] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [loadTest, setLoadTest] = useState({ approved: false, concurrency: 5, requests: 50, path: "/api/admin/qa/catalog" });
  const [report, setReport] = useState(null);
  const [solution, setSolution] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true); setError("");
    try {
      const [modules, history] = await Promise.all([getQaCatalog(), getQaRuns()]);
      setCatalog(Array.isArray(modules) ? modules : []); setRuns(Array.isArray(history) ? history : []);
    } catch (error) { setError(String(errorText(error))); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function generate() {
    if (!selected.length) { setError("Select at least one module."); return; }
    setBusy(true); setError(""); setReport(null); setSolution(null);
    try {
      const next = await generateQaPlan(selected);
      if (!next?.id || !Array.isArray(next?.cases) || next?.status !== "draft") {
        throw new Error(errorText(next));
      }
      setPlan(next);
      setDecisions(Object.fromEntries((next.cases || []).map((item) => [item.id, { approved: true, testDataApproved: false, reviewerNotes: "" }])));
    } catch (error) { setError(String(errorText(error))); }
    finally { setBusy(false); }
  }

  async function approve() {
    const cases = Object.entries(decisions).map(([id, decision]) => ({ id, ...decision }));
    if (!cases.some((item) => item.approved)) { setError("Approve at least one critical scenario."); return; }
    setBusy(true); setError("");
    if (cases.some((item) => item.approved && !item.testDataApproved)) { setError("Approve the generated test data for every selected test case."); return; }
    try { setPlan(await approveQaPlan(plan.id, cases, loadTest)); }
    catch (error) { setError(String(errorText(error))); }
    finally { setBusy(false); }
  }

  async function run() {
    setBusy(true); setError(""); setSolution(null);
    try {
      const result = await runApprovedQaPlan(plan.id); setReport(result);
      setPlan((current) => ({ ...current, status: "completed" })); setRuns(await getQaRuns());
    } catch (error) { setError(String(errorText(error))); }
    finally { setBusy(false); }
  }

  async function openRun(id) {
    setBusy(true); setError(""); setSolution(null);
    try { setReport(await getQaRun(id)); }
    catch (error) { setError(String(errorText(error))); }
    finally { setBusy(false); }
  }

  async function loadSolutions() {
    if (!report?.id) return; setBusy(true); setError("");
    try { setSolution(await getSolutionReport(report.id)); }
    catch (error) { setError(String(errorText(error))); }
    finally { setBusy(false); }
  }

  const groupedFindings = useMemo(() => {
    const map = new Map(); (report?.findings || []).forEach((item) => { if (!map.has(item.moduleCode)) map.set(item.moduleCode, []); map.get(item.moduleCode).push(item); });
    return [...map.entries()];
  }, [report]);
  const approvedCount = Object.values(decisions).filter((item) => item.approved).length;
  const approvedDataCount = Object.values(decisions).filter((item) => item.approved && item.testDataApproved).length;
  const approveSelectedData = () => {
    setError("");
    setDecisions((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, { ...value, testDataApproved: Boolean(value.approved) }])));
  };
  const selectAndApproveAll = () => {
    setError("");
    setDecisions(Object.fromEntries((plan?.cases || []).map((item) => [item.id, { ...(decisions[item.id] || {}), approved: true, testDataApproved: true }])));
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
    <header className="rounded-3xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div>
        <div className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-emerald-700"><FlaskConical className="h-4 w-4" /> Root QA automation</div>
        <h1 className="text-3xl font-black text-slate-900">Critical Scenario Test Center</h1>
        <p className="mt-2 max-w-4xl text-slate-600">Generate tests from the deployed module design, review and approve the exact scenarios, then execute only the approved read-only checks.</p>
      </div><button onClick={refresh} disabled={busy || loading} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 font-bold"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}
    </header>

    <nav className="grid grid-cols-2 gap-2 rounded-2xl border bg-white p-2 shadow-sm">
      <button onClick={() => setSubmodule("qa")} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-black ${submodule === "qa" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}><FlaskConical className="h-5 w-5" /> Test Automation</button>
      <button onClick={() => setSubmodule("security")} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-black ${submodule === "security" ? "bg-emerald-800 text-white" : "text-slate-600 hover:bg-emerald-50"}`}><Radar className="h-5 w-5" /> Security Check</button>
    </nav>

    {submodule === "security" ? <SecurityCheckPanel /> : <>

    <div className="grid gap-3 md:grid-cols-3">
      <Step number="1" title="Generate" description="Inspect modules, routes, schema and critical invariants." active={!plan} done={Boolean(plan)} icon={SearchCode} />
      <Step number="2" title="Review & approve" description="Root Admin selects and approves exact scenarios." active={plan?.status === "draft"} done={["approved", "completed"].includes(plan?.status)} icon={FileCheck2} />
      <Step number="3" title="Run & resolve" description="Execute approved cases and produce defects and fixes." active={plan?.status === "approved"} done={plan?.status === "completed"} icon={Play} />
    </div>

    <section className="rounded-3xl border bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Step 1 — Generate critical scenarios</h2><p className="text-sm text-slate-600">Scenario definitions are fingerprinted against the currently published API design.</p></div><button onClick={generate} disabled={busy || loading} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCode className="h-4 w-4" />} Generate test cases</button></div>
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{catalog.map((item) => <label key={item.code} className={`cursor-pointer rounded-2xl border p-4 ${selected.includes(item.code) ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}><div className="flex gap-3"><input type="checkbox" className="mt-1" checked={selected.includes(item.code)} onChange={() => setSelected((current) => current.includes(item.code) ? current.filter((x) => x !== item.code) : [...current, item.code])} /><div><b>{item.name}</b><p className="mt-1 text-sm text-slate-600">{item.description || "Runtime and data integrity scenarios."}</p></div></div></label>)}</div>}
    </section>

    {plan && <section className="rounded-3xl border bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">Step 2 — Root Admin review and approval</h2><p className="text-sm text-slate-600">{plan.name} · {plan.cases?.length || 0} generated · {approvedCount} selected</p><code className="mt-1 block text-xs text-slate-400">Design fingerprint: {plan.designFingerprint}</code></div>{plan.status === "draft" ? <button onClick={approve} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 font-bold text-white"><ShieldCheck className="h-4 w-4" /> Approve selected cases</button> : <span className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-black uppercase text-emerald-800">{plan.status}</span>}</div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold"><span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">Positive: {plan.cases?.filter((x) => x.scenarioType === "positive").length || 0}</span><span className="rounded-full bg-red-100 px-3 py-1 text-red-800">Negative: {plan.cases?.filter((x) => x.scenarioType === "negative").length || 0}</span><span className={`rounded-full px-3 py-1 ${approvedDataCount === approvedCount && approvedCount > 0 ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>Datasets approved: {approvedDataCount}/{approvedCount}</span>{plan.status === "draft" && <><button type="button" onClick={approveSelectedData} disabled={!approvedCount} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-amber-900 disabled:opacity-40">Approve data for selected</button><button type="button" onClick={selectAndApproveAll} className="rounded-xl bg-slate-900 px-3 py-2 text-white">Select and approve all</button></>}</div>
      <div className="space-y-3">{(plan.cases || []).map((item) => <details key={item.id} className={`rounded-2xl border ${decisions[item.id]?.approved || item.approved ? "border-blue-300 bg-blue-50/40" : "border-slate-200"}`}>
        <summary className="flex cursor-pointer list-none items-start gap-3 p-4"><input type="checkbox" className="mt-1 h-4 w-4" disabled={plan.status !== "draft"} checked={item.approved || Boolean(decisions[item.id]?.approved)} onClick={(event) => event.stopPropagation()} onChange={(event) => setDecisions((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), approved: event.target.checked, testDataApproved: event.target.checked ? Boolean(current[item.id]?.testDataApproved) : false } }))} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{item.title}</b><span className={`rounded-full px-2 py-0.5 text-xs font-black uppercase ${severityTone[item.severity] || severityTone.medium}`}>{item.severity}</span><span className={`rounded-full px-2 py-0.5 text-xs font-black ${decisions[item.id]?.testDataApproved ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>{decisions[item.id]?.testDataApproved ? "CASE + DATA APPROVED" : "DATA APPROVAL REQUIRED"}</span><code className="text-xs text-slate-400">{item.testKey}</code></div><p className="mt-1 text-sm text-slate-600">{item.objective}</p></div><ChevronDown className="h-4 w-4" /></summary>
        <div className="grid gap-3 border-t p-4 text-sm md:grid-cols-2"><div><b>Scenario</b><p className={`mt-1 font-black uppercase ${item.scenarioType === "negative" ? "text-red-700" : "text-emerald-700"}`}>{item.scenarioType}</p></div><div><b>Expected result</b><p className="mt-1 text-slate-600">{item.expectedResult}</p></div><div><b>Preconditions</b><p className="mt-1 text-slate-600">{item.preconditions}</p></div><div><b>Generated synthetic test data</b><pre className="mt-1 max-h-52 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(item.testData, null, 2)}</pre></div><div className="md:col-span-2"><b>Execution steps</b><ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600">{(item.steps || []).map((step) => <li key={step}>{step}</li>)}</ol></div>{plan.status === "draft" && <><label className={`flex items-center gap-2 rounded-xl border p-3 font-bold ${decisions[item.id]?.approved ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50 text-slate-400"}`}><input type="checkbox" disabled={!decisions[item.id]?.approved} checked={Boolean(decisions[item.id]?.testDataApproved)} onChange={(event) => setDecisions((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), testDataApproved: event.target.checked } }))} />{decisions[item.id]?.approved ? "I reviewed and approve this generated test dataset" : "Select this test case before approving its dataset"}</label><label className="md:col-span-2"><b>Reviewer notes</b><textarea className="mt-1 w-full rounded-xl border bg-white p-2" value={decisions[item.id]?.reviewerNotes || ""} onChange={(event) => setDecisions((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), reviewerNotes: event.target.value } }))} /></label></>}</div>
      </details>)}</div>
      {plan.status === "draft" && <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><label className="flex items-center gap-2 font-black text-violet-950"><input type="checkbox" checked={loadTest.approved} onChange={(e) => setLoadTest((x) => ({ ...x, approved: e.target.checked }))} />Approve an end-to-end load test with this run</label><p className="mt-1 text-sm text-violet-800">Bounded to 20 concurrent clients and 200 requests. The authenticated Root Admin context is reused.</p>{loadTest.approved && <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-sm font-bold">Concurrency<input type="number" min="1" max="20" className="mt-1 w-full rounded-xl border p-2" value={loadTest.concurrency} onChange={(e) => setLoadTest((x) => ({ ...x, concurrency: Number(e.target.value) }))} /></label><label className="text-sm font-bold">Total requests<input type="number" min="1" max="200" className="mt-1 w-full rounded-xl border p-2" value={loadTest.requests} onChange={(e) => setLoadTest((x) => ({ ...x, requests: Number(e.target.value) }))} /></label><label className="text-sm font-bold">Read-only API path<input className="mt-1 w-full rounded-xl border p-2" value={loadTest.path} onChange={(e) => setLoadTest((x) => ({ ...x, path: e.target.value }))} /></label></div>}</div>}
    </section>}

    {plan?.status === "approved" && <section className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-emerald-950">Step 3 — Run approved scenarios</h2><p className="text-emerald-800">Only the {plan.cases?.filter((item) => item.approved).length} cases approved by the Root Admin will execute.</p></div><button onClick={run} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-6 py-3 font-black text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run approved plan</button></div></section>}

    {report && <><LoadMetrics metrics={report.loadTestMetrics} /><Report report={report} grouped={groupedFindings} solution={solution} onSolutions={loadSolutions} /><ImpactSummary solution={solution} /></>}

    <section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="mb-4 flex items-center gap-2 text-xl font-black"><History className="h-5 w-5" /> Run history</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="p-3">Started</th><th className="p-3">Status</th><th className="p-3">Passed</th><th className="p-3">Warnings</th><th className="p-3">Defects</th><th /></tr></thead><tbody>{runs.map((item) => <tr key={item.id} className="border-b"><td className="p-3">{new Date(item.startedAtUtc).toLocaleString()}</td><td className="p-3 font-bold">{String(item.status).replaceAll("_", " ")}</td><td className="p-3 text-emerald-700">{item.passedCount}</td><td className="p-3 text-amber-700">{item.warningCount}</td><td className="p-3 text-red-700">{item.failedCount}</td><td className="p-3 text-right"><button className="font-bold text-emerald-700" onClick={() => openRun(item.id)}>Open</button></td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

function SecurityCheckPanel() {
  const [status, setStatus] = useState(null); const [runs, setRuns] = useState([]); const [selectedRun, setSelectedRun] = useState(null); const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  async function load() { setBusy(true); setError(""); try { const [s,h] = await Promise.all([getSecurityMonitorStatus(), getSecurityMonitorRuns()]); setStatus(s); setRuns(Array.isArray(h) ? h : []); if (!selectedRun && h?.[0]?.id) setSelectedRun(await getSecurityMonitorRun(h[0].id)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  useEffect(() => { load(); }, []);
  async function runNow() { setBusy(true); setError(""); try { const run = await runSecurityMonitorNow(); setSelectedRun(run); const [s,h] = await Promise.all([getSecurityMonitorStatus(), getSecurityMonitorRuns()]); setStatus(s); setRuns(h); } catch(e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function open(id) { setBusy(true); try { setSelectedRun(await getSecurityMonitorRun(id)); } catch(e) { setError(errorText(e)); } finally { setBusy(false); } }
  const domains = ["VAPT","SOC2","IR","DFIR"];
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 p-6 text-white shadow-xl"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-emerald-300"><Radar className="h-4 w-4"/> Continuous security posture</div><h2 className="mt-2 text-3xl font-black">24/7 Security Check</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Read-only automated monitoring for VAPT posture, SOC 2 readiness, incident response, and DFIR evidence controls. Runs every {status?.intervalMinutes || 15} minutes.</p></div><button onClick={runNow} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-black text-emerald-950 disabled:opacity-50">{busy?<Loader2 className="h-5 w-5 animate-spin"/>:<Play className="h-5 w-5"/>} Run security check now</button></div></section>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{domains.map((domain) => { const f=(selectedRun?.findings||[]).filter(x=>x.domain===domain); const failed=f.filter(x=>x.status==="failed").length; return <div key={domain} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><b>{domain === "SOC2" ? "SOC 2" : domain}</b>{domain==="IR"?<Siren className="h-5 w-5 text-orange-600"/>:domain==="DFIR"?<Fingerprint className="h-5 w-5 text-violet-600"/>:<ShieldCheck className="h-5 w-5 text-emerald-700"/>}</div><div className={`mt-3 text-3xl font-black ${failed?"text-red-700":"text-emerald-700"}`}>{f.length ? `${f.length-failed}/${f.length}` : "—"}</div><p className="text-xs text-slate-500">controls passing</p></div>; })}</div>
    {status?.disclaimer && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><b>Scope notice:</b> {status.disclaimer}</div>}
    {selectedRun && <section className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xl font-black">Security posture score: {selectedRun.score}%</h3><p className="text-sm text-slate-500">{new Date(selectedRun.completedAtUtc).toLocaleString()} · {String(selectedRun.trigger).replaceAll("_"," ")} · {String(selectedRun.status).replaceAll("_"," ")}</p></div><button onClick={() => downloadJson(`security-check-${selectedRun.id}.json`, selectedRun)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 font-bold"><Download className="h-4 w-4"/> Export evidence</button></div><div className="mt-5 space-y-3">{(selectedRun.findings||[]).map((f)=><details key={`${f.domain}-${f.control}`} className="rounded-2xl border"><summary className="flex cursor-pointer list-none items-center gap-3 p-4"><span className={`rounded-full border px-2 py-1 text-xs font-black ${resultTone[f.status]||resultTone.warning}`}>{f.status}</span><div className="min-w-0 flex-1"><b>{f.control} · {f.title}</b><p className="text-xs text-slate-500">{f.domain} · {f.severity}</p></div><ChevronDown className="h-4 w-4"/></summary><div className="border-t p-4 text-sm"><p><b>Evidence:</b> {f.evidence}</p>{f.recommendation&&<p className="mt-2 rounded-xl bg-blue-50 p-3 text-blue-900"><b>Remediation:</b> {f.recommendation}</p>}</div></details>)}</div></section>}
    <section className="rounded-3xl border bg-white p-5 shadow-sm"><h3 className="mb-3 flex items-center gap-2 text-xl font-black"><History className="h-5 w-5"/> Security run history</h3><div className="divide-y">{runs.map(r=><button key={r.id} onClick={()=>open(r.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50"><div><b>{new Date(r.startedAtUtc).toLocaleString()}</b><p className="text-xs text-slate-500">{r.trigger} · {String(r.status).replaceAll("_"," ")}</p></div><span className="text-lg font-black">{r.score}%</span></button>)}{!runs.length&&!busy&&<p className="py-6 text-center text-slate-500">The first scheduled run has not completed yet. Run a check now to create the baseline.</p>}</div></section>
  </div>;
}

function Step({ number, title, description, active, done, icon: Icon }) { return <div className={`rounded-2xl border p-4 ${done ? "border-emerald-300 bg-emerald-50" : active ? "border-blue-400 bg-blue-50" : "bg-white"}`}><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 font-black text-white">{done ? <CheckCircle2 className="h-5 w-5" /> : number}</span><Icon className="h-5 w-5 text-slate-500" /><div><b>{title}</b><p className="text-xs text-slate-600">{description}</p></div></div></div>; }

function Report({ report, grouped, solution, onSolutions }) { return <section className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Health" value={`${report.healthScore}%`} /><Metric label="Passed" value={report.passedCount} color="text-emerald-700" /><Metric label="Warnings" value={report.warningCount} color="text-amber-700" /><Metric label="Defects" value={report.failedCount} color="text-red-700" /><Metric label="Status" value={String(report.status).replaceAll("_", " ")} small /></div><div className="flex justify-end gap-2"><button onClick={() => downloadJson(`mahima-qa-${report.id}.json`, report)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 font-bold"><Download className="h-4 w-4" /> Results</button><button onClick={onSolutions} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white"><Wrench className="h-4 w-4" /> Defects & fix plan</button></div>{grouped.map(([module, findings]) => <div key={module} className="overflow-hidden rounded-3xl border bg-white"><h3 className="border-b bg-slate-50 px-5 py-4 font-black uppercase">{module.replaceAll("_", " ")}</h3><div className="divide-y">{findings.map((item) => <div key={item.testKey} className="p-5"><div className="flex justify-between gap-3"><div><b>{item.title}</b><p className="mt-1 text-sm text-slate-600">{item.details}</p></div><span className={`h-fit rounded-full border px-3 py-1 text-xs font-black uppercase ${resultTone[item.status] || resultTone.warning}`}>{item.status}</span></div><div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><b>Evidence:</b> {item.evidence}</div>{item.recommendation && <div className="mt-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><b>Fix:</b> {item.recommendation}</div>}</div>)}</div></div>)}{solution && <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6"><div className="flex justify-between"><h2 className="text-xl font-black"><Wrench className="mr-2 inline h-5 w-5" />Defects and solution plan</h2><button onClick={() => downloadJson(`mahima-fix-plan-${report.id}.json`, solution)} className="font-bold text-blue-900">Download</button></div>{!solution.issues?.length ? <p className="mt-3 font-bold text-emerald-800">No defects found.</p> : <div className="mt-4 space-y-3">{solution.issues.map((item) => <div key={item.defectId} className="rounded-xl bg-white p-4"><b>{item.defectId} · [{item.severity}] {item.title}</b><p className="mt-2 text-sm"><b>Problem:</b> {item.problem}</p><p className="mt-1 text-sm text-blue-900"><b>Fix plan:</b> {item.solution}</p><p className="mt-1 text-xs text-slate-500">{item.verification}</p></div>)}</div>}</div>}</section>; }
function LoadMetrics({ metrics }) { if (!metrics) return null; return <section className="rounded-3xl border border-violet-200 bg-violet-50 p-6"><h2 className="text-xl font-black text-violet-950">End-to-end load results</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Requests/sec" value={metrics.requestsPerSecond} /><Metric label="Success" value={`${metrics.successRate}%`} /><Metric label="Average" value={`${metrics.averageMs} ms`} /><Metric label="P95" value={`${metrics.p95Ms} ms`} /><Metric label="Maximum" value={`${metrics.maxMs} ms`} /></div><p className="mt-3 text-sm text-violet-800">{metrics.requestCount} requests at concurrency {metrics.concurrency} against {metrics.path}.</p></section>; }
function ImpactSummary({ solution }) { const issues = (solution?.issues || []).filter((item) => item.impact); if (!issues.length) return null; return <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-xl font-black text-amber-950">Fix impact assessment</h2><div className="mt-4 space-y-3">{issues.map((item) => <div key={item.defectId} className="rounded-xl bg-white p-4"><b>{item.defectId} · {item.title}</b><p className="mt-2 text-sm text-amber-950">{item.impact}</p></div>)}</div></section>; }
function Metric({ label, value, color = "text-slate-900", small }) { return <div className="rounded-2xl border bg-white p-4"><div className="text-xs font-black uppercase text-slate-500">{label}</div><div className={`mt-2 font-black capitalize ${small ? "text-lg" : "text-3xl"} ${color}`}>{value}</div></div>; }
