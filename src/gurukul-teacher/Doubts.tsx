import { useState, useMemo } from "react";
import { Search, Check, ChevronDown, Paperclip, Send, Filter } from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import { teacherDoubts, type Doubt } from "./data";

export default function Doubts() {
  const [doubts, setDoubts] = useState<Doubt[]>(teacherDoubts);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const subjects = Array.from(new Set(doubts.map((d) => d.subject)));

  const filtered = useMemo(() => doubts.filter((d) => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (subjectFilter !== "all" && d.subject !== subjectFilter) return false;
    const q = search.toLowerCase();
    if (q && !d.studentName.toLowerCase().includes(q) && !d.question.toLowerCase().includes(q) && !d.subject.toLowerCase().includes(q)) return false;
    return true;
  }), [doubts, search, statusFilter, subjectFilter]);

  function sendReply(id: string) {
    const text = replyText[id]?.trim();
    if (!text) return;
    setDoubts((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      return {
        ...d,
        replies: [...d.replies, { from: "teacher", text, timestamp: new Date().toLocaleString("en-IN") }],
      };
    }));
    setReplyText((p) => ({ ...p, [id]: "" }));
  }

  function markResolved(id: string) {
    setDoubts((prev) => prev.map((d) => d.id === id ? { ...d, status: "resolved" } : d));
  }

  const openCount = doubts.filter((d) => d.status === "open").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-white">Student Doubts</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">{openCount} open doubts awaiting reply</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex-1 min-w-48">
          <Search className="w-3.5 h-3.5 text-[#46465a] shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search doubts…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none" />
        </div>
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5">
          <Filter className="w-3 h-3 text-[#46465a]" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "open" | "resolved")}
            className="bg-transparent text-xs text-white outline-none">
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
          <option value="all">All Subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-xs text-[#46465a]">No doubts match your filters.</div>
      )}

      {/* Doubt cards */}
      <div className="space-y-3">
        {filtered.map((d) => (
          <div key={d.id}
            className={cn("bg-[#131316] border rounded-2xl overflow-hidden transition-all",
              d.status === "open" ? "border-[#f59e0b]/20" : "border-white/7")}>
            {/* Header row */}
            <button onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
              className="w-full flex items-start gap-3 p-4 hover:bg-white/3 transition-all text-left">
              <InitialsAvatar name={d.studentName} color={d.status === "open" ? "#f59e0b" : "#46465a"} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold text-white">{d.studentName}</div>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                    d.status === "open" ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-[#10b981]/15 text-[#10b981]")}>
                    {d.status}
                  </span>
                  <span className="text-[9px] text-[#46465a]">{d.className} {d.section} · {d.subject}</span>
                </div>
                <div className="text-[10px] text-[#b0b0c0] mt-1 line-clamp-2 leading-relaxed">{d.question}</div>
                <div className="flex items-center gap-3 mt-1.5 text-[9px] text-[#46465a]">
                  <span>{d.askedAt}</span>
                  {d.hasAttachment && <span className="flex items-center gap-0.5 text-[#6366f1]"><Paperclip className="w-2.5 h-2.5" /> {d.attachmentName}</span>}
                  <span>{d.replies.length} repl{d.replies.length !== 1 ? "ies" : "y"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.status === "open" && (
                  <button onClick={(e) => { e.stopPropagation(); markResolved(d.id); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#10b981]/10 text-[#10b981] text-[9px] font-bold hover:bg-[#10b981]/15 transition-all">
                    <Check className="w-3 h-3" /> Resolve
                  </button>
                )}
                <ChevronDown className={cn("w-4 h-4 text-[#46465a] transition-transform", expandedId === d.id && "rotate-180")} />
              </div>
            </button>

            {/* Expanded thread */}
            {expandedId === d.id && (
              <div className="border-t border-white/7 px-4 pb-4 space-y-3 pt-4">
                {/* Full question */}
                <div className="p-3 rounded-xl bg-white/3 text-xs text-[#b0b0c0] leading-relaxed italic">
                  "{d.question}"
                </div>

                {/* Replies */}
                {d.replies.map((r, i) => (
                  <div key={i} className={cn("flex gap-3", r.from === "teacher" && "flex-row-reverse")}>
                    <div className="w-7 h-7 rounded-xl flex items-center justify-center text-[8px] font-black shrink-0"
                      style={{ background: r.from === "teacher" ? "#f59e0b20" : "#6366f120", color: r.from === "teacher" ? "#f59e0b" : "#6366f1" }}>
                      {r.from === "teacher" ? "AR" : d.studentName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </div>
                    <div className={cn("flex-1 max-w-[80%]", r.from === "teacher" && "text-right")}>
                      <div className={cn("inline-block px-3 py-2 rounded-xl text-xs leading-relaxed",
                        r.from === "teacher"
                          ? "bg-[#f59e0b]/10 text-[#fcd34d]"
                          : "bg-white/5 text-[#b0b0c0]")}>
                        {r.text}
                      </div>
                      <div className="text-[9px] text-[#46465a] mt-1">{r.timestamp}</div>
                    </div>
                  </div>
                ))}

                {/* Reply input */}
                {d.status === "open" && (
                  <div className="flex items-start gap-2 pt-2">
                    <textarea
                      value={replyText[d.id] ?? ""}
                      onChange={(e) => setReplyText((p) => ({ ...p, [d.id]: e.target.value }))}
                      rows={2}
                      placeholder="Type your reply…"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#46465a] outline-none focus:border-[#f59e0b]/40 resize-none transition-all"
                    />
                    <div className="flex flex-col gap-2">
                      <button onClick={() => sendReply(d.id)}
                        disabled={!replyText[d.id]?.trim()}
                        className="w-9 h-9 rounded-xl bg-[#f59e0b] text-black flex items-center justify-center hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                        <Send className="w-4 h-4" />
                      </button>
                      <button className="w-9 h-9 rounded-xl bg-white/5 text-[#78788c] flex items-center justify-center hover:bg-white/10 transition-all" title="Attach file">
                        <Paperclip className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
