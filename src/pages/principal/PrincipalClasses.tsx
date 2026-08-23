import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { Users, ChevronRight, BookOpen } from "lucide-react";
import { toErrorMessage } from "@/lib/presentation";

type ClassRow = {
  id: string;
  name: string;
  section: string;
  academic_year: string | null;
  student_count: number;
  class_teacher: string | null;
};

export default function PrincipalClasses() {
  const liveVersion = useAcademicLive(["attendance", "profile"]);
  const { ctx, ready, settled } = useAcademicContext();
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: classes, error: classesErr } = await supabase
          .from("classes")
          .select("id, name, section, academic_year")
          .eq("school_id", ctx.schoolId)
          .order("name")
          .order("section");
        if (classesErr) throw classesErr;

        const ids = (classes ?? []).map((c) => c.id);
        const [{ data: students }, { data: teachers }] = await Promise.all([
          ids.length
            ? supabase
                .from("students")
                .select("id, class_id")
                .eq("school_id", ctx.schoolId)
                .in("class_id", ids)
            : Promise.resolve({ data: [] as { id: string; class_id: string }[] }),
          ids.length
            ? supabase
                .from("teachers")
                .select("full_name, class_teacher_of")
                .eq("school_id", ctx.schoolId)
                .in("class_teacher_of", ids)
            : Promise.resolve({ data: [] as { full_name: string; class_teacher_of: string | null }[] }),
        ]);

        const counts: Record<string, number> = {};
        (students ?? []).forEach((s) => {
          counts[s.class_id] = (counts[s.class_id] ?? 0) + 1;
        });
        const ctMap: Record<string, string> = {};
        (teachers ?? []).forEach((t) => {
          if (t.class_teacher_of) ctMap[t.class_teacher_of] = t.full_name;
        });

        if (cancelled) return;
        setRows(
          (classes ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            section: c.section,
            academic_year: c.academic_year ?? null,
            student_count: counts[c.id] ?? 0,
            class_teacher: ctMap[c.id] ?? null,
          })),
        );
      } catch (e) {
        if (!cancelled) {
          setError(toErrorMessage(e, "Failed to load classes"));
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, liveVersion, ctx, ready]);

  return (
    <>
      <PageHeader
        title="All Classes"
        subtitle="Click any class to view students, attendance and analytics"
      />

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading classes…</p>
      ) : error ? (
        <Card className="p-8 text-center text-destructive">Failed to load classes: {error}</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No classes have been created yet.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((r) => (
            <Link key={r.id} to={`/principal/classes/${r.id}`} className="group">
              <Card className="p-5 shadow-card hover:shadow-elevated transition-all border hover:border-primary/40">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center shadow-elevated">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="font-bold text-lg leading-tight">
                  Class {r.name}
                  <span className="text-muted-foreground font-medium"> · {r.section}</span>
                </div>
                <div className="text-xs text-muted-foreground mb-3">
                  {r.academic_year ?? "Current year"}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    {r.student_count} students
                  </span>
                  <span className="text-xs px-2 py-1 rounded-md bg-accent text-accent-foreground truncate max-w-[55%]">
                    {r.class_teacher ? `CT: ${r.class_teacher}` : "No class teacher"}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
