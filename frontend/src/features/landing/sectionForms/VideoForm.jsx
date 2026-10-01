import React from "react";
import { TextField, TextAreaField } from "./fields";

export default function VideoForm({ section, update }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
      <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
      <TextAreaField label="Subtitle" value={section.subtitle} onChange={(v) => update({ subtitle: v })} />
      <TextField label="YouTube or Vimeo URL" value={section.videoUrl} onChange={(v) => update({ videoUrl: v })} placeholder="https://youtube.com/watch?v=..." />
    </div>
  );
}
