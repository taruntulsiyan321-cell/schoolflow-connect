import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { useGurukulAcademicIdentity, useGurukulShellReady, useGurukulStudent } from "@/gurukul/StudentContext";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, PracticeService, RecoveryEngineService, WEAK_CONCEPT_THRESHOLD, type CurriculumScope } from "@/academic";
import type { PracticeSessionRow } from "@/academic";
import { attemptsToFinishPayload, persistAndGoToPracticeResult } from "@/lib/practiceSessionSnapshot";
import type { PracticeAttemptSnapshot } from "@/lib/practiceSessionSnapshot";
import { toast } from "sonner";
import {
  displayChapter,
  displaySubject,
  isPlaceholderAcademicLabel,
  presentAcademicLabel,
} from "@/lib/academicPresentation";
import {
  formatSessionAccuracy,
  formatSessionDuration,
  formatSessionXp,
  resolvePracticeSessionStats,
} from "@/lib/practiceSessionStats";
import { PRACTICE_HISTORY_WINDOW_DAYS, type AcademicTermRef, type AttemptVerdict } from "@/academic/services/practiceService";
import { DifficultyBadge, EmptyState, GlassCard, PageHeader, ProgressBar, SubjectBadge, cn } from "@/gurukul/components/shared";
import { ListFailed, ListLoading, OptionChips, SubjectPicker, type PracticeSubject } from "@/gurukul/components/PracticeLists";
import { CustomPracticeUpload } from "@/gurukul/components/CustomPracticeUpload";
import {
  StudentUploadService,
  UPLOAD_MODE_LABELS,
  type StudentUploadRow,
  type UploadPracticeMode,
} from "@/academic/services/studentUploadService";
import { listCaptureQuestionsByIds } from "@/academic/services/screenCaptureService";
import { EMPTY_LIST, LOADING_LIST, listItems, type ListState } from "@/lib/listState";
import { withAlpha } from "@/lib/colorAlpha";
import { MathText } from "@/components/MathText";
import {
  BookOpen, Clock, Target,
  BarChart2, Search,
  ChevronRight, CheckCircle2, XCircle, ArrowLeft, Play, SkipForward,
  Flame, Layers,
  Save, Bookmark, BookMarked, Lightbulb,
  RotateCcw, HelpCircle, TrendingDown, FileText, AlertCircle, Filter,
} from "lucide-react";
import { toErrorMessage } from "@/lib/presentation";
import { ACCURACY_PROCEDURAL, ACCURACY_CONCEPTUAL, ACCURACY_BUILDING } from "@/academic/metrics/bands";
import { pluralise } from "@/lib/plural";
import { PRACTICE_MODE_LABELS, practiceModeLabel } from "@/lib/practiceModeLabel";
import {
  CLASS_UNRESOLVED_MSG,
  resolvePracticeUnresolved,
} from "@/gurukul/pages/practiceUnresolvedCopy";

/* A `PremiumEmpty` component stood here — the fourth of five ways this panel
   drew an empty state, and it was never called once. Removed 2026-09-11 with
   the `.premium-empty` CSS it was the last reason to keep. Use EmptyState from
   components/shared. */

// ── Types ────────────────────────────────────────────────────────────────────
type Phase   = "hub" | "config" | "session" | "saveFailed";
type Cat     = "all" | "content" | "source" | "type" | "targeted";
/**
 * The nine modes a student can pick, plus "recovery" and "revision".
 *
 * Those two are deliberately NOT in MODES: they have no hub tile because
 * nobody chooses them — Recovery builds the §4.2 ladder, and the revision
 * schedule builds the §5.4 check, and each hands the session over. They are in
 * the union so the session handed over is RECORDED as what it is. Recovery
 * used to borrow "weak" and showed up in history as "Weak Areas Practice"; a
 * revision check borrowed "chapter" and showed up as "Chapter Practice" — each
 * a different thing a student can actually start.
 *
 * Everything that looks a mode up in MODES must therefore tolerate a miss —
 * see the `Config` component, which is never rendered for either but does not
 * assert its way out of that.
 */
type ModeKey = keyof typeof PRACTICE_MODE_LABELS;

interface Mode {
  key: ModeKey; label: string; desc: string;
  icon: React.ReactNode; color: string; cat: Cat;
  badge: string; instant?: boolean; hot?: boolean;
}

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "hsl(var(--primary))",
  Math: "hsl(var(--primary))",
  Accountancy: "hsl(var(--success))",
  "Business Studies": "hsl(var(--warning))",
  Economics: "hsl(var(--primary-glow))",
  Physics: "hsl(var(--info))",
  Chemistry: "hsl(var(--primary-glow))",
  Biology: "hsl(var(--success))",
  English: "hsl(var(--warning))",
  Hindi: "hsl(var(--destructive))",
  Science: "hsl(var(--info))",
  "Social Science": "hsl(var(--warning))",
};
const FALLBACK_COLORS = ["hsl(var(--primary))", "hsl(var(--info))", "hsl(var(--primary-glow))", "hsl(var(--success))", "hsl(var(--warning))"];

function subjectColor(name: string, index: number) {
  return SUBJECT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/**
 * A QUESTION, AS A STUDENT MAY HOLD IT. No bank `correct` / `explanation`.
 *
 * Bank rows omit the key on purpose (fetched and graded server-side). Private
 * upload / capture rows already expose correct_index to the owner via RLS; the
 * attempt RPC trusts client `_is_correct` when there is no bank id, so those
 * keys travel here only so Custom Practice and Incorrect mode can grade
 * honestly. Never map them onto bank questions.
 */
type BankQuestion = {
  id: string;
  subject: string; chapter: string; difficulty: string;
  question: string; options: string[];
  /** Spec §2.1 / §9 — private upload question; never a question_bank id. */
  fromUpload?: boolean;
  /** Screen-capture-mistakes-spec §7.4 — private capture; never a bank id. */
  fromCapture?: boolean;
  /** Spec §6 — answer key came from the AI, not the file. */
  aiAnswered?: boolean;
  /** Spec §5.1 — real chapters.id when tagged; null when untagged. */
  chapterId?: string | null;
  /** Spec §9.1 — student_uploads.id when fromUpload (Incorrect + Custom). */
  uploadId?: string | null;
  /** Private rows only — owner-readable key for non-bank grading. */
  correctIndex?: number | null;
  /** Private rows only — shown when the verdict has no bank explanation. */
  explanation?: string | null;
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

type BankTopic = AcademicTermRef & { chapter: string | null };

type HistoryRow = {
  id: string;
  date: string;
  /** The row's heading: its chapter, or its practice type when it has none. */
  title: string;
  practiceType: string;
  /** Empty for a session with no single subject (the targeted modes). */
  subject: string;
  difficulty: string;
  qs: number;
  /** Over answered questions; null when nothing was answered. */
  accuracy: number | null;
  time: string;
  /** Display string — em dash when XP not yet credited by Progression Engine. */
  xpLabel: string;
  finishedAt: string | null;
  practiceMode: string | null;
  saved: boolean;
};

/**
 * A YYYY-MM-DD the student picked, as the instants bounding THEIR day — never
 * the UTC day, which in India starts at 05:30.
 */
function localDayBounds(day: string): { dateFrom: string; dateTo: string } {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const next = new Date(y, m - 1, d + 1);
  return { dateFrom: start.toISOString(), dateTo: new Date(next.getTime() - 1).toISOString() };
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

// ── Static data ──────────────────────────────────────────────────────────────
// Exactly nine modes. Daily, Teacher Assigned, Timed, Untimed and Mock Tests
// were removed: a time limit is now a Custom Practice goal rather than its own
// mode. Only the Mock Tests entry point is gone — the teacher test system it
// used is untouched and still serves teacher-assigned tests elsewhere.
const MODES: Mode[] = [
  { key:"subject",    label:PRACTICE_MODE_LABELS.subject,       desc:"Practice questions from a subject of your choice",
    icon:<BookOpen className="w-5 h-5"/>,   color:"hsl(var(--primary))", cat:"content",  badge:"By subject" },
  { key:"chapter",    label:PRACTICE_MODE_LABELS.chapter,       desc:"Focus on a specific chapter to reinforce concepts",
    icon:<Layers className="w-5 h-5"/>,     color:"hsl(var(--info))", cat:"content",  badge:"Chapter" },
  { key:"topic",      label:PRACTICE_MODE_LABELS.topic,         desc:"Drill down to a precise concept or sub-topic",
    icon:<Target className="w-5 h-5"/>,     color:"hsl(var(--success))", cat:"content",  badge:"By topic" },
  { key:"custom",     label:PRACTICE_MODE_LABELS.custom,        desc:"Choose difficulty and either a question count or a time limit",
    icon:<BarChart2 className="w-5 h-5"/>,  color:"hsl(var(--info))", cat:"type",    badge:"Your rules" },
  { key:"pyq",        label:PRACTICE_MODE_LABELS.pyq,desc:"Board and competitive exam questions from past years",
    icon:<FileText className="w-5 h-5"/>,   color:"hsl(var(--destructive))", cat:"source",  badge:"Past papers" },
  { key:"weak",       label:PRACTICE_MODE_LABELS.weak,    desc:`Auto-generated from concepts where your confidence is below ${WEAK_CONCEPT_THRESHOLD}%`,
    icon:<TrendingDown className="w-5 h-5"/>, color:"hsl(var(--destructive))", cat:"targeted", badge:"Weak areas", instant:true, hot:true },
  { key:"incorrect",  label:PRACTICE_MODE_LABELS.incorrect,    desc:"Reattempt questions you got wrong in previous sessions",
    icon:<XCircle className="w-5 h-5"/>,    color:"hsl(var(--destructive))", cat:"targeted", badge:"Retry wrong", instant:true },
  { key:"skipped",    label:PRACTICE_MODE_LABELS.skipped,      desc:"Solve questions you chose to skip earlier",
    icon:<SkipForward className="w-5 h-5"/>, color:"hsl(var(--warning))", cat:"targeted", badge:"Skipped", instant:true },
  { key:"bookmarked", label:PRACTICE_MODE_LABELS.bookmarked,   desc:"Questions you bookmarked — they stay until you remove them",
    icon:<BookMarked className="w-5 h-5"/>, color:"hsl(var(--info))", cat:"targeted", badge:"Bookmarked", instant:true },
];

const CATS: { key: Cat; label: string }[] = [
  { key:"all",      label:"All Modes" },
  { key:"content",  label:"By Content" },
  { key:"source",   label:"By Source" },
  { key:"type",     label:"By Type" },
  { key:"targeted", label:"Targeted" },
];


function mapSessionToHistoryRow(row: PracticeSessionRow): HistoryRow {
  // The finished row is the record (a saved snapshot is a frozen copy of it,
  // and would be the stale one if the row were ever corrected).
  const stats = resolvePracticeSessionStats(row);
  const practiceType = practiceModeLabel(row.practice_mode);
  const difficultyRaw = row.difficulty || "mixed";
  return {
    id: row.id,
    date: formatSessionDate(row.finished_at ?? row.created_at),
    title: row.chapter ? displayChapter(String(row.chapter)) : practiceType,
    practiceType,
    subject: row.subject ? displaySubject(row.subject) : "",
    difficulty: presentAcademicLabel(String(difficultyRaw)) || String(difficultyRaw),
    qs: stats.questionCount,
    accuracy: stats.accuracy,
    time: formatSessionDuration(stats.totalTimeMs),
    xpLabel: formatSessionXp(stats.xpEarned, stats.xpFromDb),
    finishedAt: row.finished_at,
    practiceMode: row.practice_mode ?? null,
    saved: Boolean(row.saved_at),
  };
}

/** History tint: by accuracy band; neutral when nothing was answered. */
function accuracyTint(accuracy: number | null): string {
  if (accuracy == null) return "hsl(var(--muted-foreground))";
  if (accuracy >= ACCURACY_CONCEPTUAL) return "hsl(var(--success))";
  if (accuracy >= ACCURACY_BUILDING) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

const DIFFICULTIES = [
  { key:"easy",   label:"Easy",   color:"hsl(var(--success))", desc:"Foundation level — build confidence" },
  { key:"medium", label:"Medium", color:"hsl(var(--warning))", desc:"Board exam level — solid preparation" },
  { key:"hard",   label:"Hard",   color:"hsl(var(--destructive))", desc:"Competitive level — push your limits" },
  { key:"mixed",  label:"Mixed",  color:"hsl(var(--info))", desc:"Varied — best for overall practice" },
];

// ── Shared components ────────────────────────────────────────────────────────
function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color, background:`${withAlpha(color, 0.08)}`, border:`1px solid ${withAlpha(color, 0.15)}` }}>
      {children}
    </span>
  );
}

// ── Hub view ─────────────────────────────────────────────────────────────────
// Exported for PracticeLists.test.tsx.
export function Hub({
  onMode,
  historyList,
  savedList,
  onRetryHistory,
  streak,
  onOpenSession,
  onSaveLatest,
  savingLatest,
  historyFilters,
  onHistoryFilters,
  subjects,
}: {
  onMode: (key: ModeKey) => void;
  historyList: ListState<HistoryRow>;
  savedList: ListState<HistoryRow>;
  onRetryHistory: () => void;
  streak: number;
  onOpenSession: (id: string) => void;
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

  // Subject, type and date are filtered by the server (listHistory); only the
  // free-text search runs here, over what came back.
  const q = historyFilters.search.trim().toLowerCase();
  const history = listItems(historyList);
  const filteredHistory = q
    ? history.filter((h) => `${h.subject} ${h.title} ${h.practiceType} ${h.difficulty}`.toLowerCase().includes(q))
    : history;
  const anyFilter = Boolean(q || historyFilters.subject || historyFilters.practiceType || historyFilters.date);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Practice"
        subtitle={`${MODES.length} practice modes · Pick how you want to learn today`}
        action={
          streak > 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/20">
              <Flame className="w-4 h-4 text-warning"/>
              <span className="text-xs font-bold text-warning">{streak}-day streak</span>
            </div>
          ) : undefined
        }
      />

      {hot.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full bg-warning"/>
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Quick Start</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {hot.map(m => (
              <button key={m.key} type="button" onClick={() => onMode(m.key)}
                className="group text-left p-4 rounded-2xl border border-border/70 hover:border-border hover:bg-muted transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]">
                <div className="flex items-center gap-2 mb-2" style={{ color: m.color }}>
                  {m.icon}
                  <span className="text-sm font-bold text-foreground">{m.label}</span>
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-2">{m.desc}</div>
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
                  cat === c.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search modes…"
              className="pl-9 pr-3 py-2 rounded-xl bg-muted border border-border/70 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border w-full sm:w-48"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(m => (
            <button key={m.key} type="button" onClick={() => onMode(m.key)}
              className="group text-left p-4 rounded-2xl border border-border/70 hover:border-border hover:bg-muted transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]">
              <div className="flex items-start gap-2 mb-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background:`${withAlpha(m.color, 0.08)}`, color:m.color }}>
                  {m.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-foreground truncate">{m.label}</div>
                </div>
                {m.instant && (
                  <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5"
                    style={{ color:m.color, background:`${withAlpha(m.color, 0.08)}`, border:`1px solid ${withAlpha(m.color, 0.13)}` }}>
                    INSTANT
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed mb-3">{m.desc}</div>
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
              <HelpCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3"/>
              <div className="text-sm text-muted-foreground">No modes match your search</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-info"/>
              <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Saved Sessions</span>
            </div>
            <button
              type="button"
              disabled={savingLatest}
              onClick={onSaveLatest}
              className="flex items-center gap-1 text-[10px] text-primary hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-3 h-3"/> {savingLatest ? "Saving…" : "Save latest result"}
            </button>
          </div>
          <div className="space-y-2.5">
            {savedList.status === "loading" ? (
              <ListLoading />
            ) : savedList.status === "failed" ? (
              <ListFailed onRetry={onRetryHistory} />
            ) : savedList.items.length === 0 ? (
              <EmptyState
                variant="section"
                icon={<Bookmark className="w-5 h-5" />}
                title="No saved sessions yet"
                sub="Save a session from its results page, or use Save latest result above. Saved sessions stay here after history's week is up."
              />
            ) : savedList.items.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSession(s.id)}
                className="group w-full flex items-start gap-3 p-3 rounded-xl border border-border hover:border-border/80 hover:bg-muted transition-all text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center shrink-0 text-info">
                  <Save className="w-3.5 h-3.5"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-foreground truncate">{[s.subject, s.title].filter(Boolean).join(" · ")}</div>
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {[
                      // The title is already the type when the session has no
                      // chapter; saying it twice reads as a stutter.
                      s.title === s.practiceType ? null : s.practiceType,
                      formatSessionAccuracy(s.accuracy),
                      pluralise(s.qs, "question"),
                      `${s.xpLabel} XP`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5">{s.date}</div>
                </div>
                <Play className="w-3.5 h-3.5 text-muted-foreground group-hover:text-info transition-colors shrink-0 mt-1"/>
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-primaryGlow"/>
              <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Practice History</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors",
                showFilters ? "border-primaryGlow/40 text-primaryGlow" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Filter className="w-3 h-3"/> Filters
            </button>
          </div>

          {showFilters && (
            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              <div className="relative sm:col-span-2">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
                <input
                  value={historyFilters.search}
                  onChange={(e) => onHistoryFilters({ search: e.target.value })}
                  placeholder="Search subject, chapter, type…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-muted border border-border/70 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border"
                />
                <div className="mt-1.5 text-[10px] text-muted-foreground/70">
                  {historyFilters.date
                    ? "Sessions finished on the chosen day"
                    : `Sessions from the last ${PRACTICE_HISTORY_WINDOW_DAYS} days — pick a date to look further back`}
                </div>
              </div>
              <select
                value={historyFilters.subject}
                onChange={(e) => onHistoryFilters({ subject: e.target.value })}
                className="px-3 py-2 rounded-xl bg-muted border border-border/70 text-xs text-foreground focus:outline-none"
              >
                <option value="">All subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
              <select
                value={historyFilters.practiceType}
                onChange={(e) => onHistoryFilters({ practiceType: e.target.value })}
                className="px-3 py-2 rounded-xl bg-muted border border-border/70 text-xs text-foreground focus:outline-none"
              >
                <option value="">All practice types</option>
                {(Object.keys(PRACTICE_MODE_LABELS) as ModeKey[]).map((key) => (
                  <option key={key} value={key}>{PRACTICE_MODE_LABELS[key]}</option>
                ))}
              </select>
              <input
                type="date"
                value={historyFilters.date}
                onChange={(e) => onHistoryFilters({ date: e.target.value })}
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-muted border border-border/70 text-xs text-foreground focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {historyList.status === "loading" ? (
              <ListLoading />
            ) : historyList.status === "failed" ? (
              <ListFailed onRetry={onRetryHistory} />
            ) : filteredHistory.length === 0 ? (
              <EmptyState
                variant="section"
                icon={anyFilter ? <Filter className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                title={anyFilter ? "No sessions match these filters" : `No practice in the last ${PRACTICE_HISTORY_WINDOW_DAYS} days`}
                sub={
                  anyFilter
                    ? "Clear a filter to see the rest of your sessions."
                    : "Sessions you finish are listed here for a week. Save one to keep it longer, or pick a date to look further back."
                }
              />
            ) : filteredHistory.map(h => (
              <button
                key={h.id}
                type="button"
                onClick={() => onOpenSession(h.id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-border hover:bg-muted transition-all text-left"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background:`${withAlpha(accuracyTint(h.accuracy), 0.08)}`, color:accuracyTint(h.accuracy) }}>
                  <span className="text-xs font-black">{formatSessionAccuracy(h.accuracy)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-foreground truncate">{h.title}</span>
                    {h.saved && <Tag color="hsl(var(--info))">Saved</Tag>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {[
                      h.subject,
                      h.title !== h.practiceType ? h.practiceType : null,
                      h.difficulty,
                      pluralise(h.qs, "question"),
                      h.time,
                    ].filter(Boolean).join(" · ")}
                    {" · "}<span className="text-warning">{h.xpLabel} XP</span>
                  </div>
                  {/* The right-hand date column is hidden below sm, so on a
                      phone no row said when it was sat. */}
                  <div className="text-[10px] text-muted-foreground mt-0.5 sm:hidden">{h.date}</div>
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0 text-right hidden sm:block">{h.date}</div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0"/>
              </button>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ── Config views ─────────────────────────────────────────────────────────────
// Exported for PracticeLists.test.tsx, which drives it as a student would.
export function ConfigView({
  modeKey, onStart, onBack, subjectList, onRetrySubjects, classUnresolved, classUnresolvedMessage,
  examScoped = false,
}: {
  modeKey: ModeKey;
  onStart: (cfg: SessionConfig) => void;
  onBack: () => void;
  subjectList: ListState<PracticeSubject>;
  onRetrySubjects: () => void;
  classUnresolved?: boolean;
  classUnresolvedMessage?: string;
  examScoped?: boolean;
}) {
  // Not `!`. "recovery" and "revision" have no MODES entry by design, and
  // although both jump straight to the session phase and never render this screen, an
  // assertion that is only safe because of a control-flow accident elsewhere
  // is one refactor away from a blank page.
  const mode = MODES.find(m => m.key === modeKey) ?? MODES.find(m => m.key === "chapter")!;
  const { ctx, ready: academicReady } = useAcademicContext();

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
  const [chapterList,   setChapterList]   = useState<ListState<AcademicTermRef>>(LOADING_LIST);
  const [topicList,     setTopicList]     = useState<ListState<BankTopic>>(LOADING_LIST);
  // Each list's Try again reads that list again, and only that one: a shared
  // key re-ran the chapter read on a topic retry, which cleared the chapter
  // the student had picked.
  const [chapterReads,  setChapterReads]  = useState(0);
  const [topicReads,    setTopicReads]    = useState(0);

  useEffect(() => {
    setSelChapter(null);
    setChapterList(LOADING_LIST);
    if (!selSubject || !ctx || !academicReady) return;
    if (!["chapter", "topic", "custom"].includes(modeKey)) return;
    let cancelled = false;
    PracticeService.listBankChapters(ctx, { subject: selSubject }).then(
      (items) => { if (!cancelled) setChapterList({ status: "ready", items }); },
      () => { if (!cancelled) setChapterList({ status: "failed" }); },
    );
    return () => { cancelled = true; };
  }, [selSubject, ctx, academicReady, modeKey, chapterReads]);

  useEffect(() => {
    setSelTopic(null);
    setTopicList(LOADING_LIST);
    if (!selSubject || !ctx || !academicReady) return;
    if (!["topic", "custom"].includes(modeKey)) return;
    let cancelled = false;
    PracticeService.listBankTopics(ctx, { subject: selSubject, chapter: selChapter }).then(
      (items) => { if (!cancelled) setTopicList({ status: "ready", items }); },
      () => { if (!cancelled) setTopicList({ status: "failed" }); },
    );
    return () => { cancelled = true; };
  }, [selSubject, selChapter, ctx, academicReady, modeKey, topicReads]);

  // Previous Year Questions offers the years the bank actually holds for this
  // student and subject — never a run of calendar years (KNOWN_ISSUES 57). A
  // year picked for one subject is cleared when the subject changes, since the
  // next subject may not have it.
  const [pyqYears,      setPyqYears]      = useState<ListState<{ year: number; count: number }>>(LOADING_LIST);
  const [pyqReads,      setPyqReads]      = useState(0);
  useEffect(() => {
    setPyqYear(null);
    setPyqYears(LOADING_LIST);
    if (modeKey !== "pyq" || !ctx || !academicReady) return;
    let cancelled = false;
    PracticeService.listPyqYears(ctx, { subject: selSubject }).then(
      (items) => { if (!cancelled) setPyqYears({ status: "ready", items }); },
      () => { if (!cancelled) setPyqYears({ status: "failed" }); },
    );
    return () => { cancelled = true; };
  }, [selSubject, ctx, academicReady, modeKey, pyqReads]);

  const retryChapters = () => setChapterReads((k) => k + 1);
  const retryTopics = () => setTopicReads((k) => k + 1);
  const retryPyqYears = () => setPyqReads((k) => k + 1);

  // How many questions the current Custom selection would draw from. Counted
  // from the same pool the session draws (PracticeService.countBankPool), so
  // the number shown and the session started cannot disagree.
  const [poolCount, setPoolCount] = useState<
    { status: "loading" } | { status: "failed" } | { status: "ready"; count: number }
  >({ status: "loading" });
  useEffect(() => {
    if (modeKey !== "custom" || !ctx || !academicReady) return;
    let cancelled = false;
    setPoolCount({ status: "loading" });
    PracticeService.countBankPool(ctx, {
      subject: selSubject,
      chapter: selChapter,
      topic: selTopic,
      difficulty: selDifficulty,
    }).then(
      (count) => { if (!cancelled) setPoolCount({ status: "ready", count }); },
      () => { if (!cancelled) setPoolCount({ status: "failed" }); },
    );
    return () => { cancelled = true; };
  }, [modeKey, ctx, academicReady, selSubject, selChapter, selTopic, selDifficulty]);

  function handleStart() {
    // Custom Practice is the only mode with a time goal, and it is exclusive
    // with the question count.
    const useTimeGoal = modeKey === "custom" && goalType === "time";
    onStart({
      mode: modeKey,
      label: mode.label,
      subject: selSubject ?? "Mixed",
      // A topic belongs to one chapter, so a session started from a topic is
      // that chapter's session even when no chapter was picked first.
      chapter: selChapter ?? listItems(topicList).find((t) => t.id === selTopic)?.chapter ?? null,
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
    : examScoped
      ? "No subjects in the question bank yet for your exam."
      : "No subjects in the question bank yet for your class and board.";

  if (modeKey === "custom") {
    // Subject / chapter / topic are all optional here — only difficulty and a
    // goal are required. Individuals also get §1 upload intake (spec
    // docs/custom-practice-upload-spec.md); school students keep bank filters.
    const goalReady = goalType === "count" ? qCount > 0 : timeLimitMin > 0;

    function onUploadMode(upload: StudentUploadRow, mode: UploadPracticeMode) {
      // §8 — practise modes start with SessionConfig.upload. read_notes is
      // opened inside CustomPracticeUpload (toast / notes pane); never a session.
      // Subject stays empty here: per-question subject comes from
      // listForPractice → chapters→curriculum_subjects. "Mixed"/"General" are
      // placeholders Mistake Book drops (isPlaceholderAcademicLabel).
      if (mode === "read_notes") return;
      onStart({
        mode: "custom",
        label: UPLOAD_MODE_LABELS[mode],
        subject: "",
        chapter: null,
        topic: null,
        difficulty: "mixed",
        qCount: 50,
        timeLimitSec: null,
        upload: { uploadId: upload.id, practiseMode: mode },
      });
    }

    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          {examScoped && (
            <CustomPracticeUpload accentColor={mode.color} onSelectMode={onUploadMode} />
          )}

          <SubjectPicker
            selected={selSubject}
            onSelect={setSelSubject}
            list={subjectList}
            onRetry={onRetrySubjects}
            emptyMessage={subjectEmptyMsg}
            allowAll
            label={examScoped ? "Or practise from the bank — subject (optional)" : "1. Subject (optional)"}
          />
          {selSubject && (
            <OptionChips
              label="2. Chapter (optional)"
              list={chapterList}
              selected={selChapter}
              onSelect={setSelChapter}
              allowClear
              onRetry={retryChapters}
              empty="No chapters in the bank for this subject yet."
            />
          )}
          {/* Optional here, so a chapter with no tagged topics shows no list —
              but one still loading, or one that failed, says so. */}
          {selSubject && selChapter && (topicList.status !== "ready" || topicList.items.length > 0) && (
            <OptionChips
              label="3. Topic / concept (optional)"
              list={topicList}
              selected={selTopic}
              onSelect={setSelTopic}
              allowClear
              onRetry={retryTopics}
              empty="No topics tagged for this chapter yet."
            />
          )}

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Difficulty
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {DIFFICULTIES.map(d => (
                <button key={d.key} type="button" onClick={() => setSelDifficulty(d.key)}
                  className={cn(
                    "p-4 rounded-2xl border text-left transition-all",
                    selDifficulty === d.key ? "scale-[1.02]" : "border-border/70 hover:border-border"
                  )}
                  style={selDifficulty === d.key ? { borderColor:`${withAlpha(d.color, 0.25)}`, background:`${withAlpha(d.color, 0.06)}` } : {}}>
                  {/* The label reads in the theme's text colour; the card's border and
                      tint mark the selected one. It was a literal "white" (invisible
                      on the light theme), and a coloured label on its own tint would
                      read about 4.1:1 — measured on the feedback options. */}
                  <div className="text-sm font-black mb-1 text-foreground">{d.label}</div>
                  <div className="text-[11px] text-muted-foreground">{d.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
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
                    goalType === g.key ? "border-transparent" : "border-border/70 text-muted-foreground hover:border-border",
                  )}
                  style={goalType === g.key ? { background:`${withAlpha(mode.color, 0.09)}`, color:mode.color, borderColor:`${withAlpha(mode.color, 0.25)}` } : {}}
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
                      qCount === n ? "border-transparent" : "border-border/70 text-muted-foreground hover:border-border",
                    )}
                    style={qCount === n ? { background:`${withAlpha(mode.color, 0.09)}`, color:mode.color, borderColor:`${withAlpha(mode.color, 0.25)}` } : {}}>
                    {pluralise(n, "question")}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {[10, 20, 30, 45, 60].map(t => (
                  <button key={t} type="button" onClick={() => setTimeLimitMin(t)}
                    className={cn(
                      "px-5 py-3 rounded-xl text-sm font-black border transition-all",
                      timeLimitMin === t ? "border-transparent" : "border-border/70 text-muted-foreground hover:border-border",
                    )}
                    style={timeLimitMin === t ? { background:`${withAlpha(mode.color, 0.09)}`, color:mode.color, borderColor:`${withAlpha(mode.color, 0.25)}` } : {}}>
                    {t} min
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* WHAT THIS SELECTION HOLDS, BEFORE IT IS STARTED.
              Subject, chapter, topic and difficulty each narrow the bank, and
              every combination of them used to be offered — including the ones
              holding nothing. The student picked, pressed Start, waited for a
              session, and met "No questions match those filters yet" on a
              screen they could only leave. Measured on the live bank
              2026-09-23: 4 of 237 chapter-and-difficulty pairs at Class 10
              hold no question at all. */}
          <div aria-live="polite" data-testid="custom-pool-count">
            {poolCount.status === "loading" && (
              <p className="text-xs text-muted-foreground">Counting what matches…</p>
            )}
            {poolCount.status === "failed" && (
              <p className="text-xs text-muted-foreground">
                Could not count what matches. Start anyway — the session will say if it finds nothing.
              </p>
            )}
            {poolCount.status === "ready" && (
              <p className={cn("text-xs", poolCount.count === 0 ? "text-destructive" : "text-muted-foreground")}>
                {poolCount.count === 0
                  ? "Nothing in the bank matches those filters. Try a different difficulty, or clear one."
                  : `${pluralise(poolCount.count, "question")} match — a session takes up to ${goalType === "time" ? 50 : qCount}.`}
              </p>
            )}
          </div>
        </div>
        <StartButton
          disabled={!selDifficulty || !goalReady || (poolCount.status === "ready" && poolCount.count === 0)}
          onStart={handleStart}
        />
      </ConfigShell>
    );
  }

  if (modeKey === "pyq") {
    // Board and class come from the student's own profile; only subject and
    // year are chosen here, and the years are the ones the bank holds.
    const years = listItems(pyqYears);
    const inAllYears = years.reduce((n, y) => n + y.count, 0);
    const chip = (on: boolean) => ({
      className: cn(
        "px-4 py-2 rounded-xl text-sm font-bold border transition-all",
        on ? "border-transparent" : "border-border/70 text-muted-foreground hover:border-border",
      ),
      style: on ? { background:`${withAlpha(mode.color, 0.09)}`, color:mode.color, borderColor:`${withAlpha(mode.color, 0.25)}` } : {},
    });
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} list={subjectList} onRetry={onRetrySubjects} emptyMessage={subjectEmptyMsg} allowAll label="Subject"/>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Exam year</div>
            {pyqYears.status === "loading" && <ListLoading />}
            {pyqYears.status === "failed" && <ListFailed onRetry={retryPyqYears} />}
            {pyqYears.status === "ready" && years.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="pyq-none">
                No past-year papers have been added to the question bank for{" "}
                {selSubject ? displaySubject(selSubject) || selSubject : "your class"} yet, so there is nothing to practise here.
              </p>
            )}
            {years.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => setPyqYear(null)} {...chip(pyqYear === null)}>
                  All years · {inAllYears}
                </button>
                {years.map(y => (
                  <button key={y.year} type="button" onClick={() => setPyqYear(y.year)} {...chip(pyqYear === y.year)}>
                    {y.year} · {y.count}
                  </button>
                ))}
              </div>
            )}
          </div>
          {years.length > 0 && <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>}
        </div>
        <StartButton disabled={years.length === 0} onStart={handleStart}/>
      </ConfigShell>
    );
  }


  if (modeKey === "subject") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} list={subjectList} onRetry={onRetrySubjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="Choose subject"/>
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton disabled={!selSubject} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "chapter") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} list={subjectList} onRetry={onRetrySubjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="1. Subject"/>
          {selSubject && (
            <OptionChips
              label="2. Chapter"
              list={chapterList}
              selected={selChapter}
              onSelect={setSelChapter}
              onRetry={retryChapters}
              empty="No chapters in the bank for this subject yet."
            />
          )}
          {selChapter && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Difficulty</div>
              <div className="flex gap-2 flex-wrap">
                {DIFFICULTIES.map(d => (
                  <button key={d.key} onClick={() => setSelDifficulty(d.key)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all",
                      selDifficulty === d.key ? "bg-primary text-primary-foreground shadow-lg" : "border border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
                    )}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton disabled={!selSubject || !selChapter} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  if (modeKey === "topic") {
    return (
      <ConfigShell mode={mode} onBack={onBack}>
        <div className="space-y-6">
          <SubjectPicker selected={selSubject} onSelect={setSelSubject} list={subjectList} onRetry={onRetrySubjects} emptyMessage={subjectEmptyMsg} allowAll={false} label="1. Subject"/>
          {selSubject && (
            <OptionChips
              label="2. Chapter (optional)"
              list={chapterList}
              selected={selChapter}
              onSelect={setSelChapter}
              allowClear
              onRetry={retryChapters}
              empty="No chapters yet — pick a topic below if available."
            />
          )}
          {selSubject && (
            <OptionChips
              label="3. Topic / concept"
              list={topicList}
              selected={selTopic}
              onSelect={setSelTopic}
              onRetry={retryTopics}
              empty="No topics tagged in the bank for this selection yet."
            />
          )}
          <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
        </div>
        <StartButton disabled={!selSubject || !selTopic} onStart={handleStart}/>
      </ConfigShell>
    );
  }

  return (
    <ConfigShell mode={mode} onBack={onBack}>
      <div className="space-y-6">
        <SubjectPicker selected={selSubject} onSelect={setSelSubject} list={subjectList} onRetry={onRetrySubjects} emptyMessage={subjectEmptyMsg} allowAll/>
        <CountSlider value={qCount} onChange={setQCount} color={mode.color}/>
      </div>
      <StartButton onStart={handleStart}/>
    </ConfigShell>
  );
}

// Config shell wrapper
function ConfigShell({ mode, onBack, children }: {
  mode: Mode; onBack: ()=>void; children: React.ReactNode;
}) {
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4"/> Back to Practice
      </button>

      <GlassCard className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background:`${withAlpha(mode.color, 0.09)}`, color:mode.color }}>
            {mode.icon}
          </div>
          <div>
            <h2 className="text-xl font-black text-foreground" style={{fontFamily:"var(--font-display)"}}>{mode.label}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{mode.desc}</p>
          </div>
        </div>
        {children}
      </GlassCard>
    </div>
  );
}

// Question count slider
function CountSlider({ value, onChange, color }: { value:number; onChange:(v:number)=>void; color:string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Number of Questions</div>
        <span className="text-sm font-black tabular-nums" style={{color}}>{value}</span>
      </div>
      <input type="range" min={5} max={90} step={5} value={value} onChange={e => onChange(+e.target.value)}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: color }}/>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>5</span><span>90</span></div>
    </div>
  );
}

// Start button
// The one primary action on every setup screen. It wore the mode's colour
// as a fading gradient under the panel's dark text: 3.3:1, measured.
function StartButton({ disabled=false, onStart, label="Start Practice" }: {
  disabled?:boolean; onStart:()=>void; label?:string;
}) {
  return (
    <button onClick={onStart} disabled={disabled}
      className={cn(
        "w-full mt-6 py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all",
        disabled
          ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
          : "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 hover:scale-[1.02] active:scale-[0.99]"
      )}>
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
  /**
   * §5.4 — set when this session IS a revision check for that chapter.
   *
   * A revision check is not a separate kind of question-runner; it is a
   * practice session with a purpose, so it reuses this one rather than
   * standing up a second screen that would drift from it. What makes it a
   * check is where the score goes at the end: rpc_submit_revision_session,
   * which walks the weekly ladder and decides pass or fail server-side
   * against REVISION_PASS_THRESHOLD.
   *
   * ── WHY THIS CARRIES QUESTION IDS AND NOT JUST A CHAPTER ──────────────
   *
   * It used to be a bare chapter UUID, and the session then loaded questions
   * the ordinary way — by chapter name, from the bank. The ordinary loader has
   * no concept of "seen", so §5.4's "fresh questions… never seen by this
   * student. Never the old questions" was enforced by nothing at all. Measured:
   * 2 of 8 questions in a sampled check had already been answered by that
   * student, which makes the check a test of last week rather than of
   * retention.
   *
   * The contents are now decided by rpc_revision_session_plan, which can see
   * the student's whole attempt history, and they travel here as ids for the
   * same reason the recovery ladder does: the plan is not persisted, so a URL
   * could not carry it and re-deriving it here would drift from what the
   * student was actually shown.
   *
   * The chapter is a UUID, never a chapter name — §2, and the reason the old
   * revision_queue filled with rows pointing at 'Chapter 3'.
   */
  revision?: {
    chapterId: string;
    /** Their own misses first, then the unseen. Asked in this order. */
    questionIds: string[];
    /** How many of the above came from the student's mistake book. */
    mistakes: number;
    /** How many were genuinely new material. */
    fresh: number;
    /** Unseen questions the chapter could not supply — reported, never padded. */
    freshShort: number;
  } | null;
  /**
   * §4.2 — set when this session IS a recovery session.
   *
   * Recovery differs from every other mode in one way that matters: it is
   * scored per TIER, never as one total. tier 0 is the student's own wrong
   * questions, 1 the same question with different values, 2 the same concept
   * reframed, 3 the topic applied elsewhere — and §4.2b reads tiers 0+1 as
   * "can they run the procedure" against 2+3's "do they understand it". Two
   * rates, never blended. So the runner has to know which tier each question
   * came from, which `tierByQuestionId` carries.
   *
   * The ids come from rpc_start_recovery_session, which builds the ladder
   * bank-first. They are passed through router state rather than the URL: the
   * plan is not persisted server-side (recovery_sessions stores the tier
   * TOTALS, not which questions filled them), so re-deriving it here could
   * drift from what the session was opened against and score the student
   * against questions they were never asked.
   */
  recovery?: {
    sessionId: string;
    chapterId: string;
    /** Question id -> tier (bank, upload, or capture on tier 0). Order of keys is ask order. */
    tierByQuestionId: Record<string, 0 | 1 | 2 | 3>;
    /** False when generation could not fill every tier — the screen says so. */
    complete: boolean;
    shortfall: number;
  } | null;
  /**
   * Spec §8 / §9 — Custom Practice from the student's own upload.
   * When set, the session loads student_upload_questions only — never
   * question_bank — and attempts are written with source = 'upload'.
   */
  upload?: {
    uploadId: string;
    practiseMode: UploadPracticeMode;
  } | null;
}

/**
 * How a session ended. "left" is the student navigating away mid-session:
 * what they answered is still finished and counted — resuming was removed with
 * the v2 redesign, so an unfinished row could only ever sit there, holding
 * answers that earned nothing and appeared nowhere.
 */
type EndReason = "completed" | "ended" | "timed_out" | "left";

type BankRows = Awaited<ReturnType<typeof PracticeService.listBankQuestions>>;
type UploadPracticeRows = Awaited<ReturnType<typeof StudentUploadService.listForPractice>>;
type CapturePracticeRows = Awaited<ReturnType<typeof listCaptureQuestionsByIds>>;
/** Bank, private upload/capture, or a recovery mix. */
type SessionQuestionRows =
  | BankRows
  | UploadPracticeRows
  | CapturePracticeRows
  | Array<BankRows[number] | UploadPracticeRows[number] | CapturePracticeRows[number]>;

/** The questions a session asks, decided by its mode. */
async function loadSessionQuestions(
  ctx: NonNullable<ReturnType<typeof useAcademicContext>["ctx"]>,
  config: SessionConfig,
): Promise<SessionQuestionRows> {
  // Spec §2.1 / §8 / §9 — an upload session never touches question_bank.
  if (config.upload) {
    return StudentUploadService.listForPractice(
      ctx,
      config.upload.uploadId,
      config.upload.practiseMode,
      config.qCount,
    );
  }
  const difficulty = config.difficulty || "mixed";
  if (config.recovery) {
    // §4.2 — the ladder is already built. Load exactly the questions
    // rpc_start_recovery_session chose, in tier order, and nothing else:
    // topping the session up from the bank would put questions into it that no
    // tier accounts for, and the per-tier score would then be taken over a
    // different set than the totals recorded at start.
    // Spec §9 / migration 720+770 — tier 0 may carry upload or capture originals.
    const tierOf = config.recovery.tierByQuestionId;
    const ids = Object.keys(tierOf);
    const [bankRows, uploadRows, captureRows] = await Promise.all([
      PracticeService.listBankQuestions(ctx, { ids, limit: ids.length }),
      StudentUploadService.listByIds(ctx, ids),
      listCaptureQuestionsByIds(ctx, ids),
    ]);
    const byId = new Map<
      string,
      (typeof bankRows)[number] | (typeof uploadRows)[number] | (typeof captureRows)[number]
    >();
    for (const r of bankRows) byId.set(r.id, r);
    for (const r of uploadRows) byId.set(r.id, r);
    for (const r of captureRows) byId.set(r.id, r);
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => (tierOf[a.id] ?? 0) - (tierOf[b.id] ?? 0));
  }
  if (config.revision) {
    // §5.4 — the check is already built by a server function that can see this
    // student's whole attempt history. Exactly those questions, in that order
    // (their own misses first), and nothing else: topping up from the bank is
    // how already-seen questions got into a check meant to contain none.
    const ids = config.revision.questionIds;
    const byId = new Map((await PracticeService.listBankQuestions(ctx, { ids, limit: ids.length })).map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r != null);
  }
  switch (config.mode) {
    case "incorrect":
      return PracticeService.listMistakeQuestions(ctx, { limit: config.qCount });
    case "skipped":
      return PracticeService.listSkippedBankQuestions(ctx, { limit: config.qCount });
    case "bookmarked":
      return PracticeService.listBookmarkedQuestions(ctx, { limit: config.qCount });
    case "weak": {
      // Practice Engine owns this mode, so it reads V1 confidence.
      // Recovery/Revision/Nova keep reading the legacy weighted score.
      const weak = await PracticeService.listWeakConcepts(ctx, { source: "simple", limit: 12 });
      if (weak.length === 0) return [];
      return PracticeService.listBankQuestions(ctx, {
        difficulty,
        limit: config.qCount,
        weakTargets: weak.map((w) => ({ subject: w.subject, chapter: w.chapter, concept: w.concept })),
      });
    }
    case "pyq":
      return PracticeService.listBankQuestions(ctx, {
        subject: config.subject,
        difficulty,
        limit: config.qCount,
        pyqOnly: true,
        examYear: config.pyqYear ?? null,
      });
    default:
      // config.topic is a topic id from the picker, or a topic NAME from a
      // ?topic= link; listBankQuestions narrows each its own way.
      return PracticeService.listBankQuestions(ctx, {
        subject: config.subject,
        chapter: config.chapter,
        topic: config.topic,
        difficulty,
        limit: config.qCount,
      });
  }
}

/**
 * Finish a session on the server and hand its result to the engine that asked
 * for it. Used by the session itself and by "Try saving again".
 *
 * Throws only when the finish fails — that is the one failure that means the
 * session was not recorded. A recovery or revision submit that fails is
 * reported on its own: the practice is saved by then, and the chapter simply
 * stays where it was, which is the honest outcome of an unrecorded check.
 *
 * NEITHER SUBMIT SENDS A SCORE. The server counts each recovery tier, and a
 * revision check, from the answers given to that session's own questions,
 * having graded every one against the bank. A client-sent score once let a
 * chapter be marked recovered with nothing answered.
 */
async function completeSession(
  ctx: NonNullable<ReturnType<typeof useAcademicContext>["ctx"]>,
  config: SessionConfig,
  sessionId: string,
  attempts: PracticeAttemptSnapshot[],
  reason: EndReason,
): Promise<Pick<SessionResults, "serverStats" | "recovery" | "revision">> {
  const fin = ((await PracticeService.finish(ctx, {
    _session_id: sessionId,
    _attempts: attemptsToFinishPayload(attempts),
    _ended_by_user: reason === "ended" || reason === "left",
    _ended_normally: reason !== "left",
  })) ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: Pick<SessionResults, "serverStats" | "recovery" | "revision"> = {
    serverStats: {
      questionCount: num(fin.total),
      correctCount: num(fin.correct_count),
      wrongCount: num(fin.wrong_count),
      skippedCount: num(fin.skipped_count),
      // The finish stores NULL when nothing was answered; keep it null.
      accuracy: fin.accuracy == null ? null : num(Number(fin.accuracy)) ?? null,
      xpEarned: num(fin.xp_earned),
      totalTimeMs: num(fin.total_time_ms) ?? null,
    },
  };
  if (reason === "left") return out;
  if (config.recovery) {
    try {
      out.recovery = await RecoveryEngineService.submitRecoverySession(ctx, config.recovery.sessionId, sessionId);
    } catch (e) {
      toast.error(toErrorMessage(e, "Practice saved, but the recovery result was not recorded"));
    }
  }
  if (config.revision) {
    try {
      out.revision = await RecoveryEngineService.submitRevisionSession(ctx, config.revision.chapterId, sessionId);
    } catch (e) {
      toast.error(toErrorMessage(e, "Practice saved, but the revision check was not recorded"));
    }
  }
  return out;
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
  // WHAT THE SERVER SAID. Null until the attempt has been recorded, which is
  // also the first moment this browser is allowed to know the answer.
  const [verdict,   setVerdict]   = useState<AttemptVerdict | null>(null);
  const [correct,   setCorrect]   = useState(0);
  const [answered,  setAnswered]  = useState(0);
  const [bookmarked,setBookmarked]= useState<number[]>([]);
  const [timeLeft,  setTimeLeft]  = useState(config.timeLimitSec ?? 0);
  const [finishing, setFinishing] = useState(false);
  /** Spec §6.1 — dispute in flight for this upload question id. */
  const [disputingId, setDisputingId] = useState<string | null>(null);
  /** Spec §6.1 — upload question ids already successfully disputed this session. */
  const [disputedIds, setDisputedIds] = useState<Set<string>>(() => new Set());
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const loadedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<string | undefined>(undefined);
  const deadlineRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const correctRef = useRef(0);
  const skippedRef = useRef(0);
  const bookmarkedRef = useRef<number[]>([]);
  const attemptLog = useRef<PracticeAttemptSnapshot[]>([]);
  const finishedRef = useRef(false);
  /** Answers already sent by a "left" finish; a later leave sends only if there are more. */
  const leftWithRef = useRef(0);
  const questionStartRef = useRef<number>(Date.now());
  const attemptNumberRef = useRef(0);
  /**
   * Answers still on their way to the server. The finish waits for them, so
   * the roll-up it reads includes them; the server also serialises writes per
   * session (20261039300000), which is what actually stops an answer being
   * recorded twice when the two cross.
   */
  const pendingWrites = useRef(new Set<Promise<unknown>>());
  /** Answers whose live write the server confirmed. A page exit resends the rest. */
  const confirmedRef = useRef(new Set<PracticeAttemptSnapshot>());
  /**
   * The signed-in session's token, current on every render. A page that is
   * going away cannot wait for getSession(); the exit request needs it now.
   */
  const { session: authSession } = useAuth();
  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = authSession?.access_token ?? null;

  useEffect(() => {
    if (loadedRef.current) return;
    if (!ctx || !academicReady) {
      // Academic context is still initializing — a normal ~1s state on every
      // fresh mount, not a failure. Only if it genuinely never arrives is it an
      // error, after a bounded wait.
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
        if (classUnresolved) {
          setLoadError(classUnresolvedMessage ?? CLASS_UNRESOLVED_MSG);
          return;
        }
        const rows = await loadSessionQuestions(ctx, config);
        if (cancelled) return;
        const mapped = rows
          .map((r): BankQuestion | null => {
            const options = parseBankOptions(r.options);
            if (!r.id || !r.question || options.length < 2) return null;
            const fromUpload = "from_upload" in r && r.from_upload === true;
            const fromCapture = "from_capture" in r && r.from_capture === true;
            const privateQ = fromUpload || fromCapture;
            const correctRaw =
              privateQ && "correct_index" in r ? (r as { correct_index?: unknown }).correct_index : null;
            const correctIndex =
              typeof correctRaw === "number" && Number.isInteger(correctRaw) ? correctRaw : null;
            // Private rows must carry a usable key — the attempt RPC trusts
            // client is_correct when bank_question_id is null.
            if (privateQ && correctIndex == null) return null;
            const explanation =
              privateQ && "explanation" in r
                ? ((r as { explanation?: string | null }).explanation ?? null)
                : null;
            const uploadId =
              fromUpload && "upload_id" in r
                ? ((r as { upload_id?: string | null }).upload_id ?? null)
                : null;
            return {
              id: r.id,
              subject: r.subject || "",
              chapter: r.chapter || "",
              difficulty: r.difficulty || "medium",
              question: r.question,
              options,
              fromUpload,
              fromCapture,
              aiAnswered: fromUpload && "ai_answered" in r ? Boolean(r.ai_answered) : false,
              chapterId: "chapter_id" in r ? (r.chapter_id ?? null) : null,
              uploadId,
              correctIndex: privateQ ? correctIndex : null,
              explanation: privateQ ? explanation : null,
            };
          })
          .filter((x): x is BankQuestion => x !== null);

        // The session row is created only once there is something to sit. It
        // used to be created first and, when the mode had nothing, finished
        // straight away — a "Completed · 0 questions" entry in history for
        // every empty tap.
        if (mapped.length > 0) {
          // A recovery ladder and a revision check are each ONE chapter's
          // questions, so the row names that chapter and its subject — read
          // off the questions themselves. They were started as subject
          // "Mixed", chapter null, so all 13 recovery sessions and 7 checks
          // on record said nothing of what they were for: history could not
          // name the chapter, and its subject filter never found them.
          const onlyOne = (vals: string[]) => {
            const distinct = [...new Set(vals.filter(Boolean))];
            return distinct.length === 1 ? distinct[0] : null;
          };
          // Upload: name the session from tagged questions when they agree —
          // never "Mixed"/"General" (Mistake Book / RPC placeholder defaults).
          const engineSession = Boolean(config.recovery || config.revision || config.upload);
          const sid = await PracticeService.start(ctx, {
            _subject: engineSession
              ? onlyOne(mapped.map((q) => q.subject)) ?? ""
              : config.subject === "Mixed" ? "" : config.subject,
            // A topic belongs to one chapter, and the picker resolved it.
            _chapter: engineSession ? onlyOne(mapped.map((q) => q.chapter)) : config.chapter || null,
            _count: mapped.length,
            _practice_mode: config.mode,
            _difficulty: config.difficulty,
            _time_limit_sec: config.timeLimitSec,
          });
          if (cancelled) return;
          sessionIdRef.current = sid;
          startedAtRef.current = new Date().toISOString();
        }
        loadedRef.current = true;
        setQs(mapped);
        // Bookmarked Questions loads only questions already bookmarked, so the
        // toggle starts ON — or its first tap is a no-op "set bookmarked=true"
        // and the question can never be un-bookmarked from within this mode.
        if (config.mode === "bookmarked") {
          bookmarkedRef.current = mapped.map((_, i) => i);
          setBookmarked(bookmarkedRef.current);
        }
        questionStartRef.current = Date.now();
        if (config.timeLimitSec) deadlineRef.current = Date.now() + config.timeLimitSec * 1000;
      } catch (e) {
        if (!cancelled) setLoadError(toErrorMessage(e, "Could not start practice"));
      } finally {
        if (!cancelled) setLoadingQs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady, config, classUnresolved, classUnresolvedMessage]);

  // The latest finish, for callbacks created by an earlier render: the clock
  // and the leave handler. The clock used to call the finish it was created
  // with, which saw the first question as the one on screen, so the question
  // actually on screen when time ran out was recorded with no time at all.
  const finishRef = useRef<(reason: EndReason) => Promise<void>>(async () => {});

  // A deadline, not a countdown: a background tab runs its intervals late, and
  // decrementing once per tick let a ten-minute goal run for as long as the tab
  // was hidden.
  useEffect(() => {
    if (!config.timeLimitSec || loadingQs || qs.length === 0) return;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline == null) return;
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        void finishRef.current("timed_out");
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [config.timeLimitSec, loadingQs, qs.length]);

  // Leaving mid-session ends it with what was answered. In-app navigation
  // unmounts this, and the ordinary finish runs — the page is still there to
  // complete it. Closing the tab or pressing Back out of the app fires
  // pagehide instead, and that page is going away: an ordinary request would
  // be cancelled with it, and so would the answer still being written. The
  // exit sends the same finish as a request that outlives the page.
  const exitRef = useRef<() => void>(() => {});
  exitRef.current = () => {
    const sid = sessionIdRef.current;
    const token = accessTokenRef.current;
    if (finishedRef.current || !sid || !token) return;
    if (attemptLog.current.length <= leftWithRef.current) return;
    leftWithRef.current = attemptLog.current.length;
    const unconfirmed = attemptLog.current.filter((a) => !confirmedRef.current.has(a));
    PracticeService.finishOnPageExit({ sessionId: sid, attempts: attemptsToFinishPayload(unconfirmed), accessToken: token });
  };
  useEffect(() => {
    const leave = () => { void finishRef.current("left"); };
    const exit = () => exitRef.current();
    window.addEventListener("pagehide", exit);
    return () => {
      window.removeEventListener("pagehide", exit);
      leave();
    };
  }, []);

  function snapshotOf(q: BankQuestion, fields: {
    selectedIndex: number; isCorrect: boolean; skipped: boolean; timedOut?: boolean; solutionViewed?: boolean;
  }): PracticeAttemptSnapshot {
    // Spec §9.1 — upload attempts: source = 'upload', source_id = upload id,
    // bank_question_id null (private rows are not in question_bank).
    // Screen-capture §7.4 — same shape with source = 'screen_capture'.
    // Subject/chapter come from the question (curriculum_subjects via chapter),
    // never session placeholders Mixed/General.
    const fromUpload = Boolean(q.fromUpload);
    const fromCapture = Boolean(q.fromCapture);
    const privateQ = fromUpload || fromCapture;
    return {
      question: q.question,
      options: q.options,
      // Unknown here for bank questions — the server grades and fills in.
      // Private upload/capture: answer() may set correctIndex / isCorrect
      // before record, because the RPC trusts client _is_correct without a bank id.
      correctIndex: -1,
      explanation: undefined,
      bankQuestionId: privateQ ? null : q.id,
      uploadQuestionId: fromUpload ? q.id : null,
      captureQuestionId: fromCapture ? q.id : null,
      subject: q.subject,
      chapter: q.chapter,
      chapterId: q.chapterId ?? null,
      difficulty: q.difficulty,
      source: fromUpload ? "upload" : fromCapture ? "screen_capture" : "practice",
      practiceMode: config.mode,
      // Spec §9.1 — upload attempts carry the upload id, including Incorrect
      // mode reattempts where config.upload is unset.
      sourceId: fromUpload
        ? (q.uploadId ?? config.upload?.uploadId ?? null)
        : fromCapture
          ? q.id
          : sessionIdRef.current,
      timeTakenMs: Date.now() - questionStartRef.current,
      solutionViewed: false,
      attemptNumber: ++attemptNumberRef.current,
      answeredAt: new Date().toISOString(),
      schoolId: ctx?.schoolId ?? null,
      ...fields,
    };
  }

  /** The snapshot of the question on screen, so a late verdict cannot mark the next question. */
  const onScreenRef = useRef<PracticeAttemptSnapshot | null>(null);

  function record(snap: PracticeAttemptSnapshot, onVerdict?: (v: AttemptVerdict) => void) {
    attemptLog.current.push(snap);
    const write = persistAttemptLive(snap).then((v) => {
      if (!v) return;
      confirmedRef.current.add(snap);
      // What the server found is what this session's record says from now on:
      // the summary and the review read these snapshots.
      snap.isCorrect = v.isCorrect;
      if (v.correctIndex != null) snap.correctIndex = v.correctIndex;
      if (v.explanation) {
        snap.explanation = v.explanation;
        if (!snap.skipped) snap.solutionViewed = true;
      }
      onVerdict?.(v);
    });
    pendingWrites.current.add(write);
    void write.finally(() => pendingWrites.current.delete(write));
  }

  async function finish(reason: EndReason) {
    if (finishedRef.current) return;
    const sid = sessionIdRef.current;
    const context = ctxRef.current;
    if (reason === "left") {
      // Nothing started, or nothing new answered since the last leave: nothing
      // to send. A leave never marks the session done here — a page restored
      // from the back/forward cache carries on, and its own finish re-rolls
      // the session up (the finish is idempotent).
      if (!sid || !context || attemptLog.current.length <= leftWithRef.current) return;
      leftWithRef.current = attemptLog.current.length;
      await Promise.allSettled([...pendingWrites.current]);
      await completeSession(context, config, sid, [...attemptLog.current], "left").catch(() => undefined);
      return;
    }
    finishedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);

    // Out of time: only the question ON SCREEN was seen. The rest of the pool
    // was never shown, and recording it as skipped — as this once did, 48
    // questions for a student who saw 2 — put unseen questions into Skipped
    // Practice, the chapter tally and topic confidence.
    if (reason === "timed_out" && phase === "q" && qs[idx]) {
      attemptLog.current.push(snapshotOf(qs[idx], { selectedIndex: -1, isCorrect: false, skipped: true, timedOut: true }));
    }

    const attempts = [...attemptLog.current];
    const results: SessionResults = {
      correct: correctRef.current,
      total: attempts.length,
      skipped: skippedRef.current + (reason === "timed_out" && phase === "q" ? 1 : 0),
      bookmarked: bookmarkedRef.current.length,
      config,
      sessionId: sid,
      attempts,
      startedAt: startedAtRef.current,
      serverStats: null,
    };
    if (!sid || !context) {
      onFinish(results);
      return;
    }
    setFinishing(true);
    await Promise.allSettled([...pendingWrites.current]);
    try {
      Object.assign(results, await completeSession(context, config, sid, attempts, reason));
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not save practice session"));
      onFinish({ ...results, finishFailed: true });
      return;
    }
    onFinish(results);
  }
  finishRef.current = finish;

  function answer(i: number) {
    const q = qs[idx];
    if (!q || phase !== "q" || finishedRef.current) return;
    setChosen(i);
    setAnswered((n) => n + 1);
    // Bank: THE CLIENT DOES NOT GRADE — server re-grades off question_bank.
    // Private upload/capture (§9 / §7.4): no bank id, so the RPC trusts
    // `_is_correct`. The owner-readable key was loaded with the row; send it.
    const privateQ = Boolean(q.fromUpload || q.fromCapture);
    const knownCorrect =
      privateQ && typeof q.correctIndex === "number" && Number.isInteger(q.correctIndex)
        ? q.correctIndex
        : null;
    const isCorrect = knownCorrect != null ? i === knownCorrect : false;
    const snap = snapshotOf(q, { selectedIndex: i, isCorrect, skipped: false });
    if (knownCorrect != null) {
      snap.correctIndex = knownCorrect;
      if (q.explanation) snap.explanation = q.explanation;
      // Optimistic: non-bank RPC trusts what we send; don't flash "wrong" while waiting.
      setVerdict({
        attemptId: null,
        isCorrect,
        skipped: false,
        correctIndex: knownCorrect,
        correctText: q.options[knownCorrect] ?? "",
        explanation: q.explanation ?? "",
      });
    }
    onScreenRef.current = snap;
    record(snap, (v) => {
      if (v.isCorrect) {
        correctRef.current += 1;
        setCorrect(correctRef.current);
      }
      if (onScreenRef.current === snap) setVerdict(v);
    });
    setPhase("fb");
  }

  function next() {
    if (idx + 1 >= qs.length) { void finish("completed"); return; }
    setIdx(i => i + 1); setChosen(null); setPhase("q");
    // The last verdict belongs to the last question.
    onScreenRef.current = null;
    setVerdict(null);
    questionStartRef.current = Date.now();
  }

  /** The server's verdict when it recorded the answer; null leaves it for the finish to send. */
  async function persistAttemptLive(snap: PracticeAttemptSnapshot): Promise<AttemptVerdict | null> {
    const sid = sessionIdRef.current;
    const context = ctxRef.current;
    if (!sid || !context) return null;
    try {
      return await PracticeService.recordAttempt(context, {
        sessionId: sid,
        bankQuestionId: snap.bankQuestionId ?? null,
        generatedQuestion: {
          question: snap.question,
          options: snap.options,
          explanation: snap.explanation ?? "",
          bank_question_id: snap.bankQuestionId ?? null,
          // Spec §9 — private upload row id for chapter_tally / dispute join.
          upload_question_id: snap.uploadQuestionId ?? null,
          // Screen-capture §7.4 — private capture original id.
          capture_question_id: snap.captureQuestionId ?? null,
          // `?? null`: the column is jsonb, which has a null but no undefined —
          // an undefined key would vanish from the row rather than be unset.
          subject: snap.subject ?? null,
          chapter: snap.chapter ?? null,
          // Spec §9 / migration 202610670 — attempt RPC reads chapter_id from here.
          chapter_id: snap.chapterId ?? null,
          difficulty: snap.difficulty ?? null,
          practice_mode: snap.practiceMode ?? null,
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
        score: snap.skipped ? 0 : snap.isCorrect ? 1 : 0,
        skipped: snap.skipped ?? false,
        timedOut: snap.timedOut ?? false,
        timeTakenMs: snap.timeTakenMs ?? null,
        subject: snap.subject,
        chapter: snap.chapter,
        difficulty: snap.difficulty,
        source: snap.source ?? "practice",
        practiceMode: snap.practiceMode ?? config.mode,
        sourceId: snap.sourceId ?? sid,
        solutionViewed: snap.solutionViewed ?? false,
        attemptNumber: snap.attemptNumber ?? null,
        answeredAt: snap.answeredAt ?? null,
        schoolId: snap.schoolId ?? context.schoolId ?? null,
      });
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not save this answer — it will be sent again when you finish"));
      return null;
    }
  }

  function skip() {
    const q = qs[idx];
    if (!q || phase !== "q" || finishedRef.current) return;
    skippedRef.current += 1;
    record(snapshotOf(q, { selectedIndex: -1, isCorrect: false, skipped: true }));
    next();
  }

  function toggleBookmark() {
    // Spec §2.1 — upload questions are not in question_bank; bookmarks key on
    // bank ids, so they do not apply here.
    if (qs[idx]?.fromUpload || qs[idx]?.fromCapture) return;

    const nextOn = !bookmarkedRef.current.includes(idx);
    bookmarkedRef.current = nextOn
      ? [...bookmarkedRef.current, idx]
      : bookmarkedRef.current.filter(x => x !== idx);
    setBookmarked([...bookmarkedRef.current]);

    // Persist. Bookmarks are permanent — answering correctly never clears one.
    const bankId = qs[idx]?.id;
    if (!bankId || !ctx) {
      toast.error("Could not save bookmark. Please try again.");
      return;
    }
    const at = idx;
    void PracticeService.toggleBookmark(ctx, bankId, nextOn)
      .then(() => {
        toast.success(nextOn ? "Bookmarked — find it in Bookmarked Questions." : "Bookmark removed.");
      })
      .catch(() => {
        // Roll the optimistic toggle back so the icon never lies about state.
        bookmarkedRef.current = nextOn
          ? bookmarkedRef.current.filter(x => x !== at)
          : [...bookmarkedRef.current, at];
        setBookmarked([...bookmarkedRef.current]);
        toast.error("Could not save bookmark. Please try again.");
      });
  }

  async function disputeAiAnswer() {
    const q = qs[idx];
    if (!q?.aiAnswered || !q.fromUpload || !ctx) return;
    if (disputingId === q.id || disputedIds.has(q.id)) return;
    setDisputingId(q.id);
    try {
      const result = await StudentUploadService.disputeAiAnswer(ctx, q.id);
      setDisputedIds((prev) => new Set(prev).add(q.id));
      toast.success(
        `Answer disputed — cleared ${result.cleared_mistakes} mistake${result.cleared_mistakes === 1 ? "" : "s"}, excluded ${result.excluded_attempts} attempt${result.excluded_attempts === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not dispute this answer"));
    } finally {
      setDisputingId(null);
    }
  }

  const q       = qs[idx];
  // FROM THE SERVER, not from a copy of the answer this browser was handed.
  // Null while the verdict is in flight, which is why the options below stay
  // neutral until it lands.
  const isRight = verdict?.isCorrect === true;
  // Private keys are owner-readable; fall back when the verdict omits index
  // (non-bank path stores what we sent — still cover empty/legacy shapes).
  const markedCorrectIndex =
    verdict?.correctIndex != null && verdict.correctIndex >= 0
      ? verdict.correctIndex
      : q && (q.fromUpload || q.fromCapture) && typeof q.correctIndex === "number"
        ? q.correctIndex
        : null;
  const subj    = subjects.find(s => s.name === q?.subject);
  const timed   = config.timeLimitSec !== null;
  const mm      = Math.floor(timeLeft / 60).toString().padStart(2,"0");
  const ss      = (timeLeft % 60).toString().padStart(2,"0");

  if (loadingQs) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-3">
        <div className="text-sm text-muted-foreground">Loading practice questions…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto"/>
        <div className="text-lg font-bold text-foreground">Could not start practice</div>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <button onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border/70 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all">
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
      // Reachable only if the year's questions were retired between the
      // config screen counting them and this screen loading them.
      pyq: "No previous-year questions in the bank for this filter yet.",
      bookmarked: "You have not bookmarked any questions yet. Bookmark one during practice and it stays until you remove it.",
      chapter: "No questions for this chapter in the bank yet.",
      topic: "No questions for this topic in the bank yet.",
      custom: "No questions match those filters yet. Try a different difficulty or clear a filter.",
      // Reachable only if the plan's questions were retired between the plan
      // being built and this screen loading them.
      recovery: "The questions for this recovery session are no longer available. Open Recovery and start it again.",
      revision: "The questions for this revision check are no longer available. Open Revision and start it again.",
    };
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <HelpCircle className="w-10 h-10 text-muted-foreground mx-auto"/>
        <div className="text-lg font-bold text-foreground">No questions available</div>
        <p className="text-sm text-muted-foreground">
          {config.upload
            ? config.upload.practiseMode === "practise_from_notes"
              ? "No questions written from these notes yet."
              : "No practisable questions in this upload for that mode yet."
            : (emptyByMode[config.mode] ??
              "The question bank has no approved questions for this mode yet. Try another subject or ask your teacher to add questions.")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {config.mode === "weak" && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("recovery")}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-success/40 text-sm text-success hover:bg-success/10 transition-all"
            >
              Open Recovery
            </button>
          )}
          <button onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border/70 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all">
            <ArrowLeft className="w-4 h-4"/> Back to Practice
          </button>
        </div>
      </div>
    );
  }

  if (!q) return null;
  const isBookmarked = bookmarked.includes(idx);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">{config.label} · Q{idx + 1} of {qs.length}</span>
            <div className="flex items-center gap-3">
              {timed && (
                <div className={cn(
                  "flex items-center gap-1.5 text-sm font-black tabular-nums px-3 py-1 rounded-xl",
                  timeLeft < 30 ? "text-destructive bg-destructive/10" : "text-info bg-info/10"
                )}>
                  <Clock className="w-3.5 h-3.5"/>{mm}:{ss}
                </div>
              )}
              <span className="text-xs text-muted-foreground">{correct}/{answered} correct</span>
            </div>
          </div>
          <ProgressBar value={idx} max={Math.max(qs.length, 1)} color="hsl(var(--primary))" height="h-1"/>
        </div>
      </div>

      {/* Question card */}
      <GlassCard glow="blue" className="p-6">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            {subj && <SubjectBadge subject={subj.name} color={subj.color}/>}
            <DifficultyBadge level={q.difficulty}/>
            <span className="text-[10px] text-muted-foreground">{displayChapter(q.chapter)}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!(q.fromUpload || q.fromCapture) && (
              <button
                type="button"
                onClick={toggleBookmark}
                aria-pressed={isBookmarked}
                title={isBookmarked
                  ? "Bookmarked — it stays in Bookmarked Questions until you remove it"
                  : "Bookmark — keep this question in Bookmarked Questions"}
                className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                  isBookmarked ? "text-info bg-info/15" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}>
                <Bookmark className="w-3.5 h-3.5"/>
              </button>
            )}
          </div>
        </div>
        <div className="text-base font-semibold text-foreground leading-relaxed">
          <MathText block text={q.question} />
        </div>
      </GlassCard>

      {/* Options */}
      <div className="space-y-2.5">
        {q.options.map((opt, i) => {
          const isChosen = chosen === i;
          // Only once the server has said so. Before the verdict lands
          // nothing is marked, because nothing is known.
          const isCorrect = markedCorrectIndex === i;
          let bg = "border-border/70 text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted";
          if (phase === "fb") {
            // The fill, the border and the mark say which is right; the text
            // stays the foreground. text-success on its own tint read 4.13:1.
            if (isCorrect)              bg = "border-success/50 bg-success/10 text-foreground";
            else if (isChosen && !isRight) bg = "border-destructive/50 bg-destructive/10 text-foreground";
            else                        bg = "border-border text-muted-foreground opacity-60";
          }
          return (
            <button key={i} onClick={() => answer(i)} disabled={phase === "fb" || finishing}
              className={cn("w-full p-4 rounded-2xl border text-left text-sm font-medium transition-all duration-150 flex items-center gap-3", bg)}>
              <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 bg-muted">
                {String.fromCharCode(65+i)}
              </span>
              <span className="flex-1"><MathText text={opt} /></span>
              {phase === "fb" && isCorrect && <CheckCircle2 className="w-4 h-4 text-success shrink-0"/>}
              {phase === "fb" && isChosen && !isRight && <XCircle className="w-4 h-4 text-destructive shrink-0"/>}
            </button>
          );
        })}
      </div>

      {/* Explanation, once answered. There is no hint before answering: the
          bank has no hint text, only the worked solution, and the "hint" this
          screen showed was that solution's first 120 characters — the whole
          answer for 39% of servable questions (8,557 of 21,717). */}
      {phase === "fb" && q.aiAnswered && (
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground">AI answered</p>
          <button
            type="button"
            onClick={() => void disputeAiAnswer()}
            disabled={disputingId === q.id || disputedIds.has(q.id) || !ctx}
            className="text-xs px-2.5 py-1 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {disputedIds.has(q.id)
              ? "Disputed"
              : disputingId === q.id
                ? "Disputing…"
                : "Dispute answer"}
          </button>
        </div>
      )}
      {phase === "fb" && (verdict?.explanation || q.explanation) && (
        <GlassCard className="p-4 border-info/20">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-warning shrink-0 mt-0.5"/>
            <div className="text-sm text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Explanation: </span>
              <MathText text={verdict?.explanation || q.explanation || ""} />
            </div>
          </div>
        </GlassCard>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {phase === "q" && (
          <button onClick={skip} disabled={finishing}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border/70 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all">
            <SkipForward className="w-3.5 h-3.5"/> Skip
          </button>
        )}
        {phase === "fb" && (
          <button onClick={next} disabled={finishing}
            className="flex-1 py-3 rounded-2xl bg-primary hover:opacity-90 text-primary-foreground font-bold text-sm transition-all flex items-center justify-center gap-2">
            {idx+1 >= qs.length ? "See Results" : "Next Question"} <ChevronRight className="w-4 h-4"/>
          </button>
        )}
        <button onClick={() => void finish("ended")} disabled={finishing}
          className="px-4 py-2.5 rounded-xl border border-border/70 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/20 transition-all">
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
  /**
   * Present only when this session was a §5.4 revision check. Carries the
   * engine's verdict — passed, which rung of the ladder, and whether the
   * chapter is now solid — so the result screen reports what actually
   * happened rather than re-deciding it from the raw score.
   */
  revision?: import("@/academic").RevisionSessionOutcome;
  /**
   * Present only when this session was a §4.2 recovery session. Carries the
   * engine's verdict — the two rates SEPARATELY, and which of them failed —
   * so the result screen can say "you can do the steps but the idea isn't
   * solid yet" rather than a bare percentage.
   */
  recovery?: import("@/academic").RecoverySessionOutcome;
  serverStats?: {
    questionCount?: number;
    correctCount?: number;
    wrongCount?: number;
    skippedCount?: number;
    accuracy?: number | null;
    xpEarned?: number;
    totalTimeMs?: number | null;
  } | null;
}

/**
 * The finish failed, so nothing below is on the student's record yet.
 *
 * A successful finish never comes here — it goes to the result page, which
 * reads the saved row. This screen used to be a general summary with "Retry
 * Same Mode" (which started a NEW session and dropped these answers) and an
 * instruction to "finish it from your practice history" (which lists finished
 * sessions only, and has no way to finish one). The one thing that helps is
 * sending the same answers again, so that is what it offers.
 */
function SaveFailed({ results, retrying, onRetrySave, onHub }: {
  results: SessionResults; retrying: boolean; onRetrySave: () => void; onHub: () => void;
}) {
  const answered = results.attempts.filter((a) => !a.skipped && !a.timedOut);
  const correct = answered.filter((a) => a.isCorrect).length;
  const skipped = results.attempts.length - answered.length;
  return (
    <div className="max-w-lg mx-auto space-y-5">
      <GlassCard className="p-8 text-center" glow="rose">
        <div className="text-5xl mb-3">⚠️</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{results.config.label} · Not saved</div>
        <div className="text-lg font-bold text-foreground mb-1">This session was not saved</div>
        <p className="text-sm text-muted-foreground mb-6">
          Your answers are still on this device. Try saving again — they are not on your record until it works.
        </p>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Correct", value: correct, color: "hsl(var(--success))" },
            { label: "Wrong", value: answered.length - correct, color: "hsl(var(--destructive))" },
            { label: "Skipped", value: skipped, color: "hsl(var(--warning))" },
          ].map(s => (
            <div key={s.label} className="bg-muted rounded-xl p-2.5 border border-border">
              <div className="text-xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-2.5">
          <button onClick={onRetrySave} disabled={retrying || !results.sessionId}
            className="w-full py-3 rounded-2xl font-bold text-sm text-primary-foreground bg-primary flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50">
            <RotateCcw className="w-4 h-4"/> {retrying ? "Saving…" : "Try saving again"}
          </button>
          <button onClick={onHub} disabled={retrying}
            className="w-full py-3 rounded-2xl border border-border/70 text-muted-foreground font-semibold text-sm hover:text-foreground hover:border-border transition-all">
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
  const shellReady = useGurukulShellReady();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { ctx, ready: academicReady, settled: academicSettled } = useAcademicContext();
  const [historyList, setHistoryList] = useState<ListState<HistoryRow>>(LOADING_LIST);
  const [savedList, setSavedList] = useState<ListState<HistoryRow>>(LOADING_LIST);
  const [historyTick, setHistoryTick] = useState(0);
  const [subjectList, setSubjectList] = useState<ListState<PracticeSubject>>(LOADING_LIST);
  const [subjectReads, setSubjectReads] = useState(0);
  const subjects = listItems(subjectList);
  const [curriculumScope, setCurriculumScope] = useState<CurriculumScope | null>(null);
  const [savingLatest, setSavingLatest] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({
    search: "",
    subject: "",
    practiceType: "",
    date: "",
  });
  // academicIdentity is populated by StudentDashboard from a separate async
  // source than curriculumScope (Practice's own resolveCurriculumScope
  // fetch) -- shellReady is the flag that already exists to say "identity
  // isn't loaded yet" (studentShellReady = academicReady && progressionLoaded).
  // Without checking it, curriculumScope resolving first makes classIdMissing
  // true for a real class that just hasn't hydrated into academicIdentity yet.
  const classIdMissing = shellReady && !!curriculumScope && !academicIdentity.classId;
  // Same reasoning as classIdMissing above: observed live with the exact
  // same signature (header still showing placeholder identity when this
  // fired) -- resolveCurriculumScope reads ctx.classId/schoolId, which goes
  // through the same slow identity-resolution path, so a resolved-but-null
  // classLevel can be a premature read, not a genuine absence.
  const classLevelUnresolved = shellReady && !!curriculumScope && curriculumScope.classLevel == null;
  const examScoped = shellReady && !!curriculumScope?.examId;
  const examUnresolved =
    shellReady &&
    !!curriculumScope &&
    academicIdentity.schoolKind === "individual" &&
    !curriculumScope.examId;
  // Individuals practise by exam — class absence is expected, not unresolved.
  // resolvePracticeUnresolved makes CLASS_*_MSG unreachable when examScoped.
  const { classUnresolved, classUnresolvedMessage } = resolvePracticeUnresolved({
    examScoped,
    examUnresolved,
    classIdMissing,
    classLevelUnresolved,
  });

  useEffect(() => {
    if (!ctx || !academicReady) {
      // Settled without a context means nothing is coming: the picker says the
      // list is empty (or why) rather than loading for ever.
      setSubjectList(academicSettled ? EMPTY_LIST : LOADING_LIST);
      setCurriculumScope(null);
      return;
    }
    setSubjectList(LOADING_LIST);
    let cancelled = false;
    (async () => {
      try {
        const scope = await PracticeService.resolveCurriculumScope(ctx);
        if (cancelled) return;
        setCurriculumScope(scope);
        if (!scope.examId && scope.classLevel == null) {
          setSubjectList(EMPTY_LIST);
          return;
        }
        const names = await PracticeService.listBankSubjects(ctx);
        if (cancelled) return;
        setSubjectList({
          status: "ready",
          items: names.map((name, i) => ({
            id: name.toLowerCase(),
            name,
            color: subjectColor(name, i),
          })),
        });
      } catch {
        if (!cancelled) {
          setSubjectList({ status: "failed" });
          setCurriculumScope(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady, academicSettled, subjectReads]);

  // A session the student walked away from — a closed tab, a lost connection —
  // is finished from the answers it already holds before history is first
  // read, so it appears there rather than sitting open for ever. Once per
  // visit: it used to run again on every history filter change.
  const settleRef = useRef<Promise<void> | null>(null);
  const settleOnce = useCallback(() => {
    if (!ctx) return Promise.resolve();
    if (!settleRef.current) {
      settleRef.current = PracticeService.settleAbandonedSessions(ctx)
        .then((settled) => {
          if (settled > 0) {
            toast.message(settled === 1
              ? "A practice session you left open has been saved with what you answered."
              : `${settled} practice sessions you left open have been saved with what you answered.`);
          }
        })
        .catch(() => undefined);
    }
    return settleRef.current;
  }, [ctx]);

  useEffect(() => {
    if (!user || !ctx || !academicReady) {
      // Settled without a context means nothing is coming: say "none", not
      // "loading" for ever.
      if (!user || academicSettled) {
        setHistoryList(EMPTY_LIST);
        setSavedList(EMPTY_LIST);
      }
      return;
    }
    setHistoryList(LOADING_LIST);
    setSavedList(LOADING_LIST);
    let cancelled = false;
    (async () => {
      try {
        await settleOnce();
        if (cancelled) return;
        const [hist, savedRows] = await Promise.all([
          PracticeService.listHistory(ctx, {
            limit: 100,
            subject: historyFilters.subject || null,
            practiceMode: historyFilters.practiceType || null,
            // The picked date is the student's own calendar day. It was sent
            // as a UTC day, so in India every session between midnight and
            // 05:30 was filed under the day before.
            ...(historyFilters.date ? localDayBounds(historyFilters.date) : {}),
            // Search stays client-side over this window.
            search: null,
          }),
          PracticeService.listSavedSessions(ctx, 40),
        ]);
        if (cancelled) return;
        setHistoryList({ status: "ready", items: (hist ?? []).map(mapSessionToHistoryRow) });
        setSavedList({ status: "ready", items: (savedRows ?? []).map(mapSessionToHistoryRow) });
      } catch {
        if (!cancelled) {
          setHistoryList({ status: "failed" });
          setSavedList({ status: "failed" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    user,
    ctx,
    academicReady,
    academicSettled,
    historyTick,
    historyFilters.subject,
    historyFilters.practiceType,
    historyFilters.date,
    settleOnce,
  ]);

  const streak = student.streak;
  const [phase,   setPhase]   = useState<Phase>("hub");
  const [modeKey, setModeKey] = useState<ModeKey>("subject");
  const [config,  setConfig]  = useState<SessionConfig | null>(null);
  const [results, setResults] = useState<SessionResults | null>(null);
  const [retryingSave, setRetryingSave] = useState(false);
  /** Bumped per session, so every session mounts a fresh runner. */
  const [runId, setRunId] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const deepLinkHandled = useRef(false);

  /**
   * Drop the router state WITHOUT navigating.
   *
   * It used to be `navigate(location.pathname, { replace: true, state: null })`
   * — and that navigation REMOUNTED this component. Traced live on 2026-09-15
   * by logging the effect on every run:
   *
   *   1  handled:false  phase:hub      state:{recovery:{…}}   -> handoff taken
   *   2  handled:true   phase:session  state:null             -> correctly skipped
   *   3  handled:false  phase:hub      state:null             -> REMOUNTED, and
   *                                                              the state it
   *                                                              needed is gone
   *
   * The remount reset both the ref and `phase`, so the third pass found an
   * empty state and fell through to the practice hub. Pressing "Start
   * recovery" therefore landed the student back on the mode list, every time,
   * with a recovery session already opened server-side and no way to reach it.
   *
   * The clearing itself is still wanted — a back-navigation must not re-open a
   * session that has been submitted — so it is done through the History API,
   * which React Router reads (`history.state.usr`) but does not treat as a
   * navigation. Same effect, no remount.
   */
  const clearRouterState = useCallback(() => {
    try {
      const h = window.history;
      h.replaceState({ ...(h.state ?? {}), usr: null }, "");
    } catch {
      // A browser that refuses replaceState keeps the state; the ref below
      // still stops it being consumed twice in this mount.
    }
  }, []);

  /** Instant modes skip config and load with mode-specific filters. */
  const INSTANT: ModeKey[] = ["weak", "incorrect", "skipped", "bookmarked"];

  /** Honor Revision/Recovery CTAs: /student/practice?chapter=&subject=&topic= */
  useEffect(() => {
    if (deepLinkHandled.current || phase !== "hub") return;

    // A recovery session arrives through router state, not the URL: its tier
    // ladder is a map of question ids that is not persisted server-side, so it
    // cannot be re-derived from a link. Checked before the query params
    // because a recovery hand-off carries chapter/subject too, and the
    // ordinary chapter-practice branch below would otherwise claim it and
    // drop the ladder.
    const handoff = (location.state ?? null) as {
      recovery?: SessionConfig["recovery"];
      revision?: SessionConfig["revision"];
    } | null;

    // A revision check arrives the same way and for the same reason: its
    // contents are decided by rpc_revision_session_plan, which knows which
    // questions this student has already seen. A URL could only carry the
    // chapter, and the loader would then pick questions the check is
    // specifically supposed to exclude.
    if (handoff?.revision) {
      deepLinkHandled.current = true;
      clearRouterState();
      const rev = handoff.revision;
      setModeKey("revision");
      startSession({
        mode: "revision",
        label: PRACTICE_MODE_LABELS.revision,
        subject: "Mixed",
        chapter: null,
        topic: null,
        difficulty: "mixed",
        // What the plan could actually supply, never REVISION_COUNT: a thin
        // chapter gives a shorter check, and asking for more than exists
        // would leave the runner waiting on questions that are not coming.
        qCount: rev.questionIds.length,
        timeLimitSec: null,
        revision: rev,
      });
      return;
    }

    if (handoff?.recovery) {
      deepLinkHandled.current = true;
      clearRouterState();
      const rec = handoff.recovery;
      setModeKey("recovery");
      startSession({
        mode: "recovery",
        label: PRACTICE_MODE_LABELS.recovery,
        subject: "Mixed",
        chapter: null,
        topic: null,
        difficulty: "mixed",
        qCount: Object.keys(rec.tierByQuestionId).length,
        timeLimitSec: null,
        recovery: rec,
      });
      return;
    }

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
    // ?revision=<uuid> USED TO BE HANDLED HERE and is deliberately gone.
    //
    // It turned the session into a §5.4 check by chapter alone, leaving the
    // ordinary loader to pick the questions — and the ordinary loader cannot
    // exclude what the student has already seen. Keeping it alongside the
    // router-state hand-off would leave a second way to start a check that
    // quietly skips the one rule that makes a check mean anything.
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

    // A topic WITHOUT a chapter is topic mode, not chapter mode.
    //
    // `chapter: chapter || topic` used to copy the topic into the chapter,
    // from when the topic could not be narrowed server-side and had to act as
    // a chapter needle. It now does active harm: the query would require
    // question_bank.chapter to equal a TOPIC name, which no row satisfies, so
    // the narrowed fetch returns nothing and falls back to the 400-row window
    // this was meant to avoid. It also wrote the topic name into
    // practice_sessions.chapter, inventing a chapter that does not exist.
    const modeKeyDeep: ModeKey = chapter ? "chapter" : topic ? "topic" : "subject";
    const mode = MODES.find((m) => m.key === modeKeyDeep) ?? MODES.find((m) => m.key === "chapter")!;
    setModeKey(modeKeyDeep);
    startSession({
      mode: modeKeyDeep,
      label: mode.label,
      subject: subject || "Mixed",
      chapter,
      topic,
      difficulty: "mixed",
      qCount: 20,
      timeLimitSec: null,
    });
  }, [searchParams, setSearchParams, phase]);

  function startSession(cfg: SessionConfig) {
    setConfig(cfg);
    setRunId((n) => n + 1);
    setPhase("session");
  }

  function handleMode(key: ModeKey) {
    setModeKey(key);
    if (INSTANT.includes(key)) {
      const mode = MODES.find(m => m.key === key)!;
      startSession({
        mode: key,
        label: mode.label,
        subject: "Mixed",
        chapter: null,
        topic: null,
        difficulty: "mixed",
        qCount: 20,
        timeLimitSec: null,
      });
    } else {
      setPhase("config");
    }
  }

  function handleConfigStart(cfg: SessionConfig) {
    startSession(cfg);
  }

  function openSessionAnalysis(sessionId: string) {
    navigate(`/student/practice/session/${sessionId}/result`);
  }

  async function saveLatestSession() {
    if (!ctx) {
      toast.message("Complete a practice session first");
      return;
    }
    setSavingLatest(true);
    try {
      // The latest session actually sat — history filters do not apply.
      const [latest] = await PracticeService.listRecentFinished(ctx, 1);
      if (!latest) {
        toast.message("Complete a practice session first");
        return;
      }
      const res = await PracticeService.saveSession(ctx, latest.id);
      if (res.already_saved) toast.message("Your latest session is already saved");
      else toast.success("Latest session saved — it stays under Saved Sessions");
      setHistoryTick((t) => t + 1);
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not save session"));
    } finally {
      setSavingLatest(false);
    }
  }

  function handleFinish(res: SessionResults) {
    setHistoryTick((t) => t + 1);
    // A FAILED SAVE DOES NOT GO TO THE RESULT PAGE.
    //
    // The result page reads the practice_sessions row for its figures. When
    // the finish RPC threw, that row is still unfinished and its aggregates
    // are whatever they were before, so the page renders a session that looks
    // ordinary and is not saved. `finishFailed` exists for exactly this and
    // was set here and then ignored: the navigation below only ever asked
    // whether there was a session id, and a failed finish still has one.
    //
    // A failed finish goes to SaveFailed instead, which can send the same
    // answers again.
    if (res.sessionId && !res.finishFailed) {
      goToResult(res);
      return;
    }
    setResults(res);
    setPhase("saveFailed");
  }

  function goToResult(res: SessionResults) {
    if (!res.sessionId) return;
    // The session's own chapter, or none. The first question's chapter used to
    // stand in for it, so a Weak Areas session across six chapters was titled
    // with one of them.
    persistAndGoToPracticeResult(navigate, res.sessionId, {
      subject: res.config.subject === "Mixed" ? "" : res.config.subject,
      chapter: res.config.chapter ?? "",
      practiceMode: res.config.mode,
      attempts: res.attempts,
      startedAt: res.startedAt,
      serverStats: res.serverStats ?? null,
      recovery: res.recovery ?? null,
      revision: res.revision ?? null,
    });
  }

  async function retrySave() {
    if (!results?.sessionId || !ctx) return;
    setRetryingSave(true);
    try {
      const done = await completeSession(ctx, results.config, results.sessionId, results.attempts, "completed");
      setHistoryTick((t) => t + 1);
      goToResult({ ...results, ...done, finishFailed: false });
    } catch (e) {
      toast.error(toErrorMessage(e, "Still could not save — check your connection and try again"));
    } finally {
      setRetryingSave(false);
    }
  }

  return (
    <>
      {classUnresolved && (
        <div className="mb-4 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
          {classUnresolvedMessage}
        </div>
      )}
      {phase === "hub" && (
        <Hub
          onMode={handleMode}
          historyList={historyList}
          savedList={savedList}
          onRetryHistory={() => setHistoryTick((t) => t + 1)}
          streak={streak}
          onOpenSession={openSessionAnalysis}
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
          subjectList={subjectList}
          onRetrySubjects={() => setSubjectReads((k) => k + 1)}
          classUnresolved={classUnresolved}
          classUnresolvedMessage={classUnresolvedMessage}
          examScoped={examScoped}
        />
      )}
      {phase === "session" && config && (
        <Session
          key={runId}
          config={config}
          onFinish={handleFinish}
          onBack={() => setPhase("hub")}
          onNavigate={setPage}
          subjects={subjects}
          classUnresolved={classUnresolved}
          classUnresolvedMessage={classUnresolvedMessage}
        />
      )}
      {phase === "saveFailed" && results && (
        <SaveFailed
          results={results}
          retrying={retryingSave}
          onRetrySave={() => void retrySave()}
          onHub={() => setPhase("hub")}
        />
      )}
    </>
  );
}
