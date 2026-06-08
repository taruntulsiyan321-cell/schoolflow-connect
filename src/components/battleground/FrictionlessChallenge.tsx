import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  filterCurriculumByNcert,
  getNcertSubjects,
  parseClassGrade,
} from "@/lib/ncertSyllabus";
import {
  canUseMath12TemplateSolo,
  createMath12TemplateSoloBattle,
  isEmptyQuestionBankError,
  NO_BANK_MSG,
} from "@/lib/battleTemplateSolo";
import { Globe, Loader2, Search, User, Users, UsersRound, Calculator } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const ANY = "__any__";

type BattleMode = "solo" | "duel" | "class" | "open";

type Classmate = {
  id: string;
  full_name: string;
  user_id: string;
  roll_number: string | null;
  equipped_badge: string | null;
};
type CurriculumRow = { chapter: string; topic: string | null };

type Props = {
  classId?: string | null;
  className?: string | null;
  variant?: "page" | "card";
};

const MODE_META: Record<BattleMode, { label: string; icon: typeof User; hint: string }> = {
  solo: { label: "Solo", icon: User, hint: "Private practice — not listed publicly" },
  duel: { label: "Challenge", icon: Users, hint: "1v1 with a classmate" },
  class: { label: "Class lobby", icon: UsersRound, hint: "Your class can join this battle" },
  open: { label: "Open", icon: Globe, hint: "Anyone in school can join" },
};

export function FrictionlessChallenge({ classId, className, variant = "card" }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const grade = useMemo(() => parseClassGrade(className), [className]);
  const subjects = useMemo(() => getNcertSubjects(grade), [grade]);

  const [mode, setMode] = useState<BattleMode>("solo");
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [filter, setFilter] = useState("");
  const [opponent, setOpponent] = useState<Classmate | null>(null);
  const [subject, setSubject] = useState(subjects[0] ?? "Mathematics");
  const [chapter, setChapter] = useState(ANY);
  const [topic, setTopic] = useState(ANY);
  const [difficulty, setDifficulty] = useState<string>("medium");
  const [bankRows, setBankRows] = useState<CurriculumRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bankEmptyHint, setBankEmptyHint] = useState(false);
  const math12Solo = canUseMath12TemplateSolo(subject, grade);

  useEffect(() => {
    if (subjects.length && !subjects.includes(subject)) setSubject(subjects[0]);
  }, [subjects, subject]);

  useEffect(() => {
    if (!classId) return;
    supabase.rpc("rpc_classmates").then(({ data, error }) => {
      if (error) return;
      setClassmates(
        (data ?? []).map((m) => ({
          id: m.student_id,
          full_name: m.full_name,
          user_id: m.user_id,
          roll_number: m.roll_number,
          equipped_badge: m.equipped_badge,
        })),
      );
    });
  }, [classId]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("rpc_battle_curriculum", {
        _subject: subject,
        _class_id: classId ?? null,
      });

      if (error) {
        setBankRows([]);
        setBankEmptyHint(true);
        return;
      }

      let rows = (Array.isArray(data) ? data : []) as CurriculumRow[];

      if (rows.length === 0 && canUseMath12TemplateSolo(subject, grade)) {
        const { data: tpl } = await supabase
          .from("question_templates")
          .select("chapter")
          .eq("class", 12)
          .eq("subject", "Mathematics")
          .eq("is_active", true);
        const chapters = [...new Set((tpl ?? []).map((r) => r.chapter).filter(Boolean))].sort();
        rows = chapters.map((c) => ({ chapter: c, topic: null }));
      }

      setBankRows(rows);
      setBankEmptyHint(rows.length === 0);
      setChapter(ANY);
      setTopic(ANY);
    })();
  }, [subject, classId, grade]);

  const curriculum = useMemo(
    () => filterCurriculumByNcert(grade, subject, bankRows),
    [grade, subject, bankRows],
  );

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
    if ((mode === "class" || mode === "open") && !classId && mode === "class") {
      toast({ title: "Join a class to host a class lobby", variant: "destructive" });
      return;
    }
    setLoading(true);
    setBankEmptyHint(false);
    const chap = chapter === ANY ? undefined : chapter;
    const top = topic === ANY ? undefined : topic;
    const base = {
      _subject: subject,
      _difficulty: difficulty,
      _count: 5,
      _per_q: 20,
      _chapter: chap,
      _topic: top,
      _class_id: classId ?? undefined,
    };

    try {
      let battleId: string | null = null;
      let error: { message: string } | null = null;

      if (mode === "solo" && math12Solo) {
        const result = await createMath12TemplateSoloBattle({
          chapter: chap,
          difficulty,
          count: 5,
          perQ: 20,
          classId,
        });
        if ("redirectTo" in result) {
          toast({ title: "Starting Class 12 Math practice session" });
          nav(result.redirectTo);
          return;
        }
        battleId = result.battleId;
      } else if (mode === "solo") {
        const res = await supabase.rpc("rpc_create_quick_battle", base);
        battleId = res.data as string;
        error = res.error;
        if (error && isEmptyQuestionBankError(error.message)) {
          setBankEmptyHint(true);
        }
      } else if (mode === "duel") {
        const res = await supabase.rpc("rpc_challenge_student", {
          _opponent_user_id: opponent!.user_id,
          _subject: subject,
          _difficulty: difficulty,
          _count: 5,
          _per_q: 20,
          _chapter: chap,
          _topic: top,
        });
        battleId = res.data as string;
        error = res.error;
      } else if (mode === "class") {
        const res = await supabase.rpc("rpc_create_class_battle" as never, base as never);
        battleId = res.data as string;
        error = res.error;
      } else {
        const res = await supabase.rpc("rpc_create_open_battle" as never, base as never);
        battleId = res.data as string;
        error = res.error;
      }

      if (error) throw error;
      const labels: Record<BattleMode, string> = {
        solo: "Solo practice ready",
        duel: `Challenge sent to ${opponent!.full_name.split(" ")[0]}`,
        class: "Class lobby is live — classmates can join",
        open: "Open battle is live — anyone can join",
      };
      toast({ title: labels[mode] });
      nav(`/student/battleground/battle/${battleId}`);
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "Could not start battle";
      if (isEmptyQuestionBankError(msg)) setBankEmptyHint(true);
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div className="icon-tile">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <div className="font-semibold text-sm">{variant === "page" ? "Start a battle" : "Battleground"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {grade ? `Class ${grade} · NCERT chapters only` : "Pick subject and chapter from your syllabus"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 rounded-lg bg-muted/50 border border-border/60">
        {(Object.keys(MODE_META) as BattleMode[]).map((m) => {
          const Meta = MODE_META[m];
          const Icon = Meta.icon;
          return (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); if (m !== "duel") setOpponent(null); }}
              className={cn(
                "flex flex-col items-center gap-1 py-2 px-1 rounded-md text-xs font-medium transition-colors",
                mode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="w-4 h-4" />
              {Meta.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">{MODE_META[mode].hint}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
          <Label className="text-xs text-muted-foreground">Chapter (NCERT)</Label>
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

      {bankEmptyHint && (
        <Card className="p-4 border-warning/30 bg-warning/5 space-y-2">
          <p className="text-sm text-muted-foreground">
            {NO_BANK_MSG}. The question bank for this subject is empty — use Class 12 Math practice or ask your teacher to publish questions.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" asChild variant="default">
              <Link to="/student/practice/math12"><Calculator className="w-4 h-4 mr-1" /> Class 12 Math practice</Link>
            </Button>
            <Button size="sm" asChild variant="outline"><Link to="/student/dpp">Daily practice (DPP)</Link></Button>
          </div>
        </Card>
      )}

      {math12Solo && mode === "solo" && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Solo Math uses the Class 12 template engine — unlimited fresh NCERT questions.
        </p>
      )}

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

      <Button
        onClick={start}
        disabled={loading || (mode === "duel" && !opponent) || (mode === "class" && !classId)}
        size="lg"
        className="w-full btn-cta"
      >
        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
        {mode === "solo" ? "Start solo practice" : mode === "duel" ? "Send challenge" : "Host battle"}
      </Button>
    </>
  );

  if (variant === "page") {
    return <div className="space-y-4 animate-rise max-w-xl mx-auto">{inner}</div>;
  }

  return <Card className="p-5 space-y-4 surface-card">{inner}</Card>;
}
