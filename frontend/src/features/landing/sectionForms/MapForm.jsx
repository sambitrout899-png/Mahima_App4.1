import React from "react";
import { TextField, TextAreaField } from "./fields";

export default function MapForm({ section, update }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
      <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
      <TextAreaField label="Note (optional)" value={section.note} onChange={(v) => update({ note: v })} />
      <TextAreaField label="Address override (optional — defaults to Brand contact address)" value={section.address} onChange={(v) => update({ address: v })} />
      <TextField label="Custom Maps link (optional)" value={section.mapsUrl} onChange={(v) => update({ mapsUrl: v })} placeholder="Leave blank to auto-generate from the address" />
    </div>
  );
}
