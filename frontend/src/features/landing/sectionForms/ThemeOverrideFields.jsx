import React from "react";
import { Palette } from "lucide-react";
import { ColorField, FontField } from "./fields";

// Shared across every section type: lets one section replace the brand's
// colors/fonts for itself only. Off by default (section.themeOverride is
// absent) so a section with no override renders exactly like before.
export default function ThemeOverrideFields({ section, update }) {
  const enabled = Boolean(section.themeOverride);
  const override = section.themeOverride || {};

  function updateOverride(key, value) {
    update({ themeOverride: { ...override, [key]: value } });
  }

  return (
    <fieldset className="mt-4 rounded-xl border border-slate-200 p-3">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-bold text-slate-700">
        <Palette className="h-4 w-4" /> Appearance for this section
      </legend>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
        <input
          type="checkbox"
          className="accent-emerald-700"
          checked={enabled}
          onChange={(e) => update({ themeOverride: e.target.checked ? {} : undefined })}
        />
        Override the brand's colors/fonts for this section only
      </label>
      {enabled && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ColorField label="Primary color" value={override.primaryColor} onChange={(v) => updateOverride("primaryColor", v)} />
          <ColorField label="Accent color" value={override.accentColor} onChange={(v) => updateOverride("accentColor", v)} />
          <ColorField label="Neutral (background)" value={override.neutralColor} onChange={(v) => updateOverride("neutralColor", v)} />
          <ColorField label="Dark (text/contrast)" value={override.darkColor} onChange={(v) => updateOverride("darkColor", v)} />
          <FontField label="Heading font" value={override.headingFont} onChange={(v) => updateOverride("headingFont", v)} />
          <FontField label="Body font" value={override.bodyFont} onChange={(v) => updateOverride("bodyFont", v)} />
          <p className="text-xs font-medium text-slate-400 md:col-span-2">
            Leave any field showing the brand default by not changing it - only fields you set here override the brand.
          </p>
        </div>
      )}
    </fieldset>
  );
}
