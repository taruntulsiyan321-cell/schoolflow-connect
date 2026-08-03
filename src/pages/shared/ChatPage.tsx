import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import {
  MessageService,
  useAcademicLive,
  type ChatContact,
  type ChatMessage,
} from "@/academic";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Search,
  Smile,
  Paperclip,
  Reply,
  Trash2,
  Users,
  FileText,
  X,
  Check,
  CheckCheck,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { NewChatSheet } from "@/components/chat/NewChatSheet";
import "@/components/chat/chat-panel.css";

const CHAT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.txt,image/*,application/pdf";

/** Role chip colors — Gurukul dark surfaces (same palette as teacher Communication). */
const roleColors: Record<string, string> = {
  admin: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  principal: "bg-rose-500/15 text-rose-400 border-rose-500/25",
  teacher: "bg-[#3b5bdb]/15 text-[#818cf8] border-[#3b5bdb]/30",
  student: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
  parent: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  class_group: "bg-teal-500/15 text-teal-400 border-teal-500/25",
  teacher_group: "bg-amber-500/15 text-amber-400 border-amber-500/25",
};

const EMOJI_QUICK = [
  "😀", "😁", "😂", "🙂", "😉", "😍", "🤔", "👍", "👏", "🙏",
  "🔥", "⭐", "✅", "❌", "🎉", "📚", "✏️", "💯", "❤️", "🙌",
];

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function isImageMime(mime?: string | null, name?: string) {
  if (mime?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(name || "");
}

function Avatar({ name, url, size = "md" }: { name: string; url?: string | null; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-9 h-9 rounded-xl text-[10px]" : "w-10 h-10 rounded-xl text-xs";
  if (url) {
    return <img src={url} alt="" className={cn("chat-avatar object-cover shrink-0", dim)} />;
  }
  return (
    <div className={cn("chat-avatar flex items-center justify-center shrink-0 font-black", dim)}>
      {name[0]?.toUpperCase() || "?"}
    </div>
  );
}

function RoleChip({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize",
        roleColors[role] || "bg-white/5 text-[#78788c] border-white/10",
      )}
    >
      {role.replace(/_/g, " ")}
    </span>
  );
}

function previewOf(m: ChatMessage): string {
  if (m.deletedAt) return "This message was deleted";
  const att = m.attachments?.[0];
  if (att && !m.content) return `📎 ${att.name}`;
  return m.content || (att ? `📎 ${att.name}` : "");
}

function mapRealtimeMessage(raw: Record<string, unknown>): ChatMessage {
  return {
    id: String(raw.id),
    senderId: String(raw.sender_id),
    receiverId: raw.receiver_id ? String(raw.receiver_id) : null,
    content: raw.deleted_at ? "Message deleted" : String(raw.content || ""),
    isRead: Boolean(raw.is_read),
    createdAt: String(raw.created_at),
    replyToId: (raw.reply_to_id as string) || null,
    deletedAt: (raw.deleted_at as string) || null,
    conversationId: (raw.conversation_id as string) || null,
    attachments: [],
  };
}

function contactKey(c: ChatContact) {
  return c.conversationId || c.userId;
}

function samePeer(a: ChatContact, b: ChatContact) {
  if (a.conversationId && b.conversationId && a.conversationId === b.conversationId) return true;
  return a.userId === b.userId;
}

export default function ChatPage({ userRole }: { userRole?: string }) {
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["message"]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [canCreateGroup, setCanCreateGroup] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** True after the first contacts fetch settles — live/realtime refreshes must not flip loading. */
  const contactsLoadedRef = useRef(false);

  const reloadContacts = async () => {
    if (!ctx) return [] as ChatContact[];
    const list = await MessageService.listContacts(ctx);
    setContacts(list);
    setSelectedContact((prev) => {
      if (!prev) return prev;
      return list.find((c) => samePeer(c, prev)) ?? prev;
    });
    return list;
  };

  useEffect(() => {
    if (!user || !ready || !ctx) return;
    let cancelled = false;
    // liveVersion (AcademicLive message bumps / focus / poll) re-runs this effect.
    // Only show the full-page spinner on the genuine first load — never wipe an already-rendered list.
    const isFirstLoad = !contactsLoadedRef.current;
    (async () => {
      if (isFirstLoad) setLoading(true);
      try {
        const [list, allowed] = await Promise.all([
          MessageService.listContacts(ctx),
          MessageService.canCreateClassGroup(ctx),
        ]);
        if (!cancelled) {
          setContacts(list);
          setCanCreateGroup(allowed);
        }
      } catch (e) {
        if (!cancelled) {
          setContacts([]);
          setCanCreateGroup(false);
          toast.error(e instanceof Error ? e.message : "Could not load contacts");
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
  }, [user, ready, ctx, liveVersion]);

  useEffect(() => {
    if (!user || !ready || !ctx || !selectedContact) return;
    let cancelled = false;
    (async () => {
      try {
        const thread = await MessageService.listThread(
          ctx,
          selectedContact.userId,
          selectedContact.conversationId,
        );
        if (cancelled) return;
        setMessages(thread);
        setContacts((prev) =>
          prev.map((c) => (contactKey(c) === contactKey(selectedContact) ? { ...c, unread: 0 } : c)),
        );
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not load messages");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, ready, ctx, selectedContact, liveVersion]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("chat_messages_student")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const raw = (payload.new || payload.old) as Record<string, unknown> | undefined;
        if (!raw?.id || payload.eventType === "DELETE") return;

        const newMsg = mapRealtimeMessage(raw);
        const open = selectedContact;
        const inOpenThread = open
          ? open.conversationId
            ? newMsg.conversationId === open.conversationId
            : !newMsg.conversationId &&
              ((newMsg.senderId === user.id && newMsg.receiverId === open.userId) ||
                (newMsg.senderId === open.userId && newMsg.receiverId === user.id))
          : false;

        if (inOpenThread) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === newMsg.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...newMsg, attachments: next[idx].attachments };
              return next;
            }
            return [...prev, newMsg];
          });
          if (ctx && open?.conversationId) {
            void MessageService.markConversationRead(ctx, open.conversationId);
          } else if (ctx && open && newMsg.receiverId === user.id) {
            void MessageService.markThreadRead(ctx, open.userId);
          }
        } else if (newMsg.senderId !== user.id && !newMsg.deletedAt) {
          setContacts((prev) =>
            prev.map((c) => {
              const match = newMsg.conversationId
                ? c.conversationId === newMsg.conversationId
                : c.kind !== "class_group" &&
                  c.kind !== "teacher_group" &&
                  c.userId === newMsg.senderId;
              if (!match) return c;
              return {
                ...c,
                unread: c.unread + 1,
                lastMessage: previewOf(newMsg),
                lastTime: newMsg.createdAt,
              };
            }),
          );
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, selectedContact, ctx]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const applySentToContact = (data: ChatMessage, peer: ChatContact, preview: string) => {
    const convId = data.conversationId || peer.conversationId;
    const next: ChatContact = {
      ...peer,
      conversationId: convId || peer.conversationId,
      lastMessage: `You: ${preview}`,
      lastTime: data.createdAt,
    };
    setSelectedContact((prev) => (prev && samePeer(prev, peer) ? next : prev));
    setContacts((prev) => {
      const others = prev.filter((c) => !samePeer(c, peer));
      return [next, ...others];
    });
  };

  const openNewChatWith = async (contact: ChatContact) => {
    if (!ctx) return;
    setStartingChat(true);
    try {
      let next = contact;
      if (contact.kind !== "class_group" && contact.kind !== "teacher_group") {
        const ensured = await MessageService.ensureDm(ctx, contact.userId);
        next = {
          ...contact,
          ...ensured,
          name: contact.name || ensured.name,
          role: contact.role || ensured.role,
          kind: "dm",
        };
        setContacts((prev) => {
          const others = prev.filter((c) => !samePeer(c, contact));
          return [next, ...others];
        });
      }
      setSelectedContact(next);
      setReplyTo(null);
      setShowEmoji(false);
      setSearch("");
      setShowNewChat(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open chat");
    } finally {
      setStartingChat(false);
    }
  };

  const sendText = async () => {
    if (!ctx || !selectedContact || !newMessage.trim()) return;
    setSending(true);
    try {
      const data = await MessageService.send(ctx, selectedContact.userId, newMessage, {
        conversationId: selectedContact.conversationId,
        replyToId: replyTo?.id,
      });
      setMessages((prev) => (prev.find((m) => m.id === data.id) ? prev : [...prev, data]));
      setNewMessage("");
      setReplyTo(null);
      setShowEmoji(false);
      applySentToContact(data, selectedContact, previewOf(data));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const onPickFile = async (file: File | null) => {
    if (!file || !ctx || !selectedContact) return;
    setSending(true);
    try {
      const data = await MessageService.sendFile(ctx, {
        receiverId: selectedContact.userId,
        file,
        conversationId: selectedContact.conversationId,
        caption: newMessage.trim() || undefined,
        replyToId: replyTo?.id,
      });
      setMessages((prev) => (prev.find((m) => m.id === data.id) ? prev : [...prev, data]));
      setNewMessage("");
      setReplyTo(null);
      applySentToContact(data, selectedContact, previewOf(data));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send file");
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDelete = async (m: ChatMessage) => {
    if (!ctx || m.senderId !== user?.id || m.deletedAt) return;
    try {
      await MessageService.deleteMessage(ctx, m.id);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? { ...x, deletedAt: new Date().toISOString(), content: "Message deleted", attachments: [] }
            : x,
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete message");
    }
  };

  const onCreateTeacherGroup = async () => {
    if (!ctx || !canCreateGroup) return;
    setCreatingGroup(true);
    try {
      const group = await MessageService.createTeacherGroup(ctx);
      await reloadContacts();
      setSelectedContact(group);
      toast.success("Teacher Group ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create Teacher Group");
    } finally {
      setCreatingGroup(false);
    }
  };

  const onCreateClassGroup = async () => {
    if (!ctx || !canCreateGroup) return;
    setCreatingGroup(true);
    try {
      const group = await MessageService.createClassGroup(ctx);
      await reloadContacts();
      setSelectedContact(group);
      toast.success("Class Group ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create Class Group");
    } finally {
      setCreatingGroup(false);
    }
  };

  const filtered = MessageService.searchContacts(contacts, search);
  const showMobileChat = !!selectedContact;

  // Keep list mounted once we have contacts even if a stray loading flip occurs.
  if (!ready || (loading && !contactsLoadedRef.current)) {
    return (
      <div className="chat-panel flex items-center justify-center py-16 text-sm text-[#78788c] gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading conversations…
      </div>
    );
  }

  return (
    <div className="chat-panel space-y-4 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
            {userRole === "teacher" ? "Class Messages" : userRole === "principal" ? "School Messages" : "Chat"}
          </h1>
          <p className="text-xs text-[#78788c] mt-0.5">
            {userRole === "teacher"
              ? "Share announcements, practice links, recovery reminders, and quick guidance with students and families."
              : userRole === "parent"
                ? "Message teachers and school staff about your child."
                : "Connect with teachers, classmates, and school staff."}
          </p>
        </div>
        {canCreateGroup && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={creatingGroup}
              onClick={() => void onCreateClassGroup()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 text-white text-xs font-bold px-3.5 py-2.5 disabled:opacity-40 transition-all"
            >
              <Users className="w-3.5 h-3.5 text-teal-400" />
              {creatingGroup ? "Creating…" : "Class Group"}
            </button>
            {(userRole === "teacher" || userRole === "principal" || userRole === "admin") && (
              <button
                type="button"
                disabled={creatingGroup}
                onClick={() => void onCreateTeacherGroup()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 text-white text-xs font-bold px-3.5 py-2.5 disabled:opacity-40 transition-all"
              >
                <Users className="w-3.5 h-3.5 text-amber-400" />
                Teacher Group
              </button>
            )}
          </div>
        )}
      </div>

      <div className="chat-shell rounded-2xl overflow-hidden flex flex-col md:flex-row min-h-[calc(100vh-14rem)] md:min-h-[32rem]">
        <aside
          className={cn(
            "chat-sidebar w-full md:w-[320px] shrink-0 flex flex-col relative",
            showMobileChat && "hidden md:flex",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/7">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#3b5bdb]" />
              <div className="text-sm font-bold text-white">Chats</div>
            </div>
            <button
              type="button"
              onClick={() => setShowNewChat(true)}
              title="New chat"
              className="w-7 h-7 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb] flex items-center justify-center hover:bg-[#3b5bdb]/25 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="p-3 border-b border-white/7">
            <div className="chat-search flex items-center gap-2 rounded-xl px-3 py-2">
              <Search className="w-3.5 h-3.5 text-[#46465a] shrink-0" />
              <input
                placeholder="Search chats…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {filtered.map((c) => {
              const active = selectedContact && contactKey(selectedContact) === contactKey(c);
              return (
                <button
                  key={contactKey(c)}
                  type="button"
                  onClick={() => {
                    setSelectedContact(c);
                    setReplyTo(null);
                    setShowEmoji(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 transition-all hover:bg-white/[0.03]",
                    active && "chat-contact-active border-r-2 border-[#3b5bdb]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {c.kind === "class_group" || c.kind === "teacher_group" ? (
                      <div className="chat-avatar w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                    ) : (
                      <Avatar name={c.name} url={c.avatarUrl} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs truncate text-white">{c.name}</span>
                        {c.lastTime && (
                          <span className="text-[9px] text-[#46465a] shrink-0 tabular-nums">
                            {formatTime(c.lastTime)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        {c.lastMessage ? (
                          <span className="text-[10px] text-[#78788c] truncate">{c.lastMessage}</span>
                        ) : (
                          <span className="text-[10px] text-[#46465a] italic">No messages yet</span>
                        )}
                        {c.unread > 0 && (
                          <span className="shrink-0 min-w-[1.1rem] h-4 px-1 rounded-full bg-[#3b5bdb] text-white text-[9px] flex items-center justify-center font-black">
                            {c.unread > 9 ? "9+" : c.unread}
                          </span>
                        )}
                      </div>
                      <RoleChip role={c.role} />
                    </div>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="p-8 text-center">
                <MessageSquare className="w-8 h-8 mx-auto text-[#46465a] mb-2 opacity-60" />
                <p className="text-xs text-[#78788c] mb-3">
                  {contacts.length === 0
                    ? "No conversations yet. Start a new chat."
                    : "No chats match your search."}
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewChat(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#3b5bdb]/15 text-[#818cf8] hover:bg-[#3b5bdb]/25 text-[11px] font-bold px-3 py-2 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New chat
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className={cn("flex-1 flex flex-col min-w-0 chat-thread-bg", !showMobileChat && "hidden md:flex")}>
          {selectedContact ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/7 bg-[#131316]/80">
                <button
                  type="button"
                  className="md:hidden shrink-0 w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white"
                  onClick={() => setSelectedContact(null)}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                {selectedContact.kind === "class_group" || selectedContact.kind === "teacher_group" ? (
                  <div className="chat-avatar w-9 h-9 rounded-xl flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                ) : (
                  <Avatar name={selectedContact.name} url={selectedContact.avatarUrl} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate text-white">{selectedContact.name}</p>
                  <RoleChip role={selectedContact.role} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {messages.length === 0 && (
                  <div className="chat-empty-state flex flex-col items-center justify-center h-full py-16 text-center">
                    <MessageSquare className="w-10 h-10 text-[#3b5bdb]/40 mb-3" />
                    <p className="font-bold text-sm text-white">Start the conversation</p>
                    <p className="text-xs text-[#78788c] mt-1">
                      Send a message to {selectedContact.name}
                    </p>
                  </div>
                )}
                {messages.map((m) => {
                  const isMine = m.senderId === user!.id;
                  const deleted = Boolean(m.deletedAt);
                  const attachments = m.attachments ?? [];
                  return (
                    <div key={m.id} className={cn("flex group", isMine ? "justify-end" : "justify-start")}>
                      <div className="relative max-w-[80%] sm:max-w-[70%]">
                        <div
                          className={cn(
                            "rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                            deleted
                              ? "bg-white/5 text-[#46465a] italic"
                              : isMine
                                ? "chat-bubble-mine rounded-br-md"
                                : "chat-bubble-theirs rounded-bl-md",
                          )}
                        >
                          {!deleted && m.replyToId && (
                            <div
                              className={cn(
                                "mb-2 rounded-lg px-2.5 py-1.5 text-[10px] border-l-2",
                                isMine
                                  ? "bg-white/10 border-white/40 text-white/80"
                                  : "bg-black/20 border-[#3b5bdb]/50 text-[#78788c]",
                              )}
                            >
                              {m.replyPreview || "Reply"}
                            </div>
                          )}
                          {deleted ? (
                            <p>This message was deleted</p>
                          ) : (
                            <>
                              {attachments.map((att) => (
                                <div key={att.id || att.url} className="mb-2">
                                  {isImageMime(att.mimeType, att.name) ? (
                                    <a href={att.url} target="_blank" rel="noreferrer">
                                      <img
                                        src={att.url}
                                        alt={att.name}
                                        className="max-h-48 rounded-xl object-contain border border-white/10"
                                      />
                                    </a>
                                  ) : (
                                    <a
                                      href={att.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={cn(
                                        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-medium",
                                        isMine ? "bg-white/15" : "bg-white/5 border border-white/10",
                                      )}
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                      <span className="truncate max-w-[12rem]">{att.name}</span>
                                    </a>
                                  )}
                                </div>
                              ))}
                              {m.content && m.content !== "Message deleted" && (
                                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                              )}
                            </>
                          )}
                          <div
                            className={cn(
                              "text-[9px] mt-1.5 tabular-nums flex items-center gap-1",
                              isMine && !deleted ? "text-white/60 justify-end" : "text-[#46465a]",
                            )}
                          >
                            {new Date(m.createdAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {isMine && !deleted && (
                              m.isRead ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />
                            )}
                          </div>
                        </div>
                        {!deleted && (
                          <div
                            className={cn(
                              "absolute -top-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5",
                              isMine ? "left-0 -translate-x-full pr-1" : "right-0 translate-x-full pl-1",
                            )}
                          >
                            <button
                              type="button"
                              title="Reply"
                              className="w-7 h-7 rounded-lg bg-[#131316] border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white"
                              onClick={() => setReplyTo(m)}
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            {isMine && (
                              <button
                                type="button"
                                title="Delete"
                                className="w-7 h-7 rounded-lg bg-[#131316] border border-white/10 flex items-center justify-center text-[#78788c] hover:text-[#cc5069]"
                                onClick={() => void onDelete(m)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {replyTo && (
                <div className="px-4 pt-3 flex items-center gap-2 border-t border-white/7 bg-[#131316]/90">
                  <div className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-[10px] text-[#78788c] truncate">
                    <span className="font-bold text-white">Replying · </span>
                    {previewOf(replyTo).slice(0, 100) || "Message"}
                  </div>
                  <button
                    type="button"
                    className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white shrink-0"
                    onClick={() => setReplyTo(null)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {showEmoji && (
                <div className="px-4 pt-2 flex flex-wrap gap-1 border-t border-white/5 bg-[#131316]/90">
                  {EMOJI_QUICK.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="w-9 h-9 rounded-lg hover:bg-white/5 text-lg"
                      onClick={() => {
                        setNewMessage((prev) => prev + e);
                        setShowEmoji(false);
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}

              <div className="chat-composer p-3 sm:p-4 flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CHAT_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setShowEmoji((v) => !v)}
                  title="Emoji"
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white disabled:opacity-40 shrink-0"
                >
                  <Smile className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach image or document"
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white disabled:opacity-40 shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <div className="flex-1 flex items-end gap-2 bg-white/5 border border-white/10 rounded-2xl px-3 py-2 focus-within:border-[#3b5bdb]/40 transition-all">
                  <input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendText();
                      }
                    }}
                    placeholder="Type a message…"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-[#46465a] outline-none min-h-[24px] py-1"
                  />
                  <button
                    type="button"
                    onClick={() => void sendText()}
                    disabled={sending || !newMessage.trim()}
                    className="w-9 h-9 rounded-xl bg-[#3b5bdb] text-white flex items-center justify-center disabled:opacity-40 shrink-0 hover:bg-[#6882e8] transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="chat-empty-state flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#3b5bdb]/15 border border-[#3b5bdb]/25 flex items-center justify-center mb-4">
                <MessageSquare className="w-7 h-7 text-[#818cf8]" />
              </div>
              <p className="font-bold text-base text-white">Select a conversation</p>
              <p className="text-xs text-[#78788c] mt-2 max-w-xs">
                Choose a contact from the list, or tap New chat to message a classmate, teacher, or principal.
              </p>
              <button
                type="button"
                onClick={() => setShowNewChat(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#3b5bdb] hover:bg-[#6882e8] text-white text-xs font-bold px-4 py-2.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New chat
              </button>
            </div>
          )}
        </main>
      </div>

      <NewChatSheet
        open={showNewChat}
        onClose={() => {
          if (!startingChat) setShowNewChat(false);
        }}
        contacts={contacts}
        busy={startingChat}
        onSelect={(peer) => void openNewChatWith(peer)}
      />
    </div>
  );
}