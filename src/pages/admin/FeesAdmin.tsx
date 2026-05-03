import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

const monthNow = () => new Date().toISOString().slice(0, 7);

export default function FeesAdmin() {
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [fees, setFees] = useState<Record<string, any>>({});
  const [month, setMonth] = useState(monthNow());
  const [open, setOpen] = useState(false);
  const [bulk, setBulk] = useState({ amount: "1000", due_date: "" });

  useEffect(() => { supabase.from("classes").select("*").order("name").then(({ data }) => setClasses(data ?? [])); }, []);

  const load = async () => {
    if (!classId) return;
    const { data: s } = await supabase.from("students").select("*").eq("class_id", classId).order("roll_number");
    setStudents(s ?? []);
    const { data: f } = await supabase.from("fees").select("*").eq("month", month).in("student_id", (s ?? []).map(x => x.id));
    const map: Record<string, any> = {};
    f?.forEach(r => { map[r.student_id] = r; });
    setFees(map);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [classId, month]);

  const generateForClass = async () => {
    if (!students.length) return toast.error("No students");
    const rows = students.map(s => ({
      student_id: s.id, month, amount: Number(bulk.amount), paid_amount: 0,
      due_date: bulk.due_date || null, status: "unpaid" as const,
    }));
    const { error } = await supabase.from("fees").upsert(rows, { onConflict: "student_id,month" });
    if (error) return toast.error(error.message);
    toast.success(`Generated ${rows.length} fee records`);
    setOpen(false); load();
  };

  const updatePaid = async (sid: string, paid: number) => {
    const f = fees[sid];
    if (!f) return;
    const status = paid >= f.amount ? "paid" : paid > 0 ? "partial" : "unpaid";
    const { error } = await supabase.from("fees").update({ paid_amount: paid, status }).eq("id", f.id);
    if (error) return toast.error(error.message);
    load();
  };

  const totals = students.reduce((acc, s) => {
    const f = fees[s.id]; if (!f) { acc.unpaid++; return acc; }
    acc.amount += Number(f.amount); acc.paid += Number(f.paid_amount);
    if (f.status === "paid") acc.paidC++; else if (f.status === "partial") acc.partialC++; else acc.unpaid++;
    return acc;
  }, { amount: 0, paid: 0, paidC: 0, partialC: 0, unpaid: 0 });

  return (
    <>
      <PageHeader title="Fees Management" subtitle="Track monthly fee collection per class"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-gradient-primary text-primary-foreground" disabled={!classId}><Plus className="w-4 h-4 mr-1" /> Generate Month</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Generate fees for {month}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Amount per student</Label><Input type="number" value={bulk.amount} onChange={e => setBulk({ ...bulk, amount: e.target.value })} /></div>
                <div><Label>Due date</Label><Input type="date" value={bulk.due_date} onChange={e => setBulk({ ...bulk, due_date: e.target.value })} /></div>
                <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={generateForClass}>Generate for {students.length} students</Button>
              </div>
            </DialogContent>
          </Dialog>
        } />

      <Card className="p-4 mb-4 shadow-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      </Card>

      {classId && (
        <Card className="p-4 mb-4 shadow-card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div><div className="text-2xl font-bold text-accent">{totals.paidC}</div><div className="text-xs text-muted-foreground">Paid</div></div>
            <div><div className="text-2xl font-bold text-warning">{totals.partialC}</div><div className="text-xs text-muted-foreground">Partial</div></div>
            <div><div className="text-2xl font-bold text-destructive">{totals.unpaid}</div><div className="text-xs text-muted-foreground">Unpaid</div></div>
            <div><div className="text-2xl font-bold">₹{totals.paid}/{totals.amount}</div><div className="text-xs text-muted-foreground">Collected</div></div>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {students.map(s => {
          const f = fees[s.id];
          const status = f?.status ?? "—";
          const tone = status === "paid" ? "bg-accent/10 text-accent" : status === "partial" ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive";
          return (
            <Card key={s.id} className="p-3 flex items-center justify-between gap-3 shadow-card">
              <div className="min-w-0">
                <div className="font-medium truncate">{s.full_name}</div>
                <div className="text-xs text-muted-foreground">Roll {s.roll_number || "-"} · {f ? `₹${f.amount} due` : "no record"}</div>
              </div>
              <div className="flex items-center gap-2">
                {f && (
                  <>
                    <Input type="number" className="w-24 h-9" defaultValue={f.paid_amount}
                      onBlur={(e) => updatePaid(s.id, Number(e.target.value))} />
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${tone}`}>{status}</span>
                  </>
                )}
              </div>
            </Card>
          );
        })}
        {classId && students.length === 0 && <p className="text-muted-foreground text-center py-8">No students in this class.</p>}
        {!classId && <p className="text-muted-foreground text-center py-8 flex items-center justify-center gap-2"><Wallet className="w-4 h-4" /> Pick a class to begin</p>}
      </div>
    </>
  );
}
