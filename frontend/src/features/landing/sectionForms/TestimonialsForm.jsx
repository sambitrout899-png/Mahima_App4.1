import React from "react";
import { TextField, TextAreaField, ImageUrlField, AddItemButton, RemoveItemButton } from "./fields";

export default function TestimonialsForm({ section, update, uploadImage, uploadingKey }) {
  const items = Array.isArray(section.items) ? section.items : [];
  const updateItem = (index, patch) => update({ items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const removeItem = (index) => update({ items: items.filter((_, i) => i !== index) });
  const addItem = () => update({ items: [...items, { quote: "", name: "", role: "", photoUrl: "" }] });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
        <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
        <TextAreaField label="Subtitle" value={section.subtitle} onChange={(v) => update({ subtitle: v })} />
      </div>
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="mb-3 flex items-center justify-between"><b className="text-sm text-slate-700">Testimonies</b><AddItemButton label="Add Testimony" onClick={addItem} /></div>
        <div className="grid gap-3">
          {items.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_auto]">
              <div className="grid gap-2 md:grid-cols-2">
                <TextAreaField label="Quote" value={item.quote} onChange={(v) => updateItem(index, { quote: v })} />
                <TextField label="Name" value={item.name} onChange={(v) => updateItem(index, { name: v })} />
                <TextField label="Role (optional)" value={item.role} onChange={(v) => updateItem(index, { role: v })} />
                <ImageUrlField label="Photo (optional)" value={item.photoUrl} onChange={(v) => updateItem(index, { photoUrl: v })} onUpload={(file) => uploadImage(file, (url) => updateItem(index, { photoUrl: url }), `testimonial-${index}`)} uploading={uploadingKey === `testimonial-${index}`} />
              </div>
              <RemoveItemButton onClick={() => removeItem(index)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
