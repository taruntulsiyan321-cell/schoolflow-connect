import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TestService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, BarChart3, FileText, Trash2, Target, Clock, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import "./teacher-premium.css";
import { toErrorMessage } from "@/lib/presentation";

export default function DppList() {
  const { user } = useAuth();
  const { ctx } = useAcademicContext();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("dpps")
      .select("*, classes(name,section)")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!user || !ctx) return;
    const { data: t, error: tErr } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
    if (tErr) return toast.error("Failed to look up your teacher record: " + tErr.message);
    let classId = t?.class_teacher_of as string | null;
    if (!classId) {
      const { data: tc, error: tcErr } = await supabase.from("teacher_classes").select("class_id").eq("teacher_id", t?.id).limit(1).maybeSingle();
      if (tcErr) return toast.error("Failed to look up your assigned classes: " + tcErr.message);
      classId = tc?.class_id ?? null;
    }
    if (!classId) return toast.error("You don't have any classes assigned yet.");
    try {
      const data = await TestService.create(ctx, {
        classId,
        title: "Untitled DPP",
        subject: "Math",
        difficulty: "medium",
        duration_sec: 1800,
      });
      nav(`/teacher/classes`);
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to create DPP"));
    }
  };

  const remove = async (d: any) => {
    if (!window.confirm(`Delete "${d.title}" and all its questions?`)) return;
    if (!ctx) return toast.error("Sign in required");
    try {
      await TestService.remove(ctx, d.id);
      toast.success("DPP deleted");
      setRows(prev => prev.filter(row => row.id !== d.id));
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to delete DPP"));
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const published = rows.filter((row) => row.is_published).length;
  const drafts = rows.length - published;
  const dueSoon = rows.filter((row) => row.due_at && row.due_at.slice(0, 10) >= today).length;
  const avgQuestions = rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.question_count ?? 0), 0) / rows.length) : 0;

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="tp-kicker mb-4">Practice Assignment Center</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Assign practice that fixes learning gaps.</h1>
            <p className="text-sm text-foreground/75 mt-2 max-w-2xl">Create daily practice, chapter practice, concept practice, revision sets, and recovery assignments from one academic workflow.</p>
          </div>
          <Button onClick={create} className="bg-white text-emerald-950 hover:bg-white/90"><Plus className="w-4 h-4 mr-1" /> Create DPP</Button>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <PracticeMetric icon={<Target className="w-5 h-5" />} label="Total Sets" value={rows.length} sub="practice library" />
        <PracticeMetric icon={<CheckCircle2 className="w-5 h-5" />} label="Published" value={published} sub="visible to students" />
        <PracticeMetric icon={<FileText className="w-5 h-5" />} label="Drafts" value={drafts} sub="finish and publish" />
        <PracticeMetric icon={<Clock className="w-5 h-5" />} label="Avg Questions" value={avgQuestions} sub={`${dueSoon} active deadlines`} />
      </div>

      <Card className="tp-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="tp-label">Assignment modes</p>
            <h3 className="tp-display text-xl mt-1">Choose the learning objective first</h3>
          </div>
          <Badge variant="outline" className="rounded-full">Recovery ready</Badge>
        </div>
        <div className="grid md:grid-cols-5 gap-3">
          {["Daily Practice", "Chapter Practice", "Concept Practice", "Revision Set", "Recovery Assignment"].map((mode) => (
            <button key={mode} type="button" onClick={create} className="tp-action text-left">
              <Sparkles className="w-4 h-4 text-primary mb-3" />
              <p className="font-semibold text-sm">{mode}</p>
              <p className="text-xs text-muted-foreground mt-1">Subject · chapter · concept · difficulty · deadline</p>
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="tp-card p-10 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground mb-4">No DPPs yet. Create your first one.</p>
          <Button onClick={create}><Plus className="w-4 h-4" /> Create DPP</Button>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {rows.map(d => (
            <Card key={d.id} className="tp-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] uppercase">{d.subject}</Badge>
                    {d.is_published
                      ? <Badge className="bg-accent/15 text-accent border-accent/30" variant="outline">Published</Badge>
                      : <Badge variant="outline">Draft</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {d.classes ? `Class ${d.classes.name}-${d.classes.section}` : ""}
                    </span>
                  </div>
                  <div className="font-semibold truncate">{d.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {d.question_count} questions · {Math.round(d.duration_sec / 60)} min · {d.total_marks} marks
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/teacher/classes"><BarChart3 className="w-4 h-4" /></Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/teacher/classes">Open workspace</Link>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(d)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PracticeMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold mt-2">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}
