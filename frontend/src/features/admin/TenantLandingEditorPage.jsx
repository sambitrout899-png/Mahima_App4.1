import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Clock, Copy, Eye, Globe2, History, Layers, Loader2, Monitor, Palette,
  RotateCcw, Save, Search, Smartphone, Sparkles, UploadCloud,
} from "lucide-react";
import {
  getTenantBranding, saveTenantBranding, getTenantLanding, getTenantLandingDraft,
  saveTenantLandingDraft, publishTenantLanding, setTenantLandingVisibility,
  getTenantLandingVersions, restoreTenantLandingVersion,
} from "../../api/multiTenantApi";
import { API_BASE } from "../../api";
import { getToken } from "../../utils/auth";
import { activeTenantSlug } from "../../utils/tenantNavigation";
import PublicLandingView from "../landing/PublicLandingView";
import { SECTION_TYPES, templateFor } from "../landing/sections/registry";
import SectionFormRenderer from "../landing/sectionForms/SectionFormRenderer";
import { TextField, ImageUrlField, SmallButton, AddItemButton, RemoveItemButton, ColorField, FontField, FONT_OPTIONS } from "../landing/sectionForms/fields";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const blankBrand = {
  logoUrl: "", primaryColor: "#0f766e", accentColor: "#f59e0b", neutralColor: "#f8fafc", darkColor: "#0f172a",
  headingFont: "Inter", bodyFont: "Inter", contactEmail: "", contactPhone: "", address: "", socialLinks: [],
};
const blankDraft = {
  heroTitle: "", heroSubtitle: "", heroImageUrl: "", heroLayout: "split-card",
  serviceTimes: [], sections: [], seoTitle: "", seoDescription: "", ogImageUrl: "",
};
const palettePresets = [
  { name: "Emerald Gold", primaryColor: "#047857", accentColor: "#f59e0b" },
  { name: "Royal Blue", primaryColor: "#1d4ed8", accentColor: "#f97316" },
  { name: "Wine Rose", primaryColor: "#9f1239", accentColor: "#14b8a6" },
  { name: "Charcoal Lime", primaryColor: "#1f2937", accentColor: "#84cc16" },
  { name: "Violet Amber", primaryColor: "#6d28d9", accentColor: "#fbbf24" },
  { name: "Teal Coral", primaryColor: "#0f766e", accentColor: "#fb7185" },
];
const HERO_LAYOUTS = [
  { key: "split-card", label: "Split with service card" },
  { key: "full-bleed", label: "Full-bleed image" },
  { key: "minimal-center", label: "Minimal centered" },
];
const TABS = [
  { key: "brand", label: "Brand", icon: Palette },
  { key: "mobileapp", label: "Mobile App", icon: Smartphone },
  { key: "hero", label: "Hero", icon: Sparkles },
  { key: "services", label: "Service Times", icon: Clock },
  { key: "sections", label: "Sections", icon: Layers },
  { key: "seo", label: "SEO", icon: Search },
  { key: "history", label: "History", icon: History },
];

function normalizeBrand(data) {
  return { ...blankBrand, ...(data || {}), socialLinks: Array.isArray(data?.socialLinks) ? data.socialLinks : [] };
}
function normalizeDraft(data) {
  return {
    ...blankDraft, ...(data || {}),
    serviceTimes: Array.isArray(data?.serviceTimes) ? data.serviceTimes : [],
    sections: Array.isArray(data?.sections) && data.sections.length ? data.sections : [templateFor("story"), templateFor("feature-grid"), templateFor("cta")],
  };
}

export default function TenantLandingEditorPage() {
  const [tab, setTab] = useState("brand");
  const [brand, setBrand] = useState(blankBrand);
  const [draft, setDraft] = useState(blankDraft);
  const [published, setPublished] = useState(true);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [tenantName, setTenantName] = useState("Church");

  async function loadAll() {
    setBusy(true);
    setMessage("");
    try {
      const [brandData, draftData, liveData, versionData] = await Promise.all([
        getTenantBranding(), getTenantLandingDraft(), getTenantLanding(), getTenantLandingVersions(),
      ]);
      setBrand(normalizeBrand(brandData));
      setDraft(normalizeDraft(draftData));
      setPublished(Boolean(liveData?.published));
      setTenantName(liveData?.heroTitle || draftData?.heroTitle || "Church");
      setVersions(Array.isArray(versionData) ? versionData : []);
    } catch (error) {
      setMessage(error?.message || "Could not load the landing page editor.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function uploadImage(file, onUrl, key = "image") {
    if (!file) return;
    setUploadingKey(key);
    setMessage("");
    try {
      const token = getToken();
      const payload = new FormData();
      payload.append("file", file);
      payload.append("purpose", "branding");
      const res = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: "include",
        body: payload,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const url = data?.url || data?.Url || data?.absoluteUrl || data?.AbsoluteUrl || "";
      if (!url) throw new Error("Upload succeeded but no image URL was returned.");
      onUrl(url);
      setMessage("Image uploaded.");
    } catch (error) {
      setMessage(error?.message || "Could not upload image.");
    } finally {
      setUploadingKey("");
    }
  }

  function setBrandField(key, value) { setBrand((prev) => ({ ...prev, [key]: value })); }
  function setDraftField(key, value) { setDraft((prev) => ({ ...prev, [key]: value })); }

  async function saveBrand() {
    setBusy(true); setMessage("");
    try {
      const saved = await saveTenantBranding(brand);
      setBrand(normalizeBrand(saved));
      window.dispatchEvent(new CustomEvent("mahima:tenant-brand-changed", { detail: { logoUrl: saved?.logoUrl } }));
      setMessage("Brand saved — this is live immediately across the site and print templates.");
    } catch (error) {
      setMessage(error?.message || "Could not save brand.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(silent = false) {
    setBusy(true); if (!silent) setMessage("");
    try {
      const saved = await saveTenantLandingDraft(draft);
      setDraft(normalizeDraft(saved));
      if (!silent) setMessage("Draft saved. It is not visible to visitors until you Publish.");
      return true;
    } catch (error) {
      setMessage(error?.message || "Could not save draft.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const ok = await saveDraft(true);
    if (!ok) return;
    setBusy(true); setMessage("");
    try {
      await publishTenantLanding();
      const [liveData, versionData] = await Promise.all([getTenantLanding(), getTenantLandingVersions()]);
      setPublished(Boolean(liveData?.published));
      setVersions(Array.isArray(versionData) ? versionData : []);
      setMessage("Published. Your public page is now updated.");
    } catch (error) {
      setMessage(error?.message || "Could not publish.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility() {
    setBusy(true); setMessage("");
    try {
      const result = await setTenantLandingVisibility(!published);
      setPublished(Boolean(result?.published));
      setMessage(result?.published ? "Site is now visible to the public." : "Site is now hidden from the public.");
    } catch (error) {
      setMessage(error?.message || "Could not change site visibility.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreVersion(id) {
    setBusy(true); setMessage("");
    try {
      const restored = await restoreTenantLandingVersion(id);
      setDraft(normalizeDraft(restored));
      setTab("hero");
      setMessage("That version was restored into your draft. Review it, then Publish to make it live.");
    } catch (error) {
      setMessage(error?.message || "Could not restore that version.");
    } finally {
      setBusy(false);
    }
  }

  // Service times
  function addService() { setDraftField("serviceTimes", [...draft.serviceTimes, { day: "Sunday", title: "Worship Service", time: "10:00 AM", note: "" }]); }
  function updateService(index, patch) { setDraftField("serviceTimes", draft.serviceTimes.map((s, i) => (i === index ? { ...s, ...patch } : s))); }
  function removeService(index) { setDraftField("serviceTimes", draft.serviceTimes.filter((_, i) => i !== index)); }

  // Social links (brand)
  function addSocial() { setBrandField("socialLinks", [...brand.socialLinks, { label: "Facebook", url: "" }]); }
  function updateSocial(index, patch) { setBrandField("socialLinks", brand.socialLinks.map((s, i) => (i === index ? { ...s, ...patch } : s))); }
  function removeSocial(index) { setBrandField("socialLinks", brand.socialLinks.filter((_, i) => i !== index)); }

  // Sections
  function addSection(type) { setDraftField("sections", [...draft.sections, templateFor(type)]); }
  function updateSection(index, patch) { setDraftField("sections", draft.sections.map((s, i) => (i === index ? { ...s, ...patch } : s))); }
  function removeSection(index) { setDraftField("sections", draft.sections.filter((_, i) => i !== index)); }
  function reorderSections(fromIndex, toIndex) { setDraftField("sections", arrayMove(draft.sections, fromIndex, toIndex)); }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  function onSectionDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = draft.sections.findIndex((_, i) => `section-${i}` === active.id);
    const to = draft.sections.findIndex((_, i) => `section-${i}` === over.id);
    if (from >= 0 && to >= 0) reorderSections(from, to);
  }

  const previewTenant = useMemo(() => ({ name: tenantName }), [tenantName]);

  return (
    <div className="min-h-full bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto grid max-w-[1600px] gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 space-y-5">
          <div className="mahima-standard-page-header rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-mahima-explicit-header="true">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe2 className="h-5 w-5 text-emerald-700" />
                <h1 className="mahima-standard-page-title text-2xl font-black text-slate-900" data-mahima-explicit-title="true">Church Landing Page</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button" onClick={toggleVisibility} disabled={busy}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${published ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
                >
                  <CheckCircle2 className="h-4 w-4" /> {published ? "Site is live" : "Site is hidden"}
                </button>
                <SmallButton type="button" onClick={() => saveDraft(false)} disabled={busy}><Save className="h-4 w-4" /> Save Draft</SmallButton>
                <button type="button" onClick={publish} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Publish
                </button>
              </div>
            </div>
            <p className="mahima-standard-page-subtitle mt-2 text-sm text-slate-600">
              Brand saves immediately. Hero, Service Times, Sections, and SEO save as a draft — nothing visitors see changes until you Publish.
            </p>
          </div>

          {message && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{message}</div>}

          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black ${tab === key ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {tab === "brand" && (
            <Panel title="Brand" action={<SmallButton type="button" onClick={saveBrand} disabled={busy}><Save className="h-4 w-4" /> Save Brand</SmallButton>}>
              <div className="grid gap-4 md:grid-cols-2">
                <ImageUrlField label="Logo" value={brand.logoUrl} onChange={(v) => setBrandField("logoUrl", v)} onUpload={(file) => uploadImage(file, (url) => setBrandField("logoUrl", url), "logo")} uploading={uploadingKey === "logo"} />
                <ColorField label="Primary color" value={brand.primaryColor} onChange={(v) => setBrandField("primaryColor", v)} />
                <ColorField label="Accent color" value={brand.accentColor} onChange={(v) => setBrandField("accentColor", v)} />
                <ColorField label="Neutral color" value={brand.neutralColor} onChange={(v) => setBrandField("neutralColor", v)} />
                <ColorField label="Dark color" value={brand.darkColor} onChange={(v) => setBrandField("darkColor", v)} />
                <FontField label="Heading font" value={brand.headingFont} onChange={(v) => setBrandField("headingFont", v)} />
                <FontField label="Body font" value={brand.bodyFont} onChange={(v) => setBrandField("bodyFont", v)} />
              </div>
              <div className="mt-4">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Palette presets</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {palettePresets.map((palette) => (
                    <button key={palette.name} type="button" onClick={() => setBrand((prev) => ({ ...prev, primaryColor: palette.primaryColor, accentColor: palette.accentColor }))} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                      <span className="inline-flex overflow-hidden rounded-full ring-1 ring-slate-200"><span className="h-4 w-4" style={{ background: palette.primaryColor }} /><span className="h-4 w-4" style={{ background: palette.accentColor }} /></span>
                      {palette.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextField label="Contact email" value={brand.contactEmail} onChange={(v) => setBrandField("contactEmail", v)} />
                <TextField label="Contact phone" value={brand.contactPhone} onChange={(v) => setBrandField("contactPhone", v)} />
                <label className="md:col-span-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Address</span>
                  <textarea value={brand.address || ""} onChange={(e) => setBrandField("address", e.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500" />
                </label>
              </div>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between"><b className="text-sm text-slate-700">Social links</b><AddItemButton label="Add Link" onClick={addSocial} /></div>
                <div className="grid gap-3">
                  {brand.socialLinks.map((link, index) => (
                    <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_2fr_auto]">
                      <TextField label="Label" value={link.label} onChange={(v) => updateSocial(index, { label: v })} />
                      <TextField label="URL" value={link.url} onChange={(v) => updateSocial(index, { url: v })} />
                      <RemoveItemButton onClick={() => removeSocial(index)} />
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {tab === "mobileapp" && <MobileAppPanel />}

          {tab === "hero" && (
            <Panel title="Hero">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField label="Hero title" value={draft.heroTitle} onChange={(v) => setDraftField("heroTitle", v)} required />
                <TextField label="Hero subtitle" value={draft.heroSubtitle} onChange={(v) => setDraftField("heroSubtitle", v)} />
                <ImageUrlField label="Hero image" value={draft.heroImageUrl} onChange={(v) => setDraftField("heroImageUrl", v)} onUpload={(file) => uploadImage(file, (url) => setDraftField("heroImageUrl", url), "hero")} uploading={uploadingKey === "hero"} hint="Recommended 1920x1080" />
              </div>
              <div className="mt-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Layout</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {HERO_LAYOUTS.map((layout) => (
                    <button key={layout.key} type="button" onClick={() => setDraftField("heroLayout", layout.key)} className={`rounded-lg border p-3 text-left text-sm font-bold ${draft.heroLayout === layout.key ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700"}`}>
                      {layout.label}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {tab === "services" && (
            <Panel title="Service Times" action={<AddItemButton label="Add Service" onClick={addService} />}>
              <div className="grid gap-3">
                {draft.serviceTimes.map((service, index) => (
                  <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                    <TextField label="Day" value={service.day} onChange={(v) => updateService(index, { day: v })} />
                    <TextField label="Title" value={service.title} onChange={(v) => updateService(index, { title: v })} />
                    <TextField label="Time" value={service.time} onChange={(v) => updateService(index, { time: v })} />
                    <TextField label="Note" value={service.note} onChange={(v) => updateService(index, { note: v })} />
                    <RemoveItemButton onClick={() => removeService(index)} />
                  </div>
                ))}
                {!draft.serviceTimes.length && <p className="text-sm text-slate-500">No service times yet — add your first gathering above.</p>}
              </div>
            </Panel>
          )}

          {tab === "sections" && (
            <Panel
              title="Page Sections"
              action={
                <select onChange={(e) => { if (e.target.value) { addSection(e.target.value); e.target.value = ""; } }} defaultValue="" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">
                  <option value="" disabled>+ Add section…</option>
                  {SECTION_TYPES.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
                </select>
              }
            >
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
                <SortableContext items={draft.sections.map((_, i) => `section-${i}`)} strategy={verticalListSortingStrategy}>
                  <div className="grid gap-4">
                    {draft.sections.map((section, index) => (
                      <SortableSection key={`section-${index}`} id={`section-${index}`} section={section} typeLabel={SECTION_TYPES.find((t) => t.type === section.type)?.label || section.type} onRemove={() => removeSection(index)}>
                        <SectionFormRenderer section={section} update={(patch) => updateSection(index, patch)} uploadImage={uploadImage} uploadingKey={uploadingKey} />
                      </SortableSection>
                    ))}
                    {!draft.sections.length && <p className="text-sm text-slate-500">No sections yet — use "+ Add section" above.</p>}
                  </div>
                </SortableContext>
              </DndContext>
            </Panel>
          )}

          {tab === "seo" && (
            <Panel title="SEO & Sharing">
              <div className="grid gap-4">
                <TextField label="SEO title" value={draft.seoTitle} onChange={(v) => setDraftField("seoTitle", v)} placeholder={draft.heroTitle || "Defaults to hero title"} />
                <label>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">SEO description</span>
                  <textarea value={draft.seoDescription || ""} onChange={(e) => setDraftField("seoDescription", e.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500" placeholder="Shown in search results and link previews." />
                </label>
                <ImageUrlField label="Social share image" value={draft.ogImageUrl} onChange={(v) => setDraftField("ogImageUrl", v)} onUpload={(file) => uploadImage(file, (url) => setDraftField("ogImageUrl", url), "og")} uploading={uploadingKey === "og"} hint="Recommended 1200x630" />
                <p className="text-xs text-slate-500">These tags are injected client-side. They help most modern crawlers and link previews, but are not a substitute for full server-side rendering.</p>
              </div>
            </Panel>
          )}

          {tab === "history" && (
            <Panel title="Version History">
              <div className="grid gap-3">
                {versions.map((version) => (
                  <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{version.heroTitle || "Untitled version"}</div>
                      <div className="text-xs text-slate-500">{version.publishedAtUtc ? new Date(version.publishedAtUtc).toLocaleString() : ""}</div>
                    </div>
                    <SmallButton type="button" onClick={() => restoreVersion(version.id)} disabled={busy}><RotateCcw className="h-4 w-4" /> Restore to draft</SmallButton>
                  </div>
                ))}
                {!versions.length && <p className="text-sm text-slate-500">No published versions yet — Publish once to start building history.</p>}
              </div>
            </Panel>
          )}
        </div>

        <aside className="xl:sticky xl:top-20 xl:h-fit">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-black text-slate-700"><Eye className="h-4 w-4" /> Live preview</div>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
                <button type="button" onClick={() => setPreviewDevice("desktop")} className={`grid h-8 w-8 place-items-center rounded-md ${previewDevice === "desktop" ? "bg-white shadow" : ""}`} aria-label="Desktop preview"><Monitor className="h-4 w-4" /></button>
                <button type="button" onClick={() => setPreviewDevice("mobile")} className={`grid h-8 w-8 place-items-center rounded-md ${previewDevice === "mobile" ? "bg-white shadow" : ""}`} aria-label="Mobile preview"><Smartphone className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100" style={{ maxHeight: "78vh", overflowY: "auto" }}>
              <div style={{ width: previewDevice === "mobile" ? 390 : "100%", margin: previewDevice === "mobile" ? "0 auto" : 0, transition: "width 0.2s ease" }}>
                <PublicLandingView tenant={previewTenant} branding={brand} landing={draft} previewMode />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SortableSection({ id, section, typeLabel, children, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" {...attributes} {...listeners} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600" aria-label="Drag to reorder" title="Drag to reorder">
          ⠿ {typeLabel}
        </button>
        <RemoveItemButton onClick={onRemove} label="Remove section" />
      </div>
      {children}
    </div>
  );
}

const BUILD_STAGES = [
  { key: "Queued", label: "Queued" },
  { key: "FetchingBranding", label: "Fetching branding" },
  { key: "DownloadingLogo", label: "Downloading logo" },
  { key: "GeneratingIcons", label: "Generating icons" },
  { key: "BuildingWebBundle", label: "Building app bundle" },
  { key: "AssemblingApk", label: "Assembling APK" },
  { key: "Ready", label: "Ready to publish" },
];
const ACTIVE_BUILD_STAGES = new Set(BUILD_STAGES.slice(0, -1).map((s) => s.key));

async function appBuildRequest(path, method, body) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.title || `Request failed (${res.status})`);
  return data;
}

function MobileAppPanel() {
  const [copied, setCopied] = useState(false);
  const slug = activeTenantSlug();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [genVersion, setGenVersion] = useState("1.0.0");
  const [actionError, setActionError] = useState("");
  const [publishForm, setPublishForm] = useState({ version: "1.0.0", releaseNotes: "", forceUpgrade: false });
  const [publishing, setPublishing] = useState(false);

  async function loadStatus() {
    if (!slug) return;
    try {
      const data = await appBuildRequest(`/tenants/${encodeURIComponent(slug)}/app-build/status`, "GET");
      setStatus(data);
      setStatusError("");
      if (data.version) setPublishForm((prev) => ({ ...prev, version: data.version }));
    } catch (err) {
      setStatusError(err?.message || "Could not load app build status.");
    }
  }

  useEffect(() => { loadStatus(); }, [slug]);

  useEffect(() => {
    const active = status && ACTIVE_BUILD_STAGES.has(status.stage);
    if (!active) return undefined;
    const id = setInterval(loadStatus, 2000);
    return () => clearInterval(id);
  }, [status?.stage, slug]);

  if (!slug) return null;

  const link = `${window.location.origin}/#/t/${encodeURIComponent(slug)}/app-downloads`;
  const isBuilding = Boolean(status && ACTIVE_BUILD_STAGES.has(status.stage) && status.stage !== "Ready");
  const canPublish = Boolean(status?.canPublish) && !publishing;
  const currentStageIndex = BUILD_STAGES.findIndex((s) => s.key === status?.stage);

  function copyLink() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleGenerate() {
    setActionError("");
    try {
      const data = await appBuildRequest(`/tenants/${encodeURIComponent(slug)}/app-build/generate`, "POST", { version: genVersion });
      setStatus(data);
    } catch (err) {
      setActionError(err?.message || "Could not start the build.");
    }
  }

  async function handlePublish(event) {
    event.preventDefault();
    setActionError("");
    setPublishing(true);
    try {
      await appBuildRequest(`/tenants/${encodeURIComponent(slug)}/app-build/publish`, "POST", {
        version: publishForm.version,
        releaseNotes: publishForm.releaseNotes,
        forceUpgrade: publishForm.forceUpgrade,
      });
      await loadStatus();
    } catch (err) {
      setActionError(err?.message || "Could not publish the app.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel title="Generate Your Church's App">
        <p className="text-sm font-medium text-slate-600">
          Builds an Android app with your church's own logo, name, and icon. Takes a few minutes.
        </p>

        {status?.stage === "Idle" || !isBuilding ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Version</span>
              <input
                value={genVersion}
                onChange={(e) => setGenVersion(e.target.value)}
                placeholder="1.0.0"
                className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500"
              />
            </label>
            <SmallButton type="button" onClick={handleGenerate} disabled={isBuilding}>
              <Smartphone className="h-4 w-4" /> Generate APK
            </SmallButton>
          </div>
        ) : null}

        {(actionError || statusError) && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
            {actionError || statusError}
          </div>
        )}

        {status && status.stage !== "Idle" && (
          <div className="mt-5 grid gap-2">
            {BUILD_STAGES.map((stage, index) => {
              const done = index < currentStageIndex || (status.stage === "Ready" && index === currentStageIndex);
              const active = status.stage === stage.key;
              return (
                <div key={stage.key} className={`flex items-center gap-3 rounded-lg p-2 ${active ? "bg-emerald-50" : ""}`}>
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : active ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-600" />
                  ) : (
                    <span className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-200" />
                  )}
                  <span className={`text-sm font-bold ${done || active ? "text-slate-900" : "text-slate-400"}`}>{stage.label}</span>
                </div>
              );
            })}
            {status.stage === "Failed" && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                {status.errorMessage || "The build failed."}
              </div>
            )}
            {status.stage === "Published" && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="h-5 w-5" /> Live - version {status.version}
              </div>
            )}
          </div>
        )}
      </Panel>

      {status?.canPublish && (
        <Panel title="Publish APK">
          <p className="text-sm font-medium text-slate-600">
            Makes the generated build live on your download page for members to install.
          </p>
          <form onSubmit={handlePublish} className="mt-4 grid gap-4 md:grid-cols-2">
            <label>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Version</span>
              <input
                value={publishForm.version}
                onChange={(e) => setPublishForm((p) => ({ ...p, version: e.target.value }))}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="md:col-span-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Release notes</span>
              <input
                value={publishForm.releaseNotes}
                onChange={(e) => setPublishForm((p) => ({ ...p, releaseNotes: e.target.value }))}
                placeholder="What's new in this release?"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={publishForm.forceUpgrade}
                onChange={(e) => setPublishForm((p) => ({ ...p, forceUpgrade: e.target.checked }))}
                className="h-4 w-4 accent-emerald-700"
              />
              Force upgrade for older app versions
            </label>
            <div>
              <SmallButton type="submit" disabled={!canPublish}>
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {publishing ? "Publishing..." : "Publish APK"}
              </SmallButton>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="Mobile App Download Page">
        <p className="text-sm font-medium text-slate-600">
          Share this link with your members and admins so they can download your church's own branded mobile app.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">{link}</code>
          <SmallButton type="button" onClick={copyLink}>
            <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy link"}
          </SmallButton>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black text-slate-900">{title}</h2>{action}</div>
      {children}
    </section>
  );
}
