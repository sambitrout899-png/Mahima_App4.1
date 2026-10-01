import React from "react";
import { TextField, TextAreaField, ImageUrlField, AddItemButton, RemoveItemButton } from "./fields";

export default function EventsForm({ section, update, uploadImage, uploadingKey }) {
  const items = Array.isArray(section.items) ? section.items : [];
  const updateItem = (index, patch) => update({ items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const removeItem = (index) => update({ items: items.filter((_, i) => i !== index) });
  const addItem = () => update({ items: [...items, { title: "New event", date: "", description: "", imageUrl: "", href: "" }] });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
        <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
        <TextAreaField label="Subtitle" value={section.subtitle} onChange={(v) => update({ subtitle: v })} />
      </div>
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="mb-3 flex items-center justify-between"><b className="text-sm text-slate-700">Events</b><AddItemButton label="Add Event" onClick={addItem} /></div>
        <div className="grid gap-3">
          {items.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_auto]">
              <div className="grid gap-2 md:grid-cols-2">
                <TextField label="Event title" value={item.title} onChange={(v) => updateItem(index, { title: v })} />
                <TextField label="Date / time" value={item.date} onChange={(v) => updateItem(index, { date: v })} placeholder="e.g. Sat, 14 Sep · 6 PM" />
                <TextAreaField label="Description" value={item.description} onChange={(v) => updateItem(index, { description: v })} />
                <TextField label="Link (optional)" value={item.href} onChange={(v) => updateItem(index, { href: v })} />
                <ImageUrlField label="Image (optional)" value={item.imageUrl} onChange={(v) => updateItem(index, { imageUrl: v })} onUpload={(file) => uploadImage(file, (url) => updateItem(index, { imageUrl: url }), `event-${index}`)} uploading={uploadingKey === `event-${index}`} />
              </div>
              <RemoveItemButton onClick={() => removeItem(index)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
