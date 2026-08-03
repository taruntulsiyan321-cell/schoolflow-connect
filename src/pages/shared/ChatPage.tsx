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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { toast } from "sonner";
import "@/components/chat/chat-panel.css";

const CHAT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.txt,image/*,application/pdf";

const roleColors: Record<string, string> = {
  admin: "bg-red-500/10 text-red-700 border-red-500/20",
  principal: "bg-purple-500/10 text-purple-700 border-purple-500/20",
  teacher: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  student: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  parent: "bg-amber-500/10 text-amber-800 border-amber-500/20",
  class_group: "bg-teal-500/10 text-teal-700 border-teal-500/20",
  teacher_group: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20",
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
  const dim = size === "sm" ? "w-10 h-10 rounded-xl text-sm" : "w-11 h-11 rounded-2xl text-sm";
  if (url) {
    return <img src={url} alt="" className={cn("chat-avatar object-cover shrink-0 shadow-sm", dim)} />;
  }
  return (
    <div className={cn("chat-avatar flex items-center justify-center shrink-0 font-semibold shadow-sm", dim)}>
      {name[0]?.toUpperCase() || "?"}
    </div>
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reloadContacts = async () => {
    if (!ctx) return;
    const list = await MessageService.listContacts(ctx);
    setContacts(list);
    setSelectedContact((prev) => {
      if (!prev) return prev;
      return list.find((c) => contactKey(c) === contactKey(prev)) ?? prev;
    });
  };

  useEffect(() => {
    if (!user || !ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
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
        if (!cancelled) setLoading(false);
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
      setContacts((prev) =>
        prev.map((c) =>
          contactKey(c) === contactKey(selectedContact)
            ? { ...c, lastMessage: `You: ${previewOf(data)}`, lastTime: data.createdAt }
            : c,
        ),
      );
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
      setContacts((prev) =>
        prev.map((c) =>
          contactKey(c) === contactKey(selectedContact)
            ? { ...c, lastMessage: `You: ${previewOf(data)}`, lastTime: data.createdAt }
            : c,
        ),
      );
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

  if (loading || !ready) {
    return (
      <div className="chat-panel max-w-5xl mx-auto py-12 text-center text-muted-foreground">
        Loading conversations…
      </div>
    );
  }

  return (
    <div className="chat-panel max-w-5xl mx-auto pb-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">Messages</p>
          <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold text-foreground mt-1 tracking-tight">
            {userRole === "teacher" ? "Class Messages" : userRole === "principal" ? "School Messages" : "Chat"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {userRole === "teacher"
              ? "Share announcements, practice links, recovery reminders, and quick guidance with students and families."
              : "Connect with teachers, classmates, and school staff."}
          </p>
        </div>
        {canCreateGroup && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl h-10 gap-2"
              disabled={creatingGroup}
              onClick={() => void onCreateClassGroup()}
            >
              <Users className="w-4 h-4" />
              {creatingGroup ? "Creating…" : "Class Group"}
            </Button>
            {(userRole === "teacher" || userRole === "principal" || userRole === "admin") && (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl h-10 gap-2"
                disabled={creatingGroup}
                onClick={() => void onCreateTeacherGroup()}
              >
                <Users className="w-4 h-4" />
                Teacher Group
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="chat-shell rounded-[1.75rem] overflow-hidden flex flex-col md:flex-row min-h-[calc(100vh-14rem)] md:min-h-[32rem]">
        <aside
          className={cn(
            "chat-sidebar w-full md:w-[340px] shrink-0 flex flex-col",
            showMobileChat && "hidden md:flex",
          )}
        >
          <div className="p-4 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search chats…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl bg-white border-border/60 h-11"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {filtered.map((c) => (
              <button
                key={contactKey(c)}
                type="button"
                onClick={() => {
                  setSelectedContact(c);
                  setReplyTo(null);
                  setShowEmoji(false);
                }}
                className={cn(
                  "w-full text-left rounded-2xl border border-transparent p-3 sm:p-4 transition-all hover:bg-white/80",
                  selectedContact && contactKey(selectedContact) === contactKey(c) && "chat-contact-active border",
                )}
              >
                <div className="flex items-center gap-3">
                  {c.kind === "class_group" || c.kind === "teacher_group" ? (
                    <div className="chat-avatar w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                      <Users className="w-5 h-5" />
                    </div>
                  ) : (
                    <Avatar name={c.name} url={c.avatarUrl} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate text-foreground">{c.name}</span>
                      {c.lastTime && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatTime(c.lastTime)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      {c.lastMessage ? (
                        <span className="text-xs text-muted-foreground truncate">{c.lastMessage}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No messages yet</span>
                      )}
                      {c.unread > 0 && (
                        <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("mt-2 text-[10px] capitalize", roleColors[c.role] || "")}
                    >
                      {c.role.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-8 text-center">
                <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  {contacts.length === 0 ? "No contacts available." : "No chats match your search."}
                </p>
              </div>
            )}
          </div>
        </aside>

        <main className={cn("flex-1 flex flex-col min-w-0 bg-white", !showMobileChat && "hidden md:flex")}>
          {selectedContact ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-gradient-to-r from-[#f4fff8] to-white">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden shrink-0 rounded-xl"
                  onClick={() => setSelectedContact(null)}
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                {selectedContact.kind === "class_group" || selectedContact.kind === "teacher_group" ? (
                  <div className="chat-avatar w-10 h-10 rounded-xl flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                ) : (
                  <Avatar name={selectedContact.name} url={selectedContact.avatarUrl} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{selectedContact.name}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] capitalize mt-0.5",
                      roleColors[selectedContact.role] || "",
                    )}
                  >
                    {selectedContact.role.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#fafefb]/50">
                {messages.length === 0 && (
                  <div className="chat-empty-state flex flex-col items-center justify-center h-full py-16 text-center">
                    <MessageSquare className="w-12 h-12 text-primary/30 mb-3" />
                    <p className="font-medium text-foreground">Start the conversation</p>
                    <p className="text-sm text-muted-foreground mt-1">
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
                            "rounded-2xl px-4 py-2.5 text-sm",
                            deleted
                              ? "bg-muted/60 text-muted-foreground italic rounded-2xl"
                              : isMine
                                ? "chat-bubble-mine text-primary-foreground rounded-br-md"
                                : "chat-bubble-theirs rounded-bl-md text-foreground",
                          )}
                        >
                          {!deleted && m.replyToId && (
                            <div
                              className={cn(
                                "mb-2 rounded-lg px-2.5 py-1.5 text-[11px] border-l-2",
                                isMine
                                  ? "bg-white/10 border-white/40 text-primary-foreground/80"
                                  : "bg-black/5 border-primary/40 text-muted-foreground",
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
                                        className="max-h-48 rounded-xl object-contain border border-white/20"
                                      />
                                    </a>
                                  ) : (
                                    <a
                                      href={att.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={cn(
                                        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium",
                                        isMine ? "bg-white/15" : "bg-black/5",
                                      )}
                                    >
                                      <FileText className="w-4 h-4" />
                                      <span className="truncate max-w-[12rem]">{att.name}</span>
                                    </a>
                                  )}
                                </div>
                              ))}
                              {m.content && m.content !== "Message deleted" && (
                                <p className="leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
                              )}
                            </>
                          )}
                          <div
                            className={cn(
                              "text-[10px] mt-1.5 tabular-nums flex items-center gap-1",
                              isMine && !deleted
                                ? "text-primary-foreground/60 justify-end"
                                : "text-muted-foreground",
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
                              className="w-7 h-7 rounded-lg bg-white border border-border/60 shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground"
                              onClick={() => setReplyTo(m)}
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            {isMine && (
                              <button
                                type="button"
                                title="Delete"
                                className="w-7 h-7 rounded-lg bg-white border border-border/60 shadow-sm flex items-center justify-center text-muted-foreground hover:text-red-600"
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
                <div className="px-4 pt-3 flex items-center gap-2 border-t border-border/30 bg-white">
                  <div className="flex-1 rounded-xl bg-[#f4fff8] border border-border/40 px-3 py-2 text-xs text-muted-foreground truncate">
                    <span className="font-semibold text-foreground">Replying · </span>
                    {previewOf(replyTo).slice(0, 100) || "Message"}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="rounded-xl shrink-0"
                    onClick={() => setReplyTo(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {showEmoji && (
                <div className="px-4 pt-2 flex flex-wrap gap-1 border-t border-border/20 bg-white">
                  {EMOJI_QUICK.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="w-9 h-9 rounded-lg hover:bg-[#f4fff8] text-lg"
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

              <div className="chat-composer p-4 flex gap-2 rounded-b-[1.75rem]">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CHAT_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="rounded-xl h-11 w-11 shrink-0"
                  disabled={sending}
                  onClick={() => setShowEmoji((v) => !v)}
                  title="Emoji"
                >
                  <Smile className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="rounded-xl h-11 w-11 shrink-0"
                  disabled={sending}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach image or document"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendText();
                    }
                  }}
                  placeholder="Type a message…"
                  className="flex-1 rounded-xl h-11 border-border/60 bg-[#fafefb]"
                />
                <Button
                  onClick={() => void sendText()}
                  disabled={sending || !newMessage.trim()}
                  className="rounded-xl h-11 px-4 bg-gradient-primary text-primary-foreground shadow-md"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="chat-empty-state flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <p className="font-semibold text-lg text-foreground">Select a conversation</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs">
                Choose a contact from the list to view messages and start chatting.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
