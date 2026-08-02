import { useState, useEffect, useRef } from "react";
import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, PracticeService, HomeworkService, type CurriculumScope } from "@/academic";
import type { StudentHomeworkRow } from "@/academic/services/homeworkService";
import { attemptsToFinishPayload } from "@/lib/practiceSessionSnapshot";
import type { PracticeAttemptSnapshot } from "@/lib/practiceSessionSnapshot";
import { toast } from "sonner";
import { displayChapter, displaySubject, presentAcademicLabel } from "@/lib/academicPresentation";
import type { AcademicTermRef } from "@/academic/services/practiceService";
import { GlassCard, ProgressBar, SubjectBadge, DifficultyBadge, cn } from "@/gurukul/components/shared";
import {
  BookOpen, Clock, Target, ClipboardList,
  Trophy, BarChart2, Search,
  ChevronRight, CheckCircle2, XCircle, ArrowLeft, Play, SkipForward,
  Flame, Layers, History,
  Save, Bookmark, Timer, BookMarked, Lightbulb,
  RotateCcw, HelpCircle, TrendingDown, FileText, AlertCircle,
} from "lucide-react";

const CLASS_UNRESOLVED_MSG =
  "We couldn't determine your class. Ask your school admin to assign you to a class (e.g. 10-A, 11-B, or 12-C) so practice can show subjects for your class level only.";

// ── Types ────────────────────────────────────────────────────────────────────
type Phase   = "hub" | "config" | "session" | "feedback" | "summary";
type Cat     = "all" | "content" | "source" | "type" | "targeted";
type ModeKey =
  | "daily" | "subject" | "chapter" | "topic"
  | "teacher" | "pyq" | "timed" | "untimed"
  | "difficulty" | "weak" | "incorrect" | "skipped"
  | "bookmarked" | "mock";

interface Mode {
  key: ModeKey; label: string; desc: string;
  icon: React.ReactNode; color: string; cat: Cat;
  badge: string; instant?: boolean; hot?: boolean;
}

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "#3b5bdb",
  Math: "#3b5bdb",
  Accountancy: "#4aa87a",
  "Business Studies": "#c08a3a",
  Economics: "#6882e8",
  Physics: "#4b9fd4",
  Chemistry: "#6882e8",
  Biology: "#4aa87a",
  English: "#c08a3a",
  Hindi: "#cc5069",
  Science: "#4b9fd4",
  "Social Science": "#c08a3a",
};
const FALLBACK_COLORS = ["#3b5bdb", "#4b9fd4", "#6882e8", "#4aa87a", "#c08a3a"];

function subjectColor(name: string, index: number) {
  return SUBJECT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

type BankQuestion = {
  id: string;
  subject: string; chapter: string; difficulty: string;
  question: string; options: string[]; correct: number; explanation?: string;
};

function parseBankOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* ignore */ }
  }
  return [];
}

type PracticeSubject = {
  id: string; name: string; color: string;
};

type HistoryRow = {
  id: string; date: string; mode: string; subject: string;
  qs: number; attempted: number; score: number; pct: number; time: string; status: string;
};

function formatSessionDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function formatDuration(startIso: string, endIso: string) {
  const mins = Math.max(1, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

// ── Static data ──────────────────────────────────────────────────────────────
const MODES: Mode[] = [
  { key:"daily",      label:"Daily Practice",         desc:"A fresh practice set drawn from your class question bank",
    icon:<Flame className="w-5 h-5"/>,      color:"#c08a3a", cat:"source",   badge:"Daily", instant:true, hot:true },
  { key:"subject",    label:"Subject Practice",       desc:"Practice questions from a subject of your choice",
    icon:<BookOpen className="w-5 h-5"/>,   color:"#3b5bdb", cat:"content",  badge:"Subject" },
  { key:"chapter",    label:"Chapter Practice",       desc:"Focus on a specific chapter to reinforce concepts",
    icon:<Layers className="w-5 h-5"/>,     color:"#4b9fd4", cat:"content",  badge:"Chapter" },
  { key:"topic",      label:"Topic Practice",         desc:"Drill down to a precise concept or sub-topic",
    icon:<Target className="w-5 h-5"/>,     color:"#6882e8", cat:"content",  badge:"Topic" },
  { key:"teacher",    label:"Teacher Assigned",       desc:"Practice sets assigned by your teachers with due dates",
    icon:<ClipboardList className="w-5 h-5"/>, color:"#c08a3a", cat:"source", badge:"Assigned" },
  { key:"pyq",        label:"Previous Year Questions",desc:"Board and competitive exam questions from past years",
    icon:<FileText className="w-5 h-5"/>,   color:"#cc5069", cat:"source",  badge:"Past papers" },
  { key:"timed",      label:"Timed Practice",         desc:"Solve questions against the clock — choose your time limit",
    icon:<Timer className="w-5 h-5"/>,      color:"#cc5069", cat:"type",    badge:"Speed mode" },
  { key:"untimed",    label:"Untimed Practice",       desc:"No time pressure — focus on understanding, not speed",
    icon:<BookOpen className="w-5 h-5"/>,   color:"#4aa87a", cat:"type",    badge:"Relaxed mode" },
  { key:"mock",       label:"Mock Tests",             desc:"Full-length exam simulation under real test conditions",
    icon:<Trophy className="w-5 h-5"/>,     color:"#c08a3a", cat:"type",    badge:"Mock test" },
  { key:"difficulty", label:"Difficulty-Based",       desc:"Subject → chapter → difficulty — real bank questions at your level",
    icon:<BarChart2 className="w-5 h-5"/>,  color:"#6882e8", cat:"type",    badge:"Pick level" },
  { key:"weak",       label:"Weak Areas Practice",    desc:"Auto-generated from topics where your accuracy is below 70%",
    icon:<TrendingDown className="w-5 h-5"/>, color:"#cc5069", cat:"targeted", badge:"Weak areas", instant:true, hot:true },
  { key:"incorrect",  label:"Incorrect Questions",    desc:"Reattempt questions you got wrong in previous sessions",
    icon:<XCircle className="w-5 h-5"/>,    color:"#cc5069", cat:"targeted", badge:"Retry wrong", instant:true },
  { key:"skipped",    label:"Skipped Questions",      desc:"Solve questions you chose to skip earlier",
    icon:<SkipForward className="w-5 h-5"/>, color:"#c08a3a", cat:"targeted", badge:"Skipped", instant:true },
  { key:"bookmarked", label:"Bookmarked Questions",   desc:"Opens Mistake Book for mistakes you saved for review",
    icon:<BookMarked className="w-5 h-5"/>, color:"#4b9fd4", cat:"targeted", badge:"Mistake Book" },
];

const CATS: { key: Cat; label: string }[] = [
  { key:"all",      label:"All Modes" },
  { key:"content",  label:"By Content" },
  { key:"source",   label:"By Source" },
  { key:"type",     label:"By Type" },
  { key:"targeted", label:"Targeted" },
];

const SAVED: { id: number; label: string; config: string; lastUsed: string }[] = [];
const MOCK_TESTS: { id: number; title: string; qs: number; dur: string; subject: string }[] = [];

const DIFFICULTIES = [
  { key:"easy",   label:"Easy",   color:"#4aa87a", desc:"Foundation level — build confidence" },
  { key:"medium", label:"Medium", color:"#c08a3a", desc:"Board exam level — solid preparation" },
  { key:"hard",   label:"Hard",   color:"#cc5069", desc:"Competitive level — push your limits" },
  { key:"mixed",  label:"Mixed",  color:"#6882e8", desc:"Varied — best for overall practice" },
];

// ── Shared components ────────────────────────────────────────────────────────
function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color, background:`${color}15`, border:`1px solid ${color}25` }}>
      {children}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label:string; color:string }> = {
    completed:    { label:"Completed",   color:"#4aa87a" },
    incomplete:   { label:"Incomplete",  color:"#c08a3a" },
    "in-progress":{ label:"In Progress", color:"#4b9fd4" },
    "not-started":{ label:"Not Started", color:"#78788c" },
  };
  const s = map[status] ?? { label:status, color:"#78788c" };
  return <Tag color={s.color}>{s.label}</Tag>;
}

// ── Hub view ─────────────────────────────────────────────────────────────────
function Hub({ onMode, history, streak }: { onMode: (key: ModeKey) => void; history: HistoryRow[]; streak: number }) {
  const [cat,    setCat]    = useState<Cat>("all");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const visible = MODES.filter(m =>
    (cat === "all" || m.cat === cat) &&
    (search === "" || m.label.toLowerCase().includes(search.toLowerCase()))
  );

  const hot = MODES.filter(m => m.hot || m.instant).slice(0, 4);

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Wisdom Campus</div>
          <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>
            Practice
          </h1>
          <p className="text-[#78788c] text-sm mt-1">
            {MODES.length} practice modes · Pick how you want to learn today
          </p>
        </div>
        {streak > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-amber-400/20 bg-amber-400/8">
          <Flame className="w-4 h-4 text-amber-400"/>
          <span className="text-sm font-black text-amber-400">{streak}-day streak</span>
          <span className="text-[11px] text-amber-400/60">· Keep it up!</span>
        </div>
        )}
      </div>

      {/* ── Quick Start ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 rounded-full bg-[#3b5bdb]"/>
          <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Quick Start</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {hot.map(m => (
            <button key={m.key} onClick={() => onMode(m.key)}
              className="group text-left p-4 rounded-2xl border transition-all duration-200 hover:scale-[1.02] hover:border-white/20"
              style={{ borderColor:`${m.color}30`, background:`${m.color}08` }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{ background:`${m.color}15`, color:m.color }}>
                  {m.icon}
                </div>
                {m.hot && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#c08a3a]/15 text-amber-400 border border-amber-400/20">HOT</span>}
              </div>
              <div className="text-sm font-black text-white mb-0.5">{m.label}</div>
              <div className="text-[11px] text-[#78788c] leading-snug">{m.badge}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── All Modes ── */}
      <div>
        {/* Search + filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#78788c]"/>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search practice modes…"
              className="w-full bg-[#131316] border border-white/7 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#78788c] outline-none focus:border-[#3b5bdb]/40 transition-colors"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {CATS.map(c => (
              <button key={c.key} onClick={() => setCat(c.key)}
                className={cn(
                  "shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all",
                  cat === c.key ? "bg-[#3b5bdb] text-white shadow-lg shadow-blue-500/20" : "border border-white/7 text-[#78788c] hover:text-white hover:border-white/20"
                )}>{c.label}</button>
            ))}
          </div>
        </div>

        {/* Mode grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(m => (
            <button key={m.key} onClick={() => onMode(m.key)}
              className="group text-left p-5 rounded-2xl border border-white/7 bg-[#131316]/80 hover:border-white/18 hover:bg-[#131316] transition-all duration-200 flex gap-4">
              {/* Left color stripe + icon */}
              <div className="flex flex-col items-center gap-3 shrink-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{ background:`${m.color}15`, color:m.color }}>
                  {m.icon}
                </div>
                <div className="w-0.5 flex-1 rounded-full opacity-20" style={{ background:m.color }}/>
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0 py-0.5">
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-sm font-black text-white leading-tight">{m.label}</span>
                  {m.instant && (
                    <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5"
                      style={{ color:m.color, background:`${m.color}15`, border:`1px solid ${m.color}20` }}>
                      INSTANT
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#78788c] leading-relaxed mb-3">{m.desc}</div>
                <div className="flex items-center justify-between">
                  <Tag color={m.color}>{m.badge}</Tag>
                  <div className="flex items-center gap-1 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color:m.color }}>
                    Start <ChevronRight className="w-3 h-3"/>
                  </div>
                </div>
              </div>
            </button>
          ))}

          {visible.length === 0 && (
            <div className="col-span-full py-16 text-center">
              <HelpCircle className="w-8 h-8 text-[#78788c] mx-auto mb-3"/>
              <div className="text-sm text-[#78788c]">No modes match your search</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row: Saved + History ── */}
      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-4">
        {/* Saved sessions */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-[#4b9fd4]"/>
              <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Saved Sessions</span>
            </div>
            <button className="flex items-center gap-1 text-[10px] text-[#3b5bdb] hover:text-blue-300 transition-colors">
              <Save className="w-3 h-3"/> Save current
            </button>
          </div>
          <div className="space-y-2.5">
            {SAVED.map(s => (
              <div key={s.id} className="group flex items-start gap-3 p-3 rounded-xl border border-white/5 hover:border-white/12 hover:bg-white/3 transition-all cursor-pointer">
                <div className="w-8 h-8 rounded-lg bg-[#4b9fd4]/10 flex items-center justify-center shrink-0 text-[#4b9fd4]">
                  <Save className="w-3.5 h-3.5"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{s.label}</div>
                  <div className="text-[10px] text-[#78788c] truncate mt-0.5">{s.config}</div>
                  <div className="text-[10px] text-[#78788c]/60 mt-0.5">Used {s.lastUsed}</div>
                </div>
                <Play className="w-3.5 h-3.5 text-[#78788c] group-hover:text-[#4b9fd4] transition-colors shrink-0 mt-1"/>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Practice History */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#6882e8]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Practice History</span>
          </div>
          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#78788c]">No practice history yet</div>
            ) : history.map(h => (
              <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-all">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background:`${h.pct>=75?"#4aa87a":h.pct>=55?"#c08a3a":"#cc5069"}15`, color:h.pct>=75?"#4aa87a":h.pct>=55?"#c08a3a":"#cc5069" }}>
                  <span className="text-xs font-black">{h.pct}%</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-white truncate">{h.mode}</span>
                    <StatusTag status={h.status}/>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[#78788c]">{h.subject}</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#78788c]">{h.attempted}/{h.qs} Qs</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#78788c]">{h.time}</span>
                  </div>
                </div>
                <div className="text-[10px] text-[#78788c] shrink-0 text-right hidden sm:block">{h.date}</div>
                {h.status === "incomplete" && (
                  <button className="shrink-0 text-[10px] font-bold text-[#c08a3a] bg-amber-400/10 border border-amber-400/20 px-2 py-1 rounded-lg hover:bg-amber-400/20 transition-colors">
                    Resume
                  </button>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ── Config views ─────────────────────────────────────────────────────────────
function ConfigView({
  modeKey, onStart, onBack, subjects, onNavigate, classUnresolved,
}: {
  modeKey: ModeKey;
  onStart: (cfg: SessionConfig) => void;
  onBack: () => void;
  subjects: PracticeSubject[];
  onNavigate?: (page: PageKey) => void;
  classUnresolved?: boolean;
}) {
  const mode = MODES.find(m => m.key === modeKey)!;
  const { ctx, ready: academicReady, studentId } = useAcademicContext();

  const [selSubject,    setSelSubject]    = useState<string | null>(null);
  const [selChapter,    setSelChapter]    = useState<string | null>(null);
  const [selTopic,      setSelTopic]      = useState<string | null>(null);
  const [selDifficulty, setSelDifficulty] = useState<string>("mixed");
  const [qCount,        setQCount]        = useState(20);
  const [timeLimitMin,  setTimeLimitMin]  = useState(15);
  const [chapters,      setChapters]      = useState<AcademicTermRef[]>([]);
  const [topics,        setTopics]        = useState<AcademicTermRef[]>([]);
  const [metaLoading,   setMetaLoading]   = useState(false);
  const [teacherSets,   setTeacherSets]   = useState<StudentHomeworkRow[]>([]);
  const [teacherLoading, setTeacherLoading] = useState(false);

  useEffect(() => {
    setSelChapter(null);
    setSelTopic(null);
    setChapters([]);
    setTopics([]);
    if (!selSubject || !ctx || !academicReady) return;
    if (!["chapter", "topic", "difficulty"].includes(modeKey)) return;
    let cancelled = false;
    (async () => {
      setMetaLoading(true);
      try {
        const ch = await PracticeService.listBankChapters(ctx, { subject: selSubject });
        if (!cancelled) setChapters(ch);
      } catch {
        if (!cancelled) setChapters([]);
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selSubject, ctx, academicReady, modeKey]);

  useEffect(() => {
    if (modeKey !== "teacher" || !ctx || !academicReady || !studentId) {
      setTeacherSets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setTeacherLoading(true);
      try {
        const rows = await HomeworkService.listForStudent(ctx, studentId);
        if (!cancelled) setTeacherSets(rows);
      } catch {
        if (!cancelled) setTeacherSets([]);
      } finally {
        if (!cancelled) setTeacherLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modeKey, ctx, academicReady, studentId]);

  useEffect(() => {
    setSelTopic(null);
    setTopics([]);
    if (!selSubject || !ctx || !academicReady) return;
    if (!["topic", "difficulty"].includes(modeKey)) return;
    let cancelled = false;
    (async () => {
      try {
        const tp = await PracticeService.listBankTopics(ctx, {
          subject: selSubject,
          chapter: selChapter,
        });
        if (!cancelled) setTopics(tp);
      } catch {
        if (!cancelled) setTopics([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selSubject, selChapter, ctx, academicReady, modeKey]);

  function handleStart() {
    onStart({
      mode: modeKey,
      label: mode.label,
      subject: selSubject ?? "Mixed",
      chapter: selChapter,
      topic: selTopic,
      difficulty: selDifficulty,
      qCount,
      timeLimitSec: modeKey === "timed" || modeKey === "mock" ? timeLimitMin * 60 : null,
    });
  }

  const subjectEmptyMsg = classUnresolved
    ? CLASS_UNRESOLVED_MSG
    : "No subjects in the question bank yet for your class and board.";

  if (modeKey === "teacher") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        {teacherLoading ? (
          <p className="text-sm text-[#78788c] py-8 text-center">Loading teacher assignments…</p>
        ) : teacherSets.length === 0 ? (
          <EmptyConfig
            title="No teacher assignments yet"
            body="When your teacher assigns homework or practice, it will appear here."
            actionLabel="Open Homework"
            onAction={() => onNavigate?.("assignments")}
          />
        ) : (
          <>
            <div className="space-y-3">
              {teacherSets.map((row) => {
                const hw = row.homework;
                const subj = subjects.find(s => s.name === hw.subject);
                return (
                  <button
                    key={hw.id}
                    type="button"
                    onClick={() => onNavigate?.("assignments")}
                    className="w-full text-left p-4 rounded-2xl border border-white/7 hover:border-white/15 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">{hw.title}</div>
                        <div className="text-[11px] text-[#78788c] mt-1">
                          {hw.dueDate ? `Due ${new Date(hw.dueDate).toLocaleDateString()}` : "No due date"}
                          {" · "}{row.displayStatus}
                        </div>
                      </div>
                      <StatusTag status={row.displayStatus === "graded" || row.displayStatus === "submitted" ? "completed" : row.displayStatus === "in_progress" ? "in-progress" : "not-started"} />
                    </div>
                    {subj && <div className="mt-2"><SubjectBadge subject={hw.subject} color={subj.color}/></div>}
                  </button>
                );
              })}
            </div>
            <StartButton color={mode.color} label="Open in Homework" onStart={() => onNavigate?.("assignments")}/>
          </>
        )}
      </ConfigShell>
    );
  }

  if (modeKey === "mock") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        {MOCK_TESTS.length === 0 ? (
          <EmptyConfig
            title="No mock tests available"
            body="Full-length mocks will show here once your school publishes them. Try Timed Practice for a timed bank session."
          />
        ) : (
          <StartButton color={mode.color} disabled onStart={handleStart} label="Start Mock Test"/>
        )}
      </ConfigShell>
    );
  }

  if (modeKey === "difficulty") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="1. Subject"/>
          {selSubject && (
            <OptionChips
              label={metaLoading ? "Loading chapters…" : "2. Chapter"}
              options={chapters}
              selected={selChapter}
              onSelect={setSelChapter}
              empty="No chapters in the bank for this subject yet."
            />
          )}
          {selSubject && selChapter && topics.length > 0 && (
            <OptionChips
              label="3. Topic / concept (optional)"
              options={topics}
              selected={selTopic}
              onSelect={setSelTopic}
              allowClear
              empty="No topics tagged for this chapter yet."
            />
          )}
          {selSubject && selChapter && (
            <div>
              <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">
                {topics.length > 0 ? "4. Difficulty" : "3. Difficulty"}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {DIFFICULTIES.map(d => (
                  <button key={d.key} type="button" onClick={() => setSelDifficulty(d.key)}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all",
                      selDifficulty === d.key ? "scale-[1.02]" : "border-white/7 hover:border-white/15"
                    )}
                    style={selDifficulty === d.key ? { borderColor:`${d.color}40`, background:`${d.color}10` } : {}}>
                    <div className="text-sm font-black mb-1" style={{ color:selDifficulty===d.key?d.color:"white" }}>{d.label}</div>
                    <div className="text-[11px] text-[#78788c]">{d.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} disabled={!selSubject || !selChapter} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "timed") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll label="Subject (optional)"/>
          <div>
            <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">Time Limit</div>
            <div className="flex gap-2 flex-wrap">
              {[5, 10, 15, 20, 30, 45, 60].map(t => (
                <button key={t} onClick={() => setTimeLimitMin(t)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                    timeLimitMin === t ? "bg-[#cc5069] text-white shadow-lg" : "border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
                  )}>
                  {t < 60 ? `${t}m` : "1h"}
                </button>
              ))}
            </div>
          </div>
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "subject") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="Choose subject"/>
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} disabled={!selSubject} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "chapter") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="1. Subject"/>
          {selSubject && (
            <OptionChips
              label={metaLoading ? "Loading chapters…" : "2. Chapter"}
              options={chapters}
              selected={selChapter}
              onSelect={setSelChapter}
              empty="No chapters in the bank for this subject yet."
            />
          )}
          {selChapter && (
            <div>
              <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">Difficulty</div>
              <div className="flex gap-2 flex-wrap">
                {DIFFICULTIES.map(d => (
                  <button key={d.key} onClick={() => setSelDifficulty(d.key)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all",
                      selDifficulty === d.key ? "text-white shadow-lg" : "border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
                    )}
                    style={selDifficulty === d.key ? { background:d.color } : {}}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} disabled={!selSubject || !selChapter} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "topic") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="1. Subject"/>
          {selSubject && (
            <OptionChips
              label="2. Chapter (optional)"
              options={chapters}
              selected={selChapter}
              onSelect={setSelChapter}
              allowClear
              empty="No chapters yet — pick a topic below if available."
            />
          )}
          {selSubject && (
            <OptionChips
              label="3. Topic / concept"
              options={topics}
              selected={selTopic}
              onSelect={setSelTopic}
              empty="No topics tagged in the bank for this selection yet."
            />
          )}
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} disabled={!selSubject || !selTopic} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "pyq") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <p className="text-xs text-[#78788c]">Loads past-paper / exam-year tagged questions from the bank when available.</p>
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll label="Subject"/>
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "untimed") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <p className="text-xs text-[#78788c]">No countdown — focus on understanding.</p>
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll label="Subject"/>
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton color={mode.color} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  return (
    <ConfigShell mode={mode} onBack={onBack}>
      <div className="space-y-6">
        <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll/>
        <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
      </div>
      <StartButton color={mode.color} onStart={handleStart}/>
    </ConfigShell>
  );
}

function EmptyConfig({
  title, body, actionLabel, onAction,
}: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="py-8 text-center space-y-3">
      <HelpCircle className="w-8 h-8 text-[#78788c] mx-auto"/>
      <div className="text-sm font-bold text-white">{title}</div>
      <p className="text-xs text-[#78788c] leading-relaxed max-w-sm mx-auto">{body}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#3b5bdb] hover:text-blue-300">
          {actionLabel} <ChevronRight className="w-3 h-3"/>
        </button>
      )}
    </div>
  );
}

function OptionChips({
  label, options, selected, onSelect, empty, allowClear,
}: {
  label: string;
  options: AcademicTermRef[];
  selected: string | null;
  onSelect: (v: string | null) => void;
  empty?: string;
  allowClear?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">{label}</div>
      {options.length === 0 ? (
        <p className="text-xs text-[#78788c]">{empty ?? "Nothing available yet."}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowClear && (
            <button type="button" onClick={() => onSelect(null)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all",
                selected === null ? "bg-[#3b5bdb] text-white shadow-lg" : "border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
              )}>Any</button>
          )}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all max-w-full truncate",
                selected === opt.id ? "bg-[#3b5bdb] text-white shadow-lg" : "border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
              )}
              title={opt.displayName}
            >
              {opt.displayName || presentAcademicLabel(opt.id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Config shell wrapper
function ConfigShell({ mode, onBack, children }: {
  mode: Mode; onBack: ()=>void; children: React.ReactNode;
}) {
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-[#78788c] hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4"/> Back to Practice
      </button>

      <GlassCard className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background:`${mode.color}18`, color:mode.color }}>
            {mode.icon}
          </div>
          <div>
            <h2 className="text-xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>{mode.label}</h2>
            <p className="text-sm text-[#78788c] mt-0.5">{mode.desc}</p>
          </div>
        </div>
        {children}
      </GlassCard>
    </div>
  );
}

// Subject picker
function SubjectPicker({
  selected, onSelect, subjects, allowAll = true, label = "Subject", emptyMessage,
}: {
  selected: string | null;
  onSelect: (s: string | null) => void;
  subjects: PracticeSubject[];
  allowAll?: boolean;
  label?: string;
  emptyMessage?: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">{label}</div>
      {subjects.length === 0 ? (
        <p className="text-xs text-[#78788c]">
          {emptyMessage ?? "No subjects in the question bank yet for your class and board."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowAll && (
            <button type="button" onClick={() => onSelect(null)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all",
                selected === null ? "bg-[#3b5bdb] text-white shadow-lg shadow-blue-500/20" : "border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
              )}>All</button>
          )}
          {subjects.map(s => (
            <button key={s.id} type="button" onClick={() => onSelect(s.name)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all",
                selected === s.name ? "text-white shadow-lg" : "border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
              )}
              style={selected===s.name ? { background:s.color, boxShadow:`0 4px 14px ${s.color}40` } : {}}>
              {displaySubject(s.name) || s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Question count slider
function CountSlider({ value, onChange, color }: { value:number; onChange:(v:number)=>void; color:string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider">Number of Questions</div>
        <span className="text-sm font-black tabular-nums" style={{color}}>{value}</span>
      </div>
      <input type="range" min={5} max={90} step={5} value={value} onChange={e => onChange(+e.target.value)}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: color }}/>
      <div className="flex justify-between text-[10px] text-[#78788c] mt-1"><span>5</span><span>90</span></div>
    </div>
  );
}

// Start button
function StartButton({ color, disabled=false, onStart, label="Start Practice" }: {
  color:string; disabled?:boolean; onStart:()=>void; label?:string;
}) {
  return (
    <button onClick={onStart} disabled={disabled}
      className={cn(
        "w-full mt-6 py-3.5 rounded-2xl font-black text-sm text-white flex items-center justify-center gap-2 transition-all",
        disabled ? "opacity-30 cursor-not-allowed bg-white/10" : "hover:opacity-90 hover:scale-[1.02] active:scale-[0.99]"
      )}
      style={disabled ? {} : { background:`linear-gradient(135deg,${color},${color}cc)`, boxShadow:`0 8px 24px ${color}30` }}>
      <Play className="w-4 h-4"/> {label}
    </button>
  );
}

// ── Session types ─────────────────────────────────────────────────────────────
interface SessionConfig {
  mode: ModeKey; label: string; subject: string;
  chapter?: string | null; topic?: string | null;
  difficulty: string; qCount: number; timeLimitSec: number | null;
}

// ── Session (question-solving) ───────────────────────────────────────────────
function Session({
  config, onFinish, onBack, subjects, classUnresolved,
}: { config: SessionConfig; onFinish: (results: SessionResults) => void; onBack: () => void; subjects: PracticeSubject[]; classUnresolved?: boolean }) {
  const { ctx, ready: academicReady } = useAcademicContext();
  const [qs, setQs] = useState<BankQuestion[]>([]);
  const [loadingQs, setLoadingQs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [idx,       setIdx]       = useState(0);
  const [chosen,    setChosen]    = useState<number | null>(null);
  const [phase,     setPhase]     = useState<"q" | "fb">("q");
  const [correct,   setCorrect]   = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [bookmarked,setBookmarked]= useState<number[]>([]);
  const [skipped,   setSkipped]   = useState<number[]>([]);
  const [timeLeft,  setTimeLeft]  = useState(config.timeLimitSec ?? 0);
  const [finishing, setFinishing] = useState(false);
  const [hintRevealed, setHintRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const correctRef = useRef(0);
  const attemptedRef = useRef(0);
  const skippedRef = useRef<number[]>([]);
  const bookmarkedRef = useRef<number[]>([]);
  const attemptLog = useRef<PracticeAttemptSnapshot[]>([]);
  const finishedRef = useRef(false);
  const questionStartRef = useRef<number>(Date.now());
  const attemptNumberRef = useRef(0);
  const hintUsedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingQs(true);
      setLoadError(null);
      try {
        if (!ctx || !academicReady) {
          setLoadError("Academic context not ready. Try again in a moment.");
          return;
        }

        const chapterForStart =
          config.chapter ||
          config.topic ||
          (config.mode === "daily" ? "Daily" : config.mode);

        const sid = await PracticeService.start(ctx, {
          _subject: config.subject === "Mixed" ? "General" : config.subject,
          _chapter: chapterForStart,
          _count: config.qCount,
          _practice_mode: config.mode,
        });
        if (cancelled) return;
        sessionIdRef.current = sid as string;
        questionStartRef.current = Date.now();
        attemptNumberRef.current = 0;

        let rows: Awaited<ReturnType<typeof PracticeService.listBankQuestions>> = [];

        if (config.mode === "incorrect") {
          rows = await PracticeService.listMistakeQuestions(ctx, { limit: config.qCount });
        } else if (config.mode === "skipped") {
          rows = await PracticeService.listSkippedBankQuestions(ctx, { limit: config.qCount });
        } else if (config.mode === "weak") {
          const weak = await PracticeService.listWeakConcepts(ctx, { threshold: 70, limit: 12 });
          if (weak.length === 0) {
            rows = [];
          } else {
            rows = await PracticeService.listBankQuestions(ctx, {
              difficulty: config.difficulty,
              limit: config.qCount,
              weakTargets: weak.map((w) => ({
                subject: w.subject,
                chapter: w.chapter,
                concept: w.concept,
              })),
            });
          }
        } else if (config.mode === "pyq") {
          rows = await PracticeService.listBankQuestions(ctx, {
            subject: config.subject,
            difficulty: config.difficulty,
            limit: config.qCount,
            pyqOnly: true,
          });
        } else {
          rows = await PracticeService.listBankQuestions(ctx, {
            subject: config.subject,
            chapter: config.chapter,
            topic: config.topic,
            difficulty: config.difficulty,
            limit: config.qCount,
          });
        }

        if (cancelled) return;
        const mapped: BankQuestion[] = rows
          .map((r): BankQuestion | null => {
            const options = parseBankOptions(r.options);
            if (!r.id || !r.question || options.length < 2) return null;
            return {
              id: r.id,
              subject: r.subject || "General",
              chapter: r.chapter || "",
              difficulty: r.difficulty || "medium",
              question: r.question,
              options,
              correct: typeof r.correct_index === "number" ? r.correct_index : 0,
              explanation: r.explanation ?? undefined,
            };
          })
          .filter((x): x is BankQuestion => x !== null);
        setQs(mapped);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not start practice");
      } finally {
        if (!cancelled) setLoadingQs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady, config]);

  // Timer
  useEffect(() => {
    if (!config.timeLimitSec || loadingQs || qs.length === 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current!); void finish({ timedOut: true }); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.timeLimitSec, loadingQs, qs.length]);

  async function finish(opts?: { timedOut?: boolean }) {
    if (finishedRef.current || finishing) return;
    finishedRef.current = true;
    setFinishing(true);
    if (timerRef.current) clearInterval(timerRef.current);

    // Unanswered remaining questions → skipped / timed_out so Skipped mode can load them
    if (opts?.timedOut) {
      const loggedBankIds = new Set(
        attemptLog.current.map((a) => a.bankQuestionId).filter(Boolean),
      );
      for (let i = idx; i < qs.length; i++) {
        const q = qs[i];
        if (!q || loggedBankIds.has(q.id)) continue;
        const snap: PracticeAttemptSnapshot = {
          question: q.question,
          options: q.options,
          correctIndex: q.correct,
          selectedIndex: -1,
          isCorrect: false,
          skipped: true,
          timedOut: true,
          explanation: q.explanation,
          bankQuestionId: q.id,
          subject: q.subject,
          chapter: q.chapter,
          concept: q.chapter,
          topic: q.chapter,
          difficulty: q.difficulty,
          source: "practice",
          practiceMode: config.mode,
          sourceId: sessionIdRef.current,
          timeTakenMs: i === idx ? Date.now() - questionStartRef.current : 0,
          hintUsed: i === idx ? hintUsedRef.current : false,
          solutionViewed: false,
          attemptNumber: ++attemptNumberRef.current,
          answeredAt: new Date().toISOString(),
          schoolId: ctx?.schoolId ?? null,
        };
        attemptLog.current.push(snap);
        skippedRef.current = [...skippedRef.current, i];
        void persistAttemptLive(snap);
      }
    }

    const results: SessionResults = {
      correct: correctRef.current,
      total: attemptedRef.current,
      skipped: skippedRef.current.length,
      bookmarked: bookmarkedRef.current.length,
      config,
    };

    const sid = sessionIdRef.current;
    if (sid && ctx) {
      try {
        await PracticeService.finish(ctx, {
          _session_id: sid,
          _attempts: attemptsToFinishPayload(attemptLog.current),
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save practice session");
      }
    }
    onFinish(results);
  }

  function answer(i: number) {
    const q = qs[idx];
    if (!q) return;
    setChosen(i);
    attemptedRef.current += 1;
    setAttempted(attemptedRef.current);
    const ok = i === q.correct;
    if (ok) {
      correctRef.current += 1;
      setCorrect(correctRef.current);
    }
    const elapsed = Date.now() - questionStartRef.current;
    const snap: PracticeAttemptSnapshot = {
      question: q.question,
      options: q.options,
      correctIndex: q.correct,
      selectedIndex: i,
      isCorrect: ok,
      skipped: false,
      explanation: q.explanation,
      bankQuestionId: q.id,
      subject: q.subject,
      chapter: q.chapter,
      concept: q.chapter,
      topic: config.topic || q.chapter,
      difficulty: q.difficulty,
      source: "practice",
      practiceMode: config.mode,
      sourceId: sessionIdRef.current,
      timeTakenMs: elapsed,
      hintUsed: hintUsedRef.current,
      solutionViewed: Boolean(q.explanation),
      attemptNumber: ++attemptNumberRef.current,
      answeredAt: new Date().toISOString(),
      schoolId: ctx?.schoolId ?? null,
    };
    attemptLog.current.push(snap);
    void persistAttemptLive(snap);
    setPhase("fb");
  }

  function revealHint() {
    const current = qs[idx];
    if (!current?.explanation || hintUsedRef.current) return;
    hintUsedRef.current = true;
    setHintRevealed(true);
  }

  function hintPreview(explanation: string): string {
    const trimmed = explanation.trim();
    if (trimmed.length <= 120) return trimmed;
    const cut = trimmed.slice(0, 117);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }

  function next() {
    if (idx + 1 >= qs.length) { void finish(); return; }
    setIdx(i => i + 1); setChosen(null); setPhase("q");
    hintUsedRef.current = false;
    setHintRevealed(false);
    questionStartRef.current = Date.now();
  }

  async function persistAttemptLive(snap: PracticeAttemptSnapshot) {
    const sid = sessionIdRef.current;
    if (!sid || !ctx) return;
    try {
      await PracticeService.recordAttempt(ctx, {
        sessionId: sid,
        bankQuestionId: snap.bankQuestionId ?? null,
        generatedQuestion: {
          question: snap.question,
          options: snap.options,
          explanation: snap.explanation ?? "",
          bank_question_id: snap.bankQuestionId ?? null,
          subject: snap.subject,
          chapter: snap.chapter,
          concept: snap.concept,
          topic: snap.topic,
          difficulty: snap.difficulty,
          practice_mode: snap.practiceMode,
        },
        selectedAnswer: {
          index: snap.selectedIndex,
          selected_index: snap.selectedIndex,
          text: snap.options[snap.selectedIndex] ?? "",
        },
        correctAnswer: {
          index: snap.correctIndex,
          correct_index: snap.correctIndex,
          text: snap.options[snap.correctIndex] ?? "",
        },
        isCorrect: snap.isCorrect,
        score: snap.skipped || snap.timedOut ? 0 : snap.isCorrect ? 1 : 0,
        skipped: snap.skipped ?? false,
        timedOut: snap.timedOut ?? false,
        timeTakenMs: snap.timeTakenMs ?? null,
        subject: snap.subject,
        chapter: snap.chapter,
        concept: snap.concept ?? snap.chapter,
        topic: snap.topic,
        difficulty: snap.difficulty,
        source: snap.source ?? "practice",
        practiceMode: snap.practiceMode ?? config.mode,
        sourceId: snap.sourceId ?? sid,
        hintUsed: snap.hintUsed ?? false,
        solutionViewed: snap.solutionViewed ?? false,
        confidence: snap.confidence ?? null,
        attemptNumber: snap.attemptNumber ?? null,
        answeredAt: snap.answeredAt ?? null,
        schoolId: snap.schoolId ?? ctx.schoolId ?? null,
      });
    } catch {
      /* finish() batch-writes if live persist fails */
    }
  }

  function skip(opts?: { timedOut?: boolean }) {
    const q = qs[idx];
    if (!q) return;
    skippedRef.current = [...skippedRef.current, idx];
    setSkipped(skippedRef.current);
    const elapsed = Date.now() - questionStartRef.current;
    const snap: PracticeAttemptSnapshot = {
      question: q.question,
      options: q.options,
      correctIndex: q.correct,
      selectedIndex: -1,
      isCorrect: false,
      skipped: true,
      timedOut: opts?.timedOut ?? false,
      explanation: q.explanation,
      bankQuestionId: q.id,
      subject: q.subject,
      chapter: q.chapter,
      concept: q.chapter,
      topic: config.topic || q.chapter,
      difficulty: q.difficulty,
      source: "practice",
      practiceMode: config.mode,
      sourceId: sessionIdRef.current,
      timeTakenMs: elapsed,
      hintUsed: hintUsedRef.current,
      solutionViewed: false,
      attemptNumber: ++attemptNumberRef.current,
      answeredAt: new Date().toISOString(),
      schoolId: ctx?.schoolId ?? null,
    };
    attemptLog.current.push(snap);
    void persistAttemptLive(snap);
    next();
  }

  function toggleBookmark() {
    bookmarkedRef.current = bookmarkedRef.current.includes(idx)
      ? bookmarkedRef.current.filter(x => x !== idx)
      : [...bookmarkedRef.current, idx];
    setBookmarked([...bookmarkedRef.current]);
  }

  const q       = qs[idx];
  const isRight = chosen === q?.correct;
  const subj    = subjects.find(s => s.name === q?.subject);
  const timed   = config.timeLimitSec !== null;
  const mm      = Math.floor(timeLeft / 60).toString().padStart(2,"0");
  const ss      = (timeLeft % 60).toString().padStart(2,"0");

  if (loadingQs) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-3">
        <div className="text-sm text-[#78788c]">Loading practice questions…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-400 mx-auto"/>
        <div className="text-lg font-bold text-white">Could not start practice</div>
        <p className="text-sm text-[#78788c]">{loadError}</p>
        <button onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/7 text-sm text-[#78788c] hover:text-white hover:border-white/20 transition-all">
          <ArrowLeft className="w-4 h-4"/> Back to Practice
        </button>
      </div>
    );
  }

  if (qs.length === 0) {
    const emptyByMode: Partial<Record<ModeKey, string>> = {
      weak: "No weak concepts tracked yet (mastery below 70%). Practice more, then return here — or open Recovery.",
      incorrect: "No incorrect questions saved yet. Mistakes from practice and tests will appear here.",
      skipped: "You have not skipped any bank questions yet.",
      pyq: "No previous-year / exam-tagged questions in the bank for this filter yet.",
      bookmarked: "Bookmarked practice questions are not stored yet — use Mistake Book for saved mistakes.",
      chapter: "No questions for this chapter in the bank yet.",
      topic: "No questions for this topic in the bank yet.",
      teacher: "No teacher-assigned practice sets right now.",
      mock: "No mock tests published yet.",
    };
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <HelpCircle className="w-10 h-10 text-[#78788c] mx-auto"/>
        <div className="text-lg font-bold text-white">No questions available</div>
        <p className="text-sm text-[#78788c]">
          {classUnresolved
            ? CLASS_UNRESOLVED_MSG
            : emptyByMode[config.mode] ??
              "The question bank has no approved questions for this mode yet. Try another subject or ask your teacher to add questions."}
        </p>
        <button onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/7 text-sm text-[#78788c] hover:text-white hover:border-white/20 transition-all">
          <ArrowLeft className="w-4 h-4"/> Back to Practice
        </button>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-[#78788c]">{config.label} · Q{idx+1} of {qs.length}</span>
            <div className="flex items-center gap-3">
              {timed && (
                <div className={cn(
                  "flex items-center gap-1.5 text-sm font-black tabular-nums px-3 py-1 rounded-xl",
                  timeLeft < 30 ? "text-rose-400 bg-rose-400/10" : "text-[#4b9fd4] bg-[#4b9fd4]/10"
                )}>
                  <Clock className="w-3.5 h-3.5"/>{mm}:{ss}
                </div>
              )}
              <span className="text-xs text-[#78788c]">{correct}/{attempted} correct</span>
            </div>
          </div>
          <ProgressBar value={idx} max={qs.length} color="#3b5bdb" height="h-1"/>
        </div>
      </div>

      {/* Question card */}
      <GlassCard glow="blue" className="p-6">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            {subj && <SubjectBadge subject={subj.name} color={subj.color}/>}
            <DifficultyBadge level={q.difficulty}/>
            <span className="text-[10px] text-[#78788c]">{displayChapter(q.chapter)}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={toggleBookmark} title="Bookmark"
              className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                bookmarked.includes(idx) ? "text-[#4b9fd4] bg-[#4b9fd4]/15" : "text-[#78788c] hover:text-white hover:bg-white/8"
              )}>
              <Bookmark className="w-3.5 h-3.5"/>
            </button>
          </div>
        </div>
        <div className="text-base font-semibold text-white leading-relaxed">{q.question}</div>
      </GlassCard>

      {/* Options */}
      <div className="space-y-2.5">
        {q.options.map((opt, i) => {
          const isChosen = chosen === i;
          const isCorrect = i === q.correct;
          let bg = "border-white/7 text-[#a0a0b0] hover:border-white/20 hover:text-white hover:bg-white/4";
          if (phase === "fb") {
            if (isCorrect)              bg = "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
            else if (isChosen && !isRight) bg = "border-rose-400/40 bg-rose-400/10 text-rose-300";
            else                        bg = "border-white/4 text-[#78788c] opacity-60";
          }
          return (
            <button key={i} onClick={() => phase === "q" && answer(i)} disabled={phase === "fb" || finishing}
              className={cn("w-full p-4 rounded-2xl border text-left text-sm font-medium transition-all duration-150 flex items-center gap-3", bg)}>
              <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 bg-white/8">
                {String.fromCharCode(65+i)}
              </span>
              <span className="flex-1">{opt}</span>
              {phase === "fb" && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0"/>}
              {phase === "fb" && isChosen && !isRight && <XCircle className="w-4 h-4 text-rose-400 shrink-0"/>}
            </button>
          );
        })}
      </div>

      {/* Hint (question phase — recorded as hint_used on attempt) */}
      {phase === "q" && q.explanation && hintRevealed && (
        <GlassCard className="p-4 border-[#c08a3a]/25">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-[#c08a3a] shrink-0 mt-0.5"/>
            <div className="text-sm text-[#a0a0b0] leading-relaxed">
              <span className="font-semibold text-white">Hint: </span>{hintPreview(q.explanation)}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Explanation (feedback phase) */}
      {phase === "fb" && q.explanation && (
        <GlassCard className="p-4 border-blue-500/20">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-[#c08a3a] shrink-0 mt-0.5"/>
            <div className="text-sm text-[#a0a0b0] leading-relaxed">
              <span className="font-semibold text-white">Explanation: </span>{q.explanation}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {phase === "q" && (
          <button onClick={skip} disabled={finishing}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/7 text-sm text-[#78788c] hover:text-white hover:border-white/20 transition-all">
            <SkipForward className="w-3.5 h-3.5"/> Skip
          </button>
        )}
        {phase === "q" && q.explanation && !hintRevealed && (
          <button onClick={revealHint} disabled={finishing}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[#c08a3a]/30 text-sm text-[#c08a3a] hover:bg-[#c08a3a]/10 transition-all">
            <Lightbulb className="w-3.5 h-3.5"/> Hint
          </button>
        )}
        {phase === "fb" && (
          <button onClick={next} disabled={finishing}
            className="flex-1 py-3 rounded-2xl bg-[#3b5bdb] hover:bg-blue-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2">
            {idx+1 >= qs.length ? "See Results" : "Next Question"} <ChevronRight className="w-4 h-4"/>
          </button>
        )}
        <button onClick={() => void finish()} disabled={finishing}
          className="px-4 py-2.5 rounded-xl border border-white/7 text-sm text-[#78788c] hover:text-rose-400 hover:border-rose-400/20 transition-all">
          {finishing ? "Saving…" : "End Session"}
        </button>
      </div>
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────
interface SessionResults {
  correct: number; total: number; skipped: number; bookmarked: number; config: SessionConfig;
}

function Summary({ results, onRetry, onHub }: {
  results: SessionResults; onRetry: ()=>void; onHub: ()=>void;
}) {
  const { correct, total, skipped, bookmarked, config } = results;
  const pct = total > 0 ? Math.round((correct/total)*100) : 0;
  const color = pct >= 80 ? "#4aa87a" : pct >= 60 ? "#c08a3a" : "#cc5069";
  const emoji = pct >= 90 ? "🏆" : pct >= 75 ? "🎯" : pct >= 60 ? "📈" : "💪";

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <GlassCard className="p-8 text-center" glow={pct>=75?"green":pct>=55?"amber":"rose"}>
        <div className="text-5xl mb-3">{emoji}</div>
        <div className="text-[10px] uppercase tracking-widest text-[#78788c] mb-1">{config.label} · Complete</div>
        <div className="text-5xl font-black tabular-nums mb-1" style={{color,fontFamily:"var(--font-display)"}}>{pct}%</div>
        <div className="text-[#78788c] text-sm mb-6">{correct} correct out of {total} attempted</div>

        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label:"Correct",    value:correct,    color:"#4aa87a" },
            { label:"Wrong",      value:total-correct, color:"#cc5069" },
            { label:"Skipped",    value:skipped,    color:"#c08a3a" },
            { label:"Bookmarked", value:bookmarked, color:"#4b9fd4" },
          ].map(s => (
            <div key={s.label} className="bg-white/4 rounded-xl p-2.5 border border-white/5">
              <div className="text-xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-[#78788c] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-2.5">
          <button onClick={onRetry}
            className="w-full py-3 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{ background:`linear-gradient(135deg,#3b5bdb,#4b9fd4)`, boxShadow:"0 8px 24px rgba(59,130,246,0.3)" }}>
            <RotateCcw className="w-4 h-4"/> Retry Same Mode
          </button>
          {total - correct > 0 && (
            <button onClick={onHub}
              className="w-full py-3 rounded-2xl border border-rose-400/30 text-rose-400 font-semibold text-sm hover:bg-rose-400/8 transition-all flex items-center justify-center gap-2">
              <XCircle className="w-4 h-4"/> Practice {total-correct} incorrect question{total-correct!==1?"s":""}
            </button>
          )}
          <button onClick={onHub}
            className="w-full py-3 rounded-2xl border border-white/7 text-[#78788c] font-semibold text-sm hover:text-white hover:border-white/20 transition-all">
            Back to Practice Hub
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export default function Practice({ setPage }: { setPage?: (p: PageKey) => void }) {
  const student = useGurukulStudent();
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const [subjects, setSubjects] = useState<PracticeSubject[]>([]);
  const [curriculumScope, setCurriculumScope] = useState<CurriculumScope | null>(null);
  const classUnresolved = !!curriculumScope && curriculumScope.classLevel == null;

  useEffect(() => {
    if (!ctx || !academicReady) {
      setSubjects([]);
      setCurriculumScope(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const scope = await PracticeService.resolveCurriculumScope(ctx);
        if (cancelled) return;
        setCurriculumScope(scope);
        if (scope.classLevel == null) {
          setSubjects([]);
          return;
        }
        const names = await PracticeService.listBankSubjects(ctx);
        if (cancelled) return;
        setSubjects(
          names.map((name, i) => ({
            id: name.toLowerCase(),
            name,
            color: subjectColor(name, i),
          })),
        );
      } catch (e) {
        if (!cancelled) {
          setSubjects([]);
          setCurriculumScope(null);
          toast.error(e instanceof Error ? e.message : "Could not load subjects");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady]);

  useEffect(() => {
    if (!user || !ctx || !academicReady) {
      if (!user) setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await PracticeService.listRecentFinished(ctx, 10);
        if (cancelled) return;
        setHistory(
          (data ?? []).map((row) => {
            const pct = row.question_count > 0
              ? Math.round((100 * row.correct_count) / row.question_count)
              : 0;
            return {
              id: row.id,
              date: formatSessionDate(row.finished_at!),
              mode: row.chapter ? displayChapter(String(row.chapter)) : "Practice",
              subject: row.subject || "Mixed",
              qs: row.question_count,
              attempted: row.question_count,
              score: row.correct_count,
              pct,
              time: formatDuration(row.created_at, row.finished_at!),
              status: "completed",
            };
          }),
        );
      } catch (e) {
        if (!cancelled) {
          setHistory([]);
          toast.error(e instanceof Error ? e.message : "Could not load practice history");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, ctx, academicReady, historyTick]);

  const streak = student.streak;
  const [phase,   setPhase]   = useState<Phase>("hub");
  const [modeKey, setModeKey] = useState<ModeKey>("daily");
  const [config,  setConfig]  = useState<SessionConfig | null>(null);
  const [results, setResults] = useState<SessionResults | null>(null);

  /** Instant modes skip config and load with mode-specific filters. */
  const INSTANT: ModeKey[] = ["daily", "weak", "incorrect", "skipped"];

  function handleMode(key: ModeKey) {
    if (key === "bookmarked") {
      setPage?.("mistakebook");
      return;
    }
    setModeKey(key);
    if (INSTANT.includes(key)) {
      const mode = MODES.find(m => m.key === key)!;
      setConfig({
        mode: key,
        label: mode.label,
        subject: "Mixed",
        chapter: null,
        topic: null,
        difficulty: "mixed",
        qCount: key === "daily" ? 15 : 20,
        timeLimitSec: null,
      });
      setPhase("session");
    } else {
      setPhase("config");
    }
  }

  function handleConfigStart(cfg: SessionConfig) {
    setConfig(cfg); setPhase("session");
  }

  function handleFinish(res: SessionResults) {
    setResults(res); setPhase("summary");
    setHistoryTick((t) => t + 1);
  }

  function handleRetry() {
    if (!config) return;
    setPhase("session");
  }

  return (
    <>
      {classUnresolved && (
        <div className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">
          {CLASS_UNRESOLVED_MSG}
        </div>
      )}
      {phase === "hub"     && <Hub onMode={handleMode} history={history} streak={streak}/>}
      {phase === "config"  && (
        <ConfigView
          modeKey={modeKey}
          onStart={handleConfigStart}
          onBack={() => setPhase("hub")}
          subjects={subjects}
          onNavigate={setPage}
          classUnresolved={classUnresolved}
        />
      )}
      {phase === "session" && config && <Session config={config} onFinish={handleFinish} onBack={() => setPhase("hub")} subjects={subjects} classUnresolved={classUnresolved}/>}
      {phase === "summary" && results && (
        <Summary results={results} onRetry={handleRetry} onHub={() => setPhase("hub")}/>
      )}
    </>
  );
}
