import api from "../api";

const ROOT = "/api/languages";
const ADMIN = "/api/admin/languages";

export async function listEnabledLanguages() {
  const result = await api.get(ROOT);
  const data = result?.data ?? result;
  return Array.isArray(data) ? data : [];
}

export async function listAllLanguages() {
  const result = await api.get(ADMIN);
  const data = result?.data ?? result;
  return Array.isArray(data) ? data : [];
}

export async function createLanguage(payload) {
  const result = await api.post(ADMIN, payload);
  return result?.data ?? result;
}

export async function updateLanguage(code, patch) {
  const result = await api.put(`${ADMIN}/${encodeURIComponent(code)}`, patch);
  return result?.data ?? result;
}

export async function deleteLanguage(code) {
  await api.delete(`${ADMIN}/${encodeURIComponent(code)}`);
}

export async function reorderLanguages(items) {
  await api.put(`${ADMIN}/reorder`, items);
}

export async function getMyPreferredLanguage() {
  const result = await api.get("/api/users/me/language");
  return (result?.data ?? result)?.language || "";
}

export async function updateMyPreferredLanguage(language) {
  const result = await api.put("/api/users/me/language", { language });
  return (result?.data ?? result)?.language || language;
}

export const ISO_LANGUAGE_DIRECTORY = [
  { code: "en", name: "English", nativeName: "English", rtl: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", rtl: false },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", rtl: false },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", rtl: false },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", rtl: false },
  { code: "mr", name: "Marathi", nativeName: "मराठी", rtl: false },
  { code: "ur", name: "Urdu", nativeName: "اُردُو", rtl: true },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", rtl: false },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", rtl: false },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", rtl: false },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", rtl: false },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", rtl: false },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", rtl: false },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", rtl: false },
  { code: "si", name: "Sinhala", nativeName: "සිංහල", rtl: false },
  { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true },
  { code: "fr", name: "French", nativeName: "Français", rtl: false },
  { code: "es", name: "Spanish", nativeName: "Español", rtl: false },
  { code: "de", name: "German", nativeName: "Deutsch", rtl: false },
  { code: "pt", name: "Portuguese", nativeName: "Português", rtl: false },
  { code: "zh", name: "Chinese", nativeName: "中文", rtl: false },
  { code: "ja", name: "Japanese", nativeName: "日本語", rtl: false },
  { code: "ko", name: "Korean", nativeName: "한국어", rtl: false },
];
