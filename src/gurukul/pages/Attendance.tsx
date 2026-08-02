import { useEffect, useMemo, useState } from "react";
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

/**
 * Student Attendance — AcademicProfileService + AttendanceService only.
 * No mock calendar / by-subject percentages in the UI.
 */
export default function Attendance() {
  const { ctx, ready, studentId } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);
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
      setLoading(true);
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
        if (settled.every((s) => s.status === "rejected")) {
          toast({
            title: "Could not load attendance",
            description: "Showing zeros until Academic Engine responds.",
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
            description: e instanceof Error ? e.message : "Unknown error",
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

  const col = pct >= 90 ? "#4aa87a" : pct >= 75 ? "#c08a3a" : "#cc5069";
  const calendarDays = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)),
    [records],
  );

  if (!ready || loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading attendance…
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="text-center text-sm text-[#78788c] py-16">
        No student profile linked to this account.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GlassCard glow={pct >= 90 ? "green" : "amber"} className="p-6 flex items-center gap-6">
        <OverallRing pct={pct} col={col} />
        <div>
          <div className="text-sm text-[#78788c] mb-0.5">Overall attendance (Academic Engine)</div>
          <div className="text-4xl font-black" style={{ color: col, fontFamily: "var(--font-display)" }}>
            {pct}%
          </div>
          <div className="text-xs text-[#78788c] mt-1">
            {present} present-equivalent · {total} days marked
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Recent attendance</SectionLabel>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.length === 0 && (
            <div className="col-span-7 text-center text-xs text-[#46465a] py-8">
              No attendance recorded yet.
            </div>
          )}
          {calendarDays.map((day) => {
            const d = parseInt(day.date.split("-")[2] ?? "0", 10);
            const bg =
              day.status === "present"
                ? "bg-emerald-400/20 text-emerald-400"
                : day.status === "absent"
                  ? "bg-rose-400/20 text-rose-400"
                  : day.status === "late" || day.status === "half_day"
                    ? "bg-amber-400/20 text-amber-400"
                    : "bg-white/5 text-[#78788c]";
            return (
              <div
                key={`${day.date}-${day.id}`}
                title={`${day.date}: ${day.status}`}
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
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Status breakdown (from AttendanceService)</SectionLabel>
        <div className="space-y-3">
          {Object.entries(byStatus).map(([status, count]) => {
            const share = total ? Math.round((count / Math.max(records.length, 1)) * 100) : 0;
            const statusCol =
              status === "present" ? "#4aa87a" : status === "absent" ? "#cc5069" : "#c08a3a";
            return (
              <div key={status} className="flex items-center gap-3">
                <div className="w-28 text-sm text-[#a0aec0] shrink-0 capitalize">
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
            <div className="text-xs text-[#46465a]">No status records yet.</div>
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
