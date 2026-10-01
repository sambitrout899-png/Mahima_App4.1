/**
 * Twilio & WhatsApp Implementation Requirements — Mahima App Digital Marketing Module
 * Run from the project root:
 *   node generate_twilio_whatsapp_requirements_pdf.cjs
 */

const PDFDocument = require("pdfkit");
const fs = require("fs");

const C = {
  navy: "#0F1F5C",
  gold: "#F5A623",
  slate: "#4A5568",
  midgray: "#8899B8",
  lightgray: "#E8EDF7",
  success: "#10B981",
  coral: "#E53E3E",
};

const doc = new PDFDocument({ size: "A4", margins: { top: 60, bottom: 60, left: 56, right: 56 }, bufferPages: true });
const outPath = "Twilio_WhatsApp_Implementation_Requirements.pdf";
doc.pipe(fs.createWriteStream(outPath));

const PAGE_W = doc.page.width - 56 - 56;

function header() {
  doc.rect(0, 0, doc.page.width, 8).fill(C.gold);
}

function coverPage() {
  header();
  doc.rect(0, 8, doc.page.width, 220).fill(C.navy);
  doc.fillColor(C.gold).font("Helvetica-Bold").fontSize(11)
    .text("MAHIMA APP  ·  DIGITAL MARKETING MODULE", 56, 60, { characterSpacing: 1.5 });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(28)
    .text("Twilio & WhatsApp", 56, 90, { width: PAGE_W });
  doc.fontSize(28).text("Implementation Requirements", 56, 128, { width: PAGE_W });
  doc.fillColor("#A8BBDD").font("Helvetica").fontSize(12)
    .text("What's needed — beyond code — to send real SMS and WhatsApp outreach at scale, in India and globally.", 56, 176, { width: PAGE_W - 40 });

  doc.fillColor(C.slate).font("Helvetica").fontSize(10)
    .text("Prepared for: Mahima Ministries  ·  2026", 56, 250);

  doc.moveDown(2);
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(13).text("Contents", 56, 300);
  const contents = [
    "1.  Twilio Account Setup",
    "2.  WhatsApp-Specific Requirements (Meta)",
    "3.  India-Specific Regulatory Requirement (DLT)",
    "4.  Other Countries — Global Expansion",
    "5.  Compliance Already Built Into the App",
    "6.  Recommended Rollout Order",
  ];
  let cy = 330;
  contents.forEach((c) => {
    doc.fillColor(C.slate).font("Helvetica").fontSize(11).text(c, 70, cy);
    cy += 22;
  });
}

function sectionTitle(num, title) {
  if (doc.y > 680) doc.addPage();
  doc.moveDown(1.2);
  const y = doc.y;
  doc.rect(56, y, 4, 22).fill(C.gold);
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(15).text(`${num}.  ${title}`, 70, y + 1);
  doc.moveDown(0.6);
}

function bullet(title, desc, color) {
  if (doc.y > 730) doc.addPage();
  const y = doc.y;
  doc.circle(62, y + 6, 2.5).fill(color || C.gold);
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(10.5).text(title, 74, y, { width: PAGE_W - 18, continued: false });
  doc.fillColor(C.slate).font("Helvetica").fontSize(10).text(desc, 74, doc.y + 1, { width: PAGE_W - 18, lineGap: 2 });
  doc.moveDown(0.55);
}

function note(text) {
  if (doc.y > 720) doc.addPage();
  const y = doc.y;
  doc.rect(56, y, PAGE_W, 0.001);
  doc.save();
  doc.rect(56, y, PAGE_W, doc.heightOfString(text, { width: PAGE_W - 24, fontSize: 9.5 }) + 16)
    .fill(C.lightgray);
  doc.fillColor(C.navy).font("Helvetica-Oblique").fontSize(9.5)
    .text(text, 68, y + 8, { width: PAGE_W - 24, lineGap: 2 });
  doc.restore();
  doc.moveDown(1);
}

// ─── COVER ─────────────────────────────────────────────────────────────────
coverPage();
doc.addPage();
header();
doc.y = 40;

// ─── 1. TWILIO ACCOUNT SETUP ─────────────────────────────────────────────
sectionTitle(1, "Twilio Account Setup");
bullet("A paid Twilio account", "Trial accounts can only send to phone numbers you've manually verified in the console — this defeats the purpose of cold outreach to new prospects.");
bullet("Account SID + Auth Token", "Maps to config keys Twilio:AccountSid / Twilio:AuthToken (or env vars TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN). Already scaffolded in appsettings.json — currently blank placeholders.");
bullet("An SMS-capable phone number", "Maps to Twilio:FromNumber. Purchased directly in the Twilio console.");
bullet("A WhatsApp-enabled sender", "Maps to Twilio:WhatsAppFrom. Separate from the SMS number — provisioned through Twilio's WhatsApp onboarding flow.");
bullet("A Messaging Service SID", "Maps to Twilio:MessagingServiceSid. Optional at first, but recommended at real volume — manages sender pools, number rotation, and is where India/US registrations (see below) actually attach.");

// ─── 2. WHATSAPP-SPECIFIC ────────────────────────────────────────────────
sectionTitle(2, "WhatsApp-Specific Requirements (Meta)");
doc.fillColor(C.slate).font("Helvetica-Oblique").fontSize(10).text("This is the heavier lift of the two channels.", 56, doc.y, { width: PAGE_W });
doc.moveDown(0.5);
bullet("A verified Meta Business Manager account", "Meta requires business verification (legal name, address, sometimes documents) before approving any WhatsApp Business sender beyond the sandbox.", C.coral);
bullet("A WhatsApp Business Account (WABA)", "Linked through Twilio's Meta integration.");
bullet("At least one approved Content Template", "This is the WhatsAppContentSid field already built into the campaign form. Template text is submitted through Twilio's Content Template Builder; Meta reviews it (hours to days, can be rejected). Only after approval does the ContentSid become usable. Plan for one template per target language.", C.coral);
bullet("Messaging tier limits", "New WABAs start capped around 250 unique conversations / 24h and scale up automatically based on volume and quality rating (user blocks/reports hurt this). Reaching all prospects globally on day one isn't realistic on WhatsApp regardless of code — it ramps over weeks.");
bullet("Template category", "Meta's \"Marketing\" category templates allow cold outreach, but are priced higher than \"Utility\" templates and face stricter quality enforcement. Expect some rejections if copy reads as spammy.");

// ─── 3. INDIA DLT ─────────────────────────────────────────────────────────
sectionTitle(3, "India-Specific Regulatory Requirement (DLT)");
doc.fillColor(C.slate).font("Helvetica").fontSize(10).text(
  "Separate from Twilio and Meta entirely — a TRAI (Indian telecom regulator) requirement.",
  56, doc.y, { width: PAGE_W }
);
doc.moveDown(0.5);
bullet("DLT (Distributed Ledger Technology) registration", "Mandatory for sending any promotional/transactional SMS to Indian phone numbers.", C.coral);
bullet("Register as a Principal Entity", "Done with a DLT operator platform (Jio / Airtel / Vodafone-Idea).");
bullet("Register a Sender ID and exact SMS templates", "Without this, Indian carriers silently block the SMS — Twilio reports it as \"sent\", but it never arrives.");
note("This is a multi-day-to-multi-week bureaucratic process, not a code or configuration change. Budget lead time for this before promising India-wide SMS reach.");

// ─── 4. OTHER COUNTRIES ──────────────────────────────────────────────────
sectionTitle(4, "Other Countries — Global Expansion");
bullet("United States", "Requires A2P 10DLC campaign registration — the US equivalent of India's DLT framework.");
bullet("Other regions", "Some countries require local numbers or alphanumeric sender IDs rather than a shared international number. Verify per target country before assuming SMS will land — don't assume global reach is a single toggle.");

// ─── 5. COMPLIANCE ────────────────────────────────────────────────────────
sectionTitle(5, "Compliance Already Built Into the App");
bullet("Suppression / opt-out model", "DoNotContact flag and unsubscribe tokens are already implemented, giving a defensible consent trail.", C.success);
bullet("Why this matters", "Matters both for WhatsApp's policy enforcement (Meta can suspend accounts for unwanted messaging) and general spam-law exposure (GDPR-adjacent rules apply once emailing/texting EU prospects).", C.success);
bullet("Template/copy guidance", "Keep outreach copy honest about who you are and why you're messaging — a Meta approval requirement as much as a legal one.");

// ─── 6. ROLLOUT ORDER ─────────────────────────────────────────────────────
sectionTitle(6, "Recommended Rollout Order");
bullet("1. SMS first", "Faster to get live: Twilio number + India DLT registration. No Meta approval dependency.", C.success);
bullet("2. WhatsApp second", "Gate behind Meta business verification, template approval, and the natural tier ramp-up — expect this to take longer and scale gradually, not instantly.", C.coral);
note("Nothing further needs to change in the Mahima App codebase for any of the above — this is all external provisioning on the Twilio/Meta side. Once accounts, numbers, and approvals exist, drop the resulting IDs into the existing Twilio / Marketing config keys and the module is live.");

// ─── FOOTER ON EVERY PAGE ─────────────────────────────────────────────────
const pages = doc.bufferedPageRange();
for (let i = 0; i < pages.count; i++) {
  doc.switchToPage(i);
  doc.fillColor(C.midgray).font("Helvetica").fontSize(8)
    .text(`Mahima App — Digital Marketing Module  ·  Page ${i + 1} of ${pages.count}`, 56, doc.page.height - 40, {
      width: PAGE_W, align: "center",
    });
}

doc.end();
console.log(`✅  ${outPath} created successfully!`);
