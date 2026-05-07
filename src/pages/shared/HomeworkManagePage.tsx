import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { NotebookPen, Plus, Calendar, BookOpen, Users, Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

interface Homework {
  id: string;
  class_id: string;
  subject: string;
  title: string;
  description: string;
  due_date: string | null;
  created_at: string;
  classes?: { name: string; section: string };
  submissionCount?: number;
  totalStudents?: number;
}

export default function HomeworkManagePage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [formClassId, setFormClassId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formDue, setFormDue] = useState("");
  const [saving, setSaving] = useState(false);

  // Submission viewer
  const [viewingHw, setViewingHw] = useState<Homework | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [submissionStudents, setSubmissionStudents] = useState<any[]>([]);

  // Load teacher's classes
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: t } = await supabase
        .from("teachers")
        .select("id, class_teacher_of, subject")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!t) { setLoading(false); return; }

      const classList: any[] = [];
      if (t.class_teacher_of) {
        const { data: c } = await supabase.from("classes").select("id,name,section").eq("id", t.class_teacher_of).maybeSingle();
        if (c) classList.push({ ...c, label: `${c.name}-${c.section} (CT)`, subject: t.subject || "" });
      }
      const { data: tc } = await supabase.from("teacher_classes").select("class_id, subject, classes(id,name,section)").eq("teacher_id", t.id);
      (tc ?? []).forEach((r: any) => {
        if (r.classes && !classList.find((x: any) => x.id === r.classes.id)) {
          classList.push({ ...r.classes, label: `${r.classes.name}-${r.classes.section}`, subject: r.subject || t.subject || "" });
        }
      });
      setClasses(classList);
      await loadHomework();
    })();
  }, [user]);

  const loadHomework = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("homework")
      .select("*, classes(name,section)")
      .eq("created_by", user!.id)
      .order("created_at", { ascending: false });

    const hw = (data ?? []) as Homework[];

    // Get submission counts
    if (hw.length > 0) {
      const hwIds = hw.map(h => h.id);
      const { data: subs } = await supabase
        .from("homework_submissions")
        .select("homework_id, status")
        .in("homework_id", hwIds);

      hw.forEach(h => {
        h.submissionCount = (subs ?? []).filter(s => s.homework_id === h.id && s.status !== "pending").length;
      });

      // Get total students per class
      const classIds = [...new Set(hw.map(h => h.class_id))];
      for (const cid of classIds) {
        const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("class_id", cid);
        hw.filter(h => h.class_id === cid).forEach(h => h.totalStudents = count ?? 0);
      }
    }

    setHomework(hw);
    setLoading(false);
  };

  const createHomework = async () => {
    if (!formTitle.trim() || !formClassId) {
      toast.error("Title and class are required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("homework").insert({
      class_id: formClassId,
      subject: formSubject || classes.find(c => c.id === formClassId)?.subject || "",
      title: formTitle.trim(),
      description: formDesc.trim(),
      due_date: formDue || null,
      created_by: user!.id,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Homework assigned!");
      setFormTitle(""); setFormDesc(""); setFormDue(""); setFormClassId(""); setFormSubject("");
      setDialogOpen(false);
      await loadHomework();
    }
    setSaving(false);
  };

  const deleteHomework = async (id: string) => {
    const { error } = await supabase.from("homework").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Homework deleted");
      setHomework(h => h.filter(x => x.id !== id));
    }
  };

  const viewSubmissions = async (hw: Homework) => {
    setViewingHw(hw);
    // Load students for this class
    const { data: students } = await supabase
      .from("students")
      .select("id,full_name,roll_number")
      .eq("class_id", hw.class_id)
      .order("roll_number");
    setSubmissionStudents(students ?? []);

    // Load submissions
    const { data: subs } = await supabase
      .from("homework_submissions")
      .select("*")
      .eq("homework_id", hw.id);
    setSubmissions(subs ?? []);
  };

  const gradeSubmission = async (subId: string, grade: string, remarks: string) => {
    const { error } = await supabase
      .from("homework_submissions")
      .update({ grade, teacher_remarks: remarks, status: "graded", graded_at: new Date().toISOString() })
      .eq("id", subId);
    if (error) toast.error(error.message);
    else {
      toast.success("Graded!");
      setSubmissions(s => s.map(x => x.id === subId ? { ...x, grade, teacher_remarks: remarks, status: "graded" } : x));
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const active = homework.filter(h => !h.due_date || h.due_date >= today);
  const past = homework.filter(h => h.due_date && h.due_date < today);

  return (
    <>
      <PageHeader
        title="Homework Management"
        subtitle="Assign, track and grade homework"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground">
                <Plus className="w-4 h-4 mr-1" /> Assign
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Homework</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div>
                  <Label>Class</Label>
                  <Select value={formClassId} onValueChange={(v) => {
                    setFormClassId(v);
                    setFormSubject(classes.find(c => c.id === v)?.subject || "");
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>
                      {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject</Label>
                  <Input value={formSubject} onChange={e => setFormSubject(e.target.value)} placeholder="e.g. Mathematics" />
                </div>
                <div>
                  <Label>Title</Label>
                  <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Homework title" />
                </div>
                <div>
                  <Label>Description / Instructions</Label>
                  <Textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Describe the homework…" rows={3} />
                </div>
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={formDue} onChange={e => setFormDue(e.target.value)} />
                </div>
                <Button onClick={createHomework} disabled={saving} className="w-full bg-gradient-primary text-primary-foreground">
                  {saving ? "Saving…" : "Assign Homework"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <StatCard icon={<NotebookPen className="w-5 h-5" />} label="Active" value={active.length} tone="accent" />
            <StatCard icon={<Clock className="w-5 h-5" />} label="Past Due" value={past.length} />
          </div>

          {/* Viewing submissions for a specific homework */}
          {viewingHw && (
            <Card className="p-4 mb-4 border-primary/30">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{viewingHw.title} — Submissions</h3>
                  <p className="text-xs text-muted-foreground">{viewingHw.subject} · {viewingHw.classes?.name}-{viewingHw.classes?.section}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setViewingHw(null)}>Close</Button>
              </div>
              <div className="space-y-2">
                {submissionStudents.map(s => {
                  const sub = submissions.find(x => x.student_id === s.id);
                  return (
                    <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="text-sm font-medium">{s.full_name}</div>
                        <div className="text-xs text-muted-foreground">Roll {s.roll_number || "—"}</div>
                        {sub?.content && <div className="text-xs mt-1 bg-muted p-2 rounded">{sub.content}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        {!sub || sub.status === "pending" ? (
                          <Badge variant="outline" className="text-muted-foreground">Not submitted</Badge>
                        ) : sub.status === "submitted" ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => gradeSubmission(sub.id, "A", "Good work!")}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Pending review</Badge>
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
                            {sub.grade || "Graded"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Active homework */}
          {active.length > 0 && (
            <>
              <h3 className="font-semibold mb-3">📋 Active Homework</h3>
              <div className="space-y-2 mb-6">
                {active.map(h => (
                  <HwCard key={h.id} hw={h} onView={() => viewSubmissions(h)} onDelete={() => deleteHomework(h.id)} />
                ))}
              </div>
            </>
          )}

          {/* Past homework */}
          {past.length > 0 && (
            <>
              <h3 className="font-semibold mb-3">📁 Past Homework</h3>
              <div className="space-y-2">
                {past.map(h => (
                  <HwCard key={h.id} hw={h} onView={() => viewSubmissions(h)} onDelete={() => deleteHomework(h.id)} isPast />
                ))}
              </div>
            </>
          )}

          {homework.length === 0 && (
            <Card className="p-8 text-center">
              <NotebookPen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No homework assigned yet. Click "Assign" to get started.</p>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function HwCard({ hw, onView, onDelete, isPast }: { hw: Homework; onView: () => void; onDelete: () => void; isPast?: boolean }) {
  const dueStr = hw.due_date
    ? new Date(hw.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "No due date";
  return (
    <Card className={`p-4 shadow-card ${isPast ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{hw.title}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {hw.subject} · Class {hw.classes?.name}-{hw.classes?.section} · Due: {dueStr}
          </div>
          {hw.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{hw.description}</p>
          )}
          <div className="text-xs text-muted-foreground mt-2">
            📩 {hw.submissionCount ?? 0}/{hw.totalStudents ?? 0} submitted
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="outline" size="sm" onClick={onView}>
            <Users className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            <X className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
