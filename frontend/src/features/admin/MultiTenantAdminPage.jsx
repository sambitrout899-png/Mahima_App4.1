import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Link as LinkIcon,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  UserPlus,
  UsersRound,
  Trash2,
} from "lucide-react";
import {
  activateModule,
  approveModuleRequest,
  createTenantAdminUser,
  createModulePaymentIntent,
  deleteTenantBilling,
  deleteDraftPackage,
  expirePackage,
  getTenantEntitlements,
  listModuleRequests,
  listModules,
  listPackages,
  listPackagePages,
  listPackagePaymentRequests,
  listTenants,
  markPaymentPaid,
  purgeTenant,
  rejectModuleRequest,
  resetTenantAdminPassword,
  revokeModule,
  savePackage,
  publishPackage,
  reopenPackageDraft,
  activateTenantPackage,
  approvePackagePaymentRequest,
  rejectPackagePaymentRequest,
  upsertModule,
  updateTenantProfile,
  updateTenantStatus,
} from "../../api/multiTenantApi";
import TenantLogo from "../../components/TenantLogo";

const blankTenantEdit = {
  name: "",
  slug: "",
  domain: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  countryCode: "IN",
  userCodePrefix: "",
  whatsAppUserNotificationTemplateSid: "",
  whatsAppMarketingTemplateSid: "",
  logoFile: null,
  existingLogoUrl: "",
};

const blankAdminCreate = {
  username: "",
  displayName: "",
  email: "",
  phone: "",
  password: "NewPass@123",
  note: "",
  approvedBy: "",
};

const blankPackage = {
  id: null, code: "", name: "", description: "", monthlyPriceInr: "",
  enabled: true, displayOrder: 0, moduleCodes: [], pageKeys: [],
  contractMonths: 12, earlyExitPenaltyPercent: 10,
  isBaseFreePlan: false, storageLimitGb: 10, aiTokensIncludedMonthly: 0,
  storageOveragePricePerGbInr: 49, aiOveragePricePerMillionTokensInr: 0,
  aiCreditsIncludedInr: 0, aiOverageMarkupMultiplier: 2.5,
};

const blankModuleEdit = {
  code: "", name: "", description: "", monthlyPriceInr: "",
  isBaseModule: false, enabled: true, displayOrder: 0,
};

function tenantLoginUrl(tenant) {
  if (!tenant) return "https://beta.mahimaministries.in/#/login";
  const slug = tenant.slug || tenant.Slug || "";
  if (slug) {
    return `${window.location.origin}${window.location.pathname || "/"}#/login?tenantSlug=${encodeURIComponent(slug)}`;
  }
  return tenant.loginUrl || tenant.LoginUrl || "https://beta.mahimaministries.in/#/login";
}

export default function MultiTenantAdminPage() {
  const [tenants, setTenants] = useState([]);
  const [modules, setModules] = useState([]);
  const [packages, setPackages] = useState([]);
  const [packagePages, setPackagePages] = useState([]);
  const [packageDraft, setPackageDraft] = useState(blankPackage);
  const [moduleEdit, setModuleEdit] = useState(blankModuleEdit);
  const [moduleRequests, setModuleRequests] = useState([]);
  const [packagePaymentRequests, setPackagePaymentRequests] = useState([]);
  const [entitlementModules, setEntitlementModules] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingEntitlements, setLoadingEntitlements] = useState(false);
  const [message, setMessage] = useState("");
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantEdit, setTenantEdit] = useState(blankTenantEdit);
  const [paymentIntent, setPaymentIntent] = useState(null);
  const [statusAction, setStatusAction] = useState({
    status: "active",
    reason: "",
    approvedBy: "",
  });
  const [passwordReset, setPasswordReset] = useState({
    userId: "",
    password: "NewPass@123",
    note: "",
    approvedBy: "",
  });
  const [adminCreate, setAdminCreate] = useState(blankAdminCreate);
  const [manualOverride, setManualOverride] = useState({
    moduleCode: "",
    receiptNumber: "",
    note: "",
    approvedBy: "",
    endsAtUtc: "",
  });
  const [revokeForm, setRevokeForm] = useState({
    moduleCode: "",
    note: "",
    approvedBy: "",
  });
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [usageProjection, setUsageProjection] = useState({ storageGb: 10, aiProviderCostInr: 0 });

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => String(tenant.id) === String(selectedTenantId)),
    [selectedTenantId, tenants]
  );

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((tenant) =>
      [tenant.name, tenant.slug, tenant.domain, tenant.contactEmail]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [tenantSearch, tenants]);

  const tenantStats = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter((tenant) => normalizeStatus(tenant.status) === "active").length;
    const blocked = tenants.filter((tenant) => ["blocked", "suspended", "expired"].includes(normalizeStatus(tenant.status))).length;
    const users = tenants.reduce((sum, tenant) => sum + Number(tenant.userCounts?.total || tenant.UserCounts?.Total || 0), 0);
    return { total, active, blocked, users };
  }, [tenants]);

  const projectedOverage = useMemo(() => {
    const excessStorageGb = Math.max(0, Number(usageProjection.storageGb || 0) - Number(packageDraft.storageLimitGb || 0));
    const excessAiCost = Math.max(0, Number(usageProjection.aiProviderCostInr || 0) - Number(packageDraft.aiCreditsIncludedInr || 0));
    const storageCharge = excessStorageGb * Number(packageDraft.storageOveragePricePerGbInr || 0);
    const aiCharge = excessAiCost * Number(packageDraft.aiOverageMarkupMultiplier || 2.5);
    return { excessStorageGb, excessAiCost, total: storageCharge + aiCharge };
  }, [packageDraft, usageProjection]);

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const [tenantList, moduleList, requestList, packageList, pageList, paymentRequestList] = await Promise.all([
        listTenants(),
        listModules(),
        listModuleRequests({ status: "pending", limit: 20 }),
        listPackages(),
        listPackagePages(),
        listPackagePaymentRequests({ status: "pending" }),
      ]);
      setTenants(tenantList);
      setModules(moduleList);
      setModuleRequests(requestList);
      setPackages(packageList);
      setPackagePages(pageList);
      setPackagePaymentRequests(paymentRequestList);
      if (!selectedTenantId && tenantList[0]?.id) setSelectedTenantId(tenantList[0].id);
    } catch (error) {
      setMessage(error?.message || "Could not load multi-tenant setup.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function reviewAddOnPayment(request, approve) {
    const action = approve ? "approve" : "reject";
    if (!window.confirm(`${action === "approve" ? "Approve" : "Reject"} ${request.planName} payment from ${request.tenantName}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = approve
        ? await approvePackagePaymentRequest(request.id, { note: "Verified by SambitR" })
        : await rejectPackagePaymentRequest(request.id, { note: "Rejected by SambitR" });
      await load();
      setMessage(approve
        ? `${request.planName} payment approved and add-on activated for ${request.tenantName}.${result.tenantEmailSent ? " Tenant admin email sent." : " Tenant admin email could not be sent; the on-screen status is updated."}`
        : `${request.planName} payment rejected for ${request.tenantName}.${result.tenantEmailSent ? " Tenant admin email sent." : " Tenant admin email could not be sent; the on-screen status is updated."}`);
    } catch (error) {
      setMessage(error?.message || `Could not ${action} payment request.`);
    } finally {
      setBusy(false);
    }
  }

  function editPackage(item) {
    setPackageDraft({
      id: item.id,
      code: item.code || "",
      name: item.name || "",
      description: item.description || "",
      monthlyPriceInr: String(item.monthlyPriceInr ?? ""),
      enabled: item.enabled !== false,
      displayOrder: Number(item.displayOrder || 0),
      moduleCodes: Array.isArray(item.moduleCodes) ? item.moduleCodes : [],
      pageKeys: Array.isArray(item.pageKeys) && item.pageKeys.length
        ? item.pageKeys
        : packagePages.filter((page) => (item.moduleCodes || []).includes(page.moduleCode)).map((page) => page.key),
      contractMonths: Number(item.contractMonths || 12),
      earlyExitPenaltyPercent: Number(item.earlyExitPenaltyPercent ?? 10),
      isBaseFreePlan: Boolean(item.isBaseFreePlan),
      storageLimitGb: Number(item.storageLimitGb ?? 10),
      aiTokensIncludedMonthly: Number(item.aiTokensIncludedMonthly || 0),
      storageOveragePricePerGbInr: Number(item.storageOveragePricePerGbInr || 0),
      aiOveragePricePerMillionTokensInr: Number(item.aiOveragePricePerMillionTokensInr || 0),
      aiCreditsIncludedInr: Number(item.aiCreditsIncludedInr || 0),
      aiOverageMarkupMultiplier: Number(item.aiOverageMarkupMultiplier || 2.5),
    });
  }

  function startModuleEdit(module) {
    setModuleEdit({
      code: module.code || "",
      name: module.name || "",
      description: module.description || "",
      monthlyPriceInr: String(module.monthlyPriceInr ?? ""),
      isBaseModule: Boolean(module.isBaseModule),
      enabled: module.enabled !== false,
      displayOrder: Number(module.displayOrder || 0),
    });
  }

  async function submitModuleEdit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const saved = await upsertModule({
        ...moduleEdit,
        monthlyPriceInr: Number(moduleEdit.monthlyPriceInr || 0),
        displayOrder: Number(moduleEdit.displayOrder || 0),
      });
      setModules((current) => current
        .map((module) => module.code === saved.code ? { ...module, ...saved } : module)
        .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)));
      setEntitlementModules((current) => current
        .map((module) => module.code === saved.code ? { ...module, ...saved } : module)
        .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)));
      setModuleEdit(blankModuleEdit);
      setMessage(`${saved.name} updated successfully.`);
    } catch (error) {
      setMessage(error?.message || "Could not update package.");
    } finally {
      setBusy(false);
    }
  }

  function togglePackageModule(code) {
    setPackageDraft((current) => ({
      ...current,
      moduleCodes: current.moduleCodes.includes(code)
        ? current.moduleCodes.filter((item) => item !== code)
        : [...current.moduleCodes, code],
      pageKeys: current.moduleCodes.includes(code)
        ? current.pageKeys.filter((key) => packagePages.find((page) => page.key === key)?.moduleCode !== code)
        : [...new Set([
            ...current.pageKeys,
            ...packagePages.filter((page) => page.moduleCode === code).map((page) => page.key),
          ])],
    }));
  }

  function togglePackagePage(key) {
    setPackageDraft((current) => ({
      ...current,
      pageKeys: current.pageKeys.includes(key)
        ? current.pageKeys.filter((item) => item !== key)
        : [...current.pageKeys, key],
    }));
  }

  async function submitPackage(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await savePackage({
        ...packageDraft,
        monthlyPriceInr: Number(packageDraft.monthlyPriceInr || 0),
        storageLimitGb: Number(packageDraft.storageLimitGb || 0),
        aiTokensIncludedMonthly: Number(packageDraft.aiTokensIncludedMonthly || 0),
        storageOveragePricePerGbInr: Number(packageDraft.storageOveragePricePerGbInr || 0),
        aiOveragePricePerMillionTokensInr: Number(packageDraft.aiOveragePricePerMillionTokensInr || 0),
        aiCreditsIncludedInr: Number(packageDraft.aiCreditsIncludedInr || 0),
        aiOverageMarkupMultiplier: Number(packageDraft.aiOverageMarkupMultiplier || 2.5),
      });
      setPackageDraft(blankPackage);
      await load();
      setMessage("Package draft saved. Publish it when the definition is ready.");
    } catch (error) {
      setMessage(error?.message || "Could not save package.");
    } finally {
      setBusy(false);
    }
  }

  async function publishPackageNow(item) {
    setBusy(true);
    setMessage("");
    try {
      const result = await publishPackage(item.id, { effectiveAtUtc: new Date().toISOString() });
      await load();
      setMessage(`Published ${item.name} v${result.version}; ${result.tenantsNotified} existing tenant(s) invited to approve the update.`);
    } catch (error) {
      setMessage(error?.message || "Could not publish package.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePackageDraft(item) {
    if (!window.confirm(`Delete ${item.lifecycleStatus === "expired" ? "expired package" : "unreleased draft"} "${item.name}"? It will be removed from the catalog. Billing history will be retained.`)) return;
    setBusy(true);
    try {
      await deleteDraftPackage(item.id);
      if (packageDraft.id === item.id) setPackageDraft(blankPackage);
      await load();
      setMessage(`${item.name} deleted.`);
    } catch (error) {
      setMessage(error?.message || "Could not delete package.");
    } finally {
      setBusy(false);
    }
  }

  async function expirePublishedPackage(item) {
    if (!window.confirm(`Expire ${item.name} v${item.publishedVersion}? This package will become unavailable to all tenants, including existing subscribers.`)) return;
    setBusy(true);
    try {
      await expirePackage(item.id);
      await load();
      setMessage(`${item.name} expired and is unavailable to all tenants.`);
    } catch (error) {
      setMessage(error?.message || "Could not expire package.");
    } finally {
      setBusy(false);
    }
  }

  async function openNextPackageDraft(item) {
    setBusy(true);
    try {
      await reopenPackageDraft(item.id);
      await load();
      editPackage({ ...item, lifecycleStatus: "draft" });
      setMessage(`${item.name} v${item.publishedVersion + 1} is now a draft.`);
    } catch (error) {
      setMessage(error?.message || "Could not open the next draft.");
    } finally {
      setBusy(false);
    }
  }

  async function activateSelectedPackage(item) {
    if (!selectedTenantId) return;
    setBusy(true);
    setMessage("");
    try {
      await activateTenantPackage(selectedTenantId, item.id);
      setMessage(`${item.name} activated for ${selectedTenant?.name || "tenant"}.`);
      const entitlements = await getTenantEntitlements(selectedTenantId);
      setEntitlementModules(entitlements.modules || []);
    } catch (error) {
      setMessage(error?.message || "Could not activate package.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedTenantId) {
      setEntitlementModules([]);
      return;
    }

    let cancelled = false;
    async function loadEntitlements() {
      setLoadingEntitlements(true);
      try {
        const entitlements = await getTenantEntitlements(selectedTenantId);
        if (!cancelled) setEntitlementModules(entitlements.modules || []);
      } catch (error) {
        if (!cancelled) setMessage(error?.message || "Could not load tenant module status.");
      } finally {
        if (!cancelled) setLoadingEntitlements(false);
      }
    }

    loadEntitlements();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  useEffect(() => {
    if (!selectedTenant) return;
    setCleanupConfirmation("");
    setStatusAction({
      status: normalizeStatus(selectedTenant.status) || "active",
      reason: "",
      approvedBy: "",
    });
    setPasswordReset({
      userId: "",
      password: "NewPass@123",
      note: "",
      approvedBy: "",
    });
    setAdminCreate(blankAdminCreate);
    setTenantEdit({
      name: selectedTenant.name || selectedTenant.Name || "",
      slug: selectedTenant.slug || selectedTenant.Slug || "",
      domain: selectedTenant.domain || selectedTenant.Domain || "",
      contactName: selectedTenant.contactName || selectedTenant.ContactName || "",
      contactEmail: selectedTenant.contactEmail || selectedTenant.ContactEmail || "",
      contactPhone: selectedTenant.contactPhone || selectedTenant.ContactPhone || "",
      countryCode: selectedTenant.countryCode || selectedTenant.CountryCode || "IN",
      userCodePrefix: selectedTenant.userCodePrefix || selectedTenant.UserCodePrefix || "",
      whatsAppUserNotificationTemplateSid:
        selectedTenant.whatsAppUserNotificationTemplateSid || selectedTenant.WhatsAppUserNotificationTemplateSid || "",
      whatsAppMarketingTemplateSid:
        selectedTenant.whatsAppMarketingTemplateSid || selectedTenant.WhatsAppMarketingTemplateSid || "",
      logoFile: null,
      existingLogoUrl: selectedTenant.logoUrl || selectedTenant.LogoUrl || "",
    });
  }, [selectedTenant?.id, selectedTenant?.status]);

  async function deleteSelectedTenantBilling() {
    if (!selectedTenant || cleanupConfirmation !== selectedTenant.slug) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteTenantBilling({ tenantId: selectedTenant.id });
      setMessage(`Deleted ${result?.deleted ?? 0} billing invoice(s) for ${selectedTenant.name}.`);
      setCleanupConfirmation("");
    } catch (error) {
      setMessage(error?.message || "Could not delete tenant billing.");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteSelectedTenant() {
    if (!selectedTenant || cleanupConfirmation !== selectedTenant.slug) return;
    setBusy(true);
    setMessage("");
    try {
      const deletedName = selectedTenant.name;
      await purgeTenant(selectedTenant.id, cleanupConfirmation);
      setSelectedTenantId("");
      setCleanupConfirmation("");
      await load();
      setMessage(`${deletedName} and all tenant data were permanently deleted.`);
    } catch (error) {
      setMessage(error?.message || "Could not permanently delete tenant.");
    } finally {
      setBusy(false);
    }
  }

  function updateTenantEditField(key, value) {
    setTenantEdit((current) => ({
      ...current,
      [key]: key === "userCodePrefix"
        ? String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
        : key === "slug"
          ? slugify(value)
          : value,
    }));
  }

  async function submitTenantProfile(event) {
    event.preventDefault();
    if (!selectedTenantId || !selectedTenant) return;
    if (!tenantEdit.name.trim()) {
      setMessage("Tenant name is required.");
      return;
    }
    if (!tenantEdit.userCodePrefix.trim()) {
      setMessage("User code prefix is required.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const payload = new FormData();
      payload.append("name", tenantEdit.name.trim());
      payload.append("slug", tenantEdit.slug.trim());
      payload.append("domain", tenantEdit.domain.trim());
      payload.append("contactName", tenantEdit.contactName.trim());
      payload.append("contactEmail", tenantEdit.contactEmail.trim());
      payload.append("contactPhone", tenantEdit.contactPhone.trim());
      payload.append("countryCode", tenantEdit.countryCode || "IN");
      payload.append("userCodePrefix", tenantEdit.userCodePrefix.trim());
      payload.append("whatsAppUserNotificationTemplateSid", tenantEdit.whatsAppUserNotificationTemplateSid.trim());
      payload.append("whatsAppMarketingTemplateSid", tenantEdit.whatsAppMarketingTemplateSid.trim());
      if (tenantEdit.logoFile) payload.append("logo", tenantEdit.logoFile);
      const result = await updateTenantProfile(selectedTenantId, payload);
      setMessage(`Updated tenant ${result.name || tenantEdit.name}.`);
      await load();
      setSelectedTenantId(result.id || selectedTenantId);
    } catch (error) {
      setMessage(error?.message || "Could not update tenant profile.");
    } finally {
      setBusy(false);
    }
  }

  async function startPayment(moduleCode) {
    if (!selectedTenantId) return;
    setBusy(true);
    setMessage("");
    try {
      const intent = await createModulePaymentIntent(selectedTenantId, moduleCode, {
        provider: "razorpay",
      });
      setPaymentIntent(intent);
      setMessage(intent.status === "activated" ? "Free module activated." : "Payment intent created.");
      if (intent.razorpayOrderId && intent.razorpayKeyId) {
        await openRazorpayCheckout(intent);
      }
      if (intent.status === "activated") {
        const entitlements = await getTenantEntitlements(selectedTenantId);
        setEntitlementModules(entitlements.modules || []);
      }
    } catch (error) {
      setMessage(error?.message || "Could not create payment intent.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    if (!paymentIntent?.id) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await markPaymentPaid(paymentIntent.id, {
        providerPaymentId: `manual-${Date.now()}`,
        payloadJson: JSON.stringify({ source: "admin-confirmed-upi" }),
      });
      setMessage(`Payment marked paid. Module ${result.activatedModule} activated.`);
      setPaymentIntent(null);
      const entitlements = await getTenantEntitlements(selectedTenantId);
      setEntitlementModules(entitlements.modules || []);
    } catch (error) {
      setMessage(error?.message || "Could not activate payment.");
    } finally {
      setBusy(false);
    }
  }

  function updateManualOverride(moduleCode, key, value) {
    setManualOverride((current) => ({
      moduleCode,
      receiptNumber: current.moduleCode === moduleCode ? current.receiptNumber : "",
      note: current.moduleCode === moduleCode ? current.note : "",
      approvedBy: current.moduleCode === moduleCode ? current.approvedBy : "",
      endsAtUtc: current.moduleCode === moduleCode ? current.endsAtUtc : "",
      [key]: value,
    }));
  }

  async function submitManualOverride(module) {
    if (!selectedTenantId || !module?.code) return;
    const receiptNumber = manualOverride.moduleCode === module.code ? manualOverride.receiptNumber.trim() : "";
    const note = manualOverride.moduleCode === module.code ? manualOverride.note.trim() : "";
    const approvedBy = manualOverride.moduleCode === module.code ? manualOverride.approvedBy.trim() : "";
    const endsAtUtc = manualOverride.moduleCode === module.code ? manualOverride.endsAtUtc : "";

    if (!receiptNumber && !note && !approvedBy) {
      setMessage("Enter a receipt number, special note, or approver before overriding payment.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = await activateModule(selectedTenantId, module.code, {
        priceInr: 0,
        source: "admin_override",
        receiptNumber,
        note,
        approvedBy,
        endsAtUtc: endsAtUtc ? new Date(endsAtUtc).toISOString() : null,
      });
      setMessage(`Admin override activated ${result.moduleCode || module.code}${endsAtUtc ? ` until ${new Date(endsAtUtc).toLocaleString()}` : ""}. Receipt: ${receiptNumber || "not entered"}.`);
      setManualOverride({ moduleCode: "", receiptNumber: "", note: "", approvedBy: "", endsAtUtc: "" });
      const entitlements = await getTenantEntitlements(selectedTenantId);
      setEntitlementModules(entitlements.modules || []);
    } catch (error) {
      setMessage(error?.message || "Could not activate admin override.");
    } finally {
      setBusy(false);
    }
  }

  function updateRevokeForm(moduleCode, key, value) {
    setRevokeForm((current) => ({
      moduleCode,
      note: current.moduleCode === moduleCode ? current.note : "",
      approvedBy: current.moduleCode === moduleCode ? current.approvedBy : "",
      [key]: value,
    }));
  }

  async function submitRevoke(module) {
    if (!selectedTenantId || !module?.code) return;
    const note = revokeForm.moduleCode === module.code ? revokeForm.note.trim() : "";
    const approvedBy = revokeForm.moduleCode === module.code ? revokeForm.approvedBy.trim() : "";

    if (!note && !approvedBy) {
      setMessage("Enter an approval note or approver before revoking a package.");
      return;
    }

    if (!window.confirm(`Revoke ${module.name || module.code} immediately for this tenant?`)) return;

    setBusy(true);
    setMessage("");
    try {
      const result = await revokeModule(selectedTenantId, module.code, { note, approvedBy });
      setMessage(`Revoked ${result.moduleCode || module.code}.`);
      setRevokeForm({ moduleCode: "", note: "", approvedBy: "" });
      const entitlements = await getTenantEntitlements(selectedTenantId);
      setEntitlementModules(entitlements.modules || []);
    } catch (error) {
      setMessage(error?.message || "Could not revoke module.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTenantStatus() {
    if (!selectedTenantId || !selectedTenant) return;
    const nextStatus = normalizeStatus(statusAction.status) || "active";
    const reason = statusAction.reason.trim();
    const approvedBy = statusAction.approvedBy.trim();

    if (nextStatus !== "active" && !reason) {
      setMessage("Enter a reason before suspending, expiring, or blocking a tenant.");
      return;
    }

    const verb = nextStatus === "active" ? "reactivate" : nextStatus;
    if (!window.confirm(`Confirm ${verb} for ${selectedTenant.name}?`)) return;

    setBusy(true);
    setMessage("");
    try {
      const result = await updateTenantStatus(selectedTenantId, {
        status: nextStatus,
        reason,
        approvedBy,
      });
      setMessage(`${result.name || selectedTenant.name} is now ${result.status || nextStatus}.`);
      await load();
      setSelectedTenantId(selectedTenantId);
    } catch (error) {
      setMessage(error?.message || "Could not update tenant status.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdminPasswordReset(admin) {
    if (!selectedTenantId || !admin) return;
    const userId = admin.id || admin.Id;
    const password = passwordReset.userId === userId ? passwordReset.password.trim() : "";
    const note = passwordReset.userId === userId ? passwordReset.note.trim() : "";
    const approvedBy = passwordReset.userId === userId ? passwordReset.approvedBy.trim() : "";

    if (!password || password.length < 6) {
      setMessage("Enter a new password with at least 6 characters.");
      return;
    }

    const adminName = admin.displayName || admin.DisplayName || admin.username || admin.Username || "this admin";
    if (!window.confirm(`Reset password for ${adminName}?`)) return;

    setBusy(true);
    setMessage("");
    try {
      const result = await resetTenantAdminPassword(selectedTenantId, userId, {
        password,
        note,
        approvedBy,
      });
      setMessage(`Password reset for ${result.displayName || result.username || adminName}. New password: ${password}.${result.notificationEmailSent ? " Security notification emailed successfully." : result.email ? " Password changed, but the notification email could not be sent." : " This admin has no email address, so no notification was sent."}`);
      setPasswordReset({ userId: "", password: "NewPass@123", note: "", approvedBy: "" });
    } catch (error) {
      setMessage(error?.message || "Could not reset tenant admin password.");
    } finally {
      setBusy(false);
    }
  }

  function updateAdminCreateField(key, value) {
    setAdminCreate((current) => ({
      ...current,
      [key]: key === "username"
        ? String(value || "").toLowerCase().replace(/[^a-z0-9._-]/g, "-")
        : value,
    }));
  }

  async function submitAdminCreate(event) {
    event.preventDefault();
    if (!selectedTenantId || !selectedTenant) return;

    const username = adminCreate.username.trim();
    const password = adminCreate.password.trim();
    const displayName = adminCreate.displayName.trim();
    const email = adminCreate.email.trim();
    const phone = adminCreate.phone.trim();
    const note = adminCreate.note.trim();
    const approvedBy = adminCreate.approvedBy.trim();

    if (!username) {
      setMessage("Enter a username for the church admin.");
      return;
    }
    if (!password || password.length < 6) {
      setMessage("Enter an initial password with at least 6 characters.");
      return;
    }

    const existingAdmins = selectedTenant.adminUsers || selectedTenant.AdminUsers || [];
    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();
    const duplicateAdmin = existingAdmins.find((admin) => {
      const existingUsername = String(admin.username || admin.Username || "").trim().toLowerCase();
      const existingEmail = String(admin.email || admin.Email || "").trim().toLowerCase();
      return existingUsername === normalizedUsername || (normalizedEmail && existingEmail === normalizedEmail);
    });
    if (duplicateAdmin) {
      const existingName = duplicateAdmin.displayName || duplicateAdmin.DisplayName || duplicateAdmin.username || duplicateAdmin.Username || "an existing admin";
      const usernameMatches = String(duplicateAdmin.username || duplicateAdmin.Username || "").trim().toLowerCase() === normalizedUsername;
      setMessage(usernameMatches
        ? `Username ${username} is already used by ${existingName} in this church. Choose another username.`
        : `Email ${email} is already used by ${existingName} in this church. Use a different email or reset that admin's password.`);
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = await createTenantAdminUser(selectedTenantId, {
        username,
        displayName,
        email,
        phone,
        password,
        note,
        approvedBy,
      });
      setMessage(`Created church admin ${result.displayName || result.username || username}. Initial password: ${password}.${result.notificationEmailSent ? " Account notification emailed successfully." : email ? " Account created, but the notification email could not be sent; give the login details securely." : " No email notification was requested."}`);
      setAdminCreate(blankAdminCreate);
      await load();
      setSelectedTenantId(selectedTenantId);
    } catch (error) {
      setMessage(error?.message || "Could not create church admin user.");
    } finally {
      setBusy(false);
    }
  }

  async function approvePendingModuleRequest(request) {
    if (!request?.id) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await approveModuleRequest(request.id, {
        approvedBy: "SambitR",
        note: `Approved from Tenant Administration for ${request.tenantName || request.tenantSlug || "tenant"}.`,
      });
      setMessage(`Approved ${request.moduleName || request.moduleCode}. Tenant can access it after refresh/login.`);
      await load();
      if (String(selectedTenantId) === String(result.tenantId)) {
        const entitlements = await getTenantEntitlements(selectedTenantId);
        setEntitlementModules(entitlements.modules || []);
      }
    } catch (error) {
      setMessage(error?.message || "Could not approve subscription request.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectPendingModuleRequest(request) {
    if (!request?.id) return;
    const note = window.prompt("Reason or note for rejection", "");
    if (note === null) return;
    setBusy(true);
    setMessage("");
    try {
      await rejectModuleRequest(request.id, { approvedBy: "SambitR", note });
      setMessage(`Rejected ${request.moduleName || request.moduleCode} request.`);
      await load();
    } catch (error) {
      setMessage(error?.message || "Could not reject subscription request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div
          className="mahima-standard-page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          data-mahima-explicit-header="true"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Platform Administration
            </div>
            <h1
              className="mahima-standard-page-title mt-3 text-2xl font-black text-slate-900"
              data-mahima-explicit-title="true"
            >
              Tenant Administration
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Create church tenants, manage public URLs, review package access, collect UPI payments, and approve or revoke module access.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {message && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {message}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Building2} label="Tenant Churches" value={tenantStats.total} />
          <MetricCard icon={CheckCircle2} label="Active Tenants" value={tenantStats.active} tone="green" />
          <MetricCard icon={UsersRound} label="Total Users" value={tenantStats.users} tone="blue" />
          <MetricCard icon={ShieldAlert} label="Restricted Tenants" value={tenantStats.blocked} tone="amber" />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">Pending Subscription Requests</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Tenant admins cannot enable paid packages directly. Approve requests here to unlock access on refresh/login.
              </p>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800 ring-1 ring-amber-100">
              {moduleRequests.length} pending
            </span>
          </div>
          {moduleRequests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-semibold text-slate-500">
              No pending subscription requests.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {moduleRequests.map((request) => (
                <div key={request.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-950">{request.moduleName || request.moduleCode}</div>
                      <div className="mt-1 text-xs font-bold text-slate-600">{request.tenantName || request.tenantSlug}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Requested by {request.requestedByName || request.requestedByEmail || "tenant admin"}
                        {request.requestedAtUtc ? ` on ${new Date(request.requestedAtUtc).toLocaleString()}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200">
                          Rs {Number(request.modulePriceInr || 0).toLocaleString("en-IN")}/mo
                        </span>
                        {request.notificationEmailSent && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">Email sent</span>
                        )}
                        {request.jaiMasihMessageSent && (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700 ring-1 ring-sky-100">Jai Masih sent</span>
                        )}
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">
                      {request.status || "pending"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => approvePendingModuleRequest(request)}
                      disabled={busy}
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectPendingModuleRequest(request)}
                      disabled={busy}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-5">
            <section className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-700" />
                <div>
                  <h2 className="text-lg font-black text-slate-900">Add-On Donation Verification</h2>
                  <p className="text-xs font-semibold text-slate-500">Verify the submitted UPI reference before activating an add-on.</p>
                </div>
              </div>
              {packagePaymentRequests.length === 0 ? (
                <div className="rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-500">No pending add-on donation requests.</div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {packagePaymentRequests.map((request) => (
                    <article key={request.id} className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-black text-slate-950">{request.planName}</h3>
                          <p className="mt-1 text-xs font-bold text-slate-600">{request.tenantName} · {request.tenantSlug}</p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black uppercase text-amber-800">Pending</span>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div><dt className="font-black text-slate-500">Amount</dt><dd className="font-black text-slate-900">Rs {Number(request.amountInr || 0).toLocaleString("en-IN")}</dd></div>
                        <div><dt className="font-black text-slate-500">UPI reference</dt><dd className="break-all font-black text-slate-900">{request.upiTransactionNumber}</dd></div>
                        <div><dt className="font-black text-slate-500">Payer</dt><dd className="font-bold text-slate-800">{request.payerName}</dd></div>
                        <div><dt className="font-black text-slate-500">Submitted</dt><dd className="font-bold text-slate-800">{new Date(request.createdAtUtc).toLocaleString()}</dd></div>
                      </dl>
                      {(request.payerPhone || request.payerEmail || request.note) && (
                        <p className="mt-3 text-xs font-semibold text-slate-600">{[request.payerPhone, request.payerEmail, request.note].filter(Boolean).join(" · ")}</p>
                      )}
                      <div className="mt-4 flex gap-2">
                        <button type="button" disabled={busy} onClick={() => reviewAddOnPayment(request, true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-60">Verify & Activate</button>
                        <button type="button" disabled={busy} onClick={() => reviewAddOnPayment(request, false)} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-60">Reject</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-indigo-700" />
                    <h2 className="text-lg font-black text-slate-900">Package Publisher</h2>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Save a draft, then publish a version. Publishing updates every active tenant subscription from the effective time.
                  </p>
                </div>
                <button type="button" onClick={() => setPackageDraft(blankPackage)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-black text-indigo-700">
                  New Package
                </button>
              </div>
              <form onSubmit={submitPackage} className="grid gap-3 rounded-lg bg-indigo-50 p-4 lg:grid-cols-4">
                <input required value={packageDraft.code} onChange={(event) => setPackageDraft((p) => ({ ...p, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") }))} placeholder="PACKAGE CODE" className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold" />
                <input required value={packageDraft.name} onChange={(event) => setPackageDraft((p) => ({ ...p, name: event.target.value }))} placeholder="Package name" className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold" />
                <input required type="number" min="0" step="0.01" value={packageDraft.monthlyPriceInr} onChange={(event) => setPackageDraft((p) => ({ ...p, monthlyPriceInr: event.target.value }))} placeholder="Monthly price (INR)" className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold" />
                <input type="number" value={packageDraft.displayOrder} onChange={(event) => setPackageDraft((p) => ({ ...p, displayOrder: Number(event.target.value) }))} placeholder="Display order" className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold" />
                <label className="text-xs font-black uppercase tracking-wide text-indigo-800 lg:col-span-2">
                  Contract period (months)
                  <input type="number" min="1" max="60" value={packageDraft.contractMonths} onChange={(event) => setPackageDraft((p) => ({ ...p, contractMonths: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold normal-case tracking-normal" />
                </label>
                <label className="text-xs font-black uppercase tracking-wide text-indigo-800 lg:col-span-2">
                  Early downgrade/termination penalty (%)
                  <input type="number" min="0" max="100" step="0.01" value={packageDraft.earlyExitPenaltyPercent} onChange={(event) => setPackageDraft((p) => ({ ...p, earlyExitPenaltyPercent: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold normal-case tracking-normal" />
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900 lg:col-span-4">
                  <input type="checkbox" checked={packageDraft.isBaseFreePlan} onChange={(event) => setPackageDraft((p) => ({ ...p, isBaseFreePlan: event.target.checked, monthlyPriceInr: event.target.checked ? 0 : p.monthlyPriceInr, storageLimitGb: event.target.checked ? 10 : p.storageLimitGb }))} />
                  Essentials (free base flavour; fixed at 10 GB)
                </label>
                <label className="text-xs font-black uppercase tracking-wide text-indigo-800">Data growth limit (GB)<input required type="number" min="0.01" step="0.01" disabled={packageDraft.isBaseFreePlan} value={packageDraft.storageLimitGb} onChange={(event) => setPackageDraft((p) => ({ ...p, storageLimitGb: event.target.value }))} className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold normal-case tracking-normal disabled:bg-slate-100" /></label>
                <label className="text-xs font-black uppercase tracking-wide text-indigo-800">Included AI credits (INR)<input required type="number" min="0" step="1" value={packageDraft.aiCreditsIncludedInr} onChange={(event) => setPackageDraft((p) => ({ ...p, aiCreditsIncludedInr: event.target.value }))} className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold normal-case tracking-normal" /></label>
                <label className="text-xs font-black uppercase tracking-wide text-indigo-800">Extra storage (INR / GB)<input required type="number" min="0" step="0.01" value={packageDraft.storageOveragePricePerGbInr} onChange={(event) => setPackageDraft((p) => ({ ...p, storageOveragePricePerGbInr: event.target.value }))} className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold normal-case tracking-normal" /></label>
                <label className="text-xs font-black uppercase tracking-wide text-indigo-800">AI overage multiplier<input required type="number" min="1" step="0.1" value={packageDraft.aiOverageMarkupMultiplier} onChange={(event) => setPackageDraft((p) => ({ ...p, aiOverageMarkupMultiplier: event.target.value }))} className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold normal-case tracking-normal" /></label>
                <div className="grid gap-3 rounded-lg border border-indigo-200 bg-white p-3 lg:col-span-4 lg:grid-cols-4">
                  <div className="lg:col-span-4"><div className="text-xs font-black uppercase tracking-wide text-indigo-800">Monthly overage calculator</div><p className="mt-1 text-xs font-semibold text-slate-500">Estimate the tenant charge after this package's included limits are used.</p></div>
                  <label className="text-xs font-bold text-slate-700">Projected storage (GB)<input type="number" min="0" step="0.01" value={usageProjection.storageGb} onChange={(event) => setUsageProjection((p) => ({ ...p, storageGb: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
                  <label className="text-xs font-bold text-slate-700">Projected OpenAI cost (INR)<input type="number" min="0" step="0.01" value={usageProjection.aiProviderCostInr} onChange={(event) => setUsageProjection((p) => ({ ...p, aiProviderCostInr: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
                  <div className="rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-700">Excess<br/><span className="text-sm font-black">{projectedOverage.excessStorageGb.toLocaleString()} GB + ₹{projectedOverage.excessAiCost.toFixed(2)} AI cost</span></div>
                  <div className="rounded-lg bg-indigo-700 p-3 text-xs font-bold text-indigo-100">Estimated overage<br/><span className="text-lg font-black text-white">Rs {projectedOverage.total.toFixed(2)}</span></div>
                </div>
                <textarea value={packageDraft.description} onChange={(event) => setPackageDraft((p) => ({ ...p, description: event.target.value }))} placeholder="Package description" rows={2} className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold lg:col-span-4" />
                <div className="lg:col-span-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-wide text-indigo-800">Included modules</div>
                  <div className="flex flex-wrap gap-2">
                    {modules.map((module) => (
                      <label key={module.code} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-black ${packageDraft.moduleCodes.includes(module.code) ? "border-indigo-600 bg-indigo-600 text-white" : "border-indigo-200 bg-white text-slate-700"}`}>
                        <input type="checkbox" className="sr-only" checked={packageDraft.moduleCodes.includes(module.code)} onChange={() => togglePackageModule(module.code)} />
                        {module.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="lg:col-span-4">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-indigo-800">Individual page access</div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Choose the exact pages/components included in this package.</p>
                    </div>
                    <span className="text-xs font-black text-indigo-700">{packageDraft.pageKeys.length} selected</span>
                  </div>
                  {packageDraft.moduleCodes.length ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {packageDraft.moduleCodes.map((moduleCode) => {
                        const module = modules.find((item) => item.code === moduleCode);
                        const pages = packagePages.filter((page) => page.moduleCode === moduleCode);
                        const selectedCount = pages.filter((page) => packageDraft.pageKeys.includes(page.key)).length;
                        return (
                          <fieldset key={moduleCode} className="rounded-lg border border-indigo-200 bg-white p-3">
                            <legend className="px-1 text-xs font-black text-slate-900">
                              {module?.name || moduleCode} ({selectedCount}/{pages.length})
                            </legend>
                            <div className="mt-1 space-y-2">
                              {pages.map((page) => (
                                <label key={page.key} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50">
                                  <input
                                    type="checkbox"
                                    checked={packageDraft.pageKeys.includes(page.key)}
                                    onChange={() => togglePackagePage(page.key)}
                                    className="mt-0.5"
                                  />
                                  <span>
                                    <span className="block">{page.title}</span>
                                    <span className="text-[10px] font-semibold text-slate-400">{page.key}</span>
                                  </span>
                                </label>
                              ))}
                              {!pages.length && <p className="text-xs font-semibold text-amber-700">No pages are mapped to this module.</p>}
                            </div>
                          </fieldset>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-indigo-200 bg-white p-4 text-center text-xs font-semibold text-slate-500">
                      Select a module above to configure its individual pages.
                    </div>
                  )}
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={packageDraft.enabled} onChange={(event) => setPackageDraft((p) => ({ ...p, enabled: event.target.checked }))} />
                  Available for activation
                </label>
                <div className="lg:col-span-3 lg:text-right">
                  <button type="submit" disabled={busy || packageDraft.moduleCodes.length === 0 || packageDraft.pageKeys.length === 0} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
                    Save Draft
                  </button>
                </div>
              </form>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {packages.map((item) => (
                  <article key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-slate-900">{item.name}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase ${item.lifecycleStatus === "published" ? "bg-emerald-100 text-emerald-800" : item.lifecycleStatus === "expired" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                            {item.lifecycleStatus === "published" ? `Published v${item.publishedVersion}` : item.lifecycleStatus === "expired" ? `Expired v${item.publishedVersion}` : item.publishedVersion > 0 ? `Draft v${item.publishedVersion + 1}` : "Draft"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                        <p className="mt-2 text-xs font-black text-indigo-700">
                          Rs {item.monthlyPriceInr}/mo · {(item.moduleCodes || []).length} modules · {(item.pageKeys || []).length} pages
                        </p>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">
                          {item.contractMonths || 12}-month contract · {item.earlyExitPenaltyPercent ?? 10}% early-exit penalty
                        </p>
                        <p className="mt-1 text-[11px] font-bold text-slate-600">
                          {item.storageLimitGb ?? 10} GB · ₹{Number(item.aiCreditsIncludedInr || 0).toLocaleString()} AI credits/mo · overage Rs {item.storageOveragePricePerGbInr || 49}/GB + {item.aiOverageMarkupMultiplier || 2.5}× OpenAI cost
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.lifecycleStatus || (item.publishedVersion > 0 ? "published" : "draft")) === "draft" && (
                        <>
                          <button type="button" onClick={() => editPackage(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black">Edit Draft</button>
                          <button type="button" onClick={() => publishPackageNow(item)} disabled={busy} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Publish {item.publishedVersion > 0 ? `v${item.publishedVersion + 1}` : "v1"}</button>
                          {item.publishedVersion === 0 && <button type="button" onClick={() => deletePackageDraft(item)} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">Delete Draft</button>}
                        </>
                      )}
                      {item.lifecycleStatus === "published" && <button type="button" onClick={() => expirePublishedPackage(item)} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">Expire v{item.publishedVersion}</button>}
                      {item.lifecycleStatus === "expired" && <><button type="button" onClick={() => openNextPackageDraft(item)} disabled={busy} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Create Draft v{item.publishedVersion + 1}</button><button type="button" onClick={() => deletePackageDraft(item)} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">Delete Package</button></>}
                      {item.lifecycleStatus === "published" && item.enabled && item.publishedVersion > 0 && selectedTenantId && (
                        <button type="button" onClick={() => activateSelectedPackage(item)} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Activate For Selected Tenant</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Tenant Directory</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Review church URLs, church admins, user mix, and operational status.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={tenantSearch}
                      onChange={(event) => setTenantSearch(event.target.value)}
                      placeholder="Search tenants..."
                      className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 sm:w-64"
                    />
                  </label>
                  <select
                    value={selectedTenantId}
                    onChange={(event) => setSelectedTenantId(event.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold"
                  >
                    {filteredTenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name} ({tenant.slug})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedTenant ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-black text-slate-950">{selectedTenant.name}</h3>
                          <StatusBadge status={selectedTenant.status} />
                        </div>
                        <p className="mt-1 text-sm font-semibold text-slate-500">
                          {selectedTenant.slug} {selectedTenant.domain ? `- ${selectedTenant.domain}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={selectedTenant.publicUrl || selectedTenant.PublicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open Church URL
                        </a>
                        <a
                          href={tenantLoginUrl(selectedTenant)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-700"
                        >
                          <LinkIcon className="h-4 w-4" />
                          Login URL
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Info label="Tenant ID" value={shortId(selectedTenant.id)} />
                    <Info label="Public Slug" value={selectedTenant.slug} />
                    <Info label="User Code Prefix" value={selectedTenant.userCodePrefix || selectedTenant.UserCodePrefix} />
                    <Info label="Contact Email" value={selectedTenant.contactEmail || selectedTenant.ContactEmail} />
                    <Info label="Contact Phone" value={selectedTenant.contactPhone || selectedTenant.ContactPhone} />
                    <Info
                      label="WhatsApp User Notification SID"
                      value={selectedTenant.whatsAppUserNotificationTemplateSid || selectedTenant.WhatsAppUserNotificationTemplateSid}
                    />
                    <Info
                      label="WhatsApp Marketing SID"
                      value={selectedTenant.whatsAppMarketingTemplateSid || selectedTenant.WhatsAppMarketingTemplateSid}
                    />
                  </div>

                  {!selectedTenant.isRootTenant && !selectedTenant.IsRootTenant && (
                    <section className="rounded-lg border-2 border-rose-200 bg-rose-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
                        <div className="flex-1">
                          <h3 className="font-black text-rose-950">Permanent Cleanup</h3>
                          <p className="mt-1 text-xs font-semibold leading-5 text-rose-800">
                            Delete this church’s complete billing history, or permanently purge the tenant and every tenant-scoped record. These actions cannot be undone.
                          </p>
                          <label className="mt-3 block text-xs font-black text-rose-900">
                            Type <span className="rounded bg-white px-1.5 py-0.5 font-mono">{selectedTenant.slug}</span> to enable cleanup
                            <input
                              value={cleanupConfirmation}
                              onChange={(event) => setCleanupConfirmation(event.target.value)}
                              placeholder={selectedTenant.slug}
                              className="mt-2 min-h-10 w-full max-w-md rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-rose-500"
                            />
                          </label>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={deleteSelectedTenantBilling}
                              disabled={busy || cleanupConfirmation !== selectedTenant.slug}
                              className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" /> Delete All Billing
                            </button>
                            <button
                              type="button"
                              onClick={permanentlyDeleteSelectedTenant}
                              disabled={busy || cleanupConfirmation !== selectedTenant.slug}
                              className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white hover:bg-rose-800 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" /> Purge Entire Tenant
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  <form onSubmit={submitTenantProfile} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-emerald-700" />
                      <h3 className="font-black text-slate-900">Edit Tenant Details</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <TenantEditField label="Church name" value={tenantEdit.name} onChange={(value) => updateTenantEditField("name", value)} required />
                      <TenantEditField label="Slug" value={tenantEdit.slug} onChange={(value) => updateTenantEditField("slug", value)} required />
                      <TenantEditField label="User code prefix" value={tenantEdit.userCodePrefix} onChange={(value) => updateTenantEditField("userCodePrefix", value)} required />
                      <TenantEditField label="Custom domain" value={tenantEdit.domain} onChange={(value) => updateTenantEditField("domain", value)} />
                      <TenantEditField label="Contact name" value={tenantEdit.contactName} onChange={(value) => updateTenantEditField("contactName", value)} />
                      <TenantEditField label="Contact email" value={tenantEdit.contactEmail} onChange={(value) => updateTenantEditField("contactEmail", value)} />
                      <TenantEditField label="Contact phone" value={tenantEdit.contactPhone} onChange={(value) => updateTenantEditField("contactPhone", value)} />
                      <TenantEditField label="Church country code (ISO, e.g. IN, NG, US)" value={tenantEdit.countryCode} onChange={(value) => updateTenantEditField("countryCode", String(value || "").toUpperCase().slice(0, 2))} required />
                      <TenantEditField
                        label="WhatsApp user notification template SID"
                        value={tenantEdit.whatsAppUserNotificationTemplateSid}
                        onChange={(value) => updateTenantEditField("whatsAppUserNotificationTemplateSid", value)}
                      />
                      <TenantEditField
                        label="WhatsApp marketing template SID"
                        value={tenantEdit.whatsAppMarketingTemplateSid}
                        onChange={(value) => updateTenantEditField("whatsAppMarketingTemplateSid", value)}
                      />
                      <TenantLogoField
                        file={tenantEdit.logoFile}
                        existingLogoUrl={tenantEdit.existingLogoUrl}
                        onChange={(file) => updateTenantEditField("logoFile", file)}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {(tenantEdit.logoFile || tenantEdit.existingLogoUrl) && (
                        <span className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                          <TenantLogo
                            src={tenantEdit.logoFile ? URL.createObjectURL(tenantEdit.logoFile) : tenantEdit.existingLogoUrl}
                            name={tenantEdit.name || selectedTenant.name || "Church"}
                            className="h-7 w-7 rounded"
                            imgClassName="object-contain p-0.5"
                          />
                          {tenantEdit.logoFile ? tenantEdit.logoFile.name : "Current logo"}
                        </span>
                      )}
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                      >
                        Save Tenant Details
                      </button>
                    </div>
                  </form>

                  <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                    <div className="rounded-lg border border-slate-200 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <UserCog className="h-5 w-5 text-emerald-700" />
                        <h3 className="font-black text-slate-900">Church Admin Users</h3>
                      </div>
                      <form onSubmit={submitAdminCreate} className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                        <div className="mb-3 flex items-center gap-2">
                          <UserPlus className="h-4 w-4 text-emerald-700" />
                          <h4 className="text-sm font-black text-slate-900">Add Church Admin</h4>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          <input
                            value={adminCreate.displayName}
                            onChange={(event) => updateAdminCreateField("displayName", event.target.value)}
                            placeholder="Display name"
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                          />
                          <input
                            value={adminCreate.username}
                            onChange={(event) => updateAdminCreateField("username", event.target.value)}
                            placeholder="Username"
                            required
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                          />
                          <input
                            value={adminCreate.password}
                            onChange={(event) => updateAdminCreateField("password", event.target.value)}
                            placeholder="Initial password"
                            required
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                          />
                          <input
                            type="email"
                            value={adminCreate.email}
                            onChange={(event) => updateAdminCreateField("email", event.target.value)}
                            placeholder="Email"
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                          />
                          <input
                            value={adminCreate.phone}
                            onChange={(event) => updateAdminCreateField("phone", event.target.value)}
                            placeholder="Phone"
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                          />
                          <input
                            value={adminCreate.approvedBy}
                            onChange={(event) => updateAdminCreateField("approvedBy", event.target.value)}
                            placeholder="Approved by"
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                          />
                          <input
                            value={adminCreate.note}
                            onChange={(event) => updateAdminCreateField("note", event.target.value)}
                            placeholder="Approval note"
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 md:col-span-2"
                          />
                          <button
                            type="submit"
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                          >
                            <UserPlus className="h-4 w-4" />
                            Add Admin
                          </button>
                        </div>
                      </form>
                      <div className="space-y-2">
                        {(selectedTenant.adminUsers || selectedTenant.AdminUsers || []).length ? (
                          (selectedTenant.adminUsers || selectedTenant.AdminUsers || []).map((admin) => {
                            const adminId = admin.id || admin.Id;
                            const resetOpen = passwordReset.userId === adminId;
                            return (
                              <div key={adminId} className="rounded-lg bg-slate-50 p-3 text-sm">
                                <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-center">
                                  <div>
                                    <div className="font-black text-slate-900">{admin.displayName || admin.DisplayName || admin.username || admin.Username}</div>
                                    <div className="text-xs font-semibold text-slate-500">{admin.username || admin.Username}</div>
                                  </div>
                                  <div className="text-xs font-semibold text-slate-600">
                                    ID: {admin.userCode || admin.UserCode || shortId(adminId)}
                                  </div>
                                  <div className="text-xs font-semibold text-slate-600">
                                    {admin.email || admin.Email || admin.phone || admin.Phone || "-"}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setPasswordReset((current) => ({
                                      userId: current.userId === adminId ? "" : adminId,
                                      password: "NewPass@123",
                                      note: "",
                                      approvedBy: "",
                                    }))}
                                    disabled={busy}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                  >
                                    Reset Password
                                  </button>
                                </div>

                                {resetOpen && (
                                  <div className="mt-3 grid gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 lg:grid-cols-[180px_1fr_160px_auto]">
                                    <input
                                      type="text"
                                      value={passwordReset.password}
                                      onChange={(event) => setPasswordReset((current) => ({ ...current, password: event.target.value }))}
                                      placeholder="New password"
                                      className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500"
                                    />
                                    <input
                                      value={passwordReset.note}
                                      onChange={(event) => setPasswordReset((current) => ({ ...current, note: event.target.value }))}
                                      placeholder="Reason or support note"
                                      className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500"
                                    />
                                    <input
                                      value={passwordReset.approvedBy}
                                      onChange={(event) => setPasswordReset((current) => ({ ...current, approvedBy: event.target.value }))}
                                      placeholder="Approved by"
                                      className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => submitAdminPasswordReset(admin)}
                                      disabled={busy}
                                      className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white hover:bg-sky-800 disabled:opacity-60"
                                    >
                                      Save Password
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-500">No church admin user found.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <UsersRound className="h-5 w-5 text-emerald-700" />
                        <h3 className="font-black text-slate-900">Users By Category</h3>
                      </div>
                      <UserCountGrid counts={selectedTenant.userCounts || selectedTenant.UserCounts} />
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Ban className="h-5 w-5 text-amber-700" />
                      <h3 className="font-black text-slate-900">Tenant Access Control</h3>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[180px_1fr_180px_auto]">
                      <select
                        value={statusAction.status}
                        onChange={(event) => setStatusAction((current) => ({ ...current, status: event.target.value }))}
                        disabled={selectedTenant.isRootTenant || selectedTenant.IsRootTenant}
                        className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-amber-500 disabled:opacity-60"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="expired">Expired</option>
                        <option value="blocked">Blocked</option>
                      </select>
                      <input
                        value={statusAction.reason}
                        onChange={(event) => setStatusAction((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Reason: non-payment, service expiry, malpractice, suspension..."
                        disabled={selectedTenant.isRootTenant || selectedTenant.IsRootTenant}
                        className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-amber-500 disabled:opacity-60"
                      />
                      <input
                        value={statusAction.approvedBy}
                        onChange={(event) => setStatusAction((current) => ({ ...current, approvedBy: event.target.value }))}
                        placeholder="Approved by"
                        disabled={selectedTenant.isRootTenant || selectedTenant.IsRootTenant}
                        className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-amber-500 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={submitTenantStatus}
                        disabled={busy || selectedTenant.isRootTenant || selectedTenant.IsRootTenant}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-black text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        Apply
                      </button>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-amber-800">
                      Suspended, expired, and blocked tenants are operationally restricted until reactivated by Mahima root admin.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">No tenant selected.</div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-700" />
                <h2 className="text-lg font-black text-slate-900">Modules And UPI Activation</h2>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(entitlementModules.length ? entitlementModules : modules).map((module) => {
                  const isLicensed = Boolean(module.licensed);
                  const price = Number(module.monthlyPriceInr || 0);
                  const isEditing = moduleEdit.code === module.code;
                  return (
                  <div key={module.code} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-slate-900">{module.name}</h3>
                          {isLicensed && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black uppercase text-emerald-800">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{module.description}</p>
                        {module.license?.source && (
                          <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                            Source: {module.license.source}
                            {module.license.activatedByPaymentId ? ` - Payment: ${module.license.activatedByPaymentId}` : ""}
                            {module.license.endsAtUtc ? ` - Ends: ${new Date(module.license.endsAtUtc).toLocaleDateString()}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
                        {price === 0 ? "Free" : `Rs ${module.monthlyPriceInr}/mo`}
                      </div>
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => isEditing ? setModuleEdit(blankModuleEdit) : startModuleEdit(module)}
                        disabled={busy}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {isEditing ? "Cancel editing" : "Edit package"}
                      </button>
                    </div>
                    {isEditing && (
                      <form onSubmit={submitModuleEdit} className="mt-3 grid gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 sm:grid-cols-2">
                        <label className="text-[11px] font-black uppercase tracking-wide text-sky-900">
                          Package name
                          <input
                            required
                            value={moduleEdit.name}
                            onChange={(event) => setModuleEdit((current) => ({ ...current, name: event.target.value }))}
                            className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="text-[11px] font-black uppercase tracking-wide text-sky-900">
                          Monthly price (INR)
                          <input
                            required
                            type="number"
                            min="0"
                            step="0.01"
                            value={moduleEdit.monthlyPriceInr}
                            onChange={(event) => setModuleEdit((current) => ({ ...current, monthlyPriceInr: event.target.value }))}
                            className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="text-[11px] font-black uppercase tracking-wide text-sky-900 sm:col-span-2">
                          Description
                          <textarea
                            value={moduleEdit.description}
                            onChange={(event) => setModuleEdit((current) => ({ ...current, description: event.target.value }))}
                            rows={3}
                            className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="text-[11px] font-black uppercase tracking-wide text-sky-900">
                          Display order
                          <input
                            type="number"
                            value={moduleEdit.displayOrder}
                            onChange={(event) => setModuleEdit((current) => ({ ...current, displayOrder: event.target.value }))}
                            className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="flex items-center gap-2 self-end rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
                          <input
                            type="checkbox"
                            checked={moduleEdit.enabled}
                            onChange={(event) => setModuleEdit((current) => ({ ...current, enabled: event.target.checked }))}
                          />
                          Available for activation
                        </label>
                        <div className="flex items-center justify-between gap-3 sm:col-span-2">
                          <span className="text-[11px] font-bold text-slate-500">Code: {module.code} (cannot be changed)</span>
                          <button
                            type="submit"
                            disabled={busy}
                            className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white hover:bg-sky-800 disabled:opacity-60"
                          >
                            Save package
                          </button>
                        </div>
                      </form>
                    )}
                    {isLicensed ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">
                          Licensed for this church
                          {module.license?.endsAtUtc ? ` until ${new Date(module.license.endsAtUtc).toLocaleString()}` : ""}
                        </div>
                        {price > 0 && (
                          <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                            <button
                              type="button"
                              onClick={() => setRevokeForm((current) => ({
                                moduleCode: current.moduleCode === module.code ? "" : module.code,
                                note: "",
                                approvedBy: "",
                              }))}
                              disabled={busy || loadingEntitlements}
                              className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                            >
                              Revoke License
                            </button>
                            {revokeForm.moduleCode === module.code && (
                              <div className="space-y-2">
                                <input
                                  value={revokeForm.approvedBy}
                                  onChange={(event) => updateRevokeForm(module.code, "approvedBy", event.target.value)}
                                  placeholder="Revocation approved by"
                                  className="w-full rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-rose-500"
                                />
                                <textarea
                                  value={revokeForm.note}
                                  onChange={(event) => updateRevokeForm(module.code, "note", event.target.value)}
                                  placeholder="Revocation reason or approval note"
                                  rows={3}
                                  className="w-full rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-rose-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => submitRevoke(module)}
                                  disabled={busy}
                                  className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white hover:bg-rose-800 disabled:opacity-60"
                                >
                                  Revoke Immediately
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startPayment(module.code)}
                            disabled={busy || loadingEntitlements || !selectedTenantId}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-60"
                          >
                            {price === 0 ? "Activate Free" : "Create Payment"}
                          </button>
                          {price > 0 && (
                            <button
                              type="button"
                              onClick={() => setManualOverride((current) => ({
                                moduleCode: current.moduleCode === module.code ? "" : module.code,
                                receiptNumber: "",
                                note: "",
                                approvedBy: "",
                                endsAtUtc: "",
                              }))}
                              disabled={busy || loadingEntitlements || !selectedTenantId}
                              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                            >
                              Admin Override
                            </button>
                          )}
                        </div>

                        {manualOverride.moduleCode === module.code && (
                          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <input
                              value={manualOverride.receiptNumber}
                              onChange={(event) => updateManualOverride(module.code, "receiptNumber", event.target.value)}
                              placeholder="Payment receipt number"
                              className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500"
                            />
                            <input
                              value={manualOverride.approvedBy}
                              onChange={(event) => updateManualOverride(module.code, "approvedBy", event.target.value)}
                              placeholder="Approved by"
                              className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500"
                            />
                            <textarea
                              value={manualOverride.note}
                              onChange={(event) => updateManualOverride(module.code, "note", event.target.value)}
                              placeholder="Special note or approval reason"
                              rows={3}
                              className="w-full rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500"
                            />
                            <label className="block text-[11px] font-black uppercase tracking-wide text-amber-800">
                              Trial / activation end date
                              <input
                                type="datetime-local"
                                value={manualOverride.endsAtUtc}
                                onChange={(event) => updateManualOverride(module.code, "endsAtUtc", event.target.value)}
                                className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => submitManualOverride(module)}
                              disabled={busy}
                              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-60"
                            >
                              Activate With Override
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </section>

            {paymentIntent?.upiDeepLink && (
              <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <h2 className="text-lg font-black text-emerald-950">Pending UPI Payment</h2>
                <p className="mt-1 text-sm text-emerald-800">
                  Amount: Rs {paymentIntent.amountInr} to {paymentIntent.upiPayeeName} ({paymentIntent.upiVpa})
                </p>
                <div className="mt-3 break-all rounded-lg bg-white p-3 text-xs font-semibold text-slate-700">
                  {paymentIntent.upiDeepLink}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={paymentIntent.upiDeepLink}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
                  >
                    Open UPI
                  </a>
                  <button
                    type="button"
                    onClick={confirmPayment}
                    disabled={busy}
                    className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    Mark Paid And Activate
                  </button>
                </div>
              </section>
            )}

            {paymentIntent?.razorpayOrderId && (
              <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <h2 className="text-lg font-black text-indigo-950">Pending Razorpay Payment</h2>
                <p className="mt-1 text-sm text-indigo-800">
                  Amount: Rs {paymentIntent.amountInr}. Order: {paymentIntent.razorpayOrderId}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openRazorpayCheckout(paymentIntent)}
                    disabled={busy}
                    className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-black text-white hover:bg-indigo-800 disabled:opacity-60"
                  >
                    Open Razorpay Checkout
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const entitlements = await getTenantEntitlements(selectedTenantId);
                      setEntitlementModules(entitlements.modules || []);
                      setMessage("Module status refreshed. Webhook-confirmed payments will appear as active.");
                    }}
                    disabled={busy}
                    className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-black text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
                  >
                    Refresh Module Status
                  </button>
                </div>
              </section>
            )}
        </div>
      </div>
    </div>
  );
}

async function openRazorpayCheckout(intent) {
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Razorpay checkout could not load.");

  const checkout = new window.Razorpay({
    key: intent.razorpayKeyId,
    amount: Math.round(Number(intent.amountInr || 0) * 100),
    currency: intent.currency || "INR",
    name: "Mahima Innovation Center (MIC)",
    description: `${intent.moduleCode || "Module"} subscription`,
    order_id: intent.razorpayOrderId,
    notes: {
      paymentIntentId: intent.id,
      module: intent.moduleCode,
    },
    handler: () => {
      // Razorpay webhook is the source of truth for activation.
    },
  });
  checkout.open();
}

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-black text-slate-900">{value || "-"}</div>
    </div>
  );
}

function TenantEditField({ label, value, onChange, required = false }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
      {label}
      <input
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function TenantLogoField({ file, existingLogoUrl, onChange }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
      Church logo
      <input
        type="file"
        accept="image/*"
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-emerald-800 focus:border-emerald-500"
      />
      <span className="mt-1 block text-[11px] font-semibold normal-case tracking-normal text-slate-500">
        {file ? file.name : existingLogoUrl ? "Current logo will stay unless you upload a new one." : "Upload a PNG, JPG, WEBP, or GIF logo."}
      </span>
    </label>
  );
}

function MetricCard({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-white text-slate-900 border-slate-200",
    green: "bg-emerald-50 text-emerald-950 border-emerald-200",
    blue: "bg-sky-50 text-sky-950 border-sky-200",
    amber: "bg-amber-50 text-amber-950 border-amber-200",
  };
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide opacity-70">{label}</div>
          <div className="mt-2 text-2xl font-black">{value ?? 0}</div>
        </div>
        <Icon className="h-6 w-6 opacity-70" />
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  const tone = normalized === "active"
    ? "bg-emerald-100 text-emerald-800"
    : normalized === "blocked"
      ? "bg-rose-100 text-rose-800"
      : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${tone}`}>
      {normalized || "unknown"}
    </span>
  );
}

function UserCountGrid({ counts }) {
  const c = counts || {};
  const rows = [
    ["Total", c.total ?? c.Total ?? 0],
    ["Admins", c.admins ?? c.Admins ?? 0],
    ["Staff", c.staff ?? c.Staff ?? 0],
    ["Members", c.members ?? c.Members ?? 0],
    ["Volunteers", c.volunteers ?? c.Volunteers ?? 0],
    ["Other", c.other ?? c.Other ?? 0],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-lg font-black text-slate-900">{value}</div>
        </div>
      ))}
    </div>
  );
}

function shortId(value) {
  const text = String(value || "");
  if (!text) return "-";
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function normalizeStatus(value) {
  return String(value || "active").trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
