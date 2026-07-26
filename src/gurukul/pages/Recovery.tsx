import { useState } from "react";
import type { PageKey } from "@/gurukul/data/mock";
import { practiceQuestions } from "@/gurukul/data/mock";
import { GlassCard, SubjectBadge, ProgressBar, DifficultyBadge, cn } from "@/gurukul/components/shared";
import {
  RefreshCw, AlertCircle, ChevronRight, ChevronDown, CheckCircle2, XCircle,
  Brain, BookOpen, Clock, Target, Flame, Search, Filter, ArrowRight,
  RotateCcw, Zap, Star, TrendingUp, History, Play, SkipForward,
} from "lucide-react";

type RecoveryView = "overview" | "session" | "results";
type Priority = "high" | "medium" | "low";

interface RecoveryTopic {
  id: string; concept: string; subject: string; chapter: string;
  priority: Priority; accuracy: number; attempts: number;
  source: string; pendingQs: number; lastAttempt: string;
  aiReason: string; teacherAssigned: boolean;
}

const TOPICS: RecoveryTopic[] = [
  { id:"rt1", concept:"SN1 vs SN2 Mechanisms", subject:"Chemistry", chapter:"Organic Chemistry",
    priority:"high", accuracy:34, attempts:5, source:"practice", pendingQs:8, lastAttempt:"2 days ago",
    aiReason:"You've confused SN1 and SN2 mechanisms 5 times. The key gap is carbocation stability — you're applying SN2 rules to tertiary substrates.",
    teacherAssigned:true },
  { id:"rt2", concept:"Dihybrid Cross Ratios", subject:"Biology", chapter:"Genetics",
    priority:"high", accuracy:41, attempts:4, source:"tests", pendingQs:6, lastAttempt:"3 days ago",
    aiReason:"Phenotypic vs genotypic ratio confusion is the core issue. You correctly identified dominant/recessive alleles but mixed up the ratio calculation step.",
    teacherAssigned:false },
  { id:"rt3", concept:"Differential Equations — IF Method", subject:"Mathematics", chapter:"Differential Equations",
    priority:"high", accuracy:28, attempts:7, source:"practice", pendingQs:10, lastAttempt:"1 day ago",
    aiReason:"Integrating factor formula is applied inconsistently. You get e^(∫P dx) right but often mis-identify P(x) in the standard form.",
    teacherAssigned:true },
  { id:"rt4", concept:"Electrostatics — Gauss's Law", subject:"Physics", chapter:"Electrostatics",
    priority:"medium", accuracy:55, attempts:3, source:"battleground", pendingQs:5, lastAttempt:"4 days ago",
    aiReason:"Surface selection for Gaussian surfaces trips you up. You understand the concept but struggle when the charge distribution is non-uniform.",
    teacherAssigned:false },
  { id:"rt5", concept:"Plant Physiology — Transpiration", subject:"Biology", chapter:"Plant Physiology",
    priority:"medium", accuracy:48, attempts:3, source:"homework", pendingQs:4, lastAttempt:"5 days ago",
    aiReason:"You mix up stomatal and lenticular transpiration. The cuticular path is consistently forgotten in your answers.",
    teacherAssigned:false },
  { id:"rt6", concept:"Matrix Determinants — 3×3", subject:"Mathematics", chapter:"Matrices",
    priority:"medium", accuracy:61, attempts:2, source:"pyq", pendingQs:4, lastAttempt:"6 days ago",
    aiReason:"Sign convention errors in cofactor expansion. Row expansion is fine but column expansion consistently has sign mistakes.",
    teacherAssigned:false },
  { id:"rt7", concept:"Electromagnetic Induction — Lenz's Law", subject:"Physics", chapter:"Electromagnetic Induction",
    priority:"low", accuracy:67, attempts:2, source:"qbank", pendingQs:3, lastAttempt:"1 week ago",
    aiReason:"You apply Lenz's law correctly in simple cases but struggle with rotating coil scenarios.",
    teacherAssigned:false },
  { id:"rt8", concept:"Electrochemistry — Cell EMF", subject:"Chemistry", chapter:"Electrochemistry",
    priority:"low", accuracy:59, attempts:2, source:"tests", pendingQs:3, lastAttempt:"1 week ago",
    aiReason:"Nernst equation application is mostly correct but standard electrode potential signs get confused.",
    teacherAssigned:true },
];

const TEACHER_TASKS = [
  { id:"tt1", title:"Organic Chemistry Recovery Set", teacher:"Dr. Priya Mehta", due:"Tomorrow", qs:12, subject:"Chemistry" },
  { id:"tt2", title:"Genetics Fundamentals Review", teacher:"Ms. Anjali Singh", due:"Fri, Jun 14", qs:8, subject:"Biology" },
];

const AI_PLAN = [
  { task:"Complete SN1 vs SN2 recovery (8 questions)", subject:"Chemistry", time:"15 min", priority:"high" as Priority },
  { task:"Differential Equations IF method drill (10 Qs)", subject:"Mathematics", time:"20 min", priority:"high" as Priority },
  { task:"Dihybrid Cross ratio practice (6 Qs)", subject:"Biology", time:"12 min", priority:"high" as Priority },
];

const HISTORY = [
  { id:"h1", concept:"Integration by Parts", subject:"Mathematics", date:"Jun 10", score:72, improved:true },
  { id:"h2", concept:"Newton's Laws — Friction", subject:"Physics", date:"Jun 9", score:85, improved:true },
  { id:"h3", concept:"Cell Division — Meiosis", subject:"Biology", date:"Jun 8", score:60, improved:false },
];

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
    <GlassCard className={cn("overflow-hidden transition-all duration-200 hover:border-white/15")}
      style={{borderLeft:`3px solid ${m.color}`}}>
      <div className="p-4">
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

function RecoverySession({ topic, onDone }: { topic: RecoveryTopic; onDone: (score: number) => void }) {
  const questions = practiceQuestions.slice(0, 5);
  const [qi, setQi] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number|null)[]>([]);
  const [showExp, setShowExp] = useState(false);

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
  const [view, setView] = useState<RecoveryView>("overview");
  const [activeTopic, setActiveTopic] = useState<RecoveryTopic | null>(null);
  const [sessionScore, setSessionScore] = useState(0);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showHistory, setShowHistory] = useState(false);

  function startSession(topic: RecoveryTopic) {
    setActiveTopic(topic);
    setView("session");
  }

  function onSessionDone(score: number) {
    setSessionScore(score);
    setView("results");
  }

  if (view === "session" && activeTopic) {
    return <RecoverySession topic={activeTopic} onDone={onSessionDone}/>;
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
          {AI_PLAN.map((item, i) => {
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
          })}
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
            {HISTORY.map(h => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
