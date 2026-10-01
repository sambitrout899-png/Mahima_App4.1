/**
 * Mahima App — Complete User Manual & SOP (PDF)
 * Single source of truth: frontend/src/features/manual/manualContent.js
 * (the same data that powers the in-app /home/user-manual page).
 * Run from the project root:
 *   node generate_mahima_user_manual_pdf.cjs
 */

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const C = {
  navy: "#0F1F5C",
  gold: "#F5A623",
  slate: "#4A5568",
  midgray: "#8899B8",
  lightgray: "#E8EDF7",
  success: "#10B981",
  teal: "#0D9488",
};

const GROUP_ORDER = [
  "Getting started", "Communication", "Ministry", "Faith resources", "Work",
  "People and access", "Operations", "Administration", "Subscription", "Mobile",
  "Root Platform Tools",
];

async function main() {
  const contentPath = path.join(__dirname, "frontend", "src", "features", "manual", "manualContent.js");
  const { guides } = await import(pathToFileURL(contentPath).href);

  const doc = new PDFDocument({ size: "A4", margins: { top: 60, bottom: 56, left: 56, right: 56 }, bufferPages: true });
  const outPath = "Mahima_App_User_Manual_SOP.pdf";
  doc.pipe(fs.createWriteStream(outPath));
  const PAGE_W = doc.page.width - 56 - 56;

  const grouped = GROUP_ORDER.map((group) => ({ group, items: guides.filter((g) => g.group === group) })).filter((g) => g.items.length);

  // ── COVER ────────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 8).fill(C.gold);
  doc.rect(0, 8, doc.page.width, 240).fill(C.navy);
  doc.fillColor(C.gold).font("Helvetica-Bold").fontSize(11).text("MAHIMA APP", 56, 60, { characterSpacing: 1.5 });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(30).text("Complete User Manual", 56, 90, { width: PAGE_W });
  doc.fontSize(30).text("& Standard Operating Procedure", 56, 128, { width: PAGE_W });
  doc.fillColor("#A8BBDD").font("Helvetica").fontSize(12).text(
    "Every page in the platform — church staff modules and Root/internal platform tools — with step-by-step operating instructions.",
    56, 178, { width: PAGE_W - 40 }
  );
  doc.fillColor(C.slate).font("Helvetica").fontSize(10).text("Mahima Ministries  ·  2026", 56, 262);

  doc.font("Helvetica-Bold").fontSize(13).fillColor(C.navy).text("Contents", 56, 300);
  let cy = 328;
  grouped.forEach((g, i) => {
    doc.font("Helvetica").fontSize(10.5).fillColor(C.slate)
      .text(`${i + 1}.  ${g.group}`, 70, cy, { continued: true })
      .fillColor(C.midgray).text(`   ${g.items.length} page${g.items.length === 1 ? "" : "s"}`, { align: "left" });
    cy += 19;
  });
  doc.fillColor(C.midgray).font("Helvetica-Oblique").fontSize(9)
    .text("Root Platform Tools are internal — visible only to the Root tenant's admin account, not to church customers.", 56, cy + 10, { width: PAGE_W });

  // ── CONTENT ──────────────────────────────────────────────────────────────
  doc.addPage();

  function ensureSpace(height) {
    if (doc.y + height > doc.page.height - 70) doc.addPage();
  }

  grouped.forEach((g, groupIndex) => {
    ensureSpace(60);
    doc.moveDown(groupIndex === 0 ? 0 : 0.6);
    const y = doc.y;
    doc.rect(56, y, PAGE_W, 26).fill(C.navy);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13).text(`${groupIndex + 1}.  ${g.group}`, 66, y + 6);
    doc.moveDown(1.4);

    g.items.forEach((guide, itemIndex) => {
      const stepsHeight = guide.steps.reduce((sum, step) => sum + doc.heightOfString(step, { width: PAGE_W - 40, fontSize: 9.5 }) + 6, 0);
      ensureSpace(46 + stepsHeight);

      const headingY = doc.y;
      doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(11.5).text(`${groupIndex + 1}.${itemIndex + 1}  ${guide.title}`, 56, headingY, { width: PAGE_W - 110 });
      const platformLabel = guide.platforms.includes("web") && guide.platforms.includes("mobile") ? "Web + Mobile" : guide.platforms.includes("mobile") ? "Mobile" : "Web";
      doc.fontSize(8).font("Helvetica-Bold").fillColor(C.teal)
        .text(platformLabel.toUpperCase(), 56, headingY, { width: PAGE_W, align: "right" });
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(C.midgray).text(`Access: ${guide.access}`, 56, doc.y + 2);
      doc.moveDown(0.35);

      guide.steps.forEach((step, stepIndex) => {
        const stepY = doc.y;
        doc.circle(62, stepY + 6, 7).fill(C.lightgray);
        doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(8).text(String(stepIndex + 1), 62 - 3.5, stepY + 2.5, { width: 7, align: "center" });
        doc.fillColor(C.slate).font("Helvetica").fontSize(9.5).text(step, 78, stepY, { width: PAGE_W - 22, lineGap: 1.5 });
        doc.moveDown(0.3);
      });
      doc.moveDown(0.55);
    });
  });

  // ── FOOTER ───────────────────────────────────────────────────────────────
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(C.midgray).font("Helvetica").fontSize(8)
      .text(`Mahima App — User Manual & SOP  ·  Page ${i + 1} of ${pages.count}`, 56, doc.page.height - 40, { width: PAGE_W, align: "center" });
  }

  doc.end();
  console.log(`✅  ${outPath} created successfully! (${grouped.reduce((n, g) => n + g.items.length, 0)} pages documented across ${grouped.length} sections)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
