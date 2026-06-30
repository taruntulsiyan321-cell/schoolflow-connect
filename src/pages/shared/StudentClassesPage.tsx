import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { BookOpen, CalendarDays, ClipboardCheck, FileText, GraduationCap, NotebookPen, Users, User, Trophy, MessageCircle } from "lucide-react";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { LeaderboardPanel } from "@/components/student/LeaderboardPanel";
import { CommunityDoubtPortal } from "@/components/community/CommunityDoubtPortal";
import StudentHomeworkPage from "@/pages/shared/StudentHomeworkPage";
import StudentExamsResultsPage from "@/pages/shared/StudentExamsResultsPage";
import { cn } from "@/lib/utils";

interface SubjectTeacher {
  subject: string | null;
  teacherName: string;
  isClassTeacher: boolean;
}

const PERIODS = ["1", "2", "3", "4", "Lunch", "5", "6", "7"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ATTENDANCE_COLORS: Record<string, string> = {
  present: "bg-accent/10 text-accent",
  absent: "bg-destructive/10 text-destructive",
  leave: "bg-warning/10 text-warning",
};
const CLASS_SECTIONS = ["doubts", "homework", "exams", "attendance", "timetable", "leaderboard"] as const;
type ClassSection = "overview" | typeof CLASS_SECTIONS[number];

function normalizeTimetableGrid(grid: unknown): Record<string, string> {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) return {};
  return Object.fromEntries(
    Object.entries(grid as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
  );
}

export default function StudentClassesPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [student, setStudent] = useState<any>(null);
  const [classTeacher, setClassTeacher] = useState<any>(null);
  const [subjects, setSubjects] = useState<SubjectTeacher[]>([]);
  const [classmates, setClassmates] = useState(0);
  const [classmateRows, setClassmateRows] = useState<{ id: string; full_name: string; roll_number: string | null; user_id: string | null; equipped_badge: string | null }[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [timetableGrid, setTimetableGrid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<ClassSection>("overview");

  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if ((CLASS_SECTIONS as readonly string[]).includes(hash)) {
      const next = hash as ClassSection;
      setActiveSection(next);
      requestAnimationFrame(() => {
        document.getElementById(next)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      setActiveSection("overview");
    }
  }, [location.hash]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Get student record with class info
      const { data: s } = await supabase
        .from("students")
        .select("*, classes(id,name,section)")
        .eq("user_id", user.id)
        .maybeSingle();
      setStudent(s);

      if (!s?.class_id) {
        setLoading(false);
        return;
      }

      // Classmates via SECURITY DEFINER RPC (RLS blocks direct peer reads)
      const { data: mates } = await supabase.rpc("rpc_classmates");
      const rows = (mates ?? []).map((m: any) => ({
        id: m.student_id, full_name: m.full_name, roll_number: m.roll_number,
        user_id: m.user_id, equipped_badge: m.equipped_badge,
      }));
      setClassmateRows(rows);
      setClassmates(rows.length + 1); // include self

      // Get class teacher
      const { data: ct } = await supabase
        .from("teachers")
        .select("full_name, subject, mobile")
        .eq("class_teacher_of", s.class_id)
        .maybeSingle();
      setClassTeacher(ct);

      // Get subject teachers assigned to this class
      const { data: tc } = await supabase
        .from("teacher_classes")
        .select("subject, teachers(full_name, is_class_teacher)")
        .eq("class_id", s.class_id);

      const subs: SubjectTeacher[] = (tc ?? []).map((r: any) => ({
        subject: r.subject,
        teacherName: r.teachers?.full_name ?? "Unknown",
        isClassTeacher: r.teachers?.is_class_teacher ?? false,
      }));
      setSubjects(subs);

      const { data: attendance } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", s.id)
        .order("date", { ascending: false })
        .limit(60);
      setAttendanceRows(attendance ?? []);

      const { data: timetable } = await supabase
        .from("class_timetables")
        .select("grid")
        .eq("class_id", s.class_id)
        .maybeSingle();
      setTimetableGrid(normalizeTimetableGrid(timetable?.grid));

      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  if (!student) {
    return (
      <>
        <PageHeader title="My Classes" subtitle="Subjects, schedule, and class info" />
        <Card className="p-5 border-warning/30 bg-warning/5">
          <p className="text-sm">
            Your account isn't linked to a student record yet. Ask admin to link{" "}
            <strong>{user?.email}</strong> from the Link Users panel.
          </p>
        </Card>
      </>
    );
  }

  if (!student.classes) {
    return (
      <>
        <PageHeader title="My Classes" subtitle="Subjects, schedule, and class info" />
        <Card className="p-8 text-center">
          <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">You haven't been assigned to a class yet.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Class ${student.classes.name}-${student.classes.section}`}
        subtitle="Class info, homework, exams, attendance, timetable, doubt discussions, and rankings"
      />

      <nav className="flex gap-2 mb-6 p-1 rounded-full bg-muted/50 border border-border/60 w-fit">
        {([
          { id: "overview" as const, label: "Overview" },
          { id: "doubts" as const, label: "Doubt Portal", icon: MessageCircle },
          { id: "homework" as const, label: "Homework", icon: NotebookPen },
          { id: "exams" as const, label: "Exams & Results", icon: FileText },
          { id: "attendance" as const, label: "Attendance", icon: ClipboardCheck },
          { id: "timetable" as const, label: "Timetable", icon: CalendarDays },
          { id: "leaderboard" as const, label: "Rankings", icon: Trophy },
        ]).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveSection(tab.id);
              if (tab.id !== "overview") {
                window.history.replaceState(null, "", `${location.pathname}#${tab.id}`);
                document.getElementById(tab.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              } else {
                window.history.replaceState(null, "", location.pathname);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all",
              activeSection === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
            {tab.label}
          </button>
        ))}
      </nav>

      {activeSection === "overview" && (
      <div id="overview" className="scroll-mt-20">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Classmates"
          value={classmates}
        />
        <StatCard
          icon={<BookOpen className="w-5 h-5" />}
          label="Subjects"
          value={subjects.length}
          tone="accent"
        />
      </div>

      {/* Class teacher */}
      {classTeacher && (
        <Card className="p-5 mb-4 bg-gradient-primary text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs opacity-80">Class Teacher</div>
              <div className="font-bold">{classTeacher.full_name}</div>
              <div className="text-xs opacity-80">
                {classTeacher.subject || "General"} · {classTeacher.mobile || "No contact"}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Subjects grid */}
      <h3 className="font-semibold mb-3">Subjects & Teachers</h3>
      {subjects.length > 0 ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {subjects.map((s, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{s.subject || "Subject"}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    <GraduationCap className="w-3.5 h-3.5 inline mr-1" />
                    {s.teacherName}
                  </div>
                </div>
                {s.isClassTeacher && (
                  <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30 shrink-0">
                    CT
                  </Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No subject assignments yet for your class.</p>
        </Card>
      )}

      {classmateRows.length > 0 && (
        <>
          <h3 className="font-semibold mb-3 mt-6">Classmates</h3>
          <div className="space-y-2 mb-4">
            {classmateRows.map((m) => (
              <Card key={m.id} className="p-3 flex items-center gap-3 shadow-card">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center font-bold text-sm shrink-0">
                  {m.full_name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    {m.full_name}
                    {m.equipped_badge && <EquippedBadge code={m.equipped_badge} size="xs" />}
                  </div>
                  <div className="text-xs text-muted-foreground">Roll {m.roll_number || "—"}</div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Student info */}
      <Card className="p-4 mt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{student.full_name}</div>
            <div className="text-xs text-muted-foreground">
              Roll {student.roll_number || "—"} · Adm# {student.admission_number}
            </div>
          </div>
          <Badge variant="outline">
            Class {student.classes.name}-{student.classes.section}
          </Badge>
        </div>
      </Card>
      </div>
      )}

      {activeSection === "doubts" && (
        <section id="doubts" className="scroll-mt-20">
          <CommunityDoubtPortal mode="student" />
        </section>
      )}

      {activeSection === "homework" && (
        <section id="homework" className="scroll-mt-20">
          <div className="mb-4 flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-semibold text-lg">Class Homework</h3>
              <p className="text-sm text-muted-foreground">Assignments and submissions now live inside Classes.</p>
            </div>
          </div>
          <StudentHomeworkPage embedded />
        </section>
      )}

      {activeSection === "exams" && (
        <section id="exams" className="scroll-mt-20">
          <StudentExamsResultsPage />
        </section>
      )}

      {activeSection === "attendance" && (
        <section id="attendance" className="scroll-mt-20">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-semibold text-lg">Class Attendance</h3>
              <p className="text-sm text-muted-foreground">Your recent attendance is now part of the Classes section.</p>
            </div>
          </div>
          <div className="space-y-2">
            {attendanceRows.map((row) => (
              <Card key={row.id} className="p-3 flex items-center justify-between shadow-card">
                <span className="font-medium">
                  {new Date(row.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                </span>
                <span className={cn("text-xs px-2.5 py-1 rounded-full capitalize font-medium", ATTENDANCE_COLORS[row.status] ?? "bg-muted text-muted-foreground")}>
                  {row.status}
                </span>
              </Card>
            ))}
            {attendanceRows.length === 0 && (
              <Card className="p-8 text-center">
                <ClipboardCheck className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No attendance records yet.</p>
              </Card>
            )}
          </div>
        </section>
      )}

      {activeSection === "timetable" && (
        <section id="timetable" className="scroll-mt-20">
          <StudentClassTimetable grid={timetableGrid} />
        </section>
      )}

      {activeSection === "leaderboard" && (
      <section id="leaderboard" className="scroll-mt-20 mt-10 pt-8 border-t border-border/60">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Class & school rankings</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          XP, wins, streaks, and academic standings — compete with classmates and the whole school.
        </p>
        <LeaderboardPanel embedded />
      </section>
      )}
    </>
  );
}

function StudentClassTimetable({ grid }: { grid: Record<string, string> }) {
  const hasData = Object.values(grid).some((value) => value.trim() !== "");
  const todayIdx = new Date().getDay();
  const todayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][todayIdx];

  if (!hasData) {
    return (
      <Card className="p-8 text-center">
        <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-muted-foreground">No timetable set up for your class yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Your class teacher or admin will configure the timetable.</p>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-primary" />
        <div>
          <h3 className="font-semibold text-lg">Class Timetable</h3>
          <p className="text-sm text-muted-foreground">Weekly class schedule inside your Classes section.</p>
        </div>
      </div>

      {DAYS.includes(todayName) && (
        <Card className="p-4 mb-4 bg-gradient-primary text-primary-foreground">
          <div className="text-xs opacity-80 mb-1">Today · {todayName}</div>
          <div className="flex gap-2 flex-wrap">
            {PERIODS.map((period) => {
              const subject = grid[`${todayName}-${period}`];
              if (!subject || period === "Lunch") return null;
              return (
                <div key={period} className="bg-white/15 rounded-lg px-3 py-1.5 text-xs font-medium">
                  P{period}: {subject}
                </div>
              );
            })}
            {PERIODS.every((period) => !grid[`${todayName}-${period}`] || period === "Lunch") && (
              <span className="text-sm opacity-80">No classes today</span>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left p-2">Day</th>
              {PERIODS.map((period) => (
                <th key={period} className="p-2 text-center">{period === "Lunch" ? "Lunch" : `P${period}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day} className={cn("border-t border-border", day === todayName && "bg-primary/5")}>
                <td className="p-2 font-medium">
                  {day}
                  {day === todayName && <span className="ml-1 text-xs text-primary">•</span>}
                </td>
                {PERIODS.map((period) => {
                  const value = grid[`${day}-${period}`] || "";
                  return (
                    <td key={period} className="p-1.5 text-center">
                      {period === "Lunch" ? (
                        <span className="text-xs text-muted-foreground">Break</span>
                      ) : value ? (
                        <div className="bg-muted rounded-md py-1 px-1 text-xs font-medium truncate min-w-[60px]">{value}</div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
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
  );
}
