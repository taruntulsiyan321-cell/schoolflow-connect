import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type RecoveryCompletionReport,
  formatDelta,
  deltaPositive,
} from "@/lib/recoveryCompletionReport";
import { displayChapter, displayConcept, displaySubject, displayTopic } from "@/lib/academicDisplay";
import {
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronRight,
  Flame,
  Medal,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Wrench,
  Zap,
  AlertTriangle,
  XCircle,
  BookOpen,
  ListChecks,
} from "lucide-react";
import "./recovery-completion.css";

type Props = {
  report: RecoveryCompletionReport;
};

function CompareArrow({ before, after }: { before: number; after: number }) {
  const gain = after - before;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground tabular-nums">{before}%</span>
      <ChevronRight className="w-4 h-4 rc-arrow shrink-0" />
      <span className="font-bold text-emerald-700 tabular-nums">{after}%</span>
      {gain > 0 && (
        <Badge className="bg-emerald-500/15 text-emerald-800 border-0 text-[10px]">
          +{gain}%
        </Badge>
      )}
    </div>
  );
}

function ConceptProgressBar({ before, after, name }: { before: number; after: number; name: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-start gap-2">
        <span className="text-sm font-medium leading-snug">{name}</span>
        <span className="text-xs font-semibold text-emerald-700 tabular-nums shrink-0">
          {formatDelta(before, after)}
        </span>
      </div>
      <div className="rc-progress-track relative">
        <div className="rc-progress-before absolute inset-y-0 left-0" style={{ width: `${before}%` }} />
        <div className="rc-progress-after absolute inset-y-0 left-0" style={{ width: `${after}%` }} />
      </div>
    </div>
  );
}

export function RecoveryCompletionReportView({ report }: Props) {
  const r = report;
  const earnedBadges = r.achievements.filter((a) => a.earned);
  const masteryGain = r.hero.masteryAfter - r.hero.masteryBefore;

  return (
    <div className="rc-report space-y-8 px-1 sm:px-0">
      {/* ── SECTION 1: HERO ─────────────────────────────────── */}
      <section className="rc-hero rc-animate rounded-[2rem] overflow-hidden relative text-primary-foreground">
        <div className="rc-hero-glow absolute inset-0 pointer-events-none" />
        <div className="rc-hero-confetti absolute inset-0 pointer-events-none" />
        <div className="relative z-10 p-6 sm:p-10">
          <div className="flex items-center gap-2 text-sm font-medium text-primary-foreground/80 mb-2">
            <Trophy className="w-5 h-5 text-[#e8c468]" />
            Recovery Complete
          </div>
          <h1 className="font-['Sora'] text-3xl sm:text-4xl font-semibold tracking-tight">
            You&apos;re getting better.
          </h1>
          <p className="text-primary-foreground/75 mt-2 text-sm sm:text-base">
            {displayConcept(r.concept)} · {displaySubject(r.subject)}
            {r.chapter ? ` · ${displayChapter(r.chapter)}` : ""}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
            <div className="rc-stat-hero rounded-2xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">Questions solved</p>
              <p className="text-3xl font-bold tabular-nums mt-1">{r.hero.questionsCompleted}</p>
            </div>
            <div className="rc-stat-hero rounded-2xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">Recovery accuracy</p>
              <p className="text-3xl font-bold tabular-nums mt-1 text-[#e8c468]">{r.hero.recoveryAccuracy}%</p>
            </div>
            <div className="rc-stat-hero rounded-2xl p-4 col-span-2 sm:col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">Mastery improvement</p>
              <p className="text-2xl sm:text-3xl font-bold tabular-nums mt-1 flex items-center gap-2 flex-wrap">
                <span>{r.hero.masteryBefore}%</span>
                <ArrowRight className="w-5 h-5 text-[#e8c468]" />
                <span className="text-[#b2f0d4]">{r.hero.masteryAfter}%</span>
                <Badge className="bg-[#e8c468]/25 text-[#fff8e0] border-0">+{masteryGain}%</Badge>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: BEFORE VS AFTER ──────────────────────── */}
      <section className="rc-animate rc-animate-delay-1">
        <h2 className="rc-section-title text-xl mb-1">Before vs after</h2>
        <p className="text-sm text-muted-foreground mb-4">Your growth at a glance — the recovery worked.</p>
        <div className="rc-card p-5 sm:p-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rc-compare-before rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Before recovery</p>
              <div className="space-y-3">
                {r.beforeAfter.map((m) => (
                  <div key={m.label} className="flex justify-between text-sm">
                    <span>{m.label}</span>
                    <span className="font-semibold tabular-nums">{m.before}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rc-compare-after rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800 mb-3">After recovery</p>
              <div className="space-y-3">
                {r.beforeAfter.map((m) => (
                  <div key={m.label} className="flex justify-between text-sm">
                    <span>{m.label}</span>
                    <CompareArrow before={m.before} after={m.after} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: CONCEPT IMPROVEMENT ──────────────────── */}
      <section className="rc-animate rc-animate-delay-2">
        <h2 className="rc-section-title text-xl mb-1">Concept improvement report</h2>
        <p className="text-sm text-muted-foreground mb-4">Every skill you practiced — and how it grew.</p>
        <div className="rc-card p-5 sm:p-6 space-y-5">
          {r.conceptImprovements.map((c) => (
            <ConceptProgressBar
              key={c.name}
              name={displayConcept(c.name) || c.name}
              before={c.before}
              after={c.after}
            />
          ))}
        </div>
      </section>

      {/* ── SECTION 4: RECOVERY IMPACT ──────────────────────── */}
      <section>
        <h2 className="rc-section-title text-xl mb-1">Recovery impact</h2>
        <p className="text-sm text-muted-foreground mb-4">How this session moved your overall performance.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rc-card p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{r.recoveryImpact.overallAccuracy.label}</p>
            <p className="text-2xl font-bold mt-2 tabular-nums">
              {formatDelta(r.recoveryImpact.overallAccuracy.before, r.recoveryImpact.overallAccuracy.after)}
            </p>
            <TrendingUp className="w-5 h-5 text-emerald-600 mt-2" />
          </div>
          <div className="rc-card p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Practice accuracy</p>
            <p className="text-2xl font-bold mt-2 tabular-nums">
              {formatDelta(r.recoveryImpact.practiceAccuracy.before, r.recoveryImpact.practiceAccuracy.after)}
            </p>
          </div>
          <div className="rc-card p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Weak concepts fixed</p>
            <p className="text-3xl font-bold mt-2 tabular-nums text-emerald-700">{r.recoveryImpact.weakConceptsFixed}</p>
          </div>
          <div className="rc-card p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Mastery score increase</p>
            <p className="text-3xl font-bold mt-2 tabular-nums text-[#c49a2a]">+{r.recoveryImpact.masteryScoreIncrease}</p>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: ACADEMIC HEALTH ──────────────────────── */}
      <section>
        <h2 className="rc-section-title text-xl mb-1">Academic health report</h2>
        <p className="text-sm text-muted-foreground mb-4">Your overall learning wellness score.</p>
        <div className="rc-card-gold rounded-2xl p-6">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Before</p>
              <p className="text-3xl font-bold tabular-nums">{r.academicHealth.before}</p>
            </div>
            <ArrowRight className="w-8 h-8 text-[#e8c468] hidden sm:block" />
            <div>
              <p className="text-sm text-emerald-700 font-medium">After</p>
              <p className="text-4xl font-bold tabular-nums text-emerald-800">{r.academicHealth.after}</p>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-800 border-0 ml-auto">
              +{deltaPositive(r.academicHealth.before, r.academicHealth.after)} points
            </Badge>
          </div>
          <div className="rc-health-bar">
            <div
              className="rc-health-before flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${r.academicHealth.before}%` }}
            >
              {r.academicHealth.before}
            </div>
            <div
              className="rc-health-after flex items-center justify-center text-xs font-bold text-[#251a00]"
              style={{ width: `${100 - r.academicHealth.before}%` }}
            >
              +{r.academicHealth.after - r.academicHealth.before}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: JOURNEY ──────────────────────────────── */}
      <section>
        <h2 className="rc-section-title text-xl mb-1">Your recovery journey</h2>
        <p className="text-sm text-muted-foreground mb-4">From weakness detected to mastery achieved.</p>
        <div className="rc-card p-5 sm:p-6 overflow-x-auto">
          <div className="min-w-[32rem]">
            <div className="rc-journey-line rounded-full mb-6" />
            <div className="grid grid-cols-6 gap-2">
              {r.journey.map((stage, i) => (
                <div key={stage.id} className="text-center">
                  <div
                    className={cn(
                      "rc-journey-dot mx-auto mb-2",
                      stage.completed ? "done" : "pending",
                    )}
                  >
                    {stage.completed ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <p className="text-[10px] sm:text-xs font-semibold leading-tight">{stage.label}</p>
                  <p className="text-[9px] text-muted-foreground mt-1 hidden sm:block line-clamp-2">{stage.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 7: CONCEPT STATUS ───────────────────────── */}
      <section>
        <h2 className="rc-section-title text-xl mb-1">Concept status</h2>
        <p className="text-sm text-muted-foreground mb-4">Where you stand right now.</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="rc-card p-4 border-emerald-200/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-3 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mastered
            </p>
            <ul className="space-y-2 text-sm">
              {r.conceptStatus.mastered.length > 0 ? (
                r.conceptStatus.mastered.map((c) => (
                  <li key={c} className="flex items-start gap-2">
                    <span className="text-emerald-600">✓</span>
                    <span>{displayConcept(c) || c}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground text-xs">Keep practicing — mastery is close.</li>
              )}
            </ul>
          </div>
          <div className="rc-card p-4 border-amber-200/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 mb-3 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Improving
            </p>
            <ul className="space-y-2 text-sm">
              {r.conceptStatus.improving.length > 0 ? (
                r.conceptStatus.improving.map((c) => (
                  <li key={c} className="flex items-start gap-2">
                    <span className="text-amber-600">⚠</span>
                    <span>{displayConcept(c) || c}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground text-xs">No concepts in progress zone.</li>
              )}
            </ul>
          </div>
          <div className="rc-card p-4 border-red-200/40">
            <p className="text-xs font-semibold uppercase tracking-wider text-red-700 mb-3 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> Needs more recovery
            </p>
            <ul className="space-y-2 text-sm">
              {r.conceptStatus.needsRecovery.length > 0 ? (
                r.conceptStatus.needsRecovery.map((c) => (
                  <li key={c} className="flex items-start gap-2">
                    <span className="text-red-500">✕</span>
                    <span>{displayConcept(c) || c}</span>
                  </li>
                ))
              ) : (
                <li className="text-emerald-700 text-xs font-medium">All clear — great work!</li>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: SUCCESS HISTORY ──────────────────────── */}
      {r.successHistory.length > 0 && (
        <section>
          <h2 className="rc-section-title text-xl mb-1">Recovery success history</h2>
          <p className="text-sm text-muted-foreground mb-4">Your track record proves the system works.</p>
          <div className="rc-card p-5">
            <div className="space-y-3">
              {r.successHistory.map((h) => (
                <div key={h.topic + h.completedAt} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="font-medium text-sm">{displayTopic(h.topic) || displayConcept(h.topic) || h.topic}</span>
                  <Badge className="bg-emerald-500/15 text-emerald-800 border-0">+{h.gain}% mastery</Badge>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── SECTION 9: AI COACH ─────────────────────────────── */}
      <section>
        <div className="rc-card-coach rounded-2xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0d5c44] to-[#97d3b8] flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Academic coach</p>
              <h3 className="font-['Sora'] text-lg sm:text-xl font-semibold mt-1 leading-snug">{r.coach.headline}</h3>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {r.coach.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-[#e8c468] shrink-0 mt-0.5" />
                    {b}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm font-medium text-foreground bg-emerald-500/10 rounded-xl px-4 py-3 border border-emerald-500/15">
                {r.coach.focusNext}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 10: WHAT'S NEXT ─────────────────────────── */}
      <section>
        <h2 className="rc-section-title text-xl mb-1">What&apos;s next</h2>
        <p className="text-sm text-muted-foreground mb-4">Your personalised path forward.</p>
        <div className="rc-card p-5 sm:p-6 space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Link to="/student/recovery" className="rounded-xl bg-muted/40 p-4 hover:bg-muted/60 transition-colors block">
              <Wrench className="w-5 h-5 text-emerald-700 mb-2" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Next recovery</p>
              <p className="font-semibold mt-1">{r.whatsNext.nextRecovery}</p>
            </Link>
            <Link to="/student/revision" className="rounded-xl bg-muted/40 p-4 hover:bg-muted/60 transition-colors block">
              <ListChecks className="w-5 h-5 text-amber-700 mb-2" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Recommended revision</p>
              <p className="font-semibold mt-1">{r.whatsNext.nextRevision}</p>
            </Link>
            <Link
              to={`/student/practice?chapter=${encodeURIComponent(r.whatsNext.nextPractice)}`}
              className="rounded-xl bg-muted/40 p-4 hover:bg-muted/60 transition-colors block"
            >
              <BookOpen className="w-5 h-5 text-blue-700 mb-2" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Practice session</p>
              <p className="font-semibold mt-1">{r.whatsNext.nextPractice}</p>
            </Link>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button className="rc-cta-primary rounded-full flex-1 h-11 border-0" asChild>
              <Link to="/student/analysis">
                Continue improvement <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full flex-1 h-11" asChild>
              <Link to="/student/recovery">
                <Target className="w-4 h-4 mr-2" /> Start next recovery
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full flex-1 h-11" asChild>
              <Link to="/student/aicoach">Ask Nova</Link>
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" asChild>
            <Link to={`/student/recovery/${r.assignmentId}/result`}>Review individual questions →</Link>
          </Button>
        </div>
      </section>

      {/* ── SECTION 11: ACHIEVEMENTS ────────────────────────── */}
      <section>
        <h2 className="rc-section-title text-xl mb-1">Achievements unlocked</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {earnedBadges.length > 0 ? "Celebrate your progress." : "Complete more recoveries to earn badges."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {r.achievements.map((a) => (
            <div
              key={a.id}
              className={cn(
                "rounded-2xl p-4 text-center transition-all",
                a.earned ? "rc-badge-earned" : "rc-badge-locked",
              )}
            >
              <div className="mx-auto w-10 h-10 rounded-xl flex items-center justify-center mb-2 bg-white/80">
                {a.id === "streak" && <Flame className={cn("w-5 h-5", a.earned ? "text-orange-500" : "text-gray-400")} />}
                {a.id === "mastery" && <Medal className={cn("w-5 h-5", a.earned ? "text-[#e8c468]" : "text-gray-400")} />}
                {a.id === "conqueror" && <Trophy className={cn("w-5 h-5", a.earned ? "text-emerald-600" : "text-gray-400")} />}
                {a.id === "weakness" && <Award className={cn("w-5 h-5", a.earned ? "text-violet-600" : "text-gray-400")} />}
              </div>
              <p className="text-xs font-semibold leading-tight">{a.label}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{a.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-center pt-4">
        <Button variant="ghost" asChild>
          <Link to="/student/recovery">← Back to Recovery Center</Link>
        </Button>
      </div>
    </div>
  );
}
