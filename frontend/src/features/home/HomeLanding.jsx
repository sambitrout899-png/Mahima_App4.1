import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Clock,
  HandHeart,
  Headphones,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";
import { API_BASE } from "../../api";
import { getToken } from "../auth/authService";
import PublicLandingView from "../landing/PublicLandingView";
import SectionRenderer from "../landing/sections/SectionRenderer";
import { buildTheme, resolveAsset } from "../landing/sections/shared";

const TENANT_SLUG_KEY = "mahima_tenant_slug";
const AUTH_TENANT_SLUG_KEY = "mahima_auth_tenant_slug";

const fallbackConfig = {
  tenant: { name: "Church Community", slug: "mahima-root" },
  landing: {
    logoUrl: "",
    heroImageUrl: "",
    heroTitle: "Church Community",
    heroSubtitle: "Welcome to this church community.",
    heroLayout: "split-card",
    primaryColor: "#0f766e",
    accentColor: "#f59e0b",
    neutralColor: "#f8fafc",
    darkColor: "#0f172a",
    headingFont: "Inter",
    bodyFont: "Inter",
    contactEmail: "Contact@mahimaministries.in",
    contactPhone: "+91 7087775465",
    address: "Universal Public School, Gurunanak Nagar, Gulab Devi Road, Jalandhar, Punjab 144021",
    serviceTimes: [
      { day: "Saturday", title: "Worship Service", time: "6:00 - 9:00 PM", note: "Weekly gathering" },
      { day: "Tuesday", title: "Night Prayer", time: "10:30 PM", note: "Prayer line" },
      { day: "Friday", title: "Night Prayer", time: "10:30 PM", note: "Prayer line" },
    ],
    socialLinks: [],
    sections: [
      {
        type: "feature-grid",
        title: "Ministry life",
        subtitle: "Configure these cards from Landing Page admin.",
        items: [
          { title: "Prayer", text: "Share requests and stand together in faith." },
          { title: "Fellowship", text: "Build a warm church community." },
          { title: "Word", text: "Grow through messages and teaching." },
        ],
      },
      { type: "cta", title: "Join us this week", text: "We would love to welcome you.", buttonLabel: "Login", buttonHref: "/#/login" },
    ],
    published: true,
  },
};

function normalizeLandingResponse(data) {
  const tenant = data?.tenant || fallbackConfig.tenant;
  const landing = { ...fallbackConfig.landing, ...(data?.landing || data || {}) };
  landing.serviceTimes = Array.isArray(landing.serviceTimes) ? landing.serviceTimes : [];
  landing.socialLinks = Array.isArray(landing.socialLinks) ? landing.socialLinks : [];
  landing.sections = Array.isArray(landing.sections) ? landing.sections : [];
  return { tenant, landing };
}

function hasToken() {
  return Boolean(localStorage.getItem("mahima_token") || localStorage.getItem("authToken") || localStorage.getItem("token") || getToken?.());
}

function hasCurrentTenantToken() {
  const tenantSlug = getTenantSlug();
  if (!hasToken()) return false;
  if (!tenantSlug) return true;
  const authTenantSlug = (localStorage.getItem(AUTH_TENANT_SLUG_KEY) || "").trim();
  return authTenantSlug === tenantSlug;
}

function getTenantSlug() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const hash = window.location.hash || "";
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    const hashTenantMatch = hash.match(/^#\/t\/([^/?#]+)/i);
    const fromUrl = (
      params.get("tenant") || params.get("tenantSlug") || hashParams.get("tenant") || hashParams.get("tenantSlug") ||
      (hashTenantMatch ? decodeURIComponent(hashTenantMatch[1]) : "") || ""
    ).trim();
    if (fromUrl) {
      localStorage.setItem(TENANT_SLUG_KEY, fromUrl);
      localStorage.setItem("tenantSlug", fromUrl);
      return fromUrl;
    }

    const host = window.location.hostname.toLowerCase();
    const isKnownMahimaHost = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local") || host.includes("mahimaministries.");
    if (!isKnownMahimaHost) return "";

    return (localStorage.getItem(TENANT_SLUG_KEY) || localStorage.getItem("tenantSlug") || localStorage.getItem("tenant_slug") || "").trim();
  } catch {
    return "";
  }
}

// Injects best-effort client-side SEO tags from the tenant's SEO fields. Not SSR/prerendering —
// helps JS-executing crawlers and share previews, not crawlers that don't run JavaScript.
function useSeoTags(tenant, landing) {
  useEffect(() => {
    const title = landing.seoTitle || landing.heroTitle || tenant.name;
    if (title) document.title = title;
    const description = landing.seoDescription || landing.heroSubtitle || "";
    const ogImage = resolveAsset(landing.ogImageUrl || landing.heroImageUrl);
    const setMeta = (attr, key, value) => {
      if (!value) return;
      let tag = document.querySelector(`meta[${attr}="${key}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", value);
    };
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    if (ogImage) setMeta("property", "og:image", ogImage);
  }, [tenant.name, landing.seoTitle, landing.seoDescription, landing.ogImageUrl, landing.heroTitle, landing.heroSubtitle, landing.heroImageUrl]);
}

export default function HomeLanding() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(fallbackConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tenantSlug = getTenantSlug();
    const landingUrl = tenantSlug
      ? `${API_BASE}/public/tenants/${encodeURIComponent(tenantSlug)}/landing`
      : `${API_BASE}/public/landing/current`;

    fetch(landingUrl, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : fallbackConfig))
      .then((data) => {
        if (cancelled) return;
        const slug = data?.tenant?.slug || data?.tenant?.Slug || "";
        if (slug) {
          localStorage.setItem("mahima_tenant_slug", slug);
          localStorage.setItem("tenantSlug", slug);
        }
        setConfig(normalizeLandingResponse(data));
      })
      .catch(() => { if (!cancelled) setConfig(fallbackConfig); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const { tenant, landing } = config;
  useSeoTags(tenant, landing);
  const heroImage = resolveAsset(landing.heroImageUrl);
  const isAuthenticatedHome = hasCurrentTenantToken() && /^#\/home(?:\/home)?(?:[/?#]|$)/i.test(window.location.hash || "");

  if (isAuthenticatedHome) {
    const theme = buildTheme(landing);
    return <MemberHome tenant={tenant} landing={landing} theme={theme} heroImage={heroImage} navigate={navigate} />;
  }

  // landing already carries both content and branding fields (merged server-side by
  // ToLandingDto), so the same object satisfies PublicLandingView's `landing` and
  // `branding` props — no field names collide between the two shapes.
  return <PublicLandingView tenant={tenant} branding={landing} landing={landing} />;
}

function MemberHome({ tenant, landing, theme, heroImage, navigate }) {
  const quickActions = [
    { label: "Read the Bible", hint: "Continue in the Word", to: "/home/bible", icon: BookOpen, tone: "emerald" },
    { label: "Prayer requests", hint: "Pray, care and follow up", to: "/home/prayerrequests", icon: HandHeart, tone: "rose" },
    { label: "Listen to sermons", hint: "Messages from your church", to: "/home/sermons", icon: Headphones, tone: "amber" },
    { label: "Open conversations", hint: "Connect with your community", to: "/home/chat", icon: MessageCircle, tone: "blue" },
  ];

  return (
    <div className="mahima-home-dashboard" style={{ "--tenant-primary": theme.primary, "--tenant-accent": theme.accent }}>
      <section className="mahima-home-hero mahima-home-hero-image-only" aria-label={`${tenant.name || "Church"} hero image`}>
        {heroImage && <img src={heroImage} alt="" className="mahima-home-hero-image absolute inset-0 h-full w-full object-cover" />}
      </section>

      {!!landing.sections?.length && (
        <section className="mahima-home-section" aria-labelledby="home-tenant-content">
          <div className="mahima-home-section-heading">
            <div><span>From your church</span><h2 id="home-tenant-content">Community highlights</h2></div>
            <p>Content maintained in your church Landing Page editor.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {landing.sections.map((section, index) => <SectionRenderer key={`${section.type || "section"}-${index}`} section={section} theme={theme} branding={landing} />)}
          </div>
        </section>
      )}

      <section className="mahima-home-section" aria-labelledby="home-quick-actions">
        <div className="mahima-home-section-heading">
          <div><span>Start here</span><h2 id="home-quick-actions">Your everyday ministry tools</h2></div>
          <p>Fast access to the things your community uses most.</p>
        </div>
        <div className="mahima-home-action-grid">
          {quickActions.map(({ label, hint, to, icon: Icon, tone }) => (
            <button key={to} type="button" onClick={() => navigate(to)} className={`mahima-home-action-card is-${tone}`}>
              <span className="mahima-home-action-icon"><Icon aria-hidden="true" /></span>
              <span className="mahima-home-action-copy"><strong>{label}</strong><small>{hint}</small></span>
              <ChevronRight className="mahima-home-action-arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <div className="mahima-home-lower-grid">
        <section className="mahima-home-gatherings" aria-labelledby="home-gatherings">
          <div className="mahima-home-section-heading compact"><div><span>Stay connected</span><h2 id="home-gatherings">This week at church</h2></div></div>
          <div className="mahima-home-service-list">
            {(landing.serviceTimes || []).slice(0, 4).map((service, index) => (
              <div className="mahima-home-service-row" key={`${service.day}-${service.title}-${index}`}>
                <div className="mahima-home-service-day"><CalendarDays aria-hidden="true" /><span>{service.day || "Service"}</span></div>
                <div className="mahima-home-service-copy"><strong>{service.title || "Gathering"}</strong><small>{service.note || "Church gathering"}</small></div>
                <div className="mahima-home-service-time"><Clock aria-hidden="true" /> {service.time || "TBA"}</div>
              </div>
            ))}
            {!landing.serviceTimes?.length && <div className="mahima-home-empty">Your tenant administrator can add this week's service schedule.</div>}
          </div>
        </section>

        <aside className="mahima-home-help">
          <div className="mahima-home-help-icon"><CircleHelp aria-hidden="true" /></div>
          <span>Need a little help?</span>
          <h2>Find your way around in minutes.</h2>
          <p>The user manual explains each available module on web and mobile with practical steps.</p>
          <button type="button" onClick={() => navigate("/home/user-manual")}>Open user manual <ArrowRight aria-hidden="true" /></button>
        </aside>
      </div>

      {(landing.contactPhone || landing.contactEmail || landing.address) && (
        <section className="mahima-home-section" aria-labelledby="home-contact-details">
          <div className="mahima-home-section-heading compact"><div><span>Church details</span><h2 id="home-contact-details">Contact {tenant.name || landing.heroTitle}</h2></div></div>
          <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 sm:grid-cols-3">
            {landing.contactPhone && <ContactLine icon={Phone} text={landing.contactPhone} href={`tel:${landing.contactPhone}`} />}
            {landing.contactEmail && <ContactLine icon={Mail} text={landing.contactEmail} href={`mailto:${landing.contactEmail}`} />}
            {landing.address && <ContactLine icon={MapPin} text={landing.address} />}
          </div>
        </section>
      )}
    </div>
  );
}

function ContactLine({ icon: Icon, text, href }) {
  const content = (<><Icon className="h-4 w-4 shrink-0 text-[var(--tenant-primary)]" /><span>{text}</span></>);
  if (href) return <a href={href} className="flex items-start gap-3 hover:text-[var(--tenant-primary)]">{content}</a>;
  return <div className="flex items-start gap-3">{content}</div>;
}
