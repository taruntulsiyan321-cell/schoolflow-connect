import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Trophy } from "lucide-react";

type Props = {
  firstName: string;
  studentClass: string;
  readiness: number;
  accuracy: number;
  level: number;
  rank: number | null;
  classSize: number;
  streak: number;
  improvement: number | null;
  coachHeadline: string;
  coachFocus: string;
};

function ProgressRing({ value, label }: { value: number; label: string }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(100, value) / 100) * circumference;

  return (
    <div className="wa-progress-ring">
      <svg width="88" height="88" viewBox="0 0 100 100">
        <circle className="ring-bg" cx="50" cy="50" r={r} />
        <circle
          className="ring-fill"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-label">
        <span className="text-xl font-semibold tabular-nums">{value}%</span>
        <span className="wa-label text-white/70 text-[9px]">{label}</span>
      </div>
    </div>
  );
}

export function AnalyticsHero({
  firstName,
  studentClass,
  readiness,
  accuracy,
  level,
  rank,
  classSize,
  streak,
  improvement,
  coachHeadline,
  coachFocus,
}: Props) {
  return (
    <section className="wa-hero p-6 sm:p-8 relative">
      <div className="relative z-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="wa-gold-pill">Wisdom Campus · Insights</span>
              {improvement != null && improvement > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-[var(--wa-secondary-fixed)]">
                  +{improvement}% momentum
                </span>
              )}
            </div>
            <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold tracking-tight text-white">
              Hi, {firstName}
            </h1>
            <p className="text-sm text-white/75 mt-1.5">
              {studentClass} · Level {level}
              {rank ? ` · Class rank #${rank}` : ""}
            </p>
          </div>
          <ProgressRing value={readiness} label="Readiness" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <div className="wa-stat-chip">
            <span className="wa-label text-white/60">Accuracy</span>
            <span className="value text-white tabular-nums">{accuracy}%</span>
          </div>
          <div className="wa-stat-chip">
            <span className="wa-label text-white/60">Streak</span>
            <span className="value text-white tabular-nums">{streak}d</span>
          </div>
          <div className="wa-stat-chip">
            <span className="wa-label text-white/60">Class rank</span>
            <span className="value text-white tabular-nums flex items-center gap-1">
              {rank ? `#${rank}` : "—"}
              {rank === 1 && <Trophy className="w-4 h-4 text-[var(--wa-secondary-fixed)]" />}
            </span>
          </div>
          <div className="wa-stat-chip">
            <span className="wa-label text-white/60">Class size</span>
            <span className="value text-white tabular-nums">{classSize > 0 ? classSize : "—"}</span>
          </div>
        </div>

        <div className="wa-hero-glass mt-6 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--wa-secondary-fixed)]/90 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-[#251a00]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="wa-label text-[var(--wa-secondary-fixed)]">Coach insight</p>
              <p className="text-sm sm:text-base font-semibold text-white mt-0.5 leading-snug">{coachHeadline}</p>
              <p className="text-xs sm:text-sm text-white/75 mt-1.5 leading-relaxed">{coachFocus}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button size="sm" className="rounded-lg bg-[var(--wa-secondary-fixed)] hover:bg-[var(--wa-secondary-fixed-dim)] text-[#251a00] font-semibold border-0 h-9" asChild>
              <Link to="/student/recovery">
                Start recovery <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
            <Button size="sm" variant="ghost" className="rounded-lg text-white/90 hover:bg-white/10 hover:text-white h-9" asChild>
              <Link to="/student/practice/math12">Practice now</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
