import { useState } from "react";
import { Search, Send, Paperclip, MessageCircle, Users, ChevronRight } from "lucide-react";
import { cn } from "./shared";
import { teacherMessages, assignedClasses, type TeacherMessage } from "./data";

const roleColor: Record<string, string> = {
  student: "#6366f1",
  parent: "#f59e0b",
  principal: "#cc5069",
  admin: "#10b981",
};

function ThreadList({ threads, selectedId, onSelect }: { threads: TeacherMessage[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const filtered = threads.filter((t) => !search || t.participantName.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-white/7">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <Search className="w-3 h-3 text-[#46465a] shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.map((t) => (
          <button key={t.id} onClick={() => onSelect(t.id)}
            className={cn("w-full flex items-start gap-3 px-4 py-3 hover:bg-white/3 transition-all text-left",
              selectedId === t.id && "bg-[#3b5bdb]/5 border-r-2 border-[#3b5bdb]")}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
              style={{ background: `${roleColor[t.participantRole] ?? "#78788c"}18`, color: roleColor[t.participantRole] ?? "#78788c" }}>
              {t.participantName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-white truncate">{t.participantName}</div>
                {t.unreadCount > 0 && <div className="w-4 h-4 rounded-full bg-[#3b5bdb] text-black text-[8px] font-black flex items-center justify-center shrink-0">{t.unreadCount}</div>}
              </div>
              <div className="text-[9px] font-semibold capitalize" style={{ color: roleColor[t.participantRole] ?? "#78788c" }}>{t.participantRole}</div>
              <div className="text-[10px] text-[#78788c] truncate mt-0.5">{t.lastMessage}</div>
            </div>
            <div className="text-[8px] text-[#46465a] shrink-0 mt-0.5">{t.lastTimestamp.split(" ")[1]}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatView({ thread }: { thread: TeacherMessage }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(thread.messages);

  function send() {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, {
      id: `m_${Date.now()}`,
      from: "Mrs. Ananya Rajan (You)",
      fromRole: "teacher",
      body: input.trim(),
      timestamp: new Date().toLocaleString("en-IN"),
      hasAttachment: false,
    }]);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[9px] font-black shrink-0"
          style={{ background: `${roleColor[thread.participantRole] ?? "#78788c"}18`, color: roleColor[thread.participantRole] ?? "#78788c" }}>
          {thread.participantName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </div>
        <div>
          <div className="text-sm font-bold text-white">{thread.participantName}</div>
          <div className="text-[9px] capitalize font-semibold" style={{ color: roleColor[thread.participantRole] ?? "#78788c" }}>{thread.participantRole}</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => {
          const isMe = m.fromRole === "teacher";
          return (
            <div key={m.id} className={cn("flex gap-3", isMe && "flex-row-reverse")}>
              <div className="w-7 h-7 rounded-xl flex items-center justify-center text-[8px] font-black shrink-0"
                style={{ background: isMe ? "#f59e0b20" : `${roleColor[m.fromRole] ?? "#78788c"}18`, color: isMe ? "#f59e0b" : roleColor[m.fromRole] ?? "#78788c" }}>
                {m.from.split(" ").map((w) => w[0]).slice(0, 2).join("").slice(0, 2)}
              </div>
              <div className={cn("max-w-[70%]", isMe && "text-right")}>
                <div className={cn("text-[8px] font-semibold mb-1", isMe ? "text-[#3b5bdb]" : "text-[#78788c]")}>{m.from}</div>
                <div className={cn("px-3 py-2 rounded-2xl text-xs leading-relaxed",
                  isMe ? "bg-[#3b5bdb]/15 text-[#fcd34d]" : "bg-white/5 text-[#b0b0c0]")}>
                  {m.body}
                </div>
                <div className="text-[8px] text-[#46465a] mt-1">{m.timestamp}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/7">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder="Type a message… (Enter to send)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#46465a] outline-none focus:border-[#3b5bdb]/40 resize-none transition-all"
          />
          <div className="flex flex-col gap-2">
            <button onClick={send} disabled={!input.trim()}
              className="w-9 h-9 rounded-xl bg-[#3b5bdb] text-black flex items-center justify-center hover:bg-[#d97706] disabled:opacity-40 transition-all">
              <Send className="w-4 h-4" />
            </button>
            <button className="w-9 h-9 rounded-xl bg-white/5 text-[#78788c] flex items-center justify-center hover:bg-white/10 transition-all">
              <Paperclip className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Communication() {
  const [threads, setThreads] = useState<TeacherMessage[]>(teacherMessages);
  const [selectedId, setSelectedId] = useState<string | null>(threads[0]?.id ?? null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ to: "", role: "student", subject: "", message: "" });

  const selectedThread = threads.find((t) => t.id === selectedId) ?? null;

  function startNewThread() {
    if (!newForm.to || !newForm.message) return;
    const t: TeacherMessage = {
      id: `tm_${Date.now()}`,
      threadId: `tm_${Date.now()}`,
      participantName: newForm.to,
      participantRole: newForm.role as TeacherMessage["participantRole"],
      subject: newForm.subject || "New Message",
      lastMessage: newForm.message,
      lastTimestamp: new Date().toLocaleString("en-IN"),
      unreadCount: 0,
      messages: [{
        id: `m_${Date.now()}`,
        from: "Mrs. Ananya Rajan (You)",
        fromRole: "teacher",
        body: newForm.message,
        timestamp: new Date().toLocaleString("en-IN"),
        hasAttachment: false,
      }],
    };
    setThreads((prev) => [t, ...prev]);
    setSelectedId(t.id);
    setShowNew(false);
    setNewForm({ to: "", role: "student", subject: "", message: "" });
  }

  return (
    <div className="h-[calc(100vh-200px)] min-h-[600px] flex rounded-2xl overflow-hidden border border-white/7 bg-[#0d0d0f]">
      {/* Sidebar */}
      <div className="w-72 shrink-0 bg-[#131316] border-r border-white/7 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/7">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#3b5bdb]" />
            <div className="text-sm font-bold text-white">Messages</div>
          </div>
          <button onClick={() => setShowNew(true)}
            className="w-7 h-7 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb] flex items-center justify-center hover:bg-[#3b5bdb]/25 transition-all text-base font-bold">
            +
          </button>
        </div>

        {/* Group chats section */}
        <div className="px-4 py-3 border-b border-white/7">
          <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mb-2">Class Broadcasts</div>
          {assignedClasses.map((c) => (
            <button key={c.id}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-white/5 transition-all group">
              <Users className="w-3.5 h-3.5 text-[#46465a] group-hover:text-[#3b5bdb] transition-all" />
              <span className="text-[10px] text-[#78788c] group-hover:text-white transition-all">{c.className} {c.section} — {c.subject}</span>
              <ChevronRight className="w-3 h-3 text-[#46465a] ml-auto" />
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2">
            <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Direct Messages</div>
          </div>
          <ThreadList threads={threads} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-w-0">
        {selectedThread ? (
          <ChatView thread={selectedThread} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-[#46465a]">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-xs">Select a conversation to start messaging</div>
            </div>
          </div>
        )}
      </div>

      {/* New message modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNew(false)} />
          <div className="relative z-10 bg-[#131316] border border-white/10 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white">New Message</div>
              <button onClick={() => setShowNew(false)} className="text-[#78788c] hover:text-white text-lg">×</button>
            </div>
            {[
              { label: "Recipient Name", key: "to", type: "text" },
              { label: "Subject", key: "subject", type: "text" },
            ].map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">{f.label}</label>
                <input type={f.type} value={(newForm as Record<string, string>)[f.key]}
                  onChange={(e) => setNewForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Recipient Type</label>
              <select value={newForm.role} onChange={(e) => setNewForm((p) => ({ ...p, role: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
                <option value="student">Student</option>
                <option value="parent">Parent</option>
                <option value="principal">Principal</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Message *</label>
              <textarea value={newForm.message} onChange={(e) => setNewForm((p) => ({ ...p, message: e.target.value }))} rows={3}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40 resize-none" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10">Cancel</button>
              <button onClick={startNewThread} disabled={!newForm.to || !newForm.message}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all">
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
