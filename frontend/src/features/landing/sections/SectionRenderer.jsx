import React from "react";
import { buildTheme } from "./shared";
import StorySection from "./StorySection";
import FeatureGridSection from "./FeatureGridSection";
import CtaSection from "./CtaSection";
import GallerySection from "./GallerySection";
import TestimonialsSection from "./TestimonialsSection";
import StaffSection from "./StaffSection";
import EventsSection from "./EventsSection";
import GivingSection from "./GivingSection";
import MapSection from "./MapSection";
import FaqSection from "./FaqSection";
import VideoSection from "./VideoSection";

const COMPONENTS = {
  story: StorySection,
  "feature-grid": FeatureGridSection,
  cta: CtaSection,
  gallery: GallerySection,
  testimonials: TestimonialsSection,
  staff: StaffSection,
  events: EventsSection,
  giving: GivingSection,
  map: MapSection,
  faq: FaqSection,
  video: VideoSection,
};

export default function SectionRenderer({ section, theme, branding }) {
  const type = String(section?.type || "feature-grid").toLowerCase();
  const Component = COMPONENTS[type] || FeatureGridSection;
  // A section's own themeOverride replaces only the color/font fields it sets;
  // everything else still comes from the tenant's brand theme.
  const effectiveTheme = section?.themeOverride
    ? buildTheme(branding, section.themeOverride)
    : theme;
  return <Component section={section || {}} theme={effectiveTheme} branding={branding} />;
}
