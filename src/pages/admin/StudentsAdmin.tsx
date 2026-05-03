import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

export default function StudentsAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    full_name: "", admission_number: "", roll_number: "", class_id: "",
    parent_name: "", parent_mobile: "", address: "", date_of_birth: "",
  });

  const load = async () => {
    const { data } = await supabase.from("students").select("*, classes(name,section)").order("created_at", { ascending: false });
    setRows(data ?? []);
    const { data: c } = await supabase.from("classes").select("*").order("name");
    setClasses(c ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.full_name || !form.admission_number) return toast.error("Name and admission number required");
    const payload = { ...form, class_id: form.class_id || null, date_of_birth: form.date_of_birth || null };
    const { error } = await supabase.from("students").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Student added"); setOpen(false); load();
    setForm({ full_name: "", admission_number: "", roll_number: "", class_id: "", parent_name: "", parent_mobile: "", address: "", date_of_birth: "" });
  };

  const del = async (id: string) => {
    if (!confirm("Delete student?")) return;
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <>
      <PageHeader title="Students" subtitle={`${rows.length} enrolled`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New student</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Full Name *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Admission # *</Label><Input value={form.admission_number} onChange={e => setForm({ ...form, admission_number: e.target.value })} /></div>
                  <div><Label>Roll #</Label><Input value={form.roll_number} onChange={e => setForm({ ...form, roll_number: e.target.value })} /></div>
                </div>
                <div><Label>Class</Label>
                  <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name} - {c.section}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Date of Birth</Label><Input type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Parent Name</Label><Input value={form.parent_name} onChange={e => setForm({ ...form, parent_name: e.target.value })} /></div>
                  <div><Label>Parent Mobile</Label><Input value={form.parent_mobile} onChange={e => setForm({ ...form, parent_mobile: e.target.value })} /></div>
                </div>
                <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
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
                Adm# {r.admission_number} · Roll {r.roll_number || "-"} · {r.classes ? `Class ${r.classes.name}-${r.classes.section}` : "Unassigned"}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No students yet.</p>}
      </div>
    </>
  );
}
