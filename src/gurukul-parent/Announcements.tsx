import { useEffect, useState } from "react";
import { Search, Paperclip, Download, Loader2 } from "lucide-react";
import { cn, PriorityBadge } from "./shared";
import {
  AnnouncementService,
  useAcademicLive,
  type TeacherAnnouncementRow,
  type AnnouncementPriority,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

/**
 * Parent announcements — AnnouncementService.listPublishedForParent only.
 * School-wide + linked children's classes; empty when none; never fake notices.
 */
export default function ParentAnnouncements() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile"]);
  const [announcements, setAnnouncements] = useState<TeacherAnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | AnnouncementPriority>("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await AnnouncementService.listPublishedForParent(ctx);
        if (!cancelled) {
          setAnnouncements(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setAnnouncements([]);
          setError(e instanceof Error ? e.message : "Failed to load announcements");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  const filtered = announcements.filter((a) => {
    const q = search.toLowerCase();
    const from = [a.targetClass, a.targetSection].filter(Boolean).join(" ");
    if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q) && !from.toLowerCase().includes(q)) {
      return false;
    }
    if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
    return true;
  });

  const detail = announcements.find((a) => a.id === selected);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading announcements…
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-[#cc5069] py-10 text-center">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-bold text-white">Announcements</div>
        <div className="text-[10px] text-[#78788c] mt-0.5">
          AnnouncementService · {announcements.length} published
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex-1 min-w-40">
          <Search className="w-3.5 h-3.5 text-[#46465a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none"
          />
        </div>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none"
        >
          <option value="all">All Priorities</option>
          <option value="normal">Normal</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      <div className={cn("grid gap-4", selected ? "grid-cols-1 lg:grid-cols-5" : "grid-cols-1")}>
        <div className={cn("space-y-2", selected ? "lg:col-span-2" : "")}>
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-[#78788c]">
              No published announcements yet.
            </div>
          )}
          {filtered.map((a) => {
            const classLabel = [a.targetClass, a.targetSection].filter(Boolean).join(" ") || "School";
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a.id)}
                className={cn(
                  "w-full text-left p-4 rounded-2xl border transition-all",
                  selected === a.id
                    ? "bg-[#3b5bdb]/8 border-[#3b5bdb]/25"
                    : "bg-[#131316] border-white/7 hover:border-white/15",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <PriorityBadge priority={a.priority} />
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#3b5bdb]/15 text-[#3b5bdb]">
                        {classLabel}
                      </span>
                      {a.hasAttachment && <Paperclip className="w-3 h-3 text-[#46465a]" />}
                    </div>
                    <div className="text-xs font-semibold text-white">{a.title}</div>
                    <div className="text-[10px] text-[#46465a] mt-0.5 line-clamp-2">{a.body}</div>
                    <div className="text-[9px] text-[#46465a] mt-1.5">
                      {a.publishedAt ?? "—"}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {detail && (
          <div className="lg:col-span-3 bg-[#131316] border border-white/7 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <PriorityBadge priority={detail.priority} />
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[#46465a] hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
            <div>
              <div className="text-base font-bold text-white">{detail.title}</div>
              <div className="text-[10px] text-[#78788c] mt-1">
                {[detail.targetClass, detail.targetSection].filter(Boolean).join(" ") || "School"}
                {" · "}
                {detail.publishedAt ?? "—"}
              </div>
            </div>
            <div className="text-sm text-[#b0b0c0] leading-relaxed whitespace-pre-wrap">{detail.body}</div>
            {detail.hasAttachment && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 text-xs font-semibold text-[#a5b4fc]">
                <Paperclip className="w-3.5 h-3.5" /> {detail.attachmentName ?? "Attachment"}
                <Download className="w-3 h-3 ml-auto opacity-40" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
