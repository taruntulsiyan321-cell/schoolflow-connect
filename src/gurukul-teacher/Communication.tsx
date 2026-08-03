import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Send, MessageCircle, Users, Loader2, Paperclip, Reply, Trash2, Plus,
} from "lucide-react";
import { cn } from "./shared";
import {
  AttendanceService,
  MessageService,
  useAcademicLive,
  type AssignedClass,
  type ChatAttachment,
  type ChatContact,
  type ChatMessage,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import {
  ACADEMIC_FILE_ACCEPT,
  uploadAcademicFile,
} from "@/academic/storage/academicFileUpload";
import { supabase } from "@/integrations/supabase/client";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { toast } from "sonner";

const roleColor: Record<string, string> = {
  student: "#6366f1",
  parent: "#f59e0b",
  principal: "#cc5069",
  admin: "#10b981",
  teacher: "#3b5bdb",
  class_group: "#0ea5a0",
  teacher_group: "#f59e0b",
};

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function isGroup(c: ChatContact | null | undefined) {
  return c?.kind === "class_group" || c?.kind === "teacher_group" || c?.role === "class_group" || c?.role === "teacher_group";
}

function ThreadList({
  contacts,
  selectedId,
  onSelect,
}: {
  contacts: ChatContact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = contacts.filter(
    (t) => !search || t.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-white/7">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <Search className="w-3 h-3 text-[#46465a] shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-[10px] text-[#46465a]">No conversations yet.</div>
        )}
        {filtered.map((t) => {
          const key = t.conversationId || t.userId;
          const color = roleColor[t.role] ?? roleColor[t.kind ?? ""] ?? "#78788c";
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "w-full flex items-start gap-3 px-4 py-3 hover:bg-white/3 transition-all text-left",
                selectedId === key && "bg-[#3b5bdb]/5 border-r-2 border-[#3b5bdb]",
              )}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
                style={{ background: `${color}18`, color }}
              >
                {isGroup(t) ? <Users className="w-3.5 h-3.5" /> : teacherInitials(t.name, "?")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-bold text-white truncate">{t.name}</div>
                  {t.unread > 0 && (
                    <div className="w-4 h-4 rounded-full bg-[#3b5bdb] text-black text-[8px] font-black flex items-center justify-center shrink-0">
                      {t.unread > 9 ? "9+" : t.unread}
                    </div>
                  )}
                </div>
                <div className="text-[9px] font-semibold capitalize" style={{ color }}>
                  {t.kind === "class_group"
                    ? "Class Group"
                    : t.kind === "teacher_group"
                      ? "Teacher Group"
                      : t.role}
                </div>
                <div className="text-[10px] text-[#78788c] truncate mt-0.5">{t.lastMessage || "—"}</div>
              </div>
              <div className="text-[8px] text-[#46465a] shrink-0 mt-0.5">{formatTime(t.lastTime)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChatView({
  contact,
  messages,
  myUserId,
  myName,
  onSend,
  onDelete,
  sending,
}: {
  contact: ChatContact;
  messages: ChatMessage[];
  myUserId: string;
  myName: string;
  onSend: (text: string, opts?: { replyToId?: string; attachment?: ChatAttachment }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  sending: boolean;
}) {
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const myInitials = teacherInitials(myName, "T");
  const color = roleColor[contact.role] ?? roleColor[contact.kind ?? ""] ?? "#78788c";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if ((!input.trim() && !uploading) || sending) return;
    const text = input.trim();
    setInput("");
    const replyId = replyTo?.id;
    setReplyTo(null);
    await onSend(text, { replyToId: replyId });
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const meta = await uploadAcademicFile(file);
      await onSend(input.trim(), {
        replyToId: replyTo?.id,
        attachment: {
          name: meta.name,
          url: meta.url,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
        },
      });
      setInput("");
      setReplyTo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
          style={{ background: `${color}18`, color }}
        >
          {isGroup(contact) ? <Users className="w-4 h-4" /> : teacherInitials(contact.name, "?")}
        </div>
        <div>
          <div className="text-sm font-bold text-white">{contact.name}</div>
          <div className="text-[9px] capitalize font-semibold" style={{ color }}>
            {contact.kind === "class_group"
              ? "Class Group"
              : contact.kind === "teacher_group"
                ? "Teacher Group"
                : contact.role}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-[10px] text-[#46465a] py-10">Start the conversation</div>
        )}
        {messages.map((m) => {
          const isMe = m.senderId === myUserId;
          const deleted = Boolean(m.deletedAt) || m.content === "Message deleted";
          return (
            <div key={m.id} className={cn("flex gap-3 group", isMe && "flex-row-reverse")}>
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center text-[8px] font-black shrink-0"
                style={{
                  background: isMe ? "#f59e0b20" : `${color}18`,
                  color: isMe ? "#f59e0b" : color,
                }}
              >
                {isMe ? myInitials : teacherInitials(contact.name, "?")}
              </div>
              <div className={cn("max-w-[70%]", isMe && "text-right")}>
                {m.replyPreview && (
                  <div className="text-[8px] text-[#46465a] mb-1 truncate border-l-2 border-white/20 pl-2">
                    {m.replyPreview}
                  </div>
                )}
                <div
                  className={cn(
                    "px-3 py-2 rounded-2xl text-xs leading-relaxed",
                    deleted
                      ? "bg-white/5 text-[#46465a] italic"
                      : isMe
                        ? "bg-[#3b5bdb]/15 text-[#fcd34d]"
                        : "bg-white/5 text-[#b0b0c0]",
                  )}
                >
                  {deleted ? "Message deleted" : m.content}
                  {!deleted &&
                    m.attachments?.map((a) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block mt-1 text-[10px] underline opacity-90"
                      >
                        {a.name || "Attachment"}
                      </a>
                    ))}
                </div>
                <div className="flex items-center gap-2 mt-1 justify-end">
                  <div className="text-[8px] text-[#46465a]">{formatTime(m.createdAt)}</div>
                  {!deleted && (
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => setReplyTo(m)}
                        className="text-[#46465a] hover:text-white"
                      >
                        <Reply className="w-3 h-3" />
                      </button>
                      {isMe && (
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => void onDelete(m.id)}
                          className="text-[#46465a] hover:text-[#f43f5e]"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {replyTo && (
        <div className="px-4 py-2 border-t border-white/7 flex items-center gap-2 text-[10px] text-[#78788c]">
          <Reply className="w-3 h-3" />
          <span className="truncate flex-1">Replying to: {replyTo.content.slice(0, 80)}</span>
          <button type="button" onClick={() => setReplyTo(null)} className="text-white">
            ×
          </button>
        </div>
      )}

      <div className="p-4 border-t border-white/7">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACADEMIC_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending || uploading}
            className="w-9 h-9 rounded-xl bg-white/5 text-[#78788c] flex items-center justify-center hover:text-white hover:bg-white/10 disabled:opacity-40"
            title="Attach image or PDF"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Type a message… (Enter to send)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#46465a] outline-none focus:border-[#3b5bdb]/40 resize-none transition-all"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="w-9 h-9 rounded-xl bg-[#3b5bdb] text-black flex items-center justify-center hover:bg-[#d97706] disabled:opacity-40 transition-all"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Communication() {
  const { ctx, ready } = useAcademicContext();
  const identity = useTeacherIdentity();
  const liveTick = useAcademicLive("message");
  const [assignedClasses, setAssignedClasses] = useState<AssignedClass[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [newForm, setNewForm] = useState({ contactId: "", message: "" });

  const selected = useMemo(
    () => contacts.find((c) => (c.conversationId || c.userId) === selectedKey) ?? null,
    [contacts, selectedKey],
  );

  const dmContacts = useMemo(
    () => contacts.filter((c) => !isGroup(c)),
    [contacts],
  );

  async function reloadContacts() {
    if (!ctx) return;
    const [classes, list] = await Promise.all([
      AttendanceService.listAssignedClasses(ctx),
      MessageService.listContacts(ctx),
    ]);
    setAssignedClasses(classes);
    setContacts(list);
    return list;
  }

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await reloadContacts();
        if (cancelled) return;
        if (!selectedKey && list?.[0]) setSelectedKey(list[0].conversationId || list[0].userId);
      } catch (e) {
        if (!cancelled) {
          setContacts([]);
          toast.error(e instanceof Error ? e.message : "Could not load messages");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveTick]);

  useEffect(() => {
    if (!ready || !ctx || !selected) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const peerId = isGroup(selected) ? selected.conversationId || selected.userId : selected.userId;
        const thread = await MessageService.listThread(
          ctx,
          peerId,
          selected.conversationId ?? (isGroup(selected) ? selected.userId : null),
        );
        if (!cancelled) {
          setMessages(thread);
          setContacts((prev) =>
            prev.map((c) =>
              (c.conversationId || c.userId) === selectedKey ? { ...c, unread: 0 } : c,
            ),
          );
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not load thread");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, selectedKey, selected?.conversationId, selected?.userId]);

  useEffect(() => {
    if (!ctx?.userId) return;
    const channel = supabase
      .channel("teacher_chat_messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as {
          id: string;
          sender_id: string;
          receiver_id: string | null;
          conversation_id?: string | null;
          content: string;
          is_read: boolean;
          created_at: string;
          reply_to_id?: string | null;
          deleted_at?: string | null;
        };
        const mapped: ChatMessage = {
          id: row.id,
          senderId: row.sender_id,
          receiverId: row.receiver_id,
          conversationId: row.conversation_id,
          content: row.content,
          isRead: row.is_read,
          createdAt: row.created_at,
          replyToId: row.reply_to_id,
          deletedAt: row.deleted_at,
        };

        const activeConv = selected?.conversationId;
        const inActiveConv =
          activeConv && mapped.conversationId === activeConv
            ? true
            : selected &&
              !isGroup(selected) &&
              ((mapped.senderId === ctx.userId && mapped.receiverId === selected.userId) ||
                (mapped.senderId === selected.userId && mapped.receiverId === ctx.userId));

        if (inActiveConv) {
          setMessages((prev) => (prev.find((m) => m.id === mapped.id) ? prev : [...prev, mapped]));
        } else if (mapped.receiverId === ctx.userId || (mapped.conversationId && mapped.senderId !== ctx.userId)) {
          void reloadContacts().catch(() => undefined);
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ctx?.userId, selectedKey, selected?.conversationId, selected?.userId]);

  async function handleSend(text: string, opts?: { replyToId?: string; attachment?: ChatAttachment }) {
    if (!ctx || !selected) return;
    setSending(true);
    try {
      const msg = await MessageService.send(ctx, selected.userId, text, {
        conversationId: selected.conversationId ?? (isGroup(selected) ? selected.userId : null),
        replyToId: opts?.replyToId,
        attachment: opts?.attachment,
      });
      setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setContacts((prev) =>
        prev.map((c) =>
          (c.conversationId || c.userId) === selectedKey
            ? {
                ...c,
                lastMessage: text || opts?.attachment?.name || "Attachment",
                lastTime: msg.createdAt,
                conversationId: msg.conversationId || c.conversationId,
              }
            : c,
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    if (!ctx) return;
    try {
      await MessageService.deleteMessage(ctx, id);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: "Message deleted", deletedAt: new Date().toISOString(), attachments: [] } : m)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function startNewThread() {
    if (!ctx || !newForm.contactId || !newForm.message.trim()) return;
    setSending(true);
    try {
      await MessageService.send(ctx, newForm.contactId, newForm.message.trim());
      const list = await reloadContacts();
      setSelectedKey(newForm.contactId);
      const found = list?.find((c) => c.userId === newForm.contactId);
      if (found?.conversationId) setSelectedKey(found.conversationId);
      setShowNewDm(false);
      setNewForm({ contactId: "", message: "" });
      toast.success("Message sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  async function createClassGroup(classId: string) {
    if (!ctx) return;
    setCreateBusy(true);
    try {
      const g = await MessageService.ensureClassGroup(ctx, classId);
      await reloadContacts();
      setSelectedKey(g.conversationId || g.userId);
      setShowCreate(false);
      toast.success("Class group ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create class group");
    } finally {
      setCreateBusy(false);
    }
  }

  async function createTeacherGroup() {
    if (!ctx) return;
    setCreateBusy(true);
    try {
      const g = await MessageService.ensureTeacherGroup(ctx);
      await reloadContacts();
      setSelectedKey(g.conversationId || g.userId);
      setShowCreate(false);
      toast.success("Teacher group ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create teacher group");
    } finally {
      setCreateBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading messages…
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)] min-h-[600px] flex rounded-2xl overflow-hidden border border-white/7 bg-[#0d0d0f]">
      <div className="w-72 shrink-0 bg-[#131316] border-r border-white/7 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/7">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#3b5bdb]" />
            <div className="text-sm font-bold text-white">Messages</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              title="Create group"
              className="w-7 h-7 rounded-lg bg-[#0ea5a0]/15 text-[#0ea5a0] flex items-center justify-center hover:bg-[#0ea5a0]/25 transition-all"
            >
              <Users className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowNewDm(true)}
              title="New message"
              className="w-7 h-7 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb] flex items-center justify-center hover:bg-[#3b5bdb]/25 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ThreadList contacts={contacts} selectedId={selectedKey} onSelect={setSelectedKey} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {selected && ctx ? (
          <ChatView
            contact={selected}
            messages={messages}
            myUserId={ctx.userId}
            myName={identity.name || "Teacher"}
            onSend={handleSend}
            onDelete={handleDelete}
            sending={sending}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-[#46465a]">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-xs">Select a conversation to start messaging</div>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white">Create Group</div>
              <button type="button" onClick={() => setShowCreate(false)} className="text-[#78788c] hover:text-white text-lg">
                ×
              </button>
            </div>
            <p className="text-[10px] text-[#78788c]">Only Class Group and Teacher Group are supported.</p>
            <button
              type="button"
              disabled={createBusy}
              onClick={() => void createTeacherGroup()}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 hover:bg-white/8 text-left"
            >
              <Users className="w-4 h-4 text-[#f59e0b]" />
              <div>
                <div className="text-xs font-bold text-white">Teacher Group</div>
                <div className="text-[10px] text-[#78788c]">All teachers + principal</div>
              </div>
            </button>
            <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Class Group</div>
            {assignedClasses.length === 0 && (
              <div className="text-[10px] text-[#46465a]">No assigned classes</div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {assignedClasses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={createBusy}
                  onClick={() => void createClassGroup(c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-white/5"
                >
                  <Users className="w-3.5 h-3.5 text-[#0ea5a0]" />
                  <span className="text-[11px] text-white">
                    {c.name}
                    {c.section ? `-${c.section}` : ""} {c.subject ? `· ${c.subject}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showNewDm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewDm(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white">New Message</div>
              <button type="button" onClick={() => setShowNewDm(false)} className="text-[#78788c] hover:text-white text-lg">
                ×
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Recipient *</label>
              <select
                value={newForm.contactId}
                onChange={(e) => setNewForm((p) => ({ ...p, contactId: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none"
              >
                <option value="">Select contact</option>
                {dmContacts.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name} ({c.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Message *</label>
              <textarea
                value={newForm.message}
                onChange={(e) => setNewForm((p) => ({ ...p, message: e.target.value }))}
                rows={3}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40 resize-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowNewDm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void startNewThread()}
                disabled={!newForm.contactId || !newForm.message.trim() || sending}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
