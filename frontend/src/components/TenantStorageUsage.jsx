import React, { useEffect, useState } from "react";
import api from "../api";

const gb = (bytes) => (Number(bytes || 0) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function TenantStorageUsage({ tenantId }) {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setUsage(null);
    setError("");
    const url = tenantId ? `/platform/tenants/${encodeURIComponent(tenantId)}/storage` : "/tenants/current/storage";
    api.get(url).then((result) => {
      if (!active) return;
      if (!result.ok) throw new Error("Storage usage is unavailable. Contact your administrator.");
      setUsage(result.data);
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [tenantId, revision]);
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Tenant storage usage">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Data growth & storage</h2>
      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => setRevision((n) => n + 1)}>Refresh usage</button></div>
    {error ? <p role="alert" className="mt-3 text-rose-700">{error}</p> : !usage ? <p className="mt-3">Loading storage usage…</p> : <>
      <p className="mt-3 font-semibold">{gb(usage.usedBytes)} GB used / {gb(usage.limitBytes)} GB included {usage.exempt ? "— root tenant exempt" : `(${usage.percentUsed}%)`}</p>
      <progress className="mt-3 h-3 w-full" max="100" value={Math.min(100, usage.percentUsed)} aria-label="Storage allowance used" />
      <p className="mt-2 text-sm text-slate-600">Database content: {gb(usage.databaseBytes)} GB · Files: {gb(usage.fileBytes)} GB</p>
      {["warning", "critical", "limit_reached"].includes(usage.status) && <p role="alert" className="mt-3 font-semibold text-amber-800">{usage.status === "limit_reached" ? "Allowance reached. New data growth is blocked. Delete unused data or upgrade your package." : "Storage is running low. Delete unused data or upgrade your package."}</p>}
      <p className="mt-2 text-xs text-slate-500">{usage.filesMeasuredAt ? `Files last measured: ${new Date(usage.filesMeasuredAt).toLocaleString()}.` : "Initial file measurement is pending; totals are incomplete."} Database content is measured as logical data; shared database overhead and external storage are excluded.</p>
      {usage.recentAlerts?.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Recent storage alerts</summary><ul className="mt-2 space-y-2">{usage.recentAlerts.map((alert, index) => <li key={`${alert.createdAt}-${index}`}>{new Date(alert.createdAt).toLocaleString()} — {alert.message}</li>)}</ul></details>}
    </>}
  </section>;
}
