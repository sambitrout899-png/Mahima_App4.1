import React from "react";
import { ArrowRight } from "lucide-react";

export default function CtaSection({ section, theme }) {
  return (
    <div className="my-8 overflow-hidden rounded-2xl p-8 text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.dark})` }}>
      <h2 className="text-3xl font-black">{section.title || "Call to action"}</h2>
      {section.text && <p className="mt-3 max-w-3xl text-lg text-white/80">{section.text}</p>}
      {section.buttonLabel && (
        <a href={section.buttonHref || "/#/login"} className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-slate-950">
          {section.buttonLabel} <ArrowRight className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}
