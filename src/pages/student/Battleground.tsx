import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLatestEffect } from "@/hooks/useLatestEffect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Trophy, Sparkles, Users, Clock, ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { PodiumRow } from "@/components/battleground/bg-bits";
import "@/components/battleground/battle-arena.css";
import { cn } from "@/lib/utils";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";
import { useAcademicContext, BattleExperienceService, resolveStudentServiceContext, type ServiceContext } from "@/academic";
import { StudentSessionSkeleton } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { displaySubject } from "@/lib/academicDisplay";
import { toErrorMessage } from "@/lib/presentation";
import { pluralise } from "@/lib/plural";

const BG_BASE = "/student/battleground";





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
  const [answerSyncFailed, setAnswerSyncFailed] = useState(false);
  const [revealedCorrectIndex, setRevealedCorrectIndex] = useState<number | null>(null);
  const [finishingBattle, setFinishingBattle] = useState(false);
  /** correct_index per question, fetched ONLY once the battle is finished — never
   *  merged into `questions` (which is fetched at battle-entry, before answering,
   *  and must never carry correct_index or a client inspecting network traffic
   *  could read the answer key before answering). Safe here because the battle
   *  is already over and no further answering can happen. */
  const [reviewCorrectIndex, setReviewCorrectIndex] = useState<Record<string, number>>({});
  const answeringRef = useRef(false);
  const answeredQRef = useRef<Set<string>>(new Set());
  const timerFiredRef = useRef(false);
  const beginRun = useLatestEffect();

  // Load
  useEffect(() => {
    if (!id || !user) return;
    const isStale = beginRun();
    (async () => {
      setBattleLoading(true);
      try {
        const { data: b, error: battleErr } = await supabase.from("battles").select("*").eq("id", id).maybeSingle();
        if (battleErr) {
          toast({ title: "Could not load battle", description: toErrorMessage(battleErr, "Please try again."), variant: "destructive" });
        }
        const { data: qs, error: qsErr } = await supabase
          .from("battle_questions")
          // `explanation` is NOT a column on battle_questions. Measured
          // 2026-09-09: the table is id, battle_id, order_index, question,
          // options, correct_index, points, bank_question_id, concept,
          // subconcept, school_id. PostgREST refuses the WHOLE select for one
          // unknown name, so this load failed for every student on every
          // battle — and the value was never read anywhere in this file.
          // Caught by `npm run lint:client-columns` on its first run.
          .select("id, battle_id, order_index, question, options, points, concept, subconcept, bank_question_id")
          .eq("battle_id", id)
          .order("order_index");
        if (qsErr) {
          toast({ title: "Could not load questions", description: toErrorMessage(qsErr, "Please try again."), variant: "destructive" });
        }
        // A newer room load (a different battle id) may have started while the
        // two fetches above were in flight — don't let this slower, superseded
        // response paint a different battle's questions/state on top of it.
        if (isStale()) return;
        setBattle(b);
        setQuestions(qs ?? []);
        const { data: existing, error: existingErr } = await supabase.from("battle_participants").select("*").eq("battle_id", id).eq("user_id", user.id).maybeSingle();
        if (existingErr) {
          toast({ title: "Could not check your participation", description: toErrorMessage(existingErr, "Please try again."), variant: "destructive" });
        }
        if (isStale()) return;
        let pid = existing?.id;
        if (!pid) {
          try {
            let joinCtx: ServiceContext | null = ctx && academicReady ? ctx : null;
            if (!joinCtx) {
              joinCtx = await resolveStudentServiceContext();
            }
            // Re-check the duel-full count as close to the join write as possible
            // (right before it, after ctx resolution) to shrink the client-side
            // check-then-act window. This narrows but cannot fully close the race:
            // two joins within this window can still both pass. Fully closing it
            // needs a server-side guard (DB constraint/trigger or an atomic
            // count-check-and-insert RPC) — not present today.
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
            pid = await BattleExperienceService.joinById(joinCtx, id);
          } catch (joinErr) {
            toast({
              title: toErrorMessage(joinErr, "Could not join battle"),
              variant: "destructive",
            });
            return;
          }
        } else if (existing) {
          // CHUNK 10.7. `pid` is `existing?.id`, so reaching this branch
          // already implies `existing` is non-null — but the compiler cannot
          // follow the link through the optional chain. The guard proves it
          // instead of asserting it, and costs one truthiness check.
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
                finishCtx = await resolveStudentServiceContext();
              }
              await BattleExperienceService.finish(finishCtx, pid);
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
        if (isStale()) return;
        setQuestionStart(Date.now());
        if (b) setTimeLeft(b.per_question_sec);
        if ((qs ?? []).length > 0 && !existing?.finished_at && !didAutoFinish) setReadyCount(3);
      } finally {
        setBattleLoading(false);
      }
    })();
  }, [id, user, ctx, academicReady, beginRun]);

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
      const { data, error } = await supabase.from("battle_participants").select("*").eq("battle_id", id).order("score", { ascending: false });
      if (error) { console.warn("[Battleground] leaderboard refresh failed:", error.message); return; }
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

  // Correct answers, for review only — deliberately a separate fetch gated on
  // `finished`, never merged into the live `questions` array (see state comment above).
  useEffect(() => {
    if (!finished || !id) return;
    supabase.from("battle_questions").select("id, correct_index").eq("battle_id", id).then(({ data, error }) => {
      if (error) {
        toast({ title: "Could not load answer key for review", description: toErrorMessage(error, "Please try again."), variant: "destructive" });
        return;
      }
      const m: Record<string, number> = {};
      (data ?? []).forEach((row: { id: string; correct_index: number | null }) => {
        if (typeof row.correct_index === "number") m[row.id] = row.correct_index;
      });
      setReviewCorrectIndex(m);
    });
  }, [finished, id]);

  const currentQ = questions[qIdx];

  const handleAnswer = useCallback(async (idx: number) => {
    if (answeringRef.current || showResult || !currentQ || !participantId || readyCount !== null || !battle) return;
    if (answeredQRef.current.has(currentQ.id)) return;

    answeringRef.current = true;
    answeredQRef.current.add(currentQ.id);
    setSelected(idx);
    setShowResult(true);
    setSavingAnswer(true);
    setAnswerSyncFailed(false);
    setRevealedCorrectIndex(null);
    const elapsed = Date.now() - questionStart;

    try {
      const answerCtx = ctx && academicReady ? ctx : await resolveStudentServiceContext();
      let graded: {
        isCorrect: boolean;
        points: number;
        correctIndex: number | null;
        score: number;
        correctCount: number;
        answeredCount: number;
        totalTimeMs: number;
      };
      try {
        graded = await BattleExperienceService.submitAnswer(answerCtx, {
          participantId,
          questionId: currentQ.id,
          selectedIndex: idx,
          timeMs: elapsed,
        });
      } catch (rpcErr) {
        const msg = toErrorMessage(rpcErr, "");
        if (msg !== "BATTLE_SUBMIT_RPC_MISSING") throw rpcErr;
        // Fallback for when rpc_submit_battle_answer is unreachable. This branch
        // deliberately does NOT attempt to grade the answer: battle_questions.correct_index
        // is intentionally never fetched by the client (see the `questions` load effect
        // above) because doing so would expose the whole answer key before every
        // participant has answered. Without the server RPC there is no safe way to know
        // whether the selection was correct, so this records the raw answer as
        // unscored/incorrect (0 points) rather than fabricating a result, and tells the
        // student honestly that grading was unavailable.
        const newMe = {
          score: me.score,
          correct_count: me.correct_count,
          answered_count: me.answered_count + 1,
          total_time_ms: me.total_time_ms + elapsed,
        };
        await BattleExperienceService.recordAnswer(answerCtx, {
          participantId,
          questionId: currentQ.id,
          selectedIndex: idx,
          isCorrect: false,
          timeMs: elapsed,
          score: newMe.score,
          correctCount: newMe.correct_count,
          answeredCount: newMe.answered_count,
          totalTimeMs: newMe.total_time_ms,
        });
        graded = {
          isCorrect: false,
          points: 0,
          correctIndex: null,
          score: newMe.score,
          correctCount: newMe.correct_count,
          answeredCount: newMe.answered_count,
          totalTimeMs: newMe.total_time_ms,
        };
        toast({
          title: "Answer saved, but not scored",
          description: "Live grading was unavailable for this question — it was recorded but not scored. This shouldn't normally happen; try again next question.",
          variant: "destructive",
        });
      }

      setMe({
        score: graded.score,
        correct_count: graded.correctCount,
        answered_count: graded.answeredCount,
        total_time_ms: graded.totalTimeMs,
      });
      if (graded.correctIndex != null) setRevealedCorrectIndex(graded.correctIndex);
      if (graded.points > 0) {
        setPointsFlash(graded.points);
        setTimeout(() => setPointsFlash(null), 900);
      }
    } catch (writeErr) {
      answeredQRef.current.delete(currentQ.id);
      answeringRef.current = false;
      setAnswerSyncFailed(true);
      const msg = toErrorMessage(writeErr, "Network sync had a problem");
      toast({
        title: "Could not save answer — retry before continuing",
        description: msg,
        variant: "destructive",
      });
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
    if (savingAnswer || finishingBattle || answerSyncFailed) return;
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
            finishCtx = await resolveStudentServiceContext();
          }
          await BattleExperienceService.finish(finishCtx, participantId);
        } catch (finishErr) {
          const { data: fresh } = await supabase
            .from("battle_participants")
            .select("*")
            .eq("id", participantId)
            .maybeSingle();
          if (!fresh?.finished_at) {
            toast({
              title: toErrorMessage(finishErr, "Could not finish battle"),
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
    setRevealedCorrectIndex(null);
    setAnswerSyncFailed(false);
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
            <Trophy className={cn("w-16 h-16 mx-auto", myRank === 1 && !tiedAtTop ? "text-tier-gold" : "text-foreground/80")} />
            <h1 className="text-2xl font-semibold mt-4 text-foreground">{headline}</h1>
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
            const correctIndex = reviewCorrectIndex[q.id] ?? null;
            return (
              <Card key={q.id} className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Q{i + 1}</div>
                <MathText block className="font-medium text-sm leading-snug" text={q.question} />
                <div className="grid sm:grid-cols-2 gap-2 mt-3">
                  {(q.options as string[]).map((opt: string, oi: number) => {
                    const isCorrect = correctIndex !== null && oi === correctIndex;
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
                  correctIndex={correctIndex}
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
          <p className="text-sm text-muted-foreground mt-4">{displaySubject(battle.subject) || "—"} · {pluralise(questions.length, "question")}</p>
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
        <div className="section-label">{displaySubject(battle.subject) || "—"}</div>
        <MathText block className="text-lg md:text-xl font-semibold mt-2 leading-snug text-foreground" text={currentQ.question} />
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        {(Array.isArray(currentQ.options) ? currentQ.options : []).map((opt: string, i: number) => {
          const correctIdx = revealedCorrectIndex ?? (typeof currentQ.correct_index === "number" ? currentQ.correct_index : -1);
          const isCorrect = showResult && correctIdx >= 0 && i === correctIdx;
          const isSelected = i === selected;
          let style = "border-border hover:border-primary hover:shadow-card";
          if (showResult) {
            if (isCorrect) style = "border-accent bg-accent/10 shadow-elevated";
            else if (isSelected) style = "border-destructive bg-destructive/10";
            else style = "border-border opacity-50";
          }
          return (
            <button key={i} onClick={() => handleAnswer(i)} disabled={showResult && !answerSyncFailed}
              className={cn("p-4 rounded-xl border-2 text-left font-medium transition-all flex items-center gap-3", style)}>
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center font-bold text-sm shrink-0">{String.fromCharCode(65 + i)}</div>
              <MathText className="flex-1" text={opt} />
            </button>
          );
        })}
      </div>

      {showResult && (
        <div className="flex items-center justify-between gap-3 animate-rise">
          <div className={cn(
            "font-bold",
            answerSyncFailed
              ? "text-destructive"
              : revealedCorrectIndex != null && selected === revealedCorrectIndex
                ? "text-accent"
                : "text-destructive",
          )}>
            {answerSyncFailed
              ? "Save failed — tap an answer to retry"
              : revealedCorrectIndex != null && selected === revealedCorrectIndex
                ? "✓ Correct!"
                : selected === -1
                  ? "⏱ Time's up"
                  : "✗ Wrong"}
          </div>
          {answerSyncFailed ? (
            <Button
              onClick={() => {
                setShowResult(false);
                setSelected(null);
                setAnswerSyncFailed(false);
                answeringRef.current = false;
              }}
              className="btn-cta"
              variant="destructive"
            >
              Retry
            </Button>
          ) : (
            <Button onClick={next} className="btn-cta" disabled={savingAnswer || finishingBattle}>
              {savingAnswer || finishingBattle ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {finishingBattle ? "Finishing" : savingAnswer ? "Saving" : qIdx + 1 >= questions.length ? "Finish" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
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




