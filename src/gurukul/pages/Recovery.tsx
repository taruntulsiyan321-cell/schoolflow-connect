import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { useRecoveryZone, type RecoveryZoneData, type WeakConcept } from "@/hooks/useRecoveryZone";
import { PracticeService, useAcademicContext } from "@/academic";
import { DecisionEngineService, type WeakAreaRecommendation } from "@/academic/services/decisionEngineService";
import { DECISION_ENGINE_FEATURE_FLAGS } from "@/lib/productFeatureFlags";
import { assignRecoveryOnMistake } from "@/lib/assignRecoveryOnMistake";
import { isSubjectAllowedForScope, type AcademicStream } from "@/lib/curriculumScope";
import { displayChapter, displayConcept } from "@/lib/academicDisplay";
import { isPlaceholderAcademicLabel } from "@/academic/taxonomy";
import { GlassCard, SubjectBadge, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  RefreshCw, AlertCircle, ChevronRight, ChevronDown, CheckCircle2,
  Brain, BookOpen, Clock, Target, Search, Filter,
  RotateCcw, TrendingUp, History, Play, SkipForward,
} from "lucide-react";

type RecoveryView = "overview" | "session" | "results";
type Priority = "high" | "medium" | "low";

interface RecoveryTopic {
  id: string; assignmentId?: string; concept: string; subject: string; chapter: string;
  priority: Priority; mastery: number; attempts: number;
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
    if (isPlaceholderAcademicLabel(w.subject) || isPlaceholderAcademicLabel(w.concept)) continue;
    weakMap.set(`${w.subject}:${w.concept}`, w);
  }

  const topics: RecoveryTopic[] = [];
  const seen = new Set<string>();

  for (const a of data.open_assignments ?? []) {
    if (isPlaceholderAcademicLabel(a.subject) || isPlaceholderAcademicLabel(a.concept)) continue;
    const key = `${a.subject}:${a.concept}`;
    seen.add(key);
    const weak = weakMap.get(key);
    const chapter =
      a.chapter && !isPlaceholderAcademicLabel(a.chapter) ? a.chapter : "—";
    topics.push({
      id: a.id,
      assignmentId: a.id,
      concept: a.concept,
      subject: a.subject,
      chapter,
      priority: severityToPriority(a.severity),
      mastery: Math.round(weak?.mastery_score ?? 0),
      attempts: weak?.mistake_count ?? 0,
      source: sourceFromType(a.source_type),
      pendingQs: Math.max(0, (a.question_count ?? 0) - (a.questions_completed ?? 0)),
      lastAttempt: formatRelativeDate(a.created_at),
      aiReason: weak
        ? `Mastery ${Math.round(weak.mastery_score)}% on ${displayConcept(a.concept)} — recovery drill queued from recent mistakes.`
        : `Recovery assignment for ${displayConcept(a.concept)} from your mistake pattern.`,
      teacherAssigned: false,
    });
  }

  for (const w of data.weak_concepts ?? []) {
    if (isPlaceholderAcademicLabel(w.subject) || isPlaceholderAcademicLabel(w.concept)) continue;
    const key = `${w.subject}:${w.concept}`;
    if (seen.has(key)) continue;
    const chapter =
      w.chapter && !isPlaceholderAcademicLabel(w.chapter) ? w.chapter : "—";
    topics.push({
      id: key,
      concept: w.concept,
      subject: w.subject,
      chapter,
      priority: w.mastery_score < 40 ? "high" : w.mastery_score < 55 ? "medium" : "low",
      mastery: Math.round(w.mastery_score),
      attempts: w.mistake_count ?? 0,
      source: "practice",
      pendingQs: 0,
      lastAttempt: "—",
      aiReason: `Weak concept detected at ${Math.round(w.mastery_score)}% mastery — start practice or open Nova for a targeted review.`,
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

/** Map recovery_assignments.source_type → UI filter keys. */
function sourceFromType(sourceType: string | null | undefined): string {
  const s = (sourceType ?? "").toLowerCase();
  if (s.includes("battle")) return "battleground";
  if (s.includes("dpp") || s.includes("test") || s.includes("exam") || s.includes("marks")) return "tests";
  if (s.includes("homework") || s.includes("assignment")) return "homework";
  if (s.includes("pyq")) return "pyq";
  if (s.includes("qbank") || s.includes("question_bank")) return "qbank";
  return "practice";
}

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

function TopicCard({ topic, onStart, starting }: { topic: RecoveryTopic; onStart: () => void; starting?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const m = PRIORITY_META[topic.priority];
  return (
    <GlassCard className={cn("overflow-hidden transition-all duration-200 hover:border-border")}>
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
            <div className="text-sm font-bold text-white">{displayConcept(topic.concept)}</div>
            <div className="text-xs text-[#78788c] mt-0.5">{displayChapter(topic.chapter)} · {SOURCE_LABELS[topic.source]} · {topic.lastAttempt}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-lg font-black tabular-nums" style={{color:m.color}}>{topic.mastery}%</div>
              <div className="text-[10px] text-[#78788c]">{topic.attempts} mistakes</div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-[#78788c] mb-1">
            <span>Mastery</span><span>{topic.mastery}%</span>
          </div>
          <ProgressBar value={topic.mastery} color={m.color} height="h-1.5"/>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button onClick={onStart} disabled={starting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:brightness-110 disabled:opacity-50"
            style={{background:m.color,color:"#fff"}}>
            <Play className="w-3 h-3"/>
            {topic.assignmentId
              ? `Start Recovery (${topic.pendingQs} Qs)`
              : "Practice this concept"}
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#78788c] bg-white/5 hover:bg-white/10 transition-all">
            <Brain className="w-3 h-3 text-violet-400"/>
            Insight {expanded ? <ChevronDown className="w-3 h-3"/> : <ChevronRight className="w-3 h-3"/>}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-xs text-[#a0a0b0] leading-relaxed space-y-2">
            <div className="flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-violet-400"/>
              <span className="text-violet-400 font-semibold text-[10px] uppercase tracking-wider">Recovery insight</span>
            </div>
            <p>{topic.aiReason}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/student/practice" className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold text-[#4b9fd4] hover:bg-white/10">Practice</Link>
              <Link to="/student/revision" className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold text-[#c08a3a] hover:bg-white/10">Revision</Link>
              <Link to="/student/aicoach" className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold text-violet-400 hover:bg-white/10">Ask Nova</Link>
              <Link to="/student/mistakes" className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold text-rose-400 hover:bg-white/10">Mistake Book</Link>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function RecoverySession({ topic, onBack }: { topic: RecoveryTopic; onBack: () => void }) {
  return (
    <div className="space-y-5">
      <GlassCard className="p-8 text-center">
        <RefreshCw className="w-8 h-8 text-[#78788c] mx-auto mb-3"/>
        <p className="text-sm font-semibold text-white mb-1">Open live recovery</p>
        <p className="text-xs text-[#78788c] mb-4">
          Recovery drills load from your assigned concepts. Practice, Revision, or Nova can help meanwhile.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {topic.assignmentId ? (
            <Link
              to={`/student/recovery/${topic.assignmentId}`}
              className="px-4 py-2 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-sm font-semibold hover:bg-rose-500/30 transition-all"
            >
              Open assignment
            </Link>
          ) : (
            <Link
              to={`/student/practice?chapter=${encodeURIComponent(topic.chapter !== "—" ? topic.chapter : topic.concept)}&subject=${encodeURIComponent(topic.subject)}`}
              className="px-4 py-2 rounded-xl bg-[#3b5bdb]/20 border border-[#3b5bdb]/30 text-[#4b9fd4] text-sm font-semibold hover:bg-[#3b5bdb]/30 transition-all"
            >
              Go to Practice
            </Link>
          )}
          <Link to="/student/aicoach" className="px-4 py-2 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm font-semibold">
            Ask Nova
          </Link>
          <button onClick={onBack}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
            Back
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

function SessionResults({ topic, score, setPage, onBack }: { topic: RecoveryTopic; score: number; setPage?: (p: PageKey) => void; onBack: () => void }) {
  const passed = score >= 70;
  const color = passed ? "#4aa87a" : "#c08a3a";
  const size = 110, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const [addingRevision, setAddingRevision] = useState(false);

  async function addToRevision() {
    setAddingRevision(true);
    try {
      await assignRecoveryOnMistake({
        subject: topic.subject,
        chapter: topic.chapter !== "—" ? topic.chapter : null,
        concept: topic.concept,
        sourceType: "recovery_followup",
        sourceId: topic.assignmentId ?? topic.id,
        accuracy: score,
      });
      // Recovery assign also queues revision when applicable; navigate to revision hub.
      setPage?.("revision");
    } catch {
      setPage?.("revision");
    } finally {
      setAddingRevision(false);
    }
  }

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
          {displayConcept(topic.concept)}
        </div>
        <p className="text-sm text-[#78788c]">
          {passed ? "Great improvement! Topic is recovering well." : "Keep going — a few more sessions will strengthen this."}
        </p>

        <div className="grid grid-cols-3 gap-3 mt-5">
          {[
            { label:"Score",    value:`${score}%`,            color },
            { label:"Previous", value:`${topic.mastery}%`,   color:"#78788c" },
            { label:"Change",   value: score >= topic.mastery ? `+${score - topic.mastery}%` : `${score - topic.mastery}%`, color: score > topic.mastery ? "#4aa87a" : "#cc5069" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl bg-muted border border-white/8">
              <div className="text-xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
              <div className="text-[10px] text-[#78788c] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="space-y-2">
        {!passed && (
          <button onClick={addToRevision} disabled={addingRevision}
            className="w-full py-3 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 text-sm font-bold flex items-center justify-center gap-2 hover:bg-violet-500/25 transition-all disabled:opacity-50">
            <RotateCcw className="w-4 h-4"/> {addingRevision ? "Adding…" : "Add to Revision Schedule"}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { ctx, ready: academicReady } = useAcademicContext();
  const { data, loading, error, reload } = useRecoveryZone(academicReady);

  // Decision Engine Slice 1 swap-in for the evidence-only branch of
  // mapRecoveryZoneToTopics (concepts with no open recovery_assignments
  // row yet) -- reuses the same weakAreasV2 flag already live for
  // Practice.tsx, RecoveryCompletionReportPage.tsx, and Analysis.tsx (one
  // rollout, not a per-consumer flag). Does NOT touch open_assignments --
  // that's product workflow state, not learning evidence, and stays
  // sourced from rpc_student_recovery_zone regardless of this flag.
  const [v2WeakAreas, setV2WeakAreas] = useState<WeakAreaRecommendation[] | null>(null);
  useEffect(() => {
    if (!DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2 || !ctx || !academicReady) return;
    let cancelled = false;
    DecisionEngineService.getWeakAreasV2(ctx)
      .then((recs) => {
        if (cancelled) return;
        setV2WeakAreas(recs);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[Recovery] getWeakAreasV2 failed:", e instanceof Error ? e.message : e);
        setV2WeakAreas([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady]);
  const weakConceptsSource: WeakConcept[] = useMemo(
    () =>
      DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2
        ? (v2WeakAreas ?? []).map((r) => ({
            subject: r.subject,
            chapter: r.chapter ?? undefined,
            concept: r.concept,
            subconcept: r.subconcept ?? undefined,
            // Adapter, not equivalence -- understanding and mastery_score
            // are both 0-100 "how well is this understood" scales, not the
            // same measurement (same note as every prior Weak Areas
            // migration this session).
            mastery_score: r.understanding ?? 0,
          }))
        : (data?.weak_concepts ?? []),
    [v2WeakAreas, data?.weak_concepts],
  );

  const [view, setView] = useState<RecoveryView>("overview");
  const [activeTopic, setActiveTopic] = useState<RecoveryTopic | null>(null);
  const [sessionScore, setSessionScore] = useState(0);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showHistory, setShowHistory] = useState(false);
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const fixHandledRef = useRef(false);

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

  const TOPICS = useMemo(
    () =>
      (data
        ? mapRecoveryZoneToTopics({ ...data, weak_concepts: weakConceptsSource })
        : []
      ).filter((t) => isSubjectAllowedForScope(t.subject, stream, classLevel)),
    [data, weakConceptsSource, stream, classLevel],
  );
  const TEACHER_TASKS: { id: string; title: string; teacher: string; due: string; qs: number; subject: string }[] = [];
  const AI_PLAN = useMemo(
    () =>
      TOPICS.filter((t) => t.priority === "high")
        .slice(0, 3)
        .map((t) => ({
          task: `Complete ${displayConcept(t.concept)} recovery (${t.pendingQs || 0} questions)`,
          subject: t.subject,
          time: t.pendingQs > 0 ? `${Math.max(10, t.pendingQs * 2)} min` : "—",
          priority: t.priority as Priority,
          topic: t,
        })),
    [TOPICS],
  );
  const HISTORY = useMemo(() => {
    return (data?.recent_completed ?? [])
      .filter(
        (h) =>
          !isPlaceholderAcademicLabel(h.subject) &&
          !isPlaceholderAcademicLabel(h.concept),
      )
      .map((h) => ({
        id: h.id,
        concept: h.concept,
        subject: h.subject,
        date: formatRelativeDate(h.date),
        score: h.score,
        improved: h.improved,
      }));
  }, [data?.recent_completed]);
  const sessionsDone = data?.completed_count ?? HISTORY.length;

  // Deep-link ?fix=1&subject=&chapter=&concept= (legacy RevisionQueue / analytics)
  useEffect(() => {
    if (!academicReady || !ctx || fixHandledRef.current || loading || !data) return;
    const fix = searchParams.get("fix");
    if (fix !== "1") return;
    fixHandledRef.current = true;
    const subject = searchParams.get("subject");
    const chapter = searchParams.get("chapter");
    const concept = searchParams.get("concept") || chapter || subject;
    if (
      !subject ||
      !concept ||
      isPlaceholderAcademicLabel(subject) ||
      isPlaceholderAcademicLabel(concept) ||
      isPlaceholderAcademicLabel(chapter)
    ) {
      setSearchParams({}, { replace: true });
      return;
    }
    (async () => {
      const existing = TOPICS.find(
        (t) =>
          t.subject.toLowerCase() === subject.toLowerCase() &&
          t.concept.toLowerCase() === concept.toLowerCase() &&
          t.assignmentId,
      );
      if (existing?.assignmentId) {
        setSearchParams({}, { replace: true });
        navigate(`/student/recovery/${existing.assignmentId}`);
        return;
      }
      const assignmentId = await assignRecoveryOnMistake({
        subject,
        chapter,
        concept,
        sourceType: "deep_link",
        sourceId: crypto.randomUUID(),
      });
      setSearchParams({}, { replace: true });
      if (assignmentId) navigate(`/student/recovery/${assignmentId}`);
      else navigate(`/student/practice?chapter=${encodeURIComponent(chapter || concept)}&subject=${encodeURIComponent(subject)}`);
    })();
  }, [academicReady, ctx, loading, data, TOPICS, searchParams, navigate, setSearchParams]);

  async function startSession(topic: RecoveryTopic) {
    if (!academicReady || !ctx) return;
    if (topic.assignmentId) {
      navigate(`/student/recovery/${topic.assignmentId}`);
      return;
    }
    setStartingId(topic.id);
    try {
      const assignmentId = await assignRecoveryOnMistake({
        subject: topic.subject,
        chapter: topic.chapter !== "—" ? topic.chapter : null,
        concept: topic.concept,
        sourceType: "weak_concept",
        sourceId: topic.id,
        accuracy: topic.mastery,
      });
      if (assignmentId) {
        navigate(`/student/recovery/${assignmentId}`);
        return;
      }
      // No bank questions for this concept — open practice for the chapter.
      navigate(
        `/student/practice?chapter=${encodeURIComponent(topic.chapter !== "—" ? topic.chapter : topic.concept)}&subject=${encodeURIComponent(topic.subject)}`,
      );
      void reload();
    } finally {
      setStartingId(null);
    }
  }

  function onSessionDone(score: number) {
    setSessionScore(score);
    setView("results");
  }
  void onSessionDone;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 text-rose-400 animate-spin"/>
      </div>
    );
  }

  if (!academicReady) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-sm text-[#78788c]">No student profile linked to this account.</p>
      </GlassCard>
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
    return <RecoverySession topic={activeTopic}
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
          { label:"Sessions Done",    value:sessionsDone,    color:"#4aa87a", icon:<CheckCircle2 className="w-4 h-4"/> },
        ].map(s => (
          <GlassCard key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-2" style={{color:s.color}}>{s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Recovery Plan (from live weak concepts — not an LLM call) */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-400"/>
          </div>
          <div>
            <div className="text-sm font-bold text-white">Recovery Plan</div>
            <div className="text-[11px] text-[#78788c]">Based on your highest-priority weak concepts from practice</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {AI_PLAN.length === 0 ? (
            <p className="text-xs text-[#78788c] col-span-full">No recovery plan yet — weak areas will appear here as you practice.</p>
          ) : (
            AI_PLAN.map((item, i) => {
            const m = PRIORITY_META[item.priority];
            return (
              <button
                key={i}
                type="button"
                onClick={() => startSession(item.topic)}
                disabled={startingId === item.topic.id}
                className="p-3 rounded-xl border bg-white/2 hover:bg-white/5 transition-all text-left group disabled:opacity-50"
                style={{borderColor:`${m.color}25`}}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black text-white"
                    style={{background:m.color}}>{i+1}</span>
                  <SubjectBadge subject={item.subject}/>
                </div>
                <p className="text-xs text-white font-semibold leading-snug mb-2">{item.task}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-[#78788c]">
                  <Clock className="w-3 h-3"/>{item.time}
                </div>
              </button>
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
          filtered.map(t => (
            <TopicCard key={t.id} topic={t} onStart={() => startSession(t)} starting={startingId === t.id}/>
          ))
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
                  <div className="text-sm font-semibold text-white">{displayConcept(h.concept)}</div>
                  <div className="text-[11px] text-[#78788c]">{h.subject} · {h.date}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-lg font-black tabular-nums" style={{color:h.improved?"#4aa87a":"#c08a3a"}}>{h.score}%</span>
                  <button
                    type="button"
                    title="Retry this concept"
                    onClick={() => {
                      const match = TOPICS.find(
                        (t) => t.concept === h.concept && t.subject === h.subject,
                      );
                      if (match) {
                        void startSession(match);
                        return;
                      }
                      void startSession({
                        id: `retry:${h.id}`,
                        concept: h.concept,
                        subject: h.subject,
                        chapter: "—",
                        priority: "medium",
                        mastery: 0,
                        attempts: 0,
                        source: "practice",
                        pendingQs: 0,
                        lastAttempt: h.date,
                        aiReason: `Retry recovery for ${displayConcept(h.concept)}.`,
                        teacherAssigned: false,
                      });
                    }}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#78788c] hover:text-white transition-all"
                  >
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
