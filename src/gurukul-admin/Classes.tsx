import { useState } from "react";
import {
  Plus, Trash2, Edit2, ChevronDown, ChevronRight, X,
  Building2, UserCheck, BookOpen, History, Clock, User,
  Check, AlertTriangle,
} from "lucide-react";
import { cn, InitialsAvatar, ConfirmModal, UndoToast, useUndoDelete } from "./shared";
import { adminClasses as initial, adminTeachers, adminStudents, type AdminClass, type AdminSection } from "./data";

// ── Attendance audit types ────────────────────────────────────────────────────

interface AttendanceRecord {
  studentId: string;
  date: string;
  present: boolean;
}

interface AttendanceEdit {
  id: string;
  sectionId: string;
  studentId: string;
  studentName: string;
  date: string;
  originalStatus: boolean;
  newStatus: boolean;
  modifiedBy: string;
  modifiedAt: string;
  reason: string;
}

// Seed some mock attendance records per section
function seedAttendance(sectionId: string, studentIds: string[]): AttendanceRecord[] {
  const dates = ["2026-07-24", "2026-07-25", "2026-07-26"];
  return dates.flatMap((date) =>
    studentIds.map((sid) => ({
      studentId: sid,
      date,
      present: Math.random() > 0.15,
    }))
  );
}

// ── Attendance Management Panel ───────────────────────────────────────────────

function AttendancePanel({
  section,
  cls,
  onClose,
}: {
  section: AdminSection;
  cls: AdminClass;
  onClose: () => void;
}) {
  const students = adminStudents.filter((s) => s.className === cls.name && s.section === section.name);
  const [records, setRecords] = useState<AttendanceRecord[]>(() => seedAttendance(section.id, students.map((s) => s.id)));
  const [auditLog, setAuditLog] = useState<AttendanceEdit[]>([]);
  const [selectedDate, setSelectedDate] = useState("2026-07-26");
  const [editReason, setEditReason] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<"attendance" | "audit">("attendance");

  const todayRecords = records.filter((r) => r.date === selectedDate);
  const dates = [...new Set(records.map((r) => r.date))].sort().reverse();

  function getRecord(studentId: string) {
    return todayRecords.find((r) => r.studentId === studentId) ?? { studentId, date: selectedDate, present: false };
  }

  function togglePresent(studentId: string) {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    const current = getRecord(studentId);
    const newPresent = !current.present;

    // require reason for edits to existing records
    const isEdit = todayRecords.some((r) => r.studentId === studentId);
    if (isEdit) {
      setEditMode((prev) => ({ ...prev, [studentId]: true }));
      return;
    }

    applyChange(studentId, student.fullName, current.present, newPresent, "");
  }

  function applyChange(studentId: string, studentName: string, original: boolean, newStatus: boolean, reason: string) {
    const now = new Date().toISOString();
    const edit: AttendanceEdit = {
      id: `ae${Date.now()}`,
      sectionId: section.id,
      studentId,
      studentName,
      date: selectedDate,
      originalStatus: original,
      newStatus,
      modifiedBy: "Super Admin",
      modifiedAt: now,
      reason,
    };

    setRecords((prev) => {
      const existing = prev.findIndex((r) => r.studentId === studentId && r.date === selectedDate);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], present: newStatus };
        return next;
      }
      return [...prev, { studentId, date: selectedDate, present: newStatus }];
    });

    setAuditLog((prev) => [edit, ...prev]);
    setEditMode((prev) => { const n = { ...prev }; delete n[studentId]; return n; });
    setEditReason((prev) => { const n = { ...prev }; delete n[studentId]; return n; });
  }

  function confirmEdit(studentId: string) {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    const current = getRecord(studentId);
    applyChange(studentId, student.fullName, current.present, !current.present, editReason[studentId] ?? "");
  }

  const presentCount = todayRecords.filter((r) => r.present).length;
  const absentCount = students.length - presentCount;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-96 sm:w-[480px] bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#6366f1]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#6366f1]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">Attendance — {cls.name} {section.name}</div>
            <div className="text-[10px] text-[#78788c]">Review and edit submitted attendance records</div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-white/7">
          {([{ key: "attendance", label: "Attendance" }, { key: "audit", label: `Audit Log (${auditLog.length})` }] as const).map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={cn("text-[10px] font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all",
                activeTab === t.key ? "bg-[#6366f1]/20 text-[#6366f1]" : "text-[#78788c] hover:text-white")}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "attendance" && (
            <div className="p-4 space-y-4">
              {/* Date selector */}
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider shrink-0">Date</label>
                <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50">
                  {dates.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-xl bg-white/3 text-center">
                  <div className="text-lg font-black text-white">{students.length}</div>
                  <div className="text-[9px] text-[#78788c]">Total</div>
                </div>
                <div className="p-3 rounded-xl bg-[#4aa87a]/10 text-center">
                  <div className="text-lg font-black text-[#4aa87a]">{presentCount}</div>
                  <div className="text-[9px] text-[#78788c]">Present</div>
                </div>
                <div className="p-3 rounded-xl bg-[#cc5069]/10 text-center">
                  <div className="text-lg font-black text-[#cc5069]">{absentCount}</div>
                  <div className="text-[9px] text-[#78788c]">Absent</div>
                </div>
              </div>

              {/* Student list */}
              {students.length === 0 ? (
                <div className="text-xs text-[#78788c] text-center py-8">No students linked to this section</div>
              ) : (
                <div className="space-y-2">
                  {students.map((s) => {
                    const rec = getRecord(s.id);
                    const inEditMode = editMode[s.id];
                    return (
                      <div key={s.id} className="bg-white/3 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-3">
                          <InitialsAvatar name={s.fullName} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white">{s.fullName}</div>
                            <div className="text-[9px] text-[#78788c]">{s.admissionNumber}</div>
                          </div>
                          <button
                            onClick={() => togglePresent(s.id)}
                            className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all",
                              rec.present ? "bg-[#4aa87a]/15 text-[#4aa87a] hover:bg-[#cc5069]/15 hover:text-[#cc5069]" : "bg-[#cc5069]/15 text-[#cc5069] hover:bg-[#4aa87a]/15 hover:text-[#4aa87a]"
                            )}
                          >
                            {rec.present ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                            {rec.present ? "Present" : "Absent"}
                          </button>
                        </div>

                        {/* Reason input for edits */}
                        {inEditMode && (
                          <div className="flex gap-2">
                            <input
                              value={editReason[s.id] ?? ""}
                              onChange={(e) => setEditReason((prev) => ({ ...prev, [s.id]: e.target.value }))}
                              placeholder="Reason for editing (optional)"
                              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#6366f1]/50"
                            />
                            <button onClick={() => confirmEdit(s.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
                              Save
                            </button>
                            <button onClick={() => setEditMode((prev) => { const n = { ...prev }; delete n[s.id]; return n; })}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#78788c] hover:text-white bg-white/5 transition-all">
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "audit" && (
            <div className="p-4">
              {auditLog.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <History className="w-8 h-8 text-[#46465a]" />
                  <div className="text-sm text-[#78788c]">No attendance edits recorded yet</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLog.map((entry) => (
                    <div key={entry.id} className="p-3 rounded-xl bg-white/3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-white">{entry.studentName}</div>
                        <div className="text-[9px] text-[#46465a]">{new Date(entry.modifiedAt).toLocaleString("en-IN")}</div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className={cn("px-1.5 py-0.5 rounded font-bold", entry.originalStatus ? "bg-[#4aa87a]/15 text-[#4aa87a]" : "bg-[#cc5069]/15 text-[#cc5069]")}>
                          {entry.originalStatus ? "Present" : "Absent"}
                        </span>
                        <span className="text-[#46465a]">→</span>
                        <span className={cn("px-1.5 py-0.5 rounded font-bold", entry.newStatus ? "bg-[#4aa87a]/15 text-[#4aa87a]" : "bg-[#cc5069]/15 text-[#cc5069]")}>
                          {entry.newStatus ? "Present" : "Absent"}
                        </span>
                        <span className="text-[#46465a] ml-auto">Date: {entry.date}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-[#78788c]">
                        <User className="w-3 h-3" /> {entry.modifiedBy}
                        {entry.reason && <span className="ml-2 text-[#46465a]">· "{entry.reason}"</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
          <div className="w-12 h-12 rounded-2xl bg-[#6366f1]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-[#6366f1]" />
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
                tab === t ? "bg-[#6366f1]/20 text-[#6366f1]" : "text-[#78788c] hover:text-white")}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Students", value: section.totalStudents, color: "#6366f1" },
                  { label: "Today Att.", value: `${section.attendanceToday}%`, color: "#4aa87a" },
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
                    {t.subjects.map((s) => <span key={s} className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#8f7dd6]/15 text-[#8f7dd6]">{s}</span>)}
                  </div>
                </div>
                {section.classTeacherId === t.id && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#6366f1]/20 text-[#a5b4fc]">CT</span>}
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-white/7 flex flex-col gap-2">
          <button onClick={onAttendance} className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#4b9fd4] bg-[#4b9fd4]/10 hover:bg-[#4b9fd4]/20 transition-all flex items-center justify-center gap-2">
            <History className="w-4 h-4" /> Manage Attendance
          </button>
          <button onClick={onEdit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
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
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Class Teacher</label>
            <select value={form.classTeacherId ?? ""} onChange={(e) => setForm((f) => ({ ...f, classTeacherId: e.target.value || null }))}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50">
              <option value="">None</option>
              {adminTeachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Subject Teachers</label>
            {adminTeachers.map((t) => (
              <button key={t.id} onClick={() => toggleTeacher(t.id)}
                className={cn("flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all",
                  form.subjectTeacherIds.includes(t.id) ? "bg-[#6366f1]/10 border-[#6366f1]/30" : "bg-white/3 border-white/7 hover:bg-white/5")}>
                <InitialsAvatar name={t.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white">{t.fullName}</div>
                  <div className="text-[9px] text-[#78788c]">{t.subjects.join(", ")}</div>
                </div>
                {form.subjectTeacherIds.includes(t.id) && <div className="w-4 h-4 rounded-full bg-[#6366f1] flex items-center justify-center text-[8px] text-white font-bold">✓</div>}
              </button>
            ))}
          </div>
        </div>
        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 transition-all">Cancel</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
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
          <div className="w-10 h-10 rounded-xl bg-[#6366f1]/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#6366f1]" />
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
          <button onClick={() => onAddSection(cls.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6366f1] bg-[#6366f1]/10 hover:bg-[#6366f1]/20 transition-all">
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
                    <div className="text-base font-black text-[#6366f1]">{section.totalStudents}</div>
                    <div className="text-[8px] text-[#78788c]">Students</div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/3">
                    <div className="text-base font-black text-[#4aa87a]">{section.attendanceToday}%</div>
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
        <button onClick={() => setAddingClass(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
          <Plus className="w-3.5 h-3.5" /> Add Class
        </button>
      </div>

      {addingClass && (
        <div className="flex items-center gap-3 p-4 bg-[#131316] border border-[#6366f1]/30 rounded-2xl">
          <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddClass()}
            placeholder="Class name (e.g. 10th)" autoFocus
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#6366f1]/50" />
          <button onClick={handleAddClass} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">Add</button>
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
