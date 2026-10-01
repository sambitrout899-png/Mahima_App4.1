import React from "react";
import { CalendarDays, ExternalLink } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { resolveAsset } from "./shared";

export default function EventsSection({ section, theme }) {
  const items = Array.isArray(section.items) ? section.items : [];
  return (
    <div className="my-8">
      <SectionHeading eyebrow={section.eyebrow || "Calendar"} title={section.title || "Upcoming events"} subtitle={section.subtitle} theme={theme} />
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <div key={index} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {item.imageUrl && <img src={resolveAsset(item.imageUrl)} alt="" className="h-36 w-full object-cover" />}
            <div className="p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide" style={{ color: theme.accent }}>
                <CalendarDays className="h-4 w-4" /> {item.date || "Date to be announced"}
              </div>
              <h3 className="mt-2 text-lg font-black text-slate-950">{item.title || "Event"}</h3>
              {item.description && <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>}
              {item.href && (
                <a href={item.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-bold" style={{ color: theme.primary }}>
                  Learn more <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-slate-500">No events scheduled yet.</p>}
      </div>
    </div>
  );
}
