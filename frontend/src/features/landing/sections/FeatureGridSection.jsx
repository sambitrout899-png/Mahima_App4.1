import React from "react";
import { HeartHandshake, Users } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { resolveAsset } from "./shared";

export default function FeatureGridSection({ section, theme }) {
  const items = Array.isArray(section.items) ? section.items : [];
  return (
    <div className="my-8">
      <SectionHeading eyebrow={section.eyebrow || "Ministry"} title={section.title || "Ministries"} subtitle={section.subtitle || section.text} theme={theme} />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
            {item.imageUrl ? (
              <img src={resolveAsset(item.imageUrl)} alt="" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-lg" style={{ background: theme.primarySoft, color: theme.primary }}>
                {index % 2 === 0 ? <Users className="h-6 w-6" /> : <HeartHandshake className="h-6 w-6" />}
              </div>
            )}
            <h3 className="mt-4 text-xl font-black">{item.title || "Section item"}</h3>
            {item.text && <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
