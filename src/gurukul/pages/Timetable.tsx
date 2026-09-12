import { useEffect, useMemo, useState } from "react";
import { TimetableService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "@/hooks/use-toast";
import { EmptyState, GlassCard, PageHeader, PageSkeleton, SectionLabel, Skeleton, SkeletonCard, cn, subjectColor } from "@/gurukul/components/shared";
import { Clock, MapPin, User, ChevronLeft, ChevronRight } from "lucide-react";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { toErrorMessage } from "@/lib/presentation";

const PERIODS = ["1", "2", "3", "4", "Lunch", "5", "6", "7"] as const;
const DAY_MAP = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
] as const;

const SUBJECT_ICONS: Record<string, string> = {
  Mathematics: "∑",
  Physics: "⚡",
  Chemistry: "⚗",
  Biology: "🧬",
  English: "âœ",
  "Physics Lab": "⚡",
  "Chemistry Lab": "⚗",
};

const TODAY_IDX = Math.min(new Date().getDay() - 1, 4);

interface PeriodRow {
  time: string;
  subject: string;
  teacher: string;
  room: string;
  color: string;
}

interface DaySchedule {
  day: string;
  periods: PeriodRow[];
}

function gridToTimetable(grid: Record<string, string>): DaySchedule[] {
  return DAY_MAP.map(({ short, full }) => ({
    day: full,
    periods: PERIODS.map((period) => {
      const raw = grid[`${short}-${period}`]?.trim() ?? "";
      const isLunchSlot = period === "Lunch";
      const isBreak = isLunchSlot || !raw;
      const subject = isLunchSlot ? (raw || "Lunch") : (raw || "Free Period");
      return {
        time: isLunchSlot ? "Break" : `Period ${period}`,
        subject,
        teacher: "",
        room: "",
        color: isBreak ? "hsl(var(--muted-foreground))" : (subjectColor[subject] ?? subjectColor[raw] ?? "hsl(var(--muted-foreground))"),
      };
    }),
  }));
}

/**
 * Student Timetable — TimetableService (class_timetables) only.
 * No invented periods / teachers.
 */
export default function Timetable() {
  const { ctx, ready, classId } = useAcademicContext();
  const liveVersion = useAcademicLive("profile");
  const [dayIdx, setDayIdx] = useState(TODAY_IDX < 0 ? 0 : TODAY_IDX);
  const [timetable, setTimetable] = useState<DaySchedule[]>([]);
  const [classLabel, setClassLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([classId]);
  const [hasTimetable, setHasTimetable] = useState(false);

  useEffect(() => {
    if (!ready || !ctx) {
      endLoading(setLoading);
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
      try {
        const snap = await TimetableService.forClass(ctx, classId);
        if (cancelled) return;
        if (!snap) {
          setClassLabel("");
          setTimetable([]);
          setHasTimetable(false);
          return;
        }
        setClassLabel(snap.classLabel);
        setHasTimetable(snap.hasData);
        setTimetable(snap.hasData ? gridToTimetable(snap.grid) : []);
      } catch (e) {
        if (cancelled) return;
        setClassLabel("");
        setTimetable([]);
        setHasTimetable(false);
        toast({
          title: "Could not load timetable",
          description: toErrorMessage(e, "Unknown error"),
          variant: "destructive",
        });
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, liveVersion]);

  const day = timetable[dayIdx];
  const periods = day?.periods ?? [];
  const classSubjects = useMemo(
    () =>
      periods.filter(
        (p) =>
          p.subject &&
          p.subject !== "Lunch" &&
          p.subject !== "Free Period" &&
          p.time !== "Break",
      ),
    [periods],
  );

  function getCurrentPeriod() {
    // Period rows are labeled "Period N" without wall-clock times — do not invent a NOW slot.
    return -1;
  }
  const currentPeriodIdx = getCurrentPeriod();

  // ONE title for this screen, not two.
  //
  // The page header said "Timetable" and the card immediately below it said
  // "Class Timetable" in a near-identical display face — the card's heading
  // predates the page header and nothing removed it when the header arrived,
  // so the screen opened by naming itself twice. The class label was the only
  // fact that heading carried, and it belongs in the subtitle; the card is a
  // day switcher and now looks like one.
  const header = (
    <PageHeader
      eyebrow="Class"
      title="Timetable"
      subtitle={
        // `classLabel` already contains an em dash ("10 — Section A"), so
        // joining with another one gave the line three dash-separated clauses.
        classLabel
          ? `${classLabel} · periods, teachers and rooms.`
          : "Your weekly class schedule — periods, teachers and rooms."
      }
    />
  );

  if (showLoading(loading)) {
    return (
      <div className="space-y-6">
        {header}
        <PageSkeleton label="Loading timetable" className="space-y-6">
          {/* `p-2.5` and the same control sizes as the real switcher below, so
              the card does not change height when the data lands. A skeleton
              that is the wrong size is a layout shift with extra steps. */}
          <SkeletonCard className="p-2.5 flex items-center justify-center gap-2">
            <Skeleton className="w-8 h-8 rounded-xl" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[30px] w-14 rounded-lg" />
            ))}
            <Skeleton className="w-8 h-8 rounded-xl" />
          </SkeletonCard>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-full" />
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            {/* A period row is a time rail, a subject, a teacher and a room.
                Empty cards of the right HEIGHT are not a skeleton — they
                predict a box, not a layout, and the page visibly rearranges
                itself inside them when the data lands. */}
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} className="p-4 flex items-stretch gap-4">
                <div className="w-16 shrink-0 space-y-1.5">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </SkeletonCard>
            ))}
          </div>
        </PageSkeleton>
      </div>
    );
  }

  if (!hasTimetable) {
    return (
      <div className="space-y-6">
        {header}
        <GlassCard className="p-4">
          <EmptyState
            icon={<Clock className="w-6 h-6" />}
            title="No timetable yet"
            sub="Your class timetable appears here once the school sets it up."
          />
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <GlassCard glow="blue" className="p-2.5">
        <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setDayIdx((i) => Math.max(0, i - 1))}
              className="w-8 h-8 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-30"
              disabled={dayIdx === 0}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex gap-1.5">
              {DAY_MAP.map((d, i) => (
                <button
                  key={d.full}
                  onClick={() => setDayIdx(i)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    i === dayIdx
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {d.full.slice(0, 3)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setDayIdx((i) => Math.min(4, i + 1))}
              className="w-8 h-8 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-30"
              disabled={dayIdx === 4}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
        </div>
      </GlassCard>

      {/* Today summary pills */}
      <div className="flex flex-wrap gap-2">
        {classSubjects.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold"
            style={{ borderColor: `${p.color}30`, background: `${p.color}10`, color: p.color }}
          >
            {p.subject}
          </div>
        ))}
      </div>

      {/* Period list */}
      <div className="space-y-2">
        <SectionLabel>{day?.day}</SectionLabel>
        {periods.map((period, idx) => {
          const isBreak = period.subject === "Lunch" || period.time === "Break" || period.subject === "Free Period";
          const isCurrent = idx === currentPeriodIdx;
          return (
            <div
              key={idx}
              className={cn(
                "flex items-stretch gap-4 rounded-2xl border transition-all duration-200",
                isCurrent
                  ? "border-[#3b5bdb]/40 bg-[#3b5bdb]/8 shadow-[0_0_24px_rgba(59,130,246,0.12)]"
                  : "border-border bg-surface/70",
                isBreak && "opacity-50",
              )}
            >
              {!isBreak && <div className="w-1 rounded-l-2xl shrink-0" style={{ background: period.color }} />}

              <div className={cn("flex-1 py-4 pr-4", isBreak && "pl-4")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("text-sm font-bold", isBreak ? "text-muted-foreground" : "text-foreground")}>
                        {period.subject}
                      </span>
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#3b5bdb]/20 text-[#3b5bdb]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb] animate-pulse" />
                          NOW
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {period.time}
                      </div>
                      {period.teacher && (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <User className="w-3 h-3" />
                          {period.teacher}
                        </div>
                      )}
                      {period.room && (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MapPin className="w-3 h-3" />
                          {period.room}
                        </div>
                      )}
                    </div>
                  </div>
                  {!isBreak && (
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{ background: `${period.color}15` }}
                    >
                      {SUBJECT_ICONS[period.subject] ?? "📖"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Weekly overview grid */}
      <div>
        <SectionLabel>Full Week at a Glance</SectionLabel>
        <div className="overflow-x-auto">
          <div className="min-w-[640px] grid grid-cols-5 gap-2">
            {timetable.map((d, di) => (
              <div key={d.day}>
                <div
                  className={cn(
                    "text-center text-xs font-bold mb-2 py-1.5 rounded-lg",
                    di === dayIdx ? "bg-[#3b5bdb]/20 text-[#3b5bdb]" : "text-muted-foreground",
                  )}
                >
                  {d.day.slice(0, 3)}
                </div>
                <div className="space-y-1">
                  {d.periods
                    .filter(
                      (p) =>
                        p.subject &&
                        p.subject !== "Lunch" &&
                        p.subject !== "Free Period" &&
                        p.time !== "Break",
                    )
                    .map((p, pi) => (
                      <div
                        key={pi}
                        className="px-2 py-1.5 rounded-lg text-[10px] font-semibold truncate"
                        style={{ background: `${p.color}15`, color: p.color }}
                      >
                        {p.subject.replace(" Lab", "")}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
