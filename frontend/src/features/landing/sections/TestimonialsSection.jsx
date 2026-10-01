import React from "react";
import { Quote } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { resolveAsset } from "./shared";

export default function TestimonialsSection({ section, theme }) {
  const items = Array.isArray(section.items) ? section.items : [];
  return (
    <div className="my-8">
      <SectionHeading eyebrow={section.eyebrow || "Testimonies"} title={section.title || "What our community says"} subtitle={section.subtitle} theme={theme} />
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <figure key={index} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <Quote className="h-6 w-6" style={{ color: theme.accent }} />
            <blockquote className="mt-3 text-sm leading-6 text-slate-700">{item.quote || "A wonderful place to belong."}</blockquote>
            <figcaption className="mt-4 flex items-center gap-3">
              {item.photoUrl ? (
                <img src={resolveAsset(item.photoUrl)} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white" style={{ background: theme.primary }}>
                  {(item.name || "?").trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span>
                <span className="block text-sm font-black text-slate-900">{item.name || "Church member"}</span>
                {item.role && <span className="block text-xs text-slate-500">{item.role}</span>}
              </span>
            </figcaption>
          </figure>
        ))}
        {!items.length && <p className="text-sm text-slate-500">No testimonies added yet.</p>}
      </div>
    </div>
  );
}
