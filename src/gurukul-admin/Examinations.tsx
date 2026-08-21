import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { EXAM_TYPE_LABELS, MarksService, useAcademicLive } from "@/academic";
import type { ExamRecord } from "@/academic/repository/marksRepository";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "./shared";

type ExamGroupRow = {
  examGroupId: string;
  name: string;
  classId: string;
  startDate: string | null;
  endDate: string | null;
  examType: string;
  subjectCount: number;
  marksLocked: boolean;
  resultsPublishedAt: string | null;
};

function groupExams(exams: ExamRecord[]): ExamGroupRow[] {
  const groups = new Map<string, ExamGroupRow>();
  for (const e of exams) {
    const gid = e.examGroupId ?? e.id;
    const recordStart = e.startDate ?? e.examDate;
    const recordEnd = e.endDate ?? e.examDate;
    const existing = groups.get(gid);
    const g = existing ?? {
      examGroupId: gid,
      name: e.name,
      classId: e.classId,
      startDate: recordStart,
      endDate: recordEnd,
      examType: e.examType,
      subjectCount: 0,
      marksLocked: true,
      resultsPublishedAt: e.resultsPublishedAt,
    };
    if (existing) {
      if (recordStart && (!g.startDate || recordStart < g.startDate)) g.startDate = recordStart;
      if (recordEnd && (!g.endDate || recordEnd > g.endDate)) g.endDate = recordEnd;
    }
    g.subjectCount += 1;
    g.marksLocked = g.marksLocked && e.marksLocked;
    if (!e.resultsPublishedAt) g.resultsPublishedAt = null;
    groups.set(gid, g);
  }
  return [...groups.values()].sort((a, b) =>
    String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")),
  );
}

/**
 * Admin examinations monitor — MarksService.listForSchool only.
 * No local compose / fake exams.
 */
export default function ExaminationManagement() {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["marks", "examination"]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "published">("all");
  const [classNameById, setClassNameById] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [list, classesRes] = await Promise.all([
          MarksService.listForSchool(ctx, { limit: 200 }),
          supabase.from("classes").select("id, name, section").eq("school_id", ctx.schoolId),
        ]);
        if (!cancelled) {
          setExams(list);
          // Table displays the class per exam group; classId alone is not
          // human-distinguishable (this school's class ids all share the
          // same 8-char prefix, same issue found+fixed in Reports.tsx's
          // student-attendance report).
          setClassNameById(
            new Map((classesRes.data ?? []).map((c) => [c.id, `${c.name}-${c.section}`])),
          );
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setExams([]);
          setError(e instanceof Error ? e.message : "Failed to load examinations");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  const groups = useMemo(() => groupExams(exams), [exams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (filter === "pending" && g.resultsPublishedAt) return false;
      if (filter === "published" && !g.resultsPublishedAt) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.examType.toLowerCase().includes(q) ||
        g.classId.toLowerCase().includes(q)
      );
    });
  }, [groups, search, filter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[#78788c] text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading examinations…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[#1a1a2e]">Examinations</h1>
          <p className="text-xs text-[#78788c]">
            MarksService.listForSchool — school monitor across classes
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search exam…"
          className="border border-[#e5e7eb] rounded-xl px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-xs text-[#cc5069]">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Exam groups", value: groups.length },
          { label: "Subject papers", value: exams.length },
          {
            label: "Results published",
            value: groups.filter((g) => g.resultsPublishedAt).length,
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
            <div className="text-xl font-bold tabular-nums">{k.value}</div>
            <div className="text-[11px] text-[#78788c]">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 p-1 bg-white border border-[#e5e7eb] rounded-2xl w-fit">
        {(
          [
            { key: "all", label: "All" },
            { key: "pending", label: "Pending results" },
            { key: "published", label: "Published results" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
              filter === t.key ? "bg-[#3b5bdb]/15 text-[#3b5bdb]" : "text-[#78788c]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-[#e5e7eb] bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#78788c] border-b">
              <th className="p-3">Examination</th>
              <th className="p-3">Type</th>
              <th className="p-3">Class</th>
              <th className="p-3">Dates</th>
              <th className="p-3">Subjects</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-[#78788c]">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-[#c4c4d0]" />
                  No examinations found. Teachers schedule exams via MarksService.
                </td>
              </tr>
            ) : (
              filtered.map((g) => {
                const typeLabel =
                  EXAM_TYPE_LABELS[g.examType as keyof typeof EXAM_TYPE_LABELS] ?? g.examType;
                const status = g.resultsPublishedAt
                  ? "Results published"
                  : g.marksLocked
                    ? "Marks locked"
                    : "In progress";
                return (
                  <tr key={g.examGroupId} className="border-b border-[#f0f1f3]">
                    <td className="p-3 font-medium">{g.name}</td>
                    <td className="p-3 text-[#46465a]">{typeLabel}</td>
                    <td className="p-3 text-[#46465a]">{classNameById.get(g.classId) ?? `${g.classId.slice(0, 8)}…`}</td>
                    <td className="p-3 tabular-nums text-[#46465a]">
                      {g.startDate ?? "—"}
                      {g.endDate && g.endDate !== g.startDate ? ` → ${g.endDate}` : ""}
                    </td>
                    <td className="p-3 tabular-nums">{g.subjectCount}</td>
                    <td className="p-3 text-xs">{status}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
