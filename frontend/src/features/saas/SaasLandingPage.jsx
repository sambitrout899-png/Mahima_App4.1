import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Church, Copy, Globe2, HeartHandshake, Loader2, ShieldCheck, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { API_BASE } from "../../api";
import TenantLogo from "../../components/TenantLogo";
import "./SaasLandingPage.css";
import { FINAL_PRICING_CATALOG } from "../../config/pricingCatalog";

const TENANT_SLUG_KEY = "mahima_tenant_slug";
const COUNTRY_CODES = "IN,US,GB,CA,AU,NZ,ZA,NG,KE,GH,UG,TZ,RW,ET,EG,AE,SA,QA,KW,BH,OM,SG,MY,ID,PH,TH,VN,JP,KR,CN,HK,TW,NP,BD,LK,PK,BT,MM,AF,IL,JO,LB,TR,DE,FR,IT,ES,PT,NL,BE,CH,AT,SE,NO,DK,FI,IE,PL,CZ,SK,HU,RO,BG,GR,UA,HR,RS,SI,EE,LV,LT,BR,AR,CL,CO,PE,EC,BO,PY,UY,VE,MX,CR,PA,GT,HN,SV,NI,DO,JM,TT,BS,BB,CU,FJ,PG,WS,TO,SB,VU,MU,SC,MG,MZ,ZW,ZM,BW,NA,AO,CM,CI,SN,SL,LR,GM,MW,LS,SZ,CD,CG,GA,BJ,TG,BF,ML,NE,TD,SD,SS,SO,ER,BI,CF,GQ,CV,ST,MA,DZ,TN,LY,IR,IQ,SY,YE,KZ,UZ,TM,KG,TJ,MN,GE,AM,AZ,RU,BY,MD,IS,LU,MT,CY,AL,MK,BA,ME,XK".split(",");
const countryNames = typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

function marketingAttributionFromUrl() {
  const search = new URLSearchParams(window.location.search || "");
  const hashQuery = (window.location.hash || "").split("?")[1] || "";
  return search.get("marketingAttribution") || new URLSearchParams(hashQuery).get("marketingAttribution") || "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tenantUrl(slug) {
  const base = window.location.origin + window.location.pathname;
  return `${base}#/t/${encodeURIComponent(slug)}`;
}

export default function SaasLandingPage() {
  const [modules, setModules] = useState([]);
  const [form, setForm] = useState({
    churchName: "",
    slug: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    countryCode: "IN",
    userCodePrefix: "",
    logo: null,
    adminUsername: "",
    adminPassword: "NewPass@123",
    memberUsername: "",
    memberPassword: "Member@123",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/public/modules`, { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : { modules: [] }))
      .then((data) => setModules(Array.isArray(data?.modules) ? data.modules : []))
      .catch(() => setModules([]));
  }, []);

  useEffect(() => () => stopAmbience(), []);

  useEffect(() => {
    const beginOnFirstInteraction = () => {
      if (localStorage.getItem("mahima_saas_music_muted") !== "1") startAmbience();
      window.removeEventListener("pointerdown", beginOnFirstInteraction);
    };
    window.addEventListener("pointerdown", beginOnFirstInteraction, { once: true });
    return () => window.removeEventListener("pointerdown", beginOnFirstInteraction);
  }, []);

  function startAmbience() {
    if (audioRef.current || typeof window === "undefined") return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 2.5);
    master.connect(context.destination);
    const oscillators = [130.81, 164.81, 196].map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.value = index === 0 ? 0.32 : 0.12;
      oscillator.connect(gain).connect(master);
      oscillator.start();
      return oscillator;
    });
    const chime = window.setInterval(() => {
      if (context.state !== "running") return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = [523.25, 659.25, 783.99][Math.floor(Math.random() * 3)];
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 2.2);
      oscillator.connect(gain).connect(master);
      oscillator.start();
      oscillator.stop(context.currentTime + 2.3);
    }, 5200);
    audioRef.current = { context, oscillators, chime };
    localStorage.removeItem("mahima_saas_music_muted");
    setMusicPlaying(true);
  }

  function stopAmbience() {
    const audio = audioRef.current;
    if (audio) {
      window.clearInterval(audio.chime);
      audio.oscillators.forEach((oscillator) => { try { oscillator.stop(); } catch {} });
      audio.context.close().catch(() => {});
      audioRef.current = null;
    }
    setMusicPlaying(false);
  }

  function toggleMusic() {
    if (musicPlaying) {
      localStorage.setItem("mahima_saas_music_muted", "1");
      stopAmbience();
    } else startAmbience();
  }

  const suggestedSlug = useMemo(() => slugify(form.churchName), [form.churchName]);

  function update(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "churchName" && (!current.slug || current.slug === slugify(current.churchName))) {
        const nextSlug = slugify(value);
        next.slug = nextSlug;
        if (!current.userCodePrefix) {
          next.userCodePrefix = nextSlug.replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase() || "CH";
        }
      }
      if (field === "slug") next.slug = slugify(value);
      if (field === "userCodePrefix") next.userCodePrefix = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      return next;
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.adminUsername.trim()) {
      setError("At least one tenant admin is required. Enter an admin username.");
      return;
    }
    if (!form.contactEmail.trim()) {
      setError("Enter the tenant primary email address.");
      return;
    }
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      const payload = { ...form, slug: form.slug || suggestedSlug };
      const body = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (key === "logo") return;
        if (value !== undefined && value !== null && value !== "") body.append(key, value);
      });
      if (form.logo) body.append("logo", form.logo);
      const marketingAttribution = marketingAttributionFromUrl();
      if (marketingAttribution) body.append("marketingAttribution", marketingAttribution);
      const res = await fetch(`${API_BASE}/public/tenants/register`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body,
      });
      const responseText = await res.text();
      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = { message: responseText };
      }
      if (!res.ok) throw new Error(data?.message || data?.title || "Church registration failed.");
      const slug = data?.tenant?.slug || payload.slug;
      localStorage.setItem(TENANT_SLUG_KEY, slug);
      setResult({ ...data, tenantUrl: data?.tenant?.publicUrl || tenantUrl(slug) });
    } catch (err) {
      setError(err?.message || "Church registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyUrl() {
    if (!result?.tenantUrl) return;
    await navigator.clipboard?.writeText(result.tenantUrl);
  }

  return (
    <main className="saas-register-page min-h-screen text-white" style={{ "--saas-hero": "url('/assets/global-church-vibrant-v2.png')" }}>
      <div className="saas-stars" aria-hidden="true">
        {Array.from({ length: 28 }, (_, index) => (
          <span
            key={index}
            style={{
              "--star-size": `${2 + (index % 4)}px`,
              "--star-opacity": 0.25 + (index % 5) * 0.1,
              "--star-duration": `${8 + (index % 7) * 1.2}s`,
              "--star-delay": `${index * -0.73}s`,
              left: `${(index * 37) % 100}%`,
            }}
          />
        ))}
      </div>
      <section className="saas-topbar sticky top-0 z-40 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="#/" className="flex items-center gap-3">
            <TenantLogo name="Mahima" className="h-11 w-11 rounded-xl" fallbackClassName="bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/25" />
            <span>
              <span className="block text-lg font-black">Mahima for Churches</span>
              <span className="text-[10px] font-bold uppercase tracking-[.16em] text-emerald-100/70">Powered by Mahima Innovation Center</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleMusic} className="saas-icon-button" aria-label={musicPlaying ? "Mute ambient music" : "Play ambient music"} title={musicPlaying ? "Mute ambience" : "Play ambience"}>
              {musicPlaying ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <a href="#/login" className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-black text-white backdrop-blur hover:bg-white/20">Login</a>
          </div>
        </div>
      </section>

      <section className="relative z-10">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_540px] lg:py-16 xl:gap-16">
          <div className="self-center py-4 lg:py-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-4 py-2 text-sm font-black text-amber-100 backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Built for churches. Ready in minutes.
            </div>
            <h1 className="saas-display mt-7 max-w-3xl text-5xl font-black leading-[.98] sm:text-6xl xl:text-7xl">
              Your ministry deserves a <span>digital home.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">
              Bring your people, pastoral care, operations and ministry records together in one secure church platform—beautifully branded for your congregation.
            </p>
            <div className="mt-8 grid gap-3 text-sm font-bold text-white sm:grid-cols-3">
              <Feature icon={Globe2} text="Auto-published church URL" />
              <Feature icon={ShieldCheck} text="Private tenant workspace" />
              <Feature icon={HeartHandshake} text="Free essentials included" />
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-5 text-sm font-semibold text-slate-300">
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> No card required</span>
              <span className="inline-flex items-center gap-2"><Church className="h-4 w-4 text-amber-300" /> Church-first experience</span>
            </div>
          </div>

          <form onSubmit={submit} className="saas-register-card rounded-[28px] border border-white/20 p-5 shadow-2xl sm:p-7">
            <div className="mb-1 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-200"><Church className="h-5 w-5" /></span>
              <div><h2 className="text-2xl font-black text-white">Create your church space</h2><p className="text-sm font-semibold text-slate-300">Start free. Add ministry packages anytime.</p></div>
            </div>
            <div className="mt-5 grid gap-4">
              <Field label="Church name" value={form.churchName} onChange={(v) => update("churchName", v)} required />
              <Field label="Church URL slug" value={form.slug} onChange={(v) => update("slug", v)} placeholder={suggestedSlug || "your-church"} required />
              <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/10 p-3 text-sm font-bold text-slate-200">
                Your church link: <span className="text-emerald-300">{tenantUrl(form.slug || suggestedSlug || "your-church")}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <FileField label="Church logo" file={form.logo} onChange={(file) => update("logo", file)} />
                <Field
                  label="User code prefix"
                  value={form.userCodePrefix}
                  onChange={(v) => update("userCodePrefix", v)}
                  placeholder={(form.slug || suggestedSlug || "CH").replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase() || "CH"}
                  maxLength={12}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact name" value={form.contactName} onChange={(v) => update("contactName", v)} />
                <Field label="Contact phone" value={form.contactPhone} onChange={(v) => update("contactPhone", v)} />
              </div>
              <label className="grid gap-1.5 text-sm font-bold text-slate-200">
                Church country
                <select value={form.countryCode} onChange={(e) => update("countryCode", e.target.value)} required className="min-h-12 rounded-xl border border-white/15 bg-slate-950/70 px-3 text-white outline-none focus:border-emerald-300">
                  {COUNTRY_CODES.map((code) => <option key={code} value={code}>{countryNames?.of(code) || code}</option>)}
                </select>
              </label>
              <Field label="Tenant primary email" type="email" value={form.contactEmail} onChange={(v) => update("contactEmail", v)} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Admin username" value={form.adminUsername} onChange={(v) => update("adminUsername", v)} placeholder={`${form.slug || suggestedSlug || "church"}-admin`} required />
                <Field label="Admin password" value={form.adminPassword} onChange={(v) => update("adminPassword", v)} required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Default member username" value={form.memberUsername} onChange={(v) => update("memberUsername", v)} placeholder={`${form.slug || suggestedSlug || "church"}-member`} />
                <Field label="Member password" value={form.memberPassword} onChange={(v) => update("memberPassword", v)} required />
              </div>
              {error && <div className="rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-sm font-bold text-red-200">{error}</div>}
              <button type="submit" disabled={submitting} className="saas-submit-button inline-flex items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm font-black text-slate-950 disabled:opacity-60">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Create my church space
              </button>
              <p className="text-center text-[11px] font-semibold text-slate-400">By registering, you confirm you are authorized to create this church workspace.</p>
            </div>
          </form>
        </div>
      </section>

      {result && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tenant-created-title">
          <section className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-emerald-300/20 bg-[#f7fffc] p-6 shadow-2xl sm:p-8">
            <button type="button" onClick={() => setResult(null)} className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:bg-slate-200" aria-label="Close success message"><X className="h-5 w-5" /></button>
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <h2 id="tenant-created-title" className="mt-4 text-2xl font-black text-slate-950">Your church space is ready!</h2>
            <p className="mt-2 text-sm font-semibold text-emerald-800">{result.message || "The tenancy and its users were created successfully."}</p>
            {result.emailSent === false && <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">{result.emailWarning}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 ring-1 ring-emerald-100">
              <code className="break-all text-sm font-bold text-slate-800">{result.tenantUrl}</code>
              <button type="button" onClick={copyUrl} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black">
                <Copy className="h-4 w-4" /> Copy
              </button>
              <a href={result.tenantUrl} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white">
                Open <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-4 grid gap-3 text-sm font-bold text-slate-700 sm:grid-cols-2">
              <div>Admin: {result.adminUser?.username} / {result.adminUser?.password}</div>
              <div>Member: {result.memberUser?.username} / {result.memberUser?.password}</div>
            </div>
          </section>
        </div>
      )}

      <section className="relative z-10 mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="text-center"><div className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">Grow as your ministry grows</div><h2 className="mt-2 text-3xl font-black">Everything your church needs</h2></div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {FINAL_PRICING_CATALOG.map((module) => (
            <div key={module.code} className={`rounded-2xl border p-5 backdrop-blur transition hover:-translate-y-1 ${module.featured ? "border-amber-300/50 bg-amber-300/10" : "border-white/10 bg-white/[.07] hover:border-emerald-300/30 hover:bg-white/10"}`}>
              <div className="text-xs font-black uppercase tracking-wide text-emerald-300">{module.price === 0 ? "Included foundation" : module.featured ? "Best value bundle" : "Optional package"}</div>
              <h3 className="mt-2 text-lg font-black">{module.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{module.description}</p>
              <div className="mt-3 text-xs font-bold text-emerald-100">{module.storageGb} GB · ₹{module.aiCreditsInr} AI credits/month</div>
              <div className="mt-4 text-xl font-black">{module.price === 0 ? "Free" : `Rs ${module.price.toLocaleString("en-IN")}/mo`}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Feature({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-3 backdrop-blur">
      <Icon className="h-4 w-4 text-emerald-300" />
      <span>{text}</span>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = false, placeholder = "", maxLength }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-200">{label}</span>
      <input
        type={type}
        required={required}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="saas-field mt-1 w-full rounded-xl border border-white/15 bg-white/[.08] px-3 py-3 text-base font-semibold text-white outline-none placeholder:text-slate-500 focus:border-emerald-300/60 focus:ring-4 focus:ring-emerald-300/10"
      />
    </label>
  );
}

function FileField({ label, file, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-200">{label}</span>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="saas-field mt-1 w-full rounded-xl border border-white/15 bg-white/[.08] px-3 py-3 text-sm font-semibold text-slate-300 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-300/15 file:px-3 file:py-2 file:text-sm file:font-black file:text-emerald-200 focus:border-emerald-300/60 focus:ring-4 focus:ring-emerald-300/10"
      />
      {file && <span className="mt-1 block text-xs font-bold text-slate-500">{file.name}</span>}
    </label>
  );
}
