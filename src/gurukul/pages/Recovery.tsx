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
import { urgencyBand, type Urgency } from "@/academic/metrics/bands";
import {
  RefreshCw, AlertCircle, ChevronRight, ChevronDown, CheckCircle2,
  Brain, BookOpen, Clock, Target, Search, Filter,
  RotateCcw, TrendingUp, History, Play, SkipForward,
} from "lucide-react";

type Priority = "high" | "medium" | "low";

interface RecoveryTopic {
  id: string; assignmentId?: string; concept: string; subject: string; chapter: string;
  // Renamed from `mastery`. §10.8: "the number stays … the word goes."
  // The screen already labelled this figure "Accuracy" where it renders it; the
  // field name was the last place the achievement word survived.
  priority: Priority; accuracyPct: number; attempts: number;
  source: string; pendingQs: number; lastAttempt: string;
  aiReason: string; teacherAssigned: boolean;
}

/**
 * `urgencyBand` has an `unknown` rung; a priority filter does not. An item
 * whose open-mistakes count is missing is placed at "low" rather than given a
 * rung of its own, because the alternative is a fourth chip in the filter bar
 * that nobody can act on.
 */
function urgencyToPriority(u: Urgency): Priority {
  return u === "unknown" ? "low" : u;
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
      accuracyPct: Math.round(weak?.mastery_score ?? 0),
      attempts: weak?.mistake_count ?? 0,
      source: sourceFromType(a.source_type),
      pendingQs: Math.max(0, (a.question_count ?? 0) - (a.questions_completed ?? 0)),
      lastAttempt: formatRelativeDate(a.created_at),
      aiReason: weak
        ? `Accuracy ${Math.round(weak.mastery_score)}% on ${displayConcept(a.concept)} — recovery drill queued from recent mistakes.`
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
      // RULINGS 1 AND 4 meet here. The queue was ordered by `mastery_score`
      // at 40 / 55 — the ladder ruling 1 deleted — and it is now ordered by
      // `urgencyBand` over the OPEN-MISTAKES COUNT, which is what a recovery
      // queue is actually sorted by: how much is left to fix, not how good the
      // student is. `unknown` sorts as "low" so a concept with no mistake count
      // cannot jump the queue on missing data.
      priority: urgencyToPriority(urgencyBand(w.mistake_count)),
      accuracyPct: Math.round(w.mastery_score),
      attempts: w.mistake_count ?? 0,
      source: "practice",
      pendingQs: 0,
      lastAttempt: "—",
      aiReason: `Weak concept detected at ${Math.round(w.mastery_score)}% accuracy — start practice or open Nova for a targeted review.`,
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
  if (s.includes("test") || s.includes("test") || s.includes("exam") || s.includes("marks")) return "tests";
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
            <div className="text-sm font-bold text-foreground">{displayConcept(topic.concept)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{displayChapter(topic.chapter)} · {SOURCE_LABELS[topic.source]} · {topic.lastAttempt}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-lg font-black tabular-nums" style={{color:m.color}}>{topic.accuracyPct}%</div>
              <div className="text-[10px] text-muted-foreground">{topic.attempts} mistakes</div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>Accuracy</span><span>{topic.accuracyPct}%</span>
          </div>
          <ProgressBar value={topic.accuracyPct} color={m.color} height="h-1.5"/>
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
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground bg-muted hover:bg-secondary transition-all">
            <Brain className="w-3 h-3 text-violet-400"/>
            Insight {expanded ? <ChevronDown className="w-3 h-3"/> : <ChevronRight className="w-3 h-3"/>}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-xs text-muted-foreground leading-relaxed space-y-2">
            <div className="flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-violet-400"/>
              <span className="text-violet-400 font-semibold text-[10px] uppercase tracking-wider">Recovery insight</span>
            </div>
            <p>{topic.aiReason}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/student/practice" className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold text-primary hover:bg-secondary">Practice</Link>
              <Link to="/student/revision" className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold text-warning hover:bg-secondary">Revision</Link>
              <Link to="/student/aicoach" className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold text-violet-500 hover:bg-secondary">Ask Nova</Link>
              <Link to="/student/mistakes" className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold text-rose-500 hover:bg-secondary">Mistake Book</Link>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default function Recovery(_: { setPage?: (p: PageKey) => void }) {
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
        accuracy: topic.accuracyPct,
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
        <p className="text-sm text-muted-foreground">No student profile linked to this account.</p>
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2"/>
        <p className="text-sm text-muted-foreground">Could not load recovery data</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </GlassCard>
    );
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
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">Learning Workflow</div>
          <h1 className="text-3xl font-black text-foreground" style={{fontFamily:"var(--font-display)"}}>Recovery</h1>
          <p className="text-muted-foreground text-sm mt-1">Targeted practice for topics where you need the most help.</p>
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
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
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
            <div className="text-sm font-bold text-foreground">Recovery Plan</div>
            <div className="text-[11px] text-muted-foreground">Based on your highest-priority weak concepts from practice</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {AI_PLAN.length === 0 ? (
            <p className="text-xs text-muted-foreground col-span-full">No recovery plan yet — weak areas will appear here as you practice.</p>
          ) : (
            AI_PLAN.map((item, i) => {
            const m = PRIORITY_META[item.priority];
            return (
              <button
                key={i}
                type="button"
                onClick={() => startSession(item.topic)}
                disabled={startingId === item.topic.id}
                className="p-3 rounded-xl border bg-muted/30 hover:bg-muted transition-all text-left group disabled:opacity-50"
                style={{borderColor:`${m.color}25`}}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black text-foreground"
                    style={{background:m.color}}>{i+1}</span>
                  <SubjectBadge subject={item.subject}/>
                </div>
                <p className="text-xs text-foreground font-semibold leading-snug mb-2">{item.task}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Teacher Assigned</span>
          </div>
          <div className="space-y-2">
            {TEACHER_TASKS.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/15 hover:bg-blue-500/10 transition-all cursor-pointer group">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <Target className="w-4 h-4 text-blue-400"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{t.teacher} · Due {t.due} · {t.qs} questions</div>
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search topics..."
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-muted border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-rose-500/40"/>
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground"/>
          {(["all","high","medium","low"] as const).map(p => (
            <button key={p} onClick={() => setPriority(p)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                priority === p ? "bg-rose-500/20 border border-rose-500/40 text-rose-500" : "bg-muted border border-border text-muted-foreground hover:bg-secondary")}>
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {(["all","practice","tests","battleground"] as const).map(src => (
            <button key={src} onClick={() => setSourceFilter(src)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                sourceFilter === src ? "bg-secondary border border-border text-foreground" : "bg-muted border border-border text-muted-foreground hover:bg-secondary")}>
              {src === "all" ? "All Sources" : SOURCE_LABELS[src]}
            </button>
          ))}
        </div>
      </div>

      {/* Topic list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{filtered.length} topic{filtered.length !== 1 ? "s" : ""} found</span>
          <span className="text-xs text-muted-foreground">Sorted by priority</span>
        </div>
        {filtered.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-2"/>
            <p className="text-muted-foreground text-sm">No topics match your filters</p>
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
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3 group">
          <History className="w-3.5 h-3.5 group-hover:text-foreground"/>
          Recovery History {showHistory ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
        </button>
        {showHistory && (
          <div className="space-y-2">
            {HISTORY.length === 0 ? (
              <GlassCard className="p-6 text-center">
                <p className="text-xs text-muted-foreground">No completed recovery sessions yet.</p>
              </GlassCard>
            ) : (
              HISTORY.map(h => (
              <GlassCard key={h.id} className="p-4 flex items-center gap-4">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                  h.improved ? "bg-emerald-400/10" : "bg-amber-400/10")}>
                  {h.improved ? <TrendingUp className="w-4 h-4 text-emerald-400"/> : <SkipForward className="w-4 h-4 text-amber-400"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{displayConcept(h.concept)}</div>
                  <div className="text-[11px] text-muted-foreground">{h.subject} · {h.date}</div>
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
                        accuracyPct: 0,
                        attempts: 0,
                        source: "practice",
                        pendingQs: 0,
                        lastAttempt: h.date,
                        aiReason: `Retry recovery for ${displayConcept(h.concept)}.`,
                        teacherAssigned: false,
                      });
                    }}
                    className="p-1.5 rounded-lg bg-muted hover:bg-secondary text-muted-foreground hover:text-foreground transition-all"
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
