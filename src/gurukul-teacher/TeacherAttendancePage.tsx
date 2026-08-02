import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Search,
  Save,
  Check,
  Loader2,
  ChevronLeft,
  Users,
  AlertCircle,
  Eye,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import {
  AttendanceService,
  type AssignedClass,
  type AttendanceStatus,
  type ClassStudentRow,
} from "@/academic/services/attendanceService";
import { useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  short: string;
  color: string;
}[] = [
  { value: "present", label: "Present", short: "P", color: "#10b981" },
  { value: "absent", label: "Absent", short: "A", color: "#cc5069" },
  { value: "late", label: "Late", short: "L", color: "#f59e0b" },
  { value: "half_day", label: "Half Day", short: "H", color: "#6366f1" },
];

type SortKey = "roll" | "name" | "status";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export interface TeacherAttendanceWorkspaceProps {
  fixedClassId?: string;
  showBackLink?: boolean;
}

/**
 * Teacher Attendance — present by default, one-click absence, clear save states.
 */
export function TeacherAttendanceWorkspace({
  fixedClassId,
  showBackLink = true,
}: TeacherAttendanceWorkspaceProps) {
  const navigate = useNavigate();
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);

  const [classes, setClasses] = useState<AssignedClass[]>([]);
  const [classId, setClassId] = useState<string | null>(fixedClassId ?? null);
  const [date, setDate] = useState(todayIso());
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [savedMarks, setSavedMarks] = useState<Record<string, AttendanceStatus>>({});
  const [hadSubmittedRows, setHadSubmittedRows] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("roll");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (fixedClassId) setClassId(fixedClassId);
  }, [fixedClassId]);

  const selected = classes.find((c) => c.id === classId) ?? null;
  const canMark = !!selected?.isClassTeacher;

  const showFlash = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2800);
  };

  const loadClasses = useCallback(async () => {
    if (!ctx) return;
    setError(null);
    try {
      const list = await AttendanceService.listAssignedClasses(ctx);
      setClasses(list);
      if (fixedClassId) {
        if (!list.some((c) => c.id === fixedClassId)) {
          setError("You are not assigned to this class.");
          setClassId(null);
        }
        return;
      }
      if (!classId && list[0]) setClassId(list[0].id);
      if (classId && !list.some((c) => c.id === classId)) {
        setClassId(list[0]?.id ?? null);
        setError("You are not assigned to that class.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assigned classes");
      setClasses([]);
    }
  }, [ctx, classId, fixedClassId]);

  const loadRoster = useCallback(async () => {
    if (!ctx || !classId) {
      setStudents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [roster, existing] = await Promise.all([
        AttendanceService.listClassStudents(ctx, classId),
        AttendanceService.listForClassDate(ctx, classId, date),
      ]);
      setStudents(roster);
      setHadSubmittedRows(existing.length > 0);
      const next: Record<string, AttendanceStatus> = {};
      for (const s of roster) {
        const rec = existing.find((r) => r.studentId === s.id);
        next[s.id] = (rec?.status as AttendanceStatus) ?? "present";
      }
      setMarks(next);
      setSavedMarks({ ...next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attendance");
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [ctx, classId, date, liveVersion]);

  useEffect(() => {
    if (!ready || !ctx) return;
    void loadClasses();
  }, [ready, ctx, loadClasses]);

  useEffect(() => {
    if (!ready || !ctx || !classId) return;
    void loadRoster();
  }, [ready, ctx, classId, date, loadRoster, liveVersion]);

  const dirty = useMemo(
    () => students.some((s) => marks[s.id] !== savedMarks[s.id]),
    [students, marks, savedMarks],
  );

  const saveState: "unsaved" | "saved" | "submitted" | "readonly" = !canMark
    ? "readonly"
    : dirty
      ? "unsaved"
      : hadSubmittedRows
        ? "submitted"
        : "saved";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = students.filter((s) => {
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        (s.rollNumber ?? "").toLowerCase().includes(q) ||
        (s.admissionNumber ?? "").toLowerCase().includes(q)
      );
    });
    rows = [...rows].sort((a, b) => {
      if (sortKey === "name") return a.fullName.localeCompare(b.fullName);
      if (sortKey === "status") return (marks[a.id] ?? "").localeCompare(marks[b.id] ?? "");
      return (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "", undefined, { numeric: true });
    });
    return rows;
  }, [students, search, sortKey, marks]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0 };
    for (const s of students) {
      const st = marks[s.id] ?? "present";
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [students, marks]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    if (!canMark) return;
    setMarks((m) => ({ ...m, [studentId]: status }));
  };

  const toggleAbsent = (studentId: string) => {
    if (!canMark) return;
    setMarks((m) => {
      const cur = m[studentId] ?? "present";
      return { ...m, [studentId]: cur === "absent" ? "present" : "absent" };
    });
  };

  const markAllPresent = () => {
    if (!canMark) return;
    const next: Record<string, AttendanceStatus> = {};
    for (const s of students) next[s.id] = "present";
    setMarks(next);
  };

  const save = async () => {
    if (!ctx || !classId || !canMark) return;
    setSaving(true);
    setError(null);
    try {
      await AttendanceService.markBulk(
        ctx,
        students.map((s) => ({
          studentId: s.id,
          classId,
          date,
          status: marks[s.id] ?? "present",
        })),
      );
      setSavedMarks({ ...marks });
      setHadSubmittedRows(true);
      showFlash("Attendance saved");
      await loadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading session…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          {showBackLink && !fixedClassId && (
            <button
              type="button"
              onClick={() => navigate("/teacher/classes")}
              className="flex items-center gap-1.5 text-[10px] text-[#78788c] hover:text-white mb-2"
            >
              <ChevronLeft className="w-3 h-3" /> My Classes
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-black text-white">Attendance</h2>
            {!canMark && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-lg bg-white/10 text-[#a0a0b0]">
                <Eye className="w-3 h-3" /> Read Only
              </span>
            )}
          </div>
          <p className="text-[10px] text-[#46465a] mt-0.5">
            {canMark
              ? "Everyone starts Present. Tap Absent for absentees — then Save."
              : "View only. Only the class teacher can mark attendance."}
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-[#131316] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
        />
      </div>

      {flash && (
        <div className="px-4 py-2.5 rounded-xl bg-[#10b981]/15 text-[#10b981] text-xs font-semibold flex items-center gap-2">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}
      {error && (
        <div className="px-4 py-2.5 rounded-xl bg-[#cc5069]/15 text-[#cc5069] text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {!fixedClassId && (
        <div className="flex gap-2 flex-wrap">
          {classes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setClassId(c.id);
                navigate(`/teacher/classes/${c.id}/attendance`, { replace: true });
              }}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all",
                classId === c.id
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "bg-[#131316] border-white/7 text-[#78788c] hover:border-white/15 hover:text-white",
              )}
            >
              <Users className="w-3.5 h-3.5" />
              {c.name} {c.section}
              {c.subject ? ` · ${c.subject}` : ""}
              {c.isClassTeacher && (
                <span className="text-[8px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-1 py-0.5 rounded-full">
                  CT
                </span>
              )}
            </button>
          ))}
          {classes.length === 0 && !loading && (
            <div className="text-xs text-[#78788c]">
              No classes assigned. Ask admin to map Teacher–Class–Subject.
            </div>
          )}
        </div>
      )}

      {(selected || fixedClassId) && (
        <div className="flex flex-wrap gap-3 items-center justify-between sticky top-0 z-10 py-2 bg-[#0c0c0e]/95 backdrop-blur-sm">
          <div className="flex gap-2 flex-wrap items-center">
            {STATUS_OPTIONS.map((s) => (
              <div
                key={s.value}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold"
                style={{ background: `${s.color}15`, color: s.color }}
              >
                {counts[s.value] ?? 0} {s.label}
              </div>
            ))}
            <span
              className={cn(
                "text-[10px] font-bold px-2.5 py-1 rounded-lg",
                saveState === "unsaved" && "bg-[#f59e0b]/20 text-[#f59e0b]",
                saveState === "saved" && "bg-[#10b981]/15 text-[#10b981]",
                saveState === "submitted" && "bg-[#3b5bdb]/15 text-[#3b5bdb]",
                saveState === "readonly" && "bg-white/10 text-[#a0a0b0]",
              )}
            >
              {saveState === "unsaved" && "Unsaved Changes"}
              {saveState === "saved" && "Saved"}
              {saveState === "submitted" && "Attendance Already Submitted"}
              {saveState === "readonly" && "Read Only"}
            </span>
          </div>
          <div className="flex gap-2">
            {canMark && (
              <button
                type="button"
                onClick={markAllPresent}
                className="px-3 py-2 rounded-xl text-[10px] font-bold bg-white/5 text-[#78788c] hover:text-white hover:bg-white/10"
              >
                All Present
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canMark || saving || students.length === 0}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold disabled:cursor-not-allowed",
                canMark
                  ? dirty
                    ? "text-black bg-[#3b5bdb] hover:bg-[#6882e8]"
                    : "text-white bg-[#3b5bdb]/40"
                  : "text-[#78788c] bg-white/5 opacity-60",
              )}
              title={
                !canMark
                  ? "Read only — class teacher marks attendance"
                  : dirty
                    ? "Save unsaved changes"
                    : "Already saved — click to re-save"
              }
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Attendance
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-[#46465a] shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or roll…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none"
          />
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="bg-[#131316] border border-white/10 rounded-xl px-3 py-2 text-xs text-[#78788c]"
        >
          <option value="roll">Sort: Roll</option>
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
        </select>
        <div className="text-[10px] text-[#46465a]">{filtered.length} students</div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#78788c] text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading roster…
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => {
            const status = marks[s.id] ?? "present";
            const isAbsent = status === "absent";
            const isPresent = status === "present";
            return (
              <div
                key={s.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                  isAbsent
                    ? "bg-[#cc5069]/10 border-[#cc5069]/30"
                    : isPresent
                      ? "bg-[#10b981]/8 border-[#10b981]/20"
                      : "bg-[#131316] border-white/7",
                )}
              >
                {s.photoUrl ? (
                  <img src={s.photoUrl} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
                ) : (
                  <InitialsAvatar name={s.fullName} size="sm" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{s.fullName}</div>
                  <div className="text-[10px] text-[#46465a]">
                    Roll {s.rollNumber ?? "—"}
                    {s.admissionNumber ? ` · ${s.admissionNumber}` : ""}
                  </div>
                </div>

                {canMark ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleAbsent(s.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-bold min-w-[72px]",
                        isAbsent
                          ? "bg-[#cc5069] text-white"
                          : "bg-white/5 text-[#78788c] hover:bg-[#cc5069]/20 hover:text-[#cc5069]",
                      )}
                    >
                      {isAbsent ? "Absent" : "Mark Absent"}
                    </button>
                    <div className="flex gap-0.5">
                      {STATUS_OPTIONS.filter((o) => o.value !== "absent").map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setStatus(s.id, opt.value)}
                          title={opt.label}
                          className={cn(
                            "w-7 h-7 rounded-lg text-[9px] font-bold transition-all",
                            status === opt.value ? "text-white" : "text-[#46465a] bg-white/3 hover:bg-white/8",
                          )}
                          style={
                            status === opt.value
                              ? { background: `${opt.color}35`, color: opt.color }
                              : undefined
                          }
                        >
                          {opt.short}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg"
                    style={{
                      color: STATUS_OPTIONS.find((o) => o.value === status)?.color,
                      background: `${STATUS_OPTIONS.find((o) => o.value === status)?.color ?? "#78788c"}18`,
                    }}
                  >
                    {STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}
                  </span>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-xs text-[#46465a]">No students in this class.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeacherAttendancePage() {
  const { classId } = useParams<{ classId?: string }>();
  return <TeacherAttendanceWorkspace fixedClassId={classId} showBackLink />;
}
