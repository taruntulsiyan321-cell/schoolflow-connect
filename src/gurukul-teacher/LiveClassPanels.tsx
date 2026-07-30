import { useEffect, useMemo, useState } from "react";
import { Search, ChevronRight, Loader2, Plus, Save } from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import {
  AttendanceService,
  AcademicProfileService,
  AnalyticsService,
  HomeworkService,
  AssignmentService,
  MarksService,
  TestService,
  type ClassStudentRow,
  type StudentAcademicProfile,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

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
        const [students, profiles] = await Promise.all([
          AttendanceService.listClassStudents(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
        ]);
        if (cancelled) return;
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

function LiveHomeworkList({
  classId,
  subjectDefault,
  title,
}: {
  classId: string;
  subjectDefault: string;
  title: string;
}) {
  const { ctx, ready } = useAcademicContext();
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof HomeworkService.listForClassWithStats>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", dueDate: "" });
  const [saving, setSaving] = useState(false);

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

  const create = async () => {
    if (!ctx || !form.title.trim()) return;
    setSaving(true);
    try {
      await HomeworkService.assign(ctx, {
        classId,
        subject: subjectDefault || "General",
        title: form.title.trim(),
        description: form.description,
        dueDate: form.dueDate || null,
      });
      setForm({ title: "", description: "", dueDate: "" });
      setCreating(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label={`Loading ${title.toLowerCase()}…`} />;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-[#cc5069]">{error}</div>}
      <div className="flex justify-between items-center">
        <div className="text-[10px] text-[#46465a]">{items.length} items · HomeworkService</div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb]"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>
      {creating && (
        <div className="bg-[#131316] border border-white/10 rounded-2xl p-4 space-y-2">
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[60px]"
          />
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void create()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb]"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save via HomeworkService
          </button>
        </div>
      )}
      <div className="space-y-2">
        {items.map((h) => (
          <div key={h.id} className="p-4 bg-[#131316] border border-white/7 rounded-2xl">
            <div className="flex justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">{h.title}</div>
                <div className="text-[10px] text-[#78788c] mt-0.5">
                  {h.subject} · Due {h.dueDate ?? "—"} · {h.status ?? "active"}
                </div>
              </div>
              <div className="text-right text-[10px] text-[#46465a]">
                {h.submitted}/{h.totalStudents} submitted
                <div>{h.graded} graded · {h.pending} pending</div>
              </div>
            </div>
            {h.description && (
              <div className="text-[10px] text-[#78788c] mt-2 line-clamp-2">{h.description}</div>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-xs text-[#46465a]">No {title.toLowerCase()} yet.</div>
        )}
      </div>
    </div>
  );
}

export function LiveHomeworkTab({ classId, subject }: { classId: string; subject: string }) {
  return <LiveHomeworkList classId={classId} subjectDefault={subject} title="Homework" />;
}

export function LiveAssignmentsTab({ classId, subject }: { classId: string; subject: string }) {
  // Product alias: Assignment → HomeworkService
  void AssignmentService;
  return <LiveHomeworkList classId={classId} subjectDefault={subject} title="Assignments" />;
}

export function LiveTestsTab({ classId, subject }: { classId: string; subject: string }) {
  const { ctx, ready } = useAcademicContext();
  const [tests, setTests] = useState<any[]>([]);
  const [exams, setExams] = useState<Awaited<ReturnType<typeof MarksService.listExamsForClass>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const [t, e] = await Promise.all([
        TestService.listForClass(ctx, classId),
        MarksService.listExamsForClass(ctx, classId, { limit: 50 }),
      ]);
      setTests(t);
      setExams(e);
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
    if (!ctx || !title.trim()) return;
    setSaving(true);
    try {
      await TestService.create(ctx, { classId, title: title.trim(), subject });
      setTitle("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create test");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading tests…" />;

  return (
    <div className="space-y-5">
      {error && <div className="text-xs text-[#cc5069]">{error}</div>}
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New test title"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void createTest()}
          className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb]"
        >
          Create via TestService
        </button>
      </div>
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-2">
          Class tests (dpps)
        </div>
        <div className="space-y-2">
          {tests.map((t) => (
            <div key={t.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl">
              <div className="text-xs font-bold text-white">{t.title}</div>
              <div className="text-[10px] text-[#78788c]">
                {t.subject || subject} · {t.difficulty ?? "—"}
              </div>
            </div>
          ))}
          {tests.length === 0 && <div className="text-xs text-[#46465a]">No tests yet.</div>}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-2">
          Examinations (MarksService)
        </div>
        <div className="space-y-2">
          {exams.map((e) => (
            <div key={e.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl">
              <div className="text-xs font-bold text-white">{e.name}</div>
              <div className="text-[10px] text-[#78788c]">
                {e.subject} · max {e.maxMarks} · {e.examDate ?? "—"}
              </div>
            </div>
          ))}
          {exams.length === 0 && <div className="text-xs text-[#46465a]">No exams yet.</div>}
        </div>
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
        const [a, p] = await Promise.all([
          AnalyticsService.forClass(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
        ]);
        if (cancelled) return;
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
