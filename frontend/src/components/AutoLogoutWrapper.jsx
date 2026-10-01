import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { tenantLoginRoute } from "../utils/tenantNavigation";
import { clearSharedAuthToken } from "../utils/sharedAuthCookie";

function isMobileAppMode() {
  try {
    return (
      import.meta.env.MODE === "mobile" ||
      Boolean(window.Capacitor?.isNativePlatform?.())
    );
  } catch {
    return false;
  }
}

function isUploadBody(body) {
  return (
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof File !== "undefined" && body instanceof File) ||
    (typeof Blob !== "undefined" && body instanceof Blob)
  );
}

export default function AutoLogoutWrapper({ children }) {
  const navigate = useNavigate();
  const timerRef = useRef(null);
  const activeUploadsRef = useRef(0);
  const uploadHeartbeatRef = useRef(null);

  const LOGOUT_TIME = 15 * 60 * 1000; // 15 minutes
  const UPLOAD_HEARTBEAT_TIME = 60 * 1000;

  const logout = () => {
    if (activeUploadsRef.current > 0) {
      resetTimer();
      return;
    }

    console.warn("Auto logout due to inactivity (15 min)");

    localStorage.removeItem("mahima_token");
    localStorage.removeItem("authToken");
    localStorage.removeItem("token");
    clearSharedAuthToken();

    navigate(tenantLoginRoute(), { replace: true });
  };

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(logout, LOGOUT_TIME);
  };

  const startUploadActivity = () => {
    activeUploadsRef.current += 1;
    resetTimer();

    if (!uploadHeartbeatRef.current) {
      uploadHeartbeatRef.current = setInterval(resetTimer, UPLOAD_HEARTBEAT_TIME);
    }
  };

  const endUploadActivity = () => {
    activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
    resetTimer();

    if (activeUploadsRef.current === 0 && uploadHeartbeatRef.current) {
      clearInterval(uploadHeartbeatRef.current);
      uploadHeartbeatRef.current = null;
    }
  };

  useEffect(() => {
    if (isMobileAppMode()) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return undefined;
    }

    const originalFetch = window.fetch?.bind(window);
    const originalXhrSend = window.XMLHttpRequest?.prototype?.send;

    if (originalFetch) {
      window.fetch = async (...args) => {
        const init = args[1];
        const body = init?.body;

        if (!isUploadBody(body)) {
          return originalFetch(...args);
        }

        startUploadActivity();
        try {
          return await originalFetch(...args);
        } finally {
          endUploadActivity();
        }
      };
    }

    if (originalXhrSend) {
      window.XMLHttpRequest.prototype.send = function sendWithUploadActivity(body) {
        if (!isUploadBody(body)) {
          return originalXhrSend.call(this, body);
        }

        let completed = false;
        const finish = () => {
          if (completed) return;
          completed = true;
          this.removeEventListener("loadend", finish);
          this.removeEventListener("abort", finish);
          this.removeEventListener("error", finish);
          endUploadActivity();
        };

        startUploadActivity();
        this.addEventListener("loadend", finish);
        this.addEventListener("abort", finish);
        this.addEventListener("error", finish);

        try {
          return originalXhrSend.call(this, body);
        } catch (error) {
          finish();
          throw error;
        }
      };
    }

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
    ];

    events.forEach((event) =>
      window.addEventListener(event, resetTimer)
    );

    resetTimer(); // start timer

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (uploadHeartbeatRef.current) clearInterval(uploadHeartbeatRef.current);
      if (originalFetch) window.fetch = originalFetch;
      if (originalXhrSend) window.XMLHttpRequest.prototype.send = originalXhrSend;
      events.forEach((event) =>
        window.removeEventListener(event, resetTimer)
      );
    };
  }, []);

  return children;
}
