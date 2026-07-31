import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AcademicProfileService,
  AttendanceService,
  type AttendanceRecord,
  type ParentChildRow,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

/**
 * Live parent attendance — AcademicProfileService + AttendanceService only.
 * No mock data. Summary % comes from AcademicProfileService (engine).
 */
export function ParentLiveAttendance({ studentId }: { studentId: string }) {
  const { ctx, ready } = useAcademicContext();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [pct, setPct] = useState(0);
  const [present, setPresent] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const settled = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AttendanceService.listForStudent(ctx, studentId, { limit: 120 }),
        ]);
        if (cancelled) return;
        const profile = settled[0].status === "fulfilled" ? settled[0].value : null;
        const list = settled[1].status === "fulfilled" ? settled[1].value : [];
        setRecords(list);
        setPct(Math.round(profile?.attendancePct ?? 0));
        setPresent(profile?.attendancePresent ?? 0);
        setTotal(profile?.attendanceTotal ?? 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load attendance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

  const statusColor: Record<string, string> = {
    present: "#3b5bdb",
    absent: "#cc5069",
    late: "#f59e0b",
    half_day: "#6366f1",
    leave: "#c08a3a",
  };

  const calendarDays = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)),
    [records],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading live attendance…
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-[#cc5069] py-6 text-center">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-[#3b5bdb]">{present}</div>
          <div className="text-[9px] text-[#3b5bdb] uppercase tracking-wide font-bold">Present equiv.</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-white">{total}</div>
          <div className="text-[9px] text-[#78788c] uppercase tracking-wide font-bold">Days marked</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-white">{pct}%</div>
          <div className="text-[9px] text-[#78788c] uppercase tracking-wide font-bold">Engine rate</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {Object.entries(statusColor).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1.5 text-[10px] text-[#78788c] capitalize">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
            {k.replace("_", " ")}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarDays.length === 0 && (
          <div className="col-span-7 text-center text-xs text-[#46465a] py-8">
            No attendance recorded yet.
          </div>
        )}
        {calendarDays.map((day) => {
          const d = parseInt(day.date.split("-")[2] ?? "0", 10);
          const color = statusColor[day.status] ?? "#78788c";
          return (
            <div
              key={`${day.date}-${day.id}`}
              title={`${day.date}: ${day.status}`}
              className="aspect-square rounded-md flex items-center justify-center text-[9px] font-bold"
              style={{ background: `${color}30`, color }}
            >
              {d}
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-[#46465a]">
        Attendance % from AcademicProfileService. Day grid from AttendanceService.
      </p>
    </div>
  );
}

/** Hook: live children for parent panel (engine). */
export function useParentLiveChildren() {
  const { ctx, ready } = useAcademicContext();
  const [children, setChildren] = useState<ParentChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await AttendanceService.listParentChildren(ctx);
        if (!cancelled) setChildren(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load children");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  return { children, loading, error, ready };
}

/** Attendance metrics from AcademicProfileService for dashboard widgets. */
export function useChildAttendancePct(studentId: string | null) {
  const { ctx, ready } = useAcademicContext();
  const [pct, setPct] = useState(0);
  const [present, setPresent] = useState(0);
  const [total, setTotal] = useState(0);
  const [todayStatus, setTodayStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) return;
    let cancelled = false;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const settled = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AttendanceService.listForStudent(ctx, studentId, { limit: 40 }),
        ]);
        if (cancelled) return;
        const profile = settled[0].status === "fulfilled" ? settled[0].value : null;
        const list = settled[1].status === "fulfilled" ? settled[1].value : [];
        setPct(Math.round(profile?.attendancePct ?? 0));
        setPresent(profile?.attendancePresent ?? 0);
        setTotal(profile?.attendanceTotal ?? 0);
        setTodayStatus(list.find((r) => r.date === today)?.status ?? null);
      } catch {
        if (!cancelled) {
          setPct(0);
          setPresent(0);
          setTotal(0);
          setTodayStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

  return { pct, present, total, todayStatus };
}
