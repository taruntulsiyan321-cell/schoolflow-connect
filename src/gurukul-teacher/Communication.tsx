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
  type ChatContact,
  type ChatMessage,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { CHAT_FILE_ACCEPT } from "@/academic/storage/chatFileUpload";
import { supabase } from "@/integrations/supabase/client";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { toast } from "sonner";
import { NewChatSheet } from "@/components/chat/NewChatSheet";

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
      <div className="p-3 border-b border-border/70">
        <div className="flex items-center gap-2 bg-white/5 border border-border rounded-xl px-3 py-2">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chatsâ€¦"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-[10px] text-muted-foreground">No conversations yet.</div>
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
                "w-full flex items-start gap-3 px-4 py-3 hover:bg-muted transition-all text-left",
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
                    <div className="w-4 h-4 rounded-full bg-[#3b5bdb] text-white text-[8px] font-black flex items-center justify-center shrink-0">
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
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{t.lastMessage || "â€”"}</div>
              </div>
              <div className="text-[8px] text-muted-foreground shrink-0 mt-0.5">{formatTime(t.lastTime)}</div>
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
  onSendFile,
  onDelete,
  sending,
}: {
  contact: ChatContact;
  messages: ChatMessage[];
  myUserId: string;
  myName: string;
  onSend: (text: string, opts?: { replyToId?: string }) => Promise<void>;
  onSendFile: (file: File, opts?: { caption?: string; replyToId?: string }) => Promise<void>;
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
      const caption = input.trim();
      const replyId = replyTo?.id;
      setInput("");
      setReplyTo(null);
      await onSendFile(file, { caption, replyToId: replyId });
    } catch {
      // Error toast is already shown in handleSendFile, closer to the failure.
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border/70">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
          style={{ background: `${color}18`, color }}
        >
          {isGroup(contact) ? <Users className="w-4 h-4" /> : teacherInitials(contact.name, "?")}
        </div>
        <div>
          <div className="text-sm font-bold text-foreground">{contact.name}</div>
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
          <div className="text-center text-[10px] text-muted-foreground py-10">Start the conversation</div>
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
                  <div className="text-[8px] text-muted-foreground mb-1 truncate border-l-2 border-border pl-2">
                    {m.replyPreview}
                  </div>
                )}
                <div
                  className={cn(
                    "px-3 py-2 rounded-2xl text-xs leading-relaxed",
                    deleted
                      ? "bg-white/5 text-muted-foreground italic"
                      : isMe
                        ? "bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] text-foreground"
                        : "bg-white/5 text-[#d0d8f0] border border-white/8",
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
                  <div className="text-[8px] text-muted-foreground">{formatTime(m.createdAt)}</div>
                  {!deleted && (
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => setReplyTo(m)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Reply className="w-3 h-3" />
                      </button>
                      {isMe && (
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => void onDelete(m.id)}
                          className="text-muted-foreground hover:text-[#f43f5e]"
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
        <div className="px-4 py-2 border-t border-border/70 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Reply className="w-3 h-3" />
          <span className="truncate flex-1">Replying to: {replyTo.content.slice(0, 80)}</span>
          <button type="button" onClick={() => setReplyTo(null)} className="text-foreground">
            Ã—
          </button>
        </div>
      )}

      <div className="p-4 border-t border-border/70">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={CHAT_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending || uploading}
            className="w-9 h-9 rounded-xl bg-white/5 text-muted-foreground flex items-center justify-center hover:text-white hover:bg-white/10 disabled:opacity-40"
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
            placeholder="Type a messageâ€¦ (Enter to send)"
            className="flex-1 bg-white/5 border border-border rounded-xl px-3 py-2 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-[#3b5bdb]/40 resize-none transition-all"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="w-9 h-9 rounded-xl bg-[#3b5bdb] text-white flex items-center justify-center hover:bg-[#6882e8] disabled:opacity-40 transition-all"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Communication() {
  const { ctx, ready, settled } = useAcademicContext();
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
  const [startingChat, setStartingChat] = useState(false);
  /** True after first contacts fetch â€” liveTick must not flip back to full-page loading. */
  const contactsLoadedRef = useRef(false);

  const selected = useMemo(
    () =>
      contacts.find((c) => (c.conversationId || c.userId) === selectedKey) ??
      contacts.find((c) => !isGroup(c) && c.userId === selectedKey) ??
      null,
    [contacts, selectedKey],
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
    if (!settled) return;
    if (!ctx) {
      contactsLoadedRef.current = true;
      setLoading(false);
      setContacts([]);
      return;
    }
    let cancelled = false;
    const isFirstLoad = !contactsLoadedRef.current;
    (async () => {
      if (isFirstLoad) setLoading(true);
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
        if (!cancelled) {
          contactsLoadedRef.current = true;
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveTick]);

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
  }, [ready, ctx, selectedKey, selected?.conversationId, selected?.userId, liveTick]);

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
          has_attachment?: boolean | null;
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
          attachments: [],
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
          if (row.has_attachment && !row.deleted_at) {
            const msgId = mapped.id;
            void MessageService.listAttachments(ctx, [msgId])
              .then((map) => {
                const atts = map.get(msgId) ?? [];
                if (!atts.length) return;
                setMessages((prev) =>
                  prev.map((m) => (m.id === msgId ? { ...m, attachments: atts } : m)),
                );
              })
              .catch(() => undefined);
          }
        } else if (mapped.receiverId === ctx.userId || (mapped.conversationId && mapped.senderId !== ctx.userId)) {
          void reloadContacts().catch(() => undefined);
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ctx?.userId, selectedKey, selected?.conversationId, selected?.userId]);

  async function handleSend(text: string, opts?: { replyToId?: string }) {
    if (!ctx || !selected) return;
    setSending(true);
    try {
      const msg = await MessageService.send(ctx, selected.userId, text, {
        conversationId: selected.conversationId ?? (isGroup(selected) ? selected.userId : null),
        replyToId: opts?.replyToId,
      });
      setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setContacts((prev) =>
        prev.map((c) =>
          (c.conversationId || c.userId) === selectedKey
            ? {
                ...c,
                lastMessage: text || "Message",
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

  async function handleSendFile(file: File, opts?: { caption?: string; replyToId?: string }) {
    if (!ctx || !selected) return;
    setSending(true);
    try {
      const msg = await MessageService.sendFile(ctx, {
        receiverId: selected.userId,
        file,
        conversationId: selected.conversationId ?? (isGroup(selected) ? selected.userId : null),
        caption: opts?.caption,
        replyToId: opts?.replyToId,
      });
      setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setContacts((prev) =>
        prev.map((c) =>
          (c.conversationId || c.userId) === selectedKey
            ? {
                ...c,
                lastMessage: opts?.caption || file.name || "Attachment",
                lastTime: msg.createdAt,
                conversationId: msg.conversationId || c.conversationId,
              }
            : c,
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send file");
      throw e;
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

  async function openNewChatWith(contact: ChatContact) {
    if (!ctx || isGroup(contact)) return;
    setStartingChat(true);
    try {
      const ensured = await MessageService.ensureDm(ctx, contact.userId);
      const next: ChatContact = {
        ...contact,
        ...ensured,
        name: contact.name || ensured.name,
        role: contact.role || ensured.role,
        kind: "dm",
      };
      setContacts((prev) => {
        const others = prev.filter(
          (c) => isGroup(c) || (c.userId !== contact.userId && c.conversationId !== next.conversationId),
        );
        return [next, ...others];
      });
      setSelectedKey(next.conversationId || next.userId);
      setShowNewDm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open chat");
    } finally {
      setStartingChat(false);
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

  if (loading && !contactsLoadedRef.current) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading messagesâ€¦
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)] min-h-[600px] flex rounded-2xl overflow-hidden border border-border bg-background">
      <div className="w-72 shrink-0 bg-surface border-r border-border/70 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#3b5bdb]" />
            <div className="text-sm font-bold text-foreground">Messages</div>
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
              title="New chat"
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
            onSendFile={handleSendFile}
            onDelete={handleDelete}
            sending={sending}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-xs">Select a conversation to start messaging</div>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative z-10 bg-surface border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-foreground">Create Group</div>
              <button type="button" onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-white text-lg">
                Ã—
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">Only Class Group and Teacher Group are supported.</p>
            <button
              type="button"
              disabled={createBusy}
              onClick={() => void createTeacherGroup()}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 hover:bg-white/8 text-left"
            >
              <Users className="w-4 h-4 text-[#f59e0b]" />
              <div>
                <div className="text-xs font-bold text-foreground">Teacher Group</div>
                <div className="text-[10px] text-muted-foreground">All teachers + principal</div>
              </div>
            </button>
            <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Class Group</div>
            {assignedClasses.length === 0 && (
              <div className="text-[10px] text-muted-foreground">No assigned classes</div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {assignedClasses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={createBusy}
                  onClick={() => void createClassGroup(c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-muted"
                >
                  <Users className="w-3.5 h-3.5 text-[#0ea5a0]" />
                  <span className="text-[11px] text-foreground">
                    {c.name}
                    {c.section ? `-${c.section}` : ""} {c.subject ? `Â· ${c.subject}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <NewChatSheet
        open={showNewDm}
        onClose={() => {
          if (!startingChat) setShowNewDm(false);
        }}
        contacts={contacts}
        busy={startingChat}
        onSelect={(peer) => void openNewChatWith(peer)}
      />
    </div>
  );
}
