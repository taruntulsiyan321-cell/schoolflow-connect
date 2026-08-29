import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Atom,
  Beaker,
  BookOpen,
  Brain,
  Calculator,
  Clock,
  Dna,
  Flame,
  Play,
  Shuffle,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import "./practice-hub.css";
import "../dashboard/student-dashboard.css";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicDisplay";
import { preferRealAcademicLabel } from "@/lib/qualityGuards";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useAcademicContext, PracticeService, WEAK_CONCEPT_THRESHOLD } from "@/academic";
import { practiceAccuracyFromSnapshot } from "@/lib/learningMetrics";
import { resolvePracticeSessionStats } from "@/lib/practiceSessionStats";
import { toDisplayText } from "@/lib/presentation";

/* Mode chrome only — not academic stats */
const PRACTICE_MODES = [
  {
    id: "topic",
    icon: Target,
    title: "Topic Practice",
    description: "Practice questions from specific concepts.",
    accent: "text-emerald-700",
  },
  {
    id: "chapter",
    icon: BookOpen,
    title: "Chapter Practice",
    description: "Practice an entire chapter end to end.",
    accent: "text-blue-700",
  },
  {
    id: "timed",
    icon: Timer,
    title: "Timed Practice",
    description: "Focus on speed and accuracy under pressure.",
    accent: "text-violet-700",
  },
];

const SUBJECT_ICONS: Record<string, typeof Calculator> = {
  Mathematics: Calculator,
  Math: Calculator,
  Physics: Atom,
  Chemistry: Beaker,
  Biology: Dna,
  English: BookOpen,
};

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "text-emerald-700 bg-emerald-500/10",
  Math: "text-emerald-700 bg-emerald-500/10",
  Physics: "text-blue-700 bg-blue-500/10",
  Chemistry: "text-violet-700 bg-violet-500/10",
  Biology: "text-teal-700 bg-teal-500/10",
  English: "text-amber-800 bg-amber-500/10",
};

const QUESTION_SETS = [
  { id: "10", label: "Random 10 Questions", count: 10 },
  { id: "20", label: "Random 20 Questions", count: 20 },
  { id: "recovery", label: "Recovery Questions", count: 10 },
  { id: "revision", label: "Revision Questions", count: 10 },
] as const;

const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;

function HeroIllustration() {
  return (
    <div className="ph-illustration relative w-full max-w-[220px] aspect-square mx-auto lg:mx-0 lg:ml-auto rounded-[2rem] flex items-center justify-center">
      <div className="absolute inset-4 rounded-3xl border border-black/10 bg-black/5 backdrop-blur-sm" />
      <div className="relative z-10 grid grid-cols-2 gap-3 p-6">
        <div className="w-14 h-14 rounded-2xl bg-[#e8c468]/25 flex items-center justify-center">
          <Calculator className="w-7 h-7 text-[#e8c468]" />
        </div>
        <div className="w-14 h-14 rounded-2xl bg-[#b2f0d4]/25 flex items-center justify-center mt-4">
          <Target className="w-7 h-7 text-[#b2f0d4]" />
        </div>
        <div className="w-14 h-14 rounded-2xl bg-black/15 flex items-center justify-center -mt-2">
          <Brain className="w-7 h-7 text-foreground/90" />
        </div>
        <div className="w-14 h-14 rounded-2xl bg-[#e8c468]/20 flex items-center justify-center">
          <Zap className="w-7 h-7 text-[#e8c468]" />
        </div>
      </div>
      <Sparkles className="absolute top-6 right-8 w-5 h-5 text-[#e8c468]/80" />
    </div>
  );
}

function formatRelativeSession(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 60) return `${Math.max(1, diffMin)} min ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  if (diffMin < 2880) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PracticeHubPage() {
  const nav = useNavigate();
  const { ctx, ready: academicReady } = useAcademicContext();
  const { data: snapshot, loading: snapLoading } = useStudentAcademicSnapshot();
  const { items: mastery, loading: masteryLoading } = useConceptMastery();

  const [selectedSubject, setSelectedSubject] = useState("Mathematics");
  const [questionSet, setQuestionSet] = useState<(typeof QUESTION_SETS)[number]["id"]>("10");
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("Medium");
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [bankSubjects, setBankSubjects] = useState<string[]>([]);
  const [recent, setRecent] = useState<
    Array<{
      id: string;
      topic: string;
      accuracy: number;
      correct: number;
      incorrect: number;
      time: string;
    }>
  >([]);

  useEffect(() => {
    if (!ctx || !academicReady) return;
    let cancelled = false;
    (async () => {
      try {
        const names = await PracticeService.listBankSubjects(ctx);
        if (!cancelled && names.length) {
          setBankSubjects(names);
          setSelectedSubject((prev) => (names.includes(prev) ? prev : names[0]));
        }
      } catch {
        if (!cancelled) setBankSubjects([]);
      }
      try {
        const rows = await PracticeService.listRecentFinished(ctx, 5);
        if (cancelled) return;
        setRecent(
          (rows ?? []).map((r) => {
            const stats = resolvePracticeSessionStats(r);
            return {
              id: r.id,
              topic: [displaySubject(r.subject), r.chapter ? displayChapter(r.chapter) : null]
                .filter(Boolean)
                .join(" – "),
              accuracy: stats.accuracy,
              correct: stats.correctCount,
              incorrect: stats.wrongCount,
              time: formatRelativeSession(r.finished_at),
            };
          }),
        );
      } catch {
        if (!cancelled) setRecent([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady]);

  const accuracy = practiceAccuracyFromSnapshot(snapshot) || 0;
  const heatmap = snapshot?.activity_heatmap ?? [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayRow = heatmap.find((h) => h.date === todayKey);
  const questionsToday =
    (todayRow?.test ?? 0) + (todayRow?.homework ?? 0) + (todayRow?.self_practice ?? 0);
  const topicsPracticed = new Set(
    mastery.map((m) => `${m.subject}:${m.chapter ?? m.concept}`),
  ).size;

  const subjects = useMemo(() => {
    const names =
      bankSubjects.length > 0
        ? bankSubjects
        : Array.from(new Set(mastery.map((m) => m.subject).filter(Boolean)));
    return names.slice(0, 8).map((name) => {
      const rows = mastery.filter((m) => m.subject === name);
      const masteryPct =
        rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + (r.mastery_score ?? 0), 0) / rows.length)
          : 0;
      return {
        id: name,
        mastery: masteryPct,
        color: SUBJECT_COLORS[name] ?? "text-slate-700 bg-slate-500/10",
        icon: SUBJECT_ICONS[name] ?? BookOpen,
      };
    });
  }, [bankSubjects, mastery]);

  const weakTopics = useMemo(() => {
    const fromSnap = (snapshot?.weak_topics ?? [])
      .map((t) => {
        const topic = preferRealAcademicLabel(t.topic, t.chapter);
        const subject = preferRealAcademicLabel(t.subject);
        if (!topic || !subject) return null;
        return { topic, subject, mastery: Math.round(t.accuracy ?? 0), questions: 0 };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .slice(0, 4);
    if (fromSnap.length) return fromSnap;
    return mastery
      .filter((m) => (m.mastery_score ?? 100) < WEAK_CONCEPT_THRESHOLD)
      .sort((a, b) => (a.mastery_score ?? 0) - (b.mastery_score ?? 0))
      .map((m) => {
        const topic = preferRealAcademicLabel(m.concept, m.chapter);
        const subject = preferRealAcademicLabel(m.subject);
        if (!topic || !subject) return null;
        return {
          topic,
          subject,
          mastery: Math.round(m.mastery_score ?? 0),
          questions: m.total_attempts ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .slice(0, 4);
  }, [snapshot, mastery]);

  const strongTopics = useMemo(() => {
    const fromSnap = (snapshot?.strong_topics ?? [])
      .map((t) => {
        const topic = preferRealAcademicLabel(t.topic, t.chapter);
        const subject = preferRealAcademicLabel(t.subject);
        if (!topic || !subject) return null;
        return { topic, subject, mastery: Math.round(t.accuracy ?? 0), questions: 0 };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .slice(0, 4);
    if (fromSnap.length) return fromSnap;
    return mastery
      .filter((m) => (m.mastery_score ?? 0) >= 80)
      .sort((a, b) => (b.mastery_score ?? 0) - (a.mastery_score ?? 0))
      .map((m) => {
        const topic = preferRealAcademicLabel(m.concept, m.chapter);
        const subject = preferRealAcademicLabel(m.subject);
        if (!topic || !subject) return null;
        return {
          topic,
          subject,
          mastery: Math.round(m.mastery_score ?? 0),
          questions: m.total_attempts ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .slice(0, 4);
  }, [snapshot, mastery]);

  const focusTopic = weakTopics[0];
  const loading = snapLoading || masteryLoading;

  const totalQuestions = mastery.reduce((s, m) => s + (m.total_attempts ?? 0), 0);
  const overallAccuracy = accuracy;
  const practiceMinutes = heatmap.reduce((s, h) => s + (h.minutes ?? 0), 0);
  const practiceTimeLabel =
    practiceMinutes >= 60
      ? `${Math.floor(practiceMinutes / 60)}h ${practiceMinutes % 60}m`
      : `${practiceMinutes}m`;

  const startSession = (chapter?: string, count?: number) => {
    if (questionSet === "recovery") {
      nav("/student/recovery");
      return;
    }
    if (questionSet === "revision") {
      nav("/student/revision");
      return;
    }
    const ch = preferRealAcademicLabel(chapter, focusTopic?.topic);
    const n = count ?? QUESTION_SETS.find((q) => q.id === questionSet)?.count ?? 10;
    if (!ch) {
      toast.message("Pick a weak/strong topic first — Start needs a real chapter.");
      return;
    }
    if (selectedSubject === "Mathematics" || selectedSubject === "Math") {
      nav(`/student/practice/math12/session?chapter=${encodeURIComponent(ch)}&count=${n}&difficulty=${encodeURIComponent(difficulty)}`);
      return;
    }
    nav(
      `/student/practice/ai/session?subject=${encodeURIComponent(selectedSubject)}&chapter=${encodeURIComponent(ch)}&count=${n}&difficulty=${encodeURIComponent(difficulty)}`,
    );
  };

  return (
    <div className="practice-hub student-premium space-y-8 px-1 sm:px-0">
      <section className="ph-hero rounded-[2rem] overflow-hidden relative text-primary-foreground">
        <div className="ph-hero-glow absolute inset-0 pointer-events-none" />
        <div className="relative z-10 p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
                Practice Hub
              </p>
              <h1 className="font-['Sora'] text-3xl sm:text-4xl font-semibold mt-2 tracking-tight">Practice</h1>
              <p className="text-base text-primary-foreground/80 mt-2">
                Sharpen your skills. Practice with purpose.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
                {[
                  { label: "Accuracy", value: loading ? "…" : `${overallAccuracy}%` },
                  { label: "Questions today", value: loading ? "…" : questionsToday },
                  { label: "Topics practiced", value: loading ? "…" : topicsPracticed },
                  { label: "Daily goal", value: "—" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl bg-black/10 ring-1 ring-black/15 backdrop-blur-sm px-4 py-3"
                  >
                    <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">{s.label}</p>
                    <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 max-w-md">
                <div className="flex justify-between text-xs text-primary-foreground/75 mb-2">
                  <span>Activity today</span>
                  <span className="font-semibold">{loading ? "…" : questionsToday}</span>
                </div>
                <Progress value={0} className="h-2.5 bg-black/15 [&>div]:bg-[#e8c468]" />
                <p className="text-xs text-primary-foreground/60 mt-2">
                  {loading ? "…" : `${questionsToday} practice activity point${questionsToday === 1 ? "" : "s"} today — no daily goal configured`}
                </p>
              </div>
            </div>
            <HeroIllustration />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Practice modes" subtitle="Choose how you want to train today." />
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PRACTICE_MODES.map((m) => {
            const Icon = m.icon;
            const active = activeMode === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "ph-mode-card ph-card rounded-2xl p-5 flex flex-col cursor-pointer transition-transform hover:-translate-y-0.5",
                  active && "ring-2 ring-primary/30 border-primary/20",
                )}
                onClick={() => setActiveMode(m.id)}
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center mb-4",
                    m.accent,
                  )}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-foreground">{m.title}</h3>
                <p className="text-sm text-muted-foreground mt-1 flex-1 leading-relaxed">{m.description}</p>
                <Button
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="mt-4 rounded-full w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMode(m.id);
                    document.getElementById("quick-start")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Start
                </Button>
              </div>
            );
          })}
          <div
            className="ph-mode-card ph-card rounded-2xl p-5 flex flex-col cursor-pointer transition-transform hover:-translate-y-0.5"
            onClick={() => nav("/student/practice")}
          >
            <div className="w-12 h-12 rounded-2xl text-amber-700 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-foreground">All practice modes</h3>
            <p className="text-sm text-muted-foreground mt-1 flex-1 leading-relaxed">
              Open the full Practice hub with history and saved sessions.
            </p>
            <Button size="sm" variant="outline" className="mt-4 rounded-full w-full">
              Open hub
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Subjects" subtitle="Pick a subject and track your mastery." />
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No subjects in your bank yet for this class.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {subjects.map((s) => {
              const Icon = s.icon;
              const selected = selectedSubject === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSubject(s.id)}
                  className={cn(
                    "ph-card rounded-2xl p-4 text-left transition-all",
                    selected && "ring-2 ring-primary/25 border-primary/20 scale-[1.02]",
                  )}
                >
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", s.color)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="font-semibold text-sm text-foreground">{displaySubject(s.id)}</p>
                  <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{s.mastery}%</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Mastery</p>
                  <Progress value={s.mastery} className="h-1.5 mt-3 bg-muted [&>div]:bg-primary" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionHeader title="Recommended topics" subtitle="Based on your recent performance." />
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-orange-700 flex items-center gap-1.5 mb-3">
              <Flame className="w-3.5 h-3.5" /> Weak topics — practice these
            </p>
            <div className="space-y-3">
              {weakTopics.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No weak topics tracked yet.</p>
              ) : (
                weakTopics.map((t) => (
                  <TopicCard key={`${t.subject}-${t.topic}`} {...t} variant="weak" onPractice={() => startSession(t.topic, 10)} />
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5 mb-3">
              <TrendingUp className="w-3.5 h-3.5" /> Strong topics — keep momentum
            </p>
            <div className="space-y-3">
              {strongTopics.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No strong topics yet — keep practicing.</p>
              ) : (
                strongTopics.map((t) => (
                  <TopicCard key={`${t.subject}-${t.topic}`} {...t} variant="strong" onPractice={() => startSession(t.topic, 10)} />
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section id="quick-start" className="ph-quick-start rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end gap-8">
          <div className="flex-1 space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Quick start</p>
              <h2 className="font-['Sora'] text-2xl sm:text-3xl font-semibold text-foreground mt-1">
                Start practicing in one click
              </h2>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2">Question set</p>
              <div className="flex flex-wrap gap-2">
                {QUESTION_SETS.map((q) => (
                  <Button
                    key={q.id}
                    type="button"
                    size="sm"
                    variant={questionSet === q.id ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setQuestionSet(q.id)}
                  >
                    {q.id === "10" || q.id === "20" ? <Shuffle className="w-3.5 h-3.5 mr-1.5" /> : null}
                    {q.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2">Difficulty</p>
              <div className="flex flex-wrap gap-2">
                {DIFFICULTIES.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    variant={difficulty === d ? "default" : "outline"}
                    className="rounded-full min-w-[5rem]"
                    onClick={() => setDifficulty(d)}
                  >
                    {d}
                  </Button>
                ))}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Subject: <span className="font-medium text-foreground">{displaySubject(selectedSubject)}</span>
              {activeMode && (
                <>
                  {" "}
                  · Mode: <span className="font-medium text-foreground capitalize">{activeMode}</span>
                </>
              )}
            </p>
          </div>

          <Button
            size="lg"
            className="rounded-2xl h-14 px-10 text-base font-semibold shadow-lg shrink-0 w-full lg:w-auto active:scale-[0.98] transition-transform"
            onClick={() => startSession()}
          >
            <Play className="w-5 h-5 mr-2" />
            Start Now
          </Button>
        </div>
      </section>

      <section className="ph-ai-card rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row gap-5 items-start">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider mb-2 border-blue-200 text-blue-700">
              Smart recommendation
            </Badge>
            {focusTopic ? (
              <>
                <h3 className="font-semibold text-lg text-foreground">
                  Focus on {displayTopic(focusTopic.topic)} today
                </h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-xl">
                  Your mastery here is {focusTopic.mastery}%. A short session on this topic can strengthen{" "}
                  {displaySubject(focusTopic.subject)}.
                </p>
                <Button
                  size="sm"
                  className="mt-4 rounded-full"
                  onClick={() => startSession(focusTopic.topic, 10)}
                >
                  Practice {displayTopic(focusTopic.topic)}
                </Button>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-lg text-foreground">Keep a daily practice habit</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-xl">
                  No weak topics yet. Start a short session to build your mastery baseline.
                </p>
                <Button size="sm" className="mt-4 rounded-full" onClick={() => startSession()}>
                  Start practice
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title="Recent practice activity" subtitle="Review your latest sessions." />
        <div className="space-y-3">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">No practice sessions yet.</p>
          ) : (
            recent.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ph-card rounded-2xl p-5 w-full text-left transition-shadow hover:shadow-sm"
                onClick={() => nav(`/student/practice/session/${s.id}/result`)}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-foreground">{s.topic}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {s.time}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-4 sm:gap-6">
                    <Stat label="Accuracy" value={`${s.accuracy}%`} highlight={s.accuracy >= 75} />
                    <Stat label="Correct" value={toDisplayText(s.correct)} />
                    <Stat label="Incorrect" value={toDisplayText(s.incorrect)} warn />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="ph-summary rounded-[1.75rem] px-6 py-8 sm:px-10 text-primary-foreground">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center sm:text-left">
          {[
            { label: "Total questions", value: String(totalQuestions) },
            { label: "Overall accuracy", value: `${overallAccuracy}%` },
            { label: "Practice time", value: practiceTimeLabel },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xs uppercase tracking-wider text-primary-foreground/65">{s.label}</p>
              <p className="text-3xl sm:text-4xl font-bold mt-1 tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

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

function TopicCard({
  topic,
  subject,
  mastery,
  questions,
  variant,
  onPractice,
}: {
  topic: string;
  subject: string;
  mastery: number;
  questions: number;
  variant: "weak" | "strong";
  onPractice: () => void;
}) {
  const weak = variant === "weak";
  return (
    <div
      className={cn(
        "ph-card rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4",
        weak ? "border-orange-200/50" : "border-emerald-200/50",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground">{displayTopic(topic)}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{displaySubject(subject)}</p>
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          <span className={cn("font-semibold tabular-nums", weak ? "text-orange-700" : "text-emerald-700")}>
            {mastery}% mastery
          </span>
          {questions > 0 && (
            <span className="text-muted-foreground">{questions} attempts tracked</span>
          )}
        </div>
      </div>
      <Button size="sm" className="rounded-full shrink-0" variant={weak ? "default" : "outline"} onClick={onPractice}>
        Practice
      </Button>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="text-center sm:text-left">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          highlight && "text-emerald-700",
          warn && "text-orange-700",
          !highlight && !warn && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}