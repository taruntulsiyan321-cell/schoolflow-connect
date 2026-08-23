import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Trophy, Medal, Award, ClipboardCheck, NotebookPen, Sword, Flame, Target,
  Zap, Crown, Star, CalendarDays, CalendarRange, Building2, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { subjectsForStreamPicker, type AcademicStream } from "@/lib/curriculumScope";
import { getNcertSubjects } from "@/lib/ncertSyllabus";
import { PracticeService, ProgressionService, useAcademicContext } from "@/academic";
import { toast } from "sonner";
import { toErrorMessage } from "@/lib/presentation";

type Scope = "class" | "school";
type Category =
  | "marks" | "attendance" | "homework" | "dpp"
  | "xp" | "wins" | "streak" | "weekly" | "monthly" | "subject";

type RankRow = {
  key: string;
  userId: string | null;
  full_name: string;
  roll_number: string | null;
  classLabel?: string | null;
  score: number;
  label: string;
};

const FALLBACK_SUBJECTS = ["Mathematics", "English"];

const CATS: { key: Category; label: string; icon: React.ReactNode; mode: "progression" | "rpc"; classOnly?: boolean }[] = [
  { key: "xp", label: "XP", icon: <Zap className="w-3.5 h-3.5" />, mode: "progression" },
  { key: "wins", label: "Wins", icon: <Sword className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "streak", label: "Streak", icon: <Flame className="w-3.5 h-3.5" />, mode: "progression" },
  { key: "weekly", label: "This Week", icon: <CalendarDays className="w-3.5 h-3.5" />, mode: "progression" },
  { key: "monthly", label: "This Month", icon: <CalendarRange className="w-3.5 h-3.5" />, mode: "progression" },
  { key: "subject", label: "By Subject", icon: <Star className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "marks", label: "Marks", icon: <Trophy className="w-3.5 h-3.5" />, mode: "rpc", classOnly: true },
  { key: "attendance", label: "Attendance", icon: <ClipboardCheck className="w-3.5 h-3.5" />, mode: "rpc", classOnly: true },
  { key: "homework", label: "Homework", icon: <NotebookPen className="w-3.5 h-3.5" />, mode: "rpc", classOnly: true },
  { key: "dpp", label: "DPP", icon: <Target className="w-3.5 h-3.5" />, mode: "rpc", classOnly: true },
];

type Props = { embedded?: boolean };

export function LeaderboardPanel({ embedded = false }: Props) {
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [scope, setScope] = useState<Scope>("class");
  const [category, setCategory] = useState<Category>("xp");
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const subjects = useMemo(
    () => subjectsForStreamPicker(stream, classLevel, getNcertSubjects(classLevel) || FALLBACK_SUBJECTS),
    [stream, classLevel],
  );
  const [subject, setSubject] = useState(subjects[0] ?? "Mathematics");
  const [classLabel, setClassLabel] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [rows, setRows] = useState<RankRow[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ctx || !academicReady) return;
    let cancelled = false;
    (async () => {
      try {
        const cur = await PracticeService.resolveCurriculumScope(ctx);
        if (cancelled) return;
        setStream(cur.stream);
        setClassLevel(cur.classLevel);
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
    if (!user) return;
    supabase.from("students").select("class_id, classes(name,section)").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        setClassId(data?.class_id ?? null);
        setClassLabel(data?.classes ? `Class ${data.classes.name}-${data.classes.section}` : "");
      });
  }, [user]);

  const visibleCats = useMemo(
    () => CATS.filter((c) => (scope === "school" ? !c.classOnly : true)),
    [scope],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const meta = CATS.find((c) => c.key === category)!;

    (async () => {
      setLoading(true);

      if (meta.mode === "progression" && ctx && academicReady) {
        try {
          const period =
            category === "weekly" ? "weekly" : category === "monthly" ? "monthly" : "lifetime";
          const metric = category === "streak" ? "streak" : "xp";
          const lb = await ProgressionService.leaderboard(ctx, {
            scope,
            period,
            metric,
            limit: 100,
          });
          if (cancelled) return;
          const ranked: RankRow[] = lb.rows.map((r) => ({
            key: r.user_id,
            userId: r.user_id,
            full_name: r.name,
            roll_number: null,
            classLabel: null,
            score: Number(r.value) || 0,
            label:
              metric === "streak"
                ? `${Number(r.value)} days`
                : `${Number(r.value)} XP`,
          }));
          const ids = ranked.map((r) => r.userId).filter(Boolean) as string[];
          let bm: Record<string, string | null> = {};
          if (ids.length) {
            try {
              const { XpService } = await import("@/academic");
              bm = await XpService.getEquippedByUserIds(ctx, ids);
            } catch {
              /* leave empty */
            }
          }
          setRows(ranked);
          setBadgeMap(bm);
          setLoading(false);
          return;
        } catch (e) {
          if (!cancelled) {
            setRows([]);
            toast.error(toErrorMessage(e, "Could not load progression leaderboard"));
            setLoading(false);
            return;
          }
        }
      }

      if (meta.mode === "rpc") {
        const { data, error } = await supabase.rpc("rpc_leaderboard", {
          _scope: scope,
          _category: category,
          _subject: category === "subject" ? subject : undefined,
          _limit: 100,
        });
        if (cancelled) return;
        if (error) { setRows([]); setLoading(false); return; }
        const ranked: RankRow[] = (data ?? []).map((r: any) => ({
          key: r.user_id,
          userId: r.user_id,
          full_name: r.full_name,
          roll_number: r.roll_number,
          classLabel: r.class_label,
          score: Number(r.score) || 0,
          label:
            category === "wins" ? `${Number(r.score)} wins`
            : category === "marks" || category === "attendance" || category === "homework" ? `${Number(r.score)}%`
            : category === "dpp" ? `${Number(r.score)}% avg`
            : category === "subject" ? `${Number(r.score)} pts`
            : `${Number(r.score)} pts`,
        }));
        const bm: Record<string, string | null> = {};
        (data ?? []).forEach((r: any) => { bm[r.user_id] = r.equipped_badge ?? null; });
        setRows(ranked);
        setBadgeMap(bm);
        setLoading(false);
        return;
      }

      setRows([]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, scope, category, subject, classId, ctx, academicReady]);

  const myRank = useMemo(() => {
    if (!user) return null;
    const i = rows.findIndex((r) => r.userId === user.id);
    return i >= 0 ? i + 1 : null;
  }, [rows, user]);

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className={embedded ? "space-y-4" : undefined}>
      {!embedded && (
        <p className="text-sm text-muted-foreground mb-4">Compete, climb, and claim the crown</p>
      )}

      <div className="flex gap-2 mb-4">
        {([
          { key: "class", label: classLabel || "My Class", icon: <Users className="w-4 h-4" /> },
          { key: "school", label: "Whole School", icon: <Building2 className="w-4 h-4" /> },
        ] as const).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setScope(s.key);
              const meta = CATS.find((c) => c.key === category);
              if (s.key === "school" && meta?.classOnly) setCategory("xp");
            }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all",
              scope === s.key ? "bg-primary text-primary-foreground border-primary shadow-elevated" : "bg-card border-border hover:border-primary/40",
            )}
          >
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      <div className="-mx-1 mb-3">
        <div className="flex gap-2 overflow-x-auto px-1 pb-2 [&::-webkit-scrollbar]:h-1.5">
          {visibleCats.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all",
                  active ? "bg-primary text-primary-foreground border-transparent" : "bg-card border-border hover:border-primary/40",
                )}
              >
                {c.icon}{c.label}
              </button>
            );
          })}
        </div>
      </div>

      {category === "subject" && (
        <div className="mb-3 max-w-xs">
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      {scope === "class" && !classId ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">You need a class assignment to view class leaderboards.</Card>
      ) : loading ? (
        <p className="text-center py-10 text-muted-foreground text-sm">Loading rankings…</p>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No data yet for this leaderboard. Play battles to get on the board!</Card>
      ) : (
        <>
          {myRank != null && (
            <Card className="p-3.5 mb-4 bg-primary/5 border-primary/20 flex items-center justify-between">
              <span className="text-sm">Your position: <span className="font-bold text-primary">#{myRank}</span> of {rows.length}</span>
              {myRank <= 3 && <span className="text-xs font-semibold text-warning flex items-center gap-1"><Crown className="w-3.5 h-3.5" /> On the podium!</span>}
            </Card>
          )}

          {podium.length === 3 && <Podium rows={podium} meUserId={user?.id} badgeMap={badgeMap} />}

          <div className="space-y-2 mt-3">
            {(podium.length === 3 ? rest : rows).map((r, i) => (
              <LeaderboardRow
                key={r.key}
                rank={(podium.length === 3 ? 4 : 1) + i}
                row={r}
                isMe={r.userId === user?.id}
                equippedBadge={r.userId ? badgeMap[r.userId] : null}
                showClass={scope === "school"}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Podium({ rows, meUserId, badgeMap }: { rows: RankRow[]; meUserId?: string; badgeMap: Record<string, string | null> }) {
  const order = [rows[1], rows[0], rows[2]];
  const heights = ["h-20", "h-28", "h-16"];
  const tone = ["", "", ""];
  const crownTone = ["text-tier-silver", "text-tier-gold", "text-tier-bronze"];
  const ranks = [2, 1, 3];
  return (
    <div className="grid grid-cols-3 gap-2 items-end mb-2">
      {order.map((r, i) => r && (
        <div key={r.key} className="text-center">
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className={cn("w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-semibold",
              ranks[i] === 1 && "ring-2 ring-primary/30 w-14 h-14")}>
              {r.full_name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="text-xs font-semibold truncate max-w-full px-1 flex items-center gap-1">
              <span className="truncate">{r.full_name?.split(" ")[0]}</span>
              {r.userId && badgeMap[r.userId] && <EquippedBadge code={badgeMap[r.userId]} size="xs" />}
            </div>
            <div className="text-[11px] text-muted-foreground">{r.label}</div>
          </div>
          <div className={cn("rounded-t-xl flex items-start justify-center pt-2", heights[i], tone[i], r.userId === meUserId && "ring-2 ring-primary")}>
            <Crown className={cn("w-5 h-5", crownTone[i])} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaderboardRow({ rank, row, isMe, equippedBadge, showClass }: {
  rank: number; row: RankRow; isMe?: boolean; equippedBadge?: string | null; showClass?: boolean;
}) {
  const Icon = rank === 1 ? Trophy : rank === 2 ? Medal : rank === 3 ? Award : null;
  const tone = rank === 1 ? "bg-warning/15 text-warning" : rank === 2 ? "bg-muted text-muted-foreground" : rank === 3 ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary";
  return (
    <Card className={cn("p-3.5 flex items-center gap-3 shadow-card transition-all hover:shadow-elevated", isMe && "ring-2 ring-primary")}>
      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0", tone)}>
        {Icon ? <Icon className="w-5 h-5" /> : rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{row.full_name}</span>
          {equippedBadge && <EquippedBadge code={equippedBadge} size="xs" />}
          {isMe && <span className="text-xs text-primary shrink-0">(you)</span>}
        </div>
        <div className="text-xs text-muted-foreground">{showClass ? (row.classLabel || "—") : `Roll ${row.roll_number || "—"}`}</div>
      </div>
      <div className="font-bold text-right shrink-0">{row.label}</div>
    </Card>
  );
}
