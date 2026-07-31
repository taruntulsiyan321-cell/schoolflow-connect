import { useEffect, useMemo, useState } from "react";
import {
  Loader2, Plus, Save, Send, Archive, Copy, Eye, CheckCircle2, RotateCcw, CalendarClock,
} from "lucide-react";
import {
  HomeworkService,
  AttendanceService,
  WORK_KINDS,
  WORK_KIND_LABELS,
  type WorkKind,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

type StatsRow = Awaited<ReturnType<typeof HomeworkService.listForClassWithStats>>[number];
type SubRow = Awaited<ReturnType<typeof HomeworkService.listSubmissions>>[number];
type StatusFilter = "all" | "draft" | "published" | "scheduled" | "archived";
type KindFilter = "all" | WorkKind;
type PublishMode = "now" | "schedule" | "draft";

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-[#78788c] text-xs">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

/**
 * Academic Work workspace — HomeworkService only (all work_kind values).
 */
export function LiveAcademicWorkTab({
  classId,
  subject,
}: {
  classId: string;
  subject: string;
}) {
  const { ctx, ready } = useAcademicContext();
  const [items, setItems] = useState<StatsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [selectedKind, setSelectedKind] = useState<WorkKind>("homework");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [publishMode, setPublishMode] = useState<PublishMode>("now");
  const [form, setForm] = useState({
    title: "",
    description: "",
    dueDate: "",
    dueTime: "",
    priority: "normal",
    maxMarks: "",
    scheduledPublishAt: "",
    attachName: "",
    attachUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [reviewHw, setReviewHw] = useState<StatsRow | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [roster, setRoster] = useState<{ id: string; fullName: string }[]>([]);
  const [gradeDraft, setGradeDraft] = useState<Record<string, { grade: string; remarks: string }>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const reload = async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const list = await HomeworkService.listForClassWithStats(ctx, classId, { limit: 100 });
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId]);

  const filtered = useMemo(() => {
    return items.filter((h) => {
      if (kindFilter !== "all" && (h.workKind ?? "homework") !== kindFilter) return false;
      if (statusFilter !== "all" && (h.status ?? "") !== statusFilter) {
        if (!(statusFilter === "published" && h.status === "active")) return false;
      }
      if (
        search &&
        !h.title.toLowerCase().includes(search.toLowerCase()) &&
        !h.subject.toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [items, statusFilter, kindFilter, search]);

  const create = async () => {
    if (!ctx || !form.title.trim()) return;
    if (publishMode !== "draft" && !form.dueDate) {
      setError("Due date is required to publish or schedule");
      return;
    }
    if (publishMode === "schedule" && !form.scheduledPublishAt) {
      setError("Schedule datetime is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const attachments =
        form.attachName.trim() && form.attachUrl.trim()
          ? [{ name: form.attachName.trim(), url: form.attachUrl.trim() }]
          : [];
      const base = {
        classId,
        subject: subject || "General",
        title: form.title.trim(),
        description: form.description,
        dueDate: form.dueDate || null,
        dueTime: form.dueTime || null,
        priority: form.priority,
        maxMarks: form.maxMarks && !Number.isNaN(Number(form.maxMarks)) ? Number(form.maxMarks) : null,
        workKind: selectedKind,
        attachments,
      };
      if (publishMode === "draft") {
        await HomeworkService.createDraft(ctx, base);
      } else if (publishMode === "schedule") {
        const scheduledAt = new Date(form.scheduledPublishAt).toISOString();
        await HomeworkService.assign(ctx, {
          ...base,
          status: "scheduled",
          scheduledPublishAt: scheduledAt,
        });
      } else {
        await HomeworkService.assign(ctx, base);
      }
      setForm({
        title: "",
        description: "",
        dueDate: "",
        dueTime: "",
        priority: "normal",
        maxMarks: "",
        scheduledPublishAt: "",
        attachName: "",
        attachUrl: "",
      });
      setCreating(false);
      setPublishMode("now");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const openReview = async (hw: StatsRow) => {
    if (!ctx) return;
    setReviewHw(hw);
    setGradeDraft({});
    setError(null);
    try {
      const [list, students] = await Promise.all([
        HomeworkService.listSubmissions(ctx, hw.id),
        AttendanceService.listClassStudents(ctx, classId),
      ]);
      setSubs(list);
      setRoster(students.map((s) => ({ id: s.id, fullName: s.fullName })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load submissions");
    }
  };

  const review = async (submissionId: string, action: "grade" | "return") => {
    if (!ctx || reviewingId) return;
    const d = gradeDraft[submissionId] ?? { grade: "", remarks: "" };
    setReviewingId(submissionId);
    setError(null);
    try {
      await HomeworkService.review(ctx, {
        submissionId,
        action,
        grade: d.grade || null,
        remarks: d.remarks || null,
      });
      if (reviewHw) await openReview(reviewHw);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setReviewingId(null);
    }
  };

  const runHwAction = async (label: string, fn: () => Promise<unknown>) => {
    if (!ctx) return;
    setSaving(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading academic work…" />;

  if (reviewHw) {
    const nameById = new Map(roster.map((r) => [r.id, r.fullName]));
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setReviewHw(null)}
          className="text-[10px] font-bold text-[#3b5bdb]"
        >
          ← Back to list
        </button>
        {error && <div className="text-xs text-[#cc5069]">{error}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-bold text-white">{reviewHw.title}</div>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb]">
            {WORK_KIND_LABELS[reviewHw.workKind ?? "homework"]}
          </span>
        </div>
        <div className="text-[10px] text-[#78788c]">
          {subs.length} submissions · HomeworkService.review
        </div>
        <div className="space-y-2">
          {subs.map((s) => (
            <div key={s.id} className="p-3 rounded-2xl border border-white/10 bg-[#131316] space-y-2">
              <div className="flex justify-between gap-2">
                <div className="text-xs font-semibold text-white">
                  {nameById.get(s.studentId) ?? s.studentId.slice(0, 8)}
                </div>
                <div className="text-[10px] text-[#78788c]">
                  {s.status}{s.isLate ? " · late" : ""} · v{s.version}
                </div>
              </div>
              <div className="text-[11px] text-[#a0a0b0] whitespace-pre-wrap">{s.content || "—"}</div>
              {s.teacherRemarks && (
                <div className="text-[10px] text-[#4aa87a]">Remarks: {s.teacherRemarks}</div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  placeholder="Grade"
                  value={gradeDraft[s.id]?.grade ?? s.grade ?? ""}
                  onChange={(e) =>
                    setGradeDraft((g) => ({
                      ...g,
                      [s.id]: { grade: e.target.value, remarks: g[s.id]?.remarks ?? "" },
                    }))
                  }
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white w-24"
                />
                <input
                  placeholder="Remarks"
                  value={gradeDraft[s.id]?.remarks ?? s.teacherRemarks ?? ""}
                  onChange={(e) =>
                    setGradeDraft((g) => ({
                      ...g,
                      [s.id]: { grade: g[s.id]?.grade ?? "", remarks: e.target.value },
                    }))
                  }
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white flex-1 min-w-[120px]"
                />
                <button
                  type="button"
                  disabled={!!reviewingId}
                  onClick={() => void review(s.id, "grade")}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#4aa87a]/20 text-[#4aa87a] flex items-center gap-1 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {reviewingId === s.id ? "…" : "Grade"}
                </button>
                <button
                  type="button"
                  disabled={!!reviewingId}
                  onClick={() => void review(s.id, "return")}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#c08a3a]/20 text-[#c08a3a] flex items-center gap-1 disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" /> Return
                </button>
              </div>
            </div>
          ))}
          {subs.length === 0 && (
            <div className="text-center py-8 text-xs text-[#46465a]">No submissions yet.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-bold text-white">Academic Work</div>
      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setKindFilter("all")}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
            kindFilter === "all" ? "bg-[#3b5bdb] text-white" : "bg-white/5 text-[#78788c]"
          }`}
        >
          All kinds
        </button>
        {WORK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKindFilter(k);
              setSelectedKind(k);
            }}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
              kindFilter === k ? "bg-[#3b5bdb] text-white" : "bg-white/5 text-[#78788c]"
            }`}
          >
            {WORK_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {(["all", "draft", "published", "scheduled", "archived"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold capitalize ${
                statusFilter === s ? "bg-white/15 text-white" : "bg-white/5 text-[#78788c]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-[11px] text-white w-36"
          />
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb]"
          >
            <Plus className="w-3 h-3" /> New Academic Work
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[#46465a]">
        Homework, Assignment, Worksheet, Project, and Internal Assessment share one workflow — pick the type above when creating.
      </p>

      {creating && (
        <div className="bg-[#131316] border border-white/10 rounded-2xl p-4 space-y-2">
          <div className="flex flex-wrap gap-1 mb-1">
            {WORK_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSelectedKind(k)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                  selectedKind === k ? "bg-[#3b5bdb] text-white" : "bg-white/5 text-[#78788c]"
                }`}
              >
                {WORK_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title *"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Instructions"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[60px]"
          />
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            />
            <input
              type="time"
              value={form.dueTime}
              onChange={(e) => setForm((f) => ({ ...f, dueTime: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            />
            <select
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <input
              value={form.maxMarks}
              onChange={(e) => setForm((f) => ({ ...f, maxMarks: e.target.value }))}
              placeholder="Max marks"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white w-24"
            />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-[#78788c] font-semibold">Attach file (PDF / image URL)</div>
            <div className="flex flex-wrap gap-2">
              <input
                value={form.attachName}
                onChange={(e) => setForm((f) => ({ ...f, attachName: e.target.value }))}
                placeholder="File name e.g. worksheet.pdf"
                className="flex-1 min-w-[140px] bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
              />
              <input
                value={form.attachUrl}
                onChange={(e) => setForm((f) => ({ ...f, attachUrl: e.target.value }))}
                placeholder="https://… link to PDF or image"
                className="flex-[2] min-w-[180px] bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div className="text-[9px] text-[#46465a]">
              Students see this attachment in the app. Cloud upload picker comes later — paste a link for now.
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { key: "now" as const, label: "Publish Immediately" },
                { key: "schedule" as const, label: "Schedule" },
                { key: "draft" as const, label: "Save draft" },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setPublishMode(m.key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                  publishMode === m.key ? "bg-[#3b5bdb] text-white" : "bg-white/5 text-[#78788c]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {publishMode === "schedule" && (
            <input
              type="datetime-local"
              value={form.scheduledPublishAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledPublishAt: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void create()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb]"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : publishMode === "schedule" ? (
                <CalendarClock className="w-3.5 h-3.5" />
              ) : publishMode === "draft" ? (
                <Save className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {publishMode === "now"
                ? "Publish"
                : publishMode === "schedule"
                  ? "Schedule"
                  : "Save draft"}
            </button>
          </div>
        </div>
      )}

      <div className="text-[10px] text-[#46465a]">{filtered.length} items · HomeworkService</div>
      <div className="space-y-2">
        {filtered.map((h) => (
          <div key={h.id} className="p-4 bg-[#131316] border border-white/7 rounded-2xl space-y-2">
            <div className="flex justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold text-white">{h.title}</div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb]">
                    {WORK_KIND_LABELS[h.workKind ?? "homework"]}
                  </span>
                </div>
                <div className="text-[10px] text-[#78788c] mt-0.5">
                  {h.subject} · Due {h.dueDate ?? "—"} · {h.status ?? "draft"} · {h.priority}
                  {h.scheduledPublishAt
                    ? ` · sched ${new Date(h.scheduledPublishAt).toLocaleString()}`
                    : ""}
                </div>
              </div>
              <div className="text-right text-[10px] text-[#46465a]">
                {h.submitted}/{h.totalStudents} · {h.completionPct}%
                <div>
                  {h.graded} graded · {h.awaitingReview} to review · {h.returned} returned ·{" "}
                  {h.pending} missing
                </div>
              </div>
            </div>
            {h.description && (
              <div className="text-[10px] text-[#78788c] line-clamp-2">{h.description}</div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void openReview(h)}
                className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white/5 text-[#a0a0b0] flex items-center gap-1"
              >
                <Eye className="w-3 h-3" /> Submissions
              </button>
              {(h.status === "draft" || h.status === "scheduled") && ctx && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void runHwAction("Publish", () => HomeworkService.publish(ctx, h.id))}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#3b5bdb]/20 text-[#3b5bdb] flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Publish
                </button>
              )}
              {h.status === "published" && ctx && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void runHwAction("Unpublish", () => HomeworkService.unpublish(ctx, h.id))
                  }
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white/5 text-[#78788c]"
                >
                  Unpublish
                </button>
              )}
              {ctx && h.status !== "archived" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void runHwAction("Archive", () => HomeworkService.archive(ctx, h.id))}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white/5 text-[#c08a3a] flex items-center gap-1"
                >
                  <Archive className="w-3 h-3" /> Archive
                </button>
              )}
              {ctx && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void runHwAction("Duplicate", () => HomeworkService.duplicate(ctx, h.id))
                  }
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white/5 text-[#78788c] flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> Duplicate
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-xs text-[#46465a]">
            {items.length === 0 ? "No academic work yet." : "No items match this filter."}
          </div>
        )}
      </div>
    </div>
  );
}

/** @deprecated Use LiveAcademicWorkTab */
export function LiveHomeworkTab({ classId, subject }: { classId: string; subject: string }) {
  return <LiveAcademicWorkTab classId={classId} subject={subject} />;
}

/** @deprecated Use LiveAcademicWorkTab */
export function LiveAssignmentsTab({ classId, subject }: { classId: string; subject: string }) {
  return <LiveAcademicWorkTab classId={classId} subject={subject} />;
}
