import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { CalendarDays, BookOpen, Clock } from "lucide-react";

const PERIODS = ["1", "2", "3", "4", "Lunch", "5", "6", "7"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TeacherTimetablePage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [classTeacherOf, setClassTeacherOf] = useState<any>(null);
  const [allTimetables, setAllTimetables] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Get teacher record
      const { data: t } = await supabase
        .from("teachers")
        .select("id, class_teacher_of, subject")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!t) {
        setLoading(false);
        return;
      }

      // Get class teacher assignment
      if (t.class_teacher_of) {
        const { data: c } = await supabase
          .from("classes")
          .select("id,name,section")
          .eq("id", t.class_teacher_of)
          .maybeSingle();
        setClassTeacherOf(c);
      }

      // Get subject class assignments
      const { data: tc } = await supabase
        .from("teacher_classes")
        .select("subject, class_id, classes(id,name,section)")
        .eq("teacher_id", t.id);

      const assigns = (tc ?? []).map((r: any) => ({
        classId: r.classes?.id,
        className: r.classes ? `${r.classes.name}-${r.classes.section}` : "—",
        subject: r.subject || t.subject || "Subject",
      }));
      setAssignments(assigns);

      // Load timetables from localStorage for all relevant classes
      const classIds = new Set<string>();
      if (t.class_teacher_of) classIds.add(t.class_teacher_of);
      assigns.forEach((a: any) => a.classId && classIds.add(a.classId));

      const timetables: Record<string, Record<string, string>> = {};
      classIds.forEach((cid) => {
        const stored = localStorage.getItem(`tt-${cid}`);
        if (stored) timetables[cid] = JSON.parse(stored);
      });
      setAllTimetables(timetables);
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  // Build teacher's personal schedule — scan timetables for their subject
  const mySchedule: { day: string; period: string; className: string; subject: string }[] = [];
  assignments.forEach((a) => {
    const tt = allTimetables[a.classId];
    if (!tt) return;
    DAYS.forEach((d) => {
      PERIODS.forEach((p) => {
        const val = tt[`${d}-${p}`]?.toLowerCase() || "";
        if (val && val.includes(a.subject.toLowerCase())) {
          mySchedule.push({ day: d, period: p, className: a.className, subject: a.subject });
        }
      });
    });
  });

  const periodsPerWeek = mySchedule.length;
  const daysTeaching = new Set(mySchedule.map((s) => s.day)).size;

  return (
    <>
      <PageHeader title="My Timetable" subtitle="Your teaching schedule" />

      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Periods/Week"
          value={periodsPerWeek}
          tone="accent"
        />
        <StatCard
          icon={<CalendarDays className="w-5 h-5" />}
          label="Teaching Days"
          value={daysTeaching}
        />
      </div>

      {/* Class assignments overview */}
      <Card className="p-4 mb-4">
        <h3 className="font-semibold mb-3">My Assignments</h3>
        <div className="space-y-2">
          {classTeacherOf && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-primary/5">
              <span className="text-sm font-medium">
                Class {classTeacherOf.name}-{classTeacherOf.section}
              </span>
              <Badge className="bg-primary/15 text-primary border-primary/30" variant="outline">
                Class Teacher
              </Badge>
            </div>
          )}
          {assignments.map((a, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted">
              <span className="text-sm font-medium">Class {a.className}</span>
              <Badge variant="outline">{a.subject}</Badge>
            </div>
          ))}
          {assignments.length === 0 && !classTeacherOf && (
            <p className="text-muted-foreground text-sm">No class assignments yet.</p>
          )}
        </div>
      </Card>

      {/* Weekly schedule grid */}
      {mySchedule.length > 0 ? (
        <Card className="p-4 overflow-x-auto">
          <h3 className="font-semibold mb-3">Weekly Schedule</h3>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-2">Day</th>
                {PERIODS.map((p) => (
                  <th key={p} className="p-2 text-center">P{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d) => (
                <tr key={d} className="border-t border-border">
                  <td className="p-2 font-medium">{d}</td>
                  {PERIODS.map((p) => {
                    const slot = mySchedule.find(
                      (s) => s.day === d && s.period === p
                    );
                    return (
                      <td key={p} className="p-1 text-center">
                        {slot ? (
                          <div className="bg-primary/10 text-primary rounded-md py-1 px-1.5 text-xs font-medium">
                            {slot.className}
                          </div>
                        ) : p === "Lunch" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">
            No timetable data found. Ask your admin to set up timetables for your assigned classes.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            The timetable will auto-populate once class schedules include your subject.
          </p>
        </Card>
      )}
    </>
  );
}
