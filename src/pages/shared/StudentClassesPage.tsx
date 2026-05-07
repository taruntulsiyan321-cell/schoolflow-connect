import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { BookOpen, GraduationCap, Users, User } from "lucide-react";

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
  const [loading, setLoading] = useState(true);

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

      // Get classmates count
      const { count } = await supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("class_id", s.class_id);
      setClassmates(count ?? 0);

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
        subtitle="Your class information and subjects"
      />

      {/* Quick stats */}
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
    </>
  );
}
