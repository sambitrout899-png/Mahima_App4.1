import React from "react";
import { HandCoins } from "lucide-react";
import { resolveAsset } from "./shared";

export default function GivingSection({ section, theme }) {
  return (
    <div className="my-8 grid gap-6 overflow-hidden rounded-2xl p-8 text-white shadow-sm lg:grid-cols-[auto_1fr_auto] lg:items-center" style={{ background: `linear-gradient(135deg, ${theme.dark}, ${theme.primary})` }}>
      {section.imageUrl ? (
        <img
          src={resolveAsset(section.imageUrl)}
          alt="Donation QR code"
          className="h-28 w-28 rounded-xl border border-white/20 bg-white object-contain p-2 lg:h-32 lg:w-32"
        />
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><HandCoins className="h-7 w-7" /></span>
      )}
      <div>
        <h2 className="text-2xl font-black">{section.title || "Support this ministry"}</h2>
        {section.text && <p className="mt-2 max-w-2xl text-white/85">{section.text}</p>}
        {section.secondaryText && <p className="mt-1 text-sm text-white/70">{section.secondaryText}</p>}
      </div>
      {section.buttonLabel && (
        <a href={section.buttonHref || "#"} className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950">
          {section.buttonLabel}
        </a>
      )}
    </div>
  );
}
