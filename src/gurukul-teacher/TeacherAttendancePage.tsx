import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { toErrorMessage } from "@/lib/presentation";

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
  { value: "leave", label: "Leave", short: "Lv", color: "#c08a3a" },
];

type SortKey = "roll" | "name" | "status";

function todayIso() {
  // Local calendar date, not UTC â€” the app is IST throughout, and
  // Dashboard's "attendance pending today" check uses the same local
  // definition of "today" (see TeacherHome's todayIsoDate in Dashboard.tsx).
  // Using toISOString() here would roll over to the next day before local
  // midnight (IST is UTC+5:30), showing the wrong default date late in
  // the evening.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface TeacherAttendanceWorkspaceProps {
  fixedClassId?: string;
  showBackLink?: boolean;
}

/**
 * Teacher Attendance â€” present by default, one-click absence, clear save states.
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
  const dirtyRef = useRef(false);
  const rosterKeyRef = useRef("");

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
      setError(toErrorMessage(e, "Failed to load assigned classes"));
      setClasses([]);
    }
  }, [ctx, classId, fixedClassId]);

  const loadRoster = useCallback(async () => {
    if (!ctx || !classId) {
      setStudents([]);
      setLoading(false);
      return;
    }
    const key = `${classId}|${date}`;
    const keyChanged = rosterKeyRef.current !== key;
    const quiet = !keyChanged && rosterKeyRef.current !== "";
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [roster, existing] = await Promise.all([
        AttendanceService.listClassStudents(ctx, classId),
        AttendanceService.listForClassDate(ctx, classId, date),
      ]);
      setStudents(roster);
      const next: Record<string, AttendanceStatus> = {};
      for (const s of roster) {
        const rec = existing.find((r) => r.studentId === s.id);
        next[s.id] = (rec?.status as AttendanceStatus) ?? "present";
      }
      // Never clobber in-progress marks on a quiet live refresh.
      if (keyChanged || !dirtyRef.current) {
        setHadSubmittedRows(existing.length > 0);
        setMarks(next);
        setSavedMarks({ ...next });
      }
      rosterKeyRef.current = key;
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load attendance"));
      setStudents([]);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [ctx, classId, date]);

  useEffect(() => {
    if (!ready || !ctx) return;
    void loadClasses();
  }, [ready, ctx, loadClasses]);

  useEffect(() => {
    if (!ready || !ctx || !classId) return;
    void loadRoster();
  }, [ready, ctx, classId, date, loadRoster]);

  useEffect(() => {
    if (!ready || !ctx || !classId || !rosterKeyRef.current) return;
    void loadRoster();
  }, [liveVersion, ready, ctx, classId, loadRoster]);

  const dirty = useMemo(
    () => students.some((s) => marks[s.id] !== savedMarks[s.id]),
    [students, marks, savedMarks],
  );

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const saveState: "unsaved" | "draft" | "submitted" | "readonly" = !canMark
    ? "readonly"
    : dirty
      ? "unsaved"
      : hadSubmittedRows
        ? "submitted"
        : "draft";

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

  const confirmDiscardIfDirty = () => {
    if (!dirtyRef.current) return true;
    return window.confirm(
      "You have unsaved attendance changes that will be lost if you switch now. Continue without saving?",
    );
  };

  const changeClass = (id: string) => {
    if (id === classId) return;
    if (!confirmDiscardIfDirty()) return;
    setClassId(id);
    navigate(`/teacher/classes/${id}/attendance`, { replace: true });
  };

  const changeDate = (nextDate: string) => {
    if (nextDate === date) return;
    if (!confirmDiscardIfDirty()) return;
    setDate(nextDate);
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
      setError(toErrorMessage(e, "Failed to save attendance"));
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sessionâ€¦
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
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground mb-2"
            >
              <ChevronLeft className="w-3 h-3" /> My Classes
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-black text-foreground">Attendance</h2>
            {!canMark && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-lg bg-muted/80 text-[#a0a0b0]">
                <Eye className="w-3 h-3" /> Read Only
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {canMark
              ? "Everyone starts Present. Tap Absent for absentees â€” then Save."
              : "View only. Only the class teacher can mark attendance."}
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => changeDate(e.target.value)}
          className="bg-surface border border-border rounded-xl px-3 py-2 text-xs text-foreground"
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
              onClick={() => changeClass(c.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all",
                classId === c.id
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "bg-surface border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Users className="w-3.5 h-3.5" />
              {c.name} {c.section}
              {c.subject ? ` Â· ${c.subject}` : ""}
              {c.isClassTeacher && (
                <span className="text-[8px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-1 py-0.5 rounded-full">
                  CT
                </span>
              )}
            </button>
          ))}
          {classes.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground">
              No classes assigned. Ask admin to map Teacherâ€“Classâ€“Subject.
            </div>
          )}
        </div>
      )}

      {(selected || fixedClassId) && (
        <div className="flex flex-wrap gap-3 items-center justify-between sticky top-0 z-10 py-2 bg-surface/95 backdrop-blur-sm">
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
                saveState === "draft" && "bg-muted/80 text-[#a0a0b0]",
                saveState === "submitted" && "bg-[#10b981]/15 text-[#10b981]",
                saveState === "readonly" && "bg-muted/80 text-[#a0a0b0]",
              )}
            >
              {saveState === "unsaved" && "Unsaved Changes"}
              {saveState === "draft" && "Not submitted yet"}
              {saveState === "submitted" && "Attendance submitted"}
              {saveState === "readonly" && "Read Only"}
            </span>
          </div>
          <div className="flex gap-2">
            {canMark && (
              <button
                type="button"
                onClick={markAllPresent}
                className="px-3 py-2 rounded-xl text-[10px] font-bold bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
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
                    : "text-foreground bg-[#3b5bdb]/40"
                  : "text-muted-foreground bg-muted opacity-60",
              )}
              title={
                !canMark
                  ? "Read only â€” class teacher marks attendance"
                  : students.length === 0
                    ? "No students enrolled in this class"
                    : dirty
                      ? "Save unsaved changes"
                      : "Already saved â€” click to re-save"
              }
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Attendance
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-3 py-2 flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or rollâ€¦"
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="bg-surface border border-border rounded-xl px-3 py-2 text-xs text-muted-foreground"
        >
          <option value="roll">Sort: Roll</option>
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
        </select>
        <div className="text-[10px] text-muted-foreground">{filtered.length} students</div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading rosterâ€¦
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
                      : "bg-surface border-border/70",
                )}
              >
                {s.photoUrl ? (
                  <img src={s.photoUrl} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
                ) : (
                  <InitialsAvatar name={s.fullName} size="sm" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-foreground truncate">{s.fullName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Roll {s.rollNumber ?? "â€”"}
                    {s.admissionNumber ? ` Â· ${s.admissionNumber}` : ""}
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
                          ? "bg-[#cc5069] text-foreground"
                          : "bg-muted text-muted-foreground hover:bg-[#cc5069]/20 hover:text-[#cc5069]",
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
                            status === opt.value ? "text-foreground" : "text-muted-foreground bg-muted hover:bg-muted/80",
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
            <div className="text-center py-12 text-xs text-muted-foreground">No students in this class.</div>
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
