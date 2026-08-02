import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Send } from "lucide-react";
import { HomeworkService, WORK_KIND_LABELS, normalizeWorkKind, useAcademicLive } from "@/academic";
import type { StudentHomeworkRow } from "@/academic/services/homeworkService";
import type { HomeworkAttachmentMeta } from "@/academic/repository/homeworkRepository";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { displaySubject, presentAcademicLabel } from "@/lib/academicPresentation";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor } from "@/gurukul/components/shared";
import { AttachmentComposer, AttachmentList } from "@/gurukul-teacher/AttachmentUI";

function subjectAccent(raw: string): string {
  const label = displaySubject(raw) || raw;
  return subjectColor[label] ?? subjectColor[raw] ?? "#78788c";
}

/**
 * Student Assignments — HomeworkService list / submit / feedback (no mock).
 */
export default function Assignments() {
  const { ctx, ready, studentId } = useAcademicContext();
  const liveVersion = useAcademicLive("homework");
  const [rows, setRows] = useState<StudentHomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<HomeworkAttachmentMeta[]>([]);
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
  }, [ready, ctx, studentId, liveVersion]);

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
      list = list.filter((r) => {
        const title = (presentAcademicLabel(r.homework.title) || r.homework.title).toLowerCase();
        const subject = (displaySubject(r.homework.subject) || r.homework.subject).toLowerCase();
        return title.includes(q) || subject.includes(q) || r.homework.subject.toLowerCase().includes(q);
      });
    }
    return list;
  }, [rows, filter, pending, completed, search]);

  const submit = async (homeworkId: string) => {
    if (!ctx || !studentId) return;
    if (!content.trim() && attachments.length === 0) {
      setActionError("Add a note or attach at least one file/link before sending");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await HomeworkService.submit(ctx, {
        homeworkId,
        studentId,
        content: content.trim(),
        attachments,
      });
      setActiveId(null);
      setContent("");
      setAttachments([]);
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
      <div className="text-center text-sm text-[#cc5069] py-16">{loadError}</div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionLabel>My Homework</SectionLabel>
      {actionError && (
        <div className="rounded-xl border border-[#cc5069]/30 bg-[#cc5069]/10 px-3 py-2 text-xs text-[#cc5069]">
          {actionError}
        </div>
      )}
      <GlassCard className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-1">
            {(["all", "pending", "done"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold capitalize ${
                  filter === f ? "bg-[#3b5bdb] text-white" : "bg-white/5 text-[#78788c]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-[11px] text-white w-36"
          />
        </div>

        <div className="space-y-3">
          {visible.length === 0 && (
            <div className="text-center py-10 text-xs text-[#46465a]">
              {filter !== "all" || search.trim()
                ? "No assignments match this filter."
                : "No homework assigned yet."}
            </div>
          )}
          {visible.map(({ homework: a, submission: s, displayStatus }) => {
            const col = subjectAccent(a.subject);
            const title = presentAcademicLabel(a.title) || a.title;
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
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-semibold text-white">{title}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb]">
                        {WORK_KIND_LABELS[normalizeWorkKind(a.workKind)]}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-400">
                        {displayStatus}
                      </span>
                      {s?.grade && !isReturned && (
                        <span className="text-xs font-bold text-purple-400">{s.grade}</span>
                      )}
                      {s?.marksObtained != null && !isReturned && (
                        <span className="text-[10px] text-[#78788c]">
                          {s.marksObtained}
                          {a.maxMarks != null ? ` / ${a.maxMarks}` : ""}
                        </span>
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
                      <p className="text-[11px] text-[#78788c] line-clamp-3">
                        {a.instructions || a.description}
                      </p>
                    )}
                    {(a.attachments?.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-[#78788c]">Teacher attachments</div>
                        <AttachmentList items={a.attachments ?? []} dense />
                      </div>
                    )}
                    {(s?.attachments?.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-[#78788c]">Your submission files</div>
                        <AttachmentList items={s?.attachments ?? []} dense />
                      </div>
                    )}
                    {s?.teacherRemarks && (
                      <p
                        className={`text-[11px] ${isReturned ? "text-amber-400" : "text-[#4aa87a]"}`}
                      >
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
                          placeholder={
                            isReturned
                              ? "Revise notes (optional if attaching files)…"
                              : "Notes (optional if attaching files)"
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[70px]"
                        />
                        <AttachmentComposer
                          items={attachments}
                          onChange={setAttachments}
                          disabled={saving}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void submit(a.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb] text-white"
                          >
                            {saving ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            {isReturned ? "Resubmit" : s ? "Replace submission" : "Submit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveId(null);
                              setContent("");
                              setAttachments([]);
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
                          setAttachments(s?.attachments ?? []);
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
