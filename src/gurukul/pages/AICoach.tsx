import { useState, useRef, useEffect, useCallback } from "react";
import type { PageKey } from "@/gurukul/data/mock";
import { student, subjects } from "@/gurukul/data/mock";
import { cn } from "@/gurukul/components/shared";
import {
  Mic, MicOff, Send, Plus, Search, Pin, Star, Trash2, Edit3,
  MoreHorizontal, ChevronLeft, Paperclip, Copy, Bookmark,
  RotateCcw, X, Camera, FileText, Image, Presentation,
  Volume2, VolumeX, BookOpen, HelpCircle, Brain, Sparkles,
  MessageSquare, Clock, Check, AlertCircle, Globe, Layers,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type VoiceState = "idle" | "listening" | "processing" | "speaking";
type Role = "nova" | "student";

interface Attachment {
  id: string; type: "image" | "pdf" | "doc" | "ppt" | "screenshot";
  name: string; size?: string;
}

interface Message {
  id: string; role: Role; text: string; time: string;
  bookmarked?: boolean; attachments?: Attachment[];
}

interface Conversation {
  id: string; title: string; preview: string; date: string;
  pinned?: boolean; starred?: boolean; messages: Message[];
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_CONVOS: Conversation[] = [
  {
    id: "c1", title: "Integration by Parts", pinned: true,
    preview: "Let me explain it like you're solving a puzzle...",
    date: "Today",
    messages: [
      { id:"m1", role:"student", time:"9:02 AM", text:"I keep getting confused with integration by parts. Can you explain it in a simple way?" },
      { id:"m2", role:"nova",    time:"9:02 AM", text:"Of course! Think of integration by parts like this — it's really just the reverse of the product rule for differentiation.\n\nThe formula is: **∫u·dv = u·v − ∫v·du**\n\nHere's the trick: use the acronym **LIATE** to pick your *u*:\n- **L**ogarithms\n- **I**nverse trig\n- **A**lgebra\n- **T**rig\n- **E**xponentials\n\nLet's try one together. Solve ∫x·eˣ dx. What would you pick as *u*?"},
      { id:"m3", role:"student", time:"9:04 AM", text:"I'd pick u = x since x is algebraic?" },
      { id:"m4", role:"nova",    time:"9:04 AM", text:"Exactly right! 🎯 x is algebraic (A in LIATE), so u = x and dv = eˣ dx.\n\nNow: du = dx, v = eˣ\n\nPlug into formula: **x·eˣ − ∫eˣ dx = x·eˣ − eˣ + C = eˣ(x−1) + C**\n\nThat's it! You nailed the setup. Want to try a harder one, or should I explain why LIATE works?"},
    ],
  },
  {
    id: "c2", title: "SN1 vs SN2 Reactions", starred: true,
    preview: "The key difference is carbocation stability...",
    date: "Today",
    messages: [
      { id:"m1", role:"student", time:"4:30 PM", text:"Why do I keep confusing SN1 and SN2? I know the definitions but fail in questions." },
      { id:"m2", role:"nova",    time:"4:30 PM", text:"This is a super common problem — you know *what* they are but struggle to identify *when* each applies. Let me give you a decision tree.\n\nAsk yourself: **How many carbons are attached to the carbon bearing the leaving group?**\n\n- **Primary (1 carbon)** → almost always SN2\n- **Tertiary (3 carbons)** → almost always SN1\n- **Secondary** → depends on the nucleophile strength and solvent\n\nThe reason? SN1 needs a **stable carbocation intermediate**. Primary carbocations are too unstable to form. Tertiary ones are perfectly stable.\n\nDoes that click? Tell me back in your own words which mechanism methyl bromide (CH₃Br) would follow."},
    ],
  },
  {
    id: "c3", title: "Newton's Laws — Real Life Applications",
    preview: "A rocket uses Newton's 3rd law because...",
    date: "Yesterday",
    messages: [
      { id:"m1", role:"student", time:"6:15 PM", text:"Can you explain Newton's third law with real examples?" },
      { id:"m2", role:"nova",    time:"6:15 PM", text:"Great question! Newton's Third Law says: *For every action, there is an equal and opposite reaction.*\n\nThree vivid real-life examples:\n\n**1. Rocket propulsion** — The rocket expels gas downward (action). The gas pushes the rocket upward (reaction). No ground needed!\n\n**2. Swimming** — You push water backward with your hands (action). Water pushes you forward (reaction).\n\n**3. Walking** — Your foot pushes the ground backward (action). Ground pushes your foot forward (reaction).\n\nHere's the exam trap: the action and reaction forces act on *different objects*, so they never cancel. That confuses students most.\n\nWant me to create a few exam-style questions to test this?"},
    ],
  },
  {
    id: "c4", title: "Tomorrow's Physics Test Prep",
    preview: "Focus on Optics, Thermodynamics, and...",
    date: "Yesterday",
    messages: [
      { id:"m1", role:"student", time:"9:00 PM", text:"I have a physics test tomorrow on Optics and Thermodynamics. Help me revise quickly!" },
      { id:"m2", role:"nova",    time:"9:00 PM", text:"Okay, let's make the most of tonight. Here's a rapid-fire revision plan:\n\n**Optics (40 min)**\n• Snell's Law — sin i / sin r = constant\n• Lens formula: 1/v − 1/u = 1/f\n• Power of a lens: P = 1/f (in meters)\n• Total internal reflection condition\n\n**Thermodynamics (30 min)**\n• First Law: ΔU = Q − W\n• Isothermal vs Adiabatic processes\n• Carnot efficiency: η = 1 − T₂/T₁\n\nI'll quiz you as we go. Ready? **First question: A ray passes from glass (n=1.5) to air (n=1). What's the critical angle?**"},
    ],
  },
  {
    id: "c5", title: "Mitosis vs Meiosis",
    preview: "The simplest way to remember this...",
    date: "Jun 10",
    messages: [
      { id:"m1", role:"student", time:"11:20 AM", text:"How do I remember the difference between mitosis and meiosis?" },
      { id:"m2", role:"nova",    time:"11:20 AM", text:"Memory trick first: **'Mitosis' ends in -tosis, sounds like 'toss a coin'** — you just copy it. **'Meiosis' has an 'ei'** — think 'ei, I need to mix my genes!'\n\nSimple comparison:\n| | Mitosis | Meiosis |\n|--|--|--|\n| Purpose | Growth & repair | Sexual reproduction |\n| Divisions | 1 | 2 |\n| Daughter cells | 2 | 4 |\n| Chromosomes | Diploid (2n) | Haploid (n) |\n| Crossing over | No | Yes |\n\nSay it back to me: what happens in meiosis that doesn't happen in mitosis?"},
    ],
  },
];

const SUGGESTIONS = [
  { icon:<HelpCircle className="w-4 h-4"/>,    text:"Explain integration by parts",        color:"#6366f1" },
  { icon:<Layers className="w-4 h-4"/>,         text:"Help me understand this chapter",      color:"#4b9fd4" },
  { icon:<BookOpen className="w-4 h-4"/>,       text:"Prepare me for tomorrow's test",       color:"#8f7dd6" },
  { icon:<Brain className="w-4 h-4"/>,          text:"Teach me using Feynman technique",     color:"#4aa87a" },
  { icon:<Sparkles className="w-4 h-4"/>,       text:"Create 10 practice questions",         color:"#c08a3a" },
  { icon:<MessageSquare className="w-4 h-4"/>,  text:"Solve this question step by step",     color:"#cc5069" },
  { icon:<Globe className="w-4 h-4"/>,          text:"Summarise my notes on this topic",     color:"#4b9fd4" },
  { icon:<AlertCircle className="w-4 h-4"/>,    text:"Explain why I keep making this mistake",color:"#c08a3a" },
];

const ATTACH_TYPES = [
  { type:"image"      as const, icon:<Image className="w-4 h-4"/>,        label:"Image",        color:"#4b9fd4" },
  { type:"screenshot" as const, icon:<Camera className="w-4 h-4"/>,       label:"Camera / Screenshot", color:"#6366f1" },
  { type:"pdf"        as const, icon:<FileText className="w-4 h-4"/>,      label:"PDF",          color:"#cc5069" },
  { type:"doc"        as const, icon:<FileText className="w-4 h-4"/>,      label:"Word Document",color:"#8f7dd6" },
  { type:"ppt"        as const, icon:<Presentation className="w-4 h-4"/>,  label:"Presentation", color:"#c08a3a" },
];

const WAVEFORM_HEIGHTS = [6,12,20,14,28,18,10,24,16,30,22,12,26,8,20,18,14,24,10,16];

// ── Helpers ───────────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}

function novaReply(text: string): string {
  if (/integrat/i.test(text))
    return "Let's break integration down. The most important thing to remember is which technique to use — **substitution** when you see a composite function, **by parts** when you see a product. Which one are you stuck on?";
  if (/SN1|SN2|substitut/i.test(text))
    return "SN1 vs SN2 — the classic confusion! The single most important factor is the **substrate structure**. Primary → SN2, Tertiary → SN1. What substrate are you looking at right now?";
  if (/test|exam|prepare/i.test(text))
    return "Let's make a game plan. Tell me the date of your test and the chapters it covers, and I'll give you a focused revision schedule with the highest-yield topics prioritised.";
  if (/explain|understand|help/i.test(text))
    return "Happy to explain! Here's how I'd teach this: start from the **core concept**, find an **analogy**, then test it with an **example**. What topic do you want me to break down this way?";
  if (/practice|question/i.test(text))
    return "Great — let's drill it! Here's a question:\n\n**Q. A particle moves with velocity v = 3t² − 2t. Find its acceleration at t = 2s.**\n\nTry it, and I'll walk you through the solution step by step.";
  return "That's a great direction to explore. Based on your current syllabus and past performance, I'd suggest we focus on the conceptual foundation first before moving to problem-solving. What specific part is giving you trouble?";
}

// ── Voice Orb ─────────────────────────────────────────────────────────────────
function VoiceOrb({ state, onStop }: { state: VoiceState; onStop: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background:"rgba(8,11,20,0.92)", backdropFilter:"blur(24px)" }}>

      {/* Outer rings */}
      {state === "listening" && <>
        {[1,2,3].map(i => (
          <div key={i} className="absolute rounded-full border border-blue-500/20 animate-ping"
            style={{ width:160+i*80, height:160+i*80, animationDelay:`${i*0.3}s`, animationDuration:"2s" }}/>
        ))}
      </>}
      {state === "speaking" && <>
        {[1,2,3].map(i => (
          <div key={i} className="absolute rounded-full border border-cyan-400/20 animate-ping"
            style={{ width:160+i*80, height:160+i*80, animationDelay:`${i*0.4}s`, animationDuration:"2.5s" }}/>
        ))}
      </>}

      {/* Core orb */}
      <div className="relative w-36 h-36 rounded-full flex items-center justify-center"
        style={{
          background: state === "listening"
            ? "radial-gradient(circle at 35% 35%, #60a5fa, #6366f1, #4338ca)"
            : state === "speaking"
            ? "radial-gradient(circle at 35% 35%, #67e8f9, #4b9fd4, #0891b2)"
            : state === "processing"
            ? "radial-gradient(circle at 35% 35%, #c4b5fd, #8f7dd6, #7c3aed)"
            : "radial-gradient(circle at 35% 35%, #4b5563, #374151, #1f2937)",
          boxShadow: state === "listening"
            ? "0 0 60px rgba(59,130,246,0.6), 0 0 120px rgba(59,130,246,0.3)"
            : state === "speaking"
            ? "0 0 60px rgba(34,211,238,0.6), 0 0 120px rgba(34,211,238,0.3)"
            : state === "processing"
            ? "0 0 60px rgba(167,139,250,0.5)"
            : "0 0 20px rgba(75,85,99,0.3)",
          animation: state !== "idle" ? "pulse 2s ease-in-out infinite" : undefined,
        }}>
        {state === "listening"   && <Mic className="w-10 h-10 text-white"/>}
        {state === "speaking"    && <Volume2 className="w-10 h-10 text-white"/>}
        {state === "processing"  && <Brain className="w-10 h-10 text-white animate-pulse"/>}
        {state === "idle"        && <Mic className="w-10 h-10 text-white/50"/>}
      </div>

      {/* Waveform (listening state) */}
      {state === "listening" && (
        <div className="flex items-center gap-0.5 mt-8 h-10">
          {WAVEFORM_HEIGHTS.map((h, i) => (
            <div key={i} className="w-1 rounded-full bg-blue-400 transition-all"
              style={{ height:h, opacity:0.6+Math.random()*0.4,
                animation:`waveBar 0.${4+i%4}s ease-in-out infinite alternate`,
                animationDelay:`${i*0.05}s` }}/>
          ))}
        </div>
      )}

      {/* AI speaking bars */}
      {state === "speaking" && (
        <div className="flex items-center gap-1 mt-8 h-10">
          {[8,16,24,12,20,28,16,10,22,14,26,18].map((h, i) => (
            <div key={i} className="w-1.5 rounded-full bg-cyan-400"
              style={{ height:h, opacity:0.7,
                animation:`waveBar 0.${3+i%5}s ease-in-out infinite alternate`,
                animationDelay:`${i*0.08}s` }}/>
          ))}
        </div>
      )}

      {/* Label */}
      <div className="mt-8 text-center">
        <div className="text-white font-semibold text-base">
          {state === "listening"  && "Listening..."}
          {state === "processing" && "Nova is thinking..."}
          {state === "speaking"   && "Nova is speaking"}
          {state === "idle"       && "Tap to speak"}
        </div>
        <div className="text-[#78788c] text-sm mt-1">
          {state === "listening"  && "Speak naturally — I'll catch every word"}
          {state === "speaking"   && "Tap anywhere to interrupt"}
          {state === "processing" && "Hang tight..."}
        </div>
      </div>

      {/* Stop / interrupt button */}
      <button onClick={onStop}
        className="mt-10 flex items-center gap-2 px-6 py-3 rounded-2xl border border-white/10 text-[#78788c] hover:text-white hover:border-white/20 transition-all">
        <X className="w-4 h-4"/> {state === "speaking" ? "Interrupt" : "Cancel"}
      </button>

      {/* Wave animation keyframe via inline style tag */}
      <style>{`
        @keyframes waveBar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onBookmark, onRegen, isLast }: {
  msg: Message; onBookmark: (id:string)=>void; onRegen?: ()=>void; isLast?: boolean;
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
          style={{ background:"radial-gradient(circle at 35% 35%, #60a5fa, #6366f1)", boxShadow:"0 0 12px rgba(59,130,246,0.4)" }}>
          <Brain className="w-4 h-4 text-white"/>
        </div>
      )}

      <div className={cn("flex flex-col gap-1 max-w-[78%]", isNova ? "items-start" : "items-end")}>
        {/* Attachment pills */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {msg.attachments.map(a => (
              <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/6 border border-white/8 text-[11px] text-[#a0a0b0]">
                <FileText className="w-3 h-3"/>  {a.name}
              </div>
            ))}
          </div>
        )}

        {/* Bubble */}
        <div className={cn(
          "px-4 py-3 rounded-2xl text-sm leading-relaxed",
          isNova
            ? "bg-[#131316] border border-white/7 text-[#c8d4e8]"
            : "text-white"
        )}
        style={!isNova ? { background:"linear-gradient(135deg,#6366f1,#2563eb)", boxShadow:"0 4px 16px rgba(59,130,246,0.25)" } : {}}>
          {renderText(msg.text)}
        </div>

        {/* Timestamp + actions */}
        <div className={cn("flex items-center gap-2 px-1", isNova ? "flex-row" : "flex-row-reverse")}>
          <span className="text-[10px] text-[#78788c]">{msg.time}</span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
function ContextPill() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex justify-center py-3">
      <button onClick={() => setExpanded(e => !e)}
        className="group flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/7 bg-white/3 hover:border-white/12 hover:bg-white/5 transition-all">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
        <span className="text-[11px] text-[#78788c] group-hover:text-[#a0a0b0] transition-colors">
          Nova knows your context · Class 12 · CBSE · {subjects.slice(0,3).map(s=>s.name).join(", ")}…
        </span>
        <Brain className="w-3 h-3 text-[#78788c]"/>
      </button>
    </div>
  );
}

// ── Suggestions (empty state) ─────────────────────────────────────────────────
function SuggestionGrid({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
      {/* Nova orb */}
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5"
        style={{ background:"radial-gradient(circle at 35% 35%, #60a5fa, #6366f1, #4338ca)", boxShadow:"0 0 40px rgba(59,130,246,0.4)" }}>
        <Brain className="w-9 h-9 text-white"/>
      </div>
      <h2 className="text-2xl font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>
        Hi {student.firstName} 👋
      </h2>
      <p className="text-[#78788c] text-sm mb-8 text-center max-w-xs">
        I'm Nova — your personal academic tutor. Ask me anything, show me a problem, or just start talking.
      </p>

      {/* Academic context mini-card */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
        {[
          { label: "Class 12", color:"#6366f1" },
          { label: "CBSE",     color:"#4b9fd4" },
          { label: student.goal, color:"#8f7dd6" },
          ...subjects.slice(0,3).map(s => ({ label: s.name, color: s.color })),
        ].map(item => (
          <span key={item.label} className="text-[11px] px-2.5 py-1 rounded-full border font-medium"
            style={{ color:item.color, borderColor:`${item.color}25`, background:`${item.color}10` }}>
            {item.label}
          </span>
        ))}
      </div>

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

  const filtered = convos.filter(c =>
    search === "" || c.title.toLowerCase().includes(search.toLowerCase())
  );
  const pinned = filtered.filter(c => c.pinned);
  const rest   = filtered.filter(c => !c.pinned);

  // Group rest by date
  const groups: Record<string, Conversation[]> = {};
  rest.forEach(c => { (groups[c.date] ??= []).push(c); });

  function ConvoItem({ c }: { c: Conversation }) {
    const isActive = c.id === activeId;
    return (
      <div className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
        isActive ? "bg-[#6366f1]/12 border border-[#6366f1]/20" : "hover:bg-white/4"
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

        {/* Context menu button */}
        <button onClick={e => { e.stopPropagation(); setMenuFor(menuFor===c.id?null:c.id); }}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-[#78788c] hover:text-white hover:bg-white/8 opacity-0 group-hover:opacity-100 transition-all shrink-0">
          <MoreHorizontal className="w-3.5 h-3.5"/>
        </button>

        {/* Dropdown */}
        {menuFor === c.id && (
          <div className="absolute right-2 top-8 z-30 bg-[#131316] border border-white/10 rounded-xl shadow-xl py-1 min-w-[140px]"
            onClick={e => e.stopPropagation()}>
            {[
              { icon:<Pin className="w-3 h-3"/>,   label:c.pinned?"Unpin":"Pin",    action:()=>{ onPin(c.id); setMenuFor(null); } },
              { icon:<Star className="w-3 h-3"/>,  label:c.starred?"Unstar":"Star", action:()=>{ onStar(c.id); setMenuFor(null); } },
              { icon:<Edit3 className="w-3 h-3"/>, label:"Rename",                  action:()=>{ onRename(c.id); setMenuFor(null); } },
              { icon:<Trash2 className="w-3 h-3"/>,label:"Delete",                  action:()=>{ onDelete(c.id); setMenuFor(null); }, danger:true },
            ].map(item => (
              <button key={item.label} onClick={item.action}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                  (item as any).danger ? "text-rose-400 hover:bg-rose-400/10" : "text-[#a0a0b0] hover:text-white hover:bg-white/5"
                )}>
                {item.icon} {item.label}
              </button>
            ))}
          </div>
        )}
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
              style={{ background:"radial-gradient(circle, #6366f1, #4338ca)" }}>
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
            className="w-full bg-white/4 border border-white/6 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-[#78788c] outline-none focus:border-[#6366f1]/30 transition-colors"/>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-none" onClick={() => setMenuFor(null)}>
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
    </div>
  );
}

// ── Input bar ─────────────────────────────────────────────────────────────────
function InputBar({
  onSend, onVoiceStart, onAttach, disabled,
}: {
  onSend: (text:string, attachments:Attachment[])=>void;
  onVoiceStart: ()=>void;
  onAttach: (type: Attachment["type"])=>void;
  disabled?: boolean;
}) {
  const [text,        setText]        = useState("");
  const [attachMenu,  setAttachMenu]  = useState(false);
  const [pending,     setPending]     = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function addAttachment(type: Attachment["type"]) {
    const names: Record<string,string> = { image:"photo.jpg", screenshot:"screenshot.png", pdf:"document.pdf", doc:"notes.docx", ppt:"slides.pptx" };
    setPending(p => [...p, { id:Date.now().toString(), type, name:names[type] }]);
    setAttachMenu(false);
  }

  function submit() {
    if (!text.trim() && pending.length === 0) return;
    onSend(text.trim(), pending);
    setText(""); setPending([]);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  return (
    <div className="relative">
      {/* Attachment pills */}
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-1">
          {pending.map(a => (
            <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#131316] border border-white/10 text-[11px] text-[#a0a0b0]">
              <FileText className="w-3 h-3"/>  {a.name}
              <button onClick={() => setPending(p => p.filter(x => x.id !== a.id))} className="ml-0.5 text-[#78788c] hover:text-white">
                <X className="w-3 h-3"/>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 bg-[#131316] border border-white/10 rounded-2xl p-2 focus-within:border-[#6366f1]/30 transition-all">
        {/* Attach button */}
        <div className="relative">
          <button onClick={() => setAttachMenu(m => !m)} title="Attach"
            className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5",
              attachMenu ? "text-[#6366f1] bg-[#6366f1]/12" : "text-[#78788c] hover:text-white hover:bg-white/6"
            )}>
            <Paperclip className="w-4 h-4"/>
          </button>

          {/* Attachment menu */}
          {attachMenu && (
            <div className="absolute bottom-11 left-0 bg-[#131316] border border-white/10 rounded-2xl shadow-2xl p-1.5 min-w-[180px] z-20">
              {ATTACH_TYPES.map(t => (
                <button key={t.type} onClick={() => addAttachment(t.type)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/5 transition-all text-sm text-[#a0a0b0] hover:text-white">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{background:`${t.color}15`,color:t.color}}>
                    {t.icon}
                  </div>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text area */}
        <textarea
          ref={textareaRef}
          value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder="Ask Nova anything…"
          rows={1} disabled={disabled}
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[#78788c] outline-none resize-none py-1.5 leading-relaxed"
          style={{ maxHeight:120 }}
        />

        {/* Voice button */}
        <button onClick={onVoiceStart} title="Voice"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-[#78788c] hover:text-[#6366f1] hover:bg-[#6366f1]/10 transition-all shrink-0 mb-0.5"
          style={{ boxShadow: "0 0 0 0 rgba(59,130,246,0)" }}>
          <Mic className="w-4 h-4"/>
        </button>

        {/* Send button */}
        <button onClick={submit} disabled={!text.trim() && pending.length === 0}
          className={cn(
            "w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5",
            (text.trim() || pending.length > 0)
              ? "bg-[#6366f1] text-white hover:bg-blue-500"
              : "text-[#78788c]/40 cursor-not-allowed"
          )}>
          <Send className="w-4 h-4"/>
        </button>
      </div>
      <div className="text-center mt-1.5">
        <span className="text-[10px] text-[#78788c]/50">Press ⏎ to send · ⇧⏎ for new line · Hold 🎙 to speak</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AICoach({ setPage }: { setPage?: (p: PageKey) => void }) {
  const [convos,     setConvos]     = useState<Conversation[]>(MOCK_CONVOS);
  const [activeId,   setActiveId]   = useState<string|null>("c1");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [sidebarOpen,setSidebarOpen]= useState(false);
  const [renaming,   setRenaming]   = useState<string|null>(null);
  const [renameVal,  setRenameVal]  = useState("");
  const [isTyping,   setIsTyping]   = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceTimer     = useRef<ReturnType<typeof setTimeout>|null>(null);

  const active = activeId ? convos.find(c => c.id === activeId) ?? null : null;
  const msgs   = active?.messages ?? [];

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

  function sendMessage(text: string, attachments: Attachment[]) {
    if (!activeId) {
      // Create a new conversation
      const id = `c${Date.now()}`;
      const newConvo: Conversation = {
        id, title: text.slice(0,40) || "New Conversation",
        preview: text.slice(0,60), date:"Today", messages:[],
      };
      setConvos(cs => [newConvo, ...cs]);
      setActiveId(id);
      // Add student message then nova response
      setTimeout(() => {
        setConvos(cs => cs.map(c => c.id === id ? { ...c, messages:[{ id:"m1", role:"student", text, time:now(), attachments:attachments.length>0?attachments:undefined }] } : c));
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setConvos(cs => cs.map(c => c.id === id ? { ...c, messages:[...c.messages, { id:"m2", role:"nova", text:novaReply(text), time:now() }] } : c));
        }, 1800);
      }, 100);
      return;
    }

    addMessage(activeId, { role:"student", text, time:now(), attachments:attachments.length>0?attachments:undefined });
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      if (activeId) addMessage(activeId, { role:"nova", text:novaReply(text), time:now() });
    }, 1600 + Math.random()*800);
  }

  function startVoice() {
    setVoiceState("listening");
    voiceTimer.current = setTimeout(() => {
      setVoiceState("processing");
      setTimeout(() => {
        setVoiceState("speaking");
        if (activeId) addMessage(activeId, { role:"student", text:"Can you explain Newton's second law with an example?", time:now() });
        setTimeout(() => {
          if (activeId) addMessage(activeId, { role:"nova", text:"Newton's Second Law says: **F = ma** — Force equals mass times acceleration.\n\nExample: If you push a 10 kg box with 20 N of force, the acceleration is:\na = F/m = 20/10 = **2 m/s²**\n\nThe heavier the object, the less it accelerates for the same force. That's why a truck is harder to move than a bicycle!\n\nWant me to create a few practice problems around this?", time:now() });
          setVoiceState("idle");
        }, 3000);
      }, 1200);
    }, 4000);
  }

  function stopVoice() {
    if (voiceTimer.current) clearTimeout(voiceTimer.current);
    setVoiceState("idle");
  }

  function handleSuggestion(text: string) {
    if (!activeId) {
      const id = `c${Date.now()}`;
      const newConvo: Conversation = { id, title:text.slice(0,40), preview:text.slice(0,60), date:"Today", messages:[] };
      setConvos(cs => [newConvo, ...cs]);
      setActiveId(id);
      setTimeout(() => {
        setConvos(cs => cs.map(c => c.id === id ? { ...c, messages:[{ id:"m1", role:"student", text, time:now() }] } : c));
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setConvos(cs => cs.map(c => c.id === id ? { ...c, messages:[...c.messages, { id:"m2", role:"nova", text:novaReply(text), time:now() }] } : c));
        }, 1800);
      }, 100);
    } else {
      sendMessage(text, []);
    }
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
    setConvos(cs => cs.map(x => x.id === activeId
      ? { ...x, messages: x.messages.filter(m => m.id !== x.messages[x.messages.length-1].id) }
      : x
    ));
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      if (activeId) addMessage(activeId, { role:"nova", text:novaReply(lastQ.text) + "\n\n*(regenerated)*", time:now() });
    }, 1500);
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
              className="flex-1 bg-transparent text-sm font-semibold text-white outline-none border-b border-[#6366f1]/40 pb-0.5"/>
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
            <SuggestionGrid onSelect={handleSuggestion}/>
          ) : (
            <div className="px-4 py-4 space-y-5 max-w-3xl mx-auto w-full">
              <ContextPill/>
              {msgs.map((m, i) => (
                <MessageBubble key={m.id} msg={m}
                  onBookmark={bookmarkMsg}
                  onRegen={m.role==="nova" && i===msgs.length-1 ? regenerateLast : undefined}
                  isLast={i===msgs.length-1}
                />
              ))}
              {isTyping && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background:"radial-gradient(circle at 35% 35%, #60a5fa, #6366f1)" }}>
                    <Brain className="w-4 h-4 text-white"/>
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-[#131316] border border-white/7 flex items-center gap-1.5">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#6366f1] animate-bounce"
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
            onVoiceStart={startVoice}
            onAttach={type => {}}
            disabled={isTyping}
          />
        </div>
      </div>

      {/* Voice overlay */}
      {voiceState !== "idle" && <VoiceOrb state={voiceState} onStop={stopVoice}/>}
    </div>
  );
}
