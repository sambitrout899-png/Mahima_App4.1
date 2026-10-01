import React from "react";
import { HeartHandshake } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { resolveAsset } from "./shared";

export default function StorySection({ section, theme }) {
  return (
    <div className="my-8 grid gap-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:grid-cols-[1fr_360px]">
      <div>
        <SectionHeading eyebrow={section.eyebrow || "About"} title={section.title || "Our story"} subtitle={section.text || section.subtitle} theme={theme} />
      </div>
      {section.imageUrl ? (
        <img
          src={resolveAsset(section.imageUrl)}
          alt={section.title || ""}
          className="h-72 w-full rounded-xl object-cover lg:h-full lg:min-h-72"
        />
      ) : (
        <div className="grid h-72 place-items-center rounded-xl lg:h-full lg:min-h-72" style={{ background: theme.primarySoft }}>
          <HeartHandshake className="h-16 w-16" style={{ color: theme.primary }} />
        </div>
      )}
    </div>
  );
}
