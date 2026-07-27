import { useState, useMemo } from "react";
import {
  Search, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Trash2, Edit2, Eye, UserX, UserCheck, X, Users, ArrowUpDown,
  CheckSquare, Square, Mail, Phone, MapPin, Calendar, GraduationCap,
} from "lucide-react";
import { cn, InitialsAvatar, StatusBadge, ConfirmModal, UndoToast, useUndoDelete } from "./shared";
import { AccountLinkingPanel } from "./AccountLinking";
import { adminParents as initial, adminStudents, type AdminParent, type ParentStatus } from "./data";

type SortField = "fullName" | "occupation" | "status";
type SortDir = "asc" | "desc";
type DetailTab = "profile" | "activity" | "account";

const PER_PAGE = 8;

function ParentForm({ parent, onSave, onClose }: { parent?: AdminParent; onSave: (p: AdminParent) => void; onClose: () => void }) {
  const blank: AdminParent = {
    id: `p${Date.now()}`, fullName: "", fatherName: "", motherName: "",
    relationship: "Father", email: "", phone: "", occupation: "", address: "",
    linkedStudentIds: [], status: "active", lastLogin: "Never", joinedDate: new Date().toISOString().slice(0, 10),
  };
  const [form, setForm] = useState<AdminParent>(parent ?? blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim()) errs.fullName = "Required";
    if (!form.email.includes("@")) errs.email = "Invalid email";
    if (!form.phone.trim()) errs.phone = "Required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function field(key: keyof AdminParent, label: string, type = "text", opts?: string[]) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
        {opts ? (
          <select value={form[key] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/50">
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type} value={form[key] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={cn("bg-white/5 border rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50",
              errors[key] ? "border-[#cc5069]/50" : "border-white/10")} />
        )}
        {errors[key] && <span className="text-[9px] text-[#cc5069]">{errors[key]}</span>}
      </div>
    );
  }

  function handleSave() {
    if (!validate()) return;
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#0d0d0f] border-b border-white/7 px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-bold text-white">{parent ? "Edit Parent" : "Add Parent"}</div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          {field("fullName", "Full Name")}
          {field("relationship", "Relationship", "text", ["Father", "Mother", "Guardian"])}
          {field("email", "Email", "email")}
          {field("phone", "Phone")}
          {field("occupation", "Occupation")}
          {field("fatherName", "Father Name")}
          {field("motherName", "Mother Name")}
          {field("status", "Status", "text", ["active", "inactive", "suspended"])}
          <div className="col-span-2">{field("address", "Address")}</div>
        </div>
        <div className="sticky bottom-0 bg-[#0d0d0f] border-t border-white/7 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            {parent ? "Save Changes" : "Add Parent"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ParentDetail({ parent, onClose, onEdit }: { parent: AdminParent; onClose: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<DetailTab>("profile");
  const linkedStudents = adminStudents.filter((s) => parent.linkedStudentIds.includes(s.id));

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "activity", label: "Activity" },
    { key: "account", label: "Account" },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-[#0a0a0c] border-l border-white/7 flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-start gap-3">
          <InitialsAvatar name={parent.fullName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{parent.fullName}</div>
            <div className="text-[10px] text-[#78788c]">{parent.relationship} · {parent.occupation}</div>
            <div className="mt-1"><StatusBadge status={parent.status} /></div>
          </div>
          <button onClick={onClose} className="text-[#78788c] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1 px-4 py-2 border-b border-white/7">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("text-[10px] font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all",
                tab === t.key ? "bg-[#3b5bdb]/20 text-[#3b5bdb]" : "text-[#78788c] hover:text-white")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === "profile" && (
            <>
              {[
                { label: "Email", value: parent.email },
                { label: "Phone", value: parent.phone },
                { label: "Occupation", value: parent.occupation },
                { label: "Address", value: parent.address },
                { label: "Joined", value: parent.joinedDate },
              ].map((row) => (
                <div key={row.label} className="flex flex-col gap-1 p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] text-[#46465a] uppercase tracking-wider">{row.label}</div>
                  <div className="text-xs text-white">{row.value}</div>
                </div>
              ))}
              {linkedStudents.length > 0 && (
                <div className="p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-2">Linked Students</div>
                  {linkedStudents.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 mt-1.5">
                      <InitialsAvatar name={s.fullName} size="sm" />
                      <div>
                        <div className="text-xs font-semibold text-white">{s.fullName}</div>
                        <div className="text-[9px] text-[#78788c]">{s.className} {s.section}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "activity" && (
            <div className="text-xs text-[#78788c] text-center pt-8">Last login: {parent.lastLogin}</div>
          )}
          {tab === "account" && <AccountLinkingPanel entityName={parent.fullName} entityType="parent" status={parent.status} />}
        </div>
        <div className="p-4 border-t border-white/7">
          <button onClick={onEdit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
            Edit Parent
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ParentManagement() {
  const [parents, setParents] = useState<AdminParent[]>(initial);
  const { toast, closeToast, softDelete } = useUndoDelete<AdminParent>(setParents);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortField, setSortField] = useState<SortField>("fullName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminParent | null>(null);
  const [editParent, setEditParent] = useState<AdminParent | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | "bulk" | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    let list = parents;
    if (search) list = list.filter((p) => p.fullName.toLowerCase().includes(search.toLowerCase()) || p.email.includes(search));
    if (filterStatus !== "all") list = list.filter((p) => p.status === filterStatus);
    return [...list].sort((a, b) => {
      const va = a[sortField] ?? "";
      const vb = b[sortField] ?? "";
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [parents, search, filterStatus, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const allSelected = paged.length > 0 && paged.every((p) => selected.has(p.id));

  function toggleAll() {
    const ids = paged.map((p) => p.id);
    if (allSelected) setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
    else setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
  }

  function handleSave(p: AdminParent) {
    setParents((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = p; return next; }
      return [p, ...prev];
    });
    setEditParent(null);
    setStatusToast(editParent === "new" ? "Parent added" : "Parent updated");
    setTimeout(() => setStatusToast(null), 3000);
  }

  function handleDelete(id: string) {
    const item = parents.find((x) => x.id === id);
    if (!item) return;
    setDetail(null);
    softDelete([item], `${item.fullName} deleted`);
  }

  function handleBulkDelete() {
    const toRemove = parents.filter((p) => selected.has(p.id));
    setSelected(new Set());
    softDelete(toRemove, `${toRemove.length} parents deleted`);
  }

  function handleBulkStatus(status: ParentStatus) {
    setParents((prev) => prev.map((p) => selected.has(p.id) ? { ...p, status } : p));
    setSelected(new Set());
    setStatusToast(`${selected.size} parents ${status}`);
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
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search parents..."
            className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#46465a] focus:outline-none focus:border-[#3b5bdb]/50" />
        </div>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="bg-[#131316] border border-white/7 rounded-xl px-3 py-2.5 text-sm text-[#78788c] focus:outline-none focus:border-[#3b5bdb]/50">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>
        <button onClick={() => setEditParent("new")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all">
          <Plus className="w-3.5 h-3.5" /> Add Parent
        </button>
      </div>

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
                { key: "fullName", label: "Parent" },
                { key: "occupation", label: "Occupation" },
                { key: "status", label: "Status" },
              ] as { key: SortField; label: string }[]).map((col) => (
                <th key={col.key} className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort(col.key)} className="flex items-center gap-1.5 text-[10px] font-bold text-[#78788c] uppercase tracking-wider hover:text-white transition-colors">
                    {col.label} <SortIcon field={col.key} />
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Linked Students</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Last Login</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paged.map((p) => {
              const linked = adminStudents.filter((s) => p.linkedStudentIds.includes(s.id));
              return (
                <tr key={p.id} className="hover:bg-white/2 transition-colors group">
                  <td className="px-4 py-3">
                    <button onClick={() => setSelected((prev) => { const next = new Set(prev); next.has(p.id) ? next.delete(p.id) : next.add(p.id); return next; })} className="text-[#78788c] hover:text-white">
                      {selected.has(p.id) ? <CheckSquare className="w-4 h-4 text-[#3b5bdb]" /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <InitialsAvatar name={p.fullName} size="sm" />
                      <div>
                        <div className="text-sm font-semibold text-white">{p.fullName}</div>
                        <div className="text-[10px] text-[#78788c]">{p.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#78788c]">{p.occupation}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {linked.map((s) => (
                        <span key={s.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3b5bdb]/15 text-[#a5b4fc]">{s.fullName.split(" ")[0]}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#78788c]">{p.lastLogin}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setDetail(p)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditParent(p)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setConfirmDelete(p.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#cc5069]/20 flex items-center justify-center text-[#78788c] hover:text-[#cc5069] transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {paged.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16">
            <Users className="w-8 h-8 text-[#46465a]" />
            <div className="text-sm text-[#78788c]">No parents found</div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/7">
          <div className="text-xs text-[#78788c]">{filtered.length} parents total</div>
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

      {editParent !== null && (
        <ParentForm parent={editParent === "new" ? undefined : editParent} onSave={handleSave} onClose={() => setEditParent(null)} />
      )}
      {detail && (
        <ParentDetail parent={detail} onClose={() => setDetail(null)} onEdit={() => { setEditParent(detail); setDetail(null); }} />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title={confirmDelete === "bulk" ? `Are you sure you want to delete ${selected.size} parents?` : "Are you sure you want to delete this parent?"}
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
