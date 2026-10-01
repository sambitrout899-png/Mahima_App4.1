export const NOTIFICATION_EVENT = "mahima:notification";

export function readableError(value, fallback = "The action could not be completed.") {
  const data = value?.response?.data ?? value?.data ?? value;
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    const message = data.message || data.detail || data.error || data.title;
    if (typeof message === "string" && message.trim()) return message.trim();
    const errors = data.errors;
    if (errors && typeof errors === "object") {
      const messages = Object.entries(errors).flatMap(([field, entries]) =>
        (Array.isArray(entries) ? entries : [entries]).map((entry) => `${field}: ${entry}`)
      );
      if (messages.length) return messages.join(" ");
    }
  }
  return value?.body || value?.message || fallback;
}

export function notify(message, type = "info", options = {}) {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, {
    detail: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message: String(message),
      type,
      duration: options.duration ?? (type === "error" ? 8000 : 4500),
    },
  }));
}

export const notifySuccess = (message, options) => notify(message, "success", options);
export const notifyError = (error, fallback, options) => notify(readableError(error, fallback), "error", options);
export const notifyWarning = (message, options) => notify(message, "warning", options);

export function defaultActionMessage(method, url) {
  const verb = String(method || "GET").toUpperCase();
  const path = String(url || "").toLowerCase();
  if (verb === "DELETE") return "Deleted successfully.";
  if (path.includes("approve")) return "Approved successfully.";
  if (path.includes("reject")) return "Rejected successfully.";
  if (path.includes("publish")) return "Published successfully.";
  if (path.includes("activate")) return "Activated successfully.";
  if (path.includes("suspend")) return "Suspended successfully.";
  if (path.includes("reset-password")) return "Password reset successfully.";
  if (verb === "POST") return "Created successfully.";
  if (verb === "PUT" || verb === "PATCH") return "Changes saved successfully.";
  return "Action completed successfully.";
}
