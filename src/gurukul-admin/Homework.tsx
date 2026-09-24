import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { AnalyticsService, HomeworkService, useAcademicLive, type SchoolHomeworkRow } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toClassLabel, toEnumLabel, toErrorMessage } from "@/lib/presentation";

/** The school's homework is read a page at a time; older pages are fetched when asked for. */
export const SCHOOL_HOMEWORK_PAGE = 100;

/**
 * Admin homework monitor. Completion comes from `homework_completion`: every
 * current student a published homework is set to, and how many have given it —
 * a rejected hand-in counts as not given. Each row says which class the
 * homework was set to and how much of it has been handed in.
 */
export default function HomeworkAdmin() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof AnalyticsService.homeworkSchool>> | null>(null);
  const [items, setItems] = useState<SchoolHomeworkRow[]>([]);
  /** Pages on screen; a live reload reads all of them again, so it never drops older ones. */
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readPages = async (count: number): Promise<SchoolHomeworkRow[][]> =>
    Promise.all(
      Array.from({ length: count }, (_, i) =>
        HomeworkService.listForSchool(ctx!, { limit: SCHOOL_HOMEWORK_PAGE, offset: i * SCHOOL_HOMEWORK_PAGE }),
      ),
    );

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [s, read] = await Promise.all([AnalyticsService.homeworkSchool(ctx), readPages(pages)]);
        if (cancelled) return;
        setSummary(s);
        setItems(read.flat());
        setHasMore(read[read.length - 1].length === SCHOOL_HOMEWORK_PAGE);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Failed to load homework"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, liveVersion]);

  const showOlder = async () => {
    if (!ctx || loadingMore) return;
    setLoadingMore(true);
    try {
      const read = await readPages(pages + 1);
      setItems(read.flat());
      setHasMore(read[read.length - 1].length === SCHOOL_HOMEWORK_PAGE);
      setPages((p) => p + 1);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load older homework"));
    } finally {
      setLoadingMore(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((h) =>
      [h.title, h.subject, toClassLabel(h.className, h.classSection), toEnumLabel(h.status, "homework_status")].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [items, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading homework…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-muted-foreground">Homework</h1>
          <p className="text-xs text-muted-foreground">Every class's homework, and how much of it has been handed in</p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, class, subject…"
          className="border border-[#e5e7eb] rounded-xl px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Published", value: summary.published },
            { label: "Scheduled", value: summary.scheduled },
            { label: "Drafts", value: summary.drafts },
            { label: "Handed in %", value: summary.completionPct },
            { label: "Awaiting review", value: summary.awaitingReview },
            { label: "Rejected", value: summary.rejected },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border border-[#e5e7eb] bg-card p-4">
              <div className="text-xl font-bold tabular-nums">{k.value}</div>
              <div className="text-[11px] text-muted-foreground">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-[#e5e7eb] bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              <th className="p-3">Title</th>
              <th className="p-3">Class</th>
              <th className="p-3">Subject</th>
              <th className="p-3">Status</th>
              <th className="p-3">Deadline</th>
              <th className="p-3">Handed in</th>
              <th className="p-3">Priority</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.id} className="border-b border-[#f0f1f3]">
                <td className="p-3 font-medium">{h.title}</td>
                <td className="p-3 text-muted-foreground">{toClassLabel(h.className, h.classSection)}</td>
                <td className="p-3 text-muted-foreground">{h.subject}</td>
                <td className="p-3">{toEnumLabel(h.status, "homework_status")}</td>
                <td className="p-3 tabular-nums">
                  {new Date(h.closesAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td className="p-3 tabular-nums">
                  {h.completion
                    ? `${h.completion.given}/${h.completion.students} · ${h.completion.completionPct}%`
                    : "—"}
                </td>
                <td className="p-3">{toEnumLabel(h.priority, "homework_priority")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-12">
            {items.length === 0 ? "No homework found." : "No homework matches this search."}
          </div>
        )}
      </div>
      {hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void showOlder()}
          className="w-full py-2 rounded-xl border border-[#e5e7eb] text-xs font-semibold text-muted-foreground disabled:opacity-50"
        >
          {loadingMore ? "Loading older homework…" : "Show older homework"}
        </button>
      )}
    </div>
  );
}
