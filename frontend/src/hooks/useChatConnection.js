// src/hooks/useChatConnection.js
import { useEffect, useRef, useState, useCallback } from "react";
import * as signalR from "@microsoft/signalr";
import { API_BASE } from "../api";
import { readSharedAuthToken } from "../utils/sharedAuthCookie";

function normalizeToken(token) {
  const value = String(token || "").trim();
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value;
}

function getStoredToken(preferredKey = "mahima_token") {
  try {
    let raw =
      window.localStorage.getItem(preferredKey) ||
      window.localStorage.getItem("mahima_token") ||
      window.localStorage.getItem("authToken") ||
      window.localStorage.getItem("auth_token") ||
      window.localStorage.getItem("token") ||
      "";

    if (!raw) {
      const userKeys = ["mahima:user", "mahima_user", "user", "currentUser", "me"];
      for (const key of userKeys) {
        const userRaw = window.localStorage.getItem(key);
        if (!userRaw) continue;
        try {
          const parsed = JSON.parse(userRaw);
          raw = parsed?.token || parsed?.accessToken || parsed?.jwt || parsed?.data?.token || "";
        } catch {
          raw = "";
        }
        if (raw) break;
      }
    }

    if (!raw) raw = readSharedAuthToken();

    return normalizeToken(raw);
  } catch {
    return "";
  }
}

/**
 * useChatConnection(token, options?)
 *
 * options:
 *   - hubUrl?: string                // absolute URL to your chat hub
 *   - tokenStorageKey?: string       // localStorage key for JWT (default: "mahima_token")
 *   - logLevel?: signalR.LogLevel    // default: Warning
 *
 * Returns:
 *   { connection, isConnected, onlineUserIds, on, off, invoke, joinGroup, leaveGroup }
 */
export function useChatConnection(token, options = {}) {
  const {
    hubUrl: hubUrlOverride,
    tokenStorageKey = "mahima_token",
    logLevel = signalR.LogLevel.Warning,
  } = options;

  const [connection, setConnection] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const handlersRef = useRef(new Map());
  const startedConnRef = useRef(null);

  // Resolve hub URL
  function resolveHubUrl() {
    if (hubUrlOverride) return hubUrlOverride;

    // Prefer VITE_HUB_BASE if provided (e.g., /hubs)
    let hubBase =
      (import.meta?.env?.VITE_HUB_BASE || "").toString().trim().replace(/\/+$/, "");

    if (!hubBase) {
      // Fallback: derive from VITE_API_BASE by removing trailing /api
      let apiBase = (import.meta?.env?.VITE_API_BASE || API_BASE || "").toString().trim();
      apiBase = apiBase.replace(/\/+$/, "");
      if (apiBase.toLowerCase().endsWith("/api")) {
        hubBase = apiBase.slice(0, -4) + "/hubs";
      } else if (apiBase) {
        hubBase = apiBase + "/hubs";
      } else if (typeof window !== "undefined" && window.location?.port === "5173") {
        // Vite dev server proxies normal HTTP, but WebSockets often need the API origin directly.
        hubBase = `${window.location.protocol}//${window.location.hostname}:5001/api/hubs`;
      } else {
        // same-origin fallback matching Program.cs: app.MapHub<ChatHub>("/api/hubs/chat")
        hubBase = "/api/hubs";
      }
    }

    // Default hub path is /chat ? final URL like http://host:5001/hubs/chat
    const path =
      (import.meta?.env?.VITE_CHAT_HUB_PATH || "/chat").toString().trim();
    return `${hubBase.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  // Build a HubConnection with supplied options
  const buildConnection = useCallback(
    ({ skipNegotiation = false, transport } = {}) => {
      const url = resolveHubUrl();

      const withUrlOptions = {
        accessTokenFactory: () => {
          return getStoredToken(tokenStorageKey) || normalizeToken(token);
        },
        skipNegotiation,
      };
      if (transport) withUrlOptions.transport = transport;

      return new signalR.HubConnectionBuilder()
        .withUrl(url, withUrlOptions)
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (context) => {
            const count = context?.previousRetryCount ?? 0;
            return Math.min(30000, Math.max(1000, (count + 1) * 2000));
          },
        })
        .configureLogging(logLevel)
        .build();
    },
    [token, tokenStorageKey, logLevel, hubUrlOverride]
  );

  const normalizePresenceIds = useCallback((ids) => {
    if (!Array.isArray(ids)) return [];
    return ids.filter(Boolean).map((id) => String(id));
  }, []);

  const refreshPresence = useCallback(async (conn) => {
    if (!conn?.invoke) return;
    try {
      const ids = await conn.invoke("GetOnlineUsers");
      setOnlineUserIds(new Set(normalizePresenceIds(ids)));
    } catch {
      // Presence is best-effort; reconnect will refresh it again.
    }
  }, [normalizePresenceIds]);

  const wirePresence = useCallback((conn) => {
    if (!conn) return;
    conn.off("PresenceSnapshot");
    conn.off("UserPresence");

    conn.on("PresenceSnapshot", (ids) => {
      setOnlineUserIds(new Set(normalizePresenceIds(ids)));
    });

    conn.on("UserPresence", (payload) => {
      const userId = payload?.userId ?? payload?.UserId ?? payload?.id;
      if (!userId) return;
      const isOnline = payload?.isOnline ?? payload?.IsOnline ?? payload?.online;
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(String(userId));
        else next.delete(String(userId));
        return next;
      });
    });
  }, [normalizePresenceIds]);

  // Start/stop lifecycle
  useEffect(() => {
    const effectiveToken = getStoredToken(tokenStorageKey) || normalizeToken(token);
    // If no token, ensure we are stopped
    if (!effectiveToken) {
      if (startedConnRef.current) {
        startedConnRef.current.stop().catch(() => {});
      }
      startedConnRef.current = null;
      setConnection(null);
      setIsConnected(false);
      setOnlineUserIds(new Set());
      return;
    }

    let mounted = true;
    let retryTimer = null;

    const start = async () => {
      // Attempt #1: normal negotiation
      let conn = buildConnection({ skipNegotiation: false });
      try {
        wirePresence(conn);
        await conn.start();
        if (!mounted) {
          await conn.stop().catch(() => {});
          return;
        }
        startedConnRef.current = conn;
        setConnection(conn);
        setIsConnected(true);
        await refreshPresence(conn);
      } catch (err) {
        // Attempt #2: fallback to WebSockets only (skip negotiation)
        try {
          await conn.stop().catch(() => {});
        } catch {}

        conn = buildConnection({
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets,
        });

        try {
          wirePresence(conn);
        await conn.start();
          if (!mounted) {
            await conn.stop().catch(() => {});
            return;
          }
          startedConnRef.current = conn;
          setConnection(conn);
        setIsConnected(true);
        await refreshPresence(conn);
        } catch (err2) {
          setIsConnected(false);
          setConnection(null);
          if (mounted) {
            retryTimer = window.setTimeout(start, 5000);
          }
        }
      }

      // Wire reconnect/close
      if (startedConnRef.current) {
        startedConnRef.current.onreconnecting(() => {
          setIsConnected(false);
        });
        startedConnRef.current.onreconnected(() => {
          setIsConnected(true);
          refreshPresence(startedConnRef.current);
        });
        startedConnRef.current.onclose(() => {
          setIsConnected(false);
          setOnlineUserIds(new Set());
          if (mounted) {
            if (retryTimer) window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(start, 2500);
          }
        });
      }
    };

    start();

    return () => {
      mounted = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      (async () => {
        try {
          if (startedConnRef.current) {
            await startedConnRef.current.stop();
          }
        } catch {}
        startedConnRef.current = null;
        setConnection(null);
        setIsConnected(false);
        setOnlineUserIds(new Set());
      })();
    };
  }, [token, buildConnection, wirePresence, refreshPresence]);

  // Event helpers
  const on = useCallback(
    (event, handler) => {
      if (!connection) return;
      connection.on(event, handler);
      handlersRef.current.set(event, handler);
    },
    [connection]
  );

  const off = useCallback(
    (event) => {
      if (!connection) return;
      const h = handlersRef.current.get(event);
      if (h) {
        connection.off(event, h);
        handlersRef.current.delete(event);
      } else {
        // Fallback: remove any handler for that event
        connection.off(event);
      }
    },
    [connection]
  );

  const invoke = useCallback(
    async (method, ...args) => {
      if (!connection) throw new Error("SignalR not connected");
      return connection.invoke(method, ...args);
    },
    [connection]
  );

  const joinGroup = useCallback(
    async (chatId) => {
      if (!connection || chatId == null) return;
      try {
        // Adjust the server method name if your hub differs
        if (connection.invoke) {
          await connection.invoke("JoinGroup", String(chatId));
        } else if (connection.send) {
          await connection.send("JoinGroup", String(chatId));
        }
      } catch (e) {
        // swallow
      }
    },
    [connection]
  );

  const leaveGroup = useCallback(
    async (chatId) => {
      if (!connection || chatId == null) return;
      try {
        if (connection.invoke) {
          await connection.invoke("LeaveGroup", String(chatId));
        } else if (connection.send) {
          await connection.send("LeaveGroup", String(chatId));
        }
      } catch (e) {
        // swallow
      }
    },
    [connection]
  );

  return { connection, isConnected, onlineUserIds, on, off, invoke, joinGroup, leaveGroup };
}


