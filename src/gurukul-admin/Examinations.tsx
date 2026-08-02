import { useState, useMemo } from "react";
import {
  Plus, Search, Eye, Edit2, Trash2, Copy, Archive, X,
  Calendar, Clock, BookOpen, ChevronDown, ChevronRight,
  GraduationCap, Send, RotateCcw, FileText, Filter,
} from "lucide-react";
import { cn, ConfirmModal, UndoToast, useUndoDelete, StatusBadge } from "./shared";
import { adminClasses, allSubjects, classes, sections } from "./data";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExamStatus = "draft" | "published" | "ongoing" | "completed" | "archived";
type ExamType = "unit_test" | "mid_term" | "pre_board" | "board" | "final" | "other";

interface SubjectSchedule {
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  maxMarks: number;
  passingMarks: number;
}

interface Examination {
  id: string;
  name: string;
  academicYear: string;
  type: ExamType;
  startDate: string;
  endDate: string;
  applicableClasses: string[];
  applicableSections: string[];
  subjects: SubjectSchedule[];
  instructions: string;
  status: ExamStatus;
  createdAt: string;
  updatedAt: string;
}

/** Empty until examination schedule service is wired — never seed fake exams. */
const INITIAL: Examination[] = [];

const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  unit_test: "Unit Test", mid_term: "Mid-Term", pre_board: "Pre-Board",
  board: "Board Exam", final: "Final Exam", other: "Other",
};

const STATUS_TABS: { key: ExamStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "published", label: "Upcoming" },
  { key: "ongoing", label: "Ongoing" },
  { key: "completed", label: "Completed" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" },
];

// ── Exam Form ─────────────────────────────────────────────────────────────────

function ExamForm({ exam, onSave, onClose }: { exam?: Examination; onSave: (e: Examination) => void; onClose: () => void }) {
  const blank: Examination = {
    id: `ex${Date.now()}`, name: "", academicYear: "2026-27", type: "unit_test",
    startDate: "", endDate: "", applicableClasses: [], applicableSections: [],
    subjects: [], instructions: "", status: "draft",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const [form, setForm] = useState<Examination>(exam ?? blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.startDate) e.startDate = "Required";
    if (!form.endDate) e.endDate = "Required";
    if (form.applicableClasses.length === 0) e.classes = "Select at least one class";
    if (form.subjects.length === 0) e.subjects = "Add at least one subject";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function toggleClass(cls: string) {
    setForm((f) => ({ ...f, applicableClasses: f.applicableClasses.includes(cls) ? f.applicableClasses.filter((x) => x !== cls) : [...f.applicableClasses, cls] }));
  }

  function toggleSection(sec: string) {
    setForm((f) => ({ ...f, applicableSections: f.applicableSections.includes(sec) ? f.applicableSections.filter((x) => x !== sec) : [...f.applicableSections, sec] }));
  }

  function addSubject() {
    const newSub: SubjectSchedule = { subject: allSubjects[0], date: form.startDate, startTime: "09:00", endTime: "11:00", maxMarks: 100, passingMarks: 35 };
    setForm((f) => ({ ...f, subjects: [...f.subjects, newSub] }));
  }

  function updateSubject(idx: number, field: keyof SubjectSchedule, value: string | number) {
    setForm((f) => {
      const subjects = [...f.subjects];
      subjects[idx] = { ...subjects[idx], [field]: value };
      return { ...f, subjects };
    });
  }

  function removeSubject(idx: number) {
    setForm((f) => ({ ...f, subjects: f.subjects.filter((_, i) => i !== idx) }));
  }

  function handleSave(publish = false) {
    if (!validate()) return;
    onSave({ ...form, status: publish ? "published" : form.status, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#0d0d0f] border-b border-white/7 px-6 py-4 flex items-center justify-between z-10">
          <div className="text-sm font-bold text-white">{exam ? "Edit Examination" : "Create Examination"}</div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Examination Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Unit Test 1 — July 2026"
                className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50", errors.name ? "border-[#cc5069]/50" : "border-white/10")} />
              {errors.name && <span className="text-[9px] text-[#cc5069]">{errors.name}</span>}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Academic Year</label>
              <select value={form.academicYear} onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50">
                {["2025-26", "2026-27", "2027-28"].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Examination Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ExamType }))}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50">
                {Object.entries(EXAM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Start Date</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50", errors.startDate ? "border-[#cc5069]/50" : "border-white/10")} />
              {errors.startDate && <span className="text-[9px] text-[#cc5069]">{errors.startDate}</span>}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">End Date</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50", errors.endDate ? "border-[#cc5069]/50" : "border-white/10")} />
              {errors.endDate && <span className="text-[9px] text-[#cc5069]">{errors.endDate}</span>}
            </div>
          </div>

          {/* Classes & sections */}
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Applicable Classes</label>
              {errors.classes && <span className="text-[9px] text-[#cc5069]">{errors.classes}</span>}
              <div className="flex gap-2">
                {classes.map((cls) => (
                  <button key={cls} onClick={() => toggleClass(cls)}
                    className={cn("px-4 py-2 rounded-xl text-sm font-semibold border transition-all",
                      form.applicableClasses.includes(cls) ? "bg-[#3b5bdb]/15 border-[#3b5bdb]/30 text-[#a5b4fc]" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
                    Class {cls}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Applicable Sections</label>
              <div className="flex gap-2">
                {sections.map((sec) => (
                  <button key={sec} onClick={() => toggleSection(sec)}
                    className={cn("px-4 py-2 rounded-xl text-sm font-semibold border transition-all",
                      form.applicableSections.includes(sec) ? "bg-[#3b5bdb]/15 border-[#3b5bdb]/30 text-[#a5b4fc]" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
                    Section {sec}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Subject schedule */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Subject Schedule</label>
              <button onClick={addSubject} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#3b5bdb] bg-[#3b5bdb]/10 hover:bg-[#3b5bdb]/20 transition-all">
                <Plus className="w-3 h-3" /> Add Subject
              </button>
            </div>
            {errors.subjects && <span className="text-[9px] text-[#cc5069]">{errors.subjects}</span>}
            <div className="space-y-2">
              {form.subjects.map((sub, idx) => (
                <div key={idx} className="bg-white/3 border border-white/7 rounded-xl p-3">
                  <div className="grid grid-cols-6 gap-2 items-end">
                    <div className="col-span-2 flex flex-col gap-1">
                      <label className="text-[8px] text-[#46465a] uppercase tracking-wider">Subject</label>
                      <select value={sub.subject} onChange={(e) => updateSubject(idx, "subject", e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
                        {allSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[8px] text-[#46465a] uppercase tracking-wider">Date</label>
                      <input type="date" value={sub.date} onChange={(e) => updateSubject(idx, "date", e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[8px] text-[#46465a] uppercase tracking-wider">Start</label>
                      <input type="time" value={sub.startTime} onChange={(e) => updateSubject(idx, "startTime", e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[8px] text-[#46465a] uppercase tracking-wider">End</label>
                      <input type="time" value={sub.endTime} onChange={(e) => updateSubject(idx, "endTime", e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none" />
                    </div>
                    <button onClick={() => removeSubject(idx)} className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 text-[#78788c] hover:text-[#cc5069] transition-all">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="flex items-center gap-2">
                      <label className="text-[8px] text-[#46465a] uppercase tracking-wider whitespace-nowrap">Max Marks</label>
                      <input type="number" value={sub.maxMarks} onChange={(e) => updateSubject(idx, "maxMarks", Number(e.target.value))}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[8px] text-[#46465a] uppercase tracking-wider whitespace-nowrap">Passing</label>
                      <input type="number" value={sub.passingMarks} onChange={(e) => updateSubject(idx, "passingMarks", Number(e.target.value))}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none" />
                    </div>
                  </div>
                </div>
              ))}
              {form.subjects.length === 0 && (
                <div className="text-xs text-[#46465a] text-center py-4 border border-dashed border-white/10 rounded-xl">
                  No subjects added yet. Click "Add Subject" to begin.
                </div>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Examination Instructions</label>
            <textarea value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} rows={4}
              placeholder="Enter instructions for students and invigilators..."
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-[#3b5bdb]/50" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex flex-wrap gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">Cancel</button>
          <button onClick={() => handleSave(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] border border-white/10 hover:text-white hover:bg-white/5 transition-all">Save as Draft</button>
          <button onClick={() => handleSave(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            <Send className="w-4 h-4" /> Publish
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Exam Detail ───────────────────────────────────────────────────────────────

function ExamDetail({ exam, onClose, onEdit }: { exam: Examination; onClose: () => void; onEdit: () => void }) {
  const statusColor: Record<ExamStatus, string> = {
    draft: "#78788c", published: "#4b9fd4", ongoing: "#c08a3a",
    completed: "#4aa87a", archived: "#46465a",
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-96 sm:w-[480px] bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-[#3b5bdb]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${statusColor[exam.status]}20`, color: statusColor[exam.status] }}>
                {exam.status.toUpperCase()}
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/5 text-[#78788c]">
                {EXAM_TYPE_LABELS[exam.type]}
              </span>
            </div>
            <div className="text-sm font-bold text-white">{exam.name}</div>
            <div className="text-[10px] text-[#78788c]">AY {exam.academicYear}</div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-white/3">
              <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1">Start Date</div>
              <div className="text-sm font-bold text-white">{exam.startDate}</div>
            </div>
            <div className="p-3 rounded-xl bg-white/3">
              <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1">End Date</div>
              <div className="text-sm font-bold text-white">{exam.endDate}</div>
            </div>
          </div>

          {/* Classes & Sections */}
          <div className="p-3 rounded-xl bg-white/3 space-y-2">
            <div className="flex gap-3">
              <div>
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1">Classes</div>
                <div className="flex gap-1">
                  {exam.applicableClasses.map((c) => <span key={c} className="text-xs font-bold text-[#a5b4fc] bg-[#3b5bdb]/10 px-2 py-0.5 rounded">{c}</span>)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1">Sections</div>
                <div className="flex gap-1">
                  {exam.applicableSections.map((s) => <span key={s} className="text-xs font-bold text-white bg-white/5 px-2 py-0.5 rounded">{s}</span>)}
                </div>
              </div>
            </div>
          </div>

          {/* Subject schedule */}
          <div>
            <div className="text-[10px] text-[#46465a] uppercase tracking-wider mb-3">Subject Schedule ({exam.subjects.length} subjects)</div>
            <div className="space-y-2">
              {exam.subjects.map((sub, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
                  <div className="w-8 h-8 rounded-lg bg-[#6882e8]/15 flex items-center justify-center shrink-0">
                    <BookOpen className="w-3.5 h-3.5 text-[#6882e8]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white">{sub.subject}</div>
                    <div className="text-[10px] text-[#78788c]">{sub.date} · {sub.startTime}–{sub.endTime}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-white">{sub.maxMarks} marks</div>
                    <div className="text-[9px] text-[#78788c]">Pass: {sub.passingMarks}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          {exam.instructions && (
            <div>
              <div className="text-[10px] text-[#46465a] uppercase tracking-wider mb-2">Instructions</div>
              <div className="text-xs text-[#c8c8d4] leading-relaxed bg-white/3 rounded-xl p-3 whitespace-pre-wrap">{exam.instructions}</div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/7">
          <button onClick={onEdit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            Edit Examination
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ExaminationManagement() {
  const [exams, setExams] = useState<Examination[]>(INITIAL);
  const { toast, closeToast, softDelete } = useUndoDelete<Examination>(setExams);
  const [statusTab, setStatusTab] = useState<ExamStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [formOpen, setFormOpen] = useState<Examination | "new" | null>(null);
  const [detail, setDetail] = useState<Examination | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = exams;
    if (statusTab !== "all") list = list.filter((e) => e.status === statusTab);
    if (search) list = list.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));
    if (filterType !== "all") list = list.filter((e) => e.type === filterType);
    return [...list].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [exams, statusTab, search, filterType]);

  function handleSave(exam: Examination) {
    setExams((prev) => {
      const idx = prev.findIndex((x) => x.id === exam.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = exam; return next; }
      return [exam, ...prev];
    });
    setFormOpen(null);
  }

  function handleDelete(id: string) {
    const item = exams.find((x) => x.id === id);
    if (!item) return;
    softDelete([item], `"${item.name}" deleted`);
  }

  function handleDuplicate(exam: Examination) {
    const dup: Examination = { ...exam, id: `ex${Date.now()}`, name: `Copy of ${exam.name}`, status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setExams((prev) => [dup, ...prev]);
  }

  function handleArchive(id: string) {
    setExams((prev) => prev.map((e) => e.id === id ? { ...e, status: "archived" as ExamStatus } : e));
  }

  function handlePublish(id: string) {
    setExams((prev) => prev.map((e) => e.id === id ? { ...e, status: "published" as ExamStatus } : e));
  }

  const statusColor: Record<ExamStatus, string> = {
    draft: "#78788c", published: "#4b9fd4", ongoing: "#c08a3a",
    completed: "#4aa87a", archived: "#46465a",
  };

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = { all: exams.length };
    exams.forEach((e) => { c[e.status] = (c[e.status] ?? 0) + 1; });
    return c;
  }, [exams]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#46465a]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search examinations..."
            className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50" />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#3b5bdb]/50">
          <option value="all">All Types</option>
          {Object.entries(EXAM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={() => setFormOpen("new")} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
          <Plus className="w-3.5 h-3.5" /> Create Examination
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 p-1 bg-[#131316] border border-white/7 rounded-2xl w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setStatusTab(tab.key)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
              statusTab === tab.key ? "bg-[#3b5bdb]/15 text-[#3b5bdb]" : "text-[#78788c] hover:text-white")}>
            {tab.label}
            <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full",
              statusTab === tab.key ? "bg-[#3b5bdb]/20 text-[#a5b4fc]" : "bg-white/5 text-[#46465a]")}>
              {tabCounts[tab.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Exam list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 bg-[#131316] border border-white/7 rounded-2xl">
            <FileText className="w-8 h-8 text-[#46465a]" />
            <div className="text-sm text-[#78788c]">No examinations found</div>
          </div>
        )}

        {filtered.map((exam) => (
          <div key={exam.id} className="bg-[#131316] border border-white/7 rounded-2xl p-5 hover:border-white/12 transition-all group">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-[#3b5bdb]" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-bold text-white">{exam.name}</span>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${statusColor[exam.status]}20`, color: statusColor[exam.status] }}>
                    {exam.status.toUpperCase()}
                  </span>
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/5 text-[#78788c]">{EXAM_TYPE_LABELS[exam.type]}</span>
                </div>

                <div className="flex items-center gap-4 text-[10px] text-[#78788c] mb-2">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {exam.startDate} → {exam.endDate}</span>
                  <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" /> {exam.subjects.length} subjects</span>
                  <span>AY {exam.academicYear}</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {exam.applicableClasses.map((c) => (
                    <span key={c} className="text-[9px] px-2 py-0.5 rounded-full bg-[#3b5bdb]/10 text-[#a5b4fc]">Class {c}</span>
                  ))}
                  {exam.applicableSections.map((s) => (
                    <span key={s} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-[#78788c]">Section {s}</span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => setDetail(exam)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setFormOpen(exam)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDuplicate(exam)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {exam.status === "draft" && (
                  <button onClick={() => handlePublish(exam.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#4b9fd4]/20 flex items-center justify-center text-[#78788c] hover:text-[#4b9fd4] transition-all">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
                {exam.status !== "archived" && (
                  <button onClick={() => handleArchive(exam.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => setConfirmDelete(exam.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {formOpen !== null && (
        <ExamForm exam={formOpen === "new" ? undefined : formOpen} onSave={handleSave} onClose={() => setFormOpen(null)} />
      )}
      {detail && (
        <ExamDetail exam={detail} onClose={() => setDetail(null)} onEdit={() => { setFormOpen(detail); setDetail(null); }} />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title="Are you sure you want to delete this examination?"
        description="You will have 5 seconds to undo after deletion."
        confirmLabel="Delete" danger
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
      {toast && <UndoToast state={toast} onClose={closeToast} />}
    </div>
  );
}
