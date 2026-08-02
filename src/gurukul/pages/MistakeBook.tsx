import { useEffect, useMemo, useState } from "react";
import type { PageKey } from "@/gurukul/nav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PracticeService, useAcademicContext } from "@/academic";
import { isSubjectAllowedForScope, type AcademicStream } from "@/lib/curriculumScope";
import { assignRecoveryOnMistake } from "@/lib/assignRecoveryOnMistake";
import { displayChapter, displayTopic } from "@/lib/academicDisplay";
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
  /** Raw DB chapter/concept for recovery assign (not display-humanized). */
  chapterRaw: string | null;
  conceptRaw: string | null;
  source: string; sourceLabel: string; date: string; frequency: number;
  aiExplanation: string; correctReason: string; studentReason: string;
  bookmarked: boolean; resolved: boolean; qType: string; sortDate: string;
  questionId: string | null;
}

type MistakeRow = {
  id: string;
  question_text: string;
  options: unknown;
  correct_answer: { correct_index?: number; indexes?: number[] } | null;
  student_answer: { selected_index?: number; indexes?: number[] } | null;
  subject: string;
  chapter: string | null;
  concept: string | null;
  topic: string | null;
  source: string;
  assessment_type: string | null;
  last_wrong_at: string;
  times_wrong: number;
  explanation: string | null;
  mastered: boolean;
  question_id?: string | null;
  difficulty?: string | null;
};

function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

function answerIndex(raw: { correct_index?: number; indexes?: number[] } | null, fallback = 0): number {
  if (!raw) return fallback;
  if (typeof raw.correct_index === "number") return raw.correct_index;
  if (Array.isArray(raw.indexes) && raw.indexes.length > 0) return raw.indexes[0];
  return fallback;
}

function studentIndex(raw: { selected_index?: number; indexes?: number[] } | null, fallback = 0): number {
  if (!raw) return fallback;
  if (typeof raw.selected_index === "number") return raw.selected_index;
  if (Array.isArray(raw.indexes) && raw.indexes.length > 0) return raw.indexes[0];
  return fallback;
}

function formatMistakeDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    practice: "Practice", tests: "Test", battleground: "Battleground",
    homework: "Homework", pyq: "PYQ", qbank: "Question Bank",
  };
  return labels[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

function parseDifficulty(raw: string | null | undefined): "easy" | "medium" | "hard" {
  const d = (raw ?? "").toLowerCase();
  if (d === "easy" || d === "hard" || d === "medium") return d;
  return "medium";
}

function mapRowToMistake(row: MistakeRow, bookmarked: boolean): Mistake {
  const options = parseOptions(row.options);
  const chapterRaw = row.chapter?.trim() || null;
  const conceptRaw = (row.concept ?? row.topic)?.trim() || null;
  return {
    id: row.id,
    question: row.question_text,
    options,
    correct: answerIndex(row.correct_answer, 0),
    chosen: studentIndex(row.student_answer, 0),
    subject: row.subject,
    chapter: displayChapter(row.chapter) || "—",
    topic: displayTopic(row.concept ?? row.topic) || "—",
    chapterRaw,
    conceptRaw,
    difficulty: parseDifficulty(row.difficulty),
    source: row.source,
    sourceLabel: sourceLabel(row.source),
    date: formatMistakeDate(row.last_wrong_at),
    frequency: row.times_wrong ?? 1,
    aiExplanation: row.explanation ?? "",
    correctReason: "",
    studentReason: "",
    bookmarked,
    resolved: row.mastered,
    qType: row.assessment_type ?? "MCQ",
    sortDate: row.last_wrong_at,
    questionId: row.question_id ?? null,
  };
}

/** One row per bank question_id (keep highest frequency / latest); rows without question_id stay unique by id. */
function dedupeMistakes(list: Mistake[]): Mistake[] {
  const byKey = new Map<string, Mistake>();
  for (const m of list) {
    const key = m.questionId ? `q:${m.questionId}` : `id:${m.id}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, m);
      continue;
    }
    const prevTs = new Date(prev.sortDate).getTime();
    const nextTs = new Date(m.sortDate).getTime();
    if (m.frequency > prev.frequency || (m.frequency === prev.frequency && nextTs > prevTs)) {
      byKey.set(key, m);
    }
  }
  return Array.from(byKey.values());
}

const SOURCE_COLORS: Record<string, { color: string; bg: string }> = {
  practice:    { color:"#3b5bdb", bg:"rgba(59,130,246,0.12)" },
  tests:       { color:"#4b9fd4", bg:"rgba(34,211,238,0.12)" },
  battleground:{ color:"#cc5069", bg:"rgba(244,63,94,0.12)" },
  homework:    { color:"#6882e8", bg:"rgba(167,139,250,0.12)" },
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
  const color = freq >= 4 ? "#cc5069" : freq >= 3 ? "#c08a3a" : "#6882e8";
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
            <div className="text-[11px] text-[#78788c] mt-1">{displayChapter(mistake.chapter)} · {displayTopic(mistake.topic)} · {mistake.date}</div>
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
            {mistake.aiExplanation ? (
              <div className="p-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
                <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Brain className="w-3 h-3"/> AI Explanation
                </div>
                <p className="text-xs text-[#a0a0b0] leading-relaxed">{mistake.aiExplanation}</p>
              </div>
            ) : null}

            {/* Why you got it wrong — only when stored */}
            {mistake.studentReason ? (
              <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3"/> Why You Got It Wrong
                </div>
                <p className="text-xs text-[#a0a0b0] leading-relaxed">{mistake.studentReason}</p>
              </div>
            ) : null}
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

  if (!q || questions.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertCircle className="w-8 h-8 text-[#78788c] mx-auto mb-3"/>
        <p className="text-sm font-semibold text-white mb-1">No practice questions available</p>
        <p className="text-xs text-[#78788c]">This mistake has no answer options to practice with.</p>
        <button onClick={() => onDone(0)}
          className="mt-4 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
          Back
        </button>
      </GlassCard>
    );
  }

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
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [view, setView] = useState<MBView>("list");
  const [practiceIds, setPracticeIds] = useState<string[]>([]);
  const [practiceScore, setPracticeScore] = useState(0);
  const [rows, setRows] = useState<MistakeRow[]>([]);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"date"|"frequency"|"subject">("date");
  const [filterResolved, setFilterResolved] = useState<"all"|"unresolved"|"resolved"|"bookmarked">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [toastMsg, setToast] = useState<string|null>(null);
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!ctx || !academicReady) return;
    let cancelled = false;
    (async () => {
      try {
        const scope = await PracticeService.resolveCurriculumScope(ctx);
        if (cancelled) return;
        setStream(scope.stream);
        setClassLevel(scope.classLevel);
      } catch {
        if (!cancelled) {
          setStream(null);
          setClassLevel(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady]);

  useEffect(() => {
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from("student_mistakes")
        .select("*")
        .eq("user_id", user.id)
        .order("last_wrong_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setRows([]);
      } else {
        const base = (data ?? []) as MistakeRow[];
        const bankIds = Array.from(
          new Set(base.map((r) => r.question_id).filter((id): id is string => Boolean(id))),
        );
        const difficultyByBank = new Map<string, string>();
        if (bankIds.length > 0) {
          const { data: bankRows } = await supabase
            .from("question_bank")
            .select("id, difficulty")
            .in("id", bankIds);
          for (const b of bankRows ?? []) {
            const row = b as { id: string; difficulty: string | null };
            if (row.difficulty) difficultyByBank.set(row.id, row.difficulty);
          }
        }
        setRows(
          base.map((r) => ({
            ...r,
            difficulty: (r.question_id && difficultyByBank.get(r.question_id)) || r.difficulty || null,
          })),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const mistakes = useMemo(
    () =>
      dedupeMistakes(
        rows
          .filter((r) => isSubjectAllowedForScope(r.subject, stream, classLevel))
          .map((r) => mapRowToMistake(r, bookmarks.has(r.id))),
      ),
    [rows, bookmarks, stream, classLevel],
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function toggleBookmark(id: string) {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addToRecovery(id: string) {
    const m = mistakes.find(x => x.id === id);
    if (!m) return;
    try {
      const assignmentId = await assignRecoveryOnMistake({
        subject: m.subject,
        chapter: m.chapterRaw,
        concept: m.conceptRaw || m.chapterRaw,
        sourceType: "student_mistake",
        sourceId: m.id,
      });
      setToast(
        assignmentId
          ? `"${m.topic || m.chapter}" queued for Recovery`
          : `Could not create recovery for "${m.topic || m.chapter}" — try Practice`,
      );
      setTimeout(() => {
        if (assignmentId) setPage?.("recovery");
        else setPage?.("practice");
      }, 800);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not add to Recovery");
    }
  }

  async function finishMistakePractice(score: number) {
    setPracticeScore(score);
    setView("results");
    if (score < 70 || practiceIds.length === 0 || !ctx) return;
    try {
      await PracticeService.markMistakesMastered(ctx, practiceIds);
      setRows((prev) =>
        prev.map((r) => (practiceIds.includes(r.id) ? { ...r, mastered: true } : r)),
      );
    } catch (e) {
      console.warn("mark mistakes mastered:", e instanceof Error ? e.message : e);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <AlertCircle className="w-6 h-6 text-rose-400 animate-spin"/>
      </div>
    );
  }

  if (loadError) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2"/>
        <p className="text-sm text-[#78788c]">Could not load mistakes</p>
        <p className="text-xs text-[#78788c] mt-1">{loadError}</p>
      </GlassCard>
    );
  }

  if (view === "practice") {
    return <MistakePractice ids={practiceIds} mistakes={mistakes}
      onDone={(score) => void finishMistakePractice(score)}/>;
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

  const subjects = ["all", ...Array.from(new Set(mistakes.map((m) => m.subject)))];
  const sources = ["all", ...Array.from(new Set(mistakes.map((m) => m.source)))];

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
      new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime()
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
      {toastMsg && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-[#131316] border border-rose-500/30 text-rose-300 text-sm font-semibold shadow-2xl animate-in slide-in-from-right">
          <RefreshCw className="w-4 h-4"/>
          {toastMsg}
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
            <p className="text-[#78788c] text-sm">
              {mistakes.length === 0
                ? "No mistakes saved yet. Wrong answers from practice and tests appear here automatically."
                : "No mistakes match your filters"}
            </p>
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
