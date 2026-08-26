import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MarksService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FileText, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";
import { classLabel } from "@/lib/utils";
import { toErrorMessage } from "@/lib/presentation";

interface Props { isAdmin?: boolean; }

export default function ExamsPage({ isAdmin = false }: Props) {
  const { user } = useAuth();
  const { ctx } = useAcademicContext();
  const [classes, setClasses] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [activeExam, setActiveExam] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const emptyForm = { name: "", exam_type: "class_test", class_id: "", subject: "", max_marks: "100", exam_date: "" };
  const [form, setForm] = useState(emptyForm);

  const loadClasses = async () => {
    if (isAdmin) {
      const { data, error } = await supabase.from("classes").select("*").order("name");
      if (error) return toast.error("Failed to load classes: " + error.message);
      setClasses(data ?? []);
    } else if (user) {
      const { data: t, error: tErr } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
      if (tErr) return toast.error("Failed to look up your teacher record: " + tErr.message);
      const ids = new Set<string>();
      if (t?.class_teacher_of) ids.add(t.class_teacher_of);
      if (t) {
        const { data: tc, error: tcErr } = await supabase.from("teacher_classes").select("class_id").eq("teacher_id", t.id);
        if (tcErr) return toast.error("Failed to load assigned classes: " + tcErr.message);
        tc?.forEach(r => ids.add(r.class_id));
      }
      if (ids.size) {
        const { data: cls, error: clsErr } = await supabase.from("classes").select("*").in("id", Array.from(ids));
        if (clsErr) return toast.error("Failed to load classes: " + clsErr.message);
        setClasses(cls ?? []);
      }
    }
  };
  const loadExams = async () => {
    const { data, error } = await supabase.from("exams").select("*, classes(name,section)").order("exam_date", { ascending: false }).limit(100);
    if (error) return toast.error("Failed to load exams: " + error.message);
    setExams(data ?? []);
  };
  useEffect(() => { loadClasses(); loadExams(); /* eslint-disable-next-line */ }, [user, isAdmin]);

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (e: any) => {
    setEditId(e.id);
    setForm({
      name: e.name ?? "", exam_type: e.exam_type ?? "class_test", class_id: e.class_id ?? "",
      subject: e.subject ?? "", max_marks: String(e.max_marks ?? "100"), exam_date: e.exam_date ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name || !form.class_id || !form.subject) return toast.error("Name, class and subject required");
    if (!ctx) return toast.error("Sign in required");
    try {
      await MarksService.upsertExam(ctx, {
        id: editId ?? undefined,
        classId: form.class_id,
        name: form.name,
        subject: form.subject,
        maxMarks: Number(form.max_marks),
        examDate: form.exam_date || null,
        examType: form.exam_type,
      });
      toast.success(editId ? "Exam updated" : "Exam created");
      setOpen(false); setEditId(null); setForm(emptyForm); loadExams();
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to save exam"));
    }
  };

  const remove = async (e: any) => {
    if (!window.confirm(`Delete "${e.name}"? This also removes all marks entered for it.`)) return;
    if (!ctx) return toast.error("Sign in required");
    try {
      await MarksService.removeExam(ctx, e.id);
      toast.success("Exam deleted");
      loadExams();
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to delete exam"));
    }
  };

  const openMarks = async (exam: any) => {
    setActiveExam(exam);
    const { data: s, error: sErr } = await supabase.from("students_current").select("*").eq("class_id", exam.class_id).order("roll_number");
    if (sErr) return toast.error("Failed to load students: " + sErr.message);
    setStudents(s ?? []);
    const { data: m, error: mErr } = await supabase.from("marks").select("student_id, marks_obtained").eq("exam_id", exam.id);
    if (mErr) return toast.error("Failed to load existing marks: " + mErr.message);
    const map: Record<string, string> = {};
    m?.forEach(r => { map[r.student_id] = String(r.marks_obtained); });
    setMarks(map);
  };

  const saveMarks = async () => {
    if (!ctx) return toast.error("Sign in required");
    const rows = Object.entries(marks)
      .filter(([, v]) => v !== "")
      .map(([studentId, v]) => ({ studentId, marksObtained: Number(v) }));
    if (!rows.length) return toast.error("Enter at least one mark");
    try {
      await MarksService.publishBatch(ctx, activeExam.id, rows);
      toast.success("Marks saved");
      setActiveExam(null);
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to save marks"));
    }
  };

  return (
    <>
      <PageHeader title="Exams & Marks" subtitle="Create tests and enter results"
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm(emptyForm); } }}>
            <DialogTrigger asChild><Button className="bg-gradient-primary text-primary-foreground" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> New Exam</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId ? "Edit exam" : "Create exam"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Maths Unit Test 1" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Type</Label>
                    <Select value={form.exam_type} onValueChange={v => setForm({ ...form, exam_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="class_test">Class Test</SelectItem>
                        <SelectItem value="unit_test">Unit Test</SelectItem>
                        <SelectItem value="half_yearly">Half Yearly</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
                </div>
                <div><Label>Class</Label>
                  <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Max Marks</Label><Input type="number" value={form.max_marks} onChange={e => setForm({ ...form, max_marks: e.target.value })} /></div>
                  <div><Label>Date</Label><Input type="date" value={form.exam_date} onChange={e => setForm({ ...form, exam_date: e.target.value })} /></div>
                </div>
                <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={submit}>{editId ? "Save changes" : "Create"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        } />

      <div className="space-y-2">
        {exams.map(e => (
          <Card key={e.id} className="p-4 flex items-center justify-between gap-3 shadow-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><FileText className="w-5 h-5" /></div>
              <div className="min-w-0">
                <div className="font-semibold truncate">{e.name}</div>
                <div className="text-xs text-muted-foreground">{e.subject} · {classLabel(e.classes)} · /{e.max_marks}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="outline" onClick={() => openMarks(e)}>Enter Marks</Button>
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => openEdit(e)} title="Edit exam"><Pencil className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => remove(e)} title="Delete exam"><Trash2 className="w-4 h-4" /></Button>
            </div>
          </Card>
        ))}
        {exams.length === 0 && <p className="text-muted-foreground text-center py-8">No exams yet.</p>}
      </div>

      <Dialog open={!!activeExam} onOpenChange={(v) => !v && setActiveExam(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{activeExam?.name} — marks (out of {activeExam?.max_marks})</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {students.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="text-sm flex-1 truncate">{s.roll_number ? `#${s.roll_number} · ` : ""}{s.full_name}</span>
                <Input type="number" className="w-24 h-9" value={marks[s.id] ?? ""} onChange={e => setMarks(p => ({ ...p, [s.id]: e.target.value }))} />
              </div>
            ))}
            {students.length === 0 && <p className="text-muted-foreground text-sm">No students in this class.</p>}
          </div>
          <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={saveMarks}>Save Marks</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
