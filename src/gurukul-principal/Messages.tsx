import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Send, MessageSquare, Users, Loader2, Paperclip, Reply, Trash2, Plus,
} from "lucide-react";
import {
  MessageService,
  useAcademicLive,
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
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { NewChatSheet } from "@/components/chat/NewChatSheet";

const roleColor: Record<string, string> = {
  student: "#0ea5a0",
  teacher: "#3b5bdb",
  principal: "#1e3a5f",
  admin: "#10b981",
  class_group: "#0ea5a0",
  teacher_group: "#f59e0b",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

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

type SchoolClass = { id: string; name: string; section: string };

export default function PrincipalMessages() {
  const { ctx, ready, settled } = useAcademicContext();
  const { profile } = useAuth();
  const liveTick = useAcademicLive("message");
  const myName = profile?.fullName?.trim() || "Principal";

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** True after first contacts fetch — liveTick must not flip back to full-page loading. */
  const contactsLoadedRef = useRef(false);

  const selected = useMemo(
    () =>
      contacts.find((c) => (c.conversationId || c.userId) === selectedKey) ??
      contacts.find((c) => !isGroup(c) && c.userId === selectedKey) ??
      null,
    [contacts, selectedKey],
  );

  const filtered = useMemo(
    () => contacts.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase())),
    [contacts, search],
  );

  async function reloadContacts() {
    if (!ctx) return [];
    const list = await MessageService.listContacts(ctx);
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
        const [{ data: classRows }, list] = await Promise.all([
          supabase
            .from("classes")
            .select("id, name, section")
            .eq("school_id", ctx.schoolId)
            .order("name")
            .order("section"),
          MessageService.listContacts(ctx),
        ]);
        if (cancelled) return;
        setClasses((classRows as SchoolClass[] | null) ?? []);
        setContacts(list);
        if (!selectedKey && list[0]) setSelectedKey(list[0].conversationId || list[0].userId);
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
  }, [ready, ctx, selectedKey, selected?.conversationId, selected?.userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!ctx?.userId) return;
    const channel = supabase
      .channel("principal_chat_messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        void reloadContacts().catch(() => undefined);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ctx?.userId]);

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

  async function sendComposer() {
    if (!input.trim() || sending) return;
    const text = input.trim();
    const replyId = replyTo?.id;
    setInput("");
    setReplyTo(null);
    await handleSend(text, { replyToId: replyId });
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const meta = await uploadAcademicFile(file);
      await handleSend(input.trim(), {
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

  async function handleDelete(id: string) {
    if (!ctx) return;
    try {
      await MessageService.deleteMessage(ctx, id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, content: "Message deleted", deletedAt: new Date().toISOString(), attachments: [] }
            : m,
        ),
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
      <div style={{ minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
        <Loader2 size={16} className="animate-spin" /> Loading messages…
      </div>
    );
  }

  const selColor = selected
    ? roleColor[selected.role] ?? roleColor[selected.kind ?? ""] ?? "var(--indigo)"
    : "var(--indigo)";

  return (
    <div style={{ height: "calc(100vh - 140px)", minHeight: 560, display: "flex", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ width: 300, flexShrink: 0, borderRight: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquare size={16} color="var(--indigo)" />
            <div style={{ fontSize: 14, fontWeight: 700 }}>Messages</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              title="Create group"
              onClick={() => setShowCreate(true)}
              style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Users size={14} color="var(--teal)" />
            </button>
            <button
              type="button"
              title="New chat"
              onClick={() => setShowNewDm(true)}
              style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--indigo-light)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Plus size={14} color="var(--indigo)" />
            </button>
          </div>
        </div>

        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px" }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, width: "100%", color: "var(--text-primary)" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>No conversations yet</div>
          )}
          {filtered.map((c) => {
            const key = c.conversationId || c.userId;
            const color = roleColor[c.role] ?? roleColor[c.kind ?? ""] ?? "var(--text-muted)";
            const active = selectedKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedKey(key)}
                style={{
                  width: "100%",
                  display: "flex",
                  gap: 10,
                  padding: "12px 14px",
                  border: "none",
                  borderRight: active ? "2px solid var(--indigo)" : "2px solid transparent",
                  background: active ? "var(--indigo-light)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "18", color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {isGroup(c) ? <Users size={14} /> : initials(c.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    {c.unread > 0 && (
                      <span style={{ minWidth: 16, height: 16, borderRadius: 999, background: "var(--indigo)", color: "#fff", fontSize: 9, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                        {c.unread > 9 ? "9+" : c.unread}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color, textTransform: "capitalize", marginTop: 1 }}>
                    {c.kind === "class_group" ? "Class Group" : c.kind === "teacher_group" ? "Teacher Group" : c.role}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{c.lastMessage || "—"}</div>
                </div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{formatTime(c.lastTime)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {!selected || !ctx ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-muted)" }}>
            <MessageSquare size={28} />
            <div style={{ fontSize: 13 }}>Select a conversation to start messaging</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: selColor + "18", color: selColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                {isGroup(selected) ? <Users size={15} /> : initials(selected.name)}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.name}</div>
                <div style={{ fontSize: 11, color: selColor, fontWeight: 600, textTransform: "capitalize" }}>
                  {selected.kind === "class_group" ? "Class Group" : selected.kind === "teacher_group" ? "Teacher Group" : selected.role}
                </div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", padding: 40 }}>Start the conversation</div>
              )}
              {messages.map((m) => {
                const isMe = m.senderId === ctx.userId;
                const deleted = Boolean(m.deletedAt) || m.content === "Message deleted";
                return (
                  <div key={m.id} style={{ display: "flex", gap: 10, flexDirection: isMe ? "row-reverse" : "row" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: isMe ? "var(--indigo-light)" : selColor + "18", color: isMe ? "var(--indigo)" : selColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, flexShrink: 0 }}>
                      {isMe ? initials(myName) : initials(selected.name)}
                    </div>
                    <div style={{ maxWidth: "70%", textAlign: isMe ? "right" : "left" }}>
                      {m.replyPreview && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", borderLeft: "2px solid var(--border)", paddingLeft: 8, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.replyPreview}
                        </div>
                      )}
                      <div
                        style={{
                          display: "inline-block",
                          padding: "8px 12px",
                          borderRadius: 14,
                          fontSize: 13,
                          lineHeight: 1.45,
                          background: deleted ? "var(--surface-2)" : isMe ? "var(--indigo-light)" : "var(--surface-2)",
                          color: deleted ? "var(--text-muted)" : "var(--text-primary)",
                          fontStyle: deleted ? "italic" : "normal",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        {deleted ? "Message deleted" : m.content}
                        {!deleted &&
                          m.attachments?.map((a) => (
                            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 4, fontSize: 11, color: "var(--indigo)" }}>
                              {a.name || "Attachment"}
                            </a>
                          ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: isMe ? "flex-end" : "flex-start", marginTop: 4 }}>
                        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{formatTime(m.createdAt)}</span>
                        {!deleted && (
                          <>
                            <button type="button" title="Reply" onClick={() => setReplyTo(m)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}>
                              <Reply size={12} />
                            </button>
                            {isMe && (
                              <button type="button" title="Delete" onClick={() => void handleDelete(m.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--rose)" }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {replyTo && (
              <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
                <Reply size={12} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Replying to: {replyTo.content.slice(0, 80)}</span>
                <button type="button" onClick={() => setReplyTo(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-primary)" }}>×</button>
              </div>
            )}

            <div style={{ padding: 14, borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <input ref={fileRef} type="file" accept={ACADEMIC_FILE_ACCEPT} style={{ display: "none" }} onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)} />
              <button
                type="button"
                disabled={sending || uploading}
                onClick={() => fileRef.current?.click()}
                style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: sending || uploading ? 0.5 : 1 }}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} color="var(--text-muted)" />}
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendComposer();
                  }
                }}
                rows={2}
                placeholder="Type a message… (Enter to send)"
                style={{ flex: 1, resize: "none", borderRadius: 12, border: "1px solid var(--border)", padding: "10px 12px", fontSize: 13, outline: "none", background: "var(--bg)", color: "var(--text-primary)" }}
              />
              <button
                type="button"
                disabled={!input.trim() || sending}
                onClick={() => void sendComposer()}
                style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: "var(--indigo)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: !input.trim() || sending ? 0.45 : 1 }}
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.45)" }} onClick={() => setShowCreate(false)} />
          <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 380, background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Create Group</div>
              <button type="button" onClick={() => setShowCreate(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}>×</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>Only Class Group and Teacher Group are supported.</p>
            <button
              type="button"
              disabled={createBusy}
              onClick={() => void createTeacherGroup()}
              style={{ width: "100%", display: "flex", gap: 10, alignItems: "center", padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", marginBottom: 12, textAlign: "left" }}
            >
              <Users size={16} color="#f59e0b" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Teacher Group</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>All teachers in the school</div>
              </div>
            </button>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Class Group</div>
            <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {classes.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No classes found</div>}
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={createBusy}
                  onClick={() => void createClassGroup(c.id)}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                >
                  <Users size={13} color="var(--teal)" />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}{c.section ? `-${c.section}` : ""}</span>
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
