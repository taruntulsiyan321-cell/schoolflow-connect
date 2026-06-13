import { Link } from "react-router-dom";
import type { MistakeTopicAggregate, TopicGapInsight } from "@/lib/analyticsInsights";
import {
  classifyMistakes,
  subjectVulnerability,
} from "@/components/student/analytics/wisdom/analyticsDerived";
import { AlertTriangle, PieChart, Target, TrendingUp } from "lucide-react";

type Props = {
  aggregates: MistakeTopicAggregate[];
  topicGaps: TopicGapInsight[];
  coachInsights: string[];
  recoveryCount: number;
  priorityTarget: string | null;
  coachLive?: boolean;
};

export function MistakeSection({
  aggregates,
  topicGaps,
  coachInsights,
  recoveryCount,
  priorityTarget,
  coachLive,
}: Props) {
  const buckets = classifyMistakes(aggregates);
  const totalErrors = aggregates.reduce((s, a) => s + a.mistake_count, 0);
  const subjects = subjectVulnerability(aggregates);
  const circumference = 2 * Math.PI * 40;
  let offset = 0;

  return (
    <div className="space-y-6">
      <header className="text-center md:text-left">
        <h2 className="wa-display text-2xl md:text-3xl">Mistake Intelligence</h2>
        <p className="wa-body mt-1">Decoding your learning patterns</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <section className="wa-card md:col-span-8">
          <h3 className="wa-headline flex items-center gap-2 mb-4">
            <PieChart className="w-4 h-4 text-[var(--wa-primary)]" />
            Mistake classification
          </h3>
          {totalErrors > 0 ? (
            <div className="flex flex-col md:flex-row items-center justify-center gap-8">
              <div className="relative w-44 h-44 shrink-0">
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#defaeb" strokeWidth="14" />
                  {buckets.map((b) => {
                    const dash = (b.pct / 100) * circumference;
                    const el = (
                      <circle
                        key={b.key}
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke={b.color}
                        strokeWidth="14"
                        strokeDasharray={`${dash} ${circumference - dash}`}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 50 50)"
                      />
                    );
                    offset += dash;
                    return el;
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-semibold text-[var(--wa-primary)] tabular-nums">{totalErrors}</span>
                  <span className="wa-label">Errors</span>
                </div>
              </div>
              <div className="space-y-3 w-full max-w-xs">
                {buckets.map((b) => (
                  <div key={b.key} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: b.color }} />
                      <span className="text-sm font-medium text-[var(--wa-on-surface)]">{b.label}</span>
                    </div>
                    <span className="font-mono text-sm text-[var(--wa-on-surface-variant)]">{b.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="wa-body">No mistakes logged yet — your breakdown appears after practice.</p>
          )}
        </section>

        <section className="wa-card md:col-span-4 bg-[var(--wa-primary)] text-white relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--wa-primary-container)] rounded-full opacity-40 -mr-6 -mt-6" />
          <div className="relative z-10 space-y-3">
            <div className="inline-flex p-2 bg-[var(--wa-secondary-fixed)] rounded-lg text-[var(--wa-secondary)]">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="wa-headline text-white mb-1">Recovery path</h3>
              <p className="text-sm text-[var(--wa-surface-dim)] opacity-90">
                {recoveryCount} questions waiting — fix the pattern, not just the mark.
              </p>
            </div>
            {priorityTarget && (
              <div className="bg-white/10 border border-white/20 rounded-lg p-3 backdrop-blur-sm">
                <p className="wa-label text-[var(--wa-secondary-fixed)] mb-1">Priority target</p>
                <p className="text-sm font-medium">{priorityTarget}</p>
              </div>
            )}
          </div>
          <Link
            to="/student/recovery"
            className="relative z-10 mt-5 w-full py-3 px-4 bg-[var(--wa-secondary-fixed)] hover:bg-[var(--wa-secondary-fixed-dim)] text-[#251a00] font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
          >
            Start targeted recovery
          </Link>
        </section>

        <section className="wa-card md:col-span-6">
          <h3 className="wa-headline flex items-center gap-2 mb-4">The &ldquo;why&rdquo; behind errors</h3>
          <div className="space-y-3">
            {coachInsights.length > 0 ? (
              coachInsights.slice(0, 4).map((line, i) => (
                <div
                  key={i}
                  className={`rounded-r-lg p-3 flex gap-3 border-l-4 ${
                    i % 2 === 0
                      ? "border-[var(--wa-primary)] bg-gradient-to-br from-[var(--wa-surface-high)] to-white"
                      : "border-[var(--wa-error)] bg-gradient-to-br from-[var(--wa-error-container)]/40 to-white"
                  }`}
                >
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${i % 2 === 0 ? "text-[var(--wa-primary)]" : "text-[var(--wa-error)]"}`} />
                  <div>
                    <p className="text-sm font-medium text-[var(--wa-on-surface)]">{line}</p>
                    <span className="wa-label mt-1 block">
                      {coachLive ? "Coach insight · from your attempts" : "Pattern from your mistake log"}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="wa-body">Coach notes appear once you have mistakes to analyse.</p>
            )}
          </div>
        </section>

        <section className="wa-card md:col-span-6">
          <h3 className="wa-headline flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-[var(--wa-primary)]" />
            Subject vulnerability
          </h3>
          <div className="space-y-4">
            {subjects.length > 0 ? (
              subjects.map((s) => (
                <div key={s.subject}>
                  <div className="flex justify-between text-sm font-medium mb-1">
                    <span>{s.subject}</span>
                    <span className="font-mono text-[var(--wa-error)]">{s.count} errors</span>
                  </div>
                  <div className="w-full h-2 bg-[var(--wa-surface-variant)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--wa-error)]"
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="wa-body">Subject-wise error bars fill in as you practise more subjects.</p>
            )}
          </div>
        </section>
      </div>

      {topicGaps.length > 0 && (
        <p className="text-center">
          <Link to="/student/recovery" className="text-sm font-medium text-[var(--wa-primary)] hover:underline">
            View full topic breakdown in Recovery →
          </Link>
        </p>
      )}
    </div>
  );
}
