import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Download, Share2,
  CheckCircle2, AlertCircle, Clock, BookOpen,
  Zap, Target, Calendar, ChevronRight,
  ArrowUp, ArrowDown, Minus, Printer, Star,
} from "lucide-react";
import { cn } from "@/gurukul/components/shared";

// ── All data ──────────────────────────────────────────────────────────────────

const overview = {
  accuracy: 81,
  totalQuestions: 1240,
  correct: 1005,
  incorrect: 235,
  practiceCompleted: 38,
  testsCompleted: 6,
  avgScore: 76,
  studyHours: 124,
  streak: 12,
  rank: 3,
  totalStudents: 48,
  examReadiness: 74,
};

const scoreTrend = [
  { week: "Week 1", score: 62, practice: 80 },
  { week: "Week 2", score: 67, practice: 95 },
  { week: "Week 3", score: 71, practice: 110 },
  { week: "Week 4", score: 69, practice: 88 },
  { week: "Week 5", score: 75, practice: 120 },
  { week: "Week 6", score: 78, practice: 135 },
  { week: "Week 7", score: 81, practice: 142 },
];

const weekComparison = [
  { day: "Mon", thisWeek: 23, lastWeek: 15 },
  { day: "Tue", thisWeek: 37, lastWeek: 28 },
  { day: "Wed", thisWeek: 26, lastWeek: 32 },
  { day: "Thu", thisWeek: 40, lastWeek: 20 },
  { day: "Fri", thisWeek: 37, lastWeek: 35 },
  { day: "Sat", thisWeek: 60, lastWeek: 42 },
  { day: "Sun", thisWeek: 16, lastWeek: 18 },
];

const subjectData = [
  {
    name: "Mathematics", color: "#6366f1", score: 91, accuracy: 91,
    questions: 210, timeHrs: 38, trend: +7,
    status: "best", rankInClass: 2,
  },
  {
    name: "Physics", color: "#4b9fd4", score: 88, accuracy: 88,
    questions: 142, timeHrs: 28, trend: +4,
    status: "good", rankInClass: 4,
  },
  {
    name: "Chemistry", color: "#8f7dd6", score: 73, accuracy: 73,
    questions: 98, timeHrs: 24, trend: -2,
    status: "needs-attention", rankInClass: 22,
  },
  {
    name: "Biology", color: "#4aa87a", score: 65, accuracy: 65,
    questions: 76, timeHrs: 18, trend: -5,
    status: "needs-attention", rankInClass: 31,
  },
  {
    name: "English", color: "#c08a3a", score: 84, accuracy: 84,
    questions: 54, timeHrs: 16, trend: +2,
    status: "good", rankInClass: 8,
  },
];

const radarData = subjectData.map((s) => ({ subject: s.name.slice(0, 4), score: s.score }));

const chapterData = [
  { chapter: "Integration", subject: "Mathematics", color: "#6366f1", completion: 85, questions: 48, accuracy: 94, trend: +8, status: "ready" },
  { chapter: "Matrices", subject: "Mathematics", color: "#6366f1", completion: 92, questions: 35, accuracy: 89, trend: +3, status: "ready" },
  { chapter: "Differential Equations", subject: "Mathematics", color: "#6366f1", completion: 55, questions: 25, accuracy: 62, trend: -2, status: "practice-more" },
  { chapter: "Optics", subject: "Physics", color: "#4b9fd4", completion: 90, questions: 35, accuracy: 91, trend: +5, status: "ready" },
  { chapter: "Electrostatics", subject: "Physics", color: "#4b9fd4", completion: 65, questions: 28, accuracy: 69, trend: +1, status: "practice-more" },
  { chapter: "Organic Chemistry", subject: "Chemistry", color: "#8f7dd6", completion: 40, questions: 30, accuracy: 51, trend: -4, status: "needs-work" },
  { chapter: "Electrochemistry", subject: "Chemistry", color: "#8f7dd6", completion: 30, questions: 18, accuracy: 55, trend: 0, status: "needs-work" },
  { chapter: "Genetics", subject: "Biology", color: "#4aa87a", completion: 35, questions: 20, accuracy: 48, trend: -3, status: "needs-work" },
  { chapter: "Cell Biology", subject: "Biology", color: "#4aa87a", completion: 78, questions: 32, accuracy: 82, trend: +6, status: "ready" },
];

const topicGroups = {
  doing_well: [
    { topic: "Integration", subject: "Mathematics", score: 94 },
    { topic: "Optics", subject: "Physics", score: 91 },
    { topic: "Thermodynamics", subject: "Chemistry", score: 88 },
    { topic: "Cell Biology", subject: "Biology", score: 82 },
    { topic: "Grammar", subject: "English", score: 85 },
  ],
  needs_attention: [
    { topic: "Organic Chemistry", subject: "Chemistry", score: 51, practiceCount: 30 },
    { topic: "Genetics", subject: "Biology", score: 48, practiceCount: 20 },
    { topic: "Differential Equations", subject: "Mathematics", score: 62, practiceCount: 25 },
    { topic: "Electrostatics", subject: "Physics", score: 69, practiceCount: 28 },
  ],
  improving: [
    { topic: "Matrices", subject: "Mathematics", improvement: +9 },
    { topic: "Wave Motion", subject: "Physics", improvement: +7 },
    { topic: "Comprehension", subject: "English", improvement: +5 },
  ],
  not_started: [
    { topic: "Probability", subject: "Mathematics" },
    { topic: "Nuclear Physics", subject: "Physics" },
    { topic: "Ecology", subject: "Biology" },
  ],
};

const practiceStats = {
  todayDone: 22,
  todayTarget: 30,
  weekDone: 239,
  weekTarget: 210,
  monthDone: 842,
  monthTarget: 900,
  streakDays: 12,
  consistency: 86,
  pendingAssignments: 2,
  completedSessions: 38,
};

const practiceMonthly = [
  { month: "Jan", done: 420 },
  { month: "Feb", done: 560 },
  { month: "Mar", done: 390 },
  { month: "Apr", done: 680 },
  { month: "May", done: 740 },
  { month: "Jun", done: 842 },
];

const testResults = [
  { name: "Unit Test 1", date: "May 20", subject: "All Subjects", score: 68, maxScore: 100, rank: 12, total: 48 },
  { name: "Physics Chapter Test", date: "May 28", subject: "Physics", score: 82, maxScore: 100, rank: 5, total: 48 },
  { name: "Chemistry Quiz", date: "Jun 5", subject: "Chemistry", score: 61, maxScore: 100, rank: 18, total: 48 },
  { name: "Mathematics Test 2", date: "Jun 10", subject: "Mathematics", score: 91, maxScore: 100, rank: 2, total: 48 },
  { name: "Biology Mid-Term", date: "Jun 12", subject: "Biology", score: 64, maxScore: 100, rank: 24, total: 48 },
];

const testTrend = testResults.map((t) => ({ name: t.date, score: t.score }));

const speedStats = {
  avgSec: 38,
  fastestSubject: "Mathematics",
  fastestSec: 28,
  slowestSubject: "Chemistry",
  slowestSec: 54,
  improvementSec: -4,
};

const speedBySubject = subjectData.map((s, i) => ({
  name: s.name,
  color: s.color,
  avgSec: [28, 33, 54, 48, 31][i],
}));

const studyActivity = {
  totalHrs: 124,
  avgDailyMin: 52,
  bestDay: "Saturday",
  bestHour: "7–9 PM",
  weeklyHrs: [2.5, 3.1, 1.8, 3.5, 2.9, 4.2, 1.2],
};

const activityHeatmap = (() => {
  const weeks = ["W1", "W2", "W3", "W4"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return weeks.map((w) => ({
    week: w,
    days: days.map((d) => ({ day: d, value: Math.floor(Math.random() * 50) })),
  }));
})();

const recoveryProgress = {
  totalToRevisit: 8,
  completed: 3,
  stillPending: 5,
  improvementAfter: 72,
};

const recoveryTopics = [
  { topic: "SN1 vs SN2", subject: "Chemistry", status: "pending", attempts: 2 },
  { topic: "Dihybrid Cross", subject: "Biology", status: "pending", attempts: 1 },
  { topic: "Integrating Factor", subject: "Mathematics", status: "completed", improvement: +18 },
  { topic: "Carbocation Stability", subject: "Chemistry", status: "completed", improvement: +24 },
  { topic: "Electrostatic Potential", subject: "Physics", status: "pending", attempts: 1 },
];

const revisionData = {
  totalRevised: 12,
  completed: 9,
  pending: 3,
  dueToday: ["Integration by Parts", "Snell's Law", "Matrices Operations"],
};

const learningProgress = {
  completed: 14,
  inProgress: 8,
  notStarted: 6,
  total: 28,
};

const milestones = [
  { title: "12 days of consistent practice", desc: "You practiced every single day for 12 days in a row.", date: "Jun 12", icon: "🔥", category: "Consistency" },
  { title: "1000 questions solved", desc: "You've solved over 1,000 practice questions this year.", date: "Jun 10", icon: "📚", category: "Practice" },
  { title: "Top 10% in Mathematics", desc: "You ranked in the top 10% of your class in Math this week.", date: "Jun 9", icon: "⭐", category: "Performance" },
  { title: "Improved 19% in 7 weeks", desc: "Your overall accuracy improved from 62% to 81%.", date: "Jun 7", icon: "📈", category: "Improvement" },
  { title: "Completed Cell Biology chapter", desc: "You finished all topics and practice in Cell Biology.", date: "Jun 5", icon: "✅", category: "Completion" },
];

const personalInsights = [
  { label: "Your strongest subject right now", value: "Mathematics", sub: "91% accuracy · Rank #2 in class", color: "#6366f1", icon: <Star className="w-4 h-4" /> },
  { label: "Subject needing more practice", value: "Biology", sub: "65% accuracy · 5 topics pending", color: "#c08a3a", icon: <Target className="w-4 h-4" /> },
  { label: "Chapter you improved the most", value: "Matrices", sub: "+9% improvement this week", color: "#4aa87a", icon: <TrendingUp className="w-4 h-4" /> },
  { label: "Chapter taking the most time", value: "Organic Chemistry", sub: "54 sec avg per question", color: "#cc5069", icon: <Clock className="w-4 h-4" /> },
  { label: "Best study day this week", value: "Saturday", sub: "4.2 hours · 60 questions", color: "#8f7dd6", icon: <Calendar className="w-4 h-4" /> },
  { label: "Suggested priority today", value: "Organic Chemistry Recovery", sub: "5 pending topics · do 15 min now", color: "#4b9fd4", icon: <ChevronRight className="w-4 h-4" /> },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(v: number) {
  if (v >= 80) return "#4b9fd4";
  if (v >= 65) return "#c08a3a";
  return "#cc5069";
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#131316] border border-white/10 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="text-[#78788c] mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-[#a0a0b0]">{p.name}:</span>
          <span className="text-white font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "subjects" | "topics" | "practice" | "activity" | "milestones";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview",    label: "Overview" },
  { key: "subjects",    label: "Subjects & Chapters" },
  { key: "topics",      label: "Topics" },
  { key: "practice",    label: "Practice & Tests" },
  { key: "activity",    label: "Activity & Speed" },
  { key: "milestones",  label: "Milestones & Reports" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function Analysis() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      {/* ── 3 Questions bar ─────────────── */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          {
            q: "How am I doing?",
            a: `${overview.accuracy}% accuracy overall`,
            sub: `Rank #${overview.rank} of ${overview.totalStudents} · ${overview.streak}-day streak`,
            color: "#4b9fd4",
            icon: <TrendingUp className="w-4 h-4" />,
          },
          {
            q: "What should I improve?",
            a: "Biology & Chemistry",
            sub: "65% and 73% accuracy — 9 topics pending",
            color: "#c08a3a",
            icon: <Target className="w-4 h-4" />,
          },
          {
            q: "What should I study next?",
            a: "Organic Chemistry recovery",
            sub: "5 unresolved topics · suggested: 15 min now",
            color: "#6366f1",
            icon: <BookOpen className="w-4 h-4" />,
          },
        ].map((item) => (
          <div
            key={item.q}
            className="rounded-2xl border p-4"
            style={{ borderColor: `${item.color}25`, background: `${item.color}08` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span style={{ color: item.color }}>{item.icon}</span>
              <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: item.color }}>{item.q}</span>
            </div>
            <div className="text-sm font-bold text-white leading-tight">{item.a}</div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Tab bar ─────────────────────── */}
      <div className="flex gap-0 overflow-x-auto border-b border-white/7 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap",
              tab === t.key
                ? "border-[#6366f1] text-white"
                : "border-transparent text-[#78788c] hover:text-white"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ───────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Questions solved",   value: overview.totalQuestions.toLocaleString(), color: "#e8eaf0" },
              { label: "Correct answers",    value: overview.correct.toLocaleString(),        color: "#4b9fd4" },
              { label: "Incorrect answers",  value: overview.incorrect.toLocaleString(),      color: "#cc5069" },
              { label: "Average score",      value: `${overview.avgScore}%`,                  color: "#c08a3a" },
              { label: "Practice sessions",  value: overview.practiceCompleted,               color: "#e8eaf0" },
              { label: "Tests completed",    value: overview.testsCompleted,                  color: "#e8eaf0" },
              { label: "Study hours total",  value: `${overview.studyHours}h`,                color: "#8f7dd6" },
              { label: "Exam readiness",     value: `${overview.examReadiness}%`,             color: "#6366f1" },
            ].map((s) => (
              <Metric key={s.label} label={s.label} value={s.value} color={s.color} />
            ))}
          </div>

          {/* Score over time */}
          <Card label="How your score changed over 7 weeks">
            <div className="h-48 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreTrend}>
                  <defs>
                    <linearGradient id="an-scGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[50, 100]} tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="score" name="Score" stroke="#6366f1" strokeWidth={2.5} fill="url(#an-scGrad)"
                    isAnimationActive={false} dot={{ r: 4, fill: "#6366f1", strokeWidth: 0 }} activeDot={{ r: 6, fill: "#6366f1", stroke: "#0d0d0f", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">+19% improvement over 7 weeks (62% → 81%)</span>
            </div>
          </Card>

          {/* This week vs last week */}
          <Card label="This week vs last week — questions done">
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekComparison} barSize={14} barGap={2}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="thisWeek" name="This week" fill="#6366f1" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
                  <Bar dataKey="lastWeek" name="Last week" fill="rgba(255,255,255,0.08)" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Personal Insights */}
          <div>
            <SLabel>Personal insights</SLabel>
            <div className="grid sm:grid-cols-2 gap-3">
              {personalInsights.map((ins) => (
                <div key={ins.label} className="flex items-start gap-3 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/15 transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${ins.color}15`, color: ins.color }}>
                    {ins.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[#78788c]">{ins.label}</div>
                    <div className="text-sm font-bold text-white mt-0.5">{ins.value}</div>
                    <div className="text-[11px] text-[#78788c] mt-0.5">{ins.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Subjects & Chapters ────── */}
      {tab === "subjects" && (
        <div className="space-y-6">
          {/* Subject radar */}
          <div className="grid sm:grid-cols-2 gap-6">
            <Card label="How you perform in each subject">
              <div className="h-56 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#a0a0b0", fontSize: 12, fontWeight: 600 }} />
                    <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2.5} isAnimationActive={false}/>
                    <Tooltip content={<ChartTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="space-y-3">
              <SLabel>Subjects at a glance</SLabel>
              {subjectData.map((s) => (
                <div key={s.name} className="flex items-center gap-3 p-3 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                  <div className="w-2 h-10 rounded-full shrink-0" style={{ background: s.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{s.name}</span>
                      {s.status === "best" && <span className="text-[9px] uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">Best subject</span>}
                      {s.status === "needs-attention" && <span className="text-[9px] uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">Needs attention</span>}
                    </div>
                    <div className="text-[11px] text-[#78788c] mt-0.5">{s.questions} questions · {s.timeHrs}h study time · Rank #{s.rankInClass}</div>
                    <div className="h-1 rounded-full bg-white/5 mt-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s.score}%`, background: s.color }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.score}%</div>
                    <div className={cn("flex items-center gap-0.5 text-[11px] font-medium justify-end", s.trend >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {s.trend >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {Math.abs(s.trend)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chapter breakdown */}
          <div>
            <SLabel>Chapter by chapter</SLabel>
            <div className="grid sm:grid-cols-2 gap-3">
              {chapterData.map((c) => {
                const statusLabel: Record<string, { text: string; color: string }> = {
                  "ready":        { text: "Ready for revision", color: "#4aa87a" },
                  "practice-more":{ text: "Practice more",      color: "#c08a3a" },
                  "needs-work":   { text: "Needs attention",    color: "#cc5069" },
                };
                const st = statusLabel[c.status];
                return (
                  <div key={`${c.subject}-${c.chapter}`} className="p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-sm font-semibold text-white">{c.chapter}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: c.color }}>{c.subject}</div>
                      </div>
                      <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: st.color, background: `${st.color}12` }}>
                        {st.text}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div className="text-center">
                        <div className="text-sm font-black tabular-nums text-white">{c.completion}%</div>
                        <div className="text-[9px] text-[#78788c]">Done</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-black tabular-nums text-white">{c.accuracy}%</div>
                        <div className="text-[9px] text-[#78788c]">Accuracy</div>
                      </div>
                      <div className="text-center">
                        <div className={cn("text-sm font-black tabular-nums flex items-center justify-center gap-0.5", c.trend >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {c.trend >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          {Math.abs(c.trend)}%
                        </div>
                        <div className="text-[9px] text-[#78788c]">Change</div>
                      </div>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${c.completion}%`, background: c.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Topics ─────────────────── */}
      {tab === "topics" && (
        <div className="space-y-6">
          {/* Learning journey overview */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Topics completed",   value: learningProgress.completed,  color: "#4aa87a", icon: <CheckCircle2 className="w-5 h-5" /> },
              { label: "Topics in progress", value: learningProgress.inProgress, color: "#6366f1", icon: <BookOpen className="w-5 h-5" /> },
              { label: "Yet to begin",        value: learningProgress.notStarted, color: "#78788c", icon: <Minus className="w-5 h-5" /> },
            ].map((item) => (
              <div key={item.label} className="p-4 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                <div className="flex justify-center mb-2" style={{ color: item.color }}>{item.icon}</div>
                <div className="text-2xl font-black tabular-nums" style={{ color: item.color }}>{item.value}</div>
                <div className="text-[11px] text-[#78788c] mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Doing well */}
            <div>
              <SLabel>Topics you're doing well in</SLabel>
              <div className="space-y-2">
                {topicGroups.doing_well.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-emerald-400/12 bg-emerald-400/5 hover:border-emerald-400/25 transition-colors">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{t.topic}</div>
                      <div className="text-[11px] text-[#78788c]">{t.subject}</div>
                    </div>
                    <span className="text-sm font-black text-emerald-400 shrink-0">{t.score}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Needs attention */}
            <div>
              <SLabel>Topics that need your attention</SLabel>
              <div className="space-y-2">
                {topicGroups.needs_attention.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-amber-400/12 bg-amber-400/5 hover:border-amber-400/25 transition-colors cursor-pointer">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{t.topic}</div>
                      <div className="text-[11px] text-[#78788c]">{t.subject} · {t.practiceCount} questions done</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-amber-400">{t.score}%</div>
                      <div className="text-[10px] text-[#78788c]">accuracy</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Improving */}
            <div>
              <SLabel>Topics getting better</SLabel>
              <div className="space-y-2">
                {topicGroups.improving.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                    <TrendingUp className="w-4 h-4 text-[#6366f1] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{t.topic}</div>
                      <div className="text-[11px] text-[#78788c]">{t.subject}</div>
                    </div>
                    <span className="text-sm font-black text-emerald-400 shrink-0">+{t.improvement}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Not started */}
            <div>
              <SLabel>Topics yet to begin</SLabel>
              <div className="space-y-2">
                {topicGroups.not_started.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/2">
                    <Minus className="w-4 h-4 text-[#78788c] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#a0a0b0] truncate">{t.topic}</div>
                      <div className="text-[11px] text-[#78788c]">{t.subject}</div>
                    </div>
                    <span className="text-[10px] text-[#78788c]">Not started</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recovery & Revision */}
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <SLabel>Topics you practiced again</SLabel>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-white">{recoveryProgress.completed}</div>
                  <div className="text-[11px] text-[#78788c]">Completed</div>
                </div>
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-amber-400">{recoveryProgress.stillPending}</div>
                  <div className="text-[11px] text-[#78788c]">Still pending</div>
                </div>
              </div>
              <div className="space-y-2">
                {recoveryTopics.map((r) => (
                  <div key={r.topic} className="flex items-center gap-3 p-3 rounded-xl border border-white/7 bg-[#131316]/60">
                    {r.status === "completed"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      : <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{r.topic}</div>
                      <div className="text-[11px] text-[#78788c]">{r.subject}</div>
                    </div>
                    {r.status === "completed"
                      ? <span className="text-xs font-semibold text-emerald-400">+{r.improvement}%</span>
                      : <span className="text-[11px] text-[#78788c]">{r.attempts} tries</span>
                    }
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SLabel>Revision status</SLabel>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-emerald-400">{revisionData.completed}</div>
                  <div className="text-[11px] text-[#78788c]">Done</div>
                </div>
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-amber-400">{revisionData.pending}</div>
                  <div className="text-[11px] text-[#78788c]">Pending</div>
                </div>
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-white">{revisionData.totalRevised}</div>
                  <div className="text-[11px] text-[#78788c]">Total</div>
                </div>
              </div>
              <SLabel>Due for revision today</SLabel>
              <div className="space-y-2">
                {revisionData.dueToday.map((topic) => (
                  <div key={topic} className="flex items-center gap-3 p-3 rounded-xl border border-[#6366f1]/20 bg-[#6366f1]/5">
                    <Clock className="w-4 h-4 text-[#6366f1] shrink-0" />
                    <span className="text-sm text-white">{topic}</span>
                    <span className="ml-auto text-[10px] text-[#6366f1] font-semibold">Due today</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Practice & Tests ────────── */}
      {tab === "practice" && (
        <div className="space-y-6">
          {/* Practice stats */}
          <div>
            <SLabel>Your practice this week</SLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Done today",        value: `${practiceStats.todayDone}/${practiceStats.todayTarget}`,  color: "#6366f1" },
                { label: "Done this week",    value: `${practiceStats.weekDone}/${practiceStats.weekTarget}`,   color: "#4b9fd4" },
                { label: "Practice streak",   value: `${practiceStats.streakDays} days`,                        color: "#c08a3a" },
                { label: "Consistency",       value: `${practiceStats.consistency}%`,                           color: "#4aa87a" },
              ].map((s) => <Metric key={s.label} label={s.label} value={s.value} color={s.color} />)}
            </div>
          </div>

          {/* Practice monthly */}
          <Card label="Questions practiced each month">
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={practiceMonthly} barSize={32}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="done" name="Questions" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {practiceMonthly.map((_, i) => (
                      <Cell key={i} fill={i === practiceMonthly.length - 1 ? "#6366f1" : "rgba(59,130,246,0.35)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Test results */}
          <div>
            <SLabel>Recent tests</SLabel>
            <div className="space-y-2">
              {testResults.map((t) => {
                const col = scoreColor(t.score);
                return (
                  <div key={t.name} className="flex items-center gap-4 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-black" style={{ background: `${col}15`, color: col }}>
                      {t.score}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white">{t.name}</div>
                      <div className="text-[11px] text-[#78788c]">{t.subject} · {t.date}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black tabular-nums" style={{ color: col }}>{t.score}/{t.maxScore}</div>
                      <div className="text-[11px] text-[#78788c]">Rank #{t.rank} of {t.total}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Score trend */}
          <Card label="How your test scores changed">
            <div className="h-40 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={testTrend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[50, 100]} tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="score" name="Score" stroke="#4b9fd4" strokeWidth={2.5}
                    isAnimationActive={false} dot={{ r: 5, fill: "#4b9fd4", strokeWidth: 0 }} activeDot={{ r: 7, stroke: "#0d0d0f", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Speed */}
          <div>
            <SLabel>How fast you solve questions</SLabel>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <Metric label="Average per question"  value={`${speedStats.avgSec}s`}    color="#e8eaf0" />
              <Metric label="Fastest subject"        value={speedStats.fastestSubject}  color="#4aa87a" sub={`${speedStats.fastestSec}s avg`} />
              <Metric label="Takes most time"        value={speedStats.slowestSubject}  color="#c08a3a" sub={`${speedStats.slowestSec}s avg`} />
            </div>
            <Card label="Time per question by subject (seconds)">
              <div className="h-40 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={speedBySubject} layout="vertical" barSize={14}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "#a0a0b0", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgSec" name="Seconds" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                      {speedBySubject.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Tab: Activity & Speed ────────── */}
      {tab === "activity" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Total study time"    value={`${studyActivity.totalHrs}h`}       color="#8f7dd6" />
            <Metric label="Average per day"     value={`${studyActivity.avgDailyMin} min`} color="#e8eaf0" />
            <Metric label="Most active day"     value={studyActivity.bestDay}              color="#c08a3a" />
            <Metric label="Most productive hour" value={studyActivity.bestHour}            color="#4b9fd4" />
          </div>

          {/* Weekly hours */}
          <Card label="Study time each day this week (hours)">
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => ({ day: d, hours: studyActivity.weeklyHrs[i] }))}
                  barSize={28}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {studyActivity.weeklyHrs.map((v, i) => (
                      <Cell key={i} fill={v === Math.max(...studyActivity.weeklyHrs) ? "#8f7dd6" : "rgba(167,139,250,0.3)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 4-week heatmap */}
          <Card label="Practice activity — last 4 weeks">
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[380px]">
                <div className="flex gap-1 mb-2 ml-9">
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
                    <div key={d} className="flex-1 text-center text-[10px] text-[#78788c]">{d}</div>
                  ))}
                </div>
                {activityHeatmap.map((row) => (
                  <div key={row.week} className="flex items-center gap-1 mb-1.5">
                    <div className="w-8 text-[10px] text-[#78788c] shrink-0">{row.week}</div>
                    {row.days.map((cell) => {
                      const intensity = cell.value / 50;
                      const bg = cell.value === 0 ? "rgba(255,255,255,0.04)" : `rgba(59,130,246,${0.08 + intensity * 0.92})`;
                      return (
                        <div key={cell.day} title={`${cell.value} questions`}
                          className="flex-1 h-8 rounded-lg transition-all hover:scale-110 cursor-default"
                          style={{ background: bg }} />
                      );
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <span className="text-[10px] text-[#78788c]">Less</span>
                  {[0.08, 0.3, 0.55, 0.75, 1].map((o) => (
                    <div key={o} className="w-3 h-3 rounded-sm" style={{ background: `rgba(59,130,246,${o})` }} />
                  ))}
                  <span className="text-[10px] text-[#78788c]">More</span>
                </div>
              </div>
            </div>
          </Card>

          {/* This month vs last month */}
          <Card label="This month vs last month">
            <div className="grid grid-cols-3 gap-4 mt-3">
              {[
                { label: "Questions",  thisM: 842,  lastM: 740,  unit: "" },
                { label: "Avg score",  thisM: 78,   lastM: 71,   unit: "%" },
                { label: "Study time", thisM: 124,  lastM: 98,   unit: "h" },
              ].map((row) => {
                const diff = row.thisM - row.lastM;
                const pct = Math.round((diff / row.lastM) * 100);
                const up = diff > 0;
                return (
                  <div key={row.label} className="text-center p-3 rounded-xl border border-white/7 bg-[#131316]/60">
                    <div className="text-[10px] text-[#78788c] uppercase tracking-wider mb-1">{row.label}</div>
                    <div className="text-xl font-black text-white">{row.thisM}{row.unit}</div>
                    <div className="text-[10px] text-[#78788c] mt-0.5">vs {row.lastM}{row.unit} last month</div>
                    <div className={cn("flex items-center gap-1 justify-center mt-1 text-xs font-semibold", up ? "text-emerald-400" : "text-rose-400")}>
                      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {up ? "+" : ""}{pct}%
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ── Tab: Milestones & Reports ────── */}
      {tab === "milestones" && (
        <div className="space-y-6">
          <div>
            <SLabel>Your progress milestones</SLabel>
            <div className="space-y-3">
              {milestones.map((m) => (
                <div key={m.title} className="flex items-start gap-4 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                  <span className="text-2xl shrink-0 mt-0.5">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{m.title}</span>
                      <span className="text-[9px] uppercase tracking-wider text-[#78788c] bg-white/5 px-2 py-0.5 rounded-full">{m.category}</span>
                    </div>
                    <div className="text-xs text-[#78788c] mt-0.5">{m.desc}</div>
                  </div>
                  <span className="text-[11px] text-[#78788c] shrink-0">{m.date}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming milestones */}
          <div>
            <SLabel>Next milestones to reach</SLabel>
            <div className="space-y-3">
              {[
                { title: "Solve 50 Chemistry questions", progress: 30, target: 50, unit: "questions" },
                { title: "Reach 15-day practice streak", progress: 12, target: 15, unit: "days" },
                { title: "Improve Biology above 75%",    progress: 65, target: 75, unit: "%" },
              ].map((m) => {
                const pct = Math.round((m.progress / m.target) * 100);
                return (
                  <div key={m.title} className="p-4 rounded-xl border border-white/7 bg-[#131316]/60">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-white">{m.title}</span>
                      <span className="text-xs text-[#78788c]">{m.progress}/{m.target} {m.unit}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#6366f1,#4b9fd4)" }} />
                    </div>
                    <div className="text-[10px] text-[#78788c] mt-1">{pct}% complete</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reports */}
          <div>
            <SLabel>Download & share your report</SLabel>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { label: "Download PDF report",   icon: <Download className="w-4 h-4" />,  color: "#6366f1",  desc: "Full performance report as PDF" },
                { label: "Share with teacher",    icon: <Share2 className="w-4 h-4" />,    color: "#4aa87a",  desc: "Send a link to your teacher" },
                { label: "Share with parents",    icon: <Share2 className="w-4 h-4" />,    color: "#8f7dd6",  desc: "Send a summary to your parents" },
                { label: "Print report",          icon: <Printer className="w-4 h-4" />,   color: "#c08a3a",  desc: "Print a physical copy" },
              ].map((r) => (
                <button
                  key={r.label}
                  className="flex items-center gap-3 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/20 hover:bg-[#131316] transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform" style={{ background: `${r.color}15`, color: r.color }}>
                    {r.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{r.label}</div>
                    <div className="text-[11px] text-[#78788c]">{r.desc}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#78788c] ml-auto shrink-0 group-hover:text-white transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl border border-white/7 bg-[#131316]/60">
      <SLabel>{label}</SLabel>
      {children}
    </div>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-0">
      <div className="w-1 h-3.5 rounded-full bg-[#6366f1]" />
      <span className="text-[11px] uppercase tracking-[0.14em] text-[#78788c]">{children}</span>
    </div>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl border border-white/7 bg-[#131316]/60">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[#78788c] mb-1">{label}</div>
      <div className="text-2xl font-black tabular-nums leading-none" style={{ color: color ?? "#e8eaf0", fontFamily: "var(--font-display)" }}>{value}</div>
      {sub && <div className="text-[11px] text-[#78788c] mt-1">{sub}</div>}
    </div>
  );
}
