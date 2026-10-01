import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { NOTIFICATION_EVENT } from "../utils/notifications";

const styles = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  error: "border-red-200 bg-red-50 text-red-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  info: "border-blue-200 bg-blue-50 text-blue-950",
};

const icons = { success: CheckCircle2, error: AlertCircle, warning: TriangleAlert, info: Info };

export default function GlobalNotifications() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onNotification = (event) => {
      const item = event.detail || {};
      if (!item.message) return;
      setItems((current) => [...current.slice(-3), item]);
      window.setTimeout(() => setItems((current) => current.filter((entry) => entry.id !== item.id)), item.duration || 4500);
    };
    window.addEventListener(NOTIFICATION_EVENT, onNotification);
    const onInvalid = (event) => {
      const field = event.target;
      const label = field?.labels?.[0]?.textContent?.trim() || field?.getAttribute?.("aria-label") || field?.placeholder || field?.name || "This field";
      const message = field?.validationMessage || "Please enter a valid value.";
      window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, {
        detail: { id: `validation-${Date.now()}`, message: `${label}: ${message}`, type: "warning", duration: 5500 },
      }));
    };
    document.addEventListener("invalid", onInvalid, true);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, onNotification);
      document.removeEventListener("invalid", onInvalid, true);
    };
  }, []);

  return (
    <div aria-live="polite" aria-atomic="false" className="fixed right-4 top-4 z-[10000] grid w-[min(420px,calc(100vw-2rem))] gap-3">
      {items.map((item) => {
        const Icon = icons[item.type] || Info;
        return (
          <div key={item.id} role={item.type === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border p-4 shadow-xl ${styles[item.type] || styles.info}`}>
            <Icon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm font-bold leading-5">{item.message}</p>
            <button type="button" aria-label="Dismiss notification" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} className="rounded p-1 hover:bg-black/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
