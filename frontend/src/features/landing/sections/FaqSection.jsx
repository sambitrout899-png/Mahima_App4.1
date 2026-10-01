import React from "react";
import { ChevronDown } from "lucide-react";
import SectionHeading from "./SectionHeading";

export default function FaqSection({ section, theme }) {
  const items = Array.isArray(section.items) ? section.items : [];
  return (
    <div className="my-8">
      <SectionHeading eyebrow={section.eyebrow || "Questions"} title={section.title || "Frequently asked questions"} subtitle={section.subtitle} theme={theme} />
      <div className="mt-6 grid gap-3">
        {items.map((item, index) => (
          <details key={index} className="group rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-slate-900">
              {item.question || "Question"}
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
            </summary>
            {item.answer && <p className="mt-3 text-sm leading-6 text-slate-600">{item.answer}</p>}
          </details>
        ))}
        {!items.length && <p className="text-sm text-slate-500">No questions added yet.</p>}
      </div>
    </div>
  );
}
