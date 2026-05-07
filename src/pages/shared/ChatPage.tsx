import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui-bits";
import { MessageSquare, Send, ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";

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

  // Load contacts based on role
  useEffect(() => {
    if (!user) return;
    (async () => {
      const contactList: Contact[] = [];

      // Get all users with roles that this user can communicate with
      const { data: allUsers } = await supabase.rpc("admin_list_users_with_roles");

      (allUsers ?? []).forEach((u: any) => {
        if (u.user_id === user.id) return; // Skip self
        const roles = u.roles ?? [];
        // Include relevant contacts based on current user's role
        const isRelevant =
          roles.includes("teacher") ||
          roles.includes("student") ||
          roles.includes("parent") ||
          roles.includes("admin") ||
          roles.includes("principal");
        if (isRelevant) {
          contactList.push({
            user_id: u.user_id,
            name: u.email || u.phone || "Unknown",
            role: roles[0] || "user",
            unread: 0,
          });
        }
      });

      // Also fetch profile names
      if (contactList.length > 0) {
        const ids = contactList.map((c) => c.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        profiles?.forEach((p) => {
          const contact = contactList.find((c) => c.user_id === p.id);
          if (contact && p.full_name) contact.name = p.full_name;
        });

        // Get unread counts and last messages
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

        // Also check last sent messages
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

      // Sort: unread first, then by last message time
      contactList.sort((a, b) => {
        if (a.unread !== b.unread) return b.unread - a.unread;
        return (b.lastTime || "") > (a.lastTime || "") ? 1 : -1;
      });

      setContacts(contactList);
      setLoading(false);
    })();
  }, [user]);

  // Load messages for selected contact
  useEffect(() => {
    if (!user || !selectedContact) return;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${selectedContact.user_id}),and(sender_id.eq.${selectedContact.user_id},receiver_id.eq.${user.id})`
        )
        .order("created_at", { ascending: true });
      setMessages(data ?? []);

      // Mark received messages as read
      await supabase
        .from("messages")
        .update({ is_read: true })
        .eq("sender_id", selectedContact.user_id)
        .eq("receiver_id", user.id)
        .eq("is_read", false);

      // Update unread count in contacts
      setContacts((prev) =>
        prev.map((c) =>
          c.user_id === selectedContact.user_id ? { ...c, unread: 0 } : c
        )
      );
    })();
  }, [user, selectedContact]);

  // Scroll to bottom on new messages
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
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.role.includes(search.toLowerCase())
  );

  const roleColors: Record<string, string> = {
    admin: "bg-red-500/10 text-red-600",
    principal: "bg-purple-500/10 text-purple-600",
    teacher: "bg-blue-500/10 text-blue-600",
    student: "bg-green-500/10 text-green-600",
    parent: "bg-amber-500/10 text-amber-600",
  };

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  // Chat view (messages)
  if (selectedContact) {
    return (
      <div className="flex flex-col h-[calc(100vh-12rem)]">
        {/* Chat header */}
        <div className="flex items-center gap-3 pb-3 border-b border-border mb-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedContact(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="font-semibold text-sm">{selectedContact.name}</div>
            <Badge variant="outline" className={`text-[10px] capitalize ${roleColors[selectedContact.role] || ""}`}>
              {selectedContact.role}
            </Badge>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-3">
          {messages.length === 0 && (
            <p className="text-muted-foreground text-center py-8 text-sm">
              No messages yet. Start a conversation!
            </p>
          )}
          {messages.map((m) => {
            const isMine = m.sender_id === user!.id;
            return (
              <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                    isMine
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  }`}
                >
                  <p>{m.content}</p>
                  <div className={`text-[10px] mt-1 ${isMine ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type a message…"
            className="flex-1"
          />
          <Button
            onClick={sendMessage}
            disabled={sending || !newMessage.trim()}
            className="bg-gradient-primary text-primary-foreground"
            size="sm"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Contacts list view
  return (
    <>
      <PageHeader title="Chat" subtitle="Messages with teachers, students and staff" />

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((c) => (
          <Card
            key={c.user_id}
            className="p-4 cursor-pointer hover:shadow-elevated transition shadow-card"
            onClick={() => setSelectedContact(c)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0 font-bold text-sm">
                  {c.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{c.name}</div>
                  {c.lastMessage && (
                    <div className="text-xs text-muted-foreground truncate">{c.lastMessage}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className={`text-[10px] capitalize ${roleColors[c.role] || ""}`}>
                  {c.role}
                </Badge>
                {c.unread > 0 && (
                  <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                    {c.unread}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card className="p-8 text-center">
            <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              {contacts.length === 0 ? "No contacts available." : "No contacts match your search."}
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
