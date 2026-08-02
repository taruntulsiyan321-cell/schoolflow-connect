import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { PageKey } from "@/gurukul/nav";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { displayChapter, displayConcept } from "@/lib/academicDisplay";
import { GlassCard, SubjectBadge, cn } from "@/gurukul/components/shared";
import {
  RotateCcw, Brain, CheckCircle2, XCircle, AlertCircle,
  ChevronRight, ChevronDown, Flame, History, Bookmark,
  Play, Layers, RefreshCw, Calendar,
  TrendingUp, Zap, FileText, BookOpen,
} from "lucide-react";

type RevView = "overview" | "flashcards" | "session" | "results";

interface RevItem {
  id: string; concept: string; subject: string; chapter: string;
  dueIn: string; priority: number; bookmarked: boolean;
  teacherAssigned: boolean; lastSeen: string; reviews: number;
  source: string; notes?: string;
}

interface Flashcard { front: string; back: string; subject: string; }

function dueLabelFromDate(dueDate: string): string {
  try {
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return "Now";
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff <= 7) return `${diff} days`;
    return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function mapRevisionQueue(
  queue: NonNullable<ReturnType<typeof useStudentAcademicSnapshot>["data"]>["revision_queue"],
): RevItem[] {
  if (!queue?.length) return [];
  return queue.map((r) => ({
    id: r.id,
    concept: r.topic ?? r.chapter ?? r.subject,
    subject: r.subject,
    chapter: r.chapter ?? "—",
    dueIn: dueLabelFromDate(r.due_date),
    priority: r.priority,
    bookmarked: false,
    teacherAssigned: false,
    lastSeen: "—",
    reviews: 0,
    source: "revision",
  }));
}

const FLASHCARDS: Flashcard[] = [];
const NOTES: { subject: string; title: string; content: string; updated: string }[] = [];
const HISTORY: { id: string; concept: string; subject: string; date: string; score: number; duration: string }[] = [];

function DueTag({ dueIn }: { dueIn: string }) {
  const cfg =
    dueIn === "Now" ? { color:"#cc5069", bg:"rgba(244,63,94,0.12)", label:"Now" } :
    dueIn === "Today" ? { color:"#c08a3a", bg:"rgba(245,158,11,0.12)", label:"Today" } :
    dueIn === "Tomorrow" ? { color:"#fb923c", bg:"rgba(251,146,60,0.12)", label:"Tomorrow" } :
    dueIn === "Done" ? { color:"#4aa87a", bg:"rgba(52,211,153,0.12)", label:"Done" } :
    { color:"#6882e8", bg:"rgba(167,139,250,0.12)", label:dueIn };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{color:cfg.color,background:cfg.bg}}>
      {cfg.label}
    </span>
  );
}

function RevItemCard({
  item, onRevise, onComplete, completing,
}: {
  item: RevItem;
  onRevise: () => void;
  onComplete: () => void;
  completing?: boolean;
}) {
  return (
    <GlassCard className="p-4 hover:border-white/15 transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <DueTag dueIn={item.dueIn}/>
            <SubjectBadge subject={item.subject}/>
            {item.teacherAssigned && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Teacher</span>
            )}
            {item.bookmarked && <Bookmark className="w-3.5 h-3.5 text-amber-400 fill-amber-400"/>}
          </div>
          <div className="text-sm font-bold text-white">{displayConcept(item.concept)}</div>
          <div className="text-[11px] text-[#78788c] mt-0.5">{displayChapter(item.chapter)}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={onRevise}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-500/30 transition-all">
          <Play className="w-3 h-3"/> Practice topic
        </button>
        <Link to="/student/aicoach"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-violet-300 text-xs font-semibold hover:bg-white/10 transition-all">
          <Brain className="w-3 h-3"/> Ask Nova
        </Link>
        <Link to="/student/recovery"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-all">
          <RefreshCw className="w-3 h-3"/> Recovery
        </Link>
        <button onClick={onComplete} disabled={completing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/20 transition-all disabled:opacity-50">
          <CheckCircle2 className="w-3 h-3"/> {completing ? "Saving…" : "Mark done"}
        </button>
      </div>
    </GlassCard>
  );
}

function FlashcardView({ cards, onDone }: { cards: Flashcard[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);

  if (cards.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <Layers className="w-8 h-8 text-[#78788c] mx-auto mb-3"/>
        <p className="text-sm font-semibold text-white mb-1">No flashcards yet</p>
        <p className="text-xs text-[#78788c] mb-4">Flashcards will appear here when available.</p>
        <button onClick={onDone}
          className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
          Back to Revision Hub
        </button>
      </GlassCard>
    );
  }

  const card = cards[idx];
  const isLast = idx === cards.length - 1;

  function respond(gotIt: boolean) {
    if (gotIt) setKnown(k => k + 1);
    if (isLast) { onDone(); return; }
    setIdx(i => i + 1);
    setFlipped(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-violet-400">Flashcard Review</div>
          <div className="text-sm font-bold text-white">{card.subject}</div>
        </div>
        <span className="text-xs text-[#78788c]">{idx + 1} / {cards.length}</span>
      </div>

      <div className="flex gap-1.5">
        {cards.map((_, i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-all", i < idx ? "bg-violet-400" : i === idx ? "bg-violet-400/50" : "bg-white/10")}/>
        ))}
      </div>

      {/* Card flip */}
      <div className="relative h-64 cursor-pointer" onClick={() => setFlipped(f => !f)} style={{perspective:"1200px"}}>
        <div className="relative w-full h-full transition-transform duration-500"
          style={{transformStyle:"preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)"}}>
          {/* Front */}
          <div className="absolute inset-0 rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-900/30 to-[#131316] flex flex-col items-center justify-center p-8"
            style={{backfaceVisibility:"hidden"}}>
            <div className="text-[10px] uppercase tracking-[0.15em] text-violet-400 mb-4">Question</div>
            <p className="text-lg font-bold text-white text-center leading-relaxed">{card.front}</p>
            <div className="mt-6 text-xs text-[#78788c] flex items-center gap-1.5">
              <RotateCcw className="w-3 h-3"/> Tap to reveal answer
            </div>
          </div>
          {/* Back */}
          <div className="absolute inset-0 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-900/20 to-[#131316] flex flex-col items-center justify-center p-8"
            style={{backfaceVisibility:"hidden", transform:"rotateY(180deg)"}}>
            <div className="text-[10px] uppercase tracking-[0.15em] text-emerald-400 mb-4">Answer</div>
            <p className="text-sm text-white text-center leading-relaxed whitespace-pre-line">{card.back}</p>
          </div>
        </div>
      </div>

      {flipped && (
        <div className="flex gap-3">
          <button onClick={() => respond(false)}
            className="flex-1 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm font-bold flex items-center justify-center gap-2 hover:bg-rose-500/25 transition-all">
            <XCircle className="w-4 h-4"/> Didn't know
          </button>
          <button onClick={() => respond(true)}
            className="flex-1 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm font-bold flex items-center justify-center gap-2 hover:bg-emerald-500/25 transition-all">
            <CheckCircle2 className="w-4 h-4"/> Got it!
          </button>
        </div>
      )}
      {!flipped && (
        <button onClick={() => setFlipped(true)}
          className="w-full py-3 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm font-bold transition-all hover:bg-violet-500/30">
          Reveal Answer
        </button>
      )}
    </div>
  );
}

function RevisionSession({ item, onBack }: { item: RevItem; onBack: () => void }) {
  const chapter = item.chapter !== "—" ? item.chapter : item.concept;
  return (
    <div className="space-y-5">
      <GlassCard className="p-8 text-center">
        <RotateCcw className="w-8 h-8 text-violet-400 mx-auto mb-3"/>
        <p className="text-sm font-semibold text-white mb-1">Revise {displayConcept(item.concept)}</p>
        <p className="text-xs text-[#78788c] mb-4">
          Revision uses live Practice, Recovery, or Nova — there is no separate question bank for this hub.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            to={`/student/practice?chapter=${encodeURIComponent(chapter)}`}
            className="px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm font-semibold hover:bg-violet-500/30 transition-all"
          >
            <BookOpen className="w-3.5 h-3.5 inline mr-1.5"/> Practice
          </Link>
          <Link
            to="/student/recovery"
            className="px-4 py-2 rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-300 text-sm font-semibold"
          >
            Recovery
          </Link>
          <Link
            to="/student/aicoach"
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-violet-300 text-sm font-semibold"
          >
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

function RevResults({ item, score, setPage, onBack }: { item: RevItem; score: number; setPage?: (p: PageKey) => void; onBack: () => void }) {
  const passed = score >= 70;
  const color = passed ? "#4aa87a" : "#c08a3a";
  const size = 110, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r, offset = c - (score / 100) * c;
  return (
    <div className="space-y-6">
      <GlassCard className="p-6 text-center">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[#78788c] mb-4">Revision Complete</div>
        <div className="flex justify-center mb-4">
          <div className="relative inline-flex" style={{width:size,height:size}}>
            <svg width={size} height={size} className="-rotate-90">
              <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
              <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{filter:`drop-shadow(0 0 10px ${color})`}}/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black" style={{color}}>{score}%</span>
            </div>
          </div>
        </div>
        <div className="text-lg font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>{displayConcept(item.concept)}</div>
        <p className="text-sm text-[#78788c]">{passed ? "Solid revision — this concept is strengthening." : "Need more practice. Consider a recovery session."}</p>
      </GlassCard>
      <div className="space-y-2">
        {!passed && (
          <button onClick={() => setPage?.("recovery")}
            className="w-full py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm font-bold flex items-center justify-center gap-2 hover:bg-rose-500/25 transition-all">
            <RefreshCw className="w-4 h-4"/> Add to Recovery
          </button>
        )}
        <button onClick={onBack}
          className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-[#78788c] text-sm font-semibold hover:bg-white/10 transition-all">
          Back to Revision Hub
        </button>
      </div>
    </div>
  );
}

export default function Revision({ setPage }: { setPage?: (p: PageKey) => void }) {
  const navigate = useNavigate();
  const { data: snapshot, loading, error, reload } = useStudentAcademicSnapshot();
  const [view, setView] = useState<RevView>("overview");
  const [activeItem, setActiveItem] = useState<RevItem | null>(null);
  const [score, setScore] = useState(0);
  const [filter, setFilter] = useState<"all"|"due"|"upcoming">("all");
  const [subjectTab, setSubjectTab] = useState("all");
  const [showHistory, setShowHistory] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const REVISION_ITEMS = useMemo(
    () => mapRevisionQueue(snapshot?.revision_queue),
    [snapshot?.revision_queue],
  );
  const AI_SCHEDULE = useMemo(
    () => [
      { time: "Now", items: REVISION_ITEMS.filter((r) => r.dueIn === "Now") },
      { time: "Later today", items: REVISION_ITEMS.filter((r) => r.dueIn === "Today") },
      { time: "Tomorrow", items: REVISION_ITEMS.filter((r) => r.dueIn === "Tomorrow") },
    ],
    [REVISION_ITEMS],
  );
  const streak = snapshot?.xp?.study_streak ?? 0;

  async function markComplete(item: RevItem) {
    setCompletingId(item.id);
    try {
      const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
      const ctx = await resolveStudentServiceContext();
      await PracticeService.completeRevision(ctx, item.id);
      await reload?.();
    } catch {
      /* toast via empty — stay on page */
    } finally {
      setCompletingId(null);
    }
  }

  function openPractice(item: RevItem) {
    const chapter = item.chapter !== "—" ? item.chapter : item.concept;
    navigate(`/student/practice?chapter=${encodeURIComponent(chapter)}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RotateCcw className="w-6 h-6 text-violet-400 animate-spin"/>
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertCircle className="w-8 h-8 text-violet-400 mx-auto mb-2"/>
        <p className="text-sm text-[#78788c]">Could not load revision queue</p>
        <p className="text-xs text-[#78788c] mt-1">{error}</p>
      </GlassCard>
    );
  }

  if (view === "flashcards") return <FlashcardView cards={FLASHCARDS} onDone={() => setView("overview")}/>;
  if (view === "session" && activeItem) {
    return (
      <RevisionSession
        item={activeItem}
        onBack={() => { setView("overview"); setActiveItem(null); }}
      />
    );
  }
  if (view === "results" && activeItem) {
    return (
      <RevResults
        item={activeItem}
        score={score}
        setPage={setPage}
        onBack={() => { setView("overview"); setActiveItem(null); }}
      />
    );
  }

  const subjects = ["all", ...Array.from(new Set(REVISION_ITEMS.map((r) => r.subject)))];
  const filtered = REVISION_ITEMS.filter(r => {
    const matchFilter =
      filter === "all" ? true :
      filter === "due" ? (r.dueIn === "Now" || r.dueIn === "Today") :
      filter === "upcoming" ? !(r.dueIn === "Now" || r.dueIn === "Today") :
      true;
    const matchSub = subjectTab === "all" || r.subject === subjectTab;
    return matchFilter && matchSub;
  });

  const dueNow = REVISION_ITEMS.filter(r => r.dueIn === "Now" || r.dueIn === "Today").length;
  const upcoming = REVISION_ITEMS.length - dueNow;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Learning Workflow</div>
          <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Revision</h1>
          <p className="text-[#78788c] text-sm mt-1">Spaced-repetition review to move concepts into long-term memory.</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Flame className="w-3.5 h-3.5 text-amber-400"/>
          <span className="text-xs font-bold text-amber-400">{streak > 0 ? `${streak}-day streak` : "No streak yet"}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Due Now",   value:dueNow,     color:"#cc5069", icon:<Zap className="w-4 h-4"/> },
          { label:"Upcoming",  value:upcoming,   color:"#c08a3a", icon:<Calendar className="w-4 h-4"/> },
          { label:"In Queue",  value:REVISION_ITEMS.length, color:"#6882e8", icon:<Layers className="w-4 h-4"/> },
        ].map(s => (
          <GlassCard key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-2" style={{color:s.color}}>{s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid sm:grid-cols-3 gap-3">
        <button onClick={() => setView("flashcards")}
          className="p-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all text-left group">
          <Layers className="w-5 h-5 text-cyan-400 mb-2 group-hover:scale-110 transition-transform"/>
          <div className="text-sm font-bold text-white">Flashcards</div>
          <div className="text-xs text-[#78788c] mt-0.5">{FLASHCARDS.length} cards ready</div>
        </button>
        <button onClick={() => {
          const due = REVISION_ITEMS.filter(r => r.dueIn === "Now" || r.dueIn === "Today")[0];
          if (due) openPractice(due);
        }}
          className="p-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 transition-all text-left group">
          <Zap className="w-5 h-5 text-violet-400 mb-2 group-hover:scale-110 transition-transform"/>
          <div className="text-sm font-bold text-white">Quick Revision</div>
          <div className="text-xs text-[#78788c] mt-0.5">
            {dueNow > 0 ? `Practice ${dueNow} due item${dueNow === 1 ? "" : "s"}` : "No items due"}
          </div>
        </button>
        <button onClick={() => setShowNotes(n => !n)}
          className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-all text-left group">
          <FileText className="w-5 h-5 text-amber-400 mb-2 group-hover:scale-110 transition-transform"/>
          <div className="text-sm font-bold text-white">My Notes</div>
          <div className="text-xs text-[#78788c] mt-0.5">{NOTES.length} subject summaries</div>
        </button>
      </div>

      {/* Notes panel */}
      {showNotes && (
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-amber-400"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Revision Notes</span>
          </div>
          <div className="space-y-3">
            {NOTES.length === 0 ? (
              <p className="text-xs text-[#78788c]">No revision notes yet.</p>
            ) : (
              NOTES.map((n, i) => (
              <div key={i} className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-white">{n.title}</span>
                  <span className="text-[10px] text-[#78788c]">Updated {n.updated}</span>
                </div>
                <p className="text-xs text-[#78788c] leading-relaxed">{n.content}</p>
              </div>
              ))
            )}
          </div>
        </GlassCard>
      )}

      {/* AI Schedule */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-400"/>
          </div>
          <div>
            <div className="text-sm font-bold text-white">AI Revision Schedule</div>
            <div className="text-[11px] text-[#78788c]">From your live revision queue</div>
          </div>
        </div>
        <div className="space-y-4">
          {AI_SCHEDULE.filter(s => s.items.length > 0).length === 0 ? (
            <p className="text-xs text-[#78788c]">No items due — your revision queue is empty.</p>
          ) : (
            AI_SCHEDULE.filter(s => s.items.length > 0).map(slot => (
            <div key={slot.time}>
              <div className="text-[10px] uppercase tracking-wider text-[#78788c] mb-2">{slot.time}</div>
              <div className="flex flex-wrap gap-2">
                {slot.items.map(item => (
                  <button key={item.id} onClick={() => openPractice(item)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-semibold hover:bg-violet-500/20 transition-all">
                    <RotateCcw className="w-3 h-3"/> {displayConcept(item.concept)}
                  </button>
                ))}
              </div>
            </div>
          ))
          )}
        </div>
      </GlassCard>

      {/* Filter tabs */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {(["all","due","upcoming"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all",
                filter === f ? "bg-violet-500/20 border border-violet-500/40 text-violet-300" : "bg-white/5 border border-white/10 text-[#78788c] hover:bg-white/10")}>
              {f === "due" ? "Due Today" : f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {subjects.map(s => (
            <button key={s} onClick={() => setSubjectTab(s)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                subjectTab === s ? "bg-white/15 border border-white/25 text-white" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <RotateCcw className="w-8 h-8 text-[#78788c] mx-auto mb-2"/>
              <p className="text-[#78788c] text-sm">No items match this filter</p>
            </GlassCard>
          ) : (
            filtered.map(item => (
              <RevItemCard key={item.id} item={item}
                onRevise={() => openPractice(item)}
                onComplete={() => markComplete(item)}
                completing={completingId === item.id}/>
            ))
          )}
        </div>
      </div>

      {/* Revision streak */}
      <GlassCard className="p-5 border-amber-500/15">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6 text-amber-400"/>
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-white mb-0.5">
              {streak > 0 ? `${streak}-day learning streak` : "Start your revision streak"}
            </div>
            <div className="text-xs text-[#78788c] mb-2">
              {streak > 0
                ? "From your XP profile — keep practicing and revising to maintain it."
                : "Revise items from your queue to build a streak."}
            </div>
            <div className="text-xs text-[#78788c]">
              Current streak: <span className="text-amber-300 font-bold tabular-nums">{streak}</span> day{streak === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* History */}
      <div>
        <button onClick={() => setShowHistory(h => !h)}
          className="flex items-center gap-2 text-xs text-[#78788c] hover:text-white transition-colors mb-3 group">
          <History className="w-3.5 h-3.5 group-hover:text-white"/>
          Revision History {showHistory ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
        </button>
        {showHistory && (
          <div className="space-y-2">
            {HISTORY.length === 0 ? (
              <GlassCard className="p-6 text-center">
                <p className="text-xs text-[#78788c]">No revision history yet.</p>
              </GlassCard>
            ) : (
              HISTORY.map(h => (
              <GlassCard key={h.id} className="p-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 text-violet-400"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{displayConcept(h.concept)}</div>
                  <div className="text-[11px] text-[#78788c]">{h.subject} · {h.date} · {h.duration}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-lg font-black tabular-nums text-violet-400">{h.score}%</span>
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
