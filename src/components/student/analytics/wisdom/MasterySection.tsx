import { Link } from "react-router-dom";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { TopicGapInsight } from "@/lib/analyticsInsights";
import {
  buildMilestones,
  masteryLevel,
  pyramidStage,
  shortLabel,
} from "@/components/student/analytics/wisdom/analyticsDerived";
import { Grid3x3, GitBranch, History, Play, Verified } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <header>
        <h2 className="wa-display text-2xl md:text-3xl">Academic Mastery</h2>
        <p className="wa-body mt-1">Your journey toward subject excellence.</p>
      </header>

      <section className="wa-card">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="wa-headline flex items-center gap-2">
              <Grid3x3 className="w-4 h-4 text-[var(--wa-primary)]" />
              {subject} mastery map
            </h3>
            <p className="wa-label mt-1">Darker green = stronger · red = needs recovery</p>
          </div>
          <div className="flex gap-1.5 items-center">
            <span className="w-3 h-3 rounded-sm bg-[var(--wa-surface-high)]" title="Learning" />
            <span className="w-3 h-3 rounded-sm bg-[var(--wa-primary-fixed)]" title="Proficient" />
            <span className="w-3 h-3 rounded-sm bg-[var(--wa-primary)]" title="Mastered" />
          </div>
        </div>
        {cells.length > 0 ? (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {cells.map((c) => {
              const levelKey = masteryLevel(c);
              return (
                <div
                  key={`${c.subject}-${c.concept}`}
                  className={`wa-heatmap-cell wa-heatmap-${levelKey}`}
                  title={`${c.concept}: ${Math.round(c.mastery_score)}% · ${c.mistake_count} mistakes`}
                >
                  {shortLabel(c.concept, 10)}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="wa-body">Complete practice — each chapter fills in here.</p>
        )}
      </section>

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
