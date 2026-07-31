import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Send } from "lucide-react";
import { HomeworkService } from "@/academic";
import type { StudentHomeworkRow } from "@/academic/services/homeworkService";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor, cn } from "@/gurukul/components/shared";

/**
 * Student Assignments — HomeworkService only (view + submit / replace).
 */
export default function Assignments() {
  const { ctx, ready, studentId } = useAcademicContext();
  const [rows, setRows] = useState<StudentHomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!ctx || !studentId) return;
    const list = await HomeworkService.listForStudent(ctx, studentId);
    setRows(list);
  };

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await reload();
        if (!cancelled) setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load assignments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, studentId]);

  const pending = useMemo(
    () => rows.filter((r) => !r.submission || ["pending", "returned"].includes(r.submission.status)),
    [rows],
  );
  const completed = useMemo(
    () =>
      rows.filter((r) =>
        ["submitted", "late", "reviewed", "graded", "completed"].includes(r.submission?.status ?? ""),
      ),
    [rows],
  );

  const visible = useMemo(() => {
    let list = rows;
    if (filter === "pending") list = pending;
    if (filter === "done") list = completed;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.homework.title.toLowerCase().includes(q) ||
          r.homework.subject.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, filter, pending, completed, search]);

  const submit = async (homeworkId: string) => {
    if (!ctx || !studentId) return;
    if (!content.trim()) {
      setActionError("Enter your submission before sending");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await HomeworkService.submit(ctx, {
        homeworkId,
        studentId,
        content: content.trim(),
      });
      setActiveId(null);
      setContent("");
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  };

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

  if (loadError) {
    return (
      <div className="text-center py-16 space-y-3">
        <div className="text-sm text-[#cc5069]">{loadError}</div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void reload()
              .then(() => setLoadError(null))
              .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load assignments"))
              .finally(() => setLoading(false));
          }}
          className="text-[11px] font-bold text-[#3b5bdb]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {actionError && (
        <div className="rounded-xl border border-[#cc5069]/30 bg-[#cc5069]/10 px-3 py-2 text-xs text-[#cc5069] flex justify-between gap-3">
          <span>{actionError}</span>
          <button type="button" className="font-bold shrink-0" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}
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

      <div className="flex flex-wrap gap-2 items-center">
        {(["all", "pending", "done"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-[10px] font-bold capitalize",
              filter === f ? "bg-[#3b5bdb] text-white" : "bg-white/5 text-[#78788c]",
            )}
          >
            {f}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="ml-auto bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-[11px] text-white"
        />
      </div>

      <GlassCard className="p-5">
        <SectionLabel>All assignments · HomeworkService</SectionLabel>
        <div className="space-y-3">
          {visible.length === 0 && (
            <div className="text-xs text-[#46465a] py-8 text-center">
              {rows.length === 0
                ? "No homework assigned yet."
                : filter !== "all" || search.trim()
                  ? "No assignments match this filter."
                  : "No homework assigned yet."}
            </div>
          )}
          {visible.map(({ homework: a, submission: s, displayStatus }) => {
            const col = subjectColor[a.subject] ?? "#78788c";
            const canSubmit =
              !s || ["pending", "submitted", "late", "returned"].includes(s.status);
            const isReturned = s?.status === "returned";
            return (
              <div
                key={a.id}
                className={`p-4 rounded-xl border bg-white/2 hover:border-white/15 transition-colors space-y-2 ${
                  isReturned ? "border-amber-500/40" : "border-white/7"
                }`}
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
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${
                          isReturned
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        {displayStatus}
                      </span>
                      {s?.grade && !isReturned && (
                        <span className="text-xs font-bold text-purple-400">{s.grade}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <SubjectBadge subject={a.subject} color={col} />
                      <span className="text-[11px] text-[#78788c]">Due {a.dueDate ?? "—"}</span>
                      {s?.submittedAt && (
                        <span className="text-[10px] text-[#46465a]">
                          Submitted {new Date(s.submittedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {(a.description || a.instructions) && (
                      <p className="text-[11px] text-[#78788c] mt-2 line-clamp-3">
                        {a.instructions || a.description}
                      </p>
                    )}
                    {s?.teacherRemarks && (
                      <p className={`text-[11px] mt-1 ${isReturned ? "text-amber-400" : "text-[#4aa87a]"}`}>
                        Teacher: {s.teacherRemarks}
                      </p>
                    )}
                  </div>
                </div>
                {canSubmit && (
                  <div>
                    {activeId === a.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          placeholder={isReturned ? "Revise and resubmit…" : "Your response / submission notes"}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[70px]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void submit(a.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb] text-white"
                          >
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            {isReturned ? "Resubmit" : s ? "Replace submission" : "Submit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveId(null);
                              setContent("");
                            }}
                            className="px-3 py-1.5 rounded-xl text-[10px] font-bold text-[#78788c]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveId(a.id);
                          setContent(s?.content ?? "");
                        }}
                        className="text-[10px] font-bold text-[#3b5bdb]"
                      >
                        {isReturned
                          ? "Resubmit correction"
                          : s
                            ? "Replace submission"
                            : "Submit homework"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
