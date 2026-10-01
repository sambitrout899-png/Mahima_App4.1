import React from "react";
import { MapPin, Navigation } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { mapsUrlFor } from "./shared";

export default function MapSection({ section, theme, branding }) {
  const address = section.address || branding?.address || "";
  const href = mapsUrlFor(address, section.mapsUrl);
  return (
    <div className="my-8 grid gap-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:grid-cols-[1fr_auto] lg:items-center">
      <div>
        <SectionHeading eyebrow={section.eyebrow || "Visit us"} title={section.title || "Find our location"} subtitle={section.note} theme={theme} />
        {address && (
          <div className="mt-4 flex items-start gap-3 text-sm font-semibold text-slate-700">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.primary }} />
            <span>{address}</span>
          </div>
        )}
      </div>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-black text-white" style={{ background: theme.primary }}>
          <Navigation className="h-4 w-4" /> Open in Maps
        </a>
      )}
    </div>
  );
}
