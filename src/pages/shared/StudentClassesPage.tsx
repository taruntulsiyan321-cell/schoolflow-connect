import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { BookOpen, GraduationCap, Users, User, Trophy } from "lucide-react";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { LeaderboardPanel } from "@/components/student/LeaderboardPanel";
import { cn } from "@/lib/utils";

interface SubjectTeacher {
  subject: string | null;
  teacherName: string;
  isClassTeacher: boolean;
}

export default function StudentClassesPage() {
  const { user } = useAuth();
  const [student, setStudent] = useState<any>(null);
  const [classTeacher, setClassTeacher] = useState<any>(null);
  const [subjects, setSubjects] = useState<SubjectTeacher[]>([]);
  const [classmates, setClassmates] = useState(0);
  const [classmateRows, setClassmateRows] = useState<{ id: string; full_name: string; roll_number: string | null; user_id: string | null; equipped_badge: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"overview" | "leaderboard">("overview");

  useEffect(() => {
    if (window.location.hash === "#leaderboard") {
      setActiveSection("leaderboard");
      requestAnimationFrame(() => {
        document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

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
        subtitle="Class info, classmates, and rankings"
      />

      <nav className="flex gap-2 mb-6 p-1 rounded-full bg-muted/50 border border-border/60 w-fit">
        {([
          { id: "overview" as const, label: "Overview" },
          { id: "leaderboard" as const, label: "Rankings", icon: Trophy },
        ]).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveSection(tab.id);
              if (tab.id === "leaderboard") {
                window.history.replaceState(null, "", "#leaderboard");
                document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
              } else {
                window.history.replaceState(null, "", window.location.pathname);
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
    </>
  );
}
