import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentXp } from "@/hooks/useStudentXp";
import { AcademicHeatmap } from "@/components/student/AcademicHeatmap";
import {
  Target, BookOpen, ClipboardCheck, Trophy, Flame, AlertTriangle,
  TrendingUp, ListChecks, BookMarked, Sword, Sparkles, Wrench,
} from "lucide-react";
import { ConceptMastery } from "@/components/student/ConceptMastery";

export default function StudentSuccessHome() {
  const { data, loading, error, reload } = useStudentAcademicSnapshot();
  const { xp: liveXp } = useStudentXp();
  const xp = liveXp.xp > 0 || liveXp.level > 1 ? liveXp : data?.xp;

  if (loading) return <p className="text-muted-foreground text-center py-12">Loading your academic snapshot…</p>;

  if (error) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <p className="text-sm text-muted-foreground mb-4">Could not load your dashboard. Apply the latest database migrations if this is a fresh setup.</p>
        <p className="text-xs text-destructive mb-4">{error}</p>
        <Button size="sm" variant="outline" onClick={() => reload()}>Try again</Button>
      </Card>
    );
  }

  const readiness = data?.exam_readiness;
  const toneClass =
    readiness?.tone === "ready" ? "text-accent" : readiness?.tone === "risk" ? "text-destructive" : "text-warning";

  return (
    <>
      <PageHeader
        eyebrow="Student Success"
        title={`Hi, ${data?.student?.full_name?.split(" ")[0] ?? "Student"}`}
        subtitle="Your growth dashboard — attendance, practice, weaknesses, and what to revise next"
      />

      <Card className="hero-panel p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-white/70">Exam readiness</div>
            <div className={`text-3xl font-bold mt-1 ${toneClass}`}>{readiness?.score ?? 0}%</div>
            <div className="text-sm text-white/80 mt-1">{readiness?.label ?? "Building profile"}</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" asChild><Link to="/student/revision">Revision queue</Link></Button>
            <Button size="sm" variant="secondary" asChild><Link to="/student/plans">Improvement plans</Link></Button>
            <Button size="sm" variant="secondary" asChild><Link to="/student/recovery">Recovery zone</Link></Button>
            <Button size="sm" variant="secondary" asChild><Link to="/student/mistakes">Mistake book</Link></Button>
            <Button size="sm" asChild><Link to="/student/analytics">Full analytics</Link></Button>
            <Button size="sm" variant="outline" asChild><Link to="/student/report">Print report</Link></Button>
          </div>
        </div>
        <Progress value={readiness?.score ?? 0} className="mt-4 h-2" />
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value={`${readiness?.attendance_pct ?? 0}%`} tone={(readiness?.attendance_pct ?? 0) >= 75 ? "accent" : "warning"} />
        <StatCard icon={<Target className="w-5 h-5" />} label="Practice accuracy" value={`${readiness?.accuracy_pct ?? 0}%`} hint="DPP + self-practice" />
        <Link to="/student/battleground/stats"><StatCard icon={<Sword className="w-5 h-5" />} label="Level" value={xp ? `L${xp.level}` : "L1"} hint={`${xp?.xp ?? 0} XP`} /></Link>
        <StatCard icon={<Flame className="w-5 h-5" />} label="Streak" value={`${xp?.current_streak ?? 0}d`} tone="accent" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3"><BookOpen className="w-4 h-4 text-primary" /><h3 className="font-semibold">Homework & DPP</h3></div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-muted"><div className="text-muted-foreground">Homework pending</div><div className="text-xl font-bold">{data?.homework?.pending ?? 0}</div></div>
            <div className="p-3 rounded-lg bg-muted"><div className="text-muted-foreground">DPP to complete</div><div className="text-xl font-bold">{data?.dpp?.open ?? 0}</div></div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Button size="sm" variant="outline" asChild><Link to="/student/homework">Homework</Link></Button>
            <Button size="sm" variant="outline" asChild><Link to="/student/dpp">Daily practice</Link></Button>
            <Button size="sm" asChild><Link to="/student/practice/math12">Class 12 Math</Link></Button>
          </div>
          {(data?.self_practice?.sessions_completed ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground mt-2">{data.self_practice.sessions_completed} self-practice sessions completed</p>
          )}
        </Card>

        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3"><Flame className="w-4 h-4 text-primary" /><h3 className="font-semibold">Consistency heatmap</h3></div>
          <AcademicHeatmap days={data?.activity_heatmap ?? []} />
          <p className="text-xs text-muted-foreground mt-2">Darker = more activity (DPP, battles, self-practice)</p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4 text-warning" /><h3 className="font-semibold">Weak topics — revise first</h3></div>
          <div className="space-y-2">
            {(data?.weak_topics ?? []).length === 0 && <p className="text-sm text-muted-foreground">Complete DPPs, battles, or self-practice to unlock weakness detection.</p>}
            {(data?.weak_topics ?? []).map((w, i) => (
              <div key={i} className="flex justify-between items-center p-2 rounded-lg bg-warning/10 border border-warning/20">
                <div>
                  <div className="font-medium text-sm">{w.subject}</div>
                  <div className="text-xs text-muted-foreground">{[w.chapter, w.topic].filter(Boolean).join(" · ") || "General"}</div>
                </div>
                <Badge variant="outline">{w.accuracy}%</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-accent" /><h3 className="font-semibold">Strong topics</h3></div>
          <div className="space-y-2">
            {(data?.strong_topics ?? []).map((w, i) => (
              <div key={i} className="flex justify-between p-2 rounded-lg bg-accent/10">
                <span className="font-medium text-sm">{w.subject}</span>
                <Badge className="bg-accent/20 text-accent border-0">{w.accuracy}%</Badge>
              </div>
            ))}
            {(data?.strong_topics ?? []).length === 0 && <p className="text-sm text-muted-foreground">Your strengths will appear as you practice.</p>}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <ConceptMastery />
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3"><Wrench className="w-4 h-4 text-primary" /><h3 className="font-semibold">Recovery zone</h3></div>
          <p className="text-2xl font-bold">{data?.recovery_pending ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">recovery questions pending</p>
          {(data?.weak_concepts ?? []).length > 0 && (
            <div className="mt-3 space-y-1">
              {(data?.weak_concepts ?? []).slice(0, 3).map((c: { concept: string; mastery_score: number }, i: number) => (
                <div key={i} className="text-xs flex justify-between"><span>{c.concept}</span><span>{Math.round(c.mastery_score)}%</span></div>
              ))}
            </div>
          )}
          <Button size="sm" className="mt-3" asChild><Link to="/student/recovery">Fix my mistakes</Link></Button>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link to="/student/recovery" className="block">
          <Card className="p-4 hover:shadow-elevated transition-shadow h-full">
            <Wrench className="w-5 h-5 text-primary mb-2" />
            <div className="font-semibold">Recovery zone</div>
            <p className="text-xs text-muted-foreground mt-1">{data?.recovery_pending ?? 0} to fix</p>
          </Card>
        </Link>
        <Link to="/student/plans" className="block">
          <Card className="p-4 hover:shadow-elevated transition-shadow h-full">
            <Sparkles className="w-5 h-5 text-primary mb-2" />
            <div className="font-semibold">Improvement plans</div>
            <p className="text-xs text-muted-foreground mt-1">Steps per weak topic</p>
          </Card>
        </Link>
        <Link to="/student/mistakes" className="block">
          <Card className="p-4 hover:shadow-elevated transition-shadow h-full">
            <BookMarked className="w-5 h-5 text-primary mb-2" />
            <div className="font-semibold">Mistake book</div>
            <p className="text-xs text-muted-foreground mt-1">{data?.mistake_count ?? 0} to review</p>
          </Card>
        </Link>
        <Link to="/student/revision" className="block">
          <Card className="p-4 hover:shadow-elevated transition-shadow h-full">
            <ListChecks className="w-5 h-5 text-primary mb-2" />
            <div className="font-semibold">Revision queue</div>
            <p className="text-xs text-muted-foreground mt-1">{(data?.revision_queue ?? []).length} items</p>
          </Card>
        </Link>
        <Link to="/student/leaderboard" className="block">
          <Card className="p-4 hover:shadow-elevated transition-shadow h-full">
            <Trophy className="w-5 h-5 text-primary mb-2" />
            <div className="font-semibold">Leaderboard</div>
            <p className="text-xs text-muted-foreground mt-1">Class & school ranks</p>
          </Card>
        </Link>
      </div>
    </>
  );
}
