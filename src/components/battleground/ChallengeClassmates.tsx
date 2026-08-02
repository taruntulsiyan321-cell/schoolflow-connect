import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Swords, Search, Loader2, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { isEmptyQuestionBankError, NO_BANK_MSG } from "@/lib/battleTemplateSolo";
import { subjectsForStreamPicker, type AcademicStream } from "@/lib/curriculumScope";
import { getNcertSubjects } from "@/lib/ncertSyllabus";
import { PracticeService, useAcademicContext } from "@/academic";

const DIFFICULTIES = ["easy", "medium", "hard"];
const FALLBACK = ["Mathematics", "English"];

type Classmate = { id: string; full_name: string; user_id: string; roll_number: string | null; equipped_badge: string | null };

/** Direct, one-tap academic challenge: auto-picks questions from the bank and invites a classmate. */
export function ChallengeClassmates({ classId }: { classId?: string | null }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [filter, setFilter] = useState("");
  const subjects = useMemo(
    () => subjectsForStreamPicker(stream, classLevel, getNcertSubjects(classLevel) || FALLBACK),
    [stream, classLevel],
  );
  const [subject, setSubject] = useState(subjects[0] ?? "Mathematics");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [perQ, setPerQ] = useState(20);
  const [challenging, setChallenging] = useState<string | null>(null);

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

  useEffect(() => {
    if (!classId) return;
    supabase.rpc("rpc_classmates").then(({ data }) => {
      const mates = (data ?? []).map((m: any) => ({
        id: m.student_id, full_name: m.full_name, user_id: m.user_id,
        roll_number: m.roll_number, equipped_badge: m.equipped_badge,
      })) as Classmate[];
      setClassmates(mates);
    });
  }, [classId, user]);

  const challenge = async (opponent: Classmate) => {
    setChallenging(opponent.user_id);
    const { data, error } = await supabase.rpc("rpc_challenge_student", {
      _opponent_user_id: opponent.user_id,
      _subject: subject,
      _difficulty: difficulty,
      _count: count,
      _per_q: perQ,
      _chapter: undefined,
    });
    setChallenging(null);
    if (error) {
      const msg = error.message || "Could not send challenge";
      toast({
        title: isEmptyQuestionBankError(msg) ? NO_BANK_MSG : msg,
        description: isEmptyQuestionBankError(msg)
          ? "Ask a teacher to add questions, or try another subject."
          : undefined,
        variant: "destructive",
      });
      return;
    }
    toast({ title: `Challenge sent to ${opponent.full_name.split(" ")[0]}!`, description: "Jump in — your battle is live." });
    nav(`/student/battleground/battle/${data}`);
  };

  const filtered = classmates.filter((c) => c.full_name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card className="p-5 space-y-4 surface-card">
      <div className="flex items-start gap-3">
        <div className="icon-tile shrink-0">
          <Swords className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold flex items-center gap-2">Challenge a classmate <Zap className="w-3.5 h-3.5 text-warning" /></div>
          <div className="text-xs text-muted-foreground">One tap — questions are auto-picked and they get invited instantly.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Questions</Label>
          <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[5, 8, 10, 15].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Seconds / Q</Label>
          <Select value={String(perQ)} onValueChange={(v) => setPerQ(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[10, 15, 20, 30, 45].map((n) => <SelectItem key={n} value={String(n)}>{n}s</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Find a classmate…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center">No classmates found.</div>
        )}
        {filtered.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border bg-card/40">
            <div className="flex items-center gap-2 min-w-0">
              <EquippedBadge code={c.equipped_badge} size="sm" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{c.full_name}</div>
                {c.roll_number && <div className="text-[11px] text-muted-foreground">Roll {c.roll_number}</div>}
              </div>
            </div>
            <Button size="sm" disabled={!!challenging} onClick={() => challenge(c)}>
              {challenging === c.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Challenge"}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
