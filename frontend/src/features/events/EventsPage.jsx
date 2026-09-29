import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  MapPin,
  Plus,
  Trash2,
  Pencil,
  X,
  Users,
  Ban,
  CheckCircle2,
  Lock,
  Globe2,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Video,
  Download,
  Loader2,
  UploadCloud,
} from "lucide-react";
import api, { API_BASE } from "../../api";
import { getToken } from "../../utils/auth";
import { requireModuleResponse } from "../../utils/moduleContracts.mjs";

function attachmentIcon(contentType = "") {
  if (contentType.startsWith("image/")) return ImageIcon;
  if (contentType.startsWith("video/")) return Video;
  return FileText;
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const emptyForm = {
  id: null,
  title: "",
  description: "",
  category: "",
  location: "",
  coverImageUrl: "",
  startAtUtc: "",
  endAtUtc: "",
  isPublic: true,
  requiresRsvp: false,
  capacity: "",
};

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("mahima_user") || "null");
  } catch {
    return null;
  }
}

function isAdminOrStaff(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "staff";
}

function apiErrorMessage(err, fallback) {
  const data = err?.response?.data ?? err?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || err?.message || fallback;
}

function toLocalInputValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateRange(start, end) {
  if (!start) return "";
  const s = new Date(start);
  const opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  const startText = s.toLocaleString(undefined, opts);
  if (!end) return startText;
  const e = new Date(end);
  return `${startText} - ${e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export default function EventsPage() {
  const user = useMemo(() => currentUser(), []);
  const canManage = isAdminOrStaff(user);

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [includePast, setIncludePast] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError("");
    setError("");
    try {
      const res = await api.get("/events", { params: { includePast }, notify: false });
      requireModuleResponse(res, "Could not load events.");
      setEvents(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setLoadError(apiErrorMessage(err, "Could not load events."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [includePast]);

  async function loadAttachments(eventId) {
    if (!eventId) {
      setAttachments([]);
      return;
    }
    setAttachmentsLoading(true);
    try {
      const res = await api.get(`/events/${eventId}/attachments`, { notify: false });
      setAttachments(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }

  async function uploadAttachment(file) {
    if (!file || !form.id) return;
    setUploadingAttachment(true);
    setError("");
    try {
      const token = getToken();
      const payload = new FormData();
      payload.append("file", file);
      payload.append("purpose", "events");
      const uploadRes = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: payload,
      });
      if (!uploadRes.ok) throw new Error(await uploadRes.text());
      const uploaded = await uploadRes.json();
      const fileUrl = uploaded?.url || uploaded?.absoluteUrl;
      if (!fileUrl) throw new Error("Upload succeeded but no file URL was returned.");

      const res = await api.post(`/events/${form.id}/attachments`, {
        fileName: file.name,
        fileUrl,
        contentType: uploaded.contentType || file.type,
        fileSizeBytes: uploaded.size || file.size,
      }, { notify: false });
      requireModuleResponse(res, "Could not attach the file.");
      await loadAttachments(form.id);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not upload the file."));
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function deleteAttachment(attachmentId) {
    if (!form.id) return;
    try {
      const res = await api.delete(`/events/${form.id}/attachments/${attachmentId}`, { notify: false });
      requireModuleResponse(res, "Could not remove the attachment.");
      await loadAttachments(form.id);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not remove the attachment."));
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setAttachments([]);
    setShowForm(true);
  }

  function openEdit(ev) {
    setForm({
      id: ev.id,
      title: ev.title || "",
      description: ev.description || "",
      category: ev.category || "",
      location: ev.location || "",
      coverImageUrl: ev.coverImageUrl || "",
      startAtUtc: toLocalInputValue(ev.startAtUtc),
      endAtUtc: toLocalInputValue(ev.endAtUtc),
      isPublic: Boolean(ev.isPublic),
      requiresRsvp: Boolean(ev.requiresRsvp),
      capacity: ev.capacity ?? "",
    });
    loadAttachments(ev.id);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.startAtUtc) {
      setError("Title and start date/time are required.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      category: form.category || null,
      location: form.location || null,
      coverImageUrl: form.coverImageUrl || null,
      startAtUtc: new Date(form.startAtUtc).toISOString(),
      endAtUtc: form.endAtUtc ? new Date(form.endAtUtc).toISOString() : null,
      isPublic: form.isPublic,
      requiresRsvp: form.requiresRsvp,
      capacity: form.capacity === "" ? null : Number(form.capacity),
    };
    try {
      const res = form.id
        ? await api.put(`/events/${form.id}`, payload, { notify: false })
        : await api.post("/events", payload, { notify: false });
      requireModuleResponse(res, "Could not save the event.");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the event."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this event? This cannot be undone.")) return;
    try {
      const res = await api.delete(`/events/${id}`, { notify: false });
      requireModuleResponse(res, "Could not delete the event.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not delete the event."));
    }
  }

  async function setStatus(id, status) {
    try {
      const res = await api.patch(`/events/${id}/status`, { status }, { notify: false });
      requireModuleResponse(res, "Could not update the event.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not update the event."));
    }
  }

  async function rsvp(id) {
    try {
      const res = await api.post(`/events/${id}/rsvp`, { partySize: 1 }, { notify: false });
      requireModuleResponse(res, "Could not RSVP.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not RSVP."));
    }
  }

  async function cancelRsvp(id) {
    try {
      const res = await api.delete(`/events/${id}/rsvp`, { notify: false });
      requireModuleResponse(res, "Could not cancel RSVP.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not cancel RSVP."));
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Events</h1>
          <p className="text-sm text-slate-500">Church events with RSVP and capacity.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={includePast}
            onChange={(e) => setIncludePast(e.target.checked)}
            className="h-4 w-4 accent-emerald-700"
          />
          Show past events
        </label>
        {canManage && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            <Plus className="h-4 w-4" /> New Event
          </button>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading events...</div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p>{loadError}</p>
          <button type="button" onClick={load} className="mt-2 rounded-lg border border-rose-300 px-3 py-1.5 font-semibold hover:bg-rose-100">
            Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No upcoming events yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {events.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{ev.title}</h3>
                    {ev.isPublic ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                        <Globe2 className="h-3 w-3" /> Public
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                        <Lock className="h-3 w-3" /> Private
                      </span>
                    )}
                    {ev.status !== "scheduled" && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                        {ev.status}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> {formatDateRange(ev.startAtUtc, ev.endAtUtc)}
                    </span>
                    {ev.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {ev.location}
                      </span>
                    )}
                    {ev.requiresRsvp && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {ev.rsvpCount || 0}{ev.capacity ? ` / ${ev.capacity}` : ""} RSVP'd
                      </span>
                    )}
                    {ev.attachmentCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3.5 w-3.5" /> {ev.attachmentCount}
                      </span>
                    )}
                  </div>
                  {ev.description && <p className="mt-2 text-sm text-slate-600">{ev.description}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {ev.requiresRsvp && ev.status === "scheduled" && (
                    ev.iHaveRsvped ? (
                      <button onClick={() => cancelRsvp(ev.id)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        Cancel RSVP
                      </button>
                    ) : (
                      <button
                        onClick={() => rsvp(ev.id)}
                        disabled={ev.isFull}
                        className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {ev.isFull ? "Full - Join Waitlist" : "RSVP"}
                      </button>
                    )
                  )}
                  {canManage && (
                    <>
                      <button onClick={() => openEdit(ev)} className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      {ev.status === "scheduled" ? (
                        <button onClick={() => setStatus(ev.id, "cancelled")} className="rounded-lg border border-amber-300 p-1.5 text-amber-700 hover:bg-amber-50" title="Cancel event">
                          <Ban className="h-4 w-4" />
                        </button>
                      ) : (
                        <button onClick={() => setStatus(ev.id, "scheduled")} className="rounded-lg border border-emerald-300 p-1.5 text-emerald-700 hover:bg-emerald-50" title="Re-activate">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => remove(ev.id)} className="rounded-lg border border-rose-300 p-1.5 text-rose-600 hover:bg-rose-50" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={save}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Edit Event" : "New Event"}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-3">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
              <textarea
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Category (e.g. Youth, Worship)"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Location"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-slate-500">
                  Starts
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.startAtUtc}
                    onChange={(e) => setForm({ ...form, startAtUtc: e.target.value })}
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500">
                  Ends (optional)
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.endAtUtc}
                    onChange={(e) => setForm({ ...form, endAtUtc: e.target.value })}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
                  Public event
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.requiresRsvp} onChange={(e) => setForm({ ...form, requiresRsvp: e.target.checked })} />
                  Requires RSVP
                </label>
              </div>
              {form.requiresRsvp && (
                <input
                  type="number"
                  min="1"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Capacity (leave blank for unlimited)"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
              )}

              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <Paperclip className="h-3.5 w-3.5" /> Attachments
                </div>
                {!form.id ? (
                  <p className="text-xs text-slate-400">Save the event first, then reopen it to add files, images, or video clips.</p>
                ) : (
                  <div className="space-y-2">
                    {attachmentsLoading ? (
                      <p className="text-xs text-slate-400">Loading attachments...</p>
                    ) : attachments.length === 0 ? (
                      <p className="text-xs text-slate-400">No attachments yet.</p>
                    ) : (
                      attachments.map((att) => {
                        const Icon = attachmentIcon(att.contentType);
                        return (
                          <div key={att.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                            <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                            <a
                              href={att.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 hover:underline"
                              title={att.fileName}
                            >
                              {att.fileName}
                            </a>
                            <span className="shrink-0 text-[10px] text-slate-400">{formatFileSize(att.fileSizeBytes)}</span>
                            <a href={att.fileUrl} download={att.fileName} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" title="Download">
                              <Download className="h-3.5 w-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => deleteAttachment(att.id)}
                              className="shrink-0 rounded p-1 text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                      {uploadingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                      {uploadingAttachment ? "Uploading..." : "Add file, image, or video"}
                      <input
                        type="file"
                        className="hidden"
                        disabled={uploadingAttachment}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) uploadAttachment(file);
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                {saving ? "Saving..." : "Save Event"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
