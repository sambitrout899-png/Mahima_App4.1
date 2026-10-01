import React, { useEffect, useMemo, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { listTenants } from "../../api/multiTenantApi";
import AdminDashboard from "./AdminDashboard";
import TenantStorageUsage from "../../components/TenantStorageUsage";

function tenantLabel(tenant) {
  const name = tenant?.name || tenant?.Name || "Tenant";
  const slug = tenant?.slug || tenant?.Slug || "";
  return slug ? `${name} (${slug})` : name;
}

function tenantIdOf(tenant) {
  return tenant?.id || tenant?.Id || tenant?.tenantId || tenant?.TenantId || "";
}

export default function TenantDashboardPage() {
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [error, setError] = useState("");

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => String(tenantIdOf(tenant)) === String(selectedTenantId)),
    [selectedTenantId, tenants]
  );

  async function loadTenants() {
    setLoadingTenants(true);
    setError("");
    try {
      const rows = await listTenants();
      setTenants(rows);
      setSelectedTenantId((current) => current || tenantIdOf(rows[0]) || "");
    } catch (err) {
      setError(err?.message || "Could not load tenants.");
    } finally {
      setLoadingTenants(false);
    }
  }

  useEffect(() => {
    loadTenants();
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <div className="border-b border-slate-200 bg-white px-5 lg:px-8 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight">All Tenant Dashboards</h1>
              <p className="text-xs font-semibold text-slate-500">
                Mahima super admin view. Select a church tenant to see that tenant's Admin Dashboard stats and data.
              </p>
            </div>
          </div>

          <div className="flex min-w-[280px] flex-wrap items-center gap-2">
            <select
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
              className="min-h-[40px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              disabled={loadingTenants}
            >
              {tenants.map((tenant) => {
                const id = tenantIdOf(tenant);
                return (
                  <option key={id} value={id}>
                    {tenantLabel(tenant)}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={loadTenants}
              disabled={loadingTenants}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loadingTenants ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
      </div>

      {selectedTenantId && <div className="px-5 pt-5"><TenantStorageUsage tenantId={selectedTenantId} /></div>}
      {selectedTenantId ? (
        <AdminDashboard
          key={selectedTenantId}
          tenantId={selectedTenantId}
          tenantName={tenantLabel(selectedTenant)}
          title="All Tenant Dashboards"
        />
      ) : (
        <div className="p-6 text-sm font-semibold text-slate-500">
          {loadingTenants ? "Loading tenants..." : "No tenants found."}
        </div>
      )}
    </main>
  );
}
