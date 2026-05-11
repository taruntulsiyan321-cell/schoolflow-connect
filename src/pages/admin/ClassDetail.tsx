import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, GraduationCap, ClipboardCheck, FilePlus, Send, ChevronRight, ShieldCheck, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui-bits";

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ClassDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [cls, setCls] = useState<any>(null);
  const [classTeacher, setClassTeacher] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [att, setAtt] = useState({ present: 0, absent: 0, leave: 0, total: 0 });
  const [exams, setExams] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [c, t, s, a, e] = await Promise.all([
        supabase.from("classes").select("*").eq("id", id).maybeSingle(),
        supabase.from("teachers").select("id, full_name, subject, mobile, email").eq("class_teacher_of", id).maybeSingle(),
        supabase.from("students").select("id, full_name, admission_number, roll_number, parent_mobile, user_id").eq("class_id", id).order("roll_number", { nullsFirst: false }),
        supabase.from("attendance").select("status").eq("class_id", id).eq("date", todayStr()),
        supabase.from("exams").select("id, name, subject, exam_date, max_marks").eq("class_id", id).order("exam_date", { ascending: false }).limit(6),
      ]);
      setCls(c.data); setClassTeacher(t.data); setStudents(s.data ?? []);
      const rows = a.data ?? [];
      setAtt({
        present: rows.filter(r => r.status === "present").length,
        absent: rows.filter(r => r.status === "absent").length,
        leave: rows.filter(r => r.status === "leave").length,
        total: rows.length,
      });
      setExams(e.data ?? []);
    })();
  }, [id]);

  if (!cls) return <p className="text-muted-foreground py-12 text-center">Loading…</p>;

  const isBatch = cls.kind === "batch";
  const title = isBatch ? cls.display_name : `Class ${cls.name}-${cls.section}`;
  const rate = att.total ? Math.round((att.present / att.total) * 100) : 0;

  return (
    <>
      <button onClick={() => nav(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <PageHeader
        title={title}
        subtitle={`${isBatch ? cls.category || "Batch / Program" : "School class"} · Academic year ${cls.academic_year}`}
      />

      {/* Top row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Users className="w-3.5 h-3.5" /> Students enrolled
          </div>
          <div className="text-2xl font-bold">{students.length}</div>
        </Card>

        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ClipboardCheck className="w-3.5 h-3.5" /> Attendance today
          </div>
          {att.total === 0 ? (
            <div className="text-sm text-muted-foreground">Not marked yet</div>
          ) : (
            <>
              <div className="text-2xl font-bold">{rate}%</div>
              <div className="text-xs text-muted-foreground">{att.present} present · {att.absent} absent · {att.leave} leave</div>
            </>
          )}
        </Card>

        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <GraduationCap className="w-3.5 h-3.5" /> Class teacher
          </div>
          {classTeacher ? (
            <Link to={`/admin/teachers/${classTeacher.id}`} className="block hover:underline">
              <div className="font-semibold">{classTeacher.full_name}</div>
              <div className="text-xs text-muted-foreground">{classTeacher.subject || "—"}</div>
            </Link>
          ) : (
            <div className="text-sm text-muted-foreground">Not assigned</div>
          )}
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        <Link to="/admin/attendance" className="flex items-center justify-center gap-1.5 text-xs font-medium p-3 rounded-lg border hover:border-primary/40 hover:bg-primary/[0.02]">
          <ClipboardCheck className="w-3.5 h-3.5 text-primary" /> Mark Attendance
        </Link>
        <Link to="/admin/exams" className="flex items-center justify-center gap-1.5 text-xs font-medium p-3 rounded-lg border hover:border-primary/40 hover:bg-primary/[0.02]">
          <FilePlus className="w-3.5 h-3.5 text-accent" /> Create Exam
        </Link>
        <Link to="/admin/notices" className="flex items-center justify-center gap-1.5 text-xs font-medium p-3 rounded-lg border hover:border-primary/40 hover:bg-primary/[0.02]">
          <Send className="w-3.5 h-3.5 text-warning" /> Send Notice
        </Link>
        <Link to="/admin/students" className="flex items-center justify-center gap-1.5 text-xs font-medium p-3 rounded-lg border hover:border-primary/40 hover:bg-primary/[0.02]">
          <Users className="w-3.5 h-3.5 text-secondary" /> Add Student
        </Link>
      </div>

      {/* Students */}
      <Card className="p-0 shadow-card mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Students ({students.length})</h3>
        </div>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No students in this {isBatch ? "batch" : "class"} yet.</p>
        ) : (
          <div className="divide-y">
            {students.map(s => (
              <div key={s.id} className="px-4 py-2.5 flex items-center justify-between text-sm hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    Roll {s.roll_number || "-"} · Adm# {s.admission_number}
                    {s.parent_mobile ? ` · Parent ${s.parent_mobile}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.user_id ? (
                    <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30 text-[10px]">
                      <ShieldCheck className="w-3 h-3 mr-0.5" /> Linked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      <ShieldAlert className="w-3 h-3 mr-0.5" /> No account
                    </Badge>
                  )}
                  <Link to="/admin/students" className="text-xs text-primary hover:underline flex items-center">
                    Profile <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent exams */}
      <Card className="p-0 shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Recent exams</h3>
          <Link to="/admin/exams" className="text-xs text-primary hover:underline">View all</Link>
        </div>
        {exams.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No exams scheduled.</p>
        ) : (
          <div className="divide-y">
            {exams.map(e => (
              <div key={e.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.subject} · max {e.max_marks}</div>
                </div>
                <span className="text-xs text-muted-foreground">{e.exam_date || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
