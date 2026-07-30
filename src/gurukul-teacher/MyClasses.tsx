import { useEffect, useState } from "react";
import {
  BookOpen, ClipboardList, CheckSquare, BarChart2, Search, Plus, Edit2, Trash2,
  ChevronDown, ChevronRight, Check, X, Save, Upload, Eye, Info, Star, AlertCircle,
  Calendar, Clock, Lock, RotateCcw, Loader2,
} from "lucide-react";
import { cn, GradeChip, InitialsAvatar } from "./shared";
import {
  studentsByClass, homeworkByClass, assignmentsByClass, testsByClass,
  type ClassInfo, type Student, type HomeworkItem, type Assignment, type Test,
} from "./data";
import { TeacherAttendanceWorkspace } from "./TeacherAttendancePage";
import { AttendanceService, type AssignedClass } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

type SubTab = "students" | "attendance" | "homework" | "assignments" | "tests" | "marks" | "analytics" | "insights";

function assignedToClassInfo(c: AssignedClass): ClassInfo {
  return {
    id: c.id,
    className: c.name,
    section: c.section,
    subject: c.subject ?? "—",
    isClassTeacher: c.isClassTeacher,
    studentCount: c.studentCount,
    schedule: [],
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick}
      className={cn("relative px-4 py-2.5 text-xs font-semibold transition-all whitespace-nowrap border-b-2",
        active ? "border-[#3b5bdb] text-[#3b5bdb]" : "border-transparent text-[#78788c] hover:text-white")}>
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#cc5069]/20 text-[#cc5069]">{badge}</span>
      )}
    </button>
  );
}

function ClassSelector({
  classes,
  selected,
  onSelect,
}: {
  classes: ClassInfo[];
  selected: ClassInfo | null;
  onSelect: (c: ClassInfo) => void;
}) {
  if (classes.length === 0) {
    return (
      <div className="text-xs text-[#78788c] py-2">
        No classes assigned via Teacher–Class–Subject mapping.
      </div>
    );
  }
  return (
    <div className="flex gap-2 flex-wrap">
      {classes.map((c) => (
        <button key={c.id} onClick={() => onSelect(c)}
          className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all",
            selected?.id === c.id
              ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
              : "bg-[#131316] border-white/7 text-[#78788c] hover:border-white/15 hover:text-white")}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[8px] font-black"
            style={{ background: selected?.id === c.id ? "#f59e0b20" : "#ffffff12", color: selected?.id === c.id ? "#f59e0b" : "#78788c" }}>
            {c.section}
          </div>
          {c.className} {c.section} · {c.subject}
          {c.isClassTeacher && <span className="text-[8px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-1 py-0.5 rounded-full">CT</span>}
        </button>
      ))}
    </div>
  );
}

// ── Students sub-tab ──────────────────────────────────────────────────────────

function StudentsTab({ classId }: { classId: string }) {
  const students = studentsByClass[classId] ?? [];
  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const filtered = students.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q);
  });

  if (selectedStudent) {
    return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
        <Search className="w-3.5 h-3.5 text-[#46465a] shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or roll number…"
          className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none" />
      </div>
      <div className="text-[10px] text-[#46465a]">{filtered.length} students</div>
      <div className="space-y-2">
        {filtered.map((s) => (
          <button key={s.id} onClick={() => setSelectedStudent(s)}
            className="w-full flex items-center gap-3 p-3 bg-[#131316] border border-white/7 rounded-2xl hover:border-white/15 hover:bg-white/3 transition-all text-left group">
            <InitialsAvatar name={s.name} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">{s.name}</div>
              <div className="text-[10px] text-[#78788c] mt-0.5">Roll: {s.rollNumber} · Admission: {s.admissionNumber}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold" style={{ color: s.attendancePct >= 85 ? "#10b981" : "#cc5069" }}>{s.attendancePct}% att.</div>
              <div className="text-[10px] text-[#46465a]">Score {s.performanceScore}</div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[#46465a] group-hover:text-white transition-all" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Student Profile ───────────────────────────────────────────────────────────

function StudentProfile({ student, onBack }: { student: Student; onBack: () => void }) {
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[10px] text-[#78788c] hover:text-white transition-all">
        <ChevronRight className="w-3 h-3 rotate-180" /> Back to Students
      </button>
      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 flex items-center gap-4">
        <InitialsAvatar name={student.name} size="lg" />
        <div className="flex-1">
          <div className="text-base font-black text-white">{student.name}</div>
          <div className="text-xs text-[#78788c] mt-0.5">Roll: {student.rollNumber} · Admission: {student.admissionNumber}</div>
          <div className="text-[10px] text-[#46465a] mt-0.5">Parent: {student.parentName} · {student.parentPhone}</div>
        </div>
        <div className={cn("text-[9px] font-bold px-2 py-1 rounded-full", student.status === "active" ? "bg-[#10b981]/15 text-[#10b981]" : "bg-[#46465a]/15 text-[#46465a]")}>
          {student.status.toUpperCase()}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-lg font-black tabular-nums" style={{ color: student.attendancePct >= 85 ? "#10b981" : "#cc5069" }}>{student.attendancePct}%</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Attendance</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-lg font-black text-[#3b5bdb] tabular-nums">{student.performanceScore}</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Performance Score</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-lg font-black text-white">{student.gender === "male" ? "M" : "F"}</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Gender</div>
        </div>
      </div>

      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
        <div className="text-sm font-bold text-white mb-4">Academic Overview</div>
        <div className="space-y-2 text-xs text-[#78788c]">
          <div>• Attendance: <span style={{ color: student.attendancePct >= 85 ? "#10b981" : "#cc5069" }}>{student.attendancePct >= 85 ? "Satisfactory" : "Below minimum — parental notice may be required"}</span></div>
          <div>• Performance: <span className="text-white">{student.performanceScore >= 85 ? "Consistently above average" : student.performanceScore >= 70 ? "Performing adequately" : "Needs additional support"}</span></div>
          <div>• Weak areas: <span className="text-white">Algebra word problems, Application-based questions</span></div>
          <div>• Strong areas: <span className="text-white">Arithmetic, Formulaic problems</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Attendance sub-tab — Academic Engine (AttendanceService) ──────────────────

function AttendanceTab({ classId }: { classId: string }) {
  return <TeacherAttendanceWorkspace fixedClassId={classId} showBackLink={false} />;
}

// ── Homework sub-tab ──────────────────────────────────────────────────────────


// ── Homework sub-tab ──────────────────────────────────────────────────────────

function HomeworkTab({ classId }: { classId: string }) {
  const initial = homeworkByClass[classId] ?? [];
  const [items, setItems] = useState<HomeworkItem[]>(initial);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", instructions: "", dueDate: "" });

  function createHw() {
    const newHw: HomeworkItem = {
      id: `hw_${Date.now()}`,
      classId,
      subject: "Mathematics",
      title: form.title,
      description: form.description,
      instructions: form.instructions,
      assignedDate: new Date().toISOString().split("T")[0],
      dueDate: form.dueDate,
      totalStudents: (studentsByClass[classId] ?? []).length,
      submitted: 0,
      pending: (studentsByClass[classId] ?? []).length,
      status: "active",
      submissions: (studentsByClass[classId] ?? []).map((s) => ({
        studentId: s.id, studentName: s.name, submittedAt: "", status: "pending" as const,
      })),
    };
    setItems((prev) => [newHw, ...prev]);
    setCreating(false);
    setForm({ title: "", description: "", instructions: "", dueDate: "" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[#46465a]">{items.length} homework items</div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all">
          <Plus className="w-3.5 h-3.5" /> New Homework
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-[#131316] border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">New Homework</div>
            <button onClick={() => setCreating(false)}><X className="w-4 h-4 text-[#78788c]" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Title *</label>
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Description</label>
              <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40 resize-none" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Instructions</label>
              <textarea value={form.instructions} onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))} rows={2}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40 resize-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Due Date *</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">Cancel</button>
            <button onClick={createHw} disabled={!form.title || !form.dueDate}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all">
              <Save className="w-3.5 h-3.5" /> Create Homework
            </button>
          </div>
        </div>
      )}

      {items.map((hw) => (
        <div key={hw.id} className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
          <button onClick={() => setExpandedId(expandedId === hw.id ? null : hw.id)}
            className="w-full flex items-center gap-3 p-4 hover:bg-white/3 transition-all text-left">
            <div className="w-9 h-9 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-[#3b5bdb]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xs font-bold text-white">{hw.title}</div>
                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full", hw.status === "active" ? "bg-[#10b981]/15 text-[#10b981]" : "bg-[#46465a]/15 text-[#46465a]")}>{hw.status}</span>
              </div>
              <div className="text-[10px] text-[#78788c] mt-0.5">{hw.subject} · Due: {hw.dueDate}</div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[9px] text-[#10b981]">{hw.submitted} submitted</span>
                <span className="text-[9px] text-[#cc5069]">{hw.pending} pending</span>
              </div>
            </div>
            <div className="shrink-0">
              <button onClick={(e) => { e.stopPropagation(); setItems((prev) => prev.filter((x) => x.id !== hw.id)); }}
                className="w-7 h-7 rounded-lg bg-[#cc5069]/10 text-[#cc5069] flex items-center justify-center hover:bg-[#cc5069]/20 transition-all mr-1">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <ChevronDown className={cn("w-4 h-4 text-[#46465a] transition-transform", expandedId === hw.id && "rotate-180")} />
          </button>

          {expandedId === hw.id && (
            <div className="px-4 pb-4 border-t border-white/7 pt-4 space-y-3">
              <div className="text-[10px] text-[#78788c]">{hw.description}</div>
              {hw.instructions && <div className="text-[10px] text-[#46465a] italic">{hw.instructions}</div>}
              <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mt-3">Submissions</div>
              <div className="space-y-1.5">
                {hw.submissions.map((sub) => {
                  const color = sub.status === "submitted" ? "#10b981" : sub.status === "late" ? "#f59e0b" : "#cc5069";
                  return (
                    <div key={sub.studentId} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/3">
                      <InitialsAvatar name={sub.studentName} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white">{sub.studentName}</div>
                        {sub.submittedAt && <div className="text-[9px] text-[#46465a]">Submitted: {sub.submittedAt}</div>}
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full capitalize" style={{ background: `${color}18`, color }}>{sub.status}</span>
                      {sub.remarks && (
                        <span className="text-[9px] text-[#78788c] italic truncate max-w-[100px]">{sub.remarks}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Assignments sub-tab ───────────────────────────────────────────────────────

function AssignmentsTab({ classId }: { classId: string }) {
  const initial = assignmentsByClass[classId] ?? [];
  const [items, setItems] = useState<Assignment[]>(initial);
  const [creating, setCreating] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", dueDate: "", maxMarks: "20" });
  const [gradeInputs, setGradeInputs] = useState<Record<string, { marks: string; feedback: string }>>({});

  function createAsgn() {
    const newA: Assignment = {
      id: `asgn_${Date.now()}`,
      classId,
      subject: "Mathematics",
      title: form.title,
      description: form.description,
      dueDate: form.dueDate,
      maxMarks: parseInt(form.maxMarks),
      assignedDate: new Date().toISOString().split("T")[0],
      totalStudents: (studentsByClass[classId] ?? []).length,
      submitted: 0,
      graded: 0,
      status: "active",
      submissions: (studentsByClass[classId] ?? []).map((s) => ({
        studentId: s.id, studentName: s.name, submittedAt: "", status: "pending" as const,
      })),
    };
    setItems((prev) => [newA, ...prev]);
    setCreating(false);
    setForm({ title: "", description: "", dueDate: "", maxMarks: "20" });
  }

  function saveGrades(asgnId: string) {
    setItems((prev) => prev.map((a) => {
      if (a.id !== asgnId) return a;
      const subs = a.submissions.map((s) => {
        const gi = gradeInputs[s.studentId];
        if (!gi || s.status === "pending") return s;
        return { ...s, status: "graded" as const, marks: parseInt(gi.marks ?? "0"), feedback: gi.feedback ?? "" };
      });
      const graded = subs.filter((s) => s.status === "graded").length;
      return { ...a, submissions: subs, graded };
    }));
    setGradingId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[#46465a]">{items.length} assignments</div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all">
          <Plus className="w-3.5 h-3.5" /> New Assignment
        </button>
      </div>

      {creating && (
        <div className="bg-[#131316] border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">New Assignment</div>
            <button onClick={() => setCreating(false)}><X className="w-4 h-4 text-[#78788c]" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Title *</label>
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Description</label>
              <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40 resize-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Due Date *</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Max Marks</label>
              <input type="number" value={form.maxMarks} onChange={(e) => setForm((p) => ({ ...p, maxMarks: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5">Cancel</button>
            <button onClick={createAsgn} disabled={!form.title || !form.dueDate}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all">
              <Save className="w-3.5 h-3.5" /> Create
            </button>
          </div>
        </div>
      )}

      {items.map((a) => (
        <div key={a.id} className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <div className="w-9 h-9 rounded-xl bg-[#10b981]/15 flex items-center justify-center shrink-0">
              <CheckSquare className="w-4 h-4 text-[#10b981]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">{a.title}</div>
              <div className="text-[10px] text-[#78788c] mt-0.5">Max: {a.maxMarks} marks · Due: {a.dueDate}</div>
              <div className="flex gap-3 mt-1">
                <span className="text-[9px] text-[#10b981]">{a.submitted} submitted</span>
                <span className="text-[9px] text-[#3b5bdb]">{a.submitted - a.graded} to grade</span>
                <span className="text-[9px] text-[#46465a]">{a.graded} graded</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {a.submitted > a.graded && (
                <button onClick={() => {
                  const init: Record<string, { marks: string; feedback: string }> = {};
                  a.submissions.filter((s) => s.status === "submitted").forEach((s) => {
                    init[s.studentId] = { marks: s.marks != null ? String(s.marks) : "", feedback: s.feedback ?? "" };
                  });
                  setGradeInputs(init);
                  setGradingId(a.id);
                }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all">
                  <Star className="w-3 h-3" /> Grade
                </button>
              )}
              <button onClick={() => setItems((prev) => prev.filter((x) => x.id !== a.id))}
                className="w-7 h-7 rounded-lg bg-[#cc5069]/10 text-[#cc5069] flex items-center justify-center hover:bg-[#cc5069]/20 transition-all">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {gradingId === a.id && (
            <div className="border-t border-white/7 p-4 space-y-3">
              <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Grade Submissions</div>
              {a.submissions.filter((s) => s.status !== "pending").map((sub) => (
                <div key={sub.studentId} className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
                  <InitialsAvatar name={sub.studentName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white">{sub.studentName}</div>
                  </div>
                  <input type="number" min={0} max={a.maxMarks}
                    value={gradeInputs[sub.studentId]?.marks ?? ""}
                    onChange={(e) => setGradeInputs((p) => ({ ...p, [sub.studentId]: { ...p[sub.studentId], marks: e.target.value } }))}
                    placeholder={`/${a.maxMarks}`}
                    className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none text-center" />
                  <input
                    value={gradeInputs[sub.studentId]?.feedback ?? ""}
                    onChange={(e) => setGradeInputs((p) => ({ ...p, [sub.studentId]: { ...p[sub.studentId], feedback: e.target.value } }))}
                    placeholder="Feedback…"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none" />
                </div>
              ))}
              <div className="flex gap-3 justify-end">
                <button onClick={() => setGradingId(null)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5">Cancel</button>
                <button onClick={() => saveGrades(a.id)}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all">
                  <Save className="w-3.5 h-3.5" /> Save Grades
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tests sub-tab ─────────────────────────────────────────────────────────────

function TestsTab({ classInfo }: { classInfo: ClassInfo }) {
  const initial = testsByClass[classInfo.id] ?? [];
  const [tests, setTests] = useState<Test[]>(initial);
  const [creating, setCreating] = useState(false);
  const [analyticsTest, setAnalyticsTest] = useState<Test | null>(null);
  const [marksTest, setMarksTest] = useState<Test | null>(null);
  const [form, setForm] = useState({
    testName: "", testDate: "", startTime: "", endTime: "", totalQuestions: "20", totalMarks: "40",
    chapters: "", topics: "", instructions: "", status: "draft" as "draft" | "scheduled",
  });

  function createTest() {
    const newTest: Test = {
      id: `test_${Date.now()}`,
      classId: classInfo.id,
      className: classInfo.className,
      section: classInfo.section,
      subject: classInfo.subject,
      testName: form.testName,
      testDate: form.testDate,
      startTime: form.startTime,
      endTime: form.endTime,
      duration: `${form.startTime}–${form.endTime}`,
      totalQuestions: parseInt(form.totalQuestions),
      totalMarks: parseInt(form.totalMarks),
      chapters: form.chapters.split(",").map((c) => c.trim()).filter(Boolean),
      topics: form.topics.split(",").map((t) => t.trim()).filter(Boolean),
      instructions: form.instructions,
      status: form.status,
      marksPublished: false,
      studentMarks: (studentsByClass[classInfo.id] ?? []).map((s) => ({
        studentId: s.id, studentName: s.name, rollNumber: s.rollNumber, marks: null, percentage: null, grade: null, remarks: "", answerSheetUploaded: false,
      })),
    };
    setTests((prev) => [newTest, ...prev]);
    setCreating(false);
    setForm({ testName: "", testDate: "", startTime: "", endTime: "", totalQuestions: "20", totalMarks: "40", chapters: "", topics: "", instructions: "", status: "draft" });
  }

  const statusColor = { draft: "#78788c", scheduled: "#6366f1", ongoing: "#f59e0b", completed: "#10b981", marks_published: "#10b981" };

  if (analyticsTest) return <TestAnalytics test={analyticsTest} onBack={() => setAnalyticsTest(null)} />;
  if (marksTest) return <MarksEntry test={marksTest} onBack={() => setMarksTest(null)} onSave={(t) => { setTests((prev) => prev.map((x) => x.id === t.id ? t : x)); setMarksTest(null); }} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[#46465a]">{tests.length} tests</div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all">
          <Plus className="w-3.5 h-3.5" /> Create Test
        </button>
      </div>

      {creating && (
        <div className="bg-[#131316] border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">Create Test</div>
            <button onClick={() => setCreating(false)}><X className="w-4 h-4 text-[#78788c]" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Test Name *</label>
              <input value={form.testName} onChange={(e) => setForm((p) => ({ ...p, testName: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Date *</label>
              <input type="date" value={form.testDate} onChange={(e) => setForm((p) => ({ ...p, testDate: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Start</label>
                <input type="time" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">End</label>
                <input type="time" value={form.endTime} onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Total Questions</label>
              <input type="number" value={form.totalQuestions} onChange={(e) => setForm((p) => ({ ...p, totalQuestions: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Total Marks</label>
              <input type="number" value={form.totalMarks} onChange={(e) => setForm((p) => ({ ...p, totalMarks: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Chapters (comma-separated)</label>
              <input value={form.chapters} onChange={(e) => setForm((p) => ({ ...p, chapters: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Topics (comma-separated)</label>
              <input value={form.topics} onChange={(e) => setForm((p) => ({ ...p, topics: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Instructions</label>
              <textarea value={form.instructions} onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))} rows={2}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#3b5bdb]/40 resize-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">Publish</label>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "draft" | "scheduled" }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
                <option value="draft">Save as Draft</option>
                <option value="scheduled">Schedule & Publish</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5">Cancel</button>
            <button onClick={createTest} disabled={!form.testName || !form.testDate}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] disabled:opacity-40 transition-all">
              <Save className="w-3.5 h-3.5" /> {form.status === "draft" ? "Save Draft" : "Schedule Test"}
            </button>
          </div>
        </div>
      )}

      {tests.map((t) => (
        <div key={t.id} className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#6366f1]/15 flex items-center justify-center shrink-0">
            <ClipboardList className="w-4 h-4 text-[#6366f1]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-xs font-bold text-white">{t.testName}</div>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"
                style={{ background: `${statusColor[t.status]}18`, color: statusColor[t.status] }}>{t.status.replace("_", " ")}</span>
              {t.marksPublished && <span className="text-[9px] font-bold text-[#10b981] bg-[#10b981]/10 px-1.5 py-0.5 rounded-full">Marks Published</span>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-[#78788c]">
              <span className="flex items-center gap-1"><Calendar className="w-2.5 h-2.5" /> {t.testDate}</span>
              <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {t.startTime}–{t.endTime}</span>
            </div>
            <div className="mt-1 text-[10px] text-[#46465a]">{t.totalQuestions} Qs · {t.totalMarks} marks · {t.chapters.join(", ")}</div>
          </div>
          <div className="flex gap-2 shrink-0">
            {(t.status === "completed" || t.status === "marks_published") && (
              <button onClick={() => setAnalyticsTest(t)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold text-[#6366f1] bg-[#6366f1]/10 hover:bg-[#6366f1]/15 transition-all">
                <BarChart2 className="w-3 h-3" /> Analytics
              </button>
            )}
            {(t.status === "completed" || t.status === "scheduled") && !t.marksPublished && (
              <button onClick={() => setMarksTest(t)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 hover:bg-[#3b5bdb]/15 transition-all">
                <Edit2 className="w-3 h-3" /> Marks
              </button>
            )}
            <button onClick={() => setTests((prev) => prev.filter((x) => x.id !== t.id))}
              className="w-7 h-7 rounded-lg bg-[#cc5069]/10 text-[#cc5069] flex items-center justify-center hover:bg-[#cc5069]/20 transition-all">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Marks Entry ───────────────────────────────────────────────────────────────

function MarksEntry({ test, onBack, onSave }: { test: Test; onBack: () => void; onSave: (t: Test) => void }) {
  const [entries, setEntries] = useState<Record<string, { marks: string; remarks: string }>>(
    Object.fromEntries(test.studentMarks.map((sm) => [sm.studentId, { marks: sm.marks != null ? String(sm.marks) : "", remarks: sm.remarks }]))
  );
  const [flash, setFlash] = useState<string | null>(null);

  function computeGrade(pct: number) {
    if (pct >= 90) return "A+";
    if (pct >= 80) return "A";
    if (pct >= 70) return "B+";
    if (pct >= 60) return "B";
    if (pct >= 50) return "C+";
    if (pct >= 40) return "C";
    return "F";
  }

  function publish() {
    const updated: Test = {
      ...test,
      status: "marks_published",
      marksPublished: true,
      studentMarks: test.studentMarks.map((sm) => {
        const e = entries[sm.studentId];
        const marks = e?.marks ? parseInt(e.marks) : null;
        const pct = marks != null ? Math.round((marks / test.totalMarks) * 100) : null;
        return { ...sm, marks, percentage: pct, grade: pct != null ? computeGrade(pct) : null, remarks: e?.remarks ?? "" };
      }),
    };
    onSave(updated);
    setFlash("Marks published successfully");
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[10px] text-[#78788c] hover:text-white transition-all">
        <ChevronRight className="w-3 h-3 rotate-180" /> Back to Tests
      </button>
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
          <Check className="w-3.5 h-3.5" /> {flash}
        </div>
      )}

      <div className="bg-[#131316] border border-white/7 rounded-2xl p-4">
        <div className="text-sm font-black text-white">{test.testName}</div>
        <div className="text-[10px] text-[#78788c] mt-0.5">{test.className} {test.section} · {test.subject} · {test.testDate} · Max: {test.totalMarks} marks</div>
      </div>

      <div className="space-y-2">
        {test.studentMarks.map((sm) => {
          const e = entries[sm.studentId];
          const marks = e?.marks ? parseInt(e.marks) : null;
          const isInvalid = marks != null && (marks < 0 || marks > test.totalMarks);
          return (
            <div key={sm.studentId} className="flex items-center gap-3 p-3 bg-[#131316] border border-white/7 rounded-xl">
              <InitialsAvatar name={sm.studentName} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-white">{sm.studentName}</div>
                <div className="text-[9px] text-[#46465a]">{sm.rollNumber}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input type="number" min={0} max={test.totalMarks}
                  value={e?.marks ?? ""}
                  onChange={(ev) => setEntries((p) => ({ ...p, [sm.studentId]: { ...p[sm.studentId], marks: ev.target.value } }))}
                  placeholder={`/${test.totalMarks}`}
                  className={cn("w-20 bg-white/5 border rounded-xl px-3 py-1.5 text-xs text-white outline-none text-center",
                    isInvalid ? "border-[#cc5069]/40" : "border-white/10 focus:border-[#3b5bdb]/40")} />
                <input
                  value={e?.remarks ?? ""}
                  onChange={(ev) => setEntries((p) => ({ ...p, [sm.studentId]: { ...p[sm.studentId], remarks: ev.target.value } }))}
                  placeholder="Remarks…"
                  className="w-40 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-[#3b5bdb]/40" />
                <button className="w-7 h-7 rounded-lg bg-white/5 text-[#46465a] flex items-center justify-center hover:bg-white/10 transition-all" title="Upload answer sheet">
                  <Upload className="w-3 h-3" />
                </button>
              </div>
              {e?.marks && (
                <div className="text-[10px] font-bold" style={{ color: (parseInt(e.marks) / test.totalMarks) >= 0.7 ? "#10b981" : "#cc5069" }}>
                  {Math.round((parseInt(e.marks) / test.totalMarks) * 100)}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={onBack} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">Cancel</button>
        <button onClick={() => setFlash("Draft saved")} className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
          <Save className="w-3.5 h-3.5" /> Save Draft
        </button>
        <button onClick={publish}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-[#3b5bdb] hover:bg-[#d97706] transition-all">
          <Eye className="w-3.5 h-3.5" /> Publish Marks
        </button>
      </div>
    </div>
  );
}

// ── Test Analytics ────────────────────────────────────────────────────────────

function TestAnalytics({ test, onBack }: { test: Test; onBack: () => void }) {
  const [search, setSearch] = useState("");
  const entries = test.studentMarks.filter((sm) => sm.marks != null);
  const attempted = entries.length;
  const notAttempted = test.studentMarks.length - attempted;
  const attemptPct = Math.round((attempted / test.studentMarks.length) * 100);

  const marks = entries.map((e) => e.marks as number);
  const highest = marks.length ? Math.max(...marks) : 0;
  const lowest = marks.length ? Math.min(...marks) : 0;
  const average = marks.length ? Math.round(marks.reduce((a, b) => a + b, 0) / marks.length) : 0;
  const avgPct = Math.round((average / test.totalMarks) * 100);

  const sorted = [...entries].sort((a, b) => (b.marks ?? 0) - (a.marks ?? 0));
  const leaderboard = sorted.map((e, i) => ({ ...e, rank: i + 1 }));

  const topPerformers = sorted.slice(0, 3);
  const needAttention = sorted.slice(-3).reverse();

  const strongTopics = test.topics.slice(0, Math.ceil(test.topics.length / 2));
  const weakTopics = test.topics.slice(Math.ceil(test.topics.length / 2));

  const filteredLb = leaderboard.filter((e) =>
    !search || e.studentName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[10px] text-[#78788c] hover:text-white transition-all">
        <ChevronRight className="w-3 h-3 rotate-180" /> Back to Tests
      </button>

      <div className="bg-[#131316] border border-white/7 rounded-2xl p-4">
        <div className="text-sm font-black text-white">{test.testName} — Analytics</div>
        <div className="text-[10px] text-[#78788c] mt-0.5">{test.className} {test.section} · {test.subject} · {test.testDate}</div>
      </div>

      {/* Participation */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
        <div className="text-xs font-bold text-white mb-4">Participation</div>
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-xl font-black text-white">{test.studentMarks.length}</div>
            <div className="text-[10px] text-[#78788c]">Total Students</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-black text-[#10b981]">{attempted}</div>
            <div className="text-[10px] text-[#78788c]">Attempted</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-black text-[#cc5069]">{notAttempted}</div>
            <div className="text-[10px] text-[#78788c]">Not Attempted</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-black text-[#3b5bdb]">{attemptPct}%</div>
            <div className="text-[10px] text-[#78788c]">Attempt Rate</div>
          </div>
        </div>
      </div>

      {/* Performance summary */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
        <div className="text-xs font-bold text-white mb-4">Performance Summary</div>
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-[#10b981]/10">
            <div className="text-lg font-black text-[#10b981]">{highest}</div>
            <div className="text-[9px] text-[#10b981]">Highest</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-[#cc5069]/10">
            <div className="text-lg font-black text-[#cc5069]">{lowest}</div>
            <div className="text-[9px] text-[#cc5069]">Lowest</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-[#3b5bdb]/10">
            <div className="text-lg font-black text-[#3b5bdb]">{average}</div>
            <div className="text-[9px] text-[#3b5bdb]">Average</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-[#6366f1]/10">
            <div className="text-lg font-black text-[#6366f1]">{avgPct}%</div>
            <div className="text-[9px] text-[#6366f1]">Avg %</div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
          <Star className="w-4 h-4 text-[#3b5bdb]" />
          <div className="text-xs font-bold text-white">Leaderboard</div>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 mb-3">
            <Search className="w-3 h-3 text-[#46465a] shrink-0" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student…"
              className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none" />
          </div>
          <div className="space-y-1.5">
            {filteredLb.map((e) => (
              <div key={e.studentId} className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                e.rank <= 3 ? "bg-[#3b5bdb]/5 border border-[#3b5bdb]/15" : "bg-white/3")}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0"
                  style={{ background: e.rank === 1 ? "#f59e0b30" : e.rank === 2 ? "#78788c30" : e.rank === 3 ? "#c08a3a30" : "#ffffff10",
                    color: e.rank === 1 ? "#f59e0b" : e.rank === 2 ? "#b0b0c0" : e.rank === 3 ? "#c08a3a" : "#46465a" }}>
                  {e.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">{e.studentName}</div>
                  <div className="text-[9px] text-[#46465a]">{e.rollNumber}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-black text-white">{e.marks}/{test.totalMarks}</div>
                  <div className="text-[9px] text-[#78788c]">{e.percentage}%</div>
                </div>
                <GradeChip grade={e.grade} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Topic Analysis */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Strong Topics</div>
          <div className="flex flex-wrap gap-2">
            {strongTopics.map((t) => (
              <span key={t} className="text-[10px] px-2 py-1 rounded-lg bg-[#10b981]/10 text-[#10b981] font-semibold">{t}</span>
            ))}
            {strongTopics.length === 0 && <div className="text-[10px] text-[#46465a]">—</div>}
          </div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Weak Topics</div>
          <div className="flex flex-wrap gap-2">
            {weakTopics.map((t) => (
              <span key={t} className="text-[10px] px-2 py-1 rounded-lg bg-[#cc5069]/10 text-[#cc5069] font-semibold">{t}</span>
            ))}
            {weakTopics.length === 0 && <div className="text-[10px] text-[#46465a]">—</div>}
          </div>
        </div>
      </div>

      {/* Student Insights + AI Recommendations */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Student Insights</div>
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-[#3b5bdb] uppercase tracking-wider">Top Performers</div>
            {topPerformers.map((e) => (
              <div key={e.studentId} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                <span className="text-[10px] text-white">{e.studentName}</span>
                <span className="text-[9px] text-[#46465a]">{e.marks}/{test.totalMarks}</span>
              </div>
            ))}
            <div className="text-[10px] font-bold text-[#cc5069] uppercase tracking-wider mt-3">Needs Attention</div>
            {needAttention.map((e) => (
              <div key={e.studentId} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#cc5069]" />
                <span className="text-[10px] text-white">{e.studentName}</span>
                <span className="text-[9px] text-[#46465a]">{e.marks}/{test.totalMarks}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-[#6366f1]" />
            <div className="text-xs font-bold text-white">AI Teaching Insights</div>
          </div>
          <div className="space-y-3 text-[10px] text-[#b0b0c0] leading-relaxed">
            {avgPct < 70 && <div>• Class average of {avgPct}% indicates the class struggled. Consider a revision class before the next test.</div>}
            {weakTopics.length > 0 && <div>• <span className="text-white font-semibold">{weakTopics.join(", ")}</span> showed weaker performance. Plan targeted sessions on these topics.</div>}
            {needAttention.length > 0 && <div>• {needAttention.map((e) => e.studentName).join(", ")} scored below 50% and may need individual attention or remedial support.</div>}
            {topPerformers.length > 0 && <div>• Consider challenging {topPerformers[0].studentName} with advanced problems to maintain engagement.</div>}
            <div>• Recommended focus for next class: revisit {test.chapters[0] ?? "core chapter"} application problems with worked examples.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Class Insights sub-tab ────────────────────────────────────────────────────

function ClassInsightsTab({ classId }: { classId: string }) {
  const students = studentsByClass[classId] ?? [];
  const avgAtt = students.length ? Math.round(students.reduce((s, st) => s + st.attendancePct, 0) / students.length) : 0;
  const avgPerf = students.length ? Math.round(students.reduce((s, st) => s + st.performanceScore, 0) / students.length) : 0;
  const hw = (homeworkByClass[classId] ?? []).filter((h) => h.status === "active");
  const hwCompletion = hw.length ? Math.round(hw.reduce((s, h) => s + (h.submitted / h.totalStudents) * 100, 0) / hw.length) : 0;
  const topStudents = [...students].sort((a, b) => b.performanceScore - a.performanceScore).slice(0, 3);
  const needAttention = [...students].sort((a, b) => a.performanceScore - b.performanceScore).slice(0, 3);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#3b5bdb]">{avgPerf}</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Avg Performance Score</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black" style={{ color: avgAtt >= 85 ? "#10b981" : "#cc5069" }}>{avgAtt}%</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Avg Attendance</div>
        </div>
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
          <div className="text-xl font-black text-[#6366f1]">{hwCompletion}%</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">Homework Completion</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Top Performers</div>
          <div className="space-y-2">
            {topStudents.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg text-[9px] font-black flex items-center justify-center" style={{ background: i === 0 ? "#f59e0b30" : "#ffffff10", color: i === 0 ? "#f59e0b" : "#46465a" }}>{i + 1}</div>
                <InitialsAvatar name={s.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{s.name}</div>
                </div>
                <div className="text-xs font-bold text-[#10b981]">{s.performanceScore}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-xs font-bold text-white mb-3">Needs Attention</div>
          <div className="space-y-2">
            {needAttention.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#cc5069] shrink-0" />
                <InitialsAvatar name={s.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{s.name}</div>
                </div>
                <div className="text-xs font-bold text-[#cc5069]">{s.performanceScore}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
        <div className="text-xs font-bold text-white mb-3">Weak Areas (Class-wide)</div>
        <div className="space-y-2 text-[10px] text-[#b0b0c0]">
          <div>• <span className="text-white font-semibold">Application-based problems</span> — multiple students lost marks on word problems</div>
          <div>• <span className="text-white font-semibold">Simultaneous equations</span> — graphical method causing confusion</div>
          <div>• <span className="text-white font-semibold">Showing working steps</span> — several students skipped intermediate steps losing partial credit</div>
        </div>
      </div>
    </div>
  );
}

// ── Main MyClasses page ───────────────────────────────────────────────────────

export default function MyClasses() {
  const { ctx, ready } = useAcademicContext();
  const [liveClasses, setLiveClasses] = useState<ClassInfo[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("students");
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classError, setClassError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoadingClasses(true);
      setClassError(null);
      try {
        const list = await AttendanceService.listAssignedClasses(ctx);
        if (cancelled) return;
        const mapped = list.map(assignedToClassInfo);
        setLiveClasses(mapped);
        setSelectedClass((prev) => {
          if (prev && mapped.some((c) => c.id === prev.id)) return prev;
          return mapped[0] ?? null;
        });
      } catch (e) {
        if (!cancelled) {
          setClassError(e instanceof Error ? e.message : "Failed to load assigned classes");
          setLiveClasses([]);
          setSelectedClass(null);
        }
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  if (loadingClasses) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading assigned classes…
      </div>
    );
  }

  if (!selectedClass) {
    return (
      <div className="space-y-3 py-10 text-center">
        <div className="text-sm text-[#78788c]">
          {classError ?? "No classes assigned. Ask admin to create Teacher–Class–Subject mapping."}
        </div>
      </div>
    );
  }

  const students = studentsByClass[selectedClass.id] ?? [];
  const hw = homeworkByClass[selectedClass.id] ?? [];
  const asgn = assignmentsByClass[selectedClass.id] ?? [];
  const tests = testsByClass[selectedClass.id] ?? [];

  const hwPending = hw.filter((h) => h.status === "active" && h.pending > 0).length;
  const asgnToGrade = asgn.reduce((s, a) => s + (a.submitted - a.graded), 0);
  const testsNoMarks = tests.filter((t) => (t.status === "completed" || t.status === "scheduled") && !t.marksPublished).length;

  const subTabs: { key: SubTab; label: string; badge?: number }[] = [
    { key: "students", label: `Students (${selectedClass.studentCount || students.length})` },
    { key: "attendance", label: "Attendance" },
    { key: "homework", label: "Homework", badge: hwPending },
    { key: "assignments", label: "Assignments", badge: asgnToGrade },
    { key: "tests", label: "Tests", badge: testsNoMarks },
    { key: "insights", label: "Class Insights" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">Select Class</div>
        <ClassSelector
          classes={liveClasses}
          selected={selectedClass}
          onSelect={(c) => {
            setSelectedClass(c);
            setSubTab("students");
          }}
        />
      </div>

      <div className="border-b border-white/7 flex gap-0 overflow-x-auto -mb-px">
        {subTabs.map((t) => (
          <TabBtn key={t.key} label={t.label} active={subTab === t.key} onClick={() => setSubTab(t.key)} badge={t.badge} />
        ))}
      </div>

      <div>
        {subTab === "students" && <StudentsTab classId={selectedClass.id} />}
        {subTab === "attendance" && <AttendanceTab classId={selectedClass.id} />}
        {subTab === "homework" && <HomeworkTab classId={selectedClass.id} />}
        {subTab === "assignments" && <AssignmentsTab classId={selectedClass.id} />}
        {subTab === "tests" && <TestsTab classInfo={selectedClass} />}
        {subTab === "insights" && <ClassInsightsTab classId={selectedClass.id} />}
      </div>
    </div>
  );
}
