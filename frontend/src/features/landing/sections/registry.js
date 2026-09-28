// Single registry of the 11 section types — label/icon for the editor's "add section"
// menu, and a starter template so a newly added section renders sensibly immediately.

export const SECTION_TYPES = [
  {
    type: "story", label: "Story", icon: "BookOpen",
    template: { type: "story", eyebrow: "Welcome", title: "A church for your family", text: "Write a short introduction for this church, its pastor, and its heart for the city.", imageUrl: "" },
  },
  {
    type: "feature-grid", label: "Cards / Ministries", icon: "LayoutGrid",
    template: { type: "feature-grid", eyebrow: "Ministry", title: "Ministries", subtitle: "Show what people can join.", items: [{ title: "Prayer", text: "Weekly prayer and care." }, { title: "Youth", text: "Gatherings for young people." }, { title: "Families", text: "Support for homes and marriages." }] },
  },
  {
    type: "cta", label: "Call to Action", icon: "Megaphone",
    template: { type: "cta", title: "Plan your visit", text: "Tell visitors what to do next.", buttonLabel: "Member Login", buttonHref: "/#/login" },
  },
  {
    type: "gallery", label: "Gallery", icon: "Images",
    template: { type: "gallery", eyebrow: "Gallery", title: "Life at our church", subtitle: "", images: [] },
  },
  {
    type: "testimonials", label: "Testimonials", icon: "Quote",
    template: { type: "testimonials", eyebrow: "Testimonies", title: "What our community says", subtitle: "", items: [{ quote: "A wonderful place to belong.", name: "Member name", role: "" }] },
  },
  {
    type: "staff", label: "Staff / Leadership", icon: "Users",
    template: { type: "staff", eyebrow: "Leadership", title: "Meet our team", subtitle: "", items: [{ name: "Pastor name", role: "Senior Pastor", bio: "" }] },
  },
  {
    type: "events", label: "Events", icon: "CalendarDays",
    template: { type: "events", eyebrow: "Calendar", title: "Upcoming events", subtitle: "", items: [{ title: "Event title", date: "", description: "" }] },
  },
  {
    type: "giving", label: "Giving / Donate", icon: "HandCoins",
    template: { type: "giving", title: "Support this ministry", text: "Your generosity keeps our ministries running.", imageUrl: "", secondaryText: "", buttonLabel: "Give Now", buttonHref: "#" },
  },
  {
    type: "map", label: "Map / Location", icon: "MapPin",
    template: { type: "map", eyebrow: "Visit us", title: "Find our location", note: "", address: "", mapsUrl: "" },
  },
  {
    type: "faq", label: "FAQ", icon: "HelpCircle",
    template: { type: "faq", eyebrow: "Questions", title: "Frequently asked questions", subtitle: "", items: [{ question: "Question", answer: "Answer" }] },
  },
  {
    type: "video", label: "Video", icon: "Video",
    template: { type: "video", eyebrow: "Watch", title: "Watch our story", subtitle: "", videoUrl: "" },
  },
];

export function templateFor(type) {
  const found = SECTION_TYPES.find((entry) => entry.type === type);
  return found ? structuredCloneSafe(found.template) : structuredCloneSafe(SECTION_TYPES[1].template);
}

export function structuredCloneSafe(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}
