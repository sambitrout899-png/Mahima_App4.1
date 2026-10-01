import api from "../api";

async function unwrap(response, fallbackMessage = "Request failed.") {
  if (!response?.ok) {
    const rawMessage = response?.error || response?.statusText;
    const message = typeof rawMessage === "string" && rawMessage.trim() && !/^\d{3}$/.test(rawMessage.trim())
      ? rawMessage
      : fallbackMessage;
    const error = new Error(message);
    error.status = response?.status;
    throw error;
  }
  return response.data;
}

export async function listTenants() {
  const data = await unwrap(await api.get("/platform/tenants"), "Could not load tenants.");
  return Array.isArray(data) ? data : [];
}

export async function getTenantEntitlements(tenantId) {
  const data = await unwrap(
    await api.get(`/platform/tenants/${encodeURIComponent(tenantId)}/entitlements`),
    "Could not load tenant entitlements."
  );
  return data || { modules: [] };
}

export async function listModuleRequests(params = {}) {
  const data = await unwrap(
    await api.get("/platform/module-requests", { params }),
    "Could not load subscription requests."
  );
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createTenant(payload) {
  const data = await unwrap(await api.post("/platform/tenants", payload), "Could not create tenant.");
  return data;
}

export async function updateTenantProfile(tenantId, payload = {}) {
  const data = await unwrap(
    await api.put(`/platform/tenants/${encodeURIComponent(tenantId)}`, payload),
    "Could not update tenant profile."
  );
  return data;
}

export async function verifyTenantDomain(tenantId) {
  const data = await unwrap(
    await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/domain/verify`, {}),
    "Could not verify tenant domain."
  );
  return data;
}

export async function listModules() {
  const data = await unwrap(await api.get("/platform/modules"), "Could not load modules.");
  return Array.isArray(data) ? data : [];
}

export async function upsertModule(payload) {
  const data = await unwrap(await api.post("/platform/modules", payload), "Could not save module.");
  return data;
}

export async function listPackages() {
  const data = await unwrap(await api.get("/platform/packages"), "Could not load packages.");
  return Array.isArray(data) ? data : [];
}

export async function listPackagePages() {
  const data = await unwrap(await api.get("/platform/package-pages"), "Could not load package pages.");
  return Array.isArray(data) ? data : [];
}

export async function savePackage(payload) {
  return await unwrap(await api.post("/platform/packages", payload), "Could not save package.");
}

export async function publishPackage(packageId, payload = {}) {
  return await unwrap(
    await api.post(`/platform/packages/${encodeURIComponent(packageId)}/publish`, payload),
    "Could not publish package."
  );
}

export async function deleteDraftPackage(packageId) {
  return await unwrap(await api.delete(`/platform/packages/${encodeURIComponent(packageId)}`), "Could not delete package.");
}

export async function expirePackage(packageId) {
  return await unwrap(await api.post(`/platform/packages/${encodeURIComponent(packageId)}/expire`, {}), "Could not expire package.");
}

export async function reopenPackageDraft(packageId) {
  return await unwrap(await api.post(`/platform/packages/${encodeURIComponent(packageId)}/new-draft`, {}), "Could not open the next draft.");
}

export async function decideCurrentPackageVersion(packageId, version, accept) {
  return await unwrap(
    await api.post(`/tenants/current/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}/decision?accept=${accept}`, {}),
    "Could not save the package-version decision."
  );
}

export async function submitPackagePaymentRequest(packageId, payload) {
  return await unwrap(
    await api.post(`/tenants/current/packages/${encodeURIComponent(packageId)}/payment-requests`, payload),
    "Could not submit the add-on donation transaction."
  );
}

export async function listPackagePaymentRequests(params = {}) {
  const data = await unwrap(
    await api.get("/platform/package-payment-requests", { params }),
    "Could not load add-on payment requests."
  );
  return Array.isArray(data) ? data : [];
}

export async function approvePackagePaymentRequest(requestId, payload = {}) {
  return await unwrap(
    await api.post(`/platform/package-payment-requests/${encodeURIComponent(requestId)}/approve`, payload),
    "Could not approve the add-on payment."
  );
}

export async function rejectPackagePaymentRequest(requestId, payload = {}) {
  return await unwrap(
    await api.post(`/platform/package-payment-requests/${encodeURIComponent(requestId)}/reject`, payload),
    "Could not reject the add-on payment."
  );
}

export async function changeCurrentSubscription(subscriptionId, action, targetPlanId = null) {
  return await unwrap(
    await api.post(`/tenants/current/subscriptions/${encodeURIComponent(subscriptionId)}/action`, { action, targetPlanId }),
    "Could not change the subscription."
  );
}

export async function activateTenantPackage(tenantId, packageId) {
  return await unwrap(
    await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/packages/${encodeURIComponent(packageId)}/activate`, {}),
    "Could not activate package for tenant."
  );
}

export async function activateModule(tenantId, moduleCode, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/platform/tenants/${encodeURIComponent(tenantId)}/modules/${encodeURIComponent(moduleCode)}/activate`,
      payload
    ),
    "Could not activate module."
  );
  return data;
}

export async function approveModuleRequest(requestId, payload = {}) {
  const data = await unwrap(
    await api.post(`/platform/module-requests/${encodeURIComponent(requestId)}/approve`, payload),
    "Could not approve subscription request."
  );
  return data;
}

export async function rejectModuleRequest(requestId, payload = {}) {
  const data = await unwrap(
    await api.post(`/platform/module-requests/${encodeURIComponent(requestId)}/reject`, payload),
    "Could not reject subscription request."
  );
  return data;
}

export async function revokeModule(tenantId, moduleCode, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/platform/tenants/${encodeURIComponent(tenantId)}/modules/${encodeURIComponent(moduleCode)}/revoke`,
      payload
    ),
    "Could not revoke module."
  );
  return data;
}

export async function updateTenantStatus(tenantId, payload = {}) {
  const data = await unwrap(
    await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/status`, payload),
    "Could not update tenant status."
  );
  return data;
}

export async function createTenantAdminUser(tenantId, payload = {}) {
  const data = await unwrap(
    await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/admins`, payload),
    "Could not create tenant admin user."
  );
  return data;
}

export async function resetTenantAdminPassword(tenantId, userId, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/platform/tenants/${encodeURIComponent(tenantId)}/admins/${encodeURIComponent(userId)}/reset-password`,
      payload
    ),
    "Could not reset tenant admin password."
  );
  return data;
}

export async function createModulePaymentIntent(tenantId, moduleCode, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/billing/tenants/${encodeURIComponent(tenantId)}/modules/${encodeURIComponent(moduleCode)}/payment-intents`,
      payload
    ),
    "Could not create donation."
  );
  return data;
}

export async function createCurrentTenantModulePaymentIntent(moduleCode, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/billing/tenants/current/modules/${encodeURIComponent(moduleCode)}/payment-intents`,
      payload
    ),
    "Could not create donation."
  );
  return data;
}

export async function verifyModuleRazorpayPayment(paymentIntentId, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/billing/payment-intents/${encodeURIComponent(paymentIntentId)}/razorpay-verify`,
      payload
    ),
    "Could not verify payment."
  );
  return data;
}

export async function markPaymentPaid(paymentIntentId, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/billing/payment-intents/${encodeURIComponent(paymentIntentId)}/mark-paid`,
      payload
    ),
    "Could not confirm payment."
  );
  return data;
}

export async function submitDonationDetails(paymentIntentId, payload = {}) {
  const data = await unwrap(
    await api.post(
      `/billing/payment-intents/${encodeURIComponent(paymentIntentId)}/donation-details`,
      payload
    ),
    "Could not submit donation details."
  );
  return data;
}

export async function listBillingInvoices(params = {}) {
  const data = await unwrap(
    await api.get("/billing/invoices", { params }),
    "Could not load invoices."
  );
  return data || { summary: {}, items: [] };
}

export async function listCurrentTenantBillingInvoices(params = {}) {
  const data = await unwrap(
    await api.get("/billing/tenants/current/invoices", { params }),
    "Could not load church invoices."
  );
  return data || { items: [] };
}

export async function generateBillingInvoices(payload = {}) {
  const data = await unwrap(
    await api.post("/billing/invoices/generate", payload),
    "Could not generate invoices."
  );
  return data;
}

export async function deleteBillingInvoicePeriod(payload = {}) {
  return await unwrap(
    await api.post("/billing/invoices/delete-period", payload),
    "Could not delete invoices for the selected period."
  );
}

export async function deleteTenantBilling(payload = {}) {
  return await unwrap(
    await api.post("/billing/invoices/delete-tenant", payload),
    "Could not delete tenant billing."
  );
}

export async function deleteBillingInvoice(invoiceId) {
  return await unwrap(
    await api.delete(`/billing/invoices/${encodeURIComponent(invoiceId)}`),
    "Could not delete invoice."
  );
}

export async function purgeTenant(tenantId, confirmSlug) {
  return await unwrap(
    await api.delete(`/platform/tenants/${encodeURIComponent(tenantId)}/purge`, {
      params: { confirm: confirmSlug },
    }),
    "Could not permanently delete tenant."
  );
}

export async function getBillingSettings() {
  return await unwrap(await api.get("/billing/settings"), "Could not load billing settings.");
}

export async function saveBillingSettings(payload = {}) {
  return await unwrap(await api.put("/billing/settings", payload), "Could not save billing settings.");
}

export async function applyBillingInvoicePayment(invoiceId, payload = {}) {
  const data = await unwrap(
    await api.post(`/billing/invoices/${encodeURIComponent(invoiceId)}/payments`, payload),
    "Could not apply invoice payment."
  );
  return data;
}

// Live/published snapshot — read-only reference (e.g. "what's currently live" in the editor).
export async function getTenantLanding() {
  const data = await unwrap(await api.get("/tenant-admin/landing"), "Could not load landing page.");
  return data || {};
}

// Branding — logo/colors/fonts/contact/social. Saves immediately, shared with Print Templates.
export async function getTenantBranding() {
  const data = await unwrap(await api.get("/tenant-admin/branding"), "Could not load branding.");
  return data || {};
}

export async function saveTenantBranding(payload) {
  return await unwrap(await api.put("/tenant-admin/branding", payload), "Could not save branding.");
}

// Draft — every content edit lands here first; never touches the live public page.
export async function getTenantLandingDraft() {
  const data = await unwrap(await api.get("/tenant-admin/landing/draft"), "Could not load landing draft.");
  return data || {};
}

export async function saveTenantLandingDraft(payload) {
  return await unwrap(await api.put("/tenant-admin/landing/draft", payload), "Could not save landing draft.");
}

export async function publishTenantLanding() {
  return await unwrap(await api.post("/tenant-admin/landing/publish", {}), "Could not publish the landing page.");
}

export async function setTenantLandingVisibility(published) {
  return await unwrap(await api.put("/tenant-admin/landing/visibility", { published }), "Could not update site visibility.");
}

export async function getTenantLandingVersions() {
  const data = await unwrap(await api.get("/tenant-admin/landing/versions"), "Could not load version history.");
  return Array.isArray(data) ? data : [];
}

export async function restoreTenantLandingVersion(versionId) {
  return await unwrap(await api.post(`/tenant-admin/landing/versions/${encodeURIComponent(versionId)}/restore`, {}), "Could not restore that version.");
}

export async function getTenantPrintTemplate() {
  return await unwrap(await api.get("/tenant-admin/print-template"), "Could not load print template.");
}

export async function saveTenantPrintTemplate(payload) {
  return await unwrap(await api.put("/tenant-admin/print-template", payload), "Could not save print template.");
}
