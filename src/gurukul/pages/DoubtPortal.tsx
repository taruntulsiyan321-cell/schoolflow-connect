import { useState, useRef } from "react";
import { leaderboard, student } from "@/gurukul/data/mock";
import { GlassCard, SubjectBadge, cn } from "@/gurukul/components/shared";
import {
  MessageCircle, Plus, Search, Filter, ThumbsUp, Bookmark, BookmarkCheck,
  CheckCircle2, Clock, ChevronDown, ChevronRight, Brain, Send, Mic,
  Image, FileText, Camera, X, Bell, Star, ArrowRight, SortAsc,
  AlertCircle, Eye, Hash, User, Sparkles, MoreHorizontal,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type DoubtStatus = "pending" | "answered" | "closed";
type DView = "feed" | "detail" | "ask" | "mydoubts";

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
  upvotes: number; upvotedByMe: boolean; bookmarked: boolean;
  attachments: string[]; mine: boolean; tags: string[];
}

// ── Mock Data ──────────────────────────────────────────────────────────────────
const MOCK_DOUBTS: Doubt[] = [
  {
    id:"d1", title:"Why doesn't SN2 work for tertiary alkyl halides?",
    body:"I understand that SN2 is a bimolecular mechanism, but I'm confused about why tertiary substrates don't undergo SN2. Is it purely steric? What role does the leaving group play?",
    subject:"Chemistry", chapter:"Organic Chemistry", topic:"Reaction Mechanisms",
    authorName:"Arjun Sharma", authorAvatar:"AS", authorColor:"#3b5bdb",
    authorRank:3, date:"Jun 11", time:"10:24 AM", status:"answered",
    views:42, upvotes:8, upvotedByMe:true, bookmarked:true, mine:true,
    tags:["SN2","substitution","organic"],
    attachments:[],
    replies:[
      { id:"r1", author:"Mr. Khan", avatar:"MK", authorColor:"#c08a3a", text:"Great question Arjun! SN2 requires a backside attack — the nucleophile approaches from 180° opposite the leaving group. In tertiary halides, the three bulky alkyl groups create steric hindrance that physically blocks this approach. The activation energy becomes prohibitively high. The leaving group quality doesn't directly affect this; it's purely the steric environment of the central carbon.", time:"10:41 AM", likes:12, likedByMe:false, isTeacher:true, isAccepted:true, isHelpful:true, isAI:false },
      { id:"r2", author:"Priya Nair", avatar:"PN", authorColor:"#c08a3a", text:"To add to Sir's answer — a good way to remember this: tertiary carbons have THREE groups blocking the back. SN2 is essentially impossible. Tertiary substrates instead go via SN1 since they form stable 3° carbocations. Primary → SN2 preferred, Tertiary → SN1 preferred.", time:"11:02 AM", likes:7, likedByMe:true, isTeacher:false, isAccepted:false, isHelpful:true, isAI:false },
      { id:"r3", author:"Nova AI", avatar:"AI", authorColor:"#6882e8", text:"Supplementary: Steric hindrance isn't just about number of groups — it's about their bulk too. A neopentyl system (primary but with tert-butyl group adjacent) is also resistant to SN2 for the same reason. The key rule: SN2 rate = f(nucleophile strength, substrate steric environment). Tertiary > Secondary > Primary in SN1; Primary > Secondary > Tertiary in SN2.", time:"11:05 AM", likes:5, likedByMe:false, isTeacher:false, isAccepted:false, isHelpful:false, isAI:true },
    ],
  },
  {
    id:"d2", title:"How do you integrate ∫sec³x dx step by step?",
    body:"I've tried IBP but keep going in circles. The textbook just gives the final formula but I want to understand the actual derivation. Can anyone show the full working?",
    subject:"Mathematics", chapter:"Integration", topic:"Trigonometric Integrals",
    authorName:"Rahul Mehta", authorAvatar:"RM", authorColor:"#4b9fd4",
    authorRank:2, date:"Jun 10", time:"2:15 PM", status:"pending",
    views:28, upvotes:5, upvotedByMe:false, bookmarked:false, mine:false,
    tags:["integration","IBP","trigonometry"],
    attachments:[],
    replies:[
      { id:"r4", author:"Sneha Patel", avatar:"SP", authorColor:"#4aa87a", text:"Use IBP with u=sec x, dv=sec²x dx. Then du=sec x tan x dx, v=tan x. So ∫sec³x = sec x·tan x − ∫sec x·tan²x dx. Replace tan²x = sec²x−1, then you get 2∫sec³x = sec x tan x + ∫sec x dx. Solve for ∫sec³x. This is the classic 'circular' IBP that resolves itself!", time:"2:47 PM", likes:9, likedByMe:false, isTeacher:false, isAccepted:false, isHelpful:true, isAI:false },
    ],
  },
  {
    id:"d3", title:"Dominant vs Codominance — what's the actual difference?",
    body:"Ms. Iyer taught both in the same class and I got confused. In dominant inheritance one allele masks another. In codominance both are expressed. But how is that different from incomplete dominance? All three seem the same to me.",
    subject:"Biology", chapter:"Genetics", topic:"Inheritance Patterns",
    authorName:"Ananya Singh", authorAvatar:"AN", authorColor:"#cc5069",
    authorRank:6, date:"Jun 9", time:"8:30 AM", status:"answered",
    views:67, upvotes:14, upvotedByMe:false, bookmarked:true, mine:false,
    tags:["genetics","inheritance","dominance"],
    attachments:[],
    replies:[
      { id:"r5", author:"Ms. Iyer", avatar:"MI", authorColor:"#4aa87a", text:"These three are genuinely distinct. **Complete dominance**: A masks a entirely (Aa looks like AA). **Incomplete dominance**: blend — RR=red, rr=white, Rr=PINK (intermediate). **Codominance**: both expressed simultaneously — AB blood type shows both A and B antigens on the same cell surface. No blending, no masking. Use blood groups as your anchor for codominance.", time:"9:00 AM", likes:21, likedByMe:false, isTeacher:true, isAccepted:true, isHelpful:true, isAI:false },
      { id:"r6", author:"Karan Joshi", avatar:"KJ", authorColor:"#6882e8", text:"Memory trick that helped me: Incomplete = intermediate (pink flower), Codominance = clear co-existence (AB blood). Complete dominance = 100% one phenotype.", time:"9:22 AM", likes:6, likedByMe:false, isTeacher:false, isAccepted:false, isHelpful:false, isAI:false },
    ],
  },
  {
    id:"d4", title:"Why is the electric field inside a hollow conductor always zero?",
    body:"I know this from Gauss's law but I'm struggling to build an intuition for WHY it's zero. Can someone give a non-formula explanation?",
    subject:"Physics", chapter:"Electrostatics", topic:"Gauss's Law",
    authorName:"Dev Kumar", authorAvatar:"DK", authorColor:"#fb923c",
    authorRank:7, date:"Jun 8", time:"4:10 PM", status:"closed",
    views:51, upvotes:11, upvotedByMe:false, bookmarked:false, mine:false,
    tags:["electrostatics","Gauss","conductors"],
    attachments:[],
    replies:[
      { id:"r7", author:"Ms. Sharma", avatar:"MS", authorColor:"#4b9fd4", text:"Think of it this way: free charges in a conductor rearrange until there's no net force on any charge — that's equilibrium. If there were a field inside, it would push charges around until they cancel it out. The surface charges arrange themselves to perfectly cancel any external field in the interior. This is the basis of Faraday cages!", time:"4:35 PM", likes:18, likedByMe:false, isTeacher:true, isAccepted:true, isHelpful:true, isAI:false },
    ],
  },
  {
    id:"d5", title:"Difference between Lenticular and Stomatal transpiration?",
    body:"Our biology text lists three types but doesn't explain when each dominates. Also, what controls stomatal opening at the molecular level?",
    subject:"Biology", chapter:"Plant Physiology", topic:"Transpiration",
    authorName:"Meera Rao", authorAvatar:"MR", authorColor:"#818cf8",
    authorRank:8, date:"Jun 7", time:"11:45 AM", status:"pending",
    views:19, upvotes:3, upvotedByMe:false, bookmarked:false, mine:false,
    tags:["transpiration","plants","stomata"],
    attachments:[],
    replies:[],
  },
];

const AI_SUGGESTIONS = [
  "How does integration by parts work?",
  "What is the SN1 mechanism?",
  "Explain Mendel's laws simply",
  "How to find integrating factor?",
  "What is Gauss's law?",
];

const SIMILAR_DOUBTS = [
  { id:"d1", title:"Why doesn't SN2 work for tertiary alkyl halides?", replies:3 },
  { id:"d2", title:"SN1 vs SN2 — choosing the right mechanism", replies:2 },
];

const SUBJECTS = ["All", "Mathematics", "Physics", "Chemistry", "Biology", "English"];
const STATUS_OPTS: { label: string; val: DoubtStatus | "all" }[] = [
  { label:"All", val:"all" }, { label:"Pending", val:"pending" },
  { label:"Answered", val:"answered" }, { label:"Closed", val:"closed" },
];

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
            <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3"/>{doubt.replies.length}</span>
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
  const [replyText, setReplyText] = useState("");
  const [showAI, setShowAI] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReply, setAiReply] = useState<string|null>(null);
  const [localDoubt, setLocalDoubt] = useState(doubt);

  function toggleUpvote() {
    setLocalDoubt(d => ({ ...d, upvotes: d.upvotedByMe ? d.upvotes-1 : d.upvotes+1, upvotedByMe: !d.upvotedByMe }));
  }
  function toggleBookmark() {
    setLocalDoubt(d => ({ ...d, bookmarked: !d.bookmarked }));
  }
  function likeReply(rid: string) {
    setLocalDoubt(d => ({
      ...d,
      replies: d.replies.map(r => r.id === rid ? {...r, likes: r.likedByMe ? r.likes-1 : r.likes+1, likedByMe: !r.likedByMe} : r)
    }));
  }
  function sendReply() {
    if (!replyText.trim()) return;
    const newReply: Reply = {
      id: `r${Date.now()}`, author:"You", avatar:"AS", authorColor:"#3b5bdb",
      text: replyText, time:"Just now", likes:0, likedByMe:false,
      isTeacher:false, isAccepted:false, isHelpful:false,
    };
    setLocalDoubt(d => ({ ...d, replies: [...d.replies, newReply] }));
    setReplyText("");
  }
  function askAI() {
    setAiLoading(true);
    setShowAI(true);
    setTimeout(() => {
      setAiLoading(false);
      setAiReply(`Here's Nova's take on "${localDoubt.title}": ${localDoubt.replies.find(r => r.isAI)?.text ?? "This topic requires understanding the core mechanism. Focus on the underlying principle — " + localDoubt.topic + " — and work from first principles. If this AI answer doesn't resolve your doubt, you can post it to the class for teacher and peer help."}`);
    }, 1400);
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
          {localDoubt.replies.length === 0 ? (
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
            <AvatarBubble initials="AS" color="#3b5bdb" size={7}/>
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
            <button onClick={sendReply} disabled={!replyText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all">
              <Send className="w-3.5 h-3.5"/> Reply
            </button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ── Ask View ───────────────────────────────────────────────────────────────────
function AskDoubt({ onBack, onPost }: { onBack: () => void; onPost: (d: Doubt) => void }) {
  const [step, setStep] = useState<"ai"|"form">("form");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("Mathematics");
  const [chapter, setChapter] = useState("");
  const [topic, setTopic] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReply, setAiReply] = useState<string|null>(null);
  const [attachType, setAttachType] = useState<string|null>(null);

  const CHAPTERS: Record<string,string[]> = {
    Mathematics:["Integration","Differential Equations","Matrices","Probability","Vectors"],
    Physics:["Optics","Electrostatics","Mechanics","Waves","Thermodynamics"],
    Chemistry:["Organic Chemistry","Electrochemistry","Thermodynamics","Polymers","Coordination"],
    Biology:["Genetics","Cell Biology","Ecology","Evolution","Plant Physiology"],
    English:["Grammar","Comprehension","Essay","Poetry","Drama"],
  };

  function getAIAnswer() {
    setAiLoading(true);
    setTimeout(() => {
      setAiLoading(false);
      setAiReply(`Based on your question about "${title}", here's what Nova knows: This concept is foundational to ${subject}. Focus on the underlying principle in ${chapter || "this topic"} — make sure you understand the core definitions before applying formulas. If this doesn't fully resolve your doubt, post it to the class for teacher guidance.`);
    }, 1400);
  }

  function postDoubt() {
    const newDoubt: Doubt = {
      id: `d${Date.now()}`,
      title: title || "Untitled Doubt",
      body: body || "",
      subject, chapter, topic,
      authorName: student.name, authorAvatar: student.avatar, authorColor:"#3b5bdb",
      authorRank: student.rank,
      date: "Jun 12", time: "Now",
      status: "pending",
      views: 0, upvotes: 0, upvotedByMe: false,
      bookmarked: false, mine: true,
      tags: [subject.toLowerCase(), chapter.toLowerCase()].filter(Boolean),
      attachments: [],
      replies: [],
    };
    onPost(newDoubt);
  }

  const hasTitle = title.trim().length >= 5;

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
      {hasTitle && (
        <GlassCard className="p-4 border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-amber-400"/>
            <span className="text-xs font-bold text-amber-400">Similar doubts already exist</span>
          </div>
          <div className="space-y-1.5">
            {SIMILAR_DOUBTS.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-xs text-[#a0a0b0] hover:text-white cursor-pointer group">
                <MessageCircle className="w-3 h-3 text-[#78788c] group-hover:text-white"/>
                <span className="flex-1">{s.title}</span>
                <span className="text-[10px] text-[#78788c]">{s.replies} replies</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"/>
              </div>
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
              {SUBJECTS.filter(s => s !== "All").map(s => <option key={s} value={s} className="bg-[#131316]">{s}</option>)}
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
  const [doubts, setDoubts] = useState<Doubt[]>(MOCK_DOUBTS);
  const [view, setView] = useState<DView>("feed");
  const [activeDoubt, setActiveDoubt] = useState<Doubt | null>(null);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<DoubtStatus|"all">("all");
  const [sort, setSort] = useState<"latest"|"popular"|"unanswered">("latest");
  const [showNotif, setShowNotif] = useState(true);

  function openDoubt(d: Doubt) { setActiveDoubt(d); setView("detail"); }
  function addDoubt(d: Doubt) { setDoubts(prev => [d, ...prev]); setView("feed"); }

  if (view === "detail" && activeDoubt) return (
    <DoubtDetail doubt={activeDoubt} onBack={() => setView("feed")} onUpdateDoubt={d => setActiveDoubt(d)}/>
  );
  if (view === "ask") return <AskDoubt onBack={() => setView("feed")} onPost={addDoubt}/>;

  const filtered = doubts.filter(d => {
    const q = search.toLowerCase();
    const matchSearch = !search || d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q) || d.chapter.toLowerCase().includes(q);
    const matchSub = subjectFilter === "All" || d.subject === subjectFilter;
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchSub && matchStatus;
  }).sort((a, b) =>
    sort === "popular" ? b.upvotes - a.upvotes :
    sort === "unanswered" ? a.replies.length - b.replies.length :
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
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Class XII — Section A</div>
          <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Doubt Forum</h1>
          <p className="text-[#78788c] text-sm mt-1">Learn together. Ask, answer, and grow as a class.</p>
        </div>
        <button onClick={() => setView("ask")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold transition-all shadow-lg shadow-blue-500/25">
          <Plus className="w-4 h-4"/> Ask a Doubt
        </button>
      </div>

      {/* Notification banner */}
      {showNotif && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-[#3b5bdb]/20">
          <Bell className="w-4 h-4 text-[#818cf8] shrink-0"/>
          <p className="text-xs text-[#a5b4fc] flex-1">
            <span className="font-bold">Mr. Khan</span> replied to your doubt on SN2 mechanisms · 2 minutes ago
          </p>
          <button onClick={() => openDoubt(doubts[0])} className="text-[10px] font-bold text-[#818cf8] hover:text-blue-200 transition-colors shrink-0">View</button>
          <button onClick={() => setShowNotif(false)} className="text-[#78788c] hover:text-white transition-colors shrink-0"><X className="w-3.5 h-3.5"/></button>
        </div>
      )}

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
                {SUBJECTS.map(s => (
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
              <span className="text-xs text-[#78788c]">Class XII · Section A · {doubts.length} total</span>
            </div>
            {filtered.length === 0 ? (
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
