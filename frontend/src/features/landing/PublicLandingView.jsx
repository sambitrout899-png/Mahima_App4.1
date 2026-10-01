import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, Clock, ExternalLink, Mail, MapPin, Menu, Phone, Sparkles, X } from "lucide-react";
import { getToken, logout as authLogout } from "../auth/authService";
import { tenantLoginRoute } from "../../utils/tenantNavigation";
import TenantLogo from "../../components/TenantLogo";
import SectionRenderer from "./sections/SectionRenderer";
import SectionHeading from "./sections/SectionHeading";
import { resolveAsset, buildTheme } from "./sections/shared";

const TENANT_SLUG_KEY = "mahima_tenant_slug";
const AUTH_TENANT_SLUG_KEY = "mahima_auth_tenant_slug";

function hasToken() {
  return Boolean(localStorage.getItem("mahima_token") || localStorage.getItem("authToken") || localStorage.getItem("token") || getToken?.());
}

function getTenantSlugFromStorage() {
  try {
    return (localStorage.getItem(TENANT_SLUG_KEY) || localStorage.getItem("tenantSlug") || "").trim();
  } catch {
    return "";
  }
}

function hasCurrentTenantToken() {
  const tenantSlug = getTenantSlugFromStorage();
  if (!hasToken()) return false;
  if (!tenantSlug) return true;
  const authTenantSlug = (localStorage.getItem(AUTH_TENANT_SLUG_KEY) || "").trim();
  return authTenantSlug === tenantSlug;
}

/**
 * Renders a tenant's full public landing page. Used both for the real public site
 * (fed with fetched data by HomeLanding.jsx) and for the admin editor's live preview
 * (fed with in-memory draft state) — the exact same component either way, so what an
 * admin sees while editing is guaranteed to match what visitors see once published.
 */
export default function PublicLandingView({ tenant = {}, branding = {}, landing = {}, previewMode = false }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useMemo(() => buildTheme(branding), [branding]);
  const heroImage = resolveAsset(landing.heroImageUrl);
  const serviceTimes = Array.isArray(landing.serviceTimes) ? landing.serviceTimes : [];
  const sections = Array.isArray(landing.sections) ? landing.sections : [];
  const socialLinks = Array.isArray(branding.socialLinks) ? branding.socialLinks : [];
  const heroLayout = landing.heroLayout || "split-card";

  function goLogin() {
    if (previewMode) return;
    const tenantSlug = getTenantSlugFromStorage();
    const currentHost = window.location.hostname.replace(/^www\./i, "").toLowerCase();
    const tenantHost = String(tenant.domain || tenant.Domain || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
    const onTenantDomain = tenantHost && currentHost === tenantHost;
    const loginPath = onTenantDomain ? "/#/login" : tenantSlug ? `/#/login?tenant=${encodeURIComponent(tenantSlug)}` : "/#/login";
    if (!tenantSlug && hasCurrentTenantToken()) navigate("/home");
    else window.location.href = loginPath;
  }

  function logout() {
    if (previewMode) return;
    const tenantSlug = getTenantSlugFromStorage();
    authLogout();
    localStorage.removeItem("mahima_user");
    navigate(tenantLoginRoute(tenantSlug), { replace: true });
  }

  function scrollTo(id) {
    if (previewMode) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  const loggedIn = !previewMode && hasCurrentTenantToken();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950" style={{ "--tenant-primary": theme.primary, "--tenant-accent": theme.accent, fontFamily: theme.bodyFont }}>
      <header className="sticky top-0 z-40 border-b border-white/30 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <button type="button" onClick={() => scrollTo("hero-top")} className="flex items-center gap-3 text-left">
            <TenantLogo src={branding.logoUrl} name={tenant.name || landing.heroTitle} className="h-11 w-11 rounded-lg shadow-sm" />
            <span>
              <span className="block text-lg font-black leading-tight" style={{ fontFamily: theme.headingFont }}>{tenant.name || landing.heroTitle}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Church community</span>
            </span>
          </button>

          <nav className="hidden items-center gap-2 md:flex">
            <button type="button" onClick={() => scrollTo("services")} className="rounded-full px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Services</button>
            <button type="button" onClick={() => scrollTo("sections")} className="rounded-full px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Ministries</button>
            <button type="button" onClick={() => scrollTo("contact")} className="rounded-full px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Contact</button>
            {socialLinks.map((link, index) => (
              <a key={`${link.label || link.url}-${index}`} href={link.url} target="_blank" rel="noreferrer" className="rounded-full px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                {link.label || "Social"} <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>
            ))}
            {loggedIn ? (
              <button type="button" onClick={logout} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white">Logout</button>
            ) : (
              <button type="button" onClick={goLogin} className="rounded-full bg-[var(--tenant-primary)] px-4 py-2 text-sm font-black text-white">Login</button>
            )}
          </nav>

          <button type="button" onClick={() => setMenuOpen(true)} className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 md:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 p-4 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="ml-auto max-w-xs rounded-lg bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <b>{tenant.name}</b>
              <button type="button" onClick={() => setMenuOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => { setMenuOpen(false); setTimeout(() => scrollTo("services"), 50); }} className="rounded-lg px-4 py-3 text-left text-sm font-black text-slate-700 hover:bg-slate-100">Services</button>
              <button type="button" onClick={() => { setMenuOpen(false); setTimeout(() => scrollTo("sections"), 50); }} className="rounded-lg px-4 py-3 text-left text-sm font-black text-slate-700 hover:bg-slate-100">Ministries</button>
              <button type="button" onClick={() => { setMenuOpen(false); setTimeout(() => scrollTo("contact"), 50); }} className="rounded-lg px-4 py-3 text-left text-sm font-black text-slate-700 hover:bg-slate-100">Contact</button>
              <button type="button" onClick={goLogin} className="rounded-lg bg-[var(--tenant-primary)] px-4 py-3 text-left text-sm font-black text-white">{loggedIn ? "Open App" : "Login"}</button>
            </div>
          </div>
        </div>
      )}

      <HeroSection id="hero-top" layout={heroLayout} tenant={tenant} landing={landing} theme={theme} heroImage={heroImage} serviceTimes={serviceTimes} loggedIn={loggedIn} goLogin={goLogin} scrollTo={scrollTo} />

      <section id="services" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionHeading eyebrow="Gatherings" title="Service Times" subtitle="Every tenant can set its own worship and prayer schedule." theme={theme} />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {serviceTimes.map((service, index) => <ServiceCard key={`${service.day}-${service.title}-${index}`} service={service} theme={theme} large />)}
        </div>
      </section>

      <section id="sections" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {sections.map((section, index) => <SectionRenderer key={`${section.type || "section"}-${index}`} section={section} theme={theme} branding={branding} />)}
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:grid-cols-[1fr_420px]">
          <div>
            <SectionHeading eyebrow="Contact" title={`Visit ${tenant.name || "us"}`} subtitle="Each tenant owns these details from the Landing Page editor." theme={theme} />
            <div className="mt-6 grid gap-3 text-sm font-semibold text-slate-700">
              {branding.contactPhone && <ContactLine icon={Phone} text={branding.contactPhone} href={`tel:${branding.contactPhone}`} theme={theme} />}
              {branding.contactEmail && <ContactLine icon={Mail} text={branding.contactEmail} href={`mailto:${branding.contactEmail}`} theme={theme} />}
              {branding.address && <ContactLine icon={MapPin} text={branding.address} theme={theme} />}
            </div>
          </div>
          <div className="rounded-xl p-5 text-white" style={{ background: theme.primary }}>
            <h3 className="text-2xl font-black">Ready to connect?</h3>
            <p className="mt-2 text-white/80">Login to access this church community, requests, sermons, teams, and licensed modules.</p>
            <button type="button" onClick={goLogin} className="mt-5 rounded-full bg-white px-5 py-3 text-sm font-black text-slate-950">{loggedIn ? "Open App" : "Login"}</button>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
        {tenant.name || landing.heroTitle} - Powered by Mahima Innovation Center (MIC)
      </footer>
    </main>
  );
}

function HeroSection({ id, layout, tenant, landing, theme, heroImage, serviceTimes, loggedIn, goLogin, scrollTo }) {
  if (layout === "minimal-center") {
    return (
      <section id={id} className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${theme.dark} 0%, ${theme.primary} 100%)` }} />
        <div className="relative mx-auto max-w-4xl px-4 py-24 text-center text-white sm:px-6">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-bold backdrop-blur"><Sparkles className="h-4 w-4" /> {tenant.name || "Your church"}</div>
          <h1 className="mt-6 text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl" style={{ fontFamily: theme.headingFont }}>{landing.heroTitle || tenant.name}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-white/85">{landing.heroSubtitle || "A church community powered by Mahima."}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={goLogin} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950 shadow-lg">{loggedIn ? "Open App" : "Member Login"} <ArrowRight className="h-4 w-4" /></button>
            <button type="button" onClick={() => scrollTo("contact")} className="rounded-full border border-white/30 px-6 py-3 text-sm font-black text-white">Visit Us</button>
          </div>
        </div>
      </section>
    );
  }

  if (layout === "full-bleed") {
    return (
      <section id={id} className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, ${theme.dark} 100%)`, zIndex: 1 }} />
        {heroImage ? <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.dark})` }} />}
        <div className="relative z-10 mx-auto flex min-h-[560px] max-w-7xl flex-col justify-end gap-6 px-4 py-16 text-white sm:px-6">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-bold backdrop-blur"><Sparkles className="h-4 w-4" /> {tenant.name || "Your church"}</div>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl" style={{ fontFamily: theme.headingFont }}>{landing.heroTitle || tenant.name}</h1>
          <p className="max-w-2xl text-xl leading-8 text-white/85">{landing.heroSubtitle || "A church community powered by Mahima."}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={goLogin} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950 shadow-lg">{loggedIn ? "Open App" : "Member Login"} <ArrowRight className="h-4 w-4" /></button>
            <button type="button" onClick={() => scrollTo("contact")} className="rounded-full border border-white/30 px-6 py-3 text-sm font-black text-white">Visit Us</button>
          </div>
        </div>
      </section>
    );
  }

  // split-card (default)
  return (
    <section id={id} className="relative overflow-hidden">
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.dark} 55%, ${theme.accent} 130%)` }} />
      {heroImage && <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-screen" />}
      <div className="relative mx-auto grid min-h-[620px] max-w-7xl items-center gap-8 px-4 py-16 text-white sm:px-6 lg:grid-cols-[1fr_420px]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-bold backdrop-blur"><Sparkles className="h-4 w-4" /> {tenant.name || "Your church"}</div>
          <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl" style={{ fontFamily: theme.headingFont }}>{landing.heroTitle || tenant.name}</h1>
          <p className="mt-6 max-w-2xl text-xl leading-8 text-white/85">{landing.heroSubtitle || "A church community powered by Mahima."}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={goLogin} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950 shadow-lg">{loggedIn ? "Open App" : "Member Login"} <ArrowRight className="h-4 w-4" /></button>
            <button type="button" onClick={() => scrollTo("contact")} className="rounded-full border border-white/30 px-6 py-3 text-sm font-black text-white">Visit Us</button>
          </div>
        </div>
        <div className="rounded-2xl bg-white/95 p-5 text-slate-950 shadow-2xl">
          <h2 className="text-xl font-black">This Week</h2>
          <div className="mt-4 grid gap-3">
            {serviceTimes.slice(0, 4).map((service, index) => <ServiceCard key={`${service.day}-${service.title}-${index}`} service={service} theme={theme} />)}
            {!serviceTimes.length && <p className="text-sm text-slate-500">Service times are not configured yet.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ service, theme, large = false }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${large ? "min-h-40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide" style={{ color: theme.accent }}>
            <CalendarDays className="h-4 w-4" /> {service.day || "Service"}
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">{service.title || "Gathering"}</h3>
        </div>
        <Clock className="h-5 w-5 text-slate-400" />
      </div>
      <p className="mt-3 text-sm font-bold text-slate-700">{service.time || "Time to be announced"}</p>
      {service.note && <p className="mt-2 text-sm text-slate-500">{service.note}</p>}
    </div>
  );
}

function ContactLine({ icon: Icon, text, href, theme }) {
  const content = (<><Icon className="h-4 w-4 shrink-0" style={{ color: theme.primary }} /><span>{text}</span></>);
  if (href) return <a href={href} className="flex items-start gap-3 hover:opacity-80">{content}</a>;
  return <div className="flex items-start gap-3">{content}</div>;
}
