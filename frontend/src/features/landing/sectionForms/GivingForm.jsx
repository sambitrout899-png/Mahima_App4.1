import React from "react";
import { TextField, TextAreaField, ImageUrlField } from "./fields";

export default function GivingForm({ section, update, uploadImage, uploadingKey }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Title" value={section.title} onChange={(v) => update({ title: v })} />
      <TextAreaField label="Text" value={section.text} onChange={(v) => update({ text: v })} />
      <TextField label="Secondary text (e.g. bank / UPI details)" value={section.secondaryText} onChange={(v) => update({ secondaryText: v })} />
      <ImageUrlField
        label="QR code image"
        hint="Scannable donation QR (e.g. UPI QR)"
        value={section.imageUrl}
        onChange={(v) => update({ imageUrl: v })}
        onUpload={(file) => uploadImage(file, (url) => update({ imageUrl: url }), "giving-image")}
        uploading={uploadingKey === "giving-image"}
      />
      <TextField label="Button label" value={section.buttonLabel} onChange={(v) => update({ buttonLabel: v })} />
      <TextField label="Button link" value={section.buttonHref} onChange={(v) => update({ buttonHref: v })} />
    </div>
  );
}
