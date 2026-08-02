import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CLASS12_MATH_CHAPTERS } from "@/engines/class12Math/types";
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

/* Placeholder data — visual pass */
const HERO = {
  accuracy: 78,
  questionsToday: 145,
  topicsPracticed: 12,
  goalTotal: 20,
  goalDone: 14,
};

const PRACTICE_MODES = [
  {
    id: "topic",
    icon: Target,
    title: "Topic Practice",
    description: "Practice questions from specific concepts.",
    accent: "from-emerald-500/20 to-emerald-600/5 text-emerald-700",
  },
  {
    id: "chapter",
    icon: BookOpen,
    title: "Chapter Practice",
    description: "Practice an entire chapter end to end.",
    accent: "from-blue-500/15 to-blue-600/5 text-blue-700",
  },
  {
    id: "timed",
    icon: Timer,
    title: "Timed Practice",
    description: "Focus on speed and accuracy under pressure.",
    accent: "from-violet-500/15 to-violet-600/5 text-violet-700",
  },
];

const SUBJECTS = [
  { id: "Mathematics", icon: Calculator, mastery: 74, color: "text-emerald-700 bg-emerald-500/10" },
  { id: "Physics", icon: Atom, mastery: 68, color: "text-blue-700 bg-blue-500/10" },
  { id: "Chemistry", icon: Beaker, mastery: 61, color: "text-violet-700 bg-violet-500/10" },
  { id: "Biology", icon: Dna, mastery: 72, color: "text-teal-700 bg-teal-500/10" },
  { id: "English", icon: BookOpen, mastery: 85, color: "text-amber-800 bg-amber-500/10" },
];

const WEAK_TOPICS = [
  { topic: "Determinants", subject: "Mathematics", accuracy: 42, questions: 48 },
  { topic: "Integration by Substitution", subject: "Mathematics", accuracy: 51, questions: 36 },
];

const STRONG_TOPICS = [
  { topic: "Probability", subject: "Mathematics", accuracy: 91, questions: 52 },
  { topic: "Vector Algebra", subject: "Mathematics", accuracy: 88, questions: 44 },
];

const RECENT_SESSIONS = [
  { topic: "Matrices – Determinants", accuracy: 45, correct: 4, incorrect: 4, time: "18 min ago" },
  { topic: "Probability – Bayes", accuracy: 82, correct: 9, incorrect: 2, time: "Yesterday" },
  { topic: "Integrals – Substitution", accuracy: 60, correct: 6, incorrect: 4, time: "2 days ago" },
];

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
      <div className="absolute inset-4 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-sm" />
      <div className="relative z-10 grid grid-cols-2 gap-3 p-6">
        <div className="w-14 h-14 rounded-2xl bg-[#e8c468]/25 flex items-center justify-center">
          <Calculator className="w-7 h-7 text-[#e8c468]" />
        </div>
        <div className="w-14 h-14 rounded-2xl bg-[#b2f0d4]/25 flex items-center justify-center mt-4">
          <Target className="w-7 h-7 text-[#b2f0d4]" />
        </div>
        <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center -mt-2">
          <Brain className="w-7 h-7 text-white/90" />
        </div>
        <div className="w-14 h-14 rounded-2xl bg-[#e8c468]/20 flex items-center justify-center">
          <Zap className="w-7 h-7 text-[#e8c468]" />
        </div>
      </div>
      <Sparkles className="absolute top-6 right-8 w-5 h-5 text-[#e8c468]/80" />
    </div>
  );
}

export default function PracticeHubPage() {
  const nav = useNavigate();
  const [selectedSubject, setSelectedSubject] = useState("Mathematics");
  const [questionSet, setQuestionSet] = useState<(typeof QUESTION_SETS)[number]["id"]>("10");
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("Medium");
  const [activeMode, setActiveMode] = useState<string | null>(null);

  const goalPct = Math.round((HERO.goalDone / HERO.goalTotal) * 100);

  const startSession = (chapter?: string, count?: number) => {
    if (questionSet === "recovery") {
      nav("/student/recovery");
      return;
    }
    if (questionSet === "revision") {
      nav("/student/revision");
      return;
    }
    const ch = chapter ?? CLASS12_MATH_CHAPTERS[0];
    const n = count ?? QUESTION_SETS.find((q) => q.id === questionSet)?.count ?? 10;
    if (selectedSubject === "Mathematics") {
      nav(`/student/practice/math12/session?chapter=${encodeURIComponent(ch)}&count=${n}`);
      return;
    }
    nav(
      `/student/practice/ai/session?subject=${encodeURIComponent(selectedSubject)}&chapter=${encodeURIComponent(ch)}&count=${n}`,
    );
  };

  return (
    <div className="practice-hub student-premium space-y-8 px-1 sm:px-0">
      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="ph-hero rounded-[2rem] overflow-hidden relative text-primary-foreground">
        <div className="ph-hero-glow absolute inset-0 pointer-events-none" />
        <div className="relative z-10 p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
                Class 12 · NCERT
              </p>
              <h1 className="font-['Sora'] text-3xl sm:text-4xl font-semibold mt-2 tracking-tight">Practice</h1>
              <p className="text-base text-primary-foreground/80 mt-2">
                Sharpen your skills. Practice with purpose.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
                {[
                  { label: "Accuracy", value: `${HERO.accuracy}%` },
                  { label: "Questions today", value: HERO.questionsToday },
                  { label: "Topics practiced", value: HERO.topicsPracticed },
                  { label: "Daily goal", value: `${HERO.goalDone}/${HERO.goalTotal}` },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm px-4 py-3"
                  >
                    <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">{s.label}</p>
                    <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 max-w-md">
                <div className="flex justify-between text-xs text-primary-foreground/75 mb-2">
                  <span>Daily goal progress</span>
                  <span className="font-semibold">{goalPct}%</span>
                </div>
                <Progress value={goalPct} className="h-2.5 bg-white/15 [&>div]:bg-[#e8c468]" />
                <p className="text-xs text-primary-foreground/60 mt-2">
                  {HERO.goalTotal - HERO.goalDone} more questions to hit today&apos;s target
                </p>
              </div>
            </div>
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* ── PRACTICE MODES ─────────────────────────────────── */}
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
                  "ph-mode-card ph-card rounded-2xl p-5 flex flex-col cursor-pointer",
                  active && "ring-2 ring-primary/30 border-primary/20",
                )}
                onClick={() => setActiveMode(m.id)}
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-4",
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
        </div>
      </section>

      {/* ── SUBJECTS ───────────────────────────────────────── */}
      <section>
        <SectionHeader title="Subjects" subtitle="Pick a subject and track your mastery." />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {SUBJECTS.map((s) => {
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
                <p className="font-semibold text-sm text-foreground">{s.id}</p>
                <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{s.mastery}%</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Mastery</p>
                <Progress value={s.mastery} className="h-1.5 mt-3 bg-muted [&>div]:bg-primary" />
              </button>
            );
          })}
        </div>
      </section>

      {/* ── RECOMMENDED TOPICS ─────────────────────────────── */}
      <section>
        <SectionHeader title="Recommended topics" subtitle="Based on your recent performance." />
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-orange-700 flex items-center gap-1.5 mb-3">
              <Flame className="w-3.5 h-3.5" /> Weak topics — practice these
            </p>
            <div className="space-y-3">
              {WEAK_TOPICS.map((t) => (
                <TopicCard key={t.topic} {...t} variant="weak" onPractice={() => startSession(t.topic, 10)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5 mb-3">
              <TrendingUp className="w-3.5 h-3.5" /> Strong topics — keep momentum
            </p>
            <div className="space-y-3">
              {STRONG_TOPICS.map((t) => (
                <TopicCard key={t.topic} {...t} variant="strong" onPractice={() => startSession(t.topic, 10)} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── QUICK START ────────────────────────────────────── */}
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
              Subject: <span className="font-medium text-foreground">{selectedSubject}</span>
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
            className="rounded-2xl h-14 px-10 text-base font-semibold shadow-lg shrink-0 w-full lg:w-auto"
            onClick={() => startSession()}
          >
            <Play className="w-5 h-5 mr-2" />
            Start Now
          </Button>
        </div>
      </section>

      {/* ── SMART RECOMMENDATION ───────────────────────────── */}
      <section className="ph-ai-card rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row gap-5 items-start">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider mb-2 border-blue-200 text-blue-700">
              Smart recommendation
            </Badge>
            <h3 className="font-semibold text-lg text-foreground">Focus on Determinants today</h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-xl">
              Improving this topic can increase your overall accuracy by{" "}
              <span className="font-semibold text-emerald-700">7%</span>. You have 48 questions available
              — a 10-question session takes about 15 minutes.
            </p>
            <Button size="sm" className="mt-4 rounded-full" onClick={() => startSession("Determinants", 10)}>
              Practice Determinants
            </Button>
          </div>
        </div>
      </section>

      {/* ── RECENT ACTIVITY ────────────────────────────────── */}
      <section>
        <SectionHeader title="Recent practice activity" subtitle="Review your latest sessions." />
        <div className="space-y-3">
          {RECENT_SESSIONS.map((s) => (
            <div key={s.topic} className="ph-card rounded-2xl p-5">
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
                  <Stat label="Correct" value={String(s.correct)} />
                  <Stat label="Incorrect" value={String(s.incorrect)} warn />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BOTTOM SUMMARY ─────────────────────────────────── */}
      <section className="ph-summary rounded-[1.75rem] px-6 py-8 sm:px-10 text-primary-foreground">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center sm:text-left">
          {[
            { label: "Total questions", value: "1,245" },
            { label: "Overall accuracy", value: "78%" },
            { label: "Practice time", value: "24h 30m" },
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
  accuracy,
  questions,
  variant,
  onPractice,
}: {
  topic: string;
  subject: string;
  accuracy: number;
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
        <p className="font-semibold text-foreground">{topic}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{subject}</p>
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          <span className={cn("font-semibold tabular-nums", weak ? "text-orange-700" : "text-emerald-700")}>
            {accuracy}% accuracy
          </span>
          <span className="text-muted-foreground">{questions} questions available</span>
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
