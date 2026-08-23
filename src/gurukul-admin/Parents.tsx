import { useEffect, useMemo, useState } from "react";
import {
  Search, Plus, ChevronLeft, ChevronRight, Trash2, Edit2, Eye, X,
  Users, Mail, Phone, GraduationCap, Loader2, Link2,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizePhone } from "@/lib/phone";
import { toErrorMessage } from "@/lib/presentation";

type LinkedStudent = {
  id: string;
  fullName: string;
  classLabel: string;
};

type LiveParent = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  createdAt: string;
  linkedStudents: LinkedStudent[];
};

type StudentOption = { id: string; fullName: string; classLabel: string };

const PER_PAGE = 8;

function ParentForm({
  parent,
  students,
  onSaved,
  onClose,
}: {
  parent?: LiveParent;
  students: StudentOption[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const { ctx } = useAcademicContext();
  const [fullName, setFullName] = useState(parent?.fullName ?? "");
  const [email, setEmail] = useState(parent?.email ?? "");
  const [phone, setPhone] = useState(parent?.phone ?? "");
  const [linkedIds, setLinkedIds] = useState<Set<string>>(
    () => new Set(parent?.linkedStudents.map((s) => s.id) ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggleStudent(id: string) {
    setLinkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!ctx?.schoolId) return;
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = "Required";
    if (email.trim() && !email.includes("@")) errs.email = "Invalid email";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const normalizedPhone = phone.trim() ? (normalizePhone(phone) ?? phone.trim()) : null;
      let parentId = parent?.id;
      if (parentId) {
        const { error } = await supabase
          .from("parents")
          .update({
            full_name: fullName.trim(),
            email: email.trim() || null,
            phone: normalizedPhone,
          })
          .eq("id", parentId)
          .eq("school_id", ctx.schoolId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("parents")
          .insert({
            full_name: fullName.trim(),
            email: email.trim() || null,
            phone: normalizedPhone,
            school_id: ctx.schoolId,
          })
          .select("id")
          .single();
        if (error) throw error;
        parentId = data.id;
      }

      const { error: unlinkErr } = await supabase.from("parent_students").delete().eq("parent_id", parentId);
      if (unlinkErr) throw unlinkErr;
      const links = [...linkedIds].map((studentId) => ({
        parent_id: parentId!,
        student_id: studentId,
        school_id: ctx.schoolId,
      }));
      if (links.length) {
        const { error: linkErr } = await supabase.from("parent_students").insert(links);
        if (linkErr) {
          throw new Error(
            `Parent details saved, but re-linking students failed (${linkErr.message}). This parent currently has 0 linked students â€” please re-link them.`,
          );
        }
      }

      toast.success(parent ? "Parent updated" : "Parent added");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(toErrorMessage(e, "Failed to save parent"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-elevated">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-bold text-foreground">{parent ? "Edit Parent" : "Add Parent"}</div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <div className="col-span-2 flex flex-col gap-1">
            <label htmlFor="parent-full-name" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Full Name</label>
            <input
              id="parent-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={cn(
                "bg-muted border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#3b5bdb]/50",
                errors.fullName ? "border-[#cc5069]/50" : "border-border",
              )}
            />
            {errors.fullName && <span className="text-[9px] text-[#cc5069]">{errors.fullName}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="parent-email" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</label>
            <input
              id="parent-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                "bg-muted border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#3b5bdb]/50",
                errors.email ? "border-[#cc5069]/50" : "border-border",
              )}
            />
            {errors.email && <span className="text-[9px] text-[#cc5069]">{errors.email}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="parent-phone" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Phone</label>
            <input
              id="parent-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#3b5bdb]/50"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Linked students ({linkedIds.size})
            </label>
            {students.length === 0 ? (
              <div className="text-xs text-muted-foreground">No students in this school yet.</div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl border border-border/70 p-2">
                {students.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleStudent(s.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-all",
                      linkedIds.has(s.id)
                        ? "bg-[#3b5bdb]/20 text-[#a5b4fc]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="font-semibold truncate">{s.fullName}</span>
                    <span className="text-[9px] opacity-70 shrink-0 ml-2">{s.classLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all disabled:opacity-50"
          >
            {saving ? "Savingâ€¦" : parent ? "Save Changes" : "Add Parent"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ParentDetail({
  parent,
  onClose,
  onEdit,
}: {
  parent: LiveParent;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-80 sm:w-96 bg-card border-l border-border flex flex-col h-full overflow-hidden">
        <div className="p-5 border-b border-border/70 flex items-start gap-3">
          <InitialsAvatar name={parent.fullName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground">{parent.fullName}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {parent.userId ? "Portal linked" : "No login linked"}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {[
            { label: "Email", value: parent.email || "â€”", icon: <Mail className="w-3.5 h-3.5" /> },
            { label: "Phone", value: parent.phone || "â€”", icon: <Phone className="w-3.5 h-3.5" /> },
            {
              label: "Joined",
              value: parent.createdAt
                ? new Date(parent.createdAt).toLocaleDateString("en-IN")
                : "â€”",
              icon: <Users className="w-3.5 h-3.5" />,
            },
          ].map((row) => (
            <div key={row.label} className="flex flex-col gap-1 p-3 rounded-xl bg-muted">
              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground uppercase tracking-wider">
                {row.icon} {row.label}
              </div>
              <div className="text-xs text-foreground">{row.value}</div>
            </div>
          ))}
          <div className="p-3 rounded-xl bg-muted">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <GraduationCap className="w-3 h-3" /> Linked Students
            </div>
            {parent.linkedStudents.length === 0 ? (
              <div className="text-xs text-muted-foreground">No linked students</div>
            ) : (
              parent.linkedStudents.map((s) => (
                <div key={s.id} className="flex items-center gap-2 mt-1.5">
                  <InitialsAvatar name={s.fullName} size="sm" />
                  <div>
                    <div className="text-xs font-semibold text-foreground">{s.fullName}</div>
                    <div className="text-[9px] text-muted-foreground">{s.classLabel}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-3 rounded-xl bg-muted text-[10px] text-muted-foreground leading-relaxed">
            Login linking uses the parents.user_id column. Auth invitation / password-reset admin APIs are not wired on this panel â€” no fake success actions.
          </div>
        </div>
        <div className="p-4 border-t border-border/70">
          <button
            type="button"
            onClick={onEdit}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all"
          >
            Edit Parent
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin Parents â€” live `parents` + `parent_students` for this school.
 * No local-only CRUD / fake directories.
 */
export default function ParentManagement() {
  const { ctx, ready } = useAcademicContext();
  const [parents, setParents] = useState<LiveParent[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<LiveParent | null>(null);
  const [editParent, setEditParent] = useState<LiveParent | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    if (!ready || !ctx?.schoolId) return;
    setLoading(true);
    setError(null);
    try {
      const [parentsRes, linksRes, studentsRes] = await Promise.all([
        supabase
          .from("parents")
          .select("id, full_name, email, phone, user_id, created_at")
          .eq("school_id", ctx.schoolId)
          .order("created_at", { ascending: false }),
        supabase
          .from("parent_students")
          .select("parent_id, student_id")
          .eq("school_id", ctx.schoolId),
        supabase
          .from("students")
          .select("id, full_name, classes(name, section, kind, display_name)")
          .eq("school_id", ctx.schoolId)
          .order("full_name"),
      ]);
      if (parentsRes.error) throw parentsRes.error;
      if (linksRes.error) throw linksRes.error;
      if (studentsRes.error) throw studentsRes.error;

      const studentOpts: StudentOption[] = ((studentsRes.data ?? []) as {
        id: string;
        full_name: string;
        classes: {
          name: string;
          section: string;
          kind: string | null;
          display_name: string | null;
        } | null;
      }[]).map((s) => ({
        id: s.id,
        fullName: s.full_name,
        classLabel: s.classes
          ? s.classes.kind === "batch" && s.classes.display_name
            ? s.classes.display_name
            : `${s.classes.name}-${s.classes.section}`
          : "Unassigned",
      }));
      const studentMap = new Map(studentOpts.map((s) => [s.id, s]));

      const linksByParent = new Map<string, LinkedStudent[]>();
      for (const link of (linksRes.data ?? []) as { parent_id: string; student_id: string }[]) {
        const st = studentMap.get(link.student_id);
        if (!st) continue;
        const list = linksByParent.get(link.parent_id) ?? [];
        list.push({ id: st.id, fullName: st.fullName, classLabel: st.classLabel });
        linksByParent.set(link.parent_id, list);
      }

      setStudents(studentOpts);
      setParents(
        ((parentsRes.data ?? []) as {
          id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          user_id: string | null;
          created_at: string;
        }[]).map((p) => ({
          id: p.id,
          fullName: p.full_name,
          email: p.email,
          phone: p.phone,
          userId: p.user_id,
          createdAt: p.created_at,
          linkedStudents: linksByParent.get(p.id) ?? [],
        })),
      );
    } catch (e) {
      setParents([]);
      setError(toErrorMessage(e, "Failed to load parents"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx?.schoolId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parents;
    return parents.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").includes(q),
    );
  }, [parents, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  async function handleDelete(id: string) {
    if (!ctx?.schoolId) return;
    setDeleting(true);
    try {
      const { error: unlinkErr } = await supabase.from("parent_students").delete().eq("parent_id", id);
      if (unlinkErr) throw unlinkErr;
      const { error: delErr } = await supabase
        .from("parents")
        .delete()
        .eq("id", id)
        .eq("school_id", ctx.schoolId);
      if (delErr) {
        throw new Error(
          `Removed this parent's student links, but deleting the parent record failed (${delErr.message}). Retry the delete.`,
        );
      }
      toast.success("Parent deleted");
      setDetail(null);
      setConfirmDelete(null);
      const newTotalPages = Math.max(1, Math.ceil((filtered.length - 1) / PER_PAGE));
      setPage((p) => Math.min(p, newTotalPages));
      await load();
    } catch (e) {
      toast.error(toErrorMessage(e, "Delete failed"));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading parentsâ€¦
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-[#cc5069] py-16 text-center">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search parentsâ€¦"
            className="w-full bg-surface border border-border/70 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#3b5bdb]/50"
          />
        </div>
        <button
          type="button"
          onClick={() => setEditParent("new")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-foreground bg-[#3b5bdb] hover:bg-[#2f4fc4] transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Add Parent
        </button>
      </div>

      <div className="bg-surface border border-border/70 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/70">
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Parent
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Contact
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Login
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Linked Students
              </th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paged.map((p) => (
              <tr key={p.id} className="hover:bg-muted transition-colors group">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <InitialsAvatar name={p.fullName} size="sm" />
                    <div className="text-sm font-semibold text-foreground">{p.fullName}</div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-xs text-muted-foreground">{p.email || "â€”"}</div>
                  <div className="text-[10px] text-muted-foreground">{p.phone || "â€”"}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full",
                      p.userId
                        ? "bg-[#4aa87a]/15 text-[#4aa87a]"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Link2 className="w-2.5 h-2.5" />
                    {p.userId ? "Linked" : "No login"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {p.linkedStudents.length === 0 ? (
                      <span className="text-[10px] text-muted-foreground">None</span>
                    ) : (
                      p.linkedStudents.map((s) => (
                        <span
                          key={s.id}
                          className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3b5bdb]/15 text-[#a5b4fc]"
                        >
                          {s.fullName.split(" ")[0]}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => setDetail(p)}
                      className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditParent(p)}
                      className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(p.id)}
                      className="w-7 h-7 rounded-lg bg-muted hover:bg-[#cc5069]/20 flex items-center justify-center text-muted-foreground hover:text-[#cc5069] transition-all"
                    >
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
            <Users className="w-8 h-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">No parents found</div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/70">
          <div className="text-xs text-muted-foreground">{filtered.length} parents total</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground disabled:opacity-30 transition-all"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {editParent !== null && (
        <ParentForm
          parent={editParent === "new" ? undefined : editParent}
          students={students}
          onSaved={() => void load()}
          onClose={() => setEditParent(null)}
        />
      )}
      {detail && (
        <ParentDetail
          parent={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditParent(detail);
            setDetail(null);
          }}
        />
      )}
      {confirmDelete && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDelete(null)} />
          <div className="relative z-10 bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="text-sm font-bold text-foreground">Delete this parent?</div>
            <div className="text-xs text-muted-foreground">
              Removes the parent row and student links. This cannot be undone from the UI.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete(confirmDelete)}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-foreground bg-[#cc5069] disabled:opacity-50"
              >
                {deleting ? "Deletingâ€¦" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
