import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Filter,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  RefreshCw,
  Reply,
  Save,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { apiFetch, apiFetchBlob } from "../../utils/fetch-auth-shim";

const emptySettings = {
  smtpHost: "",
  smtpPort: 587,
  smtpUseSsl: true,
  smtpUsername: "",
  smtpPassword: "",
  fromAddress: "",
  fromName: "Mahima Ministries",
  imapHost: "",
  imapPort: 993,
  imapUseSsl: true,
};

function createEmptyCompose() {
  return { to: "", cc: "", bcc: "", subject: "", body: "", files: [] };
}

const actionButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const primaryActionButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
const iconButtonClass =
  "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

const fallbackFolders = [
  { name: "Inbox", fullName: "INBOX", isInbox: true },
  { name: "Sent", fullName: "Sent", isSent: true },
  { name: "Drafts", fullName: "Drafts", isDrafts: true },
  { name: "Trash", fullName: "Trash", isTrash: true },
];

export default function EmailClientPage() {
  const [settings, setSettings] = useState(emptySettings);
  const [folders, setFolders] = useState(fallbackFolders);
  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [mailbox, setMailbox] = useState({ folder: "INBOX", total: 0, messages: [] });
  const [selectedMail, setSelectedMail] = useState(null);
  const [selectedUid, setSelectedUid] = useState("");
  const [compose, setCompose] = useState(() => createEmptyCompose());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showSettings, setShowSettings] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingMailbox, setLoadingMailbox] = useState(false);
  const [reading, setReading] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState("");

  const filteredMessages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return mailbox.messages.filter((mail) => {
      if (statusFilter === "unread" && mail.seen) return false;
      if (statusFilter === "attachments" && !mail.hasAttachments) return false;
      if (!needle) return true;
      return [mail.from, mail.to, mail.cc, mail.subject].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [mailbox.messages, query, statusFilter]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.fullName === activeFolder),
    [folders, activeFolder]
  );
  const isSentView = Boolean(selectedFolder?.isSent || String(activeFolder || "").toLowerCase().includes("sent"));

  async function load() {
    setLoading(true);
    setMessage("");
    setMessageType("info");
    try {
      const data = await apiFetch("/email-client/settings");
      const savedSettings = { ...emptySettings, ...(data || {}) };
      setSettings(savedSettings);
      await loadFolders();
      if (savedSettings.imapHost && savedSettings.smtpUsername) {
        await loadMailbox({ folder: activeFolder, quiet: true });
      }
    } catch (err) {
      notify("error", err?.message || "Could not load email settings.");
    } finally {
      setLoading(false);
    }
  }

  async function loadFolders() {
    try {
      const data = await apiFetch("/email-client/folders", { timeoutMs: 35000 });
      const serverFolders = Array.isArray(data?.folders) && data.folders.length > 0 ? data.folders : fallbackFolders;
      setFolders(serverFolders);
    } catch {
      setFolders(fallbackFolders);
    }
  }

  async function loadMailbox({ folder = activeFolder, quiet = false } = {}) {
    setLoadingMailbox(true);
    if (!quiet) {
      setMessage("");
      setMessageType("info");
    }
    try {
      const data = await apiFetch(`/email-client/inbox?folder=${encodeURIComponent(folder)}&take=500`, { timeoutMs: 45000 });
      setActiveFolder(data?.folder || folder);
      setMailbox({
        folder: data?.folder || folder,
        total: Number(data?.total || 0),
        messages: Array.isArray(data?.messages) ? data.messages : [],
      });
      setSelectedMail(null);
      setSelectedUid("");
      if (!quiet) notify("success", "Mailbox refreshed.");
    } catch (err) {
      setMailbox((current) => ({ ...current, messages: [] }));
      notify("error", err?.message || "Could not load mailbox. Check IMAP host, port, SSL/TLS, username, and password.");
    } finally {
      setLoadingMailbox(false);
    }
  }

  async function openMessage(mail) {
    if (!mail?.uid) return;
    setSelectedUid(mail.uid);
    setReading(true);
    setMessage("");
    try {
      const data = await apiFetch(
        `/email-client/message/${encodeURIComponent(mail.uid)}?folder=${encodeURIComponent(activeFolder)}&markRead=true`,
        { timeoutMs: 45000 }
      );
      setSelectedMail(data || mail);
      setMailbox((current) => ({
        ...current,
        messages: current.messages.map((item) => (item.uid === mail.uid ? { ...item, seen: true } : item)),
      }));
    } catch (err) {
      notify("error", err?.message || "Could not open email.");
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function notify(type, text) {
    setMessageType(type);
    setMessage(text);
  }

  function update(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    try {
      const saved = await persistSettings();
      setSettings({ ...emptySettings, ...(saved || settings) });
      notify("success", "Email connectivity saved.");
      await loadFolders();
      await loadMailbox({ folder: activeFolder, quiet: true });
    } catch (err) {
      notify("error", err?.message || "Could not save email connectivity.");
    } finally {
      setSaving(false);
    }
  }

  async function persistSettings() {
    return apiFetch("/email-client/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }

  async function testEmail() {
    setTesting(true);
    setMessage("");
    try {
      const saved = await persistSettings();
      setSettings({ ...emptySettings, ...(saved || settings) });
      await apiFetch("/email-client/test", { method: "POST", timeoutMs: 35000 });
      notify("success", "SMTP test completed.");
    } catch (err) {
      notify("error", err?.message || "SMTP test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function sendEmail(e) {
    e.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("to", compose.to || "");
      formData.append("cc", compose.cc || "");
      formData.append("bcc", compose.bcc || "");
      formData.append("subject", compose.subject || "");
      formData.append("body", compose.body || "");
      (compose.files || []).forEach((file) => formData.append("attachments", file));

      const result = await apiFetch("/email-client/send-with-attachments", {
        method: "POST",
        body: formData,
        timeoutMs: 120000,
      });
      setCompose(createEmptyCompose());
      setShowCompose(false);
      notify("success", result?.savedToSent ? "Email sent and saved to Sent." : "Email sent. Sent-folder save is unavailable for this mailbox.");
      await loadFolders();
      await loadMailbox({ folder: activeFolder, quiet: true });
    } catch (err) {
      notify("error", err?.message || "Email send failed.");
    } finally {
      setSending(false);
    }
  }

  async function downloadReceivedAttachment(attachment) {
    if (!selectedMail?.uid || attachment?.index == null) return;

    const downloadKey = `${selectedMail.uid}:${attachment.index}`;
    setDownloadingAttachment(downloadKey);
    setMessage("");

    try {
      const result = await apiFetchBlob(
        `/email-client/message/${encodeURIComponent(selectedMail.uid)}/attachments/${attachment.index}?folder=${encodeURIComponent(activeFolder)}`,
        { timeoutMs: 120000 }
      );

      const blobUrl = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = result.fileName || attachment.fileName || `attachment-${attachment.index + 1}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      notify("success", `Downloaded ${link.download}.`);
    } catch (err) {
      notify("error", err?.message || "Could not download attachment.");
    } finally {
      setDownloadingAttachment("");
    }
  }

  function startReply(mail = selectedMail) {
    if (!mail) return;
    setCompose({
      to: extractAddress(mail.from),
      cc: "",
      bcc: "",
      subject: mail.subject?.toLowerCase().startsWith("re:") ? mail.subject : `Re: ${mail.subject || ""}`,
      body: "",
      files: [],
    });
    setShowCompose(true);
  }

  return (
    <div className="min-h-full bg-slate-100 px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <header
          id="mahima-email-client-page-header"
          className="mahima-standard-page-header rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          data-mahima-explicit-header="true"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                Admin Outlook Desk
              </div>
              <h1 className="mahima-standard-page-title mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl" data-mahima-explicit-title="true">Email Client</h1>
              <p className="mahima-standard-page-subtitle mt-1 text-sm text-slate-500">Mailbox, reading pane, SMTP compose, folders, search, and connection controls.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowCompose(true)} className={primaryActionButtonClass}>
                <Edit3 className="h-4 w-4" />
                New Mail
              </button>
              <button type="button" onClick={() => loadMailbox()} disabled={loadingMailbox || loading} className={actionButtonClass}>
                {loadingMailbox ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sync
              </button>
              <button type="button" onClick={() => setShowSettings((v) => !v)} className={actionButtonClass}>
                <Settings className="h-4 w-4" />
                Settings
              </button>
            </div>
          </div>
        </header>

        {message && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
            messageType === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"
          }`}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {showSettings && (
          <SettingsPanel
            settings={settings}
            update={update}
            saving={saving}
            testing={testing}
            loading={loading}
            onSave={saveSettings}
            onTest={testEmail}
            onClose={() => setShowSettings(false)}
          />
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid min-h-[720px] xl:grid-cols-[260px_430px_minmax(0,1fr)]">
            <aside className="border-b border-slate-200 bg-slate-950 p-4 text-white xl:border-b-0 xl:border-r">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Mailbox</p>
                  <p className="text-sm font-semibold text-slate-300">{settings.smtpUsername || settings.fromAddress || "Not configured"}</p>
                </div>
                <Mail className="h-5 w-5 text-emerald-300" />
              </div>

              <div className="space-y-1">
                {folders.map((folder) => {
                  const active = activeFolder === folder.fullName;
                  const Icon = folderIcon(folder);
                  return (
                    <button
                      key={folder.fullName}
                      type="button"
                      onClick={() => loadMailbox({ folder: folder.fullName })}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
                        active ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{folderLabel(folder)}</span>
                      {(active || folder.isInbox) && mailbox.total > 0 && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-100 text-emerald-700" : "bg-white/10 text-white"}`}>
                          {mailbox.total}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Connection</p>
                <div className="mt-3 space-y-2 text-sm">
                  <StatusLine label="SMTP" value={settings.smtpHost ? `${settings.smtpHost}:${settings.smtpPort}` : "Missing"} ok={Boolean(settings.smtpHost)} />
                  <StatusLine label="IMAP" value={settings.imapHost ? `${settings.imapHost}:${settings.imapPort}` : "Missing"} ok={Boolean(settings.imapHost)} />
                </div>
              </div>
            </aside>

            <section className="border-b border-slate-200 xl:border-b-0 xl:border-r">
              <div className="border-b border-slate-200 p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search sender or subject"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <FilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</FilterButton>
                  <FilterButton active={statusFilter === "unread"} onClick={() => setStatusFilter("unread")}>Unread</FilterButton>
                  <FilterButton active={statusFilter === "attachments"} onClick={() => setStatusFilter("attachments")}>Files</FilterButton>
                </div>
              </div>

              <div className="h-[620px] overflow-y-auto">
                {loadingMailbox ? (
                  <div className="flex h-full items-center justify-center gap-2 text-sm font-semibold text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Syncing mailbox...
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-slate-500">
                    <Inbox className="mb-3 h-10 w-10 text-slate-300" />
                    No messages found for this view.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredMessages.map((mail) => (
                      <MessageCard
                        key={mail.uid}
                        mail={mail}
                        sentView={isSentView}
                        active={selectedUid === mail.uid}
                        onClick={() => openMessage(mail)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <ReadingPane
              mail={selectedMail}
              loading={reading}
              onReply={() => startReply()}
              onCompose={() => setShowCompose(true)}
              onDownloadAttachment={downloadReceivedAttachment}
              downloadingAttachment={downloadingAttachment}
            />
          </div>
        </section>

        {showCompose && (
          <ComposePanel
            compose={compose}
            setCompose={setCompose}
            sending={sending}
            showCcBcc={showCcBcc}
            setShowCcBcc={setShowCcBcc}
            onSend={sendEmail}
            onClose={() => setShowCompose(false)}
          />
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ settings, update, saving, testing, loading, onSave, onTest, onClose }) {
  const smtpPortWarning =
    String(settings.smtpHost || "").trim().toLowerCase() === "smtp.hostinger.com" && Number(settings.smtpPort) === 456
      ? "Hostinger SMTP uses port 465 for SSL/TLS or port 587 for STARTTLS. Port 456 will be rejected."
      : "";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-emerald-700" />
          <h2 className="text-lg font-black text-slate-950">Connectivity Settings</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="SMTP host" value={settings.smtpHost} onChange={(v) => update("smtpHost", v)} />
        <Field label="SMTP port" type="number" value={settings.smtpPort} onChange={(v) => update("smtpPort", Number(v || 0))} />
        <Field label="SMTP username" value={settings.smtpUsername} onChange={(v) => update("smtpUsername", v)} />
        <Field label="SMTP password" type="password" value={settings.smtpPassword} onChange={(v) => update("smtpPassword", v)} placeholder="Leave masked value to keep existing" />
        <Field label="From address" value={settings.fromAddress} onChange={(v) => update("fromAddress", v)} />
        <Field label="From name" value={settings.fromName} onChange={(v) => update("fromName", v)} />
        <Field label="IMAP host" value={settings.imapHost} onChange={(v) => update("imapHost", v)} />
        <Field label="IMAP port" type="number" value={settings.imapPort} onChange={(v) => update("imapPort", Number(v || 0))} />
      </div>
      {smtpPortWarning && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {smtpPortWarning}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle label="SMTP SSL/TLS" checked={Boolean(settings.smtpUseSsl)} onChange={(v) => update("smtpUseSsl", v)} />
          <Toggle label="IMAP SSL/TLS" checked={Boolean(settings.imapUseSsl)} onChange={(v) => update("imapUseSsl", v)} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onTest} disabled={testing || loading} className={actionButtonClass}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
            Test
          </button>
          <button type="button" onClick={onSave} disabled={saving || loading} className={primaryActionButtonClass}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </section>
  );
}

function ComposePanel({ compose, setCompose, sending, showCcBcc, setShowCcBcc, onSend, onClose }) {
  const files = compose.files || [];

  function addFiles(event) {
    const selected = Array.from(event.target.files || []);
    if (selected.length > 0) {
      setCompose((current) => ({ ...current, files: [...(current.files || []), ...selected] }));
    }
    event.target.value = "";
  }

  function removeFile(index) {
    setCompose((current) => ({
      ...current,
      files: (current.files || []).filter((_, fileIndex) => fileIndex !== index),
    }));
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-emerald-700" />
          <h2 className="text-lg font-black text-slate-950">New Message</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <X className="h-5 w-5" />
        </button>
      </div>
      <form onSubmit={onSend} className="grid gap-4 p-4 xl:grid-cols-[minmax(280px,0.8fr)_1.2fr]">
        <div className="space-y-3">
          <Field label="To" value={compose.to} onChange={(v) => setCompose((c) => ({ ...c, to: v }))} required />
          {showCcBcc && (
            <>
              <Field label="Cc" value={compose.cc} onChange={(v) => setCompose((c) => ({ ...c, cc: v }))} />
              <Field label="Bcc" value={compose.bcc} onChange={(v) => setCompose((c) => ({ ...c, bcc: v }))} />
            </>
          )}
          <button type="button" onClick={() => setShowCcBcc((v) => !v)} className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
            <UserPlus className="h-4 w-4" />
            {showCcBcc ? "Hide Cc/Bcc" : "Add Cc/Bcc"}
          </button>
          <Field label="Subject" value={compose.subject} onChange={(v) => setCompose((c) => ({ ...c, subject: v }))} required />
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Message</span>
            <textarea
              value={compose.body}
              onChange={(e) => setCompose((c) => ({ ...c, body: e.target.value }))}
              rows={12}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              required
            />
          </label>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-slate-800">Attachments</p>
                <p className="text-xs font-semibold text-slate-500">Add documents, images, PDFs, or ministry files before sending.</p>
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100">
                <Paperclip className="h-4 w-4" />
                Add files
                <input type="file" multiple onChange={addFiles} className="hidden" />
              </label>
            </div>

            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-emerald-700" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{file.name}</p>
                      <p className="text-xs font-semibold text-slate-500">{formatBytes(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      title="Remove attachment"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="submit" disabled={sending} className={`${primaryActionButtonClass} w-full justify-center`}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Email{files.length > 0 ? ` with ${files.length} file${files.length === 1 ? "" : "s"}` : ""}
          </button>
        </div>
      </form>
    </section>
  );
}

function ReadingPane({ mail, loading, onReply, onCompose, onDownloadAttachment, downloadingAttachment }) {
  const [bodyView, setBodyView] = useState("html");
  const [showRemoteImages, setShowRemoteImages] = useState(false);
  const hasHtmlBody = Boolean(mail?.htmlBody?.trim());
  const hasTextBody = Boolean(mail?.textBody?.trim());
  const htmlHasReadableText = useMemo(() => hasReadableEmailText(mail?.htmlBody), [mail?.htmlBody]);
  const containsRemoteImages = useMemo(() => hasRemoteEmailImages(mail?.htmlBody), [mail?.htmlBody]);
  const safeHtmlDocument = useMemo(
    () => buildSafeEmailDocument(mail?.htmlBody, showRemoteImages),
    [mail?.htmlBody, showRemoteImages]
  );

  useEffect(() => {
    setShowRemoteImages(false);
    setBodyView(hasHtmlBody && (htmlHasReadableText || !hasTextBody) ? "html" : "text");
  }, [mail?.uid, hasHtmlBody, hasTextBody, htmlHasReadableText]);

  if (loading) {
    return (
      <section className="flex min-h-[620px] items-center justify-center gap-2 bg-white text-sm font-semibold text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Opening message...
      </section>
    );
  }

  if (!mail) {
    return (
      <section className="flex min-h-[620px] flex-col items-center justify-center bg-slate-50 px-8 text-center">
        <MailOpen className="mb-4 h-14 w-14 text-slate-300" />
        <h2 className="text-xl font-black text-slate-950">Select a message</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">Open a message to read it here, then reply or start a new ministry email.</p>
        <button type="button" onClick={onCompose} className={`${primaryActionButtonClass} mt-5`}>
          <Edit3 className="h-4 w-4" />
          New Mail
        </button>
      </section>
    );
  }

  return (
    <section className="min-h-[620px] bg-white">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-black text-slate-950">{mail.subject || "(No subject)"}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">{mail.from || "Unknown sender"}</p>
            <p className="mt-1 text-xs text-slate-500">To: {mail.to || "Not available"}</p>
            {mail.cc && <p className="mt-1 text-xs text-slate-500">Cc: {mail.cc}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onReply} className={actionButtonClass}>
              <Reply className="h-4 w-4" />
              Reply
            </button>
            <button type="button" className={iconButtonClass} title="Star">
              <Star className="h-4 w-4" />
            </button>
            <button type="button" className={iconButtonClass} title="Archive">
              <Archive className="h-4 w-4" />
            </button>
            <button type="button" className={`${iconButtonClass} text-red-600`} title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <Clock className="h-4 w-4" />
          {formatMailDate(mail.date, true)}
          {mail.hasAttachments && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
              <Paperclip className="h-3.5 w-3.5" />
              Attachment
            </span>
          )}
        </div>
      </div>

      {Array.isArray(mail.attachments) && mail.attachments.length > 0 && (
        <div className="border-b border-slate-100 px-5 py-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {mail.attachments.map((attachment) => (
              <button
                key={attachment.index}
                type="button"
                onClick={() => onDownloadAttachment?.(attachment)}
                disabled={downloadingAttachment === `${mail.uid}:${attachment.index}`}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-wait disabled:opacity-60"
                title={`Download ${attachment.fileName}`}
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span className="max-w-[220px] truncate">{attachment.fileName}</span>
                {attachment.size ? <span className="text-slate-400">{formatBytes(attachment.size)}</span> : null}
                {downloadingAttachment === `${mail.uid}:${attachment.index}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-5">
        {(hasHtmlBody || hasTextBody) && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">
              {bodyView === "text"
                ? "Plain-text view for maximum readability."
                : showRemoteImages
                  ? "Remote images are visible for this message."
                  : "Remote images are hidden to protect your privacy."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {hasHtmlBody && hasTextBody && (
                <button
                  type="button"
                  onClick={() => setBodyView((current) => (current === "html" ? "text" : "html"))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700"
                >
                  {bodyView === "html" ? "View plain text" : "View original email"}
                </button>
              )}
              {bodyView === "html" && containsRemoteImages && (
                <button
                  type="button"
                  onClick={() => setShowRemoteImages((current) => !current)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700"
                >
                  {showRemoteImages ? "Hide remote images" : "Show remote images"}
                </button>
              )}
            </div>
          </div>
        )}

        {bodyView === "html" && hasHtmlBody ? (
          <iframe
            title="Email body"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={safeHtmlDocument}
            className="h-[460px] w-full rounded-xl border border-slate-200 bg-white"
          />
        ) : (
          <div className="min-h-[240px] whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700">
            {mail.textBody || "This message does not contain a readable body."}
          </div>
        )}
      </div>
    </section>
  );
}

function MessageCard({ mail, sentView, active, onClick }) {
  const party = sentView && mail.to ? `To: ${mail.to}` : mail.from || "Unknown sender";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-4 py-3 text-left transition ${
        active ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200" : mail.seen ? "bg-white hover:bg-slate-50" : "bg-white hover:bg-emerald-50/40"
      }`}
    >
      <div className="flex gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${
          mail.seen ? "bg-slate-100 text-slate-600" : "bg-emerald-600 text-white"
        }`}>
          {initials(party || mail.subject)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-sm ${mail.seen ? "font-semibold text-slate-700" : "font-black text-slate-950"}`}>
              {party}
            </span>
            {!mail.seen && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </span>
          <span className={`mt-1 block truncate text-sm ${mail.seen ? "font-semibold text-slate-700" : "font-black text-slate-950"}`}>
            {mail.subject || "(No subject)"}
          </span>
          <span className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            {formatMailDate(mail.date)}
            {mail.hasAttachments && <Paperclip className="h-3.5 w-3.5" />}
          </span>
        </span>
      </div>
    </button>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-bold ${
        active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      <Filter className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function StatusLine({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className={`truncate rounded-full px-2 py-0.5 text-xs font-bold ${ok ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200"}`}>
        {value}
      </span>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Field({ label, value, onChange, type = "text", required = false, placeholder = "" }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function folderIcon(folder) {
  if (folder.isInbox) return Inbox;
  if (folder.isTrash) return Trash2;
  if (folder.isSent) return Send;
  if (folder.isDrafts) return Edit3;
  return Mail;
}

function folderLabel(folder) {
  if (folder.isInbox) return "Inbox";
  if (folder.isSent) return "Sent";
  if (folder.isDrafts) return "Drafts";
  if (folder.isTrash) return "Trash";
  return folder.name || folder.fullName;
}

function initials(value) {
  const cleaned = String(value || "M").replace(/<.*?>/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "M").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

function extractAddress(value) {
  const text = String(value || "");
  const match = text.match(/<([^>]+)>/);
  return match?.[1] || text.split(",")[0]?.trim() || "";
}

function formatMailDate(value, verbose = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], verbose
    ? { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function hasReadableEmailText(html) {
  const source = String(html || "").trim();
  if (!source) return false;

  if (typeof DOMParser === "undefined") {
    return source
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ")
      .trim().length >= 24;
  }

  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, style, noscript, template, svg").forEach((node) => node.remove());
  const readableText = String(document.body?.textContent || "").replace(/\s+/g, " ").trim();
  return readableText.length >= 24;
}

function hasRemoteEmailImages(html) {
  const source = String(html || "");
  return /(?:src|background)\s*=\s*["']?\s*https?:\/\//i.test(source) || /url\(\s*["']?https?:\/\//i.test(source);
}

function buildSafeEmailDocument(html, allowRemoteImages) {
  const source = String(html || "").trim();
  if (!source) return "";

  if (typeof DOMParser === "undefined") {
    return `<!doctype html><html><body><pre>${escapeEmailHtml(source)}</pre></body></html>`;
  }

  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, iframe, frame, frameset, object, embed, form, input, button, textarea, select, base, meta[http-equiv], link").forEach((node) => node.remove());

  document.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes || []).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "formaction" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        return;
      }
      if ((name === "href" || name === "action") && /^(?:javascript|data|vbscript):/i.test(value)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === "style" && !allowRemoteImages && /url\s*\(/i.test(value)) {
        element.setAttribute("style", value.replace(/url\s*\([^)]*\)/gi, "none"));
      }
    });
  });

  document.querySelectorAll("a[href]").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });

  document.querySelectorAll("img").forEach((image) => {
    const sourceUrl = String(image.getAttribute("src") || "").trim();
    const isEmbeddedImage = /^data:image\//i.test(sourceUrl);
    const isRemoteImage = /^https?:\/\//i.test(sourceUrl) || sourceUrl.startsWith("//");

    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.removeAttribute("width");
    image.removeAttribute("height");

    if (isEmbeddedImage || (isRemoteImage && allowRemoteImages)) return;

    const placeholder = document.createElement("div");
    placeholder.className = "email-image-placeholder";
    const altText = String(image.getAttribute("alt") || "").trim();
    placeholder.textContent = /^cid:/i.test(sourceUrl)
      ? `${altText ? `${altText} — ` : ""}Inline image unavailable`
      : `${altText ? `${altText} — ` : ""}Remote image hidden`;
    image.replaceWith(placeholder);
  });

  if (!allowRemoteImages) {
    document.querySelectorAll("style").forEach((style) => {
      style.textContent = String(style.textContent || "").replace(/url\s*\([^)]*\)/gi, "none");
    });
  }

  const safeBody = document.body?.innerHTML || "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; background: #ffffff !important; }
      body { margin: 0 !important; padding: 20px !important; color: #334155 !important; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important; font-size: 15px; line-height: 1.65; overflow-wrap: anywhere; }
      img { display: block; max-width: 100% !important; height: auto !important; object-fit: contain; }
      table { max-width: 100% !important; }
      pre { max-width: 100%; overflow: auto; white-space: pre-wrap; }
      blockquote { margin-left: 0; border-left: 3px solid #cbd5e1; padding-left: 14px; color: #64748b; }
      a { color: #047857; text-decoration: underline; }
      .email-image-placeholder { display: inline-flex !important; width: auto !important; min-width: 0 !important; height: auto !important; min-height: 0 !important; max-height: 44px !important; margin: 8px 0 !important; padding: 8px 12px !important; align-items: center; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc !important; color: #64748b !important; font-size: 12px !important; font-weight: 700; line-height: 1.25 !important; }
    </style>
  </head>
  <body>${safeBody}</body>
</html>`;
}

function escapeEmailHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
