import { useEffect, useRef, useState } from "react";
import {
  Building2, X, Loader2, UserCheck,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import {
  AnalyticsService,
  AttendanceService,
  useAcademicLive,
  type AttendanceStatus,
  type ClassStudentRow,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { localDateKey } from "@/lib/localDate";
import { toErrorMessage } from "@/lib/presentation";

type LiveClass = {
  classId: string;
  className: string;
  section: string;
  studentCount: number;
  avgAttendancePct: number;
  avgHomeworkCompletionPct: number;
  avgExamsPct: number;
  dayRatePct: number | null;
};

function AttendancePanel({
  liveClass,
  onClose,
}: {
  liveClass: LiveClass;
  onClose: () => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [statusByStudent, setStatusByStudent] = useState<Record<string, AttendanceStatus | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [roster, records] = await Promise.all([
          AttendanceService.listClassStudents(ctx, liveClass.classId),
          AttendanceService.listForClassDate(ctx, liveClass.classId, selectedDate),
        ]);
        if (cancelled) return;
        const map: Record<string, AttendanceStatus | undefined> = {};
        roster.forEach((s) => {
          map[s.id] = records.find((r) => r.studentId === s.id)?.status as AttendanceStatus | undefined;
        });
        setStudents(roster);
        setStatusByStudent(map);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Failed to load attendance"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, selectedDate, liveClass.classId]);

  async function save() {
    if (!ctx) return;
    const toSave = students
      .filter((s) => statusByStudent[s.id] != null)
      .map((s) => ({
        studentId: s.id,
        classId: liveClass.classId,
        date: selectedDate,
        status: statusByStudent[s.id]!,
      }));
    const unmarkedCount = students.length - toSave.length;
    if (toSave.length === 0) {
      setError("No students are marked yet — nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await AttendanceService.markBulk(ctx, toSave);
      if (unmountedRef.current) return;
      setFlash(
        unmarkedCount > 0
          ? `Saved ${toSave.length} of ${students.length} — ${unmarkedCount} still unmarked`
          : "Saved via AttendanceService",
      );
      setTimeout(() => {
        if (!unmountedRef.current) setFlash(null);
      }, 2500);
    } catch (e) {
      if (!unmountedRef.current) setError(toErrorMessage(e, "Save failed"));
    } finally {
      if (!unmountedRef.current) setSaving(false);
    }
  }

  const presentCount = Object.values(statusByStudent).filter(
    (s) => s === "present",
  ).length;
  const absentCount = Object.values(statusByStudent).filter((s) => s === "absent").length;
  const unmarkedCount = Object.values(statusByStudent).filter((s) => s == null).length;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-96 sm:w-[480px] bg-card border-l border-border flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-border/70 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#3b5bdb]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground">
              Attendance — {liveClass.className} {liveClass.section}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Class ID · {liveClass.classId.slice(0, 8)}… · AttendanceService
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">
              Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#3b5bdb]/50"
            />
          </div>

          {flash && <div className="text-xs text-[#4aa87a] font-semibold">{flash}</div>}
          {error && <div className="text-xs text-[#cc5069]">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading roster…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-3 rounded-xl bg-muted text-center">
                  <div className="text-lg font-black text-foreground">{students.length}</div>
                  <div className="text-[9px] text-muted-foreground">Total</div>
                </div>
                <div className="p-3 rounded-xl bg-[#4aa87a]/10 text-center">
                  <div className="text-lg font-black text-[#4aa87a]">{presentCount}</div>
                  <div className="text-[9px] text-muted-foreground">Present+</div>
                </div>
                <div className="p-3 rounded-xl bg-[#cc5069]/10 text-center">
                  <div className="text-lg font-black text-[#cc5069]">{absentCount}</div>
                  <div className="text-[9px] text-muted-foreground">Absent</div>
                </div>
                <div className="p-3 rounded-xl bg-muted text-center">
                  <div className="text-lg font-black text-muted-foreground">{unmarkedCount}</div>
                  <div className="text-[9px] text-muted-foreground">Unmarked</div>
                </div>
              </div>

              {students.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">No students in this class</div>
              ) : (
                <div className="space-y-2">
                  {students.map((s) => {
                    const status = statusByStudent[s.id];
                    const present = status === "present";
                    return (
                      <div key={s.id} className="bg-muted rounded-xl p-3 flex items-center gap-3">
                        <InitialsAvatar name={s.fullName} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-foreground">{s.fullName}</div>
                          <div className="text-[9px] text-muted-foreground">{s.rollNumber ?? "—"}</div>
                        </div>
                        <select
                          value={status ?? ""}
                          onChange={(e) =>
                            setStatusByStudent((prev) => ({
                              ...prev,
                              [s.id]: e.target.value === "" ? undefined : (e.target.value as AttendanceStatus),
                            }))
                          }
                          className={cn(
                            "px-2 py-1 rounded-lg text-xs font-bold bg-muted border border-border",
                            status == null ? "text-muted-foreground" : present ? "text-[#4aa87a]" : "text-[#cc5069]",
                          )}
                        >
                          <option value="">Unmarked</option>
                          <option value="present">Present</option>
                          <option value="absent">Absent</option>
                                                                                                      </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border/70">
          <button
            disabled={saving || loading || students.length === 0}
            onClick={() => void save()}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save via AttendanceService"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClassRosterDrawer({
  liveClass,
  onClose,
  onAttendance,
}: {
  liveClass: LiveClass;
  onClose: () => void;
  onAttendance: () => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const roster = await AttendanceService.listClassStudents(ctx, liveClass.classId);
        if (!cancelled) setStudents(roster);
      } catch (e) {
        if (!cancelled) {
          setStudents([]);
          setError(toErrorMessage(e, "Failed to load roster"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveClass.classId, retryKey]);

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-card border-l border-border flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-border/70 flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-[#3b5bdb]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground">
              {liveClass.className} — {liveClass.section}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {liveClass.studentCount} students · engine roster
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-4 border-b border-border/70">
          {[
            { label: "Profile att.", value: `${Math.round(liveClass.avgAttendancePct)}%` },
            { label: "Today day-rate", value: liveClass.dayRatePct != null ? `${liveClass.dayRatePct}%` : "—" },
            { label: "Homework", value: `${Math.round(liveClass.avgHomeworkCompletionPct)}%` },
            { label: "Exams", value: `${Math.round(liveClass.avgExamsPct)}%` },
          ].map((item) => (
            <div key={item.label} className="p-3 rounded-xl bg-muted text-center">
              <div className="text-sm font-black text-foreground">{item.value}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-xs text-center pt-8 space-y-2">
              <div className="text-[#cc5069]">{error}</div>
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-foreground bg-muted hover:bg-muted/80"
              >
                Retry
              </button>
            </div>
          ) : students.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center pt-8">No students in this class</div>
          ) : (
            students.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted">
                <InitialsAvatar name={s.fullName} size="sm" />
                <div>
                  <div className="text-xs font-semibold text-foreground">{s.fullName}</div>
                  <div className="text-[9px] text-muted-foreground">{s.rollNumber ?? s.admissionNumber ?? "—"}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-border/70">
          <button
            onClick={onAttendance}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#4b9fd4] bg-[#4b9fd4]/10 hover:bg-[#4b9fd4]/20 flex items-center justify-center gap-2"
          >
            <UserCheck className="w-4 h-4" /> Manage Attendance
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin Classes — live Academic Engine only (class IDs, roster, attendance).
 * No mock name matching.
 */
export default function Classes() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "homework", "marks", "examination", "profile"]);
  const [rows, setRows] = useState<LiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveClass | null>(null);
  const [attendance, setAttendance] = useState<LiveClass | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = localDateKey();
        const settled = await Promise.allSettled([
          AnalyticsService.classRollups(ctx),
          AttendanceService.summarizeSchoolDate(ctx, today),
        ]);
        if (cancelled) return;
        const rollups = settled[0].status === "fulfilled" ? settled[0].value : [];
        const day = settled[1].status === "fulfilled" ? settled[1].value : null;
        if (settled[0].status === "rejected" && settled[1].status === "rejected") {
          throw new Error("Failed to load classes");
        }
        const dayById = new Map((day?.classes ?? []).map((c) => [c.classId, c]));
        setRows(
          rollups.map((r) => ({
            classId: r.classId,
            className: r.className,
            section: r.section,
            studentCount: r.studentCount,
            avgAttendancePct: r.avgAttendancePct,
            avgHomeworkCompletionPct: r.avgHomeworkCompletionPct,
            avgExamsPct: r.avgExamsPct,
            dayRatePct: dayById.get(r.classId)?.dayRatePct ?? null,
          })),
        );
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Failed to load classes"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        {rows.length} live classes · AnalyticsService.classRollups · AttendanceService
      </div>

      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading classes…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-16 text-center">No classes in this school yet.</div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((c) => (
            <div
              key={c.classId}
              className="bg-surface border border-border/70 rounded-2xl p-4 hover:border-border transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-foreground">
                    {c.className}-{c.section}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                    {c.classId.slice(0, 8)}…
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-[#4aa87a]">
                    {c.dayRatePct != null ? `${c.dayRatePct}%` : "—"}
                  </div>
                  <div className="text-[9px] text-muted-foreground">Today</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="text-center p-2 rounded-lg bg-muted">
                  <div className="text-xs font-bold text-foreground">{c.studentCount}</div>
                  <div className="text-[8px] text-muted-foreground">Students</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted">
                  <div className="text-xs font-bold text-foreground">{Math.round(c.avgAttendancePct)}%</div>
                  <div className="text-[8px] text-muted-foreground">Profile att.</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted">
                  <div className="text-xs font-bold text-foreground">{Math.round(c.avgExamsPct)}%</div>
                  <div className="text-[8px] text-muted-foreground">Exams</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setDetail(c)}
                  className="flex-1 py-2 rounded-xl text-[10px] font-bold text-foreground bg-muted hover:bg-muted/80"
                >
                  Roster
                </button>
                <button
                  onClick={() => setAttendance(c)}
                  className="flex-1 py-2 rounded-xl text-[10px] font-bold text-[#4b9fd4] bg-[#4b9fd4]/10 hover:bg-[#4b9fd4]/20"
                >
                  Attendance
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <ClassRosterDrawer
          liveClass={detail}
          onClose={() => setDetail(null)}
          onAttendance={() => {
            setAttendance(detail);
            setDetail(null);
          }}
        />
      )}
      {attendance && (
        <AttendancePanel liveClass={attendance} onClose={() => setAttendance(null)} />
      )}
    </div>
  );
}
