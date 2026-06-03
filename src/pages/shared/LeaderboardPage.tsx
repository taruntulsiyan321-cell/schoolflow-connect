import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Medal, Award, ClipboardCheck, NotebookPen, Sword, Flame, Target } from "lucide-react";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { fetchEquippedBadgesByUserIds } from "@/hooks/useStudentBadges";

type Category = "marks" | "attendance" | "homework" | "battleground" | "streak" | "dpp";

type RankRow = {
  studentId: string;
  userId: string | null;
  full_name: string;
  roll_number: string | null;
  score: number;
  label: string;
};

const CATEGORIES: { key: Category; label: string; icon: React.ReactNode }[] = [
  { key: "marks", label: "Marks", icon: <Trophy className="w-3.5 h-3.5" /> },
  { key: "attendance", label: "Attendance", icon: <ClipboardCheck className="w-3.5 h-3.5" /> },
  { key: "homework", label: "Homework", icon: <NotebookPen className="w-3.5 h-3.5" /> },
  { key: "battleground", label: "Battleground", icon: <Sword className="w-3.5 h-3.5" /> },
  { key: "streak", label: "Streak", icon: <Flame className="w-3.5 h-3.5" /> },
  { key: "dpp", label: "DPP", icon: <Target className="w-3.5 h-3.5" /> },
];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>("marks");
  const [classLabel, setClassLabel] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [rows, setRows] = useState<RankRow[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data: me } = await supabase
        .from("students")
        .select("id, class_id, classes(name,section)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!me?.class_id) {
        if (!cancelled) {
          setClassId(null);
          setRows([]);
          setLoading(false);
        }
        return;
      }

      setClassId(me.class_id);
      setClassLabel(`Class ${me.classes?.name}-${me.classes?.section}`);

      const { data: classmates } = await supabase
        .from("students")
        .select("id, full_name, roll_number, user_id")
        .eq("class_id", me.class_id);

      const students = classmates ?? [];
      const studentIds = students.map((s) => s.id);
      const userIds = students.map((s) => s.user_id).filter(Boolean) as string[];

      let ranked: RankRow[] = [];

      if (category === "marks") {
        const { data: exams } = await supabase.from("exams").select("id, max_marks").eq("class_id", me.class_id);
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
          return {
            studentId: s.id,
            userId: s.user_id,
            full_name: s.full_name,
            roll_number: s.roll_number,
            score: pct,
            label: `${pct.toFixed(1)}%`,
          };
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
          return {
            studentId: s.id,
            userId: s.user_id,
            full_name: s.full_name,
            roll_number: s.roll_number,
            score: pct,
            label: `${pct.toFixed(0)}%`,
          };
        });
      } else if (category === "homework") {
        const { data: hw } = await supabase.from("homework").select("id").eq("class_id", me.class_id);
        const hwIds = hw?.map((h) => h.id) ?? [];
        const totalHw = hwIds.length;
        const { data: subs } = hwIds.length && studentIds.length
          ? await supabase
              .from("homework_submissions")
              .select("student_id, status")
              .in("homework_id", hwIds)
              .in("student_id", studentIds)
          : { data: [] };
        const done: Record<string, number> = {};
        subs?.forEach((sub) => {
          if (sub.status === "submitted" || sub.status === "graded") {
            done[sub.student_id] = (done[sub.student_id] ?? 0) + 1;
          }
        });
        ranked = students.map((s) => {
          const n = done[s.id] ?? 0;
          const pct = totalHw ? (n / totalHw) * 100 : 0;
          return {
            studentId: s.id,
            userId: s.user_id,
            full_name: s.full_name,
            roll_number: s.roll_number,
            score: pct,
            label: totalHw ? `${n}/${totalHw}` : "—",
          };
        });
      } else if (category === "battleground") {
        const { data: xpRows } = userIds.length
          ? await supabase.from("student_xp").select("user_id, xp, wins").in("user_id", userIds)
          : { data: [] };
        const xpMap = new Map(xpRows?.map((x) => [x.user_id, x]) ?? []);
        ranked = students.map((s) => {
          const x = s.user_id ? xpMap.get(s.user_id) : null;
          const xp = x?.xp ?? 0;
          return {
            studentId: s.id,
            userId: s.user_id,
            full_name: s.full_name,
            roll_number: s.roll_number,
            score: xp,
            label: `${xp} XP · ${x?.wins ?? 0} wins`,
          };
        });
      } else if (category === "streak") {
        const { data: xpRows } = userIds.length
          ? await supabase.from("student_xp").select("user_id, current_streak").in("user_id", userIds)
          : { data: [] };
        const map = new Map(xpRows?.map((x) => [x.user_id, x.current_streak]) ?? []);
        ranked = students.map((s) => {
          const streak = s.user_id ? (map.get(s.user_id) ?? 0) : 0;
          return {
            studentId: s.id,
            userId: s.user_id,
            full_name: s.full_name,
            roll_number: s.roll_number,
            score: streak,
            label: `${streak} days`,
          };
        });
      } else if (category === "dpp") {
        const { data: dpps } = await supabase.from("dpps").select("id").eq("class_id", me.class_id).eq("is_published", true);
        const dppIds = dpps?.map((d) => d.id) ?? [];
        const { data: attempts } = dppIds.length && userIds.length
          ? await supabase
              .from("dpp_attempts")
              .select("user_id, score, max_score, status")
              .in("dpp_id", dppIds)
              .in("user_id", userIds)
              .eq("status", "submitted")
          : { data: [] };
        const best: Record<string, number> = {};
        attempts?.forEach((a) => {
          const pct = a.max_score ? (Number(a.score) / Number(a.max_score)) * 100 : 0;
          best[a.user_id] = Math.max(best[a.user_id] ?? 0, pct);
        });
        ranked = students.map((s) => {
          const pct = s.user_id ? (best[s.user_id] ?? 0) : 0;
          return {
            studentId: s.id,
            userId: s.user_id,
            full_name: s.full_name,
            roll_number: s.roll_number,
            score: pct,
            label: `${pct.toFixed(0)}% avg`,
          };
        });
      }

      ranked.sort((a, b) => b.score - a.score);

      if (!cancelled) {
        setRows(ranked);
        if (userIds.length) setBadgeMap(await fetchEquippedBadgesByUserIds(userIds));
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, category]);

  const myRank = useMemo(() => {
    if (!user) return null;
    const i = rows.findIndex((r) => r.userId === user.id);
    return i >= 0 ? i + 1 : null;
  }, [rows, user]);

  return (
    <>
      <PageHeader
        title="Class Leaderboards"
        subtitle={classLabel || "Join a class to compete on leaderboards"}
      />

      {!classId ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          You need a class assignment to view leaderboards.
        </Card>
      ) : (
        <>
          {myRank != null && (
            <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
              <span className="text-sm">
                Your rank in <strong>{CATEGORIES.find((c) => c.key === category)?.label}</strong>:{" "}
                <span className="font-bold text-primary">#{myRank}</span>
              </span>
            </Card>
          )}

          <Tabs value={category} onValueChange={(v) => setCategory(v as Category)}>
            <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              {CATEGORIES.map((c) => (
                <TabsTrigger key={c.key} value={c.key} className="text-xs gap-1">
                  {c.icon}
                  {c.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={category} className="mt-4 space-y-2">
              {loading ? (
                <p className="text-center py-8 text-muted-foreground text-sm">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">No data yet for this category.</p>
              ) : (
                rows.map((r, i) => (
                  <LeaderboardRow
                    key={r.studentId}
                    rank={i + 1}
                    row={r}
                    isMe={r.userId === user?.id}
                    equippedBadge={r.userId ? badgeMap[r.userId] : null}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}

function LeaderboardRow({
  rank,
  row,
  isMe,
  equippedBadge,
}: {
  rank: number;
  row: RankRow;
  isMe?: boolean;
  equippedBadge?: string | null;
}) {
  const Icon = rank === 1 ? Trophy : rank === 2 ? Medal : rank === 3 ? Award : null;
  const tone =
    rank === 1
      ? "bg-warning/15 text-warning"
      : rank === 2
        ? "bg-muted text-muted-foreground"
        : rank === 3
          ? "bg-accent/10 text-accent"
          : "bg-primary/10 text-primary";

  return (
    <Card className={`p-4 flex items-center gap-3 shadow-card ${isMe ? "ring-2 ring-primary" : ""}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 ${tone}`}>
        {Icon ? <Icon className="w-5 h-5" /> : rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{row.full_name}</span>
          {equippedBadge && <EquippedBadge code={equippedBadge} size="xs" />}
          {isMe && <span className="text-xs text-primary shrink-0">(you)</span>}
        </div>
        <div className="text-xs text-muted-foreground">Roll {row.roll_number || "—"}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold">{row.label}</div>
      </div>
    </Card>
  );
}
