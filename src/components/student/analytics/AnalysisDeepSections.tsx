import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";
import type {
  AnalyticsInsights,
  MistakeTopicAggregate,
  MomentumSignal,
  StudyPlanItem,
  TopicGapInsight,
} from "@/lib/analyticsInsights";
import { FlowSectionTitle } from "@/components/student/flow/FlowDesign";
import { AlertTriangle, BookOpen, Calendar, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { displayChapter, displayConcept, displayTopic, displaySubject } from "@/lib/academicDisplay";

function severityBadge(severity: TopicGapInsight["severity"]) {
  const styles = {
    critical: "bg-red-100 text-red-800 border-red-200",
    moderate: "bg-orange-100 text-orange-900 border-orange-200",
    mild: "bg-amber-50 text-amber-900 border-amber-200",
  };
  const labels = { critical: "Critical", moderate: "Moderate", mild: "Mild" };
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border", styles[severity])}>
      {labels[severity]}
    </span>
  );
}

function clipText(text: string | undefined, max = 120) {
  if (!text) return "Not enough attempts yet.";
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

export function DiagnosisBanner({ insights }: { insights: AnalyticsInsights | null }) {
  if (!insights?.headline && !insights?.diagnosis) return null;
  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-5 sm:p-6 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Full diagnosis</p>
      {insights.headline && (
        <h2 className="text-lg sm:text-xl font-semibold text-foreground mt-1 leading-snug">{insights.headline}</h2>
      )}
      {insights.summary && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{insights.summary}</p>}
      {insights.diagnosis && (
        <p className="text-sm text-foreground/90 mt-3 leading-relaxed border-t border-border/50 pt-3">
          {insights.diagnosis}
        </p>
      )}
      {insights.today_focus && (
        <div className="mt-4 rounded-xl bg-primary/10 border border-primary/15 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Today&apos;s focus</p>
          <p className="text-sm font-medium text-foreground mt-1">{insights.today_focus}</p>
        </div>
      )}
    </section>
  );
}

type WisdomVariant = { variant?: "default" | "wisdom" };

export function TopicDeepCards({ topics, variant = "default" }: { topics: TopicGapInsight[] } & WisdomVariant) {
  if (topics.length === 0) return null;
  const isWisdom = variant === "wisdom";
  if (isWisdom) {
    return (
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h3 className="wa-headline text-lg">Focus topics</h3>
            <p className="wa-body text-sm mt-1">Short, readable reasons and one clear fix per weak spot.</p>
          </div>
          <span className="wa-label rounded-full bg-white/80 border border-[var(--wa-outline-variant)] px-3 py-1">
            {topics.length} topic{topics.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          {topics.map((t, i) => (
            <article key={`${t.subject}-${t.chapter}-${t.topic}-${i}`} className={`wa-topic-card severity-${t.severity}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[var(--wa-on-surface)] truncate">{displayTopic(t.topic)}</h3>
                  <p className="text-xs text-[var(--wa-on-surface-variant)] mt-0.5 truncate">
                    {displayChapter(t.chapter)} · {displaySubject(t.subject)}
                  </p>
                </div>
                {severityBadge(t.severity)}
              </div>

              <div className="mt-4 grid gap-3">
                <div className="wa-topic-mini-card">
                  <p className="wa-label text-[10px]">Why it slipped</p>
                  <p className="text-sm font-medium leading-snug mt-1">{clipText(t.why_weak, 105)}</p>
                </div>
                <div className="wa-topic-mini-card">
                  <p className="wa-label text-[10px]">Do this next</p>
                  <p className="text-sm font-medium leading-snug mt-1">{clipText(t.fix_hint, 105)}</p>
                </div>
              </div>

              {t.misconception && (
                <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-950">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{clipText(t.misconception, 90)}</span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full bg-[var(--wa-surface-low)] px-2 py-1 text-[var(--wa-on-surface-variant)]">
                  {t.mistake_count} mistake{t.mistake_count === 1 ? "" : "s"}
                </span>
                {t.ncert_ref && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-800">
                    <BookOpen className="w-3 h-3" /> {t.ncert_ref}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <>
        <FlowSectionTitle>Topic-by-topic breakdown</FlowSectionTitle>
        <p className="text-xs text-muted-foreground mb-4 -mt-1">
          Every weak spot traced to NCERT — why it slipped, what to fix, and drills to run today.
        </p>
      </>
      <div className="space-y-4">
        {topics.map((t, i) => (
          <article
            key={`${t.subject}-${t.chapter}-${t.topic}-${i}`}
            className={cn(
              isWisdom ? `wa-deep-card severity-${t.severity}` : "rounded-2xl border border-border/60 bg-card p-5 shadow-sm",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-foreground">{displayTopic(t.topic)}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {displayChapter(t.chapter)} · {displaySubject(t.subject)}
                  {t.concept ? ` · ${displayConcept(t.concept)}` : ""}
                </p>
              </div>
              {severityBadge(t.severity)}
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Why weak</p>
                <p className="mt-1 text-foreground/90 leading-relaxed">{t.why_weak}</p>
              </div>
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Root cause</p>
                <p className="mt-1 text-foreground/90 leading-relaxed">{t.root_cause}</p>
              </div>
            </div>

            {t.misconception && (
              <p className="mt-3 text-sm flex gap-2 text-orange-900 bg-orange-50/80 border border-orange-100 rounded-xl px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium">Likely slip: </span>
                  {t.misconception}
                </span>
              </p>
            )}

            {t.evidence && (
              <p className="mt-2 text-xs text-muted-foreground italic leading-relaxed">&ldquo;{t.evidence}&rdquo;</p>
            )}

            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fix plan</p>
              <p className="text-sm text-foreground mt-1 leading-relaxed">{t.fix_hint}</p>
            </div>

            {t.micro_drills && t.micro_drills.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {t.micro_drills.map((d, j) => (
                  <li key={j} className="flex gap-2 text-sm text-foreground/85">
                    <span className="text-primary font-semibold tabular-nums">{j + 1}.</span>
                    {d}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span>{t.mistake_count} mistake{t.mistake_count === 1 ? "" : "s"} logged</span>
              {t.error_pattern && <span>· {t.error_pattern}</span>}
              {t.ncert_ref && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <BookOpen className="w-3 h-3" /> {t.ncert_ref}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MistakeTopicTable({ aggregates, variant = "default" }: { aggregates: MistakeTopicAggregate[] } & WisdomVariant) {
  if (aggregates.length === 0) return null;
  const isWisdom = variant === "wisdom";
  return (
    <section>
      {isWisdom ? (
        <h3 className="wa-headline text-lg mb-3">Mistake log by topic</h3>
      ) : (
        <FlowSectionTitle>Mistake log by topic</FlowSectionTitle>
      )}
      <div className={cn(isWisdom ? "wa-card overflow-hidden p-0" : "rounded-2xl border border-border/60 overflow-hidden shadow-sm")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Topic</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chapter</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mistakes</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Your pick</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Correct</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {aggregates.slice(0, 12).map((a, i) => (
                <tr key={`${a.topic}-${i}`} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium text-foreground">{displayTopic(a.topic)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.chapter ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{a.mistake_count}</td>
                  <td className="px-4 py-3 text-orange-800 hidden sm:table-cell max-w-[140px] truncate">
                    {a.sample_wrong ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-emerald-800 hidden sm:table-cell max-w-[140px] truncate">
                    {a.sample_correct ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function WeeklyStudyPlan({ plan, variant = "default" }: { plan: StudyPlanItem[] } & WisdomVariant) {
  if (plan.length === 0) return null;
  const isWisdom = variant === "wisdom";
  return (
    <section>
      {isWisdom ? (
        <h3 className="wa-headline text-lg mb-3">This week&apos;s study plan</h3>
      ) : (
        <FlowSectionTitle>This week&apos;s study plan</FlowSectionTitle>
      )}
      <div className="space-y-2">
        {plan.map((item) => (
          <div
            key={item.priority}
            className={cn(
              "flex gap-4 p-4",
              isWisdom ? "wa-card" : "rounded-2xl border border-border/60 bg-card shadow-sm",
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-sm">
              {item.priority}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-foreground">{displayTopic(item.topic)}</p>
                <span className="text-[10px] text-muted-foreground">{displayChapter(item.chapter)}</span>
              </div>
              <p className="text-sm text-foreground/85 mt-1 leading-relaxed">{item.action}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> ~{item.time_minutes} min · {item.subject}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MomentumRow({ signal, variant = "default" }: { signal: MomentumSignal } & WisdomVariant) {
  const improving = signal.direction === "improving";
  const isWisdom = variant === "wisdom";
  return (
    <div className={cn(
      "flex gap-3 px-4 py-3",
      isWisdom ? "wa-card" : "rounded-xl border border-border/50 bg-card",
    )}>
      {improving ? (
        <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
      ) : (
        <TrendingDown className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
      )}
      <div>
        <p className="text-sm font-medium text-foreground">
          {displayTopic(signal.topic)}
          <span className="text-muted-foreground font-normal"> · {signal.subject}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{signal.note}</p>
      </div>
    </div>
  );
}

export function MomentumSection({ signals, variant = "default" }: { signals: MomentumSignal[] } & WisdomVariant) {
  if (signals.length === 0) return null;
  const isWisdom = variant === "wisdom";
  return (
    <section>
      {isWisdom ? (
        <h3 className="wa-headline text-lg mb-3">Momentum — what&apos;s shifting</h3>
      ) : (
        <FlowSectionTitle>Momentum — what&apos;s shifting</FlowSectionTitle>
      )}
      <div className="space-y-2">
        {signals.map((s, i) => (
          <MomentumRow key={`${s.topic}-${i}`} signal={s} variant={variant} />
        ))}
      </div>
    </section>
  );
}

export function SessionLog({ sessions, variant = "default" }: { sessions: PracticeSessionSummary[] } & WisdomVariant) {
  if (sessions.length === 0) return null;
  const isWisdom = variant === "wisdom";
  return (
    <section>
      {isWisdom ? (
        <h3 className="wa-headline text-lg mb-3">Recent practice sessions</h3>
      ) : (
        <FlowSectionTitle>Recent practice sessions</FlowSectionTitle>
      )}
      <div className="space-y-2">
        {sessions.slice(0, 8).map((s) => {
          const date = new Date(s.finished_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm",
                isWisdom ? "wa-card" : "rounded-xl border border-border/50 bg-card",
              )}
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">
                  {s.chapter ? `${s.chapter}` : "Practice session"}
                  {s.subject ? ` · ${s.subject}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="w-3 h-3" /> {date} · {s.duration_minutes}m
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className={cn("font-semibold", s.accuracy_pct >= 70 ? "text-emerald-700" : s.accuracy_pct >= 50 ? "text-foreground" : "text-orange-700")}>
                  {s.accuracy_pct}%
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {s.correct_count}/{s.question_count} correct
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SubjectBreakdown({ subjects }: { subjects: SubjectChartPoint[] }) {
  if (subjects.length === 0) return null;
  return (
    <section>
      <FlowSectionTitle>Subject accuracy</FlowSectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        {subjects.map((s) => (
          <div key={s.name} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex justify-between items-baseline">
              <p className="font-semibold text-foreground">{s.name}</p>
              <p className={cn("text-xl font-bold tabular-nums", s.accuracy >= 75 ? "text-emerald-700" : s.accuracy >= 55 ? "text-foreground" : "text-orange-700")}>
                {Math.round(s.accuracy)}%
              </p>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", s.accuracy >= 75 ? "bg-emerald-500" : s.accuracy >= 55 ? "bg-primary" : "bg-orange-500")}
                style={{ width: `${Math.min(100, s.accuracy)}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">{s.attempts} attempts logged</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RecurringErrorsSection({
  errors,
  patterns,
}: {
  errors: AnalyticsInsights["recurring_errors"];
  patterns: string[];
}) {
  const items = [
    ...errors.map((e) => e.label),
    ...patterns.filter((p) => !errors.some((e) => e.label === p)),
  ].slice(0, 6);
  if (items.length === 0) return null;
  return (
    <section>
      <FlowSectionTitle>Recurring error patterns</FlowSectionTitle>
      <ul className="space-y-2">
        {items.map((label, i) => (
          <li
            key={i}
            className="text-sm text-foreground/90 rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-2.5 leading-relaxed"
          >
            {label}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground mt-3">
        <Link to="/student/recovery" className="text-primary font-medium hover:underline">
          Open Recovery
        </Link>{" "}
        to fix questions tied to these patterns.
      </p>
    </section>
  );
}
