import { useState, useEffect, useRef } from "react";
import type { PageKey } from "@/gurukul/data/mock";
import { student, subjects, leaderboard } from "@/gurukul/data/mock";
import { GlassCard, SubjectBadge, cn } from "@/gurukul/components/shared";
import {
  Swords, Trophy, Zap, Clock, Shield, Users, Globe, Lock,
  Plus, Search, QrCode, Share2, Copy, Check, X, ChevronRight,
  Flame, Star, Crown, Medal, Target, ArrowLeft, Play,
  CheckCircle2, XCircle, SkipForward, Eye, Award, Coins,
  Bell, ChevronDown, TrendingUp, Sparkles, Hash, Repeat,
  UserPlus, Wifi, WifiOff, Timer, AlarmClock, BookOpen,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = "home" | "create" | "lobby" | "battle" | "results" | "leaderboard" | "history";
type BattleType = "1v1" | "team" | "class";
type HomeTab = "featured" | "ongoing" | "upcoming" | "my";
type LBPeriod = "daily" | "weekly" | "monthly" | "overall";
type LBScope = "class" | "section" | "school" | "subject";
type CreateStep = 1 | 2 | 3;

interface BattlePlayer {
  name: string; avatar: string; color: string; score: number;
  correct: number; answered: number; you?: boolean;
}

interface BattleConfig {
  type: BattleType; subject: string; chapter: string;
  difficulty: string; questions: number; timeLimitMin: number;
  visibility: "public" | "private"; inviteCode: string;
}

interface BattleCard {
  id: string; type: BattleType; title: string; subject: string;
  status: "live" | "upcoming" | "completed" | "pending";
  players: number; maxPlayers: number;
  opponent?: string; opponentAvatar?: string; opponentColor?: string;
  myScore?: number; theirScore?: number; result?: "won" | "lost" | "draw";
  timeLeft?: string; startsIn?: string; date?: string;
  xpReward: number; featured?: boolean; hot?: boolean;
}

interface BattleQuestion {
  id: string; text: string; options: string[]; correct: number; subject: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const BATTLE_QUESTIONS: BattleQuestion[] = [
  { id:"bq1", text:"If A = [[2,1],[5,3]], what is A⁻¹?", options:["[[3,−1],[−5,2]]","[[3,1],[5,2]]","[[2,1],[3,5]]","[[1,0],[0,1]]"], correct:0, subject:"Mathematics" },
  { id:"bq2", text:"A ray of light goes from medium 1 (n=1.5) to medium 2 (n=1.0). At what angle of incidence does total internal reflection occur?", options:["41.8°","30°","60°","45°"], correct:0, subject:"Physics" },
  { id:"bq3", text:"Which hybridisation does carbon exhibit in CO₂?", options:["sp","sp²","sp³","sp³d"], correct:0, subject:"Chemistry" },
  { id:"bq4", text:"The derivative of sin(x)·cos(x) with respect to x is:", options:["cos(2x)","sin(2x)","−sin(2x)","2cos(x)"], correct:0, subject:"Mathematics" },
  { id:"bq5", text:"Work done by a force perpendicular to displacement is:", options:["Zero","Maximum","Negative","Positive"], correct:0, subject:"Physics" },
  { id:"bq6", text:"Which of these is NOT an intensive property of matter?", options:["Volume","Density","Temperature","Pressure"], correct:0, subject:"Chemistry" },
  { id:"bq7", text:"∫₀^π sin(x)dx equals:", options:["2","0","1","π"], correct:0, subject:"Mathematics" },
  { id:"bq8", text:"In SHM, when displacement is maximum, velocity is:", options:["Zero","Maximum","Equal to displacement","Negative"], correct:0, subject:"Physics" },
  { id:"bq9", text:"Molarity is defined as moles of solute per:", options:["Litre of solution","Kg of solvent","100g of solution","Litre of solvent"], correct:0, subject:"Chemistry" },
  { id:"bq10",text:"The number of prime numbers between 1 and 50 is:", options:["15","12","16","14"], correct:0, subject:"Mathematics" },
];

const BATTLES: BattleCard[] = [
  { id:"fb1", type:"1v1",   title:"Integration Showdown",      subject:"Mathematics", status:"live",      players:2, maxPlayers:2,  opponent:"Priya Nair",   opponentAvatar:"PN", opponentColor:"#c08a3a", myScore:6, theirScore:5, timeLeft:"2:18", xpReward:150, featured:true, hot:true },
  { id:"fb2", type:"class", title:"Physics Grand Battle",       subject:"Physics",     status:"upcoming",  players:18, maxPlayers:40, startsIn:"Starts in 12m", xpReward:300, featured:true },
  { id:"fb3", type:"team",  title:"Chem League — Round 3",      subject:"Chemistry",   status:"live",      players:8, maxPlayers:8,   timeLeft:"8:45",         xpReward:250, hot:true },
  { id:"fb4", type:"1v1",   title:"Physics 1v1",               subject:"Physics",     status:"pending",   players:1, maxPlayers:2,  opponent:"Rahul Mehta",  opponentAvatar:"RM", opponentColor:"#4b9fd4", xpReward:120 },
  { id:"fb5", type:"1v1",   title:"Chemistry Duel",            subject:"Chemistry",   status:"completed", players:2, maxPlayers:2,  opponent:"Sneha Patel",  opponentAvatar:"SP", opponentColor:"#4aa87a", myScore:8, theirScore:5, result:"won",  date:"Today",   xpReward:150 },
  { id:"fb6", type:"1v1",   title:"Biology Battle",            subject:"Biology",     status:"completed", players:2, maxPlayers:2,  opponent:"Karan Joshi",  opponentAvatar:"KJ", opponentColor:"#6882e8", myScore:4, theirScore:9, result:"lost", date:"Yesterday",xpReward:50 },
  { id:"fb7", type:"class", title:"Mathematics Championship",  subject:"Mathematics", status:"upcoming",  players:32, maxPlayers:50, startsIn:"Starts in 2h", xpReward:500 },
  { id:"fb8", type:"team",  title:"Science Olympiad",          subject:"Mixed",       status:"upcoming",  players:12, maxPlayers:20, startsIn:"Starts in 45m",xpReward:400 },
];

const HISTORY_ENTRIES = [
  { id:1, type:"1v1" as BattleType, subject:"Mathematics", opponent:"Priya Nair",   result:"won"  as const, myScore:8, theirScore:6, xp:150, coins:30, date:"Today",          duration:"14m 20s", accuracy:80, rank:1 },
  { id:2, type:"1v1" as BattleType, subject:"Chemistry",   opponent:"Sneha Patel",  result:"won"  as const, myScore:7, theirScore:4, xp:120, coins:25, date:"Yesterday",      duration:"11m 05s", accuracy:70, rank:1 },
  { id:3, type:"1v1" as BattleType, subject:"Physics",     opponent:"Karan Joshi",  result:"lost" as const, myScore:3, theirScore:8, xp:40,  coins:10, date:"Jun 11",         duration:"9m 42s",  accuracy:30, rank:2 },
  { id:4, type:"class" as BattleType,subject:"Mathematics",opponent:"Class XII-A",  result:"won"  as const, myScore:72,theirScore:0, xp:300, coins:60, date:"Jun 10",         duration:"25m 00s", accuracy:80, rank:2 },
  { id:5, type:"1v1" as BattleType, subject:"Biology",     opponent:"Rahul Mehta",  result:"won"  as const, myScore:9, theirScore:7, xp:130, coins:28, date:"Jun 9",          duration:"18m 14s", accuracy:90, rank:1 },
];

const LB_SUBJECT = ["Mathematics","Physics","Chemistry","Biology","English"];

const BATTLE_BADGES = [
  { icon:"⚔️", label:"Battle Champion", desc:"Win 10 battles",      color:"#c08a3a" },
  { icon:"🔥", label:"On Fire",         desc:"3-win streak",         color:"#cc5069" },
  { icon:"⚡", label:"Speed Demon",     desc:"<30s avg per question",color:"#4b9fd4" },
];

function genCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function avatarBg(color: string) { return `radial-gradient(circle at 35% 35%, ${color}cc, ${color}66)`; }

// ── Avatar ────────────────────────────────────────────────────────────────────
function AvatarBubble({ initials, color, size=8 }: { initials:string; color:string; size?:number }) {
  return (
    <div className={cn(`w-${size} h-${size} rounded-xl flex items-center justify-center text-white font-black shrink-0`)}
      style={{ background:avatarBg(color), fontSize:size<=8?12:14, boxShadow:`0 0 12px ${color}50` }}>
      {initials}
    </div>
  );
}

// ── Type badge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: BattleType }) {
  const map = { "1v1":{ color:"#cc5069", label:"1v1", icon:<Swords className="w-3 h-3"/> },
                "team":{ color:"#3b5bdb", label:"TEAM", icon:<Users className="w-3 h-3"/> },
                "class":{ color:"#c08a3a", label:"CLASS", icon:<Globe className="w-3 h-3"/> } };
  const m = map[type];
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full"
      style={{ color:m.color, background:`${m.color}15`, border:`1px solid ${m.color}25` }}>
      {m.icon}{m.label}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: BattleCard["status"] }) {
  const map: Record<string,{color:string;label:string}> = {
    live:      { color:"#cc5069", label:"LIVE" },
    upcoming:  { color:"#c08a3a", label:"SOON" },
    completed: { color:"#78788c", label:"DONE" },
    pending:   { color:"#4b9fd4", label:"PENDING" },
  };
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full"
      style={{ color:m.color, background:`${m.color}12`, border:`1px solid ${m.color}25` }}>
      {status === "live" && <span className="w-1 h-1 rounded-full animate-pulse" style={{background:m.color}}/>}
      {m.label}
    </span>
  );
}

// ── Battle card (home grid) ───────────────────────────────────────────────────
function BCard({ b, onJoin, onView }: { b: BattleCard; onJoin:(id:string)=>void; onView:(id:string)=>void }) {
  const subj = subjects.find(s => s.name === b.subject);
  const resultColor = b.result==="won"?"#4aa87a":b.result==="lost"?"#cc5069":"#78788c";
  const borderColor = b.status==="live"?"#cc506930":b.status==="upcoming"?"#c08a3a20":b.featured?"#3b5bdb20":"rgba(255,255,255,0.07)";

  return (
    <div className="relative flex flex-col p-4 rounded-2xl border bg-[#131316] transition-all duration-200 hover:border-white/15 overflow-hidden"
      style={{ borderColor }}>
      {/* Glow for live */}
      {b.status==="live" && <div className="absolute inset-0 pointer-events-none rounded-2xl" style={{background:"radial-gradient(ellipse at top right, rgba(244,63,94,0.06), transparent 70%)"}}/>}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={b.type}/>
          <StatusDot status={b.status}/>
          {b.hot && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-400/12 text-amber-400 border border-amber-400/20">🔥 HOT</span>}
          {b.featured && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-400/12 text-[#818cf8] border border-blue-400/20">★ FEATURED</span>}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-[#78788c] shrink-0">
          <Zap className="w-3 h-3 text-amber-400"/><span className="font-bold text-amber-400">+{b.xpReward}</span>
        </div>
      </div>

      {/* Title + subject */}
      <div className="text-sm font-black text-white mb-1">{b.title}</div>
      <div className="flex items-center gap-2 mb-3">
        {subj && <SubjectBadge subject={subj.name} color={subj.color}/>}
        {b.timeLeft && <span className="flex items-center gap-1 text-[10px] text-rose-400"><Clock className="w-3 h-3"/>{b.timeLeft}</span>}
        {b.startsIn && <span className="flex items-center gap-1 text-[10px] text-amber-400"><AlarmClock className="w-3 h-3"/>{b.startsIn}</span>}
        {b.date && b.result && (
          <span className="text-[10px] font-bold" style={{color:resultColor}}>
            {b.result==="won"?"🏆 Won":b.result==="lost"?"💀 Lost":"🤝 Draw"}
          </span>
        )}
      </div>

      {/* 1v1 score comparison */}
      {b.type==="1v1" && b.opponent && b.status==="live" && b.myScore!==undefined && (
        <div className="flex items-center gap-2 mb-3 bg-white/3 rounded-xl p-2.5">
          <AvatarBubble initials="AS" color="#3b5bdb" size={7}/>
          <div className="flex-1">
            <div className="flex justify-between text-xs font-bold mb-1">
              <span className="text-white">{b.myScore}</span>
              <span className="text-[#78788c]">vs</span>
              <span style={{color:b.opponentColor}}>{b.theirScore}</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="absolute left-0 h-full rounded-full bg-[#3b5bdb] transition-all" style={{width:`${(b.myScore!/10)*100}%`}}/>
              <div className="absolute right-0 h-full rounded-full transition-all" style={{width:`${(b.theirScore!/10)*100}%`,background:b.opponentColor}}/>
            </div>
          </div>
          <AvatarBubble initials={b.opponentAvatar!} color={b.opponentColor!} size={7}/>
        </div>
      )}

      {/* Completed score */}
      {b.status==="completed" && b.myScore!==undefined && (
        <div className="flex items-center justify-between mb-3 p-2 rounded-xl bg-white/3">
          <span className="text-xs text-[#78788c]">{b.opponent}</span>
          <span className="text-sm font-black tabular-nums" style={{color:resultColor}}>{b.myScore} – {b.theirScore}</span>
        </div>
      )}

      {/* Player count (class/team) */}
      {(b.type==="class"||b.type==="team") && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#78788c] mb-3">
          <Users className="w-3 h-3"/>
          <span>{b.players}/{b.maxPlayers} players</span>
          <div className="flex-1 h-1 rounded-full bg-white/8 overflow-hidden ml-1">
            <div className="h-full rounded-full bg-[#3b5bdb]/60" style={{width:`${(b.players/b.maxPlayers)*100}%`}}/>
          </div>
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-1 flex gap-2">
        {b.status==="pending" && (
          <button onClick={()=>onJoin(b.id)}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90"
            style={{background:"linear-gradient(135deg,#4b9fd4,#3b5bdb)",boxShadow:"0 4px 12px rgba(34,211,238,0.25)"}}>
            Accept Challenge
          </button>
        )}
        {b.status==="live" && (
          <button onClick={()=>onJoin(b.id)}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all hover:opacity-90 animate-pulse"
            style={{background:"linear-gradient(135deg,#cc5069,#e11d48)",boxShadow:"0 4px 12px rgba(244,63,94,0.3)"}}>
            <Play className="w-3 h-3"/> Rejoin Battle
          </button>
        )}
        {b.status==="upcoming" && (
          <button onClick={()=>onJoin(b.id)}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90"
            style={{background:"linear-gradient(135deg,#c08a3a,#d97706)",boxShadow:"0 4px 12px rgba(245,158,11,0.25)"}}>
            Join Battle
          </button>
        )}
        {b.status==="completed" && (
          <button onClick={()=>onView(b.id)}
            className="flex-1 py-2 rounded-xl text-xs font-semibold border border-white/10 text-[#78788c] hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-1.5">
            <Eye className="w-3 h-3"/> Review
          </button>
        )}
      </div>
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────
function Home({ onPhase, onStartBattle }: { onPhase:(p:Phase)=>void; onStartBattle:()=>void }) {
  const [tab, setTab] = useState<HomeTab>("featured");
  const [joinCode, setJoinCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);

  const stats = [
    { label:"Battles Won", value:"24",   color:"#4aa87a", icon:<Trophy className="w-4 h-4"/> },
    { label:"Win Rate",    value:"68%",  color:"#3b5bdb", icon:<Target className="w-4 h-4"/> },
    { label:"Class Rank",  value:"#3",   color:"#c08a3a", icon:<Crown className="w-4 h-4"/> },
    { label:"Battle XP",   value:"3,840",color:"#6882e8", icon:<Zap className="w-4 h-4"/> },
  ];

  const tabBattles: Record<HomeTab, BattleCard[]> = {
    featured: BATTLES.filter(b => b.featured || b.hot),
    ongoing:  BATTLES.filter(b => b.status==="live" || b.status==="pending"),
    upcoming: BATTLES.filter(b => b.status==="upcoming"),
    my:       BATTLES.filter(b => b.opponent || b.result),
  };

  const visible = tab === "featured" ? BATTLES : tabBattles[tab];

  // Pending challenges
  const pending = BATTLES.filter(b => b.status==="pending");

  return (
    <div className="space-y-6">
      {/* Arena header */}
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/15 p-6 sm:p-8"
        style={{background:"radial-gradient(ellipse at 60% 0%, rgba(244,63,94,0.1) 0%, rgba(8,11,20,0) 60%), #131316"}}>
        <div className="absolute right-0 top-0 w-64 h-full opacity-5 flex items-center justify-end pr-4">
          <Swords className="w-48 h-48 text-rose-400"/>
        </div>
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.2em] text-rose-400/70 mb-1">Wisdom Campus</div>
          <h1 className="text-3xl font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>
            Battleground ⚔️
          </h1>
          <p className="text-[#78788c] text-sm mb-5">Compete. Conquer. Level up.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.map(s => (
              <div key={s.label} className="flex items-center gap-2.5 p-3 rounded-xl border border-white/5 bg-white/3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{background:`${s.color}15`,color:s.color}}>
                  {s.icon}
                </div>
                <div>
                  <div className="text-sm font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
                  <div className="text-[10px] text-[#78788c]">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <button onClick={onStartBattle}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm text-white transition-all hover:opacity-90 hover:scale-[1.02]"
          style={{background:"linear-gradient(135deg,#cc5069,#e11d48)",boxShadow:"0 6px 20px rgba(244,63,94,0.3)"}}>
          <Plus className="w-4 h-4"/> Create Battle
        </button>
        <button onClick={() => setShowJoin(v => !v)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm border border-white/10 text-white hover:border-white/20 hover:bg-white/3 transition-all">
          <Hash className="w-4 h-4"/> Join with Code
        </button>
        <button onClick={() => onPhase("leaderboard")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm border border-amber-400/20 text-amber-400 hover:bg-amber-400/8 transition-all">
          <Trophy className="w-4 h-4"/> Leaderboard
        </button>
        <button onClick={() => onPhase("history")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm border border-white/10 text-[#78788c] hover:text-white hover:border-white/20 transition-all">
          <Clock className="w-4 h-4"/> History
        </button>
      </div>

      {/* Join code input */}
      {showJoin && (
        <div className="flex gap-2">
          <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())}
            placeholder="Enter invite code e.g. A3X9TK"
            className="flex-1 bg-[#131316] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#78788c] outline-none focus:border-[#3b5bdb]/30 font-mono tracking-widest"/>
          <button onClick={onStartBattle}
            className="px-5 py-2.5 rounded-xl bg-[#3b5bdb] text-white text-sm font-bold hover:bg-blue-500 transition-all">
            Join
          </button>
        </div>
      )}

      {/* Pending challenges notification */}
      {pending.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-[#4b9fd4]/20 bg-[#4b9fd4]/8">
          <Bell className="w-4 h-4 text-[#4b9fd4] shrink-0 mt-0.5 animate-bounce"/>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-[#4b9fd4] mb-1">
              {pending.length} challenge{pending.length>1?"s":""} waiting for you
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pending.map(b => (
                <span key={b.id} className="text-[11px] text-[#a0a0b0] px-2 py-0.5 rounded-lg bg-white/5">
                  {b.opponent} → {b.subject}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div>
        <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-none">
          {(["featured","ongoing","upcoming","my"] as HomeTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn(
                "shrink-0 px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all",
                tab===t ? "bg-[#cc5069] text-white shadow-lg shadow-rose-500/20" : "border border-white/7 text-[#78788c] hover:text-white hover:border-white/15"
              )}>
              {t==="my"?"My Battles":t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(b => (
            <BCard key={b.id} b={b} onJoin={onStartBattle} onView={onStartBattle}/>
          ))}
          {visible.length === 0 && (
            <div className="col-span-full py-12 text-center">
              <Swords className="w-8 h-8 text-[#78788c] mx-auto mb-3"/>
              <div className="text-sm text-[#78788c]">No battles here yet</div>
            </div>
          )}
        </div>
      </div>

      {/* Recommended */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-[#6882e8]"/>
          <span className="text-xs font-bold text-[#78788c] uppercase tracking-wider">Recommended for you</span>
        </div>
        <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
          {[
            { label:"Integration Duel", subject:"Mathematics", xp:120, type:"1v1" as BattleType },
            { label:"Optics Challenge", subject:"Physics",     xp:100, type:"1v1" as BattleType },
            { label:"Chem Quick Fire",  subject:"Chemistry",   xp:90,  type:"1v1" as BattleType },
          ].map(r => {
            const subj = subjects.find(s=>s.name===r.subject);
            return (
              <button key={r.label} onClick={onStartBattle}
                className="shrink-0 flex flex-col gap-2 p-3.5 rounded-2xl border border-white/7 bg-[#131316] hover:border-white/18 transition-all min-w-[160px]">
                <TypeBadge type={r.type}/>
                <div className="text-xs font-bold text-white text-left">{r.label}</div>
                {subj && <SubjectBadge subject={subj.name} color={subj.color}/>}
                <div className="flex items-center gap-1 text-[10px] text-amber-400 font-bold">
                  <Zap className="w-3 h-3"/>+{r.xp} XP
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Create wizard ─────────────────────────────────────────────────────────────
function CreateBattle({ onBack, onStart }: { onBack:()=>void; onStart:(cfg:BattleConfig)=>void }) {
  const [step,       setStep]       = useState<CreateStep>(1);
  const [type,       setType]       = useState<BattleType>("1v1");
  const [subject,    setSubject]    = useState("");
  const [chapter,    setChapter]    = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [questions,  setQuestions]  = useState(10);
  const [timeLimit,  setTimeLimit]  = useState(15);
  const [visibility, setVisibility] = useState<"public"|"private">("public");
  const [opponent,   setOpponent]   = useState("");
  const [copied,     setCopied]     = useState(false);
  const code = useRef(genCode()).current;

  const TYPE_OPTIONS = [
    { key:"1v1"  as BattleType, icon:<Swords className="w-6 h-6"/>,  label:"1 vs 1 Challenge", desc:"Go head-to-head against one opponent",       color:"#cc5069" },
    { key:"team" as BattleType, icon:<Users className="w-6 h-6"/>,   label:"Team vs Team",      desc:"Compete as a team of 2–5 students",           color:"#3b5bdb" },
    { key:"class"as BattleType, icon:<Globe className="w-6 h-6"/>,   label:"Class Battle",      desc:"Open challenge for the entire class to join",  color:"#c08a3a" },
  ];

  function copyCode() {
    navigator.clipboard.writeText(code).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false),1500);
  }

  function handleStart() {
    onStart({ type, subject:subject||"Mathematics", chapter:chapter||"All", difficulty, questions, timeLimitMin:timeLimit, visibility, inviteCode:code });
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-[#78788c] hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4"/> Back
      </button>

      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1,2,3].map(s => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all",
              step===s?"bg-[#cc5069] text-white shadow-lg shadow-rose-500/30":step>s?"bg-[#4aa87a] text-white":"bg-white/8 text-[#78788c]"
            )}>{step>s?<Check className="w-3.5 h-3.5"/>:s}</div>
            {s<3&&<div className={cn("flex-1 h-0.5 rounded-full transition-all",step>s?"bg-[#4aa87a]":"bg-white/10")}/>}
          </div>
        ))}
      </div>
      <div className="text-xs text-[#78788c] -mt-2">
        {step===1?"Choose battle format":step===2?"Configure your battle":"Invite opponents"}
      </div>

      <GlassCard className="p-6">
        {/* Step 1: Type */}
        {step===1 && (
          <div className="space-y-3">
            <h2 className="text-lg font-black text-white mb-4" style={{fontFamily:"var(--font-display)"}}>Battle Format</h2>
            {TYPE_OPTIONS.map(t => (
              <button key={t.key} onClick={()=>setType(t.key)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all",
                  type===t.key?"scale-[1.01]":"border-white/7 hover:border-white/15"
                )}
                style={type===t.key?{borderColor:`${t.color}40`,background:`${t.color}08`}:{}}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform"
                  style={{background:`${t.color}15`,color:t.color}}>
                  {t.icon}
                </div>
                <div>
                  <div className="text-sm font-black text-white">{t.label}</div>
                  <div className="text-[11px] text-[#78788c] mt-0.5">{t.desc}</div>
                </div>
                {type===t.key && <Check className="w-4 h-4 ml-auto shrink-0" style={{color:t.color}}/>}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Config */}
        {step===2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-black text-white mb-4" style={{fontFamily:"var(--font-display)"}}>Configure Battle</h2>
            <div>
              <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-2">Subject</div>
              <div className="flex flex-wrap gap-2">
                {subjects.map(s=>(
                  <button key={s.id} onClick={()=>setSubject(s.name)}
                    className={cn("px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                      subject===s.name?"text-white shadow-lg":"border border-white/7 text-[#78788c] hover:text-white hover:border-white/20"
                    )}
                    style={subject===s.name?{background:s.color,boxShadow:`0 4px 12px ${s.color}40`}:{}}>
                    {s.icon} {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-2">Difficulty</div>
              <div className="flex gap-2">
                {[["easy","#4aa87a"],["medium","#c08a3a"],["hard","#cc5069"],["mixed","#6882e8"]].map(([d,c])=>(
                  <button key={d} onClick={()=>setDifficulty(d)}
                    className={cn("flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all",
                      difficulty===d?"text-white":"border border-white/7 text-[#78788c] hover:text-white"
                    )}
                    style={difficulty===d?{background:c as string}:{}}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider">Questions</div>
                <span className="text-xs font-black text-[#cc5069]">{questions}</span>
              </div>
              <input type="range" min={5} max={30} step={5} value={questions} onChange={e=>setQuestions(+e.target.value)}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:"#cc5069"}}/>
              <div className="flex justify-between text-[10px] text-[#78788c] mt-1"><span>5</span><span>30</span></div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider">Time Limit</div>
                <span className="text-xs font-black text-[#cc5069]">{timeLimit} min</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {[5,10,15,20,30].map(t=>(
                  <button key={t} onClick={()=>setTimeLimit(t)}
                    className={cn("px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                      timeLimit===t?"bg-[#cc5069] text-white":"border border-white/7 text-[#78788c] hover:border-white/20 hover:text-white"
                    )}>{t}m</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-2">Visibility</div>
              <div className="flex gap-2">
                <button onClick={()=>setVisibility("public")}
                  className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
                    visibility==="public"?"bg-[#3b5bdb] text-white shadow-lg":"border border-white/7 text-[#78788c] hover:text-white"
                  )}>
                  <Globe className="w-3.5 h-3.5"/> Public
                </button>
                <button onClick={()=>setVisibility("private")}
                  className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
                    visibility==="private"?"bg-[#6882e8] text-white shadow-lg":"border border-white/7 text-[#78788c] hover:text-white"
                  )}>
                  <Lock className="w-3.5 h-3.5"/> Private
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Invite */}
        {step===3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-black text-white mb-4" style={{fontFamily:"var(--font-display)"}}>Invite Opponents</h2>
            {/* Invite code */}
            <div className="text-center p-5 rounded-2xl border border-dashed border-white/12 bg-white/2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-2">Your Invite Code</div>
              <div className="text-3xl font-black tracking-[0.3em] text-white mb-3" style={{fontFamily:"var(--font-mono)"}}>{code}</div>
              <div className="flex justify-center gap-2">
                <button onClick={copyCode}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-white/10 text-[#78788c] hover:text-white hover:border-white/20 transition-all">
                  {copied?<Check className="w-3.5 h-3.5 text-emerald-400"/>:<Copy className="w-3.5 h-3.5"/>}
                  {copied?"Copied!":"Copy"}
                </button>
                <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-white/10 text-[#78788c] hover:text-white hover:border-white/20 transition-all">
                  <Share2 className="w-3.5 h-3.5"/> Share
                </button>
                <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-white/10 text-[#78788c] hover:text-white hover:border-white/20 transition-all">
                  <QrCode className="w-3.5 h-3.5"/> QR
                </button>
              </div>
            </div>
            {/* Search opponent */}
            {type==="1v1" && (
              <div>
                <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider mb-2">Challenge a Classmate</div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#78788c]"/>
                  <input value={opponent} onChange={e=>setOpponent(e.target.value)}
                    placeholder="Search by name…"
                    className="w-full bg-white/4 border border-white/8 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-[#78788c] outline-none focus:border-[#3b5bdb]/30"/>
                </div>
                <div className="space-y-1.5">
                  {leaderboard.filter(l=>!l.you).slice(0,3).map(l=>(
                    <button key={l.rank} onClick={()=>setOpponent(l.name)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left",
                        opponent===l.name?"border-[#3b5bdb]/30 bg-[#3b5bdb]/8":"border-white/5 hover:border-white/12 hover:bg-white/3"
                      )}>
                      <AvatarBubble initials={l.avatar} color={l.color} size={8}/>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white">{l.name}</div>
                        <div className="text-[10px] text-[#78788c]">Rank #{l.rank} · {l.accuracy}% accuracy</div>
                      </div>
                      <UserPlus className={cn("w-3.5 h-3.5 shrink-0 transition-colors",opponent===l.name?"text-[#3b5bdb]":"text-[#78788c]")}/>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex gap-3 mt-6">
          {step>1 && (
            <button onClick={()=>setStep(s=>(s-1) as CreateStep)}
              className="px-5 py-3 rounded-2xl border border-white/10 text-sm text-[#78788c] hover:text-white hover:border-white/20 transition-all">
              Back
            </button>
          )}
          {step<3 ? (
            <button onClick={()=>setStep(s=>(s+1) as CreateStep)}
              className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90"
              style={{background:"linear-gradient(135deg,#cc5069,#e11d48)",boxShadow:"0 6px 20px rgba(244,63,94,0.25)"}}>
              Continue <ChevronRight className="inline w-4 h-4"/>
            </button>
          ) : (
            <button onClick={handleStart}
              className="flex-1 py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90"
              style={{background:"linear-gradient(135deg,#cc5069,#e11d48)",boxShadow:"0 6px 20px rgba(244,63,94,0.25)"}}>
              <Play className="w-4 h-4"/> Start Battle!
            </button>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ── Circular timer ────────────────────────────────────────────────────────────
function CircleTimer({ seconds, total }: { seconds:number; total:number }) {
  const pct = seconds / total;
  const size=80, stroke=6, r=(size-stroke)/2, c=2*Math.PI*r;
  const offset = c - pct*c;
  const color = pct>0.5?"#4aa87a":pct>0.25?"#c08a3a":"#cc5069";
  const mm = Math.floor(seconds/60).toString().padStart(2,"0");
  const ss = (seconds%60).toString().padStart(2,"0");
  return (
    <div className="relative inline-flex items-center justify-center" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 6px ${color})`,transition:"stroke-dashoffset 1s linear,stroke 0.5s"}}/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black tabular-nums" style={{color}}>{mm}:{ss}</span>
      </div>
    </div>
  );
}

// ── Battle arena ──────────────────────────────────────────────────────────────
function BattleArena({ config, onFinish }: { config:BattleConfig; onFinish:(res:BattleResult)=>void }) {
  const qs = BATTLE_QUESTIONS.slice(0, config.questions);
  const totalSec = config.timeLimitMin * 60;
  const [qIdx,      setQIdx]      = useState(0);
  const [chosen,    setChosen]    = useState<number|null>(null);
  const [phase,     setPhase]     = useState<"q"|"fb">("q");
  const [correct,   setCorrect]   = useState(0);
  const [timeLeft,  setTimeLeft]  = useState(totalSec);
  const [oppScore,  setOppScore]  = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const oppRef   = useRef<ReturnType<typeof setInterval>|null>(null);

  const oppName = "Priya Nair"; const oppColor = "#c08a3a";

  useEffect(() => {
    timerRef.current = setInterval(() => setTimeLeft(t => { if(t<=1){finish();return 0;} return t-1; }), 1000);
    oppRef.current   = setInterval(() => setOppScore(s => Math.min(s + (Math.random()>0.35?1:0), qs.length)), 3500);
    return () => { clearInterval(timerRef.current!); clearInterval(oppRef.current!); };
  }, []);

  function answer(i: number) {
    if (phase==="fb") return;
    setChosen(i);
    if (i===qs[qIdx].correct) setCorrect(c=>c+1);
    setPhase("fb");
    setTimeout(() => next(), 1200);
  }

  function next() {
    if (qIdx+1>=qs.length) { finish(); return; }
    setQIdx(i=>i+1); setChosen(null); setPhase("q");
  }

  function finish() {
    clearInterval(timerRef.current!); clearInterval(oppRef.current!);
    const myFinal = correct + (phase==="fb"&&chosen===qs[qIdx]?.correct?1:0);
    onFinish({ myScore:myFinal, oppScore, total:qs.length, config, timeSpentSec:totalSec-timeLeft, oppName });
  }

  const q = qs[qIdx]; if (!q) return null;
  const myPct   = Math.round((correct/qs.length)*100);
  const oppPct  = Math.round((oppScore/qs.length)*100);
  const winning = correct > oppScore;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Scoreboard header */}
      <div className="rounded-2xl border border-white/7 bg-[#131316] p-4">
        <div className="flex items-center gap-3">
          {/* Me */}
          <div className="flex-1 flex items-center gap-2">
            <AvatarBubble initials="AS" color="#3b5bdb" size={9}/>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white truncate">You</div>
              <div className="text-lg font-black text-[#3b5bdb] tabular-nums">{correct}</div>
            </div>
          </div>
          {/* Timer */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <CircleTimer seconds={timeLeft} total={totalSec}/>
            <div className="text-[9px] uppercase tracking-widest text-[#78788c]">Q{qIdx+1}/{qs.length}</div>
          </div>
          {/* Opponent */}
          <div className="flex-1 flex items-center gap-2 flex-row-reverse">
            <AvatarBubble initials="PN" color={oppColor} size={9}/>
            <div className="flex-1 min-w-0 text-right">
              <div className="text-xs font-bold text-white truncate">{oppName}</div>
              <div className="text-lg font-black tabular-nums" style={{color:oppColor}}>{oppScore}</div>
            </div>
          </div>
        </div>
        {/* Dual progress */}
        <div className="relative h-1.5 rounded-full bg-white/6 mt-3 overflow-hidden">
          <div className="absolute left-0 h-full rounded-full transition-all duration-500 bg-[#3b5bdb]" style={{width:`${(correct/qs.length)*100}%`}}/>
          <div className="absolute right-0 h-full rounded-full transition-all duration-500" style={{width:`${(oppScore/qs.length)*100}%`,background:oppColor}}/>
        </div>
        {winning && <div className="text-center text-[10px] text-emerald-400 font-bold mt-1.5 animate-pulse">🔥 You're ahead!</div>}
        {!winning && correct===oppScore && <div className="text-center text-[10px] text-amber-400 font-bold mt-1.5">⚡ It's a tie!</div>}
        {!winning && correct<oppScore && <div className="text-center text-[10px] text-rose-400 font-bold mt-1.5">💪 Fight back!</div>}
      </div>

      {/* Question */}
      <GlassCard glow="blue" className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-widest text-[#78788c]">Question {qIdx+1}</span>
          <SubjectBadge subject={q.subject} color={subjects.find(s=>s.name===q.subject)?.color??"#3b5bdb"}/>
        </div>
        <div className="text-base font-semibold text-white leading-relaxed">{q.text}</div>
      </GlassCard>

      {/* Options */}
      <div className="grid grid-cols-1 gap-2.5">
        {q.options.map((opt,i)=>{
          const isChosen  = chosen===i;
          const isCorrect = i===q.correct;
          let style = "border-white/7 text-[#a0a0b0] hover:border-white/20 hover:text-white hover:bg-white/4";
          if(phase==="fb"){
            if(isCorrect)            style="border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
            else if(isChosen)        style="border-rose-400/40 bg-rose-400/10 text-rose-300";
            else                     style="border-white/4 text-[#78788c]/60";
          }
          return (
            <button key={i} onClick={()=>answer(i)} disabled={phase==="fb"}
              className={cn("w-full flex items-center gap-3 p-4 rounded-2xl border text-sm font-medium transition-all duration-150 text-left",style)}>
              <span className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 bg-white/8">
                {String.fromCharCode(65+i)}
              </span>
              <span className="flex-1">{opt}</span>
              {phase==="fb"&&isCorrect&&<CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0"/>}
              {phase==="fb"&&isChosen&&!isCorrect&&<XCircle className="w-4 h-4 text-rose-400 shrink-0"/>}
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        {phase==="q" && (
          <button onClick={()=>next()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/7 text-sm text-[#78788c] hover:text-white hover:border-white/20 transition-all">
            <SkipForward className="w-3.5 h-3.5"/> Skip
          </button>
        )}
        <button onClick={finish}
          className="px-4 py-2.5 rounded-xl border border-white/7 text-sm text-rose-400 hover:border-rose-400/30 hover:bg-rose-400/5 transition-all ml-auto">
          End Battle
        </button>
      </div>
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────
interface BattleResult {
  myScore:number; oppScore:number; total:number;
  config:BattleConfig; timeSpentSec:number; oppName:string;
}

function Results({ result, onHome, onReplay }: { result:BattleResult; onHome:()=>void; onReplay:()=>void }) {
  const { myScore, oppScore, total, config, timeSpentSec, oppName } = result;
  const won = myScore > oppScore; const draw = myScore===oppScore;
  const pct = Math.round((myScore/total)*100);
  const xp  = won ? 150 : draw ? 80 : 50;
  const coins = won ? 30 : draw ? 15 : 10;
  const mm  = Math.floor(timeSpentSec/60), ss = timeSpentSec%60;
  const resultColor = won?"#c08a3a":draw?"#4b9fd4":"#cc5069";
  const resultLabel = won?"Victory! 🏆":draw?"Draw! 🤝":"Defeat 💪";

  const [showReview, setShowReview] = useState(false);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Main result card */}
      <div className="relative overflow-hidden rounded-3xl border p-6 text-center"
        style={{borderColor:`${resultColor}30`,background:`radial-gradient(ellipse at 50% 0%,${resultColor}12 0%,#131316 60%)`}}>
        <div className="text-4xl mb-2">{won?"🏆":draw?"🤝":"💪"}</div>
        <div className="text-3xl font-black mb-1" style={{color:resultColor,fontFamily:"var(--font-display)"}}>{resultLabel}</div>
        <div className="text-[#78788c] text-sm mb-6">vs {oppName} · {config.subject}</div>

        {/* Score VS */}
        <div className="flex items-center justify-center gap-6 mb-6">
          <div className="text-center">
            <AvatarBubble initials="AS" color="#3b5bdb" size={12}/>
            <div className="text-3xl font-black text-white mt-2 tabular-nums">{myScore}</div>
            <div className="text-[11px] text-[#78788c]">You</div>
          </div>
          <div className="text-2xl font-black text-[#78788c]/40">VS</div>
          <div className="text-center">
            <AvatarBubble initials="PN" color="#c08a3a" size={12}/>
            <div className="text-3xl font-black text-white mt-2 tabular-nums">{oppScore}</div>
            <div className="text-[11px] text-[#78788c]">{oppName}</div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            {label:"Accuracy",  value:`${pct}%`,           color:"#3b5bdb"},
            {label:"Correct",   value:myScore,              color:"#4aa87a"},
            {label:"Wrong",     value:total-myScore,        color:"#cc5069"},
            {label:"Time",      value:`${mm}m${ss}s`,       color:"#4b9fd4"},
          ].map(s=>(
            <div key={s.label} className="rounded-xl bg-white/4 border border-white/5 p-2.5">
              <div className="text-sm font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-[#78788c] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Rewards */}
        <div className="flex items-center justify-center gap-4 p-3 rounded-2xl border border-white/6 bg-white/3 mb-4">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-400"/>
            <span className="text-sm font-black text-amber-400">+{xp} XP</span>
          </div>
          <div className="w-px h-5 bg-white/10"/>
          <div className="flex items-center gap-1.5">
            <span className="text-base">🪙</span>
            <span className="text-sm font-black text-yellow-300">+{coins} Coins</span>
          </div>
          {won && <>
            <div className="w-px h-5 bg-white/10"/>
            <div className="flex items-center gap-1.5">
              <span className="text-base">🔥</span>
              <span className="text-sm font-black text-rose-400">Streak +1</span>
            </div>
          </>}
        </div>

        {/* Badges unlocked */}
        {won && (
          <div className="p-3 rounded-2xl bg-amber-400/8 border border-amber-400/20 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-amber-400 mb-2">Badge Unlocked</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚔️</span>
              <div className="text-left">
                <div className="text-xs font-bold text-white">Battle Champion</div>
                <div className="text-[10px] text-[#78788c]">Win 10 battles — progress: 6/10</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2.5">
        <button onClick={() => setShowReview(v=>!v)}
          className="w-full py-3 rounded-2xl border border-white/10 text-sm font-semibold text-[#a0a0b0] hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2">
          <Eye className="w-4 h-4"/> Review All Questions
        </button>
        <div className="flex gap-2.5">
          <button onClick={onReplay}
            className="flex-1 py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{background:"linear-gradient(135deg,#cc5069,#e11d48)",boxShadow:"0 6px 20px rgba(244,63,94,0.25)"}}>
            <Repeat className="w-4 h-4"/> Rematch
          </button>
          <button onClick={onHome}
            className="flex-1 py-3 rounded-2xl border border-white/10 text-sm font-semibold text-[#a0a0b0] hover:text-white hover:border-white/20 transition-all">
            Back to Arena
          </button>
        </div>
      </div>

      {/* Question review panel */}
      {showReview && (
        <GlassCard className="p-5">
          <div className="text-xs font-bold text-[#78788c] uppercase tracking-wider mb-4">Question Review</div>
          <div className="space-y-3">
            {BATTLE_QUESTIONS.slice(0, result.total).map((q,i)=>{
              const wasCorrect = i < result.myScore;
              return (
                <div key={q.id} className={cn("flex items-start gap-3 p-3 rounded-xl border",
                  wasCorrect?"border-emerald-400/15 bg-emerald-400/5":"border-rose-400/15 bg-rose-400/5")}>
                  <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    wasCorrect?"bg-emerald-400/20":"bg-rose-400/20")}>
                    {wasCorrect?<Check className="w-3 h-3 text-emerald-400"/>:<X className="w-3 h-3 text-rose-400"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white leading-relaxed mb-1">{q.text}</div>
                    <div className="text-[10px] text-emerald-400">✓ {q.options[q.correct]}</div>
                  </div>
                  <span className="text-[10px] font-bold text-[#78788c] shrink-0">Q{i+1}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function Leaderboard({ onBack }: { onBack:()=>void }) {
  const [period, setPeriod] = useState<LBPeriod>("weekly");
  const [scope,  setScope]  = useState<LBScope>("class");
  const [selSubj,setSelSubj]= useState("Mathematics");

  const entries = leaderboard.map((e,i)=>({
    ...e, battles:20+i*2, winRate:88-i*4, coins:500-i*40,
  }));

  const medalColor = (r:number) => r===1?"#c08a3a":r===2?"#94a3b8":r===3?"#cd7c2f":"#78788c";
  const medalIcon  = (r:number) => r===1?<Crown className="w-4 h-4"/>:r===2?<Medal className="w-4 h-4"/>:r===3?<Medal className="w-3.5 h-3.5"/>:<span className="text-xs font-black">#{r}</span>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/20 transition-all">
          <ArrowLeft className="w-4 h-4"/>
        </button>
        <h2 className="text-xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>⚔️ Leaderboard</h2>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
        {(["daily","weekly","monthly","overall"] as LBPeriod[]).map(p=>(
          <button key={p} onClick={()=>setPeriod(p)}
            className={cn("shrink-0 px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all",
              period===p?"bg-[#c08a3a] text-white shadow-lg shadow-amber-500/25":"border border-white/7 text-[#78788c] hover:text-white hover:border-white/15"
            )}>{p}</button>
        ))}
      </div>

      {/* Scope tabs */}
      <div className="flex gap-1 bg-white/4 rounded-xl p-1 w-fit">
        {(["class","section","school","subject"] as LBScope[]).map(s=>(
          <button key={s} onClick={()=>setScope(s)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all",
              scope===s?"bg-white/12 text-white":"text-[#78788c] hover:text-white"
            )}>{s}</button>
        ))}
      </div>

      {/* Subject filter */}
      {scope==="subject" && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {LB_SUBJECT.map(s=>(
            <button key={s} onClick={()=>setSelSubj(s)}
              className={cn("shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                selSubj===s?"bg-[#3b5bdb] text-white":"border border-white/7 text-[#78788c] hover:text-white"
              )}>{s}</button>
          ))}
        </div>
      )}

      {/* Top 3 podium */}
      <div className="grid grid-cols-3 gap-3 items-end">
        {[entries[1], entries[0], entries[2]].map((e,i)=>{
          const podPos = [2,1,3][i]; const col = medalColor(podPos);
          const heights = ["h-24","h-32","h-20"];
          return (
            <div key={e.rank} className={cn("flex flex-col items-center gap-2",i===1&&"-mt-4")}>
              <AvatarBubble initials={e.avatar} color={e.color} size={10}/>
              <div className="text-[10px] font-bold text-white truncate max-w-full px-1">{e.name.split(" ")[0]}</div>
              <div className="text-[11px] font-black tabular-nums" style={{color:col}}>{e.xp.toLocaleString()} XP</div>
              <div className={cn("w-full rounded-t-xl flex items-center justify-center",heights[i])} style={{background:`${col}18`,border:`1px solid ${col}25`}}>
                <div style={{color:col}}>{medalIcon(podPos)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Full list */}
      <GlassCard className="p-4">
        <div className="space-y-1.5">
          {entries.map(e => (
            <div key={e.rank} className={cn(
              "flex items-center gap-3 p-3 rounded-xl transition-all",
              e.you?"border border-[#3b5bdb]/30 bg-[#3b5bdb]/8":"hover:bg-white/3"
            )}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{color:medalColor(e.rank),background:`${medalColor(e.rank)}15`}}>
                {medalIcon(e.rank)}
              </div>
              <AvatarBubble initials={e.avatar} color={e.color} size={8}/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white truncate">{e.name}</span>
                  {e.you && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#3b5bdb]/20 text-[#3b5bdb] border border-[#3b5bdb]/25">YOU</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#78788c] mt-0.5">
                  <span>🔥 {e.streak}</span>
                  <span>·</span>
                  <span>{e.accuracy}% acc</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-black tabular-nums" style={{color:medalColor(e.rank)}}>{e.xp.toLocaleString()}</div>
                <div className="text-[9px] text-[#78788c]">XP</div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────
function BattleHistory({ onBack, onReplay }: { onBack:()=>void; onReplay:()=>void }) {
  const totWins = HISTORY_ENTRIES.filter(h=>h.result==="won").length;
  const totBattles = HISTORY_ENTRIES.length;
  const totalXP = HISTORY_ENTRIES.reduce((a,h)=>a+h.xp,0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all">
          <ArrowLeft className="w-4 h-4"/>
        </button>
        <h2 className="text-xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Battle History</h2>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {label:"Battles",  value:totBattles, color:"#3b5bdb"},
          {label:"Won",      value:totWins,    color:"#4aa87a"},
          {label:"Total XP", value:totalXP,   color:"#c08a3a"},
        ].map(s=>(
          <GlassCard key={s.label} className="p-4 text-center">
            <div className="text-2xl font-black tabular-nums mb-0.5" style={{color:s.color}}>{s.value}</div>
            <div className="text-[11px] text-[#78788c]">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* Win streak */}
      <div className="flex items-center gap-3 p-4 rounded-2xl border border-rose-400/20 bg-rose-400/5">
        <Flame className="w-6 h-6 text-rose-400"/>
        <div>
          <div className="text-sm font-black text-white">2-win streak 🔥</div>
          <div className="text-xs text-[#78788c]">Keep going — your best is 5 wins in a row</div>
        </div>
      </div>

      {/* History list */}
      <div className="space-y-3">
        {HISTORY_ENTRIES.map(h=>{
          const won   = h.result==="won";
          const rc    = won?"#4aa87a":"#cc5069";
          const subj  = subjects.find(s=>s.name===h.subject);
          return (
            <div key={h.id} className="flex items-start gap-4 p-4 rounded-2xl border border-white/7 bg-[#131316] hover:border-white/12 transition-all">
              {/* Result indicator */}
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-sm"
                style={{background:`${rc}15`,color:rc,border:`1px solid ${rc}25`}}>
                {won?"W":"L"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <TypeBadge type={h.type}/>
                  {subj && <SubjectBadge subject={subj.name} color={subj.color}/>}
                </div>
                <div className="text-xs font-bold text-white mb-0.5">
                  vs {h.opponent} · <span style={{color:rc}}>{h.myScore}–{h.theirScore}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#78788c]">
                  <span>{h.date}</span><span>·</span>
                  <span>{h.duration}</span><span>·</span>
                  <span>{h.accuracy}% accuracy</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1 text-amber-400 text-xs font-bold mb-1"><Zap className="w-3 h-3"/>+{h.xp}</div>
                <div className="text-[10px] text-[#78788c]">🪙 +{h.coins}</div>
                <button onClick={onReplay} className="mt-2 text-[10px] text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors flex items-center gap-0.5">
                  <Repeat className="w-3 h-3"/> Rematch
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function Battleground({ setPage }: { setPage?: (p: PageKey) => void }) {
  const [phase,   setPhase]   = useState<Phase>("home");
  const [config,  setConfig]  = useState<BattleConfig|null>(null);
  const [result,  setResult]  = useState<BattleResult|null>(null);

  const defaultConfig: BattleConfig = {
    type:"1v1", subject:"Mathematics", chapter:"Integration",
    difficulty:"medium", questions:10, timeLimitMin:5,
    visibility:"public", inviteCode:genCode(),
  };

  function handleStartBattle() { setPhase("create"); }

  function handleConfigDone(cfg: BattleConfig) {
    setConfig(cfg); setPhase("battle");
  }

  function handleBattleFinish(res: BattleResult) {
    setResult(res); setPhase("results");
  }

  function handleHome() { setPhase("home"); setResult(null); }
  function handleReplay() { setPhase("battle"); }

  return (
    <div>
      {phase==="home"        && <Home onPhase={setPhase} onStartBattle={handleStartBattle}/>}
      {phase==="create"      && <CreateBattle onBack={()=>setPhase("home")} onStart={handleConfigDone}/>}
      {phase==="battle"      && <BattleArena config={config??defaultConfig} onFinish={handleBattleFinish}/>}
      {phase==="results"     && result && <Results result={result} onHome={handleHome} onReplay={handleReplay}/>}
      {phase==="leaderboard" && <Leaderboard onBack={handleHome}/>}
      {phase==="history"     && <BattleHistory onBack={handleHome} onReplay={handleReplay}/>}
    </div>
  );
}
