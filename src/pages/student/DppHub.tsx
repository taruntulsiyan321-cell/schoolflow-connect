import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui-bits";
import { DppCard, DppCardData } from "@/components/dpp/DppCard";
import { FileText } from "lucide-react";

export default function DppHub() {
  const { user } = useAuth();
  const [dpps, setDpps] = useState<DppCardData[]>([]);
  const [attempts, setAttempts] = useState<Record<string, any>>({});

  useEffect(() => {
    (async () => {
      const { data: d } = await supabase.from("dpps").select("*").eq("is_published", true).order("created_at", { ascending: false });
      setDpps((d ?? []) as any);
      if (user) {
        const { data: a } = await supabase.from("dpp_attempts").select("*").eq("user_id", user.id);
        const m: Record<string, any> = {};
        (a ?? []).forEach(x => m[x.dpp_id] = x);
        setAttempts(m);
      }
    })();
  }, [user]);

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
      {dpps.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-2" />
          <p>No DPPs published yet for your class.</p>
        </div>
      )}
      {active.length > 0 && <Section title="Active" items={active} emptyText="Nothing pending." />}
      {overdue.length > 0 && <Section title="Overdue" items={overdue} emptyText="" tone="warning" />}
      {completed.length > 0 && <Section title="Completed" items={completed} emptyText="" />}
    </>
  );
}
