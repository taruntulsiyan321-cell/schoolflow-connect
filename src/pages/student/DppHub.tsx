import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui-bits";
import { DppCard, DppCardData } from "@/components/dpp/DppCard";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Calculator, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

export default function DppHub() {
  const { user } = useAuth();
  const [dpps, setDpps] = useState<DppCardData[]>([]);
  const [attempts, setAttempts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    let dppQuery = supabase.from("dpps").select("*").eq("is_published", true).order("created_at", { ascending: false });
    const { data: s } = await supabase.from("students").select("class_id").eq("user_id", user.id).maybeSingle();
    if (s?.class_id) dppQuery = dppQuery.eq("class_id", s.class_id);
    const { data: d, error: dErr } = await dppQuery;
    if (dErr) {
      setLoadError(dErr.message);
      setLoading(false);
      return;
    }
    setDpps((d ?? []) as DppCardData[]);
    const { data: a, error: aErr } = await supabase.from("dpp_attempts").select("*").eq("user_id", user.id);
    if (aErr) {
      setLoadError(aErr.message);
      setLoading(false);
      return;
    }
    const m: Record<string, any> = {};
    (a ?? []).forEach((x) => { m[x.dpp_id] = x; });
    setAttempts(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const now = Date.now();
  const completed = dpps.filter(d => attempts[d.id]?.status === "submitted");
  const active = dpps.filter(d => attempts[d.id]?.status !== "submitted" && (!d.due_at || new Date(d.due_at).getTime() >= now));
  const overdue = dpps.filter(d => attempts[d.id]?.status !== "submitted" && d.due_at && new Date(d.due_at).getTime() < now);

  const Section = ({ title, items, emptyText, tone }: { title: string; items: DppCardData[]; emptyText: string; tone?: "warning" }) => (
    <div className="mb-6">
      <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">{title} · {items.length}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {items.map(d => {
            const a = attempts[d.id];
            const status = a?.status === "submitted"
              ? { label: `${Math.round(Number(a.score))} / ${Math.round(Number(a.max_score))}`, tone: "success" as const }
              : tone === "warning"
              ? { label: "Overdue", tone: "warning" as const }
              : { label: a ? "Resume" : "Start", tone: "default" as const };
            const to = a?.status === "submitted" ? `/student/dpp/${d.id}/result` : `/student/dpp/${d.id}/attempt`;
            return <DppCard key={d.id} dpp={d} to={to} status={status} />;
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Daily Practice" subtitle="Sharpen your skills · Build streaks · Earn XP" />
      <div className="mb-6">
        <Button asChild variant="outline" className="gap-2">
          <Link to="/student/practice/math12">
            <Calculator className="w-4 h-4" /> Class 12 Maths — unlimited NCERT practice
          </Link>
        </Button>
      </div>
      {loading && <StudentListSkeleton rows={3} />}
      {!loading && loadError && (
        <StudentErrorState title="Could not load daily practice" message={loadError} onRetry={load} />
      )}
      {!loading && !loadError && dpps.length === 0 && (
        <Card className="p-10 text-center shadow-card">
          <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">No DPPs published yet for your class.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/student/practice/math12"><Calculator className="w-4 h-4 mr-1" /> Try Class 12 Math practice</Link>
          </Button>
        </Card>
      )}
      {!loading && !loadError && dpps.length > 0 && (
        <>
          {active.length > 0 && <Section title="Active" items={active} emptyText="Nothing pending." />}
          {overdue.length > 0 && <Section title="Overdue" items={overdue} emptyText="" tone="warning" />}
          {completed.length > 0 && <Section title="Completed" items={completed} emptyText="" />}
        </>
      )}
    </>
  );
}
