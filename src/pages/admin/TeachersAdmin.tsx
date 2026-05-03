import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

export default function TeachersAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    full_name: "", subject: "", mobile: "", email: "",
    is_class_teacher: false, class_teacher_of: "", salary: "",
    teaching_class_ids: [] as string[],
  });

  const load = async () => {
    const { data } = await supabase.from("teachers").select("*, class_teacher:classes!class_teacher_of(name,section)").order("created_at", { ascending: false });
    setRows(data ?? []);
    const { data: c } = await supabase.from("classes").select("*").order("name");
    setClasses(c ?? []);
  };
  useEffect(() => { load(); }, []);

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
    if (teaching_class_ids.length) {
      await supabase.from("teacher_classes").insert(teaching_class_ids.map((cid: string) => ({ teacher_id: t.id, class_id: cid, subject: form.subject || null })));
    }
    toast.success("Teacher added"); setOpen(false); load();
    setForm({ full_name: "", subject: "", mobile: "", email: "", is_class_teacher: false, class_teacher_of: "", salary: "", teaching_class_ids: [] });
  };

  const del = async (id: string) => {
    if (!confirm("Delete teacher?")) return;
    await supabase.from("teachers").delete().eq("id", id);
    load();
  };

  const toggleClass = (id: string) => {
    setForm((f: any) => ({
      ...f,
      teaching_class_ids: f.teaching_class_ids.includes(id)
        ? f.teaching_class_ids.filter((x: string) => x !== id)
        : [...f.teaching_class_ids, id],
    }));
  };

  return (
    <>
      <PageHeader title="Teachers" subtitle={`${rows.length} on staff`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New teacher</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Full Name *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
                  <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} /></div>
                </div>
                <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Salary (admin only)</Label><Input type="number" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} /></div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <Label>Is Class Teacher?</Label>
                  <Switch checked={form.is_class_teacher} onCheckedChange={v => setForm({ ...form, is_class_teacher: v })} />
                </div>
                {form.is_class_teacher && (
                  <div><Label>Class Teacher of</Label>
                    <Select value={form.class_teacher_of} onValueChange={v => setForm({ ...form, class_teacher_of: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
                      <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label>Teaches classes (subject)</Label>
                  <div className="grid grid-cols-3 gap-1.5 mt-2 max-h-32 overflow-y-auto">
                    {classes.map(c => (
                      <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                        className={`text-xs px-2 py-1.5 rounded border ${form.teaching_class_ids.includes(c.id) ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                        {c.name}-{c.section}
                      </button>
                    ))}
                  </div>
                </div>
                <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={add}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        } />

      <div className="space-y-2">
        {rows.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between shadow-card">
            <div>
              <div className="font-semibold">{r.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {r.subject || "—"} · {r.mobile || "no mobile"}
                {r.class_teacher && <> · Class teacher of {r.class_teacher.name}-{r.class_teacher.section}</>}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No teachers yet.</p>}
      </div>
    </>
  );
}
