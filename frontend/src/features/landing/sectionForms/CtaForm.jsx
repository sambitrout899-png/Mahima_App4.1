import React from "react";
import { TextField, TextAreaField } from "./fields";

export default function CtaForm({ section, update }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
      <TextAreaField label="Text" value={section.text} onChange={(v) => update({ text: v })} />
      <TextField label="Button label" value={section.buttonLabel} onChange={(v) => update({ buttonLabel: v })} />
      <TextField label="Button link" value={section.buttonHref} onChange={(v) => update({ buttonHref: v })} />
    </div>
  );
}
