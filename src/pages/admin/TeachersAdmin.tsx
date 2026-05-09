import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChevronRight, Pencil, Link2, ShieldCheck, UserX, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

const EMPTY = {
  full_name: "", subject: "", mobile: "", email: "",
  is_class_teacher: false, class_teacher_of: "", salary: "",
  teaching_class_ids: [] as string[],
};

export default function TeachersAdmin() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data } = await supabase.from("teachers").select("*, class_teacher:classes!class_teacher_of(name,section)").order("created_at", { ascending: false });
    setRows(data ?? []);
    const { data: c } = await supabase.from("classes").select("*").order("name");
    setClasses(c ?? []);
  };
  useEffect(() => { load(); }, []);

  const persistAssignments = async (teacherId: string, classIds: string[], subject: string) => {
    await supabase.from("teacher_classes").delete().eq("teacher_id", teacherId);
    if (classIds.length) {
      await supabase.from("teacher_classes").insert(classIds.map(cid => ({ teacher_id: teacherId, class_id: cid, subject: subject || null })));
    }
  };

  const add = async () => {
    if (!form.full_name) return toast.error("Name required");
    const { teaching_class_ids, ...rest } = form;
    const payload = {
      ...rest,
      class_teacher_of: form.is_class_teacher && form.class_teacher_of ? form.class_teacher_of : null,
      salary: form.salary ? Number(form.salary) : null,
    };
    const { data: t, error } = await supabase.from("teachers").insert(payload).select().single();
    if (error) return toast.error(error.message);
    await persistAssignments(t.id, teaching_class_ids, form.subject);
    toast.success("Teacher added");
    setAddOpen(false); setForm({ ...EMPTY }); load();
  };

  const openEdit = async (r: any) => {
    setEditTarget(r);
    const { data: tc } = await supabase.from("teacher_classes").select("class_id").eq("teacher_id", r.id);
    setForm({
      full_name: r.full_name ?? "", subject: r.subject ?? "",
      mobile: r.mobile ?? "", email: r.email ?? "",
      is_class_teacher: !!r.class_teacher_of,
      class_teacher_of: r.class_teacher_of ?? "",
      salary: r.salary ? String(r.salary) : "",
      teaching_class_ids: (tc ?? []).map(x => x.class_id),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!form.full_name) return toast.error("Name required");
    const { teaching_class_ids, ...rest } = form;
    const payload = {
      ...rest,
      class_teacher_of: form.is_class_teacher && form.class_teacher_of ? form.class_teacher_of : null,
      salary: form.salary ? Number(form.salary) : null,
    };
    const { error } = await supabase.from("teachers").update(payload).eq("id", editTarget.id);
    if (error) return toast.error(error.message);
    await persistAssignments(editTarget.id, teaching_class_ids, form.subject);
    toast.success("Teacher updated");
    setEditOpen(false); setEditTarget(null); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this teacher? This cannot be undone.")) return;
    const { error } = await supabase.from("teachers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Teacher deleted"); load();
  };

  const filtered = rows.filter(r =>
    !search ||
    r.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.subject?.toLowerCase().includes(search.toLowerCase())
  );

  const Fields = ({ f, set }: { f: any; set: (v: any) => void }) => (
    <div className="space-y-3">
      <div><Label>Full Name *</Label><Input value={f.full_name} onChange={e => set({ ...f, full_name: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Subject</Label><Input value={f.subject} onChange={e => set({ ...f, subject: e.target.value })} /></div>
        <div><Label>Mobile</Label><Input value={f.mobile} onChange={e => set({ ...f, mobile: e.target.value })} /></div>
      </div>
      <div><Label>Email</Label><Input value={f.email} onChange={e => set({ ...f, email: e.target.value })} /></div>
      <div><Label>Salary (admin only)</Label><Input type="number" value={f.salary} onChange={e => set({ ...f, salary: e.target.value })} /></div>
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
        <Label>Is Class Teacher?</Label>
        <Switch checked={f.is_class_teacher} onCheckedChange={v => set({ ...f, is_class_teacher: v })} />
      </div>
      {f.is_class_teacher && (
        <div><Label>Class Teacher of</Label>
          <Select value={f.class_teacher_of} onValueChange={v => set({ ...f, class_teacher_of: v })}>
            <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
            <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      <div>
        <Label>Teaches classes (subject)</Label>
        <div className="grid grid-cols-3 gap-1.5 mt-2 max-h-32 overflow-y-auto">
          {classes.map(c => (
            <button key={c.id} type="button" onClick={() => set({
              ...f,
              teaching_class_ids: f.teaching_class_ids.includes(c.id)
                ? f.teaching_class_ids.filter((x: string) => x !== c.id)
                : [...f.teaching_class_ids, c.id],
            })}
              className={`text-xs px-2 py-1.5 rounded border ${f.teaching_class_ids.includes(c.id) ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
              {c.name}-{c.section}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="Teachers" subtitle={`${rows.length} on staff`}
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add Teacher</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Teacher</DialogTitle></DialogHeader>
              <Fields f={form} set={setForm} />
              <Button className="w-full bg-gradient-primary text-primary-foreground mt-2" onClick={add}>Create Teacher</Button>
            </DialogContent>
          </Dialog>
        } />

      <div className="mb-4">
        <Input placeholder="Search by name or subject…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="space-y-2">
        {filtered.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between shadow-card">
            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => nav(`/admin/teachers/${r.id}`)}>
              <div className="font-semibold truncate">{r.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {r.subject || "—"} · {r.mobile || "no mobile"}
                {r.class_teacher && <> · Class teacher of {r.class_teacher.name}-{r.class_teacher.section}</>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openEdit(r); }}><Pencil className="w-4 h-4 text-primary" /></Button>
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); del(r.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              <ChevronRight className="w-4 h-4 text-muted-foreground cursor-pointer" onClick={() => nav(`/admin/teachers/${r.id}`)} />
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground text-center py-8">No teachers found.</p>}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Teacher</DialogTitle></DialogHeader>
          <Fields f={form} set={setForm} />
          <Button className="w-full bg-gradient-primary text-primary-foreground mt-2" onClick={saveEdit}>Save Changes</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
