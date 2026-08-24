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
import {
  askAiCoach, recordAiFeedback, AI_BILLING_UNAVAILABLE_MSG, isAiBillingOrCreditsIssue,
  type NovaRecentTurn, type NovaQuestionContext,
} from "@/academic/ai/gatewayClient";
import { buildNovaUiChips, dedupeSubjects, isPlaceholderLabel } from "@/academic/ai/novaContextBuilder";
import { consumeNovaQuestionContext } from "@/gurukul/novaQuestionContext";
import {
  processAttachmentFile, AttachmentError,
  ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENTS,
} from "@/gurukul/novaAttachments";
import { WEAK_CONCEPT_THRESHOLD } from "@/academic/eie/masteryBands";
import { NovaMarkdown } from "@/components/NovaMarkdown";
import { useAuth } from "@/auth";
import { novaConversationsKey } from "@/lib/clientStorage";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import {
  Mic, Send, Plus, Search, Pin, Star, Trash2, Edit3,
  MoreHorizontal, ChevronLeft, Paperclip, Copy, Bookmark,
  RotateCcw, X, Loader2, ImageIcon,
  BookOpen, HelpCircle, Brain, Sparkles,
  MessageSquare, Check, AlertCircle, Globe, Layers,
  ThumbsUp, ThumbsDown, CalendarDays,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type Role = "nova" | "student";

interface Message {
  id: string; role: Role; text: string; time: string;
  bookmarked?: boolean;
  requestId?: string;
  featureId?: string;
  feedback?: "like" | "dislike" | null;
  /** True for offline/network-failure fallback text — rendered distinctly from a real reply. */
  isError?: boolean;
  /** How many photos/pages were attached — images themselves are never persisted or re-shown. */
  imageCount?: number;
}

interface Conversation {
  id: string; title: string; preview: string; date: string;
  pinned?: boolean; starred?: boolean; messages: Message[];
  /** Gateway multi-turn session id (when available) */
  sessionId?: string;
  /** The practice question this conversation was opened about, if any — sent on every turn. */
  questionContext?: NovaQuestionContext;
}


// ── Honest empty conversation list (never seed demo chats) ────────────────────
const EMPTY_CONVOS: Conversation[] = [];

function genId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}${crypto.randomUUID()}`;
  }
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const SUGGESTIONS = [
  { icon:<HelpCircle className="w-4 h-4"/>,    text:"What is my attendance this month?",     color:"#3b5bdb" },
  { icon:<Layers className="w-4 h-4"/>,         text:"Which homework is due soon?",           color:"#4b9fd4" },
  { icon:<BookOpen className="w-4 h-4"/>,       text:"Show my marks summary",                 color:"#6882e8" },
  { icon:<CalendarDays className="w-4 h-4"/>,   text:"Any upcoming school events or holidays?", color:"#4aa87a" },
  { icon:<Sparkles className="w-4 h-4"/>,       text:"What should I revise? Show mastery",    color:"#c08a3a" },
  { icon:<MessageSquare className="w-4 h-4"/>,  text:"Explain my performance from school records", color:"#cc5069" },
  { icon:<Globe className="w-4 h-4"/>,          text:"Summarise my weak concepts",            color:"#4b9fd4" },
  { icon:<AlertCircle className="w-4 h-4"/>,    text:"How am I doing in attendance and marks?",color:"#c08a3a" },
];

function loadStoredConvos(key: string | null): Conversation[] {
  if (!key) return EMPTY_CONVOS;
  try {
    const raw = localStorage.getItem(key);
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
    "Ask about attendance, homework due, marks, upcoming school events, or mastery/revision — " +
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
    navigator.clipboard.writeText(msg.text).then(
      () => { setCopied(true); setTimeout(()=>setCopied(false), 1500); },
      () => { toast.error("Could not copy — clipboard access denied"); },
    );
  }

  // Render markdown-like bold and newlines
  function renderText(txt: string) {
    return txt.split("\n").map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
        p.startsWith("**") ? <strong key={j} className="text-foreground font-semibold">{p.slice(2,-2)}</strong> : p
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
          <Brain className="w-4 h-4 text-foreground"/>
        </div>
      )}

      <div className={cn("flex flex-col gap-1 max-w-[78%]", isNova ? "items-start" : "items-end")}>

        {/* Bubble */}
        <div className={cn(
          "px-4 py-3 rounded-2xl text-sm leading-relaxed",
          isNova
            ? msg.isError
              ? "bg-amber-400/5 border border-amber-400/25 text-foreground"
              : "bg-surface border border-border/70 text-foreground"
            : "text-foreground"
        )}
        style={!isNova ? { background:"linear-gradient(135deg,#3b5bdb,#2563eb)", boxShadow:"0 4px 16px rgba(59,130,246,0.25)" } : {}}>
          {msg.isError && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              <AlertCircle className="w-3 h-3"/> Connection issue — not a live answer
            </div>
          )}
          {!!msg.imageCount && (
            <div className={cn("flex items-center gap-1.5 mb-1.5 text-[10px] font-medium", isNova ? "text-muted-foreground" : "text-foreground/70")}>
              <ImageIcon className="w-3 h-3"/> {msg.imageCount} photo{msg.imageCount > 1 ? "s" : ""} attached
            </div>
          )}
          {isNova ? <NovaMarkdown text={msg.text} /> : renderText(msg.text)}
        </div>

        {/* Timestamp + actions */}
        <div className={cn("flex items-center gap-2 px-1", isNova ? "flex-row" : "flex-row-reverse")}>
          <span className="text-[10px] text-muted-foreground">{msg.time}</span>
          <div className={cn(
            "flex items-center gap-0.5 transition-opacity",
            isNova ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <button onClick={copy} title="Copy"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
              {copied ? <Check className="w-3 h-3 text-emerald-400"/> : <Copy className="w-3 h-3"/>}
            </button>
            <button onClick={() => onBookmark(msg.id)} title="Bookmark"
              className={cn("w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                msg.bookmarked ? "text-amber-400 bg-amber-400/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <ThumbsDown className="w-3 h-3"/>
                </button>
              </>
            )}
            {isNova && isLast && onRegen && (
              <button onClick={onRegen} title="Regenerate"
                className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
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
        className="group flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/70 bg-muted"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
        <span className="text-[11px] text-muted-foreground">
          Nova knows your context{contextLine ? ` · ${contextLine}` : ""}
        </span>
        <Brain className="w-3 h-3 text-muted-foreground"/>
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
        <Brain className="w-9 h-9 text-foreground"/>
      </div>
      <h2 className="text-2xl font-black text-foreground mb-1" style={{fontFamily:"var(--font-display)"}}>
        Hi {firstName && !isPlaceholderLabel(firstName) ? firstName : "there"} 💋
      </h2>
      <p className="text-muted-foreground text-sm mb-8 text-center max-w-xs">
        I'm Nova — your personal academic tutor. Ask about attendance, homework, marks, school events, or revision.
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
            className="group flex items-center gap-3 p-3.5 rounded-2xl border border-border/70 bg-surface/60 hover:border-border hover:bg-surface transition-all text-left">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
              style={{ background:`${s.color}15`, color:s.color }}>
              {s.icon}
            </div>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors leading-snug">{s.text}</span>
          </button>
        ))}
      </div>

      {onNavigate && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11px] text-muted-foreground w-full text-center mb-1">Jump to</span>
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
        isActive ? "bg-[#3b5bdb]/12 border border-[#3b5bdb]/20" : "hover:bg-muted"
      )} onClick={() => onSelect(c.id)}>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            {c.pinned  && <Pin    className="w-2.5 h-2.5 text-blue-400 shrink-0"/>}
            {c.starred && <Star   className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0"/>}
            <span className={cn(
              "text-xs font-semibold truncate",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}>{c.title}</span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">{c.preview}</div>
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
          className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-all shrink-0">
          <MoreHorizontal className="w-3.5 h-3.5"/>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
              style={{ background:"radial-gradient(circle, #3b5bdb, #4338ca)" }}>
              <Brain className="w-3.5 h-3.5 text-foreground"/>
            </div>
            <span className="text-sm font-black text-foreground" style={{fontFamily:"var(--font-display)"}}>Nova</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onNew}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all" title="New conversation">
              <Plus className="w-4 h-4"/>
            </button>
            {onClose && (
              <button onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all lg:hidden">
                <X className="w-4 h-4"/>
              </button>
            )}
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-[#3b5bdb]/30 transition-colors"/>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-none" onClick={() => { setMenuFor(null); setMenuPos(null); }}>
        {pinned.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60">Pinned</div>
            {pinned.map(c => <ConvoItem key={c.id} c={c}/>)}
          </div>
        )}
        {Object.entries(groups).map(([date, cs]) => (
          <div key={date}>
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60">{date}</div>
            {cs.map(c => <ConvoItem key={c.id} c={c}/>)}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-xs text-muted-foreground">No conversations found</div>
        )}
      </div>

      {activeMenuConvo && menuPos && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-overlay bg-surface border border-border rounded-xl shadow-xl py-1 min-w-[140px]"
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
                item.danger ? "text-rose-400 hover:bg-rose-400/10" : "text-muted-foreground hover:text-foreground hover:bg-muted",
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
  onSend, onVoiceUnavailable, disabled,
}: {
  onSend: (text: string, images?: string[]) => void;
  onVoiceUnavailable: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachPresentation = resolveNovaPresentation("attachment");
  const voicePresentation = resolveNovaPresentation("voice");

  function submit() {
    if ((!text.trim() && pendingImages.length === 0) || disabled || processing) return;
    onSend(text.trim() || "Please help me with this.", pendingImages.length ? pendingImages : undefined);
    setText("");
    setPendingImages([]);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_ATTACHMENTS - pendingImages.length;
    if (room <= 0) {
      toast.message(`You can attach up to ${MAX_ATTACHMENTS} photos/pages at a time.`);
      return;
    }
    setProcessing(true);
    try {
      const collected: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        try {
          const uris = await processAttachmentFile(file);
          collected.push(...uris);
        } catch (e) {
          toast.error(e instanceof AttachmentError ? e.message : `Could not process "${file.name}".`);
        }
      }
      if (collected.length) {
        setPendingImages((prev) => [...prev, ...collected].slice(0, MAX_ATTACHMENTS));
      }
    } finally {
      setProcessing(false);
    }
  }

  function removePendingImage(index: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  return (
    <div className="relative">
      {pendingImages.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-1">
          {pendingImages.map((uri, i) => (
            <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border shrink-0 group">
              <img src={uri} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removePendingImage(i)}
                aria-label="Remove attachment"
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5"/>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 bg-surface border border-border rounded-2xl p-2 focus-within:border-[#3b5bdb]/30 transition-all">
        {attachPresentation !== "hidden" && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES}
              multiple
              className="hidden"
              onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() =>
                attachPresentation === "coming_soon"
                  ? toast.message(comingSoonToast("Attachments"))
                  : fileInputRef.current?.click()
              }
              disabled={processing}
              title={
                attachPresentation === "coming_soon"
                  ? `Attachments — ${COMING_SOON_LABEL}`
                  : "Attach a photo or PDF"
              }
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Paperclip className="w-4 h-4"/>}
            </button>
          </>
        )}

        <textarea
          ref={textareaRef}
          value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder={pendingImages.length ? "Add a note (optional)…" : "Ask Nova anything…"}
          rows={1} disabled={disabled}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none py-1.5 leading-relaxed"
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
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-all shrink-0 mb-0.5"
          >
            <Mic className="w-4 h-4"/>
          </button>
        )}

        <button type="button" onClick={submit}
          disabled={(!text.trim() && pendingImages.length === 0) || disabled || processing}
          aria-label="Send message"
          className={cn(
            "w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5",
            (text.trim() || pendingImages.length > 0) && !disabled && !processing
              ? "bg-[#3b5bdb] text-foreground hover:bg-blue-500"
              : "text-muted-foreground/40 cursor-not-allowed"
          )}>
          <Send className="w-4 h-4"/>
        </button>
      </div>
      <div className="text-center mt-1.5">
        <span className="text-[10px] text-muted-foreground/50">Press âŽ to send · ⇧âŽ for new line · Answers use your live school records</span>
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

  const convoStorageKey = novaConversationsKey({ userId: user?.id, schoolId: schoolId ?? undefined });
  const [convos,     setConvos]     = useState<Conversation[]>(EMPTY_CONVOS);
  const [activeId,   setActiveId]   = useState<string|null>(null);
  const [sidebarOpen,setSidebarOpen]= useState(false);
  const [renaming,   setRenaming]   = useState<string|null>(null);
  const [renameVal,  setRenameVal]  = useState("");
  // Scoped per conversation (not one global flag) — switching conversations while a reply is
  // pending must not show/hide the wrong conversation's loading state, and two overlapping
  // requests must not be able to clear each other's indicator early.
  const [pendingConvoIds, setPendingConvoIds] = useState<Set<string>>(() => new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const convosRef = useRef(convos);
  convosRef.current = convos;
  // activeId (state) does not update until the next render commits, so a
  // second rapid sendMessage() call in that window would still see the old
  // value. Mirror it into a ref that sendMessage can also update
  // synchronously the instant a new conversation is created.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // Guards Regenerate against rapid double-clicks: two fast clicks before
  // React commits the optimistic message removal would both read the same
  // pre-removal snapshot and fire duplicate gateway calls. A ref check is
  // synchronous and re-render-independent, unlike state.
  const regenBusyRef = useRef(false);
  // One in-flight AbortController per conversation — lets delete/unmount actually
  // cancel the underlying request instead of letting an orphaned reply keep billing.
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Guards against double-submission at the network-call level (not just UI disabled
  // state) — set synchronously before any await, so a race that slips past the UI
  // guard still can't fire a second gateway call for the same conversation.
  const pendingConvoIdsRef = useRef<Set<string>>(new Set());

  const active = activeId ? convos.find(c => c.id === activeId) ?? null : null;
  const msgs   = active?.messages ?? [];
  const isTyping = activeId ? pendingConvoIds.has(activeId) : false;

  // One-shot handoff from a result screen ("Ask Nova about this question") — consumed once.
  useEffect(() => {
    const ctx = consumeNovaQuestionContext();
    if (!ctx) return;
    const id = genId("c");
    const newConvo: Conversation = {
      id,
      title: ctx.question.slice(0, 40) || "Question",
      preview: "Ask Nova about this question",
      date: "Today",
      messages: [],
      questionContext: ctx,
    };
    activeIdRef.current = id;
    setConvos((cs) => [newConvo, ...cs]);
    setActiveId(id);
  }, []);

  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
  }, []);

  // Load only once identity is known, so a conversation list is never read or
  // written under a key that isn't this user's.
  useEffect(() => {
    setConvos(loadStoredConvos(convoStorageKey));
  }, [convoStorageKey]);

  useEffect(() => {
    if (!convoStorageKey) return;
    try {
      localStorage.setItem(convoStorageKey, JSON.stringify(convos.slice(0, 40)));
    } catch {
      /* ignore quota */
    }
  }, [convos, convoStorageKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [msgs, isTyping]);

  function addMessage(convoId: string, msg: Omit<Message,"id">) {
    setConvos(cs => cs.map(c => c.id === convoId
      ? { ...c, messages:[...c.messages, { ...msg, id:genId("m") }],
          preview: msg.text.slice(0,60) + (msg.text.length>60?"…":"") }
      : c
    ));
  }

  function setPending(convoId: string, pending: boolean) {
    if (pending) pendingConvoIdsRef.current.add(convoId);
    else pendingConvoIdsRef.current.delete(convoId);
    setPendingConvoIds(new Set(pendingConvoIdsRef.current));
  }

  async function replyViaGateway(convoId: string, text: string, images?: string[]) {
    // Network-call-level guard — catches races the UI's disabled state can't (e.g. Regenerate
    // firing while a send for the same conversation is already in flight).
    if (pendingConvoIdsRef.current.has(convoId)) return;
    setPending(convoId, true);

    const controller = new AbortController();
    abortControllersRef.current.set(convoId, controller);

    try {
      const existing = convosRef.current.find((c) => c.id === convoId);
      // Last few turns (before this one) so Nova can resolve follow-ups like "give me an example".
      const recentTurns: NovaRecentTurn[] = (existing?.messages ?? [])
        .slice(-6)
        .map((m) => ({ role: m.role === "nova" ? "nova" : "student", text: m.text }));

      const result = await askAiCoach({
        text,
        studentId: studentId || undefined,
        role: role === "student" || role === "parent" || role === "teacher" || role === "principal" || role === "admin"
          ? role
          : "student",
        channel: "student_app",
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
        session_id: existing?.sessionId,
        open_session: !existing?.sessionId,
        recentTurns,
        questionContext: existing?.questionContext,
        images,
        signal: controller.signal,
      });

      if (!result) return; // cancelled (conversation deleted / component unmounted) — no-op

      const { text: reply, response } = result;
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
                    id: genId("m"),
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
      if (controller.signal.aborted) return; // cancelled, not a real failure
      toast.error("AI Gateway unavailable");
      setConvos((cs) =>
        cs.map((c) =>
          c.id === convoId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { id: genId("m"), role: "nova", text: offlineFallback(), time: now(), isError: true },
                ],
              }
            : c,
        ),
      );
    } finally {
      abortControllersRef.current.delete(convoId);
      setPending(convoId, false);
    }
  }

  function sendMessage(text: string, images?: string[]) {
    const currentId = activeIdRef.current;
    if (!currentId) {
      const id = genId("c");
      const newConvo: Conversation = {
        id, title: text.slice(0,40) || "New Conversation",
        preview: text.slice(0,60), date:"Today",
        messages: [{ id: genId("m"), role:"student", text, time:now(), imageCount: images?.length }],
      };
      // Update the ref synchronously so a second send fired before this
      // state update commits still finds this conversation instead of
      // creating another one.
      activeIdRef.current = id;
      setConvos(cs => [newConvo, ...cs]);
      setActiveId(id);
      void replyViaGateway(id, text, images);
      return;
    }

    addMessage(currentId, { role:"student", text, time:now(), imageCount: images?.length });
    void replyViaGateway(currentId, text, images);
  }

  function handleSuggestion(text: string) {
    sendMessage(text);
  }

  function newConversation() {
    setActiveId(null);
    setSidebarOpen(false);
  }

  function deleteConvo(id: string) {
    abortControllersRef.current.get(id)?.abort();
    abortControllersRef.current.delete(id);
    setPending(id, false);
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
    if (!c) return;
    // The rename input only renders in the header for the active conversation — switch to
    // it first so renaming a non-active conversation (from the sidebar menu) is visible.
    if (activeIdRef.current !== id) {
      activeIdRef.current = id;
      setActiveId(id);
    }
    setRenaming(id); setRenameVal(c.title);
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
    if (regenBusyRef.current) return;
    if (!activeId) return;
    const c = convos.find(x => x.id === activeId);
    if (!c || c.messages.length === 0) return;
    const studentMsgs = c.messages.filter(m => m.role === "student");
    const lastQ = studentMsgs[studentMsgs.length - 1];
    if (!lastQ) return;
    regenBusyRef.current = true;
    const last = c.messages[c.messages.length - 1];
    if (last?.role === "nova") {
      if (user?.id) {
        recordAiFeedback({
          request_id: last.requestId ?? null,
          school_id: schoolId ?? null,
          actor_user_id: user.id,
          actor_role: role ?? "student",
          feature_id: last.featureId ?? null,
          signal_type: "retry",
        }).catch(() => { /* best-effort telemetry — never blocks regenerate */ });
      }
      setConvos(cs => cs.map(x => x.id === activeId
        ? { ...x, messages: x.messages.filter(m => m.id !== last.id) }
        : x
      ));
    }
    void replyViaGateway(activeId, lastQ.text).finally(() => {
      regenBusyRef.current = false;
    });
  }

  async function sendFeedback(msgId: string, signal: "like" | "dislike") {
    if (!activeId || !user?.id) {
      toast.message("Sign in to send feedback");
      return;
    }
    const c = convos.find((x) => x.id === activeId);
    const msg = c?.messages.find((m) => m.id === msgId);
    if (!msg || msg.role !== "nova") return;
    const previousFeedback = msg.feedback ?? null;

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

    function revert() {
      setConvos((cs) =>
        cs.map((convo) =>
          convo.id === activeId
            ? {
                ...convo,
                messages: convo.messages.map((m) =>
                  m.id === msgId ? { ...m, feedback: previousFeedback } : m,
                ),
              }
            : convo,
        ),
      );
    }

    try {
      const result = await recordAiFeedback({
        request_id: msg.requestId ?? null,
        school_id: schoolId ?? null,
        actor_user_id: user.id,
        actor_role: role ?? "student",
        feature_id: msg.featureId ?? null,
        signal_type: signal,
      });
      if (!result.ok) {
        revert();
        toast.error("Could not save feedback");
      }
    } catch {
      revert();
      toast.error("Could not save feedback");
    }
  }

  return (
    <div className="flex h-[calc(100vh-80px)] -mx-4 sm:-mx-6 lg:-mx-8 overflow-hidden">

      {/* ── Sidebar (desktop always visible, mobile overlay) ── */}
      <div className={cn(
        "shrink-0 border-r border-border transition-all duration-300 overflow-hidden",
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
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border">
          <button onClick={() => setSidebarOpen(true)} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all lg:hidden">
            <ChevronLeft className="w-4 h-4"/>
          </button>

          {/* Rename input / title */}
          {renaming === activeId ? (
            <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename} onKeyDown={e => e.key==="Enter" && commitRename()}
              className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none border-b border-[#3b5bdb]/40 pb-0.5"/>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {active?.title ?? "New Conversation"}
              </div>
              {active && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
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
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                <Edit3 className="w-3.5 h-3.5"/>
              </button>
              <button onClick={() => pinConvo(active.id)} title={active.pinned?"Unpin":"Pin"}
                className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                  active.pinned ? "text-blue-400 bg-blue-400/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}>
                <Pin className="w-3.5 h-3.5"/>
              </button>
              <button onClick={() => starConvo(active.id)} title={active.starred?"Unstar":"Star"}
                className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                  active.starred ? "text-amber-400 bg-amber-400/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}>
                <Star className={cn("w-3.5 h-3.5", active.starred && "fill-amber-400")}/>
              </button>
            </>}
            <button onClick={newConversation} title="New conversation"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
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
                    <Brain className="w-4 h-4 text-foreground"/>
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-surface border border-border/70 flex items-center gap-1.5">
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
        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border max-w-3xl mx-auto w-full">
          <InputBar
            onSend={sendMessage}
            onVoiceUnavailable={() => {
              toast.message(comingSoonToast("Voice input"));
            }}
            disabled={isTyping}
          />
        </div>
      </div>
    </div>
  );
}
