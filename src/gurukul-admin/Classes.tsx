import { useEffect, useState } from "react";
import {
  Plus, Trash2, Edit2, ChevronDown, ChevronRight, X,
  Building2, UserCheck, BookOpen, History, Clock, User,
  Check, AlertTriangle, Loader2,
} from "lucide-react";
import { cn, InitialsAvatar, ConfirmModal, UndoToast, useUndoDelete } from "./shared";
import { adminClasses as initial, adminTeachers, adminStudents, type AdminClass, type AdminSection } from "./data";
import { AttendanceService, type AttendanceStatus, type ClassStudentRow } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

// ── Attendance Management Panel (Academic Engine) ─────────────────────────────

function AttendancePanel({
  section,
  cls,
  onClose,
}: {
  section: AdminSection;
  cls: AdminClass;
  onClose: () => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [classId, setClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [statusByStudent, setStatusByStudent] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const day = await AttendanceService.summarizeSchoolDate(ctx, selectedDate);
        const match = day.classes.find(
          (c) =>
            c.className === cls.name &&
            (c.section === section.name || `${c.className}-${c.section}` === `${cls.name}-${section.name}`),
        );
        if (!match) {
          if (!cancelled) {
            setClassId(null);
            setStudents([]);
            setStatusByStudent({});
            setError(`No live class found for ${cls.name} ${section.name}. Use Attendance Control for real classes.`);
          }
          return;
        }
        const [roster, records] = await Promise.all([
          AttendanceService.listClassStudents(ctx, match.classId),
          AttendanceService.listForClassDate(ctx, match.classId, selectedDate),
        ]);
        if (cancelled) return;
        const map: Record<string, AttendanceStatus> = {};
        roster.forEach((s) => {
          map[s.id] = (records.find((r) => r.studentId === s.id)?.status as AttendanceStatus) ?? "present";
        });
        setClassId(match.classId);
        setStudents(roster);
        setStatusByStudent(map);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load attendance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, selectedDate, cls.name, section.name]);

  async function save() {
    if (!ctx || !classId) return;
    setSaving(true);
    try {
      await AttendanceService.markBulk(
        ctx,
        students.map((s) => ({
          studentId: s.id,
          classId,
          date: selectedDate,
          status: statusByStudent[s.id] ?? "present",
        })),
      );
      setFlash("Saved via AttendanceService");
      setTimeout(() => setFlash(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const presentCount = Object.values(statusByStudent).filter((s) => s === "present" || s === "late" || s === "half_day").length;
  const absentCount = Object.values(statusByStudent).filter((s) => s === "absent").length;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-96 sm:w-[480px] bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#3b5bdb]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">Attendance — {cls.name} {section.name}</div>
            <div className="text-[10px] text-[#78788c]">AttendanceService · live roster</div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider shrink-0">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50"
            />
          </div>

          {flash && <div className="text-xs text-[#4aa87a] font-semibold">{flash}</div>}
          {error && <div className="text-xs text-[#cc5069]">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[#78788c] text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-xl bg-white/3 text-center">
                  <div className="text-lg font-black text-white">{students.length}</div>
                  <div className="text-[9px] text-[#78788c]">Total</div>
                </div>
                <div className="p-3 rounded-xl bg-[#4aa87a]/10 text-center">
                  <div className="text-lg font-black text-[#4aa87a]">{presentCount}</div>
                  <div className="text-[9px] text-[#78788c]">Present+</div>
                </div>
                <div className="p-3 rounded-xl bg-[#cc5069]/10 text-center">
                  <div className="text-lg font-black text-[#cc5069]">{absentCount}</div>
                  <div className="text-[9px] text-[#78788c]">Absent</div>
                </div>
              </div>

              {students.length === 0 ? (
                <div className="text-xs text-[#78788c] text-center py-8">No live roster for this section</div>
              ) : (
                <div className="space-y-2">
                  {students.map((s) => {
                    const status = statusByStudent[s.id] ?? "present";
                    const present = status === "present" || status === "late" || status === "half_day";
                    return (
                      <div key={s.id} className="bg-white/3 rounded-xl p-3 flex items-center gap-3">
                        <InitialsAvatar name={s.fullName} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white">{s.fullName}</div>
                          <div className="text-[9px] text-[#78788c]">{s.rollNumber ?? "—"}</div>
                        </div>
                        <select
                          value={status}
                          onChange={(e) =>
                            setStatusByStudent((prev) => ({
                              ...prev,
                              [s.id]: e.target.value as AttendanceStatus,
                            }))
                          }
                          className={cn(
                            "px-2 py-1 rounded-lg text-xs font-bold bg-white/5 border border-white/10",
                            present ? "text-[#4aa87a]" : "text-[#cc5069]",
                          )}
                        >
                          <option value="present">Present</option>
                          <option value="absent">Absent</option>
                          <option value="late">Late</option>
                          <option value="half_day">Half day</option>
                          <option value="leave">Leave</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-white/7">
          <button
            disabled={!classId || saving || loading}
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

// ── Section Detail View ───────────────────────────────────────────────────────

function SectionDetailView({
  section, cls, onClose, onEdit, onAttendance,
}: {
  section: AdminSection; cls: AdminClass; onClose: () => void; onEdit: () => void; onAttendance: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "students" | "teachers">("overview");
  const classTeacher = adminTeachers.find((t) => t.id === section.classTeacherId);
  const subjectTeachers = adminTeachers.filter((t) => section.subjectTeacherIds.includes(t.id));
  const students = adminStudents.filter((s) => section.studentIds.includes(s.id));

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-[#3b5bdb]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{cls.name} — Section {section.name}</div>
            <div className="text-[10px] text-[#78788c]">{section.totalStudents} students</div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-1 px-4 py-2 border-b border-white/7">
          {(["overview", "students", "teachers"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("text-[10px] font-semibold px-3 py-1.5 rounded-lg capitalize transition-all",
                tab === t ? "bg-[#3b5bdb]/20 text-[#3b5bdb]" : "text-[#78788c] hover:text-white")}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Students", value: section.totalStudents, color: "#3b5bdb" },
                  { label: "Today Att.", value: "Engine", color: "#4aa87a" },
                  { label: "Teachers", value: section.subjectTeacherIds.length, color: "#4b9fd4" },
                  { label: "Class Teacher", value: classTeacher ? "Assigned" : "None", color: "#c08a3a" },
                ].map((item) => (
                  <div key={item.label} className="p-3 rounded-xl bg-white/3 text-center">
                    <div className="text-xl font-black" style={{ color: item.color }}>{item.value}</div>
                    <div className="text-[9px] text-[#78788c] mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              {classTeacher && (
                <div className="p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-2">Class Teacher</div>
                  <div className="flex items-center gap-2">
                    <InitialsAvatar name={classTeacher.fullName} size="sm" />
                    <div>
                      <div className="text-xs font-semibold text-white">{classTeacher.fullName}</div>
                      <div className="text-[9px] text-[#78788c]">{classTeacher.department}</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "students" && (
            students.length === 0
              ? <div className="text-xs text-[#78788c] text-center pt-8">No students in this section</div>
              : students.map((s) => (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
                  <InitialsAvatar name={s.fullName} size="sm" />
                  <div>
                    <div className="text-xs font-semibold text-white">{s.fullName}</div>
                    <div className="text-[9px] text-[#78788c]">{s.admissionNumber}</div>
                  </div>
                </div>
              ))
          )}
          {tab === "teachers" && (
            subjectTeachers.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
                <InitialsAvatar name={t.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white">{t.fullName}</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {t.subjects.map((s) => <span key={s} className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#6882e8]/15 text-[#6882e8]">{s}</span>)}
                  </div>
                </div>
                {section.classTeacherId === t.id && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#3b5bdb]/20 text-[#a5b4fc]">CT</span>}
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-white/7 flex flex-col gap-2">
          <button onClick={onAttendance} className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#4b9fd4] bg-[#4b9fd4]/10 hover:bg-[#4b9fd4]/20 transition-all flex items-center justify-center gap-2">
            <History className="w-4 h-4" /> Manage Attendance
          </button>
          <button onClick={onEdit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            Edit Section
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section Form ──────────────────────────────────────────────────────────────

function SectionForm({ section, classId, onSave, onClose }: { section?: AdminSection; classId: string; onSave: (s: AdminSection) => void; onClose: () => void }) {
  const blank: AdminSection = { id: `s${Date.now()}`, name: "", classId, classTeacherId: null, subjectTeacherIds: [], studentIds: [], totalStudents: 0, attendanceToday: 0 };
  const [form, setForm] = useState<AdminSection>(section ?? blank);

  function toggleTeacher(id: string) {
    setForm((f) => ({ ...f, subjectTeacherIds: f.subjectTeacherIds.includes(id) ? f.subjectTeacherIds.filter((x) => x !== id) : [...f.subjectTeacherIds, id] }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#0d0d0f] border-b border-white/7 px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-bold text-white">{section ? "Edit Section" : "Add Section"}</div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Section Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. A, B, C"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Class Teacher</label>
            <select value={form.classTeacherId ?? ""} onChange={(e) => setForm((f) => ({ ...f, classTeacherId: e.target.value || null }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50">
              <option value="">None</option>
              {adminTeachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Subject Teachers</label>
            {adminTeachers.map((t) => (
              <button key={t.id} onClick={() => toggleTeacher(t.id)}
                className={cn("flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all",
                  form.subjectTeacherIds.includes(t.id) ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30" : "bg-white/3 border-white/7 hover:bg-white/5")}>
                <InitialsAvatar name={t.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white">{t.fullName}</div>
                  <div className="text-[9px] text-[#78788c]">{t.subjects.join(", ")}</div>
                </div>
                {form.subjectTeacherIds.includes(t.id) && <div className="w-4 h-4 rounded-full bg-[#3b5bdb] flex items-center justify-center text-[8px] text-white font-bold">✓</div>}
              </button>
            ))}
          </div>
        </div>
        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 transition-all">Cancel</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            {section ? "Save" : "Add Section"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Class Card ────────────────────────────────────────────────────────────────

function ClassCard({ cls, onViewSection, onEditSection, onDeleteSection, onAddSection, onDeleteClass, onAttendance }: {
  cls: AdminClass;
  onViewSection: (s: AdminSection) => void;
  onEditSection: (s: AdminSection) => void;
  onDeleteSection: (sectionId: string, classId: string) => void;
  onAddSection: (classId: string) => void;
  onDeleteClass: (classId: string) => void;
  onAttendance: (s: AdminSection) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div className="w-10 h-10 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#3b5bdb]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white flex items-center gap-2">
              Class {cls.name}
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-[#78788c]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#78788c]" />}
            </div>
            {cls.recentAnnouncement && <div className="text-[10px] text-[#78788c] truncate">{cls.recentAnnouncement}</div>}
          </div>
        </button>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-center">
            <div className="text-lg font-black text-white">{cls.totalStudents}</div>
            <div className="text-[9px] text-[#78788c]">Students</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-black text-white">{cls.totalTeachers}</div>
            <div className="text-[9px] text-[#78788c]">Teachers</div>
          </div>
          <button onClick={() => onAddSection(cls.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#3b5bdb] bg-[#3b5bdb]/10 hover:bg-[#3b5bdb]/20 transition-all">
            <Plus className="w-3 h-3" /> Section
          </button>
          <button onClick={() => onDeleteClass(cls.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/7 grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/5">
          {cls.sections.map((section) => {
            const classTeacher = adminTeachers.find((t) => t.id === section.classTeacherId);
            return (
              <div key={section.id} className="bg-[#131316] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">Section {section.name}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => onAttendance(section)} title="Manage Attendance" className="w-6 h-6 rounded-lg bg-white/5 hover:bg-[#4b9fd4]/20 flex items-center justify-center text-[#78788c] hover:text-[#4b9fd4] transition-all">
                      <History className="w-3 h-3" />
                    </button>
                    <button onClick={() => onViewSection(section)} className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <BookOpen className="w-3 h-3" />
                    </button>
                    <button onClick={() => onEditSection(section)} className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDeleteSection(section.id, cls.id)} className="w-6 h-6 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-white/3">
                    <div className="text-base font-black text-[#3b5bdb]">{section.totalStudents}</div>
                    <div className="text-[8px] text-[#78788c]">Students</div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/3">
                    <div className="text-base font-black text-[#4aa87a]">Live</div>
                    <div className="text-[8px] text-[#78788c]">Today</div>
                  </div>
                </div>
                {classTeacher && (
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-3.5 h-3.5 text-[#78788c] shrink-0" />
                    <span className="text-[10px] text-[#78788c] truncate">{classTeacher.fullName}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ClassManagement() {
  const [classes, setClasses] = useState<AdminClass[]>(initial);
  const { toast, closeToast, softDelete } = useUndoDelete<AdminClass>(setClasses);
  const [sectionDetail, setSectionDetail] = useState<{ section: AdminSection; cls: AdminClass } | null>(null);
  const [sectionEdit, setSectionEdit] = useState<{ section?: AdminSection; classId: string } | null>(null);
  const [attendancePanel, setAttendancePanel] = useState<{ section: AdminSection; cls: AdminClass } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "class" | "section"; classId: string; sectionId?: string } | null>(null);
  const [addingClass, setAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  function handleSaveSection(section: AdminSection) {
    setClasses((prev) => prev.map((cls) => {
      if (cls.id !== section.classId) return cls;
      const idx = cls.sections.findIndex((s) => s.id === section.id);
      const sections = idx >= 0 ? cls.sections.map((s, i) => (i === idx ? section : s)) : [...cls.sections, section];
      return { ...cls, sections };
    }));
    setSectionEdit(null);
  }

  function handleDeleteSection(sectionId: string, classId: string) {
    setClasses((prev) => prev.map((cls) => cls.id === classId ? { ...cls, sections: cls.sections.filter((s) => s.id !== sectionId) } : cls));
  }

  function handleDeleteClass(classId: string) {
    const item = classes.find((c) => c.id === classId);
    if (!item) return;
    softDelete([item], `Class ${item.name} deleted`);
  }

  function handleAddClass() {
    if (!newClassName.trim()) return;
    const newClass: AdminClass = { id: `c${Date.now()}`, name: newClassName.trim(), sections: [], totalStudents: 0, totalTeachers: 0 };
    setClasses((prev) => [...prev, newClass]);
    setNewClassName("");
    setAddingClass(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[#78788c]">{classes.length} classes · {classes.reduce((n, c) => n + c.sections.length, 0)} sections total</div>
        <button onClick={() => setAddingClass(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
          <Plus className="w-3.5 h-3.5" /> Add Class
        </button>
      </div>

      {addingClass && (
        <div className="flex items-center gap-3 p-4 bg-[#131316] border border-[#3b5bdb]/30 rounded-2xl">
          <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddClass()}
            placeholder="Class name (e.g. 10th)" autoFocus
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50" />
          <button onClick={handleAddClass} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">Add</button>
          <button onClick={() => setAddingClass(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 transition-all">Cancel</button>
        </div>
      )}

      <div className="space-y-4">
        {classes.map((cls) => (
          <ClassCard
            key={cls.id}
            cls={cls}
            onViewSection={(section) => setSectionDetail({ section, cls })}
            onEditSection={(section) => setSectionEdit({ section, classId: cls.id })}
            onDeleteSection={(sectionId, classId) => setConfirmDelete({ type: "section", classId, sectionId })}
            onAddSection={(classId) => setSectionEdit({ classId })}
            onDeleteClass={(classId) => setConfirmDelete({ type: "class", classId })}
            onAttendance={(section) => setAttendancePanel({ section, cls })}
          />
        ))}
      </div>

      {sectionEdit && <SectionForm section={sectionEdit.section} classId={sectionEdit.classId} onSave={handleSaveSection} onClose={() => setSectionEdit(null)} />}

      {sectionDetail && (
        <SectionDetailView
          section={sectionDetail.section}
          cls={sectionDetail.cls}
          onClose={() => setSectionDetail(null)}
          onEdit={() => { setSectionEdit({ section: sectionDetail.section, classId: sectionDetail.cls.id }); setSectionDetail(null); }}
          onAttendance={() => { setAttendancePanel(sectionDetail); setSectionDetail(null); }}
        />
      )}

      {attendancePanel && (
        <AttendancePanel
          section={attendancePanel.section}
          cls={attendancePanel.cls}
          onClose={() => setAttendancePanel(null)}
        />
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title={`Are you sure you want to delete this ${confirmDelete?.type === "class" ? "class" : "section"}?`}
        description="This action cannot be undone. The record will be removed permanently."
        confirmLabel="Delete" danger
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.type === "class") handleDeleteClass(confirmDelete.classId);
          else if (confirmDelete.sectionId) handleDeleteSection(confirmDelete.sectionId, confirmDelete.classId);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {toast && <UndoToast state={toast} onClose={closeToast} />}
    </div>
  );
}
