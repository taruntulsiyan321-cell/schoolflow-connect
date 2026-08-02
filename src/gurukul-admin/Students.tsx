import { useState, useMemo } from "react";
import {
  Search, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Trash2, Edit2, Eye, UserX, UserCheck, X, GraduationCap,
  Mail, Phone, MapPin, Calendar, User, BookOpen, Activity,
  ArrowUpDown, CheckSquare, Square, Users,
} from "lucide-react";
import { AccountLinkingPanel } from "./AccountLinking";
import { cn, InitialsAvatar, StatusBadge, ConfirmModal, UndoToast, useUndoDelete } from "./shared";
import { adminStudents as initial, adminParents, classes, sections, type AdminStudent, type StudentStatus } from "./data";

type SortField = "fullName" | "className" | "status" | "attendance" | "performanceScore";
type SortDir = "asc" | "desc";
type DetailTab = "profile" | "attendance" | "performance" | "activity" | "parent" | "account";

const PER_PAGE = 6;

function StudentForm({
  student,
  onSave,
  onClose,
}: {
  student?: AdminStudent;
  onSave: (s: AdminStudent) => void;
  onClose: () => void;
}) {
  const blank: AdminStudent = {
    id: `s${Date.now()}`, admissionNumber: "", rollNumber: "", firstName: "", lastName: "",
    fullName: "", email: "", phone: "", gender: "male", dob: "", className: "11th", section: "A",
    status: "active", address: "", parentName: "", parentPhone: "", parentEmail: "",
    joinedDate: new Date().toISOString().slice(0, 10), attendance: 100, performanceScore: 75,
    lastActive: "Just now",
  };
  const [form, setForm] = useState<AdminStudent>(student ?? blank);

  function field(key: keyof AdminStudent, label: string, type = "text", opts?: string[]) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
        {opts ? (
          <select
            value={form[key] as string}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50"
          >
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type={type}
            value={form[key] as string}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50"
          />
        )}
      </div>
    );
  }

  function handleSave() {
    const updated = { ...form, fullName: `${form.firstName} ${form.lastName}`.trim() };
    onSave(updated);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#0d0d0f] border-b border-white/7 px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-bold text-white">{student ? "Edit Student" : "Add New Student"}</div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          {field("firstName", "First Name")}
          {field("lastName", "Last Name")}
          {field("email", "Email", "email")}
          {field("phone", "Phone")}
          {field("gender", "Gender", "text", ["male", "female"])}
          {field("dob", "Date of Birth", "date")}
          {field("className", "Class", "text", classes)}
          {field("section", "Section", "text", sections)}
          {field("admissionNumber", "Admission No.")}
          {field("rollNumber", "Roll No.")}
          {field("status", "Status", "text", ["active", "inactive", "suspended"])}
          {field("address", "Address")}
          {field("parentName", "Parent Name")}
          {field("parentPhone", "Parent Phone")}
          {field("parentEmail", "Parent Email", "email")}
          {field("joinedDate", "Joining Date", "date")}
        </div>
        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            {student ? "Save Changes" : "Add Student"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentDetail({
  student,
  onClose,
  onEdit,
}: {
  student: AdminStudent;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("profile");
  const parent = adminParents.find((p) => p.linkedStudentIds.includes(student.id));

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "attendance", label: "Attendance" },
    { key: "performance", label: "Performance" },
    { key: "activity", label: "Activity" },
    { key: "parent", label: "Parent" },
    { key: "account", label: "Account" },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <InitialsAvatar name={student.fullName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{student.fullName}</div>
            <div className="text-[10px] text-[#78788c]">{student.admissionNumber}</div>
            <div className="mt-1"><StatusBadge status={student.status} /></div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-white/7 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "text-[10px] font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all",
                tab === t.key ? "bg-[#3b5bdb]/20 text-[#3b5bdb]" : "text-[#78788c] hover:text-white"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === "profile" && (
            <>
              {[
                { icon: <Mail className="w-3.5 h-3.5" />, label: "Email", value: student.email },
                { icon: <Phone className="w-3.5 h-3.5" />, label: "Phone", value: student.phone },
                { icon: <User className="w-3.5 h-3.5" />, label: "Gender", value: student.gender },
                { icon: <Calendar className="w-3.5 h-3.5" />, label: "Date of Birth", value: student.dob },
                { icon: <GraduationCap className="w-3.5 h-3.5" />, label: "Class", value: `${student.className} - ${student.section}` },
                { icon: <MapPin className="w-3.5 h-3.5" />, label: "Address", value: student.address },
                { icon: <Calendar className="w-3.5 h-3.5" />, label: "Joined", value: student.joinedDate },
              ].map((row) => (
                <div key={row.label} className="flex items-start gap-3 p-3 rounded-xl bg-white/3">
                  <span className="text-[#78788c] mt-0.5">{row.icon}</span>
                  <div>
                    <div className="text-[9px] text-[#46465a] uppercase tracking-wider">{row.label}</div>
                    <div className="text-xs text-white mt-0.5">{row.value}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "attendance" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 text-center">
                <div className="text-4xl font-black text-[#3b5bdb]">{student.attendance}%</div>
                <div className="text-xs text-[#78788c] mt-1">Overall Attendance</div>
              </div>
              <div className="text-xs text-[#78788c] text-center">Monthly breakdown not available yet.</div>
            </div>
          )}

          {tab === "performance" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#4b9fd4]/10 border border-[#4b9fd4]/20 text-center">
                <div className="text-4xl font-black text-[#4b9fd4]">{student.performanceScore}</div>
                <div className="text-xs text-[#78788c] mt-1">Performance Score</div>
              </div>
              <div className="text-xs text-[#78788c] text-center">Subject-wise breakdown not available yet.</div>
            </div>
          )}

          {tab === "activity" && (
            <div className="text-xs text-[#78788c] text-center pt-8">
              Last active: {student.lastActive}
            </div>
          )}

          {tab === "parent" && parent && (
            <>
              {[
                { label: "Name", value: parent.fullName },
                { label: "Relationship", value: parent.relationship },
                { label: "Email", value: parent.email },
                { label: "Phone", value: parent.phone },
                { label: "Occupation", value: parent.occupation },
              ].map((row) => (
                <div key={row.label} className="flex flex-col gap-1 p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] text-[#46465a] uppercase tracking-wider">{row.label}</div>
                  <div className="text-xs text-white">{row.value}</div>
                </div>
              ))}
            </>
          )}
          {tab === "parent" && !parent && (
            <div className="text-xs text-[#78788c] text-center pt-8">No parent record linked.</div>
          )}

          {tab === "account" && <AccountLinkingPanel entityName={student.fullName} entityType="student" status={student.status} />}
        </div>

        <div className="p-4 border-t border-white/7">
          <button
            onClick={onEdit}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all"
          >
            Edit Student
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudentManagement() {
  const [students, setStudents] = useState<AdminStudent[]>(initial);
  const { toast, closeToast, softDelete } = useUndoDelete<AdminStudent>(setStudents);
  const [search, setSearch] = useState("");
  const [filterClass, setFilterClass] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortField, setSortField] = useState<SortField>("fullName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detailStudent, setDetailStudent] = useState<AdminStudent | null>(null);
  const [editStudent, setEditStudent] = useState<AdminStudent | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | "bulk" | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    let list = students;
    if (search) list = list.filter((s) => s.fullName.toLowerCase().includes(search.toLowerCase()) || s.admissionNumber.includes(search));
    if (filterClass !== "all") list = list.filter((s) => s.className === filterClass);
    if (filterStatus !== "all") list = list.filter((s) => s.status === filterStatus);
    list = [...list].sort((a, b) => {
      const va = a[sortField] ?? "";
      const vb = b[sortField] ?? "";
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [students, search, filterClass, filterStatus, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const allSelected = paged.length > 0 && paged.every((s) => selected.has(s.id));

  function toggleAll() {
    const ids = paged.map((s) => s.id);
    if (allSelected) setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
    else setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
  }

  function handleSave(s: AdminStudent) {
    setStudents((prev) => {
      const idx = prev.findIndex((x) => x.id === s.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = s; return next; }
      return [s, ...prev];
    });
    setEditStudent(null);
    setStatusToast(editStudent === "new" ? "Student added successfully" : "Student updated");
    setTimeout(() => setStatusToast(null), 3000);
  }

  function handleDelete(id: string) {
    const item = students.find((x) => x.id === id);
    if (!item) return;
    setDetailStudent(null);
    softDelete([item], `${item.fullName} deleted`);
  }

  function handleBulkDelete() {
    const toRemove = students.filter((s) => selected.has(s.id));
    setSelected(new Set());
    softDelete(toRemove, `${toRemove.length} students deleted`);
  }

  function handleBulkStatus(status: StudentStatus) {
    setStudents((prev) => prev.map((s) => selected.has(s.id) ? { ...s, status } : s));
    setSelected(new Set());
    setStatusToast(`${selected.size} students ${status}`);
    setTimeout(() => setStatusToast(null), 3000);
  }

  const SortIcon = ({ field }: { field: SortField }) => (
    sortField === field
      ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
      : <ArrowUpDown className="w-3 h-3 opacity-30" />
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#46465a]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search students..."
            className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50"
          />
        </div>
        <select
          value={filterClass}
          onChange={(e) => { setFilterClass(e.target.value); setPage(1); }}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#3b5bdb]/50"
        >
          <option value="all">All Classes</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#3b5bdb]/50"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          onClick={() => setEditStudent("new")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Add Student
        </button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#3b5bdb]/10 border border-[#3b5bdb]/20">
          <Users className="w-4 h-4 text-[#3b5bdb]" />
          <span className="text-sm text-white font-semibold">{selected.size} selected</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => handleBulkStatus("active")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#4aa87a] bg-[#4aa87a]/10 hover:bg-[#4aa87a]/20 transition-all">
              <UserCheck className="w-3 h-3" /> Activate
            </button>
            <button onClick={() => handleBulkStatus("inactive")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
              <UserX className="w-3 h-3" /> Deactivate
            </button>
            <button onClick={() => setConfirmDelete("bulk")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#cc5069] bg-[#cc5069]/10 hover:bg-[#cc5069]/20 transition-all">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/7">
              <th className="px-4 py-3 text-left w-10">
                <button onClick={toggleAll} className="text-[#78788c] hover:text-white">
                  {allSelected ? <CheckSquare className="w-4 h-4 text-[#3b5bdb]" /> : <Square className="w-4 h-4" />}
                </button>
              </th>
              {([
                { key: "fullName", label: "Student" },
                { key: "className", label: "Class" },
                { key: "status", label: "Status" },
                { key: "attendance", label: "Attendance" },
                { key: "performanceScore", label: "Score" },
              ] as { key: SortField; label: string }[]).map((col) => (
                <th key={col.key} className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort(col.key)} className="flex items-center gap-1.5 text-[10px] font-bold text-[#78788c] uppercase tracking-wider hover:text-white transition-colors">
                    {col.label} <SortIcon field={col.key} />
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Last Active</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paged.map((s) => (
              <tr key={s.id} className="hover:bg-white/2 transition-colors group">
                <td className="px-4 py-3">
                  <button onClick={() => setSelected((prev) => { const next = new Set(prev); next.has(s.id) ? next.delete(s.id) : next.add(s.id); return next; })} className="text-[#78788c] hover:text-white">
                    {selected.has(s.id) ? <CheckSquare className="w-4 h-4 text-[#3b5bdb]" /> : <Square className="w-4 h-4" />}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <InitialsAvatar name={s.fullName} size="sm" />
                    <div>
                      <div className="text-sm font-semibold text-white">{s.fullName}</div>
                      <div className="text-[10px] text-[#78788c]">{s.admissionNumber}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[#78788c]">{s.className} - {s.section}</td>
                <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-[#3b5bdb]" style={{ width: `${s.attendance}%` }} />
                    </div>
                    <span className="text-xs font-bold text-white tabular-nums">{s.attendance}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-white tabular-nums">{s.performanceScore}</td>
                <td className="px-4 py-3 text-xs text-[#78788c]">{s.lastActive}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setDetailStudent(s)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditStudent(s)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(s.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {paged.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16">
            <GraduationCap className="w-8 h-8 text-[#46465a]" />
            <div className="text-sm text-[#78788c]">No students found</div>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/7">
          <div className="text-xs text-[#78788c]">{filtered.length} students total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] disabled:opacity-30 transition-all">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-[#78788c]">{page} / {totalPages || 1}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] disabled:opacity-30 transition-all">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {editStudent !== null && (
        <StudentForm
          student={editStudent === "new" ? undefined : editStudent}
          onSave={handleSave}
          onClose={() => setEditStudent(null)}
        />
      )}

      {detailStudent && (
        <StudentDetail
          student={detailStudent}
          onClose={() => setDetailStudent(null)}
          onEdit={() => { setEditStudent(detailStudent); setDetailStudent(null); }}
        />
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title={confirmDelete === "bulk" ? `Are you sure you want to delete ${selected.size} students?` : "Are you sure you want to delete this student?"}
        description="You will have 5 seconds to undo after deletion."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (confirmDelete === "bulk") handleBulkDelete();
          else if (confirmDelete) handleDelete(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {statusToast && <UndoToast state={{ message: statusToast, type: "success" }} onClose={() => setStatusToast(null)} />}
      {toast && <UndoToast state={toast} onClose={closeToast} />}
    </div>
  );
}
