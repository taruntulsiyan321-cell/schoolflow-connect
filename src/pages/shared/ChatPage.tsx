import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MessageSquare, Send, ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";
import "@/components/chat/chat-panel.css";

interface Contact {
  user_id: string;
  name: string;
  role: string;
  unread: number;
  lastMessage?: string;
  lastTime?: string;
}

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

const roleColors: Record<string, string> = {
  admin: "bg-red-500/10 text-red-700 border-red-500/20",
  principal: "bg-purple-500/10 text-purple-700 border-purple-500/20",
  teacher: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  student: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  parent: "bg-amber-500/10 text-amber-800 border-amber-500/20",
};

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function ChatPage({ userRole }: { userRole?: string }) {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const contactList: Contact[] = [];
      const { data: allowedUsers } = await supabase.rpc("get_chat_contacts" as any);

      (allowedUsers ?? []).forEach((u: any) => {
        contactList.push({
          user_id: u.user_id,
          name: u.name || "Unknown",
          role: u.role || "user",
          unread: 0,
        });
      });

      if (contactList.length > 0) {
        const { data: received } = await supabase
          .from("messages")
          .select("sender_id, is_read, content, created_at")
          .eq("receiver_id", user.id)
          .order("created_at", { ascending: false });

        received?.forEach((m) => {
          const contact = contactList.find((c) => c.user_id === m.sender_id);
          if (contact) {
            if (!m.is_read) contact.unread += 1;
            if (!contact.lastMessage) {
              contact.lastMessage = m.content;
              contact.lastTime = m.created_at;
            }
          }
        });

        const { data: sent } = await supabase
          .from("messages")
          .select("receiver_id, content, created_at")
          .eq("sender_id", user.id)
          .order("created_at", { ascending: false });

        sent?.forEach((m) => {
          const contact = contactList.find((c) => c.user_id === m.receiver_id);
          if (contact && (!contact.lastTime || m.created_at > contact.lastTime)) {
            contact.lastMessage = `You: ${m.content}`;
            contact.lastTime = m.created_at;
          }
        });
      }

      contactList.sort((a, b) => {
        if (a.unread !== b.unread) return b.unread - a.unread;
        return (b.lastTime || "") > (a.lastTime || "") ? 1 : -1;
      });

      setContacts(contactList);
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    if (!user || !selectedContact) return;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${selectedContact.user_id}),and(sender_id.eq.${selectedContact.user_id},receiver_id.eq.${user.id})`,
        )
        .order("created_at", { ascending: true });
      setMessages(data ?? []);

      await supabase
        .from("messages")
        .update({ is_read: true })
        .eq("sender_id", selectedContact.user_id)
        .eq("receiver_id", user.id)
        .eq("is_read", false);

      setContacts((prev) =>
        prev.map((c) => (c.user_id === selectedContact.user_id ? { ...c, unread: 0 } : c)),
      );
    })();
  }, [user, selectedContact]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("chat_messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const newMsg = payload.new as Message;

        if (
          selectedContact &&
          ((newMsg.sender_id === user.id && newMsg.receiver_id === selectedContact.user_id) ||
            (newMsg.sender_id === selectedContact.user_id && newMsg.receiver_id === user.id))
        ) {
          setMessages((prev) => {
            if (prev.find((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          if (newMsg.receiver_id === user.id) {
            supabase.from("messages").update({ is_read: true }).eq("id", newMsg.id).then();
          }
        } else if (newMsg.receiver_id === user.id) {
          setContacts((prev) =>
            prev.map((c) =>
              c.user_id === newMsg.sender_id
                ? { ...c, unread: c.unread + 1, lastMessage: newMsg.content, lastTime: newMsg.created_at }
                : c,
            ),
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, selectedContact]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!user || !selectedContact || !newMessage.trim()) return;
    setSending(true);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        sender_id: user.id,
        receiver_id: selectedContact.user_id,
        content: newMessage.trim(),
      })
      .select()
      .single();

    if (error) {
      toast.error(error.message);
    } else if (data) {
      setMessages((prev) => [...prev, data]);
      setNewMessage("");
      setContacts((prev) =>
        prev.map((c) =>
          c.user_id === selectedContact.user_id
            ? { ...c, lastMessage: `You: ${data.content}`, lastTime: data.created_at }
            : c,
        ),
      );
    }
    setSending(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const filtered = contacts.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.role.includes(search.toLowerCase()),
  );

  const showMobileChat = !!selectedContact;

  const ContactRow = ({ c, compact }: { c: Contact; compact?: boolean }) => (
    <button
      type="button"
      onClick={() => setSelectedContact(c)}
      className={cn(
        "w-full text-left rounded-2xl border border-transparent p-3 sm:p-4 transition-all hover:bg-white/80",
        selectedContact?.user_id === c.user_id && "chat-contact-active border",
        compact && "p-3",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="chat-avatar w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 font-semibold text-sm shadow-sm">
          {c.name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm truncate text-foreground">{c.name}</span>
            {c.lastTime && (
              <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(c.lastTime)}</span>
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
            {c.role}
          </Badge>
        </div>
      </div>
    </button>
  );

  if (loading) {
    return (
      <div className="chat-panel max-w-5xl mx-auto py-12 text-center text-muted-foreground">
        Loading conversations…
      </div>
    );
  }

  return (
    <div className="chat-panel max-w-5xl mx-auto pb-6">
      {/* Header */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">Messages</p>
        <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold text-foreground mt-1 tracking-tight">
          {userRole === "teacher" ? "Class Messages" : "Chat"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {userRole === "teacher"
            ? "Share announcements, practice links, recovery reminders, and quick guidance with students and families."
            : "Connect with teachers, classmates, and school staff."}
        </p>
      </div>

      <div className="chat-shell rounded-[1.75rem] overflow-hidden flex flex-col md:flex-row min-h-[calc(100vh-14rem)] md:min-h-[32rem]">
        {/* Sidebar — contacts */}
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
                placeholder="Search contacts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl bg-white border-border/60 h-11"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {filtered.map((c) => (
              <ContactRow key={c.user_id} c={c} />
            ))}
            {filtered.length === 0 && (
              <div className="p-8 text-center">
                <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  {contacts.length === 0 ? "No contacts available." : "No contacts match your search."}
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Main — conversation */}
        <main
          className={cn(
            "flex-1 flex flex-col min-w-0 bg-white",
            !showMobileChat && "hidden md:flex",
          )}
        >
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
                <div className="chat-avatar w-10 h-10 rounded-xl flex items-center justify-center font-semibold text-sm">
                  {selectedContact.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{selectedContact.name}</p>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] capitalize mt-0.5", roleColors[selectedContact.role] || "")}
                  >
                    {selectedContact.role}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#fafefb]/50">
                {messages.length === 0 && (
                  <div className="chat-empty-state flex flex-col items-center justify-center h-full py-16 text-center">
                    <MessageSquare className="w-12 h-12 text-primary/30 mb-3" />
                    <p className="font-medium text-foreground">Start the conversation</p>
                    <p className="text-sm text-muted-foreground mt-1">Send a message to {selectedContact.name}</p>
                  </div>
                )}
                {messages.map((m) => {
                  const isMine = m.sender_id === user!.id;
                  return (
                    <div key={m.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm",
                          isMine
                            ? "chat-bubble-mine text-primary-foreground rounded-br-md"
                            : "chat-bubble-theirs rounded-bl-md text-foreground",
                        )}
                      >
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
                        <div
                          className={cn(
                            "text-[10px] mt-1.5 tabular-nums",
                            isMine ? "text-primary-foreground/60 text-right" : "text-muted-foreground",
                          )}
                        >
                          {new Date(m.created_at).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-composer p-4 flex gap-2 rounded-b-[1.75rem]">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Type a message…"
                  className="flex-1 rounded-xl h-11 border-border/60 bg-[#fafefb]"
                />
                <Button
                  onClick={sendMessage}
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
