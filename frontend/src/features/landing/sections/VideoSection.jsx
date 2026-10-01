import React from "react";
import { Video } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { youTubeOrVimeoEmbed } from "./shared";

export default function VideoSection({ section, theme }) {
  const embed = youTubeOrVimeoEmbed(section.videoUrl);
  return (
    <div className="my-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <SectionHeading eyebrow={section.eyebrow || "Watch"} title={section.title || "Watch our story"} subtitle={section.subtitle} theme={theme} />
      <div className="mt-5 overflow-hidden rounded-xl bg-slate-950">
        {embed ? (
          <div className="aspect-video">
            <iframe src={embed} title={section.title || "Video"} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        ) : (
          <div className="grid aspect-video place-items-center text-slate-500">
            <span className="flex flex-col items-center gap-2 text-sm font-semibold"><Video className="h-8 w-8" /> Add a YouTube or Vimeo link</span>
          </div>
        )}
      </div>
    </div>
  );
}
