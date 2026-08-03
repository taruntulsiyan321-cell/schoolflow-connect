import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AcademicProfileService,
  AttendanceService,
  useAcademicLive,
  type AttendanceRecord,
  type ParentChildRow,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { localDateKey } from "@/lib/localDate";

/**
 * Live parent attendance — AcademicProfileService + AttendanceService only.
 * No mock data. Summary % comes from AcademicProfileService (engine).
 */
export function ParentLiveAttendance({ studentId }: { studentId: string }) {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [pct, setPct] = useState(0);
  const [present, setPresent] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AttendanceService.listForStudent(ctx, studentId, { limit: 120 }),
        ]);
        if (cancelled) return;
        const profile = results[0].status === "fulfilled" ? results[0].value : null;
        const list = results[1].status === "fulfilled" ? results[1].value : [];
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
  }, [settled, ready, ctx, studentId, liveVersion]);

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
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
  ]);
  const [children, setChildren] = useState<ParentChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setChildren([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await AttendanceService.listParentChildren(ctx);
        if (!cancelled) setChildren(list);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load children");
          setChildren([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveVersion]);

  return { children, loading, error, ready };
}

/** Attendance metrics from AcademicProfileService for dashboard widgets. */
export function useChildAttendancePct(studentId: string | null) {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);
  const [pct, setPct] = useState(0);
  const [present, setPresent] = useState(0);
  const [total, setTotal] = useState(0);
  const [todayStatus, setTodayStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !studentId) {
      setPct(0);
      setPresent(0);
      setTotal(0);
      setTodayStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const today = localDateKey();
        const results = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AttendanceService.listForStudent(ctx, studentId, { limit: 40 }),
        ]);
        if (cancelled) return;
        const profile = results[0].status === "fulfilled" ? results[0].value : null;
        const list = results[1].status === "fulfilled" ? results[1].value : [];
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
  }, [settled, ready, ctx, studentId, liveVersion]);

  return { pct, present, total, todayStatus };
}
