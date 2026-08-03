import { Link } from "react-router-dom";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { TopicGapInsight } from "@/lib/analyticsInsights";
import {
  buildMilestones,
  masteryLevel,
} from "@/components/student/analytics/wisdom/analyticsDerived";
import { displayChapter, displayConcept, displaySubject } from "@/lib/academicDisplay";
import { GitBranch, History } from "lucide-react";

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
  const milestones = buildMilestones(data, topicGaps, improvement);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="wa-display text-2xl md:text-3xl">Skill tree</h2>
        <p className="wa-body mt-1">Your strongest concepts, weak spots, and next focused drill.</p>
      </header>

      {mastery.length > 0 && (
        <section className="wa-card wa-skill-tree-card">
          <h3 className="wa-headline flex items-center gap-2 mb-4">
            <GitBranch className="w-4 h-4 text-[var(--wa-secondary-fixed-dim)]" />
            All concepts
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {mastery.map((c) => {
              const levelKey = masteryLevel(c);
              const border =
                levelKey === "mastered"
                  ? "border-[var(--wa-primary)]"
                  : levelKey === "review"
                    ? "border-red-300"
                    : "border-[var(--wa-outline-variant)]";
              return (
                <div
                  key={`${c.subject}-${c.concept}-${c.chapter}`}
                  className={`rounded-xl border-2 ${border} bg-white/80 p-3`}
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--wa-on-surface)] truncate">{displayConcept(c.concept)}</p>
                      <p className="wa-label text-[10px] truncate">
                        {displaySubject(c.subject)}{c.chapter ? ` · ${displayChapter(c.chapter)}` : ""}
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
              {mastery.filter((m) => masteryLevel(m) === "review").length} needs work
            </span>
          </div>
        </section>
      )}

      <div>
        <section className="wa-card wa-coach-focus-card">
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
