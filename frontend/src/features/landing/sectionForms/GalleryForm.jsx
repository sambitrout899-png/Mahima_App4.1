import React from "react";
import { TextField, TextAreaField, ImageUrlField, AddItemButton, RemoveItemButton } from "./fields";

export default function GalleryForm({ section, update, uploadImage, uploadingKey }) {
  const images = Array.isArray(section.images) ? section.images : [];
  const updateImage = (index, patch) => update({ images: images.map((image, i) => (i === index ? { ...image, ...patch } : image)) });
  const removeImage = (index) => update({ images: images.filter((_, i) => i !== index) });
  const addImage = () => update({ images: [...images, { url: "", caption: "" }] });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
        <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
        <TextAreaField label="Subtitle" value={section.subtitle} onChange={(v) => update({ subtitle: v })} />
      </div>
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="mb-3 flex items-center justify-between"><b className="text-sm text-slate-700">Photos</b><AddItemButton label="Add Photo" onClick={addImage} /></div>
        <div className="grid gap-3">
          {images.map((image, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <ImageUrlField label="Photo" value={image.url} onChange={(v) => updateImage(index, { url: v })} onUpload={(file) => uploadImage(file, (url) => updateImage(index, { url }), `gallery-${index}`)} uploading={uploadingKey === `gallery-${index}`} />
                <TextField label="Caption (optional)" value={image.caption} onChange={(v) => updateImage(index, { caption: v })} />
              </div>
              <RemoveItemButton onClick={() => removeImage(index)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
