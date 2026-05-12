import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate, useParams, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Sword, Trophy, Sparkles, Plus, Users, Clock, Target, ArrowLeft, TrendingUp, Award, Flame, ChevronRight, Zap } from "lucide-react";
import { XPRing, StreakFlame, BadgeCard, BattleCard, PodiumRow, Countdown } from "@/components/battleground/bg-bits";
import { cn } from "@/lib/utils";

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
      <Card className="relative overflow-hidden bg-gradient-arena text-white border-0">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-gradient-victory blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 rounded-full bg-gradient-battle blur-3xl" />
        </div>
        <div className="relative p-6 flex items-center gap-6 flex-wrap">
          <XPRing xp={xp.xp} level={xp.level} />
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-80">
              <Sword className="w-3.5 h-3.5" /> Battleground
            </div>
            <h1 className="text-3xl font-black mt-1">Welcome back, {student?.full_name?.split(" ")[0] || "Champion"}</h1>
            <p className="text-sm opacity-80 mt-1">Compete. Conquer. Climb the leaderboard.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <StreakFlame streak={xp.current_streak} />
              <span className="text-xs px-3 py-1.5 rounded-full bg-white/15 font-semibold">🏆 {xp.wins} wins</span>
              <span className="text-xs px-3 py-1.5 rounded-full bg-white/15 font-semibold">⚔️ {xp.total_battles} battles</span>
            </div>
          </div>
          <Button onClick={() => nav("create")} size="lg" className="bg-gradient-victory hover:opacity-90 text-white font-bold shadow-glow">
            <Plus className="w-5 h-5 mr-1" /> New Battle
          </Button>
        </div>
      </Card>

      {/* Daily challenge */}
      <Card className="p-5 bg-gradient-battle text-white border-0 shadow-battle">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
            <Sparkles className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest opacity-80 font-semibold">Daily Mission</div>
            <div className="font-bold text-lg">Win 1 battle today · Earn 50 XP</div>
            <Progress value={Math.min(100, (xp.total_battles % 5) * 20)} className="mt-2 h-2 bg-white/20" />
          </div>
        </div>
      </Card>

      {/* Quick nav */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: "achievements", icon: Award, label: "Badges", color: "bg-gradient-victory" },
          { to: "stats", icon: TrendingUp, label: "My Stats", color: "bg-gradient-primary" },
          { to: "leaderboard", icon: Trophy, label: "Leaderboard", color: "bg-gradient-battle" },
          { to: "create", icon: Plus, label: "Challenge", color: "bg-gradient-hero" },
        ].map((q) => (
          <Link key={q.to} to={q.to}>
            <Card className="p-4 hover:shadow-elevated transition-all hover:-translate-y-0.5 cursor-pointer">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-white", q.color)}>
                <q.icon className="w-5 h-5" />
              </div>
              <div className="font-semibold text-sm mt-2">{q.label}</div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Live & upcoming battles */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg flex items-center gap-2"><Zap className="w-5 h-5 text-warning" /> Live & Upcoming</h2>
          <Link to="create" className="text-xs text-primary font-semibold">+ Create</Link>
        </div>
        {battles.length === 0 ? (
          <Card className="p-8 text-center">
            <Sword className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <div className="font-semibold mt-3">No active battles</div>
            <p className="text-sm text-muted-foreground mt-1">Be the first to challenge your class!</p>
            <Button onClick={() => nav("create")} className="mt-4 bg-gradient-battle text-white">Start Battle</Button>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {battles.map((b) => <BattleCard key={b.id} battle={b} onJoin={() => nav(`battle/${b.id}`)} />)}
          </div>
        )}
      </div>

      {/* Class top */}
      <div>
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Trophy className="w-5 h-5 text-tier-gold" /> Class Top 5</h2>
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

// =================== CREATE BATTLE ===================
function CreateBattle() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [student, setStudent] = useState<any>(null);
  const [title, setTitle] = useState("Algebra Quick Battle");
  const [subject, setSubject] = useState("Mathematics");
  const [topic, setTopic] = useState("");
  const [perQ, setPerQ] = useState(20);
  const [questions, setQuestions] = useState<any[]>([
    { question: "", options: ["", "", "", ""], correct_index: 0 },
  ]);

  useEffect(() => {
    if (!user) return;
    supabase.from("students").select("id, class_id, full_name").eq("user_id", user.id).maybeSingle().then(({ data }) => setStudent(data));
  }, [user]);

  const updateQ = (i: number, patch: any) => setQuestions((qs) => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  const updateOpt = (i: number, oi: number, v: string) => setQuestions((qs) => qs.map((q, idx) => idx === i ? { ...q, options: q.options.map((o: string, j: number) => j === oi ? v : o) } : q));
  const addQ = () => setQuestions((qs) => [...qs, { question: "", options: ["", "", "", ""], correct_index: 0 }]);
  const removeQ = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));

  const create = async () => {
    if (!user || !student?.class_id) {
      toast({ title: "You need to be in a class to create battles", variant: "destructive" });
      return;
    }
    const valid = questions.every((q) => q.question.trim() && q.options.every((o: string) => o.trim()));
    if (!valid) { toast({ title: "Fill in every question and option", variant: "destructive" }); return; }
    const { data: b, error } = await supabase.from("battles").insert({
      title, subject, topic: topic || null, type: "mcq", status: "live",
      class_id: student.class_id, creator_user_id: user.id,
      per_question_sec: perQ, question_count: questions.length, duration_sec: perQ * questions.length, is_public: true,
    }).select().single();
    if (error) { toast({ title: error.message, variant: "destructive" }); return; }
    const rows = questions.map((q, i) => ({ battle_id: b.id, order_index: i, question: q.question, options: q.options, correct_index: q.correct_index, points: 10 }));
    const { error: e2 } = await supabase.from("battle_questions").insert(rows);
    if (e2) { toast({ title: e2.message, variant: "destructive" }); return; }
    toast({ title: "Battle created — let the games begin!" });
    nav(`/student/battleground/battle/${b.id}`);
  };

  return (
    <div className="space-y-4 animate-rise max-w-3xl">
      <button onClick={() => nav(-1)} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Back</button>
      <Card className="p-5 bg-gradient-battle text-white border-0">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-80"><Sword className="w-3.5 h-3.5" /> Create Battle</div>
        <h1 className="text-2xl font-bold mt-1">Challenge your class</h1>
        <p className="text-sm opacity-80 mt-1">Set up a quiz, invite classmates, dominate the leaderboard.</p>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label>Battle title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>Subject</Label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Mathematics", "Science", "Physics", "Chemistry", "Biology", "English", "History", "Geography", "Computer Science", "General Knowledge"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Topic (optional)</Label><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Algebra" /></div>
          <div><Label>Seconds per question</Label><Input type="number" min={5} max={120} value={perQ} onChange={(e) => setPerQ(Number(e.target.value))} /></div>
        </div>
      </Card>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <Card key={i} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm flex items-center gap-2"><div className="w-7 h-7 rounded-lg bg-gradient-battle text-white flex items-center justify-center text-xs font-black">Q{i + 1}</div> Question</div>
              {questions.length > 1 && <button onClick={() => removeQ(i)} className="text-xs text-destructive">Remove</button>}
            </div>
            <Textarea value={q.question} onChange={(e) => updateQ(i, { question: e.target.value })} placeholder="Enter the question..." />
            <div className="grid md:grid-cols-2 gap-2">
              {q.options.map((opt: string, oi: number) => (
                <label key={oi} className={cn("flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all", q.correct_index === oi ? "border-accent bg-accent/10" : "border-border")}>
                  <input type="radio" name={`c-${i}`} checked={q.correct_index === oi} onChange={() => updateQ(i, { correct_index: oi })} />
                  <Input value={opt} onChange={(e) => updateOpt(i, oi, e.target.value)} placeholder={`Option ${oi + 1}`} className="border-0 focus-visible:ring-0 h-8 px-1" />
                </label>
              ))}
            </div>
          </Card>
        ))}
        <Button variant="outline" onClick={addQ} className="w-full"><Plus className="w-4 h-4 mr-1" /> Add Question</Button>
      </div>

      <Button onClick={create} size="lg" className="w-full bg-gradient-victory text-white font-bold shadow-glow">
        <Sword className="w-5 h-5 mr-2" /> Launch Battle
      </Button>
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
    })();
  }, [id, user]);

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

  // Per-question timer
  useEffect(() => {
    if (finished || showResult || !battle) return;
    if (timeLeft <= 0) { handleAnswer(-1); return; }
    const t = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, showResult, finished, battle]);

  const currentQ = questions[qIdx];

  const handleAnswer = async (idx: number) => {
    if (showResult || !currentQ || !participantId) return;
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
      await supabase.rpc("rpc_finish_battle" as any, { _participant_id: participantId });
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
        <Card className="p-8 bg-gradient-arena text-white border-0 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-victory opacity-20" />
          <div className="relative">
            <Trophy className="w-20 h-20 mx-auto text-tier-gold drop-shadow-[0_0_24px_rgba(255,200,0,0.6)]" />
            <h1 className="text-3xl font-black mt-3">{myRank === 1 ? "Victory!" : "Battle Complete"}</h1>
            <p className="opacity-80 mt-1">You ranked #{myRank} of {sorted.length}</p>
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div><div className="text-3xl font-black">{me.score}</div><div className="text-xs uppercase opacity-70">Score</div></div>
              <div><div className="text-3xl font-black">{me.correct_count}/{questions.length}</div><div className="text-xs uppercase opacity-70">Correct</div></div>
              <div><div className="text-3xl font-black">{Math.round(me.total_time_ms / 1000)}s</div><div className="text-xs uppercase opacity-70">Time</div></div>
            </div>
          </div>
        </Card>
        <Card className="p-3 space-y-2">
          <h3 className="font-bold px-2 py-1">Final Leaderboard</h3>
          {sorted.map((p, i) => <PodiumRow key={p.id} rank={i + 1} name={p.display_name} score={p.score} isMe={p.user_id === user?.id} />)}
        </Card>
        <div className="flex gap-2">
          <Button onClick={() => nav("/student/battleground")} className="flex-1">Back to Arena</Button>
          <Button onClick={() => nav("/student/battleground/create")} variant="outline" className="flex-1">New Battle</Button>
        </div>
      </div>
    );
  }

  if (!currentQ) return <div className="p-8 text-center text-muted-foreground">No questions in this battle.</div>;

  const pct = (timeLeft / battle.per_question_sec) * 100;

  return (
    <div className="space-y-4 animate-rise max-w-3xl mx-auto">
      <div className="flex items-center justify-between text-sm">
        <button onClick={() => nav(-1)} className="text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Exit</button>
        <span className="font-semibold">Question {qIdx + 1} / {questions.length}</span>
        <span className={cn("font-mono font-bold tabular-nums px-3 py-1 rounded-full", timeLeft <= 5 ? "bg-destructive text-white animate-pulse" : "bg-muted")}>
          <Clock className="w-3 h-3 inline mr-1" />{timeLeft}s
        </span>
      </div>
      <Progress value={pct} className={cn("h-2", timeLeft <= 5 && "[&>div]:bg-destructive")} />

      <Card className="p-6 bg-gradient-battle text-white border-0">
        <div className="text-[10px] uppercase tracking-widest opacity-80 font-semibold">{battle.subject}</div>
        <h2 className="text-xl md:text-2xl font-bold mt-2 leading-snug">{currentQ.question}</h2>
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
          <Button onClick={next} className="bg-gradient-battle text-white">
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
  const all = [
    { code: "first_win", tier: "bronze" as const },
    { code: "sharp_shooter", tier: "silver" as const },
    { code: "speed_master", tier: "gold" as const },
    { code: "consistency", tier: "gold" as const },
    { code: "topper", tier: "platinum" as const },
    { code: "quiz_winner", tier: "gold" as const },
  ];
  return (
    <div className="space-y-5 animate-rise">
      <Card className="p-5 bg-gradient-arena text-white border-0 flex items-center gap-5">
        <XPRing xp={xp.xp} level={xp.level} size={100} />
        <div>
          <div className="text-xs uppercase tracking-widest opacity-80 font-semibold">Achievements</div>
          <h1 className="text-2xl font-black mt-1">{badges.length} Badges Unlocked</h1>
          <div className="text-sm opacity-80">{xp.wins} wins · {xp.total_battles} battles · {xp.current_streak} day streak</div>
        </div>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {all.map((b) => {
          const earned = earnedCodes.has(b.code);
          const found = badges.find((x) => x.badge_code === b.code);
          return <BadgeCard key={b.code} code={b.code} tier={(found?.tier ?? b.tier) as any} earned={earned} />;
        })}
      </div>
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

  return (
    <div className="space-y-5 animate-rise">
      <Card className="p-5 bg-gradient-arena text-white border-0 flex flex-wrap items-center gap-5">
        <XPRing xp={xp.xp} level={xp.level} />
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs uppercase tracking-widest opacity-80 font-semibold">Performance</div>
          <h1 className="text-2xl font-black mt-1">Your Battle Profile</h1>
          <div className="grid grid-cols-3 gap-3 mt-3 max-w-md">
            <div><div className="text-xl font-black">{xp.total_battles}</div><div className="text-[10px] uppercase opacity-70">Battles</div></div>
            <div><div className="text-xl font-black">{xp.wins}</div><div className="text-[10px] uppercase opacity-70">Wins</div></div>
            <div><div className="text-xl font-black">{xp.total_battles ? Math.round((xp.wins / xp.total_battles) * 100) : 0}%</div><div className="text-[10px] uppercase opacity-70">Win rate</div></div>
          </div>
        </div>
      </Card>

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
              <div key={h.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
                <div>
                  <div className="font-semibold text-sm">{h.battles?.title}</div>
                  <div className="text-xs text-muted-foreground">{h.battles?.subject}{h.battles?.topic ? ` · ${h.battles.topic}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">{h.score} pts</div>
                  <div className="text-[10px] text-muted-foreground">{h.correct_count}/{h.answered_count} correct{h.rank ? ` · #${h.rank}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// =================== LEADERBOARD ===================
function LeaderboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("class");
  const [classRows, setClassRows] = useState<any[]>([]);
  const [globalRows, setGlobalRows] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: stu } = await supabase.from("students").select("class_id").eq("user_id", user.id).maybeSingle();
      if (stu?.class_id) {
        const { data: cb } = await supabase.from("battles").select("id").eq("class_id", stu.class_id);
        const ids = (cb ?? []).map((r: any) => r.id);
        if (ids.length) {
          const { data: parts } = await supabase.from("battle_participants").select("user_id, display_name, score").in("battle_id", ids);
          const agg: Record<string, { name: string; score: number }> = {};
          (parts ?? []).forEach((p: any) => {
            if (!agg[p.user_id]) agg[p.user_id] = { name: p.display_name || "Student", score: 0 };
            agg[p.user_id].score += p.score;
          });
          setClassRows(Object.entries(agg).map(([uid, v]) => ({ uid, ...v })).sort((a, b) => b.score - a.score));
        }
      }
      const { data: x } = await supabase.from("student_xp").select("user_id, xp, level, wins").order("xp", { ascending: false }).limit(50);
      setGlobalRows(x ?? []);
    })();
  }, [user]);

  return (
    <div className="space-y-5 animate-rise">
      <Card className="p-5 bg-gradient-arena text-white border-0">
        <div className="text-xs uppercase tracking-widest opacity-80 font-semibold flex items-center gap-2"><Trophy className="w-3.5 h-3.5" /> Leaderboard</div>
        <h1 className="text-2xl font-black mt-1">Top Champions</h1>
      </Card>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="class">My Class</TabsTrigger>
          <TabsTrigger value="global">Global XP</TabsTrigger>
        </TabsList>
        <TabsContent value="class" className="space-y-2 mt-3">
          {classRows.length === 0 ? <p className="text-center py-8 text-muted-foreground text-sm">No battles in your class yet.</p>
            : classRows.map((p, i) => <PodiumRow key={p.uid} rank={i + 1} name={p.name} score={p.score} isMe={p.uid === user?.id} />)}
        </TabsContent>
        <TabsContent value="global" className="space-y-2 mt-3">
          {globalRows.map((p, i) => <PodiumRow key={p.user_id} rank={i + 1} name={`Lvl ${p.level} · ${p.wins} wins`} score={p.xp} isMe={p.user_id === user?.id} />)}
        </TabsContent>
      </Tabs>
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
      <Route path="leaderboard" element={<LeaderboardPage />} />
    </Routes>
  );
}
