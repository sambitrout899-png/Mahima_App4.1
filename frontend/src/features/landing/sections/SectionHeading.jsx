import React from "react";

export default function SectionHeading({ eyebrow, title, subtitle, theme }) {
  return (
    <div>
      {eyebrow && (
        <div className="text-xs font-black uppercase tracking-[0.24em]" style={{ color: theme?.primary || "var(--tenant-primary)" }}>
          {eyebrow}
        </div>
      )}
      <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{subtitle}</p>}
    </div>
  );
}
