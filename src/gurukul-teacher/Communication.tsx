import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Send, MessageCircle, Users, ChevronRight, Loader2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { toast } from "sonner";

const roleColor: Record<string, string> = {
  student: "#6366f1",
  parent: "#f59e0b",
  principal: "#cc5069",
  admin: "#10b981",
  teacher: "#3b5bdb",
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
            placeholder="Search…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-[10px] text-[#46465a]">No contacts yet.</div>
        )}
        {filtered.map((t) => (
          <button
            key={t.userId}
            type="button"
            onClick={() => onSelect(t.userId)}
            className={cn(
              "w-full flex items-start gap-3 px-4 py-3 hover:bg-white/3 transition-all text-left",
              selectedId === t.userId && "bg-[#3b5bdb]/5 border-r-2 border-[#3b5bdb]",
            )}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
              style={{
                background: `${roleColor[t.role] ?? "#78788c"}18`,
                color: roleColor[t.role] ?? "#78788c",
              }}
            >
              {teacherInitials(t.name, "?")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-white truncate">{t.name}</div>
                {t.unread > 0 && (
                  <div className="w-4 h-4 rounded-full bg-[#3b5bdb] text-black text-[8px] font-black flex items-center justify-center shrink-0">
                    {t.unread}
                  </div>
                )}
              </div>
              <div className="text-[9px] font-semibold capitalize" style={{ color: roleColor[t.role] ?? "#78788c" }}>
                {t.role}
              </div>
              <div className="text-[10px] text-[#78788c] truncate mt-0.5">{t.lastMessage || "—"}</div>
            </div>
            <div className="text-[8px] text-[#46465a] shrink-0 mt-0.5">{formatTime(t.lastTime)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatView({
  contact,
  messages,
  myName,
  onSend,
  sending,
}: {
  contact: ChatContact;
  messages: ChatMessage[];
  myName: string;
  onSend: (text: string) => Promise<void>;
  sending: boolean;
}) {
  const [input, setInput] = useState("");
  const myInitials = teacherInitials(myName, "T");

  async function send() {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    await onSend(text);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
          style={{
            background: `${roleColor[contact.role] ?? "#78788c"}18`,
            color: roleColor[contact.role] ?? "#78788c",
          }}
        >
          {teacherInitials(contact.name, "?")}
        </div>
        <div>
          <div className="text-sm font-bold text-white">{contact.name}</div>
          <div className="text-[9px] capitalize font-semibold" style={{ color: roleColor[contact.role] ?? "#78788c" }}>
            {contact.role}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => {
          const isMe = m.senderId !== contact.userId;
          return (
            <div key={m.id} className={cn("flex gap-3", isMe && "flex-row-reverse")}>
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center text-[8px] font-black shrink-0"
                style={{
                  background: isMe ? "#f59e0b20" : `${roleColor[contact.role] ?? "#78788c"}18`,
                  color: isMe ? "#f59e0b" : roleColor[contact.role] ?? "#78788c",
                }}
              >
                {isMe ? myInitials : teacherInitials(contact.name, "?")}
              </div>
              <div className={cn("max-w-[70%]", isMe && "text-right")}>
                <div className={cn("text-[8px] font-semibold mb-1", isMe ? "text-[#3b5bdb]" : "text-[#78788c]")}>
                  {isMe ? `${myName} (You)` : contact.name}
                </div>
                <div
                  className={cn(
                    "px-3 py-2 rounded-2xl text-xs leading-relaxed",
                    isMe ? "bg-[#3b5bdb]/15 text-[#fcd34d]" : "bg-white/5 text-[#b0b0c0]",
                  )}
                >
                  {m.content}
                </div>
                <div className="text-[8px] text-[#46465a] mt-1">{formatTime(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t border-white/7">
        <div className="flex items-end gap-2">
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
  const navigate = useNavigate();
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["message"]);
  const identity = useTeacherIdentity();
  const [assignedClasses, setAssignedClasses] = useState<AssignedClass[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ contactId: "", message: "" });

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      if (contacts.length === 0) setLoading(true);
      try {
        const [classes, list] = await Promise.all([
          AttendanceService.listAssignedClasses(ctx),
          MessageService.listContacts(ctx),
        ]);
        if (cancelled) return;
        setAssignedClasses(classes);
        setContacts(list);
        if (!selectedId && list[0]) setSelectedId(list[0].userId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contacts.length gates spinner only
  }, [ready, ctx, liveVersion]);

  useEffect(() => {
    if (!ready || !ctx || !selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const thread = await MessageService.listThread(ctx, selectedId);
        if (!cancelled) {
          setMessages(thread);
          setContacts((prev) =>
            prev.map((c) => (c.userId === selectedId ? { ...c, unread: 0 } : c)),
          );
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not load thread");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, selectedId]);

  useEffect(() => {
    if (!ctx?.userId) return;
    const channel = supabase
      .channel("teacher_chat_messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as {
          id: string;
          sender_id: string;
          receiver_id: string;
          content: string;
          is_read: boolean;
          created_at: string;
        };
        const mapped: ChatMessage = {
          id: row.id,
          senderId: row.sender_id,
          receiverId: row.receiver_id,
          content: row.content,
          isRead: row.is_read,
          createdAt: row.created_at,
        };
        if (
          selectedId &&
          ((mapped.senderId === ctx.userId && mapped.receiverId === selectedId) ||
            (mapped.senderId === selectedId && mapped.receiverId === ctx.userId))
        ) {
          setMessages((prev) => (prev.find((m) => m.id === mapped.id) ? prev : [...prev, mapped]));
          if (mapped.receiverId === ctx.userId) {
            void MessageService.markThreadRead(ctx, mapped.senderId).catch((e) => {
              toast.error(e instanceof Error ? e.message : "Could not mark message read");
            });
          }
        } else if (mapped.receiverId === ctx.userId) {
          setContacts((prev) =>
            prev.map((c) =>
              c.userId === mapped.senderId
                ? {
                    ...c,
                    unread: c.unread + 1,
                    lastMessage: mapped.content,
                    lastTime: mapped.createdAt,
                  }
                : c,
            ),
          );
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ctx, selectedId]);

  const selected = contacts.find((c) => c.userId === selectedId) ?? null;

  async function handleSend(text: string) {
    if (!ctx || !selectedId) return;
    setSending(true);
    try {
      const msg = await MessageService.send(ctx, selectedId, text);
      setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setContacts((prev) =>
        prev.map((c) =>
          c.userId === selectedId
            ? { ...c, lastMessage: `You: ${text}`, lastTime: msg.createdAt }
            : c,
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  async function startNewThread() {
    if (!ctx || !newForm.contactId || !newForm.message.trim()) return;
    setSending(true);
    try {
      await MessageService.send(ctx, newForm.contactId, newForm.message.trim());
      const list = await MessageService.listContacts(ctx);
      setContacts(list);
      setSelectedId(newForm.contactId);
      setShowNew(false);
      setNewForm({ contactId: "", message: "" });
      toast.success("Message sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
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
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="w-7 h-7 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb] flex items-center justify-center hover:bg-[#3b5bdb]/25 transition-all text-base font-bold"
          >
            +
          </button>
        </div>

        <div className="px-4 py-3 border-b border-white/7">
          <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mb-2">Class Broadcasts</div>
          {assignedClasses.length === 0 && (
            <div className="text-[10px] text-[#46465a]">No assigned classes</div>
          )}
          {assignedClasses.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate("/teacher/announcements")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-white/5 transition-all group"
            >
              <Users className="w-3.5 h-3.5 text-[#46465a] group-hover:text-[#3b5bdb] transition-all" />
              <span className="text-[10px] text-[#78788c] group-hover:text-white transition-all">
                {c.name} {c.section} — {c.subject ?? "—"}
              </span>
              <ChevronRight className="w-3 h-3 text-[#46465a] ml-auto" />
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2">
            <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Direct Messages</div>
          </div>
          <ThreadList contacts={contacts} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {selected ? (
          <ChatView
            contact={selected}
            messages={messages}
            myName={identity.name || "Teacher"}
            onSend={handleSend}
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

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNew(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white">New Message</div>
              <button type="button" onClick={() => setShowNew(false)} className="text-[#78788c] hover:text-white text-lg">
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
                {contacts.map((c) => (
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
                onClick={() => setShowNew(false)}
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
