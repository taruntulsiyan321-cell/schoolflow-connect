import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Sword, Zap, Sparkles, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isEmptyQuestionBankError, NO_BANK_MSG } from "@/lib/battleTemplateSolo";
import { subjectsForStreamPicker, type AcademicStream } from "@/lib/curriculumScope";
import { getNcertSubjects } from "@/lib/ncertSyllabus";
import { BattleExperienceService, PracticeService, useAcademicContext } from "@/academic";
import { displaySubject } from "@/lib/academicDisplay";

const DIFFICULTIES = ["easy", "medium", "hard"];
const FALLBACK = ["Mathematics", "English"];

export function QuickPlay({ defaultClassId }: { defaultClassId?: string | null }) {
  const nav = useNavigate();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const subjects = useMemo(
    () => subjectsForStreamPicker(stream, classLevel, getNcertSubjects(classLevel) || FALLBACK),
    [stream, classLevel],
  );
  const [subject, setSubject] = useState(subjects[0] ?? "Mathematics");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [perQ, setPerQ] = useState(20);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx || !academicReady) return;
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
  }, [ctx, academicReady]);

  useEffect(() => {
    if (subjects.length && !subjects.includes(subject)) setSubject(subjects[0]);
  }, [subjects, subject]);

  const launch = async () => {
    if (!ctx || !academicReady) {
      toast({ title: "Academic context not ready — try again", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { id } = await BattleExperienceService.createQuickBattle(ctx, {
        subject,
        difficulty,
        questions: count,
        perQuestionSec: perQ,
        classId: defaultClassId ?? null,
      });
      toast({ title: "Quick battle ready!" });
      nav(`/student/battleground/battle/${id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not start battle";
      toast({
        title: isEmptyQuestionBankError(msg) ? NO_BANK_MSG : msg,
        description: isEmptyQuestionBankError(msg)
          ? "Ask a teacher to add questions, or try another subject."
          : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 surface-card">
      <div className="flex items-start gap-3">
        <div className="icon-tile shrink-0">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold flex items-center gap-2">Quick Play <Sparkles className="w-3.5 h-3.5 text-warning" /></div>
          <div className="text-xs text-muted-foreground">Random questions from the bank — instant battle.</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{subjects.map(s => <SelectItem key={s} value={s}>{displaySubject(s)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DIFFICULTIES.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Questions</Label>
          <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[5,8,10,15,20].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Seconds / Q</Label>
          <Select value={String(perQ)} onValueChange={(v) => setPerQ(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[10,15,20,30,45].map(n => <SelectItem key={n} value={String(n)}>{n}s</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <Button className="w-full" onClick={launch} disabled={loading || subjects.length === 0}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sword className="w-4 h-4 mr-2" />}
        Start quick battle
      </Button>
    </Card>
  );
}
