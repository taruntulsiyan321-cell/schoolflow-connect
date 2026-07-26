import { useState, useMemo } from "react";
import {
  Search, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Trash2, Edit2, Eye, UserX, UserCheck, X, Users, ArrowUpDown,
  CheckSquare, Square, Mail, Phone, MapPin, Calendar, BookOpen,
} from "lucide-react";
import { AccountLinkingPanel } from "./AccountLinking";
import { cn, InitialsAvatar, StatusBadge, ConfirmModal, UndoToast, useUndoDelete } from "./shared";
import { adminTeachers as initial, classes, sections, departments, allSubjects, type AdminTeacher, type TeacherStatus } from "./data";

type SortField = "fullName" | "department" | "status" | "attendance";
type SortDir = "asc" | "desc";
type DetailTab = "profile" | "classes" | "attendance" | "activity" | "account";

const PER_PAGE = 6;

function TeacherForm({ teacher, onSave, onClose }: { teacher?: AdminTeacher; onSave: (t: AdminTeacher) => void; onClose: () => void }) {
  const blank: AdminTeacher = {
    id: `t${Date.now()}`, employeeId: "", firstName: "", lastName: "", fullName: "",
    email: "", phone: "", gender: "male", dob: "", qualification: "", department: "Science",
    subjects: [], assignedClasses: [], assignedSections: [], status: "active",
    address: "", joiningDate: new Date().toISOString().slice(0, 10), attendance: 100, lastActive: "Just now",
  };
  const [form, setForm] = useState<AdminTeacher>(teacher ?? blank);

  function field(key: keyof AdminTeacher, label: string, type = "text", opts?: string[]) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
        {opts ? (
          <select value={form[key] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]/50">
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type} value={form[key] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#6366f1]/50" />
        )}
      </div>
    );
  }

  function toggleMulti(key: "subjects" | "assignedClasses" | "assignedSections", val: string) {
    setForm((f) => {
      const arr = f[key] as string[];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  }

  function multiSelect(key: "subjects" | "assignedClasses" | "assignedSections", label: string, opts: string[]) {
    const arr = form[key] as string[];
    return (
      <div className="col-span-2 flex flex-col gap-1">
        <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <button key={o} onClick={() => toggleMulti(key, o)}
              className={cn("text-xs px-2.5 py-1 rounded-lg border transition-all",
                arr.includes(o) ? "bg-[#6366f1]/20 border-[#6366f1]/40 text-[#a5b4fc]" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function handleSave() {
    onSave({ ...form, fullName: `${form.firstName} ${form.lastName}`.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#0d0d0f] border-b border-white/7 px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-bold text-white">{teacher ? "Edit Teacher" : "Add New Teacher"}</div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          {field("firstName", "First Name")}
          {field("lastName", "Last Name")}
          {field("email", "Email", "email")}
          {field("phone", "Phone")}
          {field("gender", "Gender", "text", ["male", "female"])}
          {field("dob", "Date of Birth", "date")}
          {field("department", "Department", "text", departments)}
          {field("qualification", "Qualification")}
          {field("employeeId", "Employee ID")}
          {field("joiningDate", "Joining Date", "date")}
          {field("status", "Status", "text", ["active", "inactive", "suspended"])}
          {field("address", "Address")}
          {multiSelect("subjects", "Subjects", allSubjects)}
          {multiSelect("assignedClasses", "Assigned Classes", classes)}
          {multiSelect("assignedSections", "Assigned Sections", sections)}
        </div>
        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
            {teacher ? "Save Changes" : "Add Teacher"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeacherDetail({ teacher, onClose, onEdit }: { teacher: AdminTeacher; onClose: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<DetailTab>("profile");
  const tabs: { key: DetailTab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "classes", label: "Classes" },
    { key: "attendance", label: "Attendance" },
    { key: "activity", label: "Activity" },
    { key: "account", label: "Account" },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <InitialsAvatar name={teacher.fullName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{teacher.fullName}</div>
            <div className="text-[10px] text-[#78788c]">{teacher.employeeId} · {teacher.department}</div>
            <div className="mt-1"><StatusBadge status={teacher.status} /></div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1 px-4 py-2 border-b border-white/7 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("text-[10px] font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all",
                tab === t.key ? "bg-[#6366f1]/20 text-[#6366f1]" : "text-[#78788c] hover:text-white")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === "profile" && (
            <>
              {[
                { label: "Email", value: teacher.email },
                { label: "Phone", value: teacher.phone },
                { label: "Gender", value: teacher.gender },
                { label: "Date of Birth", value: teacher.dob },
                { label: "Qualification", value: teacher.qualification },
                { label: "Address", value: teacher.address },
                { label: "Joining Date", value: teacher.joiningDate },
              ].map((row) => (
                <div key={row.label} className="flex flex-col gap-1 p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] text-[#46465a] uppercase tracking-wider">{row.label}</div>
                  <div className="text-xs text-white">{row.value}</div>
                </div>
              ))}
            </>
          )}
          {tab === "classes" && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-white/3">
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-2">Subjects</div>
                <div className="flex flex-wrap gap-1.5">
                  {teacher.subjects.map((s) => <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-[#6366f1]/15 text-[#a5b4fc]">{s}</span>)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/3">
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-2">Classes</div>
                <div className="flex gap-2">
                  {teacher.assignedClasses.map((c) => <span key={c} className="text-xs font-bold text-white bg-white/5 px-2 py-0.5 rounded">{c}</span>)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/3">
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-2">Sections</div>
                <div className="flex gap-2">
                  {teacher.assignedSections.map((s) => <span key={s} className="text-xs font-bold text-white bg-white/5 px-2 py-0.5 rounded">{s}</span>)}
                </div>
              </div>
            </div>
          )}
          {tab === "attendance" && (
            <div className="p-4 rounded-2xl bg-[#4b9fd4]/10 border border-[#4b9fd4]/20 text-center">
              <div className="text-4xl font-black text-[#4b9fd4]">{teacher.attendance}%</div>
              <div className="text-xs text-[#78788c] mt-1">Overall Attendance</div>
            </div>
          )}
          {tab === "activity" && (
            <div className="text-xs text-[#78788c] text-center pt-8">Last active: {teacher.lastActive}</div>
          )}
          {tab === "account" && <AccountLinkingPanel entityName={teacher.fullName} entityType="teacher" status={teacher.status} />}
        </div>
        <div className="p-4 border-t border-white/7">
          <button onClick={onEdit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
            Edit Teacher
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeacherManagement() {
  const [teachers, setTeachers] = useState<AdminTeacher[]>(initial);
  const { toast, closeToast, softDelete } = useUndoDelete<AdminTeacher>(setTeachers);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortField, setSortField] = useState<SortField>("fullName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminTeacher | null>(null);
  const [editTeacher, setEditTeacher] = useState<AdminTeacher | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | "bulk" | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    let list = teachers;
    if (search) list = list.filter((t) => t.fullName.toLowerCase().includes(search.toLowerCase()) || t.employeeId.includes(search));
    if (filterDept !== "all") list = list.filter((t) => t.department === filterDept);
    if (filterStatus !== "all") list = list.filter((t) => t.status === filterStatus);
    return [...list].sort((a, b) => {
      const va = a[sortField] ?? "";
      const vb = b[sortField] ?? "";
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [teachers, search, filterDept, filterStatus, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const allSelected = paged.length > 0 && paged.every((t) => selected.has(t.id));

  function toggleAll() {
    const ids = paged.map((t) => t.id);
    if (allSelected) setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
    else setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
  }

  function handleSave(t: AdminTeacher) {
    setTeachers((prev) => {
      const idx = prev.findIndex((x) => x.id === t.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = t; return next; }
      return [t, ...prev];
    });
    setEditTeacher(null);
    setStatusToast(editTeacher === "new" ? "Teacher added" : "Teacher updated");
    setTimeout(() => setStatusToast(null), 3000);
  }

  function handleDelete(id: string) {
    const item = teachers.find((x) => x.id === id);
    if (!item) return;
    setDetail(null);
    softDelete([item], `${item.fullName} deleted`);
  }

  function handleBulkDelete() {
    const toRemove = teachers.filter((t) => selected.has(t.id));
    setSelected(new Set());
    softDelete(toRemove, `${toRemove.length} teachers deleted`);
  }

  function handleBulkStatus(status: TeacherStatus) {
    setTeachers((prev) => prev.map((t) => selected.has(t.id) ? { ...t, status } : t));
    setSelected(new Set());
    setStatusToast(`${selected.size} teachers ${status}`);
    setTimeout(() => setStatusToast(null), 3000);
  }

  const SortIcon = ({ field }: { field: SortField }) => (
    sortField === field
      ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
      : <ArrowUpDown className="w-3 h-3 opacity-30" />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#46465a]" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search teachers..."
            className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#6366f1]/50" />
        </div>
        <select value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setPage(1); }}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#6366f1]/50">
          <option value="all">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#6366f1]/50">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>
        <button onClick={() => setEditTeacher("new")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#6366f1] hover:bg-[#5254cc] transition-all">
          <Plus className="w-3.5 h-3.5" /> Add Teacher
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20">
          <Users className="w-4 h-4 text-[#6366f1]" />
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

      <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/7">
              <th className="px-4 py-3 text-left w-10">
                <button onClick={toggleAll} className="text-[#78788c] hover:text-white">
                  {allSelected ? <CheckSquare className="w-4 h-4 text-[#6366f1]" /> : <Square className="w-4 h-4" />}
                </button>
              </th>
              {([
                { key: "fullName", label: "Teacher" },
                { key: "department", label: "Department" },
                { key: "status", label: "Status" },
                { key: "attendance", label: "Attendance" },
              ] as { key: SortField; label: string }[]).map((col) => (
                <th key={col.key} className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort(col.key)} className="flex items-center gap-1.5 text-[10px] font-bold text-[#78788c] uppercase tracking-wider hover:text-white transition-colors">
                    {col.label} <SortIcon field={col.key} />
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Subjects</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paged.map((t) => (
              <tr key={t.id} className="hover:bg-white/2 transition-colors group">
                <td className="px-4 py-3">
                  <button onClick={() => setSelected((prev) => { const next = new Set(prev); next.has(t.id) ? next.delete(t.id) : next.add(t.id); return next; })} className="text-[#78788c] hover:text-white">
                    {selected.has(t.id) ? <CheckSquare className="w-4 h-4 text-[#6366f1]" /> : <Square className="w-4 h-4" />}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <InitialsAvatar name={t.fullName} size="sm" />
                    <div>
                      <div className="text-sm font-semibold text-white">{t.fullName}</div>
                      <div className="text-[10px] text-[#78788c]">{t.employeeId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[#78788c]">{t.department}</td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-[#4b9fd4]" style={{ width: `${t.attendance}%` }} />
                    </div>
                    <span className="text-xs font-bold text-white tabular-nums">{t.attendance}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {t.subjects.slice(0, 2).map((s) => (
                      <span key={s} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#8f7dd6]/15 text-[#8f7dd6]">{s}</span>
                    ))}
                    {t.subjects.length > 2 && <span className="text-[9px] text-[#46465a]">+{t.subjects.length - 2}</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setDetail(t)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditTeacher(t)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(t.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
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
            <Users className="w-8 h-8 text-[#46465a]" />
            <div className="text-sm text-[#78788c]">No teachers found</div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/7">
          <div className="text-xs text-[#78788c]">{filtered.length} teachers total</div>
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

      {editTeacher !== null && (
        <TeacherForm teacher={editTeacher === "new" ? undefined : editTeacher} onSave={handleSave} onClose={() => setEditTeacher(null)} />
      )}
      {detail && (
        <TeacherDetail teacher={detail} onClose={() => setDetail(null)} onEdit={() => { setEditTeacher(detail); setDetail(null); }} />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title={confirmDelete === "bulk" ? `Are you sure you want to delete ${selected.size} teachers?` : "Are you sure you want to delete this teacher?"}
        description="You will have 5 seconds to undo after deletion."
        confirmLabel="Delete" danger
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
