import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AnalyticsService, HomeworkService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

/**
 * Admin Homework monitor — HomeworkService + AnalyticsService only.
 * No mock data; no direct table writes.
 */
export default function HomeworkAdmin() {
  const { ctx, ready } = useAcademicContext();
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
          HomeworkService.listForSchool(ctx, { limit: 100 }, search ? { search } : undefined),
        ]);
        if (cancelled) return;
        setSummary(s);
        setItems(list);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load homework");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[#78788c] text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading homework…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[#1a1a2e]">Homework</h1>
          <p className="text-xs text-[#78788c]">HomeworkService · AnalyticsService — school monitor</p>
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
            <div key={k.label} className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
              <div className="text-xl font-bold tabular-nums">{k.value}</div>
              <div className="text-[11px] text-[#78788c]">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-[#e5e7eb] bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#78788c] border-b">
              <th className="p-3">Title</th>
              <th className="p-3">Subject</th>
              <th className="p-3">Status</th>
              <th className="p-3">Due</th>
              <th className="p-3">Priority</th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id} className="border-b border-[#f0f1f3]">
                <td className="p-3 font-medium">{h.title}</td>
                <td className="p-3 text-[#46465a]">{h.subject}</td>
                <td className="p-3 capitalize">{h.status}</td>
                <td className="p-3 tabular-nums">{h.dueDate ?? "—"}</td>
                <td className="p-3 capitalize">{h.priority}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="text-center text-xs text-[#78788c] py-12">No homework found.</div>
        )}
      </div>
    </div>
  );
}
