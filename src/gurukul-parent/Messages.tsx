import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Plus, X, ArrowLeft } from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import { messageThreads, type MessageThread, type Message } from "./data";

function RoleChip({ role }: { role: string }) {
  const map: Record<string, string> = { parent: "#10b981", teacher: "#6366f1", admin: "#c08a3a" };
  const color = map[role] ?? "#78788c";
  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>{role}</span>;
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOwn = msg.fromRole === "parent";
  return (
    <div className={cn("flex gap-2 max-w-[85%]", isOwn ? "ml-auto flex-row-reverse" : "")}>
      <div className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center text-[9px] font-black"
        style={{ background: isOwn ? "#10b98120" : "#6366f120", color: isOwn ? "#10b981" : "#6366f1" }}>
        {msg.from.charAt(0)}
      </div>
      <div className={cn("flex flex-col gap-1", isOwn ? "items-end" : "")}>
        <div className={cn("px-4 py-3 rounded-2xl text-xs leading-relaxed",
          isOwn ? "bg-[#10b981]/15 text-white rounded-br-sm" : "bg-white/8 text-[#d0d0e0] rounded-bl-sm")}>
          {msg.body}
        </div>
        {msg.hasAttachment && (
          <div className="flex items-center gap-1.5 text-[10px] text-[#6366f1] px-1">
            <Paperclip className="w-3 h-3" /> {msg.attachmentName}
          </div>
        )}
        <div className="text-[9px] text-[#46465a] px-1">{msg.timestamp}</div>
      </div>
    </div>
  );
}

export default function ParentMessages() {
  const [threads, setThreads] = useState<MessageThread[]>(messageThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);

  function openThread(id: string) {
    setActiveThreadId(id);
    setMobileShowThread(true);
    setThreads((prev) => prev.map((t) => t.id === id ? { ...t, unreadCount: 0, messages: t.messages.map((m) => ({ ...m, read: true })) } : t));
  }

  function sendReply() {
    if (!newMessage.trim() || !activeThreadId) return;
    const msg: Message = {
      id: `msg_${Date.now()}`,
      threadId: activeThreadId,
      from: "Rajesh Mehta (You)",
      fromRole: "parent",
      to: activeThread?.participantName ?? "",
      subject: activeThread?.subject ?? "",
      body: newMessage.trim(),
      timestamp: new Date().toLocaleString("en-IN", { hour12: true, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", year: "numeric" }),
      read: true,
      hasAttachment: false,
    };
    setThreads((prev) => prev.map((t) => t.id === activeThreadId ? {
      ...t,
      lastMessage: msg.body,
      lastTimestamp: msg.timestamp,
      messages: [...t.messages, msg],
    } : t));
    setNewMessage("");
  }

  function sendCompose() {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return;
    const newThread: MessageThread = {
      id: `thread_${Date.now()}`,
      participantName: composeTo,
      participantRole: "Teacher",
      subject: composeSubject,
      lastMessage: composeBody,
      lastTimestamp: "Just now",
      unreadCount: 0,
      messages: [{
        id: `msg_${Date.now()}`,
        threadId: `thread_${Date.now()}`,
        from: "Rajesh Mehta (You)",
        fromRole: "parent",
        to: composeTo,
        subject: composeSubject,
        body: composeBody,
        timestamp: "Just now",
        read: true,
        hasAttachment: false,
      }],
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    setShowCompose(false);
    setComposeTo(""); setComposeSubject(""); setComposeBody("");
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-white">Messages</div>
          {totalUnread > 0 && <div className="text-[10px] text-[#10b981] mt-0.5">{totalUnread} unread</div>}
        </div>
        <button onClick={() => setShowCompose(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#10b981] hover:bg-[#059669] transition-all">
          <Plus className="w-3.5 h-3.5" /> New Message
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 bg-[#131316] border border-white/7 rounded-2xl overflow-hidden" style={{ minHeight: "560px" }}>
        {/* Thread list */}
        <div className={cn("lg:col-span-2 border-r border-white/7 flex flex-col", mobileShowThread ? "hidden lg:flex" : "flex")}>
          <div className="p-3 border-b border-white/7">
            <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Conversations</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.map((t) => (
              <button key={t.id} onClick={() => openThread(t.id)}
                className={cn("w-full text-left p-4 border-b border-white/5 hover:bg-white/3 transition-all",
                  activeThreadId === t.id && "bg-[#10b981]/8 border-l-2 border-l-[#10b981]")}>
                <div className="flex items-start gap-3">
                  <InitialsAvatar name={t.participantName} size="sm" color="#6366f1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-white truncate">{t.participantName}</div>
                      {t.unreadCount > 0 && (
                        <span className="text-[9px] font-bold bg-[#10b981] text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0 ml-1">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#46465a]">{t.participantRole}</div>
                    <div className="text-[10px] text-[#78788c] font-medium truncate mt-0.5">{t.subject}</div>
                    <div className="text-[9px] text-[#46465a] truncate mt-0.5">{t.lastMessage}</div>
                    <div className="text-[9px] text-[#46465a] mt-1">{t.lastTimestamp}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Message thread */}
        <div className={cn("lg:col-span-3 flex flex-col", !mobileShowThread && activeThreadId ? "hidden lg:flex" : activeThreadId ? "flex" : "hidden lg:flex")}>
          {activeThread ? (
            <>
              {/* Thread header */}
              <div className="p-4 border-b border-white/7 flex items-center gap-3">
                <button onClick={() => setMobileShowThread(false)} className="lg:hidden text-[#78788c] hover:text-white">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <InitialsAvatar name={activeThread.participantName} size="sm" color="#6366f1" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">{activeThread.participantName}</div>
                  <div className="text-[10px] text-[#78788c]">{activeThread.participantRole}</div>
                </div>
                <RoleChip role="teacher" />
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="text-center text-[9px] text-[#46465a] font-semibold">{activeThread.subject}</div>
                {activeThread.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply box */}
              <div className="p-4 border-t border-white/7 flex gap-2">
                <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder="Type your reply… (Enter to send)"
                  rows={2}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#46465a] outline-none focus:border-[#10b981]/40 resize-none" />
                <div className="flex flex-col gap-2">
                  <button onClick={sendReply} disabled={!newMessage.trim()}
                    className="p-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#78788c] hover:text-white transition-all">
                    <Paperclip className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center p-8">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                <Send className="w-5 h-5 text-[#46465a]" />
              </div>
              <div className="text-sm font-semibold text-white">Select a conversation</div>
              <div className="text-xs text-[#78788c]">Choose a thread from the left or start a new message</div>
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCompose(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/7">
              <div className="text-sm font-bold text-white">New Message</div>
              <button onClick={() => setShowCompose(false)} className="text-[#78788c] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">To</label>
                <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="Teacher / Staff name"
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] outline-none focus:border-[#10b981]/40" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Subject</label>
                <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Subject"
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] outline-none focus:border-[#10b981]/40" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Message</label>
                <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} placeholder="Write your message…" rows={5}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] outline-none focus:border-[#10b981]/40 resize-none" />
              </div>
              <div className="flex gap-3 justify-end mt-2">
                <button onClick={() => setShowCompose(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
                  Cancel
                </button>
                <button onClick={sendCompose} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#10b981] hover:bg-[#059669] transition-all">
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
