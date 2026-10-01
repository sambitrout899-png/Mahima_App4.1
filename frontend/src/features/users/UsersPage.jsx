// src/features/users/UsersPage.CathedralAdvanced.jsx
import React, { useEffect, useState } from "react";

/* ---------- helpers (unchanged) ---------- */
function isoToDatetimeLocal(iso) { /* unchanged */ }
function datetimeLocalToIso(value) { /* unchanged */ }
function formatFriendlyDate(iso) { /* unchanged */ }

/* ---------- config & small utils ---------- */
const API_BASE = '/api';
function normalizeResponse(res) { /* unchanged */ }
function defaultForm() { /* unchanged */ }
const phoneAllowTypingRegex = /^\+?\d*$/;
const phoneFinalRegex = /^\+\d{10,}$/;

export default function UsersPageCathedralAdvanced() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 10 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // NEW: message modal state
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageType, setMessageType] = useState("");
  const [messageText, setMessageText] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [channels, setChannels] = useState({ email: true, sms: true, whatsapp: true });
  const [sending, setSending] = useState(false);

  /* ---------- API calls ---------- */
  const fetchUsers = async (page = 1, limit = 10, searchTerm = "") => { /* unchanged */ };
  useEffect(() => { fetchUsers(meta.page, meta.limit, search); }, []); // eslint-disable-line

  /* ---------- actions ---------- */
  const openAdd = () => { /* unchanged */ };
  const openEdit = (u) => { /* unchanged */ };
  const saveUser = async (e) => { /* unchanged */ };
  const confirmDelete = (id) => { /* unchanged */ };
  const doDelete = async (id) => { /* unchanged */ };
  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // NEW: open message modal
  const openMessageModal = (type) => {
    setMessageType(type);
    setMessageText("");
    setSelectedUsers(users.map(u => u.id)); // pre-select all
    setChannels({ email: true, sms: true, whatsapp: true });
    setShowMessageModal(true);
  };

  // toggle user selection
  const toggleUser = (id) => {
    setSelectedUsers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // send broadcast
  const sendMessage = async () => {
    if (!messageText.trim()) {
      alert("Message cannot be empty");
      return;
    }
    try {
      setSending(true);
      const payload = {
        type: messageType,
        message: messageText,
        userIds: selectedUsers,
        channels
      };
      const resp = await fetch(`${API_BASE}/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || "Error sending messages");
      }
      const res = await resp.json();
      alert(`Sent! ✅\nEmail: ${res.email.success}/${res.email.attempted}\nSMS: ${res.sms.success}/${res.sms.attempted}\nWA: ${res.whatsapp.success}/${res.whatsapp.attempted}`);
      setShowMessageModal(false);
    } catch (err) {
      alert("Send failed: " + err.message);
    } finally {
      setSending(false);
    }
  };

  /* ---------- small helpers ---------- */
  const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const end = Math.min(meta.total, meta.page * meta.limit);

  /* ---------- embedded styles (keep yours, add a little) ---------- */
  const EmbeddedStyles = (
    <style>{`
      /* keep all your styles */
      .message-btn { background:#2f4fa2; color:white; font-weight:600; border:none; border-radius:8px; padding:6px 10px; cursor:pointer; }
      .message-btn:hover { background:#1e365f; }
      .user-checkbox { margin-right:6px; }
      .channel-checks { display:flex; gap:12px; margin-top:8px; }
    `}</style>
  );

  return (
    <div className="cathedral-advanced">
      {EmbeddedStyles}

      {/* Top bar */}
      <div className="topbar" role="banner">
        <img className="logo" src="/Logo.png" alt="Logo" onError={(e) => { e.target.style.display = "none"; }} />
        <nav className="nav" aria-label="Main navigation">
          <a href="/users">Users</a>
          <a href="/teams">Teams</a>
          <a href="/tasks">Tasks</a>
          <a href="/sermons">Sermons</a>
        </nav>

        <div className="header-actions">
          {/* NEW buttons */}
          <button className="message-btn" onClick={() => openMessageModal("Welcome")}>Welcome</button>
          <button className="message-btn" onClick={() => openMessageModal("Daily Word")}>Daily Word</button>
          <button className="message-btn" onClick={() => openMessageModal("Meeting Attend")}>Meeting Attend</button>
          
          <button className="btn btn-muted" onClick={() => { setSearch(""); fetchUsers(1, meta.limit, ""); }}>Clear</button>
          <button className="btn btn-primary" onClick={openAdd}>Add User</button>
        </div>
      </div>

      {/* hero, card, pagination, existing user modal (unchanged) */}
      {/* ... keep your full existing code here ... */}

      {/* NEW Message Modal */}
      {showMessageModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <h3>{messageType} Message</h3>
            <textarea
              rows={4}
              style={{ width: "100%", marginBottom: 10 }}
              placeholder={`Enter ${messageType} message`}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
            <div className="channel-checks">
              <label><input type="checkbox" checked={channels.email} onChange={(e) => setChannels(c => ({ ...c, email: e.target.checked }))} /> Email</label>
              <label><input type="checkbox" checked={channels.sms} onChange={(e) => setChannels(c => ({ ...c, sms: e.target.checked }))} /> SMS</label>
              <label><input type="checkbox" checked={channels.whatsapp} onChange={(e) => setChannels(c => ({ ...c, whatsapp: e.target.checked }))} /> WhatsApp</label>
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 10, border: "1px solid #ddd", padding: 6, borderRadius: 6 }}>
              {users.map(u => (
                <div key={u.id}>
                  <label>
                    <input
                      type="checkbox"
                      className="user-checkbox"
                      checked={selectedUsers.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                    />
                    {u.displayName || u.username || u.email}
                  </label>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              <button className="btn btn-muted" onClick={() => setShowMessageModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={sendMessage} disabled={sending}>{sending ? "Sending…" : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

