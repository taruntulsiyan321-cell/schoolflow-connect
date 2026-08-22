import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAcademicCoach } from "@/hooks/useAcademicCoach";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import {
  buildRuleAnalyticsInsights,
  clipInsightText,
  formatLastSeen,
  resolveTopicGaps,
  type MistakeTopicAggregate,
} from "@/lib/analyticsInsights";
import { classifyMistakes } from "@/components/student/analytics/wisdom/analyticsDerived";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import {
  averageConceptMastery,
  practiceAccuracyFromSnapshot,
  studyActiveDaysFromSnapshot,
} from "@/lib/learningMetrics";
import { preferRealAcademicLabel } from "@/lib/qualityGuards";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ClipboardList,
  Gauge,
  LineChart,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Wrench,
} from "lucide-react";
import "./wisdom/wisdom-analytics.css";
import { displayChapter, displayConcept, displaySubject, displayTopic } from "@/lib/academicDisplay";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "emerald",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Target;
  tone?: "emerald" | "gold" | "blue" | "red";
}) {
  return (
    <div className={`wa-intel-card tone-${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="wa-label">{label}</p>
          <p className="text-3xl font-bold tabular-nums mt-2 text-[var(--wa-on-surface)]">{value}</p>
          {sub && <p className="text-xs text-[var(--wa-on-surface-variant)] mt-1">{sub}</p>}
        </div>
        <div className="wa-intel-icon">
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ value, tone = "emerald" }: { value: number; tone?: "emerald" | "gold" | "red" }) {
  return (
    <div className="h-2 rounded-full bg-[var(--wa-surface-variant)] overflow-hidden">
      <div className={`h-full rounded-full wa-bar-${tone}`} style={{ width: `${clamp(value)}%` }} />
    </div>
  );
}

function miniTrendValue(values: number[]) {
  if (values.length < 2) return 0;
  return clamp(values[values.length - 1] - values[0], -40, 40);
}

function groupMasteryBySubject(mastery: ConceptMasteryItem[]) {
  const grouped = new Map<string, Map<string, ConceptMasteryItem[]>>();
  for (const item of mastery) {
    const subject = displaySubject(item.subject);
    const chapter = displayChapter(item.chapter);
    if (!subject || !chapter) continue;
    if (!grouped.has(subject)) grouped.set(subject, new Map());
    const byChapter = grouped.get(subject)!;
    if (!byChapter.has(chapter)) byChapter.set(chapter, []);
    byChapter.get(chapter)!.push(item);
  }
  return grouped;
}

function repeatedMistake(aggregates: MistakeTopicAggregate[]) {
  return [...aggregates].sort((a, b) => b.mistake_count - a.mistake_count)[0];
}

export function AnalyticsStudio({ data, charts }: Props) {
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery } = useConceptMastery();
  const { data: recovery } = useRecoveryZone();
  const {
    insights,
    aggregates: liveAggregates,
    enhancing,
    loading: insightsLoading,
    coachLive,
    error: coachError,
    reload: reloadCoach,
  } = useAcademicCoach(data);

  const ruleFallback =
    liveAggregates.length > 0 ? buildRuleAnalyticsInsights(liveAggregates, mastery, data) : null;
  const displayInsights = insights ?? ruleFallback;

  const aggregates = liveAggregates;
  const topicGaps = resolveTopicGaps(displayInsights, aggregates);
  const displayMastery = mastery;

  const totals = pageData?.totals;
  const accuracy = totals?.accuracy_pct ?? practiceAccuracyFromSnapshot(data) ?? 0;
  const conceptMastery = averageConceptMastery(displayMastery) ?? 0;
  const weakConceptCount = topicGaps.length;

  const trend = pageData?.trend;
  const practiceTrend = charts?.practice_trend ?? [];
  const improvement =
    trend?.improvement_pct ??
    (() => {
      const prev = trend?.previous_accuracy ?? practiceTrend.at(-2)?.score_pct;
      const curr = trend?.current_accuracy ?? practiceTrend.at(-1)?.score_pct;
      return prev != null && curr != null ? Math.round((curr - prev) * 10) / 10 : null;
    })();

  const topGap = topicGaps[0];
  const focusTitle = topGap
    ? `Focus on ${displayTopic(preferRealAcademicLabel(topGap.topic, topGap.chapter)) || preferRealAcademicLabel(topGap.topic, topGap.chapter)}`
    : displayInsights?.headline ?? "Keep practising";
  const focusBody =
    topGap?.fix_hint ??
    displayInsights?.today_focus ??
    "Complete practice â€” your coach builds a drill from each wrong answer in Recovery.";

  const recoveryCount = recovery?.pending_count ?? data.recovery_pending ?? data.mistake_count ?? 0;
  const recoveryPending = Math.max(0, recoveryCount);
  const recoveryCompletion =
    recoveryPending === 0 ? (data.recovery_pending === 0 && (data.mistake_count ?? 0) === 0 ? 0 : 100) : clamp(100 - recoveryPending * 4, 0, 100);
  const activeDays = studyActiveDaysFromSnapshot(data);
  const consistencyScore = clamp((activeDays / 14) * 100);
  const academicHealth = clamp((accuracy + conceptMastery + recoveryCompletion + consistencyScore) / 4);
  const weeklyImprovement = improvement != null ? Math.round(improvement) : 0;

  const firstName = data.student?.full_name?.split(" ")[0] ?? "Student";
  const studentClass = pageData?.student_class ?? "â€”";
  const strongConcepts = displayMastery
    .filter((m) => m.mastery_score >= 75)
    .sort((a, b) => b.mastery_score - a.mastery_score)
    .slice(0, 5);
  const weakConcepts = topicGaps.slice(0, 5);
  const mistakeBuckets = classifyMistakes(aggregates);
  const mostRepeated = repeatedMistake(aggregates);
  // Align with classifyMistakes SSOT (heavy / concept / careless) â€” never invent calc/time splits.
  const heavyMistakes = mistakeBuckets.find((b) => b.key === "heavy")?.count ?? 0;
  const conceptErrors = mistakeBuckets.find((b) => b.key === "concept")?.count ?? 0;
  const carelessMistakes = mistakeBuckets.find((b) => b.key === "careless")?.count ?? 0;
  const hasRecoveryImpact = recoveryPending > 0 || weakConceptCount > 0;
  const subjectRows = charts?.subjects ?? [];
  const trendValues = practiceTrend.slice(-7).map((p) => p.score_pct);
  const thirtyDayValues = practiceTrend.slice(-30).map((p) => p.score_pct);
  const focusTopics = [
    ...(topGap ? [topGap] : []),
    ...topicGaps.filter((g) => g.topic !== topGap?.topic),
  ].slice(0, 3);
  // Measured session improvement only â€” never invent a projected accuracy gain.
  const measuredGain = improvement != null && improvement > 0 ? Math.round(improvement) : 0;
  const strength =
    strongConcepts[0]?.concept ??
    data.strong_topics?.[0]?.topic ??
    data.strong_topics?.[0]?.chapter ??
    "â€”";
  const weakness = topGap?.topic ?? displayMastery.find((m) => m.mastery_score < 60)?.concept ?? "â€”";
  const skillGroups = groupMasteryBySubject(displayMastery);
  const trendData = (practiceTrend.length ? practiceTrend : []).slice(-14).map((p) => ({
    label: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    accuracy: p.score_pct,
  }));

  const initialLoad = insightsLoading && liveAggregates.length === 0 && !displayInsights;

  if (initialLoad) {
    return (
      <div className="wisdom-analytics py-16 text-center text-sm text-[var(--wa-on-surface-variant)]">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading your analysisâ€¦
      </div>
    );
  }

  return (
    <div className="wisdom-analytics wa-gradient-bg wa-intelligence-center space-y-8 animate-rise pb-10 px-1 sm:px-2">
      <section className="wa-health-hero">
        <div className="relative z-10 grid lg:grid-cols-[1.15fr_0.85fr] gap-6 items-stretch">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="wa-gold-pill">Wisdom Campus Â· Academic Intelligence Center</span>
              <span className="rounded-full bg-white/12 border border-border px-3 py-1 text-[10px] font-semibold text-foreground/80">
                {studentClass}
              </span>
            </div>
            <p className="text-sm text-foreground/70">Hi, {firstName}</p>
            <h1 className="font-['Sora'] text-3xl sm:text-5xl font-semibold tracking-tight text-white mt-1">
              Academic Health
            </h1>
            <div className="mt-6 flex flex-wrap items-end gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/60">Health score</p>
                <p className="text-6xl font-bold tabular-nums text-white leading-none mt-1">
                  {academicHealth}<span className="text-2xl text-foreground/55">/100</span>
                </p>
              </div>
              <div className="rounded-2xl bg-[#ffdf97] text-[#251a00] px-4 py-3 shadow-lg">
                <p className="text-[10px] uppercase tracking-wider font-bold">Weekly improvement</p>
                <p className="text-2xl font-bold tabular-nums">
                  {weeklyImprovement > 0 ? "+" : ""}{weeklyImprovement} pts
                </p>
              </div>
            </div>
            <p className="text-sm text-foreground/72 mt-5 max-w-xl">
              This score blends accuracy, concept mastery, recovery completion, and consistency so you can see your academic position instantly.
            </p>
          </div>

          <div className="wa-health-breakdown">
            {[
              { label: "Overall Accuracy", value: accuracy },
              { label: "Concept Mastery", value: conceptMastery },
              { label: "Recovery Completion", value: recoveryCompletion },
              { label: "Consistency Score", value: consistencyScore },
            ].map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-sm font-medium text-foreground/85 mb-1">
                  <span>{m.label}</span>
                  <span className="tabular-nums">{m.value}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/15 overflow-hidden">
                  <div className="h-full rounded-full bg-[#ffdf97]" style={{ width: `${m.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {(enhancing || coachLive || coachError) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {enhancing && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--wa-on-surface-variant)] bg-white/80 px-3 py-1 rounded-full border border-[var(--wa-outline-variant)]">
              <Loader2 className="w-3 h-3 animate-spin" /> Coach analysing your mistakesâ€¦
            </span>
          )}
          {!enhancing && coachLive && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--wa-primary)] bg-[var(--wa-primary-fixed)]/40 px-3 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-[var(--wa-primary)] animate-pulse" /> Live coach ready
            </span>
          )}
          {coachError && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => reloadCoach()}>
              <RefreshCw className="w-3 h-3 mr-1" /> Retry coach
            </Button>
          )}
        </div>
      )}

      <section className="wa-focus-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="wa-label text-[var(--wa-primary)]">Focus today</p>
            <h2 className="wa-display text-2xl mt-1">{focusTitle}</h2>
            <p className="wa-body mt-1 max-w-2xl">{clipInsightText(focusBody, 120)}</p>
          </div>
          <div className="rounded-2xl bg-[var(--wa-primary)] text-white px-4 py-3">
            <p className="wa-label text-foreground/65">Measured gain</p>
            <p className="text-3xl font-bold tabular-nums">
              {measuredGain > 0 ? `+${measuredGain}%` : "â€”"}
            </p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3 mt-5">
          {focusTopics.length > 0 ? focusTopics.map((topic, i) => (
            <div key={`${topic.topic}-${i}`} className="wa-priority-card">
              <p className="wa-label text-[10px]">Priority {i + 1}</p>
              <p className="font-semibold text-[var(--wa-on-surface)] mt-1">{displayTopic(topic.topic)}</p>
              <p className="text-xs text-[var(--wa-on-surface-variant)] mt-1">{displayChapter(topic.chapter)}</p>
            </div>
          )) : (
            <p className="wa-body md:col-span-3">No priority topics yet â€” keep practising to surface gaps.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="wa-display text-2xl md:text-3xl mb-4">Performance snapshot</h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Accuracy" value={`${accuracy}%`} sub="overall attempts" icon={Gauge} />
          <MetricCard label="Concept mastery" value={`${conceptMastery}%`} sub={`${displayMastery.length} skills tracked`} icon={Brain} tone="gold" />
          <MetricCard label="Weak concepts" value={weakConceptCount} sub="need attention" icon={AlertTriangle} tone="red" />
          <MetricCard label="Recovery pending" value={`${recoveryCount}`} sub="questions/tasks waiting" icon={Wrench} tone="blue" />
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="wa-card wa-concept-panel strong">
          <h2 className="wa-headline flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-700" /> Strong concepts
          </h2>
          <div className="space-y-3">
            {strongConcepts.length > 0 ? strongConcepts.map((c) => (
              <div key={`${c.subject}-${c.concept}`} className="wa-concept-row">
                <span>âœ“ {displayConcept(c.concept)}</span>
                <strong>{Math.round(c.mastery_score)}%</strong>
              </div>
            )) : <p className="wa-body">Strong concepts appear as you complete more practice.</p>}
          </div>
        </div>
        <div className="wa-card wa-concept-panel weak">
          <h2 className="wa-headline flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-700" /> Weak concepts
          </h2>
          <div className="space-y-3">
            {weakConcepts.length > 0 ? weakConcepts.map((c) => (
              <div key={`${c.subject}-${c.topic}`} className="wa-concept-row">
                <span>âš  {displayTopic(c.topic)}</span>
                <strong>{c.mistake_count} mistakes</strong>
              </div>
            )) : <p className="wa-body">No major weak concepts detected yet.</p>}
          </div>
        </div>
      </section>

      <section className="wa-card">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="wa-display text-2xl md:text-3xl">Mistake analysis</h2>
            <p className="wa-body mt-1">Why marks are being lost, grouped into useful categories.</p>
          </div>
          <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="wa-label text-amber-800">Most repeated mistake</p>
            <p className="font-bold text-amber-950">{mostRepeated?.topic ? displayTopic(mostRepeated.topic) : weakness}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[
            ["Repeated weak topics", heavyMistakes],
            ["Recurring topic gaps", conceptErrors],
            ["One-off mistakes", carelessMistakes],
          ].map(([label, value]) => (
            <div key={label} className="wa-mistake-type">
              <p className="wa-label text-[10px]">{label}</p>
              <p className="text-3xl font-bold tabular-nums mt-1">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wa-card wa-recovery-impact">
        <div>
          <p className="wa-label text-[var(--wa-primary)]">Recovery impact</p>
          <h2 className="wa-display text-2xl mt-1">Recovery progress</h2>
          <p className="wa-body mt-1">Live recovery load from your weak concepts and pending drills.</p>
        </div>
        {hasRecoveryImpact ? (
          <div className="grid md:grid-cols-2 gap-4 mt-5">
            <div className="wa-before-after before">
              <p className="wa-label">Pending recovery</p>
              <div className="mt-3 space-y-3">
                <div><span>Questions / tasks</span><strong>{recoveryPending}</strong></div>
                <div><span>Weak concepts</span><strong>{weakConceptCount}</strong></div>
              </div>
            </div>
            <div className="wa-before-after after">
              <p className="wa-label text-emerald-800">Current position</p>
              <div className="mt-3 space-y-3">
                <div><span>Accuracy</span><strong>{accuracy}%</strong></div>
                <div><span>Mastery</span><strong>{conceptMastery}%</strong></div>
              </div>
            </div>
          </div>
        ) : (
          <p className="wa-body mt-5">No recovery impact yet â€” complete practice and recovery sessions to track progress.</p>
        )}
      </section>

      <section>
        <h2 className="wa-display text-2xl md:text-3xl mb-4">Subject performance</h2>
        {subjectRows.length === 0 ? (
          <p className="wa-body">Subject performance appears after you attempt practice questions.</p>
        ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4">
          {subjectRows.slice(0, 5).map((s) => {
            const subjectMastery = displayMastery.filter((m) => m.subject === s.name);
            const subjectMasteryAvg = subjectMastery.length
              ? Math.round(subjectMastery.reduce((sum, m) => sum + m.mastery_score, 0) / subjectMastery.length)
              : 0;
            const trendLabel = s.accuracy >= 75 ? "Strong" : s.accuracy >= 60 ? "Stable" : "Needs focus";
            return (
              <div key={s.name} className="wa-subject-card">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{s.name}</h3>
                  <span className="text-xs rounded-full bg-white/70 px-2 py-1">{trendLabel}</span>
                </div>
                <p className="wa-label mt-4">Accuracy</p>
                <p className="text-2xl font-bold tabular-nums">{Math.round(s.accuracy)}%</p>
                <ProgressBar value={s.accuracy} tone={s.accuracy >= 70 ? "emerald" : "gold"} />
                <p className="wa-label mt-4">Mastery</p>
                <p className="text-lg font-bold tabular-nums">{subjectMasteryAvg}%</p>
              </div>
            );
          })}
        </div>
        )}
      </section>

      <section className="wa-card">
        <h2 className="wa-display text-2xl md:text-3xl mb-2">Skill tree</h2>
        <p className="wa-body mb-5">Subject â†’ chapter â†’ concept mastery map.</p>
        {skillGroups.size === 0 ? (
          <p className="wa-body">Concept mastery will appear here after practice attempts sync.</p>
        ) : (
        <div className="space-y-5">
          {[...skillGroups.entries()].slice(0, 4).map(([subject, chapters]) => (
            <div key={subject} className="wa-skill-map-subject">
              <h3 className="font-semibold text-[var(--wa-primary)]">{subject}</h3>
              <div className="mt-3 space-y-3">
                {[...chapters.entries()].slice(0, 4).map(([chapter, concepts]) => (
                  <div key={chapter} className="wa-skill-map-chapter">
                    <p className="text-xs font-semibold text-[var(--wa-on-surface-variant)]">{displayChapter(chapter)}</p>
                    <div className="grid md:grid-cols-2 gap-2 mt-2">
                      {concepts.slice(0, 6).map((concept) => (
                        <div key={`${subject}-${chapter}-${concept.concept}`} className="wa-skill-map-concept">
                          <span>{displayConcept(concept.concept)}</span>
                          <strong>{Math.round(concept.mastery_score)}%</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
      </section>

      <section className="wa-card wa-ai-coach">
        <div className="flex items-start gap-4">
          <div className="wa-ai-orb"><Sparkles className="w-6 h-6" /></div>
          <div className="min-w-0 flex-1">
            <p className="wa-label text-[var(--wa-primary)]">AI academic coach</p>
            <h2 className="wa-display text-2xl mt-1">Concise academic diagnosis</h2>
            <div className="grid md:grid-cols-4 gap-3 mt-5">
              <div className="wa-coach-cell"><p>Strength</p><strong>{strength}</strong></div>
              <div className="wa-coach-cell"><p>Weakness</p><strong>{weakness}</strong></div>
              <div className="wa-coach-cell"><p>Recommendation</p><strong>{clipInsightText(topGap?.fix_hint ?? displayInsights?.today_focus ?? "Complete practice to unlock topic recommendations", 70)}</strong></div>
              <div className="wa-coach-cell"><p>Measured gain</p><strong>{measuredGain > 0 ? `+${measuredGain}% accuracy` : "â€”"}</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="wa-display text-2xl md:text-3xl mb-4">Progress trends</h2>
        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
          <div className="wa-card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="wa-headline flex items-center gap-2"><LineChart className="w-4 h-4" /> Accuracy trend</h3>
                <p className="wa-body text-sm mt-1">Recent practice sessions</p>
              </div>
              <span className="rounded-full bg-[var(--wa-primary-fixed)] px-3 py-1 text-xs font-semibold text-[var(--wa-primary)]">
                {miniTrendValue(trendValues) >= 0 ? "+" : ""}{miniTrendValue(trendValues)}% 7 day
              </span>
            </div>
            {trendData.length >= 2 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64756d" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#64756d" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #d6e1da" }} />
                    <Area type="monotone" dataKey="accuracy" stroke="#003324" fill="#b2f0d4" fillOpacity={0.45} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="wa-body py-10 text-center">Complete more sessions to unlock the trend chart.</p>
            )}
          </div>
          <div className="grid gap-4">
            <MetricCard label="30 day trend" value={`${miniTrendValue(thirtyDayValues) >= 0 ? "+" : ""}${miniTrendValue(thirtyDayValues)}%`} sub="accuracy movement" icon={TrendingUp} tone="gold" />
            <MetricCard label="Mastery" value={`${conceptMastery}%`} sub="tracked concepts" icon={ShieldCheck} />
            <MetricCard label="Recovery" value={`${recoveryCompletion}%`} sub="completion strength" icon={Wrench} tone="blue" />
          </div>
        </div>
      </section>

      <section className="wa-card">
        <h2 className="wa-display text-2xl md:text-3xl mb-4">What&apos;s next</h2>
        <div className="grid md:grid-cols-4 gap-3">
          {[
            { label: "Complete Recovery", to: "/student/recovery", icon: Wrench },
            { label: "Start Revision", to: "/student/revision", icon: ClipboardList },
            { label: "Practice Weak Concepts", to: "/student/practice/math12", icon: Target },
            { label: "Join Battleground", to: "/student/battleground", icon: Trophy },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <Button key={action.label} asChild variant="outline" className="h-auto justify-start rounded-2xl p-4 bg-white">
                <Link to={action.to} className="flex items-center gap-3">
                  <span className="wa-next-icon"><Icon className="w-4 h-4" /></span>
                  <span>{action.label}</span>
                  <ArrowRight className="w-4 h-4 ml-auto" />
                </Link>
              </Button>
            );
          })}
        </div>
      </section>

      {!pageLoading && pageData?.recent_sessions?.[0] && (
        <p className="text-center text-xs text-[var(--wa-on-surface-variant)]">
          Latest session: {displayChapter(pageData.recent_sessions[0].chapter) || "â€”"} Â· {pageData.recent_sessions[0].accuracy_pct}% Â· {formatLastSeen(pageData.recent_sessions[0].finished_at)}
        </p>
      )}
    </div>
  );
}
