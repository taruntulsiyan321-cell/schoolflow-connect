import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  AcademicProfileService,
  AttendanceService,
  useAcademicLive,
  type AttendanceRecord,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "@/hooks/use-toast";
import { EmptyState, GlassCard, NoStudentProfile, PageHeader, PageSkeleton, ProgressBar, SectionLabel, Skeleton, SkeletonCard, cn } from "@/gurukul/components/shared";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";
import { ATTENDANCE_LOW } from "@/academic/metrics/thresholds";
import { ATTENDANCE_COMFORTABLE } from "@/academic/metrics/bands";
import { pluralise } from "@/lib/plural";

/**
 * How many calendar months the "Recent attendance" card shows, newest first.
 * Bounded so the label stays honest — this card previously rendered every
 * record the student had ever accumulated.
 */
const RECENT_MONTHS = 3;

/** Monday-first, so the weekend sits at the end of the row. */
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

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
    // Still resolving is not loaded — see the long note in ClassHub.tsx.
    // Same shape here without the gate: `setLoading(false)` while `ready` is
    // false hands the screen a settled zero state it then has to take back.
    if (!ready) return;
    if (!ctx || !studentId) {
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

  // The header is three hard-coded strings. It needs no network, so it no
  // longer waits for one — it renders in every state, and only the fetched half
  // below it is skeletonised. This screen used to return a bare spinner INSTEAD
  // of the page, so a student who tapped "Attendance" could not see the word
  // Attendance until the request came back.
  const header = (
    <PageHeader
      eyebrow="Class"
      title="Attendance"
      subtitle="Your day-by-day record, as your teachers marked it."
    />
  );

  if (!ready || loading) {
    return <div className="space-y-5">{header}<AttendanceSkeleton /></div>;
  }

  if (!studentId) {
    return <div className="space-y-5">{header}<NoStudentProfile /></div>;
  }

  return (
    <div className="space-y-5">
      {header}
      <GlassCard glow={pct >= ATTENDANCE_COMFORTABLE ? "green" : "amber"} className="p-6 flex items-center gap-6">
        <OverallRing pct={pct} col={col} />
        <div>
          <div className="text-sm text-muted-foreground mb-0.5">Overall attendance</div>
          <div className="text-4xl font-black" style={{ color: col, fontFamily: "var(--font-display)" }}>
            {pct}%
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {present} present-equivalent · {pluralise(total, "day")} marked
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Recent attendance</SectionLabel>
        {monthGroups.length === 0 && (
          <EmptyState
            variant="section"
            icon={<CalendarDays className="w-5 h-5" />}
            title="No attendance recorded yet"
            sub="Days appear here once your teacher starts marking the register."
          />
        )}
        <div className="space-y-4">
          {monthGroups.map((group) => (
            <div key={group.month}>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                {group.label}
              </div>
              {/* A real month grid. `grid-cols-7` alone stretched each marked
                  day across a seventh of a 934px card — four days in September
                  rendered as four 130px pills — and filled the columns in
                  sequence, so nothing on screen said which weekday a day was.
                  Cells are now fixed squares placed in their real weekday
                  column, under weekday initials. */}
              <div className="grid grid-cols-7 gap-1.5 max-w-md">
                {WEEKDAY_INITIALS.map((w, i) => (
                  <div
                    key={`${group.month}-wd-${i}`}
                    className="text-[10px] font-semibold text-muted-foreground text-center pb-0.5"
                  >
                    {w}
                  </div>
                ))}
                {group.days.map((day) => {
                  const d = parseInt(day.date.split("-")[2] ?? "0", 10);
                  // Monday-first column, so the weekend sits at the end.
                  const weekday = (new Date(`${day.date}T00:00:00`).getDay() + 6) % 7;
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
                      style={{ gridColumnStart: weekday + 1 }}
                      className={cn(
                        "aspect-square rounded-lg flex items-center justify-center text-xs font-semibold",
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

/**
 * The shape this screen is about to be: the overall ring, a month grid, and the
 * status breakdown. Two weeks of cells is enough to read as a calendar without
 * promising a specific number of marked days.
 */
function AttendanceSkeleton() {
  return (
    <PageSkeleton label="Loading attendance">
      <SkeletonCard className="p-6 flex items-center gap-6">
        <Skeleton className="w-[100px] h-[100px] rounded-full shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-3 w-48" />
        </div>
      </SkeletonCard>

      <SkeletonCard className="p-5 space-y-4">
        <Skeleton className="h-3 w-40" />
        <div className="grid grid-cols-7 gap-1.5 max-w-md">
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      </SkeletonCard>

      <SkeletonCard className="p-5 space-y-4">
        <Skeleton className="h-3 w-36" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-28 shrink-0" />
            <Skeleton className="h-2 flex-1" />
            <Skeleton className="h-4 w-8 shrink-0" />
          </div>
        ))}
      </SkeletonCard>
    </PageSkeleton>
  );
}