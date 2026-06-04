import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Sword, Trophy, Sparkles, Plus, Users, Clock, Target, ArrowLeft, TrendingUp, Award, Flame, ChevronRight, Zap, Loader2, BookOpen } from "lucide-react";
import { XPRing, StreakFlame, BadgeCard, BattleCard, PodiumRow, Countdown } from "@/components/battleground/bg-bits";
import { FrictionlessChallenge } from "@/components/battleground/FrictionlessChallenge";
import { InviteFriends, MyInvites } from "@/components/battleground/Invites";
import { BattleFeed } from "@/components/battleground/BattleFeed";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { BADGES, badgesByGroup, GROUP_LABEL, GROUP_ORDER } from "@/lib/badges";
import { cn } from "@/lib/utils";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { BadgeEquipPanel } from "@/components/student/BadgeEquipPanel";
import SharedLeaderboard from "@/pages/shared/LeaderboardPage";
import BattleReportPage from "./BattleReportPage";

// =================== ARENA (HOME) ===================
function Arena() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [student, setStudent] = useState<any>(null);
  const [xp, setXp] = useState<any>({ xp: 0, level: 1, current_streak: 0, total_battles: 0, wins: 0 });
  const [battles, setBattles] = useState<any[]>([]);
  const [topClass, setTopClass] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: s } = await supabase.from("students").select("*, classes(name,section,display_name)").eq("user_id", user.id).maybeSingle();
      setStudent(s);
      const { data: x } = await supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle();
      if (x) setXp(x);
      const { data: b } = await supabase.from("battles")
        .select("*").eq("is_public", true).neq("status", "finished")
        .order("starts_at", { ascending: true }).limit(8);
      setBattles(b ?? []);
      // Top performers in class
      if (s?.class_id) {
        const { data: cb } = await supabase.from("battles").select("id").eq("class_id", s.class_id).limit(50);
        const ids = (cb ?? []).map((r: any) => r.id);
        if (ids.length) {
          const { data: parts } = await supabase.from("battle_participants")
            .select("user_id, display_name, score").in("battle_id", ids);
          const agg: Record<string, { name: string; score: number }> = {};
          (parts ?? []).forEach((p: any) => {
            if (!agg[p.user_id]) agg[p.user_id] = { name: p.display_name || "Student", score: 0 };
            agg[p.user_id].score += p.score;
          });
          const sorted = Object.entries(agg).map(([uid, v]) => ({ uid, ...v })).sort((a, b) => b.score - a.score).slice(0, 5);
          setTopClass(sorted);
        }
      }
    })();
  }, [user]);

  return (
    <div className="space-y-6 animate-rise">
      {/* Hero */}
      <Card className="hero-panel p-6">
        <div className="flex items-center gap-6 flex-wrap">
          <XPRing xp={xp.xp} level={xp.level} />
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/70">
              <Sword className="w-3.5 h-3.5" /> Battleground
            </div>
            <h1 className="text-2xl font-semibold mt-1 flex flex-wrap items-center gap-2 text-white">
              {student?.full_name?.split(" ")[0] || "Student"}
              <EquippedBadge code={xp.equipped_badge} size="sm" showLabel />
            </h1>
            <p className="text-sm text-white/75 mt-1">Compete with classmates and track your academic progress.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <StreakFlame streak={xp.current_streak} />
              <span className="text-xs px-2.5 py-1 rounded-md bg-white/10 text-white/90 font-medium">{xp.wins} wins</span>
              <span className="text-xs px-2.5 py-1 rounded-md bg-white/10 text-white/90 font-medium">{xp.total_battles} battles</span>
            </div>
          </div>
          <Button onClick={() => nav("create")} size="lg" className="btn-cta shrink-0">
            <Sword className="w-4 h-4 mr-2" /> New challenge
          </Button>
        </div>
      </Card>

      {/* Frictionless challenge — subject → chapter → topic → start */}
      <FrictionlessChallenge classId={student?.class_id} />

      {/* Pending invites from classmates */}
      <MyInvites />

      {/* Live competitive activity timeline */}
      <BattleFeed />

      {/* Daily challenge */}
      <Card className="p-4 surface-card">
        <div className="flex items-center gap-3">
          <div className="icon-tile">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="section-label">Daily goal</div>
            <div className="font-medium text-sm mt-0.5">Win one battle today for bonus XP</div>
            <Progress value={Math.min(100, (xp.total_battles % 5) * 20)} className="mt-2 h-1.5" />
          </div>
        </div>
      </Card>

      {/* Quick nav */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: "achievements", icon: Award, label: "Badges" },
          { to: "stats", icon: TrendingUp, label: "Analytics" },
          { to: "leaderboard", icon: Trophy, label: "Leaderboard" },
          { to: "create", icon: Sword, label: "Challenge" },
        ].map((q) => (
          <Link key={q.to} to={q.to}>
            <Card className="p-4 surface-card cursor-pointer">
              <div className="icon-tile mb-3">
                <q.icon className="w-5 h-5" />
              </div>
              <div className="font-medium text-sm">{q.label}</div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Live & upcoming battles */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Live & upcoming</h2>
          <Link to="create" className="text-xs text-primary font-semibold">+ Create</Link>
        </div>
        {battles.length === 0 ? (
          <Card className="p-8 text-center">
            <Sword className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <div className="font-semibold mt-3">No active battles</div>
            <p className="text-sm text-muted-foreground mt-1">Be the first to challenge your class!</p>
            <Button onClick={() => nav("create")} className="mt-4 btn-cta">Start battle</Button>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {battles.map((b) => <BattleCard key={b.id} battle={b} onJoin={() => nav(`battle/${b.id}`)} />)}
          </div>
        )}
      </div>

      {/* Class top */}
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-tier-gold" /> Class leaderboard</h2>
        <Card className="p-3 space-y-2">
          {topClass.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Play a battle to start ranking.</p>
          ) : topClass.map((p, i) => (
            <PodiumRow key={p.uid} rank={i + 1} name={p.name} score={p.score} isMe={p.uid === user?.id} />
          ))}
        </Card>
      </div>
    </div>
  );
}

// =================== CREATE / CHALLENGE (frictionless) ===================
function CreateBattle() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [student, setStudent] = useState<any>(null);
  useEffect(() => {
    if (!user) return;
    supabase.from("students").select("class_id").eq("user_id", user.id).maybeSingle().then(({ data }) => setStudent(data));
  }, [user]);

  return (
    <div className="space-y-4 animate-rise">
      <button type="button" onClick={() => nav(-1)} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Arena
      </button>
      <Card className="p-5 hero-panel">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/70"><Sword className="w-3.5 h-3.5" /> Matchmaking</div>
        <h1 className="text-xl font-semibold mt-1 text-white">Challenge</h1>
        <p className="text-sm text-white/75 mt-1">Pick a friend, subject, and topic — the arena handles the rest.</p>
      </Card>
      <FrictionlessChallenge classId={student?.class_id} variant="page" />
    </div>
  );
}

// =================== BATTLE ROOM ===================
function BattleRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [battle, setBattle] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [questionStart, setQuestionStart] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [me, setMe] = useState<any>({ score: 0, correct_count: 0, total_time_ms: 0, answered_count: 0 });
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, any>>({});
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [pointsFlash, setPointsFlash] = useState<number | null>(null);

  // Load
  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data: b } = await supabase.from("battles").select("*").eq("id", id).maybeSingle();
      setBattle(b);
      const { data: qs } = await supabase.from("battle_questions").select("*").eq("battle_id", id).order("order_index");
      setQuestions(qs ?? []);
      // Display name
      const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
      const name = prof?.full_name || prof?.email?.split("@")[0] || "Student";
      const { data: stu } = await supabase.from("students").select("id").eq("user_id", user.id).maybeSingle();
      // Join (idempotent)
      const { data: existing } = await supabase.from("battle_participants").select("*").eq("battle_id", id).eq("user_id", user.id).maybeSingle();
      let pid = existing?.id;
      if (!pid) {
        const { data: p, error } = await supabase.from("battle_participants").insert({
          battle_id: id, user_id: user.id, student_id: stu?.id ?? null, display_name: name,
        }).select().single();
        if (error) { toast({ title: error.message, variant: "destructive" }); return; }
        pid = p.id;
      } else {
        setMe(existing);
        if (existing.finished_at) setFinished(true);
      }
      setParticipantId(pid);
      setQuestionStart(Date.now());
      if (b) setTimeLeft(b.per_question_sec);
      if ((qs ?? []).length > 0) setReadyCount(3);
    })();
  }, [id, user]);

  // Pre-battle 3-2-1 countdown
  useEffect(() => {
    if (readyCount === null || finished) return;
    if (readyCount > 0) {
      const t = setTimeout(() => setReadyCount(readyCount - 1), 1000);
      return () => clearTimeout(t);
    }
    setReadyCount(null);
    setQuestionStart(Date.now());
  }, [readyCount, finished]);

  // Realtime participants
  useEffect(() => {
    if (!id) return;
    const refresh = async () => {
      const { data } = await supabase.from("battle_participants").select("*").eq("battle_id", id).order("score", { ascending: false });
      setParticipants(data ?? []);
    };
    refresh();
    const ch = supabase.channel(`battle-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "battle_participants", filter: `battle_id=eq.${id}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  // Load my per-question answers for the post-battle review
  useEffect(() => {
    if (!finished || !participantId) return;
    supabase.from("battle_answers").select("*").eq("participant_id", participantId).then(({ data }) => {
      const m: Record<string, any> = {};
      (data ?? []).forEach((x: any) => { m[x.question_id] = x; });
      setReviewAnswers(m);
    });
  }, [finished, participantId]);

  // Per-question timer
  useEffect(() => {
    if (finished || showResult || !battle || readyCount !== null) return;
    if (timeLeft <= 0) { handleAnswer(-1); return; }
    const t = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, showResult, finished, battle, readyCount]);

  const currentQ = questions[qIdx];

  const handleAnswer = async (idx: number) => {
    if (showResult || !currentQ || !participantId || readyCount !== null) return;
    setSelected(idx);
    setShowResult(true);
    const elapsed = Date.now() - questionStart;
    const correct = idx === currentQ.correct_index;
    const pts = correct ? currentQ.points + Math.max(0, Math.floor((battle.per_question_sec * 1000 - elapsed) / 200)) : 0;
    const newMe = {
      score: me.score + pts,
      correct_count: me.correct_count + (correct ? 1 : 0),
      answered_count: me.answered_count + 1,
      total_time_ms: me.total_time_ms + elapsed,
    };
    setMe(newMe);
    if (pts > 0) {
      setPointsFlash(pts);
      setTimeout(() => setPointsFlash(null), 900);
    }
    await supabase.from("battle_answers").insert({
      participant_id: participantId, question_id: currentQ.id,
      selected_index: idx, is_correct: correct, time_ms: elapsed,
    });
    await supabase.from("battle_participants").update(newMe).eq("id", participantId);
  };

  const next = async () => {
    setShowResult(false);
    setSelected(null);
    if (qIdx + 1 >= questions.length) {
      // finish
      await supabase.rpc("rpc_finish_battle", { _participant_id: participantId });
      setFinished(true);
      return;
    }
    setQIdx(qIdx + 1);
    setTimeLeft(battle.per_question_sec);
    setQuestionStart(Date.now());
  };

  if (!battle) return <div className="p-8 text-center text-muted-foreground">Loading battle...</div>;

  if (finished) {
    const sorted = [...participants].sort((a, b) => b.score - a.score);
    const myRank = sorted.findIndex((p) => p.user_id === user?.id) + 1;
    return (
      <div className="space-y-4 animate-rise max-w-2xl mx-auto">
        <Card className="p-8 hero-panel text-center animate-fade-in">
          <div className="relative">
            <Trophy className={cn("w-16 h-16 mx-auto", myRank === 1 ? "text-tier-gold" : "text-white/80")} />
            <h1 className="text-2xl font-semibold mt-4 text-white">{myRank === 1 ? "You won" : "Battle complete"}</h1>
            <p className="opacity-80 mt-1">You ranked #{myRank} of {sorted.length}</p>
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div><div className="text-3xl font-semibold">{me.score}</div><div className="text-xs uppercase opacity-70">Score</div></div>
              <div><div className="text-3xl font-semibold">{me.correct_count}/{questions.length}</div><div className="text-xs uppercase opacity-70">Correct</div></div>
              <div><div className="text-3xl font-semibold">{Math.round(me.total_time_ms / 1000)}s</div><div className="text-xs uppercase opacity-70">Time</div></div>
            </div>
          </div>
        </Card>
        <Card className="p-3 space-y-2">
          <h3 className="font-bold px-2 py-1">Final Leaderboard</h3>
          {sorted.map((p, i) => <PodiumRow key={p.id} rank={i + 1} name={p.display_name} score={p.score} isMe={p.user_id === user?.id} />)}
        </Card>

        {/* Question-wise review + AI insights */}
        <div className="space-y-3">
          <h3 className="font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Question Review & AI Insights</h3>
          {questions.map((q, i) => {
            const ans = reviewAnswers[q.id];
            const sel = ans ? ans.selected_index : null;
            const wasCorrect = ans ? ans.is_correct : null;
            return (
              <Card key={q.id} className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Q{i + 1}</div>
                <div className="font-medium text-sm leading-snug">{q.question}</div>
                <div className="grid sm:grid-cols-2 gap-2 mt-3">
                  {(q.options as string[]).map((opt: string, oi: number) => {
                    const isCorrect = oi === q.correct_index;
                    const isSel = oi === sel;
                    return (
                      <div key={oi} className={cn(
                        "px-3 py-2 rounded-lg border text-sm flex items-center gap-2",
                        isCorrect && "border-accent bg-accent/10",
                        isSel && !isCorrect && "border-destructive bg-destructive/10",
                        !isCorrect && !isSel && "border-border opacity-70",
                      )}>
                        <span className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[11px] font-bold shrink-0">{String.fromCharCode(65 + oi)}</span>
                        <span className="flex-1">{opt}</span>
                        {isCorrect && <span className="text-[10px] font-semibold text-accent uppercase">Correct</span>}
                        {isSel && !isCorrect && <span className="text-[10px] font-semibold text-destructive uppercase">You</span>}
                      </div>
                    );
                  })}
                </div>
                <ExplainPanel
                  question={q.question}
                  options={q.options as string[]}
                  correctIndex={q.correct_index}
                  selectedIndex={sel}
                  subject={battle.subject}
                  topic={battle.topic ?? ""}
                  wasCorrect={wasCorrect}
                />
              </Card>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          {participantId && (
            <Button onClick={() => nav(`report/${participantId}`)} className="flex-1 btn-cta">
              <Sparkles className="w-4 h-4 mr-1" /> Full analytics (24h)
            </Button>
          )}
          <Button onClick={() => nav("/student/battleground")} variant="outline" className="flex-1">Back to Arena</Button>
          <Button onClick={() => nav("/student/battleground/create")} variant="outline" className="flex-1">New Battle</Button>
        </div>
      </div>
    );
  }

  if (!currentQ) return <div className="p-8 text-center text-muted-foreground">No questions in this battle.</div>;

  if (readyCount !== null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="text-center animate-pop">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-semibold mb-2">Get ready</div>
          <div className={cn(
            "font-semibold tabular-nums text-white rounded-xl px-8 py-6 bg-primary/90",
            readyCount === 0 ? "text-4xl" : "text-7xl",
          )}>
            {readyCount === 0 ? "FIGHT!" : readyCount}
          </div>
          <p className="text-sm text-muted-foreground mt-4">{battle.subject} · {questions.length} questions</p>
        </div>
      </div>
    );
  }

  const pct = (timeLeft / battle.per_question_sec) * 100;

  return (
    <div className="space-y-4 animate-rise max-w-3xl mx-auto relative">
      {pointsFlash != null && (
        <div className="pointer-events-none fixed top-1/3 left-1/2 -translate-x-1/2 z-40 text-3xl font-semibold text-accent animate-score-float">
          +{pointsFlash}
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <button onClick={() => nav(-1)} className="text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Exit</button>
        <span className="font-semibold">Question {qIdx + 1} / {questions.length}</span>
        <span className={cn("font-mono font-bold tabular-nums px-3 py-1 rounded-full", timeLeft <= 5 ? "bg-destructive text-white animate-pulse" : "bg-muted")}>
          <Clock className="w-3 h-3 inline mr-1" />{timeLeft}s
        </span>
      </div>
      <Progress value={pct} className={cn("h-2", timeLeft <= 5 && "[&>div]:bg-destructive")} />

      <Card className="p-6 border border-border/70 bg-card">
        <div className="section-label">{battle.subject}</div>
        <h2 className="text-lg md:text-xl font-semibold mt-2 leading-snug text-foreground">{currentQ.question}</h2>
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        {currentQ.options.map((opt: string, i: number) => {
          const isCorrect = i === currentQ.correct_index;
          const isSelected = i === selected;
          let style = "border-border hover:border-primary hover:shadow-card";
          if (showResult) {
            if (isCorrect) style = "border-accent bg-accent/10 shadow-elevated";
            else if (isSelected) style = "border-destructive bg-destructive/10";
            else style = "border-border opacity-50";
          }
          return (
            <button key={i} onClick={() => handleAnswer(i)} disabled={showResult}
              className={cn("p-4 rounded-xl border-2 text-left font-medium transition-all flex items-center gap-3", style)}>
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center font-bold text-sm shrink-0">{String.fromCharCode(65 + i)}</div>
              <span className="flex-1">{opt}</span>
            </button>
          );
        })}
      </div>

      {showResult && (
        <div className="flex items-center justify-between gap-3 animate-rise">
          <div className={cn("font-bold", selected === currentQ.correct_index ? "text-accent" : "text-destructive")}>
            {selected === currentQ.correct_index ? "✓ Correct! +" + (currentQ.points + Math.max(0, Math.floor((battle.per_question_sec * 1000 - (Date.now() - questionStart)) / 200))) + " XP" : selected === -1 ? "⏱ Time's up" : "✗ Wrong"}
          </div>
          <Button onClick={next} className="btn-cta">
            {qIdx + 1 >= questions.length ? "Finish" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Live mini leaderboard */}
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-1 pb-2 flex items-center gap-1"><Users className="w-3 h-3" /> Live ranks</div>
        <div className="space-y-1.5">
          {participants.slice(0, 5).map((p, i) => <PodiumRow key={p.id} rank={i + 1} name={p.display_name} score={p.score} isMe={p.user_id === user?.id} />)}
        </div>
      </Card>
    </div>
  );
}

// =================== ACHIEVEMENTS ===================
function Achievements() {
  const { user } = useAuth();
  const [badges, setBadges] = useState<any[]>([]);
  const [xp, setXp] = useState<any>({ xp: 0, level: 1, current_streak: 0, total_battles: 0, wins: 0 });
  useEffect(() => {
    if (!user) return;
    supabase.from("student_badges").select("*").eq("user_id", user.id).then(({ data }) => setBadges(data ?? []));
    supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => data && setXp(data));
  }, [user]);

  const earnedCodes = new Set(badges.map((b) => b.badge_code));
  const grouped = useMemo(() => badgesByGroup(), []);
  const totalBadges = Object.keys(BADGES).length;
  const earnedCount = Object.keys(BADGES).filter((c) => earnedCodes.has(c)).length;
  const pct = Math.round((earnedCount / totalBadges) * 100);

  return (
    <div className="space-y-5 animate-rise">
      <Card className="p-5 hero-panel flex items-center gap-5 flex-wrap">
        <XPRing xp={xp.xp} level={xp.level} size={100} />
        <div className="flex-1 min-w-[220px]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">Achievements</div>
          <h1 className="text-2xl font-semibold mt-1 text-white">{earnedCount} / {totalBadges} badges</h1>
          <div className="text-sm text-white/75">{xp.wins} wins · {xp.total_battles} battles · {xp.current_streak} day streak</div>
          <div className="mt-3 max-w-sm">
            <div className="h-2 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[11px] opacity-70 mt-1">{pct}% of the collection unlocked</div>
          </div>
        </div>
      </Card>

      {user && <BadgeEquipPanel userId={user.id} compact />}

      {GROUP_ORDER.map((g) => {
        const items = grouped[g];
        if (!items?.length) return null;
        const got = items.filter((b) => earnedCodes.has(b.code)).length;
        return (
          <div key={g}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">{GROUP_LABEL[g]}</h2>
              <span className="text-xs text-muted-foreground font-semibold">{got}/{items.length}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((b) => {
                const earned = earnedCodes.has(b.code);
                const found = badges.find((x) => x.badge_code === b.code);
                return <BadgeCard key={b.code} code={b.code} tier={found?.tier ?? b.tier} earned={earned} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =================== MY STATS ===================
function MyStats() {
  const { user } = useAuth();
  const [xp, setXp] = useState<any>({ xp: 0, level: 1, current_streak: 0, total_battles: 0, wins: 0 });
  const [history, setHistory] = useState<any[]>([]);
  const [marks, setMarks] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: x } = await supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle();
      if (x) setXp(x);
      const { data: parts } = await supabase.from("battle_participants").select("*, battles(title,subject,topic,starts_at)").eq("user_id", user.id).order("joined_at", { ascending: false }).limit(20);
      setHistory(parts ?? []);
      const { data: stu } = await supabase.from("students").select("id").eq("user_id", user.id).maybeSingle();
      if (stu) {
        const { data: m } = await supabase.from("marks").select("marks_obtained, exams(subject, max_marks)").eq("student_id", stu.id);
        setMarks(m ?? []);
      }
    })();
  }, [user]);

  const subjectStats = useMemo(() => {
    // Combine battle accuracy + exam marks
    const map: Record<string, { correct: number; total: number; marks: number; max: number }> = {};
    history.forEach((h: any) => {
      const sub = h.battles?.subject || "Other";
      if (!map[sub]) map[sub] = { correct: 0, total: 0, marks: 0, max: 0 };
      map[sub].correct += h.correct_count;
      map[sub].total += h.answered_count;
    });
    marks.forEach((m: any) => {
      const sub = m.exams?.subject || "Other";
      if (!map[sub]) map[sub] = { correct: 0, total: 0, marks: 0, max: 0 };
      map[sub].marks += Number(m.marks_obtained);
      map[sub].max += Number(m.exams?.max_marks || 0);
    });
    return Object.entries(map).map(([sub, s]) => {
      const battlePct = s.total ? (s.correct / s.total) * 100 : null;
      const examPct = s.max ? (s.marks / s.max) * 100 : null;
      const overall = battlePct != null && examPct != null ? (battlePct + examPct) / 2 : (battlePct ?? examPct ?? 0);
      return { subject: sub, overall: Math.round(overall), battlePct, examPct };
    }).sort((a, b) => b.overall - a.overall);
  }, [history, marks]);

  const strongest = subjectStats[0];
  const weakest = subjectStats[subjectStats.length - 1];

  const analytics = useMemo(() => {
    const totalCorrect = history.reduce((a, h) => a + (h.correct_count || 0), 0);
    const totalAnswered = history.reduce((a, h) => a + (h.answered_count || 0), 0);
    const accuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
    const avgScore = history.length ? Math.round(history.reduce((a, h) => a + (h.score || 0), 0) / history.length) : 0;
    // last 12 battles oldest→newest as accuracy %
    const trend = [...history]
      .slice(0, 12)
      .reverse()
      .map((h) => (h.answered_count ? Math.round((h.correct_count / h.answered_count) * 100) : 0));
    // consistency: distinct active days in history window
    const days = new Set(history.map((h) => new Date(h.joined_at).toDateString()));
    return { accuracy, avgScore, trend, activeDays: days.size };
  }, [history]);

  return (
    <div className="space-y-5 animate-rise">
      <Card className="p-5 hero-panel flex flex-wrap items-center gap-5">
        <XPRing xp={xp.xp} level={xp.level} />
        <div className="flex-1 min-w-[200px]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">Performance</div>
          <h1 className="text-2xl font-semibold mt-1 text-white">Your battle profile</h1>
          <div className="grid grid-cols-3 gap-3 mt-3 max-w-md">
            <div><div className="text-xl font-semibold">{xp.total_battles}</div><div className="text-[10px] uppercase opacity-70">Battles</div></div>
            <div><div className="text-xl font-semibold">{xp.wins}</div><div className="text-[10px] uppercase opacity-70">Wins</div></div>
            <div><div className="text-xl font-semibold">{xp.total_battles ? Math.round((xp.wins / xp.total_battles) * 100) : 0}%</div><div className="text-[10px] uppercase opacity-70">Win rate</div></div>
          </div>
        </div>
      </Card>

      {/* Analytics tiles + accuracy trend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-2xl font-semibold text-accent">{analytics.accuracy}%</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Accuracy</div></Card>
        <Card className="p-4"><div className="text-2xl font-semibold text-primary">{analytics.avgScore}</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg score</div></Card>
        <Card className="p-4"><div className="text-2xl font-semibold text-warning">{xp.best_win_streak ?? xp.current_streak ?? 0}</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Best streak</div></Card>
        <Card className="p-4"><div className="text-2xl font-semibold">{analytics.activeDays}</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Active days</div></Card>
      </div>

      {analytics.trend.length > 1 && (
        <Card className="p-5">
          <h2 className="font-bold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Accuracy Trend</h2>
          <div className="flex items-end gap-1.5 h-28">
            {analytics.trend.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group">
                <div
                  className={cn("w-full rounded-t-md transition-all", v >= 75 ? "bg-accent" : v >= 50 ? "bg-primary" : "bg-warning")}
                  style={{ height: `${Math.max(v, 4)}%` }}
                  title={`${v}%`}
                />
              </div>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground mt-2 text-center">Per-battle accuracy (oldest → latest)</div>
        </Card>
      )}

      {subjectStats.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {strongest && (
            <Card className="p-4 border-l-4 border-accent">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Strongest</div>
              <div className="text-xl font-bold mt-1 text-accent">{strongest.subject}</div>
              <div className="text-sm text-muted-foreground">{strongest.overall}% overall accuracy</div>
            </Card>
          )}
          {weakest && weakest.subject !== strongest?.subject && (
            <Card className="p-4 border-l-4 border-warning">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Needs work</div>
              <div className="text-xl font-bold mt-1 text-warning">{weakest.subject}</div>
              <div className="text-sm text-muted-foreground">{weakest.overall}% — focus here</div>
            </Card>
          )}
        </div>
      )}

      <Card className="p-5">
        <h2 className="font-bold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Subject Insights</h2>
        {subjectStats.length === 0 ? (
          <p className="text-sm text-muted-foreground">Play battles or take exams to unlock subject insights.</p>
        ) : (
          <div className="space-y-3">
            {subjectStats.map((s) => (
              <div key={s.subject}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{s.subject}</span>
                  <span className="text-muted-foreground">{s.overall}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", s.overall >= 75 ? "bg-accent" : s.overall >= 50 ? "bg-primary" : "bg-warning")} style={{ width: `${s.overall}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-bold mb-3 flex items-center gap-2"><Sword className="w-4 h-4" /> Battle History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No battles yet — jump into the arena!</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <Link
                key={h.id}
                to={`/student/battleground/report/${h.id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors"
              >
                <div>
                  <div className="font-semibold text-sm">{h.battles?.title}</div>
                  <div className="text-xs text-muted-foreground">{h.battles?.subject}{h.battles?.topic ? ` · ${h.battles.topic}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">{h.score} pts</div>
                  <div className="text-[10px] text-muted-foreground">{h.correct_count}/{h.answered_count} correct{h.rank ? ` · #${h.rank}` : ""}</div>
                  <div className="text-[10px] text-primary font-semibold mt-0.5">View report →</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// =================== ROOT ===================
export default function Battleground() {
  return (
    <Routes>
      <Route index element={<Arena />} />
      <Route path="create" element={<CreateBattle />} />
      <Route path="battle/:id" element={<BattleRoom />} />
      <Route path="achievements" element={<Achievements />} />
      <Route path="stats" element={<MyStats />} />
      <Route path="leaderboard" element={<SharedLeaderboard />} />
      <Route path="report/:participantId" element={<BattleReportPage />} />
    </Routes>
  );
}
