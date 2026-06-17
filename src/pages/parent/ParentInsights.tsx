import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useParentWeeklyDigest, type ParentAlert } from "@/hooks/useParentWeeklyDigest";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck, NotebookPen, Trophy, Wallet, Bell, TrendingUp, AlertTriangle } from "lucide-react";

type ChildInsight = {
  id: string;
  name: string;
  classLabel: string;
  attPct: number;
  homeworkDone: number;
  homeworkTotal: number;
  avgMarksPct: number;
  pendingFees: number;
};

const alertTone: Record<ParentAlert["kind"], string> = {
  weakness: "bg-destructive/10 text-destructive border-destructive/30",
  consistency: "bg-warning/10 text-warning border-warning/30",
  improvement: "bg-accent/10 text-accent border-accent/30",
  participation: "bg-primary/10 text-primary border-primary/30",
};

export default function ParentInsights() {
  const { user } = useAuth();
  const { data: digest, loading: digestLoading, reload: reloadDigest } = useParentWeeklyDigest();
  const [kids, setKids] = useState<ChildInsight[]>([]);
  const [conceptData, setConceptData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: students } = await supabase
        .from("students")
        .select("id, full_name, class_id, classes(name,section)")
        .eq("parent_user_id", user.id);

      const insights: ChildInsight[] = [];
      for (const s of students ?? []) {
        const classLabel = s.classes ? `Class ${s.classes.name}-${s.classes.section}` : "Unassigned";

        const { data: att } = await supabase.from("attendance").select("status").eq("student_id", s.id);
        const attTotal = att?.length ?? 0;
        const present = att?.filter((a) => a.status === "present").length ?? 0;
        const attPct = attTotal ? Math.round((present / attTotal) * 100) : 0;

        let homeworkDone = 0;
        let homeworkTotal = 0;
        const hwIds: string[] = [];
        if (s.class_id) {
          const { data: hw } = await supabase.from("homework").select("id").eq("class_id", s.class_id);
          hwIds.push(...(hw ?? []).map((h) => h.id));
          homeworkTotal = hwIds.length;
        }
        if (hwIds.length) {
          const { data: subs } = await supabase
            .from("homework_submissions")
            .select("homework_id, status")
            .eq("student_id", s.id)
            .in("homework_id", hwIds);
          homeworkDone = (subs ?? []).filter((x) => x.status === "submitted" || x.status === "graded").length;
          homeworkTotal = hwIds.length;
        }

        let avgMarksPct = 0;
        if (s.class_id) {
          const { data: exams } = await supabase.from("exams").select("id, max_marks").eq("class_id", s.class_id);
          const examIds = (exams ?? []).map((e) => e.id);
          const maxByExam: Record<string, number> = {};
          exams?.forEach((e) => {
            maxByExam[e.id] = Number(e.max_marks) || 100;
          });
          if (examIds.length) {
            const { data: marks } = await supabase
              .from("marks")
              .select("marks_obtained, exam_id")
              .eq("student_id", s.id)
              .in("exam_id", examIds);
            const pcts = (marks ?? [])
              .map((m) => {
                const max = maxByExam[m.exam_id] || 100;
                return max ? (Number(m.marks_obtained) / max) * 100 : 0;
              })
              .filter((p) => !Number.isNaN(p));
            avgMarksPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
          }
        }

        const { data: fees } = await supabase.from("fees").select("amount, paid_amount, status").eq("student_id", s.id);
        const pendingFees = (fees ?? [])
          .filter((f) => f.status !== "paid")
          .reduce((sum, f) => sum + (Number(f.amount) - Number(f.paid_amount || 0)), 0);

        insights.push({
          id: s.id,
          name: s.full_name,
          classLabel,
          attPct,
          homeworkDone,
          homeworkTotal,
          avgMarksPct,
          pendingFees,
        });
      }
      setKids(insights);
      const { data: concepts } = await (supabase as any).rpc("rpc_parent_concept_analytics");
      setConceptData(concepts);
      setLoading(false);
    })();
  }, [user]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

  const digestByStudent = new Map((digest?.children ?? []).map((c) => [c.student_id, c]));
  const conceptByStudent = new Map(
    ((conceptData?.children ?? []) as { student_id: string }[]).map((c) => [c.student_id, c]),
  );

  return (
    <>
      <PageHeader title="Engagement insights" subtitle="Attendance, homework, marks, fees, and weekly academic digest" />
      {loading || digestLoading ? (
        <p className="text-sm text-muted-foreground text-center py-10">Loading insights…</p>
      ) : kids.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">Link a student to your account to see insights.</Card>
      ) : (
        <div className="space-y-6">
          {kids.map((k) => {
            const hwPct = k.homeworkTotal ? Math.round((k.homeworkDone / k.homeworkTotal) * 100) : 0;
            const weekly = digestByStudent.get(k.id);
            const snap = weekly?.snapshot as {
              exam_readiness?: { score?: number; label?: string; active_days_14d?: number };
              mistake_count?: number;
            } | undefined;
            const alerts = weekly?.alerts ?? [];
            const concepts = conceptByStudent.get(k.id) as {
              weak_areas?: { subject: string; concept: string; mastery_score: number }[];
              recovery_pending?: number;
              recovery_completed?: number;
              mastery_trend?: number;
            } | undefined;

            return (
              <Card key={k.id} className="p-5 shadow-card space-y-4">
                <div>
                  <div className="font-bold text-lg">{k.name}</div>
                  <div className="text-sm text-muted-foreground">{k.classLabel}</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value={`${k.attPct}%`} />
                  <StatCard icon={<NotebookPen className="w-5 h-5" />} label="Homework done" value={`${hwPct}%`} tone="accent" />
                  <StatCard icon={<Trophy className="w-5 h-5" />} label="Avg marks" value={`${k.avgMarksPct}%`} />
                  <StatCard icon={<Wallet className="w-5 h-5" />} label="Pending fees" value={fmt(k.pendingFees)} tone={k.pendingFees > 0 ? "warning" : undefined} />
                </div>
                <div>
                  <div>Homework completion ({k.homeworkDone}/{k.homeworkTotal})</div>
                  <Progress value={hwPct} className="h-2" />
                </div>

                {snap && (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/40">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Bell className="w-4 h-4" /> Weekly academic summary
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Practice accuracy: <strong>{snap.exam_readiness?.accuracy_pct ?? 0}%</strong>
                      · Active study days (14d): <strong>{snap.exam_readiness?.active_days_14d ?? 0}</strong>
                      · Mistake book: <strong>{snap.mistake_count ?? 0}</strong> open
                      {(snap.recovery_pending ?? 0) > 0 && (
                        <> · Recovery: <strong>{snap.recovery_pending}</strong> pending</>
                      )}
                    </p>
                  </div>
                )}

                {alerts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning" /> Alerts (last 7 days)
                    </div>
                    {alerts.map((a) => (
                      <div key={a.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className={alertTone[a.kind]}>{a.kind}</Badge>
                          <span className="font-medium">{a.title}</span>
                        </div>
                        <p className="text-muted-foreground">{a.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {concepts && (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                    <div className="text-sm font-semibold">Concept mastery (no question detail)</div>
                    <p className="text-xs text-muted-foreground">
                      Avg mastery: <strong>{concepts.mastery_trend ?? "—"}%</strong>
                      · Recovery pending: <strong>{concepts.recovery_pending ?? 0}</strong>
                      · Completed (30d): <strong>{concepts.recovery_completed ?? 0}</strong>
                    </p>
                    {(concepts.weak_areas ?? []).length > 0 && (
                      <ul className="text-sm space-y-1">
                        {(concepts.weak_areas ?? []).map((w, i) => (
                          <li key={i}>{w.subject} — {w.concept} ({Math.round(w.mastery_score)}% mastery)</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {alerts.length === 0 && snap && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-accent" /> No new alerts this week — keep encouraging daily practice.
                  </p>
                )}
              </Card>
            );
          })}
          <p className="text-xs text-muted-foreground text-center">
            Digest refreshed {digest?.generated_at ? new Date(digest.generated_at).toLocaleString("en-IN") : "—"}
            {" · "}
            <button type="button" className="underline" onClick={() => reloadDigest()}>Refresh</button>
          </p>
        </div>
      )}
    </>
  );
}
