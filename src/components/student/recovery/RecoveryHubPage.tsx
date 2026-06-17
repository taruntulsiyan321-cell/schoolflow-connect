import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Circle,
  Flag,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Wrench,
  Zap,
} from "lucide-react";
import "./recovery-hub.css";
import "../dashboard/student-dashboard.css";

export type RecoveryPriority = {
  rank: number;
  concept: string;
  subject: string;
  accuracy: number;
  mastery: number;
  questionsAssigned: number;
};

export type RecoveryTask = {
  id: string;
  concept: string;
  subject: string;
  currentMastery: number;
  targetMastery: number;
  questionsAssigned: number;
  estimatedImprovement: string;
};

export type FixedConcept = {
  concept: string;
  subject: string;
  improvement: string;
};

export type HeatMapItem = {
  concept: string;
  subject: string;
  level: "strong" | "moderate" | "critical";
  mastery: number;
};

export type JourneyStage = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
};

export type RecoveryHubProps = {
  pending: number;
  potentialImprovement: string;
  weakConcepts: string[];
  priorities: RecoveryPriority[];
  tasks: RecoveryTask[];
  fixedConcepts: FixedConcept[];
  journey: JourneyStage[];
  forecast: { accuracy: [number, number]; mastery: [number, number] };
  heatMap: HeatMapItem[];
  coachTitle: string;
  coachBody: string;
  fixing?: boolean;
  onFixMistakes: () => void;
  onStartRecovery: (assignmentId: string) => void;
};

const heatStyles = {
  strong: "rh-heat-strong text-emerald-800",
  moderate: "rh-heat-moderate text-amber-800",
  critical: "rh-heat-critical text-red-800",
};

const heatDots = {
  strong: "bg-emerald-500",
  moderate: "bg-amber-500",
  critical: "bg-red-500",
};

export function RecoveryHubPage({
  pending,
  potentialImprovement,
  weakConcepts,
  priorities,
  tasks,
  fixedConcepts,
  journey,
  forecast,
  heatMap,
  coachTitle,
  coachBody,
  fixing,
  onFixMistakes,
  onStartRecovery,
}: RecoveryHubProps) {
  return (
    <div className="recovery-hub student-premium space-y-8 px-1 sm:px-0">
      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="rh-hero rounded-[2rem] overflow-hidden relative text-primary-foreground">
        <div className="rh-hero-glow absolute inset-0 pointer-events-none" />
        <div className="relative z-10 p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8">
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary-foreground/70">
                Personal improvement center
              </p>
              <h1 className="font-['Sora'] text-3xl sm:text-4xl font-semibold mt-2 tracking-tight">
                Recovery Center
              </h1>
              <p className="text-sm text-primary-foreground/75 mt-2 max-w-lg">
                Turn weaknesses into mastery — guided recovery, not just mistake lists.
              </p>

              <div className="grid sm:grid-cols-2 gap-4 mt-8 max-w-xl">
                <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm p-5">
                  <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">
                    Recovery questions pending
                  </p>
                  <p className="text-4xl sm:text-5xl font-bold mt-2 tabular-nums">{pending}</p>
                </div>
                <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm p-5">
                  <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">
                    Potential accuracy gain
                  </p>
                  <p className="text-3xl sm:text-4xl font-bold mt-2 text-[#e8c468] flex items-center gap-2">
                    <TrendingUp className="w-8 h-8" />
                    {potentialImprovement}
                  </p>
                </div>
              </div>

              {weakConcepts.length > 0 && (
                <div className="mt-6">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/65 mb-2">
                    Weak concepts
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {weakConcepts.slice(0, 6).map((c) => (
                      <span
                        key={c}
                        className="text-sm font-medium px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/20"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 w-full lg:w-auto flex flex-col items-center lg:items-end">
              <div className="hidden lg:flex w-32 h-32 rounded-full bg-white/10 items-center justify-center mb-6 ring-1 ring-white/15">
                <Wrench className="w-14 h-14 text-[#e8c468]" />
              </div>
              <Button
                size="lg"
                disabled={fixing}
                className="rounded-2xl h-14 px-10 text-base font-semibold bg-[#e8c468] hover:bg-[#f0d080] text-[#003324] shadow-xl w-full lg:w-auto"
                onClick={onFixMistakes}
              >
                {fixing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Starting…
                  </>
                ) : (
                  <>
                    Fix My Mistakes <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 justify-center sm:justify-start -mt-2">
        <Button variant="outline" size="sm" className="rounded-full" asChild>
          <Link to="/student/revision">Revision center</Link>
        </Button>
        <Button variant="outline" size="sm" className="rounded-full" asChild>
          <Link to="/student/analytics">View insights</Link>
        </Button>
        <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" asChild>
          <Link to="/student/mistakes">Mistake book</Link>
        </Button>
      </div>

      {/* ── PRIORITIES ─────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Recovery priorities"
          subtitle="Concepts ranked by impact — tackle these first."
        />
        <div className="space-y-3">
          {priorities.map((p) => (
            <div key={p.rank} className="rh-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div
                  className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-bold text-lg",
                    p.rank === 1
                      ? "bg-orange-500/15 text-orange-700"
                      : p.rank === 2
                        ? "bg-amber-500/15 text-amber-800"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {p.rank}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground">{p.concept}</p>
                    <Badge variant="outline" className="text-[10px]">
                      Priority {p.rank}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{p.subject}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 sm:gap-6 text-center sm:text-left">
                <MiniStat label="Accuracy" value={`${p.accuracy}%`} warn={p.accuracy < 50} />
                <MiniStat label="Mastery" value={`${p.mastery}%`} />
                <MiniStat label="Questions" value={String(p.questionsAssigned)} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── AI COACH ───────────────────────────────────────── */}
      <section className="rh-coach rounded-[1.75rem] p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <Brain className="w-7 h-7 text-blue-600" />
          </div>
          <div className="flex-1">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-blue-200 text-blue-700 mb-2">
              AI recovery coach
            </Badge>
            <h3 className="font-['Sora'] text-xl font-semibold text-foreground">{coachTitle}</h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">{coachBody}</p>
            <Button size="sm" className="mt-4 rounded-full" onClick={onFixMistakes} disabled={fixing}>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Start today&apos;s plan
            </Button>
          </div>
        </div>
      </section>

      {/* ── JOURNEY ────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Your recovery journey" subtitle="From weakness to mastery — track your path." />
        <div className="rh-card rounded-3xl p-6 sm:p-8">
          <div className="hidden sm:block h-1.5 rh-journey-line rounded-full mb-8 opacity-60" />
          <div className="grid sm:grid-cols-4 gap-6">
            {journey.map((stage, i) => (
              <div key={stage.id} className="relative flex sm:flex-col items-start sm:items-center gap-3 sm:text-center">
                {i < journey.length - 1 && (
                  <div className="sm:hidden absolute left-5 top-10 bottom-0 w-px bg-border" />
                )}
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10",
                    stage.done
                      ? "bg-emerald-500 text-white"
                      : stage.active
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {stage.done ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                </div>
                <div>
                  <p className={cn("text-sm font-semibold", stage.active && "text-primary")}>{stage.label}</p>
                  {stage.active && (
                    <p className="text-xs text-primary/80 mt-0.5">You are here</p>
                  )}
                </div>
                {i < journey.length - 1 && (
                  <ArrowRight className="hidden sm:block absolute top-4 -right-3 w-4 h-4 text-muted-foreground/40" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TASKS ──────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Recovery tasks" subtitle="Focused sessions to close your gaps." />
        <div className="grid md:grid-cols-2 gap-4">
          {tasks.map((t) => (
            <div key={t.id} className="rh-task rh-card rounded-2xl p-6 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="font-semibold text-lg text-foreground">{t.concept}</p>
                  <p className="text-sm text-muted-foreground">{t.subject}</p>
                </div>
                <Flag className="w-5 h-5 text-amber-600 shrink-0" />
              </div>
              <div className="space-y-3 flex-1">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Mastery progress</span>
                    <span className="font-semibold tabular-nums">
                      {t.currentMastery}% → {t.targetMastery}%
                    </span>
                  </div>
                  <Progress value={t.currentMastery} className="h-2 [&>div]:bg-primary" />
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    <span className="text-muted-foreground">Questions: </span>
                    <span className="font-semibold">{t.questionsAssigned}</span>
                  </span>
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" />
                    {t.estimatedImprovement}
                  </span>
                </div>
              </div>
              <Button className="mt-5 rounded-xl w-full font-semibold" onClick={() => onStartRecovery(t.id)}>
                Start Recovery
              </Button>
            </div>
          ))}
        </div>
        {tasks.length === 0 && (
          <div className="rh-card rounded-3xl p-10 text-center">
            <Target className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-50" />
            <p className="font-medium">No recovery tasks yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete practice — weak concepts auto-generate recovery work here.
            </p>
            <Button className="mt-4 rounded-full" asChild>
              <Link to="/student/practice/math12">Go to Practice</Link>
            </Button>
          </div>
        )}
      </section>

      {/* ── SUCCESS ────────────────────────────────────────── */}
      {fixedConcepts.length > 0 && (
        <section className="rh-success rounded-[1.75rem] p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-5">
            <Trophy className="w-6 h-6 text-emerald-700" />
            <div>
              <h2 className="font-['Sora'] text-xl font-semibold text-foreground">Recovery wins</h2>
              <p className="text-sm text-muted-foreground">Concepts you&apos;ve strengthened — keep it up!</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {fixedConcepts.map((f) => (
              <div
                key={f.concept}
                className="rounded-2xl bg-white/80 border border-emerald-200/50 p-4 shadow-sm"
              >
                <p className="font-semibold text-foreground">{f.concept}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{f.subject}</p>
                <p className="text-sm font-semibold text-emerald-700 mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  {f.improvement}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── FORECAST + HEAT MAP ────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rh-forecast rounded-[1.75rem] p-6 sm:p-8 text-primary-foreground">
          <p className="text-xs uppercase tracking-wider text-primary-foreground/65">Improvement forecast</p>
          <h2 className="font-['Sora'] text-xl font-semibold mt-1">Projected gains</h2>
          <p className="text-sm text-primary-foreground/75 mt-2 mb-6">
            Complete today&apos;s recovery plan to unlock these improvements.
          </p>
          <div className="space-y-5">
            <ForecastRow
              label="Accuracy"
              from={forecast.accuracy[0]}
              to={forecast.accuracy[1]}
            />
            <ForecastRow
              label="Concept mastery"
              from={forecast.mastery[0]}
              to={forecast.mastery[1]}
            />
          </div>
        </section>

        <section>
          <SectionHeader title="Recovery heat map" subtitle="Where your attention matters most." />
          <div className="rh-card rounded-2xl p-5 space-y-2 max-h-[280px] overflow-y-auto">
            {heatMap.map((h) => (
              <div
                key={h.concept}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
                  heatStyles[h.level],
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", heatDots[h.level])} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{h.concept}</p>
                    <p className="text-[10px] opacity-70">{h.subject}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold tabular-nums">{h.mastery}%</p>
                  <p className="text-[10px] capitalize opacity-70">{h.level}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Strong
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Moderate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Critical
            </span>
          </div>
        </section>
      </div>

      <div className="flex justify-center pt-2">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
          <Link to="/student">← Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-['Sora'] text-lg sm:text-xl font-semibold text-foreground tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold tabular-nums", warn && "text-orange-700")}>{value}</p>
    </div>
  );
}

function ForecastRow({ label, from, to }: { label: string; from: number; to: number }) {
  return (
    <div>
      <p className="text-sm text-primary-foreground/80 mb-2">{label}</p>
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold tabular-nums">{from}%</span>
        <ArrowRight className="w-5 h-5 text-[#e8c468]" />
        <span className="text-2xl font-bold tabular-nums text-[#e8c468]">{to}%</span>
        <span className="text-xs ml-auto bg-white/15 px-2 py-1 rounded-full">
          +{to - from}%
        </span>
      </div>
    </div>
  );
}
