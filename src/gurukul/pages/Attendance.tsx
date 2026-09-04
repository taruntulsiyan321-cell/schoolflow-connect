import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AcademicProfileService,
  AttendanceService,
  useAcademicLive,
  type AttendanceRecord,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "@/hooks/use-toast";
import { GlassCard, SectionLabel, ProgressBar, cn } from "@/gurukul/components/shared";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";
import { ATTENDANCE_LOW } from "@/academic/metrics/thresholds";
import { ATTENDANCE_COMFORTABLE } from "@/academic/metrics/bands";

/**
 * How many calendar months the "Recent attendance" card shows, newest first.
 * Bounded so the label stays honest — this card previously rendered every
 * record the student had ever accumulated.
 */
const RECENT_MONTHS = 3;

/**
 * Student Attendance — AcademicProfileService + AttendanceService only.
 * No mock calendar / by-subject percentages in the UI.
 */
export default function Attendance() {
  const { ctx, ready, studentId } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);
  const loadedRef = useRef(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [pct, setPct] = useState(0);
  const [present, setPresent] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setRecords([]);
      setPct(0);
      setPresent(0);
      setTotal(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!loadedRef.current) setLoading(true);
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
        loadedRef.current = true;
        if (settled.every((s) => s.status === "rejected")) {
          toast({
            title: "Could not load attendance",
            description: "Showing zeros until your attendance records load.",
            variant: "destructive",
          });
        } else if (settled.some((s) => s.status === "rejected")) {
          toast({
            title: "Partial attendance load",
            description: "Some attendance data could not be loaded. Showing what is available.",
            variant: "destructive",
          });
        }
      } catch (e) {
        if (!cancelled) {
          setRecords([]);
          setPct(0);
          setPresent(0);
          setTotal(0);
          toast({
            title: "Could not load attendance",
            description: toErrorMessage(e, "Unknown error"),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, liveVersion]);

  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of records) map[r.status] = (map[r.status] ?? 0) + 1;
    return map;
  }, [records]);

  const col =
    pct >= ATTENDANCE_COMFORTABLE ? "#4aa87a" : pct >= ATTENDANCE_LOW ? "#c08a3a" : "#cc5069";
  // Group by calendar month, newest month first. A flat day-number grid was
  // ambiguous the moment records spanned a month boundary: only the day-of-month
  // was rendered, so a 2020-01-02 row sat next to 2026-08-06/07 as "2 6 7" with
  // nothing on screen distinguishing them. Grouping under an explicit month
  // heading also makes the "Recent attendance" label honest — it previously
  // rendered every record ever, not recent ones.
  const monthGroups = useMemo(() => {
    const byMonth = new Map<string, typeof records>();
    for (const r of records) {
      const key = r.date.slice(0, 7); // YYYY-MM
      const bucket = byMonth.get(key);
      if (bucket) bucket.push(r);
      else byMonth.set(key, [r]);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, RECENT_MONTHS)
      .map(([month, rows]) => ({
        month,
        label: new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
        days: [...rows].sort((a, b) => a.date.localeCompare(b.date)),
      }));
  }, [records]);

  if (!ready || loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading attendance…
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="text-center text-sm text-muted-foreground py-16">
        No student profile linked to this account.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GlassCard glow={pct >= ATTENDANCE_COMFORTABLE ? "green" : "amber"} className="p-6 flex items-center gap-6">
        <OverallRing pct={pct} col={col} />
        <div>
          <div className="text-sm text-muted-foreground mb-0.5">Overall attendance</div>
          <div className="text-4xl font-black" style={{ color: col, fontFamily: "var(--font-display)" }}>
            {pct}%
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {present} present-equivalent · {total} days marked
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Recent attendance</SectionLabel>
        {monthGroups.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            No attendance recorded yet.
          </div>
        )}
        <div className="space-y-4">
          {monthGroups.map((group) => (
            <div key={group.month}>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                {group.label}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {group.days.map((day) => {
                  const d = parseInt(day.date.split("-")[2] ?? "0", 10);
                  const bg =
                    day.status === "present"
                      ? "bg-emerald-400/20 text-emerald-400"
                      : day.status === "absent"
                        ? "bg-rose-400/20 text-rose-400"
                        : day.status === "late" || day.status === "half_day"
                          ? "bg-amber-400/20 text-amber-400"
                          : "bg-black/5 text-muted-foreground";
                  return (
                    <div
                      key={`${day.date}-${day.id}`}
                      title={`${day.date}: ${toEnumLabel(day.status, "attendance_status")}`}
                      className={cn(
                        "h-8 rounded-lg flex items-center justify-center text-xs font-semibold",
                        bg,
                      )}
                    >
                      {d}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Status breakdown</SectionLabel>
        <div className="space-y-3">
          {Object.entries(byStatus).map(([status, count]) => {
            const share = total ? Math.round((count / Math.max(records.length, 1)) * 100) : 0;
            const statusCol =
              status === "present" ? "#4aa87a" : status === "absent" ? "#cc5069" : "#c08a3a";
            return (
              <div key={status} className="flex items-center gap-3">
                <div className="w-28 text-sm text-muted-foreground shrink-0 capitalize">
                  {status.replace("_", " ")}
                </div>
                <div className="flex-1">
                  <ProgressBar value={share} color={statusCol} height="h-2" />
                </div>
                <div className="w-16 text-right shrink-0 text-sm font-black tabular-nums" style={{ color: statusCol }}>
                  {count}
                </div>
              </div>
            );
          })}
          {Object.keys(byStatus).length === 0 && (
            <div className="text-xs text-muted-foreground">No status records yet.</div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function OverallRing({ pct, col }: { pct: number; col: string }) {
  const size = 100;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black" style={{ color: col }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}