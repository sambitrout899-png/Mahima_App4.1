import React from "react";
import { TextField, TextAreaField, ImageUrlField } from "./fields";

export default function StoryForm({ section, update, uploadImage, uploadingKey }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
      <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
      <TextAreaField label="Text" value={section.text} onChange={(v) => update({ text: v })} />
      <ImageUrlField label="Image" value={section.imageUrl} onChange={(v) => update({ imageUrl: v })} onUpload={(file) => uploadImage(file, (url) => update({ imageUrl: url }), "story-image")} uploading={uploadingKey === "story-image"} />
    </div>
  );
}
