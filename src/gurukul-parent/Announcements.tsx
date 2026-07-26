import { useState } from "react";
import { Search, Bell, Paperclip, Download, Filter, ChevronDown } from "lucide-react";
import { cn, PriorityBadge } from "./shared";
import { parentAnnouncements, type Announcement } from "./data";

export default function ParentAnnouncements() {
  const [announcements, setAnnouncements] = useState(parentAnnouncements);
  const [search, setSearch] = useState("");
  const [audienceFilter, setAudienceFilter] = useState<"all" | "school" | "class" | "section">("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "normal" | "important" | "urgent">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const unread = announcements.filter((a) => !a.read).length;

  const filtered = announcements.filter((a) => {
    const q = search.toLowerCase();
    if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q) && !a.from.toLowerCase().includes(q)) return false;
    if (audienceFilter !== "all" && a.audience !== audienceFilter) return false;
    if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
    return true;
  });

  function openAnnouncement(id: string) {
    setSelected(id);
    setAnnouncements((prev) => prev.map((a) => a.id === id ? { ...a, read: true } : a));
  }

  const detail = announcements.find((a) => a.id === selected);

  const audienceLabel: Record<string, string> = { school: "School", class: "Class", section: "Section" };
  const audienceColor: Record<string, string> = { school: "#6366f1", class: "#10b981", section: "#c08a3a" };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-white">Announcements</div>
          {unread > 0 && <div className="text-[10px] text-[#c08a3a] mt-0.5">{unread} unread</div>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex-1 min-w-40">
          <Search className="w-3.5 h-3.5 text-[#46465a]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search announcements…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none" />
        </div>
        <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value as typeof audienceFilter)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
          <option value="all">All Audiences</option>
          <option value="school">School</option>
          <option value="class">Class</option>
          <option value="section">Section</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
          <option value="all">All Priorities</option>
          <option value="normal">Normal</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {/* List + Detail */}
      <div className={cn("grid gap-4", selected ? "grid-cols-1 lg:grid-cols-5" : "grid-cols-1")}>
        {/* List */}
        <div className={cn("space-y-2", selected ? "lg:col-span-2" : "")}>
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-[#78788c]">No announcements found</div>
          )}
          {filtered.map((a) => (
            <button key={a.id} onClick={() => openAnnouncement(a.id)}
              className={cn("w-full text-left p-4 rounded-2xl border transition-all",
                selected === a.id ? "bg-[#10b981]/8 border-[#10b981]/25" : "bg-[#131316] border-white/7 hover:border-white/15")}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1.5 mt-0.5">
                  {!a.read && <div className="w-2 h-2 rounded-full bg-[#10b981] shrink-0" />}
                  {a.read && <div className="w-2 h-2 rounded-full bg-transparent shrink-0" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <PriorityBadge priority={a.priority} />
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${audienceColor[a.audience]}18`, color: audienceColor[a.audience] }}>
                      {audienceLabel[a.audience]}
                    </span>
                    {a.hasAttachment && <Paperclip className="w-3 h-3 text-[#46465a]" />}
                  </div>
                  <div className="text-xs font-semibold text-white">{a.title}</div>
                  <div className="text-[10px] text-[#46465a] mt-0.5 line-clamp-2">{a.body}</div>
                  <div className="text-[9px] text-[#46465a] mt-1.5">{a.from} · {a.date}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        {detail && (
          <div className="lg:col-span-3 bg-[#131316] border border-white/7 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge priority={detail.priority} />
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${audienceColor[detail.audience]}18`, color: audienceColor[detail.audience] }}>
                  {audienceLabel[detail.audience]}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#46465a] hover:text-white text-xs">✕</button>
            </div>
            <div>
              <div className="text-base font-bold text-white">{detail.title}</div>
              <div className="text-[10px] text-[#78788c] mt-1">{detail.from} · {detail.date}</div>
            </div>
            <div className="text-sm text-[#b0b0c0] leading-relaxed">{detail.body}</div>
            {detail.hasAttachment && (
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 text-xs font-semibold text-[#a5b4fc] hover:bg-[#6366f1]/15 transition-all">
                <Paperclip className="w-3.5 h-3.5" /> {detail.attachmentName ?? "Attachment"}
                <Download className="w-3 h-3 ml-auto" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
