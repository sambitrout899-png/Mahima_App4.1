import React from "react";
import { User } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { resolveAsset } from "./shared";

export default function StaffSection({ section, theme }) {
  const items = Array.isArray(section.items) ? section.items : [];
  return (
    <div className="my-8">
      <SectionHeading eyebrow={section.eyebrow || "Leadership"} title={section.title || "Meet our team"} subtitle={section.subtitle} theme={theme} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => (
          <div key={index} className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
            {item.photoUrl ? (
              <img src={resolveAsset(item.photoUrl)} alt={item.name || ""} className="mx-auto h-24 w-24 rounded-full object-cover" />
            ) : (
              <span className="mx-auto grid h-24 w-24 place-items-center rounded-full" style={{ background: theme.primarySoft, color: theme.primary }}>
                <User className="h-10 w-10" />
              </span>
            )}
            <h3 className="mt-4 text-base font-black text-slate-950">{item.name || "Team member"}</h3>
            {item.role && <p className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.primary }}>{item.role}</p>}
            {item.bio && <p className="mt-2 text-xs leading-5 text-slate-600">{item.bio}</p>}
          </div>
        ))}
        {!items.length && <p className="text-sm text-slate-500">No team members added yet.</p>}
      </div>
    </div>
  );
}
