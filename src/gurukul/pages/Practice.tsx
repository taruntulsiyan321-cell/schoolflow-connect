import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { useGurukulAcademicIdentity, useGurukulStudent } from "@/gurukul/StudentContext";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, PracticeService, WEAK_CONCEPT_THRESHOLD, type CurriculumScope } from "@/academic";
import type { PracticeSessionRow } from "@/academic";
import { attemptsToFinishPayload, persistAndGoToPracticeResult } from "@/lib/practiceSessionSnapshot";
import type { PracticeAttemptSnapshot } from "@/lib/practiceSessionSnapshot";
import { buildPracticeAnalysisSnapshot } from "@/lib/practiceAnalysisSnapshot";
import { toast } from "sonner";
import {
  displayChapter,
  displaySubject,
  isPlaceholderAcademicLabel,
  presentAcademicLabel,
} from "@/lib/academicPresentation";
import { resolvePracticeSessionStats, formatSessionXp } from "@/lib/practiceSessionStats";
import type { AcademicTermRef } from "@/academic/services/practiceService";
import { GlassCard, ProgressBar, SubjectBadge, DifficultyBadge, cn } from "@/gurukul/components/shared";
import { MathText } from "@/components/MathText";
import {
  BookOpen, Clock, Target,
  BarChart2, Search,
  ChevronRight, CheckCircle2, XCircle, ArrowLeft, Play, SkipForward,
  Flame, Layers,
  Save, Bookmark, BookMarked, Lightbulb,
  RotateCcw, HelpCircle, TrendingDown, FileText, AlertCircle, Filter,
} from "lucide-react";

const CLASS_UNRESOLVED_MSG =
  "We couldn't determine your class. Ask your school admin to assign you to a class (e.g. 10-A, 11-B, or 12-C) so practice can show subjects for your class level only.";
const CLASS_LEVEL_UNRESOLVED_MSG =
  "Your class is assigned, but its name or category does not identify a class level. Ask your school admin to use a label such as Class 10, Std 9, XI, or 12-A.";

// ── Types ────────────────────────────────────────────────────────────────────
type Phase   = "hub" | "config" | "session" | "feedback" | "summary";
type Cat     = "all" | "content" | "source" | "type" | "targeted";
type ModeKey =
  | "subject" | "chapter" | "topic" | "custom"
  | "pyq" | "weak" | "incorrect" | "skipped"
  | "bookmarked";

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
  id: string;
  date: string;
  mode: string;
  practiceType: string;
  subject: string;
  chapter: string;
  difficulty: string;
  qs: number;
  attempted: number;
  score: number;
  pct: number;
  time: string;
  xp: number;
  /** Display string — em dash when XP not yet credited by Progression Engine. */
  xpLabel: string;
  status: string;
  finishedAt: string | null;
  practiceMode: string | null;
  saved: boolean;
};

function formatDurationMs(ms: number | null | undefined, startIso?: string, endIso?: string) {
  if (typeof ms === "number" && ms > 0) {
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }
  if (startIso && endIso) return formatDuration(startIso, endIso);
  return "—";
}

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
// Exactly nine modes. Daily, Teacher Assigned, Timed, Untimed and Mock Tests
// were removed: a time limit is now a Custom Practice goal rather than its own
// mode. Only the Mock Tests entry point is gone — the teacher test system it
// used is untouched and still serves teacher-assigned tests elsewhere.
const MODES: Mode[] = [
  { key:"subject",    label:"Subject Practice",       desc:"Practice questions from a subject of your choice",
    icon:<BookOpen className="w-5 h-5"/>,   color:"#3b5bdb", cat:"content",  badge:"By subject" },
  { key:"chapter",    label:"Chapter Practice",       desc:"Focus on a specific chapter to reinforce concepts",
    icon:<Layers className="w-5 h-5"/>,     color:"#4b9fd4", cat:"content",  badge:"Chapter" },
  { key:"topic",      label:"Topic Practice",         desc:"Drill down to a precise concept or sub-topic",
    icon:<Target className="w-5 h-5"/>,     color:"#6882e8", cat:"content",  badge:"By topic" },
  { key:"custom",     label:"Custom Practice",        desc:"Choose difficulty and either a question count or a time limit",
    icon:<BarChart2 className="w-5 h-5"/>,  color:"#6882e8", cat:"type",    badge:"Your rules" },
  { key:"pyq",        label:"Previous Year Questions",desc:"Board and competitive exam questions from past years",
    icon:<FileText className="w-5 h-5"/>,   color:"#cc5069", cat:"source",  badge:"Past papers" },
  { key:"weak",       label:"Weak Areas Practice",    desc:"Auto-generated from concepts where your confidence is below 60%",
    icon:<TrendingDown className="w-5 h-5"/>, color:"#cc5069", cat:"targeted", badge:"Weak areas", instant:true, hot:true },
  { key:"incorrect",  label:"Incorrect Questions",    desc:"Reattempt questions you got wrong in previous sessions",
    icon:<XCircle className="w-5 h-5"/>,    color:"#cc5069", cat:"targeted", badge:"Retry wrong", instant:true },
  { key:"skipped",    label:"Skipped Questions",      desc:"Solve questions you chose to skip earlier",
    icon:<SkipForward className="w-5 h-5"/>, color:"#c08a3a", cat:"targeted", badge:"Skipped", instant:true },
  { key:"bookmarked", label:"Bookmarked Questions",   desc:"Questions you bookmarked — they stay until you remove them",
    icon:<BookMarked className="w-5 h-5"/>, color:"#4b9fd4", cat:"targeted", badge:"Bookmarked", instant:true },
];

const CATS: { key: Cat; label: string }[] = [
  { key:"all",      label:"All Modes" },
  { key:"content",  label:"By Content" },
  { key:"source",   label:"By Source" },
  { key:"type",     label:"By Type" },
  { key:"targeted", label:"Targeted" },
];

function practiceTypeLabel(mode: string | null | undefined): string {
  if (!mode) return "Practice";
  const found = MODES.find((m) => m.key === mode);
  if (found) return found.label;
  return presentAcademicLabel(mode) || mode;
}

function mapSessionToHistoryRow(row: PracticeSessionRow): HistoryRow {
  const snap = row.analysis_snapshot as {
    difficulty?: string;
    practiceTypeLabel?: string;
    questionCount?: number;
    correctCount?: number;
    wrongCount?: number;
    skippedCount?: number;
    accuracy?: number;
    xpEarned?: number;
    totalTimeMs?: number | null;
  } | null;
  const stats = resolvePracticeSessionStats(row, snap);
  const difficultyRaw = row.difficulty || snap?.difficulty || "mixed";
  return {
    id: row.id,
    date: row.finished_at ? formatSessionDate(row.finished_at) : formatSessionDate(row.created_at),
    mode: row.chapter ? displayChapter(String(row.chapter)) : practiceTypeLabel(row.practice_mode),
    practiceType: snap?.practiceTypeLabel || practiceTypeLabel(row.practice_mode),
    subject: displaySubject(row.subject || "Mixed"),
    chapter: row.chapter ? displayChapter(String(row.chapter)) : "—",
    difficulty: presentAcademicLabel(String(difficultyRaw)) || String(difficultyRaw),
    qs: stats.questionCount,
    attempted: stats.questionCount,
    score: stats.correctCount,
    pct: stats.accuracy,
    time: formatDurationMs(row.total_time_ms, row.created_at, row.finished_at ?? undefined),
    xp: stats.xpEarned,
    xpLabel: formatSessionXp(stats.xpEarned, stats.xpFromDb),
    status: row.finished_at ? "completed" : "incomplete",
    finishedAt: row.finished_at,
    practiceMode: row.practice_mode ?? null,
    saved: Boolean(row.saved_at),
  };
}

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
function Hub({
  onMode,
  history,
  saved,
  incomplete,
  streak,
  onOpenSession,
  onResumeSession,
  onSaveLatest,
  savingLatest,
  historyFilters,
  onHistoryFilters,
  subjects,
}: {
  onMode: (key: ModeKey) => void;
  history: HistoryRow[];
  saved: HistoryRow[];
  incomplete: HistoryRow[];
  streak: number;
  onOpenSession: (id: string) => void;
  onResumeSession: (id: string) => void;
  onSaveLatest: () => void;
  savingLatest: boolean;
  historyFilters: { search: string; subject: string; practiceType: string; date: string };
  onHistoryFilters: (next: Partial<{ search: string; subject: string; practiceType: string; date: string }>) => void;
  subjects: PracticeSubject[];
}) {
  const [cat,    setCat]    = useState<Cat>("all");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const visible = MODES.filter(m =>
    (cat === "all" || m.cat === cat) &&
    (search === "" || m.label.toLowerCase().includes(search.toLowerCase()))
  );

  const hot = MODES.filter(m => m.hot || m.instant).slice(0, 4);

  const filteredHistory = history.filter((h) => {
    const q = historyFilters.search.trim().toLowerCase();
    if (q) {
      const hay = `${h.subject} ${h.chapter} ${h.practiceType} ${h.difficulty}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (historyFilters.subject && h.subject !== historyFilters.subject) return false;
    if (historyFilters.practiceType && h.practiceMode !== historyFilters.practiceType) return false;
    if (historyFilters.date && h.finishedAt) {
      const day = h.finishedAt.slice(0, 10);
      if (day !== historyFilters.date) return false;
    }
    return true;
  });

  return (
    <div className="space-y-8">
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
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#c08a3a]/10 border border-[#c08a3a]/20">
            <Flame className="w-4 h-4 text-[#c08a3a]"/>
            <span className="text-xs font-bold text-[#c08a3a]">{streak}-day streak</span>
          </div>
        )}
      </div>

      {incomplete.length > 0 && (
        <GlassCard className="p-4 border-[#c08a3a]/25">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full bg-[#c08a3a]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Resume session</span>
          </div>
          <div className="space-y-2">
            {incomplete.slice(0, 3).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onResumeSession(s.id)}
                className="group w-full flex items-center gap-3 p-3 rounded-xl border border-white/7 hover:border-[#c08a3a]/35 hover:bg-white/[0.03] transition-all text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-[#c08a3a]/15 flex items-center justify-center shrink-0 text-[#c08a3a]">
                  <RotateCcw className="w-3.5 h-3.5"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{s.subject} · {s.chapter !== "—" ? s.chapter : s.practiceType}</div>
                  <div className="text-[10px] text-[#78788c] mt-0.5">
                    {s.practiceType} · {s.attempted}/{s.qs || "?"} answered · {s.date}
                  </div>
                </div>
                <span className="text-[11px] font-semibold text-[#c08a3a] flex items-center gap-1 shrink-0">
                  Continue <ChevronRight className="w-3 h-3"/>
                </span>
              </button>
            ))}
          </div>
        </GlassCard>
      )}

      {hot.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full bg-[#c08a3a]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Quick Start</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {hot.map(m => (
              <button key={m.key} type="button" onClick={() => onMode(m.key)}
                className="group text-left p-4 rounded-2xl border border-white/7 hover:border-white/15 hover:bg-white/[0.03] transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]">
                <div className="flex items-center gap-2 mb-2" style={{ color: m.color }}>
                  {m.icon}
                  <span className="text-sm font-bold text-white">{m.label}</span>
                </div>
                <div className="text-[11px] text-[#78788c] line-clamp-2">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex flex-wrap gap-1.5 flex-1">
            {CATS.map(c => (
              <button key={c.key} type="button" onClick={() => setCat(c.key)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[11px] font-bold transition-all",
                  cat === c.key ? "bg-white/12 text-white" : "text-[#78788c] hover:text-white hover:bg-white/5"
                )}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#78788c]"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search modes…"
              className="pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/7 text-xs text-white placeholder:text-[#78788c] focus:outline-none focus:border-white/20 w-full sm:w-48"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(m => (
            <button key={m.key} type="button" onClick={() => onMode(m.key)}
              className="group text-left p-4 rounded-2xl border border-white/7 hover:border-white/15 hover:bg-white/[0.03] transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]">
              <div className="flex items-start gap-2 mb-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background:`${m.color}15`, color:m.color }}>
                  {m.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{m.label}</div>
                </div>
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

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-[#4b9fd4]"/>
              <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Saved Sessions</span>
            </div>
            <button
              type="button"
              disabled={savingLatest}
              onClick={onSaveLatest}
              className="flex items-center gap-1 text-[10px] text-[#3b5bdb] hover:text-blue-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-3 h-3"/> {savingLatest ? "Saving…" : "Save latest result"}
            </button>
          </div>
          <div className="space-y-2.5">
            {saved.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#78788c]">
                No saved sessions yet. Finish practice, open analysis, then Save Session — or bookmark your latest finished result here.
              </div>
            ) : saved.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSession(s.id)}
                className="group w-full flex items-start gap-3 p-3 rounded-xl border border-white/5 hover:border-white/12 hover:bg-white/3 transition-all text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-[#4b9fd4]/10 flex items-center justify-center shrink-0 text-[#4b9fd4]">
                  <Save className="w-3.5 h-3.5"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{s.subject} · {s.chapter}</div>
                  <div className="text-[10px] text-[#78788c] truncate mt-0.5">{s.practiceType} · {s.pct}% · {s.attempted} Qs · {s.xpLabel} XP</div>
                  <div className="text-[10px] text-[#78788c]/60 mt-0.5">{s.date}</div>
                </div>
                <Play className="w-3.5 h-3.5 text-[#78788c] group-hover:text-[#4b9fd4] transition-colors shrink-0 mt-1"/>
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-[#6882e8]"/>
              <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Practice History</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors",
                showFilters ? "border-[#6882e8]/40 text-[#6882e8]" : "border-white/10 text-[#78788c] hover:text-white"
              )}
            >
              <Filter className="w-3 h-3"/> Filters
            </button>
          </div>

          {showFilters && (
            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              <div className="relative sm:col-span-2">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#78788c]"/>
                <input
                  value={historyFilters.search}
                  onChange={(e) => onHistoryFilters({ search: e.target.value })}
                  placeholder="Search subject, chapter, type…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/7 text-xs text-white placeholder:text-[#78788c] focus:outline-none focus:border-white/20"
                />
              </div>
              <select
                value={historyFilters.subject}
                onChange={(e) => onHistoryFilters({ subject: e.target.value })}
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/7 text-xs text-white focus:outline-none"
              >
                <option value="">All subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
              <select
                value={historyFilters.practiceType}
                onChange={(e) => onHistoryFilters({ practiceType: e.target.value })}
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/7 text-xs text-white focus:outline-none"
              >
                <option value="">All practice types</option>
                {MODES.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <input
                type="date"
                value={historyFilters.date}
                onChange={(e) => onHistoryFilters({ date: e.target.value })}
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-white/5 border border-white/7 text-xs text-white focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {filteredHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#78788c]">
                {history.length === 0 ? "No practice history yet" : "No sessions match these filters"}
              </div>
            ) : filteredHistory.map(h => (
              <button
                key={h.id}
                type="button"
                onClick={() => onOpenSession(h.id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 hover:border-white/10 hover:bg-white/[0.02] transition-all text-left"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background:`${h.pct>=75?"#4aa87a":h.pct>=55?"#c08a3a":"#cc5069"}15`, color:h.pct>=75?"#4aa87a":h.pct>=55?"#c08a3a":"#cc5069" }}>
                  <span className="text-xs font-black">{h.pct}%</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-white truncate">{h.chapter !== "—" ? h.chapter : h.practiceType}</span>
                    <StatusTag status={h.status}/>
                    {h.saved && <Tag color="#4b9fd4">Saved</Tag>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-[#78788c]">{h.subject}</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#78788c]">{h.practiceType}</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#78788c]">{h.difficulty}</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#78788c]">{h.attempted} Qs</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#78788c]">{h.time}</span>
                    <span className="text-[10px] text-[#78788c]/40">·</span>
                    <span className="text-[10px] text-[#c08a3a]">{h.xpLabel} XP</span>
                  </div>
                </div>
                <div className="text-[10px] text-[#78788c] shrink-0 text-right hidden sm:block">{h.date}</div>
                <ChevronRight className="w-3.5 h-3.5 text-[#78788c] shrink-0"/>
              </button>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ── Config views ─────────────────────────────────────────────────────────────
function ConfigView({
  modeKey, onStart, onBack, subjects, onNavigate, classUnresolved, classUnresolvedMessage,
}: {
  modeKey: ModeKey;
  onStart: (cfg: SessionConfig) => void;
  onBack: () => void;
  subjects: PracticeSubject[];
  onNavigate?: (page: PageKey) => void;
  classUnresolved?: boolean;
  classUnresolvedMessage?: string;
}) {
  const mode = MODES.find(m => m.key === modeKey)!;
  const { ctx, ready: academicReady, studentId, classId } = useAcademicContext();
  const navigate = useNavigate();

  const [selSubject,    setSelSubject]    = useState<string | null>(null);
  const [selChapter,    setSelChapter]    = useState<string | null>(null);
  const [selTopic,      setSelTopic]      = useState<string | null>(null);
  const [selDifficulty, setSelDifficulty] = useState<string>(
    modeKey === "custom" ? "medium" : "mixed",
  );
  const [qCount,        setQCount]        = useState(20);
  const [timeLimitMin,  setTimeLimitMin]  = useState(20);
  // Custom Practice targets EITHER a question count OR a time limit, never
  // both — picking one hides the other.
  const [goalType,      setGoalType]      = useState<"count" | "time">("count");
  const [pyqYear,       setPyqYear]       = useState<number | null>(null);
  const [chapters,      setChapters]      = useState<AcademicTermRef[]>([]);
  const [topics,        setTopics]        = useState<AcademicTermRef[]>([]);
  const [metaLoading,   setMetaLoading]   = useState(false);

  useEffect(() => {
    setSelChapter(null);
    setSelTopic(null);
    setChapters([]);
    setTopics([]);
    if (!selSubject || !ctx || !academicReady) return;
    if (!["chapter", "topic", "custom"].includes(modeKey)) return;
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
    setSelTopic(null);
    setTopics([]);
    if (!selSubject || !ctx || !academicReady) return;
    if (!["topic", "custom"].includes(modeKey)) return;
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
    // Custom Practice is the only mode with a time goal, and it is exclusive
    // with the question count.
    const useTimeGoal = modeKey === "custom" && goalType === "time";
    onStart({
      mode: modeKey,
      label: mode.label,
      subject: selSubject ?? "Mixed",
      chapter: selChapter,
      topic: selTopic,
      difficulty: selDifficulty,
      // A time-goal session is bounded by the clock, so request a generous
      // pool rather than a specific count.
      qCount: useTimeGoal ? 50 : qCount,
      timeLimitSec: useTimeGoal ? timeLimitMin * 60 : null,
      pyqYear: modeKey === "pyq" ? pyqYear : null,
    });
  }

  const subjectEmptyMsg = classUnresolved
    ? classUnresolvedMessage ?? CLASS_UNRESOLVED_MSG
    : "No subjects in the question bank yet for your class and board.";

  if (modeKey === "custom") {
    // Subject / chapter / topic are all optional here — only difficulty and a
    // goal are required.
    const goalReady = goalType === "count" ? qCount > 0 : timeLimitMin > 0;
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker
            selected={selSubject}
            onSelect={setSelSubject}
            subjects={subjects}
            emptyMessage={subjectEmptyMsg}
            allowAll
            label="1. Subject (optional)"
          />
          {selSubject && (
            <OptionChips
              label={metaLoading ? "Loading chapters…" : "2. Chapter (optional)"}
              options={chapters}
              selected={selChapter}
              onSelect={setSelChapter}
              allowClear
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

          <div>
            <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">
              Difficulty
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

          <div>
            <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">
              Practice goal
            </div>
            <div className="flex gap-2 mb-4">
              {([
                { key: "count" as const, label: "Question count" },
                { key: "time"  as const, label: "Time limit" },
              ]).map(g => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGoalType(g.key)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-bold border transition-all",
                    goalType === g.key ? "border-transparent" : "border-white/7 text-[#78788c] hover:border-white/15",
                  )}
                  style={goalType === g.key ? { background:`${mode.color}18`, color:mode.color, borderColor:`${mode.color}40` } : {}}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Exactly one goal input is ever mounted. */}
            {goalType === "count" ? (
              <div className="flex gap-2 flex-wrap">
                {[10, 20, 30, 50].map(n => (
                  <button key={n} type="button" onClick={() => setQCount(n)}
                    className={cn(
                      "px-5 py-3 rounded-xl text-sm font-black border transition-all",
                      qCount === n ? "border-transparent" : "border-white/7 text-[#78788c] hover:border-white/15",
                    )}
                    style={qCount === n ? { background:`${mode.color}18`, color:mode.color, borderColor:`${mode.color}40` } : {}}>
                    {n} questions
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {[10, 20, 30, 45, 60].map(t => (
                  <button key={t} type="button" onClick={() => setTimeLimitMin(t)}
                    className={cn(
                      "px-5 py-3 rounded-xl text-sm font-black border transition-all",
                      timeLimitMin === t ? "border-transparent" : "border-white/7 text-[#78788c] hover:border-white/15",
                    )}
                    style={timeLimitMin === t ? { background:`${mode.color}18`, color:mode.color, borderColor:`${mode.color}40` } : {}}>
                    {t} min
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <StartButton
          color={mode.color}
          disabled={!selDifficulty || !goalReady}
          onStart={handleStart}
        />
      </ConfigShell>
    );
  }

  if (modeKey === "pyq") {
    // Board and class come from the student's own profile; only subject and
    // year are chosen here.
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 6 }, (_, i) => currentYear - 1 - i);
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <p className="text-xs text-[#78788c]">Loads past-paper / exam-year tagged questions from the bank when available.</p>
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} subjects={subjects} emptyMessage={subjectEmptyMsg} allowAll label="Subject"/>
          <div>
            <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-3">Exam year (optional)</div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => setPyqYear(null)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-bold border transition-all",
                  pyqYear === null ? "border-transparent" : "border-white/7 text-[#78788c] hover:border-white/15",
                )}
                style={pyqYear === null ? { background:`${mode.color}18`, color:mode.color, borderColor:`${mode.color}40` } : {}}>
                All years
              </button>
              {years.map(y => (
                <button key={y} type="button" onClick={() => setPyqYear(y)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-bold border transition-all",
                    pyqYear === y ? "border-transparent" : "border-white/7 text-[#78788c] hover:border-white/15",
                  )}
                  style={pyqYear === y ? { background:`${mode.color}18`, color:mode.color, borderColor:`${mode.color}40` } : {}}>
                  {y}
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
  /** Previous Year Questions only — restricts to one exam year. */
  pyqYear?: number | null;
  /** When set, continue an unfinished practice_sessions row instead of starting new. */
  resumeSessionId?: string | null;
}

// ── Session (question-solving) ───────────────────────────────────────────────
function Session({
  config, onFinish, onBack, onNavigate, subjects, classUnresolved, classUnresolvedMessage,
}: {
  config: SessionConfig;
  onFinish: (results: SessionResults) => void;
  onBack: () => void;
  onNavigate?: (p: PageKey) => void;
  subjects: PracticeSubject[];
  classUnresolved?: boolean;
  classUnresolvedMessage?: string;
}) {
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
  /** Prior attempts already on the session (resume) — progress UI must include these. */
  const [priorCount, setPriorCount] = useState(0);
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
  const startedAtRef = useRef<string | undefined>(undefined);
  const serverStatsRef = useRef<{
    questionCount?: number;
    correctCount?: number;
    wrongCount?: number;
    skippedCount?: number;
    accuracy?: number;
    xpEarned?: number;
    totalTimeMs?: number | null;
  } | null>(null);

  useEffect(() => {
    if (!ctx || !academicReady) {
      // Academic context is still initializing — this is a normal ~1s state
      // on every fresh mount, not a failure, so it must not flash an error.
      // Leave loadingQs at its initial `true` (spinner keeps showing) and
      // let this effect's own dependency array re-run it the instant
      // ctx/academicReady resolve. Only if that genuinely never happens do
      // we surface a real error, after a bounded wait.
      const timeout = setTimeout(() => {
        setLoadingQs(false);
        setLoadError("Academic context not ready. Try again in a moment.");
      }, 8000);
      return () => clearTimeout(timeout);
    }

    let cancelled = false;
    (async () => {
      setLoadingQs(true);
      setLoadError(null);
      try {
        if (!config.resumeSessionId && classUnresolved) {
          setLoadError(classUnresolvedMessage ?? CLASS_UNRESOLVED_MSG);
          return;
        }

        const chapterForStart =
          config.chapter ||
          config.topic ||
          null;

        let excludeIds: string[] = [];
        let remainingCount = config.qCount;
        /** Effective bank difficulty — prefer config, then session row, then prior attempts. */
        let effectiveDifficulty = config.difficulty || "mixed";

        if (config.resumeSessionId) {
          sessionIdRef.current = config.resumeSessionId;
          const existing = await PracticeService.getSession(ctx, config.resumeSessionId);
          if (!existing || existing.finished_at) {
            setLoadError("That session is already finished or no longer available.");
            return;
          }
          startedAtRef.current = existing.created_at;
          if (existing.difficulty && existing.difficulty !== "mixed") {
            effectiveDifficulty = existing.difficulty;
          } else if (!effectiveDifficulty || effectiveDifficulty === "mixed") {
            // Legacy incomplete rows pre-difficulty-persist: keep config as-is.
          }
          const prior = await PracticeService.listSessionAttempts(ctx, config.resumeSessionId);
          if (cancelled) return;

          let priorCorrect = 0;
          let priorAttempted = 0;
          const priorSkipped: number[] = [];
          const priorLog: PracticeAttemptSnapshot[] = [];

          prior.forEach((row: Record<string, unknown>, i: number) => {
            const gq = (row.generated_question ?? {}) as Record<string, unknown>;
            const opts = parseBankOptions(gq.options);
            const bankId =
              (typeof row.bank_question_id === "string" && row.bank_question_id) ||
              (typeof gq.bank_question_id === "string" ? gq.bank_question_id : null);
            if (bankId) excludeIds.push(bankId);
            const skipped = Boolean(row.skipped);
            const isCorrect = Boolean(row.is_correct) && !skipped;
            if (skipped) priorSkipped.push(i);
            else priorAttempted += 1;
            if (isCorrect) priorCorrect += 1;
            const selected = (row.selected_answer ?? {}) as { index?: number; selected_index?: number };
            const correctAns = (row.correct_answer ?? {}) as { index?: number; correct_index?: number };
            priorLog.push({
              question: String(gq.question ?? ""),
              options: opts,
              correctIndex:
                typeof correctAns.correct_index === "number"
                  ? correctAns.correct_index
                  : typeof correctAns.index === "number"
                    ? correctAns.index
                    : 0,
              selectedIndex:
                typeof selected.selected_index === "number"
                  ? selected.selected_index
                  : typeof selected.index === "number"
                    ? selected.index
                    : -1,
              isCorrect,
              skipped,
              explanation: typeof gq.explanation === "string" ? gq.explanation : undefined,
              bankQuestionId: bankId,
              subject: String(row.subject ?? gq.subject ?? existing.subject ?? ""),
              chapter: String(row.chapter ?? gq.chapter ?? existing.chapter ?? ""),
              difficulty: typeof gq.difficulty === "string" ? gq.difficulty : "medium",
              source: "practice",
              practiceMode: config.mode,
              sourceId: config.resumeSessionId,
              timeTakenMs: typeof row.time_taken_ms === "number" ? row.time_taken_ms : null,
              hintUsed: Boolean(row.hint_used),
              attemptNumber: i + 1,
              schoolId: ctx.schoolId ?? null,
            });
          });

          // Legacy resume: if session.difficulty is null, infer when all prior attempts agree.
          if ((!effectiveDifficulty || effectiveDifficulty === "mixed") && priorLog.length > 0) {
            const uniq = [
              ...new Set(
                priorLog
                  .map((p) => String(p.difficulty || "").toLowerCase())
                  .filter((d) => d && d !== "mixed"),
              ),
            ];
            if (uniq.length === 1) effectiveDifficulty = uniq[0];
          }

          attemptLog.current = priorLog;
          correctRef.current = priorCorrect;
          attemptedRef.current = priorAttempted;
          skippedRef.current = priorSkipped;
          setCorrect(priorCorrect);
          setAttempted(priorAttempted);
          setSkipped(priorSkipped);
          setPriorCount(priorLog.length);
          attemptNumberRef.current = priorLog.length;
          // Honest timed resume: remaining = persisted limit − elapsed attempt time (never invent 15m).
          const limitSec =
            typeof existing.time_limit_sec === "number" && existing.time_limit_sec > 0
              ? existing.time_limit_sec
              : config.timeLimitSec;
          if (typeof limitSec === "number" && limitSec > 0) {
            const usedMs = priorLog.reduce((sum, a) => sum + (a.timeTakenMs || 0), 0);
            setTimeLeft(Math.max(0, limitSec - Math.floor(usedMs / 1000)));
          } else {
            setTimeLeft(0);
          }
          const target = existing.question_count || config.qCount;
          remainingCount = Math.max(0, target - priorLog.length);
          if (remainingCount === 0) {
            // Nothing left — finish the incomplete session with prior attempts.
            setQs([]);
            return;
          }
        } else {
          const sid = await PracticeService.start(ctx, {
            _subject: config.subject === "Mixed" ? "" : config.subject,
            _chapter: chapterForStart,
            _count: config.qCount,
            _practice_mode: config.mode,
            _difficulty: config.difficulty,
            _time_limit_sec: config.timeLimitSec,
          });
          if (cancelled) return;
          sessionIdRef.current = sid as string;
          startedAtRef.current = new Date().toISOString();
          questionStartRef.current = Date.now();
          attemptNumberRef.current = 0;
          setPriorCount(0);
        }

        questionStartRef.current = Date.now();

        let rows: Awaited<ReturnType<typeof PracticeService.listBankQuestions>> = [];
        const bankOpts = { excludeIds: excludeIds.length ? excludeIds : undefined };

        if (config.mode === "incorrect") {
          rows = await PracticeService.listMistakeQuestions(ctx, { limit: remainingCount });
          if (excludeIds.length) {
            const skip = new Set(excludeIds);
            rows = rows.filter((r) => !skip.has(r.id));
          }
        } else if (config.mode === "skipped") {
          rows = await PracticeService.listSkippedBankQuestions(ctx, { limit: remainingCount });
          if (excludeIds.length) {
            const skip = new Set(excludeIds);
            rows = rows.filter((r) => !skip.has(r.id));
          }
        } else if (config.mode === "bookmarked") {
          rows = await PracticeService.listBookmarkedQuestions(ctx, { limit: remainingCount });
          if (excludeIds.length) {
            const skip = new Set(excludeIds);
            rows = rows.filter((r) => !skip.has(r.id));
          }
        } else if (config.mode === "weak") {
          // Practice Engine owns this mode, so it reads V1 confidence.
          // Recovery/Revision/Nova keep reading the legacy weighted score.
          const weak = await PracticeService.listWeakConcepts(ctx, { source: "simple", limit: 12 });
          if (weak.length === 0) {
            rows = [];
          } else {
            rows = await PracticeService.listBankQuestions(ctx, {
              difficulty: effectiveDifficulty,
              limit: remainingCount,
              weakTargets: weak.map((w) => ({
                subject: w.subject,
                chapter: w.chapter,
                concept: w.concept,
              })),
              ...bankOpts,
            });
          }
        } else if (config.mode === "pyq") {
          rows = await PracticeService.listBankQuestions(ctx, {
            subject: config.subject,
            difficulty: effectiveDifficulty,
            limit: remainingCount,
            pyqOnly: true,
            examYear: config.pyqYear ?? null,
            ...bankOpts,
          });
        } else {
          rows = await PracticeService.listBankQuestions(ctx, {
            subject: config.subject,
            chapter: config.chapter,
            topic: config.topic,
            difficulty: effectiveDifficulty,
            limit: remainingCount,
            ...bankOpts,
          });
        }

        if (cancelled) return;
        const mapped: BankQuestion[] = rows
          .map((r): BankQuestion | null => {
            const options = parseBankOptions(r.options);
            if (!r.id || !r.question || options.length < 2) return null;
            return {
              id: r.id,
              subject: r.subject || "",
              chapter: r.chapter || "",
              difficulty: r.difficulty || "medium",
              question: r.question,
              options,
              correct: typeof r.correct_index === "number" ? r.correct_index : 0,
              explanation: r.explanation ?? undefined,
            };
          })
          .filter((x): x is BankQuestion => x !== null);
        // Empty new session → finish immediately so Resume is not polluted with 0-question shells.
        if (
          mapped.length === 0 &&
          !config.resumeSessionId &&
          sessionIdRef.current &&
          ctx
        ) {
          try {
            await PracticeService.finish(ctx, {
              _session_id: sessionIdRef.current,
              _attempts: [],
            });
          } catch {
            /* best-effort; empty UI still shown */
          }
          sessionIdRef.current = null;
        }
        setQs(mapped);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not start practice");
      } finally {
        if (!cancelled) setLoadingQs(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, academicReady, config]);

  // Resume with prior attempts but no remaining bank questions → finish via SSOT RPC.
  useEffect(() => {
    if (loadingQs || loadError || finishedRef.current) return;
    if (!config.resumeSessionId) return;
    if (qs.length > 0) return;
    if (attemptLog.current.length === 0) return;
    void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingQs, loadError, qs.length, config.resumeSessionId]);

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

    const sid = sessionIdRef.current;
    const results: SessionResults = {
      correct: correctRef.current,
      total: Math.max(attemptedRef.current, attemptLog.current.length),
      skipped: skippedRef.current.length,
      bookmarked: bookmarkedRef.current.length,
      config,
      sessionId: sid,
      attempts: [...attemptLog.current],
      startedAt: startedAtRef.current,
      serverStats: null,
    };

    if (sid && ctx) {
      try {
        const finishRaw = await PracticeService.finish(ctx, {
          _session_id: sid,
          _attempts: attemptsToFinishPayload(attemptLog.current),
        });
        const fin = (finishRaw ?? {}) as Record<string, unknown>;
        const serverStats = {
          questionCount: typeof fin.total === "number" ? fin.total : attemptLog.current.length,
          correctCount: typeof fin.correct_count === "number" ? fin.correct_count : correctRef.current,
          wrongCount: typeof fin.wrong_count === "number" ? fin.wrong_count : undefined,
          skippedCount: typeof fin.skipped_count === "number" ? fin.skipped_count : skippedRef.current.length,
          accuracy: typeof fin.accuracy === "number" ? Number(fin.accuracy) : undefined,
          xpEarned: typeof fin.xp_earned === "number" ? fin.xp_earned : undefined,
          totalTimeMs: typeof fin.total_time_ms === "number" ? fin.total_time_ms : null,
        };
        serverStatsRef.current = serverStats;
        results.serverStats = serverStats;
        if (typeof serverStats.correctCount === "number") results.correct = serverStats.correctCount;
        if (typeof serverStats.questionCount === "number") results.total = serverStats.questionCount;
        if (typeof serverStats.skippedCount === "number") results.skipped = serverStats.skippedCount;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save practice session");
        results.serverStats = null;
        onFinish({ ...results, finishFailed: true });
        return;
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save this answer — it will retry when you finish");
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
    const nextOn = !bookmarkedRef.current.includes(idx);
    bookmarkedRef.current = nextOn
      ? [...bookmarkedRef.current, idx]
      : bookmarkedRef.current.filter(x => x !== idx);
    setBookmarked([...bookmarkedRef.current]);

    // Persist. Bookmarks are permanent — answering correctly never clears one.
    const bankId = qs[idx]?.id;
    if (!bankId || !ctx) {
      toast.message(nextOn ? "Bookmarked for this session." : "Bookmark removed.");
      return;
    }
    void PracticeService.toggleBookmark(ctx, bankId, nextOn)
      .then(() => {
        toast.success(nextOn ? "Bookmarked." : "Bookmark removed.");
      })
      .catch(() => {
        // Roll the optimistic toggle back so the icon never lies about state.
        bookmarkedRef.current = nextOn
          ? bookmarkedRef.current.filter(x => x !== idx)
          : [...bookmarkedRef.current, idx];
        setBookmarked([...bookmarkedRef.current]);
        toast.error("Could not save bookmark. Please try again.");
      });
  }

  const q       = qs[idx];
  const isRight = chosen === q?.correct;
  const subj    = subjects.find(s => s.name === q?.subject);
  const timed   = config.timeLimitSec !== null;
  const mm      = Math.floor(timeLeft / 60).toString().padStart(2,"0");
  const ss      = (timeLeft % 60).toString().padStart(2,"0");
  const displayTotal = priorCount + qs.length;
  const displayIndex = priorCount + idx + 1;

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
      weak: `No weak concepts tracked yet (confidence below ${WEAK_CONCEPT_THRESHOLD}%). Finish a practice session, then return here — or open Recovery.`,
      incorrect: "Nothing to retry — you have no questions currently marked wrong.",
      skipped: "You have not skipped any bank questions yet.",
      pyq: "No previous-year / exam-tagged questions in the bank for this filter yet.",
      bookmarked: "You have not bookmarked any questions yet. Bookmark one during practice and it stays until you remove it.",
      chapter: "No questions for this chapter in the bank yet.",
      topic: "No questions for this topic in the bank yet.",
      custom: "No questions match those filters yet. Try a different difficulty or clear a filter.",
    };
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <HelpCircle className="w-10 h-10 text-[#78788c] mx-auto"/>
        <div className="text-lg font-bold text-white">No questions available</div>
        <p className="text-sm text-[#78788c]">
          {classUnresolved
            ? classUnresolvedMessage ?? CLASS_UNRESOLVED_MSG
            : emptyByMode[config.mode] ??
              "The question bank has no approved questions for this mode yet. Try another subject or ask your teacher to add questions."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {config.mode === "weak" && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("recovery")}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#4aa87a]/40 text-sm text-[#4aa87a] hover:bg-[#4aa87a]/10 transition-all"
            >
              Open Recovery
            </button>
          )}
          <button onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/7 text-sm text-[#78788c] hover:text-white hover:border-white/20 transition-all">
            <ArrowLeft className="w-4 h-4"/> Back to Practice
          </button>
        </div>
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
            <span className="text-xs text-[#78788c]">{config.label} · Q{displayIndex} of {displayTotal}</span>
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
          <ProgressBar value={priorCount + idx} max={Math.max(displayTotal, 1)} color="#3b5bdb" height="h-1"/>
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
            <button onClick={toggleBookmark} title="Flag for this session (not saved to Mistake Book)"
              className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                bookmarked.includes(idx) ? "text-[#4b9fd4] bg-[#4b9fd4]/15" : "text-[#78788c] hover:text-white hover:bg-white/8"
              )}>
              <Bookmark className="w-3.5 h-3.5"/>
            </button>
          </div>
        </div>
        <div className="text-base font-semibold text-white leading-relaxed">
          <MathText block text={q.question} />
        </div>
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
              <span className="flex-1"><MathText text={opt} /></span>
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
              <span className="font-semibold text-white">Hint: </span>
              <MathText text={hintPreview(q.explanation)} />
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
              <span className="font-semibold text-white">Explanation: </span>
              <MathText text={q.explanation} />
            </div>
          </div>
        </GlassCard>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {phase === "q" && (
          <button onClick={() => skip()} disabled={finishing}
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
  correct: number;
  total: number;
  skipped: number;
  bookmarked: number;
  config: SessionConfig;
  sessionId: string | null;
  attempts: PracticeAttemptSnapshot[];
  startedAt?: string;
  finishFailed?: boolean;
  serverStats?: {
    questionCount?: number;
    correctCount?: number;
    wrongCount?: number;
    skippedCount?: number;
    accuracy?: number;
    xpEarned?: number;
    totalTimeMs?: number | null;
  } | null;
}

function Summary({ results, onRetry, onHub }: {
  results: SessionResults; onRetry: ()=>void; onHub: ()=>void;
}) {
  const { correct, total, skipped, bookmarked, config, serverStats, finishFailed } = results;
  // Session SSOT: prefer finish-RPC columns via resolvePracticeSessionStats — never invent XP.
  const stats = resolvePracticeSessionStats(null, {
    questionCount: serverStats?.questionCount ?? total,
    correctCount: serverStats?.correctCount ?? correct,
    wrongCount: serverStats?.wrongCount,
    skippedCount: serverStats?.skippedCount ?? skipped,
    accuracy: serverStats?.accuracy,
    xpEarned: serverStats?.xpEarned,
    totalTimeMs: serverStats?.totalTimeMs,
  });
  const wrong = stats.wrongCount;
  const pct = stats.accuracy;
  const color = pct >= 80 ? "#4aa87a" : pct >= 60 ? "#c08a3a" : "#cc5069";
  const emoji = pct >= 90 ? "🏆" : pct >= 75 ? "🎯" : pct >= 60 ? "📈" : "💪";
  const xpFormatted = formatSessionXp(stats.xpEarned, stats.xpFromDb);
  const xpLabel = xpFormatted === "—" ? null : `+${xpFormatted} XP`;
return (
    <div className="max-w-lg mx-auto space-y-5">
      <GlassCard className="p-8 text-center" glow={pct>=75?"green":pct>=55?"amber":"rose"}>
        <div className="text-5xl mb-3">{emoji}</div>
        <div className="text-[10px] uppercase tracking-widest text-[#78788c] mb-1">{config.label} · Complete</div>
        <div className="text-5xl font-black tabular-nums mb-1" style={{color,fontFamily:"var(--font-display)"}}>{pct}%</div>
        <div className="text-[#78788c] text-sm mb-6">{stats.correctCount} correct out of {stats.questionCount}</div>
        {xpLabel && (
          <div className="text-sm font-bold text-[#c08a3a] mb-4 tabular-nums">
            {xpLabel}
          </div>
        )}

        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label:"Correct",    value:stats.correctCount,    color:"#4aa87a" },
            { label:"Wrong",      value:wrong, color:"#cc5069" },
            { label:"Skipped",    value:stats.skippedCount,    color:"#c08a3a" },
            { label:"Flagged", value:bookmarked, color:"#4b9fd4" },
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
          {wrong > 0 && (
            <button onClick={onHub}
              className="w-full py-3 rounded-2xl border border-rose-400/30 text-rose-400 font-semibold text-sm hover:bg-rose-400/8 transition-all flex items-center justify-center gap-2">
              <XCircle className="w-4 h-4"/> Practice {wrong} incorrect question{wrong!==1?"s":""}
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
  const academicIdentity = useGurukulAcademicIdentity();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [saved, setSaved] = useState<HistoryRow[]>([]);
  const [incomplete, setIncomplete] = useState<HistoryRow[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const [subjects, setSubjects] = useState<PracticeSubject[]>([]);
  const [curriculumScope, setCurriculumScope] = useState<CurriculumScope | null>(null);
  const [savingLatest, setSavingLatest] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({
    search: "",
    subject: "",
    practiceType: "",
    date: "",
  });
  const classIdMissing = !!curriculumScope && !academicIdentity.classId;
  const classLevelUnresolved = !!curriculumScope && curriculumScope.classLevel == null;
  const classUnresolved = classIdMissing || classLevelUnresolved;
  const classUnresolvedMessage = classIdMissing
    ? CLASS_UNRESOLVED_MSG
    : CLASS_LEVEL_UNRESOLVED_MSG;

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
      if (!user) {
        setHistory([]);
        setSaved([]);
        setIncomplete([]);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [hist, savedRows, openRows] = await Promise.all([
          PracticeService.listHistory(ctx, {
            limit: 100,
            subject: historyFilters.subject || null,
            practiceMode: historyFilters.practiceType || null,
            dateFrom: historyFilters.date ? `${historyFilters.date}T00:00:00.000Z` : null,
            dateTo: historyFilters.date ? `${historyFilters.date}T23:59:59.999Z` : null,
            // Search stays client-side over this window (ilike OR across columns needs RPC).
            search: null,
          }),
          PracticeService.listSavedSessions(ctx, 40),
          PracticeService.listIncompleteSessions(ctx, 8),
        ]);
        if (cancelled) return;
        setHistory((hist ?? []).map(mapSessionToHistoryRow));
        setSaved((savedRows ?? []).map(mapSessionToHistoryRow));
        const openMapped = await Promise.all(
          (openRows ?? []).map(async (row) => {
            const mapped = mapSessionToHistoryRow(row);
            try {
              const attempts = await PracticeService.listSessionAttempts(ctx, row.id);
              const answered = attempts.length;
              return {
                ...mapped,
                attempted: answered,
                qs: row.question_count || answered,
                status: "incomplete" as const,
              };
            } catch {
              return { ...mapped, status: "incomplete" as const };
            }
          }),
        );
        setIncomplete(openMapped);
      } catch (e) {
        if (!cancelled) {
          setHistory([]);
          setSaved([]);
          setIncomplete([]);
          toast.error(e instanceof Error ? e.message : "Could not load practice history");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    user,
    ctx,
    academicReady,
    historyTick,
    historyFilters.subject,
    historyFilters.practiceType,
    historyFilters.date,
  ]);

  const streak = student.streak;
  const [phase,   setPhase]   = useState<Phase>("hub");
  const [modeKey, setModeKey] = useState<ModeKey>("subject");
  const [config,  setConfig]  = useState<SessionConfig | null>(null);
  const [results, setResults] = useState<SessionResults | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);

  /** Instant modes skip config and load with mode-specific filters. */
  const INSTANT: ModeKey[] = ["weak", "incorrect", "skipped", "bookmarked"];

  /** Honor Revision/Recovery CTAs: /student/practice?chapter=&subject=&topic= */
  useEffect(() => {
    if (deepLinkHandled.current || phase !== "hub") return;

    // ?mode=<instant mode> — used by Mistake Book's "Practice again".
    const modeRaw = searchParams.get("mode");
    if (modeRaw && (INSTANT as string[]).includes(modeRaw)) {
      deepLinkHandled.current = true;
      setSearchParams({}, { replace: true });
      handleMode(modeRaw as ModeKey);
      return;
    }

    const chapterRaw = searchParams.get("chapter");
    const subjectRaw = searchParams.get("subject");
    const topicRaw = searchParams.get("topic");
    if (!chapterRaw && !subjectRaw && !topicRaw) return;

    const chapter =
      chapterRaw && !isPlaceholderAcademicLabel(chapterRaw) ? chapterRaw.trim() : null;
    const subject =
      subjectRaw && !isPlaceholderAcademicLabel(subjectRaw) ? subjectRaw.trim() : null;
    const topic =
      topicRaw && !isPlaceholderAcademicLabel(topicRaw) ? topicRaw.trim() : null;

    deepLinkHandled.current = true;
    setSearchParams({}, { replace: true });

    if (!chapter && !subject && !topic) {
      toast.message("Practice link had no real subject or chapter — pick a mode below.");
      return;
    }

    const modeKeyDeep: ModeKey = chapter || topic ? "chapter" : "subject";
    const mode = MODES.find((m) => m.key === modeKeyDeep) ?? MODES.find((m) => m.key === "chapter")!;
    setModeKey(modeKeyDeep);
    setConfig({
      mode: modeKeyDeep,
      label: mode.label,
      subject: subject || "Mixed",
      chapter: chapter || topic,
      topic,
      difficulty: "mixed",
      qCount: 20,
      timeLimitSec: null,
    });
    setPhase("session");
  }, [searchParams, setSearchParams, phase]);

  function handleMode(key: ModeKey) {
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
        qCount: 20,
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

  function openSessionAnalysis(sessionId: string) {
    navigate(`/student/practice/session/${sessionId}/result`);
  }

  async function resumeSession(sessionId: string) {
    if (!ctx) return;
    try {
      const row = await PracticeService.getSession(ctx, sessionId);
      if (!row || row.finished_at) {
        toast.message("Session already finished — opening analysis");
        openSessionAnalysis(sessionId);
        return;
      }
      const modeKeyResume = (MODES.some((m) => m.key === row.practice_mode)
        ? row.practice_mode
        : "subject") as ModeKey;
      const mode = MODES.find((m) => m.key === modeKeyResume) ?? MODES[1];
      const snap = (row.analysis_snapshot ?? null) as { time_limit_sec?: number } | null;
      const persistedLimit =
        typeof row.time_limit_sec === "number" && row.time_limit_sec > 0
          ? row.time_limit_sec
          : typeof snap?.time_limit_sec === "number" && snap.time_limit_sec > 0
            ? snap.time_limit_sec
            : null;
      // Never invent a 15-minute clock — timed resume without a stored limit stays untimed.
      setModeKey(modeKeyResume);
      setConfig({
        mode: modeKeyResume,
        label: mode.label,
        subject: row.subject || "Mixed",
        chapter:
          row.chapter && !isPlaceholderAcademicLabel(row.chapter) ? row.chapter : null,
        topic: null,
        difficulty: row.difficulty || "mixed",
        qCount: row.question_count || 20,
        timeLimitSec: persistedLimit,
        resumeSessionId: sessionId,
      });
      setPhase("session");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resume session");
    }
  }

  async function saveLatestSession() {
    if (!ctx) {
      toast.message("Complete a practice session first");
      return;
    }
    setSavingLatest(true);
    try {
      // Absolute latest finished session — ignore history filters.
      const recent = await PracticeService.listRecentFinished(ctx, 1);
      const latestRow = recent[0];
      if (!latestRow) {
        toast.message("Complete a practice session first");
        return;
      }
      const latest = mapSessionToHistoryRow(latestRow);
      const session = await PracticeService.getSession(ctx, latest.id);
      const snap = buildPracticeAnalysisSnapshot({
        subject: session?.subject ?? latest.subject,
        chapter: session?.chapter ?? latest.chapter,
        practiceMode: session?.practice_mode ?? latest.practiceMode,
        practiceTypeLabel: latest.practiceType,
        difficulty: session?.difficulty ?? latest.difficulty,
        questionCount: session?.question_count ?? latest.qs,
        correctCount: session?.correct_count ?? latest.score,
        wrongCount: session?.wrong_count ?? undefined,
        skippedCount: session?.skipped_count ?? undefined,
        accuracy: session?.accuracy ?? latest.pct,
        xpEarned: session?.xp_earned ?? latest.xp,
        totalTimeMs: session?.total_time_ms ?? null,
        finishedAt: session?.finished_at ?? latest.finishedAt,
        startedAt: session?.created_at ?? null,
      });
      const res = await PracticeService.saveSession(ctx, latest.id, snap as unknown as Record<string, unknown>);
      if (res.already_saved) toast.message("Session already saved");
      else toast.success("Session saved");
      setHistoryTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save session");
    } finally {
      setSavingLatest(false);
    }
  }

  function handleFinish(res: SessionResults) {
    setHistoryTick((t) => t + 1);
    if (res.sessionId) {
      const chapter = res.config.chapter || res.attempts[0]?.chapter || res.config.label;
      persistAndGoToPracticeResult(navigate, res.sessionId, {
        subject: res.config.subject,
        chapter: String(chapter),
        attempts: res.attempts,
        startedAt: res.startedAt,
        serverStats: res.serverStats ?? null,
      });
      return;
    }
    setResults(res);
    setPhase("summary");
  }

  function handleRetry() {
    if (!config) return;
    setPhase("session");
  }

  return (
    <>
      {classUnresolved && (
        <div className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">
          {classUnresolvedMessage}
        </div>
      )}
      {phase === "hub" && (
        <Hub
          onMode={handleMode}
          history={history}
          saved={saved}
          incomplete={incomplete}
          streak={streak}
          onOpenSession={openSessionAnalysis}
          onResumeSession={(id) => void resumeSession(id)}
          onSaveLatest={() => void saveLatestSession()}
          savingLatest={savingLatest}
          historyFilters={historyFilters}
          onHistoryFilters={(next) => setHistoryFilters((prev) => ({ ...prev, ...next }))}
          subjects={subjects}
        />
      )}
      {phase === "config"  && (
        <ConfigView
          modeKey={modeKey}
          onStart={handleConfigStart}
          onBack={() => setPhase("hub")}
          subjects={subjects}
          onNavigate={setPage}
          classUnresolved={classUnresolved}
          classUnresolvedMessage={classUnresolvedMessage}
        />
      )}
      {phase === "session" && config && (
        <Session
          config={config}
          onFinish={handleFinish}
          onBack={() => setPhase("hub")}
          onNavigate={setPage}
          subjects={subjects}
          classUnresolved={classUnresolved}
          classUnresolvedMessage={classUnresolvedMessage}
        />
      )}
      {phase === "summary" && results && (
        <Summary results={results} onRetry={handleRetry} onHub={() => setPhase("hub")}/>
      )}
    </>
  );
}
