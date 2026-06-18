import { Link } from "react-router-dom";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { TopicGapInsight } from "@/lib/analyticsInsights";
import {
  buildMilestones,
  masteryLevel,
  pyramidStage,
} from "@/components/student/analytics/wisdom/analyticsDerived";
import { GitBranch, History, Play, Sparkles, TrendingUp, Verified } from "lucide-react";

type Props = {
  data: AcademicSnapshot;
  mastery: ConceptMasteryItem[];
  topicGaps: TopicGapInsight[];
  focusTitle: string;
  focusBody: string;
  level: number;
  improvement: number | null;
  enhancing?: boolean;
  coachLive?: boolean;
};

export function MasterySection({
  data,
  mastery,
  topicGaps,
  focusTitle,
  focusBody,
  level,
  improvement,
  enhancing,
  coachLive,
}: Props) {
  const cells = mastery.slice(0, 12);
  const subject = cells[0]?.subject ?? "Mathematics";
  const { foundationalDone, coreTopic } = pyramidStage(mastery, topicGaps);
  const milestones = buildMilestones(data, topicGaps, improvement);
  const masterySnapshot = [...mastery]
    .sort((a, b) => b.mastery_score - a.mastery_score)
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="wa-display text-2xl md:text-3xl">Concept mastery</h2>
        <p className="wa-body mt-1">Your academic skill tree — strengths, gaps, and learning journey.</p>
      </header>

      <section className="wa-card wa-feature-card">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="wa-headline flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--wa-secondary-fixed-dim)]" />
              {subject} mastery snapshot
            </h3>
            <p className="wa-body text-sm mt-1">A clean view of your strongest concepts and where momentum is building.</p>
          </div>
          <div className="rounded-2xl bg-[var(--wa-primary)] text-white px-4 py-3 text-right shadow-sm">
            <p className="wa-label text-white/65">Tracked skills</p>
            <p className="text-2xl font-bold tabular-nums">{mastery.length}</p>
          </div>
        </div>
        {masterySnapshot.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {masterySnapshot.map((c, i) => (
              <div key={`${c.subject}-${c.concept}`} className="wa-mastery-spotlight">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--wa-on-surface)] truncate">{c.concept}</p>
                    <p className="wa-label text-[10px] truncate">
                      {c.subject}{c.chapter ? ` · ${c.chapter}` : ""}
                    </p>
                  </div>
                  <span className="text-xl font-bold tabular-nums text-[var(--wa-primary)]">{Math.round(c.mastery_score)}%</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-[var(--wa-surface-variant)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--wa-primary)] to-[var(--wa-primary-fixed-dim)]"
                    style={{ width: `${Math.min(100, c.mastery_score)}%` }}
                  />
                </div>
                <p className="text-[11px] text-[var(--wa-on-surface-variant)] mt-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Rank {i + 1} in current mastery profile
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="wa-body">Complete practice — concept mastery snapshots appear here.</p>
        )}
      </section>

      {mastery.length > 0 && (
        <section className="wa-card">
          <h3 className="wa-headline flex items-center gap-2 mb-4">
            <GitBranch className="w-4 h-4 text-[var(--wa-secondary-fixed-dim)]" />
            Skill tree · all concepts
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {mastery.map((c) => {
              const levelKey = masteryLevel(c);
              const border =
                levelKey === "mastered"
                  ? "border-[var(--wa-primary)]"
                  : levelKey === "weak"
                    ? "border-red-300"
                    : "border-[var(--wa-outline-variant)]";
              return (
                <div
                  key={`${c.subject}-${c.concept}-${c.chapter}`}
                  className={`rounded-xl border-2 ${border} bg-white/80 p-3`}
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--wa-on-surface)] truncate">{c.concept}</p>
                      <p className="wa-label text-[10px] truncate">
                        {c.subject}{c.chapter ? ` · ${c.chapter}` : ""}
                      </p>
                    </div>
                    <span className="text-lg font-bold tabular-nums text-[var(--wa-primary)] shrink-0">
                      {Math.round(c.mastery_score)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--wa-surface-variant)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--wa-primary)]"
                      style={{ width: `${Math.min(100, c.mastery_score)}%` }}
                    />
                  </div>
                  {c.mistake_count > 0 && (
                    <p className="text-[10px] text-[var(--wa-on-surface-variant)] mt-1.5">
                      {c.mistake_count} mistake{c.mistake_count !== 1 ? "s" : ""} logged
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <span className="wa-label px-2 py-1 rounded-full bg-[var(--wa-primary-fixed)]/30">
              {mastery.filter((m) => masteryLevel(m) === "mastered").length} strong
            </span>
            <span className="wa-label px-2 py-1 rounded-full bg-red-50 text-red-700">
              {mastery.filter((m) => masteryLevel(m) === "weak").length} needs work
            </span>
          </div>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <section className="wa-card flex flex-col">
          <h3 className="wa-headline flex items-center gap-2 mb-4">
            <GitBranch className="w-4 h-4 text-[var(--wa-secondary-fixed-dim)]" />
            Concept hierarchy
          </h3>
          <div className="flex flex-col items-center gap-2 mt-2 flex-1">
            <div
              className={`w-1/3 py-2 text-center rounded-t-lg border-b text-xs font-semibold uppercase tracking-wider ${
                foundationalDone
                  ? "bg-[var(--wa-surface-high)] text-[var(--wa-on-surface-variant)]"
                  : "bg-[var(--wa-surface-variant)] text-[var(--wa-on-surface-variant)] opacity-60"
              }`}
            >
              Advanced
            </div>
            <div className="w-2/3 py-3 bg-[var(--wa-secondary-fixed-dim)] text-[#251a00] text-center rounded-sm relative border-2 border-[var(--wa-secondary-fixed)] shadow-[0_0_12px_rgba(233,194,97,0.25)]">
              <Play className="w-4 h-4 absolute -left-1 top-1/2 -translate-y-1/2 fill-current text-[var(--wa-primary)]" />
              <span className="wa-label text-[#251a00] font-bold">Core focus</span>
              <div className="text-xs mt-0.5 opacity-90">{coreTopic}</div>
            </div>
            <div className="w-full py-3 bg-[var(--wa-primary)] text-white text-center rounded-b-lg flex flex-col items-center">
              <Verified className="w-4 h-4 mb-1" />
              <span className="wa-label text-white/90">Foundational</span>
              <span className="text-[10px] mt-0.5 opacity-80">
                {foundationalDone ? "Solid base — keep revising" : "Build basics first"}
              </span>
            </div>
          </div>
        </section>

        <section className="wa-card relative overflow-hidden border-2 border-[var(--wa-surface-tint)]/30 bg-gradient-to-br from-[var(--wa-surface-low)] to-white">
          <div className="absolute -right-8 -bottom-8 opacity-[0.06] pointer-events-none text-[var(--wa-primary)]">
            <GitBranch className="w-32 h-32" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="wa-label text-[var(--wa-primary)] tracking-widest">Study coach insight</p>
              {coachLive && !enhancing && (
                <span className="wa-label text-[var(--wa-surface-tint)] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--wa-primary)]" /> Live
                </span>
              )}
            </div>
            <h3 className="wa-headline mb-2">{enhancing ? "Reading your mistakes…" : focusTitle}</h3>
            <p className="wa-body mb-5">{focusBody}</p>
            <ButtonLink />
          </div>
        </section>
      </div>

      <section className="wa-card">
        <h3 className="wa-headline flex items-center gap-2 mb-5">
          <History className="w-4 h-4 text-[var(--wa-primary)]" />
          Growth milestones
        </h3>
        <div className="relative border-l-2 border-[var(--wa-surface-variant)] ml-3 space-y-6">
          {milestones.map((m, i) => (
            <div key={i} className="relative pl-6">
              <div
                className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${
                  i === 0 ? "bg-[var(--wa-secondary-fixed)] ring-2 ring-[var(--wa-secondary-fixed-dim)]" : "bg-[var(--wa-primary)]"
                }`}
              />
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                <h4 className="text-sm font-semibold text-[var(--wa-on-surface)]">{m.title}</h4>
                <span className="wa-label">{m.when}</span>
              </div>
              {m.detail && <p className="wa-body text-sm">{m.detail}</p>}
              {m.badge && (
                <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-[var(--wa-secondary-container)] text-[#775b00] rounded text-[10px] font-semibold uppercase">
                  {m.badge}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ButtonLink() {
  return (
    <Link
      to="/student/recovery"
      className="inline-flex w-full h-11 items-center justify-center gap-2 rounded-lg bg-[var(--wa-primary)] text-white text-sm font-semibold hover:bg-[var(--wa-primary-container)] transition-colors shadow-md"
    >
      Start focused drill
    </Link>
  );
}
