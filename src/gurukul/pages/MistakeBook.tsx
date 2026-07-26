import { useState } from "react";
import type { PageKey } from "@/gurukul/data/mock";
import { practiceQuestions } from "@/gurukul/data/mock";
import { GlassCard, SubjectBadge, DifficultyBadge, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  AlertCircle, Brain, Search, Filter, Bookmark, BookmarkCheck,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, ArrowRight,
  RotateCcw, RefreshCw, Zap, Star, TrendingUp, Clock,
  Play, History, BarChart2, SortAsc, Eye,
} from "lucide-react";

type MBView = "list" | "practice" | "results";

interface Mistake {
  id: string; question: string; options: string[]; correct: number; chosen: number;
  subject: string; chapter: string; topic: string; difficulty: "easy"|"medium"|"hard";
  source: string; sourceLabel: string; date: string; frequency: number;
  aiExplanation: string; correctReason: string; studentReason: string;
  bookmarked: boolean; resolved: boolean; qType: string;
}

const MISTAKES: Mistake[] = [
  {
    id:"m1", subject:"Chemistry", chapter:"Organic Chemistry", topic:"Reaction Mechanisms", difficulty:"hard",
    source:"practice", sourceLabel:"Practice", date:"Jun 10", frequency:3, qType:"MCQ",
    question:"Which mechanism does methyl bromide (CH₃Br) follow with NaOH in aqueous solution?",
    options:["SN1 only","SN2 only","Both SN1 and SN2","Free radical substitution"],
    correct:1, chosen:0,
    aiExplanation:"Methyl bromide (CH₃Br) follows SN2 exclusively because methyl carbon forms an extremely unstable primary (actually no carbon) carbocation — SN1 cannot proceed. SN2 is favored by the unhindered methyl group.",
    correctReason:"CH₃Br is a primary alkyl halide with no steric hindrance, perfect for SN2 backside attack by the strong nucleophile OH⁻.",
    studentReason:"You selected SN1, likely confusing primary carbocations with stable tertiary ones. Remember: SN1 requires stable carbocations (3° > 2° >> 1°).",
    bookmarked:true, resolved:false,
  },
  {
    id:"m2", subject:"Biology", chapter:"Genetics", topic:"Mendelian Genetics", difficulty:"medium",
    source:"tests", sourceLabel:"Test", date:"Jun 9", frequency:2, qType:"MCQ",
    question:"In a dihybrid cross AaBb × AaBb, what is the phenotypic ratio?",
    options:["3:1","1:2:1","9:3:3:1","1:1:1:1"],
    correct:2, chosen:0,
    aiExplanation:"In a dihybrid cross with two independent traits, Mendel's law of independent assortment gives 16 combinations: 9 A_B_ : 3 A_bb : 3 aaB_ : 1 aabb, hence 9:3:3:1.",
    correctReason:"Each trait segregates independently (3:1), and combined they give 9:3:3:1. Think of a 4×4 Punnett square.",
    studentReason:"You chose 3:1 which is correct for a monohybrid cross. You're applying the wrong rule — always check how many traits are involved first.",
    bookmarked:false, resolved:false,
  },
  {
    id:"m3", subject:"Mathematics", chapter:"Differential Equations", topic:"Integrating Factor", difficulty:"hard",
    source:"practice", sourceLabel:"Practice", date:"Jun 8", frequency:4, qType:"Numerical",
    question:"The integrating factor for dy/dx + (2/x)y = x² is:",
    options:["x","x²","1/x","e^(2x)"],
    correct:1, chosen:0,
    aiExplanation:"For dy/dx + P(x)y = Q(x), integrating factor = e^(∫P dx). Here P(x) = 2/x, so IF = e^(∫2/x dx) = e^(2 ln x) = x².",
    correctReason:"IF = e^(∫P dx) = e^(∫2/x dx) = e^(2 ln|x|) = |x|² = x² (for x > 0).",
    studentReason:"You chose x instead of x². You correctly computed ∫2/x dx = 2 ln x but didn't apply the exponential step properly.",
    bookmarked:true, resolved:false,
  },
  {
    id:"m4", subject:"Physics", chapter:"Electrostatics", topic:"Gauss's Law", difficulty:"medium",
    source:"battleground", sourceLabel:"Battleground", date:"Jun 7", frequency:1, qType:"MCQ",
    question:"Electric field inside a hollow conducting sphere with surface charge is:",
    options:["Maximum at center","Uniform throughout","Zero everywhere inside","Depends on sphere radius"],
    correct:2, chosen:3,
    aiExplanation:"By Gauss's law, for any closed surface inside the hollow conductor, the enclosed charge is zero (charges reside only on surface). Therefore E·A = 0 and E = 0 everywhere inside.",
    correctReason:"All free charges on a conductor reside on the outer surface. Inside, there is no enclosed charge for any Gaussian surface, so E = 0.",
    studentReason:"You chose 'depends on sphere radius' — this would be true for a solid charged sphere. For a hollow conductor, the interior is shielded.",
    bookmarked:false, resolved:true,
  },
  {
    id:"m5", subject:"Chemistry", chapter:"Electrochemistry", topic:"Nernst Equation", difficulty:"hard",
    source:"tests", sourceLabel:"Test", date:"Jun 6", frequency:2, qType:"Numerical",
    question:"Using Nernst equation at 25°C, cell EMF when Q=10 for a 2-electron reaction with E°=1.1V:",
    options:["1.07 V","1.13 V","1.07 V","0.80 V"],
    correct:0, chosen:1,
    aiExplanation:"E = E° − (0.0592/n)·log Q = 1.1 − (0.0592/2)·log 10 = 1.1 − 0.0296·1 = 1.0704 ≈ 1.07 V.",
    correctReason:"Nernst at 25°C: E = E° − (0.0592/n) log Q. Plug in n=2, Q=10: E = 1.1 − 0.0296 = 1.07 V.",
    studentReason:"You chose 1.13V — you likely added instead of subtracted the Nernst correction. Always subtract when Q > 1.",
    bookmarked:false, resolved:false,
  },
  {
    id:"m6", subject:"Mathematics", chapter:"Integration", topic:"Definite Integrals", difficulty:"medium",
    source:"pyq", sourceLabel:"PYQ", date:"Jun 5", frequency:1, qType:"MCQ",
    question:"The value of ∫₀^(π/2) sin²x dx is:",
    options:["π/2","π/4","1","π/3"],
    correct:1, chosen:0,
    aiExplanation:"Using the reduction formula: ∫₀^(π/2) sin²x dx = (1/2)·[x − sin(2x)/2]₀^(π/2) = (1/2)·(π/2) = π/4.",
    correctReason:"sin²x = (1 − cos 2x)/2. Integrating gives x/2 − sin(2x)/4. Evaluating from 0 to π/2 gives π/4.",
    studentReason:"You confused this with ∫₀^(π/2) sin x dx = 1. Always apply the half-angle identity first for sin²x integrals.",
    bookmarked:true, resolved:false,
  },
  {
    id:"m7", subject:"Biology", chapter:"Plant Physiology", topic:"Transpiration", difficulty:"easy",
    source:"homework", sourceLabel:"Homework", date:"Jun 4", frequency:1, qType:"MCQ",
    question:"The largest proportion of water loss in plants occurs through:",
    options:["Lenticels","Cuticle","Stomata","Roots"],
    correct:2, chosen:1,
    aiExplanation:"About 90% of transpiration occurs through stomata (stomatal transpiration). Cuticular transpiration is only 5-10% and lenticular is negligible.",
    correctReason:"Stomata are the primary pathway for gas exchange and water vapor loss. They can open/close to regulate transpiration.",
    studentReason:"You chose cuticle — that accounts for only ~5% of total water loss. Cuticle is a waxy, hydrophobic layer that resists water loss.",
    bookmarked:false, resolved:false,
  },
];

const SOURCE_COLORS: Record<string, { color: string; bg: string }> = {
  practice:    { color:"#6366f1", bg:"rgba(59,130,246,0.12)" },
  tests:       { color:"#4b9fd4", bg:"rgba(34,211,238,0.12)" },
  battleground:{ color:"#cc5069", bg:"rgba(244,63,94,0.12)" },
  homework:    { color:"#8f7dd6", bg:"rgba(167,139,250,0.12)" },
  pyq:         { color:"#c08a3a", bg:"rgba(245,158,11,0.12)" },
  qbank:       { color:"#4aa87a", bg:"rgba(52,211,153,0.12)" },
};

function SourceTag({ source, label }: { source: string; label: string }) {
  const c = SOURCE_COLORS[source] ?? { color:"#78788c", bg:"rgba(107,122,153,0.12)" };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{color:c.color,background:c.bg}}>
      {label}
    </span>
  );
}

function FreqBadge({ freq }: { freq: number }) {
  if (freq < 2) return null;
  const color = freq >= 4 ? "#cc5069" : freq >= 3 ? "#c08a3a" : "#8f7dd6";
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{color,background:`${color}15`}}>
      ×{freq}
    </span>
  );
}

function MistakeCard({
  mistake, onRetry, onAddRecovery, onToggleBookmark,
}: {
  mistake: Mistake;
  onRetry: () => void;
  onAddRecovery: () => void;
  onToggleBookmark: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <GlassCard className={cn("overflow-hidden transition-all duration-200",
      mistake.resolved ? "border-l-2 border-l-emerald-400/50" : "border-l-2 border-l-rose-400/50")}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <SourceTag source={mistake.source} label={mistake.sourceLabel}/>
              <SubjectBadge subject={mistake.subject}/>
              <DifficultyBadge level={mistake.difficulty}/>
              <FreqBadge freq={mistake.frequency}/>
              {mistake.resolved && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400">Resolved</span>
              )}
            </div>
            <p className="text-sm font-semibold text-white leading-snug">{mistake.question}</p>
            <div className="text-[11px] text-[#78788c] mt-1">{mistake.chapter} · {mistake.topic} · {mistake.date}</div>
          </div>
          <button onClick={() => onToggleBookmark(mistake.id)} className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 transition-all">
            {mistake.bookmarked
              ? <BookmarkCheck className="w-4 h-4 text-amber-400 fill-amber-400"/>
              : <Bookmark className="w-4 h-4 text-[#78788c]"/>}
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-[#78788c] font-semibold hover:bg-white/10 transition-all">
            <Eye className="w-3 h-3"/> Details {expanded ? <ChevronDown className="w-3 h-3"/> : <ChevronRight className="w-3 h-3"/>}
          </button>
          <button onClick={onRetry}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-300 text-xs font-bold hover:bg-violet-500/25 transition-all">
            <RotateCcw className="w-3 h-3"/> Retry
          </button>
          {!mistake.resolved && (
            <button onClick={onAddRecovery}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/25 text-rose-300 text-xs font-bold hover:bg-rose-500/25 transition-all">
              <RefreshCw className="w-3 h-3"/> Add to Recovery
            </button>
          )}
        </div>

        {expanded && (
          <div className="mt-4 space-y-3">
            {/* Answer comparison */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl bg-rose-500/8 border border-rose-500/20">
                <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <XCircle className="w-3 h-3"/> Your Answer
                </div>
                <p className="text-xs text-rose-200 font-semibold">{mistake.options[mistake.chosen]}</p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3"/> Correct Answer
                </div>
                <p className="text-xs text-emerald-200 font-semibold">{mistake.options[mistake.correct]}</p>
              </div>
            </div>

            {/* AI Explanation */}
            <div className="p-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
              <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Brain className="w-3 h-3"/> AI Explanation
              </div>
              <p className="text-xs text-[#a0a0b0] leading-relaxed">{mistake.aiExplanation}</p>
            </div>

            {/* Why you got it wrong */}
            <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3"/> Why You Got It Wrong
              </div>
              <p className="text-xs text-[#a0a0b0] leading-relaxed">{mistake.studentReason}</p>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function MistakePractice({ ids, mistakes, onDone }: { ids: string[]; mistakes: Mistake[]; onDone: (score: number) => void }) {
  const practiceMs = ids.map(id => mistakes.find(m => m.id === id)!).filter(Boolean);
  const questions = practiceMs.map(m => ({
    id: m.id, subject: m.subject, chapter: m.chapter, question: m.question,
    options: m.options, correct: m.correct, explanation: m.aiExplanation,
    difficulty: m.difficulty, frequency: m.frequency,
  }));

  const [qi, setQi] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number|null)[]>([]);
  const [showExp, setShowExp] = useState(false);

  const q = questions[qi];
  const isLast = qi === questions.length - 1;

  function submit(idx: number) { if (selected !== null) return; setSelected(idx); setShowExp(true); }
  function next() {
    const newAnswers = [...answers, selected];
    if (isLast) {
      onDone(Math.round(newAnswers.filter((a, i) => a === questions[i].correct).length / questions.length * 100));
    } else { setAnswers(newAnswers); setQi(qi + 1); setSelected(null); setShowExp(false); }
  }

  if (!q) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-rose-500/15 flex items-center justify-center">
          <AlertCircle className="w-4 h-4 text-rose-400"/>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-rose-400">Mistake Practice</div>
          <div className="text-sm font-bold text-white">{questions.length} mistakes to work through</div>
        </div>
      </div>

      <div className="flex gap-1.5">
        {questions.map((_, i) => (
          <div key={i} className={cn("h-1.5 flex-1 rounded-full", i < qi ? "bg-rose-400" : i === qi ? "bg-rose-400/50" : "bg-white/10")}/>
        ))}
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SubjectBadge subject={q.subject}/>
          <div className="flex items-center gap-2">
            {q.frequency >= 2 && (
              <span className="text-[10px] font-bold text-rose-400 bg-rose-400/10 px-2 py-0.5 rounded-full">
                You've missed this {q.frequency}× before
              </span>
            )}
            <DifficultyBadge level={q.difficulty as any}/>
          </div>
        </div>

        <p className="text-sm font-semibold text-white leading-relaxed mb-5">{q.question}</p>

        <div className="space-y-2">
          {q.options.map((opt, i) => {
            let cls = "border-white/10 bg-white/3 hover:bg-white/7 hover:border-white/20";
            if (selected !== null) {
              if (i === q.correct) cls = "border-emerald-400/50 bg-emerald-400/10";
              else if (i === selected && i !== q.correct) cls = "border-rose-400/50 bg-rose-400/10";
              else cls = "border-white/5 bg-white/2 opacity-50";
            }
            return (
              <button key={i} onClick={() => submit(i)}
                className={cn("w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-all text-sm", cls)}>
                <span className="w-6 h-6 rounded-lg border border-white/15 flex items-center justify-center text-xs font-bold text-[#78788c] shrink-0">{["A","B","C","D"][i]}</span>
                <span className={selected !== null ? (i === q.correct ? "text-emerald-300 font-semibold" : i === selected ? "text-rose-300" : "text-[#78788c]") : "text-white"}>{opt}</span>
                {selected !== null && i === q.correct && <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto"/>}
                {selected !== null && i === selected && i !== q.correct && <XCircle className="w-4 h-4 text-rose-400 ml-auto"/>}
              </button>
            );
          })}
        </div>

        {showExp && (
          <div className="mt-4 p-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
            <div className="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Brain className="w-3 h-3"/> AI Explanation
            </div>
            <p className="text-xs text-[#a0a0b0] leading-relaxed">{q.explanation}</p>
          </div>
        )}

        {selected !== null && (
          <button onClick={next} className="mt-4 w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-sm font-bold transition-all flex items-center justify-center gap-2">
            {isLast ? "See Results" : "Next Question"} <ArrowRight className="w-4 h-4"/>
          </button>
        )}
      </GlassCard>
    </div>
  );
}

export default function MistakeBook({ setPage }: { setPage?: (p: PageKey) => void }) {
  const [view, setView] = useState<MBView>("list");
  const [practiceIds, setPracticeIds] = useState<string[]>([]);
  const [practiceScore, setPracticeScore] = useState(0);
  const [mistakes, setMistakes] = useState<Mistake[]>(MISTAKES);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"date"|"frequency"|"subject">("date");
  const [filterResolved, setFilterResolved] = useState<"all"|"unresolved"|"resolved"|"bookmarked">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [toast, setToast] = useState<string|null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function toggleBookmark(id: string) {
    setMistakes(ms => ms.map(m => m.id === id ? {...m, bookmarked: !m.bookmarked} : m));
  }

  function addToRecovery(id: string) {
    const m = mistakes.find(x => x.id === id);
    showToast(`"${m?.topic}" added to Recovery`);
    setTimeout(() => setPage?.("recovery"), 1200);
  }

  if (view === "practice") {
    return <MistakePractice ids={practiceIds} mistakes={mistakes}
      onDone={score => { setPracticeScore(score); setView("results"); }}/>;
  }

  if (view === "results") {
    const size = 110, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const passed = practiceScore >= 70;
    const color = passed ? "#4aa87a" : "#c08a3a";
    const offset = c - (practiceScore / 100) * c;
    return (
      <div className="space-y-6">
        <GlassCard className="p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.15em] text-[#78788c] mb-4">Mistake Practice Complete</div>
          <div className="flex justify-center mb-4">
            <div className="relative inline-flex" style={{width:size,height:size}}>
              <svg width={size} height={size} className="-rotate-90">
                <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
                <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                  strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{filter:`drop-shadow(0 0 10px ${color})`}}/>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black" style={{color}}>{practiceScore}%</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-[#78788c]">{passed ? "Great progress on your mistakes!" : "Keep practicing these — consistency is key."}</p>
        </GlassCard>
        <div className="space-y-2">
          {!passed && (
            <button onClick={() => setPage?.("recovery")}
              className="w-full py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm font-bold flex items-center justify-center gap-2 hover:bg-rose-500/25 transition-all">
              <RefreshCw className="w-4 h-4"/> Move to Recovery
            </button>
          )}
          <button onClick={() => setView("list")}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
            Back to Mistake Book
          </button>
        </div>
      </div>
    );
  }

  const subjects = ["all", "Mathematics", "Physics", "Chemistry", "Biology"];
  const sources = ["all", "practice", "tests", "battleground", "homework", "pyq"];

  const filtered = mistakes
    .filter(m => {
      const q = search.toLowerCase();
      const matchSearch = !search || m.question.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.chapter.toLowerCase().includes(q) || m.topic.toLowerCase().includes(q);
      const matchRes = filterResolved === "all" ? true : filterResolved === "unresolved" ? !m.resolved : filterResolved === "resolved" ? m.resolved : m.bookmarked;
      const matchSrc = sourceFilter === "all" || m.source === sourceFilter;
      const matchSub = subjectFilter === "all" || m.subject === subjectFilter;
      return matchSearch && matchRes && matchSrc && matchSub;
    })
    .sort((a, b) =>
      sort === "frequency" ? b.frequency - a.frequency :
      sort === "subject" ? a.subject.localeCompare(b.subject) :
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  const unresolved = mistakes.filter(m => !m.resolved).length;
  const bookmarked = mistakes.filter(m => m.bookmarked).length;
  const repeated = mistakes.filter(m => m.frequency >= 3).length;

  const subjectBreakdown = subjects.filter(s => s !== "all").map(s => ({
    subject: s,
    count: mistakes.filter(m => m.subject === s).length,
    unresolved: mistakes.filter(m => m.subject === s && !m.resolved).length,
  }));

  return (
    <div className="space-y-6 relative">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-[#131316] border border-rose-500/30 text-rose-300 text-sm font-semibold shadow-2xl animate-in slide-in-from-right">
          <RefreshCw className="w-4 h-4"/>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Learning Workflow</div>
          <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Mistake Book</h1>
          <p className="text-[#78788c] text-sm mt-1">Every mistake you've made — automatically collected and explained.</p>
        </div>
        <button onClick={() => { setPracticeIds(mistakes.filter(m => !m.resolved).map(m => m.id)); setView("practice"); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-sm font-bold hover:bg-rose-500/30 transition-all">
          <Play className="w-3.5 h-3.5"/> Practice All
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Total Mistakes",  value:mistakes.length, color:"#cc5069", icon:<AlertCircle className="w-4 h-4"/> },
          { label:"Unresolved",      value:unresolved,      color:"#c08a3a", icon:<XCircle className="w-4 h-4"/> },
          { label:"Bookmarked",      value:bookmarked,      color:"#c08a3a", icon:<Bookmark className="w-4 h-4 fill-amber-400"/> },
          { label:"Repeated ×3+",   value:repeated,        color:"#cc5069", icon:<RefreshCw className="w-4 h-4"/> },
        ].map(s => (
          <GlassCard key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-2" style={{color:s.color}}>{s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Subject breakdown */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-[#cc5069]"/>
          <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Subject Breakdown</span>
        </div>
        <div className="space-y-3">
          {subjectBreakdown.filter(s => s.count > 0).map(s => (
            <div key={s.subject} className="flex items-center gap-3">
              <span className="text-xs text-white font-semibold w-24 shrink-0">{s.subject}</span>
              <div className="flex-1">
                <ProgressBar value={s.count} max={mistakes.length} color="#cc5069"/>
              </div>
              <span className="text-xs font-bold tabular-nums text-rose-400 w-12 text-right">{s.count} ({s.unresolved} open)</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#78788c]"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search questions, topics, chapters..."
            className="w-full pl-8 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-rose-500/40"/>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <SortAsc className="w-3.5 h-3.5 text-[#78788c]"/>
            {(["date","frequency","subject"] as const).map(s => (
              <button key={s} onClick={() => setSort(s)}
                className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                  sort === s ? "bg-white/15 border border-white/25 text-white" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-[#78788c]"/>
            {(["all","unresolved","resolved","bookmarked"] as const).map(f => (
              <button key={f} onClick={() => setFilterResolved(f)}
                className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                  filterResolved === f ? "bg-rose-500/20 border border-rose-500/40 text-rose-300" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sources.map(src => (
            <button key={src} onClick={() => setSourceFilter(src)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                sourceFilter === src ? "bg-white/15 border border-white/25 text-white" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
              {src === "all" ? "All Sources" : src.charAt(0).toUpperCase() + src.slice(1)}
            </button>
          ))}
          {subjects.map(s => (
            <button key={s} onClick={() => setSubjectFilter(s)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                subjectFilter === s ? "bg-violet-500/20 border border-violet-500/40 text-violet-300" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
              {s === "all" ? "All Subjects" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Practice filtered mistakes */}
      {filtered.length > 0 && filtered.some(m => !m.resolved) && (
        <button onClick={() => { setPracticeIds(filtered.filter(m => !m.resolved).map(m => m.id)); setView("practice"); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-rose-500/30 bg-rose-500/5 text-rose-300 text-sm font-semibold hover:bg-rose-500/10 transition-all">
          <Play className="w-3.5 h-3.5"/> Practice {filtered.filter(m => !m.resolved).length} visible unresolved mistakes
        </button>
      )}

      {/* Mistake list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#78788c]">{filtered.length} mistake{filtered.length !== 1 ? "s" : ""}</span>
        </div>
        {filtered.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <AlertCircle className="w-8 h-8 text-[#78788c] mx-auto mb-2"/>
            <p className="text-[#78788c] text-sm">No mistakes match your filters</p>
          </GlassCard>
        ) : (
          filtered.map(m => (
            <MistakeCard key={m.id} mistake={m}
              onRetry={() => { setPracticeIds([m.id]); setView("practice"); }}
              onAddRecovery={() => addToRecovery(m.id)}
              onToggleBookmark={toggleBookmark}/>
          ))
        )}
      </div>
    </div>
  );
}
