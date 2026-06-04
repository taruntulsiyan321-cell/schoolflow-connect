import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Swords, Search, Loader2, User, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";

const SUBJECTS = [
  "Mathematics", "Science", "Physics", "Chemistry", "Biology", "English",
  "Social Studies", "General Knowledge", "Computer Science", "Economics", "Accountancy", "Business Studies",
];
const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const ANY = "__any__";

type Classmate = { id: string; full_name: string; user_id: string; roll_number: string | null; equipped_badge: string | null };
type CurriculumRow = { chapter: string; topic: string | null };

type Props = {
  classId?: string | null;
  variant?: "page" | "card";
};

export function FrictionlessChallenge({ classId, variant = "card" }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"duel" | "solo">("duel");
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [filter, setFilter] = useState("");
  const [opponent, setOpponent] = useState<Classmate | null>(null);
  const [subject, setSubject] = useState("Mathematics");
  const [chapter, setChapter] = useState(ANY);
  const [topic, setTopic] = useState(ANY);
  const [difficulty, setDifficulty] = useState<string>("medium");
  const [curriculum, setCurriculum] = useState<CurriculumRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!classId) return;
    supabase.rpc("rpc_classmates").then(({ data }) => {
      setClassmates((data ?? []).map((m) => ({
        id: m.student_id,
        full_name: m.full_name,
        user_id: m.user_id,
        roll_number: m.roll_number,
        equipped_badge: m.equipped_badge,
      })));
    });
  }, [classId]);

  useEffect(() => {
    supabase.rpc("rpc_battle_curriculum", { _subject: subject }).then(({ data }) => {
      const rows = data as CurriculumRow[] | null;
      setCurriculum(Array.isArray(rows) ? rows : []);
      setChapter(ANY);
      setTopic(ANY);
    });
  }, [subject]);

  const chapters = useMemo(() => {
    const set = new Set<string>();
    curriculum.forEach((r) => { if (r.chapter) set.add(r.chapter); });
    return Array.from(set).sort();
  }, [curriculum]);

  const topics = useMemo(() => {
    if (chapter === ANY) return [];
    const set = new Set<string>();
    curriculum.forEach((r) => {
      if (r.chapter === chapter && r.topic) set.add(r.topic);
    });
    return Array.from(set).sort();
  }, [curriculum, chapter]);

  const filtered = classmates.filter((c) =>
    c.full_name?.toLowerCase().includes(filter.toLowerCase()),
  );

  const start = async () => {
    if (mode === "duel" && !opponent) {
      toast({ title: "Pick a classmate to challenge", variant: "destructive" });
      return;
    }
    setLoading(true);
    const chap = chapter === ANY ? undefined : chapter;
    const top = topic === ANY ? undefined : topic;

    try {
      if (mode === "solo") {
        const { data, error } = await supabase.rpc("rpc_create_quick_battle", {
          _subject: subject,
          _difficulty: difficulty,
          _count: 5,
          _per_q: 20,
          _chapter: chap,
          _topic: top,
          _class_id: classId ?? undefined,
        });
        if (error) throw error;
        toast({ title: "Battle ready" });
        nav(`/student/battleground/battle/${data}`);
      } else {
        const { data, error } = await supabase.rpc("rpc_challenge_student", {
          _opponent_user_id: opponent!.user_id,
          _subject: subject,
          _difficulty: difficulty,
          _count: 5,
          _per_q: 20,
          _chapter: chap,
          _topic: top,
        });
        if (error) throw error;
        toast({ title: `Challenge sent to ${opponent!.full_name.split(" ")[0]}` });
        nav(`/student/battleground/battle/${data}`);
      }
    } catch (e: any) {
      toast({ title: e?.message ?? "Could not start battle", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div className="icon-tile">
          <Swords className="w-5 h-5" />
        </div>
        <div>
          <div className="font-semibold text-sm">{variant === "page" ? "Start a battle" : "Quick challenge"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Questions are selected automatically from the bank.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted/50 border border-border/60">
        <button
          type="button"
          onClick={() => setMode("duel")}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors",
            mode === "duel" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
          )}
        >
          <Users className="w-4 h-4" /> Classmate
        </button>
        <button
          type="button"
          onClick={() => { setMode("solo"); setOpponent(null); }}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors",
            mode === "solo" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
          )}
        >
          <User className="w-4 h-4" /> Solo
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Chapter</Label>
          <Select value={chapter} onValueChange={(v) => { setChapter(v); setTopic(ANY); }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any chapter</SelectItem>
              {chapters.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Topic</Label>
          <Select value={topic} onValueChange={setTopic} disabled={chapter === ANY}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any topic</SelectItem>
              {topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === "duel" && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Opponent</Label>
          {!classId ? (
            <p className="text-xs text-muted-foreground py-2">Join a class to challenge friends.</p>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search classmates" className="pl-9 h-9" />
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1 rounded-lg border border-border/60 p-1">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpponent(c)}
                    className={cn(
                      "w-full flex items-center gap-3 p-2.5 rounded-md text-left transition-colors",
                      opponent?.id === c.id ? "bg-primary/8 border border-primary/30" : "hover:bg-muted/50 border border-transparent",
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-sm font-medium shrink-0">
                      {c.full_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0 text-sm font-medium truncate">{c.full_name}</div>
                    {c.equipped_badge && <EquippedBadge code={c.equipped_badge} size="xs" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Button onClick={start} disabled={loading || (mode === "duel" && !opponent)} size="lg" className="w-full btn-cta">
        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Swords className="w-4 h-4 mr-2" />}
        Start battle
      </Button>
    </>
  );

  if (variant === "page") {
    return <div className="space-y-4 animate-rise max-w-xl mx-auto">{inner}</div>;
  }

  return <Card className="p-5 space-y-4 surface-card">{inner}</Card>;
};
