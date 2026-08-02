import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { useRecoveryZone, type RecoveryZoneData, type WeakConcept } from "@/hooks/useRecoveryZone";
import { GlassCard, SubjectBadge, ProgressBar, DifficultyBadge, cn } from "@/gurukul/components/shared";
import {
  RefreshCw, AlertCircle, ChevronRight, ChevronDown, CheckCircle2, XCircle,
  Brain, BookOpen, Clock, Target, Flame, Search, Filter, ArrowRight,
  RotateCcw, Zap, Star, TrendingUp, History, Play, SkipForward,
} from "lucide-react";

type RecoveryView = "overview" | "session" | "results";
type Priority = "high" | "medium" | "low";

interface RecoveryTopic {
  id: string; assignmentId?: string; concept: string; subject: string; chapter: string;
  priority: Priority; accuracy: number; attempts: number;
  source: string; pendingQs: number; lastAttempt: string;
  aiReason: string; teacherAssigned: boolean;
}

function severityToPriority(severity: string): Priority {
  if (severity === "severe") return "high";
  if (severity === "moderate") return "medium";
  return "low";
}

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function mapRecoveryZoneToTopics(data: RecoveryZoneData): RecoveryTopic[] {
  const weakMap = new Map<string, WeakConcept>();
  for (const w of data.weak_concepts ?? []) {
    weakMap.set(`${w.subject}:${w.concept}`, w);
  }

  const topics: RecoveryTopic[] = [];
  const seen = new Set<string>();

  for (const a of data.open_assignments ?? []) {
    const key = `${a.subject}:${a.concept}`;
    seen.add(key);
    const weak = weakMap.get(key);
    topics.push({
      id: a.id,
      assignmentId: a.id,
      concept: a.concept,
      subject: a.subject,
      chapter: a.chapter ?? "—",
      priority: severityToPriority(a.severity),
      accuracy: Math.round(weak?.mastery_score ?? 0),
      attempts: weak?.mistake_count ?? 0,
      source: "practice",
      pendingQs: Math.max(0, (a.question_count ?? 0) - (a.questions_completed ?? 0)),
      lastAttempt: formatRelativeDate(a.created_at),
      aiReason: "Based on your recent mistakes",
      teacherAssigned: false,
    });
  }

  for (const w of data.weak_concepts ?? []) {
    const key = `${w.subject}:${w.concept}`;
    if (seen.has(key)) continue;
    topics.push({
      id: key,
      concept: w.concept,
      subject: w.subject,
      chapter: w.chapter ?? "—",
      priority: w.mastery_score < 40 ? "high" : w.mastery_score < 55 ? "medium" : "low",
      accuracy: Math.round(w.mastery_score),
      attempts: w.mistake_count ?? 0,
      source: "practice",
      pendingQs: 0,
      lastAttempt: "—",
      aiReason: "Based on your recent mistakes",
      teacherAssigned: false,
    });
  }

  const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  topics.sort((a, b) => order[a.priority] - order[b.priority]);
  return topics;
}

const PRIORITY_META: Record<Priority,{color:string;label:string;bg:string}> = {
  high:   { color:"#cc5069", label:"High",   bg:"rgba(244,63,94,0.1)" },
  medium: { color:"#c08a3a", label:"Medium", bg:"rgba(245,158,11,0.1)" },
  low:    { color:"#4aa87a", label:"Low",    bg:"rgba(52,211,153,0.1)" },
};

const SOURCE_LABELS: Record<string,string> = {
  practice:"Practice", tests:"Tests", battleground:"Battleground",
  homework:"Homework", pyq:"PYQ", qbank:"Question Bank",
};

function PriorityTag({ p }: { p: Priority }) {
  const m = PRIORITY_META[p];
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{color:m.color,background:m.bg}}>
      {p === "high" && <AlertCircle className="w-2.5 h-2.5"/>}
      {m.label}
    </span>
  );
}

function TopicCard({ topic, onStart }: { topic: RecoveryTopic; onStart: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const m = PRIORITY_META[topic.priority];
  return (
    <GlassCard className={cn("overflow-hidden transition-all duration-200 hover:border-white/15")}>
      <div className="p-4" style={{borderLeft:`3px solid ${m.color}`}}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <PriorityTag p={topic.priority}/>
              <SubjectBadge subject={topic.subject}/>
              {topic.teacherAssigned && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Teacher Assigned
                </span>
              )}
            </div>
            <div className="text-sm font-bold text-white">{topic.concept}</div>
            <div className="text-xs text-[#78788c] mt-0.5">{topic.chapter} · {SOURCE_LABELS[topic.source]} · {topic.lastAttempt}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-lg font-black tabular-nums" style={{color:m.color}}>{topic.accuracy}%</div>
              <div className="text-[10px] text-[#78788c]">{topic.attempts} attempts</div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-[#78788c] mb-1">
            <span>Accuracy</span><span>{topic.accuracy}%</span>
          </div>
          <ProgressBar value={topic.accuracy} color={m.color} height="h-1.5"/>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button onClick={onStart}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:brightness-110"
            style={{background:m.color,color:"#fff"}}>
            <Play className="w-3 h-3"/> Start Recovery ({topic.pendingQs} Qs)
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
            <Brain className="w-3 h-3 text-violet-400"/>
            AI Insight {expanded ? <ChevronDown className="w-3 h-3"/> : <ChevronRight className="w-3 h-3"/>}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-xs text-[#a0a0b0] leading-relaxed">
            <div className="flex items-center gap-1.5 mb-1">
              <Brain className="w-3.5 h-3.5 text-violet-400"/>
              <span className="text-violet-400 font-semibold text-[10px] uppercase tracking-wider">Nova's Analysis</span>
            </div>
            {topic.aiReason}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function RecoverySession({ topic, onDone, onBack }: { topic: RecoveryTopic; onDone: (score: number) => void; onBack: () => void }) {
  const questions: { subject: string; difficulty: string; question: string; options: string[]; correct: number; explanation: string }[] = [];
  const [qi, setQi] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number|null)[]>([]);
  const [showExp, setShowExp] = useState(false);

  if (questions.length === 0) {
    return (
      <div className="space-y-5">
        <GlassCard className="p-8 text-center">
          <RefreshCw className="w-8 h-8 text-[#78788c] mx-auto mb-3"/>
          <p className="text-sm font-semibold text-white mb-1">No questions available here</p>
          <p className="text-xs text-[#78788c]">Open the live recovery session to practice this topic.</p>
          <button onClick={onBack}
            className="mt-4 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
            Back to Recovery Hub
          </button>
        </GlassCard>
      </div>
    );
  }

  const q = questions[qi];
  const isLast = qi === questions.length - 1;
  const correct = selected === q.correct;

  function submit(idx: number) {
    if (selected !== null) return;
    setSelected(idx);
    setShowExp(true);
  }

  function next() {
    const newAnswers = [...answers, selected];
    if (isLast) {
      const score = Math.round(newAnswers.filter((a,i) => a === questions[i].correct).length / questions.length * 100);
      onDone(score);
    } else {
      setAnswers(newAnswers);
      setQi(qi + 1);
      setSelected(null);
      setShowExp(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:"rgba(244,63,94,0.15)"}}>
          <RefreshCw className="w-4.5 h-4.5 text-rose-400"/>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-rose-400">Recovery Session</div>
          <div className="text-sm font-bold text-white">{topic.concept}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {questions.map((_, i) => (
          <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-all", i < qi ? "bg-rose-400" : i === qi ? "bg-rose-400/60" : "bg-white/10")}/>
        ))}
      </div>
      <div className="text-[11px] text-[#78788c]">Question {qi + 1} of {questions.length}</div>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SubjectBadge subject={q.subject}/>
          <DifficultyBadge level={q.difficulty as any}/>
        </div>
        <p className="text-sm font-semibold text-white leading-relaxed mb-5">{q.question}</p>
        <div className="space-y-2">
          {q.options.map((opt, i) => {
            let cls = "border-white/10 bg-white/3 hover:bg-white/7 hover:border-white/20";
            if (selected !== null) {
              if (i === q.correct) cls = "border-emerald-400/50 bg-emerald-400/10";
              else if (i === selected && selected !== q.correct) cls = "border-rose-400/50 bg-rose-400/10";
              else cls = "border-white/5 bg-white/2 opacity-50";
            }
            return (
              <button key={i} onClick={() => submit(i)}
                className={cn("w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-all text-sm", cls)}>
                <span className="w-6 h-6 rounded-lg border border-white/15 flex items-center justify-center text-xs font-bold text-[#78788c] shrink-0">
                  {["A","B","C","D"][i]}
                </span>
                <span className={selected !== null ? (i === q.correct ? "text-emerald-300 font-semibold" : i === selected ? "text-rose-300" : "text-[#78788c]") : "text-white"}>
                  {opt}
                </span>
                {selected !== null && i === q.correct && <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto"/>}
                {selected !== null && i === selected && selected !== q.correct && <XCircle className="w-4 h-4 text-rose-400 ml-auto"/>}
              </button>
            );
          })}
        </div>

        {showExp && (
          <div className="mt-4 p-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
            <div className="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Brain className="w-3 h-3"/>Explanation
            </div>
            <p className="text-xs text-[#a0a0b0] leading-relaxed">{q.explanation}</p>
          </div>
        )}

        {selected !== null && (
          <button onClick={next}
            className="mt-4 w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-sm font-bold transition-all flex items-center justify-center gap-2">
            {isLast ? "See Results" : "Next Question"}<ArrowRight className="w-4 h-4"/>
          </button>
        )}
      </GlassCard>
    </div>
  );
}

function SessionResults({ topic, score, setPage, onBack }: { topic: RecoveryTopic; score: number; setPage?: (p: PageKey) => void; onBack: () => void }) {
  const passed = score >= 70;
  const color = passed ? "#4aa87a" : "#c08a3a";
  const size = 110, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;

  return (
    <div className="space-y-6">
      <GlassCard className="p-6 text-center">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[#78788c] mb-4">Recovery Session Complete</div>
        <div className="flex justify-center mb-4">
          <div className="relative inline-flex" style={{width:size,height:size}}>
            <svg width={size} height={size} className="-rotate-90">
              <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
              <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
                style={{filter:`drop-shadow(0 0 10px ${color})`}}/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black" style={{color}}>{score}%</span>
            </div>
          </div>
        </div>
        <div className="text-lg font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>
          {topic.concept}
        </div>
        <p className="text-sm text-[#78788c]">
          {passed ? "Great improvement! Topic is recovering well." : "Keep going — a few more sessions will strengthen this."}
        </p>

        <div className="grid grid-cols-3 gap-3 mt-5">
          {[
            { label:"Score",    value:`${score}%`,            color },
            { label:"Previous", value:`${topic.accuracy}%`,   color:"#78788c" },
            { label:"Change",   value:`+${score - topic.accuracy}%`, color: score > topic.accuracy ? "#4aa87a" : "#cc5069" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl bg-white/3 border border-white/8">
              <div className="text-xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
              <div className="text-[10px] text-[#78788c] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="space-y-2">
        {!passed && (
          <button onClick={() => setPage?.("revision")}
            className="w-full py-3 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 text-sm font-bold flex items-center justify-center gap-2 hover:bg-violet-500/25 transition-all">
            <RotateCcw className="w-4 h-4"/> Add to Revision Schedule
          </button>
        )}
        <button onClick={onBack}
          className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
          Back to Recovery Hub
        </button>
      </div>
    </div>
  );
}

export default function Recovery({ setPage }: { setPage?: (p: PageKey) => void }) {
  const navigate = useNavigate();
  const { data, loading, error } = useRecoveryZone();
  const [view, setView] = useState<RecoveryView>("overview");
  const [activeTopic, setActiveTopic] = useState<RecoveryTopic | null>(null);
  const [sessionScore, setSessionScore] = useState(0);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showHistory, setShowHistory] = useState(false);

  const TOPICS = useMemo(() => (data ? mapRecoveryZoneToTopics(data) : []), [data]);
  const TEACHER_TASKS: { id: string; title: string; teacher: string; due: string; qs: number; subject: string }[] = [];
  const AI_PLAN = useMemo(
    () =>
      TOPICS.filter((t) => t.priority === "high")
        .slice(0, 3)
        .map((t) => ({
          task: `Complete ${t.concept} recovery (${t.pendingQs || 0} questions)`,
          subject: t.subject,
          time: t.pendingQs > 0 ? `${Math.max(10, t.pendingQs * 2)} min` : "—",
          priority: t.priority as Priority,
        })),
    [TOPICS],
  );
  const HISTORY: { id: string; concept: string; subject: string; date: string; score: number; improved: boolean }[] = [];

  function startSession(topic: RecoveryTopic) {
    if (topic.assignmentId) {
      navigate(`/student/recovery/${topic.assignmentId}`);
      return;
    }
    setActiveTopic(topic);
    setView("session");
  }

  function onSessionDone(score: number) {
    setSessionScore(score);
    setView("results");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 text-rose-400 animate-spin"/>
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2"/>
        <p className="text-sm text-[#78788c]">Could not load recovery data</p>
        <p className="text-xs text-[#78788c] mt-1">{error}</p>
      </GlassCard>
    );
  }

  if (view === "session" && activeTopic) {
    return <RecoverySession topic={activeTopic} onDone={onSessionDone}
      onBack={() => { setView("overview"); setActiveTopic(null); }}/>;
  }
  if (view === "results" && activeTopic) {
    return <SessionResults topic={activeTopic} score={sessionScore} setPage={setPage}
      onBack={() => { setView("overview"); setActiveTopic(null); }}/>;
  }

  const filtered = TOPICS.filter(t => {
    const matchSearch = !search || t.concept.toLowerCase().includes(search.toLowerCase()) || t.subject.toLowerCase().includes(search.toLowerCase());
    const matchPriority = priority === "all" || t.priority === priority;
    const matchSource = sourceFilter === "all" || t.source === sourceFilter;
    return matchSearch && matchPriority && matchSource;
  });

  const highCount = TOPICS.filter(t => t.priority === "high").length;
  const totalPending = TOPICS.reduce((a, t) => a + t.pendingQs, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Learning Workflow</div>
          <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Recovery</h1>
          <p className="text-[#78788c] text-sm mt-1">Targeted practice for topics where you need the most help.</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400"/>
          <span className="text-xs font-bold text-rose-400">{highCount} urgent</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Topics Pending",   value:TOPICS.length,   color:"#cc5069", icon:<RefreshCw className="w-4 h-4"/> },
          { label:"Questions Queued", value:totalPending,    color:"#c08a3a", icon:<BookOpen className="w-4 h-4"/> },
          { label:"High Priority",    value:highCount,       color:"#cc5069", icon:<AlertCircle className="w-4 h-4"/> },
          { label:"Sessions Done",    value:HISTORY.length,  color:"#4aa87a", icon:<CheckCircle2 className="w-4 h-4"/> },
        ].map(s => (
          <GlassCard key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-2" style={{color:s.color}}>{s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* AI Recovery Plan */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-400"/>
          </div>
          <div>
            <div className="text-sm font-bold text-white">Nova's Recovery Plan</div>
            <div className="text-[11px] text-[#78788c]">AI-generated for today based on your weak areas</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {AI_PLAN.length === 0 ? (
            <p className="text-xs text-[#78788c] col-span-full">No recovery plan yet — weak areas will appear here as you practice.</p>
          ) : (
            AI_PLAN.map((item, i) => {
            const m = PRIORITY_META[item.priority];
            return (
              <div key={i} className="p-3 rounded-xl border bg-white/2 hover:bg-white/5 transition-all cursor-pointer group"
                style={{borderColor:`${m.color}25`}}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black text-white"
                    style={{background:m.color}}>{i+1}</span>
                  <SubjectBadge subject={item.subject}/>
                </div>
                <p className="text-xs text-white font-semibold leading-snug mb-2">{item.task}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-[#78788c]">
                  <Clock className="w-3 h-3"/>{item.time}
                </div>
              </div>
            );
          })
          )}
        </div>
      </GlassCard>

      {/* Teacher Assigned */}
      {TEACHER_TASKS.length > 0 && (
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-blue-400"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Teacher Assigned</span>
          </div>
          <div className="space-y-2">
            {TEACHER_TASKS.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/15 hover:bg-blue-500/10 transition-all cursor-pointer group">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <Target className="w-4 h-4 text-blue-400"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{t.title}</div>
                  <div className="text-[11px] text-[#78788c]">{t.teacher} · Due {t.due} · {t.qs} questions</div>
                </div>
                <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold transition-all">
                  <Play className="w-3 h-3"/> Start
                </button>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#78788c]"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search topics..."
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-rose-500/40"/>
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-[#78788c]"/>
          {(["all","high","medium","low"] as const).map(p => (
            <button key={p} onClick={() => setPriority(p)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                priority === p ? "bg-rose-500/20 border border-rose-500/40 text-rose-300" : "bg-white/5 border border-white/10 text-[#78788c] hover:bg-white/10")}>
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {(["all","practice","tests","battleground"] as const).map(src => (
            <button key={src} onClick={() => setSourceFilter(src)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                sourceFilter === src ? "bg-white/15 border border-white/25 text-white" : "bg-white/5 border border-white/10 text-[#78788c] hover:bg-white/10")}>
              {src === "all" ? "All Sources" : SOURCE_LABELS[src]}
            </button>
          ))}
        </div>
      </div>

      {/* Topic list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#78788c]">{filtered.length} topic{filtered.length !== 1 ? "s" : ""} found</span>
          <span className="text-xs text-[#78788c]">Sorted by priority</span>
        </div>
        {filtered.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <RefreshCw className="w-8 h-8 text-[#78788c] mx-auto mb-2"/>
            <p className="text-[#78788c] text-sm">No topics match your filters</p>
          </GlassCard>
        ) : (
          filtered.map(t => <TopicCard key={t.id} topic={t} onStart={() => startSession(t)}/>)
        )}
      </div>

      {/* Recovery History */}
      <div>
        <button onClick={() => setShowHistory(h => !h)}
          className="flex items-center gap-2 text-xs text-[#78788c] hover:text-white transition-colors mb-3 group">
          <History className="w-3.5 h-3.5 group-hover:text-white"/>
          Recovery History {showHistory ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
        </button>
        {showHistory && (
          <div className="space-y-2">
            {HISTORY.length === 0 ? (
              <GlassCard className="p-6 text-center">
                <p className="text-xs text-[#78788c]">No completed recovery sessions yet.</p>
              </GlassCard>
            ) : (
              HISTORY.map(h => (
              <GlassCard key={h.id} className="p-4 flex items-center gap-4">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                  h.improved ? "bg-emerald-400/10" : "bg-amber-400/10")}>
                  {h.improved ? <TrendingUp className="w-4 h-4 text-emerald-400"/> : <SkipForward className="w-4 h-4 text-amber-400"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{h.concept}</div>
                  <div className="text-[11px] text-[#78788c]">{h.subject} · {h.date}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-lg font-black tabular-nums" style={{color:h.improved?"#4aa87a":"#c08a3a"}}>{h.score}%</span>
                  <button className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#78788c] hover:text-white transition-all">
                    <RotateCcw className="w-3.5 h-3.5"/>
                  </button>
                </div>
              </GlassCard>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
