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
import { Swords, Zap, Search, Loader2, User, Users, Sparkles } from "lucide-react";
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
  /** Full-page layout (create route) vs compact card on arena home */
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
        toast({ title: "Battle ready — good luck!" });
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
        toast({
          title: `Challenge sent to ${opponent!.full_name.split(" ")[0]}!`,
          description: "Your battle is live — jump in now.",
        });
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
        <div className="w-10 h-10 rounded-xl bg-gradient-battle text-white flex items-center justify-center shrink-0">
          <Swords className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold flex items-center gap-2">
            {variant === "page" ? "Start a battle" : "Challenge"}
            <Sparkles className="w-3.5 h-3.5 text-warning" />
          </div>
          <div className="text-xs text-muted-foreground">
            Pick subject & topic — questions auto-load from the bank. No manual setup.
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted/50">
        <button
          type="button"
          onClick={() => setMode("duel")}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all",
            mode === "duel" ? "bg-card shadow-card text-foreground" : "text-muted-foreground",
          )}
        >
          <Users className="w-4 h-4" /> Challenge friend
        </button>
        <button
          type="button"
          onClick={() => { setMode("solo"); setOpponent(null); }}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all",
            mode === "solo" ? "bg-card shadow-card text-foreground" : "text-muted-foreground",
          )}
        >
          <User className="w-4 h-4" /> Solo battle
        </button>
      </div>

      {/* Curriculum picks */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
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
          <Label className="text-xs">Chapter</Label>
          <Select value={chapter} onValueChange={(v) => { setChapter(v); setTopic(ANY); }}>
            <SelectTrigger><SelectValue placeholder="Any chapter" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any chapter</SelectItem>
              {chapters.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Topic</Label>
          <Select value={topic} onValueChange={setTopic} disabled={chapter === ANY}>
            <SelectTrigger><SelectValue placeholder="Any topic" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any topic</SelectItem>
              {topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Classmate picker (duel only) */}
      {mode === "duel" && (
        <div className="space-y-2">
          <Label className="text-xs">Classmate</Label>
          {!classId ? (
            <p className="text-xs text-muted-foreground py-2">Join a class to challenge friends.</p>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search classmates…" className="pl-9 h-9" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border p-1">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpponent(c)}
                    className={cn(
                      "w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all",
                      opponent?.id === c.id ? "bg-primary/10 border-2 border-primary" : "hover:bg-muted/50 border-2 border-transparent",
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                      {c.full_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-1">
                        {c.full_name}
                        {c.equipped_badge && <EquippedBadge code={c.equipped_badge} size="xs" />}
                      </div>
                    </div>
                    {opponent?.id === c.id && <Zap className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Button
        onClick={start}
        disabled={loading || (mode === "duel" && !opponent)}
        size="lg"
        className="w-full bg-gradient-victory text-white font-bold shadow-glow"
      >
        {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Swords className="w-5 h-5 mr-2" />}
        Start battle
      </Button>
    </>
  );

  if (variant === "page") {
    return <div className="space-y-4 animate-rise max-w-xl mx-auto">{inner}</div>;
  }

  return (
    <Card className="p-5 space-y-4 border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5">
      {inner}
    </Card>
  );
}
