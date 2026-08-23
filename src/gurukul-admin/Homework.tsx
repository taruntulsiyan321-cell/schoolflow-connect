import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { AnalyticsService, HomeworkService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";

/**
 * Admin Homework monitor — HomeworkService + AnalyticsService only.
 * No mock data; no direct table writes. Live-refreshes with teacher HW writes.
 */
export default function HomeworkAdmin() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof AnalyticsService.homeworkSchool>
  > | null>(null);
  const [items, setItems] = useState<Awaited<ReturnType<typeof HomeworkService.listForSchool>>>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [s, list] = await Promise.all([
          AnalyticsService.homeworkSchool(ctx),
          HomeworkService.listForSchool(ctx, { limit: 100 }),
        ]);
        if (cancelled) return;
        setSummary(s);
        setItems(list);
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
  }, [ready, ctx, liveVersion]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (h) =>
        h.title.toLowerCase().includes(q) ||
        h.subject.toLowerCase().includes(q) ||
        String(h.status ?? "").toLowerCase().includes(q),
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
          <p className="text-xs text-muted-foreground">HomeworkService · AnalyticsService — school monitor</p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title…"
          className="border border-[#e5e7eb] rounded-xl px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Published", value: summary.totalPublished },
            { label: "Drafts", value: summary.totalDrafts },
            { label: "Completion %", value: summary.schoolCompletionPct },
            { label: "Late %", value: summary.latePct },
            { label: "Submissions", value: summary.submissionCount },
            { label: "Graded", value: summary.gradedCount },
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
              <th className="p-3">Subject</th>
              <th className="p-3">Status</th>
              <th className="p-3">Due</th>
              <th className="p-3">Priority</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.id} className="border-b border-[#f0f1f3]">
                <td className="p-3 font-medium">{h.title}</td>
                <td className="p-3 text-muted-foreground">{h.subject}</td>
                <td className="p-3">{toEnumLabel(h.status, "homework_status")}</td>
                <td className="p-3 tabular-nums">{h.dueDate ?? "—"}</td>
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
    </div>
  );
}