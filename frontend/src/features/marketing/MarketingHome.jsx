import React from "react";
import { ArrowRight, Bot, Check, Globe2, HeartHandshake, Menu, MessageCircle, Play, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import "./MarketingHome.css";
import { AI_OVERAGE_MARKUP, FINAL_PRICING_CATALOG, STORAGE_OVERAGE_INR_PER_GB } from "../../config/pricingCatalog";

const features = [
  [Users, "Members & Families", "Build a complete, searchable church directory with individual and family profiles, visit history, groups, pastoral notes and an accurate picture of every member's journey."],
  [HeartHandshake, "Pastoral Care", "Receive prayer requests, organise counselling, assign sensitive follow-ups and track every care commitment until the person has been contacted and supported."],
  [MessageCircle, "Communication", "Bring church chat, targeted broadcasts, sermon sharing and timely notifications together so every ministry message reaches the right people."],
  [Bot, "JaiMasih AI Pastor", "Give members and ministry leaders a bilingual Hindi and English assistant for Scripture, prayer, message preparation and pastoral guidance at any hour."],
  [ShieldCheck, "Church Operations", "Coordinate tithes, accounting, payroll, attendance, tasks and analytics with role-based access and an audit trail that strengthens transparency."],
  [Globe2, "Your Church, Your Brand", "Launch a fully isolated church workspace with your name, logo, colours, landing page and domain—without sharing data with another congregation."],
];

const plans = FINAL_PRICING_CATALOG.map((plan) => ({ ...plan, priceLabel: plan.price === 0 ? "FREE" : `₹${plan.price.toLocaleString("en-IN")}`, sub: plan.price === 0 ? "Forever" : "/month", badge: plan.featured ? "Best value" : undefined, dark: plan.featured, items: [`${plan.storageGb} GB data growth`, `₹${plan.aiCreditsInr} AI credits/month`, plan.description] }));

export default function MarketingHome() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [videoMissing, setVideoMissing] = React.useState(false);
  const go = (route) => { window.location.hash = route; setMenuOpen(false); };
  const scrollTo = (sectionId) => {
    setMenuOpen(false);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  React.useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape") setVideoOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return <main className="marketing-home">
    <header className="marketing-nav">
      <a href="#/" className="marketing-brand" aria-label="Mahima App home"><span>M</span><div><b>Mahima App</b><small>ALL-IN-ONE MINISTRY PLATFORM</small></div></a>
      <nav className={menuOpen ? "open" : ""}>
        <button className="nav-section-link" onClick={() => scrollTo("features")}>Features</button><button className="nav-section-link" onClick={() => scrollTo("pricing")}>Pricing</button><button className="nav-section-link" onClick={() => scrollTo("why")}>Why Mahima</button>
        <button className="nav-login" onClick={() => go("/login")}>Login</button>
        <button className="nav-demo" onClick={() => go("/saas")}>Start free <ArrowRight /></button>
      </nav>
      <button className="menu-button" onClick={() => setMenuOpen(v => !v)} aria-label={menuOpen ? "Close menu" : "Open menu"}>{menuOpen ? <X /> : <Menu />}</button>
    </header>

    <section className="marketing-hero">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles /> INDIA-FIRST · GLOBAL-READY · MULTI-TENANT</div>
        <h1>Your church deserves <em>its own app.</em><br/>Not 5 apps.</h1>
        <p>Members. Tithes. Sermons. Prayer. Chat. Operations. JaiMasih AI Pastor. One secure, beautifully branded home for your entire ministry.</p>
        <div className="hero-buttons"><button onClick={() => go("/saas")}>Start your free church space <ArrowRight /></button><button className="platform-video-button" onClick={() => { setVideoMissing(false); setVideoOpen(true); }}><Play/> Explore the platform</button></div>
        <div className="trust-row"><span><Check/> No credit card</span><span><Check/> Ready in 2 minutes</span><span><Check/> Hindi + English</span></div>
      </div>
      <div className="product-card">
        <div className="window-bar"><i/><i/><i/><span>app.yourchurch.com</span></div>
        <div className="dashboard">
          <aside><b>M</b><i/><i/><i/><i/></aside>
          <div className="dash-main">
            <div className="dash-head"><div><small>GOOD MORNING, PASTOR</small><h3>Your ministry at a glance.</h3></div><button>+ Add member</button></div>
            <div className="stats"><article><small>MEMBERS</small><b>1,284</b><em>+12 this month</em></article><article><small>PRAYER REQUESTS</small><b>36</b><em>8 need follow-up</em></article><article><small>THIS MONTH</small><b>₹1.8L</b><em>Giving recorded</em></article></div>
            <div className="dash-panels"><article><b>Community growth</b><div className="bars"><i/><i/><i/><i/><i/><i/><i/></div></article><article><b>JaiMasih AI</b><p>How can I support your ministry today?</p><button>Ask in Hindi or English →</button></article></div>
          </div>
        </div>
        <div className="ai-float"><Bot/><div><b>JaiMasih AI Pastor</b><small>Always ready to help</small></div><i/></div>
      </div>
    </section>

    <section className="product-proof"><small>BUILT FOR EVERY PART OF CHURCH LIFE</small><b>Members</b><b>Pastoral care</b><b>Giving</b><b>Sermons</b><b>Communication</b><b>Operations</b></section>

    <section id="features" className="content-section">
      <div className="section-heading"><div><small>ONE PLATFORM · SIX PILLARS</small><h2>Everything connected.<br/>Nothing scattered.</h2></div><p>Replace disconnected spreadsheets, WhatsApp groups and multiple subscriptions with a platform your team and members will love using.</p></div>
      <div className="feature-grid">{features.map(([Icon,title,text]) => <article key={title}><span><Icon/></span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <section id="why" className="why-section"><div><small>WHY INDIA-FIRST?</small><h2>Designed for how your ministry actually works.</h2><p>Fast on everyday phones, comfortable with Hinglish, ready for UPI and built around the rhythms of Indian church communities.</p></div><ul><li><Check/>Hindi + English AI with Indian context</li><li><Check/>Low-data and mobile-first experience</li><li><Check/>UPI giving and CA-friendly accounting</li><li><Check/>Isolated data and full audit trail</li></ul></section>

    <section id="pricing" className="pricing-section">
      <div className="section-heading"><div><small>MODULAR PRICING · PAY FOR WHAT YOU USE</small><h2>India-first pricing.<br/>No dollar shocks.</h2></div><p>Start free, then add only the ministry capabilities you need. Upgrade whenever your church is ready.</p></div>
      <div className="plans">{plans.map(plan => <article className={plan.dark ? "dark" : ""} key={plan.name}><header><h3>{plan.name}</h3>{plan.badge && <span>{plan.badge}</span>}</header><p><b>{plan.priceLabel}</b> <small>{plan.sub}</small></p><ul>{plan.items.map(item => <li key={item}><Check/>{item}</li>)}</ul><button onClick={() => go("/saas")}>Choose {plan.name}</button></article>)}</div>
      <div className="global-price"><Globe2/><b>Transparent overage:</b> ₹{STORAGE_OVERAGE_INR_PER_GB}/extra GB and {AI_OVERAGE_MARKUP}× actual OpenAI cost after included credits.</div>
    </section>

    <section className="final-cta"><div><small>YOUR DIGITAL CHURCH HOME</small><h2>Ready to give your church its own app?</h2><p>Launch a fully isolated, branded church space today. No credit card required.</p></div><button onClick={() => go("/saas")}>Start free now <ArrowRight/></button></section>
    <footer><div className="marketing-brand"><span>M</span><div><b>Mahima App</b><small>ALL-IN-ONE MINISTRY PLATFORM</small></div></div><p>India-first. Global-ready. Built with love for churches.</p><small>© {new Date().getFullYear()} Mahima Ministries</small></footer>
    {videoOpen && <div className="platform-video-modal" role="dialog" aria-modal="true" aria-labelledby="platform-video-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setVideoOpen(false); }}>
      <div className="platform-video-dialog"><div className="platform-video-heading"><div><small>MAHIMA APP TOUR</small><h2 id="platform-video-title">Explore the platform</h2></div><button onClick={() => setVideoOpen(false)} aria-label="Close video"><X/></button></div>
        {videoMissing ? <div className="platform-video-placeholder"><Play/><h3>Platform video coming soon</h3><p>Upload the latest walkthrough as <code>public/media/mahima-platform-tour.mp4</code> before building the next deployment.</p></div> : <video src="/media/mahima-platform-tour.mp4" controls autoPlay playsInline onError={() => setVideoMissing(true)}>Your browser does not support embedded video.</video>}
      </div>
    </div>}
  </main>;
}
