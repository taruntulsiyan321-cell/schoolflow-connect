import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, BarChart3, FileText } from "lucide-react";
import { toast } from "sonner";

export default function DppList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("dpps")
      .select("*, classes(name,section)")
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!user) return;
    // Find a class the teacher teaches
    const { data: t } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
    let classId = t?.class_teacher_of as string | null;
    if (!classId) {
      const { data: tc } = await supabase.from("teacher_classes").select("class_id").eq("teacher_id", t?.id).limit(1).maybeSingle();
      classId = tc?.class_id ?? null;
    }
    if (!classId) return toast.error("You don't have any classes assigned yet.");
    const { data, error } = await supabase.from("dpps").insert({
      title: "Untitled DPP",
      subject: "Math",
      class_id: classId,
      created_by: user.id,
      difficulty: "medium",
      duration_sec: 1800,
    }).select("id").single();
    if (error) return toast.error(error.message);
    nav(`/teacher/dpp/${data.id}`);
  };

  return (
    <>
      <PageHeader
        title="Daily Practice Problems"
        subtitle="Author, publish and analyze DPPs for your classes"
        action={<Button onClick={create}><Plus className="w-4 h-4" /> Create DPP</Button>}
      />

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground mb-4">No DPPs yet. Create your first one.</p>
          <Button onClick={create}><Plus className="w-4 h-4" /> Create DPP</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map(d => (
            <Card key={d.id} className="p-4">
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
                    <Link to={`/teacher/dpp/${d.id}/analytics`}><BarChart3 className="w-4 h-4" /></Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/teacher/dpp/${d.id}`}>Edit</Link>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
