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

const CLASS_NAMES = ["PG", "Nursery", "KG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const SECTIONS = ["A", "B", "C", "D"];

export default function ClassesAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("1");
  const [section, setSection] = useState("A");

  const load = async () => {
    const { data } = await supabase.from("classes").select("*").order("name").order("section");
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const { error } = await supabase.from("classes").insert({ name, section });
    if (error) return toast.error(error.message);
    toast.success("Class added"); setOpen(false); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this class?")) return;
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  return (
    <>
      <PageHeader title="Classes & Sections" subtitle="Set up the academic structure"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add Class</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New class</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Select value={name} onValueChange={setName}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CLASS_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Select value={section} onValueChange={setSection}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SECTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={add}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        } />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between shadow-card">
            <div>
              <div className="font-bold text-lg">Class {r.name}</div>
              <div className="text-xs text-muted-foreground">Section {r.section} · {r.academic_year}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground col-span-full text-center py-8">No classes yet. Create one to get started.</p>}
      </div>
    </>
  );
}
