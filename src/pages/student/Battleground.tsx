import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, useNavigate, useParams, Link, NavLink, Outlet, useLocation, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Sword, Trophy, Sparkles, Users, Clock, ArrowLeft, TrendingUp, ChevronRight, Loader2 } from "lucide-react";
import { XPRing, BadgeCard, PodiumRow, Countdown } from "@/components/battleground/bg-bits";
// ArenaHub intentionally not mounted as product home — design Battleground is canonical.
import "@/components/battleground/battle-arena.css";
import { FrictionlessChallenge } from "@/components/battleground/FrictionlessChallenge";
import { BADGES, badgesByGroup, GROUP_LABEL, GROUP_ORDER } from "@/lib/badges";
import { cn } from "@/lib/utils";
import { BadgeEquipPanel } from "@/components/student/BadgeEquipPanel";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import SharedLeaderboard from "@/pages/shared/LeaderboardPage";
import BattleReportPage from "./BattleReportPage";
import { notifyStudentXpUpdated } from "@/hooks/useStudentXp";
import { useAcademicContext, BattleExperienceService, resolveStudentServiceContext, type ServiceContext } from "@/academic";
import { StudentAnalyticsSkeleton, StudentDashboardSkeleton, StudentSessionSkeleton } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";

const BG_BASE = "/student/battleground";

const BG_TABS = [
  { to: BG_BASE, label: "Arena", end: true, icon: Sword },
  { to: `${BG_BASE}/create`, label: "Challenge", end: true, icon: Users },
  { to: `${BG_BASE}/progress`, label: "Progress", end: true, icon: TrendingUp },
] as const;

function BattlegroundLayout() {
  const location = useLocation();
  const immersive = /\/battle\/|\/report\//.test(location.pathname);

  return (
    <div className="wisdom-arena space-y-4">
      {!immersive && (
        <nav className="flex gap-1 overflow-x-auto pb-1 scrollbar-none" aria-label="Battleground sections">
          {BG_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    "ba-tab flex items-center gap-1.5 shrink-0",
                    isActive ? "!bg-[var(--ba-primary-container)] !text-white" : "",
                  )
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>
      )}
      <Outlet />
    </div>
  );
}

// =================== ARENA (LEGACY — not product home) ===================
/** Design Battleground at /student/battleground is canonical. ArenaHub is isolated. */
function Arena() {
  return <Navigate to="/student/battleground" replace />;
}

// =================== CREATE / CHALLENGE (frictionless) ===================
function CreateBattle() {
  const { user } = useAuth();
  const [student, setStudent] = useState<any>(null);
  useEffect(() => {
    if (!user) return;
    supabase.from("students").select("class_id, classes(name, section, display_name)").eq("user_id", user.id).maybeSingle().then(({ data }) => setStudent(data));
  }, [user]);

  return (
    <div className="space-y-4 animate-rise">
      <Link to={BG_BASE} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to Arena
      </Link>
      <Card className="p-5 hero-panel">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/70"><Sword className="w-3.5 h-3.5" /> Matchmaking</div>
        <h1 className="text-xl font-semibold mt-1 text-white">Challenge</h1>
        <p className="text-sm text-white/75 mt-1">Pick a friend, subject, and topic — the arena handles the rest.</p>
      </Card>
      <FrictionlessChallenge
        classId={student?.class_id}
        className={student?.classes?.name ?? student?.classes?.display_name}
        variant="page"
      />
    </div>
  );
}

// =================== BATTLE ROOM ===================
export function BattleRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const nav = useNavigate();
  const [battle, setBattle] = useState<any>(null);
  const [battleLoading, setBattleLoading] = useState(true);
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
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [finishingBattle, setFinishingBattle] = useState(false);
  const answeringRef = useRef(false);
  const answeredQRef = useRef<Set<string>>(new Set());
  const timerFiredRef = useRef(false);

  // Load
  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      setBattleLoading(true);
      try {
        const { data: b, error: battleErr } = await supabase.from("battles").select("*").eq("id", id).maybeSingle();
        if (battleErr) {
          toast({ title: "Could not load battle", description: battleErr.message, variant: "destructive" });
        }
        setBattle(b);
        const { data: qs, error: qsErr } = await supabase.from("battle_questions").select("*").eq("battle_id", id).order("order_index");
        if (qsErr) {
          toast({ title: "Could not load questions", description: qsErr.message, variant: "destructive" });
        }
        setQuestions(qs ?? []);
        const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
        const name = prof?.full_name || prof?.email?.split("@")[0] || "Student";
        const { data: stu } = await supabase.from("students").select("id").eq("user_id", user.id).maybeSingle();
        const { data: existing } = await supabase.from("battle_participants").select("*").eq("battle_id", id).eq("user_id", user.id).maybeSingle();
        let pid = existing?.id;
        if (!pid) {
          if (b?.mode === "duel") {
            const { count } = await supabase
              .from("battle_participants")
              .select("id", { count: "exact", head: true })
              .eq("battle_id", id);
            if ((count ?? 0) >= 2) {
              toast({ title: "This duel is already full.", variant: "destructive" });
              return;
            }
          }
          try {
            let joinCtx: ServiceContext | null = ctx && academicReady ? ctx : null;
            if (!joinCtx) {
              try {
                joinCtx = await resolveStudentServiceContext();
              } catch {
                joinCtx = null;
              }
            }
            if (joinCtx) {
              pid = await BattleExperienceService.joinById(joinCtx, id);
            } else {
              const { data: p, error } = await supabase.from("battle_participants").insert({
                battle_id: id, user_id: user.id, student_id: stu?.id ?? null, display_name: name,
              }).select().single();
              if (error) throw error;
              pid = p.id;
            }
          } catch (joinErr) {
            toast({
              title: joinErr instanceof Error ? joinErr.message : "Could not join battle",
              variant: "destructive",
            });
            return;
          }
        } else {
          setMe(existing);
          if (existing.finished_at) setFinished(true);
        }
        setParticipantId(pid);
        let didAutoFinish = false;
        if (pid) {
          const { data: prior } = await supabase
            .from("battle_answers")
            .select("question_id")
            .eq("participant_id", pid);
          const priorAnswered = new Set((prior ?? []).map((a) => a.question_id));
          answeredQRef.current = priorAnswered;
          const firstUnanswered = (qs ?? []).findIndex((q: any) => !priorAnswered.has(q.id));
          if (firstUnanswered > 0) {
            setQIdx(firstUnanswered);
          } else if (firstUnanswered === -1 && (qs ?? []).length > 0 && !existing?.finished_at) {
            try {
              let finishCtx: ServiceContext | null = ctx && academicReady ? ctx : null;
              if (!finishCtx) {
                try {
                  finishCtx = await resolveStudentServiceContext();
                } catch {
                  finishCtx = null;
                }
              }
              if (finishCtx) {
                await BattleExperienceService.finish(finishCtx, pid);
              } else {
                // Last resort — raw RPC only when no academic context could be resolved at all.
                const { error: finishErr } = await supabase.rpc("rpc_finish_battle", { _participant_id: pid });
                if (finishErr) throw finishErr;
                notifyStudentXpUpdated();
              }
              setFinished(true);
              didAutoFinish = true;
            } catch (autoFinishErr) {
              toast({
                title: "Could not finish battle automatically",
                description:
                  autoFinishErr instanceof Error
                    ? autoFinishErr.message
                    : "Please finish from the last question to save your result.",
                variant: "destructive",
              });
              /* keep room open so the student can retry finishing manually */
            }
          }
        }
        setQuestionStart(Date.now());
        if (b) setTimeLeft(b.per_question_sec);
        if ((qs ?? []).length > 0 && !existing?.finished_at && !didAutoFinish) setReadyCount(3);
      } finally {
        setBattleLoading(false);
      }
    })();
  }, [id, user, ctx, academicReady]);

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

  const currentQ = questions[qIdx];

  const handleAnswer = useCallback(async (idx: number) => {
    if (answeringRef.current || showResult || !currentQ || !participantId || readyCount !== null || !battle) return;
    if (answeredQRef.current.has(currentQ.id)) return;

    answeringRef.current = true;
    answeredQRef.current.add(currentQ.id);
    setSelected(idx);
    setShowResult(true);
    setSavingAnswer(true);
    const elapsed = Date.now() - questionStart;
    const correct = idx >= 0 && idx === currentQ.correct_index;
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
    try {
      try {
        const answerCtx = ctx && academicReady ? ctx : await resolveStudentServiceContext();
        await BattleExperienceService.recordAnswer(answerCtx, {
          participantId,
          questionId: currentQ.id,
          selectedIndex: idx,
          isCorrect: correct,
          timeMs: elapsed,
          score: newMe.score,
          correctCount: newMe.correct_count,
          answeredCount: newMe.answered_count,
          totalTimeMs: newMe.total_time_ms,
        });
      } catch (writeErr) {
        const msg = writeErr instanceof Error ? writeErr.message : "Network sync had a problem";
        toast({
          title: "Answer saved locally for this round",
          description: msg,
        });
      }
    } finally {
      setSavingAnswer(false);
    }
  }, [showResult, currentQ, participantId, readyCount, battle, questionStart, me, ctx, academicReady]);

  // Per-question timer (guard against double fire at 0s)
  useEffect(() => {
    if (finished || showResult || !battle || readyCount !== null) return;
    if (timeLeft <= 0) {
      if (!timerFiredRef.current) {
        timerFiredRef.current = true;
        handleAnswer(-1);
      }
      return;
    }
    timerFiredRef.current = false;
    const t = setTimeout(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, showResult, finished, battle, readyCount, handleAnswer]);

  // Keep local score in sync with realtime leaderboard
  useEffect(() => {
    if (!user || finished) return;
    const mine = participants.find((p) => p.user_id === user.id);
    if (mine && !showResult && !answeringRef.current) {
      setMe({
        score: mine.score ?? 0,
        correct_count: mine.correct_count ?? 0,
        answered_count: mine.answered_count ?? 0,
        total_time_ms: mine.total_time_ms ?? 0,
      });
    }
  }, [participants, user, finished, showResult]);

  const next = async () => {
    if (savingAnswer || finishingBattle) return;
    if (qIdx + 1 >= questions.length) {
      if (!participantId) {
        toast({ title: "Could not finish battle — try rejoining the room", variant: "destructive" });
        return;
      }
      setFinishingBattle(true);
      try {
        try {
          let finishCtx: ServiceContext | null = ctx && academicReady ? ctx : null;
          if (!finishCtx) {
            try {
              finishCtx = await resolveStudentServiceContext();
            } catch {
              finishCtx = null;
            }
          }
          if (finishCtx) {
            await BattleExperienceService.finish(finishCtx, participantId);
          } else {
            // Last resort — raw RPC only when no academic context could be resolved at all.
            const { error: finishErr } = await supabase.rpc("rpc_finish_battle", {
              _participant_id: participantId,
            });
            if (finishErr) throw finishErr;
            notifyStudentXpUpdated();
          }
        } catch (finishErr) {
          const { data: fresh } = await supabase
            .from("battle_participants")
            .select("*")
            .eq("id", participantId)
            .maybeSingle();
          if (!fresh?.finished_at) {
            toast({
              title: finishErr instanceof Error ? finishErr.message : "Could not finish battle",
              variant: "destructive",
            });
            return;
          }
          setMe(fresh);
          notifyStudentXpUpdated();
          setFinished(true);
          return;
        }
        const { data: fresh } = await supabase
          .from("battle_participants")
          .select("*")
          .eq("id", participantId)
          .maybeSingle();
        if (fresh) setMe(fresh);
        setFinished(true);
      } finally {
        setFinishingBattle(false);
      }
      return;
    }
    answeringRef.current = false;
    timerFiredRef.current = false;
    setShowResult(false);
    setSelected(null);
    setQIdx(qIdx + 1);
    setTimeLeft(battle.per_question_sec);
    setQuestionStart(Date.now());
  };

  if (battleLoading) return <StudentSessionSkeleton label="Loading battle…" />;
  if (!battle) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto space-y-4">
        <p className="text-muted-foreground">This battle could not be found or you no longer have access.</p>
        <Button asChild variant="outline"><Link to={BG_BASE}>Back to Arena</Link></Button>
      </Card>
    );
  }

  if (finished) {
    const sorted = [...participants].sort((a, b) => b.score - a.score);
    const myRank = sorted.findIndex((p) => p.user_id === user?.id) + 1;
    const topScore = sorted[0]?.score ?? 0;
    const tiedAtTop = sorted.filter((p) => p.score === topScore).length > 1;
    const headline =
      sorted.length <= 1
        ? "Battle complete"
        : tiedAtTop && myRank === 1
          ? "Draw"
          : myRank === 1
            ? "You won"
            : "Battle complete";
    return (
      <div className="space-y-4 animate-rise max-w-2xl mx-auto">
        <Card className="p-8 hero-panel text-center animate-fade-in">
          <div className="relative">
            <Trophy className={cn("w-16 h-16 mx-auto", myRank === 1 && !tiedAtTop ? "text-tier-gold" : "text-white/80")} />
            <h1 className="text-2xl font-semibold mt-4 text-white">{headline}</h1>
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
          <h3 className="font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Question review & insights</h3>
          {questions.map((q, i) => {
            const ans = reviewAnswers[q.id];
            const sel = ans ? ans.selected_index : null;
            const wasCorrect = ans ? ans.is_correct : null;
            return (
              <Card key={q.id} className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Q{i + 1}</div>
                <MathText block className="font-medium text-sm leading-snug" text={q.question} />
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
                        <MathText className="flex-1" text={opt} />
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
            <Button onClick={() => nav(`${BG_BASE}/report/${participantId}`)} className="flex-1 btn-cta">
              <Sparkles className="w-4 h-4 mr-1" /> Full analytics (24h)
            </Button>
          )}
          <Button onClick={() => nav(BG_BASE)} variant="outline" className="flex-1">Back to Arena</Button>
          <Button onClick={() => nav(BG_BASE)} variant="outline" className="flex-1">New Battle</Button>
        </div>
      </div>
    );
  }

  if (!currentQ) return (
    <Card className="p-8 text-center max-w-md mx-auto space-y-4">
      <p className="text-muted-foreground">No questions in this battle — the question bank may be empty for this subject.</p>
      <div className="flex gap-2 justify-center flex-wrap">
        <Button asChild><Link to="/student/practice/math12">Class 12 Math practice</Link></Button>
        <Button asChild variant="outline"><Link to={BG_BASE}>Back to Arena</Link></Button>
      </div>
    </Card>
  );

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
        <Link to={BG_BASE} className="text-muted-foreground flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Exit</Link>
        <span className="font-semibold">Question {qIdx + 1} / {questions.length}</span>
        <span className={cn("font-mono font-bold tabular-nums px-3 py-1 rounded-full", timeLeft <= 5 ? "bg-destructive text-white animate-pulse" : "bg-muted")}>
          <Clock className="w-3 h-3 inline mr-1" />{timeLeft}s
        </span>
      </div>
      <Progress value={pct} className={cn("h-2", timeLeft <= 5 && "[&>div]:bg-destructive")} />

      <Card className="p-6 border border-border/70 bg-card">
        <div className="section-label">{battle.subject}</div>
        <MathText block className="text-lg md:text-xl font-semibold mt-2 leading-snug text-foreground" text={currentQ.question} />
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        {(Array.isArray(currentQ.options) ? currentQ.options : []).map((opt: string, i: number) => {
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
              <MathText className="flex-1" text={opt} />
            </button>
          );
        })}
      </div>

      {showResult && (
        <div className="flex items-center justify-between gap-3 animate-rise">
          <div className={cn("font-bold", selected === currentQ.correct_index ? "text-accent" : "text-destructive")}>
            {selected === currentQ.correct_index ? "✓ Correct! +" + (currentQ.points + Math.max(0, Math.floor((battle.per_question_sec * 1000 - (Date.now() - questionStart)) / 200))) + " XP" : selected === -1 ? "⏱ Time's up" : "✗ Wrong"}
          </div>
          <Button onClick={next} className="btn-cta" disabled={savingAnswer || finishingBattle}>
            {savingAnswer || finishingBattle ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {finishingBattle ? "Finishing" : savingAnswer ? "Saving" : qIdx + 1 >= questions.length ? "Finish" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
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
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      supabase.from("student_badges").select("*").eq("user_id", user.id),
      supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle(),
    ]).then(([badgesRes, xpRes]) => {
      setBadges(badgesRes.data ?? []);
      if (xpRes.data) setXp(xpRes.data);
      setLoading(false);
    });
  }, [user]);

  const earnedCodes = new Set(badges.map((b) => b.badge_code));
  const grouped = useMemo(() => badgesByGroup(), []);
  const totalBadges = Object.keys(BADGES).length;
  const earnedCount = Object.keys(BADGES).filter((c) => earnedCodes.has(c)).length;
  const pct = Math.round((earnedCount / totalBadges) * 100);

  if (loading) return <StudentAnalyticsSkeleton />;

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: x } = await supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle();
      if (x) setXp(x);
      const { data: parts, error: histErr } = await supabase
        .from("battle_participants")
        .select("*, battles(title,subject,topic,starts_at)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false })
        .limit(20);
      if (histErr) {
        // Fallback without embed if schema cache is stale
        const { data: flatParts, error: flatErr } = await supabase
          .from("battle_participants")
          .select("*")
          .eq("user_id", user.id)
          .order("joined_at", { ascending: false })
          .limit(20);
        if (flatErr) {
          toast({ title: "Could not load battle history", description: flatErr.message, variant: "destructive" });
          setHistory([]);
        } else {
          const ids = [...new Set((flatParts || []).map((p) => p.battle_id))];
          const byId: Record<string, { title: string; subject: string; topic: string | null; starts_at: string }> = {};
          if (ids.length) {
            const { data: battles } = await supabase
              .from("battles")
              .select("id,title,subject,topic,starts_at")
              .in("id", ids);
            for (const b of battles || []) byId[b.id] = b;
          }
          setHistory(
            (flatParts || []).map((p) => ({
              ...p,
              battles: byId[p.battle_id] ?? null,
            })),
          );
        }
      } else {
        setHistory(parts ?? []);
      }
      const { data: stu } = await supabase.from("students").select("id").eq("user_id", user.id).maybeSingle();
      if (stu) {
        const { data: m } = await supabase.from("marks").select("marks_obtained, exams(subject, max_marks)").eq("student_id", stu.id);
        setMarks(m ?? []);
      }
      setLoading(false);
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

  if (loading) return <StudentAnalyticsSkeleton />;

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
                to={`${BG_BASE}/report/${h.id}`}
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

function BattlegroundProgress() {
  return (
    <div className="space-y-10 animate-rise">
      <MyStats />
      <Achievements />
      <SharedLeaderboard />
    </div>
  );
}

// =================== ROOT ===================
export default function Battleground() {
  return (
    <Routes>
      <Route element={<BattlegroundLayout />}>
        <Route index element={<Arena />} />
        <Route path="create" element={<CreateBattle />} />
        <Route path="progress" element={<BattlegroundProgress />} />
        <Route path="stats" element={<Navigate to="../progress" replace />} />
        <Route path="achievements" element={<Navigate to="../progress" replace />} />
        <Route path="leaderboard" element={<Navigate to="../progress" replace />} />
      </Route>
      <Route path="battle/:id" element={<BattleRoom />} />
      <Route path="report/:participantId" element={<BattleReportPage />} />
    </Routes>
  );
}
