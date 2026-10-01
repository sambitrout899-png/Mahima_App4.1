import React from "react";
import { TextField, TextAreaField, AddItemButton, ItemCard } from "./fields";

export default function FaqForm({ section, update }) {
  const items = Array.isArray(section.items) ? section.items : [];
  const updateItem = (index, patch) => update({ items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const removeItem = (index) => update({ items: items.filter((_, i) => i !== index) });
  const addItem = () => update({ items: [...items, { question: "Question", answer: "Answer" }] });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Eyebrow" value={section.eyebrow} onChange={(v) => update({ eyebrow: v })} />
        <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
        <TextAreaField label="Subtitle" value={section.subtitle} onChange={(v) => update({ subtitle: v })} />
      </div>
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="mb-3 flex items-center justify-between"><b className="text-sm text-slate-700">Questions</b><AddItemButton label="Add Question" onClick={addItem} /></div>
        <div className="grid gap-3">
          {items.map((item, index) => (
            <ItemCard key={index} onRemove={() => removeItem(index)}>
              <TextField label="Question" value={item.question} onChange={(v) => updateItem(index, { question: v })} />
              <TextAreaField label="Answer" value={item.answer} onChange={(v) => updateItem(index, { answer: v })} />
            </ItemCard>
          ))}
        </div>
      </div>
    </div>
  );
}
