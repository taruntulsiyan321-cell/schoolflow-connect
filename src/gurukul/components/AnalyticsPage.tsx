/**
 * DESIGN-ONLY — not mounted under StudentDashboard `/student/*`.
 * Contains fixture Arjun/XP demo stats for layout review only.
 * Live analysis route: `src/gurukul/pages/Analysis.tsx`.
 */
import { useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
} from "recharts";
import {
  Flame,
  Zap,
  Target,
  TrendingUp,
  TrendingDown,
  Brain,
  Trophy,
  Star,
  BookOpen,
  Clock,
  BarChart2,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Activity,
} from "lucide-react";

// ── Design fixture data (unmounted — do not use as product fallbacks) ────────

const student = {
  name: "Arjun Sharma",
  class: "XII — Science",
  avatar: "AS",
  xp: 8420,
  level: 14,
  streak: 12,
  rank: 3,
  totalStudents: 48,
  examReadiness: 74,
  accuracy: 81,
  attendance: 92,
};

const subjectData = [
  { subject: "Physics", accuracy: 88, attempts: 142, trend: +4 },
  { subject: "Chemistry", accuracy: 73, attempts: 98, trend: -2 },
  { subject: "Mathematics", accuracy: 91, attempts: 210, trend: +7 },
  { subject: "Biology", accuracy: 65, attempts: 76, trend: -5 },
  { subject: "English", accuracy: 84, attempts: 54, trend: +2 },
];

const radarData = [
  { subject: "Physics", score: 88 },
  { subject: "Chem", score: 73 },
  { subject: "Maths", score: 91 },
  { subject: "Bio", score: 65 },
  { subject: "English", score: 84 },
];

const weeklyActivity = [
  { day: "Mon", dpp: 12, practice: 8, battles: 3 },
  { day: "Tue", dpp: 18, practice: 14, battles: 5 },
  { day: "Wed", dpp: 6, practice: 20, battles: 0 },
  { day: "Thu", dpp: 22, practice: 10, battles: 8 },
  { day: "Fri", dpp: 15, practice: 18, battles: 4 },
  { day: "Sat", dpp: 28, practice: 22, battles: 10 },
  { day: "Sun", dpp: 8, practice: 6, battles: 2 },
];

const accuracyTrend = [
  { week: "W1", score: 62 },
  { week: "W2", score: 67 },
  { week: "W3", score: 71 },
  { week: "W4", score: 69 },
  { week: "W5", score: 75 },
  { week: "W6", score: 78 },
  { week: "W7", score: 81 },
];

const strongConcepts = [
  { concept: "Integration", subject: "Maths", score: 94 },
  { concept: "Optics", subject: "Physics", score: 91 },
  { concept: "Algebra", subject: "Maths", score: 89 },
  { concept: "Thermodynamics", subject: "Physics", score: 86 },
  { concept: "Grammar", subject: "English", score: 85 },
];

const weakConcepts = [
  { concept: "Organic Chemistry", subject: "Chemistry", score: 51, mistakes: 14 },
  { concept: "Genetics", subject: "Biology", score: 48, mistakes: 11 },
  { concept: "Electrochemistry", subject: "Chemistry", score: 55, mistakes: 9 },
  { concept: "Plant Physiology", subject: "Biology", score: 58, mistakes: 7 },
];

const recentSessions = [
  { date: "Today, 9:14 AM", subject: "Mathematics", questions: 25, correct: 22, duration: "18m" },
  { date: "Yesterday, 7:30 PM", subject: "Physics", questions: 20, correct: 17, duration: "14m" },
  { date: "Jun 10, 4:15 PM", subject: "Chemistry", questions: 15, correct: 10, duration: "12m" },
  { date: "Jun 9, 8:00 AM", subject: "Mathematics", questions: 30, correct: 26, duration: "22m" },
];

const aiInsights = [
  "Your Maths accuracy jumped +7% this week — keep the Integration practice going.",
  "Organic Chemistry has 14 recurring mistakes. A focused 30-min recovery session today will break the pattern.",
  "You're on a 12-day streak 🔥 — don't let Sunday break it. Even 5 questions counts.",
  "Speed is your edge: you solve questions 18% faster than the class average.",
];

const heatmapData = (() => {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weeks = ["W1", "W2", "W3", "W4"];
  return weeks.map((week) => ({
    week,
    days: days.map((day) => ({
      day,
      value: Math.floor(Math.random() * 40),
    })),
  }));
})();

// ── Helpers ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function accuracyColor(v: number) {
  if (v >= 80) return "#4b9fd4";
  if (v >= 65) return "#c08a3a";
  return "#cc5069";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GlassCard({
  children,
  className,
  glow,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: "blue" | "cyan" | "amber" | "purple" | "green";
}) {
  const glowStyle: Record<string, string> = {
    blue: "shadow-[0_0_40px_rgba(59,130,246,0.15)] border-blue-500/20",
    cyan: "shadow-[0_0_40px_rgba(34,211,238,0.12)] border-cyan-400/20",
    amber: "shadow-[0_0_40px_rgba(245,158,11,0.12)] border-amber-400/20",
    purple: "shadow-[0_0_40px_rgba(167,139,250,0.12)] border-purple-400/20",
    green: "shadow-[0_0_40px_rgba(52,211,153,0.12)] border-emerald-400/20",
  };

  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface/90 backdrop-blur-sm",
        glow ? glowStyle[glow] : "border-border/70",
        className
      )}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-4 rounded-full bg-[#3b5bdb]" />
      <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{children}</span>
    </div>
  );
}

function ReadinessRing({ score }: { score: number }) {
  const size = 140;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 75 ? "#4b9fd4" : score >= 55 ? "#c08a3a" : "#cc5069";

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black tabular-nums" style={{ color }}>{score}%</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Ready</span>
      </div>
    </div>
  );
}

function MiniRing({ score, size = 56 }: { score: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = accuracyColor(score);
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{score}%</span>
      </div>
    </div>
  );
}

function XPBar({ xp, level }: { xp: number; level: number }) {
  const xpForLevel = level * 1000;
  const progress = (xp % 1000) / 10;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-muted-foreground">Level {level}</span>
        <span className="text-[11px] text-muted-foreground">{xp % 1000} / 1000 XP</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, #3b5bdb, #4b9fd4)",
            boxShadow: "0 0 8px #4b9fd480",
            transition: "width 1s ease",
          }}
        />
      </div>
    </div>
  );
}

type TabKey = "overview" | "subjects" | "concepts" | "activity";

const tabs: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "subjects", label: "Subjects" },
  { key: "concepts", label: "Concepts" },
  { key: "activity", label: "Activity" },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2 text-xs shadow-xl">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[#a0aec0]">{p.name}:</span>
          <span className="text-foreground font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Main export ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.06) 0%, transparent 60%), #0d0d0f",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* ── Header ────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground tracking-tight">Analytics Studio</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/20 rounded-full px-3 py-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-amber-400">{student.streak}d streak</span>
            </div>
            <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1">
              <Zap className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-bold text-blue-400">{student.xp.toLocaleString()} XP</span>
            </div>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-foreground"
              style={{ background: "linear-gradient(135deg, #3b5bdb, #6882e8)" }}
            >
              {student.avatar}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Hero Banner ───────────────────── */}
        <GlassCard glow="blue" className="p-6 sm:p-8">
          <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start md:items-center">
            {/* Left: student info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Deep Analysis</span>
                <div className="flex items-center gap-1 bg-purple-500/15 border border-purple-500/20 rounded-full px-2 py-0.5">
                  <Star className="w-3 h-3 text-purple-400" />
                  <span className="text-[10px] text-purple-400 font-semibold">Rank #{student.rank} / {student.totalStudents}</span>
                </div>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-foreground leading-tight tracking-tight">
                Hi, {student.name.split(" ")[0]} 👋
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">{student.class} · Last updated just now</p>

              <div className="grid grid-cols-3 gap-3 mt-5">
                {[
                  { label: "Accuracy", value: `${student.accuracy}%`, color: "#4b9fd4" },
                  { label: "Attendance", value: `${student.attendance}%`, color: "#4aa87a" },
                  { label: "Level", value: `Lv.${student.level}`, color: "#6882e8" },
                ].map((m) => (
                  <div key={m.label} className="bg-muted rounded-xl px-3 py-2.5 border border-border">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
                    <div className="mt-0.5 text-xl font-black tabular-nums" style={{ color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <XPBar xp={student.xp} level={student.level} />
              </div>
            </div>

            {/* Right: readiness ring */}
            <div className="flex flex-col items-center gap-3 shrink-0">
              <ReadinessRing score={student.examReadiness} />
              <span className="text-[11px] text-muted-foreground uppercase tracking-widest">Exam Readiness</span>
            </div>

            {/* Right: radar */}
            <div className="shrink-0 w-full md:w-48 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: "#78788c", fontSize: 10, fontWeight: 600 }}
                  />
                  <Radar name="Score" dataKey="score" stroke="#3b5bdb" fill="#3b5bdb" fillOpacity={0.2} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </GlassCard>

        {/* ── Tab Bar ───────────────────────── */}
        <div className="flex gap-1 bg-muted border border-border/70 rounded-xl p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm transition-all duration-200",
                activeTab === t.key
                  ? "bg-[#3b5bdb] text-foreground shadow-lg shadow-[#3b5bdb]/20"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Overview ─────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6">

            {/* Accuracy trend */}
            <GlassCard glow="cyan" className="p-6">
              <SectionLabel>Accuracy Trend — 7 Weeks</SectionLabel>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={accuracyTrend}>
                    <defs>
                      <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4b9fd4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#4b9fd4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[50, 100]} tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="score"
                      name="Accuracy"
                      stroke="#4b9fd4"
                      strokeWidth={2.5}
                      fill="url(#accGrad)"
                      dot={{ r: 4, fill: "#4b9fd4", strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: "#4b9fd4", strokeWidth: 2, stroke: "#0d0d0f" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400">+19% over 7 weeks</span>
              </div>
            </GlassCard>

            {/* AI Coach */}
            <GlassCard glow="purple" className="p-6">
              <SectionLabel>AI Coach</SectionLabel>
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, #6882e8, #3b5bdb)" }}
                >
                  <Brain className="w-4 h-4 text-foreground" />
                </div>
                <div>
                  <div className="text-foreground font-semibold text-sm">Nova · Your Academic AI</div>
                  <div className="text-muted-foreground text-xs mt-0.5">Analysing your last 7 sessions…</div>
                </div>
                <div className="ml-auto flex items-center gap-1 text-purple-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-xs">Live</span>
                </div>
              </div>
              <div className="space-y-3">
                {aiInsights.map((line, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-xl bg-muted border border-border hover:border-purple-400/20 transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-purple-400">{i + 1}</span>
                    </div>
                    <p className="text-sm text-[#a0aec0] leading-relaxed">{line}</p>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Recent Sessions */}
            <GlassCard className="p-6">
              <SectionLabel>Recent Sessions</SectionLabel>
              <div className="space-y-2">
                {recentSessions.map((s, i) => {
                  const acc = Math.round((s.correct / s.questions) * 100);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-4 p-3 rounded-xl bg-muted border border-border hover:border-border transition-colors group"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold"
                        style={{ background: `${accuracyColor(acc)}20`, color: accuracyColor(acc) }}
                      >
                        {s.subject.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground">{s.subject}</div>
                        <div className="text-[11px] text-muted-foreground">{s.date}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold" style={{ color: accuracyColor(acc) }}>{acc}%</div>
                        <div className="text-[11px] text-muted-foreground">{s.correct}/{s.questions} · {s.duration}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
        )}

        {/* ── Tab: Subjects ─────────────────── */}
        {activeTab === "subjects" && (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {subjectData.map((s) => (
                <GlassCard key={s.subject} className="p-5 hover:border-border transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="text-sm font-bold text-foreground">{s.subject}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{s.attempts} attempts</div>
                    </div>
                    <MiniRing score={s.accuracy} />
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${s.accuracy}%`,
                        background: `linear-gradient(90deg, ${accuracyColor(s.accuracy)}, ${accuracyColor(s.accuracy)}88)`,
                        boxShadow: `0 0 8px ${accuracyColor(s.accuracy)}60`,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 mt-3">
                    {s.trend >= 0
                      ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      : <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    }
                    <span className={`text-xs font-semibold ${s.trend >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {s.trend >= 0 ? "+" : ""}{s.trend}% this week
                    </span>
                  </div>
                </GlassCard>
              ))}
            </div>

            {/* Subject bar chart */}
            <GlassCard glow="blue" className="p-6">
              <SectionLabel>Subject Accuracy Comparison</SectionLabel>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjectData} barSize={28}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="subject" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="accuracy" name="Accuracy" radius={[6, 6, 0, 0]}>
                      {subjectData.map((s) => (
                        <Cell key={s.subject} fill={accuracyColor(s.accuracy)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>
          </div>
        )}

        {/* ── Tab: Concepts ─────────────────── */}
        {activeTab === "concepts" && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Strong */}
              <GlassCard glow="green" className="p-6">
                <SectionLabel>Strong Concepts</SectionLabel>
                <div className="space-y-3">
                  {strongConcepts.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-400/5 border border-emerald-400/10 hover:border-emerald-400/25 transition-colors">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{c.concept}</div>
                        <div className="text-[11px] text-muted-foreground">{c.subject}</div>
                      </div>
                      <div className="text-sm font-bold text-emerald-400 shrink-0">{c.score}%</div>
                    </div>
                  ))}
                </div>
              </GlassCard>

              {/* Weak */}
              <GlassCard glow="amber" className="p-6">
                <SectionLabel>Needs Improvement</SectionLabel>
                <div className="space-y-3">
                  {weakConcepts.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-amber-400/5 border border-amber-400/10 hover:border-amber-400/25 transition-colors group cursor-pointer">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{c.concept}</div>
                        <div className="text-[11px] text-muted-foreground">{c.subject} · {c.mistakes} mistakes</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-sm font-bold text-amber-400">{c.score}%</span>
                        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">Recover →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>

            {/* Concept mastery radar */}
            <GlassCard glow="purple" className="p-6">
              <SectionLabel>Subject Mastery Radar</SectionLabel>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#a0aec0", fontSize: 12, fontWeight: 600 }} />
                    <Radar name="Mastery" dataKey="score" stroke="#6882e8" fill="#6882e8" fillOpacity={0.25} strokeWidth={2.5} />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>
          </div>
        )}

        {/* ── Tab: Activity ─────────────────── */}
        {activeTab === "activity" && (
          <div className="space-y-6">

            {/* Weekly stacked bar */}
            <GlassCard glow="cyan" className="p-6">
              <SectionLabel>This Week — Questions Attempted</SectionLabel>
              <div className="flex gap-4 mb-4">
                {[
                  { label: "DPP", color: "#3b5bdb" },
                  { label: "Practice", color: "#4b9fd4" },
                  { label: "Battles", color: "#c08a3a" },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                    <span className="text-[11px] text-muted-foreground">{l.label}</span>
                  </div>
                ))}
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyActivity} barSize={20} barGap={2}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="dpp" name="DPP" stackId="a" fill="#3b5bdb" />
                    <Bar dataKey="practice" name="Practice" stackId="a" fill="#4b9fd4" />
                    <Bar dataKey="battles" name="Battles" stackId="a" fill="#c08a3a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            {/* Activity heatmap */}
            <GlassCard className="p-6">
              <SectionLabel>4-Week Activity Heatmap</SectionLabel>
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="flex gap-1 mb-2">
                    <div className="w-8 shrink-0" />
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                      <div key={d} className="flex-1 text-center text-[10px] text-muted-foreground">{d}</div>
                    ))}
                  </div>
                  {heatmapData.map((row) => (
                    <div key={row.week} className="flex items-center gap-1 mb-1">
                      <div className="w-8 text-[10px] text-muted-foreground shrink-0">{row.week}</div>
                      {row.days.map((cell) => {
                        const intensity = cell.value / 40;
                        const bg = cell.value === 0
                          ? "rgba(255,255,255,0.04)"
                          : `rgba(34,211,238,${0.1 + intensity * 0.9})`;
                        return (
                          <div
                            key={cell.day}
                            title={`${cell.value} questions`}
                            className="flex-1 h-8 rounded-md transition-all duration-200 hover:scale-110 cursor-default"
                            style={{ background: bg, boxShadow: cell.value > 25 ? "0 0 6px rgba(34,211,238,0.4)" : undefined }}
                          />
                        );
                      })}
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-3 justify-end">
                    <span className="text-[10px] text-muted-foreground">Less</span>
                    {[0.1, 0.3, 0.5, 0.7, 1].map((o) => (
                      <div key={o} className="w-3 h-3 rounded-sm" style={{ background: `rgba(34,211,238,${o})` }} />
                    ))}
                    <span className="text-[10px] text-muted-foreground">More</span>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Gamification stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { icon: <Trophy className="w-5 h-5" />, label: "Class Rank", value: `#${student.rank}`, color: "#c08a3a", bg: "#c08a3a20" },
                { icon: <Flame className="w-5 h-5" />, label: "Streak", value: `${student.streak}d`, color: "#f97316", bg: "#f9731620" },
                { icon: <Zap className="w-5 h-5" />, label: "Total XP", value: student.xp.toLocaleString(), color: "#3b5bdb", bg: "#3b5bdb20" },
                { icon: <Activity className="w-5 h-5" />, label: "Sessions", value: "38", color: "#4aa87a", bg: "#4aa87a20" },
              ].map((item) => (
                <GlassCard key={item.label} className="p-4 hover:border-border transition-colors">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: item.bg, color: item.color }}>
                    {item.icon}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className="text-2xl font-black tabular-nums mt-1" style={{ color: item.color }}>{item.value}</div>
                </GlassCard>
              ))}
            </div>

            {/* Leaderboard preview */}
            <GlassCard glow="amber" className="p-6">
              <SectionLabel>Class Leaderboard — Top 5</SectionLabel>
              <div className="space-y-2">
                {[
                  { rank: 1, name: "Priya Nair", xp: 9810, accuracy: 88 },
                  { rank: 2, name: "Rahul Mehta", xp: 9140, accuracy: 85 },
                  { rank: 3, name: "Arjun Sharma", xp: 8420, accuracy: 81, you: true },
                  { rank: 4, name: "Sneha Patel", xp: 7990, accuracy: 79 },
                  { rank: 5, name: "Karan Joshi", xp: 7620, accuracy: 77 },
                ].map((p) => (
                  <div
                    key={p.rank}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                      p.you
                        ? "bg-blue-500/10 border-blue-500/25"
                        : "bg-muted border-border hover:border-border"
                    )}
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0"
                      style={{
                        background: p.rank === 1 ? "#c08a3a20" : p.rank === 2 ? "rgba(148,163,184,0.15)" : p.rank === 3 ? "rgba(251,146,60,0.15)" : "rgba(255,255,255,0.05)",
                        color: p.rank === 1 ? "#c08a3a" : p.rank === 2 ? "#94a3b8" : p.rank === 3 ? "#fb923c" : "#78788c",
                      }}
                    >
                      {p.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm font-semibold truncate", p.you ? "text-blue-300" : "text-foreground")}>
                        {p.name} {p.you && <span className="text-[10px] text-blue-400 ml-1">YOU</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-[#6882e8]">{p.xp.toLocaleString()} XP</div>
                      <div className="text-[10px] text-muted-foreground">{p.accuracy}% acc</div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        )}

        {/* ── Footer quick actions ───────────── */}
        <div className="flex flex-wrap gap-3 justify-center pb-4">
          {[
            { label: "Start Practice", icon: <BookOpen className="w-4 h-4" />, color: "#3b5bdb" },
            { label: "Recovery Zone", icon: <Target className="w-4 h-4" />, color: "#c08a3a" },
            { label: "Battleground", icon: <Zap className="w-4 h-4" />, color: "#6882e8" },
          ].map((a) => (
            <button
              key={a.label}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-muted hover:bg-muted/80 hover:border-border text-sm text-[#a0aec0] hover:text-foreground transition-all duration-200"
              style={{ "--hover-shadow": `0 0 20px ${a.color}30` } as React.CSSProperties}
            >
              <span style={{ color: a.color }}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
