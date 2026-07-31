import { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Send,
  Archive,
  CalendarClock,
  Lock,
  Unlock,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import {
  AttendanceService,
  AcademicProfileService,
  AnalyticsService,
  MarksService,
  TestService,
  TEST_KIND_LABELS,
  EXAM_TYPE_LABELS,
  type ClassStudentRow,
  type StudentAcademicProfile,
  type TestKind,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import type { ExamRecord } from "@/academic/repository/marksRepository";

export {
  LiveHomeworkTab,
  LiveAssignmentsTab,
  LiveAcademicWorkTab,
} from "./LiveHomeworkPanels";

type LiveStudent = ClassStudentRow & {
  attendancePct: number;
  examsAvgPct: number;
  homeworkCompletionPct: number;
};

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

const EXAM_TYPES = [
  "unit_test",
  "monthly_test",
  "mid_term",
  "half_yearly",
  "annual",
  "practical",
  "viva",
  "internal",
  "class_test",
] as const;

const TEST_KINDS = Object.keys(TEST_KIND_LABELS) as TestKind[];

/** Live roster + AcademicProfileService metrics. */
export function LiveStudentsTab({ classId }: { classId: string }) {
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<LiveStudent[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LiveStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !classId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const settled = await Promise.allSettled([
          AttendanceService.listClassStudents(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
        ]);
        if (cancelled) return;
        const students = settled[0].status === "fulfilled" ? settled[0].value : [];
        const profiles = settled[1].status === "fulfilled" ? settled[1].value : [];
        if (settled[0].status === "rejected") {
          throw settled[0].reason instanceof Error
            ? settled[0].reason
            : new Error("Failed to load students");
        }
        const byId = new Map(profiles.map((p) => [p.studentId, p]));
        setRows(
          students.map((s) => {
            const p = byId.get(s.id);
            return {
              ...s,
              attendancePct: Math.round(p?.attendancePct ?? 0),
              examsAvgPct: Math.round(p?.examsAvgPct ?? 0),
              homeworkCompletionPct: Math.round(p?.homeworkCompletionPct ?? 0),
            };
          }),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load students");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.rollNumber ?? "").toLowerCase().includes(q) ||
        (s.admissionNumber ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  if (loading) return <Loading label="Loading roster…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-8 text-center">{error}</div>;

  if (selected) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-[10px] text-[#78788c] hover:text-white"
        >
          <ChevronRight className="w-3 h-3 rotate-180" /> Back to Students
        </button>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 flex items-center gap-4">
          {selected.photoUrl ? (
            <img src={selected.photoUrl} alt="" className="w-14 h-14 rounded-2xl object-cover" />
          ) : (
            <InitialsAvatar name={selected.fullName} size="lg" />
          )}
          <div className="flex-1">
            <div className="text-base font-black text-white">{selected.fullName}</div>
            <div className="text-xs text-[#78788c] mt-0.5">
              Roll: {selected.rollNumber ?? "—"} · Admission: {selected.admissionNumber ?? "—"}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div
              className="text-lg font-black tabular-nums"
              style={{ color: selected.attendancePct >= 85 ? "#10b981" : "#cc5069" }}
            >
              {selected.attendancePct}%
            </div>
            <div className="text-[10px] text-[#78788c] mt-0.5">Attendance</div>
          </div>
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div className="text-lg font-black text-[#3b5bdb] tabular-nums">{selected.examsAvgPct}%</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">Exams avg</div>
          </div>
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div className="text-lg font-black text-white tabular-nums">{selected.homeworkCompletionPct}%</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">Homework</div>
          </div>
        </div>
        <p className="text-[9px] text-[#46465a]">Metrics from AcademicProfileService.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
        <Search className="w-3.5 h-3.5 text-[#46465a] shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or roll number…"
          className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none"
        />
      </div>
      <div className="text-[10px] text-[#46465a]">{filtered.length} students</div>
      <div className="space-y-2">
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s)}
            className="w-full flex items-center gap-3 p-3 bg-[#131316] border border-white/7 rounded-2xl hover:border-white/15 hover:bg-white/3 transition-all text-left group"
          >
            {s.photoUrl ? (
              <img src={s.photoUrl} alt="" className="w-9 h-9 rounded-xl object-cover" />
            ) : (
              <InitialsAvatar name={s.fullName} />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">{s.fullName}</div>
              <div className="text-[10px] text-[#78788c] mt-0.5">
                Roll: {s.rollNumber ?? "—"} · Admission: {s.admissionNumber ?? "—"}
              </div>
            </div>
            <div className="text-right">
              <div
                className="text-[10px] font-semibold"
                style={{ color: s.attendancePct >= 85 ? "#10b981" : "#cc5069" }}
              >
                {s.attendancePct}% att.
              </div>
              <div className="text-[10px] text-[#46465a]">Exams {s.examsAvgPct}%</div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[#46465a] group-hover:text-white" />
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-xs text-[#46465a]">No students in this class.</div>
        )}
      </div>
    </div>
  );
}

type TestRow = {
  id: string;
  title?: string;
  subject?: string;
  status?: string;
  test_kind?: string;
  duration_sec?: number;
  max_marks?: number | null;
  passing_marks?: number | null;
  chapters?: string[] | null;
  topics?: string[] | null;
  scheduled_publish_at?: string | null;
  created_at?: string | null;
};

export function LiveTestsTab({ classId, subject }: { classId: string; subject: string }) {
  const { ctx, ready } = useAcademicContext();
  const [tests, setTests] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishMode, setPublishMode] = useState<"now" | "schedule" | "draft">("now");
  const [form, setForm] = useState({
    title: "",
    testKind: "class_test" as TestKind,
    durationMin: "30",
    maxMarks: "",
    passingMarks: "",
    chapters: "",
    topics: "",
    scheduledPublishAt: "",
  });

  const reload = async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const t = await TestService.listForClass(ctx, classId);
      setTests((t ?? []) as TestRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId]);

  const createTest = async () => {
    if (!ctx || !form.title.trim()) return;
    if (publishMode === "schedule" && !form.scheduledPublishAt) {
      setError("Schedule datetime is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const durationSec = Math.max(60, Math.round(Number(form.durationMin || 30) * 60));
      const chapters = form.chapters
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const topics = form.topics
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const status =
        publishMode === "now" ? "published" : publishMode === "schedule" ? "scheduled" : "draft";
      await TestService.create(ctx, {
        classId,
        title: form.title.trim(),
        subject,
        testKind: form.testKind,
        duration_sec: durationSec,
        maxMarks: form.maxMarks ? Number(form.maxMarks) : null,
        passingMarks: form.passingMarks ? Number(form.passingMarks) : null,
        chapters,
        topics,
        status,
        scheduledPublishAt:
          publishMode === "schedule"
            ? new Date(form.scheduledPublishAt).toISOString()
            : null,
      });
      setForm({
        title: "",
        testKind: "class_test",
        durationMin: "30",
        maxMarks: "",
        passingMarks: "",
        chapters: "",
        topics: "",
        scheduledPublishAt: "",
      });
      setCreating(false);
      setPublishMode("now");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create test");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
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

  if (loading) return <Loading label="Loading tests…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-white">Tests</div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb]"
        >
          <Plus className="w-3 h-3" /> New test
        </button>
      </div>
      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      {creating && (
        <div className="bg-[#131316] border border-white/10 rounded-2xl p-4 space-y-2">
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title *"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={form.testKind}
              onChange={(e) => setForm((f) => ({ ...f, testKind: e.target.value as TestKind }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            >
              {TEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TEST_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              value={form.durationMin}
              onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
              placeholder="Duration (min)"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white w-28"
            />
            <input
              value={form.maxMarks}
              onChange={(e) => setForm((f) => ({ ...f, maxMarks: e.target.value }))}
              placeholder="Max marks"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white w-24"
            />
            <input
              value={form.passingMarks}
              onChange={(e) => setForm((f) => ({ ...f, passingMarks: e.target.value }))}
              placeholder="Passing"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white w-24"
            />
          </div>
          <input
            value={form.chapters}
            onChange={(e) => setForm((f) => ({ ...f, chapters: e.target.value }))}
            placeholder="Chapters (comma-separated)"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <input
            value={form.topics}
            onChange={(e) => setForm((f) => ({ ...f, topics: e.target.value }))}
            placeholder="Topics (comma-separated)"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <div className="flex flex-wrap gap-1">
            {(
              [
                { key: "now" as const, label: "Publish now" },
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
          <button
            type="button"
            disabled={saving}
            onClick={() => void createTest()}
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
            {publishMode === "now" ? "Publish" : publishMode === "schedule" ? "Schedule" : "Save draft"}
          </button>
        </div>
      )}

      <div className="text-[10px] text-[#46465a]">{tests.length} tests · TestService</div>
      <div className="space-y-2">
        {tests.map((t) => (
          <div key={t.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl space-y-2">
            <div className="flex justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-white">{t.title}</div>
                <div className="text-[10px] text-[#78788c]">
                  {t.subject || subject} ·{" "}
                  {TEST_KIND_LABELS[(t.test_kind as TestKind) ?? "class_test"] ?? t.test_kind} ·{" "}
                  {t.status ?? "—"}
                  {t.duration_sec ? ` · ${Math.round(t.duration_sec / 60)} min` : ""}
                  {t.max_marks != null ? ` · max ${t.max_marks}` : ""}
                </div>
              </div>
              <span
                className={cn(
                  "text-[9px] font-bold px-2 py-1 rounded-lg h-fit capitalize",
                  t.status === "published"
                    ? "bg-[#4aa87a]/15 text-[#4aa87a]"
                    : t.status === "scheduled"
                      ? "bg-[#6366f1]/15 text-[#6366f1]"
                      : t.status === "archived"
                        ? "bg-[#46465a]/40 text-[#78788c]"
                        : "bg-white/10 text-[#a0a0b0]",
                )}
              >
                {t.status ?? "draft"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ctx && (t.status === "draft" || t.status === "scheduled") && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void runAction("Publish", () => TestService.publish(ctx, t.id))}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#3b5bdb]/20 text-[#3b5bdb] flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Publish
                </button>
              )}
              {ctx && t.status !== "archived" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void runAction("Archive", () => TestService.archive(ctx, t.id))}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white/5 text-[#c08a3a] flex items-center gap-1"
                >
                  <Archive className="w-3 h-3" /> Archive
                </button>
              )}
            </div>
          </div>
        ))}
        {tests.length === 0 && <div className="text-xs text-[#46465a]">No tests yet.</div>}
      </div>
    </div>
  );
}

export function LiveExamsMarksTab({ classId, subject }: { classId: string; subject: string }) {
  const { ctx, ready } = useAcademicContext();
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    examType: "unit_test",
    maxMarks: "100",
    passingMarks: "",
    examDate: "",
    instructions: "",
  });
  const [activeExam, setActiveExam] = useState<ExamRecord | null>(null);
  const [roster, setRoster] = useState<ClassStudentRow[]>([]);
  const [marksDraft, setMarksDraft] = useState<Record<string, string>>({});
  const [marksLoading, setMarksLoading] = useState(false);

  const reload = async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const list = await MarksService.listExamsForClass(ctx, classId, { limit: 100 });
      setExams(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId]);

  const createExam = async () => {
    if (!ctx || !form.name.trim()) return;
    if (!form.maxMarks || Number(form.maxMarks) <= 0) {
      setError("Max marks must be greater than 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await MarksService.upsertExam(ctx, {
        classId,
        name: form.name.trim(),
        subject: subject || "General",
        maxMarks: Number(form.maxMarks),
        passingMarks: form.passingMarks ? Number(form.passingMarks) : null,
        examDate: form.examDate || null,
        examType: form.examType,
        instructions: form.instructions || null,
      });
      setForm({
        name: "",
        examType: "unit_test",
        maxMarks: "100",
        passingMarks: "",
        examDate: "",
        instructions: "",
      });
      setCreating(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create exam");
    } finally {
      setSaving(false);
    }
  };

  const openMarks = async (exam: ExamRecord) => {
    if (!ctx) return;
    setActiveExam(exam);
    setMarksLoading(true);
    setError(null);
    try {
      const [students, existing] = await Promise.all([
        AttendanceService.listClassStudents(ctx, classId),
        MarksService.listForExam(ctx, exam.id),
      ]);
      setRoster(students);
      const draft: Record<string, string> = {};
      for (const m of existing) {
        draft[m.studentId] = String(m.marksObtained);
      }
      setMarksDraft(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load marks entry");
    } finally {
      setMarksLoading(false);
    }
  };

  const saveMarks = async () => {
    if (!ctx || !activeExam) return;
    if (activeExam.marksLocked) {
      setError("Marks are locked and cannot be edited");
      return;
    }
    const rows = Object.entries(marksDraft)
      .filter(([, v]) => v !== "" && !Number.isNaN(Number(v)))
      .map(([studentId, v]) => ({ studentId, marksObtained: Number(v) }));
    if (!rows.length) {
      setError("Enter at least one mark");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await MarksService.publishBatch(ctx, activeExam.id, rows);
      await reload();
      const refreshed = await MarksService.getExam(ctx, activeExam.id);
      setActiveExam(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save marks");
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!ctx || !activeExam) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await MarksService.finalizeMarks(ctx, activeExam.id);
      setActiveExam(updated);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      setSaving(false);
    }
  };

  const publishResults = async () => {
    if (!ctx || !activeExam) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await MarksService.publishResults(ctx, activeExam.id);
      setActiveExam(updated);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish results failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading exams…" />;

  if (activeExam) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setActiveExam(null)}
          className="text-[10px] font-bold text-[#3b5bdb]"
        >
          ← Back to exams
        </button>
        {error && (
          <div className="rounded-xl border border-[#cc5069]/30 bg-[#cc5069]/10 px-3 py-2 text-xs text-[#cc5069]">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold text-white">{activeExam.name}</div>
          {activeExam.marksLocked && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#c08a3a]/20 text-[#c08a3a] flex items-center gap-1">
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
          {activeExam.resultsPublishedAt && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#4aa87a]/20 text-[#4aa87a]">
              Results published
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#78788c]">
          Max {activeExam.maxMarks}
          {activeExam.passingMarks != null ? ` · pass ${activeExam.passingMarks}` : ""} ·{" "}
          {activeExam.examDate ?? "no date"}
        </div>

        {marksLoading ? (
          <Loading label="Loading roster…" />
        ) : (
          <div className="space-y-2">
            {roster.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 p-3 bg-[#131316] border border-white/7 rounded-xl"
              >
                <div className="text-xs text-white min-w-0 truncate">
                  {s.rollNumber ? `#${s.rollNumber} · ` : ""}
                  {s.fullName}
                </div>
                <input
                  type="number"
                  disabled={activeExam.marksLocked || saving}
                  value={marksDraft[s.id] ?? ""}
                  onChange={(e) =>
                    setMarksDraft((d) => ({ ...d, [s.id]: e.target.value }))
                  }
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white w-24 disabled:opacity-50"
                />
              </div>
            ))}
            {roster.length === 0 && (
              <div className="text-xs text-[#46465a] text-center py-8">No students in this class.</div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || activeExam.marksLocked}
            onClick={() => void saveMarks()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold bg-[#3b5bdb] text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save marks
          </button>
          <button
            type="button"
            disabled={saving || activeExam.marksLocked}
            onClick={() => void finalize()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold bg-[#c08a3a]/20 text-[#c08a3a] disabled:opacity-50"
          >
            <Lock className="w-3 h-3" /> Finalize
          </button>
          <button
            type="button"
            disabled={saving || !activeExam.marksLocked || !!activeExam.resultsPublishedAt}
            onClick={() => void publishResults()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold bg-[#4aa87a]/20 text-[#4aa87a] disabled:opacity-50"
          >
            <Unlock className="w-3 h-3" /> Publish Results
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-white">Exams & Marks</div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb]"
        >
          <Plus className="w-3 h-3" /> New exam
        </button>
      </div>
      {error && (
        <div className="rounded-xl border border-[#cc5069]/30 bg-[#cc5069]/10 px-3 py-2 text-xs text-[#cc5069]">
          {error}
        </div>
      )}

      {creating && (
        <div className="bg-[#131316] border border-white/10 rounded-2xl p-4 space-y-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Exam name *"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={form.examType}
              onChange={(e) => setForm((f) => ({ ...f, examType: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            >
              {EXAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EXAM_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
            <input
              value={form.maxMarks}
              onChange={(e) => setForm((f) => ({ ...f, maxMarks: e.target.value }))}
              placeholder="Max marks"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white w-24"
            />
            <input
              value={form.passingMarks}
              onChange={(e) => setForm((f) => ({ ...f, passingMarks: e.target.value }))}
              placeholder="Passing"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white w-24"
            />
            <input
              type="date"
              value={form.examDate}
              onChange={(e) => setForm((f) => ({ ...f, examDate: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            />
          </div>
          <textarea
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            placeholder="Instructions"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[50px]"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void createExam()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb]"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create exam
          </button>
        </div>
      )}

      <div className="text-[10px] text-[#46465a]">{exams.length} exams · MarksService</div>
      <div className="space-y-2">
        {exams.map((e) => (
          <div key={e.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl space-y-2">
            <div className="flex justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-white">{e.name}</div>
                <div className="text-[10px] text-[#78788c]">
                  {e.subject} · {EXAM_TYPE_LABELS[e.examType ?? ""] ?? e.examType ?? "—"} · max{" "}
                  {e.maxMarks} · {e.examDate ?? "—"}
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                {e.marksLocked && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#c08a3a]/20 text-[#c08a3a]">
                    Locked
                  </span>
                )}
                {e.resultsPublishedAt && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#4aa87a]/20 text-[#4aa87a]">
                    Results published
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void openMarks(e)}
              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb]"
            >
              Enter / review marks
            </button>
          </div>
        ))}
        {exams.length === 0 && <div className="text-xs text-[#46465a]">No exams yet.</div>}
      </div>
    </div>
  );
}

export function LiveInsightsTab({ classId }: { classId: string }) {
  const { ctx, ready } = useAcademicContext();
  const [analytics, setAnalytics] = useState<Awaited<
    ReturnType<typeof AnalyticsService.forClass>
  > | null>(null);
  const [profiles, setProfiles] = useState<StudentAcademicProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const settled = await Promise.allSettled([
          AnalyticsService.forClass(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
        ]);
        if (cancelled) return;
        const a = settled[0].status === "fulfilled" ? settled[0].value : null;
        const p = settled[1].status === "fulfilled" ? settled[1].value : [];
        if (settled[0].status === "rejected" && settled[1].status === "rejected") {
          throw new Error("Failed to load insights");
        }
        setAnalytics(a);
        setProfiles(p);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load insights");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId]);

  if (loading) return <Loading label="Loading analytics…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-8 text-center">{error}</div>;
  if (!analytics) return null;

  const top = [...profiles].sort((a, b) => b.examsAvgPct - a.examsAvgPct).slice(0, 3);
  const low = [...profiles].sort((a, b) => a.attendancePct - b.attendancePct).slice(0, 3);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#3b5bdb]">{Math.round(analytics.avgExamsPct)}%</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Avg Exams</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div
            className="text-xl font-black"
            style={{ color: analytics.avgAttendancePct >= 85 ? "#10b981" : "#cc5069" }}
          >
            {Math.round(analytics.avgAttendancePct)}%
          </div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Avg Attendance</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#6366f1]">
            {Math.round(analytics.avgHomeworkCompletionPct)}%
          </div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Homework Completion</div>
        </div>
      </div>
      <p className="text-[9px] text-[#46465a]">
        AnalyticsService.forClass · {analytics.studentCount} profiles
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Top by exams</div>
          {top.map((p) => (
            <div key={p.studentId} className="text-[10px] text-[#78788c] py-1">
              {p.studentId.slice(0, 8)}… · {Math.round(p.examsAvgPct)}%
            </div>
          ))}
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Lowest attendance</div>
          {low.map((p) => (
            <div key={p.studentId} className="text-[10px] text-[#78788c] py-1">
              {p.studentId.slice(0, 8)}… · {Math.round(p.attendancePct)}%
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
