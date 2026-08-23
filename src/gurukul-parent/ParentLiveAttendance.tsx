import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AcademicProfileService,
  AttendanceService,
  useAcademicLive,
  computeAttendanceRisk,
  RiskBadge,
  riskReasonText,
  type AttendanceRecord,
  type ParentChildRow,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useKeyedResource } from "@/hooks/useKeyedResource";
import { localDateKey } from "@/lib/localDate";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";

/**
 * Live parent attendance — AcademicProfileService + AttendanceService only.
 * No mock data. Summary % comes from AcademicProfileService (engine).
 */
export function ParentLiveAttendance({ studentId }: { studentId: string }) {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);

  /*
   * Loaded through useKeyedResource rather than a hand-rolled effect.
   *
   * This component is remounted-in-place when a parent switches child — the
   * `studentId` prop changes but React keeps the same instance. With the old
   * effect, the `if (!settled) return;` guard returned before resetting any
   * state, so if identity happened to be re-resolving at that moment (a token
   * refresh, say) the previous child's attendance stayed on screen under the
   * new child's name. useKeyedResource stamps its state with the key it was
   * loaded for and refuses to return state belonging to a different child, so
   * that is structurally impossible regardless of the guards.
   *
   * The partial-failure semantics are preserved exactly: profile and list are
   * fetched with allSettled, either may fail independently, and `unavailable`
   * still distinguishes "a fetch failed" from "genuinely empty".
   */
  const attendance = useKeyedResource(
    [studentId, liveVersion],
    async (_key, signal) => {
      const results = await Promise.allSettled([
        AcademicProfileService.get(ctx!, studentId),
        AttendanceService.listForStudent(ctx!, studentId, { limit: 120 }),
      ]);
      if (signal.aborted) throw new DOMException("aborted", "AbortError");

      if (results[0].status === "rejected") {
        console.warn(
          `[ParentLiveAttendance] AcademicProfileService.get failed for student ${studentId}:`,
          results[0].reason,
        );
      }
      if (results[1].status === "rejected") {
        console.warn(
          `[ParentLiveAttendance] AttendanceService.listForStudent failed for student ${studentId}:`,
          results[1].reason,
        );
      }

      const profile = results[0].status === "fulfilled" ? results[0].value : null;
      const list = results[1].status === "fulfilled" ? results[1].value : [];
      return {
        records: list,
        pct: Math.round(profile?.attendancePct ?? 0),
        present: profile?.attendancePresent ?? 0,
        total: profile?.attendanceTotal ?? 0,
        risk:
          profile && profile.attendanceTotal > 0
            ? computeAttendanceRisk(profile.attendancePct)
            : null,
        unavailable:
          results[0].status === "rejected" || results[1].status === "rejected",
      };
    },
    { enabled: settled && ready && !!ctx, errorFallback: "Failed to load attendance" },
  );

  // Memoised so the `?? []` fallback is not a new array identity each render,
  // which would re-run the calendar sort below on every parent re-render.
  const records = useMemo<AttendanceRecord[]>(
    () => attendance.data?.records ?? [],
    [attendance.data],
  );
  const pct = attendance.data?.pct ?? 0;
  const present = attendance.data?.present ?? 0;
  const total = attendance.data?.total ?? 0;
  const risk = attendance.data?.risk ?? null;
  const unavailable = attendance.data?.unavailable ?? false;
  const error = attendance.error;
  // `settled && !ready` means there is no academic context at all — show the
  // empty state rather than spinning forever.
  const loading = attendance.isLoading && !(settled && (!ready || !ctx));

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
      <div className="flex items-center justify-center py-12 text-muted-foreground text-xs gap-2">
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
          <div className="text-lg font-black text-[#3b5bdb]">{unavailable ? "—" : present}</div>
          <div className="text-[9px] text-[#3b5bdb] uppercase tracking-wide font-bold">Present equiv.</div>
        </div>
        <div className="bg-black/5 border border-black/10 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-foreground">{unavailable ? "—" : total}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide font-bold">Days marked</div>
        </div>
        <div className="bg-black/5 border border-black/10 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-foreground">{unavailable ? "—" : `${pct}%`}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide font-bold">Engine rate</div>
        </div>
      </div>

      {unavailable && (
        <div className="flex items-center gap-2 bg-[#cc5069]/10 border border-[#cc5069]/20 rounded-xl px-3 py-2.5">
          <span className="text-[11px] text-[#cc5069]">
            Attendance data unavailable — try again later.
          </span>
        </div>
      )}

      {risk && risk.band !== "low" && (
        <div className="flex items-center gap-2 bg-black/5 border border-black/10 rounded-xl px-3 py-2.5">
          <RiskBadge band={risk.band} />
          <span className="text-[11px] text-muted-foreground">{riskReasonText(risk.reason_codes)}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {Object.entries(statusColor).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1.5 text-[10px] text-muted-foreground capitalize">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
            {k.replace("_", " ")}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarDays.length === 0 && (
          <div className="col-span-7 text-center text-xs text-muted-foreground py-8">
            No attendance recorded yet.
          </div>
        )}
        {calendarDays.map((day) => {
          const d = parseInt(day.date.split("-")[2] ?? "0", 10);
          const color = statusColor[day.status] ?? "#78788c";
          return (
            <div
              key={`${day.date}-${day.id}`}
              title={`${day.date}: ${toEnumLabel(day.status, "attendance_status")}`}
              className="aspect-square rounded-md flex items-center justify-center text-[9px] font-bold"
              style={{ background: `${color}30`, color }}
            >
              {d}
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-muted-foreground">
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
          setError(toErrorMessage(e, "Failed to load children"));
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
  // True when either parallel fetch (profile OR attendance list) rejected —
  // distinct from a fulfilled-but-genuinely-empty result.
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !studentId) {
      setPct(0);
      setPresent(0);
      setTotal(0);
      setTodayStatus(null);
      setUnavailable(false);
      setLoading(false);
      return;
    }
    // Reset synchronously on every studentId change so the previous child's
    // numbers never flash under the newly selected child's name while the
    // new fetch is in flight.
    let cancelled = false;
    setLoading(true);
    setPct(0);
    setPresent(0);
    setTotal(0);
    setTodayStatus(null);
    setUnavailable(false);
    (async () => {
      try {
        const today = localDateKey();
        const results = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AttendanceService.listForStudent(ctx, studentId, { limit: 40 }),
        ]);
        if (cancelled) return;
        if (results[0].status === "rejected") {
          console.warn(
            `[useChildAttendancePct] AcademicProfileService.get failed for student ${studentId}:`,
            results[0].reason,
          );
        }
        if (results[1].status === "rejected") {
          console.warn(
            `[useChildAttendancePct] AttendanceService.listForStudent failed for student ${studentId}:`,
            results[1].reason,
          );
        }
        const profile = results[0].status === "fulfilled" ? results[0].value : null;
        const list = results[1].status === "fulfilled" ? results[1].value : [];
        setPct(Math.round(profile?.attendancePct ?? 0));
        setPresent(profile?.attendancePresent ?? 0);
        setTotal(profile?.attendanceTotal ?? 0);
        setTodayStatus(list.find((r) => r.date === today)?.status ?? null);
        setUnavailable(results[0].status === "rejected" || results[1].status === "rejected");
      } catch (e) {
        if (!cancelled) {
          console.warn(`[useChildAttendancePct] unexpected failure for student ${studentId}:`, e);
          setPct(0);
          setPresent(0);
          setTotal(0);
          setTodayStatus(null);
          setUnavailable(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, studentId, liveVersion]);

  return { pct, present, total, todayStatus, unavailable, loading };
}