import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Trophy, Medal, Award, ClipboardCheck, NotebookPen, Sword, Flame, Target,
  Zap, Crown, Star, CalendarDays, CalendarRange, Building2, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { fetchEquippedBadgesByUserIds } from "@/hooks/useStudentBadges";

type Scope = "class" | "school";
type Category =
  | "marks" | "attendance" | "homework" | "dpp"   // academic (class scope, client-side)
  | "xp" | "wins" | "streak" | "weekly" | "monthly" | "subject"; // gamification (RPC)

type RankRow = {
  key: string;
  userId: string | null;
  full_name: string;
  roll_number: string | null;
  classLabel?: string | null;
  score: number;
  label: string;
};

const SUBJECTS = ["Mathematics", "Science", "Physics", "Chemistry", "Biology", "English", "Social Studies", "General Knowledge", "Computer Science", "Economics", "Accountancy", "Business Studies"];

const CATS: { key: Category; label: string; icon: React.ReactNode; mode: "rpc" | "client"; classOnly?: boolean }[] = [
  { key: "xp", label: "XP", icon: <Zap className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "wins", label: "Wins", icon: <Sword className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "streak", label: "Streak", icon: <Flame className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "weekly", label: "This Week", icon: <CalendarDays className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "monthly", label: "This Month", icon: <CalendarRange className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "subject", label: "By Subject", icon: <Star className="w-3.5 h-3.5" />, mode: "rpc" },
  { key: "marks", label: "Marks", icon: <Trophy className="w-3.5 h-3.5" />, mode: "client", classOnly: true },
  { key: "attendance", label: "Attendance", icon: <ClipboardCheck className="w-3.5 h-3.5" />, mode: "client", classOnly: true },
  { key: "homework", label: "Homework", icon: <NotebookPen className="w-3.5 h-3.5" />, mode: "client", classOnly: true },
  { key: "dpp", label: "DPP", icon: <Target className="w-3.5 h-3.5" />, mode: "client", classOnly: true },
];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>("class");
  const [category, setCategory] = useState<Category>("xp");
  const [subject, setSubject] = useState("Mathematics");
  const [classLabel, setClassLabel] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [rows, setRows] = useState<RankRow[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  // Resolve the student's class once.
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

      // ---- Gamification leaderboards via SECURITY DEFINER RPC ----
      if (meta.mode === "rpc") {
        const { data, error } = await supabase.rpc("rpc_leaderboard" as any, {
          _scope: scope,
          _category: category,
          _subject: category === "subject" ? subject : null,
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
            category === "xp" ? `${Number(r.score)} XP`
            : category === "streak" ? `${Number(r.score)} days`
            : category === "wins" ? `${Number(r.score)} wins`
            : `${Number(r.score)} pts`,
        }));
        const bm: Record<string, string | null> = {};
        (data ?? []).forEach((r: any) => { bm[r.user_id] = r.equipped_badge ?? null; });
        setRows(ranked);
        setBadgeMap(bm);
        setLoading(false);
        return;
      }

      // ---- Academic leaderboards (class scope, client-side) ----
      if (!classId) { setRows([]); setLoading(false); return; }
      const { data: classmates } = await supabase
        .from("students").select("id, full_name, roll_number, user_id").eq("class_id", classId);
      const students = classmates ?? [];
      const studentIds = students.map((s) => s.id);
      const userIds = students.map((s) => s.user_id).filter(Boolean) as string[];
      let ranked: RankRow[] = [];

      if (category === "marks") {
        const { data: exams } = await supabase.from("exams").select("id, max_marks").eq("class_id", classId);
        const examIds = exams?.map((e) => e.id) ?? [];
        const maxByExam: Record<string, number> = {};
        exams?.forEach((e) => { maxByExam[e.id] = Number(e.max_marks); });
        const { data: marks } = examIds.length
          ? await supabase.from("marks").select("student_id, exam_id, marks_obtained").in("exam_id", examIds)
          : { data: [] };
        const totals: Record<string, { total: number; max: number }> = {};
        marks?.forEach((m) => {
          if (!totals[m.student_id]) totals[m.student_id] = { total: 0, max: 0 };
          totals[m.student_id].total += Number(m.marks_obtained);
          totals[m.student_id].max += maxByExam[m.exam_id] ?? 0;
        });
        ranked = students.map((s) => {
          const t = totals[s.id] ?? { total: 0, max: 0 };
          const pct = t.max ? (t.total / t.max) * 100 : 0;
          return { key: s.id, userId: s.user_id, full_name: s.full_name, roll_number: s.roll_number, score: pct, label: `${pct.toFixed(1)}%` };
        });
      } else if (category === "attendance") {
        const { data: att } = studentIds.length
          ? await supabase.from("attendance").select("student_id, status").in("student_id", studentIds)
          : { data: [] };
        const stats: Record<string, { present: number; total: number }> = {};
        att?.forEach((a) => {
          if (!stats[a.student_id]) stats[a.student_id] = { present: 0, total: 0 };
          stats[a.student_id].total += 1;
          if (a.status === "present") stats[a.student_id].present += 1;
        });
        ranked = students.map((s) => {
          const st = stats[s.id] ?? { present: 0, total: 0 };
          const pct = st.total ? (st.present / st.total) * 100 : 0;
          return { key: s.id, userId: s.user_id, full_name: s.full_name, roll_number: s.roll_number, score: pct, label: `${pct.toFixed(0)}%` };
        });
      } else if (category === "homework") {
        const { data: hw } = await supabase.from("homework").select("id").eq("class_id", classId);
        const hwIds = hw?.map((h) => h.id) ?? [];
        const totalHw = hwIds.length;
        const { data: subs } = hwIds.length && studentIds.length
          ? await supabase.from("homework_submissions").select("student_id, status").in("homework_id", hwIds).in("student_id", studentIds)
          : { data: [] };
        const done: Record<string, number> = {};
        subs?.forEach((sub) => {
          if (sub.status === "submitted" || sub.status === "graded") done[sub.student_id] = (done[sub.student_id] ?? 0) + 1;
        });
        ranked = students.map((s) => {
          const n = done[s.id] ?? 0;
          const pct = totalHw ? (n / totalHw) * 100 : 0;
          return { key: s.id, userId: s.user_id, full_name: s.full_name, roll_number: s.roll_number, score: pct, label: totalHw ? `${n}/${totalHw}` : "—" };
        });
      } else if (category === "dpp") {
        const { data: dpps } = await supabase.from("dpps").select("id").eq("class_id", classId).eq("is_published", true);
        const dppIds = dpps?.map((d) => d.id) ?? [];
        const { data: attempts } = dppIds.length && userIds.length
          ? await supabase.from("dpp_attempts").select("user_id, score, max_score, status").in("dpp_id", dppIds).in("user_id", userIds).eq("status", "submitted")
          : { data: [] };
        const best: Record<string, number> = {};
        attempts?.forEach((a) => {
          const pct = a.max_score ? (Number(a.score) / Number(a.max_score)) * 100 : 0;
          best[a.user_id] = Math.max(best[a.user_id] ?? 0, pct);
        });
        ranked = students.map((s) => {
          const pct = s.user_id ? (best[s.user_id] ?? 0) : 0;
          return { key: s.id, userId: s.user_id, full_name: s.full_name, roll_number: s.roll_number, score: pct, label: `${pct.toFixed(0)}% avg` };
        });
      }

      ranked.sort((a, b) => b.score - a.score);
      if (cancelled) return;
      setRows(ranked);
      if (userIds.length) setBadgeMap(await fetchEquippedBadgesByUserIds(userIds));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, scope, category, subject, classId]);

  const myRank = useMemo(() => {
    if (!user) return null;
    const i = rows.findIndex((r) => r.userId === user.id);
    return i >= 0 ? i + 1 : null;
  }, [rows, user]);

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <>
      <PageHeader title="Leaderboards" subtitle="Compete, climb, and claim the crown" />

      {/* Scope switch */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "class", label: classLabel || "My Class", icon: <Users className="w-4 h-4" /> },
          { key: "school", label: "Whole School", icon: <Building2 className="w-4 h-4" /> },
        ] as const).map((s) => (
          <button
            key={s.key}
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

      {/* Category pills */}
      <div className="-mx-1 mb-3">
        <div className="flex gap-2 overflow-x-auto px-1 pb-2 [&::-webkit-scrollbar]:h-1.5">
          {visibleCats.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all",
                  active ? "bg-gradient-battle text-white border-transparent shadow-card scale-[1.02]" : "bg-card border-border hover:border-primary/40 hover:-translate-y-0.5",
                )}
              >
                {c.icon}{c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subject selector */}
      {category === "subject" && (
        <div className="mb-3 max-w-xs">
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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

          {/* Podium */}
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
    </>
  );
}

function Podium({ rows, meUserId, badgeMap }: { rows: RankRow[]; meUserId?: string; badgeMap: Record<string, string | null> }) {
  // order: 2nd, 1st, 3rd
  const order = [rows[1], rows[0], rows[2]];
  const heights = ["h-20", "h-28", "h-16"];
  const tone = ["from-muted", "from-warning/40", "from-accent/25"];
  const crownTone = ["text-tier-silver", "text-tier-gold", "text-tier-bronze"];
  const ranks = [2, 1, 3];
  return (
    <div className="grid grid-cols-3 gap-2 items-end mb-2">
      {order.map((r, i) => r && (
        <div key={r.key} className="text-center">
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className={cn("w-12 h-12 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center text-lg font-black",
              ranks[i] === 1 && "ring-4 ring-warning/50 w-14 h-14")}>
              {r.full_name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="text-xs font-semibold truncate max-w-full px-1 flex items-center gap-1">
              <span className="truncate">{r.full_name?.split(" ")[0]}</span>
              {r.userId && badgeMap[r.userId] && <EquippedBadge code={badgeMap[r.userId]} size="xs" />}
            </div>
            <div className="text-[11px] text-muted-foreground">{r.label}</div>
          </div>
          <div className={cn("rounded-t-xl bg-gradient-to-t to-transparent flex items-start justify-center pt-2", heights[i], tone[i], r.userId === meUserId && "ring-2 ring-primary")}>
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
