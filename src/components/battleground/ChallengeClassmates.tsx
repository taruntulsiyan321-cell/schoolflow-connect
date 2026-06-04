import { useEffect, useState } from "react";
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
import { fetchEquippedBadgesByUserIds } from "@/hooks/useStudentBadges";

const SUBJECTS = ["Mathematics", "Science", "Physics", "Chemistry", "Biology", "English", "Social Studies", "General Knowledge", "Computer Science", "Economics", "Accountancy", "Business Studies"];
const DIFFICULTIES = ["easy", "medium", "hard"];

type Classmate = { id: string; full_name: string; user_id: string; roll_number: string | null };

/** Direct, one-tap academic challenge: auto-picks questions from the bank and invites a classmate. */
export function ChallengeClassmates({ classId }: { classId?: string | null }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, string | null>>({});
  const [filter, setFilter] = useState("");
  const [subject, setSubject] = useState("Mathematics");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [perQ, setPerQ] = useState(20);
  const [challenging, setChallenging] = useState<string | null>(null);

  useEffect(() => {
    if (!classId) return;
    supabase
      .from("students")
      .select("id, full_name, user_id, roll_number")
      .eq("class_id", classId)
      .then(async ({ data }) => {
        const mates = (data ?? []).filter((s: any) => s.user_id && s.user_id !== user?.id) as Classmate[];
        setClassmates(mates);
        setBadgeMap(await fetchEquippedBadgesByUserIds(mates.map((m) => m.user_id)));
      });
  }, [classId, user]);

  const challenge = async (opponent: Classmate) => {
    setChallenging(opponent.user_id);
    const { data, error } = await supabase.rpc("rpc_challenge_student" as any, {
      _opponent_user_id: opponent.user_id,
      _subject: subject,
      _difficulty: difficulty,
      _count: count,
      _per_q: perQ,
      _chapter: null,
    });
    setChallenging(null);
    if (error) {
      toast({ title: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Challenge sent to ${opponent.full_name.split(" ")[0]}!`, description: "Jump in — your battle is live." });
    nav(`/student/battleground/battle/${data}`);
  };

  const filtered = classmates.filter((c) => c.full_name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card className="p-5 space-y-4 border-2 border-destructive/20 bg-gradient-to-br from-card to-destructive/5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-battle text-white flex items-center justify-center shrink-0">
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
            <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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

      {classId ? (
        <>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search classmates…" className="pl-9 h-9" />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1.5 -mx-1 px-1">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No classmates with accounts yet.</p>
            )}
            {filtered.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:shadow-card transition-shadow">
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                  {c.full_name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{c.full_name}</span>
                    {badgeMap[c.user_id] && <EquippedBadge code={badgeMap[c.user_id]} size="xs" />}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Roll {c.roll_number || "-"}</div>
                </div>
                <Button
                  size="sm"
                  className="bg-gradient-battle text-white shrink-0"
                  disabled={challenging !== null}
                  onClick={() => challenge(c)}
                >
                  {challenging === c.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Swords className="w-3.5 h-3.5 mr-1" /> Challenge</>}
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-3">Join a class to challenge classmates.</p>
      )}
    </Card>
  );
}
