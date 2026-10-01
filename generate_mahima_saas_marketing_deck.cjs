/**
 * Mahima App — SaaS Marketing & Sales Deck (2026)
 * Comprehensive, accurate feature + pricing collateral for prospective church customers.
 * Run from the project root (NOT inside frontend/):
 *   node generate_mahima_saas_marketing_deck.cjs
 */

const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Mahima App — SaaS Marketing Deck";
pres.author = "Mahima Ministries";

// ─── PALETTE (consistent with existing Mahima collateral) ────────────────────
const C = {
  navy:      "0F1F5C",
  blue:      "1E4FD8",
  skyblue:   "4B87F5",
  gold:      "F5A623",
  lightbg:   "F0F4FF",
  white:     "FFFFFF",
  offwhite:  "F8FAFF",
  slate:     "4A5568",
  lightgray: "E8EDF7",
  midgray:   "8899B8",
  success:   "10B981",
  purple:    "7C3AED",
  teal:      "0D9488",
  coral:     "E53E3E",
};

const makeShadow = () => ({
  type: "outer", blur: 8, offset: 3, angle: 135, color: "0F1F5C", opacity: 0.13,
});

function darkSlide(slide)  { slide.background = { color: C.navy };    }
function lightSlide(slide) { slide.background = { color: C.lightbg }; }
function whiteSlide(slide) { slide.background = { color: C.white };   }

function accentCard(slide, x, y, w, h, accentColor) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: C.white },
    line: { color: C.lightgray, width: 1 },
    shadow: makeShadow(),
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.07, h,
    fill: { color: accentColor },
    line: { color: accentColor, width: 0 },
  });
}

function pill(slide, text, x, y) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w: 1.9, h: 0.3,
    fill: { color: C.blue },
    line: { color: C.blue, width: 0 },
    rectRadius: 0.08,
  });
  slide.addText(text.toUpperCase(), {
    x, y, w: 1.9, h: 0.3,
    fontSize: 9, bold: true, color: C.white,
    align: "center", valign: "middle", margin: 0, charSpacing: 2,
  });
}

function footer(slide, dark) {
  slide.addText("Mahima App  ·  mahimaministries.in  ·  sambitrout899@gmail.com", {
    x: 0.5, y: 5.38, w: 9, h: 0.22, fontSize: 8,
    color: dark ? "5D7BAD" : C.midgray, align: "left", margin: 0,
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 1 — COVER
// ════════════════════════════════════════════════════════════════════════════
(function slide01() {
  const s = pres.addSlide();
  darkSlide(s);

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: 5.625, fill: { color: C.gold }, line: { color: C.gold, width: 0 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 7.5, y: 0, w: 2.5, h: 5.625, fill: { color: "142570" }, line: { color: "142570", width: 0 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 8.5, y: 0, w: 1.5, h: 5.625, fill: { color: "0D1A55" }, line: { color: "0D1A55", width: 0 } });

  s.addText("SAAS MARKETING & SALES DECK", { x: 0.5, y: 1.15, w: 6.5, h: 0.35, fontSize: 10, bold: true, color: C.gold, align: "left", margin: 0, charSpacing: 3 });
  s.addText("Mahima App", { x: 0.5, y: 1.5, w: 6.5, h: 1.2, fontSize: 60, bold: true, color: C.white, fontFace: "Calibri", align: "left", margin: 0 });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.72, w: 1.6, h: 0.38, fill: { color: C.gold }, line: { color: C.gold, width: 0 }, rectRadius: 0.07 });
  s.addText("SaaS · v4.1", { x: 0.5, y: 2.72, w: 1.6, h: 0.38, fontSize: 11, bold: true, color: C.navy, align: "center", valign: "middle", margin: 0 });

  s.addText("The Complete Church Management Platform", { x: 0.5, y: 3.22, w: 6.6, h: 0.5, fontSize: 20, color: "A8BBDD", fontFace: "Calibri", align: "left", margin: 0 });
  s.addText("On-Premise for control. SaaS for speed. AI for connection.", { x: 0.5, y: 3.72, w: 6.6, h: 0.4, fontSize: 13, italic: true, color: C.gold, align: "left", margin: 0 });
  s.addText("Membership · Finance · Communication · Pastoral Care · AI · Mobile · Multi-Tenant SaaS", { x: 0.5, y: 4.2, w: 6.7, h: 0.35, fontSize: 10.5, color: "607BAD", align: "left", margin: 0 });

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.3, w: 10, h: 0.325, fill: { color: "0A1540" }, line: { color: "0A1540", width: 0 } });
  s.addText("Prepared for Ministries Considering Mahima App  •  2026", { x: 0.5, y: 5.3, w: 9, h: 0.325, fontSize: 9, color: "5D7BAD", align: "left", valign: "middle", margin: 0 });
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 2 — WHAT IS MAHIMA APP?
// ════════════════════════════════════════════════════════════════════════════
(function slide02() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Overview", 0.5, 0.28);
  s.addText("What is Mahima App?", { x: 0.5, y: 0.62, w: 9, h: 0.72, fontSize: 34, bold: true, color: C.navy, fontFace: "Calibri", margin: 0 });
  s.addText(
    "Mahima App is a multi-tenant, cloud-ready SaaS platform built for modern ministries. " +
    "It unifies every part of church administration — membership, finance, sermons, real-time messaging, " +
    "pastoral care, and an AI assistant — into one secure, role-based system your team already knows how to use.",
    { x: 0.5, y: 1.38, w: 6.1, h: 1.5, fontSize: 14, color: C.slate, align: "left", lineSpacingMultiple: 1.4, margin: 0 }
  );

  const stats = [
    { val: "6", label: "Modular\nSuites", color: C.blue },
    { val: "100%", label: "Role-Based\nAccess", color: C.success },
    { val: "2", label: "Platforms\n(Web + Android)", color: C.gold },
  ];
  stats.forEach((st, i) => {
    const bx = 0.5 + i * 1.95;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 3.0, w: 1.75, h: 1.45, fill: { color: st.color }, line: { color: st.color, width: 0 }, shadow: makeShadow() });
    s.addText(st.val, { x: bx, y: 3.1, w: 1.75, h: 0.75, fontSize: 34, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(st.label, { x: bx, y: 3.8, w: 1.75, h: 0.55, fontSize: 11, color: C.white, align: "center", valign: "top", margin: 0 });
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 6.6, y: 1.25, w: 3.1, h: 3.35, fill: { color: C.navy }, line: { color: C.navy, width: 0 }, shadow: makeShadow() });
  s.addText("Built On", { x: 6.6, y: 1.3, w: 3.1, h: 0.45, fontSize: 13, bold: true, color: C.gold, align: "center", margin: 0 });
  ["⚛  React + Vite (Frontend)", "🌐  ASP.NET Core 8 (Backend)", "🗄  PostgreSQL + EF Core", "📱  Capacitor (Android)", "⚡  SignalR (Real-time Chat)", "🔐  JWT + Role-Based Auth", "🏢  Multi-Tenant Architecture"].forEach((item, i) => {
    s.addText(item, { x: 6.75, y: 1.78 + i * 0.36, w: 2.85, h: 0.32, fontSize: 11.5, color: "B8C8E8", align: "left", margin: 0 });
  });

  s.addText("Built for ministries of every size — from a single congregation to multi-campus, multi-country networks.", { x: 0.5, y: 4.65, w: 9, h: 0.3, fontSize: 10, color: C.midgray, italic: true, align: "left", margin: 0 });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 3 — FEATURE MODULE MAP
// ════════════════════════════════════════════════════════════════════════════
(function slide03() {
  const s = pres.addSlide();
  whiteSlide(s);

  pill(s, "Features", 0.5, 0.28);
  s.addText("Everything Your Ministry Needs — In One Platform", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 27, bold: true, color: C.navy, fontFace: "Calibri", margin: 0 });

  const modules = [
    { icon: "👥", label: "Member\nManagement",   color: C.blue    },
    { icon: "📋", label: "Attendance\nTracking",  color: C.teal    },
    { icon: "🤝", label: "Teams &\nMeetings",     color: C.purple  },
    { icon: "🙏", label: "Prayer\nRequests",      color: C.coral   },
    { icon: "📖", label: "Sermons\n& Content",    color: C.success },
    { icon: "💬", label: "Real-time\nChat",       color: C.blue    },
    { icon: "💰", label: "Finance\nSuite",        color: C.gold    },
    { icon: "🤖", label: "PastorBot\nAI",         color: C.purple  },
    { icon: "📊", label: "Analytics\n& Audit",    color: C.teal    },
    { icon: "⛪", label: "Life Events\n& Care",   color: C.coral   },
    { icon: "🏢", label: "Multi-Tenant\nSaaS",    color: C.navy    },
    { icon: "📱", label: "Mobile\nApp",           color: C.success },
  ];

  const cols = 6, cardW = 1.45, cardH = 1.08, xStart = 0.35, yStart = 1.4, gap = 0.18;
  modules.forEach((m, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const bx = xStart + col * (cardW + gap), by = yStart + row * (cardH + gap);
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.lightgray, width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: cardW, h: 0.07, fill: { color: m.color }, line: { color: m.color, width: 0 } });
    s.addText(m.icon, { x: bx, y: by + 0.1, w: cardW, h: 0.42, fontSize: 22, align: "center", margin: 0 });
    s.addText(m.label, { x: bx + 0.05, y: by + 0.52, w: cardW - 0.1, h: 0.52, fontSize: 10, bold: true, color: C.navy, align: "center", valign: "top", margin: 0 });
  });

  s.addText("Every module below is licensed as part of one of six modular suites — see pricing on slide 17.", { x: 0.4, y: 4.85, w: 9, h: 0.3, fontSize: 10, color: C.midgray, italic: true, align: "center", margin: 0 });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 4 — MEMBER MANAGEMENT & AUTH
// ════════════════════════════════════════════════════════════════════════════
(function slide04() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Membership", 0.5, 0.28);
  s.addText("Member Management & Authentication", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 28, bold: true, color: C.navy, fontFace: "Calibri", margin: 0 });

  const features = [
    { icon: "👤", title: "Full Member Directory", desc: "Profiles, contact info, photos, status — one source of truth" },
    { icon: "🔑", title: "JWT Authentication",  desc: "Secure token-based login with refresh support" },
    { icon: "🏷️", title: "Role-Based Access",   desc: "Admin, Pastor, Finance, Staff, Member — granular permissions" },
    { icon: "🤝", title: "Teams & Positions",   desc: "Organise members into ministry teams with defined roles" },
    { icon: "📲", title: "Push-Ready Devices",  desc: "Device token registration keeps every member reachable" },
  ];
  features.forEach((f, i) => {
    const by = 1.4 + i * 0.72;
    accentCard(s, 0.5, by, 5.1, 0.62, C.blue);
    s.addText(f.icon, { x: 0.65, y: by + 0.06, w: 0.5, h: 0.5, fontSize: 18, align: "center", margin: 0 });
    s.addText(f.title, { x: 1.22, y: by + 0.05, w: 4.2, h: 0.28, fontSize: 12.5, bold: true, color: C.navy, margin: 0 });
    s.addText(f.desc,  { x: 1.22, y: by + 0.31, w: 4.2, h: 0.26, fontSize: 10.5, color: C.slate, margin: 0 });
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 6.0, y: 1.3, w: 3.65, h: 3.9, fill: { color: C.navy }, line: { color: C.navy, width: 0 }, shadow: makeShadow() });
  s.addText("🔐  Security First", { x: 6.15, y: 1.5, w: 3.35, h: 0.45, fontSize: 15, bold: true, color: C.gold, align: "left", margin: 0 });
  ["✅  Role permission matrix per module", "✅  Complete audit log on every action", "✅  Admin can revoke access instantly", "✅  Staff cannot access Finance without role", "✅  Every endpoint protected by auth", "✅  Automated security posture monitoring"].forEach((item, i) => {
    s.addText(item, { x: 6.2, y: 2.05 + i * 0.42, w: 3.3, h: 0.36, fontSize: 11.5, color: "B8C8E8", margin: 0 });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 5 — ATTENDANCE TRACKING
// ════════════════════════════════════════════════════════════════════════════
(function slide05() {
  const s = pres.addSlide();
  whiteSlide(s);

  pill(s, "Membership", 0.5, 0.28);
  s.addText("Attendance Tracking", { x: 0.5, y: 0.62, w: 6, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });
  s.addText("Know who showed up — and who needs follow-up.", { x: 0.5, y: 1.25, w: 6, h: 0.38, fontSize: 14, color: C.slate, italic: true, margin: 0 });

  const cards = [
    { icon: "📅", title: "Date-Range Filtering",  desc: "Query attendance between any two dates with instant results", color: C.teal },
    { icon: "🔍", title: "Per-Member View",        desc: "Filter records by individual member — perfect for follow-up calls", color: C.blue },
    { icon: "✏️", title: "Create, Edit, Delete",   desc: "Full record management with role-guard on every edit", color: C.purple },
    { icon: "📝", title: "Full Audit Trail",       desc: "Every attendance change is logged — who, what, and when", color: C.success },
  ];
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const bx = 0.5 + col * 4.8, by = 1.75 + row * 1.55;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 4.3, h: 1.35, fill: { color: C.lightbg }, line: { color: C.lightgray, width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 0.07, h: 1.35, fill: { color: c.color }, line: { color: c.color, width: 0 } });
    s.addText(c.icon,  { x: bx + 0.2, y: by + 0.2, w: 0.6, h: 0.6, fontSize: 26, align: "center", margin: 0 });
    s.addText(c.title, { x: bx + 0.9, y: by + 0.18, w: 3.2, h: 0.35, fontSize: 13, bold: true, color: C.navy, margin: 0 });
    s.addText(c.desc,  { x: bx + 0.9, y: by + 0.55, w: 3.2, h: 0.62, fontSize: 11, color: C.slate, margin: 0 });
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 9.35, y: 1.3, w: 0.35, h: 3.9, fill: { color: C.teal }, line: { color: C.teal, width: 0 } });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 6 — TEAMS, MEETINGS & TASKS
// ════════════════════════════════════════════════════════════════════════════
(function slide06() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Operations", 0.5, 0.28);
  s.addText("Teams, Meetings & Task Management", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 27, bold: true, color: C.navy, margin: 0 });

  const cols = [
    { icon: "🤝", heading: "Teams",    color: C.blue,   items: ["Create ministry teams (Worship, Outreach, etc.)", "Add / remove team members instantly", "Team-level position assignment", "Per-team productivity analytics"] },
    { icon: "📆", heading: "Meetings", color: C.teal,   items: ["Schedule church & committee meetings", "Set date, time, location & agenda", "Notify attendees automatically", "Upcoming meetings on the dashboard"] },
    { icon: "✅", heading: "Tasks",    color: C.purple, items: ["Assign tasks to members or teams", "Track status: Pending → In Progress → Done", "Tasks-by-role analytics chart", "Timesheets feed staff hours into payroll"] },
  ];
  cols.forEach((col, i) => {
    const bx = 0.45 + i * 3.1;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.35, w: 2.85, h: 3.85, fill: { color: C.white }, line: { color: C.lightgray, width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.35, w: 2.85, h: 0.62, fill: { color: col.color }, line: { color: col.color, width: 0 } });
    s.addText(col.icon + "  " + col.heading, { x: bx + 0.15, y: 1.35, w: 2.55, h: 0.62, fontSize: 16, bold: true, color: C.white, align: "left", valign: "middle", margin: 0 });
    col.items.forEach((item, j) => {
      s.addText("▸  " + item, { x: bx + 0.18, y: 2.1 + j * 0.65, w: 2.5, h: 0.58, fontSize: 11.5, color: C.slate, align: "left", margin: 0 });
    });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 7 — PRAYER REQUESTS & SERMONS
// ════════════════════════════════════════════════════════════════════════════
(function slide07() {
  const s = pres.addSlide();
  whiteSlide(s);

  pill(s, "Pastoral Care", 0.5, 0.28);
  s.addText("Prayer Requests & Sermons", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });

  [[0.5, C.coral, "🙏  Prayer Requests", ["Members submit personal prayer needs privately","Pastor reviews and responds to each request","Mark requests as Prayed / Answered","Status tracking so nothing is missed","Confidential — only authorised roles see all"]],
   [5.15, C.success, "📖  Sermons & Content", ["Upload and archive sermon recordings & notes","Organised library members can search anytime","Attach documents, slides, or media files","Search sermons by title, speaker, or date","Share straight to the Today's Updates feed"]]
  ].forEach(([bx, color, title, items]) => {
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.3, w: 4.35, h: 3.95, fill: { color: C.lightbg }, line: { color: C.lightgray, width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.3, w: 4.35, h: 0.58, fill: { color: color }, line: { color: color, width: 0 } });
    s.addText(title, { x: bx + 0.15, y: 1.3, w: 4.05, h: 0.58, fontSize: 16, bold: true, color: C.white, align: "left", valign: "middle", margin: 0 });
    items.forEach((p, i) => { s.addText("✦  " + p, { x: bx + 0.2, y: 2.02 + i * 0.56, w: 4.0, h: 0.48, fontSize: 12, color: C.slate, margin: 0 }); });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 8 — REAL-TIME CHAT & MESSAGING
// ════════════════════════════════════════════════════════════════════════════
(function slide08() {
  const s = pres.addSlide();
  darkSlide(s);

  pill(s, "Communication", 0.5, 0.28);
  s.addText("Real-Time Chat & Messaging", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 30, bold: true, color: C.white, margin: 0 });
  s.addText("Powered by SignalR — messages delivered instantly, no refresh needed.", { x: 0.5, y: 1.25, w: 9, h: 0.35, fontSize: 13, color: "8AAAD5", italic: true, margin: 0 });

  const tiles = [
    { icon: "💬", title: "1-to-1 Private Chat",  desc: "Direct messaging between any two members with read receipts", color: C.blue },
    { icon: "👥", title: "Group Channels",        desc: "Team-based group chats — Worship Team, Elders, Youth, etc.", color: C.teal },
    { icon: "🎙️", title: "Voice Notes & Calls",  desc: "Send voice messages or place calls without leaving the app", color: C.gold },
    { icon: "🤖", title: "JaiMasih Bot Chat",     desc: "PastorBot AI responses delivered as messages in the chat", color: C.purple },
    { icon: "📎", title: "File Attachments",      desc: "Share documents, images, and media in any conversation", color: C.success },
    { icon: "📢", title: "Bulk Broadcast",        desc: "Admin can message ALL members simultaneously, safety-moderated", color: C.coral },
  ];
  tiles.forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const bx = 0.45 + col * 3.1, by = 1.72 + row * 1.68;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 2.85, h: 1.5, fill: { color: "1A2E6E" }, line: { color: "253880", width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 2.85, h: 0.07, fill: { color: t.color }, line: { color: t.color, width: 0 } });
    s.addText(t.icon + "  " + t.title, { x: bx + 0.15, y: by + 0.15, w: 2.55, h: 0.38, fontSize: 13, bold: true, color: C.white, margin: 0 });
    s.addText(t.desc, { x: bx + 0.15, y: by + 0.58, w: 2.55, h: 0.78, fontSize: 11, color: "8AAAD5", margin: 0 });
  });
  footer(s, true);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 9 — FINANCE SUITE
// ════════════════════════════════════════════════════════════════════════════
(function slide09() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Finance", 0.5, 0.28);
  s.addText("Complete Finance Suite", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });
  s.addText("Tithes · Offerings · Expenses · Payroll · Double-Entry Accounting", { x: 0.5, y: 1.22, w: 9, h: 0.35, fontSize: 13, color: C.gold, bold: true, margin: 0 });

  const pillars = [
    { title: "Accounting\n(Double-Entry)", color: C.gold,    icon: "📒", items: ["Full Chart of Accounts (Asset, Liability, Equity)", "Journal entries with debit/credit balance", "Tithes, Offerings, Donations, Grants", "Balance sheet & income statement export"] },
    { title: "Expenses\nManagement",       color: C.blue,    icon: "🧾", items: ["Log ministry expenses with category", "Approve/reject claims per role", "Attach receipts as file uploads", "Filter by date, category, or staff"] },
    { title: "Payroll\nManagement",        color: C.success, icon: "💵", items: ["Set up staff salary schedules", "Run monthly payroll with one click", "Payslip PDF export, ready to send", "Payroll history & audit trail"] },
    { title: "Timesheets",                 color: C.teal,    icon: "⏱️", items: ["Staff log daily working hours", "Admin reviews and approves entries", "Feeds directly into payroll", "Exportable reports per period"] },
  ];
  pillars.forEach((p, i) => {
    const bx = 0.4 + i * 2.32;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.68, w: 2.1, h: 3.55, fill: { color: C.white }, line: { color: C.lightgray, width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 1.68, w: 2.1, h: 0.58, fill: { color: p.color }, line: { color: p.color, width: 0 } });
    s.addText(p.icon,  { x: bx + 0.1, y: 1.7,  w: 0.5, h: 0.54, fontSize: 20, align: "center", margin: 0 });
    s.addText(p.title, { x: bx + 0.6, y: 1.74, w: 1.4, h: 0.5,  fontSize: 10, bold: true, color: C.white, align: "left", valign: "middle", margin: 0 });
    p.items.forEach((item, j) => { s.addText("•  " + item, { x: bx + 0.12, y: 2.35 + j * 0.7, w: 1.86, h: 0.62, fontSize: 10, color: C.slate, margin: 0 }); });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 10 — LIFE EVENTS & COUNSELLING
// ════════════════════════════════════════════════════════════════════════════
(function slide10() {
  const s = pres.addSlide();
  whiteSlide(s);

  pill(s, "Pastoral Care", 0.5, 0.28);
  s.addText("Life Events, Counselling & Pastoral Care", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 27, bold: true, color: C.navy, margin: 0 });

  const sections = [
    { icon: "🕊️", title: "Baptisms",            color: C.blue,    x: 0.5, y: 1.35, items: ["Record baptism date, location, and officiant", "Member automatically linked to the record", "Printable baptism certificate support", "Searchable baptism registry"] },
    { icon: "💍",  title: "Marriage Records",    color: C.coral,   x: 5.2, y: 1.35, items: ["Register church weddings with couple details", "Officiant, witnesses, and date recorded", "Marriage counselling session notes attached", "Full history retained per family"] },
    { icon: "🫂",  title: "Counselling Sessions",color: C.purple,  x: 0.5, y: 3.1,  items: ["Schedule pastoral counselling appointments", "Confidential session notes per member", "Group prayer / lay-counsel records", "Only Pastor/Admin can access this data"] },
    { icon: "📅",  title: "Daily Routines",      color: C.success, x: 5.2, y: 3.1,  items: ["Track daily devotion and ministry routines", "Staff log their spiritual disciplines", "Completion reporting to leadership", "Encourages consistent ministry habits"] },
  ];
  sections.forEach((sec) => {
    accentCard(s, sec.x, sec.y, 4.3, 1.62, sec.color);
    s.addText(sec.icon + "  " + sec.title, { x: sec.x + 0.2, y: sec.y + 0.1, w: 3.9, h: 0.38, fontSize: 14, bold: true, color: C.navy, margin: 0 });
    s.addText(sec.items.join("\n"), { x: sec.x + 0.22, y: sec.y + 0.52, w: 3.88, h: 1.0, fontSize: 10.5, color: C.slate, margin: 0 });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 11 — ANALYTICS, AUDIT & SECURITY
// ════════════════════════════════════════════════════════════════════════════
(function slide11() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Trust & Insight", 0.5, 0.28);
  s.addText("Analytics, Audit & Security", { x: 0.5, y: 0.62, w: 6, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });

  s.addChart(pres.charts.BAR, [{ name: "Sunday Service Attendance", labels: ["Jan","Feb","Mar","Apr","May","Jun"], values: [112,125,118,140,152,148] }], {
    x: 0.5, y: 1.3, w: 5.6, h: 2.6, barDir: "col",
    chartColors: [C.blue],
    chartArea: { fill: { color: C.white }, roundedCorners: true },
    catAxisLabelColor: "64748B", valAxisLabelColor: "64748B",
    valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" },
    showValue: true, dataLabelColor: C.navy, showLegend: false,
  });

  s.addText("Every action is logged — full audit trail, exportable to CSV — and platform security posture is monitored automatically, not just at go-live.", {
    x: 0.5, y: 4.05, w: 5.6, h: 0.75, fontSize: 10.5, color: C.slate, italic: true, margin: 0,
  });

  const metrics = [
    { label: "Tasks by Role",       icon: "👔", color: C.purple, desc: "Which roles carry the most load" },
    { label: "Team Productivity",   icon: "📈", color: C.teal,   desc: "Output vs targets per ministry team" },
    { label: "Complete Audit Trail",icon: "🔍", color: C.coral,  desc: "Every change logged — who, what, when — CSV export" },
    { label: "Finance Reports",     icon: "💰", color: C.gold,   desc: "Income, expense, payroll PDF exports" },
    { label: "Security Monitoring", icon: "🛡️", color: C.navy,   desc: "Automated security posture scans & history" },
  ];
  metrics.forEach((m, i) => {
    const by = 1.3 + i * 0.82;
    accentCard(s, 6.25, by, 3.35, 0.72, m.color);
    s.addText(m.icon,  { x: 6.4,  y: by + 0.1,  w: 0.5, h: 0.5,  fontSize: 20, align: "center", margin: 0 });
    s.addText(m.label, { x: 6.98, y: by + 0.09, w: 2.5, h: 0.3,  fontSize: 12, bold: true, color: C.navy, margin: 0 });
    s.addText(m.desc,  { x: 6.98, y: by + 0.4,  w: 2.5, h: 0.28, fontSize: 10, color: C.slate, margin: 0 });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 12 — PASTORBOT AI
// ════════════════════════════════════════════════════════════════════════════
(function slide12() {
  const s = pres.addSlide();
  darkSlide(s);

  s.addShape(pres.shapes.RECTANGLE, { x: 6.5, y: 0, w: 3.5, h: 5.625, fill: { color: "142570" }, line: { color: "142570", width: 0 } });
  pill(s, "AI — Flagship", 0.5, 0.28);
  s.addText("PastorBot AI", { x: 0.5, y: 0.62, w: 5.5, h: 0.75, fontSize: 38, bold: true, color: C.white, margin: 0 });
  s.addText('"JaiMasih" — Your AI-Powered Pastoral Assistant', { x: 0.5, y: 1.38, w: 5.5, h: 0.38, fontSize: 14, color: C.gold, italic: true, margin: 0 });

  const botFeatures = [
    { icon: "🤖", title: "Ask Any Question",  desc: "Members ask biblical, spiritual or admin questions and get instant responses" },
    { icon: "🌐", title: "Multi-Language",    desc: "Responds in Hindi, English, or the member's preferred language automatically" },
    { icon: "👤", title: "Custom Personas",   desc: "Configure tone — formal, pastoral, youth-friendly, or evangelistic" },
    { icon: "📄", title: "Document Reader",   desc: "Upload a document and ask PastorBot to summarise or explain it" },
    { icon: "💬", title: "Chat Integration",  desc: "PastorBot replies appear directly in real-time chat as JaiMasih messages" },
    { icon: "🔒", title: "Access Controlled", desc: "Admin controls exactly which roles can access PastorBot" },
  ];
  botFeatures.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const bx = 0.5 + col * 2.9, by = 1.88 + row * 1.12;
    s.addText(f.icon + "  " + f.title, { x: bx, y: by,        w: 2.6,  h: 0.32, fontSize: 13, bold: true, color: C.gold,   margin: 0 });
    s.addText(f.desc,                  { x: bx, y: by + 0.35, w: 2.65, h: 0.68, fontSize: 10.5, color: "8AAAD5", margin: 0 });
  });

  s.addText("🤖", { x: 7.0, y: 1.2, w: 2.5, h: 1.2, fontSize: 72, align: "center", margin: 0 });
  s.addText('"JaiMasih"', { x: 7.0, y: 2.4, w: 2.5, h: 0.5, fontSize: 20, bold: true, color: C.gold, align: "center", margin: 0 });
  ["AI-Powered", "Hindi + English", "Persona Config", "Document Upload", "Native to Chat"].forEach((item, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.8, y: 3.05 + i * 0.46, w: 2.9, h: 0.38, fill: { color: C.blue, transparency: 40 }, line: { color: C.blue, width: 0 }, rectRadius: 0.06 });
    s.addText("✓  " + item, { x: 6.8, y: 3.05 + i * 0.46, w: 2.9, h: 0.38, fontSize: 12, color: C.white, align: "center", valign: "middle", margin: 0 });
  });
  footer(s, true);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 13 — AUTOMATION & INTEGRATIONS
// ════════════════════════════════════════════════════════════════════════════
(function slide13() {
  const s = pres.addSlide();
  whiteSlide(s);

  pill(s, "Automation", 0.5, 0.28);
  s.addText("Automation, Integrations & Multi-Language", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 26, bold: true, color: C.navy, margin: 0 });

  const integrations = [
    { icon: "⚡", title: "Ministry Automation",    color: C.gold,    desc: "AI-assisted workflows — auto-draft welcome messages, schedule announcements, trigger notifications without manual effort." },
    { icon: "📧", title: "Built-in Email Client",  color: C.blue,    desc: "Send and receive emails directly within the app. Email history stored per member." },
    { icon: "📱", title: "SMS & WhatsApp",         color: C.teal,    desc: "Reach members by SMS or WhatsApp directly from the admin panel — global delivery, no extra tools." },
    { icon: "☁️", title: "Google Drive",           color: C.success, desc: "Connect Google Drive to upload, organise, and share church files without leaving Mahima App." },
    { icon: "🌐", title: "Multi-Language UI",      color: C.purple,  desc: "Admin-managed UI translations — full interface in Hindi, English, and more, per user preference." },
    { icon: "📲", title: "Push Notifications",     color: C.coral,   desc: "Device token management ensures members receive push notifications on Android for every key update." },
  ];
  integrations.forEach((item, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const bx = 0.45 + col * 3.1, by = 1.35 + row * 1.95;
    accentCard(s, bx, by, 2.85, 1.75, item.color);
    s.addText(item.icon + "  " + item.title, { x: bx + 0.2,  y: by + 0.1,  w: 2.5,  h: 0.38, fontSize: 13, bold: true, color: C.navy, margin: 0 });
    s.addText(item.desc,                     { x: bx + 0.18, y: by + 0.52, w: 2.55, h: 1.1,  fontSize: 10.5, color: C.slate, margin: 0 });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 14 — MULTI-TENANT SAAS PLATFORM
// ════════════════════════════════════════════════════════════════════════════
(function slide14() {
  const s = pres.addSlide();
  darkSlide(s);

  pill(s, "SaaS Platform", 0.5, 0.28);
  s.addText("Built for SaaS, Not Bolted On", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 29, bold: true, color: C.white, margin: 0 });
  s.addText("True multi-tenant architecture — every ministry gets its own secure, branded space.", { x: 0.5, y: 1.25, w: 9, h: 0.35, fontSize: 13, color: "8AAAD5", italic: true, margin: 0 });

  const tiles = [
    { icon: "🏢", title: "Isolated Tenants",     desc: "Each ministry's data is fully isolated — no cross-tenant visibility, ever", color: C.blue },
    { icon: "🌍", title: "Custom Domains",       desc: "Bring your own domain, or use a branded Mahima subdomain", color: C.teal },
    { icon: "🎨", title: "Branded Landing Page", desc: "Editable public-facing CMS page for every tenant, out of the box", color: C.gold },
    { icon: "🧩", title: "Modular Licensing",    desc: "Enable only the suites you need; add more as you grow", color: C.purple },
    { icon: "🖨️", title: "Branded Print Templates", desc: "Certificates, receipts, and reports carry your ministry's branding", color: C.success },
    { icon: "🚀", title: "Guided Demo Path",     desc: "Structured demo with a defined window before you ever commit to a plan", color: C.coral },
  ];
  tiles.forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const bx = 0.45 + col * 3.1, by = 1.72 + row * 1.68;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 2.85, h: 1.5, fill: { color: "1A2E6E" }, line: { color: "253880", width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 2.85, h: 0.07, fill: { color: t.color }, line: { color: t.color, width: 0 } });
    s.addText(t.icon + "  " + t.title, { x: bx + 0.15, y: by + 0.15, w: 2.55, h: 0.38, fontSize: 13, bold: true, color: C.white, margin: 0 });
    s.addText(t.desc, { x: bx + 0.15, y: by + 0.58, w: 2.55, h: 0.78, fontSize: 11, color: "8AAAD5", margin: 0 });
  });
  footer(s, true);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 15 — MOBILE APP
// ════════════════════════════════════════════════════════════════════════════
(function slide15() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Mobile", 0.5, 0.28);
  s.addText("Mahima App on Android", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });
  s.addText("Built with Capacitor — the same platform, natively on Android devices.", { x: 0.5, y: 1.25, w: 9, h: 0.35, fontSize: 14, color: C.slate, italic: true, margin: 0 });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.8, y: 1.05, w: 2.6, h: 4.2, fill: { color: C.navy }, line: { color: C.blue, width: 3 }, rectRadius: 0.3, shadow: makeShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x: 7.0, y: 1.35, w: 2.2, h: 3.5, fill: { color: "1A2E6E" }, line: { color: "1A2E6E", width: 0 } });
  s.addText("📱 Mahima App", { x: 6.9, y: 2.4, w: 2.6, h: 1.2, fontSize: 16, bold: true, color: C.white, align: "center", margin: 0 });
  s.addShape(pres.shapes.OVAL, { x: 7.85, y: 4.9, w: 0.5, h: 0.15, fill: { color: "3A4E8C" }, line: { color: "3A4E8C", width: 0 } });

  const features = [
    { icon: "📲", title: "Native Android App",    desc: "Capacitor wraps the same platform into a fully native Android app" },
    { icon: "🔔", title: "Push Notifications",    desc: "Real-time alerts for messages, prayer requests, and meeting reminders" },
    { icon: "📷", title: "Camera Access",         desc: "Capture and upload photos directly from the device camera" },
    { icon: "📁", title: "File Access",           desc: "Open, upload, and share documents from device storage" },
    { icon: "🔄", title: "Automatic App Updates", desc: "In-app update prompts keep every device on the latest release" },
    { icon: "🖥️", title: "Full Feature Parity",   desc: "Everything on web is available on mobile — one platform, two screens" },
  ];
  features.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const bx = 0.4 + col * 3.0, by = 1.72 + row * 1.12;
    s.addText(f.icon + "  " + f.title, { x: bx, y: by,        w: 2.8, h: 0.35, fontSize: 13, bold: true, color: C.blue, margin: 0 });
    s.addText(f.desc,                  { x: bx, y: by + 0.38, w: 2.8, h: 0.64, fontSize: 11, color: C.slate, margin: 0 });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 16 — WHY MAHIMA APP?
// ════════════════════════════════════════════════════════════════════════════
(function slide16() {
  const s = pres.addSlide();
  whiteSlide(s);

  pill(s, "Summary", 0.5, 0.28);
  s.addText("Why Mahima App?", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });

  const reasons = [
    { num: "01", title: "All-in-One Platform",      desc: "Members, finance, sermons, chat, AI — everything in one place. No more juggling five different apps.", color: C.blue },
    { num: "02", title: "Pay for What You Use",      desc: "Six modular suites, priced independently — start small and add capability as your ministry grows.", color: C.gold },
    { num: "03", title: "PastorBot AI",              desc: "No other church management app gives your members a personal AI pastor, built natively into chat.", color: C.purple },
    { num: "04", title: "Secure & Auditable",        desc: "Every action is logged, security posture is monitored, and access is always role-controlled.", color: C.coral },
    { num: "05", title: "India-First, Global-Ready", desc: "Hindi + English support and INR billing today, built to scale to churches worldwide.", color: C.teal },
    { num: "06", title: "True Multi-Tenant SaaS",    desc: "Your own branded, isolated space — from a 50-member congregation to a multi-campus network.", color: C.success },
  ];
  reasons.forEach((r, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const bx = 0.4 + col * 3.1, by = 1.38 + row * 1.92;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 2.85, h: 1.72, fill: { color: C.white }, line: { color: C.lightgray, width: 1 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 2.85, h: 0.07, fill: { color: r.color }, line: { color: r.color, width: 0 } });
    s.addShape(pres.shapes.OVAL, { x: bx + 0.15, y: by + 0.15, w: 0.55, h: 0.55, fill: { color: r.color }, line: { color: r.color, width: 0 } });
    s.addText(r.num,   { x: bx + 0.15, y: by + 0.15, w: 0.55, h: 0.55, fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(r.title, { x: bx + 0.82, y: by + 0.2,  w: 1.9,  h: 0.42, fontSize: 12, bold: true, color: C.navy, margin: 0 });
    s.addText(r.desc,  { x: bx + 0.14, y: by + 0.78, w: 2.58, h: 0.85, fontSize: 10.5, color: C.slate, margin: 0 });
  });
  footer(s, false);
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 17 — MODULAR PRICING
// ════════════════════════════════════════════════════════════════════════════
(function slide17() {
  const s = pres.addSlide();
  lightSlide(s);

  pill(s, "Pricing", 0.5, 0.28);
  s.addText("Simple, Modular Pricing", { x: 0.5, y: 0.62, w: 9, h: 0.6, fontSize: 30, bold: true, color: C.navy, margin: 0 });
  s.addText("Start with the free essentials. Add only the suites your ministry needs.", { x: 0.5, y: 1.22, w: 9, h: 0.35, fontSize: 13, color: C.slate, italic: true, margin: 0 });

  const rows = [
    [{ text: "Suite", options: { bold: true, color: C.white, fill: { color: C.navy } } },
     { text: "What's Included", options: { bold: true, color: C.white, fill: { color: C.navy } } },
     { text: "Price / month", options: { bold: true, color: C.white, fill: { color: C.navy }, align: "right" } }],
    [{ text: "Free Essentials", options: { bold: true } }, { text: "Home, public landing page, users, prayer requests, sermons, teams, app downloads" }, { text: "₹0", options: { align: "right", bold: true, color: C.success } }],
    [{ text: "Jai Masih Chat", options: { bold: true } }, { text: "Direct & group chat, voice notes, calls, chat safety moderation" }, { text: "₹499", options: { align: "right", bold: true } }],
    [{ text: "Operations Suite", options: { bold: true } }, { text: "Tasks, attendance, payroll, expenses, accounting, reports, audit trail" }, { text: "₹799", options: { align: "right", bold: true } }],
    [{ text: "Care Ministry Suite", options: { bold: true } }, { text: "PastorBot AI, marriage, baptism, counselling, pastoral care workflows" }, { text: "₹599", options: { align: "right", bold: true } }],
    [{ text: "Administration Suite", options: { bold: true } }, { text: "Roles, pages, admin dashboard, live users, languages, tenant admin" }, { text: "₹699", options: { align: "right", bold: true } }],
    [{ text: "Communications Suite", options: { bold: true } }, { text: "Message center, email client, Google Drive, server files" }, { text: "₹599", options: { align: "right", bold: true } }],
  ];
  s.addTable(rows, {
    x: 0.5, y: 1.7, w: 9, h: 2.65,
    colW: [2.1, 5.4, 1.5],
    fontSize: 11, color: C.slate, border: { type: "solid", color: C.lightgray, pt: 0.75 },
    fill: { color: C.white }, autoPage: false, valign: "middle",
    rowH: [0.4, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42],
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.55, w: 9, h: 0.62, fill: { color: C.gold }, line: { color: C.gold, width: 0 }, shadow: makeShadow() });
  s.addText("Full Platform — every suite, every module", { x: 0.65, y: 4.55, w: 6, h: 0.62, fontSize: 14, bold: true, color: C.navy, valign: "middle", margin: 0 });
  s.addText("₹3,195/month (~₹38,340/year)", { x: 6.5, y: 4.55, w: 2.85, h: 0.62, fontSize: 15, bold: true, color: C.navy, align: "right", valign: "middle", margin: 0 });

  s.addText("Annual partnership plans, billed in INR via Razorpay. Try before you commit with a scoped demo window.", { x: 0.5, y: 5.24, w: 9, h: 0.28, fontSize: 9.5, color: C.midgray, italic: true, margin: 0 });
})();

// ════════════════════════════════════════════════════════════════════════════
//  SLIDE 18 — CALL TO ACTION
// ════════════════════════════════════════════════════════════════════════════
(function slide18() {
  const s = pres.addSlide();
  darkSlide(s);

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.14, fill: { color: C.gold }, line: { color: C.gold, width: 0 } });
  s.addText("Ready to Transform Your Ministry?", { x: 0.8, y: 1.05, w: 8.4, h: 0.95, fontSize: 36, bold: true, color: C.white, fontFace: "Calibri", align: "center", margin: 0 });
  s.addText("Mahima App — let's schedule your live demo.", { x: 0.8, y: 1.98, w: 8.4, h: 0.48, fontSize: 18, color: "A8BBDD", align: "center", margin: 0 });

  const ctas = [
    { icon: "📞", label: "Book a Call",   sub: "30-minute live walkthrough" },
    { icon: "🎯", label: "Guided Demo",   sub: "Scoped demonstration window" },
    { icon: "✉️", label: "Get in Touch", sub: "sambitrout899@gmail.com" },
  ];
  ctas.forEach((c, i) => {
    const bx = 1.2 + i * 2.7;
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: 2.7, w: 2.3, h: 1.45, fill: { color: "1A2E6E" }, line: { color: C.blue, width: 1 }, shadow: makeShadow() });
    s.addText(c.icon,  { x: bx,       y: 2.8, w: 2.3, h: 0.52, fontSize: 26, align: "center", margin: 0 });
    s.addText(c.label, { x: bx + 0.1, y: 3.34, w: 2.1, h: 0.3,  fontSize: 13, bold: true, color: C.white, align: "center", margin: 0 });
    s.addText(c.sub,   { x: bx + 0.05,y: 3.66, w: 2.2, h: 0.35, fontSize: 10, color: "8AAAD5", align: "center", margin: 0 });
  });

  s.addText("🙏  Mahima App",                      { x: 0.5, y: 4.5, w: 4, h: 0.55, fontSize: 22, bold: true, color: C.gold, align: "left", margin: 0 });
  s.addText("Empowering Ministries to Serve Better", { x: 0.5, y: 4.95, w: 5, h: 0.3,  fontSize: 11, color: "607BAD", align: "left", margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.45, w: 10, h: 0.175, fill: { color: C.gold }, line: { color: C.gold, width: 0 } });
  s.addText("v4.1 SaaS  •  Confidential  •  2026", { x: 6, y: 5.12, w: 3.8, h: 0.28, fontSize: 9, color: "607BAD", align: "right", margin: 0 });
})();

// ─── WRITE FILE ──────────────────────────────────────────────────────────────
pres.writeFile({ fileName: "Mahima_App_SaaS_Marketing_Deck_2026.pptx" })
  .then(() => console.log("✅  Mahima_App_SaaS_Marketing_Deck_2026.pptx created successfully!"))
  .catch(err => console.error("❌  Error:", err));
