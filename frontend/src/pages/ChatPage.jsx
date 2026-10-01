// src/pages/ChatPage.jsx
//
// Jai Masih - chat hub for the Mahima community.
// - Two-pane WhatsApp-Web layout on desktop
// - Single-pane (list <-> conversation toggle) on mobile
// - SignalR live updates with auto-reconnect
// - Sound + haptic notifications (chatNotifications.js)
// - "Jai Masih" branding with cross icon
//
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cross, MessageSquarePlus, RefreshCw } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import ChatList from "../components/ChatList";
import ChatWindow from "../components/ChatWindow";
import NewChatModal from "../components/NewChatModal";
import CallOverlay from "../components/CallOverlay";

import {
  notifyIncomingMessage,
  requestNotificationPermission,
  unlockAudio,
  preloadVoices,
} from "../utils/chatNotifications";
import useChatCall from "../hooks/useChatCall";
import { useChatConnection } from "../hooks/useChatConnection";
import { getToken } from "../utils/auth";
import { API_BASE } from "../api";
import { chatBrandName, currentMahimaUser } from "../utils/chatBranding";

function getMeId() {
  try {
    const raw = localStorage.getItem("mahima_user")
      || localStorage.getItem("current_user")
      || localStorage.getItem("user")
      || localStorage.getItem("me");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.id || u?.Id || u?.userId || null;
  } catch { return null; }
}

const arrayFrom = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
};

const PENDING_CALL_KEY = "mahima_pending_call_notification";
const PENDING_SHARE_KEY = "mahima_pending_share_intent";

function readPendingCallIntent() {
  try {
    const raw = localStorage.getItem(PENDING_CALL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.chatId ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingCallIntent() {
  try { localStorage.removeItem(PENDING_CALL_KEY); } catch {}
}

function readPendingShareIntent() {
  try {
    const raw = localStorage.getItem(PENDING_SHARE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.text ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingShareIntent() {
  try { localStorage.removeItem(PENDING_SHARE_KEY); } catch {}
}

async function readApiError(res, fallback) {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    if (typeof data === "string") return data;
    return data?.message || data?.error || data?.title || fallback;
  } catch {
    return text;
  }
}

function messagePreview(msg) {
  const text = msg?.text ?? msg?.content ?? msg?.body ?? "";
  if (String(text).trim()) return String(text).trim();
  const attachments = msg?.attachments || msg?.Attachments;
  if (Array.isArray(attachments) && attachments.length) return "Attachment";
  if (msg?.attachmentUrl || msg?.AttachmentUrl) return "Attachment";
  return "New message";
}

function senderNameFromMessage(msg) {
  return msg?.senderName || msg?.SenderName || msg?.fromName || msg?.FromName || msg?.sender?.displayName || "Jai Masih";
}

function latestChatTime(chat) {
  const raw = chat?.lastMessage?.createdAt
    ?? chat?.lastMessage?.sentAt
    ?? chat?.updatedAt
    ?? chat?.createdAt
    ?? 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortChatsByLatest(list) {
  return [...list].sort((a, b) => latestChatTime(b) - latestChatTime(a));
}

export default function ChatPage() {
  const chatBrand = useMemo(() => chatBrandName(currentMahimaUser()), []);
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [selectedChat, setSelectedChat] = useState(null);
  const [usersMap, setUsersMap] = useState({});
  const [showNewChat, setShowNewChat] = useState(false);
  const [showListOnMobile, setShowListOnMobile] = useState(true);
  const [chatError, setChatError] = useState("");
  const [pendingShareText, setPendingShareText] = useState("");

  const meId = useMemo(() => getMeId(), []);
  const token = useMemo(() => getToken(), []);
  const outletContext = useOutletContext() || {};
  const layoutChatConnection = outletContext.chatConnection;
  const fallbackChatConnection = useChatConnection(layoutChatConnection ? null : token);
  const { connection, isConnected, onlineUserIds, joinGroup, leaveGroup } = layoutChatConnection || fallbackChatConnection;

  /* unlock audio + preload speech voices on first user interaction */
  useEffect(() => {
    preloadVoices();
    const handler = () => {
      unlockAudio();
      preloadVoices();
      requestNotificationPermission();
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("touchstart", handler);
    };
    window.addEventListener("click", handler);
    window.addEventListener("keydown", handler);
    window.addEventListener("touchstart", handler);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("touchstart", handler);
    };
  }, []);

  /* ----- load chats + users ----- */

  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/chats`, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, `Chats request failed (${res.status})`));
      }
      const data = await res.json().catch(() => []);
      setChats(sortChatsByLatest(arrayFrom(data)));
      setChatError("");
    } catch (e) {
      console.warn("[ChatPage] loadChats failed", e);
      setChats([]);
      setChatError(e?.message || "Failed to load chats");
    } finally {
      setLoadingChats(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const token = getToken();
      let res = await fetch(`${API_BASE}/chats/contacts?page=1&limit=1000`, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      if (!res.ok) {
        res = await fetch(`${API_BASE}/users?page=1&limit=1000`, {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
        });
      }
      if (!res.ok) throw new Error(`Users request failed (${res.status})`);
      const data = await res.json().catch(() => []);
      const list = arrayFrom(data);
      const map = {};
      for (const u of list) {
        const id = u.id ?? u.userId ?? u._id;
        if (id) map[String(id)] = u;
      }
      setUsersMap(map);
    } catch (e) {
      console.warn("[ChatPage] loadUsers failed", e);
    }
  }, []);

  useEffect(() => {
    loadChats();
    loadUsers();
  }, [loadChats, loadUsers]);

  useEffect(() => {
    const pending = readPendingShareIntent();
    if (!pending?.text) return;
    setPendingShareText(String(pending.text).trim());
    setShowListOnMobile(true);
    clearPendingShareIntent();
  }, []);

  /* ----- auto-refresh fallback (polling + tab focus) -----
     SignalR pushes are real-time when connected; this layer covers the
     cases where the hub drops out or the tab was backgrounded. */
  useEffect(() => {
    const onFocus = () => loadChats();
    const onVisibility = () => { if (!document.hidden) loadChats(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadChats]);

  useEffect(() => {
    // Poll every 15 s while disconnected, every 60 s while connected.
    const period = isConnected ? 60000 : 15000;
    const id = setInterval(() => {
      if (!document.hidden) loadChats();
    }, period);
    return () => clearInterval(id);
  }, [isConnected, loadChats]);

  /* ----- signalr ----- */

  useEffect(() => {
    if (!connection) return;

    const onReceiveMessage = (msg) => {
      const cid = msg.chatId ?? msg.ChatId;
      const fromMe = String(
        msg.senderId ?? msg.fromUserId ?? msg.userId ?? ""
      ) === String(meId);
      const openChatId = selectedChatRef.current?.id;
      const inOpenChat = openChatId && String(cid) === String(openChatId);
      const chatKnown = chatsRef.current.some((chat) => String(chat.id) === String(cid));

      setChats((prev) => bumpChatWithMessage(prev, msg, !fromMe && !inOpenChat));
      if (!chatKnown) loadChats();
      if (!fromMe && !inOpenChat) {
        notifyIncomingMessage({
          chatId: cid,
          senderName: senderNameFromMessage(msg),
          preview: messagePreview(msg),
          onClick: () => {
            const found = chatsRef.current.find((chat) => String(chat.id) === String(cid));
            if (found) {
              setSelectedChat(found);
              setShowListOnMobile(false);
            } else {
              loadChats();
            }
          },
        });
      }
    };

    const onChatCreated = () => {
      // Fetch the receiver's own chat summary. Direct-chat names are viewer-specific.
      loadChats();
    };

    const onChatUpdated = (chat) => {
      if (!chat?.id) {
        loadChats();
        return;
      }
      setChats((prev) => sortChatsByLatest(prev.map((c) =>
        String(c.id) === String(chat.id) ? { ...c, ...chat } : c
      )));
      setSelectedChat((cur) =>
        cur && String(cur.id) === String(chat.id) ? { ...cur, ...chat } : cur
      );
    };

    const removeChat = (payload) => {
      const chatId = payload?.chatId ?? payload?.ChatId;
      setChats((prev) => prev.filter((c) => String(c.id) !== String(chatId)));
      setSelectedChat((cur) => (cur && String(cur.id) === String(chatId) ? null : cur));
    };

    connection.on("ReceiveMessage", onReceiveMessage);
    connection.on("ChatCreated", onChatCreated);
    connection.on("ChatUpdated", onChatUpdated);
    connection.on("ChatDeleted", removeChat);
    connection.on("ChatSoftDeleted", removeChat);
    return () => {
      try { connection.off("ReceiveMessage", onReceiveMessage); } catch {}
      try { connection.off("ChatCreated", onChatCreated); } catch {}
      try { connection.off("ChatUpdated", onChatUpdated); } catch {}
      try { connection.off("ChatDeleted", removeChat); } catch {}
      try { connection.off("ChatSoftDeleted", removeChat); } catch {}
    };
  }, [connection, loadChats, meId]);
  // Keep a ref to selectedChat so SignalR handlers see the latest value
  // without resubscribing on every selection change.
  const selectedChatRef = useRef(selectedChat);
  const chatsRef = useRef(chats);
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  /* ----- call (WebRTC) hook ----- */
  const call = useChatCall({
    connection,
    chat: selectedChat,
    meId,
  });

  useEffect(() => {
    const pending = readPendingCallIntent();
    const chatId = pending?.chatId;
    if (!chatId || !connection || !isConnected || !call.restoreIncomingCall) return;

    const targetChat = chatsRef.current.find((chat) => String(chat.id) === String(chatId));
    if (targetChat) {
      setSelectedChat(targetChat);
      setShowListOnMobile(false);
    }

    let cancelled = false;
    async function restorePendingCall() {
      try {
        const active = await connection.invoke("GetActiveCall", String(chatId));
        if (cancelled) return;
        if (active?.sdp) {
          call.restoreIncomingCall(active);
        }
      } catch (err) {
        console.warn("[ChatPage] could not restore pending call", err);
      } finally {
        clearPendingCallIntent();
      }
    }

    restorePendingCall();
    return () => { cancelled = true; };
  }, [call.restoreIncomingCall, chats, connection, isConnected]);

  // Resolve the peer's display name for the call overlay. Incoming calls can
  // arrive even when that conversation is not currently open.
  const callChat = useMemo(() => {
    const callChatId = call.callState?.chatId;
    if (callChatId) {
      const found = chats.find((c) => String(c.id) === String(callChatId));
      if (found) return found;
    }
    return selectedChat;
  }, [call.callState?.chatId, chats, selectedChat]);

  const callPeerName = useMemo(() => {
    if (!callChat) return "";
    const otherId = callChat.otherId;
    if (otherId) {
      const u = usersMap[String(otherId)];
      if (u) return u.displayName || u.name || u.username || String(otherId);
    }
    return callChat.name || callChat.title || "Conversation";
  }, [callChat, usersMap]);

  // Join/leave SignalR groups when the open chat changes.
  useEffect(() => {
    if (!selectedChat?.id || !isConnected) return;
    const cid = String(selectedChat.id);
    joinGroup(cid);
    return () => { leaveGroup(cid); };
  }, [selectedChat?.id, isConnected, joinGroup, leaveGroup]);

  /* ----- handlers ----- */

  const onSelect = (chat) => {
    setSelectedChat(chat);
    setShowListOnMobile(false);
    // optimistic: zero out unread so it disappears immediately
    setChats((prev) => prev.map((c) =>
      String(c.id) === String(chat.id) ? { ...c, unreadCount: 0 } : c
    ));
  };

  const onBack = () => {
    setSelectedChat(null);
    setShowListOnMobile(true);
  };

  const onDelete = async (chatId) => {
    if (!chatId) return;
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/chats/${chatId}`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) throw new Error("Delete failed");
      setChats((prev) => prev.filter((c) => String(c.id) !== String(chatId)));
      setSelectedChat((cur) =>
        cur && String(cur.id) === String(chatId) ? null : cur
      );
    } catch (e) {
      console.error("[ChatPage] delete failed", e);
      alert("Failed to delete chat. Please try again.");
    }
  };

  const onCreate = async ({ userId, usernameOrEmail, isGroup = false, name = "", memberIds = [] }) => {
    const token = getToken();
    const payload = isGroup
      ? { isGroup: true, name: String(name || "").trim(), memberIds }
      : userId ? { userId, usernameOrEmail } : { usernameOrEmail };
    const res = await fetch(`${API_BASE}/chats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, `Failed to create chat (${res.status})`));
    }
    const chat = await res.json().catch(() => null);
    if (chat) {
      const createdChat = chat.updatedAt || chat.createdAt
        ? chat
        : { ...chat, updatedAt: new Date().toISOString() };
      setChatError("");
      setChats((prev) => {
        if (prev.some((c) => String(c.id) === String(createdChat.id))) return prev;
        return sortChatsByLatest([createdChat, ...prev]);
      });
      setSelectedChat(createdChat);
      setShowListOnMobile(false);
      loadChats();
    }
    return chat;
  };

  const onMessageCreated = (msg) => {
    // Bump the chat in the list, set last message + preview
    const chatKnown = chatsRef.current.some((chat) => String(chat.id) === String(msg.chatId));
    setChats((prev) => bumpChatWithMessage(prev, {
      chatId: msg.chatId,
      text: msg.text,
      content: msg.text,
      senderId: msg.senderId,
      createdAt: msg.createdAt,
    }, /* incrementUnread */ false));
    if (!chatKnown) loadChats();
  };

  const onChatUpdatedLocal = (chat) => {
    if (!chat?.id) return;
    setChats((prev) => sortChatsByLatest(prev.map((c) =>
      String(c.id) === String(chat.id) ? { ...c, ...chat } : c
    )));
    setSelectedChat((cur) =>
      cur && String(cur.id) === String(chat.id) ? { ...cur, ...chat } : cur
    );
  };

  const startChatCall = useCallback((type) => {
    if (!selectedChat?.id) return;
    if (!isConnected) {
      alert("Chat is reconnecting. Please try the call again in a moment.");
      return;
    }
    call.startCall(type);
  }, [call.startCall, isConnected, selectedChat?.id]);

  /* ----- render ----- */

  return (
    // Fill the parent's available height. Using h-full here is more
    // reliable than calc(100vh - X) because the parent <main> in Layout
    // already has a constrained height; on mobile, viewport-based units
    // jump around when the address bar shows/hides.
    <div className="h-full min-h-0 flex flex-col bg-slate-100"
         style={{ height: "calc(100dvh - 3.5rem)" }}>
      {/* Brand bar */}
      <div className="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-700 text-white px-4 sm:px-5 py-3 flex items-center gap-3 shadow-sm shrink-0">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 ring-1 ring-white/15 shrink-0">
          <Cross className="w-4 h-4" />
        </span>
        <div className="leading-tight min-w-0">
          <div className="text-base sm:text-lg font-black tracking-tight">{chatBrand}</div>
          <div className="text-[10px] sm:text-xs text-emerald-100/80 truncate">
            {isConnected ? "Connected" : "Reconnecting..."}
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={loadChats}
          type="button"
          title="Refresh chats"
          aria-label="Refresh chats"
          className="w-11 h-11 rounded-full hover:bg-white/15 active:bg-white/25 flex items-center justify-center shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loadingChats ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => setShowNewChat(true)}
          type="button"
          title="New chat"
          aria-label="New chat"
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 flex items-center justify-center shrink-0"
        >
          <MessageSquarePlus className="w-4 h-4" />
        </button>
      </div>

      {chatError && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 flex items-center justify-between gap-3">
          <span className="truncate">{chatError}</span>
          <button
            type="button"
            onClick={loadChats}
            className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* Two-pane area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar (chat list) */}
        <aside
          className={`${
            showListOnMobile ? "flex" : "hidden"
          } md:flex w-full md:w-[380px] xl:w-[430px] border-r border-slate-200 bg-white flex-col min-h-0 shadow-sm`}
        >
          <ChatList
            chats={chats}
            loading={loadingChats}
            onSelect={onSelect}
            onDelete={onDelete}
            onCompose={() => setShowNewChat(true)}
            onRefresh={loadChats}
            selectedId={selectedChat?.id}
            currentUserId={meId}
            usersMap={usersMap}
            onlineUserIds={onlineUserIds}
          />
        </aside>

        {/* Conversation pane */}
        <main className={`${showListOnMobile ? "hidden" : "flex"} md:flex flex-1 min-w-0 min-h-0 flex-col`}>
          <ChatWindow
            key={selectedChat?.id || "empty-chat"}
            chat={selectedChat}
            connection={connection}
            isConnected={isConnected}
            onlineUserIds={onlineUserIds}
            currentUserId={meId}
            usersMap={usersMap}
            onMessageCreated={onMessageCreated}
            onChatUpdated={onChatUpdatedLocal}
            onBack={onBack}
            onStartAudioCall={() => startChatCall("audio")}
            onStartVideoCall={() => startChatCall("video")}
            initialDraftText={pendingShareText}
            onDraftConsumed={() => setPendingShareText("")}
          />
        </main>
      </div>

      {/* Modal */}
      <NewChatModal
        open={showNewChat}
        onClose={() => setShowNewChat(false)}
        onCreate={onCreate}
        currentUserId={meId}
      />

      {/* Audio / Video call overlay */}
      <CallOverlay
        callState={call.callState}
        peerName={callPeerName}
        peerId={callChat?.otherId || callChat?.id}
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        audioMuted={call.audioMuted}
        videoOff={call.videoOff}
        onAccept={call.accept}
        onReject={call.reject}
        onEnd={call.endCall}
        onToggleMic={call.toggleMic}
        onToggleCamera={call.toggleCamera}
      />
    </div>
  );
}

/* helpers */

// Move the chat with this message to the top of the list, update last
// message preview, and (optionally) increment unread.
function bumpChatWithMessage(prev, msg, incrementUnread = true) {
  const cid = String(msg.chatId ?? msg.ChatId ?? "");
  if (!cid) return prev;

  const idx = prev.findIndex((c) => String(c.id) === cid);
  const text = msg.text ?? msg.content ?? msg.Content ?? "";
  const sentAt = msg.createdAt ?? msg.sentAt ?? new Date().toISOString();
  const lastMessage = {
    text,
    Content: text,
    senderId: msg.senderId ?? msg.fromUserId ?? msg.userId ?? null,
    senderName: msg.senderName ?? null,
    createdAt: sentAt,
  };

  if (idx === -1) return prev; // chat not in list yet — server should push ChatCreated
  const updated = {
    ...prev[idx],
    lastMessage,
    updatedAt: sentAt,
    unreadCount: incrementUnread
      ? Number(prev[idx].unreadCount || 0) + 1
      : prev[idx].unreadCount,
  };
  const next = [...prev];
  next.splice(idx, 1);
  return [updated, ...next];
}



