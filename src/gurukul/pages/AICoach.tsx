import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { cn } from "@/gurukul/components/shared";
import { displayConcept } from "@/lib/academicDisplay";
import {
  COMING_SOON_LABEL,
  comingSoonToast,
  resolveNovaPresentation,
} from "@/lib/productFeatureFlags";
import { toast } from "sonner";
import { askAiCoach, recordAiFeedback, AI_BILLING_UNAVAILABLE_MSG, isAiBillingOrCreditsIssue } from "@/academic/ai/gatewayClient";
import { buildNovaUiChips, dedupeSubjects, isPlaceholderLabel } from "@/academic/ai/novaContextBuilder";
import { WEAK_CONCEPT_THRESHOLD } from "@/academic/eie/masteryBands";
import { useAuth } from "@/auth";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import {
  Mic, Send, Plus, Search, Pin, Star, Trash2, Edit3,
  MoreHorizontal, ChevronLeft, Paperclip, Copy, Bookmark,
  RotateCcw, X,
  BookOpen, HelpCircle, Brain, Sparkles,
  MessageSquare, Check, AlertCircle, Globe, Layers,
  ThumbsUp, ThumbsDown,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type Role = "nova" | "student";

interface Message {
  id: string; role: Role; text: string; time: string;
  bookmarked?: boolean;
  requestId?: string;
  featureId?: string;
  feedback?: "like" | "dislike" | null;
}

interface Conversation {
  id: string; title: string; preview: string; date: string;
  pinned?: boolean; starred?: boolean; messages: Message[];
  /** Gateway multi-turn session id (when available) */
  sessionId?: string;
}

const CONVO_STORAGE_KEY = "gurukul.nova.convos.v1";

// ── Honest empty conversation list (never seed demo chats) ────────────────────
const EMPTY_CONVOS: Conversation[] = [];

const SUGGESTIONS = [
  { icon:<HelpCircle className="w-4 h-4"/>,    text:"What is my attendance this month?",     color:"#3b5bdb" },
  { icon:<Layers className="w-4 h-4"/>,         text:"Which homework is due soon?",           color:"#4b9fd4" },
  { icon:<BookOpen className="w-4 h-4"/>,       text:"Show my marks summary",                 color:"#6882e8" },
  { icon:<Brain className="w-4 h-4"/>,          text:"What is today's timetable?",            color:"#4aa87a" },
  { icon:<Sparkles className="w-4 h-4"/>,       text:"What should I revise? Show mastery",    color:"#c08a3a" },
  { icon:<MessageSquare className="w-4 h-4"/>,  text:"Explain my performance from school records", color:"#cc5069" },
  { icon:<Globe className="w-4 h-4"/>,          text:"Summarise my weak concepts",            color:"#4b9fd4" },
  { icon:<AlertCircle className="w-4 h-4"/>,    text:"How am I doing in attendance and marks?",color:"#c08a3a" },
];

function loadStoredConvos(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVO_STORAGE_KEY);
    if (!raw) return EMPTY_CONVOS;
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : EMPTY_CONVOS;
  } catch {
    return EMPTY_CONVOS;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}

function offlineFallback(): string {
  return (
    "I couldn’t reach the AI Gateway just now. " +
    "Ask about attendance, homework due, marks, today’s timetable, or mastery/revision — " +
    "or use Practice, Doubts, or Recovery for learning paths."
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onBookmark, onRegen, onFeedback, isLast }: {
  msg: Message;
  onBookmark: (id: string) => void;
  onRegen?: () => void;
  onFeedback?: (id: string, signal: "like" | "dislike") => void;
  isLast?: boolean;
}) {
  const isNova   = msg.role === "nova";
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(msg.text).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false), 1500);
  }

  // Render markdown-like bold and newlines
  function renderText(txt: string) {
    return txt.split("\n").map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
        p.startsWith("**") ? <strong key={j} className="text-white font-semibold">{p.slice(2,-2)}</strong> : p
      );
      return <span key={i}>{parts}{i < txt.split("\n").length - 1 && <br/>}</span>;
    });
  }

  return (
    <div className={cn("group flex gap-3", isNova ? "items-start" : "items-end flex-row-reverse")}>
      {/* Avatar */}
      {isNova && (
        <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center mt-1"
          style={{ background:"radial-gradient(circle at 35% 35%, #60a5fa, #3b5bdb)", boxShadow:"0 0 12px rgba(59,130,246,0.4)" }}>
          <Brain className="w-4 h-4 text-white"/>
        </div>
      )}

      <div className={cn("flex flex-col gap-1 max-w-[78%]", isNova ? "items-start" : "items-end")}>

        {/* Bubble */}
        <div className={cn(
          "px-4 py-3 rounded-2xl text-sm leading-relaxed",
          isNova
            ? "bg-[#131316] border border-white/7 text-[#c8d4e8]"
            : "text-white"
        )}
        style={!isNova ? { background:"linear-gradient(135deg,#3b5bdb,#2563eb)", boxShadow:"0 4px 16px rgba(59,130,246,0.25)" } : {}}>
          {renderText(msg.text)}
        </div>

        {/* Timestamp + actions */}
        <div className={cn("flex items-center gap-2 px-1", isNova ? "flex-row" : "flex-row-reverse")}>
          <span className="text-[10px] text-[#78788c]">{msg.time}</span>
          <div className={cn(
            "flex items-center gap-0.5 transition-opacity",
            isNova ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <button onClick={copy} title="Copy"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all">
              {copied ? <Check className="w-3 h-3 text-emerald-400"/> : <Copy className="w-3 h-3"/>}
            </button>
            <button onClick={() => onBookmark(msg.id)} title="Bookmark"
              className={cn("w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                msg.bookmarked ? "text-amber-400 bg-amber-400/10" : "text-[#78788c] hover:text-white hover:bg-white/6"
              )}>
              <Bookmark className="w-3 h-3"/>
            </button>
            {isNova && onFeedback && (
              <>
                <button
                  onClick={() => onFeedback(msg.id, "like")}
                  title="Helpful"
                  className={cn(
                    "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                    msg.feedback === "like"
                      ? "text-emerald-400 bg-emerald-400/10"
                      : "text-[#78788c] hover:text-white hover:bg-white/6"
                  )}
                >
                  <ThumbsUp className="w-3 h-3"/>
                </button>
                <button
                  onClick={() => onFeedback(msg.id, "dislike")}
                  title="Not helpful"
                  className={cn(
                    "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                    msg.feedback === "dislike"
                      ? "text-rose-400 bg-rose-400/10"
                      : "text-[#78788c] hover:text-white hover:bg-white/6"
                  )}
                >
                  <ThumbsDown className="w-3 h-3"/>
                </button>
              </>
            )}
            {isNova && isLast && onRegen && (
              <button onClick={onRegen} title="Regenerate"
                className="w-6 h-6 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all">
                <RotateCcw className="w-3 h-3"/>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Context pill ──────────────────────────────────────────────────────────────
function ContextPill({ contextLine }: { contextLine: string }) {
  return (
    <div className="flex justify-center py-3">
      <div
        className="group flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/7 bg-white/3"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
        <span className="text-[11px] text-[#78788c]">
          Nova knows your context{contextLine ? ` · ${contextLine}` : ""}
        </span>
        <Brain className="w-3 h-3 text-[#78788c]"/>
      </div>
    </div>
  );
}

// ── Suggestions (empty state) ─────────────────────────────────────────────────
function SuggestionGrid({
  onSelect,
  onNavigate,
  firstName,
  chips,
}: {
  onSelect: (text: string) => void;
  onNavigate?: (page: PageKey) => void;
  firstName: string;
  chips: { id: string; label: string; color: string }[];
}) {
  const jumpLinks: { page: PageKey; label: string; color: string }[] = [
    { page: "practice", label: "Practice", color: "#3b5bdb" },
    { page: "recovery", label: "Recovery", color: "#cc5069" },
    { page: "battleground", label: "Battleground", color: "#c08a3a" },
    { page: "doubtportal", label: "Doubts", color: "#4aa87a" },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
      {/* Nova orb */}
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5"
        style={{ background:"radial-gradient(circle at 35% 35%, #60a5fa, #3b5bdb, #4338ca)", boxShadow:"0 0 40px rgba(59,130,246,0.4)" }}>
        <Brain className="w-9 h-9 text-white"/>
      </div>
      <h2 className="text-2xl font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>
        Hi {firstName && !isPlaceholderLabel(firstName) ? firstName : "there"} 👋
      </h2>
      <p className="text-[#78788c] text-sm mb-8 text-center max-w-xs">
        I'm Nova — your personal academic tutor. Ask about attendance, homework, marks, timetable, or revision.
      </p>

      {/* Academic context mini-card — live chips only, no placeholders / duplicates */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {chips.map((item) => (
            <span key={item.id} className="text-[11px] px-2.5 py-1 rounded-full border font-medium"
              style={{ color:item.color, borderColor:`${item.color}25`, background:`${item.color}10` }}>
              {item.label}
            </span>
          ))}
        </div>
      )}

      {/* Suggestions */}
      <div className="w-full max-w-lg grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SUGGESTIONS.map((s, i) => (
          <button key={i} onClick={() => onSelect(s.text)}
            className="group flex items-center gap-3 p-3.5 rounded-2xl border border-white/7 bg-[#131316]/60 hover:border-white/15 hover:bg-[#131316] transition-all text-left">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
              style={{ background:`${s.color}15`, color:s.color }}>
              {s.icon}
            </div>
            <span className="text-sm text-[#a0a0b0] group-hover:text-white transition-colors leading-snug">{s.text}</span>
          </button>
        ))}
      </div>

      {onNavigate && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11px] text-[#78788c] w-full text-center mb-1">Jump to</span>
          {jumpLinks.map((j) => (
            <button
              key={j.page}
              type="button"
              onClick={() => onNavigate(j.page)}
              className="text-[11px] px-3 py-1.5 rounded-xl border font-semibold hover:opacity-90 transition-opacity"
              style={{ color: j.color, borderColor: `${j.color}40`, background: `${j.color}12` }}
            >
              {j.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({
  convos, activeId, onSelect, onNew, onDelete, onPin, onStar, onRename, onClose,
}: {
  convos: Conversation[]; activeId: string | null;
  onSelect: (id:string)=>void; onNew: ()=>void;
  onDelete: (id:string)=>void; onPin: (id:string)=>void;
  onStar: (id:string)=>void; onRename: (id:string)=>void;
  onClose?: ()=>void;
}) {
  const [search,  setSearch]  = useState("");
  const [menuFor, setMenuFor] = useState<string|null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => { setMenuFor(null); setMenuPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuFor]);

  const filtered = convos.filter(c =>
    search === "" || c.title.toLowerCase().includes(search.toLowerCase())
  );
  const pinned = filtered.filter(c => c.pinned);
  const rest   = filtered.filter(c => !c.pinned);

  // Group rest by date
  const groups: Record<string, Conversation[]> = {};
  rest.forEach(c => { (groups[c.date] ??= []).push(c); });

  const activeMenuConvo = menuFor ? convos.find((c) => c.id === menuFor) : null;

  function ConvoItem({ c }: { c: Conversation }) {
    const isActive = c.id === activeId;
    return (
      <div className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
        isActive ? "bg-[#3b5bdb]/12 border border-[#3b5bdb]/20" : "hover:bg-white/4"
      )} onClick={() => onSelect(c.id)}>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            {c.pinned  && <Pin    className="w-2.5 h-2.5 text-blue-400 shrink-0"/>}
            {c.starred && <Star   className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0"/>}
            <span className={cn(
              "text-xs font-semibold truncate",
              isActive ? "text-white" : "text-[#c8d4e8]"
            )}>{c.title}</span>
          </div>
          <div className="text-[10px] text-[#78788c] truncate">{c.preview}</div>
        </div>

        {/* Context menu button — menu is portaled (overflow-hidden sidebar clips absolute menus) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (menuFor === c.id) {
              setMenuFor(null);
              setMenuPos(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
            setMenuFor(c.id);
          }}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/8 opacity-0 group-hover:opacity-100 transition-all shrink-0">
          <MoreHorizontal className="w-3.5 h-3.5"/>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d0f]">
      {/* Header */}
      <div className="p-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
              style={{ background:"radial-gradient(circle, #3b5bdb, #4338ca)" }}>
              <Brain className="w-3.5 h-3.5 text-white"/>
            </div>
            <span className="text-sm font-black text-white" style={{fontFamily:"var(--font-display)"}}>Nova</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onNew}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all" title="New conversation">
              <Plus className="w-4 h-4"/>
            </button>
            {onClose && (
              <button onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all lg:hidden">
                <X className="w-4 h-4"/>
              </button>
            )}
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#78788c]"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full bg-white/4 border border-white/6 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-[#78788c] outline-none focus:border-[#3b5bdb]/30 transition-colors"/>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-none" onClick={() => { setMenuFor(null); setMenuPos(null); }}>
        {pinned.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-[0.15em] text-[#78788c]/60">Pinned</div>
            {pinned.map(c => <ConvoItem key={c.id} c={c}/>)}
          </div>
        )}
        {Object.entries(groups).map(([date, cs]) => (
          <div key={date}>
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-[0.15em] text-[#78788c]/60">{date}</div>
            {cs.map(c => <ConvoItem key={c.id} c={c}/>)}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-xs text-[#78788c]">No conversations found</div>
        )}
      </div>

      {activeMenuConvo && menuPos && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-overlay bg-[#131316] border border-white/10 rounded-xl shadow-xl py-1 min-w-[140px]"
          style={{ top: menuPos.top, right: menuPos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { icon: <Pin className="w-3 h-3"/>, label: activeMenuConvo.pinned ? "Unpin" : "Pin", action: () => { onPin(activeMenuConvo.id); setMenuFor(null); setMenuPos(null); } },
            { icon: <Star className="w-3 h-3"/>, label: activeMenuConvo.starred ? "Unstar" : "Star", action: () => { onStar(activeMenuConvo.id); setMenuFor(null); setMenuPos(null); } },
            { icon: <Edit3 className="w-3 h-3"/>, label: "Rename", action: () => { onRename(activeMenuConvo.id); setMenuFor(null); setMenuPos(null); } },
            { icon: <Trash2 className="w-3 h-3"/>, label: "Delete", action: () => { onDelete(activeMenuConvo.id); setMenuFor(null); setMenuPos(null); }, danger: true },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.action}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                item.danger ? "text-rose-400 hover:bg-rose-400/10" : "text-[#a0a0b0] hover:text-white hover:bg-white/5",
              )}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Input bar ─────────────────────────────────────────────────────────────────
function InputBar({
  onSend, onVoiceUnavailable, onAttachUnavailable, disabled,
}: {
  onSend: (text: string) => void;
  onVoiceUnavailable: () => void;
  onAttachUnavailable: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachPresentation = resolveNovaPresentation("attachment");
  const voicePresentation = resolveNovaPresentation("voice");

  function submit() {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  return (
    <div className="relative">
      <div className="flex items-end gap-2 bg-[#131316] border border-white/10 rounded-2xl p-2 focus-within:border-[#3b5bdb]/30 transition-all">
        {attachPresentation !== "hidden" && (
          <button
            type="button"
            onClick={onAttachUnavailable}
            title={
              attachPresentation === "coming_soon"
                ? `Attachments — ${COMING_SOON_LABEL}`
                : "Attachments"
            }
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5 text-[#78788c]/50 hover:text-[#78788c] hover:bg-white/4"
          >
            <Paperclip className="w-4 h-4"/>
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder="Ask Nova anything…"
          rows={1} disabled={disabled}
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[#78788c] outline-none resize-none py-1.5 leading-relaxed"
          style={{ maxHeight:120 }}
        />

        {voicePresentation !== "hidden" && (
          <button
            type="button"
            onClick={onVoiceUnavailable}
            title={
              voicePresentation === "coming_soon"
                ? `Voice — ${COMING_SOON_LABEL}`
                : "Voice"
            }
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[#78788c]/50 hover:text-[#78788c] hover:bg-white/4 transition-all shrink-0 mb-0.5"
          >
            <Mic className="w-4 h-4"/>
          </button>
        )}

        <button type="button" onClick={submit} disabled={!text.trim()}
          className={cn(
            "w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5",
            text.trim()
              ? "bg-[#3b5bdb] text-white hover:bg-blue-500"
              : "text-[#78788c]/40 cursor-not-allowed"
          )}>
          <Send className="w-4 h-4"/>
        </button>
      </div>
      <div className="text-center mt-1.5">
        <span className="text-[10px] text-[#78788c]/50">Press ⏎ to send · ⇧⏎ for new line · Answers use your live school records</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AICoach({ setPage }: { setPage?: (p: PageKey) => void }) {
  const student = useGurukulStudent();
  const { user, role } = useAuth();
  const { studentId, schoolId } = useAcademicContext();
  const { data: charts } = useStudentPerformanceCharts();
  const { items: masteryItems } = useConceptMastery();
  const { data: snapshot } = useStudentAcademicSnapshot();
  const { data: recoveryZone } = useRecoveryZone();

  const subjectNames = useMemo(
    () =>
      dedupeSubjects([
        ...(charts?.subjects ?? []).map((s) => s.name),
        ...(snapshot?.weak_topics ?? []).map((t) => t.subject),
        ...(snapshot?.strong_topics ?? []).map((t) => t.subject),
        ...(masteryItems ?? []).map((m) => m.subject),
      ]),
    [charts?.subjects, snapshot?.weak_topics, snapshot?.strong_topics, masteryItems],
  );

  const weakConceptLabels = useMemo(
    () =>
      dedupeSubjects(
        [...masteryItems]
          .filter((m) => m.mastery_score < WEAK_CONCEPT_THRESHOLD || m.mistake_count >= 2)
          .sort((a, b) => a.mastery_score - b.mastery_score || b.mistake_count - a.mistake_count)
          .map((m) => displayConcept(m.concept))
          .filter((c) => !isPlaceholderLabel(c)),
        3,
      ),
    [masteryItems],
  );

  const novaChips = useMemo(
    () =>
      buildNovaUiChips({
        classLabel: student.class || null,
        section: student.section || null,
        subjects: subjectNames,
        homeworkPending: snapshot?.homework?.pending ?? null,
        attendancePct:
          student.attendance > 0
            ? student.attendance
            : snapshot?.exam_readiness?.attendance_pct ?? null,
        practiceSessions:
          snapshot?.self_practice?.sessions_completed ??
          student.sessionsThisWeek ??
          null,
        mistakeCount: snapshot?.mistake_count ?? null,
        recoveryPending:
          snapshot?.recovery_pending ?? recoveryZone?.pending_count ?? null,
        xp: student.xp,
        level: student.level,
        studyStreak: student.streak,
        weakConcepts: weakConceptLabels,
        goal: student.goal || null,
      }),
    [
      student.class,
      student.section,
      student.attendance,
      student.sessionsThisWeek,
      student.xp,
      student.level,
      student.streak,
      student.goal,
      subjectNames,
      snapshot,
      recoveryZone?.pending_count,
      weakConceptLabels,
    ],
  );

  const contextLine = useMemo(
    () => novaChips.map((c) => c.label).join(" · "),
    [novaChips],
  );

  const [convos,     setConvos]     = useState<Conversation[]>(() => loadStoredConvos());
  const [activeId,   setActiveId]   = useState<string|null>(null);
  const [sidebarOpen,setSidebarOpen]= useState(false);
  const [renaming,   setRenaming]   = useState<string|null>(null);
  const [renameVal,  setRenameVal]  = useState("");
  const [isTyping,   setIsTyping]   = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const convosRef = useRef(convos);
  convosRef.current = convos;
  // activeId (state) does not update until the next render commits, so a
  // second rapid sendMessage() call in that window would still see the old
  // value. Mirror it into a ref that sendMessage can also update
  // synchronously the instant a new conversation is created.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const active = activeId ? convos.find(c => c.id === activeId) ?? null : null;
  const msgs   = active?.messages ?? [];

  useEffect(() => {
    try {
      localStorage.setItem(CONVO_STORAGE_KEY, JSON.stringify(convos.slice(0, 40)));
    } catch {
      /* ignore quota */
    }
  }, [convos]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [msgs, isTyping]);

  function addMessage(convoId: string, msg: Omit<Message,"id">) {
    setConvos(cs => cs.map(c => c.id === convoId
      ? { ...c, messages:[...c.messages, { ...msg, id:`m${Date.now()}` }],
          preview: msg.text.slice(0,60) + (msg.text.length>60?"…":"") }
      : c
    ));
  }

  async function replyViaGateway(convoId: string, text: string) {
    setIsTyping(true);
    try {
      const existing = convosRef.current.find((c) => c.id === convoId);
      const { text: reply, response } = await askAiCoach({
        text,
        studentId: studentId || undefined,
        role: role === "student" || role === "parent" || role === "teacher" || role === "principal" || role === "admin"
          ? role
          : "student",
        channel: "student_app",
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
        session_id: existing?.sessionId,
        open_session: !existing?.sessionId,
      });
      if (isAiBillingOrCreditsIssue(response)) {
        toast.message(AI_BILLING_UNAVAILABLE_MSG);
      }
      const nextSessionId =
        typeof response.session_id === "string" && response.session_id.trim()
          ? response.session_id.trim()
          : existing?.sessionId;
      setConvos((cs) =>
        cs.map((c) =>
          c.id === convoId
            ? {
                ...c,
                sessionId: nextSessionId,
                messages: [
                  ...c.messages,
                  {
                    id: `m${Date.now()}`,
                    role: "nova",
                    text: reply,
                    time: now(),
                    requestId: response.request_id,
                    featureId: response.feature_id,
                    feedback: null,
                  },
                ],
                preview: reply.slice(0, 60) + (reply.length > 60 ? "…" : ""),
              }
            : c,
        ),
      );
    } catch {
      toast.error("AI Gateway unavailable");
      setConvos((cs) =>
        cs.map((c) =>
          c.id === convoId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { id: `m${Date.now()}`, role: "nova", text: offlineFallback(), time: now() },
                ],
              }
            : c,
        ),
      );
    } finally {
      setIsTyping(false);
    }
  }

  function sendMessage(text: string) {
    const currentId = activeIdRef.current;
    if (!currentId) {
      const id = `c${Date.now()}`;
      const newConvo: Conversation = {
        id, title: text.slice(0,40) || "New Conversation",
        preview: text.slice(0,60), date:"Today", messages:[],
      };
      // Update the ref synchronously so a second send fired before this
      // state update commits still finds this conversation instead of
      // creating another one.
      activeIdRef.current = id;
      setConvos(cs => [newConvo, ...cs]);
      setActiveId(id);
      setTimeout(() => {
        // Prepend (not replace) — a second rapid send may have already
        // joined this conversation via activeIdRef and appended its own
        // message before this timeout fires.
        setConvos(cs => cs.map(c => c.id === id ? { ...c, messages:[{ id:"m1", role:"student", text, time:now() }, ...c.messages] } : c));
        void replyViaGateway(id, text);
      }, 100);
      return;
    }

    addMessage(currentId, { role:"student", text, time:now() });
    void replyViaGateway(currentId, text);
  }

  function handleSuggestion(text: string) {
    sendMessage(text);
  }

  function newConversation() {
    setActiveId(null);
    setSidebarOpen(false);
  }

  function deleteConvo(id: string) {
    setConvos(cs => cs.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function pinConvo(id: string) {
    setConvos(cs => cs.map(c => c.id === id ? { ...c, pinned:!c.pinned } : c));
  }

  function starConvo(id: string) {
    setConvos(cs => cs.map(c => c.id === id ? { ...c, starred:!c.starred } : c));
  }

  function startRename(id: string) {
    const c = convos.find(x => x.id === id);
    if (c) { setRenaming(id); setRenameVal(c.title); }
  }

  function commitRename() {
    if (!renaming || !renameVal.trim()) { setRenaming(null); return; }
    setConvos(cs => cs.map(c => c.id === renaming ? { ...c, title:renameVal.trim() } : c));
    setRenaming(null);
  }

  function bookmarkMsg(msgId: string) {
    if (!activeId) return;
    setConvos(cs => cs.map(c => c.id === activeId
      ? { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, bookmarked:!m.bookmarked } : m) }
      : c
    ));
  }

  function regenerateLast() {
    if (!activeId) return;
    const c = convos.find(x => x.id === activeId);
    if (!c || c.messages.length === 0) return;
    const studentMsgs = c.messages.filter(m => m.role === "student");
    const lastQ = studentMsgs[studentMsgs.length - 1];
    if (!lastQ) return;
    const last = c.messages[c.messages.length - 1];
    if (last?.role === "nova") {
      if (user?.id) {
        void recordAiFeedback({
          request_id: last.requestId ?? null,
          school_id: schoolId ?? null,
          actor_user_id: user.id,
          actor_role: role ?? "student",
          feature_id: last.featureId ?? null,
          signal_type: "retry",
        });
      }
      setConvos(cs => cs.map(x => x.id === activeId
        ? { ...x, messages: x.messages.filter(m => m.id !== last.id) }
        : x
      ));
    }
    void replyViaGateway(activeId, lastQ.text);
  }

  async function sendFeedback(msgId: string, signal: "like" | "dislike") {
    if (!activeId || !user?.id) {
      toast.message("Sign in to send feedback");
      return;
    }
    const c = convos.find((x) => x.id === activeId);
    const msg = c?.messages.find((m) => m.id === msgId);
    if (!msg || msg.role !== "nova") return;

    setConvos((cs) =>
      cs.map((convo) =>
        convo.id === activeId
          ? {
              ...convo,
              messages: convo.messages.map((m) =>
                m.id === msgId ? { ...m, feedback: signal } : m,
              ),
            }
          : convo,
      ),
    );

    const result = await recordAiFeedback({
      request_id: msg.requestId ?? null,
      school_id: schoolId ?? null,
      actor_user_id: user.id,
      actor_role: role ?? "student",
      feature_id: msg.featureId ?? null,
      signal_type: signal,
    });
    if (!result.ok) {
      toast.error("Could not save feedback");
    }
  }

  return (
    <div className="flex h-[calc(100vh-80px)] -mx-4 sm:-mx-6 lg:-mx-8 overflow-hidden">

      {/* ── Sidebar (desktop always visible, mobile overlay) ── */}
      <div className={cn(
        "shrink-0 border-r border-white/5 transition-all duration-300 overflow-hidden",
        "hidden lg:block",
        "w-64"
      )}>
        <Sidebar convos={convos} activeId={activeId}
          onSelect={id => { setActiveId(id); setSidebarOpen(false); }}
          onNew={newConversation} onDelete={deleteConvo}
          onPin={pinConvo} onStar={starConvo} onRename={startRename}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="w-72 shrink-0">
            <Sidebar convos={convos} activeId={activeId}
              onSelect={id => { setActiveId(id); setSidebarOpen(false); }}
              onNew={newConversation} onDelete={deleteConvo}
              onPin={pinConvo} onStar={starConvo} onRename={startRename}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)}/>
        </div>
      )}

      {/* ── Main conversation area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Conversation header */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <button onClick={() => setSidebarOpen(true)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all lg:hidden">
            <ChevronLeft className="w-4 h-4"/>
          </button>

          {/* Rename input / title */}
          {renaming === activeId ? (
            <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename} onKeyDown={e => e.key==="Enter" && commitRename()}
              className="flex-1 bg-transparent text-sm font-semibold text-white outline-none border-b border-[#3b5bdb]/40 pb-0.5"/>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {active?.title ?? "New Conversation"}
              </div>
              {active && (
                <div className="flex items-center gap-1 text-[10px] text-[#78788c]">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                  Nova · Ready
                </div>
              )}
            </div>
          )}

          {/* Header actions */}
          <div className="flex items-center gap-1 shrink-0">
            {active && <>
              <button onClick={() => startRename(active.id)} title="Rename"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all">
                <Edit3 className="w-3.5 h-3.5"/>
              </button>
              <button onClick={() => pinConvo(active.id)} title={active.pinned?"Unpin":"Pin"}
                className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                  active.pinned ? "text-blue-400 bg-blue-400/10" : "text-[#78788c] hover:text-white hover:bg-white/6"
                )}>
                <Pin className="w-3.5 h-3.5"/>
              </button>
              <button onClick={() => starConvo(active.id)} title={active.starred?"Unstar":"Star"}
                className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                  active.starred ? "text-amber-400 bg-amber-400/10" : "text-[#78788c] hover:text-white hover:bg-white/6"
                )}>
                <Star className={cn("w-3.5 h-3.5", active.starred && "fill-amber-400")}/>
              </button>
            </>}
            <button onClick={newConversation} title="New conversation"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/6 transition-all">
              <Plus className="w-3.5 h-3.5"/>
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto scrollbar-none">
          {msgs.length === 0 ? (
            <SuggestionGrid
              onSelect={handleSuggestion}
              onNavigate={setPage}
              firstName={student.firstName}
              chips={novaChips}
            />
          ) : (
            <div className="px-4 py-4 space-y-5 max-w-3xl mx-auto w-full">
              <ContextPill contextLine={contextLine} />
              {msgs.map((m, i) => (
                <MessageBubble key={m.id} msg={m}
                  onBookmark={bookmarkMsg}
                  onFeedback={m.role === "nova" ? sendFeedback : undefined}
                  onRegen={m.role==="nova" && i===msgs.length-1 ? regenerateLast : undefined}
                  isLast={i===msgs.length-1}
                />
              ))}
              {isTyping && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background:"radial-gradient(circle at 35% 35%, #60a5fa, #3b5bdb)" }}>
                    <Brain className="w-4 h-4 text-white"/>
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-[#131316] border border-white/7 flex items-center gap-1.5">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb] animate-bounce"
                        style={{ animationDelay:`${i*0.15}s` }}/>
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef}/>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-white/5 max-w-3xl mx-auto w-full">
          <InputBar
            onSend={sendMessage}
            onVoiceUnavailable={() => {
              toast.message(comingSoonToast("Voice input"));
            }}
            onAttachUnavailable={() => {
              toast.message(comingSoonToast("Attachments"));
            }}
            disabled={isTyping}
          />
        </div>
      </div>
    </div>
  );
}
