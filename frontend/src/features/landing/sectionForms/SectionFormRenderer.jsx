import React from "react";
import StoryForm from "./StoryForm";
import FeatureGridForm from "./FeatureGridForm";
import CtaForm from "./CtaForm";
import GalleryForm from "./GalleryForm";
import TestimonialsForm from "./TestimonialsForm";
import StaffForm from "./StaffForm";
import EventsForm from "./EventsForm";
import GivingForm from "./GivingForm";
import MapForm from "./MapForm";
import FaqForm from "./FaqForm";
import VideoForm from "./VideoForm";
import ThemeOverrideFields from "./ThemeOverrideFields";

const FORMS = {
  story: StoryForm,
  "feature-grid": FeatureGridForm,
  cta: CtaForm,
  gallery: GalleryForm,
  testimonials: TestimonialsForm,
  staff: StaffForm,
  events: EventsForm,
  giving: GivingForm,
  map: MapForm,
  faq: FaqForm,
  video: VideoForm,
};

export default function SectionFormRenderer({ section, update, uploadImage, uploadingKey }) {
  const type = String(section?.type || "feature-grid").toLowerCase();
  const Form = FORMS[type] || FeatureGridForm;
  return (
    <>
      <Form section={section || {}} update={update} uploadImage={uploadImage} uploadingKey={uploadingKey} />
      <ThemeOverrideFields section={section || {}} update={update} />
    </>
  );
}
