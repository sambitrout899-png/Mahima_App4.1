export function apiTime(value) {
  if (!value) return null;
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

export function checkInPayload(form) {
  return { ...form, childName: form.childName.trim(), guardianName: form.guardianName.trim(), childDob: form.childDob || null };
}

export function requireModuleResponse(response, fallback) {
  if (response?.ok) return response.data;
  if (response?.status === 404) throw new Error(`${fallback} The requested service or record is unavailable. Please try again later.`);
  let detail = response?.error;
  if (typeof detail === "string") {
    try { detail = JSON.parse(detail); } catch { /* A plain-text API error is valid. */ }
  }
  if (detail && typeof detail === "object") {
    detail = detail.message || detail.detail || Object.values(detail.errors || {}).flat().join(" ") || detail.title;
  }
  throw new Error(typeof detail === "string" && detail.trim() && !/^\d{3}$/.test(detail) ? detail : fallback);
}
