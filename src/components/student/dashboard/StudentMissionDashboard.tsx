import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Award,
  BookOpen,
  Brain,
  CalendarCheck,
  Flame,
  Medal,
  Play,
  RefreshCw,
  Sparkles,
  Sword,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import "./student-dashboard.css";
import "../flow/student-panel-premium.css";

/**
 * DESIGN-ONLY — not mounted under StudentDashboard `/student/*`.
 * Fixture PLACEHOLDER values are layout review only. Live home: `gurukul/pages/Dashboard.tsx`.
 * Do not remount until wired to Academic Engine snapshot / XP / practice aggregates.
 */
const PLACEHOLDER = {
  practiceAccuracy: 78,
  todayGoal: "Complete 12 Recovery Questions",
  goalProgress: 58,
  goalCompleted: 7,
  goalTotal: 12,
  expectedImprovement: "+5% Accuracy",
  missions: [
    {
      icon: Wrench,
      title: "Recovery Tasks",
      description: "12 questions waiting from your mistake book",
      cta: "Start",
      to: "/student/recovery",
      tone: "emerald" as const,
    },
    {
      icon: RefreshCw,
      title: "Revision Tasks",
      description: "4 concepts due for spaced revision today",
      cta: "Continue",
      to: "/student/revision",
      tone: "gold" as const,
    },
    {
      icon: BookOpen,
      title: "DPP Pending",
      description: "1 assigned practice sheet from your teacher",
      cta: "Start",
      to: "/student/homework",
      tone: "slate" as const,
    },
    {
      icon: Sword,
      title: "Battleground Available",
      description: "3 classmates online — challenge someone now",
      cta: "Play",
      to: "/student/battleground",
      tone: "battle" as const,
    },
  ],
  health: [
    { icon: Target, label: "Accuracy", value: 78, trend: "+6%", trendUp: true },
    { icon: Brain, label: "Concept Mastery", value: 71, trend: "+4%", trendUp: true },
    { icon: CalendarCheck, label: "Consistency", value: 85, trend: "+2%", trendUp: true },
    { icon: Wrench, label: "Recovery Completion", value: 62, trend: "-3%", trendUp: false },
  ],
  strongConcepts: ["Matrices", "Probability", "Linear Programming", "Quadratic Equations"],
  weakConcepts: ["Determinants", "Integration", "Inverse Matrix", "Vector Algebra"],
  recoveryPending: 12,
  recoveryWeak: ["Determinants", "Inverse Matrix"],
  weeklyTrend: [
    { day: "Mon", accuracy: 68 },
    { day: "Tue", accuracy: 71 },
    { day: "Wed", accuracy: 69 },
    { day: "Thu", accuracy: 74 },
    { day: "Fri", accuracy: 76 },
    { day: "Sat", accuracy: 78 },
    { day: "Sun", accuracy: 78 },
  ],
  achievements: [
    { icon: Flame, label: "Day Streak", value: "7 days", sub: "Keep it going!" },
    { icon: Trophy, label: "Top Ranking", value: "#3", sub: "In your class" },
    { icon: Medal, label: "Badge Earned", value: "Rising Star", sub: "This week" },
    { icon: Zap, label: "XP Earned", value: "2,450", sub: "Level 12" },
  ],
  radarScores: [
    { label: "Matrices", score: 92 },
    { label: "Probability", score: 88 },
    { label: "Determinants", score: 42 },
    { label: "Integration", score: 38 },
    { label: "Vectors", score: 55 },
    { label: "Quadratic", score: 85 },
  ],
};

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function HeroRing({ value, label = "Accuracy", size = 148 }: { value: number; label?: string; size?: number }) {
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} className="sd-ring-track" strokeWidth={10} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="sd-ring-fill"
          strokeWidth={10}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-primary-foreground">
        <span className="text-4xl font-bold tabular-nums tracking-tight">{value}%</span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-primary-foreground/70 mt-0.5">
          {label}
        </span>
      </div>
    </div>
  );
}

function ConceptRadarViz({ scores }: { scores: typeof PLACEHOLDER.radarScores }) {
  const n = scores.length;
  const cx = 100;
  const cy = 100;
  const maxR = 72;
  const angleStep = (2 * Math.PI) / n;

  const points = scores.map((s, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (s.score / 100) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), ...s };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="relative flex items-center justify-center w-full max-w-[220px] mx-auto aspect-square">
      <div className="absolute inset-0 sd-radar-center rounded-full" />
      <svg viewBox="0 0 200 200" className="w-full h-full relative z-10">
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <polygon
            key={scale}
            points={scores
              .map((_, i) => {
                const angle = i * angleStep - Math.PI / 2;
                const r = maxR * scale;
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgba(0,51,36,0.1)"
            strokeWidth="1"
          />
        ))}
        <polygon
          points={polygon}
          fill="rgba(151,211,184,0.35)"
          stroke="#0d5c44"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill={p.score >= 70 ? "#0d5c44" : "#e8a04a"} />
        ))}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center bg-card backdrop-blur-sm rounded-2xl px-3 py-2 shadow-sm border border-emerald-100">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mastery</p>
          <p className="text-lg font-bold text-emerald-900 tabular-nums">71%</p>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="sd-section-title text-lg sm:text-xl font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

type StudentMissionDashboardProps = {
  studentName?: string;
};

export function StudentMissionDashboard({ studentName = "Student" }: StudentMissionDashboardProps) {
  const firstName = studentName.split(" ")[0];
  const p = PLACEHOLDER;

  return (
    <div className="sd-dashboard student-premium space-y-8 px-1 sm:px-0">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="sd-hero rounded-[2rem] overflow-hidden relative text-primary-foreground">
        <div className="sd-hero-glow absolute inset-0 pointer-events-none" />
        <div className="sd-hero-orb absolute -bottom-16 -left-16 w-64 h-64 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-10">
            <div className="flex-1 min-w-0">
              <p className="text-sm sm:text-base font-medium text-primary-foreground/80">
                {timeGreeting()}, {firstName} 👋
              </p>
              <h1 className="font-['Sora'] text-2xl sm:text-3xl lg:text-4xl font-semibold mt-2 tracking-tight leading-tight">
                Continue your journey toward academic excellence.
              </h1>

              <div className="mt-8 grid sm:grid-cols-2 gap-4 max-w-xl">
                <div className="rounded-2xl bg-black/10 ring-1 ring-black/15 backdrop-blur-sm p-4">
                  <p className="text-[11px] uppercase tracking-wider text-primary-foreground/65">
                    Today&apos;s Goal
                  </p>
                  <p className="text-sm sm:text-base font-medium mt-1 leading-snug">{p.todayGoal}</p>
                  <div className="mt-3 space-y-1.5">
                    <div className="flex justify-between text-[11px] text-primary-foreground/70">
                      <span>
                        {p.goalCompleted} of {p.goalTotal} done
                      </span>
                      <span>{p.goalProgress}%</span>
                    </div>
                    <Progress value={p.goalProgress} className="h-2 bg-black/15 [&>div]:bg-[#e8c468]" />
                  </div>
                </div>
                <div className="rounded-2xl bg-black/10 ring-1 ring-black/15 backdrop-blur-sm p-4 flex flex-col justify-center">
                  <p className="text-[11px] uppercase tracking-wider text-primary-foreground/65">
                    Expected Improvement
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold mt-1 text-[#e8c468] flex items-center gap-2">
                    <TrendingUp className="w-6 h-6" />
                    {p.expectedImprovement}
                  </p>
                  <p className="text-xs text-primary-foreground/60 mt-1">If you complete today&apos;s goal</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center lg:items-end gap-3 shrink-0">
              <HeroRing value={p.practiceAccuracy} label="Accuracy" />
              <p className="text-sm font-medium text-primary-foreground/80">Practice accuracy</p>
              <div className="hidden lg:flex items-center gap-2 text-xs text-primary-foreground/60">
                <Sparkles className="w-3.5 h-3.5 text-[#e8c468]" />
                <span>From your recent practice &amp; recovery</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TODAY'S MISSION ────────────────────────────────── */}
      <section>
        <SectionHeader title="Today's Mission" subtitle="Your priorities for today — complete these to stay on track." />
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {p.missions.map((m) => {
            const Icon = m.icon;
            const toneClass =
              m.tone === "emerald"
                ? "text-emerald-700"
                : m.tone === "gold"
                  ? "text-amber-800"
                  : m.tone === "battle"
                    ? "text-violet-700"
                    : "text-slate-700";
            return (
              <div key={m.title} className="sd-mission-card sd-card rounded-2xl p-5 flex flex-col">
                <div
                  className={cn(
                    "w-11 h-11 rounded-2xl flex items-center justify-center mb-4",
                    toneClass,
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-foreground">{m.title}</h3>
                <p className="text-sm text-muted-foreground mt-1 flex-1 leading-relaxed">{m.description}</p>
                <Button size="sm" className="mt-4 rounded-full w-full sm:w-auto" asChild>
                  <Link to={m.to}>{m.cta}</Link>
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── ACADEMIC HEALTH ────────────────────────────────── */}
      <section>
        <SectionHeader title="Academic Health" subtitle="Your core learning metrics at a glance." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {p.health.map((h) => {
            const Icon = h.icon;
            return (
              <div key={h.label} className="sd-metric-card sd-card rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span
                    className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full",
                      h.trendUp ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800",
                    )}
                  >
                    {h.trend}
                  </span>
                </div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {h.label}
                </p>
                <p className="text-3xl font-bold text-foreground mt-1 tabular-nums">{h.value}%</p>
                <p className="text-[11px] text-muted-foreground mt-1">from last week</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CONCEPT RADAR ──────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Concept Radar"
          subtitle="Strengths and gaps — know where to focus your energy."
        />
        <div className="sd-card rounded-3xl p-6 sm:p-8">
          <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-8 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5 mb-4">
                <Target className="w-3.5 h-3.5" /> Strong Concepts
              </p>
              <ul className="space-y-2.5">
                {p.strongConcepts.map((c) => (
                  <li
                    key={c}
                    className="flex items-center gap-3 rounded-xl bg-emerald-50/80 border border-emerald-200/60 px-4 py-3"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-sm font-medium text-emerald-950">{c}</span>
                    <span className="ml-auto text-xs font-semibold text-emerald-700 tabular-nums">Strong</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="order-first lg:order-none py-4 lg:py-0">
              <ConceptRadarViz scores={p.radarScores} />
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-orange-700 flex items-center gap-1.5 mb-4">
                <Wrench className="w-3.5 h-3.5" /> Needs Attention
              </p>
              <ul className="space-y-2.5">
                {p.weakConcepts.map((c) => (
                  <li
                    key={c}
                    className="flex items-center gap-3 rounded-xl bg-orange-50/80 border border-orange-200/60 px-4 py-3"
                  >
                    <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-sm font-medium text-orange-950">{c}</span>
                    <span className="ml-auto text-xs font-semibold text-orange-700 tabular-nums">Focus</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── RECOVERY CENTER ────────────────────────────────── */}
      <section className="sd-recovery rounded-[2rem] p-6 sm:p-8 lg:p-10">
        <div className="flex flex-col lg:flex-row lg:items-center gap-8">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Recovery Center</p>
            <h2 className="sd-section-title text-2xl sm:text-3xl font-semibold text-foreground mt-2">
              Fix what you missed — turn mistakes into mastery.
            </h2>
            <div className="flex flex-wrap gap-8 mt-6">
              <div>
                <p className="text-4xl sm:text-5xl font-bold text-foreground tabular-nums">
                  {p.recoveryPending}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Recovery questions pending</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Weak concepts
                </p>
                <div className="flex flex-wrap gap-2">
                  {p.recoveryWeak.map((c) => (
                    <span
                      key={c}
                      className="text-sm font-medium px-3 py-1.5 rounded-full bg-card border border-orange-200 text-orange-900 shadow-sm"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <Button
            size="lg"
            className="rounded-2xl h-14 px-10 text-base font-semibold shadow-lg shrink-0 w-full lg:w-auto"
            asChild
          >
            <Link to="/student/recovery">
              Fix My Mistakes <Wrench className="w-5 h-5 ml-2" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ── PROGRESS TREND ─────────────────────────────────── */}
      <section>
        <SectionHeader title="Weekly Progress" subtitle="Accuracy trend — consistency builds excellence." />
        <div className="sd-card rounded-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Accuracy Trend</p>
                <p className="text-xs text-muted-foreground">Last 7 days</p>
              </div>
            </div>
            <span className="text-sm font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
              +10% growth this week
            </span>
          </div>
          <div className="h-52 w-full sd-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={p.weeklyTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "#6b7c75" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[50, 100]}
                  tick={{ fontSize: 11, fill: "#6b7c75" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid rgba(0,51,36,0.1)",
                    borderRadius: 12,
                    fontSize: 12,
                    boxShadow: "0 8px 24px -4px rgba(0,51,36,0.12)",
                  }}
                  formatter={(v: number) => [`${v}%`, "Accuracy"]}
                />
                <Area
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#003324"
                  strokeWidth={2.5}
                  fill="#0d5c44"
                  fillOpacity={0.12}
                  dot={{ r: 4, fill: "#003324", strokeWidth: 2, stroke: "#fff" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ── BATTLEGROUND ───────────────────────────────────── */}
      <section>
        <SectionHeader title="Battleground" subtitle="Compete, practice, and level up with your classmates." />
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: Target,
              title: "Practice Solo",
              description: "Warm up with timed questions before you challenge anyone.",
              cta: "Start Solo",
              to: "/student/battleground",
              accent: "",
            },
            {
              icon: Sword,
              title: "Challenge Friend",
              description: "Pick a classmate and battle head-in real time.",
              cta: "Challenge",
              to: "/student/battleground",
              accent: "",
            },
            {
              icon: Users,
              title: "Class Lobby",
              description: "Join the live lobby and compete with your entire class.",
              cta: "Enter Lobby",
              to: "/student/battleground",
              accent: "",
            },
          ].map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.title}
                className="sd-battle-card rounded-3xl p-6 flex flex-col transition-all duration-200"
              >
                <div
                  className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center mb-5",
                    b.accent,
                  )}
                >
                  <Icon className="w-7 h-7 text-[#e8c468]" />
                </div>
                <h3 className="text-lg font-semibold">{b.title}</h3>
                <p className="text-sm text-primary-foreground/70 mt-2 flex-1 leading-relaxed">
                  {b.description}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-5 rounded-full bg-black/15 hover:bg-muted text-primary-foreground border-0"
                  asChild
                >
                  <Link to={b.to}>
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                    {b.cta}
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── ACHIEVEMENT ZONE ───────────────────────────────── */}
      <section>
        <SectionHeader title="Achievement Zone" subtitle="Celebrate your wins and stay motivated." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {p.achievements.map((a) => {
            const Icon = a.icon;
            return (
              <div key={a.label} className="sd-achievement sd-card rounded-2xl p-5 text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto text-amber-700 border border-amber-200/50">
                  <Icon className="w-6 h-6" />
                </div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mt-4">
                  {a.label}
                </p>
                <p className="text-xl sm:text-2xl font-bold text-foreground mt-1">{a.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{a.sub}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <Link to="/student/leaderboard">
              <Award className="w-3.5 h-3.5 mr-1.5" />
              View full leaderboard
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}