import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { CalendarDays } from "lucide-react";

const PERIODS = ["1", "2", "3", "4", "Lunch", "5", "6", "7"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function StudentTimetablePage() {
  const { user } = useAuth();
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [className, setClassName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Get student's class
      const { data: s } = await supabase
        .from("students")
        .select("class_id, classes(id,name,section)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!s?.class_id) {
        setLoading(false);
        return;
      }

      setClassName(
        s.classes ? `Class ${(s.classes as any).name}-${(s.classes as any).section}` : ""
      );

      // Load timetable from localStorage (matches admin/teacher timetable storage)
      const stored = localStorage.getItem(`tt-${s.class_id}`);
      if (stored) {
        setGrid(JSON.parse(stored));
      }

      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  const hasData = Object.values(grid).some((v) => v.trim() !== "");

  // Figure out today's day name
  const todayIdx = new Date().getDay(); // 0=Sun, 1=Mon, ...
  const todayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][todayIdx];

  return (
    <>
      <PageHeader
        title="My Timetable"
        subtitle={className ? `Weekly schedule for ${className}` : "Your weekly schedule"}
      />

      {hasData ? (
        <>
          {/* Today's schedule highlight */}
          {DAYS.includes(todayName) && (
            <Card className="p-4 mb-4 bg-gradient-primary text-primary-foreground">
              <div className="text-xs opacity-80 mb-1">Today · {todayName}</div>
              <div className="flex gap-2 flex-wrap">
                {PERIODS.map((p) => {
                  const subject = grid[`${todayName}-${p}`];
                  if (!subject || p === "Lunch") return null;
                  return (
                    <div
                      key={p}
                      className="bg-white/15 rounded-lg px-3 py-1.5 text-xs font-medium"
                    >
                      P{p}: {subject}
                    </div>
                  );
                })}
                {PERIODS.every(
                  (p) => !grid[`${todayName}-${p}`] || p === "Lunch"
                ) && (
                  <span className="text-sm opacity-80">No classes today 🎉</span>
                )}
              </div>
            </Card>
          )}

          {/* Full timetable grid */}
          <Card className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2">Day</th>
                  {PERIODS.map((p) => (
                    <th key={p} className="p-2 text-center">
                      {p === "Lunch" ? "🍱" : `P${p}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d) => (
                  <tr
                    key={d}
                    className={`border-t border-border ${
                      d === todayName ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="p-2 font-medium">
                      {d}
                      {d === todayName && (
                        <span className="ml-1 text-xs text-primary">•</span>
                      )}
                    </td>
                    {PERIODS.map((p) => {
                      const val = grid[`${d}-${p}`] || "";
                      return (
                        <td key={p} className="p-1.5 text-center">
                          {p === "Lunch" ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : val ? (
                            <div className="bg-muted rounded-md py-1 px-1 text-xs font-medium truncate min-w-[60px]">
                              {val}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <Card className="p-8 text-center">
          <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">
            No timetable set up for your class yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Your class teacher or admin will configure the timetable.
          </p>
        </Card>
      )}
    </>
  );
}
