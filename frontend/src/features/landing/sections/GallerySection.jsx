import React from "react";
import { ImageOff } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { resolveAsset } from "./shared";

export default function GallerySection({ section, theme }) {
  const images = Array.isArray(section.images) ? section.images : [];
  return (
    <div className="my-8">
      <SectionHeading eyebrow={section.eyebrow || "Gallery"} title={section.title || "Life at our church"} subtitle={section.subtitle} theme={theme} />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image, index) => (
          <figure key={index} className="group overflow-hidden rounded-xl bg-slate-100 shadow-sm ring-1 ring-slate-200">
            {image.url ? (
              <img src={resolveAsset(image.url)} alt={image.caption || ""} className="h-40 w-full object-cover transition duration-300 group-hover:scale-105" />
            ) : (
              <div className="grid h-40 w-full place-items-center text-slate-400"><ImageOff className="h-8 w-8" /></div>
            )}
            {image.caption && <figcaption className="p-2 text-center text-xs font-semibold text-slate-600">{image.caption}</figcaption>}
          </figure>
        ))}
        {!images.length && <p className="text-sm text-slate-500">No photos added yet.</p>}
      </div>
    </div>
  );
}
