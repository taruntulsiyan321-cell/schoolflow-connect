import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { HomeworkService } from "@/academic";
import type { StudentHomeworkRow } from "@/academic/services/homeworkService";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor, cn } from "@/gurukul/components/shared";

/**
 * Student Assignments — HomeworkService / AssignmentService only (no mock arrays).
 */
export default function Assignments() {
  const { ctx, ready, studentId } = useAcademicContext();
  const [rows, setRows] = useState<StudentHomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await HomeworkService.listForStudent(ctx, studentId);
        if (!cancelled) setRows(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load assignments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

  const pending = useMemo(
    () => rows.filter((r) => !r.submission || r.submission.status === "pending"),
    [rows],
  );
  const completed = useMemo(
    () =>
      rows.filter(
        (r) => r.submission?.status === "submitted" || r.submission?.status === "graded",
      ),
    [rows],
  );

  if (!ready || loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading assignments…
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="text-center text-sm text-[#78788c] py-16">
        No student profile linked to this account.
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-sm text-[#cc5069] py-16">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: rows.length, color: "#e8eaf0" },
          { label: "Pending", value: pending.length, color: "#c08a3a" },
          { label: "Completed", value: completed.length, color: "#4aa87a" },
        ].map((s) => (
          <div
            key={s.label}
            className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70 text-center"
          >
            <div
              className="text-2xl font-black tabular-nums"
              style={{ color: s.color, fontFamily: "var(--font-display)" }}
            >
              {s.value}
            </div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <GlassCard className="p-5">
        <SectionLabel>All assignments · HomeworkService</SectionLabel>
        <div className="space-y-3">
          {rows.length === 0 && (
            <div className="text-xs text-[#46465a] py-8 text-center">No homework assigned yet.</div>
          )}
          {rows.map(({ homework: a, submission: s }) => {
            const col = subjectColor[a.subject] ?? "#78788c";
            const status = s?.status ?? "pending";
            return (
              <div
                key={a.id}
                className="p-4 rounded-xl border border-white/7 bg-white/2 hover:border-white/15 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${col}15`, color: col }}
                  >
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-semibold text-white">{a.title}</span>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-lg capitalize",
                          status === "graded"
                            ? "bg-purple-500/15 text-purple-400"
                            : status === "submitted"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-amber-500/15 text-amber-400",
                        )}
                      >
                        {status}
                      </span>
                      {s?.grade && (
                        <span className="text-xs font-bold text-purple-400">{s.grade}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <SubjectBadge subject={a.subject} color={col} />
                      <span className="text-[11px] text-[#78788c]">Due {a.dueDate ?? "—"}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
