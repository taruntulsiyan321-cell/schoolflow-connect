import { useState, useEffect, useMemo } from "react";
import { DoubtService, PracticeService, type ServiceContext, useAcademicLive } from "@/academic";
import { askAiCoach, AI_BILLING_UNAVAILABLE_MSG, isAiBillingOrCreditsIssue } from "@/academic/ai/gatewayClient";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard, SubjectBadge, cn, subjectColor } from "@/gurukul/components/shared";
import { subjectsForStreamPicker, type AcademicStream } from "@/lib/curriculumScope";
import { getNcertSubjects } from "@/lib/ncertSyllabus";
import { toast } from "sonner";
import {
  MessageCircle, Plus, Search, Filter, ThumbsUp, Bookmark, BookmarkCheck,
  CheckCircle2, Clock, ChevronDown, ChevronRight, Brain, Send, Mic,
  Image, FileText, Camera, X, Bell, Star, ArrowRight, SortAsc,
  AlertCircle, Eye, Hash, User, Sparkles, MoreHorizontal,
} from "lucide-react";

const FALLBACK_SUBJECTS = ["Mathematics", "English", "Hindi"];

function useScopedSubjects() {
  const { ctx, ready } = useAcademicContext();
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
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
  }, [ready, ctx]);

  const subjects = useMemo(
    () => subjectsForStreamPicker(stream, classLevel, getNcertSubjects(classLevel) || FALLBACK_SUBJECTS),
    [stream, classLevel],
  );

  return { subjects, classLevel, stream };
}

// ── Types ──────────────────────────────────────────────────────────────────────
type DoubtStatus = "pending" | "answered" | "closed";
type DView = "feed" | "detail" | "ask" | "mydoubts";

const STATUS_OPTS: { label: string; val: DoubtStatus | "all" }[] = [
  { label:"All", val:"all" }, { label:"Pending", val:"pending" },
  { label:"Answered", val:"answered" }, { label:"Closed", val:"closed" },
];
interface Reply {
  id: string; author: string; avatar: string; authorColor: string;
  text: string; time: string; likes: number; likedByMe: boolean;
  isTeacher: boolean; isAccepted: boolean; isHelpful: boolean;
  isAI?: boolean;
}

interface Doubt {
  id: string; title: string; body: string;
  subject: string; chapter: string; topic: string;
  authorName: string; authorAvatar: string; authorColor: string;
  authorRank: number; date: string; time: string;
  status: DoubtStatus; views: number; replies: Reply[];
  answerCount: number;
  upvotes: number; upvotedByMe: boolean; bookmarked: boolean;
  attachments: string[]; mine: boolean; tags: string[];
}

type DbDoubtRow = {
  id: string;
  user_id: string;
  student_name: string;
  subject: string | null;
  chapter: string | null;
  concept: string | null;
  title: string;
  body: string;
  status: string;
  view_count: number;
  upvote_count: number;
  answer_count?: number;
  image_url: string | null;
  created_at: string;
};

type DbAnswerRow = {
  id: string;
  author_name: string;
  author_role: string;
  body: string;
  is_teacher_verified: boolean;
  is_accepted: boolean;
  upvote_count: number;
  created_at: string;
};

const AI_SUGGESTIONS = [
  "How does integration by parts work?",
  "What is the SN1 mechanism?",
  "Explain Mendel's laws simply",
  "How to find integrating factor?",
  "What is Gauss's law?",
];

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "??";
}

function mapDbStatus(status: string): DoubtStatus {
  if (status === "unsolved") return "pending";
  if (status === "solved") return "closed";
  return "answered";
}

function mapRowToDoubt(row: DbDoubtRow, userId: string | undefined, bookmarked = false): Doubt {
  const created = new Date(row.created_at);
  const subj = row.subject ?? "General";
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    subject: subj,
    chapter: row.chapter ?? "",
    topic: row.concept ?? "",
    authorName: row.student_name,
    authorAvatar: initialsFromName(row.student_name),
    authorColor: subjectColor[subj] ?? "#3b5bdb",
    authorRank: 0,
    date: created.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    time: created.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
    status: mapDbStatus(row.status),
    views: row.view_count ?? 0,
    replies: [],
    answerCount: row.answer_count ?? 0,
    upvotes: row.upvote_count ?? 0,
    upvotedByMe: false,
    bookmarked,
    attachments: row.image_url ? [row.image_url] : [],
    mine: row.user_id === userId,
    tags: [row.subject, row.chapter, row.concept].filter(Boolean).map((t) => String(t).toLowerCase()),
  };
}

function mapAnswerRow(row: DbAnswerRow): Reply {
  const created = new Date(row.created_at);
  const isTeacher = row.author_role === "teacher";
  return {
    id: row.id,
    author: row.author_name,
    avatar: initialsFromName(row.author_name),
    authorColor: isTeacher ? "#c08a3a" : "#6882e8",
    text: row.body,
    time: created.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
    likes: row.upvote_count ?? 0,
    likedByMe: false,
    isTeacher,
    isAccepted: row.is_accepted ?? false,
    isHelpful: row.is_teacher_verified ?? false,
    isAI: false,
  };
}

async function loadAnswersForDoubt(doubtId: string): Promise<Reply[]> {
  await (supabase.rpc as any)("rpc_record_community_doubt_view", { _doubt_id: doubtId }).catch(() => undefined);
  const { data, error } = await supabase
    .from("community_doubt_answers")
    .select("*")
    .eq("doubt_id", doubtId)
    .order("is_accepted", { ascending: false })
    .order("is_teacher_verified", { ascending: false })
    .order("upvote_count", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as DbAnswerRow[]).map(mapAnswerRow);
}

async function loadMyVoteState(doubtId: string, userId: string | undefined) {
  if (!userId) return { upvotedDoubt: false, likedAnswers: new Set<string>() };
  const [{ data: doubtVotes }, { data: answerVotes }] = await Promise.all([
    supabase
      .from("community_doubt_votes")
      .select("doubt_id, answer_id")
      .eq("user_id", userId)
      .eq("doubt_id", doubtId),
    supabase
      .from("community_doubt_votes")
      .select("answer_id")
      .eq("user_id", userId)
      .not("answer_id", "is", null),
  ]);
  const likedAnswers = new Set(
    (answerVotes ?? [])
      .map((v) => v.answer_id)
      .filter((id): id is string => Boolean(id)),
  );
  return {
    upvotedDoubt: (doubtVotes ?? []).some((v) => v.doubt_id === doubtId && !v.answer_id),
    likedAnswers,
  };
}

const DOUBT_BOOKMARK_KEY = "gurukul.doubt.bookmarks";

function readDoubtBookmarks(userId: string | undefined): Set<string> {
  if (!userId || typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(`${DOUBT_BOOKMARK_KEY}.${userId}`);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeDoubtBookmarks(userId: string | undefined, ids: Set<string>) {
  if (!userId || typeof localStorage === "undefined") return;
  localStorage.setItem(`${DOUBT_BOOKMARK_KEY}.${userId}`, JSON.stringify([...ids]));
}

// ── Helper components ──────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: DoubtStatus }) {
  const cfg = {
    pending:  { color:"#c08a3a", bg:"rgba(245,158,11,0.12)", label:"Pending", icon:<Clock className="w-2.5 h-2.5"/> },
    answered: { color:"#4aa87a", bg:"rgba(52,211,153,0.12)", label:"Answered", icon:<CheckCircle2 className="w-2.5 h-2.5"/> },
    closed:   { color:"#78788c", bg:"rgba(107,122,153,0.12)", label:"Closed", icon:<X className="w-2.5 h-2.5"/> },
  }[status];
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{color:cfg.color,background:cfg.bg}}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function AvatarBubble({ initials, color, size=8, isTeacher=false, isAI=false }: { initials:string; color:string; size?:number; isTeacher?:boolean; isAI?:boolean }) {
  const s = `w-${size} h-${size}`;
  if (isAI) return (
    <div className={cn(s,"rounded-full flex items-center justify-center shrink-0 text-white")}
      style={{background:"linear-gradient(135deg,#6882e8,#7c3aed)"}}>
      <Sparkles className="w-3.5 h-3.5"/>
    </div>
  );
  return (
    <div className={cn(s,"rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0")}
      style={{background:`linear-gradient(135deg,${color},${color}99)`, boxShadow: isTeacher ? `0 0 10px ${color}60` : undefined}}>
      {initials}
    </div>
  );
}

function ReplyBubble({ reply, onLike }: { reply: Reply; onLike: (id: string) => void }) {
  return (
    <div className={cn(
      "flex gap-3 p-3 rounded-xl transition-all",
      reply.isAccepted ? "bg-emerald-500/8 border border-emerald-500/20" :
      reply.isAI ? "bg-violet-500/8 border border-violet-500/15" :
      "bg-white/2 border border-white/6"
    )}>
      <AvatarBubble initials={reply.avatar} color={reply.authorColor} size={8} isTeacher={reply.isTeacher} isAI={reply.isAI}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-white">{reply.author}</span>
          {reply.isTeacher && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400">Teacher</span>}
          {reply.isAI && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-400/15 text-violet-400">Nova AI</span>}
          {reply.isAccepted && <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-400"><CheckCircle2 className="w-2.5 h-2.5"/>Accepted</span>}
          <span className="text-[10px] text-[#78788c] ml-auto">{reply.time}</span>
        </div>
        <p className="text-xs text-[#d0d8f0] leading-relaxed">{reply.text}</p>
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => onLike(reply.id)}
            className={cn("flex items-center gap-1 text-[10px] font-semibold transition-all", reply.likedByMe ? "text-[#818cf8]" : "text-[#78788c] hover:text-white")}>
            <ThumbsUp className={cn("w-3 h-3", reply.likedByMe && "fill-blue-400")}/> {reply.likes}
          </button>
          {reply.isHelpful && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Star className="w-3 h-3 fill-emerald-400"/>Helpful</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DoubtCard({ doubt, onClick }: { doubt: Doubt; onClick: () => void }) {
  return (
    <GlassCard className="p-4 hover:border-white/20 cursor-pointer transition-all group" onClick={onClick}>
      <div className="flex items-start gap-3">
        <AvatarBubble initials={doubt.authorAvatar} color={doubt.authorColor} size={8}/>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <SubjectBadge subject={doubt.subject}/>
            <StatusBadge status={doubt.status}/>
            {doubt.mine && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/12 text-[#818cf8]">Mine</span>}
          </div>
          <h3 className="text-sm font-bold text-white leading-snug group-hover:text-[#a5b4fc] transition-colors">{doubt.title}</h3>
          <p className="text-xs text-[#78788c] mt-1 line-clamp-2 leading-relaxed">{doubt.body}</p>
          <div className="flex items-center gap-3 mt-2.5 text-[10px] text-[#78788c]">
            <span>{doubt.authorName} · {doubt.date}</span>
            <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3"/>{doubt.answerCount || doubt.replies.length}</span>
            <span className="flex items-center gap-1"><Eye className="w-3 h-3"/>{doubt.views}</span>
            <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3"/>{doubt.upvotes}</span>
            <span className="ml-auto text-[#818cf8] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              View <ArrowRight className="w-3 h-3"/>
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Detail View ────────────────────────────────────────────────────────────────
function DoubtDetail({ doubt, onBack, onUpdateDoubt }: {
  doubt: Doubt; onBack: () => void;
  onUpdateDoubt: (d: Doubt) => void;
}) {
  const student = useGurukulStudent();
  const { user, role } = useAuth();
  const { ctx, ready, studentId } = useAcademicContext();
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [voting, setVoting] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReply, setAiReply] = useState<string|null>(null);
  const [localDoubt, setLocalDoubt] = useState(doubt);
  const [loadingReplies, setLoadingReplies] = useState(true);

  useEffect(() => {
    setLocalDoubt(doubt);
    let cancelled = false;
    (async () => {
      setLoadingReplies(true);
      try {
        const [replies, votes] = await Promise.all([
          loadAnswersForDoubt(doubt.id),
          loadMyVoteState(doubt.id, user?.id),
        ]);
        if (cancelled) return;
        setLocalDoubt((d) => ({
          ...d,
          replies: replies.map((r) => ({
            ...r,
            likedByMe: votes.likedAnswers.has(r.id),
          })),
          answerCount: replies.length,
          upvotedByMe: votes.upvotedDoubt,
          bookmarked: readDoubtBookmarks(user?.id).has(doubt.id),
        }));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load replies");
      } finally {
        if (!cancelled) setLoadingReplies(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doubt.id, user?.id]);

  async function toggleUpvote() {
    if (!ctx || !ready || voting) return;
    setVoting(true);
    try {
      const count = await DoubtService.voteDoubt(ctx, localDoubt.id);
      setLocalDoubt((d) => {
        const next = { ...d, upvotes: count, upvotedByMe: !d.upvotedByMe };
        onUpdateDoubt(next);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update vote");
    } finally {
      setVoting(false);
    }
  }

  function toggleBookmark() {
    const bookmarks = readDoubtBookmarks(user?.id);
    if (bookmarks.has(localDoubt.id)) bookmarks.delete(localDoubt.id);
    else bookmarks.add(localDoubt.id);
    writeDoubtBookmarks(user?.id, bookmarks);
    setLocalDoubt((d) => {
      const next = { ...d, bookmarked: bookmarks.has(d.id) };
      onUpdateDoubt(next);
      return next;
    });
  }

  async function likeReply(rid: string) {
    if (!ctx || !ready || voting) return;
    setVoting(true);
    try {
      const count = await DoubtService.voteAnswer(ctx, rid);
      setLocalDoubt((d) => ({
        ...d,
        replies: d.replies.map((r) =>
          r.id === rid
            ? { ...r, likes: count, likedByMe: !r.likedByMe }
            : r,
        ),
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update vote");
    } finally {
      setVoting(false);
    }
  }

  async function sendReply() {
    if (!replyText.trim() || !ctx || !ready || replying) return;
    setReplying(true);
    try {
      await DoubtService.reply(ctx, {
        _doubt_id: localDoubt.id,
        _body: replyText.trim(),
        _image_url: null,
      });
      const replies = await loadAnswersForDoubt(localDoubt.id);
      const votes = await loadMyVoteState(localDoubt.id, user?.id);
      setLocalDoubt((d) => {
        const next = {
          ...d,
          replies: replies.map((r) => ({
            ...r,
            likedByMe: votes.likedAnswers.has(r.id),
          })),
          answerCount: replies.length,
          status: d.status === "pending" ? ("answered" as DoubtStatus) : d.status,
        };
        onUpdateDoubt(next);
        return next;
      });
      setReplyText("");
      toast.success("Reply posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post reply");
    } finally {
      setReplying(false);
    }
  }
  async function askAI() {
    setShowAI(true);
    setAiLoading(true);
    setAiReply(null);
    try {
      const prompt = [
        localDoubt.title,
        localDoubt.body,
        localDoubt.subject ? `Subject: ${localDoubt.subject}` : "",
        localDoubt.topic ? `Topic: ${localDoubt.topic}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const { text, response } = await askAiCoach({
        text: prompt || "Help me with this doubt",
        studentId: studentId || undefined,
        role: role === "student" || role === "parent" || role === "teacher" || role === "principal" || role === "admin"
          ? role
          : "student",
        feature_id: "student.nova.chat",
        channel: "student_app",
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      });
      if (isAiBillingOrCreditsIssue(response)) {
        toast.message(AI_BILLING_UNAVAILABLE_MSG);
      }
      setAiReply(text);
    } catch {
      toast.error("AI Gateway unavailable");
      setAiReply(
        "I couldn’t reach Nova just now. You can still post this doubt to your class for teacher and peer help.",
      );
    } finally {
      setAiLoading(false);
    }
  }

  const accepted = localDoubt.replies.find(r => r.isAccepted);

  return (
    <div className="space-y-5">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-[#78788c] hover:text-white transition-colors">
        <ChevronRight className="w-3.5 h-3.5 rotate-180"/> Back to Doubts
      </button>

      {/* Question card */}
      <GlassCard className="p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SubjectBadge subject={localDoubt.subject}/>
          <span className="text-[10px] text-[#78788c]">{localDoubt.chapter} · {localDoubt.topic}</span>
          <StatusBadge status={localDoubt.status}/>
        </div>
        <h2 className="text-lg font-black text-white mb-2" style={{fontFamily:"var(--font-display)"}}>{localDoubt.title}</h2>
        <p className="text-sm text-[#a0a0b0] leading-relaxed mb-4">{localDoubt.body}</p>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {localDoubt.tags.map(t => (
            <span key={t} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[#78788c]">
              <Hash className="w-2.5 h-2.5"/>{t}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-white/5">
          <AvatarBubble initials={localDoubt.authorAvatar} color={localDoubt.authorColor} size={7}/>
          <span className="text-xs text-[#78788c]">{localDoubt.authorName} · {localDoubt.date} at {localDoubt.time}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={toggleUpvote}
              className={cn("flex items-center gap-1 text-xs font-semibold transition-all px-2.5 py-1 rounded-lg",
                localDoubt.upvotedByMe ? "bg-blue-500/15 text-[#818cf8] border border-blue-500/25" : "bg-white/5 text-[#78788c] hover:text-white border border-white/10")}>
              <ThumbsUp className={cn("w-3.5 h-3.5", localDoubt.upvotedByMe && "fill-blue-400")}/>{localDoubt.upvotes}
            </button>
            <button onClick={toggleBookmark}
              className={cn("p-1.5 rounded-lg border transition-all",
                localDoubt.bookmarked ? "bg-amber-400/10 border-amber-400/25 text-amber-400" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white")}>
              {localDoubt.bookmarked ? <BookmarkCheck className="w-3.5 h-3.5 fill-amber-400"/> : <Bookmark className="w-3.5 h-3.5"/>}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Accepted answer callout */}
      {accepted && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0"/>
          <span className="text-xs text-emerald-300 font-semibold">Accepted answer by {accepted.author}</span>
          {accepted.isTeacher && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 ml-1">Teacher</span>}
        </div>
      )}

      {/* AI Assist */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <Brain className="w-3.5 h-3.5 text-violet-400"/>
            </div>
            <span className="text-xs font-bold text-white">Ask Nova AI first</span>
            <span className="text-[10px] text-[#78788c]">Get an instant explanation</span>
          </div>
          {!showAI && (
            <button onClick={askAI}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-500/30 transition-all">
              <Sparkles className="w-3 h-3"/> Ask Nova
            </button>
          )}
        </div>
        {showAI && (
          <div className="mt-2 p-3 rounded-xl bg-violet-500/8 border border-violet-500/15">
            {aiLoading ? (
              <div className="flex items-center gap-2 text-xs text-violet-400">
                <div className="flex gap-1">
                  {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>)}
                </div>
                Nova is thinking...
              </div>
            ) : (
              <p className="text-xs text-[#a0a0b0] leading-relaxed">{aiReply}</p>
            )}
          </div>
        )}
      </GlassCard>

      {/* Replies */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 rounded-full bg-blue-400"/>
          <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">{localDoubt.replies.length} Replies</span>
        </div>
        <div className="space-y-2.5">
          {loadingReplies ? (
            <div className="p-6 text-center text-[#78788c] text-sm">Loading replies…</div>
          ) : localDoubt.replies.length === 0 ? (
            <div className="p-6 text-center text-[#78788c] text-sm">
              No replies yet. Be the first to help!
            </div>
          ) : (
            localDoubt.replies.map(r => <ReplyBubble key={r.id} reply={r} onLike={likeReply}/>)
          )}
        </div>
      </div>

      {/* Reply box */}
      {localDoubt.status !== "closed" && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AvatarBubble initials={student.avatar} color="#3b5bdb" size={7}/>
            <span className="text-xs font-semibold text-white">Add your reply</span>
          </div>
          <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
            placeholder="Share what you know, ask a follow-up, or add a helpful explanation..."
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-[#3b5bdb]/30 resize-none leading-relaxed"/>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5 text-[#78788c]">
              <button className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white transition-all"><Image className="w-3.5 h-3.5"/></button>
              <button className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white transition-all"><Mic className="w-3.5 h-3.5"/></button>
            </div>
            <button onClick={() => void sendReply()} disabled={!replyText.trim() || replying || !ready}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all">
              <Send className="w-3.5 h-3.5"/>{replying ? "Posting…" : "Reply"}
            </button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ── Ask View ───────────────────────────────────────────────────────────────────
function AskDoubt({ onBack, onPosted, existingDoubts, ctx, onOpenDoubt }: {
  onBack: () => void;
  onPosted: () => void;
  existingDoubts: Doubt[];
  ctx: ServiceContext | null;
  onOpenDoubt?: (d: Doubt) => void;
}) {
  const student = useGurukulStudent();
  const { role } = useAuth();
  const { studentId } = useAcademicContext();
  const { subjects: subjectOptions } = useScopedSubjects();
  const [step, setStep] = useState<"ai"|"form">("form");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState(subjectOptions[0] ?? "Mathematics");
  const [chapter, setChapter] = useState("");
  const [topic, setTopic] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReply, setAiReply] = useState<string|null>(null);
  const [attachType, setAttachType] = useState<string|null>(null);

  useEffect(() => {
    if (subjectOptions.length && !subjectOptions.includes(subject)) {
      setSubject(subjectOptions[0]);
      setChapter("");
    }
  }, [subjectOptions, subject]);

  const CHAPTERS: Record<string,string[]> = {
    Mathematics:["Integration","Differential Equations","Matrices","Probability","Vectors"],
    Physics:["Optics","Electrostatics","Mechanics","Waves","Thermodynamics"],
    Chemistry:["Organic Chemistry","Electrochemistry","Thermodynamics","Polymers","Coordination"],
    Biology:["Genetics","Cell Biology","Ecology","Evolution","Plant Physiology"],
    English:["Grammar","Comprehension","Essay","Poetry","Drama"],
    Accountancy:["Accounting Principles","Journal","Ledger","Trial Balance","Final Accounts"],
    "Business Studies":["Nature of Management","Principles of Management","Business Environment","Marketing"],
    Economics:["Demand","Supply","National Income","Money and Banking"],
    Hindi:["Grammar","Comprehension","Essay","Poetry"],
  };

  async function getAIAnswer() {
    if (!title.trim()) return;
    setAiLoading(true);
    setAiReply(null);
    try {
      const prompt = [
        title.trim(),
        body.trim(),
        subject ? `Subject: ${subject}` : "",
        topic ? `Topic: ${topic}` : "",
        chapter ? `Chapter: ${chapter}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const { text, response } = await askAiCoach({
        text: prompt,
        studentId: studentId || undefined,
        role: role === "student" || role === "parent" || role === "teacher" || role === "principal" || role === "admin"
          ? role
          : "student",
        feature_id: "student.nova.chat",
        channel: "student_app",
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      });
      if (isAiBillingOrCreditsIssue(response)) {
        toast.message(AI_BILLING_UNAVAILABLE_MSG);
      }
      setAiReply(text);
    } catch {
      toast.error("AI Gateway unavailable");
      setAiReply(
        "I couldn’t reach Nova just now. You can still post this doubt to your class for teacher and peer help.",
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function postDoubt() {
    if (!ctx) {
      toast.error("Academic context not ready");
      return;
    }
    try {
      await DoubtService.create(ctx, {
        _subject: subject,
        _chapter: chapter,
        _concept: topic,
        _title: title || "Untitled Doubt",
        _body: body || "",
        _image_url: null,
      });
      toast.success("Doubt posted to the class");
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post doubt");
    }
  }

  const hasTitle = title.trim().length >= 5;

  const similarDoubts = useMemo(() => {
    if (!hasTitle) return [];
    const q = title.toLowerCase();
    return existingDoubts
      .filter((d) => d.title.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 3 && d.title.toLowerCase().includes(w)))
      .slice(0, 3);
  }, [hasTitle, title, existingDoubts]);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-[#78788c] hover:text-white transition-colors">
        <ChevronRight className="w-3.5 h-3.5 rotate-180"/> Back
      </button>

      <div>
        <h2 className="text-2xl font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>Ask a Doubt</h2>
        <p className="text-sm text-[#78788c]">Describe your question clearly. Your classmates and teachers will help.</p>
      </div>

      {/* Similar doubts warning */}
      {hasTitle && similarDoubts.length > 0 && (
        <GlassCard className="p-4 border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-amber-400"/>
            <span className="text-xs font-bold text-amber-400">Similar doubts already exist</span>
          </div>
          <div className="space-y-1.5">
            {similarDoubts.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenDoubt?.(s)}
                className="w-full flex items-center gap-2 text-xs text-[#a0a0b0] hover:text-white cursor-pointer group text-left"
              >
                <MessageCircle className="w-3 h-3 text-[#78788c] group-hover:text-white"/>
                <span className="flex-1">{s.title}</span>
                <span className="text-[10px] text-[#78788c]">{s.answerCount} replies</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"/>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[#78788c] mt-2">These might already answer your question. Continue if yours is different.</p>
        </GlassCard>
      )}

      {/* Form */}
      <GlassCard className="p-5 space-y-4">
        {/* Subject + Chapter */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#78788c] mb-1.5 block">Subject *</label>
            <select value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/30 appearance-none">
              {subjectOptions.map(s => <option key={s} value={s} className="bg-[#131316]">{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#78788c] mb-1.5 block">Chapter</label>
            <select value={chapter} onChange={e => setChapter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[#3b5bdb]/30 appearance-none">
              <option value="" className="bg-[#131316]">Select chapter...</option>
              {(CHAPTERS[subject] || []).map(c => <option key={c} value={c} className="bg-[#131316]">{c}</option>)}
            </select>
          </div>
        </div>

        {/* Topic */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#78788c] mb-1.5 block">Topic (optional)</label>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Integration by parts, SN2 mechanism..."
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-[#3b5bdb]/30"/>
        </div>

        {/* Title */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#78788c] mb-1.5 block">Doubt Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ask your question clearly in one sentence..."
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-[#3b5bdb]/30"/>
        </div>

        {/* Body */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#78788c] mb-1.5 block">Details</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder="Explain what you've tried, where you're stuck, and any specific context..."
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-[#3b5bdb]/30 resize-none leading-relaxed"/>
        </div>

        {/* Attachment strip */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#78788c] mb-1.5 block">Attach (optional)</label>
          <div className="flex gap-2">
            {[
              { type:"image", icon:<Image className="w-4 h-4"/>, label:"Image" },
              { type:"camera", icon:<Camera className="w-4 h-4"/>, label:"Camera" },
              { type:"pdf", icon:<FileText className="w-4 h-4"/>, label:"PDF" },
              { type:"voice", icon:<Mic className="w-4 h-4"/>, label:"Voice" },
            ].map(a => (
              <button key={a.type} onClick={() => setAttachType(t => t === a.type ? null : a.type)}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all",
                  attachType === a.type ? "bg-[#3b5bdb]/15 border-[#3b5bdb]/30 text-[#a5b4fc]" : "bg-white/5 border-white/10 text-[#78788c] hover:text-white hover:bg-white/10")}>
                {a.icon} {a.label}
              </button>
            ))}
          </div>
          {attachType && (
            <div className="mt-2 p-3 rounded-xl bg-white/3 border border-white/8 text-xs text-[#78788c] text-center">
              {attachType === "voice" ? "Tap to record your voice question..." : `Tap to attach ${attachType}...`}
            </div>
          )}
        </div>
      </GlassCard>

      {/* AI Option */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
            <Brain className="w-4 h-4 text-violet-400"/>
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Try Nova AI first</div>
            <div className="text-xs text-[#78788c]">Get an instant answer before posting to the class</div>
          </div>
          <button onClick={getAIAnswer} disabled={!hasTitle || aiLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-500/30 disabled:opacity-40 transition-all">
            <Sparkles className="w-3 h-3"/>{aiLoading ? "Thinking..." : "Ask Nova"}
          </button>
        </div>
        {aiReply && (
          <div className="p-3 rounded-xl bg-violet-500/8 border border-violet-500/15">
            <p className="text-xs text-[#a0a0b0] leading-relaxed">{aiReply}</p>
            <p className="text-[10px] text-[#78788c] mt-2">Still not answered? Post it below.</p>
          </div>
        )}
      </GlassCard>

      {/* Submit */}
      <button onClick={postDoubt} disabled={!hasTitle}
        className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-all flex items-center justify-center gap-2">
        <Send className="w-4 h-4"/> Post to Class
      </button>
    </div>
  );
}

// ── My Doubts ──────────────────────────────────────────────────────────────────
function MyDoubts({ doubts, onOpen }: { doubts: Doubt[]; onOpen: (d: Doubt) => void }) {
  const [tab, setTab] = useState<"all"|DoubtStatus|"bookmarked">("all");
  const filtered = doubts.filter(d => {
    if (tab === "bookmarked") return d.bookmarked;
    if (tab === "all") return d.mine;
    return d.mine && d.status === tab;
  });
  const tabs = [
    { val:"all" as const, label:"All", count: doubts.filter(d => d.mine).length },
    { val:"pending" as const, label:"Pending", count: doubts.filter(d => d.mine && d.status==="pending").length },
    { val:"answered" as const, label:"Answered", count: doubts.filter(d => d.mine && d.status==="answered").length },
    { val:"closed" as const, label:"Closed", count: doubts.filter(d => d.mine && d.status==="closed").length },
    { val:"bookmarked" as const, label:"Bookmarked", count: doubts.filter(d => d.bookmarked).length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(t => (
          <button key={t.val} onClick={() => setTab(t.val as any)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
              tab === t.val ? "bg-[#3b5bdb]/15 border border-[#3b5bdb]/30 text-[#a5b4fc]" : "bg-white/5 border border-white/10 text-[#78788c] hover:bg-white/10")}>
            {t.label}
            <span className={cn("text-[10px] font-bold px-1 rounded-full", tab === t.val ? "bg-blue-500/30 text-blue-200" : "bg-white/10 text-[#78788c]")}>{t.count}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <MessageCircle className="w-8 h-8 text-[#78788c] mx-auto mb-2"/>
          <p className="text-sm text-[#78788c]">No doubts in this category</p>
        </GlassCard>
      ) : (
        filtered.map(d => <DoubtCard key={d.id} doubt={d} onClick={() => onOpen(d)}/>)
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────
export default function DoubtPortal() {
  const { ctx, ready, classId } = useAcademicContext();
  const liveVersion = useAcademicLive(["doubt"] as any);
  const { user } = useAuth();
  const student = useGurukulStudent();
  const { subjects: scopedSubjects } = useScopedSubjects();
  const subjectFilterOptions = useMemo(() => ["All", ...scopedSubjects], [scopedSubjects]);
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<DView>("feed");
  const [activeDoubt, setActiveDoubt] = useState<Doubt | null>(null);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<DoubtStatus|"all">("all");
  const [sort, setSort] = useState<"latest"|"popular"|"unanswered">("latest");
  const [listTick, setListTick] = useState(0);

  useEffect(() => {
    if (subjectFilter !== "All" && !scopedSubjects.includes(subjectFilter)) {
      setSubjectFilter("All");
    }
  }, [scopedSubjects, subjectFilter]);

  const classLabel = student.class
    ? student.section
      ? `Class ${student.class} — Section ${student.section}`
      : `Class ${student.class}`
    : "";

  useEffect(() => {
    if (!ready || !ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await DoubtService.list(ctx, classId ? { classId } : undefined);
        if (cancelled) return;
        setDoubts(
          (rows as DbDoubtRow[]).map((r) =>
            mapRowToDoubt(r, user?.id, readDoubtBookmarks(user?.id).has(r.id)),
          ),
        );
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load doubts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, user?.id, liveVersion, listTick]);

  function openDoubt(d: Doubt) { setActiveDoubt(d); setView("detail"); }
  function handlePosted() {
    setListTick((t) => t + 1);
    setView("feed");
  }

  if (view === "detail" && activeDoubt) return (
    <DoubtDetail doubt={activeDoubt} onBack={() => setView("feed")} onUpdateDoubt={d => setActiveDoubt(d)}/>
  );
  if (view === "ask") return (
    <AskDoubt
      onBack={() => setView("feed")}
      onPosted={handlePosted}
      existingDoubts={doubts}
      ctx={ctx}
      onOpenDoubt={openDoubt}
    />
  );

  const filtered = doubts.filter(d => {
    const q = search.toLowerCase();
    const matchSearch = !search || d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q) || d.chapter.toLowerCase().includes(q);
    const matchSub = subjectFilter === "All" || d.subject === subjectFilter;
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchSub && matchStatus;
  }).sort((a, b) =>
    sort === "popular" ? b.upvotes - a.upvotes :
    sort === "unanswered" ? a.answerCount - b.answerCount :
    0
  );

  const pending = doubts.filter(d => d.status === "pending").length;
  const answered = doubts.filter(d => d.status === "answered").length;
  const myDoubts = doubts.filter(d => d.mine).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {classLabel && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">{classLabel}</div>
          )}
          <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Doubt Forum</h1>
          <p className="text-[#78788c] text-sm mt-1">Learn together. Ask, answer, and grow as a class.</p>
        </div>
        <button onClick={() => setView("ask")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold transition-all shadow-lg shadow-blue-500/25">
          <Plus className="w-4 h-4"/> Ask a Doubt
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Total Doubts",  value:doubts.length, color:"#3b5bdb", icon:<MessageCircle className="w-4 h-4"/> },
          { label:"Unanswered",    value:pending,        color:"#c08a3a", icon:<Clock className="w-4 h-4"/> },
          { label:"Answered",      value:answered,       color:"#4aa87a", icon:<CheckCircle2 className="w-4 h-4"/> },
          { label:"My Doubts",     value:myDoubts,       color:"#6882e8", icon:<User className="w-4 h-4"/> },
        ].map(s => (
          <GlassCard key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-2" style={{color:s.color}}>{s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Sub-nav */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-3">
        {[
          { key:"feed" as DView, label:"Class Feed" },
          { key:"mydoubts" as DView, label:"My Doubts" },
        ].map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)}
            className={cn("px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
              view === tab.key ? "bg-[#3b5bdb]/15 border border-[#3b5bdb]/30 text-[#a5b4fc]" : "text-[#78788c] hover:text-white")}>
            {tab.label}
          </button>
        ))}
      </div>

      {view === "mydoubts" ? (
        <MyDoubts doubts={doubts} onOpen={openDoubt}/>
      ) : (
        <>
          {/* Filters */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#78788c]"/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search doubts, topics, chapters..."
                className="w-full pl-8 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#78788c] focus:outline-none focus:border-[#3b5bdb]/30"/>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1.5">
                {subjectFilterOptions.map(s => (
                  <button key={s} onClick={() => setSubjectFilter(s)}
                    className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                      subjectFilter === s ? "bg-white/15 border border-white/25 text-white" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 ml-auto">
                {STATUS_OPTS.map(o => (
                  <button key={o.val} onClick={() => setStatusFilter(o.val)}
                    className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                      statusFilter === o.val ? "bg-[#3b5bdb]/15 border border-[#3b5bdb]/30 text-[#a5b4fc]" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                {(["latest","popular","unanswered"] as const).map(s => (
                  <button key={s} onClick={() => setSort(s)}
                    className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all",
                      sort === s ? "bg-white/15 border border-white/25 text-white" : "bg-white/5 border border-white/8 text-[#78788c] hover:bg-white/10")}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Doubt feed */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#78788c]">{filtered.length} doubt{filtered.length !== 1 ? "s" : ""}</span>
              {classLabel && (
                <span className="text-xs text-[#78788c]">{classLabel} · {doubts.length} total</span>
              )}
            </div>
            {loading ? (
              <GlassCard className="p-8 text-center">
                <p className="text-sm text-[#78788c]">Loading doubts…</p>
              </GlassCard>
            ) : filtered.length === 0 ? (
              <GlassCard className="p-8 text-center">
                <MessageCircle className="w-8 h-8 text-[#78788c] mx-auto mb-2"/>
                <p className="text-sm text-[#78788c] mb-3">No doubts match your filters</p>
                <button onClick={() => setView("ask")} className="flex items-center gap-1.5 mx-auto px-4 py-2 rounded-xl bg-blue-500/15 border border-blue-500/25 text-[#818cf8] text-xs font-bold hover:bg-blue-500/25 transition-all">
                  <Plus className="w-3.5 h-3.5"/> Be the first to ask
                </button>
              </GlassCard>
            ) : (
              filtered.map(d => <DoubtCard key={d.id} doubt={d} onClick={() => openDoubt(d)}/>)
            )}
          </div>
        </>
      )}
    </div>
  );
}
