import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toErrorMessage } from "@/lib/presentation";

export type ClassRow = { id: string; name: string; section: string | null; students: number };

export function classLabel(c: Pick<ClassRow, "name" | "section">): string {
  return [c.name, c.section].filter(Boolean).join(" ");
}

/**
 * Every active class of this school, with how many students are on its roll —
 * the list both of the principal's live class screens start from (the Tests
 * tab and the Classes tab), read here once rather than in each.
 */
export function useSchoolClasses(): { rows: ClassRow[] | null; error: string | null } {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive("profile");
  const [rows, setRows] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx?.schoolId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: classErr } = await supabase
          .from("classes")
          .select("id, name, section, is_active")
          .eq("school_id", ctx.schoolId)
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (classErr) throw classErr;

        const ids = (data ?? []).map((c) => String(c.id));
        // One read for the roll counts rather than one per class.
        const counts = new Map<string, number>();
        if (ids.length > 0) {
          const { data: students, error: stuErr } = await supabase
            .from("students")
            .select("id, class_id")
            .eq("school_id", ctx.schoolId)
            .is("deleted_at", null)
            .in("class_id", ids);
          if (stuErr) throw stuErr;
          for (const s of students ?? []) {
            const key = String((s as { class_id: string | null }).class_id ?? "");
            if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }

        if (cancelled) return;
        setRows(
          (data ?? []).map((c) => ({
            id: String(c.id),
            name: String(c.name ?? ""),
            section: (c as { section: string | null }).section ?? null,
            students: counts.get(String(c.id)) ?? 0,
          })),
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load the school's classes"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  return { rows, error };
}
