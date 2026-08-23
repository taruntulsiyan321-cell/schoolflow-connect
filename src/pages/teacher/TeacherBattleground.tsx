import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import {
  AttendanceService,
  BattleExperienceService,
  useAcademicLive,
} from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BattleCard } from "@/components/battleground/bg-bits";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Sword, Radio, Zap, Loader2, Target, Users, Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import "./teacher-premium.css";
import { toErrorMessage } from "@/lib/presentation";

type ClassOption = { id: string; label: string };

type QuestionDraft = {
  question: string;
  options: string[];
  correct_index: number;
};

export default function TeacherBattleground() {
  const nav = useNavigate();
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["battle", "profile"]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [battles, setBattles] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Class Quiz Battle");
  const [subject, setSubject] = useState("Mathematics");
  const [topic, setTopic] = useState("");
  const [perQ, setPerQ] = useState(20);
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    { question: "", options: ["", "", "", ""], correct_index: 0 },
  ]);
  const [quickDifficulty, setQuickDifficulty] = useState("medium");
  const [quickBusy, setQuickBusy] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      try {
        const assigned = await AttendanceService.listAssignedClasses(ctx);
        if (cancelled) return;
        const options: ClassOption[] = assigned.map((c) => ({
          id: c.id,
          label: `${c.name}-${c.section}${c.isClassTeacher ? " (class teacher)" : ""}`,
        }));
        setClasses(options);
        setClassId((prev) =>
          prev && options.some((o) => o.id === prev) ? prev : options[0]?.id ?? "",
        );
        const classIds = options.map((o) => o.id);
        const list = classIds.length
          ? await BattleExperienceService.listCreatedByTeacher(ctx, {
              classIds,
              limit: 12,
            })
          : [];
        if (!cancelled) setBattles(list);
      } catch (e) {
        if (!cancelled) {
          setClasses([]);
          setBattles([]);
          toast({
            title: toErrorMessage(e, "Could not load battleground"),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          loadedRef.current = true;
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  const updateQ = (i: number, patch: Partial<QuestionDraft>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const updateOpt = (i: number, oi: number, v: string) =>
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx === i ? { ...q, options: q.options.map((o, j) => (j === oi ? v : o)) } : q,
      ),
    );
  const addQ = () => setQuestions((qs) => [...qs, { question: "", options: ["", "", "", ""], correct_index: 0 }]);
  const removeQ = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));

  const quickHost = async () => {
    if (!ctx || !ready || !classId) {
      toast({ title: "Select a class first", variant: "destructive" });
      return;
    }
    setQuickBusy(true);
    try {
      const created = await BattleExperienceService.createFromDesign(ctx, {
        type: "class",
        subject,
        topic: topic.trim() || undefined,
        difficulty: quickDifficulty,
        questions: 5,
        timeLimitMin: Math.max(1, Math.round((perQ * 5) / 60)),
        perQuestionSec: perQ,
        classId,
      });
      toast({ title: "Live battle published from question bank" });
      nav(`/teacher/battleground/monitor/${created.id}`);
    } catch (e) {
      toast({
        title: toErrorMessage(e, "Could not publish battle"),
        variant: "destructive",
      });
    } finally {
      setQuickBusy(false);
    }
  };

  const create = async () => {
    if (!ctx || !ready || !classId) {
      toast({ title: "Select a class first", variant: "destructive" });
      return;
    }
    setQuickBusy(true);
    try {
      const created = await BattleExperienceService.createTeacherCustom(ctx, {
        title,
        subject,
        topic: topic.trim() || null,
        classId,
        perQuestionSec: perQ,
        questions: questions.map((q) => ({
          question: q.question,
          options: q.options,
          correctIndex: q.correct_index,
        })),
      });
      toast({ title: "Battle published â€” monitoring live" });
      nav(`/teacher/battleground/monitor/${created.id}`);
    } catch (e) {
      toast({
        title: toErrorMessage(e, "Could not publish battle"),
        variant: "destructive",
      });
    } finally {
      setQuickBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="teacher-premium tp-shell flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading battlegroundâ€¦
      </div>
    );
  }

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="tp-kicker mb-4">Battleground Management</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Turn confusion into live competition.</h1>
            <p className="text-sm text-foreground/75 mt-2 max-w-2xl">Create class battles, monitor question-wise accuracy, identify struggling students live, and reteach immediately after the match.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{classes.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Classes</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{battles.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Battles</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{perQ}s</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Per Q</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ArenaMetric icon={<Users className="w-5 h-5" />} label="Target Class" value={classes.find((c) => c.id === classId)?.label || "Select"} sub="participants" />
        <ArenaMetric icon={<Target className="w-5 h-5" />} label="Difficulty" value={quickDifficulty} sub="question bank mode" />
        <ArenaMetric icon={<Clock className="w-5 h-5" />} label="Duration" value={`${Math.round((perQ * 5) / 60)}m`} sub="quick battle window" />
        <ArenaMetric icon={<Activity className="w-5 h-5" />} label="Live Monitor" value="Ready" sub="accuracy + leaderboard" />
      </div>

      {classes.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Assign yourself to a class (class teacher or subject teacher) to host battles.
        </Card>
      ) : (
        <>
          <Card className="tp-card p-4 space-y-3">
            <Label>Target class</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger>
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          <Card className="tp-card tp-gold-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-warning" />
              <div>
                <div className="font-bold">Instant class battle</div>
                <p className="text-xs text-muted-foreground">Auto-pick questions from the bank â€” no manual entry.</p>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <Label>Subject</Label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Mathematics", "Science", "Physics", "Chemistry", "Biology", "English", "General Knowledge"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Difficulty</Label>
                <Select value={quickDifficulty} onValueChange={setQuickDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["easy", "medium", "hard"].map((d) => (
                      <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Seconds / Q</Label>
                <Input type="number" min={5} max={120} value={perQ} onChange={(e) => setPerQ(Number(e.target.value))} />
              </div>
            </div>
            <Button onClick={quickHost} disabled={quickBusy} className="w-full btn-cta">
              {quickBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              Publish live battle
            </Button>
          </Card>

          <Card className="tp-card p-5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Sword className="w-3.5 h-3.5" /> Custom battle (optional)
            </div>
            <h2 className="text-lg font-semibold mt-1">Write your own questions</h2>
            <p className="text-sm text-muted-foreground">Use only when you need fully custom items.</p>
          </Card>

          <Card className="tp-card p-5 space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label>Subject</Label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Mathematics", "Science", "Physics", "Chemistry", "Biology", "English", "General Knowledge"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Topic (optional)</Label>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
              </div>
              <div>
                <Label>Seconds per question</Label>
                <Input type="number" min={5} max={120} value={perQ} onChange={(e) => setPerQ(Number(e.target.value))} />
              </div>
            </div>
          </Card>

          <div className="space-y-3">
            {questions.map((q, i) => (
              <Card key={i} className="tp-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm">Question {i + 1}</div>
                  {questions.length > 1 && (
                    <button type="button" onClick={() => removeQ(i)} className="text-xs text-destructive">
                      Remove
                    </button>
                  )}
                </div>
                <Textarea value={q.question} onChange={(e) => updateQ(i, { question: e.target.value })} placeholder="Enter question" />
                <div className="grid md:grid-cols-2 gap-2">
                  {q.options.map((opt, oi) => (
                    <label
                      key={oi}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border cursor-pointer",
                        q.correct_index === oi ? "border-accent bg-accent/10" : "border-border",
                      )}
                    >
                      <input
                        type="radio"
                        name={`teacher-c-${i}`}
                        checked={q.correct_index === oi}
                        onChange={() => updateQ(i, { correct_index: oi })}
                      />
                      <Input
                        value={opt}
                        onChange={(e) => updateOpt(i, oi, e.target.value)}
                        placeholder={`Option ${oi + 1}`}
                        className="border-0 focus-visible:ring-0 h-8 px-1"
                      />
                    </label>
                  ))}
                </div>
              </Card>
            ))}
            <Button variant="outline" onClick={addQ} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Add question
            </Button>
          </div>

          <Button onClick={create} size="lg" className="w-full btn-cta" disabled={quickBusy}>
            {quickBusy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Sword className="w-5 h-5 mr-2" />}
            Publish battle
          </Button>

          {battles.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-1.5"><Radio className="w-4 h-4 text-primary" /> Your battles â€” tap to monitor live</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {battles.map((b) => (
                  <BattleCard
                    key={String(b.id)}
                    battle={b}
                    onJoin={() => nav(`/teacher/battleground/monitor/${b.id}`)}
                  />
                ))}
              </div>
          <p className="text-xs text-muted-foreground mt-2">
            Students join from their Battleground. Open any battle to watch live scores, accuracy and who's struggling.
          </p>
            </div>
          )}
        </>
      )}

      <button type="button" onClick={() => nav(-1)} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
    </div>
  );
}

function ArenaMetric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold mt-2 truncate capitalize">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}
