import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, TrendingUp, Trophy, Lightbulb, Target, CheckCircle2, Clock, Brain } from "lucide-react";
import "./teacher-premium.css";
import { displayChapter, displayConcept, displaySubject } from "@/lib/academicDisplay";

export default function ClassInsights() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: t } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
      if (!t) return;
      const list: any[] = [];
      if (t.class_teacher_of) {
        const { data: c } = await supabase.from("classes").select("id,name,section,display_name").eq("id", t.class_teacher_of).maybeSingle();
        if (c) list.push(c);
      }
      const { data: tc } = await supabase.from("teacher_classes").select("classes(id,name,section,display_name)").eq("teacher_id", t.id);
      (tc ?? []).forEach((r: any) => {
        if (r.classes && !list.find((x) => x.id === r.classes.id)) list.push(r.classes);
      });
      setClasses(list);
      if (list[0]) setClassId(list[0].id);
    })();
  }, [user]);

  useEffect(() => {
    if (!classId) return;
    (async () => {
      setLoading(true);
      const { data: ins, error } = await supabase.rpc("rpc_teacher_concept_analytics", { _class_id: classId });
      if (error) setData(null);
      else setData(ins);
      setLoading(false);
    })();
  }, [classId]);

  const atRisk = data?.at_risk ?? [];
  const improving = data?.improving ?? [];
  const topPerformers = data?.top_performers ?? [];
  const weakTopics = data?.class_weak_topics ?? [];
  const weakConcepts = data?.class_weak_concepts ?? [];
  const recoveryRate = typeof data?.recovery_completion_rate === "number" ? data.recovery_completion_rate : 0;
  const mastery = data?.mastery_distribution ?? {};
  const lowMastery = mastery.below_40 ?? 0;
  const midMastery = (mastery["40_60"] ?? 0) + (mastery["60_80"] ?? 0);
  const highMastery = mastery.above_80 ?? 0;
  const avgReadiness = Math.max(45, Math.min(96, 88 - atRisk.length * 4 + improving.length * 2 + Math.round(recoveryRate / 10)));

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-5">
          <div>
            <div className="tp-kicker mb-4">Flagship Academic Intelligence</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Class Confusion Map</h1>
            <p className="text-sm text-white/75 mt-2 max-w-2xl">See what the class does not understand yet, who needs intervention, and what to reteach before the next lesson.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/12 border border-white/15 p-3 text-center">
              <p className="text-2xl font-bold">{atRisk.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">At risk</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-3 text-center">
              <p className="text-2xl font-bold">{improving.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Improving</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-3 text-center">
              <p className="text-2xl font-bold">{weakConcepts.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Weak concepts</p>
            </div>
          </div>
        </div>
      </section>
      {classes.length === 0 ? (
        <Card className="tp-card p-8 text-center">
          <p className="text-muted-foreground text-sm">No classes assigned yet. Ask admin to link you to a class.</p>
        </Card>
      ) : (
      <>
      <Card className="tp-card p-4">
      <Select value={classId} onValueChange={setClassId}>
        <SelectTrigger className="mb-4 max-w-xs"><SelectValue placeholder="Select class" /></SelectTrigger>
        <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.display_name || `${c.name}-${c.section}`}</SelectItem>)}</SelectContent>
      </Select>
      </Card>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading class insights…</p>
      ) : (
      <>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <InsightMetric icon={<Target className="w-5 h-5" />} label="Exam Readiness" value={`${avgReadiness}%`} sub="current class signal" />
        <InsightMetric icon={<Brain className="w-5 h-5" />} label="Weak Concepts" value={weakConcepts.length} sub="reteach queue" />
        <InsightMetric icon={<CheckCircle2 className="w-5 h-5" />} label="Recovery Success" value={`${recoveryRate}%`} sub="completion rate" />
        <InsightMetric icon={<AlertTriangle className="w-5 h-5" />} label="At Risk" value={atRisk.length} sub="intervention needed" />
        <InsightMetric icon={<Clock className="w-5 h-5" />} label="Practice Signal" value="Live" sub="DPP + battles" />
      </div>

      <Card className="tp-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="tp-label">Confusion heat map</p>
            <h3 className="tp-display text-xl mt-1">Most confused concepts</h3>
          </div>
          <Badge variant="outline" className="rounded-full">Teach again first</Badge>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {weakConcepts.slice(0, 9).map((concept: any, index: number) => {
            const masteryScore = Number(concept.avg_mastery ?? 0);
            const struggle = Math.max(12, 100 - masteryScore);
            return (
              <div key={`${concept.subject}-${concept.concept}-${index}`} className="tp-row">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-bold text-sm">{displayConcept(concept.concept) || "Concept gap"}</p>
                    <p className="text-xs text-muted-foreground">{displaySubject(concept.subject) || "Subject"} · {concept.students ?? 0} students struggled</p>
                  </div>
                  <span className="rounded-full bg-warning/15 px-2 py-1 text-xs font-bold text-warning">{struggle}% confused</span>
                </div>
                <div className="tp-progress"><span style={{ width: `${struggle}%` }} /></div>
                <p className="text-xs text-muted-foreground mt-2">Action: reteach, then assign a 10-question concept recovery set.</p>
              </div>
            );
          })}
          {weakConcepts.length === 0 && <p className="text-sm text-muted-foreground">No confused concepts yet. DPP and battle attempts will populate this map.</p>}
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="tp-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3 text-warning"><AlertTriangle className="w-4 h-4" /> At risk</h3>
          {atRisk.map((s: any) => (
            <div key={s.student_id} className="tp-row text-sm mb-2">
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">Att {s.attendance_pct}% · Acc {s.avg_accuracy}%</div>
            </div>
          ))}
          {atRisk.length === 0 && <p className="text-sm text-muted-foreground">No at-risk flags right now.</p>}
        </Card>
        <Card className="tp-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3 text-accent"><TrendingUp className="w-4 h-4" /> Improving</h3>
          {improving.map((s: any) => (
            <div key={s.student_id} className="tp-row text-sm font-medium mb-2">{s.name}</div>
          ))}
        </Card>
        <Card className="tp-card tp-gold-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Trophy className="w-4 h-4" /> Top performers</h3>
          {topPerformers.map((s: any) => (
            <div key={s.student_id} className="tp-row flex justify-between text-sm mb-2">
              <span>{s.name}</span><Badge variant="outline">{s.xp} XP</Badge>
            </div>
          ))}
        </Card>
      </div>
      <Card className="tp-card p-5 mt-4">
        <h3 className="font-semibold mb-2">Class weak topics (DPP data)</h3>
        {weakTopics.map((t: any, i: number) => (
          <div key={i} className="mb-3">
            <div className="flex justify-between text-sm mb-1">
              <span>{displaySubject(t.subject)} · {displayChapter(t.chapter)}</span><span>{t.accuracy}%</span>
            </div>
            <div className="tp-progress"><span style={{ width: `${Math.max(0, Math.min(100, Number(t.accuracy) || 0))}%` }} /></div>
          </div>
        ))}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card className="tp-card p-5">
          <h3 className="font-semibold mb-2">Class weak concepts</h3>
          {weakConcepts.length === 0 && (
            <p className="text-sm text-muted-foreground">Concept mastery data builds as students practice.</p>
          )}
          {weakConcepts.map((t: any, i: number) => (
            <div key={i} className="tp-row flex justify-between text-sm mb-2">
              <span>{displaySubject(t.subject)} · {displayConcept(t.concept)}</span>
              <span>{t.avg_mastery}% · {t.students} students</span>
            </div>
          ))}
        </Card>
        <Card className="tp-card p-5">
          <h3 className="font-semibold mb-2">Mastery distribution</h3>
          {data?.mastery_distribution ? (
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="tp-row text-center"><div className="text-2xl font-bold text-destructive">{lowMastery}</div><div className="text-xs text-muted-foreground">Needs rescue</div></div>
              <div className="tp-row text-center"><div className="text-2xl font-bold text-warning">{midMastery}</div><div className="text-xs text-muted-foreground">Developing</div></div>
              <div className="tp-row text-center"><div className="text-2xl font-bold text-accent">{highMastery}</div><div className="text-xs text-muted-foreground">Strong</div></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No mastery records yet.</p>
          )}
          {typeof data?.recovery_completion_rate === "number" && (
            <p className="text-xs text-muted-foreground mt-3">Recovery completion rate: {data.recovery_completion_rate}%</p>
          )}
        </Card>
      </div>

      <Card className="tp-card p-5 mt-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Lightbulb className="w-4 h-4 text-primary" /> Suggested interventions
        </h3>
        {(data?.interventions ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No interventions suggested yet — more class DPP data will unlock these.</p>
        )}
        {(data?.interventions ?? []).map((item: any, i: number) => (
          <div key={i} className="tp-row mb-2">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={item.priority === "high" ? "destructive" : item.priority === "medium" ? "default" : "outline"}>
                {item.priority}
              </Badge>
              <span className="font-medium text-sm">{item.action}</span>
            </div>
            <p className="text-xs text-muted-foreground">{item.rationale}</p>
            {item.suggested_dpp_title && (
              <p className="text-xs mt-1 text-primary/90">DPP idea: {item.suggested_dpp_title}</p>
            )}
          </div>
        ))}
      </Card>
      </>
      )}
      </>
      )}
    </div>
  );
}

function InsightMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: string }) {
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
