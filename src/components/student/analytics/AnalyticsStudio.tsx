import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { clipInsightText } from "@/lib/analyticsInsights";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card p-4 shadow-sm", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ConceptTag({
  label,
  meta,
  variant,
}: {
  label: string;
  meta?: string;
  variant: "strong" | "weak";
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left max-w-full",
        variant === "strong"
          ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-900"
          : "bg-orange-50/80 border-orange-200/80 text-orange-950",
      )}
    >
      <span className="text-sm font-medium truncate">{label}</span>
      {meta && <span className="text-[10px] opacity-70 truncate">{meta}</span>}
    </span>
  );
}

export function AnalyticsStudio({ data, charts }: Props) {
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery, loading: masteryLoading } = useConceptMastery();
  const { data: recovery, loading: recoveryLoading } = useRecoveryZone();
  const { insights, enhancing, loading: insightsLoading } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const score = readiness?.score ?? 0;
  const xp = data.xp?.xp ?? 0;
  const rank = pageData?.class_rank;
  const timeMin = pageData?.totals.last_session_minutes;

  const strongConcepts = mastery
    .filter((m) => m.mastery_score >= 72 && m.mistake_count <= 1)
    .slice(0, 6);
  const weakConcepts = mastery
    .filter((m) => m.mastery_score < 62 || m.mistake_count >= 2)
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 6);

  const snapshotStrong = (data.strong_topics ?? []).slice(0, 4);
  const snapshotWeak = (data.weak_topics ?? []).slice(0, 4);

  const coachLines: string[] = [];
  const strongInsight = insights?.strong_concepts?.[0];
  const weakInsight = insights?.weak_topics?.[0];
  if (strongInsight) {
    coachLines.push(`You perform well in ${strongInsight.concept.toLowerCase()} questions.`);
  } else if (strongConcepts[0]) {
    coachLines.push(`You perform well in ${strongConcepts[0].concept.toLowerCase()}.`);
  }
  if (weakInsight) {
    coachLines.push(`You struggled with ${weakInsight.topic.toLowerCase()}.`);
  } else if (weakConcepts[0]) {
    coachLines.push(`Focus on ${weakConcepts[0].concept.toLowerCase()} — ${weakConcepts[0].mistake_count} recent mistakes.`);
  }
  if (insights?.recurring_errors?.[0]) {
    coachLines.push(clipInsightText(insights.recurring_errors[0].label, 72));
  } else if (insights?.today_focus) {
    coachLines.push(clipInsightText(insights.today_focus, 90));
  }
  const coachBullets = coachLines.slice(0, 3);

  const recoveryCount =
    recovery?.pending_count ??
    data.recovery_pending ??
    data.mistake_count ??
    0;
  const weakTags =
    recovery?.weak_concepts?.slice(0, 5) ??
    weakConcepts.map((c) => ({
      concept: c.concept,
      subject: c.subject,
      chapter: c.chapter,
      mastery_score: c.mastery_score,
    }));

  const trend = pageData?.trend;
  const practiceTrend = charts?.practice_trend ?? [];
  const prevAcc = trend?.previous_accuracy ?? practiceTrend.at(-2)?.score_pct ?? null;
  const currAcc = trend?.current_accuracy ?? practiceTrend.at(-1)?.score_pct ?? readiness?.accuracy_pct ?? null;
  const improvement =
    trend?.improvement_pct ??
    (prevAcc != null && currAcc != null ? Math.round((currAcc - prevAcc) * 10) / 10 : null);

  const totals = pageData?.totals;
  const correct = totals?.correct ?? 0;
  const wrong = totals?.wrong ?? data.mistake_count ?? 0;
  const accuracy = totals?.accuracy_pct ?? readiness?.accuracy_pct ?? 0;
  const speed = totals?.avg_sec_per_question;

  const busy = pageLoading || masteryLoading || recoveryLoading;

  if (busy && !pageData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your analysis…</p>
      </div>
    );
  }

  return (
    <div className="analysis-page-view space-y-8 pb-4">
      {/* §1 Hero */}
      <section className="rounded-3xl overflow-hidden shadow-elevated bg-gradient-to-br from-primary via-primary to-primary/90 text-primary-foreground p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
          Session summary
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold mt-2 tracking-tight">How did you perform?</h1>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-8">
          {[
            { label: "Score", value: `${score}%` },
            { label: "Accuracy", value: `${readiness?.accuracy_pct ?? accuracy}%` },
            { label: "Time", value: timeMin != null ? `${timeMin}m` : "—" },
            { label: "Rank", value: rank ? `#${rank}` : "—" },
            { label: "XP", value: xp.toLocaleString() },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl bg-white/10 ring-1 ring-white/15 px-4 py-3 backdrop-blur-sm">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">{item.label}</p>
              <p className="text-xl sm:text-2xl font-semibold mt-1 tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* §2 Performance overview */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Performance overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Correct" value={correct} />
          <StatTile label="Wrong" value={wrong} />
          <StatTile label="Accuracy" value={`${accuracy}%`} />
          <StatTile
            label="Speed"
            value={speed != null ? `${speed}s` : "—"}
            sub={speed != null ? "per question" : undefined}
          />
        </div>
      </section>

      {/* §3 Concept breakdown */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">What did you get wrong?</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5 mb-3">
              <CheckCircle2 className="w-4 h-4" /> Strong concepts
            </p>
            <div className="flex flex-wrap gap-2">
              {strongConcepts.length === 0 && snapshotStrong.length === 0 ? (
                <p className="text-sm text-muted-foreground">Practice more to unlock strengths.</p>
              ) : (
                <>
                  {strongConcepts.map((c) => (
                    <ConceptTag
                      key={`${c.subject}-${c.concept}`}
                      label={c.concept}
                      meta={`${Math.round(c.mastery_score)}% · ${c.subject}`}
                      variant="strong"
                    />
                  ))}
                  {strongConcepts.length === 0 &&
                    snapshotStrong.map((t, i) => (
                      <ConceptTag
                        key={i}
                        label={t.topic ?? t.chapter ?? t.subject}
                        meta={`${Math.round(t.accuracy)}% accuracy`}
                        variant="strong"
                      />
                    ))}
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-700 flex items-center gap-1.5 mb-3">
              <Target className="w-4 h-4" /> Needs improvement
            </p>
            <div className="flex flex-wrap gap-2">
              {weakConcepts.length === 0 && snapshotWeak.length === 0 && !weakInsight ? (
                <p className="text-sm text-muted-foreground">No weak spots flagged yet — keep going.</p>
              ) : (
                <>
                  {weakInsight && (
                    <ConceptTag
                      label={weakInsight.topic}
                      meta={weakInsight.chapter}
                      variant="weak"
                    />
                  )}
                  {weakConcepts.map((c) => (
                    <ConceptTag
                      key={`${c.subject}-${c.concept}`}
                      label={c.concept}
                      meta={`${c.mistake_count} mistakes · ${c.subject}`}
                      variant="weak"
                    />
                  ))}
                  {weakConcepts.length === 0 &&
                    snapshotWeak.map((t, i) => (
                      <ConceptTag
                        key={i}
                        label={t.topic ?? t.chapter ?? t.subject}
                        meta={`${Math.round(t.accuracy)}% accuracy`}
                        variant="weak"
                      />
                    ))}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* §4 Study coach */}
      <section className="rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/30 p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your coach</p>
            <h2 className="text-lg font-semibold text-foreground mt-0.5">What should you do next?</h2>
            {insightsLoading || enhancing ? (
              <p className="text-sm text-muted-foreground mt-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Personalising tips…
              </p>
            ) : coachBullets.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {coachBullets.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-foreground/90 leading-relaxed">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground mt-3">
                Complete a practice session — your coach will highlight patterns from your mistakes.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* §5 Recovery zone — dominant */}
      <section className="rounded-3xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-orange-50/40 p-6 sm:p-8 shadow-elevated">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Recovery zone</p>
            <h2 className="text-2xl sm:text-3xl font-semibold text-foreground mt-1 tracking-tight">
              Fix what you missed
            </h2>
            <div className="flex flex-wrap gap-6 mt-5">
              <div>
                <p className="text-3xl font-bold text-foreground tabular-nums">{recoveryCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Recovery questions available</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Weak concepts
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {weakTags.length === 0 ? (
                    <span className="text-sm text-muted-foreground">None right now</span>
                  ) : (
                    weakTags.map((w, i) => (
                      <span
                        key={i}
                        className="text-xs font-medium px-2.5 py-1 rounded-full bg-white border border-orange-200 text-orange-900"
                      >
                        {w.concept}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
          <Button
            size="lg"
            className="rounded-2xl h-14 px-8 text-base font-semibold shadow-lg shrink-0 w-full sm:w-auto"
            asChild
          >
            <Link to="/student/recovery">
              Fix my mistakes <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
          </Button>
        </div>
      </section>

      {/* §6 Improvement trend */}
      <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground mb-4">Improvement trend</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Previous</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-muted-foreground">
              {prevAcc != null ? `${prevAcc}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">session accuracy</p>
          </div>
          <div className="flex flex-col items-center justify-center">
            {improvement != null ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-sm font-semibold px-3 py-1 rounded-full",
                  improvement >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800",
                )}
              >
                {improvement >= 0 ? (
                  <ArrowUpRight className="w-4 h-4" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                {improvement > 0 ? "+" : ""}
                {improvement}%
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
            <p className="text-[10px] text-muted-foreground mt-2">change</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Current</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-foreground">
              {currAcc != null ? `${currAcc}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">session accuracy</p>
          </div>
        </div>
      </section>

      <div className="flex justify-center pt-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <Link to="/student/practice/math12">
            <Clock className="w-4 h-4 mr-1.5" /> Start another session
          </Link>
        </Button>
      </div>
    </div>
  );
}
